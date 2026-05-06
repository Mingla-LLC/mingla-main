# SPEC — Mingla Web Explorer Hero · Truly Dynamic Layout

**Owner:** Orchestrator
**Surface:** `mingla-marketing/` (separate workstream from main Mingla program — does NOT live in Launch Readiness Tracker)
**Issue ID:** ORCH-WEB-001
**Date written:** 2026-05-04
**Status:** READY FOR IMPLEMENTOR DISPATCH

---

## 1. Problem statement (plain English)

The explorer hero looks great on the device it was last tuned on, then breaks on the next device the user tries. We've been chasing this for several iterations because the hero's responsive system is **half-fluid** — typography and gaps scale with viewport height via `clamp()`, but five structural things still use static or breakpoint-based logic:

1. Section side padding (`px-6 md:px-10`) — jumps at one breakpoint
2. Top/bottom spacers (`h-20` = 80px) — fixed regardless of viewport
3. Headline lines have no `whitespace-nowrap` guard — can wrap on narrow tall phones
4. Deck visual scale uses `vh` only — ignores width entirely
5. Deck layout box is fixed 340px — overflows section content area on narrow phones, gets clipped

Result: the hero can't simultaneously deliver "fixed top + fixed bottom + fixed sides + content fills middle" on every device. One viewport always loses.

---

## 2. Required behavior (locked acceptance criteria)

For every viewport between **320×568** (absolute floor) and **3840×2160** (4K desktop), without exception:

### 2.1 Header area (floating glass nav)

- ✅ Already true: header is `position: fixed top-4` and z-50; floats on top of section. Stays in view always.
- No changes needed to GlassNav.

### 2.2 Footer area (chip row)

- ✅ Already true: chips are `absolute bottom-6` inside a `100svh` section. Stays in view always.
- ❌ **Not yet true:** chips have only ~4px gutter from viewport edges (`max-w-[calc(100%-0.5rem)]`).
- **REQUIREMENT:** chips must sit inside a "footer area" with the **same fluid horizontal padding** as the section. Min 16px, max 40px each side, scaling with viewport width.

### 2.3 Hero content (headline · subhead · CTA · deck)

- Content occupies the **middle area** between fixed top spacer and fixed bottom spacer.
- Typography and deck **shrink and grow fluidly** with viewport — no breakpoint stairsteps.
- Headline lines (`Find a vibe,` and `not a venue.`) **never wrap** to a second line.
- Deck **never overflows** horizontally past the section's side padding.
- Deck **never overflows** vertically past the bottom spacer.

### 2.4 Fixed paddings (the contract)

| Padding | Value | Behavior |
|---|---|---|
| Top spacer (header bottom → content top) | 80px | static, all viewports |
| Bottom spacer (content bottom → chip top) | 80px | static, all viewports |
| Side padding (section + chip row) | `clamp(16px, 4vw, 40px)` | fluid: 16 on narrowest, 40 on widest |

Top/bottom spacers stay static at 80px because the floating header (56px from top) and chip row (~60px from bottom) are themselves static-sized. The 80px floor gives a consistent 20-24px breathing buffer that reads identically on every device. Static here = visual stability, not a problem.

### 2.5 "Bigger on bigger, compact on smaller, balanced in between"

Achieved via `clamp(min, fluid, max)` formulas using **`vmin`** (the smaller of vw or vh) so both axes participate. Headline goes from 30px on a tiny phone up to 64px on a 4K desktop, **smoothly**, with no breakpoint jumps. Same for subhead, gaps, and deck scale.

---

## 3. Five-truth-layer audit of the current hero (forensic findings)

Reading `mingla-marketing/components/sections/explorer-home/hero.tsx` and `hero-vibe-deck.tsx` as of commit `94c5ecc9`:

| Layer | What It Currently Says |
|---|---|
| **Docs (this spec / user requirements)** | Header + footer fixed, content shrinks dynamically, fixed paddings from header/footer/sides, fluid scale across all viewports |
| **Code** | Section uses `px-6 md:px-10` (breakpoint) for sides; spacers are `h-20` static; headline lines have no `whitespace-nowrap`; chip nav has `max-w-[calc(100%-0.5rem)]` (4px gutter only); deck scale uses `vh`-only clamp |
| **Runtime (computed)** | On 360px viewport: section content area = 312px, deck wrapper = 340px → 28px horizontal overflow per side, clipped by `overflow-hidden` |
| **Runtime (computed)** | On 1080px viewport with vh=1080: deck scale ~1.0 (target was 1.2 max) — vh formula too gentle on tall screens |
| **Runtime (computed)** | On 360×900 (tall narrow phone): headline `5.5vh` = 49.5px → "Find a vibe," at Mochiy ≈ 6.5×49.5 = 322px > 312px content area → wraps to 2 lines |

**Conclusion:** the system is internally inconsistent. Any viewport where width-and-height don't grow proportionally exposes the gap.

---

## 4. The fix — five concrete changes

### 4.1 Switch typography clamps from `vh` to `vmin`

`vmin` = 1% of the smaller of `vw` or `vh`. By using it as the middle-clamp value, font scales with whichever dimension is constraining — so it never grows past what fits horizontally OR vertically.

| Element | Current | New |
|---|---|---|
| Headline `fontSize` | `clamp(1.875rem, 5.5vh, 4rem)` | **`clamp(1.875rem, 6vmin, 4rem)`** |
| Subhead `fontSize` | `clamp(0.875rem, 1.7vh, 1.25rem)` | **`clamp(0.875rem, 1.9vmin, 1.25rem)`** |
| Subhead `marginTop` | `clamp(0.5rem, 2vh, 1.5rem)` | **`clamp(0.5rem, 2.2vmin, 1.5rem)`** |
| CTA `marginTop` | `clamp(0.75rem, 2.5vh, 2rem)` | **`clamp(0.75rem, 2.8vmin, 2rem)`** |
| Deck `marginTop` | `clamp(1rem, 3vh, 2.5rem)` | **`clamp(1rem, 3.3vmin, 2.5rem)`** |

**Math check (headline at `6vmin`):**

| Viewport | `vmin` (px) | Computed font | Resolved (after clamp) |
|---|---|---|---|
| 320 × 568 | 3.2 | 19.2px | 30px (min) |
| 360 × 800 | 3.6 | 21.6px | 30px (min) |
| 720 × 1280 | 7.2 | 43.2px | 43.2px |
| 768 × 1024 | 7.68 | 46px | 46px |
| 1024 × 768 | 7.68 | 46px | 46px |
| 1280 × 720 | 7.2 | 43.2px | 43.2px |
| 1440 × 900 | 9.0 | 54px | 54px |
| 1920 × 1080 | 10.8 | 64.8px | 64px (max) |
| 2560 × 1440 | 14.4 | 86.4px | 64px (max) |

"Find a vibe," at Mochiy ≈ 6.5 × font_size. At 64px max → 416px text width. Still safe on every viewport ≥ 416 + 32 (min side padding) = 448px width. Below 448px (i.e., phones), font is below 30px → safe.

### 4.2 Add `whitespace-nowrap` to each headline line

Belt-and-braces guard against wrapping. Even if a future copy change makes a line longer, it'll be obvious in the test rather than silently wrapping.

```tsx
<span className="whitespace-nowrap">
  <StaggeredHeadline text="Find a vibe," />
</span>
<br />
<span className="whitespace-nowrap text-warm">
  <StaggeredHeadline text="not a venue." delay={0.36} />
</span>
```

### 4.3 Switch deck transform from `vh`-only to `vmin`-based

| Property | Current | New |
|---|---|---|
| Deck `transform` | `scale(clamp(0.82, calc(0.82 + (100vh - 568px) / 3000px), 1.2))` | **`scale(clamp(0.82, calc(0.82 + (100vmin - 360px) / 1200px), 1.2))`** |

**Math check:**

| `vmin` | Computed scale |
|---|---|
| 320 | 0.82 (min) |
| 360 | 0.82 |
| 568 | 0.82 + 208/1200 = 0.997 |
| 768 | 0.82 + 408/1200 = 1.16 |
| 1024 | 0.82 + 664/1200 = 1.37 → 1.2 (max) |

Bigger AND wider screens get bigger deck. Narrow OR short screens get shrunk deck.

### 4.4 Layout-aware deck width

Even with visual scale, the deck wrapper's layout box is still 340px. Wrap the deck in a layout container that **caps width to viewport minus side padding** so layout overflow never happens:

```tsx
<motion.div
  className="flex w-full justify-center"
  style={{ marginTop: 'clamp(1rem, 3.3vmin, 2.5rem)' }}
>
  <div
    className="overflow-visible"
    style={{
      maxWidth: 'min(340px, calc(100vw - clamp(32px, 8vw, 80px)))',
      transform: 'scale(clamp(0.82, calc(0.82 + (100vmin - 360px) / 1200px), 1.2))',
      transformOrigin: 'center top',
    }}
  >
    <HeroVibeDeck />
  </div>
</motion.div>
```

The outer wrapper takes full width and centers. The inner box has:
- `max-width` = either 340px (deck natural width) or `100vw - 2 * (clamp(16px, 4vw, 40px))` whichever is smaller. The `8vw` and `80px` are 2× the side padding values.
- `transform: scale(...)` for visual smoothness when shrinking.
- `transformOrigin: center top` so the scale doesn't displace the deck's vertical position.

### 4.5 Convert section side padding + chip nav side padding to fluid

| Element | Current | New |
|---|---|---|
| Section padding | `px-6 md:px-10` | **`px-[clamp(1rem,4vw,2.5rem)]`** (16-40px fluid) |
| Chip nav max-width | `max-w-[calc(100%-0.5rem)]` | **Wrap chips in a container with the same `px-[clamp(1rem,4vw,2.5rem)]`**, and drop the brittle `max-w` shortcut |

For the chip nav, restructure from:
```tsx
<motion.nav className="absolute bottom-6 left-1/2 flex max-w-[calc(100%-0.5rem)] -translate-x-1/2 ...">
  {chips}
</motion.nav>
```

to:
```tsx
<div className="absolute inset-x-0 bottom-6 px-[clamp(1rem,4vw,2.5rem)] z-10">
  <motion.nav className="flex items-center justify-center gap-1 sm:gap-2 mx-auto" aria-label="Site">
    {chips}
  </motion.nav>
</div>
```

The outer `inset-x-0` + fluid `px` enforces the side padding. The inner `<motion.nav>` is the chip row, centered within. Same fluid padding rule as the section above.

---

## 5. Acceptance test matrix

The implementor must verify the following for the fix to PASS:

| Viewport | Test | Expected |
|---|---|---|
| 320 × 568 | "Find a vibe," renders on one line | ✅ no wrap |
| 320 × 568 | Deck cards visible without horizontal clipping | ✅ deck scaled, no clip |
| 320 × 568 | Chips sit inside `min 16px` from viewport edges | ✅ |
| 360 × 640 | All hero content visible without scroll | ✅ |
| 375 × 667 | iPhone SE — same as above | ✅ |
| 390 × 844 | iPhone 12 — same as above | ✅ |
| 768 × 1024 | iPad portrait — content centered, deck full size | ✅ |
| 1024 × 768 | iPad landscape — content fits with no scroll | ✅ |
| 1180 × 820 | iPad Air landscape — same | ✅ |
| 1280 × 720 | 720p laptop — content fits | ✅ |
| 1366 × 768 | HD laptop — content fits | ✅ |
| 1440 × 900 | most laptops — content fills comfortably | ✅ |
| 1920 × 1080 | FHD desktop — headline near 64px max, deck near 1.2 scale | ✅ |
| 2560 × 1440 | QHD desktop — headline at 64px max (clamped), deck at 1.2 (clamped) | ✅ |
| 3840 × 2160 | 4K — content reads clean at max sizes | ✅ |

Verification method: developer tools device emulator + manual responsive resize. No device hardware required.

---

## 6. Files affected (implementor's blast-radius map)

| File | Change |
|---|---|
| `mingla-marketing/components/sections/explorer-home/hero.tsx` | All five changes from §4 |
| `mingla-marketing/components/sections/explorer-home/hero-vibe-deck.tsx` | None (the deck component itself stays unchanged; only its wrapper changes) |
| `mingla-marketing/components/marketing/glass-nav.tsx` | None (header is already fixed-positioned correctly) |

No design-system tokens (`globals.css`) need changing.

---

## 7. Invariants this spec preserves

- ✅ `100svh` section height (mobile-safe viewport) — unchanged
- ✅ `position: fixed` floating header — unchanged
- ✅ `position: absolute` chip row — relocated into a container, but still absolute
- ✅ `prefers-reduced-motion` respect throughout — clamp formulas don't animate
- ✅ Theme tokens (warm, text-primary, glass) — unchanged

---

## 8. Out of scope

- Glass-nav redesign
- Vibe-deck card geometry (CARD_W=320, CARD_H=210 stay)
- Chip data, copy, or `mobileOnly` flag logic
- Cycling word component internals
- Anything outside the hero section

---

## 9. Definition of Done (for tester)

1. All 15 viewports in §5 verified — no scroll, no horizontal overflow, no headline wrap
2. Side padding measured at 16px on 360px viewport, 40px on 1920px viewport, scaling between
3. Top spacer + bottom spacer measure 80px each on every viewport
4. Reduced-motion users see static layout with same dimensions
5. Lighthouse perf score ≥ 90 on hero page (no regression from current)
6. No new TypeScript errors, no new lint warnings
7. Implementor report includes screenshots at 4 representative viewports (mobile portrait, iPad portrait, iPad landscape, desktop 1080p)

---

**End of spec.**
