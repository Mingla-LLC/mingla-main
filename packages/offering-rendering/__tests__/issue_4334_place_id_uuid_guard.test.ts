// #4334 follow-up — a Mingla UUID can never become `query_place_id`.
//
// #4347 found producers that fall back to `google_place_id ?? place_id`; a
// Mingla row id is a UUID. normalizeGooglePlaceId refuses UUID-shaped strings
// and keeps real Google ids (ChIJ… place ids and the long Ej…/Gh… ids, up to
// 1024 characters). Byte-level: the exact URL each builder emits.
//
// Fails on revert: drop the UUID refusal → U-1/U-2 red; drop the 1024 cap → U-4 red.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMapsAppLink,
  buildMapsDeepLink,
  normalizeGooglePlaceId,
} from "../mapsDeepLink.ts";

const UUID = "0b6f7a1e-3314-4c1a-9d2e-5f0a3314b001";
const CHIJ = "ChIJS9Q72lL0OxARKJ3cGrQfM0c";
const EJ = "EjBBa2luIEFkZXNvbGEgU3RyZWV0LCBWaWN0b3JpYSBJc2xhbmQsIExhZ29zLCBOaWdlcmlhIi4qLAoUChIJ";
const GH = "GhIJQWDl0CK1REAR9PJfSQ0XAkA";
const PIN = { lat: 6.4478093, lng: 3.4723495 };
const BASE = "https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495";

Deno.test("U-1 a UUID (any case) is refused", () => {
  assertEquals(normalizeGooglePlaceId(UUID), null);
  assertEquals(normalizeGooglePlaceId(UUID.toUpperCase()), null);
  assertEquals(normalizeGooglePlaceId(`  ${UUID}  `), null);
});

Deno.test("U-2 a UUID never reaches the link people tap: byte-identical to the no-id link", () => {
  assertEquals(buildMapsDeepLink({ geo: PIN, label: "Didi Museum", googlePlaceId: UUID, platform: "web" })?.url, BASE);
  assertEquals(buildMapsAppLink({ app: "google", geo: PIN, label: "Didi Museum", googlePlaceId: UUID, platform: "ios" })?.url, BASE);
});

Deno.test("U-3 real Google ids still anchor the link (ChIJ, Ej, Gh)", () => {
  for (const id of [CHIJ, EJ, GH]) {
    assertEquals(normalizeGooglePlaceId(id), id);
    assertEquals(
      buildMapsDeepLink({ geo: PIN, label: "Didi Museum", googlePlaceId: id, platform: "web" })?.url,
      `${BASE}&query_place_id=${id}`,
    );
  }
});

Deno.test("U-4 length: 1024 characters pass, 1025 and under 10 are refused; retired ids stay refused", () => {
  const long = "Ej" + "A".repeat(1022);
  assertEquals(normalizeGooglePlaceId(long), long);
  assertEquals(normalizeGooglePlaceId(long + "A"), null);
  assertEquals(normalizeGooglePlaceId("ChIJshort"), null);
  assertEquals(normalizeGooglePlaceId("dXJuOm1ieHBvaTpkaWRp"), null);
});
