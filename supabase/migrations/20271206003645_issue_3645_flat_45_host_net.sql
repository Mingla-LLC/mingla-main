-- #3645 flat 4.5% host payout net (Seth 2026-10-20)
-- Mingla keeps flat 4.5% (application fee / mingla_fee_cents). Mingla pays card
-- processing. Host net = gross − refunds − disputes − mingla_fee.
-- provider_fee_cents remains stored for reporting but is NOT subtracted.
-- Partner share stays off the host net (#3872).
--
-- Existing payout_release_items are NOT rewritten. Waiting orders settle under
-- whatever rule Seth confirms on #3645 (legacy vs new). New attaches use this
-- formula immediately after apply.
--
-- Replaces attach_payout_release + plan_pending_payout_partner_legs rebuild net
-- from 20271107003872_issue_3872_money_truth.sql.

CREATE OR REPLACE FUNCTION public.attach_payout_release(p_source_type text, p_source_id uuid, p_brand_id uuid, p_event_id uuid, p_event_date_id uuid, p_occurrence_key text, p_provider text, p_currency text, p_finalized_at timestamp with time zone, p_anchor_end_at timestamp with time zone, p_gross_cents integer, p_refunded_cents integer, p_disputed_cents integer, p_mingla_fee_cents integer, p_partner_share_cents integer, p_provider_fee_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cutover timestamptz;
  v_status text;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_net integer;
  v_maturity_anchor timestamptz;
BEGIN
  -- #1790 T-P3(5) pins the one-liner NOT IN list below character-for-character.
  -- Accept order_installment via a separate <> so that pin stays intact.
  IF (p_source_type NOT IN ('order','rsvp_contribution','venue_reservation','venue_menu_order')
      AND p_source_type <> 'order_installment')
     OR p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_source_type||':'||p_source_id::text,1171)
  );
  SELECT release_id INTO v_existing_release_id
  FROM public.payout_release_items
  WHERE source_type=p_source_type AND source_id=p_source_id;
  IF FOUND THEN RETURN v_existing_release_id; END IF;

  SELECT payout_hold_cutover_at INTO v_cutover FROM public.brands
   WHERE id = p_brand_id FOR SHARE;
  IF v_cutover IS NULL OR p_finalized_at <= v_cutover THEN
    RAISE EXCEPTION 'source_not_after_cutover' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR SHARE;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled_event_never_releases' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Issue #3872 (F1): partner share is 10% OF Mingla's fee, paid from Mingla's
  -- platform balance — stored for reporting, not subtracted from host net.
  -- #3645 flat 4.5% (Seth 2026-10-20): Mingla pays provider processing; host net
  -- does not deduct p_provider_fee_cents (still stored on the row for reporting).
  -- p_mingla_fee_cents is the application fee / Mingla take (full 4.5% on new sales).
  v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents
    - p_mingla_fee_cents);

  -- #3645: maturity anchors on payment time.
  v_maturity_anchor := p_finalized_at;

  INSERT INTO public.brand_payout_releases (
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_release_cents
  ) VALUES (
    p_brand_id,p_event_id,p_event_date_id,p_occurrence_key,p_source_type,p_provider,
    lower(p_currency),v_maturity_anchor,v_maturity_anchor + interval '1 day',
    p_gross_cents,p_refunded_cents,p_disputed_cents,p_mingla_fee_cents,
    p_partner_share_cents,p_provider_fee_cents,v_net
  )
  ON CONFLICT (brand_id,event_key,occurrence_key,surface,provider,currency)
  DO UPDATE SET
    anchor_end_at = EXCLUDED.anchor_end_at,
    releasable_at = EXCLUDED.releasable_at,
    updated_at = now()
  WHERE brand_payout_releases.status = 'pending'
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    SELECT id INTO v_release_id FROM public.brand_payout_releases
     WHERE brand_id=p_brand_id
       AND event_key=coalesce(p_event_id,'00000000-0000-0000-0000-000000000000'::uuid)
       AND occurrence_key=p_occurrence_key
       AND surface=p_source_type AND provider=p_provider AND currency=lower(p_currency);
  END IF;

  INSERT INTO public.payout_release_items (
    release_id,source_type,source_id,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_cents,source_finalized_at
  ) VALUES (
    v_release_id,p_source_type,p_source_id,p_gross_cents,p_refunded_cents,
    p_disputed_cents,p_mingla_fee_cents,p_partner_share_cents,p_provider_fee_cents,v_net,
    p_finalized_at
  ) ON CONFLICT (source_type,source_id) DO NOTHING;

  IF p_source_type = 'order_installment' THEN
    UPDATE public.order_installments
    SET payout_accounting_state = 'attached',
        updated_at = now()
    WHERE id = p_source_id
      AND payout_accounting_state = 'ready';
  END IF;

  UPDATE public.brand_payout_releases r SET
    gross_cents=x.gross, refunded_cents=x.refunded, disputed_cents=x.disputed,
    mingla_fee_cents=x.mingla_fee, partner_share_cents=x.partner_share,
    provider_fee_cents=x.provider_fee, net_release_cents=x.net, updated_at=now()
  FROM (
    SELECT release_id,sum(gross_cents)::int gross,sum(refunded_cents)::int refunded,
      sum(disputed_cents)::int disputed,sum(mingla_fee_cents)::int mingla_fee,
      sum(partner_share_cents)::int partner_share,sum(provider_fee_cents)::int provider_fee,
      sum(net_cents)::int net
    FROM public.payout_release_items WHERE release_id=v_release_id GROUP BY release_id
  ) x WHERE r.id=x.release_id;
  RETURN v_release_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.plan_pending_payout_partner_legs(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_release record;
  v_split record;
  v_planned integer := 0;
  v_fee integer;
  v_stamp integer;
  v_partner_cost integer;
  v_principal_corrections integer := 0;
  v_new_corrections integer;
  v_gross integer;
  v_refunded integer;
  v_disputed integer;
  v_mingla_fee integer;
  v_item_partner_share integer;
  v_provider_fee integer;
  v_missing_attributions integer;
  v_blocked_attributions integer := 0;
BEGIN
  FOR v_release IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'pending'
    ORDER BY r.releasable_at, r.id
    LIMIT greatest(1, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*)::integer
      INTO v_missing_attributions
    FROM public.payout_release_items i
    LEFT JOIN public.payout_partner_attributions a
      ON a.order_id = i.source_id
    WHERE i.release_id = v_release.id
      AND i.source_type = 'order'
      AND i.mingla_fee_cents > 0
      AND a.order_id IS NULL;
    IF v_missing_attributions > 0 THEN
      v_blocked_attributions :=
        v_blocked_attributions + v_missing_attributions;
      CONTINUE;
    END IF;

    v_new_corrections :=
      public.reconcile_payout_partner_principal(v_release.id);
    v_principal_corrections :=
      v_principal_corrections + v_new_corrections;

    FOR v_split IN
      SELECT DISTINCT ps.id, ps.provider, ps.partner_share_cents
      FROM public.payout_release_items i
      JOIN public.partner_splits ps
        ON ps.order_id = i.source_id
       AND i.source_type = 'order'
      WHERE i.release_id = v_release.id
        AND ps.status = 'held'
        AND ps.release_id IS NULL
      ORDER BY ps.id
    LOOP
      -- Paystack cannot move a partner leg below its verified ₦50 floor.
      -- The split remains held and incurs no fee until a later contract
      -- explicitly aggregates sub-floor partner principal.
      IF v_split.provider = 'paystack'
         AND v_split.partner_share_cents < 5000 THEN
        CONTINUE;
      END IF;

      IF v_split.provider = 'paystack' THEN
        v_fee := CASE
          WHEN v_split.partner_share_cents <= 500000 THEN 1000
          WHEN v_split.partner_share_cents <= 5000000 THEN 2500
          ELSE 5000
        END;
        v_stamp := CASE
          WHEN v_split.partner_share_cents >= 1000000 THEN 5000
          ELSE 0
        END;
      ELSE
        v_fee := 0;
        v_stamp := 0;
      END IF;

      INSERT INTO public.payout_transfer_legs (
        release_id,
        partner_split_id,
        kind,
        chunk_index,
        principal_cents,
        estimated_fee_cents,
        stamp_duty_cents,
        fee_schedule_version
      )
      VALUES (
        v_release.id,
        v_split.id,
        'partner',
        0,
        v_split.partner_share_cents,
        v_fee,
        v_stamp,
        CASE
          WHEN v_split.provider = 'paystack' THEN 'verified-2026-07-24'
          ELSE 'stripe-platform-transfer-v1'
        END
      )
      ON CONFLICT (release_id, kind, partner_split_id, chunk_index)
      DO NOTHING;
      IF FOUND THEN v_planned := v_planned + 1; END IF;
    END LOOP;

    SELECT coalesce(sum(estimated_fee_cents + stamp_duty_cents), 0)::integer
      INTO v_partner_cost
    FROM public.payout_transfer_legs
    WHERE release_id = v_release.id
      AND kind = 'partner';

    SELECT
      coalesce(sum(gross_cents), 0)::integer,
      coalesce(sum(refunded_cents), 0)::integer,
      coalesce(sum(disputed_cents), 0)::integer,
      coalesce(sum(mingla_fee_cents), 0)::integer,
      coalesce(sum(partner_share_cents), 0)::integer,
      coalesce(sum(provider_fee_cents), 0)::integer
    INTO
      v_gross,
      v_refunded,
      v_disputed,
      v_mingla_fee,
      v_item_partner_share,
      v_provider_fee
    FROM public.payout_release_items
    WHERE release_id = v_release.id;

    SELECT coalesce(sum(amount_cents), 0)::integer
      INTO v_new_corrections
    FROM public.payout_ledger_adjustments
    WHERE release_id = v_release.id
      AND kind = 'partner_principal_correction';

    -- Rebuild from immutable items plus append-only corrections so retries
    -- cannot double-deduct either principal or transfer costs.
    UPDATE public.brand_payout_releases
    SET gross_cents = v_gross,
        refunded_cents = v_refunded,
        disputed_cents = v_disputed,
        mingla_fee_cents = v_mingla_fee,
        partner_share_cents = v_item_partner_share + v_new_corrections,
        provider_fee_cents = v_provider_fee,
        -- Issue #3872 (F1): partner money is Mingla's (platform balance).
        -- #3645 flat 4.5%: Mingla pays provider processing — do not deduct
        -- v_provider_fee from host net (column still updated for reporting).
        net_release_cents = greatest(
          0,
          v_gross - v_refunded - v_disputed - v_mingla_fee
          - permanent_debt_withheld_cents - temporary_debt_withheld_cents
          + maturity_recredit_cents
        ),
        updated_at = now()
    WHERE id = v_release.id;
  END LOOP;

  RETURN jsonb_build_object(
    'planned_partner_legs', v_planned,
    'partner_principal_corrections', v_principal_corrections,
    'blocked_partner_attributions', v_blocked_attributions
  );
END;
$function$;


