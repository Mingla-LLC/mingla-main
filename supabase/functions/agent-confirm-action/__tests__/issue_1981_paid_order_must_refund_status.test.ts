// #1981 — money refusals must reach the operator as non-retryable envelopes.
//
// toolErrorHttpStatus alone is insufficient: ariErrorResponse remaps via
// mapLegacyAriErrorCode and registry-owned user_message / safe_to_retry.
// Assert the envelope fields that Confirm surfaces.
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
import {
  ARI_ERROR_REGISTRY,
  mapLegacyAriErrorCode,
} from "../../_shared/agentReliability.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const LINE = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";
const OPERATION = "55555555-5555-4555-8555-555555555555";

function orderClient(opts: {
  payment_method?: string;
  booking?: boolean;
  invoke?: (name: string, body: Record<string, unknown>) => unknown;
} = {}) {
  const orderRow = {
    id: opts.booking ? BOOKING : ORDER,
    payment_method: opts.payment_method ?? "card",
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
      invoke: (name: string, init: { body?: Record<string, unknown> }) => {
        const data = opts.invoke
          ? opts.invoke(name, init?.body ?? {})
          : { ok: true };
        return Promise.resolve({ data, error: null });
      },
    },
  };
}

function assertMoneyEnvelope(legacyCode: string, expectedCode: string) {
  const mapped = mapLegacyAriErrorCode(legacyCode);
  assertEquals(mapped, expectedCode);
  const def = ARI_ERROR_REGISTRY[mapped];
  assertEquals(def.httpStatus, 409);
  assertEquals(def.safeToRetry, false);
  assertEquals(def.retryability, "never");
  assert(def.userMessage.length > 0);
  return def;
}

Deno.test("#1981 paid cancel ToolError maps to honest non-retryable envelope", async () => {
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
        orderClient() as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );

  assertEquals(error.code, "PAID_ORDER_MUST_REFUND");
  assertEquals(toolErrorHttpStatus(error.code), 409);
  const def = assertMoneyEnvelope(error.code, "PAID_ORDER_MUST_REFUND");
  assert(def.userMessage.includes("refund_order"));
});

Deno.test("#1981 unpriced trip cancel maps to honest non-retryable envelope", async () => {
  // deno-lint-ignore no-explicit-any
  const tool = DOMAIN_TOOLS.find((t: any) => t.name === "cancel_trip_booking");
  assert(tool, "cancel_trip_booking must be registered");

  const error = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND,
          booking_id: BOOKING,
          reason: "Unpriced preview must refuse.",
          confirm_phrase: "CANCEL",
        },
        orderClient({
          booking: true,
          invoke: (_name, body) => body.mode === "preview" ? {} : { ok: true },
        }) as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );

  assertEquals(error.code, "REFUND_PREVIEW_UNPRICED");
  assertEquals(toolErrorHttpStatus(error.code), 409);
  const def = assertMoneyEnvelope(error.code, "REFUND_PREVIEW_UNPRICED");
  assert(def.userMessage.toLowerCase().includes("preview"));
});

Deno.test("#1981 EDGE_FAILED / RPC_FAILED map to DOMAIN_ACTION_REFUSED, not INTERNAL", () => {
  for (const legacy of ["EDGE_FAILED", "RPC_FAILED"]) {
    const def = assertMoneyEnvelope(legacy, "DOMAIN_ACTION_REFUSED");
    assertEquals(def.safeToRetry, false);
  }
  assertEquals(mapLegacyAriErrorCode("HANDLER_THREW"), "INTERNAL");
  assertEquals(ARI_ERROR_REGISTRY.INTERNAL.safeToRetry, true);
});
