// META-ORCH-1009 Sub-E (C4) — BEHAVIORAL test for the business authoring
// pipeline. Unlike stage_contract.test.ts (which greps the source for
// substrings), this test IMPORTS the real pipeline helpers + the shared bouncer
// and exercises their behaviour: the written ai_signal_scores shape (Stage 6),
// the deterministic Google cross-validation diff (Stage 7 / D2), the B9-B12
// coaching map (C5), and the bouncer servability gate (Stage 8) that decides
// whether a business-authored row becomes deck-eligible.
//
// fails-on-revert anchors:
//   - buildAiSignalScores throwing `gemini_missing_signal` on an unevaluated
//     signal would regress if the writer stopped enforcing per-signal coverage.
//   - coachingForReasons returning the generic fallback for B9-B12 is the exact
//     pre-rework-5 bug this test pins.
//   - buildCrossValidation omitting business_authored_inputs_hash on create-new
//     or business_claim_diff on claim-existing is the pre-rework-5 D2 gap.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  buildAiSignalScores,
  businessGateReasons,
  buildCrossValidation,
  coachingForReasons,
  extractInternalLinks,
  galleryUrls,
  placeForBouncer,
  priceLevelFromTiers,
  priceTiersFromTier2,
  storedPhotosForDeck,
} from "../index.ts";
import { bounce } from "../../_shared/bouncer.ts";

// ── Stage 6: ai_signal_scores 6-key shape, v4, gemini-2.5-flash ──────────────
Deno.test("buildAiSignalScores emits the exact 6-key Q2 shape with v4 + gemini-2.5-flash", () => {
  const signals = [
    { id: "date_night", label: "Date night" },
    { id: "groups", label: "Groups" },
  ];
  const evaluations = [
    { signal_id: "date_night", score_0_to_100: 82, inappropriate_for: false, reasoning: "Intimate lighting." },
    { signal_id: "groups", score_0_to_100: 40, inappropriate_for: false, reasoning: "Limited large tables." },
  ];
  const at = "2026-05-31T00:00:00.000Z";
  const out = buildAiSignalScores(signals, evaluations, at);

  assertEquals(Object.keys(out).sort(), ["date_night", "groups"]);
  for (const key of Object.keys(out)) {
    const entry = out[key];
    assertEquals(Object.keys(entry).sort(), [
      "evaluated_at",
      "inappropriate_for",
      "model",
      "prompt_version",
      "reasoning",
      "score_0_to_100",
    ]);
    assertEquals(entry.prompt_version, "v4");
    assertEquals(entry.model, "gemini-2.5-flash");
    assertEquals(entry.evaluated_at, at);
    assert(entry.score_0_to_100 >= 0 && entry.score_0_to_100 <= 100);
  }
  assertEquals(out.date_night.score_0_to_100, 82);
  assertEquals(out.groups.inappropriate_for, false);
});

Deno.test("buildAiSignalScores throws gemini_missing_signal when a signal was not evaluated", () => {
  const signals = [
    { id: "date_night", label: "Date night" },
    { id: "groups", label: "Groups" },
  ];
  const evaluations = [
    { signal_id: "date_night", score_0_to_100: 82, inappropriate_for: false, reasoning: "x" },
    // groups intentionally missing
  ];
  assertThrows(
    () => buildAiSignalScores(signals, evaluations, "2026-05-31T00:00:00.000Z"),
    Error,
    "gemini_missing_signal:groups",
  );
});

// ── C5: B9-B12 plain-English coaching + one-tap fix ─────────────────────────
Deno.test("coachingForReasons maps B9-B12 to specific copy + request_review fix (not the generic fallback)", () => {
  const cards = coachingForReasons([
    "B9:child_venue:walmart_counter",
    "B10:fast_food_type:fast_food_restaurant",
    "B11:chain_brand:starbucks",
    "B12:casual_chain:applebees",
  ]);
  assertEquals(cards.length, 4);
  assertEquals(cards[0].code, "B9");
  assertEquals(cards[0].fix, "request_review");
  assert(cards[0].title.toLowerCase().includes("sub-location"));
  assertEquals(cards[1].code, "B10");
  assertEquals(cards[1].fix, "request_review");
  assert(cards[1].body.toLowerCase().includes("fast-food"));
  assertEquals(cards[2].code, "B11");
  assert(cards[2].body.toLowerCase().includes("chain"));
  assertEquals(cards[3].code, "B12");
  assert(cards[3].title.toLowerCase().includes("casual chain"));
  // Crucially: NONE of B9-B12 fall through to the generic review_pipeline card.
  for (const c of cards) {
    assert(c.fix !== "review_pipeline", `${c.code} fell through to the generic fallback`);
  }
});

Deno.test("coachingForReasons still maps the original B3/B5/B6/B8 set", () => {
  const cards = coachingForReasons(["B3:missing_required_field", "B6:no_hours", "B8:no_stored_photos"]);
  assertEquals(cards.map((c) => c.code), ["B3", "B6", "B8"]);
  assertEquals(cards[0].fix, "edit_address");
  assertEquals(cards[1].fix, "edit_hours");
  assertEquals(cards[2].fix, "edit_cover");
});

// ── Stage 7 / D2: deterministic Google cross-validation ─────────────────────
Deno.test("buildCrossValidation create-new path stamps business_authored source + inputs hash (no Google-verified claim)", async () => {
  const place = { google_place_id: null, raw_google_data: { source: "business_authored" } };
  const tier1 = { name: "The Lantern Room", address: "12 Vine St", lat: 1, lng: 2 };
  const tier2 = { website: "https://lanternroom.example" };
  const out = await buildCrossValidation(place, tier1, tier2);
  assertEquals(out.stage_status, "create_new_no_google");
  assertEquals(out.conflicts.length, 0);
  const raw = out.raw_google_data as Record<string, unknown>;
  assertEquals(raw.source, "business_authored");
  assertEquals(raw.not_google_reviewed, true);
  assert(typeof raw.business_authored_inputs_hash === "string" && (raw.business_authored_inputs_hash as string).length === 64);
  // Never claim Google-verified on create-new.
  assert(!("business_claim_diff" in raw));
});

Deno.test("buildCrossValidation claim-existing path records a deterministic diff + archives Google values", async () => {
  const place = {
    google_place_id: "ChIJabc123",
    name: "Old Google Name",
    address: "100 Old Rd",
    website: "https://old.example",
    raw_google_data: {},
  };
  const tier1 = { name: "New Operator Name", address: "100 Old Rd" }; // name differs, address same
  const tier2 = { website: "https://old.example" }; // website same
  const out = await buildCrossValidation(place, tier1, tier2);
  assertEquals(out.stage_status, "claim_diff_recorded");
  assertEquals(out.conflicts, ["name"]); // only name diverged
  const raw = out.raw_google_data as Record<string, unknown>;
  const diff = raw.business_claim_diff as Record<string, unknown>;
  assertEquals(diff.google_place_id, "ChIJabc123");
  const archived = diff.archived_google as Record<string, unknown>;
  assertEquals(archived.name, "Old Google Name"); // Google value archived, not lost
  const diffRows = diff.diff as Array<Record<string, unknown>>;
  assertEquals(diffRows.length, 1);
  assertEquals(diffRows[0].field, "name");
  assertEquals(diffRows[0].business_value, "New Operator Name");
  assertEquals(diffRows[0].google_value, "Old Google Name");
});

// ── Stage 8: bouncer servability gate decides deck eligibility ──────────────
Deno.test("bounce gate: a complete business-authored venue passes; a fast-food chain name is rejected (B11)", () => {
  const goodVenue = {
    id: "p1",
    name: "The Lantern Room",
    lat: 38.9,
    lng: -77.0,
    types: ["restaurant", "food", "point_of_interest"],
    business_status: "OPERATIONAL",
    website: "https://lanternroom.example",
    opening_hours: { monday: "17:00-23:00" },
    photos: [{ ref: "x" }],
    stored_photo_urls: ["https://cdn.example/1.jpg"],
    review_count: null,
    rating: null,
  };
  const goodVerdict = bounce(goodVenue);
  assertEquals(goodVerdict.is_servable, true);
  assertEquals(goodVerdict.reasons.length, 0);

  // Same shape but a fast-food chain name -> B11 short-circuit reject.
  const chain = { ...goodVenue, name: "Starbucks" };
  const chainVerdict = bounce(chain);
  assertEquals(chainVerdict.is_servable, false);
  assert(chainVerdict.reasons.some((r) => r.startsWith("B11")), "expected B11 chain rejection");
});

Deno.test("WS6 price: tiers map to the highest Google level; deck-photo mirror keeps hero + gallery", () => {
  // Only valid Mingla tiers survive; price_level is the HIGHEST selected.
  assertEquals(priceTiersFromTier2({ price_tiers: ["comfy", "bougie", "bogus"] }), ["comfy", "bougie"]);
  assertEquals(priceLevelFromTiers(["chill"]), "PRICE_LEVEL_INEXPENSIVE");
  assertEquals(priceLevelFromTiers(["comfy", "lavish", "chill"]), "PRICE_LEVEL_VERY_EXPENSIVE");
  assertEquals(priceLevelFromTiers([]), null);

  // stored_photo_urls = hero (existing, not in gallery) + gallery, deduped.
  const place = { stored_photo_urls: ["https://cdn/hero.jpg"] };
  const gallery = ["https://cdn/g1.jpg", "https://cdn/g2.jpg"];
  assertEquals(storedPhotosForDeck(place, gallery), [
    "https://cdn/hero.jpg",
    "https://cdn/g1.jpg",
    "https://cdn/g2.jpg",
  ]);
  // If the existing set already contains gallery items, hero is still picked
  // (first existing not in gallery) and no dupes leak.
  const place2 = { stored_photo_urls: ["https://cdn/hero.jpg", "https://cdn/g1.jpg"] };
  assertEquals(storedPhotosForDeck(place2, gallery), [
    "https://cdn/hero.jpg",
    "https://cdn/g1.jpg",
    "https://cdn/g2.jpg",
  ]);
});

Deno.test("WS6 website scan: extractInternalLinks keeps same-origin About/Menu links only", () => {
  const html = `
    <a href="/about-us">About</a>
    <a href="/menu">Menu</a>
    <a href="https://evil.com/menu">offsite menu</a>
    <a href="mailto:x@y.com">email</a>
    <a href="/careers">Careers (no hint)</a>
    <a href="https://lumen.example/visit#top">Visit</a>
  `;
  const links = extractInternalLinks(html, "https://lumen.example/");
  // Same-origin + hint-matching only; offsite + mailto + non-hint dropped; #frag
  // stripped. Count is bounded by WEBSITE_MAX_PAGES, so assert membership/exclusion
  // rather than an exact set.
  assert(links.length > 0, "at least one hint link kept");
  assert(links.includes("https://lumen.example/about-us"), "about kept (first hint)");
  assert(links.every((l) => l.startsWith("https://lumen.example/")), "same-origin only");
  assert(links.every((l) => !l.includes("#")), "fragments stripped");
  assert(!links.some((l) => l.includes("evil.com")), "offsite dropped");
  assert(!links.some((l) => l.includes("mailto")), "mailto dropped");
  assert(!links.some((l) => l.includes("careers")), "non-hint dropped");
});

Deno.test("businessGateReasons: requires a 5-photo gallery before go-live", () => {
  // Fewer than 5 gallery photos -> GALLERY_MIN blocker + coaching to add photos.
  const few = { business_gallery_urls: ["https://cdn/1.jpg", "https://cdn/2.jpg"] };
  assertEquals(galleryUrls(few).length, 2);
  const reasons = businessGateReasons(few);
  assertEquals(reasons.length, 1);
  assert(reasons[0].startsWith("GALLERY_MIN"), `got ${reasons[0]}`);
  const card = coachingForReasons(reasons)[0];
  assertEquals(card.code, "GALLERY_MIN");
  assert(card.title.toLowerCase().includes("photo"));

  // Exactly 5 -> no blocker.
  const five = {
    business_gallery_urls: [
      "https://cdn/1.jpg",
      "https://cdn/2.jpg",
      "https://cdn/3.jpg",
      "https://cdn/4.jpg",
      "https://cdn/5.jpg",
    ],
  };
  assertEquals(businessGateReasons(five).length, 0);

  // Non-string / empty entries are ignored by galleryUrls.
  const dirty = { business_gallery_urls: ["https://cdn/1.jpg", "", null, 7] };
  assertEquals(galleryUrls(dirty).length, 1);
});

Deno.test("placeForBouncer: an operator-uploaded hero satisfies the photo gate for a business-authored venue (no Google photos)", () => {
  const businessAuthored = {
    id: "p3",
    name: "Lumen Wine Bar",
    lat: 39.59,
    lng: -76.99,
    types: ["bar", "restaurant", "point_of_interest"],
    business_status: "OPERATIONAL",
    website: "https://lumenwine.example",
    opening_hours: { friday: "17:00-23:00" },
    // Not on Google → no Google photo metadata, only the operator's uploaded hero.
    photos: null,
    stored_photo_urls: ["https://cdn.example/hero.jpg"],
    fetched_via: "business_authored",
    review_count: null,
    rating: null,
  };
  const mapped = placeForBouncer("p3", businessAuthored, { website: "https://lumenwine.example" });
  // The operator photo is mapped into the Google-photo slot so B7 can clear.
  const verdict = bounce(mapped);
  assertEquals(verdict.is_servable, true, `unexpected reasons: ${verdict.reasons.join(",")}`);

  // Without any uploaded photo, the business-authored venue is still blocked (B7/B8).
  const noPhotos = placeForBouncer("p3", { ...businessAuthored, stored_photo_urls: null });
  const blocked = bounce(noPhotos);
  assertEquals(blocked.is_servable, false);

  // A NON-business-authored (real Google) row with no Google photos is NOT given
  // the operator-photo bypass — it must still have Google photos (B7 fires).
  const googleRow = placeForBouncer("p4", {
    ...businessAuthored,
    fetched_via: "google_places",
    photos: null,
    stored_photo_urls: ["https://cdn.example/hero.jpg"],
  });
  const googleVerdict = bounce(googleRow);
  assert(
    googleVerdict.reasons.some((r) => r.startsWith("B7")),
    "expected B7 to still fire for a non-business-authored row lacking Google photos",
  );
});

Deno.test("bounce gate: a business-authored row with no photos + no hours surfaces fixable reasons (not a hard chain reject)", () => {
  const incomplete = {
    id: "p2",
    name: "Quiet Corner Cafe",
    lat: 38.9,
    lng: -77.0,
    types: ["restaurant", "food", "point_of_interest"],
    business_status: "OPERATIONAL",
    website: null,
    opening_hours: null,
    photos: null,
    stored_photo_urls: null,
    review_count: null,
    rating: null,
  };
  const verdict = bounce(incomplete);
  assertEquals(verdict.is_servable, false);
  // These are the self-serve-fixable B-codes the Hub coaching loop can address.
  const codes = verdict.reasons.map((r) => r.split(":")[0]);
  assert(codes.includes("B4") || codes.includes("B5"), "expected a website reason");
  assert(codes.includes("B6"), "expected a hours reason");
  // The coaching map must produce non-generic cards for at least the website/hours reasons.
  const cards = coachingForReasons(verdict.reasons);
  assert(cards.some((c) => c.fix === "edit_hours"), "expected an edit_hours coaching card");
});
