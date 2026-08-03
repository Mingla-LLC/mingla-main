-- Issue #1389: allocate one provider charge across Stay lines, then attach
-- matured Room and Place money to Mingla's existing payout-release ledger.

BEGIN;

CREATE TABLE public.stay_payout_line_snapshots (
  reservation_line_id uuid PRIMARY KEY
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL
    REFERENCES public.stay_payment_attempts(id) ON DELETE RESTRICT,
  platform_fee_minor integer NOT NULL CHECK (platform_fee_minor >= 0),
  provider_fee_minor integer NOT NULL CHECK (provider_fee_minor >= 0),
  provider_balance_transaction_id text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_attempt_id, reservation_line_id)
);

ALTER TABLE public.stay_payout_line_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stay_payout_line_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stay_payout_line_snapshots
  FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.stay_payout_line_snapshots TO service_role;

CREATE TRIGGER stay_payout_line_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.stay_payout_line_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_append_only();

CREATE OR REPLACE FUNCTION public.list_missing_stay_provider_fees(
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  source_type text,
  source_id uuid,
  provider text,
  provider_reference text,
  stripe_account_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    'stay_reservation'::text,
    attempt.id,
    attempt.provider,
    COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref),
    CASE WHEN attempt.provider = 'stripe'
      THEN attempt.connected_account_ref ELSE NULL END
  FROM public.stay_payment_attempts attempt
  JOIN public.stay_reservation_groups group_row
    ON group_row.id = attempt.group_id
  JOIN public.brands brand ON brand.id = group_row.brand_id
  WHERE attempt.state = 'succeeded'
    AND attempt.amount_minor > 0
    AND brand.payout_hold_cutover_at IS NOT NULL
    AND attempt.succeeded_at > brand.payout_hold_cutover_at
    AND COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref)
      IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.stay_payout_line_snapshots snapshot
      WHERE snapshot.payment_attempt_id = attempt.id
    )
  ORDER BY attempt.succeeded_at, attempt.id
  LIMIT greatest(1, least(p_limit, 500));
$function$;

-- Extend the existing provider-fee candidate stream. Legacy Order/RSVP/Venue
-- branches stay byte-for-behavior; Stay contributes one row per provider charge.
CREATE OR REPLACE FUNCTION public.list_missing_payout_source_fees(
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  source_type text, source_id uuid, provider text,
  provider_reference text, stripe_account_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT * FROM (
    SELECT 'order'::text AS source_type, order_row.id AS source_id,
      brand.payment_provider AS provider,
      CASE WHEN brand.payment_provider = 'paystack'
        THEN order_row.stripe_payment_intent_id
        ELSE coalesce(
          order_row.stripe_charge_id,
          order_row.stripe_payment_intent_id
        ) END AS provider_reference,
      CASE WHEN brand.payment_provider = 'stripe'
        THEN brand.stripe_connect_id ELSE NULL END AS stripe_account_id
    FROM public.orders order_row
    JOIN public.events event_row ON event_row.id = order_row.event_id
    JOIN public.brands brand ON brand.id = event_row.brand_id
    WHERE order_row.payment_status IN ('paid', 'partial_refund')
      AND order_row.total_cents > 0
      AND brand.payout_hold_cutover_at IS NOT NULL
      AND order_row.created_at > brand.payout_hold_cutover_at
    UNION ALL
    SELECT 'rsvp_contribution', contribution.id, contribution.provider,
      CASE WHEN contribution.provider = 'paystack'
        THEN contribution.stripe_payment_intent_id
        ELSE coalesce(
          contribution.stripe_charge_id,
          contribution.stripe_payment_intent_id
        ) END,
      CASE WHEN contribution.provider = 'stripe'
        THEN brand.stripe_connect_id ELSE NULL END
    FROM public.event_rsvp_contributions contribution
    JOIN public.brands brand ON brand.id = contribution.brand_id
    WHERE contribution.status IN ('paid', 'partially_refunded')
      AND brand.payout_hold_cutover_at IS NOT NULL
      AND coalesce(contribution.paid_at, contribution.created_at)
        > brand.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_reservation', session.id, brand.payment_provider,
      CASE WHEN brand.payment_provider = 'paystack'
        THEN session.paystack_reference
        ELSE session.stripe_payment_intent_id END,
      CASE WHEN brand.payment_provider = 'stripe'
        THEN session.stripe_account_id ELSE NULL END
    FROM public.reservation_checkout_sessions session
    JOIN public.reservations reservation
      ON reservation.id = session.reservation_id
    JOIN public.brands brand ON brand.id = session.brand_id
    WHERE session.status = 'completed'
      AND session.amount_cents > 0
      AND brand.payout_hold_cutover_at IS NOT NULL
      AND reservation.created_at > brand.payout_hold_cutover_at
    UNION ALL
    SELECT
      'stay_reservation',
      attempt.id,
      attempt.provider,
      COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref),
      CASE WHEN attempt.provider = 'stripe'
        THEN attempt.connected_account_ref ELSE NULL END
    FROM public.stay_payment_attempts attempt
    JOIN public.stay_reservation_groups group_row
      ON group_row.id = attempt.group_id
    JOIN public.brands brand ON brand.id = group_row.brand_id
    WHERE attempt.state = 'succeeded'
      AND brand.payout_hold_cutover_at IS NOT NULL
      AND attempt.succeeded_at > brand.payout_hold_cutover_at
      AND NOT EXISTS (
        SELECT 1
        FROM public.stay_payout_line_snapshots snapshot
        WHERE snapshot.payment_attempt_id = attempt.id
      )
  ) candidate
  WHERE candidate.provider_reference IS NOT NULL
    AND (
      candidate.source_type = 'stay_reservation'
      OR NOT EXISTS (
        SELECT 1
        FROM public.payout_source_fee_snapshots snapshot
        WHERE snapshot.source_type = candidate.source_type
          AND snapshot.source_id = candidate.source_id
      )
    )
  ORDER BY candidate.source_type, candidate.source_id
  LIMIT greatest(1, least(p_limit, 500));
$function$;

CREATE OR REPLACE FUNCTION public.record_stay_provider_fee(
  p_payment_attempt_id uuid,
  p_provider_fee_minor integer,
  p_provider_balance_transaction_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_inserted integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provider_fee_minor IS NULL OR p_provider_fee_minor < 0 THEN
    RAISE EXCEPTION 'stay_invalid_provider_fee' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE id = p_payment_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.state <> 'succeeded' THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH line_weights AS (
    SELECT
      line.id AS line_id,
      line.total_minor,
      floor(
        v_attempt.application_fee_minor::numeric * line.total_minor
          / v_attempt.amount_minor
      )::integer AS platform_floor,
      (
        v_attempt.application_fee_minor::numeric * line.total_minor
          - floor(
            v_attempt.application_fee_minor::numeric * line.total_minor
              / v_attempt.amount_minor
          ) * v_attempt.amount_minor
      ) AS platform_remainder,
      floor(
        p_provider_fee_minor::numeric * line.total_minor
          / v_attempt.amount_minor
      )::integer AS provider_floor,
      (
        p_provider_fee_minor::numeric * line.total_minor
          - floor(
            p_provider_fee_minor::numeric * line.total_minor
              / v_attempt.amount_minor
          ) * v_attempt.amount_minor
      ) AS provider_remainder
    FROM public.stay_reservation_lines line
    WHERE line.group_id = v_attempt.group_id
  ),
  ranked AS (
    SELECT
      line_weights.*,
      row_number() OVER (
        ORDER BY platform_remainder DESC, line_id
      ) AS platform_rank,
      row_number() OVER (
        ORDER BY provider_remainder DESC, line_id
      ) AS provider_rank,
      v_attempt.application_fee_minor
        - sum(platform_floor) OVER () AS platform_extras,
      p_provider_fee_minor
        - sum(provider_floor) OVER () AS provider_extras
    FROM line_weights
  ),
  inserted AS (
    INSERT INTO public.stay_payout_line_snapshots (
      reservation_line_id,
      payment_attempt_id,
      platform_fee_minor,
      provider_fee_minor,
      provider_balance_transaction_id
    )
    SELECT
      line_id,
      v_attempt.id,
      platform_floor
        + CASE WHEN platform_rank <= platform_extras THEN 1 ELSE 0 END,
      provider_floor
        + CASE WHEN provider_rank <= provider_extras THEN 1 ELSE 0 END,
      NULLIF(pg_catalog.btrim(
        COALESCE(p_provider_balance_transaction_id, '')
      ), '')
    FROM ranked
    ON CONFLICT (reservation_line_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  IF (
    SELECT COALESCE(sum(snapshot.platform_fee_minor), 0)
    FROM public.stay_payout_line_snapshots snapshot
    WHERE snapshot.payment_attempt_id = v_attempt.id
  ) <> v_attempt.application_fee_minor
     OR (
       SELECT COALESCE(sum(snapshot.provider_fee_minor), 0)
       FROM public.stay_payout_line_snapshots snapshot
       WHERE snapshot.payment_attempt_id = v_attempt.id
     ) <> p_provider_fee_minor THEN
    RAISE EXCEPTION 'stay_provider_fee_allocation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.stay_payment_attempts
  SET provider_fee_minor = p_provider_fee_minor,
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
    AND provider_fee_minor IS DISTINCT FROM p_provider_fee_minor;

  RETURN v_inserted;
END;
$function$;

-- Stay has no event row. Its immutable reservation-line end is the payout
-- anchor, while all ledger and debt behavior remains on the shared tables.
CREATE OR REPLACE FUNCTION public.issue_1389_attach_stay_payout_release(
  p_source_id uuid,
  p_brand_id uuid,
  p_occurrence_key text,
  p_provider text,
  p_currency text,
  p_finalized_at timestamptz,
  p_anchor_end_at timestamptz,
  p_gross_cents integer,
  p_refunded_cents integer,
  p_mingla_fee_cents integer,
  p_provider_fee_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cutover timestamptz;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_net integer;
BEGIN
  IF NOT public.issue_1389_service_role()
     OR p_provider NOT IN ('stripe', 'paystack')
     OR p_currency !~ '^[A-Za-z]{3}$'
     OR p_anchor_end_at IS NULL
     OR p_finalized_at IS NULL
     OR p_gross_cents < 0
     OR p_refunded_cents < 0
     OR p_mingla_fee_cents < 0
     OR p_provider_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay_reservation:' || p_source_id::text,
      1171
    )
  );
  SELECT item.release_id INTO v_existing_release_id
  FROM public.payout_release_items item
  WHERE item.source_type = 'stay_reservation'
    AND item.source_id = p_source_id;
  IF FOUND THEN
    RETURN v_existing_release_id;
  END IF;

  SELECT brand.payout_hold_cutover_at INTO v_cutover
  FROM public.brands brand
  WHERE brand.id = p_brand_id
  FOR SHARE;
  IF v_cutover IS NULL OR p_finalized_at <= v_cutover THEN
    RAISE EXCEPTION 'source_not_after_cutover' USING ERRCODE = 'P0001';
  END IF;

  v_net := greatest(
    0,
    p_gross_cents - p_refunded_cents
      - p_mingla_fee_cents - p_provider_fee_cents
  );
  INSERT INTO public.brand_payout_releases (
    brand_id, event_id, event_date_id, occurrence_key, surface,
    provider, currency, anchor_end_at, releasable_at, gross_cents,
    refunded_cents, disputed_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents
  ) VALUES (
    p_brand_id, NULL, NULL, p_occurrence_key, 'stay_reservation',
    p_provider, lower(p_currency), p_anchor_end_at,
    p_anchor_end_at + interval '3 days', p_gross_cents,
    p_refunded_cents, 0, p_mingla_fee_cents, 0,
    p_provider_fee_cents, v_net
  )
  ON CONFLICT (
    brand_id, event_key, occurrence_key, surface, provider, currency
  )
  DO UPDATE SET
    anchor_end_at = EXCLUDED.anchor_end_at,
    releasable_at = EXCLUDED.releasable_at,
    updated_at = now()
  WHERE public.brand_payout_releases.status = 'pending'
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    SELECT release_row.id INTO v_release_id
    FROM public.brand_payout_releases release_row
    WHERE release_row.brand_id = p_brand_id
      AND release_row.event_key =
        '00000000-0000-0000-0000-000000000000'::uuid
      AND release_row.occurrence_key = p_occurrence_key
      AND release_row.surface = 'stay_reservation'
      AND release_row.provider = p_provider
      AND release_row.currency = lower(p_currency);
  END IF;

  INSERT INTO public.payout_release_items (
    release_id, source_type, source_id, gross_cents, refunded_cents,
    disputed_cents, mingla_fee_cents, partner_share_cents,
    provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    v_release_id, 'stay_reservation', p_source_id, p_gross_cents,
    p_refunded_cents, 0, p_mingla_fee_cents, 0,
    p_provider_fee_cents, v_net, p_finalized_at
  )
  ON CONFLICT (source_type, source_id) DO NOTHING;

  RETURN v_release_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_stay_payout_release_dark_sweep(
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row record;
  v_release_id uuid;
  v_created integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT
      line.id AS source_id,
      group_row.id AS group_id,
      group_row.brand_id,
      attempt.provider,
      lower(attempt.currency_code::text) AS currency,
      attempt.succeeded_at AS finalized_at,
      CASE line.kind
        WHEN 'room' THEN (
          line.room_check_out::timestamp + settings.check_out_time
        ) AT TIME ZONE settings.timezone
        ELSE place_window.ends_at
      END AS anchor_end_at,
      line.total_minor::integer AS gross_cents,
      COALESCE((
        SELECT sum(allocation.refunded_minor)::integer
        FROM public.stay_payment_allocations allocation
        WHERE allocation.payment_attempt_id = attempt.id
          AND allocation.reservation_line_id = line.id
      ), 0) AS refunded_cents,
      snapshot.platform_fee_minor AS mingla_fee_cents,
      snapshot.provider_fee_minor AS provider_fee_cents,
      'stay:' || group_row.id || ':' || line.id AS occurrence_key
    FROM public.stay_reservation_lines line
    JOIN public.stay_reservation_groups group_row
      ON group_row.id = line.group_id
    JOIN public.stay_payment_attempts attempt
      ON attempt.group_id = group_row.id
     AND attempt.state = 'succeeded'
    JOIN public.stay_payout_line_snapshots snapshot
      ON snapshot.reservation_line_id = line.id
     AND snapshot.payment_attempt_id = attempt.id
    JOIN public.stay_settings settings
      ON settings.venue_id = group_row.venue_id
    LEFT JOIN public.stay_place_windows place_window
      ON place_window.id = line.place_window_id
    JOIN public.brands brand ON brand.id = group_row.brand_id
    WHERE line.state = 'confirmed'
      AND attempt.succeeded_at > brand.payout_hold_cutover_at
      AND CASE line.kind
        WHEN 'room' THEN (
          line.room_check_out::timestamp + settings.check_out_time
        ) AT TIME ZONE settings.timezone
        ELSE place_window.ends_at
      END + interval '3 days' <= p_now
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_refunds source_refund
        WHERE source_refund.source_type = 'stay_reservation'
          AND source_refund.subject_id = group_row.id
          AND source_refund.financial_state <> 'reconciled'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.payout_release_items item
        WHERE item.source_type = 'stay_reservation'
          AND item.source_id = line.id
      )
    ORDER BY anchor_end_at, line.id
  LOOP
    v_release_id := public.issue_1389_attach_stay_payout_release(
      v_row.source_id,
      v_row.brand_id,
      v_row.occurrence_key,
      v_row.provider,
      v_row.currency,
      v_row.finalized_at,
      v_row.anchor_end_at,
      v_row.gross_cents,
      v_row.refunded_cents,
      v_row.mingla_fee_cents,
      v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id, p_now);
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payout_release_id, entry_type,
      amount_minor, currency_code, idempotency_key, metadata
    ) VALUES (
      v_row.group_id, v_row.source_id, v_release_id, 'payout_eligible',
      greatest(
        0,
        v_row.gross_cents - v_row.refunded_cents
          - v_row.mingla_fee_cents - v_row.provider_fee_cents
      ),
      upper(v_row.currency)::character(3),
      'stay:payout_attached:' || v_row.source_id,
      jsonb_build_object('releaseId', v_release_id)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dark', true,
    'attached', v_created,
    'executed', 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_missing_stay_provider_fees(integer)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_stay_provider_fee(uuid, integer, text)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_attach_stay_payout_release(
  uuid, uuid, text, text, text, timestamptz, timestamptz,
  integer, integer, integer, integer
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_stay_payout_release_dark_sweep(timestamptz)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_missing_stay_provider_fees(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_missing_payout_source_fees(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stay_provider_fee(uuid, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1389_attach_stay_payout_release(
  uuid, uuid, text, text, text, timestamptz, timestamptz,
  integer, integer, integer, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_stay_payout_release_dark_sweep(timestamptz)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
