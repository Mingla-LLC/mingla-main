# PRD — META-ORCH-1148 — Venue Management Suite, First Ship: the Booking Loop

- **Meta-ORCH:** META-ORCH-1148 (Phase 2 of the venue tab; Phase 1 = ORCH-1145, the listing→Hub-tab move).
- **Status:** PRD (product contract for the first ship). NOT a build spec, NOT code. Forensics writes the build SPECs per sub-ORCH after Seth answers the open questions in §9.
- **Anchor:** `/Users/sethogieva/Desktop/mingla-main/`.
- **Binding inputs:** `Mingla_Artifacts/specs/VISION_META-ORCH-1148_VENUE_MANAGEMENT_SUITE.md` ("DECISIONS LOCKED" + "FIRST-SHIP SCOPE" are non-negotiable) · `Mingla_Artifacts/specs/SPEC_ORCH-1145_VENUE_LISTING_TO_HUB_TAB.md` (the base tab) · live code cited inline.
- **Author altitude:** product lead. Every recommendation below is grounded in source that was read (citations inline). NET-NEW vs REUSE is called out explicitly throughout.

> **First-ship rule (Seth, locked):** ship a THIN END-TO-END booking loop. Operator can stand up Tables + Availability + Reservations + Waitlist; a Mingla consumer can actually reserve from the app deck / public venue page; the reservation appears in the operator list. Money is the venue's choice (free default, optional reservation fee on the existing all-in Stripe engine). One "Reservations" toggle unlocks the suite. The full 11-module suite is framed here; only the loop is detailed.

---

## 0. The full suite at a glance (frame only — DO NOT build beyond the loop)

The vision doc enumerates 11 modules. This PRD details only the bold ones (first ship). The rest are framed so the data model and shell leave the seams.

| # | Module | First ship? | Powered mostly by |
|---|--------|-------------|-------------------|
| 1 | Overview (command center) | **Partial — MVP tiles only** | derived from net-new reservation/waitlist tables |
| 2 | **Tables (inventory + Smart Capacity Rules)** | **YES** | NET-NEW |
| 3 | **Availability (hours / turn-time / buffers / blackouts)** | **YES** | NET-NEW |
| 4 | **Reservations (manual create + lifecycle)** | **YES** | NET-NEW + reuse Stripe for the fee |
| 5 | **Waitlist (MVP)** | **YES** | NET-NEW (distinct from the event `waitlist_entries` primitive — see §3.7) |
| 6 | Menu CMS (menus/items/specials/packages/add-ons/insights) | NO (2.3) | REUSE `parse-restaurant-menu`, `parse-play-activities`, experiences engine, `ticket-checkout-create` |
| 7 | Demand | NO (2.4, the next pillar) | REUSE place AI signal scores, `run-place-intelligence-trial`, the reservation data this ship generates |
| 8 | Guests (CRM) | NO | NET-NEW thin, fed by reservations |
| 9 | Campaigns | NO (2.4, with Demand) | REUSE `marketing-send` + brand/event audiences + OneSignal |
| 10 | Feedback (private) | NO | NET-NEW + reuse the existing venue-feedback sheet pattern |
| 11 | **Settings (venue profile, hours, reservation rules, fee, roles)** | **YES (MVP subset)** | REUSE brand pricing toggles; NET-NEW reservation-rule config |

**First ship = modules 2, 3, 4, 5, the Settings subset, the Overview MVP tiles, and the consumer booking surface.** Everything else is a seam.

---

## 1. Problem + JTBD

### 1.1 Operator (venue owner / host / manager)
**Job:** *"When I have empty tables, help me fill them with the right guests, and let me control exactly how many people I seat, when, and on which table — without a separate reservations product."*

Sub-jobs:
- Stand up my table inventory and the rules for who sits where (no 2-tops seating parties of 6; 8+ needs a deposit) in minutes, not a floor-plan editor.
- Control capacity by time: turn times by party size, buffers, max-per-slot, blackouts — so the kitchen/floor never gets overloaded.
- Take and manage reservations (manual phone/walk-in AND inbound Mingla) in one list with a real lifecycle (confirm → seat → no-show / complete / cancel).
- Capture overflow demand on a waitlist and convert it.
- Optionally protect against no-shows / monetize prime slots with a reservation fee, using the SAME money rails as my events/experiences (no new Stripe setup).

### 1.2 Consumer (Mingla user)
**Job:** *"When I'm deciding where to go tonight, let me lock a table at a vibe-matched place in a few taps — see real availability for my party + time, pay only if there's a fee, and trust it's confirmed."*

This is the existing Mingla decision-engine job ("Less Planning. More Living." → *Find the plan that fits the vibe*) extended from "discover / save / buy a ticket" to "reserve a table." The consumer already books experiences and buys event tickets through the deck + public page; reserving a table is the missing primitive.

### 1.3 Positioning vs OpenTable / Resy
OpenTable and Resy are **supply tools bolted onto a separate demand marketplace the venue rents**. Mingla's wedge is the inverse: **the demand graph is already here.** Mingla already routes vibe-matched, location-resolved users to venues via the consumer deck (`pg_eligible_experiences_for_deck` + `discover-cards`) and the place AI signal scores. The reservation product is the **conversion layer on top of demand Mingla already owns** — a venue turns on Reservations and immediately becomes bookable by the exact audience already being recommended to it. We do not sell access to diners; we already match them, and now we let them commit.

- OpenTable/Resy charge per-cover + a SaaS fee for a network the venue doesn't own. Mingla reservations are **free by default** (venue's-choice fee), riding rails the venue already uses for tickets.
- OpenTable's floor-plan editor is heavyweight. Mingla ships **inventory, not floors** (vision §2) — tables as a list with smart capacity rules, deliberately compact.
- The differentiator is sequenced RIGHT AFTER the loop: **Demand + Campaigns** (2.4), where Mingla turns "18 seats still open at 7:30" into a one-tap push to vibe-matched saved users via `marketing-send` + the existing audiences. No competitor can do this because no competitor owns the upstream decision engine.

---

## 2. NET-NEW vs REUSE — the infra split (audited)

**Confirmed by reading source:**

### REUSE (large — do NOT rebuild)
- **All-in money engine** — `supabase/functions/ticket-checkout-create/index.ts` + `_shared/allInPricingEngine.ts` (`buildPricingBreakdown`, `computeBuyerSubtotal`, `taxBehaviorForRegion`, `MINGLA_SERVICE_FEE_BPS`). The reservation fee rides this verbatim: brand `defaultPassTax` / `defaultPassMinglaFee` / `defaultPassServiceFee` toggles (`mingla-business/src/types/brand.ts:248-250`), WYSIWYP all-in, native PaymentSheet, venue-sourced tax (`events.venue_tax_address`), Paystack routing for Nigeria already wired (`resolveProviderRouting`). **The checkout function already accepts an optional `eventDateId` (`index.ts:237`)** — the date/slot binding the consumer flow needs already exists.
- **Brand pricing toggles** — `defaultPassTax/MinglaFee/ServiceFee`, `defaultCurrency`, `pricingRegion`, `paymentProvider` all live on `Brand`. The reservation-fee config inherits these (Mingla's locked money model: venue sets pass-or-absorb once).
- **Consumer deck supply** — `pg_eligible_experiences_for_deck` RPC + `discover-cards/index.ts:275` source + the `experience_intents` vibe gate (`index.ts:321`). The reservable-venue deck card reuses this supply pattern (see §3.8 / §5.2) — the venue is ALREADY surfaced via place AI signals; we add a "Reserve" affordance + availability binding.
- **Public venue page** — `mingla-business/src/components/brand/PublicBrandPage.tsx` (the `/b/{slug}` surface). The consumer "Reserve" entry point on the public page mounts here (the anon-buyer route allowlist already covers public buyer routes — `coldLoadAuthGates.ts` `PUBLIC_BUYER_ROUTE_PREFIXES`, per memory).
- **Venue tab shell** — ORCH-1145's `VenueListingContent` + `HubSubNav` `venue` pill + the `hasPhysicalLocation || placePoolId` gate. The suite shell restructures this; the listing becomes Overview/Profile (the always-on base).
- **OneSignal push** — `_shared/push-utils.ts` + `businessNotifyTriggers.ts` for reservation confirmations / status changes / waitlist-ready (operator + consumer).
- **Venue identity** — `brands` (owner/team), `place_pool` (the physical place row, geo, hours JSON `opening_hours`, `serves_brunch/lunch/dinner` flags at `baseline:7129+`). Reservations attach to the brand and (when present) the `place_pool_id`.
- **Team / RLS pattern** — `biz_is_brand_member_for_read_for_caller(brand_id)` (used by `waitlist_entries` RLS at `baseline:14196`) is the exact membership gate the new tables reuse.
- **Feedback sheet pattern** — `VenueClaimFeedbackSheet` + `Toast` (reused later for module 10).

### NET-NEW (must build)
- **Reservation data model** — tables inventory, table attributes + smart-capacity-rules, availability/turn-time/buffer/blackout config, reservations + lifecycle, waitlist (reservation-flavored, NOT the event one — §3.7), optional reservation-fee config. §3 below.
- **Availability engine** — given a venue's hours + turn-times-by-party-size + buffers + max-per-slot + blackouts + already-booked reservations, compute bookable slots for a (date, party_size). This is the core net-new compute. NET-NEW but **server-side, deterministic, RPC-shaped** (mirrors how the deck/checkout engines are pure server functions).
- **Operator booking UI** — Tables / Availability / Reservations / Waitlist sub-views inside the venue suite shell.
- **Consumer reserve UI** — date/party/time picker bound to the availability RPC, optional PaymentSheet, confirmation; deck card + public-page affordance.
- **Settings (reservation rules subset)** — turn times, windows, fee config, blackout management.

### Money-model note (REUSE, do not invent)
The reservation fee is **NOT a new payment path.** A reservation with a fee is modeled as a single-line checkout through `ticket-checkout-create` (fee = the line amount, qty 1), so the all-in breakdown, Stripe/Paystack routing, refund engine, and WYSIWYP display all apply unchanged. The reservation row stores the resulting `payment_intent` / order linkage. (Implementation detail for forensics: either a synthetic ticket-type-backed line or a small additive `reservation` mode on the checkout function — §9 Q4 is the fork.)

---

## 3. NET-NEW DATA MODEL (proposed shapes — forensics finalizes exact columns/RLS)

All new tables: `brand_id uuid NOT NULL` FK → `brands`, RLS via `biz_is_brand_member_for_read_for_caller(brand_id)` for read and a writer policy (service-role for consumer writes, brand-member for operator writes — mirrors `waitlist_entries`). Optional `place_pool_id uuid` FK → `place_pool` for venues with a linked physical place. Timestamps `created_at/updated_at`.

### 3.1 `venue_tables` — inventory (REUSE: none. NET-NEW)
The table = a seatable unit (vision §2: "inventory, not floors").

| column | type | notes |
|--------|------|-------|
| id | uuid pk | |
| brand_id | uuid not null | FK brands |
| place_pool_id | uuid null | FK place_pool |
| name | text not null | "T2", "Patio 4" |
| capacity | int not null | nominal seats |
| min_party | int null | smart-rule input |
| max_party | int null | smart-rule input (allow 5 on a 4-top if set) |
| zone | text null | enum-ish: indoor/outdoor/private_room/bar/patio |
| seating_type | text null | high_top/booth/lounge/standard |
| combinable | bool default false | |
| accessible | bool default false | |
| is_active | bool default true | inactive = not bookable |
| reservation_policy | text default 'reservable' | `reservable` / `walk_in_only` (bar) / `approval_required` (private room) |
| notes | text null | |

### 3.2 `venue_table_rules` — Smart Capacity Rules (NET-NEW; see §6 for the MVP rule schema)
A normalized rules table OR a `jsonb rules` column on settings. **Recommendation: a small typed `venue_capacity_rules` table** so rules are queryable by the availability engine and individually toggleable. See §6 for the shipped rule kinds.

### 3.3 `venue_availability_config` — hours / turn-times / buffers / windows (NET-NEW)
One row per brand (or per service period). REUSE `place_pool.opening_hours` as the seed/import source, but reservations need an editable, reservation-specific config (turn times, max-per-slot) the venue hours JSON doesn't carry.

| column | type | notes |
|--------|------|-------|
| brand_id | uuid not null | |
| service_periods | jsonb | `[{name:'Dinner', days:[2..0], start:'17:00', end:'22:00'}]` |
| turn_times | jsonb | `{p2:75, p4:90, p6:120}` minutes by party-size bucket |
| buffer_minutes | int default 0 | between-seating buffer per table |
| max_reservations_per_slot | int null | global throttle |
| slot_granularity_minutes | int default 15 | |
| advance_window_days | int default 30 | how far out bookable |
| min_notice_minutes | int default 0 | |

### 3.4 `venue_blackouts` — blackout/holiday dates (NET-NEW)
| brand_id | date_start | date_end | reason text | applies_to (all / specific table_ids / zone) |

### 3.5 `venue_reservation_settings` — toggle + fee config (NET-NEW, REUSE fee semantics)
The single source for "is this venue reservable" and the optional fee.

| column | type | notes |
|--------|------|-------|
| brand_id | uuid pk | one row per brand |
| reservations_enabled | bool default false | **the locked single toggle** (§ vision dec 4) |
| fee_enabled | bool default false | free by default |
| fee_amount_cents | int null | the reservation fee per booking (flat, MVP) |
| fee_currency | text null | inherits `brands.default_currency` |
| fee_refundable | bool default true | refund on cancel-before-cutoff |
| cancel_cutoff_hours | int default 24 | no refund inside cutoff |
| no_show_fee_policy | text default 'forfeit' | `forfeit` / `none` |
| pass_fee / pass_tax overrides | bool null | inherit brand `defaultPass*`; per-venue override optional |

**REUSE:** the pass/absorb + tax behavior come from the brand toggles + `allInPricingEngine`; this table only adds the venue-reservation-specific amount + refund/cancel policy.

### 3.6 `reservations` — the main list (NET-NEW; the heart)
| column | type | notes |
|--------|------|-------|
| id | uuid pk | |
| brand_id | uuid not null | |
| place_pool_id | uuid null | |
| table_id | uuid null | assigned table (null until seated/assigned) |
| reserved_for | timestamptz not null | the slot start (venue-local resolved via `place_pool.utc_offset_minutes`) |
| party_size | int not null | |
| status | text not null | lifecycle — see below |
| source | text not null | `mingla` / `phone` / `walk_in` / `website` / `instagram` |
| guest_name | text | |
| guest_phone_e164 | text null | REUSE `normalizePhoneE164` |
| guest_email | text null | |
| consumer_user_id | uuid null | set when source=`mingla` (links to the booking user) |
| occasion | text null | birthday/date/anniversary |
| guest_notes | text null | |
| tags | text[] | VIP/first_time/regular/high_risk_no_show |
| fee_cents | int null | the reservation fee charged (0/null = free) |
| payment_intent_id | text null | REUSE checkout linkage |
| payment_status | text null | `none` / `paid` / `refunded` |
| event_date_id | uuid null | REUSE — when the venue exposes slots as `event_dates` (see §9 Q4) |
| created_via | text | `operator` / `consumer` |

**Lifecycle states (status):** `requested` (approval-required tables only) → `confirmed` → `seated` → `completed`; plus `no_show`, `cancelled_by_guest`, `cancelled_by_venue`, `waitlisted`. The operator list views (vision §4): Today · Upcoming · Waitlist · Completed · No-shows · Canceled map directly to status filters.

**Relationship to `brands`/`place_pool`/`events`:** a reservation belongs to a `brand` (the venue operator account), optionally references its `place_pool` row (geo/hours), and OPTIONALLY references an `event_dates` row IF we model bookable slots as event_dates to reuse `ticket-checkout-create`'s `eventDateId` path (the recommended reuse — §9 Q4). It is NOT an `events` row itself; reservations are a distinct primitive.

### 3.7 `venue_waitlist` — MVP (NET-NEW — and DISTINCT from `waitlist_entries`)
**Audit finding (important):** the existing `public.waitlist_entries` table (`baseline:10126`, ORCH-0948) is **event-ticket-scoped** — it FKs `event_id` + `ticket_type_id` (`baseline:13995,14000`) and its statuses are `waiting/invited/converted/expired` for sold-out ticket types. A restaurant waitlist is a different shape (live, party_size, preferred seating, est-wait, SMS-when-ready, auto-expire). **Recommendation: a NET-NEW `venue_waitlist` table** — do NOT overload `waitlist_entries`. Reuse only the *status vocabulary pattern* (`waiting → notified → converted → expired/lost`) and the RLS shape.

| brand_id | guest_name | guest_phone_e164 | party_size | preferred_zone | quoted_wait_minutes | status | notified_at | expires_at | converted_reservation_id | consumer_user_id null |

`convert_to_reservation` = create a `reservations` row from a `venue_waitlist` row + mark converted.

### 3.8 Consumer-deck binding (REUSE)
No new supply table. The reservable venue surfaces on the deck via the **existing place/experience supply**; the NET-NEW piece is a per-card "reservable" flag derived from `venue_reservation_settings.reservations_enabled = true`, and the availability is computed on-demand by the availability RPC when the user taps Reserve.

---

## 4. Operator user stories (MVP)

**Toggle / shell (2.0)**
- As an operator on a brand with `hasPhysicalLocation || placePoolId`, I see a **Reservations** capability toggle in the Venue tab. Turning it on flips `venue_reservation_settings.reservations_enabled = true` and unlocks the suite sub-views (Overview already on; Tables / Availability / Reservations / Waitlist / Settings appear). My existing listing stays as Overview/Profile (always-on base).
- As an operator I land on an empty-state that tells me the 3 things to do before I'm bookable (add a table, set hours/turn-times, you're live).

**Tables (2.1)**
- Add a table: name, capacity, min/max party, zone, seating type, combinable, accessible, reservation policy, notes. (`venue_tables` insert.)
- Edit / deactivate a table.
- Set Smart Capacity Rules (the MVP set — §6): min/max party vs table size; deposit/fee threshold at party-size N; blackout a table/zone.

**Availability (2.1)**
- Set service periods (Dinner Tue–Sun 17:00–22:00; Brunch Sat–Sun 10:00–15:00).
- Set turn times by party size (P2 75 / P4 90 / P6+ 120).
- Set buffer + max-reservations-per-slot.
- Add a blackout date / holiday hours.

**Reservations (2.1)**
- Create a manual reservation (phone/walk-in): guest, party, date/time (validated against availability), table (optional), occasion, notes, tags.
- Confirm a `requested` reservation; mark **seated**; mark **no-show**; mark **completed**; cancel (venue side).
- Filter views: Today / Upcoming / Waitlist / Completed / No-shows / Canceled.
- See an inbound **Mingla** reservation appear in the list automatically (source=`mingla`) — this is the loop closing.

**Waitlist (2.1)**
- Add a guest to the waitlist (party, preferred zone, quoted wait).
- Notify-when-ready (OneSignal/SMS — §9 Q5 on SMS).
- Convert a waitlist entry → reservation.
- Auto-expire after the configured window.

**Settings (2.0 subset)**
- Set the optional reservation fee (amount, refundable, cancel cutoff, no-show policy). Inherits the brand pass/absorb + currency.
- Reservation rules (windows, advance days, min notice).

---

## 5. Consumer booking loop user stories (2.2)

**Discover (REUSE surfaces)**
- As a Mingla user on the **app deck**, a reservable venue's card shows a **Reserve** affordance (in addition to existing save/discover). The venue is already supplied to my deck via place AI signals / `discover-cards`; the new bit is the reservable flag + CTA.
- As a Mingla user on the **public venue page** (`/b/{slug}` → `PublicBrandPage`), I see a **Reserve a table** entry point.

**Book (NET-NEW UI + NET-NEW availability RPC + REUSE checkout)**
- I pick a **date**, **party size**, then see **real available time slots** (computed by the availability RPC from hours/turn-times/buffers/max-per-slot/blackouts minus existing reservations). No fake slots.
- If the venue has **no reservation fee**: I confirm and I'm booked (a `reservations` row, source=`mingla`, status=`confirmed`).
- If the venue has a **reservation fee**: I see the all-in WYSIWYP amount upfront (no surprise), pay via the **native PaymentSheet** (REUSE `ticket-checkout-create` → Stripe/Paystack), and on success the reservation is `confirmed` + `payment_status=paid`.
- I get a **confirmation** (screen + push via OneSignal): venue, date/time, party, table-or-zone, fee/free, cancel policy.

**Loop closes**
- The reservation appears in the operator's Reservations → Today/Upcoming list within seconds (the operator list reads the same `reservations` table; realtime or refetch).

**Exactly which existing surfaces change (consumer):**
- `app-mobile` deck card component (add Reserve CTA gated on reservable flag) — NET-NEW affordance on an existing card.
- `app-mobile` new Reserve sheet/flow (date/party/slot picker + PaymentSheet handoff) — NET-NEW.
- `PublicBrandPage.tsx` (business-app + web) — add a Reserve entry point — small NET-NEW affordance, must hit **all-surface parity** (web + business iOS/Android + consumer app, per the non-negotiable memory rule).
- `ticket-checkout-create` — additive `reservation` handling OR reuse via synthetic line (§9 Q4) — small additive, NOT a rewrite.

---

## 6. Smart-Capacity-Rules MVP (rule schema + ship order)

**Rule schema (proposed `venue_capacity_rules`):**
```
{ id, brand_id, kind, params jsonb, table_id|zone|null (scope), is_active }
```
The availability engine evaluates active rules when computing bookable slots / validating a manual reservation.

**SHIP NOW (the 3 highest-value, per the prompt):**
1. **`party_fit`** — enforce min/max party vs table size: never seat a party below `min_party` or above `max_party`/`capacity` on a table. (Kills "2 people on a 6-top"; allows "5 on a 4-top" when `max_party` is raised.) Params: none beyond the table's own min/max — this rule is the engine honoring `venue_tables.min_party/max_party`.
2. **`deposit_threshold`** — parties of N+ require the reservation fee (deposit) even if the venue is otherwise free. Params: `{min_party_for_fee: 8}`. Routes those bookings through the paid checkout path.
3. **`blackout_scope`** — block bookings for a table/zone/date (patio reservation-off, table out of service). Params: `{scope, date_range?}`. (Overlaps `venue_blackouts`; the rule form is for table/zone-scoped blocks, the blackout table for whole-venue dates — forensics may merge.)

**SHIP LATER (named, not built):** `approval_required` (private room → `requested` status), `walk_in_only` (bar → not bookable online), `weekend_only` (patio), `combinable` auto-merge logic, `availability_suggestions` (the AI "you're blocking too much at 7 PM" — needs Demand, 2.4).

---

## 7. Sub-ORCH breakdown (sequenced first-ship)

> Dependency chain: **2.0 → 2.1 → 2.2** (strictly serial on schema; 2.0 lands the model 2.1 builds on, 2.1 lands the availability RPC 2.2 consumes). Each sub-ORCH ships independently testable.

### ORCH-2.0 — Toggle + Suite Shell + Settings + Data Model
**Scope:** the single "Reservations" capability toggle on the Venue tab; restructure the Venue tab into the suite shell (two-column desktop-web / responsive web-phone / mobile, with ORCH-1145's listing preserved as the Overview/Profile base); Settings MVP (venue profile reuse, hours, reservation rules, optional reservation fee, team roles stub); and **all NET-NEW migrations** (`venue_tables`, `venue_capacity_rules`, `venue_availability_config`, `venue_blackouts`, `venue_reservation_settings`, `reservations`, `venue_waitlist`) with RLS.
**Out:** any booking logic, availability compute, consumer surface.
**Depends on:** ORCH-1145 merged (the venue tab + `VenueListingContent`).
**Affected surfaces:** business iOS/Android/web (the suite shell + settings). Supabase (migrations + RLS). NO consumer app, NO public page yet.
**Net-new vs reuse:** NET-NEW shell sub-views + 7 migrations; REUSE `VenueListingContent`, `HubSubNav` pill, brand pricing toggles, `biz_is_brand_member_*` RLS.

### ORCH-2.1 — Booking Core (Tables + Availability + Reservations + Waitlist + Capacity Rules MVP)
**Scope:** operator CRUD for Tables (+ §6 rules MVP); Availability config (service periods, turn-times, buffers, max-per-slot, blackouts); the **availability RPC** (the net-new compute that returns bookable slots for date+party); manual Reservations create + full lifecycle (confirm/seat/no-show/complete/cancel) + the 6 list views; Waitlist MVP (add/notify/convert/expire); Overview MVP tiles derived from these tables.
**Out:** the consumer-facing booking surface (2.2); paid-fee checkout wiring beyond the data fields (the fee is configured here, charged in 2.2).
**Depends on:** ORCH-2.0 (schema + shell).
**Affected surfaces:** business iOS/Android/web. Supabase (availability RPC + reservation lifecycle RPCs). OneSignal (operator notifications). NO consumer app yet (operator can create manual reservations — provable end-to-end on the operator side alone).
**Net-new vs reuse:** NET-NEW availability engine + operator UI + lifecycle RPCs; REUSE OneSignal push helpers, phone normalization.

### ORCH-2.2 — Consumer Booking Surface (loop closes)
**Scope:** the consumer Reserve flow — deck-card Reserve CTA (gated on reservable flag) + public-venue-page Reserve entry point; the date/party/slot picker bound to the 2.1 availability RPC; FREE path (direct confirm) + PAID path (optional reservation fee via `ticket-checkout-create` → native PaymentSheet, WYSIWYP all-in); confirmation screen + push; the inbound `reservations` row (source=`mingla`) lands in the operator list.
**Out:** Demand/Campaigns, Menu CMS, Guests/Feedback.
**Depends on:** ORCH-2.1 (availability RPC + `reservations` write path).
**Affected surfaces:** **ALL** — consumer app-mobile (deck card + reserve flow), business iOS/Android/web + web (public page Reserve), Supabase (consumer-write RPC for free reservations + checkout extension for paid). Must hit the **all-surface parity** memory rule + OTA the consumer dev channel.
**Net-new vs reuse:** NET-NEW consumer reserve UI + free-path write RPC; REUSE `ticket-checkout-create` (paid), PaymentSheet, OneSignal, `PublicBrandPage`, deck supply.

### Seam left for the NEXT pillar (2.4 Demand + Campaigns — NOT this ship)
The `reservations` + `venue_waitlist` + availability data this loop generates is exactly the demand signal 2.4 reads. The Overview's "Fill open tables" CTA is a **stub button** in this ship (or omitted) that 2.4 wires to `marketing-send` + the existing `brand_buyers`/`event_buyers` audiences + place AI signals. Do not build the campaign; leave the data + the CTA seam.

---

## 8. Cross-cutting requirements (carry into every sub-ORCH SPEC)

- **All-surface parity** (non-negotiable memory): the consumer reserve surface must reach parity on web + business iOS/Android + consumer app, incl. the public venue page; OTA the consumer dev channel on 2.2 close.
- **Money model consistency:** the reservation fee MUST ride `allInPricingEngine` + `ticket-checkout-create` + brand pass/absorb toggles + venue-sourced tax + Paystack routing. No hand-rolled tax/fee math (Constitution #2).
- **RLS:** every new table read-gated by `biz_is_brand_member_for_read_for_caller(brand_id)`; consumer writes via service-role RPC only (mirrors `waitlist_entries`).
- **Android glass:** opaque fallback on all new GlassCard surfaces (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`).
- **Paid-publish integrity (ORCH-1073 lineage):** a venue can't enable a *paid* reservation fee unless `stripe_charges_enabled` (or Paystack subaccount) — mirror the `stripe_account_not_ready` 409 at the toggle/settings layer, not just at checkout.
- **Migrations applied via Management API** (CLI drift-wedged, MCP read-only) per memory; deploy edge fns from merged main.

---

## 9. Open product questions for Seth (the genuine forks)

1. **Bookable-slot model — `event_dates` reuse vs pure `reservations`?** `ticket-checkout-create` already takes `eventDateId`. Do we model each reservable slot as a lightweight `event_dates`-backed row (max reuse of the paid checkout + capacity path), or keep reservations a fully separate primitive and only borrow the checkout for the fee? (Affects §3.6 `event_date_id` + §2 money note + Q4.) **Recommendation: separate primitive; reuse checkout via a synthetic single-line fee.**
2. **Approval-required tables in v1?** Vision §2 lists "private room requires manager approval" (→ `requested` status). Ship the `requested`→approve lifecycle in 2.1, or defer (all Mingla bookings auto-confirm in v1)? **Recommendation: ship the status enum, defer the consumer-facing "request" UI — operator-only approval to start.**
3. **No-show fee enforcement.** When a paid reservation no-shows, do we auto-capture/forfeit the fee, or just flag it for the operator? (Affects `no_show_fee_policy` + refund engine wiring.) **Recommendation: flag-only in v1; auto-forfeit later.**
4. **Reservation fee mechanism.** Synthetic ticket-type-backed line vs an additive `mode:'reservation'` on `ticket-checkout-create`? **Recommendation: additive mode — cleaner than fabricating ticket types; small diff.**
5. **Waitlist + reservation notifications: SMS now or push-only?** Vision says "SMS when ready." Marketing Phase B (SMS) is NOT shipped (memory). Ship push-only (OneSignal) in v1 and seam SMS for later? **Recommendation: push-only v1.**
6. **Combinable tables.** Auto-combine two 4-tops for a party of 8 in the availability engine, or operator-manual only in v1? **Recommendation: manual v1, auto later.**
7. **Overview tiles scope.** Which of the 9 vision tiles ship in v1 (covers booked, open seats, waitlist count, hottest time…) vs wait for Demand? **Recommendation: the 4 directly derivable from `reservations`/`venue_waitlist`; defer demand-derived tiles.**
8. **Venue category gating.** Does Reservations show only for `venueCategory='restaurant'`, or any `hasPhysicalLocation` venue (play/creative too)? **Recommendation: any physical venue; "table" is generic enough.**

---

## 10. Brand voice — example copy (canonical; do NOT paraphrase the anchors)

**Reservations toggle empty-state (operator):**
> **Take reservations on Mingla**
> The people we already match to your vibe can now book a table. Turn it on, add your tables, set your hours — you're live.

**Operator "you're bookable" confirmation:**
> You're live. Mingla can now send the right guests straight to your tables.

**Consumer deck-card Reserve CTA:**
> `Reserve` — *(secondary line on expand)* Lock a table that fits the vibe.

**Consumer slot picker header:**
> When works? Pick your night, your party, your time.

**Consumer free confirmation:**
> You're in. [Venue] · [Day] at [Time] · Party of [N]. Less planning, more living — just show up.

**Consumer paid confirmation (fee):**
> Table locked. [Venue] · [Day] at [Time] · Party of [N]. [Fee] held to hold your spot — fully shown, no surprises.

**Operator inbound-Mingla reservation row badge:**
> First Mingla booking · or · From Mingla

**Waitlist-ready push (consumer):**
> Your table's ready at [Venue]. Head over.

---

## 11. Downstream routing

NEXT = **mingla-forensics** to write the build SPEC for **ORCH-2.0** (toggle + shell + settings + the 7 migrations), after Seth answers §9 (esp. Q1/Q4 — they shape the schema). Then 2.0 → implementor → tester → CLOSE; then 2.1; then 2.2 (all-surface + OTA). Register the three sub-ORCHs + META-ORCH-1148 on the World Map; reconcile against ORCH-1145's merge state (this PRD assumes 1145 is the base — confirm it has landed on origin/main before 2.0 spawns, per the stale-anchor rule).
