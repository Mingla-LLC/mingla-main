# DESIGN — ORCH-0998 [marketing real place cards — DC test run]

**Surface:** `mingla-marketing/` (Next.js App Router, Tailwind v4, framer-motion)
**Replaces:** `components/sections/explorer-home/hero-vibe-deck.tsx` (decorative 22-SVG auto-rotating stack)
**Mount point:** `components/sections/explorer-home/hero.tsx` ~L614, inside the one-screen no-scroll hero, in the `max-w-[min(420px, …)]` slot that already scales `0.82–1.08` with viewport.
**Scope:** test run, 5 hardcoded DC places, web-native HTML/CSS. No code in this doc — design only.

**References examined:** app's `SwipeableCards.tsx` single-card (88/12 split, 24pt title, glass badge row, bottom scrim, ~`glass.card.bezelRadius` corners) + `CuratedExperienceSwipeCard.tsx` (how a place is "sold", multi-photo strip) as the in-house visual language to echo; Airbnb listing card (photo-forward, rating inline with category, photo-count affordance), Hinge/Partiful card stacks (premium peeked stack motion), Apple Photos "N photos" pill (the gallery affordance). Synthesized, not cloned.

---

## 1. Card — dimensions, proportions, radius

- **Aspect / size:** portrait **4:5**, same footprint as today's deck — `width 260px`, `height 325px` (slot scaling stays in the hero wrapper; the card itself is fixed at 260×325 and inherits the wrapper's `transform: scale(…)`). Echoes the app's portrait card without the RN-only white action strip.
- **Corner radius:** `--radius-2xl` (**36px**) on the outer card — matches the app's ~40pt bezel feel within the marketing token set. `overflow: hidden` so the photo + frosted strip clip to the silhouette.
- **Split:** **photo 84%** (top) / **frosted info strip 16%** (bottom). The app uses 88/12 with the title *over* the photo; on web we lift the name+rating onto a frosted strip for legibility against arbitrary real photos (the app can trust its own scrim tuning; marketing can't, across 5 unknown photos). The sell-line + badges live in the photo's bottom scrim.
- **Elevation:** `box-shadow: 0 18px 40px -12px rgba(0,0,0,0.55)` (premium drop, reads on the dark `--color-smoke` canvas). Top card only; peeked cards behind get `0 8px 24px -8px rgba(0,0,0,0.45)`.
- **Border:** `1px solid rgba(255,255,255,0.08)` hairline rim (separates card from dark canvas).

## 2. Photo treatment + scrim

- **Hero photo:** ONE photo per card (`<placeKey>/0.jpg`), `object-fit: cover`, full-bleed across the 84% photo zone. `loading="eager"` for the front card, `lazy` for peeked. `decoding="async"`. `draggable=false`, `user-select:none`.
- **Background while loading:** `#1a1a2e` (matches app's `imageContainer` placeholder) so there is never a white flash on the dark hero.
- **Bottom scrim** (legibility for sell-line + badges over the photo): vertical gradient on the lower **52%** of the photo zone —
  `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)`. Pointer-events none, sits above photo, below text.
- **"5 photos" affordance** (the operator's "collapsed photos" framing): a single glass pill, **top-right**, inset `12px`. Reuses the `glass-soft` recipe. Content: a small stacked-rectangles glyph (inline SVG, 12px, `currentColor` at `rgba(255,255,255,0.92)`) + `5`. Height `24px`, `px-2`, `rounded-full`, `text-[11px] font-semibold`. This is the ONLY multi-photo signal — no in-card carousel, no dots. Decorative-but-honest: it states a real fact (5 photos exist) without implying interactivity in this test run (no click handler).

## 3. Typography (tokens: display = Mochiy Pop One, body = Nunito Sans)

| Element | Font | Size | Weight | Color | Notes |
|---|---|---|---|---|---|
| Place name | `--font-display` (Mochiy) | `18px` / line-height `1.15` | (Mochiy is single-weight) | `#FFFFFF` | 1 line, `truncate`. Lives on the frosted strip. Mochiy at 18 reads as the "Mingla" display voice without crowding 260px. |
| Category + rating row | `--font-sans` (Nunito) | `12px` | `600` | name strip: `rgba(14,14,16,…)` on frost → see §6 | one line, on the frosted strip under the name |
| Sell-line | `--font-sans` (Nunito) | `13px` / line-height `1.3` | `600` | `rgba(255,255,255,0.95)` | over the photo scrim, **max 2 lines** (`-webkit-line-clamp:2`), `text-shadow: 0 1px 3px rgba(0,0,0,0.7)` (echoes app `oneLiner`) |
| Badge text | `--font-sans` | `11px` | `600` | `rgba(255,255,255,0.92)` | inside glass pills |

Name uses display font (brand signature); everything else is Nunito for density and legibility — same hierarchy logic as the app (bold title, lighter meta).

## 4. Badge inventory — shown / dropped / placement

The app card shows: distance · travel-time · rating · price-tier · category. Hard product rule: anything implying a live "near you" reading is decorative/omitted.

**SHOWN (all real data):**
- **Rating** — `★ 4.5` + review count `(2,141)`. Placement: on the **frosted strip**, right-aligned in the category/rating row, e.g. `Italian Restaurant · ★ 4.5 (2,141)`. Star glyph inline SVG `--color-butter (#f4d679)` fill at 11px; rating number + count in strip text color. Review count in `--color-text-muted` weight 400 to de-emphasize vs the score.
- **Category** — real category string (`Italian Restaurant`, `Cocktail Bar`, …), left of the rating on the same strip row.
- **Price tier** — ONLY when present (L'Ardente `$$$`, Del Ray `$$`). Rendered as a glass pill in the **photo scrim**, bottom-left, left of nothing/first in the badge row. `$$$` = three `$` glyphs, dimmed-to-bright is NOT used (keep simple: full-opacity `$` count = tier). OKPB / Lincoln's Cottage / Anacostia have no price → **pill omitted entirely** (no "Free", no placeholder — absence is honest).

**DROPPED (app-only / personalized):**
- **Distance** — OMITTED entirely. It only means something for a logged-in user physically near the place; faking "0.4 mi" on a marketing page is dishonest. Cleanest to drop.
- **Travel time / "X min away"** — OMITTED, same reason.
- Saved/Scheduled state badges, Share button, swipe Like/Pass overlays — OMITTED (app-only chrome, per rules 4).
- No app-download / store CTA (rule 3).

**Badge layout summary:**
- Photo scrim, bottom-left → bottom: `[price pill (if any)]` then the **sell-line** below it.
- Frosted strip → `[Place name]` (row 1), `[Category · ★ rating (count)]` (row 2).
- Photo top-right → `[⧉ 5]` photos pill.

Price pill spec: `glass-soft`, `h-6`, `px-2`, `rounded-full`, `text-[11px] font-semibold`, text `rgba(255,255,255,0.92)`.

## 5. Sell-line — present / absent rules

- **Present** (L'Ardente, Lincoln's Cottage, Anacostia, Del Ray): render the editorial blurb in the scrim, **clamped to 2 lines**. If it overflows 2 lines, CSS line-clamp truncates with the ellipsis — no JS truncation. Blurbs are already ~1 sentence so 2 lines is comfortable at 13px on 260px width.
- **Absent** (OKPB — no blurb): fall back to a **category-derived sell-line**, NOT a generic "Discover this place." Deterministic map from category → one editorial line, e.g.:
  - `Cocktail Bar` → *"Craft cocktails and a room worth lingering in."*
  - `Restaurant` (any) → *"A table worth planning your evening around."*
  - `Park` → *"Open-air hours, whenever you need them."*
  - `Historical Landmark` → *"A piece of the city you can actually walk into."*
  - default → *"One of the spots locals actually go back to."*
  The fallback is a **hardcoded lookup keyed on category** in this test run (it never renders blank, never renders a raw category slug). OKPB (`Cocktail Bar`) therefore shows *"Craft cocktails and a room worth lingering in."* The fallback line is visually identical to a real blurb — the user never sees a "missing data" state.

## 6. Frosted strip color (the one light-on-dark exception)

The bottom 16% strip uses the app's frosted-white treatment so the name reads crisply regardless of photo:
- Background: `rgba(255,255,255,0.92)` with `backdrop-filter: blur(20px)` (mirrors app `cardDetails` `rgba(255,255,255,0.85)` but slightly more opaque for web text crispness).
- Top hairline: `1px solid rgba(14,14,16,0.06)`.
- Text on strip: name `#0e0e10` (`--color-ink`); category/rating `rgba(14,14,16,0.68)` (`--token-text-secondary` light value); review-count `rgba(14,14,16,0.48)`.

**Contrast (computed):**
- Name `#0e0e10` on `~#fafafa` frost → **≈ 18.5:1** (passes AAA, ≥4.5).
- Category `rgba(14,14,16,0.68)` ≈ `#565658` effective on frost → **≈ 6.8:1** (passes AA body ≥4.5).
- Sell-line `rgba(255,255,255,0.95)` over the `0.62` black scrim bottom (effective bg ≈ `#3a3a3a` worst case where scrim meets photo) → **≥ 7:1** with the `0 1px 3px` text-shadow guaranteeing the floor even over a bright photo edge → passes large-text ≥3 and body ≥4.5.
- Badge text `rgba(255,255,255,0.92)` on `glass-soft` (dark recipe, effective ≈ `#1c1e22`) → **≈ 11:1** (passes).

## 7. Showcase motion / layout — DECISION

**Keep the existing auto-rotating 3-card stack, swapping in the 5 real cards.** Justification: (1) it already fits the one-screen hero footprint exactly (`260+92 × 325+62`) so nothing in the no-scroll layout shifts; (2) a stack is the most premium, least busy way to show 5 cards in a 420px slot — a horizontal carousel implies scroll/interaction the hero deliberately avoids, and a fan crowds at this width; (3) the stack motion already reads as "a deck of places to swipe", which is exactly Mingla's mechanic, now made literal with real venues. Cycle through all 5 (not 3) by extending the rotation queue; show 3 at a time (front + 2 peeked).

**Stack geometry** (reuse current values, lightly tuned for the heavier real card): front `{scale:1, y:8}`, second `{scale:0.96, y:-14}`, third `{scale:0.92, y:-34}`. Front card z-top with full shadow; peeked cards dimmed via `filter: brightness(0.82)` + reduced shadow.

**Auto-advance:** `4200ms` interval (slightly slower than current 3600 — real cards have more to read). Front card exits left (`x:-380, opacity:0, scale:0.95`, `1.0s` ease `[0.4,0,0.2,1]`), back card enters at the rear. Pause on hover and on `visibilitychange` hidden (both already implemented — keep).

## 8. Micro-interactions

- **Idle:** the auto-rotate IS the idle motion. No extra ambient float (keep it calm).
- **Hover (front card):** `transform: translateY(-4px)`, shadow deepens to `0 24px 50px -12px rgba(0,0,0,0.6)`, `transition: 200ms ease-out-quart`. Pauses auto-advance (existing behavior). Photo does NOT zoom (avoids slop). The "5 photos" pill brightens `+8%`.
- **No press/click state** in this test run (no detail navigation wired — rule 3 parks CTAs). Cards are presentational. Cursor `default`, not `pointer`, so we don't imply a dead click.
- **Reduced motion:** `prefers-reduced-motion: reduce` → no auto-rotate, no exit/enter animation; render the **front card only**, static, with the 2 peeked cards shown statically behind it (no motion). Hover lift also disabled (the global reduced-motion rule in `globals.css` already kills transition-duration). This matches today's `useMinglaReducedMotion()` gate.

## 9. States

- **Loading (photo not yet decoded):** `#1a1a2e` fill in the photo zone; frosted strip + text render immediately (text is local data). No skeleton shimmer needed at this scale — the dark fill reads as intentional on the dark hero.
- **Photo error / 404:** fall back to the `#1a1a2e` fill + a centered 28px Mingla mark at `rgba(255,255,255,0.12)` (no broken-image icon). Name/sell-line/badges still render — the card never collapses.
- **Populated:** the normal state (5 real cards).
- **Empty / Offline / First-time / Returning / Submitting / Degraded:** **N/A** — this is a static marketing showcase with 5 hardcoded places and no user data, no network mutation, no auth, no submit. Listed and dismissed per the 9-state rule.

## 10. Accessibility

- The deck container keeps today's `aria-hidden="true"`? **No — change it.** Today's deck is decorative SVG art so it's correctly hidden. Real place cards carry real info, so the deck becomes a labelled region: `role="group"` `aria-label="Real places on Mingla, from Washington DC"`. Each card: `role="img"` with `aria-label="{name}, {category}, rated {rating} from {count} reviews. {sell-line}"`. Peeked (non-front) cards: `aria-hidden="true"` so a screen reader reads only the active card. Photo `<img>` `alt=""` (decorative; the card's aria-label carries meaning).
- The "5 photos" pill: `aria-hidden="true"` (decorative affordance; "5 photos" is not actionable here).
- No interactive targets in this test run → no 44pt/label requirements triggered. If a future ORCH wires card click, each card becomes a `<button>`/`<a>` with ≥44pt target + label.
- Star/price glyphs are inline SVG with `aria-hidden="true"`; their meaning is in the card aria-label.

## 11. Token usage (no magic numbers)

| Use | Token / value |
|---|---|
| Card radius | `--radius-2xl` (36px) |
| Pill radius | `rounded-full` |
| Accent (reserved, e.g. future CTA) | `--color-warm` `#eb7825` — NOT used on the card body in this test run |
| Star fill | `--color-butter` `#f4d679` |
| Photo placeholder | `#1a1a2e` (shared with app) |
| Strip text | `--color-ink` / `--token-text-secondary` (light values) |
| Badge surface | `glass-soft` utility |
| Display font | `--font-display` (Mochiy Pop One) |
| Body font | `--font-sans` (Nunito Sans) |
| Spacing | 4px grid: inset `12`, strip padding `12 / 14`, badge `px-2 h-6`, gaps `8` |
| Hover ease | `ease-out-quart` (`cubic-bezier(0.16,1,0.3,1)`) |

## 12. One-card mockup (L'Ardente, front card)

```
┌──────────────────────────────────────┐  ← 36px radius, 260×325, shadow on dark
│                              ┌──────┐  │
│      [ REAL HERO PHOTO ]     │ ⧉ 5  │  │  ← glass pill, top-right, "5 photos"
│        0.jpg, cover          └──────┘  │
│                                        │
│                                        │
│                                        │  84% photo zone
│ ┌────┐                                 │
│ │ $$$│  ← price pill (omit if none)    │  ← scrim bottom 52%
│ └────┘                                 │
│  Elegant Italian restaurant with       │  ← sell-line, Nunito 13/600,
│  chandeliers and a gold-plated oven.    │     2-line clamp, white + shadow
├────────────────────────────────────────┤  ← hairline
│  L'Ardente                              │  ← name, Mochiy 18, ink     16% frost
│  Italian Restaurant · ★ 4.5 (2,141)     │  ← Nunito 12/600, secondary    strip
└────────────────────────────────────────┘
```

OKPB variant (no price, no blurb): no `$$$` pill; sell-line = fallback *"Craft cocktails and a room worth lingering in."*; strip = `OKPB` / `Cocktail Bar · ★ 4.8 (269)`.

---

## Build notes for the implementor (concise)

1. New component `components/sections/explorer-home/hero-place-deck.tsx` replaces `HeroVibeDeck`; same import site in `hero.tsx` L614, same wrapper slot (no hero-layout change).
2. Hardcode the 5 DC places in a `const DC_PLACES` array: `{ name, category, rating, reviewCount, priceTier|null, blurb|null, photoBase }`. Resolve real `photoBase` (`…/place-photos/<placeKey>/`) from the place pool — names→keys are not slug-guessable; pull actual keys before build.
3. Reuse the `Pill` (`glass-soft`) primitive for badges. Reuse `useMinglaReducedMotion()`.
4. Category→fallback-sell-line is a local lookup in this component (test run); not a shared util yet.
5. Keep the auto-rotate/visibility/hover-pause logic from `HeroVibeDeck`; extend the queue to all 5; swap SVG `<img>` for the real card markup above.
6. Comment the omitted distance/travel-time decision inline so a future dev doesn't "add it back" thinking it was forgotten.
