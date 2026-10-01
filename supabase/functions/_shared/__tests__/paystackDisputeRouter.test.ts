/**
 * Issue #3645 — Paystack dispute router unit coverage (Deno).
 * Proves create/remind/resolve call record_paystack_dispute_outcome with the
 * Paystack identity fields, and that missing identity fails so inbox can retry.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePaystackDisputeEvent } from "../paystackDisputeRouter.ts";

type RpcCall = { name: string; args: Record<string, unknown> };

function mockClient(opts: {
  rpcResult?: { data: unknown; error: { message: string } | null };
  calls?: RpcCall[];
}) {
  const calls = opts.calls ?? [];
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(
        opts.rpcResult ?? {
          data: {
            matched: true,
            brand_id: "brand-1",
            order_id: "order-1",
            response_due_by: "2026-10-02T04:00:00.000Z",
            debt_created: false,
          },
          error: null,
        },
      );
    },
  } as never;
}

Deno.test("charge.dispute.create posts create event + transaction reference", async () => {
  const calls: RpcCall[] = [];
  const priorLegacy = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  const priorBundle = Deno.env.get("MINGLA_ALERT_RECIPIENTS_JSON");
  Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
  try {
    await handlePaystackDisputeEvent(
      mockClient({ calls }),
      "charge.dispute.create",
      {
        id: "dsp_1",
        status: "pending",
        amount: 5000,
        currency: "NGN",
        due_at: "2026-10-02T04:00:00.000Z",
        transaction: { reference: "psk_ref_1", amount: 5000 },
      },
    );
    assertEquals(calls.length, 1);
    assertEquals(calls[0].name, "record_paystack_dispute_outcome");
    assertEquals(calls[0].args.p_paystack_dispute_id, "dsp_1");
    assertEquals(calls[0].args.p_transaction_reference, "psk_ref_1");
    assertEquals(calls[0].args.p_event_name, "charge.dispute.create");
    assertEquals(calls[0].args.p_amount_cents, 5000);
  } finally {
    if (priorLegacy === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", priorLegacy);
    if (priorBundle === undefined) Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    else Deno.env.set("MINGLA_ALERT_RECIPIENTS_JSON", priorBundle);
  }
});

Deno.test("charge.dispute.resolve forwards merchant-accepted resolution", async () => {
  const calls: RpcCall[] = [];
  const priorLegacy = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  const priorBundle = Deno.env.get("MINGLA_ALERT_RECIPIENTS_JSON");
  Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
  try {
    await handlePaystackDisputeEvent(
      mockClient({
        calls,
        rpcResult: {
          data: {
            matched: true,
            brand_id: null,
            debt_created: true,
            response_due_by: null,
          },
          error: null,
        },
      }),
      "charge.dispute.resolve",
      {
        id: "dsp_2",
        resolution: "merchant-accepted",
        status: "resolved",
        amount: 1200,
        currency: "ngn",
        transaction_reference: "psk_ref_2",
      },
    );
    assertEquals(calls[0].args.p_resolution, "merchant-accepted");
    assertEquals(calls[0].args.p_event_name, "charge.dispute.resolve");
  } finally {
    if (priorLegacy === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", priorLegacy);
    if (priorBundle === undefined) Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    else Deno.env.set("MINGLA_ALERT_RECIPIENTS_JSON", priorBundle);
  }
});

Deno.test("missing dispute identity fails so inbox can retry", async () => {
  const calls: RpcCall[] = [];
  await assertRejects(
    () =>
      handlePaystackDisputeEvent(mockClient({ calls }), "charge.dispute.remind", {
        status: "pending",
      }),
    Error,
    "paystack_dispute_identity_missing",
  );
  assertEquals(calls.length, 0);
});

Deno.test("RPC failure surfaces", async () => {
  await assertRejects(
    () =>
      handlePaystackDisputeEvent(
        mockClient({
          rpcResult: { data: null, error: { message: "boom" } },
        }),
        "charge.dispute.create",
        { id: "dsp_x", transaction: { reference: "ref_x" }, amount: 1 },
      ),
    Error,
    "paystack_dispute_record_failed:boom",
  );
});
