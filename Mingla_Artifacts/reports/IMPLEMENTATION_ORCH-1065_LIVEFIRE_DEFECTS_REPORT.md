# IMPLEMENTATION — ORCH-1065 [consumer-experience-deck-card] live-fire defect fixes

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]/` on branch `ORCH-1065-consumer-experience-deck-card`
**Status:** implemented and verified (source + Deno regression; sim hot-reload re-verified by orchestrator)
**Comms ledger:** read on entry. Factored COMMS-0014 / COMMS-0016 (experience checkout MUST route through `ticket-checkout-create`, no parallel money fn) — BUG-4 investigation confirms the existing path is intact and was NOT changed. No new COMMS entry needed (no cross-ORCH discovery).

---

## Summary

On-device live-fire of a real seeded brand experience (`event_id 7e8673db-7289-45ea-bb89-3dc007def13d`, `total_price_cents=4500` USD, 3 stops, `event_type='experience'`) surfaced 3 defects in the experience deck card + a 4th candidate. Three fixed; the 4th is NOT-A-BUG with DB evidence.

| Bug | Symptom | Root cause | Fix | Verdict |
|---|---|---|---|---|
| 1 | Price chip shows "Free" not "$45" | Card sums per-stop prices (all 0 for experiences); ignores the envelope total that carries `total_price_cents` | Experience variant reads `card.totalPriceMin/Max` via `formatCurrency` | FIXED |
| 2 | Rating chip shows "0.0" | Experience stops carry `rating:0` (no Google rating); chip rendered the meaningless avg | Hide the rating chip for the experience variant | FIXED |
| 3 | Metro require cycle | Card imported leaf constants back from `SwipeableCards` (which renders the card) | Move constants to a leaf `deckHeroConstants.ts` module | FIXED |
| 4 | Sheet opens (idx 1) then closes (idx -1) | — | Event HAS a valid online ticket; EBES has no experience-specific dismiss; index is purely `visible`-driven | NOT-A-BUG (test-tap noise) |

---

## Root cause (file:line)

### BUG 1 — price "Free" instead of "$45"
- **Server is correct.** `supabase/functions/discover-cards/index.ts:256,275-276` maps `row.total_price_cents` → `totalMajor` (4500/100=45) → `totalPriceMin=totalPriceMax=45`. The converter `app-mobile/src/services/deckService.ts:334-335` carries these onto the Recommendation. So the price reaches the card as `card.totalPriceMin=45`.
- **The card threw it away.** `app-mobile/src/components/CuratedExperienceSwipeCard.tsx:234-235` (pre-fix) deliberately distrusts `card.totalPriceMin/Max` (ORCH-0629 rule — correct for *curated*, whose per-stop prices are the source of truth) and sums `visibleStops[].priceMin/Max`. An experience's stops carry NO per-stop price (`price_cents=0` each, set at `discover-cards/index.ts:236,247-248`), so the sum is 0 → the `if (min===0 && max===0) return 'Free'` branch fires. Root cause: the "distrust envelope total" rule was applied uniformly, but experiences keep their price ONLY in the envelope total.

### BUG 2 — rating "0.0"
- `CuratedExperienceSwipeCard.tsx:337-339` (pre-fix) always rendered `<GlassBadge iconName="star">{avgRating}</GlassBadge>`. `avgRating` = mean of `visibleStops[].rating`, and experience stops are honest `rating:0` (`discover-cards/index.ts:250`, comment "Experiences carry no Google rating — honest 0"). Mean of zeros = "0.0". Root cause: brand experiences have no star concept; the chip should not render for them.

### BUG 3 — require cycle
- `CuratedExperienceSwipeCard.tsx:21` (pre-fix) `import { CARD_FALLBACK_IMAGE, DECK_HERO_PLACEHOLDER_BLURHASH } from './SwipeableCards'` while `SwipeableCards.tsx:44` imports `CuratedExperienceSwipeCard` (it renders it). That bidirectional edge is the cycle Metro logged.

### BUG 4 — sheet open/close (candidate)
- NOT A BUG. DB probe (Supabase MCP): the experience event has exactly one `ticket_types` row — `Standard`, `price_cents=4500`, `currency=USD`, `available_online=true`, `is_hidden=false`, `is_disabled=false`, `deleted_at=null`. `usePublicEventTickets` returns it; `ExpandedBusinessEventSheet` renders `PublicEventPage` + `TicketCartSheet` with that ticket. EBES has NO early-return on `event_type` or empty tickets (`ExpandedBusinessEventSheet.tsx:439-496`); open/close is purely declarative `index={visible ? SHEET_INITIAL_INDEX : -1}` (`:447`), and `handleSheetChange` is a diagnostic-only `console.log` that NEVER calls `onClose` (`:209-211`). The logged `onChange index=1 then -1` is the diagnostic trace firing during the open animation / a test tap, not an auto-dismiss. No change made — per the dispatch ("If it actually works… document that with evidence and make no change").

---

## Old → New receipts

### app-mobile/src/components/deckHeroConstants.ts (NEW)
**Before:** did not exist; `CARD_FALLBACK_IMAGE` + `DECK_HERO_PLACEHOLDER_BLURHASH` lived in `SwipeableCards.tsx`.
**After:** leaf module (zero imports) exporting both constants — the single source of truth.
**Why:** BUG 3 — gives `CuratedExperienceSwipeCard` a cycle-free import target.
**Lines:** +22.

### app-mobile/src/components/SwipeableCards.tsx
**Before:** defined + `export const CARD_FALLBACK_IMAGE` / `DECK_HERO_PLACEHOLDER_BLURHASH` as literals.
**After:** imports both from `./deckHeroConstants` and re-exports them (`export { ... }`) for back-compat; no longer redefines the literals.
**Why:** BUG 3 — collapse the literals to the leaf module while keeping any historical `from './SwipeableCards'` importer working.
**Lines:** ~+8 / -11.

### app-mobile/src/components/CuratedExperienceSwipeCard.tsx
**Before:** imported the two constants from `./SwipeableCards`; computed price by summing `visibleStops[].priceMin/Max`; always rendered the rating star chip.
**After:** (a) imports constants from `./deckHeroConstants` (cycle broken); (b) adds `isBrandExperience = brandExperience != null`; for the experience variant reads `card.totalPriceMin/Max` (the envelope total) instead of summing stops — curated still sums; (c) wraps the rating `GlassBadge` in `isBrandExperience ? null : (...)`.
**Why:** BUG 1 (price), BUG 2 (rating), BUG 3 (cycle).
**Lines:** ~+30 / -8.

### app-mobile/src/components/__tests__/orch1065_experience_card_defects.test.tsx (NEW)
**Before:** none.
**After:** 8 Deno text-grep regressions locking BUG-1/2/3 fixes (source-as-text, the established app-mobile pattern). `fails-on-revert` proven.
**Lines:** +135.

---

## Cross-surface impact (Step 3.5)
- **Consumer iOS / Android** (`app-mobile/`): AFFECTED — the experience deck card now shows the all-in price, hides the rating chip, and no longer logs a require cycle. Parity is AUTOMATIC (shared component, shared StyleSheet, no platform branches in the changed code).
- **Buyer/anon Web, Business iOS/Android, Admin Web, Business Web preview**: UNAFFECTED — these surfaces do not render `CuratedExperienceSwipeCard`; the constants module + the experience deck card are consumer-app-only.

## Curated-card byte-safety (SC-13)
- The price branch and rating gate are BOTH keyed on `isBrandExperience` (= `brandExperience != null`). Curated callers pass no `brandExperience` prop → `isBrandExperience=false` → price sums stops exactly as before, rating chip renders exactly as before. `entryIndex` values are unchanged (no renumbering), so curated stagger timing is identical. The locked tests `orch1065_experience_adversarial.test.tsx` T-13-adv ("curated render branch passes NO brandExperience / ctaOverride", "brand chip + Book gated on optional props") still PASS (35/35).

## ORCH-1065 behavior preserved
- Front-load, supply, COMMS-0018 bypass, and the experience converter are untouched. BUG-4 confirms the COMMS-0014/0016 single-money-path (`ticket-checkout-create` via `experienceRecToBusinessEventCard` → EBES) is intact and unchanged.

---

## Regression Test
- **Path:** `app-mobile/src/components/__tests__/orch1065_experience_card_defects.test.tsx` (NEW — append-only safe; no locked test modified).
- **Pass:** `deno test --allow-read … → ok | 8 passed | 0 failed`. Full ORCH-1065 suite (27 locked + 8 new) `ok | 35 passed | 0 failed`.
- **fails-on-revert verified at commit `903332005`** (pre-fix HEAD): with the two production files stashed, the new test reports `FAILED | 3 passed | 5 failed` — BUG-1 (×2), BUG-2 (×1), BUG-3 (×2) assertions fail. Fix restored via `git stash pop` → `8 passed` again.
- No locked/append-only test was modified → no `[TEST-MOD-APPROVED]` token required.

## Gates
- `tsc --noEmit`: ZERO errors in the 3 touched production files. (Remaining tsc output is pre-existing: `packages/phone-input` types + `.test.ts[x]` Deno-global files — neither introduced by this change.)
- Strict-grep ORCH-0863 **C7 `no-new-backend-files`: PASS** ("zero touches under supabase/migrations/ or supabase/functions/"). Adjacent gates `i-bottomsheet-inline-scroll-binding`, `orch-0885-a-no-bottomnav-on-wide-desktop` exit 0.
- No backend touch → no Deno edge gate, no migration, no deploy.

## Require-cycle proof
- `grep` both directions: `CuratedExperienceSwipeCard → SwipeableCards` edge = NONE; only `SwipeableCards → CuratedExperienceSwipeCard` remains (one-directional). `deckHeroConstants.ts` imports nothing. Cycle eliminated.

## Discoveries for orchestrator
- None. (BUG-4 resolved as not-a-bug with DB evidence; no side issues found.)
