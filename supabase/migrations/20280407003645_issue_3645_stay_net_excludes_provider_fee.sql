-- Issue #3645 A26 — stay payouts stop charging payment processing to the host.
--
-- Seth's flat 4.5% rule (2026-10-20): Mingla's 4.5% fee is the only deduction
-- from host money; Mingla pays the Stripe/Paystack processing fee. Event-side
-- attach_payout_release already follows it (20271210013645 §attach). The stay
-- attach and the stay dark sweep still subtracted provider_fee_cents, so a stay
-- host was paid gross − 4.5% − processing.
--
-- 1. issue_1389_attach_stay_payout_release and run_stay_payout_release_dark_sweep
--    are copied from their newest origin/main definition (20271210013645) with
--    only the provider-fee term removed from host net. provider_fee_cents is
--    still stored on the release and item rows for reporting.
-- 2. Forward-only, like 20271206003645_issue_3645_flat_45_host_net.sql:
--    existing payout_release_items are append-only and are NOT rewritten.
--    Stay releases attached before this migration settle under whatever rule
--    Seth confirms on #3645 (legacy vs new). New attaches use the flat rule
--    immediately after apply.
-- 3. stay_money_ledger is append-only history. Old payout_eligible rows keep
--    the amount they recorded; new attaches record the corrected amount.
-- 4. Legacy (fees_collector = 'stripe') accounts: the Stripe fee make-good
--    (census + plan) now covers stay sales, as it does event orders.
--
-- Known, separate: issue_1389_record_stay_dispute (20271231204134) still
-- updates append-only payout_release_items for a dispute on an unpaid stay
-- release, so it raises payout_ledger_append_only before any net is written.
-- Its fix belongs with the Paystack dispute projection pattern
-- (20271214013645) and must not reintroduce the provider fee into host net.
--

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Stay attach and stay dark sweep (copied, provider fee removed from net).
-- ---------------------------------------------------------------------------
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

  -- #3645 A26 / flat 4.5% (Seth 2026-10-20): Mingla pays provider processing.
  -- Host net deducts only Mingla's fee; p_provider_fee_cents is kept on the
  -- row for reporting. Same rule as attach_payout_release for events.
  v_net := greatest(
    0,
    p_gross_cents - p_refunded_cents - p_mingla_fee_cents
  );
  INSERT INTO public.brand_payout_releases (
    brand_id, event_id, event_date_id, occurrence_key, surface,
    provider, currency, anchor_end_at, releasable_at, gross_cents,
    refunded_cents, disputed_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents
  ) VALUES (
    p_brand_id, NULL, NULL, p_occurrence_key, 'stay_reservation',
    p_provider, lower(p_currency), p_finalized_at,
    p_finalized_at + interval '1 day', p_gross_cents,
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
      AND attempt.succeeded_at + interval '1 day' <= p_now
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
      -- #3645 A26: same net as the release row (no provider fee).
      greatest(
        0,
        v_row.gross_cents - v_row.refunded_cents - v_row.mingla_fee_cents
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

-- ---------------------------------------------------------------------------
-- 2. Legacy Stripe accounts: the fee make-good covers stay sales too.
--
-- Stay Stripe payments are direct charges on the host's connected account
-- (_shared/stayPaymentProvider.ts: application_fee_amount + stripeAccount). On
-- an account created before #4044 (fees_collector = 'stripe') Stripe has
-- already taken its processing fee from that balance, so the flat net above
-- asks for more than the account holds and the sweep parks the release on
-- blocked_balance — exactly the Salsa4Life case 20271213003645 fixed for
-- events. The census and plan refused stay items ("sale_not_on_current_account")
-- because their account check only knew orders. Both are copied from
-- 20271213003645 with that one check moved into a shared predicate that also
-- accepts a stay line whose succeeded Stripe attempt was charged on the
-- brand's current connected account and whose item was attached under the
-- flat rule (an older stay item already deducted the fee, so it owes nothing;
-- the census shows it as sale_not_on_current_account).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3645_fee_sale_on_account(
  p_source_type text,
  p_source_id uuid,
  p_stripe_account_id text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE p_source_type
    WHEN 'order' THEN EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = p_source_id
        AND o.stripe_transfer_destination = p_stripe_account_id
    )
    WHEN 'stay_reservation' THEN EXISTS (
      SELECT 1
      FROM public.stay_payout_line_snapshots snapshot
      JOIN public.stay_payment_attempts attempt
        ON attempt.id = snapshot.payment_attempt_id
      WHERE snapshot.reservation_line_id = p_source_id
        AND attempt.provider = 'stripe'
        AND attempt.state = 'succeeded'
        AND attempt.connected_account_ref = p_stripe_account_id
    )
    -- Only a stay item attached under the flat rule is owed its fee. One
    -- attached before this migration already deducted the fee from host net,
    -- so it fits the legacy balance and owes nothing until Seth rules on the
    -- legacy-vs-new question (#3645).
    AND EXISTS (
      SELECT 1 FROM public.payout_release_items item
      WHERE item.source_type = 'stay_reservation'
        AND item.source_id = p_source_id
        AND item.net_cents = greatest(
          0,
          item.gross_cents - item.refunded_cents - item.disputed_cents
            - item.mingla_fee_cents
        )
    )
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.stripe_fee_make_good_census()
RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  brand_name text,
  stripe_account_id text,
  currency text,
  release_status text,
  net_release_cents integer,
  provider_fee_cents integer,
  made_good_cents integer,
  planned_cents integer,
  owed_cents integer,
  eligible boolean,
  ineligible_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH r AS (
    SELECT
      rel.id, rel.brand_id, b.name AS brand_name, rel.currency, rel.status,
      rel.net_release_cents,
      sca.stripe_account_id,
      sca.detached_at,
      coalesce((
        SELECT sum(i.provider_fee_cents)::integer
        FROM public.payout_release_items i WHERE i.release_id = rel.id
      ), 0) AS provider_fee,
      coalesce((
        SELECT sum(m.amount_cents)::integer FROM public.stripe_fee_make_goods m
        WHERE m.release_id = rel.id AND m.status = 'sent'
      ), 0) AS made_good,
      coalesce((
        SELECT sum(m.amount_cents)::integer FROM public.stripe_fee_make_goods m
        WHERE m.release_id = rel.id AND m.status = 'planned'
      ), 0) AS planned,
      EXISTS (
        SELECT 1 FROM public.payout_release_items i
        WHERE i.release_id = rel.id
          AND i.provider_fee_cents > 0
          AND NOT public.issue_3645_fee_sale_on_account(i.source_type, i.source_id, sca.stripe_account_id)
      ) AS account_mismatch
    FROM public.brand_payout_releases rel
    JOIN public.brands b ON b.id = rel.brand_id
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = rel.brand_id
    WHERE rel.provider = 'stripe'
  )
  SELECT
    r.id, r.brand_id, r.brand_name, r.stripe_account_id, r.currency, r.status,
    r.net_release_cents, r.provider_fee, r.made_good, r.planned,
    greatest(r.provider_fee - r.made_good, 0) AS owed,
    (r.status IN ('pending','blocked_balance','blocked_kyc','in_flight')
      AND r.stripe_account_id IS NOT NULL AND r.detached_at IS NULL
      AND NOT r.account_mismatch
      AND r.provider_fee - r.made_good > 0) AS eligible,
    CASE
      WHEN r.status NOT IN ('pending','blocked_balance','blocked_kyc','in_flight') THEN 'release_not_unpaid'
      WHEN r.stripe_account_id IS NULL OR r.detached_at IS NOT NULL THEN 'no_active_connect_account'
      WHEN r.account_mismatch THEN 'sale_not_on_current_account'
      WHEN r.provider_fee - r.made_good <= 0 THEN 'nothing_owed'
      ELSE NULL
    END
  FROM r
  ORDER BY r.brand_name, r.id;
$fn$;

CREATE OR REPLACE FUNCTION public.plan_stripe_fee_make_good(
  p_release_id uuid,
  p_expected_amount_cents integer,
  p_actor_email text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_account text;
  v_detached timestamptz;
  v_provider_fee integer;
  v_made_good integer;
  v_owed integer;
  v_attempt integer;
  v_row public.stripe_fee_make_goods;
BEGIN
  IF p_actor_email IS NULL OR btrim(p_actor_email) = '' THEN
    RAISE EXCEPTION 'actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_release FROM public.brand_payout_releases
  WHERE id = p_release_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_release.provider <> 'stripe' THEN
    RAISE EXCEPTION 'release_not_stripe' USING ERRCODE = 'P0001';
  END IF;
  IF v_release.status NOT IN ('pending','blocked_balance','blocked_kyc','in_flight')
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'release_not_unpaid' USING ERRCODE = 'P0001';
  END IF;

  SELECT sca.stripe_account_id, sca.detached_at INTO v_account, v_detached
  FROM public.stripe_connect_accounts sca WHERE sca.brand_id = v_release.brand_id;
  IF v_account IS NULL OR v_detached IS NOT NULL THEN
    RAISE EXCEPTION 'no_active_connect_account' USING ERRCODE = 'P0001';
  END IF;

  -- Every fee-bearing sale must be a direct charge on THIS account; otherwise
  -- the fee was not taken from the balance the payout draws on.
  IF EXISTS (
    SELECT 1 FROM public.payout_release_items i
    WHERE i.release_id = p_release_id
      AND i.provider_fee_cents > 0
      AND NOT public.issue_3645_fee_sale_on_account(i.source_type, i.source_id, v_account)
  ) THEN
    RAISE EXCEPTION 'sale_not_on_current_account' USING ERRCODE = 'P0001';
  END IF;

  -- A planned row means an earlier call may have reached Stripe: resume it
  -- with the same idempotency key rather than plan a second Transfer.
  SELECT * INTO v_row FROM public.stripe_fee_make_goods
  WHERE release_id = p_release_id AND status = 'planned'
  ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF p_expected_amount_cents IS DISTINCT FROM v_row.amount_cents THEN
      RAISE EXCEPTION 'make_good_amount_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'resumed', 'make_good_id', v_row.id,
      'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
      'stripe_account_id', v_row.stripe_account_id,
      'idempotency_key', v_row.idempotency_key);
  END IF;

  SELECT coalesce(sum(i.provider_fee_cents), 0)::integer INTO v_provider_fee
  FROM public.payout_release_items i WHERE i.release_id = p_release_id;
  SELECT coalesce(sum(m.amount_cents), 0)::integer INTO v_made_good
  FROM public.stripe_fee_make_goods m
  WHERE m.release_id = p_release_id AND m.status = 'sent';
  v_owed := v_provider_fee - v_made_good;

  IF v_owed <= 0 THEN
    IF p_expected_amount_cents IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'make_good_amount_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('outcome', 'nothing_owed', 'amount_cents', 0);
  END IF;
  IF p_expected_amount_cents IS DISTINCT FROM v_owed THEN
    RAISE EXCEPTION 'make_good_amount_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_attempt FROM public.stripe_fee_make_goods m
  WHERE m.release_id = p_release_id AND m.covered_through_cents = v_provider_fee
    AND m.status = 'failed';

  INSERT INTO public.stripe_fee_make_goods (
    release_id, brand_id, stripe_account_id, currency, amount_cents,
    covered_through_cents, attempt, idempotency_key, actor_email, reason
  ) VALUES (
    p_release_id, v_release.brand_id, v_account, v_release.currency, v_owed,
    v_provider_fee, v_attempt,
    format('mingla_fee_make_good_%s_%s_a%s', p_release_id, v_provider_fee, v_attempt),
    btrim(p_actor_email), btrim(p_reason)
  ) RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'outcome', 'planned', 'make_good_id', v_row.id,
    'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
    'stripe_account_id', v_row.stripe_account_id,
    'idempotency_key', v_row.idempotency_key);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_fee_sale_on_account(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_fee_sale_on_account(text, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.stripe_fee_make_good_census() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_stripe_fee_make_good(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_fee_make_good_census() TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_stripe_fee_make_good(uuid, integer, text, text) TO service_role;

COMMIT;
