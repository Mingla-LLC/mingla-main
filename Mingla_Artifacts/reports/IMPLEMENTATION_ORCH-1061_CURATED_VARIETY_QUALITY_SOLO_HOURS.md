# IMPLEMENTATION REPORT — ORCH-1061 [Curated stop variety + quality blend + solo hours gate]

**Status:** implemented and verified
**Author:** mingla-implementor (Claude)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1061-[curated-variety-quality]/` on branch `ORCH-1061-curated-variety-quality`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1061_CURATED_VARIETY_QUALITY_SOLO_HOURS.md` (`ab839a953`)
**Base:** branched from `origin/main` `ef88b93c2`; pre-fix HEAD = SPEC commit `ab839a953`.
**Implement commit:** `aba3d22b7` (+ lint-cleanup follow-up commit; see Files changed).

---

## 0. Layman summary

Three backend changes to the consumer "curated" outing cards (the multi-stop
Romantic / First Date / Adventurous / Group Fun / Take-a-Stroll / Picnic plans):

1. Stops after the anchor now pick a **good place that's also close** (60% quality
   / 40% proximity blend) instead of just the nearest.
2. The order the plan combos are tried is now **deterministic** (was a random
   shuffle that broke collaborative decks) and **rotates the main activity** card-
   to-card so the deck shows variety.
3. **Solo** curated cards now get the same **"is this place open when I'd arrive?"**
   filter that collaborative cards already had — and that filter was fixed so it
   actually reads the real (Google v1 `periods`) hours shape.

No combo expansion, no DB migration, no client/app-mobile changes, no new external API.

---

## 1. Comms ledger

Read on entry. Acknowledged **COMMS-0002** (ORCH-0863 strict-grep backend allowlist
— added `ORCH_1061_BACKEND_ALLOWLIST`, gate green) and **COMMS-0003** (external-API
docs — this ORCH introduces NO new external-API calls; PART 1A/1B are pure
arithmetic, PART 2 parses internally-stored hours strings). Both were WARN+OPEN to
ALL and already factored in spec §9/§10.

---

## 2. Files changed (Old → New receipts)

### `supabase/functions/_shared/curatedStopHours.ts` (NEW)
**Before:** did not exist.
**Now:** single source of truth for the curated open-hours cascade. Exports
`parseSingleRange`, `parseHoursText`, `hourInRanges`, `DAY_NAMES`,
`CURATED_STOP_DURATION`, `ALWAYS_OPEN_TYPES`, `isStopOpenAtHour`,
`filterCuratedByStopHours`. The hours-text parsers + duration/always-open tables
are extracted verbatim from `discover-cards/index.ts`. `isStopOpenAtHour` carries
the **D-1 fix**: a 5-path cascade (ALWAYS_OPEN → no-object→open → Google v1
`periods` → legacy `_periods` → text shape), honest-unknown → OPEN. Previously the
reader only evaluated the legacy text shape, so it fell through to "assume open"
for the ~99.9% periods-shape rows.
**Why:** spec §6.2 (single source of truth, Constitution #6) + D-1 (OQ-3 ACCEPTED).
**Lines:** ~235.

### `supabase/functions/discover-cards/index.ts` (MODIFIED)
**Before:** defined its own `parseSingleRange`/`parseHoursText`/`hourInRanges`/
`DAY_NAMES` (147-221) AND its own curated-specific `CURATED_STOP_DURATION`/
`ALWAYS_OPEN_TYPES`/`isStopOpenAtHour`/`filterCuratedByStopHours` (464-532). The
curated reader was text-only (D-1 bug). `filterByDateTime` used the local parsers.
**Now:** imports all eight symbols from `_shared/curatedStopHours.ts`; the local
definitions are deleted. `filterByDateTime` and both `filterCuratedByStopHours`
call sites (lines ~1363 + ~2150) now resolve to the shared (D-1-fixed) versions —
option (a) per spec §6.3 (ONE parser shared by curated + filterByDateTime).
**Why:** spec §6.3 single-source-of-truth + D-1.
**Lines:** ~145 deleted, ~25 added (imports + comments).

### `supabase/functions/generate-curated-experiences/index.ts` (MODIFIED)
**Before:** post-anchor stops picked by pure-nearest `selectClosestHighestRated`
(both branches); combo ordering via `Math.random` `shuffle()`; `batchSeed`
destructured but never passed to `generateCardsForType`; NO open-hours filter
anywhere (solo gap); `buildCardFromStops` set no card-level `utcOffsetMinutes`/
`lat`/`lng`; `serve()` ran unconditionally at module load.
**Now:**
- **PART 1A:** added pure `selectBlendedStop(available, refLat, refLng, radiusMeters)`
  (0.60 quality / 0.40 proximity; quality = 0.75 vibe-rank-norm + 0.25 rating×log-
  review) + deterministic `tieBreakWins` chain (_rankScore → rating → review_count
  → lexicographic google_place_id). Both post-anchor call sites repointed
  (standard branch → `clampedRadius`; reverse-anchor branch → `3000`). The
  pure-nearest `selectClosestHighestRated` is DELETED (re-grep confirmed it had no
  other call site). First non-optional stop selection (`available[0]`) UNCHANGED.
- **PART 1B:** added pure `mainActivitySlotIndex(typeDef)` + `buildDeterministicComboList(typeDef, batchSeed, limit)`; the `Math.random` shuffle ordering is replaced;
  `shuffle()` is DELETED (unreferenced after the change). `batchSeed` threaded as a
  new (default-0) parameter of `generateCardsForType` and passed at the handler call
  site.
- **PART 2:** imports `filterCuratedByStopHours` from the shared module; the handler
  applies it after `generateCardsForType` returns (`curatedUtcNow = datetimePref ?
  new Date(datetimePref) : new Date()`), with the empty→summary fallback.
  `buildCardFromStops` now emits top-level `utcOffsetMinutes`/`lat`/`lng` (from the
  first main stop) so the shared filter resolves the arrival timezone for solo cards
  the same way it does for collab cards.
- **Testability:** the handler is exported as `handler` and `serve(handler)` is
  guarded by `import.meta.main` (mirrors check-launch-city / places-autocomplete).
  Production behavior is identical (entry module → `import.meta.main` true);
  Deno unit tests can import the pure helpers without starting the server. Exported
  `selectBlendedStop`, `tieBreakWins`, `mainActivitySlotIndex`,
  `buildDeterministicComboList`, `EXPERIENCE_TYPE_MAP` for tests.
**Why:** spec PART 1A §4, PART 1B §5, PART 2 §6.4.
**Lines:** ~+150 / ~-40.

### `supabase/functions/_shared/__tests__/curatedStopHours.test.ts` (NEW)
Implementor happy-path: T-2-01 (closed periods-shape stop dropped, fails-on-revert),
T-2-02 (all-open retained), T-2-02b (no-hours → open), T-2 D-1 (periods read),
empty-after-filter.

### `supabase/functions/generate-curated-experiences/__tests__/orch_1061_blend_and_rotation.test.ts` (NEW)
Implementor happy-path: T-1A-01 (quality-weighted, fails-on-revert), T-1A-03
(deterministic), T-1A-05 (empty/single), T-1B-MAP (slot mapping), T-1B-01
(deterministic ordering), T-1B-02 + T-1B-02b (rotation; stroll rotates food),
T-1B-04 (picnic no rotation), T-1B-05 (batchSeed offset), T-2-07 (empty→summary).

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (MODIFIED)
Added `ORCH_1061_BACKEND_ALLOWLIST` (5 NEW files) + spread (COMMS-0002).

---

## 3. Spec traceability (success criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-1A-1 quality-weighted pick | PASS | T-1A-01 (farther high-quality beats closer weak) |
| SC-1A-2 deterministic | PASS | T-1A-03 |
| SC-1A-3 first stop unchanged | PASS | call-site diff: `isFirstMainStop ? available[0] : selectBlendedStop(...)` |
| SC-1A-4 null/single guards | PASS | T-1A-05 |
| SC-1B-1 deterministic ordering | PASS | T-1B-01 |
| SC-1B-2 main activity rotates | PASS | T-1B-02 |
| SC-1B-3 stroll rotates food, nature constant | PASS | T-1B-02b |
| SC-1B-4 picnic no rotation | PASS | T-1B-04 |
| SC-1B-5 batchSeed changes start offset | PASS | T-1B-05 |
| SC-1B-6 slot mapping | PASS | T-1B-MAP |
| SC-2-1 solo closed stop dropped | PASS | T-2-01 (fails-on-revert) |
| SC-2-2 all-open retained | PASS | T-2-02 |
| SC-2-3 no-hours → open | PASS | T-2-02b |
| SC-2-4 D-1 periods detected | PASS | T-2 D-1 |
| SC-2-5 collab/non-curated preserved | PASS | discover-cards regression suite (39 tests) |
| SC-2-6 empty→summary verdict | PASS | T-2-07 + handler fallback |
| SC-2-7 single source of truth | PASS | grep: defined only in `_shared/curatedStopHours.ts` |

---

## 4. Regression tests + fails-on-revert evidence

Runner: Deno 2.7.14 (`/Users/sethogieva/.deno/bin/deno`).

**All new + affected tests:** `61 passed | 0 failed` (5 curatedStopHours + 10
blend/rotation + 4 curated passthrough + 39 discover-cards regression − overlaps).

### Fails-on-revert (pre-fix base `ab839a953`)

**T-1A-01** — temporarily reverted `selectBlendedStop` to pure-nearest (haversine
min). Result: `T-1A-01 ... FAILED` (pure-nearest picked the closer weak candidate
`A_close_weak` instead of `B_far_strong`). Restored → `T-1A-01 ... ok`.

**T-2-01** — temporarily reverted the D-1 fix (removed Path A `periods` + Path B
`_periods` from `isStopOpenAtHour`, leaving the text-only reader = pre-fix
behavior). Result: `T-2-01 ... FAILED` (the closed periods-shape card slipped
through → retained), plus `T-2 D-1` and the all-closed-empties test also failed.
Restored → all `ok`. Revert method: in-place edit + re-run; base SHA `ab839a953`.

### Discover-cards non-curated path (T-2-06)

`orch_0903`, `orch_0906`, `orch_0909` (×2), `collab_determinism_under_ai_blend`:
`39 passed | 0 failed` — proves the extraction did not break `filterByDateTime` or
the collab determinism contract.

---

## 5. /goal self-assessment

1. **Every SC implemented + demonstrated** — YES (§3 table, all PASS).
2. **Regression test green + fails-on-revert** — YES (T-1A-01 + T-2-01 both proven
   fail-on-revert at base `ab839a953`, restored green).
3. **`deno check` clean on both touched edge fns; new test files lint-clean** — YES
   (`deno check` green on both index.ts; `deno lint` clean on the two new test
   files). NOTE: `deno lint` is NOT a CI gate for `supabase/functions/` (baseline
   discover-cards/index.ts has 53 pre-existing `no-explicit-any` findings — the
   edge-fn house style uses `any`). The new shared module uses `any` for `stop`/
   `cards` to match the byte-for-byte extraction from discover-cards + house style;
   `deno check` (the real type gate) passes.
4. **Constitution scan** — PASS. #3 (no silent failures: filter is pure, no
   swallowed catches), #6 (single source of truth: hours cascade in one file),
   #9 (honest-unknown: no-hours → open, never fabricate closed; `isOpenNow` still
   null when unknown). No UI/RLS/migration layers touched.
5. **Edge fn deploy + verify-first-call** — DEFERRED to orchestrator per dispatch
   (implementor must NOT deploy). Both `generate-curated-experiences` and
   `discover-cards` need redeploy (the new `_shared/curatedStopHours.ts` bundles
   into both). See §7.

All four in-scope clauses hold; clause 5 is the orchestrator-owned deploy.

---

## 6. Preserved gates (spec §7)

All preserved — none touched: `filterMin`, G3 photo gate, fine-dining ≥'bougie'
floor (runs in the `available` filter BEFORE selection), first-stop travel
≤constraint×1.5, dedup (`comboUsedIds` + `globalUsedPlaceIds`), reverse-anchor
failed-anchor cycle (`selectBlendedStop` returns null exactly where
`selectClosestHighestRated` did), empty→summary verdicts (extended for the hours-
empty case). **Collab determinism (I-COLLAB-DECK-DETERMINISM):** NET IMPROVEMENT —
the only request-time `Math.random` in the ordering/selection path (the shuffle)
was REMOVED; blend + rotation are pure functions of request inputs.

**Display-only `Math.random` left untouched (spec §5.5):** tagline pick in
`buildCardFromStops`, the per-card `id` suffix, and the cosmetic `matchScore`. None
affect deck card ordering/identity/selection, so collab determinism is unaffected.

---

## 7. Deploy notes (orchestrator-owned — DO NOT deploy from implementor)

After CLOSE promotes to main, redeploy BOTH (the new shared module bundles into both):
```
supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv
```
No `supabase db push` — zero migrations in this ORCH.

---

## 8. Discoveries for orchestrator

- **`import.meta.main` guard added to generate-curated-experiences** to make the
  pure helpers unit-testable. This is the established codebase pattern
  (check-launch-city etc.) and is production-safe, but it is a structural change to
  the entry module worth noting for the tester's smoke pass.
- **D-1 fix now actually filters collab curated decks too.** Before this ORCH the
  collab curated-hours filter was a near-no-op (text-only reader vs periods-shape
  data). After the fix, collab decks will now drop closed-on-arrival curated cards
  that previously slipped through — expected + correct, but it is a real behavior
  change on the collab path, not just solo. Tester should eyeball that collab
  curated decks aren't over-pruned.

---

## 9. Cross-surface impact

Consumer iOS + Consumer Android only (covered, parity automatic — shared edge fn,
zero client code). Buyer-web / Business iOS / Business Android / Admin / Business-
web-preview: not affected (no curated deck surface). Tester must still eyeball a
real curated deck on one iOS sim AND one Android emulator per the parity rule.
