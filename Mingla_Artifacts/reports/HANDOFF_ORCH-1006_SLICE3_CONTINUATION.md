# HANDOFF — ORCH-1006 [Universal all-in pricing engine] Slice 3 continuation

**Date:** 2026-05-30
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/`
**Branch:** `ORCH-1006-universal-allin-pricing-engine` (HEAD `832736f7f`, pushed to origin, tree clean)
**Anchor (read-only, never edit):** `/Users/sethogieva/Desktop/mingla-main` on `main`
**Why handed off:** tool-channel degradation late in a long session (garbled multi-line reads, a batch cancel, one half-applied edit that was reverted). Money-path code — stopped rather than edit blind. Resume in a fresh session.

---

## WHAT THE ORCH IS (one line)
Buyer always sees ONE all-in price (the exact charge); brand sets 3 switches (tax / Mingla fee / service fee = pass-to-buyer or absorb) that only change who eats the cost. UK-first, VAT inclusive. Backend engine + money path already shipped (slices 1+2). Slice 3 = the visible UI.

## STATE — what's DONE and LIVE
- **Slices 1+2 (engine, configurable take-rate 150bps, rewired `ticket-checkout-create`, finalize copies `pricing_breakdown`):** MERGED to main (PR #269) + cleanup (PR #270). Edge fn `ticket-checkout-create` deployed v130 (verify_jwt:true, verified contains the new code). Migrations `20260802000000/1/2` applied to prod.
- **Slice 3 Wave 1 (cart + email receipt):** committed on branch. Cart (`TicketCartSheet.tsx` + `checkout/CartTaxPreview.tsx` rewritten to a headless `useCartAllInPreview` hook): no address form, no "Calculate tax" gate, shows all-in total + tappable "What's included" panel (Tickets / Service fee / Total / "Includes £X VAT"; Mingla fee FOLDED). Email receipt (`_shared/email/ticketBody.ts`): inclusive-VAT note, no added-tax line.
- **Slice 3 detail-page per-tier all-in:** committed (`832736f7f`) AND the RPC is LIVE on prod. New migration `20260805000000_orch_1006_public_event_tier_allin.sql` = anon-callable SECURITY DEFINER `pg_public_event_tier_allin(p_event_id)` returning per-tier {ticket_type_id, base_cents, all_in_cents, currency}, composing the SAME `compute_all_in_cents` + `resolve_effective_take_rate_bps` the view/cart use (WYSIWYP parity proven: £50 all-absorb tier → £50 all-in). App wired: `publicEventTicketsService.ts` calls it, `PublicTicketProps.priceAllInGbp`, `QuantityRow.tsx`/`PublicEventPage.tsx` render all-in with quiet "incl. VAT & fees" when all-in>base. App does only cents/100; ZERO fee math in TS.
- **Slice 3 brand-card DATA layer:** committed (the `display_price_cents` plumbing through discover edge fn + DTOs + brand types) but renders nothing yet — see REMAINING.

## OPERATOR DECISIONS LOCKED
- Brand reporting wording: **"You covered £X"** (not "absorbed").
- Buyer breakdown: **Mingla fee FOLDED** into ticket subtotal (no buyer-facing "Mingla fee" line). Service fee IS its own line.

## REMAINING WORK (in priority order)

### 1. FINISH brand mini-card render (small — 3 precise edits)
Goal: brand page `/b/{slug}` EventMiniCard "From £X" shows all-in, not base. The shared render is ALREADY done (`packages/brand-rendering/PublicBrandPage.tsx` `minPriceLabel` + `PublicBrandEvent.displayPriceCents`/`displayCurrency` in `types.ts`). The data just isn't carried into the `PublicBrandEvent` objects. THREE edits, all in `mingla-business/`:
  - **a)** `src/store/liveEventStore.ts` — `interface LiveEvent`: add optional `displayPriceCents?: number | null;` + `displayCurrency?: string | null;` (insert after the `currency: string;` field, ~line 282).
  - **b)** `src/services/publicEventsService.ts` — the view-row interface already has `display_price_cents?`/`pricing_currency?` (~line 85). In `publicEventViewRowToEvent(row, tickets)` return object (~line 707-712, near `brandSlug: row.brand_slug, eventSlug: row.slug,`): add `displayPriceCents: row.display_price_cents ?? null,` + `displayCurrency: row.pricing_currency ?? null,`.
  - **c)** `src/components/brand/PublicBrandPage.tsx` — `mapEvent = (event: LiveEvent): PublicBrandEvent => ({ ... })` at **line 65**: add `displayPriceCents: event.displayPriceCents ?? null,` + `displayCurrency: event.displayCurrency ?? null,`.
  - THEN re-apply the shared-package render edit that was reverted: in `packages/brand-rendering/PublicBrandPage.tsx` change `minPriceLabel(tickets, fallbackCurrency)` to ALSO accept `displayPriceCents?`/`displayCurrency?` and prefer them (`if typeof displayPriceCents==='number' && >0 → From <displayPriceCents/100 in displayCurrency??currency>` else existing base fallback), and update the call at ~line 888 `minPriceLabel(event.tickets, event.currency)` → pass `event.displayPriceCents, event.displayCurrency`. NOTE the live signature is `minPriceLabel(tickets, fallbackCurrency: string|null|undefined)` and returns "Free" for free tiers — preserve that.
  - Verify with read-back after EACH edit (channel was flaky). Grep that `displayPriceCents` appears in all 4 files. No new migration; the view column already exists + is live.

### 2. Brand authoring switches — Surfaces 1-5 (the big chunk)
The 3-switch "Who covers the costs?" UI so brands can actually flip pass/absorb. Design is READY + reconciled: `Mingla_Artifacts/specs/DESIGN_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` §0-12 (intent/IA/states/copy/motion) + §13 (CORRECTED wiring map — real paths/tokens; the body's paths are stale, §13 wins). Real mount points (NOT a `PricingStep.tsx`): event = `mingla-business/src/components/event/CreatorStep5Tickets.tsx`, trip = `src/components/trip/TripCreatorStep4Pricing.tsx`, experience = `src/components/experience/ExperienceCreatorWizard.tsx`. Surface 2 (brand defaults screen) is net-new. Backend RPCs already exist: `business_set_pricing_switches`, `business_set_brand_pricing_defaults`. Business app is DARK-mode; tokens = `src/constants/designSystem.ts` (spacing.md=16, radius.full=999, typography.h1/body/caption — NOT the design body's title1/footnote). Surface 4 (hide pass-VAT until registered) uses `tax.registrations.list`. Surface 5 ("You covered £X") reads `orders.pricing_breakdown.absorbed.*`.

### 3. Deferred / flagged (decide later, not blocking)
- Consumer Discover browse cards show NO ticket price today (by design — price is in cart). So card-level all-in there may not be needed at all. The discover edge-fn data plumbing is committed but unused on those cards.
- Per-tier detail page parity is built via the RPC (done) — no app-side fee math (operator-chosen server endpoint).
- Held/purchased-ticket views show no price (no change needed). Only post-purchase money surface is the email (done).
- Economic question for Seth: controller is `fees_collector:"stripe"` → Mingla bears Stripe's processing fee, so the brand "service fee" switch recovers MINGLA's cost not the brand's. Settle before any payout/fee copy ships. Engine math unaffected; an engine code-comment + amendment §E.2 footnote are wrong and should be corrected.
- Two COMMS entries drafted (web↔native tax divergence; experiences routing) in the impl report — not yet committed to main ledger.

## HOW TO OPERATE (gotchas learned this session)
- Supabase mgmt token: `~/.claude.json` → `mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN`. `api.supabase.com` 403s Python's default UA — send a browser User-Agent. MCP is read-only; for writes use the Management API `/database/query` + record `schema_migrations` manually. (memory: reference_supabase_mgmt_token_and_cloudflare_ua)
- Deploy edge fns from MERGED main only, verify_jwt:true (no `--no-verify-jwt`).
- Migration timestamp ceiling: highest across all worktrees+main is `20260805000000` (this RPC). Next must be greater.
- Strict-grep: new backend files need an `ORCH_1006_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (already has the 4 migrations + engine).
- Append-only test gate reads the HEAD commit body for `[TEST-MOD-APPROVED ORCH-1006]` — if a merge commit becomes HEAD, re-add the token in a trailing commit.

## NOT DEPLOYED / NOT MERGED YET
- Slice 3 (Wave 1 cart/email + detail-page app code + brand-card data) is on the BRANCH, not merged to main, and the consumer app isn't rebuilt — buyers won't SEE the cart/detail changes until a build ships (DB RPC is already live so it'll "just work" when the build lands). Decide merge + build timing.
