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
import { claimPaidInFullNotice, sendUnsentPaidInFullNotices } from "../paidInFullNotice.ts";

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

// Pass 6 (S9-2) — a claim that errors once sends nothing then (never twice),
// and the next instalment run sends it: the order is listed as paid with no
// claim, claimed there, sent once; a later run lists nothing more.
// FAILS-ON-REVERT: without sendUnsentPaidInFullNotices the email is never sent.
Deno.test("S9-2 an unanswered claim is retried by the next run, still exactly once", async () => {
  resetPlanV2SchemaProbeForTests();
  const claimed = new Set<string>();
  let claimErrors = 1;
  const client = {
    rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "issue_4522_plan_v2_enabled") return Promise.resolve({ data: true, error: null });
      if (fn === "issue_4522_claim_paid_in_full_notice") {
        if (claimErrors > 0) {
          claimErrors -= 1;
          return Promise.resolve({ data: null, error: { message: "connection reset" } });
        }
        const id = String(args?.p_order_id);
        const first = !claimed.has(id);
        claimed.add(id);
        return Promise.resolve({ data: first, error: null });
      }
      if (fn === "issue_4522_unsent_paid_in_full") {
        return Promise.resolve({ data: claimed.has("o-9") ? [] : ["o-9"], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  const sent: string[] = [];
  const send = (orderId: string) => {
    sent.push(orderId);
    return Promise.resolve();
  };
  // the normal path: its claim errors, so nothing goes out now
  assertEquals(await claimPaidInFullNotice(client, "o-9", "stripe_webhook"), false);
  assertEquals(sent, []);
  // the next run sends it, the run after sends nothing more
  assertEquals(await sendUnsentPaidInFullNotices(client, send), 1);
  assertEquals(await sendUnsentPaidInFullNotices(client, send), 0);
  assertEquals(sent, ["o-9"]);
  resetPlanV2SchemaProbeForTests();
});
