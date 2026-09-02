-- #3047 — the RSVP publish / guest-status / Ari routines must be REACHABLE,
-- and must behave as their #1977 contract promises once they are.
--
-- Companion to `mingla-business/src/services/__tests__/
-- issue_3047_rsvp_rpc_deploy_reachable.test.ts`, which owns the
-- version-shadowing half (that a plain `supabase db push` can reach these
-- definitions at all). This file owns the runtime contract.
--
-- READ THIS BEFORE TRUSTING A GREEN RUN. This lane builds its database from
-- EVERY migration file in sort order, so the version-shadowed
-- `20270530001977` definitions are present here whether or not #3047 exists.
-- #1977's own suite calls `business_set_rsvp_guest_status` directly and is
-- green — while production has none of these functions. A behaviour-only
-- assertion in this lane STRUCTURALLY cannot see the bug this issue is about.
-- That is why T-3047-01 asserts a marker only the reachable publish sets: it is
-- the one assertion here that goes red when the #3047 migration is deleted.
--
-- Angles #1977's own test does NOT carry:
--   * T-3047-00 the privilege shape for all seven, asserted individually.
--   * T-3047-01 the #3047 reachability marker — the fails-on-revert anchor.
--   * T-3047-02 a full create → PUBLISH round trip, which is the exact flow that
--     404'd on a real device: the draft must leave status='draft' and stop
--     carrying a `draft-` placeholder slug.
--   * T-3047-03 publish replay on the same p_client_request_id.
--   * T-3047-04 publish's dependency chain — issue_1977_current_rsvp_publish_payload
--     must be present and callable, or publish 42883s at run time instead of
--     404-ing at the gateway. Shipping publish without it would move the failure,
--     not fix it.
--   * T-3047-05 RLS negative on BOTH publish and guest-status: a stranger with no
--     standing on the brand gets 42501 and changes nothing.
--   * T-3047-06 approve/deny actually moves a guest, and the roster + contribution
--     listers answer for the owner.
--   * T-3047-07 ari_execute_rsvp_operation is reachable and rejects a tool name
--     outside its allowlist.
--
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- T-3047-00 — all seven exist with the exact #1977 signatures, are closed to
-- anon, and the five with client callers are executable by authenticated.
--
-- NOTE ON THE TWO HELPERS. `issue_1977_current_rsvp_publish_payload` and
-- `issue_1977_agent_rsvp_payload` are REVOKEd and never GRANTed by #1977, and
-- #3047 copies that exactly. They nonetheless end up executable by
-- `authenticated` — not from any GRANT in either file, but from this project's
-- `ALTER DEFAULT PRIVILEGES`, the same inheritance trap that gives every new
-- public object client grants for free. That is safe here and deliberately not
-- "tidied": the payload helper is SECURITY DEFINER but performs its own
-- event_manager rank check before returning anything, and the agent helper is a
-- pure IMMUTABLE jsonb shaper that touches no table. Diverging from #1977's
-- declared grants would make this migration a competing owner, which is the one
-- thing this whole rescue pattern exists to avoid. anon is the real boundary and
-- it is asserted closed for all seven.
-- ---------------------------------------------------------------------------
DO $catalog$
DECLARE v_target text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'public.business_publish_rsvp_graph(uuid,uuid)',
    'public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid)',
    'public.ari_execute_rsvp_operation(uuid,text,jsonb)',
    'public.business_list_rsvp_roster(uuid,text,jsonb,integer)',
    'public.business_list_rsvp_contributions(uuid,text,jsonb,integer)',
    'public.issue_1977_agent_rsvp_payload(jsonb)',
    'public.issue_1977_current_rsvp_publish_payload(uuid)'
  ] LOOP
    IF to_regprocedure(v_target) IS NULL THEN
      RAISE EXCEPTION 'T-3047-00 FAIL: % is not defined', v_target;
    END IF;
    IF has_function_privilege('anon', v_target, 'EXECUTE') THEN
      RAISE EXCEPTION 'T-3047-00 FAIL: anon can execute %', v_target;
    END IF;
  END LOOP;

  FOREACH v_target IN ARRAY ARRAY[
    'public.business_publish_rsvp_graph(uuid,uuid)',
    'public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid)',
    'public.ari_execute_rsvp_operation(uuid,text,jsonb)',
    'public.business_list_rsvp_roster(uuid,text,jsonb,integer)',
    'public.business_list_rsvp_contributions(uuid,text,jsonb,integer)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', v_target, 'EXECUTE') THEN
      RAISE EXCEPTION 'T-3047-00 FAIL: authenticated cannot execute %', v_target;
    END IF;
    IF NOT has_function_privilege('service_role', v_target, 'EXECUTE') THEN
      RAISE EXCEPTION 'T-3047-00 FAIL: service_role cannot execute %', v_target;
    END IF;
  END LOOP;

  -- The five write/read owners run as SECURITY DEFINER so their own rank checks
  -- are the gate. issue_1977_agent_rsvp_payload deliberately does NOT (it is a
  -- pure shaper) and is excluded here rather than silently accepted.
  FOREACH v_target IN ARRAY ARRAY[
    'public.business_publish_rsvp_graph(uuid,uuid)',
    'public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid)',
    'public.ari_execute_rsvp_operation(uuid,text,jsonb)',
    'public.business_list_rsvp_roster(uuid,text,jsonb,integer)',
    'public.business_list_rsvp_contributions(uuid,text,jsonb,integer)',
    'public.issue_1977_current_rsvp_publish_payload(uuid)'
  ] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(v_target)) THEN
      RAISE EXCEPTION 'T-3047-00 FAIL: % is not SECURITY DEFINER', v_target;
    END IF;
  END LOOP;
END;
$catalog$;

-- ---------------------------------------------------------------------------
-- T-3047-01 — the #3047 reachability marker. THE fails-on-revert anchor.
--
-- 20270530001977 sets no function comments at all, so this marker exists only
-- on the db-push-reachable publish. Delete 20270616003047 and this block fails
-- even though every behavioural assertion below would still pass — which is the
-- entire bug class in one error message.
-- ---------------------------------------------------------------------------
DO $marker$
DECLARE v_target text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'public.business_publish_rsvp_graph(uuid,uuid)',
    'public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid)',
    'public.ari_execute_rsvp_operation(uuid,text,jsonb)',
    'public.business_list_rsvp_roster(uuid,text,jsonb,integer)',
    'public.business_list_rsvp_contributions(uuid,text,jsonb,integer)',
    'public.issue_1977_agent_rsvp_payload(jsonb)',
    'public.issue_1977_current_rsvp_publish_payload(uuid)'
  ] LOOP
    IF COALESCE(obj_description(to_regprocedure(v_target), 'pg_proc'), '') NOT LIKE '%#3047 db-push-reachable%' THEN
      RAISE EXCEPTION
        'T-3047-01 FAIL: % carries no #3047 reachability marker — the only definition present is the version-shadowed 20270530001977 one, which `supabase db push` cannot apply, so production would still 404 on it',
        v_target;
    END IF;
  END LOOP;
END;
$marker$;

-- ---------------------------------------------------------------------------
-- Fixtures. The owner administers the brand; the stranger has no standing.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email) VALUES
  ('30470000-0000-4000-8000-000000000001','owner-3047@example.test'),
  ('30470000-0000-4000-8000-000000000002','stranger-3047@example.test'),
  ('30470000-0000-4000-8000-000000000003','guest-3047@example.test');
INSERT INTO public.creator_accounts(id)
VALUES('30470000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('30470000-0000-4000-8000-000000000010','30470000-0000-4000-8000-000000000001',
  'Issue 3047 Brand','issue-3047-brand','GBP',now(),now());

-- The payload draftToServerInsert emits for a promoted RSVP draft: top-level
-- snake_case event columns plus the nested theme.business_draft block. Not
-- hand-flattened — this is the shipped client contract.
CREATE OR REPLACE FUNCTION pg_temp.issue_3047_client_insert_payload()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'brand_id','30470000-0000-4000-8000-000000000010',
    'created_by','30470000-0000-4000-8000-000000000001',
    'title','Issue 3047 RSVP',
    'slug','draft-issue-3047',
    'description',NULL,
    'location_text','Somewhere real',
    'online_url',NULL,
    'cover_media_url',NULL,
    'cover_media_poster_url',NULL,
    'cover_media_type',NULL,
    'cover_media_gallery','[]'::jsonb,
    'currency','GBP',
    'is_online',false,
    'is_recurring',false,
    'is_multi_date',false,
    'recurrence_rules',NULL,
    'visibility','draft',
    'status','draft',
    'timezone','Europe/London',
    'theme',jsonb_build_object(
      'coverHue',210,
      'business_draft',jsonb_build_object(
        'schemaVersion',12,
        'legacyLocalDraftId',NULL,
        'format','in_person',
        -- business_publish_rsvp_draft gates on a non-empty CANONICAL partyTypes
        -- (steering #2); vibeTags/musicGenres must also be canonical when set.
        'partyTypes',jsonb_build_array('house-party'),
        'vibeTags',jsonb_build_array('chill'),
        'musicGenres',jsonb_build_array('afrobeats'),
        'city',NULL,
        'locationGeo',NULL,
        'requestedVisibility','private',
        'currency','GBP',
        'whenMode','single',
        -- Single-date only (steering #4). A date is REQUIRED to publish; keep it
        -- future-relative so this fixture never rots into offering_date_past.
        'when',jsonb_build_object(
          'date',to_char((now() + interval '30 days')::date,'YYYY-MM-DD'),
          'doorsOpen','19:00','endsAt','23:00','timezone','Europe/London'),
        'location',jsonb_build_object('venueName',NULL,'address','Somewhere real'),
        'tickets','[]'::jsonb,
        'settings',jsonb_build_object(
          'requireApproval',true,'allowTransfers',false,'hideRemainingCount',false,
          'passwordProtected',false,'privateGuestList',false,'inPersonPaymentsEnabled',false),
        'isRsvp',true,
        'rsvpCapacity',NULL,
        'rsvpAllowPlusOnes',false,
        'rsvpPlusOnesMax',0,
        'rsvpWaitlistEnabled',false,
        'rsvpApprovalMode','manual',
        'rsvpDiscoverable',false,
        'rsvpContributionEnabled',false,
        'rsvpContributionSuggestedCents',NULL,
        'rsvpContributionMinCents',NULL,
        'lastStepReached',5,
        'clientRevision',3
      )
    )
  )
$payload$;

-- ---------------------------------------------------------------------------
-- T-3047-02 / 03 / 04 — the flow this issue was opened on. Create a draft, then
-- PUBLISH it through business_publish_rsvp_graph, exactly as
-- rsvpEvents.publishRsvpDraft does. On production today the publish call is a
-- 404 and the row stays status='draft' — the two things asserted here.
-- ---------------------------------------------------------------------------
DO $publish$
DECLARE v_create jsonb; v_payload jsonb; v_published jsonb; v_replay jsonb;
  v_event uuid; v_row public.events%ROWTYPE;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30470000-0000-4000-8000-000000000001',true);

  v_create := public.business_create_rsvp_draft_graph(
    '30470000-0000-4000-8000-000000000010',
    pg_temp.issue_3047_client_insert_payload(),
    '30470000-0000-4000-8000-0000000000a1');
  v_event := (v_create->'event'->>'id')::uuid;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: fixture draft was not created: %', v_create;
  END IF;

  -- T-3047-04 — publish's hard dependency. If this is absent, publish raises
  -- 42883 from inside its own body rather than 404-ing at the gateway: the
  -- failure moves, it does not go away. It MUST ship in the same file.
  v_payload := public.issue_1977_current_rsvp_publish_payload(v_event);
  IF v_payload IS NULL OR (v_payload->>'title') <> 'Issue 3047 RSVP' THEN
    RAISE EXCEPTION 'T-3047-04 FAIL: publish payload helper did not project the draft: %', v_payload;
  END IF;

  -- T-3047-02 — the publish itself.
  v_published := public.business_publish_rsvp_graph(
    v_event, '30470000-0000-4000-8000-0000000000b1');

  -- publishRsvpDraft reads response.event AND response.brand.id, and rejects a
  -- slug still starting with 'draft-'. Assert the shape it actually consumes.
  IF NOT (v_published ? 'event' AND v_published ? 'brand') THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: publish return is not the graph publishRsvpDraft consumes: %', v_published;
  END IF;
  IF (v_published->'brand'->>'id') <> '30470000-0000-4000-8000-000000000010' THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: publish graph carries the wrong brand: %', v_published->'brand';
  END IF;
  IF (v_published->'event'->>'slug') LIKE 'draft-%' THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: publish returned a draft placeholder slug (%), which the client throws on',
      v_published->'event'->>'slug';
  END IF;
  IF v_published->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: first publish reported replayed=true';
  END IF;

  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  -- The exact assertion the issue made against production, where the row was
  -- still status='draft' 2.5 minutes after the attempt.
  IF v_row.status = 'draft' THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: the row is still status=draft after publish — this is the production symptom';
  END IF;
  IF v_row.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'T-3047-02 FAIL: publish lost the rsvp discriminator (event_type=%)', v_row.event_type;
  END IF;

  -- T-3047-03 — replay on the same p_client_request_id is idempotent.
  v_replay := public.business_publish_rsvp_graph(
    v_event, '30470000-0000-4000-8000-0000000000b1');
  IF v_replay->>'replayed' <> 'true'
     OR (v_replay->'event'->>'id')::uuid <> v_event THEN
    RAISE EXCEPTION 'T-3047-03 FAIL: publish replay was not idempotent: %', v_replay;
  END IF;
END;
$publish$;

-- ---------------------------------------------------------------------------
-- T-3047-05 — RLS negative. A stranger must not publish, must not set a guest's
-- status, and must not read the roster or the contributions.
-- ---------------------------------------------------------------------------
DO $stranger$
DECLARE v_event uuid; v_status text; v_blocked int := 0; v_call text;
BEGIN
  SELECT id INTO v_event FROM public.events
   WHERE brand_id='30470000-0000-4000-8000-000000000010' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub','30470000-0000-4000-8000-000000000002',true);

  BEGIN
    PERFORM public.business_publish_rsvp_graph(v_event,'30470000-0000-4000-8000-0000000000c1');
    RAISE EXCEPTION 'T-3047-05 FAIL: a stranger published someone else''s RSVP';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    PERFORM public.business_set_rsvp_guest_status(
      v_event,'approve','all_pending',NULL,NULL,'30470000-0000-4000-8000-0000000000c2');
    RAISE EXCEPTION 'T-3047-05 FAIL: a stranger set a guest status on someone else''s RSVP';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    PERFORM public.business_list_rsvp_roster(v_event,NULL,NULL,50);
    RAISE EXCEPTION 'T-3047-05 FAIL: a stranger read someone else''s roster';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  BEGIN
    PERFORM public.business_list_rsvp_contributions(v_event,NULL,NULL,50);
    RAISE EXCEPTION 'T-3047-05 FAIL: a stranger read someone else''s contributions';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := v_blocked + 1;
  END;

  -- A zero needs its denominator: prove all four calls were actually made and
  -- each one raised, rather than the block having silently examined nothing.
  IF v_blocked <> 4 THEN
    RAISE EXCEPTION 'T-3047-05 FAIL: expected 4 refusals, counted %', v_blocked;
  END IF;
  v_call := NULL;

  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status = 'draft' THEN
    RAISE EXCEPTION 'T-3047-05 FAIL: the stranger''s refused publish still moved the row';
  END IF;
END;
$stranger$;

-- ---------------------------------------------------------------------------
-- T-3047-06 — approve actually moves a guest, and the listers answer for the
-- owner. This is the second live breakage in the issue: with the function
-- absent, an organiser can never approve or decline anybody.
-- ---------------------------------------------------------------------------
DO $guests$
DECLARE v_event uuid; v_rsvp uuid; v_result jsonb; v_roster jsonb; v_contribs jsonb; v_after text;
BEGIN
  SELECT id INTO v_event FROM public.events
   WHERE brand_id='30470000-0000-4000-8000-000000000010' LIMIT 1;

  INSERT INTO public.event_rsvps(event_id,user_id,guest_name,rsvp_status,approval_status,plus_count)
  VALUES(v_event,'30470000-0000-4000-8000-000000000003','Ada Guest','going','pending',0)
  RETURNING id INTO v_rsvp;

  PERFORM set_config('request.jwt.claim.sub','30470000-0000-4000-8000-000000000001',true);

  v_result := public.business_set_rsvp_guest_status(
    v_event,'approve','selected',ARRAY['rsvp:'||v_rsvp::text],NULL,
    '30470000-0000-4000-8000-0000000000d1');
  IF (v_result->>'appliedCount')::int <> 1 THEN
    RAISE EXCEPTION 'T-3047-06 FAIL: approve applied to % rows, expected 1: %',
      v_result->>'appliedCount', v_result;
  END IF;

  SELECT approval_status INTO v_after FROM public.event_rsvps WHERE id = v_rsvp;
  IF v_after <> 'approved' THEN
    RAISE EXCEPTION 'T-3047-06 FAIL: the guest is still %, approve did not persist', v_after;
  END IF;

  -- Idempotent on the same request id, like every other #1977 write.
  v_result := public.business_set_rsvp_guest_status(
    v_event,'approve','selected',ARRAY['rsvp:'||v_rsvp::text],NULL,
    '30470000-0000-4000-8000-0000000000d1');
  IF v_result->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'T-3047-06 FAIL: guest-status replay was not idempotent: %', v_result;
  END IF;

  v_roster := public.business_list_rsvp_roster(v_event,NULL,NULL,50);
  IF jsonb_array_length(v_roster->'rows') <> 1
     OR (v_roster->'rows'->0->>'approvalStatus') <> 'approved' THEN
    RAISE EXCEPTION 'T-3047-06 FAIL: roster does not reflect the approval: %', v_roster;
  END IF;

  v_contribs := public.business_list_rsvp_contributions(v_event,NULL,NULL,50);
  IF NOT (v_contribs ? 'rows') THEN
    RAISE EXCEPTION 'T-3047-06 FAIL: contribution lister returned no rows key: %', v_contribs;
  END IF;
END;
$guests$;

-- ---------------------------------------------------------------------------
-- T-3047-07 — Ari's single RSVP entry point. Every agent RSVP action routes
-- through this function, so while it is absent Ari can do nothing with an RSVP.
-- Assert it is reachable AND that its tool allowlist still refuses an unknown
-- name (rather than falling through to a no-op CASE, which would let an agent
-- believe an unsupported operation had succeeded).
-- ---------------------------------------------------------------------------
DO $ari$
DECLARE v_raised boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30470000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.ari_execute_rsvp_operation(
      '30470000-0000-4000-8000-0000000000e1','delete_everything','{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%unsupported_rsvp_operation%' THEN
      RAISE EXCEPTION 'T-3047-07 FAIL: unknown tool name raised the wrong error: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T-3047-07 FAIL: ari_execute_rsvp_operation accepted a tool outside its allowlist';
  END IF;
END;
$ari$;

ROLLBACK;
