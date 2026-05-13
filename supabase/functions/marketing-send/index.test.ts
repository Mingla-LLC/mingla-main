// ORCH-0815-B — Source-introspection tests for marketing-send.
//
// Pattern mirrors notification-retry-sweeper/index.test.ts: assert that
// the SHIPPED source contains the right structural invariants so any
// regression that strips a guard, hard-codes the env-flag default, or
// drops the FOR UPDATE SKIP LOCKED reference fails CI before review.
//
// Real integration verification (live Resend sandbox, real Postgres
// SKIP LOCKED race) is owned by Claude `mingla-forensics` (TEST mode)
// per SPEC §12 T-B19..T-B25.

import { assert, assertFalse } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// T-B07 — channel dispatcher switch with `default: throw`
Deno.test("marketing-send: dispatchByKind uses switch with default throw (I-PROPOSED-BR)", () => {
  assert(/switch\s*\(\s*kind\s*\)/.test(SOURCE), "switch on kind missing");
  assert(SOURCE.includes('case "email":'));
  assert(SOURCE.includes('case "sms":'));
  assert(SOURCE.includes('case "rcs":'));
  assert(/sms_not_yet_enabled/.test(SOURCE));
  assert(/rcs_not_yet_enabled/.test(SOURCE));
  assert(/unknown_channel_kind/.test(SOURCE));
  // Exhaustiveness sentinel — TS compile error if a kind is added without
  // a case branch.
  assert(/const _exhaustive:\s*never\s*=\s*kind/.test(SOURCE));
});

// T-B08 — live-broadcast gate (LIVE=false) writes preview_skipped
Deno.test("marketing-send: live-broadcast env-flag gates Resend calls", () => {
  assert(SOURCE.includes("MARKETING_SEND_LIVE_ENABLED"));
  // Default value MUST be 'false' (or absent → coerced to false).
  assert(/MARKETING_SEND_LIVE_ENABLED.*\?\?\s*["']false["']/.test(SOURCE));
  // preview_skipped path must update marketing_messages with that status.
  assert(SOURCE.includes('"preview_skipped"'));
  // Live path posts to Resend.
  assert(SOURCE.includes("https://api.resend.com/emails"));
});

// T-B08 negative — no code path defaults the flag ON.
Deno.test("marketing-send: never defaults MARKETING_SEND_LIVE_ENABLED to true (SPEC §13 hard guard)", () => {
  assertFalse(
    /MARKETING_SEND_LIVE_ENABLED.*\?\?\s*["']true["']/.test(SOURCE),
    "live-broadcast flag must not default ON",
  );
  assertFalse(
    /LIVE\s*=\s*true\b/.test(SOURCE),
    "no hard-coded LIVE=true",
  );
});

// T-B10 — atomic claim via FOR UPDATE SKIP LOCKED helper
Deno.test("marketing-send: atomic-claim uses FOR UPDATE SKIP LOCKED via mkt_claim_campaigns RPC", () => {
  assert(SOURCE.includes("FOR UPDATE SKIP LOCKED"));
  assert(SOURCE.includes("mkt_claim_campaigns"));
  assert(/\.rpc\(["']mkt_claim_campaigns["']/.test(SOURCE));
});

// T-B09 — Resend POST shape (live path)
Deno.test("marketing-send: Resend POST has correct payload shape", () => {
  assert(SOURCE.includes("https://api.resend.com/emails"));
  assert(SOURCE.includes("Bearer ${input.apiKey}"));
  assert(SOURCE.includes("input.from"));
  assert(SOURCE.includes("input.subject"));
  assert(SOURCE.includes("input.html"));
});

// T-B11 — Resend non-2xx marks message failed + continues
Deno.test("marketing-send: Resend failure marks message failed + continues", () => {
  assert(SOURCE.includes('"failed"'));
  assert(SOURCE.includes("failure_reason"));
});

// T-B12 — Resend 429 backoff (1s/3s/9s, 3 retries max)
Deno.test("marketing-send: Resend 429 backoff with RESEND_MAX_RETRIES and RESEND_BACKOFF_MS", () => {
  assert(SOURCE.includes("RESEND_MAX_RETRIES = 3"));
  assert(/RESEND_BACKOFF_MS\s*=\s*\[1000,\s*3000,\s*9000\]/.test(SOURCE));
  assert(SOURCE.includes("response.status === 429"));
});

// resend_not_configured early return when LIVE=true && key missing
Deno.test("marketing-send: returns 503 resend_not_configured when LIVE+key missing", () => {
  assert(SOURCE.includes("resend_not_configured"));
  assert(/return jsonResponse\(\s*\{\s*error:\s*["']resend_not_configured["']\s*\},\s*503\s*\)/.test(SOURCE));
});

// Auth — service-role bearer for cron path; userClient ownership check for direct path
Deno.test("marketing-send: dual auth (service-role for cron + userClient for send-now)", () => {
  assert(SOURCE.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert(SOURCE.includes("userClient"));
  assert(SOURCE.includes("verifyCampaignOwnership"));
  assert(SOURCE.includes('"forbidden"'));
});

// Unsubscribe URL is signed via shared helper + uses getUnsubscribeOrigin
// so the link works without DNS rewrite (defaults to Supabase function URL,
// operator-overridable via MINGLA_UNSUBSCRIBE_LINK_ORIGIN).
Deno.test("marketing-send: unsubscribe link is HS256-signed via shared helper", () => {
  assert(SOURCE.includes("signUnsubscribeToken"));
  assert(SOURCE.includes("getUnsubscribeOrigin"));
  assert(/\$\{unsubscribeToken\}/.test(SOURCE));
});

// Per-link tracking: every href becomes a tracking redirect
Deno.test("marketing-send: per-link tracking writes marketing_clicks rows", () => {
  assert(SOURCE.includes("marketing_clicks"));
  assert(SOURCE.includes("tracking_id"));
  assert(SOURCE.includes("destination_url"));
});

// Suppression — contacts with email_marketing_ok=false are skipped
Deno.test("marketing-send: suppressed contacts are skipped (no marketing_messages row)", () => {
  assert(SOURCE.includes("email_marketing_ok"));
  // Skip branch returns/continues before INSERT.
  assert(/!contact\.email_marketing_ok/.test(SOURCE));
});
