// MINGLA-INVARIANT: I-3697-AD-AUDIT-WRITERS-COVERED | issue #3697 | every action an edge function writes to ad_status_events is allowed by the latest ad_status_events_action_check; an unresolvable action expression fails closed
/**
 * Issue #3697 — no edge function may audit an action the database refuses.
 *
 * Live failure (2026-10-20 02:01 UTC): admin-ad-creative-prepare returned 500
 * audit_write_failed on its first `prepare_begin` audit, because the v1.4
 * control-plane migration redefined ad_status_events_action_check without the
 * #1184 prepare_* / preview_* actions. Every video preparation and preview was
 * broken while every unit test stayed green.
 *
 * This suite reads every `.from("ad_status_events").insert(...)` under
 * supabase/functions, resolves its `action:` to string literals (direct,
 * ternary, typed union, or the audit/cas helper call sites), and asserts each
 * is in the CHECK list of the LATEST migration that defines the constraint.
 *
 * FAILS ON REVERT: delete
 * supabase/migrations/20271121003697_issue_3697_ad_status_events_action_union.sql
 * and the prepare_* / preview_* actions are reported as refused.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO = new URL("../../../../", import.meta.url);
const FUNCTIONS = new URL("supabase/functions/", REPO);
const MIGRATIONS = new URL("supabase/migrations/", REPO);

function walk(dir: URL, out: URL[] = []): URL[] {
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) walk(child, out);
    else if (entry.isFile && entry.name.endsWith(".ts")) out.push(child);
  }
  return out;
}

function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced insert(...)");
}

const LITERAL = /"([a-z][a-z_]*)"/g;
const literals = (text: string): string[] =>
  [...text.matchAll(LITERAL)].map((m) => m[1]);

/** The `action:` expression of one insert object, up to the next key. */
function actionExpression(insertCall: string): string | null {
  const at = insertCall.search(/\baction:\s/);
  if (at < 0) {
    // Shorthand property: `{ ..., action, ... }`.
    return /[{,]\s*action\s*[,}\n]/.test(insertCall) ? "action" : null;
  }
  const rest = insertCall.slice(at + "action:".length);
  const end = rest.search(/,\s*\n\s*[A-Za-z_]+\s*:|\n\s*\}/);
  return (end < 0 ? rest : rest.slice(0, end)).trim().replace(/,$/, "");
}

/** Resolve a bare identifier to the literals it can hold in this file. */
function resolveIdentifier(source: string, ident: string): string[] {
  const found = new Set<string>();
  // 1. A typed union: `ident: "a" | "b"` or `ident = x as "a" | "b"`.
  const typed = new RegExp(
    `\\b${ident}\\b\\s*(?::|=[^;\\n]*?\\bas)\\s*((?:"[a-z_]+"\\s*\\|?\\s*)+)`,
    "g",
  );
  for (const m of source.matchAll(typed)) literals(m[1]).forEach((l) => found.add(l));
  // 2. A helper parameter: `const helper = async (... ident: string ...)`;
  //    every call site passes the action as a literal in that position.
  const helper = new RegExp(
    `const\\s+([A-Za-z_]+)\\s*=\\s*async\\s*\\(([^)]*?)\\b${ident}\\s*:\\s*string`,
    "g",
  );
  for (const m of source.matchAll(helper)) {
    const name = m[1];
    const before = m[2].split(",").filter((p) => p.includes(":")).length;
    const calls = new RegExp(`\\b${name}\\(`, "g");
    for (const call of source.matchAll(calls)) {
      const args = balanced(source, call.index! + name.length);
      if (/^\(\s*\n?\s*[A-Za-z_]+\s*:/.test(args)) continue; // the definition
      if (before === 0) {
        const first = /^\(\s*"([a-z_]+)"/.exec(args);
        if (first) found.add(first[1]);
      } else {
        const after = /^\(\s*\{[\s\S]*?\},\s*"([a-z_]+)"/.exec(args);
        if (after) found.add(after[1]);
      }
    }
  }
  return [...found];
}

type Writer = { file: string; expression: string; actions: string[] };

function auditWriters(): Writer[] {
  const writers: Writer[] = [];
  for (const file of walk(FUNCTIONS)) {
    const source = Deno.readTextFileSync(file);
    const marker = /\.from\("ad_status_events"\)\s*\.insert\(/g;
    for (const m of source.matchAll(marker)) {
      const open = m.index! + m[0].length - 1;
      const call = balanced(source, open);
      const expression = actionExpression(call);
      const rel = file.pathname.slice(FUNCTIONS.pathname.length);
      if (!expression) {
        writers.push({ file: rel, expression: "<missing>", actions: [] });
        continue;
      }
      let actions = literals(expression);
      if (actions.length === 0 && /^[A-Za-z_]+$/.test(expression)) {
        actions = resolveIdentifier(source, expression);
      }
      writers.push({ file: rel, expression, actions });
    }
  }
  return writers;
}

function latestAllowedActions(): { file: string; allowed: Set<string> } {
  const files = [...Deno.readDirSync(MIGRATIONS)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
  let latest: { file: string; allowed: Set<string> } | null = null;
  for (const name of files) {
    const sql = Deno.readTextFileSync(new URL(name, MIGRATIONS));
    const re =
      /ADD\s+CONSTRAINT\s+ad_status_events_action_check\s+CHECK\s*\(\s*action\s+IN\s*\(([\s\S]*?)\)\s*\)/gi;
    for (const m of sql.matchAll(re)) {
      const body = m[1].replace(/--[^\n]*/g, "");
      latest = {
        file: name,
        allowed: new Set([...body.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])),
      };
    }
  }
  if (!latest) throw new Error("no ad_status_events_action_check found");
  return latest;
}

Deno.test("#3697 every ad_status_events writer resolves to literal actions (fail closed)", () => {
  const writers = auditWriters();
  assert(writers.length >= 20, `expected the known writers, found ${writers.length}`);
  const unresolved = writers.filter((w) => w.actions.length === 0);
  assertEquals(
    unresolved,
    [],
    "an audit insert whose action cannot be resolved must be made literal or typed",
  );
  const all = new Set(writers.flatMap((w) => w.actions));
  for (
    const expected of [
      "create",
      "create_failed",
      "rollback",
      "launch",
      "pause",
      "sync",
      "stop_requested",
      "prepare_begin",
      "prepare_ref_saved",
      "prepare_check",
      "prepare_ready",
      "prepare_failed",
      "prepare_timeout",
      "preview_request",
      "preview_ready",
      "preview_failed",
    ]
  ) {
    assert(all.has(expected), `parser lost the ${expected} writer`);
  }
});

Deno.test("#3697 the latest constraint allows every action an edge function writes", () => {
  const { file, allowed } = latestAllowedActions();
  const refused = auditWriters().flatMap((w) =>
    w.actions.filter((a) => !allowed.has(a)).map((a) => `${w.file}: ${a}`)
  );
  assertEquals(
    [...new Set(refused)],
    [],
    `${file} refuses actions that edge functions write`,
  );
});

Deno.test("#3697 the latest constraint keeps the campaign stop/settlement actions", () => {
  const { allowed } = latestAllowedActions();
  for (const action of ["stop_confirmed", "settlement", "prepare_begin_failed"]) {
    assert(allowed.has(action), `${action} must stay allowed`);
  }
  assert(!allowed.has("not_an_action"));
});
