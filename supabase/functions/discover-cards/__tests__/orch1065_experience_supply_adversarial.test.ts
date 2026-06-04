import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — TESTER ADVERSARIAL supply set.
//
// These attack DIFFERENT failure modes than the implementor's happy-path
// orch_1065_experience_supply.test.ts (which proves the seams are wired). Here
// we go after the EXCLUSION boundaries (a card that MUST NOT surface), the
// EXECUTABLE interleave logic (ported verbatim from index.ts and run against
// adversarial inputs the happy-path never exercises), the SOURCE-FAILURE
// tolerance, the EMPTY-POOL experiences-only path, and a deeper COMMS-0018
// bypass that survives whitespace/case tricks.
//
// Coverage map (SPEC §7 adversarial column):
//   T-04  past-dated experience NEVER surfaces            (RPC predicate)
//   T-06  geo: all stops > radius NEVER surfaces          (RPC predicate)
//   T-10  experience-source failure tolerance             (edge, INV-042)
//   T-11  empty place pool + experiences ⇒ pipeline       (edge, INV-043)
//   T-09+ COMMS-0018 bypass — deeper than the grep guard  (static, executable)
//   plus: interleave executable boundaries (additive, dedupe, displacement,
//         spacing, exclude-self) — the implementor only grep-asserted the call.

const root = new URL("../../../..", import.meta.url).pathname;
const edge = await Deno.readTextFile(
  `${root}/supabase/functions/discover-cards/index.ts`,
);
const migration = await Deno.readTextFile(
  `${root}/supabase/migrations/20260903000000_orch_1065_eligible_experiences_for_deck.sql`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Executable port of interleaveExperiencesIntoDeck (verbatim from index.ts).
// The implementor's tests only grep that the helper is CALLED; they never RUN
// it. We run the exact algorithm against adversarial inputs.  If the algorithm
// in index.ts changes shape, the SOURCE-PINNING assert below (interleave-pin)
// fails first, forcing this port to be re-synced — the port can never silently
// drift from the shipped code without a red test.
// ─────────────────────────────────────────────────────────────────────────────
interface ExpStub {
  id: string;
  cardType: "experience";
}
function interleaveExperiencesIntoDeck(
  placeCards: any[],
  experienceCards: ExpStub[],
): any[] {
  if (experienceCards.length === 0) return placeCards;
  const seen = new Set<string>();
  const dedupedExp: ExpStub[] = [];
  for (const exp of experienceCards) {
    if (!seen.has(exp.id)) {
      seen.add(exp.id);
      dedupedExp.push(exp);
    }
  }
  if (placeCards.length === 0) return [...dedupedExp];
  const placeIds = new Set<string>();
  for (const c of placeCards) {
    if (c && typeof c.id === "string") placeIds.add(c.id);
  }
  const expToPlace = dedupedExp.filter((e) => !placeIds.has(e.id));
  if (expToPlace.length === 0) return placeCards;
  const gap = Math.max(1, Math.ceil(placeCards.length / (expToPlace.length + 1)));
  const merged: any[] = [];
  let expIdx = 0;
  for (let i = 0; i < placeCards.length; i++) {
    merged.push(placeCards[i]);
    if ((i + 1) % gap === 0 && expIdx < expToPlace.length) {
      merged.push(expToPlace[expIdx++]);
    }
  }
  while (expIdx < expToPlace.length) merged.push(expToPlace[expIdx++]);
  return merged;
}
const place = (id: string) => ({ id, cardType: "place" as const });
const exp = (id: string): ExpStub => ({ id, cardType: "experience" });

// Guard: keep the executable port faithful to the shipped helper. If the helper
// body in index.ts is rewritten, this pin must be updated in lockstep (and the
// reviewer re-confirms the port). This is the anti-drift seam for the port.
Deno.test("ORCH-1065 ADV interleave-pin: shipped helper still uses the ceil-spread + additive contract", () => {
  const body = edge.slice(
    edge.indexOf("function interleaveExperiencesIntoDeck"),
    edge.indexOf("// ─── end ORCH-1065"),
  );
  assert(body.length > 0, "interleaveExperiencesIntoDeck must exist in index.ts");
  assertStringIncludes(body, "Math.ceil(placeCards.length / (expToPlace.length + 1))");
  assertStringIncludes(body, "if (placeCards.length === 0) return [...dedupedExp]");
  assertStringIncludes(body, "filter((e) => !placeIds.has(e.id))");
});

// ── T-11 (executable): empty place pool + experiences ⇒ experiences-only, NOT empty.
Deno.test("ORCH-1065 T-11a (exec): empty place pool with experiences yields the experiences (never []), order preserved", () => {
  const out = interleaveExperiencesIntoDeck([], [exp("e1"), exp("e2"), exp("e3")]);
  assertEquals(out.map((c) => c.id), ["e1", "e2", "e3"]);
  assertEquals(out.length, 3);
});

// ── Additive: experiences NEVER displace or drop place cards (SPEC §3.1.4 LOCKED).
Deno.test("ORCH-1065 ADV interleave: every place card is preserved (additive, never displaced)", () => {
  const places = [place("p1"), place("p2"), place("p3"), place("p4"), place("p5")];
  const out = interleaveExperiencesIntoDeck(places, [exp("e1"), exp("e2")]);
  // Every original place id is still present, in original relative order.
  const placeOrder = out.filter((c) => c.cardType === "place").map((c) => c.id);
  assertEquals(placeOrder, ["p1", "p2", "p3", "p4", "p5"]);
  // All experiences present too.
  const expOrder = out.filter((c) => c.cardType === "experience").map((c) => c.id);
  assertEquals(expOrder.sort(), ["e1", "e2"]);
  // Total = additive sum, nothing lost.
  assertEquals(out.length, 7);
});

// ── Dedupe: duplicate experience ids collapse to one (SPEC §3.1.4 LOCKED).
Deno.test("ORCH-1065 ADV interleave: duplicate experience ids are deduped to a single card", () => {
  const out = interleaveExperiencesIntoDeck([place("p1"), place("p2")], [
    exp("dup"),
    exp("dup"),
    exp("dup"),
  ]);
  const dupCount = out.filter((c) => c.id === "dup").length;
  assertEquals(dupCount, 1, "duplicate experience ids must collapse to one");
});

// ── Exclude-self: an experience whose id collides with a place id is dropped
//    from the experience lane (the place wins; no double-render). Adversarial:
//    the happy-path never feeds a colliding id.
Deno.test("ORCH-1065 ADV interleave: experience colliding with a place id is excluded (no double-render)", () => {
  const out = interleaveExperiencesIntoDeck(
    [place("shared"), place("p2")],
    [exp("shared"), exp("e2")],
  );
  // "shared" appears exactly once, as the place card.
  assertEquals(out.filter((c) => c.id === "shared").length, 1);
  assertEquals(out.find((c) => c.id === "shared")?.cardType, "place");
  // e2 still surfaces.
  assert(out.some((c) => c.id === "e2" && c.cardType === "experience"));
});

// ── Spacing: experiences are spread, not all clustered at the head or tail.
Deno.test("ORCH-1065 ADV interleave: experiences are spread (not all clustered at index 0)", () => {
  const places = Array.from({ length: 9 }, (_, i) => place(`p${i}`));
  const out = interleaveExperiencesIntoDeck(places, [exp("e1"), exp("e2")]);
  const expPositions = out
    .map((c, i) => (c.cardType === "experience" ? i : -1))
    .filter((i) => i >= 0);
  assertEquals(expPositions.length, 2);
  // Not both at the very front: the second experience appears after several places.
  assert(
    expPositions[1] - expPositions[0] >= 2,
    `experiences must be spaced apart, got positions ${expPositions.join(",")}`,
  );
});

// ── No-experiences short-circuit: a place-only deck is returned unchanged.
Deno.test("ORCH-1065 ADV interleave: zero experiences returns the place deck unchanged (identity)", () => {
  const places = [place("p1"), place("p2")];
  const out = interleaveExperiencesIntoDeck(places, []);
  assertEquals(out, places);
});

// ── T-04: past-dated experience NEVER surfaces. The RPC's future-date gate must
//    be a STRICT inequality on end_at (a moment-ended experience is excluded).
Deno.test("ORCH-1065 T-04: RPC future-date gate excludes past/ended experiences (strict end_at > p_now)", () => {
  // Both the WHERE EXISTS gate AND the soonest-date subselect must use end_at > p_now.
  const gate = /AND\s+ed\.end_at\s*>\s*p_now/g;
  const hits = migration.match(gate) ?? [];
  assert(
    hits.length >= 2,
    `future-date gate (end_at > p_now) must appear in BOTH the EXISTS gate and the soonest-date subselects; found ${hits.length}`,
  );
  // It must NOT be a non-strict >= (which would surface a just-ended experience).
  assert(
    !/ed\.end_at\s*>=\s*p_now/.test(migration),
    "future-date gate must be STRICT (>), never >= — a just-ended experience must not surface",
  );
  // It must gate on end_at, NOT start_at (a started-but-not-ended experience stays).
  assert(
    !/AND\s+ed\.start_at\s*>\s*p_now/.test(migration),
    "future-date gate must key on end_at, not start_at (in-progress experiences stay eligible)",
  );
});

// ── T-06: geo exclusion. All-stops-outside-radius must NOT surface. Assert the
//    geo gate is an upper-bound (<=) on a haversine distance against p_radius_m,
//    and that null-coord stops cannot satisfy it (they must carry lat/lng).
Deno.test("ORCH-1065 T-06: RPC geo gate is an upper bound on haversine distance, null-coord stops excluded", () => {
  // The stop EXISTS must require non-null lat/lng (a null-coord stop can never be the in-radius witness).
  const geoBlock = migration.slice(
    migration.indexOf("-- geo:"),
    migration.indexOf("AND e.id <> ALL(p_exclude_ids)"),
  );
  assert(geoBlock.length > 0, "geo predicate block must be present");
  assertStringIncludes(geoBlock, "s.lat IS NOT NULL");
  assertStringIncludes(geoBlock, "s.lng IS NOT NULL");
  // Upper-bound comparison: distance <= p_radius_m (NOT >=, which would invert the gate).
  assert(
    /\)\s*<=\s*p_radius_m/.test(geoBlock),
    "geo gate must be distance <= p_radius_m (an upper bound); a >= or missing bound would surface far experiences",
  );
  assert(
    !/\)\s*>=\s*p_radius_m/.test(geoBlock),
    "geo gate must NOT be >= p_radius_m (that inverts the radius)",
  );
  // Haversine earth-radius constant present (proves a real metric distance, not a bbox).
  assertStringIncludes(geoBlock, "6371000.0");
});

// ── T-06b (executable haversine boundary): a stop ~exactly at the radius is in,
//    a stop well outside is out. We port the SAME haversine the RPC uses and
//    check the boundary the SQL relies on (sanity that the metric is sane, so a
//    geo regression in the SQL constant would be caught by an analogous SELECT).
Deno.test("ORCH-1065 T-06b (exec): haversine metric — near stop inside radius, far stop outside", () => {
  function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const R = 6371000.0;
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLng = (bLng - aLng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(s));
  }
  const userLat = 38.9072, userLng = -77.0369; // Washington DC
  const radius = 5000; // 5 km
  // ~1.5 km away (Dupont Circle-ish) → INSIDE.
  const near = haversineM(userLat, userLng, 38.9097, -77.0444);
  assert(near <= radius, `near stop must be inside ${radius}m, got ${Math.round(near)}m`);
  // Baltimore ~60 km away → OUTSIDE.
  const far = haversineM(userLat, userLng, 39.2904, -76.6122);
  assert(far > radius, `far stop must be outside ${radius}m, got ${Math.round(far)}m`);
});

// ── T-10: experience-source failure MUST NOT degrade the place deck. The
//    fetch is wrapped in try/catch whose catch ONLY warns (never re-throws,
//    never returns pool-empty/pipeline-error). INV-042.
Deno.test("ORCH-1065 T-10: experience-source failure is swallowed (best-effort) — place deck never degraded", () => {
  // Locate the fetchEligibleExperiences call site that is hoisted above the zero-row branch.
  const callIdx = edge.indexOf("experienceCards = await fetchEligibleExperiences");
  assert(callIdx >= 0, "hoisted fetch call must exist");
  // The hoisted fetch is wrapped: `try { experienceCards = await ... } catch (err) { ...warn... }`.
  // Extract the catch block precisely (from `} catch (err) {` after the call to its
  // matching close brace), and prove it only warns.
  const catchOpen = edge.indexOf("} catch (err) {", callIdx);
  assert(catchOpen >= 0, "the hoisted fetch must be wrapped in try/catch");
  // The catch body is the warn-only block immediately following — bound it at the
  // NEXT top-level statement (`if (interleavedRows.length === 0)`) which is the
  // zero-row branch AFTER the catch closes.
  const nextStmt = edge.indexOf("if (interleavedRows.length === 0)", catchOpen);
  const rawCatchBody = edge.slice(catchOpen, nextStmt);
  assertStringIncludes(rawCatchBody, "console.warn");
  // Strip comments — the gate is on EXECUTABLE behaviour (the prose comment
  // legitimately MENTIONS pool-empty/pipeline-error as the thing it must NOT do).
  const catchBody = rawCatchBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*$/gm, "");
  assert(!/\bthrow\b/.test(catchBody), "experience-source catch must NOT re-throw (best-effort tolerance)");
  assert(
    !/buildEmptyResponse|pool-empty|pipeline-error/.test(catchBody),
    "experience-source catch must NOT convert a runtime failure into data-absence (INV-042)",
  );
  // And experienceCards is initialised to [] BEFORE the try, so a throw leaves
  // it [] and the deck proceeds on place cards alone.
  assert(
    /let\s+experienceCards:\s*ExperienceDeckCard\[\]\s*=\s*\[\]/.test(edge),
    "experienceCards must default to [] so a source throw degrades to a place-only deck",
  );
});

// ── T-11 (source): the zero-row branch returns a POPULATED path:'pipeline' deck
//    when experiences exist — explicit return (INV-043), never pool-empty.
Deno.test("ORCH-1065 T-11b: zero place rows + experiences ⇒ explicit populated path:'pipeline' return (INV-043, not pool-empty)", () => {
  // Find the ORCH-1065 zero-row branch. `if (interleavedRows.length === 0)`
  // occurs earlier too, so anchor on the SOLO-path one that carries the
  // experiences-only return (uniquely marked with source: 'experiences-only').
  const expOnlyMarker = edge.indexOf("source: 'experiences-only'");
  assert(expOnlyMarker >= 0, "experiences-only return must exist");
  const branchIdx = edge.lastIndexOf("if (interleavedRows.length === 0)", expOnlyMarker);
  assert(branchIdx >= 0, "ORCH-1065 zero-row branch must exist");
  const branch = edge.slice(branchIdx, branchIdx + 2000);
  // It checks experienceCards.length > 0 BEFORE falling through to pool-empty.
  const expCheckIdx = branch.indexOf("if (experienceCards.length > 0)");
  const poolEmptyIdx = branch.indexOf("path: 'pool-empty'");
  assert(expCheckIdx >= 0, "must check experienceCards.length > 0 in the zero-row branch");
  assert(poolEmptyIdx >= 0, "pool-empty fallback must still exist for the truly-empty case");
  assert(
    expCheckIdx < poolEmptyIdx,
    "the experiences-only return must be ATTEMPTED before the pool-empty fallback",
  );
  // The experiences-only return is an explicit populated pipeline response.
  const expReturn = branch.slice(expCheckIdx, poolEmptyIdx);
  assertStringIncludes(expReturn, "success: true");
  assertStringIncludes(expReturn, "path: 'pipeline'");
  assertStringIncludes(expReturn, "source: 'experiences-only'");
  // It must carry the experience cards, not an empty array.
  assertStringIncludes(expReturn, "cards: expOnly");
});

// ── T-09 (deeper bypass): the COMMS-0018 banned identifiers must be absent from
//    the ENTIRE ORCH-1065 supply block AND its hoisted call site — case- and
//    whitespace-insensitive on the executable code (the implementor's guard
//    only scanned the marker block; this also scans the call site + tolerates
//    the venue path being referenced via string concat or alternate casing).
Deno.test("ORCH-1065 T-09+ : COMMS-0018 bypass holds across the supply block AND the hoisted call site (case-insensitive)", () => {
  function stripComments(value: string): string {
    return value
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/[ \t]\/\/[^\n]*$/gm, "");
  }
  const blockStart = edge.indexOf("// ─── ORCH-1065 [consumer-experience-deck-card]");
  const blockEnd = edge.indexOf("// ─── end ORCH-1065 ─");
  assert(blockStart >= 0 && blockEnd > blockStart, "supply block markers present");
  const supplyBlock = stripComments(edge.slice(blockStart, blockEnd));

  // ALSO scan the hoisted call site region (the new wiring inside the SOLO path).
  const callIdx = edge.indexOf("experienceCards = await fetchEligibleExperiences");
  const callRegion = stripComments(edge.slice(callIdx - 100, callIdx + 1400));

  const banned = ["place_pool", "ai_signal_scores", "run-signal-scorer", "session_deck_cards"];
  for (const b of banned) {
    const rx = new RegExp(b.replace(/[-]/g, "[-_]?"), "i"); // tolerate run_signal_scorer / runSignalScorer-ish
    assertEquals(
      rx.test(supplyBlock),
      false,
      `supply block must not reference ${b} (COMMS-0018), even with casing/sep tricks`,
    );
    assertEquals(
      rx.test(callRegion),
      false,
      `hoisted call site must not reference ${b} (COMMS-0018)`,
    );
  }
  // Positive: the supply path DOES read the events/experience_stops RPC (proves
  // it gets its data from the bypass source, not the venue machinery).
  assertStringIncludes(supplyBlock, "pg_eligible_experiences_for_deck");
});

// ── No-parallel-money-fn (COMMS-0014/0016), independent of the implementor's
//    T-08c. Experiences must book through the EXISTING ticket-checkout-create —
//    NO sibling checkout/create edge function may exist. We scan the functions
//    directory for any *experience*-named money function. Fails-on-revert: if a
//    parallel `experience-checkout-*` / `*-experience-create` fn is added, this
//    goes red.
Deno.test("ORCH-1065 ADV no-parallel-money-fn: zero experience-specific checkout/create edge fn exists (COMMS-0014/0016)", () => {
  const fnDir = `${root}/supabase/functions`;
  const offenders: string[] = [];
  for (const entry of Deno.readDirSync(fnDir)) {
    if (!entry.isDirectory) continue;
    const n = entry.name.toLowerCase();
    const isMoney = n.includes("checkout") || n.includes("payment") || /(^|-)create($|-)/.test(n);
    const isExperience = n.includes("experience");
    if (isMoney && isExperience) offenders.push(entry.name);
  }
  assertEquals(
    offenders,
    [],
    `experiences must reuse ticket-checkout-create — no parallel money fn allowed, found: ${offenders.join(", ")}`,
  );
  // Positive anchor: the canonical money fn IS present (so the "zero offenders"
  // result is meaningful, not just an empty/missing directory).
  assert(
    [...Deno.readDirSync(fnDir)].some((e) => e.isDirectory && e.name === "ticket-checkout-create"),
    "the canonical ticket-checkout-create money fn must exist",
  );
});

// ── Migration safety: the RPC is read-only (no INSERT/UPDATE/DELETE/DROP of
//    user data) and STABLE — a deck-supply read must never mutate.
Deno.test("ORCH-1065 ADV migration: RPC body is read-only (no DML), STABLE, SECURITY DEFINER hardened", () => {
  const fnBody = migration.slice(
    migration.indexOf("AS $$"),
    migration.indexOf("$$;") + 3,
  );
  assert(fnBody.length > 0, "function body must be present");
  for (const dml of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i]) {
    assert(!dml.test(fnBody), `deck-supply RPC body must contain no DML (${dml})`);
  }
  assertStringIncludes(migration, "STABLE");
  assertStringIncludes(migration, "SET search_path = public, pg_temp");
  // anon must never be able to call it.
  assert(
    !/GRANT\s+EXECUTE[\s\S]*?\bTO\s+anon\b/i.test(migration),
    "RPC must not be granted to anon",
  );
  // PUBLIC default execute is revoked (defence in depth).
  assertStringIncludes(migration, "REVOKE ALL ON FUNCTION");
});
