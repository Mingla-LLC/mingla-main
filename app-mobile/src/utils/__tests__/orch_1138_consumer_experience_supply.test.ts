// @ts-nocheck
// ORCH-1138 Leg 3 REWORK (§9) — consumer experience SUPPLY regression test
// (implementor-owned, happy-path). Deno-runnable (venueExperienceMapping.ts has
// NO RN deps — it's the pure venue-seed mapper).
//
// FAILS-ON-REVERT ANCHOR: consumer experience parity died in the prior pass
// because the seed mappers NARROWED the experience card — dropping the per-stop
// gallery (imageUrls), per-stop coords (lat/lng), the START HERE/THEN/END WITH
// stopLabel, the curated vibes (experienceIntents), the city, and the upcoming
// occurrences. These fields are mockup-LOAD-BEARING (vibe chips, count-aware
// galleries, "Where you'll start" map, real Reserve slots). This test asserts
// the venue-seed mapper (experienceToBusinessEventCard, §4.C.4) carries ALL of
// them for a rich fixture row. Delete the §4.C.4 population block → this FAILS.
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { experienceToBusinessEventCard } from "../venueExperienceMapping.ts";

const richRow = {
  experience_id: "evt-1138",
  brand_id: "brand-1138",
  brand_slug: "mingla-qa-experiences",
  brand_name: "Mingla QA Experiences",
  experience_slug: "qa-crawl",
  title: "QA · Raleigh Twilight Tasting Crawl",
  description: "A four-stop evening crawl.",
  cover_media_url: "https://x/cover.jpg",
  cover_media_type: "image",
  theme: { experience_meta: { venue_text: "Raleigh, NC" } },
  venue_text: "Raleigh, NC",
  next_occurrence_at: "2026-06-20T21:00:00Z",
  price_from_cents: 0,
  currency: "USD",
  is_free: true,
  experience_intents: ["adventurous", "first-date"],
  stops: [
    {
      stop_order: 0,
      place_id: "qa-stop-1",
      place_name: "The Cork Room",
      address: "14 E Martin St, Raleigh, NC",
      city: "Raleigh",
      image_urls: ["https://x/1a.jpg", "https://x/1b.jpg", "https://x/1c.jpg"],
      ai_description: "Start with natural wines.",
      lat: 35.778,
      lng: -78.6389,
      start_time: "17:00:00",
      price_cents: 0,
    },
    {
      stop_order: 1,
      place_id: "qa-stop-2",
      place_name: "Foundation Bar",
      address: "213 Fayetteville St, Raleigh, NC",
      city: "Raleigh",
      image_urls: ["https://x/2a.jpg"],
      ai_description: "Cocktail den.",
      lat: 35.7768,
      lng: -78.6386,
      start_time: null,
      price_cents: 0,
    },
    {
      stop_order: 2,
      place_id: "qa-stop-3",
      place_name: "Lucettegrace",
      address: "235 S Salisbury St, Raleigh, NC",
      city: "Raleigh",
      image_urls: ["https://x/3a.jpg", "https://x/3b.jpg"],
      ai_description: "Dessert finale.",
      lat: 35.7758,
      lng: -78.6402,
      start_time: null,
      price_cents: 0,
    },
  ],
  upcoming_occurrences: [
    {
      event_date_id: "ed-1",
      start_at: "2026-06-20T21:00:00Z",
      end_at: "2026-06-21T03:00:00Z",
      capacity: 12,
      sold: 3,
      remaining: 9,
    },
    {
      event_date_id: "ed-2",
      start_at: "2026-06-21T21:00:00Z",
      end_at: "2026-06-22T03:00:00Z",
      capacity: 12,
      sold: 0,
      remaining: 12,
    },
  ],
  published_at: "2026-06-16T00:00:00Z",
};

Deno.test("ORCH-1138 §9: venue seed mapper carries vibes + per-stop galleries/coords/labels + occurrences + city", () => {
  const card = experienceToBusinessEventCard(richRow as never);

  // vibe chips supply (experienceIntents)
  assertEquals(card.experienceIntents, ["adventurous", "first-date"]);

  // per-stop full galleries + coords + label + start time (the dropped fields)
  assert(Array.isArray(card.experienceStops), "experienceStops present");
  assertEquals(card.experienceStops.length, 3);
  const s0 = card.experienceStops[0];
  assertEquals(s0.imageUrls, ["https://x/1a.jpg", "https://x/1b.jpg", "https://x/1c.jpg"]);
  assertEquals(s0.lat, 35.778);
  assertEquals(s0.lng, -78.6389);
  assertEquals(s0.startTime, "17:00:00");
  assertEquals(s0.stopLabel, "Start Here");
  assertEquals(card.experienceStops[1].stopLabel, "Then");
  assertEquals(card.experienceStops[2].stopLabel, "End With");

  // City,Country chip supply (first stop city)
  assertEquals(card.city, "Raleigh");

  // real Reserve slots (upcoming occurrences) carried through
  assert(Array.isArray(card.upcomingOccurrences), "occurrences present");
  assertEquals(card.upcomingOccurrences.length, 2);
  assertEquals(card.upcomingOccurrences[0].eventDateId, "ed-1");
  assertEquals(card.upcomingOccurrences[0].remaining, 9);
  assertEquals(card.upcomingOccurrences[0].capacity, 12);

  // map supply: stop-1 coords flow to locationGeo
  assert(card.locationGeo !== null, "locationGeo present for the map");
  assertEquals(card.locationGeo.lat, 35.778);

  // no GBP introduced (I-7)
  assertEquals(card.currency, "USD");
});

Deno.test("ORCH-1138 §9: empty/absent stops & intents → fields omitted (rule 9, no fabrication)", () => {
  const bareRow = {
    ...richRow,
    experience_intents: null,
    stops: null,
    upcoming_occurrences: null,
  };
  const card = experienceToBusinessEventCard(bareRow as never);
  assertEquals(card.experienceIntents, undefined);
  assertEquals(card.experienceStops, undefined);
  assertEquals(card.upcomingOccurrences, undefined);
  // city falls back to venue text honestly (never fabricated)
  assertEquals(card.city, "Raleigh, NC");
});
