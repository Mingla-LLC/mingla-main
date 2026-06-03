# IMPLEMENTATION — ORCH-1062 Part 2 [vibe-category-pills]

**ORCH:** ORCH-1062 Part 2 — Romantic / Lively / Scenic user-pickable category pills, end-to-end (render → select → persist → serve)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1062-[part2-vibe-category-pills]`
**Branch:** `ORCH-1062-part2-vibe-category-pills` (off origin/main `f8b222b81`; pre-fix HEAD `3f37bf9`)
**Skill:** mingla-implementor (Claude parity mirror)
**Date:** 2026-06-03
**Inputs:** DESIGN `Mingla_Artifacts/specs/DESIGN_ORCH-1062_VIBE_CATEGORY_PILLS.md` (commit `3f37bf9`); SPEC `Mingla_Artifacts/specs/SPEC_ORCH-1062_VIBE_OVERRIDES_TO_CATEGORIES.md` §5.

---

## 1. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry.
- **COMMS-0002** (WARN, backend strict-grep allowlist): the new Deno serving test under `supabase/functions/discover-cards/__tests__/` is a NEW backend file. Added it to the existing `ORCH_1062_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit (Part 1 had already created that array; I extended it rather than declaring a duplicate). Gate re-run locally → PASS (C7 green). Factored.
- **COMMS-0003** (WARN, external-API docs): **N/A** — ORCH-1062 introduces/modifies ZERO external-API enums/payloads/endpoints. It only edits internal signal-mapping dictionaries + reads existing `place_scores`/`admin_config` via the existing `query_servable_places_by_signal` RPC. No new ledger entry warranted.

---

## 2. Scope confirmation

Part 1 (curated vibe-override strip) already shipped — NOT touched. This is Part 2 only: add `romantic`/`lively`/`scenic` as three user-pickable preference categories, additive across the consumer-app UI + the serving edge function. ADDITIVE ONLY: no existing pill restyled, no grid-system change, no curated-combo change.

---

## 3. Old → New receipts

### app-mobile/src/components/PreferencesSheet.tsx
**Before:** local module-scope `categories` array had 10 entries (`play` … `upscale_fine_dining`).
**Now:** 3 entries appended after `upscale_fine_dining` — `{id:'romantic',icon:'heart-pulse'}`, `{id:'lively',icon:'flame'}`, `{id:'scenic',icon:'tree-pine'}` — with a DESIGN-cited comment.
**Why:** DESIGN §3/§6 + SPEC §5.3 item 1. These are the rendered pills; order = visual order; flexWrap handles the new row.
**Lines:** +10 (3 data + comment). `experienceTypes` (intents) array left UNTOUCHED — confirms the §5.2 collision guard (intent `romantic`/`heart` vs category `romantic`/`heart-pulse` are distinct arrays/fields/icons).

### app-mobile/src/utils/categoryUtils.ts
**Before:** `VALID_SLUGS` had no vibe slugs; `getCategoryIcon` iconMap had no vibe glyphs.
**Now:** `'romantic','lively','scenic'` added to `VALID_SLUGS` (auto-flows into the derived `VISIBLE_CATEGORY_SLUGS`, none are hidden/legacy); iconMap gains `romantic:'heart-pulse', lively:'flame', scenic:'tree-pine'`.
**Why:** SPEC §5.3 item 4 — slugs must survive normalization/persistence and resolve an icon. Keeps the two visible lists (local `categories` + `VISIBLE_CATEGORY_SLUGS`) consistent per the DESIGN coherence note.
**Lines:** +8.

### app-mobile/src/services/deckService.ts
**Before:** `PILL_TO_CATEGORY_NAME` 12 entries; `CATEGORY_PILL_MAP` had no vibe keys; `DeckPill.deckMode` union had no vibe members.
**Now:** `PILL_TO_CATEGORY_NAME` gains `romantic:'Romantic', lively:'Lively', scenic:'Scenic'`; `CATEGORY_PILL_MAP` gains slug keys `'romantic'/'lively'/'scenic'`; `deckMode` union gains `'romantic' | 'lively' | 'scenic'`.
**Why:** SPEC §5.3 items 2/3/7. **OQ-3 resolved:** the resolvePills loop (deckService.ts:350-351) does `cat.replace(/_/g,' ').toLowerCase()` then falls back to `cat.toLowerCase()` — input is always lowercased, and slug == lowercased display name for all three, so a single slug key resolves both the slug and the "Romantic"/"Lively"/"Scenic" display-name forms. No capitalized keys needed.
**Lines:** +12.

### app-mobile/src/i18n/locales/en/common.json
**Before:** `category_*` block had no vibe labels.
**Now:** `category_romantic:"Romantic"`, `category_lively:"Lively"`, `category_scenic:"Scenic"`.
**Why:** SPEC §5.3 item 5 + DESIGN §5. Pill label is `t('common:category_${id}')` — without these the raw token leaks. English-only acceptable (project falls back to en for missing keys).
**Lines:** +3.

### app-mobile/src/i18n/locales/en/preferences.json
**Before:** `category_descriptions.*` had no vibe entries.
**Now:** `category_descriptions.romantic/lively/scenic` with the exact DESIGN §5 Mingla-voice copy.
**Why:** DESIGN §1.2 + §5 — helper microcopy so the tap-helper row appears like every other pill.
**Lines:** +3.

### app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx
**Before:** `CATEGORY_DESCRIPTION_KEYS` had 12 entries, no vibe keys.
**Now:** `romantic/lively/scenic → category_descriptions.*` added.
**Why:** DESIGN §5 note — wires the description map so the tap helper shows for the new pills (consistent with all existing pills).
**Lines:** +6.

### supabase/functions/discover-cards/index.ts
**Before:** `CATEGORY_TO_SIGNAL` had no vibe entries.
**Now:** 6 entries (display + slug for each) — `Romantic/romantic → {['romantic'],60}`, `Lively/lively → {['lively'],120}`, `Scenic/scenic → {['scenic'],60}`.
**Why:** SPEC §5.2 (LOCKED literal) + operator-locked filterMins (lively=120, romantic=60, scenic=60). Rank-style: filterMin floors noise, `signal_score DESC` orders. Keyed by BOTH display + slug per I-CATEGORY-SIGNAL-ALIAS-COMPLETE. No requiredTypes / primary-type gate.
**Lines:** +13 (6 data + comment).

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
**Before:** `ORCH_1062_BACKEND_ALLOWLIST` (Part 1) listed only the override-removal test.
**Now:** appended `supabase/functions/discover-cards/__tests__/orch_1062_vibe_category_signals.test.ts`.
**Why:** COMMS-0002 — the new backend test file must be allowlisted same-commit or C7 `no-new-backend-files` fails.
**Lines:** +6.

### app-mobile/src/utils/__tests__/orch_1062_vibe_categories.test.ts (NEW)
Deno unit test: `VISIBLE_CATEGORY_SLUGS` contains the 3 vibe slugs; `getCategoryIcon` returns the 3 glyphs; existing categories unchanged + hidden/legacy not leaked. Uses the pure exports (RN-free import seam).

### supabase/functions/discover-cards/__tests__/orch_1062_vibe_category_signals.test.ts (NEW)
Deno serving test: parses `CATEGORY_TO_SIGNAL` from source (established `Deno.readTextFile` pattern, avoids booting `serve()`); asserts each vibe category → own signal + locked filterMin, keyed by slug AND display name.

---

## 4. Icon existence confirmation (HARD GUARD)

All 3 glyph names already exist in `Icon.tsx` `ICON_MAP` AND are imported — verified, NO new lucide import added:
- `flame` → Flame (ICON_MAP L290; import L74)
- `heart-pulse` → HeartPulse (ICON_MAP L311; import L85)
- `tree-pine` → TreePine (ICON_MAP L448; import L168)

None contain `-outline`, so the `.replace('-outline','')` at PreferencesSections.tsx:192 is a no-op → identical glyph in selected/unselected states. No null-render risk.

---

## 5. Test results

Deno 2.7.14 (`/Users/sethogieva/.deno/bin/deno`).

**New tests — PASS:**
```
app-mobile/src/utils/__tests__/orch_1062_vibe_categories.test.ts          ok | 3 passed | 0 failed
supabase/functions/discover-cards/__tests__/orch_1062_vibe_category_signals.test.ts  ok | 3 passed | 0 failed
```

**Fails-on-revert proof @ `3f37bf9`:** `git stash push -- app-mobile/src/utils/categoryUtils.ts supabase/functions/discover-cards/index.ts` (reverts only the two source files, keeps tests), re-ran:
```
categoryUtils test:    FAILED | 1 passed | 2 failed   (T-15a + T-15b fail: slugs absent / icon falls back to 'location')
discover-cards test:   FAILED | 0 passed | 3 failed   (all entries absent → regex returns undefined)
```
Restored via `git stash pop`; re-ran both → `ok | 6 passed | 0 failed`.

**discover-cards regression (full suite) — PASS, no regression:**
```
supabase/functions/discover-cards/__tests__/  →  ok | 51 passed | 0 failed (236ms)
```
(48 pre-existing + 3 new.)

**deno check** `supabase/functions/discover-cards/index.ts` → clean.

**strict-grep gate** (`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`) → `# All checks PASS` (C7 green; 1 backend file changed, allowlisted).

**tsc --noEmit (app-mobile):** ZERO errors in any touched file (`PreferencesSheet.tsx`, `PreferencesSections.tsx`, `categoryUtils.ts`, `deckService.ts`). The errors emitted are all in unrelated pre-existing files (BoardDiscussion, ConnectionsPage, TripCard, payments tests) + sibling `packages/*` whose node_modules aren't resolved through the worktree symlink — pre-existing worktree noise, not introduced by this ORCH.

**eslint (touched files):** my additions introduced ZERO new problems. The 2 `react/no-unescaped-entities` errors (PreferencesSheet:1140, PreferencesSections:109) and all warnings pre-exist far from my data-only additions.

---

## 6. Spec traceability (success criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-7-iOS / SC-7-Android (pills render) | UNVERIFIED (rides next native build) | Pills + i18n + icons wired; render is a device/sim check. OTA deferred per `project_ota_deferred_until_new_build.md` — tester verifies on sim/emu post-build. |
| SC-8 (Lively deck serves) | Implemented; runtime UNVERIFIED | `CATEGORY_TO_SIGNAL['lively']={['lively'],120}`; deploy-then-deck check is tester's. |
| SC-9 (Scenic thin-city @60) | Implemented; runtime UNVERIFIED | filterMin 60 per coverage probe; live deck = tester. |
| SC-10 (category vs intent no collision) | PASS | `experienceTypes` untouched; category `romantic` only in `categories` array, distinct icon; travels in `categories[]` vs `intents[]`. |
| SC-11 (CATEGORY_TO_SIGNAL correct for 6 keys) | PASS | Deno serving test asserts all 6. |
| SC-12 (no regression to existing 10) | PASS | Full discover-cards suite green; categoryUtils T-15c asserts existing glyphs/visibility unchanged. |
| T-15 (slug validation + icon) | PASS | categoryUtils test green + fails-on-revert. |

Runtime SCs (SC-7/8/9) require the native build + live deck run — correctly the tester's lane (consumer app, OTA-deferred). All static/contract criteria PASS with cited evidence.

---

## 7. Invariants

- **I-CATEGORY-SIGNAL-ALIAS-COMPLETE** — both display + slug keyed for all 3. ✅ (serving test asserts).
- **I-SIGNALIDS-ALWAYS-ARRAY** — each entry `signalIds:['<one>']` length 1. ✅
- Collab determinism — no `Math.random`, no rotation change; single-card category path is solo prefs. ✅
- ORCH-0424 multi-select no-caps — slugs added to free-text arrays, no cap touched. ✅
- Constitution #3 (no silent fallback) — new slugs are now KNOWN; unknown still warns+skips. ✅

---

## 8. Cross-surface impact

Per SPEC §3: Consumer iOS + Consumer Android only (shared RN code + shared edge fn → parity automatic). Buyer-web / Business iOS/Android / Admin / Business-web preview = N/A (no consumer deck/preferences surface). Server side (discover-cards) is a no-op until a client sends the new slug.

---

## 9. Deploy / build split

- **Serving (discover-cards):** needs redeploy post-merge — `supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv`. No-op for existing clients until a client sends the new slug. No DB migration (admin_config serving-pct already 100 for all three; no schema/CHECK change).
- **Client (pills + maps + i18n + icons):** rides the NEXT NATIVE BUILD. Do NOT `eas update`/OTA per `project_ota_deferred_until_new_build.md`.

---

## 10. Discoveries for orchestrator

- **OQ-3 resolved** (not a defect): `resolvePills` lowercases input, so slug-only keys cover display-name forms for these three. Documented inline.
- No side issues found.

---

## /goal self-assessment

1. **Every spec criterion implemented + demonstrated** — static/contract SCs (SC-10/11/12, T-15) PASS with cited test output; runtime SCs (SC-7/8/9) are device/live-deck checks correctly deferred to the tester post-native-build (genuine environment limit: OTA deferred, consumer app). ✅ (with named UNVERIFIED runtime criteria + the exact verification owner).
2. **Regression test green + fails-on-revert @ cited hash** — 6 passed; fails-on-revert proven @ `3f37bf9` (2+3 failures on revert). ✅
3. **tsc clean + lint clean on touched files** — zero tsc errors + zero new lint problems in all 4 touched src files; remaining diagnostics pre-exist in unrelated files / worktree symlink noise. ✅
4. **Constitution rules** — relevant rules PASS (see §7). No fabricated data, no silent fallback, no caps. ✅
5. **Edge fn deployed + verify-first-call** — NOT done from worktree per the deploy split (orchestrator deploys discover-cards from main post-merge). Stated exact command in §9. ✅ (deploy authority is orchestrator's per worktree discipline rule 4; flagged for post-merge).

Verdict: implementation complete for all static contracts; runtime + deploy handed off per the worktree/OTA discipline with exact commands.
