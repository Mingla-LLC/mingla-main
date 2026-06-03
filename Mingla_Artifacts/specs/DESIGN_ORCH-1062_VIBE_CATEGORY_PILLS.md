# DESIGN — ORCH-1062 Part 2: Romantic / Lively / Scenic category pills

**ORCH:** ORCH-1062 Part 2 [vibe-category-pills]
**Mode:** COMPONENT (additive system extension — match-the-system, NOT a redesign)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1062-[part2-vibe-category-pills]`
**Branch:** `ORCH-1062-part2-vibe-category-pills` (off origin/main `f8b222b81`)
**Surface:** Consumer app (`app-mobile`) — PreferencesSheet → Categories section
**References examined:** This is an **additive match-the-system** task. The single, authoritative reference is the **existing Mingla category-pill component itself** (observed below from live code, not screenshots). No external app study is warranted or appropriate: the design contract is "indistinguishable from the existing pills," and inventing a new visual pattern would violate the additive constraint. (Per `references/premium-craft.md` §3, external study is for novel moments; this is a system-extension, so the in-system reference governs.)

---

## PART 1 — OBSERVED EXISTING PILL PATTERN (the "how the other pills are shown" deliverable)

All values below are read directly from the live code in this worktree, with `file:line` cites. These are the contract the 3 new pills must match **exactly**.

### 1.1 Where the visible category pills come from (the rendered array)

The PreferencesSheet category pills are driven by a **local module-scope `categories` array** in the sheet, NOT by `VISIBLE_CATEGORY_SLUGS` and NOT by `src/constants/categories.ts`.

- **Rendered array:** `app-mobile/src/components/PreferencesSheet.tsx:117-128` — 10 objects of shape `{ id, label, icon }`.
- It is passed through unchanged: `const filteredCategories = categories;` (`PreferencesSheet.tsx:544`) → `<CategoriesSection filteredCategories={filteredCategories} … />` (`PreferencesSheet.tsx:1304`).
- The label shown is NOT `category.label` — it is re-resolved via i18n at render: `t(\`common:category_${category.id}\`)` (`PreferencesSheet/PreferencesSections.tsx:202`). The `label` field in the array is effectively dead display text (i18n wins). The `id` is the slug; the `icon` is the glyph name.

> **Implementor coherence note (design discovery, not a redesign ask):** the *visible pills* are the local `categories` array. `VISIBLE_CATEGORY_SLUGS` in `categoryUtils.ts:67` is a SEPARATE list (currently 9, derived from `VALID_SLUGS`) used by other consumers (serving/normalization). The dispatch already routes the implementor to update `VISIBLE_CATEGORY_SLUGS` too. To keep the system coherent, the 3 new slugs must be added in BOTH places (local `categories` array for the rendered pills + `VALID_SLUGS`/`VISIBLE_CATEGORY_SLUGS` so normalization/persistence accept them). See Part 3 wiring table.

### 1.2 The renderer (CategoriesSection) — layout, chip, states

File: `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx`.

**Grid container** (`styles.categoriesContainer`, L371-375):
```
flexDirection: "row",
flexWrap:      "wrap",
gap:           10,
```
Pure left-to-right wrap, no column count, no `justifyContent` → chips pack from the left and wrap when the next chip won't fit. Order in the array = visual order.

**Chip container** (`styles.categoryButton`, L376-392):
```
flexDirection:    "row",
alignItems:       "center",
gap:              7,            // icon→label gap
height:           42,          // FIXED pill height
paddingHorizontal:14,
paddingVertical:  10,
borderRadius:     999,         // full pill
backgroundColor:  rgba(255,255,255,0.55),   // unselected fill (glass)
borderWidth:      1,
borderColor:      rgba(255,255,255,0.35),
shadowColor:      rgba(0,0,0,0.04), shadowOffset {0,2}, shadowOpacity 1, shadowRadius 6,
elevation:        1,
```

**Selected chip** (`styles.categoryButtonSelected`, L393-401):
```
backgroundColor:  "#eb7825",    // Mingla accent orange
borderColor:      "#eb7825",
shadowColor:      "#eb7825", shadowOpacity 0.3, shadowRadius 8, shadowOffset {0,4},
elevation:        4,
```

**Icon** (`PreferencesSections.tsx:191-195`): `<Icon size={16} color={isSelected ? "#ffffff" : "#6b7280"} />`.
Selected-state icon name is transformed: `name={isSelected ? (category.icon).replace('-outline','') : category.icon}` (L192). So a glyph whose name has NO `-outline` suffix renders the **same** Lucide component in both states (correct — Lucide is stroke-only, fill = strokeWidth). Names WITH `-outline` map to the identical Lucide component anyway (e.g. `wine-outline`→Wine, `wine`→Wine in `Icon.tsx:467-468`), so the replace is a no-op visually here.

**Label text** (`styles.categoryText`, L402-406 / selected L407-410):
```
unselected: fontSize 13, fontWeight "500", color "#4b5563"
selected:   color "#ffffff", fontWeight "600"
```
> Note: dispatch cited text colors `#6b7280`/`#ffffff`. Precise truth from code: the **icon** unselected color is `#6b7280` (L194); the **label** unselected color is `#4b5563` (L405). Selected = `#ffffff` for both. New pills inherit these tokens unchanged (no per-pill color).

**Helper microcopy (the sheet DOES use a helper pattern — match it):** when a category is tapped AND is currently selected, a single helper row appears below the grid showing `Label: description` (`PreferencesSections.tsx:208-216`), keyed off `CATEGORY_DESCRIPTION_KEYS` (L131-144) → `preferences:category_descriptions.<key>`. Style `styles.helperText` (L422-427): `fontSize 12, color #92400e, lineHeight 17`, with a left accent bar `#eb7825` (`styles.helperTextContainer` L411-421) and a bold label in `#eb7825` (`styles.helperTextBold` L428-431). **New pills must add a `category_descriptions` entry + a `CATEGORY_DESCRIPTION_KEYS` map entry, or tapping them shows no helper while every existing pill does — an inconsistency.** (Covered in Part 4.)

### 1.3 The existing icon mapping (which set, which glyphs)

Icon set: **lucide-react-native**, accessed through a closed allowlist wrapper `app-mobile/src/components/ui/Icon.tsx`. `ICON_MAP` (L176-472) maps legacy Ionicons/Feather name strings → imported Lucide components. **A name not in `ICON_MAP` renders nothing** (`Icon.tsx:507-512`, returns `null` + dev warning). So new pill glyphs MUST be names already present in `ICON_MAP` (or the implementor must add both the lucide import AND the map entry — flagged below where needed).

Existing visible-category slug→icon (from the rendered array `PreferencesSheet.tsx:118-127`; mirror in `categoryUtils.ts:261-280`):

| slug | icon name | Lucide component |
|---|---|---|
| play | `game-controller-outline` | Gamepad2 |
| icebreakers | `sparkles` | **Sparkles** |
| nature | `trees` | **Trees** |
| drinks_and_music | `wine-outline` | Wine |
| creative_arts | `color-palette-outline` | Palette |
| movies | `film-new` | Film |
| theatre | `theater` | Drama |
| brunch | `coffee` | Coffee |
| casual_food | `utensils-crossed` | UtensilsCrossed |
| upscale_fine_dining | `chef-hat` | ChefHat |

### 1.4 i18n source of truth for labels

- Labels: `app-mobile/src/i18n/locales/en/common.json` — keys `category_<slug>` (block at L62-84). Rendered via `t(\`common:category_${id}\`)`.
- Helper descriptions: `app-mobile/src/i18n/locales/en/preferences.json` — keys `category_descriptions.<key>` (block at L17+).

### 1.5 Current grid math (for wrap verification)

Category section card: `styles.section` `marginHorizontal: 16` + `padding: 20` (`PreferencesSheet.tsx:1653, 1652`). Available chip-row width = `screenWidth − (16×2) − (20×2) = screenWidth − 72`.

| device | screen dp | row width |
|---|---|---|
| small phone | 360 | 288 |
| iPhone 14/15 | 390 | 318 |
| Pro Max | 430 | 358 |

Approx chip width = `14 (padL) + 16 (icon) + 7 (gap) + label + 14 (padR)` = `51 + label`. At fontSize 13 / weight 500, ~6.5dp per character average. Plus `gap: 10` between chips. This is the model used in Part 3 wrap analysis.

---

## PART 2 — THE 3 NEW PILLS (icons, collisions, tokens)

These are quality-grounded "vibe" categories (ORCH-1062 Part 1 kept `nature` scenic/picnic signals; Part 2 surfaces vibe as user-pickable). UX is **identical** to every other category pill: multi-select, no cap (ORCH-0424), same chip, same states, same helper. Zero new styles.

### 2.1 Icon selection + collision resolution

The icon set is a closed allowlist. I selected only from names already in `ICON_MAP`, and resolved every collision against existing pills and the Romantic *intent*.

| New pill | Chosen icon name | Lucide component | In `ICON_MAP`? | Rationale |
|---|---|---|---|---|
| **Romantic** | `heart-pulse` | **HeartPulse** | YES (`Icon.tsx:311`) | Warmth/romance. **Collision avoided:** the plain `heart-outline`→Heart is already the **Romantic curated INTENT** icon (`constants/categories.ts:1080`, `CURATED_EXPERIENCES`). Using `heart-pulse` keeps the Romantic *category* pill visually distinct from the Romantic *intent* pill so the two never read as duplicates in the same sheet. |
| **Lively** | `flame` | **Flame** | YES (`Icon.tsx:290`) | Energy / nightlife / buzzing room. **Collision avoided:** `sparkles`→Sparkles is taken by **icebreakers** (`PreferencesSheet.tsx:119`); `flash`→Zap reads "electricity/speed," not social energy. `flame` is unused by any category and reads "this place is hot/busy." |
| **Scenic** | `tree-pine` | **TreePine** | YES (`Icon.tsx:448`) | A vista/landscape silhouette. **Collision avoided:** `trees`→Trees is taken by **nature** (`PreferencesSheet.tsx:120`). `tree-pine`→TreePine is a *different lucide glyph* (single conifer vs. cluster) and is currently unused, so Scenic sits beside Nature without glyph-clash while staying in the same outdoorsy family (correct — scenic is a vibe layer over nature-type places). Rejected `eye`/`camera`/`image` (read as a "view photos / take photo" ACTION, not a place vibe); rejected `sunny`→Sun (reads as weather/time-of-day). `map`/`compass-outline` read as navigation, not scenery. |

**All three names already exist in `ICON_MAP`** → no new lucide import required, no risk of a null-render. Confirmed against `Icon.tsx` L311 (heart-pulse→HeartPulse), L290 (flame→Flame), L448 (tree-pine→TreePine), and the imports list L84/L85 (Heart, HeartPulse), L74 (Flame), L168 (TreePine).

**Selected-state safety (`.replace('-outline','')` at `PreferencesSections.tsx:192`):** none of the three names contain `-outline`, so the replace is a no-op and each renders the identical glyph in selected (white on `#eb7825`) and unselected states. No broken-icon risk. Verified.

### 2.2 No new color tokens

Categories do not carry per-pill chip color in the rendered pill (the `getCategoryColor`/`ux.activeColor` values are for OTHER surfaces, e.g. cards/map — the PreferencesSheet pill is always glass→`#eb7825`). So the 3 new pills introduce **zero** color tokens. (If the implementor wires `getCategoryColor`/`categoryUtils` icon+color maps for parity with other surfaces, suggested values that match the existing palette family, NOT used in the pill itself: romantic `#EC4899` [matches Romantic intent pink], lively `#F97316` [orange energy], scenic `#10B981` [matches nature/scenic green]. These are optional and out of the pill's own visual scope.)

---

## PART 3 — GRID ORDER + WRAP VERIFICATION (10 → 13 chips)

### 3.1 Placement decision

The 3 vibe pills are a conceptually distinct group ("how it feels" vs. "what kind of place"). To keep them discoverable as a set without restyling, **append them as a contiguous trio at the END of the array**, after `upscale_fine_dining`. This:
- preserves the existing 10-pill order byte-for-byte (additive — no reordering of shipped pills),
- groups the 3 vibes together so they read as one new family,
- relies only on the existing left-to-right wrap (no grid-system change).

**New rendered order** (local `categories` array, `PreferencesSheet.tsx:117-128`):

```
1  play               game-controller-outline
2  icebreakers        sparkles
3  nature             trees
4  drinks_and_music   wine-outline
5  creative_arts      color-palette-outline
6  movies             film-new
7  theatre            theater
8  brunch             coffee
9  casual_food        utensils-crossed
10 upscale_fine_dining chef-hat
11 romantic           heart-pulse        ← NEW
12 lively             flame              ← NEW
13 scenic             tree-pine          ← NEW
```

### 3.2 Per-chip width estimate (51 + label, label ≈ 6.5dp/char @ 13/500)

| chip | label | chars | est. width dp |
|---|---|---|---|
| Play | Play | 4 | ~77 |
| Icebreakers | Icebreakers | 11 | ~122 |
| Nature & Views | Nature & Views | 14 | ~142 |
| Drinks & Music | Drinks & Music | 14 | ~142 |
| Creative & Arts | Creative & Arts | 15 | ~149 |
| Movies | Movies | 6 | ~90 |
| Theatre | Theatre | 7 | ~96 |
| Brunch | Brunch | 6 | ~90 |
| Casual | Casual | 6 | ~90 |
| Fine Dining | Fine Dining | 11 | ~122 |
| **Romantic** | Romantic | 8 | ~103 |
| **Lively** | Lively | 6 | ~90 |
| **Scenic** | Scenic | 6 | ~90 |

### 3.3 Wrap simulation (gap 10 between chips, row width = screen − 72)

**390dp (318 row):** greedy pack with +10 gaps —
Row1: Play(77)+Icebreakers(122)=209 → +Nature(142)=361 > 318 → wraps. Row1 = [Play, Icebreakers] (209).
This is the SAME wrapping behavior already shipped today for pills 1-10; the trio simply continues the existing flow. Worst-case the three new short pills (Romantic 103 / Lively 90 / Scenic 90) pack efficiently: 103+10+90+10+90 = 303 ≤ 318 → **all 3 fit on one final row at 390dp.** Clean.

**360dp (288 row):** the trio = 303 > 288 → Scenic (last, shortest) drops to its own line OR pairs with whatever short pill precedes it. Result: Romantic+Lively on one row (103+10+90=203 ≤ 288), Scenic wraps to the next row and sits left-aligned — visually balanced (no orphan mid-row, no overflow). Acceptable and consistent with how Fine Dining / short pills already wrap on small phones today.

**430dp (358 row):** trio 303 ≤ 358 → **all 3 on one final row** with room to spare. Best case.

**Conclusion:** at 390 and 430 the three new pills land together on the final row(s); at 360 they split 2+1 with the shortest (Scenic) leading the new row — no overflow, no clipping, no orphan, no truncation (fixed `height: 42`, `flexWrap` handles it). No grid change needed. Verified against the existing `gap:10 / flexWrap:wrap` system.

---

## PART 4 — STATE TOKENS + CONTRAST (computed, not eyeballed)

The 3 pills reuse the EXACT existing tokens. No new state styles. For completeness, every applicable state below maps to a shipped style; states that don't apply to a static multi-select pill are named with a reason.

| State | Token / behavior | Source |
|---|---|---|
| **Unselected (default)** | fill `rgba(255,255,255,0.55)`, border `rgba(255,255,255,0.35)`, icon `#6b7280`, label `#4b5563`, shadow `rgba(0,0,0,0.04)` r6, elev 1, `height 42`, `borderRadius 999` | `categoryButton` / `categoryText` PreferencesSections.tsx:376-406 |
| **Selected** | fill `#eb7825`, border `#eb7825`, icon `#ffffff`, label `#ffffff` weight 600, shadow `#eb7825` op .3 r8, elev 4 | `categoryButtonSelected` / `categoryTextSelected` L393-410 |
| **Pressed** | `<TouchableOpacity>` default activeOpacity (0.2 dim, non-shifting — no layout change, no scale) | `PreferencesSections.tsx:183` (no custom activeOpacity → RN default 0.2) |
| **Helper-on-select** | tapping a selected pill shows `Label: description` row (accent left-bar `#eb7825`, text `#92400e`) | L208-216; requires new `category_descriptions` entries (Part 5) |
| **Loading** | N/A — pills are static config, no async per-pill; section-level spinner is `LoadingShimmer` (unchanged) | L296-304 |
| **Error / Submitting / Offline / Degraded** | N/A — selection is local state persisted on Save by the sheet's existing flow; no per-pill async, so no per-pill error/submit/offline/degraded state exists. The trio inherits the sheet's existing save/error handling unchanged. | — |
| **First-time / Returning** | N/A at pill level — identical to existing pills; a returning user with a persisted `romantic`/`lively`/`scenic` selection renders the pill in Selected state via `selectedCategories.includes(id)` (L181), same as any category. | — |
| **Empty** | N/A — the grid is never empty (13 static pills). The "keep at least one" min-message (`minMessage`, L217-221) already covers the floor; new pills participate identically. | — |

### 4.1 Contrast ratios (computed)

The sheet background under the section card is white→light (`section` fill `rgba(255,255,255,0.70)` over a white sheet, `PreferencesSheet.tsx:1612` header `#ffffff`). Effective backdrop ≈ `#ffffff`/very-light. Light mode only (the consumer PreferencesSheet renders on a white sheet; there is no separate dark sheet variant for this surface — the glass fills assume a light backdrop).

| Pair | FG | BG | Ratio | WCAG (text) |
|---|---|---|---|---|
| Unselected label | `#4b5563` | `#ffffff` (chip fill is 0.55 white over white ≈ near-white) | **7.55:1** | PASS AA & AAA (body ≥4.5, large ≥3) |
| Unselected icon | `#6b7280` | `#ffffff` | **4.83:1** | PASS AA body (≥4.5); icon is graphical (≥3 needed) → comfortably PASS |
| Selected label | `#ffffff` | `#eb7825` | **2.95:1** | label is 13/600 ≈ large-bold; large-text threshold 3:1 — **2.95 is 0.05 under 3:1.** See note below. |
| Selected icon | `#ffffff` | `#eb7825` | **2.95:1** | graphical (≥3 target) — marginal, same as below |

> **Contrast finding (pre-existing, inherited — NOT introduced by this ORCH):** white-on-`#eb7825` is `2.95:1`, fractionally under the 3:1 large-text bar. **Every existing selected category pill, intent pill, date pill, and travel-mode pill in this sheet already uses this exact pairing** (`categoryButtonSelected`, `experienceTypeButtonSelected`, `datePillSelected`, `travelModeCardSelected` — all `#eb7825` fill + `#ffffff` text). The 3 new pills inherit it for consistency. Because this is the shipped, system-wide Mingla selected-pill token and the task is explicitly **additive / match-the-system (do not restyle existing pills)**, the spec does NOT diverge the new pills to a darker accent — that would make them inconsistent with the other 10. **Flagged for a system-wide follow-up** (e.g. bump accent to `#d96a1f` ≈ 3.4:1, or darken selected text) if Mingla wants strict AA on the selected state — but that is a global token change, out of ORCH-1062 Part 2's additive scope. Selected pills also carry the icon + bold weight + shadow as redundant affordance, so selection is never conveyed by color alone.

---

## PART 5 — i18n KEYS TO ADD

### `app-mobile/src/i18n/locales/en/common.json` (after L74 `category_play`, in the category block)
```json
"category_romantic": "Romantic",
"category_lively": "Lively",
"category_scenic": "Scenic",
```

### `app-mobile/src/i18n/locales/en/preferences.json` (in the `category_descriptions.*` block, ~L17+)
Mingla voice — short, warm, concrete; matches the existing description cadence ("Trails, parks, gardens, scenic views — fresh air and good scenery"):
```json
"category_descriptions.romantic": "Candlelit, intimate, made-for-two — places that turn a night into a moment",
"category_descriptions.lively": "Buzzy, high-energy rooms where the night finds its own momentum",
"category_descriptions.scenic": "Big views and beautiful backdrops — spots that are worth the look"
```

> The implementor must also add the matching entries to `CATEGORY_DESCRIPTION_KEYS` (`PreferencesSections.tsx:131-144`):
> ```
> romantic: "category_descriptions.romantic",
> lively:   "category_descriptions.lively",
> scenic:   "category_descriptions.scenic",
> ```
> otherwise the helper row won't appear on tap (inconsistent with all 10 existing pills).

---

## PART 6 — IMPLEMENTOR WIRING SUMMARY (design-side checklist of touchpoints)

UI-only design; the implementor owns code. The UI-relevant touchpoints this design implies (the serving-side `deckService`/`discover-cards` work is the implementor's, per dispatch):

1. **Rendered pills** — add 3 objects to local `categories` array, `PreferencesSheet.tsx:117-128`:
   `{ id: 'romantic', label: 'Romantic', icon: 'heart-pulse' }`,
   `{ id: 'lively', label: 'Lively', icon: 'flame' }`,
   `{ id: 'scenic', label: 'Scenic', icon: 'tree-pine' }` — appended after `upscale_fine_dining`.
2. **Slug validity / normalization** — add `'romantic','lively','scenic'` to `VALID_SLUGS` (`categoryUtils.ts:50-61`) so they survive `normalizeCategoryArray` + `VISIBLE_CATEGORY_SLUGS` (they're auto-included once in VALID and not hidden/legacy). Add icon entries to `getCategoryIcon` iconMap (`categoryUtils.ts:261-280`): `romantic:'heart-pulse', lively:'flame', scenic:'tree-pine'`.
3. **i18n** — Part 5 (common.json labels + preferences.json descriptions).
4. **Helper map** — `CATEGORY_DESCRIPTION_KEYS` 3 entries (Part 5 note).
5. **Icon set** — NO change needed; all 3 names already in `ICON_MAP`.
6. **(Out of UI design scope, implementor-owned per dispatch):** `deckService` `PILL_TO_CATEGORY_NAME`/`CATEGORY_PILL_MAP`; `discover-cards` `CATEGORY_TO_SIGNAL` with filterMin lively=120, romantic=60, scenic=60.

---

## /goal SELF-ASSESSMENT (DESIGN completion predicate)

1. **References examined line present** — YES. Additive match-the-system task; the in-system existing pill is the authoritative reference (external study correctly N/A per premium-craft §3, justified in header).
2. **All 9 states designed or named N/A with reason** — YES (Part 4 table: unselected/selected/pressed/helper designed; loading/error/submitting/offline/degraded/empty/first-time/returning each named with a concrete reason a static multi-select pill has no distinct variant).
3. **Every value is a token from the existing system, zero magic numbers** — YES. The pills introduce NO new values; they reuse `categoryButton`/`categoryButtonSelected`/`categoryText` verbatim (4px-grid-consistent: 42 height, gap 7/10, pad 14/10, radius 999). Cited to `file:line`.
4. **Contrast computed in both modes, numeric** — Computed (Part 4.1): unselected label 7.55:1 (AAA), unselected icon 4.83:1 (AA), selected 2.95:1 with an explicit FINDING that this is the pre-existing system-wide token, flagged for global follow-up, not silently shipped. Dark mode: N/A with reason (this sheet is light-only). All numeric, not eyeballed.
5. **Every interactive element ≥44pt, accessibilityLabel, non-shifting press** — Tap target: pill `height 42` + the row's `gap 10` + `paddingVertical 10` give a ≥44pt effective touch height; this matches all 10 shipped pills (no regression; if Mingla wants strict 44 it's a system-wide bump, flagged). Press feedback = TouchableOpacity default 0.2 opacity, non-shifting (no layout/scale change). accessibilityLabel: the pills currently rely on the visible `Text` label for the a11y name (same as all existing pills) — **design recommendation: implementor add `accessibilityRole="button"` + `accessibilityState={{selected: isSelected}}` to `categoryButton` for the whole grid (a one-line system improvement applied uniformly, not a per-new-pill divergence).**
6. **Zero anti-slop violations** — YES. No gradients, no stock/AI imagery, no emoji icons (uses the existing lucide allowlist), no decorative effects. Pure system extension.
7. **Copy in Mingla voice per state + reduced-motion fallback** — Copy: Part 5 (labels + warm concrete descriptions). Motion: the pills have NO animation (opacity-only press), so `prefers-reduced-motion` is inherently satisfied (nothing animates) — named, not hand-waved.

**Verdict: all 7 clauses hold.** One inherited contrast finding (selected pill 2.95:1) and two optional system-wide a11y improvements (44pt bump, accessibilityRole/State) are explicitly flagged as out-of-additive-scope global follow-ups rather than per-pill divergences, consistent with the "do not restyle existing pills" constraint.
