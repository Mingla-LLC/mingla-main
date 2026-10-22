\set ON_ERROR_STOP on

-- Issue #3645 — adversarial proof for 20270824003645. The migration removed
-- one refusal from the DRAFT branch of `business_update_rsvp_graph`. This suite
-- attacks everything that removal must NOT have loosened:
--
--   X-01  someone outside the brand still cannot save chip-ins (or anything);
--   X-02  a signed-out caller still cannot;
--   X-03  the amount rules still hold with chip-ins on (zero, negative,
--         suggested below minimum);
--   X-04  a stale revision is still refused;
--   X-05  BOTH publish doors still refuse: the app's entry point and the owner
--         underneath it, called directly;
--   X-06  a PUBLISHED RSVP on a no-bank brand still cannot switch chip-ins on
--         through this same function (the live branch is unchanged), so the
--         removal cannot be used to take money after publishing;
--   X-07  an autosave that never mentions chip-ins, on a draft that already has
--         them on, now saves (it used to fail on every later keystroke);
--   X-08  a retried save (same request id) is answered once, not applied twice;
--   X-09  the body no longer asks about payment readiness, while the publish
--         owner and the live-edit owner still do.
--
-- Every case executes the real functions. Each case rolls back.

-- The payload the wizard autosaves for an in-person RSVP draft
-- (draftToServerUpdate: top-level snake_case columns + theme.business_draft).
CREATE OR REPLACE FUNCTION pg_temp.chip_in_payload(
  p_revision integer, p_enabled boolean,
  p_suggested integer DEFAULT NULL, p_minimum integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    '__expectedClientRevision', p_revision,
    'title', 'Chip-in RSVP',
    'description', NULL,
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn, New York 11249, United States',
    'online_url', NULL,
    'currency', 'USD',
    'is_online', false,
    'timezone', 'America/New_York',
    'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', '[]'::jsonb,
      'musicGenres', '[]'::jsonb,
      'city', 'Brooklyn',
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room',
        'address', '61 Wythe Avenue, Brooklyn, New York 11249, United States'),
      'hideAddressUntilTicket', false,
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', p_enabled,
      'rsvpContributionSuggestedCents', p_suggested,
      'rsvpContributionMinCents', p_minimum,
      'clientRevision', p_revision)))
$payload$;

-- A brand with a currency and NO bank, its owner, and an empty RSVP draft.
CREATE OR REPLACE FUNCTION pg_temp.chip_in_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'chip-in-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Chip-in ' || p_tag, 'chip-in-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'Chip-in RSVP', 'draft-chip-in-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  IF public.pg_brand_can_collect(v_brand) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'fixture: the brand can already collect; the suite would prove nothing';
  END IF;
  RETURN NEXT;
END;
$fixture$;

-- ─── X-01 / X-02: not on the brand, and signed out ───────────────────────────
BEGIN;
DO $x01$
DECLARE
  f record;
  v_stranger uuid := gen_random_uuid();
  v_refused boolean := false;
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('x01');
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'chip-in-stranger-' || v_stranger || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_stranger);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (gen_random_uuid(), v_stranger, 'Stranger', 'chip-in-stranger-' || v_stranger, 'USD');
  SELECT theme INTO v_before FROM public.events WHERE id = f.v_event;

  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  BEGIN
    PERFORM public.business_update_rsvp_graph(f.v_event,
      pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);
  EXCEPTION WHEN sqlstate '42501' THEN
    IF SQLERRM <> 'rsvp_not_found_or_forbidden' THEN
      RAISE EXCEPTION 'X-01 FAIL: a stranger was refused with %', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'X-01 FAIL: someone outside the brand saved chip-ins on its RSVP'; END IF;
  SELECT theme INTO v_after FROM public.events WHERE id = f.v_event;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'X-01 FAIL: a refused stranger save changed the draft'; END IF;

  v_refused := false;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.business_update_rsvp_graph(f.v_event,
      pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'X-02 FAIL: a signed-out caller saved chip-ins'; END IF;
  SELECT theme INTO v_after FROM public.events WHERE id = f.v_event;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'X-02 FAIL: a refused signed-out save changed the draft'; END IF;
  RAISE NOTICE 'X-01/X-02 PASS: a stranger and a signed-out caller are still refused, nothing changed';
END $x01$;
ROLLBACK;

-- ─── X-03 / X-04: amount rules and the revision check still hold ─────────────
BEGIN;
DO $x03$
DECLARE
  f record;
  v_case record;
  v_refused boolean;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('x03');
  FOR v_case IN
    SELECT * FROM (VALUES
      ('zero suggested', 0, NULL::integer),
      ('negative minimum', NULL::integer, -5),
      ('suggested below minimum', 400, 500)
    ) AS t(label, suggested, minimum)
  LOOP
    v_refused := false;
    BEGIN
      PERFORM public.business_update_rsvp_graph(f.v_event,
        pg_temp.chip_in_payload(1, true, v_case.suggested, v_case.minimum), NULL, NULL);
    EXCEPTION WHEN sqlstate '22023' THEN
      IF SQLERRM <> 'rsvp_contribution_amount_invalid' THEN
        RAISE EXCEPTION 'X-03 FAIL (%): refused with %', v_case.label, SQLERRM;
      END IF;
      v_refused := true;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'X-03 FAIL: a chip-in draft with % was saved', v_case.label; END IF;
  END LOOP;
  IF (SELECT theme#>>'{business_draft,rsvpContributionEnabled}' FROM public.events WHERE id = f.v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'X-03 FAIL: a refused save still switched chip-ins on';
  END IF;

  -- X-04 — move the stored revision to 5, then send an older one.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(5, true, 1500, 500), NULL, NULL);
  v_refused := false;
  BEGIN
    PERFORM public.business_update_rsvp_graph(f.v_event,
      pg_temp.chip_in_payload(2, true, 9900, 500), NULL, NULL);
  EXCEPTION WHEN sqlstate 'PT409' THEN
    IF SQLERRM <> 'rsvp_revision_conflict' THEN RAISE EXCEPTION 'X-04 FAIL: stale revision raised %', SQLERRM; END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'X-04 FAIL: a stale chip-in save was accepted'; END IF;
  IF (SELECT (theme#>>'{business_draft,rsvpContributionSuggestedCents}')::integer FROM public.events WHERE id = f.v_event)
       IS DISTINCT FROM 1500 THEN
    RAISE EXCEPTION 'X-04 FAIL: a refused stale save overwrote the amount';
  END IF;
  RAISE NOTICE 'X-03/X-04 PASS: amount rules and the revision check still refuse';
END $x03$;
ROLLBACK;

-- ─── X-05: both publish doors still refuse ───────────────────────────────────
BEGIN;
DO $x05$
DECLARE
  f record;
  v_refused boolean := false;
  v_status text;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('x05');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, true, NULL, NULL), NULL, NULL);

  BEGIN
    PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%stripe_charges_disabled%' THEN
      RAISE EXCEPTION 'X-05 FAIL: the app publish door refused with % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'X-05 FAIL: the app publish door published a chip-in RSVP with no bank'; END IF;

  v_refused := false;
  BEGIN
    PERFORM public.business_publish_rsvp_draft(f.v_event,
      (SELECT theme->'business_draft' FROM public.events WHERE id = f.v_event), NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%stripe_charges_disabled%' THEN
      RAISE EXCEPTION 'X-05 FAIL: the publish owner refused with % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'X-05 FAIL: the publish owner published a chip-in RSVP with no bank'; END IF;

  SELECT status INTO v_status FROM public.events WHERE id = f.v_event;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'X-05 FAIL: a refused publish left status %', v_status; END IF;
  RAISE NOTICE 'X-05 PASS: both publish doors still refuse a chip-in RSVP with no bank';
END $x05$;
ROLLBACK;

-- ─── X-06: a published RSVP cannot switch chip-ins on without a bank ─────────
BEGIN;
DO $x06$
DECLARE
  f record;
  v_refused boolean := false;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('x06');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, false), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status = 'draft' THEN RAISE EXCEPTION 'X-06 fixture FAIL: the free RSVP did not publish'; END IF;

  BEGIN
    PERFORM public.business_update_rsvp_graph(f.v_event,
      jsonb_build_object('title', 'Chip-in RSVP', 'rsvpContributionEnabled', true),
      'Turning on guest chip-ins', NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%stripe_charges_disabled%' THEN
      RAISE EXCEPTION 'X-06 FAIL: the live edit refused with % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'X-06 FAIL: a published RSVP switched chip-ins on for a brand that cannot collect';
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF COALESCE(v_row.rsvp_contribution_enabled, false) THEN
    RAISE EXCEPTION 'X-06 FAIL: the refused live edit still switched chip-ins on';
  END IF;
  RAISE NOTICE 'X-06 PASS: a published RSVP still cannot take chip-ins without a bank';
END $x06$;
ROLLBACK;

-- ─── X-07 / X-08: later autosaves, and a retried request ─────────────────────
BEGIN;
DO $x07$
DECLARE
  f record;
  v_first jsonb;
  v_second jsonb;
  v_request uuid := gen_random_uuid();
  v_row public.events%ROWTYPE;
  v_receipts integer;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('x07');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);

  -- X-07 — a title-only save. The merged draft still has chip-ins on, which
  -- is exactly what the removed check looked at.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('__expectedClientRevision', 2, 'title', 'Renamed chip-in RSVP'), NULL, NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.title IS DISTINCT FROM 'Renamed chip-in RSVP' THEN
    RAISE EXCEPTION 'X-07 FAIL: an unrelated save on a chip-in draft did not land';
  END IF;
  IF (v_row.theme#>>'{business_draft,rsvpContributionEnabled}')::boolean IS DISTINCT FROM true
     OR (v_row.theme#>>'{business_draft,rsvpContributionMinCents}')::integer IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'X-07 FAIL: an unrelated save dropped the chip-in settings';
  END IF;

  -- X-08 — the same request id twice.
  v_first := public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(3, true, 2000, 500), NULL, v_request);
  v_second := public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(3, true, 2000, 500), NULL, v_request);
  IF (v_first->>'replayed')::boolean IS DISTINCT FROM false
     OR (v_second->>'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'X-08 FAIL: a retried chip-in save was not answered as a replay (% / %)',
      v_first->>'replayed', v_second->>'replayed';
  END IF;
  SELECT count(*) INTO v_receipts FROM public.rsvp_domain_operation_receipts
   WHERE actor_id = f.v_user AND operation = 'update' AND client_request_id = v_request;
  IF v_receipts <> 1 THEN RAISE EXCEPTION 'X-08 FAIL: % receipts for one request id', v_receipts; END IF;
  RAISE NOTICE 'X-07/X-08 PASS: later autosaves land and a retry is answered once';
END $x07$;
ROLLBACK;

-- ─── X-09: who still asks about payment readiness ────────────────────────────
DO $x09$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.business_update_rsvp_graph(uuid, jsonb, text, uuid)'::regprocedure;
  IF position('pg_brand_can_collect' IN v_src) > 0 OR position('stripe_charges_disabled' IN v_src) > 0 THEN
    RAISE EXCEPTION 'X-09 FAIL: the RSVP draft save still asks about payment readiness';
  END IF;
  IF position('rsvp_not_found_or_forbidden' IN v_src) = 0
     OR position('rsvp_contribution_amount_invalid' IN v_src) = 0
     OR position('biz_update_live_rsvp' IN v_src) = 0 THEN
    RAISE EXCEPTION 'X-09 FAIL: the RSVP save lost its permission check, its amount rule or its live branch';
  END IF;
  SELECT string_agg(prosrc, ' ') INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'business_publish_rsvp_draft';
  IF v_src IS NULL OR position('pg_brand_can_collect' IN v_src) = 0
     OR position('stripe_charges_disabled' IN v_src) = 0 THEN
    RAISE EXCEPTION 'X-09 FAIL: business_publish_rsvp_draft no longer refuses a chip-in publish without collection';
  END IF;
  SELECT string_agg(prosrc, ' ') INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'biz_update_live_rsvp';
  IF v_src IS NULL OR position('pg_brand_can_collect' IN v_src) = 0
     OR position('stripe_charges_disabled' IN v_src) = 0 THEN
    RAISE EXCEPTION 'X-09 FAIL: biz_update_live_rsvp no longer refuses chip-ins without collection';
  END IF;
  IF has_function_privilege('anon', 'public.business_update_rsvp_graph(uuid, jsonb, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'X-09 FAIL: anon can execute the RSVP save';
  END IF;
  RAISE NOTICE 'X-09 PASS: only the draft save stopped asking; publish and live edit still refuse';
END $x09$;
