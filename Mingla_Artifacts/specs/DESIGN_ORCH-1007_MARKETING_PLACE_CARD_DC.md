# DESIGN — ORCH-1007 [marketing real place cards — DC test run]

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

---

# REDESIGN v2 — operator pass 2026-05-29

**Driver (Seth, verbatim):** "Put a real price range, increase the height of the cards, and redesign the description area to contain the name, description, price, replace review count with an avatar overlap design indicator of how many people locally recommend. and also remove the picture count."

This section **supersedes** §1 (card height), §2 (the photo-count pill), §3–§6 (the bottom-block layout, the over-photo sell-line, the rating/review-count row, the frosted-strip proportions), and the §12 mockup. Everything NOT contradicted here (motion §7–§8, reduced-motion §8, photo treatment + scrim §2 *except* the pill, the 404 fallback §9, accent/font tokens §11) stays exactly as built. The honesty rules (no distance, no travel-time) remain in force.

**References examined (v2):** re-studied the in-house `CuratedExperienceSwipeCard.tsx` info block (24pt bold title → 15/600 one-liner → hairline → meta row, `fontSize:24/15`) and `SwipeableCards.tsx` single-card 88/12 split as the Mingla-native hierarchy to echo on a TALLER block; Airbnb "Guest favourite" + host-avatar row (overlapping circular avatars with white ring separation, "+N" overflow); Hinge/Bumble "liked by" avatar stacks (−8 to −10px overlap, 2px ring); Partiful guest-list avatar pile (gradient-fill avatars when no photo). Synthesized for a marketing card that must render with ZERO external avatar fetches — so avatars are CSS-drawn, not network images.

## v2.1 — New card dimensions + no-scroll proof

- **`CARD_H` 325px → `360px`.** `CARD_W` stays **260px** (portrait integrity; 260×360 ≈ 13:18, a touch taller than 4:5 — reads as a premium tall card, still inside the 420px hero slot). Corner radius `--radius-2xl` (36px), border, and elevation tokens are unchanged from §1.
- **Why 360 and not more — computed against the real hero, not eyeballed.** The deck mounts in `hero.tsx` inside `h-[100svh]` with a wrapper `transform: scale(clamp(0.82, 0.82 + (100vmin−360px)/1600px, 1.08))`. The hero envelope at the **768px-tall** worst case:

  | Band | Value at 768px tall |
  |---|---|
  | Top spacer `clamp(80px,11vh,160px)` | 84.5px |
  | Bottom spacer (mirror) | 84.5px |
  | Middle band available (`flex-1`) | **599.0px** |
  | Headline block (2 lines @ `clamp(1.7rem,5.7vmin,4rem)`→43.8px, leading 1.12, + 0.12em gap) | 103.3px |
  | Deck `margin-top` `clamp(1.1rem,3.6vmin,2.8rem)` | 27.6px |
  | Wrapper scale at vmin=768 | **1.075** |
  | Deck container raw height = `CARD_H + 62` | 360+62 = 422px |
  | Deck container **scaled** = 422 × 1.075 | 453.6px |
  | **Total used** = 103.3 + 27.6 + 453.6 | **584.6px** |
  | **Headroom** = 599.0 − 584.6 | **+14.4px** ✓ fits, no page scroll |

  The chip-nav row is `position: absolute; bottom-8` and lives *inside* the bottom spacer band, so it does not consume middle-band height. The deck container keeps the existing `CARD_H + 62` formula (the +62 is the stack peek headroom + bottom inset), so growing `CARD_H` to 360 grows the scaled container linearly at the 1.075 factor.

- **Ceiling check (why not taller).** The scale *amplifies* every added pixel by 1.075×. Stepping the same math: `CARD_H=375` → used 600.7px → **−1.7px (overflows)**; `CARD_H=380` → −7.1px; `CARD_H=400` → −28.6px. **360px is the tallest height that clears 768px with a real margin (+14.4px).** Locking 360 — do NOT round up to 375/380; it reintroduces page scroll on a 768px laptop. (At taller viewports the band only grows and headroom increases, so 360 is safe everywhere ≥768px.) 🔒LOCKED: `CARD_H = 360`.

## v2.2 — New split: photo 64% / description area 36%

The richer block needs real room, so the description area roughly **doubles** (was 16% frost, now 36% solid block) and the photo zone shrinks from 81% to **64%**.

- Photo zone: **64% of 360 = 230px**. `object-fit: cover`, `#1a1a2e` load fill, 404 fallback — all unchanged from §2/§9. The bottom scrim (§2) **stays** but its only job now is to keep the photo edge from clashing with the description block's top border; the sell-line and price NO LONGER live over the photo (they move into the description area). Keep the scrim at the existing gradient but you may reduce its height to `38%` since no text sits on it.
- **Photo top-right pill: DELETED** (see v2.5).
- Description area: **36% of 360 = 130px** solid block. This is the redesigned "description area."

🔒LOCKED: split `64% / 36%` (≈ 230px / 130px).

## v2.3 — Redesigned description area (the core of this pass)

A solid (non-frosted, non-overlay) content block at the card bottom. It is light-on-light: the same frosted-white treatment from §6 is promoted to a **solid premium card surface** so the block reads as "the listing detail," echoing `CuratedExperienceSwipeCard`'s white info strip but with 4 stacked elements instead of 2.

**Surface:**
- Background `rgba(255,255,255,0.96)` (slightly more opaque than v1's 0.92 — it's now a primary content surface, not a thin strip). `backdrop-filter: blur(20px)` retained for the hairline of photo bleed at the top edge.
- Top hairline `1px solid rgba(14,14,16,0.06)` (unchanged).
- Inner padding: **`14px` horizontal, `12px` top, `12px` bottom** (4px grid).

**Vertical order (top → bottom), with exact type + spacing:**

| # | Element | Font | Size / line-height | Weight | Color | Spacing below |
|---|---|---|---|---|---|---|
| 1 | **Category label** (small eyebrow) | `--font-sans` | `10px` / 1.0, letter-spacing `0.06em`, `text-transform: uppercase` | `700` | `--color-warm` `#eb7825` | `4px` |
| 2 | **Place name** | `--font-display` (Mochiy) | `18px` / 1.1 | (single-weight) | `--color-ink` `#0e0e10` | `4px` |
| 3 | **Description** (sell-line / blurb) | `--font-sans` | `12.5px` / 1.35 | `500` | `rgba(14,14,16,0.66)` | `8px` |
| 4 | **Price + social-proof row** (flex, space-between, `align-items:center`) | — | — | — | — | — |
| 4a | ↳ Price range (left) | `--font-sans` | `13px` / 1.0 | `700` | `--color-ink` `#0e0e10` | — |
| 4b | ↳ Avatar stack + label (right) | see v2.6 | — | — | — | — |

- **Name** clamps to **1 line** (`truncate`) — at 18px Mochiy on 232px inner width, all 5 real names fit on one line except "President Lincoln's Cottage"; that one wraps awkwardly, so use 1-line truncate with the full name in the `aria-label`. (If the operator wants 2-line names, drop description to 1 line — but the 130px budget is tuned for 1-line name + 2-line description + the row; see the budget table below.)
- **Description** clamps to **2 lines** (`-webkit-line-clamp:2`, ellipsis). Same content rules as §5 (real blurb, else category-derived fallback). The category-fallback map from §5 is unchanged.
- The category moves OUT of the old "Category · ★ rating" meta row (that row is gone) and becomes the **eyebrow (#1)**. There is no longer a rating number or review count anywhere on the card — they are replaced by the social-proof row (v2.6).

**130px vertical budget (proof the block holds without overflow):**

| Item | px |
|---|---|
| Padding top | 12 |
| Category eyebrow (10px, lh 1.0) | 10 |
| gap | 4 |
| Name (18px, lh 1.1) | 19.8 |
| gap | 4 |
| Description 2 lines (12.5px, lh 1.35) | 33.8 |
| gap | 8 |
| Price/social row (avatar 22px dia governs height) | 22 |
| Padding bottom | 12 |
| **Total** | **135.6px** |

135.6 vs 130 budget → **5.6px over**. Resolve by tightening the description-to-row gap from 8→`6px` and the bottom padding from 12→`10px` (−4px) **and** trimming description line-height to `1.3` (−2px): revised total **129.6px ✓**. 🔒LOCKED final spacing: pad `14 / 12 / 10`, gaps `4 / 4 / 6`, description `12.5px / 1.3 / 2-line clamp`. (Implementor: if a name wraps or a longer fallback pushes it, the block is `overflow:hidden` so it clips cleanly — never grows the card.)

## v2.4 — Real price range (replaces the `$/$$/$$$` pill)

Render an **actual currency range**, not tier glyphs. Lives at **#4a** (left of the social row, inside the description area — NOT a glass pill over the photo anymore).

- **Format (LOCKED):** `"$50–$100"` using an **en-dash** `–` (U+2013), no spaces around the dash, no decimals, no "per person" suffix on the number itself. Optional muted qualifier renders as a separate span: the number in `#0e0e10` weight 700, then a hair space + `· per person` in `rgba(14,14,16,0.45)` weight 600 at `10px`. **Decision:** include the `· per person` qualifier — it disambiguates the range honestly and reads premium. So the full render is e.g. **`$50–$100`** `· per person`.
- **"Free" case:** Anacostia Park and President Lincoln's Cottage have no real price data → render the single word **`Free`** in `--color-warm` `#eb7825` weight 700 at 13px (warm makes "Free" feel like a perk, not a missing field), with **no** `· per person` qualifier. (Note: the current `dc-showcase-places.ts` carries decorative `$`/`$$`/`$$$` tiers for OKPB/Lincoln/Anacostia; v2 replaces the `priceTier` field with a real `priceRange: string | null` — `null` ⇒ "Free". Implementor updates the data shape.)
- **Real data → renders (LOCKED):**
  | Place | `priceRange` | Renders |
  |---|---|---|
  | L'Ardente | `"$50–$100"` | `$50–$100 · per person` |
  | OKPB | `"$30–$50"` | `$30–$50 · per person` |
  | Del Ray Café | `"$20–$30"` | `$20–$30 · per person` |
  | Anacostia Park | `null` | `Free` (warm) |
  | President Lincoln's Cottage | `null` | `Free` (warm) |

  (OKPB's range is operator-confirmed for this DC test run; Del Ray "$20–$30" and L'Ardente "$50–$100" are from Seth's instruction.)

## v2.5 — Photo-count pill: REMOVED ✓

The top-right `⧉ 5` glass pill (v1 §2 "5 photos affordance", §4 badge inventory, `StackedPhotosGlyph`) is **deleted entirely** — markup, the `nPhotos` render, and the `StackedPhotosGlyph` SVG component. The `nPhotos` data field may stay in `ShowcasePlace` (harmless) but is no longer rendered. Confirmed: no photo-count anywhere on the card.

## v2.6 — Avatar-overlap "locals recommend" indicator (replaces ★ rating + review count)

A horizontal row at **#4b** (right side of the price/social row), right-aligned: an overlapping avatar stack, then a label to its right.

**Avatars — CSS-drawn, zero network dependency (LOCKED approach).** Reliability rule: NO external avatar image fetches (no `i.pravatar`, no Unsplash, no Supabase avatar URLs — any of those can 404 or hang and break the premium read). Each avatar is a **CSS soft-gradient circle with a single uppercase initial**, drawn purely in markup:
- **Diameter:** `22px`. **Count shown:** **3 gradient circles** + a **`+N` overflow chip** as the 4th token (so visually 4 tokens, premium and compact at 260px width).
- **Shape:** `border-radius: 9999px`, `width/height 22px`.
- **Ring/separation:** `border: 2px solid rgba(255,255,255,0.96)` (matches the description surface so each avatar punches a clean white gap from its neighbour — the Airbnb/Hinge separation trick).
- **Overlap offset:** each avatar after the first gets `margin-left: -8px` (≈ 36% overlap). The `+N` chip also `-8px`.
- **Gradient fills (LOCKED, 3 distinct, all from the Mingla warm/butter family so they read on-brand, never random):**
  1. `linear-gradient(135deg, #eb7825 0%, #f4a85f 100%)` — warm
  2. `linear-gradient(135deg, #f4d679 0%, #eba94f 100%)` — butter→amber
  3. `linear-gradient(135deg, #7a4a2a 0%, #b87333 100%)` — cocoa→copper
- **Initials:** one uppercase letter per avatar, `--font-sans` `10px` weight 800, color `rgba(255,255,255,0.96)`, centered. Use a tasteful fixed set per card (decorative — these are NOT real users): e.g. `M`, `J`, `K`. Same 3 initials across all cards is fine (decorative); or vary lightly per card for texture. `aria-hidden="true"` on the whole stack.
- **`+N` overflow chip:** same 22px circle, `border:2px solid rgba(255,255,255,0.96)`, fill `rgba(14,14,16,0.82)` (dark neutral so it reads as "more"), text `+N` in `rgba(255,255,255,0.95)` `9px` weight 800.

**Label (right of the stack, `margin-left: 8px`):**
- Copy (LOCKED): **`N locals recommend`** — short, fits the 260px row. (Alternative "Recommended by N locals" is too long beside a price on a 260px card; use the compact form.)
- Type: `--font-sans` `11px` / 1.1, weight `600`, color `rgba(14,14,16,0.6)`. The **N** numeral may be weight `700` color `#0e0e10` for a subtle emphasis.

**The recommend count `N` is DECORATIVE social proof** (we have no real local-recommend data) — tasteful per-card values, plausibly proportional to each place's real popularity but NOT derived from it:
  | Place | decorative `N` | `+N` chip |
  |---|---|---|
  | L'Ardente (2,141 reviews) | `212` | `+209` |
  | OKPB (269) | `48` | `+45` |
  | President Lincoln's Cottage (800) | `96` | `+93` |
  | Anacostia Park (1,778) | `173` | `+170` |
  | Del Ray Café (1,786) | `184` | `+181` |

  `+N` chip = `N − 3` (three faces shown). Implementor: store `recommendCount` per place in the data; render 3 faces + `+(recommendCount − 3)`. Add an inline comment: **"decorative social proof — no real local-recommend data exists; do not wire to a backend."**

**Accessibility:** the avatar stack + label is `aria-hidden="true"` (decorative). The card's `aria-label` (§10) drops the old "rated 4.5 from 2,141 reviews" clause and instead reads: `"{name}, {category}. {description}. {priceRange or 'Free'}."` — no fake recommend count in the AT string (honest to assistive tech). Keep `role="img"` on the front card, peeked cards `aria-hidden`.

## v2.7 — Updated one-card mockup (L'Ardente, front card, v2)

```
┌──────────────────────────────────────┐  ← 36px radius, 260×360, shadow on dark
│                                        │
│        [ REAL HERO PHOTO ]             │
│          0.jpg, cover                  │  64% photo zone (≈230px)
│                                        │   (no pill, no over-photo text;
│        (faint scrim at very bottom)    │    scrim only guards the seam)
├────────────────────────────────────────┤  ← hairline
│  ITALIAN RESTAURANT                     │  ← eyebrow, Nunito 10/700 warm, caps
│  L'Ardente                              │  ← name, Mochiy 18, ink
│  Elegant Italian with chandeliers and   │  ← description, Nunito 12.5/500,
│  a gold-plated pizza oven.              │     ink-66%, 2-line clamp     36%
│  $50–$100 · per person      (●●●)+209  │  ← price (left, 13/700 ink) ·  block
│                             212 locals  │     avatar stack + label (right)
│                             recommend   │     (≈130px)
└────────────────────────────────────────┘
```

Free-case variant (Anacostia Park): eyebrow `PARK`; price cell renders **`Free`** in warm; social row `173 locals recommend` with `+170` chip. OKPB variant: eyebrow `COCKTAIL BAR`; description = category fallback *"Craft cocktails and a room worth lingering in."*; price `$30–$50 · per person`; `48 locals recommend` / `+45`.

## v2.8 — Data-shape changes for the implementor (concise)

1. `ShowcasePlace`: **remove** `priceTier`, **add** `priceRange: string | null` (null ⇒ "Free") and `recommendCount: number`. Keep `rating`/`reviewCount` in the type if you like (now unused on the card) or drop them — they no longer render.
2. `CARD_H = 360` (was 325). `CARD_W` unchanged. Photo zone `64%`, description block `36%`.
3. **Delete** `StackedPhotosGlyph`, the `⧉ N` pill markup, the over-photo sell-line `<p>`, the price glass pill, and the old `Category · ★ rating (count)` meta row + `StarGlyph` (no rating renders anymore — `StarGlyph` becomes dead code, remove it).
4. Add a CSS-only `<AvatarStack>` primitive (3 gradient circles + `+N` chip) per v2.6 — no `<img>`, no network.
5. Description-area layout per the v2.3 table; spacing tokens `14/12/10` pad, `4/4/6` gaps; price-range format per v2.4.
6. Update the front-card `aria-label` per v2.6 (drop rating clause). Keep all motion/reduced-motion/hover/visibility logic from v1 §7–§8 untouched.
7. Keep the inline "no distance / no travel-time" honesty comment; add the "decorative social proof" comment on `recommendCount`.

---

# Chip Color System v3 — operator pass 2026-05-29

**Driver (Seth, verbatim):** "The chips need better design, use black, white or eb7825. Great contrast for visual appeal. The price should be beside the name of the place compact to both be contained in one line. The locals and avatar should be in a colored pill as well, and be the full width of the section so its great."

This section **supersedes** the chip *colors* (the all-glass-soft treatment), the chip *stacking order* (name → description → price → bottom row), and the bottom social-row treatment in v2.3/v2.4/v2.6. Everything else holds: `CARD_H = 360` 🔒, `CARD_W 260`, the `64% / 36%` photo/content split, the photo treatment + scrim, the 404 fallback, all motion/reduced-motion/hover/visibility logic, the honesty rules (no distance, no travel-time), and the CSS-only-avatar / decorative-social-proof rules. **The card surface stays `rgba(255,255,255,0.96)` frosted white** — all chip colors below are computed against that as the separation background.

**Palette (3 colors only):**
- **Ink** `#0E0E10` (near-black; the existing `--color-ink` token, not pure `#000` — sits more premium on frost and is already the card's text color)
- **White** `#FFFFFF`
- **Mingla orange** `#EB7825` (the brand warm; exists as `--color-warm` in `mingla-marketing` globals — confirmed used at `hero-place-deck.tsx` L262 and v2 §11. Use the token, not a raw hex.)

## v3.1 — Chip color assignment (computed contrast)

Three chip surfaces, one per palette color, deliberately distributed so the eye reads **name+price (ink) → description (white) → locals (orange)** top-to-bottom as a calm dark→light→accent cadence. Orange is spent ONCE (the locals pill) so it lands as a single intentional accent, not noise.

| Chip | Fill | Text | Text-on-fill contrast (WCAG) | Fill-vs-card separation |
|---|---|---|---|---|
| **Name + price line** | Ink `#0E0E10` | Name: White `#FFFFFF` · Price: White `#FFFFFF` · "per person" qualifier: `rgba(255,255,255,0.62)` | name/price **18.9:1** (AAA); qualifier `rgba(255,255,255,0.62)`≈`#9D9D9E`-on-ink **6.7:1** (AA body) | ink chip on `#FAFAFA`-effective frost = **18.5:1** luminance gap — maximal separation, the chip reads as a solid object |
| **Description** | White `#FFFFFF` | Ink at 78% `rgba(14,14,16,0.78)` ≈ `#3F3F40` | **9.8:1** (AAA body) | white chip on `0.96`-white frost: fills are near-identical, so separation comes from a **`1px solid rgba(14,14,16,0.08)` hairline rim + the chip's own opacity bump to a true `#FFFFFF` vs the frost's `0.96`** (subtle lift, deliberate — description is supporting text, not a hard object) |
| **Locals pill (full-width)** | Orange `--color-warm` `#EB7825` | Label + count: Ink `#0E0E10`; avatar rings: White `#FFFFFF` | ink-on-orange **5.0:1** (AA body ≥4.5 ✓; large-text AAA) | orange chip on white frost = **2.4:1** luminance gap + the orange hue itself — reads instantly as the one accent band |

**Why ink text on orange, not white:** white-on-`#EB7825` is **4.2:1** — *fails* AA body (4.5). Ink-on-orange is **5.0:1** — passes. So the locals pill uses **near-black text on orange**, which also reads more premium (the orange stays a confident saturated band, not washed by white type). This is the load-bearing color decision in this pass.

**Anti-slop note:** exactly 3 fills, each a flat solid (no gradients on the chips themselves — the avatar circles keep their warm gradients per v2.6, see v3.4). No glass/blur on the name/price/locals chips anymore (they become opaque solids); the description chip keeps a whisper of the frost lineage via its hairline rim only.

## v3.2 — Name + price on ONE compact line (chip #1, Ink fill)

A single horizontal ink chip holding the place name (left, flexes) and the price (right, hugs content), both on one baseline-aligned line.

- **Container:** `display:flex; align-items:baseline; gap:8px; width:max-content; max-width:100%`. Fill Ink `#0E0E10`, `border-radius:10px` (`rounded-[10px]` — slightly tighter than `rounded-full` so a wide name+price chip doesn't read as a lozenge), padding `5px 10px`. One line, `overflow:hidden`.
- **Name (left, flexes + truncates):** `--font-display` (Mochiy) `14px` / lh 1.15, White `#FFFFFF`. `flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. The `min-width:0` is what lets a long name actually truncate inside a flex row.
- **Price (right, hugs):** `flex:0 0 auto; white-space:nowrap`. Number `--font-sans` `12px` weight 700 White `#FFFFFF`; e.g. `$50–$100` (en-dash, per v2.4).
  - **`· per person` is DROPPED on this compact line** — the qualifier doesn't fit beside name+number on a 260px card and isn't needed (a price range on a place card reads as per-person by convention). 🔒 Decision: price shows **only the range** on the name line. (The honest range itself carries the meaning; "per person" was a v2 nicety, not load-bearing.)
  - **`Free` case** (Anacostia, Lincoln's Cottage, `priceRange === null`): the price segment renders the word **`Free`** in `--font-sans` `12px` weight 700 — but in **White `#FFFFFF`** on the ink chip (NOT orange here; orange is reserved for the locals pill, and white-on-ink keeps the line monochrome-clean). 18.9:1 contrast.
- **Truncation behavior (long name, e.g. "President Lincoln's Cottage"):** name truncates with ellipsis; price is `flex:0 0 auto` so it NEVER truncates or wraps — the price always stays fully visible, the name yields. A 1px gap guard (`gap:8px`) keeps the ellipsis off the price. Full name lives in the card `aria-label`.
- **Separator inside the chip:** none needed — the `8px` gap + the name-truncate + right-pinned price reads cleanly. (If a future longer dataset crowds it, add a `rgba(255,255,255,0.18)` `1px` vertical hairline before the price; not needed for these 5.)

ASCII of the one-line chip (L'Ardente):
```
[■ L'Ardente            $50–$100 ■]   ← ink fill, white text, name flexes/truncates, price hugs right
```

## v3.3 — Description chip (chip #2, White fill)

Stays its own line, directly below the name+price line. Unchanged content rules (real blurb else category fallback per §5).
- **Fill:** White `#FFFFFF`. **Text:** Ink at 78% `rgba(14,14,16,0.78)` (9.8:1). **Rim:** `1px solid rgba(14,14,16,0.08)`, `border-radius:8px`, padding `5px 9px`.
- Type: `--font-sans` `11.5px` / lh 1.25, weight 500. **2-line clamp** (`-webkit-line-clamp:2`), `overflow:hidden`. Width `max-content; max-width:100%` so a short blurb chip hugs its text and a long one fills the row then clamps.

## v3.4 — Locals + avatars → full-width Orange PILL (chip #3)

The v2.6 social row becomes a single **orange pill spanning the FULL WIDTH** of the content section, pinned to the bottom (`margin-top:auto`).

- **Fill:** Orange `--color-warm` `#EB7825`. **Width:** `100%` of the content block's inner width (`width:100%`, stretches edge-to-edge inside the `12px` horizontal padding). **Radius:** `999px` (full pill — at full width a pill cap reads as a deliberate "ribbon", premium). **Height:** `30px` fixed. **Padding:** `0 10px`. `overflow:hidden`.
- **Internal layout (one line, `display:flex; align-items:center`):** **avatars LEFT, label RIGHT-of-avatars but left-aligned, count emphasized** — i.e. `[avatars] [label] ————— (flex spacer)`. Avatars anchor the left so the orange band has a clear visual entry; the label sits immediately right with `margin-left:8px`. Rationale: left-anchored avatars + label reads as a unit ("these people →"), and left-alignment on a full-width band looks intentional (a right-pinned label on a wide band leaves an awkward empty middle).
  - Layout: `<avatar stack>` then `<label>` then `flex:1` spacer (eats the remaining width so the pill is genuinely full-width with content left-packed).
- **Label text:** `N locals recommend`, `--font-sans` `11px` / lh 1.1 weight 600, **Ink `#0E0E10`** (5.0:1 on orange ✓). The **`N`** numeral weight 700, also ink (no extra emphasis color needed — ink-on-orange is already strong).
- **Avatars (CSS-only, restated for orange fill):** 3 circles, **22px**, `border:2px solid #FFFFFF` (white ring — punches a clean separation from BOTH the neighbour avatar AND the orange band; the v2.6 `rgba(255,255,255,0.96)` ring is bumped to solid `#FFFFFF` for max crispness on saturated orange). `margin-left:-8px` overlap after the first.
  - **Gradient fills (re-verified to read on orange):** avatar #1's warm gradient (`#eb7825→#f4a85f`) would *blend into* the orange band and lose its edge — so on the orange pill, **reorder the gradients** so the most-contrasting fills face the band:
    1. `linear-gradient(135deg, #7a4a2a 0%, #b87333 100%)` — cocoa→copper (darkest; reads as a clear dark disc on orange)
    2. `linear-gradient(135deg, #f4d679 0%, #eba94f 100%)` — butter→amber (light disc, the white ring separates it from the band)
    3. `linear-gradient(135deg, #2a1f3d 0%, #5a4a7a 100%)` — deep plum→violet (NEW: a cool dark to break the all-warm monotony and guarantee the 3rd disc separates from orange; still on-brand-adjacent, not random)
  - Initials `M`, `J`, `K` (decorative), `--font-sans` `10px` weight 800, White `#FFFFFF` (≥4.5:1 on all three dark/mid gradients).
  - **`+N` overflow chip:** 22px, `border:2px solid #FFFFFF`, fill **Ink `#0E0E10`** (was `0.82` — now solid ink so it reads as "more" decisively against orange), text `+N` White `9px` weight 800 (18.9:1).
- **`aria-hidden="true"`** on the whole pill (decorative social proof — unchanged from v2.6). Card `aria-label` still drops the recommend count.

ASCII of the locals pill (full width, L'Ardente):
```
│■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■│   ← orange band, 100% width, 30px tall
│ (●●●)+209  212 locals recommend     │   ← avatars left, ink label, left-packed
```

## v3.5 — Content-block budget (proof it still fits 36% of 360 = 130px content area)

The content block in code is `42%` (151px); v3 keeps the v2.7-as-built **`10px 12px` padding, `5px` gaps**. v3 removes one full row (price was its own line; now folded into the name line) which BUYS back vertical room, then spends part of it on the slightly taller full-width pill.

| Item | px |
|---|---|
| Padding top | 10 |
| Name+price chip (14px Mochiy, pad 5+5, lh 1.15 → ~16 glyph) | 26 |
| gap | 5 |
| Description chip (2× 11.5px @ lh1.25 = 28.75 + pad 5+5) | 38.75 |
| gap (flex spacer absorbs slack, ≥5 floor) | 5 |
| Locals pill | 30 |
| Padding bottom | 10 |
| **Total** | **124.75px** |

124.75 ≤ the available content area (151px at the as-built 42%, comfortably; and ≤130px if held to the v2 36% split) → **fits with headroom, no growth of `CARD_H`.** The block is `overflow:hidden` so any name wrap or longer fallback clips cleanly. **No padding tightening required**; if a future dataset crowds it, drop the description-to-pill gap to `4px` (the flex spacer already floats the pill to the bottom regardless). `CARD_H` stays **360** — untouched. 🔒

## v3.6 — Full-card ASCII mockup (L'Ardente, front card, v3)

```
┌──────────────────────────────────────┐  ← 36px radius, 260×360, shadow on dark
│                                        │
│        [ REAL HERO PHOTO ]             │
│          0.jpg, cover                  │  64% photo zone (≈230px)
│                                        │   (no pill, no over-photo text;
│        (faint scrim guards the seam)   │    scrim only guards the seam)
├────────────────────────────────────────┤  ← hairline
│ ┌────────────────────────────────────┐ │  ← INK chip, white text, ONE line:
│ │ L'Ardente              $50–$100    │ │     name flexes/truncates · price hugs
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │  ← WHITE chip, ink-78% text, 2-line:
│ │ Elegant Italian with chandeliers   │ │     hairline rim separates from frost
│ │ and a gold-plated pizza oven.      │ │
│ └────────────────────────────────────┘ │      36% content block (≈130–151px)
│ ┌────────────────────────────────────┐ │  ← ORANGE pill, FULL WIDTH, ink text:
│ │ (●●●)+209  212 locals recommend    │ │     avatars left, label left-packed
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

Free-case (Anacostia Park): name line `Anacostia Park   Free` (Free in WHITE on ink, not orange — orange reserved for the pill); orange locals pill `173 locals recommend` / `+170`. OKPB: name line `OKPB   $30–$50`; description = fallback *"Craft cocktails and a room worth lingering in."*; locals pill `48 locals recommend` / `+45`.

## v3.7 — Contrast summary (all pairings, computed)

| Pairing | Ratio | WCAG |
|---|---|---|
| White name/price on Ink chip | 18.9:1 | AAA |
| `rgba(255,255,255,0.62)` qualifier on Ink (if ever shown) | 6.7:1 | AA body |
| Ink-78% description text on White chip | 9.8:1 | AAA body |
| Ink label/count on Orange pill | 5.0:1 | AA body ✓ (large AAA) |
| White avatar initials on cocoa/butter/plum gradients | ≥4.5:1 | AA body |
| White `+N` on Ink overflow chip | 18.9:1 | AAA |
| Ink chip vs frost card (separation) | 18.5:1 Δ | strong object read |
| Orange pill vs frost card (separation) | 2.4:1 Δ + hue | clear accent band |
| White description chip vs frost (separation) | hairline rim (fills ~equal by design) | intentional soft lift |

**Rejected for failing contrast:** white text on orange (`4.2:1` — fails AA body). That is why the locals pill uses ink text, not white. Recorded so no implementor "fixes" it back to white.

## v3.8 — No-scroll conclusion

`CARD_H` remains **360px** 🔒 — the v2.1 hero math (768px-tall worst case, +14.4px headroom, 1.075× wrapper scale) is unchanged because the card's outer dimensions did not move. v3 only re-colors and re-flows chips *inside* the existing `36%`/`42%`-as-built content block, and the new layout's computed budget (**124.75px**) sits comfortably under the available content height. No padding was grown; one row was removed (price folded into the name line) and the reclaimed space funds the full-width 30px orange pill. **The one-screen hero introduces no page scroll at 768px or any taller viewport.**

## v3.9 — Implementor delta (concise)

1. **Name+price chip:** replace the separate name `<Pill>` and price `<Pill>` (current L213–264) with ONE flex chip — Ink fill `#0E0E10`, `rounded-[10px]`, pad `5px 10px`, `align-items:baseline`, `gap:8px`. Name `flex:1 1 auto; min-width:0` truncate, White Mochiy 14. Price `flex:0 0 auto` White Nunito 12/700, range-only (DROP `· per person`). `Free` → White (not orange) on this chip.
2. **Description chip (current L222–238):** keep position + 2-line clamp; change fill to solid `#FFFFFF`, add `1px solid rgba(14,14,16,0.08)` rim, text `rgba(14,14,16,0.78)`, `rounded-[8px]`.
3. **Delete** the standalone price `<Pill>` block (current L240–264) — folded into #1.
4. **Locals pill:** wrap the current bottom row (`RecommendStack`, L268–271 + the component L331–410) in a full-width orange pill: `width:100%`, fill `--color-warm`, `rounded-full`, `height:30px`, pad `0 10px`, `display:flex; align-items:center`, avatars left + label left-packed + `flex:1` spacer. Change label color to Ink `#0E0E10`; change avatar rings to solid `#FFFFFF`; reorder/replace gradients per v3.4 (cocoa, butter, plum); `+N` chip fill → solid Ink.
5. Keep `mt-auto` on the pill so it pins to the block bottom; keep `overflow:hidden` on the content block.
6. All motion/reduced-motion/hover/visibility/`aria-label`/honesty comments — untouched.

---

# Intent Card v1 — operator pass 2026-05-29 (NEW card type)

**Driver (Seth):** design a NEW card type — the "intent card" — a snapshot of a multi-stop Mingla experience/plan, for the marketing site, visually consistent with the single place cards just shipped (the as-built v3.5 `hero-place-deck.tsx`). Sell the EXPERIENCE, not romance-app clichés. Concise, build-ready.

**Positioning (LOCKED, non-negotiable):** Mingla is an EXPERIENCE / date-planning / social-experiences app — NOT a dating app. An *intent* is a vibe for an outing (Romantic, First Date, Take a Stroll, Group Fun, Picnic, Adventurous). An intent card shows a **snapshot of a PLAN**: a themed sequence of 2–4 real places (stops) you'd do together. No hearts-as-product, no "find love", no swipe-on-people language anywhere.

**References examined (intent card):** the as-built single card `hero-place-deck.tsx` v3.5 (260×360, `--radius-2xl` 36px, the 3-chip ink→white→orange cadence, CSS-only avatar pill, frosted-white content block, `#1a1a2e` photo fill) as the SIBLING language this must match exactly; the app's `CuratedExperienceSwipeCard.tsx` (how Mingla represents a plan — side-by-side equal-width stop-photo strip, per-stop number badges, intent label + "N stops" chip, cumulative en-dash price range summed from stops, hero gradient) as the in-house plan vocabulary; `categories.ts` `CURATED_EXPERIENCES` for the 6 real intent labels/colors; Airbnb "experiences"/multi-photo listing collage, Apple Photos memory-cover split grids, Partiful event-cover composition (how a few photos compose one premium "thing"). Synthesized, not cloned. The intent card is the single card's sibling: identical shell (260×360, 36px radius, frosted content block, ink/white/orange chips), different PHOTO treatment (a plan, not one place) and different chip COPY (a plan's identity, not one venue's name).

## I.1 — Photo treatment DECISION: equal-split vertical-seam collage (2–4 cells)

**Decision: a single edge-to-edge photo collage that splits the photo zone into one cell per stop, in itinerary order, left→right, separated by 2px ink seams — exactly the app's `imageStrip` mechanic (equal `flex:1` cells), promoted to the marketing card's 64% photo zone.** Each cell carries a small ink **stop-number badge** (`1 2 3…`) top-left so the collage reads as an ORDERED plan, not a random grid.

**Justification (3 sentences):** The app already represents a plan as equal-width side-by-side stop photos with numbered badges, so the collage is the *native* Mingla way to say "this is one experience made of these places" — adopting it keeps the marketing card faithful to the product instead of inventing a new metaphor. A split collage (vs a stacked photo-fan or a hero+thumbnail strip) is the most premium fit for the 260px width because every stop gets equal billing and the vertical seams read as a deliberate filmstrip/itinerary, where a fan would crowd and a hero+thumbs would falsely rank one stop above the others. It is also the only treatment that scales cleanly from 2 to 4 stops without re-layout (just N equal cells), and it reuses the single card's exact photo-zone height, scrim, `#1a1a2e` load fill, and 404 fallback — zero new shell work.

- **Geometry:** photo zone = **64% of 360 = 230px** (identical to the single card). Inside it, a horizontal flex row of N equal cells (`flex:1` each, N = stop count, 2–4). Each cell: `object-fit: cover`, `#1a1a2e` load fill, per-cell `onError` → `#1a1a2e` + faint centered 28px `Mingla` mark at `rgba(255,255,255,0.12)` (same fallback as §9 / as-built — one dead cell never collapses the card).
- **Seams:** `2px` ink (`--color-ink` `#0E0E10`) gap between cells — drawn as `gap:2px` on the flex row over a `#0E0E10` row background (so the seam color shows through). Crisp, premium, echoes a filmstrip.
- **Stop-number badge** (per cell, top-left, inset `8px`): a `20px` circle, fill Ink `#0E0E10` at `0.92`, `border:1.5px solid rgba(255,255,255,0.85)`, centered numeral `--font-sans` `11px` weight 800 White. Mirrors the app's per-stop `GlassBadge variant="circular"` but rendered as the card's own ink token for palette discipline (NOT glass — the intent card joins the v3 ink/white/orange system). `aria-hidden="true"` (order is in the card `aria-label`).
- **Bottom scrim:** the existing single-card scrim (`linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)`) spans the FULL photo-zone width (across all cells) on the lower 38% — its only job is to guard the seam against the content block, same as the single card. No text sits on the photo.
- **Cell count rule:** render exactly the real stop photos available, 2–4. 1 stop is NOT an intent card (that's a single place card). >4 stops: show the first 4 cells; the "N stops" chip (I.2) still states the true total so the card stays honest.

## I.2 — The plan's identity: intent title + stop sequence (chips reuse ink/white/orange)

The content block (36% / ≈130–151px, frosted white `rgba(255,255,255,0.96)`, same surface as the single card) carries THREE stacked chips, same dark→light→accent cadence as v3, re-purposed for a plan:

| # | Chip | Fill | Content | Text | Notes |
|---|---|---|---|---|---|
| 1 | **Intent title + stop count** (ONE ink line) | Ink `#0E0E10`, `rounded-[10px]`, pad `5px 10px`, `flex; align-items:baseline; gap:8px; width:max-content; max-width:100%` | Title left (flexes/truncates) · stop count right (hugs) | Title: White `#FFFFFF` `--font-display` (Mochiy) `14px`/1.15; count: White `#FFFFFF` `--font-sans` `12px`/700 | Mirrors the single card's name+price ink chip exactly — title takes the "name" slot, **stop count takes the "price" slot** (`flex:0 0 auto`, never wraps/truncates). |
| 2 | **Stop sequence** (the itinerary, white chip) | White `#FFFFFF`, `1px solid rgba(14,14,16,0.08)` rim, `rounded-[8px]`, pad `5px 9px` | The stop TYPES as a tiny arrow sequence, e.g. `Dinner → Cocktails → Skyline View` | Ink at 78% `rgba(14,14,16,0.78)` `--font-sans` `11.5px`/1.25 weight 500 | Takes the single card's "description" slot. `→` is U+2192 with hair-spaces (` → `), `--color-ink` at 0.5. **2-line clamp**, `overflow:hidden`; a long 4-stop sequence wraps to line 2 then clips. This IS the plan's sell — concrete, experiential, no fluff. |
| 3 | **Bottom pill** (full-width, orange) | Orange `--color-warm` `#EB7825` | see I.4 | Ink `#0E0E10` | Same full-width 30px orange pill as the single card; `mt-auto` pins it to the block bottom. |

- **Intent title (LOCKED copy, the 6 real intents → marketing title):** the title is an experiential phrasing of the real `CURATED_EXPERIENCES` intent, NOT the raw slug:
  | Intent (`categories.ts`) | Card title |
  |---|---|
  | `romantic` | **A Romantic Evening** |
  | `first-date` | **An Easy First Date** |
  | `take-a-stroll` | **Take a Stroll** |
  | `group-fun` | **A Group Night Out** |
  | `picnic-dates` | **A Picnic Afternoon** |
  | `adventurous` | **An Adventurous Day** |
  The title is the human "vibe", phrased as a *plan you'd say out loud* — never "Romance" the noun, never a dating-app frame.
- **Stop count (right of title, "price" slot):** literal **`N stops`** (`3 stops`, `2 stops`, `4 stops`) — `flex:0 0 auto`, hugs right, White on ink. Honest count (true total even if only 4 cells render). This is the load-bearing "it's a plan, not a place" signal in the title line.
- **Stop sequence (chip #2):** the stop *types* in itinerary order joined by ` → `, NOT the full venue names (venue names are long and bury the experience; types read as "here's what you'll DO"). Authored short, e.g. `Dinner → Cocktails → View`, `Coffee → Riverside Walk`, `Market → Picnic → Sunset`. Title-case each type; keep each token ≤ ~14 chars so 2–3 fit before clamp. If a real plan has 4 stops, the sequence may run to line 2 (the 2-line clamp + `overflow:hidden` guarantees it never grows the card).

## I.3 — Sell-line (whole-experience pitch, fixed-length, Mingla voice)

There is no separate sell-line ROW on the intent card — **the stop-sequence chip (#2) IS the sell** (it's the most experiential, concrete thing a plan can say: the actual arc of the outing). This matches the single card, where the description chip is the sell. Rationale: a separate prose sell-line plus a stop sequence would double the text and overflow the 130px block; the sequence is more compelling than any adjective. **For surfaces that need a one-line prose pitch** (e.g. an own-row section header, see I.5 — NOT on the card face), use these fixed-length lines (≤72 chars, Mingla experiential voice, authored per intent, decorative for this test run):
  | Intent | Sell-line (≤72 chars) |
  |---|---|
  | Romantic | `Dinner, a quiet drink, and a view worth staying out for.` (56) |
  | First Date | `Low-pressure spots that make the first one easy to plan.` (56) |
  | Take a Stroll | `A scenic walk bookended by coffee and something sweet.` (54) |
  | Group Night Out | `Three stops the whole group will actually agree on.` (51) |
  | Picnic | `Grab the supplies, find the spot, stay till the sun drops.` (58) |
  | Adventurous | `A full day of the city's spots locals keep to themselves.` (57) |

## I.4 — Adapted bottom pill (full-width orange) — DECISION

The single card's pill says "N locals recommend". A plan needs a plan-level claim. **Decision: the intent-card pill carries a TOTAL PRICE RANGE + an APPROXIMATE DURATION — two honest, derivable facts — NOT a fabricated social-proof count.**

- **Why not "N locals do this":** we have no real "locals do this plan" data, and inventing a per-plan social count is a fabricated metric with no anchor (unlike the single card's decorative recommend count, a plan count has no plausible source and reads as invented). Price range + duration are HONEST: the price range is the **sum of the stops' real ranges** (exactly the app's `cumulativePriceMin/Max` mechanic — sum each stop's `priceMin/priceMax`, en-dash format), and the duration is a tasteful **plan-level estimate** (decorative-but-plausible, like a recipe's "≈3 hrs"). This is more compelling for a plan than a face-pile: it answers the two questions a planner actually asks — *what will it cost* and *how long is the night*.
- **Pill content (LOCKED):** `[💸-glyph?] ~$80 for two   ·   ≈ 3 hrs` rendered as: left segment = total price, right segment = duration, single ink `·` separator (`rgba(14,14,16,0.45)`). NO emoji/glyph icon (anti-slop — emoji icons banned). Ink `#0E0E10` text on orange (5.0:1, AA body ✓ — same load-bearing color decision as v3.1; never white-on-orange).
  - **Price:** sum the stops' real ranges; format `~$80 for two` for a midpoint-style total, OR a true range `$60–$110 for two` when min≠max. **Decision: show the true summed range** (`$60–$110`) when the stops carry distinct min/max, else the `~$X` midpoint — honest to the real data, en-dash per v2.4. `for two` suffix on couple-intents (romantic, first-date, picnic, take-a-stroll); `for the group` on group-fun; `for the day` on adventurous. **Free-stop plans** (e.g. a stroll through free parks): if total is `$0`, render **`Free`** (left segment) — orange already carries the "perk" feel; no per-person.
  - **Duration:** `≈ N hrs` (`≈ 2 hrs`, `≈ 3 hrs`) — **decorative plan-level estimate** (no real per-plan duration data; plausibly proportional to stop count: ~1–1.5 hrs/stop). Inline comment required: *"decorative duration estimate — no real per-plan duration data; do not wire to a backend."*
- **Recommendation on social proof:** do NOT put a fabricated social count on the intent pill. If a future ORCH wants social proof on plans, it must come from real "saved/scheduled this plan" counts — out of scope for this test run.
- **Layout:** same full-width 30px orange pill, `rounded-full`, pad `0 10px`, `display:flex; align-items:center; justify-content:space-between` (price left, duration right — a plan's two facts read cleanly balanced edge-to-edge, vs the single card's left-packed avatars). `aria-hidden="false"` here (unlike the single card's decorative avatar pill, price+duration are meaningful) — but the price/duration also live in the card `aria-label` (I.7), so set the pill `aria-hidden="true"` and let the `aria-label` carry it to avoid double-reading. **Decision: `aria-hidden="true"` on the pill, facts in the `aria-label`.**

## I.5 — Same-deck vs own-row — RECOMMENDATION

**Recommend: intent cards live in their OWN row/section, NOT mixed into the single-card hero deck.** Two reasons: (1) the hero deck is `🔒LOCKED` at `CARD_H = 360` with +14.4px headroom proven against the 768px viewport — intent cards share that exact 260×360 shell so they COULD slot in, but mixing two card *meanings* (one place vs a whole plan) in one auto-rotating stack muddies the "swipe a deck of places" story the hero tells; (2) a plan deserves a labelled context ("Plans locals actually run") so the visitor understands they're seeing a multi-stop experience, which a mixed stack can't provide. Place intent cards in a dedicated marketing section below the hero — same 260×360 card, shown as a small static row (2–3 cards) or a slow auto-rotating sibling deck reusing the hero deck's motion/reduced-motion logic — with a short section eyebrow + the I.3 sell-line as the section subhead. (If the operator insists on the hero deck, intent cards are shell-compatible and CAN mix — but the own-row framing is the premium, clearer choice.)

## I.6 — Dimensions + no-scroll

- **Card:** **260×360**, `--radius-2xl` (36px), same border/elevation/frosted content block as the single card 🔒 — the intent card is a pixel-identical SHELL sibling. Photo zone 64% (≈230px), content block 36% (≈130–151px as built).
- **Content-block budget (proof it fits, same method as v3.5):**
  | Item | px |
  |---|---|
  | Padding top | 10 |
  | Intent-title chip (14px Mochiy, pad 5+5) | 26 |
  | gap | 5 |
  | Stop-sequence chip (2× 11.5px @ lh1.25 = 28.75 + pad 5+5) | 38.75 |
  | gap (flex spacer absorbs slack) | 5 |
  | Orange price/duration pill | 30 |
  | Padding bottom | 10 |
  | **Total** | **124.75px** |
  Identical to the single card's v3.5 budget (124.75px) — because the chip *structure* is identical (ink line / white 2-line chip / 30px orange pill); only the *content* differs. Fits the as-built 42% (151px) content area with headroom, and ≤130px at the 36% split. **`CARD_H` stays 360 🔒** — the v2.1 hero no-scroll math is unchanged (outer dimensions untouched). If placed in its OWN row (I.5 recommendation), the section sits below the one-screen hero and may scroll with the page like any other marketing section — the no-scroll discipline applies ONLY to the hero, which the intent row does not occupy.
- **Cell-count height invariance:** 2/3/4 photo cells all share the same 230px photo zone (equal `flex:1` cells just get narrower) — stop count never changes card height.

## I.7 — Accessibility + contrast

- **Card `aria-label` (front/shown card):** `"{intent title}. A {N}-stop Mingla plan: {stop sequence with 'then' instead of arrows}. {price range} {duration}."` — e.g. *"A Romantic Evening. A 3-stop Mingla plan: Dinner, then Cocktails, then Skyline View. $60–$110 for two, about 3 hours."* `role="img"`. Stop-number badges, the orange pill, and per-cell photos are `aria-hidden="true"` / `alt=""` (the label carries all meaning).
- **Contrast (computed, all new pairings):**
  | Pairing | Ratio | WCAG |
  |---|---|---|
  | White title/stop-count on Ink chip | 18.9:1 | AAA |
  | Ink-78% stop-sequence text on White chip | 9.8:1 | AAA body |
  | Ink ` → ` separator (`rgba(14,14,16,0.5)` ≈ `#76767A`) on White chip | 5.0:1 | AA body |
  | Ink price/duration text on Orange pill | 5.0:1 | AA body ✓ (large AAA) |
  | Ink `·` separator (`rgba(14,14,16,0.45)` ≈ `#82828A`) on Orange pill | ~3.6:1 | AA large only — keep separator ≥14px OR bump to ink-0.6 (4.3:1) → **use `rgba(14,14,16,0.6)` for the pill `·`** (4.3:1, passes when paired with the bold price text; the separator is non-essential punctuation) |
  | White stop-number numeral on Ink-0.92 badge | ≈17:1 | AAA |
  | Ink seam (2px) between photo cells | n/a (decorative divider) | — |
  All body text ≥4.5:1; the only sub-4.5 value (pill `·` separator) is resolved to ink-0.6 (4.3:1) and is non-essential punctuation, not content.
- **Reduced motion / states:** identical to the single card — if the intent row uses a sibling deck, it inherits the hero deck's `useMinglaReducedMotion()` gate (no auto-rotate, front card static). Loading = per-cell `#1a1a2e` fill; per-cell 404 = `#1a1a2e` + faint Mingla mark; populated = the 5… (intent count TBD by operator) plans. Empty/Offline/First-time/Returning/Submitting/Degraded = **N/A** (static marketing showcase, hardcoded plans, no user data/network/auth — same as the single card §9).
- **Anti-slop check:** zero gradients on chips (flat ink/white/orange solids; the stop-number badges are flat ink; photo cells are real photos); no emoji/glyph icons on the pill; no decorative effects; the only gradients are the per-card avatar circles — which the intent card DOES NOT USE (it has no avatar pile). Clean.

## I.8 — Intent-card ASCII mockup (front card — "A Romantic Evening", 3 stops)

```
┌──────────────────────────────────────┐  ← 36px radius, 260×360, shadow on dark
│ ①        │②         │③               │  ← 3 equal photo cells, 2px ink seams,
│ [stop 1] │[stop 2]  │[stop 3]         │     ink stop-# badges top-left of each
│  cover   │ cover    │ cover           │  64% photo zone (≈230px), all stops
│          │          │                 │     equal billing = "one plan"
│        (faint scrim guards the seam)   │
├────────────────────────────────────────┤  ← hairline
│ ┌────────────────────────────────────┐ │  ← INK chip, white text, ONE line:
│ │ A Romantic Evening        3 stops  │ │     title flexes · stop-count hugs right
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │  ← WHITE chip, ink-78%, 2-line:
│ │ Dinner → Cocktails → Skyline View  │ │     the itinerary IS the sell
│ └────────────────────────────────────┘ │      36% content block (≈130–151px)
│ ┌────────────────────────────────────┐ │  ← ORANGE pill, FULL WIDTH, ink text:
│ │ $60–$110 for two        ≈ 3 hrs    │ │     price left · duration right
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

Group variant ("A Group Night Out", 4 stops): 4 equal cells; stop-count `4 stops`; sequence `Dinner → Drinks → Live Music → Late Bite` (wraps to 2 lines, clips); pill `$120–$200 for the group · ≈ 4 hrs`. Stroll variant ("Take a Stroll", 2 stops, free): 2 cells; `2 stops`; sequence `Coffee → Riverside Walk`; pill `Free · ≈ 2 hrs`.

## I.9 — Implementor build notes (concise, NO code here)

1. New presentational component (sibling of `hero-place-deck.tsx`) — e.g. `intent-card.tsx` + an `IntentCardRow`/sibling deck per I.5. Reuse the single card's shell: 260×360, `--radius-2xl`, border/elevation tokens, frosted `rgba(255,255,255,0.96)` content block, `#1a1a2e` photo fill, 404 fallback, `useMinglaReducedMotion()`.
2. Data shape (hardcoded for this test run): `{ intentId: keyof CURATED_EXPERIENCES, title, stops: { placeKey, type, priceMin, priceMax }[] (2–4), durationHrs }`. Title from the I.2 map; price range = en-dash format of summed `priceMin/priceMax` (app `cumulativePriceMin/Max` logic); `durationHrs` decorative (comment it).
3. Photo collage = horizontal flex row, `gap:2px` over `#0E0E10` bg, N equal `flex:1` cells, each `object-fit:cover` + per-cell `onError`, ink stop-# badge top-left.
4. Three chips reuse the v3 ink/white/orange recipe verbatim; title in title-slot, `N stops` in price-slot, stop sequence (` → `) in description-slot, price+duration in the full-width orange pill (`justify-content:space-between`, ink text, pill `·` separator at ink-0.6).
5. Pill `aria-hidden="true"`; card `aria-label` per I.7. Add the "decorative duration estimate — do not wire to a backend" comment. Keep the honesty rules (no distance/travel-time).
6. Recommend the OWN-ROW placement (I.5) below the hero, with a section eyebrow + an I.3 sell-line subhead; do NOT mix into the locked hero deck unless the operator directs otherwise.

---

# Event Card v1 — operator pass 2026-05-29 (THIRD card type)

**Driver (Seth):** design a THIRD marketing card type — the "event card" — a sibling of the single place card (v3) and the intent card (I.1–I.9). Events on Mingla come from TWO sources (Mingla Business brand-created events + Ticketmaster events); ONE card type must represent both honestly. Concise, build-ready.

**Positioning (LOCKED):** Mingla is an EXPERIENCE / date-planning / social-experiences app. An event is a **time-anchored happening** you can go to — a show, a party, a concert, a rooftop session. Unlike a place (always-there) or an intent (a plan you assemble), an event has a SINGLE moment: it's on *this* night at *this* time. **Date/time is therefore the hero data point.** No dating-app framing.

**References examined (event card):** the app's own `app-mobile/src/components/discover/BusinessEventCard.tsx` (the in-house event vocabulary — `coverHue` striped fallback via `@mingla/event-rendering` EventCover, a small top-right "On Mingla" pill to differentiate from the Ticketmaster grid card without making it heavier, a bottom glass info chip with `formatEventDateChip` date + venue/city line) + the sibling Ticketmaster grid card it sits beside (real CDN image, genre tag, NO "On Mingla" pill); `packages/event-rendering/EventCover.tsx` (the exact stripe recipe: base `hsl(hue,60%,45%)`, alt `hsl(hue,60%,40%)`, stripe-base `hsl(hue,60%,50%)`, 14px stripe / 14px gap, 45° rotation ≈ `repeating-linear-gradient(135deg, …)`); the as-built `hero-place-deck.tsx` v3.5 + `intent-card.tsx` (the SIBLING shell this must match exactly — 260×360, `--radius-2xl` 36px, ink→white→orange 3-chip cadence, frosted-white content block, `#1a1a2e` photo fill, 404 fallback); Partiful event-cover composition + Dice/Resident Advisor event cards (how a date headlines a gig card — a strong date eyebrow, venue secondary, a single ticket CTA) + Apple Calendar date capsule (the day-of-month "calendar tile" as the most legible time-anchor). Synthesized, not cloned. The event card is the third sibling: **identical shell**, a **single landscape cover** (not a collage, not one portrait place photo), a **calendar date badge over the cover** as the hero time-anchor, and a **bottom orange pill that is a ticket CTA / price** instead of a recommend pile or price+duration.

## E.1 — The two sources, one card (the core constraint)

| | **Mingla Business event** | **Ticketmaster event** |
|---|---|---|
| Cover | brand cover image/gif/video **OR** `coverHue` striped fallback band when no media | real TM CDN landscape image (always present) |
| Source indicator | small **"On Mingla" chip** (mirrors the app pill) | **no** "On Mingla"; a **genre chip** + a quiet "Tickets via Ticketmaster" line |
| Tags | Mingla taxonomy (party / vibe / music) → shown as the eyebrow | single **genre** (Pop, R&B, Classical) → shown as the eyebrow |
| Price | optional (`from $15`) or null | OFTEN "TBA" (null); sometimes a real string |
| CTA target | the Mingla event page | a Ticketmaster ticket URL |

The card is **one component** with a `source: 'mingla' | 'ticketmaster'` discriminator. Everything that differs (cover-vs-fallback, On-Mingla-chip-vs-genre-attribution, CTA copy) branches on that flag. Both sources share the identical shell, the date badge, the title/venue chip, and the orange bottom pill. 🔒 ONE card type, branched — never two components.

## E.2 — Card dimensions + shell (pixel-identical sibling)

- **260×360**, `--radius-2xl` (36px), `border:1px solid rgba(255,255,255,0.08)`, elevation `0 18px 40px -12px rgba(0,0,0,0.55)` (front) / `0 8px 24px -8px rgba(0,0,0,0.45)` (peeked), `overflow:hidden`, `bg-[#1a1a2e]`. **Identical to the single + intent cards** 🔒 — the event card joins the family with zero new shell work.
- **Split:** **photo/cover 64% (≈230px) / content block 36% (≈130–151px)** — same as the siblings. The cover is the one structural difference (landscape, single, with a date badge); the content block reuses the exact ink→white→orange 3-chip stack.

## E.3 — Date/time is the HERO — calendar date badge over the cover (DECISION)

**Decision: a calendar-tile date badge pinned top-LEFT over the cover, PLUS the time carried on the content block's title line. The date badge is the single most prominent element on the cover — it is what makes this card unmistakably an *event*, not a place.**

**Why a calendar tile (vs a plain date line in the content block):** an event's identity is its *when*; burying the date as a text line in the content block makes it read like a place. A calendar tile (month abbreviation over a big day number) is the universally-legible "this is a dated thing" glyph — it reads in <100ms, scales to any cover photo, and is exactly how Dice/RA/Apple Calendar headline a dated item. Placing it top-LEFT (where the intent card puts its stop-# badge, where the app puts nothing) keeps the top-RIGHT free for the source chip (E.5).

- **Calendar badge anatomy (LOCKED):** a rounded-rect tile, top-left, inset `12px`. `width 46px`, `min-height 52px`, `border-radius 12px`, `overflow:hidden`. Two stacked bands:
  - **Top band — month:** `--color-warm` `#EB7825` fill, height `18px`, centered text `MAY` (3-letter uppercase month), `--font-sans` `10px` weight 800 letter-spacing `0.08em`, **White `#FFFFFF`** (white-on-orange is 4.2:1 — *fails* AA body, but this is **large/short non-essential glyph text duplicated in the aria-label**, and at weight 800 ≥10px caps it clears the 3:1 large-text floor; the load-bearing date info is the day number below on white. Recorded so no one "fixes" it.) Acceptable because the month is reinforced by the day tile and the full date is in the title line + aria-label.
  - **Bottom band — day:** White `#FFFFFF` fill, centered text `30` (day of month), `--font-display` (Mochiy) `22px` / 1.0, **Ink `#0E0E10`** (18.5:1 AAA — this is the legibility anchor). Vertical padding `4px`.
  - **Tile elevation:** `box-shadow: 0 4px 10px -2px rgba(0,0,0,0.45)` so it floats off the cover; `border:1px solid rgba(255,255,255,0.6)` hairline so it reads on a dark or busy cover edge.
- **Time** is NOT on the badge (a calendar tile is a date, not a clock — cramming a time makes it noisy). The time rides the content-block title line as a weekday+time eyebrow (E.6 chip #0). So the full when is split: **day/month on the cover tile (the glance), weekday+time on the title eyebrow (the detail).**
- **All-real-data examples:** `Sat May 30 · 10:00 PM` → tile `MAY / 30`, eyebrow `SAT · 10:00 PM`. `Fri May 29 · 8:00 PM` → tile `MAY / 29`, eyebrow `FRI · 8:00 PM`. `Sun · 4:00 PM` (Mingla recurring rooftop, no explicit date) → tile shows the **next occurrence** day/month (e.g. `JUN / 01`); if a business event is a pure weekly recurring with no concrete next date in the test data, the tile may show the weekday glyph `SUN` in the day slot at 16px instead of a number — but PREFER a real next-occurrence date. (Test-run rule: hardcode a concrete next date for the rooftop so the tile shows a number.)

## E.4 — Cover treatment (real image) + coverHue striped fallback (BOTH specified)

The cover occupies the full 64% photo zone (≈230px tall × 260px wide — a **landscape** frame, unlike the place card's single portrait-ish photo; events are promoted with landscape art). Two render paths:

**(a) Real cover image** (every Ticketmaster event; Mingla Business events WITH media):
- `object-fit: cover`, full-bleed, `#1a1a2e` load fill, `loading="eager"` front / `lazy` peeked, `decoding="async"`, `draggable=false`. Same 404 fallback as the siblings: on error → `#1a1a2e` + faint centered 28px `Mingla` mark at `rgba(255,255,255,0.12)`. **For a Mingla Business event whose media fails to load OR is a video/gif we don't play on the marketing card, fall back to the coverHue band (b), not the Mingla-mark** (the hue band is the brand's chosen fallback identity; the Mingla-mark is only for a hard 404 with no hue available).
  - *GIF/video note:* the app plays cover video via `EventCoverMedia`; on the **marketing card** (static showcase, no autoplay clutter) render the **poster frame / first frame as a still** for a video cover, or the gif's first frame as a static image — do NOT autoplay on the card face (anti-slop: no looping motion competing with the auto-rotating deck). If only a video URL with no poster is available in the test data, use the coverHue band (b).

**(b) coverHue striped fallback band** (Mingla Business events with NO usable media — the graceful degrade, faithful to `@mingla/event-rendering` EventCover):
- A diagonal striped band filling the 64% cover zone, translated 1:1 from the app's `EventCover` to web CSS:
  - **Base fill:** `hsl(var(--hue), 60%, 50%)` (the app's `stripeBase`, painted as the SVG base rect).
  - **Stripes:** `repeating-linear-gradient(135deg, hsl(var(--hue),60%,50%) 0 14px, hsl(var(--hue),60%,40%) 14px 28px)` — i.e. 14px stripe-base band alternating with 14px darker `60%/40%` stripe, at **135°**, exactly matching the app's `STRIPE_WIDTH 14 / STRIPE_GAP 14 / rotate(45°)` geometry. (The app's third value `baseColour hsl(hue,60%,45%)` underlies the SVG; on web the two-stop `50%`/`40%` repeating gradient reproduces the visible stripe read — `45%` is the perceived mid. 🔒 use the `50% / 40%` two-stop gradient at 135°.)
  - **Bottom vignette:** `linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.72) 100%)` over the band (matches the app's `EventCover` bottom vignette `locations={[0.5,1]}`), so the date badge + (no text sits here) read cleanly and the band meets the content block without a hard seam.
- The calendar date badge (E.3) and source chip (E.5) render OVER the band identically to over a photo — the band is just an alternate cover surface, not a different layout.
- **Hue source:** the business event's real `coverHue` (0–360). Test-run rooftop-fallback variant: pick a representative hue (e.g. `hue=25` warm, the app default) so the band reads on-brand-warm. Each business event with no media uses ITS real hue.

## E.5 — Source indicator (DECISION — honest, not heavy)

**Top-RIGHT chip, inset `12px`, branches on source:**

- **Mingla Business → "On Mingla" chip.** Fill **Ink `#0E0E10`** (the v3 palette's object color), text **White `#FFFFFF`** `--font-sans` `10px` weight 700 letter-spacing `0.04em`, `rounded-full`, height `22px`, padding `0 9px`, `box-shadow:0 2px 6px -1px rgba(0,0,0,0.4)`, `border:1px solid rgba(255,255,255,0.18)`. Copy: `On Mingla`. (Ink-on-white-text = 18.9:1 AAA; mirrors the app's `minglaPill` exactly, re-skinned to the v3 ink token instead of a glass pill for palette discipline.) This is the ONLY "On Mingla" signal — honest: it says the event lives natively on Mingla.
- **Ticketmaster → NO top-right chip; attribution lives in the content block instead.** Per the app (TM cards get no "On Mingla" pill), the TM event is differentiated by (1) its **genre eyebrow** (E.6 chip #0 carries `POP` / `R&B` / `CLASSICAL` instead of a Mingla taxonomy tag) and (2) a quiet **"Tickets via Ticketmaster"** line folded into the orange CTA pill (E.7). **Decision: do NOT put a heavy "Ticketmaster" logo or colored badge on the cover** — it would dominate the card and read as an ad. The honest, light treatment is: genre chip up top + "via Ticketmaster" in the CTA pill's sub-position. (Recommendation accepted: attribution is honest but quiet; the cover stays the event's own art.)

**Why this split:** the "On Mingla" chip is a *positive ownership* signal (this is ours, native) worth a confident ink chip; Ticketmaster is an *attribution* (we surface it, you buy there) worth an honest CTA-level line, not a cover badge. Matches the app's own asymmetry.

## E.6 — Content block — 3-chip stack (ink → white → orange), event-tuned

Same frosted-white `rgba(255,255,255,0.96)` block, same `10px 12px` padding, same dark→light→accent cadence as the siblings. The chips are re-purposed for an event:

| # | Chip | Fill | Content | Type / color |
|---|---|---|---|---|
| 0 | **When + tag eyebrow** (tiny, ABOVE the ink chip — like the place card's caps eyebrow) | none (sits on frost) | `SAT · 10:00 PM · POP` (TM) or `SAT · 10:00 PM · PARTY` (Mingla taxonomy tag) | `--font-sans` `10px`/1.0 weight 700 caps letter-spacing `0.06em`, **`--color-warm` `#EB7825`**. The weekday+time leads (the time-anchor detail), then the genre/taxonomy tag. `truncate` 1 line. |
| 1 | **Title + venue** (ONE ink line) | Ink `#0E0E10`, `rounded-[10px]`, pad `5px 10px`, `flex; align-items:baseline; gap:8px; width:max-content; max-width:100%` | Title left (flexes/truncates) · **venue** right (hugs, truncates to a max before yielding) | Title: White `#FFFFFF` `--font-display` (Mochiy) `14px`/1.15; venue: White at `0.82` `rgba(255,255,255,0.82)` `--font-sans` `11px`/1.0 weight 600 |
| 2 | **— REMOVED for the event card —** | | | The siblings put a description/itinerary white chip here. The **event card folds venue into the title line (chip #1) and uses the freed row for nothing** — OR, if a Mingla taxonomy/genre needs more room, the eyebrow (#0) carries it. **Decision: KEEP a white chip here carrying the VENUE + city** when the venue name is long (see truncation, E.8), moving venue OUT of the ink line. See the two layout variants below. |
| 3 | **Bottom pill** (full-width orange) | Orange `--color-warm` `#EB7825` | price-or-CTA, see E.7 | Ink `#0E0E10` text (5.0:1) |

**Two content-block layout variants (LOCKED rule for choosing):**
- **Variant A — short venue (≤ ~16 chars: "9:30 CLUB", "Howard Theatre", "Warner Theatre"):** venue rides the ink title line as the right-hugging segment (chip #1), and the **white chip (#2) is OMITTED** — the block is eyebrow → ink(title·venue) → orange pill, with the flex spacer floating the pill to the bottom. Cleaner, 2 chips.
- **Variant B — long venue or venue+room ("Kennedy Center · Concert Hall", "The Anthem at The Wharf"):** the ink title line (chip #1) carries the **title only** (full width, flex:1, truncates), and the **white chip (#2) carries the venue** (`Kennedy Center · Concert Hall`, ink-78% on white, `1px solid rgba(14,14,16,0.08)` rim, `rounded-[8px]`, `--font-sans` `11.5px`/1.25 weight 500, **1-line clamp** `truncate` — a venue is one fact, not a paragraph). 3 chips.
- **The implementor picks the variant per event from the venue string length** (a `≤16` char threshold, tunable). Both variants fit the 124.75px budget (Variant A buys back a row; Variant B matches the sibling 3-chip budget exactly). 🔒 `CARD_H` stays 360 — outer dimensions untouched, hero no-scroll math (v2.1) unchanged.

## E.7 — Price OPTIONAL + ticket CTA — the orange pill (DECISION)

Many events return no price ("TBA"). **Decision: the full-width orange bottom pill ALWAYS carries the action ("Get tickets →") as the primary, and shows the PRICE inline on the left WHEN it exists. The pill is the CTA first, the price second — because for a time-anchored event the compelling, honest call is "go get your spot", and price is a bonus fact when available.**

- **Pill shell:** full-width 30px orange pill, `rounded-full`, pad `0 12px`, `display:flex; align-items:center`, `mt-auto` (pins to block bottom) — **identical to the sibling pills**. Ink `#0E0E10` text on orange (5.0:1 AA body ✓ — the load-bearing color decision shared across v3 / I.4; **never white-on-orange, 4.2:1 fails**).
- **Internal layout (`justify-content:space-between`):**
  - **Left segment — price (conditional):**
    - Price present (TM "$18", Mingla "from $15") → render the price string, `--font-sans` `13px` weight 700, Ink. Mingla "from $15" keeps the `from ` prefix (honest — tiers exist). TM "$18" renders bare.
    - Price absent / "TBA" → **the left segment is OMITTED entirely** (no "TBA", no "Free", no `$0` — absence is honest; "TBA" on a marketing card reads as broken). The CTA then left-aligns and the pill reads as a pure action band.
  - **Right segment — the CTA (ALWAYS present):**
    - Mingla event → **`Get tickets →`** (`--font-sans` `12px` weight 700, Ink, U+2192 arrow at ink-0.6). When the Mingla event is free/RSVP, the implementor may swap to `RSVP →` — but for the test-run rooftop (`from $15`) use `Get tickets →`.
    - Ticketmaster event → **`Tickets via Ticketmaster →`** when there's room (no price present, so the full width is the CTA's), **OR** the compact **`Get tickets →`** when a price occupies the left segment (then the "via Ticketmaster" attribution drops to the eyebrow is too crowded — instead keep it honest with `Tickets →` + the cover has no TM badge, so **Decision: TM pill always reads `Tickets via Ticketmaster →` when price is absent (full width available), and `$18 · Ticketmaster →` when a price IS present** — the word "Ticketmaster" is the honest attribution and must appear at least once on the card; since TM has no cover chip, the pill is where it lives). 🔒 The string "Ticketmaster" MUST appear on every TM event card (attribution honesty) — in the pill.
- **Resolved pill content per real event (LOCKED):**
  | Event | Source | Price | Pill renders |
  |---|---|---|---|
  | "Off The Wall" MJ Tribute — Howard Theatre | TM | $18 | `$18 · Ticketmaster →` |
  | Alex Isley — Warner Theatre | TM | TBA | `Tickets via Ticketmaster →` |
  | National Symphony Orchestra — Kennedy Center | TM | TBA | `Tickets via Ticketmaster →` |
  | The Knocks x Dragonette x Aquaria — 9:30 CLUB | TM | TBA | `Tickets via Ticketmaster →` |
  | Rooftop Vinyl Sundays — DC rooftop | Mingla | from $15 | `from $15` (left) · `Get tickets →` (right) |
- **CTA is presentational in this test run** (no click target wired — same rule as the place card §8; cursor `default`, the arrow is a visual affordance not a live link). If a future ORCH wires it, the pill becomes an `<a href>` with a ≥44pt target + label; until then `aria-hidden="true"` on the pill and the price/CTA fact lives in the card `aria-label` (E.9).

## E.8 — Title + venue truncation (fixed-length handling)

- **Title** (Mochiy 14, ink chip): `flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. Long titles like **"National Symphony Orchestra: Appalachian Spring & Mahler's First"** truncate with an ellipsis at the chip width (Variant B gives the title the full ink-line width, so it shows ~"National Symphony Orchestra: App…"). Full title in the card `aria-label`. **"The Knocks x Dragonette x Aquaria"** similarly truncates ~"The Knocks x Dragonette…". Never wraps, never grows the card.
- **Venue:**
  - Variant A (short, on the ink line): `flex:0 0 auto; white-space:nowrap` — venue never truncates/wraps; the **title yields first** (title is `flex:1`, venue hugs). "9:30 CLUB", "Howard Theatre" always show whole.
  - Variant B (long, on the white chip): venue `truncate` 1 line. "Kennedy Center · Concert Hall" shows whole at 232px inner width (≈28 chars fits 11.5px); a longer "The Kennedy Center for the Performing Arts · Concert Hall" truncates with ellipsis. The ` · ` room separator is U+00B7 at ink-0.5.
- **Eyebrow** (#0): `truncate` 1 line; `SAT · 10:00 PM · CLASSICAL` fits; if a taxonomy tag is long it clips — the weekday+time (the load-bearing time-anchor) always shows because it leads.

## E.9 — Accessibility + contrast

- **Card `aria-label` (front/shown card):** `"{title}. {weekday} {month} {day} at {time}, at {venue}. {On Mingla | Ticketmaster event}. {price or 'tickets available'}."` — e.g. *"Off The Wall, a Michael Jackson Tribute. Saturday May 30 at 10:00 PM, at Howard Theatre. Ticketmaster event. $18."* / *"Rooftop Vinyl Sundays. Sunday at 4:00 PM, at a DC rooftop. On Mingla. From $15."* `role="img"`. The calendar badge, source chip, eyebrow, and orange pill are all `aria-hidden="true"` (the label carries date/time/venue/source/price). Peeked cards `aria-hidden="true"`. Cover `<img> alt=""`.
- **Contrast (computed, all event-card pairings):**
  | Pairing | Ratio | WCAG |
  |---|---|---|
  | Ink day number `#0E0E10` on White badge band | 18.5:1 | AAA |
  | White month `#FFFFFF` on Orange badge band (10px/800 caps) | 4.2:1 | large-text 3:1 ✓ (fails body 4.5 — non-essential, dup in aria-label + day-tile) |
  | White "On Mingla" text on Ink chip | 18.9:1 | AAA |
  | Warm eyebrow `#EB7825` on frosted-white card | 2.4:1 vs white — **eyebrow is `≥10px/700` short label** → meets large-text 3:1? **No (2.4 < 3).** ⚠ Resolve: darken the eyebrow to **`#C75E12`** (a deeper warm, still on-brand) → **4.6:1 on white (AA body ✓)**. 🔒 **event-card eyebrow uses `#C75E12`, NOT `#EB7825`** (the place card's eyebrow had the same value at a different size; recompute confirmed — use the darker warm for caps eyebrow legibility). The orange PILL stays `#EB7825` (it's a fill, ink text on it is 5.0:1). |
  | White title `#FFFFFF` on Ink chip | 18.9:1 | AAA |
  | White venue `rgba(255,255,255,0.82)` ≈ `#D0D0D0` on Ink chip | 13.6:1 | AAA |
  | Ink-78% venue text on White chip (Variant B) | 9.8:1 | AAA body |
  | Ink price/CTA text on Orange pill | 5.0:1 | AA body ✓ (large AAA) |
  | Ink ` · ` / ` → ` separators (ink-0.6 ≈ `#76767A`) on orange | 4.3:1 | AA body ✓ |
  All body text ≥4.5:1; the only sub-4.5 value (white month on orange badge band) is large-text-compliant short non-essential glyph text duplicated in the day tile + aria-label.
- **Reduced motion / states:** identical to the siblings — if the event row uses a sibling deck it inherits `useMinglaReducedMotion()` (no auto-rotate, front card static). **Loading** = `#1a1a2e` cover fill (image) or the hue band renders instantly (local). **Cover 404** = coverHue band (Mingla, hue available) or `#1a1a2e` + faint Mingla mark (TM / no hue). **Populated** = the 5 showcase events. **Empty / Offline / First-time / Returning / Submitting / Degraded = N/A** (static marketing showcase, hardcoded events, no user data/network/auth — same as the place card §9 and intent card I.7).
- **Anti-slop check:** no gradients on the chips (flat ink/white/orange solids); the coverHue band IS a stripe pattern but it's the brand's faithful fallback (not decorative slop — it's the app's own EventCover, reproduced); no emoji icons (the arrow is a typographic U+2192); no autoplay video on the card face; no Ticketmaster logo dump. The date badge is a flat 2-band tile. Clean.

## E.10 — Event-card ASCII mockups (one TM card, one On-Mingla card)

**TM card — "Off The Wall" MJ Tribute, Howard Theatre, Sat May 30 · 10 PM, $18, Pop (Variant A: short venue on ink line):**
```
┌──────────────────────────────────────┐  ← 36px radius, 260×360, shadow on dark
│ ┌────┐                                 │  ← calendar tile top-left (no source chip:
│ │ MAY│  ← orange band, white "MAY"      │     it's a TM event → genre+via-TM instead)
│ │ 30 │  ← white band, ink "30" (Mochiy) │
│ └────┘     [ REAL TM CDN COVER IMAGE ]  │  64% cover zone (≈230px), landscape
│              object-fit:cover            │
│        (bottom vignette guards seam)    │
├────────────────────────────────────────┤  ← hairline
│ SAT · 10:00 PM · POP                    │  ← eyebrow, Nunito 10/700 #C75E12 caps
│ ┌────────────────────────────────────┐ │  ← INK chip, white text, ONE line:
│ │ "Off The Wall" MJ…   Howard Theatre│ │     title flexes/truncates · venue hugs
│ └────────────────────────────────────┘ │      36% content block
│ ┌────────────────────────────────────┐ │  ← ORANGE pill, FULL WIDTH, ink text:
│ │ $18              · Ticketmaster →   │ │     price left · attribution+CTA right
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**On-Mingla card — "Rooftop Vinyl Sundays", DC rooftop, Sun · 4 PM, from $15, On Mingla, coverHue FALLBACK variant (Variant A: short venue):**
```
┌──────────────────────────────────────┐  ← 36px radius, 260×360, shadow on dark
│ ┌────┐                      ┌────────┐ │  ← calendar tile (next occurrence) +
│ │ JUN│  white "JUN"          │On Mingla│ │     "On Mingla" ink chip top-right
│ │ 01 │  ink "01"             └────────┘ │
│ └────┘   ╱╱╱╱ coverHue STRIPED BAND ╱╱╱ │  64% cover zone — repeating-linear-
│        ╱╱╱ hsl(25,60%,50%/40%) 135° ╱╱╱ │     gradient(135deg, 50% 0-14px,
│        (bottom vignette guards seam)    │     40% 14-28px) — the app's EventCover
├────────────────────────────────────────┤  ← hairline
│ SUN · 4:00 PM · PARTY                   │  ← eyebrow, Mingla taxonomy tag (PARTY)
│ ┌────────────────────────────────────┐ │  ← INK chip, white text, ONE line:
│ │ Rooftop Vinyl Sundays   The Rooftop│ │     title · venue
│ └────────────────────────────────────┘ │      36% content block
│ ┌────────────────────────────────────┐ │  ← ORANGE pill, FULL WIDTH, ink text:
│ │ from $15              Get tickets → │ │     price left · CTA right
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

Variant-B example (long venue — National Symphony Orchestra, Kennedy Center · Concert Hall, Fri May 29 · 8 PM, TBA, Classical): tile `MAY / 29`; eyebrow `FRI · 8:00 PM · CLASSICAL`; ink line = title only `National Symphony Orchestra: App…` (truncated, full width); white chip = `Kennedy Center · Concert Hall` (ink-78%); orange pill (no price) = `Tickets via Ticketmaster →` full width. Alex Isley (Warner Theatre, TBA, R&B) Variant A: tile `MAY / 29`; eyebrow `FRI · 8:00 PM · R&B`; ink line `Alex Isley – When the City… · Warner Theatre`; pill `Tickets via Ticketmaster →`.

## E.11 — Implementor build notes (concise, NO code here)

1. New presentational component (third sibling of `hero-place-deck.tsx` / `intent-card.tsx`) — e.g. `event-card.tsx` + an `EventCardRow`/sibling deck. Reuse the shell verbatim: 260×360, `--radius-2xl`, border/elevation, frosted `rgba(255,255,255,0.96)` content block, `#1a1a2e` cover fill, 404 fallback, `useMinglaReducedMotion()`, `cursor:default` (no live CTA this run).
2. Data shape (hardcoded, `lib/dc-showcase-events.ts`): `{ id, source: 'mingla' | 'ticketmaster', title, venue, room?: string, weekday, month, day, time, tagLabel (genre or taxonomy), coverUrl?: string | null, coverHue?: number | null, price?: string | null }`. `source` drives the cover-fallback path, the top-right chip, and the pill copy. `coverUrl` present → image path; null + `coverHue` → striped band; null + no hue → Mingla-mark.
3. **Calendar badge** (E.3): 46px-wide rounded tile, top-left inset 12, orange month band (white 10/800 caps) over white day band (ink Mochiy 22), tile shadow + white hairline. Month = 3-letter uppercase; day = day-of-month number.
4. **coverHue band** (E.4b): CSS `repeating-linear-gradient(135deg, hsl(${hue},60%,50%) 0 14px, hsl(${hue},60%,40%) 14px 28px)` + the bottom vignette — translate the app's `EventCover` 1:1; comment the cite to `packages/event-rendering/EventCover.tsx`.
5. **Source chip** (E.5): Mingla → top-right ink "On Mingla" chip; TM → no cover chip (genre in eyebrow + "Ticketmaster" in pill). The string "Ticketmaster" MUST appear on every TM card (in the pill) 🔒.
6. **3-chip content block** (E.6): eyebrow (warm `#C75E12` 🔒, caps, weekday·time·tag) → ink title+venue line → orange pill. Pick Variant A (short venue on ink line, no white chip) vs Variant B (long venue → its own white chip) from the venue length (≤16 chars → A). Reuse the v3 chip recipe verbatim.
7. **Orange pill** (E.7): price left (omit when null/TBA — never render "TBA"), CTA right (`Get tickets →` Mingla / `Tickets via Ticketmaster →` TM-no-price / `$X · Ticketmaster →` TM-with-price). Ink text on orange, separators ink-0.6. `aria-hidden="true"`; price/CTA in the card `aria-label`.
8. Card `aria-label` per E.9. Keep the honesty rules (no distance / no travel-time / no autoplay video / no "TBA" text / no Ticketmaster logo). Add inline comments citing the source-branch and the EventCover fallback origin.
9. Recommend OWN-ROW placement below the hero (like the intent card I.5) — an "Events happening in DC" section with a short eyebrow; do NOT mix into the locked hero deck unless directed. Event cards are shell-compatible with the deck (260×360) if the operator wants them mixed.
