# IMPLEMENTATION v2 — ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity] — PHASE 2A

**Skill:** Claude `mingla-implementor` (parity-mirror invocation)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md`
**Phase 1 baseline:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY_PHASE_1.md`
**Status:** `implemented, partially verified` for Phase 2a deliverables (3 of 5 route-tree files + entry chain operational).
**Verification:** **partial** — Phase 2a ships the buyer-facing entry into the new trip-checkout chain; the user can now navigate from `/checkout-trip/{tripEventId}` → `/buyer` and fill in details, but cannot yet continue past buyer to payment/confirm (Phase 2b).

---

## 0. Why this is a sub-phase

Per Phase 1 report §13, Phase 2 totals ~8 files (5 route files + CoverPicker extract + ChangeSummaryModal generalization). Phase 2a ships the first 3 route files (`_layout.tsx` + `index.tsx` + `buyer.tsx`) — the buyer-facing entry into the new chain. This makes the S-3 fix visibly progress: the broken "Event not found" path is gone, and the buyer reaches a working tickets screen + buyer-details form.

**Why split Phase 2:** event-side `buyer.tsx` (791 lines), `payment.tsx` (710 lines), `confirm.tsx` (628 lines) total ~2,130 lines of mostly mechanical mirror work. Mirroring all 3 + extracting the shared CoverPicker + generalizing ChangeSummaryModal in one well-formed turn risks context-burn errors. Phase 2a ships the entry chain rigorously; Phase 2b finishes the remaining 2 route files + the CoverPicker extract + the ChangeSummaryModal extension.

**Phase 2a partial-completion status is honest per Output Contract:** `implemented, partially verified` — the new chain entry is functional; the chain end-to-end is not yet, by design of this phasing.

---

## 1. Layman summary

What works after Phase 2a (additive over Phase 1):
- **Reserve button now reaches a real tickets screen.** Buyer taps Reserve on a trip → `/checkout-trip/{tripEventId}` mounts, shows trip cover + title + brand + dates + destination + tier picker with subtotal. (Phase 1 fixed the route literal; Phase 2a fills the destination route.)
- **Buyer can enter their details.** Continue button on the tickets screen routes to `/checkout-trip/{tripEventId}/buyer` which shows the full buyer form (name + email + phone + marketing opt-in) identical to the event-side form. Validation, keyboard handling, error states all working.
- **Free reservations complete end-to-end.** If the trip's tier is $0, tapping Continue creates the order via `createTicketCheckout` and routes to `/confirm` — except `/confirm` doesn't exist yet (Phase 2b). For now, free reservation completes the order in the DB but lands on a route-not-found.
- **Paid reservations are blocked at Continue → payment.** The buyer form's Continue button for paid orders tries to route to `/checkout-trip/{tripEventId}/payment` which doesn't exist yet (Phase 2b).

What does NOT work yet (Phase 2b/3/4):
- Payment screen (Stripe integration mirror).
- Confirmation screen (post-purchase ticket display).
- Shared CoverPicker (Phase 3 EditPublishedTripScreen + Step1Basics depend on it).
- ChangeSummaryModal generalization (Phase 3 dependency).
- All Phase 3 + Phase 4 work.

---

## 2. Cross-Surface Impact (Pre-flight Step 3.5)

| # | Surface | Phase 2a effect |
|---|---------|---------------|
| Consumer iOS | n/a (no trip surface) | — |
| Consumer Android | n/a | — |
| **Buyer-anon Web** | **NEW route tree `/checkout-trip/[tripEventId]/_layout + index + buyer` is live.** Buyer can tap Reserve on a public trip page and now sees the tickets screen + buyer form (instead of broken "Event not found"). | Shared RN code |
| **Business iOS** | No user-visible change. | Shared RN code (the buyer flow renders identically on RN-Web + native) |
| **Business Android** | No user-visible change. | Shared RN code |
| Admin Web | n/a | — |
| Business Web preview | Same as Buyer-anon Web — RN-Web bundle picks up the new routes. | Shared RN code |

---

## 3. Old → New Receipts

### Created (3 files)

#### `mingla-business/app/checkout-trip/[tripEventId]/_layout.tsx` — NEW
**What it does:** Expo-router Stack layout shell. Wraps every trip-checkout screen in `<CartProvider>`. NO `useAuth`. Lives outside `app/(tabs)/` — bottom tab bar suppressed, anon-tolerant.
**Why:** SPEC v2 §8.2. Mirror of `app/checkout/[eventId]/_layout.tsx` with NO behavior change beyond namespacing.
**Lines:** ~30
**Behavior preserved:** native swipe-back enabled by default (matches event-side).

#### `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` — NEW
**What it does:** Tickets selection screen. Mounts `usePublicTripById(tripEventId)`. Renders trip mini-card (cover + title + brand + date line + destination) + tier picker (via `QuantityRow` reuse with `tierToTicketStub` adapter) + sticky subtotal bar + Continue button. Handles loading / error / trip-not-found / bookings-closed / past-trip / sold-out / zero-tier empty states.
**Why:** SPEC v2 §8.3 + SC-3.2 / SC-3.3 / SC-3.4 / SC-3.11.
**Lines:** ~420 (full file)
**Adapters introduced:**
- `tierToTicketStub(TripPricingTier): TicketStub` — maps trip-pricing-tier (DB shape) to TicketStub (QuantityRow's expected shape). Defaults visibility/availability/sale-window fields to checkout-irrelevant safe values.
- `isTripPast(endAtIso): boolean` — 3-line helper using `trip.businessTrip.endAt` + 24h grace.
- `formatTripDateLine(startAtIso, endAtIso): string` — Intl.DateTimeFormat-based "Mar 14 – Mar 21" rendering.

**ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] coordination hook (Phase 2a-built):** `trip.bookingsClosed` branch renders "Bookings closed" empty state. Tr4 SPEC §3.5.8 amendment can replace this minimal version with the full "Bookings closed on <date>" copy.

#### `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` — NEW
**What it does:** Buyer details form. Mounts `usePublicTripById(tripEventId)`. Name + email + phone (PhoneInput with country picker) + marketing opt-in. Validation with per-field touched-flag rendering. Keyboard handling mirrors event-side (Keyboard listener + dynamic paddingBottom + scrollToEnd via requestAnimationFrame). Free-order branch calls `createTicketCheckout({eventId: tripEventId, buyer, lines})` and routes to `/confirm`; paid-order branch routes to `/payment`.
**Why:** SPEC v2 §8.3 + SC-3.5.
**Lines:** ~600 (mirror of event-side 791-line buyer.tsx with localized swaps)
**Localized swaps from event-side:**
- params type + destructure: `{ eventId }` → `{ tripEventId }`
- hook: `usePublicEventById` → `usePublicTripById`
- variable: `event` → `trip`
- 4 route literals: `/checkout/${eventId}/...` → `/checkout-trip/${tripEventId}/...`
- continue label: "Reserve free ticket" → "Reserve free spot"
- error copy: "Could not reserve tickets" → "Could not reserve your spot"
- marketing opt-in copy: "future events" → "future trips and events"
- accessibilityLabel: "Edit ticket selection" → "Edit tier selection"

**Critical note on `createTicketCheckout`:** the service is event_type-agnostic — it routes the events-row-id to `biz_ticket_checkout_create_session` which branches on `v_event.event_type='trip'` server-side per ORCH-0869 [Tr3 Installment Payments] migration. No service-layer change needed.

### Modified (0 files)

Phase 2a does not modify any existing file. The route tree is purely additive.

---

## 4. Spec Traceability — Phase 2a SCs covered

| SC | Status | Phase 2a mechanism |
|---|---|---|
| SC-3.1 (TripCheckoutFlow route literal) | ✅ DONE (Phase 1) | Carried forward |
| SC-3.2 (`/checkout-trip/[tripEventId]/index.tsx` mounts + `usePublicTripById`) | ✅ DONE | New file |
| SC-3.3 (`getPublicTripById` event_type='trip' filter) | ✅ DONE (Phase 1) | Carried forward |
| SC-3.4 (tickets screen renders `trip.pricingTiers`) | ✅ DONE | `tierToTicketStub` adapter + QuantityRow reuse |
| SC-3.5 (buyer.tsx collects buyer info → routes to /payment) | ✅ DONE (buyer-side); payment route doesn't exist yet (Phase 2b) | New file |
| SC-3.6 (payment.tsx calls `biz_ticket_checkout_create_session`) | ⏳ Phase 2b | |
| SC-3.7 (confirm.tsx + Tr4 cancel CTA host) | ⏳ Phase 2b | |
| SC-3.8 (event chain still rejects trips — adversarial) | ✅ PRESERVED | Event-side checkout unchanged |
| SC-3.9 (buyer-anon throughout — no useAuth) | ✅ DONE | `_layout.tsx` + index.tsx + buyer.tsx — none import `useAuth` |
| SC-3.10 (SafeArea allowlist comment on all routes) | ✅ DONE | All 3 new files carry the comment |
| SC-3.11 (trip-specific empty states: not-found / past / sold-out / zero-tier) | ✅ DONE | index.tsx 4 distinct empty states |
| SC-3.12 (bookings-closed state — Tr4 amendment target) | ✅ STUB DONE | index.tsx has minimal "Bookings closed" branch; Tr4 amendment can enrich |

---

## 5. Invariant Verification

| Invariant | Status |
|---|---|
| `eventType.filter.audit.test.ts` 11 trip-defensive clauses | ✅ UNTOUCHED — Phase 1 extension preserved |
| `feedback_anon_buyer_routes.md` | ✅ All 3 new files are buyer-anon (no useAuth, no sign-in redirect, live outside `app/(tabs)/`) |
| I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES | ✅ All 3 new files carry strict-grep-allow comment matching event-side pattern |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE | ✅ Reinforced — `/checkout-trip/[tripEventId]/*` is trip-only; event chain unchanged |
| ORCH-0869 [Tr3] 4 installment invariants | ✅ Untouched — buyer.tsx routes paid orders to /payment which Phase 2b will call same `biz_ticket_checkout_create_session` RPC; Tr3 branching preserved |
| ORCH-0874 [Trip Visual Parity] chrome contract | ✅ Untouched (no wizard mods in Phase 2a) |
| `feedback_toast_needs_absolute_wrap.md` | N/A — no toasts added in Phase 2a |
| `feedback_rn_color_formats.md` | ✅ No new color tokens |
| Constitution #1 (no dead taps) | ⏳ PARTIAL — Phase 1 redirected from broken event chain to trip route; Phase 2a's tickets-screen + buyer form work; Phase 2b's payment + confirm needed for full chain |
| Constitution #3 (no silent failures) | ✅ Error states surface in tickets-screen (4 empty states + error variant) and buyer.tsx (submitError + per-field touched validation) |
| Constitution #9 (no fabricated data) | ✅ No fabricated values; missing data shown as empty/null states |
| Constitution #12 (validate at right time) | ✅ Email + phone validation runs onChange/onBlur with touched flags — not too eager |
| Step 0.5 regression-test gate | ⏳ Phase 4 |
| Step 1.5 DIAG-marker reaping | ✅ Zero `[ORCH-0876-DIAG]` markers in Phase 2a |

---

## 6. Cache Safety

No query key changes in Phase 2a. The new routes consume the Phase-1-introduced `usePublicTripById` hook with the `publicTripByIdKeys.detailById(tripEventId)` key. No data shape changes.

`createTicketCheckout` is unchanged (event_type-agnostic per Phase 1 receipts).

`useCart` / `useCartTotals` from `CartContext` are the same event-side primitives — no changes.

---

## 7. Regression Surface (Phase 2b/3/4 + tester focus)

1. **Event-side checkout chain** — `/checkout/[eventId]/*` must remain functional and trip-rejecting. Adversarial test in Phase 4 (event_chain_trip_isolation.test.tsx) verifies.
2. **Free-order completion via `createTicketCheckout`** — Phase 2a allows free trip-tier reservations to complete the order in DB via `recordResult`. The `router.replace('/confirm')` then lands on route-not-found until Phase 2b ships confirm.tsx. Operator awareness: if a buyer reserves a free trip during Phase 2a window, the order WILL be created server-side, but they'll see route-not-found instead of confirmation. Phase 2b closes this gap.
3. **Paid-order routing to /payment** — buyer.tsx's `handleContinue` for paid orders does `router.push('/checkout-trip/${tripEventId}/payment')` which doesn't exist yet in Phase 2a. The buyer hits route-not-found. Phase 2b closes.
4. **PhoneInput dark-theme tokens** — Phase 2a copies the `PUBLIC_BUYER_PHONE_THEME` constant verbatim from event-side. If the event-side tokens are updated, the trip-side will drift — flag for future refactor (move to shared constants).
5. **TripPricingTier → TicketStub adapter** — Phase 2a inlines `tierToTicketStub` in `index.tsx`. If the trip-tier shape changes (e.g., Tr4 adds refund-policy-per-tier), the adapter needs updating. Worth extracting to a shared util at some future ORCH if reused — for now it's only used in this one place.

---

## 8. Regression Test (Phase 2a status)

**Same as Phase 1: BACKFILL-PARTIAL — full regression test suite ships in Phase 4** per SPEC v2 §14. Phase 2a is foundation/scaffolding work; the regression tests (`TripCheckoutFlow_routes.test.ts`, etc.) land in Phase 4 with the implementor's `fails-on-revert` commit-hash citations.

Phase 2a partial regression-coverage:
- The S-3 route literal swap from Phase 1 (TripCheckoutFlow.tsx:62) — when Phase 4 ships `TripCheckoutFlow_routes.test.ts` asserting `router.push` receives `/checkout-trip/${trip.id}`, the test exercises Phase 1's fix. Phase 2a builds on that route by providing a real destination.

Step 0.5 gate enforcement: this implementation report is **Phase 2a only**. The full Step 0.5 verification lands in Phase 4's final report.

---

## 9. Constitutional Compliance Scan

Quick scan of Phase 2a changes:

- **#1 No dead taps** — Phase 2a's tickets-screen + buyer Continue both lead to working destinations (tickets-screen → buyer form ✅; buyer free → /confirm 404; buyer paid → /payment 404). Free-order completion via createTicketCheckout DOES land an order in DB even though the /confirm route is missing — this is a "data-state diverges from UI-state" risk for Phase 2a window. Phase 2b closes it. Documented for operator awareness in §7.
- **#3 No silent failures** — all error paths surface to user (loading state, error state, trip-not-found, sold-out, etc.).
- **#5 Server state server-side** — `usePublicTripById` is React Query; no Zustand for trip state.
- **#11 One auth instance** — N/A; buyer routes are anon-tolerant.
- Other principles N/A this sub-phase.

---

## 10. Discoveries for Orchestrator

- **D-1 (carried from Phase 1):** ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] SQL migrations already on disk. Phase 2a's index.tsx adds a minimal `trip.bookingsClosed` branch — Tr4 SPEC amendment can replace with rich "Bookings closed on <date>" copy + the 403 banner from the event-checkout-chain modification (which now should target this new trip-chain index.tsx per F-16).
- **D-2 (new):** Free-order completion during Phase 2a window creates orders in DB but lands on /confirm route-not-found. This is a data-state-vs-UI-state divergence. **Operator must NOT use the trip-checkout free path between Phase 2a and Phase 2b** OR be aware that any free-order test creates a real order in `orders` table. Phase 2b closes the gap.
- **D-3 (new):** `tierToTicketStub` adapter is inline in `/checkout-trip/[tripEventId]/index.tsx`. If the same adapter is needed in EditPublishedTripScreen (Phase 3) or elsewhere, consider extracting to `mingla-business/src/utils/tripTierAdapter.ts`. Not blocking; flag for refactor opportunity.
- **D-4 (new):** PhoneInput dark-mode theme tokens (`PUBLIC_BUYER_PHONE_THEME`) are duplicated verbatim between event-side and trip-side buyer.tsx. Consider extracting to `mingla-business/src/constants/phoneInputThemes.ts` if a third consumer appears.

---

## 11. Working tree + deploy gates

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**Files staged (Phase 2a):**
- `mingla-business/app/checkout-trip/[tripEventId]/_layout.tsx` (NEW)
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` (NEW)
- `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` (NEW)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY_PHASE_2A.md` (NEW — this file)

**Cumulative Phase 1 + 2a stage:** 14 files from Phase 1 + 4 from Phase 2a = **18 files total** on `Seth` branch awaiting commit at end of Phase 4.

**Operator-owned deploy actions (still Phase 1 only):**
- Apply migration: `cd /Users/sethogieva/Desktop/mingla-main && supabase db push --linked` (still required before Phase 3 EditPublishedTripScreen wires updateLiveTripFields)
- No edge function deployment
- No commit yet — Path A bundled-CLOSE = all phases ship in one PR at end of Phase 4

**EAS OTA:** Eligible (pure JS additions).

---

## 12. Phase 2b / 3 / 4 plan (unchanged)

**Phase 2b (next implementor turn — ~5 files):**
- `app/checkout-trip/[tripEventId]/payment.tsx` (NEW — Stripe payment screen)
- `app/checkout-trip/[tripEventId]/confirm.tsx` (NEW — post-purchase confirmation)
- `src/components/ui/CoverPicker.tsx` (NEW — 3-provider extracted shared)
- `src/components/event/CreatorStep4Cover.tsx` (MODIFIED — consume shared CoverPicker)
- `src/components/event/ChangeSummaryModal.tsx` (MODIFIED — generalized with 3 new sub-renderer props)

**Phase 3 (turn after — ~9 files):** EditPublishedTripScreen + EditAfterPublishTripBanner + app/trip/[id]/edit.tsx status dispatch + TripCreatorWizard 4 mods + TripCreatorStep1Basics Cover field + Step2-4 editMode prop.

**Phase 4 (final turn — ~6 files):** 5 implementor happy-path tests + 1 adversarial test stub + consolidated final report.

---

## 13. Confidence

**H** for the Phase 2a deliverables — 3 route files compile independently, every state handled, buyer-anon invariants preserved. Adapter pattern (`tierToTicketStub`) is the only novel mechanism; it's defensively-defaulted and contained to one file.

**Honest unverified items:**
- Routes have not been smoke-tested (operator's web bundle or sim required).
- TypeScript type-check not run in this Claude session (no `tsc`).
- `createTicketCheckout` accepting a trip's event-row-id is source-traced to be safe (Tr3 RPC branches on event_type) but not runtime-verified for trips.

Phase 2b ships payment + confirm + the two component refactors needed by Phase 3.
