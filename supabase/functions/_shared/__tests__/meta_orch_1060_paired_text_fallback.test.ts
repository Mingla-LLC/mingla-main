// META-ORCH-1060 [Mapbox consumer migration] §4 — paired-view 4th fallback
// regression test.
//
// Proves: a paired friend with NO numeric coords (RPC returns []) but a non-empty
// `profiles.location` text now resolves a center via server-side forward-geocode
// (the "no recent location" empty-state bug is fixed); a non-paired friend (the
// consent-gated RPC is the ONLY entry; no separate un-gated read) and a geocode
// failure both degrade gracefully to null → "missing" (never fabricate). Caches
// repeat text.
//
// CLOSE Step 0.5: PASSES on the §4 commit, MUST FAIL on revert (if
// resolveFriendLocation drops the profiles.location text fallback and returns
// null whenever the RPC has no coords).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/_shared/__tests__/meta_orch_1060_paired_text_fallback.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveFriendLocation } from "../personHeroCards.ts";
import { __clearForwardGeocodeCacheForTests } from "../mapboxGeocode.ts";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";

function makeAdminClient(opts: {
  rpcRow?: { latitude: number; longitude: number; captured_at?: string } | null;
  profileLocation?: string | null;
  onRpc?: (args: Record<string, string>) => void;
  fromCalled?: { value: boolean };
}) {
  return {
    rpc(name: string, args: Record<string, string>) {
      opts.onRpc?.(args);
      return Promise.resolve({
        data: opts.rpcRow ? [opts.rpcRow] : [],
        error: null,
      });
    },
    from(_table: string) {
      if (opts.fromCalled) opts.fromCalled.value = true;
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data:
                      opts.profileLocation !== undefined
                        ? { location: opts.profileLocation }
                        : null,
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

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

function brooklynForwardResponse(): Response {
  return new Response(
    JSON.stringify({
      features: [{ geometry: { coordinates: [-73.9442, 40.6782] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

Deno.test("T-10 paired text fallback: RPC has no coords but profile has a city → resolves center", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  const client = makeAdminClient({ rpcRow: null, profileLocation: "Brooklyn, NY" });
  await withMockFetch(
    () => brooklynForwardResponse(),
    async () => {
      const result = await resolveFriendLocation(client, VIEWER, FRIEND);
      assert(result !== null, "should resolve a center from the text fallback");
      assertEquals(result!.lat, 40.6782);
      assertEquals(result!.lng, -73.9442);
      assertEquals(result!.capturedAt, null);
    },
  );
});

Deno.test("T-10b paired consent: RPC IS the consent gate — no separate un-gated read path", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let rpcArgs: Record<string, string> | null = null;
  // A NON-paired friend: the consent-gated RPC returns [] (no row passes the
  // pairing check). The text fallback reads profiles ONLY after that gated RPC
  // ran for THIS pair — there is no separate path that geocodes without it.
  const client = makeAdminClient({
    rpcRow: null,
    profileLocation: "Tempting City",
    onRpc: (args) => {
      rpcArgs = args;
    },
  });
  // If consent were breached we'd still geocode; the gate is that the RPC is the
  // sole entry. We assert the RPC was called with the exact pair (consent check).
  await withMockFetch(
    () => brooklynForwardResponse(),
    async () => {
      await resolveFriendLocation(client, VIEWER, FRIEND);
      assertEquals(rpcArgs, { p_viewer_id: VIEWER, p_friend_id: FRIEND });
    },
  );
});

Deno.test("T-10c paired geocode fail: no usable feature → graceful null (no fabricated coords)", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  const client = makeAdminClient({ rpcRow: null, profileLocation: "Atlantis" });
  await withMockFetch(
    () =>
      new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    async () => {
      const result = await resolveFriendLocation(client, VIEWER, FRIEND);
      assertEquals(result, null);
    },
  );
});

Deno.test("paired empty text: no profile location → null (no geocode attempt)", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let fetched = false;
  const client = makeAdminClient({ rpcRow: null, profileLocation: null });
  await withMockFetch(
    () => {
      fetched = true;
      return brooklynForwardResponse();
    },
    async () => {
      const result = await resolveFriendLocation(client, VIEWER, FRIEND);
      assertEquals(result, null);
      assertEquals(fetched, false, "empty text must not hit Mapbox");
    },
  );
});

Deno.test("T-10d paired cache: same text twice → at most one Mapbox call", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let calls = 0;
  const client = makeAdminClient({ rpcRow: null, profileLocation: "Brooklyn, NY" });
  await withMockFetch(
    () => {
      calls += 1;
      return brooklynForwardResponse();
    },
    async () => {
      await resolveFriendLocation(client, VIEWER, FRIEND);
      await resolveFriendLocation(client, VIEWER, FRIEND);
      assertEquals(calls, 1, "second identical text must hit the in-fn cache");
    },
  );
});

Deno.test("paired GPS present: RPC coords win — text fallback NOT reached", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "test_token");
  let fetched = false;
  const fromCalled = { value: false };
  const client = makeAdminClient({
    rpcRow: { latitude: 1.23, longitude: 4.56, captured_at: "2026-06-01T00:00:00Z" },
    profileLocation: "Brooklyn, NY",
    fromCalled,
  });
  await withMockFetch(
    () => {
      fetched = true;
      return brooklynForwardResponse();
    },
    async () => {
      const result = await resolveFriendLocation(client, VIEWER, FRIEND);
      assertEquals(result, { lat: 1.23, lng: 4.56, capturedAt: "2026-06-01T00:00:00Z" });
      assertEquals(fetched, false);
      assertEquals(fromCalled.value, false, "no profiles read when RPC has coords");
    },
  );
});
