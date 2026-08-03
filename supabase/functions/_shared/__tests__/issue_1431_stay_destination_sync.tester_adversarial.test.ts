/** Issue #1431 tester-owned rework coverage.
 *
 * A venue health read is useful only if both public slugs are exact. These
 * hostile cases prove campaign sync cannot keep an ad active by matching a
 * different Stay, widening the page type, or swallowing a database failure in
 * the shared checker (the sync caller owns the deliberate fail-open catch).
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type DestinationQueryClient,
  destinationStillPublicLive,
} from "../adChannel.ts";

interface QueryTrace {
  table: string;
  filters: Record<string, string>;
}

function exactStayClient(trace: QueryTrace[]): DestinationQueryClient {
  return {
    from(table: string) {
      const query: QueryTrace = { table, filters: {} };
      trace.push(query);
      const chain = {
        eq(column: string, value: string) {
          query.filters[column] = value;
          return chain;
        },
        in() {
          return { maybeSingle: () => Promise.resolve({ data: null }) };
        },
        maybeSingle: () => Promise.resolve({
          data: query.table === "ad_public_stay_destinations_view" &&
              query.filters.brand_slug === "correct-brand" &&
              query.filters.slug === "correct-stay"
            ? { id: "correct-stay-id" }
            : null,
        }),
      };
      return { select: () => chain };
    },
  };
}

Deno.test("issue-1431 tester: Stay sync requires the exact brand and venue pair", async () => {
  const exactTrace: QueryTrace[] = [];
  assertEquals(await destinationStillPublicLive(exactStayClient(exactTrace), {
    dest_page_type: "venue",
    dest_brand_slug: "correct-brand",
    dest_entity_slug: "correct-stay",
  }), true);
  assertEquals(exactTrace[0], {
    table: "ad_public_stay_destinations_view",
    filters: { brand_slug: "correct-brand", slug: "correct-stay" },
  });

  for (const [brand, stay] of [
    ["other-brand", "correct-stay"],
    ["correct-brand", "other-stay"],
  ]) {
    assertEquals(await destinationStillPublicLive(exactStayClient([]), {
      dest_page_type: "venue",
      dest_brand_slug: brand,
      dest_entity_slug: stay,
    }), false);
  }
});

Deno.test("issue-1431 tester: widened Stay types make no database query", async () => {
  for (const pageType of ["Venue", "stay", "hotel", "resort"]) {
    const trace: QueryTrace[] = [];
    assertEquals(await destinationStillPublicLive(exactStayClient(trace), {
      dest_page_type: pageType,
      dest_brand_slug: "correct-brand",
      dest_entity_slug: "correct-stay",
    }), false);
    assertEquals(trace.length, 0);
  }
});

Deno.test("issue-1431 tester: a Stay health-read error propagates to the sync fail-open boundary", async () => {
  const throwingClient = {
    from() {
      const chain = {
        eq: () => chain,
        in: () => ({ maybeSingle: () => Promise.reject(new Error("db-down")) }),
        maybeSingle: () => Promise.reject(new Error("db-down")),
      };
      return { select: () => chain };
    },
  } as unknown as DestinationQueryClient;

  await assertRejects(
    () => destinationStillPublicLive(throwingClient, {
      dest_page_type: "venue",
      dest_brand_slug: "correct-brand",
      dest_entity_slug: "correct-stay",
    }),
    Error,
    "db-down",
  );
});
