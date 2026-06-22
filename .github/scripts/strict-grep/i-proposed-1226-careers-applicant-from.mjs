#!/usr/bin/env node
/**
 * ORCH-1226 [careers applicant email from careers@usemingla.com] —
 * I-PROPOSED-1226-CAREERS-APPLICANT-FROM.
 *
 * WHY: the careers-apply edge fn sends TWO emails — (1) a confirmation to the
 * APPLICANT and (2) a notification to seth@usemingla.com. ORCH-1226 requires the
 * APPLICANT email to send FROM the careers identity (careers@usemingla.com,
 * display "Mingla Careers") with a careers Reply-To, while the seth@ NOTIFY
 * email is left UNTOUCHED. A revert that points the applicant sender back at the
 * generic notifications@/system sender, drops the careers Reply-To, or drops the
 * seth@ recipient must FAIL CI.
 *
 * ASSERTS (against supabase/functions/careers-apply/index.ts):
 *  1. the careers applicant identity address `careers@usemingla.com` appears
 *     (the applicant `from` / Reply-To carries it),
 *  2. the "Mingla Careers" display name appears,
 *  3. a Resend `reply_to` field carrying the careers address is set,
 *  4. the seth@usemingla.com notify recipient is STILL present (untouched),
 *  5. the applicant send call passes the CAREERS-derived `from`
 *     (`applicantFrom`) — NOT the system/notify sender — into buildApplicantEmail.
 *
 * `--self-test` proves FAIL-on-revert for each of those.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const FN = path.join(root, "supabase/functions/careers-apply/index.ts");

const CAREERS_ADDR = "careers@usemingla.com";
const CAREERS_NAME = "Mingla Careers";
const SETH = "seth@usemingla.com";

function check(src, failures) {
  // 1. careers address present somewhere (sender/reply-to/default).
  if (!src.includes(CAREERS_ADDR)) {
    failures.push(`careers address "${CAREERS_ADDR}" not found.`);
  }
  // 2. careers display name present.
  if (!src.includes(CAREERS_NAME)) {
    failures.push(`careers display name "${CAREERS_NAME}" not found.`);
  }
  // 3. a Resend reply_to carrying the careers address. Accept either a direct
  //    string `reply_to: "careers@usemingla.com"` or a `reply_to:` referencing a
  //    constant whose value is the careers address (CAREERS_REPLY_TO = "...").
  const directReply = new RegExp(
    `reply_to\\s*:\\s*["']${CAREERS_ADDR.replace(".", "\\.")}["']`,
  ).test(src);
  const constReply = /reply_to\s*:\s*CAREERS_REPLY_TO\b/.test(src) &&
    new RegExp(
      `CAREERS_REPLY_TO\\s*=\\s*["']${CAREERS_ADDR.replace(".", "\\.")}["']`,
    ).test(src);
  if (!directReply && !constReply) {
    failures.push(
      `applicant Resend payload must set reply_to to "${CAREERS_ADDR}".`,
    );
  }
  // 4. seth@ notify recipient still present (the notify email is untouched).
  if (!src.includes(SETH)) {
    failures.push(`seth notify recipient "${SETH}" missing — notify regressed.`);
  }
  // 5. the applicant send must pass a CAREERS-derived `from` (applicantFrom) into
  //    buildApplicantEmail — proving the applicant sender is NOT the generic
  //    notify/system sender. Comment-stripped to ignore documentation prose.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const applicantCall =
    /buildApplicantEmail\([^)]*\bapplicantFrom\b[^)]*\)/.test(codeOnly);
  if (!applicantCall) {
    failures.push(
      "buildApplicantEmail(...) must be called with the careers-derived `applicantFrom`.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good = `
const CAREERS_REPLY_TO = "careers@usemingla.com";
function resolveCareersSender() { return { name: "Mingla Careers", address: CAREERS_REPLY_TO }; }
return { from, to: [email], reply_to: CAREERS_REPLY_TO, subject, html, text };
to: ["seth@usemingla.com"],
const applicantFrom = formatSenderHeader(resolveCareersSender());
const applicant = await sendEmail(resendKey, buildApplicantEmail(app.full_name, posting.title, app.email, applicantFrom));
`;
  let f = [];
  check(good, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // Revert A: applicant sender back to the system/notify sender (drop applicantFrom).
  const revertSender = good.replace(
    "buildApplicantEmail(app.full_name, posting.title, app.email, applicantFrom)",
    "buildApplicantEmail(app.full_name, posting.title, app.email, notifyFrom)",
  );
  f = [];
  check(revertSender, f);
  if (f.length === 0) {
    self.push("reverting applicant `from` to notifyFrom was not flagged");
  }

  // Revert B: drop the careers reply_to from the applicant payload.
  const revertReply = good.replace(
    "reply_to: CAREERS_REPLY_TO, ",
    "",
  );
  f = [];
  check(revertReply, f);
  if (f.length === 0) self.push("dropping the careers reply_to was not flagged");

  // Revert C: point everything back to notifications@ (no careers address).
  const revertAddr = good.replaceAll("careers@usemingla.com", "notifications@usemingla.com");
  f = [];
  check(revertAddr, f);
  if (f.length === 0) self.push("removing the careers address was not flagged");

  // Revert D: drop the seth@ notify recipient.
  const revertSeth = good.replace('to: ["seth@usemingla.com"],', "");
  f = [];
  check(revertSeth, f);
  if (f.length === 0) self.push("dropping the seth@ notify recipient was not flagged");

  if (self.length) {
    console.error("ORCH-1226 careers-applicant-from self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1226 careers-applicant-from self-test PASS (5/5 cases).");
  process.exit(0);
}

if (!fs.existsSync(FN)) {
  console.error(`ORCH-1226 gate FAIL — careers-apply/index.ts not found at ${FN}.`);
  process.exit(1);
}
const failures = [];
check(fs.readFileSync(FN, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1226 I-PROPOSED-1226-CAREERS-APPLICANT-FROM FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1226 I-PROPOSED-1226-CAREERS-APPLICANT-FROM PASS — applicant email sends " +
    "from careers@usemingla.com (Mingla Careers) with careers Reply-To; seth@ notify intact.",
);
