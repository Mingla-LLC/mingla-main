// ORCH-1199 — Implementor regression tests (deno test) for the pure probe logic.
// Run: deno test supabase/functions/api-health-probe/logic.test.ts
//
// Fails-on-revert proof targets (SPEC §8.1 items 2/3/4):
//   - state-machine entry N=2 (changing N to 1 fires on first fail → FAIL),
//   - recovery (alerting → healthy → recovery email + state ok),
//   - effective-status worst-of-layers isolation (unknown never fails).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeEffectiveStatus,
  decideAvailabilityTransitions,
  decideBalanceTransition,
  indicatorToStatus,
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
