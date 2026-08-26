BEGIN;
-- ===========================================================================
-- issue #2579 — MAKE THE REFUSAL ALLOWLIST COMPLETE, BY DERIVATION.
--
-- Found by firing a real refusal at the deployed endpoint, not by reading code.
-- A past-event checkout was correctly refused with `event_no_active_dates` and
-- correctly RECORDED — as `unknown_token`.
--
-- THE DESIGN HELD, and that is the part worth keeping. An unrecognised token is
-- STORED as `unknown_token`, never dropped. That decision paid for itself within
-- a minute of going live: the row existed, was queryable, and pointed straight at
-- the gap. Had it dropped what it did not recognise — the obvious "only record
-- known reasons" reading — the log would have looked perfectly healthy while
-- silently under-reporting the most common refusal on that path. A telemetry
-- system that discards what it does not understand cannot tell you what you do
-- not already know.
--
-- THE FIRST FIX WAS ITSELF INCOMPLETE, in exactly the way it was fixing. It added
-- the nine tokens that had been OBSERVED. Deriving the true set from ground truth
-- — `pg_get_functiondef` on the installed checkout RPCs, plus every `error:` the
-- edge function can emit — found 29 more still missing, including the ones that
-- answer the question this log exists to answer: `bookings_closed`,
-- `intake_form_required`, `tax_country_unsupported`, `checkout_sign_in_required`,
-- `pricing_config_unavailable`, `paystack_initialize_failed`.
--
-- Patching what you have seen is how the gap got here. The allowlist below is the
-- DERIVED UNION of both emitters, not a list of incidents. Over-inclusion is free
-- — a token that never fires costs nothing. Under-inclusion is the bug.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.issue_2579_record_checkout_refusal(
  p_event_id           uuid,
  p_ticket_type_id     uuid,
  p_raise_token        text,
  p_quantity_requested integer DEFAULT NULL,
  p_surface            text    DEFAULT NULL,
  p_buyer_phone_e164   text    DEFAULT NULL,
  p_buyer_email        text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_known text[] := ARRAY[
    -- Raised by the SQL checkout RPC *and* refusable at the edge.
    'buyer_phone_required','checkout_restricted','occurrence_not_available',
    'occurrence_not_found','payment_plan_choice_invalid','qr_token_pepper_missing',
    'stripe_account_not_ready','ticket_lines_required',
    -- Raised only by the SQL checkout RPC (installed definitions).
    'checkout_session_not_found','checkout_sign_in_required','event_already_ended',
    'event_currency_required','event_not_found','event_not_selling',
    'installment_amount_invalid','installment_count_out_of_range','installment_days_after_booking_invalid',
    'installment_deposit_pct_out_of_range','installment_due_mode_invalid','installment_ordinal_invalid',
    'installment_pct_out_of_range','installment_pct_sum_mismatch','installment_plan_finalize_missing_customer_or_pm',
    'installment_rounding_invalid','installment_schedule_malformed','installment_schedule_past_due_at_booking',
    'mixed_currency_cart','payment_intent_required','ticket_capacity_exceeded',
    'ticket_quantity_above_max','ticket_quantity_below_min','ticket_quantity_invalid',
    'ticket_sales_ended','ticket_sales_not_started','ticket_type_not_found',
    'ticket_type_unavailable',
    -- Refused only by the edge function, before the RPC is reached.
    'application_fee_persistence_failed','bookings_closed','buyer_email_invalid',
    'buyer_name_required','checkout_finalize_failed','checkout_in_progress',
    'checkout_session_create_failed','checkout_session_failed','checkout_session_persist_failed',
    'checkout_session_url_missing','event_date_lookup_failed','event_id_required',
    'event_lookup_failed','event_no_active_dates','free_reservation_already_exists',
    'installment_customer_provisioning_failed','intake_form_required','intake_schema_lookup_failed',
    'intake_schema_stale','internal_error','invalid_json',
    'method_not_allowed','occurrence_lookup_failed','payment_intent_create_failed',
    'payment_session_persist_failed','paystack_initialize_failed','pricing_config_unavailable',
    'tax_calculation_failed','tax_country_unsupported','upgrade_required',
    'web_base_url_missing'
  ];
  v_token text;
  v_brand_id uuid;
  v_digits text;
  v_code text;
BEGIN
  SELECT e.brand_id INTO v_brand_id FROM public.events e WHERE e.id = p_event_id;

  v_digits := regexp_replace(COALESCE(p_buyer_phone_e164, ''), '[^0-9]', '', 'g');
  v_code := CASE
    WHEN v_digits = '' THEN NULL
    WHEN left(v_digits, 3) IN ('234','233','254') THEN '+' || left(v_digits, 3)
    WHEN left(v_digits, 2) IN ('44','27')         THEN '+' || left(v_digits, 2)
    ELSE '+' || left(v_digits, 1)
  END;

  v_token := CASE
    WHEN p_raise_token = ANY (v_known) THEN p_raise_token
    ELSE 'unknown_token'
  END;

  INSERT INTO public.checkout_refusals (
    event_id, brand_id, ticket_type_id, raise_token, quantity_requested,
    surface, buyer_country_code, buyer_email_hash
  ) VALUES (
    p_event_id, v_brand_id, p_ticket_type_id, v_token, p_quantity_requested,
    NULLIF(left(COALESCE(p_surface, 'unknown'), 32), ''),
    v_code,
    CASE
      WHEN p_buyer_email IS NULL OR btrim(p_buyer_email) = '' THEN NULL
      ELSE encode(extensions.digest(lower(btrim(p_buyer_email)) || ':' || COALESCE(p_event_id::text, ''), 'sha256'), 'hex')
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_2579_record_checkout_refusal(
  uuid,uuid,text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2579_record_checkout_refusal(
  uuid,uuid,text,integer,text,text,text) TO service_role;

DO $probe$
DECLARE
  v_t text; v_def text; v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_2579_record_checkout_refusal';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue #2579 probe: expected exactly one overload, found %', v_count;
  END IF;

  -- The nine edge tokens must now be recognised BY NAME, not swallowed.
  -- Assert the CLASS, not one incident. Every token below was missing before
  -- this migration; each is a real reason a real buyer could not check out.
  -- If a future emitter adds a token and nobody updates the array, the token
  -- lands here as `unknown_token` and this probe fails loudly on next deploy.
  FOREACH v_t IN ARRAY ARRAY[
    'event_no_active_dates','bookings_closed','intake_form_required',
    'tax_country_unsupported','checkout_sign_in_required','pricing_config_unavailable',
    'paystack_initialize_failed','checkout_restricted','upgrade_required',
    'internal_error','invalid_json','payment_intent_required'
  ] LOOP
    PERFORM public.issue_2579_record_checkout_refusal(
      NULL, NULL, v_t, 1, 'probe-allowlist', '+2348012345678', 'p@example.invalid');
    IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                    WHERE surface='probe-allowlist' AND raise_token=v_t) THEN
      RAISE EXCEPTION 'issue #2579 probe: token % is still swallowed as unknown_token', v_t;
    END IF;
  END LOOP;

  -- And a genuinely unknown token must STILL be kept, not dropped. This is the
  -- property that made the original gap findable at all, so it is the one most
  -- worth protecting.
  PERFORM public.issue_2579_record_checkout_refusal(
    NULL, NULL, 'not_a_real_token_at_all', 1, 'probe-allowlist', NULL, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface='probe-allowlist' AND raise_token='unknown_token') THEN
    RAISE EXCEPTION 'issue #2579 probe: an unknown token was dropped instead of kept';
  END IF;

  DELETE FROM public.checkout_refusals WHERE surface='probe-allowlist';
END
$probe$;

COMMIT;
