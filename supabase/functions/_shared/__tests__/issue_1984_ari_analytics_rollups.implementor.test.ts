// #1984 — Ari listing conversion + reservation metrics (implementor happy path).
//
// Fails on revert of:
//   - get_listing_conversion / get_reservation_metrics registration
//   - read-only + tenant-scoped authorization
//   - entity_conversion_rollup / reservation_metrics_rollup RPC args
//   - slim non-PII payloads (no buyer_email / buyer_name / buyer_phone)
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1984_ari_analytics_rollups.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const VENUE = "44444444-4444-4444-8444-444444444444";
const USER = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered in DOMAIN_TOOLS`);
  return tool;
}

// deno-lint-ignore no-explicit-any
function chain(data: unknown): any {
  const result = Promise.resolve({ data, error: null });
  // deno-lint-ignore no-explicit-any
  const query: any = {
    select: () => query,
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

Deno.test("#1984 implementor: get_listing_conversion is registered read-only scanner/event", () => {
  const tool = domainTool("get_listing_conversion");
  assertEquals(tool.parameters.required, ["event_id"]);
  assertEquals(tool.parameters.additionalProperties, false);
  assert(DOMAIN_READ_ONLY.has("get_listing_conversion"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_listing_conversion"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_listing_conversion, {
    requiredRole: "scanner",
    resource: "event",
  });
});

Deno.test("#1984 implementor: get_reservation_metrics is registered read-only scanner/brand", () => {
  const tool = domainTool("get_reservation_metrics");
  assertEquals(tool.parameters.required, ["brand_id"]);
  assertEquals(tool.parameters.additionalProperties, false);
  assert(DOMAIN_READ_ONLY.has("get_reservation_metrics"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_reservation_metrics"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_reservation_metrics, {
    requiredRole: "scanner",
    resource: "brand",
  });
});

Deno.test("#1984 implementor: get_listing_conversion calls entity_conversion_rollup and slims PII keys", async () => {
  const tool = domainTool("get_listing_conversion");
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "Test",
          slug: "test",
          default_currency: "usd",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      if (table === "events") {
        return chain({ id: EVENT, brand_id: BRAND, event_type: "ticketed" });
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: {
          event_id: EVENT,
          authorized: true,
          mingla_drove_count: 3,
          value_cents: { USD: 1500 },
          by_source: [{ source: "organic", customers: 2, value_cents: { USD: 1000 } }],
          by_platform: [],
          buyer_email: "leak@example.com",
          buyer_name: "Leak",
          buyer_phone: "+10000000000",
        },
        error: null,
      });
    },
  };
  const result = await tool.executor({ event_id: EVENT }, client, USER);
  assertEquals(rpcCalls, [{
    fn: "entity_conversion_rollup",
    args: { p_event_id: EVENT },
  }]);
  assertEquals(result.event_id, EVENT);
  assertEquals(result.conversion.mingla_drove_count, 3);
  assertEquals(result.conversion.value_cents, { USD: 1500 });
  assertEquals(result.conversion.buyer_email, undefined);
  assertEquals(result.conversion.buyer_name, undefined);
  assertEquals(result.conversion.buyer_phone, undefined);
});

Deno.test("#1984 implementor: get_reservation_metrics calls rollup with optional venue_id", async () => {
  const tool = domainTool("get_reservation_metrics");
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "Test",
          slug: "test",
          default_currency: "usd",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: {
          brand_id: BRAND,
          venue_id: VENUE,
          authorized: true,
          covers_30d: 12,
          covers_lifetime: 40,
          avg_party_size: 2.5,
          no_show_rate: 0.1,
          by_source: [{ source: "mingla", reservations: 5, covers: 10 }],
          value_cents_30d: { USD: 2000 },
          value_cents_lifetime: { USD: 9000 },
          buyer_email: "leak@example.com",
        },
        error: null,
      });
    },
  };
  const result = await tool.executor(
    { brand_id: BRAND, venue_id: VENUE },
    client,
    USER,
  );
  assertEquals(rpcCalls, [{
    fn: "reservation_metrics_rollup",
    args: { p_brand_id: BRAND, p_venue_id: VENUE },
  }]);
  assertEquals(result.metrics.covers_30d, 12);
  assertEquals(result.metrics.buyer_email, undefined);
});

Deno.test("#1984 implementor: get_brand_analytics slims conversion + venue payloads", async () => {
  const tool = domainTool("get_brand_analytics");
  const client = {
    from(table: string) {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "Test",
          slug: "test",
          default_currency: "usd",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string) {
      if (fn === "brand_conversion_rollup") {
        return Promise.resolve({
          data: {
            brand_id: BRAND,
            authorized: true,
            customers_driven_30d: 4,
            customers_driven_lifetime: 9,
            value_cents_30d: { USD: 400 },
            value_cents_lifetime: { USD: 900 },
            by_platform: [],
            top_campaign: null,
            send_health: { sent: 1, failed: 0, skipped: 0, pending: 0 },
            buyer_email: "nope@example.com",
          },
          error: null,
        });
      }
      if (fn === "venue_intelligence_overview") {
        return Promise.resolve({
          data: {
            brand_id: BRAND,
            order_count: 7,
            rev7d_by_currency: { USD: 700 },
            revenue_by_currency: { USD: 7000 },
            buyer_name: "Nope",
          },
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  const result = await tool.executor({ brand_id: BRAND }, client, USER);
  assertEquals(result.conversion.customers_driven_30d, 4);
  assertEquals(result.conversion.buyer_email, undefined);
  assertEquals(result.venue.order_count, 7);
  assertEquals(result.venue.buyer_name, undefined);
});
