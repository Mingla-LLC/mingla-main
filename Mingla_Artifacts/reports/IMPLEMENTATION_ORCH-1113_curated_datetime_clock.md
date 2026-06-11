# IMPLEMENTATION — ORCH-1113 [curated-experience-empty-deck-regression]

- **Mode:** IMPLEMENT (executed the binding SPEC `SPEC_ORCH-1113_curated_datetime_clock.md`)
- **Date:** 2026-06-11
- **Author:** mingla-implementor (Claude)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1113-[curated-datetime-clock]/` on branch `ORCH-1113-curated-datetime-clock`
- **Status:** implemented and verified (Deno gates + edge typecheck + happy-path fails-on-revert). Client TS typecheck/jest UNVERIFIED — no tsc/jest harness installed in this worktree (see §6).
- **Comms ledger:** read on entry. No OPEN BLOCK/WARN row targets `mingla-implementor`, `ORCH-1113`, or `ALL`. No new COMMS entry written (no cross-ORCH discovery).

---

## 1. Summary

When a user opened a curated multi-stop "intent card" deck, the curated open-hours cascade decided whether each stop was open by evaluating it against the **stale stored `datetime_pref`** (a fixed timestamp that can be weeks old) and **never read the user's `date_option`**. For a remote/custom location (e.g. Brussels) whose stored instant lands at night locally, every vibe's required stop read "closed," the deck emptied, and it was mislabeled `pool_empty` → "No spots match right now." Single cards were immune because the singles path uses the live device clock for `today`.

This change brings the curated cascade to parity with single cards' `filterByDateTime`: a new shared `resolveCuratedHoursPolicy` resolves the evaluation policy from `date_option`/`selected_dates` — `today`/`now`/empty → **live clock** instant; `this_weekend` → open-at-ANY-hour on Sat or Sun; `pick_dates` → open-at-ANY-hour on the selected day(s); unknown → safe live-clock default. Both curated edge functions (solo `generate-curated-experiences`, collab `discover-cards`) now compute the policy via that single helper and thread `dateOption`/`selectedDates` from the client. The dishonest hardcoded `pool_empty` is replaced with a distinct `all_closed_at_time` reason **only when cards were built then all hours-dropped**; the consumer empty-state copy branches on it ("Everything's closed right now"). ORCH-1061's same-day "don't serve a closed venue right now" drop and Constitution #9 honest-unknown are preserved.

---

## 2. SPEC success-criteria coverage

| SC | Description | Verified by | Commit | Status |
|----|-------------|-------------|--------|--------|
| SC-1 | `today` + stale pref + Brussels → assembles when open at LIVE clock | T-01 (Deno, fails-on-revert) | `4f600d3f6` | ✓ |
| SC-2 | `this_weekend` → open-at-any-hour on Sat/Sun | T-03 (Deno) | `4f600d3f6` | ✓ |
| SC-3 | `pick_dates` + `selected_dates` → selected weekday | T-05 (Deno) | `4f600d3f6` | ✓ |
| SC-4 | preserve ORCH-1061: `today` 03:00 local still drops closed | T-02 (Deno) | `4f600d3f6` | ✓ |
| SC-5 | honest reason: built→dropped = `all_closed_at_time`; empty pool = `pool_empty` | edge fn `builtCount` branch (index.ts:1768-1775) | `4f600d3f6` | ✓ (source-verified; runtime UNVERIFIED — no deploy) |
| SC-6-iOS / SC-6-Android | empty-state copy branch on `all_closed_at_time` | SwipeableCards.tsx title/subtitle branch | `4f600d3f6` | ✓ (source-verified; sim/device UNVERIFIED — tester) |
| SC-7 | client forwards `dateOption`+`selectedDates` to the edge fn | curatedExperiencesService + deckService forwarding | `4f600d3f6` | ✓ (source-verified) |
| SC-8 | collab path uses same resolver; filter idempotent | T-11 (Deno) + discover-cards both call sites | `4f600d3f6` | ✓ |

---

## 3. Files changed (closing diff vs origin/main — 40 files, +742/−23)

**Product code (allowlist):**
- `supabase/functions/_shared/curatedStopHours.ts` (+139/−~8) — added `CuratedHoursPolicy` type, `resolveCuratedHoursPolicy`, `isStopOpenAtHourAnyTime`; widened `filterCuratedByStopHours` to `CuratedHoursPolicy | Date`.
- `supabase/functions/generate-curated-experiences/index.ts` (+50/−~8) — import resolver; parse+validate `dateOption`/`selectedDates`; build policy; honest `all_closed_at_time`/`pool_empty` via `builtCount`; extended local `CuratedEmptyReason` union.
- `supabase/functions/discover-cards/index.ts` (+22/−~6) — import resolver; routed BOTH curated call sites (aggregate path ~1557, primary path ~2396) through `resolveCuratedHoursPolicy`.
- `app-mobile/src/types/curatedExperience.ts` (+7/−1) — extended `CuratedEmptyReason` with `all_closed_at_time`.
- `app-mobile/src/services/curatedExperiencesService.ts` (+17) — added `dateOption`/`selectedDates` params; conditional forwarding into the edge body.
- `app-mobile/src/services/deckService.ts` (+17) — added `selectedDates` to `DeckParams`; forward `dateOption`+`selectedDates` in the curated call; extended aggregation precedence to `pipeline_error > no_viable_anchor > all_closed_at_time > pool_empty`.
- `app-mobile/src/contexts/RecommendationsContext.tsx` (+10) — added solo-visible `curatedEmptyReason` to the context interface + value.
- `app-mobile/src/components/SwipeableCards.tsx` (+18/−~4) — read `curatedEmptyReason`; branch empty-state title + subtitle on `all_closed_at_time`.
- `app-mobile/src/i18n/locales/*/cards.json` (29 files, +2 each) — `swipeable.all_closed_title` + `swipeable.all_closed_subtitle` (EN verbatim; 28 others EN + `@needs_translation`).

**Tests (allowlist):**
- `supabase/functions/_shared/__tests__/curatedStopHours.test.ts` (+159, additions only) — T-01..T-06, T-11, T-11b, T-12.
- `supabase/functions/_shared/__tests__/curatedStopHours.adversarial.test.ts` (+15/−5, `[TEST-MOD-APPROVED ORCH-1113]`) — corrected two pre-existing ORCH-1061 assertions invalidated by this fix.

**Artifact:** `Mingla_Artifacts/specs/SPEC_ORCH-1113_curated_datetime_clock.md` (the binding spec, +253).

---

## 4. Data-model / edge / migration changes

- **Data-model:** NONE. No SQL, RPC, or migration touched (region/supply DISPROVEN per investigation; hard guard held).
- **Edge functions touched (to deploy from MERGED main, orchestrator/operator-owned):**
  - `supabase/functions/generate-curated-experiences/index.ts` — preserve its existing `verify_jwt` setting (unchanged by this ORCH).
  - `supabase/functions/discover-cards/index.ts` — preserve its existing `verify_jwt` setting (unchanged).
  - `supabase/functions/_shared/curatedStopHours.ts` — shared module, bundled into both above; no standalone deploy.
- **No edge deploy performed by the implementor.**

---

## 5. Regression tests added — fails-on-revert proof

**Happy-path implementor test:** `supabase/functions/_shared/__tests__/curatedStopHours.test.ts` — `T-01 (fails-on-revert): 'today' uses the LIVE clock, NOT the stale datetime_pref`.

A Brussels-offset curated card (`utcOffsetMinutes=120`) with a single restaurant stop open Wed 11:00–23:00, evaluated under `dateOption='today'` with a weeks-stale `datetimePref='2026-04-15T21:20:44.492Z'` (→ 23:20 Brussels = closed) and an injected live `now` at Brussels noon (→ 12:00 = open). With the fix the policy is `{mode:'instant', utcNow:<live now>}` → card RETAINED.

**Passing run (fix in place):**
```
deno test --allow-read functions/_shared/__tests__/curatedStopHours.test.ts
ok | 14 passed | 0 failed (4ms)
T-01 (fails-on-revert): 'today' uses the LIVE clock, NOT the stale datetime_pref ... ok
```

**Fails-on-revert (true line deletion of the fix):** reverted the `today` branch of `resolveCuratedHoursPolicy` to the pre-fix `utcNow: opts.datetimePref ? new Date(opts.datetimePref) : now` (the stale-pref-preferring behavior named in SPEC §9). Re-run:
```
T-01 (fails-on-revert): 'today' uses the LIVE clock, NOT the stale datetime_pref ... FAILED
T-06 (ORCH-1113): unknown/empty dateOption defaults to live-clock instant ... FAILED
FAILED | 12 passed | 2 failed
```
**`fails-on-revert verified at commit b878049323424515ea67c57a9c4765a47e0502a0`** (the transient `[ORCH-1113-DIAG] TRANSIENT fails-on-revert proof` commit). The fix was then restored at commit `28333d19ccc3ce58fdc21b9e93a82a4f219897bd` (14/14 pass again). The transient DIAG commit remains in branch history as the captured evidence; no DIAG marker remains in product code (verified by grep).

**Additional Deno coverage:** T-02 (preserve ORCH-1061 close-now drop), T-03/T-04 (this_weekend), T-05 (pick_dates), T-06 (safe default), T-11/T-11b (idempotence + isStopOpenAtHourAnyTime), T-12 (bare-Date back-compat). All pass.

---

## 6. Gate results

| Gate | Command | Result |
|------|---------|--------|
| Shared module Deno tests | `deno test --allow-read functions/_shared/__tests__/curatedStopHours.test.ts` | **14 passed / 0 failed** |
| Shared + adversarial | `deno test ... curatedStopHours.test.ts curatedStopHours.adversarial.test.ts` | **19 passed / 0 failed** |
| Handler curated tests | `deno test ... functions/generate-curated-experiences/__tests__/` | **35 passed / 0 failed** |
| Combined (shared + adv + handler) | (all three) | **54 passed / 0 failed** |
| Edge typecheck (solo) | `deno check functions/generate-curated-experiences/index.ts` | **Check OK** |
| Edge typecheck (collab) | `deno check functions/discover-cards/index.ts` | **Check OK** |
| Strict-grep: I-CURATED-HOURS-VIA-CANONICAL-READER | `node .../i-curated-hours-via-canonical-reader.mjs` | **OK** (441 files scanned; no direct day-key lookup) |
| Strict-grep: ORCH-0828 no date-only string ctor | `node .../orch-0828-no-date-only-string-constructor.mjs` | **PASS** |
| Strict-grep: discover excludes ended | `node .../i-discover-excludes-ended-master-date.mjs` | **PASS** |
| Append-only test gate | `node .github/scripts/test-append-only-check.js` | **2 passed / 0 failed** (adversarial mod approved via token; new tests additions-only) |
| Client TS typecheck | n/a | **UNVERIFIED** — no `tsc` binary in `app-mobile/node_modules/.bin`; no `typecheck` script. Operator/CI must run the repo's TS check. |
| Client jest | n/a | **UNVERIFIED** — app-mobile uses node `scripts/ci/*.mjs` regression checks, not a jest harness; no jest present. SC-6/SC-7/SC-9/SC-10 client assertions are source-verified only and belong to the tester's adversarial pass per SPEC §9. |

**Pre-existing unrelated gate failure (NOT introduced by this ORCH):** `orch-0910-chat-payload-curated-aware.mjs` FAILs on `buildCardDataPayload synthesizes curated image and images from stops` — confirmed failing identically on the clean tree with my changes stashed; the file it scans was never touched by ORCH-1113. See Discoveries.

---

## 7. Old → New receipts

### `_shared/curatedStopHours.ts`
- **Before:** `filterCuratedByStopHours(cards, utcNow: Date)` evaluated every curated stop against a single instant the caller supplied (callers preferred the stale stored `datetime_pref`). No date-option awareness.
- **Now:** added `resolveCuratedHoursPolicy(opts)` (the single date-option authority), `isStopOpenAtHourAnyTime(stop, day)` (any-period-on-day predicate mirroring discover-cards' `isOpenAnyTimeOnDay`), and `CuratedHoursPolicy` type. `filterCuratedByStopHours(cards, policy: CuratedHoursPolicy | Date)` now handles `instant` mode (the unchanged arrival cascade) and `anyHourOnDays` mode (open-at-any-hour on target days, no wall-clock arrival cascade). A bare `Date` is treated as `{mode:'instant'}` for back-compat.
- **Why:** SC-1/SC-2/SC-3/SC-8; the ROOT-CAUSE-v4 fix. **Lines:** +139.

### `generate-curated-experiences/index.ts`
- **Before:** `const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date(); cards = filterCuratedByStopHours(cards, curatedUtcNow);` then hardcoded `summary = { emptyReason: 'pool_empty', ... }` when empty.
- **Now:** parses + defensively validates `dateOption`/`selectedDates`; `const hoursPolicy = resolveCuratedHoursPolicy({ dateOption, datetimePref, selectedDates }); const builtCount = cards.length; cards = filterCuratedByStopHours(cards, hoursPolicy);` then `summary = builtCount > 0 ? all_closed_at_time : pool_empty`. Local `CuratedEmptyReason` union extended.
- **Why:** SC-1/SC-5/SC-7. **Lines:** +50.

### `discover-cards/index.ts`
- **Before:** both curated call sites: `const curatedUtcNow = (agg.)datetimePref ? new Date(...) : new Date();`.
- **Now:** both call `resolveCuratedHoursPolicy(...)`. Primary path (line ~2396) passes the in-scope `dateOption`/`selectedDates`; aggregate path (line ~1557) passes `'today'` (the aggregate exposes no date option — same `'today'` already used for `filterByDateTime` two lines up).
- **Why:** SC-8 collab parity (latent equivalent defect). **Lines:** +22.

### `curatedExperience.ts` / `curatedExperiencesService.ts` / `deckService.ts`
- **Before:** union of 3 reasons; no date-option params on the curated client call; aggregation precedence `pipeline_error > no_viable_anchor > pool_empty`.
- **Now:** union of 4 (`all_closed_at_time`); `dateOption`/`selectedDates` params forwarded conditionally; precedence `pipeline_error > no_viable_anchor > all_closed_at_time > pool_empty`.
- **Why:** SC-5/SC-7. **Lines:** +7/+17/+17.

### `RecommendationsContext.tsx` / `SwipeableCards.tsx` / `cards.json`
- **Before:** the curated empty reason was surfaced to the component only for collab (`collabDeckDeadEndReason`); empty-state title/subtitle were always the generic "No spots match right now".
- **Now:** context exposes a solo+collab `curatedEmptyReason`; SwipeableCards branches title→`all_closed_title` and subtitle→`all_closed_subtitle` when the reason is `all_closed_at_time`; all 29 locales carry the two new keys.
- **Why:** SC-6. **Lines:** +10/+18/+2×29.

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | YES — curated deck assembles for remote locations at an open date_option; honest "everything's closed" copy | shared edge + RN → automatic with Android |
| 2 | Consumer Android | YES — same | automatic (shared code) |
| 3 | Buyer/anon Web | no — no consumer curated deck on web | — |
| 4 | Business iOS | no — no curated intent deck | — |
| 5 | Business Android | no — same | — |
| 6 | Admin Web | no — no curated deck | — |
| 7 | Business Web preview | no — no curated deck | — |

iOS/Android parity is automatic: the shared edge functions and shared RN client code serve both platforms identically.

---

## 9. Smoke result

No sim/device run performed (implementor scope: source + Deno gates). The load-bearing logic is fully exercised by the 54 passing Deno tests including the T-01 fails-on-revert proof and the edge typechecks. Sim/device confirmation (reset `datetime_pref` stale, switch to a remote evening location, select a curated vibe under each date_option; observe the deck populates and the `all_closed_at_time` copy fires) is the tester's job per SPEC §9/§11.

---

## 10. Known issues / deferred

- **`selectedDates` client wiring stops at `DeckParams`.** `useDeckCards.ts` (the context→service bridge) is NOT in the allowlist, so `selectedDates` is added to `DeckParams` + forwarded to the edge fn but is `undefined` in practice until a future wiring threads `userPrefs.selected_dates` through the hook. This is harmless: for `pick_dates` the edge resolver falls back to `[datetimePref]` then `[now]` (SPEC §2 assumption), and the core regression (`today` Brussels) needs no `selectedDates`. `dateOption` IS fully wired end-to-end. Flagged for a follow-on if `pick_dates` precision is desired.
- **Client TS typecheck + jest UNVERIFIED** — no harness installed in this worktree (see §6). The client changes are strict-mode-clean by inspection (explicit types, no `any` introduced, guarded optional access).

---

## 11. Operator action required

- **Migration `db push`:** NONE — no migration in this ORCH.
- **Edge deploy (from MERGED main, after REVIEW + tester PASS):**
  ```bash
  # deploy from the anchor on merged main, NOT from this worktree (clobber hazard):
  cd /Users/sethogieva/Desktop/mingla-main && git checkout main && git pull
  /Users/sethogieva/bin/supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
  /Users/sethogieva/bin/supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv
  ```
  Preserve each function's existing `verify_jwt` value (unchanged by this ORCH).
- **OTA per-platform** (consumer app) after deploy + tester PASS, per the per-platform OTA rule.
- **CI:** the `[TEST-MOD-APPROVED ORCH-1113]` token must remain in the latest commit body touching the adversarial test (it is — commit `9a7daadfc`).

---

## 12. Discoveries for Orchestrator

1. **Pre-existing failing strict-grep gate (unrelated):** `orch-0910-chat-payload-curated-aware.mjs` fails on `buildCardDataPayload synthesizes curated image and images from stops` — confirmed failing on the clean origin/main tree (changes stashed) in a file ORCH-1113 never touched. Should be registered as its own bug if not already tracked. Did NOT fix (out of scope).
2. **ORCH-1061 adversarial test had over-strict assertions** that hard-coded the exact pre-fix wiring (sole-import shape + the literal `datetimePref ? new Date(...) : new Date()` start-time line). These were legitimately invalidated by the SPEC-mandated change; corrected minimally under `[TEST-MOD-APPROVED ORCH-1113]` (assertions (a) relaxed, (c) re-pointed at the policy resolver; (b)/(d) and all other tests untouched). The tester owns the new adversarial coverage per SPEC §9.
3. **No jest/tsc harness in `app-mobile`** in this worktree — client-side regression in this repo is node `scripts/ci/*.mjs` convention. If client unit coverage for the copy branch / aggregation precedence is desired, it would be a `scripts/ci/orch-1113-*.mjs` check (not specced; left to the tester).
4. **Collab open question (SPEC §10) resolved without amendment:** `aggregateSessionPreferences` exposes only `datetimePref` (no `dateOption`/`selectedDates`), and this fn's collab branch is the teaser/aggregate path — the primary collab curated deck runs through `discover-cards`' deterministic handler (where `dateOption`/`selectedDates` ARE in scope and now wired). So the solo fn's collab branch falls back to body values per §10; no new aggregation field added, no STOP required.

---

## Resolution of the collab open question (§10)

`aggregateSessionPreferences` (generate-curated-experiences/index.ts:321-330) returns `{ categories, experienceTypes, budgetMin, budgetMax, travelMode, travelConstraintValue, datetimePref?, location }` — it exposes **neither `dateOption` nor `selectedDates`**. Per SPEC §10, this fn's collab branch is the teaser/aggregate path (the primary collab curated supply runs through `discover-cards`' deterministic path, which is wired). Therefore the solo fn uses the body values for `dateOption`/`selectedDates`, and `discover-cards`' aggregate curated call site uses `'today'` (matching the `'today'` already passed to `filterByDateTime` there). No new aggregation column/field was added; no SPEC amendment requested. The condition that would require a STOP ("the aggregate path is the PRIMARY collab curated supply AND lacks date context") does not hold — the primary collab supply is the deterministic handler, which has full date context.
