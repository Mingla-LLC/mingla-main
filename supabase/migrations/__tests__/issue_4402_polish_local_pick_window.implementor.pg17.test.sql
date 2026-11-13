\set ON_ERROR_STOP on

-- #4402 polish PR, migration M3 (20280704204402): the Mingla Local pick
-- window (D5). Start of month, a new seat's 7 days from seat_started_on, and
-- an Admin-opened window with a reason kept in History. Everything rolls back.
--
-- MINGLA-INVARIANT: I-4402-LOCAL-1 | issue #4402 | a Local pick is accepted only while issue_4402_local_pick_window().open

BEGIN;
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44020300-0000-4000-8000-0000000000a1','i4402l-local@mingla.test'),
  ('44020300-0000-4000-8000-0000000000a2','i4402l-admin@mingla.test'),
  ('44020300-0000-4000-8000-0000000000a4','i4402l-late@mingla.test');
INSERT INTO public.admin_users(email,status) VALUES('i4402l-admin@mingla.test','active');
INSERT INTO public.profiles(id,display_name) VALUES
  ('44020300-0000-4000-8000-0000000000a1','New Seat Local'),('44020300-0000-4000-8000-0000000000a4','Late Local') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.seeding_cities(id,google_place_id,name,country,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng)
VALUES('44020300-0000-4000-8000-0000000000c1','i4402l-city','Lagos Window','NG',6.5,3.4,6.4,3.3,6.6,3.5);
INSERT INTO public.place_pool(id,name,lat,lng,city_id,is_active,is_servable) VALUES
  ('44020300-0000-4000-8000-0000000000d1','Window Cafe',6.5,3.4,'44020300-0000-4000-8000-0000000000c1',true,true),
  ('44020300-0000-4000-8000-0000000000d2','Late Cafe',6.5,3.4,'44020300-0000-4000-8000-0000000000c1',true,true);
-- New seat: started today. Late seat: started 20 days ago.
INSERT INTO public.locals(id,user_id,city_id,status,agreement_version,seat_started_on) VALUES
  ('44020300-0000-4000-8000-000000000101','44020300-0000-4000-8000-0000000000a1','44020300-0000-4000-8000-0000000000c1','active','local-v1',current_date),
  ('44020300-0000-4000-8000-000000000104','44020300-0000-4000-8000-0000000000a4','44020300-0000-4000-8000-0000000000c1','active','local-v1',current_date-20);
-- Triggers stay off for this suite (see the note in the DO block).
INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('mingla_locals_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;

DO $test$
DECLARE
  v_local constant uuid := '44020300-0000-4000-8000-000000000101';
  v_late constant uuid := '44020300-0000-4000-8000-000000000104';
  v_admin constant uuid := '44020300-0000-4000-8000-0000000000a2';
  v_seat date := DATE '2026-11-12';
  v_w jsonb; v_r jsonb; v_failed boolean; v_row jsonb;
BEGIN
  -- The agreement-signature trigger on local_months is not what this suite
  -- proves (the walkthrough suites do); the window gate runs inside
  -- local_pick_place before the insert either way.
  -- Precedence, on fixed dates (a seat started on the 12th, as in production).
  UPDATE public.locals SET seat_started_on = v_seat WHERE id = v_late;
  v_w := public.issue_4402_local_pick_window(v_late, TIMESTAMPTZ '2026-11-03 10:00Z');
  IF v_w->>'reason' <> 'month_start' OR (v_w->>'open')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T-M3 day<=7: %', v_w; END IF;
  v_w := public.issue_4402_local_pick_window(v_late, TIMESTAMPTZ '2026-11-12 00:30Z');
  IF v_w->>'reason' <> 'new_seat' OR (v_w->>'open_until')::timestamptz <> TIMESTAMPTZ '2026-11-19 00:00Z' THEN RAISE EXCEPTION 'T-M3 day 0: %', v_w; END IF;
  v_w := public.issue_4402_local_pick_window(v_late, TIMESTAMPTZ '2026-11-18 23:59Z');
  IF (v_w->>'open')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T-M3 day 6 must be open: %', v_w; END IF;
  v_w := public.issue_4402_local_pick_window(v_late, TIMESTAMPTZ '2026-11-19 00:00Z');
  IF (v_w->>'open')::boolean IS NOT FALSE OR (v_w->>'opens_on')::date <> DATE '2026-12-01' THEN RAISE EXCEPTION 'T-M3 day 7 must be closed: %', v_w; END IF;
  -- A seat starting on the 5th: the new-seat week outlasts the month start, so it is reported.
  UPDATE public.locals SET seat_started_on = DATE '2026-11-05' WHERE id = v_late;
  v_w := public.issue_4402_local_pick_window(v_late, TIMESTAMPTZ '2026-11-06 09:00Z');
  IF v_w->>'reason' <> 'new_seat' OR (v_w->>'open_until')::timestamptz <> TIMESTAMPTZ '2026-11-12 00:00Z' THEN RAISE EXCEPTION 'T-M3 longest window: %', v_w; END IF;
  UPDATE public.locals SET seat_started_on = current_date - 20 WHERE id = v_late;

  -- The table is reachable only through the definer functions.
  IF has_table_privilege('authenticated', 'public.local_pick_window_overrides', 'SELECT')
     OR has_table_privilege('anon', 'public.local_pick_window_overrides', 'SELECT') THEN
    RAISE EXCEPTION 'T-M3 overrides table readable by clients';
  END IF;

  -- A new seat can pick today; local_home says so.
  PERFORM pg_temp.act('44020300-0000-4000-8000-0000000000a1');
  v_r := public.local_home();
  IF (v_r->'pick_window'->>'open')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T-M3 local_home pick_window: %', v_r->'pick_window'; END IF;
  v_r := public.local_pick_place('44020300-0000-4000-8000-0000000000d1', false);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M3 new seat pick: %', v_r; END IF;

  -- A seat 20 days in is closed after the 7th until Admin opens a window.
  PERFORM pg_temp.act('44020300-0000-4000-8000-0000000000a4');
  IF extract(day FROM current_date) > 7 THEN
    v_failed := false;
    BEGIN PERFORM public.local_pick_place('44020300-0000-4000-8000-0000000000d2', false);
    EXCEPTION WHEN others THEN v_failed := SQLERRM = 'pick_window_closed'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'T-M3 closed window accepted a pick'; END IF;
  END IF;
  v_failed := false;
  BEGIN PERFORM public.admin_local_open_pick_window(v_late, 'Joined late, giving a week.', 7);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'T-M3 a non-admin opened a window'; END IF;

  PERFORM pg_temp.act(v_admin);
  v_r := public.admin_local_open_pick_window(v_late, 'shrt', 7);
  IF v_r->>'error' IS DISTINCT FROM 'reason_required' THEN RAISE EXCEPTION 'T-M3 reason length: %', v_r; END IF;
  v_r := public.admin_local_open_pick_window(v_late, 'Joined late, giving a week.', 15);
  IF v_r->>'error' IS DISTINCT FROM 'days_invalid' THEN RAISE EXCEPTION 'T-M3 days: %', v_r; END IF;
  v_r := public.admin_local_open_pick_window(v_late, 'Joined late, giving a week.', 7);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M3 open: %', v_r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.local_events WHERE local_id = v_late AND kind = 'pick_window_opened' AND actor = 'admin'
                  AND data->>'reason' = 'Joined late, giving a week.' AND (data->>'admin_id')::uuid = v_admin) THEN
    RAISE EXCEPTION 'T-M3 History row missing';
  END IF;
  SELECT l INTO v_row FROM jsonb_array_elements(public.admin_local_queue()->'locals') l WHERE (l->>'local_id')::uuid = v_late;
  IF v_row->'window'->>'reason' <> 'admin' OR v_row->'pick' <> 'null'::jsonb
     OR v_row->'history'->0->>'kind' <> 'pick_window_opened' THEN
    RAISE EXCEPTION 'T-M3 admin_local_queue.locals: %', v_row;
  END IF;
  PERFORM pg_temp.act('44020300-0000-4000-8000-0000000000a4');
  v_r := public.local_pick_place('44020300-0000-4000-8000-0000000000d2', false);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M3 pick after override: %', v_r; END IF;
  -- An expired override no longer opens the window.
  UPDATE public.local_pick_window_overrides SET open_until = now() - interval '1 minute' WHERE local_id = v_late;
  IF extract(day FROM current_date) > 7 AND (public.issue_4402_local_pick_window(v_late)->>'open')::boolean THEN
    RAISE EXCEPTION 'T-M3 an expired override is still open';
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue #4402 polish M3 (Local pick window) passed'
