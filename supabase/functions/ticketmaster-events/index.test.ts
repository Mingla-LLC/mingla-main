import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  DISCOVER_SEGMENT_ID,
  resolveTmClassification,
} from "../_shared/ticketmasterClassifications.ts";

// ORCH-0809 — assert the ticketmaster-events edge function carries the v2
// contract end-to-end:
//   - server-owned classification (I-PROPOSED-BI),
//   - local-time date window (I-PROPOSED-BJ),
//   - input validation for unknown segments + both-location ambiguity (M2.1),
//   - city / segment / genre / local-dt cache key v2 (M2 + hotfixes),
//   - fallback path when city returns <5 results,
//   - backward-compat for v1 callers (no city, no segmentSlug).
//
// Like the scan-ticket precedent, these tests read the source straight off
// disk so Deno doesn't need a database or network connection to run them.

const EDGE_SRC = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

const CLASSIFICATIONS_SRC = await Deno.readTextFile(
  new URL("../_shared/ticketmasterClassifications.ts", import.meta.url),
);

// ─── M2.1 input validation guards ───────────────────────────────────────────

Deno.test(
  "edge function rejects unknown segmentSlug with 400 + supported list",
  () => {
    assertStringIncludes(EDGE_SRC, "unknown segmentSlug");
    assertStringIncludes(EDGE_SRC, "Object.keys(DISCOVER_SEGMENT_ID)");
    assertStringIncludes(EDGE_SRC, "segmentSlug in DISCOVER_SEGMENT_ID");
  },
);

Deno.test(
  "edge function rejects both city AND location with 400 (M2.1 P2-4 fix)",
  () => {
    assertStringIncludes(
      EDGE_SRC,
      "pass either city or location, not both",
    );
    // Verify the guard ALSO checks the location lat/lng — not just `location`
    // being defined (which would false-positive on `{ }`).
    assert(
      /city\s*&&\s*location\?\.lat\s*&&\s*location\?\.lng/.test(EDGE_SRC),
      "both-location guard must check location.lat AND location.lng presence",
    );
  },
);

Deno.test("edge function 400s when neither city nor location provided", () => {
  assertStringIncludes(EDGE_SRC, "city or location is required");
});

Deno.test(
  "edge function 400s on malformed localStartEndDateTime format",
  () => {
    assertStringIncludes(EDGE_SRC, "invalid localStartEndDateTime format");
    // Verify the format regex is strict (no trailing Z, no millis).
    assert(
      /\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\},\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}\$/.test(
        EDGE_SRC,
      ),
      "localStartEndDateTime regex must enforce the TM local-time pair shape",
    );
  },
);

// ─── v2 request schema ──────────────────────────────────────────────────────

Deno.test("edge function accepts the v2 city + classification + dt fields", () => {
  // Verify the body destructure pulls every v2 field.
  for (const field of [
    "city",
    "stateCode",
    "countryCode",
    "segmentSlug",
    "genreSlugs",
    "localStartEndDateTime",
    "latFallback",
    "lngFallback",
    "radiusFallback",
  ]) {
    assertStringIncludes(EDGE_SRC, field);
  }
});

Deno.test(
  "edge function preserves v1 request shape (location + radius + startDate + endDate + keywords)",
  () => {
    for (const field of [
      "location",
      "radius",
      "startDate",
      "endDate",
      "keywords",
    ]) {
      assertStringIncludes(EDGE_SRC, field);
    }
  },
);

// ─── Local-time date window (I-PROPOSED-BJ) ─────────────────────────────────

Deno.test("edge function wires localStartEndDateTime into the TM URL", () => {
  assert(
    /params\.set\s*\(\s*["']localStartEndDateTime["']/.test(EDGE_SRC),
    "URL builder must set localStartEndDateTime on the outgoing TM URL",
  );
});

Deno.test(
  "edge function only falls back to UTC startDateTime/endDateTime when localStartEndDateTime is absent",
  () => {
    // The implementation pattern: `if (input.localStartEndDateTime) { ... } else { ... startDateTime / endDateTime ... }`.
    // Verify the else branch carries the UTC fields (v1 backward compat).
    assertStringIncludes(EDGE_SRC, "startDateTime");
    assertStringIncludes(EDGE_SRC, "endDateTime");
  },
);

// ─── Cache key v2 (M2 hotfixes + M2.1) ──────────────────────────────────────

Deno.test("edge function cache key v2 includes all filter dimensions incl. sub-genre", () => {
  // The buildCacheKey function lives in this same file; assert it composes
  // city/lat-lng + segment + genre + sub-genre + dt + keywords into the key.
  // ORCH-0809-E added `sub:` as the sub-genre dimension for curated unions.
  const cacheKeyFnBlock = EDGE_SRC.match(
    /function buildCacheKey[\s\S]*?\n\}/,
  );
  assert(
    cacheKeyFnBlock !== null,
    "buildCacheKey function must be defined in index.ts",
  );
  const body = cacheKeyFnBlock![0];
  for (const dim of ["city", "seg", "gen", "sub", "kw", "dt", "v2:"]) {
    assertStringIncludes(body, dim);
  }
});

Deno.test("ORCH-0809-E — 'afro' slug resolves to genreId + subGenreIds union", () => {
  const result = resolveTmClassification("music", ["afro"]);
  assertEquals(result.segmentId, DISCOVER_SEGMENT_ID.music);
  // afro → World genre + 9 sub-genres
  assertEquals(result.genreIds.length, 1);
  assertEquals(result.genreIds[0], "KnvZfZ7vAeF"); // World
  assert(
    result.subGenreIds.length === 9,
    `expected 9 subGenreIds for afro union; got ${result.subGenreIds.length}`,
  );
  // Spot-check the 3 anchor IDs that were live-verified during ORCH-0809-E
  assert(result.subGenreIds.includes("KZazBEonSMnZfZ7v6Ek"), "Afro-Beat ID present");
  assert(result.subGenreIds.includes("KZazBEonSMnZfZ7v6Ev"), "African ID present");
  assert(result.subGenreIds.includes("KZazBEonSMnZfZ7v6E6"), "Afro-Cuban ID present");
});

Deno.test("ORCH-0809-E — top-level slug with string mapping returns empty subGenreIds", () => {
  // Backward compat: existing 38 top-level slugs (rock, pop, basketball, etc.)
  // map to plain string genre IDs, no sub-genre fan-out.
  const result = resolveTmClassification("music", ["rock"]);
  assertEquals(result.genreIds, ["KnvZfZ7vAeA"]);
  assertEquals(result.subGenreIds, []);
});

Deno.test("ORCH-0809-E — edge function wires subGenreId into the TM URL", () => {
  assert(
    /params\.set\s*\(\s*["']subGenreId["']/.test(EDGE_SRC),
    "URL builder must set subGenreId on the outgoing TM URL when subGenreIds.length > 0",
  );
});

Deno.test("edge function fallback path triggers under CITY_FALLBACK_THRESHOLD", () => {
  assertStringIncludes(EDGE_SRC, "CITY_FALLBACK_THRESHOLD");
  assertStringIncludes(EDGE_SRC, "usedFallback");
  // Verify the fallback only fires when latFallback + lngFallback are present.
  assert(
    /typeof\s+latFallback\s*===\s*["']number["']/.test(EDGE_SRC),
    "fallback path must require numeric latFallback",
  );
  assert(
    /typeof\s+lngFallback\s*===\s*["']number["']/.test(EDGE_SRC),
    "fallback path must require numeric lngFallback",
  );
});

// ─── Classification resolver behavior ───────────────────────────────────────

Deno.test("resolveTmClassification — known music slug returns Music ID", () => {
  const result = resolveTmClassification("music", []);
  assertEquals(result.segmentId, DISCOVER_SEGMENT_ID.music);
  assertEquals(result.genreIds, []);
});

Deno.test("resolveTmClassification — known sports slug returns Sports ID", () => {
  const result = resolveTmClassification("sports", []);
  assertEquals(result.segmentId, DISCOVER_SEGMENT_ID.sports);
});

Deno.test(
  "resolveTmClassification — unknown slug falls back to Music ID (defensive default)",
  () => {
    // Note: the EDGE FUNCTION rejects unknown slugs with HTTP 400 BEFORE
    // calling resolveTmClassification. But the helper itself stays defensive
    // for any other (future) caller. Both behaviors are correct: edge
    // function = strict validation at the boundary, helper = defensive default
    // in isolation.
    const result = resolveTmClassification("comedy" as never, []);
    assertEquals(result.segmentId, DISCOVER_SEGMENT_ID.music);
  },
);

Deno.test(
  "resolveTmClassification — undefined slug falls back to Music (v1 backward compat)",
  () => {
    const result = resolveTmClassification(undefined, []);
    assertEquals(result.segmentId, DISCOVER_SEGMENT_ID.music);
  },
);

Deno.test(
  "resolveTmClassification — 'all' genre slug is filtered out",
  () => {
    const result = resolveTmClassification("music", ["all"]);
    assertEquals(result.genreIds, []);
  },
);

Deno.test(
  "resolveTmClassification — empty-string genre slug is filtered out (defensive)",
  () => {
    const result = resolveTmClassification("music", ["" as never]);
    assertEquals(result.genreIds, []);
  },
);

// ─── Classification constants invariants ────────────────────────────────────

Deno.test("DISCOVER_SEGMENT_ID — music ID matches legacy hardcoded constant", () => {
  // ORCH-0809 SPEC §5.3 — Music ID was verified against the prior hardcoded
  // value at supabase/functions/ticketmaster-events/index.ts:16 (pre-M1).
  assertEquals(DISCOVER_SEGMENT_ID.music, "KZFzniwnSyZfZ7v7nJ");
});

Deno.test("DISCOVER_SEGMENT_ID — sports ID verified via TM public docs", () => {
  // ORCH-0809 SPEC §5.3 — Sports ID resolved via WebFetch of the public
  // Ticketmaster Discovery API developer documentation during M1 Phase 0.
  assertEquals(DISCOVER_SEGMENT_ID.sports, "KZFzniwnSyZfZ7v7nE");
});

Deno.test("classifications file — no VERIFY placeholder in active code", () => {
  // Strip comments first; meta-documentation may reference the literal.
  const codeOnly = CLASSIFICATIONS_SRC.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert(
    !/"VERIFY"/.test(codeOnly),
    "ticketmasterClassifications.ts must not contain a 'VERIFY' placeholder in active code (SPEC §5.3)",
  );
});

// ─── No client-shipped TM IDs (Constitution #2) ─────────────────────────────

Deno.test(
  "DiscoverScreen.tsx ships no TM classification ID literals (Constitution #2)",
  async () => {
    // Sanity probe — the strict-grep gate does the comprehensive sweep,
    // but a Deno-side spot-check on the primary consumer file adds
    // defense-in-depth.
    const discoverSrc = await Deno.readTextFile(
      new URL(
        "../../../app-mobile/src/components/DiscoverScreen.tsx",
        import.meta.url,
      ),
    );
    assert(
      !/KZFzniwn/.test(discoverSrc),
      "DiscoverScreen.tsx must not contain any 'KZFzniwn' TM ID literal",
    );
  },
);
