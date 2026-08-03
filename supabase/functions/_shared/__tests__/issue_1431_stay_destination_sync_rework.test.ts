/** Issue #1431 implementor rework regression.
 *
 * The campaign sync health check must use the same flag-gated public Stay
 * destination view as create/preview, without changing Event or Brand reads.
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type DestinationQueryClient,
  destinationStillPublicLive,
} from "../adChannel.ts";

interface RecordedQuery {
  table: string;
  filters: Record<string, unknown>;
}

function destinationClient(
  row: unknown,
  queries: RecordedQuery[],
): DestinationQueryClient {
  return {
    from(table: string) {
      const query: RecordedQuery = { table, filters: {} };
      queries.push(query);
      const chain = {
        eq(column: string, value: string) {
          query.filters[column] = value;
          return chain;
        },
        in(column: string, values: string[]) {
          query.filters[column] = values;
          return { maybeSingle: () => Promise.resolve({ data: row }) };
        },
        maybeSingle: () => Promise.resolve({ data: row }),
      };
      return { select: () => chain };
    },
  };
}

Deno.test("issue-1431 rework: a healthy Stay destination survives campaign sync", async () => {
  const queries: RecordedQuery[] = [];
  const result = await destinationStillPublicLive(
    destinationClient({ id: "stay-1431" }, queries),
    {
      dest_page_type: "venue",
      dest_brand_slug: "lagoon-resort",
      dest_entity_slug: "lagoon-stay",
    },
  );

  assertEquals(result, true);
  assertEquals(queries, [{
    table: "ad_public_stay_destinations_view",
    filters: { brand_slug: "lagoon-resort", slug: "lagoon-stay" },
  }]);
});

Deno.test("issue-1431 rework: dark or malformed Stay destinations fail closed", async () => {
  const darkQueries: RecordedQuery[] = [];
  assertEquals(
    await destinationStillPublicLive(
      destinationClient(null, darkQueries),
      {
        dest_page_type: "venue",
        dest_brand_slug: "lagoon-resort",
        dest_entity_slug: "lagoon-stay",
      },
    ),
    false,
  );
  assertEquals(darkQueries.length, 1);

  const malformedQueries: RecordedQuery[] = [];
  assertEquals(
    await destinationStillPublicLive(
      destinationClient({ id: "should-not-read" }, malformedQueries),
      {
        dest_page_type: "venue",
        dest_brand_slug: "lagoon-resort",
        dest_entity_slug: null,
      },
    ),
    false,
  );
  assertEquals(malformedQueries.length, 0);
});

Deno.test("issue-1431 rework: Event and Brand sync queries remain unchanged", async () => {
  const eventQueries: RecordedQuery[] = [];
  assertEquals(
    await destinationStillPublicLive(
      destinationClient({ id: "event-1" }, eventQueries),
      {
        dest_page_type: "event",
        dest_brand_slug: "smoke-rhythm",
        dest_entity_slug: "jazz-night",
      },
    ),
    true,
  );
  assertEquals(eventQueries[0], {
    table: "business_public_events_view",
    filters: {
      brand_slug: "smoke-rhythm",
      slug: "jazz-night",
      status: ["scheduled", "live"],
    },
  });

  const brandQueries: RecordedQuery[] = [];
  assertEquals(
    await destinationStillPublicLive(
      destinationClient({ id: "brand-1" }, brandQueries),
      {
        dest_page_type: "brand",
        dest_brand_slug: "smoke-rhythm",
        dest_entity_slug: null,
      },
    ),
    true,
  );
  assertEquals(brandQueries[0], {
    table: "business_public_brands_view",
    filters: { slug: "smoke-rhythm" },
  });
});
