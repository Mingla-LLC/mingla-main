#!/usr/bin/env node
/**
 * META-ORCH-1222 [Careers site] — I-PROPOSED-1222-POSTINGS-PUBLIC-OPEN-ONLY.
 *
 * WHY: the public careers site must only expose OPEN roles. The only anon-SELECT
 * policy on job_postings MUST be `using (status = 'open')`, and the public read
 * lib MUST filter `status=eq.open`. Broadening either would leak draft/closed
 * roles to the public.
 *
 * ASSERTS:
 *   (1) Migration A defines an anon-readable job_postings select policy whose
 *       USING clause is `status = 'open'`.
 *   (2) lib/careers-data.ts filters `status=eq.open` in BOTH list + single reads.
 *
 * `--self-test` proves FAIL-on-revert (broadened policy / dropped filter).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MIGRATION = path.join(
  root,
  "supabase/migrations/20261126000001_orch_1222_careers_postings_applications.sql",
);
const DATA_LIB = path.join(root, "mingla-marketing/lib/careers-data.ts");

function checkMigration(src, failures) {
  // The job_postings select policy must use status = 'open'.
  const policyBlockRe =
    /create\s+policy[\s\S]*?on\s+public\.job_postings\s+for\s+select[\s\S]*?using\s*\(\s*status\s*=\s*'open'\s*\)/i;
  if (!policyBlockRe.test(src)) {
    failures.push(
      "job_postings anon-select policy is NOT `using (status = 'open')` " +
        "(draft/closed roles could leak publicly).",
    );
  }
}

function checkDataLib(src, failures) {
  const occurrences = (src.match(/status=eq\.open/g) || []).length;
  if (occurrences < 2) {
    failures.push(
      "careers-data.ts must filter `status=eq.open` in BOTH listOpenRoles + " +
        `getOpenRoleBySlug (found ${occurrences}).`,
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  let f = [];
  checkMigration(
    "create policy \"x\" on public.job_postings for select to anon using (status = 'open');",
    f,
  );
  if (f.length) self.push("good policy wrongly flagged");

  f = [];
  checkMigration(
    "create policy \"x\" on public.job_postings for select to anon using (true);",
    f,
  );
  if (!f.length) self.push("broadened `using (true)` policy not flagged");

  f = [];
  checkDataLib("a status=eq.open b\n c status=eq.open d", f);
  if (f.length) self.push("two-filter data lib wrongly flagged");

  f = [];
  checkDataLib("only one status=eq.open here", f);
  if (!f.length) self.push("single/zero filter data lib not flagged");

  if (self.length) {
    console.error("ORCH-1222 postings-open-only self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1222 postings-open-only self-test PASS (4/4 cases).");
  process.exit(0);
}

const failures = [];
if (!fs.existsSync(MIGRATION)) failures.push(`migration missing at ${MIGRATION}`);
else checkMigration(fs.readFileSync(MIGRATION, "utf8"), failures);
if (!fs.existsSync(DATA_LIB)) failures.push(`careers-data.ts missing at ${DATA_LIB}`);
else checkDataLib(fs.readFileSync(DATA_LIB, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1222 I-PROPOSED-1222-POSTINGS-PUBLIC-OPEN-ONLY FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1222 I-PROPOSED-1222-POSTINGS-PUBLIC-OPEN-ONLY PASS — policy + lib both " +
    "restrict to status='open'.",
);
