-- Issue #1175: replay-safe Paystack refund reconciliation and post-release debt.
BEGIN;

CREATE TABLE public.paystack_refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('order','venue_reservation')),
  source_id uuid NOT NULL,
  local_refund_id uuid REFERENCES public.refunds(id) ON DELETE SET NULL,
  transaction_reference text NOT NULL,
  merchant_note text NOT NULL,
  provider_refund_id text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency = lower(currency)),
  status text NOT NULL CHECK (status IN ('accepted','processed','failed')),
  error_message text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX paystack_refund_attempts_provider_ref_uidx
  ON public.paystack_refund_attempts(provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
CREATE INDEX paystack_refund_attempts_transaction_idx
  ON public.paystack_refund_attempts(transaction_reference, status);

ALTER TABLE public.paystack_refund_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paystack_refund_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.paystack_refund_attempts TO service_role;

-- B's direct-debt application remains one row per debt/release. Refund
-- conversion is different: later partial refunds can convert a second,
-- non-overlapping slice of the same temporary application. Permit those
-- immutable conversion slices while preserving the direct-application guard.
ALTER TABLE public.payout_debt_applications
  DROP CONSTRAINT payout_debt_applications_debt_id_release_id_key;
CREATE UNIQUE INDEX payout_debt_applications_direct_once_idx
  ON public.payout_debt_applications(debt_id,release_id)
  WHERE idempotency_key LIKE 'debt-apply:%';

CREATE OR REPLACE FUNCTION public.record_paystack_refund_outcome(
  p_source_type text,
  p_source_id uuid,
  p_local_refund_id uuid,
  p_transaction_reference text,
  p_merchant_note text,
  p_provider_refund_id text,
  p_amount_cents integer,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_attempt_id uuid;
  v_release_id uuid;
  v_release public.brand_payout_releases;
  v_liability integer;
  v_adjustment_key text;
  v_debt_id uuid;
  v_debt public.organiser_payout_debts;
  v_temp public.organiser_payout_debts;
  v_target_liability integer;
  v_growth integer;
  v_overlap integer;
  v_recovered_overlap integer;
  v_left integer;
  v_take integer;
  v_app record;
BEGIN
  IF p_source_type NOT IN ('order','venue_reservation')
     OR p_source_id IS NULL
     OR p_transaction_reference IS NULL OR btrim(p_transaction_reference)=''
     OR p_merchant_note IS NULL OR btrim(p_merchant_note)=''
     OR p_amount_cents<0
     OR p_status NOT IN ('accepted','processed','failed') THEN
    RAISE EXCEPTION 'invalid_paystack_refund_outcome' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.paystack_refund_attempts(
    source_type,source_id,local_refund_id,transaction_reference,merchant_note,
    provider_refund_id,amount_cents,currency,status,error_message,idempotency_key,
    created_at,updated_at
  ) VALUES(
    p_source_type,p_source_id,p_local_refund_id,p_transaction_reference,p_merchant_note,
    NULLIF(p_provider_refund_id,''),p_amount_cents,'ngn',p_status,p_error_message,
    'paystack-refund:'||p_merchant_note,p_now,p_now
  )
  ON CONFLICT(idempotency_key) DO UPDATE SET
    provider_refund_id=coalesce(
      public.paystack_refund_attempts.provider_refund_id,
      excluded.provider_refund_id
    ),
    status=CASE
      WHEN public.paystack_refund_attempts.status='processed' THEN 'processed'
      WHEN excluded.status='processed' THEN 'processed'
      WHEN excluded.status='failed' THEN 'failed'
      ELSE public.paystack_refund_attempts.status
    END,
    error_message=excluded.error_message,
    updated_at=excluded.updated_at
  RETURNING id INTO v_attempt_id;

  IF p_status<>'processed' THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  SELECT pri.release_id INTO v_release_id
  FROM public.payout_release_items pri
  JOIN public.brand_payout_releases r ON r.id=pri.release_id
  WHERE pri.source_type=p_source_type
    AND pri.source_id=p_source_id
    AND r.provider='paystack'
    AND r.status='released'
  LIMIT 1;
  IF v_release_id IS NULL THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  SELECT * INTO v_release FROM public.brand_payout_releases
  WHERE id=v_release_id FOR UPDATE;
  v_liability:=least(p_amount_cents,v_release.organiser_cash_delivered_cents);
  IF v_liability<=0 THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  v_adjustment_key:='paystack-refund-liability:'||v_attempt_id;
  INSERT INTO public.payout_ledger_adjustments(
    release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key,created_at
  ) VALUES(
    v_release.id,v_release.brand_id,v_release.currency,'post_release_refund',
    v_liability,NULLIF(p_provider_refund_id,''),v_adjustment_key,p_now
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT id INTO v_debt_id FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id AND kind='post_release_refund';
    RETURN jsonb_build_object(
      'attempt_id',v_attempt_id,'debt_created',v_debt_id IS NOT NULL,'debt_id',v_debt_id
    );
  END IF;

  SELECT least(
    coalesce(sum(amount_cents),0)::integer,
    v_release.organiser_cash_delivered_cents
  ) INTO v_target_liability
  FROM public.payout_ledger_adjustments
  WHERE release_id=v_release.id AND kind='post_release_refund';

  SELECT * INTO v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release.id AND kind='post_release_refund'
  FOR UPDATE;
  IF NOT FOUND THEN
    v_debt_id:=public.convert_postponement_debt_to_permanent(
      v_release.id,'post_release_refund',v_target_liability,p_now
    );
  ELSIF v_target_liability>v_debt.principal_cents THEN
    v_growth:=v_target_liability-v_debt.principal_cents;
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id
      AND kind='post_release_postponement' AND status='open'
    FOR UPDATE;
    IF FOUND THEN
      v_overlap:=least(v_growth,v_temp.principal_cents);
      v_recovered_overlap:=least(v_overlap,v_temp.recovered_cents);
    ELSE
      v_overlap:=0;
      v_recovered_overlap:=0;
    END IF;

    UPDATE public.organiser_payout_debts SET
      principal_cents=v_target_liability,
      recovered_cents=recovered_cents+v_recovered_overlap,
      status=CASE
        WHEN recovered_cents+v_recovered_overlap=v_target_liability THEN 'closed'
        ELSE 'open'
      END,
      closed_at=CASE
        WHEN recovered_cents+v_recovered_overlap=v_target_liability THEN p_now
        ELSE NULL
      END,
      updated_at=p_now
    WHERE id=v_debt.id;
    v_debt_id:=v_debt.id;

    IF v_overlap>0 THEN
      v_left:=v_recovered_overlap;
      FOR v_app IN
        SELECT * FROM public.payout_debt_applications
        WHERE debt_id=v_temp.id AND released_at IS NULL
          AND amount_cents>converted_cents
        ORDER BY created_at,id FOR UPDATE
      LOOP
        EXIT WHEN v_left=0;
        v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents);
        UPDATE public.payout_debt_applications
        SET converted_cents=converted_cents+v_take WHERE id=v_app.id;
        INSERT INTO public.payout_debt_applications(
          debt_id,release_id,amount_cents,idempotency_key,created_at
        ) VALUES(
          v_debt.id,v_app.release_id,v_take,
          'converted-apply:'||v_debt.id||':'||v_app.id||':'||v_target_liability,p_now
        );
        v_left:=v_left-v_take;
      END LOOP;
      UPDATE public.organiser_payout_debts SET
        principal_cents=principal_cents-v_overlap,
        recovered_cents=recovered_cents-v_recovered_overlap,
        status=CASE WHEN principal_cents-v_overlap=0 THEN 'converted' ELSE 'open' END,
        closed_at=CASE WHEN principal_cents-v_overlap=0 THEN p_now ELSE NULL END,
        updated_at=p_now
      WHERE id=v_temp.id;
      INSERT INTO public.payout_debt_events(
        debt_id,event_kind,amount_cents,release_id,idempotency_key,created_at
      ) VALUES(
        v_temp.id,'cancellation_converted',v_overlap,v_release.id,
        'postpone-convert:'||v_temp.id||':post_release_refund:'||v_target_liability,p_now
      );
    END IF;
  ELSE
    v_debt_id:=v_debt.id;
  END IF;
  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'debt_created',true,'debt_id',v_debt_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_paystack_refund_outcome(
  text,uuid,uuid,text,text,text,integer,text,text,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_refund_outcome(
  text,uuid,uuid,text,text,text,integer,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_paystack_refund_outcome(
  text,uuid,uuid,text,text,text,integer,text,text,timestamptz
) IS 'Issue #1175: idempotently records Paystack refund acceptance/webhooks and converts matching temporary postponement debt to permanent post-release refund liability exactly once.';

COMMIT;
