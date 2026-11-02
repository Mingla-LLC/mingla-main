-- Issue #3355 P7 — Ari's event drafts save only facts the owner gave
-- (implementor happy path + edges) for migration
-- 20280229003355_issue_3355_event_seed_truth.sql.
--
--   * An Ari draft with the owner's end time, time zone and picked place is
--     saved exactly: end = the owner's end (no two-hour default), the time
--     zone as given, address + city + coordinates, "show the address only to
--     ticket holders", no ticket, visibility not private, one record.
--   * No end time → 'event_end_required' and nothing is saved.
--   * No time zone → 'event_timezone_required' (no UTC default).
--   * Private while private access is frozen → 'private_access_not_ready'.
--   * Moving a draft's start without an end → 'event_end_required' (the end
--     is never reset to start + 2 hours).
--   * update_event saves canonical party types and refuses an unknown one.
--   * ari_private_visibility_allowed is service-role only.
--
-- FAILS-ON-REVERT: restore the previous ari_execute_event_operation (the
-- COALESCE(end_at, start + 2 hours) / COALESCE(timezone,'UTC') lines) and the
-- "no end time" and "no time zone" blocks below raise.
-- Every row is synthetic and rolled back.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355est$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000007a1';
  v_brand uuid := '33550000-0000-4000-8000-0000000007b1';
  v_op uuid;
  v_args jsonb;
  v_result jsonb;
  v_event public.events%ROWTYPE;
  v_draft jsonb;
  v_start timestamptz := date_trunc('day', now()) + interval '9 days 19 hours';
  v_end timestamptz := date_trunc('day', now()) + interval '9 days 22 hours 30 minutes';
  v_failed boolean;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'owner-3355est@example.invalid');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code,city)
  VALUES (v_brand,v_owner,'Lantern Supper Club','lantern-3355est','GBP','GB','London');

  -- The wrapper is service-role only and reads the frozen #1931 state.
  IF has_function_privilege('authenticated','public.ari_private_visibility_allowed()','EXECUTE')
     OR has_function_privilege('anon','public.ari_private_visibility_allowed()','EXECUTE') THEN
    RAISE EXCEPTION 'ari_private_visibility_allowed must be service-role only';
  END IF;
  IF NOT has_function_privilege('service_role','public.ari_private_visibility_allowed()','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must be able to read ari_private_visibility_allowed';
  END IF;
  IF public.ari_private_visibility_allowed() IS DISTINCT FROM
     COALESCE(public.issue_1931_private_event_access_ready(), false) THEN
    RAISE EXCEPTION 'ari_private_visibility_allowed must mirror issue_1931_private_event_access_ready';
  END IF;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  -- ── Happy path: exactly the owner's facts ────────────────────────────────
  v_op := '33550000-0000-4000-8000-0000000007e1';
  v_args := jsonb_build_object(
    'brand_id',v_brand,'title','Lantern Supper','when_mode','single',
    'start_at',v_start,'end_at',v_end,'timezone','Europe/London',
    'visibility','public','format','in_person',
    'location_text','Shoreditch Town Hall',
    'location_address','380 Old Street, London EC1V 9LT',
    'city','London','location_lat',51.5265,'location_lng',-0.0806,
    'location_precision','exact','hide_address_until_ticket',true);
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());
  v_result := public.ari_execute_event_operation(v_op,'create_event',v_args);
  SELECT * INTO v_event FROM public.events WHERE id=(v_result#>>'{event,id}')::uuid;
  v_draft := v_event.theme->'business_draft';
  IF v_event.status <> 'draft' OR v_event.title <> 'Lantern Supper'
     OR v_event.timezone <> 'Europe/London' THEN
    RAISE EXCEPTION 'happy: wrong draft % % %', v_event.status, v_event.title, v_event.timezone;
  END IF;
  IF v_draft#>>'{when,doorsOpen}' <> to_char(v_start AT TIME ZONE 'Europe/London','HH24:MI')
     OR v_draft#>>'{when,endsAt}' <> to_char(v_end AT TIME ZONE 'Europe/London','HH24:MI') THEN
    RAISE EXCEPTION 'happy: the saved times are not the owner''s (%)', v_draft->'when';
  END IF;
  IF v_draft#>>'{when,endsAt}' = to_char((v_start + interval '2 hours') AT TIME ZONE 'Europe/London','HH24:MI') THEN
    RAISE EXCEPTION 'happy: the end is a two-hour default';
  END IF;
  IF v_event.city <> 'London' OR v_event.location_geo IS NULL
     OR v_draft#>>'{location,address}' <> '380 Old Street, London EC1V 9LT'
     OR v_draft#>>'{location,venueName}' <> 'Shoreditch Town Hall'
     OR (v_draft->>'hideAddressUntilTicket')::boolean IS DISTINCT FROM true
     OR (v_draft#>>'{locationGeo,lat}')::numeric <> 51.5265
     OR v_draft->>'coordinatePrecision' <> 'exact'
     OR v_event.location_text <> 'Shoreditch Town Hall · 380 Old Street, London EC1V 9LT' THEN
    RAISE EXCEPTION 'happy: the picked place was not saved exactly (% / % / %)',
      v_event.city, v_draft->'location', v_event.location_text;
  END IF;
  IF jsonb_array_length(COALESCE(v_draft->'tickets','[]'::jsonb)) <> 0
     OR EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id=v_event.id) THEN
    RAISE EXCEPTION 'happy: a ticket was created that the owner never asked for';
  END IF;
  IF v_draft->>'requestedVisibility' = 'private' OR v_event.visibility = 'private' THEN
    RAISE EXCEPTION 'happy: an Ari draft must never be private while frozen';
  END IF;
  SELECT count(*) INTO v_count FROM public.events
  WHERE brand_id=v_brand AND lower(title)='lantern supper' AND deleted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'happy: expected exactly one record, got %', v_count; END IF;
  -- A retried confirm replays; it never makes a second record.
  v_result := public.ari_execute_event_operation(v_op,'create_event',v_args);
  SELECT count(*) INTO v_count FROM public.events
  WHERE brand_id=v_brand AND lower(title)='lantern supper' AND deleted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'happy: a replay made a second record (%)', v_count; END IF;

  -- ── No end time: refused, nothing saved (no start + 2 hours) ─────────────
  v_op := '33550000-0000-4000-8000-0000000007e2';
  v_args := (v_args - 'end_at') || jsonb_build_object('title','No End Supper');
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_event_operation(v_op,'create_event',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%event_end_required%';
    IF NOT v_failed THEN RAISE EXCEPTION 'no end: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'no end: an Ari draft was saved without the owner''s end time'; END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE brand_id=v_brand AND title='No End Supper') THEN
    RAISE EXCEPTION 'no end: a draft was saved';
  END IF;

  -- ── No time zone: refused (no UTC default) ───────────────────────────────
  v_op := '33550000-0000-4000-8000-0000000007e3';
  v_args := (v_args - 'timezone') || jsonb_build_object('end_at',v_end,'title','No Zone Supper');
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_event_operation(v_op,'create_event',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%event_timezone_required%';
    IF NOT v_failed THEN RAISE EXCEPTION 'no zone: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'no zone: an Ari draft was saved in a default time zone'; END IF;

  -- ── Private while frozen: refused ────────────────────────────────────────
  IF NOT public.ari_private_visibility_allowed() THEN
    v_op := '33550000-0000-4000-8000-0000000007e4';
    v_args := v_args || jsonb_build_object('timezone','Europe/London',
      'visibility','private','title','Private Supper');
    INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
      related_brand_id,server_proposed_at,execution_attested_at)
    VALUES (v_op,v_owner,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());
    v_failed := false;
    BEGIN
      PERFORM public.ari_execute_event_operation(v_op,'create_event',v_args);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM LIKE '%private_access_not_ready%';
      IF NOT v_failed THEN RAISE EXCEPTION 'private: refused for the wrong reason: %', SQLERRM; END IF;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'private: an Ari draft was saved Private while frozen'; END IF;
  END IF;

  -- ── Draft update: moving the start needs the end; party types saved ──────
  v_op := '33550000-0000-4000-8000-0000000007e5';
  v_args := jsonb_build_object('event_id',v_event.id,'start_at',v_start + interval '1 hour',
    'client_revision',1);
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,related_event_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'update_event',v_args,'executing','hub_experience',v_brand,v_event.id,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_event_operation(v_op,'update_event',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%event_end_required%';
    IF NOT v_failed THEN RAISE EXCEPTION 'update: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'update: a draft start moved and the end was reset by default'; END IF;

  v_op := '33550000-0000-4000-8000-0000000007e6';
  v_args := jsonb_build_object('event_id',v_event.id,
    'party_types',jsonb_build_array('themed-party'),
    'description','A candlelit supper with live strings.','client_revision',1);
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,related_event_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'update_event',v_args,'executing','hub_experience',v_brand,v_event.id,now(),now());
  PERFORM public.ari_execute_event_operation(v_op,'update_event',v_args);
  SELECT * INTO v_event FROM public.events WHERE id=v_event.id;
  IF v_event.party_types <> ARRAY['themed-party']::text[]
     OR v_event.theme#>'{business_draft,partyTypes}' <> '["themed-party"]'::jsonb
     OR v_event.description <> 'A candlelit supper with live strings.' THEN
    RAISE EXCEPTION 'update: party types / description not saved (% / %)',
      v_event.party_types, v_event.theme#>'{business_draft,partyTypes}';
  END IF;
  -- The place survives the update untouched.
  IF v_event.city <> 'London' OR v_event.theme#>>'{business_draft,location,address}' IS NULL THEN
    RAISE EXCEPTION 'update: the picked place was lost';
  END IF;

  v_op := '33550000-0000-4000-8000-0000000007e7';
  v_args := jsonb_build_object('event_id',v_event.id,
    'party_types',jsonb_build_array('secret-party'),'client_revision',2);
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,related_event_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'update_event',v_args,'executing','hub_experience',v_brand,v_event.id,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_event_operation(v_op,'update_event',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%party_types_not_canonical%';
    IF NOT v_failed THEN RAISE EXCEPTION 'party: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'party: an unknown party type was saved'; END IF;
END;
$i3355est$;

ROLLBACK;

\echo 'issue #3355 P7 event seed truth PASS'
