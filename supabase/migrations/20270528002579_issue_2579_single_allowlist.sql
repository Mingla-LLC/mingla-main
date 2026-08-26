BEGIN;
-- ===========================================================================
-- issue #2579 — STOP MAINTAINING A LIST. VALIDATE THE SHAPE.
--
-- Three defects, all found by firing real refusals at the DEPLOYED endpoint and
-- reading the SHIPPED bundle rather than the source tree.
--
-- (1) THE RECORDING NEVER LANDED. Six real refusals fired back-to-back at the
--     deployed endpoint recorded ZERO rows, while the same RPC called directly
--     recorded fine. The edge call was `void`-ed and never awaited, and the
--     runtime tears the request context down when the response returns. Fixed
--     on the edge side with `waitUntil`.
--
-- (2) THE LIVE PATH COULD NEVER REACH THIS FUNCTION'S ALLOWLIST. The edge
--     carried its OWN nineteen-token list and collapsed anything outside it to
--     `unknown_token` BEFORE calling this RPC. So the carefully derived
--     sixty-seven-token allowlist here was unreachable on the only path that
--     matters. The edge now sends the RAW reason.
--
-- (3) AND THE LIST ITSELF WAS NEVER GOING TO BE COMPLETE. Three times on this
--     one issue the allowlist was found short:
--       * built from the 29 SQL tokens          -> missed the edge emitter
--       * patched with the 9 observed tokens    -> missed 29 more by derivation
--       * derived from both emitters (67)       -> missed the SHARED modules,
--         which contribute 113 more, most of which are not checkout at all
--     `checkout_access_decision_unavailable` — raised by a shared module on a
--     REAL refusal arm, caught by the new regression test — would have been
--     stored as `unknown_token` even after all that work.
--
-- SO THE MECHANISM IS WRONG, not the list. Membership-gating requires knowing
-- every emitter in advance, forever, across three files that change
-- independently. That is a treadmill, and this issue has now fallen off it
-- three times in one sitting.
--
-- A refusal reason is a short snake_case identifier. VALIDATE THAT SHAPE and
-- store whatever matches. A new reason from any emitter — today's, or one
-- written next year — records BY NAME with no migration and no list to update.
-- Garbage still cannot land: the pattern admits only lowercase letters, digits
-- and underscores, 3 to 64 characters, so a free-text message, an email address
-- or a phone number cannot be stored by this path.
--
-- The `unknown_token` fallback SURVIVES, because it is the property that made
-- every one of the three gaps above findable. A reason we cannot parse is still
-- KEPT as a row. A telemetry system that discards what it does not understand
-- cannot tell you what you do not already know.
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
AS $fn$
DECLARE
  -- A refusal reason: lowercase, snake_case, at least one underscore so a bare
  -- English word out of a sentence cannot masquerade as a token.
  c_shape  constant text := '^[a-z][a-z0-9]*(_[a-z0-9]+)+$';
  c_embed  constant text := '[a-z][a-z0-9]*(?:_[a-z0-9]+)+';
  v_token   text;
  v_brand_id uuid;
  v_digits  text;
  v_code    text;
BEGIN
  SELECT e.brand_id INTO v_brand_id FROM public.events e WHERE e.id = p_event_id;

  v_digits := regexp_replace(COALESCE(p_buyer_phone_e164, ''), '[^0-9]', '', 'g');
  v_code := CASE
    WHEN v_digits = '' THEN NULL
    WHEN left(v_digits, 3) IN ('234','233','254') THEN '+' || left(v_digits, 3)
    WHEN left(v_digits, 2) IN ('44','27')         THEN '+' || left(v_digits, 2)
    ELSE '+' || left(v_digits, 1)
  END;

  -- An edge refusal sends the bare reason.
  IF p_raise_token ~ c_shape AND length(p_raise_token) BETWEEN 3 AND 64 THEN
    v_token := p_raise_token;
  ELSE
    -- A Postgres error arrives with the reason embedded in a sentence.
    v_token := (regexp_match(COALESCE(p_raise_token, ''), c_embed))[1];
    IF v_token IS NOT NULL AND length(v_token) NOT BETWEEN 3 AND 64 THEN
      v_token := NULL;
    END IF;
  END IF;

  -- Unparseable? KEEP THE ROW. See the header: this is load-bearing.
  v_token := COALESCE(v_token, 'unknown_token');

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
$fn$;

DO $probe$
DECLARE v_t text; v_bad text[] := '{}';
BEGIN
  -- BARE REASONS record by name — from ALL THREE emitters, including the shared
  -- module that no version of the allowlist ever covered.
  FOREACH v_t IN ARRAY ARRAY[
    'event_no_active_dates',                 -- edge, the original report
    'bookings_closed','intake_form_required',-- edge, missed by the 9-token patch
    'tax_country_unsupported','upgrade_required',
    'checkout_sign_in_required',             -- SQL RPC
    'ticket_sales_ended','ticket_capacity_exceeded',
    'checkout_access_decision_unavailable',  -- SHARED module: the third emitter
    'a_reason_invented_next_year'            -- and one that exists nowhere yet
  ] LOOP
    PERFORM public.issue_2579_record_checkout_refusal(
      NULL, NULL, v_t, 1, 'probe-2579-bare', '+2348012345678', 'p@example.invalid');
    IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                    WHERE surface='probe-2579-bare' AND raise_token=v_t) THEN
      v_bad := v_bad || v_t;
    END IF;
  END LOOP;
  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'issue #2579: reasons still swallowed: %', array_to_string(v_bad,', ');
  END IF;

  -- EMBEDDED in a Postgres error message.
  PERFORM public.issue_2579_record_checkout_refusal(
    NULL, NULL, 'ERROR: ticket_sales_not_started (SQLSTATE P0001)', 1, 'probe-2579-embed', NULL, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface='probe-2579-embed' AND raise_token='ticket_sales_not_started') THEN
    RAISE EXCEPTION 'issue #2579: the reason was not extracted from an error message';
  END IF;

  -- GARBAGE AND PII CANNOT LAND. Each of these must fall through to
  -- `unknown_token` rather than being stored verbatim.
  FOREACH v_t IN ARRAY ARRAY[
    'buyer@example.com',
    '+2348012345678',
    'Something went wrong, please try again',
    'DROP TABLE public.orders'
  ] LOOP
    PERFORM public.issue_2579_record_checkout_refusal(
      NULL, NULL, v_t, 1, 'probe-2579-garbage', NULL, NULL);
    IF EXISTS (SELECT 1 FROM public.checkout_refusals
                WHERE surface='probe-2579-garbage' AND raise_token = v_t) THEN
      RAISE EXCEPTION 'issue #2579: unsafe value stored verbatim: %', v_t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface='probe-2579-garbage' AND raise_token='unknown_token') THEN
    RAISE EXCEPTION 'issue #2579: an unparseable reason was dropped instead of kept';
  END IF;

  DELETE FROM public.checkout_refusals WHERE surface LIKE 'probe-2579-%';
END $probe$;

COMMIT;
