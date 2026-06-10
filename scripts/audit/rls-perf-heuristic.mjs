#!/usr/bin/env node
/**
 * #426 PR4 — RLS performance heuristic.
 *
 * Flags bare auth.uid() in CREATE POLICY statements. Supabase recommends
 * (select auth.uid()) for initplan caching on high-traffic tables.
 *
 * Default: warn-only (exit 0). Use --strict to fail CI.
 *
 * Usage:
 *   node scripts/audit/rls-perf-heuristic.mjs
 *   node scripts/audit/rls-perf-heuristic.mjs --self-test
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EXIT,
  listMigrationSqlFiles,
  parseArgs,
  reportViolations,
} from "./_shared.mjs";

/** Load-profile hot tables — strict mode fails only on these. */
const HOT_TABLES = new Set([
  "agent_conversations",
  "agent_messages",
  "agent_pending_actions",
  "ticket_checkout_sessions",
  "orders",
  "tickets",
  "events",
  "event_dates",
]);

const POLICY_LINE_RE =
  /CREATE\s+POLICY|^\s+ON\s+public\."([^"]+)"|^\s+ON\s+public\.(\w+)/i;
const BARE_AUTH_UID_RE = /(?<!\(select\s)auth\.uid\(\)/i;
const CACHED_AUTH_UID_RE = /\(select\s+auth\.uid\(\)\)/i;

function scanMigrations(files) {
  const findings = [];

  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    const lines = sql.split("\n");
    let currentTable = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const onMatch = line.match(/^\s+ON\s+public\."([^"]+)"/i)
        ?? line.match(/^\s+ON\s+public\.(\w+)/i);
      if (onMatch) {
        currentTable = onMatch[1] ?? onMatch[2];
      }
      if (/CREATE\s+POLICY/i.test(line)) {
        currentTable = null;
      }
      if (!BARE_AUTH_UID_RE.test(line)) continue;
      if (CACHED_AUTH_UID_RE.test(line)) continue;

      const table = currentTable ?? "unknown";
      findings.push({
        file,
        line: i + 1,
        table,
        hot: HOT_TABLES.has(table),
        text: line.trim(),
      });
    }
  }
  return findings;
}

function runAudit(files, { strict, hotOnly }) {
  const findings = scanMigrations(files);
  const filtered = hotOnly
    ? findings.filter((f) => f.hot)
    : findings;

  if (filtered.length === 0) {
    console.log("PASS: no bare auth.uid() in RLS policies");
    return EXIT.OK;
  }

  console.warn(`WARN: ${filtered.length} bare auth.uid() in RLS policy line(s)`);
  for (const f of filtered.slice(0, 30)) {
    const tag = f.hot ? "[hot]" : "";
    console.warn(`  ${tag} ${f.file.split("/").pop()}:${f.line} (${f.table})`);
  }
  if (filtered.length > 30) {
    console.warn(`  … and ${filtered.length - 30} more`);
  }
  console.warn("Fix: use (select auth.uid()) — see docs/db-hot-queries.md");

  if (strict) {
    return reportViolations(
      "bare auth.uid() in RLS policies (--strict)",
      filtered.map((f) => `${f.file}:${f.line}`),
    );
  }
  return EXIT.OK;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "rls-perf-"));
  const migDir = join(dir, "supabase", "migrations");
  mkdirSync(migDir, { recursive: true });

  writeFileSync(
    join(migDir, "001_test.sql"),
    `
CREATE POLICY "bad" ON public.agent_messages FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "good" ON public.agent_messages FOR SELECT
  USING (user_id = (select auth.uid()));
`,
  );

  const files = [join(migDir, "001_test.sql")];
  const findings = scanMigrations(files);
  const bad = findings.filter((f) => f.text.includes("user_id = auth.uid()"));
  const good = findings.filter((f) => f.text.includes("(select auth.uid())"));
  rmSync(dir, { recursive: true, force: true });

  if (bad.length !== 1 || good.length !== 0) {
    console.error("FAIL: self-test expected 1 bare auth.uid() finding");
    process.exit(EXIT.ERROR);
  }
  console.log("PASS: rls-perf-heuristic self-test");
  process.exit(EXIT.OK);
}

function main() {
  const { selfTest: isSelfTest } = parseArgs(process.argv);
  if (isSelfTest) selfTest();

  const strict = process.argv.includes("--strict");
  const hotOnly = process.argv.includes("--hot-only");
  const files = listMigrationSqlFiles();
  const code = runAudit(files, { strict, hotOnly });
  process.exit(code);
}

main();
