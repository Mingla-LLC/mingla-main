# SPEC — ORCH-1016 [Consumer Discover Trips tab — rename Discover + Likes-style Events/Trips tabs + surface real published trips end-to-end + add Departure City across 3 surfaces]

> **Mode:** SPEC (binding implementation contract). No product code in this document.
> **Worktree:** `~/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]/` on branch `ORCH-1016-consumer-discover-trips-tab`. Metro port 8087.
> **Primary input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md` (HIGH confidence, source-read-in-full + live-DB verified).
> **Milestone:** C1 (`Mingla_Artifacts/milestones/C1_CONSUMER_DISCOVER_TRIPS_TAB.md`).
> **Date:** 2026-05-30. **Author:** mingla-forensics+claude (SPEC).
> **DESIGN dependency:** a `mingla-designer` DESIGN pass MUST land between this SPEC and IMPLEMENT for the new trip card, filter-chip row, departure display, trip detail, and all 9 states (see §17). The tab pattern itself is LOCKED to the Likes screen and is NOT a designer-open item.

---

## 0. Comms Ledger (read on entry — acks)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. Relevant OPEN rows and how this SPEC honors them:

- **COMMS-0014** (WARN → meta-orch-0980): trip/experience checkout MUST route through `ticket-checkout-create` (same `eventId` contract), NOT a parallel fn. → **Honored**: §F reuses `nativeCheckoutFlow.ts` → `ticket-checkout-create` verbatim; no parallel checkout fn. Acked.
- **COMMS-0013** (WARN, re ORCH-1006): web hosted-Checkout vs native diverge on TAX basis. → Consumer app is the NATIVE surface and inherits venue-based inclusive tax automatically. No new divergence introduced. Acked.
- **COMMS-0003** (WARN, ALL): external-API enums/payloads cite provider docs at SPEC; Stripe-touching phases invoke `stripe-best-practices`. → **Honored**: `stripe-best-practices` invoked at SPEC start. This SPEC introduces **no new Stripe payload/enum** — it reuses the existing `ticket-checkout-create` native contract (`surface:"native"`, `eventId`, `lines`, `buyer`, `idempotencyKey`, `taxCalculationId`) plus the already-shipped `intake_form_data` body key (ORCH-0880). The one extension — adding `intake_form_data` to the consumer `nativeCheckoutFlow` body — is an INTERNAL Mingla edge-fn key, not a Stripe API field; the Stripe contract (PaymentIntent client-secret → PaymentSheet) is unchanged. Stripe docs already cited inline in `nativeCheckoutFlow.ts` (`https://docs.stripe.com/payments/accept-a-payment?platform=react-native`). No new Stripe doc-citation owed. Acked.
- **COMMS-0002** (WARN, ALL): the ORCH-0863 strict-grep C7 gate blocks new `supabase/functions/**` + migration files unless allow-listed in the SAME commit. → **Honored**: §A.5 makes `ORCH_1016_BACKEND_ALLOWLIST` a required deliverable in the same commit as the two new migrations. Acked.

No new cross-ORCH discovery requiring a new COMMS-NNNN row. (The `usePublicTripBySlug` anon-brands bug is filed as INVESTIGATION D-1 / SPEC NG-4; it is a "do-not-copy" constraint internal to this ORCH, not a regression in another in-flight ORCH.)

---

## 1. Scope

Build the consumer-app (`app-mobile/`) Discover **Trips** tab end-to-end, plus a new **Departure City** field that spans 3 surfaces (business authoring, consumer display + filter, buyer-web display). Specifically:

1. **Shell:** Rename the Discover title "Events"→"Discover"; convert Discover into a tabbed surface (**Events** + **Trips**) using the EXACT `LikesPage` spotlight-pill pattern. Events tab mounts the existing Discover grid pipeline UNCHANGED. Trips tab mounts the new feed.
2. **Feed backend:** a NEW global SECURITY DEFINER RPC `pg_published_trips_public(...)` (anon-granted, filterable, sorted, paginated) mirroring `pg_public_trips_by_brand` but global.
3. **Departure City:** ONE new `events.departure_text` column (+ optional `events.departure_geo point`) via a new migration; a "Departing from" Google-Places input on the business trip create + edit forms; consumer card + detail + buyer-web page render "Leaving from {city}"; the feed RPC exposes `departure_text` and accepts a departure-city filter param (SEPARATE from the destination filter).
4. **Consumer read layer:** `tripsDiscoveryService.ts` + `useDiscoverTrips.ts` + `TripCard.tsx` + `TripFilterChips.tsx`.
5. **Consumer trip detail:** a native screen mirroring `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` STRUCTURE, mounted as a full-screen overlay (state slot in `app/index.tsx`) AND exposed as an Expo Router deep-link re-export at `app-mobile/app/t/[brandSlug]/[tripSlug].tsx`. Repoint `ConsumerBrandProfileScreen.onOpenTrip` away from `WebBrowser.openBrowserAsync` to the in-app overlay.
6. **Buyer flow:** reuse `nativeCheckoutFlow.ts` → `ticket-checkout-create` (surface:"native"); add tier→`ticket_type_id` mapping, trip intake form (`trip_intake_schemas` → `orders.intake_form_data`), booking-deadline/bookings_closed CTA enforcement, refund-policy + installment display.

---

## 2. Non-Goals (explicitly OUT of C1 scope — 🔒 LOCKED)

- **NG-1 (🔒 LOCKED): Intent filter chip (AC #3).** DEFERRED to C2. No intent chip in the filter row. No trip-intent column. Operator-locked decision #2. Rationale: no backing data (investigation F-D2 — `vibe_tags`/`party_types`/`theme.business_trip` empty on all 3 trips).
- **NG-2 (🔒 LOCKED): Trip signal-scoring (AC #12).** DEFERRED to C2. No changes to `scoringService.ts` / `discover-cards` / `signalRankFetch`. The Trips relevance sort uses newest + optional destination-proximity (computed in the RPC `ORDER BY`), NOT the place-pool scorer. Operator-locked decision #2.
- **NG-3 (🔒 LOCKED): No demo-data seeding.** Build/test against the 3 existing real trips only. Verified badge and departure-city filter render conditionally and will be sparse; NEVER fabricate. Operator-locked decision #4.
- **NG-4 (🔒 LOCKED): Do NOT fix/touch `mingla-business/src/hooks/usePublicTripBySlug.ts`.** It reads `brands` directly (investigation F-E2/D-1). The consumer detail hook must NOT copy it. Fixing the business hook is a separate INVESTIGATE (D-1), out of this ORCH.
- **NG-5 (🔒 LOCKED): Admin web + marketing web untouched.** Neither renders this surface.
- **NG-6 (🔒 LOCKED): `show_on_discover` is IGNORED for trips.** The feed does NOT filter on `show_on_discover`. Operator-locked decision #1.
- **NG-7 (🔒 LOCKED): Saved/favorited trips + trip-card-on-consumer-profile.** DEFERRED (milestone §9).

---

## 3. Assumptions (proven, not guessed)

- A-1: The 3 published trips are the only test data; the feature ships against them (live-DB verified, investigation F-C2).
- A-2: `intake_form_data` already rides the `ticket-checkout-create` body (array shape) and lands in `orders.intake_form_data` (RESOLVED — §F.4, migration `20260620000000` Section 1 + edge-fn lines 362-456). The consumer `nativeCheckoutFlow.ts` currently OMITS this body key and must add it.
- A-3: `destination_text` carries NO geo column today; destination lat/lng live in `theme.business_trip.destinationLat/Lng`. `events.location_geo` is a native Postgres `point` (PostGIS is installed but the events geo convention is native `point`). Departure geo (if added) follows the `point` convention.
- A-4: Anon has table grants on `events`/`event_dates`/`ticket_types`/`trip_*` but NOT on `brands`/`tickets` (COMMS-0009). Planner name + verified badge + spots_left therefore MUST come from a SECURITY DEFINER RPC (investigation F-C1).

---

## 4. RESOLVED — Intake-Answer Persistence Sink (the one investigation `suspected` seam)

**STATUS: RESOLVED (no longer an OPEN question).** Traced through the migration + edge function + business checkout chain:

**The sink is `public.orders.intake_form_data jsonb`** (added by migration `20260620000000_orch_0880_tr5_traveler_intake_forms.sql` Section 1, lines 42-46).

Exact wire path (proven):
1. Business buyer fills `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` → on Continue, commits per-tier answers to `CartContext.intakeFormData[ticketTypeId]` via `setIntakeTierData` (intake.tsx:343), shape `{ ticket_type_id, schema_version_id, answers: {question_id: value} }` (intake.tsx:338-342).
2. The next `createTicketCheckout`/`ticket-checkout-create` invocation carries an **array** `intake_form_data: [{ ticket_type_id, schema_version_id, answers }, …]` in the request body (edge fn `ticket-checkout-create/index.ts` line 369 documents the body shape; lines 374-456 read it, look up `trip_intake_schemas`, enforce required questions, and check schema-version freshness).
3. The edge fn / `biz_ticket_checkout_finalize` writes the answers to `orders.intake_form_data` (per-order jsonb, per migration Section 1 comment; column shape `{ticket_type_id, schema_version_id, answers}`).
4. The planner reads them back via `useTripOrders.ts` → `TravelerIntakeAnswerCard.tsx`.

**Consumer contract (🔒 LOCKED):** the consumer trip checkout MUST submit `intake_form_data` as the **same array shape** on the SAME `ticket-checkout-create` body, so answers land in the SAME `orders.intake_form_data` column. The current consumer `nativeCheckoutFlow.ts` body (lines 115-130) does NOT include `intake_form_data` — §F.4 extends `NativeCheckoutInput` + the invoke body to add it. No new table, no new column, no separate write. This is a body-key addition to an already-supported edge-fn contract.

**Residual narrow note (🎨 OPEN, non-blocking):** file-upload intake questions use `trip_intake_files` storage + `trip-intake-upload-signed-url` edge fn with a `pending-{email}-{ticketTypeId}` placeholder order_id (intake.tsx:301-309); post-payment file→order association is a pre-existing best-effort path shared with the business flow. C1 consumer checkout reuses it unchanged; if a trip tier's schema has NO `file_upload` questions (true for all current trips — zero schemas exist today), this path is never exercised. The implementor reuses `uploadIntakeFile` from `intakeSchemaService` as-is; no new behavior owed.

---

## 5. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched | Parity |
|---|---------|----------|------------------------|---------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | Discover title "Discover"; Events/Trips pill tabs; Trips feed + filters + sort + card; trip detail overlay; in-app trip checkout; "Leaving from {city}" on card + detail | All `app-mobile/` files in §A/§D/§E/§F + i18n | Shared RN code → automatic with Android (one codebase) |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | Same as iOS, with `ANDROID_GLASS_USES_OPAQUE_FALLBACK` opaque-frosted pill + cards | Same | Automatic (shared) — BUT separate SC for the Android opaque-glass fallback on the new pill + TripCard (SC-13-Android) |
| 3 | **Buyer/anon Web** (`mingla-business/app/t/[brandSlug]/[tripSlug].tsx`) | YES (display only) | Public trip page renders "Leaving from {city}" line below the destination line | `mingla-business/src/components/trip/TripPreview.tsx` + the trip read adapter (`tripsService.readBusinessTrip` + `usePublicTripBySlug` projection) to surface `departure_text` | Manual — separate code path → SC-11-Web |
| 4 | **Business iOS** (`mingla-business/` iOS) | YES (authoring) | New "Departing from" Google-Places input on trip create (`TripCreatorStep1Basics`) + edit (`EditPublishedTripScreen`) forms | `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`, `EditPublishedTripScreen.tsx`, `tripsService.ts`, `tripAdapter.ts`, the published-edit RPC patch path | Shared RN → automatic with Business Android; manual vs consumer (different codebase) → SC-10-iOS |
| 5 | **Business Android** (`mingla-business/` Android) | YES (authoring) | Same "Departing from" input | Same | Automatic with Business iOS (shared) → SC-10-Android |
| 6 | **Admin Web** (`mingla-admin/`) | NO | — | — | Admin doesn't render trips or the trip authoring form |
| 7 | **Business Web preview** (`mingla-business/` web build) | INCIDENTAL | The "Departing from" input + "Leaving from" display render on the business web build too (shared RN-web), but no NEW web-only behavior is specced; the buyer-web trip page (#3) is the only intentional web target | Same as #3/#4 | Incidental shared |

**NOT-covered rationale:** Admin (#6) never renders this surface. The existing consumer Discover **grid** (Events tab content) is untouched (regression-protected, §A.2). The existing business buyer-web checkout chain (`/checkout-trip/...`) is untouched — only the consumer native path is added.

---

## 6. Operator Decisions (all 🔒 LOCKED — honored verbatim)

1. **`show_on_discover` IGNORED for trips** (NG-6). Feed surfaces ALL trips passing hard guards.
2. **Intent chip + trip scoring DEFERRED to C2** (NG-1, NG-2).
3. **Departure City added fully** across business authoring + consumer display/filter + buyer-web display (§A.1, §B, §D, §E.4).
4. **No demo-data seeding** (NG-3).

---

# LAYER-BY-LAYER CONTRACT

Implementation order is the section order: **A (DB/migration) → B (business authoring UI) → C (RLS/RPC+GRANT recap) → D (consumer service/hook) → E (consumer components + nav/detail) → F (buyer flow) → G (public-web display) → H (strict-grep + i18n)**. (A precedes B because B writes the new column.)

---

## §A — Database / Migrations

Two new migrations. Both additive. Naming follows the `YYYYMMDDHHMMSS_orch_1016_*.sql` convention; pick timestamps strictly greater than the current max migration timestamp at implement time (check `supabase/migrations/` for the latest `2026*` file and increment).

### A.1 — Migration 1: `events.departure_text` (+ optional `departure_geo`) — 🔒 LOCKED

File: `supabase/migrations/<TS1>_orch_1016_events_departure_text.sql`

```sql
BEGIN;
-- ORCH-1016 [Consumer Discover Trips tab] — DEPARTURE CITY field.
-- Additive, nullable. No backfill (operator decision #4: no demo data;
-- existing trips simply have NULL departure until a planner sets it).
-- Drift-safe: ADD COLUMN ... IF NOT EXISTS; no data migration; safe-migration
-- protocol needs no backfill guard.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS departure_text text DEFAULT NULL;

-- Optional geo, native `point` (mirrors events.location_geo convention; NOT
-- PostGIS geography — A-3). Populated from the Google-Places pick lat/lng so a
-- future departure-proximity sort/filter has data. Nullable; never required.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS departure_geo point DEFAULT NULL;

COMMENT ON COLUMN public.events.departure_text IS
  'ORCH-1016: trip DEPARTURE/origin city (where travelers leave from), e.g. "Washington, DC, USA". Mirrors destination_text (where the trip goes). NULL = not set. Trip-only field; events leave it NULL.';
COMMENT ON COLUMN public.events.departure_geo IS
  'ORCH-1016: optional native point(lng,lat) for the departure city, from the Google-Places pick. Mirrors events.location_geo. Nullable; future proximity sort.';
COMMIT;
```

- 🔒 **`departure_text` is REQUIRED to add.** It is the field the card/detail/buyer-web render and the feed filters on.
- 🎨 **`departure_geo` decision (justified OPEN→resolved to ADD):** ADD it. Justification: the Places "Departing from" pick already yields lat/lng (the destination input proves this, `TripCreatorStep1Basics.tsx:357-358`), so capturing it is free, and it future-proofs a departure-proximity filter without a second migration. It follows the existing `events.location_geo point` convention (not PostGIS) so no new type dependency. It is NEVER required and the feed's C1 departure filter is **text-equality on a normalized city token** (§D.3), not geo — so `departure_geo` is unused in C1 reads but populated for C2.
- **Drift-safe note (🔒 LOCKED):** both `ADD COLUMN IF NOT EXISTS`, nullable, no backfill. No safe-migration backfill guard needed. Per the safe-migration carve-out in the dispatch.

### A.2 — Migration 2: `pg_published_trips_public(...)` global SECURITY DEFINER RPC — 🔒 LOCKED

File: `supabase/migrations/<TS2>_orch_1016_pg_published_trips_public.sql` (TS2 > TS1).

**Exact signature + return columns (🔒 LOCKED — mirrors `pg_public_trips_by_brand` shape, global + filterable + paginated):**

```sql
CREATE OR REPLACE FUNCTION public.pg_published_trips_public(
  p_destination_query text    DEFAULT NULL,  -- ILIKE match on destination_text (city filter "where it goes")
  p_departure_query   text    DEFAULT NULL,  -- ILIKE match on departure_text (city filter "where travelers leave from") — SEPARATE from destination
  p_date_from         timestamptz DEFAULT NULL,  -- trip master start_at >= (inclusive)
  p_date_to           timestamptz DEFAULT NULL,  -- trip master start_at <= (inclusive)
  p_min_price_cents   integer DEFAULT NULL,  -- min_price_cents >= (NULL = no floor)
  p_max_price_cents   integer DEFAULT NULL,  -- min_price_cents <= (NULL = no ceiling)
  p_group_size_min    integer DEFAULT NULL,  -- total_capacity >= (NULL = no floor); unlimited-capacity trips always pass
  p_group_size_max    integer DEFAULT NULL,  -- total_capacity <= (NULL = no ceiling); unlimited-capacity trips always pass
  p_sort              text    DEFAULT 'relevance',  -- 'relevance' | 'oldest' | 'price_asc' | 'price_desc'
  p_limit             integer DEFAULT 20,    -- page size; clamp 1..50 inside fn
  p_offset            integer DEFAULT 0      -- pagination offset; clamp >= 0
)
RETURNS TABLE (
  trip_id          uuid,
  trip_slug        text,
  brand_slug       text,
  brand_name       text,        -- NEW vs by-brand RPC: planner display name (definer JOIN on brands)
  brand_verified   boolean,     -- NEW: brands.verified_at IS NOT NULL (badge; false today for all)
  title            text,
  description      text,
  destination_text text,
  departure_text   text,        -- NEW (ORCH-1016): "Leaving from {city}"
  cover_media_url  text,
  cover_media_type text,
  status           text,
  start_at         timestamptz, -- event_dates master start
  end_at           timestamptz, -- event_dates master end
  timezone         text,
  bookings_closed  boolean,
  booking_deadline timestamptz, -- NEW: surfaced so the card/detail can show countdown (hard-guard already applied in WHERE)
  total_capacity   integer,     -- NULL if any tier unlimited
  tickets_sold     integer,
  spots_left       integer,     -- NULL if unlimited; GREATEST(cap - sold, 0) otherwise
  min_price_cents  integer,
  currency         text,
  has_free_tier    boolean,
  published_at     timestamptz,
  total_count      bigint       -- NEW: window COUNT(*) OVER () for pagination ("N trips") — see A.3
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ ... $$;

REVOKE ALL ON FUNCTION public.pg_published_trips_public(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_published_trips_public(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer, text, integer, integer
) TO anon, authenticated;
```

### A.3 — RPC body requirements (🔒 LOCKED)

The body MUST be structured like `pg_public_trips_by_brand`'s CTE chain (`trip_rows`, `dates`, `capacity`, `sold`, `pricing`), with these differences:

1. **NO brand-kind guard.** Per `feedback_brand_kind_decommissioned` (universal authoring), do NOT filter `brands.kind = 'trip_planner'`. JOIN `brands` only to surface `brand_name` + `brand_verified` + `brand_slug` and to exclude `brands.deleted_at IS NOT NULL`.

2. **HARD GUARDS in the `trip_rows` WHERE (🔒 LOCKED — the regression-protected clause):**
   ```sql
   WHERE e.event_type = 'trip'
     AND e.visibility = 'public'
     AND e.status IN ('scheduled','live')          -- NOT ended/cancelled (by-brand RPC allows those; this feed does NOT)
     AND e.deleted_at IS NULL
     AND COALESCE(e.bookings_closed, false) = false
     AND (e.booking_deadline IS NULL OR e.booking_deadline >= now())  -- NULL deadline = open = surfaced
     AND EXISTS (                                    -- >= 1 published, non-hidden pricing tier
       SELECT 1 FROM public.trip_pricing_tiers tpt2
       JOIN public.ticket_types tt2 ON tt2.id = tpt2.ticket_type_id
       WHERE tpt2.event_id = e.id
         AND tt2.deleted_at IS NULL
         AND COALESCE(tt2.is_hidden, false) = false
     )
   -- NOTE (operator decision #1): show_on_discover is INTENTIONALLY NOT filtered.
   ```
   This WHERE is the **fails-on-revert** target: a regression test must prove that removing any one conjunct (e.g. dropping the `booking_deadline` clause, or the `status IN` clause, or the tier-EXISTS) lets a non-qualifying trip leak into the result (§14, T-09).

3. **`spots_left` / capacity / sold** computed exactly as `pg_public_trips_by_brand` does (I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE — bool_or unlimited, `SUM(quantity_total)`, sold = COUNT of tickets in `('valid','used','transferred')`, `GREATEST(cap - sold, 0)`). Do NOT invent a new formula. 🔒 LOCKED.

4. **Filters (🔒 LOCKED — all applied inside SQL, never client-side):**
   - `p_destination_query`: `(p_destination_query IS NULL OR e.destination_text ILIKE '%'||p_destination_query||'%')`.
   - `p_departure_query`: `(p_departure_query IS NULL OR e.departure_text ILIKE '%'||p_departure_query||'%')` — SEPARATE from destination.
   - `p_date_from`/`p_date_to`: applied to the master `start_at` (from the `dates` CTE) — `(p_date_from IS NULL OR d.start_at >= p_date_from) AND (p_date_to IS NULL OR d.start_at <= p_date_to)`. Trips with no master date row: EXCLUDED when a date filter is set, INCLUDED when no date filter (LEFT JOIN keeps them when both params NULL).
   - `p_min_price_cents`/`p_max_price_cents`: applied to the computed `min_price_cents` (free-tier-only trips have NULL min_price_cents → EXCLUDED when a price filter is set, INCLUDED when no price filter).
   - `p_group_size_min`/`p_group_size_max`: applied to `total_capacity`; **unlimited-capacity trips (total_capacity IS NULL) ALWAYS pass** the group-size filter (can host any group).
   - All filters compose with AND.

5. **Sort (🔒 LOCKED):**
   - `'relevance'` (default): `ORDER BY (CASE WHEN status='live' THEN 0 ELSE 1 END), published_at DESC NULLS LAST, trip_id` — newest-first. (Location-proximity is 🎨 OPEN for a later pass; C1 default = newest. The designer/operator default-sort choice is recorded in §17; the RPC supports the four modes regardless.)
   - `'oldest'`: `ORDER BY published_at ASC NULLS LAST, trip_id`.
   - `'price_asc'`: `ORDER BY min_price_cents ASC NULLS LAST, trip_id`.
   - `'price_desc'`: `ORDER BY min_price_cents DESC NULLS LAST, trip_id`.
   - Any unrecognized `p_sort` → fall through to `'relevance'`.

6. **Pagination (🔒 LOCKED):** clamp `p_limit` to `LEAST(GREATEST(p_limit,1),50)`, `p_offset` to `GREATEST(p_offset,0)`; apply `LIMIT/OFFSET` after sort. Return `COUNT(*) OVER ()` as `total_count` on every row (so the hook knows whether more pages exist + can show "N trips"). When zero rows match, the hook infers empty from an empty array (total_count absent) — see §D.

7. **GRANT (🔒 LOCKED):** `REVOKE ALL ... FROM PUBLIC` then `GRANT EXECUTE ... TO anon, authenticated` (mirrors `pg_public_trips_by_brand:130-131`). Anon-tolerant per AC #6.

8. **Self-verification DO-block (🔒 LOCKED):** end the migration with a `DO $verify$ … $verify$` block asserting: (a) the function exists + is SECURITY DEFINER, (b) anon has EXECUTE (`has_function_privilege('anon', 'public.pg_published_trips_public(text,text,timestamptz,timestamptz,integer,integer,integer,integer,text,integer,integer)', 'EXECUTE')`), (c) a smoke call `SELECT count(*) FROM pg_published_trips_public()` returns >= 0 without error. RAISE EXCEPTION on any failure (mirrors the ORCH-0880 self-verify pattern).

### A.4 — Migration safety (🔒 LOCKED)
- Both migrations additive. Migration 1 = ADD COLUMN ×2 (nullable, no backfill). Migration 2 = CREATE OR REPLACE FUNCTION + GRANT (idempotent).
- **The operator runs `supabase db push`** (per autonomy posture — DB push is operator-or-orchestrator). The implementor does NOT apply via MCP `apply_migration` (creates remote-only timestamps).

### A.5 — Strict-grep backend allowlist (🔒 LOCKED — COMMS-0002, same commit)
In the SAME commit as the two migrations, add to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`:
```js
// ORCH-1016 [Consumer Discover Trips tab] — global published-trips RPC +
// departure_text column. C7 is scoped to ORCH-0863 marketing; these are
// ORCH-1016 consumer-surfacing backend touches.
const ORCH_1016_BACKEND_ALLOWLIST = [
  "supabase/migrations/<TS1>_orch_1016_events_departure_text.sql",
  "supabase/migrations/<TS2>_orch_1016_pg_published_trips_public.sql",
];
```
and spread it into the combined allowed array alongside the other `...ORCH_XXXX_BACKEND_ALLOWLIST` entries (near line ~1081). If the buyer-flow change requires editing `supabase/functions/ticket-checkout-create/index.ts`, that file is ALREADY allowlisted (ORCH-0880, line 410) — but C1 should NOT need to edit the edge fn at all (the `intake_form_data` body key already exists). If any new `supabase/functions/**` file is added, allowlist it too.

---

## §B — Business Authoring UI ("Departing from" input)

### B.1 — Create form (🔒 LOCKED)
File: `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`.

Add a "Departing from" field **immediately above** the existing "Destination" field group (logical order: leave-from then go-to), mirroring the Destination block EXACTLY (lines 347-371):
- Label: `Departing from` (🔒 plain, no jargon).
- Component: `<AddressAutocompleteInput>` (the SAME component the Destination field uses — `mingla-business/src/components/event/AddressAutocompleteInput.tsx`, props `{ value, onChangeText, onPick(PlaceDetails), onClear, placeholder }`).
- Placeholder: `e.g. Washington, DC, USA` (🎨 OPEN copy within voice).
- Draft fields added to the Step1 draft interface (mirror `destination*` at lines 46-49): `departurePlaceId: string | null`, `departureLocationText: string | null`, `departureLat: number | null`, `departureLng: number | null`.
- `onPick(place)` → `onChange({ departurePlaceId: place.placeId, departureLocationText: place.formattedAddress, departureLat: place.location.lat, departureLng: place.location.lng })`.
- `onClear` → null all four.
- **OPTIONAL field (🔒 LOCKED):** departure is NOT required to publish a trip (NG-3 sparse-data reality; existing trips have no departure). No validation gate blocks publish on missing departure.

### B.2 — Edit (published) form (🔒 LOCKED)
File: `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`.
Add the same "Departing from" `<AddressAutocompleteInput>` block. The edit path persists via the published-trip patch RPC (`biz_update_live_trip` or the live-fields update path `tripsService` uses — investigation note tripsService.ts:711 routes destination through `updateLiveTripFields`). **Departure is an ADDITIVE edit** (not a refund-gated field): extend the events-row UPDATE in the patch path to set `departure_text` + `departure_geo` from the patch, with NO refund-gate (it doesn't change price/dates/capacity/inclusions). Mirror exactly how `destination_text` is written.

### B.3 — Persistence (🔒 LOCKED)
File: `mingla-business/src/services/tripsService.ts` (+ `tripAdapter.ts`).
- On create: write `departure_text` (from `departureLocationText`) to `events.departure_text` and `departure_geo` to `events.departure_geo` (as `point(departureLng, departureLat)` when both present, else NULL). Mirror the `destination_text` write at `tripsService.ts:403`.
- Map the read back (`readBusinessTrip` / the `BusinessTrip` adapter shape) to add `departureLocationText: string | null` (+ optionally `departureLat/Lng`), sourced from `events.departure_text` / `departure_geo`, so the public page and preview can render it.
- 🔒 The `departure_geo` write: native `point` is `point(lng, lat)` (longitude first, matching the existing `location_geo` convention — verify the existing destination/location geo write order in the codebase and match it exactly).

### B.4 — Preview (🔒 LOCKED)
File: `mingla-business/src/components/trip/TripPreview.tsx`.
The preview renders destination at lines 129-140 (`trip.businessTrip.destinationLocationText`). Add a parallel "Leaving from {city}" line immediately ABOVE or paired with the destination line, gated `trip.businessTrip.departureLocationText !== null` (conditional render — NEVER show an empty "Leaving from" line). 🎨 Designer owns the exact visual pairing (icon, order, separator) — see §17.

---

## §C — RLS / RPC + GRANT (recap)

Covered in §A.2/A.3. Key invariants:
- 🔒 The RPC is the ONLY anon path to planner name + verified badge + spots_left (I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009). Anon NEVER reads `brands`/`tickets` directly.
- 🔒 GRANT EXECUTE TO anon, authenticated (anon-tolerant).
- 🔒 No new RLS policies needed (the RPC is SECURITY DEFINER; the underlying `trip_*` anon SELECT policies already exist).

---

## §D — Consumer Service + Hook

### D.1 — `tripsDiscoveryService.ts` (NEW) — 🔒 LOCKED
File: `app-mobile/src/services/tripsDiscoveryService.ts`.

- Export a typed `DiscoverTripRow` interface matching the RPC return columns 1:1 (camelCase mapping: `trip_id`→`tripId`, `brand_name`→`brandName`, `brand_verified`→`brandVerified`, `departure_text`→`departureText`, etc.).
- Export `DiscoverTripFilters` interface:
  ```ts
  interface DiscoverTripFilters {
    destinationQuery: string | null;
    departureQuery: string | null;   // SEPARATE from destination
    dateFrom: string | null;         // ISO
    dateTo: string | null;           // ISO
    minPriceCents: number | null;
    maxPriceCents: number | null;
    groupSizeMin: number | null;
    groupSizeMax: number | null;
    sort: 'relevance' | 'oldest' | 'price_asc' | 'price_desc';
  }
  ```
- Export `fetchPublishedTrips(filters, { limit, offset }): Promise<{ rows: DiscoverTripRow[]; totalCount: number }>` that calls `supabase.rpc('pg_published_trips_public', { p_destination_query, p_departure_query, p_date_from, p_date_to, p_min_price_cents, p_max_price_cents, p_group_size_min, p_group_size_max, p_sort, p_limit, p_offset })`.
- **Error contract (🔒 LOCKED):** on RPC error, THROW (typed `TripsDiscoveryError` with the Supabase message). Do NOT swallow (Constitution rule 3 — no silent failures). `totalCount` derived from `rows[0]?.total_count ?? 0`.
- **No mobile cache (🔒 LOCKED — I-PROPOSED-DISCOVER-NO-MOBILE-CACHE):** do NOT add an AsyncStorage/in-memory cache for trips. React Query is the only cache.

### D.2 — `useDiscoverTrips.ts` (NEW) — 🔒 LOCKED
File: `app-mobile/src/hooks/useDiscoverTrips.ts`.

- **Query-key factory (🔒 LOCKED — one key per entity, Constitution rule 4):**
  ```ts
  export const discoverTripsKeys = {
    all: ['discoverTrips'] as const,
    list: (filters: DiscoverTripFilters) =>
      [...discoverTripsKeys.all, 'list', filters] as const,
  };
  ```
  The full `filters` object is part of the key so any filter/sort change refetches with a distinct cache entry.
- Use `useInfiniteQuery` (AC #11 pagination/infinite scroll): `queryKey: discoverTripsKeys.list(filters)`, `queryFn: ({ pageParam = 0 }) => fetchPublishedTrips(filters, { limit: 20, offset: pageParam })`, `getNextPageParam: (lastPage, allPages) => { const loaded = allPages.flatMap(p => p.rows).length; return loaded < lastPage.totalCount ? loaded : undefined; }`, `initialPageParam: 0`.
- `staleTime: 60_000` (🎨 OPEN 30s–120s band — trips change rarely). `enabled: true` (anon-tolerant; no auth gate).
- Return `{ trips: DiscoverTripRow[] (flattened), totalCount, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch }`.
- **Cache invalidation:** none owed in C1 (read-only feed; no consumer mutation writes to trips). A successful checkout does NOT need to invalidate the feed (spots_left staleness for ≤60s is acceptable; the detail screen re-reads on open). 🎨 OPEN: optionally invalidate `discoverTripsKeys.all` after a successful trip checkout to refresh spots_left.

---

## §E — Consumer Components + Navigation + Detail

### E.1 — Tab shell on Discover (🔒 LOCKED pattern = Likes exact)
File: `app-mobile/src/components/DiscoverScreen.tsx` (the real Discover surface — investigation F-A1; NOT `src/screens/Discover/`).

- **Title rename (🔒 LOCKED):** `discover:title` → "Discover". Change the EN locale (`app-mobile/src/i18n/locales/en/discover.json:2`) to `"Discover"`. **Decision (🔒 LOCKED): EN-only in C1.** Other ~40 locale files keep their current "Events"-equivalent `title` value until translated (NG: do not hand-translate 40 locales in this ORCH). Add a `discover:trips_tab` + `discover:events_tab` key set (see §H).
- **Tab pattern (🔒 LOCKED to the `LikesPage.tsx` interface, investigation F-B1):** reuse the EXACT spotlight-pill pattern — `TABS` array (`{ id, label, icon }`), `activeTab` state synced to a NEW Zustand registry slot `discoverActiveTab`/`setDiscoverActiveTab` (mirror `likesActiveTab` in `useAppStore`), `tabLayoutsRef` + `spotlightX`/`spotlightWidth` `Animated.Value`s, the `Animated.spring` spotlight (`useNativeDriver:false`, `reduceMotion`→instant), the glass `<BlurView>` header with the Android opaque fallback, the exact pill geometry tokens (`PILL_BAR_HEIGHT=52`, `HEADER_PANEL_RADIUS=28`, etc.), `accessibilityRole="tab"`+`accessibilityState={{selected}}`, `Haptics.impactAsync(Medium)` on iOS + `mixpanelService.trackTabViewed({ screen:'discover', tab })`, and the simple conditional content swap (`{activeTab==='events' && <EventsContent/>}` / `{activeTab==='trips' && <TripsContent/>}`). Both children memoized (I-TAB-SCREENS-MEMOIZED).
  - Tab 1: `events` — label from `discover:events_tab` ("Events"), icon (🎨 designer picks; suggest existing Discover icon).
  - Tab 2: `trips` — label from `discover:trips_tab` ("Trips"), icon (🎨 designer; suggest a route/compass/suitcase glyph from the existing icon set — NO emoji, NO new asset).
- **Events tab content = the existing grid pipeline, UNCHANGED (🔒 LOCKED regression surface, investigation §Q-A):** the merged-endpoint fetch (`fetchNightOutEvents`) + `discoverEventsCache` full-signature cache + city picker + filter chips + `ExpandedCardModal`/`ExpandedBusinessEventSheet` + RNGH gesture coordination + `useTabScrollRegistry('discover_main')` + Android opaque-glass fallback all preserved byte-for-byte. Adding the tab MUST NOT perturb the `discoverEventsCache` key signature (ORCH-0996) and MUST NOT trip the `app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs` gate.
- **🎨 OPEN (DESIGNER):** the IA tension between the pill switcher and the existing Discover filter-chip row (city/date chips + Filters button). Does the Events tab keep its filter-chip row below the pill? Does the Trips tab get its own filter row (`TripFilterChips`)? The pill pattern is LOCKED; the header composition (pill + which filter row shows per tab) is the designer's call (§17).

### E.2 — `TripCard.tsx` (NEW) — functional contract 🔒 LOCKED, visual 🎨 DESIGNER
File: `app-mobile/src/components/discover/TripCard.tsx`.

- Props: `{ trip: DiscoverTripRow; onPress: (trip) => void }`.
- **Renders (🔒 LOCKED data, conditional rules):**
  - Cover: `trip.coverMediaUrl` (+ `coverMediaType` image/gif/video via the shared `@mingla/event-rendering` `EventCoverMedia` — reuse, do NOT build a new media renderer). Fallback when null: neutral placeholder (🎨 designer; NEVER a fabricated image).
  - Title: `trip.title`.
  - Dates: from `trip.startAt`/`trip.endAt` (formatted range; reuse the business `formatTripDateRange` logic or an equivalent — NO new date lib). Conditional: if both null, hide the date line.
  - Destination: "to {trip.destinationText}" — conditional, hide if null.
  - **Departure (🔒 LOCKED, conditional):** "Leaving from {trip.departureText}" — render ONLY when `trip.departureText !== null` (NG-3 sparse). NEVER show an empty departure line.
  - Planner name: `trip.brandName`.
  - **Verified badge (🔒 LOCKED, conditional):** render the badge ONLY when `trip.brandVerified === true`. **Zero verified planners exist today** (investigation F-C2) → the badge will not render in C1 against real data. Do NOT fabricate. Use the existing verified-badge primitive if one exists; else 🎨 designer specs it.
  - Price-from: `trip.minPriceCents` formatted in `trip.currency` (currency-aware, Constitution rule 10). Conditional: if `minPriceCents` null AND `hasFreeTier` → show "Free"; if both null → hide price.
  - Capacity/spots: `trip.spotsLeft` ("{n} spots left") when non-null; when null (unlimited) → hide or show "Open" (🎨 designer).
  - "Reserve"/tap affordance (the whole card is tappable → `onPress(trip)`).
- **Android opaque-glass (🔒 LOCKED):** any glass/blur on the card honors `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (opaque ≥0.92 fill + `overflow:'hidden'`, no Android shadow under rounded fill). → SC-13-Android.
- 🎨 **DESIGNER owns:** full-bleed-image vs structured-grid card layout (milestone §9 open polish), exact tokens, spacing, typography, badge visual, press feedback, all per §17.

### E.3 — `TripFilterChips.tsx` (NEW) — functional 🔒, visual 🎨
File: `app-mobile/src/components/discover/TripFilterChips.tsx`.

- Props: `{ filters: DiscoverTripFilters; onChange: (next) => void }`.
- **Chips (🔒 LOCKED set — NO intent chip, NG-1):**
  1. **Destination city** — text/city picker (reuse the existing `CityPickerSheet` pattern if it fits, or a search input) → sets `destinationQuery`.
  2. **Departure city** (🔒 NEW, SEPARATE chip) → sets `departureQuery`. Label "Leaving from". This is distinct from destination.
  3. **Dates** — this month / next month / custom (🎨 designer picks the exact presets within the `dateFrom`/`dateTo` contract).
  4. **Price range** → `minPriceCents`/`maxPriceCents`.
  5. **Group size** → `groupSizeMin`/`groupSizeMax`.
  6. **Sort** control (relevance / oldest / price asc / price desc) → `sort`. (Can be a chip or a sort sheet — 🎨 designer.)
- Each filter change updates `filters` → new query key → refetch (D.2).
- 🎨 **DESIGNER owns:** chip row layout (vs the Events filter row), active/inactive chip visuals, the picker sheets' visuals, all per §17.

### E.4 — Consumer trip detail screen (NEW) — structure 🔒, visual 🎨
File: `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (NEW; the milestone's `src/screens/Trip/TripDetail.tsx` name is acceptable — pick one and be consistent).

- **Mirror the STRUCTURE of `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`** (investigation F-E1):
  - Full-bleed cover hero (TripPreview-equivalent with `showCta={false}`-style) + absolute X-close (`onBack`) + share overlay.
  - Booking-deadline state (ORCH-0875): closed banner / countdown pill / refund-policy ladder (reuse `RefundPolicyDisplay` — investigation says reuse the business logic; if it's a `mingla-business` component, either extract to a shared package or reimplement the display in `app-mobile` — 🎨 designer + implementor decide, but the COPY + ladder semantics are LOCKED to the business behavior).
  - Itinerary (per-day `trip_days`), inclusions (`trip_inclusions`), price tiers.
  - **"Leaving from {departureText}" line** (🔒 conditional, mirrors the card).
  - Reserve CTA → buyer flow (§F).
- **🔒 LOCKED anon-read constraint:** the consumer detail hook MUST NOT copy `usePublicTripBySlug.ts` (it reads `brands` directly — F-E2/NG-4). Instead:
  - **Reuse the global RPC for the single trip:** either call `pg_published_trips_public` with a tight filter that returns the one trip, OR (preferred) call the existing per-brand RPC `pg_public_trips_by_brand(brandSlug)` and select the matching `tripSlug` from its rows, OR add a thin single-trip definer RPC. **Decision (🔒 LOCKED):** for C1, the consumer detail is opened from a card tap that already carries the full `DiscoverTripRow` (brand_slug, trip_slug, all card fields). For the DETAIL-only fields not in the feed RPC (per-day itinerary `trip_days`, `trip_inclusions`, `theme.business_trip.*` refund policy, intake schemas), read them via the EXISTING anon-granted paths: `trip_days`/`trip_inclusions`/`trip_pricing_tiers` have anon SELECT (investigation F-C1 table), and `business_public_brands_view` supplies brand fields. Build a `useConsumerTripDetail(brandSlug, tripSlug)` hook that composes: (a) the passed `DiscoverTripRow` (or a `pg_published_trips_public` re-fetch for deep-link cold-open), (b) anon-direct reads of `trip_days` + `trip_inclusions` + `trip_pricing_tiers` (+ `ticket_types` for price/intake mapping), (c) brand via `business_public_brands_view`. **NEVER `.from('brands')`.**
- **Mount as a full-screen overlay (🔒 LOCKED, investigation F-H1):** add a new state slot in `app-mobile/app/index.tsx` (e.g. `viewingTrip: { brandSlug, tripSlug, seed?: DiscoverTripRow } | null`) → renders `<ConsumerTripDetailScreen>` over everything with `onBack` clearing the slot. Mirror the existing `viewingFriendProfileId` overlay pattern (index.tsx:2070,2324-2329). NO new router route for in-app taps.
- **Deep-link re-export (🔒 LOCKED, investigation F-H2):** add `app-mobile/app/t/[brandSlug]/[tripSlug].tsx` as a thin Expo Router re-export (mirror `app/b/[slug].tsx`) that reads `useLocalSearchParams` and renders the SAME `<ConsumerTripDetailScreen>` (cold-open path: no seed row → the hook fetches by slug).

### E.5 — Repoint `ConsumerBrandProfileScreen.onOpenTrip` (🔒 LOCKED, kills the web-eject)
File: `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (lines 67-72).
- TODAY: `onOpenTrip` → `WebBrowser.openBrowserAsync('https://business.usemingla.com/t/...')` (the "leaves the app" failure C1 exists to kill — investigation F-H2 / §5 divergence #3).
- CHANGE: `onOpenTrip(trip)` → set the host's `viewingTrip` overlay state slot (E.4) with `{ brandSlug, tripSlug }` (+ seed if available). Remove the `WebBrowser` import if now unused. This requires threading an `onOpenTrip` callback from `app/index.tsx` down to `ConsumerBrandProfileScreen` (the host owns the overlay state) — mirror how `onViewFriendProfile`/`onOpenChatWithUser` are threaded.

---

## §F — Buyer Flow (reuse `nativeCheckoutFlow.ts` → `ticket-checkout-create`)

### F.1 — Entry (🔒 LOCKED)
From the consumer trip detail Reserve CTA. Reuse the existing consumer ticket-cart + native checkout plumbing (`useTicketCart`, `usePublicEventTickets`, `TicketCartSheet`, `ExpandedBusinessEventSheet` — investigation F-G1) where it fits, OR a trip-specific Reserve sheet that builds the same `lines` + `intake_form_data` payload. 🔒 The money path is `nativeCheckoutFlow.ts` → `ticket-checkout-create` (surface:"native"). NO parallel checkout fn (COMMS-0014).

### F.2 — Tier → ticketTypeId mapping (🔒 LOCKED)
A trip "tier" is a `trip_pricing_tiers` row whose `ticket_type_id` is the real `ticket_types` row. The buyer picks a tier → the checkout `lines` entry is `{ ticketTypeId: tier.ticket_type_id, quantity }`. Read tiers from `trip_pricing_tiers` JOIN `ticket_types` (anon-granted). This is a mapping over the EXISTING `lines` contract — no new plumbing.

### F.3 — CTA enforcement (🔒 LOCKED hard guard)
Before enabling Reserve: enforce `bookings_closed === false` AND (`bookingDeadline === null` OR `bookingDeadline >= now`). When closed/past-deadline → show the closed banner + DISABLE Reserve (mirror the business `/t/...` page deadline state, investigation F-E1). This is belt-and-suspenders with the RPC WHERE (the feed already excludes closed/past trips, but a deep-linked or stale detail must re-enforce).

### F.4 — Intake form (🔒 LOCKED — sink RESOLVED in §4)
- Read `trip_intake_schemas` for the trip's ticket types (anon SELECT policy exists — migration `20260620000000` Section 3, `trip_intake_schemas_anon_select`). Reuse `intakeSchemaService` (`validateAnswerAgainstSchema`, `IntakeFormData`, `uploadIntakeFile`) + the `IntakeFormRenderer` — extract to a shared package OR reimplement the renderer in `app-mobile` (🎨 implementor's call; the schema/answer CONTRACT is LOCKED).
- Collect per-tier answers in the shape `{ ticket_type_id, schema_version_id, answers: { question_id: value } }`.
- **Extend `app-mobile/src/payments/nativeCheckoutFlow.ts` (🔒 LOCKED):**
  - Add to `NativeCheckoutInput`: `intakeFormData?: Array<{ ticket_type_id: string; schema_version_id: string; answers: Record<string, unknown> }>`.
  - Add to the `supabase.functions.invoke` body (currently lines 115-130): `...(input.intakeFormData ? { intake_form_data: input.intakeFormData } : {})`.
  - This is the ONLY edge-fn-contract change, and the key is already supported server-side (edge-fn lines 369-456) → answers land in `orders.intake_form_data` (§4). **No edge-fn edit needed.**
- **Required-question gate:** the edge fn already rejects with `intake_form_required` / `intake_schema_stale` when required answers are missing/stale (edge-fn lines 436/454). The consumer UI SHOULD pre-validate with `validateAnswerAgainstSchema` to surface inline errors BEFORE submit (mirror business intake.tsx:317-328), but the server gate is the backstop.

### F.5 — Refund-policy + installment disclosure (🔒 LOCKED display-only)
Reuse the refund-ladder display + installment schedule projection from the business trip checkout (`RefundPolicyDisplay`, `InstallmentScheduleDisplay`, `projectInstallmentSchedule`). Display-only (Tr4/Tr3). 🎨 designer owns placement on the consumer detail + checkout sheets; the LADDER SEMANTICS + COPY are LOCKED to business behavior.

### F.6 — Confirmation (🔒 LOCKED)
On `nativeCheckoutFlow` `succeeded` outcome → navigate to a confirmation surface (reuse the consumer event-checkout confirmation pattern). The planner sees the booking in their dashboard via the existing `useTripOrders` path (no consumer-side work — the order row + intake answers are written server-side). → smoke-test step 13.

---

## §G — Public buyer-web display ("Leaving from")

File: `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` renders `<TripPreview>`. The "Leaving from {city}" line is added in `TripPreview.tsx` (§B.4) and sourced via the read adapter (§B.3) — `usePublicTripBySlug` projection must surface `departure_text` (extend the SELECT/projection to include the new column; the existing hook already reads `events` columns, so add `departure_text` to its select). 🔒 Conditional render (hide when null). → SC-11-Web.

---

## §H — i18n + analytics

- Add EN keys to `app-mobile/src/i18n/locales/en/discover.json`: `title` → "Discover" (changed); NEW `events_tab` → "Events", `trips_tab` → "Trips", plus trip-card/filter/empty/error/loading strings (🎨 designer/copy within Mingla voice). Other locales: EN-only in C1 (§E.1); their `title` stays as-is.
- Analytics: `mixpanelService.trackTabViewed({ screen:'discover', tab:'trips' })` on tab switch (reuse the Likes haptic+analytics handler).

---

## 7. Success Criteria (observable, testable, unambiguous; per-surface where parity is manual)

- **SC-1 (🔒):** Discover header title reads "Discover" (EN). `t('discover:title')` resolves to "Discover".
- **SC-2 (🔒):** Discover shows two pill tabs "Events" + "Trips" using the Likes spotlight-pill pattern; the orange spotlight animates between them; selection persists across tab unmount/remount via `discoverActiveTab`.
- **SC-3 (🔒):** Events tab renders the existing Discover grid pipeline UNCHANGED (regression — SC-12).
- **SC-4 (🔒):** Trips tab renders real trip cards from `pg_published_trips_public` — against current data, exactly the qualifying subset of the 3 published trips (any with a future-or-null `booking_deadline`, public, scheduled/live, ≥1 non-hidden tier). "Untitled trip" + "The Sone" (no deadline) surface; "The DC Adventure" surfaces only while `booking_deadline 2026-06-01 >= now()`.
- **SC-5 (🔒):** Applying the **destination** filter "DC" returns only trips whose `destination_text` matches; applying the **departure** filter returns only trips whose `departure_text` matches; the two are independent (a trip can match one and not the other).
- **SC-6 (🔒):** Price-range + group-size filters narrow the set per §A.3.4; sort modes reorder per §A.3.5; clearing filters restores the full set.
- **SC-7 (🔒):** Tapping a trip card opens the consumer trip detail OVERLAY in-app (NO WebBrowser); X-close returns to the Trips tab with state intact.
- **SC-8 (🔒):** `ConsumerBrandProfileScreen` "open trip" opens the in-app overlay, NOT `WebBrowser.openBrowserAsync` (the web-eject is gone).
- **SC-9 (🔒):** Reserve → tier pick → intake form (if schema) → native PaymentSheet → confirmation; `orders.intake_form_data` for the resulting order equals the submitted `{ticket_type_id, schema_version_id, answers}` array; the planner's dashboard shows the booking + intake answers.
- **SC-10-iOS / SC-10-Android (🔒, manual parity):** Business trip create + edit forms show a "Departing from" Google-Places input; picking a place persists `events.departure_text` (+ `departure_geo`); editing a published trip updates departure with no refund-gate error.
- **SC-11-Web (🔒, manual parity):** The public buyer-web trip page (`/t/{brandSlug}/{tripSlug}`) renders "Leaving from {city}" when `departure_text` is set; hidden when null.
- **SC-12 (🔒, regression):** The existing Discover grid (Events tab), `discoverEventsCache` signature, RNGH gesture coordination, and the `orch-0839-a-mobile-cache-removed` gate are all unaffected.
- **SC-13-Android (🔒, manual parity):** The new pill + TripCard glass honor `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (opaque ≥0.92 fill, `overflow:'hidden'`, no Android shadow under rounded fill) — no taupe-ring/translucent regression on Android.
- **SC-14 (🔒):** Anon (signed-out) browsing of the Trips feed + opening a trip detail works (AC #6); the RPC returns rows for anon.
- **SC-15 (🔒):** Empty state (no trips match filters) shows a friendly Mingla-voice message + "clear filters" affordance; loading state shows a skeleton/spinner; error state shows a retry affordance (AC #9, #10) — all 9 states per §17.
- **SC-16 (🔒):** Verified badge renders ONLY when `brand_verified === true` (conditionally absent today — no fabrication).

---

## 8. Invariants

**Preserved (must not break):**
- **I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE:** the new RPC's `spots_left`/sold formula matches `pg_public_trips_by_brand` exactly. Verified by T-08.
- **I-ANON-BRANDS-VIA-DEFINER-VIEW (COMMS-0009):** no `.from('brands')` / `.from('tickets')` anywhere in the new consumer code; planner name + verified + spots_left come only from the definer RPC. Verified by T-06 (grep gate) + T-07.
- **I-PROPOSED-DISCOVER-NO-MOBILE-CACHE:** no AsyncStorage/in-memory cache for trips. Verified by code review + the `orch-0839-a-mobile-cache-removed` CI gate.
- **I-TAB-SCREENS-MEMOIZED / I-TAB-PROPS-STABLE:** new tab children memoized; host passes stable props.
- **ANDROID_GLASS_USES_OPAQUE_FALLBACK:** new pill + card honor the opaque Android fallback.
- **Existing Discover grid pipeline (ORCH-0996 cache signature, ORCH-0991 gesture coordination, ORCH-0839-A no-mobile-cache).**

**New (this change establishes):**
- **I-PROPOSED-PUBLISHED-TRIPS-PUBLIC-HARD-GUARDS:** `pg_published_trips_public` MUST contain all six hard-guard conjuncts (event_type=trip, visibility=public, status IN scheduled/live, deleted_at IS NULL, bookings_closed=false, (booking_deadline IS NULL OR >= now), ≥1 non-hidden tier) and MUST NOT filter `show_on_discover`. Verified by T-09 (fails-on-revert).
- **I-PROPOSED-DEPARTURE-SEPARATE-FROM-DESTINATION:** the feed exposes departure_text and destination_text as independent fields + independent filter params. Verified by T-05.

(All "PROPOSED" invariants flip ACTIVE on ORCH-1016 CLOSE; register in `INVARIANT_REGISTRY.md` at CLOSE.)

---

## 9. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Feed happy path (anon) | anon `pg_published_trips_public()` | Returns qualifying published trips only; `brand_name`/`brand_verified`/`departure_text`/`spots_left` populated | RPC/DB |
| T-02 | Hard guard: draft/cancelled/past excluded | a draft + a cancelled + a past-deadline trip exist | None appear in results | RPC/DB |
| T-03 | Hard guard: zero-tier excluded | trip with no published non-hidden tier | Excluded | RPC/DB |
| T-04 | NULL deadline surfaced | trip with `booking_deadline IS NULL` | INCLUDED (open) | RPC/DB |
| T-05 | Departure ≠ destination filter | `p_departure_query='DC'` only | Returns trips leaving from DC regardless of destination; destination filter unaffected | RPC/DB |
| T-06 | No direct brands/tickets read | grep new `app-mobile` code | Zero `.from('brands')` / `.from('tickets')` | Code/CI |
| T-07 | Anon EXECUTE grant | `has_function_privilege('anon', ...)` | TRUE | DB |
| T-08 | spots_left mirrors capacity gate | trip with N capacity, M sold | `spots_left = GREATEST(N-M,0)`; unlimited → NULL | RPC/DB |
| T-09 | **Fails-on-revert (hard-guard WHERE)** | remove the `booking_deadline`/`status`/tier-EXISTS conjunct | a non-qualifying trip leaks → test FAILS | RPC/DB |
| T-10 | **Fails-on-revert (departure filter)** | remove the `p_departure_query` WHERE clause | departure filter no longer narrows → test FAILS | RPC/DB |
| T-11 | Intake answers persist | consumer checkout with intake | `orders.intake_form_data` == submitted array | Edge/DB |
| T-12 | Required-intake gate | submit missing required answer | edge fn returns `intake_form_required`; no order | Edge |
| T-13 | Tier→ticketTypeId mapping | pick tier → checkout | `lines[].ticketTypeId == tier.ticket_type_id` | Service |
| T-14 | CTA closed enforcement | open a past-deadline trip via deep link | Reserve disabled + closed banner | Component |
| T-15 | Events grid regression | mount Discover, switch tabs | grid renders identically; cache signature unchanged | Component/Cache |
| T-16 | Departure authoring round-trip | create trip with departure, read back | `events.departure_text` set; preview + buyer-web show "Leaving from" | Business/Web |
| T-17 | Empty/loading/error states | no-match filters / pending / RPC error | friendly empty / skeleton / retry | Component |
| T-18 | Anon browse + detail | signed-out, open Trips + a trip | works without auth | Full stack |
| T-19 | Verified badge conditional | all current trips unverified | badge absent (no fabrication) | Component |
| T-20 | Android opaque glass | render pill + card on Android | opaque fill, no taupe ring/translucent | Component (Android) |

---

## 10. Regression-Test Plan (CLOSE Step 0.5)

**Implementor happy-path test** (the implementor writes + must pass before handoff):
- Path: `supabase/migrations/__tests__/orch_1016_pg_published_trips_public.test.ts` (Deno test against a seeded fixture OR a documented live read-only RPC smoke) asserting T-01, T-04, T-05, T-08, T-07.
- Path: `app-mobile/src/services/__tests__/tripsDiscoveryService.test.ts` asserting the RPC param mapping (camelCase filters → `p_*` args) + `totalCount` derivation + throw-on-error (T-13 mapping, error contract).

**Tester adversarial-angle test** (the tester writes independently — these MUST include fails-on-revert):
- Path: `supabase/migrations/__tests__/orch_1016_hard_guards_adversarial.test.ts` — asserts T-02, T-03, T-09 (**fails-on-revert** for the hard-guard WHERE: a test that PASSES on the spec'd WHERE and FAILS if any conjunct is removed) and T-10 (**fails-on-revert** for the departure filter), plus T-06 (grep: zero `.from('brands')`/`.from('tickets')` in new consumer code).
- Path: `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx` — asserts T-14 (closed-CTA deep-link), T-11/T-12 (intake persistence + required gate via a mocked edge response with the documented `intake_form_required` error shape), T-19 (badge conditional), T-15 (Events grid untouched).

Both fails-on-revert tests are the gate that the hard-guard WHERE and the departure filter cannot be silently weakened.

---

## 11. Implementation Order
A.1 → A.2 → A.5 (migrations + allowlist, same commit) → B (business authoring + persist + preview) → D (consumer service + hook) → E.1 (shell/tabs) → E.2/E.3 (card + filters) → E.4/E.5 (detail overlay + deep-link + repoint brand page) → F (buyer flow + nativeCheckoutFlow extension) → G (buyer-web display) → H (i18n + analytics) → tests (§10).

---

## 12. Regression Prevention
- **Structural:** the hard-guard WHERE lives ONLY in the RPC (single source); a protective SQL comment names operator decision #1 (`show_on_discover` intentionally NOT filtered) so a future editor doesn't "fix" it.
- **Tests:** T-09 + T-10 fails-on-revert.
- **CI:** `ORCH_1016_BACKEND_ALLOWLIST` (C7 gate) + the existing `orch-0839-a-mobile-cache-removed` gate guard the no-mobile-cache invariant.
- **Comment:** `nativeCheckoutFlow.ts` body addition carries a `// ORCH-1016: trip intake answers ride the existing ticket-checkout-create body key → orders.intake_form_data` note.

---

## 17. DESIGN Handoff (what the designer LOCKS vs what's already fixed)

**Already FIXED (designer does NOT change):**
- Tab pattern = the Likes screen spotlight-pill, EXACTLY (geometry tokens, spotlight spring, glass header, haptics, a11y — investigation F-B1). The designer composes WITHIN it, not around it.
- The functional contract of every component (props, data fields, conditional render rules, all hard guards).
- Android opaque-glass fallback policy.

**Designer MUST LOCK (produce the granular visual+UX contract; this SPEC requires it to exist before IMPLEMENT):**
1. **Header IA composition:** how the pill switcher coexists with the existing Discover filter-chip row; whether the Events tab keeps its filter row below the pill and whether the Trips tab gets its own `TripFilterChips` row. (The single biggest IA decision — investigation F-B1 designer note.)
2. **TripCard layout:** full-bleed-image vs structured-grid; placement of cover/title/dates/destination/"Leaving from"/planner/verified-badge/price/spots; exact tokens, spacing (4px grid), typography, light+dark, contrast ratios, press feedback (non-shifting).
3. **Filter-chip row:** chip visuals (default/active/disabled), the date-preset + price-range + group-size + departure-city + destination-city pickers' sheets, the sort control.
4. **Departure display:** the exact "Leaving from {city}" treatment (icon, order vs destination, separator) on the card, the consumer detail, and the buyer-web `TripPreview`.
5. **Consumer trip detail layout:** hero, deadline/countdown/closed states, refund ladder, itinerary/inclusions/tiers, Reserve CTA placement (thumb zone).
6. **All 9 states with Mingla-voice copy:** loading (skeleton), error (retry), empty (no-match + clear-filters), populated, submitting (checkout), offline, first-time (no trips ever — the sparse-data reality, investigation F-C2), returning, degraded (missing cover/price).
7. **No-AI-slop bans + "References examined"** line (premium travel/marketplace apps studied for the trip-card + filter moment).

Designer completion condition: per `mingla-designer` skill (tokens + premium-craft + its own gate). The implementor builds to the designer's contract for all 🎨 items and to this SPEC for all 🔒 items.

---

## 18. Completion Gate (7 clauses)

1. **Functional contract complete for every touched layer.** ✔ DB (2 migrations, exact SQL/signature/GRANT/self-verify), business authoring (input+persist+preview), RPC, consumer service (typed, error contract, no-cache), hook (query-key factory, infinite query, staleTime), components (props, conditional render, all states), nav (overlay slot + deep-link re-export), buyer flow (reuse + `intake_form_data` body extension), buyer-web display.
2. **Every UI surface has a pinned visual+UX contract OR a required designer pass referenced.** ✔ §17 requires the `mingla-designer` DESIGN pass for all 🎨 items; the tab pattern is LOCKED to Likes; all 9 states enumerated.
3. **No-AI-slop bans + References line required.** ✔ §17.7.
4. **Every requirement tagged 🔒 LOCKED or 🎨 OPEN; OPEN section present + generous.** ✔ throughout; the OPEN ceiling (header IA, card layout, filter visuals, departure display, detail layout, micro-animation feel, default-sort) is explicit.
5. **Cross-Surface Impact present; success criteria observable/testable/per-surface where parity manual.** ✔ §5 (7-surface table) + §7 (SC-10-iOS/Android, SC-11-Web, SC-13-Android per-surface).
6. **Invariants named; test cases (happy/error/edge) per criterion; implementation order; regression prevention.** ✔ §8/§9/§10/§11/§12.
7. **ZERO hand-wave.** ✔ exact tables/columns/RPC signature/file paths/GRANT/body keys; the one prior `suspected` seam (intake sink) is RESOLVED in §4; no "style nicely"/"handle errors properly".

**Overall: SPEC COMPLETE. One investigation `suspected` seam (intake-persistence sink) RESOLVED to `orders.intake_form_data` with the exact wire path. No remaining OPEN questions blocking IMPLEMENT.**
