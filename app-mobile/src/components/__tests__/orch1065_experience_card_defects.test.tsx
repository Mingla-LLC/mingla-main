import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — live-fire defect regressions.
//
// On-device live-fire of a real seeded experience (event_id
// 7e8673db-7289-45ea-bb89-3dc007def13d, total_price_cents=4500 USD, 3 stops,
// stops carry NO per-stop price) surfaced three defects in the experience deck
// card. These tests lock the fixes. Like the rest of the ORCH-1065 component
// suite, the card carries heavy native deps, so we read source-as-text and
// assert the corrected seams structurally (the proven app-mobile pattern).
//
// BUG-1 price "Free" instead of "$45": the card distrusted the envelope total
//   (correct for curated, whose per-stop prices ARE truth) and summed stop
//   prices — but an experience's price lives ONLY in the envelope total, so the
//   sum was 0 → "Free". Fix reads card.totalPriceMin/Max for the experience
//   variant via the currency-aware formatCurrency helper.
// BUG-2 rating "0.0": experience stops carry rating 0 (no Google rating) → the
//   chip showed a meaningless "0.0". Fix hides the rating chip for experiences.
// BUG-3 require cycle SwipeableCards <-> CuratedExperienceSwipeCard: the card
//   imported leaf hero constants back from SwipeableCards. Fix moves them to a
//   dependency-free ./deckHeroConstants module.

const card = await Deno.readTextFile(
  new URL("../CuratedExperienceSwipeCard.tsx", import.meta.url),
);
const swipeable = await Deno.readTextFile(
  new URL("../SwipeableCards.tsx", import.meta.url),
);
const heroConstants = await Deno.readTextFile(
  new URL("../deckHeroConstants.ts", import.meta.url),
);

// ── BUG-1: experience price reads the envelope total, not the stop sum ────────
Deno.test("ORCH-1065 BUG-1: experience variant is detected (brandExperience presence)", () => {
  assertStringIncludes(card, "const isBrandExperience = brandExperience != null");
});

Deno.test("ORCH-1065 BUG-1: experience price uses card.totalPriceMin/Max, NOT the stop sum (fails-on-revert)", () => {
  // The cumulative price must branch on isBrandExperience: experiences read the
  // envelope total (totalPriceMin/Max from total_price_cents), curated still sums
  // stops. A revert (always summing stops) drops the branch → this fails.
  assertStringIncludes(
    card,
    "const experienceTotalMin = typeof card.totalPriceMin === 'number' ? card.totalPriceMin : 0",
  );
  assertStringIncludes(
    card,
    "const experienceTotalMax = typeof card.totalPriceMax === 'number' ? card.totalPriceMax : 0",
  );
  const minIdx = card.indexOf("const cumulativePriceMin = isBrandExperience");
  const maxIdx = card.indexOf("const cumulativePriceMax = isBrandExperience");
  assert(minIdx >= 0, "cumulativePriceMin must branch on isBrandExperience");
  assert(maxIdx >= 0, "cumulativePriceMax must branch on isBrandExperience");
  // The experience branch reads the envelope total; the else branch sums stops.
  const minBranch = card.slice(minIdx, minIdx + 200);
  assertStringIncludes(minBranch, "? experienceTotalMin");
  assertStringIncludes(minBranch, "stop.priceMin");
});

Deno.test("ORCH-1065 BUG-1: priced experience formats via the currency-aware helper, only 0 shows Free", () => {
  // formatCurrency (currency-aware, per the constitution) renders the all-in
  // price; the Free path is gated strictly on a 0/0 total — a priced experience
  // ($45) never hits it.
  assertStringIncludes(card, "import { parseAndFormatDistance, formatCurrency }");
  assertStringIncludes(card, "if (cumulativePriceMin === 0 && cumulativePriceMax === 0) return 'Free'");
  assertStringIncludes(card, "formatCurrency(cumulativePriceMin, effectiveCurrency)");
});

// ── BUG-2: rating chip hidden for the experience variant ─────────────────────
Deno.test("ORCH-1065 BUG-2: rating chip is gated off for brand experiences (fails-on-revert)", () => {
  // The star/rating GlassBadge must be wrapped in `isBrandExperience ? null : (...)`.
  // A revert (always rendering the rating chip) drops this gate → fails.
  const ratingIdx = card.indexOf('iconName="star"');
  assert(ratingIdx >= 0, "the rating star chip must exist (curated still shows it)");
  // Within the ~140 chars BEFORE the star chip there must be the experience gate.
  const before = card.slice(Math.max(0, ratingIdx - 140), ratingIdx);
  assertStringIncludes(before, "isBrandExperience ? null : (");
});

Deno.test("ORCH-1065 BUG-2: the rating value still renders for CURATED cards (gate is variant-scoped, not a blanket removal)", () => {
  // avgRating must still be computed + referenced (curated keeps its real rating).
  assertStringIncludes(card, "const avgRating =");
  assertStringIncludes(card, "{avgRating}");
});

// ── BUG-3: require cycle broken via the leaf module ──────────────────────────
Deno.test("ORCH-1065 BUG-3: hero constants live in the leaf ./deckHeroConstants module", () => {
  assertStringIncludes(heroConstants, "export const CARD_FALLBACK_IMAGE");
  assertStringIncludes(heroConstants, "export const DECK_HERO_PLACEHOLDER_BLURHASH");
  // The leaf module must NOT import either deck component (else the cycle returns).
  assert(
    !heroConstants.includes("from './SwipeableCards'") &&
      !heroConstants.includes("from './CuratedExperienceSwipeCard'"),
    "deckHeroConstants must be a leaf (no import of either deck component)",
  );
});

Deno.test("ORCH-1065 BUG-3: the card imports hero constants from the leaf module, NOT from SwipeableCards (fails-on-revert)", () => {
  assertStringIncludes(
    card,
    "from './deckHeroConstants'",
  );
  // The reverted import (from './SwipeableCards') must be ABSENT — that edge is
  // the one that closed the require cycle.
  assert(
    !card.includes("from './SwipeableCards'"),
    "CuratedExperienceSwipeCard must NOT import from SwipeableCards (that edge closes the require cycle)",
  );
});

Deno.test("ORCH-1065 BUG-3: SwipeableCards re-exports the constants for back-compat without redefining them", () => {
  // SwipeableCards consumes the constants from the leaf module + re-exports them,
  // so any historical importer that read them off SwipeableCards still works.
  assertStringIncludes(swipeable, 'from "./deckHeroConstants"');
  assertStringIncludes(swipeable, "export { CARD_FALLBACK_IMAGE, DECK_HERO_PLACEHOLDER_BLURHASH }");
  // It must NOT also redefine them as literals (that would be a duplicate source).
  assert(
    !swipeable.includes("export const CARD_FALLBACK_IMAGE ="),
    "SwipeableCards must not redefine CARD_FALLBACK_IMAGE (single source = leaf module)",
  );
});
