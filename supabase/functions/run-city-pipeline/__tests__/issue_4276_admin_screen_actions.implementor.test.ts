// Issue #4276 wave 4: the two reads the Place pool screens add.
//   * run-city-pipeline action=health: providers, database, cached storage, the Serper
//     rate (null stays null, never a made-up price) and the view refresh, for an admin.
//   * admin-seed-places cities_search_status: every city's search gaps in one call; a
//     city that fails to load is reported with its error, never left out.
//
// FAILS-ON-REVERT: remove the "health" case and the health test gets 400. Make
// citiesSearchStatus skip a failing city and the error test finds no row for it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_URL", "http://local.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
Deno.env.set("GOOGLE_MAPS_API_KEY", "x");

const GATES = {
  db_bytes: 5_400_000_000,
  settings: {
    serper_usd_per_request: null, db_pause_bytes: 7_516_192_768, storage_total_bytes: 40_000_000_000,
    storage_ok: true, storage_message: null, storage_measured_at: "2026-11-05T10:00:00Z",
  },
  providers: {
    google_places: { status: "healthy", checked_at: new Date().toISOString() },
    gemini: { status: "healthy", checked_at: new Date().toISOString() },
    serper: { status: "down", http_status: 400, checked_at: new Date().toISOString() },
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  if (url.pathname === "/auth/v1/user") {
    return Promise.resolve(Response.json({ id: "a1", email: "admin@local.test", aud: "authenticated" }));
  }
  if (url.pathname === "/rest/v1/admin_users") return Promise.resolve(Response.json([{ id: "admin-row" }]));
  if (url.pathname === "/rest/v1/rpc/city_pipeline_gate_inputs") return Promise.resolve(Response.json(GATES));
  if (url.pathname === "/rest/v1/rpc/city_pipeline_mv_refresh_health") {
    return Promise.resolve(Response.json({ jobname: "refresh_admin_place_pool_mv", runs: 144, max_seconds: 99, interval_seconds: 600 }));
  }
  return Promise.resolve(Response.json({ message: `unexpected ${url.pathname}` }, { status: 500 }));
}) as typeof fetch;

const conductor = await import("../index.ts");
const { citiesSearchStatus } = await import("../../admin-seed-places/searchPipeline.ts");

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "health: what the Pipeline header shows, with an unset Serper rate left unknown", ...opts, fn: async () => {
  const res = await conductor.httpHandler(new Request("http://local.test/x", {
    method: "POST",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "health" }),
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.db_bytes, 5_400_000_000);
  assertEquals(body.db_pause_bytes, 7_516_192_768);
  assertEquals(body.storage_total_bytes, 40_000_000_000);
  assertEquals(body.serper_usd_per_request, null);
  assertEquals(body.mv_refresh.max_seconds, 99);
  const unhealthy = body.unhealthy.map((u: { provider: string }) => u.provider);
  assertEquals(unhealthy, ["serper"], JSON.stringify(body.unhealthy));
} });

// deno-lint-ignore no-explicit-any
function citiesDb(failing: string): any {
  const cities = [{ id: "c1", name: "Alpha" }, { id: "c2", name: "Beta" }];
  return {
    from: (table: string) => {
      assertEquals(table, "seeding_cities");
      let id: string | null = null;
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select: () => chain,
        order: () => Promise.resolve({ data: cities, error: null }),
        eq: (_c: string, v: string) => { id = v; return chain; },
        single: () => Promise.resolve({
          data: { id, name: id, tile_radius_m: 2000, bbox_sw_lat: 10, bbox_sw_lng: 10, bbox_ne_lat: 10.01, bbox_ne_lng: 10.01 },
          error: null,
        }),
      };
      return chain;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "seeding_city_search_status") {
        if (args.p_city_id === failing) return Promise.resolve({ data: null, error: { message: "timeout" } });
        return Promise.resolve({
          data: { unfinished: { total: 3 }, capped_open: 2, unresolved: [], last_completeness_check: null, dropped_at_seed: { no_photos: 4 }, active_run: null },
          error: null,
        });
      }
      if (fn === "seeding_active_tiles") {
        return Promise.resolve({ data: [{ id: "t", center_lat: 10.005, center_lng: 10.005, radius_m: 2000, kind: "grid", tile_index: 0, row_idx: 0, col_idx: 0, level: 0 }], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
    },
  };
}

Deno.test({ name: "cities_search_status: every city, and a failing one is reported, not dropped", ...opts, fn: async () => {
  const { cities } = await citiesSearchStatus(citiesDb("c2"));
  assertEquals(cities.length, 2);
  const alpha = cities.find((c) => c.cityId === "c1")!;
  assertEquals(alpha.unfinishedSearches, 3);
  assertEquals(alpha.cappedOpen, 2);
  assertEquals(alpha.uncoveredTiles, 0);
  assertEquals(alpha.complete, false);
  assertEquals(alpha.error, null);
  const beta = cities.find((c) => c.cityId === "c2")!;
  assert(String(beta.error).includes("timeout"), JSON.stringify(beta));
} });

addEventListener("unload", () => {
  globalThis.fetch = realFetch;
});
