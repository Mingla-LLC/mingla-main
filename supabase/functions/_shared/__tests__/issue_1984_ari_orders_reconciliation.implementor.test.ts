// #1984 — Ari event order reconciliation source contract (implementor happy path).
//
// Fails on revert of:
//   - get_event_order_reconciliation registration
//   - non-PII aggregate select (no buyer_email / buyer_name / buyer_phone)
//   - sold/refunded/net aggregation from paid + partial_refund orders
//
// Run:
//   deno test --allow-none supabase/functions/_shared/__tests__/issue_1984_ari_orders_reconciliation.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered in DOMAIN_TOOLS`);
  return tool;
}

Deno.test("#1984 implementor: get_event_order_reconciliation is registered read-only finance/event", () => {
  const tool = domainTool("get_event_order_reconciliation");
  assertEquals(tool.parameters.required, ["event_id"]);
  assertEquals(tool.parameters.additionalProperties, false);
  assert(DOMAIN_READ_ONLY.has("get_event_order_reconciliation"));
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.get_event_order_reconciliation,
    { requiredRole: "finance_manager", resource: "event" },
  );
});

Deno.test("#1984 implementor: aggregates sold/refunded/net without buyer PII fields", async () => {
  const tool = domainTool("get_event_order_reconciliation");
  let selectClause = "";
  const client = {
    from: (_table: string) => ({
      select: (clause: string) => {
        selectClause = clause;
        return {
          eq: () =>
            Promise.resolve({
              data: [
                {
                  payment_status: "paid",
                  total_cents: 2000,
                  refunded_amount_cents: 500,
                  currency: "usd",
                  order_line_items: [{ id: "line-1", quantity: 2 }],
                  refunds: [
                    {
                      status: "succeeded",
                      refund_line_items: [
                        { order_line_item_id: "line-1", quantity: 1 },
                      ],
                    },
                  ],
                },
                {
                  payment_status: "cancelled",
                  total_cents: 9999,
                  refunded_amount_cents: 0,
                  currency: "usd",
                  order_line_items: [{ id: "line-x", quantity: 9 }],
                  refunds: [],
                },
              ],
              error: null,
            }),
        };
      },
    }),
  };
  const result = await tool.executor(
    { event_id: EVENT },
    client as never,
    "user",
  );
  assert(!/buyer_email|buyer_name|buyer_phone/.test(selectClause));
  assertEquals(result, {
    event_id: EVENT,
    sold_count: 1,
    revenue_cents: 2000,
    refunded_cents: 500,
    net_revenue_cents: 1500,
    currency: "usd",
  });
});
