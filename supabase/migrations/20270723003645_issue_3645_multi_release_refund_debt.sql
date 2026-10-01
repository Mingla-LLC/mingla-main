-- Issue #3645 PR3 — multi-release refund → organiser debt.
-- Under payment+24h an event's cash lands in several brand_payout_releases.
-- Refund→debt creation used to clamp organiser liability at the single origin
-- release's organiser_cash_delivered_cents, silently dropping the remainder.
-- Cap at aggregate delivered cash for the same brand+currency (and event when
-- present), minus permanent debt already recorded on other origins in that
-- scope, under a shared FOR UPDATE lock so two origins cannot reuse the pool.
-- Fee-return unification for legacy record_paystack_refund_outcome is deferred.

BEGIN;

CREATE OR REPLACE FUNCTION public.organiser_released_cash_cap_cents(
  p_brand_id uuid,
  p_currency text,
  p_event_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT least(
    coalesce(sum(r.organiser_cash_delivered_cents), 0),
    2147483647::bigint
  )::integer
  FROM public.brand_payout_releases r
  WHERE r.brand_id = p_brand_id
    AND r.currency = p_currency
    AND r.status = 'released'
    AND (
      p_event_id IS NULL
      OR r.event_id IS NOT DISTINCT FROM p_event_id
    );
$$;

REVOKE ALL ON FUNCTION public.organiser_released_cash_cap_cents(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organiser_released_cash_cap_cents(uuid, text, uuid)
  TO service_role, postgres;

COMMENT ON FUNCTION public.organiser_released_cash_cap_cents(uuid, text, uuid) IS
  'Issue #3645: aggregate organiser cash already delivered for a brand+currency '
  '(optionally scoped to one event). Upper bound for post-release refund debt.';

-- Remaining delivered-cash room after permanent debts on other origin releases
-- in the same brand+currency (+ event) scope. Caller must lock the scope first.
CREATE OR REPLACE FUNCTION public.organiser_refund_debt_room_cents(
  p_brand_id uuid,
  p_currency text,
  p_event_id uuid,
  p_exclude_origin_release_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT greatest(
    public.organiser_released_cash_cap_cents(p_brand_id, p_currency, p_event_id)
      - least(
          coalesce((
            SELECT sum(d.principal_cents)::bigint
            FROM public.organiser_payout_debts d
            JOIN public.brand_payout_releases r ON r.id = d.origin_release_id
            WHERE d.brand_id = p_brand_id
              AND d.currency = p_currency
              AND d.kind IN (
                'post_release_refund',
                'post_release_dispute',
                'post_release_cancellation'
              )
              AND (
                p_exclude_origin_release_id IS NULL
                OR d.origin_release_id IS DISTINCT FROM p_exclude_origin_release_id
              )
              AND (
                p_event_id IS NULL
                OR r.event_id IS NOT DISTINCT FROM p_event_id
              )
          ), 0),
          2147483647::bigint
        )::integer,
    0
  );
$$;

REVOKE ALL ON FUNCTION public.organiser_refund_debt_room_cents(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organiser_refund_debt_room_cents(uuid, text, uuid, uuid)
  TO service_role, postgres;

COMMENT ON FUNCTION public.organiser_refund_debt_room_cents(uuid, text, uuid, uuid) IS
  'Issue #3645: delivered-cash room left for a new/grown permanent refund debt '
  'after other origins in the same scope have already claimed principal.';

CREATE OR REPLACE FUNCTION public.issue_1221_post_organizer_refund_liability(
  p_refund_id uuid,p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_release public.brand_payout_releases%ROWTYPE;
DECLARE v_allocation public.source_refund_ledger_allocations%ROWTYPE;
DECLARE v_adjustment_id uuid; v_debt public.organiser_payout_debts%ROWTYPE;
DECLARE v_debt_id uuid; v_liability integer; v_target integer; v_room integer;
BEGIN
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT * INTO v_allocation FROM public.source_refund_ledger_allocations
  WHERE refund_id=v.id AND allocation_type='organizer_refund_liability'
  FOR UPDATE;
  IF NOT FOUND OR v_allocation.state='posted' THEN
    RETURN v_allocation.payout_ledger_adjustment_id;
  END IF;
  SELECT r.* INTO v_release
  FROM public.payout_release_items i
  JOIN public.brand_payout_releases r ON r.id=i.release_id
  WHERE i.source_type=v.source_type AND i.source_id=v.source_id
  LIMIT 1 FOR UPDATE OF r;
  IF NOT FOUND OR v_release.status<>'released' THEN
    UPDATE public.source_refund_ledger_allocations SET
      state='posted',posted_at=COALESCE(posted_at,p_now)
    WHERE id=v_allocation.id;
    RETURN NULL;
  END IF;
  -- Serialize against every released row that shares the delivered-cash pool.
  PERFORM 1
  FROM public.brand_payout_releases r
  WHERE r.brand_id = v_release.brand_id
    AND r.currency = v_release.currency
    AND r.status = 'released'
    AND (
      v_release.event_id IS NULL
      OR r.event_id IS NOT DISTINCT FROM v_release.event_id
    )
  ORDER BY r.id
  FOR UPDATE;
  v_room:=public.organiser_refund_debt_room_cents(
    v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
  );
  v_liability:=least(v.organizer_refund_liability_cents, v_room);
  IF v_liability<=0 THEN
    UPDATE public.source_refund_ledger_allocations SET
      state='posted',posted_at=COALESCE(posted_at,p_now),payout_release_id=v_release.id
    WHERE id=v_allocation.id;
    RETURN NULL;
  END IF;
  INSERT INTO public.payout_ledger_adjustments(
    release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key,created_at
  ) VALUES(
    v_release.id,v_release.brand_id,v_release.currency,'post_release_refund',
    v_liability,v.provider_refund_id,'source-refund-liability:'||v.id,p_now
  ) ON CONFLICT(idempotency_key) DO NOTHING
  RETURNING id INTO v_adjustment_id;
  IF v_adjustment_id IS NULL THEN
    SELECT id INTO v_adjustment_id FROM public.payout_ledger_adjustments
    WHERE idempotency_key='source-refund-liability:'||v.id;
  END IF;
  SELECT least(
    least(coalesce(sum(amount_cents),0), 2147483647::bigint)::integer,
    v_room
  ) INTO v_target
  FROM public.payout_ledger_adjustments
  WHERE release_id=v_release.id AND kind='post_release_refund';
  SELECT * INTO v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release.id AND kind='post_release_refund'
  FOR UPDATE;
  IF NOT FOUND THEN
    v_debt_id:=public.convert_postponement_debt_to_permanent(
      v_release.id,'post_release_refund',v_target,p_now
    );
  ELSE
    v_debt_id:=v_debt.id;
    IF v_target>v_debt.principal_cents THEN
      UPDATE public.organiser_payout_debts SET
        principal_cents=v_target,
        status=CASE WHEN recovered_cents=v_target THEN 'closed' ELSE 'open' END,
        closed_at=CASE WHEN recovered_cents=v_target THEN p_now ELSE NULL END,
        updated_at=p_now
      WHERE id=v_debt.id;
    END IF;
  END IF;
  UPDATE public.source_refund_ledger_allocations SET
    state='posted',posted_at=COALESCE(posted_at,p_now),
    provider_effect_reference=COALESCE(provider_effect_reference,v.provider_refund_id),
    payout_release_id=v_release.id,payout_ledger_adjustment_id=v_adjustment_id
  WHERE id=v_allocation.id;
  INSERT INTO public.source_refund_events(
    refund_id,event_key,event_type,to_state,actor_type,safe_reason_code
  ) VALUES(
    v.id,'payout-adjusted:'||v.id,'payout_adjusted','processed','system',
    'post_release_organizer_liability'
  ) ON CONFLICT(event_key) DO NOTHING;
  RETURN v_adjustment_id;
END $$;

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
  v_room integer;
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
  PERFORM 1
  FROM public.brand_payout_releases r
  WHERE r.brand_id = v_release.brand_id
    AND r.currency = v_release.currency
    AND r.status = 'released'
    AND (
      v_release.event_id IS NULL
      OR r.event_id IS NOT DISTINCT FROM v_release.event_id
    )
  ORDER BY r.id
  FOR UPDATE;
  v_room:=public.organiser_refund_debt_room_cents(
    v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
  );
  v_liability:=least(p_amount_cents, v_room);
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
    least(coalesce(sum(amount_cents),0), 2147483647::bigint)::integer,
    v_room
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

COMMIT;
