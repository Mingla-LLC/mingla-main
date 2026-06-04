/**
 * ORCH-1066 — regression test for <DeckCardPreview> honest-data rules (SC-5/15/16).
 * Run: node --test src/lib/__tests__/deckCardPreviewRules.test.js
 *
 * fails-on-revert: if the rating rule stops hiding null/≤0 ratings, or the hero
 * rule stops treating '__backfill_failed__'/empty as no-photo, these flip.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  priceLabel,
  showRating,
  hasRealHero,
} from "../deckCardPreviewRules.js";

describe("showRating (SC-16 — hide null/≤0 rating, exact native rule)", () => {
  it("hides a null rating", () => assert.equal(showRating(null), false));
  it("hides a zero rating", () => assert.equal(showRating(0), false));
  it("hides a negative rating", () => assert.equal(showRating(-1), false));
  it("hides a non-number rating", () => assert.equal(showRating("4.5"), false));
  it("shows a positive rating", () => assert.equal(showRating(4.2), true));
});

describe("hasRealHero (SC-5 — honest no-photo placeholder, never faked)", () => {
  it("no photos → no real hero", () => assert.equal(hasRealHero(null), false));
  it("empty array → no real hero", () => assert.equal(hasRealHero([]), false));
  it("backfill sentinel → no real hero", () =>
    assert.equal(hasRealHero(["__backfill_failed__"]), false));
  it("empty string → no real hero", () => assert.equal(hasRealHero([""]), false));
  it("a real url → real hero", () =>
    assert.equal(hasRealHero(["https://cdn/p.jpg"]), true));
});

describe("priceLabel (real data only; null → hidden)", () => {
  it("null place → null", () => assert.equal(priceLabel(null), null));
  it("no price data → null", () => assert.equal(priceLabel({}), null));
  it("price_level enum → glyphs", () =>
    assert.equal(priceLabel({ price_level: "PRICE_LEVEL_MODERATE" }), "$$"));
  it("very expensive → $$$$", () =>
    assert.equal(priceLabel({ price_level: "PRICE_LEVEL_VERY_EXPENSIVE" }), "$$$$"));
  it("price_tiers array → glyph count (capped at 4)", () => {
    assert.equal(priceLabel({ price_tiers: [{}, {}] }), "$$");
    assert.equal(priceLabel({ price_tiers: [{}, {}, {}, {}, {}, {}] }), "$$$$");
  });
  it("unknown price_level → null (not faked)", () =>
    assert.equal(priceLabel({ price_level: "PRICE_LEVEL_BOGUS" }), null));
});
