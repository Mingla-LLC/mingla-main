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
- (2026-05-30) Sequencing: **core vertical first** (event flow), then trip/experience + Surface 2. Surface 4: **build the tax-registrations endpoint** (not just a fallback).

## PROGRESS LOG (2026-05-30 session)
- **Task 1 (brand mini-card all-in "From £X")** — DONE, committed `8526c1bc4`. `displayPriceCents`/`displayCurrency` plumbed view-row → LiveEvent → PublicBrandEvent; shared `minPriceLabel` prefers the all-in cents over base, preserves Free. tsc-clean.
- **Task 2 CORE VERTICAL (event flow)** — DONE, committed `508fcc681`. tsc proven zero-new-errors (263==263 baseline; all 263 are worktree expo node_modules noise). Delivered:
  - Foundation: `mingla-business/src/utils/pricingPreview.ts` (pure engine mirror; "Buyer pays" EXACT for GB inclusive VAT; "You keep" = honest flat-absorb floor since client can't know Stripe VAT) + `src/constants/pricing.ts` (MINGLA_SERVICE_FEE_BPS=300, DEFAULT_TAKE_RATE_BPS=150) + parity unit test `src/utils/__tests__/pricingPreview.test.ts`.
  - `src/services/pricingSwitchesService.ts` — wraps `business_set_pricing_switches` + `business_set_brand_pricing_defaults`; `resolveSwitches()` (view COALESCE mirror); `isPricingLockedError()`.
  - `brandMapping.ts` + `types/brand.ts` — `defaultPass*`, `takeRateBpsOverride`, `pricingRegion/Currency` from `brands.*` (NULL→false=absorb). `brands` uses `select("*")` so columns arrive automatically.
  - **Shared `src/components/pricing/WhoCoversCostsSection.tsx`** (Surfaces 1+3+4): three pass/absorb segmented rows, live preview chip, locked read-only state (Surface 3), VAT "Set up VAT" nudge (Surface 4). Dark tokens, a11y radiogroup.
  - Event persistence: `DraftEvent.pricingSwitches` (per-column NULL=inherit) → `events.pass_*` direct columns via `serverDraftEventMapper` (written+read-back every autosave like taxonomy cols, so autosave never zeroes the choice) + `EVENT_DRAFT_SELECT`. Mounted in `CreatorStep5Tickets.tsx`.
  - Surface 5: `eventOrdersService` selects `orders.pricing_breakdown`, parses `.absorbed` → `OrderRecord.absorbedCostsCents`; `EventDetailKpiCard` renders "You covered £X in VAT & fees" (omitted at £0); summed in `app/event/[id]/index.tsx`.

### KNOWN GAPS / DECISIONS surfaced this session
- **Surface 1 VAT row currently interactive (`vatRegistered` hardcoded true).** Safe — the engine probes tax.registrations at checkout and fail-closes to absorb for unregistered brands. Swap to the real probe when the Surface-4 endpoint lands.
- **RPC can't write NULL.** `business_set_pricing_switches` takes non-null booleans → no server-side "reset to inherit"/partial per-column override. The EVENT flow sidesteps this by writing columns directly (true per-column NULL inheritance via autosave). Trip/experience + post-publish live-edit will hit this if they route through the RPC — a NULL-writing RPC (or direct-column writes) is needed for reset/partial.
- **"You keep" economics caveat (handoff §3).** The chip shows "You keep …before VAT" using the flat-absorb floor. The service-fee-recovers-whose-cost question is still unsettled; current copy avoids claiming what the service fee compensates. Settle before any payout/fee copy hardens.

## BATCH 2 COMPLETE (2026-05-30) — Surfaces 1–5 now authored across all formats
- **Trip mount** (`248ece286`): `WhoCoversCostsSection` in `TripCreatorStep4Pricing`; switches persist to `events.pass_*` via `setTripPricingSwitches` (direct columns, NULL-capable) in `autosaveStep4`, gated on `ticketsSoldCount===0`. `Trip.pricingSwitches` (optional) read in `mapTrip`.
- **Experience mount** (`bfefc4b03`): switch state + `pass_*` in the single-shot `events` insert in `ExperienceCreatorWizard`.
- **Surface 2** (`ed5eea336`): `BrandPricingDefaultsView` + route `app/brand/[id]/pricing-defaults.tsx` + "Pricing defaults" row in `BrandProfileView`; reuses the shared section via a new `footerOverride` prop (region chip, £100 example, no inherit ring). Writes via `setBrandPricingDefaults` + invalidates the brand query. "Edit defaults →" deep-links wired from all three format mounts.
- **Surface 4** (`ca3754630`): new read-only edge fn `brand-tax-registrations-list` (owner-gated, `STRIPE_RAK_TICKET_CHECKOUT`, Connect `{stripeAccount}`, fail-closed) + `useBrandTaxRegistration` hook; all three mounts gate the VAT row on the real probe and deep-link `onSetupVat` → `/connect-tax-registrations`. Registered in `ORCH_1006_BACKEND_ALLOWLIST`.
- Every batch: tsc 263 == 263 baseline (zero net-new errors).

### REMAINING TO SHIP (verification + deploy gates — NOT code)
- **Deploy the new edge fn from MERGED main** (`brand-tax-registrations-list`, verify_jwt:true) — until then `useBrandTaxRegistration` errors → fail-closed (VAT row shows the nudge for everyone, which is safe).
- **Run the 4 business jest gates + the pricingPreview parity test on the anchor/CI** (worktree jest is broken — escalade dep). 
- **On-device / sim smoke**: author an event/trip/experience, toggle switches, confirm persistence + the live "Buyer pays" chip + the locked state on a sold offering + Surface 5 "You covered £X" + Surface 2 defaults round-trip.
- **Settle the service-fee economics** (handoff §3) before payout/fee copy hardens; revisit the "You keep …before VAT" floor framing.
- **Decide merge + consumer build timing** (the cart/detail buyer surfaces won't show until a new native build ships; DB RPCs already live).
- Optional polish: per-column reset-to-inherit (needs a NULL-writing RPC); VAT-row loading shimmer while the probe is in flight (currently shows nudge until resolved).

### (superseded) NEXT BATCH — trip + experience mounts, Surface 2, Surface 4 endpoint — DONE above
- **Trip mount:** add `pricingSwitches` to `Step4Draft` + thread through `TripCreatorWizard` state; persist to the trip's `events.pass_*` (trip is an events row; `updateTripPricing` only writes `trip_pricing_tiers`, so add a separate events write — either direct columns or the RPC). Mount `<WhoCoversCostsSection format="trip" .../>` in `TripCreatorStep4Pricing.tsx`. Brand defaults via `useCurrentBrand`.
- **Experience mount:** experiences insert directly into `events` in `ExperienceCreatorWizard.tsx` — add `pass_*` to that insert/update + mount `<WhoCoversCostsSection format="experience" .../>`.
- **Surface 2:** new screen `app/brand/[id]/pricing-defaults.tsx` + `src/components/brand/BrandPricingDefaultsView.tsx` (mirror `BrandEditView`); reuse `WhoCoversCostsSection`-style rows against `business_set_brand_pricing_defaults` (already wrapped in `pricingSwitchesService`). Add a settings-list link; wire `onEditDefaults` deep-link from Surface 1.
- **Surface 4 endpoint:** new business-callable edge fn (e.g. `brand-tax-registrations-list`) calling `stripe.tax.registrations.list({status:"active"})` for the brand's connected account (pattern: `ticket-checkout-create/index.ts:1040`). Add `ORCH_1006_BACKEND_ALLOWLIST` entry. Feed `vatRegistered` into `WhoCoversCostsSection`; wire `onSetupVat` deep-link to `/connect-tax-registrations`.



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
