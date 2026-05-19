# SPEC v2 — ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation v2:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_V2_FULL_PARITY_AUDIT.md` (32-row parity matrix, 22 findings, 15 architecture decisions, 9 DRAFT invariants)
**Orchestrator dispatch (lock-source):** `Mingla_Artifacts/prompts/SPEC_ORCH-0876_V2_FULL_PARITY.md` — all 18 open questions pre-locked by operator's "the spec will decide" directive
**v1 baselines (RETAINED for context, SUPERSEDED):** `reports/INVESTIGATION_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` + `specs/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md`
**Author confidence:** H — every contract maps to a six-field investigation finding; all 18 operator decisions pre-locked; zero new ambiguity surfaced during SPEC writing.

---

## 0. Layman summary

- **Trip planners get the full event-parity edit-after-publish package.** Tap Edit on a published trip → dedicated 6-section accordion screen opens (Basics / Itinerary / Inclusions / Pricing / Cover / Settings) → make changes → tap "Save changes" → ChangeSummaryModal opens showing every diff + required 10-200 char reason → confirm → "Saved. Live now." toast. Destructive changes (drop capacity below sold, delete tier with sales, drop trip days with sales, shift dates with sales, remove inclusions with sales, change tier price with sales) reject with "Refund first" dialog routing to `/trip/{id}#orders`.
- **Draft trips keep the wizard** with new save-on-back, save-on-close-edit-mode, and visible "Saved" toast polish (v1's S-1 fix preserved).
- **Cover gets full 3-provider parity with events.** New shared `<CoverPicker>` component (Photo Library + GIPHY + Pexels) consumed by BOTH trip Step 1 Basics AND EditPublishedTripScreen Cover section AND events' CreatorStep4Cover (event-side refactored to consume the same component — single source of truth forever).
- **Buyer "Reserve my spot"** routes to new `/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx` chain — thin trip-aware shells around shared CartContext + CheckoutHeader + QuantityRow + Stripe payment primitives. Event-side `/checkout/[eventId]/*` chain stays untouched; audit test still enforces trip-rejection.
- **Architecture leapfrog:** trip published-edit goes server-side via new `biz_update_live_trip` RPC writing atomically across `events` + `trip_days` + `trip_inclusions` + `trip_pricing_tiers` in a single transaction. Events still carry the Zustand-only-write tech debt (`useLiveEventStore.updateLiveEventFields` writes mostly to client memory). Trips skip that debt entirely.
- **Audit trail is permanent and DB-side:** new `trip_edit_log` table records every save (timestamp, fields changed, reason, severity, affected orders). RLS: owner brand reads own logs; only the RPC writes.
- **One bundled PR Seth→main at CLOSE** per Path A operator authorization. ~30-35 files. Single migration. EAS-OTA eligible.

---

## 1. Investigation ingest

The v2 investigation is APPROVED. Every root cause has a six-field finding; the 32-row parity matrix is the SPEC's blueprint. This SPEC consumes investigation findings F-1..F-22 unchanged. Quick map:

- F-1 / F-2 / F-3 (S-3) → §8 route layer + §6 service `getPublicTripById` + §9 TripCheckoutFlow.tsx:62 mod
- F-4 / F-5 / F-6 / F-7 (S-1) → §9 TripCreatorWizard mods + Saved toast + invariants §13
- F-8 / F-9 / F-10 (S-2) → §6 Cover service + §9 shared `<CoverPicker>` + §9 TripCreatorStep1Basics + TripCreatorWizard handlePublish payload mod
- F-11..F-15 (S-4) → §4 RPC + trip_edit_log table + §6 publishedTripEditGuards + tripChangeNotifier + tripAdapter
- F-16 (Tr4 coordination) → §15 implementation order final note + §17 discoveries
- F-17 (events Zustand debt leapfrog) → §4 server-side RPC architecture + §13 I-PROPOSED-TRIP-PUBLISHED-EDIT-VIA-RPC
- F-18 (shared StepBodyProps contract) → §9 extend Trip step component Props with optional `editMode`
- F-19 (event query-param routing) → Q6 lock → status-based dispatch
- F-20 / F-22 (data + permissions) → §11 SCs

---

## 2. Scope and non-goals

### 2.1 Scope (in)

**S-1 draft-wizard Save polish (preserved from v1):** TripCreatorWizard `handleStepBack` + `handleClose` await autosave in edit mode; visible "Saved" toast on autosave success; existing autosave-error retry shape preserved; ORCH-0874 [Trip Visual Parity] chrome contract untouched.

**S-2 Cover (full 3-provider parity):** New shared `<CoverPicker>` component at `src/components/ui/CoverPicker.tsx`. Refactored event-side `CreatorStep4Cover.tsx` to consume the new component (zero behavior regression for events). Trip Step 1 Basics adds Cover field at top consuming the shared component. EditPublishedTripScreen Cover section also consumes it. publishTrip + biz_update_live_trip both accept cover_media_* keys. Reuses `event_covers` storage bucket (events-row-id keyed; works for trips as-is).

**S-3 Reserve route (preserved from v1):** TripCheckoutFlow `handleReserve` routes to `/checkout-trip/${trip.id}`. New 5-file route tree at `app/checkout-trip/[tripEventId]/`. New `usePublicTripById` + `getPublicTripById` trip-only resolver. Shared CartContext / CheckoutHeader / QuantityRow / payment primitives reused. Existing `/checkout/[eventId]/*` chain UNCHANGED — continues to reject trips per audit test.

**S-4 Published-trip edit (NEW full parity):** `app/trip/[id]/edit.tsx` dispatches by `trip.status`: `draft` → TripCreatorWizard; `scheduled` or `live` → new `EditPublishedTripScreen`; `ended` or `cancelled` → read-only banner (NEW empty state per SC-4.20). New `EditPublishedTripScreen.tsx` (~1,000-1,200 lines mirroring `EditPublishedScreen.tsx`) with 6-section accordion, "Save changes" sticky bottom dock, EditAfterPublishTripBanner. New `biz_update_live_trip` RPC. New `trip_edit_log` table. New `publishedTripEditGuards.validateLiveTripFieldUpdate` with 8 rejection reasons. New `tripAdapter` (FIELD_LABELS, MATERIAL_KEYS, SAFE_KEYS, editableTripToPatch, classifyTripSeverity, computeTripDayDiffs, computeTripInclusionDiffs, computeTripPricingTierDiffs). Generalized `ChangeSummaryModal` (3 new sub-renderers). New `tripChangeNotifier` (banner via trip_edit_log + email TRANSITIONAL stub + sms TRANSITIONAL stub + push DEFERRED). New `useTripHasWebPurchases(tripId)` hook.

**Audit-test extension:** 3 new clauses on `eventType.filter.audit.test.ts` (defense-in-depth per Q17).

**Regression tests:** 5 implementor happy-path test files + 1 tester adversarial test file (per Q10 + Q11 in §14).

### 2.2 Non-goals (out)

- No widening of `getPublicEventById` / `getPublicEventBySlug` / `getPublicBrandBySlug` — event-side trip-rejection audits stay untouched.
- No deletion of `useLiveEventStore` or migration of events to server-side. Events keep their Zustand-write tech debt; trips skip it (future ORCH may backfill events; out of scope here).
- No edge function deployment. The RPC is DB-side. Existing `ticket-checkout-create` + `ticket-checkout-confirm` + `ticket-checkout-status` UNCHANGED — invoked as-is from new `/checkout-trip/[tripEventId]/payment.tsx`.
- No business logic for ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] booking-deadline OR refund-tier gates. Tr4 ships after this CLOSE with amended SPEC.
- No cover video for trips (Q8 lock — match events' ORCH-0783 [active cover model] image-first scope).
- No unification of TripCreatorWizard with EventCreatorWizard.
- No new strict-grep CI gate. Audit-test extension is the structural safeguard.
- No `/trip/{id}/orders` full ledger build — uses dashboard anchor; Tr4 ships proper ledger.
- No persistence to Zustand for trip-server-state — `feedback_zustand_persist_no_server_snapshots.md` honored.
- No analytics events added beyond what's automatic via shared primitives.
- No native module changes — EAS OTA eligible.

### 2.3 Assumptions

- Investigation v2 §3 file inventory and §4 parity matrix are accurate (orchestrator REVIEW-APPROVED).
- Trip status enum is `{draft, scheduled, live, ended, cancelled}` per `events_status_check` constraint at migration 20260505000000.
- `biz_brand_effective_rank(brand_id, user_id) + biz_role_rank('event_manager')` permission pattern is canonical (used by `business_publish_trip_draft` migration 20260608000100).
- `event_covers` storage bucket RLS allows trip-event-row-id keyed uploads (bucket policy is brand_id + event_id keyed; not event_type discriminated).
- `Sheet` UI primitive at `mingla-business/src/components/ui/Sheet.tsx` supports `snapPoint="full"` mode used by `ChangeSummaryModal`.
- `Toast` primitive needs absolute-positioned wrapper per `feedback_toast_needs_absolute_wrap.md` — every consumer wraps.
- `useCurrentBrandRole` hook exists for permission gates (used by `EditPublishedScreen.tsx:327`).
- 1 published trip currently in DB (`the-dc-adventure`) is operator's S-3 test subject; 0 confirmed orders means refund-gate has no live data to gate today but must be built for once trips become purchasable.

---

## 3. Cross-Surface Impact (Phase 2.5)

| # | Surface | In scope? | Per-surface behaviour + paths | Parity model |
|---|---------|-----------|-------------------------------|--------------|
| 1 | Consumer iOS (`app-mobile/` on iOS) | NO | No trip surface (Track C1) | n/a |
| 2 | Consumer Android | NO | Same | n/a |
| 3 | **Buyer-anon Web** (mingla-business RN-Web) | **YES — primary for S-3** | New `/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx` chain renders + completes purchase | Shared RN code |
| 4 | **Business iOS** (mingla-business on iOS) | **YES** for S-1 + S-2 + S-4 | TripCreatorWizard mods + new EditPublishedTripScreen + new EditAfterPublishTripBanner + new `<CoverPicker>` | Shared RN code |
| 5 | **Business Android** | **YES — parity-automatic via RN** | Same files as iOS; tester verifies on emu | Shared RN code |
| 6 | Admin Web | NO | No admin trip page | n/a |
| 7 | **Business Web preview** | **YES — follows automatically via RN-Web bundle** | Surfaces 3-5 share RN-Web build | Shared RN code |

**Manual-parity surfaces:** none — all in-scope surfaces share RN code. Tester verifies parity, implementor ships one diff.

---

## 4. Schema layer (Phase 3 — DB)

### 4.1 New migration: `supabase/migrations/<timestamp>_orch_0876_trip_published_edit.sql`

```sql
BEGIN;

-- ============================================================
-- Section 1 — trip_edit_log table
-- ============================================================
CREATE TABLE public.trip_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  edited_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 200),
  severity text NOT NULL CHECK (severity IN ('additive', 'material')),
  changed_field_keys text[] NOT NULL DEFAULT '{}',
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_order_ids uuid[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_edit_log_event_id_idx
  ON public.trip_edit_log (event_id, occurred_at DESC);

CREATE INDEX trip_edit_log_brand_id_idx
  ON public.trip_edit_log (brand_id, occurred_at DESC);

ALTER TABLE public.trip_edit_log ENABLE ROW LEVEL SECURITY;

-- Read: owner brand at event_manager+ rank reads own brand's logs.
CREATE POLICY "trip_edit_log_owner_read"
  ON public.trip_edit_log
  FOR SELECT
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

-- NO INSERT/UPDATE/DELETE policies — only biz_update_live_trip
-- (SECURITY DEFINER) writes. Direct client mutation is impossible.

-- ============================================================
-- Section 2 — Helper: per-tier sold counts for a trip
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_trip_sold_count_by_tier(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- Returns { ticket_type_id: count, ... } for confirmed orders.
  -- Confirmed = orders.payment_status NOT IN ('failed', 'cancelled').
  SELECT COALESCE(jsonb_object_agg(ticket_type_id::text, sold_count), '{}'::jsonb)
  INTO v_result
  FROM (
    SELECT
      oli.ticket_type_id,
      SUM(oli.quantity)::int AS sold_count
    FROM public.orders o
    JOIN public.order_line_items oli ON oli.order_id = o.id
    WHERE o.event_id = p_event_id
      AND o.payment_status NOT IN ('failed', 'cancelled')
      AND oli.ticket_type_id IS NOT NULL
    GROUP BY oli.ticket_type_id
  ) s;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_trip_sold_count_by_tier(uuid)
  TO authenticated;

-- ============================================================
-- Section 3 — Helper: has-web-purchases predicate
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_trip_has_web_purchases(
  p_event_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled')
      AND payment_method IN ('card', 'apple_pay', 'google_pay')
  );
$$;

GRANT EXECUTE ON FUNCTION public.biz_trip_has_web_purchases(uuid)
  TO authenticated;

-- ============================================================
-- Section 4 — Main RPC: biz_update_live_trip
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_update_live_trip(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_trimmed_reason text;
  v_severity text;
  v_changed_keys text[] := '{}';
  v_sold_by_tier jsonb;
  v_log_id uuid;
  v_business_trip jsonb;
  v_new_business_trip jsonb;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_old_end timestamptz;
  v_new_end timestamptz;
  v_old_capacity int;
  v_new_capacity int;
  v_existing_day_ordinals int[];
  v_new_day_ordinals int[];
  v_dropped_ordinals int[];
  v_existing_inclusion_keys text[];
  v_new_inclusion_keys text[];
  v_dropped_inclusions text[];
  v_tier record;
  v_new_tier jsonb;
  v_affected_order_count int := 0;
  v_diff_summary jsonb := '{}'::jsonb;
BEGIN
  -- ---------- 1. Auth + reason validation ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Event lookup + type/permission gates ----------
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'biz_update_live_trip only handles event_type=trip rows.';
  END IF;

  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- ---------- 3. Compute sold-count context ----------
  v_sold_by_tier := public.biz_trip_sold_count_by_tier(p_event_id);

  -- ---------- 4. Refund-gate validation per patch shape ----------

  -- 4a. Capacity check (theme.business_trip.capacity)
  v_business_trip := COALESCE(v_event.theme->'business_trip', '{}'::jsonb);
  v_new_business_trip := COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb);

  IF v_new_business_trip ? 'capacity' THEN
    v_old_capacity := NULLIF(v_business_trip->>'capacity', '')::int;
    v_new_capacity := NULLIF(v_new_business_trip->>'capacity', '')::int;
    -- total confirmed sold across all tiers
    SELECT COALESCE(SUM((value)::int), 0)
      INTO v_affected_order_count
      FROM jsonb_each_text(v_sold_by_tier);
    IF v_new_capacity IS NOT NULL
       AND v_old_capacity IS NOT NULL
       AND v_new_capacity < v_affected_order_count THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'capacity_below_sold',
        'affected_order_count', v_affected_order_count
      );
    END IF;
  END IF;

  -- 4b. Date shift check (theme.business_trip.startAt or endAt)
  IF v_new_business_trip ? 'startAt' OR v_new_business_trip ? 'endAt' THEN
    v_old_start := NULLIF(v_business_trip->>'startAt', '')::timestamptz;
    v_old_end := NULLIF(v_business_trip->>'endAt', '')::timestamptz;
    v_new_start := COALESCE(
      NULLIF(v_new_business_trip->>'startAt', '')::timestamptz,
      v_old_start
    );
    v_new_end := COALESCE(
      NULLIF(v_new_business_trip->>'endAt', '')::timestamptz,
      v_old_end
    );
    -- Count confirmed orders touching this trip
    SELECT COUNT(*) INTO v_affected_order_count
      FROM public.orders
      WHERE event_id = p_event_id
        AND payment_status NOT IN ('failed', 'cancelled');
    IF v_affected_order_count > 0
       AND (v_new_start <> v_old_start OR v_new_end <> v_old_end) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_affected_order_count,
        'dropped_dates', jsonb_build_array(
          to_char(v_old_start, 'YYYY-MM-DD'),
          to_char(v_old_end, 'YYYY-MM-DD')
        )
      );
    END IF;
  END IF;

  -- 4c. Days check — dropped trip_day ordinals with sales
  IF p_patch ? 'days' THEN
    SELECT array_agg(ordinal ORDER BY ordinal)
      INTO v_existing_day_ordinals
      FROM public.trip_days
      WHERE event_id = p_event_id;
    SELECT array_agg((d->>'ordinal')::int ORDER BY (d->>'ordinal')::int)
      INTO v_new_day_ordinals
      FROM jsonb_array_elements(p_patch->'days') d;
    v_dropped_ordinals := (
      SELECT array_agg(o)
      FROM unnest(v_existing_day_ordinals) o
      WHERE o <> ALL (v_new_day_ordinals)
    );
    IF array_length(v_dropped_ordinals, 1) > 0 THEN
      SELECT COUNT(*) INTO v_affected_order_count
        FROM public.orders
        WHERE event_id = p_event_id
          AND payment_status NOT IN ('failed', 'cancelled');
      IF v_affected_order_count > 0 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'days_dropped_with_sales',
          'affected_order_count', v_affected_order_count,
          'dropped_dates', to_jsonb(v_dropped_ordinals)
        );
      END IF;
    END IF;
  END IF;

  -- 4d. Inclusions check — dropped inclusion keys with sales
  IF p_patch ? 'inclusions' THEN
    SELECT array_agg(kind || ':' || item)
      INTO v_existing_inclusion_keys
      FROM public.trip_inclusions
      WHERE event_id = p_event_id;
    SELECT array_agg((i->>'kind') || ':' || (i->>'item'))
      INTO v_new_inclusion_keys
      FROM jsonb_array_elements(p_patch->'inclusions') i;
    v_dropped_inclusions := (
      SELECT array_agg(k)
      FROM unnest(v_existing_inclusion_keys) k
      WHERE k <> ALL (v_new_inclusion_keys)
    );
    IF array_length(v_dropped_inclusions, 1) > 0 THEN
      SELECT COUNT(*) INTO v_affected_order_count
        FROM public.orders
        WHERE event_id = p_event_id
          AND payment_status NOT IN ('failed', 'cancelled');
      IF v_affected_order_count > 0 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'inclusions_removed_with_sales',
          'affected_order_count', v_affected_order_count,
          'dropped_inclusions', to_jsonb(v_dropped_inclusions)
        );
      END IF;
    END IF;
  END IF;

  -- 4e. Pricing tier checks — tier_delete_with_sales, tier_price_change_with_sales
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_tier IN
      SELECT tpt.id, tpt.ticket_type_id, tt.price_cents
      FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
      WHERE tpt.event_id = p_event_id
    LOOP
      -- Look up matching tier in patch by ticket_type_id
      SELECT t INTO v_new_tier
        FROM jsonb_array_elements(p_patch->'pricing_tiers') t
       WHERE (t->>'ticket_type_id')::uuid = v_tier.ticket_type_id;

      IF v_new_tier IS NULL THEN
        -- Tier deleted
        IF (v_sold_by_tier->>v_tier.ticket_type_id::text)::int > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_delete_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      ELSIF v_new_tier ? 'price_cents'
            AND (v_new_tier->>'price_cents')::int <> v_tier.price_cents THEN
        -- Tier price changed
        IF (v_sold_by_tier->>v_tier.ticket_type_id::text)::int > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_price_change_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ---------- 5. Apply patch ----------
  -- 5a. events row update (title, description, theme, cover_media_*)
  IF p_patch ?| ARRAY['title','description','theme','cover_media_url','cover_media_type',
                      'cover_media_provider','cover_media_source_url',
                      'cover_media_credit','cover_media_credit_url','cover_media_alt'] THEN
    UPDATE public.events SET
      title = COALESCE(p_patch->>'title', title),
      description = CASE WHEN p_patch ? 'description'
                         THEN p_patch->>'description' ELSE description END,
      theme = CASE WHEN p_patch ? 'theme'
                   THEN theme || (p_patch->'theme') ELSE theme END,
      cover_media_url = CASE WHEN p_patch ? 'cover_media_url'
                              THEN NULLIF(p_patch->>'cover_media_url','')
                              ELSE cover_media_url END,
      cover_media_type = CASE WHEN p_patch ? 'cover_media_type'
                               THEN NULLIF(p_patch->>'cover_media_type','')
                               ELSE cover_media_type END,
      cover_media_provider = CASE WHEN p_patch ? 'cover_media_provider'
                                   THEN NULLIF(p_patch->>'cover_media_provider','')
                                   ELSE cover_media_provider END,
      cover_media_source_url = CASE WHEN p_patch ? 'cover_media_source_url'
                                     THEN NULLIF(p_patch->>'cover_media_source_url','')
                                     ELSE cover_media_source_url END,
      cover_media_credit = CASE WHEN p_patch ? 'cover_media_credit'
                                 THEN NULLIF(p_patch->>'cover_media_credit','')
                                 ELSE cover_media_credit END,
      cover_media_credit_url = CASE WHEN p_patch ? 'cover_media_credit_url'
                                     THEN NULLIF(p_patch->>'cover_media_credit_url','')
                                     ELSE cover_media_credit_url END,
      cover_media_alt = CASE WHEN p_patch ? 'cover_media_alt'
                              THEN NULLIF(p_patch->>'cover_media_alt','')
                              ELSE cover_media_alt END,
      updated_at = now()
    WHERE id = p_event_id;
  END IF;

  -- 5b. trip_days upsert + delete
  IF p_patch ? 'days' THEN
    -- Delete dropped days
    DELETE FROM public.trip_days
      WHERE event_id = p_event_id
        AND ordinal = ANY (v_dropped_ordinals);
    -- Upsert kept/new days
    INSERT INTO public.trip_days (event_id, ordinal, title, narrative)
      SELECT p_event_id,
             (d->>'ordinal')::int,
             d->>'title',
             NULLIF(d->>'narrative', '')
        FROM jsonb_array_elements(p_patch->'days') d
      ON CONFLICT (event_id, ordinal)
      DO UPDATE SET title = EXCLUDED.title, narrative = EXCLUDED.narrative;
  END IF;

  -- 5c. trip_inclusions upsert + delete
  IF p_patch ? 'inclusions' THEN
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    INSERT INTO public.trip_inclusions (event_id, kind, item, ordinal)
      SELECT p_event_id, i->>'kind', i->>'item', (i->>'ordinal')::int
        FROM jsonb_array_elements(p_patch->'inclusions') i;
  END IF;

  -- 5d. trip_pricing_tiers upsert (tier name + tier_metadata)
  -- ticket_types row updated for price_cents + quantity changes (only when
  -- no-sale guard already cleared above).
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_new_tier IN
      SELECT * FROM jsonb_array_elements(p_patch->'pricing_tiers')
    LOOP
      UPDATE public.trip_pricing_tiers SET
        tier_name = COALESCE(v_new_tier->>'tier_name', tier_name),
        tier_metadata = COALESCE(v_new_tier->'tier_metadata', tier_metadata)
      WHERE ticket_type_id = (v_new_tier->>'ticket_type_id')::uuid
        AND event_id = p_event_id;

      IF v_new_tier ? 'price_cents' THEN
        UPDATE public.ticket_types SET
          price_cents = (v_new_tier->>'price_cents')::int
        WHERE id = (v_new_tier->>'ticket_type_id')::uuid;
      END IF;
    END LOOP;
  END IF;

  -- ---------- 6. Compute changed_keys + severity + diff_summary ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_patch));

  -- Severity: material if any of MATERIAL_KEYS changed; else additive
  IF v_changed_keys && ARRAY['theme', 'days', 'inclusions', 'pricing_tiers']::text[]
     OR (p_patch ? 'theme' AND v_new_business_trip ?| ARRAY['startAt','endAt',
                                                            'destinationLocationText','capacity']) THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  v_diff_summary := jsonb_build_object(
    'changed_keys', to_jsonb(v_changed_keys),
    'dropped_day_ordinals', to_jsonb(v_dropped_ordinals),
    'dropped_inclusions', to_jsonb(v_dropped_inclusions)
  );

  -- ---------- 7. Insert trip_edit_log row ----------
  INSERT INTO public.trip_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_event.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    v_diff_summary,
    (SELECT COALESCE(array_agg(id), '{}'::uuid[])
       FROM public.orders
       WHERE event_id = p_event_id
         AND payment_status NOT IN ('failed', 'cancelled')),
    now()
  ) RETURNING id INTO v_log_id;

  -- ---------- 8. Return success ----------
  RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text)
  TO authenticated;

COMMIT;
```

### 4.2 No other migrations

No new tables beyond `trip_edit_log`. No column adds. No RLS changes on existing tables. No index changes. The migration is atomic — apply once with `supabase db push --linked` (operator-owned action).

---

## 5. Edge function layer

**No changes. No deployments.** All trip-relevant edge functions are already live and trip-aware:

| Function | Action |
|---|---|
| `ticket-checkout-create` | UNCHANGED — `biz_ticket_checkout_create_session` RPC handles `v_is_trip` branching internally |
| `ticket-checkout-confirm` | UNCHANGED — order-id keyed, event-type-agnostic |
| `ticket-checkout-status` | UNCHANGED |

---

## 6. Service layer

### 6.1 NEW `mingla-business/src/services/publicEventsService.ts` exports

Add ALONGSIDE existing `getPublicEventById` (do NOT replace; do NOT widen):

```ts
export interface PublicTripDetail {
  trip: Trip;          // re-use existing Trip interface from tripsService
  brand: PublicTripBrand;
}

export interface PublicTripBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
}

export const getPublicTripById = async (
  tripEventId: string,
): Promise<PublicTripDetail | null> => {
  // 1. Probe events for event_type='trip' + status in scheduled/live
  const eventResp = await supabase
    .from("events")
    .select("*")
    .eq("id", tripEventId)
    .eq("event_type", "trip")
    .in("status", ["scheduled", "live"])
    .is("deleted_at", null)
    .maybeSingle();
  if (eventResp.error) throw eventResp.error;
  if (eventResp.data === null) return null;

  // 2. Fetch sidecars + brand in parallel (mirror usePublicTripBySlug:92-114)
  // ... [implementor follows usePublicTripBySlug pattern exactly]

  return { trip, brand };
};
```

### 6.2 NEW `mingla-business/src/services/tripsService.ts` exports

```ts
export interface TripCoverPatch {
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider: string | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
}

export interface LiveTripPatch {
  title?: string;
  description?: string | null;
  theme?: { business_trip?: Partial<BusinessTrip> };
  days?: TripDayInput[];
  inclusions?: TripInclusionInput[];
  pricing_tiers?: TripPricingTierInput[];
  cover_media_url?: string | null;
  cover_media_type?: EventCoverMediaType | null;
  cover_media_provider?: string | null;
  cover_media_source_url?: string | null;
  cover_media_credit?: string | null;
  cover_media_credit_url?: string | null;
  cover_media_alt?: string | null;
}

export type UpdateLiveTripRejectReason =
  | "missing_edit_reason"
  | "invalid_edit_reason"
  | "trip_not_found"
  | "trip_not_editable_status"
  | "capacity_below_sold"
  | "tier_delete_with_sales"
  | "tier_price_change_with_sales"
  | "dates_shifted_with_sales"
  | "days_dropped_with_sales"
  | "inclusions_removed_with_sales";

export type UpdateLiveTripResult =
  | { ok: true; editLogEntryId: string; severity: 'additive' | 'material'; changedKeys: string[] }
  | {
      ok: false;
      reason: UpdateLiveTripRejectReason;
      affectedOrderCount?: number;
      droppedDates?: string[];
      droppedInclusions?: string[];
    };

export async function updateLiveTripFields(
  eventId: string,
  patch: LiveTripPatch,
  reason: string,
): Promise<UpdateLiveTripResult> {
  const { data, error } = await supabase.rpc("biz_update_live_trip", {
    p_event_id: eventId,
    p_patch: patch as Record<string, unknown>,
    p_reason: reason,
  });
  if (error) {
    if (error.message === "event_not_a_trip"
        || error.message === "insufficient_event_permission"
        || error.message === "authentication_required") {
      throw new Error(error.message);
    }
    throw error;
  }
  return data as UpdateLiveTripResult;
}
```

Cover-only commit during draft-publish flow continues via the existing `business_publish_trip_draft` RPC (which already accepts the 7 cover_media_* keys per migration 20260608000100). Already-published cover-only commits flow through `updateLiveTripFields` with cover_media_*-only patch.

### 6.3 NEW `mingla-business/src/utils/tripAdapter.ts`

Mirror `liveEventAdapter.ts` shape with trip-specific keys:

```ts
export const FIELD_LABELS: Record<string, string> = {
  title: "Trip name",
  description: "Description",
  "theme.business_trip.startAt": "Start date",
  "theme.business_trip.endAt": "End date",
  "theme.business_trip.destinationLocationText": "Destination",
  "theme.business_trip.capacity": "Capacity",
  days: "Itinerary days",
  inclusions: "Inclusions",
  pricing_tiers: "Pricing tiers",
  cover_media_url: "Cover image",
  cover_media_type: "Cover media type",
  // ...
};

// MATERIAL = NOTIFY BUYERS (banner + email + SMS-if-web-purchases)
export const MATERIAL_KEYS: ReadonlyArray<string> = [
  "theme.business_trip.startAt",
  "theme.business_trip.endAt",
  "theme.business_trip.destinationLocationText",
  "theme.business_trip.capacity",
  "days",  // when count changes (add/remove); same-count same-narrative is additive
  "inclusions",  // when items removed; additions are additive
  "pricing_tiers",  // when tier price changes; tier_name + tier_metadata-only is additive
];

// SAFE = log only (banner + email, no SMS)
export const SAFE_KEYS: ReadonlyArray<string> = [
  "title",
  "description",
  "cover_media_url",
  "cover_media_type",
  "cover_media_provider",
  "cover_media_source_url",
  "cover_media_credit",
  "cover_media_credit_url",
  "cover_media_alt",
];

export const classifyTripSeverity = (
  patch: LiveTripPatch,
  diff: TripPatchDiff,
): 'additive' | 'material' => {
  // Inspects WHICH PARTS of days/inclusions/pricing_tiers changed
  // to refine severity beyond raw key match. E.g.:
  //   days narrative-only edit (same ordinal count) → additive
  //   days count add/remove → material
  //   inclusions add → additive; remove → material
  //   tier name edit → additive; tier price edit → material
  // ...
};

export interface TripDayDiff { ordinal: number; oldTitle: string | null; newTitle: string | null; oldNarrative: string | null; newNarrative: string | null; status: 'added' | 'removed' | 'modified'; }
export interface TripInclusionDiff { key: string; oldKind: string | null; newKind: string | null; oldItem: string | null; newItem: string | null; status: 'added' | 'removed' | 'modified'; }
export interface TripPricingTierDiff { ticketTypeId: string; oldName: string | null; newName: string | null; oldPriceCents: number | null; newPriceCents: number | null; status: 'added' | 'removed' | 'modified'; }

export const computeTripDayDiffs = (old: TripDay[], next: TripDayInput[]): TripDayDiff[] => { /* ... */ };
export const computeTripInclusionDiffs = (old: TripInclusion[], next: TripInclusionInput[]): TripInclusionDiff[] => { /* ... */ };
export const computeTripPricingTierDiffs = (old: TripPricingTier[], next: TripPricingTierInput[]): TripPricingTierDiff[] => { /* ... */ };

export interface TripFieldDiff {
  fieldKey: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  severity: 'additive' | 'material';
}

export const computeRichTripFieldDiffs = (oldTrip: Trip, newPatch: LiveTripPatch): TripFieldDiff[] => { /* ... */ };

export const editableTripToPatch = (oldTrip: Trip, editedDraft: TripEditDraft): LiveTripPatch => { /* mirror editableDraftToPatch */ };

export const tripToEditableDraft = (t: Trip): TripEditDraft => { /* mirror liveEventToEditableDraft */ };
```

### 6.4 NEW `mingla-business/src/utils/publishedTripEditGuards.ts`

Pre-flight client-side guard (mirrors `publishedEventEditGuards.validateLiveEventFieldUpdate`). Note: the RPC is canonical; the client guard is a UX-fast-path that prevents the RPC call when the operator's intent is clearly destructive (so we don't wait 800ms on a roundtrip for a rejection we can predict).

```ts
export const validateLiveTripFieldUpdate = (
  trip: Trip,
  patch: LiveTripPatch,
  soldCountByTier: Record<string, number>,
  hasConfirmedOrders: boolean,
  reason: string,
): { ok: true; trimmedReason: string } | { ok: false; reason: UpdateLiveTripRejectReason; affectedOrderCount?: number; droppedDates?: string[] } => {
  // Mirror logic in biz_update_live_trip §4 (capacity, dates, days, inclusions, tiers)
  // Returns same shape — implementor mirrors the RPC's checks for client-side preview
};
```

### 6.5 NEW `mingla-business/src/services/tripChangeNotifier.ts`

Mirror `eventChangeNotifier.ts` shape — TRANSITIONAL email + SMS stubs, banner via DB-side `trip_edit_log` read, push DEFERRED.

```ts
export interface TripNotificationPayload {
  eventId: string;
  tripTitle: string;
  brandName: string;
  brandSlug: string;
  tripSlug: string;
  reason: string;
  severity: 'additive' | 'material';
  changedKeys: string[];
  affectedOrderIds: string[];
  occurredAt: string;
}

export interface NotificationChannelFlags {
  banner: boolean;   // always true — DB log row IS the banner data source
  email: boolean;
  sms: boolean;
  push: boolean;
}

export const deriveTripChannelFlags = (
  severity: 'additive' | 'material',
  hasWebPurchaseOrders: boolean,
): NotificationChannelFlags => ({
  banner: true,
  email: true,
  sms: severity === 'material' && hasWebPurchaseOrders,
  push: false, // DEFERRED — consumer app integration
});

export const notifyTripChanged = async (
  payload: TripNotificationPayload,
  flags: NotificationChannelFlags,
): Promise<void> => {
  // TRANSITIONAL — console.log stubs for email + SMS until B-cycle wires
  // real Resend / Twilio.
  if (flags.email) {
    console.info('[tripChangeNotifier] email stub', composeTripEmailPayload(payload));
  }
  if (flags.sms) {
    console.info('[tripChangeNotifier] sms stub', composeTripSmsPayload(payload));
  }
  // banner: no-op — banner data comes from trip_edit_log table read by buyer-side
  // push: no-op — DEFERRED
};
```

### 6.6 Audit-test extension at `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts`

Add 3 new clauses in the existing `describe("ORCH-0859 REWORK 3 — events_type filter audit (trip-only defensive)")` block:

```ts
test("publicEventsService.getPublicTripById pins event_type='trip'", () => {
  const fn = PUBLIC_EVENTS.match(/getPublicTripById[^]*?^\};/m);
  expect(fn).not.toBeNull();
  expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"trip"\)/);
});

test("tripsService.updateLiveTripFields routes through biz_update_live_trip RPC (event_type enforced server-side)", () => {
  const TRIPS = read("services/tripsService.ts");
  const fn = TRIPS.match(/updateLiveTripFields[^]*?^\}/m);
  expect(fn).not.toBeNull();
  expect(fn?.[0]).toMatch(/rpc\(["']biz_update_live_trip["']/);
});

test("biz_update_live_trip RPC body enforces event_type='trip'", () => {
  // Read the migration SQL source
  const migrations = readMigrationContaining("biz_update_live_trip");
  expect(migrations).not.toBeNull();
  expect(migrations).toMatch(/v_event\.event_type\s*<>\s*['"]trip['"]/);
  expect(migrations).toMatch(/RAISE EXCEPTION ['"]event_not_a_trip['"]/);
});
```

---

## 7. Hook layer

### 7.1 NEW `mingla-business/src/hooks/usePublicTripById.ts`

Mirror `usePublicEventById` shape (already documented in v1 SPEC §7.1; preserved):

```ts
const publicTripKeys = {
  detailById: (id: string) => ["public-trips", "detail-by-id", id] as const,
};

export const usePublicTripById = (tripEventId: string | null): UseQueryResult<PublicTripDetail | null> => {
  const enabled = tripEventId !== null && tripEventId.length > 0;
  return useQuery<PublicTripDetail | null>({
    queryKey: enabled ? publicTripKeys.detailById(tripEventId) : DISABLED_KEY,
    enabled,
    staleTime: 60 * 1000,
    queryFn: () => enabled ? getPublicTripById(tripEventId) : Promise.resolve(null),
  });
};
```

### 7.2 NEW `mingla-business/src/hooks/useTrips.ts` (append)

```ts
export const useUpdateLiveTripFields = () =>
  useMutation({
    mutationFn: async (input: { eventId: string; patch: LiveTripPatch; reason: string }) =>
      updateLiveTripFields(input.eventId, input.patch, input.reason),
    onSuccess: (result, vars) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: tripKeys.byId(vars.eventId) });
        queryClient.invalidateQueries({ queryKey: ["public-trips", "detail-by-id", vars.eventId] });
        queryClient.invalidateQueries({ queryKey: ["public-trips", "detail-by-slug"] });
      }
    },
  });
```

### 7.3 NEW `mingla-business/src/hooks/useTripHasWebPurchases.ts`

Mirror `useEventHasWebPurchases`. Calls `biz_trip_has_web_purchases` RPC.

```ts
export const useTripHasWebPurchases = (tripEventId: string | null): boolean => {
  const query = useQuery<boolean>({
    queryKey: ["trips", "has-web-purchases", tripEventId],
    enabled: tripEventId !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (tripEventId === null) return false;
      const { data, error } = await supabase.rpc("biz_trip_has_web_purchases",
        { p_event_id: tripEventId });
      if (error) throw error;
      return data === true;
    },
  });
  return query.data ?? false;
};
```

### 7.4 NEW `mingla-business/src/hooks/useTripEditLog.ts` (optional reader)

```ts
export const useTripEditLog = (tripEventId: string | null, limit = 20) =>
  useQuery<TripEditLogEntry[]>({
    queryKey: ["trip-edit-log", tripEventId, limit],
    enabled: tripEventId !== null,
    queryFn: async () => {
      if (tripEventId === null) return [];
      const { data, error } = await supabase
        .from("trip_edit_log")
        .select("*")
        .eq("event_id", tripEventId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as TripEditLogEntry[];
    },
  });
```

---

## 8. Route layer

### 8.1 MODIFIED `mingla-business/app/trip/[id]/edit.tsx`

Replace the current always-render-wizard logic with status-based dispatch:

```tsx
// trip status: 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled'
if (trip.status === 'draft') {
  return <TripCreatorWizard {...wizardProps} />;
}
if (trip.status === 'scheduled' || trip.status === 'live') {
  return <EditPublishedTripScreen liveTrip={trip} />;
}
// status === 'ended' or 'cancelled' — read-only
return (
  <View style={styles.host}>
    <Text style={styles.title}>This trip can't be edited</Text>
    <Text style={styles.body}>
      {trip.status === 'ended'
        ? 'This trip has ended.'
        : 'This trip was cancelled.'}
    </Text>
    <Button label="Back" onPress={() => router.back()} />
  </View>
);
```

### 8.2 NEW `mingla-business/app/checkout-trip/[tripEventId]/_layout.tsx`

Mirror `app/checkout/[eventId]/_layout.tsx` exactly. Same CartContext provider wrap. Same stack screens config. No `useAuth`. No sign-in redirect. Buyer-anon-tolerant per `feedback_anon_buyer_routes.md`.

### 8.3 NEW `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`

Mirror `app/checkout/[eventId]/index.tsx` end-to-end with these substitutions:
- `usePublicEventById` → `usePublicTripById`
- `event` → `trip` (PublicTripPayload shape)
- Title `"Get tickets"` → `"Reserve your spot"`
- Empty state `"Event not found"` → `"Trip not found"` / `"This trip link may be expired or moved."`
- Back-nav fallback `eventPublicPath` → new `tripPublicPath` helper at `src/constants/publicUrls.ts`
- Tier source `event.tickets` → `trip.pricingTiers`
- Past-gate `isEventPast` → new `isTripPast(trip)` 3-line inline helper using `trip.businessTrip.endAt`
- Continue button: `router.push(\`/checkout-trip/${tripEventId}/buyer\`)`
- SafeArea allowlist comment block at top mirroring `/checkout/[eventId]/index.tsx:17`

### 8.4 NEW `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx`, `payment.tsx`, `confirm.tsx`

Same mirror pattern with `usePublicEventById → usePublicTripById` swap.

- `payment.tsx`: invokes `biz_ticket_checkout_create_session` RPC — RPC's `v_is_trip` branching handles installment vs single-payment automatically.
- `confirm.tsx`: shows confirmation + ticket QR + share + receipt; will host Tr4 [ORCH-0875] buyer-cancel CTA AFTER Tr4 amends its SPEC post-v2-CLOSE. Implementor MUST NOT scaffold the cancel CTA in this SPEC.

### 8.5 publicUrls helper extension

Add to `mingla-business/src/constants/publicUrls.ts`:

```ts
export const tripCheckoutPath = (tripEventId: string): string =>
  `/checkout-trip/${tripEventId}`;

export const tripPublicPath = (args: { brandSlug: string; tripSlug: string }): string =>
  `/t/${args.brandSlug}/${args.tripSlug}`;
```

---

## 9. Component layer

### 9.1 NEW `mingla-business/src/components/ui/CoverPicker.tsx`

Shared 3-provider picker extracted from `CreatorStep4Cover.tsx`. Used by trip Step 1 Basics + EditPublishedTripScreen Cover section + (refactored) events' CreatorStep4Cover.

```ts
export interface CoverPickerProps {
  brandId: string;
  eventRowId: string;  // events-table row id; works for trips (shared events table)
  initialMediaUrl: string | null;
  initialMediaType: EventCoverMediaType | null;
  initialProvider: string | null;
  initialSourceUrl: string | null;
  initialCredit: string | null;
  initialCreditUrl: string | null;
  initialAlt: string | null;
  onCoverChange: (cover: TripCoverPatch | EventCoverPatch) => void | Promise<void>;
  onShowToast: (msg: string) => void;
  providers?: ReadonlyArray<"upload" | "giphy" | "pexels">;  // default: all 3
  disabled?: boolean;
  /** When true, picker omits the in-line preview (consumer renders its own).
   *  Used by EditPublishedTripScreen Cover section which wants section chrome. */
  hidePreview?: boolean;
  /** When provided, picker calls this instead of onCoverChange after upload
   *  completes — used for already-published trips that need immediate commit
   *  via updateLiveTripFields without going through full save flow. */
  onImmediateCoverCommit?: (cover: TripCoverPatch) => Promise<void>;
}
```

Refactor steps:
1. Extract lines 119-230 (ImagePicker handler), 213-217 (GIPHY/Pexels search), 167-181 (upload via `uploadEventCoverMedia`), 290-298 (results union memo), 354-379 (provider tabs UI), 401-432 (search results render) from `CreatorStep4Cover.tsx` into `CoverPicker.tsx`.
2. `CreatorStep4Cover.tsx` becomes a thin wrapper that maps `draft.coverMediaUrl/Type/Provider/etc.` to `<CoverPicker>` props and re-emits `updateDraft(coverPatch)` via `onCoverChange`.
3. Trip Step 1 Basics + EditPublishedTripScreen Cover section both render `<CoverPicker>` directly with appropriate prop wiring.

### 9.2 NEW `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`

~1,000-1,200 lines mirroring `EditPublishedScreen.tsx` structure verbatim. Section config:

```ts
type SectionKey = "basics" | "itinerary" | "inclusions" | "pricing" | "cover" | "settings";

const SECTIONS: readonly SectionConfig[] = [
  { key: "basics", label: "Basics", stepIndex: 0 },        // title, dates, destination, capacity
  { key: "itinerary", label: "Itinerary", stepIndex: 1 },  // trip_days
  { key: "inclusions", label: "Inclusions", stepIndex: 2 },// trip_inclusions
  { key: "pricing", label: "Pricing", stepIndex: 3 },      // trip_pricing_tiers + ticket_types.price_cents
  { key: "cover", label: "Cover", stepIndex: 4 },          // cover_media_*
  { key: "settings", label: "Settings", stepIndex: 5 },    // (currently minimal — trip has no visibility/passwordProtected/etc.; section is placeholder for future)
];
```

Mirror these EditPublishedScreen behaviors exactly:
- Local edit state (`useState<TripEditDraft>`)
- Currently expanded section (only one open at a time)
- Section toggle handler
- Per-section validation (`validateTripStep(stepIndex, draft)`)
- `editedSectionKeys` set computed from diffs
- Sticky bottom "Save changes" button (hidden when keyboard up)
- Keyboard handling (Cycle 3 wizard root pattern — Keyboard listeners + dynamic paddingBottom + scrollToEnd)
- 800ms artificial processing delay + 600ms post-toast nav delay
- ChangeSummaryModal mount with diffs + ticket-equivalent (tripDayDiffs + tripInclusionDiffs + tripPricingTierDiffs) + severity + webPurchasePresent + reason input
- Refund-first reject dialog with 8 reason variants → "Open Orders" CTA routing to `/trip/{id}#orders`
- Toast (absolute-positioned wrap per `feedback_toast_needs_absolute_wrap.md`)
- Chrome row: IconChrome close + "Edit trip" title
- EditAfterPublishTripBanner at top of scroll content
- `useCurrentBrandRole` + `canPerformAction(currentRank, "EDIT_TICKET_PRICE")` permission gate on pricing tier price field (mirror `EditPublishedScreen.tsx:327-328`)
- Section body renderer reuses TripCreatorStep1-4 components with `editMode={{ soldCountByTier }}` prop (extended interface — see §9.3)
- SafeArea allowlist comment at top mirroring EditPublishedScreen pattern
- On Save tap: validate sections → if errors, expand first errored + toast "Fix the highlighted issues first." → compute patch via `editableTripToPatch` → if empty, toast "No changes to save." → run client-side `validateLiveTripFieldUpdate` (UX fast-path) → if rejection, open reject dialog → else compute ticket+day+inclusion+pricing diffs + severity → open ChangeSummaryModal
- On Modal confirm with reason: call `useUpdateLiveTripFields` mutation → if ok=false (server-side guard caught something client missed), open reject dialog with server reason → if ok=true, fire `notifyTripChanged({...}, deriveTripChannelFlags(severity, hasWebPurchases))` → toast "Saved. Live now." → router.back after 600ms

### 9.3 NEW `mingla-business/src/components/trip/EditAfterPublishTripBanner.tsx`

Mirror `EditAfterPublishBanner.tsx` with trip-specific copy:

```tsx
<View style={styles.host}>
  <View style={styles.iconBadge}>
    <Icon name="flag" size={18} color={accent.warm} />
  </View>
  <View style={styles.textCol}>
    <Text style={styles.heading}>You're editing a live trip</Text>
    <Text style={styles.body}>
      Changes save immediately. Existing travelers stay protected — their
      reservations and prices won't change. Material changes (dates,
      destination, capacity, itinerary, inclusions, tier prices) notify
      your travelers via email + SMS. Destructive changes (drop capacity
      below sold, delete tier with sales, drop days, shift dates, remove
      inclusions) require refunding existing buyers first.
    </Text>
  </View>
</View>
```

### 9.4 MODIFIED `mingla-business/src/components/event/ChangeSummaryModal.tsx`

Add backward-compatible props for trip diffs:

```ts
interface ChangeSummaryModalProps {
  visible: boolean;
  diffs: FieldDiff[];                  // generic — works for events + trips
  ticketDiffs?: TicketDiff[];          // events only
  tripDayDiffs?: TripDayDiff[];        // NEW — trips only
  tripInclusionDiffs?: TripInclusionDiff[];  // NEW — trips only
  tripPricingTierDiffs?: TripPricingTierDiff[];  // NEW — trips only
  severity: EditSeverity;
  webPurchasePresent: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  submitting?: boolean;
}
```

Generalize the diff-row renderer: when `diff.fieldKey === 'tickets'` AND `ticketDiffs` provided → render TicketsDiffSubRenderer; when `diff.fieldKey === 'days'` AND `tripDayDiffs` provided → render NEW `TripDaysDiffSubRenderer`; when `diff.fieldKey === 'inclusions'` AND `tripInclusionDiffs` provided → render NEW `TripInclusionsDiffSubRenderer`; when `diff.fieldKey === 'pricing_tiers'` AND `tripPricingTierDiffs` provided → render NEW `TripPricingTierDiffSubRenderer`.

Add 3 new sub-renderers mirroring `TicketsDiffSubRenderer`'s structure. Add 3 new style entries. No other behavior change. Existing event-side consumers (`EditPublishedScreen.tsx`) work unchanged because the new props are optional.

### 9.5 MODIFIED `mingla-business/src/components/trip/TripCreatorWizard.tsx`

Four discrete changes (v1 spec preserved):

#### 9.5.a — `handleStepBack` await autosave

Mirror v1 spec §9.2.a exactly. `handleStepBack` becomes async, awaits `autosaveCurrentStep()` before step decrement. Failure does not block back (operator may need to back out because save is failing).

#### 9.5.b — `handleClose` edit-mode await autosave

Mirror v1 spec §9.2.b exactly. In edit mode (`isCreateMode === false`), await `autosaveCurrentStep()` before exit. Create-mode discard dialog from ORCH-0874 preserved unchanged.

#### 9.5.c — `handleConfirmPublish` cover payload extension

Extend `draftPayload` at lines 578-592 with 7 cover_media_* fields when set. Mirror v1 spec §9.2.c exactly.

#### 9.5.d — "Saved" toast on autosave success

`useEffect` watching `autosaveSavedAt` surfaces 1.5s "Saved" toast. Suppressed during `publishMutation.isPending`. Mirror v1 spec §9.2.d exactly. Toast wrapped in absolute-positioned View per `feedback_toast_needs_absolute_wrap.md`.

### 9.6 MODIFIED `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`

Add cover field at top of step (above title). Render via shared `<CoverPicker>`:

```tsx
<CoverPicker
  brandId={trip.brandId}
  eventRowId={trip.id}
  initialMediaUrl={draft.coverMediaUrl ?? null}
  initialMediaType={draft.coverMediaType ?? null}
  initialProvider={draft.coverMediaProvider ?? null}
  initialSourceUrl={draft.coverMediaSourceUrl ?? null}
  initialCredit={draft.coverMediaCredit ?? null}
  initialCreditUrl={draft.coverMediaCreditUrl ?? null}
  initialAlt={draft.coverMediaAlt ?? null}
  providers={["upload", "giphy", "pexels"]}
  onCoverChange={(cover) => onCoverChange(cover)}
/>
```

Extend Step1Draft interface with the 7 cover_media_* keys. Extend TripCreatorStep1BasicsProps with `coverMediaUrl`, `coverMediaType`, etc. + `onCoverChange: (cover: TripCoverPatch) => void`.

### 9.7 MODIFIED `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx`, `TripCreatorStep3Inclusions.tsx`, `TripCreatorStep4Pricing.tsx`

Extend each Props interface with optional `editMode?: { soldCountByTier: Record<string, number> }`. When `editMode` is provided (only by EditPublishedTripScreen accordion mount, NEVER by TripCreatorWizard), Step 4 Pricing renders price field as read-only with helper text "X travelers paid this price — refund all before changing" when `soldCountByTier[ticketTypeId] > 0`. Delete-tier button hidden when tier has sales. Capacity decrement validates inline against `soldCountByTier`.

### 9.8 MODIFIED `mingla-business/src/components/trip/TripCheckoutFlow.tsx:59-62`

```ts
// ORCH-0876: trip-specific chain; event-side hard-rejects trips by audit-test invariant
const handleReserve = (): void => {
  router.push(`/checkout-trip/${trip.id}` as never);
};
```

Update file-header comment at lines 5-13.

### 9.9 MODIFIED `mingla-business/src/components/event/CreatorStep4Cover.tsx`

Replace lines 119-230 + 213-217 + 167-181 + 290-298 + 354-379 + 401-432 (the picker logic) with delegation to shared `<CoverPicker>` component. CreatorStep4Cover becomes a thin wrapper passing through draft state. Existing event tests `mingla-business/src/components/event/__tests__/*` cover behavior (verify no regression).

### 9.10 No changes to other components

Unchanged: TripPreview.tsx, TripDayEditor.tsx, PaymentPlanEditor.tsx, TripManageMenu.tsx, TripCreatorStep5Review.tsx, EventCoverMedia.tsx, EventCreatorWizard.tsx, EditAfterPublishBanner.tsx (events keep their own banner; trips get new), EditPublishedScreen.tsx (event-side preserved), event-side CreatorStep1-3 + 5-6 (unchanged).

---

## 10. Realtime layer

N/A — no realtime channels touched. The `useTripEditLog` hook polls via React Query staleTime; live updates from other operators in the same brand are out of scope (follow-up ORCH if multi-operator concurrent edit becomes an issue).

---

## 11. Success criteria

### S-1 (draft-wizard Save polish — 6 SCs, preserved from v1)
- SC-1.1 — Edit mode `handleStepBack` awaits autosave before decrement; mutation fires; step state decrements AFTER.
- SC-1.2 — Edit mode `handleClose` awaits autosave before exit. Create-mode-dirty discard dialog from ORCH-0874 preserved.
- SC-1.3 — Successful autosave surfaces 1.5s "Saved" Toast wrapped in absolute-positioned View. Suppressed during publish.
- SC-1.4 — Save NEVER calls `business_publish_trip_draft` for already-published trips. Only `useUpdateTripBasics`/`useUpsertTripDays`/`useUpsertTripInclusions`/`useUpdateTripPricing` are called.
- SC-1.5 — Save failure surfaces "Couldn't save. Tap to retry." toast; existing autosave-error subtitle "Unsaved changes — retrying" preserved at TripCreatorWizard.tsx:619; wizard does not exit on autosave-failure unless user explicitly tapped X.
- SC-1.6 — Field-blur debounced autosave DEFERRED to follow-up ORCH if operator dogfooding shows trust gap.

### S-2 (Cover — 8 SCs, full 3-provider parity)
- SC-2.1 — TripCreatorStep1Basics renders Cover field at top of step (above title) via shared `<CoverPicker>`.
- SC-2.2 — Tap upload tab → ImagePicker.launchImageLibraryAsync → upload via `uploadEventCoverMedia` → `onCoverChange` fires with 7-field patch.
- SC-2.3 — Tap GIPHY tab → search input → 12 results render → pick → `onCoverChange` fires with provider='giphy' + sourceUrl + credit.
- SC-2.4 — Tap Pexels tab → search input → 12 results render → pick → `onCoverChange` fires with provider='pexels' + sourceUrl + credit + creditUrl.
- SC-2.5 — TripCreatorWizard `handleConfirmPublish` extends draftPayload with 7 cover_media_* fields when set. Verify: spy on `publishTrip`; publish with cover; assert draftPayload contains all 7 keys.
- SC-2.6 — Cover edit on published trip routes through `updateLiveTripFields` (NOT publish RPC). Verify: in EditPublishedTripScreen Cover section, change cover; spy on `publishTrip` (NOT called) + `updateLiveTripFields` (called with cover_media_*-only patch). "Saved. Live now." toast surfaces.
- SC-2.7 — Public trip page renders cover via existing `usePublicTripBySlug.ts:139-140` read of `event.cover_media_url` + `event.cover_media_type`. No public-page code change required.
- SC-2.8 — Event-side cover behavior preserved. `CreatorStep4Cover.tsx` refactor to consume shared `<CoverPicker>` introduces zero regression in event-side cover flow. Verified by event-side test re-run.

### S-3 (Reserve route — 12 SCs, preserved from v1)
- SC-3.1 — `TripCheckoutFlow.handleReserve` routes to `/checkout-trip/${trip.id}`.
- SC-3.2 — `/checkout-trip/[tripEventId]/index.tsx` mounts and calls `usePublicTripById`. Trip-specific copy.
- SC-3.3 — `getPublicTripById` pins `event_type='trip'` + status in `['scheduled','live']` + `deleted_at IS NULL`. Audit test asserts.
- SC-3.4 — Tickets screen renders `trip.pricingTiers` as QuantityRow entries. Title "Reserve your spot."
- SC-3.5 — `/checkout-trip/{tripEventId}/buyer.tsx` collects buyer info; Continue routes to payment.
- SC-3.6 — `/checkout-trip/{tripEventId}/payment.tsx` invokes `biz_ticket_checkout_create_session` RPC; installment-aware via `v_is_trip` branch.
- SC-3.7 — `/checkout-trip/{tripEventId}/confirm.tsx` shows confirmation + ticket QR + share + receipt. Tr4 cancel CTA host (post-Tr4-amendment).
- SC-3.8 — Adversarial: `/checkout/{tripEventId}` STILL renders "Event not found" (audit invariant preserved).
- SC-3.9 — All `/checkout-trip/[tripEventId]/*` are buyer-anon (no useAuth, no sign-in redirect).
- SC-3.10 — All `/checkout-trip/[tripEventId]/*` carry strict-grep-allow safearea-on-fullscreen-routes comment.
- SC-3.11 — Trip-not-found, past-trip, sold-out, zero-tier empty states render trip-specific copy.
- SC-3.12 — Bookings-closed state (post-Tr4 amendment): the `/checkout-trip/[tripEventId]/index.tsx` is the destination for Tr4's "Bookings closed" 403 banner. v2 spec does NOT implement this banner — Tr4 amendment ships it.

### S-4 (Published-trip edit — 20 SCs, NEW full parity)

#### S-4 routing + screen mount
- SC-4.1 — `app/trip/[id]/edit.tsx` dispatches by `trip.status`: draft → TripCreatorWizard; scheduled OR live → EditPublishedTripScreen; ended OR cancelled → read-only empty state.
- SC-4.2 — EditPublishedTripScreen mounts with 6 sections in this order: Basics, Itinerary, Inclusions, Pricing, Cover, Settings. Only one open at a time. Basics open by default.

#### S-4 section behavior
- SC-4.3 — "Edited" badge appears on section header when any field in that section differs from initial liveTrip.
- SC-4.4 — "Fix" badge appears on section header when section has validation errors AND user has attempted Save.
- SC-4.5 — Tapping section header toggles expand/collapse; expanding closes any other open section.
- SC-4.6 — Section bodies reuse TripCreatorStep1Basics / TripCreatorStep2Itinerary / TripCreatorStep3Inclusions / TripCreatorStep4Pricing components with `editMode={{ soldCountByTier }}` prop.
- SC-4.7 — Cover section renders shared `<CoverPicker>` directly (not via a CreatorStepN component — trips don't have a dedicated Step 4 Cover wizard step).
- SC-4.8 — Pricing section: tier price field is read-only when `soldCountByTier[ticketTypeId] > 0`; helper text "X travelers paid this price — refund first" displayed; Delete-tier button hidden; capacity decrement validates inline.
- SC-4.9 — Pricing section: tier price field is read-only when current user does NOT have `EDIT_TICKET_PRICE` permission (rank < finance_manager).

#### S-4 Save flow
- SC-4.10 — "Save changes" button at sticky bottom dock (hidden when keyboard up). Enabled iff non-empty patch + no validation errors + not currently submitting.
- SC-4.11 — Tap Save → if validation errors, expand first-errored section + toast "Fix the highlighted issues first." → return.
- SC-4.12 — Tap Save → if patch empty, toast "No changes to save." → return.
- SC-4.13 — Tap Save (valid + non-empty) → compute field diffs + tripDayDiffs + tripInclusionDiffs + tripPricingTierDiffs + severity → run client-side `validateLiveTripFieldUpdate` UX fast-path → if rejection, open reject dialog → return.
- SC-4.14 — Tap Save (passes client check) → open ChangeSummaryModal with all diffs + severity-driven footer copy + required reason input (10-200 chars).
- SC-4.15 — Modal "Save changes" button disabled until trimmed reason ≥ 10 chars; enabled iff 10-200 chars + not submitting.
- SC-4.16 — Modal confirm → call `useUpdateLiveTripFields` mutation with `(eventId, patch, trimmedReason)` → 800ms artificial delay → server response.
- SC-4.17 — Server `ok=true` → fire `notifyTripChanged({...}, deriveTripChannelFlags(severity, useTripHasWebPurchases))` → toast "Saved. Live now." → router.back() after 600ms.
- SC-4.18 — Server `ok=false` → open reject dialog with reason-specific copy + "Open Orders" CTA routing to `/trip/${eventId}#orders`.

#### S-4 refund-gate (8 reject reasons)
- SC-4.19 — Reject dialog reason-to-copy map: `missing_edit_reason` → "Reason needed"; `invalid_edit_reason` → "Reason needed (10-200 chars)"; `trip_not_found` → "Couldn't find this trip"; `trip_not_editable_status` → "This trip can't be edited"; `capacity_below_sold` → "X travelers booked — refund to drop below"; `tier_delete_with_sales` → "X travelers paid for this tier — refund first"; `tier_price_change_with_sales` → "X travelers paid this price — refund first or add a new tier"; `dates_shifted_with_sales` → "X travelers booked these dates — refund first"; `days_dropped_with_sales` → "X travelers booked for the full itinerary — refund before removing days"; `inclusions_removed_with_sales` → "X travelers paid expecting these inclusions — refund first".
- SC-4.20 — `ended` / `cancelled` trip status renders read-only empty state with "Back" CTA; no EditPublishedTripScreen mount.

---

## 12. Preserved invariants (Phase 5 — must NOT break)

| ID | Mechanism |
|---|---|
| Audit test `eventType.filter.audit.test.ts` (existing 8 trip-defensive clauses) | Extended with 3 NEW clauses (Q17); existing UNTOUCHED |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE | New `/checkout-trip/[tripEventId]/*` is trip-only; `/checkout/[eventId]/*` stays event-only |
| I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES | All 5 new routes + EditPublishedTripScreen carry allowlist comment |
| I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER (ORCH-0859) | Trips do NOT enter `useLiveEventStore`; `updateLiveTripFields` is server-side via RPC |
| I-PROPOSED-TR1-PERSONA-INTERFACE (ORCH-0855) | No PersonaDef widening |
| I-PROPOSED-TR1-KIND-IMMUTABLE (ORCH-0855) | No brands.kind toggle exposure |
| ORCH-0869 [Tr3 Installment Payments] 4 invariants | New `/checkout-trip/[tripEventId]/payment.tsx` calls same RPC; Tr3 branching unchanged |
| ORCH-0874 [Trip Visual Parity] chrome contract | TripCreatorWizard chrome preserved (Close X + Stepper + Keyboard + create-mode discard) |
| `feedback_anon_buyer_routes.md` | `/checkout-trip/[tripEventId]/*` is buyer-anon; EditPublishedTripScreen is operator-auth-required |
| `feedback_zustand_persist_no_server_snapshots.md` | Trip published-edit goes server-side via RPC — does NOT cache server records in Zustand |
| `feedback_toast_needs_absolute_wrap.md` | Every new "Saved" + error toast wrapped in absolute-positioned View |
| `feedback_rn_color_formats.md` | hex/rgb/hsl/hwb only (no new tokens added in this spec) |
| `feedback_rn_sub_sheet_must_render_inside_parent.md` | ChangeSummaryModal renders inside EditPublishedTripScreen — not as Fragment sibling |
| Constitution #1 (no dead taps) | Reserve CTA reaches working purchase chain (SC-3.1-3.11); Save reaches working save flow (SC-4.10-4.20) |
| Constitution #3 (no silent failures) | Every error surfaces a toast or dialog (SC-1.5, SC-2.2, SC-4.18) |
| Constitution #9 (no fabricated data) | Empty-cover state shows "Tap to add"; trip-not-found shows empty state |
| Constitution #12 (validate at right time) | Date validation uses trip timezone, not `new Date()` |
| Step 0.5 regression-test gate | 5 implementor happy-path test files + 1 tester adversarial; fails-on-revert verified |
| Step 1.5 DIAG-marker reaping | Zero `[ORCH-0876-DIAG]` matches at CLOSE |
| One-PR-per-CLOSE bundle exception | Operator pre-authorized Path A bundle; PR title cites `Close ORCH-0876` only |

---

## 13. NEW DRAFT invariants

All 9 codified in INVARIANT_REGISTRY.md at CLOSE per orchestrator Step 5e.

| ID | Statement | Verification |
|---|---|---|
| **I-PROPOSED-TR-CHECKOUT-ROUTE-BY-EVENT-TYPE** | `/checkout-trip/[...]` resolves only trips; `/checkout/[...]` resolves only events | Audit test extension + adversarial test SC-3.8 |
| **I-PROPOSED-TRIP-WIZARD-EDIT-SAVE-DISTINCT-FROM-PUBLISH** | Save commits via per-step mutations OR `biz_update_live_trip` RPC; NEVER calls `business_publish_trip_draft` | SC-1.4 spy assertion + SC-2.6 spy assertion |
| **I-PROPOSED-TRIP-COVER-EDITABLE-POST-CREATE** | Trip cover_media_* updatable on published trips without re-publish | SC-2.6 |
| **I-PROPOSED-TRIP-WIZARD-SAVE-ON-BACK-AND-CLOSE** | In edit mode, handleStepBack + handleClose await autosave before state change | SC-1.1 + SC-1.2 |
| **I-PROPOSED-TRIP-PUBLISHED-EDIT-VIA-RPC** | `updateLiveTripFields` is server-side RPC; no client Zustand intermediate | Source-grep for `useLiveTripStore` or similar returns ZERO matches |
| **I-PROPOSED-TRIP-PUBLISHED-EDIT-REASON-REQUIRED** | Every Save through EditPublishedTripScreen requires 10-200 char reason | SC-4.15 + RPC §4 char_length check + DB CHECK constraint |
| **I-PROPOSED-TRIP-PUBLISHED-EDIT-REFUND-GATE** | Destructive changes reject with "Refund first" dialog (8 reasons) | SC-4.18 + SC-4.19 |
| **I-PROPOSED-TRIP-PUBLISHED-EDIT-AUDIT-LOG** | Every successful Save inserts `trip_edit_log` row | RPC §4 §7 INSERT + SC-4.17 |
| **I-PROPOSED-TRIP-CHANGE-NOTIFICATION-CHANNELS** | Material changes fire banner + email + SMS-if-web-purchases; additive fires banner + email | SC-4.17 + `deriveTripChannelFlags` |

---

## 14. Test cases (Phase 6 — Step 0.5 gate)

### Implementor happy-path tests (5 files, fails-on-revert required)

| Path | SCs covered |
|---|---|
| `mingla-business/src/components/trip/__tests__/TripCheckoutFlow_routes.test.ts` | SC-3.1 (route literal) |
| `mingla-business/src/components/trip/__tests__/TripCreatorWizard_editSave.test.ts` | SC-1.1, SC-1.2, SC-1.3, SC-1.4, SC-1.5 (save-on-back/close + Saved toast + no-republish) |
| `mingla-business/src/components/trip/__tests__/CoverPicker.test.tsx` | SC-2.1, SC-2.2, SC-2.3, SC-2.4 (3-provider picker + upload + GIPHY + Pexels) |
| `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.test.tsx` | SC-4.1, SC-4.2, SC-4.3-4.7 (routing + section accordion + Edited badge + section body mount), SC-4.10-4.17 (Save flow happy-path), SC-2.6 (cover-edit-on-published) |
| `supabase/functions/_shared/__tests__/biz_update_live_trip.test.ts` | RPC + refund-gate — 8 rejection paths (SC-4.18, SC-4.19 — exhaustive matrix per rejection reason) |

### Tester adversarial test (1 file)

| Path | Purpose | Different angle |
|---|---|---|
| `mingla-business/app/checkout/[eventId]/__tests__/event_chain_trip_isolation.test.tsx` | SC-3.8 + new dual-direction assertion: (a) `/checkout/{tripId}` STILL renders "Event not found"; (b) `/checkout-trip/{eventId}` (real event ID) renders "Trip not found"; (c) audit test extension `getPublicTripById pins event_type='trip'` passes; (d) audit test extension `updateLiveTripFields routes through RPC` passes | Implementor tests prove what WORKS; this proves what STILL REJECTS in both directions — defense in depth against future refactors that accidentally widen either resolver |

Each test file MUST include `fails-on-revert verified at <commit hash>` in the implementation report — implementor reverts the fix at a labeled commit, runs the test, verifies FAIL; restores the fix, runs again, verifies PASS. A test that passes on both fixed and unfixed code does not exercise the bug and does NOT satisfy Step 0.5.

### Detailed test matrix (T-1..T-30)

| T | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Reserve route | tap Reserve on /t/{brand}/{trip} | `router.push('/checkout-trip/${trip.id}')` | Component + Route |
| T-02 | Trip resolver pins event_type | `getPublicTripById(<event-row-id>)` where event_type='event' | returns null | Service |
| T-03 | Trip resolver returns trip | `getPublicTripById(<trip-id>)` for scheduled/live trip | returns PublicTripPayload | Service + DB |
| T-04 | Past trip empty state | endAt < now | trip-specific empty copy | Component |
| T-05 | Sold-out empty state | all tiers capacity 0 | sold-out copy | Component |
| T-06 | Edit-back save (draft) | edit Step 3 field, tap Back | mutation fires; step decrements AFTER | Hook + Component |
| T-07 | Edit-close save (draft) | edit Step 1, tap X edit-mode | mutation fires; onExit called AFTER | Hook + Component |
| T-08 | Create-close discard (draft) | edit Step 1, tap X create-mode dirty | ConfirmDialog (ORCH-0874 preserved) | Component |
| T-09 | Saved toast | autosaveSavedAt changes | 1.5s "Saved" toast, absolute-wrapped | Component |
| T-10 | Save failure | autosaveCurrentStep throws | "Unsaved changes — retrying" subtitle + error toast | Component |
| T-11 | Save does not republish (already-published) | tap Next on already-published trip in wizard | useUpdateTrip* called; publishTrip NOT called | Component + Hook |
| T-12 | Cover render empty | trip.coverMediaUrl null | "Tap to add a cover" placeholder | Component |
| T-13 | Cover upload | pick image | uploadEventCoverMedia called; 7-field patch | Component + Service |
| T-14 | Cover GIPHY pick | search + pick | searchGiphyEventCovers called; provider=giphy + sourceUrl + credit | Component + Service |
| T-15 | Cover Pexels pick | search + pick | searchPexelsEventCovers called; provider=pexels + sourceUrl + credit + creditUrl | Component + Service |
| T-16 | Cover publish payload | publish with cover set | draftPayload has 7 cover_media_* keys | Component → Service |
| T-17 | Cover edit-on-published | change cover in EditPublishedTripScreen | updateLiveTripFields called with cover-only patch; publishTrip NOT called | Component + Hook |
| T-18 | Status-based routing — draft | trip.status='draft' | renders TripCreatorWizard | Route |
| T-19 | Status-based routing — published | trip.status='scheduled' or 'live' | renders EditPublishedTripScreen | Route |
| T-20 | Status-based routing — ended | trip.status='ended' | renders read-only empty state | Route |
| T-21 | EditPublishedTripScreen Save → ChangeSummaryModal | valid non-empty patch | modal opens with diffs + reason input | Component |
| T-22 | Reason validation | reason < 10 chars | Save button disabled; helper "Min 10 characters" | Modal |
| T-23 | Reason validation | reason > 200 chars | TextInput clamps at maxLength | Modal |
| T-24 | Refund-gate: capacity_below_sold | reduce capacity below confirmed orders count | reject dialog "X travelers booked — refund to drop below" | RPC + Component |
| T-25 | Refund-gate: tier_delete_with_sales | remove a tier with sales | reject dialog "X travelers paid for this tier — refund first" | RPC + Component |
| T-26 | Refund-gate: tier_price_change_with_sales | change tier price with sales | reject dialog "X travelers paid this price" | RPC + Component |
| T-27 | Refund-gate: days_dropped_with_sales | remove a trip_day with confirmed orders | reject dialog | RPC + Component |
| T-28 | Notification dispatch — material | save with material change + web purchases | deriveTripChannelFlags → {banner:true, email:true, sms:true, push:false} | Service |
| T-29 | Notification dispatch — additive | save with additive change only | deriveTripChannelFlags → {banner:true, email:true, sms:false, push:false} | Service |
| T-30 | Edit log insertion | successful save | trip_edit_log row inserted with reason + severity + changed_keys + affected_order_ids | DB |
| T-31 | Audit-test extension passes | run audit tests after refactor | all 11 trip-defensive clauses pass | Audit |
| T-32 | Adversarial: event chain rejects trips | /checkout/{tripId} | "Event not found" empty state | Adversarial |
| T-33 | Adversarial: trip chain rejects events | /checkout-trip/{eventId} | "Trip not found" empty state | Adversarial |

Implementor writes T-01..T-31; tester writes T-32+T-33 (consolidated into one adversarial file).

---

## 15. Implementation order (Phase 7)

Numbered sequence. Implementor follows top-to-bottom; each step builds on the prior. No reorder.

1. **SQL migration** — `supabase/migrations/<timestamp>_orch_0876_trip_published_edit.sql` per §4.1 (RPC + trip_edit_log + 2 helpers + RLS). Operator owns `supabase db push --linked`.
2. **Service layer** — `tripsService.ts` adds `updateLiveTripFields` + `TripCoverPatch` + `LiveTripPatch` + `UpdateLiveTripResult` types per §6.2. `publicEventsService.ts` adds `getPublicTripById` per §6.1. NEW `src/utils/tripAdapter.ts` per §6.3 (FIELD_LABELS, MATERIAL_KEYS, SAFE_KEYS, classifyTripSeverity, computeTripDayDiffs, computeTripInclusionDiffs, computeTripPricingTierDiffs, editableTripToPatch, tripToEditableDraft). NEW `src/utils/publishedTripEditGuards.ts` per §6.4. NEW `src/services/tripChangeNotifier.ts` per §6.5. Audit-test extension in `eventType.filter.audit.test.ts` per §6.6.
3. **Hook layer** — NEW `usePublicTripById.ts` per §7.1. `useTrips.ts` adds `useUpdateLiveTripFields` per §7.2. NEW `useTripHasWebPurchases.ts` per §7.3. NEW `useTripEditLog.ts` per §7.4 (optional reader).
4. **publicUrls helper** — add `tripCheckoutPath` + `tripPublicPath` per §8.5.
5. **Route layer S-3** — create 5-file `/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx` per §8.2-8.4.
6. **Route layer S-4 routing** — modify `app/trip/[id]/edit.tsx` for status-based dispatch per §8.1.
7. **Shared CoverPicker extract** — NEW `src/components/ui/CoverPicker.tsx` per §9.1. Refactor `src/components/event/CreatorStep4Cover.tsx` to consume per §9.9. Verify event-side tests pass with zero regression.
8. **ChangeSummaryModal generalization** — extend props + add 3 sub-renderers per §9.4.
9. **Component layer S-4 published-edit screen** — NEW `EditPublishedTripScreen.tsx` per §9.2. NEW `EditAfterPublishTripBanner.tsx` per §9.3.
10. **Component layer S-1 draft polish** — TripCreatorWizard.tsx mods (handleStepBack, handleClose, handleConfirmPublish payload, Saved toast) per §9.5.
11. **Component layer S-2 cover** — TripCreatorStep1Basics adds Cover field + new props per §9.6. Extend TripCreatorStep2-4 with optional editMode prop per §9.7. Pricing section read-only-when-sold UX.
12. **Component layer S-3 route fix** — TripCheckoutFlow.tsx:62 one-liner per §9.8.
13. **Implementor happy-path tests** — 5 files per §14. fails-on-revert verify each at a labeled commit hash; record hashes in implementation report.
14. **Tester adversarial test stub** — implementor creates the empty file at the path in §14 so tester knows where to land their assertions in TEST mode. Implementor does NOT write the adversarial assertions.
15. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY.md` with old→new receipts per touched file, fails-on-revert commit hashes per test file, EAS-OTA confirmation, Discoveries section for anything found mid-implementation.
16. **Tr4 [ORCH-0875 Refund Tiers + Booking Deadline] coordination flag** — implementation report includes a section noting: "`/checkout-trip/[tripEventId]/index.tsx` is the new destination for Tr4 SPEC §3.5.8 'Bookings closed' 403 banner. Tr4 SPEC amendment due post-CLOSE."

**Implementor MUST NOT:**
- Run `supabase db push` (operator-owned).
- Run `supabase functions deploy` (zero deploys expected).
- Touch any event-side service / hook / route apart from `CreatorStep4Cover.tsx` refactor (§9.9) and `ChangeSummaryModal.tsx` props extension (§9.4).
- Widen `getPublicEventById` / `getPublicEventBySlug` / `getPublicBrandBySlug`.
- Commit during implementation — operator commits at CLOSE.
- Leave `[ORCH-0876-DIAG]` markers in product code at end of implementation.
- Modify Tr4 SPEC — flag in report only.

---

## 16. Regression prevention (Phase 8)

### Structural safeguards
- **Audit-test extension** at `eventType.filter.audit.test.ts` — 3 new clauses pin: `getPublicTripById` event_type filter, `updateLiveTripFields` RPC routing, `biz_update_live_trip` SQL body event_type enforcement. Future refactors that widen any of these break CI immediately.
- **Adversarial test** at `event_chain_trip_isolation.test.tsx` — pins inverse direction. Catches future code that accidentally widens `getPublicEventById` or `getPublicTripById` to admit the wrong type.
- **9 new DRAFT invariants** (§13) — codified at CLOSE; future investigations consult INVARIANT_REGISTRY.md before architecturally similar changes.
- **DB-level CHECK constraint** on `trip_edit_log.reason char_length(reason) BETWEEN 10 AND 200` — prevents reason validation bypass via raw SQL.
- **DB-level RLS** on `trip_edit_log` — only RPC writes; no client INSERT/UPDATE/DELETE policy. Audit log is tamper-resistant.

### Protective comments (per touched file)

Each modified file gets one `// ORCH-0876` comment at the modified line explaining the WHY:

- `TripCheckoutFlow.tsx:62`: "// ORCH-0876: trip-specific chain; event-side hard-rejects trips by audit-test invariant"
- `TripCreatorWizard.handleStepBack`: "// ORCH-0876 SC-1.1: save-on-back so changes aren't lost"
- `TripCreatorWizard.handleClose` edit-mode: "// ORCH-0876 SC-1.2: save-on-close in edit mode"
- `TripCreatorStep1Basics` cover field: "// ORCH-0876 SC-2.1: cover-edit on trip wizard via shared CoverPicker"
- `app/trip/[id]/edit.tsx` dispatch: "// ORCH-0876 SC-4.1: status-based routing draft → wizard, scheduled/live → EditPublishedTripScreen, ended/cancelled → read-only"
- `tripsService.updateLiveTripFields`: "// ORCH-0876 SC-4.16: server-side via biz_update_live_trip RPC (LEAPFROG events' Zustand-only-write debt — F-17)"
- `publicEventsService.getPublicTripById`: "// ORCH-0876 SC-3.3: trip-only resolver (mirror of getPublicEventById's trip-rejection probe — inverse direction)"
- `EditPublishedTripScreen.tsx` top: "// ORCH-0876 S-4: mirror of EditPublishedScreen.tsx (ORCH-0704 v2) for trips; server-side via biz_update_live_trip RPC"
- `CreatorStep4Cover.tsx` after refactor: "// ORCH-0876: consumes shared CoverPicker (D3 — single source of truth for events + trips)"
- `ChangeSummaryModal.tsx` new sub-renderers: "// ORCH-0876: generalized for trip diffs (D2)"

### Test mod authorization

If implementor finds existing tests (`tr2RewordPolish.test.ts`, `TripVisualParity.test.ts`, `trip-dashboard-edit.test.ts`, `trip-create-publish.test.ts`) need assertion adjustments to reflect new Save semantics or status-based routing, cite `[TEST-MOD-APPROVED ORCH-0876]` in commit body. Tests are append-only otherwise per `.github/workflows/tests-append-only.yml`.

### DIAG marker policy

Implementor MAY use `[ORCH-0876-DIAG]` markers in product code during implementation for tracing. Step 1.5 orchestrator gate requires ZERO matches at CLOSE — implementor reaps all markers before final commit.

---

## 17. Open questions

**EMPTY.** All 18 operator-locked at orchestrator dispatch §0. SPEC discovered NO new ambiguity during writing. If implementor surfaces a new question mid-build (e.g., "the modal's `automaticallyAdjustKeyboardInsets` doesn't behave on Android — workaround?"), STOP and surface to orchestrator — do NOT silently decide.

---

## 18. Files (summary)

### Created (16 files)
- 1 SQL migration: `supabase/migrations/<timestamp>_orch_0876_trip_published_edit.sql`
- `mingla-business/src/services/tripChangeNotifier.ts`
- `mingla-business/src/utils/tripAdapter.ts`
- `mingla-business/src/utils/publishedTripEditGuards.ts`
- `mingla-business/src/hooks/usePublicTripById.ts`
- `mingla-business/src/hooks/useTripHasWebPurchases.ts`
- `mingla-business/src/hooks/useTripEditLog.ts`
- `mingla-business/src/components/ui/CoverPicker.tsx`
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (~1,000-1,200 lines)
- `mingla-business/src/components/trip/EditAfterPublishTripBanner.tsx`
- 5 route files: `mingla-business/app/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx`
- 5 test files: `TripCheckoutFlow_routes.test.ts`, `TripCreatorWizard_editSave.test.ts`, `CoverPicker.test.tsx`, `EditPublishedTripScreen.test.tsx`, `biz_update_live_trip.test.ts`
- 1 adversarial test stub: `event_chain_trip_isolation.test.tsx` (implementor stubs path; tester writes assertions)

### Modified (11 files)
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (1 route literal + header comment)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (handleStepBack, handleClose, handleConfirmPublish payload, Saved-toast effect)
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (Cover field + new props)
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` (optional editMode prop)
- `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx` (optional editMode prop)
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (optional editMode prop + read-only-when-sold UX)
- `mingla-business/src/services/publicEventsService.ts` (add `getPublicTripById`)
- `mingla-business/src/services/tripsService.ts` (add `updateLiveTripFields` + types)
- `mingla-business/src/hooks/useTrips.ts` (add `useUpdateLiveTripFields`)
- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (3 new clauses)
- `mingla-business/src/constants/publicUrls.ts` (add 2 helpers)
- `mingla-business/src/components/event/ChangeSummaryModal.tsx` (props extension + 3 sub-renderers)
- `mingla-business/src/components/event/CreatorStep4Cover.tsx` (refactor to consume shared CoverPicker)
- `mingla-business/app/trip/[id]/edit.tsx` (status-based dispatch)

### File count
- Created: 16 (1 migration + 8 source + 5 routes + 1 component + 1 banner — but EditPublishedTripScreen + EditAfterPublishTripBanner + 6 tests count separately = revised: 16 actual)
- Modified: 14
- **Total: ~30 files**

Within budget per Q16 (estimated 30-35).

---

## 19. Working tree + deployment

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**Deployment:**
- Operator applies 1 migration via `supabase db push --linked` (operator-owned action) before implementor's mobile build runs.
- Zero edge function deployments.
- EAS-OTA eligible after CLOSE — operator publishes:
  ```bash
  cd mingla-business && eas update --branch production --platform ios,android \
    --message "ORCH-0876: Trip CRUD + Purchase Flow + Full Event-Parity (Edit-After-Publish)"
  ```
- Confirm correct EAS project (mingla-business, NOT app-mobile) before publish.

**CLOSE protocol:** single PR Seth→main per Path A bundle authorization. PR title: `Close ORCH-0876: Trip CRUD + Purchase Flow Completion + Full Event-Parity`. Step 0.5 gate cites the 6 test paths (5 implementor + 1 tester). Step 1.5 DIAG-reap: zero `[ORCH-0876-DIAG]` matches required.

**Post-CLOSE actions:**
1. Resume ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] with amended SPEC: §3.5.8 "Bookings closed" 403 banner moves from `app/checkout/[eventId]/index.tsx` to `app/checkout-trip/[tripEventId]/index.tsx`; §3.5.7 `/booking/[orderId]/cancel` route stays (good design); refund-tier system integrates with v2's refund-gate downstream (operator must refund THEN edit; Tr4 ships the refund flow itself).
2. Flip 9 DRAFT invariants (§13) to ACTIVE in `INVARIANT_REGISTRY.md`.
3. Optional follow-ups (operator decides): (a) SC-1.6 field-blur debounced autosave; (b) backfill events to server-side RPC pattern using trip as template (close events' Zustand-only-write debt); (c) Tr3 [ORCH-0873 Tr3 Stage 2 UI] Money tab → full trip-orders ledger for the EditPublishedTripScreen "Open Orders" CTA destination.

---

## 20. Confidence

**H** — every contract maps to a six-field investigation finding; all 18 operator decisions pre-locked; zero new ambiguity surfaced during SPEC writing; SQL contract is concrete + complete; component contracts are concrete + complete; test paths + adversarial test stub locked; file count within budget; Tr4 coordination flagged for post-CLOSE amendment; one bundled PR per Path A; EAS OTA confirmed. Implementor ships against this contract with zero open questions remaining.
