import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAdminSourceRefundActionHandler } from "../index.ts";

const REFUND_ID = "12210000-0000-4000-8000-000000000027";
const DELIVERY_ID = "12210000-0000-4000-8000-000000000028";

function adminHandler(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
) {
  return createAdminSourceRefundActionHandler(async () => ({
    userId: "12210000-0000-4000-8000-000000000001",
    userEmail: "admin@mingla.test",
    isActiveAdmin: true,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          summary: { refund_id: args.p_refund_id },
          recovery: { generation: args.p_expected_generation },
        },
        error: null,
      };
    },
  }));
}

function request(body: string | Record<string, unknown>): Request {
  return new Request("https://refunds.test/admin-source-refund-action", {
    method: "POST",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("Admin correction normalizes contact and calls only the recovery RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const response = await adminHandler(calls)(request({
    refundId: REFUND_ID,
    action: "correct_attention_contact",
    expectedGeneration: 3,
    channel: "email",
    newContact: "  Guest@Example.COM ",
    reasonCode: "recipient_updated_contact",
  }));

  assertEquals(response.status, 202);
  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].name,
    "admin_request_source_refund_attention_recovery",
  );
  assertEquals(calls[0].args.p_new_contact, "guest@example.com");
  assertEquals(calls[0].args.p_delivery_id, null);
  assertEquals(calls[0].args.p_actor_email, "admin@mingla.test");
});

Deno.test("Admin recovery uses exact action-specific request shapes", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handler = adminHandler(calls);

  const reclaim = await handler(request({
    refundId: REFUND_ID,
    action: "reclaim_confirmed_unsent",
    expectedGeneration: 3,
    deliveryId: DELIVERY_ID,
    channel: "sms",
    reasonCode: "provider_confirmed_unsent",
  }));
  const invalidate = await handler(request({
    refundId: REFUND_ID,
    action: "invalidate_and_resend_attention",
    expectedGeneration: 3,
    reasonCode: "delivery_acceptance_unknown",
  }));

  assertEquals(reclaim.status, 202);
  assertEquals(invalidate.status, 202);
  assertEquals(calls[0].args.p_delivery_id, DELIVERY_ID);
  assertEquals(calls[0].args.p_channel, "sms");
  assertEquals(calls[1].args.p_delivery_id, null);
  assertEquals(calls[1].args.p_channel, null);
  assertEquals(calls[1].args.p_new_contact, null);
});

Deno.test("Admin recovery returns one uniform conflict without leaking RPC detail", async () => {
  const handler = createAdminSourceRefundActionHandler(async () => ({
    userId: "12210000-0000-4000-8000-000000000001",
    userEmail: "admin@mingla.test",
    isActiveAdmin: true,
    rpc: async () => ({
      data: null,
      error: { message: "raw database predicate detail" },
    }),
  }));
  const response = await handler(request({
    refundId: REFUND_ID,
    action: "invalidate_and_resend_attention",
    expectedGeneration: 3,
    reasonCode: "recipient_requested_resend",
  }));

  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload, { error: "attention_recovery_conflict" });
  assertExists(response.headers.get("cache-control"));
});
