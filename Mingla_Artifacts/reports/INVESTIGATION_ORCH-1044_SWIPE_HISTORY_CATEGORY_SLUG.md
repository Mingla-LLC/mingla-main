# INVESTIGATION — ORCH-1044 [Swipe History curated category slug leak]

- **ORCH:** ORCH-1044
- **Branch / worktree:** `ORCH-1044-swipe-history-category-slug-leak` @ `~/Desktop/mingla-orchs/ORCH-1044-[swipe-history-category-slug-leak]/`
- **Mode:** INVESTIGATE (root-cause only — NO fix proposed)
- **Date:** 2026-06-02
- **Investigator:** mingla-forensics (Claude)
- **Confidence:** **PROVEN** (root cause reproduced with the real `i18next` library; pure source/i18n-logic bug, no gesture/animation/runtime element requiring sim repro)

---

## 1. Symptom Summary

| | |
|---|---|
| **Surface** | Consumer app → Swipe History sheet (`DismissedCardsSheet.tsx`), the "N cards viewed this session" list opened from the deck. |
| **Expected** | Each row's category meta shows a friendly label, e.g. **"Romantic"**, **"Adventurous"**, **"First Dates"**. |
| **Actual** | For **curated** cards the row shows the raw i18n-key string **`category_romantic`** (and `category_adventurous`, `category_group_fun`, `category_picnic_dates`, `category_take_a_stroll`, and `category_first date` for "First Date"). |
| **Scope** | Curated experience cards only. Single place cards render correctly. |
| **Platform** | iOS **and** Android — `DismissedCardsSheet.tsx` is a shared React Native component; no platform branch. |

---

## 2. Investigation Manifest (files read, in trace order)

| # | File | Why |
|---|---|---|
| 1 | `app-mobile/src/components/DismissedCardsSheet.tsx` | The reported render surface. |
| 2 | `app-mobile/src/utils/categoryUtils.ts` | `getReadableCategoryName` — the label resolver the sheet calls. |
| 3 | `app-mobile/src/utils/cardConverters.ts` | `curatedToRecommendation` — sets `Recommendation.category` for curated cards. |
| 4 | `app-mobile/src/types/curatedExperience.ts` | Curated card data shape (`categoryLabel`, `experienceType`). |
| 5 | `supabase/functions/generate-curated-experiences/index.ts` | Origin of `categoryLabel` (`CURATED_TYPE_LABELS` ← `EXPERIENCE_TYPES[].label`). |
| 6 | `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` | The **correct** live-deck render path (for comparison). |
| 7 | `app-mobile/src/components/SwipeableCards.tsx` | Mount sites of the sheet + the curated-vs-single render branch (line 2497). |
| 8 | `app-mobile/src/i18n/index.ts` | i18next `init()` options (no `nsSeparator`/`appendNamespaceToMissingKey` override). |
| 9 | `app-mobile/src/i18n/locales/en/common.json` | Proves `category_*` keys exist only for real slugs; `intent_*` keys exist for experience types. |
| 10 | (web) i18next configuration docs | Default `appendNamespaceToMissingKey: false` behavior. |

---

## 3. Findings

### 🔴 F-1 — ROOT CAUSE: the namespace-stripped missing-key return defeats the equality guard in `getReadableCategoryName`, so the raw i18n key leaks to the UI

**File + line:** `app-mobile/src/utils/categoryUtils.ts:110-116`

**Exact code:**
```ts
// Try i18n translation
const key = `common:category_${normalizedSlug}`;   // line 110 — namespaced key
const translated = i18n.t(key);                     // line 111
// If i18n returns the key itself (no translation found), fall back to formatting
if (translated === key) {                           // line 113 — BROKEN GUARD
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
return translated;                                  // line 116 — leaks "category_romantic"
```

**What it does (current behavior):** `key` is built **with** the `common:` namespace prefix. On a missing key, i18next (default config — `appendNamespaceToMissingKey: false`) returns the key **without** the namespace prefix, i.e. `"category_romantic"`. The guard compares `translated` (`"category_romantic"`) against `key` (`"common:category_romantic"`) — these are **never equal on a miss**, so the human-readable title-case fallback at line 114 is dead code for namespaced keys. The function returns the bare key `category_romantic`, which the sheet renders verbatim.

**What it should do (correct behavior):** When the translation is missing it must fall back to the title-cased slug (`"Romantic"`), exactly as the comment at line 112 intends. The guard must detect the miss correctly — the miss-return is the namespace-stripped form `category_${normalizedSlug}`, not the full `common:category_${normalizedSlug}`. (Direction only; no fix specced here.)

**Causal chain:**
1. Server `generate-curated-experiences/index.ts:638` sets `categoryLabel: CURATED_TYPE_LABELS[experienceType]` where `CURATED_TYPE_LABELS` ← `EXPERIENCE_TYPES[].label` (e.g. `'romantic'` → `'Romantic'`). See edge fn lines 364-368, 270-271.
2. Client `cardConverters.ts:71` maps the curated card to a `Recommendation` with `category: card.categoryLabel || 'Experience'` → `category === 'Romantic'`.
3. `DismissedCardsSheet.tsx:179` calls `getReadableCategoryName(card.category)` → `getReadableCategoryName('Romantic')`.
4. In `categoryUtils.ts`: `stripped = 'Romantic'` (the `/^category\./` regex needs a literal **dot**, so `category_*` is never stripped — but that's not the issue here since the input is `'Romantic'`); `slug = 'Romantic'`; `normalizedSlug = 'romantic'`; `key = 'common:category_romantic'`.
5. `'romantic'` has **no** `category_romantic` entry in `common.json` (the `category_*` namespace only covers real category slugs — nature, brunch, etc.; verified §5 Data layer). i18next returns the namespace-stripped miss value `'category_romantic'`.
6. Guard `'category_romantic' === 'common:category_romantic'` → **false** → fallback skipped → returns `'category_romantic'`.
7. Sheet renders `category_romantic` in the row meta. ✗

**Verification step (PROVEN — executed):** Ran the real `i18next` (`app-mobile` has `i18next ^26.0.4`) in Node with only `category_nature` registered:
```
miss namespaced key returns: "category_romantic"
hit returns: "Nature & Views"
equality guard (translated === "common:category_romantic"): false
```
This confirms (a) the miss strips the namespace and (b) the guard is false on a miss, so line 116 returns the bare key. External confirmation: i18next docs — `appendNamespaceToMissingKey` defaults to `false`, so the namespace is not appended to a missing key (https://www.i18next.com/overview/configuration-options).

---

### 🟠 F-2 — CONTRIBUTING: Swipe History does not use the curated `intent_*` render path that the live deck uses

**File + line:** broken path `DismissedCardsSheet.tsx:179` and `:257`; correct path `CuratedExperienceSwipeCard.tsx:73-74`.

The **live deck** renders curated cards through `<CuratedExperienceSwipeCard>` (selected at `SwipeableCards.tsx:2497` when `cardType === 'curated'`), which derives the label as:
```ts
const rawIntentKey = (card.experienceType || 'adventurous').replace(/-/g, '_'); // 'romantic'
const categoryLabel = t(`common:intent_${rawIntentKey}`);                        // 'common:intent_romantic' → "Romantic"
```
The `intent_*` keys **do** exist in `common.json` (lines 104-109: `intent_romantic`, `intent_adventurous`, `intent_first_date`, `intent_group_fun`, `intent_picnic_dates`, `intent_take_a_stroll`), so the live deck label resolves correctly and **never touches the broken `getReadableCategoryName` path**.

Swipe History instead funnels **every** card — curated and single — through `getReadableCategoryName(card.category)`, where for curated cards `card.category` is the human label `'Romantic'` (not the `experienceType` and not a real category slug). The resolver then hits F-1. This is why the bug is **curated-only** and **Swipe-History-only**: single place cards carry a real slug (e.g. `casual_food`) that resolves cleanly, and the deck/expanded curated render uses `intent_*`.

This is classified Contributing (not a second root cause): even if the sheet kept calling `getReadableCategoryName`, fixing F-1's guard would make it return `"Romantic"` (title-cased fallback) and the symptom would disappear. F-2 explains the path divergence and is the natural place a parity-consistent fix would live.

---

### 🟡 F-3 — HIDDEN FLAW: the same broken guard silently degrades EVERY missing-category render across the app, not just Swipe History

**File + line:** `categoryUtils.ts:113` (single shared resolver) consumed by 14 call sites.

`getReadableCategoryName` is called from (verified by grep):
- `DismissedCardsSheet.tsx:179, :257` (Swipe History — reported)
- `SwipeableBoardCards.tsx:245, :383` (collab board cards + expanded)
- `board/SwipeableSessionCards.tsx:253` (guarded: `isCurated ? "" : ...` — curated suppressed, so safe today)
- `SwipeableCards.tsx:2418, :2560` (single-card preview/front — fed real slugs, safe today)
- `ExpandedCardModal.tsx:2058, :2178, :2192`
- `expandedCard/CardInfoSection.tsx:120`
- `PersonGridCard.tsx:81`, `PersonHolidayView.tsx:271` (friend-page holiday cards)
- `activity/SavedTab.tsx:1795`, `activity/CalendarTab.tsx:1636`

Any of these that receives a curated `categoryLabel` (e.g. `'Romantic'`) or any string lacking a `category_<slug>` key will leak the bare `category_<x>` key for the same reason. The blast radius is the whole resolver, not one screen. Swipe History is simply where the operator first saw it because it unconditionally routes curated cards through this resolver. (Surfaces that route curated cards through `intent_*` or suppress the label — `CuratedExperienceSwipeCard`, `SwipeableSessionCards` — are not affected today.)

---

### 🔵 F-4 — OBSERVATION: the leak does not produce "Category Romantic" because the namespace is stripped, not preserved

A naïve reading of the guard suggests the worst case is the title-cased `"Romantic"` fallback or `"Category Romantic"`. Neither happens. Because i18next strips the namespace on a miss, the returned value is `category_romantic` (underscore preserved, prefix intact, no title-casing) — matching the operator's verbatim report exactly. This is the tell that distinguishes "missing translation key with broken guard" from "slug passed straight to UI."

---

## 4. Data Origin of the slug (chain of custody)

`category_romantic` is **not** a literal anywhere in the repo (grep across `*.ts/tsx/json/sql` returns zero). It is constructed at runtime inside `getReadableCategoryName`:

```
EXPERIENCE_TYPES[].label = "Romantic"                         (edge fn: generate-curated-experiences/index.ts:270-271)
  → CURATED_TYPE_LABELS["romantic"] = "Romantic"              (edge fn:364-368)
  → card.categoryLabel = "Romantic"                            (edge fn:638)
  → Recommendation.category = "Romantic"                       (client: cardConverters.ts:71)
  → getReadableCategoryName("Romantic")                        (client: DismissedCardsSheet.tsx:179)
  → normalizedSlug = "romantic" → key = "common:category_romantic"  (categoryUtils.ts:107-110)
  → i18next miss returns "category_romantic" (namespace stripped)    (categoryUtils.ts:111)
  → guard false → returns "category_romantic"                  (categoryUtils.ts:113-116)
```

So the slug-looking string is a **synthesized missing i18n key**, not data that exists in the dismissed-card record, the recommendation payload, or the DB. The curated record's real fields are `experienceType: 'romantic'` and `categoryLabel: 'Romantic'`.

---

## 5. Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | Comment at `categoryUtils.ts:112` states intent: "If i18n returns the key itself (no translation found), fall back to formatting." The code does **not** match this intent — the guard never recognizes the miss for namespaced keys. **Docs ↔ Code contradict → bug confirmed here.** |
| **Schema/Types** | `curatedExperience.ts`: `categoryLabel?: string` (human label) and `experienceType: string` (slug-ish, e.g. `romantic`). `Recommendation.category` is fed the *label*, not the *experienceType* nor a real category slug. No type prevents a non-`category_*` string from reaching the resolver. |
| **Code** | `cardConverters.ts:71` `category = categoryLabel`; `DismissedCardsSheet.tsx:179` calls `getReadableCategoryName`; `categoryUtils.ts:110-116` mis-guards the miss. Live deck uses `intent_*` instead (`CuratedExperienceSwipeCard.tsx:74`) — divergent paths. |
| **Runtime** | Reproduced with real i18next: `t('common:category_romantic')` → `"category_romantic"`; guard `=== 'common:category_romantic'` → false; resolver returns `"category_romantic"`. |
| **Data (i18n resources)** | `en/common.json` `category_*` keys (lines 62-84) cover ONLY real category slugs (nature, icebreakers, drinks_and_music, brunch, casual, casual_food, upscale_fine_dining, movies, theatre, creative_arts, play, flowers, plus legacy). There is **no** `category_romantic / _adventurous / _group_fun / _picnic_dates / _take_a_stroll / _first_date`. The matching keys live under `intent_*` (lines 104-109). |

All five layers agree on the mechanism; the Docs↔Code contradiction at `categoryUtils.ts:112-116` is the locus.

---

## 6. Blast Radius Map

- **Reported surface:** Swipe History `DismissedCardsSheet.tsx:179` (own swiped cards) and `:257` (collab "Also passed by your group" rows) — both curated cards leak.
- **Solo AND collab:** Both. The sheet is mounted twice in `SwipeableCards.tsx` (lines 2074, 2698) with identical props; collab rows hit the same resolver at `:257`.
- **iOS AND Android:** Shared RN component, no platform branch → identical defect on both.
- **Other resolver consumers (F-3):** any of the 14 call sites that pass a curated `categoryLabel` or any string lacking a `category_<slug>` key (ExpandedCardModal, board cards, friend-page holiday cards, Saved/Calendar tabs). Single place cards and the curated deck/`intent_*` path are unaffected today.
- **NOT affected:** live deck curated card (`CuratedExperienceSwipeCard` → `intent_*`), `SwipeableSessionCards` (curated label suppressed to `""`), Admin/Business (no curated category render).
- **Cache/query keys:** none involved — pure synchronous render-time string resolution.
- **Invariants:** brushes Constitution #10 (locale-aware display) — the label is meant to be locale-aware but degrades to a raw English key on the missing-key path; not currency, but the same "user sees an internal token" class.

---

## 7. Candidate Causes Considered & Disproven

| Candidate | Verdict | Evidence |
|---|---|---|
| Slug `category_romantic` stored in the dismissed-card record / recommendation payload and rendered raw | **DISPROVEN** | Literal absent from repo (grep). `Recommendation.category` is set to `categoryLabel` (`"Romantic"`) at `cardConverters.ts:71`, not to any `category_*` string. The slug is synthesized at render time. |
| `card.category` holds the `experienceType` (`romantic`) and is rendered without the resolver | **DISPROVEN** | `DismissedCardsSheet.tsx:179` DOES call `getReadableCategoryName`; and `category` is the label, not the experienceType (cardConverters.ts:71). |
| Missing locale file / non-en language | **DISPROVEN** | Reproduces on `en`. The `category_romantic` key is absent in en too (and everywhere); it's the wrong key namespace, not a missing translation file. |
| `getReadableCategoryName` not called at all (raw value) | **DISPROVEN** | It is called; the bug is INSIDE it (line 113 guard). |
| **Equality guard fails because i18next strips the namespace on a miss** | **CONFIRMED (root cause)** | Node repro + i18next docs (§3 F-1 verification). |

---

## 8. Outcome & Journey Step-Back

- **User's goal:** review what they swiped this session and recognize each card at a glance ("Was that the romantic wine-bar plan?").
- **Journey:** open deck → swipe a few curated cards → tap "Review all cards" / "Review dismissed" → Swipe History sheet lists rows with thumbnail + title + category meta + status.
- **Divergence point:** the category meta line shows `category_romantic` — an internal token — breaking recognition and trust (looks like a bug/untranslated string to the user). The title and thumbnail still read, so the card is identifiable, but the screen looks broken.
- **Does fixing F-1 deliver the outcome?** Yes for the reported screen: fixing the guard makes the resolver return the title-cased fallback (`"Romantic"`). For full parity with the live deck (which shows the localized `intent_*` label), the SPEC should decide whether Swipe History should also route curated cards through the `intent_*` label (F-2) so the label matches the deck exactly and is locale-aware, rather than only the English title-case fallback. Both options remove the raw token; the parity option is the higher-quality outcome. **No fix is prescribed here — flagged for SPEC.**

---

## 9. Fix Strategy (DIRECTION ONLY — not a spec, not code)

Two independent levers; SPEC chooses scope:
1. **Correct the miss-detection in `getReadableCategoryName` (F-1)** — the guard must compare against the namespace-stripped miss form (or use i18next's `exists()` / a `defaultValue` / `appendNamespaceToMissingKey`) so the title-case fallback actually fires. This single change fixes Swipe History and hardens all 14 consumers (F-3).
2. **(Optional, parity) Route curated cards in Swipe History through the `intent_*` label (F-2)** so the meta line matches the live deck's localized label exactly instead of an English title-case fallback.

Regression-prevention direction: a unit test on `getReadableCategoryName('Romantic')` (and the other curated labels) asserting it returns a human label and never a `category_*`/`intent_*`-shaped token; optionally a strict-grep/test guard that the curated `categoryLabel` set has matching i18n keys in whatever namespace the resolver targets.

---

## 10. Discoveries for Orchestrator

- **F-3 blast radius** is app-wide (the shared resolver), not Swipe-History-local. Whoever specs the fix should fix the resolver guard (not just the one call site) and add the resolver-level regression test, so the latent leak across ExpandedCardModal / board / friend-page / Saved / Calendar is closed in the same pass.
- **Naming smell (non-blocking):** `getReadableCategoryName` is fed three different kinds of input across the codebase — real category slugs (`casual_food`), human display labels (`Romantic`), and (potentially) experience types. The mixed contract is what lets a non-`category_*` string reach the `category_*` namespace. Worth a SPEC note even though it's not the proximate bug.

---

## 11. Confidence

**PROVEN.** Root cause has all six fields, the exact failing line is identified (`categoryUtils.ts:113-116`), the miss-return behavior is reproduced with the real `i18next ^26.0.4` library, the correct vs broken render paths are both read and compared, the data origin is traced end-to-end through the edge function and client converter, and ≥2 alternative causes were disproven with evidence. This is a deterministic source/i18n-logic defect with no gesture/animation/timing element, so a simulator launch is not required to elevate beyond `probable` — the Node reproduction against the production i18next is the live-fire equivalent for this bug class. No fix proposed (per dispatch).
