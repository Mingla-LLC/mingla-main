# SPEC — ORCH-1273 [Admin Offerings console — READ-ONLY]

**Parent:** META-ORCH-1237 (Admin full-visibility console). **Sibling foundation:** ORCH-1271 (must ship first; this spec consumes it).
**Phase:** SPEC (build contract). **Author:** mingla-forensics. **Mode:** VISIBILITY-FIRST — this wave ships READ-ONLY.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surface:** Admin Web (`mingla-admin/`) + backend (read RLS + read RPCs). No shipping-app surface.
**Inputs consumed (read in full):** `SPEC_ORCH-1271_ADMIN_AUTHZ_FOUNDATION.md`, `INVESTIGATION_META-ORCH-1237_OFFERINGS_EVENTS_TRIPS_EXPERIENCES_VENUES.md`, `INVESTIGATION_META-ORCH-1237_MASTER_SYNTHESIS.md`.
**COMMS ledger:** scanned on entry. Only OPEN row touching scope = COMMS-0061 (WARN→ALL: `gqnoajqerqhnvulmnyvv` is LIVE PROD, read-only). Honored by construction — every probe this session was a read-only `execute_sql` SELECT; this spec ships SELECT-only RLS + `STABLE` read RPCs and mutates nothing. WARN, not BLOCK → factored, no ledger write.

> Every schema/column/constraint/policy/RPC name below was verified against live PROD via read-only `execute_sql` on 2026-07-03. Citations: `[verified]` = confirmed this session; `[1271]` = contract inherited from the foundation spec; `[report]` = sealed by the cited investigation.

---

## 1. Scope & non-goals (READ-ONLY)

### In scope (READ, cross-brand, admin-only)
1. **Unified offerings list** — ONE cross-brand list over `public.events`, filterable by `event_type` (`event`/`rsvp`/`trip`/`experience`), `status`, `visibility`, derived lifecycle bucket, brand, date range, and soft-deleted; free-text search; CSV export. MUST surface DRAFT / PRIVATE / cross-brand rows.
2. **Type-aware offering detail (read-only):**
   - **standard event** (`event_type='event'`) — ticket tiers (`ticket_types`) + attendees/orders rollup.
   - **RSVP** (`event_type='rsvp'`) — guest list (`event_rsvps` + `event_rsvp_guests`) with status/approval/waitlist/capacity counts.
   - **trip** (`event_type='trip'`) — itinerary (`trip_days`) + pricing tiers (`trip_pricing_tiers`) + inclusions (`trip_inclusions`) + intake schemas + installment status.
   - **experience** (`event_type='experience'`) — stops (`experience_stops`) + feedback (`experience_feedback`).
3. **Venues** — cross-brand list + detail of `venue_listings` (reuse existing admin-read RLS) + the reservation stack read (`venue_reservation_settings`, `venue_capacity_rules`, `venue_tables`, `venue_blackouts`, `venue_waitlist`, `reservations`).
4. The **read authorization** for every table above per the ORCH-1271 §3 convention (RLS SELECT policy vs `admin_*` read-RPC), with the `{rows,total}` return shape and the "prove against a known draft/private/cross-brand row" acceptance rule.
5. Admin console pages + service wrappers reusing the ORCH-1271 `EntityListView` / `EntityDetailView` shells and the "Business" nav group.

### Non-goals (HARD — do NOT build in 1273)
- **NO edit / moderate / state-change of any kind.** No unpublish, cancel, close-bookings, price fix, itinerary fix, stop reorder/remove, RSVP approve/deny, capacity override, reservation override, venue edit. Every such action is **WAVE-2 (deferred)** — designed in §6 as notes only, built later via the ORCH-1271 audited primitive. This wave ships ZERO write path.
- **NO admin write RPC, NO service_role edge fn, NO `HighRiskActionModal` wiring to a real mutation.** (The 1271 self-test probe is the only live write anywhere and is not part of 1273.)
- **NO new authorization primitive.** 1273 consumes `is_admin_user()` [1271], the §3 read convention [1271], and the `EntityListView`/`EntityDetailView` shells [1271]. It does not redefine them.
- **NO change to shipping apps** (`app-mobile/`, `mingla-business/`), buyer-web, or the RN lifecycle helpers. The admin bucket is server-computed (§4.1); the RN `eventLifecycle.ts` is NOT imported into `mingla-admin` (separate Vite app, no shared path).
- **NO change to `is_admin_user()`, existing `admin_*` RPCs, `venue_listings` existing policy, or the two partner policies (1271 owns those).**
- **NO remediation** of the pre-existing anomalies flagged by 1271 (`admin_set_city_live`, `delete-user`). Untouched.

### Assumptions
- ORCH-1271 has SHIPPED (single gate standardized; `EntityListView`/`EntityDetailView`/`HighRiskActionModal` shells exist; "Business" nav group exists; `admin_write_audit` primitive exists). 1273 does not re-create any of these. **If 1271 has not merged, 1273 implementation BLOCKS** — see Open Question Q1.
- The admin browser holds only the anon key + an admin session JWT; `is_admin_user()` resolves via `auth.uid()` → `auth.users.email` → `admin_users WHERE status='active'` [1271, verified]. RLS `USING is_admin_user()` and `GRANT EXECUTE ... TO authenticated` definer RPCs both work under that session.

---

## 2. Foundation-contract dependencies (ORCH-1271 — do NOT reinvent)

| Inherited artifact | Source | How 1273 uses it |
|---|---|---|
| `is_admin_user()` gate | §1 [verified] | Sole gate for every new RLS policy + read RPC. |
| Read-authz decision rule (RLS vs read-RPC) | §3 | Applied per-table in §5. |
| RPC naming (`admin_list_<entities>`, `admin_get_<entity>`, `admin_<entity>_stats`) | §3 | All 1273 RPC names conform. |
| Return-shape convention (`{rows, total}`; ISO-8601 timestamps; integer cents + currency, never pre-formatted) | §3 | All list RPCs return `{rows,total}`; detail RPCs return one `jsonb` bundle. |
| Acceptance rule "prove against a known draft/private/cross-brand row" | §3 (HARD) | The #1 acceptance gate (§7 AC-1.4, AC-2.x). |
| Gate-first ordering `IF NOT is_admin_user() THEN RAISE` as first statement | §2d / `I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT` | Every 1273 read RPC guards first; registered in the 1271 strict-grep registry. |
| `EntityListView` props (`fetchPage → {rows,total}`, filters, CSV, pagination) | §4b | The offerings + venues lists are `EntityListView` instances. |
| `EntityDetailView` props (`header`, `sections`, `loading/error/onRetry`) | §4c | Every detail view is an `EntityDetailView`; `actions` prop left EMPTY (read-only). |
| "Business" nav group + `Building2` `ICON_MAP` pattern | §4a | 1273 appends two nav items to the same group. |
| Service pattern (`services/*`, `supabase.rpc`, `.from().select()`, `exportCsv`) | §4f | 1273 adds `offeringsService.js` + `venuesService.js` (READ only). |

**Explicit divergence from 1271:** 1271's RPC template (§2d) is a WRITE template (guard → reason → mutation → audit). 1273 RPCs are **read** RPCs: guard → SELECT/aggregate → `RETURN`. They are `STABLE SECURITY DEFINER`, take NO `p_reason`, write NO audit row (reads are not audited), and perform NO mutation. This is the correct read analog of the 1271 pattern, not a violation of it.

---

## 3. Unified offerings list spec

### 3.1 Data source & shape
ONE list over `public.events` (8 live rows across `event`/`rsvp`/`trip`; 0 `experience` today [verified]). The discriminator is `events.event_type CHECK ('event','experience','trip','rsvp')` [verified `events_event_type_check`]. Because the list is **cross-brand aggregated + derived** (lifecycle bucket + per-row child counts), it is a **read-RPC**, not RLS-direct (§5, per 1271 §3).

### 3.2 Read RPC — `admin_list_offerings`
`GRANT EXECUTE ... TO authenticated`; guard is the first statement.

```
admin_list_offerings(
  p_search          text        DEFAULT NULL,   -- ILIKE over events.title, brand.name, events.city, events.slug
  p_event_type      text        DEFAULT NULL,   -- 'event'|'experience'|'trip'|'rsvp' | NULL=all
  p_status          text        DEFAULT NULL,   -- events.status | NULL=all
  p_visibility      text        DEFAULT NULL,   -- events.visibility | NULL=all
  p_lifecycle       text        DEFAULT NULL,   -- derived bucket: 'draft'|'upcoming'|'live'|'past'|'cancelled' | NULL=all
  p_brand_id        uuid        DEFAULT NULL,
  p_date_from       timestamptz DEFAULT NULL,   -- master start_at >= p_date_from
  p_date_to         timestamptz DEFAULT NULL,   -- master start_at <= p_date_to
  p_include_deleted boolean     DEFAULT false,  -- false ⇒ deleted_at IS NULL only
  p_sort            text        DEFAULT 'start_at',  -- 'start_at'|'created_at'|'title'|'status'
  p_sort_dir        text        DEFAULT 'desc',      -- 'asc'|'desc'
  p_limit           int         DEFAULT 25,
  p_offset          int         DEFAULT 0
) RETURNS jsonb   -- { "rows": [ {...} ], "total": <int, pre-pagination count> }
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
```

**Per-row object (flat; server-shaped):**
`id`, `event_type`, `title`, `slug`, `status`, `visibility`, `lifecycle_bucket` (server-computed §4.1), `brand_id`, `brand_name`, `city`, `currency`, `master_start_at` (ISO-8601 | null), `master_end_at` (ISO-8601 | null), `published_at`, `deleted_at`, `created_at`, and lightweight counts computed by correlated subquery: `attendee_count` (paid tickets — `tickets` joined via `orders.payment_status='paid'`, for `event`/`trip`/`experience`), `rsvp_going_count` (`event_rsvps` where `rsvp_status='going' AND approval_status='approved'`, for `rsvp`), `child_summary` (jsonb: `{trip_day_count}` for trip, `{stop_count}` for experience, `{ticket_type_count}` for event, `{rsvp_total}` for rsvp).

**Filter / sort / count contract (load-bearing):**
- `total` is the count of rows matching all filters BEFORE `p_limit`/`p_offset` (drives pagination). Never the page length.
- `p_search` ILIKE `%q%` across `events.title`, `brands.name`, `events.city`, `events.slug`.
- `p_include_deleted=false` (default) restricts to `deleted_at IS NULL`. `true` surfaces soft-deleted rows (admin support need).
- Master start/end via `LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master` [verified `event_dates.is_master`, `start_at`, `end_at` all NOT NULL]. `LEFT` join because an unscheduled draft may have no `event_dates` row → `master_start_at` NULL.
- `p_sort`/`p_sort_dir` whitelisted (reject others → default). Money always integer cents (`ticket_types.price_cents`, `whole_price_cents`) + `currency` code, never pre-formatted [1271 §3].

### 3.3 Optional aggregate — `admin_offering_stats` (nice-to-have; ship if trivial)
`admin_offering_stats() RETURNS jsonb` — counts by `event_type` and by `lifecycle_bucket`, mirroring `admin_subscription_stats()` [verified precedent]. Feeds the list-header stat tiles. Guard-first. If deferred, the list header omits stat tiles (not blocking).

### 3.4 UI — `pages/OfferingsConsolePage.jsx`
An `EntityListView` [1271 §4b] instance. `fetchPage` → `offeringsService.listOfferings({search,sortKey,sortDir,filters,page,pageSize})` → maps to `admin_list_offerings` params → returns `{rows,total}`.

- **Columns:** Title (render: title + type badge), Brand (`brand_name`), Type (`event_type` badge), Status (`status` badge), Visibility (`visibility` badge), Lifecycle (`lifecycle_bucket` badge, color per bucket), City, Starts (`master_start_at`, formatted via existing `formatters`), Created. `onRowClick` → navigate to offering detail (hash route `#/business-offerings/<id>`).
- **Filters** (rendered as `EntityListView` `filters` Dropdowns → passed to `fetchPage`): Type (`event_type`), Status (`status` enum), Visibility (`visibility` enum), Lifecycle (bucket), Brand (populated from a small distinct-brands read — reuse `brands` admin-read RLS [verified existing]), plus a "Show deleted" toggle → `p_include_deleted`. Date range (from/to) if the `EntityListView` filter kit supports it; else defer date filter to Wave-2 polish (Open Q3).
- **CSV:** `csv={ columns: [...flat text columns...], filename: 'offerings.csv' }` → `exportCsv` [1271 §4b]. Export the current filtered result set.
- **States:** loading / error+retry / empty — all delegated to `EntityListView` (no bespoke fabrication). Empty message: "No offerings match these filters."

---

## 4. Type-aware detail spec

### 4.0 Detail read strategy
Detail = ONE header bundle RPC (`admin_get_offering`, definer — gives the derived bucket + counts + brand join in one shaped call) PLUS type-specific child reads. The **type-specific display children** (`ticket_types`, `event_dates`, `trip_days`, `trip_pricing_tiers`, `trip_inclusions`, `trip_intake_schemas`, `experience_stops`, `experience_feedback`) are read **RLS-direct** from the admin session (new admin SELECT policies, §5). The **PII/money/aggregating children** (`orders`/`order_line_items`/`tickets`, `event_rsvps`/`event_rsvp_guests`, `order_installments`) are read **via definer read-RPCs** so the raw PII rows stay RLS-closed to the anon key and only shaped columns leave the DB.

`pages/OfferingDetailView.jsx` reads `event_type` from the header bundle, then renders the matching section set into an `EntityDetailView` [1271 §4c]. `actions` prop is left EMPTY (read-only). Header badges = status + visibility + lifecycle bucket.

### 4.1 Derived lifecycle status — SERVER-COMPUTE (decision)
**Decision: server-compute the bucket inside `admin_list_offerings` + `admin_get_offering`.** Do NOT import `mingla-business/src/utils/eventLifecycle.ts` into `mingla-admin` (separate app; no shared package path; the RN helper reads a `LiveEvent` store shape that does not exist in admin-web). Single source of truth = the SQL `CASE` below, which mirrors `deriveLiveStatus` (`eventLifecycle.ts:53`) exactly for the live/upcoming/past trichotomy, sourcing the master instant from `event_dates`.

```
lifecycle_bucket =
  CASE
    WHEN e.status = 'cancelled' THEN 'cancelled'
    WHEN e.status = 'draft'     THEN 'draft'        -- admin-only bucket; organiser pills never show drafts
    WHEN e.status = 'ended'     THEN 'past'         -- DB persistent form of the RN `endedAt !== null → past` branch
    WHEN m.start_at IS NULL     THEN 'upcoming'     -- unscheduled (no master event_date) → treat as upcoming, never live
    WHEN now() >= m.start_at - interval '4 hours'
     AND now() <  m.start_at + interval '24 hours' THEN 'live'
    WHEN now() <  m.start_at - interval '4 hours' THEN 'upcoming'
    ELSE 'past'
  END
```

Parity notes (documented, deliberate):
- Live window `[start − 4h, start + 24h)` = `LIVE_WINDOW_BEFORE_MS`/`LIVE_WINDOW_AFTER_MS` (`eventLifecycle.ts:26-27`).
- `status='cancelled' → 'cancelled'` and `status='ended' → 'past'` mirror the RN short-circuits (RN uses `endedAt`; DB has no `ended_at` column [verified — `events` has no such column], so `status='ended'` is the server equivalent — Open Q2).
- **Admin adds a `'draft'` bucket** the organiser trichotomy lacks, because the admin console SEES drafts (its whole purpose). This is an intentional divergence, not a bug.

### 4.2 Header bundle RPC — `admin_get_offering`
```
admin_get_offering(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
```
Guard-first. Returns ONE jsonb bundle: the `events` row core fields + `brand_id`/`brand_name`/`brand_slug`/`brand_city` (join `brands` [verified cols: id,name,slug,city]) + `master_start_at`/`master_end_at` (from `event_dates` master) + `lifecycle_bucket` (§4.1) + `child_summary` counts (as §3.2) + `pass_tax`/`pass_mingla_fee`/`pass_service_fee`/`currency`/`whole_price_cents`/`pricing_mode`/`refund_policy`/`bookings_closed`/`booking_deadline`/`published_at`/`deleted_at`. Returns `null`/`{}` when `p_event_id` not found (caller shows not-found, no crash — use `.maybeSingle()` semantics on the client wrapper).

### 4.3 Standard event detail (`event_type='event'`)
- **Ticket tiers** — RLS-direct `from('ticket_types').select('*').eq('event_id', id).order('display_order')` [verified cols: name, price_cents, currency, quantity_total, is_unlimited, is_free, is_hidden, is_disabled, requires_approval, sale_start_at, sale_end_at, waitlist_enabled, display_order, deleted_at]. Section rows: tier name, price (cents+currency via formatter), inventory (`quantity_total` or "Unlimited"), flags (hidden/disabled/free/approval). Show soft-deleted tiers greyed (`deleted_at`).
- **Attendees / orders** — `admin_list_event_orders(p_event_id, p_limit, p_offset) RETURNS jsonb {rows,total,summary}` (definer; PII+money+join). Row: `order_id`, `buyer_name`, `buyer_email`, `buyer_phone`, `payment_status` [enum verified], `total_cents`, `currency`, `is_door_sale`, `source` [enum verified], `refunded_amount_cents`, `created_at`, `line_items` (jsonb: `[{ticket_type_name, quantity, unit_price_cents}]` from `order_line_items` join `ticket_types.name`). `summary`: `{gross_cents, refunded_cents, paid_count, refunded_count, ticket_count}`. Read-only; NO refund button (Wave-2 → ORCH-1274 money console owns refunds).

### 4.4 RSVP detail (`event_type='rsvp'`)
- **Guest list** — `admin_list_event_rsvps(p_event_id, p_limit, p_offset) RETURNS jsonb {rows,total,counts}` (definer; guest PII + rollup). Row: `rsvp_id`, `guest_name`, `guest_email`, `guest_phone`, `user_id` (null = anon guest), `rsvp_status` [enum: going/not_going/waitlisted/maybe, verified], `approval_status` [enum: pending/approved/denied, verified], `plus_count`, `waitlisted_at`, `promoted_at`, `created_at`, `plus_guests` (jsonb from `event_rsvp_guests` join on `rsvp_id`: `[{name,email,phone}]` [verified `event_rsvp_guests.rsvp_id` FK, cols name/email/phone NOT NULL]). `counts`: `{going, not_going, waitlisted, maybe, pending, approved, denied, confirmed_attending, total_headcount, capacity, capacity_remaining}` where `confirmed_attending = rsvp_status='going' AND approval_status='approved'` and `total_headcount = sum(confirmed_attending) + sum(plus_count for confirmed)`, `capacity = events.rsvp_capacity` [verified], `capacity_remaining = capacity - total_headcount` (null when `rsvp_capacity` null = uncapped). Detail header also shows `rsvp_approval_mode` (auto/manual) + `rsvp_waitlist_enabled` + `rsvp_allow_plus_ones`/`rsvp_plus_ones_max` from the bundle. Read-only; NO approve/deny (Wave-2 §6).

### 4.5 Trip detail (`event_type='trip'`)
All RLS-direct except installments:
- **Itinerary** — `from('trip_days').select('*').eq('event_id', id).order('ordinal')` [verified cols: ordinal, title, narrative, date, stops jsonb, media jsonb]. Section: ordered day cards (title, narrative, date, stop count from `stops` jsonb length, media count).
- **Pricing tiers** — `from('trip_pricing_tiers').select('*').eq('event_id', id)` [verified: tier_name, ticket_type_id, tier_metadata jsonb]. Cross-reference `ticket_types` for the tier price (RLS-direct).
- **Inclusions** — `from('trip_inclusions').select('*').eq('event_id', id).order('ordinal')` [verified: kind ('included'|'excluded'), item, ordinal]. Split into Included / Excluded lists.
- **Intake schemas** — `from('trip_intake_schemas').select('*').eq('event_id', id)` [verified: ticket_type_id, schema jsonb, schema_version_id] — show per-tier form field count (read-only).
- **Installments** — via `admin_list_event_orders` extension OR a dedicated definer read; `order_installments` [verified cols: ordinal, amount_cents, currency, due_at, status, retry_count, failed_at, cancelled_at]. Read-only status ledger. Keep RPC-only (payment data). If deferred, note "installment status = Wave-2" (Open Q3); the core trip detail (itinerary/pricing/inclusions) is the must-ship.

### 4.6 Experience detail (`event_type='experience'`)
All RLS-direct:
- **Stops** — `from('experience_stops').select('*').eq('event_id', id).order('stop_order')` [verified cols: stop_order, place_name, address, city, region, country_code, lat, lng, image_urls[], start_time, price_cents (display-only), ai_description]. Section: ordered stop cards (place, address, start_time, price display, image count, ai_description). `UNIQUE(event_id, stop_order)` [report].
- **Feedback** — `from('experience_feedback').select('*').eq('card_id', <card>)` — NOTE: `experience_feedback` keys on `card_id text` + optional `experience_title`, NOT `event_id` [verified — no `event_id` column]. The join to a specific experience is by `card_id`/`experience_title`, not the event UUID. **Flag (Open Q4):** confirm the `card_id` ↔ `events.id`/`slug` mapping before wiring feedback; if unmapped, ship the stops panel and mark feedback "Wave-2 (needs card_id mapping)". Rating (1-5) + feedback_text + created_at when mapped.

### 4.7 Venues — list + detail
- **List** — `pages/VenuesConsolePage.jsx`, an `EntityListView`. `venue_listings` already has `"venue_listings admin can read" USING is_admin_user()` [verified] → read **RLS-direct**: `from('venue_listings').select('*', {count:'exact'}).ilike/eq(...).range(...)`. Columns: name, brand (`brand_name` via join or a small brand map), city, `venue_category` [enum: restaurant/play/creative_and_arts, verified], `claim_status` [enum: none/pending_review/verified/rejected/suspended/revoked, verified] badge, contact, created. Filters: `venue_category`, `claim_status`, brand. Search over name/city/slug/address. CSV. `onRowClick` → `#/business-venues/<id>`. (Low row count — 1 today [report] — so client-friendly range pagination is fine.)
- **Detail** — `VenueDetailView` (`EntityDetailView`). RLS-direct reads:
  - venue core: `from('venue_listings')...eq('id', id).maybeSingle()` [verified cols incl. slug, name, address, city, country_code, lat, lng, venue_category, google_place_id, contact_email/phone, cover_media_url, claim_status, claim_follow_up_at, rejection_reason, duplicate_of_venue_id, marked_called_at/by].
  - reservation **settings**: `from('venue_reservation_settings')...eq('venue_id', id).maybeSingle()` (PK = `venue_id` [verified]) [cols: reservations_enabled, fee_enabled, fee_amount_cents, fee_currency, fee_refundable, cancel_cutoff_hours, no_show_fee_policy, pass_fee_override, pass_tax_override].
  - **tables**: `from('venue_tables')...eq('venue_id', id).order('sort_order')` [cols: name, capacity, min_party, max_party, zone, seating_type, is_active, reservation_policy, deleted_at].
  - **capacity rules**: `from('venue_capacity_rules')...eq('venue_id', id)` [cols: kind, params jsonb, zone, is_active].
  - **blackouts**: `from('venue_blackouts')...eq('venue_id', id).order('date_start')` [cols: date_start, date_end, reason, applies_to, zone, table_id].
  - **waitlist**: `from('venue_waitlist')...eq('venue_id', id)` [cols: guest_name, party_size, status (waiting/notified/converted/expired/lost, verified), quoted_wait_minutes].
  - Each of these 5 reservation-stack tables needs a NEW admin SELECT RLS policy (§5).
- **Reservations** — `admin_list_venue_reservations(p_venue_id, p_status, p_limit, p_offset) RETURNS jsonb {rows,total,counts}` (definer; guest PII + payment + status rollup). Row: `reservation_id`, `reserved_for`, `party_size`, `status` [8-value enum verified], `source` [enum verified], `created_via`, `guest_name`, `guest_phone_e164`, `guest_email`, `occasion`, `payment_status` [none/paid/refunded verified], `fee_cents`, `fee_currency`, `table_name` (join `venue_tables`), `created_at`. `counts`: by status. Read-only; NO reservation override (Wave-2 §6). (0 reservations in PROD today [verified] — see Open Q5 test-data gap.)

---

## 5. Read-authorization per table (RLS SELECT vs read-RPC)

Applying the ORCH-1271 §3 decision rule. **Every new RLS policy is SELECT-only, `USING (public.is_admin_user())`, named `"<table> admin can read"`** [1271 naming]. Migration file: `supabase/migrations/<next-utc-ts>_orch_1273_offerings_admin_read_rls.sql`. Illustrative shape (≤3 lines, NOT the file):
```sql
CREATE POLICY "events admin can read" ON public.events FOR SELECT USING (public.is_admin_user());
```

| Table | Read method | Rationale (per 1271 §3) | Admin policy exists today? |
|---|---|---|---|
| `events` | **RLS SELECT** (+ also read inside definer RPCs) | Base offering table; mirror `brands`/`venue_listings` admin-read; whole-row. | NO [verified] → ADD |
| `event_dates` | **RLS SELECT** | Whole-row master date display; also joined inside RPCs. | NO → ADD |
| `ticket_types` | **RLS SELECT** | Whole-row tier display. | NO → ADD |
| `trip_days`, `trip_pricing_tiers`, `trip_inclusions`, `trip_intake_schemas` | **RLS SELECT** | Whole-row itinerary/pricing/inclusion/intake display. | NO → ADD (4) |
| `experience_stops`, `experience_feedback` | **RLS SELECT** | Whole-row stops/feedback display. | NO → ADD (2) |
| `venue_listings` | **RLS SELECT** (REUSE) | Already `"venue_listings admin can read"`. | YES [verified] → REUSE, do not touch |
| `venue_reservation_settings`, `venue_capacity_rules`, `venue_tables`, `venue_blackouts`, `venue_waitlist` | **RLS SELECT** | Whole-row reservation-config display. | NO → ADD (5) |
| `brands` | **RLS SELECT** (REUSE) | Already `"Admins can read brands for operations"`. | YES [verified] → REUSE |
| `orders`, `order_line_items`, `tickets` | **read-RPC only** (`admin_list_event_orders`) | Buyer PII + money + join/aggregate → keep RLS-closed to anon key; definer shapes columns. | NO admin RLS — INTENTIONALLY not added |
| `order_installments` | **read-RPC only** | Payment data + PII-adjacent. | NO admin RLS |
| `event_rsvps`, `event_rsvp_guests` | **read-RPC only** (`admin_list_event_rsvps`) | Guest PII + status rollup counts. | NO admin RLS |
| `reservations` | **read-RPC only** (`admin_list_venue_reservations`) | Guest PII + payment + status counts. | NO admin RLS |
| (cross-brand list / derived bucket / stats) | **read-RPC** (`admin_list_offerings`, `admin_get_offering`, `admin_offering_stats`) | Cross-brand aggregation + derivation. | n/a |

**Total new RLS policies: 13** (events, event_dates, ticket_types, 4 trip, 2 experience, 5 venue-stack). **Total new read RPCs: 5 required + 1 optional** (`admin_list_offerings`, `admin_get_offering`, `admin_list_event_orders`, `admin_list_event_rsvps`, `admin_list_venue_reservations`; `admin_offering_stats` optional). All RPCs: `STABLE SECURITY DEFINER SET search_path TO 'public'`, guard-first, `GRANT EXECUTE TO authenticated`, register in the 1271 gate-first strict-grep registry.

**PII posture (deliberate):** the 5 PII/money child tables get NO admin RLS. They are reachable only through the definer read-RPCs, which SELECT a fixed shaped column set. This is stricter than a blanket admin SELECT on `orders`/`event_rsvps`/`reservations` and is the correct default for a support console.

---

## 6. Wave-2 deferred-edit notes (DESIGN ONLY — do NOT build)

Each is an audited mutation for a later ORCH, built on the ORCH-1271 §2d WRITE template (guard-first → `p_reason` required → SELECT before → UPDATE → `admin_write_audit('<entity>.<verb>', ...)` with `{before,after}`) surfaced through the 1271 `HighRiskActionModal` (typed reason + confirm). Listed here so the read UI leaves the right seams (an empty `actions` slot on each `EntityDetailView`), NOT as buildable scope.

| Wave-2 action | Target table/column | 1271 primitive shape |
|---|---|---|
| Unpublish / hide offering | `events.visibility` → `hidden`/`private` | `admin_set_offering_visibility(p_event_id, p_visibility, p_reason)` |
| Cancel offering | `events.status` → `cancelled` | `admin_cancel_offering(p_event_id, p_reason)` (+ refund framing → ORCH-1274) |
| Close bookings | `events.bookings_closed`/`bookings_closed_at` | `admin_close_offering_bookings(p_event_id, p_reason)` |
| Soft-delete offering | `events.deleted_at` | `admin_soft_delete_offering(p_event_id, p_reason)` |
| Fix mispriced tier | `ticket_types.price_cents` | `admin_set_ticket_price(p_ticket_type_id, p_price_cents, p_reason)` |
| Fix / reorder / remove experience stop | `experience_stops` | `admin_update_experience_stop(...)` (mirror `biz_update_live_experience` + `experience_edit_log`) |
| Fix trip itinerary day | `trip_days` | `admin_update_trip_day(...)` (mirror `biz_update_live_trip` + `trip_edit_log`) |
| RSVP approve / deny / capacity override / promote-off-waitlist | `event_rsvps.approval_status`, `events.rsvp_capacity` | `admin_set_rsvp_approval(...)`, `admin_set_rsvp_capacity(...)` |
| Venue edit (name/hours/category/contact) | `venue_listings` (writes are RPC/service-role only [report]) | `admin_update_venue(...)` |
| Toggle reservations / fix capacity | `venue_reservation_settings.reservations_enabled`, `venue_capacity_rules` | `admin_set_venue_reservations_enabled(...)` |
| Reservation override / cancel | `reservations.status` | `admin_set_reservation_status(...)` |

**Every Wave-2 write must ADD its own admin write RLS or (preferably) a definer write RPC — it must NOT loosen the 1273 read policies into write policies.** 1273 read RLS is SELECT-only forever.

---

## 7. Cross-surface impact declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NO | none | none | Admin-only backend + web. |
| 2 | Consumer Android | NO | none | none | " |
| 3 | Buyer/anon Web (`mingla-business/` public routes) | NO | none | none | " |
| 4 | Business iOS | NO | none | none | " |
| 5 | Business Android | NO | none | none | " |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | New "Offerings" + "Venues" pages under the Business nav group; read-only cross-brand lists + type-aware detail. | see allowlist §9 | Single surface — no parity split. |
| 7 | Business Web preview (adjacent) | NO | none | none | Untouched. |

Backend (Supabase migrations + read RPCs) is shared infra, not a "surface"; it is covered and gates surface 6.

---

## 8. Acceptance criteria (testable; fails-on-revert where noted)

`HP` = happy-path (implementor self-verify). `ADV` = adversarial (tester). CLOSE requires both. Concrete PROD targets are named [verified] so the tester has exact rows.

**AC-1 — Unified list (`admin_list_offerings`)**
- AC-1.1 [HP] As an active admin, `SELECT admin_list_offerings()` returns `{rows,total}` with `total >= 8` and rows across `event`/`rsvp`/`trip`.
- AC-1.2 [HP] `p_event_type='rsvp'` returns ONLY rsvp rows; `p_status='draft'` returns ONLY drafts; `p_brand_id` filters to one brand; `p_search='Rooftop'` matches "Summer Rooftop Festival"; `total` reflects the filtered count, not the page length.
- AC-1.3 [HP] `lifecycle_bucket` = `'live'` for `699afd22-…` (status live, public), `'draft'` for `e5d6c2e6-…`, and matches §4.1 for a scheduled row with a master `event_date`.
- **AC-1.4 [ADV — the #1 gate, "prove against a known draft/private/cross-brand row"]** As an admin who is NOT a team member of brand `2731cd8b` ("test Brand") NOR `020cfcf9` ("Party Life"), `admin_list_offerings()` STILL returns the DRAFT rows `e5d6c2e6-10e7-4493-8dcc-6722f2c8d657` (event/draft), `84f481d0-3455-489e-973f-b157212ad60c` (trip/draft), and `c38359da-20f1-4851-aab3-0d8b8ee59a67` (rsvp/draft, Party Life). This proves the list does NOT silently collapse to public-published rows.
- AC-1.5 [ADV] A NON-admin authed session calling `admin_list_offerings()` RAISES `not_authorized` (guard is first statement). Anon → same.
- AC-1.6 [ADV — fails-on-revert] Reverting the `admin_list_offerings` migration (or removing its guard/joins) makes AC-1.4 fail (draft rows absent) and the strict-grep gate (§8-invariants) fails.

**AC-2 — Type-aware detail**
- AC-2.1 [HP] `admin_get_offering('699afd22-…')` returns the header bundle with `event_type='event'`, `brand_name='The Party Block'`, `lifecycle_bucket='live'`, and `child_summary.ticket_type_count`.
- AC-2.2 [HP] Standard-event detail lists `ticket_types` for the event (RLS-direct) and `admin_list_event_orders` returns `{rows,total,summary}` with money in integer cents + currency.
- AC-2.3 [HP] RSVP detail for a `rsvp` event returns `admin_list_event_rsvps` `{rows,total,counts}` where `counts.confirmed_attending = going AND approved` and `counts.capacity` = `events.rsvp_capacity`.
- AC-2.4 [HP] Trip detail (`84f481d0-…`) reads `trip_days`/`trip_pricing_tiers`/`trip_inclusions` RLS-direct (empty arrays OK — 0 rows today; the panel renders "No itinerary yet" not a crash).
- AC-2.5 [ADV] `admin_get_offering`, `admin_list_event_orders`, `admin_list_event_rsvps`, `admin_list_venue_reservations` each RAISE `not_authorized` for a non-admin; each is `STABLE` and performs NO write (proven by `pg_proc.provolatile='s'` + no `INSERT/UPDATE/DELETE` in the body).
- AC-2.6 [ADV] Direct `from('orders')` / `from('event_rsvps')` / `from('reservations')` as the admin session returns 0 rows (no admin RLS) — proving PII stays RPC-gated.

**AC-3 — Venues**
- AC-3.1 [HP] Venues list reads `venue_listings` RLS-direct and returns the 1 live venue with `claim_status` + `venue_category`.
- AC-3.2 [HP] Venue detail reads `venue_reservation_settings` (by `venue_id`), `venue_tables`, `venue_capacity_rules`, `venue_blackouts`, `venue_waitlist` RLS-direct (empty panels render gracefully); `admin_list_venue_reservations` returns `{rows,total,counts}` (0 rows today → `total=0`, panel shows empty state, not a crash).
- AC-3.3 [ADV] Before the 5 new venue-stack RLS policies, the admin session `from('venue_reservation_settings')` returns 0 rows; after, it returns the venue's row — fails-on-revert on the RLS migration.

**AC-4 — UI**
- AC-4.1 [HP] `mingla-admin` builds (`npm run build`) with zero new lint/type errors; the Business nav group shows "Offerings" + "Venues"; `#/business-offerings` + `#/business-venues` load their pages.
- AC-4.2 [HP] Offerings `EntityListView`: type/status/visibility/lifecycle/brand filters narrow rows; a sortable column toggles asc/desc; pagination advances; CSV downloads; empty state shows on a no-match filter.
- AC-4.3 [HP] Row click opens the type-aware detail with back navigation; `EntityDetailView` shows the correct section set per `event_type`; NO action buttons render (read-only).
- **AC-4.4 [ADV — visibility-first guard, fails-on-revert]** `grep` of `offeringsService.js`, `venuesService.js`, `OfferingsConsolePage.jsx`, `OfferingDetailView.jsx`, `VenuesConsolePage.jsx`, `VenueDetailView.jsx` finds ZERO `.update(`/`.insert(`/`.delete(`/`.upsert(` and ZERO `rpc('admin_<verb>...` write calls — only read RPCs + `.select()`. Strict-grep `i-offerings-read-only.mjs` enforces this and FAILS if a write is added.

**AC-5 — Invariants**
- AC-5.1 [HP] Two `I-PROPOSED-1273-*` invariants added DRAFT to `INVARIANT_REGISTRY.md`; the new read RPCs appended to the 1271 gate-first + (read-analog of) audited registries; `i-offerings-read-only.mjs` + fixture present and PASS; job step registered in `strict-grep-mingla-business.yml`.

**Proposed invariants (DRAFT — orchestrator flips ACTIVE on CLOSE):**

| ID | Rule | Enforcement | Fails-on-revert |
|---|---|---|---|
| `I-PROPOSED-1273-OFFERINGS-ADMIN-READ-CROSSBRAND` | The admin offerings console surfaces DRAFT/PRIVATE/cross-brand `events` rows (no silent-empty-read). | Integration test asserting `admin_list_offerings` (as admin) returns a known draft `events.id`. | Reverting the RPC/RLS drops the draft row → test fails (AC-1.4/1.6). |
| `I-PROPOSED-1273-OFFERINGS-READ-ONLY` | The 1273 offerings/venues service + pages contain NO write path; every new offering RLS policy is SELECT-only; every new RPC is `STABLE` and mutation-free. | `.github/scripts/strict-grep/i-offerings-read-only.mjs` over the 1273 allowlist files + a migration assert that the 13 new policies are `cmd=SELECT`. | Adding any write call/policy → grep/assert fails (AC-4.4). |

---

## 9. Implementor task list (ordered) + allowlist

1. **DB — read RLS.** `<ts>_orch_1273_offerings_admin_read_rls.sql`: 13 `CREATE POLICY "<table> admin can read" ... FOR SELECT USING (public.is_admin_user())` (events, event_dates, ticket_types, trip_days, trip_pricing_tiers, trip_inclusions, trip_intake_schemas, experience_stops, experience_feedback, venue_reservation_settings, venue_capacity_rules, venue_tables, venue_blackouts, venue_waitlist). End with a `DO $$` assert that all 13 are `cmd=SELECT`. Do NOT touch `venue_listings`/`brands` (already have policies). (AC-1.4, AC-3.3)
2. **DB — read RPCs.** `<ts>_orch_1273_offerings_read_rpcs.sql`: `admin_list_offerings`, `admin_get_offering`, `admin_list_event_orders`, `admin_list_event_rsvps`, `admin_list_venue_reservations` (+ optional `admin_offering_stats`). Each `STABLE SECURITY DEFINER SET search_path TO 'public'`, guard-first (`IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'`), `GRANT EXECUTE ... TO authenticated`. Server-compute the §4.1 lifecycle CASE. (AC-1.x, AC-2.x)
3. **Service — reads.** `mingla-admin/src/services/offeringsService.js` (`listOfferings`, `getOfferingStats`, `getOffering`, `getTicketTypes`, `getEventDates`, `listEventOrders`, `listEventRsvps`, `getTripDetail`, `getExperienceDetail`) + `venuesService.js` (`listVenues`, `getVenue`, `getVenueReservationSettings`, `getVenueTables`, `getVenueCapacityRules`, `getVenueBlackouts`, `getVenueWaitlist`, `listVenueReservations`). Each returns `{data,error}`; use `.maybeSingle()` (never `.single()`). Read RPCs via `supabase.rpc`; whole-row reads via `supabase.from().select()`.
4. **UI — offerings.** `pages/OfferingsConsolePage.jsx` (`EntityListView` + `admin_list_offerings`); `pages/OfferingDetailView.jsx` (type-aware `EntityDetailView`, empty `actions`).
5. **UI — venues.** `pages/VenuesConsolePage.jsx` (`EntityListView` + `venue_listings` RLS-direct); `pages/VenueDetailView.jsx` (reservation stack + `admin_list_venue_reservations`).
6. **UI — nav.** `lib/constants.js`: append two items to the existing "Business" group (`business-offerings` → "Offerings", `business-venues` → "Venues"). `App.jsx`: add both to `PAGES`. `Sidebar.jsx`: add any new lucide icon to `ICON_MAP` (e.g. `CalendarDays`, `Store`) — else silent fallback to `LayoutDashboard` [1271 §4a footgun].
7. **Invariants + gate.** Add 2 `I-PROPOSED-1273-*` to `INVARIANT_REGISTRY.md`; `i-offerings-read-only.mjs` + `__tests__` fixture; append the 5 new RPCs to the 1271 gate-first registry; register one job step in `strict-grep-mingla-business.yml`.
8. **Self-verify.** `npm run build` (admin) clean; run the new + inherited strict-grep scripts (PASS); prove AC-1.4 (draft surfaced) + AC-4.4 (no write) locally; hand migration/RPC deploy to the orchestrator [memory `feedback_orchestrator_deploys_edge_functions`] with the AC-1.5/AC-2.5/AC-3.3 verification queries.

**Allowlist (implementor may create/modify ONLY these):**
`supabase/migrations/<ts>_orch_1273_offerings_admin_read_rls.sql`, `<ts>_orch_1273_offerings_read_rpcs.sql` · `mingla-admin/src/services/offeringsService.js`, `venuesService.js` · `mingla-admin/src/pages/OfferingsConsolePage.jsx`, `OfferingDetailView.jsx`, `VenuesConsolePage.jsx`, `VenueDetailView.jsx` · `mingla-admin/src/lib/constants.js` · `mingla-admin/src/App.jsx` · `mingla-admin/src/components/layout/Sidebar.jsx` · `.github/scripts/strict-grep/i-offerings-read-only.mjs` (+ `__tests__/` fixture) · `.github/workflows/strict-grep-mingla-business.yml` (append one step) · `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (append the 5 RPCs to its registry ONLY) · `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

**DO-NOT-TOUCH (stop-and-amend first):** `is_admin_user()` · `venue_listings`/`brands` existing policies · the two partner policies + `admin_write_audit`/`admin_audit_probe` (1271) · any existing `admin_*` RPC · `EntityListView`/`EntityDetailView`/`HighRiskActionModal` (consume as-is; if a prop is missing, stop-and-amend) · any admin RLS on `orders`/`order_line_items`/`tickets`/`order_installments`/`event_rsvps`/`event_rsvp_guests`/`reservations` (RPC-only by design — adding a policy is a scope violation) · any shipping-app code · `eventLifecycle.ts`/`eventDateMath.ts` (do NOT import into admin) · `admin_set_city_live`, `delete-user` (1271 discoveries).

---

## 10. Open questions (with defaults)

- **Q1 (BLOCKING iff 1271 unmerged).** 1273 consumes `is_admin_user()` (exists today [verified]) + the `EntityListView`/`EntityDetailView` shells + "Business" nav group (all ORCH-1271 deliverables). The gate + convention exist now; the UI shells + nav group do NOT until 1271 merges. **Default:** dispatch 1273 implementation only AFTER 1271 merges. If parallelizing is required, 1273 must first build the shells itself — a scope collision the orchestrator must resolve. This is the one gating dependency.
- **Q2 (non-blocking).** RN `deriveLiveStatus` short-circuits on `endedAt !== null`; `events` has no `ended_at` column [verified] — the server equivalent is `status='ended'`. **Default:** map `status='ended' → 'past'` (§4.1). Confirm no separate ended-timestamp is expected in the admin bucket.
- **Q3 (non-blocking).** Date-range filter on the list + installment-status sub-panel on trip detail are "nice-to-have." **Default:** ship type/status/visibility/lifecycle/brand filters + itinerary/pricing/inclusions now; date-range + installments = Wave-2 polish if the `EntityListView` filter kit doesn't already support a range control.
- **Q4 (non-blocking, routed).** `experience_feedback` keys on `card_id text` + `experience_title`, NOT `events.id` [verified]. **Default:** ship the experience **stops** panel now; mark **feedback** "Wave-2 (needs `card_id ↔ events` mapping confirmed)". The tester should not gate on feedback.
- **Q5 (non-blocking — test-data gap).** PROD has 0 `experience` events, 0 `trip_days`, 0 `reservations` [verified]. The experience-stops, trip-itinerary, and reservations panels cannot be live-proven against current PROD data. **Default:** prove "renders empty gracefully" against PROD; prove "renders a populated row" against seeded rows on a Supabase **dev branch/clone** (NEVER a PROD write, per COMMS-0061). Standard-event, RSVP, and draft-surfacing paths ARE live-provable on PROD today.
- **Q6 (non-blocking).** `admin_offering_stats` header tiles — ship or defer? **Default:** ship if trivial (mirrors `admin_subscription_stats`); otherwise omit the tiles (not a gate).

---

## 11. Downstream routing

Next = **mingla-implementor** (build per §9 task list, in the per-ORCH worktree; gated on 1271 merge per Q1). Then **mingla-tester** (the §8 AC matrix — especially ADV rows AC-1.4/1.6 draft-surfacing, AC-2.5/2.6 PII-stays-RPC-gated, AC-4.4 no-write guard, AC-3.3 RLS fails-on-revert; seed experience/trip-day/reservation rows on a dev branch per Q5). Then **orchestrator CLOSE** (flip 2 invariants DRAFT→ACTIVE, deploy the 2 migrations, merge one PR, update WORLD_MAP). 1273 is independent of 1272/1274 after 1271; the Wave-2 offerings-edit ORCH (§6) is a future child that consumes the 1271 write primitive + this console's read seams.

*Working tree: to be spawned by the orchestrator at `~/Desktop/mingla-orchs/1273-[offerings-console]/` on branch `1273-offerings-console`. This SPEC written to the anchor `Mingla_Artifacts/reports/` per the dispatch's explicit output path (sibling 1271 spec + all META-1237 investigations live there).*
