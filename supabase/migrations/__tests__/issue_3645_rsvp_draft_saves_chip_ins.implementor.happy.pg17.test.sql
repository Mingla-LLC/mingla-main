\set ON_ERROR_STOP on

-- Issue #3645 — implementor proof that an RSVP DRAFT saves with chip-ins on
-- before the brand can take payments, and that the stop is at Publish.
-- Run after the full migration chain on PostgreSQL 17.
--
-- BEFORE. The draft branch of `business_update_rsvp_graph` raised
-- `stripe_charges_disabled` whenever the merged draft had chip-ins on and the
-- brand could not collect; the wizard's autosave failed with a generic toast.
--
-- AFTER (20270824003645). The draft saves, amounts included. Publish is
-- untouched: the app's publish entry point still answers
-- `stripe_charges_disabled` for that draft and leaves it a draft. The host's
-- two ways out both work from the same draft: switch chip-ins off and publish
-- (no money is taken from any guest), or connect a bank and publish with them.
--
-- Every case executes the real functions with the payload shape the Business
-- client sends. Each case rolls back.

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

-- ─── H-01: a draft with chip-ins on saves, amounts and all ───────────────────
BEGIN;
DO $h01$
DECLARE
  f record;
  v_graph jsonb;
  v_draft jsonb;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('h01');
  v_graph := public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  v_draft := v_row.theme->'business_draft';
  IF (v_draft->>'rsvpContributionEnabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-01 FAIL: the saved draft does not have chip-ins on';
  END IF;
  IF (v_draft->>'rsvpContributionSuggestedCents')::integer IS DISTINCT FROM 1500
     OR (v_draft->>'rsvpContributionMinCents')::integer IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'H-01 FAIL: the chip-in amounts were not saved (% / %)',
      v_draft->>'rsvpContributionSuggestedCents', v_draft->>'rsvpContributionMinCents';
  END IF;
  IF v_row.status IS DISTINCT FROM 'draft' OR v_row.visibility IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'H-01 FAIL: saving chip-ins moved the RSVP to %/%', v_row.status, v_row.visibility;
  END IF;
  -- The draft columns that take money stay off until publish promotes them.
  IF COALESCE(v_row.rsvp_contribution_enabled, false) THEN
    RAISE EXCEPTION 'H-01 FAIL: a DRAFT save switched the live chip-in column on';
  END IF;
  IF (v_graph->>'replayed')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'H-01 FAIL: the save did not answer as a fresh write';
  END IF;
  RAISE NOTICE 'H-01 PASS: an RSVP draft saves with chip-ins on for a brand with no bank';
END $h01$;
ROLLBACK;

-- ─── H-02: the stop is at Publish, and nothing is lost ───────────────────────
BEGIN;
DO $h02$
DECLARE
  f record;
  v_refused boolean := false;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('h02');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);
  BEGIN
    -- rsvpEvents.publishRsvpDraft calls exactly this.
    PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%stripe_charges_disabled%' THEN
      RAISE EXCEPTION 'H-02 FAIL: chip-in publish refused with the wrong error: % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'H-02 FAIL: an RSVP with chip-ins on PUBLISHED for a brand that cannot collect';
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'H-02 FAIL: the refused publish left status %', v_row.status;
  END IF;
  IF (v_row.theme#>>'{business_draft,rsvpContributionEnabled}')::boolean IS DISTINCT FROM true
     OR (v_row.theme#>>'{business_draft,rsvpContributionSuggestedCents}')::integer IS DISTINCT FROM 1500 THEN
    RAISE EXCEPTION 'H-02 FAIL: the refused publish lost the saved chip-in settings';
  END IF;
  RAISE NOTICE 'H-02 PASS: publish is refused with stripe_charges_disabled and the draft is intact';
END $h02$;
ROLLBACK;

-- ─── H-03: "Publish without chip-ins for now" — off, then publish ────────────
BEGIN;
DO $h03$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('h03');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);
  -- The secondary button: contributions off on the draft, then publish.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(2, false, 1500, 500), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status IS NULL OR v_row.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'H-03 FAIL: the RSVP did not publish with chip-ins off, status=%', v_row.status;
  END IF;
  -- The footnote's promise: no money is taken from any guest.
  IF COALESCE(v_row.rsvp_contribution_enabled, false) THEN
    RAISE EXCEPTION 'H-03 FAIL: the published RSVP still takes chip-ins on a brand with no bank';
  END IF;
  RAISE NOTICE 'H-03 PASS: a no-bank brand publishes the RSVP with chip-ins off';
END $h03$;
ROLLBACK;

-- ─── H-04: "Connect bank, then publish" — the same draft publishes ───────────
BEGIN;
DO $h04$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.chip_in_fixture('h04');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.chip_in_payload(1, true, 1500, 500), NULL, NULL);

  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_issue3645_rsvp' WHERE id = f.v_brand;
  IF public.pg_brand_can_collect(f.v_brand) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-04 fixture FAIL: the brand still cannot collect';
  END IF;
  PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status IS NULL OR v_row.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'H-04 FAIL: the RSVP did not publish once the brand could collect, status=%', v_row.status;
  END IF;
  IF v_row.rsvp_contribution_enabled IS DISTINCT FROM true
     OR v_row.rsvp_contribution_suggested_cents IS DISTINCT FROM 1500
     OR v_row.rsvp_contribution_min_cents IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'H-04 FAIL: the published RSVP did not carry the saved chip-in settings';
  END IF;
  RAISE NOTICE 'H-04 PASS: the saved chip-in draft publishes unchanged once a bank is connected';
END $h04$;
ROLLBACK;
