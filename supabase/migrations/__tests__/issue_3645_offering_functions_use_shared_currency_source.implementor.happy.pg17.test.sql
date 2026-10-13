-- Issue #3645 — the three offering functions ask the shared currency source
-- (migration 20270830003645). Implementor happy path, behavioural.
--
-- Proves, by LOOPING over public.supported_brand_currencies (no literal list):
--   * every active currency creates an experience already published, free and
--     paid; publishes a saved experience draft, free and paid; and publishes a
--     paid event. Naira is asserted by name.
--   * the published row and its ticket carry that currency.
--   * a free publish needs no Organiser Terms; a paid draft save needs none.
--   * a free experience on a brand with NO currency publishes and is stored
--     with no currency, through both experience functions; a free event on
--     such a brand still does (unchanged).
--   * a paid experience on a brand with no currency is still refused.
--   * a signed-in organiser (role authenticated) can do the naira round trip.
--
-- Fails on the bodies this migration replaces: the two experience functions
-- refuse NGN with event_currency_unsupported, and refuse a free experience on a
-- brand with no currency with event_currency_required.
--
-- Every fixture is transaction-local and rolled back.
\set ON_ERROR_STOP on

BEGIN;

-- Payload builders. p_price_cents = 0 means a free offering.
CREATE FUNCTION pg_temp.x3645_exp(p_title text, p_price_cents integer, p_currency text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title', p_title,
    'description', 'A walk through two good places.',
    'currency', p_currency,
    'is_free', p_price_cents = 0,
    'pricing_mode', 'whole',
    'whole_price_cents', p_price_cents,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'UTC',
    'whenMode', 'single',
    'when', jsonb_build_object(
      'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '20:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_name', 'First', 'ai_description', 'The first stop',
        'address', '1 First St', 'place_id', 'x3645-place-1', 'lat', 6.5, 'lng', 3.4, 'stop_order', 0),
      jsonb_build_object('place_name', 'Second', 'ai_description', 'The second stop',
        'address', '2 Second St', 'place_id', 'x3645-place-2', 'lat', 6.6, 'lng', 3.5, 'stop_order', 1))
  ));
$f$;

CREATE FUNCTION pg_temp.x3645_event(p_price numeric)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'title', 'x3645 event',
    'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Standard', 'isFree', p_price = 0, 'price', p_price,
        'capacity', 10, 'availableAt', 'online')),
      'city', 'Lagos',
      'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))));
$f$;

CREATE FUNCTION pg_temp.x3645_act_as(p_user uuid, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', p_role)::text, true);
END
$f$;

-- Assert one published offering: status, the event's currency, and its ticket.
CREATE FUNCTION pg_temp.x3645_assert_published(
  p_label text, p_event uuid, p_currency text, p_price_cents integer
) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_event  public.events%ROWTYPE;
  v_ticket public.ticket_types%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% FAIL: no event row', p_label;
  END IF;
  IF v_event.status <> 'scheduled' THEN
    RAISE EXCEPTION '% FAIL: status is %, expected scheduled', p_label, v_event.status;
  END IF;
  IF v_event.currency::text IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION '% FAIL: event currency is %, expected %', p_label, v_event.currency, p_currency;
  END IF;
  SELECT * INTO v_ticket FROM public.ticket_types
   WHERE event_id = p_event AND deleted_at IS NULL ORDER BY display_order LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% FAIL: no ticket row', p_label;
  END IF;
  IF v_ticket.price_cents <> p_price_cents THEN
    RAISE EXCEPTION '% FAIL: ticket price is %, expected %', p_label, v_ticket.price_cents, p_price_cents;
  END IF;
  IF p_price_cents > 0 AND v_ticket.currency::text IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION '% FAIL: paid ticket currency is %, expected %', p_label, v_ticket.currency, p_currency;
  END IF;
END
$f$;

DO $test$
DECLARE
  v_owner     uuid := gen_random_uuid();
  v_suffix    text := replace(gen_random_uuid()::text, '-', '');
  v_code      text;
  v_codes     integer := 0;
  v_saw_naira boolean := false;
  v_brand     uuid;
  v_event     uuid;
  v_res       jsonb;
  v_raised    text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  PERFORM pg_temp.x3645_act_as(v_owner);

  -- ── Every listed currency, on a brand that can collect, terms accepted ────
  FOR v_code IN
    SELECT c.code::text FROM public.supported_brand_currencies AS c
     WHERE c.active ORDER BY c.code
  LOOP
    v_codes := v_codes + 1;
    v_saw_naira := v_saw_naira OR v_code = 'NGN';
    v_brand := gen_random_uuid();
    INSERT INTO public.brands (
      id, account_id, name, slug, default_currency, payment_provider,
      payment_country, paystack_subaccount_code
    ) VALUES (
      v_brand, v_owner, 'x3645 ' || v_code,
      'x3645-' || lower(v_code) || '-' || v_suffix,
      v_code, 'paystack', 'NG', 'ACCT_x3645_' || v_code
    );
    IF NOT public.pg_brand_can_collect(v_brand) THEN
      RAISE EXCEPTION 'fixture FAIL: % brand cannot collect', v_code;
    END IF;
    UPDATE public.brand_team_members
       SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
     WHERE brand_id = v_brand AND user_id = v_owner;

    -- Free experience, created already published. The payload names the
    -- currency, as the Host app does.
    v_res := public.biz_create_experience(
      v_brand, pg_temp.x3645_exp(v_code || ' free create', 0, v_code), true);
    PERFORM pg_temp.x3645_assert_published(
      v_code || ' create free', (v_res->'event'->>'id')::uuid, v_code, 0);

    -- Paid experience, created already published. No currency in the payload:
    -- the brand's own currency is used.
    v_res := public.biz_create_experience(
      v_brand, pg_temp.x3645_exp(v_code || ' paid create', 5000), true);
    PERFORM pg_temp.x3645_assert_published(
      v_code || ' create paid', (v_res->'event'->>'id')::uuid, v_code, 5000);

    -- Saved as a draft in that currency, then published free.
    v_res := public.biz_create_experience(
      v_brand, pg_temp.x3645_exp(v_code || ' free draft', 0, v_code), false);
    v_event := (v_res->'event'->>'id')::uuid;
    IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
      RAISE EXCEPTION '% draft FAIL: a draft save did not stay a draft', v_code;
    END IF;
    PERFORM public.biz_publish_experience(
      v_event, pg_temp.x3645_exp(v_code || ' free draft', 0, v_code), true);
    PERFORM pg_temp.x3645_assert_published(v_code || ' publish free', v_event, v_code, 0);

    -- Saved as a paid draft, then published paid.
    v_res := public.biz_create_experience(
      v_brand, pg_temp.x3645_exp(v_code || ' paid draft', 7500, v_code), false);
    v_event := (v_res->'event'->>'id')::uuid;
    PERFORM public.biz_publish_experience(
      v_event, pg_temp.x3645_exp(v_code || ' paid draft', 7500, v_code), true);
    PERFORM pg_temp.x3645_assert_published(v_code || ' publish paid', v_event, v_code, 7500);

    -- Paid event in that currency.
    v_event := gen_random_uuid();
    INSERT INTO public.events (
      id, brand_id, title, slug, event_type, status, visibility, timezone
    ) VALUES (
      v_event, v_brand, 'x3645 event', 'x3645-ev-' || lower(v_code) || '-' || v_suffix,
      'event', 'draft', 'draft', 'UTC'
    );
    PERFORM public.business_publish_event_draft(v_event, pg_temp.x3645_event(25));
    PERFORM pg_temp.x3645_assert_published(v_code || ' event paid', v_event, v_code, 2500);
  END LOOP;

  IF v_codes = 0 THEN
    RAISE EXCEPTION 'FAIL: supported_brand_currencies has no active rows; the loop proved nothing';
  END IF;
  IF NOT v_saw_naira THEN
    RAISE EXCEPTION 'FAIL: NGN is not an active supported currency, so naira was never exercised';
  END IF;

  -- ── Free needs no Organiser Terms; a paid DRAFT save needs none ───────────
  v_brand := gen_random_uuid();
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_owner, 'x3645 no terms', 'x3645-noterms-' || v_suffix,
    'NGN', 'paystack', 'NG', 'ACCT_x3645_noterms'
  );
  IF EXISTS (
    SELECT 1 FROM public.brand_team_members
     WHERE brand_id = v_brand AND user_id = v_owner
       AND (mingla_tos_version_accepted IS NOT NULL OR mingla_tos_accepted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'fixture FAIL: a new brand owner must start without Organiser Terms';
  END IF;

  v_res := public.biz_create_experience(
    v_brand, pg_temp.x3645_exp('no terms free create', 0, 'NGN'), true);
  PERFORM pg_temp.x3645_assert_published(
    'no-terms create free', (v_res->'event'->>'id')::uuid, 'NGN', 0);

  v_res := public.biz_create_experience(
    v_brand, pg_temp.x3645_exp('no terms paid draft', 5000, 'NGN'), false);
  v_event := (v_res->'event'->>'id')::uuid;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'no-terms FAIL: a paid draft save was not stored as a draft';
  END IF;
  -- Saving that paid draft again needs no terms either.
  PERFORM public.biz_publish_experience(
    v_event, pg_temp.x3645_exp('no terms paid draft', 5000, 'NGN'), false);
  -- Turned free, it publishes without terms.
  PERFORM public.biz_publish_experience(
    v_event, pg_temp.x3645_exp('no terms now free', 0, 'NGN'), true);
  PERFORM pg_temp.x3645_assert_published('no-terms publish free', v_event, 'NGN', 0);

  v_event := gen_random_uuid();
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    v_event, v_brand, 'x3645 free event', 'x3645-ev-free-' || v_suffix,
    'event', 'draft', 'draft', 'UTC'
  );
  PERFORM public.business_publish_event_draft(v_event, pg_temp.x3645_event(0));
  PERFORM pg_temp.x3645_assert_published('no-terms event free', v_event, 'NGN', 0);

  -- ── A brand with NO currency yet ──────────────────────────────────────────
  v_brand := gen_random_uuid();
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'x3645 no currency', 'x3645-nocur-' || v_suffix);
  IF (SELECT default_currency FROM public.brands WHERE id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'fixture FAIL: the no-currency brand has a currency';
  END IF;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_owner;

  -- Free experience, created already published: stored with no currency.
  -- The flag is transaction-scoped and every case here shares one transaction,
  -- so clear it first: this publish must declare itself, not inherit an earlier
  -- free publish's declaration.
  PERFORM set_config('mingla.publish_free_only', '', true);
  v_res := public.biz_create_experience(
    v_brand, pg_temp.x3645_exp('no currency free create', 0), true);
  PERFORM pg_temp.x3645_assert_published(
    'no-currency create free', (v_res->'event'->>'id')::uuid, NULL, 0);

  -- Free experience draft, then published: stored with no currency.
  v_res := public.biz_create_experience(
    v_brand, pg_temp.x3645_exp('no currency free draft', 0), false);
  v_event := (v_res->'event'->>'id')::uuid;
  PERFORM set_config('mingla.publish_free_only', '', true);
  PERFORM public.biz_publish_experience(
    v_event, pg_temp.x3645_exp('no currency free draft', 0), true);
  PERFORM pg_temp.x3645_assert_published('no-currency publish free', v_event, NULL, 0);

  -- Free event: unchanged, still stored with no currency.
  v_event := gen_random_uuid();
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    v_event, v_brand, 'x3645 free event', 'x3645-ev-nocur-' || v_suffix,
    'event', 'draft', 'draft', 'UTC'
  );
  PERFORM set_config('mingla.publish_free_only', '', true);
  PERFORM public.business_publish_event_draft(v_event, pg_temp.x3645_event(0));
  PERFORM pg_temp.x3645_assert_published('no-currency event free', v_event, NULL, 0);

  -- Paid experience on that brand: still refused, both ways in.
  PERFORM set_config('mingla.publish_free_only', '', true);
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_create_experience(
      v_brand, pg_temp.x3645_exp('no currency paid create', 5000), true);
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL THEN
    RAISE EXCEPTION 'no-currency FAIL: a paid experience was created published on a brand with no currency';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE brand_id = v_brand AND title = 'no currency paid create') THEN
    RAISE EXCEPTION 'no-currency FAIL: the refused paid create left a row behind';
  END IF;

  v_res := public.biz_create_experience(
    v_brand, pg_temp.x3645_exp('no currency paid draft', 5000), false);
  v_event := (v_res->'event'->>'id')::uuid;
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_publish_experience(
      v_event, pg_temp.x3645_exp('no currency paid draft', 5000), true);
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL THEN
    RAISE EXCEPTION 'no-currency FAIL: a paid experience was published on a brand with no currency';
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'no-currency FAIL: the refused paid publish did not stay a draft';
  END IF;

  RAISE NOTICE '#3645 offering functions PASS (happy): % currencies incl. NGN create, save and publish; free needs no terms; a free experience publishes with no currency', v_codes;
END
$test$;

-- ── As a signed-in organiser: the naira round trip through real grants ─────
DO $as_organiser$
DECLARE
  v_owner  uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_payload jsonb;
  v_res    jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_owner, 'x3645 organiser', 'x3645-org-' || v_suffix,
    'NGN', 'paystack', 'NG', 'ACCT_x3645_org'
  );
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_owner;
  v_payload := pg_temp.x3645_exp('organiser naira', 250000, 'NGN');
  PERFORM pg_temp.x3645_act_as(v_owner);

  SET LOCAL ROLE authenticated;
  v_res := public.biz_create_experience(v_brand, v_payload, false);
  v_res := public.biz_publish_experience((v_res->'event'->>'id')::uuid, v_payload, true);
  RESET ROLE;

  PERFORM pg_temp.x3645_assert_published(
    'organiser naira', (v_res->'event'->>'id')::uuid, 'NGN', 250000);
  RAISE NOTICE '#3645 offering functions PASS (happy): a signed-in organiser publishes a paid naira experience';
END
$as_organiser$;

ROLLBACK;
