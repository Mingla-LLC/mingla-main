-- Issue #1171 — event-anchored payout ledger and DARK release sweep.
-- Data truth only: this migration and its cron never call a payment provider.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS payout_hold_cutover_at timestamptz;

CREATE TABLE public.payout_source_fee_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('order','rsvp_contribution','venue_reservation')),
  source_id uuid NOT NULL,
  provider_fee_cents integer NOT NULL CHECK (provider_fee_cents >= 0),
  provider_balance_transaction_id text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE TABLE public.brand_payout_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  event_date_id uuid REFERENCES public.event_dates(id) ON DELETE SET NULL,
  occurrence_key text NOT NULL,
  surface text NOT NULL CHECK (surface IN ('order','rsvp_contribution','venue_reservation')),
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  currency text NOT NULL CHECK (currency = lower(currency) AND length(currency) = 3),
  anchor_end_at timestamptz NOT NULL,
  releasable_at timestamptz NOT NULL,
  gross_cents integer NOT NULL CHECK (gross_cents >= 0),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  disputed_cents integer NOT NULL DEFAULT 0 CHECK (disputed_cents >= 0),
  mingla_fee_cents integer NOT NULL DEFAULT 0 CHECK (mingla_fee_cents >= 0),
  partner_share_cents integer NOT NULL DEFAULT 0 CHECK (partner_share_cents >= 0),
  provider_fee_cents integer NOT NULL DEFAULT 0 CHECK (provider_fee_cents >= 0),
  permanent_debt_withheld_cents integer NOT NULL DEFAULT 0 CHECK (permanent_debt_withheld_cents >= 0),
  temporary_debt_withheld_cents integer NOT NULL DEFAULT 0 CHECK (temporary_debt_withheld_cents >= 0),
  maturity_recredit_cents integer NOT NULL DEFAULT 0 CHECK (maturity_recredit_cents >= 0),
  net_release_cents integer NOT NULL CHECK (net_release_cents >= 0),
  organiser_cash_delivered_cents integer NOT NULL DEFAULT 0
    CHECK (organiser_cash_delivered_cents >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','released','in_flight','blocked_kyc','blocked_balance','blocked_otp',
    'blocked_over_cap','fee_unreconciled','cancelled_event','reanchored','failed'
  )),
  stripe_payout_id text,
  paystack_transfer_code text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_payout_release_anchor_order CHECK (releasable_at = anchor_end_at + interval '3 days')
);

CREATE UNIQUE INDEX brand_payout_releases_unit_uniq
  ON public.brand_payout_releases
  (brand_id, occurrence_key, surface, provider, currency);
CREATE INDEX brand_payout_releases_pending_idx
  ON public.brand_payout_releases (status, releasable_at, created_at);
CREATE INDEX brand_payout_releases_event_idx
  ON public.brand_payout_releases (event_id, event_date_id);

CREATE TABLE public.payout_release_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('order','rsvp_contribution','venue_reservation')),
  source_id uuid NOT NULL,
  gross_cents integer NOT NULL CHECK (gross_cents >= 0),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  disputed_cents integer NOT NULL DEFAULT 0 CHECK (disputed_cents >= 0),
  mingla_fee_cents integer NOT NULL DEFAULT 0 CHECK (mingla_fee_cents >= 0),
  partner_share_cents integer NOT NULL DEFAULT 0 CHECK (partner_share_cents >= 0),
  -- Charge-processing cost only. Outbound transfer costs live in payout_transfer_legs.
  provider_fee_cents integer NOT NULL DEFAULT 0 CHECK (provider_fee_cents >= 0),
  net_cents integer NOT NULL CHECK (net_cents >= 0),
  attached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX payout_release_items_release_idx ON public.payout_release_items (release_id);

CREATE TABLE public.payout_transfer_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  partner_split_id uuid REFERENCES public.partner_splits(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('organiser','partner')),
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  principal_cents integer NOT NULL CHECK (principal_cents >= 0),
  estimated_fee_cents integer NOT NULL DEFAULT 0 CHECK (estimated_fee_cents >= 0),
  stamp_duty_cents integer NOT NULL DEFAULT 0 CHECK (stamp_duty_cents >= 0),
  actual_fee_cents integer CHECK (actual_fee_cents >= 0),
  actual_stamp_duty_cents integer CHECK (actual_stamp_duty_cents >= 0),
  fee_variance_cents integer,
  fee_schedule_version text NOT NULL,
  provider_reference text,
  provider_transfer_code text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned','in_flight','succeeded','failed','reversed','fee_unreconciled'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  UNIQUE (release_id, kind, partner_split_id, chunk_index),
  UNIQUE (provider_reference)
);

CREATE TABLE public.payout_ledger_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency = lower(currency)),
  kind text NOT NULL CHECK (kind IN (
    'post_release_refund','post_release_dispute','dispute_reversal',
    'transfer_fee_debit','transfer_fee_credit','maturity_recredit','debt_writeoff'
  )),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  provider_ref text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organiser_payout_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency = lower(currency)),
  origin_release_id uuid NOT NULL REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN (
    'post_release_refund','post_release_dispute','post_release_cancellation',
    'post_release_postponement'
  )),
  principal_cents integer NOT NULL CHECK (principal_cents >= 0),
  recovered_cents integer NOT NULL DEFAULT 0 CHECK (
    recovered_cents >= 0 AND recovered_cents <= principal_cents
  ),
  maturity_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','converted')),
  idempotency_key text NOT NULL UNIQUE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (origin_release_id, kind)
);
CREATE INDEX organiser_payout_debts_open_idx
  ON public.organiser_payout_debts (brand_id, currency, kind, opened_at)
  WHERE status = 'open';

CREATE TABLE public.payout_debt_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.organiser_payout_debts(id) ON DELETE RESTRICT,
  release_id uuid NOT NULL REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (debt_id, release_id)
);

CREATE TABLE public.payout_debt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.organiser_payout_debts(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN (
    'opened','anchor_moved','future_value_reserved','future_value_released',
    'cleared','cancellation_converted'
  )),
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  anchor_at timestamptz,
  release_id uuid REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.reject_payout_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'payout_ledger_append_only' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE TRIGGER payout_release_items_append_only
  BEFORE UPDATE OR DELETE ON public.payout_release_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();
CREATE TRIGGER payout_transfer_legs_append_only
  BEFORE DELETE ON public.payout_transfer_legs
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();
CREATE TRIGGER payout_ledger_adjustments_append_only
  BEFORE UPDATE OR DELETE ON public.payout_ledger_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();
CREATE TRIGGER payout_debt_applications_append_only
  BEFORE UPDATE OR DELETE ON public.payout_debt_applications
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();
CREATE TRIGGER payout_debt_events_append_only
  BEFORE UPDATE OR DELETE ON public.payout_debt_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();

ALTER TABLE public.payout_source_fee_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_payout_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_release_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_transfer_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_ledger_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organiser_payout_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_debt_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_debt_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_payout_releases_brand_read ON public.brand_payout_releases
  FOR SELECT TO authenticated USING (
    public.biz_brand_effective_rank(brand_id, auth.uid()) >= public.biz_role_rank('finance_manager')
  );
CREATE POLICY payout_release_items_brand_read ON public.payout_release_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.brand_payout_releases r
      WHERE r.id = payout_release_items.release_id
        AND public.biz_brand_effective_rank(r.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager')
    )
  );
CREATE POLICY payout_transfer_legs_brand_read ON public.payout_transfer_legs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.brand_payout_releases r
      WHERE r.id = payout_transfer_legs.release_id
        AND public.biz_brand_effective_rank(r.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager')
    )
  );
CREATE POLICY payout_adjustments_brand_read ON public.payout_ledger_adjustments
  FOR SELECT TO authenticated USING (
    public.biz_brand_effective_rank(brand_id, auth.uid()) >= public.biz_role_rank('finance_manager')
  );
CREATE POLICY payout_debts_brand_read ON public.organiser_payout_debts
  FOR SELECT TO authenticated USING (
    public.biz_brand_effective_rank(brand_id, auth.uid()) >= public.biz_role_rank('finance_manager')
  );
CREATE POLICY payout_debt_applications_brand_read ON public.payout_debt_applications
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.organiser_payout_debts d
      WHERE d.id = payout_debt_applications.debt_id
        AND public.biz_brand_effective_rank(d.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager')
    )
  );
CREATE POLICY payout_debt_events_brand_read ON public.payout_debt_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.organiser_payout_debts d
      WHERE d.id = payout_debt_events.debt_id
        AND public.biz_brand_effective_rank(d.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager')
    )
  );
-- No client write policy on any ledger table; service_role bypasses RLS.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.payout_source_fee_snapshots TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.brand_payout_releases TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.payout_release_items TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.payout_transfer_legs TO service_role;
GRANT SELECT,INSERT ON public.payout_ledger_adjustments TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.organiser_payout_debts TO service_role;
GRANT SELECT,INSERT ON public.payout_debt_applications TO service_role;
GRANT SELECT,INSERT ON public.payout_debt_events TO service_role;
GRANT SELECT ON public.brand_payout_releases,public.payout_release_items,
  public.payout_transfer_legs,public.payout_ledger_adjustments,
  public.organiser_payout_debts,public.payout_debt_applications,
  public.payout_debt_events TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_payout_live_anchor(
  p_event_id uuid,
  p_event_date_id uuid,
  p_finalized_at timestamptz
) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_event_date_id IS NOT NULL THEN (
      SELECT ed.end_at FROM public.event_dates ed
      WHERE ed.id = p_event_date_id AND ed.event_id = p_event_id
    )
    ELSE COALESCE(
      (SELECT min(ed.end_at) FROM public.event_dates ed
       WHERE ed.event_id = p_event_id AND ed.end_at >= p_finalized_at),
      (SELECT max(ed.end_at) FROM public.event_dates ed WHERE ed.event_id = p_event_id)
    )
  END;
$fn$;

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
  v_net integer;
BEGIN
  IF p_source_type NOT IN ('order','rsvp_contribution','venue_reservation')
     OR p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;
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

  INSERT INTO public.brand_payout_releases (
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_release_cents
  ) VALUES (
    p_brand_id,p_event_id,p_event_date_id,p_occurrence_key,p_source_type,p_provider,
    lower(p_currency),p_anchor_end_at,p_anchor_end_at + interval '3 days',
    p_gross_cents,p_refunded_cents,p_disputed_cents,p_mingla_fee_cents,
    p_partner_share_cents,p_provider_fee_cents,v_net
  )
  ON CONFLICT (brand_id,occurrence_key,surface,provider,currency)
  DO UPDATE SET
    anchor_end_at = EXCLUDED.anchor_end_at,
    releasable_at = EXCLUDED.releasable_at,
    updated_at = now()
  WHERE brand_payout_releases.status = 'pending'
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    SELECT id INTO v_release_id FROM public.brand_payout_releases
     WHERE brand_id=p_brand_id AND occurrence_key=p_occurrence_key
       AND surface=p_source_type AND provider=p_provider AND currency=lower(p_currency);
  END IF;

  INSERT INTO public.payout_release_items (
    release_id,source_type,source_id,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_cents
  ) VALUES (
    v_release_id,p_source_type,p_source_id,p_gross_cents,p_refunded_cents,
    p_disputed_cents,p_mingla_fee_cents,p_partner_share_cents,p_provider_fee_cents,v_net
  ) ON CONFLICT (source_type,source_id) DO NOTHING;

  -- Totals are rebuilt from immutable items, never from provider balances.
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
  v_maturity := p_live_anchor_end_at + interval '3 days';
  INSERT INTO public.organiser_payout_debts (
    brand_id,currency,origin_release_id,kind,principal_cents,maturity_at,idempotency_key
  ) VALUES (
    v_release.brand_id,v_release.currency,v_release.id,'post_release_postponement',
    v_release.organiser_cash_delivered_cents,v_maturity,'postpone:'||v_release.id
  )
  ON CONFLICT (origin_release_id,kind) DO UPDATE SET
    maturity_at=EXCLUDED.maturity_at,updated_at=now()
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
DECLARE v_release record; v_anchor timestamptz; v_count integer:=0;
BEGIN
  FOR v_release IN
    SELECT r.* FROM public.brand_payout_releases r
     WHERE r.status='released' AND r.event_id IS NOT NULL
       AND r.organiser_cash_delivered_cents>0
     ORDER BY r.released_at,r.id
  LOOP
    v_anchor:=public.resolve_payout_live_anchor(
      v_release.event_id,v_release.event_date_id,v_release.created_at
    );
    IF v_anchor IS NOT NULL
       AND v_anchor+interval '3 days'>p_now
       AND v_anchor>v_release.anchor_end_at THEN
      PERFORM public.open_post_release_postponement_debt(v_release.id,v_anchor);
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.apply_open_payout_debts(p_release_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_release public.brand_payout_releases; v_debt record; v_available integer; v_take integer; v_total integer:=0;
BEGIN
  SELECT * INTO v_release FROM public.brand_payout_releases
   WHERE id=p_release_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_available := v_release.net_release_cents;
  FOR v_debt IN
    SELECT * FROM public.organiser_payout_debts
     WHERE brand_id=v_release.brand_id AND currency=v_release.currency AND status='open'
       AND (kind <> 'post_release_postponement' OR maturity_at > now())
     ORDER BY CASE WHEN kind='post_release_postponement' THEN 1 ELSE 0 END, opened_at, id
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_available=0;
    v_take:=least(v_available,v_debt.principal_cents-v_debt.recovered_cents);
    IF v_take>0 THEN
      INSERT INTO public.payout_debt_applications(debt_id,release_id,amount_cents,idempotency_key)
      VALUES(v_debt.id,p_release_id,v_take,'debt-apply:'||v_debt.id||':'||p_release_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
      IF FOUND THEN
        UPDATE public.organiser_payout_debts SET recovered_cents=recovered_cents+v_take,updated_at=now()
         WHERE id=v_debt.id;
        INSERT INTO public.payout_debt_events(debt_id,event_kind,amount_cents,release_id,idempotency_key)
        VALUES(v_debt.id,'future_value_reserved',v_take,p_release_id,
          'debt-reserve:'||v_debt.id||':'||p_release_id) ON CONFLICT DO NOTHING;
        v_available:=v_available-v_take; v_total:=v_total+v_take;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.brand_payout_releases SET
    permanent_debt_withheld_cents = (
      SELECT coalesce(sum(a.amount_cents),0)::int FROM public.payout_debt_applications a
      JOIN public.organiser_payout_debts d ON d.id=a.debt_id
      WHERE a.release_id=p_release_id AND d.kind <> 'post_release_postponement'
    ),
    temporary_debt_withheld_cents = (
      SELECT coalesce(sum(a.amount_cents),0)::int FROM public.payout_debt_applications a
      JOIN public.organiser_payout_debts d ON d.id=a.debt_id
      WHERE a.release_id=p_release_id AND d.kind='post_release_postponement'
    ),
    net_release_cents=v_available,updated_at=now()
  WHERE id=p_release_id;
  RETURN v_total;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mature_postponement_debts(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_debt record; v_count integer:=0;
BEGIN
  FOR v_debt IN
    SELECT * FROM public.organiser_payout_debts
     WHERE kind='post_release_postponement' AND status='open' AND maturity_at<=p_now
     ORDER BY maturity_at,id FOR UPDATE SKIP LOCKED
  LOOP
    IF v_debt.recovered_cents>0 THEN
      INSERT INTO public.payout_ledger_adjustments(
        release_id,brand_id,currency,kind,amount_cents,idempotency_key
      ) VALUES(
        v_debt.origin_release_id,v_debt.brand_id,v_debt.currency,'maturity_recredit',
        v_debt.recovered_cents,'postpone-recredit:'||v_debt.id
      ) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    IF v_debt.principal_cents>v_debt.recovered_cents THEN
      INSERT INTO public.payout_ledger_adjustments(
        release_id,brand_id,currency,kind,amount_cents,idempotency_key
      ) VALUES(
        v_debt.origin_release_id,v_debt.brand_id,v_debt.currency,'debt_writeoff',
        v_debt.principal_cents-v_debt.recovered_cents,'postpone-close:'||v_debt.id
      ) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    UPDATE public.organiser_payout_debts SET status='closed',closed_at=p_now,updated_at=now()
     WHERE id=v_debt.id;
    INSERT INTO public.payout_debt_events(debt_id,event_kind,amount_cents,anchor_at,idempotency_key)
    VALUES(v_debt.id,'cleared',v_debt.recovered_cents,v_debt.maturity_at,'postpone-cleared:'||v_debt.id)
    ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_missing_payout_source_fees(p_limit integer DEFAULT 100)
RETURNS TABLE(
  source_type text,source_id uuid,provider text,provider_reference text,
  stripe_account_id text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT * FROM (
    SELECT 'order'::text AS source_type,o.id AS source_id,
      b.payment_provider AS provider,
      coalesce(o.stripe_charge_id,o.stripe_payment_intent_id) AS provider_reference,
      CASE WHEN b.payment_provider='stripe' THEN b.stripe_connect_id ELSE NULL END
        AS stripe_account_id
    FROM public.orders o JOIN public.events e ON e.id=o.event_id
    JOIN public.brands b ON b.id=e.brand_id
    WHERE o.payment_status IN ('paid','partial_refund') AND o.total_cents>0
      AND b.payout_hold_cutover_at IS NOT NULL AND o.created_at>b.payout_hold_cutover_at
    UNION ALL
    SELECT 'rsvp_contribution',c.id,c.provider,
      coalesce(c.stripe_charge_id,c.stripe_payment_intent_id),
      CASE WHEN c.provider='stripe' THEN b.stripe_connect_id ELSE NULL END
    FROM public.event_rsvp_contributions c JOIN public.brands b ON b.id=c.brand_id
    WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
      AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_reservation',s.id,b.payment_provider,
      coalesce(s.paystack_reference,s.stripe_payment_intent_id,s.stripe_checkout_session_id),
      CASE WHEN b.payment_provider='stripe' THEN s.stripe_account_id ELSE NULL END
    FROM public.reservation_checkout_sessions s JOIN public.brands b ON b.id=s.brand_id
    WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
      AND s.updated_at>b.payout_hold_cutover_at
  ) q
  WHERE q.provider_reference IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_source_fee_snapshots f
      WHERE f.source_type=q.source_type AND f.source_id=q.source_id
    )
  ORDER BY q.source_type,q.source_id
  LIMIT greatest(1,least(p_limit,500));
$fn$;

CREATE OR REPLACE FUNCTION public.run_payout_release_dark_sweep(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_row record; v_release_id uuid; v_created integer:=0; v_matured integer;
  v_opened integer;
BEGIN
  v_opened:=public.sync_post_release_postponement_debts(p_now);
  v_matured:=public.mature_postponement_debts(p_now);
  FOR v_row IN
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,o.event_date_id,
        b.payment_provider provider,lower(o.currency::text) currency,o.created_at finalized_at,
        public.resolve_payout_live_anchor(o.event_id,o.event_date_id,o.created_at) anchor_end_at,
        o.total_cents gross_cents,o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        o.stripe_application_fee_amount_cents mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        coalesce(fs.provider_fee_cents,0) provider_fee_cents,
        coalesce(o.event_date_id::text,'fallback:'||public.resolve_payout_live_anchor(
          o.event_id,o.event_date_id,o.created_at)::text) occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,NULL::uuid,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),
        public.resolve_payout_live_anchor(c.event_id,NULL,coalesce(c.paid_at,c.created_at)),
        c.buyer_total_cents,c.refunded_amount_cents,0,c.application_fee_amount_cents,0,
        coalesce(fs.provider_fee_cents,0),
        'fallback:'||public.resolve_payout_live_anchor(
          c.event_id,NULL,coalesce(c.paid_at,c.created_at))::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),s.updated_at,s.reserved_for,s.amount_cents,0,0,0,0,
        coalesce(fs.provider_fee_cents,0),'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND s.updated_at>b.payout_hold_cutover_at
    )
    SELECT * FROM candidates c
     WHERE c.anchor_end_at IS NOT NULL AND c.anchor_end_at+interval '3 days'<=p_now
       AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
         WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
     ORDER BY c.anchor_end_at,c.source_id
  LOOP
    v_release_id:=public.attach_payout_release(
      v_row.source_type,v_row.source_id,v_row.brand_id,v_row.event_id,v_row.event_date_id,
      v_row.occurrence_key,v_row.provider,v_row.currency,v_row.finalized_at,v_row.anchor_end_at,
      v_row.gross_cents,v_row.refunded_cents,v_row.disputed_cents,v_row.mingla_fee_cents,
      v_row.partner_share_cents,v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id);
    v_created:=v_created+1;
  END LOOP;
  RETURN jsonb_build_object(
    'dark',true,'attached',v_created,'opened_postponement_debts',v_opened,
    'matured_debts',v_matured,'executed',0
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_payout_live_anchor(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_payout_live_anchor(uuid,uuid,timestamptz) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.attach_payout_release(text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_payout_release(text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,integer) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.open_post_release_postponement_debt(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_post_release_postponement_debt(uuid,timestamptz) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_post_release_postponement_debts(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_post_release_postponement_debts(timestamptz) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.apply_open_payout_debts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_open_payout_debts(uuid) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.mature_postponement_debts(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mature_postponement_debts(timestamptz) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.list_missing_payout_source_fees(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_missing_payout_source_fees(integer) FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_payout_live_anchor(uuid,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_payout_release(text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_post_release_postponement_debt(uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_post_release_postponement_debts(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_open_payout_debts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mature_postponement_debts(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_missing_payout_source_fees(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) TO service_role;

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='vault') THEN
    RAISE NOTICE '#1171 advisory: Vault unavailable; configure supabase_url and service_role_key before cron runtime';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1171_payout_release_dark_sweep') THEN
    PERFORM cron.unschedule('issue_1171_payout_release_dark_sweep');
  END IF;
END$$;

SELECT cron.schedule(
  'issue_1171_payout_release_dark_sweep',
  '*/30 * * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name='supabase_url' LIMIT 1) || '/functions/v1/payout-release-sweep',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                      WHERE name='service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='issue_1171_payout_release_dark_sweep'
      AND schedule='*/30 * * * *'
  ) THEN RAISE EXCEPTION '#1171 cron registration failed'; END IF;
END$$;
