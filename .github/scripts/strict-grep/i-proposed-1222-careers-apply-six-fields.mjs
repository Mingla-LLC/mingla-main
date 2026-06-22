#!/usr/bin/env node
/**
 * META-ORCH-1222 [Careers site] — I-PROPOSED-1222-APPLY-VALIDATES-ALL-SIX.
 *
 * WHY: the careers-apply edge fn is the security/validation authority (the
 * client form is UX-only). It MUST server-validate all six required fields +
 * the CV, each pushing its own name onto the `fields[]` reject path. Deleting
 * any one field's server check would let bad/empty data through.
 *
 * ASSERTS: careers-apply/index.ts contains a `fields.push("<name>")` reject path
 * for EACH of: full_name, email, whatsapp_phone, preferred_salary,
 * portfolio_url, cv, AND the job_slug binding push.
 *
 * `--self-test` proves FAIL-on-revert (any field's reject path deleted).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const FN = path.join(root, "supabase/functions/careers-apply/index.ts");

const REQUIRED_PUSHES = [
  "full_name",
  "email",
  "whatsapp_phone",
  "preferred_salary",
  "portfolio_url",
  "cv",
  "job_slug",
];

function check(src, failures) {
  for (const f of REQUIRED_PUSHES) {
    // fields.push("x")
    const pushRe = new RegExp(`fields\\.push\\(\\s*["']${f}["']\\s*\\)`);
    // Or a literal array reject for the role-binding: fields: ["job_slug"]
    const arrRe = new RegExp(`fields\\s*:\\s*\\[\\s*["']${f}["']\\s*\\]`);
    if (!pushRe.test(src) && !arrRe.test(src)) {
      failures.push(`missing server reject path for "${f}".`);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good = REQUIRED_PUSHES
    .map((f) => (f === "job_slug" ? `return { fields: ["${f}"] };` : `fields.push("${f}");`))
    .join("\n");
  let f = [];
  check(good, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // Drop the preferred_salary check → MUST fire.
  const bad = good.replace('fields.push("preferred_salary");', "");
  f = [];
  check(bad, f);
  if (f.length === 0) self.push("deleted preferred_salary check not flagged");

  // Drop the cv check → MUST fire.
  const badCv = good.replace('fields.push("cv");', "");
  f = [];
  check(badCv, f);
  if (f.length === 0) self.push("deleted cv check not flagged");

  if (self.length) {
    console.error("ORCH-1222 apply-six-fields self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1222 apply-six-fields self-test PASS (3/3 cases).");
  process.exit(0);
}

if (!fs.existsSync(FN)) {
  console.error(`ORCH-1222 gate FAIL — careers-apply/index.ts not found at ${FN}.`);
  process.exit(1);
}
const failures = [];
check(fs.readFileSync(FN, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1222 I-PROPOSED-1222-APPLY-VALIDATES-ALL-SIX FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1222 I-PROPOSED-1222-APPLY-VALIDATES-ALL-SIX PASS — all six fields + CV " +
    "+ job_slug have a server reject path.",
);
