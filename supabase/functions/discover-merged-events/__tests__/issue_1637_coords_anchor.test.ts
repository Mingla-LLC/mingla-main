// #1637 [discover-single-fetch] — server half: the merged endpoint accepts a
// COORDS-ONLY anchor, so ONE request can carry both supplies.
//
// WHY THIS EXISTS. `discover-merged-events` used to reject any request without
// `city.name` (400 `city_required`). A consumer cold launch has device
// coordinates 1-3s before a reverse-geocode of those same coordinates can name
// the place, so the client had no choice but to call the Ticketmaster-only
// endpoint first and this one second — two fetches, two commits, Mingla
// structurally last, and a deck that re-ordered after it had painted. Nothing
// about the fan-out required a city: the business RPC already had an ST_DWithin
// geo predicate (issue #1020) and Ticketmaster has latlong+radius mode.
//
// CONTRACTS
//   T-1  a coords anchor sends p_cities: [] and the center/radius to the RPC
//        (`= ANY('{}')` is FALSE, so selection passes cleanly to the geo branch)
//   T-2  a coords anchor asks Ticketmaster in location+radius mode, and sends NO
//        `city` key (the TM function rejects city AND location together)
//   T-3  BOTH anchors send TM a 0-indexed page. The merged fn is 1-indexed on
//        the wire and was forwarding the value unconverted, so it asked TM for
//        page 2 while the client's direct call asked for page 1 — two disjoint
//        event sets, which is why the deck SWAPPED rather than merely shifted
//   T-4  a city anchor is byte-unchanged (no regression for a picked city)
//   T-5  the cache key keeps coords and city anchors in separate slots, and is
//        stable for a repeated coords request (no per-request fragmentation)
//   T-6  meta.tmUsedFallback is threaded from the nested TM response, which is
//        what finally makes the consumer's "Showing events near you" banner
//        reachable
//
// FAILS-ON-REVERT: restore `cities: cityMatchValues(cityName)` unconditionally
// in _build-response.ts → T-1 fails (and the coords path throws on a null city).
// Restore `page` in place of `tmPage` → T-3 fails.
//
// Run with:
//   deno test --allow-read --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_1637_coords_anchor.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildDiscoverMergedResponse } from "../_build-response.ts";
import { buildDiscoverCacheKey } from "../_cache.ts";

type Args = Record<string, unknown>;

/**
 * Captures the RPC args and the nested `ticketmaster-events` invoke body.
 * `tmMeta` lets a test decide what the nested TM call reports back.
 */
function makeCapturingClient(tmMeta: Record<string, unknown> = { totalResults: 0 }): {
  client: SupabaseClient;
  rpcArgs: () => Args | null;
  tmBody: () => Args | null;
} {
  let rpc: Args | null = null;
  let tm: Args | null = null;
  const stub = {
    rpc(_name: string, args: Args) {
      rpc = args;
      return Promise.resolve({ data: { total: 0, rows: [] }, error: null });
    },
    functions: {
      invoke(_name: string, opts: { body?: Args }) {
        tm = opts?.body ?? null;
        return Promise.resolve({
          data: { events: [], meta: tmMeta },
          error: null,
        });
      },
    },
  };
  return {
    client: stub as unknown as SupabaseClient,
    rpcArgs: () => rpc,
    tmBody: () => tm,
  };
}

const COORDS = { lat: 35.78, lng: -78.638, radiusKm: 50 };

function coordsCtx(client: SupabaseClient) {
  return {
    supabase: client,
    // The cold-launch shape: coordinates, no name.
    cityName: null,
    city: {
      stateCode: null,
      countryCode: null,
      fallbackLat: COORDS.lat,
      fallbackLng: COORDS.lng,
      fallbackRadiusKm: COORDS.radiusKm,
    },
    page: 1,
    size: 20,
    partyTypeSlugs: [] as string[],
    vibeTagSlugs: [] as string[],
    musicGenreSlugs: [] as string[],
    dateWindowUtc: null,
    segmentSlug: "music",
    genreSlugs: [] as string[],
    localStartEndDateTime: undefined,
    keywords: undefined,
    sort: "date,asc",
  };
}

function cityCtx(client: SupabaseClient) {
  return {
    ...coordsCtx(client),
    cityName: "Raleigh",
    city: {
      stateCode: "NC",
      countryCode: "US",
      fallbackLat: COORDS.lat,
      fallbackLng: COORDS.lng,
      fallbackRadiusKm: COORDS.radiusKm,
    },
  };
}

Deno.test("#1637 T-1 coords anchor sends p_cities: [] and threads the center/radius", async () => {
  const cap = makeCapturingClient();
  await buildDiscoverMergedResponse(coordsCtx(cap.client));

  const args = cap.rpcArgs();
  assert(args !== null, "the business RPC must still be called on a coords anchor");
  assertEquals(
    args.p_cities,
    [],
    "no city name means no city predicate — `= ANY('{}')` is FALSE, so ST_DWithin governs alone",
  );
  assertEquals(args.p_center_lat, COORDS.lat);
  assertEquals(args.p_center_lng, COORDS.lng);
  assertEquals(args.p_radius_km, COORDS.radiusKm);
});

Deno.test("#1637 T-2 coords anchor asks Ticketmaster in location+radius mode, with NO city key", async () => {
  const cap = makeCapturingClient();
  await buildDiscoverMergedResponse(coordsCtx(cap.client));

  const body = cap.tmBody();
  assert(body !== null, "Ticketmaster must still be called on a coords anchor");
  assertEquals(body.location, { lat: COORDS.lat, lng: COORDS.lng });
  assertEquals(body.radius, COORDS.radiusKm);
  assert(
    !("city" in body),
    "`ticketmaster-events` 400s on city AND location together — the city key must be absent, not null",
  );
  assert(!("stateCode" in body));
  assert(!("countryCode" in body));
  assertEquals(body.segmentSlug, "music");
  assertEquals(body.sort, "date,asc");
  assertEquals(body.size, 20);
});

Deno.test("#1637 T-3 both anchors send Ticketmaster a 0-indexed page (merged is 1-indexed on the wire)", async () => {
  const coords = makeCapturingClient();
  await buildDiscoverMergedResponse(coordsCtx(coords.client));
  assertEquals(
    coords.tmBody()?.page,
    0,
    "merged page 1 is Ticketmaster page 0 — forwarding 1 asked TM for its SECOND page",
  );

  const city = makeCapturingClient();
  await buildDiscoverMergedResponse(cityCtx(city.client));
  assertEquals(city.tmBody()?.page, 0);

  // Page 2 still maps to TM page 1 — the conversion is an offset, not a clamp.
  const page2 = makeCapturingClient();
  await buildDiscoverMergedResponse({ ...coordsCtx(page2.client), page: 2 });
  assertEquals(page2.tmBody()?.page, 1);
});

Deno.test("#1637 T-4 city anchor is unchanged (a picked city still queries by name)", async () => {
  const cap = makeCapturingClient();
  await buildDiscoverMergedResponse(cityCtx(cap.client));

  assertEquals(cap.rpcArgs()?.p_cities, ["Raleigh"]);
  assertEquals(cap.rpcArgs()?.p_center_lat, COORDS.lat);

  const body = cap.tmBody();
  assertEquals(body?.city, "Raleigh");
  assertEquals(body?.stateCode, "NC");
  assertEquals(body?.countryCode, "US");
  assertEquals(body?.latFallback, COORDS.lat);
  assertEquals(body?.radiusFallback, COORDS.radiusKm);
  assert(!("location" in (body ?? {})), "city mode must not also send location");
});

Deno.test("#1637 T-5 cache key: coords and city anchors are separate slots, and a repeat coords request is stable", () => {
  const base = {
    page: 1,
    size: 20,
    partyTypeSlugs: [] as string[],
    vibeTagSlugs: [] as string[],
    musicGenreSlugs: [] as string[],
    dateWindowUtc: null,
    timezone: "America/New_York",
    fallbackLat: COORDS.lat,
    fallbackLng: COORDS.lng,
    fallbackRadiusKm: COORDS.radiusKm,
  };
  const coordsKey = buildDiscoverCacheKey({ ...base, cityName: null });
  const cityKey = buildDiscoverCacheKey({ ...base, cityName: "Raleigh" });
  assertNotEquals(
    coordsKey,
    cityKey,
    "a coords query and a city query are different questions and must never share a cached answer",
  );

  // Repeatability — the client snaps device coordinates to ~110m before they
  // arrive, so a second launch from the same place reuses the same L2 row
  // instead of minting one row per request.
  assertEquals(buildDiscoverCacheKey({ ...base, cityName: null }), coordsKey);

  // An empty-string city must not be treated as a city.
  assertNotEquals(buildDiscoverCacheKey({ ...base, cityName: "" }), cityKey);

  // A genuinely different place still keys differently.
  assertNotEquals(
    buildDiscoverCacheKey({ ...base, cityName: null, fallbackLat: 35.99, fallbackLng: -78.9 }),
    coordsKey,
  );
});

Deno.test("#1637 T-6 meta.tmUsedFallback is threaded from the nested Ticketmaster response", async () => {
  const off = makeCapturingClient({ totalResults: 0, usedFallback: false });
  const offRes = await buildDiscoverMergedResponse(cityCtx(off.client));
  assertEquals(offRes.meta.tmUsedFallback, false);

  const on = makeCapturingClient({ totalResults: 3, usedFallback: true });
  const onRes = await buildDiscoverMergedResponse(cityCtx(on.client));
  assertEquals(
    onRes.meta.tmUsedFallback,
    true,
    "the city→lat/lng widening must reach the client — it feeds the 'Showing events near you' banner",
  );

  // The ORCH-0839-A meta/items contracts are untouched by the new field.
  assertEquals(onRes.meta.businessCount, 0);
  assertEquals(onRes.meta.ticketmasterCount, 0);
  assertEquals(onRes.meta.tmCalled, true);
});
