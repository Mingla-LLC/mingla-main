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

Deno.test("T-SMS-2 — sends ONLY via the approved toll-free Messaging Service (no raw From)", () => {
  assertMatch(
    SRC,
    /TWILIO_MESSAGING_SERVICE_SID/,
    "must use the Messaging Service SID (approved toll-free)",
  );
  assertMatch(SRC, /MessagingServiceSid/, "the Twilio param must be MessagingServiceSid");
  // NEVER a raw From param (which would bypass the approved toll-free).
  assert(
    !/params\.set\(["']From["']/.test(SRC) && !/From:\s*[^M]/.test(SRC),
    "must NOT send with a raw From number",
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
  // The opt-out check returns BEFORE the Twilio send.
  const optIdx = SRC.indexOf("skipped_opt_out");
  const sendIdx = SRC.indexOf("sendTwilioSms(toPhone, copy)");
  assert(optIdx > -1 && sendIdx > -1 && optIdx < sendIdx, "opt-out gate must precede the send");
});

Deno.test("T-SMS-4 — a 21610 (blacklist) persists a global opt-out (defensive)", () => {
  assertMatch(SRC, /21610/, "must recognize the Twilio blacklist error code");
  assertMatch(
    SRC,
    /from\(["']venue_sms_opt_out["']\)[\s\S]*?upsert/,
    "a blacklist response must persist a global opt-out",
  );
});

Deno.test("T-SMS-5 — E.164 validation gates the send", () => {
  assertMatch(SRC, /\^\\\+\[1-9\]\[0-9\]\{1,14\}\$/, "must validate E.164 with the canonical regex");
  assertMatch(SRC, /skipped_invalid_phone/, "must log a skipped_invalid_phone outcome");
});

Deno.test("T-SMS-6 — Twilio creds come from Deno env, never hardcoded", () => {
  assertMatch(SRC, /Deno\.env\.get\("TWILIO_ACCOUNT_SID"\)/);
  assertMatch(SRC, /Deno\.env\.get\("TWILIO_AUTH_TOKEN"\)/);
  assertMatch(SRC, /Deno\.env\.get\("TWILIO_MESSAGING_SERVICE_SID"\)/);
  // No literal Twilio SID/token pattern hardcoded.
  assert(!/AC[0-9a-f]{32}/i.test(SRC), "no hardcoded Twilio Account SID");
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
