import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Admin renders captured queue and live detail semantics", () => {
  const page = fs.readFileSync(
    path.resolve(here, "../pages/RefundOperationsPage.jsx"),
    "utf8",
  );
  assert.match(page, /Queue captured at/);
  assert.match(page, /Live details/);
  assert.match(page, /Load more/);
  assert.match(page, /Attention recovery/);
  assert.match(page, /Correct guest contact/);
  assert.match(page, /Reclaim confirmed-unsent delivery/);
  assert.match(page, /Invalidate and resend attention link/);
  assert.match(
    page,
    /contact updated — invalidate and resend required/,
  );
  assert.doesNotMatch(page, /JSON\.stringify\(selected/);
});

const {
  appendCapturedQueuePage,
  recoverSourceRefundAttention,
} = await import(
  "../services/refundOperationsService.js"
);

test("Admin queue appends contiguous immutable ordinal pages", () => {
  const first = {
    snapshot_id: "12210000-0000-4000-8000-000000000027",
    snapshot_created_at: "2030-01-04T00:00:00.000Z",
    items: [{ ordinal: 0, itemKind: "refund_operation", itemId: "a" }],
  };
  const second = {
    ...first,
    items: [{ ordinal: 1, itemKind: "refund_operation", itemId: "b" }],
  };
  const third = {
    ...first,
    items: [{ ordinal: 2, itemKind: "refund_operation", itemId: "c" }],
  };
  const captured = appendCapturedQueuePage(
    appendCapturedQueuePage(first, second),
    third,
  );
  assert.deepEqual(
    captured.items.map(({ ordinal, itemId }) => [ordinal, itemId]),
    [[0, "a"], [1, "b"], [2, "c"]],
  );
});

test("Admin recovery service sends exact discriminated action bodies", async () => {
  const calls = [];
  const invoke = async (name, request) => {
    calls.push({ name, body: request.body });
    return { data: { refund: { accepted: true } }, error: null };
  };
  await recoverSourceRefundAttention({
    refundId: "12210000-0000-4000-8000-000000000027",
    action: "correct_attention_contact",
    expectedGeneration: 3,
    channel: "email",
    newContact: "guest@example.test",
    reasonCode: "recipient_updated_contact",
  }, invoke);
  await recoverSourceRefundAttention({
    refundId: "12210000-0000-4000-8000-000000000027",
    action: "reclaim_confirmed_unsent",
    expectedGeneration: 3,
    deliveryId: "12210000-0000-4000-8000-000000000028",
    channel: "sms",
    reasonCode: "provider_confirmed_unsent",
  }, invoke);
  await recoverSourceRefundAttention({
    refundId: "12210000-0000-4000-8000-000000000027",
    action: "invalidate_and_resend_attention",
    expectedGeneration: 3,
    reasonCode: "delivery_acceptance_unknown",
  }, invoke);
  assert.deepEqual(calls, [
    {
      name: "admin-source-refund-action",
      body: {
        refundId: "12210000-0000-4000-8000-000000000027",
        action: "correct_attention_contact",
        expectedGeneration: 3,
        reasonCode: "recipient_updated_contact",
        channel: "email",
        newContact: "guest@example.test",
      },
    },
    {
      name: "admin-source-refund-action",
      body: {
        refundId: "12210000-0000-4000-8000-000000000027",
        action: "reclaim_confirmed_unsent",
        expectedGeneration: 3,
        reasonCode: "provider_confirmed_unsent",
        deliveryId: "12210000-0000-4000-8000-000000000028",
        channel: "sms",
      },
    },
    {
      name: "admin-source-refund-action",
      body: {
        refundId: "12210000-0000-4000-8000-000000000027",
        action: "invalidate_and_resend_attention",
        expectedGeneration: 3,
        reasonCode: "delivery_acceptance_unknown",
      },
    },
  ]);
});
