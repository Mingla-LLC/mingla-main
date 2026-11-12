// #4389 — the Google normalizer adds line1 and postalCode (additive, nullable)
// for the Tap to Pay on iPhone address screen.
// FAILS-ON-REVERT: dropping streetLineOf from googlePlaceToDetails fails test 1.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { googlePlaceToDetails } from "../googleNormalize.ts";

const comp = (types: string[], longText: string, shortText = longText) => ({ types, longText, shortText });

Deno.test("#4389 1 — a street address gives line1 and postalCode", () => {
  const d = googlePlaceToDetails({
    id: "p1",
    formattedAddress: "1520 N Milwaukee Ave, Chicago, IL 60622, USA",
    location: { latitude: 41.9, longitude: -87.67 },
    types: ["street_address"],
    addressComponents: [
      comp(["street_number"], "1520"),
      comp(["route"], "North Milwaukee Avenue", "N Milwaukee Ave"),
      comp(["locality", "political"], "Chicago"),
      comp(["administrative_area_level_1", "political"], "Illinois", "IL"),
      comp(["country", "political"], "United States", "US"),
      comp(["postal_code"], "60622"),
    ],
  } as never, "fallback");
  assertEquals((d as { line1: string }).line1, "1520 N Milwaukee Ave");
  assertEquals((d as { postalCode: string }).postalCode, "60622");
});

Deno.test("#4389 2 — no street: line1 is null (the screen asks for the part)", () => {
  const d = googlePlaceToDetails({
    id: "p2",
    formattedAddress: "London, UK",
    location: { latitude: 51.5, longitude: -0.12 },
    types: ["locality"],
    addressComponents: [comp(["locality", "political"], "London"), comp(["country", "political"], "United Kingdom", "GB")],
  } as never, "fallback");
  assertEquals((d as { line1: unknown }).line1, null);
  assertEquals((d as { postalCode: unknown }).postalCode, null);
});
