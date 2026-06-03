import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-1062 Part 2 [vibe-category-pills] — TESTER-OWNED ADVERSARIAL test.
//
// Attacks DIFFERENT angles than the implementor's happy-path
// (orch_1062_vibe_category_signals.test.ts, which only asserts presence + value):
//
//   (a) SC-10 — the `romantic` CATEGORY (a CATEGORY_TO_SIGNAL key) and the
//       `romantic` INTENT (a SESSION_INTENT_IDS member) must NOT collide in
//       resolution. They live in two different dictionaries, travel in two
//       different request fields (categories[] vs intents[]), and `lively` /
//       `scenic` must NOT have leaked into the curated-intent set.
//   (b) filterMin BOUNDARY enforcement — the RPC filters
//       `place_scores.score >= p_filter_min` (baseline_squash_orch_0729.sql:
//       `AND ps.score >= p_filter_min`). So a place scoring strictly below the
//       floor is EXCLUDED and one at/above is INCLUDED. We parse the EXACT
//       filterMin from source and assert the boundary predicate: 59 out / 60 in
//       (romantic, scenic), 119 out / 120 in (lively). A filterMin regression
//       (e.g. someone bumping romantic to 120) flips these and fails.
//   (c) display-name AND slug keys both resolve to the SAME entry — no drift
//       between the two aliases, and the resolution does NOT depend on an
//       uppercase-slug key existing (deckService lowercases input).
//
// Source-text parse pattern (index.ts calls serve() at module load, so we read
// it as text — same established pattern as the implementor's test + the
// orch_0909 adversarial test).
// ─────────────────────────────────────────────────────────────────────────────

const root = new URL("../../../..", import.meta.url).pathname;
const edge = await Deno.readTextFile(
  `${root}/supabase/functions/discover-cards/index.ts`,
);

type Entry = { signal: string; filterMin: number; display: string };

function entryFor(key: string): Entry | undefined {
  // Anchor on the key, then read signalIds[0], filterMin, displayCategory.
  // Escape regex metacharacters in the key (none in our keys, but be safe).
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `['"]${safe}['"]\\s*:\\s*\\{\\s*signalIds:\\s*\\[\\s*['"]([a-z_]+)['"]\\s*\\]\\s*,\\s*filterMin:\\s*(\\d+)\\s*,\\s*displayCategory:\\s*['"]([^'"]+)['"]`,
  );
  const m = edge.match(re);
  if (!m) return undefined;
  return { signal: m[1], filterMin: Number(m[2]), display: m[3] };
}

// Parse the SESSION_INTENT_IDS Set literal so we test the ACTUAL source, not a
// hand-copied list.
function sessionIntentIds(): Set<string> {
  const block = edge.match(/SESSION_INTENT_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assertExists(block, "could not locate SESSION_INTENT_IDS literal in index.ts");
  const ids = [...block![1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]);
  return new Set(ids);
}

const VIBES = [
  { slug: "romantic", display: "Romantic", signal: "romantic", floor: 60 },
  { slug: "lively", display: "Lively", signal: "lively", floor: 120 },
  { slug: "scenic", display: "Scenic", signal: "scenic", floor: 60 },
] as const;

// ── (a) SC-10: category `romantic` vs intent `romantic` do NOT collide ───────

Deno.test("ADV SC-10: `romantic` is BOTH a category AND a curated intent, in separate dictionaries", () => {
  const intents = sessionIntentIds();
  // The intent set carries `romantic` (curated path).
  assert(
    intents.has("romantic"),
    "SESSION_INTENT_IDS should still carry the curated 'romantic' intent",
  );
  // The category dictionary ALSO carries `romantic` (single-card path).
  const cat = entryFor("romantic");
  assertExists(cat, "CATEGORY_TO_SIGNAL should carry the 'romantic' category");
  // They are two distinct concerns: the category resolves to a {signal,filterMin}
  // serving target; the intent is a bare id routed to the curated experiences
  // path that NEVER reads CATEGORY_TO_SIGNAL. The category having a filterMin and
  // the intent being a bare id is the proof they don't share a resolution slot.
  assertEquals(cat!.signal, "romantic");
  assertEquals(cat!.filterMin, 60);
});

Deno.test("ADV SC-10: the vibe CATEGORIES `lively` and `scenic` did NOT leak into the curated-intent set", () => {
  const intents = sessionIntentIds();
  // Only `romantic` overlaps (by design). `lively`/`scenic` are category-only;
  // if either leaked into SESSION_INTENT_IDS the curated path would mis-route them.
  assert(!intents.has("lively"), "'lively' must NOT be a curated intent");
  assert(!intents.has("scenic"), "'scenic' must NOT be a curated intent");
});

Deno.test("ADV SC-10: curated-intent set is exactly the 6 shipped intents (no accidental category bleed)", () => {
  const intents = sessionIntentIds();
  const expected = new Set([
    "adventurous",
    "first-date",
    "romantic",
    "group-fun",
    "picnic-dates",
    "take-a-stroll",
  ]);
  assertEquals(
    [...intents].sort(),
    [...expected].sort(),
    "SESSION_INTENT_IDS drifted — a category may have leaked into the intent path",
  );
});

// ── (b) filterMin BOUNDARY enforcement (the RPC's `score >= p_filter_min`) ───

// Mirror the RPC predicate exactly: baseline_squash_orch_0729.sql filters
// `AND ps.score >= p_filter_min`. INCLUDED iff score >= floor.
function includedByRpc(score: number, floor: number): boolean {
  return score >= floor;
}

Deno.test("ADV filterMin: a place scoring JUST UNDER the floor is EXCLUDED; AT/OVER is INCLUDED", () => {
  for (const v of VIBES) {
    const e = entryFor(v.slug);
    assertExists(e, `missing CATEGORY_TO_SIGNAL entry for ${v.slug}`);
    const floor = e!.filterMin;
    // Guard: floor must be the operator-locked value (catches a silent retune
    // that would change which places serve).
    assertEquals(floor, v.floor, `${v.slug} filterMin must be ${v.floor}`);

    // Strictly below floor → excluded.
    assert(
      !includedByRpc(floor - 1, floor),
      `${v.slug}: score ${floor - 1} (just under ${floor}) should be EXCLUDED`,
    );
    // Exactly at floor → included (>= is inclusive).
    assert(
      includedByRpc(floor, floor),
      `${v.slug}: score ${floor} (at floor) should be INCLUDED`,
    );
    // Just over floor → included.
    assert(
      includedByRpc(floor + 1, floor),
      `${v.slug}: score ${floor + 1} (just over ${floor}) should be INCLUDED`,
    );
  }
});

Deno.test("ADV filterMin: explicit named boundaries — romantic/scenic 59 out 60 in, lively 119 out 120 in", () => {
  // These are the exact values named in the TEST dispatch. They are pinned to
  // the parsed source floors so a regression in CATEGORY_TO_SIGNAL trips this.
  const romantic = entryFor("romantic")!;
  const scenic = entryFor("scenic")!;
  const lively = entryFor("lively")!;

  assert(!includedByRpc(59, romantic.filterMin), "romantic 59 must be excluded");
  assert(includedByRpc(60, romantic.filterMin), "romantic 60 must be included");

  assert(!includedByRpc(59, scenic.filterMin), "scenic 59 must be excluded");
  assert(includedByRpc(60, scenic.filterMin), "scenic 60 must be included");

  assert(!includedByRpc(119, lively.filterMin), "lively 119 must be excluded");
  assert(includedByRpc(120, lively.filterMin), "lively 120 must be included");
});

Deno.test("ADV filterMin: the RPC source still filters `score >= p_filter_min` (predicate contract intact)", () => {
  // If this WHERE clause is ever loosened to `>` or removed, the boundary tests
  // above stop reflecting real serving. Pin the SQL predicate too.
  const sql = Deno.readTextFileSync(
    `${root}/supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`,
  );
  assert(
    /ps\.score\s*>=\s*p_filter_min/.test(sql),
    "query_servable_places_by_signal must filter `ps.score >= p_filter_min`",
  );
});

// ── (c) display-name AND slug both resolve, to the SAME entry, no case-leak ──

Deno.test("ADV alias: slug key and display-name key resolve to the IDENTICAL entry (no drift)", () => {
  for (const v of VIBES) {
    const bySlug = entryFor(v.slug);
    const byDisplay = entryFor(v.display);
    assertExists(bySlug, `missing slug key '${v.slug}'`);
    assertExists(byDisplay, `missing display-name key '${v.display}'`);
    // Same signal, same floor, same displayCategory — the two aliases must NOT
    // drift apart (a partial edit to only one side is a real defect).
    assertEquals(bySlug!.signal, byDisplay!.signal, `${v.slug} signal drift`);
    assertEquals(bySlug!.filterMin, byDisplay!.filterMin, `${v.slug} floor drift`);
    assertEquals(bySlug!.display, byDisplay!.display, `${v.slug} display drift`);
    // And both must point at the vibe's own signal.
    assertEquals(bySlug!.signal, v.signal);
  }
});

Deno.test("ADV alias: resolution does NOT rely on an uppercase-SLUG key (deckService lowercases input)", () => {
  // Only the lowercase slug + the TitleCase display name are keyed. An ALL-CAPS
  // slug key must NOT exist — its presence would mean a redundant/incoherent
  // alias and mask a deckService normalization bug.
  assertEquals(
    entryFor("ROMANTIC"),
    undefined,
    "no ALL-CAPS 'ROMANTIC' key should exist in CATEGORY_TO_SIGNAL",
  );
  assertEquals(entryFor("LIVELY"), undefined);
  assertEquals(entryFor("SCENIC"), undefined);
});

Deno.test("ADV alias: each vibe entry is single-signal (I-SIGNALIDS-ALWAYS-ARRAY, length 1)", () => {
  // The vibe categories are rank-style single-signal — NOT unions. A regression
  // turning one into a multi-signal union would change serving silently.
  for (const v of VIBES) {
    const re = new RegExp(
      `['"]${v.slug}['"]\\s*:\\s*\\{\\s*signalIds:\\s*\\[([^\\]]*)\\]`,
    );
    const m = edge.match(re);
    assertExists(m, `could not parse signalIds array for ${v.slug}`);
    const count = [...m![1].matchAll(/['"][a-z_]+['"]/g)].length;
    assertEquals(count, 1, `${v.slug} must be single-signal (got ${count})`);
  }
});
