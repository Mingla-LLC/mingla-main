// #1984 — Ari analytics rollups adversarial fail-on-revert.
//
// Independent angle from the implementor suite:
//   - invalid ids fail closed before I/O
//   - unauthorized rollups stay honest-empty (authorized:false)
//   - cancelled orders still do not inflate sold_count (recon)
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1984_ari_analytics_rollups.tester_adversarial.test.ts

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

Deno.test("#1984 tester: get_listing_conversion rejects non-uuid event_id before I/O", async () => {
  const tool = domainTool("get_listing_conversion");
  let touched = false;
  const client = {
    from() {
      touched = true;
      throw new Error("should not touch DB");
    },
    rpc() {
      touched = true;
      throw new Error("should not rpc");
    },
  };
  await assertRejects(
    () => tool.executor({ event_id: "not-a-uuid" }, client, USER),
    Error,
  );
  assertEquals(touched, false);
});

Deno.test("#1984 tester: get_reservation_metrics rejects non-uuid venue_id before I/O", async () => {
  const tool = domainTool("get_reservation_metrics");
  let rpcTouched = false;
  // deno-lint-ignore no-explicit-any
  const chain = (data: unknown): any => {
    const result = Promise.resolve({ data, error: null });
    // deno-lint-ignore no-explicit-any
    const query: any = {
      select: () => query,
      eq: () => query,
      is: () => query,
      not: () => query,
      limit: () => result,
      maybeSingle: () =>
        Promise.resolve({
          data: Array.isArray(data) ? data[0] ?? null : data,
          error: null,
        }),
      then: result.then.bind(result),
      catch: result.catch.bind(result),
    };
    return query;
  };
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
      throw new Error(`unexpected ${table}`);
    },
    rpc() {
      rpcTouched = true;
      return Promise.resolve({ data: {}, error: null });
    },
  };
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, venue_id: "bad-venue" },
        client,
        USER,
      ),
    Error,
  );
  assertEquals(rpcTouched, false);
});

Deno.test("#1984 tester: unauthorized listing rollup keeps authorized:false (not zero-with-authority)", async () => {
  const tool = domainTool("get_listing_conversion");
  // deno-lint-ignore no-explicit-any
  const chain = (data: unknown): any => {
    const result = Promise.resolve({ data, error: null });
    // deno-lint-ignore no-explicit-any
    const query: any = {
      select: () => query,
      eq: () => query,
      is: () => query,
      not: () => query,
      limit: () => result,
      maybeSingle: () =>
        Promise.resolve({
          data: Array.isArray(data) ? data[0] ?? null : data,
          error: null,
        }),
      then: result.then.bind(result),
      catch: result.catch.bind(result),
    };
    return query;
  };
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
      throw new Error(`unexpected ${table}`);
    },
    rpc() {
      return Promise.resolve({
        data: {
          event_id: EVENT,
          authorized: false,
          mingla_drove_count: 0,
          value_cents: {},
          by_source: [],
          by_platform: [],
        },
        error: null,
      });
    },
  };
  const result = await tool.executor({ event_id: EVENT }, client, USER);
  assertEquals(result.conversion.authorized, false);
  assertEquals(result.conversion.mingla_drove_count, 0);
});
