// issue #1020 [city-browse-geo-fallback] — edge-fn geo-threading contract (§8a).
//
// Proves the center/radius (already carried on the request) is threaded from the
// edge fn into the pg_discover_business_events RPC as p_center_lat/p_center_lng/
// p_radius_km, and that ABSENT coords flow as SQL NULL (city-only, unchanged).
//
//   T1 fetchDiscoverBusinessEvents forwards centerLat/Lng/radiusKm verbatim as
//      p_center_lat/p_center_lng/p_radius_km.
//   T2 fetchDiscoverBusinessEvents with null coords sends p_center_* = null.
//   T3 buildDiscoverMergedResponse threads ctx.city.fallbackLat/Lng/RadiusKm into
//      the RPC (proves _build-response wires the request's fallback fields).
//   T4 buildDiscoverMergedResponse with NO fallback fields sends nulls (`?? null`).
//
// FAILS-ON-REVERT: delete the `p_center_lat/p_center_lng/p_radius_km` lines from
// _business-query.ts's .rpc() call → T1/T3 FAIL (captured args become undefined).
//
// Run with:
//   deno test --allow-read --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_1020_geo_threading.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { fetchDiscoverBusinessEvents } from "../_business-query.ts";
import { buildDiscoverMergedResponse } from "../_build-response.ts";

type RpcArgs = Record<string, unknown>;

// Minimal capturing stub: records the last .rpc() args and returns an empty
// {total,rows} payload; .functions.invoke returns an empty TM leg so the
// merged-response path resolves without a network call.
function makeCapturingClient(): {
  client: SupabaseClient;
  lastRpc: () => { name: string; args: RpcArgs } | null;
} {
  let captured: { name: string; args: RpcArgs } | null = null;
  const stub = {
    rpc(name: string, args: RpcArgs) {
      captured = { name, args };
      return Promise.resolve({ data: { total: 0, rows: [] }, error: null });
    },
    functions: {
      invoke(_name: string, _opts: unknown) {
        return Promise.resolve({
          data: { events: [], meta: { totalResults: 0 } },
          error: null,
        });
      },
    },
  };
  return {
    client: stub as unknown as SupabaseClient,
    lastRpc: () => captured,
  };
}

const BASE_PARAMS = {
  cities: ["Brussels"],
  lowerBoundUtc: "2026-07-01T00:00:00.000Z",
  upperStartUtc: null,
  partyTypeSlugs: [] as string[],
  vibeTagSlugs: [] as string[],
  musicGenreSlugs: [] as string[],
  offset: 0,
  limit: 20,
};

Deno.test("issue #1020 T1 — fetchDiscoverBusinessEvents forwards center/radius verbatim", async () => {
  const { client, lastRpc } = makeCapturingClient();
  await fetchDiscoverBusinessEvents(client, {
    ...BASE_PARAMS,
    centerLat: 50.8503,
    centerLng: 4.3517,
    radiusKm: 50,
  });
  const call = lastRpc();
  assert(call !== null, "expected an .rpc() call");
  assertEquals(call!.name, "pg_discover_business_events");
  assertEquals(call!.args.p_center_lat, 50.8503);
  assertEquals(call!.args.p_center_lng, 4.3517);
  assertEquals(call!.args.p_radius_km, 50);
});

Deno.test("issue #1020 T2 — null coords send p_center_* = null (city-only unchanged)", async () => {
  const { client, lastRpc } = makeCapturingClient();
  await fetchDiscoverBusinessEvents(client, {
    ...BASE_PARAMS,
    centerLat: null,
    centerLng: null,
    radiusKm: null,
  });
  const call = lastRpc();
  assert(call !== null, "expected an .rpc() call");
  assertEquals(call!.args.p_center_lat, null);
  assertEquals(call!.args.p_center_lng, null);
  assertEquals(call!.args.p_radius_km, null);
});

Deno.test("issue #1020 T3 — buildDiscoverMergedResponse threads city.fallback* into the RPC", async () => {
  const { client, lastRpc } = makeCapturingClient();
  await buildDiscoverMergedResponse({
    supabase: client,
    cityName: "Brussels",
    city: {
      stateCode: null,
      countryCode: "BE",
      fallbackLat: 50.8503,
      fallbackLng: 4.3517,
      fallbackRadiusKm: 50,
    },
    page: 1,
    size: 20,
    partyTypeSlugs: [],
    vibeTagSlugs: [],
    musicGenreSlugs: [],
    dateWindowUtc: null,
  });
  const call = lastRpc();
  assert(call !== null, "expected an .rpc() call");
  assertEquals(call!.args.p_center_lat, 50.8503);
  assertEquals(call!.args.p_center_lng, 4.3517);
  assertEquals(call!.args.p_radius_km, 50);
});

Deno.test("issue #1020 T4 — buildDiscoverMergedResponse sends nulls when fallback* absent", async () => {
  const { client, lastRpc } = makeCapturingClient();
  await buildDiscoverMergedResponse({
    supabase: client,
    cityName: "Brussels",
    city: { stateCode: null, countryCode: "BE" },
    page: 1,
    size: 20,
    partyTypeSlugs: [],
    vibeTagSlugs: [],
    musicGenreSlugs: [],
    dateWindowUtc: null,
  });
  const call = lastRpc();
  assert(call !== null, "expected an .rpc() call");
  assertEquals(call!.args.p_center_lat, null);
  assertEquals(call!.args.p_center_lng, null);
  assertEquals(call!.args.p_radius_km, null);
});
