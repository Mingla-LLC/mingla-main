import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const discover = read("../../DiscoverScreen.tsx");
const content = read("../StaysContent.tsx");
const filters = read("../StayFilterChips.tsx");
const card = read("../StayCard.tsx");
const service = read("../../../services/staysDiscoveryService.ts");
const hook = read("../../../hooks/useDiscoverStays.ts");
const store = read("../../../store/appStore.ts");

test("#1423 adds Stays to the existing Discover capsule and nowhere else", () => {
  assert.match(discover, /id: "events"[\s\S]*id: "trips"[\s\S]*id: "stays"/);
  assert.match(discover, /activeTab === "stays"[\s\S]*<StaysContent/);
  assert.match(discover, /activeTab === "trips"[\s\S]*<TripsContent/);
  assert.match(discover, /activeTab === "events"[\s\S]*filterBarAbsolute/);
  assert.match(store, /discoverActiveTab: 'events' \| 'trips' \| 'stays'/);
});

test("#1423 exposes exactly the four approved Stay filter entry points", () => {
  for (const label of ["Destination", "Dates", "Guests & rooms", "Filters"]) {
    assert.ok(filters.includes(`"${label}"`) || filters.includes(`>${label}<`), label);
  }
  const chipCalls = [...filters.matchAll(/<Chip\b/g)].length;
  assert.equal(chipCalls, 4);
  assert.match(filters, /label="Rooms"[\s\S]*maximum=\{10\}/);
  assert.match(filters, /PROPERTY_OPTIONS/);
  assert.match(filters, /AMENITY_OPTIONS/);
  assert.match(filters, /Instant booking/);
  assert.match(filters, /Request to book/);
});

test("#1423 reads only the public RPC and keeps source currency", () => {
  assert.match(service, /supabase\.rpc\("pg_public_stays_discover"/);
  assert.match(service, /p_check_in: filters\.checkIn/);
  assert.match(service, /p_rooms: filters\.rooms/);
  assert.match(service, /currencyCode: \(row\.currencyCode as string\)\.toUpperCase\(\)/);
  assert.match(hook, /useInfiniteQuery/);
  assert.match(hook, /if \(!lastPage\.enabled\) return undefined/);
  assert.doesNotMatch(service, /currencyCode\s*\?\?\s*["']/);
});

test("#1423 renders real property truth and opens the existing public Stay route", () => {
  assert.match(card, /propertyKind/);
  assert.match(card, /From \{price\} \/ night/);
  assert.match(card, /Available for your dates/);
  assert.match(card, /Choose dates to check availability/);
  assert.match(content, /pathname: "\/b\/\[brandSlug\]\/v\/\[venueSlug\]"/);
  assert.match(content, /discover_stays/);
  assert.match(store, /discoverStayFilters/);
});

test("#1423 has explicit dark, loading, error, empty, no-match, and cached states", () => {
  assert.match(content, /isLoading/);
  assert.match(content, /isFlagEnabled === false/);
  assert.match(content, /Stays are opening soon/);
  assert.match(content, /We could not load stays/);
  assert.match(content, /No stays are live yet/);
  assert.match(content, /No stays match those filters/);
  assert.match(content, /Showing saved results\. Reconnect to refresh/);
});
