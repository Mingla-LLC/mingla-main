// ORCH-1201 — Implementor regression tests (deno test) for the pure probe logic.
// Run: deno test supabase/functions/api-health-probe/logic.test.ts
//
// Fails-on-revert proof targets (SPEC §8.1 items 2/3/4):
//   - state-machine entry N=2 (changing N to 1 fires on first fail → FAIL),
//   - recovery (alerting → healthy → recovery email + state ok),
//   - effective-status worst-of-layers isolation (unknown never fails).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLASS_B_DEPLETION,
  computeEffectiveStatus,
  decideAvailabilityTransitions,
  decideBalanceTransition,
  type DepletionObs,
  evaluateBalanceForSignal,
  indicatorToStatus,
  matchClassBDepletion,
  STATUS_PAGE_URLS,
} from "./logic.ts";

const HOUR = 60 * 60 * 1000;
const SIX_H = 6 * HOUR;
const DAY = 24 * HOUR;

Deno.test("indicatorToStatus mapping", () => {
  assertEquals(indicatorToStatus("none"), "healthy");
  assertEquals(indicatorToStatus("minor"), "degraded");
  assertEquals(indicatorToStatus("major"), "down");
  assertEquals(indicatorToStatus("critical"), "down");
  assertEquals(indicatorToStatus("garbage"), "unknown");
  assertEquals(indicatorToStatus(null), "unknown");
  assertEquals(indicatorToStatus(undefined), "unknown");
});

Deno.test("computeEffectiveStatus — unknown never counts as a failure", () => {
  const r = computeEffectiveStatus([
    { layer: "status_page", status: "unknown", detail: {} },
    { layer: "synthetic", status: "healthy", detail: {} },
  ]);
  assertEquals(r.effectiveStatus, "healthy");
  assertEquals(r.failedTick, false);
});

Deno.test("computeEffectiveStatus — worst-of-layers picks down", () => {
  const r = computeEffectiveStatus([
    { layer: "status_page", status: "healthy", detail: {} },
    { layer: "synthetic", status: "down", detail: { error: "boom" } },
    { layer: "passive", status: "degraded", detail: {} },
  ]);
  assertEquals(r.effectiveStatus, "down");
  assertEquals(r.failedTick, true);
  assertEquals(r.failingLayer, "synthetic");
});

Deno.test("computeEffectiveStatus — degraded alone does NOT fail the tick", () => {
  const r = computeEffectiveStatus([
    { layer: "synthetic", status: "degraded", detail: {} },
  ]);
  assertEquals(r.effectiveStatus, "degraded");
  assertEquals(r.failedTick, false);
});

Deno.test("computeEffectiveStatus — webhook-silence degraded DOES fail the tick", () => {
  const r = computeEffectiveStatus([
    { layer: "synthetic", status: "healthy", detail: {} },
    { layer: "webhook", status: "degraded", detail: { alert_on_silence: true } },
  ]);
  assertEquals(r.failedTick, true);
  assertEquals(r.failingLayer, "webhook");
});

Deno.test("computeEffectiveStatus — all-unknown stays unknown, no fail", () => {
  const r = computeEffectiveStatus([
    { layer: "status_page", status: "unknown", detail: {} },
  ]);
  assertEquals(r.effectiveStatus, "unknown");
  assertEquals(r.failedTick, false);
});

Deno.test("state machine — 1 fail: no email, consecutive=1 (N=2 gate)", () => {
  const d = decideAvailabilityTransitions({
    currentState: "ok",
    consecutiveFailures: 0,
    lastAlertAt: null,
    failedTick: true,
    nowMs: 1000,
    cooldownMs: SIX_H,
  });
  assertEquals(d.nextConsecutiveFailures, 1);
  assertEquals(d.sendDownAlert, false);
  assertEquals(d.nextState, "ok");
});

Deno.test("state machine — 2nd consecutive fail: email + alerting", () => {
  const d = decideAvailabilityTransitions({
    currentState: "ok",
    consecutiveFailures: 1,
    lastAlertAt: null,
    failedTick: true,
    nowMs: 1000,
    cooldownMs: SIX_H,
  });
  assertEquals(d.nextConsecutiveFailures, 2);
  assertEquals(d.sendDownAlert, true);
  assertEquals(d.nextState, "alerting");
  assertEquals(d.setLastAlertAt, true);
});

Deno.test("state machine — flap (fail/ok/fail) resets consecutive, never alerts", () => {
  let state: "ok" | "alerting" = "ok";
  let consec = 0;
  let alerts = 0;
  for (const fail of [true, false, true, false, true]) {
    const d = decideAvailabilityTransitions({
      currentState: state,
      consecutiveFailures: consec,
      lastAlertAt: null,
      failedTick: fail,
      nowMs: 1000,
      cooldownMs: SIX_H,
    });
    if (d.sendDownAlert) alerts++;
    state = d.nextState;
    consec = d.nextConsecutiveFailures;
  }
  assertEquals(alerts, 0); // never two-in-a-row
  assertEquals(state, "ok");
});

Deno.test("state machine — recovery: alerting → healthy → recovery email + ok", () => {
  const d = decideAvailabilityTransitions({
    currentState: "alerting",
    consecutiveFailures: 3,
    lastAlertAt: new Date(0).toISOString(),
    failedTick: false,
    nowMs: 1000,
    cooldownMs: SIX_H,
  });
  assertEquals(d.nextState, "ok");
  assertEquals(d.sendRecoveryAlert, true);
  assertEquals(d.setLastRecoveryAt, true);
  assertEquals(d.nextConsecutiveFailures, 0);
});

Deno.test("state machine — cooldown: alerting + fail within 6h → no email", () => {
  const now = 10 * DAY;
  const d = decideAvailabilityTransitions({
    currentState: "alerting",
    consecutiveFailures: 5,
    lastAlertAt: new Date(now - HOUR).toISOString(), // 1h ago
    failedTick: true,
    nowMs: now,
    cooldownMs: SIX_H,
  });
  assertEquals(d.sendDownAlert, false);
  assertEquals(d.nextState, "alerting");
});

Deno.test("state machine — cooldown: alerting + fail after 6h → re-alert email", () => {
  const now = 10 * DAY;
  const d = decideAvailabilityTransitions({
    currentState: "alerting",
    consecutiveFailures: 5,
    lastAlertAt: new Date(now - SIX_H - 1000).toISOString(),
    failedTick: true,
    nowMs: now,
    cooldownMs: SIX_H,
  });
  assertEquals(d.sendDownAlert, true);
  assertEquals(d.setLastAlertAt, true);
});

Deno.test("balance — ok→low cross sends one email", () => {
  const d = decideBalanceTransition({
    balanceLow: true,
    lastBalanceState: "ok",
    lastBalanceAlertAt: null,
    nowMs: 1000,
    cooldownMs: DAY,
  });
  assertEquals(d.sendLowBalanceAlert, true);
  assertEquals(d.nextBalanceState, "low");
});

Deno.test("balance — already low within 24h → no repeat email", () => {
  const now = 10 * DAY;
  const d = decideBalanceTransition({
    balanceLow: true,
    lastBalanceState: "low",
    lastBalanceAlertAt: new Date(now - HOUR).toISOString(),
    nowMs: now,
    cooldownMs: DAY,
  });
  assertEquals(d.sendLowBalanceAlert, false);
});

Deno.test("balance — recovery above threshold resets to ok", () => {
  const d = decideBalanceTransition({
    balanceLow: false,
    lastBalanceState: "low",
    lastBalanceAlertAt: new Date(0).toISOString(),
    nowMs: 1000,
    cooldownMs: DAY,
  });
  assertEquals(d.nextBalanceState, "ok");
  assertEquals(d.sendLowBalanceAlert, false);
});

Deno.test("balance — no signal preserves prior state, never alerts", () => {
  const d = decideBalanceTransition({
    balanceLow: null,
    lastBalanceState: "low",
    lastBalanceAlertAt: null,
    nowMs: 1000,
    cooldownMs: DAY,
  });
  assertEquals(d.nextBalanceState, "low");
  assertEquals(d.sendLowBalanceAlert, false);
});

// ════════════════════════════════════════════════════════════════════════
// ORCH-1201-R2 — Class-B reactive depletion matcher (THE load-bearing
// disambiguation) + Class-A class-aware balance evaluation.
// ════════════════════════════════════════════════════════════════════════
const obs = (http: number, code: string | null, text: string | null, ago = 0): DepletionObs => ({
  http_status: http,
  error_code: code,
  error_text: text,
  observed_at: new Date(Date.now() - ago).toISOString(),
});

Deno.test("R2 T1 — matchClassBDepletion: insufficient_quota ⇒ depleted; rate_limit_exceeded ⇒ NOT", () => {
  const sig = CLASS_B_DEPLETION.openai;
  // depletion: 429 + error_code insufficient_quota
  const dep = matchClassBDepletion(sig, [obs(429, "insufficient_quota", "You exceeded your current quota")]);
  assertEquals(dep.depleted, true);
  assertEquals(dep.lastErrorCode, "insufficient_quota");
  // transient: 429 + rate_limit_exceeded ⇒ must NOT count as depletion (load-bearing)
  const transient = matchClassBDepletion(sig, [obs(429, "rate_limit_exceeded", "Rate limit reached")]);
  assertEquals(transient.depleted, false);
});

Deno.test("R2 T1b — matchClassBDepletion: Serper body substring 'Not enough credits'", () => {
  const sig = CLASS_B_DEPLETION.serper;
  const dep = matchClassBDepletion(sig, [obs(403, "not_enough_credits", "Not enough credits")]);
  assertEquals(dep.depleted, true);
  // an unrelated 403 body does NOT trip it.
  const other = matchClassBDepletion(sig, [obs(403, null, "Invalid API key")]);
  assertEquals(other.depleted, false);
});

Deno.test("R2 T1c — matchClassBDepletion: gemini RESOURCE_EXHAUSTED on error_code", () => {
  const dep = matchClassBDepletion(CLASS_B_DEPLETION.gemini, [obs(429, "RESOURCE_EXHAUSTED", "{...limit:0...}")]);
  assertEquals(dep.depleted, true);
  const plain429 = matchClassBDepletion(CLASS_B_DEPLETION.gemini, [obs(429, "", "")]);
  assertEquals(plain429.depleted, false);
});

Deno.test("R2 T5 — header carry-forward: cached_remaining <= warn ⇒ depleted", () => {
  const sig = CLASS_B_DEPLETION.pexels; // header warn 2500
  // cached 21855 ⇒ not depleted
  assertEquals(matchClassBDepletion(sig, [], 21855).depleted, false);
  // cached 1200 (stale carried fwd) ⇒ depleted
  const dep = matchClassBDepletion(sig, [], 1200);
  assertEquals(dep.depleted, true);
  assertEquals(dep.lastErrorCode, "header_remaining");
});

Deno.test("R2 T2 — evaluateBalanceForSignal: stripe/paystack ALWAYS null (incl. balance 0)", () => {
  const s = evaluateBalanceForSignal("stripe", { balance: 0, currency: "usd" }, { kind: "twilio_balance", warn: 25 });
  assertEquals(s.balanceLow, null);
  const p = evaluateBalanceForSignal("paystack", { balance: 0 }, { kind: "twilio_balance", warn: 25 });
  assertEquals(p.balanceLow, null);
});

Deno.test("R2 T3 — evaluateBalanceForSignal: cloudinary 747.88% ⇒ low + crit severity", () => {
  const r = evaluateBalanceForSignal("cloudinary", { used_percent: 747.88 }, { kind: "cloudinary_used_pct", warn: 80, crit: 100 });
  assertEquals(r.balanceLow, true);
  assertEquals(r.severity, "crit");
  // 50% used ⇒ not low
  const ok = evaluateBalanceForSignal("cloudinary", { used_percent: 50 }, { kind: "cloudinary_used_pct", warn: 80, crit: 100 });
  assertEquals(ok.balanceLow, false);
});

Deno.test("R2 T4 — evaluateBalanceForSignal: twilio 14.53 low @ warn 25; 30 ⇒ false", () => {
  const low = evaluateBalanceForSignal("twilio", { balance: 14.53, currency: "USD" }, { kind: "twilio_balance", warn: 25, crit: 5 });
  assertEquals(low.balanceLow, true);
  assertEquals(low.severity, "warn"); // above crit 5
  const ok = evaluateBalanceForSignal("twilio", { balance: 30 }, { kind: "twilio_balance", warn: 25, crit: 5 });
  assertEquals(ok.balanceLow, false);
});

Deno.test("STATUS_PAGE_URLS keys are a subset of monitored services (canonical)", () => {
  const seeded = new Set([
    "stripe", "paystack", "gemini", "openai", "mapbox", "google_places",
    "ticketmaster", "serper", "pexels", "giphy", "onesignal_consumer",
    "onesignal_business", "resend", "twilio", "cloudinary", "supabase",
    "vercel", "exchangerate", "thumio", "revenuecat", "posthog", "mixpanel",
    "sentry", "appsflyer", "ga4",
  ]);
  for (const key of Object.keys(STATUS_PAGE_URLS)) {
    if (!seeded.has(key)) throw new Error(`STATUS_PAGE_URLS key '${key}' not in seeded services`);
  }
});
