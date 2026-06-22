#!/usr/bin/env node
/**
 * META-ORCH-1221 [Careers site] — I-PROPOSED-1221-ADMIN-WRITES-GATED (ADDENDUM
 * D-1 regression delta).
 *
 * WHY: D-1 added admin CRUD for job_postings. The requirement is that admin
 * writes go through is_admin_user()-gated SECURITY DEFINER RPCs ONLY — the table
 * itself must stay write-locked (NO broad `to anon`/`to authenticated` RLS
 * INSERT/UPDATE/DELETE/ALL policy on job_postings). Opening a broad write policy
 * would let any authenticated user (not just admins) mutate postings.
 *
 * ASSERTS (Migration A):
 *   (1) the admin write RPCs (admin_careers_upsert_posting +
 *       admin_careers_set_posting_status) are present AND each calls
 *       is_admin_user() (the gate).
 *   (2) NO permissive job_postings policy `for insert|update|delete|all ... to
 *       anon|authenticated` exists (the public-read open-only SELECT policy is
 *       the ONLY policy on the table).
 *
 * `--self-test` proves FAIL-on-revert (un-gated RPC / broad write policy).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MIGRATION = path.join(
  root,
  "supabase/migrations/20261126000001_orch_1221_careers_postings_applications.sql",
);

const WRITE_RPCS = [
  "admin_careers_upsert_posting",
  "admin_careers_set_posting_status",
];

function check(src, failures) {
  for (const rpc of WRITE_RPCS) {
    const defRe = new RegExp(
      `create\\s+(or\\s+replace\\s+)?function\\s+public\\.${rpc}\\b`,
      "i",
    );
    if (!defRe.test(src)) {
      failures.push(`admin write RPC ${rpc} is missing.`);
      continue;
    }
    // The RPC body must contain an is_admin_user() gate.
    const slice = src.slice(src.search(defRe));
    const end = slice.search(/\$\$;/);
    const body = end > 0 ? slice.slice(0, end) : slice;
    if (!/is_admin_user\s*\(\s*\)/i.test(body)) {
      failures.push(`admin write RPC ${rpc} does not gate on is_admin_user().`);
    }
  }
  // No broad write policy on job_postings (only the open-only SELECT is allowed).
  const broadWriteRe =
    /create\s+policy[\s\S]*?on\s+public\.job_postings\s+for\s+(insert|update|delete|all)[\s\S]*?to\s+(anon|authenticated)/i;
  if (broadWriteRe.test(src)) {
    failures.push(
      "a broad write policy (insert/update/delete/all) on job_postings grants " +
        "anon/authenticated — admin writes must go through gated RPCs only.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const gatedUpsert =
    "create function public.admin_careers_upsert_posting(p_id uuid) returns void " +
    "language plpgsql security definer as $$ begin if not public.is_admin_user() " +
    "then raise exception 'forbidden'; end if; end; $$;\n";
  const ungatedUpsert =
    "create function public.admin_careers_upsert_posting(p_id uuid) returns void " +
    "language plpgsql security definer as $$ begin end; $$;\n";
  const gatedStatus =
    "create function public.admin_careers_set_posting_status(p_id uuid, p_status text) " +
    "returns void language plpgsql security definer as $$ begin if not " +
    "public.is_admin_user() then raise exception 'forbidden'; end if; end; $$;\n";

  const good = gatedUpsert + gatedStatus;
  let f = [];
  check(good, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // Un-gate the upsert RPC → MUST fire.
  const badUngated = ungatedUpsert + gatedStatus;
  f = [];
  check(badUngated, f);
  if (f.length === 0) self.push("un-gated upsert RPC not flagged");

  // Add a broad write policy → MUST fire.
  const badPolicy = good +
    "\ncreate policy \"w\" on public.job_postings for all to authenticated using (true);";
  f = [];
  check(badPolicy, f);
  if (f.length === 0) self.push("broad authenticated write policy not flagged");

  if (self.length) {
    console.error("ORCH-1221 admin-writes-gated self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1221 admin-writes-gated self-test PASS (3/3 cases).");
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
    "ORCH-1221 I-PROPOSED-1221-ADMIN-WRITES-GATED FAIL:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1221 I-PROPOSED-1221-ADMIN-WRITES-GATED PASS — job_postings admin writes " +
    "go through is_admin_user()-gated RPCs; no broad write policy.",
);
