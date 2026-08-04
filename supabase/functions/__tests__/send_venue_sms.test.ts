// META-ORCH-1148 sub-ORCH 2.1b — send-venue-sms edge fn source contract test.
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/send_venue_sms.test.ts
//
// Source-level contract regression (the repo convention — no live edge harness
// in the worktree). Pins the invariants that would FAIL on revert:
//   - SMS-FROM-APPROVED-TOLLFREE-ONLY: sends ONLY via the Messaging Service SID
//     (the approved toll-free); NEVER a raw `From` number.
//   - SMS-OPT-OUT-HONORED: checks venue_sms_opt_out BEFORE sending; skips on a
//     global (brand_id NULL) or per-brand opt-out; persists the 21610 blacklist.
//   - LOCKED COPY: the exact "Your table's ready at {VenueName}. Reply STOP to
//     opt out." string, with no link.
//   - E.164 validation before send.
//   - Twilio creds read from Deno env (NEVER hardcoded).
//   - manager-plus brand gate.

import { assert, assertMatch } from "jsr:@std/assert@1";

const SRC = Deno.readTextFileSync(
  "supabase/functions/send-venue-sms/index.ts",
);

Deno.test("T-SMS-1 — the LOCKED copy is exact, with no link", () => {
  assertMatch(
    SRC,
    /Your table's ready at \$\{venueName\}\. Reply STOP to opt out\./,
    "the locked table-ready copy must be present verbatim",
  );
  // No URL in the SMS body builder.
  assert(
    !/https?:\/\//.test(
      SRC.slice(
        SRC.indexOf("function tableReadyCopy"),
        SRC.indexOf("function tableReadyCopy") + 200,
      ),
    ),
    "the table-ready copy must NOT contain a link",
  );
});

// ===========================================================================
// #1541 — RECONCILED under [TEST-MOD-APPROVED #1541].
//
// T-SMS-2 and T-SMS-6 used to assert that TWILIO_MESSAGING_SERVICE_SID,
// MessagingServiceSid and Deno.env.get("TWILIO_ACCOUNT_SID") appeared INSIDE
// send-venue-sms/index.ts. In other words they asserted THE BYPASS WAS CORRECT:
// they required this function to own a private Twilio client, which is exactly
// the defect #1541 exists to remove. The file was also wired into NO workflow
// (`grep -rn "send_venue_sms.test.ts" .github/` was empty), so a dark test was
// institutionalising a dark bypass — it could never have caught the defect and
// it actively resisted the fix. It is wired into `notification-deno-tests` in
// the same PR that reconciles it.
//
// What is asserted now is the OPPOSITE and stronger property: this function
// owns NO provider client at all. Sender identity, credentials, the
// StatusCallback, country routing and the market kill switches all belong to
// smsAdapter, and the approved-toll-free discipline is enforced there and
// gated repo-wide by
// .github/scripts/strict-grep/issue-1541-sms-provider-sole-send-path.mjs.
//
// These remain SOURCE-CONTRACT assertions, which is this file's stated design
// (see the header — no live edge harness in the worktree). The BEHAVIOURAL
// proof — zero provider HTTP for a dark market, exactly one Twilio call for a
// live one, asserted on the captured request — lives in
// supabase/functions/__tests__/issue_1541_sms_sole_send_path.test.ts.
// ===========================================================================
Deno.test("T-SMS-2 — the send is DELEGATED to smsAdapter; this fn owns no provider client", () => {
  assertMatch(
    SRC,
    /import\s*\{\s*smsAdapter\s*\}\s*from\s*["']\.\.\/_shared\/adapters\/smsAdapter\.ts["']/,
    "must import the sole sanctioned send path",
  );
  assertMatch(
    SRC,
    /smsAdapter\.send\(/,
    "must send through smsAdapter.send()",
  );
  // No private provider client survives in this file.
  assert(
    !/api\.twilio\.com/.test(SRC),
    "must NOT reach the Twilio REST API directly",
  );
  assert(
    !/Deno\.env\.get\(["']TWILIO_ACCOUNT_SID["']\)/.test(SRC) &&
      !/Deno\.env\.get\(["']TWILIO_AUTH_TOKEN["']\)/.test(SRC) &&
      !/Deno\.env\.get\(["']TWILIO_MESSAGING_SERVICE_SID["']\)/.test(SRC),
    "must NOT read Twilio credentials — they belong to the adapter",
  );
  // NEVER a raw From param (which would bypass the approved toll-free).
  assert(
    !/params\.set\(["']From["']/.test(SRC) && !/\bFrom:\s*[^M]/.test(SRC),
    "must NOT send with a raw From number",
  );
  // FAILS-ON-REVERT: restoring the deleted `sendTwilioSms()` — or any direct
  // provider fetch — re-introduces api.twilio.com and the credential reads, and
  // both negative assertions above fire.
});

Deno.test("T-SMS-2b — a market kill-switch skip is surfaced to the operator, not swallowed", () => {
  // #1541 — SMS is the SOLE channel for "your table's ready": there is no email
  // or push leg. A silent skip would mean the guest is simply never told.
  // Because this fn is synchronous and operator-facing, the skip MUST come back
  // as a distinct, actionable status the UI can act on — and the row must NOT
  // be marked notified, so the operator can retry once the market goes live.
  assertMatch(SRC, /skipped_market_dark/, "a dark-market skip must be logged distinctly");
  assertMatch(SRC, /sms_market_unavailable/, "the skip must carry its own error code");
  const skipIdx = SRC.indexOf('result.status === "skipped"');
  // Anchor on the QUOTED rpc argument so the prose mention of the RPC in this
  // file's own header cannot satisfy the lookup — a positional assertion that
  // can be satisfied by a comment proves nothing (#1518).
  const markIdx = SRC.indexOf('"biz_waitlist_mark_notified"');
  const skipReturnIdx = SRC.indexOf("sms_market_unavailable");
  assert(skipIdx > -1, "the skipped branch must exist");
  assert(markIdx > -1, "the mark-notified RPC call must still exist");
  assert(
    skipReturnIdx > -1 && skipReturnIdx < markIdx,
    "the dark-market branch must RETURN before biz_waitlist_mark_notified — a guest who was not notified must not be marked notified",
  );
});

Deno.test("T-SMS-3 — opt-out is checked BEFORE send and honored", () => {
  assertMatch(SRC, /from\(["']venue_sms_opt_out["']\)/, "must read the opt-out ledger");
  assertMatch(SRC, /skipped_opt_out/, "must log a skipped_opt_out outcome");
  // Global (brand_id NULL) OR per-brand opt-out blocks the send.
  assertMatch(
    SRC,
    /r\.brand_id === null \|\| r\.brand_id === brandId/,
    "must honor BOTH global and per-brand opt-out rows",
  );
  // The opt-out check returns BEFORE the send.
  //
  // #1541 — RECONCILED ANCHOR ONLY, under [TEST-MOD-APPROVED #1541]. The
  // ordering property this asserts is UNCHANGED and still binding; only the
  // thing it points at moved, because `sendTwilioSms(toPhone, copy)` was
  // deleted along with the private Twilio client. (The SPEC expected T-SMS-3 to
  // pass untouched — it could not, because this line was coupled to the deleted
  // internal's name. Reported as a SPEC correction.)
  const optIdx = SRC.indexOf("skipped_opt_out");
  const sendIdx = SRC.indexOf("smsAdapter.send(");
  assert(optIdx > -1 && sendIdx > -1 && optIdx < sendIdx, "opt-out gate must precede the send");
});

Deno.test("T-SMS-4 — a 21610 (blacklist) persists a global opt-out (defensive)", () => {
  assertMatch(SRC, /21610/, "must recognize the Twilio blacklist error code");
  // D-2 fix: the defensive persist routes through the partial-index-safe
  // SECURITY DEFINER RPC (NOT a plain .upsert({ onConflict: "phone_e164" }),
  // which errors at runtime against the table's PARTIAL unique indexes).
  assertMatch(
    SRC,
    /\.rpc\(\s*["']biz_sms_record_global_opt_out["']/,
    "a blacklist response must persist a global opt-out via the partial-index-safe RPC",
  );
  // FAILS-ON-REVERT (D-2): reverting to the broken `.upsert({ onConflict:
  // "phone_e164" })` on venue_sms_opt_out (the runtime-throwing path) makes this
  // assertion FAIL. The defensive persist must NOT use a plain onConflict upsert
  // against venue_sms_opt_out — that table only has PARTIAL unique indexes.
  assert(
    !/from\(["']venue_sms_opt_out["']\)[\s\S]{0,200}?\.upsert\([\s\S]{0,200}?onConflict:\s*["']phone_e164["']/
      .test(SRC),
    "must NOT use a plain onConflict:'phone_e164' upsert (errors against the partial unique indexes)",
  );
  // The defensive persist is guarded so it never masks the failure response.
  const blIdx = SRC.indexOf("result.blacklisted");
  const tryIdx = SRC.indexOf("try {", blIdx);
  assert(
    blIdx > -1 && tryIdx > -1 && tryIdx - blIdx < 400,
    "the defensive opt-out persist must be wrapped in try/catch",
  );
});

Deno.test("T-SMS-5 — E.164 validation gates the send", () => {
  assertMatch(SRC, /\^\\\+\[1-9\]\[0-9\]\{1,14\}\$/, "must validate E.164 with the canonical regex");
  assertMatch(SRC, /skipped_invalid_phone/, "must log a skipped_invalid_phone outcome");
});

Deno.test("T-SMS-6 — this fn holds no provider credentials at all, hardcoded or otherwise", () => {
  // #1541 — RECONCILED under [TEST-MOD-APPROVED #1541]. This used to REQUIRE
  // the three TWILIO_* env reads to be present here, which is the same as
  // requiring the bypass. The credentials moved to smsAdapter, where they are
  // read once, behind the kill switches. The security property the original
  // test cared about — nothing hardcoded — is kept and widened: this file must
  // carry no Twilio credential material of any kind.
  assert(!/AC[0-9a-f]{32}/i.test(SRC), "no hardcoded Twilio Account SID");
  assert(
    !/Deno\.env\.get\(["']TWILIO_[A-Z_]*["']\)/.test(SRC),
    "must read no TWILIO_* secret — credentials belong to smsAdapter alone",
  );
  assert(
    !/SK[0-9a-f]{32}/i.test(SRC) && !/[?&]secret=/.test(SRC),
    "no hardcoded provider key or status-callback secret",
  );
});

Deno.test("T-SMS-7 — the caller is gated on manager-plus brand membership", () => {
  assertMatch(SRC, /biz_brand_effective_rank_for_caller/, "must check brand-member rank");
  assertMatch(SRC, /not_authorized/, "must 403 a non-member");
  assertMatch(SRC, /auth\.getUser\(\)/, "must authenticate the caller's JWT");
});

Deno.test("T-SMS-8 — every send attempt is logged to venue_sms_log", () => {
  assertMatch(SRC, /from\("venue_sms_log"\)/);
  assertMatch(SRC, /triggered_by: userId/, "the log must record the triggering operator");
});
