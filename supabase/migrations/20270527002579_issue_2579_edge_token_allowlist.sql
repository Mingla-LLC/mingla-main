BEGIN;
-- ===========================================================================
-- issue #2579 — TEACH THE ALLOWLIST THE EDGE FUNCTION'S OWN TOKENS.
--
-- Found by firing a real refusal at the deployed endpoint, not by reading code.
-- A past-event checkout was correctly refused with `event_no_active_dates` and
-- correctly RECORDED — as `unknown_token`.
--
-- The original allowlist was built from the 29 tokens the SQL checkout function
-- can RAISE. But the edge function refuses on its own account too, before the
-- RPC is ever reached, and #2629 started recording those. Nine of them were
-- names the allowlist had never heard.
--
-- The design held: an unrecognised token is STORED as `unknown_token`, never
-- dropped. That decision paid for itself within a minute of going live — the
-- row existed, was queryable, and pointed straight at the gap. Had it dropped
-- the row instead, the log would have looked healthy and quietly under-reported
-- the single most common refusal on the path.
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
    -- Raised by `issue_1930_ticket_checkout_create_session_base`.
    'buyer_phone_required','event_already_ended','event_currency_required',
    'event_not_found','event_not_selling','installment_count_out_of_range',
    'installment_days_after_booking_invalid','installment_deposit_pct_out_of_range',
    'installment_due_mode_invalid','installment_ordinal_invalid',
    'installment_pct_out_of_range','installment_pct_sum_mismatch',
    'installment_rounding_invalid','installment_schedule_malformed',
    'installment_schedule_past_due_at_booking','mixed_currency_cart',
    'occurrence_not_available','occurrence_not_found','payment_plan_choice_invalid',
    'stripe_account_not_ready','ticket_capacity_exceeded','ticket_lines_required',
    'ticket_quantity_above_max','ticket_quantity_below_min','ticket_quantity_invalid',
    'ticket_sales_ended','ticket_sales_not_started','ticket_type_not_found',
    'ticket_type_unavailable',
    -- issue #2629 — refused by the EDGE function before the RPC is reached.
    -- These never appear in any migration, which is why the first pass missed
    -- them entirely.
    'buyer_email_invalid','buyer_name_required','checkout_in_progress','checkout_session_url_missing','event_id_required','event_no_active_dates','free_reservation_already_exists','qr_token_pepper_missing','web_base_url_missing'
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
DECLARE v_def text; v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='issue_2579_record_checkout_refusal';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue #2579 probe: expected exactly one overload, found %', v_count;
  END IF;

  -- The nine edge tokens must now be recognised BY NAME, not swallowed.
  PERFORM public.issue_2579_record_checkout_refusal(
    NULL, NULL, 'event_no_active_dates', 1, 'probe-allowlist', '+2348012345678', 'p@example.invalid');
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface='probe-allowlist' AND raise_token='event_no_active_dates') THEN
    RAISE EXCEPTION 'issue #2579 probe: the edge token is still recorded as unknown';
  END IF;

  -- And a genuinely unknown token must STILL be kept, not dropped. That is the
  -- property that surfaced this gap in the first place.
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
