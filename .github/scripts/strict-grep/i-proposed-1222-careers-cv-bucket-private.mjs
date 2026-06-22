#!/usr/bin/env node
/**
 * META-ORCH-1222 [Careers site] — I-PROPOSED-1222-CV-BUCKET-PRIVATE.
 *
 * WHY: CVs are private PII. The career-cvs bucket MUST be created private
 * (public=false) with the 5 MB cap + the PDF/DOC/DOCX mime allowlist, and there
 * must be NO anon/authenticated storage.objects policy for it (reads happen via
 * a service-role-issued signed URL only). Flipping it public, widening the mime
 * list, or adding a client policy would leak CVs.
 *
 * ASSERTS (Migration A):
 *   (1) the career-cvs bucket insert sets `false` (private) + `5242880` (5 MB).
 *   (2) the 3 allowed mimes are present (pdf, msword, wordprocessingml.document).
 *   (3) NO `create policy ... career-cvs ... to anon|authenticated` storage policy.
 *
 * `--self-test` proves FAIL-on-revert (public flip / widened mime / anon policy).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MIGRATION = path.join(
  root,
  "supabase/migrations/20261126000001_orch_1222_careers_postings_applications.sql",
);

function check(src, failures) {
  // The bucket insert row: 'career-cvs','career-cvs', false, 5242880, ...
  const bucketRe =
    /['"]career-cvs['"]\s*,\s*['"]career-cvs['"]\s*,\s*false\s*,\s*5242880/i;
  if (!bucketRe.test(src)) {
    failures.push(
      "career-cvs bucket is NOT created private (false) with the 5242880 (5 MB) " +
        "limit — bucket must be sealed.",
    );
  }
  for (const mime of [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]) {
    if (!src.includes(mime)) {
      failures.push(`career-cvs mime allowlist is missing ${mime}.`);
    }
  }
  // No storage.objects policy that grants anon/authenticated access to
  // career-cvs. We scan each `create policy ... ;` STATEMENT individually (split
  // on the statement terminator) so the lazy match cannot span unrelated
  // statements (e.g. the job_postings open-read policy + the far-away bucket
  // insert). Within a single statement, career-cvs may appear before or after
  // the `to anon|authenticated` clause.
  const statements = src.split(";");
  for (const stmt of statements) {
    if (!/create\s+policy/i.test(stmt)) continue;
    if (!/career-cvs/i.test(stmt)) continue;
    if (/to\s+(anon|authenticated)/i.test(stmt)) {
      failures.push(
        "a storage policy grants anon/authenticated access to career-cvs — the " +
          "bucket must stay sealed (service-role only).",
      );
      break;
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good =
    "insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values (" +
    "'career-cvs','career-cvs', false, 5242880, array['application/pdf'," +
    "'application/msword'," +
    "'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);";
  let f = [];
  check(good, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  const badPublic = good.replace("false, 5242880", "true, 5242880");
  f = [];
  check(badPublic, f);
  if (f.length === 0) self.push("public=true flip not flagged");

  const badPolicy = good +
    "\ncreate policy \"leak\" on storage.objects for select to anon using (bucket_id = 'career-cvs');";
  f = [];
  check(badPolicy, f);
  if (f.length === 0) self.push("anon storage policy on career-cvs not flagged");

  if (self.length) {
    console.error("ORCH-1222 cv-bucket-private self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1222 cv-bucket-private self-test PASS (3/3 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATION)) {
  console.error(`ORCH-1222 gate FAIL — migration not found at ${MIGRATION}.`);
  process.exit(1);
}
const failures = [];
check(fs.readFileSync(MIGRATION, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1222 I-PROPOSED-1222-CV-BUCKET-PRIVATE FAIL:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1222 I-PROPOSED-1222-CV-BUCKET-PRIVATE PASS — career-cvs private, 5 MB, " +
    "PDF/DOC/DOCX only, no client policy.",
);
