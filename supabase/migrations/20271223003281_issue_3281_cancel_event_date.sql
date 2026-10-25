-- issue #3281 PR9 — cancel one event date (status + preview/execute RPC).
-- Pass refund default: 1/N of paid order total for tickets covering this date
-- (pending Seth confirmation of the default; preview returns the same numbers).

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
  v_is_pass boolean;
  v_date_count integer;
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

  SELECT e.brand_id,
         (e.is_multi_date IS TRUE AND e.is_recurring IS NOT TRUE
          AND COALESCE(e.theme->'business_event'->>'multi_date_pricing_mode', 'per_day') = 'all_days'),
         e.currency
    INTO v_brand, v_is_pass, v_currency
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
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

  SELECT count(*)::integer INTO v_date_count
    FROM public.event_dates d
   WHERE d.event_id = p_event_id AND d.status = 'active';

  -- Buyers with a live ticket covering this date.
  SELECT count(DISTINCT o.id)::integer,
         COALESCE(sum(
           CASE
             WHEN v_is_pass AND v_date_count > 0 THEN
               (o.total_cents / v_date_count)
             ELSE o.total_cents
           END
         ), 0)::bigint
    INTO v_buyer_count, v_amount_cents
    FROM public.orders o
    JOIN public.tickets tk ON tk.order_id = o.id
    JOIN public.ticket_event_dates ted ON ted.ticket_id = tk.id
   WHERE o.event_id = p_event_id
     AND o.payment_status = 'paid'
     AND COALESCE(o.refunded_amount_cents, 0) < o.total_cents
     AND ted.event_date_id = p_event_date_id
     AND tk.status = ANY (ARRAY['valid'::text, 'used'::text, 'transferred'::text]);

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
   WHERE id = p_event_date_id;

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
  'issue #3281 PR9 — preview or cancel one event_dates row; returns buyer/amount for confirm.';

-- Stable-id time move (keeps ticket_event_dates FK).
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at < p_start_at THEN
    RAISE EXCEPTION 'invalid_time_range';
  END IF;

  SELECT e.brand_id INTO v_brand
    FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_brand, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.status = 'active'
  ) THEN
    RAISE EXCEPTION 'occurrence_not_found';
  END IF;

  UPDATE public.event_dates
     SET start_at = p_start_at, end_at = p_end_at
   WHERE id = p_event_date_id;

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

COMMIT;
