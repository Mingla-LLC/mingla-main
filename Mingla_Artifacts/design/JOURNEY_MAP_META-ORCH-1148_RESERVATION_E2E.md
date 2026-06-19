# JOURNEY MAP — META-ORCH-1148 — Venue Table-Reservation, END-TO-END

> **Type:** MAPPING / STRATEGY artifact. NOT a build contract, NOT code. This maps the full
> reservation journey (operator setup → consumer-app booking → anonymous-web booking → waitlist)
> screen-by-screen against the CURRENT shipped reality, names every seam, and drives the **2.2
> consumer-booking SPEC** that forensics writes next.
> **Author:** product + UX strategist · **Date:** 2026-06-16 · **Anchor:** `/Users/sethogieva/Desktop/mingla-main/`
> **Binding inputs read:** `specs/VISION_META-ORCH-1148_VENUE_MANAGEMENT_SUITE.md` (DECISIONS LOCKED) ·
> `specs/PRD_META-ORCH-1148_FIRSTSHIP_BOOKING_LOOP.md` (money model, sub-ORCH split, §9 open Qs) ·
> `design/DESIGN_IA_META-ORCH-1148_VENUE_SUITE.md` (suite shell + reserve-flow IA).
> **Grounding:** two forensic recon passes on the live consumer app (`app-mobile`) and the public
> buyer web (`mingla-business`). The booking core (2.1a) is SHIPPED: the availability engine
> `pg_venue_available_slots(brand, date, party_size)` (authenticated-only Postgres fn — the frozen
> reuse contract) + the `venue_tables` / `venue_capacity_rules` / `venue_availability_config` /
> `venue_reservation_settings` / `reservations` / `venue_waitlist` schema.

---

## 0. How to read this map

The reservation loop has **four actors crossing four surfaces**, and the ONLY net-new consumer build
(2.2) lives where those actors touch the booking primitive. This document:

1. Defines the **actors & surfaces** and what each can/can't do today vs after 2.2 (§1).
2. Walks the **four end-to-end journeys + the waitlist sub-journey** screen-by-screen, each step
   citing the real component / RPC / engine and flagging `[SHIPPED]` vs `[NET-NEW 2.2]` (§2).
3. Gives the **FEATURE → SCREEN → USER-IMPACT matrix** for every venue-suite module across all
   stages (§3).
4. Distills **what 2.2 must BUILD** from the seams (§4).
5. Surfaces the **open product forks for Seth** (§5).

The thesis, unchanged from the PRD: **2.1 already lets an operator stand up a bookable venue and the
engine already computes truthful slots. 2.2 is the demand-side conversion layer** — the deck/page
affordance, the slot picker bound to the engine, the free-vs-fee fork, the anon-web route + edge fn,
and the engine's authenticated→anon GRANT flip. Everything else is reuse.

---

## 1. ACTORS & SURFACES

| Actor | Surface | Can do TODAY | Can do AFTER 2.2 | Cannot do (by design) |
|---|---|---|---|---|
| **Operator** | Business app (iOS/Android) + web (desktop host-stand / phone) | Toggle Reservations on; add Tables; set Availability/turn-times; set optional fee + no-show policy; create + manage manual reservations; manage waitlist (2.0/2.1 shipped) | See inbound `source='mingla'` (app) + `source='website'` (anon-web) reservations land in the list in real time; the loop is non-empty | — |
| **Consumer — authenticated** | Consumer app (`app-mobile`) | Browse the deck; expand a single-place `nightOut` card → see `VenueExperiencesSection`; book a brand experience (`ExpandedBusinessEventSheet` → `TicketCartSheet` → native checkout); save/schedule (auth-gated) | **Reserve a table**: party + date → engine slots → free confirm OR fee via native PaymentSheet; see it in "my reservations"; cancel per policy | — |
| **Consumer — anonymous** | Consumer app (`app-mobile`) | Browse the deck/expand/trip-detail anonymously (anon-RPC-readable); CANNOT save/schedule/book (tap → sign-in modal) | Walk the reserve flow up to the **commit step**, then hit the **auth/guest decision point** (§2c, §5 Q3) | Persist a reservation without crossing the auth/guest gate |
| **Anonymous web buyer** | Public buyer web (served by `mingla-business`) | See `/b/{brandSlug}` (`PublicBrandPage` → `PublicVenueDetail`: badge, city, category, hours, gallery); buy tickets via the `/checkout/...` funnel (name/email/E.164 → hosted Stripe Checkout → `/o/` receipt) — NO login | **Reserve a table** from a public reserve surface (new route in the allowlist) → engine slots → buyer details → free confirm OR fee via hosted Stripe Checkout → `/o/` reservation receipt | Use the native PaymentSheet (web = hosted Checkout only) |

**Surface boundaries that constrain the build:**
- **Money rail forks by surface:** native PaymentSheet on `app-mobile`; **hosted Stripe Checkout
  redirect** (`window.location.assign`) on web. Both call `ticket-checkout-create`; only the return
  shape differs. The reservation fee must honor this fork.
- **Auth forks by surface:** consumer app gates save/book behind a sign-in modal; anon web is
  genuinely login-free for buyer routes via the `PUBLIC_BUYER_ROUTE_PREFIXES` allowlist in
  `coldLoadAuthGates.ts` (root `_layout.tsx` exempts those prefixes from the sign-in redirect).
- **The engine is authenticated-only today.** `pg_venue_available_slots` is GRANTed to authenticated
  callers. The anon-web journey (and any anon consumer-app path) needs an **anon-readable slot path**
  — the single most load-bearing backend flip in 2.2 (§4, §2d-step-3).

---

## 2. THE FOUR END-TO-END JOURNEYS (screen-by-screen)

Legend: `[SHIPPED]` = exists in 2.0/2.1 or reused as-is · `[NET-NEW 2.2]` = built by the consumer-booking ship · `[FLIP]` = a config/GRANT change, not new UI.

---

### 2a. JOURNEY A — Operator setup (business app + web) `[SHIPPED in 2.0/2.1]`

The supply-side journey that makes a venue *reservable*. Mapped here because it's the precondition
that flips every consumer/web surface on.

| # | Screen | User sees | User does | System / data behind it |
|---|---|---|---|---|
| A1 | **Hub → Venue tab → Overview** (suite shell, the preserved listing as Overview/Profile) | Venue identity strip, AI match, gallery, public hours + an **invitation card** "Take table reservations on Mingla" | Taps **Turn on Reservations** | Reads `venue_reservation_settings`; toggle is OFF → only Band A (Overview/Settings) visible |
| A2 | **Turn-on setup sheet** (3-step starter) | "Add a table → Set your hours → (optional) fee" | Confirms | Writes `venue_reservation_settings.reservations_enabled = true`; Bands B (and gated C/D slots) animate into the master rail; lands on **Tables** |
| A3 | **Tables** (dense list-of-tables) | Empty state "No tables yet" → after adds, a sortable grid (Name/Seats/Min–Max/Zone/Type/Combine/active) | **+ Add table** (name, capacity, min/max party, zone, seating type, combinable, accessible, reservation policy, notes) | Inserts `venue_tables`; Smart Capacity Rules MVP (`party_fit`, `deposit_threshold`, `blackout_scope`) stored in `venue_capacity_rules` |
| A4 | **Availability** (structured editor) | ① service periods (Brunch/Dinner) ② turn-time matrix (P2 75 / P4 90 / P6+ 120) ③ booking controls (buffer, max-per-slot, window) ④ blackouts | Sets hours, turn-times, buffers, max-per-slot, window, blackouts | Writes `venue_availability_config` (+ `venue_blackouts`). **This is the data the engine reads.** |
| A5 | **Settings → Reservation rules** | Toggle (canonical home), **optional reservation fee** (amount → all-in WYSIWYP preview), refundable, cancel cutoff, no-show policy | Optionally enables a fee + sets policy | Writes `venue_reservation_settings.fee_enabled/fee_amount_cents/fee_refundable/cancel_cutoff_hours/no_show_fee_policy`; pass/absorb + tax inherit brand toggles (`defaultPassTax/MinglaFee/ServiceFee`). **Paid-publish integrity:** can't enable a *paid* fee unless `stripe_charges_enabled` / Paystack subaccount (ORCH-1073 lineage, 409 mirror) |
| A6 | **Reservations list** (Today/Upcoming/Waitlist/Completed/No-shows/Canceled) | Empty until bookings; "+ New reservation" | Optionally creates a manual reservation (phone/walk-in) to test | Inserts `reservations` (source=`phone`/`walk_in`, created_via=`operator`); full lifecycle (confirm→seat→no-show/complete/cancel) |
| A7 | **"You're live" state** | Confirmation: "Mingla can now send the right guests straight to your tables." | — | The venue is now **reservable**: `reservations_enabled=true` + ≥1 active table + availability config present. **This is the boolean that flips the consumer/web Reserve affordances on.** |

**What A flips on:** a per-venue **`reservable` flag** = `reservations_enabled && has_active_table &&
has_availability_config`. The deck card (§2b-1), the public page (§2d-1), and the engine's slot
output all key off this. Until A7, no consumer Reserve CTA renders.

---

### 2b. JOURNEY B — Consumer-app reserve (AUTHENTICATED) `[the core 2.2 build]`

| # | Screen | User sees | User does | System / data behind it |
|---|---|---|---|---|
| B1 | **Swipe deck** (`SwipeableCards.tsx`) | A single-place `nightOut` card for the venue (supplied via `discover-cards` + place AI signals) | Swipes / taps to expand | `[SHIPPED]` supply. `[NET-NEW 2.2]`: card carries a `reservable` flag so the expanded view can show Reserve |
| B2 | **Expanded card** (`ExpandedCardModal.tsx`, nightOut branch) | The place detail + **`VenueExperiencesSection`** (brand experiences via `pg_brand_experiences_for_place`) + ActionButtons | Taps **Reserve a table** | `[NET-NEW 2.2]`: a Reserve affordance in the nightOut ActionButtons, gated on `reservable`. Mirrors the experience "Book" pattern (ORCH-1065). **No new card kind** — reserve from the place card. (§5 Q1) |
| B3 | **Reserve sheet — step 1 (party + date)** (`BaseBottomSheet`) | "Reserve at VENUE" · party-size stepper (respects table min/max) · date picker (bounded by `advance_window_days`) | Sets party + date → **See times** | `[NET-NEW 2.2]` sheet. No backend call yet |
| B4 | **Reserve sheet — step 2 (time)** | A grid of **real available slots**; full slots shown disabled ("full"), never hidden; selected slot gets the `accent.warm` ring | Picks a slot → **Continue** | `[SHIPPED engine]` `pg_venue_available_slots(brand, date, party_size)` returns the truthful slots (hours × turn-time × buffer × max-per-slot × capacity rules − existing `reservations`). Called as an **authenticated** caller (this journey is logged-in) |
| B5 | **Reserve sheet — step 3 (confirm / pay)** | Summary (venue · day · time · party) + EITHER `Confirm` (free) OR fee shown **all-in WYSIWYP** + `Confirm & pay` | Confirms | **FREE:** `[NET-NEW 2.2]` consumer-write RPC inserts `reservations` (source=`mingla`, created_via=`consumer`, consumer_user_id, status=`confirmed`). **FEE:** `[REUSE]` `ticket-checkout-create` → native Stripe/Paystack **PaymentSheet**, all-in server-computed (no client tax, no billing address); on success → reservation `confirmed` + `payment_status=paid` + `payment_intent_id` |
| B6 | **Confirmation** | Celebratory-restrained: checkmark draw + venue + summary + "Added to your plans"; haptic tick | Optionally → "my reservations" / Calendar | Push via OneSignal (`businessNotifyTriggers`). The `reservations` row is live |
| B7 | **Operator side (loop closes)** | Operator's Reservations → Today/Upcoming shows the new row with **"From Mingla" / "First Mingla booking"** badge, animating in via realtime | (operator) Confirm/Message/Seat… | `[SHIPPED]` operator list reads the same `reservations` table; realtime or refetch |
| B8 | **"My reservations" (consumer)** `[NET-NEW 2.2]` | The user's upcoming reservations (venue, time, party, fee/free, cancel policy) | View / **Cancel** | `[NET-NEW 2.2]` consumer surface reading `reservations WHERE consumer_user_id = me`. Cancel → status `cancelled_by_guest`; refund honored if before `cancel_cutoff_hours` (REUSE refund engine); no-show policy applies after the slot passes |

**Net-new in B:** B2 affordance, B3 sheet, B5 free-write RPC + fee handoff, B6 confirmation, B8 "my
reservations." Reused: B1 supply, B4 engine, B5-fee checkout, B6 push.

---

### 2c. JOURNEY C — Consumer-app reserve (ANONYMOUS) `[decision point — §5 Q3]`

Identical to Journey B **until the commit**. The fork is the single product decision of this journey.

| # | Screen | User sees | User does | System / data behind it |
|---|---|---|---|---|
| C1–C4 | **Deck → expand → reserve sheet step 1 → step 2** | Same as B1–B4 | Same | `[SHIPPED]` deck/expand are anon-RPC-readable. **Slot fetch (C4) hits the authenticated-only engine** → this is where the engine's anon-GRANT flip matters even inside the app if anon browsing reaches the picker. **Decision:** either (a) flip the engine anon-readable so anon users can *see* slots before being asked to sign in, or (b) gate Reserve-tap itself behind sign-in so anon never reaches C4 |
| C5 | **THE DECISION POINT — commit** | On tapping **Confirm / Confirm & pay** | Attempts to book | **Fork (Seth, §5 Q3):** |
| C5-opt-1 | **Force sign-in** (the current app pattern) | Sign-in modal (the existing save/book gate) | Signs in → returns to step 3 → completes as Journey B | Matches the live app: save/schedule/book require auth. Lowest build cost; reservation always has a `consumer_user_id`. **Recommended v1** |
| C5-opt-2 | **Guest path** (anon, email-only) | A buyer-details mini-form (name/email/E.164) like the web funnel, no account | Submits → completes | Reservation written with NULL `consumer_user_id` + guest fields; mirrors the anon-web shape. More friction-free but introduces an in-app guest identity the app doesn't have today |

**Map verdict:** the app's entire save/book surface already forces sign-in; the cheapest, most
consistent v1 is **C5-opt-1 (force sign-in at commit)**, leaving the genuine guest path to the
anon-WEB journey (§2d) where it already exists. Seth confirms in §5 Q3.

---

### 2d. JOURNEY D — Anonymous web buyer `[NET-NEW route + reuse the checkout funnel]`

The login-free public path. Reuses the entire `/checkout/...` buyer+payment+confirm machinery.

| # | Screen | User sees | User does | System / data behind it |
|---|---|---|---|---|
| D1 | **Public venue page** `/b/{brandSlug}` (`PublicBrandPage` → `PublicVenueDetail`) | Verified-venue badge, city, category, public hours, gallery + a **floating "Reserve a table" button** (parity with the trip/experience floating reserve button) | Taps Reserve | `[SHIPPED]` page; `[NET-NEW 2.2]` floating CTA gated on the `reservable` flag. **All-surface-parity rule:** the same CTA must land on web + business iOS/Android + consumer app |
| D2 | **Reserve entry** — new public route `[NET-NEW 2.2 + FLIP]` | A reserve surface (e.g. `/reserve/{venueSlug}` or an inline reserve panel on `/b/`) | Begins reserve | **`PUBLIC_BUYER_ROUTE_PREFIXES` gets a new prefix** (`/reserve/` or reuse `/booking/`) added to the single allowlist in `coldLoadAuthGates.ts` so a logged-out user can reach it (root `_layout.tsx` exempts it from the sign-in redirect) |
| D3 | **Party + date → time** (web slot picker) | Party stepper, date, then the **real slots grid** | Picks party/date/time | **`pg_venue_available_slots` called as an ANON caller** → requires the **engine GRANT flip to anon** (the load-bearing backend change; today it's authenticated-only). All-in pricing context resolved server-side |
| D4 | **Buyer details** (reuse `/checkout/.../buyer.tsx` pattern) | Public-buyer-themed form: **name / email / E.164 phone** | Fills + continues | `[REUSE]` the exact anon buyer form already used for ticket checkout; writes the guest identity onto the pending reservation |
| D5 | **Pay / confirm fork** | **FREE:** a confirm screen. **FEE:** redirected to **hosted Stripe Checkout** | Confirms or pays | **FREE:** `[NET-NEW 2.2]` `venue-reservation-create` edge fn (mirrors `ticket-checkout-create`) writes the reservation (source=`website`, NULL `consumer_user_id`, guest fields). **FEE:** the edge fn returns a **hosted Stripe Checkout URL** → `window.location.assign` → Stripe → return. Native PaymentSheet is NOT available on web |
| D6 | **Confirm finalize** (`/checkout/.../confirm.tsx` pattern) | "Table locked" confirmation | — | `[REUSE]` finalize via the confirm pattern (`ticket-checkout-confirm` analog / Realtime fallback); reservation → `confirmed` + `payment_status=paid` |
| D7 | **Receipt** `/o/{orderId}` | Order/reservation receipt (venue, day/time, party, fee/free, cancel policy) | — | `[REUSE]` the `/o/` order receipt surface, extended to render a reservation receipt |
| D8 | **Operator side (loop closes)** | Operator list shows the row with **source=`website`** | (operator) manage | `[SHIPPED]` same `reservations` table |

**Net-new in D:** the `/reserve/` route + allowlist entry (D2), the engine anon-GRANT (D3), the
`venue-reservation-create` edge fn (D5), the `/o/` reservation-receipt rendering (D7). Reused: the
public page (D1), the entire buyer+payment+confirm funnel (D4/D5-fee/D6), hosted Checkout, the order
receipt shell.

---

### 2e. WAITLIST sub-journey `[2.1 operator side SHIPPED; consumer-facing join = §5 Q4 fork]`

Triggered when the engine returns **no slot** for the requested party/time.

| # | Screen | User sees | User does | System / data behind it |
|---|---|---|---|---|
| W1 | **Reserve sheet — no availability** | After D3/B4 returns empty: "Fully booked Fri — try Sat?" + a **Join the waitlist** option (if the venue allows) | Taps Join waitlist | `pg_venue_available_slots` returned no slots for (date, party); the no-availability state offers waitlist |
| W2 | **Join waitlist form** | Party size · preferred time/zone · (contact: the signed-in user, or guest name + **E.164 phone** for SMS) | Submits | Inserts `venue_waitlist` (status=`waiting`, party_size, preferred_zone, consumer_user_id or guest fields). **Consumer-facing join is the fork (§5 Q4):** operator-only-add (v1) vs consumer self-join |
| W3 | **Operator waitlist view** | The queue (position, party, est wait, preferred seating) + **Notify** | Operator taps **Notify** when a table frees, or the engine auto-surfaces readiness | `[SHIPPED]` operator waitlist UI reads `venue_waitlist` |
| W4 | **"Your table's ready" SMS** | A text on the toll-free number (**+1 888 250-5351**, TWILIO_APPROVED) | Reads it | **SMS via Twilio** (`send-sms` path; creds in master keys). Sets `venue_waitlist.notified_at`, `status=notified`, `expires_at`. (PRD §9 Q5 recommended push-only v1; VISION decision-round-2 #7 says build Twilio SMS in ship 1 — **reconcile in §5 Q5**) |
| W5 | **Convert to reservation** | The notified guest confirms / the operator converts | Converts | `convert_to_reservation`: creates a `reservations` row from the `venue_waitlist` row + marks `converted` (+ `converted_reservation_id`). Loop closes into Journey B/D's confirmation + operator list |
| W6 | **Auto-expire** | (if no response) | — | After the configured window, `status=expired/lost`; lost-guest tracking feeds later Demand analytics |

---

## 3. FEATURE → SCREEN → USER-IMPACT MATRIX

Every venue-suite module across all stages. "Consumer screen" / "Anon-web screen" = where (if at all)
the feature surfaces to a guest; **"operator-only / invisible"** = no direct guest surface, only an
indirect effect. The point of this table: most of the suite is operator-only with INDIRECT guest
impact (Tables/Availability are invisible but *determine which slots the guest sees*).

| Feature / module | Ship | Operator screen | Consumer-app screen | Anon-web screen | (i) Consumer-app impact | (ii) Anon-web impact |
|---|---|---|---|---|---|---|
| **Reservations toggle** | 2.0 | Settings + Overview invite card | — (invisible) | — (invisible) | INDIRECT: flips the **Reserve** affordance on the deck/expand card on | INDIRECT: flips the **floating Reserve button** on `/b/` on |
| **Tables (inventory)** | 2.1 | Tables list + Add/Edit sheet | — (invisible) | — (invisible) | INDIRECT: table count/min/max **determines which party sizes & slots return** from the engine; a party of 6 only sees slots a 6-capable table can hold | INDIRECT: identical — bounds the slot grid in D3 |
| **Smart Capacity Rules** | 2.1 | Capacity-rules panel | — (invisible, except its effect) | — (invisible, except its effect) | INDIRECT: `party_fit` removes ill-fitting slots; `deposit_threshold` (8+) **routes the guest into the PAID path** even on a free venue → guest sees a fee at step 3 | INDIRECT: same — large parties get the fee + hosted Checkout |
| **Availability (hours/turn-time/buffer/max-per-slot/blackout)** | 2.1 | Availability editor | **Slot grid (B4)** — the visible output | **Slot grid (D3)** — the visible output | DIRECT (as output): the truthful slot grid the guest picks from is literally this config run through the engine | DIRECT (as output): same grid on web |
| **Availability engine `pg_venue_available_slots`** | 2.1a SHIPPED | (powers operator manual-create slot validation) | **B4 slot fetch** (authenticated) | **D3 slot fetch (needs anon GRANT)** | DIRECT: the engine IS the picker's data source | DIRECT: same; **the anon-GRANT flip is the gating change** |
| **Reservations lifecycle (confirm/seat/no-show/complete/cancel)** | 2.1 | Reservations list + detail | **Confirmation (B6) + "my reservations" cancel (B8)** | **Receipt (D7) + cancel-link** | DIRECT: the guest's booking status + their own cancel (subject to cutoff/no-show policy) | DIRECT: receipt + cancel via emailed/`/o/` link |
| **Waitlist** | 2.1 (op) / 2.2 (join) | Waitlist queue + Notify | **No-availability → Join (W1/W2) + "ready" push/SMS (W4)** | **No-availability → Join + SMS** | DIRECT: join when full; get the "table's ready" alert | DIRECT: same, SMS to E.164 |
| **Reservation fee (optional)** | 2.0 cfg / 2.2 charge | Settings fee config | **Step-3 all-in fee + native PaymentSheet (B5)** | **Step-3 fee + hosted Stripe Checkout (D5)** | DIRECT: WYSIWYP fee, native PaymentSheet, no tax form | DIRECT: WYSIWYP fee, hosted Checkout redirect |
| **No-show policy** | 2.0 cfg | Settings | **Shown in confirmation + my-reservations cancel terms (B6/B8)** | **Shown on receipt (D7)** | DIRECT (as terms): the guest sees the cancel cutoff + no-show consequence; (auto-forfeit = §5 Q6) | DIRECT: same on receipt |
| **Venue profile / hours / gallery (the preserved listing)** | always-on | Overview/Profile | **The deck `nightOut` card + expanded card (B1/B2)** | **`/b/` `PublicVenueDetail` (D1)** | DIRECT: the venue's face the guest browses before reserving | DIRECT: the public page they land on |
| **Overview command-center tiles** | 2.1 MVP | Overview bento | — (invisible) | — (invisible) | NONE (operator analytics) | NONE |
| **"Fill open tables" / Campaigns** | 2.4 (later) | Overview hero CTA + Campaigns | **INDIRECT: a campaign push/notification that routes the guest back to the venue card → reserve** | **INDIRECT: a campaign link to `/b/` → reserve** | INDIRECT (later): receives a "tables open tonight" nudge that re-enters Journey B | INDIRECT (later): receives an email/link that enters Journey D |
| **Demand** | 2.4 (later) | Demand views | — (invisible) | — (invisible) | NONE directly; **feeds** which venues/slots get promoted to the guest | NONE directly; same |
| **Menu / Items / Specials / Packages / Add-ons** | 2.3 (later) | Menu CMS | **Later: menu/package shown on expand; Packages = bookable experiences → checkout; Specials nudge** | **Later: menu on `/b/`; package booking via checkout** | INDIRECT now (storytelling/conversion); DIRECT later when packages are bookable | INDIRECT now; DIRECT later |
| **Menu Insights** | 2.4 (later) | Insights | — (invisible) | — (invisible) | NONE | NONE |
| **Guests (CRM)** | later | Guests profiles | — (invisible) | — (invisible) | INDIRECT: VIP/regular tags can shape future offers/treatment | INDIRECT: same |
| **Feedback (private)** | later | Feedback module | **Later: post-visit feedback prompt** | **Later: post-visit feedback link** | DIRECT later: a private post-visit prompt | DIRECT later: emailed feedback link |
| **Settings / team roles** | 2.0 | Settings | — (invisible) | — (invisible) | NONE | NONE |

**Read of the matrix:** only **5 features have a DIRECT consumer surface in 2.2** — Availability
(as the slot grid), the engine, Reservation lifecycle, Waitlist, and the Reservation fee — plus the
always-on Venue profile/page. **Everything else is operator-only with INDIRECT impact** (Tables &
Capacity Rules silently bound the slot grid; Demand/Campaigns later *route* the guest in). This is
the explicit confirmation that **2.2's surface is small and engine-driven** — the picker + the
free/fee fork + the route/GRANT plumbing.

---

## 4. WHAT 2.2 MUST BUILD (net-new on consumer + web, derived from the seams)

Ordered by load-bearing-ness. Every item cites the seam it fills.

1. **Engine anon-GRANT flip `[FLIP — the keystone]`.** `pg_venue_available_slots` is
   authenticated-only today. The anon-web journey (D3) — and any anon consumer-app slot preview
   (C4) — needs an anon-readable slot path. **This is where the authenticated→anon decision lands.**
   Either GRANT the fn to anon (read-only, no PII, returns only slot times + capacity) or wrap it in
   an anon-callable RPC that calls it with elevated rights. Without this, anon web cannot show
   truthful slots.

2. **`venue-reservation-create` edge function `[NET-NEW]`.** Mirrors `ticket-checkout-create`:
   validates the slot against the engine, writes the `reservations` row, and — for the FREE path —
   returns success; for the FEE path — returns a **native PaymentSheet client secret (app)** OR a
   **hosted Stripe Checkout URL (web)**, riding `allInPricingEngine` + brand pass/absorb + Paystack
   routing. This is the single write path for both consumer-app and anon-web reservations.

3. **The reserve flow UI `[NET-NEW, all surfaces]`** — the 3-step sheet (party+date → slot grid →
   confirm/pay) bound to the engine, with the **free-confirm vs all-in-fee fork**. Built once,
   rendered on consumer app (native PaymentSheet) and adapted to web (hosted Checkout redirect via
   the `/checkout/...` funnel pattern).

4. **Deck/expand Reserve affordance `[NET-NEW]`** — a **Reserve action on the `nightOut` /
   single-place expanded card** (`ExpandedCardModal` ActionButtons), gated on the `reservable` flag,
   mirroring the experience "Book" pattern (ORCH-1065). **No new deck card kind** (§5 Q1) — reserve
   from the place card; `placeId === place_pool.id`.

5. **Public-page Reserve entry + the `/reserve/` route + allowlist entry `[NET-NEW + FLIP]`** — a
   **floating "Reserve a table" button** on `PublicBrandPage`/`PublicVenueDetail` (all-surface
   parity), and a new public route added to **`PUBLIC_BUYER_ROUTE_PREFIXES`** in
   `coldLoadAuthGates.ts` so logged-out users reach it (reuse `/booking/` or add `/reserve/`).

6. **Reuse the anon-web buyer+payment+confirm funnel `[REUSE]`** — `buyer.tsx` (name/email/E.164),
   the hosted-Checkout redirect, `confirm.tsx` finalize, and the **`/o/` receipt extended to render a
   reservation receipt** (D4–D7). Do not rebuild; route the reservation fee through it.

7. **Consumer "my reservations" surface `[NET-NEW]`** — a list reading `reservations WHERE
   consumer_user_id = me`, with cancel (honoring `cancel_cutoff_hours` + refund engine + no-show
   policy). The post-purchase home for app bookings (B8).

8. **The consumer auth/guest decision `[PRODUCT]`** — implement §5 Q3: recommended **force sign-in
   at commit** in the app (consistent with the live save/book gate), keeping the genuine guest path
   on anon web only.

9. **Confirmation + push `[NET-NEW UI + REUSE push]`** — the celebratory confirmation screen (B6/D6)
   + OneSignal confirmation/status pushes + the waitlist-ready SMS via Twilio (W4) if §5 Q5 lands SMS
   in ship 1.

10. **All-surface parity + OTA `[NON-NEGOTIABLE]`** — the Reserve surface must reach parity on **web
    + business iOS/Android + consumer app** (incl. the floating reserve button), per the memory
    rule; OTA the consumer dev channel on 2.2 close.

---

## 5. OPEN QUESTIONS FOR SETH (the genuine product forks)

1. **Deck card kind — own card vs reserve-from-the-place-card?** Today a physical venue surfaces as a
   single-place `nightOut` card whose expand already renders `VenueExperiencesSection`. **Recommend:
   reserve FROM the place card** (a Reserve action on the expanded `nightOut`/place card, mirroring
   the experience "Book"), NOT a new standalone "venue" deck card kind. Confirm — or do you want a
   dedicated reservable-venue card with its own front-load treatment?

2. **Anon web — truly login-free, or guest-email-only?** The PRD assumes login-free via the route
   allowlist; the recon confirms `/b/` and `/checkout/...` are genuinely logged-out-reachable, and
   the buyer funnel already collects name/email/E.164. **Recommend: keep anon web login-free,
   guest-email-only** (no account, identity = email + phone on the reservation). Confirm.

3. **Consumer app — guest/anon reserve path, or force sign-in?** The app gates all save/book behind a
   sign-in modal today. **Recommend: force sign-in at the COMMIT step (C5-opt-1)** — cheapest, most
   consistent, every app reservation carries a `consumer_user_id`. The alternative (C5-opt-2,
   in-app guest email path) adds an identity model the app doesn't have. Which?

4. **Waitlist — consumer self-join, or operator-add-only in v1?** The operator waitlist is shipped.
   Does the GUEST get a "Join the waitlist" affordance when the slot grid is empty (W1/W2), or is the
   waitlist operator-add-only in v1 with consumer self-join deferred? **Recommend: consumer self-join
   in v1** (it's the natural catch when the engine returns no slot — otherwise the no-availability
   state is a dead end).

5. **Waitlist-ready alert — SMS in ship 1 (VISION) vs push-only (PRD)?** VISION decision-round-2 #7
   says build Twilio SMS now (toll-free TWILIO_APPROVED, +1 888 250-5351); PRD §9 Q5 recommended
   push-only v1. These conflict. **Recommend: follow VISION — ship the Twilio SMS path in v1** (it's
   the stated differentiator for waitlist conversion and the number is approved), with OneSignal push
   as the in-app companion. Confirm the reconciliation.

6. **Free reservations — skip checkout entirely?** **Recommend: yes** — a free reservation is a
   direct `venue-reservation-create` write with NO Stripe touch (no PaymentSheet, no hosted Checkout,
   no `/checkout/...` redirect). Only fee/deposit reservations enter the checkout/Checkout path.
   Confirm — this is what keeps the free loop a one-tap commit.

7. **How does a reservation appear post-booking — deck/expand vs a separate "Reserve/My Plans"
   entry?** **Recommend:** a reservation is NOT a deck card; it lands in a consumer **"my
   reservations" / Plans** surface (B8) + a confirmation push. The deck stays a *discovery* surface.
   Confirm the post-booking home (Plans/Calendar vs a Saved/Reservations tab).

8. **No-show fee enforcement — auto-forfeit vs flag-only in v1?** (Carries PRD §9 Q3.) VISION
   decision-round-2 #7 says build auto-forfeiture; PRD recommended flag-only v1. **Recommend: confirm
   the VISION call (auto-forfeit) only if the capture/dispute complexity is explicitly scoped in the
   2.2 SPEC; otherwise flag-only v1.** Which?

---

## 6. SUMMARY (for the caller)

**The four journeys, one line each:**
- **A · Operator setup** (`[SHIPPED 2.0/2.1]`): Hub→Venue→toggle Reservations → add Tables → set
  Availability/turn-times → set optional fee + no-show policy → venue becomes *reservable* (flips
  the consumer/web Reserve affordances on).
- **B · Consumer-app reserve (authenticated)**: deck `nightOut` card → expand → **Reserve a table** →
  party+date → **`pg_venue_available_slots`** slot grid → free `Confirm` OR all-in fee via **native
  PaymentSheet** → confirmation → lands in operator list (source=`mingla`) + consumer "my
  reservations."
- **C · Consumer-app reserve (anonymous)**: same path until the commit, then **force sign-in at the
  commit step** (recommended) vs an in-app guest-email path (the §5 Q3 fork).
- **D · Anonymous web buyer**: `/b/{slug}` `PublicVenueDetail` → floating **Reserve a table** → new
  `/reserve/` route (added to `PUBLIC_BUYER_ROUTE_PREFIXES`) → engine slots (**needs anon GRANT**) →
  buyer details (name/email/E.164) → free confirm OR fee via **hosted Stripe Checkout redirect** →
  `/o/` reservation receipt → operator list (source=`website`). Plus the **waitlist sub-journey**
  (no slot → join → Twilio "table's ready" SMS → convert).

**Biggest net-new build items for 2.2:** (1) the **engine anon-GRANT flip** on
`pg_venue_available_slots` (the keystone — authenticated-only today); (2) the **`venue-reservation-create`
edge fn** (the single write path, free + fee, native-PaymentSheet vs hosted-Checkout fork); (3) the
**3-step reserve flow UI** bound to the engine with the free/fee fork; (4) the **deck/expand Reserve
affordance** (no new card kind) + the **public-page floating Reserve button + `/reserve/` route in
the allowlist**; (5) the **consumer "my reservations"** surface — all under the **all-surface-parity
+ OTA** rule.

**Top open questions for Seth:** (Q3) consumer app — force sign-in at commit vs in-app guest path;
(Q5) waitlist-ready alert — Twilio SMS in v1 (VISION) vs push-only (PRD) — a real conflict to
reconcile; (Q4) waitlist consumer self-join vs operator-add-only; (Q1) reserve-from-the-place-card vs
a dedicated venue deck card; (Q8) no-show auto-forfeit vs flag-only.

---

*End of journey map. This drives the ORCH-2.2 consumer-booking SPEC (mingla-forensics), pending
Seth's answers to §5 — especially Q3 and Q5, which shape the auth model and the notification path.*

---

## DECISIONS LOCKED (Seth, 2026-06-16) — consumer/web reservation journey

These resolve the §5 open forks and bind the future 2.2 (consumer booking) spec:

1. **Deck surface = reserve from the EXISTING place card** (Q1). The reservable venue stays a single-place card on the swipe deck; a "Reserve a table" action is added in its expanded view (`ExpandedCardModal` nightOut branch, alongside `VenueExperiencesSection`). NO new dedicated "venue" deck card kind, no new deck supply — fastest, keeps reservations next to the venue's experiences/menu.
2. **Consumer-app booking = light one-tap sign-in** (Q2). The existing Apple/Google one-tap sign-in is required before CONFIRMING a reservation on the app — unlocks "my reservations", reminders, and no-show history. **Anonymous WEB stays fully login-free** (the `PUBLIC_BUYER_ROUTE_PREFIXES` guest path is unchanged). So: web = guest/no-login; app = one-tap sign-in at commit.
3. **Free reservations STILL pass through a confirm/review step** (Q3) — NOT skip-to-instant. Even a no-fee reservation shows a short confirm/review screen before booking, so free and paid share ONE consistent flow. (Paid adds the PaymentSheet/hosted-Checkout step after review.)

**Already resolved (earlier, supersedes the §5 VISION-vs-PRD flags):** waitlist "table's ready" = **Twilio SMS** on the approved toll-free (+1 888-250-5351); no-show fee = **auto-forfeit**. Push-only / flag-only (PRD §9) are SUPERSEDED.

**Build-order note:** this map covers **2.2 (consumer/web booking)**. The next BUILD in sequence is **2.1b (operator Reservations lifecycle + Waitlist + SMS)**, which must exist before 2.2 puts guests on it. 2.2 then implements this journey + flips the availability engine to guest-callable (the keystone).

> **CORRECTION (Seth, 2026-06-17) — decision #2 simplified:** the consumer app gates auth at the ROOT (you must be signed in to use the app), so a user reaching the reserve flow is ALREADY authenticated — there is **NO sign-in step in the 2.2b consumer reserve flow**; the reservation simply attaches to the signed-in user. The sign-in/auth distinction applies ONLY to the **anonymous web (2.2c)**, where the booking is **login-free guest** (name/email/E.164 phone, no account). Supersedes the earlier 'one-tap sign-in at confirm on app' wording.
