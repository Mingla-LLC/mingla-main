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
