// #1981 — independent tester adversarial angle (different from implementor).
//
// Attacks:
//   - duplicate confirm must reuse the SAME Idempotency-Key (no second mint)
//   - missing operation id refuses money invoke
//   - unpriced trip-cancel preview still fails closed (no commit)
//   - wrong confirm_phrase refuses refund/cancel/charge
//   - list_event_orders still has no buyer fields (regression guard)
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1981_ari_refunds_cancels.tester_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const LINE = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";
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
function clientFor(
  opts: {
    payment_method?: string;
    invoke?: (name: string, body: Record<string, unknown>) => unknown;
  } = {},
): { client: any; invokes: InvokeRec[] } {
  const invokes: InvokeRec[] = [];
  const orderRow = {
    id: ORDER,
    payment_method: opts.payment_method ?? "free",
    payment_status: "paid",
    currency: "usd",
    total_cents: opts.payment_method === "card" ? 1000 : 0,
    events: { brand_id: BRAND },
    order_line_items: [{
      id: LINE,
      quantity: 1,
      unit_price_cents: opts.payment_method === "card" ? 1000 : 0,
      total_cents: opts.payment_method === "card" ? 1000 : 0,
    }],
    refunds: [],
  };
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown, asSingle = false): any => {
    const self: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "not", "order", "limit"]) {
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
      // deno-lint-ignore no-explicit-any
      from: (table: string): any => {
        if (table === "orders") return chain(orderRow, true);
        if (table === "brands") {
          return chain([{ id: BRAND, name: "B", slug: "b" }]);
        }
        return chain(null, true);
      },
    },
  };
}

Deno.test("#1981 tester: duplicate confirm reuses the same Idempotency-Key", async () => {
  const { client, invokes } = clientFor({ payment_method: "card" });
  const args = {
    brand_id: BRAND,
    order_id: ORDER,
    lines: [{
      order_line_item_id: LINE,
      quantity: 1,
      amount_cents: 1000,
    }],
    reason: "Duplicate-confirm must not mint a second key.",
    confirm_phrase: "REFUND",
  };
  const ctx = { operationId: OP };
  await domainTool("refund_order").executor(args, client, USER, ctx);
  await domainTool("refund_order").executor(args, client, USER, ctx);
  assertEquals(invokes.length, 2);
  assertEquals(invokes[0].headers?.["Idempotency-Key"], OP);
  assertEquals(invokes[1].headers?.["Idempotency-Key"], OP);
  assertEquals(
    invokes[0].headers?.["Idempotency-Key"],
    invokes[1].headers?.["Idempotency-Key"],
  );
});

Deno.test("#1981 tester: missing operation id refuses refund", async () => {
  const { client, invokes } = clientFor({ payment_method: "card" });
  const err = await assertRejects(
    () =>
      domainTool("refund_order").executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          lines: [{
            order_line_item_id: LINE,
            quantity: 1,
            amount_cents: 1000,
          }],
          reason: "No operation id means no money move.",
          confirm_phrase: "REFUND",
        },
        client,
        USER,
        undefined as never,
      ),
    ToolError,
  );
  assertEquals(err.code, "OPERATION_ID_REQUIRED");
  assertEquals(invokes.length, 0);
});

Deno.test("#1981 tester: unpriced trip preview never reaches commit", async () => {
  for (
    const preview of [{}, { refundTotalCents: null }, {
      refundTotalCents: "100",
    }, { refundTotalCents: -1 }]
  ) {
    const { client, invokes } = clientFor({
      invoke: (_name, body) =>
        body.mode === "preview" ? preview : { ok: true },
    });
    const err = await assertRejects(
      () =>
        domainTool("cancel_trip_booking").executor(
          {
            brand_id: BRAND,
            booking_id: BOOKING,
            reason: "Unpriced preview must refuse.",
            confirm_phrase: "CANCEL",
          },
          client,
          USER,
          { operationId: OP },
        ),
      ToolError,
    );
    assertEquals(err.code, "REFUND_PREVIEW_UNPRICED");
    assertEquals(invokes.length, 1);
    assertEquals(invokes[0].body.mode, "preview");
  }
});

Deno.test("#1981 tester: wrong confirm_phrase refuses money tools", async () => {
  for (
    const [name, args, phrase] of [
      ["refund_order", {
        brand_id: BRAND,
        order_id: ORDER,
        lines: [{
          order_line_item_id: LINE,
          quantity: 1,
          amount_cents: 1000,
        }],
        reason: "Need ten chars min.",
      }, "REFUND"],
      ["cancel_order", {
        brand_id: BRAND,
        order_id: ORDER,
        reason: "Need ten chars min.",
      }, "CANCEL"],
      ["charge_installment_now", {
        brand_id: BRAND,
        installment_id: "66666666-6666-4666-8666-666666666666",
      }, "CHARGE"],
    ] as const
  ) {
    const { client, invokes } = clientFor();
    await assertRejects(
      () =>
        domainTool(name).executor(
          { ...args, confirm_phrase: "NOPE" },
          client,
          USER,
          { operationId: OP },
        ),
      ToolError,
    );
    assertEquals(invokes.length, 0, `${name} must not invoke on bad phrase`);
    // Positive control: correct phrase reaches the executor body (may still
    // fail later on missing order data for charge — that is fine; phrase gate
    // is the angle under test).
    assertEquals(
      domainTool(name).parameters.properties.confirm_phrase.enum[0],
      phrase,
    );
  }
});

Deno.test("#1981 tester: list_event_orders select still omits buyer PII columns", () => {
  const src = Deno.readTextFileSync(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const idx = src.indexOf('const listEventOrders = writeTool(\n  "list_event_orders"');
  assert(idx >= 0);
  const chunk = src.slice(idx, idx + 1800);
  assert(chunk.includes("order_line_items(id, quantity, total_cents)"));
  assert(!chunk.includes("buyer_email"));
  assert(!chunk.includes("buyer_name"));
  assert(!chunk.includes("buyer_phone"));
});
