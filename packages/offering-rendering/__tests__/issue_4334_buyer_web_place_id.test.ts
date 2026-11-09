// #4334 A-1 — buyer-web Maps links use the event's Google place id
// (`pg_public_event_by_slug.googlePlaceId`) when present, coordinates otherwise.
//
// B-1 byte-level: the exact web link bytes with and without an id.
// B-2 both renderers that own the venue Maps control (PublicEventPage and
//     EventOfferingBody) hand `event.googlePlaceId` to selectVenueMapsTarget.
// B-3 a hidden street yields no link, even when an id is over-supplied.
//
// Fails-on-revert:
//   B-2 drop `googlePlaceId: event.googlePlaceId` from either renderer → red.
//   B-1 drop query_place_id in mapsDeepLink.ts                          → red.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMapsDeepLink, selectVenueMapsTarget } from "../mapsDeepLink.ts";

const GEO = { lat: 6.4325387, lng: 3.4236889 };
const ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";
const event = (googlePlaceId: string | null, hidden = false) => ({
  venueName: "Didi Museum",
  address: "175 Akin Adesola St",
  addressHidden: hidden,
  locationGeo: GEO,
  googlePlaceId,
});

Deno.test("B-1 web link bytes: query_place_id when the event has an id, coordinates only otherwise", () => {
  const withId = buildMapsDeepLink({ ...selectVenueMapsTarget(event(ID))!, platform: "web" });
  assertEquals(
    withId?.url,
    "https://www.google.com/maps/search/?api=1&query=6.4325387,3.4236889&query_place_id=ChIJ0Wq9hS_1OxARsFOw5qkW6Y0",
  );
  const without = buildMapsDeepLink({ ...selectVenueMapsTarget(event(null))!, platform: "web" });
  assertEquals(without?.url, "https://www.google.com/maps/search/?api=1&query=6.4325387,3.4236889");
});

Deno.test("B-2 both venue Maps owners pass the event's googlePlaceId", async () => {
  for (const file of ["../PublicEventPage.tsx", "../EventOfferingBody.tsx"]) {
    const src = await Deno.readTextFile(new URL(file, import.meta.url));
    const call = src.slice(src.indexOf("selectVenueMapsTarget({"), src.indexOf("});", src.indexOf("selectVenueMapsTarget({")));
    assertEquals(call.includes("googlePlaceId: event.googlePlaceId"), true, `${file} does not pass googlePlaceId`);
  }
});

Deno.test("B-3 a hidden street gives no link, even with an id over-supplied", () => {
  assertEquals(selectVenueMapsTarget(event(ID, true)), null);
});
