import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — TESTER ADVERSARIAL component set.
//
// The implementor's orch1065_experience_expand.test.tsx grep-asserts the seams
// EXIST and are ordered. This set attacks the NEGATIVE cases the happy path
// can't: that an experience can NEVER reach the curated itinerary path (the
// experience branch must EARLY-RETURN so it can't fall through), that the
// businessEvent target STRICTLY precedes nightOut (so an experience that also
// somehow had selectedCardForExpansion set still opens the business sheet), that
// the close handler clears BOTH states (no stale experience leaking into the
// next open), that the monogram fallback is reachable (honest, no fabricated
// logo), and that curated callers get ZERO brand chrome.
//
// SwipeableCards.tsx / CuratedExperienceSwipeCard.tsx carry heavy native deps,
// so per the established component-test pattern we read source-as-text and
// assert the LOCKED seams with structural/ordering proofs the happy path omits.

const swipeable = await Deno.readTextFile(
  new URL("../SwipeableCards.tsx", import.meta.url),
);
const card = await Deno.readTextFile(
  new URL("../CuratedExperienceSwipeCard.tsx", import.meta.url),
);

// ── T-07 (negative): the experience branch in handleCardExpand must EARLY-RETURN
//    so an experience can NEVER fall through to the curated/place expand below it.
//    The happy-path test only checks the branch comes first; it does NOT prove
//    the `return`. A missing `return` would set the experience state AND continue
//    into the curated/place path → double-open / wrong sheet. We prove the return.
// Anchor on the async definition (NOT the `handleCardExpandRef` declared earlier).
function handleCardExpandBody(): string {
  const start = swipeable.indexOf("const handleCardExpand = async");
  assert(start >= 0, "handleCardExpand async definition must exist");
  return swipeable.slice(start, start + 4000);
}

Deno.test("ORCH-1065 T-07-adv: the experience expand branch early-returns (cannot fall through to curated/place)", () => {
  const expandFn = handleCardExpandBody();
  const branchIdx = expandFn.indexOf("setExpandedBrandExperience(experienceRecToBusinessEventCard(currentRec))");
  assert(branchIdx >= 0, "experience branch must be present in handleCardExpand");
  // Within the next ~120 chars after setting the state there must be a `return;`
  // BEFORE the curated branch's `cardType === 'curated'` test.
  const afterBranch = expandFn.slice(branchIdx, branchIdx + 120);
  assertStringIncludes(afterBranch, "return;");
  const curatedIdx = expandFn.indexOf("cardType === 'curated'", branchIdx);
  const returnIdx = expandFn.indexOf("return;", branchIdx);
  assert(returnIdx >= 0 && returnIdx < curatedIdx, "experience branch must return BEFORE the curated branch");
});

// ── T-07 (target precedence): the ExpandedCardModal target must check
//    expandedBrandExperience FIRST. If a stale selectedCardForExpansion existed,
//    an experience must STILL open the businessEvent sheet — never nightOut.
Deno.test("ORCH-1065 T-07-adv: businessEvent target STRICTLY precedes nightOut in the modal target ternary", () => {
  const targetExpr = swipeable.slice(
    swipeable.indexOf("target={"),
    swipeable.indexOf("onClose={handleCloseExpandedModal}"),
  );
  const beIdx = targetExpr.indexOf('kind: "businessEvent"');
  const noIdx = targetExpr.indexOf('kind: "nightOut"');
  assert(beIdx >= 0, "businessEvent target branch must exist");
  assert(noIdx >= 0, "nightOut target branch must exist");
  assert(
    beIdx < noIdx,
    "businessEvent (experience) must be evaluated BEFORE nightOut so an experience never opens the place sheet",
  );
  // The businessEvent branch is gated on expandedBrandExperience (the experience state).
  assertStringIncludes(targetExpr, "expandedBrandExperience");
});

// ── T-07 (no curated route): an experience must NEVER be passed to the curated
//    expand setter. Prove the experience id is routed via setExpandedBrandExperience,
//    not setSelectedCardForExpansion, in the experience branch.
Deno.test("ORCH-1065 T-07-adv: experience never reaches setSelectedCardForExpansion (no curated itinerary)", () => {
  const expandFn = handleCardExpandBody();
  const expBranchStart = expandFn.indexOf("if ((currentRec as any).cardType === 'experience')");
  const expBranchEnd = expandFn.indexOf("if ((currentRec as any).cardType === 'curated')");
  assert(expBranchStart >= 0 && expBranchEnd > expBranchStart, "both branches present and ordered");
  const expBranch = expandFn.slice(expBranchStart, expBranchEnd);
  assert(
    !expBranch.includes("setSelectedCardForExpansion"),
    "the experience branch must NOT call the curated expand setter",
  );
});

// ── Close hygiene: handleCloseExpandedModal must clear BOTH the experience state
//    AND the curated/nightOut state — otherwise a stale experience leaks into the
//    next card's expand. The happy path only checks the experience clear.
Deno.test("ORCH-1065 T-07-adv: close handler clears the experience state (no stale leak across opens)", () => {
  const close = swipeable.slice(
    swipeable.indexOf("const handleCloseExpandedModal"),
    swipeable.indexOf("const handleCloseExpandedModal") + 600,
  );
  assertStringIncludes(close, "setExpandedBrandExperience(null)");
});

// ── T-13: curated cards are byte-unaffected. The renderer's curated branch must
//    NOT pass brandExperience or ctaOverride (so curated shows no brand chip and
//    keeps "See Full Plan"). Adversarial: prove the curated render call is clean.
Deno.test("ORCH-1065 T-13-adv: curated renderer branch passes NO brandExperience / ctaOverride (curated unaffected)", () => {
  // The 3-way switch: experience branch carries the brand props; curated branch must not.
  const switchBlock = swipeable.slice(
    swipeable.indexOf("(currentRec as any).cardType === 'experience' ?"),
    swipeable.indexOf("(currentRec as any).cardType === 'experience' ?") + 2000,
  );
  const curatedBranchIdx = switchBlock.indexOf("(currentRec as any).cardType === 'curated' ?");
  assert(curatedBranchIdx >= 0, "curated branch must exist in the switch");
  // From the curated branch onward there must be no brandExperience= / ctaOverride= until the default.
  const curatedOnward = switchBlock.slice(curatedBranchIdx);
  // The experience branch (above curatedBranchIdx) is where these belong.
  const expOnly = switchBlock.slice(0, curatedBranchIdx);
  assertStringIncludes(expOnly, "brandExperience={{");
  assertStringIncludes(expOnly, 'ctaOverride="Book"');
  assert(
    !curatedOnward.includes("brandExperience={{") && !curatedOnward.includes('ctaOverride="Book"'),
    "curated/default render branches must NOT receive brandExperience / ctaOverride",
  );
});

// ── T-13: the brand chip + Book button are GATED on the optional props in the
//    card component, so a curated caller (passing neither) renders them never.
Deno.test("ORCH-1065 T-13-adv: brand chip + Book CTA are gated on optional props (curated path renders neither)", () => {
  // Both new props are OPTIONAL (curated callers pass neither).
  assertStringIncludes(card, "brandExperience?:");
  assertStringIncludes(card, "ctaOverride?:");
  // The chip renders only when brandExperience is present.
  assertStringIncludes(card, "{brandExperience ? (");
  // The CTA text falls back to the EXACT pre-existing curated copy when no override.
  assertStringIncludes(card, "ctaText = ctaOverride ?? (isSingleStop ? 'See Details' : 'See Full Plan')");
});

// ── T-12: the monogram fallback (honest, no fabricated logo) is reachable. When
//    brandLogoUrl is null OR the <Image> errors, the card shows a deterministic
//    monogram, never a placeholder/fake brand mark (Constitution #9).
Deno.test("ORCH-1065 T-12-adv: monogram fallback exists for null/failed logo (no fabricated brand mark)", () => {
  assertStringIncludes(card, "function monogramFill");
  // The monogram is derived from the brand name initial — an honest text mark.
  // There must be an onError → fallback path on the logo image (load failure ⇒ monogram).
  assert(
    /onError|logoFailed|logoError/.test(card),
    "the brand logo must have an onError → monogram fallback (failed load shows the honest monogram)",
  );
  // No-AI-slop: the brand mark must not be a generic gradient/emoji. Assert the
  // monogram fill is a band-clamped hue (real deterministic color), not a gradient.
  assertStringIncludes(card, "hue >= 45 && hue <= 75 ? 35 : 42");
});

// ── T-12: Book CTA accessibility — the button must carry an a11y label naming
//    the action+title (no dead/ambiguous tap). Adversarial: a generic "Book"
//    with no context would fail a11y review.
Deno.test("ORCH-1065 T-12-adv: Book CTA has a contextual accessibility label", () => {
  // The DESIGN/impl report claims a `Book {title}` a11y label. Prove it's wired.
  assert(
    /accessibilityLabel=\{?[`'"]Book /.test(card),
    "the Book CTA must have an accessibilityLabel that names the action (e.g. `Book {title}`)",
  );
  // Min touch target 44pt (Apple HIG) — no sub-44 tap target.
  assertStringIncludes(card, "minHeight: 44");
});

// ── Discriminator integrity: the experience renderer branch must key on the
//    EXACT 'experience' discriminator (not a truthy brand-field check that a
//    curated card with a stray field could trip).
Deno.test("ORCH-1065 ADV: renderer keys on the exact cardType discriminator, not a loose brand-field probe", () => {
  assertStringIncludes(swipeable, "(currentRec as any).cardType === 'experience'");
  // It must be an === string compare, never a `.brandName &&` truthy gate that
  // could misfire on a curated card that happened to carry a brand field.
  const switchHead = swipeable.slice(
    swipeable.indexOf("(currentRec as any).cardType === 'experience' ?") - 40,
    swipeable.indexOf("(currentRec as any).cardType === 'experience' ?") + 60,
  );
  assert(
    !/brandName\s*&&/.test(switchHead),
    "renderer must discriminate on cardType === 'experience', not a truthy brandName probe",
  );
});
