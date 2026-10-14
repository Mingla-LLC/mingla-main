-- Issue #3645 — the three offering functions ask the shared currency source
-- (migration 20270830003645). Implementor adversarial, behavioural.
--
-- Proves:
--   A. a paid experience never declares a free-only publish (checked first,
--      before anything else in this transaction could have set the flag).
--   B. a currency the list does not hold is refused with
--      event_currency_unsupported by all three functions, on a draft save and
--      on a publish, and never reaches a raw constraint error. That includes
--      the five codes the old experience bodies admitted and the events table
--      then rejected.
--   C. the answer follows the TABLE: a currency switched off there is refused
--      at once, and a lower-case listed code is accepted.
--   D. an unaccepted member's paid publish raises mingla_tos_not_accepted on
--      all three functions, before the can-collect check, leaves nothing
--      published, and is judged per member (another member's acceptance does
--      not count; a version with no timestamp does not count).
--   E. a paid experience priced per stop requires terms; an experience marked
--      free that still stores a priced stop is NOT declared free-only.
--   F. a paid experience on a brand that can collect but has no currency is
--      refused with event_currency_required.
--
-- Fails on the bodies this migration replaces: B (raw 23503 from the events
-- foreign key, or a published AUD row), D on biz_create_experience (ungated),
-- and C (NGN refused).
--
-- Every fixture is transaction-local and rolled back.
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.x3645_exp(
  p_title text, p_price_cents integer, p_currency text DEFAULT NULL,
  p_pricing_mode text DEFAULT 'whole', p_is_free boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title', p_title,
    'description', 'A walk through two good places.',
    'currency', p_currency,
    'is_free', COALESCE(p_is_free, p_price_cents = 0),
    'pricing_mode', p_pricing_mode,
    'location_mode', CASE WHEN p_pricing_mode = 'per_stop' THEN 'per_stop' ELSE 'single' END,
    'whole_price_cents', CASE WHEN p_pricing_mode = 'whole' THEN p_price_cents END,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'UTC',
    'whenMode', 'single',
    'when', jsonb_build_object(
      'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '20:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_name', 'First', 'ai_description', 'The first stop',
        'address', '1 First St', 'place_id', 'x3645-place-1', 'lat', 6.5, 'lng', 3.4, 'stop_order', 0,
        'price_cents', CASE WHEN p_pricing_mode = 'per_stop' THEN p_price_cents ELSE 0 END),
      jsonb_build_object('place_name', 'Second', 'ai_description', 'The second stop',
        'address', '2 Second St', 'place_id', 'x3645-place-2', 'lat', 6.6, 'lng', 3.5, 'stop_order', 1,
        'price_cents', 0))
  ));
$f$;

CREATE FUNCTION pg_temp.x3645_event(p_price numeric, p_currency text DEFAULT NULL, p_available_at text DEFAULT 'online')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title', 'x3645 event',
    'timezone', 'UTC',
    'currency', p_currency,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Standard', 'isFree', p_price = 0, 'price', p_price,
        'capacity', 10, 'availableAt', p_available_at)),
      'city', 'Lagos',
      'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')))));
$f$;

CREATE FUNCTION pg_temp.x3645_act_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$f$;

-- Run p_sql and require it to be refused with exactly p_message. Anything
-- else, a success included, fails the suite and prints what happened.
CREATE FUNCTION pg_temp.x3645_refused(p_label text, p_sql text, p_message text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_message text;
  v_state   text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;
  IF v_message IS NULL THEN
    RAISE EXCEPTION '% FAIL: it succeeded; expected %', p_label, p_message;
  END IF;
  IF v_message <> p_message THEN
    RAISE EXCEPTION '% FAIL: refused with "%" [%]; expected %', p_label, v_message, v_state, p_message;
  END IF;
END
$f$;

DO $test$
DECLARE
  v_owner    uuid := gen_random_uuid();
  v_member   uuid := gen_random_uuid();
  v_suffix   text := replace(gen_random_uuid()::text, '-', '');
  v_brand    uuid := gen_random_uuid();   -- naira, can collect
  v_nobank   uuid := gen_random_uuid();   -- pounds, cannot collect
  v_nocur    uuid := gen_random_uuid();   -- no currency, cannot collect
  v_holdnc   uuid := gen_random_uuid();   -- can collect, no currency
  v_draft    uuid;
  v_event    uuid := gen_random_uuid();
  v_res      jsonb;
  v_code     text;
  v_before   integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner), (v_member);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner), (v_member);
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_owner, 'x3645 adv', 'x3645-adv-' || v_suffix,
    'NGN', 'paystack', 'NG', 'ACCT_x3645_adv'
  );
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
  VALUES (v_nobank, v_owner, 'x3645 adv no bank', 'x3645-adv-nobank-' || v_suffix, 'GBP');
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_nocur, v_owner, 'x3645 adv no currency', 'x3645-adv-nocur-' || v_suffix);
  INSERT INTO public.brands (
    id, account_id, name, slug, payment_provider, payment_country, payout_hold_cutover_at
  ) VALUES (
    v_holdnc, v_owner, 'x3645 adv hold', 'x3645-adv-hold-' || v_suffix,
    'paystack', 'NG', now()
  );
  IF (SELECT default_currency FROM public.brands WHERE id = v_holdnc) IS NOT NULL
     OR NOT public.pg_brand_can_collect(v_holdnc) THEN
    RAISE EXCEPTION 'fixture FAIL: the hold brand must collect and have no currency';
  END IF;
  IF public.pg_brand_can_collect(v_nobank) OR public.pg_brand_can_collect(v_nocur) THEN
    RAISE EXCEPTION 'fixture FAIL: the no-bank brands must not be able to collect';
  END IF;
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_member, 'event_manager', now(), now());
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE user_id = v_owner AND brand_id IN (v_brand, v_nobank, v_nocur, v_holdnc);
  PERFORM pg_temp.x3645_act_as(v_owner);

  -- ── A. a paid experience never declares free-only ─────────────────────────
  IF COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'A FAIL: the free-only flag was set before the test began';
  END IF;
  v_res := public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv paid create', 5000), true);
  IF COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'A FAIL: a paid experience created published declared a free-only publish';
  END IF;
  v_res := public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv paid draft', 5000), false);
  v_draft := (v_res->'event'->>'id')::uuid;
  PERFORM public.biz_publish_experience(v_draft, pg_temp.x3645_exp('adv paid draft', 5000), true);
  IF COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'A FAIL: a paid experience publish declared a free-only publish';
  END IF;
  -- Per-stop priced, terms accepted: published paid, still no flag.
  v_res := public.biz_create_experience(
    v_brand, pg_temp.x3645_exp('adv per stop paid', 4000, NULL, 'per_stop'), true);
  IF (v_res->'event'->>'status') <> 'scheduled'
     OR COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'A FAIL: a per-stop paid experience did not publish as a paid one';
  END IF;
  -- A draft save never declares anything, free or not.
  PERFORM public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv free draft only', 0), false);
  IF COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'A FAIL: a draft save declared a free-only publish';
  END IF;

  -- ── F. can collect, no currency: a paid experience is still refused ───────
  -- (Before any free publish in this transaction, so the flag is still unset.)
  PERFORM pg_temp.x3645_refused('F create',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_holdnc, pg_temp.x3645_exp('adv hold paid create', 5000)),
    'event_currency_required');
  v_res := public.biz_create_experience(v_holdnc, pg_temp.x3645_exp('adv hold paid draft', 5000), false);
  PERFORM pg_temp.x3645_refused('F publish',
    format('SELECT public.biz_publish_experience(%L::uuid, %L::jsonb, true)',
           (v_res->'event'->>'id')::uuid, pg_temp.x3645_exp('adv hold paid draft', 5000)),
    'event_currency_required');
  IF (SELECT status FROM public.events WHERE id = (v_res->'event'->>'id')::uuid) <> 'draft' THEN
    RAISE EXCEPTION 'F FAIL: the refused paid publish did not stay a draft';
  END IF;

  -- ── E. marked free but storing a priced stop: not declared free-only ──────
  PERFORM pg_temp.x3645_refused('E create',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_nocur, pg_temp.x3645_exp('adv free priced stop', 4000, NULL, 'per_stop', true)),
    'event_currency_required');
  IF COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'E FAIL: an experience storing a priced stop declared a free-only publish';
  END IF;

  -- ── B. unlisted currencies ───────────────────────────────────────────────
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    v_event, v_brand, 'x3645 adv event', 'x3645-adv-ev-' || v_suffix,
    'event', 'draft', 'draft', 'UTC'
  );
  SELECT count(*) INTO v_before FROM public.events WHERE brand_id = v_brand;
  -- AUD, NZD, SGD, HKD and JPY are the codes the old experience bodies let
  -- through to the events table. XXX, ZZZ and a four-letter spelling are not
  -- currencies at all. These are examples of UNLISTED codes; the listed ones
  -- are never written out in this file.
  FOREACH v_code IN ARRAY ARRAY['AUD', 'NZD', 'SGD', 'HKD', 'JPY', 'XXX', 'zzz', ' aud ', 'NGNX']
  LOOP
    IF public.is_supported_offering_currency(v_code) THEN
      RAISE EXCEPTION 'fixture FAIL: % is listed now; pick another unlisted example', v_code;
    END IF;
  END LOOP;
  FOREACH v_code IN ARRAY ARRAY['AUD', 'NZD', 'SGD', 'HKD', 'JPY', 'XXX', 'zzz']
  LOOP
    PERFORM pg_temp.x3645_refused(v_code || ' create draft',
      format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, false)',
             v_brand, pg_temp.x3645_exp('adv ' || v_code, 0, v_code)),
      'event_currency_unsupported');
    PERFORM pg_temp.x3645_refused(v_code || ' create published free',
      format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
             v_brand, pg_temp.x3645_exp('adv ' || v_code, 0, v_code)),
      'event_currency_unsupported');
    PERFORM pg_temp.x3645_refused(v_code || ' create published paid',
      format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
             v_brand, pg_temp.x3645_exp('adv ' || v_code, 5000, v_code)),
      'event_currency_unsupported');
    PERFORM pg_temp.x3645_refused(v_code || ' save draft',
      format('SELECT public.biz_publish_experience(%L::uuid, %L::jsonb, false)',
             v_draft, pg_temp.x3645_exp('adv ' || v_code, 0, v_code)),
      'event_currency_unsupported');
    PERFORM pg_temp.x3645_refused(v_code || ' publish',
      format('SELECT public.biz_publish_experience(%L::uuid, %L::jsonb, true)',
             v_draft, pg_temp.x3645_exp('adv ' || v_code, 5000, v_code)),
      'event_currency_unsupported');
    PERFORM pg_temp.x3645_refused(v_code || ' event publish',
      format('SELECT public.business_publish_event_draft(%L::uuid, %L::jsonb)',
             v_event, pg_temp.x3645_event(25, v_code)),
      'event_currency_unsupported');
  END LOOP;
  IF (SELECT count(*) FROM public.events WHERE brand_id = v_brand) <> v_before THEN
    RAISE EXCEPTION 'B FAIL: a refused currency left an offering row behind';
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'B FAIL: a refused currency published the event';
  END IF;

  -- ── C. the table decides ──────────────────────────────────────────────────
  -- Lower-case, listed: accepted and stored in the brand's currency.
  v_res := public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv lower', 0, 'ngn'), true);
  IF (v_res->'event'->>'status') <> 'scheduled' OR (v_res->'event'->>'currency') <> 'NGN' THEN
    RAISE EXCEPTION 'C FAIL: a lower-case listed code was not accepted as NGN';
  END IF;
  -- Switch one listed currency off: it is refused from that moment.
  SELECT c.code::text INTO v_code
    FROM public.supported_brand_currencies AS c
   WHERE c.active AND c.code::text <> 'NGN'
   ORDER BY c.code LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'fixture FAIL: no second active currency to switch off';
  END IF;
  PERFORM public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv before off', 0, v_code), false);
  UPDATE public.supported_brand_currencies SET active = false WHERE code::text = v_code;
  PERFORM pg_temp.x3645_refused('C switched off, create',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, false)',
           v_brand, pg_temp.x3645_exp('adv after off', 0, v_code)),
    'event_currency_unsupported');
  PERFORM pg_temp.x3645_refused('C switched off, publish',
    format('SELECT public.biz_publish_experience(%L::uuid, %L::jsonb, true)',
           v_draft, pg_temp.x3645_exp('adv after off', 5000, v_code)),
    'event_currency_unsupported');
  PERFORM pg_temp.x3645_refused('C switched off, event',
    format('SELECT public.business_publish_event_draft(%L::uuid, %L::jsonb)',
           v_event, pg_temp.x3645_event(25, v_code)),
    'event_currency_unsupported');
  UPDATE public.supported_brand_currencies SET active = true WHERE code::text = v_code;

  -- ── D. Organiser Terms, per member, before the can-collect check ──────────
  -- The owner has accepted; the event manager has not.
  PERFORM pg_temp.x3645_act_as(v_member);
  SELECT count(*) INTO v_before FROM public.events WHERE brand_id = v_brand;
  PERFORM pg_temp.x3645_refused('D create, whole price',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_brand, pg_temp.x3645_exp('adv member paid', 5000)),
    'mingla_tos_not_accepted');
  PERFORM pg_temp.x3645_refused('D create, per-stop price',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_brand, pg_temp.x3645_exp('adv member per stop', 4000, NULL, 'per_stop')),
    'mingla_tos_not_accepted');
  IF (SELECT count(*) FROM public.events WHERE brand_id = v_brand) <> v_before THEN
    RAISE EXCEPTION 'D FAIL: a refused paid create left a row behind';
  END IF;
  v_res := public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv member draft', 5000), false);
  PERFORM pg_temp.x3645_refused('D publish',
    format('SELECT public.biz_publish_experience(%L::uuid, %L::jsonb, true)',
           (v_res->'event'->>'id')::uuid, pg_temp.x3645_exp('adv member draft', 5000)),
    'mingla_tos_not_accepted');
  IF (SELECT status FROM public.events WHERE id = (v_res->'event'->>'id')::uuid) <> 'draft' THEN
    RAISE EXCEPTION 'D FAIL: the refused paid publish did not stay a draft';
  END IF;
  PERFORM pg_temp.x3645_refused('D event, online ticket',
    format('SELECT public.business_publish_event_draft(%L::uuid, %L::jsonb)',
           v_event, pg_temp.x3645_event(25)),
    'mingla_tos_not_accepted');
  PERFORM pg_temp.x3645_refused('D event, door-only ticket',
    format('SELECT public.business_publish_event_draft(%L::uuid, %L::jsonb)',
           v_event, pg_temp.x3645_event(25, NULL, 'door')),
    'mingla_tos_not_accepted');
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'D FAIL: the refused paid event publish did not stay a draft';
  END IF;
  -- The same member may still publish free.
  v_res := public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv member free', 0), true);
  IF (v_res->'event'->>'status') <> 'scheduled' THEN
    RAISE EXCEPTION 'D FAIL: a free experience needed Organiser Terms';
  END IF;

  -- A version with no timestamp is not acceptance.
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = NULL
   WHERE brand_id = v_brand AND user_id = v_member;
  PERFORM pg_temp.x3645_refused('D create, version without a timestamp',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_brand, pg_temp.x3645_exp('adv member half', 5000)),
    'mingla_tos_not_accepted');
  -- Accepted in full: the same call now goes through.
  UPDATE public.brand_team_members
     SET mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_member;
  v_res := public.biz_create_experience(v_brand, pg_temp.x3645_exp('adv member accepted', 5000), true);
  IF (v_res->'event'->>'status') <> 'scheduled' THEN
    RAISE EXCEPTION 'D FAIL: an accepted member could not publish a paid experience';
  END IF;

  -- Terms come BEFORE the can-collect check: an unaccepted owner on a brand
  -- with no bank is asked for the terms, not sent to connect a bank first.
  PERFORM pg_temp.x3645_act_as(v_owner);
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = NULL, mingla_tos_accepted_at = NULL
   WHERE brand_id = v_nobank AND user_id = v_owner;
  PERFORM pg_temp.x3645_refused('D order, create',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_nobank, pg_temp.x3645_exp('adv no bank paid', 5000)),
    'mingla_tos_not_accepted');
  v_res := public.biz_create_experience(v_nobank, pg_temp.x3645_exp('adv no bank draft', 5000), false);
  PERFORM pg_temp.x3645_refused('D order, publish',
    format('SELECT public.biz_publish_experience(%L::uuid, %L::jsonb, true)',
           (v_res->'event'->>'id')::uuid, pg_temp.x3645_exp('adv no bank draft', 5000)),
    'mingla_tos_not_accepted');
  -- With the terms accepted, the same brand is told it cannot collect yet.
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_nobank AND user_id = v_owner;
  PERFORM pg_temp.x3645_refused('D order, create after accepting',
    format('SELECT public.biz_create_experience(%L::uuid, %L::jsonb, true)',
           v_nobank, pg_temp.x3645_exp('adv no bank paid', 5000)),
    'stripe_charges_disabled');

  RAISE NOTICE '#3645 offering functions PASS (adversarial): unlisted codes are refused by name, the table decides, terms are per member and come first, a paid experience never declares free-only';
END
$test$;

ROLLBACK;
