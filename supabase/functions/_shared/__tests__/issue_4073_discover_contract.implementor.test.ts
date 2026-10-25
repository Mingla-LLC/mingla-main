import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { discoverCurrency } from "../discoverCurrency.ts";
import { discoverPriceBands } from "../discoverPriceBands.ts";
import { discoverPriceBandCatalog } from "../discoverPriceBands.ts";
import { DISCOVER_CITY_WATCH_COPY, discoverCityWatchCopy } from "../discoverCityWatchCopy.ts";
import { discoverV2ValidationFailure, isDiscoverV2Request, validateDiscoverV2Request } from "../../discover-merged-events/_v2_types.ts";
import { buildDiscoverV2Key } from "../../discover-merged-events/_v2_key.ts";
import { decodeCursor, encodeCursor, filterTm, shouldLoadTicketmaster, tmDateMatches } from "../../discover-merged-events/_v2_handler.ts";
import {
  collapseTicketmasterOccurrences,
  resetTicketmasterPoolForTests,
  resolveTicketmasterPool,
  ticketmasterPoolMetadata,
  ticketmasterWindowIsCapped,
  type TicketmasterPool,
} from "../../discover-merged-events/_v2_tm_pool.ts";
import { mapMinglaMusicGenresToTmSlugs } from "../eventTaxonomy.ts";

const locales = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];
const copyFields = ["pushTitle", "pushBody", "emailSubject", "emailBody", "inappTitle", "inappBody"] as const;

Deno.test("#4073 resolves city currency before falling back to local supply currency", () => {
  assertEquals(discoverCurrency("gb", "NGN"), "GBP");
  assertEquals(discoverCurrency("NG", "USD"), "NGN");
  assertEquals(discoverCurrency(null, "eur"), "EUR");
  assertEquals(discoverCurrency(null, "not-money"), "USD");
});
Deno.test("#4073 publishes currency-specific price bands without fabricating an unknown currency", () => {
  assertEquals(discoverPriceBands("events", "GBP")?.edgesMinor, [2_000, 4_000]);
  assertEquals(discoverPriceBands("experiences", "NGN")?.edgesMinor, [2_000_000, 5_000_000]);
  assertEquals(discoverPriceBands("events", "JPY"), null);
  assertEquals(discoverPriceBandCatalog("events").GBP, [2_000, 4_000]);
  assertEquals(discoverPriceBandCatalog("experiences").NGN, [2_000_000, 5_000_000]);
});

Deno.test("#4073 cache keys normalize filter order and bind contract inputs", () => {
  const common = { contract: 2 as const, op: "page" as const, anchor: { name: "London", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 } };
  const a = buildDiscoverV2Key({ ...common, filters: { kind: "events", f: { vibeTags: ["wild", "chill"], partyTypes: ["rave"] } } }, "g1", "Europe/London", "GBP");
  const b = buildDiscoverV2Key({ ...common, filters: { kind: "events", f: { partyTypes: ["rave"], vibeTags: ["chill", "wild"] } } }, "g1", "Europe/London", "GBP");
  assertEquals(a, b);
  assert(a.includes("tmHorizonDays"));
  assert(a.includes("tmSegmentMode"));
  assert(a.includes("tmOccurrenceCatalogVersion"));
  const cursor = encodeCursor({ m: 20, t: 0, k: a });
  const pageTwo = buildDiscoverV2Key({ ...common, cursor, filters: { kind: "events", f: { vibeTags: ["wild", "chill"], partyTypes: ["rave"] } } }, "g1", "Europe/London", "GBP");
  assertEquals(pageTwo, a);
  assertEquals(decodeCursor(cursor, pageTwo), { m: 20, t: 0 });
  const nextCursor = encodeCursor({ m: 40, t: 3, k: pageTwo });
  assertEquals(decodeCursor(nextCursor, a), { m: 40, t: 3 });
  assertEquals(decodeCursor(nextCursor, `${a}:tampered`), null);
});

Deno.test("#4073 v2 discriminator cannot capture a v1 request", () => {
  assert(!isDiscoverV2Request({ city: { name: "London" } }));
  const valid = { contract: 2, op: "facets", anchor: { name: "London", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 }, filters: { kind: "events", f: {} } };
  assert(isDiscoverV2Request(valid));
  assertEquals(validateDiscoverV2Request({ ...valid, anchor: null }), "invalid_anchor");
  assertEquals(validateDiscoverV2Request({ ...valid, anchor: { ...valid.anchor, lat: Number.NaN } }), "invalid_anchor");
  assertEquals(validateDiscoverV2Request({ ...valid, filters: { kind: "events", f: null } }), "invalid_filters");
  assertEquals(validateDiscoverV2Request({ ...valid, cursor: 42 }), "invalid_cursor");
  assert(!isDiscoverV2Request({ contract: 2, op: "delete", anchor: {}, filters: {} }));
});

Deno.test("#4073 rejects every malformed enum domain with 400 before dispatch", () => {
  const base = {
    contract: 2, op: "facets",
    anchor: { name: "London", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 },
    deviceTz: "Europe/London",
  };
  const invalidDiscriminants = [
    { label: "operation", request: { ...base, op: "delete", filters: { kind: "events", f: {} } } },
    { label: "kind", request: { ...base, filters: { kind: "venues", f: {} } } },
  ];
  for (const { label, request } of invalidDiscriminants) {
    const failure = discoverV2ValidationFailure(request);
    assertEquals(failure?.status, 400, `${label} must stop at the pre-dispatch boundary`);
    assert(!isDiscoverV2Request(request), `${label} must not reach RPC dispatch`);
  }

  const invalid = [
    { label: "event when", filters: { kind: "events", f: { when: "tonight" } } },
    { label: "event price", filters: { kind: "events", f: { price: ["free"] } } },
    { label: "party type", filters: { kind: "events", f: { partyTypes: ["dinner"] } } },
    { label: "vibe", filters: { kind: "events", f: { vibeTags: ["sleepy"] } } },
    { label: "music", filters: { kind: "events", f: { musicGenres: ["opera-metal"] } } },
    { label: "experience when", filters: { kind: "experiences", f: { when: "tonight" } } },
    { label: "experience good-for", filters: { kind: "experiences", f: { goodFor: ["solo"] } } },
    { label: "experience price", filters: { kind: "experiences", f: { price: ["free_ticket"] } } },
    { label: "trip when", filters: { kind: "trips", f: { when: "tomorrow" } } },
    { label: "stay check-in", filters: { kind: "stays", f: { checkIn: "this_month" } } },
    { label: "stay property kind", filters: { kind: "stays", f: { propertyKinds: ["villa"] } } },
    { label: "stay guests", filters: { kind: "stays", f: { guests: 9 } } },
    { label: "extra filter", filters: { kind: "events", f: { audience: "everyone" } } },
    { label: "timezone", filters: { kind: "events", f: {} }, deviceTz: "Mars/Olympus" },
  ];
  for (const { label, filters, deviceTz } of invalid) {
    const failure = discoverV2ValidationFailure({ ...base, filters, ...(deviceTz ? { deviceTz } : {}) });
    assertEquals(failure?.status, 400, `${label} must stop at the pre-dispatch boundary`);
    assert(!isDiscoverV2Request({ ...base, filters, ...(deviceTz ? { deviceTz } : {}) }), `${label} must not reach RPC dispatch`);
  }

  const valid = [
    { kind: "events", f: { when: "weekend", price: ["free_rsvp", "free_ticket", "band_4"], partyTypes: ["rave"], vibeTags: ["chill"], musicGenres: ["afrobeats"] } },
    { kind: "experiences", f: { when: "tomorrow", goodFor: ["adventurous", "first-date", "romantic", "group-fun"], price: ["free", "band_3"] } },
    { kind: "trips", f: { destination: "place:destination", leavingFrom: "place:departure", when: "next_month" } },
    { kind: "stays", f: { checkIn: "tonight", guests: 8, propertyKinds: ["hotel", "resort", "guest_house", "lodge", "serviced_apartment", "short_stay_apartment", "other"] } },
  ];
  for (const filters of valid) {
    assertEquals(discoverV2ValidationFailure({ ...base, filters }), null, `${filters.kind} valid controls pass`);
    assert(isDiscoverV2Request({ ...base, filters }), `${filters.kind} valid controls reach dispatch`);
  }
});

Deno.test("#4073 canonical Mingla music slugs filter the matching Ticketmaster classifications", () => {
  assertEquals(mapMinglaMusicGenresToTmSlugs(["electronic-edm", "afrobeats", "rnb-soul", "reggae-dancehall", "indie"]), {
    tmMappable: ["dance-electronic", "afro", "rnb", "reggae", "alternative"],
    minglaOnly: [],
  });
  const base = {
    contract: 2 as const, op: "page" as const,
    anchor: { name: "London", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 },
  };
  const item = (id: string, genreId: string, subGenreId: string | null = null) => ({ id, eventName: id, venueName: "V", image: "", localDate: "2026-11-01", localTime: "20:00:00", dateTimeUTC: "2026-11-01T20:00:00Z", genre: null, genreId, subGenreId, priceMin: null, priceMax: null, priceCurrency: null, ticketStatus: "onsale", ticketUrl: "" });
  const pool: TicketmasterPool = { items: [
    item("edm", "KnvZfZ7vAvF"), item("afro", "KnvZfZ7vAeF"), item("rnb", "KnvZfZ7vAee"), item("reggae", "KnvZfZ7vAed"), item("indie", "KnvZfZ7vAvv"),
  ], poolCoverageEnd: "2026-11-01T20:00:00Z", capped: false, partial: false, error: null, fromCache: false };
  for (const [slug, expected] of [["electronic-edm", "edm"], ["afrobeats", "afro"], ["rnb-soul", "rnb"], ["reggae-dancehall", "reggae"], ["indie", "indie"]] as const) {
    assertEquals(filterTm(pool, { ...base, filters: { kind: "events", f: { musicGenres: [slug] } } }, "UTC").map((row) => row.id), [expected]);
  }
});

Deno.test("#4073 Ticketmaster weekend filtering uses Friday 18:00 through Monday city time", () => {
  const zone = "America/New_York";
  assert(!tmDateMatches("2026-10-23", "17:59:59", "weekend", zone, new Date("2026-10-23T20:00:00Z")));
  assert(tmDateMatches("2026-10-23", "18:00:00", "weekend", zone, new Date("2026-10-23T20:00:00Z")));
  assert(!tmDateMatches("2026-10-23", "18:30:00", "weekend", zone, new Date("2026-10-24T00:15:00Z")));
  assert(tmDateMatches("2026-10-24", "00:30:00", "weekend", zone, new Date("2026-10-24T00:15:00Z")));
  assert(tmDateMatches("2026-10-25", "23:59:59", "weekend", zone, new Date("2026-10-25T16:00:00Z")));
  assert(!tmDateMatches("2026-10-26", "00:00:00", "weekend", zone, new Date("2026-10-25T16:00:00Z")));
});

Deno.test("#4073 facets always load the Ticketmaster pool so Events stays visible", () => {
  assert(shouldLoadTicketmaster({ op: "facets", filters: { kind: "trips", f: {} } }));
  assert(shouldLoadTicketmaster({ op: "page", filters: { kind: "events", f: {} } }));
  assert(!shouldLoadTicketmaster({ op: "page", filters: { kind: "trips", f: {} } }));
});

Deno.test("#3988 Ticketmaster recurring performances collapse to the earliest named event at each venue", () => {
  const occurrence = (id: string, eventName: string, localDate: string, venueName = "Theatre") => ({
    id, eventName, venueName, image: "", localDate, localTime: "19:00:00",
    dateTimeUTC: `${localDate}T23:00:00Z`, genre: null, genreId: null, subGenreId: null,
    priceMin: null, priceMax: null, priceCurrency: null, ticketStatus: "onsale", ticketUrl: "",
  });
  const collapsed = collapseTicketmasterOccurrences([
    occurrence("early", "Curtain Call From Beyond", "2026-10-25"),
    occurrence("later", "  CURTAIN   CALL FROM BEYOND ", "2026-10-26", " THEATRE "),
    occurrence("other-venue", "Curtain Call From Beyond", "2026-10-26", "Grand Theatre"),
    occurrence("accessible", "Accessible Curtain Call From Beyond", "2026-10-25"),
    occurrence("untitled-1", "Untitled Event", "2026-10-25"),
    occurrence("untitled-2", "Untitled Event", "2026-10-26"),
  ]);
  assertEquals(collapsed.map((item) => item.id), ["early", "other-venue", "accessible", "untitled-1", "untitled-2"]);

  const tomorrowRequest = {
    contract: 2 as const, op: "page" as const,
    anchor: { name: "London", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 },
    filters: { kind: "events" as const, f: { when: "tomorrow" as const } },
  };
  const pool: TicketmasterPool = {
    items: [
      occurrence("today", "Daily Show", "2026-10-25"),
      occurrence("tomorrow", "Daily Show", "2026-10-26"),
    ],
    poolCoverageEnd: null, capped: false, partial: false, error: null, fromCache: false,
  };
  assertEquals(
    collapseTicketmasterOccurrences(
      filterTm(pool, tomorrowRequest, "UTC", new Date("2026-10-25T12:00:00Z")),
    ).map((item) => item.id),
    ["tomorrow"],
  );
});

Deno.test("#4073 city-watch copy covers all 29 locales with byte-exact placeholders", () => {
  assertEquals(Object.keys(DISCOVER_CITY_WATCH_COPY).sort(), [...locales].sort());
  for (const locale of locales) {
    const copy = DISCOVER_CITY_WATCH_COPY[locale];
    for (const field of copyFields) {
      assert(copy[field].trim().length > 0, `${locale}.${field} is empty`);
      const expected = field === "pushTitle" || field === "emailSubject" || field === "emailBody" || field === "inappTitle" ? ["city"] : [];
      const actual = [...copy[field].matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
      assertEquals(actual, expected, `${locale}.${field} placeholders`);
    }
  }
  assertEquals(discoverCityWatchCopy("unknown", "Accra").pushTitle, "Accra has plans now");
  assertEquals(discoverCityWatchCopy("fr", "Paris").pushTitle.includes("Paris"), true);
});

Deno.test("#4073 Ticketmaster pool enforces paging, budget claims, memory SWR, coverage-aware caps", async () => {
  resetTicketmasterPoolForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const total = 640;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const page = Number(JSON.parse(String(init?.body)).page);
    await Promise.resolve();
    inFlight -= 1;
    const count = Math.min(200, total - page * 200);
    const events = Array.from({ length: count }, (_, index) => ({
      id: `p${page}-${index}`, eventName: `E-${page}-${index}`, venueName: "V", image: "",
      localDate: "2026-11-01", localTime: "20:00:00", dateTimeUTC: `2026-11-${String(Math.min(28, page + 1)).padStart(2, "0")}T20:00:00Z`,
      genre: null, genreId: null, subGenreId: null, priceMin: null, priceMax: null,
      priceCurrency: null, ticketStatus: "onsale", ticketUrl: "",
    }));
    return new Response(JSON.stringify({ events, meta: { totalResults: total } }), { status: 200 });
  }) as typeof fetch;
  let claims = 0;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain; chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.upsert = () => Promise.resolve({ error: null });
  const client = {
    rpc: (name: string) => Promise.resolve({ data: name === "discover_v2_claim_tm_budget" ? (claims += 1, true) : true, error: null }),
    from: () => chain,
  };
  try {
    const request = { anchor: { name: "Runtime Pool", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 }, localStartEndDateTime: "2026-10-24T00:00:00,2027-02-21T00:00:00", timezone: "UTC" };
    const first = await resolveTicketmasterPool(client, request);
    assertEquals(first.items.length, 640);
    assertEquals(first.capped, false);
    assertEquals(calls, 4);
    assertEquals(claims, 4);
    assert(maxInFlight <= 2);
    const second = await resolveTicketmasterPool(client, request);
    assert(second.fromCache);
    assertEquals(calls, 4);

    const partial = ticketmasterPoolMetadata(first.items.slice(0, 200), 640, true);
    assert(partial.capped);
    assertEquals(ticketmasterWindowIsCapped(partial, "2026-10-31T00:00:00Z"), false);
    assertEquals(ticketmasterWindowIsCapped(partial, "2027-03-01T00:00:00Z"), true);
    const localOnly = { ...first.items[0], dateTimeUTC: null, localDate: "2026-11-01", localTime: "20:00:00" };
    assertEquals(
      ticketmasterPoolMetadata([localOnly], 2, false, "America/New_York").poolCoverageEnd,
      "2026-11-02T01:00:00.000Z",
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetTicketmasterPoolForTests();
  }
});

Deno.test("#4073 server owns canonical eligibility, exact facets, horizon, price and nearest-city rules", async () => {
  const migration = await Deno.readTextFile(new URL("../../../migrations/20271218004073_issue_4073_discover_feed_v2.sql", import.meta.url));
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.discover_v2_event_base'));
  assert(migration.includes('FROM public.discover_v2_event_base('));
  assert(migration.includes("master_ed.is_master IS TRUE"));
  assert(migration.includes("occurrence.end_at>=p_lower_bound"));
  assert(migration.includes("issue_1931_event_ordinary_read_blocked"));
  assert(migration.includes("pg_brand_can_collect"));
  assert(migration.includes("'tm_horizon_120'"));
  assert(migration.includes("discover_v2_price_matches"));
  assert(migration.includes("experience_stops"));
  assert(migration.includes("departure_country_code::text,b.country_code"));
  assert(migration.includes("discover_v2_stay_room_available"));
  assert(migration.includes("discover_v2_option_count"));
  assert(migration.includes("discover_v2_nearest_city"));
  assert(migration.includes("distance_km<=500"));
  assert(migration.includes("discover_v2_facets_exact"));
});
