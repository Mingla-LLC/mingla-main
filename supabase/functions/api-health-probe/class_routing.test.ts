// ORCH-1201-R2 — Implementor happy-path REGRESSION test (must FAIL on revert).
// Run: deno test supabase/functions/api-health-probe/class_routing.test.ts
//
// LOAD-BEARING behaviors proven here (each fails if the R2 correction is reverted):
//   • A processor (Stripe/Paystack) at $0 balance does NOT alert — the old
//     evaluateBalance(paystack) branch returning `bal < threshold` would FAIL this.
//   • OpenAI insufficient_quota (429) ⇒ depleted; rate_limit_exceeded (429) ⇒ NOT
//     — keying off bare 429 would FAIL this (the disambiguation).
//   • Cloudinary 747.88% used ⇒ low + CRIT severity — the old (limit-used)/limit
//     remaining-percent math @ warn-remaining-10% would FAIL this.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLASS_B_DEPLETION,
  type DepletionObs,
  evaluateBalanceForSignal,
  matchClassBDepletion,
} from "./logic.ts";

const row = (http: number, code: string | null, text: string | null): DepletionObs => ({
  http_status: http, error_code: code, error_text: text, observed_at: new Date().toISOString(),
});

Deno.test("REGRESSION: processor at $0 balance does NOT alert (Stripe + Paystack)", () => {
  // Both processors, ANY balance value (incl. 0 settled funds), with a balance
  // signal forced in: result must STILL be balanceLow:null. Reverting to a
  // processor balance-threshold branch flips this to true/false and FAILS.
  for (const proc of ["stripe", "paystack"]) {
    const r = evaluateBalanceForSignal(proc, { balance: 0, currency: "usd" }, { kind: "twilio_balance", warn: 25, crit: 5 });
    assertEquals(r.balanceLow, null, `${proc} must never emit a balance alert`);
    assertEquals(r.severity, null);
  }
});

Deno.test("REGRESSION: OpenAI disambiguation — insufficient_quota depletes, rate_limit does not", () => {
  const sig = CLASS_B_DEPLETION.openai;
  // 6 transient rate-limits ⇒ NO depletion.
  const transientRows = Array.from({ length: 6 }, () => row(429, "rate_limit_exceeded", "Rate limit reached"));
  assertEquals(matchClassBDepletion(sig, transientRows).depleted, false);
  // inject ONE insufficient_quota ⇒ depleted.
  const withQuota = [...transientRows, row(429, "insufficient_quota", "You exceeded your current quota")];
  const dep = matchClassBDepletion(sig, withQuota);
  assertEquals(dep.depleted, true);
  assertEquals(dep.lastErrorCode, "insufficient_quota");
});

Deno.test("REGRESSION: Cloudinary 747.88% used ⇒ low + CRIT (red dot)", () => {
  const r = evaluateBalanceForSignal("cloudinary", { used_percent: 747.88 }, { kind: "cloudinary_used_pct", warn: 80, crit: 100 });
  assertEquals(r.balanceLow, true);
  assertEquals(r.severity, "crit");
});

Deno.test("REGRESSION: Serper 'Not enough credits' single observation ⇒ depleted immediately", () => {
  // No 5-sample floor for an explicit depletion body.
  const dep = matchClassBDepletion(CLASS_B_DEPLETION.serper, [row(403, "not_enough_credits", "Not enough credits")]);
  assertEquals(dep.depleted, true);
});
