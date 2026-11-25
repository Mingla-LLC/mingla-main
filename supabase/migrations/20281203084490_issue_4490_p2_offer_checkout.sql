-- #4490 P2 migration 2 (P2-2) — checkout and cancel for venue offers.
--
-- The money path for an offer reuses the Stays rail end to end:
--   availability (anon)      pg_venue_offer_availability
--   quote                    issue_4490_quote_offer          -> stay_quotes / lines / fee lines
--   hold                     issue_4490_create_offer_group   -> stay_reservation_groups / lines / hold / slices
--   pay                      issue_4490_prepare_offer_payment -> stay_payment_attempts / allocations
--                            then the edge function creates the provider session and calls the
--                            existing issue_1389_bind_payment_attempt
--   confirm                  the existing webhooks (and the guest's return through
--                            edge `venue-offers` action confirm_return) call the existing
--                            issue_1389_finalize_payment, unchanged
--   passes                   AFTER UPDATE trigger on confirm issues one venue pass per booking
--   guest read               issue_4490_get_offer_booking (token or signed-in owner)
--   my bookings              issue_4490_my_offer_bookings
--   cancel                   issue_4490_cancel_preview / issue_4490_cancel (every succeeded
--                            payment, the offer's refund ladder, staff = operator rate)
--   expire                   the existing Stays sweep (issue_1388_expire_groups is generic)
--
-- Capacity: issue_4490_pool_day_usage — every hold slice and commitment of every
-- offer on a pool counts against the pool's day; `kept_for_walk_ins` seats are
-- sold only at the gate. Every hold locks the pool row (and the day's override
-- row) FOR UPDATE, so two offers on one pool cannot oversell its last seats.
--
-- Signed-out buying: the quote / hold / pay / read / cancel RPCs here are
-- service-role only; the edge function `venue-offers` authenticates the guest
-- (a booking token, stored here only as its SHA-256) or the signed-in user.
--
-- A single payment above 2,147,483,647 minor units (about NGN 21.47m) is
-- refused with P0001 `offer_amount_too_large`.
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): drop the functions and venue_passes, restore
-- issue_1389_enqueue_stay_event and issue_4490_venue_page_payload from their
-- previous migrations.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Venue passes (one per confirmed booking).
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  reservation_line_id uuid NOT NULL REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  price_option_id uuid REFERENCES public.venue_offer_price_options(id) ON DELETE RESTRICT,
  valid_local_date date NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  admits integer NOT NULL CHECK (admits >= 1),
  admitted_count integer NOT NULL DEFAULT 0,
  holder_name text NOT NULL CHECK (char_length(btrim(holder_name)) BETWEEN 1 AND 120),
  qr_token_hash text NOT NULL UNIQUE CHECK (qr_token_hash ~ '^[a-f0-9]{64}$'),
  id_check_label text CHECK (id_check_label IS NULL OR char_length(id_check_label) BETWEEN 1 AND 200),
  id_check_count integer NOT NULL DEFAULT 0 CHECK (id_check_count >= 0),
  id_checked_at timestamptz,
  first_admitted_at timestamptz,
  last_admitted_at timestamptz,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'void', 'refunded')),
  source text NOT NULL CHECK (source IN ('online', 'gate', 'staff')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_passes_admitted_range CHECK (admitted_count BETWEEN 0 AND admits),
  CONSTRAINT venue_passes_window_order CHECK (valid_to > valid_from),
  CONSTRAINT venue_passes_id_count CHECK (id_check_count <= admits),
  UNIQUE (group_id)
);
CREATE INDEX venue_passes_venue_day_idx ON public.venue_passes (venue_id, valid_local_date);

ALTER TABLE public.venue_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_passes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_passes TO service_role;
-- No policy for authenticated: passes (and their token hash) are read only
-- through the check-in list and the buyer's own booking read.

CREATE TRIGGER issue_4490_venue_passes_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_passes
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();

CREATE OR REPLACE FUNCTION public.issue_4490_pass_qr_payload(
  p_pass_id uuid,
  p_token_hash text,
  p_pepper text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT 'mingla:v1:vpass:' || p_pass_id::text || ':sig:' || encode(
    pg_catalog.sha256(convert_to(p_pass_id::text || ':' || p_token_hash || ':' || p_pepper, 'UTF8')),
    'hex'
  );
$function$;

-- Stays defect fix (found by the #4490 local end-to-end run): the unique key
-- on (provider, provider_payment_ref) was NULLS NOT DISTINCT, so one attempt
-- left unbound (a provider create that failed, or two buyers preparing at the
-- same moment) blocked every other unbound attempt for that provider with
-- 23505. Provider references stay unique; unbound attempts no longer collide.
ALTER TABLE public.stay_payment_attempts
  DROP CONSTRAINT stay_payment_attempts_provider_provider_payment_ref_key;
CREATE UNIQUE INDEX stay_payment_attempts_provider_ref_key
  ON public.stay_payment_attempts (provider, provider_payment_ref)
  WHERE provider_payment_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Days, capacity and prices.
-- ---------------------------------------------------------------------------
-- Closed: a closed special day, or a weekday whose hours are all marked closed
-- (or missing) when the venue has weekly hours at all.
CREATE OR REPLACE FUNCTION public.issue_4490_day_closed(p_venue_id uuid, p_local_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.venue_special_hours s
      WHERE s.venue_id = p_venue_id AND s.local_date = p_local_date AND s.is_closed
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.venue_special_hours s
      WHERE s.venue_id = p_venue_id AND s.local_date = p_local_date AND NOT s.is_closed
    ) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.brand_hours h WHERE h.venue_id = p_venue_id) THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM public.brand_hours h
      WHERE h.venue_id = p_venue_id
        AND h.weekday = (extract(isodow FROM p_local_date)::integer - 1)
        AND NOT COALESCE(h.is_closed, false)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pool_day_usage(p_pool_id uuid, p_local_date date)
RETURNS TABLE (
  limit_effective integer,
  kept integer,
  used integer,
  online_left integer,
  gate_left integer,
  closed boolean,
  used_online integer,
  used_gate integer,
  kept_left integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_override public.venue_capacity_overrides%ROWTYPE;
  v_limit integer;
  v_kept integer;
  v_online integer;
  v_gate integer;
  v_closed boolean;
BEGIN
  SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_override FROM public.venue_capacity_overrides
  WHERE pool_id = p_pool_id AND local_date = p_local_date;
  v_closed := COALESCE(v_override.closed, false)
    OR public.issue_4490_day_closed(v_pool.venue_id, p_local_date);
  v_limit := CASE WHEN v_closed THEN 0 ELSE COALESCE(v_override.daily_limit, v_pool.daily_limit) END;
  -- P4 lowers the limit by spaces under an active private hire (the hire cut).
  v_kept := LEAST(COALESCE(v_override.kept_for_walk_ins, v_pool.kept_for_walk_ins), v_limit);
  -- Usage by channel: gate sales (walk-in bookings) draw the kept seats first.
  SELECT COALESCE(sum(quantity) FILTER (WHERE NOT is_gate), 0)::integer,
         COALESCE(sum(quantity) FILTER (WHERE is_gate), 0)::integer
  INTO v_online, v_gate
  FROM (
    SELECT slice_row.quantity, group_row.booking_source = 'walk_in' AS is_gate
    FROM public.stay_inventory_hold_slices slice_row
    JOIN public.stay_inventory_holds hold_row ON hold_row.id = slice_row.hold_id
    JOIN public.stay_reservation_groups group_row ON group_row.id = hold_row.group_id
    JOIN public.stay_place_windows window_row ON window_row.id = slice_row.place_window_id
    JOIN public.stay_offerings offering ON offering.id = slice_row.offering_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND window_row.local_date = p_local_date
      AND (
        (hold_row.state = 'active' AND hold_row.expires_at > now())
        OR hold_row.state = 'reconciliation_required'
      )
    UNION ALL
    SELECT commitment.quantity, group_row.booking_source = 'walk_in'
    FROM public.stay_inventory_commitments commitment
    JOIN public.stay_reservation_groups group_row ON group_row.id = commitment.group_id
    JOIN public.stay_place_windows window_row ON window_row.id = commitment.place_window_id
    JOIN public.stay_offerings offering ON offering.id = commitment.offering_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND window_row.local_date = p_local_date
      AND commitment.state = 'active'
  ) usage_rows;
  limit_effective := v_limit;
  kept := v_kept;
  used := v_online + v_gate;
  used_online := v_online;
  used_gate := v_gate;
  kept_left := GREATEST(v_kept - v_gate, 0);
  online_left := GREATEST(v_limit - v_kept - v_online - GREATEST(v_gate - v_kept, 0), 0);
  gate_left := GREATEST(v_limit - v_online - v_gate, 0);
  closed := v_closed;
  RETURN NEXT;
END;
$function$;

-- Guests already held or sold in one window (timed sessions cap a window).
CREATE OR REPLACE FUNCTION public.issue_4490_window_used(p_window_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (
    COALESCE((
      SELECT sum(slice_row.quantity)
      FROM public.stay_inventory_hold_slices slice_row
      JOIN public.stay_inventory_holds hold_row ON hold_row.id = slice_row.hold_id
      WHERE slice_row.place_window_id = p_window_id
        AND ((hold_row.state = 'active' AND hold_row.expires_at > now())
             OR hold_row.state = 'reconciliation_required')
    ), 0)
    + COALESCE((
      SELECT sum(commitment.quantity) FROM public.stay_inventory_commitments commitment
      WHERE commitment.place_window_id = p_window_id AND commitment.state = 'active'
    ), 0)
  )::integer;
$function$;

-- The last moment a window can be bought online: the session start for timed
-- sessions, the window end for walk-in / day pass; minus the offer's notice.
CREATE OR REPLACE FUNCTION public.issue_4490_window_cutoff(p_offering_id uuid, p_window_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN o.entry_style = 'timed_session' OR o.kind <> 'entry' THEN w.starts_at ELSE w.ends_at END
         - make_interval(mins => o.min_notice_minutes)
  FROM public.stay_offerings o
  JOIN public.stay_place_windows w ON w.offering_id = o.id
  WHERE o.id = p_offering_id AND w.id = p_window_id;
$function$;

-- Option price for a window: the current price, replaced by a busy rule whose
-- weekday and time cover the window start (venue time).
CREATE OR REPLACE FUNCTION public.issue_4490_option_price_at(
  p_option_id uuid,
  p_window_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH ctx AS (
    SELECT opt.busy_rules,
           price.amount_minor,
           (w.starts_at AT TIME ZONE r.timezone) AS local_start
    FROM public.venue_offer_price_options opt
    JOIN public.stay_price_versions price
      ON price.price_option_id = opt.id AND price.effective_to IS NULL
    JOIN public.stay_place_windows w ON w.id = p_window_id AND w.offering_id = opt.offering_id
    JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
    WHERE opt.id = p_option_id
  )
  SELECT COALESCE((
    SELECT (rule->>'amount_minor')::bigint
    FROM ctx, jsonb_array_elements(ctx.busy_rules) WITH ORDINALITY AS b(rule, ord)
    WHERE (extract(isodow FROM ctx.local_start)::integer - 1) IN (
            SELECT d::integer FROM jsonb_array_elements_text(rule->'weekdays') d)
      AND ctx.local_start::time >= (rule->>'from')::time
      AND ctx.local_start::time < (rule->>'to')::time
    ORDER BY ord
    LIMIT 1
  ), (SELECT amount_minor FROM ctx));
$function$;

-- Why an option cannot be bought for a window (NULL = it can).
CREATE OR REPLACE FUNCTION public.issue_4490_option_window_reason(p_option_id uuid, p_window_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN opt.id IS NULL OR opt.status <> 'active' THEN 'option_unavailable'
    WHEN NOT ((extract(isodow FROM w.local_date)::integer - 1)::smallint = ANY(opt.weekdays)) THEN 'wrong_weekday'
    WHEN opt.local_start_time IS NOT NULL AND NOT (
      (w.starts_at AT TIME ZONE r.timezone)::time >= opt.local_start_time
      AND (w.starts_at AT TIME ZONE r.timezone)::time < opt.local_end_time
    ) THEN 'wrong_time'
    ELSE NULL
  END
  FROM public.stay_place_windows w
  JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
  LEFT JOIN public.venue_offer_price_options opt ON opt.id = p_option_id AND opt.offering_id = w.offering_id
  WHERE w.id = p_window_id;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Availability (anon).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_offer_availability(
  p_offering_id uuid,
  p_from date,
  p_to date,
  p_guests integer DEFAULT NULL,
  p_price_option_id uuid DEFAULT NULL
)
RETURNS TABLE (
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  window_id uuid,
  status text,
  reason text,
  remaining integer,
  price_minor bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_usage record;
  v_today date;
  v_last date;
  v_remaining integer;
  v_reason text;
BEGIN
  IF p_offering_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from
     OR p_to - p_from > 62 OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'availability_range_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN
    RETURN;
  END IF;
  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind NOT IN ('room', 'place') AND o.status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RETURN;
  END IF;
  SELECT * INTO v_settings FROM public.venue_booking_settings WHERE venue_id = v_offer.venue_id;
  v_today := (now() AT TIME ZONE COALESCE(v_settings.timezone, 'UTC'))::date;
  v_last := v_today + LEAST(COALESCE(v_settings.booking_horizon_days, 365), COALESCE(v_offer.max_advance_days, 730));
  FOR v_window IN
    SELECT w.* FROM public.stay_place_windows w
    WHERE w.offering_id = v_offer.id AND w.local_date BETWEEN p_from AND p_to AND NOT w.stop_sell
    ORDER BY w.starts_at, w.id
  LOOP
    local_date := v_window.local_date;
    starts_at := v_window.starts_at;
    ends_at := v_window.ends_at;
    window_id := v_window.id;
    reason := NULL;
    remaining := 0;
    price_minor := CASE WHEN p_price_option_id IS NOT NULL
      THEN public.issue_4490_option_price_at(p_price_option_id, v_window.id)
      ELSE (SELECT min(public.issue_4490_option_price_at(opt.id, v_window.id))
            FROM public.venue_offer_price_options opt
            WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
              AND public.issue_4490_option_window_reason(opt.id, v_window.id) IS NULL) END;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
    IF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
      status := 'closed'; reason := 'bookings_paused';
    ELSIF COALESCE(v_usage.closed, public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date)) THEN
      status := 'closed';
    ELSIF v_window.local_date > v_last THEN
      status := 'too_far';
    ELSIF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
      status := 'too_soon';
    ELSE
      v_reason := CASE WHEN p_price_option_id IS NOT NULL
        THEN public.issue_4490_option_window_reason(p_price_option_id, v_window.id) END;
      IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
        status := 'wrong_weekday'; reason := v_reason;
      ELSIF v_reason IS NOT NULL THEN
        status := 'closed'; reason := v_reason;
      ELSE
        v_remaining := COALESCE(v_usage.online_left, 0);
        IF v_offer.entry_style = 'timed_session' THEN
          v_remaining := LEAST(v_remaining,
            GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
        END IF;
        remaining := v_remaining;
        IF v_remaining >= COALESCE(p_guests, 1) THEN
          status := 'available';
        ELSIF v_remaining = 0 AND COALESCE(v_usage.gate_left, 0) > 0 THEN
          status := 'gate_only';
        ELSE
          status := 'sold_out';
          reason := CASE WHEN v_remaining > 0 THEN 'not_enough_left' END;
        END IF;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Quote (service role; the edge function authenticates the buyer).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_quote_projection(p_quote_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'quoteId', q.id,
    'version', q.version,
    'status', q.status,
    'mode', q.mode,
    'offerKind', q.offer_kind,
    'venueId', q.venue_id,
    'currencyCode', q.currency_code,
    'subtotalMinor', q.source_subtotal_minor,
    'feeMinor', q.fee_total_minor,
    'taxMinor', q.tax_total_minor,
    'totalMinor', q.total_minor,
    'expiresAt', q.expires_at,
    'window', (
      SELECT jsonb_build_object('windowId', w.id, 'localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
      FROM public.stay_quote_lines l JOIN public.stay_place_windows w ON w.id = l.place_window_id
      WHERE l.quote_id = q.id LIMIT 1),
    'vat', (
      SELECT jsonb_build_object(
        'mode', CASE WHEN fee.id IS NULL THEN 'none' WHEN fee.included_in_base THEN 'included' ELSE 'added' END,
        'ratePct', CASE WHEN fee.id IS NULL THEN 0 ELSE (fee.snapshot->>'basis_points')::numeric / 100 END,
        'amountMinor', COALESCE(sum(fee.amount_minor), 0))
      FROM public.stay_quote_lines l
      LEFT JOIN public.stay_quote_fee_lines fee ON fee.quote_line_id = l.id AND fee.fee_kind = 'tax'
      WHERE l.quote_id = q.id
      GROUP BY fee.id IS NULL, fee.included_in_base, fee.snapshot->>'basis_points'
      ORDER BY (fee.id IS NULL) LIMIT 1),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id,
        'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName',
        'guests', l.place_guests,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor,
        'taxMinor', l.tax_minor,
        'feeMinor', l.fee_minor,
        'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel'
      ) ORDER BY (l.price_snapshot->>'sortOrder')::integer, l.id)
      FROM public.stay_quote_lines l WHERE l.quote_id = q.id), '[]'::jsonb),
    'policy', (
      SELECT jsonb_build_object(
        'text', l.policy_snapshot->>'cancellation_policy',
        'refundLadder', l.policy_snapshot->'refund_ladder',
        'dateChangeRule', l.policy_snapshot->'date_change_rule')
      FROM public.stay_quote_lines l WHERE l.quote_id = q.id LIMIT 1)
  )
  FROM public.stay_quotes q WHERE q.id = p_quote_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_quote_offer_internal(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_gate boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_existing public.stay_quotes%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_usage record;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid;
  v_request_hash text;
  v_currency text;
  v_item jsonb;
  v_guests integer;
  v_total_guests integer := 0;
  v_unit bigint;
  v_base bigint;
  v_tax bigint;
  v_reason text;
  v_remaining integer;
  v_total bigint;
  v_last date;
BEGIN
  IF p_offering_id IS NULL OR p_window_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) item
    WHERE jsonb_typeof(item) <> 'object'
       OR COALESCE(item->>'priceOptionId', '') !~ '^[0-9a-f-]{36}$'
       OR jsonb_typeof(item->'guests') <> 'number'
       OR (item->>'guests') !~ '^[0-9]{1,4}$'
       OR (item->>'guests')::integer NOT BETWEEN 1 AND 1000
  ) OR (SELECT count(DISTINCT item->>'priceOptionId') FROM jsonb_array_elements(p_lines) item)
       <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'offering', p_offering_id, 'window', p_window_id, 'lines', p_lines)::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-quote:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_quotes
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_quote_projection(v_existing.id);
  END IF;

  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind NOT IN ('room', 'place');
  IF NOT FOUND OR v_offer.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id AND offering_id = v_offer.id;
  IF NOT FOUND OR v_window.stop_sell THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' AND NOT p_gate THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_last := (now() AT TIME ZONE v_settings.timezone)::date
    + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  IF v_window.local_date > v_last THEN
    RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
  END IF;
  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
  IF COALESCE(v_usage.closed, true) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_policy FROM public.stay_policy_versions
  WHERE offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_offer.brand_id;

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, p_user_id, p_actor_key, v_offer.venue_id, v_offer.brand_id, v_currency,
    'instant', 'building', 0, 0, 0, 0,
    v_request_hash, repeat('0', 64), repeat('0', 64), repeat('0', 64),
    btrim(p_idempotency_key), now() + interval '15 minutes', v_offer.kind
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY value->>'priceOptionId'
  LOOP
    v_guests := (v_item->>'guests')::integer;
    SELECT * INTO v_option FROM public.venue_offer_price_options
    WHERE id = (v_item->>'priceOptionId')::uuid AND offering_id = v_offer.id AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
    END IF;
    v_reason := public.issue_4490_option_window_reason(v_option.id, v_window.id);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION 'offer_%', v_reason USING ERRCODE = 'PT409';
    END IF;
    IF v_guests < v_option.guest_min OR v_guests > v_option.guest_max THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_price FROM public.stay_price_versions
    WHERE price_option_id = v_option.id AND offering_id = v_offer.id AND effective_to IS NULL;
    IF NOT FOUND OR v_price.currency_code <> v_currency THEN
      RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
    END IF;
    v_unit := public.issue_4490_option_price_at(v_option.id, v_window.id);
    v_base := CASE v_option.unit WHEN 'guest' THEN v_unit * v_guests ELSE v_unit END;
    IF v_base > 9000000000000000 THEN
      RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
    END IF;
    v_total_guests := v_total_guests + v_guests;
    v_line_id := gen_random_uuid();
    INSERT INTO public.stay_quote_lines (
      id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
      base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
      offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot,
      price_option_id
    ) VALUES (
      v_line_id, v_quote_id, v_offer.id, v_offer.kind, 'instant', v_window.id, v_guests,
      v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
      jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
        'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
        'poolId', v_offer.capacity_pool_id, 'localDate', v_window.local_date),
      jsonb_build_object('name', v_offer.name, 'kind', v_offer.kind, 'entryStyle', v_offer.entry_style,
        'venueId', v_offer.venue_id),
      jsonb_build_object('optionName', v_option.name, 'unit', v_option.unit, 'unitPriceMinor', v_unit,
        'listPriceMinor', v_price.amount_minor, 'currencyCode', v_currency, 'sortOrder', v_option.sort_order,
        'idCheckLabel', CASE WHEN COALESCE((v_option.eligibility->>'check_at_gate')::boolean, false)
                             THEN v_option.eligibility->>'label' END,
        'eligibilityLabel', v_option.eligibility->>'label'),
      to_jsonb(v_policy) - 'created_by',
      v_option.id
    );
    FOR v_fee IN
      SELECT * FROM public.stay_fee_versions
      WHERE offering_id = v_offer.id AND effective_to IS NULL
      ORDER BY fee_key, id
    LOOP
      v_tax := CASE
        WHEN v_fee.calculation = 'percentage_of_line_base' AND v_fee.display_mode = 'included'
          THEN round(v_base::numeric * v_fee.basis_points / (10000 + v_fee.basis_points))::bigint
        WHEN v_fee.calculation = 'percentage_of_line_base'
          THEN round(v_base::numeric * v_fee.basis_points / 10000)::bigint
        WHEN v_fee.calculation = 'fixed_per_place_booking' THEN v_fee.amount_minor
        WHEN v_fee.calculation = 'fixed_per_place_guest' THEN v_fee.amount_minor * v_guests
        ELSE 0 END;
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor,
        included_in_base, refund_treatment, snapshot
      ) VALUES (
        v_quote_id, v_line_id, v_fee.id, v_fee.label, v_fee.fee_kind, v_tax,
        v_fee.display_mode = 'included', v_fee.refund_treatment, to_jsonb(v_fee)
      );
    END LOOP;
  END LOOP;

  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor,
      tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;

  -- Capacity (not locked here; the hold re-checks under the pool lock).
  v_remaining := COALESCE(CASE WHEN p_gate THEN v_usage.gate_left ELSE v_usage.online_left END, 0);
  IF v_offer.entry_style = 'timed_session' THEN
    v_remaining := LEAST(v_remaining, GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
  END IF;
  IF v_total_guests > v_remaining THEN
    RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('remaining', v_remaining)::text;
  END IF;

  SELECT sum(total_minor) INTO v_total FROM public.stay_quote_lines WHERE quote_id = v_quote_id;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = totals.base, fee_total_minor = totals.fee,
      tax_total_minor = totals.tax, total_minor = totals.total,
      price_revision_set_hash = (
        SELECT encode(pg_catalog.sha256(convert_to(string_agg(
          l.price_version_id::text || ':' || l.price_snapshot::text, '|' ORDER BY l.price_option_id), 'UTF8')), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id),
      inventory_revision_set_hash = (
        SELECT encode(pg_catalog.sha256(convert_to(string_agg(
          l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text,
          '|' ORDER BY l.price_option_id), 'UTF8')), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id),
      policy_snapshot_hash = (
        SELECT encode(pg_catalog.sha256(convert_to(string_agg(
          l.policy_version_id::text || ':' || l.policy_snapshot::text, '|' ORDER BY l.price_option_id), 'UTF8')), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id)
  FROM (
    SELECT sum(base_minor) AS base, sum(fee_minor) AS fee, sum(tax_minor) AS tax, sum(total_minor) AS total
    FROM public.stay_quote_lines WHERE quote_id = v_quote_id
  ) totals
  WHERE q.id = v_quote_id;

  RETURN public.issue_4490_quote_projection(v_quote_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_quote_offer(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_quote_offer_internal(
    p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Hold (create the booking). Online holds may use only `online_left`;
--    gate sales (migration 3) may use the kept-for-walk-ins seats.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_assert_offer_guest(p_guest jsonb, p_require_email boolean)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF jsonb_typeof(p_guest) <> 'object'
     OR jsonb_typeof(p_guest->'name') <> 'string'
     OR char_length(btrim(COALESCE(p_guest->>'name', ''))) NOT BETWEEN 1 AND 120
     OR (p_guest ? 'email' AND jsonb_typeof(p_guest->'email') NOT IN ('string', 'null'))
     OR (p_guest ? 'phone' AND jsonb_typeof(p_guest->'phone') NOT IN ('string', 'null'))
     OR (p_guest ? 'phoneCountryIso' AND jsonb_typeof(p_guest->'phoneCountryIso') NOT IN ('string', 'null'))
     OR char_length(btrim(COALESCE(p_guest->>'email', ''))) > 254
     OR (char_length(btrim(COALESCE(p_guest->>'email', ''))) > 0
         AND btrim(p_guest->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
     OR (char_length(btrim(COALESCE(p_guest->>'phone', ''))) > 0
         AND btrim(p_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$')
     OR (NULLIF(p_guest->>'phoneCountryIso', '') IS NOT NULL AND (p_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$')
     OR p_guest - ARRAY['name', 'email', 'phone', 'phoneCountryIso'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'offer_guest_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_require_email AND char_length(btrim(COALESCE(p_guest->>'email', ''))) = 0 THEN
    RAISE EXCEPTION 'offer_guest_email_required' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hold_offer_internal(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text,
  p_gate boolean,
  p_staff_user_id uuid,
  p_payment_collection text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_usage record;
  v_request_hash text;
  v_hold_id uuid := gen_random_uuid();
  v_needed integer;
  v_left integer;
  v_hold_expires timestamptz;
  v_policy jsonb;
  v_reservation_line uuid;
BEGIN
  IF p_group_id IS NULL OR p_quote_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (NOT p_gate AND (p_buyer_token_hash IS NULL OR octet_length(p_buyer_token_hash) <> 32)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM public.issue_4490_assert_offer_guest(p_guest, NOT p_gate);
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'quoteId', p_quote_id, 'guest', p_guest)::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-group:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_reservation_groups
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash OR v_existing.offer_kind IS NULL THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_quote FROM public.stay_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> p_actor_key OR v_quote.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' THEN
      UPDATE public.stay_quotes SET status = 'expired', version = version + 1 WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'offer_quote_expired' USING ERRCODE = 'PT409';
  END IF;

  -- Lock order: brand, offering, window, pool (+ override), then slices.
  PERFORM 1 FROM public.brands WHERE id = v_quote.brand_id FOR UPDATE;
  SELECT * INTO v_line FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY id LIMIT 1;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id FOR UPDATE;
  IF v_offer.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stay_quote_lines l
    WHERE l.quote_id = v_quote.id
      AND (l.offering_version <> v_offer.version
           OR NOT EXISTS (SELECT 1 FROM public.stay_price_versions p
                          WHERE p.id = l.price_version_id AND p.effective_to IS NULL)
           OR NOT EXISTS (SELECT 1 FROM public.stay_policy_versions p
                          WHERE p.id = l.policy_version_id AND p.effective_to IS NULL))
  ) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id FOR UPDATE;
  IF v_window.stop_sell OR now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id)
     OR (p_gate AND v_window.local_date <> (now() AT TIME ZONE public.issue_4490_venue_timezone(v_offer.venue_id))::date) THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' AND NOT p_gate THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.capacity_pool_id IS NOT NULL THEN
    PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id FOR UPDATE;
    PERFORM 1 FROM public.venue_capacity_overrides
    WHERE pool_id = v_offer.capacity_pool_id AND local_date = v_window.local_date FOR UPDATE;
  END IF;
  -- Lapsed holds stop counting (the sweep still owns their state change).
  SELECT sum(place_guests) INTO v_needed FROM public.stay_quote_lines WHERE quote_id = v_quote.id;
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
  IF COALESCE(v_usage.closed, true) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_left := CASE WHEN p_gate THEN v_usage.gate_left ELSE v_usage.online_left END;
  IF v_offer.entry_style = 'timed_session' THEN
    v_left := LEAST(v_left, GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
  END IF;
  IF v_needed > v_left THEN
    RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('remaining', v_left)::text;
  END IF;
  IF p_payment_collection = 'mingla' AND (
       NOT public.pg_brand_can_collect(v_quote.brand_id)
       OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = v_quote.brand_id
                      AND upper(b.default_currency) = v_quote.currency_code)) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  v_policy := v_line.policy_snapshot;
  IF p_gate THEN
    PERFORM set_config('mingla.issue_4490_gate_sale', p_group_id::text, true);
  END IF;
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection, created_by_staff_user_id
  ) VALUES (
    p_group_id,
    'VB-' || upper(substr(replace(p_group_id::text, '-', ''), 1, 20)),
    v_quote.id, p_user_id, p_actor_key, v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    'instant', 'instant_payment_pending', NULL, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(p_guest->>'name'),
      'email', NULLIF(lower(btrim(COALESCE(p_guest->>'email', ''))), ''),
      'phone', NULLIF(btrim(COALESCE(p_guest->>'phone', '')), ''),
      'phoneCountryIso', NULLIF(p_guest->>'phoneCountryIso', ''))),
    v_quote.source_subtotal_minor, v_quote.fee_total_minor, v_quote.tax_total_minor, v_quote.total_minor,
    btrim(p_idempotency_key), v_request_hash, v_quote.offer_kind, p_buyer_token_hash,
    jsonb_build_object(
      'stagePlan', 'full',
      'depositKind', 'none',
      'currencyCode', v_quote.currency_code,
      'vatMode', v_settings.vat_mode,
      'refundLadder', COALESCE(v_policy->'refund_ladder', '[]'::jsonb),
      'dateChangeRule', COALESCE(v_policy->'date_change_rule', '{}'::jsonb),
      'policyText', v_policy->>'cancellation_policy',
      'operatorCancelRefundBps', (v_policy->>'operator_cancel_refund_basis_points')::integer,
      'damageDepositMinor', 0,
      'minSpendMinor', 0,
      'localDate', v_window.local_date),
    CASE WHEN p_gate THEN 'walk_in' ELSE 'guest' END,
    p_payment_collection,
    p_staff_user_id
  );
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_units, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
  )
  SELECT gen_random_uuid(), p_group_id, l.id, l.offering_id, l.kind, 'payment_pending', l.place_window_id,
         l.place_units, l.place_guests, 0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id, l.booked_minutes
  FROM public.stay_quote_lines l WHERE l.quote_id = v_quote.id ORDER BY l.price_option_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, p_group_id, 'active', v_hold_expires,
          CASE WHEN p_gate THEN 'gate_sale' ELSE 'instant_payment' END);
  INSERT INTO public.stay_inventory_hold_slices (
    hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
  )
  SELECT v_hold_id, r.id, 'place_window', r.offering_id, r.place_window_id, r.place_guests
  FROM public.stay_reservation_lines r WHERE r.group_id = p_group_id ORDER BY r.id;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, CASE WHEN p_gate THEN 'stay_offer_gate_sale' ELSE 'stay_offer_hold_created' END,
    CASE WHEN p_gate THEN 'staff' ELSE 'guest' END,
    COALESCE(p_staff_user_id, p_user_id),
    'offer-hold:' || btrim(p_idempotency_key),
    jsonb_build_object('holdExpiresAt', v_hold_expires, 'guests', v_needed, 'localDate', v_window.local_date)
  );
  RETURN p_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_create_offer_group(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_id := public.issue_4490_hold_offer_internal(
    p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash,
    p_idempotency_key, false, NULL, 'mingla');
  RETURN public.issue_4490_booking_projection(v_id, NULL);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Pay (stage 'full' in P2; deposits and balance arrive in P3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_booking_actor_ok(
  p_group public.stay_reservation_groups,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT p_group.offer_kind IS NOT NULL AND (
    (p_token_hash IS NOT NULL AND p_group.buyer_token_hash IS NOT NULL AND p_group.buyer_token_hash = p_token_hash)
    OR (p_user_id IS NOT NULL AND (p_group.user_id = p_user_id OR p_group.booked_by_user_id = p_user_id))
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_prepare_offer_payment(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_idempotency_key text,
  p_expected_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness bigint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_expected_version IS NULL
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer-payment:' || p_group_id::text || ':' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', 'full')::text, 'UTF8')), 'hex');
  SELECT * INTO v_attempt FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_attempt.stage);
  END IF;
  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.state <> 'instant_payment_pending' OR v_group.payment_collection <> 'mingla' THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stay_payment_attempts a
    WHERE a.group_id = p_group_id AND a.state IN ('pending', 'succeeded', 'ambiguous')
  ) THEN
    RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.total_minor > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF v_group.total_minor <= 0 THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack' THEN pricing.paystack_subaccount_code ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(v_group.brand_id, v_group.venue_id) pricing
  LIMIT 1;
  SELECT b.payout_hold_cutover_at, b.discovery_currency_state_version INTO v_cutover, v_readiness
  FROM public.brands b WHERE b.id = v_group.brand_id;
  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR v_cutover IS NULL
     OR (v_provider = 'stripe' AND v_account IS NULL)
     OR (v_provider = 'paystack' AND v_currency <> 'NGN')
     OR (v_provider = 'paystack' AND NULLIF(v_group.guest_snapshot->>'email', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  v_app_fee := LEAST(v_group.total_minor,
    round(v_group.total_minor::numeric * COALESCE(v_take_rate, 0) / 10000)::bigint);
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts WHERE group_id = p_group_id;
  PERFORM set_config('mingla.issue_4490_offer_rail', p_group_id::text, true);
  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref, amount_minor, currency_code,
    application_fee_minor, state, idempotency_key, request_hash, readiness_revision, stage
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account, v_group.total_minor, v_group.currency_code,
    v_app_fee, 'created', btrim(p_idempotency_key), v_request_hash, COALESCE(v_readiness, 1), 'full'
  ) RETURNING * INTO v_attempt;
  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref, charged_minor, refund_treatment, snapshot
  )
  SELECT v_attempt.id, line.id, 'base', 'base', line.base_minor, 'same_as_line',
         jsonb_build_object('policy', line.policy_snapshot)
  FROM public.stay_reservation_lines line WHERE line.group_id = p_group_id AND line.base_minor > 0
  ORDER BY line.id;
  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref, charged_minor, refund_treatment, snapshot
  )
  SELECT v_attempt.id, line.id, CASE fee.fee_kind WHEN 'tax' THEN 'tax' ELSE 'fee' END,
         fee.id::text, fee.amount_minor, fee.refund_treatment, fee.snapshot
  FROM public.stay_reservation_lines line
  JOIN public.stay_quote_fee_lines fee ON fee.quote_line_id = line.quote_line_id
  WHERE line.group_id = p_group_id AND NOT fee.included_in_base AND fee.amount_minor > 0
  ORDER BY line.id, fee.id;
  IF (SELECT COALESCE(sum(charged_minor), 0) FROM public.stay_payment_allocations
      WHERE payment_attempt_id = v_attempt.id) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', p_user_id, 'payment-prepared:' || v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id, 'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text, 'currencyCode', v_attempt.currency_code, 'stage', 'full')
  );
  RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', 'full');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Confirm: passes, and the venue booking notifications.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_issue_offer_pass(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_admits integer;
  v_id_label text;
  v_id_count integer;
  v_pass_id uuid;
BEGIN
  SELECT id INTO v_pass_id FROM public.venue_passes WHERE group_id = p_group_id;
  IF FOUND THEN
    RETURN v_pass_id;
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  SELECT * INTO v_line FROM public.stay_reservation_lines
  WHERE group_id = p_group_id ORDER BY created_at, id LIMIT 1;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_group.venue_id);
  IF v_offer.entry_style = 'timed_session' THEN
    -- Timed sessions: 30 minutes either side of the start.
    v_from := v_window.starts_at - interval '30 minutes';
    v_to := v_window.starts_at + interval '30 minutes';
  ELSIF v_offer.kind = 'entry' THEN
    -- Walk-in / day pass: the whole local day (and the window, if it runs later).
    v_from := v_window.local_date::timestamp AT TIME ZONE v_tz;
    v_to := GREATEST(v_window.ends_at, (v_window.local_date + 1)::timestamp AT TIME ZONE v_tz);
  ELSE
    v_from := v_window.starts_at - make_interval(mins => v_offer.buffer_before_minutes);
    v_to := v_window.ends_at;
  END IF;
  SELECT sum(l.place_guests),
         string_agg(DISTINCT l.price_snapshot->>'idCheckLabel', ' · ')
           FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL),
         COALESCE(sum(l.place_guests) FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL), 0)
  INTO v_admits, v_id_label, v_id_count
  FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id;
  INSERT INTO public.venue_passes (
    venue_id, brand_id, group_id, reservation_line_id, offering_id, price_option_id,
    valid_local_date, valid_from, valid_to, admits, holder_name, qr_token_hash,
    id_check_label, id_check_count, source
  ) VALUES (
    v_group.venue_id, v_group.brand_id, v_group.id, v_line.id, v_line.offering_id,
    CASE WHEN (SELECT count(*) FROM public.stay_reservation_lines WHERE group_id = p_group_id) = 1
         THEN v_line.price_option_id END,
    v_window.local_date, v_from, v_to, v_admits,
    left(COALESCE(NULLIF(btrim(v_group.guest_snapshot->>'name'), ''), 'Guest'), 120),
    encode(pg_catalog.sha256(extensions.gen_random_bytes(32)), 'hex'),
    left(v_id_label, 200), v_id_count,
    CASE v_group.booking_source WHEN 'walk_in' THEN 'gate' WHEN 'guest' THEN 'online' ELSE 'staff' END
  ) RETURNING id INTO v_pass_id;
  RETURN v_pass_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_on_offer_group_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.offer_kind IS NULL OR NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;
  IF NEW.state = 'confirmed' THEN
    PERFORM public.issue_4490_issue_offer_pass(NEW.id);
  ELSIF NEW.state IN ('cancelled', 'partially_cancelled') AND OLD.state IN ('confirmed', 'partially_cancelled') THEN
    UPDATE public.venue_passes
    SET status = CASE WHEN EXISTS (
          SELECT 1 FROM public.stay_refunds r WHERE r.group_id = NEW.id AND r.amount_minor > 0)
          THEN 'refunded' ELSE 'void' END,
        version = version + 1, updated_at = now()
    WHERE group_id = NEW.id AND status = 'valid' AND NEW.state = 'cancelled';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_offer_group_state
  AFTER UPDATE OF state ON public.stay_reservation_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_offer_group_state();

-- Notifications: offer bookings map to the venue_* categories (the guest link
-- is built at send time from the group id); Stays keep their mapping.
CREATE OR REPLACE FUNCTION public.issue_4490_enqueue_offer_event(
  p_event public.stay_reservation_events,
  p_group public.stay_reservation_groups
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_category text;
  v_email text;
BEGIN
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RETURN;
  END IF;
  v_category := CASE p_event.event_type
    WHEN 'stay_reservation_confirmed' THEN 'venue_booking_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'venue_booking_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'venue_refund_state'
    ELSE NULL END;
  IF v_category IS NULL OR p_group.payment_collection <> 'mingla' THEN
    RETURN;
  END IF;
  v_email := NULLIF(lower(btrim(COALESCE(p_group.guest_snapshot->>'email', ''))), '');
  IF v_email IS NULL AND p_group.user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
  ) VALUES (
    v_category, p_group.user_id, v_email, p_group.brand_id,
    jsonb_build_object(
      'venue_group_id', p_group.id,
      'public_reference', p_group.public_reference,
      'venue_id', p_group.venue_id,
      'offer_kind', p_group.offer_kind,
      'amount_cents', COALESCE((p_event.safe_metadata->>'amountMinor')::bigint, p_group.total_minor),
      'currency', p_group.currency_code
    ),
    'venue-offer:' || p_event.id || ':' || v_category || ':guest',
    NULL
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_enqueue_stay_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_category text;
  v_staff_event boolean := false;
  v_payload jsonb;
  v_recipient record;
  -- #1529 — the normalised E.164 handset for the SMS legs (producers I and K).
  v_phone_e164 text;
BEGIN
  -- #4490: a venue offer booking has its own categories and flag.
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = NEW.group_id;
  IF FOUND AND v_group.offer_kind IS NOT NULL THEN
    PERFORM public.issue_4490_enqueue_offer_event(NEW, v_group);
    RETURN NEW;
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_NOTIFICATIONS') THEN
    RETURN NEW;
  END IF;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_category := CASE NEW.event_type
    WHEN 'stay_request_submitted' THEN 'stay_request_received'
    WHEN 'stay_request_approved' THEN 'stay_payment_required'
    WHEN 'stay_request_declined' THEN 'stay_request_declined'
    WHEN 'stay_reservation_confirmed' THEN 'stay_reservation_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'stay_reservation_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'stay_refund_state'
    WHEN 'stay_refund_attention_required'
      THEN 'stay_reconciliation_attention'
    WHEN 'stay_payment_late_refund_due'
      THEN 'stay_reconciliation_attention'
    ELSE NULL
  END;
  IF v_category IS NULL THEN
    RETURN NEW;
  END IF;
  v_staff_event := NEW.event_type IN (
    'stay_request_submitted',
    'stay_refund_attention_required',
    'stay_payment_late_refund_due'
  );
  v_payload := jsonb_build_object(
    'stay_group_id', v_group.id,
    'public_reference', v_group.public_reference,
    'venue_id', v_group.venue_id,
    'amount_cents', COALESCE(
      (NEW.safe_metadata->>'amountMinor')::bigint,
      v_group.total_minor
    ),
    'currency', v_group.currency_code,
    'payment_deadline', v_group.payment_deadline,
    'request_deadline', v_group.request_deadline,
    'title', CASE
      WHEN v_staff_event THEN 'Stay reservation needs attention'
      ELSE 'Your Stay reservation'
    END,
    'body', CASE NEW.event_type
      WHEN 'stay_request_submitted'
        THEN 'A guest submitted a Stay reservation request.'
      WHEN 'stay_request_approved'
        THEN 'Your Stay request was approved. Complete payment before the deadline.'
      WHEN 'stay_request_declined'
        THEN 'The property declined your Stay reservation request.'
      WHEN 'stay_reservation_confirmed'
        THEN 'Your Rooms and Places are confirmed.'
      WHEN 'stay_reservation_cancelled'
        THEN 'Your selected Rooms and Places were cancelled.'
      WHEN 'stay_refund_succeeded'
        THEN 'Your Stay refund has been issued.'
      ELSE 'A Stay payment or refund needs review.'
    END
  ) || NEW.safe_metadata;
  IF v_staff_event THEN
    FOR v_recipient IN
      SELECT DISTINCT recipient.user_id, user_row.email, user_row.phone
      FROM (
        SELECT brand.account_id AS user_id
        FROM public.brands brand
        WHERE brand.id = v_group.brand_id
        UNION
        SELECT member.user_id
        FROM public.brand_team_members member
        WHERE member.brand_id = v_group.brand_id
          AND member.accepted_at IS NOT NULL
          AND member.removed_at IS NULL
          AND member.role IN (
            'brand_owner', 'brand_admin',
            'event_manager', 'finance_manager'
          )
      ) recipient
      JOIN auth.users user_row ON user_row.id = recipient.user_id
    LOOP
      -- Producer H — staff EMAIL leg. Country underivable from an email.
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code
      ) VALUES (
        v_category, v_recipient.user_id, lower(v_recipient.email),
        v_group.brand_id, v_payload,
        'stay:' || NEW.id || ':' || v_category || ':user:' ||
          v_recipient.user_id,
        NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      -- Producer I — staff SMS leg. #1529: normalise FIRST, then gate on the
      -- normalised value, so an unnormalisable phone yields no row at all.
      v_phone_e164 := public.mingla_e164_normalize(v_recipient.phone);
      IF v_phone_e164 IS NOT NULL THEN
        INSERT INTO public.notification_outbox (
          category_key, user_id, contact, brand_id, payload, idempotency_key,
          country_code
        ) VALUES (
          v_category, NULL, v_phone_e164, v_group.brand_id,
          v_payload || jsonb_build_object('channel_hint', 'sms'),
          'stay:' || NEW.id || ':' || v_category || ':sms:' ||
            v_recipient.user_id,
          public.mingla_e164_country(v_phone_e164)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  ELSE
    SELECT
      v_group.user_id AS user_id,
      COALESCE(
        NULLIF(v_group.guest_snapshot->>'email', ''),
        user_row.email
      ) AS email,
      COALESCE(
        NULLIF(v_group.guest_snapshot->>'phone', ''),
        user_row.phone
      ) AS phone
    INTO v_recipient
    FROM auth.users user_row
    WHERE user_row.id = v_group.user_id;
    -- Producer J — guest EMAIL leg. Country underivable from an email.
    IF v_group.user_id IS NOT NULL OR v_recipient.email IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code
      ) VALUES (
        v_category, v_group.user_id, lower(v_recipient.email),
        v_group.brand_id, v_payload,
        'stay:' || NEW.id || ':' || v_category || ':guest',
        NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    -- Producer K — guest SMS leg. #1529: normalise FIRST, gate on the
    -- normalised value (see producer I).
    v_phone_e164 := public.mingla_e164_normalize(v_recipient.phone);
    IF v_phone_e164 IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code
      ) VALUES (
        v_category, NULL, v_phone_e164, v_group.brand_id,
        v_payload || jsonb_build_object('channel_hint', 'sms'),
        'stay:' || NEW.id || ':' || v_category || ':guest-sms',
        public.mingla_e164_country(v_phone_e164)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Booking reads (guest by token, signed-in owner, staff).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_booking_projection(p_group_id uuid, p_qr_pepper text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'groupId', g.id,
    'reference', g.public_reference,
    'offerKind', g.offer_kind,
    'state', g.state,
    'version', g.version,
    'bookingSource', g.booking_source,
    'paymentCollection', g.payment_collection,
    'currencyCode', g.currency_code,
    'subtotalMinor', g.source_subtotal_minor,
    'feeMinor', g.fee_total_minor,
    'taxMinor', g.tax_total_minor,
    'totalMinor', g.total_minor,
    'paidMinor', COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
                           WHERE a.group_id = g.id AND a.state = 'succeeded'), 0),
    'refundedMinor', COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                               WHERE r.group_id = g.id AND r.state IN ('submitted', 'processing', 'succeeded')), 0),
    'balanceDueMinor', 0,
    'amountDueNowMinor', CASE WHEN g.state = 'instant_payment_pending' AND g.payment_collection = 'mingla'
                              THEN g.total_minor ELSE 0 END,
    'holdUntil', (SELECT h.expires_at FROM public.stay_inventory_holds h
                  WHERE h.group_id = g.id AND h.state = 'active'),
    'guest', jsonb_build_object(
      'name', g.guest_snapshot->>'name',
      'email', g.guest_snapshot->>'email',
      'phone', g.guest_snapshot->>'phone'),
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug,
                'brandSlug', b.slug, 'brandName', b.name, 'address', v.address, 'city', v.city,
                'lat', v.lat, 'lng', v.lng, 'timezone', public.issue_4490_venue_timezone(v.id))
              FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = g.venue_id),
    'offer', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style)
              FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
              WHERE l.group_id = g.id ORDER BY l.created_at, l.id LIMIT 1),
    'window', (SELECT jsonb_build_object('localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
               FROM public.stay_reservation_lines l JOIN public.stay_place_windows w ON w.id = l.place_window_id
               WHERE l.group_id = g.id ORDER BY l.created_at, l.id LIMIT 1),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id, 'state', l.state, 'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName', 'guests', l.place_guests,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor, 'taxMinor', l.tax_minor, 'feeMinor', l.fee_minor, 'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel') ORDER BY l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = g.id), '[]'::jsonb),
    'policy', jsonb_build_object(
      'text', g.payment_plan_snapshot->>'policyText',
      'refundLadder', g.payment_plan_snapshot->'refundLadder',
      'dateChangeRule', g.payment_plan_snapshot->'dateChangeRule'),
    'vatMode', g.payment_plan_snapshot->>'vatMode',
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'passId', p.id, 'status', p.status, 'admits', p.admits, 'admittedCount', p.admitted_count,
        'validLocalDate', p.valid_local_date, 'validFrom', p.valid_from, 'validTo', p.valid_to,
        'holderName', p.holder_name, 'idCheckLabel', p.id_check_label, 'idCheckCount', p.id_check_count,
        'qrPayload', CASE WHEN p_qr_pepper IS NOT NULL AND p.status = 'valid'
                          THEN public.issue_4490_pass_qr_payload(p.id, p.qr_token_hash, p_qr_pepper) END)
        ORDER BY p.created_at)
      FROM public.venue_passes p WHERE p.group_id = g.id), '[]'::jsonb),
    'createdAt', g.created_at,
    'updatedAt', g.updated_at
  )
  FROM public.stay_reservation_groups g
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_get_offer_booking(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_qr_pepper text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_pepper text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_pepper := CASE WHEN p_qr_pepper IS NULL THEN NULL
                   ELSE public.biz_ticket_checkout_assert_qr_pepper(p_qr_pepper) END;
  RETURN public.issue_4490_booking_projection(v_group.id, v_pepper);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_my_offer_bookings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.issue_4490_booking_projection(g.id, NULL) ORDER BY g.created_at DESC, g.id DESC)
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL AND g.payment_collection = 'mingla'
      AND (g.user_id = v_uid OR g.booked_by_user_id = v_uid)
  ), '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Cancel and refund: every succeeded payment is refunded at the rate the
--    booking's snapshotted ladder gives (guest) or the operator rate (staff).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_cancel_actor(
  p_group public.stay_reservation_groups,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_group.offer_kind IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.issue_1389_service_role() THEN
    IF public.issue_4490_booking_actor_ok(p_group, p_token_hash, p_user_id) THEN
      RETURN 'guest';
    END IF;
    IF p_user_id IS NOT NULL AND public.issue_4490_can_manage_money(p_group.venue_id, p_user_id) THEN
      RETURN 'staff';
    END IF;
    RETURN NULL;
  END IF;
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_group.user_id = v_uid OR p_group.booked_by_user_id = v_uid THEN
    RETURN 'guest';
  END IF;
  IF public.issue_4490_can_manage_money(p_group.venue_id, v_uid) THEN
    RETURN 'staff';
  END IF;
  IF public.is_admin_user() THEN
    RETURN 'admin';
  END IF;
  RETURN NULL;
END;
$function$;

-- Refund basis points for one line: staff/admin use the operator rate; a guest
-- gets the first rung of the snapshotted ladder whose minutes-before is met
-- (an empty ladder = no refund for offers).
CREATE OR REPLACE FUNCTION public.issue_4490_line_refund_bps(p_line_id uuid, p_actor_type text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_actor_type IN ('staff', 'admin', 'system')
      THEN COALESCE((l.policy_snapshot->>'operator_cancel_refund_basis_points')::integer, 10000)
    ELSE COALESCE((
      SELECT (rung->>'refund_bps')::integer
      FROM jsonb_array_elements(COALESCE(l.policy_snapshot->'refund_ladder', '[]'::jsonb)) WITH ORDINALITY AS r(rung, ord)
      WHERE (rung->>'min_minutes_before')::integer
            <= floor(extract(epoch FROM (w.starts_at - now())) / 60)
      ORDER BY ord
      LIMIT 1
    ), 0)
  END
  FROM public.stay_reservation_lines l
  LEFT JOIN public.stay_place_windows w ON w.id = l.place_window_id
  WHERE l.id = p_line_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_cancel_preview(
  p_group_id uuid,
  p_token_hash bytea DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_actor text;
  v_actor_user uuid;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_selected uuid[];
  v_snapshot jsonb;
  v_amount bigint;
  v_preview_id uuid;
  v_hash text;
  v_expires timestamptz := now() + interval '10 minutes';
  v_previews jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_paid bigint := 0;
  v_combined text;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public.issue_4490_cancel_actor(v_group, p_token_hash, p_user_id);
  IF v_actor IS NULL THEN
    IF public.issue_1389_service_role() OR auth.uid() IS NULL THEN
      RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_actor_user := COALESCE(auth.uid(), p_user_id);
  IF v_actor = 'guest' AND p_token_hash IS NOT NULL AND public.issue_1389_service_role() THEN
    v_actor_user := p_user_id;
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  -- Guests cannot cancel once the booking has started.
  IF v_actor = 'guest' AND EXISTS (
    SELECT 1 FROM public.stay_reservation_lines l
    JOIN public.stay_place_windows w ON w.id = l.place_window_id
    WHERE l.group_id = v_group.id AND l.state = 'confirmed' AND w.starts_at <= now()
      AND (SELECT o.entry_style FROM public.stay_offerings o WHERE o.id = l.offering_id) = 'timed_session'
  ) THEN
    RAISE EXCEPTION 'offer_cancel_too_late' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_passes p WHERE p.group_id = v_group.id AND p.admitted_count > 0)
     AND v_actor = 'guest' THEN
    RAISE EXCEPTION 'offer_already_checked_in' USING ERRCODE = 'PT409';
  END IF;
  SELECT array_agg(l.id ORDER BY l.id) INTO v_selected
  FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed';
  IF v_selected IS NULL THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  PERFORM set_config('mingla.issue_4490_offer_rail', v_group.id::text, true);

  FOR v_attempt IN
    SELECT * FROM public.stay_payment_attempts
    WHERE group_id = v_group.id AND state = 'succeeded'
    ORDER BY succeeded_at, id
  LOOP
    v_paid := v_paid + v_attempt.amount_minor;
    WITH eligible AS (
      SELECT allocation.id AS payment_allocation_id, allocation.reservation_line_id,
        allocation.component, allocation.component_ref, allocation.refund_treatment,
        GREATEST(0, allocation.charged_minor - allocation.refunded_minor - COALESCE((
          SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
          JOIN public.stay_refunds rr ON rr.id = ra.refund_id
          WHERE ra.payment_allocation_id = allocation.id
            AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0)) AS outstanding_minor,
        CASE
          WHEN allocation.refund_treatment = 'refundable' THEN 10000
          WHEN allocation.refund_treatment = 'nonrefundable' THEN 0
          ELSE public.issue_4490_line_refund_bps(allocation.reservation_line_id, v_actor)
        END AS refund_basis_points
      FROM public.stay_payment_allocations allocation
      WHERE allocation.payment_attempt_id = v_attempt.id
        AND allocation.reservation_line_id = ANY(v_selected)
    ),
    calculated AS (
      SELECT eligible.*,
        LEAST(outstanding_minor, (outstanding_minor::numeric * refund_basis_points + 5000)::bigint / 10000) AS refund_minor
      FROM eligible
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'paymentAllocationId', payment_allocation_id,
        'reservationLineId', reservation_line_id,
        'component', component,
        'componentRef', component_ref,
        'refundTreatment', refund_treatment,
        'refundBasisPoints', refund_basis_points,
        'amountMinor', refund_minor::text,
        'attemptId', v_attempt.id
      ) ORDER BY reservation_line_id, payment_allocation_id), '[]'::jsonb),
      COALESCE(sum(refund_minor), 0)
    INTO v_snapshot, v_amount
    FROM calculated WHERE refund_minor > 0;
    v_preview_id := gen_random_uuid();
    v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
      'previewId', v_preview_id, 'groupId', v_group.id, 'groupVersion', v_group.version,
      'attemptId', v_attempt.id, 'actorType', v_actor, 'amountMinor', v_amount::text,
      'allocations', v_snapshot, 'expiresAt', v_expires)::text, 'UTF8')), 'hex');
    INSERT INTO public.stay_cancel_previews (
      id, group_id, actor_user_id, actor_type, selected_line_ids, group_version, amount_minor,
      allocation_snapshot, preview_hash, expires_at, actor_token_hash
    ) VALUES (
      v_preview_id, v_group.id, v_actor_user, v_actor, v_selected, v_group.version, v_amount,
      v_snapshot, v_hash, v_expires, CASE WHEN v_actor = 'guest' THEN p_token_hash END
    );
    v_previews := v_previews || jsonb_build_object('previewId', v_preview_id, 'previewHash', v_hash,
      'attemptId', v_attempt.id, 'refundMinor', v_amount);
    v_total := v_total + v_amount;
  END LOOP;

  -- A booking with nothing paid through Mingla (gate cash, property) still
  -- gets one preview row: cancelling releases the seats and refunds nothing.
  IF jsonb_array_length(v_previews) = 0 THEN
    v_preview_id := gen_random_uuid();
    v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
      'previewId', v_preview_id, 'groupId', v_group.id, 'groupVersion', v_group.version,
      'actorType', v_actor, 'amountMinor', '0', 'expiresAt', v_expires)::text, 'UTF8')), 'hex');
    INSERT INTO public.stay_cancel_previews (
      id, group_id, actor_user_id, actor_type, selected_line_ids, group_version, amount_minor,
      allocation_snapshot, preview_hash, expires_at, actor_token_hash
    ) VALUES (
      v_preview_id, v_group.id, v_actor_user, v_actor, v_selected, v_group.version, 0,
      '[]'::jsonb, v_hash, v_expires, CASE WHEN v_actor = 'guest' THEN p_token_hash END
    );
    v_previews := jsonb_build_array(jsonb_build_object('previewId', v_preview_id, 'previewHash', v_hash,
      'attemptId', NULL, 'refundMinor', 0));
  END IF;

  SELECT encode(pg_catalog.sha256(convert_to(string_agg(p->>'previewHash', '|' ORDER BY p->>'previewId'), 'UTF8')), 'hex')
  INTO v_combined FROM jsonb_array_elements(v_previews) p;

  RETURN jsonb_build_object(
    'groupId', v_group.id,
    'groupVersion', v_group.version,
    'actorType', v_actor,
    'previewIds', (SELECT jsonb_agg(p->'previewId' ORDER BY p->>'previewId') FROM jsonb_array_elements(v_previews) p),
    'previewHash', v_combined,
    'previews', v_previews,
    'paidMinor', v_paid,
    'refundMinor', v_total,
    'keepMinor', v_paid - v_total,
    'currencyCode', v_group.currency_code,
    'paymentCollection', v_group.payment_collection,
    'expiresAt', v_expires
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_cancel(
  p_preview_ids uuid[],
  p_preview_hash text,
  p_idempotency_key text,
  p_reason text,
  p_token_hash bytea DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_first public.stay_cancel_previews%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_actor text;
  v_combined text;
  v_fee_reversal bigint;
  v_fee_remaining bigint;
  v_existing_fee bigint;
  v_attempt_id uuid;
  v_ordinal integer := 0;
  v_refund_ids jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_reason text := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Cancelled by request');
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_requester uuid;
BEGIN
  IF p_preview_ids IS NULL OR cardinality(p_preview_ids) NOT BETWEEN 1 AND 20
     OR COALESCE(p_preview_hash, '') !~ '^[a-f0-9]{64}$'
     OR char_length(v_key) NOT BETWEEN 8 AND 200
     OR char_length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_first FROM public.stay_cancel_previews WHERE id = p_preview_ids[1];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer-cancel:' || v_first.group_id::text, 4490));
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_first.group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  -- Replay: the same key returns the first result.
  IF EXISTS (
    SELECT 1 FROM public.stay_reservation_events e
    WHERE e.group_id = v_group.id AND e.idempotency_key = 'offer-cancel:' || v_key
  ) THEN
    RETURN jsonb_build_object(
      'groupId', v_group.id, 'state', v_group.state, 'replayed', true,
      'refundMinor', COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                               WHERE r.group_id = v_group.id AND r.idempotency_key LIKE 'offer-refund:' || v_key || ':%'), 0),
      'refunds', COALESCE((SELECT jsonb_agg(jsonb_build_object('refundId', r.id, 'state', r.state,
                    'amountMinor', r.amount_minor) ORDER BY r.created_at)
                  FROM public.stay_refunds r
                  WHERE r.group_id = v_group.id AND r.idempotency_key LIKE 'offer-refund:' || v_key || ':%'), '[]'::jsonb));
  END IF;
  v_actor := public.issue_4490_cancel_actor(v_group, p_token_hash, p_user_id);
  IF v_actor IS NULL OR v_actor <> v_first.actor_type
     OR (v_actor = 'guest' AND v_first.actor_token_hash IS NOT NULL
         AND v_first.actor_token_hash IS DISTINCT FROM p_token_hash) THEN
    RAISE EXCEPTION 'offer_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  v_requester := COALESCE(auth.uid(), p_user_id);
  -- The previews must be exactly the set of one preview call, unexpired, unused.
  SELECT encode(pg_catalog.sha256(convert_to(string_agg(p.preview_hash, '|' ORDER BY p.id::text), 'UTF8')), 'hex')
  INTO v_combined
  FROM public.stay_cancel_previews p WHERE p.id = ANY(p_preview_ids);
  IF v_combined IS DISTINCT FROM p_preview_hash
     OR (SELECT count(*) FROM public.stay_cancel_previews p WHERE p.id = ANY(p_preview_ids)) <> cardinality(p_preview_ids)
     OR EXISTS (SELECT 1 FROM public.stay_cancel_previews p WHERE p.id = ANY(p_preview_ids)
                AND (p.group_id <> v_group.id OR p.consumed_at IS NOT NULL OR p.expires_at <= now()
                     OR p.group_version <> v_group.version OR p.actor_type <> v_actor)) THEN
    RAISE EXCEPTION 'offer_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  PERFORM set_config('mingla.issue_4490_offer_rail', v_group.id::text, true);

  FOR v_preview IN
    SELECT * FROM public.stay_cancel_previews WHERE id = ANY(p_preview_ids) ORDER BY id FOR UPDATE
  LOOP
    v_ordinal := v_ordinal + 1;
    v_attempt_id := (v_preview.allocation_snapshot->0->>'attemptId')::uuid;
    IF v_attempt_id IS NOT NULL THEN
      SELECT * INTO v_attempt FROM public.stay_payment_attempts
      WHERE id = v_attempt_id AND group_id = v_group.id AND state = 'succeeded' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'offer_cancel_preview_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT COALESCE(sum(application_fee_reversal_minor), 0) INTO v_existing_fee
      FROM public.stay_refunds prior_refund
      WHERE prior_refund.payment_attempt_id = v_attempt.id
        AND prior_refund.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation');
      v_fee_remaining := GREATEST(0, v_attempt.application_fee_minor - v_existing_fee);
      v_fee_reversal := CASE
        WHEN v_preview.amount_minor = 0 THEN 0
        WHEN v_preview.amount_minor >= (
          SELECT COALESCE(sum(a.charged_minor - a.refunded_minor), 0)
          FROM public.stay_payment_allocations a WHERE a.payment_attempt_id = v_attempt.id
        ) THEN v_fee_remaining
        ELSE LEAST(v_fee_remaining,
          (v_attempt.application_fee_minor::numeric * v_preview.amount_minor + v_attempt.amount_minor / 2)::bigint
            / v_attempt.amount_minor)
      END;
      INSERT INTO public.stay_refunds (
        group_id, payment_attempt_id, cancel_preview_id, requested_by_type, requested_by_user_id,
        reason, state, amount_minor, application_fee_reversal_minor, currency_code, provider, idempotency_key
      ) VALUES (
        v_group.id, v_attempt.id, v_preview.id, v_preview.actor_type, v_requester, v_reason,
        CASE WHEN v_preview.amount_minor = 0 THEN 'succeeded' ELSE 'submitted' END,
        v_preview.amount_minor, v_fee_reversal, v_group.currency_code, v_attempt.provider,
        'offer-refund:' || v_key || ':' || v_ordinal
      ) RETURNING * INTO v_refund;
      IF v_preview.amount_minor > 0 THEN
        WITH requested AS (
          SELECT (item->>'paymentAllocationId')::uuid AS payment_allocation_id,
                 (item->>'reservationLineId')::uuid AS reservation_line_id,
                 (item->>'amountMinor')::bigint AS amount_minor
          FROM jsonb_array_elements(v_preview.allocation_snapshot) item
        ),
        floors AS (
          SELECT requested.*,
            floor(v_fee_reversal::numeric * requested.amount_minor / v_preview.amount_minor)::bigint AS fee_floor,
            (v_fee_reversal::numeric * requested.amount_minor
              - floor(v_fee_reversal::numeric * requested.amount_minor / v_preview.amount_minor)
                * v_preview.amount_minor) AS remainder
          FROM requested
        ),
        ranked AS (
          SELECT floors.*,
            row_number() OVER (ORDER BY remainder DESC, payment_allocation_id) AS remainder_rank,
            v_fee_reversal - sum(fee_floor) OVER () AS extras
          FROM floors
        )
        INSERT INTO public.stay_refund_allocations (
          refund_id, payment_allocation_id, reservation_line_id, amount_minor,
          organizer_liability_minor, platform_fee_reversal_minor, state
        )
        SELECT v_refund.id, ranked.payment_allocation_id, ranked.reservation_line_id, ranked.amount_minor,
          ranked.amount_minor - (ranked.fee_floor + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END),
          ranked.fee_floor + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END,
          'submitted'
        FROM ranked;
        INSERT INTO public.source_refunds (
          source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
          requested_by_type, requested_by_user_id, reason, provider, currency,
          original_charge_cents, buyer_refund_requested_cents,
          original_application_fee_cents, fee_reversal_required_cents,
          fee_state, fee_leg_kind, financial_state,
          organizer_refund_liability_cents, platform_fee_absorption_cents,
          provider_payment_reference, provider_account_reference, idempotency_key
        ) VALUES (
          'stay_reservation', v_refund.id, v_group.id, v_group.brand_id, v_group.venue_id, 'stay_cancellation',
          CASE v_preview.actor_type WHEN 'guest' THEN 'consumer' WHEN 'admin' THEN 'admin' ELSE 'brand_staff' END,
          v_requester, v_reason, v_attempt.provider, v_group.currency_code::text,
          v_attempt.amount_minor::integer, v_refund.amount_minor::integer,
          v_attempt.application_fee_minor::integer, v_fee_reversal::integer,
          CASE WHEN v_fee_reversal = 0 THEN 'not_required' ELSE 'queued' END,
          CASE WHEN v_fee_reversal = 0 THEN 'not_required'
               WHEN v_attempt.provider = 'stripe' THEN 'stripe_application_fee_refund'
               ELSE 'paystack_ledger_allocation' END,
          'pending',
          (v_refund.amount_minor - v_fee_reversal)::integer, v_fee_reversal::integer,
          v_attempt.provider_payment_ref, v_attempt.connected_account_ref,
          'stay-refund:' || v_refund.id
        ) RETURNING * INTO v_source;
        UPDATE public.stay_refunds SET source_refund_id = v_source.id, updated_at = now()
        WHERE id = v_refund.id RETURNING * INTO v_refund;
        INSERT INTO public.source_refund_ledger_allocations (
          refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
        ) VALUES (
          v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents, v_source.currency,
          v_source.provider, 'prepared', 'source-refund-allocation:buyer:' || v_source.id
        );
        IF v_source.organizer_refund_liability_cents > 0 THEN
          INSERT INTO public.source_refund_ledger_allocations (
            refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
          ) VALUES (
            v_source.id, 'organizer_refund_liability', v_source.organizer_refund_liability_cents,
            v_source.currency, v_source.provider, 'prepared', 'source-refund-allocation:organizer:' || v_source.id
          );
        END IF;
        IF v_source.platform_fee_absorption_cents > 0 THEN
          INSERT INTO public.source_refund_ledger_allocations (
            refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
          ) VALUES (
            v_source.id, 'platform_application_fee_reversal', v_source.platform_fee_absorption_cents,
            v_source.currency, v_source.provider, 'prepared', 'source-refund-allocation:platform:' || v_source.id
          );
        END IF;
        INSERT INTO public.stay_money_ledger (
          group_id, payment_attempt_id, refund_id, entry_type, amount_minor, currency_code,
          idempotency_key, metadata
        ) VALUES (
          v_group.id, v_attempt.id, v_refund.id, 'refund_requested', v_refund.amount_minor,
          v_group.currency_code, 'stay:refund_requested:' || v_refund.id,
          jsonb_build_object('reason', 'venue_offer_cancelled')
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
      v_refund_ids := v_refund_ids || jsonb_build_object('refundId', v_refund.id, 'state', v_refund.state,
        'amountMinor', v_refund.amount_minor);
      v_total := v_total + v_refund.amount_minor;
    END IF;
    UPDATE public.stay_cancel_previews SET consumed_at = now() WHERE id = v_preview.id;
  END LOOP;

  UPDATE public.stay_inventory_commitments
  SET state = 'released', released_at = now(), release_reason = 'reservation_cancelled'
  WHERE group_id = v_group.id AND state = 'active';
  UPDATE public.stay_reservation_lines
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id AND state = 'confirmed';
  UPDATE public.stay_reservation_groups
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_cancelled', v_actor, v_requester, 'offer-cancel:' || v_key,
    jsonb_build_object('amountMinor', v_total::text, 'currencyCode', v_group.currency_code,
      'refunds', v_refund_ids, 'refundId', v_refund_ids->0->>'refundId')
  );
  RETURN jsonb_build_object(
    'groupId', v_group.id, 'state', 'cancelled', 'replayed', false,
    'refundMinor', v_total, 'currencyCode', v_group.currency_code, 'refunds', v_refund_ids);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Public page: offers[] and VAT (live offers of publicly enabled kinds).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_public_offers(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'kind', o.kind,
      'entryStyle', o.entry_style,
      'name', o.name,
      'summary', NULLIF(o.summary, ''),
      'fromMinor', (SELECT min(p.amount_minor) FROM public.venue_offer_price_options opt
                    JOIN public.stay_price_versions p ON p.price_option_id = opt.id AND p.effective_to IS NULL
                    WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'unit', COALESCE((SELECT opt.unit FROM public.venue_offer_price_options opt
                        WHERE opt.offering_id = o.id AND opt.status = 'active'
                        ORDER BY opt.sort_order LIMIT 1), 'guest'),
      'guestMin', (SELECT min(opt.guest_min) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'guestMax', (SELECT max(opt.guest_max) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
      'spaceIds', (SELECT jsonb_agg(s.space_id ORDER BY s.space_id) FROM public.venue_offer_spaces s
                   WHERE s.offering_id = o.id),
      'sortOrder', o.sort_order
    ) ORDER BY o.sort_order, o.created_at)
    FROM public.stay_offerings o
    WHERE o.venue_id = p_venue_id AND o.status = 'live'
      AND o.kind = ANY(public.issue_4490_built_offer_kinds())
      AND public.issue_4490_offer_kind_feature(o.kind) = ANY(p_features)
  ), '[]'::jsonb) END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_payload(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row jsonb;
  v_features text[];
  v_currency text;
  v_brand_slug text;
  v_spaces jsonb;
  v_events jsonb;
  v_tables jsonb;
  v_version bigint;
  v_offers jsonb;
  v_vat jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := public.issue_4490_venue_page_row(p_venue_id);
  v_features := public.issue_4490_public_features(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.slug
    INTO v_currency, v_brand_slug
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'setting', s.setting,
      'capacityStanding', s.capacity_standing,
      'capacitySeated', s.capacity_seated,
      'planShape', s.plan_shape,
      'photoUrls', (SELECT COALESCE(jsonb_agg(p->>'url' ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(s.photos) WITH ORDINALITY AS ph(p, i))
    )) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  INTO v_spaces
  FROM public.venue_spaces s
  WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL;

  IF 'events_here' = ANY(v_features) THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY starts_at), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT jsonb_build_object(
          'id', e.id,
          'kind', e.event_type,
          'title', e.title,
          'startsAt', nd.starts_at,
          'spaceName', sp.name,
          'fromMinor', (SELECT min(tt.price_cents) FROM public.ticket_types tt
                        WHERE tt.event_id = e.id AND tt.deleted_at IS NULL
                          AND NOT COALESCE(tt.is_hidden, false) AND NOT COALESCE(tt.is_disabled, false)),
          'href', CASE e.event_type
                    WHEN 'experience' THEN '/exp/' || v_brand_slug || '/' || e.slug
                    WHEN 'trip' THEN '/t/' || v_brand_slug || '/' || e.slug
                    ELSE '/e/' || v_brand_slug || '/' || e.slug END
        ) AS item,
        nd.starts_at
      FROM public.events e
      CROSS JOIN LATERAL (
        SELECT min(d.start_at) AS starts_at FROM public.event_dates d
        WHERE d.event_id = e.id AND d.start_at > now()
      ) nd
      LEFT JOIN public.venue_spaces sp ON sp.id = e.space_id
      WHERE e.venue_id = p_venue_id
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
        AND e.slug IS NOT NULL
        AND nd.starts_at IS NOT NULL
      ORDER BY nd.starts_at
      LIMIT 6
    ) upcoming;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  IF 'table_reservations' = ANY(v_features) THEN
    v_tables := jsonb_build_object(
      'partyMax', (SELECT LEAST(100, max(t.capacity)) FROM public.venue_tables t
                   WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
                     AND t.reservation_policy = 'reservable'),
      'pickATable', NULL,
      'holdFromMinor', NULL,
      'minSpendFromMinor', NULL,
      'largePartyRequest', NULL,
      'guestWaitlist', NULL
    );
  END IF;

  -- #4490 P2: live offers of publicly enabled kinds, and the venue's VAT mode.
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  SELECT jsonb_build_object(
      'mode', s.vat_mode,
      'ratePct', COALESCE((SELECT c.vat_rate_bps FROM public.country_vat_config c
                           WHERE c.country = upper(v_venue.country_code)), 0)::numeric / 100)
    INTO v_vat
  FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id;
  IF jsonb_array_length(v_offers) = 0 THEN
    v_vat := NULL;
  END IF;

  SELECT GREATEST(
      COALESCE((SELECT max(f.version) FROM public.venue_features f WHERE f.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(s.version) FROM public.venue_spaces s WHERE s.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(o.version) FROM public.stay_offerings o
                WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place')), 0))
  INTO v_version;

  RETURN jsonb_build_object(
    'version', v_version,
    'venue', v_row,
    'currencyCode', v_currency,
    -- #4490 W3 fix 1: the exponent comes from its one owner (supported_brand_currencies).
    'minorUnitExponent', COALESCE((SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
                                   WHERE c.code = v_currency), 2),
    'vat', v_vat,
    'features', to_jsonb(v_features),
    'spaces', v_spaces,
    'hours', jsonb_build_object('weekly', v_row->'hours_windows', 'specialDays', v_row->'special_hours'),
    'events', jsonb_build_object('upcoming', v_events),
    'tables', v_tables,
    'offers', v_offers,
    'memberships', '[]'::jsonb
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_pass_qr_payload(uuid, text, text),
  public.issue_4490_day_closed(uuid, date),
  public.issue_4490_pool_day_usage(uuid, date),
  public.issue_4490_window_used(uuid),
  public.issue_4490_window_cutoff(uuid, uuid),
  public.issue_4490_option_price_at(uuid, uuid),
  public.issue_4490_option_window_reason(uuid, uuid),
  public.pg_venue_offer_availability(uuid, date, date, integer, uuid),
  public.issue_4490_quote_projection(uuid),
  public.issue_4490_quote_offer(uuid, uuid, jsonb, text, uuid, text),
  public.issue_4490_quote_offer_internal(uuid, uuid, jsonb, text, uuid, text, boolean),
  public.issue_4490_assert_offer_guest(jsonb, boolean),
  public.issue_4490_hold_offer_internal(uuid, uuid, jsonb, text, uuid, bytea, text, boolean, uuid, text),
  public.issue_4490_create_offer_group(uuid, uuid, jsonb, text, uuid, bytea, text),
  public.issue_4490_booking_actor_ok(public.stay_reservation_groups, bytea, uuid),
  public.issue_4490_prepare_offer_payment(uuid, bytea, uuid, text, bigint),
  public.issue_4490_issue_offer_pass(uuid),
  public.issue_4490_on_offer_group_state(),
  public.issue_4490_enqueue_offer_event(public.stay_reservation_events, public.stay_reservation_groups),
  public.issue_4490_booking_projection(uuid, text),
  public.issue_4490_get_offer_booking(uuid, bytea, uuid, text),
  public.issue_4490_my_offer_bookings(),
  public.issue_4490_cancel_actor(public.stay_reservation_groups, bytea, uuid),
  public.issue_4490_line_refund_bps(uuid, text),
  public.issue_4490_cancel_preview(uuid, bytea, uuid),
  public.issue_4490_cancel(uuid[], text, text, text, bytea, uuid),
  public.issue_4490_public_offers(uuid, text[])
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pg_venue_offer_availability(uuid, date, date, integer, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_my_offer_bookings(),
  public.issue_4490_cancel_preview(uuid, bytea, uuid),
  public.issue_4490_cancel(uuid[], text, text, text, bytea, uuid)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_pass_qr_payload(uuid, text, text),
  public.issue_4490_day_closed(uuid, date),
  public.issue_4490_pool_day_usage(uuid, date),
  public.issue_4490_window_used(uuid),
  public.issue_4490_window_cutoff(uuid, uuid),
  public.issue_4490_option_price_at(uuid, uuid),
  public.issue_4490_option_window_reason(uuid, uuid),
  public.issue_4490_quote_projection(uuid),
  public.issue_4490_quote_offer(uuid, uuid, jsonb, text, uuid, text),
  public.issue_4490_create_offer_group(uuid, uuid, jsonb, text, uuid, bytea, text),
  public.issue_4490_prepare_offer_payment(uuid, bytea, uuid, text, bigint),
  public.issue_4490_booking_projection(uuid, text),
  public.issue_4490_get_offer_booking(uuid, bytea, uuid, text),
  public.issue_4490_public_offers(uuid, text[])
TO service_role;

COMMIT;
