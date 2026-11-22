/**
 * issue #4522 (rework N7) — a late, retried or replayed flexible settlement
 * that completes the balance sends the paid-in-full email (same dispatcher
 * as the normal path), once per order and never twice; money held by that
 * settlement goes straight to the overpayment lane.
 *
 * FAILS-ON-REVERT: drop the claim from afterFlexSettle (send whenever
 * paidInFull) -> the replay sends a second email -> red.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { afterFlexSettle } from "../../installmentWebhookHandlers.ts";
import { resetPlanV2SchemaProbeForTests } from "../planV2Schema.ts";

function fake(claims: boolean[]) {
  const calls: string[] = [];
  const client = {
    rpc(fn: string) {
      calls.push(fn);
      if (fn === "issue_4522_plan_v2_enabled") return Promise.resolve({ data: true, error: null });
      if (fn === "issue_4522_claim_paid_in_full_notice") {
        return Promise.resolve({ data: claims.shift() ?? false, error: null });
      }
      if (fn === "issue_4522_overpayments_due") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { calls, client };
}

Deno.test("N7 a late settlement that completes the balance sends the email once; its replay sends nothing", async () => {
  resetPlanV2SchemaProbeForTests();
  const f = fake([true, false]);
  const sent: string[] = [];
  const send = (orderId: string) => {
    sent.push(orderId);
    return Promise.resolve();
  };
  // deno-lint-ignore no-explicit-any
  const supabase = f.client as any;
  await afterFlexSettle(supabase, { ok: true, paidInFull: true, completedBalance: true, heldMinor: 0, orderId: "o-1" },
    "stripe_late_success", send);
  await afterFlexSettle(supabase, { ok: true, replayed: true, paidInFull: true, orderId: "o-1" },
    "stripe_webhook_replay", send);
  assertEquals(sent, ["o-1"]);
  assertEquals(f.calls.filter((c) => c === "issue_4522_claim_paid_in_full_notice").length, 2);
  resetPlanV2SchemaProbeForTests();
});

Deno.test("N7 not paid in full: no claim, no email; N2 held money goes to the lane", async () => {
  resetPlanV2SchemaProbeForTests();
  const f = fake([true]);
  const sent: string[] = [];
  // deno-lint-ignore no-explicit-any
  await afterFlexSettle(f.client as any, { ok: true, paidInFull: false, heldMinor: 10000, orderId: "o-2" },
    "stripe_webhook_replay", (id) => {
      sent.push(id);
      return Promise.resolve();
    });
  assertEquals(sent, []);
  assertEquals(f.calls.includes("issue_4522_claim_paid_in_full_notice"), false);
  assertEquals(f.calls.includes("issue_4522_overpayments_due"), true);
  resetPlanV2SchemaProbeForTests();
});
