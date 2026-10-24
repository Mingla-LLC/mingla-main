-- #3872 R2 B3 — referral-payee reversals, fraud holds and payout ledger.
--
-- MINGLA-INVARIANT: I-3872-REFUND-NEVER-BLOCKED | issue #3872 | Payee-share reversal is ledger-first: a host refund commits even when a post-payout provider reversal cannot complete; the unpaid recovery remains in payee_debts.
-- MINGLA-INVARIANT: I-3872-PAYEE-PAYOUT-IDEMPOTENT | issue #3872 | One payout row owns immutable share/debt allocations and one deterministic provider identity per attempt; transient reconciliation reuses that attempt until a definitive failure advances it.

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.payee_share_reversals
  ADD COLUMN refunded_eligible_minor bigint NOT NULL DEFAULT 0
    CHECK (refunded_eligible_minor >= 0),
  ADD COLUMN net_amount_minor bigint NOT NULL DEFAULT 0
    CHECK (net_amount_minor >= 0);

ALTER TABLE public.payee_payouts
  DROP CONSTRAINT payee_payouts_amount_minor_check;
ALTER TABLE public.payee_payouts
  ADD CONSTRAINT payee_payouts_amount_minor_check CHECK (amount_minor >= 0),
  ADD COLUMN gross_share_minor bigint NOT NULL DEFAULT 0 CHECK (gross_share_minor >= 0),
  ADD COLUMN debt_withheld_minor bigint NOT NULL DEFAULT 0 CHECK (debt_withheld_minor >= 0),
  ADD COLUMN provider_fee_minor bigint NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
  ADD COLUMN account_ref text,
  ADD COLUMN transfer_group text,
  ADD COLUMN source_charge_id text,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT payee_payouts_money_identity CHECK (
    gross_share_minor = amount_minor + debt_withheld_minor + provider_fee_minor
  );

ALTER TABLE public.payee_debts
  ADD COLUMN origin_payout_id uuid REFERENCES public.payee_payouts(id) ON DELETE RESTRICT;

CREATE TABLE public.payee_payout_items (
  payout_id uuid NOT NULL REFERENCES public.payee_payouts(id) ON DELETE RESTRICT,
  share_id uuid NOT NULL REFERENCES public.payee_shares(id) ON DELETE RESTRICT,
  settled_minor bigint NOT NULL CHECK (settled_minor > 0),
  provider_amount_minor bigint NOT NULL DEFAULT 0 CHECK (
    provider_amount_minor >= 0 AND provider_amount_minor <= settled_minor
  ),
  provider_reversed_minor bigint NOT NULL DEFAULT 0 CHECK (
    provider_reversed_minor >= 0 AND provider_reversed_minor <= provider_amount_minor
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(payout_id,share_id)
);
CREATE INDEX payee_payout_items_share_idx ON public.payee_payout_items(share_id);

CREATE TABLE public.payee_provider_reversals (
  provider_reversal_id text PRIMARY KEY,
  payout_id uuid NOT NULL REFERENCES public.payee_payouts(id) ON DELETE RESTRICT,
  share_id uuid REFERENCES public.payee_shares(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payee_debt_recoveries (
  payout_id uuid NOT NULL REFERENCES public.payee_payouts(id) ON DELETE RESTRICT,
  debt_id uuid NOT NULL REFERENCES public.payee_debts(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(payout_id,debt_id)
);

CREATE TABLE public.referral_member_risk_holds (
  member_id uuid PRIMARY KEY REFERENCES public.referral_members(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('velocity','refund_ratio','admin')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  observed_orders_hour integer NOT NULL DEFAULT 0 CHECK (observed_orders_hour >= 0),
  observed_refund_bps integer NOT NULL DEFAULT 0 CHECK (observed_refund_bps >= 0),
  held_at timestamptz NOT NULL DEFAULT now(),
  held_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cleared_at timestamptz,
  cleared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_member_risk_holds_state CHECK (
    (active AND cleared_at IS NULL AND cleared_by IS NULL)
    OR (NOT active AND cleared_at IS NOT NULL)
  )
);
CREATE INDEX referral_member_risk_holds_active_idx
  ON public.referral_member_risk_holds(active,held_at) WHERE active;

CREATE TABLE public.payee_account_nudges (
  payee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rail text NOT NULL CHECK (rail IN ('stripe','paystack')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count BETWEEN 0 AND 4),
  last_sent_at timestamptz,
  next_send_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(payee_user_id,rail,currency)
);

CREATE TABLE public.payee_payout_currency_floors (
  currency text PRIMARY KEY CHECK (currency ~ '^[A-Z]{3}$'),
  floor_minor bigint NOT NULL CHECK (floor_minor > 0),
  source text NOT NULL DEFAULT 'r2_launch_fixed_local_equivalent'
);
INSERT INTO public.payee_payout_currency_floors(currency,floor_minor) VALUES
  ('USD',500),('GBP',400),('EUR',500),('CAD',700),('AUD',800),('CHF',500),
  ('SEK',5500),('NOK',5500),('DKK',3500),('PLN',2000),('CZK',12000),
  ('HUF',180000),('RON',2500),('BGN',900),('ISK',700),('NGN',100000)
ON CONFLICT(currency) DO UPDATE SET floor_minor=excluded.floor_minor;

ALTER TABLE public.payee_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_payout_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_provider_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_provider_reversals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_debt_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_debt_recoveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.referral_member_risk_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_member_risk_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_account_nudges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_account_nudges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_payout_currency_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_payout_currency_floors FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.payee_payout_items,public.payee_provider_reversals,
  public.payee_debt_recoveries,
  public.referral_member_risk_holds,public.payee_account_nudges,
  public.payee_payout_currency_floors FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payee_payout_items,public.payee_provider_reversals,
  public.payee_debt_recoveries,
  public.referral_member_risk_holds,public.payee_account_nudges TO service_role;
GRANT SELECT ON public.payee_payout_currency_floors TO service_role;

CREATE POLICY payee_payout_items_service_all ON public.payee_payout_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY payee_provider_reversals_service_all ON public.payee_provider_reversals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY payee_debt_recoveries_service_all ON public.payee_debt_recoveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY referral_member_risk_holds_service_all ON public.referral_member_risk_holds
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY payee_account_nudges_service_all ON public.payee_account_nudges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY payee_payout_currency_floors_service_read ON public.payee_payout_currency_floors
  FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.issue_3872_payee_remaining_net(p_share public.payee_shares)
RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp
AS $fn$
  SELECT greatest(
    p_share.net_minor-floor(
      p_share.net_minor::numeric*p_share.reversed_minor
      /greatest(p_share.gross_minor,1)
    )::bigint,
    0
  )
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_evaluate_referral_risk(
  p_member_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_orders_hour integer;
  v_eligible_30 bigint;
  v_refunded_30 bigint;
  v_refund_bps integer;
  v_source text;
  v_reason text;
BEGIN
  IF p_member_id IS NULL THEN RETURN jsonb_build_object('held',false); END IF;
  SELECT count(*)::integer INTO v_orders_hour
  FROM public.order_attributions a
  WHERE a.member_id=p_member_id AND a.share_minor>0
    AND a.created_at>=p_now-interval '1 hour';

  WITH attributed AS (
    SELECT a.order_kind,a.order_id,a.eligible_minor,s.id share_id
    FROM public.order_attributions a
    LEFT JOIN public.payee_shares s
      ON s.order_kind=a.order_kind AND s.order_id=a.order_id AND s.payee_kind='referral'
    WHERE a.member_id=p_member_id AND a.created_at>=p_now-interval '30 days'
  ), reversed AS (
    SELECT r.share_id,sum(r.refunded_eligible_minor)::bigint refunded_eligible_minor
    FROM public.payee_share_reversals r
    JOIN attributed a ON a.share_id=r.share_id
    GROUP BY r.share_id
  )
  SELECT COALESCE(sum(a.eligible_minor),0),
    COALESCE(sum(COALESCE(r.refunded_eligible_minor,0)),0)
    INTO v_eligible_30,v_refunded_30
  FROM attributed a LEFT JOIN reversed r ON r.share_id=a.share_id;
  v_refund_bps:=CASE WHEN v_eligible_30>0
    THEN least(10000,floor(v_refunded_30::numeric*10000/v_eligible_30)::integer)
    ELSE 0 END;

  IF v_orders_hour>20 THEN
    v_source:='velocity';
    v_reason:='More than 20 referred orders were attributed within one hour.';
  ELSIF v_refund_bps>3000 THEN
    v_source:='refund_ratio';
    v_reason:='More than 30% of 30-day referred eligible value was refunded.';
  ELSE
    RETURN jsonb_build_object('held',false,'ordersHour',v_orders_hour,'refundBps',v_refund_bps);
  END IF;

  INSERT INTO public.referral_member_risk_holds(
    member_id,active,source,reason,observed_orders_hour,observed_refund_bps,
    held_at,cleared_at,cleared_by,updated_at
  ) VALUES(
    p_member_id,true,v_source,v_reason,v_orders_hour,v_refund_bps,
    p_now,NULL,NULL,p_now
  )
  ON CONFLICT(member_id) DO UPDATE SET
    active=true,source=excluded.source,reason=excluded.reason,
    observed_orders_hour=excluded.observed_orders_hour,
    observed_refund_bps=excluded.observed_refund_bps,
    held_at=CASE WHEN referral_member_risk_holds.active
      THEN referral_member_risk_holds.held_at ELSE excluded.held_at END,
    cleared_at=NULL,cleared_by=NULL,updated_at=p_now;
  RETURN jsonb_build_object('held',true,'source',v_source,'ordersHour',v_orders_hour,'refundBps',v_refund_bps);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_risk_after_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF NEW.member_id IS NOT NULL AND NEW.share_minor>0 THEN
    PERFORM public.issue_3872_evaluate_referral_risk(NEW.member_id,NEW.created_at);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_referral_risk_after_attribution
AFTER INSERT ON public.order_attributions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_risk_after_attribution();

CREATE OR REPLACE FUNCTION public.payee_share_reverse(
  p_order_kind text,
  p_order_id uuid,
  p_refund_ref text,
  p_refunded_eligible_minor bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_share public.payee_shares%ROWTYPE;
  v_attr public.order_attributions%ROWTYPE;
  v_prior_basis bigint;
  v_prior_gross bigint;
  v_prior_net bigint;
  v_target_gross bigint;
  v_target_net bigint;
  v_delta_gross bigint;
  v_delta_net bigint;
  v_debt_id uuid;
  v_provider_reversible bigint:=0;
  v_transfer_id text;
  v_payout public.payee_payouts%ROWTYPE;
  v_existing public.payee_share_reversals%ROWTYPE;
BEGIN
  IF p_order_kind NOT IN ('ticket','venue_order') OR p_order_id IS NULL
     OR nullif(btrim(p_refund_ref),'') IS NULL OR p_refunded_eligible_minor<0 THEN
    RAISE EXCEPTION 'payee_share_reverse_invalid_input';
  END IF;
  SELECT * INTO v_share FROM public.payee_shares
  WHERE order_kind=p_order_kind AND order_id=p_order_id AND payee_kind='referral'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','no_share'); END IF;
  SELECT * INTO v_attr FROM public.order_attributions
  WHERE order_kind=p_order_kind AND order_id=p_order_id;
  IF NOT FOUND OR v_attr.eligible_minor<=0 OR v_share.gross_minor<=0 THEN
    RETURN jsonb_build_object('outcome','no_eligible_share');
  END IF;

  SELECT COALESCE(sum(refunded_eligible_minor),0),COALESCE(sum(amount_minor),0),
         COALESCE(sum(net_amount_minor),0)
    INTO v_prior_basis,v_prior_gross,v_prior_net
  FROM public.payee_share_reversals
  WHERE share_id=v_share.id AND refund_ref<>p_refund_ref;

  SELECT r.* INTO v_existing FROM public.payee_share_reversals r
  WHERE r.share_id=v_share.id AND r.refund_ref=p_refund_ref;
  IF FOUND THEN
    IF v_share.payout_id IS NOT NULL AND v_share.rail='stripe' THEN
      SELECT least(
        greatest(i.provider_amount_minor-i.provider_reversed_minor,0),
        v_existing.net_amount_minor
      ),p.provider_ref INTO v_provider_reversible,v_transfer_id
      FROM public.payee_payout_items i
      JOIN public.payee_payouts p ON p.id=i.payout_id
      WHERE i.share_id=v_share.id AND i.payout_id=v_share.payout_id
        AND (p.status IN ('paid','in_transit','pending')
          OR (p.status='failed' AND p.attempt<3));
    END IF;
    RETURN jsonb_build_object(
      'outcome','replayed','shareId',v_share.id,
      'grossReversedMinor',v_existing.amount_minor,
      'netReversedMinor',v_existing.net_amount_minor,
      'providerReversalMinor',COALESCE(v_provider_reversible,0),
      'providerTransferId',v_transfer_id
    );
  END IF;

  IF v_prior_basis+p_refunded_eligible_minor>=v_attr.eligible_minor THEN
    v_target_gross:=v_share.gross_minor;
    v_target_net:=v_share.net_minor;
  ELSE
    v_target_gross:=floor(
      v_share.gross_minor::numeric*(v_prior_basis+p_refunded_eligible_minor)
      /v_attr.eligible_minor
    )::bigint;
    v_target_net:=floor(
      v_share.net_minor::numeric*(v_prior_basis+p_refunded_eligible_minor)
      /v_attr.eligible_minor
    )::bigint;
  END IF;
  -- The share row is the locked gross-reversal authority. Use it as the delta
  -- base so replayed/provider-side ledger rows can never overrun the cap.
  v_delta_gross:=least(
    greatest(v_target_gross-v_share.reversed_minor,0),
    v_share.gross_minor-v_share.reversed_minor
  );
  v_delta_net:=least(greatest(v_target_net-v_prior_net,0),v_share.net_minor);
  IF v_delta_gross=0 THEN
    RETURN jsonb_build_object('outcome','zero','shareId',v_share.id);
  END IF;

  INSERT INTO public.payee_share_reversals(
    share_id,refund_ref,amount_minor,refunded_eligible_minor,net_amount_minor
  ) VALUES(v_share.id,btrim(p_refund_ref),v_delta_gross,p_refunded_eligible_minor,v_delta_net);
  -- The immutable reversal ledger's existing AFTER INSERT trigger advances the
  -- share exactly once; duplicating that update here would over-reverse it.

  IF v_share.payout_id IS NOT NULL THEN
    SELECT * INTO v_payout FROM public.payee_payouts
    WHERE id=v_share.payout_id FOR UPDATE;
  END IF;

  IF FOUND AND v_payout.status='pending' AND v_payout.last_attempt_at IS NULL THEN
    -- The database claimed this group but provider I/O has not begun. Burn the
    -- immutable claim and release every share so the next sweep re-prices it.
    UPDATE public.payee_payouts SET
      status='failed',attempt=3,failure_code='invalidated_before_provider',
      next_attempt_at=NULL,updated_at=now()
    WHERE id=v_payout.id;
    UPDATE public.payee_shares SET
      payout_id=NULL,
      status=CASE WHEN reversed_minor>=gross_minor THEN 'reversed' ELSE 'releasable' END,
      updated_at=now()
    WHERE payout_id=v_payout.id;
    UPDATE public.payee_debts d SET
      recovered_minor=d.recovered_minor-r.amount_minor,
      status='open',recovered_at=NULL
    FROM public.payee_debt_recoveries r
    WHERE r.payout_id=v_payout.id AND r.debt_id=d.id;
    DELETE FROM public.payee_debt_recoveries WHERE payout_id=v_payout.id;
    PERFORM public.issue_3872_evaluate_referral_risk(v_share.member_id,now());
    RETURN jsonb_build_object(
      'outcome','reversed_before_payout','shareId',v_share.id,
      'grossReversedMinor',v_delta_gross,'netReversedMinor',v_delta_net,
      'invalidatedPayoutId',v_payout.id,'providerReversalMinor',0
    );
  END IF;

  IF FOUND AND (v_payout.status IN ('paid','in_transit','pending')
       OR (v_payout.status='failed' AND v_payout.attempt<3))
     AND v_share.payee_user_id IS NOT NULL AND v_delta_net>0 THEN
    INSERT INTO public.payee_debts(
      payee_user_id,origin_share_id,origin_payout_id,rail,currency,amount_minor,reason
    ) VALUES(
      v_share.payee_user_id,v_share.id,v_payout.id,v_share.rail,v_share.currency,v_delta_net,
      CASE WHEN p_refund_ref LIKE 'dispute:%' THEN 'dispute_after_payout' ELSE 'refund_after_payout' END
    ) RETURNING id INTO v_debt_id;
    IF v_share.rail='stripe' THEN
      SELECT least(
        greatest(i.provider_amount_minor-i.provider_reversed_minor,0),v_delta_net
      ),p.provider_ref INTO v_provider_reversible,v_transfer_id
      FROM public.payee_payout_items i
      JOIN public.payee_payouts p ON p.id=i.payout_id
      WHERE i.share_id=v_share.id AND i.payout_id=v_payout.id
        AND (p.status IN ('paid','in_transit','pending')
          OR (p.status='failed' AND p.attempt<3));
    END IF;
  END IF;
  PERFORM public.issue_3872_evaluate_referral_risk(v_share.member_id,now());
  RETURN jsonb_build_object(
    'outcome','reversed','shareId',v_share.id,'grossReversedMinor',v_delta_gross,
    'netReversedMinor',v_delta_net,'debtId',v_debt_id,
    'providerReversalMinor',COALESCE(v_provider_reversible,0),
    'providerTransferId',v_transfer_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payee_record_stripe_transfer_reversal(
  p_share_id uuid,
  p_provider_reversal_id text,
  p_amount_minor bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_item public.payee_payout_items%ROWTYPE;
  v_debt public.payee_debts%ROWTYPE;
  v_left bigint;
  v_take bigint;
  v_debt_take bigint;
BEGIN
  IF nullif(btrim(p_provider_reversal_id),'') IS NULL OR p_amount_minor<=0 THEN
    RAISE EXCEPTION 'payee_transfer_reversal_invalid';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payee_provider_reversals
    WHERE provider_reversal_id=p_provider_reversal_id) THEN
    RETURN jsonb_build_object('outcome','replayed','providerReversalId',p_provider_reversal_id);
  END IF;
  SELECT i.* INTO v_item
  FROM public.payee_payout_items i
  JOIN public.payee_payouts p ON p.id=i.payout_id
  WHERE i.share_id=p_share_id AND p.rail='stripe'
    AND (p.status IN ('paid','in_transit','pending')
      OR (p.status='failed' AND p.attempt<3))
  ORDER BY p.created_at DESC
  LIMIT 1 FOR UPDATE OF i,p;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','no_payout_item'); END IF;
  v_take:=least(p_amount_minor,v_item.provider_amount_minor-v_item.provider_reversed_minor);
  IF v_take<=0 THEN
    RETURN jsonb_build_object('outcome','already_reversed','amountMinor',0);
  END IF;
  INSERT INTO public.payee_provider_reversals(
    provider_reversal_id,payout_id,share_id,amount_minor
  ) VALUES(btrim(p_provider_reversal_id),v_item.payout_id,p_share_id,v_take);
  UPDATE public.payee_payout_items
  SET provider_reversed_minor=provider_reversed_minor+v_take
  WHERE payout_id=v_item.payout_id AND share_id=p_share_id;
  v_left:=v_take;
  FOR v_debt IN
    SELECT d.* FROM public.payee_debts d
    WHERE d.origin_share_id=p_share_id AND d.origin_payout_id=v_item.payout_id
      AND d.status='open'
    ORDER BY d.created_at,d.id FOR UPDATE
  LOOP
    EXIT WHEN v_left<=0;
    v_debt_take:=least(v_left,v_debt.amount_minor-v_debt.recovered_minor);
    UPDATE public.payee_debts SET
      recovered_minor=recovered_minor+v_debt_take,
      status=CASE WHEN recovered_minor+v_debt_take=amount_minor THEN 'recovered' ELSE status END,
      recovered_at=CASE WHEN recovered_minor+v_debt_take=amount_minor THEN now() ELSE recovered_at END
    WHERE id=v_debt.id;
    v_left:=v_left-v_debt_take;
  END LOOP;
  IF v_left>0 THEN
    INSERT INTO public.payee_debts(
      payee_user_id,origin_share_id,origin_payout_id,rail,currency,amount_minor,reason
    )
    SELECT p.payee_user_id,p_share_id,p.id,p.rail,p.currency,v_left,'payout_reversal'
    FROM public.payee_payouts p WHERE p.id=v_item.payout_id;
  END IF;
  UPDATE public.payee_payouts p SET
    status='reversed',failure_code='provider_reversed',updated_at=now()
  WHERE p.id=v_item.payout_id AND NOT EXISTS(
    SELECT 1 FROM public.payee_payout_items i
    WHERE i.payout_id=p.id AND i.provider_reversed_minor<i.provider_amount_minor
  );
  RETURN jsonb_build_object('outcome','recorded','amountMinor',v_take,'providerReversalId',p_provider_reversal_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_refund_share_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_eligible bigint;
BEGIN
  IF NEW.status='succeeded' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT COALESCE(sum(amount_cents),NEW.amount_cents,0) INTO v_eligible
    FROM public.refund_line_items WHERE refund_id=NEW.id;
    PERFORM public.payee_share_reverse('ticket',NEW.order_id,
      'refund:'||COALESCE(NEW.stripe_refund_id,NEW.id::text),v_eligible);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_refund_share_trigger
AFTER INSERT OR UPDATE OF status ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_refund_share_trigger();

CREATE OR REPLACE FUNCTION public.issue_3872_installment_cancel_share_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.payee_share_reverse('ticket',NEW.order_id,
      'installment_cancel:'||NEW.id::text,NEW.amount_cents);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_installment_cancel_share_trigger
AFTER UPDATE OF status ON public.order_installments
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_installment_cancel_share_trigger();

CREATE OR REPLACE FUNCTION public.issue_3872_stripe_dispute_share_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.status='lost'
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.payee_share_reverse('ticket',NEW.order_id,
      'dispute:'||NEW.stripe_dispute_id,NEW.amount);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_stripe_dispute_share_trigger
AFTER INSERT OR UPDATE OF status ON public.stripe_disputes
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_stripe_dispute_share_trigger();

CREATE OR REPLACE FUNCTION public.issue_3872_paystack_dispute_share_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF NEW.is_resolved AND NEW.resolution IN ('merchant-accepted','merchant_accepted','accepted')
     AND (TG_OP='INSERT' OR NOT OLD.is_resolved OR OLD.resolution IS DISTINCT FROM NEW.resolution) THEN
    IF NEW.order_id IS NOT NULL THEN
      PERFORM public.payee_share_reverse('ticket',NEW.order_id,
        'dispute:'||NEW.paystack_dispute_id,NEW.amount_cents);
    ELSIF NEW.venue_menu_order_id IS NOT NULL THEN
      PERFORM public.payee_share_reverse('venue_order',NEW.venue_menu_order_id,
        'dispute:'||NEW.paystack_dispute_id,NEW.amount_cents);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_paystack_dispute_share_trigger
AFTER INSERT OR UPDATE OF is_resolved,resolution ON public.paystack_disputes
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_paystack_dispute_share_trigger();

CREATE OR REPLACE FUNCTION public.issue_3872_paystack_transfer_cost(p_minor bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT AS $fn$
  SELECT CASE
    WHEN p_minor<5000 THEN 0
    WHEN p_minor<=500000 THEN 1000
    WHEN p_minor<=5000000 THEN 2500
    ELSE 5000
  END + CASE WHEN p_minor>=1000000 THEN 5000 ELSE 0 END
$fn$;

CREATE OR REPLACE FUNCTION public.payee_prepare_payout_sweep(
  p_now timestamptz DEFAULT now(),
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  payout_id uuid,payee_user_id uuid,rail text,currency text,amount_minor bigint,
  account_ref text,attempt integer,provider_ref text,transfer_group text,
  source_charge_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_group record;
  v_payout public.payee_payouts%ROWTYPE;
  v_total bigint;
  v_debt bigint;
  v_withheld bigint;
  v_before_fee bigint;
  v_fee bigint;
  v_floor bigint;
  v_account text;
  v_source_charge_id text;
  v_count integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3872_payee_payout_sweep',3872));

  UPDATE public.payee_shares s SET status='releasable',updated_at=p_now
  WHERE s.payout_id IS NULL
    AND s.status IN ('pending','held_until_event','accumulating','failed')
    AND s.release_after<=p_now
    AND public.issue_3872_payee_remaining_net(s)>0
    AND NOT EXISTS(SELECT 1 FROM public.referral_member_risk_holds h
      WHERE h.member_id=s.member_id AND h.active)
    AND NOT EXISTS(SELECT 1 FROM public.stripe_disputes d
      WHERE s.order_kind='ticket' AND d.order_id=s.order_id
        AND d.status NOT IN ('won','lost'))
    AND NOT EXISTS(SELECT 1 FROM public.paystack_disputes d
      WHERE ((s.order_kind='ticket' AND d.order_id=s.order_id)
        OR (s.order_kind='venue_order' AND d.venue_menu_order_id=s.order_id))
        AND NOT d.is_resolved)
    AND EXISTS(SELECT 1 FROM public.payout_release_items i
      WHERE (s.order_kind='ticket' AND i.source_type='order' AND i.source_id=s.order_id)
         OR (s.order_kind='venue_order' AND i.source_type='venue_menu_order' AND i.source_id=s.order_id))
    AND (s.order_kind<>'ticket' OR NOT EXISTS(
      SELECT 1 FROM public.order_installments oi
      WHERE oi.order_id=s.order_id AND oi.status<>'collected'
    ));

  FOR v_payout IN
    SELECT p.* FROM public.payee_payouts p
    WHERE (p.status='failed' AND p.attempt<3 AND p.next_attempt_at<=p_now)
       OR (p.status='pending' AND p.updated_at<=p_now-interval '15 minutes')
    ORDER BY COALESCE(p.next_attempt_at,p.updated_at),p.created_at
    LIMIT greatest(p_limit,1)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.payee_payouts SET status='pending',next_attempt_at=NULL,
      updated_at=p_now
    WHERE id=v_payout.id;
    v_account:=v_payout.account_ref;
    IF v_account IS NULL AND v_payout.last_attempt_at IS NULL THEN
      SELECT CASE WHEN v_payout.rail='stripe' THEN a.stripe_account_id
        ELSE a.paystack_recipient_code END INTO v_account
      FROM public.payee_accounts a
      WHERE a.user_id=v_payout.payee_user_id
        AND ((v_payout.rail='stripe' AND a.stripe_status='active'
          AND a.stripe_account_id IS NOT NULL)
          OR (v_payout.rail='paystack' AND a.paystack_status='verified'
            AND a.paystack_recipient_code IS NOT NULL));
      IF v_account IS NOT NULL THEN
        UPDATE public.payee_payouts SET account_ref=v_account,updated_at=p_now
        WHERE id=v_payout.id;
      END IF;
    END IF;
    IF v_account IS NULL THEN
      UPDATE public.payee_payouts SET status='failed',next_attempt_at=CASE
          WHEN last_attempt_at IS NULL THEN NULL ELSE p_now+interval '7 days' END,
        failure_code='payout_account_unavailable',updated_at=p_now
      WHERE id=v_payout.id;
      IF v_payout.last_attempt_at IS NOT NULL THEN
        CONTINUE;
      END IF;
      UPDATE public.payee_shares s SET payout_id=NULL,
        status=CASE WHEN s.reversed_minor>=s.gross_minor THEN 'reversed' ELSE 'releasable' END,
        updated_at=p_now
      WHERE s.payout_id=v_payout.id;
      DELETE FROM public.payee_debts
      WHERE origin_payout_id=v_payout.id
        AND reason IN ('refund_after_payout','dispute_after_payout');
      UPDATE public.payee_debts d SET
        recovered_minor=d.recovered_minor-r.amount_minor,
        status='open',recovered_at=NULL
      FROM public.payee_debt_recoveries r
      WHERE r.payout_id=v_payout.id AND r.debt_id=d.id;
      DELETE FROM public.payee_debt_recoveries r WHERE r.payout_id=v_payout.id;
      CONTINUE;
    END IF;
    payout_id:=v_payout.id;payee_user_id:=v_payout.payee_user_id;
    rail:=v_payout.rail;currency:=v_payout.currency;amount_minor:=v_payout.amount_minor;
    account_ref:=v_account;attempt:=v_payout.attempt;provider_ref:=v_payout.provider_ref;
    transfer_group:=v_payout.transfer_group;source_charge_id:=v_payout.source_charge_id;
    RETURN NEXT; v_count:=v_count+1;
  END LOOP;

  FOR v_group IN
    SELECT s.payee_user_id,s.rail,s.currency,min(s.created_at) first_created
    FROM public.payee_shares s
    JOIN public.payee_accounts a ON a.user_id=s.payee_user_id
    WHERE s.status='releasable' AND s.payout_id IS NULL AND s.payee_user_id IS NOT NULL
      AND ((s.rail='stripe' AND a.stripe_status='active' AND a.stripe_account_id IS NOT NULL)
        OR (s.rail='paystack' AND a.paystack_status='verified' AND a.paystack_recipient_code IS NOT NULL))
    GROUP BY s.payee_user_id,s.rail,s.currency
    ORDER BY min(s.created_at)
    LIMIT greatest(p_limit-v_count,0)
  LOOP
    PERFORM s.id FROM public.payee_shares s
    WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
      AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL
    ORDER BY s.created_at,s.id FOR UPDATE;
    SELECT COALESCE(sum(public.issue_3872_payee_remaining_net(s)),0) INTO v_total
    FROM public.payee_shares s
    WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
      AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL;
    PERFORM d.id FROM public.payee_debts d
    WHERE d.payee_user_id=v_group.payee_user_id AND d.rail=v_group.rail
      AND d.currency=v_group.currency AND d.status='open'
    ORDER BY d.created_at,d.id FOR UPDATE;
    SELECT COALESCE(sum(d.amount_minor-d.recovered_minor),0) INTO v_debt
    FROM public.payee_debts d WHERE d.payee_user_id=v_group.payee_user_id
      AND d.rail=v_group.rail AND d.currency=v_group.currency AND d.status='open';
    v_withheld:=least(v_total,v_debt);
    v_before_fee:=v_total-v_withheld;
    SELECT f.floor_minor INTO v_floor FROM public.payee_payout_currency_floors f
      WHERE f.currency=v_group.currency;
    v_floor:=COALESCE(v_floor,500);
    IF v_group.rail='paystack' THEN v_floor:=greatest(v_floor,5000); END IF;
    IF v_before_fee<v_floor THEN
      UPDATE public.payee_shares s SET status='accumulating',updated_at=p_now
      WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
        AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL;
      CONTINUE;
    END IF;
    v_fee:=CASE WHEN v_group.rail='paystack'
      THEN public.issue_3872_paystack_transfer_cost(v_before_fee) ELSE 0 END;
    IF v_before_fee-v_fee<=0 OR (v_group.rail='paystack' AND v_before_fee-v_fee<5000) THEN
      UPDATE public.payee_shares s SET status='accumulating',updated_at=p_now
      WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
        AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL;
      CONTINUE;
    END IF;

    SELECT CASE WHEN v_group.rail='stripe' THEN a.stripe_account_id
      ELSE a.paystack_recipient_code END INTO v_account
    FROM public.payee_accounts a
    WHERE a.user_id=v_group.payee_user_id
      AND ((v_group.rail='stripe' AND a.stripe_status='active'
        AND a.stripe_account_id IS NOT NULL)
        OR (v_group.rail='paystack' AND a.paystack_status='verified'
          AND a.paystack_recipient_code IS NOT NULL));
    IF v_account IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.payee_payouts(
      payee_user_id,rail,currency,amount_minor,gross_share_minor,
      debt_withheld_minor,provider_fee_minor,idempotency_key,status,attempt,
      account_ref,transfer_group,created_at,updated_at
    ) VALUES(
      v_group.payee_user_id,v_group.rail,v_group.currency,v_before_fee-v_fee,v_total,
      v_withheld,v_fee,'payee_pending:'||gen_random_uuid()::text,'pending',0,
      v_account,'payee_pending:'||gen_random_uuid()::text,p_now,p_now
    ) RETURNING * INTO v_payout;
    UPDATE public.payee_payouts SET
      idempotency_key='payee_share:'||v_payout.id::text||':0',
      transfer_group='payee_'||v_payout.id::text
    WHERE id=v_payout.id;
    SELECT * INTO v_payout FROM public.payee_payouts WHERE id=v_payout.id;

    WITH rows AS (
      SELECT s.id,public.issue_3872_payee_remaining_net(s) settled,
        COALESCE(sum(public.issue_3872_payee_remaining_net(s)) OVER (
          ORDER BY s.created_at,s.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),0) prior
      FROM public.payee_shares s
      WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
        AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL
    )
    INSERT INTO public.payee_payout_items(payout_id,share_id,settled_minor,provider_amount_minor)
    SELECT v_payout.id,id,settled,
      greatest(least(prior+settled-v_withheld-v_fee,v_payout.amount_minor),0)
      -greatest(least(prior-v_withheld-v_fee,v_payout.amount_minor),0)
    FROM rows;
    UPDATE public.payee_shares s SET payout_id=v_payout.id,updated_at=p_now
    WHERE EXISTS(SELECT 1 FROM public.payee_payout_items i
      WHERE i.payout_id=v_payout.id AND i.share_id=s.id);

    WITH debts AS (
      SELECT d.id,d.amount_minor-d.recovered_minor remaining,
        COALESCE(sum(d.amount_minor-d.recovered_minor) OVER (
          ORDER BY d.created_at,d.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),0) prior
      FROM public.payee_debts d WHERE d.payee_user_id=v_group.payee_user_id
        AND d.rail=v_group.rail AND d.currency=v_group.currency AND d.status='open'
    ), allocations AS (
      SELECT id,greatest(least(remaining,v_withheld-prior),0)::bigint amount FROM debts
    ), inserted AS (
      INSERT INTO public.payee_debt_recoveries AS recovery(payout_id,debt_id,amount_minor)
      SELECT v_payout.id,id,amount FROM allocations WHERE amount>0
      RETURNING recovery.debt_id,recovery.amount_minor
    )
    UPDATE public.payee_debts d SET
      recovered_minor=d.recovered_minor+i.amount_minor,
      status=CASE WHEN d.recovered_minor+i.amount_minor=d.amount_minor THEN 'recovered' ELSE d.status END,
      recovered_at=CASE WHEN d.recovered_minor+i.amount_minor=d.amount_minor THEN p_now ELSE d.recovered_at END
    FROM inserted i WHERE d.id=i.debt_id;

    IF v_group.rail='stripe' AND (SELECT count(*) FROM public.payee_payout_items i WHERE i.payout_id=v_payout.id)=1 THEN
      SELECT CASE s.order_kind WHEN 'ticket' THEN o.stripe_charge_id ELSE vo.stripe_charge_id END
        INTO v_source_charge_id
      FROM public.payee_payout_items i JOIN public.payee_shares s ON s.id=i.share_id
      LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
      LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
      WHERE i.payout_id=v_payout.id AND i.provider_amount_minor>=v_payout.amount_minor;
      UPDATE public.payee_payouts SET source_charge_id=v_source_charge_id WHERE id=v_payout.id;
    ELSE v_source_charge_id:=NULL; END IF;

    payout_id:=v_payout.id;payee_user_id:=v_group.payee_user_id;
    rail:=v_group.rail;currency:=v_group.currency;amount_minor:=v_payout.amount_minor;
    account_ref:=v_account;attempt:=0;provider_ref:=NULL;
    transfer_group:=v_payout.transfer_group;
    source_charge_id:=v_source_charge_id;
    RETURN NEXT;v_count:=v_count+1;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payee_mark_payout_attempt(
  p_payout_id uuid,p_provider_ref text,p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  UPDATE public.payee_payouts SET provider_ref=COALESCE(provider_ref,p_provider_ref),
    last_attempt_at=p_now,updated_at=p_now
  WHERE id=p_payout_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'payee_payout_not_pending'; END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payee_record_payout_outcome(
  p_payout_id uuid,p_status text,p_provider_ref text DEFAULT NULL,
  p_failure_code text DEFAULT NULL,p_definitive boolean DEFAULT false,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v public.payee_payouts%ROWTYPE; v_next integer;
BEGIN
  SELECT * INTO v FROM public.payee_payouts WHERE id=p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payee_payout_not_found'; END IF;
  IF p_status IN ('paid','in_transit') THEN
    IF v.status='reversed' OR (v.status='paid' AND p_status='in_transit') THEN
      RETURN jsonb_build_object('outcome','ignored_terminal','status',v.status);
    END IF;
    IF v.status='paid' AND p_status='paid' THEN
      RETURN jsonb_build_object('outcome','replayed','status','paid');
    END IF;
    IF v.status NOT IN ('pending','failed','in_transit') THEN
      RAISE EXCEPTION 'payee_payout_not_settleable';
    END IF;
    UPDATE public.payee_payouts SET status=p_status,
      provider_ref=COALESCE(provider_ref,p_provider_ref),failure_code=NULL,
      settled_at=CASE WHEN p_status='paid' THEN p_now ELSE settled_at END,
      updated_at=p_now WHERE id=p_payout_id;
    IF p_status='paid' THEN
      UPDATE public.payee_shares SET status='paid',updated_at=p_now WHERE payout_id=p_payout_id;
    END IF;
    RETURN jsonb_build_object('outcome',p_status);
  END IF;
  IF p_status<>'failed' THEN RAISE EXCEPTION 'payee_payout_status_invalid'; END IF;
  IF v.status='failed' THEN
    RETURN jsonb_build_object('outcome','replayed','attempt',v.attempt);
  END IF;
  IF v.status<>'pending' THEN RAISE EXCEPTION 'payee_payout_not_pending'; END IF;
  v_next:=v.attempt+CASE WHEN p_definitive THEN 1 ELSE 0 END;
  IF v_next>=3 THEN
    UPDATE public.payee_payouts SET status='failed',attempt=v_next,
      failure_code=COALESCE(p_failure_code,'provider_failed'),next_attempt_at=NULL,
      updated_at=p_now WHERE id=p_payout_id;
    UPDATE public.payee_shares SET payout_id=NULL,
      status=CASE WHEN reversed_minor>=gross_minor THEN 'reversed' ELSE 'releasable' END,
      updated_at=p_now WHERE payout_id=p_payout_id;
    DELETE FROM public.payee_debts
    WHERE origin_payout_id=p_payout_id
      AND reason IN ('refund_after_payout','dispute_after_payout');
    UPDATE public.payee_debts d SET
      recovered_minor=d.recovered_minor-r.amount_minor,
      status='open',recovered_at=NULL
    FROM public.payee_debt_recoveries r
    WHERE r.payout_id=p_payout_id AND r.debt_id=d.id;
    DELETE FROM public.payee_debt_recoveries WHERE payout_id=p_payout_id;
    RETURN jsonb_build_object('outcome','exhausted','attempt',v_next);
  END IF;
  UPDATE public.payee_payouts SET status='failed',attempt=v_next,
    provider_ref=CASE WHEN p_definitive THEN NULL ELSE COALESCE(provider_ref,p_provider_ref) END,
    idempotency_key=CASE WHEN p_definitive
      THEN 'payee_share:'||id::text||':'||v_next ELSE idempotency_key END,
    failure_code=COALESCE(p_failure_code,'provider_retryable'),
    next_attempt_at=p_now+CASE v_next WHEN 0 THEN interval '15 minutes'
      WHEN 1 THEN interval '1 hour' ELSE interval '6 hours' END,
    updated_at=p_now WHERE id=p_payout_id;
  RETURN jsonb_build_object('outcome','retry','attempt',v_next);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_record_payout_reversal(
  p_payout_id uuid,p_provider_reversal_id text,p_amount_minor bigint,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_payout public.payee_payouts%ROWTYPE;
  v_item public.payee_payout_items%ROWTYPE;
  v_debt public.payee_debts%ROWTYPE;
  v_take bigint;
  v_left bigint;
  v_item_take bigint;
  v_unmatched bigint;
  v_debt_take bigint;
BEGIN
  IF nullif(btrim(p_provider_reversal_id),'') IS NULL OR p_amount_minor<=0 THEN
    RAISE EXCEPTION 'payee_payout_reversal_invalid';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payee_provider_reversals
    WHERE provider_reversal_id=p_provider_reversal_id) THEN
    RETURN jsonb_build_object('outcome','replayed','providerReversalId',p_provider_reversal_id);
  END IF;
  SELECT p.* INTO v_payout FROM public.payee_payouts p
  WHERE p.id=p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT least(p_amount_minor,COALESCE(sum(
    i.provider_amount_minor-i.provider_reversed_minor
  ),0)) INTO v_take
  FROM public.payee_payout_items i WHERE i.payout_id=p_payout_id;
  IF v_take<=0 THEN RETURN jsonb_build_object('outcome','already_reversed'); END IF;
  INSERT INTO public.payee_provider_reversals(
    provider_reversal_id,payout_id,share_id,amount_minor
  ) VALUES(btrim(p_provider_reversal_id),p_payout_id,NULL,v_take);
  v_left:=v_take;
  FOR v_item IN
    SELECT i.* FROM public.payee_payout_items i
    WHERE i.payout_id=p_payout_id AND i.provider_reversed_minor<i.provider_amount_minor
    ORDER BY i.created_at,i.share_id FOR UPDATE
  LOOP
    EXIT WHEN v_left<=0;
    v_item_take:=least(v_left,v_item.provider_amount_minor-v_item.provider_reversed_minor);
    UPDATE public.payee_payout_items SET
      provider_reversed_minor=provider_reversed_minor+v_item_take
    WHERE payout_id=v_item.payout_id AND share_id=v_item.share_id;
    v_unmatched:=v_item_take;
    FOR v_debt IN
      SELECT d.* FROM public.payee_debts d
      WHERE d.origin_share_id=v_item.share_id AND d.origin_payout_id=p_payout_id
        AND d.status='open' AND d.reason IN ('refund_after_payout','dispute_after_payout')
      ORDER BY d.created_at,d.id FOR UPDATE
    LOOP
      EXIT WHEN v_unmatched<=0;
      v_debt_take:=least(v_unmatched,v_debt.amount_minor-v_debt.recovered_minor);
      UPDATE public.payee_debts SET
        recovered_minor=recovered_minor+v_debt_take,
        status=CASE WHEN recovered_minor+v_debt_take=amount_minor THEN 'recovered' ELSE status END,
        recovered_at=CASE WHEN recovered_minor+v_debt_take=amount_minor THEN p_now ELSE recovered_at END
      WHERE id=v_debt.id;
      v_unmatched:=v_unmatched-v_debt_take;
    END LOOP;
    IF v_unmatched>0 THEN
      INSERT INTO public.payee_debts(
        payee_user_id,origin_share_id,origin_payout_id,rail,currency,amount_minor,reason
      ) VALUES(
        v_payout.payee_user_id,v_item.share_id,p_payout_id,v_payout.rail,
        v_payout.currency,v_unmatched,'payout_reversal'
      );
    END IF;
    v_left:=v_left-v_item_take;
  END LOOP;
  UPDATE public.payee_payouts p SET
    status=CASE WHEN NOT EXISTS(
      SELECT 1 FROM public.payee_payout_items i
      WHERE i.payout_id=p.id AND i.provider_reversed_minor<i.provider_amount_minor
    ) THEN 'reversed' ELSE p.status END,
    failure_code='provider_reversed',updated_at=p_now
  WHERE p.id=p_payout_id;
  RETURN jsonb_build_object(
    'outcome','reversed','payoutId',p_payout_id,
    'providerReversalId',p_provider_reversal_id,'amountMinor',v_take
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payee_record_paystack_transfer_event(
  p_reference text,p_event text,p_transfer_code text DEFAULT NULL,
  p_failure_code text DEFAULT NULL,p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_id uuid; v_attempt integer; v_match text[]; v public.payee_payouts%ROWTYPE;
BEGIN
  v_match:=regexp_match(p_reference,'^mpay_([0-9a-f-]{36})_a([0-9]+)$');
  IF v_match IS NULL THEN RETURN jsonb_build_object('outcome','not_payee'); END IF;
  v_id:=v_match[1]::uuid;v_attempt:=v_match[2]::integer;
  SELECT * INTO v FROM public.payee_payouts WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR v.rail<>'paystack' THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF v_attempt<>v.attempt THEN RETURN jsonb_build_object('outcome','stale'); END IF;
  IF p_event='transfer.success' THEN
    RETURN public.payee_record_payout_outcome(v_id,'paid',COALESCE(p_transfer_code,p_reference),NULL,false,p_now);
  ELSIF p_event='transfer.failed' THEN
    RETURN public.payee_record_payout_outcome(v_id,'failed',p_reference,p_failure_code,true,p_now);
  ELSIF p_event='transfer.reversed' THEN
    RETURN public.issue_3872_record_payout_reversal(
      v_id,'paystack:'||p_reference||':reversed',v.amount_minor,p_now
    );
  END IF;
  RETURN jsonb_build_object('outcome','ignored');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payee_record_stripe_transfer_reversed(
  p_transfer_id text,p_reversal_id text,p_amount_minor bigint,p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v public.payee_payouts%ROWTYPE;
  v_recorded bigint;
  v_delta bigint;
BEGIN
  SELECT p.* INTO v FROM public.payee_payouts p
  WHERE p.rail='stripe' AND p.provider_ref=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_payee'); END IF;
  IF EXISTS(SELECT 1 FROM public.payee_provider_reversals
    WHERE provider_reversal_id=p_reversal_id) THEN
    RETURN jsonb_build_object('outcome','replayed','providerReversalId',p_reversal_id);
  END IF;
  SELECT COALESCE(sum(r.amount_minor),0) INTO v_recorded
  FROM public.payee_provider_reversals r WHERE r.payout_id=v.id;
  v_delta:=p_amount_minor-v_recorded;
  IF v_delta<=0 THEN
    RETURN jsonb_build_object(
      'outcome','cumulative_already_recorded','amountMinor',0
    );
  END IF;
  RETURN public.issue_3872_record_payout_reversal(
    v.id,p_reversal_id,v_delta,p_now
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payee_claim_account_nudges(
  p_now timestamptz DEFAULT now(),p_limit integer DEFAULT 50
) RETURNS TABLE(payee_user_id uuid,rail text,currency text,sent_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT DISTINCT s.payee_user_id,s.rail,s.currency
    FROM public.payee_shares s LEFT JOIN public.payee_accounts a ON a.user_id=s.payee_user_id
    LEFT JOIN public.payee_payouts p ON p.id=s.payout_id
    LEFT JOIN public.payee_account_nudges n ON n.payee_user_id=s.payee_user_id
      AND n.rail=s.rail AND n.currency=s.currency
    WHERE s.payee_user_id IS NOT NULL
      AND ((s.payout_id IS NULL AND s.status IN ('releasable','accumulating'))
        OR (p.status='failed' AND p.failure_code='payout_account_unavailable'))
      AND ((s.rail='stripe' AND COALESCE(a.stripe_status,'none')<>'active')
        OR (s.rail='paystack' AND COALESCE(a.paystack_status,'none')<>'verified'))
      AND COALESCE(n.sent_count,0)<4 AND COALESCE(n.next_send_at,p_now)<=p_now
    ORDER BY s.payee_user_id,s.rail,s.currency LIMIT greatest(p_limit,1)
  ), upserted AS (
    INSERT INTO public.payee_account_nudges(payee_user_id,rail,currency,sent_count,last_sent_at,next_send_at)
    SELECT d.payee_user_id,d.rail,d.currency,1,p_now,p_now+interval '7 days' FROM due d
    ON CONFLICT ON CONSTRAINT payee_account_nudges_pkey DO UPDATE SET
      sent_count=public.payee_account_nudges.sent_count+1,last_sent_at=p_now,
      next_send_at=p_now+interval '7 days',updated_at=p_now
    RETURNING public.payee_account_nudges.payee_user_id,
      public.payee_account_nudges.rail,public.payee_account_nudges.currency,
      public.payee_account_nudges.sent_count
  ) SELECT * FROM upserted;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_list_payee_ledger(
  p_search text DEFAULT NULL,p_status_filter text DEFAULT NULL,
  p_rail_filter text DEFAULT NULL,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_rows jsonb;v_total integer;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT s.id,s.order_kind,s.order_id,s.member_id,m.display_name,m.email_norm,
      s.payee_user_id,s.brand_id,b.name brand_name,s.rail,s.currency,
      s.gross_minor,s.mingla_fee_minor,s.net_minor,s.reversed_minor,
      public.issue_3872_payee_remaining_net(s) remaining_net_minor,
      s.status,s.release_after,s.payout_id,p.status payout_status,p.provider_ref,
      p.amount_minor payout_amount_minor,p.provider_fee_minor,
      COALESCE(h.active,false) risk_held,h.source risk_source,h.reason risk_reason,
      a.stripe_status,a.paystack_status,a.bank_name,a.bank_account_last4,
      COALESCE((SELECT sum(d.amount_minor-d.recovered_minor) FROM public.payee_debts d
        WHERE d.payee_user_id=s.payee_user_id AND d.rail=s.rail
          AND d.currency=s.currency AND d.status='open'),0) open_debt_minor,
      s.created_at,s.updated_at
    FROM public.payee_shares s JOIN public.referral_members m ON m.id=s.member_id
    JOIN public.brands b ON b.id=s.brand_id
    LEFT JOIN public.payee_payouts p ON p.id=s.payout_id
    LEFT JOIN public.referral_member_risk_holds h ON h.member_id=s.member_id
    LEFT JOIN public.payee_accounts a ON a.user_id=s.payee_user_id
  ), filtered AS (
    SELECT * FROM base WHERE
      (p_search IS NULL OR brand_name ILIKE '%'||p_search||'%'
        OR display_name ILIKE '%'||p_search||'%' OR email_norm ILIKE '%'||p_search||'%'
        OR order_id::text=p_search OR id::text=p_search)
      AND (p_status_filter IS NULL OR status=p_status_filter
        OR (p_status_filter='held' AND risk_held))
      AND (p_rail_filter IS NULL OR rail=p_rail_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC),'[]'::jsonb),
    (SELECT count(*) FROM filtered) INTO v_rows,v_total
  FROM (SELECT * FROM filtered ORDER BY created_at DESC
    LIMIT greatest(p_limit,1) OFFSET greatest(p_offset,0)) q;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_referral_member_hold(
  p_member_id uuid,p_hold boolean,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_before jsonb;v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_hold IS NULL THEN RAISE EXCEPTION 'hold_required'; END IF;
  IF char_length(btrim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(h) INTO v_before FROM public.referral_member_risk_holds h
  WHERE h.member_id=p_member_id;
  INSERT INTO public.referral_member_risk_holds(
    member_id,active,source,reason,held_at,held_by,cleared_at,cleared_by,updated_at
  ) VALUES(
    p_member_id,p_hold,'admin',btrim(p_reason),now(),auth.uid(),
    CASE WHEN p_hold THEN NULL ELSE now() END,
    CASE WHEN p_hold THEN NULL ELSE auth.uid() END,now()
  ) ON CONFLICT(member_id) DO UPDATE SET
    active=p_hold,source='admin',reason=btrim(p_reason),
    held_at=CASE WHEN p_hold THEN now() ELSE referral_member_risk_holds.held_at END,
    held_by=CASE WHEN p_hold THEN auth.uid() ELSE referral_member_risk_holds.held_by END,
    cleared_at=CASE WHEN p_hold THEN NULL ELSE now() END,
    cleared_by=CASE WHEN p_hold THEN NULL ELSE auth.uid() END,updated_at=now();
  SELECT to_jsonb(h) INTO v_after FROM public.referral_member_risk_holds h
  WHERE h.member_id=p_member_id;
  PERFORM public.admin_write_audit(
    CASE WHEN p_hold THEN 'referral_member.payout_hold' ELSE 'referral_member.payout_clear' END,
    'referral_member',p_member_id::text,p_reason,
    jsonb_build_object('before',v_before,'after',v_after)
  );
  RETURN jsonb_build_object('memberId',p_member_id,'held',p_hold);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_payee_remaining_net(public.payee_shares),
  public.issue_3872_evaluate_referral_risk(uuid,timestamptz),
  public.payee_share_reverse(text,uuid,text,bigint),
  public.payee_record_stripe_transfer_reversal(uuid,text,bigint),
  public.payee_prepare_payout_sweep(timestamptz,integer),
  public.payee_mark_payout_attempt(uuid,text,timestamptz),
  public.payee_record_payout_outcome(uuid,text,text,text,boolean,timestamptz),
  public.issue_3872_record_payout_reversal(uuid,text,bigint,timestamptz),
  public.payee_record_paystack_transfer_event(text,text,text,text,timestamptz),
  public.payee_record_stripe_transfer_reversed(text,text,bigint,timestamptz),
  public.payee_claim_account_nudges(timestamptz,integer),
  public.admin_list_payee_ledger(text,text,text,integer,integer),
  public.admin_set_referral_member_hold(uuid,boolean,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_evaluate_referral_risk(uuid,timestamptz),
  public.payee_share_reverse(text,uuid,text,bigint),
  public.payee_record_stripe_transfer_reversal(uuid,text,bigint),
  public.payee_prepare_payout_sweep(timestamptz,integer),
  public.payee_mark_payout_attempt(uuid,text,timestamptz),
  public.payee_record_payout_outcome(uuid,text,text,text,boolean,timestamptz),
  public.issue_3872_record_payout_reversal(uuid,text,bigint,timestamptz),
  public.payee_record_paystack_transfer_event(text,text,text,text,timestamptz),
  public.payee_record_stripe_transfer_reversed(text,text,bigint,timestamptz),
  public.payee_claim_account_nudges(timestamptz,integer)
TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_payee_ledger(text,text,text,integer,integer),
  public.admin_set_referral_member_hold(uuid,boolean,text) TO authenticated;

DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#3872: pg_cron/pg_net unavailable; payee payout sweep not scheduled'; RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#3872: runtime vault rows unavailable; payee payout sweep not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_3872_payee_payout_sweep';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_3872_payee_payout_sweep','*/30 * * * *',$job$SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/payee-payout-sweep',
    headers:=jsonb_build_object('content-type','application/json','authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body:='{}'::jsonb,timeout_milliseconds:=30000)$job$);
END;
$cron$;

NOTIFY pgrst,'reload schema';
COMMIT;
