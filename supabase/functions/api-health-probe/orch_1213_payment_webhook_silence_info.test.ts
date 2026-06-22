// ORCH-1213 [payment webhook-silence is info-only] — implementor happy-path
// regression test (deno test) for the pure probe logic.
//
// Run: deno test supabase/functions/api-health-probe/orch_1213_payment_webhook_silence_info.test.ts
//
// WHY: stripe + paystack share the near-empty `payment_webhook_events` table. In
// a low/zero-traffic env its newest row is routinely >6h old. Before ORCH-1213 the
// payment `webhookFreshness(...)` calls passed alertOnSilence=true, so silence was
// recorded as a `webhook`/`degraded` row with detail.alert_on_silence=true, which
// `computeEffectiveStatus` escalated to a failedTick → 2 ticks → a false "down"
// email. ORCH-1213 flips both payment calls to alertOnSilence=false, so the
// webhook row now carries alert_on_silence:false (and never becomes degraded from
// silence) → NO failedTick. A genuine API/auth outage (a synthetic `down` row)
// MUST still page — proven here too.
//
// FAILS-ON-REVERT: if either payment `webhookFreshness(...)` is flipped back to
// `true`, the recorded webhook row regains detail.alert_on_silence=true (and can
// be `degraded` from silence), so `computeEffectiveStatus` returns failedTick=true.
// The T-1 assertion `failedTick === false` then FAILS. The T-2 sentinel proves the
// dormant alert_on_silence===true branch still pages, so the test genuinely
// exercises the load-bearing flag (not a tautology).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEffectiveStatus } from "./logic.ts";

// ── T-1 (happy path): info-only payment webhook silence does NOT fail the tick ──

Deno.test(
  "ORCH-1213 T-1 — payment webhook silent (status healthy, alert_on_silence:false) ⇒ failedTick=false",
  () => {
    // Mirrors the row index.ts:1022-1026 inserts for stripe/paystack post-fix:
    // synthetic probe healthy + a webhook row with alert_on_silence:false (silence
    // is recorded but not alertable). last_received present (a stale row exists).
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      {
        layer: "webhook",
        status: "healthy",
        detail: {
          last_received: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          alert_on_silence: false,
        },
      },
    ]);
    assertEquals(r.failedTick, false);
    assertEquals(r.effectiveStatus, "healthy");
  },
);

Deno.test(
  "ORCH-1213 T-1b — payment webhook table genuinely empty (status unknown, alert_on_silence:false) ⇒ failedTick=false",
  () => {
    // latest == null → index.ts:1019 records status:"unknown" (not degraded).
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      {
        layer: "webhook",
        status: "unknown",
        detail: { last_received: null, alert_on_silence: false },
      },
    ]);
    assertEquals(r.failedTick, false);
    // unknown never counts; worst is the synthetic healthy row.
    assertEquals(r.effectiveStatus, "healthy");
  },
);

Deno.test(
  "ORCH-1213 T-1c — even a degraded webhook row WITHOUT opt-in (alert_on_silence:false) ⇒ failedTick=false",
  () => {
    // Defense-in-depth: post-fix the row can never be `degraded` from silence
    // (index.ts:1020 is gated on alertOnSilence), but if a degraded webhook row
    // ever arrived without opt-in, it must NOT page (the flag is load-bearing).
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      {
        layer: "webhook",
        status: "degraded",
        detail: { alert_on_silence: false },
      },
    ]);
    assertEquals(r.failedTick, false);
  },
);

// ── T-2 (fail-on-revert sentinel): the opt-in branch STILL pages ──
// If a future caller (or a revert) registers a webhook with alert_on_silence:true
// and it goes silent (degraded), the dormant guard must still fire failedTick.
// This proves T-1's `false` result is driven by the alert_on_silence flag — not by
// the test ignoring the webhook layer. (Mirrors logic.test.ts:64 from a fresh file.)

Deno.test(
  "ORCH-1213 T-2 — opt-in webhook silence (degraded, alert_on_silence:true) STILL ⇒ failedTick=true",
  () => {
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      {
        layer: "webhook",
        status: "degraded",
        detail: { alert_on_silence: true },
      },
    ]);
    assertEquals(r.failedTick, true);
    assertEquals(r.failingLayer, "webhook");
  },
);

// ── T-1d (outage isolation): a genuine synthetic `down` STILL pages ──
// The HARD GUARD: downgrading webhook-silence does not mask a real API outage.

Deno.test(
  "ORCH-1213 T-1d — genuine synthetic `down` + info-only silent webhook ⇒ failedTick=true",
  () => {
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "down", detail: { error: "auth failed" } },
      {
        layer: "webhook",
        status: "healthy",
        detail: { last_received: null, alert_on_silence: false },
      },
    ]);
    assertEquals(r.failedTick, true);
    assertEquals(r.effectiveStatus, "down");
    assertEquals(r.failingLayer, "synthetic");
  },
);
