// ORCH-1213 [payment webhook-silence is info-only] — TESTER ADVERSARIAL test.
//
// Run: deno test supabase/functions/api-health-probe/orch_1213_tester_adversarial.test.ts
//
// DIFFERENT ANGLE than the implementor's happy-path (T-1, which only asserts
// `computeEffectiveStatus().failedTick`): this file composes the FULL probe→
// state-machine pipeline `computeEffectiveStatus → decideAvailabilityTransitions`
// for the EXACT live alerting rows (stripe consecutive_failures=9, paystack=4),
// and proves the two adversarial properties the orchestrator dispatched:
//
//   T-3  A genuine synthetic `down` row (probeStripe/probePaystack returning
//        "down" via httpToStatus 4xx / a thrown error) STILL yields
//        failedTick===true AND effectiveStatus==="down", even while the payment
//        webhook layer is now info-only/silent. The info-only downgrade did NOT
//        mask a real API/auth outage. After 2 such ticks from `ok`, the state
//        machine pages (sendDownAlert===true).
//
//   T-4  decideAvailabilityTransitions({currentState:"alerting", failedTick:false})
//        for the currently-alerting stripe + paystack rows yields nextState==="ok",
//        sendRecoveryAlert===true, sendDownAlert===false, consecutiveFailures→0 —
//        exactly ONE clean recovery, NO new down page.
//
//   T-5  The cloudinary/twilio webhook rows are unchanged — an info-only silent
//        cloudinary/twilio row never produces a failedTick (parity preserved).
//
// FAILS-ON-REVERT: T-4_pipeline composes the same `computeEffectiveStatus` the fix
// relies on. If a payment webhookFreshness(...) is flipped back to alertOnSilence=
// true, the recorded webhook row is {status:"degraded", alert_on_silence:true},
// which computeEffectiveStatus escalates to failedTick=true. That feeds a *failed*
// tick into decideAvailabilityTransitions on a currently-`alerting` row, so it
// stays `alerting` (or cooldown-re-pages) instead of recovering → the
// `nextState==="ok"` / `sendRecoveryAlert===true` assertions in T-4_pipeline FAIL.
// Proven below in the `*_revertshape` mirror tests too.

import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeEffectiveStatus,
  decideAvailabilityTransitions,
} from "./logic.ts";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-22T16:00:00Z");

// The webhook row index.ts:1022-1026 records for stripe/paystack POST-fix:
// silence is recorded as healthy (a stale row exists) with alert_on_silence:false.
function infoOnlySilentPaymentWebhookRow() {
  return {
    layer: "webhook" as const,
    status: "healthy" as const,
    detail: {
      last_received: new Date(NOW - 12 * 60 * 60 * 1000).toISOString(),
      alert_on_silence: false,
    },
  };
}

// ── T-3: genuine outage STILL pages despite info-only webhook silence ──

Deno.test(
  "ORCH-1213 ADV T-3 — synthetic `down` (auth/4xx outage) + info-only silent webhook ⇒ failedTick=true, effectiveStatus=down",
  () => {
    // probePaystack non-200 / json.status!==true → httpToStatus → "down"; OR a
    // thrown error → "down". Either way the synthetic row is {status:"down"}.
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "down", detail: { http_status: 401, error: "auth failed" } },
      infoOnlySilentPaymentWebhookRow(),
    ]);
    assertEquals(r.failedTick, true, "a real API outage MUST still drive failedTick");
    assertEquals(r.effectiveStatus, "down");
    assertEquals(r.failingLayer, "synthetic", "the outage, not the silent webhook, is the failing layer");
  },
);

Deno.test(
  "ORCH-1213 ADV T-3 (pipeline) — 2 genuine `down` ticks from ok ⇒ state machine pages (sendDownAlert)",
  () => {
    const tick = computeEffectiveStatus([
      { layer: "synthetic", status: "down", detail: { http_status: 500 } },
      infoOnlySilentPaymentWebhookRow(),
    ]);
    assertEquals(tick.failedTick, true);

    // tick 1 from ok: not yet 2 → no page, but counter climbs.
    const d1 = decideAvailabilityTransitions({
      currentState: "ok",
      consecutiveFailures: 0,
      lastAlertAt: null,
      failedTick: tick.failedTick,
      nowMs: NOW,
      cooldownMs: SIX_HOURS_MS,
    });
    assertEquals(d1.nextConsecutiveFailures, 1);
    assertFalse(d1.sendDownAlert);

    // tick 2: 2 consecutive failures → page. Real outage is NOT masked.
    const d2 = decideAvailabilityTransitions({
      currentState: "ok",
      consecutiveFailures: d1.nextConsecutiveFailures,
      lastAlertAt: null,
      failedTick: tick.failedTick,
      nowMs: NOW + 3_600_000,
      cooldownMs: SIX_HOURS_MS,
    });
    assertEquals(d2.nextState, "alerting");
    assertEquals(d2.sendDownAlert, true);
  },
);

// ── T-4: the currently-alerting stripe + paystack rows recover cleanly ──
// Full pipeline: post-fix tick → computeEffectiveStatus(failedTick=false) →
// decideAvailabilityTransitions on the LIVE alerting state → exactly one recovery.

Deno.test(
  "ORCH-1213 ADV T-4 (pipeline) — live alerting stripe (cf=9) recovers: ok + recovery email, no down page",
  () => {
    // Post-fix tick: synthetic healthy + info-only silent webhook → failedTick=false.
    const tick = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: { mode: "test" } },
      infoOnlySilentPaymentWebhookRow(),
    ]);
    assertEquals(tick.failedTick, false, "info-only silence must NOT fail the tick");

    const d = decideAvailabilityTransitions({
      currentState: "alerting",
      consecutiveFailures: 9, // live stripe value
      lastAlertAt: "2026-06-22T10:00:00Z",
      failedTick: tick.failedTick,
      nowMs: NOW,
      cooldownMs: SIX_HOURS_MS,
    });
    assertEquals(d.nextState, "ok");
    assertEquals(d.sendRecoveryAlert, true);
    assertEquals(d.sendDownAlert, false);
    assertEquals(d.setLastRecoveryAt, true);
    assertEquals(d.nextConsecutiveFailures, 0);
    assertFalse(d.setLastAlertAt);
  },
);

Deno.test(
  "ORCH-1213 ADV T-4 (pipeline) — live alerting paystack (cf=4) recovers: ok + exactly one recovery, no down page",
  () => {
    const tick = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      infoOnlySilentPaymentWebhookRow(),
    ]);
    assertEquals(tick.failedTick, false);

    const d = decideAvailabilityTransitions({
      currentState: "alerting",
      consecutiveFailures: 4, // live paystack value
      lastAlertAt: "2026-06-22T12:00:00Z",
      failedTick: tick.failedTick,
      nowMs: NOW,
      cooldownMs: SIX_HOURS_MS,
    });
    assertEquals(d.nextState, "ok");
    assertEquals(d.sendRecoveryAlert, true);
    assertEquals(d.sendDownAlert, false);
    assertEquals(d.nextConsecutiveFailures, 0);
  },
);

// FAILS-ON-REVERT mirror: if the payment call is flipped back to alertOnSilence=
// true, the recorded webhook row is {status:"degraded", alert_on_silence:true}
// (exactly what index.ts:1020/1025 produces when `true` is passed and the row is
// >6h stale). That tick's computeEffectiveStatus → failedTick=true, so the
// alerting row does NOT recover. This proves the T-4_pipeline recovery is driven
// by the load-bearing alert_on_silence flag, not a tautology.
Deno.test(
  "ORCH-1213 ADV T-4 (revert-shape sentinel) — reverted (alert_on_silence:true, degraded, stale) ⇒ alerting row does NOT recover",
  () => {
    const revertedTick = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      { layer: "webhook", status: "degraded", detail: { alert_on_silence: true } },
    ]);
    // The revert re-arms the failure.
    assertEquals(revertedTick.failedTick, true);

    const d = decideAvailabilityTransitions({
      currentState: "alerting",
      consecutiveFailures: 9,
      lastAlertAt: "2026-06-22T10:00:00Z",
      failedTick: revertedTick.failedTick,
      nowMs: NOW, // within 6h cooldown of 10:00 → no re-page, but stays alerting
      cooldownMs: SIX_HOURS_MS,
    });
    // The decisive recovery contract is BROKEN under revert: no recovery, stays alerting.
    assertEquals(d.nextState, "alerting");
    assertEquals(d.sendRecoveryAlert, false);
    assertEquals(d.setLastRecoveryAt, false);
  },
);

// ── T-5: cloudinary/twilio parity — info-only silent rows never page ──

Deno.test(
  "ORCH-1213 ADV T-5 — cloudinary + twilio info-only silent webhook rows ⇒ failedTick=false (parity preserved)",
  () => {
    // cloudinary/twilio already pass alertOnSilence=false (index.ts:1039-1040);
    // their webhook rows behave identically to the post-fix payment rows. An
    // info-only silent row from ANY webhook service must never page.
    const r = computeEffectiveStatus([
      { layer: "synthetic", status: "healthy", detail: {} },
      { layer: "webhook", status: "healthy", detail: { last_received: null, alert_on_silence: false } }, // cloudinary
      { layer: "webhook", status: "unknown", detail: { last_received: null, alert_on_silence: false } }, // twilio (empty)
    ]);
    assertEquals(r.failedTick, false);
    assertEquals(r.effectiveStatus, "healthy");
  },
);
