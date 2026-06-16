-- ORCH-1150 [RSVP ticketless event] — SQL contract tests (T1 / T2 / T4 / T6).
--
-- Covers four of the six §9 fails-on-revert invariants for the RSVP migration
-- 20261004000000_orch_1150_rsvp_events.sql:
--   T1 = §9.1 I-PROPOSED-1150-RSVP-NO-TICKET-ROWS
--   T2 = §9.2 I-PROPOSED-1150-RSVP-OFF-DECK-UNLESS-DISCOVERABLE
--   T4 = §9.4 I-PROPOSED-1150-WAITLIST-AUTOPROMOTE-OLDEST (incl. the A2-NEW
--        host-remove approved->denied arm)
--   T6 = §9.6 I-PROPOSED-1150-LINK-GUEST-CONTACT-BOTH-REQUIRED
--
-- USAGE (this repo's SQL probe convention — hand-run against the linked remote
-- AFTER the orchestrator applies the migration; these tests are NOT run by the
-- implementor, they await the orchestrator's DB run):
--
--   cat supabase/migrations/__tests__/orch_1150_rsvp.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- Each block is wrapped in BEGIN; … ROLLBACK; so it leaves NO fixture rows.
-- RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL (non-zero exit in CI/scripts).

-- ===========================================================================
-- T1 (§9.1) — publishing an RSVP draft creates ZERO ticket_types rows.
-- Drives the real publish RPC business_publish_rsvp_draft on a draft row, then
-- asserts no non-deleted ticket_types exist. Reverting the "DELETE the ticket
-- INSERT loop" delta (or re-pointing RSVP at the event RPC) makes this FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_tcount int;
  v_payload jsonb;
BEGIN
  -- Brand owned by v_user (account_id) so biz_brand_effective_rank resolves
  -- owner rank for the publish RPC's event_manager gate.
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1150-t1-brand', 'ORCH1150 T1', 'USD', now(), now());

  -- A draft RSVP row (event_type='rsvp', status='draft') with a single future date.
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, created_at, updated_at,
    theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'House Party', 'house-party-t1',
    'Come through, it''s a vibe.', 'draft', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, now(), now(),
    -- The publish RPC reads taxonomy + rsvp host-control from theme->business_draft.
    jsonb_build_object('business_draft', jsonb_build_object(
      'partyTypes', jsonb_build_array('house-party'),
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false)));

  -- Impersonate the owner for auth.uid() inside the SECURITY DEFINER publish RPC.
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Publish payload — the RPC reads title/timezone/when from the TOP LEVEL of
  -- the payload (taxonomy + rsvp host-control come from theme->business_draft,
  -- seeded above) and re-materializes the single event_date.
  v_payload := jsonb_build_object(
    'title', 'House Party',
    'timezone', 'UTC',
    'when', jsonb_build_object(
      'date', to_char((now() + interval '7 day')::date, 'YYYY-MM-DD'),
      'doorsOpen', '19:00',
      'endsAt', '23:00'));

  PERFORM public.business_publish_rsvp_draft(v_event, v_payload, NULL);

  -- THE assertion: zero non-deleted ticket_types for the published RSVP.
  SELECT count(*) INTO v_tcount
  FROM public.ticket_types
  WHERE event_id = v_event AND deleted_at IS NULL;
  IF v_tcount <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: RSVP publish created % ticket_types (expected 0)', v_tcount;
  END IF;

  -- And the row is now a published RSVP.
  PERFORM 1 FROM public.events
   WHERE id = v_event AND event_type = 'rsvp' AND status IN ('scheduled','live');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T1 FAIL: RSVP row is not a published rsvp after publish';
  END IF;

  RAISE NOTICE 'T1 PASS: RSVP publish creates zero ticket_types + row is a published rsvp';
END$$;
ROLLBACK;

-- ===========================================================================
-- T2 (§9.2) — an RSVP appears in the discover RPC IFF rsvp_discoverable=true;
-- a ticketed event is unaffected. Reverting the discover-RPC widen (or the
-- rsvp_discoverable predicate) makes this FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_brand    uuid;
  v_disc     uuid := gen_random_uuid();  -- discoverable RSVP
  v_link     uuid := gen_random_uuid();  -- link-only RSVP (not discoverable)
  v_ticketed uuid := gen_random_uuid();  -- control ticketed event
  v_city     text := 'orch1150t2city';
  v_rows     jsonb;
  v_ids      uuid[];
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1150-t2-brand', 'ORCH1150 T2', 'USD', now(), now())
  RETURNING id INTO v_brand;

  -- Discoverable RSVP.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, rsvp_discoverable,
    published_at, created_at, updated_at)
  VALUES (v_disc, v_brand, 'rsvp', 'Discoverable RSVP', 'disc-rsvp-t2', 'd',
    'scheduled', 'public', 'USD', 'UTC', v_city, true, now(), now(), now());
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES (gen_random_uuid(), v_disc, now() + interval '5 day',
    now() + interval '5 day' + interval '2 hour', 'UTC', true);

  -- Link-only RSVP (rsvp_discoverable=false).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, rsvp_discoverable,
    published_at, created_at, updated_at)
  VALUES (v_link, v_brand, 'rsvp', 'Link RSVP', 'link-rsvp-t2', 'd',
    'scheduled', 'public', 'USD', 'UTC', v_city, false, now(), now(), now());
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES (gen_random_uuid(), v_link, now() + interval '5 day',
    now() + interval '5 day' + interval '2 hour', 'UTC', true);

  -- Ticketed control event (always eligible).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, published_at, created_at, updated_at)
  VALUES (v_ticketed, v_brand, 'event', 'Ticketed', 'ticketed-t2', 'd',
    'scheduled', 'public', 'USD', 'UTC', v_city, now(), now(), now());
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES (gen_random_uuid(), v_ticketed, now() + interval '5 day',
    now() + interval '5 day' + interval '2 hour', 'UTC', true);

  -- Call the widened discover RPC for the test city.
  v_rows := public.pg_discover_business_events(
    ARRAY[v_city], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 50);

  SELECT array_agg((elem->>'id')::uuid)
    INTO v_ids
    FROM jsonb_array_elements(v_rows) AS elem;

  IF NOT (v_disc = ANY(v_ids)) THEN
    RAISE EXCEPTION 'T2 FAIL: discoverable RSVP missing from discover feed';
  END IF;
  IF v_link = ANY(v_ids) THEN
    RAISE EXCEPTION 'T2 FAIL: link-only (non-discoverable) RSVP leaked into discover feed';
  END IF;
  IF NOT (v_ticketed = ANY(v_ids)) THEN
    RAISE EXCEPTION 'T2 FAIL: ticketed control event missing from discover feed (regression)';
  END IF;

  RAISE NOTICE 'T2 PASS: discoverable RSVP in feed, link-only out, ticketed unaffected';
END$$;
ROLLBACK;

-- ===========================================================================
-- T4 (§9.4) — waitlist auto-promote OLDEST, never exceeding the cap, including
-- the A2-NEW host-remove (approved->denied) arm that reuses the SAME drain
-- trigger. Reverting fn_rsvp_drain_on_capacity_freed (or its ORDER BY
-- waitlisted_at, or removing approved->denied from the spot-freeing condition)
-- makes this FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_brand   uuid;
  v_event   uuid := gen_random_uuid();
  v_g1      uuid := gen_random_uuid();  -- going+approved (occupies seat 1)
  v_g2      uuid := gen_random_uuid();  -- going+approved (occupies seat 2)
  v_w_old   uuid := gen_random_uuid();  -- OLDEST waitlisted
  v_w_new   uuid := gen_random_uuid();  -- newer waitlisted
  v_status  text;
  v_promoted timestamptz;
  v_confirmed int;
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1150-t4-brand', 'ORCH1150 T4', 'USD', now(), now())
  RETURNING id INTO v_brand;

  -- auto-mode RSVP, capacity = 2, waitlist on.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, rsvp_capacity, rsvp_waitlist_enabled,
    rsvp_approval_mode, published_at, created_at, updated_at)
  VALUES (v_event, v_brand, 'rsvp', 'Capped Party', 'capped-t4', 'd',
    'scheduled', 'public', 'USD', 'UTC', 2, true, 'auto', now(), now(), now());

  -- 2 going+approved fill the cap.
  INSERT INTO public.event_rsvps (id, event_id, user_id, guest_name, guest_email,
    guest_phone, rsvp_status, approval_status, plus_count, created_at)
  VALUES
    (v_g1, v_event, gen_random_uuid(), 'G1', NULL, NULL, 'going', 'approved', 0, now()),
    (v_g2, v_event, gen_random_uuid(), 'G2', NULL, NULL, 'going', 'approved', 0, now());

  -- 2 waitlisted with DISTINCT waitlisted_at (old < new).
  INSERT INTO public.event_rsvps (id, event_id, user_id, guest_name, guest_email,
    guest_phone, rsvp_status, approval_status, plus_count, waitlisted_at, created_at)
  VALUES
    (v_w_old, v_event, gen_random_uuid(), 'Wold', NULL, NULL, 'waitlisted', 'approved', 0,
      now() - interval '10 min', now() - interval '10 min'),
    (v_w_new, v_event, gen_random_uuid(), 'Wnew', NULL, NULL, 'waitlisted', 'approved', 0,
      now() - interval '1 min', now() - interval '1 min');

  -- ── Arm A: a going+approved flips to not_going → frees 1 seat → OLDEST promotes.
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_g1;

  SELECT rsvp_status, promoted_at INTO v_status, v_promoted
  FROM public.event_rsvps WHERE id = v_w_old;
  IF v_status <> 'going' OR v_promoted IS NULL THEN
    RAISE EXCEPTION 'T4 FAIL (arm A): oldest waitlisted did not promote to going (status=%, promoted=%)', v_status, v_promoted;
  END IF;

  SELECT rsvp_status INTO v_status FROM public.event_rsvps WHERE id = v_w_new;
  IF v_status <> 'waitlisted' THEN
    RAISE EXCEPTION 'T4 FAIL (arm A): newer waitlisted wrongly promoted (cap exceeded)';
  END IF;

  -- Never exceed the cap.
  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_confirmed
  FROM public.event_rsvps WHERE event_id = v_event
    AND rsvp_status = 'going' AND approval_status = 'approved';
  IF v_confirmed > 2 THEN
    RAISE EXCEPTION 'T4 FAIL (arm A): confirmed-attending % exceeds cap 2', v_confirmed;
  END IF;

  -- Exactly one promote-notify enqueued for the promoted guest.
  PERFORM 1 FROM public.rsvp_notifications
   WHERE rsvp_id = v_w_old AND template_key = 'rsvp_waitlist_promoted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T4 FAIL (arm A): no rsvp_waitlist_promoted notification enqueued for oldest';
  END IF;

  -- ── Arm B (A2-NEW host-remove): cap is full again (g2 + w_old). Remove an
  --    approved/Going guest via approved->denied → the SAME trigger promotes
  --    the next-oldest waitlisted (w_new). Proves host-remove reuses the drain.
  UPDATE public.event_rsvps SET approval_status = 'denied' WHERE id = v_g2;

  SELECT rsvp_status, promoted_at INTO v_status, v_promoted
  FROM public.event_rsvps WHERE id = v_w_new;
  IF v_status <> 'going' OR v_promoted IS NULL THEN
    RAISE EXCEPTION 'T4 FAIL (arm B host-remove): w_new did not promote on approved->denied (status=%)', v_status;
  END IF;

  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_confirmed
  FROM public.event_rsvps WHERE event_id = v_event
    AND rsvp_status = 'going' AND approval_status = 'approved';
  IF v_confirmed > 2 THEN
    RAISE EXCEPTION 'T4 FAIL (arm B): confirmed-attending % exceeds cap 2 after host-remove', v_confirmed;
  END IF;

  RAISE NOTICE 'T4 PASS: oldest-first auto-promote + host-remove(approved->denied) reuses the drain, cap never exceeded';
END$$;
ROLLBACK;

-- ===========================================================================
-- T6 (§9.6) — a LINK guest (user_id IS NULL) MUST carry BOTH guest_email AND
-- guest_phone; app-user rows (user_id NOT NULL) are exempt. The DB CHECK
-- event_rsvps_link_guest_contact_required is the last line of defense.
-- Reverting that CHECK makes this FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_brand uuid;
  v_event uuid := gen_random_uuid();
  v_ok    boolean;
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1150-t6-brand', 'ORCH1150 T6', 'USD', now(), now())
  RETURNING id INTO v_brand;

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, published_at, created_at, updated_at)
  VALUES (v_event, v_brand, 'rsvp', 'Contact Test', 'contact-t6', 'd',
    'scheduled', 'public', 'USD', 'UTC', now(), now(), now());

  -- (a) link guest with email but NO phone → REJECTED.
  v_ok := true;
  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, guest_name, guest_email, guest_phone)
    VALUES (v_event, NULL, 'NoPhone', 'a@b.com', NULL);
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'T6 FAIL: link guest with email but no phone was ACCEPTED (CHECK missing)';
  END IF;

  -- (b) link guest with phone but NO email → REJECTED.
  v_ok := true;
  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, guest_name, guest_email, guest_phone)
    VALUES (v_event, NULL, 'NoEmail', NULL, '+15551234567');
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'T6 FAIL: link guest with phone but no email was ACCEPTED (CHECK missing)';
  END IF;

  -- (c) link guest with BOTH email AND phone → ACCEPTED.
  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, guest_name, guest_email, guest_phone)
    VALUES (v_event, NULL, 'BothOK', 'both@b.com', '+15559876543');
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'T6 FAIL: link guest with BOTH email+phone was wrongly REJECTED';
  END;

  -- (d) app-user row (user_id NOT NULL) with NEITHER → ACCEPTED (exempt).
  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, guest_name, guest_email, guest_phone)
    VALUES (v_event, gen_random_uuid(), 'AppUser', NULL, NULL);
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'T6 FAIL: app-user row with no contact was wrongly REJECTED (exemption broken)';
  END;

  RAISE NOTICE 'T6 PASS: link guests require email AND phone; app-user rows exempt';
END$$;
ROLLBACK;
