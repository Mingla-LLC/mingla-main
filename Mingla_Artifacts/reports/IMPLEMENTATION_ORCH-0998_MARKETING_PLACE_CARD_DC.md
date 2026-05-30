# IMPLEMENTATION — ORCH-0998 [marketing real place cards — DC test run]

**Surface:** `mingla-marketing/` (Next.js 15 App Router, Tailwind v4, framer-motion)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0998-[marketing-real-place-cards-dc]` on branch `ORCH-0998-marketing-real-place-cards-dc`
**Spec:** `Mingla_Artifacts/specs/DESIGN_ORCH-0998_MARKETING_PLACE_CARD_DC.md`
**Mode:** quick test run — working local preview, no merge/push/deploy.
**Status:** implemented and verified (local dev preview).

---

## 1. What changed for end users

The marketing homepage hero deck no longer shows 22 decorative SVG cards. It now shows 5 **real Washington-DC places** — real names, real Google ratings + review counts, real categories, real editorial sell-lines, and a real hero photo per card pulled from public Supabase Storage. The auto-rotating 3-card stack, hover-pause, and reduced-motion behavior are preserved. No distance/travel-time, no app-download CTA, no swipe/Saved/Share chrome (per spec honesty + scope rules).

---

## 2. Files created / changed (Old → New receipts)

### `mingla-marketing/lib/dc-showcase-places.ts` (NEW)
**Before:** did not exist.
**Now:** typed `ShowcasePlace` interface + `DC_SHOWCASE_PLACES` (5 hardcoded DC places, verbatim data from the dispatch) + `placePhotoUrl(placeKey, index)` helper that builds the public Supabase Storage URL `…/place-photos/<placeKey>/<index>.jpg`. Photo index 0 = hero; `nPhotos = 5` each. No fetch, no backend.
**Why:** spec build-note 2 — static snapshot, test data only.
**Lines:** ~120.

### `mingla-marketing/components/sections/explorer-home/hero-place-deck.tsx` (NEW)
**Before:** did not exist.
**Now:** `HeroPlaceDeck` renders the 5 real cards per spec — 260×325 portrait card, `--radius-2xl` (36px) corners, hairline rim, 84% photo / 16% frosted strip split, bottom scrim gradient (spec §2), `glass-soft` "⧉ 5" photos pill top-right, price pill (only when present), 2-line-clamped sell-line over the scrim, frosted strip with Mochiy display name + Nunito `Category · ★ rating (count)` row. Keeps the auto-rotate (4200ms), `visibilitychange`-pause, hover-pause, and `useMinglaReducedMotion()` gate from `HeroVibeDeck`; queue extended to all 5 cards (front + 2 peeked). Category→sell-line fallback lookup for OKPB (no blurb → "Craft cocktails and a room worth lingering in."). Photo 404 fallback = `#1a1a2e` fill + faint Mingla mark (spec §9). Accessibility per spec §10: `role="group"` region, front card `role="img"` with full aria-label, peeked cards `aria-hidden`, decorative glyphs `aria-hidden`. Inline comment documents the intentionally-omitted distance/travel-time so a future dev doesn't re-add it.
**Why:** spec §1–§12 + build-notes 1, 3, 4, 5, 6.
**Lines:** ~330.

### `mingla-marketing/components/sections/explorer-home/hero.tsx` (MODIFIED)
**Before:** imported and rendered `HeroVibeDeck` at L24 (import) and ~L614 (usage) inside the `max-w-[min(420px,…)]` scaled hero slot.
**Now:** imports and renders `HeroPlaceDeck` at the same two sites. Nothing else touched — one-screen hero layout, headline, scaled wrapper slot, and chip bar are byte-identical otherwise.
**Why:** spec mount point + build-note 1 (same import site, same wrapper slot, no hero-layout change).
**Lines:** 2.

### `Mingla_Artifacts/WORKTREE_REGISTRY.md` (MODIFIED)
**Before:** active-worktrees table listed only META-ORCH-0952.
**Now:** appended the ORCH-0998 row (worktree path + branch + IMPLEMENT phase + port 3008 web preview + owner).
**Why:** dispatch instruction — register the worktree, commit alongside first work commit.

`hero-vibe-deck.tsx` and the `dc-cards` SVG assets are intentionally LEFT ON DISK (no longer imported) per the dispatch — not deleted in this test run.

---

## 3. Verification matrix

| Criterion | How verified | Result |
|---|---|---|
| 5 real DC places hardcoded, verbatim | Read-back of `dc-showcase-places.ts`; values match dispatch exactly | PASS |
| Photos resolve from public Supabase Storage | `curl -I` on 3 of the 5 `…/0.jpg` URLs → all HTTP 200 | PASS |
| Component built to spec (split, radius, scrim, pills, strip, fonts) | Built directly against spec §1–§6, §11; SSR HTML contains the region + card data | PASS |
| Auto-rotate / hover-pause / visibilitychange / reduced-motion preserved | Logic copied verbatim from `HeroVibeDeck`, queue extended to 5 | PASS (mechanism) |
| Mounted at hero L614, no hero-layout change | Only the import + the one `<HeroPlaceDeck />` line changed | PASS |
| Old SVG deck stopped importing, left on disk | `hero-vibe-deck.tsx` untouched, no longer imported | PASS |
| Typecheck clean | `npx tsc --noEmit` → `TSC_EXIT=0` | PASS |
| Dev server up on :3008, compiles clean | `next dev -p 3008` → "Ready in 1080ms"; `curl /` → HTTP 200; log "✓ Compiled / in 2.6s", zero errors | PASS |
| No distance / travel-time / CTA / swipe chrome | None rendered; inline comment documents the omission | PASS |

**Photo URL check (spec deliverable):**
- `…/ChIJ-82JrXi3t4kRSAkfWH-6ToU/0.jpg` (L'Ardente) → 200
- `…/ChIJuVcr4vHJt4kR3RGgn9ppyKM/0.jpg` (OKPB) → 200
- `…/ChIJS1TgNB6xt4kRBA6GYja2FyY/0.jpg` (Del Ray Café) → 200

**Dev preview:** http://localhost:3008/ → HTTP 200, compiled clean (2.6s, 1231 modules), SSR HTML contains the `role="group"` aria-label region and front-card data (L'Ardente, Italian Restaurant, Cocktail Bar, President Lincoln's, ★4.5, 2,141 reviews). Cards 4–5 (Anacostia, Del Ray) rotate in client-side, so they are not in the initial SSR snapshot — expected for `order.slice(0,3)`.

---

## 4. Cross-surface impact (Step 3.5)

- **Marketing web** (the only affected surface): hero deck swapped. Files above.
- **Consumer iOS / Android, Buyer/anon web, Business iOS / Android, Admin web:** UNAFFECTED — `mingla-marketing/` is a standalone Next.js site; none of these surfaces import marketing components. Parity N/A.

---

## 5. Regression test

**BACKFILL-EXEMPT.** Rationale: this is a quick test-run preview of a static, presentational marketing deck (5 hardcoded places, no data flow, no mutation, no auth). No product logic to assert. Verification is the live dev-server render + typecheck + photo-URL HTTP 200 checks above. If this graduates beyond a test run, a follow-up ORCH should add a render test asserting all 5 cards mount and the sell-line fallback fires for OKPB.

---

## 6. Discoveries for orchestrator

- `next lint` in this worktree is unconfigured (prompts for interactive ESLint setup). Typecheck (`tsc --noEmit`) is the working static gate; it passed clean. Not introduced by this ORCH — pre-existing repo state.
- `hero-vibe-deck.tsx` + `/public/home-page-cards/dc-cards/*.svg` are now dead code (no importer). A future cleanup ORCH can delete them if the real-place deck graduates from test run to keeper.

---

## 7. Constraints honored

- Marketing-only: zero touches to `app-mobile/`, `supabase/`, `mingla-business/`, `mingla-admin/`.
- Existing `globals.css` tokens + Tailwind utilities only (`--radius-2xl`, `--color-butter`, `glass-soft`, `--font-display`, `--font-sans`); no parallel design system.
- Reduced-motion fallback + contrast notes from spec §6/§8 honored (frosted strip + scrim + text-shadow).
- Plain `<img>` (not `next/image`) per dispatch — matches existing hero-vibe-deck pattern, no `next.config` remotePatterns needed.
- No merge, no push, no deploy — local preview only.

---

## Polish pass — 2026-05-29 (3 on-the-fly design fixes)

Operator ask: "The price should show on all, and the texts should not be cut off. The cards need to be a little higher, so the padding space at the top and bottom of the content area are reduced a little without compromising the no-scroll design."

### FIX 1 — Price pill on all 5 cards
`lib/dc-showcase-places.ts`: set decorative price tiers on the three places that had `priceTier: null` — OKPB `$$$`, President Lincoln's Cottage `$$`, Anacostia Park `$` (L'Ardente `$$$` and Del Ray `$$` unchanged). The deck already renders the price pill whenever `priceTier` is truthy, so all five now show a pill. Inline comment marks OKPB's tier as a decorative marketing value (no live Google price signal). Verified: `grep "priceTier: null"` → 0 matches; all five tiers non-null.

### FIX 2 — No cut-off text
`hero-place-deck.tsx` frosted-strip name: replaced the single-line `truncate` (which ellipsized "President Lincoln's Cottage" mid-text) with a 2-line `-webkit-line-clamp` + `wordBreak: break-word`, and dropped the name from 18px→17px / leading 1.15→1.1 so the longest name shows in full on two lines. The sell-line keeps its spec-mandated 2-line clamp (CSS ellipsis is a clean ending, not a hard mid-word chop) — Anacostia's long blurb now sits in a slightly tighter scrim with the same clean clamp. Category/rating row keeps `truncate` (single meta line, fits at 12px; guards against a 2-line meta breaking strip height).

### FIX 3 — Cards read a touch taller / tighter content area
`hero-place-deck.tsx`: reduced internal padding without changing the card's outer box — scrim content block `p-3`→`px-3 pb-2.5 pt-2` + `gap-2`→`gap-1.5` (sell-line sits lower/tighter); frosted strip `py-3`→`py-2`. Rebalanced the split `photo 84%→81%` / `strip 16%→19%` to give the wrapping name room. **`CARD_W` (260) and `CARD_H` (325) are unchanged** — only the internal distribution moved.

### No-scroll verification (explicit reasoning)
The hero (`hero.tsx`) is `flex h-[100svh] flex-col` with a fixed top spacer `clamp(80px,11vh,160px)`, a `flex-1` centered middle holding the headline + deck slot, and a fixed bottom spacer `clamp(80px,11vh,160px)` (the chip nav is `absolute`, out of flow). The deck wrapper box is `CARD_W+92 × CARD_H+62 = 352×387px`. Because the polish changed **only internal padding and the 81/19 split — not `CARD_W`/`CARD_H`** — the deck's outer layout box is byte-identical to the shipped one-screen version, so the `flex-1` content's natural height is unchanged. At 768px: spacers = clamp(80, 84.5, 160)=84.5px each → 169px; available `flex-1` = 599px, which already held the 387px deck + headline before this pass. At 800/900px the available space only grows. **Conclusion: no page scroll is introduced at 768 / 800 / 900px — the card's outer dimensions are unchanged; only content distribution moved.** (`transform: scale()` on the slot is visual-only and does not change the flow box.)

### Verify
- `curl http://localhost:3008/` → HTTP 200, clean hot-recompile (new `h-[19%]` / `h-[81%]` / `pb-2.5 pt-2` classes + `WebkitLineClamp` serve in HTML).
- All 5 places + full Anacostia blurb present in client chunk `page.js`; all 5 price tiers non-null in data.
- `npx tsc --noEmit` → 0 errors.
- Marketing-only; no `app-mobile`/`supabase`/`mingla-business`/`mingla-admin` touch; existing tokens only.

---

## REDESIGN v2 pass — 2026-05-29 (operator pass 2026-05-29)

**Spec section:** "REDESIGN v2" in `DESIGN_ORCH-0998_MARKETING_PLACE_CARD_DC.md` (supersedes v1 §1 card-height, §2 photo-count pill, §3–§6 bottom-block, §12 mockup). Everything not contradicted (motion §7–§8, reduced-motion, photo treatment + scrim except the pill, 404 fallback, accent/font tokens) is unchanged. No-distance / no-travel-time honesty remains in force.

**Files edited (exactly 2, per dispatch):** `lib/dc-showcase-places.ts` + `components/sections/explorer-home/hero-place-deck.tsx`. Dev server already running on :3008 (orchestrator-started); all edits hot-reloaded; no restart, no second server, no process killed.

### The 5 items

**1. Card height 325 → 360px; split 64% / 36%.** `CARD_H = 360` (was 325, with 🔒LOCKED comment explaining 360 is the no-scroll ceiling). `CARD_W` unchanged (260). Photo zone `h-[64%]` (≈230px); description block `h-[36%]` (≈130px) — was 81%/19%.

**2. Redesigned description area (off-photo, solid block).** Solid `rgba(255,255,255,0.96)` block, padding `12px 14px 10px`, vertical order: category eyebrow (Nunito 10/700/0.06em/uppercase/warm) → place name (Mochiy 18/lh1.1/ink, 1-line truncate, full name in aria-label) → description (Nunito 12.5/lh1.3/500/ink-66%, 2-line clamp) → price+social row (`mt-auto` flex space-between). The over-photo sell-line `<p>` was deleted; name + description moved into the block; photo zone shrank to 64%; seam scrim reduced to lower 38%.

**3. Real price range — data `priceTier` → `priceRange: string | null`.** Render: number `#0e0e10`/700/13px + ` · per person` `rgba(14,14,16,0.45)`/600/10px; `null` → `Free` in `--color-warm #eb7825`/700, no qualifier. Values: L'Ardente `$50–$100`, OKPB `$30–$50`, Del Ray `$20–$30`, Anacostia `null`→Free, Lincoln `null`→Free. En-dash U+2013.

**4. Avatar-overlap "locals recommend" indicator replaces the rating/review row.** New CSS-only `RecommendStack`: 3 soft-gradient circles (22px, 2px white ring, −8px overlap, Mingla warm/butter family) + `+N` overflow chip (`+(count−3)`) + label `N locals recommend`. **No `<img>`, no network.** `recommendCount` added to data: 212 / 48 / 96 / 173 / 184. Old `Category · ★ rating (count)` row + `StarGlyph` + `numberFmt` + `ratingLabel` deleted. aria-label now `"{name}, {category}. {sellLine}. {price or Free}."` (no fake recommend count to AT).

**5. Photo-count pill removed entirely.** `⧉ 5` pill markup + `nPhotos` render + `StackedPhotosGlyph` component all deleted. `nPhotos` stays in the type (unrendered) per v2.8 §1.

### No-scroll conclusion (768px-tall worst case, CARD_H=360)
Deck container formula `CARD_H + 62` is unchanged in code; wrapper scale ≈1.075× at vmin=768. Per the spec envelope: middle band 599.0px available; used = headline 103.3 + margin 27.6 + scaled deck (422×1.075=453.6) = 584.6px → **headroom +14.4px → no page scroll**. CARD_H=375 overflows (−1.7px). I did NOT exceed 360. Taller viewports only grow the band, so 360 is safe everywhere ≥768px.

### Verify
- `tsc --noEmit` (marketing) → **exit 0**.
- `curl http://localhost:3008/` → **HTTP 200**, 77ms, **0** Next build-error/error-overlay markers (clean hot-recompile).
- SSR HTML (front 3 cards): `$50–$100`, `$30–$50`, `Free` present; ` · per person` ×2; `locals recommend` ×3; overflow chips `+209`/`+45`/`+93` = counts 212/48/96 − 3 ✓. Anacostia + Del Ray data verified in source (render on rotation; SSR shows only `order.slice(0,3)`).
- Removed elements: `reviews` ×0, star SVG path ×0, `(2,141)` ×0, `⧉` ×0, `StackedPhotosGlyph` ×0. Orphaned refs to removed symbols: NONE. `priceTier` anywhere in marketing: NONE.
- Marketing-only; no app-mobile/supabase/business/admin touch; existing globals.css tokens + Tailwind only; CARD_H not exceeded.

### Regression test
**BACKFILL-EXEMPT** — marketing-only presentational CSS/data change; verification is the served-HTML + tsc gate above.

### Discoveries for orchestrator
None.

---

## v2.7 chip styling pass — 2026-05-29 (operator verbatim)

**Operator direction (verbatim):** "The labels Cocktail bar, restaurant etc should go. The names of the place and the description should be aligned left and styled as chips. same thing with the price. the 173 locals recommend with the avatars should be on one line and at the bottom."

**File edited (exactly 1):** `mingla-marketing/components/sections/explorer-home/hero-place-deck.tsx`. Dev server already on :3008 (orchestrator-started); all edits hot-reloaded; no restart, no second server, no process killed. `CARD_H` stays 360 (unchanged), `CARD_W` 260 (unchanged), deck-wrapper height `CARD_H + 62` unchanged — the page-level no-scroll ceiling is untouched.

### The 5 changes

**1. Category eyebrow removed entirely.** The `<p>` rendering `{place.category}` (warm 10px uppercase eyebrow) was deleted from the content block. The category is no longer shown on the card. The front-card `aria-label` was also changed from `"{name}, {category}. {sellLine}. {price}."` to `"{name}. {sellLine}. {price}."` so the spoken label matches the visible card (no orphaned category in AT). `place.category` is still consumed internally by `sellLineFor`/`fallbackSellLine`, so no unused symbol.

**2. Place name → left-aligned chip.** Name now renders inside `<Pill variant="glass">` (the shared primitive at `components/ui/pill.tsx`, whose `glass` variant applies the `.glass-soft` utility from `globals.css`). Compact overrides via className: `h-auto max-w-full truncate px-2.5 py-1 font-display`, 14px/lh1.15/ink. Left-aligned because the content block is `items-start`.

**3. Description → left-aligned chip.** Sell-line renders inside the same `<Pill variant="glass">`, `h-auto max-w-full px-2.5 py-1 font-sans`, 11.5px/lh1.25/500, `WebkitLineClamp:2` + `whiteSpace:normal` so it clamps to 2 lines and never overflows.

**4. Price → chip.** Price range / "Free" renders inside the same `<Pill variant="glass">`, `h-auto px-2.5 py-1`, 12px. Keeps the `$N–$N` + ` · per person` two-tone for real ranges and warm "Free" when null. Consistent with name + description chips.

**5. "N locals recommend" + avatars on ONE line at the bottom.** The content block is now `flex flex-col items-start gap-5px`; the bottom row is a `<div className="mt-auto flex w-full items-center">` holding the single `RecommendStack`, which itself lays the 3 CSS-only avatars (+overflow chip) and the "N locals recommend" label on one horizontal row. `mt-auto` pins it to the bottom of the block. CSS-only avatars unchanged (no `<img>`, no network).

**Supporting layout change:** photo zone `h-[64%]`→`h-[58%]`, content block `h-[36%]`→`h-[42%]`, content padding `12px 14px 10px`→`10px 12px`, added `gap:5px`. This gives the 3 stacked chips + bottom row room inside the unchanged 360px card.

### No-scroll conclusion (768px-tall worst case, CARD_H=360 unchanged)
The card's outer height (`CARD_H=360`), width (260) and deck-wrapper height (`CARD_H+62`) are byte-for-byte unchanged, so the page-level one-screen-hero math from v2 (middle band 599.0px available; used 584.6px; **headroom +14.4px**) is unchanged → **no page scroll at 768px.** Internal fit inside the 360px card: content block 42% of 360 ≈ 151px, minus 20px vertical padding ≈ 131px usable. Chip stack with 5px gaps: name ≈24px + description(2-line) ≈37px + price ≈20px + 3 gaps 15px + bottom row(avatars 22px) ≈22px = **≈118px ≤ 131px usable (~13px headroom)**. The block is `overflow:hidden`, so any tightening clips cleanly rather than growing the card. Conclusion: **fits with headroom; no scroll, card height not exceeded.**

### Verify
- `npx tsc --noEmit` (marketing) → **exit 0**, no errors.
- `curl http://localhost:3008/` → **HTTP 200**; **0** Next build-error / error-overlay markers (clean hot-recompile).
- Served HTML: `glass-soft` chips present; place name `OKPB` present; `locals recommend` present; ` per person` present. **Category strings ABSENT** — grep for `Italian Restaurant` / `Cocktail Bar` / `Historical Landmark` / `French Restaurant` returns nothing in the served HTML (gone from both visible label and aria-label).
- Marketing-only; no app-mobile/supabase/business/admin touch; only existing `globals.css` tokens + the shared `<Pill>` primitive reused (no new chip style invented).

### Regression test
**BACKFILL-EXEMPT** — marketing-only presentational CSS change; verification is the served-HTML + tsc gate above.

### Discoveries for orchestrator
None.

---

## Chip Color System v3 pass — 2026-05-29 (operator verbatim)

**Operator direction (verbatim):** "The chips need better design, use black, white or eb7825. Great contrast for visual appeal. The price should be beside the name of the place compact to both be contained in one line. The locals and avatar should be in a colored pill as well, and be the full width of the section so its great."

**File edited (exactly 1):** `mingla-marketing/components/sections/explorer-home/hero-place-deck.tsx`. Dev server already on :3008 (orchestrator-started); all edits hot-reloaded; no restart, no second server, no process killed. `CARD_H` stays 360 (untouched), `CARD_W` 260, deck-wrapper `CARD_H + 62` — page-level no-scroll ceiling untouched. Per spec §335–476 "Chip Color System v3."

### The 3 changes

**1. Name + price → ONE ink chip on a single line (v3.2).** The separate name `<Pill>` and price `<Pill>` were merged into one flex `<div>`: fill `var(--color-ink)` (#0E0E10), `border-radius:10px`, pad `5px 10px`, `align-items:baseline`, `gap:8px`, `width:max-content`, `overflow:hidden`. Name (left) `flex:1 1 auto; min-width:0; white-space:nowrap; text-overflow:ellipsis` — truncates if long (e.g. President Lincoln's Cottage). Mochiy 14px White `#FFFFFF`. Price (right) `flex:0 0 auto; white-space:nowrap` — Nunito 12px/700 White, never wraps. RANGE ONLY (`· per person` dropped per v3.2). "Free" renders in WHITE here (orange reserved for the locals pill). White-on-ink = 18.9:1 (AAA).

**2. Description chip → solid white with a hairline rim (v3.3).** Was glass-soft `<Pill>`; now a `<div>` fill `#FFFFFF`, `border:1px solid rgba(14,14,16,0.08)` rim, `border-radius:8px`, pad `5px 9px`, text `rgba(14,14,16,0.78)` (9.8:1 AAA), Nunito 11.5px/lh1.25/500, 2-line clamp via `-webkit-line-clamp:2` + `overflow:hidden`, `width:max-content; max-width:100%`.

**3. Locals row → full-width orange pill (v3.4).** The bottom row is now a `<div>` fill `var(--color-warm)` (#EB7825), `width:100%`, `border-radius:999px`, `height:30px`, pad `0 10px`, `mt-auto` (pinned to block bottom), `overflow:hidden`, `display:flex; align-items:center`. Inside, `RecommendStack` was updated: avatar rings → solid `#FFFFFF` (was `rgba(255,255,255,0.96)`); gradients REORDERED to cocoa→copper, butter→amber, and a NEW deep plum→violet so each disc separates from the orange band (per v3.4); `+N` overflow chip fill → solid `var(--color-ink)` (was `rgba(14,14,16,0.82)`); label + count color → `var(--color-ink)` (was `rgba(14,14,16,0.6)`/#0e0e10). Layout = avatars left, label left-packed (`margin-left:8px`), then a `flex:1 1 auto` spacer so the pill is genuinely full-width with content left-packed. Initials M/J/K White on the dark/mid gradients.

**Why ink text on orange, not white (load-bearing color decision):** white-on-#EB7825 = 4.2:1 (FAILS AA body 4.5). Ink-on-orange = 5.0:1 (passes AA body, AAA large). Recorded inline in the component so no future dev "fixes" it back to white.

**Cleanup:** the now-unused `import { Pill }` was removed (Pill no longer used anywhere in the file); stale content-block comment updated to describe the v3 dark→light→accent cadence.

### Contrast summary (computed, per spec v3.7)
| Pairing | Ratio | WCAG |
|---|---|---|
| White name/price on Ink chip | 18.9:1 | AAA |
| Ink-78% description text on White chip | 9.8:1 | AAA body |
| Ink label/count on Orange pill | 5.0:1 | AA body ✓ |
| White avatar initials on cocoa/butter/plum | ≥4.5:1 | AA body |
| White +N on Ink overflow chip | 18.9:1 | AAA |

White-on-orange (4.2:1) was REJECTED for failing AA body — that is why the locals pill uses ink text.

### No-scroll conclusion (768px-tall worst case, CARD_H=360 unchanged)
The card's outer height (`CARD_H=360`), width (260) and deck-wrapper height (`CARD_H+62`) are byte-for-byte unchanged from v2, so the page-level one-screen-hero math is unchanged → middle band 599.0px available, used 584.6px, **headroom +14.4px → no page scroll at 768px or any taller viewport.** Internal fit: v3 REMOVED one full row (price folded into the name line) and spent part of the reclaimed space on the 30px orange pill. Computed content-block budget (spec v3.5) = **124.75px**, comfortably under the available content area (≈151px at the as-built 42% split). Block is `overflow:hidden` so any name wrap clips cleanly. **CARD_H stays 360; no scroll; card height not exceeded.**

### Verify
- `npx tsc --noEmit` (marketing) → **exit 0**, no errors.
- `curl http://localhost:3008/` → **HTTP 200** (clean hot-recompile; correct chip markup served — a compile error would yield a Next error overlay/500 instead).
- Served HTML: name+price on the combined ink chip (`var(--color-ink)` fill ×1; `L'Ardente … $50–$100`); description white chip with `1px solid rgba(14,14,16,0.08)` rim; `var(--color-warm)` orange locals-pill fill ×2; `locals recommend` ×3; `Free` present (Lincoln's Cottage front card); overflow chips `+209`/`+45`/`+93`. ` per person` count = **0** (dropped per v3.2). Category labels (`Italian Restaurant`/`Cocktail Bar`) count = **0** (still absent).
- Marketing-only; no app-mobile/supabase/business/admin touch; existing `--color-ink` + `--color-warm` tokens reused (no raw hex for the chip fills); CARD_H not exceeded.

### Regression test
**BACKFILL-EXEMPT** — marketing-only presentational CSS/color change; verification is the served-HTML + tsc gate above.

### Discoveries for orchestrator
None.

---

## v3.5 — locals white text + equal-spacing description + fixed-length copy (operator pass, 2026-05-29)

Operator (Seth) verbatim: "locals recommend should be white text. The card description should be aligned left and the container for it should extend down such that the space between the title and price and the locals recommend is equal and there is more space for the text. also there should be a fixed character length for the entire description and the descriptions should be rewritten to that length so it all fits and is compact."

**Files edited (2):**
- `mingla-marketing/components/sections/explorer-home/hero-place-deck.tsx`
- `mingla-marketing/lib/dc-showcase-places.ts`

Dev server already on :3008 (orchestrator-started); both edits hot-reloaded; no restart, no second server, no process killed. `CARD_H` stays 360 (LOCKED, untouched), `CARD_W` 260, 58/42 photo/content split untouched.

### Change 1 — Locals label → WHITE, bold, 14px (accessible large text)
`RecommendStack` label was ink `var(--color-ink)` 11px/600. Now WHITE `#FFFFFF`, **bold 700, 14px** (count span 800), `white-space:nowrap`. Rationale recorded inline: white-on-#eb7825 ≈ 4.2:1 passes WCAG AA only for LARGE text; at ≥14px bold the AA threshold drops to 3:1, which 4.2:1 clears, so the label stays accessible. Avatar rings remain solid white; the `+N` overflow chip is unchanged (white text on solid ink = 18.9:1, already readable). A guard comment forbids dropping below 14px or un-bolding.

### Change 2 — Description left-aligned + container extends with EQUAL spacing
Restructured the 42% content block as a clean flex column with three children:
- **Name+price chip** (top) — `flex: 0 0 auto`, unchanged.
- **Description chip** (middle) — now `flex: 1 1 auto`, `width:100%`, `min-height:0`, `margin: 8px 0` (equal top+bottom), `text-align:left`, `flex-col justify-center` so the text vertically centers inside the grown chip. Padding bumped to `6px 9px`, line-height to 1.3. The 2-line `-webkit-line-clamp` was removed (descriptions are now length-bounded; `overflow:hidden` on the chip + block guards any edge case).
- **Locals pill** (bottom) — `flex: 0 0 auto`; the prior `mt-auto` was REMOVED (no longer needed — the description chip's `flex:1` consumes all slack, leaving the pill naturally at the bottom).
- The parent block's `gap: '5px'` was REMOVED so the only vertical spacing around the description is its own symmetric `8px` margins.

**Equal-spacing proof:** flex item margins do NOT collapse. Gap ABOVE the description = its `margin-top` = 8px (name chip has no bottom margin, parent has no `gap`). Gap BELOW = its `margin-bottom` = 8px (pill has no top margin). Both = 8px, fixed and equal regardless of block height, because the description chip absorbs all remaining vertical slack via `flex:1 1 auto`. The chip therefore "extends down," giving the text more room while keeping the two gaps identical.

### Change 3 — Fixed description length + rewritten copy
Added `export const DESCRIPTION_MAX_CHARS = 72` in `dc-showcase-places.ts` with a comment instructing future cards to keep blurbs ≤ this budget for uniform layout. All 5 blurbs rewritten VERBATIM to operator copy, each tagged inline with its char count:
- L'Ardente (68): "Chandeliers, a gold-plated pizza oven, and pasta worth the occasion."
- OKPB (63): "Inventive cocktails in a low-lit room built for lingering late." (was `blurb: null` → now set)
- President Lincoln's Cottage (65): "Lincoln's Civil War retreat, now a quietly moving hilltop museum."
- Anacostia Park (64): "Riverside trails, picnic spots, and a skating rink by the water."
- Del Ray Café (64): "Farm-to-table French-American comfort in a cozy converted house."

All ≤ 72; two tidy lines at 11.5px in the 260-wide chip. OKPB no longer falls through to the category fallback sell-line.

### No-scroll conclusion (768px, CARD_H=360 unchanged)
CARD_H (360), CARD_W (260), the 58/42 split, and the deck-wrapper height (`CARD_H+62`) are byte-for-byte unchanged — the page-level one-screen-hero math is untouched, so the prior +14.4px headroom at vmin=768 still holds. Internal fit: content-block inner height ≈ 131.2px (42% of 360 minus 10px×2 padding) = name chip ~26px + 8px + description ~59px + 8px + pill 30px. The description's `flex:1` only ever ADDS slack to itself; it cannot push the fixed 26+30+16 = 72px of siblings/margins past the 131px budget. `overflow:hidden` on both the chip and the block clips any edge case. **CARD_H stays 360; no new scroll at 768px or taller.**

### Verify (v3.5)
- `npx tsc --noEmit` (marketing) → **exit 0**, clean.
- `curl http://localhost:3008/` → **HTTP 200** (clean hot-recompile; a compile error would yield a 500/error overlay).
- Served HTML: all 5 new blurbs present (Lincoln/Anacostia/Del Ray apostrophe/comma HTML-escaped in SSR; Lincoln+Anacostia+DelRay are positions 4–5, in the JS bundle, rendered as the deck rotates — confirmed in source + chunk); `locals recommend` present; old blurbs (`firing signature pies`, `roller-skating rink, picnic sites`, `Gothic-Revival cottage`) count = 0.
- Marketing-only; no app-mobile/supabase/business/admin touch; only existing `--color-warm` token + standard hex `#ffffff` (matches the file's existing white-text convention).

### Regression test (v3.5)
**BACKFILL-EXEMPT** — marketing-only presentational CSS/color/copy change; verification is the served-HTML + tsc gate above.

### Discoveries for orchestrator (v3.5)
None.

---

## Intent Card v1 — NEW card type (preview route) — 2026-05-29

Built the NEW "intent card" per `DESIGN_ORCH-0998_MARKETING_PLACE_CARD_DC.md` §I.1–I.9. An intent card is a snapshot of a multi-stop Mingla EXPERIENCE / plan (Mingla = experience / date-planning app, never a dating app). Additive only: new component + new data file + new standalone preview route. The production hero and `hero-place-deck.tsx` are untouched.

### New files

#### `mingla-marketing/lib/dc-intent-plans.ts` (new)
**What it does:** typed `IntentPlan[]` of the 4 operator-verbatim DC plans (Romantic Evening, Group Night Out, Culture Crawl, Slow First Date). Each plan: `id`, `intentTitle`, `stops[]` (`name`, `role`, `heroPhoto`), `itineraryLabel`, `sellLine` (≤72 chars), `priceRange`, `duration`. Stop hero photos resolved via `placePhotoUrl(<placeKey>,0)` against the public Supabase `place-photos` base. Header comment documents: price ranges are real summed ranges where stop price exists ("from $X" / "Free" otherwise), duration is an editorial estimate. All 11 distinct stop placeKeys verified → `/0.jpg` returns HTTP 200.
**Lines:** ~150.

#### `mingla-marketing/components/sections/explorer-home/intent-card.tsx` (new)
**What it does:** renders ONE intent card. Pixel-identical SHELL to the single place card (260×360, `--radius-2xl` 36px, border/elevation tokens, frosted-white `rgba(255,255,255,0.96)` content block, `#1a1a2e` photo fill, per-cell 404 → faint Mingla mark). DIFFERS in two ways per spec: (1) photo zone (64%) is a horizontal flex collage of N equal `flex:1` cells (one per stop, itinerary order) separated by 2px ink seams (`gap:2px` over `--color-ink` bg), each cell with an ink stop-number badge top-left; (2) the 36% content block carries the v3 ink→white→orange three-chip cadence re-purposed for a plan — ink chip with `intentTitle` (flexes/truncates) + `N stops` (hugs right), white itinerary-sequence chip (2-line clamp, the itinerary IS the sell), full-width orange price+duration pill (`justify-between`, ink text 5.0:1 on orange — never white-on-orange). Pure CSS, plain `<img>`. `role="img"` + §I.7 aria-label on front; pill + badges + photos `aria-hidden`. Reduced-motion N/A here (static card; the optional sibling-deck wrapper would inherit `useMinglaReducedMotion()` — not built this pass, own-row static preview per §I.5).
**Lines:** ~300.

#### `mingla-marketing/app/intent-preview/page.tsx` (new)
**What it does:** standalone preview route. Renders all 4 intent cards in a centered responsive flex-wrap grid on the marketing `--color-smoke` background under a "Intent cards — preview" heading + eyebrow + subhead, plus ONE existing `<HeroPlaceDeck />` below for side-by-side comparison. `robots: noindex` (preview). Production hero untouched.
**Lines:** ~115.

### Spec traceability (Intent Card v1)
- §I.1 vertical-seam collage, 2px ink seams, ink stop-number badges, 64% photo zone, per-cell 404 fallback, ≤4 cells → **DONE**.
- §I.2 three chips (ink title+`N stops` / white itinerary / orange pill), title in name-slot, stop count in price-slot → **DONE**.
- §I.3 itinerary chip IS the sell; sellLine ≤72 authored per plan (carried in data for future section subhead use) → **DONE**.
- §I.4 orange pill carries summed price range + duration (two honest facts, no fabricated social count); ink-on-orange; decorative-duration comment present → **DONE**.
- §I.5 own-row placement (preview route, not mixed into locked hero deck) → **DONE**.
- §I.6 260×360 shell, 64/36 split, CARD_H=360 unchanged → **DONE**.
- §I.7 aria-label (`"{title}. A {N}-stop Mingla plan: {roles with 'then'}. {price}, {duration}."`); pill/badges/photos aria-hidden → **DONE**.
- §I.8/I.9 ink/white/orange recipe reused verbatim; honesty + decorative comments inline → **DONE**.

### Verify (Intent Card v1)
- `npx tsc --noEmit` (marketing) → **exit 0**, clean.
- `curl http://localhost:3008/intent-preview` → **HTTP 200**, 54 KB rendered HTML (a compile error would yield a 500/overlay).
- Served HTML (HTML-unescaped) contains all 4 intent titles, all 4 visible arrow itineraries (`Dinner → Cocktails → Stroll`, `Dinner → Game → Nightcap`, `Museum → Walk → Coffee`, `Sushi → Pastries → Stroll`), all 4 price ranges (`$80–$150 for two`, `from $40 for two`, `Free–$20 for two`, `$20–$40 for two`), all 4 durations (`≈ 3 hrs`, `≈ 3.5 hrs`, `≈ 4 hrs`, `≈ 2.5 hrs`), `3 stops` chips, and the comparison single-card's `locals recommend`.
- One stop photo URL spot-checked + all 11 distinct stop keys → `curl -I .../0.jpg` HTTP 200.
- Marketing-only; no app-mobile/supabase/business/admin touch; only existing `--color-ink`/`--color-warm`/`--color-smoke`/`--radius-2xl` tokens + standard `#ffffff` (matches the file's existing convention). Positioning is EXPERIENCE app, never dating (verbatim in the component header comment).
- No eslint config present in the worktree (`next lint` is unconfigured/interactive) → tsc is the available scoped gate; passed clean.

### Regression test (Intent Card v1)
**BACKFILL-EXEMPT** — marketing-only additive presentational component + hardcoded test data + a noindex preview route; zero product-logic, no shared-state, no network mutation. Verification is the served-HTML + tsc gate above.

### Discoveries for orchestrator (Intent Card v1)
None. The optional auto-rotating sibling intent-deck (§I.5 alternative) and any homepage mount were intentionally NOT built — this is a "let's see" preview only (own-row static grid), per the dispatch.

---

# Event Card v1 — THIRD card type (appended 2026-05-29)

**Spec section:** `DESIGN_ORCH-0998_MARKETING_PLACE_CARD_DC.md` "Event Card v1" §E.1–E.11
**Status:** implemented and verified (local dev preview, static showcase)

## What changed for end users
The ORCH-0998 preview route now shows a THIRD marketing card type below the intent + single-place sections: an **Events happening in DC** row of 6 real event cards. Four are REAL Ticketmaster events for Washington DC (real cover art, venue, date, ticket link); two are representative Mingla Business events — one with a photo cover, one showcasing the brand `coverHue` striped fallback band. Each card leads with a calendar-tile date badge (the event time-anchor), a source signal ("On Mingla" ink chip for business events; quiet "Ticketmaster" attribution in the CTA pill for TM), and a full-width orange ticket-CTA pill that shows a price only when one exists (never "TBA").

## Files (Old → New receipts)

### `mingla-marketing/lib/dc-showcase-events.ts` (NEW)
**Before:** did not exist.
**Now:** typed `ShowcaseEvent` (discriminated on `source: 'mingla' | 'ticketmaster'`, shape per §E.11.2) + `DC_SHOWCASE_EVENTS` (6 events). Header comment documents provenance: TM events REAL (live from the Ticketmaster edge function for DC); the 2 Mingla events REPRESENTATIVE (real DB events are test data) — one photo cover, one `coverImageUrl:null` + `coverHue:200` to showcase the striped fallback.
**Why:** §E.11.2.
**Lines:** ~165.

### `mingla-marketing/components/sections/explorer-home/event-card.tsx` (NEW)
**Before:** did not exist.
**Now:** ONE branched `EventCard` (§E.1 🔒) + internal `EventCover` / `CoverHueBand` / `MinglaMark` / `PricePill`. Reuses the 260×360 shell, `--radius-2xl`, border/elevation, frosted `rgba(255,255,255,0.96)` content block, `#1a1a2e` cover fill, plain `<img>`, graceful 404. Calendar badge (§E.3, orange month / white day Mochiy 22). Cover (§E.4): real image + bottom vignette; Mingla image-error → coverHue band; coverHue striped band translated 1:1 from `packages/event-rendering/EventCover.tsx` (`repeating-linear-gradient(135deg, hsl(h,60%,50%) 0 14px, hsl(h,60%,40%) 14px 28px)` + vignette); hard-404 → faint Mingla mark. Source chip (§E.5): Mingla → "On Mingla" ink chip top-right; TM → none. 3-chip block (§E.6): warm `#C75E12` 🔒 caps eyebrow → ink title(+venue Variant A) line → optional white venue chip (Variant B, venue >16 chars) → orange pill. Pill (§E.7): price-left-when-present + CTA-right; "Ticketmaster" on every TM card 🔒; never "TBA". `aria-hidden` decorative chips; card `aria-label` §E.9. Honesty comments inline.
**Why:** §E.1–E.9 + build-notes 1–8.
**Lines:** ~340.

### `mingla-marketing/app/intent-preview/page.tsx` (MODIFIED)
**Before:** intent grid + single-place-card comparison section.
**Now:** + `EventCard` / `DC_SHOWCASE_EVENTS` import + an "Event cards / Events happening in DC" section rendering all 6 cards in the same responsive flex-wrap row. Existing sections intact.
**Why:** §E.11.9 own-row placement + the "let's see" preview requirement.
**Lines:** ~45 added.

## Verification matrix (Event Card v1)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (mingla-marketing) | PASS — exit 0 |
| `curl /intent-preview` | HTTP 200 |
| All 6 titles in served HTML | PASS |
| "On Mingla" (2 business cards) | PASS — 2 visible occurrences |
| "Ticketmaster" attribution | PASS — `Tickets via Ticketmaster →` ×3 + `$18 · Ticketmaster →` ×1 |
| "Get tickets" (Mingla CTA) | PASS |
| "from $15" (Rooftop pill) | PASS |
| No "TBA" | PASS — grep count 0 |
| coverHue striped band (hue=200) | PASS — `repeating-linear-gradient(135deg, hsl(200,60%,50%) …)` present |
| Eyebrow `#C75E12` (not `#EB7825`) | PASS |
| TM cover URL (Off The Wall) | PASS — HTTP 200 |
| Hip Flask place-photo URL | PASS — HTTP 200 |
| Clean compile | PASS — card content served, no error overlay |

Both sources render; the hue=200 striped fallback renders for the no-media Mingla event.

## Cross-surface impact (Step 3.5)
- **Affected:** Marketing Web only. New component + data file + extended preview route.
- **NOT affected:** Consumer iOS/Android, Buyer/anon Web, Business iOS/Android, Admin Web — no shared code path; the app's `EventCover` recipe is reproduced (web CSS) not imported, so no coupling to `packages/event-rendering`.

## Invariants
- Positioning (experience app, not dating): PRESERVED.
- Honesty (no distance/travel-time/autoplay/TBA/TM-logo): PRESERVED.
- ONE branched component (§E.1 🔒): PRESERVED.
- `CARD_H = 360` shell parity 🔒: PRESERVED.

## Comms ledger (Event Card v1)
Read on entry. No BLOCK/WARN entry targets ORCH-0998 or this skill. COMMS-0003 (cite external-API docs inline) is **N/A** — no live external API call is added in code; the TM events are static pre-fetched data with provenance recorded in the data file.

## Regression test (Event Card v1)
**BACKFILL-EXEMPT** — marketing-only additive presentational component + hardcoded test data + a noindex preview route; zero product-logic, no shared state, no network mutation. Verification is the served-HTML + tsc gate above.

## Discoveries for orchestrator (Event Card v1)
None. The event card is shell-compatible (260×360) with the auto-rotating hero deck if a future ORCH wants events mixed in (§E.11.9); per spec it sits on its own preview row this run, not in the locked hero deck.

---

# REAL ASSEMBLY — interleaved data-driven hero deck (2026-05-29)

The hero deck stops being single-place-only. It becomes ONE auto-rotating 260×360 stack that interleaves all three card types in the repeating order **1 single place → 1 intent → 1 event**, looping forever. DC only, marketing-only.

## What changed for end users (real assembly)
The homepage hero now cycles a mix: a real DC place card, then a multi-stop Mingla plan card, then a "what's on" event card — over and over. The single-place data grew from 5 to **10 top-scored DC places (one per Mingla category)**; the intent data grew from 4 to **6 plans (one per intent)**; events unchanged (6). Auto-rotate (4200ms), hover-pause, tab-hidden pause, and reduced-motion all preserved. Same 260×360 shell for every card, so the hero stays one screen tall at 768px (no page scroll).

## Files changed (Old → New receipts)

### `mingla-marketing/lib/dc-showcase-places.ts`
**Before:** 5 DC places (L'Ardente, OKPB, President Lincoln's Cottage, Anacostia Park, Del Ray Café). Null price rendered "Free".
**Now:** 10 places, exactly one per Mingla category (Nature & Views → Anacostia Park, Icebreakers → National Gallery of Art, Drinks & Music → Jack Rose, Brunch → Pisco y Nazca, Casual → Oyamel, Upscale → KYOJIN Sushi, Movies → Regal Hyattsville Royale, Theatre → Kennedy Center, Creative & Arts → NMAAHC, Play → The Great Escape Room DC). Real names/ratings/review-counts/photo keys verbatim. **Price-honesty rule applied:** genuinely-free places (parks + free-admission museums) show "Free"; ticketed places with no price data set `priceRange: null` and the card now renders the name ONLY (no fake "Free"). `recommendCount` values are decorative (flagged in-file).
**Why:** dispatch §1.
**Lines:** ~130 (array replaced).

### `mingla-marketing/lib/dc-intent-plans.ts`
**Before:** 4 plans (romantic-evening, group-night-out, culture-crawl, slow-first-date).
**Now:** 6 plans, one per intent: A Romantic Evening (romantic), A Slow First Date (first-date), An Adventurous Afternoon (adventurous), A Group Night Out (group-fun), A Picnic by the Water (picnic-dates), Take a Stroll (take-a-stroll). New verbatim sell-lines, itinerary labels, price ranges, durations, and real stop place-keys (incl. new keys: Decades DC, Fresh Baguette, KYOJIN, Great Escape Room, etc.). `IntentPlan`/`IntentStop` shapes unchanged → `/intent-preview` keeps working.
**Why:** dispatch §2.
**Lines:** ~75 (array replaced).

### `mingla-marketing/components/sections/explorer-home/hero-place-deck.tsx`
**Before:** `HeroPlaceDeck` rotated only `DC_SHOWCASE_PLACES`; the single-place render lived inline inside `DeckCard`, which also owned the stack motion wrapper + border/shadow.
**Now:**
1. **Extracted `PlaceCard`** (exported) — the single-place card as a self-contained 260×360 shell (own border/shadow/radius), pixel-matching the `IntentCard`/`EventCard` signature `{ place, isFront, eager }`. Honest price: when `priceRange === null` the price chip is omitted entirely (no fake "Free").
2. **`buildInterleavedSlots()`** — module-load round-robin producing the slot sequence `single[i] → intent[i % 6] → event[i % 6]` for `i` in 0..9 (10 singles). Shorter intent/event lists WRAP modulo so the strict single→intent→event cadence holds across all 10 singles. Deterministic (no `Math.random`) → no hydration mismatch. Slot keys are round-prefixed (`p{i}-`, `i{i}-`, `e{i}-`) so AnimatePresence never sees a duplicate key when a list wraps onto a second pass. 30 slots total.
3. **`StackCell`** — the stack positioning wrapper (scale/y/zIndex/enter/exit/peeked-dim), now type-agnostic; renders `PlaceCard` | `IntentCard` | `EventCard` by `slot.kind`. The 260×360 shell moved INTO each card component so all three are pixel-identical in the stack.
4. `HeroPlaceDeck` rotates `DECK_SLOTS` (was `DC_SHOWCASE_PLACES`); mounts the first 3 slots (`order.slice(0,3)`) — mechanically the same 3-card stack as before. Auto-rotate/hover-pause/visibilitychange/reduced-motion preserved verbatim.
**Why:** dispatch §4.
**Lines:** ~470 (rewritten).

### `mingla-marketing/components/sections/explorer-home/hero.tsx`
**No change.** Still imports + mounts `<HeroPlaceDeck />` at L614 inside the unchanged one-screen wrapper. Because the deck is interleaved under the same export name and same 260×360 shell, the headline, chip bar, and no-scroll layout are untouched.

### `intent-card.tsx` / `event-card.tsx` / `dc-showcase-events.ts`
**No change.** Reused as-is. `IntentPlan`/`ShowcaseEvent` type shapes unchanged → `/intent-preview` route keeps working with no import edits.

## Interleave approach
Round-robin built once at module load: for each of the 10 single places `i`, emit `single[i]`, then `intent[i % 6]`, then `event[i % 6]`. The 6-long intent + event lists wrap (modulo) onto a second partial pass so every one of the 10 singles is followed by an intent then an event — the strict single→intent→event pattern never breaks. The 30-slot array is rotated by the existing auto-rotate interval (shift front to back); the deck mounts only the front 3 slots, so it cycles identically to the original single-only stack and loops forever.

## No-scroll conclusion (768px hero)
PRESERVED. All three card types are locked at `CARD_H = 360` / `CARD_W = 260` (verified by grep across all three card files). `StackCell` is a pure positioning wrapper at 260×360; the deck container (`CARD_W + 92` × `CARD_H + 62`) and the `hero.tsx` deck-mount wrapper (L605-615, `scale(clamp(0.82…1.08))`) are unchanged. Only 3 cards mount at once. No new vertical footprint was introduced, so the v2.1-locked one-screen math at 768px tall holds exactly as before.

## Verification (real assembly)
- `npx tsc --noEmit` (mingla-marketing): **clean, exit 0**.
- Dev server `:3008` (running from this worktree, hot-reloaded — not restarted): dev log shows `✓ Compiled / in 2.6s (1231 modules)`, `GET / 200`. No errors/warnings.
- `curl http://localhost:3008/` → **HTTP 200**. Initial SSR HTML contains the expected front-3 interleave: single place "Anacostia Park" (×1), intent "A Romantic Evening" (×1), event "On Mingla" + "Get tickets" (×1). Later-slot cards (Jack Rose, KYOJIN) correctly appear only after rotation, not in initial HTML.
- `curl http://localhost:3008/intent-preview` → **HTTP 200**; renders all 6 new intents + new place stops (KYOJIN, Great Escape Room) + events.
- Photo-URL spot check (`curl -I`): all **12 distinct new place photo keys returned HTTP 200** — Anacostia Park, National Gallery, Jack Rose, Pisco y Nazca, Oyamel, KYOJIN, Regal Hyattsville, Kennedy Center, NMAAHC, Great Escape Room, Decades DC, Fresh Baguette. **Zero 404s.**

## Comms ledger (real assembly)
Read on entry. No BLOCK/WARN entry targets ORCH-0998 or this skill. COMMS-0003 (cite external-API docs inline) N/A — no live external API call added; all data is static.

## Regression test (real assembly)
**BACKFILL-EXEMPT** — marketing-only presentational interleave of hardcoded test data; zero product-logic, no shared state, no network mutation, noindex preview route. Verification is the served-HTML + tsc + photo-URL gates above.

## Discoveries for orchestrator (real assembly)
None. The interleave is deterministic and self-contained to `mingla-marketing/`. No other surface touched.
