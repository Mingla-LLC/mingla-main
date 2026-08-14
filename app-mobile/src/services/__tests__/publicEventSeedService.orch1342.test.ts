// @ts-nocheck — Deno-runtime suite (deno.land import); the app-mobile tsc
// sweep has no Deno types (house convention).
//
// ORCH-1342 [web-see-whos-going-funnel] — D6 cold-route seed mapper regression
// (SPEC §4.7 / §7 T-8). The mapper is PURE (the supabase client is lazily
// imported inside the fetch — oneLinkShare precedent), so the row→card
// contract runs headless under Deno; the read-path constraints (anon view
// only, explicit columns, maybeSingle) are source-asserted.
//
// Run:
//   deno test --no-check --allow-read app-mobile/src/services/__tests__/publicEventSeedService.orch1342.test.ts
//
// FAILS-ON-REVERT: deleting the mapper's field rows fails the exact-shape
// assertions; repointing the read at `.from('brands')` or dropping
// business_public_events_view fails the source asserts.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { mapPublicEventSeedRow } from "../publicEventSeedService.ts";

const BASE_ROW = {
  id: "ev-1",
  brand_id: "br-1",
  brand_slug: "sunset-collective",
  brand_name: "Sunset Collective",
  brand_profile_photo_url: "https://cdn/x.jpg",
  slug: "rooftop night",
  title: "Rooftop Night",
  description: "A night up top.",
  event_type: "rsvp",
  cover_media_url: "https://cdn/cover.mp4",
  cover_media_type: "video",
  timezone: "Europe/London",
  master_start_at: "2026-08-01T19:00:00Z",
  master_end_at: "2026-08-02T01:00:00Z",
  master_timezone: "Europe/London",
  city: "London",
  location_text: "12 High St, London",
  is_online: false,
  public_theme: {
    business_event: { format: "in_person", hideAddressUntilTicket: false },
  },
  theme_color_override: "#112233",
  theme_font_override: "grotesk",
  theme_animation_override: null,
  currency: "GBP",
  pricing_currency: "GBP",
  display_price_cents: 2500,
  party_types: ["party"],
  vibe_tags: ["rooftop"],
  music_genres: ["house"],
  location_geo: "(-0.1276,51.5072)",
  brand_theme_color: "#ff6b35",
  brand_theme_font: "serif",
  brand_theme_animation: "confetti",
};

Deno.test("ORCH-1342 T-8: RSVP row maps the §4.7 field table exactly", () => {
  const card = mapPublicEventSeedRow(BASE_ROW);
  assertEquals(card, {
    eventId: "ev-1",
    brandId: "br-1",
    brandSlug: "sunset-collective",
    brandName: "Sunset Collective",
    brandProfilePhotoUrl: "https://cdn/x.jpg",
    eventSlug: "rooftop night",
    title: "Rooftop Night",
    description: "A night up top.",
    coverMediaUrl: "https://cdn/cover.mp4",
    coverMediaType: "video",
    // [TEST-MOD-APPROVED #868] cover-gallery [cover-gallery] adds an additive
    // `coverGallery` to the §4.7 seed map; gallery-less rows map to [] (rule 9).
    coverGallery: [],
    coverHue: 0,
    masterDateUtc: "2026-08-01T19:00:00Z",
    masterEndAtUtc: "2026-08-02T01:00:00Z",
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: "Europe/London",
    venueName: null,
    city: "London",
    address: "12 High St, London",
    hideAddressUntilTicket: false,
    format: "in-person",
    locationGeo: { lat: 51.5072, lng: -0.1276 },
    partyTypes: ["party"],
    vibeTags: ["rooftop"],
    musicGenres: ["house"],
    priceMin: null,
    priceMax: null,
    displayPriceCents: 2500,
    displayCurrency: "GBP",
    currency: "GBP",
    // slugs are encodeURIComponent-encoded (never raw-concat).
    publicBuyerUrl:
      "https://host.usemingla.com/e/sunset-collective/rooftop%20night",
    eventType: "rsvp",
    brandTheme: {
      color: "#ff6b35",
      font: "serif",
      animation: "confetti",
      color_override: "#112233",
      font_override: "grotesk",
      animation_override: null,
    },
  });
});

Deno.test("ORCH-1342 T-8: standard event row maps with eventType 'event'", () => {
  const card = mapPublicEventSeedRow({ ...BASE_ROW, event_type: "event" });
  assert(card !== null);
  assertEquals(card.eventType, "event");
});

Deno.test("ORCH-1342 T-8: trip/experience rows → null (they own /t|/exp)", () => {
  assertEquals(mapPublicEventSeedRow({ ...BASE_ROW, event_type: "trip" }), null);
  assertEquals(
    mapPublicEventSeedRow({ ...BASE_ROW, event_type: "experience" }),
    null,
  );
  assertEquals(mapPublicEventSeedRow({ ...BASE_ROW, event_type: null }), null);
});

Deno.test("ORCH-1342 T-8: theme-derived fields mirror the authoritative parses", () => {
  // format: theme absent → is_online fallback (both directions).
  const online = mapPublicEventSeedRow({
    ...BASE_ROW,
    public_theme: null,
    is_online: true,
  });
  assertEquals(online?.format, "online");
  const inPerson = mapPublicEventSeedRow({
    ...BASE_ROW,
    public_theme: {},
    is_online: false,
  });
  assertEquals(inPerson?.format, "in-person");
  // theme 'hybrid' wins over is_online.
  const hybrid = mapPublicEventSeedRow({
    ...BASE_ROW,
    public_theme: { business_event: { format: "hybrid" } },
    is_online: true,
  });
  assertEquals(hybrid?.format, "hybrid");
  // hideAddressUntilTicket FAIL-CLOSED: absent theme value → true (the 1157
  // address-privacy posture — mirrors publicEventsService:1034 AND the deck
  // seed producer; never leak a street the host may have hidden).
  assertEquals(inPerson?.hideAddressUntilTicket, true);
  // Explicit theme false → false (host chose to show the street).
  assertEquals(mapPublicEventSeedRow(BASE_ROW)?.hideAddressUntilTicket, false);
});

Deno.test("ORCH-1342 T-8: geo parse mirrors publicEventsService (string, {x,y}, malformed)", () => {
  assertEquals(
    mapPublicEventSeedRow({ ...BASE_ROW, location_geo: { x: 3.4, y: 6.5 } })
      ?.locationGeo,
    { lng: 3.4, lat: 6.5 },
  );
  assertEquals(
    mapPublicEventSeedRow({ ...BASE_ROW, location_geo: "garbage" })?.locationGeo,
    null,
  );
  assertEquals(
    mapPublicEventSeedRow({ ...BASE_ROW, location_geo: null })?.locationGeo,
    null,
  );
});

Deno.test("ORCH-1342 T-8: Constitution #9 — missing fields are null/empty, never invented", () => {
  const card = mapPublicEventSeedRow({
    ...BASE_ROW,
    brand_name: null,
    title: null,
    description: null,
    cover_media_url: null,
    cover_media_type: "weird",
    master_start_at: null,
    master_end_at: null,
    master_timezone: null,
    timezone: null,
    city: null,
    location_text: null,
    party_types: null,
    vibe_tags: null,
    music_genres: null,
    display_price_cents: null,
    pricing_currency: null,
    currency: null,
  });
  assert(card !== null);
  assertEquals(card.coverMediaType, null);
  assertEquals(card.masterDateUtc, null);
  assertEquals(card.timezone, "UTC");
  assertEquals(card.venueName, null);
  assertEquals(card.doorsOpenLocal, null);
  assertEquals(card.endsAtLocal, null);
  assertEquals(card.partyTypes, []);
  assertEquals(card.priceMin, null);
  assertEquals(card.displayCurrency, null);
  assertEquals(card.currency, "USD");
  assertEquals(card.coverHue, 0);
});

// ── Source asserts (read-path constraints) ───────────────────────────────────
const src = await Deno.readTextFile(
  new URL("../publicEventSeedService.ts", import.meta.url),
);
// Comment-strip before the ban checks (the file's own protective comments
// QUOTE the banned literal — house strict-grep convention).
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("ORCH-1342 T-8: read path is the anon view ONLY (COMMS-0009)", () => {
  assertStringIncludes(code, '.from("business_public_events_view")');
  assert(!code.includes(".from('brands')") && !code.includes('.from("brands")'));
});

Deno.test("ORCH-1342 T-8: explicit column select + maybeSingle + slug filters", () => {
  assertStringIncludes(src, "PUBLIC_EVENT_SEED_COLUMNS");
  assertStringIncludes(src, '.eq("brand_slug", brandSlug)');
  assertStringIncludes(src, '.eq("slug", eventSlug)');
  assertStringIncludes(src, ".maybeSingle()");
  // errors THROW (React Query owns retry) — never a silent null-on-failure.
  assertStringIncludes(src, "throw new Error(error.message)");
});
