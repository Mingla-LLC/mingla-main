\set ON_ERROR_STOP on

-- Issue #3645 — adversarial proof for the same three migrations
-- (20270831003645, 20270901003645, 20270902003645). What must NOT happen:
-- a payout country that is not a country code, another account writing it,
-- deleted or foreign RSVPs counted, and an RSVP someone has answered (or that
-- has started, or that the caller may not manage) going back to draft.
-- Every case rolls back.

-- The payload the wizard autosaves for an in-person RSVP draft
-- (draftToServerUpdate: top-level snake_case columns + theme.business_draft).
CREATE OR REPLACE FUNCTION pg_temp.rsvp_payload(p_revision integer, p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    '__expectedClientRevision', p_revision,
    'title', 'Garden RSVP',
    'description', 'Bring a friend.',
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn, New York 11249, United States',
    'online_url', NULL,
    'currency', 'USD',
    'is_online', false,
    'timezone', 'America/New_York',
    'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', jsonb_build_array('chill'),
      'musicGenres', '[]'::jsonb,
      'city', 'Brooklyn',
      'requestedVisibility', 'unlisted',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + make_interval(days => p_days))::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room',
        'address', '61 Wythe Avenue, Brooklyn, New York 11249, United States'),
      'hideAddressUntilTicket', false,
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'rsvpCapacity', 40,
      'rsvpAllowPlusOnes', true,
      'rsvpPlusOnesMax', 2,
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', false,
      'rsvpContributionSuggestedCents', NULL,
      'rsvpContributionMinCents', NULL,
      'clientRevision', p_revision)))
$payload$;

-- A brand with a currency, its owner (signed in), and an empty RSVP draft.
-- `created_by` is always supplied: production has it NOT NULL.
CREATE OR REPLACE FUNCTION pg_temp.rsvp_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i3645-bank-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Bank setup ' || p_tag, 'i3645-bank-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'Garden RSVP', 'draft-i3645-bank-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  RETURN NEXT;
END;
$fixture$;

-- Saves the draft the way the wizard does, then publishes it the way the app does.
CREATE OR REPLACE FUNCTION pg_temp.publish_rsvp(p_event uuid, p_days integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql AS $pub$
BEGIN
  PERFORM public.business_update_rsvp_graph(p_event, pg_temp.rsvp_payload(1, p_days), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(p_event, gen_random_uuid());
  IF (SELECT status FROM public.events WHERE id = p_event) IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'fixture: the RSVP did not publish';
  END IF;
END;
$pub$;

-- Runs the unpublish and reports the refusal code ('' when it went through).
CREATE OR REPLACE FUNCTION pg_temp.try_unpublish(p_event uuid)
RETURNS text LANGUAGE plpgsql AS $try$
BEGIN
  PERFORM public.business_unpublish_rsvp_to_draft(p_event);
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$try$;

-- ─── A-01: the payout country is a code or nothing, and only the owner's ─────
BEGIN;
DO $a01$
DECLARE f record; v_bad text; v_rows integer; v_stranger uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('a01');
  FOREACH v_bad IN ARRAY ARRAY['ie', 'IRL', '', 'I', 'I1', ' IE'] LOOP
    BEGIN
      UPDATE public.brands SET payout_country = v_bad WHERE id = f.v_brand;
      RAISE EXCEPTION 'A-01 FAIL: payout_country accepted "%"', v_bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  -- Another signed-in account cannot write it.
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'i3645-bank-stranger-' || v_stranger || '@example.test');
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET payout_country = 'NG' WHERE id = f.v_brand;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 0 OR (SELECT payout_country FROM public.brands WHERE id = f.v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'A-01 FAIL: a stranger changed another brand''s payout country';
  END IF;
  -- Nor can a signed-out visitor.
  SET LOCAL ROLE anon;
  UPDATE public.brands SET payout_country = 'NG' WHERE id = f.v_brand;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'A-01 FAIL: a signed-out visitor changed a brand''s payout country';
  END IF;
  RAISE NOTICE 'A-01 PASS: only a two-letter code, only from the brand''s own people';
END $a01$;
ROLLBACK;

-- ─── A-02: no database routine reads the column ──────────────────────────────
BEGIN;
DO $a02$
DECLARE v_name text;
BEGIN
  SELECT n.nspname || '.' || p.proname INTO v_name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prokind = 'f'
     AND p.prosrc ~ '\mpayout_country\M' LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'A-02 FAIL: % reads brands.payout_country; it is display-only', v_name;
  END IF;
  SELECT c.relname INTO v_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND pg_get_viewdef(c.oid) ~ '\mpayout_country\M' LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'A-02 FAIL: view % reads brands.payout_country; it is display-only', v_name;
  END IF;
  RAISE NOTICE 'A-02 PASS: nothing in the database depends on the payout country';
END $a02$;
ROLLBACK;

-- ─── A-03: deleted and foreign RSVPs are not counted; visitors are refused ───
BEGIN;
DO $a03$
DECLARE f record; g record; v_counts record; v_refused boolean := false;
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('a03');
  SELECT * INTO g FROM pg_temp.rsvp_fixture('a03b');
  UPDATE public.events SET deleted_at = now() WHERE id = f.v_event;
  SELECT * INTO v_counts FROM public.pg_brand_offering_counts(f.v_brand);
  IF v_counts.events <> 0 OR v_counts.events_draft <> 0 THEN
    RAISE EXCEPTION 'A-03 FAIL: a deleted RSVP, or another brand''s, was counted (% / %)',
      v_counts.events, v_counts.events_draft;
  END IF;
  SELECT * INTO v_counts FROM public.pg_brand_offering_counts(g.v_brand);
  IF v_counts.events_draft <> 1 THEN
    RAISE EXCEPTION 'A-03 FAIL: the second brand''s own draft RSVP is not counted';
  END IF;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.pg_brand_offering_counts(g.v_brand);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  RESET ROLE;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-03 FAIL: a signed-out visitor could read a brand''s offering counts';
  END IF;
  RAISE NOTICE 'A-03 PASS: counts stay per brand, skip deleted rows and stay signed-in only';
END $a03$;
ROLLBACK;

-- ─── A-04: an RSVP anyone has answered does not go back to draft ─────────────
BEGIN;
DO $a04$
DECLARE f record; v_status text; v_code text; v_rsvp uuid;
BEGIN
  -- Every reply status counts, exactly as for an event: not only "going".
  FOREACH v_status IN ARRAY ARRAY['going', 'maybe', 'not_going', 'waitlisted'] LOOP
    SELECT * INTO f FROM pg_temp.rsvp_fixture('a04-' || v_status);
    PERFORM pg_temp.publish_rsvp(f.v_event);
    INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status)
    VALUES (f.v_event, 'Ada Guest', 'ada-' || f.v_event || '@example.test', '+12125550123', v_status);
    v_code := pg_temp.try_unpublish(f.v_event);
    IF v_code NOT ILIKE '%rsvp_unpublish_has_commitments%' THEN
      RAISE EXCEPTION 'A-04 FAIL: a "%" reply did not stop the unpublish (answer: "%")', v_status, v_code;
    END IF;
    IF (SELECT status FROM public.events WHERE id = f.v_event) IS DISTINCT FROM 'scheduled'
       OR NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = f.v_event) THEN
      RAISE EXCEPTION 'A-04 FAIL: a refused unpublish still changed the RSVP';
    END IF;
  END LOOP;

  -- A chip-in in ANY state counts, including one that was never paid.
  FOREACH v_status IN ARRAY ARRAY['pending', 'paid', 'failed', 'refunded', 'cancelled'] LOOP
    SELECT * INTO f FROM pg_temp.rsvp_fixture('a04c-' || v_status);
    PERFORM pg_temp.publish_rsvp(f.v_event);
    INSERT INTO public.event_rsvp_contributions(event_id, brand_id, provider, currency,
      amount_cents, buyer_total_cents, pricing_breakdown, status)
    VALUES (f.v_event, f.v_brand, 'stripe', 'USD', 500, 500, '{}'::jsonb, v_status);
    v_code := pg_temp.try_unpublish(f.v_event);
    IF v_code NOT ILIKE '%rsvp_unpublish_has_commitments%' THEN
      RAISE EXCEPTION 'A-04 FAIL: a "%" chip-in did not stop the unpublish (answer: "%")', v_status, v_code;
    END IF;
  END LOOP;

  -- A guest still awaiting approval counts too.
  SELECT * INTO f FROM pg_temp.rsvp_fixture('a04w');
  PERFORM pg_temp.publish_rsvp(f.v_event);
  INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (f.v_event, 'Pending Guest', 'pending-' || f.v_event || '@example.test', '+12125550124', 'going', 'pending')
  RETURNING id INTO v_rsvp;
  v_code := pg_temp.try_unpublish(f.v_event);
  IF v_code NOT ILIKE '%rsvp_unpublish_has_commitments%' THEN
    RAISE EXCEPTION 'A-04 FAIL: a guest awaiting approval did not stop the unpublish ("%")', v_code;
  END IF;
  RAISE NOTICE 'A-04 PASS: any reply and any chip-in keeps a published RSVP published';
END $a04$;
ROLLBACK;

-- ─── A-05: who may, and which rows ───────────────────────────────────────────
BEGIN;
DO $a05$
DECLARE f record; v_code text; v_stranger uuid := gen_random_uuid(); v_event uuid := gen_random_uuid();
  v_refused boolean := false;
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('a05');

  -- A draft is not published.
  v_code := pg_temp.try_unpublish(f.v_event);
  IF v_code NOT ILIKE '%rsvp_not_unpublishable%' THEN
    RAISE EXCEPTION 'A-05 FAIL: a draft RSVP answered "%"', v_code;
  END IF;

  PERFORM pg_temp.publish_rsvp(f.v_event);

  -- Signed out.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_code := pg_temp.try_unpublish(f.v_event);
  IF v_code NOT ILIKE '%not_authenticated%' THEN
    RAISE EXCEPTION 'A-05 FAIL: a signed-out caller answered "%"', v_code;
  END IF;

  -- Signed in, but not on the brand.
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'i3645-bank-a05-' || v_stranger || '@example.test');
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_code := pg_temp.try_unpublish(f.v_event);
  IF v_code NOT ILIKE '%insufficient_event_permission%' THEN
    RAISE EXCEPTION 'A-05 FAIL: a stranger answered "%"', v_code;
  END IF;
  IF (SELECT status FROM public.events WHERE id = f.v_event) IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'A-05 FAIL: a stranger moved the RSVP';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);

  -- The role itself has no way in when signed out.
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.business_unpublish_rsvp_to_draft(f.v_event);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  RESET ROLE;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-05 FAIL: the anon role may execute the unpublish';
  END IF;

  -- An event is not an RSVP, and the event owner still refuses an RSVP.
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, f.v_brand, f.v_user, 'An event', 'draft-i3645-bank-' || v_event, 'event', 'draft',
    'draft', 'America/New_York', 'USD', '{}'::jsonb);
  v_code := pg_temp.try_unpublish(v_event);
  IF v_code NOT ILIKE '%rsvp_not_found%' THEN
    RAISE EXCEPTION 'A-05 FAIL: an event answered "%"', v_code;
  END IF;
  BEGIN
    PERFORM public.business_unpublish_event_to_draft(f.v_event);
    RAISE EXCEPTION 'A-05 FAIL: the event unpublish accepted an RSVP';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%event_not_found%' THEN RAISE; END IF;
  END;

  -- A started RSVP stays published.
  UPDATE public.event_dates SET start_at = now() - interval '1 hour', end_at = now() + interval '2 hours'
   WHERE event_id = f.v_event;
  v_code := pg_temp.try_unpublish(f.v_event);
  IF v_code NOT ILIKE '%rsvp_unpublish_not_future%' THEN
    RAISE EXCEPTION 'A-05 FAIL: a started RSVP answered "%"', v_code;
  END IF;

  -- A deleted RSVP is not found.
  UPDATE public.events SET deleted_at = now() WHERE id = f.v_event;
  v_code := pg_temp.try_unpublish(f.v_event);
  IF v_code NOT ILIKE '%rsvp_not_found%' THEN
    RAISE EXCEPTION 'A-05 FAIL: a deleted RSVP answered "%"', v_code;
  END IF;
  -- And one that does not exist.
  v_code := pg_temp.try_unpublish(gen_random_uuid());
  IF v_code NOT ILIKE '%rsvp_not_found%' THEN
    RAISE EXCEPTION 'A-05 FAIL: a missing RSVP answered "%"', v_code;
  END IF;
  RAISE NOTICE 'A-05 PASS: drafts, strangers, visitors, events, started and deleted RSVPs are all refused';
END $a05$;
ROLLBACK;
