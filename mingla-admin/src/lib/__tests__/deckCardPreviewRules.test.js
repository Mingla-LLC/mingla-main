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
  it("legacy Google ordinals are not interpreted as dollars", () =>
    assert.equal(priceLabel({ price_level: "PRICE_LEVEL_MODERATE" }), null));
  it("formats an NGN source range from minor units", () =>
    assert.equal(priceLabel({
      source_min_minor: 125000,
      source_max_minor: 250000,
      source_currency_code: "NGN",
      source_minor_unit_exponent: 2,
    }), "NGN 1,250.00–NGN 2,500.00"));
  it("says Free only for an explicit zero-to-zero range", () =>
    assert.equal(priceLabel({
      source_min_minor: 0,
      source_max_minor: 0,
      source_currency_code: "USD",
    }), "Free"));
});
