import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAdminSourceRefundActionHandler } from "../index.ts";

const REFUND_ID = "12210000-0000-4000-8000-000000000027";

function request(body: string): Request {
  return new Request("https://refunds.test/admin-source-refund-action", {
    method: "POST",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json",
    },
    body,
  });
}

Deno.test("Recovery rejects duplicate, unknown, oversized, and cross-action fields before RPC", async () => {
  let calls = 0;
  const handler = createAdminSourceRefundActionHandler(async () => ({
    userId: "12210000-0000-4000-8000-000000000001",
    userEmail: "admin@mingla.test",
    isActiveAdmin: true,
    rpc: async () => {
      calls += 1;
      return { data: {}, error: null };
    },
  }));
  const cases = [
    `{"refundId":"${REFUND_ID}","action":"invalidate_and_resend_attention","expectedGeneration":3,"expectedGeneration":4,"reasonCode":"recipient_requested_resend"}`,
    JSON.stringify({
      refundId: REFUND_ID,
      action: "invalidate_and_resend_attention",
      expectedGeneration: 3,
      reasonCode: "recipient_requested_resend",
      channel: "email",
    }),
    JSON.stringify({
      refundId: REFUND_ID,
      action: "reclaim_confirmed_unsent",
      expectedGeneration: 3,
      deliveryId: "12210000-0000-4000-8000-000000000028",
      channel: "sms",
      newContact: "+14155550100",
      reasonCode: "provider_confirmed_unsent",
    }),
    JSON.stringify({
      refundId: REFUND_ID,
      action: "correct_attention_contact",
      expectedGeneration: 3,
      channel: "email",
      newContact: `${"a".repeat(4050)}@example.com`,
      reasonCode: "invalid_recipient",
    }),
  ];

  for (const body of cases) {
    const response = await handler(request(body));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "invalid_request" });
  }
  assertEquals(calls, 0);
});

Deno.test("Recovery fails closed for invalid contacts, generations, reasons, and authorization", async () => {
  const activeHandler = createAdminSourceRefundActionHandler(async () => ({
    userId: "12210000-0000-4000-8000-000000000001",
    userEmail: "admin@mingla.test",
    isActiveAdmin: true,
    rpc: async () => ({ data: {}, error: null }),
  }));
  const invalidBodies = [
    {
      refundId: REFUND_ID,
      action: "correct_attention_contact",
      expectedGeneration: 0,
      channel: "sms",
      newContact: "+14155550100",
      reasonCode: "invalid_recipient",
    },
    {
      refundId: REFUND_ID,
      action: "correct_attention_contact",
      expectedGeneration: 3,
      channel: "sms",
      newContact: "(415) 555-0100",
      reasonCode: "invalid_recipient",
    },
    {
      refundId: REFUND_ID,
      action: "correct_attention_contact",
      expectedGeneration: 3,
      channel: "email",
      newContact: "guest@localhost",
      reasonCode: "recipient_updated_contact",
    },
    {
      refundId: REFUND_ID,
      action: "invalidate_and_resend_attention",
      expectedGeneration: 3,
      reasonCode: "free_text_reason",
    },
  ];
  for (const body of invalidBodies) {
    assertEquals(
      (await activeHandler(request(JSON.stringify(body)))).status,
      400,
    );
  }

  const inactiveHandler = createAdminSourceRefundActionHandler(async () => ({
    userId: "12210000-0000-4000-8000-000000000001",
    userEmail: "admin@mingla.test",
    isActiveAdmin: false,
  }));
  const response = await inactiveHandler(request(JSON.stringify({
    refundId: REFUND_ID,
    action: "invalidate_and_resend_attention",
    expectedGeneration: 3,
    reasonCode: "recipient_requested_resend",
  })));
  assertEquals(response.status, 403);
});

Deno.test("Recovery source contains no request or contact logging path", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    "admin_request_source_refund_attention_recovery",
  );
  assertEquals(source.includes("console."), false);
  assertEquals(source.includes("JSON.stringify(body)"), false);
  assertEquals(source.includes("request body"), false);
});
