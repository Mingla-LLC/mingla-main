# SPEC — META-ORCH-1174 Leg B — Multi-Tier Reservation Packages for Trips

**Status:** DRAFT (forensic spec, awaiting Seth product decisions in §D + Leg A landing)
**Author:** mingla-forensics
**Date:** 2026-06-20
**Anchor:** `/Users/sethogieva/Desktop/mingla-main` (current code)
**Depends on:** Leg A (public-trip-page standardization into `packages/offering-rendering`) — see §0.

---

## 0. CRITICAL PRECONDITION — Leg A has NOT landed yet

The dispatch references `packages/offering-rendering/TripOfferingBody.tsx` and `useTripOfferingState.ts` as the Leg A seam. **Those files DO NOT EXIST in the current tree.** Leg A (public-trip-page standardization) is still mid-convergence — `COMMS-0041` announced a research/coordination hold to converge on `packages/offering-rendering` (commit `477675023`). The package today contains only shared chrome (`ParallaxCoverShell.tsx`, `OfferingChrome.tsx`, `RsvpMomentumDecision.tsx`, etc.), no `TripOfferingBody`.

The **current** public trip page is:
- Business-web: `mingla-business/src/components/trip/TripPreview.tsx` (dumb container) + route `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (owns all state/price) + `mingla-business/src/components/trip/TripReserveBar.tsx` (pure display).
- Consumer-app: `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` + `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx`.

**Sequencing decision (DEC-1174-A, §D):** Leg B targets the CURRENT files and the Leg A team promotes them, OR Leg B waits for Leg A and targets `TripOfferingBody.tsx`. Recommended: **Leg B waits for Leg A to land the §10 vertical-list slot + `useTripOfferingState.selectedTier` seam**, then drops N rows into the already-built slot. This spec describes the seam in current-code terms so it survives the promotion.

---

## A. CURRENT MODEL (file:line)

### A.1 The tiers table — `trip_pricing_tiers` (already N-capable)

`supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql:84-97`

```sql
CREATE TABLE public.trip_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  tier_name text NOT NULL CHECK (length(trim(tier_name)) > 0),
  tier_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- idx_trip_pricing_tiers_event          (non-unique on event_id)        :96
-- idx_trip_pricing_tiers_event_ticket   UNIQUE(event_id, ticket_type_id) :97
```

- A "tier" = one `trip_pricing_tiers` row joined 1:1 to one `ticket_types` row (the money/inventory carrier: `price_cents`, `currency`, `quantity_total`, `is_unlimited`, `is_free`).
- **The unique index is `(event_id, ticket_type_id)` — it explicitly PERMITS N tiers per `event_id`.** There is NO `UNIQUE(event_id)`, no CHECK, no exclusion constraint forcing one tier.
- `tier_metadata.installments` shape (`mingla-business/src/services/tripsService.ts:105-113`, `TripInstallmentScheduleData`):
  ```
  { deposit_pct: number,
    installments: [ { ordinal, pct, days_after_booking?, fixed_date? }, ... ] }
  ```
  Authoring lives ONLY in `tier_metadata.installments` (per-tier). The runtime ledger is a separate `order_installments` table (`supabase/migrations/20260610000000_tr3_installments.sql:31-61`), keyed per-order, not the authoring shape.

### A.2 WHERE the single-tier ("Tr2") rule is enforced — SERVICE + UI ONLY, never DB/RPC

**Definitive answer: the single-tier limit is NOT a DB constraint and NOT a publish-RPC assertion. It is enforced ONLY by the service-layer create/read assumptions and the UI.**

| Layer | Enforces single tier? | Evidence |
|---|---|---|
| DB constraint | **NO** — allows N | `20260608000000_orch_0859_trip_sidecar_tables.sql:96-97` (only `UNIQUE(event_id, ticket_type_id)`) |
| Publish RPC `business_publish_trip_draft` | **NO** — asserts `>= 1` | `20260725000000_orch_0950_trip_capacity_single_source.sql:739-743` raises `trip_pricing_tier_required` only when `count = 0` |
| Read hook `usePublicTripBySlug` | **NO** — returns ARRAY | `mingla-business/src/hooks/usePublicTripBySlug.ts:225` (`select("*")` all tiers), `:358-392` (maps all). But `:418` `isPaid` inspects only `pricingTiers[0]`. |
| List RPC `pg_published_trips_public` | **NO** — aggregates N | `20260803000001_orch_1016_pg_published_trips_public.sql:100-128` (`SUM(quantity_total)`, `MIN(price)`) |
| Service `createTripDraft` | de-facto (writes exactly 1) | `tripsService.ts:633-665` (one `ticket_types` + one `trip_pricing_tiers` insert, no loop) |
| Service `updateTripPricing` | **runtime choke point** — `.maybeSingle()` throws on >1 | `tripsService.ts:1038-1048` |
| Migration data-probe (ORCH-0950) | one-shot pre-migration check `<> 1`, NOT persistent | `20260725000000_...:739-743` for new; `...000002:18-49` for existing |
| Wizard UI | hard single — no add/remove tier affordance | `TripCreatorStep4Pricing.tsx:42-74` (`Step4Draft` single), `:147` ("Single full-price tier") |
| Capacity writer (live edit) | single-tier — `LIMIT 1` | `20260725000000_...:233-239` (capacity→`quantity_total` joins tiers `LIMIT 1`) |

**Bottom line: there is NO DB or RPC barrier to multiple tiers.** The blockers are purely authoring-layer (wizard UI, `createTripDraft`, `updateTripPricing` `.maybeSingle()`, `pricingTiers[0]` consumers) plus the public selector + the live-edit capacity `LIMIT 1` writer.

### A.3 The checkout engine ALREADY supports N tiers + per-tier qty — EVENTS PROVE IT ✅✅✅

**THIS IS THE SINGLE BIGGEST SCOPE DETERMINANT. The reserve/cart/checkout engine is natively multi-line, end to end, because standard EVENTS already do multi-tier checkout through the identical path. Trips ride the same engine.**

| Layer | Multi-tier today? | Proof |
|---|---|---|
| Cart sheet UI | **YES** | `app-mobile/src/components/expandedCard/TicketCartSheet.tsx:581-609` (maps `visibleTickets` → one `QuantityRow` stepper per tier), `:307-322` (Σ base + Σ all-in across lines) |
| Cart model | **YES** | `app-mobile/src/hooks/useTicketCart.ts:54-79` (`CartLine[]` reducer, independent per-`ticketTypeId` lines), `:88-92` (Σ totals) |
| Outbound payload | **YES** (array) | `TicketCartSheet.tsx:156-157` (`lines: Array<{ticketTypeId, quantity}>`), `:429-436` (emits all lines qty>0) |
| Edge fn `ticket-checkout-create` | **YES** (array) | `supabase/functions/ticket-checkout-create/index.ts:52` (`CheckoutLine`), `:227-229` (parses `body.lines[]`), `:489-504` (`p_lines: lines`) |
| Session RPC `biz_ticket_checkout_create_session` | **YES** (loops lines) | `20260610000002_tr3_ticket_checkout_session_installment_aware.sql:186-260` (`FOR v_line IN jsonb_array_elements(p_lines) LOOP`, per-line capacity + currency checks) |
| Finalize RPC | **YES** (per-line) | same migration `:638-679` (per-line `order_line_items` + per-quantity ticket minting) |
| Per-tier remaining-capacity RPC `pg_public_ticket_types_remaining` | **YES — already per-tier** | `20260724000006_orch_0946_public_ticket_types_remaining.sql:19-49` (`RETURNS TABLE(ticket_type_id, sold, remaining)`, one row per ticket_type) |
| **Installments** | **SINGLE-LINE ONLY** ⚠️ | `20260610000002_...:276-278` (`IF v_line_count > 1 THEN RAISE EXCEPTION 'ticket_lines_mixed_with_installments'`) |

**Events, trips, and experiences are the IDENTICAL engine path** — all three mount the same `TicketCartSheet` and call the same `useNativeCheckoutFlow()` → `runNativeCheckout({ lines })`:
- Events: `ExpandedBusinessEventSheet.tsx:275` (hook), `:313-345` (`handleBuy` forwards `payload.lines`), `:664` (cart mount).
- Trips: `ConsumerTripDetailScreen.tsx:325` (same hook), `:529` (same call), `:1505` (same cart). ORCH-1138 comments at `:116`,`:459-460` confirm "Reserve opens the cart DIRECTLY" and "single-tier trips just use tiers[0]" — trips are **artificially seeded to one tier**, not engine-limited.

**The ONLY engine-level restriction is the installments single-line guard** (`ticket_lines_mixed_with_installments`). A multi-package trip whose tiers carry payment plans cannot mix tiers in one cart today. See §B.6.

### A.4 Authoring (wizard + edit-published) — single-package, but edit is already clobber-safe

**Wizard** `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`:
- Authors exactly ONE tier. `Step4Draft` state (`:42-74`): `tierName`, `priceMajor`, `currency` (read-only mirror), `capacity` (read-only mirror from Step 1), `paymentPlan` (`TripInstallmentSchedule | null`), `pricingSwitches` (pass/absorb tax/fee/service). Zero notion of multiple packages. Header: "Single full-price tier in this milestone." (`:147`).
- Price field becomes read-only when sold (`:112` `priceLocked = editMode.soldCountForTier > 0`, `:167-170`).

**Service** `mingla-business/src/services/tripsService.ts`:
- `createTripDraft` (`:633-665`) — one `ticket_types` insert ("Standard", price 0, qty 1) + one `trip_pricing_tiers` insert.
- `updateTripPricing` (`:1015-1105`) — `.maybeSingle()` (`:1038-1042`, **throws on >1 rows**), updates that one row's `ticket_types` (price/currency/qty, `:1051-1063`) + `trip_pricing_tiers` (tier_name + `tier_metadata.installments`, `:1090-1095`; null strips the installments key → single-payment).
- `mapTrip` capacity read is first-tier-only (`:492` `ticketTypes[0]`).

**Edit-published** `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`:
- Routes through `buildLiveTripPatch` (`:305-562`) → `biz_update_live_trip` RPC; never direct table writes (audit invariant `:37-39`).
- Builds a **single-element** `pricing_tiers` patch keyed on `firstTier.ticketTypeId` (`:458-489`, comment "single-tier model"), emitting only changed sub-fields.
- **NO clobber: pricing path is pure UPDATE-in-place** (unlike `upsertTripDays`/`upsertTripInclusions` which DELETE-then-INSERT, `tripsService.ts:945-1010`).

**`biz_update_live_trip` RPC** (current authoritative = `20260929000000_orch_1120_trip_settings_refund_deadline.sql`):
- §5d apply loop `:636-653` — `FOR each patch tier → UPDATE trip_pricing_tiers ... ; UPDATE ticket_types SET price_cents ...`. **No INSERT branch, no DELETE.** Sold tickets (FK to `ticket_types.id`) are never orphaned.
- §4e refund-gate `:386-401` (orig `20260616000000_orch_0876_trip_published_edit.sql:317-352`):
  - `tier_delete_with_sales` (`:392`) — a tier absent from the patch WITH sales → **reject**. (The removal-guard already exists — this is the ORCH-1172 no-clobber protection, pre-wired for trips.)
  - `tier_price_change_with_sales` (`:401`) — price change on a sold tier → **reject**.
- §4a capacity writer `:233-256` (ORCH-0950) — capacity → `ticket_types.quantity_total`, but the tier lookup is `LIMIT 1` (single-tier assumption). Guard `capacity_below_sold` (`:220`) rejects dropping below sold.

### A.5 Per-package capacity

Today: trip capacity is a single number stored canonically in `ticket_types.quantity_total` of the sole tier (ORCH-0950 single-source, `20260725000000_...` header + backfill `:83-96`, strips legacy `theme.business_trip.capacity` `:99-110`). Remaining is computed per-tier already by `pg_public_ticket_types_remaining` (§A.3). Events already model per-ticket-type capacity via each type's own `quantity_total` — **trips reuse the exact same column.** So per-package capacity is a natural extension: each tier's `ticket_types.quantity_total` is its own cap.

---

## B. THE GAP — exactly what must change to support multi-package

The DB schema, checkout engine, per-tier remaining RPC, and edit-RPC refund-gates ALREADY support N tiers. The gap is concentrated in **authoring + the public selector**, plus two single-tier choke points in the live-edit RPC and one engine guard for installments.

### B.1 Lift the single-tier rule (service-layer + UI only — no DB change)
- `createTripDraft` (`tripsService.ts:633-665`): allow seeding 1..N tiers (or seed 1 and let edit add more).
- `updateTripPricing` (`tripsService.ts:1038-1048`): replace `.maybeSingle()`-throws-on->1 with a per-tier upsert/insert/soft-remove loop keyed on `ticketTypeId`.
- `mapTrip` capacity (`:492`) + all `pricingTiers[0]`/`ticketTypes[0]` consumers (`usePublicTripBySlug.ts:418` `isPaid`; `EditPublishedTripScreen.tsx:222,463`): make tier-aware.
- **No migration required for the limit itself** — the DB already permits N.

### B.2 Wizard multi-package authoring
- `TripCreatorStep4Pricing.tsx` (whole component): replace single `Step4Draft` with a tier array + add/remove/reorder rows; per-row name, price, capacity (now per-tier, NOT a read-only Step-1 mirror), optional per-tier description, optional per-tier payment plan. `editMode.soldCountForTier` (`:89-91`) → per-tier `soldCountByTier`.
- Decide: per-package capacity authored here vs. shared trip capacity allocated (DEC-1174-D).

### B.3 Public §10 multi-option selector + qty + live summed all-in
The §10 "Choose how you pay" box is single-tier by construction on BOTH surfaces. **No `selectedTier` state exists today** — selection + qty is net-new. Both reserve bars are PURE display of `cta.price` — so summing is a route-level change, the bars need no change.

- **Business-web seam:** §10 slot is `paymentBlock` (built `app/t/[brandSlug]/[tripSlug].tsx:449-458`, slotted into the "Choose how you pay" section `TripPreview.tsx:662-670`). Render N selectable tier rows + per-tier `QuantityRow` here. Bar price: replace `barPrice` derivation (`[tripSlug].tsx:319-325`, currently `From {base}`) with the summed all-in. `formatTripPrice` (`:585-595`) explicitly "never recomputes fees" — **trip pages display BASE price today, not all-in** (the all-in only enters AFTER Reserve, inside `TicketCartSheet`). Wiring all-in is part of Leg B even for the single-tier case.
- **Consumer-app seam:** §10 block `ConsumerTripDetailScreen.tsx:1035-1228` (title `:1064`). Today gated on single `planTier` (`:452-455`). Bar price `barPriceLabel` (`:1242-1249`) is `From {detail.minPriceCents}` (base, min). `detail.tiers[].priceAllInGbp` is already populated per-tier by `publicEventTicketsService.ts:84-120` → sum it.
- **Reuse, don't rebuild, the sum math:** `TicketCartSheet.tsx:301-330` + `useTicketCart.ts:88-102` already compute Σ(per-tier all-in × qty). Leg B lifts that pattern into §10; the cart stays as the post-Reserve confirmation step.

### B.4 Per-package capacity / remaining
- Per-tier remaining already returned by `pg_public_ticket_types_remaining` (`20260724000006_...:19-49`). The public hook already surfaces `ticketsRemaining` per tier (`usePublicTripBySlug.ts:385-387`). Render per-row "X spots left" / sold-out from these.
- **Live-edit capacity writer must change:** `biz_update_live_trip` §4a `LIMIT 1` (`20260725000000_...:233-239`) → per-tier `quantity_total` write. Keep `capacity_below_sold` guard per-tier.

### B.5 Edit-published no-clobber (ORCH-1172 lessons)
- Pricing edit is already UPDATE-in-place (no clobber) and the refund-gates `tier_delete_with_sales` + `tier_price_change_with_sales` already protect sold inventory. **What's missing for multi-tier:**
  1. An **INSERT branch** in §5d apply loop (`20260929000000_...:636-653`) for genuinely-new tiers in the patch (today only UPDATE).
  2. Client `buildLiveTripPatch` (`EditPublishedTripScreen.tsx:458-489`) must emit a multi-element `pricing_tiers` array, not single.
  3. The §4e `tier_delete_with_sales` removal-guard already fires correctly once the client can omit a tier — no RPC change there, but verify it triggers on omission of a sold tier.
- Soft-delete vs hard-delete of a tier with NO sales: prefer soft (a `deleted_at` on `trip_pricing_tiers` / the tier's `ticket_types`, mirroring `ticket_types.deleted_at` already used by the remaining RPC `WHERE tt.deleted_at IS NULL`) to keep historical orders coherent.

### B.6 Cart/checkout — REUSES the events multi-tier engine (confirmed) — ONE exception
- N-tier trip checkout works through the existing engine UNCHANGED for pay-in-full: stop force-seeding `tiers[0]` (`ConsumerTripDetailScreen.tsx:463-472` `openCart`/`openCartWithChoice`), seed the cart with the user's selected lines instead.
- **The ONE engine change:** installments. `ticket_lines_mixed_with_installments` (`20260610000002_...:276-278`) hard-rejects a multi-line cart when any line maps to a tier with installments. For multi-package trips where a package offers a payment plan, EITHER (a) restrict payment-plan reservations to ONE package per cart (no engine change — just UX gating), OR (b) revisit the guard to allow per-line installment schedules (larger engine change, currency/schedule pinning complexity). **DEC-1174-F.**

---

## C. PROPOSED DESIGN (phased)

### Phase 0 — Leg A landing + seam confirmation (blocking)
Confirm Leg A's `TripOfferingBody.tsx` exposes `useTripOfferingState.selectedTier` + a §10 vertical-list slot rendering the sole tier. Leg B drops N rows + per-tier qty into that slot. If Leg A is not landing soon, Leg B targets the current `TripPreview.tsx` / `[tripSlug].tsx` / `ConsumerTripDetailScreen.tsx` directly and coordinates the promotion (DEC-1174-A).

### Phase 1 — Data + authoring (business-app)
1. `TripCreatorStep4Pricing.tsx`: tier-array UI (add/remove/reorder rows; per-row name, price, capacity, optional description, optional plan). Per-tier `soldCountByTier`.
2. `tripsService.createTripDraft` + `updateTripPricing`: per-tier upsert loop (drop `.maybeSingle()` throw).
3. `mapTrip` + edit-screen + `isPaid` consumers: tier-aware (no `[0]`).
4. `biz_update_live_trip` RPC migration: add INSERT branch (§5d) + per-tier capacity writer (§4a, kill `LIMIT 1`); keep refund-gates. Apply via Management API (CLI drift-wedged per memory).
5. Publish RPC `business_publish_trip_draft`: verify it validates an N-tier draft (it asserts `>= 1` today — fine; add max-tier cap if DEC-1174-E sets one).

### Phase 2 — Public selector + summed all-in (ALL surfaces — mandatory parity)
1. Business-web: §10 paymentBlock renders N tier rows + per-tier qty (`QuantityRow`), per-tier remaining badges; route computes Σ(all-in × qty) via `fetchTierAllInCents` (`publicEventsService.ts:840`) and feeds `barPrice`.
2. Consumer-app: §10 block (`ConsumerTripDetailScreen.tsx:1035-1228`) renders the same; sum `detail.tiers[].priceAllInGbp`; feed `barPriceLabel`. Stop seeding `tiers[0]` — seed cart with selected lines.
3. Buyer-web public page (deploys from main, NOT OTA — memory): same §10.
4. Reserve bars unchanged (pure display).

### Phase 3 — Installments policy for multi-package (DEC-1174-F)
Either gate payment-plan reservations to one package per cart (no engine change) or extend the engine for per-line schedules.

---

## D. PRODUCT DECISIONS FOR SETH (enumerated — crisp)

1. **DEC-1174-A — Sequencing vs Leg A.** Does Leg B WAIT for Leg A's `TripOfferingBody`/`useTripOfferingState` seam to land, then drop N rows in? Or proceed on current `TripPreview.tsx`/`ConsumerTripDetailScreen.tsx` and let Leg A promote? (Recommend: wait, to avoid double-promotion churn.)

2. **DEC-1174-B — Multiple packages in one reservation, or ONE package only?** Can a buyer add Standard ×1 + VIP ×2 in a single cart (true multi-line, exactly like event tickets)? Or is a trip reservation locked to ONE package (qty N of the same package)? (Engine already supports multi-line; the question is product intent. Multi-line is "free" except for the installments interaction in DEC-1174-F.)

3. **DEC-1174-C — Per-package quantity?** Within one package, can a buyer reserve qty > 1 (e.g. 3 VIP spots in one go), or strictly 1-per-reservation? (Events allow qty steppers; trips currently single-spot semantics.)

4. **DEC-1174-D — Per-package capacity vs shared trip capacity.** Does each package get its OWN capacity/spots (Standard: 20, VIP: 5)? Or is there ONE trip capacity (25) drawn down across packages (sell-through)? (Per-package is the natural fit — each tier's `ticket_types.quantity_total`. Shared-pool needs a new allocation model + cross-tier remaining math.)

5. **DEC-1174-E — Max packages per trip?** Hard cap (e.g. 3 = Standard/Premium/VIP, or up to N)? Affects wizard UI density + publish validation.

6. **DEC-1174-F — Installments: per-package or trip-wide, and the mixed-cart rule.** Can each package carry its OWN payment plan, or is the plan trip-wide? AND: if a buyer selects a payment-plan package, may they ALSO add other packages in the same cart? (Engine today hard-rejects `ticket_lines_mixed_with_installments`. Simplest: payment-plan reservations are single-package. Richer: per-line schedules = real engine work.)

7. **DEC-1174-G — Authoring UX: inline add-row vs separate screen?** In the wizard, are packages an inline add/remove list inside Step-4 pricing, or a dedicated "Packages" sub-screen? Per-package fields to expose: name, price, capacity, description, optional plan — confirm the set.

8. **DEC-1174-H — Edit-published tier add/remove policy.** After publish: may a brand ADD a new package to a live trip? REMOVE one (only if it has no sales — already enforced by `tier_delete_with_sales`)? Change a sold package's price (blocked by `tier_price_change_with_sales` — confirm we keep that)? Soft-delete vs hard-delete for a no-sales tier.

9. **DEC-1174-I — Mixed free + paid packages?** May a trip offer a free package alongside paid ones? (`isPaid` currently reads `pricingTiers[0]` only — needs per-tier logic; the cart/checkout already handles free vs paid per line.)

10. **DEC-1174-J — Display semantics.** With N packages, what does the floating bar show when nothing is selected — "From $X" (min all-in)? And once selected — the summed all-in? Confirm the empty-state and selected-state copy.

---

## E. GUARDS + INVARIANTS

- **I-PROPOSED-1174-NO-DB-SINGLE-TIER** — the limit was never a DB constraint; do NOT add one. Multi-tier is a service/UI lift.
- **I-PROPOSED-1174-EDIT-NO-CLOBBER** — pricing edit stays UPDATE-in-place + INSERT-for-new; NEVER DELETE-then-reinsert a sold tier. Keep `tier_delete_with_sales` + `tier_price_change_with_sales` + `capacity_below_sold` refund-gates ACTIVE. (Strict-grep gate: no DELETE on `trip_pricing_tiers`/tier `ticket_types` with sales in the live-edit path.)
- **I-PROPOSED-1174-CAPACITY-PER-TIER** — kill the `LIMIT 1` capacity writer (`20260725000000_...:233-239`); each tier's capacity = its own `ticket_types.quantity_total`. Remaining sourced from `pg_public_ticket_types_remaining` per tier — never recomputed in TS.
- **I-PROPOSED-1174-ALLIN-SERVER-SOURCED** — summed all-in = Σ(server `pg_public_event_tier_allin` per tier × qty); ZERO fee math in TS (extends ORCH-1147 invariant). The cart's existing Σ at `TicketCartSheet.tsx:301-330` is the reference.
- **I-PROPOSED-1174-SHARED-ENGINE** — trip multi-tier checkout reuses the events `lines[]` engine unchanged; no trip-specific checkout fork.
- **I-PROPOSED-1174-INSTALLMENT-CART-RULE** — until DEC-1174-F resolves richer plans, keep `ticket_lines_mixed_with_installments` and gate payment-plan reservations to single-package in the UI (don't let the user assemble an illegal cart).
- **PARITY (non-negotiable, per memory):** business iOS/Android + consumer app + buyer-web all match. Buyer-web deploys from main (NOT OTA-able); push an empty `[deploy]` commit to avoid the Vercel gate-cancel trap.

---

## F. TEST + ROLLOUT STRATEGY

**Tests:**
- DB/RPC: N-tier draft → publish succeeds; `updateTripPricing` writes/updates N tiers; `biz_update_live_trip` adds a new tier (INSERT branch) without touching sold tiers; per-tier capacity write; refund-gates still reject `tier_delete_with_sales`/`tier_price_change_with_sales`/`capacity_below_sold`. (Mirror the existing `__tests__/orch_0950_trip_capacity_canonical.test.ts` + `orch_1016_pg_published_trips_public.test.ts`.)
- Engine: multi-line trip cart sums correctly; checkout creates per-line order items + tickets (already covered for events — add a trip-specific N-tier fixture). Installment + multi-line → still rejected (`ticket_lines_mixed_with_installments`).
- Public selector: per-tier qty → summed all-in matches server; sold-out tier disabled; floating bar reflects sum on all surfaces.
- **Synthetic pass-fee fixture required** (per memory ORCH-1147 gotcha): 0/8 charges-enabled brands pass any fee → all-in tests on prod data prove nothing. Build a fixture brand that passes a fee so the summed all-in is provably > base.
- Edit-published clobber test: add tier → existing sold tier untouched; remove no-sales tier → ok; attempt remove sold tier → rejected.

**Rollout:**
1. Phase 1 (data+authoring) — business-app OTA (pure-JS where possible; native build only if needed).
2. RPC migration via Management API (CLI drift-wedged; `$function$;` before GRANT, DROP before widening RETURNS TABLE per migration-baseline CI). Deploy edge fns (if `ticket-checkout-create` touched for installments) from MERGED main, not worktree.
3. Phase 2 (public selector) — business+consumer OTA + buyer-web `[deploy]` from main.
4. Device-prove on iOS + Android (sim + physical) — multi-package select → reserve → cart → PaymentSheet → ticket minted per tier. (Note from memory: 0 trip reservations completed e2e on-device yet — this needs the real card tap.)

---

## G. RISK / BIGGEST UNKNOWN

**Biggest scope determinant (RESOLVED, favorable):** the checkout engine ALREADY does N tiers + per-tier qty in one reservation — events prove it in production (`TicketCartSheet` + `lines[]` payload + `FOR v_line LOOP` session/finalize RPCs). This collapses Leg B from "build a multi-tier checkout" to "lift the single-tier authoring rule + build the public selector + wire summed all-in." **Confirmed YES.**

**Biggest remaining UNKNOWN — installments × multi-package (DEC-1174-F).** The `ticket_lines_mixed_with_installments` guard is the ONLY real engine-level barrier. If Seth wants per-package payment plans AND multi-package carts simultaneously, that requires reworking the installment session math to support per-line schedules (currency/schedule pinning, deposit aggregation, `order_installments` per-line) — genuinely larger than the rest of Leg B combined. The cheap path (gate plans to single-package reservations) sidesteps all of it. Recommend defaulting to the cheap path unless Seth explicitly needs mixed plan carts.

**Secondary risks:**
- Leg A not landed → seam coordination churn (DEC-1174-A). Building on current files means a future promotion re-touches the same code.
- Trip pages display BASE price today, not all-in — wiring server all-in into §10 is itself net work even before multi-tier (the all-in only enters after Reserve in the cart today).
- Per-tier capacity authoring breaks the Step-1→Step-4 read-only capacity mirror; capacity ownership moves into Step-4 per package (DEC-1174-D).

---
## SETH-LOCKED DECISIONS (2026-06-20)
- **DEC-A:** Build on the SHIPPED Leg-A `TripOfferingBody`/`useTripOfferingState` + `pg_public_trip_by_slug` (they ARE on main; the forensics read a stale anchor). NOT TripPreview.
- **DEC-B = MULTIPLE packages in one reservation** (Standard×1 + VIP×2), cart sums all lines (event model).
- **DEC-C:** per-package quantity >1 allowed.
- **DEC-D:** per-package capacity (each package its own spots/remaining), like event ticket_types.
- **DEC-E:** soft cap (default 6 packages/trip; confirm in impl).
- **DEC-F = FULL multi-package installments** — lift the `ticket_lines_mixed_with_installments` engine guard + make per-line installment math work across multiple lines (the real engine work). An installment package CAN sit alongside others in one cart.
- **DEC-G:** inline add/remove package rows in the wizard pricing step; per-package fields: name, price, description, capacity, optional per-package installment terms.
- **DEC-H:** edit-published can add/remove/reprice packages, reusing existing refund-gates (tier_delete_with_sales / tier_price_change_with_sales / capacity_below_sold); add an INSERT branch + make the live-edit capacity writer per-tier (drop the LIMIT 1).
- **DEC-I:** mixed free + paid packages allowed.
- **DEC-J:** floating bar = "From $X" until a package is selected, then the summed all-in.
- **ALL-IN:** §10 shows server all-in upfront (wire fetchTierAllInCents/pg_public_event_tier_allin), matching the WYSIWYP all-in policy — today trips show base price.

## PHASING
- **B1 (engine foundation):** lift the single-tier service rule (tripsService) + the FULL multi-package installment engine (DB guard + per-line installment math in the checkout session/finalize RPCs + ticket-checkout-create edge fn) + confirm per-package capacity/remaining. Money-path; most careful.
- **B2:** wizard multi-package authoring (add/remove rows + per-package fields incl. installments).
- **B3:** public §10 multi-option selector (N rows + per-package qty + multi-select) + summed server all-in + cart wiring + floating bar.
- **B4:** edit-published multi-tier (INSERT branch + per-tier capacity writer).
