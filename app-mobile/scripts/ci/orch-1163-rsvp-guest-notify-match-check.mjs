#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-GUEST-NOTIFY-EMAIL-PUSH
 *                              + I-PROPOSED-1163-MATCHED-GUEST-CALENDAR.
 *
 * On a going RSVP, public-submit-rsvp ENQUEUES/DISPATCHES one `rsvp_pass` per
 * recipient (idempotency key `rsvp_pass:...`) and hands the actual email/push to the
 * EXISTING rsvp-notify edge fn — it spins up NO new email client (no `new Resend(`,
 * no raw api.onesignal.com POST). rsvp-notify owns the `rsvp_pass` branch: it calls
 * the existing sendPush() and reuses _shared/ticketPdf to attach the entry QR.
 * Verified-account matching reads auth.identities (email_verified) + phone_confirmed_at
 * — NEVER user_metadata/raw_user_meta_data. The matched guest sees the going RSVP in
 * their own Calendar (fetch_user_going_rsvps returns 'primary' AND 'guest' rows).
 *
 * Structural source-string gate. FAIL-ON-REVERT: introduce a new email client, drop
 * the rsvp_pass branch / sendPush / ticketPdf reuse, read user_metadata in the
 * resolver, or drop a UNION role and a check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};
// Strip SQL (-- ...) + JS (// , /* */) comments so absence checks bind to CODE, not
// prose. The resolver's promise is "NEVER reads user_metadata" — a comment that
// merely *names* it must not satisfy (nor break) the check.
const stripSql = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const submitFn = read("supabase/functions/public-submit-rsvp/index.ts");
const notifyFn = read("supabase/functions/rsvp-notify/index.ts");
const mig = read(
  "supabase/migrations/20261016000001_orch_1163_event_rsvp_guests.sql",
);
const migCode = stripSql(mig);
const submitCode = stripJs(submitFn);

check(
  "T1 public-submit-rsvp enqueues/dispatches rsvp_pass with idempotency key pattern",
  submitFn.includes("rsvp_pass") && /rsvp_pass:/.test(submitFn),
  "public-submit-rsvp/index.ts must enqueue rsvp_pass with a `rsvp_pass:` idempotency key",
);
check(
  "T2 public-submit-rsvp invokes the existing rsvp-notify (delegated send)",
  submitFn.includes("rsvp-notify"),
  "public-submit-rsvp/index.ts must invoke the existing rsvp-notify fn",
);
check(
  "T3 public-submit-rsvp spins up NO new email client (no new Resend / raw onesignal)",
  !/new\s+Resend\s*\(/.test(submitCode) &&
    !/api\.onesignal\.com/.test(submitCode),
  "public-submit-rsvp/index.ts must NOT instantiate a new email client or POST to api.onesignal.com",
);
check(
  "T4 rsvp-notify owns an rsvp_pass branch",
  /rsvp_pass/.test(notifyFn) &&
    /(template_key\s*===\s*["']rsvp_pass["']|case\s+["']rsvp_pass["'])/.test(
      notifyFn,
    ),
  "rsvp-notify/index.ts must branch on the rsvp_pass template",
);
check(
  "T5 rsvp-notify reuses the existing sendPush()",
  /sendPush\s*\(/.test(notifyFn),
  "rsvp-notify/index.ts must call the existing sendPush()",
);
check(
  "T6 rsvp-notify reuses _shared/ticketPdf for the QR pass",
  /_shared\/ticketPdf/.test(notifyFn),
  "rsvp-notify/index.ts must reuse _shared/ticketPdf (or qrPayloadAsPngBytes) for the QR",
);
check(
  "T7 biz_resolve_verified_user reads auth.identities + email_verified + phone_confirmed_at",
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.biz_resolve_verified_user\b/.test(
    mig,
  ) &&
    /auth\.identities/.test(migCode) &&
    /email_verified/.test(migCode) &&
    /phone_confirmed_at/.test(migCode),
  "biz_resolve_verified_user must resolve via auth.identities (email_verified) + phone_confirmed_at",
);
check(
  "T8 the resolver NEVER reads user_metadata / raw_user_meta_data (code, not comments)",
  !/raw_user_meta_data/.test(migCode) && !/user_metadata/.test(migCode),
  "the migration code must not reference user_metadata / raw_user_meta_data (comments are stripped)",
);
check(
  "T9 fetch_user_going_rsvps returns BOTH 'primary' and 'guest' role rows",
  /'primary'/.test(mig) && /'guest'/.test(mig),
  "fetch_user_going_rsvps must UNION 'primary' and 'guest' role rows (matched-guest calendar)",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-guest-notify-match gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-guest-notify-match gate: PASS");
