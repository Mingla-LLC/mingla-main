# QA — ORCH-1062 Part 2 [vibe-category-pills]

**Skill:** mingla-tester (Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1062-[part2-vibe-category-pills]`
**Branch:** `ORCH-1062-part2-vibe-category-pills`
**Implement commit under test:** `8579810ae` (off origin/main `f8b222b81`)
**TEST commit (this work):** `49736124c`
**Inputs:** SPEC `Mingla_Artifacts/specs/SPEC_ORCH-1062_VIBE_OVERRIDES_TO_CATEGORIES.md`; DESIGN `Mingla_Artifacts/specs/DESIGN_ORCH-1062_VIBE_CATEGORY_PILLS.md`; IMPLEMENTATION `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1062_PART2_VIBE_PILLS.md`.

---

## VERDICT: CONDITIONAL PASS

CONDITIONAL only because **SC-7 (pills RENDER on iOS/Android) cannot be `proven` on a sim today** — the pills appear exclusively via a new native build (OTA is deferred per `project_ota_deferred_until_new_build.md`), so they are not present in any currently-installed dev-build bundle, and pointing a Metro at this worktree would collide with another live session's booted sim/Metro (shared-anchor hazard). Every static/serving/data contract is **PASS with captured evidence**. Render is deferred to the operator-assisted native-build pass — this is a genuine environment limit (OTA-deferred consumer JS), not a skippable sim boot.

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 | **P4:** 2
- **Report:** `Mingla_Artifacts/reports/QA_ORCH-1062_PART2_VIBE_PILLS.md`
- **Sim evidence:** SC-7-iOS / SC-7-Android = POST-NATIVE-BUILD operator-assisted (confidence `suspected`→render, `proven`→all wiring static). Backend/serving = source-only EXEMPT (edge-fn + Deno; backend-only is a stated exemption).
- **Regression tests:** implementor=`app-mobile/src/utils/__tests__/orch_1062_vibe_categories.test.ts` + `supabase/functions/discover-cards/__tests__/orch_1062_vibe_category_signals.test.ts` (happy-path; fails-on-revert proven by implementor @ `3f37bf9`, independently re-verified) | tester=`supabase/functions/discover-cards/__tests__/orch_1062_vibe_category_adversarial.test.ts` (adversarial; fails-on-revert proven below @ origin/main `f8b222b81`).

---

## 1. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` row addressed to `mingla-tester`, `ORCH-1062`, or `ALL` required action.
- **COMMS-0002** (WARN, ALL) — backend strict-grep allowlist. Factored: my new backend test file `orch_1062_vibe_category_adversarial.test.ts` was added to `ORCH_1062_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit. C7 re-run green (see §5).
- **COMMS-0003** (WARN, ALL) — external-API docs. N/A: ORCH-1062 touches zero external-API enums/payloads/endpoints (internal signal dictionaries + existing RPC only).
- No new ledger entry warranted (no cross-ORCH discovery).

---

## 2. What was independently verified (not trusted from the report)

### 2.1 Serving contract (`discover-cards/index.ts` `CATEGORY_TO_SIGNAL`)
Read the actual literal (index.ts:104–124 region). All 6 entries present and correct:
- `Romantic`/`romantic` → `{signalIds:['romantic'], filterMin:60}`
- `Lively`/`lively` → `{signalIds:['lively'], filterMin:120}`
- `Scenic`/`scenic` → `{signalIds:['scenic'], filterMin:60}`
Both display-name AND slug keyed (I-CATEGORY-SIGNAL-ALIAS-COMPLETE). Each single-signal (I-SIGNALIDS-ALWAYS-ARRAY).

### 2.2 filterMin enforcement (the real mechanism)
The filterMin is passed to RPC `query_servable_places_by_signal` as `p_filter_min`; the RPC filters `AND ps.score >= p_filter_min` (read at `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`). So the boundary is **inclusive at the floor**: score `< floor` EXCLUDED, `>= floor` INCLUDED. My adversarial test pins both the parsed filterMin AND the SQL predicate so a retune OR a `>`-loosening trips it.

### 2.3 SC-10 — category vs intent non-collision (end-to-end)
- **Server:** `romantic` is in BOTH `SESSION_INTENT_IDS` (curated path, bare id) and `CATEGORY_TO_SIGNAL` (single-card path, `{signal,filterMin}`). They are resolved by DIFFERENT dictionaries and travel in DIFFERENT request fields (`intents[]` vs `categories[]`). `lively`/`scenic` are NOT in `SESSION_INTENT_IDS`. The curated single-card path (`resolveCategories`→`CATEGORY_TO_SIGNAL`) never reads the intent set, and the curated-experiences path never reads `CATEGORY_TO_SIGNAL` for a category serving target.
- **Client:** `experienceTypes` array (intents, PreferencesSheet.tsx:104) carries `romantic` with icon `heart`; the separate `categories` array (line 117) carries `romantic` with icon `heart-pulse`. Two arrays, two icons, two description maps (`experience_descriptions.romantic` vs `category_descriptions.romantic`). No overwrite.

### 2.4 Client wiring (static, all confirmed present)
- `VISIBLE_CATEGORY_SLUGS` contains `romantic`/`lively`/`scenic` (derived from `VALID_SLUGS`; not in `HIDDEN_CATEGORY_SLUGS={groceries,flowers}` nor `LEGACY_CATEGORY_SLUGS`).
- `getCategoryIcon` returns `heart-pulse`/`flame`/`tree-pine` for the three.
- i18n labels exist: `category_romantic/lively/scenic` in `en/common.json` (L75–77) → no raw `category_*` token leak.
- i18n descriptions exist: `category_descriptions.romantic/lively/scenic` in `en/preferences.json` (L29–31) + wired in `CATEGORY_DESCRIPTION_KEYS` (PreferencesSections.tsx:146–148).
- All 3 icon glyphs exist in `Icon.tsx ICON_MAP` AND are imported: `flame`→Flame (map L290, import L74), `heart-pulse`→HeartPulse (map L311, import L85), `tree-pine`→TreePine (map L448, import L168). None contain `-outline` → `.replace('-outline','')` is a no-op (identical glyph selected/unselected). No null-render risk.
- `deckService` `PILL_TO_CATEGORY_NAME` (+3), `CATEGORY_PILL_MAP` (+3 slug keys), `DeckPill.deckMode` union (+3) all present.

### 2.5 Test re-runs (captured)
| Suite | Result |
|---|---|
| Full `discover-cards/__tests__/` (incl. new adversarial) | **60 passed | 0 failed** |
| `app-mobile/src/utils/__tests__/orch_1062_vibe_categories.test.ts` | **3 passed | 0 failed** |
| Tester adversarial `orch_1062_vibe_category_adversarial.test.ts` | **9 passed | 0 failed** |
| `tsc --noEmit` (app-mobile) | 260 errors total, **ZERO in any of the 5 touched src files** — all 260 are pre-existing worktree noise (`Cannot find name 'Deno'` on Deno test files type-checked by RN tsc + symlinked package resolution). Not introduced by this ORCH. |
| strict-grep gate (`orch-0863...mjs`) | **# All checks PASS** (C7 green: 13 files changed, new backend test allowlisted) |

### 2.6 Fails-on-revert proof (tester adversarial)
Reverted ONLY `supabase/functions/discover-cards/index.ts` to origin/main (`f8b222b81`), kept the test, re-ran:
```
FAILED | 4 passed | 5 failed
```
The 5 failures are exactly the tests bound to the implementor's serving change (vibe entries present/resolve/boundary/alias). The 4 survivors correctly test invariants resilient to the revert (intent set NOT containing lively/scenic — true regardless; SQL predicate — unchanged file). Restored to HEAD → 9/9 green. **Proven.**

---

## 3. Data sanity (Supabase, live, 2026-06-03)

`place_scores` JOIN `place_pool` (is_servable + has photos), thin-city focus per SC-8/SC-9:

| signal | Baltimore ≥60 | Baltimore ≥120 | Brussels ≥60 | Brussels ≥120 | served @ chosen floor in Baltimore |
|---|---|---|---|---|---|
| romantic (floor 60) | 159 | 29 | 318 | 30 | **159** (healthy) |
| scenic (floor 60) | 132 | 5 | 209 | 5 | **132** (healthy; would be 5 at 120 — floor 60 is the right call) |
| lively (floor 120) | 126 | 7 | 187 | 15 | **7** (non-empty but shallow — see P3-01) |

`admin_config` serving-pct: `signal_serving_romantic_pct`/`lively_pct`/`scenic_pct` all = **100** → cohort gate satisfied, no admin seeding needed.

**SC-8/SC-9: PASS** — all three decks are non-empty at their chosen floors in the thinnest seeded city. scenic@60 and romantic@60 are correctly relaxed; lively@120 is non-empty everywhere but thin in Baltimore (P3-01).

---

## 4. Findings

- **P3-01 (data, low):** `lively` at its locked floor 120 yields only **7** servable rows in Baltimore (and 15 in Brussels). The deck won't be empty, but in the thinnest seeded cities a lively-only deck is shallow and will exhaust fast / lean heavily on degraded fill. The SPEC chose 120 because lively coverage is rich *in aggregate* (2,872 rows ≥120 across all cities), which is true, but the thin-city tail is thinner than romantic/scenic at their relaxed floors. NOT a blocker (non-empty, matches the locked SPEC value, consistent with the existing `fine_dining`/`drinks`=120 floors). Flag for operator: if lively decks feel sparse in small markets, consider relaxing to ~80–100 in a follow-up (same precedent as movies=80). Out of this ORCH's locked scope.
- **P4-01 (praise):** The icon-existence + import double-check (Icon.tsx ICON_MAP AND import line, plus the `-outline` no-op proof) is exactly the diligence that prevents a silent null-render. Clean.
- **P4-02 (praise):** SC-10 was honored at BOTH layers without anyone re-touching `experienceTypes` — the additive discipline (distinct array, distinct icon, distinct description namespace) is correct and self-documenting.

No P0, no P1, no P2.

---

## 5. Constitution spot-check (relevant rules)
- **#3 no silent failures** — PASS. New slugs are now KNOWN; unknown chip still warns + skips (index.ts:1848). filterMin floors still applied.
- **#9 no fabricated data** — PASS. Real `place_scores` ranked by real `signal_score DESC`; floors exclude noise, never fabricate.
- **#13 exclusion consistency** — PASS. The same `score >= filterMin` floor gates serving; no generation/serving divergence introduced.
- Collab determinism — PASS. No `Math.random`, single-card category path is solo prefs; rotation seed untouched.

---

## 6. Cross-platform confidence statement

**SC-7-iOS / SC-7-Android (pills render): POST-NATIVE-BUILD, operator-assisted.** Confidence `suspected` on visible render (per the sim-repro rule, source-only maxes at `suspected` for a UI change), but `proven` on every wiring precondition that determines render: pills are in the rendered `categories` array; labels resolve via `t('common:category_${id})` and the keys exist (no token leak); icons exist + are imported (no null glyph); slugs are visible + valid + not hidden/legacy. The pills cannot appear via OTA (deferred); they ride the next native build. An iOS sim + Metro + Android devices are present on this machine but belong to another live session — pointing them at this worktree is the exact node_modules/Metro rabbit-hole + shared-anchor collision the dispatch and operator memory forbid for a JS-bundle change. Recommended operator smoke after the next build: open PreferencesSheet, scroll to the categories grid, confirm Romantic/Lively/Scenic render at the end with correct labels + a clean 2+1 wrap at 360dp (per DESIGN §3.3), tap each to see the helper microcopy, then run a Lively-only and a Scenic-only (Baltimore) deck and confirm non-empty cards.

---

## /goal self-assessment (TEST completion predicate)

1. **Every independent test green** — ✅ 60 (discover-cards full) + 3 (categoryUtils) + 9 (adversarial), all captured.
2. **`tsc --noEmit` clean on touched files** — ✅ zero errors in the 5 touched src files (260 total are pre-existing Deno/symlink noise, proven by sampling + per-file grep). Backend Deno files `deno check` clean per implementor + my suite running clean.
3. **Both regression tests in `origin/main...HEAD`; adversarial attacks a different angle; implementor fails-on-revert @ cited hash** — ✅ all three test files in the diff; adversarial covers intent/category non-collision + `>=` boundary + alias no-drift + single-signal (distinct from the happy-path presence/value test); implementor fails-on-revert @ `3f37bf9` cited + independently re-verified; tester fails-on-revert @ `f8b222b81` proven (5/9 fail on revert).
4. **UI/runtime platform legs at `proven`** — ⚠ NOT met for SC-7 render: genuine environment limit (OTA-deferred consumer JS; pills only in a future native build; shared sim/Metro belongs to another session). Marked POST-NATIVE-BUILD operator-assisted per the dispatch's explicit cross-platform-honesty instruction, NOT as a shortcut. This is why the verdict is CONDITIONAL, not PASS.
5. **Zero open P0 / P1** — ✅ 0 P0, 0 P1 (1 P3 data note, 2 P4 praise).

Clauses 1, 2, 3, 5 hold with captured evidence. Clause 4 is the sole reason for CONDITIONAL: the render leg is environment-blocked (native build pending), correctly deferred to operator with a precise smoke recipe. Recommended close path: orchestrator merges + deploys `discover-cards` from main; the client pills ride the next native build, at which point the operator confirms SC-7 with the §6 recipe.
