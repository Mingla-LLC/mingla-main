# SPEC — ORCH-0677 — Picnic-Dates Stuck-Curating Fix Bundle

**Status:** BINDING. Spec writer: /mingla-forensics SPEC mode.
**Investigation:** [reports/INVESTIGATION_ORCH-0677_PICNIC_DATES_STUCK_CURATING.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0677_PICNIC_DATES_STUCK_CURATING.md)
**Dispatch:** [prompts/SPEC_ORCH-0677_PICNIC_DATES_FIX_BUNDLE.md](Mingla_Artifacts/prompts/SPEC_ORCH-0677_PICNIC_DATES_FIX_BUNDLE.md)
**Implementor must follow this verbatim. Tester must verify every §6 test case.**

---

## §0 Layman Summary

Picnic-dates is the only curated intent built on a reverse-anchor algorithm with a single combo. When the user's location pulls a remote park to the top of the picnic_friendly ranking and that park has no qualifying grocery within 3km, the assembly loop **picks the same dead anchor every retry** and returns 0 cards. Compounding this, the mobile deck treats curated-only empty results as **still loading** instead of empty — so the user sees "Curating your lineup" forever.

This spec binds **two surgical fixes** plus three ride-along cleanups. Both fixes ship together: the backend fix alone leaves users on EMPTY with no clear next action; the frontend fix alone leaves picnic emitting fewer cards than it should.

---

## §1 Scope & Non-Goals

### In scope
- **RC-1 backend** — track failed anchors per request so the assembly loop progresses through candidates instead of cycling.
- **RC-2 frontend** — make curated-only empty results route to EMPTY UI state, not INITIAL_LOADING.
- **D-3-new edge fn** — derive curated stop `isOpenNow` from real opening hours (Constitutional #9 cleanup).
- **D-1 CI gate** — prevent future `reverseAnchor + single combo` regressions.
- **D-2 ride-along** — remove ORCH-0653.v4 transitional `_gateCounts` instrumentation.

### Non-goals
- Groceries signal tuning (D-4-new — separate ORCH).
- Hours-filter retrofit (ORCH-0644 — separate spec).
- Reverse-anchor algorithm rewrite (only the failure-tracking patch).
- Mobile state-machine refactor (only the EMPTY-routing patch).
- New EMPTY sub-state or intent-aware copy (UX follow-up; reuse existing EMPTY).
- Localization of new server-emitted strings (`emptyReason` is a code, not user copy).

### Assumptions (declared explicitly)
- A1 — Architecture A (failedAnchorIds Set) is chosen over Architecture B (pre-validated nearest-viable). Rationale: surgical (~5 LOC), preserves quality ranking, no extra RPC calls per request, easier to test. Trade-off: when a remote anchor wins ranking, the user may see a remote picnic spot before failure-tracking guarantees variety on subsequent loads — acceptable given quality preference.
- A2 — `summary.emptyReason` is additive on the response. Legacy mobile builds ignore unknown fields per JSON forward-compat.
- A3 — Existing EMPTY UI state and copy are reused. UX may iterate on intent-aware copy later as a separate ORCH.
- A4 — All edits stay within the same git commit boundary; edge fn and mobile changes ship in two commits (edge fn first, mobile second), but both must land before user-visible release.

---

## §2 Database Layer

**No DB changes.** No migration. No RLS edit. No table or column added/altered.

The RPC `fetch_local_signal_ranked` and `query_servable_places_by_signal` remain unchanged. Verified via `pg_proc` probe during investigation.

---

## §3 Edge Function Layer — `generate-curated-experiences`

File: [supabase/functions/generate-curated-experiences/index.ts](supabase/functions/generate-curated-experiences/index.ts)

### §3.1 RC-1 fix — Failed-Anchor Tracking (Architecture A)

**Add:** new `Set<string>` named `failedAnchorIds` at the same scope as `globalUsedPlaceIds` (currently declared at line 791).

```ts
const globalUsedPlaceIds = new Set<string>();
const failedAnchorIds = new Set<string>();   // NEW — ORCH-0677 RC-1
```

**Modify:** the anchor-candidate filter inside the reverse-anchor branch (currently line 824). Add a second filter clause for `failedAnchorIds`:

```ts
const anchorPlaces = (categoryPlaces[anchorCatId] || []).filter(p => {
  return !comboUsedIds.has(p.google_place_id)
    && !failedAnchorIds.has(p.google_place_id);   // NEW — ORCH-0677 RC-1
});
```

**Modify:** every gate site that fails the current iteration in the reverse-anchor branch must mark the anchor as failed BEFORE `valid = false`:

| Gate site (current line) | Branch | Required addition |
|--------------------------|--------|-------------------|
| `reverseAnchor_no_anchor` (~line 829) | `if (anchorPlaces.length === 0)` | No anchor was even selected — nothing to mark. Set a request-level flag `noAnchorsExhausted = true` for §3.2. |
| `reverseAnchor_no_available` (~line 869) | `if (available.length === 0 && !stopDef.optional)` for non-anchor stop | `failedAnchorIds.add(anchor.google_place_id);` BEFORE `valid = false; break;` |
| `reverseAnchor_no_place` (~line 877) | `if (!place && !stopDef.optional)` | `failedAnchorIds.add(anchor.google_place_id);` BEFORE `valid = false; break;` |
| `required_stops_short` (~line 949) | post-stop validation | If `hasReverseAnchor && stops.find(s => s.role === picnicSpotRole)` exists, `failedAnchorIds.add(picnicSpotPlaceId);` BEFORE `continue;` |
| `travel_constraint` (~line 962) | first-stop travel-time gate | If reverse-anchor combo, `failedAnchorIds.add(anchor.google_place_id);` BEFORE `continue;` |
| `duplicate_place_ids` (~line 970) | duplicate check | If reverse-anchor combo, `failedAnchorIds.add(anchor.google_place_id);` BEFORE `continue;` |

**Why all six gates:** any failure path that does not result in a successful card build must mark the anchor as exhausted, otherwise the next iteration re-picks it. Missing even one gate re-opens the dead-cycle bug.

**Standard branch unchanged.** failedAnchorIds is referenced ONLY inside `if (hasReverseAnchor)`. Standard non-reverse-anchor types must not be impacted.

### §3.2 RC-2 support — Explicit Empty Verdict

**Modify:** the function return path at the end of the request handler. Currently the response shape is `{ cards: CuratedExperienceCard[] }`. Extend to:

```ts
type CuratedResponse = {
  cards: CuratedExperienceCard[];
  summary?: {
    emptyReason: 'no_viable_anchor' | 'pool_empty' | 'pipeline_error';
    candidateAnchorCount: number;
    failedAnchorCount: number;
  };
};
```

**`summary` is optional.** When `cards.length > 0`, omit the `summary` field entirely (legacy shape preserved).

**When `cards.length === 0`, populate `summary` with exactly one of:**

| `emptyReason` | Triggered when | `candidateAnchorCount` | `failedAnchorCount` |
|---------------|----------------|------------------------|---------------------|
| `pool_empty` | Reverse-anchor: `categoryPlaces[anchorCategoryId].length === 0`. Standard: ALL categories returned 0 candidates. | `0` | `0` |
| `no_viable_anchor` | Reverse-anchor only: anchors existed but every candidate failed (`failedAnchorIds.size > 0` and the loop exited with cards empty). | size of original anchor list | `failedAnchorIds.size` |
| `pipeline_error` | Caught exception path (RPC throw, missing signal definition, etc.). Caller chose `emptyReason` instead of throwing for backwards-compat. | best-effort count or `0` | `0` |

For non-reverse-anchor empty results today (standard branch), use `pool_empty` as the verdict (pre-existing behavior; this is the first time it's externalized).

### §3.3 D-3-new fix — Truthful `isOpenNow`

**Locate:** every site that emits `isOpenNow` on a curated stop. Run this grep and address every match:
```
grep -n "isOpenNow" supabase/functions/generate-curated-experiences/index.ts
```

For each emission site, replace the current source value with derivation logic:

```ts
const isOpenNow: boolean | null = (() => {
  if (place.opening_hours?.openNow === true || place.opening_hours?.openNow === false) {
    return place.opening_hours.openNow;   // Google v1 reports it directly
  }
  // Fall through: if Google didn't compute openNow, do not fabricate.
  return null;
})();
```

**Type contract:** `isOpenNow` becomes `boolean | null` (was `boolean`). Mobile `CuratedExperienceCard.stops[i].isOpenNow` type must widen accordingly. Any consumer that branches on `isOpenNow === true` continues to work; consumers that branch on `=== false` must NOT treat `null` as "closed". Spec writer's note: this is a Constitutional #9 cleanup — fabrication is the bug. `null` is the honest absence.

**No fallback to `true`.** If openingHours data is missing, the value is `null`, not `true`.

### §3.4 D-2 ride-along — Remove ORCH-0653.v4 Transitional Instrumentation

**Delete:** the `_gateCounts` accumulator block (currently lines 796-808) and the `SUMMARY` console.error (line 1019).

**Replace with:** nothing in production paths. The `summary.failedAnchorCount` and `summary.emptyReason` from §3.2 supersede the transitional counters. Per Constitutional #8 "Subtract before adding" — the new summary is the addition; the deletion satisfies the subtract.

### §3.5 Edge Function Response Schema (binding)

```ts
// Successful response (cards present)
{
  cards: CuratedExperienceCard[]   // length >= 1, sorted by edge fn assembly order
}

// Empty response (must always include summary)
{
  cards: [],
  summary: {
    emptyReason: 'no_viable_anchor' | 'pool_empty' | 'pipeline_error',
    candidateAnchorCount: number,
    failedAnchorCount: number
  }
}
```

HTTP status remains `200` for both shapes. Errors that cannot recover still throw and result in HTTP 5xx (existing contract preserved per ORCH-0653 Constitution #3 throws).

---

## §4 Mobile Service Layer — `deckService.ts`

File: [app-mobile/src/services/deckService.ts](app-mobile/src/services/deckService.ts)

### §4.1 Type Extension

**Add** to `DeckResponse` type definition (search for `interface DeckResponse` or similar):

```ts
export type CuratedEmptyReason = 'no_viable_anchor' | 'pool_empty' | 'pipeline_error';

export interface DeckResponse {
  cards: Recommendation[];
  deckMode: ...;
  activePills: string[];
  total: number;
  hasMore: boolean;
  serverPath: DeckServerPath;
  curatedEmptyReason?: CuratedEmptyReason;   // NEW — ORCH-0677 RC-2
}
```

### §4.2 Curated Empty Resolution

**Modify:** the `fetchDeck` return path at line 676-683.

Two changes:

#### Change 1 — Capture per-pill empty reasons during the curated promise loop

Inside `curatedPromise` (currently lines 471-498), each `curatedExperiencesService.generateCuratedExperiences(...)` call must surface the response's optional `summary.emptyReason`:

```ts
// Inside curatedPills.map(async (pill) => {...})
try {
  const response = await curatedExperiencesService.generateCuratedExperiences({...});
  // response shape: { cards, summary? }
  if (response.cards.length === 0 && response.summary) {
    pillEmptyReasons.set(pill.id, response.summary.emptyReason);
  }
  return response.cards.map(curatedToRecommendation);
} catch (err) {
  console.warn(`[DeckService] Curated pill ${pill.id} failed:`, err);
  pillEmptyReasons.set(pill.id, 'pipeline_error');
  return [];
}
```

`pillEmptyReasons` is a `Map<string, CuratedEmptyReason>` declared in the outer `fetchDeck` scope.

**Note for implementor:** `curatedExperiencesService.generateCuratedExperiences` currently returns `CuratedExperienceCard[]` directly. The implementor must update its signature to return `{ cards: CuratedExperienceCard[]; summary?: { emptyReason, candidateAnchorCount, failedAnchorCount } }`. All callers must be updated.

#### Change 2 — Set `hasMoreFromEdge` and `curatedEmptyReason` on curated-only empty

Replace lines 676-683 with:

```ts
// ORCH-0677 RC-2: when curated-only deck returns empty, route to EMPTY UI
// state instead of INITIAL_LOADING. Pre-fix, hasMoreFromEdge stayed true and
// the EMPTY branch in RecommendationsContext never fired.
const isCuratedOnly = curatedPills.length > 0 && categoryPills.length === 0;
const aggregatedCuratedEmptyReason: CuratedEmptyReason | undefined = (() => {
  if (!isCuratedOnly || interleaved.length > 0) return undefined;
  // All pills empty. Pick the most informative reason; precedence:
  //   pipeline_error > no_viable_anchor > pool_empty
  const reasons = Array.from(pillEmptyReasons.values());
  if (reasons.includes('pipeline_error')) return 'pipeline_error';
  if (reasons.includes('no_viable_anchor')) return 'no_viable_anchor';
  if (reasons.includes('pool_empty')) return 'pool_empty';
  return 'pool_empty';   // legacy edge fn omitted summary — assume pool_empty
})();

if (aggregatedCuratedEmptyReason) {
  hasMoreFromEdge = false;
}

return {
  cards: interleaved,
  deckMode,
  activePills: pills.map(p => p.id),
  total: interleaved.length,
  hasMore: hasMoreFromEdge,
  serverPath: finalServerPath,
  curatedEmptyReason: aggregatedCuratedEmptyReason,
};
```

**Mixed decks (categories AND curated) are unaffected.** When `categoryPills.length > 0`, the standard hasMoreFromEdge logic applies — the existing pagination contract continues.

---

## §5 Mobile Hook Layer — `useDeckCards.ts`

File: [app-mobile/src/hooks/useDeckCards.ts](app-mobile/src/hooks/useDeckCards.ts)

### §5.1 Return Shape Extension

Modify the `useMemo` return (line 244-256):

```ts
return useMemo(() => ({
  cards,
  deckMode: query.data?.deckMode ?? 'curated',
  activePills,
  isLoading: query.isLoading,
  isFetching: query.isFetching,
  isPlaceholderData: query.isPlaceholderData,
  isFullBatchLoaded: !query.isLoading && !query.isFetching && hasData,
  hasMore: query.data?.hasMore ?? true,
  error: query.error as Error | null,
  refetch: query.refetch,
  serverPath: resolvedServerPath,
  curatedEmptyReason: query.data?.curatedEmptyReason,   // NEW — ORCH-0677 RC-2
}), [
  cards, activePills,
  query.data?.deckMode,
  query.data?.hasMore,
  query.data?.curatedEmptyReason,   // NEW
  query.isLoading, query.isFetching, query.isPlaceholderData,
  hasData, query.error, query.refetch, resolvedServerPath
]);
```

### §5.2 Type Export

If `useDeckCards` exposes a return type, extend it with `curatedEmptyReason?: CuratedEmptyReason`.

---

## §6 Mobile Context Layer — `RecommendationsContext.tsx`

File: [app-mobile/src/contexts/RecommendationsContext.tsx](app-mobile/src/contexts/RecommendationsContext.tsx)

### §6.1 EMPTY Branch Extension

Modify the EMPTY branch (lines 1666-1673):

```ts
// EMPTY (server returned 0 cards for location/prefs).
//
// ORCH-0677: extended to recognize curated-only decks where the edge fn
// returns explicit `curatedEmptyReason`. Without this, curated-only empty
// results fall through to the INITIAL_LOADING fallback at line 1684, leaving
// the user on "Curating your lineup" indefinitely.
if (
  recommendations.length === 0 &&
  !isModeTransitioning &&
  (soloServerPath === 'pool-empty' ||
    (isDeckBatchLoaded && !deckHasMore) ||
    soloCuratedEmptyReason !== undefined)   // NEW — ORCH-0677 RC-2
) {
  return { type: 'EMPTY' };
}
```

`soloCuratedEmptyReason` is sourced from `useDeckCards().curatedEmptyReason` and surfaced into this useMemo's dependencies. Add it to the destructure of `useDeckCards()` and to the dependency array (line 1685-1697).

### §6.2 EMPTY Copy

No copy change in this spec. Existing EMPTY copy is reused. UX iteration on intent-aware copy is a separate ORCH.

---

## §7 Component Layer — `SwipeableCards.tsx`

File: [app-mobile/src/components/SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx)

### §7.1 No code changes required

The existing switch on `effectiveUIState.type` (line 1725) already handles `EMPTY`. Once §6 routes curated-only-empty to `EMPTY`, the existing render path fires correctly.

### §7.2 Verification only

Implementor must verify on a real device that hitting picnic at the failing coords (35.8894623, -78.7518462) shows the existing EMPTY UI (icon + title + "We couldn't find experiences for these preferences" copy), not the skeleton loader. This is T-05 in §11.

---

## §8 CI Gate (D-1)

### §8.1 Static check

Add a Deno-side static assertion at edge fn build time (or as a standalone CI script). Pseudocode:

```ts
// supabase/functions/generate-curated-experiences/_lint_invariants.ts
import { EXPERIENCE_TYPES } from './index.ts';

for (const td of EXPERIENCE_TYPES) {
  const hasReverseAnchor = td.stops.some(s => s.reverseAnchor);
  if (hasReverseAnchor && td.combos.length < 2) {
    throw new Error(
      `[I-CURATED-REVERSEANCHOR-NEEDS-COMBOS] ` +
      `Experience type "${td.id}" has reverseAnchor: true but only ${td.combos.length} combo(s). ` +
      `This shape was the cause of ORCH-0677 (picnic-dates dead-cycle). ` +
      `reverseAnchor + single combo = no fallback variety when an anchor fails.`
    );
  }
}
```

### §8.2 Wiring

Add invocation to whichever script runs `tsc --noEmit` or the existing CI check (search for `ci-check-invariants.sh` per ORCH-0640 R-11). Spec writer's recommendation: extend that script to also run this lint check.

### §8.3 Test

T-08 in §11 verifies the gate fires on a synthetic violation.

---

## §9 Success Criteria

Numbered. Each must be observable, testable, unambiguous.

1. **SC-1 — Picnic at Umstead returns ≥1 card OR explicit empty.** A request to `generate-curated-experiences` with `experienceType: 'picnic-dates'` and lat/lng `35.8894623, -78.7518462` returns HTTP 200 with EITHER `cards.length >= 1` (and the chosen anchor must NOT be the dead-cycle anchor — if Spring Forest Road Park is the only anchor returned, that's a fail) OR `{ cards: [], summary: { emptyReason: 'no_viable_anchor', failedAnchorCount: >=2 } }`.
2. **SC-2 — Picnic at Raleigh center remains working.** A request at `35.7796, -78.6382` returns `cards.length >= 2` (matches pre-fix behavior; T-01 regression-guards this).
3. **SC-3 — Romantic at Umstead unchanged.** A request at `35.8894623, -78.7518462` with `experienceType: 'romantic'` returns `cards.length === 5` (matches pre-fix; T-03 regression-guards this).
4. **SC-4 — Failed-anchor tracking advances.** Mock or instrument: with 5 anchor candidates in `categoryPlaces`, top 4 dead, 5th viable, the assembly loop reaches the 5th anchor within ≤5 iterations (NOT cycling on anchor 1 forever).
5. **SC-5 — Mobile shows EMPTY (not INITIAL_LOADING) when picnic returns 0 cards.** Stub `useDeckCards` to return `{ cards: [], curatedEmptyReason: 'no_viable_anchor', isLoading: false, isFetching: false, isFullBatchLoaded: true }`. `effectiveUIState.type` resolves to `EMPTY` within one render cycle. `SwipeableCards` renders the EMPTY UI.
6. **SC-6 — Mobile gracefully ignores `summary` field on legacy responses.** Stub edge fn response with `{ cards: [] }` only (no summary). Mobile falls back to current behavior — does not crash, does not throw. Backwards compat preserved.
7. **SC-7 — Curated stop `isOpenNow` reflects actual hours.** For a curated card whose `place.opening_hours.openNow === false`, the rendered stop has `isOpenNow === false`. For a place where Google did not return `openNow`, the stop has `isOpenNow === null`. **Never `true` when source is unknown.**
8. **SC-8 — CI gate fires on regression.** Add a synthetic typedef `{id:'lint-test', stops:[{reverseAnchor:true}], combos:[['x']]}` to a test fixture; the CI lint script exits non-zero with the I-CURATED-REVERSEANCHOR-NEEDS-COMBOS error name. Remove the fixture; CI exits zero.
9. **SC-9 — Other 4 curated intents unchanged.** Run a regression matrix (adventurous, first-date, group-fun, take-a-stroll) at Raleigh center and at Umstead. Card counts match the pre-fix v143 numbers verbatim.
10. **SC-10 — Solo + collab parity.** SC-1 result is identical when `mode === 'collab'` with a session containing 2 participants whose aggregated location lands on Umstead.

---

## §10 Invariants

### §10.1 New invariants to register

| ID | Statement | Test |
|----|-----------|------|
| **I-CURATED-FAILED-ANCHOR-IS-USED** | When an anchor's near-anchor category fetch yields zero qualifying candidates (or any reverse-anchor gate fires), the failed anchor must be excluded from subsequent iterations of the SAME request. | T-04 |
| **I-CURATED-EMPTY-IS-EXPLICIT-VERDICT** | Every curated empty response (`cards.length === 0`) must carry an explicit `summary.emptyReason` of `pool_empty | no_viable_anchor | pipeline_error`. The mobile EMPTY branch must fire when `curatedEmptyReason` is non-null. | T-02, T-05 |
| **I-CURATED-REVERSEANCHOR-NEEDS-COMBOS** | Any typedef in `EXPERIENCE_TYPES` with `stops.some(s => s.reverseAnchor)` must have `combos.length >= 2`. | T-08 |

### §10.2 Existing invariants preserved

- **I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** (ORCH-0659/0660) — preserved; this spec touches assembly logic, not distance computation.
- **I-FETCH-ERRORS-PROPAGATE** (ORCH-0653) — preserved; throws stay throws. New `pipeline_error` emptyReason is for caught-and-recovered paths only.
- **I-GEOGRAPHIC-FILTER-FIRST** (ORCH-0653 v3) — preserved; `failedAnchorIds` filter is applied AFTER the bbox-first RPC, not in place of it.
- **Constitution #2 (one owner per truth)** — `curatedEmptyReason` has a single source: edge fn `summary`. Mobile aggregates from per-pill responses but the per-pill source is canonical.
- **Constitution #3 (no silent failures)** — IMPROVED. `pipeline_error` makes silent catches surface. `no_viable_anchor` makes "0 cards" explicit.
- **Constitution #8 (subtract before adding)** — D-2 cleanup removes 14 LOC of transitional instrumentation; new `summary` adds ~6 LOC. Net delta negative.
- **Constitution #9 (no fabricated data)** — RESTORED. D-3-new fix removes hardcoded `isOpenNow: true`.

---

## §11 Test Cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| **T-01** | Picnic at Raleigh center returns ≥2 cards | `POST {experienceType:'picnic-dates', location:{lat:35.7796,lng:-78.6382}, travelMode:'driving', travelConstraintValue:60, limit:4}` | HTTP 200, `cards.length >= 2`, `summary` absent | Edge fn live-fire |
| **T-02** | Picnic at Umstead resolves cleanly | Same payload, location `{lat:35.8894623,lng:-78.7518462}` | HTTP 200; EITHER `cards.length >= 1` AND no `summary.emptyReason==='no_viable_anchor'` (means failedAnchorIds tracking advanced past dead anchors) OR `cards: [], summary: {emptyReason:'no_viable_anchor', failedAnchorCount >= 2, candidateAnchorCount >= 2}`. | Edge fn live-fire |
| **T-03** | Romantic at Umstead unchanged (regression guard) | `POST {experienceType:'romantic', location:{lat:35.8894623,lng:-78.7518462}, travelMode:'driving', travelConstraintValue:60, limit:5}` | HTTP 200, `cards.length === 5`, NO `summary` field. | Edge fn live-fire |
| **T-04** | failedAnchorIds prevents same-anchor retry | Unit test or instrumented run: stub `categoryPlaces[anchorCatId]` with 5 places; mock the near-anchor fetch to return `[]` for places 0-3 and `[{...}]` for place 4. | Loop attempts iter 1 → place 0 fails → adds to failedAnchorIds. Iter 2 → place 1 fails. Iter 3 → place 2 fails. Iter 4 → place 3 fails. Iter 5 → place 4 succeeds → card built. Total iterations ≤ 5. | Edge fn unit |
| **T-05** | Mobile shows EMPTY when curated returns no_viable_anchor | Stub `useDeckCards` (or React Query) to resolve with `{ cards:[], curatedEmptyReason:'no_viable_anchor', isLoading:false, isFetching:false, isFullBatchLoaded:true, hasMore:false }`. | Within one render cycle, `effectiveUIState.type === 'EMPTY'`. SwipeableCards renders the EMPTY UI (existing icon + title). NOT the "Curating your lineup" skeleton. | Mobile component test |
| **T-06** | Mobile compat with legacy edge fn response (no summary) | Stub edge fn response with `{ cards: [] }` only — no `summary` key. | deckService falls back: `pillEmptyReasons` records `pool_empty`. Mobile receives `curatedEmptyReason: 'pool_empty'`. EMPTY UI fires per T-05. No crash, no exception, no missing-field render. | Mobile service+hook |
| **T-07** | Curated stop `isOpenNow` truthful | For a curated card whose source `place.opening_hours.openNow === false`, build the card. | Card stop `isOpenNow === false`. Separately, for a place with `place.opening_hours.openNow === undefined` (Google omitted the field), `isOpenNow === null`. NEVER `true` when source absent. | Edge fn unit |
| **T-08** | CI gate fires on reverseAnchor + single combo | Add typedef `{id:'lint-test', stops:[{role:'X', reverseAnchor:true}], combos:[['x']]}` to a test fixture or to `EXPERIENCE_TYPES` in a branch. Run the CI lint script. | Exit code != 0; stderr contains `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS` and the offending typedef id. Remove the typedef → exit code 0. | CI |
| **T-09** | All 5 other curated intents at Raleigh center | Run T-01-style requests for `adventurous`, `first-date`, `group-fun`, `take-a-stroll`, `romantic` at Raleigh center. | Each returns the same `cards.length` as the v143 baseline (capture pre-fix numbers as the regression target). NO `summary` on any non-empty result. | Edge fn live-fire matrix |
| **T-10** | Solo + collab parity for picnic | Run T-02 in collab mode: create a 2-participant session whose aggregated location resolves to Umstead. | Same outcome as T-02 (cards present OR explicit emptyReason). No collab-specific divergence. | Mobile + edge fn integration |
| **T-11** | Real-device live-fire (mandatory pre-CLOSE per `feedback_headless_qa_rpc_gap.md`) | On a real iOS device with picnic-dates as the only curated intent and custom location set to 35.8894623, -78.7518462, open the deck. | Within ~3s the deck shows EITHER picnic curated cards OR the EMPTY UI. NOT the "Curating your lineup" skeleton beyond the initial cold-fetch window. | Device |
| **T-12** | D-2 cleanup verification | Grep `_gateCounts` and `SUMMARY` in deployed v144+ source. | Zero matches. (Negative control: grep finds them in v143.) | Static |
| **T-13** | Negative control on the CI gate | Inject the lint-test fixture from T-08 → CI fails. Remove → CI passes. | As described. Demonstrates gate is alive, not silently passing. | CI |

---

## §12 Implementation Order

Numbered. Each step is atomic enough to commit independently if needed, but all must land before user-visible release.

1. **Edge fn step 1** — Add `failedAnchorIds` Set declaration + extend anchor filter clause + add `failedAnchorIds.add(...)` calls to all 6 gate sites listed in §3.1.
2. **Edge fn step 2** — Define `summary` field shape and emit in the response per §3.2 / §3.5. Cover all three `emptyReason` values.
3. **Edge fn step 3** — Replace hardcoded `isOpenNow: true` with derivation per §3.3.
4. **Edge fn step 4** — Delete `_gateCounts` and `SUMMARY` console.error per §3.4.
5. **Edge fn step 5** — Add CI lint script per §8.1.
6. **Edge fn step 6** — Run `deno check` + Deno unit tests for T-04, T-07, T-08. All pass.
7. **Edge fn deploy** — `supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv`.
8. **Edge fn live-fire** — Run T-01, T-02, T-03, T-09 via curl. Capture full responses. T-01 must show ≥2 cards. T-02 must show either ≥1 cards OR explicit `no_viable_anchor`. T-03 must show 5 cards (regression guard).
9. **Mobile step 1** — Update `curatedExperiencesService.generateCuratedExperiences` return type to `{cards, summary?}`. Update all callers.
10. **Mobile step 2** — Update `deckService.fetchDeck` per §4.1 + §4.2 (capture per-pill empty reasons, set `hasMoreFromEdge=false` and `curatedEmptyReason` on curated-only empty).
11. **Mobile step 3** — Update `useDeckCards` return shape per §5.
12. **Mobile step 4** — Update `RecommendationsContext.deckUIState` EMPTY branch per §6.1 (add `soloCuratedEmptyReason !== undefined` to the condition).
13. **Mobile step 5** — `tsc --noEmit` + lint pass. CI green.
14. **Mobile step 6** — Component test T-05, T-06.
15. **Commit + push** — Two commits acceptable: one for edge fn, one for mobile. Both must be pushed before OTA.
16. **EAS Update** — Two SEPARATE invocations per memory rule `feedback_eas_update_no_web.md`:
    - `cd app-mobile && eas update --branch production --platform ios --message "ORCH-0677: picnic-dates fix bundle (RC-1 + RC-2)"`
    - `cd app-mobile && eas update --branch production --platform android --message "ORCH-0677: picnic-dates fix bundle (RC-1 + RC-2)"`
17. **Real-device live-fire (T-11)** — On iOS + Android device with custom location 35.8894623, -78.7518462 and picnic-dates as the only curated intent. PASS criterion: NOT stuck on "Curating your lineup".
18. **Tester dispatch** — Hand off to `/mingla-tester` with this spec + the implementor report.

---

## §13 Regression Prevention

### §13.1 Structural safeguards built into this fix

1. **I-CURATED-FAILED-ANCHOR-IS-USED + the failedAnchorIds Set itself** — the bug class can't recur without removing the set. Code review will catch removal.
2. **I-CURATED-REVERSEANCHOR-NEEDS-COMBOS CI gate** — any future intent with the same dangerous shape is rejected at build time.
3. **I-CURATED-EMPTY-IS-EXPLICIT-VERDICT** — server emits explicit verdict; mobile's EMPTY branch consumes it. New silent fallthrough requires changing both ends, which is harder to do by accident.

### §13.2 Protective comments (must be in the code)

- At the `failedAnchorIds` declaration: `// ORCH-0677 RC-1: dead-anchor cycle prevention. Do not remove without re-running T-04 fixture.`
- At the EMPTY branch line 1666: `// ORCH-0677 RC-2: curatedEmptyReason gate. Do not remove the curatedEmptyReason check — it is the only signal that surfaces curated-only empty results.`
- At the CI lint: `// ORCH-0677 D-1: enforces I-CURATED-REVERSEANCHOR-NEEDS-COMBOS. Removing this gate re-opens the picnic-dates regression class.`

### §13.3 Tests as the ratchet

T-04 (unit) and T-08 (CI) are the structural ratchets. T-02 and T-05 are the symptom regression tests. All four must remain in the suite indefinitely.

---

## §14 Out of Scope (declared, not silently dropped)

- **D-4-new — groceries signal noise.** Per investigation, the groceries signal sometimes ranks non-grocery places highly, making picnic more fragile. This is a signal-tuning ORCH (separate work stream from assembly logic). FILE as `ORCH-0678 groceries signal noise audit + retune` after this spec ships.
- **Intent-aware EMPTY copy.** Existing EMPTY copy is reused. UX may want intent-specific messaging ("No picnic spots match your radius — try widening it"). Filed as future UX work, not in this spec.
- **Reverse-anchor algorithm rewrite.** Architecture B (pre-validated nearest-viable) is acknowledged as an alternative. NOT chosen here. If the failedAnchorIds approach proves insufficient in production, a future ORCH can revisit.
- **Hours-filter retrofit (ORCH-0644).** Separate spec already exists. This spec does NOT introduce hours filtering on grocery anchors.

---

## §15 Boundaries Honored

- ✅ SPEC-ONLY. No code written. No deploy.
- ✅ Architecture A bound with explicit reasoning (Assumption A1).
- ✅ Every layer touched by the fix is specified.
- ✅ Every success criterion is observable + testable + unambiguous.
- ✅ Test cases cover happy path (T-01, T-09), error path (T-02), edge cases (T-04, T-07), regression guards (T-03, T-09), backwards compat (T-06), real-device gate (T-11), CI gate (T-08, T-13), cleanup (T-12), parity (T-10).
- ✅ Implementation order is unambiguous and atomic.
- ✅ Out-of-scope items declared, not silently dropped.
- ✅ Constitutional + memory-rule compliance verified per §10.2.
- ✅ Spec saved to canonical path.

---

**Spec end. Orchestrator: REVIEW per 10-gate protocol → if APPROVED, write IMPL dispatch.**
