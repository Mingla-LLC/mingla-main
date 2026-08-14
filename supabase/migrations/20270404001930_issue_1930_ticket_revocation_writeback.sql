-- Issue #1930 follow-up — terminal provider-neutralization results must
-- converge the leased outbox row and the exact ticket session/attempt in one
-- event-first transaction. This is additive and performs no provider I/O.

CREATE OR REPLACE FUNCTION public.issue_1930_record_revocation_result(
  p_outbox_id uuid,p_worker_id text,p_state text,p_error_code text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_snapshot public.checkout_sale_revocation_outbox%ROWTYPE;
  v_outbox public.checkout_sale_revocation_outbox%ROWTYPE;
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF p_state NOT IN ('neutralized','provider_unknown','paid_reversal_pending',
      'paid_reversed','failed_retryable','failed_terminal') THEN
    RAISE EXCEPTION 'invalid_revocation_state';
  END IF;

  -- Resolve event ownership without taking a subject lock. Duplicate/stale
  -- worker results are deliberately harmless once the lease is gone.
  SELECT * INTO v_snapshot
  FROM public.checkout_sale_revocation_outbox
  WHERE id=p_outbox_id;
  IF NOT FOUND
     OR v_snapshot.lease_owner IS DISTINCT FROM p_worker_id
     OR v_snapshot.state<>'leased' THEN
    RETURN;
  END IF;

  IF v_snapshot.subject_type='ticket_checkout_session' THEN
    v_event_id := v_snapshot.event_id;

    -- Canonical lock order: event, session, provider attempt, then outbox CAS.
    PERFORM 1 FROM public.events WHERE id=v_event_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'revocation_event_binding_invalid';
    END IF;

    SELECT * INTO v_session
    FROM public.ticket_checkout_sessions
    WHERE id=v_snapshot.subject_id AND event_id=v_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'revocation_subject_binding_invalid';
    END IF;

    IF v_session.provider_attempt_id IS DISTINCT FROM
       v_snapshot.provider_attempt_id THEN
      RAISE EXCEPTION 'revocation_attempt_binding_invalid';
    END IF;

    IF v_snapshot.provider_attempt_id IS NOT NULL THEN
      SELECT * INTO v_attempt
      FROM public.ticket_checkout_provider_attempts
      WHERE id=v_snapshot.provider_attempt_id
        AND checkout_session_id=v_session.id
        AND event_id=v_event_id
        AND brand_id=v_session.brand_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'revocation_attempt_binding_invalid';
      END IF;
    END IF;

    -- Reject impossible state regressions before terminalizing the outbox.
    IF p_state='neutralized' AND
       v_session.reversal_state NOT IN ('neutralization_pending','neutralized') THEN
      RAISE EXCEPTION 'revocation_session_state_conflict';
    ELSIF p_state='paid_reversal_pending' AND
       v_session.reversal_state NOT IN ('neutralization_pending','paid_reversal_pending') THEN
      RAISE EXCEPTION 'revocation_session_state_conflict';
    ELSIF p_state='paid_reversed' AND
       v_session.reversal_state NOT IN ('paid_reversal_pending','paid_reversed') THEN
      RAISE EXCEPTION 'revocation_session_state_conflict';
    ELSIF p_state='failed_terminal' AND
       v_session.reversal_state NOT IN (
         'neutralization_pending','paid_reversal_pending','failed_terminal') THEN
      RAISE EXCEPTION 'revocation_session_state_conflict';
    ELSIF p_state IN ('provider_unknown','failed_retryable') AND
       v_session.reversal_state<>'neutralization_pending' THEN
      RAISE EXCEPTION 'revocation_session_state_conflict';
    END IF;

    IF v_snapshot.provider_attempt_id IS NOT NULL THEN
      IF p_state='neutralized' AND
         v_attempt.state NOT IN ('neutralization_pending','provider_unknown','neutralized') THEN
        RAISE EXCEPTION 'revocation_attempt_state_conflict';
      ELSIF p_state='paid_reversal_pending' AND
         v_attempt.state NOT IN (
           'neutralization_pending','provider_unknown','paid_reversal_pending') THEN
        RAISE EXCEPTION 'revocation_attempt_state_conflict';
      ELSIF p_state='paid_reversed' AND
         v_attempt.state NOT IN ('paid_reversal_pending','paid_reversed') THEN
        RAISE EXCEPTION 'revocation_attempt_state_conflict';
      ELSIF p_state='failed_terminal' AND
         v_attempt.state NOT IN (
           'neutralization_pending','provider_unknown','paid_reversal_pending','terminal_failed') THEN
        RAISE EXCEPTION 'revocation_attempt_state_conflict';
      ELSIF p_state IN ('provider_unknown','failed_retryable') AND
         v_attempt.state NOT IN ('neutralization_pending','provider_unknown') THEN
        RAISE EXCEPTION 'revocation_attempt_state_conflict';
      END IF;
    END IF;

    UPDATE public.checkout_sale_revocation_outbox SET
      state=p_state,
      lease_owner=NULL,
      leased_at=NULL,
      next_retry_at=CASE
        WHEN p_state IN ('provider_unknown','failed_retryable')
          THEN now()+LEAST(
            interval '1 hour',
            interval '30 seconds'*(2^LEAST(attempt_count,7)))
        ELSE NULL
      END,
      last_error_code=CASE
        WHEN p_error_code ~ '^[a-z0-9_]{3,80}$' THEN p_error_code
        ELSE NULL
      END,
      updated_at=now()
    WHERE id=p_outbox_id
      AND lease_owner=p_worker_id
      AND state='leased'
      AND subject_type=v_snapshot.subject_type
      AND subject_id=v_snapshot.subject_id
      AND event_id=v_snapshot.event_id
      AND provider_attempt_id IS NOT DISTINCT FROM v_snapshot.provider_attempt_id
    RETURNING * INTO v_outbox;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    UPDATE public.ticket_checkout_sessions SET
      reversal_state=CASE p_state
        WHEN 'neutralized' THEN 'neutralized'
        WHEN 'paid_reversal_pending' THEN 'paid_reversal_pending'
        WHEN 'paid_reversed' THEN 'paid_reversed'
        WHEN 'failed_terminal' THEN 'failed_terminal'
        ELSE reversal_state
      END,
      reversed_at=CASE
        WHEN p_state='paid_reversed' THEN COALESCE(reversed_at,now())
        ELSE reversed_at
      END,
      updated_at=now()
    WHERE id=v_session.id
      AND event_id=v_event_id
      AND provider_attempt_id IS NOT DISTINCT FROM v_snapshot.provider_attempt_id;

    IF v_snapshot.provider_attempt_id IS NOT NULL THEN
      UPDATE public.ticket_checkout_provider_attempts SET
        state=CASE p_state
          WHEN 'neutralized' THEN 'neutralized'
          WHEN 'paid_reversal_pending' THEN 'paid_reversal_pending'
          WHEN 'paid_reversed' THEN 'paid_reversed'
          WHEN 'failed_terminal' THEN 'terminal_failed'
          WHEN 'provider_unknown' THEN 'provider_unknown'
          WHEN 'failed_retryable' THEN 'provider_unknown'
        END,
        neutralized_at=CASE
          WHEN p_state='neutralized' THEN COALESCE(neutralized_at,now())
          ELSE neutralized_at
        END,
        reversed_at=CASE
          WHEN p_state='paid_reversed' THEN COALESCE(reversed_at,now())
          ELSE reversed_at
        END,
        updated_at=now()
      WHERE id=v_snapshot.provider_attempt_id
        AND checkout_session_id=v_session.id
        AND event_id=v_event_id;
    END IF;

    RETURN;
  END IF;

  -- Preserve the merged RSVP write-back behavior exactly.
  UPDATE public.checkout_sale_revocation_outbox SET
    state=p_state,
    lease_owner=NULL,
    leased_at=NULL,
    next_retry_at=CASE WHEN p_state IN ('provider_unknown','failed_retryable')
      THEN now()+LEAST(
        interval '1 hour',interval '30 seconds'*(2^LEAST(attempt_count,7)))
      ELSE NULL END,
    last_error_code=CASE
      WHEN p_error_code ~ '^[a-z0-9_]{3,80}$' THEN p_error_code ELSE NULL END,
    updated_at=now()
  WHERE id=p_outbox_id AND lease_owner=p_worker_id
  RETURNING * INTO v_outbox;
  IF FOUND AND v_outbox.subject_type='rsvp_contribution' THEN
    UPDATE public.event_rsvp_contributions SET
      provider_attempt_state=CASE p_state
        WHEN 'neutralized' THEN 'neutralized'
        WHEN 'paid_reversal_pending' THEN 'paid_reversal_pending'
        WHEN 'paid_reversed' THEN 'paid_reversed'
        WHEN 'failed_terminal' THEN 'terminal_failed'
        ELSE 'provider_unknown' END,
      updated_at=now()
    WHERE id=v_outbox.subject_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.issue_1930_record_revocation_result(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_record_revocation_result(uuid,text,text,text)
  TO service_role;
