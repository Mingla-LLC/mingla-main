-- #4251 — fetch_user_going_rsvps returns cover_media_type on BOTH branches
-- (the caller's own RSVP and a plus-one row matched to them), appended after
-- every earlier column, with the ORCH-1392 self-scope gate and grants intact.
-- FAILS-ON-REVERT: without 20280319004251 the function has no cover_media_type
-- column, so the signature check and the row reads below raise.
\set ON_ERROR_STOP on
BEGIN;

DO $signature$
DECLARE
  v_oid oid := to_regprocedure('public.fetch_user_going_rsvps(uuid)');
  v_result text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'issue_4251: fetch_user_going_rsvps(uuid) is missing';
  END IF;
  SELECT pg_get_function_result(v_oid) INTO v_result;
  IF v_result <> 'TABLE(rsvp_id uuid, guest_id uuid, role text, qr_code text, '
       || 'rsvp_status text, approval_status text, plus_count integer, '
       || 'display_name text, invited_by text, event_id uuid, event_title text, '
       || 'event_slug text, cover_media_url text, timezone text, location_text text, '
       || 'is_online boolean, online_url text, brand_id uuid, brand_slug text, '
       || 'brand_name text, master_start_at timestamp with time zone, '
       || 'master_end_at timestamp with time zone, created_at timestamp with time zone, '
       || 'cover_media_type text)' THEN
    RAISE EXCEPTION 'issue_4251: columns must be the ORCH-1392 set plus cover_media_type last, got %', v_result;
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid)
     OR NOT (SELECT coalesce(p.proconfig, '{}') @> ARRAY['search_path=public'] FROM pg_proc p WHERE p.oid = v_oid)
     OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_oid) <> 's' THEN
    RAISE EXCEPTION 'issue_4251: security definer, STABLE or search_path drifted';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4251: grants drifted from ORCH-1392';
  END IF;
  IF position('auth.uid() IS DISTINCT FROM p_user_id' IN pg_get_functiondef(v_oid)) = 0 THEN
    RAISE EXCEPTION 'issue_4251: the self-scope gate is missing';
  END IF;
END;
$signature$;

DO $fixtures$
DECLARE
  v_owner uuid := '42510000-0000-4000-8000-000000000001';
  v_viewer uuid := '42510000-0000-4000-8000-000000000002';
  v_other uuid := '42510000-0000-4000-8000-000000000003';
  v_brand uuid := '42510000-0000-4000-8000-000000000011';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-4251-owner@example.test'),
    (v_viewer, 'issue-4251-viewer@example.test'),
    (v_other, 'issue-4251-other@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'Issue 4251 Brand', 'issue-4251-brand', 'USD');

  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, location_text, event_type,
    visibility, status, timezone, cover_media_url, cover_media_type
  ) VALUES
    ('42510000-0000-4000-8000-000000000021', v_brand, v_owner,
     'Issue 4251 Video Night', 'issue-4251-video', '61 Wythe Ave', 'rsvp',
     'public', 'scheduled', 'America/New_York',
     'https://vz-test.b-cdn.net/guid/play_720p.mp4', 'video'),
    ('42510000-0000-4000-8000-000000000022', v_brand, v_owner,
     'Issue 4251 No Cover', 'issue-4251-none', '61 Wythe Ave', 'rsvp',
     'public', 'scheduled', 'America/New_York', NULL, NULL),
    ('42510000-0000-4000-8000-000000000023', v_brand, v_owner,
     'Issue 4251 Gif Party', 'issue-4251-gif', '61 Wythe Ave', 'rsvp',
     'public', 'scheduled', 'America/New_York',
     'https://cdn.example.test/party.gif', 'gif');

  INSERT INTO public.event_dates(id, event_id, start_at, end_at, is_master) VALUES
    ('42510000-0000-4000-8000-000000000031', '42510000-0000-4000-8000-000000000021',
     now() + interval '3 days', now() + interval '3 days 4 hours', true),
    ('42510000-0000-4000-8000-000000000032', '42510000-0000-4000-8000-000000000022',
     now() + interval '4 days', now() + interval '4 days 4 hours', true),
    ('42510000-0000-4000-8000-000000000033', '42510000-0000-4000-8000-000000000023',
     now() + interval '5 days', now() + interval '5 days 4 hours', true);

  -- The viewer's own RSVPs (primary branch).
  INSERT INTO public.event_rsvps(
    id, event_id, user_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status, plus_count
  ) VALUES
    ('42510000-0000-4000-8000-000000000041', '42510000-0000-4000-8000-000000000021',
     v_viewer, 'Viewer', 'issue-4251-viewer@example.test', '+12025554251',
     'going', 'approved', 0),
    ('42510000-0000-4000-8000-000000000042', '42510000-0000-4000-8000-000000000022',
     v_viewer, 'Viewer', 'issue-4251-viewer@example.test', '+12025554251',
     'going', 'approved', 0),
  -- Someone else's RSVP that brings the viewer as a plus-one (guest branch).
    ('42510000-0000-4000-8000-000000000043', '42510000-0000-4000-8000-000000000023',
     v_other, 'Other', 'issue-4251-other@example.test', '+12025554252',
     'going', 'approved', 1);

  INSERT INTO public.event_rsvp_guests(id, rsvp_id, name, email, phone, matched_user_id)
  VALUES ('42510000-0000-4000-8000-000000000051', '42510000-0000-4000-8000-000000000043',
          'Viewer', 'issue-4251-viewer@example.test', '+12025554251', v_viewer);
END;
$fixtures$;

-- Read as the signed-in viewer through the real API role.
SELECT set_config('request.jwt.claims',
  '{"sub":"42510000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '42510000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

DO $reads$
DECLARE
  v_video text;
  v_none text;
  v_gif text;
  v_gif_role text;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.fetch_user_going_rsvps('42510000-0000-4000-8000-000000000002');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'issue_4251: expected 3 going rows, got %', v_count;
  END IF;

  SELECT r.cover_media_type INTO STRICT v_video
    FROM public.fetch_user_going_rsvps('42510000-0000-4000-8000-000000000002') r
   WHERE r.event_slug = 'issue-4251-video';
  SELECT r.cover_media_type INTO STRICT v_none
    FROM public.fetch_user_going_rsvps('42510000-0000-4000-8000-000000000002') r
   WHERE r.event_slug = 'issue-4251-none';
  SELECT r.cover_media_type, r.role INTO STRICT v_gif, v_gif_role
    FROM public.fetch_user_going_rsvps('42510000-0000-4000-8000-000000000002') r
   WHERE r.event_slug = 'issue-4251-gif';

  IF v_video IS DISTINCT FROM 'video' THEN
    RAISE EXCEPTION 'issue_4251: primary row lost its video type (%)', v_video;
  END IF;
  IF v_none IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4251: an event without a cover must return a NULL type (%)', v_none;
  END IF;
  IF v_gif IS DISTINCT FROM 'gif' OR v_gif_role <> 'guest' THEN
    RAISE EXCEPTION 'issue_4251: guest row lost its gif type (%, %)', v_gif, v_gif_role;
  END IF;

  -- The ORCH-1392 self-scope gate still refuses another user's id.
  BEGIN
    PERFORM 1 FROM public.fetch_user_going_rsvps('42510000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'issue_4251: the self-scope gate let a stranger read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$reads$;

RESET ROLE;

-- anon still cannot execute it.
SET LOCAL ROLE anon;
DO $anon$
BEGIN
  BEGIN
    PERFORM 1 FROM public.fetch_user_going_rsvps('42510000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'issue_4251: anon executed fetch_user_going_rsvps';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon$;
RESET ROLE;

ROLLBACK;
