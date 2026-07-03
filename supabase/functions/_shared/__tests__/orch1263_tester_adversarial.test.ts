/**
 * ORCH-1263 [claim-adoption] — TESTER adversarial suite (server pure layer).
 *
 * APPEND-ONLY new file (mingla-tester owned). DIFFERENT angles than the
 * implementor's T-E1/T-C1/T-A4 happy paths:
 *
 *  D1 — POLLUTED adoption-detail row: a row carrying every forbidden column
 *       (rating/review_count/ai_signal_scores/reviews/raw_google_data/
 *       is_servable/bouncer_reason/photo_analysis) can NEVER leak into the
 *       response — deep key scan over the whole serialized payload
 *       (I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED).
 *  D2 — polluted SEARCH row: no rating VALUE key anywhere; junk claim_state
 *       strings normalize to "available" only for unknown values, exact-match
 *       "pending"/"claimed" respected; assertNoForbiddenKeys bites.
 *  D3 — REPEATED hero picks (the dispatch's superset-under-repeated-picks
 *       angle): pick A → pick B → pick C → clear, invariants hold at EVERY
 *       step: result ⊇ gallery, hero-first, no dupes, never `[hero]` while a
 *       gallery exists, clear never wipes a non-empty prior
 *       (I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO).
 *  D4 — FIRST-ARCHIVE-WINS under a double approve with CHANGED authored
 *       content: the second patch must preserve the ORIGINAL archived Google
 *       values byte-for-byte, and a no-new-keys re-approve omits
 *       raw_google_data entirely.
 *  D5 — buildAuthoredApplyPatch omission rules under hostile inputs (junk
 *       tiers, non-canonical facets, whitespace website, 19-char pitch):
 *       never blank a live value, never write an unknown facet column.
 *
 * FAILS-ON-REVERT: reverting nextStoredPhotosForHero to the pre-1263
 * `[mediaUrl]` wipe → D3 fails; deleting the `!(key in existingArchive)`
 * first-archive-wins guard in authoredApply.ts → D4 fails. (Receipts in the
 * QA report.)
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  assertNoForbiddenKeys,
  rowToAdoptionDetail,
  rowToPoolMatch,
  type PoolAdoptionDetailRow,
  type PoolMatchRow,
} from "../poolMatchResponse.ts";
import { buildAuthoredApplyPatch, FACET_COLUMNS } from "../authoredApply.ts";
import { nextStoredPhotosForHero } from "../../run-business-place-authoring-pipeline/index.ts";

// ─── The forbidden set (superset of FORBIDDEN_RESPONSE_KEYS + dispatch list) ─
const FORBIDDEN = [
  "rating",
  "review_count",
  "ai_signal_scores",
  "reviews",
  "raw_google_data",
  "is_servable",
  "bouncer_reason",
  "photo_analysis",
  "photo_aesthetic_data",
  "ai_categories",
  "seeding_category",
  "ai_reason",
  "ai_primary_identity",
  "ai_confidence",
  "ai_web_evidence",
];

/** Recursively collect every object key in a payload. */
function deepKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const item of v) deepKeys(item, out);
  } else if (v !== null && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      deepKeys(val, out);
    }
  }
  return out;
}

// ─── D1 — polluted detail row cannot leak ───────────────────────────────────
Deno.test("D1: adoption detail built from a row polluted with the FULL forbidden set leaks nothing", () => {
  const polluted = {
    id: "e1263aaa-0000-4000-8000-000000000001",
    name: "Polluted Bar",
    address: "1 Leak St",
    city: "Raleigh",
    country: "US",
    lat: 35.78,
    lng: -78.64,
    google_place_id: "gp-polluted",
    primary_type: "wine_bar",
    types: ["bar"],
    opening_hours: { periods: [] },
    stored_photo_urls: [
      "https://cdn/1.jpg",
      "ftp://evil/2.jpg", // non-http(s) must be filtered
      "https://cdn/3.jpg",
    ],
    national_phone_number: "(919) 555-0101",
    website: "https://polluted.example",
    price_tiers: ["comfy"],
    price_level: "PRICE_LEVEL_MODERATE",
    generative_summary: "A bar.",
    editorial_summary: null,
    reservable: true,
    serves_cocktails: true,
    // ── hostile extras a widened RPC could someday return ──
    rating: 4.9,
    review_count: 9001,
    ai_signal_scores: { date_spot: 99 },
    reviews: [{ text: "leak me" }],
    raw_google_data: { secret: true },
    is_servable: true,
    bouncer_reason: "leaky",
    photo_analysis: { x: 1 },
    photo_aesthetic_data: { y: 2 },
    ai_confidence: 0.99,
  } as unknown as PoolAdoptionDetailRow;

  const detail = rowToAdoptionDetail(polluted);
  const keys = deepKeys(detail);
  for (const banned of FORBIDDEN) {
    assert(!keys.has(banned), `forbidden key leaked into detail: ${banned}`);
  }
  // Facets fold ONLY canonical FACET_COLUMNS ids.
  for (const k of Object.keys(detail.facets)) {
    assert(FACET_COLUMNS.has(k), `non-canonical facet leaked: ${k}`);
  }
  // Non-http(s) URL filtered; the rest intact, uncapped.
  assertEquals(detail.photoUrls, ["https://cdn/1.jpg", "https://cdn/3.jpg"]);
  // No rating VALUE anywhere in the serialized payload.
  const json = JSON.stringify(detail);
  assert(!json.includes("4.9"), "rating value leaked in serialization");
  assert(!json.includes("9001"), "review_count value leaked in serialization");
});

// ─── D2 — polluted search row + claim_state normalization ──────────────────
Deno.test("D2: polluted search row exposes booleans only; claim_state exact-match semantics", () => {
  const base: PoolMatchRow = {
    id: "e1263bbb-0000-4000-8000-000000000002",
    name: "Polluted Search",
    address: null,
    city: null,
    country: null,
    lat: 1,
    lng: 2,
    google_place_id: null,
    primary_type: "bar",
    types: ["bar"],
    opening_hours: null,
    stored_photo_urls: ["https://cdn/1.jpg"],
    has_hours: true,
    has_phone: false,
    has_website: false,
    has_rating: true,
    photo_count: 12,
    claim_state: "pending",
  };
  const withJunk = {
    ...base,
    rating: 4.2,
    review_count: 777,
    is_servable: true,
  } as unknown as PoolMatchRow;

  const result = rowToPoolMatch(withJunk);
  const keys = deepKeys(result);
  for (const banned of FORBIDDEN) {
    assert(!keys.has(banned), `forbidden key leaked into search row: ${banned}`);
  }
  assertEquals(result.hasRating, true); // presence boolean is the ceiling
  assertEquals(result.claimState, "pending");

  // Exact-match-only claim_state; junk/case variants → "available" (the 23505
  // submit backstop still guards the race — old-fn tolerance, spec §B1).
  for (const junk of ["Claimed", "PENDING", "verified", "", "junk", null, undefined]) {
    const r = rowToPoolMatch({ ...base, claim_state: junk as string | null });
    assertEquals(r.claimState, "available", `junk claim_state ${String(junk)}`);
  }
  assertEquals(rowToPoolMatch({ ...base, claim_state: "claimed" }).claimState, "claimed");

  // Negative photo_count sanitized to 0.
  assertEquals(rowToPoolMatch({ ...base, photo_count: -3 }).photoCount, 0);

  // The guard itself bites.
  assertThrows(
    () => assertNoForbiddenKeys({ rating: 4.2 }),
    Error,
    "forbidden_field_leaked:rating",
  );
});

// ─── D3 — repeated hero picks: superset law at every step ──────────────────
Deno.test("D3: hero re-picks across an evolving prior never shrink below the gallery", () => {
  const gallery = ["https://cdn/g1.jpg", "https://cdn/g2.jpg", "https://cdn/g3.jpg"];
  const heroes = [
    "https://cdn/heroA.jpg",
    "https://cdn/heroB.jpg",
    "https://cdn/g2.jpg", // hero that is ALSO a gallery member
    "https://cdn/heroC.jpg",
  ];
  let prior = [...gallery]; // approved place starts with its gallery served

  for (const hero of heroes) {
    const next = nextStoredPhotosForHero(prior, gallery, hero);
    // superset of gallery
    for (const g of gallery) {
      assert(next.includes(g), `gallery member dropped after picking ${hero}: ${g}`);
    }
    // hero first
    assertEquals(next[0], hero);
    // no dupes
    assertEquals(new Set(next).size, next.length);
    // never the bare [hero] wipe while a gallery exists
    assert(next.length >= gallery.length, "hero pick shrank below gallery size");
    prior = next; // the write lands; next pick sees it as prior
  }

  // Clearing the hero after all that never empties a non-empty set.
  const cleared = nextStoredPhotosForHero(prior, gallery, null);
  assert(cleared.length >= gallery.length);
  for (const g of gallery) assert(cleared.includes(g));

  // Degenerate: no gallery, prior holds only the old hero → prior kept.
  assertEquals(
    nextStoredPhotosForHero(["https://cdn/only-hero.jpg"], [], null),
    ["https://cdn/only-hero.jpg"],
  );
  // All empty is the ONLY way to get [].
  assertEquals(nextStoredPhotosForHero([], [], null), []);
});

// ─── D4 — first-archive-wins across a double approve ───────────────────────
Deno.test("D4: re-approve with CHANGED authored content preserves the ORIGINAL archive", () => {
  const googleOriginal = {
    opening_hours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }] },
    stored_photo_urls: ["https://google/g1.jpg"],
    generative_summary: "Google's own summary of the venue.",
  };
  const place0: Record<string, unknown> = {
    ...googleOriginal,
    business_gallery_urls: ["https://cdn/auth1.jpg"],
    business_authoring_inputs: {
      tier1: { description: "First authored pitch, at least twenty chars." },
      tier2: { website: "https://v1.example", price_tiers: ["comfy"] },
    },
    raw_google_data: { some_google_blob: true },
  };
  const venue = { cover_media_url: "https://cdn/cover1.jpg", cover_media_type: "image" };
  const brandHours = [
    { weekday: 5, open_time: "22:00:00", close_time: "02:00:00", is_closed: false },
  ];

  const patch1 = buildAuthoredApplyPatch({
    place: place0,
    venue,
    brandHours,
    ownerUserId: "owner-1",
  });
  const raw1 = patch1.raw_google_data as Record<string, unknown>;
  const archive1 = (raw1.business_claim_diff as Record<string, unknown>)
    .archived_google as Record<string, unknown>;
  // Archive holds the PRE-application (Google) values.
  assertEquals(archive1.generative_summary, googleOriginal.generative_summary);
  assertEquals(archive1.stored_photo_urls, googleOriginal.stored_photo_urls);
  assertEquals(archive1.opening_hours, googleOriginal.opening_hours);
  assert(!("is_claimed" in archive1) && !("claimed_by" in archive1));
  // Keys the place never had archive as null (website was absent).
  assertEquals(archive1.website, null);
  // The pre-existing raw_google_data blob is preserved, not clobbered.
  assertEquals(raw1.some_google_blob, true);

  // ── APPLY patch1, then the operator re-authors EVERYTHING and re-approves ──
  const place1: Record<string, unknown> = {
    ...place0,
    ...patch1,
    business_authoring_inputs: {
      tier1: { description: "Second authored pitch — different, still long." },
      tier2: { website: "https://v2.example", price_tiers: ["lavish"] },
    },
    business_gallery_urls: ["https://cdn/auth2.jpg"],
  };
  const patch2 = buildAuthoredApplyPatch({
    place: place1,
    venue: { cover_media_url: "https://cdn/cover2.jpg", cover_media_type: "image" },
    brandHours,
    ownerUserId: "owner-1",
  });
  const raw2 = patch2.raw_google_data as Record<string, unknown> | undefined;
  if (raw2 !== undefined) {
    const archive2 = (raw2.business_claim_diff as Record<string, unknown>)
      .archived_google as Record<string, unknown>;
    // FIRST ARCHIVE WINS: the original Google values survive byte-for-byte —
    // the round-2 patch must NOT re-archive the round-1 authored values.
    assertEquals(archive2.generative_summary, googleOriginal.generative_summary);
    assertEquals(archive2.stored_photo_urls, googleOriginal.stored_photo_urls);
    assertEquals(archive2.opening_hours, googleOriginal.opening_hours);
    assertEquals(archive2.website, null);
  }

  // ── Idempotent re-approve with NOTHING new to archive omits raw_google_data ──
  const place2: Record<string, unknown> = { ...place1, ...patch2 };
  const patch3 = buildAuthoredApplyPatch({
    place: place2,
    venue: { cover_media_url: "https://cdn/cover2.jpg", cover_media_type: "image" },
    brandHours,
    ownerUserId: "owner-1",
  });
  assert(
    !("raw_google_data" in patch3),
    "no-new-keys re-approve must omit raw_google_data (archive stays byte-identical)",
  );
});

// ─── D5 — hostile inputs: omission over blanking, canonical facets only ────
Deno.test("D5: authored patch never blanks and never writes non-canonical facet columns", () => {
  const place: Record<string, unknown> = {
    generative_summary: "Live summary that must survive.",
    business_authoring_inputs: {
      tier1: { description: "nineteen chars long.".slice(0, 19) }, // < 20 → omit
      tier2: {
        website: "   ", // whitespace only → omit
        price_tiers: ["not_a_tier", 42, null, "LAVISH"], // all junk → omit
      },
      confirmed_ai_outputs: {
        facets: {
          serves_cocktails: true,
          drop_table_places: true, // non-canonical → dropped
          good_for_groups: "yes", // non-boolean → dropped
          outdoor_seating: null, // null is allowed (explicit unknown)
        },
      },
    },
    business_gallery_urls: [],
  };
  const patch = buildAuthoredApplyPatch({
    place,
    venue: { cover_media_url: null, cover_media_type: null },
    brandHours: [],
    ownerUserId: "owner-9",
  });

  assert(!("opening_hours" in patch), "no brand hours → no opening_hours key");
  assert(!("stored_photo_urls" in patch), "no cover+gallery → no stored_photo_urls key");
  assert(!("generative_summary" in patch), "19-char pitch must not overwrite a live summary");
  assert(!("price_tiers" in patch) && !("price_level" in patch), "junk tiers must be omitted");
  assert(!("website" in patch), "whitespace website must be omitted");
  assert(!("drop_table_places" in patch), "non-canonical facet column written");
  assert(!("good_for_groups" in patch), "non-boolean facet value written");
  assertEquals(patch.serves_cocktails, true);
  assertEquals(patch.outdoor_seating, null);
  // Ownership still lands at approve.
  assertEquals(patch.is_claimed, true);
  assertEquals(patch.claimed_by, "owner-9");
  // Archive covers exactly the overwritten keys (the 2 facets).
  const raw = patch.raw_google_data as Record<string, unknown>;
  const archive = (raw.business_claim_diff as Record<string, unknown>)
    .archived_google as Record<string, unknown>;
  assertEquals(
    Object.keys(archive).sort(),
    ["outdoor_seating", "serves_cocktails"],
  );
});
