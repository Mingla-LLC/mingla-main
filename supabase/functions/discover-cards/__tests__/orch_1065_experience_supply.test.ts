import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — implementor happy-path supply tests.
//
// index.ts calls serve() at module load and the supply helpers close over a
// service-role client, so (per the established orch_0909/orch_1062 pattern) we
// exercise the supply machinery by reading the edge source + the migration SQL
// as text and asserting the LOCKED contract is present and wired. The tester
// adds the live RPC live-fire (T-04/T-06) on a seeded experience.
//
// Fails-on-revert (LOCKED, SPEC §7):
//   T-01 fails if the interleave / experiences-only return is removed.
//   T-05 fails if the unsellable (available_online) gate is removed from the RPC.
//   T-09-guard fails if any place_pool/run-signal-scorer ref is added to the new code.

const root = new URL("../../../..", import.meta.url).pathname;
const edge = await Deno.readTextFile(
  `${root}/supabase/functions/discover-cards/index.ts`,
);
const migration = await Deno.readTextFile(
  `${root}/supabase/migrations/20260903000000_orch_1065_eligible_experiences_for_deck.sql`,
);

Deno.test("ORCH-1065 T-01a: edge fn fetches eligible experiences via the RPC", () => {
  assertStringIncludes(edge, "fetchEligibleExperiences");
  assertStringIncludes(edge, "pg_eligible_experiences_for_deck");
  // The experience card envelope carries the discriminator + brand attribution.
  assertStringIncludes(edge, "cardType: 'experience'");
  assertStringIncludes(edge, "brandName");
  assertStringIncludes(edge, "brandLogoUrl");
  assertStringIncludes(edge, "eventId");
});

Deno.test("ORCH-1065 T-01b: experiences are interleaved into the populated deck return (fails-on-revert)", () => {
  // The interleave helper must exist AND be applied to the populated return.
  assertStringIncludes(edge, "interleaveExperiencesIntoDeck");
  // The populated return must serve mergedCards, not the bare finalCards.
  const mergedDecl = /const\s+mergedCards\s*=\s*interleaveExperiencesIntoDeck\(\s*finalCards\s*,\s*experienceCards\s*\)/;
  assert(
    mergedDecl.test(edge),
    "mergedCards must be built from interleaveExperiencesIntoDeck(finalCards, experienceCards)",
  );
  assert(
    /cards:\s*mergedCards/.test(edge),
    "populated return must serve `cards: mergedCards`",
  );
});

Deno.test("ORCH-1065 T-01c: empty place pool + experiences returns a populated path:'pipeline' deck (not pool-empty)", () => {
  // The zero-row branch must attempt an experiences-only populated return.
  assertStringIncludes(edge, "experiences-only");
  // Inside the zero-row branch, when experiences exist, return path:'pipeline'.
  assert(
    /if\s*\(\s*experienceCards\.length\s*>\s*0\s*\)/.test(edge),
    "zero-row branch must check experienceCards.length > 0 before pool-empty",
  );
});

Deno.test("ORCH-1065 T-01d: intent→intent map covers the 4 brand intents, permissive on empty", () => {
  assertStringIncludes(edge, "EXPERIENCE_INTENT_BY_SIGNAL");
  for (const pair of [
    "adventurous: 'adventurous'",
    "romantic: 'romantic'",
    "'group-fun': 'group-fun'",
    "lively: 'group-fun'",
    "icebreakers: 'first-date'",
  ]) {
    assertStringIncludes(edge, pair);
  }
  // Permissive-on-empty: the RPC applies no intent filter when p_intents = {}.
  assertStringIncludes(migration, "p_intents = '{}'::text[] OR e.experience_intents && p_intents");
});

Deno.test("ORCH-1065 T-01e: RPC enforces the published-live eligibility predicate", () => {
  assertStringIncludes(migration, "e.event_type   = 'experience'");
  assertStringIncludes(migration, "e.visibility   = 'public'");
  assertStringIncludes(migration, "e.status       = 'scheduled'");
  assertStringIncludes(migration, "e.published_at IS NOT NULL");
  // Future-date gate (mirrors i-discover-excludes-ended-master-date).
  assertStringIncludes(migration, "ed.end_at > p_now");
});

Deno.test("ORCH-1065 T-05: RPC excludes experiences with no available_online ticket (fails-on-revert)", () => {
  // The unsellable gate: an EXISTS on a ticket_types row with available_online = true.
  const sellableGate =
    /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.ticket_types\s+tt\s+WHERE\s+tt\.event_id\s*=\s*e\.id\s+AND\s+tt\.available_online\s*=\s*true/i;
  assert(
    sellableGate.test(migration),
    "RPC must gate on EXISTS(ticket_types WHERE available_online = true) — unsellable experiences excluded",
  );
});

Deno.test("ORCH-1065 T-09-guard: new experience supply CODE never references place_pool/signal-scorer (COMMS-0018)", () => {
  // Isolate the ORCH-1065 supply block (between the markers) and the migration,
  // strip comments (the bypass is documented in prose — the GATE is on executable
  // code), and assert zero CODE references to the bypassed venue→deck machinery.
  function stripComments(value: string): string {
    return value
      .replace(/\/\*[\s\S]*?\*\//g, "")    // block comments
      .replace(/--[^\n]*$/gm, "")          // SQL line comments
      .replace(/^[ \t]*\/\/.*$/gm, "")     // JS full-line comments
      .replace(/[ \t]\/\/[^\n]*$/gm, "");  // JS trailing comments
  }
  const start = edge.indexOf("// ─── ORCH-1065 [consumer-experience-deck-card]");
  const end = edge.indexOf("// ─── end ORCH-1065 ─");
  assert(start >= 0 && end > start, "ORCH-1065 supply block markers must be present");
  const block = stripComments(edge.slice(start, end));
  const migrationCode = stripComments(migration);
  for (const banned of [
    "place_pool",
    "ai_signal_scores",
    "run-signal-scorer",
    "session_deck_cards",
  ]) {
    assertEquals(
      block.includes(banned),
      false,
      `ORCH-1065 supply code must not reference ${banned} (COMMS-0018 bypass)`,
    );
    assertEquals(
      migrationCode.includes(banned),
      false,
      `ORCH-1065 migration code must not reference ${banned} (COMMS-0018 bypass)`,
    );
  }
});

Deno.test("ORCH-1065 T-supply-grant: RPC is SECURITY DEFINER, service_role only, no anon", () => {
  assertStringIncludes(migration, "SECURITY DEFINER");
  assertStringIncludes(migration, "SET search_path = public, pg_temp");
  assertStringIncludes(migration, "TO service_role");
  // No anon grant on this function.
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_eligible_experiences_for_deck[\s\S]*?TO\s+anon/i.test(
      migration,
    ),
    "pg_eligible_experiences_for_deck must NOT be granted to anon",
  );
});
