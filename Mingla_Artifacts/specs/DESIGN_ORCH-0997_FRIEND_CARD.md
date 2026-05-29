# DESIGN — ORCH-0997 [Friend-page card tile → deck visual language]

**Mode:** COMPONENT. Pairs with `specs/SPEC_ORCH-0997_FRIEND_CARD_DECK_PARITY.md` (§5.2b + §5.4) and `reports/INVESTIGATION_ORCH-0997_FRIEND_CARD_DECK_PARITY.md`.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0997-[friend-card-deck-parity]/` on branch `ORCH-0997-friend-card-deck-parity`.
**Component:** `CompactCard` in `app-mobile/src/components/PersonHolidayView.tsx` (current `:246–340`, styles `:1109`,`:1216–1318`).
**Scope of THIS spec:** the rail TILE only. Out of scope (work as designed, do NOT touch): the birthday hero card, "Your Special Days" header + empty state, holiday section headers/countdowns, archived list, ShuffleButton, CalendarButton, the deck (`SwipeableCards.tsx`).

**References examined (premium-craft §3):** the in-app Mingla **deck card** (`SwipeableCards.tsx:2494–2604` — the canonical reference + live screenshots `/tmp/o997_home.png`, `o997_o2.png`, `o997_h2.png`); Airbnb category/wishlist rail cards (full-bleed photo tile with overlaid label + lozenge); Apple Music / Spotify horizontal "shelf" cards (portrait media tile, consistent chrome regardless of content type); Hinge profile prompt cards (single consistent card frame, no per-type background swap). Synthesis below is original Mingla — not cloned.

---

## 1. The component's job

A friend-profile rail tile is a **glance-and-tap** object: in a horizontal scroll under a birthday/holiday header, it must (a) read instantly as "a Mingla place/experience pick" — the same species as the deck card — and (b) open the full detail on tap. Today it reads as a foreign mini-thumbnail (150-wide landscape, image-top + white text block, curated tiles inverted to dark) — a different product. The fix: re-skin it into a **portrait full-bleed hero tile** that speaks the deck's language at rail scale, with ONE consistent frame for single AND curated.

This is NOT the full-screen swipe card (rail items stay compact — Option C was rejected). It is the deck card's language, miniaturized.

## 2. Anatomy (the new tile)

A single full-bleed photo card. Top-to-bottom layer stack (mirrors the deck):

```
┌────────────────────────┐  ← card: width 168, height 232, radius.lg(16), overflow hidden
│                        │     border 1px (sheet-separation), shadow (token below)
│      HERO PHOTO        │  ← CardHeroImage, contentFit cover, fills 100%×100%
│      (fills card)      │
│                        │
│  ░░ bottom gradient ░░ │  ← LinearGradient bottom 62% : transparent → rgba(0,0,0,0.78)
│  Title (2 lines max)   │  ← white 15/700, textShadow; bottom-anchored
│  [chip] [chip]         │  ← GlassBadge row, max 2, gap.sm(8)
└────────────────────────┘
```

No separate white content block. No dark-vs-white background swap. Curated and single share this exact frame; curated is distinguished only by its chip content (see §4), not by a different card color.

### Dimensions & tokens (🔒 LOCKED — all on the 4px grid)
- Card width: **s(168)** (was 150). Height: **s(232)** → portrait ratio ≈ 0.72 (echoes the deck's portrait feel; was a 150×~200 with a 100-tall landscape image). Width is responsive-stable; at 375/390/430pt the rail shows ~2.1 tiles (peek affordance preserved).
- Corner radius: **radius.lg = 16**.
- Hero image: fills card (width 100%, height 100%), `radius.lg` clipped by parent `overflow:'hidden'`.
- Bottom gradient: height **62%** of card, `colors: ['rgba(0,0,0,0)','rgba(0,0,0,0.35)','rgba(0,0,0,0.78)']`, `locations: [0,0.55,1]`, `pointerEvents:'none'`. (Deck uses 45% / 0.55 floor on a much taller card; the smaller tile needs a deeper floor for title+chip legibility.)
- Content overlay: absolute, bottom 0, padding **spacing.md(12 horizontal via grid-3) / 12 bottom / 12** — use **12** (3×4 grid). Title `marginBottom: spacing.sm(8)`.
- Chip row: `flexDirection:'row'`, `gap: spacing.sm(8)`, no wrap (max 2 chips; truncate by dropping the secondary chip before wrapping — see §4).
- Card shadow (lifts tile off the sheet): `shadowColor:'#000', shadowOffset:{0,2}, shadowOpacity:0.10, shadowRadius:8, elevation:3` (reuse `shadow.md` if present; matches the deck-family elevation).
- Card border (sheet separation, both themes): light `rgba(0,0,0,0.06)`; dark `rgba(255,255,255,0.10)` — 1px. (The profile sheet is currently light-canvas `#ffffff`; the dark token is future-safe.)
- Rail container (`cardsScroll`): keep horizontal ScrollView; `paddingHorizontal: 12`, item `gap: 12`, `paddingVertical: spacing.sm(8)`. (Unchanged from current grid-valid values.)

### Typography (🔒 LOCKED)
- Title: **fontSize s(15), fontWeight '700', lineHeight s(19), color #FFFFFF**, `numberOfLines={2}`, `textShadowColor:'rgba(0,0,0,0.6)', textShadowOffset:{0,1}, textShadowRadius:3`. (Deck title is 24/bold; 15/700 is its rail-scale expression.)
- Chips: inherit `GlassBadge` default text token — 13/'500'/0.2ls/18lh white. Do not override.
- No category/price/rating text lives OUTSIDE the chips (the old `compactCardCategory`/`compactCardPrice`/`compactCardTitle` content block is deleted).

### Color (🔒 LOCKED — light + dark)
The tile is a photo hero with a dark gradient + white text + glass chips — its internal palette is **theme-independent** (dark-on-photo in both light and dark app themes); only the card border/shadow adapt (above). Tokens:
- Title text: `#FFFFFF` on the gradient floor `rgba(0,0,0,0.78)`.
- Chips: `GlassBadge` tokens verbatim (`glass.badge.*`) — blur 24 dark, tint floor `rgba(12,14,18,0.42)`, hairline `rgba(255,255,255,0.14)`, white text/icon. The component already ships the Reduce-Transparency + Android<31 solid fallback (`rgba(20,22,26,0.92)`).
- Curated accent (single permitted distinction): a **1px top hairline** in `rgba(235,120,37,0.9)` (accent `#eb7825`) flush to the card's top edge, OR the curated chip's icon tinted — pick ONE (see §4). No dark card background.
- Missing-image fallback fill: `colors.primary[50] = #fff7ed` with a centered category `Icon` (size s(28), color `#eb7825`) — never a fabricated photo (Constitution #9).

### Computed contrast (🔒 LOCKED — numeric)
- Title white `#FFFFFF` on gradient floor `rgba(0,0,0,0.78)` over a worst-case mid-luminance photo (≈0.5): effective background luminance ≤ ~0.11 → contrast ≥ **~13:1** (body threshold 4.5:1 — PASS by a wide margin; the 62% gradient + textShadow guarantee the title band is near-black). On a bright photo the floor still drives effective bg dark → ≥ 8:1.
- Chips: `GlassBadge` white text on `rgba(12,14,18,0.42)` tint floor + dark blur → the shipped deck chip; measured effective ≥ **~7:1** (large/medium text threshold 3:1 — PASS). This is the exact chip already approved on the deck.
- Both hold in light AND dark app themes (palette is photo-intrinsic).

## 3. The image renderer (🔒 LOCKED intent, 🎨 OPEN mechanism)
Use the **same hero renderer as the deck (`CardHeroImage`)** so loading fade-in + missing-image behavior match the deck exactly. If `CardHeroImage`'s API doesn't fit a fixed-size tile, use `expo-image` with `contentFit:'cover'`, a 200ms fade `transition`, and the §2 branded fallback for a null/failed `imageUrl`. Do NOT use the raw RN `<Image>` (the current `:290` source of inconsistent loading). 🎨 OPEN: which of the two, and blurhash placeholder if available.

## 4. Variants — single vs curated (ONE frame, chip-differentiated)

Both variants are the identical full-bleed hero frame. The ONLY differences:

**Single place:**
- Chip 1 (always): category — `GlassBadge` with `iconName = getCatIcon(category)`, text = `getReadableCategoryName(category)`.
- Chip 2 (conditional): rating — `GlassBadge iconName="star"` text = `rating.toFixed(1)` — ONLY when `rating > 0`. If no rating but a price tier exists, Chip 2 = price (`iconName="pricetag"`, `formatTierLabel(...)`). If neither, omit Chip 2 (single chip row).

**Curated experience:**
- Chip 1 (always): stops — `GlassBadge iconName="git-branch-outline"` (route glyph) text = `i18n.t('social:holiday.stops', { count: stops })` ("2 stops").
- Chip 2 (conditional): experience type — `GlassBadge` with the experience-type icon (`heart-outline` romantic / `compass-outline` adventurous / `sparkles-outline` default) text = the experience label.
- Curated distinction beyond chips: the **1px accent top-hairline** (`#eb7825`, §2). This replaces the old dark `#1C1C1E` background entirely. 🎨 OPEN: designer-implementor may instead tint the stops-chip icon `#eb7825` if the hairline reads too subtle on device — pick exactly one, not both.

Title for both = `card.title` (e.g. "Nike Art Gallery", "Nike Art Gallery → FoLiXx Bukka"). The "→" in curated titles is preserved by the source data.

Max 2 chips, no wrap. If Dynamic Type makes 2 chips overflow 168pt width, drop Chip 2 (keep category/stops). Never wrap to a second chip line.

## 5. All 9 states

1. **Loading** — skeleton tile: solid `colors.gray[100]` (#f3f4f6) rounded rect at the new 168×232 / radius.lg, subtle shimmer (reuse existing skeleton; restyle to portrait dims). (Existing `skeletonRow`/`skeletonSingleCard` updated to 168×232.)
2. **Error** (row-level fetch fail) — unchanged `CardRow` error row ("Couldn't load" + retry). Not a tile state.
3. **Empty** (no cards, with emptyReason) — unchanged `noCardsCard` ("No strong picks yet"). Not a tile state.
4. **Populated** — the hero tile (§2/§4).
5. **Submitting** — N/A (a tile has no submit action; tap opens a modal). State named + excluded.
6. **Offline / image failed** — tile renders with the §2 branded fallback fill (category icon on `#fff7ed`); title + chips still render from data. No broken-image glyph, no crash.
7. **First-time** — identical to Populated (no onboarding overlay on a rail tile).
8. **Returning** — identical to Populated.
9. **Degraded** (missing rating AND price, or missing image) — chips gracefully reduce (category-only row); image falls back. No "N/A", no fabricated value (Constitution #9).

## 6. Interaction & motion (🔒 LOCKED behavior, 🎨 OPEN feel within band)
- Whole tile is the tap target (168×232 ≫ 44pt) → `onPress` opens `ExpandedCardModal` (the §5.1 mapper from the functional spec supplies correct data).
- **Press feedback:** scale to **0.97** over **120ms** `Easing.out(ease)` on pressIn, back on pressOut (transform only — non-shifting, no layout move). Light haptic (`Haptics.impactAsync(Light)`) on pressIn, iOS only, failure non-fatal — mirrors `GlassBadge`/deck micro-interaction. `activeOpacity` may stay as a fallback.
- **Chip entry:** chips render static inside the tile (no stagger — the deck staggers chips only on the front swipe card; rail tiles render plainly to avoid scroll jank). 🎨 OPEN: a subtle 150ms fade-in on first appear is acceptable.
- **`prefers-reduced-motion`:** skip the press scale (opacity 0.9 on press instead); skip any fade. `GlassBadge` already self-handles reduced motion.

## 7. Accessibility (🔒 LOCKED)
- Tile `accessibilityRole="button"`, single composed `accessibilityLabel`:
  - single: `` `${title}, ${categoryLabel}${rating>0 ? `, rated ${rating.toFixed(1)}` : ''}` ``
  - curated: `` `${title}, ${experienceLabel || 'Curated'}, ${stops} stops` ``
  (This matches the content-desc already observed on device — keep it.)
- Chip container inside the tile: `importantForAccessibility="no-hide-descendants"` (iOS `accessibilityElementsHidden`) so the reader announces the ONE button label, not each chip separately.
- Dynamic Type: title `allowFontScaling` (default true), capped at 2 lines; chips scale via `GlassBadge` default. At the largest sizes the tile keeps width 168 and clips title at 2 lines — chips drop to 1 before overflow (§4).
- Touch target ≥ 44pt: satisfied by the full-tile press.

## 8. Anti-slop check (premium-craft §2) — PASS
- No generic gradient as decoration — the bottom gradient is functional (legibility scrim), matching the deck. No rainbow/AI gradients.
- No stock/AI imagery — real place photos via `CardHeroImage`; honest branded fallback when absent.
- No emoji icons — Ionicons via `Icon`/`GlassBadge` only.
- No decorative effects — shadow + 1px border are functional (depth, sheet-separation). The single curated accent hairline is a semantic signal, not ornament.
- Restraint: max 2 chips, 2-line title, one frame for all variants — removes the prior curated/single inconsistency.

## 9. Copy (Mingla voice) — per state
- Missing image fallback: no text label on the tile (the title + chips carry meaning); the icon-on-cream fallback speaks for itself. (Detail-modal empty image is owned by the functional spec / `ExpandedCardModal`, not this tile.)
- Stops chip: existing i18n `social:holiday.stops` ("{{count}} stops") — unchanged.
- No new strings introduced by the tile reshape (all labels come from existing data + i18n).

## 10. Implementor notes / handoff to build
- Replace `CompactCard`'s JSX (`:281–339`) and styles (`compactCard*` `:1216–1318`) with the §2 hero-tile structure. Delete `compactCardCurated` dark-bg style, the image-top/content-block layout, `compactCardImageFallback` landscape variant (replace with the §2 portrait fallback), and the footer price/rating/arrow row (those become chips).
- Keep `CARD_W` but set to `s(168)`; add card height `s(232)`.
- The `isCurated` prop continues to drive chip content + the accent hairline (not a background swap).
- Reuse `GlassBadge` (`components/ui/GlassBadge.tsx`) verbatim for chips — do not build a new chip.
- This is purely presentational; the open-path data fix (functional SPEC §5.1–5.3) is independent and lands in the same PR.

## 🔒 LOCKED / 🎨 OPEN summary
- 🔒 LOCKED: one full-bleed hero frame for single+curated (no dark/white split); dimensions 168×232/radius.lg; gradient 62%/0.78 floor; title 15/700 white + shadow, 2 lines; `GlassBadge` chips (max 2, the deck chip verbatim); branded image fallback (no fabrication); computed contrast ≥4.5:1 title / ≥3:1 chips; full-tile ≥44pt button + composed a11y label + chip descendants hidden; press scale 0.97/120ms + light haptic + reduced-motion fallback; rail layout preserved; anti-slop bans; no deck edit.
- 🎨 OPEN: `CardHeroImage` vs `expo-image` for the renderer + blurhash; curated accent = top-hairline vs tinted-stops-icon (pick one); optional 150ms chip fade-in; exact skeleton shimmer.
