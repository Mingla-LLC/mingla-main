// #1981 — paid cancel is a client-resolvable conflict, not a server fault.
//
// `cancel_order` raises PAID_ORDER_MUST_REFUND before invoke. agent-confirm-action
// maps only an explicit allowlist and previously fell through to HTTP 500 —
// the one status Ari treats as safe_to_retry. Prove the shipped executor's
// code maps to 409 by executing toolErrorHttpStatus (never a hand-typed literal).
//
// Run:
//   deno test --no-check --allow-env --allow-net --allow-read \
//     supabase/functions/agent-confirm-action/__tests__/issue_1981_paid_order_must_refund_status.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toolErrorHttpStatus } from "../index.ts";
import { DOMAIN_TOOLS } from "../../_shared/agentDomainTools.ts";
import { ToolError } from "../../_shared/agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const LINE = "33333333-3333-4333-8333-333333333333";
const OPERATION = "55555555-5555-4555-8555-555555555555";

function paidOrderClient() {
  const orderRow = {
    id: ORDER,
    payment_method: "card",
    payment_status: "paid",
    currency: "usd",
    total_cents: 2000,
    events: { brand_id: BRAND },
    order_line_items: [{
      id: LINE,
      quantity: 1,
      unit_price_cents: 2000,
      total_cents: 2000,
    }],
    refunds: [],
  };
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown): any => {
    const self: Record<string, unknown> = {};
    for (
      const method of ["select", "eq", "in", "is", "not", "order", "limit"]
    ) {
      self[method] = () => self;
    }
    self.maybeSingle = () => Promise.resolve({ data: result, error: null });
    return self;
  };
  return {
    from: (table: string) => table === "orders" ? chain(orderRow) : chain(null),
    functions: {
      invoke: () => Promise.resolve({ data: { ok: true }, error: null }),
    },
  };
}

Deno.test("#1981 paid cancel ToolError maps to 409, not 500", async () => {
  // deno-lint-ignore no-explicit-any
  const tool = DOMAIN_TOOLS.find((t: any) => t.name === "cancel_order");
  assert(tool, "cancel_order must be registered");

  const error = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND,
          order_id: ORDER,
          reason: "Trying to cancel a paid order.",
          confirm_phrase: "CANCEL",
        },
        paidOrderClient() as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );

  assertEquals(error.code, "PAID_ORDER_MUST_REFUND");
  const status = toolErrorHttpStatus(error.code);
  assertEquals(
    status,
    409,
    `paid cancel must be a 409 conflict, got ${status} for ${error.code}`,
  );
  assert(
    status !== 500,
    "a deterministic caller mistake must never be reported as a server fault",
  );
});

Deno.test("#1981 PAID_ORDER_MUST_REFUND stays on the explicit 409 allowlist", () => {
  assertEquals(toolErrorHttpStatus("PAID_ORDER_MUST_REFUND"), 409);
  assertEquals(toolErrorHttpStatus("RPC_FAILED"), 500);
});
