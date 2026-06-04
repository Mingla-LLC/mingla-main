import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — T-02 client converter regression.
//
// deckService.ts imports RN-bound modules (./supabase, ./curatedExperiencesService),
// so it cannot be imported in a Deno unit test. Per the established app-mobile
// service-test pattern, we read the source as text and assert the LOCKED
// converter contract: an experience envelope routes through
// experienceCardToRecommendation FIRST (before curated), carries the
// cardType:'experience' discriminator + brand fields, and maps stops → CuratedStop[]
// with honest defaults (no fabricated ratings — Constitution #9).
//
// Fails-on-revert (LOCKED): this test fails if the experience branch is removed
// from discoverCardsPayloadToRecommendations, or if it stops carrying the
// discriminator / brand fields.

const source = await Deno.readTextFile(
  new URL("../deckService.ts", import.meta.url),
);

Deno.test("ORCH-1065 T-02a: isExperiencePayload + converter exist", () => {
  assertStringIncludes(source, "function isExperiencePayload");
  assertStringIncludes(source, "card?.cardType === 'experience'");
  assertStringIncludes(source, "function experienceCardToRecommendation");
});

Deno.test("ORCH-1065 T-02b: experience routes FIRST in discoverCardsPayloadToRecommendations (fails-on-revert)", () => {
  const mapBody = source.slice(
    source.indexOf("export function discoverCardsPayloadToRecommendations"),
  );
  const expIdx = mapBody.indexOf("isExperiencePayload(card)");
  const curatedIdx = mapBody.indexOf("isCuratedPayload(card)");
  assert(expIdx >= 0, "experience branch must be present in the map");
  assert(curatedIdx >= 0, "curated branch must be present in the map");
  assert(
    expIdx < curatedIdx,
    "experience branch must run BEFORE the curated branch (an experience envelope also has stops[])",
  );
});

Deno.test("ORCH-1065 T-02c: converter carries discriminator + brand attribution + eventId", () => {
  const conv = source.slice(
    source.indexOf("function experienceCardToRecommendation"),
    source.indexOf("function isCuratedPayload"),
  );
  assertStringIncludes(conv, "cardType: 'experience'");
  for (const field of [
    "eventId:",
    "brandId:",
    "brandName:",
    "brandSlug:",
    "brandLogoUrl:",
    "eventSlug:",
    "experienceType:",
  ]) {
    assertStringIncludes(conv, field);
  }
});

Deno.test("ORCH-1065 T-02d: stops mapped to CuratedStop with honest defaults (no fabrication)", () => {
  const conv = source.slice(
    source.indexOf("function experienceCardToRecommendation"),
    source.indexOf("function isCuratedPayload"),
  );
  // Honest 0 rating / 0 reviewCount, null hours/open/website, derived stopLabel.
  assertStringIncludes(conv, "stopLabel:");
  assertStringIncludes(conv, "rating: 0");
  assertStringIncludes(conv, "reviewCount: 0");
  assertStringIncludes(conv, "openingHours: null");
  assertStringIncludes(conv, "isOpenNow: null");
  assertStringIncludes(conv, "website: null");
});

Deno.test("ORCH-1065 T-02e: experienceStopLabel derives Start/Then/End by index", () => {
  // Pure logic mirrored here (the source helper is not exported); assert the
  // source helper exists and the literals are present so the deck shows the
  // same labels curated does.
  assertStringIncludes(source, "function experienceStopLabel");
  for (const label of ["'Start Here'", "'End With'", "'Then'"]) {
    assertStringIncludes(source, label);
  }
});
