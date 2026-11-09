// #4334 — deep links and copy text (matrix R-NAV-1, R-NAV-2, R-NAV-4, R-NAV-5,
// R-COPY-1). Deno-runnable: mapsDeepLink.ts imports nothing.
//
// R-NAV-1 / R-COPY-1: every link and copy text for 12 production-shaped targets
// is BYTE-IDENTICAL to the pre-#4334 builder when no Google place id is held
// (fixtures/issue_4334_deep_links_before.json, generated from origin/main).
// R-NAV-2: with a Google id, ONLY the Google links gain `&query_place_id=`;
// `query` stays exactly the coordinate pair (#2553 G-2). Apple and Android
// `geo:` links are unchanged.
// R-NAV-5: a past offering whose Google coordinates expired: Google →
// label + query_place_id; Apple/Android → today's text forms.
// R-NAV-4: a hidden address yields no target, so no id and no link.
//
// Fails-on-revert:
//   N-2 drop googlePlaceSearchUrl (no query_place_id)          → red
//   N-3 put the label into `query` with the id                 → red
//   N-4 drop the addressHidden-first return                    → red
//   N-6 drop normalizeGooglePlaceId's dXJuOm guard             → red

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMapsAppLink,
  buildMapsDeepLink,
  listMapsAppChoices,
  normalizeGooglePlaceId,
  selectAddressCopyText,
  selectVenueMapsTarget,
} from "../mapsDeepLink.ts";

const before = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/issue_4334_deep_links_before.json", import.meta.url)),
) as { rows: Array<{ target: Record<string, unknown>; copy: string | null; links: Record<string, unknown> }> };

Deno.test("N-1 R-NAV-1 / R-COPY-1: no place id → byte-identical to the pre-#4334 builder", () => {
  assertEquals(before.rows.length, 12);
  for (const row of before.rows) {
    const target = selectVenueMapsTarget({ addressHidden: false, ...row.target } as Parameters<typeof selectVenueMapsTarget>[0]);
    assertEquals(selectAddressCopyText(target), row.copy);
    for (const platform of ["ios", "android", "web"]) {
      const now = {
        default: target ? buildMapsDeepLink({ ...target, platform }) : null,
        choices: target ? listMapsAppChoices({ ...target, platform }) : [],
      };
      assertEquals(JSON.stringify(now), JSON.stringify(row.links[platform]), `${row.target.venueName} ${platform}`);
    }
  }
});

const DIDI = { lat: 6.4325387, lng: 3.4236889 };
const ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";
const target = selectVenueMapsTarget({
  venueName: "Didi Museum",
  address: "175 Akin Adesola St, Victoria Island, Lagos 106104, Lagos, Nigeria",
  addressHidden: false,
  locationGeo: DIDI,
  googlePlaceId: ID,
})!;
const pair = `${DIDI.lat},${DIDI.lng}`;

Deno.test("N-2 R-NAV-2: Google links carry query_place_id; Apple and Android do not change", () => {
  const google = `https://www.google.com/maps/search/?api=1&query=${pair}&query_place_id=${ID}`;
  assertEquals(buildMapsDeepLink({ ...target, platform: "web" })?.url, google);
  assertEquals(buildMapsAppLink({ ...target, platform: "ios", app: "google" })?.url, google);
  assertEquals(buildMapsAppLink({ ...target, platform: "web", app: "google" })?.url, google);
  // unchanged forms
  assertEquals(buildMapsDeepLink({ ...target, platform: "ios" })?.url, `maps://?ll=${pair}&q=${encodeURIComponent(target.label!)}`);
  assert(buildMapsDeepLink({ ...target, platform: "android" })!.url.startsWith(`geo:${pair}?q=${pair}(`));
  assertEquals(buildMapsAppLink({ ...target, platform: "android", app: "google" })?.url,
    buildMapsDeepLink({ ...target, platform: "android" })?.url);
  assert(!buildMapsAppLink({ ...target, platform: "ios", app: "apple" })!.url.includes("query_place_id"));
  assert(!buildMapsAppLink({ ...target, platform: "web", app: "apple" })!.url.includes("query_place_id"));
});

Deno.test("N-3 #2553 G-2 kept: `query` is exactly the coordinate pair when the id is present", () => {
  const url = new URL(buildMapsDeepLink({ ...target, platform: "web" })!.url);
  assertEquals(url.searchParams.get("query"), pair);
  assertEquals(url.searchParams.get("query_place_id"), ID);
});

Deno.test("N-4 R-NAV-4: a hidden address yields no target — no id, no link, no copy", () => {
  const hidden = selectVenueMapsTarget({
    venueName: "Didi Museum", address: "x", addressHidden: true, locationGeo: DIDI, googlePlaceId: ID,
  });
  assertEquals(hidden, null);
  assertEquals(selectAddressCopyText(hidden), null);
});

Deno.test("N-5 R-NAV-5: expired past offering — Google anchors on the id with the label; Apple/Android text", () => {
  const expired = selectVenueMapsTarget({
    venueName: "Didi Museum", address: "175 Akin Adesola St", addressHidden: false, locationGeo: null, googlePlaceId: ID,
  })!;
  const label = encodeURIComponent("Didi Museum, 175 Akin Adesola St");
  assertEquals(buildMapsDeepLink({ ...expired, platform: "web" })?.url,
    `https://www.google.com/maps/search/?api=1&query=${label}&query_place_id=${ID}`);
  assertEquals(buildMapsAppLink({ ...expired, platform: "ios", app: "google" })?.url,
    `https://www.google.com/maps/search/?api=1&query=${label}&query_place_id=${ID}`);
  assertEquals(buildMapsAppLink({ ...expired, platform: "ios", app: "apple" })?.url, `maps://?q=${label}`);
  assertEquals(buildMapsDeepLink({ ...expired, platform: "android" })?.url, `geo:0,0?q=${label}`);
  assertEquals(selectAddressCopyText(expired), "Didi Museum, 175 Akin Adesola St");
});

Deno.test("N-6 only real Google ids are used: retired and malformed ids are dropped", () => {
  assertEquals(normalizeGooglePlaceId("dXJuOm1ieHBvaTpkaWRp"), null);
  assertEquals(normalizeGooglePlaceId("short"), null);
  assertEquals(normalizeGooglePlaceId(" ChIJ0Wq9hS_1OxAR "), "ChIJ0Wq9hS_1OxAR");
  const retired = selectVenueMapsTarget({
    venueName: "Didi Museum", address: null, addressHidden: false, locationGeo: DIDI, googlePlaceId: "dXJuOm1ieHBvaTpkaWRp",
  })!;
  assert(!buildMapsDeepLink({ ...retired, platform: "web" })!.url.includes("query_place_id"));
});
