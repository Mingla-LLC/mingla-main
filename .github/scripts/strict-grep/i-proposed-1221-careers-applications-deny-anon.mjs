#!/usr/bin/env node
/**
 * META-ORCH-1221 [Careers site] —
 * I-PROPOSED-1221-APPLICATIONS-DENY-ANON.
 *
 * WHY: job_applications carries PII (name, email, phone, CV path). The public
 * marketing site is unauthenticated. The table MUST have RLS enabled and NO
 * permissive `to anon` / `to public` policy — reads go ONLY through the
 * is_admin_user()-gated SD RPC; inserts ONLY via the service-role edge fn.
 *
 * ASSERTS (Migration A, structural fence):
 *   (1) `alter table public.job_applications enable row level security;` present.
 *   (2) NO `create policy ... on public.job_applications ... to anon` and
 *       NO `... to public` (a permissive anon/public policy would expose PII).
 *
 * `--self-test` proves FAIL-on-revert: an anon SELECT policy on the table fires.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MIGRATION = path.join(
  root,
  "supabase/migrations/20261126000001_orch_1221_careers_postings_applications.sql",
);

function check(src, failures) {
  const lower = src.toLowerCase();
  if (
    !/alter\s+table\s+public\.job_applications\s+enable\s+row\s+level\s+security/i.test(src)
  ) {
    failures.push("RLS is NOT enabled on public.job_applications.");
  }
  // Find any create-policy block targeting job_applications with to anon/public.
  const policyRe =
    /create\s+policy[\s\S]*?on\s+public\.job_applications[\s\S]*?to\s+(anon|public)/gi;
  if (policyRe.test(lower)) {
    failures.push(
      "A permissive `to anon`/`to public` policy on job_applications was found — " +
        "PII must be deny-by-default (admin reads via the gated RPC only).",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good =
    "alter table public.job_applications enable row level security;\n" +
    "-- no permissive policy; admin reads via admin_job_applications_list()\n";
  let f = [];
  check(good, f);
  if (f.length !== 0) self.push("good fixture wrongly flagged: " + f.join("; "));

  const badNoRls = "-- forgot to enable RLS on job_applications\n";
  f = [];
  check(badNoRls, f);
  if (f.length === 0) self.push("missing RLS-enable not flagged");

  const badAnonPolicy =
    "alter table public.job_applications enable row level security;\n" +
    'create policy "leak" on public.job_applications for select to anon using (true);\n';
  f = [];
  check(badAnonPolicy, f);
  if (f.length === 0) self.push("anon SELECT policy on job_applications not flagged");

  if (self.length) {
    console.error("ORCH-1221 applications-deny-anon self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1221 applications-deny-anon self-test PASS (3/3 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATION)) {
  console.error(`ORCH-1221 gate FAIL — migration not found at ${MIGRATION}.`);
  process.exit(1);
}
const failures = [];
check(fs.readFileSync(MIGRATION, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1221 I-PROPOSED-1221-APPLICATIONS-DENY-ANON FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1221 I-PROPOSED-1221-APPLICATIONS-DENY-ANON PASS — job_applications RLS " +
    "enabled, no permissive anon/public policy.",
);
