# INVESTIGATION — META-ORCH-1237 [Admin full-visibility console] · OFFERINGS domain

**Domain:** events (standard + RSVP), trips, experiences, venues.
**Phase:** INVESTIGATE (read-only, evidence-backed). No fix, no spec, no writes.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. All queries `SELECT`-only via MCP.
**Date:** 2026-07-03.
**Comms:** Read `COMMS_LEDGER.md` on entry. No BLOCK addressed to forensics/1237/ALL. COMMS-0061 (WARN→ALL: never run in-place DR restore on prod) is satisfied by construction — this investigation is read-only SELECT, zero restore/deploy/mutation.

---

## Headline findings

1. **One table, four offering types.** `public.events` (8 live rows) is the master offering table for standard events, RSVP events, trips, AND experiences. The discriminator is `events.event_type` — `CHECK (event_type = ANY (ARRAY['event','experience','trip','rsvp']))` (`events_event_type_check`). There is NO separate trips table or experiences table; trips and experiences are `events` rows plus type-specific child tables. Venues are the ONE offering that lives outside `events` (in `venue_listings`).

2. **Admin has ZERO visibility and ZERO edit on events/trips/experiences/RSVPs today.** `events` and every child table (`ticket_types`, `trip_days`, `trip_pricing_tiers`, `trip_inclusions`, `trip_intake_schemas`, `experience_stops`, `event_rsvps`, `event_rsvp_guests`, `event_dates`, `reservations`) have NO `is_admin_user()` RLS policy. Their only reads are brand-member (`biz_is_brand_member_for_read_for_caller`) or public-published. Since the admin browser holds only the anon key, an admin cannot read a draft/private/other-brand offering, cannot list offerings across brands, and cannot edit anything. No admin RPC and no admin edge function exists for these entities.

3. **Venues are the ONE offering already partially admin-wired.** `venue_listings` has an explicit admin read policy (`"venue_listings admin can read" USING is_admin_user()`), and `brands` also has admin read (`"Admins can read brands for operations" USING is_admin_user()`). But the only admin *action* surface is the **venue CLAIMS queue** (`ClaimsPage.jsx` → `adminClaimsService` → `admin-review-venue-claim` edge fn + RPCs). There is no admin surface to edit a live venue's details, hours, reservation settings, capacity, or to view a venue's reservations.

4. **The admin console has NO page for any offering entity.** `mingla-admin/src/App.jsx` imports 18 pages; none is Events/Trips/Experiences/Venues management. The nearest existing pages are `ClaimsPage` (venue-claim moderation only) and `PlacePoolManagementPage` (which manages `place_pool` deck listings — `admin_suspend_listing`/`admin_restore_listing`/`admin_soft_delete_listing` all `UPDATE public.place_pool`, not the offerings).

5. **RSVP vs standard is a first-class data split, not a flag on one shape.** Standard/ticketed offerings (`event_type` in `event`/`trip`/`experience`) sell through `ticket_types → orders → tickets`. RSVP offerings (`event_type='rsvp'`, Partiful-style, ORCH-1150) have NO ticket_types/orders — the guest list lives in `event_rsvps` with a two-axis status machine, and capacity/approval/plus-ones/waitlist config lives in dedicated `events.rsvp_*` columns.

6. **Two independent lifecycle axes on events.** `events.status` (`draft → scheduled → live → ended → cancelled`) and `events.visibility` (`public / discover / private / hidden / draft`) are separate CHECK-constrained columns; `published_at` timestamps the flip. Deletion is soft (`events.deleted_at`), and all child rows cascade on hard delete (`ON DELETE CASCADE`). Admin "unpublish/cancel/archive" would target `status`/`visibility`/`deleted_at`.

7. **UI lifecycle is derived, not stored.** `mingla-business/src/utils/eventLifecycle.ts:53` `deriveLiveStatus()` folds `status` + a UTC-normalised start instant into `live/upcoming/past/cancelled` (4h-before → 24h-after live window). An admin list would need the same helper (or a server mirror) to show the same "live/upcoming/past" buckets the organiser sees.

8. **Venues have a real approval state machine already; offerings do not.** `venue_listings.claim_status` `CHECK (... 'none','pending_review','verified','rejected','suspended','revoked')` with admin RPCs (`biz_review_venue_claim`, `admin_add_venue_claim_feedback`, `admin_tweak_venue_claim_fields`, `admin_get_claim_review_bundle`). Events/trips/experiences have no equivalent moderation lifecycle or admin action path.

---

## Schema map per entity (live-verified)

### A. `events` (master offering table) — 60 columns, 8 rows

**Identity / ownership**
- `id uuid PK` · `brand_id uuid NOT NULL → brands(id) ON DELETE CASCADE` (the OWNER) · `created_by uuid NOT NULL → auth.users(id)` · `slug text NOT NULL` (`events_slug_nonempty`).

**Type / lifecycle**
- `event_type text NOT NULL DEFAULT 'event'` — `CHECK ('event','experience','trip','rsvp')` (`events_event_type_check`).
- `status text NOT NULL DEFAULT 'draft'` — `CHECK ('draft','scheduled','live','ended','cancelled')` (`events_status_check`).
- `visibility text NOT NULL DEFAULT 'draft'` — `CHECK ('public','discover','private','hidden','draft')` (`events_visibility_check`).
- `published_at timestamptz` · `deleted_at timestamptz` (soft-delete) · `show_on_discover bool` · `show_in_swipeable_deck bool`.

**Time / place**
- `timezone text NOT NULL 'UTC'` · `location_text` · `location_geo point` · `city` / `city_geo` · `is_online bool` / `online_url` · `is_recurring` / `is_multi_date` / `recurrence_rules jsonb` (multi-date rows in `event_dates`).
- Trip-flavored: `destination_text` · `departure_text` · `departure_geo point` · `location_mode` `CHECK ('single','per_stop')`.

**Pricing / tax (all-in engine, per META-ORCH-1076/ORCH-1147)**
- `currency bpchar` `CHECK (15 supported ISO incl. NGN)` · `events_published_currency_required_check` (currency required unless draft).
- `pass_tax` / `pass_mingla_fee` / `pass_service_fee bool` (brand fee/tax toggles) · `pricing_locked_at` · `pricing_mode` `CHECK ('whole','per_stop')` · `whole_price_cents int` · `venue_tax_address jsonb`.
- `refund_policy jsonb` (`events_refund_policy_valid`) · `booking_deadline timestamptz` · `bookings_closed bool` / `bookings_closed_at` (ORCH-1120 refund/booking deadline).

**Experience-flavored:** `experience_intent` `CHECK ('adventurous','first-date','romantic','group-fun')` · `experience_intents text[]` (1–4 of same set).

**RSVP-flavored (ORCH-1150):** `rsvp_discoverable bool` · `rsvp_capacity int` · `rsvp_allow_plus_ones bool` · `rsvp_plus_ones_max int` · `rsvp_waitlist_enabled bool` · `rsvp_approval_mode text 'auto'` `CHECK ('auto','manual')`.

**Cover / theme:** `cover_media_url/type/provider/source_url/credit/credit_url/alt` · `theme jsonb` + `theme_color_override`/`theme_font_override`/`theme_animation_override` (whitelisted) · `party_types[]` / `vibe_tags[]` / `music_genres[]` (canonical CHECKs).

**RLS on `events`:**
| cmd | policy | predicate |
|-----|--------|-----------|
| SELECT | Brand team can select events | `deleted_at IS NULL AND biz_is_brand_member_for_read_for_caller(brand_id)` |
| SELECT | Public can read published events | `deleted_at IS NULL AND visibility='public' AND status IN ('scheduled','live','ended','cancelled')` |
| INSERT | Event manager plus | `created_by=auth.uid() AND biz_brand_effective_rank_for_caller(brand_id) >= event_manager` |
| UPDATE | Event manager plus | same rank gate |
| DELETE | Event manager plus | same rank gate |

**→ NO `is_admin_user()` policy. Admin (anon key) can only see the same public-published rows any anonymous visitor sees; drafts/private/scheduled-across-brands are invisible.**

### B. Standard/ticketed event children

- **`ticket_types`** (4 rows) — `event_id → events(id) ON DELETE CASCADE`. Pricing (`price_cents`, `currency`, `is_free`), inventory (`quantity_total`, `is_unlimited`), sale/validity windows, `is_hidden`/`is_disabled`/`requires_approval`, `available_online`/`available_in_person`, `waitlist_enabled`, `display_order`, `deleted_at`. RLS: brand-team SELECT, public SELECT (non-hidden, published event), **finance_manager+** INSERT/UPDATE/DELETE. **No admin policy.**
- **`orders` / `order_line_items` / `tickets` / `refunds` / `refund_line_items` / `door_sales_ledger`** — the sold-side (attendees, money). (Payments domain — noted for cross-ref; attendee visibility for admin flows through here.)
- **`event_dates`** (3 rows) — multi-date rows, `event_id CASCADE`, `is_master`, per-date overrides. RLS: brand-team + public-published SELECT, event_manager+ write. **No admin policy.**
- **`event_scanners` / `tickets`** — check-in.

### C. Trips (`event_type='trip'`)

- **`trip_days`** (0 rows) — `event_id CASCADE`, `ordinal>0`, `title`, `narrative`, `date`, `stops jsonb`, `media jsonb` (ORCH-1119 trip-day media). RLS: brand-member write (`ALL`), public-or-member SELECT. **No admin policy.**
- **`trip_pricing_tiers`** (1 row) — joins trip event → `ticket_type_id`; `tier_name`, `tier_metadata jsonb` (installments live here per ORCH-1181/Tr3).
- **`trip_inclusions`** (0) — `kind`/`item`/`ordinal` included/excluded lists.
- **`trip_intake_schemas`** (0) — per-tier intake form `schema jsonb` + `schema_version_id`; buyer-anon SELECT for `/checkout-trip/[id]/intake`.
- **`order_installments`** (0) — `order_id CASCADE`, `ordinal`, `amount_cents`, `due_at`, `status DEFAULT 'scheduled'`, retry ledger, `cancelled_at/by` (ORCH-1181 installment plans).
- **`trip_edit_log`** — append-only audit of published-trip edits (written by `biz_update_live_trip` RPC only). `cancel-trip-booking` edge fn exists.

### D. Experiences (`event_type='experience'`, ORCH-1151 curated stops)

- **`experience_stops`** (0 rows) — `event_id CASCADE`, `stop_order>=0` `UNIQUE(event_id, stop_order)`, `place_id`/`place_name`/`address`/`city`/`region`/`country_code`/`lat`/`lng`, `image_urls[] (<=5)`, `start_time`, `price_cents` (display-only per table comment — the sellable price is the single `ticket_types` row), `ai_description`. RLS: owner SELECT/ALL (event_manager+), plus a **public** SELECT for published experiences. **No admin policy.**
- **`experience_edit_log`** — audit (written by `biz_update_live_experience` RPC). **`experience_feedback`**, `curated_teaser_cache`, `generate-curated-experiences` edge fn.
- Parser fields on the parent `events` row: `experience_intent`/`experience_intents`, `pricing_mode`/`whole_price_cents`, `location_mode`.

### E. Venues (`venue_listings`, META-ORCH-1255/1256 first-class multi-venue)

- **`venue_listings`** (1 row) — `id PK`, `brand_id → brands(id) CASCADE` (owner), `place_pool_id → place_pool(id) SET NULL`, `slug` (`^[a-z0-9]{1,32}$`), `name`, `address`/`city`/`country_code`/`lat`/`lng` (lat/lng NOT NULL), `venue_category text NOT NULL` `CHECK ('restaurant','play','creative_and_arts')`, `google_place_id`, `contact_email`/`contact_phone`, `cover_media_url/type`, **`claim_status text NOT NULL DEFAULT 'none'`** `CHECK ('none','pending_review','verified','rejected','suspended','revoked')`, `claim_follow_up_at`, `rejection_reason`, `claim_decision_emailed_at`, `marked_called_at/by`, `duplicate_of_venue_id → venue_listings(id) SET NULL`. **No `deleted_at`, no separate `status`/`is_active` column — the venue lifecycle IS `claim_status`.**
- **RLS on `venue_listings`:** `"venue_listings admin can read" USING is_admin_user()` (SELECT) + `"venue_listings brand member can read"`. **No client INSERT/UPDATE policy — writes are RPC/service-role only** (per table comment). So admin can already SELECT venues; there is no admin *edit* policy or general edit RPC.
- **Reservation stack:** `venue_reservation_settings` (per `venue_id`+`brand_id`: `reservations_enabled`, fee config, `cancel_cutoff_hours`, `no_show_fee_policy`), `venue_capacity_rules`, `venue_availability_config`, `venue_tables`, `venue_blackouts`, `venue_waitlist`, `venue_sms_log`/`venue_sms_opt_out`, `venue_claim_feedback`.
- **`reservations`** (0 rows) — `brand_id CASCADE`, `venue_id → venue_listings(id) CASCADE`, `table_id → venue_tables SET NULL`, `place_pool_id SET NULL`, `reserved_for`, `party_size (1–100)`, `status` `CHECK ('requested','confirmed','seated','completed','no_show','cancelled_by_guest','cancelled_by_venue','waitlisted')`, `source` (`mingla/phone/walk_in/website/instagram`), `created_via` (`operator/consumer/guest`), guest contact, `payment_status` (`none/paid/refunded`), fee. RLS: brand-member SELECT, event_manager+ write (`ALL`), consumer-own SELECT. **No admin policy.**

### Cross-cutting relationships & lifecycle

```
brands (owner, admin-readable)
  └─ events (event_type ∈ event|trip|experience|rsvp; status/visibility/deleted_at)
        ├─ event_dates (multi-date)
        ├─ ticket_types ──> orders ─> order_line_items / tickets / refunds   (ticketed: event|trip|experience)
        │       └─ order_installments (trip payment plans)
        ├─ trip_days / trip_pricing_tiers / trip_inclusions / trip_intake_schemas  (trip)
        ├─ experience_stops  (experience)
        └─ event_rsvps ─> event_rsvp_guests   (rsvp ONLY; no orders)
  └─ venue_listings (claim_status lifecycle; admin-readable)
        └─ reservations / venue_tables / venue_*_settings|rules|blackouts
```

Lifecycle state machines:
- **Offering (events):** `status: draft → scheduled → live → ended → cancelled`; `visibility: draft → public/discover/private/hidden`; soft-delete via `deleted_at`. UI bucket derived by `deriveLiveStatus()` (`eventLifecycle.ts:53`).
- **RSVP guest (`event_rsvps`):** `rsvp_status (going/not_going/waitlisted/maybe)` × `approval_status (pending/approved/denied)`; confirmed-attending = `going AND approved`; host-remove = `approved → denied` (table comment).
- **Venue (`venue_listings.claim_status`):** `none → pending_review → verified/rejected`; `pending_review + claim_follow_up_at` = needs-fixes; `verified → suspended/revoked`; resubmit → `pending_review`.
- **Reservation:** `requested → confirmed → seated → completed`, plus `no_show / cancelled_by_guest / cancelled_by_venue / waitlisted`.

---

## RSVP-vs-standard event distinction (explicit)

Both variants are rows in the SAME `events` table, distinguished by **`events.event_type`**. A **standard/ticketed** offering (`event_type` = `event`, `trip`, or `experience`) is monetised through `ticket_types → orders → tickets` and its capacity/pricing live in `ticket_types`; a **RSVP** offering (`event_type='rsvp'`, ORCH-1150 Partiful-style) has NO ticket_types/orders — its guest list lives in `event_rsvps` (two-axis status: `rsvp_status` going/not_going/waitlisted/maybe × `approval_status` pending/approved/denied, plus `plus_count`), with capacity/approval/plus-ones/waitlist governed by the parent row's dedicated columns `events.rsvp_capacity`, `rsvp_approval_mode` (auto/manual), `rsvp_allow_plus_ones`/`rsvp_plus_ones_max`, `rsvp_waitlist_enabled`. Confirmed live-data proof: `SELECT event_type,status,count(*)` returns `event`(draft/live/scheduled), `rsvp`(draft×3, scheduled×1), `trip`(draft×1) — RSVP rows coexist with standard rows in one table.

---

## Existing surfaces

### Admin (`mingla-admin/`) — CONFIRMED no offering page
`App.jsx` route imports (18): Overview, Admin, PlacePoolManagement, UserManagement, Settings, Email, SubscriptionManagement, SignalLibrary, PlaceIntelligenceTrial, **Claims**, DeckScoreTuner, Pricing, LaunchCities, BetaLeads, StripeMode, SupportDesk, ApiHealth, Careers.
- **No** EventsPage / TripsPage / ExperiencesPage / VenueListingsPage.
- **`ClaimsPage.jsx`** (`Ve3 — Venue claims queue`) is the ONLY offering-adjacent admin surface: pending/verified/rejected venue **claims**, via `adminClaimsService` (`listPendingClaims`, `reviewClaim`, `addClaimFeedback`, `tweakClaimFields`, `getClaimReviewBundle`) → edge fn `admin-review-venue-claim` + RPCs `biz_review_venue_claim`, `admin_get_claim_review_bundle`, `admin_add_venue_claim_feedback`, `admin_tweak_venue_claim_fields`. It moderates the CLAIM handshake only — not general venue listing/reservation management.
- **`PlacePoolManagementPage.jsx`** manages `place_pool` (deck listings): `admin_suspend_listing`/`admin_restore_listing`/`admin_soft_delete_listing` — verified to `UPDATE public.place_pool` (not `events`, not general `venue_listings` editing).
- Admin data access foundations already present: admin RLS read on `brands` and `venue_listings`; `is_admin_user()` gate; `admin_audit_log` + `place_admin_actions` + `logAdminAction` pattern.

### Business app parity refs (`mingla-business/`) — where each is authored/managed
- Hub tabs: `app/(tabs)/hub/events.tsx` (40KB — standard + RSVP events list/manage), `experiences.tsx`, `trips.tsx`, `listing.tsx` + `app/(tabs)/hub/_layout.tsx`; venue detail under `app/venue/`.
- Lifecycle helper: `src/utils/eventLifecycle.ts` (`deriveLiveStatus`, `isEventPast`) + `eventDateMath.ts` (`computeMasterStartAtUtc`), status mapper `hub/eventCardStatus.ts`.
- Live-edit RPCs (organiser side): `biz_update_live_trip`, `biz_update_live_experience` (+ `trip_edit_log`/`experience_edit_log`). Publish/lifecycle mutations run through these + direct RLS-gated writes.

---

## Gap list per entity (for admin "see, edit, change, help & support")

### Events — STANDARD/ticketed (`event_type` event|trip|experience) and shared
- **SEE:** No way to list/search/filter events across ALL brands (by status, visibility, brand, city, date). Admin cannot see drafts/private/scheduled — RLS blocks the anon key. (Gap: no admin SELECT policy on `events`, no cross-brand admin list RPC/edge fn.)
- **SEE attendees:** No admin view of an event's `ticket_types`, `orders`, `tickets`, `order_line_items`, sales totals, or scanners (no admin policy on any).
- **EDIT:** No admin edit of event fields, no fix-a-mispriced-ticket (`ticket_types.price_cents` is finance_manager+-gated, no admin path), no correct-a-date (`event_dates`).
- **CHANGE state:** No admin unpublish (`visibility`), no admin cancel (`status='cancelled'`), no admin soft-delete (`deleted_at`), no admin close-bookings (`bookings_closed`).
- **HELP/SUPPORT:** No admin audit trail for offering actions (no `event_admin_actions` analog), no admin note/annotation, no impersonation-safe "act on behalf" path.

### Events — RSVP (`event_type='rsvp'`)
- **SEE:** No admin view of an RSVP event's guest list (`event_rsvps` + `event_rsvp_guests`), counts by `rsvp_status`/`approval_status`, waitlist, or `rsvp_capacity` utilisation. (No admin policy on `event_rsvps`/`event_rsvp_guests`.)
- **EDIT/CHANGE:** No admin approve/deny/remove a guest (`approval_status`), no admin capacity/approval-mode fix on the parent row, no admin promote-off-waitlist.
- **HELP:** No admin lookup of a specific guest across events (support "I RSVP'd but got no confirmation").

### Trips (`event_type='trip'`)
- **SEE:** No admin view of `trip_days` (itinerary + media), `trip_inclusions`, `trip_pricing_tiers`, `trip_intake_schemas`, or `order_installments` status/retries.
- **EDIT:** No admin path to fix a broken itinerary day, a wrong inclusion, or a mispriced tier (organiser-only via `biz_update_live_trip`).
- **CHANGE:** No admin cancel-with-refund-framing (organiser uses `cancel-trip-booking`; admin has no equivalent), no admin installment intervention (pause/cancel a failing plan — `order_installments.status`).
- **HELP:** No admin visibility into `trip_edit_log` for dispute/support.

### Experiences (`event_type='experience'`)
- **SEE:** No admin view of `experience_stops` (the curated itinerary), `experience_feedback`, or parser fields.
- **EDIT/MODERATE:** No admin path to fix/reorder/remove a stop, correct AI-generated `ai_description`, or moderate an inappropriate experience (organiser-only via `biz_update_live_experience`).
- **CHANGE:** No admin unpublish/cancel of a live experience.
- **HELP:** No admin visibility into `experience_edit_log`.

### Venues (`venue_listings`)
- **SEE:** Admin CAN already SELECT `venue_listings` + `brands` (RLS present) — but there is no PAGE to list/search venues across brands, and no admin read of the reservation stack (`reservations`, `venue_reservation_settings`, `venue_capacity_rules`, `venue_tables`, `venue_blackouts`, `venue_waitlist` — none has an admin policy).
- **EDIT:** No admin edit of venue details (name/address/hours/category/cover/contact) — writes are RPC/service-role only and no general edit RPC exists (only claim-field tweaks via `admin_tweak_venue_claim_fields`).
- **CHANGE:** Claim lifecycle IS admin-managed (verify/reject/suspend/revoke via `biz_review_venue_claim`) — but no admin toggle for `reservations_enabled`, no admin fix of capacity rules, no admin cancel/override of a reservation.
- **HELP/SUPPORT:** Venue-claim feedback loop exists (`venue_claim_feedback`); no reservation-level support view (a guest's `reservations` row by phone/email across venues).

### Cross-cutting gaps
- **No admin action-audit for offerings** (venues have `venue_claim_feedback` + claim RPCs log via `logAdminAction`; events/trips/experiences have none).
- **No unified cross-brand offering search** (by brand, city, status, type, date, revenue).
- **No admin↔organiser support channel tied to a specific offering** (support tickets exist at `support_tickets`/`SupportDeskPage` but are not offering-scoped).

---

## Candidate approaches (direction only — NOT a spec)

Consistent with the established fact that the admin browser holds only the anon key, two mutually-compatible primitives recur:

1. **Admin-RLS read policies** (`USING is_admin_user()`) on `events` + child tables + reservation stack — mirrors what already exists on `venue_listings`/`brands`. Cheapest path to admin *visibility* (list/search/attendees) with no edge function. Must be SELECT-only and paired with the existing `is_admin_user()` gate.
2. **Service-role admin edge functions / SECURITY DEFINER RPCs** for *edits and state changes* (unpublish/cancel/soft-delete/fix-price/approve-RSVP/fix-itinerary/toggle-reservations) — mirrors the venue-claim pattern (`admin-review-venue-claim`, `admin_*` RPCs) so writes bypass RLS safely, are `is_admin_user()`-gated, and log to an audit table (`admin_audit_log`/`place_admin_actions` analog for offerings).
3. **Reuse the organiser lifecycle helpers** (`deriveLiveStatus`, `biz_update_live_trip`, `biz_update_live_experience`) so admin list/edit shows the same live/upcoming/past buckets and honours the same edit-log/audit invariants the business app enforces — rather than a divergent admin-only write path.
4. **Admin console pages**: one cross-brand Offerings list (filter by `event_type`/`status`/`visibility`/brand/city) with drill-down per type (ticket tiers + orders for standard; guest list for RSVP; itinerary for trip; stops for experience), plus a Venues page (listing + reservations) extending the existing `ClaimsPage`/`PlacePoolManagementPage` shell (`AppShell`, `Table`, `logAdminAction`).

---

## Evidence appendix (probes run — all read-only)

- `mcp__supabase__list_tables(public)` — full table inventory + comments (events "B1 §B.3", venue_listings META-ORCH-1255, event_rsvps ORCH-1150, experience_stops META-ORCH-1059, trip_days ORCH-0859, etc.).
- `information_schema.columns` for `events` (60 cols), `ticket_types`, `trip_days`, `trip_pricing_tiers`, `trip_inclusions`, `trip_intake_schemas`, `experience_stops`, `event_rsvps`, `event_rsvp_guests`, `event_dates`, `order_installments`, `venue_listings`, `venue_reservation_settings`, `venue_capacity_rules`, `reservations`.
- `pg_constraint` CHECK+FK for events, venue_listings, reservations, event_rsvps, ticket_types, trip_days, experience_stops.
- `pg_policies` for events, event_dates, event_rsvps, event_rsvp_guests, ticket_types, trip_days, experience_stops, venue_listings, reservations, brands.
- `pg_proc` scan for `is_admin_user()`-gated / `admin_*` functions touching offering tables → only venue-claim/place_pool functions returned; `admin_{soft_delete,restore,suspend}_listing` verified to `UPDATE public.place_pool`.
- Live data: `SELECT event_type,status,count(*) FROM events` (8 rows across event/rsvp/trip).
- Files read: `mingla-admin/src/App.jsx`, `pages/ClaimsPage.jsx`; `mingla-business/app/(tabs)/hub/eventCardStatus.ts`, `src/utils/eventLifecycle.ts`; dir listings `mingla-admin/src/pages`, `mingla-business/app/(tabs)/hub`, `supabase/functions/`.

**Confidence:** proven for schema/RLS/existing-surface facts (all live-verified against PROD schema + source). Read-only investigation; no runtime UI repro required (backend/schema/static audit domain per Prime Directive 7 exemption). No fix or spec proposed.
