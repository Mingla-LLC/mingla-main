// #1984 — Ari event order reconciliation source contract (implementor happy path).
//
// Fails on revert of:
//   - get_event_order_reconciliation registration
//   - non-PII aggregate select (no buyer_email / buyer_name / buyer_phone)
//   - sold/refunded/net aggregation from paid + partial_refund orders
//   - tenant-scoped finance/event authorization
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1984_ari_orders_reconciliation.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered in DOMAIN_TOOLS`);
  return tool;
}

/** Thenable PostgREST-style chain for assertAgentReadEvent + requireEvent + orders. */
// deno-lint-ignore no-explicit-any
function chain(data: unknown, onSelect?: (clause: string) => void): any {
  const result = Promise.resolve({ data, error: null });
  // deno-lint-ignore no-explicit-any
  const query: any = {
    select: (clause: string) => {
      onSelect?.(clause);
      return query;
    },
    eq: () => query,
    is: () => query,
    not: () => query,
    order: () => query,
    limit: () => result,
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(data) ? (data[0] ?? null) : data,
        error: null,
      }),
    single: () =>
      Promise.resolve({
        data: Array.isArray(data) ? (data[0] ?? null) : data,
        error: null,
      }),
    then: result.then.bind(result),
    catch: result.catch.bind(result),
  };
  return query;
}

// deno-lint-ignore no-explicit-any
function reconciliationClient(onOrdersSelect: (clause: string) => void): any {
  const brandRow = {
    id: BRAND,
    name: "Test",
    slug: "test",
    default_currency: "usd",
    cover_media_url: null,
  };
  const eventRow = { id: EVENT, brand_id: BRAND, event_type: "ticketed" };
  const orderRows = [
    {
      payment_status: "paid",
      total_cents: 2000,
      refunded_amount_cents: 500,
      currency: "usd",
      order_line_items: [{ id: "line-1", quantity: 2 }],
      refunds: [
        {
          status: "succeeded",
          refund_line_items: [{ order_line_item_id: "line-1", quantity: 1 }],
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
  ];
  return {
    from(table: string) {
      if (table === "brands") return chain([brandRow]);
      if (table === "brand_team_members") return chain([]);
      if (table === "events") return chain(eventRow);
      if (table === "orders") return chain(orderRows, onOrdersSelect);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

Deno.test("#1984 implementor: get_event_order_reconciliation is registered read-only finance/event", () => {
  const tool = domainTool("get_event_order_reconciliation");
  assertEquals(tool.parameters.required, ["event_id"]);
  assertEquals(tool.parameters.additionalProperties, false);
  assert(DOMAIN_READ_ONLY.has("get_event_order_reconciliation"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_event_order_reconciliation"));
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.get_event_order_reconciliation,
    { requiredRole: "finance_manager", resource: "event" },
  );
});

Deno.test("#1984 implementor: aggregates sold/refunded/net without buyer PII fields", async () => {
  const tool = domainTool("get_event_order_reconciliation");
  let selectClause = "";
  const client = reconciliationClient((clause) => {
    selectClause = clause;
  });
  const result = await tool.executor({ event_id: EVENT }, client, USER);
  assert(selectClause.length > 0, "orders select must run");
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
