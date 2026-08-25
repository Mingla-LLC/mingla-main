BEGIN;
-- ===========================================================================
-- issue #2579 — A REFUSED CHECKOUT LEAVES NO TRACE.
--
-- `issue_1930_ticket_checkout_create_session_base` refuses by RAISE EXCEPTION.
-- A RAISE rolls the transaction back, so no `ticket_checkout_sessions` row
-- survives a refusal — the only session rows that exist are attempts that got
-- PAST the guards. Nothing else records the reason either: a search of every
-- retained edge-function log row (38,179 of them) found ZERO occurrences of
-- `ticket_quantity_above_max`, `ticket_capacity_exceeded`,
-- `buyer_phone_required` or `checkout_session_failed`.
--
-- That is why the We Go Again report — "sometimes it says tickets have
-- finished when they have not" — cost a multi-day forensic pass across five
-- layers instead of one query. The bug was a per-buyer cap the client never
-- read; a refusal count grouped by reason would have shown it immediately.
--
-- This is ALSO why good error copy is not enough on its own. #2511 and #2562
-- mean a refused guest now gets a specific, honest sentence. A guest who
-- understands why they were turned away does not complain — so a misconfigured
-- tier becomes SILENT rather than rare. Copy helps the buyer; only a record
-- helps the organiser.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.checkout_refusals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable throughout: a refusal can happen BEFORE the event resolves
  -- (`event_not_found`) or before any line is read (`ticket_lines_required`).
  -- A telemetry table that demands complete context cannot record the failures
  -- with the least context, which are exactly the ones worth seeing.
  event_id            uuid REFERENCES public.events(id) ON DELETE CASCADE,
  -- Denormalised on purpose. The organiser-read policy uses the canonical
  -- `biz_is_brand_member_for_read(brand_id, auth.uid())` helper that every
  -- other brand-scoped table uses, and a refusal must stay readable after its
  -- event row is gone. `brands` has NO owner column — team membership is the
  -- ownership model here, and reaching for `owner_id` would not compile.
  brand_id            uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  ticket_type_id      uuid REFERENCES public.ticket_types(id) ON DELETE SET NULL,
  raise_token         text NOT NULL,
  quantity_requested  integer,
  -- 'buyer_web' | 'ios' | 'android' | 'unknown'. Free text rather than an enum
  -- so a new surface records honestly instead of failing the insert.
  surface             text,
  -- DIAL CODE ONLY (e.g. '+234'). Enough to answer "is this only Nigeria?",
  -- which was the actual question asked, without storing a phone number.
  buyer_country_code  text,
  -- Salted hash, so repeat attempts by one person are countable without
  -- holding the address. The salt lives in the RPC, never in a client.
  buyer_email_hash    text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_refusals_country_code_shape
    CHECK (buyer_country_code IS NULL OR buyer_country_code ~ '^\+[1-9][0-9]{0,3}$'),
  CONSTRAINT checkout_refusals_quantity_sane
    CHECK (quantity_requested IS NULL OR (quantity_requested >= 0 AND quantity_requested <= 100000))
);

COMMENT ON TABLE public.checkout_refusals IS
  'issue #2579 — append-only record of every refused checkout attempt. Written from the edge function error path; never from the RPC, whose transaction is rolling back.';

CREATE INDEX IF NOT EXISTS idx_checkout_refusals_event_time
  ON public.checkout_refusals (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_refusals_brand_time
  ON public.checkout_refusals (brand_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_refusals_token_time
  ON public.checkout_refusals (raise_token, occurred_at DESC);

ALTER TABLE public.checkout_refusals ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policy exists on purpose. Writes arrive only through
-- the SECURITY DEFINER function below, so the bounded-token check cannot be
-- bypassed by anything holding a table grant.
DROP POLICY IF EXISTS "Organisers read refusals for their own events" ON public.checkout_refusals;
CREATE POLICY "Organisers read refusals for their own events"
  ON public.checkout_refusals FOR SELECT
  TO authenticated
  USING (
    brand_id IS NOT NULL
    AND public.biz_is_brand_member_for_read(brand_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- THE ONLY WRITE PATH.
--
-- Bounded token set, matching the RAISE tokens the checkout function can
-- actually produce. An unknown token is recorded as 'unknown_token' rather
-- than rejected: a refusal we cannot name is the single most interesting row
-- in the table, and dropping it would recreate the blindness this fixes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2579_record_checkout_refusal(
  p_event_id           uuid,
  p_ticket_type_id     uuid,
  p_raise_token        text,
  p_quantity_requested integer DEFAULT NULL,
  p_surface            text    DEFAULT NULL,
  -- FULL E.164 in, DIAL CODE ONLY stored. Extraction lives here, not in the
  -- edge function, for one reason: this file's probe runs in the ten
  -- unfiltered full-chain replay lanes, and a new edge-side test file would
  -- run in no lane at all. Logic belongs where CI can reach it.
  p_buyer_phone_e164   text    DEFAULT NULL,
  p_buyer_email        text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_known text[] := ARRAY[
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
    'ticket_type_unavailable'
  ];
  v_token text;
  v_brand_id uuid;
  v_digits text;
  v_code text;
BEGIN
  -- Derived, never passed. The caller refuses before it has resolved a brand,
  -- and a caller-supplied brand could drift from the event's real owner — which
  -- would silently show one organiser another organiser's refusals.
  SELECT e.brand_id INTO v_brand_id FROM public.events e WHERE e.id = p_event_id;

  -- Dial code only. Longest-match over the codes this product actually serves,
  -- falling back to the first digit — which is still a real code — so an
  -- unfamiliar country is recorded rather than dropped.
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
      -- Salted with the event id so the same address on two events does not
      -- produce the same hash. No plaintext, and no cross-event correlation.
      ELSE encode(extensions.digest(lower(btrim(p_buyer_email)) || ':' || COALESCE(p_event_id::text, ''), 'sha256'), 'hex')
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_2579_record_checkout_refusal(
  uuid,uuid,text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2579_record_checkout_refusal(
  uuid,uuid,text,integer,text,text,text) TO service_role;

-- ---------------------------------------------------------------------------
-- POST-MIGRATION PROBE — RAISES rather than warns, so a degraded apply cannot
-- report success (the #2113 lesson). Pinned to the EXACT signature and
-- asserting exactly one overload, because an unfiltered `proname` lookup reads
-- whichever row the scan hands it first — the defect filed as #2573.
-- ---------------------------------------------------------------------------
DO $probe$
DECLARE
  v_count int;
  v_rows  int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'issue_2579_record_checkout_refusal';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue #2579 probe: expected exactly one overload, found %', v_count;
  END IF;

  IF to_regclass('public.checkout_refusals') IS NULL THEN
    RAISE EXCEPTION 'issue #2579 probe: checkout_refusals table absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'checkout_refusals' AND rowsecurity
  ) THEN
    RAISE EXCEPTION 'issue #2579 probe: RLS is not enabled on checkout_refusals';
  END IF;

  -- Prove the write path works AND that an unknown token is kept, not dropped.
  PERFORM public.issue_2579_record_checkout_refusal(
    NULL, NULL, 'definitely_not_a_real_token', 3, 'probe', '+2348012345678', 'probe@example.invalid');
  SELECT count(*) INTO v_rows
    FROM public.checkout_refusals WHERE raise_token = 'unknown_token' AND surface = 'probe';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue #2579 probe: unknown token was not recorded (rows=%)', v_rows;
  END IF;

  -- And that a real token is stored verbatim, with the email hashed.
  PERFORM public.issue_2579_record_checkout_refusal(
    NULL, NULL, 'ticket_quantity_above_max', 9, 'probe', '+2348012345678', 'probe@example.invalid');
  IF NOT EXISTS (
    SELECT 1 FROM public.checkout_refusals
     WHERE raise_token = 'ticket_quantity_above_max' AND surface = 'probe'
       AND buyer_email_hash IS NOT NULL AND buyer_email_hash <> 'probe@example.invalid'
       -- The number must NOT survive; only the code.
       AND buyer_country_code = '+234'
  ) THEN
    RAISE EXCEPTION 'issue #2579 probe: known token, email hashing or dial-code extraction did not behave';
  END IF;

  IF EXISTS (SELECT 1 FROM public.checkout_refusals
              WHERE surface = 'probe' AND buyer_country_code LIKE '%8012345678%') THEN
    RAISE EXCEPTION 'issue #2579 probe: a full phone number was stored';
  END IF;

  DELETE FROM public.checkout_refusals WHERE surface = 'probe';
END
$probe$;

COMMIT;
