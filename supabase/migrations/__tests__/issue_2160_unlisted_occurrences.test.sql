-- issue #2160 / #2161 — the occurrences must travel with the EVENT.
--
-- ── WHY THIS FILE EXERCISES THE REAL READER ────────────────────────────────
-- #2135's suite stood in the occurrence data HOOK, so it never touched the real
-- read path and could not see an RLS refusal. That is precisely how #2161
-- escaped it. A stubbed transport CANNOT satisfy this file: every check below
-- calls `public.pg_direct_event_checkout_bundle` itself, against the full
-- applied migration chain, and asserts on the JSON it actually returns.
--
-- ── WHAT IS PROVED ─────────────────────────────────────────────────────────
--   U-1  an UNLISTED (visibility='hidden') event returns its occurrences
--   U-2  a PUBLIC event returns them identically (the control)
--   U-3  the visibility predicate still ADMITS unlisted and REFUSES private,
--        deleted and unknown — the behaviour #2161 depends on, asserted on
--        RESULTS so it holds however the predicate is spelled
--   U-4  the MULTI-DATE SIGNAL rides the bundle — without it the day chooser is
--        unreachable no matter how many occurrences are returned
--   U-5  the pricing mode rides the bundle and defaults to 'per_day'
--   U-6  `ticketsRemaining` is NOT fabricated per day (Constitution #9)

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.u2160_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2160 unlisted-occurrences FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.u2160_event(
  p_tag text, p_visibility text, p_days int DEFAULT 2,
  p_multi_date boolean DEFAULT true, p_mode text DEFAULT 'per_day',
  OUT o_event uuid
) LANGUAGE plpgsql AS $$
DECLARE v_user uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid(); v_i int;
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, v_user, 'u2160 ' || p_tag, 'u2160-' || p_tag || '-' || v_brand);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, multi_date_pricing_mode)
    VALUES (o_event, v_brand, 'u2160 ' || p_tag, 'u2160-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', p_multi_date, p_mode);
  FOR v_i IN 1..p_days LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (o_event, now() + ((v_i) || ' days')::interval,
              now() + ((v_i) || ' days')::interval + interval '6 hours', 'UTC', v_i = 1);
  END LOOP;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order)
    VALUES (o_event, 'Entry', 0, true, 50, 1, true, true, 0);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status='scheduled', visibility=p_visibility, published_at=now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

DO $$
DECLARE
  v_hidden uuid; v_public uuid; v_private uuid; v_deleted uuid; v_recurring uuid;
  v_alldays uuid;
  v_b json;
BEGIN
  v_hidden := pg_temp.u2160_event('hidden', 'hidden');
  v_public := pg_temp.u2160_event('public', 'public');

  -- ── U-1 — THE WHOLE POINT OF #2161. ──────────────────────────────────────
  v_b := public.pg_direct_event_checkout_bundle(v_hidden, NULL, NULL);
  PERFORM pg_temp.u2160_assert(v_b IS NOT NULL,
    'U-1a an UNLISTED event is served by the bundle at all');
  PERFORM pg_temp.u2160_assert((v_b::jsonb) ? 'occurrences',
    'U-1b the bundle carries an occurrences key');
  PERFORM pg_temp.u2160_assert(
    jsonb_array_length((v_b::jsonb) -> 'occurrences') = 2,
    'U-1c an UNLISTED 2-date event returns BOTH occurrences (got '
    || jsonb_array_length((v_b::jsonb) -> 'occurrences') || ') — this is #2161');

  -- Chronological, and every field the chooser renders is present.
  PERFORM pg_temp.u2160_assert(
    ((v_b::jsonb) #>> '{occurrences,0,startAt}')
      < ((v_b::jsonb) #>> '{occurrences,1,startAt}'),
    'U-1d occurrences are chronological');
  PERFORM pg_temp.u2160_assert(
    ((v_b::jsonb) #>> '{occurrences,0,id}') IS NOT NULL
    AND ((v_b::jsonb) #>> '{occurrences,0,endAt}') IS NOT NULL
    AND ((v_b::jsonb) #>> '{occurrences,0,timezone}') IS NOT NULL
    AND ((v_b::jsonb) #> '{occurrences,0,isMaster}') IS NOT NULL,
    'U-1e each occurrence carries id / startAt / endAt / timezone / isMaster');

  -- ── U-2 — the PUBLIC control behaves identically. ────────────────────────
  v_b := public.pg_direct_event_checkout_bundle(v_public, NULL, NULL);
  PERFORM pg_temp.u2160_assert(
    jsonb_array_length((v_b::jsonb) -> 'occurrences') = 2,
    'U-2 a PUBLIC 2-date event returns both occurrences (the control)');

  -- ── U-3 — VISIBILITY BEHAVIOUR, asserted on RESULTS not on spelling. ─────
  -- The SPEC asserted this function already routed through
  -- pg_offering_visibility_gate; it did not, and it still does not — see
  -- DELTA 2 of the migration for the two mutually exclusive CI constraints
  -- that make the gate unavailable to anything landing after #2117. These
  -- checks pin the BEHAVIOUR, so they hold under either spelling and would
  -- catch a real widening or narrowing either way.
  v_private := pg_temp.u2160_event('private', 'private');
  PERFORM pg_temp.u2160_assert(
    public.pg_direct_event_checkout_bundle(v_private, NULL, NULL) IS NULL,
    'U-3a a PRIVATE event is still refused (NULL)');

  v_deleted := pg_temp.u2160_event('deleted', 'public');
  UPDATE public.events SET deleted_at = now() WHERE id = v_deleted;
  PERFORM pg_temp.u2160_assert(
    public.pg_direct_event_checkout_bundle(v_deleted, NULL, NULL) IS NULL,
    'U-3b a soft-DELETED event is still refused (NULL)');

  PERFORM pg_temp.u2160_assert(
    public.pg_direct_event_checkout_bundle(gen_random_uuid(), NULL, NULL) IS NULL,
    'U-3c an unknown id is still refused (NULL, non-enumerable)');

  -- ── U-4 — THE MULTI-DATE SIGNAL. ─────────────────────────────────────────
  -- Occurrences alone are not enough: `detailFromDirectBundle` hard-coded
  -- `is_multi_date: false`, so `asWhenMode` resolved every bundle-served event
  -- to "single" and the chooser never mounted — on PUBLIC events too, not only
  -- unlisted ones. Without these keys #2160 is invisible on the live page.
  v_b := public.pg_direct_event_checkout_bundle(v_hidden, NULL, NULL);
  PERFORM pg_temp.u2160_assert(((v_b::jsonb) ->> 'isMultiDate') = 'true',
    'U-4a the bundle reports isMultiDate — without it the chooser is unreachable');
  PERFORM pg_temp.u2160_assert(((v_b::jsonb) ->> 'isRecurring') = 'false',
    'U-4b the bundle reports isRecurring separately, so recurring stays out of scope');

  v_recurring := pg_temp.u2160_event('recurring', 'public', 2, false);
  UPDATE public.events SET is_recurring = true WHERE id = v_recurring;
  v_b := public.pg_direct_event_checkout_bundle(v_recurring, NULL, NULL);
  PERFORM pg_temp.u2160_assert(
    ((v_b::jsonb) ->> 'isMultiDate') = 'false'
    AND ((v_b::jsonb) ->> 'isRecurring') = 'true',
    'U-4c a RECURRING event is not reported as multi-date (#2145 stays out)');

  -- ── U-5 — the pricing mode rides the bundle, defaulting to per_day. ───────
  v_b := public.pg_direct_event_checkout_bundle(v_public, NULL, NULL);
  PERFORM pg_temp.u2160_assert(
    ((v_b::jsonb) ->> 'multiDatePricingMode') = 'per_day',
    'U-5a the pricing mode rides the bundle and defaults to per_day');

  v_alldays := pg_temp.u2160_event('alldays', 'hidden', 2, true, 'all_days');
  v_b := public.pg_direct_event_checkout_bundle(v_alldays, NULL, NULL);
  PERFORM pg_temp.u2160_assert(
    ((v_b::jsonb) ->> 'multiDatePricingMode') = 'all_days',
    'U-5b an all_days event reports all_days');

  -- ── U-6 — NO FABRICATED PER-DAY AVAILABILITY (Constitution #9). ──────────
  PERFORM pg_temp.u2160_assert(
    NOT (((v_b::jsonb) #> '{occurrences,0}') ? 'ticketsRemaining'),
    'U-6 no per-occurrence ticketsRemaining is invented — there is none to report');
END $$;

DO $$ BEGIN
  RAISE NOTICE 'issue #2160 unlisted-occurrences suite: ALL CHECKS PASSED';
END $$;
