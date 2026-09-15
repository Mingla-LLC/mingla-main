#!/usr/bin/env node
// #3197 [every public Host page served noindex and the sitemap was empty] — the
// class guard.
//
// Enforces I-3197-SEARCH-PROMOTION-HAS-A-CALLER (DRAFT):
//
//   For every registered PROMOTION SURFACE {table, column, indexableState,
//   reader} — today exactly one, `public_search_documents.lifecycle_state =
//   'search_ready'`, read by `list_public_search_sitemap` — replaying
//   `supabase/migrations/*.sql` in filename order, with comments stripped:
//
//   (A) at least one function body WRITES the literal indexable state into the
//       table (`INSERT INTO <table> … 'search_ready'` or `UPDATE <table> SET
//       <column> = 'search_ready'`). A parameterised admin RPC that writes
//       whatever state its caller passes is a door, not a writer;
//   (B) every such writer — and every function whose name says it reconciles,
//       promotes or asserts convergence of public search — is REACHABLE: named
//       in the command of a LIVE `cron.schedule` (replayed by job name; a later
//       literal `cron.unschedule` removes it), or the EXECUTE FUNCTION of a
//       `CREATE TRIGGER`, or called (transitively) by a function that is;
//   (C) the surface's reader still exists;
//   (D) no migration writes the indexable state at APPLY time — outside a
//       function body, inside a `DO` block, or by calling a writer at top
//       level. Promotion belongs to the scheduled job, never to a migration
//       transaction nobody can review row by row;
//   (E) discovery ratchet: no anon-executable function filters on the
//       indexable state against a table that is not a registered surface, so a
//       second overlay cannot ship dark beside this one.
//
// WHY THIS EXISTS. #2986 built the deny-by-default header, the sitemap reader,
// the table trigger and a promotion RPC — and nothing ever called the RPC.
// Production held zero rows, every brand/event/venue page served `noindex` and
// `/sitemap.xml` was an empty `<urlset>` from 2026-09-01 to #3197. A switch with
// no caller, for the fifth time (#2168, #2222, #2290, #2305, #3197). The #2290
// gate cannot see this class: it only reads `functions/v1/<name>` targets out of
// cron commands, and a SQL function has none.
//
// WHAT IT WOULD HAVE CAUGHT. Run on the tree before #3197, (A) fails: the only
// function that INSERTs into `public_search_documents` is
// `upsert_public_search_document`, which writes its parameter, so the surface
// has a reader and no writer. Delete the #3197 reconcile `cron.schedule` line
// and (B) fails naming `issue_3197_reconcile_public_search`.
//
// Modes:
//   node issue-3197-search-promotion-has-a-caller.mjs              — enforce
//   node issue-3197-search-promotion-has-a-caller.mjs --self-test  — prove it detects

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { balancedArgs, stripSqlComments } from "./issue-2290-queue-worker-has-cron-caller.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MIGRATIONS_DIR = "supabase/migrations";

/** The registry. Adding an overlay means adding it here in the same change. */
export const SURFACES = Object.freeze([
  Object.freeze({
    table: "public_search_documents",
    column: "lifecycle_state",
    indexableState: "search_ready",
    reader: "list_public_search_sitemap",
  }),
]);

/** Names that declare a promotion/reconcile/monitor role for public search. */
const ROLE_NAME = /public_search.*(reconcile|promot|converge)|(reconcile|promot|converge).*public_search/i;

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

/** `$tag$` / `$$` opening at `i`, or null. */
function dollarTagAt(sql, i) {
  if (sql[i] !== "$") return null;
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
  return m ? m[0] : null;
}

/** Index just past a single-quoted literal that opens at `i`. */
function skipQuoted(sql, i) {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") { j += 2; continue; }
      return j + 1;
    }
    j += 1;
  }
  return sql.length;
}

/**
 * The statement that starts at `start`: up to the first `;` that is outside a
 * quoted literal, a dollar-quoted body and any parentheses. A reason string
 * containing `;` therefore cannot cut a write statement short.
 */
export function statementFrom(sql, start) {
  let depth = 0;
  let i = start;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return sql.slice(start);
      i = end + tag.length;
      continue;
    }
    const ch = sql[i];
    if (ch === "'") { i = skipQuoted(sql, i); continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) return sql.slice(start, i + 1);
    i += 1;
  }
  return sql.slice(start);
}

/** Split call arguments at top-level commas (quote- and dollar-aware). */
export function splitArgs(args) {
  const out = [];
  let depth = 0;
  let last = 0;
  let i = 0;
  while (i < args.length) {
    const tag = dollarTagAt(args, i);
    if (tag) {
      const end = args.indexOf(tag, i + tag.length);
      i = end === -1 ? args.length : end + tag.length;
      continue;
    }
    const ch = args[i];
    if (ch === "'") { i = skipQuoted(args, i); continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) { out.push(args.slice(last, i).trim()); last = i + 1; }
    i += 1;
  }
  out.push(args.slice(last).trim());
  return out.filter((a) => a.length > 0);
}

/** The text of a `'literal'` or `$tag$ body $tag$` argument, or null. */
function literalText(arg) {
  const quoted = /^'((?:[^']|'')*)'$/s.exec(arg);
  if (quoted) return quoted[1].replace(/''/g, "'");
  const tag = dollarTagAt(arg, 0);
  if (tag && arg.endsWith(tag) && arg.length >= tag.length * 2) {
    return arg.slice(tag.length, arg.length - tag.length);
  }
  return null;
}

/** Replace every dollar-quoted region with spaces, preserving offsets. */
function blankDollarBodies(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (sql[i] === "'") {
      const stop = skipQuoted(sql, i);
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Blank the inside of every single-quoted literal, preserving offsets. */
function blankQuoted(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      const stop = skipQuoted(text, i);
      out += "'" + " ".repeat(Math.max(0, stop - i - 2)) + (stop - i >= 2 ? "'" : "");
      i = stop;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Function names CALLED in `text` that exist in `known`. A name inside a string
 * literal (`has_function_privilege('anon','public.fn()', …)`, a comparison with a
 * cron command) is not a call, so literals are blanked first.
 */
function calledFunctions(text, known) {
  const names = new Set();
  const re = new RegExp(`(?:\\bpublic\\.|(?<![A-Za-z0-9_.]))(${IDENT})\\s*\\(`, "g");
  const scan = blankQuoted(text);
  let m;
  while ((m = re.exec(scan)) !== null) {
    if (known.has(m[1].toLowerCase())) names.add(m[1].toLowerCase());
  }
  return names;
}

/** Statements of `text` that EXECUTE something: DDL that merely names a function is not a call. */
function executableStatements(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s;]/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const stmt = statementFrom(text, i);
    if (!/^(?:CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|SECURITY\s+LABEL)\b/i.test(stmt)) out.push(stmt);
    i += stmt.length;
  }
  return out;
}

/** Top-level only: `supabase/migrations/<file>.sql`. A test file is never a caller. */
function isTopLevelMigration(file) {
  return !file.includes("/") && !file.includes(path.sep) && file.endsWith(".sql");
}

/**
 * Replay every top-level migration in filename order. Returns the live
 * function bodies, the live cron jobs, trigger roots, apply-time text, and
 * anon grants.
 */
export function replay(migrations) {
  const functions = new Map(); // name -> Map(signature -> { file, body })
  const jobs = new Map(); // jobname -> { file, command }
  const triggers = []; // { file, table, fn }
  const applyTime = []; // { file, text } — text that executes when the migration applies
  const anonGrants = []; // { file, fn }
  let scheduleCalls = 0;
  let dynamicUnschedules = 0;

  const ordered = [...migrations]
    .filter((m) => isTopLevelMigration(m.file))
    .sort((a, b) => a.file.localeCompare(b.file));

  for (const { file, sql } of ordered) {
    const clean = stripSqlComments(sql);
    const events = [];

    const fnRe = new RegExp(
      `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\.)?"?(${IDENT})"?\\s*\\(`,
      "gi",
    );
    let m;
    while ((m = fnRe.exec(clean)) !== null) events.push({ kind: "function", index: m.index, m });

    const dropRe = new RegExp(
      `\\bDROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?(${IDENT})"?\\s*(\\()?`,
      "gi",
    );
    while ((m = dropRe.exec(clean)) !== null) events.push({ kind: "drop", index: m.index, m });

    const cronRe = /\bcron\.(schedule|unschedule)\s*\(/gi;
    while ((m = cronRe.exec(clean)) !== null) events.push({ kind: "cron", index: m.index, m });

    events.sort((a, b) => a.index - b.index);

    for (const ev of events) {
      if (ev.kind === "function") {
        const name = ev.m[1].toLowerCase();
        const open = clean.indexOf("(", ev.m.index + ev.m[0].length - 1);
        const args = balancedArgs(clean, open) ?? "";
        const afterArgs = open + args.length + 2;
        const asRe = /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$|')/gi;
        asRe.lastIndex = afterArgs;
        const as = asRe.exec(clean);
        if (!as) continue;
        let body = "";
        if (as[1] === "'") {
          const start = as.index + as[0].length - 1;
          body = clean.slice(start + 1, skipQuoted(clean, start) - 1).replace(/''/g, "'");
        } else {
          const start = as.index + as[0].length;
          const end = clean.indexOf(as[1], start);
          body = clean.slice(start, end === -1 ? clean.length : end);
        }
        const signature = args.replace(/\s+/g, " ").trim().toLowerCase();
        if (!functions.has(name)) functions.set(name, new Map());
        functions.get(name).set(signature, { file, body: stripSqlComments(body) });
      } else if (ev.kind === "drop") {
        const name = ev.m[1].toLowerCase();
        if (!functions.has(name)) continue;
        if (ev.m[2]) {
          const open = clean.indexOf("(", ev.m.index + ev.m[0].length - 1);
          const signature = (balancedArgs(clean, open) ?? "").replace(/\s+/g, " ").trim().toLowerCase();
          const sigs = functions.get(name);
          // A DROP names types only; a CREATE names parameters too. Drop the
          // signature whose type list matches, else (overload unknown) keep.
          for (const key of [...sigs.keys()]) {
            const types = splitArgs(key).map((a) => a.split(/\s+/).slice(-1)[0]).join(",");
            const dropTypes = splitArgs(signature).map((a) => a.split(/\s+/).slice(-1)[0]).join(",");
            if (key === signature || types === dropTypes) sigs.delete(key);
          }
          if (sigs.size === 0) functions.delete(name);
        } else {
          functions.delete(name);
        }
      } else {
        const open = clean.indexOf("(", ev.m.index + ev.m[0].length - 1);
        const args = balancedArgs(clean, open);
        if (args === null) continue;
        const parts = splitArgs(args);
        if (ev.m[1].toLowerCase() === "unschedule") {
          const name = parts.length === 1 ? literalText(parts[0]) : null;
          if (name !== null && /^'/.test(parts[0])) jobs.delete(name);
          else dynamicUnschedules += 1;
          continue;
        }
        scheduleCalls += 1;
        if (parts.length >= 3) {
          const name = literalText(parts[0]);
          const command = literalText(parts[2]) ?? parts[2];
          if (name !== null) jobs.set(name, { file, command });
        } else if (parts.length === 2) {
          const command = literalText(parts[1]) ?? parts[1];
          jobs.set(`__unnamed__:${command}`, { file, command });
        }
      }
    }

    // Apply-time text: everything outside dollar bodies, plus DO blocks.
    const outside = blankDollarBodies(clean);
    applyTime.push({ file, text: outside });
    const doRe = /\bDO\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/gi;
    while ((m = doRe.exec(clean)) !== null) {
      const start = m.index + m[0].length;
      const end = clean.indexOf(m[1], start);
      applyTime.push({ file, text: stripSqlComments(clean.slice(start, end === -1 ? clean.length : end)), inDo: true });
    }

    const trigRe = new RegExp(
      `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+"?${IDENT}"?[\\s\\S]*?\\bON\\s+(?:"?${IDENT}"?\\.)?"?(${IDENT})"?[\\s\\S]*?\\bEXECUTE\\s+(?:FUNCTION|PROCEDURE)\\s+(?:"?public"?\\.)?"?(${IDENT})"?\\s*\\(`,
      "gi",
    );
    while ((m = trigRe.exec(outside)) !== null) {
      triggers.push({ file, table: m[1].toLowerCase(), fn: m[2].toLowerCase() });
    }

    const grantRe = new RegExp(
      `\\bGRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:"?public"?\\.)?"?(${IDENT})"?\\s*\\([^)]*\\)\\s+TO\\s+([^;]+);`,
      "gi",
    );
    while ((m = grantRe.exec(outside)) !== null) {
      if (/\banon\b|\bpublic\b/i.test(m[2])) anonGrants.push({ file, fn: m[1].toLowerCase() });
    }
  }

  return { functions, jobs, triggers, applyTime, anonGrants, scheduleCalls, dynamicUnschedules, files: ordered.length };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Statements in `text` that write `surface.indexableState` into `surface.table`. */
export function literalWrites(text, surface) {
  const writes = [];
  const table = `(?:"?public"?\\.)?"?${escapeRe(surface.table)}"?`;
  const state = `'${surface.indexableState}'`;
  const insertRe = new RegExp(`\\bINSERT\\s+INTO\\s+${table}\\b`, "gi");
  const updateRe = new RegExp(`\\bUPDATE\\s+${table}\\b`, "gi");
  let m;
  while ((m = insertRe.exec(text)) !== null) {
    const stmt = statementFrom(text, m.index);
    if (stmt.includes(state)) writes.push({ op: "INSERT", stmt });
  }
  while ((m = updateRe.exec(text)) !== null) {
    const stmt = statementFrom(text, m.index);
    if (new RegExp(`\\b${escapeRe(surface.column)}\\s*=\\s*${escapeRe(state)}`, "i").test(stmt)) {
      writes.push({ op: "UPDATE", stmt });
    }
  }
  return writes;
}

/** Pure checker. `migrations` is [{ file, sql }]; `surfaces` defaults to the registry. */
export function analyze(migrations, surfaces = SURFACES) {
  const r = replay(migrations);
  const known = new Set(r.functions.keys());
  const bodyOf = (name) => [...(r.functions.get(name)?.values() ?? [])].map((v) => v.body).join("\n");

  // Reachability: live cron commands and trigger functions are roots.
  const roots = new Map(); // fn -> reason
  for (const [job, { command }] of r.jobs) {
    for (const fn of calledFunctions(stripSqlComments(command), known)) {
      if (!roots.has(fn)) roots.set(fn, `cron job ${job.startsWith("__unnamed__:") ? "(unnamed)" : job}`);
    }
  }
  for (const t of r.triggers) {
    if (known.has(t.fn) && !roots.has(t.fn)) roots.set(t.fn, `trigger on ${t.table}`);
  }
  const reachable = new Map(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [caller, why] of [...reachable]) {
      for (const callee of calledFunctions(bodyOf(caller), known)) {
        if (!reachable.has(callee)) {
          reachable.set(callee, `called by ${caller} (${why})`);
          grew = true;
        }
      }
    }
  }

  const violations = [];
  const report = [];
  const writerNames = new Set();

  if (surfaces.length === 0) {
    violations.push({ rule: "registry", message: "the promotion-surface registry is empty" });
  }

  for (const surface of surfaces) {
    const writers = [...r.functions.keys()].filter((name) => literalWrites(bodyOf(name), surface).length > 0).sort();
    for (const w of writers) writerNames.add(w);

    if (!known.has(surface.reader)) {
      violations.push({
        rule: "C",
        message: `${surface.table}: the registered reader ${surface.reader} no longer exists`,
      });
    }
    if (writers.length === 0) {
      violations.push({
        rule: "A",
        message:
          `${surface.table}.${surface.column}='${surface.indexableState}' has a reader ` +
          `(${surface.reader}) but NO function ever writes that state — every page stays unindexable`,
      });
    }
    for (const w of writers) {
      if (!reachable.has(w)) {
        violations.push({
          rule: "B",
          message:
            `${surface.table}.${surface.indexableState} — writer ${w} has no live cron or trigger caller`,
        });
      }
    }
    report.push({ surface, writers: writers.map((w) => ({ name: w, caller: reachable.get(w) ?? null })) });

    // (D) apply-time promotion.
    for (const { file, text, inDo } of r.applyTime) {
      for (const write of literalWrites(text, surface)) {
        violations.push({
          rule: "D",
          message: `${file}: ${inDo ? "a DO block" : "top-level SQL"} ${write.op}s '${surface.indexableState}' into ${surface.table} at apply time`,
        });
      }
    }

    // (E) discovery ratchet.
    const filter = new RegExp(`=\\s*'${escapeRe(surface.indexableState)}'`);
    for (const g of r.anonGrants) {
      const body = bodyOf(g.fn);
      if (!filter.test(body)) continue;
      if (surfaces.some((s) => new RegExp(`\\b${escapeRe(s.table)}\\b`).test(body))) continue;
      violations.push({
        rule: "E",
        message: `${g.file}: anon-executable ${g.fn} filters '${surface.indexableState}' on an unregistered table — register the surface`,
      });
    }
  }

  // Named promotion/reconcile/monitor functions need a caller too.
  const roleFunctions = [...r.functions.keys()].filter((n) => ROLE_NAME.test(n)).sort();
  for (const fn of roleFunctions) {
    if (!writerNames.has(fn) && !reachable.has(fn)) {
      violations.push({ rule: "B", message: `public-search role function ${fn} has no live cron or trigger caller` });
    }
  }

  // (D) a writer executed directly at apply time.
  for (const { file, text } of r.applyTime) {
    const seen = new Set();
    for (const stmt of executableStatements(text)) {
      for (const fn of calledFunctions(stmt, writerNames)) {
        if (seen.has(fn)) continue;
        seen.add(fn);
        violations.push({ rule: "D", message: `${file}: executes promotion writer ${fn} at apply time` });
      }
    }
  }

  return { violations, report, roleFunctions, replay: r, reachable };
}

function loadMigrations() {
  const root = path.join(REPO_ROOT, MIGRATIONS_DIR);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => ({ file: e.name, sql: fs.readFileSync(path.join(root, e.name), "utf8") }));
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const READER = {
  file: "20270101000000_reader.sql",
  sql:
    "CREATE TABLE public.public_search_documents (id uuid, lifecycle_state text);\n" +
    "CREATE FUNCTION public.list_public_search_sitemap() RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER AS $function$\n" +
    "  SELECT d.id::text FROM public.public_search_documents d WHERE d.lifecycle_state='search_ready';\n" +
    "$function$;\n" +
    "GRANT EXECUTE ON FUNCTION public.list_public_search_sitemap() TO anon, authenticated, service_role;\n" +
    "CREATE FUNCTION public.upsert_public_search_document(p_state text) RETURNS void LANGUAGE plpgsql AS $function$\n" +
    "BEGIN\n" +
    "  IF p_state='search_ready' THEN PERFORM 1; END IF;\n" +
    "  INSERT INTO public.public_search_documents(lifecycle_state) VALUES (p_state);\n" +
    "END;\n$function$;\n",
};

const WRITER_SQL =
  "CREATE FUNCTION public.issue_9_reconcile_public_search() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$\n" +
  "BEGIN\n" +
  "  -- a reason with a ; inside it must not cut the statement\n" +
  "  UPDATE public.public_search_documents SET change_reason = 'moved; again', lifecycle_state = 'search_ready' WHERE true;\n" +
  "  RETURN '{}'::jsonb;\n" +
  "END;\n$function$;\n";

const SCHEDULE_SQL =
  "SELECT cron.unschedule('issue_9_reconcile') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_9_reconcile');\n" +
  "SELECT cron.schedule('issue_9_reconcile','* * * * *',$cron$SELECT public.issue_9_reconcile_public_search();$cron$);\n";

function selfTest() {
  const failures = [];
  const expect = (label, result, predicate) => {
    if (!predicate(result)) {
      failures.push(`${label}: ${JSON.stringify(result.violations.map((v) => v.message))}`);
    }
  };
  const has = (rule, needle) => (res) => res.violations.some((v) => v.rule === rule && v.message.includes(needle));
  const clean = (res) => res.violations.length === 0;

  // GOOD: a scheduled writer (unschedule-if-exists + reschedule idiom).
  expect("GOOD scheduled writer", analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL }]), clean);

  // GOOD-2: reached transitively through a scheduled wrapper.
  expect(
    "GOOD transitive caller",
    analyze([
      READER,
      {
        file: "20270202000000_w.sql",
        sql:
          WRITER_SQL.replace("issue_9_reconcile_public_search", "issue_9_write_rows") +
          "CREATE FUNCTION public.issue_9_tick() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN PERFORM public.issue_9_write_rows(); END; $f$;\n" +
          "SELECT cron.schedule('issue_9_tick','* * * * *',$cron$SELECT public.issue_9_tick();$cron$);\n",
      },
    ]),
    clean,
  );

  // GOOD-3: a trigger is a caller.
  expect(
    "GOOD trigger caller",
    analyze([
      READER,
      {
        file: "20270202000000_w.sql",
        sql:
          WRITER_SQL.replace("issue_9_reconcile_public_search", "issue_9_on_publish") +
          "CREATE TRIGGER issue_9_publish AFTER UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.issue_9_on_publish();\n",
      },
    ]),
    clean,
  );

  // M1: the #3197 defect itself — a reader and a parameterised door, no writer.
  expect("M1 no writer at all", analyze([READER]), has("A", "NO function ever writes"));

  // M2: a writer with no schedule.
  expect("M2 unscheduled writer", analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL }]),
    has("B", "writer issue_9_reconcile_public_search has no live cron or trigger caller"));

  // M3: the schedule is commented out.
  expect(
    "M3 commented-out schedule",
    analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL.split("\n").map((l) => `-- ${l}`).join("\n") }]),
    has("B", "issue_9_reconcile_public_search"),
  );

  // M4: scheduled, then literally unscheduled by a LATER migration.
  expect(
    "M4 later unschedule",
    analyze([
      READER,
      { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL },
      { file: "20270303000000_x.sql", sql: "SELECT cron.unschedule('issue_9_reconcile');\n" },
    ]),
    has("B", "issue_9_reconcile_public_search"),
  );

  // M5: cron calls a function that never writes; the writer sits uncalled.
  expect(
    "M5 cron calls a non-writer",
    analyze([
      READER,
      {
        file: "20270202000000_w.sql",
        sql:
          WRITER_SQL +
          "CREATE FUNCTION public.issue_9_noop() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\n" +
          "SELECT cron.schedule('issue_9_reconcile','* * * * *',$cron$SELECT public.issue_9_noop();$cron$);\n",
      },
    ]),
    has("B", "issue_9_reconcile_public_search"),
  );

  // M6: the only schedule lives in a test file.
  expect(
    "M6 schedule only in __tests__",
    analyze([
      READER,
      { file: "20270202000000_w.sql", sql: WRITER_SQL },
      { file: "__tests__/issue_9.test.sql", sql: SCHEDULE_SQL },
    ]),
    has("B", "issue_9_reconcile_public_search"),
  );

  // M7: an unregistered anon-executable reader filters the indexable state.
  expect(
    "M7 unregistered overlay",
    analyze([
      READER,
      { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL },
      {
        file: "20270303000000_y.sql",
        sql:
          "CREATE FUNCTION public.list_other_sitemap() RETURNS SETOF text LANGUAGE sql SECURITY DEFINER AS $f$ SELECT slug FROM public.other_overlay WHERE state = 'search_ready' $f$;\n" +
          "GRANT EXECUTE ON FUNCTION public.list_other_sitemap() TO anon;\n",
      },
    ]),
    has("E", "list_other_sitemap"),
  );

  // M8: registry emptied (anti-vacuity).
  expect("M8 empty registry", analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL }], []),
    has("registry", "empty"));

  // M9: the migration promotes at apply time — top-level INSERT, DO block, or
  //     calling the writer directly.
  expect(
    "M9a top-level INSERT",
    analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL + "INSERT INTO public.public_search_documents(lifecycle_state) VALUES ('search_ready');\n" }]),
    has("D", "top-level SQL INSERTs"),
  );
  expect(
    "M9b DO-block UPDATE",
    analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL + "DO $d$ BEGIN UPDATE public.public_search_documents SET lifecycle_state='search_ready'; END $d$;\n" }]),
    has("D", "a DO block UPDATEs"),
  );
  expect(
    "M9c writer executed at apply",
    analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL + "SELECT public.issue_9_reconcile_public_search();\n" }]),
    has("D", "executes promotion writer issue_9_reconcile_public_search"),
  );

  // M10: a role-named monitor with no caller.
  expect(
    "M10 unscheduled monitor",
    analyze([
      READER,
      {
        file: "20270202000000_w.sql",
        sql: WRITER_SQL + SCHEDULE_SQL +
          "CREATE FUNCTION public.issue_9_assert_public_search_converged() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\n",
      },
    ]),
    has("B", "role function issue_9_assert_public_search_converged"),
  );

  // M11: the reader was dropped.
  expect(
    "M11 reader dropped",
    analyze([READER, { file: "20270202000000_w.sql", sql: WRITER_SQL + SCHEDULE_SQL + "DROP FUNCTION public.list_public_search_sitemap();\n" }]),
    has("C", "list_public_search_sitemap"),
  );

  // M12: a writer mentioned only in a comment of the cron command body.
  expect(
    "M12 commented call inside cron command",
    analyze([
      READER,
      {
        file: "20270202000000_w.sql",
        sql: WRITER_SQL +
          "SELECT cron.schedule('issue_9_reconcile','* * * * *',$cron$SELECT 1; -- public.issue_9_reconcile_public_search()\n$cron$);\n",
      },
    ]),
    has("B", "issue_9_reconcile_public_search"),
  );

  // P-vacuous: empty input reports nothing parsed.
  const empty = replay([]);
  if (empty.files !== 0 || empty.scheduleCalls !== 0) failures.push("P-vacuous: empty input did not report zero");

  if (failures.length > 0) {
    console.error(`#3197 SELF-TEST FAILED:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(
    "#3197 self-test PASS (3 good trees: scheduled, transitive, trigger; 13 mutants caught: no writer, " +
      "unscheduled writer, commented-out schedule, later unschedule, cron calls a non-writer, schedule only " +
      "in a test file, unregistered overlay, empty registry, apply-time INSERT / DO-block UPDATE / direct " +
      "writer call, unscheduled monitor, dropped reader, commented call inside a cron command).",
  );
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const migrations = loadMigrations();
  const result = analyze(migrations);
  const r = result.replay;

  // P-vacuous: a gate that parsed nothing must fail.
  if (r.files === 0 || r.scheduleCalls === 0 || r.functions.size < 100) {
    console.error(
      `#3197: parsed ${r.files} migrations, ${r.scheduleCalls} cron.schedule calls and ${r.functions.size} ` +
        "functions. The SQL scanner is not measuring anything; refusing to pass.",
    );
    process.exit(1);
  }

  if (result.violations.length > 0) {
    console.error(
      "#3197: a public-search promotion path has no caller, or promotes at apply time.\n" +
        "A page is indexable only when a row in the overlay says so. If nothing scheduled ever\n" +
        "writes that row, every page serves noindex and the sitemap is empty — which is what\n" +
        "production did from 2026-09-01 until #3197. See I-3197-SEARCH-PROMOTION-HAS-A-CALLER in\n" +
        "docs/INVARIANT_REGISTRY.md and follow supabase/migrations/20270706003197_issue_3197_public_search_auto_promotion.sql.\n",
    );
    for (const v of result.violations) console.error(`  [${v.rule}] ${v.message}`);
    process.exit(1);
  }

  const lines = result.report.flatMap(({ surface, writers }) => [
    `  ${surface.table}.${surface.column}='${surface.indexableState}' (reader ${surface.reader}):`,
    ...writers.map((w) => `    writer ${w.name} <- ${w.caller}`),
  ]);
  console.log(
    `#3197 OK — ${r.files} migrations, ${r.functions.size} live functions, ${r.jobs.size} live cron jobs ` +
      `(${r.scheduleCalls} cron.schedule calls), ${result.roleFunctions.length} role-named function(s) all reachable.\n` +
      lines.join("\n"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { loadMigrations, MIGRATIONS_DIR };
