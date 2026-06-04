import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1071 [experiences-on-curated-path] — client converter-routing regression.
//
// deckService.ts imports RN-bound modules (./supabase, ./curatedExperiencesService),
// so it cannot be imported in a Deno unit test. Per the established app-mobile
// service-test pattern (see deckService.orch1065.test.ts), we read the source as
// text and assert the LOCKED routing contract: the curated-path handler maps
// response.cards routing any cardType:'experience' card through the brand-experience
// converter (experienceCardToRecommendation), NOT the AI-curated converter, and the
// final deck dedupes by id so a cross-path experience renders once.
//
// Fails-on-revert (LOCKED): this test fails if the curated handler reverts to a
// bare response.cards.map(curatedToRecommendation) (which would render brand
// experiences as AI-curated cards and lose brand attribution).

const source = await Deno.readTextFile(
  new URL("../deckService.ts", import.meta.url),
);

Deno.test("ORCH-1071 T-C1: curated handler routes cardType:'experience' through experienceCardToRecommendation (fails-on-revert)", () => {
  // Isolate the curated pill map call site (the one that previously was a bare
  // response.cards.map(curatedToRecommendation)).
  const curatedIdx = source.indexOf("response.cards.map(");
  assert(curatedIdx >= 0, "curated handler must map response.cards");
  // The map callback must dispatch on isExperiencePayload → experienceCardToRecommendation,
  // else fall through to curatedToRecommendation.
  const region = source.slice(curatedIdx, curatedIdx + 600);
  assertStringIncludes(region, "isExperiencePayload(card)");
  assertStringIncludes(region, "experienceCardToRecommendation(card)");
  assertStringIncludes(region, "curatedToRecommendation(card)");
  // The experience branch must come BEFORE the curated fallback in the ternary.
  const expIdx = region.indexOf("experienceCardToRecommendation(card)");
  const curIdx = region.indexOf("curatedToRecommendation(card)");
  assert(
    expIdx >= 0 && curIdx >= 0 && expIdx < curIdx,
    "experience converter must be the truthy branch (runs before the curated fallback)",
  );
});

Deno.test("ORCH-1071 T-C2: the experience converter + discriminator predicate exist", () => {
  assertStringIncludes(source, "function isExperiencePayload");
  assertStringIncludes(source, "card?.cardType === 'experience'");
  assertStringIncludes(source, "function experienceCardToRecommendation");
});

Deno.test("ORCH-1071 T-C3: final deck interleave dedupes by id (cross-path single-render)", () => {
  // The final 1:1 interleave keeps a `seen` Set keyed by id so an experience that
  // arrives via BOTH the places path (discover-cards) and the curated path renders
  // once. Assert the dedupe Set + the id-keyed guards are present on both streams.
  const interleaveIdx = source.indexOf("// 1:1 interleave: alternate regular and curated");
  assert(interleaveIdx >= 0, "final interleave block must be present");
  const region = source.slice(interleaveIdx, interleaveIdx + 700);
  assertStringIncludes(region, "const seen = new Set<string>()");
  // Regular stream id key (placeId || id) and curated stream id key.
  assertStringIncludes(region, "regularStream[i].placeId || regularStream[i].id");
  assertStringIncludes(region, "curatedStream[i].id");
  assertStringIncludes(region, "seen.has(id)");
  assertStringIncludes(region, "seen.add(id)");
});
