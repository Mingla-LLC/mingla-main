-- #3355 tester (adversarial; committed by rework 1 with the 20280620 rename
-- and the global idle sweep added to the T1 census) — the Ari 100x migrations (20280620013355 ..
-- 20280620103355) attacked from angles the implementor suites do not take:
--
--   T1  ACL census: anon executes NONE of the 25 functions these migrations
--       create or replace; the service-only ones are not callable by a
--       signed-in host; every SECURITY DEFINER one pins search_path.
--   T2  ari_search_feature_guide treats the host's words as words: query
--       syntax, quotes, operators and stop-word-only text never raise a
--       tsquery error, staff-only entries never come back, and a host still
--       cannot read product_capabilities directly.
--   T3  Flow runs: resume is bound to the starter AND the chat (a teammate,
--       or the starter from another chat, is refused); the idle sweep for one
--       person never ends another person's run; a leased run is never expired.
--   T4  Time zone trigger: a country written in lower case with spaces still
--       fills its zone; a zone the host chose survives a country change; an
--       automatic zone is cleared when the brand moves to a multi-zone
--       country; an invalid zone can never be written.
--   T5  Memory: a note for a brand the caller is not in is refused on every
--       write path (remember, save, update), and forget never touches another
--       person's private note even inside the same brand.
--
-- MINGLA-INVARIANT: I-ARI-100X-ACL | issue #3355 | No function created by the #3355 Ari 100x migrations is executable by anon; service-only flow, gap-recording and digest functions are not executable by authenticated; every SECURITY DEFINER one has a fixed search_path.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-7e57-4000-8000-000000000001','t-owner@test.local','{"full_name":"Tola Owner"}'),
  ('33550000-7e57-4000-8000-000000000002','t-mate@test.local','{"full_name":"Bisi Mate"}'),
  ('33550000-7e57-4000-8000-000000000003','t-outsider@test.local','{"full_name":"Out Sider"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-7e57-4000-8000-000000000001','t-owner@test.local','Tola Owner','t3355_owner','business'),
  ('33550000-7e57-4000-8000-000000000002','t-mate@test.local','Bisi Mate','t3355_mate','business'),
  ('33550000-7e57-4000-8000-000000000003','t-outsider@test.local','Out Sider','t3355_outsider','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-7e57-4000-8000-000000000001','t-owner@test.local','Tola Owner','T Host'),
  ('33550000-7e57-4000-8000-000000000003','t-outsider@test.local','Out Sider','T Other');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('33550000-7e57-4000-8000-0000000000b1','33550000-7e57-4000-8000-000000000001','Tester Lagos','t3355-lagos'),
  ('33550000-7e57-4000-8000-0000000000b2','33550000-7e57-4000-8000-000000000003','Tester Elsewhere','t3355-elsewhere');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('33550000-7e57-4000-8000-0000000000b1','33550000-7e57-4000-8000-000000000002','brand_admin',now());
INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
  ('33550000-7e57-4000-8000-0000000000c1','33550000-7e57-4000-8000-000000000001','33550000-7e57-4000-8000-0000000000b1'),
  ('33550000-7e57-4000-8000-0000000000c2','33550000-7e57-4000-8000-000000000001','33550000-7e57-4000-8000-0000000000b1'),
  ('33550000-7e57-4000-8000-0000000000c3','33550000-7e57-4000-8000-000000000002','33550000-7e57-4000-8000-0000000000b1');

CREATE OR REPLACE FUNCTION pg_temp.t_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END;
$$;

-- ── T1 ACL census ──────────────────────────────────────────────────────────
DO $t1$
DECLARE
  v_all constant text[] := ARRAY[
    'ari_admin_capability_gap_events','ari_admin_gap_to_eval','ari_admin_quality_metrics',
    'ari_conversation_gap_signals','ari_feature_guide_document','ari_flow_run_advance',
    'ari_flow_run_expire_after','ari_flow_run_get','ari_flow_run_resume','ari_flow_run_start',
    'ari_flow_runs_expire_idle','ari_flow_runs_expire_idle_all','ari_gap_type_label','ari_gap_weekly_digest',
    'ari_memory_content_key','ari_memory_forget','ari_memory_list','ari_memory_save',
    'ari_memory_sensitive_reason','ari_memory_update','ari_record_turn_gaps','ari_remember_note',
    'ari_search_feature_guide','ari_tell_owner_in_brand_group','brand_single_zone_timezone',
    'brands_default_timezone_from_country'];
  v_service_only constant text[] := ARRAY[
    'ari_flow_run_advance','ari_flow_run_expire_after','ari_flow_run_get','ari_flow_run_resume',
    'ari_flow_run_start','ari_flow_runs_expire_idle','ari_flow_runs_expire_idle_all','ari_record_turn_gaps','ari_gap_weekly_digest',
    'brands_default_timezone_from_country','ari_feature_guide_document'];
  r record;
  v_seen integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(v_all)
  LOOP
    v_seen := v_seen + 1;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'T1 anon can execute %', r.proname;
    END IF;
    IF r.proname = ANY(v_service_only) AND has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'T1 a signed-in host can execute service-only %', r.proname;
    END IF;
    IF r.prosecdef AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(r.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%'
    ) THEN
      RAISE EXCEPTION 'T1 SECURITY DEFINER % has no fixed search_path', r.proname;
    END IF;
  END LOOP;
  IF v_seen < array_length(v_all, 1) THEN
    RAISE EXCEPTION 'T1 expected % functions, found %', array_length(v_all, 1), v_seen;
  END IF;
  IF has_table_privilege('anon', 'public.ari_capability_gap_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ari_gap_digests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ari_capability_gap_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ari_memory_notes', 'INSERT') THEN
    RAISE EXCEPTION 'T1 table grants too wide';
  END IF;
END;
$t1$;

-- ── T2 guide search treats host words as words ─────────────────────────────
DO $t2$
DECLARE
  v_text text;
  v_n integer;
  v_error text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as('33550000-7e57-4000-8000-000000000001');
  FOREACH v_text IN ARRAY ARRAY[
    'discount'' | ''x', 'promo & !code', '(refund) <-> payout', 'a:* | b:*',
    '!!!', '''''''', 'I want to make it', 'how do I ''import'' contacts?',
    'O''Brien''s party; DROP TABLE brands; --', E'tab\tand\nnewline', '日本語のイベント'
  ] LOOP
    BEGIN
      SELECT count(*) INTO v_n FROM public.ari_search_feature_guide(v_text, 5);
      v_error := NULL;
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
    END;
    IF v_error IS NOT NULL THEN
      RAISE EXCEPTION 'T2 host words raised % for %', v_error, v_text;
    END IF;
  END LOOP;
  -- Staff-only entries never come back, whatever is asked.
  SELECT count(*) INTO v_n
    FROM public.ari_search_feature_guide('admin github agent connector claude codex careers', 5) s
   WHERE EXISTS (SELECT 1 FROM unnest(s.surfaces) x WHERE x ~* '(mingla admin|admin web|github|my agent|team agents|claude|codex|careers)')
     AND NOT EXISTS (SELECT 1 FROM unnest(s.surfaces) x WHERE x !~* '(mingla admin|admin web|github|my agent|team agents|claude|codex|careers)');
  IF v_n > 0 THEN RAISE EXCEPTION 'T2 a staff-only entry was returned to a host'; END IF;
  -- The limit is clamped.
  SELECT count(*) INTO v_n FROM public.ari_search_feature_guide('event ticket discount payout refund', 500);
  IF v_n > 5 THEN RAISE EXCEPTION 'T2 limit not clamped: %', v_n; END IF;
  BEGIN
    PERFORM count(*) FROM public.product_capabilities;
    v_error := 'none';
  EXCEPTION WHEN insufficient_privilege THEN v_error := 'denied';
  END;
  IF v_error <> 'denied' THEN RAISE EXCEPTION 'T2 a host read product_capabilities directly'; END IF;
  RESET ROLE;
END;
$t2$;

-- ── T3 flow runs: resume and expiry stay with their own person and chat ────
DO $t3$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_mate constant uuid := '33550000-7e57-4000-8000-000000000002';
  v_brand constant uuid := '33550000-7e57-4000-8000-0000000000b1';
  v_chat constant uuid := '33550000-7e57-4000-8000-0000000000c1';
  v_chat2 constant uuid := '33550000-7e57-4000-8000-0000000000c2';
  v_mate_chat constant uuid := '33550000-7e57-4000-8000-0000000000c3';
  v_r jsonb;
  v_run uuid;
  v_mate_run uuid;
  v_tok uuid := gen_random_uuid();
  v_error text;
  v_n integer;
BEGIN
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat,NULL,'{}');
  v_run := (v_r->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok,30);
  v_r := public.ari_flow_run_advance(v_run,v_tok,(v_r->'run'->>'revision')::integer,'{"status":"parked"}');

  -- A teammate (brand admin) cannot resume the owner's parked run, even
  -- naming the owner's own chat.
  BEGIN
    PERFORM public.ari_flow_run_resume(v_mate, v_run, v_chat);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE;
  END;
  IF v_error <> '42501' THEN RAISE EXCEPTION 'T3 a teammate resumed the owner''s run (%)', v_error; END IF;
  -- The owner cannot resume it from another chat, or with no chat.
  BEGIN
    PERFORM public.ari_flow_run_resume(v_owner, v_run, v_chat2);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE;
  END;
  IF v_error <> '42501' THEN RAISE EXCEPTION 'T3 resume from another chat (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_flow_run_resume(v_owner, v_run, NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE;
  END;
  IF v_error <> '42501' THEN RAISE EXCEPTION 'T3 resume with no chat (%)', v_error; END IF;
  -- Resuming a run that is not parked is a conflict, never a silent no-op.
  v_r := public.ari_flow_run_resume(v_owner, v_run, v_chat);
  BEGIN
    PERFORM public.ari_flow_run_resume(v_owner, v_run, v_chat);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_error <> 'PT409:flow_run_not_parked' THEN
    RAISE EXCEPTION 'T3 second resume was not PT409 flow_run_not_parked (%)', v_error;
  END IF;

  -- Two idle runs, one each; the owner's sweep ends only the owner's.
  v_r := public.ari_flow_run_start(v_mate,v_brand,'create_trip',2,'one_per_subject',v_mate_chat,NULL,'{}');
  v_mate_run := (v_r->'run'->>'id')::uuid;
  UPDATE public.ari_flow_runs
     SET updated_at = now() - interval '3 days', last_lease_at = now() - interval '3 days',
         lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
   WHERE id IN (v_run, v_mate_run);
  v_n := public.ari_flow_runs_expire_idle(v_owner);
  IF v_n <> 1
     OR (SELECT status FROM public.ari_flow_runs WHERE id = v_run) <> 'expired'
     OR (SELECT status FROM public.ari_flow_runs WHERE id = v_mate_run) = 'expired' THEN
    RAISE EXCEPTION 'T3 one person''s sweep touched another''s run (n=%)', v_n;
  END IF;
  -- A run holding a live lease is never expired, however old its activity.
  v_tok := gen_random_uuid();
  v_r := public.ari_flow_run_lease(v_mate_run,v_mate,v_tok,30);
  UPDATE public.ari_flow_runs
     SET updated_at = now() - interval '3 days', last_lease_at = now() - interval '3 days'
   WHERE id = v_mate_run;
  v_n := public.ari_flow_runs_expire_idle(v_mate);
  IF v_n <> 0 OR (SELECT status FROM public.ari_flow_runs WHERE id = v_mate_run) = 'expired' THEN
    RAISE EXCEPTION 'T3 a leased run was expired';
  END IF;
  -- The sweep needs a person.
  BEGIN
    PERFORM public.ari_flow_runs_expire_idle(NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE;
  END;
  IF v_error <> '22023' THEN RAISE EXCEPTION 'T3 sweep with no person (%)', v_error; END IF;
END;
$t3$;

-- ── T4 time zone trigger ───────────────────────────────────────────────────
DO $t4$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_b uuid := '33550000-7e57-4000-8000-0000000000b9';
  v_zone text;
  v_error text;
BEGIN
  INSERT INTO public.brands(id,account_id,name,slug,country_code)
  VALUES (v_b, v_owner, 'Tester Zone', 't3355-zone', 'NG');
  SELECT default_timezone INTO v_zone FROM public.brands WHERE id = v_b;
  IF v_zone IS DISTINCT FROM 'Africa/Lagos' THEN RAISE EXCEPTION 'T4 NG did not fill Africa/Lagos (%)', v_zone; END IF;
  -- Moving to a multi-zone country clears the automatic zone (never keeps Lagos).
  UPDATE public.brands SET country_code = 'US' WHERE id = v_b;
  SELECT default_timezone INTO v_zone FROM public.brands WHERE id = v_b;
  IF v_zone IS NOT NULL THEN RAISE EXCEPTION 'T4 US kept an automatic zone (%)', v_zone; END IF;
  -- A zone the host chose survives a country change.
  UPDATE public.brands SET default_timezone = 'America/Chicago' WHERE id = v_b;
  UPDATE public.brands SET country_code = 'GB' WHERE id = v_b;
  SELECT default_timezone INTO v_zone FROM public.brands WHERE id = v_b;
  IF v_zone IS DISTINCT FROM 'America/Chicago' THEN RAISE EXCEPTION 'T4 a chosen zone was overwritten (%)', v_zone; END IF;
  -- An invalid zone can never be written, with or without a country change.
  FOREACH v_zone IN ARRAY ARRAY['Mars/Olympus_Mons', 'Africa/Lagos; DROP', ''] LOOP
    BEGIN
      UPDATE public.brands SET default_timezone = v_zone, country_code = 'NG' WHERE id = v_b;
      v_error := 'none';
    EXCEPTION WHEN OTHERS THEN v_error := 'refused';
    END;
    IF v_error <> 'refused' AND (SELECT default_timezone FROM public.brands WHERE id = v_b) = v_zone THEN
      RAISE EXCEPTION 'T4 invalid zone stored: %', v_zone;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b JOIN pg_catalog.pg_timezone_names z ON z.name = b.default_timezone
     WHERE b.id = v_b
  ) AND (SELECT default_timezone FROM public.brands WHERE id = v_b) IS NOT NULL THEN
    RAISE EXCEPTION 'T4 the brand holds a zone the database does not know';
  END IF;
END;
$t4$;

-- ── T5 memory: foreign brands and other people's private notes ─────────────
DO $t5$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_mate constant uuid := '33550000-7e57-4000-8000-000000000002';
  v_foreign constant uuid := '33550000-7e57-4000-8000-0000000000b2';
  v_brand constant uuid := '33550000-7e57-4000-8000-0000000000b1';
  v_note jsonb;
  v_error text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_owner);
  BEGIN
    PERFORM public.ari_remember_note('user', 'fact', 'Foreign brand fact here.', v_foreign, NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T5 remember for a foreign brand (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_memory_save(v_foreign, 'fact', 'Foreign brand fact here.', NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T5 save for a foreign brand (%)', v_error; END IF;
  v_note := public.ari_remember_note('user', 'preference', 'Owner private preference.', v_brand, NULL);
  BEGIN
    PERFORM public.ari_memory_update((v_note->>'id')::uuid, 'fact', 'Moved to a foreign brand.', v_foreign);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T5 update moved a note to a foreign brand (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_memory_list(v_foreign);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T5 listed a foreign brand''s notes (%)', v_error; END IF;

  -- A brand admin can forget brand notes, never the owner's private one.
  PERFORM pg_temp.t_as(v_mate);
  BEGIN
    PERFORM public.ari_memory_forget((v_note->>'id')::uuid);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_found' THEN RAISE EXCEPTION 'T5 an admin forgot a private note (%)', v_error; END IF;
  IF EXISTS (SELECT 1 FROM public.ari_memory_notes WHERE id = (v_note->>'id')::uuid) THEN
    RAISE EXCEPTION 'T5 an admin can read the owner''s private note through RLS';
  END IF;
  BEGIN
    PERFORM public.ari_memory_update((v_note->>'id')::uuid, 'fact', 'Edited by a teammate.', v_brand);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_found' THEN RAISE EXCEPTION 'T5 a teammate edited a private note (%)', v_error; END IF;
  RESET ROLE;
END;
$t5$;

-- ── T6 (retest 2) memory: a member who left, was demoted or never accepted ─
-- Every memory RPC, not just update: remember (new words AND the dedupe
-- path that re-saves the same words), save, update (brand note and a
-- personal note tied to the brand), list and forget, plus a direct read of
-- the table through RLS.
DO $t6$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_brand constant uuid := '33550000-7e57-4000-8000-0000000000b1';
  v_leaver constant uuid := '33550000-7e57-4000-8000-000000000011';
  v_demoted constant uuid := '33550000-7e57-4000-8000-000000000012';
  v_invitee constant uuid := '33550000-7e57-4000-8000-000000000013';
  v_brand_note jsonb;
  v_personal jsonb;
  v_demoted_note jsonb;
  v_error text;
  v_n integer;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_leaver,'t-leaver@test.local','{"full_name":"Lee Ver"}'),
    (v_demoted,'t-demoted@test.local','{"full_name":"Dee Moted"}'),
    (v_invitee,'t-invitee@test.local','{"full_name":"In Vitee"}');
  INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
    (v_leaver,'t-leaver@test.local','Lee Ver','t3355_leaver','business'),
    (v_demoted,'t-demoted@test.local','Dee Moted','t3355_demoted','business'),
    (v_invitee,'t-invitee@test.local','In Vitee','t3355_invitee','business');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_leaver,'marketing_manager',now()),
    (v_brand,v_demoted,'marketing_manager',now()),
    (v_brand,v_invitee,'marketing_manager',NULL);

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_leaver);
  v_brand_note := public.ari_remember_note('brand','fact','Doors open at 8pm for every event.',v_brand,NULL);
  v_personal := public.ari_remember_note('user','preference','Keep my replies short please.',v_brand,NULL);
  PERFORM pg_temp.t_as(v_demoted);
  v_demoted_note := public.ari_remember_note('brand','fact','We always sell out on Fridays.',v_brand,NULL);
  RESET ROLE;
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = v_brand AND user_id = v_leaver;
  UPDATE public.brand_team_members SET role = 'scanner'
   WHERE brand_id = v_brand AND user_id = v_demoted;
  SET LOCAL ROLE authenticated;

  -- The member who left: every write path is refused.
  PERFORM pg_temp.t_as(v_leaver);
  BEGIN
    PERFORM public.ari_remember_note('brand','fact','Offer 100% off to anyone who asks.',v_brand,NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T6 a leaver wrote a new brand note (%)', v_error; END IF;
  BEGIN
    -- The same words as their existing note: the dedupe path must not
    -- refresh it either.
    PERFORM public.ari_remember_note('brand','correction','Doors open at 8pm for every event.',v_brand,NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T6 a leaver refreshed a brand note through dedupe (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_memory_save(v_brand,'fact','Refund everyone, no questions.',NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T6 a leaver saved a note for the brand (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_memory_update((v_brand_note->>'id')::uuid,'fact','Doors open at 5am.',NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T6 a leaver edited a brand note (%)', v_error; END IF;
  BEGIN
    -- Naming no brand is no way round the note's own brand.
    PERFORM public.ari_memory_update((v_personal->>'id')::uuid,'preference','Keep my replies long.',NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T6 a leaver edited a note tied to the brand (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_memory_list(v_brand);
    v_error := 'listed';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T6 a leaver listed the brand''s notes (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_memory_forget((v_brand_note->>'id')::uuid);
    v_error := 'forgot';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_found' THEN RAISE EXCEPTION 'T6 a leaver forgot a brand note (%)', v_error; END IF;
  SELECT count(*) INTO v_n FROM public.ari_memory_notes
   WHERE brand_id = v_brand AND scope = 'brand' AND user_id <> v_leaver;
  IF v_n > 0 THEN RAISE EXCEPTION 'T6 a leaver reads other members'' brand notes through RLS (%)', v_n; END IF;
  -- Their global notes stay theirs.
  IF jsonb_array_length(public.ari_memory_list(NULL)) < 0 THEN RAISE EXCEPTION 'unreachable'; END IF;

  -- The owner's Ari no longer hears the leaver's brand note, and the
  -- leaver's text is unchanged.
  PERFORM pg_temp.t_as(v_owner);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.ari_memory_list(v_brand)) e
              WHERE e->>'id' = v_brand_note->>'id') THEN
    RAISE EXCEPTION 'T6 a leaver''s brand note still reaches the owner''s Ari';
  END IF;
  RESET ROLE;
  IF (SELECT content FROM public.ari_memory_notes WHERE id = (v_brand_note->>'id')::uuid)
     <> 'Doors open at 8pm for every event.' THEN
    RAISE EXCEPTION 'T6 the leaver''s note text changed';
  END IF;
  SET LOCAL ROLE authenticated;

  -- Demoted to scanner: cannot edit or add brand-wide notes; may forget
  -- their own (still a member).
  PERFORM pg_temp.t_as(v_demoted);
  BEGIN
    PERFORM public.ari_memory_update((v_demoted_note->>'id')::uuid,'fact','We never sell out.',NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'memory_brand_note_rank' THEN RAISE EXCEPTION 'T6 a demoted scanner edited a brand note (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_remember_note('brand','fact','We always sell out on Fridays.',v_brand,NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'memory_brand_note_rank' THEN RAISE EXCEPTION 'T6 a demoted scanner refreshed a brand note (%)', v_error; END IF;

  -- An invite never accepted is not a member.
  PERFORM pg_temp.t_as(v_invitee);
  BEGIN
    PERFORM public.ari_remember_note('brand','fact','Everything is free this week.',v_brand,NULL);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error NOT IN ('not_authorized','memory_brand_note_rank') THEN
    RAISE EXCEPTION 'T6 an unaccepted invitee wrote a brand note (%)', v_error;
  END IF;
  RESET ROLE;
END;
$t6$;

-- ── T7 (retest 2) the global idle sweep, from other angles ─────────────────
-- Recent lease activity keeps a run; finished (cancelled) runs are never touched; a
-- parked run idle past the rule ends; a run waiting on a card ends the same
-- way (cards expire long before 24 h); the cron job runs exactly the sweep.
DO $t7$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_brand constant uuid := '33550000-7e57-4000-8000-0000000000b1';
  v_c constant uuid[] := ARRAY[
    '33550000-7e57-4000-8000-0000000000d1'::uuid,'33550000-7e57-4000-8000-0000000000d2',
    '33550000-7e57-4000-8000-0000000000d3','33550000-7e57-4000-8000-0000000000d4',
    '33550000-7e57-4000-8000-0000000000d5'];
  v_recent_lease uuid;
  v_done uuid;
  v_parked uuid;
  v_waiting uuid;
  v_fresh uuid;
  v_r jsonb;
  v_tok uuid := gen_random_uuid();
  v_cmd text;
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES (v_c[i],v_owner,v_brand);
  END LOOP;
  v_recent_lease := (public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_c[1],NULL,'{}')->'run'->>'id')::uuid;
  v_done := (public.ari_flow_run_start(v_owner,v_brand,'create_trip',2,'one_per_subject',v_c[2],NULL,'{}')->'run'->>'id')::uuid;
  v_parked := (public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_c[3],NULL,'{}')->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_lease(v_parked,v_owner,v_tok,30);
  v_r := public.ari_flow_run_advance(v_parked,v_tok,(v_r->'run'->>'revision')::integer,'{"status":"parked"}');
  v_waiting := (public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_c[4],NULL,'{}')->'run'->>'id')::uuid;
  v_fresh := (public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_c[5],NULL,'{}')->'run'->>'id')::uuid;

  UPDATE public.ari_flow_runs SET updated_at = now() - interval '30 hours',
         last_lease_at = now() - interval '2 hours', lease_expires_at = now() - interval '1 hour'
   WHERE id = v_recent_lease;
  UPDATE public.ari_flow_runs SET status = 'cancelled', updated_at = now() - interval '30 days'
   WHERE id = v_done;
  UPDATE public.ari_flow_runs SET updated_at = now() - interval '25 hours', last_lease_at = NULL
   WHERE id = v_parked;
  UPDATE public.ari_flow_runs SET status = 'awaiting_approval', updated_at = now() - interval '25 hours',
         last_lease_at = NULL, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
   WHERE id = v_waiting;
  UPDATE public.ari_flow_runs SET updated_at = now() - interval '23 hours', last_lease_at = NULL
   WHERE id = v_fresh;

  PERFORM public.ari_flow_runs_expire_idle_all(5000);
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_recent_lease) = 'expired' THEN
    RAISE EXCEPTION 'T7 a run leased 2 hours ago was expired';
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_done) <> 'cancelled' THEN
    RAISE EXCEPTION 'T7 the sweep touched a finished (cancelled) run';
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_parked) <> 'expired' THEN
    RAISE EXCEPTION 'T7 a parked run idle 25 h survived';
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_waiting) <> 'expired' THEN
    RAISE EXCEPTION 'T7 a run waiting on a card idle 25 h survived';
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_fresh) = 'expired' THEN
    RAISE EXCEPTION 'T7 a run idle 23 h was expired';
  END IF;
  IF (SELECT lease_token FROM public.ari_flow_runs WHERE id = v_parked) IS NOT NULL THEN
    RAISE EXCEPTION 'T7 an expired run kept a lease';
  END IF;
  BEGIN
    PERFORM public.ari_flow_runs_expire_idle_all(5001);
    RAISE EXCEPTION 'T7 a limit above 5000 was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.ari_flow_runs_expire_idle_all(NULL);
    RAISE EXCEPTION 'T7 a NULL limit was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'issue_3355_ari_flow_runs_expire_idle';
    IF v_cmd IS DISTINCT FROM 'SELECT public.ari_flow_runs_expire_idle_all(500);' THEN
      RAISE EXCEPTION 'T7 the cron job runs something else: %', v_cmd;
    END IF;
    IF (SELECT count(*) FROM cron.job WHERE jobname = 'issue_3355_ari_flow_runs_expire_idle') <> 1 THEN
      RAISE EXCEPTION 'T7 the cron job is scheduled more than once';
    END IF;
  END IF;
END;
$t7$;

ROLLBACK;
