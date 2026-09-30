-- #3645 PR1 — payout maturity = payment finalization + 24h (not event end + 3 days).
-- Charge readiness / cancel-review / sell-before-bank ship in later #3645 PRs.
-- Rejected alternatives recorded on the issue: Instant Payouts, trust tiers, Mingla-as-SoR.

-- =============================================================================
-- §1. Ledger CHECK: releasable_at = anchor_end_at + 1 day
-- =============================================================================
ALTER TABLE public.brand_payout_releases
  DROP CONSTRAINT IF EXISTS brand_payout_release_anchor_order;

-- Pending / blocked / terminal rows: re-anchor maturity to earliest item payment
-- time + 1 day so the CHECK validates for every existing row (including
-- released / in_flight / cancelled_event / failed). Historical policy: maturity
-- timestamps are rewritten to the new product rule; money already paid out is
-- unchanged (released status and transfer ids stay).
UPDATE public.brand_payout_releases r
SET
  anchor_end_at = x.min_finalized,
  releasable_at = x.min_finalized + interval '1 day',
  updated_at = now()
FROM (
  SELECT
    i.release_id,
    min(i.source_finalized_at) AS min_finalized
  FROM public.payout_release_items i
  GROUP BY i.release_id
) x
WHERE r.id = x.release_id;

-- Rows with no items: keep anchor_end_at, force releasable_at = anchor + 1 day.
UPDATE public.brand_payout_releases r
SET
  releasable_at = r.anchor_end_at + interval '1 day',
  updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.payout_release_items i WHERE i.release_id = r.id
)
AND r.releasable_at IS DISTINCT FROM r.anchor_end_at + interval '1 day';

ALTER TABLE public.brand_payout_releases
  ADD CONSTRAINT brand_payout_release_anchor_order
  CHECK (releasable_at = anchor_end_at + interval '1 day');

-- =============================================================================
-- §2. attach_payout_release — maturity from payment (p_finalized_at), not event end
-- =============================================================================
CREATE OR REPLACE FUNCTION public.attach_payout_release(
  p_source_type text,
  p_source_id uuid,
  p_brand_id uuid,
  p_event_id uuid,
  p_event_date_id uuid,
  p_occurrence_key text,
  p_provider text,
  p_currency text,
  p_finalized_at timestamptz,
  p_anchor_end_at timestamptz,
  p_gross_cents integer,
  p_refunded_cents integer,
  p_disputed_cents integer,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer,
  p_provider_fee_cents integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cutover timestamptz;
  v_status text;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_net integer;
  v_maturity_anchor timestamptz;
BEGIN
  IF p_source_type NOT IN ('order','rsvp_contribution','venue_reservation','venue_menu_order')
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
  v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents
    - p_mingla_fee_cents - p_partner_share_cents - p_provider_fee_cents);

  -- #3645: maturity anchors on payment time. p_anchor_end_at retained for callers
  -- but ignored for releasable_at (occurrence grouping still uses occurrence_key).
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
$fn$;

-- =============================================================================
-- §3. refresh_pending — cancel only; do NOT re-anchor maturity to event end
-- =============================================================================
CREATE OR REPLACE FUNCTION public.refresh_pending_payout_release_truth(
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release record;
  v_cancelled integer:=0;
BEGIN
  FOR v_release IN
    SELECT r.id, r.event_id, e.status event_status
    FROM public.brand_payout_releases r
    LEFT JOIN public.events e ON e.id=r.event_id
    WHERE r.status IN (
      'pending','blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
      'fee_unreconciled','blocked_anchor','reanchored'
    )
    ORDER BY r.id FOR UPDATE OF r SKIP LOCKED
  LOOP
    IF v_release.event_id IS NOT NULL AND v_release.event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',updated_at=p_now
      WHERE id=v_release.id;
      v_cancelled:=v_cancelled+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'as_of',p_now,'reanchored',0,'cancelled',v_cancelled,
    'blocked_missing_anchor',0
  );
END;
$fn$;

-- =============================================================================
-- §4. Stripe authorize — maturity is releasable_at, not event_end+3d
-- =============================================================================
CREATE OR REPLACE FUNCTION public.authorize_stripe_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_amount_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
  v_expected integer;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='stripe'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.stripe_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale_stripe_execution_claim' USING ERRCODE='P0001';
  END IF;
  v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents;
  IF p_amount_cents IS DISTINCT FROM v_expected OR v_expected<=0 THEN
    RAISE EXCEPTION 'stripe_release_amount_not_ledger_exact'
      USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_stripe_payout',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='release_no_longer_mature',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;

-- =============================================================================
-- §5. Paystack authorize — same maturity rule
-- =============================================================================
CREATE OR REPLACE FUNCTION public.authorize_paystack_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.paystack_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          paystack_execution_claim_id=NULL,
          paystack_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_paystack_transfer',
          paystack_execution_claim_id=NULL,
          paystack_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='release_no_longer_mature',
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;

-- =============================================================================
-- §6. Temporary postponement debt maturity = anchor + 1 day
-- =============================================================================
CREATE OR REPLACE FUNCTION public.open_post_release_postponement_debt(
  p_origin_release_id uuid,
  p_live_anchor_end_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_release public.brand_payout_releases; v_debt_id uuid; v_maturity timestamptz;
BEGIN
  SELECT * INTO v_release FROM public.brand_payout_releases
   WHERE id=p_origin_release_id FOR UPDATE;
  IF NOT FOUND OR v_release.status <> 'released' THEN
    RAISE EXCEPTION 'released_origin_required' USING ERRCODE='P0001';
  END IF;
  v_maturity := p_live_anchor_end_at + interval '1 day';
  INSERT INTO public.organiser_payout_debts (
    brand_id,currency,origin_release_id,kind,principal_cents,maturity_at,idempotency_key
  ) VALUES (
    v_release.brand_id,v_release.currency,v_release.id,'post_release_postponement',
    v_release.organiser_cash_delivered_cents,v_maturity,'postpone:'||v_release.id
  )
  ON CONFLICT (origin_release_id,kind) DO UPDATE SET
    maturity_at=EXCLUDED.maturity_at,
    recovered_cents=CASE
      WHEN organiser_payout_debts.status='closed' THEN 0
      ELSE organiser_payout_debts.recovered_cents END,
    status='open',closed_at=NULL,updated_at=now()
  RETURNING id INTO v_debt_id;
  INSERT INTO public.payout_debt_events(
    debt_id,event_kind,amount_cents,anchor_at,idempotency_key
  ) VALUES(
    v_debt_id,'opened',v_release.organiser_cash_delivered_cents,v_maturity,
    'postpone-opened:'||v_debt_id
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO public.payout_debt_events(debt_id,event_kind,anchor_at,idempotency_key)
  VALUES(v_debt_id,'anchor_moved',v_maturity,'postpone-anchor:'||v_debt_id||':'||extract(epoch from v_maturity)::bigint)
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN v_debt_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_post_release_postponement_debts(
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release record;
  v_anchor timestamptz;
  v_maturity timestamptz;
  v_debt public.organiser_payout_debts;
  v_count integer:=0;
BEGIN
  FOR v_release IN
    SELECT r.* FROM public.brand_payout_releases r
     WHERE r.status='released' AND r.event_id IS NOT NULL
       AND r.organiser_cash_delivered_cents>0
     ORDER BY r.released_at,r.id
  LOOP
    SELECT ed.end_at INTO v_anchor FROM public.event_dates ed
    WHERE ed.id=v_release.event_date_id AND ed.event_id=v_release.event_id;
    IF v_anchor IS NULL THEN CONTINUE; END IF;
    v_maturity:=v_anchor+interval '1 day';
    SELECT * INTO v_debt FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id
      AND kind='post_release_postponement';

    IF NOT FOUND THEN
      IF v_anchor>v_release.anchor_end_at AND v_maturity>p_now THEN
        PERFORM public.open_post_release_postponement_debt(v_release.id,v_anchor);
        v_count:=v_count+1;
      END IF;
    ELSIF v_debt.status='open'
       AND v_maturity IS DISTINCT FROM v_debt.maturity_at THEN
      PERFORM public.open_post_release_postponement_debt(v_release.id,v_anchor);
      v_count:=v_count+1;
    ELSIF v_debt.status='closed'
       AND v_maturity>v_debt.maturity_at AND v_maturity>p_now THEN
      PERFORM public.open_post_release_postponement_debt(v_release.id,v_anchor);
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$fn$;

-- =============================================================================
-- §7. NG float horizon floor matches payment+24h (was 3 under event+3d)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.paystack_payout_float_obligation(
  p_horizon_days integer DEFAULT 7,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- #3645 — floor is 1 day (payment + ~24h maturity). Was 3 under event_end+3d
  -- (#1840). Clamped, never rejected: an out-of-range value must degrade to a
  -- usable window, never disable the forecast. Mirrors
  -- NG_PAYOUT_FLOAT_HORIZON_{MIN,MAX}_DAYS in runtimeConfig.
  v_days integer := greatest(1,least(coalesce(p_horizon_days,7),90));
  v_horizon_end timestamptz;
  v_obligation bigint := 0;
  v_count integer := 0;
  v_anchor_release uuid;
  v_anchor_brand uuid;
  v_earliest timestamptz;
BEGIN
  v_horizon_end := p_now + make_interval(days => v_days);

  WITH eligible AS (
    SELECT
      r.id,
      r.brand_id,
      r.releasable_at,
      r.net_release_cents::bigint AS net_release_cents,
      coalesce((
        SELECT sum(a.amount_cents)::bigint
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0) AS recredit
    FROM public.brand_payout_releases r
    WHERE r.provider='paystack'
      AND r.paystack_transfer_code IS NULL
      AND r.releasable_at<=v_horizon_end
      AND r.status IN (
        'pending','in_flight','blocked_balance','blocked_otp',
        'blocked_over_cap','fee_unreconciled'
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
  ),
  outstanding_legs AS (
    SELECT
      l.release_id,
      l.kind,
      sum(l.principal_cents+l.estimated_fee_cents+l.stamp_duty_cents)::bigint
        AS kobo
    FROM public.payout_transfer_legs l
    JOIN eligible e ON e.id=l.release_id
    WHERE l.status NOT IN ('succeeded','failed','reversed')
    GROUP BY l.release_id,l.kind
  ),
  organiser_planned AS (
    SELECT DISTINCT l.release_id
    FROM public.payout_transfer_legs l
    JOIN eligible e ON e.id=l.release_id
    WHERE l.kind='organiser'
  ),
  per_release AS (
    SELECT
      e.id,
      e.brand_id,
      e.releasable_at,
      (
        CASE
          WHEN EXISTS (
            SELECT 1 FROM organiser_planned p WHERE p.release_id=e.id
          ) THEN coalesce((
            SELECT o.kobo FROM outstanding_legs o
            WHERE o.release_id=e.id AND o.kind='organiser'
          ),0)
          ELSE e.net_release_cents+e.recredit
        END
      ) + coalesce((
        SELECT o.kobo FROM outstanding_legs o
        WHERE o.release_id=e.id AND o.kind='partner'
      ),0) AS kobo
    FROM eligible e
  ),
  owed AS (
    SELECT * FROM per_release WHERE kobo>0
  )
  SELECT
    coalesce(sum(o.kobo),0),
    count(*)::integer,
    min(o.releasable_at),
    (
      SELECT a.id FROM owed a
      ORDER BY a.releasable_at,a.id
      LIMIT 1
    ),
    (
      SELECT a.brand_id FROM owed a
      ORDER BY a.releasable_at,a.id
      LIMIT 1
    )
  INTO v_obligation,v_count,v_earliest,v_anchor_release,v_anchor_brand
  FROM owed o;

  RETURN jsonb_build_object(
    'horizon_days',v_days,
    'horizon_end',v_horizon_end,
    'release_count',coalesce(v_count,0),
    'obligation_kobo',coalesce(v_obligation,0),
    'earliest_maturity_at',v_earliest,
    'anchor_release_id',v_anchor_release,
    'anchor_brand_id',v_anchor_brand
  );
END;
$fn$;

