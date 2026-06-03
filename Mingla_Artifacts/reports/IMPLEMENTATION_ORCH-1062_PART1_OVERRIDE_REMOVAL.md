# IMPLEMENTATION — ORCH-1062 Part 1 [Curated vibe-overrides → user categories]

**Phase:** IMPLEMENT (Part 1 ONLY — backend override removal; Part 2 client pills gated on designer pass)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1062-[vibe-overrides-to-categories]/`
**Branch:** `ORCH-1062-vibe-overrides-to-categories` (off origin/main `cd1437816`)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1062_VIBE_OVERRIDES_TO_CATEGORIES.md` §4 (Part 1)
**Author:** mingla-implementor (Claude), 2026-06-03
**Status:** implemented and verified

---

## 1. Comms ledger

Read on entry. Relevant active rows:
- **COMMS-0002 (WARN, ALL):** ORCH-0863 strict-grep C7 `no-new-backend-files` blocks PRs adding files under `supabase/functions/`. ACTIONED — the one new backend file (the regression test) is allowlisted in the SAME commit as a new `ORCH_1062_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`. Gate run locally green.
- **COMMS-0003 (WARN, ALL):** external-API docs requirement. **N/A** — ORCH-1062 Part 1 touches ZERO external APIs (it only edits an internal signal-mapping dictionary). Factored, nothing to cite.

No new cross-ORCH discovery → no new COMMS entry written.

---

## 2. The exact final override map (LOCKED, SC-1)

```ts
// ORCH-1062: vibe rank-overrides removed. Every non-nature curated stop now ranks
// by its OWN filter signal (resolveStopRankSignal / fetchForCombo fall back to
// COMBO_SLUG_TO_FILTER_SIGNAL[catId] when no override exists). The two NATURE
// overrides are retained because for an OUTDOOR stop the "vibe" IS the quality
// signal: 'scenic' surfaces trails/greenways/gardens over playgrounds, and
// 'picnic_friendly' surfaces tables/shelters/lawns over hiking-heavy preserves.
// Removing the rest kills crossover leaks (e.g. a brunch café winning a "drinks"
// slot because it scored high on the generic 'lively' vibe). Do NOT re-add a
// non-nature override without an operator directive — the own-category score is
// the honest quality signal for every food/activity/drinks/show slot.
const EXPERIENCE_RANK_SIGNAL_OVERRIDE: Record<string, Record<string, string>> = {
  'take-a-stroll': { 'nature': 'scenic' },
  'picnic-dates': { 'nature': 'picnic_friendly' },
};
```

Removed: all `romantic` (3), all `first-date` (7), all `group-fun` (7), all `adventurous` (2), and `take-a-stroll`'s 3 FOOD overrides (brunch/casual_food/upscale_fine_dining → icebreakers). 23 entries → 2.

---

## 3. Files changed + Old → New receipts

### `supabase/functions/generate-curated-experiences/index.ts`
**Before:** `EXPERIENCE_RANK_SIGNAL_OVERRIDE` carried 6 intent keys / 23 override entries that re-ranked curated stops by generic vibe signals (romantic / icebreakers / lively), causing crossover leaks. `resolveStopRankSignal` was a private (non-exported) helper.
**Now:** the map carries exactly the two nature overrides (`take-a-stroll/nature → scenic`, `picnic-dates/nature → picnic_friendly`); comment block trimmed to explain the two survivors + WHY. `resolveStopRankSignal` is now `export`ed (pure function) so the regression test can assert resolved signals directly. No other logic changed.
**Why:** SPEC §4.1 (SC-1) + enabling the regression test (SPEC §8 T-01..T-07).
**Lines changed:** ~60 removed → ~17 (map + comment); +1 `export` keyword + 3-line comment.

### `supabase/functions/generate-curated-experiences/__tests__/orch_1062_override_removal.test.ts` (NEW)
**Before:** did not exist.
**Now:** 6 Deno tests covering SC-1..SC-4 + SC-6 (T-01..T-07). Asserts non-nature stops resolve to own filter signal; nature overrides survive; literal source has only the two nature keys.
**Why:** mandatory regression test (fails-on-revert proven).
**Lines:** ~120 new.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
**Before:** no ORCH-1062 allowlist; C7 would flag the new test file.
**Now:** added `ORCH_1062_BACKEND_ALLOWLIST` (the one new test path) + spread into the aggregate allowed list, immediately after `ORCH_1061_BACKEND_ALLOWLIST`.
**Why:** COMMS-0002 — new backend file must be allowlisted same-commit.
**Lines:** +12.

---

## 4. Fallback correctness verification (SPEC §4.2, SC-6 — verified, no edit)

- `resolveStopRankSignal(typeId, catId)` (index.ts ~424): `EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeId]?.[catId]` is now `undefined` for every non-nature slug → falls through to `COMBO_SLUG_TO_FILTER_SIGNAL[catId]`. ✅ Asserted by T-02/T-03/T-04/T-07.
- `fetchForCombo` (index.ts ~659/714/721): `signalOverride = EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeDef.id]` is `undefined` for non-override intents; `rankOverride = signalOverride?.[catId]` is `undefined`; `rankSignal = rankOverride ?? filterSignal` → ranks by own filter signal. ✅ Confirmed by code-read.
- Both nature paths still resolve to `scenic` / `picnic_friendly`. ✅ Asserted by T-05/T-06.
- No remaining references to removed entries: `rg` confirms `EXPERIENCE_RANK_SIGNAL_OVERRIDE` is read only at the export, `resolveStopRankSignal`, and `fetchForCombo` — all fall back correctly.

---

## 5. Test results

**New regression test (restored/fixed code):**
```
deno test --allow-read --allow-env functions/generate-curated-experiences/__tests__/orch_1062_override_removal.test.ts
ok | 6 passed | 0 failed (7ms)
```

**Fails-on-revert proof:** with the OLD 6-key/23-entry map restored in `index.ts` (export kept), the same test run:
```
FAILED | 1 passed | 5 failed (15ms)
```
Failing: T-01 (literal shape), T-02 (group-fun/casual_food returned `lively`), T-03 (romantic/upscale_fine_dining returned `romantic`), T-04 (first-date/theatre returned `icebreakers`), T-07. Only T-05/T-06 (nature survivors) passed — intentional, those overrides are retained in both maps. The old map was then reverted back to the two-entry map and the test re-run → 6 passed. Fails-on-revert verified against base commit `31907538d060a19bfe557dd150c35e3d265ec419` (HEAD before this fix).

**ORCH-1061 regression suite (re-run, SC-5 / T-08) — all green unchanged:**
```
deno test ... orch_1061_blend_and_rotation.test.ts orch_1061_blend_rotation.adversarial.test.ts \
              _shared/__tests__/curatedStopHours.test.ts _shared/__tests__/curatedStopHours.adversarial.test.ts
ok | 25 passed | 0 failed (628ms)
```
Includes the rotation determinism (T-1B-*), quality-blend (T-1A-*), no-Math.random source-grep (T-1B-06), and solo open-hours gate (T-2-*) tests. The blend/rotation read `_rankScore`; for non-nature stops that is now the own-category score (intended) — the rotation/blend math is unchanged and the tests pass unchanged.

**Collab determinism sanity (discover-cards):**
```
deno test ... discover-cards/__tests__/collab_determinism_under_ai_blend.test.ts
ok | 6 passed | 0 failed (28ms)
```

**`deno check functions/generate-curated-experiences/index.ts`:** clean.
**`deno lint` (new test file):** 0 problems. **index.ts lint:** 33 pre-existing `no-explicit-any` findings, all on untouched lines (e.g. 1657); my diff introduced zero new `any`.

---

## 6. Strict-grep allowlist gate status (COMMS-0002)

```
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
OK   [C7: no-new-backend-files] zero touches under supabase/migrations/ or supabase/functions/
# All checks PASS
```
The new test path is allowlisted in `ORCH_1062_BACKEND_ALLOWLIST`; the gate passes.

---

## 7. Hard-guard compliance

- Part 1 ONLY — no combo/`EXPERIENCE_TYPES` change, no `filterMin`/gate change, no client code, no Part 2. ✅
- ORCH-1061 not regressed — 25/25 green. ✅
- Collab determinism preserved — no new `Math.random`; rotation seed unchanged; removed overrides were deterministic rank-input. T-1B-06 source-grep passes. ✅
- Stayed in worktree; staged only scoped paths; no `git add -A`; no push/deploy/db push. ✅

---

## 8. Invariant verification (SPEC §9)

| Invariant | Preserved? |
|---|---|
| `I-CURATED-LABEL-SOURCE` (label from comboCategory) | Y — untouched |
| Collab determinism contract | Y — no Math.random; seed unchanged |
| Constitution #3 (no silent fallback) | Y — unknown slug still warns+skips in fetchForCombo |
| Constitution #9 (no fabricated data) | Y — filterMin floors + real scores unchanged |
| **I-PROPOSED-1062-OWN-CATEGORY-RANK** (new, DRAFT→ACTIVE on CLOSE) | Established — T-01 locks the literal to two nature keys |

---

## 9. Cross-surface impact

Part 1 is server-only. Reaches consumer iOS + Android decks identically once `generate-curated-experiences` deploys (no OTA, no build). No buyer-web / business / admin surface touched. Parity automatic (one shared edge fn).

---

## 10. Deploy note (for orchestrator — do NOT deploy from here)

Post-merge, the orchestrator deploys:
```
supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
```
No migration, no `db push` for Part 1.

---

## 11. /goal self-assessment

1. **Every spec success criterion (Part 1) implemented + demonstrated** — SC-1 (T-01), SC-2 (T-02), SC-3 (T-03), SC-4 (T-05/06), SC-5 (25/25 ORCH-1061 green), SC-6 (T-07 + fetchForCombo code-read). ✅
2. **Regression test green + fails-on-revert** — 6 pass; 5 fail on revert @ `31907538d`. ✅
3. **Type/lint** — `deno check` clean; new test lint-clean; index.ts lint findings all pre-existing, zero introduced. ✅ (Deno edge fn — `deno check`/`deno lint` are the relevant gates, not `tsc`.)
4. **Constitution** — #3, #9 PASS; others N/A to a dictionary edit. ✅
5. **Edge deploy + verify-first-call** — deferred to orchestrator post-merge per dispatch (do NOT deploy from worktree). Stated, not silently skipped.

Clauses 1–4 hold with captured output; clause 5 is explicitly orchestrator-owned per the dispatch. Part 1 implementation is done.
