-- #4402 — an admin can correct the audience band on an approved handle.
--
-- MINGLA-INVARIANT: I-4402-BAND-CHANGE-IS-ADMIN-AND-AUDITED | issue #4402 | Only an admin, through admin_creator_handle_band_change with a reason, changes the band on an approved handle; the handle stays verified with follower_source='admin', and a handle_band_change creator_review_events row records the old and the new band.
--
-- Seth's live pass (12 Nov 2026): "Once you choose what you saw no way to
-- change if you made a mistake." Fails on 0f4e29393c: the function and the
-- handle_band_change action did not exist.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44022000-0000-4000-8000-0000000000c1','i4402b-creator@mingla.test'),
  ('44022000-0000-4000-8000-0000000000a1','i4402b-admin@mingla.test');
INSERT INTO public.profiles(id,display_name) VALUES
  ('44022000-0000-4000-8000-0000000000c1','Band Creator'),('44022000-0000-4000-8000-0000000000a1','Band Admin');
INSERT INTO public.admin_users(email,status) VALUES('i4402b-admin@mingla.test','active');
INSERT INTO public.creator_profiles(creator_account_id,display_name,date_of_birth) VALUES('44022000-0000-4000-8000-0000000000c1','Band Creator','1990-01-01');
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE h4402b(platform text, id uuid);
GRANT ALL ON h4402b TO PUBLIC;

-- The creator adds two handles (one will stay waiting for review).
SELECT pg_temp.act('44022000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO h4402b VALUES('instagram',(public.creator_handle_upsert('instagram','band.creator','lt1k')->>'id')::uuid);
  INSERT INTO h4402b VALUES('tiktok',(public.creator_handle_upsert('tiktok','band.creator','lt1k')->>'id')::uuid);
END $$;
RESET ROLE;

-- The admin approves Instagram with the wrong band (Seth's 1k–10k).
SELECT pg_temp.act('44022000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v jsonb; ig uuid:=(SELECT id FROM h4402b WHERE platform='instagram'); BEGIN
  v:=public.admin_creator_handle_decide(ig,'approve','Saw the code','1k_10k');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '4402b.approve: %',v; END IF;
END $$;
RESET ROLE;
CREATE TEMP TABLE before4402b AS SELECT verified_at FROM public.creator_handles WHERE id=(SELECT id FROM h4402b WHERE platform='instagram');
SELECT pg_temp.act('44022000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v jsonb; ig uuid:=(SELECT id FROM h4402b WHERE platform='instagram'); tt uuid:=(SELECT id FROM h4402b WHERE platform='tiktok'); BEGIN

  -- Refusals: nothing written.
  IF public.admin_creator_handle_band_change(ig,'lt1k','   ')->>'error' IS DISTINCT FROM 'note_required' THEN RAISE EXCEPTION '4402b.reason required'; END IF;
  IF public.admin_creator_handle_band_change(ig,NULL,'Misread')->>'error' IS DISTINCT FROM 'band_required' THEN RAISE EXCEPTION '4402b.band required'; END IF;
  IF public.admin_creator_handle_band_change(ig,'huge','Misread')->>'error' IS DISTINCT FROM 'invalid_band' THEN RAISE EXCEPTION '4402b.invalid band'; END IF;
  IF public.admin_creator_handle_band_change(ig,'1k_10k','Misread')->>'error' IS DISTINCT FROM 'band_unchanged' THEN RAISE EXCEPTION '4402b.same band'; END IF;
  IF public.admin_creator_handle_band_change(tt,'lt1k','Misread')->>'error' IS DISTINCT FROM 'handle_not_approved' THEN RAISE EXCEPTION '4402b.a handle waiting for review'; END IF;
  IF public.admin_creator_handle_band_change(gen_random_uuid(),'lt1k','Misread')->>'error' IS DISTINCT FROM 'handle_not_found' THEN RAISE EXCEPTION '4402b.unknown handle'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_creator_detail('44022000-0000-4000-8000-0000000000c1')->'history') e WHERE e->>'action'='handle_band_change') THEN
    RAISE EXCEPTION '4402b.a refused change was audited';
  END IF;

  -- The correction: band changes, the handle stays verified, source stays admin.
  v:=public.admin_creator_handle_band_change(ig,'lt1k','Misread the follower count');
  IF (v->>'ok')::boolean IS DISTINCT FROM true OR v->'handle'->>'follower_band'<>'lt1k' OR v->>'previous_follower_band'<>'1k_10k' THEN
    RAISE EXCEPTION '4402b.change: %',v;
  END IF;
  -- History in the Admin record carries both bands.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_creator_detail('44022000-0000-4000-8000-0000000000c1')->'history') e
                 WHERE e->>'action'='handle_band_change' AND e->>'follower_band'='lt1k' AND e->>'previous_follower_band'='1k_10k' AND e->>'actor_name'='Band Admin') THEN
    RAISE EXCEPTION '4402b.history does not show the band change';
  END IF;
END $$;
RESET ROLE;
DO $$ DECLARE ig uuid:=(SELECT id FROM h4402b WHERE platform='instagram'); BEGIN
  IF (SELECT h.verified_at IS DISTINCT FROM b.verified_at OR h.verified_at IS NULL OR h.review_required OR h.last_check_status<>'verified'
             OR h.follower_source<>'admin' OR h.follower_band<>'lt1k' OR h.self_reported_band<>'lt1k'
        FROM public.creator_handles h, before4402b b WHERE h.id=ig) THEN
    RAISE EXCEPTION '4402b.the handle did not stay verified with the admin band';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_review_events WHERE creator_account_id='44022000-0000-4000-8000-0000000000c1'
                 AND action='handle_band_change' AND handle_id=ig AND platform='instagram' AND follower_band='lt1k'
                 AND previous_follower_band='1k_10k' AND note='Misread the follower count' AND actor='44022000-0000-4000-8000-0000000000a1') THEN
    RAISE EXCEPTION '4402b.the change was not audited with the old and new band';
  END IF;
  IF (SELECT count(*) FROM public.creator_review_events WHERE creator_account_id='44022000-0000-4000-8000-0000000000c1' AND action='handle_band_change')<>1 THEN
    RAISE EXCEPTION '4402b.exactly one band change should be audited';
  END IF;
END $$;

-- The creator cannot change a band, and the schema refuses a change with no reason.
SELECT pg_temp.act('44022000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_code text; BEGIN
  BEGIN PERFORM public.admin_creator_handle_band_change((SELECT id FROM h4402b WHERE platform='instagram'),'gt1m','I am big');
  EXCEPTION WHEN others THEN v_code:=SQLSTATE||' '||SQLERRM; END;
  IF v_code IS DISTINCT FROM '42501 admin_only' THEN RAISE EXCEPTION '4402b.creator was not refused: %',v_code; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE v_code text; BEGIN
  IF (SELECT follower_band FROM public.creator_handles WHERE id=(SELECT id FROM h4402b WHERE platform='instagram'))<>'lt1k' THEN
    RAISE EXCEPTION '4402b.a refused creator call changed the band';
  END IF;
  BEGIN
    INSERT INTO public.creator_review_events(creator_account_id,action,handle_id,platform,follower_band)
    VALUES('44022000-0000-4000-8000-0000000000c1','handle_band_change',gen_random_uuid(),'instagram','lt1k');
  EXCEPTION WHEN check_violation THEN v_code:='23514'; END;
  IF v_code IS DISTINCT FROM '23514' THEN RAISE EXCEPTION '4402b.a band change with no reason was accepted'; END IF;
  IF has_function_privilege('anon','public.admin_creator_handle_band_change(uuid,text,text)','execute')
     OR NOT has_function_privilege('authenticated','public.admin_creator_handle_band_change(uuid,text,text)','execute') THEN
    RAISE EXCEPTION '4402b grants drifted';
  END IF;
END $$;

SELECT '4402 admin change handle band: all assertions passed' AS result;
ROLLBACK;
