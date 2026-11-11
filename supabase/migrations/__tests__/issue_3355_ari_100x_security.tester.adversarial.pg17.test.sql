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

-- ── T8 (retest 3) P3-21 brand voice at read, from other angles ─────────────
-- The rank boundary both ways (marketing manager is enough, finance and
-- event managers rank above it, scanner below); removal hides the note and
-- re-adding as a scanner does not bring it back; the author still reads
-- their own note; a member of another brand never reads it; the new helper
-- is not anon-callable and pins search_path.
DO $t8$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_mate constant uuid := '33550000-7e57-4000-8000-000000000002';
  v_outsider constant uuid := '33550000-7e57-4000-8000-000000000003';
  v_brand constant uuid := '33550000-7e57-4000-8000-0000000000b1';
  v_author constant uuid := '33550000-7e57-4000-8000-000000000021';
  v_note jsonb;
  v_error text;
  v_n integer;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_author,'t-author@test.local','{"full_name":"Au Thor"}');
  INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
    (v_author,'t-author@test.local','Au Thor','t3355_author','business');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_author,'marketing_manager',now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_author);
  v_note := public.ari_remember_note('brand','fact','Our doors always open at 7pm sharp.',v_brand,NULL);
  RESET ROLE;

  -- rank -> must the owner's Ari (list) and the mate's RLS read see it?
  FOR v_error IN SELECT unnest(ARRAY['marketing_manager:t','finance_manager:t','event_manager:t','scanner:f','brand_admin:t']) LOOP
    UPDATE public.brand_team_members SET role = split_part(v_error,':',1)
     WHERE brand_id = v_brand AND user_id = v_author;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.t_as(v_owner);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.ari_memory_list(v_brand)) e WHERE e->>'id' = v_note->>'id')
       <> (split_part(v_error,':',2) = 't') THEN
      RAISE EXCEPTION 'T8 brand voice at rank % is wrong in ari_memory_list', v_error;
    END IF;
    PERFORM pg_temp.t_as(v_mate);
    SELECT count(*) INTO v_n FROM public.ari_memory_notes WHERE id = (v_note->>'id')::uuid;
    IF (v_n = 1) <> (split_part(v_error,':',2) = 't') THEN
      RAISE EXCEPTION 'T8 brand voice at rank % is wrong through RLS (% rows)', v_error, v_n;
    END IF;
    -- The author always reads their own note.
    PERFORM pg_temp.t_as(v_author);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.ari_memory_list(v_brand)) e
                    WHERE e->>'id' = v_note->>'id' AND (e->>'mine')::boolean) THEN
      RAISE EXCEPTION 'T8 the author lost their own note at rank %', v_error;
    END IF;
    RESET ROLE;
  END LOOP;

  -- Removed, then re-added as a scanner: still hidden from the brand.
  UPDATE public.brand_team_members SET role = 'marketing_manager', removed_at = now()
   WHERE brand_id = v_brand AND user_id = v_author;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_owner);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.ari_memory_list(v_brand)) e WHERE e->>'id' = v_note->>'id') THEN
    RAISE EXCEPTION 'T8 a removed marketing manager still speaks for the brand';
  END IF;
  RESET ROLE;
  UPDATE public.brand_team_members SET role = 'scanner', removed_at = NULL
   WHERE brand_id = v_brand AND user_id = v_author;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_owner);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.ari_memory_list(v_brand)) e WHERE e->>'id' = v_note->>'id') THEN
    RAISE EXCEPTION 'T8 re-added as a scanner, the old brand note came back';
  END IF;
  -- Another brand's owner: no list, no rows.
  PERFORM pg_temp.t_as(v_outsider);
  BEGIN
    PERFORM public.ari_memory_list(v_brand);
    v_error := 'listed';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'T8 an outsider listed the brand''s notes (%)', v_error; END IF;
  SELECT count(*) INTO v_n FROM public.ari_memory_notes WHERE brand_id = v_brand AND scope = 'brand';
  IF v_n > 0 THEN RAISE EXCEPTION 'T8 an outsider reads the brand''s notes through RLS (%)', v_n; END IF;
  RESET ROLE;

  IF has_function_privilege('anon','public.ari_memory_brand_voice(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'T8 anon can execute ari_memory_brand_voice';
  END IF;
  IF has_function_privilege('anon','public.ari_admin_quality_metrics(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'T8 anon can execute ari_admin_quality_metrics';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ari_memory_brand_voice'
                  AND prosecdef AND array_to_string(proconfig, ',') LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'T8 ari_memory_brand_voice has no fixed search_path';
  END IF;
END;
$t8$;

-- ── T9 (retest 3) P2-11 a completed setup stays completed ──────────────────
-- The table refuses completed without evidence even to a direct write; the
-- RPCs refuse evidence without a probe, and never advance, resume, lease or
-- sweep a completed run; a new setup in the same chat leaves it completed;
-- the quality panel counts a follow-up run (answers.follow_up_of) as neither
-- a setup started nor a second completion.
DO $t9$
DECLARE
  v_owner constant uuid := '33550000-7e57-4000-8000-000000000001';
  v_brand constant uuid := '33550000-7e57-4000-8000-0000000000b1';
  v_chat constant uuid := '33550000-7e57-4000-8000-0000000000e1';
  v_staff constant uuid := '33550000-7e57-4000-8000-000000000031';
  v_run uuid;
  v_follow uuid;
  v_r jsonb;
  v_tok uuid := gen_random_uuid();
  v_error text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_staff,'t-staff3@test.local');
  INSERT INTO public.admin_users(email, role, status) VALUES ('t-staff3@test.local','admin','active');
  INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES (v_chat,v_owner,v_brand);
  PERFORM pg_temp.t_as(v_staff);
  v_before := public.ari_admin_quality_metrics(30)->'flows';

  v_run := (public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat,NULL,'{}')->'run'->>'id')::uuid;
  BEGIN
    UPDATE public.ari_flow_runs SET status = 'completed' WHERE id = v_run;
    v_error := 'accepted';
  EXCEPTION WHEN check_violation THEN v_error := 'refused'; END;
  IF v_error <> 'refused' THEN RAISE EXCEPTION 'T9 a run was completed with no evidence by a direct write'; END IF;

  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok,30);
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok,(v_r->'run'->>'revision')::integer,
      '{"status":"completed","completion_evidence":{"observed":true}}');
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'flow_evidence_required' THEN RAISE EXCEPTION 'T9 completion evidence with no probe was accepted (%)', v_error; END IF;
  v_r := public.ari_flow_run_advance(v_run,v_tok,(v_r->'run'->>'revision')::integer,
    '{"status":"completed","completion_evidence":{"probe":"events_exists","observed":true}}');
  IF v_r->'run'->>'status' IS DISTINCT FROM 'completed' AND v_r->>'status' IS DISTINCT FROM 'completed' THEN
    IF (SELECT status FROM public.ari_flow_runs WHERE id = v_run) <> 'completed' THEN
      RAISE EXCEPTION 'T9 a run with evidence did not complete';
    END IF;
  END IF;

  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok,(SELECT revision FROM public.ari_flow_runs WHERE id = v_run),'{"status":"active"}');
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error NOT IN ('flow_run_terminal','flow_lease_not_held') THEN RAISE EXCEPTION 'T9 a completed run was reopened by advance (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_flow_run_resume(v_owner,v_run,v_chat);
    v_error := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error <> 'flow_run_not_parked' THEN RAISE EXCEPTION 'T9 a completed run was resumed (%)', v_error; END IF;
  v_r := public.ari_flow_run_lease(v_run,v_owner,gen_random_uuid(),30);
  IF COALESCE((v_r->>'ok')::boolean, true) THEN RAISE EXCEPTION 'T9 a completed run was leased: %', v_r; END IF;

  UPDATE public.ari_flow_runs SET updated_at = now() - interval '30 days', last_lease_at = NULL WHERE id = v_run;
  PERFORM public.ari_flow_runs_expire_idle_all(500);
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_run) <> 'completed' THEN
    RAISE EXCEPTION 'T9 the idle sweep touched a completed run';
  END IF;
  UPDATE public.ari_flow_runs SET updated_at = now() WHERE id = v_run;

  -- The follow-up ("yes, get it ready") is a new run in the same chat.
  v_follow := (public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat,NULL,
    jsonb_build_object('follow_up_of', jsonb_build_object('value', v_run, 'source', 'engine')))->'run'->>'id')::uuid;
  IF v_follow = v_run OR (SELECT status FROM public.ari_flow_runs WHERE id = v_run) <> 'completed' THEN
    RAISE EXCEPTION 'T9 the follow-up reopened or replaced the completed run';
  END IF;
  v_after := public.ari_admin_quality_metrics(30)->'flows';
  IF (v_after->>'started')::int - (v_before->>'started')::int <> 1
     OR (v_after->>'completed')::int - (v_before->>'completed')::int <> 1 THEN
    RAISE EXCEPTION 'T9 quality panel counts after a follow-up run: before % after %', v_before, v_after;
  END IF;
  -- The follow-up completing too is still one setup, one completion.
  UPDATE public.ari_flow_runs SET status = 'completed',
         completion_evidence = '{"probe":"events_publish_ready","observed":true}', completed_at = now()
   WHERE id = v_follow;
  v_after := public.ari_admin_quality_metrics(30)->'flows';
  IF (v_after->>'started')::int - (v_before->>'started')::int <> 1
     OR (v_after->>'completed')::int - (v_before->>'completed')::int <> 1 THEN
    RAISE EXCEPTION 'T9 a completed follow-up counted as a second setup: before % after %', v_before, v_after;
  END IF;
END;
$t9$;

ROLLBACK;
