#!/usr/bin/env node
// Issue #4423 Wave 4b: generate the static ALTER POLICY migrations that wrap
// per-row auth.uid() / auth.jwt() / auth.role() / auth.email() /
// current_setting() calls in a scalar sub-select, so Postgres evaluates them
// once per statement (an InitPlan) instead of once per row.
//
// The output is plain static SQL (the #1860 RLS gate refuses dynamic EXECUTE).
// Only the call is wrapped; roles, command, permissive/restrictive and every
// other token of USING / WITH CHECK are left exactly as pg_policies prints them.
//
// Re-run (read-only) to check the committed migrations:
//   1. Dump policies as JSON with this query (production is the source of truth):
//        select coalesce(json_agg(x), '[]') from (
//          select schemaname, tablename, policyname, permissive,
//                 roles::text[] as roles, cmd, qual, with_check
//            from pg_policies order by 1, 2, 3) x;
//   2. node scripts/db/issue-4423-rls-initplan.mjs policies.json out/
//   3. diff out/*.sql supabase/migrations/2028070533*4423_*.sql (and 30, 31, 32)
//
// Only the public schema is rewritten: storage.* and realtime.* tables are
// owned by platform roles that migrations cannot ALTER.
//
// It also writes out/batchN.expected.sql, the VALUES rows the pg17 parity
// suites pin (command, mode, roles and the original USING / WITH CHECK text).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CALL = /^auth\.(uid|jwt|role|email)\(\)/;

function endOfCall(s, i, open) {
  let j = i + open.length;
  let depth = 1;
  let inq = false;
  while (j < s.length) {
    const ch = s[j];
    if (inq) {
      if (ch === "'") {
        if (s[j + 1] === "'") { j += 2; continue; }
        inq = false;
      }
    } else if (ch === "'") inq = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  throw new Error(`unbalanced call at ${i}: ${s.slice(i, i + 80)}`);
}

function alreadyWrapped(prefix) {
  return /SELECT $/i.test(prefix);
}

/** Wrap every bare call; calls already inside `SELECT <call>` are left alone. */
export function wrap(expr) {
  if (expr == null) return expr;
  let out = "";
  let i = 0;
  let inq = false;
  while (i < expr.length) {
    const ch = expr[i];
    if (inq) {
      out += ch;
      if (ch === "'") {
        if (expr[i + 1] === "'") { out += "'"; i += 2; continue; }
        inq = false;
      }
      i += 1;
      continue;
    }
    if (ch === "'") { inq = true; out += ch; i += 1; continue; }
    const rest = expr.slice(i);
    const m = CALL.exec(rest);
    if (m && !/[\w.]$/.test(expr.slice(0, i))) {
      out += alreadyWrapped(expr.slice(0, i)) ? m[0] : `( SELECT ${m[0]} AS ${m[1]})`;
      i += m[0].length;
      continue;
    }
    if (rest.startsWith("current_setting(") && !/[\w.]$/.test(expr.slice(0, i))) {
      const e = endOfCall(expr, i, "current_setting(");
      const call = expr.slice(i, e);
      out += alreadyWrapped(expr.slice(0, i)) ? call : `( SELECT ${call} AS current_setting)`;
      i = e;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The inverse used by the mechanical check: strip exactly the wrappers wrap() adds. */
export function unwrap(expr) {
  if (expr == null) return expr;
  let s = expr.replace(/\( SELECT (auth\.(?:uid|jwt|role|email)\(\)) AS (?:uid|jwt|role|email)\)/g, "$1");
  let out = "";
  let i = 0;
  const key = "( SELECT current_setting(";
  while (i < s.length) {
    if (s.startsWith(key, i)) {
      const k = i + "( SELECT ".length;
      const e = endOfCall(s, k, "current_setting(");
      if (s.startsWith(" AS current_setting)", e)) {
        out += s.slice(k, e);
        i = e + " AS current_setting)".length;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

export function needsRewrite(p) {
  return p.schemaname === "public" && (wrap(p.qual) !== p.qual || wrap(p.with_check) !== p.with_check);
}

export function batchOf(table) {
  if (/^(message|conversation|notification|team_)/.test(table)) return 1;
  if (/^(profiles$|user_)/.test(table)) return 2;
  if (/^(order|event|ticket|brand)/.test(table)) return 3;
  return 4;
}

const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const lit = (s) => (s == null ? "null" : `'${s.replace(/'/g, "''")}'`);

export function alterPolicy(p) {
  const parts = [`ALTER POLICY ${ident(p.policyname)} ON public.${ident(p.tablename)}`];
  if (p.qual != null) parts.push(`  USING (${wrap(p.qual)})`);
  if (p.with_check != null) parts.push(`  WITH CHECK (${wrap(p.with_check)})`);
  return parts.join("\n") + ";";
}

export const BATCH_FILES = {
  1: "20280705304423_issue_4423_w4b_rls_batch1_messaging.sql",
  2: "20280705314423_issue_4423_w4b_rls_batch2_profiles_social.sql",
  3: "20280705324423_issue_4423_w4b_rls_batch3_commerce.sql",
  4: "20280705334423_issue_4423_w4b_rls_batch4_rest.sql",
};
const BATCH_TITLE = {
  1: "messaging, conversations, notifications and team tables",
  2: "profiles and user_* tables",
  3: "orders, events, tickets and brands",
  4: "every other public table",
};

export function generate(policies) {
  const rows = policies.filter(needsRewrite).sort((a, b) =>
    a.tablename.localeCompare(b.tablename) || a.policyname.localeCompare(b.policyname));
  const out = {};
  for (const n of [1, 2, 3, 4]) {
    const mine = rows.filter((p) => batchOf(p.tablename) === n);
    const tables = new Set(mine.map((p) => p.tablename));
    const sql = [
      `-- Issue #4423 Wave 4b batch ${n}: ${BATCH_TITLE[n]}.`,
      `-- ${mine.length} policies on ${tables.size} tables. Generated by`,
      "-- scripts/db/issue-4423-rls-initplan.mjs from production pg_policies.",
      "--",
      "-- Each policy keeps its roles, command and permissive/restrictive mode",
      "-- (ALTER POLICY changes only the clauses it names). In USING / WITH CHECK",
      "-- the only change is that each auth.*() / current_setting() call is",
      "-- wrapped as a scalar sub-select, which Postgres evaluates once per",
      "-- statement instead of once per row. Same value, same rows.",
      "-- Rollback: the same ALTER POLICY with the original expressions.",
      "",
      "BEGIN;",
      "-- Names resolve exactly as they did when pg_policies printed them.",
      "SET LOCAL search_path = public;",
      "",
      ...mine.map((p) => alterPolicy(p) + "\n"),
      "COMMIT;",
      "",
    ].join("\n");
    const expected = mine.map((p) =>
      `  (${lit(p.tablename)}, ${lit(p.policyname)}, ${lit(p.cmd)}, ${lit(p.permissive)}, ${lit(p.roles.join(","))}, ` +
      `${lit(p.qual)}, ${lit(p.with_check)})`).join(",\n");
    const rollback = [
      `-- Rollback for ${BATCH_FILES[n]}: the original expressions.`,
      "BEGIN;",
      "SET LOCAL search_path = public;",
      ...mine.map((p) => {
        const parts = [`ALTER POLICY ${ident(p.policyname)} ON public.${ident(p.tablename)}`];
        if (p.qual != null) parts.push(`  USING (${p.qual})`);
        if (p.with_check != null) parts.push(`  WITH CHECK (${p.with_check})`);
        return parts.join("\n") + ";";
      }),
      "COMMIT;",
      "",
    ].join("\n");
    out[n] = { file: BATCH_FILES[n], sql, expected, rollback, count: mine.length, tables: [...tables] };
  }
  return out;
}


if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [input, outdir] = process.argv.slice(2);
  if (!input || !outdir) {
    console.error("usage: issue-4423-rls-initplan.mjs <policies.json> <outdir>");
    process.exit(2);
  }
  const policies = JSON.parse(readFileSync(input, "utf8"));
  for (const p of policies) {
    if (unwrap(wrap(p.qual)) !== unwrap(p.qual) || unwrap(wrap(p.with_check)) !== unwrap(p.with_check)) {
      throw new Error(`round trip failed for ${p.tablename}.${p.policyname}`);
    }
  }
  mkdirSync(outdir, { recursive: true });
  const res = generate(policies);
  let total = 0;
  for (const n of [1, 2, 3, 4]) {
    writeFileSync(join(outdir, res[n].file), res[n].sql);
    writeFileSync(join(outdir, `batch${n}.expected.sql`), res[n].expected + "\n");
    writeFileSync(join(outdir, `batch${n}.rollback.sql`), res[n].rollback);
    writeFileSync(join(outdir, `batch${n}.tables.json`), JSON.stringify(res[n].tables));
    total += res[n].count;
    console.log(`batch ${n}: ${res[n].count} policies on ${res[n].tables.length} tables -> ${res[n].file}`);
  }
  console.log(`total ${total}`);
}
