# INVESTIGATION — ORCH-1138 trip sold-out / remaining-capacity signal reconciliation

**Question (Seth challenge):** "We already have a sold toggle — are you saying it doesn't really work?"
The ORCH-1138 SPEC (§ note + §10 Open Question 1) claims the PUBLIC trip page has no real sold-out
signal because `usePublicTripBySlug` returns `ticketsRemaining = null`.

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch
`ORCH-1138-trip-page-redesign`, HEAD `2f84d6b55` = `origin/main` (0 behind; fresh).

**DB:** project `gqnoajqerqhnvulmnyvv`, read-only queries only.

---

## VERDICT: (b) PARTIAL — reconciles BOTH Seth and the SPEC

Seth is right AND the SPEC is right; they are talking about **two different signals**:

- **Seth's "sold toggle" = the `bookings_closed` authoring toggle ("Bookings closed").** It EXISTS,
  PERSISTS, and RENDERS end-to-end on the public trip page (red "Bookings closed" banner + a
  non-tappable floating bar). This works.
- **The SPEC's claim = there is no CAPACITY-driven "SOLD OUT" signal on the public trip page.** Also
  TRUE: real remaining capacity exists in the DB and the buyer-checkout path computes it, but the
  public *redesign target* hook (`usePublicTripBySlug`) hardcodes `ticketsRemaining = null` and the
  public page has no sold-out branch.

**The broken link (precise):** the public *preview/share* trip page at `/t/{brandSlug}/{tripSlug}`
fetches via `usePublicTripBySlug`, which **does NOT call `pg_public_ticket_types_remaining`** and
sets `ticketsRemaining: null` — while the buyer-checkout sibling (`usePublicTripById` →
`getPublicTripById`) DOES. So capacity-sold-out is invisible on the page ORCH-1138 redesigns, even
though the data and the RPC are live.

Confidence: **proven** (source traced end-to-end + DB confirms columns/RPC + a real partially-sold
trip exists). Not reproducer-bound UI; capped at proven via static + live DB evidence.

---

## Five-layer trace (evidence)

### Layer 1 — BUSINESS AUTHORING
- **"Bookings closed" toggle EXISTS.** `mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx:128-147`
  — `<Switch>` labeled "Bookings closed", help "Stop taking new bookings now, before the deadline.",
  `testID="settings-bookings-closed-switch"`. **This is what Seth remembers.** It is a sales-STOP
  toggle, not a capacity/sold-out control.
- **Capacity is authored too** (trip capacity → `ticket_types.quantity_total`), edited via the live-trip
  patch RPC.
- **Persistence (RPC `biz_update_live_trip`)**, latest def `supabase/migrations/20260929000000_orch_1120_trip_settings_refund_deadline.sql`:
  - `bookings_closed` written at lines 552-712 (`bookings_closed` + `bookings_closed_at` semantics).
  - `capacity` written to `ticket_types.quantity_total` at lines 199-228.

### Layer 2 — SCHEMA / DATA (DB-confirmed)
- Columns + RPCs exist (live DB): `events.bookings_closed` (1), `ticket_types.quantity_total` (1),
  `pg_public_ticket_types_remaining` (1), `biz_update_live_trip` (1).
- **Real trip data (decisive):** 3 published trips. "The DC Adventure" = `quantity_total=102`,
  sold=81, **remaining=21** (RPC tuple `(d9ec94b7…,81,21)`). The remaining-capacity RPC returns
  REAL numbers for trips today. None of the 3 currently have `bookings_closed=true` or a deadline.
- Sold-out is sourced from `ticket_types` capacity + paid-order count via the anon RPC, not a view
  column; `bookings_closed`/`booking_deadline` read straight off the `events` row (anon-readable via
  the published-trip RLS the hook relies on).

### Layer 3 — PUBLIC FETCH (the crux)
- **Redesign target — `mingla-business/src/hooks/usePublicTripBySlug.ts:255-259`:**
  ```
  // ORCH-0946 — trip preview page (this hook) does not gate sold-out;
  // the buyer-checkout page (`usePublicTripById`) does. Set null here…
  ticketsRemaining: null,
  ```
  It NEVER calls `pg_public_ticket_types_remaining`. It DOES return `bookingsClosed`
  (`event.bookings_closed === true`, line 282) + `bookingsClosedAt` (283) + `bookingDeadline` (281).
- **Buyer-checkout sibling — `usePublicTripById.ts` → `getPublicTripById`
  (`publicEventsService.ts:1244`):** calls `fetchTicketTypesRemaining` (`:1326`) and sets a real
  `ticketsRemaining = GREATEST(total−sold,0)` (`:1410-1422`).

### Layer 4 — PUBLIC RENDER (`app/t/[brandSlug]/[tripSlug].tsx`)
- Reads `isClosed = trip.bookingsClosed === true` (line 157) → renders a red "Bookings closed" banner
  and a non-tappable floating-bar state (CtaState `bookings closed`, lines 230-236). **The authoring
  toggle reaches the buyer — Seth's recollection is correct.**
- Floating-bar CtaState (lines 222-251) has states: `unavailable` (brand can't charge), `bookings
  closed`, `not bookable yet`, `free`, `buy`. **There is NO sold-out branch** — no reference to
  `ticketsRemaining`/capacity exhaustion anywhere on this page.

### Layer 5 — EVENT-PAGE COMPARISON (parity gap)
- Event public slug page uses `usePublicEventBySlug` → `getPublicEventBySlug` → `fetchTickets`
  (`publicEventsService.ts:859`), which **overwrites each tier's `capacity` with real remaining**
  (`fetchTicketTypesRemaining`, line 880; `capacity: remaining`, line 894).
- The shared `packages/event-rendering/QuantityRow.tsx` computes
  `isSoldOut = !ticket.isUnlimited && remainingCapacity === 0` (line 198), renders a **"Sold out"**
  badge (line 332) and **"{remainingCapacity} left"** (line 395).
- The trip page does NOT mount this capacity-fed selector for sold-out on the `/t/` preview surface;
  its `usePublicTripBySlug` feed is `null`. **Real parity gap, not a working toggle.**

---

## Reconciliation
Seth saw / built the **"Bookings closed" toggle** — it is real and works end-to-end on the public
trip page. The SPEC is talking about the **capacity "SOLD OUT" state**, which the public trip page
genuinely lacks because the slug hook hardcodes `ticketsRemaining: null`. Both statements are true.
The SPEC's §10 recommendation (do not fabricate a sold-out state on 1138; register wiring
`pg_public_ticket_types_remaining` into `usePublicTripBySlug` as a follow-on) is correct and is the
exact broken link.

## Discoveries for Orchestrator
- A real partially-sold trip exists in prod ("The DC Adventure", 81/102 sold). If it sells out, the
  public `/t/` page will keep showing "Reserve my spot" (capacity gate absent); the checkout RPC is
  the only backstop. Candidate follow-on ORCH = wire remaining into `usePublicTripBySlug` (one RPC
  call mirroring `getPublicTripById:1326-1422`).

## No fix proposed (INVESTIGATE only).
