# INVESTIGATION — ORCH-1138 [trip-page-redesign] · Reserve opens a SECOND detail sheet instead of the cart

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign` (HEAD `9e220c58f`)
- **Mode:** INVESTIGATE (read-only). No fix proposed here — see `SPEC_ORCH-1138_RESERVE_STRAIGHT_TO_CART.md`.
- **Date:** 2026-06-15
- **Comms ledger:** read on entry. No OPEN BLOCK targeting forensics / ORCH-1138 / ALL. (COMMS-0029 WARN concerns `biz_update_live_trip` migration coordination — out of scope; this work is read-only and touches no migration.)

---

## Symptom summary (expected vs actual)

- **Reported (actual):** On the redesigned consumer trip detail, tapping **"Reserve my spot"** opens **ANOTHER event sheet** (a second full detail page) instead of going straight to the cart.
- **Expected:** Reserve goes STRAIGHT to the cart (quantity + pay → PaymentSheet), with no intermediate duplicate detail page.
- **Seth's three questions:** (1) Does the consumer app have TWO trip/event detail sheets / two shared sheets? (2) Make the NEW sheet's Reserve link straight to the cart. (3) Delete the redundant one(s).

---

## Investigation manifest (files read, in trace order)

1. `COMMS_LEDGER.md` — entry scan (no OPEN BLOCK to me).
2. `git log` + `git diff --stat origin/main...HEAD` — what ORCH-1138 actually shipped on this branch.
3. `app-mobile/app/index.tsx:259-266, 2285-2296` — how a trip from Discover mounts the NEW screen.
4. `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (full, 1593 lines) — the redesigned trip detail + its Reserve wiring.
5. `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` (full) — the Reserve CTA (docked + floating) and the arrow-bleed layout.
6. `app-mobile/src/hooks/useConsumerTripDetail.ts` — the trip detail payload (tiers, ticketTypeId, installments, hasPlan).
7. `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (EBES, full) — the SECOND sheet Reserve opens; topology, cart, checkout machinery.
8. `app-mobile/src/components/expandedCard/TicketCartSheet.tsx:156-215` — the actual cart contract (`TicketCartSheetProps`, `TicketCartCheckoutPayload`).
9. Importer audit (grep) — every consumer of EBES, TicketCartSheet, ConsumerTripReserveBar, ConsumerTripDetailScreen.
10. `app-mobile/src/components/ExpandedCardModal.tsx:1386, 1740-1744, 2258-2259` — the OTHER (event / venue-experience) EBES mount sites.

---

## Q-scorecard

### Q1 — How many detail sheets are in the consumer trip flow, and what opens when?
**Verdict (proven, source-traced):** TWO sequential detail surfaces.

Trip flow end-to-end:
1. Tap a trip in Discover → `handleOpenTripFromDiscover(seed)` → `setViewingTrip({...})` (`app-mobile/app/index.tsx:264-266`).
2. `viewingTrip !== null` → mounts the **NEW** `ConsumerTripDetailScreen` (`app-mobile/app/index.tsx:2285-2296`). This is the redesigned trip detail (cover, route, days, how-you-pay, refund ladder, Reserve bar). **Detail surface #1.**
3. Tap **"Reserve my spot"** → `onPress={() => setReserveSheetVisible(true)}` (`ConsumerTripDetailScreen.tsx:1131` docked / `:1145` floating).
4. `reserveSheetVisible === true` mounts `<ExpandedBusinessEventSheet …>` (`ConsumerTripDetailScreen.tsx:1286-1310`), which renders the **full SHARED `PublicEventPage`** (`ExpandedBusinessEventSheet.tsx:646-655`) — cover, description, itinerary, ticket rows, Buy bar. **Detail surface #2 (the "ANOTHER event sheet" Seth sees).**
5. Only THEN does a Buy/Reserve tap inside EBES (`onBuyTicket`/`onClaimFreeTicket` → `beginBooking`, `ExpandedBusinessEventSheet.tsx:463-479, 545-550`) open the actual cart `TicketCartSheet` (`:664-683`), which on Continue → `handleBuy` → `runNativeCheckout` → `ticket-checkout-create`.

So the buyer must traverse: **new detail → OLD shared detail (EBES) → cart → pay.** The second detail is the redundant hop.

### Q2 — Are there TWO trip/event DETAIL sheets? Are there TWO SHARED sheets?
**Verdict (proven):** YES, two detail surfaces in the trip flow — but they are NOT two copies of the same sheet. They are:
- The **trip-only** `ConsumerTripDetailScreen` (the new redesign, trip-specific).
- The **shared** `ExpandedBusinessEventSheet` (EBES), which renders the shared `@mingla/event-rendering` `PublicEventPage`. EBES is the app-wide gold-standard event/experience detail+checkout sheet (see Q4).

The trip screen explicitly re-uses EBES purely as a checkout vehicle — confirmed by its own header comment: *"Buyer flow (§F): Reserve opens the proven ExpandedBusinessEventSheet (tier select → cart → tax-preview address → runNativeCheckout)"* (`ConsumerTripDetailScreen.tsx:37-41`) and the `tripToBusinessEventCard()` adapter at `:262-297`. The problem is EBES is a FULL DETAIL page, not a tier-select/cart step — so reusing it shows the buyer a second detail.

### Q3 — Is the second sheet a redundant DETAIL view or a legitimate next step (tier-select / cart)?
**Verdict (proven):** REDUNDANT DETAIL. EBES renders the entire `PublicEventPage` (cover/description/itinerary/ticket list/Buy bar) — everything the new trip detail already showed. It is NOT a tier-select picker and NOT the cart. The genuine next step (the cart) is `TicketCartSheet`, which lives one level deeper INSIDE EBES. The tier-select case is also near-moot for trips: per the ORCH-1130 findings, 45/45 prod trips are single-tier, so there is no real tier choice to make — the EBES detail page is pure friction between "Reserve" and "cart".

### Q4 — Is EBES TRIP-ONLY (safe to delete) or SHARED (must be rewired-around)?
**Verdict (proven):** EBES is HEAVILY SHARED — NOT safe to delete. Importer audit (non-test):
- `app-mobile/src/components/ExpandedCardModal.tsx:52` import; mounted at `:1740-1744` for a **brand event** (`businessEvent`, `:1386`) and at `:2258-2259` for a **venue experience** (`selectedVenueExperience`, `:1422`).
- `app-mobile/src/components/MessageInterface.tsx:65` import; mounted at `:2182` (event/experience opened from chat).
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx:111` import; mounted at `:1286` (the trip Reserve — the one we want to rewire away from EBES).

EBES is the canonical event + experience detail/checkout sheet for the whole consumer app. Deleting it would break events and experiences across deck, modal, and chat. **It must be REWIRED-AROUND for the trip flow only; never deleted.**

### Q5 — What does "STRAIGHT TO THE CART" mean technically, and how should Reserve invoke it?
**Verdict (proven):** The actual cart is `TicketCartSheet` (`app-mobile/src/components/expandedCard/TicketCartSheet.tsx`). Its contract (`:176-215`):
```
visible, eventId, tickets (from usePublicEventTickets), intakeSchemasByTier
(from useTripIntakeSchemas), fallbackCurrency, initialTicketTypeId,
buyerName/Email/Phone, isSubmitting, clearFloatingNav, dueTodayCents,
onCancel, onCheckout(TicketCartCheckoutPayload)
```
On `onCheckout`, EBES's `handleBuy` (`ExpandedBusinessEventSheet.tsx:313-432`) composes the buyer + lines + `paymentPlanChoice` + `intakeFormData` + `eventDateId` and calls `runNativeCheckout` (`useNativeCheckoutFlow`) → `ticket-checkout-create`. "Straight to cart" therefore means: Reserve mounts `TicketCartSheet` directly (seeded at the trip's sole/first `ticketTypeId`), with the trip screen owning the same `usePublicEventTickets` + `useTripIntakeSchemas` + `useNativeCheckoutFlow` wiring EBES currently owns — skipping the EBES `PublicEventPage` render entirely. The trip screen already holds the data needed: `detail.tiers[].ticketTypeId`, `detail.hasPlan`, `paymentPlanChoice`, and the projected `planSchedule.depositCents` (`ConsumerTripDetailScreen.tsx:418-433, 1067-1080, 1294-1305`).

### Q6 — Is there a UI bug on the Reserve button arrow when "Pay over time" is selected?
**Verdict (proven, source-traced):** YES. When `paymentPlanChoice === "installments"` on a plan trip, `barPriceLabel = "{deposit} today"` and the buy CTA price becomes `From {deposit} today` with kicker `"Due today · deposit"` (`ConsumerTripDetailScreen.tsx:1067-1080, 1098`) — much longer than the pay-in-full `From €500` / `All-in, taxes included`. In the **docked** `reserve` row (`ConsumerTripReserveBar.tsx:346-355`: `flexDirection:"row"`, `justifyContent:"space-between"`, no `flexShrink`), `rLeft` (kicker+price, `:372-374`) has no width cap and `rCta` (`{cta.label} →`, `:171-173, 386-389`) has no `flexShrink`/`numberOfLines`. The longer left block pushes `rCta` and its trailing `→` past the right padding → the arrow bleeds out of the button. (The floating pill at `:243-245` is label-only with no price block, so it is less affected, but the same `floatCta` text has no shrink guard.)

---

## Findings (six-field evidence)

### F-1 — Reserve mounts EBES (a full shared detail page), not the cart — CONFIRMED ROOT CAUSE
1. **Symptom:** Tapping "Reserve my spot" opens a second full detail page (cover/description/tickets), not the cart.
2. **Layer:** code (component).
3. **Probe:** read `ConsumerTripDetailScreen.tsx:1125-1153, 1282-1311`; read `ExpandedBusinessEventSheet.tsx:1-16, 646-656`.
4. **Evidence:**
   - `ConsumerTripDetailScreen.tsx:1131` / `:1145`: `onPress={() => setReserveSheetVisible(true)}`.
   - `:1286-1289`: `<ExpandedBusinessEventSheet visible={reserveSheetVisible} data={card} onClose={...}>`.
   - `ExpandedBusinessEventSheet.tsx:646-655`: renders `<PublicEventPage event={publicEvent} brand={publicBrand} … />` — the full shared detail page.
   - Header comment `:1-16`: *"renders the SHARED PublicEventPage … the EXACT same layout as the mingla-business public event page."*
5. **Mechanism:** Reserve flips `reserveSheetVisible`, which mounts EBES; EBES's whole job is to render `PublicEventPage` (a detail page) and only reach the cart on a SECOND Buy tap inside it → the buyer sees a duplicate detail.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — EBES is shared by events + experiences (deck modal + chat) — must be rewired-around, NOT deleted — CONFIRMED (deletion-safety)
1. **Symptom:** N/A (architecture constraint that bounds the fix).
2. **Layer:** code (cross-surface).
3. **Probe:** `grep -rn "ExpandedBusinessEventSheet" app-mobile/src` (non-test).
4. **Evidence:** importers/mounts at `ExpandedCardModal.tsx:52,1740-1744` (event), `ExpandedCardModal.tsx:2258-2259` (venue experience), `MessageInterface.tsx:65,2182` (event/experience from chat), `ConsumerTripDetailScreen.tsx:111,1286` (trip).
5. **Mechanism:** EBES is the canonical event+experience detail/checkout sheet app-wide; deleting it breaks events and experiences in three surfaces.
6. **Severity:** CONFIRMED — DO NOT DELETE EBES. Rewire the TRIP path around it.

### F-3 — The real cart (`TicketCartSheet`) is imported ONLY by EBES; the trip screen has no direct cart path — SECONDARY ROOT CAUSE
1. **Symptom:** There is no way to reach the cart from the trip screen except through EBES.
2. **Layer:** code (component/import topology).
3. **Probe:** `grep -rn "TicketCartSheet" app-mobile/src` (non-test).
4. **Evidence:** only consumer (non-test) is `ExpandedBusinessEventSheet.tsx:70 (import), :664 (mount)`. `TicketCartSheet` is self-contained and takes a flat props contract (`TicketCartSheet.tsx:176-215`).
5. **Mechanism:** Because the cart only mounts inside EBES, the trip flow inherited EBES as the only route to it; giving the trip screen its own `TicketCartSheet` + `useNativeCheckoutFlow` removes the EBES hop without touching shared code.
6. **Severity:** SECONDARY ROOT CAUSE (it is why the indirection exists; the fix adds a direct trip→cart path).

### F-4 — Docked Reserve CTA arrow bleeds out of the button when "Pay over time" is selected — CONFIRMED ROOT CAUSE (the in-pass UI bug)
1. **Symptom:** The `→` arrow on "Reserve my spot →" overflows the right edge of the button when "Pay over time" is selected.
2. **Layer:** code (component/layout).
3. **Probe:** read `ConsumerTripDetailScreen.tsx:1067-1100`; read `ConsumerTripReserveBar.tsx:158-174, 346-389`.
4. **Evidence:**
   - `ConsumerTripDetailScreen.tsx:1098`: price = `From ${barPriceLabel}` where `barPriceLabel` becomes `"{deposit} today"` (`:1069`) and kicker `"Due today · deposit"` (`:1079`) when installments selected.
   - `ConsumerTripReserveBar.tsx:346-350`: `reserve` = row, `justifyContent:"space-between"`, no `flexShrink`.
   - `:372-374` `rLeft` (kicker+price) — no maxWidth/flex cap.
   - `:171-173` `rCta` = `<Text>{cta.label} →</Text>` with style `:386-389` `rCta` — no `flexShrink`, no `numberOfLines`.
5. **Mechanism:** the longer installments price/kicker grows `rLeft`; with no shrink guard on either child the label+arrow `rCta` is pushed past the button's right padding → arrow clips/bleeds out.
6. **Severity:** CONFIRMED ROOT CAUSE (separate, smaller bug; in-pass per dispatch).

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | `ConsumerTripDetailScreen.tsx:37-41` header documents the EBES-as-checkout reuse as intentional ("the proven … sheet"). MEMORY: ORCH-1025/1130 say checkout is all-in, venue-sourced tax, straight to PaymentSheet — consistent with cart, but the EBES detail hop predates and contradicts the "straight to checkout" spirit. |
| **Schema** | `trip_pricing_tiers` → `ticket_types(id, …)`; trip detail surfaces `ticketTypeId` per tier (`useConsumerTripDetail.ts:333-411`). Cart consumes `ticketTypeId` directly. No schema change needed. |
| **Code** | Reserve → `setReserveSheetVisible(true)` → EBES → PublicEventPage (2nd detail) → cart. CONFIRMED (F-1). |
| **Runtime** | Not live-fire driven (source-conclusive routing; see Confidence). Behavior is deterministic from the JSX. |
| **Data** | Per prior ORCH-1130 finding, 45/45 prod trips are single-tier → the EBES tier-list adds zero choice, only friction. |

No layer contradiction hides the bug; the bug is plainly in the Code layer (F-1) with the deletion constraint in cross-surface (F-2).

---

## Repro evidence

Source-conclusive: the routing is a deterministic JSX chain (`setReserveSheetVisible(true)` → `<ExpandedBusinessEventSheet>` → `<PublicEventPage>`), not a state/race/timing bug, so it cannot present any other way. No simulator run was required to PROVE the second-sheet topology (it is structural, not runtime-conditional). The arrow-bleed (F-4) is likewise a static-layout consequence of an unbounded flex row with a longer string. Confidence is capped at `proven (source-conclusive)` rather than `confirmed (live-fire)` because no sim recording was captured this pass; a tester live-fire is the natural verification gate (see SPEC SCs).

---

## Blast radius / cross-surface map

| Surface | In scope? | Note |
|---|---|---|
| Consumer iOS (`app-mobile`) | YES | The trip Reserve rewire + arrow-bleed fix. |
| Consumer Android (`app-mobile`) | YES | Same components; parity automatic (shared RN). |
| Buyer/anon Web (`mingla-business` `/t/...`) | NO | Separate web trip page (`mingla-business/app/t/[brandSlug]/[tripSlug].tsx` + `TripCheckoutFlow`); not this RN screen. |
| Business iOS / Android | NO | No business-app trip detail change. |
| Admin Web / Business Web preview | NO | Unaffected. |
| Consumer EVENTS + EXPERIENCES (deck modal + chat) | OUT (must stay intact) | They keep using EBES → must NOT regress. F-2 is the guard. |

---

## Invariant impact (flagged, not pre-decided)
- **I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED** (referenced at `ExpandedBusinessEventSheet.tsx:540`): the cart sheet IS the confirmation step. A direct trip→cart path PRESERVES this (the cart is still shown before charge). The SPEC must keep `TicketCartSheet` as the confirmation surface — do NOT auto-charge on Reserve.
- **WYSIWYP / all-in (ORCH-1025/1130):** the cart + `runNativeCheckout` + `ticket-checkout-create` path is unchanged; the rewire only changes WHICH component mounts the cart, not the checkout request. Must stay byte-identical (`paymentPlanChoice`, `dueTodayCents`, `intakeFormData`, no address/taxCalculationId).
- **feedback_rn_sub_sheet_must_render_inside_parent:** `TicketCartSheet` must remain a sibling BaseBottomSheet root in the same fragment as the trip screen's sheet host (same rule EBES follows).

## Discoveries for Orchestrator
- A separate, untracked ORCH-1138 investigation exists in the worktree (`INVESTIGATION_ORCH-1138_POSTEXPERIENCECHECK_ABORTERROR.md`) for an unrelated `usePostExperienceCheck` AbortError — not this issue.
- If the SPEC removes EBES from the trip flow, the `tripToBusinessEventCard()` adapter (`ConsumerTripDetailScreen.tsx:262-297`) becomes dead code for the trip path and is TRIP-ONLY → safe to delete in the same pass (see SPEC safe-delete list).

## Confidence
**proven (source-conclusive)** for F-1, F-2, F-3, F-4. The second-sheet topology and the deletion-safety map are fully traced from source with importer evidence. Runtime live-fire is deferred to the tester (the SPEC defines the per-surface gates).

## Recommended next phase + scope
**SPEC** (same skill, this dispatch) → then **implementor**. Scope: (a) rewire the trip Reserve to mount `TicketCartSheet` directly (single-tier auto-seed; multi-tier opens cart seeded at first sellable tier); (b) delete ONLY the trip-only redundant path (the EBES mount + `tripToBusinessEventCard` adapter in `ConsumerTripDetailScreen.tsx`), keep EBES itself; (c) fix the docked Reserve arrow-bleed. Do NOT touch EBES, ExpandedCardModal, MessageInterface, or the web trip page.
