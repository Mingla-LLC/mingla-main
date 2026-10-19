-- Issue #3697: Creative Library lifecycle — archive, guarded permanent delete,
-- immutable tombstone and audit row.
-- MINGLA-INVARIANT: I-CREATIVE-ARCHIVE-NOT-DELETE | issue #3697 | removal is archive; a permanent delete destroys the media only with zero blockers and leaves an immutable tombstone plus audit row
-- Invariant I-AD-MEDIA-NEVER-BLOCKS-DELETION (declared in supabase/migrations/__tests__/issue_3040_ad_media_never_blocks_deletion.implementor.pg17.test.sql): a tombstone never blocks brand or account deletion
--
-- Proves, against the real schema after a full replay:
--   L1  archive / restore are idempotent and keep status and archived_at consistent
--   L2  every blocker kind is reported: not_archived, campaign + plan_version,
--       platform_ref, status_event, duplicate_creative, live_surface,
--       legal_hold, not_video; an archived, unreferenced house video has none
--   L3  recording a purge tombstones the row, stamps the source job reaped and
--       writes one audit row; a replay changes nothing
--   L4  the tombstone refuses UPDATE and DELETE; a live row refuses DELETE
--   L5  the purge audit row refuses UPDATE and DELETE; other audit rows do not
--   L6  a tombstone no longer counts as a live reference to its guid
--   L7  a tombstone never blocks deleting its creator's account or source job
--
-- FAILS ON REVERT: drop trg_ad_creatives_tombstone_immutable (L4), drop
-- trg_admin_audit_log_purge_immutable (L5), drop the purged_at filter from
-- cover_video_guid_live_references (L6), let the tombstone trigger refuse the
-- foreign key's SET NULL (L7), or drop any blocker arm (L2).
BEGIN;

DO $test$
DECLARE
  v_admin uuid := '36970000-0000-4000-8000-000000000001';
  v_host uuid := '36970000-0000-4000-8000-000000000002';
  v_brand uuid := '36970000-0000-4000-8000-000000000003';
  v_job public.event_cover_video_jobs;
  v_c public.ad_creatives;
  v_dup public.ad_creatives;
  v_host_c public.ad_creatives;
  v_img public.ad_creatives;
  v_first_archived_at timestamptz;
  v_blockers text[];
  v_ref uuid;
  v_n integer;
  v_audit uuid;
  v_other_audit uuid;
  v_guid text := 'guid-3697-lifecycle-0001';
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_admin,'issue-3697-admin@test.local'),
    (v_host,'issue-3697-host@test.local');
  INSERT INTO public.admin_users(email,status,role) VALUES ('issue-3697-admin@test.local','active','admin');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_host,'issue-3697-host@test.local','Host');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_host,'Issue 3697 Brand','issue-3697-lifecycle-brand','USD',now(),now());

  -- A house upload through the lane, materialized as the edge does.
  v_job := public.cover_video_create_or_replay_job(
    v_admin,'36970000-0000-4000-8000-000000000011','ad_creative',NULL,NULL,NULL,
    'admin-library:'||v_admin::text,'published_manual','bunny','house.mp4','video/mp4','mp4',
    repeat('a',64),2000000,8000,0,8000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id=v_guid WHERE id=v_job.id;
  INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,content_hash,
      created_by,source,source_job_id)
    VALUES('video','House reel','https://cdn.test/'||v_guid||'/play_1080p.mp4',v_guid,
      'https://cdn.test/'||v_guid||'/thumbnail.jpg','https://cdn.test/'||v_guid||'/play_1080p.mp4',
      repeat('b',64),v_admin,'admin_upload',v_job.id)
    RETURNING * INTO v_c;

  -- L1 archive / restore.
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF NOT ('not_archived' = ANY(v_blockers)) THEN
    RAISE EXCEPTION 'L2 an active creative was purgeable: %', v_blockers;
  END IF;
  v_c := public.ad_creative_set_archived(v_c.id, true, v_admin);
  IF v_c.status <> 'archived' OR v_c.archived_at IS NULL OR v_c.archived_by IS DISTINCT FROM v_admin THEN
    RAISE EXCEPTION 'L1 archive did not record status, time and actor';
  END IF;
  v_first_archived_at := v_c.archived_at;
  v_c := public.ad_creative_set_archived(v_c.id, true, v_host);
  IF v_c.archived_at IS DISTINCT FROM v_first_archived_at OR v_c.archived_by IS DISTINCT FROM v_admin THEN
    RAISE EXCEPTION 'L1 a repeated archive changed the record';
  END IF;
  v_c := public.ad_creative_set_archived(v_c.id, false, v_admin);
  IF v_c.status <> 'active' OR v_c.archived_at IS NOT NULL OR v_c.archived_by IS NOT NULL THEN
    RAISE EXCEPTION 'L1 restore did not clear the archive';
  END IF;
  BEGIN
    UPDATE public.ad_creatives SET status='archived' WHERE id=v_c.id;
    RAISE EXCEPTION 'L1 archived without an archive time';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v_c := public.ad_creative_set_archived(v_c.id, true, v_admin);

  -- L2 an archived, unreferenced house video has no blockers.
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF cardinality(v_blockers) <> 0 THEN
    RAISE EXCEPTION 'L2 an unreferenced archived house video was blocked: %', v_blockers;
  END IF;

  -- L2 an ad platform copy blocks, and so does its status history.
  INSERT INTO public.ad_creative_platform_refs(creative_id,platform,lane,external_account_id,external_kind,content_hash)
    VALUES(v_c.id,'meta','consumer','act_3697','video',repeat('b',64)) RETURNING id INTO v_ref;
  INSERT INTO public.ad_status_events(creative_ref_id,platform,entity,action)
    VALUES(v_ref,'meta','creative_ref','sync');
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF NOT ('platform_ref' = ANY(v_blockers)) OR NOT ('status_event' = ANY(v_blockers)) THEN
    RAISE EXCEPTION 'L2 a provider copy did not block: %', v_blockers;
  END IF;
  DELETE FROM public.ad_status_events WHERE creative_ref_id=v_ref;
  DELETE FROM public.ad_creative_platform_refs WHERE id=v_ref;

  -- L2 a frozen plan version and its campaign block. (Fixture rows only: the
  -- plan tables' own lifecycle triggers are bypassed for this insert.)
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.ad_plan_versions(id,plan_id,version_number,canonical_plan,destination_snapshot,plan_hash,host_currency,host_budget_cents)
    VALUES('36970000-0000-4000-8000-000000000021','36970000-0000-4000-8000-000000000022',1,
      jsonb_build_object('creative_library_id',v_c.id::text),'{}'::jsonb,repeat('c',64),'USD',1000);
  SET LOCAL session_replication_role = origin;
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF NOT ('plan_version' = ANY(v_blockers)) THEN
    RAISE EXCEPTION 'L2 a frozen plan version did not block: %', v_blockers;
  END IF;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.ad_campaigns(id,plan_version_id,connection_id,platform,external_campaign_id,name,objective,
      dest_page_type,dest_brand_slug,dest_url,dest_smart_link,currency,status)
    VALUES('36970000-0000-4000-8000-000000000023','36970000-0000-4000-8000-000000000021',
      '36970000-0000-4000-8000-000000000024','meta','ext-3697','c','OUTCOME_TRAFFIC',
      'brand','issue-3697','https://test.local/b','https://test.local/s','USD','PAUSED');
  SET LOCAL session_replication_role = origin;
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF v_blockers[1] IS DISTINCT FROM 'campaign' THEN
    RAISE EXCEPTION 'L2 a campaign is not the first blocker: %', v_blockers;
  END IF;
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.ad_campaigns WHERE id='36970000-0000-4000-8000-000000000023';
  DELETE FROM public.ad_plan_versions WHERE id='36970000-0000-4000-8000-000000000021';
  SET LOCAL session_replication_role = origin;

  -- L2 another library item with the same file blocks.
  INSERT INTO public.ad_creatives(kind,name,bunny_video_id,poster_url,content_hash,created_by,source)
    VALUES('video','Duplicate',v_guid,'https://cdn.test/'||v_guid||'/thumbnail.jpg',repeat('d',64),v_admin,'admin_upload')
    RETURNING * INTO v_dup;
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF NOT ('duplicate_creative' = ANY(v_blockers)) THEN
    RAISE EXCEPTION 'L2 a duplicate did not block: %', v_blockers;
  END IF;
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.ad_creatives WHERE id=v_dup.id;
  SET LOCAL session_replication_role = origin;

  -- L2 a brand cover still serving the file blocks.
  UPDATE public.brands SET cover_media_url='https://cdn.test/'||v_guid||'/play_1080p.mp4' WHERE id=v_brand;
  v_blockers := public.ad_creative_purge_blockers(v_c.id);
  IF NOT ('live_surface' = ANY(v_blockers)) THEN
    RAISE EXCEPTION 'L2 a live cover did not block: %', v_blockers;
  END IF;
  UPDATE public.brands SET cover_media_url=NULL WHERE id=v_brand;

  -- L2 Host media is under the Terms hold; an image is not a video.
  INSERT INTO public.ad_creatives(kind,name,bunny_video_id,poster_url,content_hash,created_by,source,brand_id,status,archived_at)
    VALUES('video','Host reel','guid-3697-host-0001','https://cdn.test/guid-3697-host-0001/thumbnail.jpg',
      repeat('e',64),v_host,'host_upload',v_brand,'archived',now())
    RETURNING * INTO v_host_c;
  IF NOT ('legal_hold' = ANY(public.ad_creative_purge_blockers(v_host_c.id))) THEN
    RAISE EXCEPTION 'L2 Host media was purgeable by an admin';
  END IF;
  INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,created_by,source,status,archived_at)
    VALUES('image','Still','https://cdn.test/still.jpg',repeat('f',64),v_admin,'admin_upload','archived',now())
    RETURNING * INTO v_img;
  IF NOT ('not_video' = ANY(public.ad_creative_purge_blockers(v_img.id))) THEN
    RAISE EXCEPTION 'L2 an image was purgeable as a video';
  END IF;

  IF cardinality(public.ad_creative_purge_blockers(v_c.id)) <> 0 THEN
    RAISE EXCEPTION 'L2 cleared references still blocked';
  END IF;

  -- L4 a live (not purged) row is never physically deleted.
  BEGIN
    DELETE FROM public.ad_creatives WHERE id=v_c.id;
    RAISE EXCEPTION 'L4 a library row was deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_tombstone_immutable' THEN RAISE; END IF;
  END;

  -- L3 record the purge.
  BEGIN
    PERFORM public.ad_creative_record_purge(v_img.id, v_admin, '', now());
    RAISE EXCEPTION 'L3 a purge without an actor was recorded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  v_c := public.ad_creative_record_purge(v_c.id, v_admin, 'issue-3697-admin@test.local', now());
  IF v_c.purged_at IS NULL OR v_c.purged_by IS DISTINCT FROM v_admin OR v_c.status <> 'archived' THEN
    RAISE EXCEPTION 'L3 the tombstone was not recorded';
  END IF;
  IF (SELECT reaped_at FROM public.event_cover_video_jobs WHERE id=v_job.id) IS NULL THEN
    RAISE EXCEPTION 'L3 the source job was not stamped reaped';
  END IF;
  SELECT count(*), min(id::text)::uuid INTO v_n, v_audit FROM public.admin_audit_log
    WHERE action='ad_creative_purge' AND target_id=v_c.id::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'L3 expected one purge audit row, found %', v_n; END IF;
  IF (SELECT metadata->>'bunny_video_id' FROM public.admin_audit_log WHERE id=v_audit) <> v_guid
     OR (SELECT metadata->>'source_job_id' FROM public.admin_audit_log WHERE id=v_audit) <> v_job.id::text THEN
    RAISE EXCEPTION 'L3 the audit row does not name the media and its job';
  END IF;
  PERFORM public.ad_creative_record_purge(v_c.id, v_admin, 'issue-3697-admin@test.local', now());
  SELECT count(*) INTO v_n FROM public.admin_audit_log WHERE action='ad_creative_purge' AND target_id=v_c.id::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'L3 a replayed purge wrote a second audit row'; END IF;
  IF NOT ('already_purged' = ANY(public.ad_creative_purge_blockers(v_c.id))) THEN
    RAISE EXCEPTION 'L3 a tombstone could be purged again';
  END IF;
  BEGIN
    PERFORM public.ad_creative_set_archived(v_c.id, false, v_admin);
    RAISE EXCEPTION 'L3 a tombstone was restored';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_purged' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.ad_creative_record_purge(v_img.id, v_admin, 'issue-3697-admin@test.local', now());
    PERFORM public.ad_creative_set_archived(v_img.id, false, v_admin);
    RAISE EXCEPTION 'L3 restore of a purged image succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  -- L4 the tombstone is immutable.
  BEGIN
    UPDATE public.ad_creatives SET name='x' WHERE id=v_c.id;
    RAISE EXCEPTION 'L4 a tombstone was renamed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_tombstone_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.ad_creatives SET created_by=v_host WHERE id=v_c.id;
    RAISE EXCEPTION 'L4 a tombstone link was re-pointed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_tombstone_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.ad_creatives WHERE id=v_c.id;
    RAISE EXCEPTION 'L4 a tombstone was deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_tombstone_immutable' THEN RAISE; END IF;
  END;

  -- L5 the purge audit row is immutable; other audit rows keep their rules.
  BEGIN
    UPDATE public.admin_audit_log SET admin_email='someone@test.local' WHERE id=v_audit;
    RAISE EXCEPTION 'L5 a purge audit row was edited';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_purge_audit_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.admin_audit_log WHERE id=v_audit;
    RAISE EXCEPTION 'L5 a purge audit row was deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ad_creative_purge_audit_immutable' THEN RAISE; END IF;
  END;
  INSERT INTO public.admin_audit_log(admin_email,action,target_type,target_id)
    VALUES('issue-3697-admin@test.local','ad_creative_archive','ad_creative',v_c.id::text)
    RETURNING id INTO v_other_audit;
  UPDATE public.admin_audit_log SET metadata='{"note":"ok"}'::jsonb WHERE id=v_other_audit;
  DELETE FROM public.admin_audit_log WHERE id=v_other_audit;

  -- L6 the tombstone no longer counts as a reference to its guid.
  IF 'ad_creative' = ANY(public.cover_video_guid_live_references(v_guid, v_job.id)) THEN
    RAISE EXCEPTION 'L6 a tombstone still counts as a live reference';
  END IF;

  -- L7 deleting the source job and the creator's account clears links only.
  DELETE FROM public.event_cover_video_jobs WHERE id=v_job.id;
  DELETE FROM auth.users WHERE id=v_admin;
  SELECT * INTO v_c FROM public.ad_creatives WHERE id=v_c.id;
  IF v_c.id IS NULL OR v_c.purged_at IS NULL THEN RAISE EXCEPTION 'L7 the tombstone was lost'; END IF;
  IF v_c.created_by IS NOT NULL OR v_c.archived_by IS NOT NULL OR v_c.purged_by IS NOT NULL
     OR v_c.source_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'L7 deleted links were not cleared';
  END IF;
  IF v_c.source_job_ref IS DISTINCT FROM v_job.id OR v_c.bunny_video_id <> v_guid OR v_c.name <> 'House reel' THEN
    RAISE EXCEPTION 'L7 the tombstone changed when its links were cleared';
  END IF;
  DELETE FROM public.brands WHERE id=v_brand;
  IF (SELECT brand_id FROM public.ad_creatives WHERE id=v_host_c.id) IS NOT NULL THEN
    RAISE EXCEPTION 'L7 the brand link survived brand deletion';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3697_creative_library_lifecycle.implementor.pg17: PASS'
