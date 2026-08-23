// @ts-nocheck — Deno-runtime suite (deno.land import); the app-mobile tsc
// sweep has no Deno types (house convention, mirrors
// publicEventSeedService.orch1342.test.ts).
//
// issue #2469 [explorer-venue-name-duplicated] — IMPLEMENTOR happy-path
// regression.
//
// `events.location_text` is the COMBINED "<venueName>  · <address>" string.
// Two explorer mappers assigned that whole string to the card's `address` while
// separately rendering `venueName`, so the explorer printed the venue name
// twice AND fed the doubled string to the maps deep link — which is why #2468
// reproduced most reliably on the explorer.
//
// Run:
//   deno test --no-check --allow-read \
//     app-mobile/src/services/__tests__/issue_2469_explorer_parsed_location.test.ts
//
// WHAT IS PROVED
//   E-1  the parsed halves win, and the venue name appears EXACTLY once.
//   E-2  no combined string is ever returned in BOTH halves (the defect).
//   E-3  the cold-route seed mapper carries a non-null venueName, so the
//        "Where you'll be" card is no longer suppressed.
//   E-4  the label the maps deep link receives is un-doubled.
//   E-5  fallbacks stay HONEST — a missing half is null, never invented.
//
// FAILS-ON-REVERT (verified by true LINE DELETION, recorded in the report):
//   restore `address: row.location_text` / `venueName: null` in
//   publicEventSeedService → E-2/E-3/E-4 fail; drop the `location.address`
//   read in extractPublicEventLocation → E-1 fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  extractPublicEventLocation,
  mapPublicEventSeedRow,
} from "../publicEventSeedService.ts";
import { selectVenueMapsTarget } from "../../../../packages/offering-rendering/mapsDeepLink.ts";

// Production truth for `we-go-again-exhibition` (business_public_events_view).
const COMBINED =
  "Didi Museum  · Akin Adesola Street 175, Lagos 10, Lagos, Nigeria";
const PARSED_THEME = {
  business_event: {
    location: {
      venueName: "Didi Museum ",
      address: "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria",
    },
  },
};

const SEED_ROW = {
  id: "3014ea7e-f3e0-40d0-b112-a51f4e37e964",
  brand_id: "br-1",
  brand_slug: "we-go-again",
  brand_name: "We Go Again",
  brand_profile_photo_url: null,
  slug: "we-go-again-exhibition",
  title: "We Go Again Exhibition",
  description: null,
  event_type: "event",
  cover_media_url: null,
  cover_media_type: null,
  timezone: "Africa/Lagos",
  master_start_at: "2026-09-01T18:00:00Z",
  master_end_at: null,
  master_timezone: "Africa/Lagos",
  city: "Lagos",
  location_text: COMBINED,
  is_online: false,
  public_theme: PARSED_THEME,
  theme_color_override: null,
  theme_font_override: null,
  theme_animation_override: null,
  currency: "NGN",
  pricing_currency: "NGN",
  display_price_cents: null,
  party_types: [],
  vibe_tags: [],
  music_genres: [],
  location_geo: "(3.423375,6.43273)",
  brand_theme_color: null,
  brand_theme_font: null,
  brand_theme_animation: null,
};

Deno.test("#2469 E-1: the PARSED halves win; the venue name appears exactly once", () => {
  const parts = extractPublicEventLocation(PARSED_THEME, COMBINED);
  assertEquals(parts.venueName, "Didi Museum");
  assertEquals(
    parts.address,
    "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria",
  );
  // The name is NOT smuggled back in via the address line.
  assert(
    !(parts.address ?? "").includes("Didi Museum"),
    `address still carries the venue name: ${parts.address}`,
  );
});

Deno.test("#2469 E-2: the COMBINED string is never returned in both halves", () => {
  const cases: Array<[unknown, string | null]> = [
    [PARSED_THEME, COMBINED],
    [{ business_event: { location: { venueName: "Didi Museum " } } }, COMBINED],
    [{ business_event: { location: { address: "175 Akin Adesola" } } }, COMBINED],
    [{}, COMBINED],
    [null, COMBINED],
    [{ business_event: {} }, COMBINED],
  ];
  for (const [theme, text] of cases) {
    const { venueName, address } = extractPublicEventLocation(theme, text);
    // THE INVARIANT: the two halves are never the same non-null string, and the
    // combined string never lands on `address` while `venueName` is non-null.
    assert(
      !(venueName !== null && address !== null && venueName === address),
      `duplicated: ${JSON.stringify({ theme, venueName, address })}`,
    );
    assert(
      !(venueName !== null && address === COMBINED),
      `combined string on address beside a venueName: ${
        JSON.stringify({ theme, venueName, address })
      }`,
    );
  }
});

Deno.test("#2469 E-3: the cold-route seed no longer suppresses the location card", () => {
  const card = mapPublicEventSeedRow(SEED_ROW);
  assert(card !== null);
  // Was hard-coded `venueName: null`, and every shared renderer gates the
  // "Where you'll be" section on `venueName !== null` — so the card did not
  // render at all until the canonical read landed.
  assertEquals(card.venueName, "Didi Museum");
  assertEquals(
    card.address,
    "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria",
  );
  assertEquals(card.address === COMBINED, false);
  // The pin the deep link needs survived the mapper unchanged.
  assertEquals(card.locationGeo, { lng: 3.423375, lat: 6.43273 });
});

Deno.test("#2469 E-4: the label handed to the maps deep link is UN-doubled", () => {
  const card = mapPublicEventSeedRow(SEED_ROW);
  assert(card !== null);
  const target = selectVenueMapsTarget({
    venueName: card.venueName,
    address: card.address,
    addressHidden: false,
    locationGeo: card.locationGeo,
  });
  assert(target !== null);
  assertEquals(
    target.label,
    "Didi Museum, Akin Adesola Street 175, Lagos 10, Lagos, Nigeria",
  );
  // The explorer's old label was
  // "Didi Museum, Didi Museum  · Akin Adesola Street 175, Lagos 10, Lagos,
  // Nigeria" — Apple resolved that to 10 Adela Street, London W10 5BA.
  const nameCount = target.label.split("Didi Museum").length - 1;
  assertEquals(nameCount, 1, `venue name appears ${nameCount}x in the label`);
  assertEquals(target.geo, { lng: 3.423375, lat: 6.43273 });
});

Deno.test("#2469 E-5: fallbacks stay honest — a missing half is null, never invented", () => {
  // No parsed object at all: the combined string is the only honest value and
  // it goes to venueName ALONE (address null), so the card still renders and
  // nothing is printed twice.
  assertEquals(extractPublicEventLocation(undefined, COMBINED), {
    venueName: COMBINED,
    address: null,
  });
  // Nothing at all in, nothing invented out.
  assertEquals(extractPublicEventLocation(null, null), {
    venueName: null,
    address: null,
  });
  assertEquals(extractPublicEventLocation({}, "   "), {
    venueName: null,
    address: null,
  });
  // A parsed venueName with no address does NOT get the combined string
  // appended back on.
  assertEquals(
    extractPublicEventLocation(
      { business_event: { location: { venueName: "Didi Museum " } } },
      COMBINED,
    ),
    { venueName: "Didi Museum", address: null },
  );
});
