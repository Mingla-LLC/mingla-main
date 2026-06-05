// META-ORCH-1060 [Mapbox consumer migration] §4.5/§4.6 — server forward-geocode
// helper regression test.
//
// Proves forwardGeocodeText: parses Mapbox /forward GeoJSON [lng,lat] → {lat,lng},
// returns null on empty text / missing token / no feature, and caches results
// (incl. negatives) so repeat text hits at most one Mapbox call.
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/_shared/__tests__/meta_orch_1060_mapbox_geocode.test.ts

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  forwardGeocodeText,
  __clearForwardGeocodeCacheForTests,
} from "../mapboxGeocode.ts";

function withMockFetch(
  impl: (url: string) => Response,
  run: () => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: any) =>
    Promise.resolve(impl(String(input)))) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = orig;
  });
}

Deno.test("forwardGeocodeText: GeoJSON [lng,lat] → {lat,lng}", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({ features: [{ geometry: { coordinates: [2.3522, 48.8566] } }] }),
        { status: 200 },
      ),
    async () => {
      const r = await forwardGeocodeText("Paris, France");
      assertEquals(r, { lat: 48.8566, lng: 2.3522 });
    },
  );
});

Deno.test("forwardGeocodeText: empty text → null, no fetch", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let fetched = false;
  await withMockFetch(
    () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    },
    async () => {
      assertEquals(await forwardGeocodeText("   "), null);
      assertEquals(await forwardGeocodeText(null), null);
      assertEquals(fetched, false);
    },
  );
});

Deno.test("forwardGeocodeText: missing token → null", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.delete("MAPBOX_ACCESS_TOKEN");
  await withMockFetch(
    () => new Response("{}", { status: 200 }),
    async () => {
      assertEquals(await forwardGeocodeText("Anywhere"), null);
    },
  );
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
});

Deno.test("forwardGeocodeText: caches negative result (no feature)", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let calls = 0;
  await withMockFetch(
    () => {
      calls += 1;
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    },
    async () => {
      assertEquals(await forwardGeocodeText("Atlantis"), null);
      assertEquals(await forwardGeocodeText("atlantis"), null); // case-normalized key
      assertEquals(calls, 1);
    },
  );
});

Deno.test("forwardGeocodeText: non-OK response → null, not cached", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let calls = 0;
  await withMockFetch(
    () => {
      calls += 1;
      return calls === 1
        ? new Response("err", { status: 500 })
        : new Response(
            JSON.stringify({ features: [{ geometry: { coordinates: [1, 2] } }] }),
            { status: 200 },
          );
    },
    async () => {
      assertEquals(await forwardGeocodeText("Retry City"), null); // 500 → null
      assertEquals(await forwardGeocodeText("Retry City"), { lat: 2, lng: 1 }); // retried
      assertEquals(calls, 2);
    },
  );
});
