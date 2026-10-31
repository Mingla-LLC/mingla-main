-- issue #3281 PR9 — cancel one event date (status + preview/execute RPC).
-- Preview quotes estimated refund liability (1/N of each ticket's covered
-- dates on all-days passes; remaining / live order tickets for day-scoped).
-- Execute cancels the date only — date-scoped refund fan-out is a follow-up
-- once Seth confirms the default (Host copy must not claim refunds completed).

BEGIN;

ALTER TABLE public.event_dates
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_dates_status_check'
       AND conrelid = 'public.event_dates'::regclass
  ) THEN
    ALTER TABLE public.event_dates
      ADD CONSTRAINT event_dates_status_check
      CHECK (status = ANY (ARRAY['active'::text, 'cancelled'::text]));
  END IF;
END;
$chk$;

COMMENT ON COLUMN public.event_dates.status IS
  'issue #3281 PR9 — active | cancelled. Cancelled dates are not selectable.';

CREATE OR REPLACE FUNCTION public.business_cancel_event_date(
  p_event_id uuid,
  p_event_date_id uuid,
  p_reason text,
  p_preview boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand uuid;
  v_event_status text;
  v_is_pass boolean;
  v_buyer_count integer := 0;
  v_amount_cents bigint := 0;
  v_currency text;
  v_row public.event_dates%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  -- Lock event first (matches business_patch_event_when / issue_1930 order).
  SELECT e.brand_id,
         e.status,
         (e.is_multi_date IS TRUE AND e.is_recurring IS NOT TRUE
          AND COALESCE(e.multi_date_pricing_mode, 'per_day') = 'all_days'),
         e.currency
    INTO v_brand, v_event_status, v_is_pass, v_currency
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event_status IS DISTINCT FROM 'scheduled'
     AND v_event_status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'event_not_editable';
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT * INTO v_row
    FROM public.event_dates d
   WHERE d.id = p_event_date_id AND d.event_id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'occurrence_not_found';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'occurrence_already_cancelled';
  END IF;

  -- Affected tickets: explicit binding to this date OR legacy unscoped
  -- (zero ticket_event_dates rows = any-occurrence), matching
  -- issue_3313_ticket_type_occurrence_sold. Include partial_refund orders.
  -- Amount basis = buyer_total_cents (fees + tax) minus already refunded.
  -- All-days passes: remaining / covered dates (bindings, else active dates).
  -- Per-day: remaining / live tickets on the order (never the full order total
  -- for one of several day tickets). Cap by remaining refundable on the order.
  WITH affected AS (
    SELECT o.id AS order_id,
           tk.id AS ticket_id,
           GREATEST(
             0,
             COALESCE(o.buyer_total_cents, o.total_cents, 0)
               - COALESCE(o.refunded_amount_cents, 0)
           )::bigint AS remaining_cents,
           GREATEST(
             1,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM public.ticket_event_dates ted_any
                  WHERE ted_any.ticket_id = tk.id
               ) THEN (
                 SELECT count(*)::integer
                   FROM public.ticket_event_dates ted_all
                  WHERE ted_all.ticket_id = tk.id
               )
               ELSE (
                 SELECT count(*)::integer
                   FROM public.event_dates d_cov
                  WHERE d_cov.event_id = p_event_id
                    AND COALESCE(d_cov.status, 'active') = 'active'
               )
             END
           )::integer AS covered_dates,
           GREATEST(
             1,
             (
               SELECT count(*)::integer
                 FROM public.tickets tk_ord
                WHERE tk_ord.order_id = o.id
                  AND tk_ord.status = ANY (
                    ARRAY['valid'::text, 'used'::text, 'transferred'::text]
                  )
             )
           )::integer AS order_live_tickets
      FROM public.orders o
      JOIN public.tickets tk ON tk.order_id = o.id
     WHERE o.event_id = p_event_id
       AND o.payment_status = ANY (ARRAY['paid'::text, 'partial_refund'::text])
       AND tk.status = ANY (ARRAY['valid'::text, 'used'::text, 'transferred'::text])
       AND (
         EXISTS (
           SELECT 1 FROM public.ticket_event_dates ted
            WHERE ted.ticket_id = tk.id AND ted.event_date_id = p_event_date_id
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.ticket_event_dates ted
            WHERE ted.ticket_id = tk.id
         )
       )
  ),
  per_ticket AS (
    SELECT order_id,
           ticket_id,
           remaining_cents,
           CASE
             WHEN v_is_pass THEN
               (remaining_cents / covered_dates)
             ELSE
               (remaining_cents / order_live_tickets)
           END::bigint AS share_cents
      FROM affected
  ),
  capped AS (
    SELECT order_id,
           least(
             sum(share_cents),
             max(remaining_cents)
           )::bigint AS order_share
      FROM per_ticket
     GROUP BY order_id
  )
  SELECT count(*)::integer,
         COALESCE(sum(order_share), 0)::bigint
    INTO v_buyer_count, v_amount_cents
    FROM capped;

  IF p_preview IS TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'preview', true,
      'eventDateId', p_event_date_id,
      'buyerCount', COALESCE(v_buyer_count, 0),
      'amountCents', COALESCE(v_amount_cents, 0),
      'currency', v_currency,
      'passProration', v_is_pass
    );
  END IF;

  UPDATE public.event_dates
     SET status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = left(btrim(p_reason), 200)
   WHERE id = p_event_date_id
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'occurrence_already_cancelled';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'preview', false,
    'eventDateId', p_event_date_id,
    'buyerCount', COALESCE(v_buyer_count, 0),
    'amountCents', COALESCE(v_amount_cents, 0),
    'currency', v_currency,
    'passProration', v_is_pass,
    'status', 'cancelled'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_cancel_event_date(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_cancel_event_date(uuid, uuid, text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.business_cancel_event_date(uuid, uuid, text, boolean) IS
  'issue #3281 PR9 — preview or cancel one event_dates row; amountCents is estimated refund liability only.';

-- Stable-id time move (keeps ticket_event_dates FK). Sold dates must use the
-- refund-first schedule writer; this path only retimes unsold active dates on
-- scheduled/live parents.
CREATE OR REPLACE FUNCTION public.business_move_event_date_time(
  p_event_id uuid,
  p_event_date_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand uuid;
  v_event_status text;
  v_sold boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at < p_start_at THEN
    RAISE EXCEPTION 'invalid_time_range';
  END IF;

  SELECT e.brand_id, e.status INTO v_brand, v_event_status
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event_status IS DISTINCT FROM 'scheduled'
     AND v_event_status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'event_not_editable';
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  PERFORM 1 FROM public.event_dates d
   WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.status = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'occurrence_not_found';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.orders o
      JOIN public.tickets tk ON tk.order_id = o.id
     WHERE o.event_id = p_event_id
       AND o.payment_status = ANY (ARRAY['paid'::text, 'partial_refund'::text])
       AND tk.status = ANY (ARRAY['valid'::text, 'used'::text, 'transferred'::text])
       AND (
         EXISTS (
           SELECT 1 FROM public.ticket_event_dates ted
            WHERE ted.ticket_id = tk.id AND ted.event_date_id = p_event_date_id
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.ticket_event_dates ted
            WHERE ted.ticket_id = tk.id
         )
       )
  ) INTO v_sold;
  IF COALESCE(v_sold, false) THEN
    RAISE EXCEPTION 'sold_date_requires_schedule_writer';
  END IF;

  UPDATE public.event_dates
     SET start_at = p_start_at, end_at = p_end_at
   WHERE id = p_event_date_id AND status = 'active';

  RETURN jsonb_build_object(
    'ok', true,
    'eventDateId', p_event_date_id,
    'startAt', p_start_at,
    'endAt', p_end_at
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_move_event_date_time(uuid, uuid, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_move_event_date_time(uuid, uuid, timestamptz, timestamptz, text)
  TO authenticated, service_role;

-- Schedule helper: cancelled dates are not upcoming.
CREATE OR REPLACE FUNCTION public.issue_3281_event_schedule(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_upcoming integer := 0;
BEGIN
  SELECT count(*)::integer
    INTO v_upcoming
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND d.end_at > now()
     AND COALESCE(d.status, 'active') = 'active';

  SELECT d.start_at, d.end_at
    INTO v_next_start, v_next_end
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND d.end_at > now()
     AND COALESCE(d.status, 'active') = 'active'
   ORDER BY d.start_at, d.id
   LIMIT 1;

  RETURN jsonb_build_object(
    'nextStartAt', v_next_start,
    'nextEndAt', v_next_end,
    'upcomingCount', COALESCE(v_upcoming, 0),
    'scheduleLine', CASE
      WHEN v_upcoming IS NULL OR v_upcoming = 0 THEN NULL
      WHEN v_upcoming = 1 THEN to_char(v_next_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ELSE format('%s upcoming dates', v_upcoming)
    END
  );
END;
$fn$;

-- Preserve the PR7 privilege boundary: CREATE OR REPLACE keeps the OID but a
-- lane that skipped 20271222003281 would otherwise create this DEFINER helper
-- with default PUBLIC/anon EXECUTE. Always re-state the revoke/grant.
REVOKE ALL ON FUNCTION public.issue_3281_event_schedule(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule(uuid)
  TO service_role;

-- issue_3281_event_schedule above already omits cancelled dates. Broader
-- buyer-facing occurrence readers (checkout/discover laterals) get named
-- CREATE OR REPLACE updates in a follow-up — catalog string-rewrites are
-- refused by the #1860 RLS readability gate (EXECUTE of a variable) and
-- are unsafe against aliases like ed.end_at.

COMMIT;
