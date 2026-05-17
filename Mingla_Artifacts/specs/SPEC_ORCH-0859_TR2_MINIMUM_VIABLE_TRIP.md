# SPEC — ORCH-0859 [Tr2 Minimum Viable Trip]

**Mode:** SPEC
**Skill:** Claude `mingla-forensics`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` (binding evidence base)
**Milestone brief:** `Mingla_Artifacts/milestones/Tr2_MINIMUM_VIABLE_TRIP.md`
**Upstream:** ORCH-0855 [Tr1 Trip Planner Brand Onboarding] CLOSED PASS Grade A 2026-05-17 (PR #123 merged at `436c9a6e`); ORCH-0826 [Hub Foundation + universal-plus creator] CLOSED Grade A
**Downstream:** ORCH-NNNN [Tr3 Installment Payments] extends Tr2's checkout; Tr4-Tr8 layer features onto Tr2's foundation; C1 [Consumer Discover Trips Tab] reads Tr2's published trips

---

## 1. Goal (one sentence)

A trip-planner brand publishes a real bookable trip via a 5-step wizard (basics + dates + destination + capacity → manual day-by-day itinerary → inclusions/exclusions → single full-price tier → review), shares the link `/t/{brandSlug}/{tripSlug}`, and a friend opens it signed-out, books end-to-end via Stripe routed to the planner's connected account, receives a trip-specific confirmation email, and appears in the planner's traveler list — **first dollar of trip revenue on Mingla**.

---

## 2. Scope

### In-scope (this SPEC)

1. **Migration:** 3 new sidecar tables (`trip_days`, `trip_pricing_tiers`, `trip_inclusions`) with anon-tolerant RLS + brand-member-write + indexes per investigation §6 file 1.
2. **Publish RPC extension:** `business_publish_event_draft` widened with `event_type='trip'` validation branches per investigation D-1 (recommend extend per Constitution #2 — NO `business_publish_trip_draft` parallel RPC).
3. **Service layer:** `tripsService.ts` (CRUD trips + sidecar tables) + `tripCheckoutService.ts` (buyer-side wrapper around existing checkout).
4. **Hook layer:** `useTrips.ts` (operator list + draft mutations), `usePublicTripBySlug.ts` (anon-tolerant fetch), `useTripOrders.ts` (operator dashboard).
5. **Wizard:** `TripCreatorWizard.tsx` + 5 step components + `TripDayEditor.tsx` (manual day-by-day, stacked-cards UX, drag-reorder) + `TripPreview.tsx` (used in Step 5 + public page).
6. **Routes (4 new):** `mingla-business/app/trip/create.tsx` (wizard entry, creates draft), `trip/[id]/edit.tsx` (wizard host), `trip/[id]/index.tsx` (operator dashboard Overview + Travelers), `t/[brandSlug]/[tripSlug].tsx` (public anon-tolerant detail page).
7. **Stub removal:** UniversalCreatorSheet + Tr1 Home CTA rewired from `/trip/coming-soon` to `/trip/create`; Hub > Trips list wired to real query; `/trip/coming-soon.tsx` converted to redirect (preserves any operator-shared deep links).
8. **Buyer checkout:** REUSE existing `/checkout/[eventId]` flow (event_type-agnostic per investigation G-1); add trip-shaped tier copy ("Reserve your spot on <Trip>") and trip-aware confirmation screen branching.
9. **Confirmation email:** `ticket-confirmation-dispatch` extended with `event_type='trip'` branch firing a trip-shaped Resend template (trip title + dates + destination + day-by-day summary + Mingla brand shell).
10. **Stripe Connect routing verification:** explicit SC + tester live-Dashboard probe at CLOSE-time (per investigation P1-1).
11. **Regression-test gate:** 5 jest tests per milestone brief §7 + 1 tester adversarial CI check + 1 Stripe Connect live-probe verification.

### Non-goals (explicitly OUT of scope)

| Non-goal | Why |
|---|---|
| Installment payments | Tr3 scope. Tr2 ships SINGLE full-price tier only. `trip_pricing_tiers.tier_metadata jsonb DEFAULT '{}'::jsonb` reserved for Tr3 to attach `{ installments: [...] }`. |
| Traveler intake forms (passport, dietary, etc.) | Tr5 scope. Tr2 captures name + email + phone only via existing buyer-info screen at `/checkout/[eventId]/buyer.tsx`. |
| Per-trip discussion board / group chat | Tr6 scope. |
| Room-share matching | Tr7 scope. |
| AI itinerary scaffolding (Gemini-parsed brochures) | Tr8 scope. Tr2 = manual day-by-day entry only. |
| Image upload per day | Tr2 §9-2 deferred. Day cards carry title + narrative + optional stops jsonb only (no media). |
| Parallel `trips` table | I-1.2-UNIFIED-EVENT-TYPE forbids. Trips INSERT into `events` with `event_type='trip'`. |
| ~~Parallel `business_publish_trip_draft` RPC~~ | **AMENDED 2026-05-17 (operator option B):** the original "extend existing RPC" SPEC §4.2 hard guard was discovered at IMPLEMENT-time to be technically infeasible — the existing `business_publish_event_draft` body is tightly coupled to event-only taxonomy validation (`city_required` + `party_types_required` + `party_types_not_canonical` + `vibe_tags_not_canonical` + `music_genres_not_canonical`). None of those concepts apply to trips. Extending the function would require wrapping every event-only validation block in `IF v_event.event_type = 'event'` gates, which IS "altering existing logic" beyond the SPEC §4.2 hard guard. Operator picked Option B: **fork to `business_publish_trip_draft`**. Killed invariant I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC (was DRAFT, never landed). Event publish RPC `business_publish_event_draft` stays byte-unchanged; tester adversarial verifies the trip RPC exists AND the event RPC body is unmodified. See `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` Section D-1 + IMPLEMENT-time pivot notes in `IMPLEMENTATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md`. Process-improvement follow-up: META-ORCH-NNNN [Forensics + SPEC body-read discipline for extend-vs-fork decisions] queued for INTAKE. |
| First-class `events.{destination_place_id,destination_lat,destination_lng,capacity}` columns | Use `events.theme.business_trip = {destinationPlaceId, destinationLat, destinationLng, destinationLocationText, capacity}` mirror of event pattern. Zero parent-schema churn. |
| Trip wizard available to `kind='popup'` or `kind='physical'` brands | Tr2 §8 hard guard. UI gates wizard entry to `kind='trip_planner'` brands ONLY in Tr2. Schema/RLS still admits trips from any brand (preserves I-1.2-BRAND-AS-CONTAINER capability layer). Future "expand to all kinds" is a clean amendment. |
| Consumer-app surfacing of trips | C1 scope. `discover-merged-events` MUST add explicit `event_type='event'` filter to exclude trips from the consumer event feed (investigation DISCOVERY-3). |
| Admin queue / dashboard for trips | DEC-4 — Stripe Connect KYC IS the identity proof for trip planners; no admin phone-callback flow. Zero `mingla-admin/` work in Tr2. |
| PDF per ticket for trip orders | Per investigation DISCOVERY-2 — `ticket-pdf-fetch` mechanism MAY apply to trip orders for traveler identification (mirror events); SPEC says YES for consistency — implementor reuses ORCH-0842 [Tickets-into-Active + PDF sheet] pipeline without modification (PDF generation is `event_type`-agnostic at the renderer layer). |
| `/trip/coming-soon.tsx` deletion | Convert to redirect to `/trip/create` instead — preserves any deep links operators have already shared. |
| Trip-planner brand visual differentiator in BrandSwitcherSheet | Out of Tr2 (deferred to polish ORCH per Tr1 SPEC §12). |

### Assumptions

- ORCH-0855 [Tr1 Trip Planner Brand Onboarding] migration `20260607000000_orch_0855_brands_kind_trip_planner.sql` is live on remote (confirmed 2026-05-17 via MCP `pg_get_constraintdef`).
- ORCH-0826 [Hub Foundation + universal-plus creator] M0 migration `20260605000000_orch_0826_events_event_type_discriminator.sql` is live (per I-1.2-UNIFIED-EVENT-TYPE).
- At least one trip-planner brand exists via Tr1 wizard before Tr2 smoke test (operator creates one).
- `mingla-business/jest.config.cjs` is present + `npx jest` runs from `mingla-business/` (confirmed in Tr1).
- `brand_covers` storage + `uploadBrandCover` service work for trip cover images (confirmed in Tr1 §G-1).
- Existing `business_publish_event_draft` RPC publishes `event_type='event'` rows successfully today (per ORCH-0824 [event taxonomy columns] + ORCH-0792 [publish writes event_dates]); Tr2 EXTENDS without breaking that path.
- Stripe Connect routing works today for popup brands via `ticket-checkout-create` `transfer_data.destination` (per ORCH-0789/0790 [web checkout] + ORCH-0852 [bulletproof buyer checkout]); Tr2 RELIES on this but VERIFIES live at CLOSE per P1-1.
- Resend integration in `ticket-confirmation-dispatch` works today for event orders (per ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] precedent); Tr2 adds discriminator branch.
- `biz_is_brand_member_for_read_for_caller(brand_id)` helper exists per Tr1 investigation §C-3 — used for sidecar table RLS write predicates. Implementor MUST verify via `pg_proc` probe BEFORE writing migration; substitute the actual helper name if different.

---

## 3. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| Surface | In/Out | User-visible behaviour + file paths + parity |
|---|---|---|
| **Business iOS** | ✅ IN | Trip-planner brand owner taps universal "+" → "Create trip or otherwise" → routes to new `/trip/create` wizard. 5-step wizard with autosave. Publish creates `/t/{slug}` shareable link. Hub > Trips sub-tab lists their trips. Operator dashboard `/trip/{id}` shows Overview + Travelers. Files: full §6 list. Parity: AUTOMATIC with Android via shared RN code. |
| **Business Android** | ✅ IN | Identical to iOS. Parity AUTOMATIC. |
| **Buyer/anonymous Web** (`mingla-business/`) | ✅ IN | Anyone with the share link opens `/t/{brandSlug}/{tripSlug}` signed-out, sees trip detail page (hero + dates + itinerary + inclusions + pricing + "Reserve my spot" CTA), taps CTA → routes to existing `/checkout/{tripEventId}` flow (anon-tolerant per `feedback_anon_buyer_routes.md`), completes Stripe PaymentSheet, lands on confirmation screen. Files: `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` + reused `/checkout/[eventId]/*` chain. Parity: shares the web bundle with iOS via Expo Web. |
| **Database (Postgres on linked project)** | ✅ IN | 3 new sidecar tables with RLS. `events` rows insertable with `event_type='trip'` (already shipped at M0). `ticket_types` reused for single-tier pricing. Migration file in §4.1. |
| **Edge functions** | ✅ IN | (a) Publish RPC `business_publish_event_draft` extended with trip-validation branches (RPC, not edge function — but same operator-deploys-migration gate). (b) `ticket-confirmation-dispatch` edge function extended with `event_type='trip'` template branch. (c) `ticket-checkout-create` UNCHANGED (already event_type-agnostic per investigation G-1). (d) `discover-merged-events` edge function gets explicit `event_type='event'` filter to exclude trips from consumer event feed (investigation DISCOVERY-3). |
| **Consumer iOS** (`app-mobile/`) | ❌ OUT | Trips surface to consumers in C1 [Consumer Discover Trips Tab], separate ORCH. Tr2 ships ZERO `app-mobile/` files. The only consumer-side change is server-side: `discover-merged-events` adds `event_type='event'` filter so trip rows do NOT leak into the existing consumer events feed prematurely. |
| **Consumer Android** | ❌ OUT | Same as iOS — C1 scope. |
| **Admin Web** (`mingla-admin/`) | ❌ OUT | No admin queue / dashboard for trips per DEC-4 (Stripe Connect KYC replaces phone-callback). Trip-planner brands + trip rows will surface in admin's existing brand-list and event-list queries as raw `kind='trip_planner'` / `event_type='trip'` rows — acceptable cosmetic for Tr2; admin polish is a follow-up. |
| **Business Web preview** (mingla-business dev/web) | ❌ OUT | The wizard uses RN Modal-based primitives (BrandSwitcherSheet TopSheet pattern from Tr1) which don't render on web. Web preview is for buyer-anon flows only. The `/t/[brandSlug]/[tripSlug].tsx` public route IS web-renderable (Expo Web target). |

**Parity is AUTOMATIC** across business iOS + business Android (shared RN code path) and across iOS Web + Android Web for the buyer-anon `/t/` route (shared bundle). No platform-specific files. Tester parity-enforcement check (Step 7) needs both iOS sim + Android emu live-fire for the wizard, plus a web browser hit on `/t/{brandSlug}/{tripSlug}` for the anon route.

---

## 4. Layer-by-Layer Specification

### 4.1 Database — Migration `supabase/migrations/<UTC-timestamp>_orch_0859_trip_sidecar_tables.sql`

**Naming:** filename timestamp MUST be strictly later than the current max migration prefix at impl time. Confirm via `ls supabase/migrations/ | sort | tail -1`. Recommended placeholder: `20260608000000_orch_0859_trip_sidecar_tables.sql`. Implementor MUST verify monotonicity before commit (parity rule #10).

**Exact SQL (verbatim — implementor copies):**

```sql
-- ORCH-0859 — Tr2 Minimum Viable Trip: 3 sidecar tables for trip-specific
-- per-day itinerary, pricing-tier-to-ticket-type join, inclusions/exclusions.
--
-- Pre-state (verified 2026-05-17 via MCP probes):
--   public.events admits event_type='trip' (post-ORCH-0826 M0)
--   public.brands.kind admits 'trip_planner' (post-ORCH-0855 Tr1)
--   public.ticket_types reusable for single-tier trip pricing
--   No pre-existing trip_days / trip_pricing_tiers / trip_inclusions tables
--
-- Per I-1.2-UNIFIED-EVENT-TYPE: trips are events rows, NOT a separate `trips`
-- table. These 3 sidecar tables hang OFF events.id via FK.
--
-- Per I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY (DRAFT → ACTIVE on close):
-- anon SELECT gated on parent events.status IN ('scheduled','live'); brand
-- members SELECT all (including drafts); only brand members may INSERT/UPDATE/DELETE.
--
-- Helper function name: `biz_is_brand_member_for_read_for_caller(brand_id)`
-- (per Tr1 investigation §C-3). Implementor MUST verify via:
--   SELECT proname FROM pg_proc WHERE proname LIKE '%brand_member%';
-- and substitute the actual helper name if this name is wrong.

BEGIN;

-- ---------------- trip_days ----------------
CREATE TABLE public.trip_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  narrative text,
  date date,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, ordinal)
);

COMMENT ON TABLE public.trip_days IS
  'Per-day itinerary for event_type=''trip'' events. ordinal is 1-based day index. stops jsonb reserved for Tr8 [AI itinerary scaffolding] structured-stop data — Tr2 keeps it empty array default.';

CREATE INDEX idx_trip_days_event_ordinal ON public.trip_days(event_id, ordinal);

ALTER TABLE public.trip_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_days_read_published_or_member ON public.trip_days FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND e.deleted_at IS NULL
        AND (
          e.status IN ('scheduled', 'live')
          OR biz_is_brand_member_for_read_for_caller(e.brand_id)
        )
    )
  );

CREATE POLICY trip_days_write_brand_members ON public.trip_days FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- ---------------- trip_pricing_tiers ----------------
CREATE TABLE public.trip_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  tier_name text NOT NULL CHECK (length(trim(tier_name)) > 0),
  tier_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trip_pricing_tiers IS
  'Joins event_type=''trip'' events to ticket_types with tier_name + reserved tier_metadata jsonb. Tr2 ships SINGLE row per trip (single full-price tier). Tr3 [Installment Payments] populates tier_metadata = {installments: [...]}.';

CREATE INDEX idx_trip_pricing_tiers_event ON public.trip_pricing_tiers(event_id);
CREATE UNIQUE INDEX idx_trip_pricing_tiers_event_ticket ON public.trip_pricing_tiers(event_id, ticket_type_id);

ALTER TABLE public.trip_pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_pricing_tiers_read_published_or_member ON public.trip_pricing_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_pricing_tiers.event_id
        AND e.deleted_at IS NULL
        AND (
          e.status IN ('scheduled', 'live')
          OR biz_is_brand_member_for_read_for_caller(e.brand_id)
        )
    )
  );

CREATE POLICY trip_pricing_tiers_write_brand_members ON public.trip_pricing_tiers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_pricing_tiers.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_pricing_tiers.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- ---------------- trip_inclusions ----------------
CREATE TABLE public.trip_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('included', 'excluded')),
  item text NOT NULL CHECK (length(trim(item)) > 0),
  ordinal smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trip_inclusions IS
  'Per-trip included/excluded items list. kind discriminates lists. ordinal preserves operator-defined order within each kind.';

CREATE INDEX idx_trip_inclusions_event_kind ON public.trip_inclusions(event_id, kind, ordinal);

ALTER TABLE public.trip_inclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_inclusions_read_published_or_member ON public.trip_inclusions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_inclusions.event_id
        AND e.deleted_at IS NULL
        AND (
          e.status IN ('scheduled', 'live')
          OR biz_is_brand_member_for_read_for_caller(e.brand_id)
        )
    )
  );

CREATE POLICY trip_inclusions_write_brand_members ON public.trip_inclusions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_inclusions.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_inclusions.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- ---------------- updated_at triggers (mirror events pattern) ----------------
CREATE TRIGGER trip_days_set_updated_at
  BEFORE UPDATE ON public.trip_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- (set_updated_at function assumed to exist per existing events trigger; if
-- not, implementor adds CREATE FUNCTION + CREATE TRIGGER. Verify at impl time.)

-- ---------------- Self-verification probe ----------------
DO $$
DECLARE
  table_count int;
  policy_count int;
BEGIN
  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('trip_days', 'trip_pricing_tiers', 'trip_inclusions');
  IF table_count != 3 THEN
    RAISE EXCEPTION 'ORCH-0859 migration: expected 3 sidecar tables, got %', table_count;
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policy
  WHERE polrelid IN (
    'public.trip_days'::regclass,
    'public.trip_pricing_tiers'::regclass,
    'public.trip_inclusions'::regclass
  );
  IF policy_count != 6 THEN
    RAISE EXCEPTION 'ORCH-0859 migration: expected 6 RLS policies (2 per table), got %', policy_count;
  END IF;

  RAISE NOTICE 'ORCH-0859 migration complete: 3 sidecar tables + 6 RLS policies + 3 indexes + 1 trigger';
END $$;

COMMIT;
```

**RLS verification probes (run via MCP `execute_sql` post-apply):**
- `SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.trip_days'::regclass AND polcmd = 'r';` — should return the read-published-or-member predicate verbatim.
- As anon role probe: `SELECT 1 FROM trip_days WHERE event_id = '<draft-trip-uuid>'` → expect empty result.
- As anon role probe: `SELECT 1 FROM trip_days WHERE event_id = '<published-trip-uuid>'` → expect rows.

**Apply protocol:** operator runs `supabase db push --linked` at the implementation gate; implementor halts at Step 1 until operator confirms apply.

### 4.2 Publish RPC — forked trip-specific function (AMENDED 2026-05-17 Option B)

**Original SPEC §4.2 ("extend existing RPC") superseded.** Operator picked Option B fork after IMPLEMENT-time discovery that the existing `business_publish_event_draft` body is tightly coupled to event-only taxonomy validation (`city_required`, `party_types_required`, etc.) — none apply to trips. Forking keeps the event path completely untouched and gives trips a clean, narrow validation contract.

**File:** new migration `20260608000100_orch_0859_publish_rpc_trip.sql` that creates a NEW function `public.business_publish_trip_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL) RETURNS jsonb`.

**Function contract:**

1. **Auth** — `auth.uid()` not null → else `RAISE EXCEPTION 'not_authenticated'`.
2. **Event row lookup** — `SELECT * FROM events WHERE id = p_event_id FOR UPDATE`. Raise `event_draft_not_found` / `event_draft_deleted` / `event_draft_not_publishable` (status ≠ 'draft') / `event_not_a_trip` (event_type ≠ 'trip') / `insufficient_event_permission` (per existing `biz_brand_effective_rank` ≥ `event_manager`).
3. **Brand lookup** — `SELECT id, slug, name, default_currency FROM brands WHERE id = v_event.brand_id AND deleted_at IS NULL`. Raise `brand_not_found`.
4. **Trip-specific required-field validation** (from `events.theme.business_trip` jsonb):
   - `RAISE EXCEPTION 'trip_destination_required'` if `business_trip.destinationLocationText` empty/null.
   - `RAISE EXCEPTION 'trip_capacity_required'` if `business_trip.capacity` ≤ 0 / null.
   - `RAISE EXCEPTION 'trip_dates_required'` if `business_trip.startAt` or `business_trip.endAt` empty/null.
   - `RAISE EXCEPTION 'trip_end_before_start'` if `business_trip.endAt <= business_trip.startAt`.
5. **Title required** — mirror event RPC: `RAISE EXCEPTION 'event_title_required'` if `p_draft_payload->>'title'` empty.
6. **Sidecar table validation:**
   - `RAISE EXCEPTION 'trip_days_required'` if `count(trip_days WHERE event_id) = 0`.
   - `RAISE EXCEPTION 'trip_pricing_tier_required'` if `count(trip_pricing_tiers WHERE event_id) = 0`.
7. **Slug generation** — same pattern as event RPC: slugify title, regex-replace non-alphanumeric to `-`, per-brand uniqueness loop with `-N` suffix.
8. **Visibility** — same mapping as event RPC: `requestedVisibility` → `private` | `hidden` | `public`.
9. **event_dates write:** DELETE then INSERT exactly 1 master row from `business_trip.startAt` + `business_trip.endAt` (single date-range — no multi-date / recurring for trips in Tr2).
10. **events UPDATE:**
    - `status = 'scheduled'`, `published_at = now()`, `slug = v_final_slug`, `title = trimmed`, `visibility = v_visibility`, `timezone = COALESCE(p_draft_payload->>'timezone', events.timezone, 'UTC')`, `updated_at = now()`.
    - `theme = jsonb_strip_nulls(v_theme - 'business_draft')` — preserves `business_trip` jsonb, removes any leaked `business_draft` keys.
    - NO event-taxonomy column writes (`city`, `party_types`, `vibe_tags`, `music_genres` stay NULL/default for trips — they are event-only concepts).
    - NO ticket_types create loop — trip wizard already inserted a single `ticket_types` row via `tripsService.createTripDraft` + updated it via `tripsService.updateTripPricing`. Publish does NOT recreate tickets.
11. **Set RLS context:** `PERFORM set_config('mingla.business_publish_trip_draft', 'on', true);` so any downstream triggers can detect the publish path (mirror event-RPC pattern).
12. **Return** `jsonb_build_object('event', to_jsonb(updated_event), 'brand', jsonb_build_object('id', 'slug', 'name'), 'tripDays', jsonb_agg(to_jsonb(td) ORDER BY td.ordinal), 'tripPricingTiers', jsonb_agg(to_jsonb(tpt)), 'tripInclusions', jsonb_agg(to_jsonb(ti) ORDER BY ti.kind, ti.ordinal), 'tickets', jsonb_agg(to_jsonb(tt) WHERE tt.deleted_at IS NULL), 'eventDates', jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), 'client_revision', p_client_revision)`.
13. **End with** `NOTIFY pgrst, 'reload schema';` to refresh PostgREST function cache.

**Function signature MUST be:**
```sql
CREATE OR REPLACE FUNCTION public.business_publish_trip_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
```

**Hard guards:**
- Implementor MUST NOT modify `business_publish_event_draft` — that function stays byte-unchanged. Tester adversarial check A-06 verifies via `git diff origin/main -- supabase/migrations/*publish_rpc*.sql` showing no edits to existing publish RPC migrations.
- Implementor MUST NOT call `business_publish_event_draft` from inside the new RPC — they are completely separate paths.
- Service layer: `tripsService.publishTrip(eventId)` calls `supabase.rpc('business_publish_trip_draft', { p_event_id: eventId, p_draft_payload: payload })` — NOT `business_publish_event_draft`.

### 4.3 `ticket-checkout-create` edge function

**No code change required** (per investigation G-1). Buyer at `/t/{brandSlug}/{tripSlug}` taps "Reserve my spot" → `tripCheckoutService.startTripCheckout(tripEventId, tierId, buyerInfo)` → calls existing `ticket-checkout-create` edge function with `event_id` + `ticket_type_id` → Stripe routes to brand's `stripe_connect_id` via `transfer_data.destination`.

**Verification (per I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING):** tester adversarial check A-09 greps `ticket-checkout-create/index.ts` for `transfer_data` literal + `destination` field; confirms NO `event_type === 'trip'` branch was added (function stays event_type-agnostic). Implementor MUST NOT modify this file.

**Live-fire verification (SC-23):** operator runs a $1 test-mode trip purchase post-implementation, verifies in Stripe Dashboard:
1. Charge appears on the trip planner's connected account (NOT Mingla's main account).
2. `application_fee_amount` field is populated on the charge (Mingla's platform revenue).
3. `transfer_data.destination` field on the PaymentIntent/Session equals the trip planner's `stripe_connect_id`.

### 4.4 `ticket-confirmation-dispatch` extension

**File:** `supabase/functions/ticket-confirmation-dispatch/index.ts` (EDIT — add trip discriminator branch).

**Existing behavior:** fetches order + event, builds Resend payload with event-shaped template (title, date, venue, QR, PDF attachment), sends.

**New behavior:** detect `event.event_type === 'trip'`, branch to a trip-shaped Resend template:

```ts
// ORCH-0859 (Tr2): trip-shaped confirmation email branch.
if (event.event_type === 'trip') {
  const tripDays = await fetchTripDays(event.id);
  const tripInclusions = await fetchTripInclusions(event.id);
  const destinationText = event.theme?.business_trip?.destinationLocationText ?? '';
  const startAt = event.theme?.business_trip?.startAt;
  const endAt = event.theme?.business_trip?.endAt;
  await resend.emails.send({
    from: RESEND_FROM,
    to: order.buyer_email,
    subject: `You're booked: ${event.title}`,
    html: renderTripConfirmationHtml({
      brand,
      event,
      order,
      destinationText,
      startAt,
      endAt,
      tripDays,
      tripInclusions,
    }),
  });
  return jsonResponse({ ok: true, kind: 'trip_confirmation' });
}
// Existing event-confirmation path unchanged.
```

**`renderTripConfirmationHtml`** is a NEW helper in `supabase/functions/_shared/tripConfirmationEmail.ts`. It reuses the same Mingla brand shell as the event confirmation (per ORCH-0785 shell). Required sections:
1. Header: brand logo + "You're booked"
2. Trip title + destination + date range
3. Day-by-day summary (titles only, no narrative — keeps email scannable)
4. What's included / What's NOT included (bulleted)
5. Order receipt (price + currency + order ID)
6. Brand contact email
7. Footer with Mingla shell + unsubscribe link

**Verification:** tester adversarial check A-10 greps for the `event.event_type === 'trip'` branch + `renderTripConfirmationHtml` import; confirms the existing event branch is untouched.

### 4.5 `discover-merged-events` edge function

**File:** `supabase/functions/discover-merged-events/index.ts` (EDIT — add `event_type='event'` filter).

**Existing query** likely lacks an event_type filter (events was single-type pre-M0). Tr2 MUST add explicit filter so trip rows do NOT leak into the consumer event feed before C1 ships:

```ts
// ORCH-0859 (Tr2): exclude trip rows from consumer event feed; trips surface
// in a dedicated consumer Discover Trips tab via C1 [Consumer Discover Trips Tab].
let query = supabase
  .from('events')
  .select(/* existing columns */)
  .eq('event_type', 'event')  // NEW filter — was implicitly 'event' pre-M0
  /* existing filters */;
```

**Verification:** tester adversarial check A-11 confirms `.eq('event_type', 'event')` literal present in the events query builder; live MCP probe: `SELECT count(*) FROM events WHERE event_type='trip' AND deleted_at IS NULL AND status IN ('scheduled','live')` returns the number of published trips, and the consumer event count from `discover-merged-events` excludes them.

### 4.6 Service layer

#### `mingla-business/src/services/tripsService.ts` (NEW)

**Functions:**
- `createTripDraft(input: CreateTripDraftInput, role: BrandRole): Promise<Trip>` — INSERT `events` row with `event_type='trip'`, status='draft', auto-generated slug `draft-${ulid}`; INSERT placeholder `ticket_types` row (price_cents=0, is_unlimited=false, quantity_total=1); INSERT placeholder `trip_pricing_tiers` row joining the two. Returns the new Trip with empty sidecar arrays.
- `getTrip(eventId: string): Promise<Trip | null>` — SELECT events + LEFT JOIN trip_days + trip_pricing_tiers + ticket_types + trip_inclusions; mapped to a single `Trip` shape.
- `getTripsByBrand(brandId: string): Promise<Trip[]>` — SELECT events WHERE event_type='trip' AND brand_id = ? AND deleted_at IS NULL.
- `updateTripBasics(eventId, patch: TripBasicsPatch): Promise<Trip>` — UPDATE events SET title, slug-if-not-published, theme.business_trip = jsonb_set(...).
- `upsertTripDays(eventId, days: TripDayInput[]): Promise<TripDay[]>` — DELETE then INSERT (full replace) for simplicity in Tr2; Tr3+ may optimize to ON CONFLICT upsert.
- `upsertTripInclusions(eventId, items: TripInclusionInput[]): Promise<TripInclusion[]>` — DELETE then INSERT.
- `updateTripPricing(eventId, pricing: { tierName, priceCents, currency, capacity }): Promise<TripPricingTier>` — UPDATE ticket_types + UPDATE trip_pricing_tiers.tier_name.
- `publishTrip(eventId): Promise<Trip>` — call extended RPC `business_publish_event_draft({p_event_id: eventId, ...})` — same call signature as event publish; RPC's trip-branch validates internally.
- `softDeleteTrip(eventId): Promise<{ rejected: boolean; reason?: string }>` — mirror `softDeleteBrand` pattern from `brandsService.ts`; reject if any confirmed orders exist.

**Error contract:** throw on Postgrest error; SlugCollisionError on 23505; `publishTrip` re-throws RPC EXCEPTION with the raised text (e.g., `trip_days_required`) so the wizard can show inline error.

#### `mingla-business/src/services/tripCheckoutService.ts` (NEW — thin wrapper)

**Functions:**
- `startTripCheckout(input: { tripEventId: string; ticketTypeId: string; buyer: BuyerInfo; quantity: number; }): Promise<{ checkoutUrl: string }>` — calls existing `ticket-checkout-create` edge function passing `event_id = tripEventId` and `ticket_type_id`. Returns the Stripe Checkout Session URL (or PaymentIntent client_secret for native). NO new server-side logic; this service is a one-call wrapper for clarity.
- `getTripCheckoutStatus(sessionId: string): Promise<CheckoutStatus>` — re-exports existing `ticketCheckoutService.getCheckoutStatus`.

### 4.7 Hook layer

- `useTrips.ts` — `useTripsByBrand(brandId)` (React Query factory key `tripKeys.list(brandId)`, staleTime 5min, enabled iff brandId !== null); `useCreateTripDraft()` (optimistic — adds tempTrip with `_temp_` prefix); `useUpdateTripBasics()` / `useUpsertTripDays()` / etc. (all optimistic mirroring `useBrands` pattern).
- `usePublicTripBySlug.ts` — `usePublicTripBySlug(brandSlug, tripSlug)` — anon-tolerant fetch via Supabase anon client (NO `useAuth`); query key `tripKeys.publicBySlug(brandSlug, tripSlug)`; staleTime 1min; enabled iff both slugs present + non-empty strings.
- `useTripOrders.ts` — `useTripOrders(tripEventId)` for operator dashboard Travelers tab; uses existing `eventOrdersService` (event_type-agnostic).

**Query key factory (extends existing `brandKeys` style):**

```ts
export const tripKeys = {
  all: ['trips'] as const,
  lists: () => [...tripKeys.all, 'list'] as const,
  listByBrand: (brandId: string) => [...tripKeys.lists(), brandId] as const,
  details: () => [...tripKeys.all, 'detail'] as const,
  detail: (eventId: string) => [...tripKeys.details(), eventId] as const,
  public: () => [...tripKeys.all, 'public'] as const,
  publicBySlug: (brandSlug: string, tripSlug: string) =>
    [...tripKeys.public(), brandSlug, tripSlug] as const,
};
```

### 4.8 Component layer — Wizard

**`TripCreatorWizard.tsx`** (NEW) — host component, mirrors `EventCreatorWizard.tsx` (event wizard at `mingla-business/src/components/event/EventCreatorWizard.tsx`).

- Linear navigation (next/back), no step jumper (mirror event wizard — investigation P2-3).
- Autosave on each step transition via `useUpdateTripBasics` / `useUpsertTripDays` / etc.
- ScrollView host with `keyboardShouldPersistTaps="handled"` per `feedback_keyboard_never_blocks_input`.
- Deferred `scrollToBottom` on multiline input focus per Cycle 3 wizard pattern.

**Steps (5 total):**

| # | Component | What it captures |
|---|---|---|
| Step 1 | `TripCreatorStep1Basics.tsx` | Title (TextInput), date range (start + end via existing date picker pattern), destination (Google Places autocomplete — REUSE `AddressAutocompleteInput.tsx` from event wizard), capacity (numeric input, ≥1). Stored in `events.title` + `events.theme.business_trip.{startAt, endAt, destinationPlaceId, destinationLocationText, destinationLat, destinationLng, capacity}`. |
| Step 2 | `TripCreatorStep2Itinerary.tsx` + `TripDayEditor.tsx` | Stacked-cards UX (investigation P2-1 recommendation). Each card has title (TextInput) + narrative (multiline TextInput, maxLength 1000). Drag-reorder via `react-native-draggable-flatlist` (NEW dep — implementor confirms availability or fallback to swap-buttons). Add Day / Delete Day buttons. Persists to `trip_days` via `upsertTripDays`. |
| Step 3 | `TripCreatorStep3Inclusions.tsx` | Two parallel lists (Included / Excluded). Each list: add-item TextInput + per-row delete. Persists to `trip_inclusions` (`kind='included'` / `kind='excluded'`) with `ordinal` preserving order. |
| Step 4 | `TripCreatorStep4Pricing.tsx` | Single tier: tier name (TextInput, default "Standard"), price (numeric in major-currency-units — convert ×100 on save), currency (Select — default brand's `defaultCurrency`), capacity (read-only — pulled from Step 1). Persists to `ticket_types` (price_cents, currency, quantity_total) + `trip_pricing_tiers` (tier_name). |
| Step 5 | `TripCreatorStep5Review.tsx` + `TripPreview.tsx` | Renders `<TripPreview>` (the same component the public `/t/{brandSlug}/{tripSlug}` page uses) — preview-as-buyer-will-see. Bottom CTA: "Publish". Tap calls `tripsService.publishTrip(eventId)`. On RPC exception (e.g., `trip_days_required`), shows inline error pointing back to the failing step. |

**`TripPreview.tsx`** lives in `mingla-business/src/components/trip/` (NOT promoted to `packages/event-rendering` in Tr2 — C1 ORCH will decide whether to promote it for consumer reuse). Reads from a shared `Trip` shape that mirrors a `LiveEvent` plus `tripDays`, `tripPricingTiers`, `tripInclusions`. Sections:
1. Cover image hero (full-width)
2. Title + dates pill
3. Destination line
4. "Reserve my spot" CTA (sticky bottom on mobile)
5. Itinerary section (day cards stacked)
6. What's included / What's NOT included
7. Pricing section
8. Brand byline ("by <BrandName>")

### 4.9 Component layer — Buyer + Operator dashboard

**`TripCheckoutFlow.tsx`** (NEW) — thin wrapper around existing checkout components. Renders tier picker (single tier in Tr2 — auto-selects), then routes to `/checkout/{tripEventId}` via `router.push` for the rest of the flow. Per investigation G-2: minimal trip-shaped copy override ("Reserve your spot on <Trip Title>").

**Operator dashboard `mingla-business/app/trip/[id]/index.tsx`** (NEW) — two tabs:
- **Overview** (default): revenue card (sum of confirmed orders), traveler count, days-until-departure (computed in operator timezone per `feedback_validate_at_right_time` Constitution #12). Mirror `EventDetailKpiCard` pattern.
- **Travelers**: list of orders for this trip, each row showing buyer name + email + payment status. Mirror `EventDetailActivityRow` pattern.

### 4.10 Routing rewires

| File | Change |
|---|---|
| `mingla-business/src/components/ui/UniversalCreatorSheet.tsx:80` | Route "Create trip or otherwise" from `/trip/coming-soon` → `/trip/create`. ADDITIONAL: gate trip-card rendering on `currentBrand.kind === 'trip_planner'` (per Tr2 §8 hard guard — non-trip-planner brands either don't see the option OR see it disabled with "Available for trip-planner brands only"). Operator preference: SHOW disabled with explainer (mirrors PersonaPickerCards disabled-state pattern from Tr1). |
| `mingla-business/app/(tabs)/home.tsx:403` | Tr1 "Plan a trip" CTA route from `/trip/coming-soon` → `/trip/create`. |
| `mingla-business/app/(tabs)/hub/trips.tsx` | Replace placeholder copy with real trip list query via `useTripsByBrand(currentBrand.id)`. Render `EventListCard`-style cards. Tap routes to `/trip/{eventId}` operator dashboard. |
| `mingla-business/app/trip/coming-soon.tsx` | CONVERT to redirect: on mount, `router.replace('/trip/create')`. Render a single "Redirecting…" spinner during the brief navigation tick. Preserves any operator-shared deep links to the stub. |

---

## 5. Success Criteria

Mapped 1:1 to milestone brief §3 acceptance criteria + new invariants + Stripe Connect verification + scope guards. 25 total.

| # | Criterion | Layer | Test ID |
|---|---|---|---|
| SC-01 | Universal "+" → "Create trip or otherwise" routes to `/trip/create` (no longer `/trip/coming-soon`) for `kind='trip_planner'` brands. For other kinds, the option shows disabled with explainer copy. | Routing + UI | T-01 |
| SC-02 | `/trip/create` creates a draft `events` row with `event_type='trip'`, status='draft', auto-slug `draft-${id}`; routes to `/trip/{id}/edit?step=0` | Routing + DB | T-02 |
| SC-03 | Wizard has 5 steps with autosave on each step transition | UI | T-03 |
| SC-04 | Step 1 captures title, dates, destination (Google Places), capacity into `events.title` + `events.theme.business_trip` jsonb | UI + Service | T-04 |
| SC-05 | Step 2 supports add/edit/delete/reorder days manually; persists to `trip_days` | UI + DB | T-05 |
| SC-06 | Step 3 supports add/remove items in Included + Excluded lists; persists to `trip_inclusions` with kind discriminator | UI + DB | T-06 |
| SC-07 | Step 4 captures single tier with name + price (in major units, converted to cents) + currency; persists to `ticket_types` + `trip_pricing_tiers` | UI + DB | T-07 |
| SC-08 | Step 5 renders `<TripPreview>` showing buyer-eye view + Publish CTA | UI | T-08 |
| SC-09 | Publish via extended `business_publish_event_draft` RPC succeeds for valid trips; raises specific exceptions for missing `trip_days` / `trip_pricing_tiers` / `theme.business_trip.destinationLocationText` / `theme.business_trip.capacity` | RPC + DB | T-09 |
| SC-10 | Published trip status flips draft → scheduled; slug regenerated from title (`draft-` prefix removed); `published_at` set | RPC + DB | T-10 |
| SC-11 | Public route `/t/{brandSlug}/{tripSlug}` renders trip detail page anonymously (no useAuth, no sign-in redirect) | Routing + UI | T-11 |
| SC-12 | Anon role SELECT on `trip_days` / `trip_pricing_tiers` / `trip_inclusions` for a PUBLISHED trip returns rows; for a DRAFT trip returns empty (I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY enforcement) | DB + RLS | T-12 |
| SC-13 | Brand member SELECT on sidecar tables for OWN BRAND's draft trip returns rows (for wizard editing) | DB + RLS | T-13 |
| SC-14 | Buyer at `/t/{brandSlug}/{tripSlug}` taps "Reserve my spot" → routes to existing `/checkout/{tripEventId}` flow | Routing | T-14 |
| SC-15 | Buyer info screen captures name + email + phone only (no intake form fields in Tr2) | UI | T-15 |
| SC-16 | Stripe PaymentSheet opens with correct trip-shaped tier copy ("Reserve your spot on <Trip Title>") | UI | T-16 |
| SC-17 | Order is created with `event_id = tripEventId` referencing the trip | DB | T-17 |
| SC-18 | Stripe charge routes to trip planner's connected account: `transfer_data.destination = <trip-planner-brand's stripe_connect_id>`; `application_fee_amount` accrues to Mingla (I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING) | Edge fn + Live | T-18 |
| SC-19 | Confirmation email fires via `ticket-confirmation-dispatch` with trip-shaped template (trip title + dates + destination + day-by-day summary + included/excluded lists + brand shell) | Edge fn | T-19 |
| SC-20 | Existing event confirmation email path UNCHANGED for `event_type='event'` orders (no regression) | Edge fn + Regression | T-20 |
| SC-21 | `business_publish_event_draft` byte-equivalent for `event_type='event'` publishes (the trip-validation branch is gated on event_type='trip' and does not touch the event path) | RPC + Regression | T-21 |
| SC-22 | Operator dashboard `/trip/{id}` renders Overview tab (revenue + traveler count + days-until-departure) + Travelers tab (per-order rows) | UI | T-22 |
| SC-23 | Hub > Trips sub-tab lists the current brand's trips via `useTripsByBrand`; tap routes to operator dashboard | UI | T-23 |
| SC-24 | `discover-merged-events` excludes `event_type='trip'` rows from the consumer event feed (no regression in consumer Discover) | Edge fn + Regression | T-24 |
| SC-25 | `business_publish_event_draft` is the SINGLE publish RPC for trips (I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC enforcement) — no `business_publish_trip_draft` function exists | RPC + CI | T-25 |

---

## 6. Files Touched

**Database (2 migrations):**
1. `supabase/migrations/<timestamp>_orch_0859_trip_sidecar_tables.sql` — 3 sidecar tables + RLS + indexes + trigger + self-verify probe (§4.1).
2. `supabase/migrations/<timestamp+1>_orch_0859_publish_rpc_trip_validation.sql` — `CREATE OR REPLACE FUNCTION business_publish_event_draft` with trip-validation branch (§4.2).

**Edge functions (2 edits):**
3. `supabase/functions/ticket-confirmation-dispatch/index.ts` — trip discriminator branch + import `renderTripConfirmationHtml`.
4. `supabase/functions/_shared/tripConfirmationEmail.ts` (NEW) — `renderTripConfirmationHtml` helper.
5. `supabase/functions/discover-merged-events/index.ts` — add `.eq('event_type', 'event')` filter.

**Services (2 NEW):**
6. `mingla-business/src/services/tripsService.ts`
7. `mingla-business/src/services/tripCheckoutService.ts`

**Hooks (3 NEW):**
8. `mingla-business/src/hooks/useTrips.ts`
9. `mingla-business/src/hooks/usePublicTripBySlug.ts`
10. `mingla-business/src/hooks/useTripOrders.ts`

**App routes (4 NEW):**
11. `mingla-business/app/trip/create.tsx`
12. `mingla-business/app/trip/[id]/edit.tsx`
13. `mingla-business/app/trip/[id]/index.tsx`
14. `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`

**Components (9 NEW):**
15. `mingla-business/src/components/trip/TripCreatorWizard.tsx`
16. `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`
17. `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx`
18. `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx`
19. `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`
20. `mingla-business/src/components/trip/TripCreatorStep5Review.tsx`
21. `mingla-business/src/components/trip/TripDayEditor.tsx`
22. `mingla-business/src/components/trip/TripPreview.tsx`
23. `mingla-business/src/components/trip/TripCheckoutFlow.tsx`

**Stub rewires (4 EDIT):**
24. `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` — line ~80 route change + kind-gating on trip card.
25. `mingla-business/app/(tabs)/home.tsx` — line 403 Tr1 CTA route change.
26. `mingla-business/app/(tabs)/hub/trips.tsx` — replace placeholder with real query + list rendering.
27. `mingla-business/app/trip/coming-soon.tsx` — convert to redirect.

**Tests (5 implementor jest + 1 tester adversarial = 6 files):**
28. `mingla-business/src/services/__tests__/tripsService.test.ts`
29. `mingla-business/src/services/__tests__/tripCheckoutService.test.ts`
30. `mingla-business/src/hooks/__tests__/useTrips.test.ts`
31. `mingla-business/app/trip/__tests__/trip-create-publish.test.tsx`
32. `mingla-business/app/t/__tests__/public-trip-page.test.tsx`
33. `mingla-business/scripts/ci/orch-0859-adversarial-check.mjs` (NEW tester adversarial — Step 0.5 gate)

**Total:** 33 files (2 migrations + 3 edge fn touches + 2 services + 3 hooks + 4 routes + 9 components + 4 stub rewires + 5 jest tests + 1 adversarial check). Largest milestone yet — per investigation §6.

---

## 7. Implementation Order (each step independently revertible)

Per investigation §7. Each step compiles, type-checks, and ships independently. **GATE between each step: type-check passes, scoped tests pass.**

| Step | Files | GATE before next step |
|---|---|---|
| 1 | Migration sidecar tables (file 1) | **HALT — operator runs `supabase db push --linked`**, MCP probe confirms 3 tables + 6 policies exist. |
| 2 | Migration publish-RPC extension (file 2) | **HALT — operator runs `supabase db push --linked`**, MCP probe confirms updated function body contains `trip_days_required` literal. |
| 3 | Services (files 6, 7) + hooks (files 8, 9, 10) — type-only first iteration, no caller wires | `npx tsc --noEmit` zero new errors. |
| 4 | Wizard components NEW (files 15-22) | Each renders in isolation, type-check passes. |
| 5 | Wizard host route NEW (files 11, 12) + UniversalCreatorSheet rewire + Home CTA rewire + /trip/coming-soon redirect (files 24, 25, 27) | Operator can tap "+" → "Create trip" → land on wizard; popup brand sees disabled card explainer. |
| 6 | Operator dashboard (file 13) + Hub > Trips wire (file 26) | Trip-planner brand sees their trips in Hub > Trips; tap routes to dashboard. |
| 7 | Public anon route (file 14) + TripPreview reused | Browser hit on `/t/{brandSlug}/{tripSlug}` for a published trip renders correctly; no useAuth. |
| 8 | Buyer flow (file 23 + minor copy edits in /checkout chain) | Buyer at /t/ taps Reserve → routes to /checkout/ → completes Stripe (test mode). |
| 9 | Confirmation email extension (files 3, 4) | Test trip purchase fires trip-shaped email (operator verifies via test inbox). |
| 10 | Consumer Discover trip-exclusion filter (file 5) | Consumer event feed query returns same count as before (zero trips leak). |
| 11 | Tests (files 28-32) — 5 jest with fails-on-revert each | `npx jest tripsService tripCheckoutService useTrips trip-create-publish public-trip-page` — all PASS. Fails-on-revert verified per Step 0.5 gate. |
| 12 | Tester adversarial check (file 33) | `node mingla-business/scripts/ci/orch-0859-adversarial-check.mjs` — 14+ checks PASS, A-08 byte-equivalence on event publish + A-12 RLS published-only + scope-leak guardrail. Fails-on-revert verified. |
| 13 | **Operator Stripe Connect live-Dashboard probe (SC-18)** — operator buys a $1 test-mode trip ticket, verifies in Stripe Dashboard | Charge routed to trip planner's connected account; application_fee_amount populated. |

---

## 8. Invariants

### Preserved (must not break)

| Invariant | How Tr2 preserves it |
|---|---|
| I-1.2-UNIFIED-EVENT-TYPE | Trips INSERT into `events` with `event_type='trip'`; no parallel `trips` table; sidecar tables hang off `events.id` via FK ON DELETE CASCADE. Adversarial check A-04 fails if any `CREATE TABLE trips` literal appears in migrations. |
| I-1.2-BRAND-AS-CONTAINER | DB+RLS allows ANY brand kind to own a trip event. The wizard-entry gating (`kind='trip_planner'` only) is UI-layer ONLY for Tr2 product narrowing — schema preserves capability layer. Future "expand to all kinds" is a clean amendment to UniversalCreatorSheet without DB changes. |
| I-PROPOSED-TR1-PERSONA-INTERFACE (ACTIVE) | Tr2 does NOT touch PersonaPickerCards or its locked `PersonaDef.id` union. ORCH-0855 adversarial check A-07 still passes. |
| I-PROPOSED-TR1-KIND-IMMUTABLE (ACTIVE) | Tr2 does NOT modify BrandEditView kind editor. |
| Constitution #2 (one owner per truth) | `business_publish_event_draft` extended (NOT forked to `business_publish_trip_draft`). One publish authority. Enforced by new I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC + adversarial A-08. |
| Constitution #3 (no silent failures) | Publish RPC raises specific exceptions (`trip_days_required`, etc.) — wizard catches and shows inline error pointing to failing step. Stripe Connect routing failures surface via existing checkout error path. |
| Constitution #8 (subtract before adding) | Wizard mirrors event-wizard pattern (NOT duplicates event-create infra). Buyer checkout reuses existing `/checkout/{eventId}` chain. Confirmation email extends existing dispatch. |
| Constitution #9 (no fabricated data) | Anon RLS gates draft trips from public read (I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY). Stripe routing verified live, not assumed (I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING). |
| Constitution #11 (one auth instance) | Public trip route uses no `useAuth`; buyer checkout uses anon-tolerant pattern per `feedback_anon_buyer_routes`. |
| Constitution #12 (validate at right time) | Days-until-departure in operator dashboard computes in operator's timezone (per `feedback_validate_at_right_time`). |
| Constitution #13 (exclusion consistency) | `discover-merged-events` adds explicit `event_type='event'` filter — producer-side exclusion matches consumer-side expectations. |
| `feedback_anon_buyer_routes` | `/t/[brandSlug]/[tripSlug]` lives outside `app/(tabs)/`, no useAuth, no sign-in redirect. |
| `feedback_orchestrator_deploys_edge_functions` | Tr2 touches 2 edge functions (`ticket-confirmation-dispatch` + `discover-merged-events`). Operator runs `supabase db push` for migrations; orchestrator deploys edge functions post-implementation. |
| `feedback_keyboard_never_blocks_input` | Wizard uses `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"` + deferred scrollToBottom on multiline focus. |
| `feedback_rn_color_formats` | All inline colors hex/rgb/hsl — no oklch. |

### New (introduced by Tr2 — DRAFT, flip ACTIVE on ORCH-0859 CLOSE)

| ID | Status | Description |
|---|---|---|
| **I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY** | DRAFT | Anon SELECT on `trip_days` + `trip_pricing_tiers` + `trip_inclusions` MUST gate on `EXISTS (SELECT 1 FROM events e WHERE e.id = sidecar.event_id AND e.deleted_at IS NULL AND (e.status IN ('scheduled','live') OR biz_is_brand_member_for_read_for_caller(e.brand_id)))`. No draft-trip detail leakage. Enforced by adversarial A-12 (anon-vs-draft probe returns empty; anon-vs-published returns rows). |
| **I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING** | DRAFT | Trip orders MUST have `transfer_data.destination = <trip-planner-brand's stripe_connect_id>` in the Stripe Session/PaymentIntent. Enforced by tester live-Dashboard probe at CLOSE-time (SC-18) + adversarial A-09 confirming `ticket-checkout-create` is unchanged (event_type-agnostic with brand-derived routing). |
| ~~I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC~~ | KILLED at IMPLEMENT-time (2026-05-17 operator option B) | Original intent: single publish RPC for all event_types. Killed because the existing event RPC body is tightly coupled to event-only taxonomy validation; extending would require gating every existing validation block in `IF event_type='event'` wrappers which is materially "altering existing logic." Replaced by **forked `business_publish_trip_draft` RPC** approach — event RPC stays byte-unchanged, trip RPC is net-new with trip-shaped contract. New adversarial check A-06 verifies the event RPC migration files are unmodified (byte-equivalence of event publish path). |

---

## 9. Test Matrix

Per Step 0.5 regression gate (ORCH-0840). Implementor writes happy-path; tester writes adversarial. Both fails-on-revert verified at commit hashes cited in respective reports.

### Implementor tests (5 files per Tr2 §7)

| Test | SC | Scenario | File |
|---|---|---|---|
| T-02, T-04, T-05, T-06, T-07, T-09, T-10 | Service-layer round-trip | `tripsService.test.ts` |
| T-14, T-17 | Trip-checkout wrapper calls correct edge fn args | `tripCheckoutService.test.ts` |
| T-03 (autosave), T-09 (publish error surface) | Hook integration with React Query mocks | `useTrips.test.ts` |
| T-01, T-02, T-08, T-09, T-10 | Wizard full happy path → publish success | `trip-create-publish.test.tsx` |
| T-11, T-12, T-13 | Public page renders for published trip; structural-grep no useAuth | `public-trip-page.test.tsx` |

### Tester adversarial check (file 33 — `scripts/ci/orch-0859-adversarial-check.mjs`)

14+ structural-grep checks attacking DIFFERENT angles than implementor jest tests:

| Check | Asserts | Different angle |
|---|---|---|
| A-01 | Migration `<timestamp>_orch_0859_trip_sidecar_tables.sql` exists, prefix monotonic | Filesystem + monotonicity |
| A-02 | Migration creates ALL 3 tables (trip_days + trip_pricing_tiers + trip_inclusions) + 6 RLS policies + self-verify DO block | DDL structural completeness |
| A-03 | Migration uses `biz_is_brand_member_for_read_for_caller` helper in RLS predicates (no `is_brand_member` typo) | Helper-name correctness |
| A-04 | NO `CREATE TABLE.*trips` literal in any migration (I-1.2-UNIFIED-EVENT-TYPE enforcement) | Forbidden-table guardrail |
| A-05 | Publish RPC migration contains `trip_days_required` + `trip_pricing_tier_required` + `trip_destination_required` + `trip_capacity_required` raise literals | Validation completeness |
| A-06 (AMENDED) | NEW migration `20260608000100_orch_0859_publish_rpc_trip.sql` exists AND defines `CREATE OR REPLACE FUNCTION business_publish_trip_draft` AND the existing `20260604000001_orch_0824_publish_rpc.sql` is BYTE-UNCHANGED (`git diff origin/main -- supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` empty) | Event publish path byte-equivalent — fork didn't accidentally touch the event RPC |
| A-07 (AMENDED) | `business_publish_trip_draft` is the ONLY publish call path for trips: `tripsService.publishTrip` calls `supabase.rpc('business_publish_trip_draft', ...)`. `business_publish_event_draft` is NEVER called from any trip-related file (search `mingla-business/src/{services,hooks,components/trip}/**/*.ts` for `business_publish_event_draft` → expect zero hits) | Correct RPC routing |
| A-08 | `ticket-checkout-create/index.ts` UNCHANGED — no `event_type === 'trip'` branch added (event_type-agnostic invariant) | Reuse-not-modify guardrail |
| A-09 | `ticket-confirmation-dispatch/index.ts` HAS `event_type === 'trip'` branch + imports `renderTripConfirmationHtml` | Email extension complete |
| A-10 | `discover-merged-events/index.ts` HAS `.eq('event_type', 'event')` literal in events query | Consumer-feed exclusion |
| A-11 | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` exists + does NOT import useAuth + does NOT call sign-in redirect | Anon-tolerant route guardrail |
| A-12 | Live MCP probe via `mcp__supabase__execute_sql` (run during tester pass): anon SELECT on draft trip's trip_days returns empty; anon SELECT on published trip's trip_days returns rows | RLS published-only enforcement |
| A-13 | `UniversalCreatorSheet.tsx` "Create trip or otherwise" routes to `/trip/create` (not `/trip/coming-soon`) | Stub rewire complete |
| A-14 | `home.tsx` Tr1 "Plan a trip" CTA routes to `/trip/create` | Home CTA rewire complete |
| A-15 | Scope-leak guardrail: `'trip_planner'` + `'event_type='\''trip'\''` literals confined to expected Tr2 files (whole-tree scan) | Scope-leak detection |

---

## 10. Regression Prevention

| Class | Safeguard | Test |
|---|---|---|
| Parallel `trips` table drift | Adversarial A-04 + I-1.2-UNIFIED-EVENT-TYPE invariant + SPEC §2 non-goal | A-04 + SC-N (DB shape) |
| Fork-not-extend publish RPC drift | Adversarial A-07 + I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC invariant | A-07 |
| Draft-trip leakage to anon (Constitution #9) | RLS predicate self-verify probe (migration DO block) + adversarial A-12 live MCP probe | A-12 |
| Stripe Connect routing regression (silent revenue misallocation) | Adversarial A-08 confirms ticket-checkout-create unchanged + operator live-Dashboard probe SC-18 | A-08 + live probe |
| Consumer event feed leakage of trip rows | Adversarial A-10 + SC-24 + filter literal in edge fn | A-10 |
| Event publish path regression | Adversarial A-06 ensures CREATE OR REPLACE (not CREATE FUNCTION) + tester re-runs existing event publish in jest | SC-21 + existing event tests |
| `useAuth` accidentally added to public trip route | Adversarial A-11 + SC-11 | A-11 |
| Helper function name drift | Adversarial A-03 ensures correct helper name in RLS predicates | A-03 |

**Protective comments:** every NEW file carries a header docstring citing ORCH-0859 + the relevant Tr2 invariants. The 3 sidecar tables carry `COMMENT ON TABLE` SQL comments explaining their relationship to `events` and the published-only RLS rule. The publish RPC trip branch carries an inline comment `-- ORCH-0859: trip publish validation. event_type='event' path unchanged. DO NOT ALTER existing logic — only insert new branches gated on event_type.`

---

## 11. Open Polish Items (deferred — per Tr2 §9)

- Day-by-day editor visual treatment (stacked cards confirmed in §4.8 — drag-reorder via `react-native-draggable-flatlist` OR swap-buttons; implementor picks based on dep availability).
- Image upload per day — DEFERRED to Tr8 polish.
- Wizard step jumper — DEFERRED (linear nav in Tr2).
- Anon-tolerant trip page hero design beyond cover + dates + capacity — DEFERRED to polish ORCH (current Tr2 design intentionally minimal).
- Confirmation email template visual polish — DEFERRED. Tr2 uses brand shell from ORCH-0785 with trip-specific content; visual refinement later.

---

## 12. Discoveries from Investigation (to register at INTAKE if not already)

Per investigation §11:
- **DISCOVERY-1:** ORCH-ID correction — Tr2 is ORCH-0859 not ORCH-0856. Orchestrator updates WORLD_MAP + MASTER_BUG_LIST + AGENT_HANDOFFS at INTAKE registration.
- **DISCOVERY-2:** Trip orders generate PDFs (per `ticket-pdf-fetch` ORCH-0842 — event_type-agnostic at the renderer layer). Tr2 reuses without modification.
- **DISCOVERY-3:** `discover-merged-events` needs `event_type='event'` filter — IN SPEC scope per file 5.
- **DISCOVERY-4:** Helper function name verification at impl time via `pg_proc` probe — IN SPEC migration §4.1.
- **DISCOVERY-5:** Trip slug uniqueness scope — mirror events (per-brand uniqueness, NOT global). Implementor verifies existing `events` slug index pattern.
- **DISCOVERY-6:** Trip-planner kind UI gate is intentional product-narrowing despite I-1.2-BRAND-AS-CONTAINER. SPEC §4.10 file 24 codifies the disabled-with-explainer UX so future "expand to all kinds" ORCH is a clean amendment.

---

## 13. CLOSE-Protocol Notes (orchestrator-facing)

- **Edge function deploys:** TWO edge functions touched — `ticket-confirmation-dispatch` + `discover-merged-events`. Orchestrator MUST deploy via `supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv` after operator's `supabase db push --linked` for both migrations + verify via `mcp__supabase__list_edge_functions` (per `feedback_orchestrator_deploys_edge_functions`).
- **Migration apply:** TWO migrations (sidecar tables + publish RPC) — operator-owned `supabase db push --linked`. Implementor halts at Step 1 + Step 2 gates.
- **EAS OTA eligibility:** YES for `mingla-business/` (pure JS+TS in the wizard + new components + service/hook additions; no native module additions). Verify `mingla-business/eas.json` has a `production` channel — if not, distribution path is next native rebuild for native consumers + immediate Vercel deploy for web preview.
- **DIAG reap:** zero `[ORCH-0859-DIAG]` markers expected (none specified in this SPEC).
- **New memory files at CLOSE (orchestrator writes 3):**
  - `feedback_trip_sidecar_published_only_rls.md` — codifies I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY DRAFT → ACTIVE
  - `feedback_stripe_connect_trip_routing_verified.md` — codifies I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING DRAFT → ACTIVE
  - `feedback_unified_publish_rpc_for_all_event_types.md` — codifies I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC DRAFT → ACTIVE
- **New DEC entries at CLOSE (3):**
  - DEC-NNN: trip sidecar tables RLS published-only per I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY.
  - DEC-NNN+1: Stripe Connect trip routing verified live per I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING.
  - DEC-NNN+2: `business_publish_event_draft` extended (not forked) per I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC + Constitution #2.
- **WORLD_MAP + COVERAGE_MAP + PRODUCT_SNAPSHOT + AGENT_HANDOFFS + MASTER_BUG_LIST + PRIORITY_BOARD** updates per standard CLOSE Step 1.
- **DEPRECATION CLOSE Step 5 extension:** NOT triggered (Tr2 is additive — no decommission of tables, columns, RPCs, or features).
- **PR strategy:** per `feedback_one_pr_per_close.md` — one PR per CLOSE. Tr2's PR title: `Close ORCH-0859: Tr2 Minimum Viable Trip — first dollar of trip revenue`. Implementor stages ONLY Tr2's 33 files via explicit `git add` (NOT `git add -A`) at CLOSE.

---

## 14. Cross-references

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md`
- Milestone brief: `Mingla_Artifacts/milestones/Tr2_MINIMUM_VIABLE_TRIP.md`
- Tr1 closure: `Mingla_Artifacts/reports/{INVESTIGATION,IMPLEMENTATION,QA}_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING*.md` + `specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
- M0 closure: `specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md` + `reports/QA_ORCH-0826_M0_HUB_FOUNDATION.md`
- Project spec: `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md` §3.3 + §6.2 + §8
- Invariants: `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-1.2-UNIFIED-EVENT-TYPE ACTIVE, I-1.2-BRAND-AS-CONTAINER PROJECT_SPEC §54, I-PROPOSED-TR1-PERSONA-INTERFACE ACTIVE, I-PROPOSED-TR1-KIND-IMMUTABLE ACTIVE, NEW I-PROPOSED-TR2-* trio DRAFT)
- Decisions: `Mingla_Artifacts/DECISION_LOG.md` (DEC-4 Stripe-as-identity, DEC-152 TopSheet, DEC-160/DEC-161 Tr1 invariants)
- Existing pattern files: event wizard `mingla-business/src/components/event/Creator*.tsx`, public event route `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`, publish RPC `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql`, checkout chain `mingla-business/app/checkout/[eventId]/*`, confirmation dispatch `supabase/functions/ticket-confirmation-dispatch/`
- Operator memory: `feedback_anon_buyer_routes.md`, `feedback_orchestrator_deploys_edge_functions.md`, `feedback_one_pr_per_close.md`, `feedback_strict_grep_registry_pattern.md`, `feedback_keyboard_never_blocks_input.md`, `feedback_rn_color_formats.md`, `feedback_brand_kind_immutable_post_create.md` (Tr1), `feedback_persona_picker_locked_interface.md` (Tr1)
