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
  status text NOT NULL CHECK (status IN ('pending','accepted','processed','failed')),
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
     OR p_status NOT IN ('pending','accepted','processed','failed') THEN
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
      WHEN public.paystack_refund_attempts.status='accepted'
        OR excluded.status='accepted' THEN 'accepted'
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

CREATE OR REPLACE FUNCTION public.biz_cancel_trip_booking_begin(
  p_order_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_reason text,
  p_cancel_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_compute jsonb;
  v_refund_id uuid;
  v_existing_refund public.refunds;
  v_order public.orders;
  v_payment jsonb;
  v_payment_rows jsonb := '[]'::jsonb;
  v_suffix text;
  v_paid_cents integer;
  v_paid_total integer := 0;
  v_provider text;
BEGIN
  IF p_actor_kind IS NULL OR p_actor_kind NOT IN ('buyer','operator') THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_actor_kind');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_found');
  END IF;
  SELECT b.payment_provider INTO v_provider
  FROM public.orders o
  JOIN public.events e ON e.id=o.event_id
  JOIN public.brands b ON b.id=e.brand_id
  WHERE o.id=p_order_id;

  IF v_order.cancelled_at IS NOT NULL THEN
    SELECT r.* INTO v_existing_refund
    FROM public.refunds r
    WHERE r.order_id=p_order_id AND r.status='pending'
      AND EXISTS(
        SELECT 1 FROM public.paystack_refund_attempts a
        WHERE a.local_refund_id=r.id
          AND a.merchant_note LIKE 'mingla_trip_refund:'||r.id||':%'
          AND a.status IN ('pending','accepted','processed')
      )
    ORDER BY r.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'reason','already_cancelled');
    END IF;

    FOR v_payment IN
      SELECT jsonb_build_object(
        'merchant_note',a.merchant_note,
        'transaction_reference',a.transaction_reference,
        'amount_cents',a.amount_cents
      )
      FROM public.paystack_refund_attempts a
      WHERE a.local_refund_id=v_existing_refund.id
        AND a.merchant_note LIKE
          'mingla_trip_refund:'||v_existing_refund.id||':%'
      ORDER BY a.created_at,a.id
    LOOP
      v_suffix:=split_part(v_payment->>'merchant_note',':',3);
      IF v_suffix='deposit' THEN
        v_paid_cents:=v_order.total_cents;
      ELSE
        SELECT amount_cents INTO v_paid_cents
        FROM public.order_installments
        WHERE id=v_suffix::uuid AND order_id=p_order_id;
      END IF;
      v_paid_total:=v_paid_total+coalesce(v_paid_cents,0);
      v_payment_rows:=v_payment_rows||jsonb_build_object(
        'installment_id',CASE WHEN v_suffix='deposit' THEN NULL ELSE v_suffix END,
        'ordinal',0,
        'source_pi',v_payment->>'transaction_reference',
        'paid_cents',coalesce(v_paid_cents,0),
        'refund_cents',(v_payment->>'amount_cents')::integer,
        'currency',v_existing_refund.currency
      );
    END LOOP;

    RETURN jsonb_build_object(
      'ok',true,
      'refund_id',v_existing_refund.id,
      'per_payment_refund',v_payment_rows,
      'refund_total_cents',v_existing_refund.amount_cents,
      'currency',v_existing_refund.currency,
      'tier_pct',CASE WHEN v_paid_total>0
        THEN round(v_existing_refund.amount_cents*100.0/v_paid_total)::integer
        ELSE 0 END,
      'installments_to_cancel','[]'::jsonb,
      'paystack_retry',true
    );
  END IF;

  v_compute:=public.biz_compute_refund_for_cancel(p_order_id,p_cancel_at);
  IF NOT (v_compute->>'ok')::boolean THEN
    RETURN v_compute;
  END IF;

  INSERT INTO public.refunds(
    order_id,amount_cents,currency,status,reason,
    application_fee_refunded_cents
  ) VALUES(
    p_order_id,(v_compute->>'refund_total_cents')::bigint,
    v_compute->>'currency','pending',
    left(coalesce(p_reason,'tr4_cancel'),200),0
  ) RETURNING id INTO v_refund_id;

  IF v_provider='paystack' THEN
    FOR v_payment IN
      SELECT value FROM jsonb_array_elements(v_compute->'per_payment_refund')
    LOOP
      IF (v_payment->>'refund_cents')::integer>0 THEN
        v_suffix:=coalesce(v_payment->>'installment_id','deposit');
        INSERT INTO public.paystack_refund_attempts(
          source_type,source_id,local_refund_id,transaction_reference,
          merchant_note,amount_cents,currency,status,idempotency_key
        ) VALUES(
          'order',p_order_id,v_refund_id,v_payment->>'source_pi',
          'mingla_trip_refund:'||v_refund_id||':'||v_suffix,
          (v_payment->>'refund_cents')::integer,'ngn','pending',
          'paystack-refund:mingla_trip_refund:'||v_refund_id||':'||v_suffix
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders SET
    cancelled_at=p_cancel_at,cancellation_reason=p_reason,
    cancelled_by=p_actor_user_id,at_risk=false,at_risk_since=NULL
  WHERE id=p_order_id;
  UPDATE public.order_installments SET
    status='cancelled',cancelled_at=p_cancel_at,cancelled_by=p_actor_user_id
  WHERE order_id=p_order_id AND status IN ('scheduled','failed')
    AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'ok',true,'refund_id',v_refund_id,
    'per_payment_refund',v_compute->'per_payment_refund',
    'refund_total_cents',v_compute->'refund_total_cents',
    'currency',v_compute->'currency','tier_pct',v_compute->'tier_pct',
    'installments_to_cancel',v_compute->'installments_to_cancel'
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.biz_cancel_trip_booking_begin(
  uuid,text,uuid,text,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_cancel_trip_booking_begin(
  uuid,text,uuid,text,timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.pg_resume_my_paystack_reservation_refund(
  p_reservation_id uuid
) RETURNS TABLE(reservation public.reservations, refund_eligible boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.reservations;
  v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  SELECT * INTO v_row FROM public.reservations
  WHERE id=p_reservation_id AND consumer_user_id=v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_row.status<>'cancelled_by_guest' OR v_row.payment_status<>'paid'
     OR NOT EXISTS(
       SELECT 1
       FROM public.reservation_checkout_sessions s
       JOIN public.paystack_refund_attempts a
         ON a.source_type='venue_reservation' AND a.source_id=s.id
       WHERE s.reservation_id=v_row.id AND s.status='completed'
         AND a.merchant_note='mingla_venue_refund:'||v_row.id
         AND a.status IN ('pending','accepted','processed')
     ) THEN
    RAISE EXCEPTION 'cancel_not_allowed_from_%',v_row.status
      USING ERRCODE='23514';
  END IF;
  reservation:=v_row;
  refund_eligible:=true;
  RETURN NEXT;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pg_resume_my_paystack_reservation_refund(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.pg_resume_my_paystack_reservation_refund(uuid) TO authenticated;

COMMIT;
