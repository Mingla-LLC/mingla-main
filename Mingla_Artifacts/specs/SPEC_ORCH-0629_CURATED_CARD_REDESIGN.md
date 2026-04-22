# Design Spec: Curated Card Redesign (ORCH-0629)

> Date: 2026-04-21
> Mode: COMPONENT (two targeted component changes)
> Platform: Mobile (React Native)
> States designed: populated (primary), single-stop, 2-stop, 3-stop, 4-stop, "Free" price, equal min/max, missing distance, missing travel time, loading image, placeholder image
> Dispatched by: Orchestrator ORCH-0629 · Prompt: `prompts/DESIGN_ORCH-0629_CURATED_CARD_REDESIGN.md`

---

## 1. Context & Intent

**User moment:** Browsing the deck. Photos are what stops the swipe. Text confirms the decision.

**Primary intent:** Decide whether to open this date plan.

**Primary action:** Tap "See Full Plan" (multi-stop) or "See Details" (single-stop).

**Success state:** User expands the card because the photos hooked them and the price + stop count told them it fits.

**What's changing and why:**
1. **Collapsed card** — current 55/45 split gives equal real estate to photos and text. Photos are the conversion lever on a swipe deck; text is confirmation. The 70/30 rebalance matches that hierarchy. The price label currently shows the first stop's tier (misleading: "a $$ date" might actually be 3 stops that total $220). Switching to a cumulative range tells the user the real number.
2. **Expanded card** — the stop's `placeType` text (e.g. "Italian Restaurant") duplicates the signal already carried by the stop header (`stopLabel` "Your dinner stop" + `placeName` + `role` subtitle). Removing it cleans 24px of vertical noise per stop and lets the photos breathe.

---

## 2. Information Architecture

### Collapsed card — content hierarchy (after redesign)

1. **Primary (70% viewport):** Stop photos — the emotional hook
2. **Secondary (one glance row):** Category + stop count ← → Cumulative price
3. **Tertiary (one glance row):** Title of the experience
4. **Quaternary (supporting meta):** Distance · travel time · rating
5. **Action:** CTA button

**Density:** Low-medium — the photos get room to breathe, the text is dense but not cramped. Four discrete rows in the info block, each doing one job.

**Progressive disclosure:** Full stop breakdown, aiDescription, hours, policies all live in the expanded card. Collapsed shows only what's needed to *decide to expand*.

### Expanded card stop row — content hierarchy (after deletion)

1. Stop header: number badge + stopLabel + placeName + role subtitle
2. Image gallery (scrollable, 140px)
3. *(optional)* Description preview (italic, 2 lines)
4. Meta row: rating · price tier + range · open/closed
5. Today's hours
6. Policies & reservations button (if website exists)

The removed `placeType` line sat between (3) and (4). Its semantic content is covered by the stop header's `stopLabel` ("Your dinner stop") and `role` subtitle ("Your dinner stop" or the optional-stop copy). Nothing is lost.

---

## 3. Layout Structure

### Collapsed card — before vs after

```
BEFORE (flex: 0.55 / 0.45 — current)        AFTER (flex: 0.70 / 0.30 — this spec)
┌────────────────────────────┐              ┌────────────────────────────┐
│                            │              │                            │
│   [ image strip — 55% ]    │              │                            │
│                            │              │                            │
│                            │              │   [ image strip — 70% ]    │
│                            │              │                            │
├────────────────────────────┤              │                            │
│ 🧭 Romantic · 3 stops      │              │                            │
│                            │              │                            │
│ Cozy Italian Evening       │              │                            │
│                            │              ├────────────────────────────┤
│ 📍 1.2mi · 🚗 15m · $$ ·⭐ │              │ 🧭 Romantic·3 stops  $120–$220│
│                            │              │ Cozy Italian Evening       │
│ [  See Full Plan  →  ]     │              │ 📍 1.2mi · 🚗 15m · ⭐ 4.6 │
│                            │              │ [  See Full Plan  →  ]     │
└────────────────────────────┘              └────────────────────────────┘
```

### Collapsed card — info section anatomy (the 30% block)

```
┌────────────────────────────┐  ← infoSection, flex: 0.30
│ padding: 14 / 12 / 12 / 14 │    (top / right / bottom / left)
│ ┌──────────────────┬─────┐ │
│ │ 🧭 Romantic·3stops│$120-│ │  row 1: identity + price (space-between, 20px h)
│ │                   │$220 │ │
│ ├──────────────────┴─────┤ │  gap: 4
│ │ Cozy Italian Evening   │ │  row 2: title (1 line, 17/22, bold)
│ ├─────────────────────────┤ │  gap: 4
│ │ 📍 1.2mi·🚗 15m·⭐ 4.6 │ │  row 3: secondary meta (18px, 13fs)
│ ├─────────────────────────┤ │  gap: 8
│ │ [  See Full Plan  →  ] │ │  CTA (40px, compact)
│ └─────────────────────────┘ │
└────────────────────────────┘
```

---

## 4. Visual Specification

### 4.1 Card-level flex ratios

| Element | Current | New | Rationale |
|---------|---------|-----|-----------|
| `styles.imageStrip` | `flex: 0.55` | `flex: 0.70` | Photo-dominant — matches user swipe behavior |
| `styles.infoSection` | `flex: 0.45` | `flex: 0.30` | Compact but legible — see state math §5 |

### 4.2 Info section container

| Property | Current | New |
|----------|---------|-----|
| `padding` | `12` | `{ paddingTop: 12, paddingHorizontal: 14, paddingBottom: 12 }` |
| `gap` | `6` | `8` (between major rows) — override per-row below |
| `justifyContent` | `'center'` | `'space-between'` — anchors CTA at bottom, header at top |

> **Why `space-between`:** With 4 elements in a fixed-height container, center-aligning leaves uneven top/bottom whitespace at different content widths. Space-between locks the identity row against the photos and the CTA against the bottom bezel — visually stable across stop counts.

### 4.3 Row 1 — Identity + Price

Replaces the current standalone category badge. New structure:

```jsx
<View style={styles.identityRow}>
  <View style={styles.categoryBadge}>...</View>
  <Text style={styles.priceText}>{priceLabel}</Text>
</View>
```

**`styles.identityRow`:**
```js
{
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}
```

**Category badge (compacted from current — reuse existing style, modify):**

| Property | Current | New |
|----------|---------|-----|
| `paddingHorizontal` | `8` | `8` (unchanged) |
| `paddingVertical` | `4` | `3` (tighter) |
| `borderRadius` | `8` | `8` (unchanged) |
| `backgroundColor` | `#F59E0B` | `colors.accent` (`#eb7825`) — align with ORCH-0589 chrome |
| Icon size | `12` | `11` |
| `categoryText` fontSize | `11` | `11` (unchanged) |
| `stopCountText` fontSize | `11` | `11` (unchanged) |

**Price label (new — prominent):**

```js
priceText: {
  color: '#ffffff',
  fontSize: 15,
  fontWeight: '700',
  letterSpacing: -0.2,
  flexShrink: 0,        // never wraps under the badge
  textAlign: 'right',
}
```

Why right-aligned bold: price is the second-most-important signal after the photo (is this date in my budget?). Bold right-aligned against the left-aligned category badge creates a strong scanning pattern — identity on the left, cost on the right.

### 4.4 Row 2 — Title

| Property | Current | New |
|----------|---------|-----|
| `fontSize` | `17` | `16` |
| `fontWeight` | `'700'` | `'700'` (unchanged) |
| `lineHeight` | `22` | `20` |
| `numberOfLines` | `2` | **`1`** |
| `color` | `'#fff'` | `'#fff'` (unchanged) |
| `letterSpacing` | (default) | `-0.1` (subtle tightening at smaller size) |

> **Why 1 line:** At 30% height, a 2-line title eats half the info block. Curated card titles are short by design (generated server-side ≤ 32 chars typical). Drop to 1 line with `ellipsizeMode="tail"` as defense. If the tester finds real titles truncating often, that's a content problem, not a design problem — kick back to the card generator.

### 4.5 Row 3 — Secondary meta

Drops price from current meta row (now lives in row 1). Keeps distance · travel · rating.

**`styles.metaRow`** — unchanged structure, minor refinements:

| Property | Current | New |
|----------|---------|-----|
| `flexDirection` | `'row'` | `'row'` (unchanged) |
| `alignItems` | `'center'` | `'center'` (unchanged) |
| `flexWrap` | (none) | `'nowrap'` — explicit |

**`styles.metaText`:**

| Property | Current | New |
|----------|---------|-----|
| `fontSize` | `13` | `12` |
| `color` | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.7)` (unchanged) |

**`styles.metaDot`:**

| Property | Current | New |
|----------|---------|-----|
| `fontSize` | `13` | `12` |
| `color` | `rgba(255,255,255,0.4)` | `rgba(255,255,255,0.4)` (unchanged) |

**Icons** (location pin, travel mode, star) — keep at `size: 11`.

### 4.6 CTA button

| Property | Current | New |
|----------|---------|-----|
| `backgroundColor` | `#F59E0B` | `colors.accent` (`#eb7825`) — align with accent |
| `borderRadius` | `12` | `12` (unchanged) |
| `paddingVertical` | `12` | `10` |
| `marginTop` | `4` | `0` (parent gap handles spacing) |
| `ctaText` fontSize | `15` | `14` |
| `ctaText` fontWeight | `'700'` | `'700'` (unchanged) |
| Arrow icon size | `16` | `14` |

Net button height: `10 + 14 + 10 = 34` content + border = ~36px. Still hits the 44px recommended touch target when `hitSlop` is applied (add `hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}` if not already present on TrackedTouchableOpacity).

### 4.7 Card container (unchanged)

```js
card: {
  flex: 1,
  backgroundColor: '#1C1C1E',
  borderRadius: 20,
  overflow: 'hidden',
}
```

No changes. Corner radius and background align with ORCH-0589 swipe-deck conventions.

---

## 5. State Designs

### 5.1 Populated — vertical space math

Typical iPhone 14/15 swipe card: `~640 × 380` (portrait card in deck).

At `flex: 0.30` info section = `192px` tall.

| Element | Height |
|---------|--------|
| Top padding | 12 |
| Row 1 (identity + price) | 22 (badge content height) |
| Gap | 8 |
| Row 2 (title, 1 line × 20 lineHeight) | 20 |
| Gap | 8 |
| Row 3 (meta, icons + 12fs) | 18 |
| Gap | 8 |
| CTA button | 36 |
| Bottom padding | 12 |
| **Total** | **144** |

Slack: `192 - 144 = 48px` — absorbed by `justifyContent: 'space-between'`. Identity sits at top, CTA sits at bottom, title+meta float in between. On smaller devices (iPhone SE ~570×338 card → info section ~101px), the slack disappears and the layout tightens naturally. Minimum viable info section height: ~144px. Phones below that depth will scroll, but curated cards don't render on that geometry in practice.

### 5.2 Single-stop card (`isSingleStop === true`)

- Image strip: single image fills full 70% (aspect ~350×266 on iPhone 14 → 0.76). Cinematic, fine.
- Badge: remove `stopCountText` (no " · 1 stop" copy — the singular reads weirdly). Keep only category name.
  ```jsx
  {!isSingleStop && (
    <Text style={styles.stopCountText}> · {visibleStops.length} stops</Text>
  )}
  ```
- CTA text: "See Details" (already handled by `ctaText` conditional in current code — preserve).
- Stop number badge overlay on photo: hide (already handled — `{!isSingleStop && <stopBadgeWrapper>...}`).

### 5.3 2-stop card

- Image strip: 2 equal-width images (`flex: 1` each). Aspect per photo ~175×266 → 0.66 (portrait-ish). Readable.
- Stop number badges visible on each.
- Identity badge: "Category · 2 stops"

### 5.4 3-stop card (most common)

- Image strip: 3 equal-width images. Aspect per photo ~117×266 → 0.44 (tall portrait). Still readable; people/place recognition survives.
- Stop number badges visible on each.
- Identity badge: "Category · 3 stops"

### 5.5 4-stop card (edge case, rare)

- Image strip: 4 equal-width images. Aspect per photo ~87×266 → 0.33 (very tall portrait). Starts to feel slivered.
- **Designer note to implementor:** Do not block 4-stop cards — they ship with the current layout and this is not the issue to solve. If visual review finds 4-stop cards feel "sliced," file a follow-up to add a subtle 1px divider between images or shrink the image strip to `flex: 0.65` for 4-stop specifically. Out of scope for ORCH-0629.

### 5.6 Price label — three rendering paths

**`priceLabel` computation** (replaces current lines 48-57):

```ts
const { totalPriceMin, totalPriceMax } = card;
const effectiveCurrency = currencyCode || 'USD';

const priceLabel = (() => {
  if (totalPriceMin === 0 && totalPriceMax === 0) return 'Free';
  if (totalPriceMin === totalPriceMax) return formatCurrency(totalPriceMin, effectiveCurrency);
  return `${formatCurrency(totalPriceMin, effectiveCurrency)}–${formatCurrency(totalPriceMax, effectiveCurrency)}`;
})();
```

**Rendering rules:**

| Condition | Output | Example (USD) | Example (EUR) |
|-----------|--------|---------------|---------------|
| Both 0 | `'Free'` | `Free` | `Free` |
| min === max | Single formatted currency | `$120` | `€110` |
| min < max | Range with en-dash separator | `$120–$220` | `€110–€202` |

**Separator:** Use en-dash `–` (U+2013), not hyphen `-`. The en-dash is the typographic convention for ranges. Copy-paste the character literally — do not template it.

**"Free" styling:** Same typography as other price states (no special color, no emoji). Keeping it understated avoids drawing eyes away from the title.

**No tier glyph, no tier word:** Per user decision. Not "$$" and not "Comfy."

**Removed imports** (`CuratedExperienceSwipeCard.tsx`):
- `googleLevelToTierSlug` — unused after redesign (was only used by derived priceTier logic, but that logic is removed)
- `tierLabel` — same
- `formatTierLabel` — same
- Keep: `formatCurrency`, `getCurrencySymbol`, `getCurrencyRate` (wait — `getCurrencySymbol` and `getCurrencyRate` are no longer needed because `formatCurrency` handles them internally; verify with implementor and remove if orphan)

### 5.7 Missing distance (`formattedDistance === null`)

Row 3 reflows naturally — the conditional `formattedDistance ? <>...</> : null` block drops out. Remaining meta items close the gap. Visual tested: icon + "15m · ⭐ 4.6" reads fine.

### 5.8 Missing travel time (`formattedTravelTime === null`)

Same reflow behavior. "1.2mi · ⭐ 4.6" reads fine.

### 5.9 Missing both distance and travel time

Row 3 shows only "⭐ 4.6 avg". The meta row collapses to minimal content. The card doesn't look broken — it just has less to say.

### 5.10 Loading image

Keep existing behavior: `Image` source with `resizeMode="cover"` renders a brief flicker. The placeholder `styles.imagePlaceholder` (`#2C2C2E`) covers the null-URL case. No design change — the taller photo strip inherits the existing loading treatment.

### 5.11 Placeholder image (no `imageUrl`)

Existing `<View style={[styles.stopImage, styles.imagePlaceholder]} />` renders a flat dark panel. At 70% height this gap is more noticeable. **Acceptable** — the card is already degraded content. If it becomes a frequent pattern, file a follow-up for a "no image" illustration.

### 5.12 Expanded card — post-deletion

No state changes to the expanded card except the `placeType` line disappears. The existing descriptionPreview (when present) still renders at 13px italic gray-400 above the meta row. When description is absent (non-expanded state), the image gallery's `marginBottom: 10` on `StopImageGallery.container` provides the spacing into the meta row — **verified: no orphan gap**. No spacing recovery needed.

---

## 6. Interaction Specification

No new interactions. The redesign preserves every existing interaction.

| Element | Gesture | Visual Feedback | Haptic | Result |
|---------|---------|-----------------|--------|--------|
| Card (swipe) | Horizontal pan | Card translates + rotates | Handled by SwipeableCards | Swipe left/right/up — unchanged |
| Card (tap anywhere non-CTA) | Tap | None | None | No-op (only CTA opens detail) — unchanged |
| CTA button | Tap | `activeOpacity: 0.85` | None | `onSeePlan()` — unchanged |
| Stop images (collapsed) | Tap | None | None | No-op — unchanged |

**No new haptics.** The redesign is purely layout.

---

## 7. Motion Specification

No new animations. The card enters and exits via SwipeableCards' existing motion system (outside this spec's scope).

**Layout transition:** If the implementor ships this redesign alongside cards already visible in the user's deck, React Native will re-layout the info section instantly (no animated transition between flex ratios). This is correct — no entrance choreography needed for a static restructure.

**Reduced motion:** Not applicable to this spec. No animations are added or removed.

---

## 8. Copy (All States)

Copy is not changing. Existing translations carry forward.

| State | Surface | Copy | Source |
|-------|---------|------|--------|
| Populated | Category badge | i18n `common:intent_<experienceType>` | Existing `categoryLabel` |
| Populated | Stop count (multi-stop) | ` · N stops` | Existing template |
| Populated | Stop count (single) | *(omit entirely)* | **New** — remove for singular |
| Populated | Title | `card.title` | Existing |
| Populated | Price (range) | `$X–$Y` | **New** — en-dash separator |
| Populated | Price (equal) | `$X` | **New** — collapsed single |
| Populated | Price (free) | `Free` | **New** — literal string |
| Populated | Distance | `formattedDistance` | Existing formatter |
| Populated | Travel time | `formattedTravelTime` | Existing formatter |
| Populated | Rating | `{avgRating} avg` | Existing |
| Populated | CTA (multi) | `See Full Plan` | Existing `ctaText` |
| Populated | CTA (single) | `See Details` | Existing `ctaText` |

**i18n note:** No new locale keys. The word "Free" is currently hardcoded in the price fallback at line 56 — this spec preserves that hardcoding. If i18n strictness is enforced later, wire to `common:free`; for this spec, match existing behavior.

---

## 9. Accessibility

| Element | Role | Label | Traits | Notes |
|---------|------|-------|--------|-------|
| Card container | (none) | (none) | — | Parent `SwipeableCards` owns swipe a11y |
| Image strip | (none, decorative) | (none) | — | Screen readers skip; info is in text below |
| Category badge | `text` | `"{categoryLabel} · {stopCount} stops"` | — | Stop count included for context |
| Price label | `text` | Price string as rendered | — | "One hundred twenty to two hundred twenty dollars" for `$120–$220` — VoiceOver will read the en-dash as "to" automatically |
| Title | `text` | `card.title` | header | Mark as section header so VoiceOver users can navigate cards by title |
| Meta items | `text` | As rendered | — | Icons are decorative — `accessibilityElementsHidden` |
| CTA button | `button` | `ctaText` | — | Existing `TrackedTouchableOpacity` a11y preserved |

**Contrast checks (dark card #1C1C1E background):**

| Text | Color | Ratio | WCAG |
|------|-------|-------|------|
| Title (`#fff`) | 17.40:1 | AAA ✅ |
| Category badge text on `#eb7825` | `#fff` → 3.05:1 | AA Large ✅ (badge text is 11pt bold — qualifies as large) |
| Price label (`#fff`) | 17.40:1 | AAA ✅ |
| Meta text (`rgba(255,255,255,0.7)`) | ~10.63:1 | AAA ✅ |
| CTA text (`#fff` on `#eb7825`) | 3.05:1 | AA Large ✅ (14pt bold) |

**Dynamic Type behavior:** React Native doesn't scale text by default. Existing cards already opt out. No change required for this spec — if the team wants Dynamic Type support, that's a separate initiative affecting every card type.

**Touch targets:**
- CTA button with hitSlop: ≥44×44 ✅
- No other tappable elements in the collapsed card

---

## 10. Platform Notes

### iOS-Specific
- Safe area: unchanged (parent SwipeableCards handles)
- Haptics: unchanged
- No Dynamic Island considerations (card doesn't intersect the bezel)

### Android-Specific
- Back button: unchanged (cards don't own back behavior)
- `elevation`: not used on the card itself (parent deck handles lift)
- Status bar: unchanged

---

## 11. Dark Mode

The curated card is **always dark** regardless of system theme — `backgroundColor: '#1C1C1E'` is hardcoded and correct for the swipe deck's black canvas. No light-mode variant exists or should exist. No changes needed.

---

## 12. Token Inventory

Every value in this spec maps to either a designSystem.ts token or a card-local constant justified below.

**designSystem.ts tokens used:**

| Token | Value | Used for |
|-------|-------|----------|
| `colors.accent` | `#eb7825` | Category badge bg, CTA button bg |
| `colors.gray[500]` | `#6b7280` | (none — formerly used by deleted placeType) |

**Card-local constants (not in tokens — existing conventions):**

| Constant | Value | Rationale |
|----------|-------|-----------|
| Card background | `#1C1C1E` | Canonical swipe-deck card bg (matches SwipeableCards conventions, ORCH-0589) |
| Title color | `#ffffff` | Standard dark-canvas text |
| Meta text color | `rgba(255,255,255,0.7)` | Standard dark-canvas secondary text |
| Meta dot color | `rgba(255,255,255,0.4)` | Standard dark-canvas separator |
| Placeholder image bg | `#2C2C2E` | One step lighter than card bg — subtle but distinct |

**No new tokens added to designSystem.ts.** The swipe-card styling is intentionally card-local — it's a surface with its own vocabulary.

**Color swap** (`#F59E0B` → `colors.accent` `#eb7825`): This is a **correction**, not a redesign. The current card uses `#F59E0B` (warning/amber tone) which doesn't match the app-wide Mingla orange (`#eb7825`). ORCH-0589 locked Mingla orange as the accent everywhere else. Aligning here restores brand consistency. Flag this to orchestrator: worth a one-line note in the implementation report.

---

## 13. Test Matrix (for Tester)

| # | Scenario | Expected visual outcome |
|---|----------|-------------------------|
| T1 | 3-stop card, populated, full meta | Photos fill 70% top; identity row shows "Romantic · 3 stops" left + "$120–$220" right; title 1 line; meta has distance · travel · rating; CTA "See Full Plan" |
| T2 | 3-stop card, `totalPriceMin === totalPriceMax === 80` | Price renders "$80" (no range, no en-dash) |
| T3 | 3-stop card, both totals === 0 | Price renders "Free" |
| T4 | Single-stop curated card | Single image fills 70%; stop count omitted from badge ("Romantic" only); CTA text "See Details"; no stop number overlay |
| T5 | 2-stop card | Two equal images in strip; badge "Category · 2 stops" |
| T6 | 4-stop card | Four equal (slivered) images; badge "Category · 4 stops"; card still renders, no overflow |
| T7 | Missing distance | Meta row "15m · ⭐ 4.6"; no layout break |
| T8 | Missing travel time | Meta row "1.2mi · ⭐ 4.6"; no layout break |
| T9 | Missing both distance and travel time | Meta row "⭐ 4.6 avg"; no layout break |
| T10 | Long title (30+ chars) | Title truncates with ellipsis on 1 line; no overflow |
| T11 | EUR currency | Price renders "€110–€202" with correct Euro symbol |
| T12 | Card background | Remains `#1C1C1E`; no light flash during mount |
| T13 | Expanded card — stop with aiDescription | Image gallery → description preview → meta row flow is continuous; no gap; placeType line is gone |
| T14 | Expanded card — stop without aiDescription | Image gallery → meta row flow is continuous with 10px gap from gallery's marginBottom; no visible gap-hole |
| T15 | Expanded card — optional stop | Deletion applies to all stop types; "Suggested" header still reads correctly |
| T16 | VoiceOver on collapsed card | Reads: category → stops count → price → title → meta → CTA — in that order |
| T17 | iOS + Android parity | Layout identical on both; no flex quirks |
| T18 | Deck regression | Non-curated cards (single-place, collab) unaffected — no style bleed |

**Regression priority checks:**
- SwipeableCards parent layout (swipe physics, translate, rotate) — unchanged
- `ExpandedCardModal` open/close flow — unchanged
- Other stop-level UI in expanded card (hours, policies, website button) — unchanged

---

## 14. Implementation Order

Implementor should apply changes in this order to minimize risk:

### Phase A — ExpandedCardModal deletion (lowest risk, ship first)

1. Delete lines 913–915 (the `<Text style={curatedStyles.placeType}>` element).
2. Delete the `placeType` style definition at lines 188–192.
3. Verify no other references to `curatedStyles.placeType` in the file (grep should return 0 hits after deletion).
4. Visually verify expanded card — stops should flow image → (description?) → meta cleanly.
5. No behavior testing required — pure deletion.

### Phase B — CuratedExperienceSwipeCard redesign

1. **Flex ratios:** `imageStrip.flex: 0.55 → 0.70`; `infoSection.flex: 0.45 → 0.30`.
2. **Info section padding/gap:** change `padding: 12, gap: 6` to `paddingTop: 12, paddingHorizontal: 14, paddingBottom: 12, gap: 8`; add `justifyContent: 'space-between'`.
3. **Replace price logic** (lines 48–57): delete the tier-based derivation and replace with the 3-path priceLabel logic from §5.6. Remove unused imports (`googleLevelToTierSlug`, `tierLabel`, `formatTierLabel`). Verify `getCurrencySymbol` and `getCurrencyRate` are genuinely unused and remove.
4. **Row 1 (identityRow):** wrap existing `categoryBadge` View + new `Text` for price in a new `<View style={styles.identityRow}>`. Remove stop-count text from badge when `isSingleStop`. Add `styles.identityRow` and `styles.priceText`.
5. **Category badge tweaks:** `paddingVertical: 4 → 3`, `backgroundColor: '#F59E0B' → colors.accent`, icon size `12 → 11`.
6. **Title:** `fontSize: 17 → 16`, `lineHeight: 22 → 20`, `numberOfLines={2} → {1}`, add `letterSpacing: -0.1`, add `ellipsizeMode="tail"`.
7. **Meta row:** remove the `priceText` rendering from inside the meta row (lines 132–133). Adjust meta text/dot `fontSize: 13 → 12`.
8. **CTA button:** `backgroundColor: '#F59E0B' → colors.accent`, `paddingVertical: 12 → 10`, remove `marginTop: 4`, `fontSize: 15 → 14`, arrow icon size `16 → 14`.
9. **Import `colors` from designSystem** if not already imported. Replace the two `#F59E0B` literals.

### Phase C — Verify + commit

- Run typecheck (`npm run typecheck` in app-mobile).
- Visual QA across T1-T18 scenarios.
- Do not touch i18n locales, services, hooks, or anything outside the 2 files.

---

## 15. Handoff Note to Implementor

Two targeted changes, one file each — no data pipeline, no new components, no i18n:

- **`ExpandedCardModal.tsx`**: delete a Text element (lines 913–915) and its style (lines 188–192). That's it. Ship separately from the collapsed-card work if you want — zero dependency between the two changes.

- **`CuratedExperienceSwipeCard.tsx`**: rebalance photo/info ratio from 55/45 to 70/30, replace the first-stop-tier price label with a **cumulative dollar range** using the card's existing `totalPriceMin`/`totalPriceMax` fields (no backend work — those fields are already on `CuratedExperienceCard`), compact the info block typography.

**Semantic shift to understand:** The price label going from "first stop's tier" to "total date cost range" changes what the user *sees* about a card. Some cards that used to read "$$" (Comfy) may now read "$120–$220." That's the intended improvement — users will see the real cost of the whole date instead of inferring from one stop. Don't "fix" this back.

**Color correction noted separately:** The current `#F59E0B` (amber) doesn't match Mingla's app-wide accent `#eb7825`. This spec aligns both the category badge and CTA button to `colors.accent`. Flag in the implementation report — it's a side-benefit correction, not scope creep.

**Do not:**
- Add animations to the ratio shift
- Restyle the image strip internals (borders between photos, gradients, etc.)
- Change the stop number badge (GlassBadge variant=circular — already correct per ORCH-0566)
- Touch the expanded card's other elements
- Change haptics, analytics, or tracking

**If you discover:**
- 4-stop cards look bad at 70/30 → ship anyway, file follow-up (out of scope)
- Long titles truncate too often → that's a content/generator problem, not this spec (file follow-up)
- An unused import surfaces after price logic change → delete it
- Anything else surprises you → "Surprises" section in implementation report, don't fix silently
