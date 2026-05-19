// Ve2 — claim-search-pool unit tests
// Run: deno test supabase/functions/claim-search-pool/index.test.ts

import {
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkRateLimit, normalizeSearchBody } from "./index.ts";
import {
  assertNoForbiddenKeys,
  rowToPoolMatch,
  type PoolMatchRow,
} from "../_shared/poolMatchResponse.ts";

Deno.test("normalizeSearchBody rejects short query", () => {
  const r = normalizeSearchBody({ query: "ab" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "query_too_short");
});

Deno.test("normalizeSearchBody accepts valid query and clamps limit", () => {
  const r = normalizeSearchBody({ query: "  pizza  ", limit: 99 });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.query, "pizza");
    assertEquals(r.limit, 5);
  }
});

Deno.test("checkRateLimit blocks after 10 requests per minute", () => {
  const uid = "user-rate-test";
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 10; i++) {
    assertStrictEquals(checkRateLimit(uid, t0 + i), true);
  }
  assertFalse(checkRateLimit(uid, t0 + 10));
});

Deno.test("rowToPoolMatch whitelists fields and maps venue category", () => {
  const row: PoolMatchRow = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Joe's Pizza",
    address: "123 Main St",
    city: "New York",
    country: "US",
    lat: 40.7,
    lng: -74.0,
    google_place_id: "ChIJtest",
    primary_type: "pizza_restaurant",
    types: ["pizza_restaurant", "restaurant"],
    opening_hours: { periods: [] },
    stored_photo_urls: ["https://cdn.example.com/a.jpg"],
  };
  const match = rowToPoolMatch(row);
  assertEquals(match.name, "Joe's Pizza");
  assertEquals(match.venueCategory, "restaurant");
  assertEquals(match.photoUrls.length, 1);
  assertNoForbiddenKeys(match as unknown as Record<string, unknown>);
});

Deno.test("rowToPoolMatch maps bowling to play", () => {
  const row: PoolMatchRow = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Strike Zone",
    address: null,
    city: null,
    country: null,
    lat: 0,
    lng: 0,
    google_place_id: "gid",
    primary_type: "bowling_alley",
    types: [],
    opening_hours: null,
    stored_photo_urls: [],
  };
  assertEquals(rowToPoolMatch(row).venueCategory, "play");
});
