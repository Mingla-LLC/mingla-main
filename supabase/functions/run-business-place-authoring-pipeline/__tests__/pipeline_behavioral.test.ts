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
  buildCrossValidation,
  coachingForReasons,
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
