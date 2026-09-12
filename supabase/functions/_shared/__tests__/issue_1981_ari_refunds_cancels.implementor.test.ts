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
  DOMAIN_READ_ONLY,
  DOMAIN_TOOLS,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
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
        "or",
        "lte",
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
          return chain(
            opts.installments ?? [{
              id: INSTALLMENT,
              order_id: ORDER,
              status: "failed",
              due_at: "2026-09-01T00:00:00Z",
              amount_cents: 5000,
              currency: "usd",
              ordinal: 1,
            }],
          );
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
    ]
  ) {
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], {
      requiredRole: "finance_manager",
      resource: "brand",
    });
  }
  // [TEST-MOD-APPROVED #1981] event resource so EVENT_TYPE_BY_TOOL rejects non-trips.
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_trip_installments, {
    requiredRole: "finance_manager",
    resource: "event",
  });
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

Deno.test("#1981 implementor: refund_order partial lines recompute amount_cents server-side", async () => {
  const { client, invokes } = moneyClient();
  await domainTool("refund_order").executor(
    {
      brand_id: BRAND,
      order_id: ORDER,
      lines: [{
        order_line_item_id: LINE,
        quantity: 1,
        amount_cents: 1, // attacker/model underpay — must be ignored
      }],
      reason: "Partial refund for one ticket only.",
      confirm_phrase: "REFUND",
    },
    client,
    USER,
    { operationId: OP },
  );
  assertEquals(invokes[0].headers?.["Idempotency-Key"], OP);
  assertEquals(invokes[0].body.lines, [{
    order_line_item_id: LINE,
    quantity: 1,
    amount_cents: 1000,
  }]);
});

Deno.test("#1981 implementor: refund_order rejects present-but-empty lines", async () => {
  const { client, invokes } = moneyClient();
  const err = await assertRejects(
    () =>
      domainTool("refund_order").executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          lines: [],
          reason: "Empty lines must not become a full refund.",
          confirm_phrase: "REFUND",
        },
        client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assert(String(err.message).includes("non-empty"));
  assertEquals(invokes.length, 0);
});

Deno.test("#1981 implementor: refund_order rejects explicit null lines", async () => {
  const { client, invokes } = moneyClient();
  const err = await assertRejects(
    () =>
      domainTool("refund_order").executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          lines: null,
          reason: "Null lines must not become a full refund.",
          confirm_phrase: "REFUND",
        },
        client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assert(String(err.message).includes("non-empty"));
  assertEquals(invokes.length, 0);
});

Deno.test("#1981 implementor: refund_order aggregates duplicate line ids before capacity", async () => {
  const { client, invokes } = moneyClient();
  const err = await assertRejects(
    () =>
      domainTool("refund_order").executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          lines: [
            { order_line_item_id: LINE, quantity: 2, amount_cents: 1 },
            { order_line_item_id: LINE, quantity: 1, amount_cents: 1 },
          ],
          reason: "Duplicate line ids must not over-refund capacity.",
          confirm_phrase: "REFUND",
        },
        client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assert(String(err.message).includes("only has"));
  assertEquals(invokes.length, 0);

  const { client: okClient, invokes: okInvokes } = moneyClient();
  await domainTool("refund_order").executor(
    {
      brand_id: BRAND,
      order_id: ORDER,
      lines: [
        { order_line_item_id: LINE, quantity: 1, amount_cents: 1 },
        { order_line_item_id: LINE, quantity: 1, amount_cents: 1 },
      ],
      reason: "Duplicate line ids aggregate within remaining capacity.",
      confirm_phrase: "REFUND",
    },
    okClient,
    USER,
    { operationId: OP },
  );
  assertEquals(okInvokes[0].body.lines, [{
    order_line_item_id: LINE,
    quantity: 2,
    amount_cents: 2000,
  }]);
});

Deno.test("#1981 implementor: refund preview subtracts pending refunds", async () => {
  const { client } = moneyClient({
    payment_method: "card",
    refunds: [{
      status: "pending",
      refund_line_items: [{
        order_line_item_id: LINE,
        quantity: 2,
        amount_cents: 2000,
      }],
    }],
  });
  const result = await domainTool("get_order_refund_preview").executor(
    { brand_id: BRAND, order_id: ORDER },
    client,
    USER,
  );
  assertEquals(result.refundable_lines, []);
  assertEquals(result.refundable_total_cents, 0);
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

Deno.test("#1981 implementor: omit-lines rejects when zero-priced tickets remain", async () => {
  const { client, invokes } = moneyClient({
    payment_method: "card",
    lines: [
      {
        id: LINE,
        quantity: 1,
        unit_price_cents: 1000,
        total_cents: 1000,
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        quantity: 1,
        unit_price_cents: 0,
        total_cents: 0,
      },
    ],
  });
  const err = await assertRejects(
    () =>
      domainTool("refund_order").executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          reason: "Full refund must not silently skip free tickets.",
          confirm_phrase: "REFUND",
        },
        client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assert(String(err.message).toLowerCase().includes("zero-priced"));
  assertEquals(invokes.length, 0);
});

Deno.test("#1981 implementor: cancel_trip_booking refuses foreign-brand booking before preview", async () => {
  const FOREIGN = "99999999-9999-4999-8999-999999999999";
  const { client, invokes } = moneyClient();
  // Override orders so booking belongs to a different brand.
  client.from = (table: string) => {
    if (table === "orders") {
      const row = {
        id: BOOKING,
        payment_method: "card",
        payment_status: "paid",
        currency: "usd",
        total_cents: 2500,
        events: { brand_id: FOREIGN },
        order_line_items: [],
        refunds: [],
      };
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
          "or",
          "lte",
          "gt",
        ]
      ) {
        self[method] = () => self;
      }
      self.maybeSingle = () => Promise.resolve({ data: row, error: null });
      return self;
    }
    return moneyClient().client.from(table);
  };
  const err = await assertRejects(
    () =>
      domainTool("cancel_trip_booking").executor(
        {
          brand_id: BRAND,
          booking_id: BOOKING,
          reason: "Cross-tenant cancel must refuse.",
          confirm_phrase: "CANCEL",
        },
        client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assert(String(err.message).includes("brand"));
  assertEquals(invokes.length, 0);
});

Deno.test("#1981 implementor: installment money tools refuse non-trip events", async () => {
  const { authorizeAgentTool } = await import("../agentToolAuthorization.ts");
  const FOREIGN_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  // deno-lint-ignore no-explicit-any
  const client: any = {
    rpc: () => Promise.resolve({ data: 50, error: null }),
    from: (table: string) => {
      const self: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) {
        self[method] = () => self;
      }
      self.maybeSingle = () => {
        if (table === "order_installments") {
          return Promise.resolve({
            data: { order_id: ORDER },
            error: null,
          });
        }
        if (table === "orders") {
          return Promise.resolve({
            data: { event_id: FOREIGN_EVENT },
            error: null,
          });
        }
        if (table === "events") {
          return Promise.resolve({
            data: { brand_id: BRAND, event_type: "event" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };
      return self;
    },
  };
  for (
    const [name, args] of [
      ["retry_installment", {
        brand_id: BRAND,
        installment_id: INSTALLMENT,
      }],
      ["charge_installment_now", {
        brand_id: BRAND,
        installment_id: INSTALLMENT,
        confirm_phrase: "CHARGE",
      }],
      ["send_installment_reminder", {
        brand_id: BRAND,
        order_id: ORDER,
      }],
    ] as const
  ) {
    const tool = domainTool(name);
    const auth = AGENT_TOOL_AUTHORIZATION[name];
    assert(auth, `${name} must be ledgered`);
    const err = await assertRejects(
      () =>
        authorizeAgentTool(
          {
            name,
            parameters: tool.parameters,
            requiredRole: auth.requiredRole,
            resource: auth.resource,
          },
          args,
          client,
          USER,
        ),
      ToolError,
    );
    assertEquals(
      err.code,
      "BRAND_ACCESS_DENIED",
      `${name} must deny non-trip via EVENT_TYPE_BY_TOOL`,
    );
  }
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

Deno.test("#1981 implementor: retry_installment treats ok:false as ToolError", async () => {
  const { client } = moneyClient();
  client.rpc = (name: string) => {
    if (name === "biz_retry_installment") {
      return Promise.resolve({
        data: { ok: false, reason: "not_failed" },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  };
  const err = await assertRejects(
    () =>
      domainTool("retry_installment").executor(
        { brand_id: BRAND, installment_id: INSTALLMENT },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(err.code, "RPC_FAILED");
  assert(String(err.message).includes("not_failed"));
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
  assertEquals(typeof result.zero_priced_remaining, "number");
  const blob = JSON.stringify(result);
  assert(!blob.includes("buyer"));
  assert(!blob.includes("email"));
  assert(!blob.includes("phone"));
  assert(!blob.includes("name"));
});

Deno.test("#1981 implementor: list_trip_installments returns due/failed only", async () => {
  const { client } = moneyClient({
    installments: [
      {
        id: INSTALLMENT,
        order_id: ORDER,
        status: "failed",
        due_at: "2026-09-01T00:00:00Z",
        amount_cents: 5000,
        currency: "usd",
        ordinal: 1,
      },
      {
        id: "99999999-9999-4999-8999-999999999999",
        order_id: ORDER,
        status: "scheduled",
        due_at: "2099-01-01T00:00:00Z",
        amount_cents: 5000,
        currency: "usd",
        ordinal: 2,
      },
    ],
  });
  const result = await domainTool("list_trip_installments").executor(
    { brand_id: BRAND, event_id: EVENT },
    client,
    USER,
  );
  assertEquals(result.event_id, EVENT);
  assertEquals(result.installments.length, 1);
  assertEquals(result.installments[0].installment_id, INSTALLMENT);
  const blob = JSON.stringify(result);
  assert(!blob.includes("buyer"));
  assert(!blob.includes("email"));
  assert(!blob.includes("phone"));
});
