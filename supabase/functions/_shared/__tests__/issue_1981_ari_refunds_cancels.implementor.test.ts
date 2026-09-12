// #1981 — Ari refunds / cancels / installment discovery (implementor).
//
// Fails on revert of:
//   - Idempotency-Key pinned to Ari operation id for refund/cancel/trip-cancel
//   - omit-lines full refund builds remaining Host-parity lines
//   - paid cancel preflight (PAID_ORDER_MUST_REFUND) before cancel-order
//   - get_order_refund_preview + list_trip_installments PII-free reads
//   - PROMPT_VERSION v18 money/discovery ads
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1981_ari_refunds_cancels.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOMAIN_TOOLS,
  DOMAIN_READ_ONLY,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { PROMPT_VERSION, buildSystemPrompt } from "../agentSystemPrompt.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const LINE = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";
const INSTALLMENT = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";
const OP = "88888888-8888-4888-8888-888888888888";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

type InvokeRec = {
  name: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

// deno-lint-ignore no-explicit-any
function moneyClient(opts: {
  payment_method?: string;
  lines?: Array<Record<string, unknown>>;
  refunds?: Array<Record<string, unknown>>;
  installments?: Array<Record<string, unknown>>;
  invoke?: (name: string, body: Record<string, unknown>) => unknown;
} = {}): { client: any; invokes: InvokeRec[] } {
  const invokes: InvokeRec[] = [];
  const orderRow = {
    id: ORDER,
    payment_method: opts.payment_method ?? "card",
    payment_status: "paid",
    currency: "usd",
    total_cents: 2000,
    events: { brand_id: BRAND },
    order_line_items: opts.lines ?? [{
      id: LINE,
      quantity: 2,
      unit_price_cents: 1000,
      total_cents: 2000,
    }],
    refunds: opts.refunds ?? [],
  };
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown, asSingle = false): any => {
    const self: Record<string, unknown> = {};
    for (
      const method of [
        "select",
        "eq",
        "in",
        "is",
        "not",
        "order",
        "limit",
        "gt",
      ]
    ) {
      self[method] = () => self;
    }
    self.maybeSingle = () =>
      Promise.resolve({ data: asSingle ? result : null, error: null });
    self.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({ data: asSingle ? null : result, error: null }).then(
        resolve,
        reject,
      );
    return self;
  };
  return {
    invokes,
    client: {
      functions: {
        // deno-lint-ignore no-explicit-any
        invoke: (name: string, init: any) => {
          invokes.push({
            name,
            body: init?.body ?? {},
            headers: init?.headers,
          });
          const data = opts.invoke
            ? opts.invoke(name, init?.body ?? {})
            : { ok: true };
          return Promise.resolve({ data, error: null });
        },
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "biz_retry_installment") {
          return Promise.resolve({
            data: { ok: true, installment_id: args.p_installment_id },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // deno-lint-ignore no-explicit-any
      from: (table: string): any => {
        if (table === "orders") return chain(orderRow, true);
        if (table === "events") {
          return chain({ id: EVENT, brand_id: BRAND }, true);
        }
        if (table === "order_installments") {
          return chain(opts.installments ?? [{
            id: INSTALLMENT,
            order_id: ORDER,
            status: "failed",
            due_at: "2026-09-01T00:00:00Z",
            amount_cents: 5000,
            currency: "usd",
            ordinal: 1,
          }]);
        }
        if (table === "brands") {
          return chain([{
            id: BRAND,
            name: "B",
            slug: "b",
            default_currency: "usd",
            cover_media_url: null,
          }]);
        }
        if (table === "brand_team_members") return chain([]);
        return chain(null, true);
      },
    },
  };
}

Deno.test("#1981 implementor: money tools finance-gated; discovery read-only", () => {
  for (
    const name of [
      "refund_order",
      "cancel_order",
      "cancel_trip_booking",
      "retry_installment",
      "charge_installment_now",
      "send_installment_reminder",
      "get_order_refund_preview",
      "list_trip_installments",
    ]
  ) {
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], {
      requiredRole: "finance_manager",
      resource: "brand",
    });
  }
  assert(DOMAIN_READ_ONLY.has("get_order_refund_preview"));
  assert(DOMAIN_READ_ONLY.has("list_trip_installments"));
  assert(MONEY_CONFIRM_TOOLS.has("refund_order"));
  assert(MONEY_CONFIRM_TOOLS.has("cancel_order"));
  assert(MONEY_CONFIRM_TOOLS.has("cancel_trip_booking"));
  assert(MONEY_CONFIRM_TOOLS.has("charge_installment_now"));
  assert(!MONEY_CONFIRM_TOOLS.has("retry_installment"));
  assert(!MONEY_CONFIRM_TOOLS.has("send_installment_reminder"));
});

Deno.test("#1981 implementor: PROMPT_VERSION v18 advertises discovery + trip-cancel confirm", () => {
  assertEquals(PROMPT_VERSION, "v18");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(prompt.includes("get_order_refund_preview"));
  assert(prompt.includes("list_trip_installments"));
  assert(prompt.includes("cancel_trip_booking"));
  assert(prompt.includes("charge_installment_now"));
  assert(prompt.includes("Paid orders cannot use cancel_order"));
});

Deno.test("#1981 implementor: refund_order omits lines → full remaining; key = operation id", async () => {
  const { client, invokes } = moneyClient({
    payment_method: "card",
    refunds: [{
      status: "succeeded",
      refund_line_items: [{
        order_line_item_id: LINE,
        quantity: 1,
        amount_cents: 1000,
      }],
    }],
  });
  const result = await domainTool("refund_order").executor(
    {
      brand_id: BRAND,
      order_id: ORDER,
      reason: "Customer requested a remaining refund.",
      confirm_phrase: "REFUND",
    },
    client,
    USER,
    { operationId: OP },
  );
  assertEquals(result, { ok: true });
  assertEquals(invokes.length, 1);
  assertEquals(invokes[0].name, "refund-order");
  assertEquals(invokes[0].headers?.["Idempotency-Key"], OP);
  assertEquals(invokes[0].body.lines, [{
    order_line_item_id: LINE,
    quantity: 1,
    amount_cents: 1000,
  }]);
});

Deno.test("#1981 implementor: refund_order partial lines pass through with same key", async () => {
  const { client, invokes } = moneyClient();
  await domainTool("refund_order").executor(
    {
      brand_id: BRAND,
      order_id: ORDER,
      lines: [{
        order_line_item_id: LINE,
        quantity: 1,
        amount_cents: 1000,
      }],
      reason: "Partial refund for one ticket only.",
      confirm_phrase: "REFUND",
    },
    client,
    USER,
    { operationId: OP },
  );
  assertEquals(invokes[0].headers?.["Idempotency-Key"], OP);
  assertEquals((invokes[0].body.lines as unknown[]).length, 1);
});

Deno.test("#1981 implementor: cancel_order refuses paid before invoke", async () => {
  const { client, invokes } = moneyClient({ payment_method: "card" });
  const err = await assertRejects(
    () =>
      domainTool("cancel_order").executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          reason: "Trying to cancel a paid order.",
          confirm_phrase: "CANCEL",
        },
        client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "PAID_ORDER_MUST_REFUND");
  assert(String(err.message).includes("refund_order"));
  assertEquals(invokes.length, 0);
});

Deno.test("#1981 implementor: cancel_order free path pins Idempotency-Key", async () => {
  const { client, invokes } = moneyClient({ payment_method: "free" });
  await domainTool("cancel_order").executor(
    {
      brand_id: BRAND,
      order_id: ORDER,
      reason: "Free order no longer needed.",
      confirm_phrase: "CANCEL",
    },
    client,
    USER,
    { operationId: OP },
  );
  assertEquals(invokes[0].name, "cancel-order");
  assertEquals(invokes[0].headers?.["Idempotency-Key"], OP);
});

Deno.test("#1981 implementor: cancel_trip_booking commits exact preview with operation key", async () => {
  const { client, invokes } = moneyClient({
    invoke: (_name, body) =>
      body.mode === "preview" ? { refundTotalCents: 2500 } : { ok: true },
  });
  await domainTool("cancel_trip_booking").executor(
    {
      brand_id: BRAND,
      booking_id: BOOKING,
      reason: "Operator cancelled the departure.",
      confirm_phrase: "CANCEL",
    },
    client,
    USER,
    { operationId: OP },
  );
  assertEquals(invokes.length, 2);
  assertEquals(invokes[1].body.expectedRefundTotalCents, 2500);
  assertEquals(invokes[1].headers?.["Idempotency-Key"], OP);
});

Deno.test("#1981 implementor: retry_installment calls biz_retry_installment", async () => {
  const { client } = moneyClient();
  const result = await domainTool("retry_installment").executor(
    { brand_id: BRAND, installment_id: INSTALLMENT },
    client,
    USER,
  );
  assertEquals(result.ok, true);
  assertEquals(result.installment_id, INSTALLMENT);
});

Deno.test("#1981 implementor: get_order_refund_preview omits buyer PII", async () => {
  const { client } = moneyClient({ payment_method: "card" });
  const result = await domainTool("get_order_refund_preview").executor(
    { brand_id: BRAND, order_id: ORDER },
    client,
    USER,
  );
  assertEquals(result.order_id, ORDER);
  assertEquals(result.payment_method, "card");
  assert(Array.isArray(result.refundable_lines));
  const blob = JSON.stringify(result);
  assert(!blob.includes("buyer"));
  assert(!blob.includes("email"));
  assert(!blob.includes("phone"));
  assert(!blob.includes("name"));
});

Deno.test("#1981 implementor: list_trip_installments returns ids only", async () => {
  const { client } = moneyClient();
  const result = await domainTool("list_trip_installments").executor(
    { brand_id: BRAND, event_id: EVENT },
    client,
    USER,
  );
  assertEquals(result.event_id, EVENT);
  assertEquals(result.installments[0].installment_id, INSTALLMENT);
  assertEquals(result.installments[0].order_id, ORDER);
  const blob = JSON.stringify(result);
  assert(!blob.includes("buyer"));
  assert(!blob.includes("email"));
  assert(!blob.includes("phone"));
});
