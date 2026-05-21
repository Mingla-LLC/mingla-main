# IMPLEMENTATION REPORT — ORCH-0903

**Title:** "How far" filter and displayed travel-time disagree — unify SPEED tables, add 1.5× generosity radius helper, add post-radius display-aware filter

**Implementor:** Claude `mingla-implementor` (parity mirror, operator-redirected), 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`](../specs/SPEC_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`](INVESTIGATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md)
**Status:** `implemented and verified` — all 10 happy-path tests GREEN, both `[FAILS-ON-REVERT KEY]` anchors verified.
**Commit/PR status:** **NOT YET STAGED — blocked on operator-resolution of mixed scope in `discover-cards/index.ts`.** See §11 Discoveries for Orchestrator.

---

## §1 — Cross-Surface Impact Inspection (mandatory per Pre-Flight Step 3.5)

| Surface | Affected | What changes for an end user | Files touched on surface | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | **YES** | Once edge function deploys: deck stops showing cards labeled > user's "how far" cap. Walking/biking/transit overshoot also fixed. | NONE on this surface — pure server-side fix. | Automatic (server payload identical for iOS+Android) |
| **Consumer Android** (`app-mobile/` on Android) | **YES** | Same as iOS. | NONE. | Automatic. |
| **Backend** (`supabase/functions/`) | **YES — root cause location** | Three files edited; one SPEED source of truth established. | `_shared/distanceMath.ts`, `discover-cards/index.ts`, `generate-curated-experiences/index.ts`, plus new test file at `discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` | N/A — one canonical source |
| Buyer-anon-web | NO | — | — | No preferences sheet on anon checkout. |
| Business iOS / Android / web-preview | NO | — | — | No consumer preferences sheet in business app. |
| Admin Web | NO | — | — | No consumer-side admin tooling for "how far". |

---

## §2 — Old → New Receipts (per file)

### `supabase/functions/_shared/distanceMath.ts`

**What it did before:** Defined `estimateTravelMinutes(distKm, travelMode)` with an inline-scoped `config` object containing walking 4.5×1.3, **driving 35×1.4**, transit 20×1.3, biking 14×1.3, bicycling 14×1.3. No exported speed constant. No radius helper.

**What it does now:** Exports `TRAVEL_CONFIG` as a module-level constant (same shape, but driving entry is now **60×1.3**). `estimateTravelMinutes` reads `TRAVEL_CONFIG` directly. New exported function `radiusKmForConstraint(constraintMin, travelMode, generosity = 1.0)` returns `(constraintMin / 60) × speed × factor × generosity`. ORCH-0903 protective comment block added explaining the single-source-of-truth contract.

**Why:** SPEC §2 File 1; unifies the radius math and display math against ONE constant so filter and display cannot drift (SC-02). Driving speed bumped to operator-locked value 60×1.3 = effective ~46 km/h door-to-door.

**Lines changed:** ~30 (file went from 46 → 84 lines).

### `supabase/functions/discover-cards/index.ts`

**Five surgical changes per SPEC §2 File 2:**

1. **Import update (line 18).**
   - Before: `import { haversineKm, estimateTravelMinutes, type TravelMode } from '../_shared/distanceMath.ts';`
   - After: `import { haversineKm, estimateTravelMinutes, radiusKmForConstraint, type TravelMode } from '../_shared/distanceMath.ts';`

2. **Local SPEED_KMH deleted (was lines 131-138 of pre-fix file).** Replaced with a 3-line protective comment pointing future contributors to `_shared/distanceMath.ts`.

3. **Radius math replaced (was lines 729-730 of pre-fix file).**
   - Before: `const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;` + `const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);`
   - After: `const maxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.5);` + `const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 100000);` — singles uses generosity=1.5×; clamp ceiling bumped 50→100 km.

4. **Post-radius filter inserted** between current lines ~1535-1555 (post-fix). Filters `rawCards` to drop any card where `card.travelTimeMin !== null && card.travelTimeMin > travelConstraintValue`. Subsequent date-filter calls now read from `constraintFilteredCards` instead of `rawCards`. Drop count computed as `_droppedByTravelTimeFilter` and logged via `console.log` when > 0.

5. **Telemetry field added** to populated-path `sourceBreakdown`: `droppedByTravelTimeFilter: _droppedByTravelTimeFilter` immediately after `filterMins`.

**What it did before:** Filter used a 100 km/h driving speed × 1.3 factor (50 km clamp) yielding cards labeled up to 5.2× over the user's cap. No alignment with display formula.

**What it does now:** Filter and display read from the same `TRAVEL_CONFIG`. Wider candidate radius (1.5× generosity, 100 km clamp) feeds round-robin diversity; post-filter trims any card whose displayed `travelTimeMin` exceeds user constraint.

**Why:** SPEC §2 File 2 Changes 2A-2E. Closes the filter-display divergence at code structure (SC-01, SC-02, SC-09, SC-11).

**Lines changed:** ~30 net (delete 8 + insert ~38).

### `supabase/functions/generate-curated-experiences/index.ts`

**Three surgical changes per SPEC §2 File 3:**

1. **Import extended (line 6).**
   - Before: `import { haversineKm, estimateTravelMinutes } from '../_shared/distanceMath.ts';`
   - After: `import { haversineKm, estimateTravelMinutes, radiusKmForConstraint } from '../_shared/distanceMath.ts';`

2. **First `TRAVEL_SPEEDS_KMH` block (was lines 585-590)** replaced with `radiusKmForConstraint(travelConstraintValue, travelMode, 1.0)` call.

3. **Second `TRAVEL_SPEEDS_KMH` block (was lines 1248-1253)** replaced identically with `radiusKmForConstraint(travelConstraintValue, travelMode, 1.0)`.

**What it did before:** Two identical local SPEED tables (`driving: 35`, no factor) at different scopes, each computing `Math.round((speedKmh * 1000 / 60) * travelConstraintValue)` for radius.

**What it does now:** Both call sites use the unified `radiusKmForConstraint` helper with `generosity=1.0` (tight — curated multi-stop trips traverse end-to-end). Curated's 50 km clamp ceiling unchanged.

**Why:** SPEC §2 File 3 Changes 3A-3B. One source of truth across all deck-serving edge functions (SC-06, SC-08).

**Lines changed:** ~10 net (delete 12 + insert 8 across both occurrences).

### NEW FILE: `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts`

**What it did before:** Did not exist. The `discover-cards/__tests__/` directory did not exist either.

**What it does now:** 10 Deno tests covering T-01..T-10 from SPEC §5.1. Imports `TRAVEL_CONFIG`, `estimateTravelMinutes`, `radiusKmForConstraint` from `_shared/distanceMath.ts` and tests the helpers + a replicated post-filter predicate against synthetic mock cards. Includes source-file grep regressions (T-07, T-08) that read `discover-cards/index.ts` and `generate-curated-experiences/index.ts` via `Deno.readTextFile` and assert no local SPEED tables remain.

**Why:** ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 implementor happy-path gate.

**Lines:** ~250 (new file).

---

## §3 — Spec Traceability (SC mapping)

| SC | What the spec requires | How implemented | Verified by |
|---|---|---|---|
| SC-01 | Every card `travelTimeMin === null \|\| <= constraint` | Post-filter at `discover-cards/index.ts` Change 2D | T-01, T-02, T-03, T-04 GREEN |
| SC-02 | One source of truth | `TRAVEL_CONFIG` exported from `_shared/distanceMath.ts`; both helpers read it | T-05, T-06, T-07, T-08 GREEN |
| SC-03 | `radiusKmForConstraint(30, 'driving', 1.5)` matches formula | Helper implemented per SPEC §2 File 1 | T-05 GREEN — **NOTE:** expected value corrected to **58.5** (formula output); SPEC §3 SC-03 worked example of "35.1" was arithmetic error. See §11 Discovery D-DESIGN-MATH. |
| SC-04 | `radiusKmForConstraint(30, 'driving', 1.0)` matches formula | Same helper | T-06 GREEN — expected value corrected to **39.0** (SPEC §3 SC-04 worked example "23.4" was also arithmetic error) |
| SC-05 | Unknown mode → walking fallback | `TRAVEL_CONFIG[travelMode] ?? TRAVEL_CONFIG.walking` | implicit in helper; manually verifiable |
| SC-06 | No local SPEED tables | Deletions in `discover-cards` + `generate-curated-experiences` | T-07, T-08 GREEN |
| SC-07 | Singles uses 1.5 generosity | Change 2C in discover-cards | inspectable + T-05 confirms helper math at 1.5 |
| SC-08 | Curated uses 1.0 generosity | Change 3B in generate-curated-experiences | T-06 confirms helper math at 1.0 |
| SC-09 | Clamp 100000 | Change 2C | inspectable in source line ~1268 of post-fix file |
| SC-10 | `droppedByTravelTimeFilter` telemetry | Change 2D + 2E | T-10 GREEN |
| SC-11 | Null-coord pass-through | Post-filter predicate uses `=== null \|\| <=` short-circuit | T-09 GREEN |
| SC-12 | Solo + collab parity | Post-filter applied uniformly before any sessionId branching | Note: ORCH-0902 collab work (un-committed in worktree) routes collab traffic through a separate handler `handleDeterministicV2` BEFORE reaching this filter. Implementor verified the singles-path filter applies in solo mode; collab parity verification depends on whether ORCH-0902 ships with or without the same post-filter pattern in its handler — **flagged in §11**. |
| SC-13 | Walking/biking/transit fixed | Post-filter mode-agnostic | T-02 (walking), T-03 (biking), T-04 (transit) GREEN |
| SC-14 | No mobile change | Zero edits under `app-mobile/` | `git diff --name-only` shows only `supabase/functions/...` + `Mingla_Artifacts/...` |
| SC-15 | Protective comment | ORCH-0903 comment block above `TRAVEL_CONFIG` in `_shared/distanceMath.ts` | inspectable |

---

## §4 — Invariant Preservation Check

| Invariant | Preserved? | Evidence |
|---|---|---|
| I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME (ORCH-0659/0660) | **YES** | Null-coord cards pass post-filter (T-09 GREEN); `TRAVEL_CONFIG` is now the single owner for travel-time speed math (strengthens the invariant). |
| I-COHORT-REVERSIBLE | **YES** | No changes to `getSignalServingPct` cache or cohort logic. |
| I-PROPOSED-DECK-TRAVEL-TIME-RESPECTS-CONSTRAINT (NEW, DRAFT → ACTIVE on close) | **ESTABLISHED** | Backed by T-01 + T-09 + T-10 happy-path tests with fails-on-revert anchor at T-01. |
| Constitution #2 (One owner per truth) | **IMPROVED** | Three SPEED tables collapse to one `TRAVEL_CONFIG` constant. |
| Constitution #3 (No silent failures) | **YES** | Drop count logged via `console.log` when > 0 AND surfaced as `sourceBreakdown.droppedByTravelTimeFilter`. |
| Constitution #8 (Subtract before adding) | **YES** | Local SPEED tables in callers DELETED before unified helper added. No layering. |
| Constitution #13 (Exclusion consistency) | **YES** | Filter math and display math share `TRAVEL_CONFIG` — exclusion IS inclusion by structure. |

---

## §5 — Parity Check

- **Solo + collab parity (SC-12):** the post-filter step lives in the singles-path serve() handler (post-fix file lines ~1535-1555). In the pre-ORCH-0902 codebase, collab traffic flowed through this same handler with `sessionId` set, so the filter would apply identically. In the current worktree, un-committed ORCH-0902 [Collab session deck deterministic rewrite] code routes collab requests through a separate `handleDeterministicV2` function that exits BEFORE reaching the solo-path filter (per the comment at line 1559 of the post-fix file: "ORCH-0902 CR-9: legacy collab branch ... was DELETED — collab traffic exits at the top of the handler via handleDeterministicV2"). **Implication:** if ORCH-0902 ships first, the solo deck honors ORCH-0903 but the collab deck does NOT until ORCH-0902 is updated to apply the same post-filter in its handler. Flagged as P1 dependency in §11.

- **Cross-domain:** Consumer mobile only. Buyer-anon-web, business app, admin-web are all confirmed NOT in scope (no preferences sheet on those surfaces).

---

## §6 — Cache Safety

- **Query keys:** unchanged. Mobile `useDeckCards` continues to use existing query key with `travelMode` and `travelConstraintValue` as parameters. Post-fix server returns same response shape plus a new optional `sourceBreakdown.droppedByTravelTimeFilter` field that mobile ignores.
- **Persisted state:** unchanged. Zustand stores no travel-time data.
- **Deno isolate cache:** edge function deploy will create a new revision; old isolates retire normally.

---

## §7 — Regression Surface

The 5 adjacent features most likely to break from this change:

1. **Solo deck cold-load latency.** Post-filter adds an O(N) pass over up to 200 cards. Expected impact: <1ms. Tester should check Metro logs for elapsed_ms regression in the `[discover-cards] exit path=pipeline ...` line.
2. **Empty-deck UX in sparse markets.** With the post-filter trimming, sparse-pool markets (Raleigh-style) may surface the `path='pool-empty'` exit more often for restrictive constraints (e.g., 5-min driving). Existing EMPTY state copy applies — no regression in UI, but tester should verify the empty state displays cleanly when the new filter empties a deck.
3. **Curated multi-stop trip composition.** The slight widening of curated's effective radius (was 17.5 km @ 30-min driving via 35 km/h × no factor; now 39 km via 60 × 1.3 × 1.0) increases candidate variety. Curated trip stops should still pass curated's own per-stop hours filter; tester should sanity-check that curated didn't lose viable trips.
4. **Display travel-time perception.** Driving display values drop across-the-board (e.g., 17.7 km route was 43 min, now 23 min). Users may perceive this as "travel times got better" or "the deck got more accurate"; not a regression but a noticeable change worth flagging in release notes.
5. **collab deck path.** Per §5, depends on ORCH-0902 status — if collab routing through `handleDeterministicV2` lands without the same post-filter, collab will still show inflated travel times until a follow-up fix.

---

## §8 — Regression Test

**Test file:** `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` (NEW)

**Final run output:**

```
running 10 tests from ./supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts
T-01 [FAILS-ON-REVERT KEY] driving 30-min cap: every returned card displays <= 30 min ... ok (14ms)
T-02 walking 15-min cap: every returned card displays <= 15 min ... ok (0ms)
T-03 biking 20-min cap: every returned card displays <= 20 min ... ok (0ms)
T-04 transit 45-min cap: every returned card displays <= 45 min ... ok (0ms)
T-05 [FAILS-ON-REVERT KEY] radiusKmForConstraint(30, "driving", 1.5) === 58.5 ... ok (0ms)
T-06 radiusKmForConstraint(30, "driving", 1.0) === 39 (curated generosity) ... ok (0ms)
T-07 grep regression: discover-cards/index.ts has no local SPEED_KMH ... ok (0ms)
T-08 grep regression: generate-curated-experiences has no local TRAVEL_SPEEDS_KMH ... ok (0ms)
T-09 null-coord card (travelTimeMin === null) passes the post-filter ... ok (0ms)
T-10 droppedByTravelTimeFilter is non-negative number when drops occur ... ok (0ms)

ok | 10 passed | 0 failed (21ms)
```

### Fails-on-revert verification at HEAD = `9eab4a95` ("Close ORCH-0898: Consumer collab session → Friends-tab group chat (unified substrate)")

**T-01 [FAILS-ON-REVERT KEY]:**
- **Revert:** removed the post-filter block at `discover-cards/index.ts` lines ~1543-1550 (deleted the `constraintFilteredCards = rawCards.filter(...)` block and the conditional `console.log`); changed subsequent date-filter calls back to read `rawCards` instead of `constraintFilteredCards`; replaced the drop-count compute with `const _droppedByTravelTimeFilter = 0;`.
- **Test output (post-revert):**
  ```
  T-01 [FAILS-ON-REVERT KEY] driving 30-min cap ... FAILED
    AssertionError: post-filter predicate `card.travelTimeMin === null || card.travelTimeMin <= travelConstraintValue` MUST be present in discover-cards/index.ts (ORCH-0903 contract)
  T-10 droppedByTravelTimeFilter is non-negative number when drops occur ... FAILED
    AssertionError: drop count compute (`rawCards.length - constraintFilteredCards.length`) MUST be present (ORCH-0903 SC-10)
  
  FAILED | 8 passed | 2 failed (31ms)
  ```
- **Restore:** put the post-filter block + drop-count compute back; restored `constraintFilteredCards` references in date-filter calls.
- **Test output (post-restore):** 10 passed | 0 failed (verified above).
- **Verdict:** T-01 [FAILS-ON-REVERT KEY] confirmed exercises the bug — its grep assertion catches deletion of the predicate from source.

**T-05 [FAILS-ON-REVERT KEY]:**
- **Revert:** changed `TRAVEL_CONFIG.driving` in `_shared/distanceMath.ts` from `{ speed: 60, factor: 1.3 }` to `{ speed: 35, factor: 1.4 }` (the pre-ORCH-0903 honest-display values).
- **Test output (post-revert):**
  ```
  T-01 [FAILS-ON-REVERT KEY] driving 30-min cap ... FAILED (cascades from changed math)
  T-05 [FAILS-ON-REVERT KEY] radiusKmForConstraint(30, "driving", 1.5) === 58.5 ... FAILED
    AssertionError: Expected radius 58.5 km; got 36.75
  T-06 radiusKmForConstraint(30, "driving", 1.0) === 39 (curated generosity) ... FAILED
    AssertionError: Expected curated radius 39.0 km; got 24.5
  
  FAILED | 7 passed | 3 failed (29ms)
  ```
- **Restore:** put `{ speed: 60, factor: 1.3 }` back.
- **Test output (post-restore):** 10 passed | 0 failed (verified above).
- **Verdict:** T-05 [FAILS-ON-REVERT KEY] confirmed exercises the bug — `radiusKmForConstraint` reads `TRAVEL_CONFIG` directly, so any change to the canonical driving entry surfaces immediately in the helper math. T-01 + T-06 cascade as expected.

### Deno gates

- `deno check supabase/functions/_shared/distanceMath.ts` — **PASS**
- `deno check supabase/functions/discover-cards/index.ts` — **PASS**
- `deno check supabase/functions/generate-curated-experiences/index.ts` — **FAIL with 11 pre-existing TS errors** at lines 95, 96, 1198, 1199 of pre-fix file (all in unrelated code paths — `pref.location`, `agg.budgetMin/budgetMax`). NOT caused by ORCH-0903; flagged in §11.
- `deno test --allow-read supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` — **PASS 10/10**

---

## §9 — Constitutional Compliance

| Principle | Status | Evidence |
|---|---|---|
| #2 One owner per truth | **IMPROVED** | Three SPEED tables → one `TRAVEL_CONFIG`. |
| #3 No silent failures | **PASS** | Drop count logged + surfaced in response. |
| #8 Subtract before adding | **PASS** | Local SPEED tables DELETED before unified helper added. |
| #13 Exclusion consistency | **PASS** | Filter and display read from same constant. |
| Others (#1, #4-7, #9-12, #14) | **N/A** | Not touched by this change. |

---

## §10 — Transition Items

None.

---

## §11 — Discoveries for Orchestrator

| ID | Discovery | Severity | Recommended action |
|---|---|---|---|
| **D-ORCH-0902-DIRTY** | The worktree contains un-committed ORCH-0902 [Collab session deck deterministic rewrite] work in `supabase/functions/discover-cards/index.ts` (487-line insertion at the `transformServablePlaceToCard` site + 4 other hunks totaling ~562 lines) AND a new migration `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql`. None of this is ORCH-0903 work. The SPEC §6 step 7 requires staging ONLY the 5 ORCH-0903 files; with the current mixed state, `git add supabase/functions/discover-cards/index.ts` would bundle ORCH-0902 into the ORCH-0903 commit. **Operator-resolution required before commit.** Options: (a) operator separates the two ORCHs first via `git stash` / patch-mode commit; (b) operator authorizes a bundled commit explicitly naming both ORCH-IDs in the commit title per the one-PR-per-CLOSE narrow exception. **Implementor refuses to silently bundle.** | **P1 — blocks ORCH-0903 commit/PR** | Operator decides commit strategy. |
| **D-CURATED-PRE-EXISTING-TS-ERRORS** | `supabase/functions/generate-curated-experiences/index.ts` has 11 pre-existing TypeScript errors at lines 95-96 (`pref.location` on `never`-typed array elements) and lines 1198-1199 (`agg.budgetMin`/`budgetMax` on type without those fields), unrelated to ORCH-0903. My edits at lines 585 + 1248 did not introduce them. `deno check` on this file was failing before my pass and continues to fail after. | P3 — unrelated tech debt | Register cleanup ORCH or note as pre-existing in close. |
| **D-DESIGN-MATH** | SPEC §3 SC-03 + SC-04 had arithmetic errors in the worked examples (35.1 km / 23.4 km for 30-min driving). The actual formula `(30/60) × 60 × 1.3 × 1.5 = 58.5 km` (singles) and `× 1.0 = 39 km` (curated) is correct; the SPEC's prose value was off by a factor of ~0.6×. Investigation report §8.6 has the same arithmetic error in its "post-fix" table. Implementor used the FORMULA as binding contract (prime directive #2 — spec is law on formulas, prose examples are advisory) and corrected the test expectations. The SPEC text in the file remains unchanged; the formula it specifies produces the correct (test-passing) values. | P3 — documentation drift, not a code defect | Orchestrator should consider patching SPEC §3 SC-03/SC-04 and Investigation §8.6 worked-example numbers to 58.5 and 39 to avoid future-reader confusion. No code change needed. |
| **D-SPEC-LINE-NUMBER-DRIFT** | SPEC §2 referenced source line numbers (729-730, 984-989, 1024-1037) based on the file's pre-ORCH-0902 state. Due to D-ORCH-0902-DIRTY, the actual line positions in the current worktree are ~600 lines higher (the 487-line ORCH-0902 insertion shifts everything below it). My Edit calls used verbatim `old_string` content (not line numbers) so the edits landed on the right text regardless. Worth noting for future SPEC authors: prefer verbatim code snippets over line numbers in active-development files. | P3 — process | Informational. |
| **D-CONSTRAINT-EDGE-1-MIN** | TA-01 (in adversarial tester scope) checks behavior at constraint=1 walking. Math: post-filter drops any card with `travelTimeMin > 1`, but `estimateTravelMinutes` floors at 3 min (`Math.max(3, ...)`). So for constraint=1 walking, EVERY card with a non-null `travelTimeMin` displays ≥ 3 and gets dropped. Deck for `constraint=1 walking` is structurally empty (only null-coord cards pass). Acceptable per SPEC §9.6 (empty-deck behavior accepted). Worth flagging in case tester observes empty decks at very low constraints and wants to consider raising the UI slider floor in a future ORCH. | P4 — observation | None; documented for tester. |

---

## §12 — Test First (for Seth's eyeball verification before any deploy)

Once the D-ORCH-0902-DIRTY blocker is resolved and the commit lands + edge function deploys:

1. **iOS Simulator (consumer-app dev build):** sign in, set Simulate Location → Custom (Lagos: 6.5244, 3.3792), open preferences sheet, set "how far" = 30 min driving, tap Apply. Screenshot the deck. **VERIFY** no card displays a "X min" badge where X > 30.
2. Repeat with "how far" = 15 min walking. **VERIFY** no card displays > 15 min.
3. Repeat with "how far" = 45 min transit. **VERIFY** no card displays > 45 min.
4. Watch Metro logs for `[discover-cards] travel-time post-filter dropped N/M cards exceeding K-min <mode> cap` lines — confirms telemetry is firing.
5. **Android Emulator:** same flow on a Pixel emulator. Same expected outcome (parity automatic).
6. **Cross-check:** an earlier deck fetch (before fix) for "30 min driving" should have shown cards labeled 30-120 min. Post-fix, same query in same location must show 0-30 min cards only.

---

## §13 — Commit + Deploy Plan (BLOCKED on D-ORCH-0902-DIRTY)

**Files to stage (5 + 1):**
- `supabase/functions/_shared/distanceMath.ts` (modified)
- `supabase/functions/discover-cards/index.ts` (modified — **MIXED with ORCH-0902 work; needs operator strategy**)
- `supabase/functions/generate-curated-experiences/index.ts` (modified)
- `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` (new — `??` in git status)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md` (this file)

**Files explicitly NOT to stage:**
- `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` (ORCH-0902 work)
- All 35+ `mingla-business/` modifications (ORCH-0892-B v2 [App-wide keyboard avoidance] work, prior dispatch)

**Proposed commit message (once unblocked):**

```
ORCH-0903: unify travel-time speeds (driving 60×1.3) + 1.5× generosity radius helper + post-filter

- Replace 3 local SPEED tables (discover-cards + curated x2) with one
  exported TRAVEL_CONFIG in _shared/distanceMath.ts
- Add radiusKmForConstraint(constraint, mode, generosity) helper
- Driving: 35×1.4 (display only) / 100×1.3 (radius only) → 60×1.3 unified
- discover-cards: singles uses generosity=1.5; clamp 50→100km
- generate-curated-experiences: both occurrences use generosity=1.0
- Post-radius filter drops cards where travelTimeMin > user constraint
- New telemetry: sourceBreakdown.droppedByTravelTimeFilter
- Walking/biking/transit 1.69× overshoot fixed by same mechanism
- New Deno test suite: 10 happy-path tests, T-01 + T-05 fails-on-revert
  verified at commit 9eab4a95

Closes ORCH-0903 (subject to tester PASS + edge function deploy)
```

**Deploy plan (Seth-direct, post-tester-PASS):**

1. `supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv`
2. `supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv`

Both functions touched `_shared/distanceMath.ts` — Supabase function deploy includes shared code automatically.

**EAS OTA:** ELIGIBLE but NOT REQUIRED — mobile code is unchanged (SC-14). The server fix lands for all consumer clients on next deck fetch the moment the edge functions deploy. EAS OTA may still be published for unrelated mobile-code pending work.

**No migration to push.** `supabase db push` is not required for ORCH-0903.

---

**End of implementation report.**
