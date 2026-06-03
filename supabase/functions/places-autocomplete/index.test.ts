// META-ORCH-1009 Sub-E Rework 5 - Google Places legacy fallback.
// Run: deno test supabase/functions/places-autocomplete/index.test.ts

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handleAutocomplete, handleDetails } from "./index.ts";

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

Deno.test("places autocomplete falls back to legacy endpoint after v1 403", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://places.googleapis.com/v1/places:autocomplete") {
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "API key not authorized for Places API (New)",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    if (
      url.startsWith(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json?",
      )
    ) {
      const legacyUrl = new URL(url);
      assertEquals(
        legacyUrl.searchParams.get("input"),
        "301 S Blount St Raleigh",
      );
      assertEquals(legacyUrl.searchParams.get("key"), "server-side-key");
      return new Response(
        JSON.stringify({
          status: "OK",
          predictions: [
            {
              place_id: "legacy-place-301",
              description: "301 S Blount St, Raleigh, NC, USA",
              structured_formatting: { main_text: "301 S Blount St" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleAutocomplete(
      "server-side-key",
      "301 S Blount St Raleigh",
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(calls.length, 2);
    assertEquals(
      new Headers(calls[0]?.init?.headers).get("X-Goog-Api-Key"),
      "server-side-key",
    );
    assertEquals(body.suggestions, [
      {
        placeId: "legacy-place-301",
        displayName: "301 S Blount St",
        fullAddress: "301 S Blount St, Raleigh, NC, USA",
      },
    ]);
  } finally {
    restoreFetch();
  }
});

Deno.test("place details falls back to legacy endpoint after v1 403", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url === "https://places.googleapis.com/v1/places/legacy-place-301") {
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "API key not authorized for Places API (New)",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    if (
      url.startsWith("https://maps.googleapis.com/maps/api/place/details/json?")
    ) {
      const legacyUrl = new URL(url);
      assertEquals(legacyUrl.searchParams.get("place_id"), "legacy-place-301");
      assertEquals(legacyUrl.searchParams.get("key"), "server-side-key");
      assertStringIncludes(
        legacyUrl.searchParams.get("fields") ?? "",
        "address_components",
      );
      assertStringIncludes(
        legacyUrl.searchParams.get("fields") ?? "",
        "geometry",
      );
      return new Response(
        JSON.stringify({
          status: "OK",
          result: {
            place_id: "legacy-place-301",
            formatted_address: "301 S Blount St, Raleigh, NC 27601, USA",
            address_components: [
              {
                long_name: "Raleigh",
                short_name: "Raleigh",
                types: ["locality"],
              },
              {
                long_name: "North Carolina",
                short_name: "NC",
                types: ["administrative_area_level_1"],
              },
              {
                long_name: "United States",
                short_name: "US",
                types: ["country"],
              },
            ],
            geometry: { location: { lat: 35.775, lng: -78.636 } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleDetails("server-side-key", "legacy-place-301");
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(calls.length, 2);
    assertEquals(body.details, {
      placeId: "legacy-place-301",
      formattedAddress: "301 S Blount St, Raleigh, NC 27601, USA",
      city: "Raleigh",
      region: "NC",
      countryCode: "US",
      location: { lat: 35.775, lng: -78.636 },
    });
  } finally {
    restoreFetch();
  }
});
