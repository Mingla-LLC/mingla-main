import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1071 [experiences-on-curated-path] — implementor backend regression tests.
//
// generate-curated-experiences/index.ts calls serve() at module load and the
// supply helpers close over a service-role client, so (per the established
// orch_1065 / orch_0909 / orch_1062 pattern) we exercise the front-load machinery
// by reading the edge source as TEXT and asserting the LOCKED contract is present
// and wired into the handler return.
//
// Fails-on-revert (LOCKED, dispatch §IMPLEMENT.1):
//   T-1 fails if the front-load call is removed from the handler return path.
//   T-2 fails if the brand-intent gate (skip non-brand types) is removed.
//   T-3 fails if the best-effort try/catch is removed.
//   T-5 fails if the new code references the COMMS-0018 bypassed machinery.

const edge = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

// Isolate the ORCH-1071 supply block (between the markers).
const blockStart = edge.indexOf("// ─── ORCH-1071 [experiences-on-curated-path]");
const blockEnd = edge.indexOf("// ─── end ORCH-1071 ─");
assert(
  blockStart >= 0 && blockEnd > blockStart,
  "ORCH-1071 supply block markers must be present",
);
const block = edge.slice(blockStart, blockEnd);

Deno.test("ORCH-1071 T-1a: supply helper + front-load helper exist and reuse the RPC + envelope", () => {
  assertStringIncludes(edge, "fetchEligibleExperiencesForCurated");
  assertStringIncludes(edge, "frontLoadCuratedExperiences");
  // Same RPC discover-cards uses (no parallel system).
  assertStringIncludes(block, "pg_eligible_experiences_for_deck");
  // Same envelope discriminator + brand attribution the client converter decodes.
  assertStringIncludes(block, "cardType: 'experience'");
  for (const field of [
    "eventId:",
    "brandId:",
    "brandName:",
    "brandSlug:",
    "brandLogoUrl:",
    "eventSlug:",
    "totalPriceMin:",
    "totalPriceMax:",
    "currency:",
    "masterDateUtc:",
  ]) {
    assertStringIncludes(block, field);
  }
});

Deno.test("ORCH-1071 T-1b: handler front-loads experiences into the served cards (fails-on-revert)", () => {
  // The handler must CALL the front-load helper and rebind normalizedCards to its
  // result, and the response must serve `cards: normalizedCards`.
  assert(
    /normalizedCards\s*=\s*frontLoadCuratedExperiences\(\s*normalizedCards\s*,\s*experienceCards\s*\)/.test(edge),
    "handler must rebind normalizedCards = frontLoadCuratedExperiences(normalizedCards, experienceCards)",
  );
  assert(
    /cards:\s*normalizedCards/.test(edge),
    "response must serve `cards: normalizedCards`",
  );
  // The front-load helper places experiences at the HEAD (ahead of AI cards).
  assert(
    /return\s*\[\s*\.\.\.deduped\s*,\s*\.\.\.aiCards\s*\]/.test(edge),
    "frontLoadCuratedExperiences must place experiences BEFORE the AI cards",
  );
});

Deno.test("ORCH-1071 T-2: only the 4 brand intents front-load; non-brand types skipped (fails-on-revert)", () => {
  assertStringIncludes(edge, "CURATED_BRAND_EXPERIENCE_INTENTS");
  // The gate set is exactly the 4 brand intents.
  for (const intent of ["'adventurous'", "'first-date'", "'romantic'", "'group-fun'"]) {
    assertStringIncludes(block, intent);
  }
  // picnic-dates and take-a-stroll must NOT be in the brand-intent set.
  const setDecl = block.slice(
    block.indexOf("CURATED_BRAND_EXPERIENCE_INTENTS = new Set"),
    block.indexOf("]);", block.indexOf("CURATED_BRAND_EXPERIENCE_INTENTS = new Set")) + 3,
  );
  assertEquals(
    setDecl.includes("picnic-dates"),
    false,
    "picnic-dates must NOT be a brand-experience intent",
  );
  assertEquals(
    setDecl.includes("take-a-stroll"),
    false,
    "take-a-stroll must NOT be a brand-experience intent",
  );
  // The handler must GATE the fetch on the brand-intent membership.
  assert(
    /CURATED_BRAND_EXPERIENCE_INTENTS\.has\(experienceType\)/.test(edge),
    "handler must gate the experience front-load on CURATED_BRAND_EXPERIENCE_INTENTS.has(experienceType)",
  );
});

Deno.test("ORCH-1071 T-3: experience front-load is best-effort (try/catch, never breaks AI curated)", () => {
  // The handler must wrap the front-load in try/catch and tolerate failure with
  // a warn-and-continue (no throw, no early return).
  const guard = edge.slice(
    edge.indexOf("CURATED_BRAND_EXPERIENCE_INTENTS.has(experienceType)"),
  );
  assertStringIncludes(guard, "try {");
  assertStringIncludes(guard, "catch (expErr)");
  assertStringIncludes(guard, "front-load failed (tolerating)");
});

Deno.test("ORCH-1071 T-4: warm path skips the front-load (servedCards is empty there)", () => {
  // The gate must also require !warmPool so the warm-ping path stays a no-op.
  assert(
    /!warmPool\s*&&\s*CURATED_BRAND_EXPERIENCE_INTENTS\.has\(experienceType\)/.test(edge),
    "front-load must be gated on !warmPool && brand intent",
  );
});

Deno.test("ORCH-1071 T-5: front-load CODE never references the COMMS-0018 bypassed machinery", () => {
  function stripComments(value: string): string {
    return value
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/[ \t]\/\/[^\n]*$/gm, "");
  }
  const codeOnly = stripComments(block);
  for (const banned of [
    "place_pool",
    "ai_signal_scores",
    "run-signal-scorer",
    "session_deck_cards",
  ]) {
    assertEquals(
      codeOnly.includes(banned),
      false,
      `ORCH-1071 front-load code must not reference ${banned} (COMMS-0018 bypass)`,
    );
  }
});

Deno.test("ORCH-1071 T-6: RPC is filtered to the pill's intent + excludeCardIds wired", () => {
  // The fetch passes the pill's experienceType as the single-element p_intents.
  assertStringIncludes(block, "p_intents: [args.experienceType]");
  // excludeCardIds is read from the body and threaded to p_exclude_ids.
  assertStringIncludes(edge, "excludeCardIds = []");
  assert(
    /excludeEventIds:\s*excludeCardIds\.filter/.test(edge),
    "handler must thread excludeCardIds → excludeEventIds (p_exclude_ids) for cross-path dedupe",
  );
});
