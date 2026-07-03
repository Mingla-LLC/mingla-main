// ORCH-1263 [claim-adoption] Leg C — T-C1 / T-C2 for _shared/authoredApply.ts.
// Invariant: I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE (the approve-
// time application is the ONLY road authored content takes to the live place)
// + the first-archive-wins Google-original archive (inventory §3.2 gap).
//
// MUST FAIL when the D-A change is reverted:
//   * drop a patch key (hours/photos/summary/price/facets/website/ownership)
//     → T-C1's key assertions fail;
//   * archive overwriting an existing archived_google key (losing the Google
//     original) → T-C1's first-archive-wins re-approve assertion fails;
//   * blanking generative_summary when nothing was authored → T-C2 fails.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  type BrandHoursDbRow,
  buildAuthoredApplyPatch,
  FACET_COLUMNS,
  priceLevelFromTiers,
  priceTiersFromTier2,
} from "../authoredApply.ts";

const OWNER = "7a000000-0000-4000-8000-000000000009";

const FULL_HOURS: BrandHoursDbRow[] = [
  { weekday: 0, open_time: "09:00:00", close_time: "17:00:00", is_closed: false },
  { weekday: 1, open_time: "09:00:00", close_time: "17:00:00", is_closed: false },
  { weekday: 2, open_time: null, close_time: null, is_closed: true },
  { weekday: 3, open_time: "09:00:00", close_time: "17:00:00", is_closed: false },
  // Overnight day (D-D): 22:00 → 02:00 must emit close.day = +1.
  { weekday: 4, open_time: "22:00:00", close_time: "02:00:00", is_closed: false },
  { weekday: 5, open_time: "10:00:00", close_time: "23:00:00", is_closed: false },
  { weekday: 6, open_time: null, close_time: null, is_closed: true },
];

function fullPlace(): Record<string, unknown> {
  return {
    id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0",
    google_place_id: "gp-lantern",
    opening_hours: { periods: [{ open: { day: 5, hour: 8, minute: 0 } }] },
    stored_photo_urls: ["https://cdn/google1.jpg", "https://cdn/google2.jpg"],
    generative_summary: "Google-era summary.",
    price_tiers: ["chill"],
    price_level: "PRICE_LEVEL_INEXPENSIVE",
    website: "https://old-google.example",
    serves_dinner: null,
    outdoor_seating: false,
    business_gallery_urls: ["https://cdn/g1.jpg", "https://cdn/g2.jpg"],
    business_authoring_inputs: {
      tier1: { description: "Operator pitch long enough to stand in." },
      tier2: { website: "https://lantern.example", price_tiers: ["comfy", "lavish", "bogus"] },
      confirmed_ai_outputs: {
        sales_bio: "A moody wine bar with candlelit corners and a long natural list.",
        facets: { serves_dinner: true, outdoor_seating: null, bogus_column: true },
      },
    },
    raw_google_data: {
      source_notes: "keep me",
      business_claim_diff: {
        google_place_id: "gp-lantern",
        // The tier-2 archive already holds these three — first archive wins.
        archived_google: {
          name: "Google Name",
          address: "Google Addr",
          website: "https://old-google.example",
        },
      },
    },
  };
}

Deno.test("T-C1: full authored patch — every key present, pre-values archived, first-archive-wins on re-approve", () => {
  const place = fullPlace();
  const patch = buildAuthoredApplyPatch({
    place,
    venue: { cover_media_url: "https://cdn/cover.jpg", cover_media_type: "image" },
    brandHours: FULL_HOURS,
    ownerUserId: OWNER,
  });

  // Hours: authored brand_hours → canonical Google shape, overnight day rolls.
  const hours = patch.opening_hours as {
    periods: Array<{ open: { day: number }; close: { day: number; hour: number } }>;
  };
  assertEquals(hours.periods.length, 5); // 2 closed days contribute no period
  const overnight = hours.periods.find((p) => p.open.day !== p.close.day);
  assert(overnight !== undefined, "overnight period must roll close.day (+1)");
  assertEquals(overnight.close.hour, 2);

  // Photos: cover + authored gallery, deduped — the authored truth.
  assertEquals(patch.stored_photo_urls, [
    "https://cdn/cover.jpg",
    "https://cdn/g1.jpg",
    "https://cdn/g2.jpg",
  ]);

  // Summary: confirmed sales_bio wins over the pitch.
  assertEquals(
    patch.generative_summary,
    "A moody wine bar with candlelit corners and a long natural list.",
  );

  // Price: tier2 tiers filtered to the vocabulary, level = highest tier.
  assertEquals(patch.price_tiers, ["comfy", "lavish"]);
  assertEquals(patch.price_level, "PRICE_LEVEL_VERY_EXPENSIVE");
  assertEquals(priceLevelFromTiers(priceTiersFromTier2({ price_tiers: ["comfy"] })), "PRICE_LEVEL_MODERATE");

  // Facets: confirmed ∩ FACET_COLUMNS only — the bogus column is dropped.
  assertEquals(patch.serves_dinner, true);
  assertEquals(patch.outdoor_seating, null);
  assert(!("bogus_column" in patch));
  assert(FACET_COLUMNS.has("serves_dinner"));

  // Website + ownership land at approve.
  assertEquals(patch.website, "https://lantern.example");
  assertEquals(patch.is_claimed, true);
  assertEquals(patch.claimed_by, OWNER);

  // Archive: pre-application values recorded; EXISTING archived keys untouched.
  const raw = patch.raw_google_data as Record<string, unknown>;
  assertEquals(raw.source_notes, "keep me"); // merge is non-destructive
  const diff = (raw.business_claim_diff as Record<string, unknown>);
  const archived = diff.archived_google as Record<string, unknown>;
  assertEquals(archived.website, "https://old-google.example", "first archive wins for website");
  assertEquals(archived.name, "Google Name");
  assertEquals(archived.generative_summary, "Google-era summary.");
  assertEquals(archived.stored_photo_urls, ["https://cdn/google1.jpg", "https://cdn/google2.jpg"]);
  assertEquals(archived.price_tiers, ["chill"]);
  assertEquals(archived.price_level, "PRICE_LEVEL_INEXPENSIVE");
  assert("opening_hours" in archived, "pre-application hours archived");
  assert("serves_dinner" in archived && archived.serves_dinner === null);

  // Re-approve (idempotent): place now carries the applied values + archive.
  const reapprovedPlace = {
    ...place,
    ...patch,
  };
  const patch2 = buildAuthoredApplyPatch({
    place: reapprovedPlace as Record<string, unknown>,
    venue: { cover_media_url: "https://cdn/cover.jpg", cover_media_type: "image" },
    brandHours: FULL_HOURS,
    ownerUserId: OWNER,
  });
  // No new keys to archive → raw_google_data omitted entirely; the FIRST
  // archive (holding the Google originals) is never touched again.
  assert(!("raw_google_data" in patch2), "re-approve must not rewrite the archive");
  assertEquals(patch2.stored_photo_urls, patch.stored_photo_urls);
});

Deno.test("T-C2: partial authored state — pitch stands in for the summary; price/facets/website omitted; hours/photos/ownership present", () => {
  const place: Record<string, unknown> = {
    id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0",
    google_place_id: "gp-quiet",
    opening_hours: null,
    stored_photo_urls: [],
    generative_summary: null,
    website: "https://keep-me.example",
    business_gallery_urls: [],
    business_authoring_inputs: {
      tier1: { description: "The operator c5 pitch, at least twenty chars." },
      // no tier2, no confirmed_ai_outputs (admin may approve pre-confirm)
    },
    raw_google_data: {},
  };
  const patch = buildAuthoredApplyPatch({
    place,
    venue: { cover_media_url: "https://cdn/cover.jpg", cover_media_type: "image" },
    brandHours: FULL_HOURS.slice(0, 2),
    ownerUserId: OWNER,
  });

  assertEquals(patch.generative_summary, "The operator c5 pitch, at least twenty chars.");
  assert("opening_hours" in patch);
  assertEquals(patch.stored_photo_urls, ["https://cdn/cover.jpg"]);
  assertEquals(patch.is_claimed, true);
  assertEquals(patch.claimed_by, OWNER);
  for (const absent of ["price_tiers", "price_level", "website", "serves_dinner"]) {
    assert(!(absent in patch), `${absent} must be omitted when un-authored`);
  }

  // Nothing authored at all (zero hours, no cover/gallery, no summary source):
  // the patch never blanks live values — only ownership + (maybe) archive.
  const bare = buildAuthoredApplyPatch({
    place: { ...place, business_authoring_inputs: {} },
    venue: { cover_media_url: null, cover_media_type: null },
    brandHours: [],
    ownerUserId: OWNER,
  });
  assert(!("opening_hours" in bare));
  assert(!("stored_photo_urls" in bare));
  assert(!("generative_summary" in bare), "never blank a live summary");
  assertEquals(bare.is_claimed, true);
  assertEquals(bare.claimed_by, OWNER);
});
