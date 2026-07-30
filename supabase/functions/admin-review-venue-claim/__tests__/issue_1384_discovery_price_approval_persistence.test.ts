import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approveGoLiveWithAuthoredApply } from "../index.ts";

interface TableOperation {
  table: string;
  operation: "update" | "delete" | "insert";
  payload?: unknown;
}

const BRAND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENUE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLACE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeApprovalFixture(mode: "create_new" | "existing") {
  const canonicalRange = {
    place_pool_id: PLACE_ID,
    brand_id: BRAND_ID,
    venue_id: VENUE_ID,
    status: "active",
    source_min_minor: 20_000,
    source_max_minor: 50_000,
    source_currency_code: "NGN",
    source_type: "business_authored",
    version: 7,
  };
  const rows: Record<string, Record<string, unknown>> = {
    venue_listings: {
      id: VENUE_ID,
      brand_id: BRAND_ID,
      place_pool_id: PLACE_ID,
      cover_media_url: "https://cdn.example/cover.jpg",
      cover_media_type: "image",
    },
    brands: { id: BRAND_ID, account_id: OWNER_ID },
    place_pool: {
      id: PLACE_ID,
      google_place_id: `fixture-${mode}`,
      name: mode === "create_new" ? "New venue" : "Existing venue",
      lat: 35.77,
      lng: -78.63,
      types: ["restaurant", "food", "point_of_interest"],
      business_status: "OPERATIONAL",
      website: "https://venue.example",
      opening_hours: { periods: [] },
      photos: [{ ref: "cover" }],
      stored_photo_urls: ["https://cdn.example/one.jpg"],
      fetched_via: mode,
      review_count: 100,
      rating: 4.6,
      business_gallery_urls: ["https://cdn.example/one.jpg"],
      business_authoring_inputs: {
        tier1: { description: "A complete authored venue description." },
        tier2: {},
      },
      raw_google_data: {},
    },
    place_discovery_price_ranges: canonicalRange,
  };
  const lists: Record<string, unknown[]> = {
    brand_hours: [],
    signal_definitions: [{ id: "date_night" }],
  };
  const operations: TableOperation[] = [];

  function query(table: string) {
    let operation: "select" | "update" | "delete" | "insert" = "select";
    let payload: unknown;
    const builder = {
      select(_columns?: string) {
        return builder;
      },
      eq(_column: string, _value: unknown) {
        return builder;
      },
      order(_column: string, _options?: unknown) {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      update(next: Record<string, unknown>) {
        operation = "update";
        payload = next;
        operations.push({ table, operation, payload: next });
        if (rows[table]) rows[table] = { ...rows[table], ...next };
        return builder;
      },
      delete() {
        operation = "delete";
        operations.push({ table, operation });
        return builder;
      },
      insert(next: unknown) {
        operation = "insert";
        payload = next;
        operations.push({ table, operation, payload: next });
        return builder;
      },
      // deno-lint-ignore no-explicit-any
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown): any {
        const result = operation === "select"
          ? { data: lists[table] ?? [], error: null }
          : { data: payload ?? null, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    admin: {
      from: (table: string) => query(table),
      functions: {
        invoke() {
          return Promise.resolve({ data: {}, error: null });
        },
      },
    },
    canonicalRange,
    operations,
    rows,
  };
}

for (const mode of ["create_new", "existing"] as const) {
  Deno.test(`issue 1384 ${mode} approval preserves canonical discovery money`, async () => {
    const fixture = makeApprovalFixture(mode);
    const before = JSON.stringify(fixture.canonicalRange);
    const result = await approveGoLiveWithAuthoredApply(
      fixture.admin,
      VENUE_ID,
      PLACE_ID,
      null,
    );
    assert(result.ok, `approval failed: ${JSON.stringify(result)}`);
    assertEquals(
      JSON.stringify(fixture.rows.place_discovery_price_ranges),
      before,
    );
    assertEquals(
      fixture.operations.filter((operation) =>
        operation.table === "place_discovery_price_ranges" &&
        (operation.operation === "update" || operation.operation === "delete")
      ),
      [],
    );
  });
}
