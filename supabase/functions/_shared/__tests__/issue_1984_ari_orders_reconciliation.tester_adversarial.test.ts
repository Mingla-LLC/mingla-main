// #1984 — Ari event order reconciliation adversarial fail-on-revert.
//
// Independent of the implementor suite: proves a PII select reintroduction or
// sold-count math revert fails closed under the same tenant-read seam.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1984_ari_orders_reconciliation.tester_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

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

function clientForOrders(
  orders: unknown[],
  onOrdersSelect?: (clause: string) => void,
) {
  const brandRow = {
    id: BRAND,
    name: "Test",
    slug: "test",
    default_currency: "usd",
    cover_media_url: null,
  };
  const eventRow = { id: EVENT, brand_id: BRAND, event_type: "ticketed" };
  return {
    from(table: string) {
      if (table === "brands") return chain([brandRow]);
      if (table === "brand_team_members") return chain([]);
      if (table === "events") return chain(eventRow);
      if (table === "orders") return chain(orders, onOrdersSelect);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

Deno.test("#1984 tester: select clause never asks for buyer PII columns", async () => {
  const tool = domainTool("get_event_order_reconciliation");
  let selectClause = "";
  const client = clientForOrders([], (clause) => {
    selectClause = clause;
  });
  await tool.executor({ event_id: EVENT }, client, USER);
  assert(
    !/buyer_/i.test(selectClause),
    `PII leaked into select: ${selectClause}`,
  );
});

Deno.test("#1984 tester: invalid event_id fails closed before I/O", async () => {
  const tool = domainTool("get_event_order_reconciliation");
  await assertRejects(
    () => tool.executor({ event_id: "not-a-uuid" }, {
      from: () => {
        throw new Error("orders I/O must not run for an invalid event_id");
      },
    } as never, USER),
  );
});

Deno.test("#1984 tester: cancelled orders do not inflate sold_count", async () => {
  const tool = domainTool("get_event_order_reconciliation");
  const client = clientForOrders([
    {
      payment_status: "cancelled",
      total_cents: 5000,
      refunded_amount_cents: 0,
      currency: "usd",
      order_line_items: [{ id: "a", quantity: 3 }],
      refunds: [],
    },
  ]);
  const result = await tool.executor({ event_id: EVENT }, client, USER);
  assertEquals(result.sold_count, 0);
  assertEquals(result.revenue_cents, 0);
});
