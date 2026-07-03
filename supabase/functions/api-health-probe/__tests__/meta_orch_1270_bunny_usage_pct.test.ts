// META-ORCH-1270 (Phase 2) — implementor test: bunny_usage_pct balance eval +
// the account-usage percent computation, incl. the VECTOR-D null→warn guard.
//
// FAILS ON REVERT: delete the `bunny_usage_pct` case in
// api-health-probe/logic.ts (evaluateBalanceForSignal) → the switch falls to
// default → every assertion below (esp. the probe_unreadable warn) throws.
//
// Run: deno test --allow-none --no-check
//   supabase/functions/api-health-probe/__tests__/meta_orch_1270_bunny_usage_pct.test.ts

import { evaluateBalanceForSignal } from "../logic.ts";
import { bunnyUsagePct } from "../../_shared/bunnyStream.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const SIG = { kind: "bunny_usage_pct", warn: 60, crit: 85, unit: "pct_used" };

Deno.test("bunny_usage_pct: >=warn but <crit → balanceLow warn", () => {
  const r = evaluateBalanceForSignal("bunny", { used_percent: 72 }, SIG);
  assert(r.balanceLow === true, `expected balanceLow true at 72%, got ${String(r.balanceLow)}`);
  assert(r.severity === "warn", `expected severity warn at 72%, got ${String(r.severity)}`);
});

Deno.test("bunny_usage_pct: >=crit → balanceLow crit", () => {
  const r = evaluateBalanceForSignal("bunny", { used_percent: 90 }, SIG);
  assert(r.balanceLow === true, "expected balanceLow true at 90%");
  assert(r.severity === "crit", `expected severity crit at 90%, got ${String(r.severity)}`);
});

Deno.test("bunny_usage_pct: under warn → not low", () => {
  const r = evaluateBalanceForSignal("bunny", { used_percent: 40 }, SIG);
  assert(r.balanceLow === false, `expected balanceLow false at 40%, got ${String(r.balanceLow)}`);
  assert(r.severity === null, "expected no severity at 40%");
});

Deno.test("bunny_usage_pct: probe_unreadable → DISTINCT warn (never silent-green)", () => {
  // The Vector-D root cause: a config-present-but-unreadable usage read must FIRE,
  // not resolve to {balanceLow:null} / healthy.
  const r = evaluateBalanceForSignal("bunny", { probe_unreadable: true, used_percent: null }, SIG);
  assert(r.balanceLow === true, `expected balanceLow true on probe_unreadable, got ${String(r.balanceLow)}`);
  assert(r.severity === "warn", `expected severity warn on probe_unreadable, got ${String(r.severity)}`);
  assert(
    typeof r.balanceText === "string" && r.balanceText.includes("probe_unreadable"),
    "balanceText should name the probe_unreadable condition",
  );
});

Deno.test("bunny_usage_pct: config-absent (no used_percent, not unreadable) → no signal (grey, no alert)", () => {
  const r = evaluateBalanceForSignal("bunny", {}, SIG);
  assert(r.balanceLow === null, `expected balanceLow null when config absent, got ${String(r.balanceLow)}`);
});

Deno.test("bunnyUsagePct: takes the MAX of storage/traffic ratios", () => {
  // storage 30/100 = 30%; traffic 50/100 = 50% → max = 50%.
  const r = bunnyUsagePct({ storageUsage: 30, trafficUsage: 50, storageCapBytes: 100, trafficCapBytes: 100 });
  assert(r !== null, "expected a computed pct");
  assert(Math.abs((r as { usedPercent: number }).usedPercent - 50) < 1e-9, `expected 50%, got ${(r as { usedPercent: number }).usedPercent}`);
});

Deno.test("bunnyUsagePct: non-numeric usage → null (unreadable, never healthy)", () => {
  const r = bunnyUsagePct({ storageUsage: "n/a", trafficUsage: 5, storageCapBytes: 100, trafficCapBytes: 100 });
  assert(r === null, "expected null on non-numeric usage");
});

Deno.test("bunnyUsagePct: non-positive cap → null (cannot compute)", () => {
  const r = bunnyUsagePct({ storageUsage: 10, trafficUsage: 5, storageCapBytes: 0, trafficCapBytes: 100 });
  assert(r === null, "expected null on a zero cap");
});
