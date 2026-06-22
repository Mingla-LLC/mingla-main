// ORCH-1199 — TESTER ADVERSARIAL test (different angle than the implementor's).
//
// The implementor's logic.test.ts tests each pure decision function ONCE, in
// isolation. This test instead THREADS STATE ACROSS MANY TICKS exactly as the
// handler does (load row → decide → write patch → next tick reads the patched
// row) and COUNTS the emails that would actually fire through a fake send. It
// attacks the angles the dispatch named:
//   1. EMAIL FIRES EXACTLY ONCE per ok→alerting transition (no dup same-tick,
//      no re-send while alerting until the 6h cooldown).
//   2. COOLDOWN boundary cases: exactly 6h, 6h-1s, 6h+1s.
//   3. LOW-BALANCE one-shot: cross fires once, staying low does NOT re-fire
//      hourly, recovery resets so a future drop re-fires.
//
// IMMUTABLE / APPEND-ONLY: this file encodes the contract; do not edit to make
// a regression pass. Fails-on-revert: flipping N=2→N=1 or removing the cooldown
// guard in logic.ts breaks the per-transition email counts below.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeEffectiveStatus,
  decideAvailabilityTransitions,
  decideBalanceTransition,
} from "./logic.ts";

const HOUR = 60 * 60 * 1000;
const SIX_H = 6 * HOUR;
const DAY = 24 * HOUR;

// ── A faithful re-implementation of the handler's per-service state threading
//    (index.ts runAlertStateMachine): load prev row, decide, persist patch,
//    fire email iff the decision says so. We count fires. ──
interface AvailState {
  current_state: "ok" | "alerting";
  consecutive_failures: number;
  last_alert_at: string | null;
  last_recovery_at: string | null;
}
function freshAvail(): AvailState {
  return { current_state: "ok", consecutive_failures: 0, last_alert_at: null, last_recovery_at: null };
}
// returns {down, recovery} email counts for this tick (0/1 each — matches the
// handler's trySend dedup which can fire each kind at most once per service/tick)
function availTick(state: AvailState, failedTick: boolean, nowMs: number): { down: number; recovery: number } {
  const d = decideAvailabilityTransitions({
    currentState: state.current_state,
    consecutiveFailures: state.consecutive_failures,
    lastAlertAt: state.last_alert_at,
    failedTick,
    nowMs,
    cooldownMs: SIX_H,
  });
  // persist exactly as index.ts does
  state.current_state = d.nextState;
  state.consecutive_failures = d.nextConsecutiveFailures;
  if (d.setLastAlertAt) state.last_alert_at = new Date(nowMs).toISOString();
  if (d.setLastRecoveryAt) state.last_recovery_at = new Date(nowMs).toISOString();
  return { down: d.sendDownAlert ? 1 : 0, recovery: d.sendRecoveryAlert ? 1 : 0 };
}

// ════════════════════════════════════════════════════════════════════════
// ANGLE 5: NO FABRICATED DATA — unknown is neither a floor nor a ceiling and
// never alerts; a service with zero rows this tick is unknown (not healthy).
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV: zero check rows this tick → unknown, never a fabricated healthy, no alert", () => {
  const r = computeEffectiveStatus([]);
  assertEquals(r.effectiveStatus, "unknown");
  assertEquals(r.failedTick, false, "no signal must never alert");
});

Deno.test("ADV: unknown synthetic + down passive → surfaces DOWN (unknown is not a ceiling that masks a real failure)", () => {
  const r = computeEffectiveStatus([
    { layer: "synthetic", status: "unknown", detail: { error: "secret missing" } },
    { layer: "passive", status: "down", detail: {} },
  ]);
  assertEquals(r.effectiveStatus, "down", "a real down must not be masked by an unknown layer");
  assertEquals(r.failedTick, true);
});

Deno.test("ADV: unknown synthetic + healthy status_page → healthy (unknown is not a floor that fakes-down a healthy service)", () => {
  const r = computeEffectiveStatus([
    { layer: "synthetic", status: "unknown", detail: {} },
    { layer: "status_page", status: "healthy", detail: {} },
  ]);
  assertEquals(r.effectiveStatus, "healthy");
  assertEquals(r.failedTick, false);
});

Deno.test("ADV: a missing-secret-style all-unknown service never enters alerting across many ticks", () => {
  const s = freshAvail();
  let down = 0;
  let t = 1500 * DAY;
  for (let i = 0; i < 10; i++) {
    const { failedTick } = computeEffectiveStatus([
      { layer: "synthetic", status: "unknown", detail: { error: "SECRET missing" } },
    ]);
    down += availTick(s, failedTick, t).down;
    t += HOUR;
  }
  assertEquals(down, 0, "unknown (e.g. missing secret) must NEVER trigger an email");
  assertEquals(s.current_state, "ok");
});

// ════════════════════════════════════════════════════════════════════════
// ANGLE 1: EMAIL FIRES EXACTLY ONCE per ok→alerting transition
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV: ok→alerting fires exactly ONE down email across the entry ticks", () => {
  const s = freshAvail();
  let down = 0, recovery = 0;
  // 4 consecutive down ticks 1h apart. Entry should fire on tick 2 only;
  // ticks 3,4 are inside the 6h cooldown → NO further email.
  let t = 100 * DAY;
  for (let i = 0; i < 4; i++) {
    const r = availTick(s, true, t);
    down += r.down; recovery += r.recovery;
    t += HOUR;
  }
  assertEquals(down, 1, "exactly one down email on entry; no re-send within 6h");
  assertEquals(recovery, 0);
  assertEquals(s.current_state, "alerting");
  assertEquals(s.consecutive_failures, 4);
});

Deno.test("ADV: N=2 distinguisher — entry email is on the 2nd down tick, NOT the 1st", () => {
  // fail-on-revert for the N=2 gate at THIS angle: a single down tick must
  // leave state 'ok' with zero email; only the consecutive 2nd tick alerts.
  const s = freshAvail();
  const t = 300 * DAY;
  const r1 = availTick(s, true, t);
  assertEquals(r1.down, 0, "first down tick must NOT email (N=2)");
  assertEquals(s.current_state, "ok", "still ok after one fail");
  assertEquals(s.consecutive_failures, 1);
  const r2 = availTick(s, true, t + HOUR);
  assertEquals(r2.down, 1, "second consecutive down tick emails");
  assertEquals(s.current_state, "alerting");
});

Deno.test("ADV: full ok→alerting→ok→alerting cycle = 2 down + 1 recovery (exactly-once each transition)", () => {
  const s = freshAvail();
  let down = 0, recovery = 0;
  let t = 200 * DAY;
  // sequence: F F (enter+1 email) | H (recover+1 email) | F F (re-enter+1 email)
  const seq: boolean[] = [true, true, false, true, true];
  for (const failed of seq) {
    const r = availTick(s, failed, t);
    down += r.down; recovery += r.recovery;
    t += HOUR;
  }
  assertEquals(down, 2, "two separate down transitions → two down emails");
  assertEquals(recovery, 1, "one recovery email");
  assertEquals(s.current_state, "alerting");
});

Deno.test("ADV: a SINGLE tick never produces both a down AND a recovery email", () => {
  // adversarial: try to coerce a same-tick double-fire — impossible because
  // failedTick is a single boolean. Drive every state x failedTick combo.
  for (const cs of ["ok", "alerting"] as const) {
    for (const failed of [true, false]) {
      const d = decideAvailabilityTransitions({
        currentState: cs, consecutiveFailures: 1, lastAlertAt: new Date(0).toISOString(),
        failedTick: failed, nowMs: 1000 * DAY, cooldownMs: SIX_H,
      });
      const both = d.sendDownAlert && d.sendRecoveryAlert;
      assertEquals(both, false, `state=${cs} failed=${failed} must not fire both`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════
// ANGLE 2: COOLDOWN boundary — exactly 6h, 6h-1s, 6h+1s
// ════════════════════════════════════════════════════════════════════════
function cooldownFires(elapsedMs: number): boolean {
  const now = 500 * DAY;
  const d = decideAvailabilityTransitions({
    currentState: "alerting", consecutiveFailures: 5,
    lastAlertAt: new Date(now - elapsedMs).toISOString(),
    failedTick: true, nowMs: now, cooldownMs: SIX_H,
  });
  return d.sendDownAlert;
}
Deno.test("ADV: cooldown boundary — 6h-1s does NOT fire", () => {
  assertEquals(cooldownFires(SIX_H - 1000), false);
});
Deno.test("ADV: cooldown boundary — exactly 6h DOES fire (>= semantics)", () => {
  assertEquals(cooldownFires(SIX_H), true);
});
Deno.test("ADV: cooldown boundary — 6h+1s fires", () => {
  assertEquals(cooldownFires(SIX_H + 1000), true);
});

Deno.test("ADV: 24h of continuous down ticks → at most 4 reminder emails (6h cadence), never hourly", () => {
  const s = freshAvail();
  let down = 0;
  let t = 700 * DAY;
  // 24 hourly ticks, all down. Entry email at tick 2, then re-alert every 6h.
  for (let i = 0; i < 24; i++) {
    down += availTick(s, true, t).down;
    t += HOUR;
  }
  // Entry at tick2 (t+1h). Re-alerts when elapsed>=6h from last_alert_at:
  // entry@1h → re-alerts at 7h,13h,19h within the 0..23h window = 1 entry + 3 reminders = 4.
  if (down > 4) throw new Error(`spam: ${down} emails in 24h (expected <=4)`);
  if (down < 1) throw new Error(`no alert at all in 24h of down`);
  assertEquals(down, 4, "exactly 1 entry + 3 six-hourly reminders in 24h");
});

// ════════════════════════════════════════════════════════════════════════
// ANGLE 3: LOW-BALANCE one-shot
// ════════════════════════════════════════════════════════════════════════
interface BalState { last_balance_state: "ok" | "low" | "unknown"; last_balance_alert_at: string | null; }
function balTick(s: BalState, balanceLow: boolean | null, nowMs: number): number {
  const d = decideBalanceTransition({
    balanceLow, lastBalanceState: s.last_balance_state,
    lastBalanceAlertAt: s.last_balance_alert_at, nowMs, cooldownMs: DAY,
  });
  s.last_balance_state = d.nextBalanceState;
  if (d.setLastBalanceAlertAt) s.last_balance_alert_at = new Date(nowMs).toISOString();
  return d.sendLowBalanceAlert ? 1 : 0;
}

Deno.test("ADV: low-balance threshold-cross fires ONCE, staying below does NOT re-fire hourly", () => {
  const s: BalState = { last_balance_state: "ok", last_balance_alert_at: null };
  let emails = 0;
  let t = 800 * DAY;
  // 24 hourly ticks all low. One email on cross; the rest suppressed (24h cooldown).
  for (let i = 0; i < 24; i++) {
    emails += balTick(s, true, t);
    t += HOUR;
  }
  assertEquals(emails, 1, "one cross email; 23 suppressed within 24h cooldown");
  assertEquals(s.last_balance_state, "low");
});

Deno.test("ADV: low→recovery→low re-fires (state reset proven)", () => {
  const s: BalState = { last_balance_state: "ok", last_balance_alert_at: null };
  let emails = 0;
  let t = 900 * DAY;
  emails += balTick(s, true, t);  t += HOUR;   // cross → 1
  emails += balTick(s, false, t); t += HOUR;   // recover → 0, state ok
  assertEquals(s.last_balance_state, "ok", "must reset to ok on recovery");
  emails += balTick(s, true, t);  t += HOUR;   // re-cross → 1
  assertEquals(emails, 2, "two distinct crosses (recovery reset re-arms the one-shot)");
});

Deno.test("ADV: low-balance re-fires after the 24h cooldown if still low", () => {
  const s: BalState = { last_balance_state: "ok", last_balance_alert_at: null };
  let emails = 0;
  let t = 1000 * DAY;
  emails += balTick(s, true, t);          // cross → 1
  emails += balTick(s, true, t + DAY);    // exactly 24h later, still low → reminder 1
  assertEquals(emails, 2, "one cross + one 24h-cooldown reminder while still low");
});

Deno.test("ADV: no-balance-signal tick never alerts and preserves prior low state", () => {
  const s: BalState = { last_balance_state: "low", last_balance_alert_at: new Date(0).toISOString() };
  const e = balTick(s, null, 2000 * DAY);
  assertEquals(e, 0);
  assertEquals(s.last_balance_state, "low", "null signal must not flip state to ok");
});
