import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — T-03 expand-routing + mapper regression.
//
// SwipeableCards.tsx is a large RN component (heavy native deps), so per the
// established component-test pattern we read the source as text and assert the
// LOCKED seams: the 3-way renderer switch (cardType==='experience' → curated FACE
// with brand badge + Book CTA), the experienceRecToBusinessEventCard mapper
// (eventId set, single-ticket shape), the handleCardExpand experience branch,
// and the ExpandedCardModal businessEvent target — so a brand experience opens
// ExpandedBusinessEventSheet (NOT the curated itinerary) and books via
// ticket-checkout-create (NO parallel money fn — COMMS-0014/0016).
//
// Fails-on-revert (LOCKED, SPEC §7): T-07 fails if the expand routing falls back
// to the curated/nightOut path instead of businessEvent.

const swipeable = await Deno.readTextFile(
  new URL("../SwipeableCards.tsx", import.meta.url),
);
const card = await Deno.readTextFile(
  new URL("../CuratedExperienceSwipeCard.tsx", import.meta.url),
);

Deno.test("ORCH-1065 T-03a: experienceRecToBusinessEventCard mapper sets eventId + single-ticket shape", () => {
  const mapper = swipeable.slice(
    swipeable.indexOf("function experienceRecToBusinessEventCard"),
  );
  assert(mapper.length > 0, "mapper must exist");
  assertStringIncludes(mapper, "eventId,");
  assertStringIncludes(mapper, "brandProfilePhotoUrl:");
  assertStringIncludes(mapper, "coverHue: hueFromId(eventId)");
  // single ticket: priceMin/priceMax both come from totalPrice.
  assertStringIncludes(mapper, "priceMin: typeof rec?.totalPriceMin");
  assertStringIncludes(mapper, "publicBuyerUrl: `https://business.usemingla.com/e/");
});

Deno.test("ORCH-1065 T-03b: 3-way renderer switch — experience branch with brand badge + Book CTA", () => {
  assertStringIncludes(swipeable, "(currentRec as any).cardType === 'experience'");
  assertStringIncludes(swipeable, "brandExperience={{");
  assertStringIncludes(swipeable, 'ctaOverride="Book"');
});

Deno.test("ORCH-1065 T-03c/T-07: experience expand routes to businessEvent (fails-on-revert)", () => {
  // handleCardExpand must set the parallel experience state and route BEFORE the
  // curated branch's setSelectedCardForExpansion(... ExpandedCardData) call.
  const expand = swipeable.slice(swipeable.indexOf("const handleCardExpand"));
  const expBranchIdx = expand.indexOf("setExpandedBrandExperience(experienceRecToBusinessEventCard(currentRec))");
  const curatedBranchIdx = expand.indexOf("setSelectedCardForExpansion(currentRec as unknown as ExpandedCardData)");
  assert(expBranchIdx >= 0, "handleCardExpand must set the experience state");
  assert(curatedBranchIdx >= 0, "handleCardExpand must keep the curated branch");
  assert(
    expBranchIdx < curatedBranchIdx,
    "experience branch must run BEFORE the curated branch in handleCardExpand",
  );
  // ExpandedCardModal target uses the businessEvent branch for experiences.
  assertStringIncludes(swipeable, 'kind: "businessEvent", data: expandedBrandExperience');
});

Deno.test("ORCH-1065 T-03d: close handler clears the experience state", () => {
  const close = swipeable.slice(swipeable.indexOf("const handleCloseExpandedModal"));
  assertStringIncludes(close, "setExpandedBrandExperience(null)");
});

Deno.test("ORCH-1065 T-12/SC-13: brand badge + Book CTA gated on props (curated byte-unaffected)", () => {
  // Both new elements render ONLY when the props are present.
  assertStringIncludes(card, "brandExperience?: { brandName: string; brandLogoUrl: string | null }");
  assertStringIncludes(card, "ctaOverride?: string");
  assertStringIncludes(card, "{brandExperience ? (");
  assertStringIncludes(card, "isBookCta ? (");
  // ctaText falls back to the EXACT existing curated text when no override.
  assertStringIncludes(card, "ctaText = ctaOverride ?? (isSingleStop ? 'See Details' : 'See Full Plan')");
  // Monogram fallback uses the band-clamp (no fabricated logo — Constitution #9).
  assertStringIncludes(card, "function monogramFill");
  assertStringIncludes(card, "hue >= 45 && hue <= 75 ? 35 : 42");
  // Book CTA tokens (DESIGN §3.2): #FF6B35 fill, ticket-outline icon, minHeight 44.
  assertStringIncludes(card, "ticket-outline");
  assertStringIncludes(card, "#FF6B35");
  assertStringIncludes(card, "minHeight: 44");
});
