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
