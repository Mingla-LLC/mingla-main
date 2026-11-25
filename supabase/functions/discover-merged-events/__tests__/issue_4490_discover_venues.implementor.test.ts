// #4490 Explorer W6a: the Discover "venues" kind at the edge.
//
// FAILS-ON-REVERT: drop "venues" from DISCOVER_KINDS / FILTER_FIELDS / ALLOWED_FILTERS
// or the venueTypes check and V-1..V-4 fail.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DISCOVER_KINDS,
  VENUE_TYPE_CHIP_KEYS,
  discoverV2ValidationFailure,
  isDiscoverV2Request,
} from "../_v2_types.ts";
import { buildDiscoverV2Key } from "../_v2_key.ts";
import { handleDiscoverV2 } from "../_v2_handler.ts";

const anchor = { name: "Lagos", stateCode: null, countryCode: "NG", lat: 6.5, lng: 3.4, radiusKm: 50 };
const base = { contract: 2 as const, op: "page" as const, anchor };

Deno.test("V-1 venues is a kind, appended last", () => {
  assertEquals([...DISCOVER_KINDS], ["events", "experiences", "trips", "stays", "venues"]);
  assert(isDiscoverV2Request({ ...base, filters: { kind: "venues", f: {} } }));
  assert(isDiscoverV2Request({ ...base, filters: { kind: "venues", f: { venueTypes: [...VENUE_TYPE_CHIP_KEYS] } } }));
});

Deno.test("V-2 unknown filter keys and venue types are refused before dispatch", () => {
  assertEquals(discoverV2ValidationFailure({ ...base, filters: { kind: "venues", f: { propertyKinds: ["hotel"] } } }),
    { error: "invalid_filter:propertyKinds", status: 400 });
  assertEquals(discoverV2ValidationFailure({ ...base, filters: { kind: "venues", f: { venueTypes: ["stay"] } } }),
    { error: "invalid_filter:venueTypes", status: 400 });
  assertEquals(discoverV2ValidationFailure({ ...base, filters: { kind: "venues", f: { venueTypes: "club" } } }),
    { error: "invalid_filter:venueTypes", status: 400 });
  // venueTypes is not a filter of any other kind.
  assertEquals(discoverV2ValidationFailure({ ...base, filters: { kind: "stays", f: { venueTypes: ["club"] } } }),
    { error: "invalid_filter:venueTypes", status: 400 });
});

Deno.test("V-3 the cache key separates kinds and venue types, and normalizes their order", () => {
  const stays = buildDiscoverV2Key({ ...base, filters: { kind: "stays", f: {} } } as never, "g", "Africa/Lagos", "NGN");
  const venues = buildDiscoverV2Key({ ...base, filters: { kind: "venues", f: {} } } as never, "g", "Africa/Lagos", "NGN");
  assertNotEquals(stays, venues);
  const a = buildDiscoverV2Key({ ...base, filters: { kind: "venues", f: { venueTypes: ["club", "cafe"] } } } as never, "g", "Africa/Lagos", "NGN");
  const b = buildDiscoverV2Key({ ...base, filters: { kind: "venues", f: { venueTypes: ["cafe", "club"] } } } as never, "g", "Africa/Lagos", "NGN");
  const c = buildDiscoverV2Key({ ...base, filters: { kind: "venues", f: { venueTypes: ["club"] } } } as never, "g", "Africa/Lagos", "NGN");
  assertEquals(a, b);
  assertNotEquals(a, c);
});

Deno.test("V-4 a venues page reaches discover_v2_items with the venue filters (no price catalog, no Ticketmaster)", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client = {
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "discover_v2_city_context") return Promise.resolve({ data: { tz: "Africa/Lagos", tzSource: "supply", majorityCurrency: "NGN" }, error: null });
      if (name === "issue_2009_event_discovery_generation") return Promise.resolve({ data: 7, error: null });
      if (name === "discover_v2_items") {
        return Promise.resolve({ data: { items: [{ kind: "venue", id: "v1" }], total: 1, facetOptions: {} }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } });
    },
    from() {
      throw new Error("no table reads on a venues page");
    },
  };
  const jsonError = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const res = await handleDiscoverV2({ ...base, filters: { kind: "venues", f: { venueTypes: ["club"] } } } as never, client as never, jsonError);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.items, [{ kind: "venue", id: "v1" }]);
  assertEquals(body.nextCursor, null);
  const items = calls.find((c) => c.name === "discover_v2_items")!;
  assertEquals(items.args?.p_kind, "venues");
  assertEquals(items.args?.p_filters, { venueTypes: ["club"], _countryCode: "NG", _priceCatalog: {} });
  assertEquals(calls.some((c) => c.name.startsWith("issue_2009_tm") || c.name.includes("ticketmaster")), false);
});
