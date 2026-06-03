# SPEC — ORCH-1062 [Curated vibe-overrides → user categories]

**Status:** SPEC (ready for IMPLEMENT, Part 1 only; Part 2 gated on designer pass + native build)
**Severity:** S2-medium / `quality-gap` + `ux`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1062-[vibe-overrides-to-categories]/`
**Branch:** `ORCH-1062-vibe-overrides-to-categories` (off origin/main `cd1437816` — contains shipped ORCH-1061)
**Author:** mingla-forensics (SPEC mode), 2026-06-02
**Driver:** operator 2026-06-02

---

## 0. Layman summary

Two things. **(Part 1, ships now via edge deploy):** Today the curated experiences ("Romantic", "Group Fun", "First Date", etc.) secretly re-rank each stop by a generic "vibe" score instead of by what that stop actually is — so a brunch café could win a "drinks" slot because it scored well on "lively". We strip all those vibe overrides EXCEPT the two that genuinely help (the two outdoor "Nature" stops, where "scenic"/"picnic-friendly" IS the right quality signal). After this every non-nature curated stop is ranked by its own category, killing the crossover leaks. **(Part 2, rides the next native build):** we add three new categories the user can pick directly for their solo deck — **Romantic**, **Lively**, **Scenic** — so the vibes that were being force-injected become honest, opt-in filters. All three have strong place-score coverage in every seeded city.

---

## 1. Investigation basis (source-of-truth reads)

This SPEC is grounded in direct reads of the live code + a live DB coverage probe (no prior investigation report; the dispatch carried the root cause + fix shape, verified here).

**Part 1 — confirmed by reading `supabase/functions/generate-curated-experiences/index.ts`:**
- `EXPERIENCE_RANK_SIGNAL_OVERRIDE` map: index.ts:408–466. Six type keys, 23 total override entries.
- `resolveStopRankSignal(typeId, catId)`: index.ts:472–474 — returns `EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeId]?.[catId] ?? COMBO_SLUG_TO_FILTER_SIGNAL[catId]`. **Falls back correctly** to the slot's own filter signal when no override exists. ✅
- `fetchForCombo` rankOverride: index.ts:707 (`const signalOverride = EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeDef.id]`), index.ts:714 (`const rankOverride = signalOverride?.[catId]`), index.ts:721 (`const rankSignal = rankOverride ?? filterSignal; // no override → rank by filter signal itself`). **Falls back correctly.** ✅
- `COMBO_SLUG_TO_FILTER_SIGNAL` lives in `_shared/signalRankFetch.ts:89–110` (single source of truth, shared with `stopAlternatives.ts` + the replace flow). Every non-nature slug already maps to its own signal.
- ORCH-1061 (just shipped) `_rankScore`/quality-blend + deterministic rotation: `buildDeterministicComboList` (index.ts:764) seeds off `batchSeed`; the quality blend reads `_rankScore` which is the score the row was fetched-and-ranked by inside `fetchSinglesForSignalRank`. After Part 1, `_rankScore` for non-nature stops becomes the OWN-category score (was the vibe score). This is the intended behavior change; it does NOT alter the rotation algorithm or the blend math — only the input score per row.

**Part 2 — confirmed by reading the full consumer→serving chain:**
- Preferences pill list (the authoritative list the user picks for the deck): `app-mobile/src/components/PreferencesSheet.tsx:117–128` — `const categories = [...]`, 10 entries `{ id, label, icon }`. Rendered by `CategoriesSection` in `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx:150–207` via `filteredCategories` (= `categories`, PreferencesSheet.tsx:544). Pill label resolved through i18n `t('common:category_${id}')` (PreferencesSections.tsx:202).
- `PILL_TO_CATEGORY_NAME`: `app-mobile/src/services/deckService.ts:163–177` (pill id → display name sent to edge fn).
- `resolvePills` + `CATEGORY_PILL_MAP`: `app-mobile/src/services/deckService.ts:274` / :288 (slug + display-name → canonical pill id; both forms keyed for pre/post-OTA).
- `CATEGORY_TO_SIGNAL`: `supabase/functions/discover-cards/index.ts:68–112` — display-name AND slug both keyed → `{ signalIds[], filterMin, displayCategory }`. Single-card serving resolver.
- Single-card filter+rank: `discover-cards/index.ts:1834–1967` — per chip, cohort-check each signal (`getSignalServingPct`, index.ts:42–56, reads `admin_config` key `signal_serving_${signalId}_pct`), then `query_servable_places_by_signal` RPC (index.ts:1902) filters `score >= p_filter_min` and the result is sorted `signal_score DESC` (index.ts:1963). So a "category" = (one signal, one filterMin floor) and the score ORDERS within the floor.
- Slug registries that must also learn the new slugs: `app-mobile/src/utils/categoryUtils.ts` `VALID_SLUGS` (:50), `getCategoryIcon` iconMap (:261), `VISIBLE_CATEGORY_SLUGS` (derived, :67); i18n `app-mobile/src/i18n/locales/en/common.json` `category_*` keys (:62+); `CATEGORY_DESCRIPTION_KEYS` in PreferencesSections.tsx:131; `SwipeableCards.tsx` deckMode union + `deckService.ts:DeckPill` deckMode union (type-only).

**Live DB coverage probe (Supabase MCP, 2026-06-02) — `place_scores` JOIN `place_pool`:**

| signal | total rows | ≥120 | ≥60 | cities | avg | max |
|---|---|---|---|---|---|---|
| `lively` | 21,568 | 2,925 | 8,327 | 9 | 58.3 | 200 |
| `scenic` | 21,087 | 792 | 5,606 | 9 | 45.0 | 200 |
| `romantic` | 21,551 | 754 | 3,456 | 9 | 27.1 | 200 |
| `fine_dining` (baseline) | 20,967 | 759 | 3,383 | 9 | 34.7 | 200 |

Per-real-city ≥120 floor (the thin tail): `scenic` Washington 62 / Lagos 64 / Raleigh 145 / Fort Lauderdale 168, but Baltimore 5 / Brussels 5. `romantic` ≥120: Lagos 24 / Cary 26 / Baltimore 29 / Brussels 31. `lively` ≥120 is rich everywhere (139–1,205). At ≥60: romantic 100–160 and scenic 130–209 even in the thinnest real cities.

**`admin_config` serving-pct probe:** `signal_serving_romantic_pct`, `signal_serving_lively_pct`, `signal_serving_scenic_pct` ALL already = `100`. **Cohort gate is already satisfied — no admin_config seeding required.** (These rows exist because the curated path already exercises these signals via the vibe overrides; they are live at 100%.)

**No DB CHECK constraint** on any stored categories array — categories are free-text string[]; adding new slugs is schema-safe.

---

## 2. Scope and non-goals

### In scope
- **Part 1 (backend):** reduce `EXPERIENCE_RANK_SIGNAL_OVERRIDE` to exactly the two nature overrides. Regression-proof against ORCH-1061.
- **Part 2 (consumer app + serving):** add `romantic`, `lively`, `scenic` as three new user-pickable preference categories, wired end-to-end (pill list → deckService maps → discover-cards `CATEGORY_TO_SIGNAL` → RPC), with a defined `filterMin` per signal and i18n/icon/validation registration.

### Non-goals (explicit)
- **NO combo expansion / NO change to `EXPERIENCE_TYPES` combos or `typeDef.combos`.** The curated intents' stop structure is untouched.
- **NO change to `filterMin`/gates of existing categories, the photo-gate, the fine-dining floor, the flowers primary-type gate, or `COMBO_SLUG_FILTER_MIN`.**
- **NO change to the ORCH-1061 rotation algorithm, quality-blend math, or solo open-hours gate** — only the per-row input score changes for non-nature curated stops (intended).
- **NO new category in the curated `EXPERIENCE_RANK_SIGNAL_OVERRIDE`** — romantic/lively/scenic become SINGLE-CARD categories, not curated-stop vibe overrides.
- **NO collab-determinism change.** Part 1 preserves it (overrides removed are pure rank-input; rotation seed unchanged). Part 2 single-card path is solo deck preferences.
- **NO admin_config migration** (serving-pct already 100 for all three).
- **NO web/business/admin work.** Curated + single-card preference deck are consumer-app only.

### Assumptions
- The three signals' `place_scores` rows are current (last scored within the seeding window). Probe confirms population; freshness not separately audited (not required — ORCH scope is wiring, not rescoring).
- Operator wants all three categories visible immediately on the next native build (no staged cohort rollout) — serving-pct already 100 supports this.

---

## 3. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ Part 1 (auto via edge) + Part 2 | Part 1: curated decks rank stops by own category (server-side, no client change). Part 2: 3 new pills appear in PreferencesSheet; selecting one serves single cards by that signal. Files: PreferencesSheet.tsx, PreferencesSections.tsx, deckService.ts, categoryUtils.ts, common.json. Parity with Android = **automatic** (shared RN code + shared edge fn). |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ same as iOS | Same shared code path. Verify pill wrapping in the 5×2→ now larger grid renders on narrow Android widths (360dp). |
| 3 | **Buyer/anonymous Web** (`mingla-business/` checkout + public pages) | ❌ | No deck/preferences surface exists on buyer-web; categories are a consumer-app concept. |
| 4 | **Business iOS** (`mingla-business/` iOS) | ❌ | No consumer deck/preferences in the business app. |
| 5 | **Business Android** (`mingla-business/` Android) | ❌ | Same. |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ | Admin does not render the preferences sheet. (admin_config already has the serving-pct rows; no admin UI change needed.) |
| 7 | **Business Web preview** | ❌ | N/A. |

**Part 1 has ZERO client surface** — it is a server-only ranking change that reaches both iOS + Android consumer decks identically the moment the edge fn deploys (no OTA, no build). **Part 2 is consumer iOS + Android only and RIDES THE NEXT NATIVE BUILD** (OTA deferred per operator memory `project_ota_deferred_until_new_build.md`). The discover-cards `CATEGORY_TO_SIGNAL` addition (server side of Part 2) can deploy immediately and is a no-op until a client sends the new slug.

Parity is automatic for both surfaces (one shared RN codebase + one shared edge function). No per-surface manual code paths → single success-criteria set suffices, but tester MUST still verify the pill renders + serves on BOTH iOS sim and Android emulator (Part 2).

---

## 4. PART 1 — Backend: strip vibe overrides except the two nature ones

### 4.1 The exact post-removal map (LOCKED)

Replace the entire `EXPERIENCE_RANK_SIGNAL_OVERRIDE` literal (index.ts:408–466) with EXACTLY:

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

**Removed (23 entries → 2):** all of `romantic` (creative_arts/theatre/upscale_fine_dining → romantic), all of `first-date` (7 → icebreakers), all of `group-fun` (7 → lively), all of `adventurous` (2 → lively), and `take-a-stroll`'s 3 FOOD overrides (brunch/casual_food/upscale_fine_dining → icebreakers) — keeping ONLY `take-a-stroll`'s `nature → scenic` and `picnic-dates`'s `nature → picnic_friendly`.

### 4.2 Fallback correctness (LOCKED — verify, do not change)

After the literal is replaced, the implementor MUST confirm (no code change needed, these already fall back correctly — this is a verification gate, not an edit):
- `resolveStopRankSignal` (index.ts:472–474): for any non-nature slug, `EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeId]?.[catId]` is now `undefined` → falls through to `COMBO_SLUG_TO_FILTER_SIGNAL[catId]`. The value stamped on `stop.rankSignal` therefore equals the own-category filter signal. ✅
- `fetchForCombo` (index.ts:714, :721): `signalOverride?.[catId]` is `undefined` for non-nature → `rankSignal = filterSignal`. The RPC ranks the stop's candidate list by its own filter signal. ✅
- Both nature paths (`take-a-stroll/nature`, `picnic-dates/nature`) still resolve to `scenic` / `picnic_friendly` exactly as before. ✅

### 4.3 ORCH-1061 non-regression (LOCKED)

- `buildDeterministicComboList` + the quality-blend read `_rankScore`, which is produced inside `fetchSinglesForSignalRank` from the resolved `rankSignal`. After Part 1, `_rankScore` for non-nature stops is the own-category score. **This is the intended change.** The rotation algorithm (seeded off `batchSeed`), the blend weighting, the anchor descent, and the solo open-hours gate (`filterCuratedByStopHours`) are UNCHANGED.
- The two nature stops' `_rankScore` is identical to pre-ORCH-1062 (overrides retained) → ORCH-1061 nature behavior is byte-identical.
- Collab determinism preserved: no `Math.random`, seed unchanged, the removed overrides were pure rank-signal selection (deterministic both before and after).

### 4.4 Part 1 files
- `supabase/functions/generate-curated-experiences/index.ts` — replace lines 408–466 (the `EXPERIENCE_RANK_SIGNAL_OVERRIDE` literal) with §4.1.
- (no other Part-1 file changes)

---

## 5. PART 2 — Consumer app + serving: add Romantic, Lively, Scenic categories

### 5.1 The category→signal serving contract (LOCKED)

Each new category = one quality-grounded signal served as a single-card filter+rank. **filterMin decision (grounded in the §1 coverage probe):**

| Category (pill id) | Display label | Signal | filterMin | Rationale (LOCKED) |
|---|---|---|---|---|
| `romantic` | Romantic | `romantic` | **60** | At 120 the thinnest real cities (Baltimore 29, Brussels 31, Lagos 24, Cary 26) would starve a single-card deck. The romantic score is rank-style (it ORDERS quality; the floor only excludes the clearly-irrelevant). 60 keeps ≥100 candidates in every seeded city while still excluding noise. Mirrors the `movies=80` relaxed-floor precedent (tiny universe → lower floor). |
| `lively` | Lively | `lively` | **120** | Coverage is rich everywhere (≥120 = 139–1,205 per real city). The full 120 floor is honest and leaves deep candidate pools. No relaxation needed. |
| `scenic` | Scenic | `scenic` | **60** | At 120 Baltimore (5) and Brussels (5) starve; at 60 they hold 132/209. Scenic is rank-style like romantic. 60 keeps every seeded city viable. |

These three are **rank-style (quality-grounded) FILTER categories**: the signal both (a) gates via `filterMin` floor in `query_servable_places_by_signal` and (b) orders the result `signal_score DESC`. They do NOT need a `requiredTypes` sub-filter or a primary-type gate (those are for type-bounded slugs like hiking/museum/flowers). Cohort serving is already at 100% (admin_config rows exist), so no cohort/admin work.

### 5.2 Edge function — `discover-cards/index.ts` `CATEGORY_TO_SIGNAL` (LOCKED)

Add, alongside the existing entries (keep BOTH display-name AND slug keyed per invariant `I-CATEGORY-SIGNAL-ALIAS-COMPLETE`):

```ts
  // ORCH-1062 — three quality-grounded "vibe" signals promoted to user-pickable
  // categories. Rank-style: filterMin floors out noise, signal_score DESC orders.
  // romantic/scenic use filterMin=60 (thin-city coverage; the score ORDERS quality);
  // lively uses 120 (rich coverage everywhere). place_scores coverage + serving-pct=100
  // verified live 2026-06-02 (see SPEC §1). No requiredTypes / primary-type gate.
  'Romantic': { signalIds: ['romantic'], filterMin: 60,  displayCategory: 'Romantic' },
  'romantic': { signalIds: ['romantic'], filterMin: 60,  displayCategory: 'Romantic' },
  'Lively':   { signalIds: ['lively'],   filterMin: 120, displayCategory: 'Lively' },
  'lively':   { signalIds: ['lively'],   filterMin: 120, displayCategory: 'Lively' },
  'Scenic':   { signalIds: ['scenic'],   filterMin: 60,  displayCategory: 'Scenic' },
  'scenic':   { signalIds: ['scenic'],   filterMin: 60,  displayCategory: 'Scenic' },
```

> ⚠ Naming collision guard: the pill id `romantic` collides with the curated INTENT id `romantic` (in `SESSION_INTENT_IDS`, discover-cards:140–147, and `experienceTypes` in PreferencesSheet.tsx:105). They live in DIFFERENT arrays (categories vs intents) and travel in DIFFERENT request fields (`categories[]` vs `intents[]`), so there is NO runtime collision in `CATEGORY_TO_SIGNAL` (keyed by chip) vs `SESSION_INTENT_IDS` (keyed by intent). The implementor MUST verify the pill is added ONLY to the `categories` list, never to `experienceTypes`. This is an explicit test (T-09).

### 5.3 Consumer app wiring (LOCKED file-by-file)

1. **`app-mobile/src/components/PreferencesSheet.tsx:117–128`** — append three entries to `const categories`:
```ts
  { id: 'romantic',            label: 'Romantic',               icon: 'heart-outline' },
  { id: 'lively',              label: 'Lively',                 icon: 'sparkles' },        // OPEN: designer may prefer a distinct glyph (sparkles is already used by icebreakers)
  { id: 'scenic',              label: 'Scenic',                 icon: 'mountain-snow' },   // OPEN: designer to confirm available lucide/icon name
```
   Grid is now 13 chips (was 10). The 5×2 balance comment (PreferencesSheet.tsx:116) is stale after this — DESIGN pass owns the new visual order + grid balance (see §7).

2. **`app-mobile/src/services/deckService.ts:163–177` (`PILL_TO_CATEGORY_NAME`)** — add:
```ts
  romantic: 'Romantic',
  lively: 'Lively',
  scenic: 'Scenic',
```

3. **`app-mobile/src/services/deckService.ts:288+` (`CATEGORY_PILL_MAP` inside `resolvePills`)** — add both slug + display-name forms:
```ts
  'romantic': 'romantic',
  'lively': 'lively',
  'scenic': 'scenic',
  'romantic ': 'romantic', // (no — do not add stray) — add the display-name key instead:
```
   Correct entries (slug + lowercased display name):
```ts
  'romantic': 'romantic',
  'lively': 'lively',
  'scenic': 'scenic',
```
   (display names equal slugs case-insensitively for these three, so the slug key + the existing case-insensitive lookup cover both; verify resolvePills lowercases — if it does NOT lowercase, also add `'Romantic'`/`'Lively'`/`'Scenic'`. Implementor MUST read the exact lookup at deckService.ts:288 region and key whatever forms it compares against.)

4. **`app-mobile/src/utils/categoryUtils.ts`:**
   - `VALID_SLUGS` (:50) — add `'romantic'`, `'lively'`, `'scenic'`.
   - `getCategoryIcon` iconMap (:261) — add `'romantic': 'heart-outline'`, `'lively': '<glyph>'`, `'scenic': '<glyph>'` (match PreferencesSheet icons exactly).
   - `VISIBLE_CATEGORY_SLUGS` (:67) is derived from `VALID_SLUGS` minus hidden/legacy — adding to `VALID_SLUGS` auto-includes them as visible. Confirm none are added to `LEGACY_CATEGORY_SLUGS`.

5. **`app-mobile/src/i18n/locales/en/common.json`** — add `"category_romantic": "Romantic"`, `"category_lively": "Lively"`, `"category_scenic": "Scenic"`. (Other locale files: add the same keys with English fallback if the project's i18n requires every locale to carry every key; if missing keys fall back to `en`, English-only is acceptable — implementor checks the i18n missing-key policy.)

6. **`app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx:131` (`CATEGORY_DESCRIPTION_KEYS`)** — OPTIONAL: add `romantic`/`lively`/`scenic` description keys + matching `preferences:category_descriptions.*` strings IF the team wants the helper microcopy on tap. If omitted, the helper text simply doesn't show for these three (graceful — the `&& CATEGORY_DESCRIPTION_KEYS[...]` guard at PreferencesSections.tsx:208 already handles absence). DESIGN pass decides (copy is its lane).

7. **Type unions (type-only, no runtime effect):** `app-mobile/src/services/deckService.ts` `DeckPill.deckMode` union + `app-mobile/src/components/SwipeableCards.tsx` deckMode union — add `'romantic' | 'lively' | 'scenic'` so TS compiles. Implementor greps for the deckMode union literal and extends every copy.

### 5.4 Part 2 deploy/build split (LOCKED)
- **Server side (discover-cards `CATEGORY_TO_SIGNAL`)**: deploys immediately via edge deploy; no-op until a client sends the new slug. Safe to ship with Part 1.
- **Client side (pills + maps + i18n + icons)**: RIDES THE NEXT NATIVE BUILD. Do NOT `eas update`/OTA per `project_ota_deferred_until_new_build.md`. The merged code rides the next fresh build the operator publishes.

---

## 6. Success criteria (observable / testable / unambiguous)

**Part 1:**
- **SC-1** `EXPERIENCE_RANK_SIGNAL_OVERRIDE` contains exactly two keys (`take-a-stroll`, `picnic-dates`), each with exactly one entry (`nature → scenic`, `nature → picnic_friendly`). No other keys/entries.
- **SC-2** For a `group-fun` deck, the Food stop's `rankSignal` (stamped on the stop) equals the slot's own filter signal (e.g. `casual_food` / `fine_dining`), NOT `lively`. Verified by deterministic unit test asserting `resolveStopRankSignal('group-fun','casual_food') === 'casual_food'` and `=== COMBO_SLUG_TO_FILTER_SIGNAL['casual_food']`.
- **SC-3** For a `romantic` deck, `resolveStopRankSignal('romantic','upscale_fine_dining') === 'fine_dining'` (own signal), not `'romantic'`.
- **SC-4** `take-a-stroll` nature stop still ranks by `scenic`; `picnic-dates` nature stop still ranks by `picnic_friendly` (`resolveStopRankSignal` returns those exact values).
- **SC-5** ORCH-1061 rotation/blend/hours Deno tests pass unchanged (re-run; see §8).
- **SC-6** `fetchForCombo` for any non-nature slug computes `rankSignal === filterSignal` (override path returns undefined). Asserted via a focused test or by code-read confirmation in the implementation report.

**Part 2:**
- **SC-7-iOS / SC-7-Android** Three new pills (Romantic, Lively, Scenic) render in the PreferencesSheet categories grid on iOS sim AND Android emulator, with correct labels (no raw `category_romantic` token leak) and tappable selected/unselected states.
- **SC-8** Selecting only "Lively" and running the deck returns single cards; `discover-cards` resolves `lively` (filterMin 120), RPC returns rows, cards render. (Verify via edge-fn log path != `pool-empty:no_mapped_chips` and != `no_signals_in_cohort`.)
- **SC-9** Selecting only "Scenic" in a thin-coverage city (e.g. Baltimore) returns a non-empty deck at filterMin 60 (would have been near-empty at 120). Asserted via DB read (≥60 count) + a live deck run.
- **SC-10** Selecting "Romantic" as a CATEGORY pill does not collide with the "Romantic" curated INTENT — both can be selected, the category serves single cards via `categories[]` while the intent serves curated cards via `intents[]`; neither overwrites the other's request field. (T-09.)
- **SC-11** `discover-cards` `CATEGORY_TO_SIGNAL` returns the right `{signalIds, filterMin, displayCategory}` for all six new keys (3 display + 3 slug).
- **SC-12** No regression to the existing 10 categories (their `CATEGORY_TO_SIGNAL` entries, filterMins, pill rendering unchanged).

---

## 7. Designer pass (REQUIRED for Part 2)

**A `mingla-designer` DESIGN pass is REQUIRED before Part-2 client implement.** Reasons:
- The categories grid grows 10 → 13 chips; the existing "balanced 5×2 grid" (PreferencesSheet.tsx:116) no longer holds. The designer owns the new chip order, grid balance/wrapping at 360–430dp, and visual rhythm.
- Two of the three need icon decisions: `lively` (sparkles is already used by `icebreakers` — needs a distinct glyph), `scenic` (confirm an available icon name in the project's icon set — `mountain-snow` is a placeholder). `romantic` (heart-outline) collides visually with the Romantic INTENT's `heart` icon — designer decides whether to differentiate.
- Optional helper microcopy (`category_descriptions.romantic/lively/scenic`) is Mingla-voice copy — designer's lane.
- The designer must pin: pill token colors for selected/unselected/press (the sheet uses `#eb7825` accent + `#6b7280`/`#ffffff` text per PreferencesSections.tsx), contrast ratios, and the all-states grid layout. Output to `Mingla_Artifacts/specs/DESIGN_ORCH-1062_VIBE_CATEGORY_PILLS.md`, referenced by this SPEC.

**Functional contract (this SPEC) is LOCKED; the visual contract is delegated to the designer pass and is a prerequisite for Part-2 IMPLEMENT.** Part 1 needs NO designer pass (server-only).

### 🎨 OPEN (handed to implementor craft, within the locked floor)
- Exact final icon glyphs for `lively`/`scenic` (within the project icon set; must be distinct + legible) — designer proposes, implementor wires.
- Whether helper microcopy is added for the three (graceful absence is acceptable).
- Pill insertion order within the grid (designer-led; any order that keeps balanced wrapping is acceptable).
- Micro-interaction feel on pill select (press scale/haptic) — match existing pill behavior; tasteful polish allowed.

### 🔒 LOCKED
- The signal mapping + filterMin per category (§5.1), the `CATEGORY_TO_SIGNAL` literal (§5.2), all slug-registry additions (§5.3 items 2–7), the deploy/build split (§5.4), Part 1 in full (§4), no-combo / no-gate-change guards (§2), the naming-collision guard (§5.2), and every success criterion (§6).

---

## 8. Test plan

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Override map shape | read `EXPERIENCE_RANK_SIGNAL_OVERRIDE` | exactly `{take-a-stroll:{nature:scenic}, picnic-dates:{nature:picnic_friendly}}` | Edge (unit) |
| T-02 | Non-nature own-signal | `resolveStopRankSignal('group-fun','casual_food')` | `'casual_food'` | Edge (unit) |
| T-03 | Romantic dinner own-signal | `resolveStopRankSignal('romantic','upscale_fine_dining')` | `'fine_dining'` | Edge (unit) |
| T-04 | First-date theatre own-signal | `resolveStopRankSignal('first-date','theatre')` | `'theatre'` (not icebreakers) | Edge (unit) |
| T-05 | Nature override retained (stroll) | `resolveStopRankSignal('take-a-stroll','nature')` | `'scenic'` | Edge (unit) |
| T-06 | Nature override retained (picnic) | `resolveStopRankSignal('picnic-dates','nature')` | `'picnic_friendly'` | Edge (unit) |
| T-07 | fetchForCombo fallback | non-nature slug, no override | `rankSignal === filterSignal` | Edge (unit/read) |
| T-08 | ORCH-1061 rotation/blend/hours | re-run existing ORCH-1061 Deno tests | all pass unchanged | Edge (regression) |
| T-09 | category vs intent collision | select Romantic pill + Romantic intent | category→`categories[]`, intent→`intents[]`; both serve; no overwrite | Service + Edge |
| T-10 | CATEGORY_TO_SIGNAL coverage | lookup all 6 new keys | correct `{signalIds,filterMin,displayCategory}`; romantic/scenic=60, lively=120 | Edge (unit) |
| T-11 | Lively deck serves | categories=['lively'] | non-empty cards, RPC fires, path != pool-empty | Full stack |
| T-12 | Scenic thin-city | categories=['scenic'], Baltimore coords | non-empty at filterMin 60 | Full stack + DB |
| T-13-iOS | Pills render iOS | open PreferencesSheet | 3 new pills, correct labels, no token leak | Component (sim) |
| T-13-Android | Pills render Android | open PreferencesSheet | same, grid wraps cleanly at 360dp | Component (emu) |
| T-14 | Existing categories regression | select Fine Dining / Movies | unchanged behavior + filterMins | Full stack |
| T-15 | Slug validation | `VALID_SLUGS` + `getCategoryIcon` | 3 new slugs valid + iconed; not in LEGACY set | Util (unit) |

**ORCH-1061 regression command (run in test plan):** locate + run the ORCH-1061 Deno tests (rotation/blend/solo-hours). Find via:
```bash
cd "$HOME/Desktop/mingla-orchs/ORCH-1062-[vibe-overrides-to-categories]"
rg -rln "ORCH-1061|buildDeterministicComboList|filterCuratedByStopHours" supabase/functions/**/__tests__ supabase/**/__tests__ 2>/dev/null
deno test --allow-env --allow-read <those files>
```

---

## 9. Invariants

**Preserved:**
- `I-CURATED-LABEL-SOURCE` — stop label still sourced from `comboCategory`; untouched.
- `I-CATEGORY-SIGNAL-ALIAS-COMPLETE` — new categories keyed by BOTH display name AND slug in `CATEGORY_TO_SIGNAL`. ✅ (§5.2)
- `I-SIGNALIDS-ALWAYS-ARRAY` — each new entry has `signalIds: ['<one>']` (length 1). ✅
- Collab determinism contract — no `Math.random` introduced; rotation seed unchanged; removed overrides were deterministic rank-input. ✅
- Constitution #3 (no silent fallback) — unknown slug still warns + skips in both curated (`fetchForCombo` index.ts:710–712) and single-card (discover-cards:1837) paths; new slugs are now KNOWN. ✅
- Constitution #9 (no fabricated data) — filterMin floors still applied; cards still ranked by real scores. ✅

**New:**
- **I-PROPOSED-1062-OWN-CATEGORY-RANK** (DRAFT → ACTIVE on CLOSE): every non-nature curated stop ranks by its own `COMBO_SLUG_TO_FILTER_SIGNAL` signal; `EXPERIENCE_RANK_SIGNAL_OVERRIDE` contains ONLY the two nature overrides. Guarded by T-01..T-06 + optionally a strict-grep that asserts the literal has no non-nature keys.

---

## 10. Implementation order

**Phase 1 (ship now):** Part 1 edge change (§4.1) → T-01..T-08 → deploy `generate-curated-experiences` + commit.
**Phase 2 (server side of Part 2, ship now or with Phase 1):** discover-cards `CATEGORY_TO_SIGNAL` (§5.2) → T-09..T-12 → deploy `discover-cards`. No-op for existing clients.
**Phase 3 (designer):** `mingla-designer` DESIGN pass → `DESIGN_ORCH-1062_VIBE_CATEGORY_PILLS.md`.
**Phase 4 (client, rides next native build):** §5.3 items 1–7 → T-13..T-15 → merge to main; ride the next build (NO OTA).

---

## 11. Regression prevention
- T-01 + the I-PROPOSED-1062 invariant lock the override map to exactly two nature entries.
- T-08 re-runs ORCH-1061 tests every CI run.
- The protective comment in §4.1 explains WHY the two nature overrides survive and forbids re-adding non-nature ones.
- (Optional, implementor discretion) a strict-grep gate `orch-1062-no-nonnature-override.mjs` asserting the literal source has only `take-a-stroll`/`picnic-dates` keys. If added as a NEW backend strict-grep file, it MUST be allowlisted same-commit in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` per COMMS-0002.

---

## 12. COMMS-0002 / COMMS-0003 declaration
- **COMMS-0002 (backend strict-grep allowlist):** This SPEC adds NO new backend files by itself. IF the implementor adds Deno test files under `supabase/functions/**/__tests__/` or a new strict-grep gate (§11), those NEW backend files MUST be added to `META_ORCH_0952_BACKEND_ALLOWLIST` (or the appropriate ORCH allowlist) in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit. Editing existing files (the two edge fns) does NOT trip the gate.
- **COMMS-0003 (external-API docs):** **NONE.** ORCH-1062 introduces/modifies ZERO external-API enums, payloads, or endpoints. It only edits internal signal-mapping dictionaries and reads existing `place_scores`/`admin_config` via the existing `query_servable_places_by_signal` RPC. No Stripe/Google/OpenAI/etc. surface touched.

---

## 13. Open questions
- **OQ-1 (designer):** final icon glyphs for `lively` + `scenic` within the project icon set, and whether `romantic` pill icon should differ from the Romantic INTENT heart. (Resolved in Phase 3.)
- **OQ-2 (operator, low-stakes):** do you want tap-helper microcopy for the three new categories (§5.3 item 6), or is graceful-absence fine? Default = graceful absence unless designer adds copy.
- **OQ-3 (verify at implement):** does `resolvePills`'s `CATEGORY_PILL_MAP` lookup lowercase the input? If NOT, also key the capitalized display names (§5.3 item 3). Implementor reads deckService.ts:288 region and keys whatever it compares against. Non-blocking (slug forms always work).

---

## 14. /goal self-assessment (SPEC completion predicate)
1. **Functional contract complete per layer** — ✅ edge (Part 1 literal + Part 2 `CATEGORY_TO_SIGNAL`), service (deckService maps), component (pill list + section), util (categoryUtils registries), i18n. RPC behavior read + cited (filter floor + score-DESC order). No DB migration needed (no schema/constraint change; admin_config rows pre-exist).
2. **UI visual/UX contract** — Part 1 has no UI. Part 2 visual contract DELEGATED to a REQUIRED `mingla-designer` pass (§7), which this SPEC references and gates Part-2 implement on. Functional UI states (selected/unselected/empty-helper-absence) pinned. ✅
3. **No-slop bans + references** — N/A for Part 1; for Part 2 the designer pass owns no-slop + "references examined" (existing PreferencesSheet pill craft is the reference). Noted in §7. ✅
4. **LOCKED/OPEN tagged** — ✅ §4, §5, §6, §9 LOCKED; §7 OPEN section present + generous.
5. **Cross-Surface Impact present** (§3); success criteria observable/testable, per-surface where parity manual (SC-7-iOS/Android) ✅.
6. **Invariants named** (§9), test cases happy/error/edge (§8), implementation order (§10), regression prevention (§11) ✅.
7. **Zero hand-wave** — every map entry, filterMin, file+line, and fallback is exact; coverage claims backed by a live DB probe with numbers ✅.

All seven hold for the parts owned by this SPEC; Part-2 visual granularity is explicitly + correctly delegated to the required designer pass (not left vague). **SPEC complete.**
