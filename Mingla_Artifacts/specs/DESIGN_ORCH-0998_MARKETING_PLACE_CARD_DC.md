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
