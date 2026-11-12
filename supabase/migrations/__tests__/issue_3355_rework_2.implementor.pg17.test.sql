-- Issue #3355 rework 2 (tester P3-21).
-- MINGLA-INVARIANT: I-ARI-MEMORY-BRAND-VOICE-AT-READ | issue #3355 | A brand-scoped Ari memory note reaches another member (ari_memory_list and the table's RLS read) only while its author is on the brand's team at marketing manager rank or above; demoting or removing the author hides it without deleting it.
--
--   M1  a marketing manager's brand note reaches the owner; after the author
--       is demoted to scanner it no longer does (ari_memory_list and a direct
--       RLS read), the row is kept, and the author still sees their own note;
--       promoted back, it returns;
--   M2  a removed author's brand note is hidden the same way, row kept;
--   M3  the owner's own brand note, and a brand admin's, still reach a member;
--   Q   (P2-11) a setup completed on its draft counts as completed in the
--       quality panel, and its follow-up run (answers.follow_up_of) is not
--       counted as a second setup (20280702123355).
-- Reverting the read-time rank filter in ari_memory_list raises M1; reverting
-- it in the read policy raises M1's RLS check; reverting 20280702123355
-- raises Q (the follow-up run is counted as a started setup).

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-b2b2-4000-8000-000000000001','rw2-owner@test.local','{"full_name":"Rw2 Owner"}'),
  ('33550000-b2b2-4000-8000-000000000002','rw2-author@test.local','{"full_name":"Rw2 Author"}'),
  ('33550000-b2b2-4000-8000-000000000003','rw2-leaver@test.local','{"full_name":"Rw2 Leaver"}'),
  ('33550000-b2b2-4000-8000-000000000004','rw2-admin@test.local','{"full_name":"Rw2 Admin"}'),
  ('33550000-b2b2-4000-8000-000000000005','rw2-member@test.local','{"full_name":"Rw2 Member"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-b2b2-4000-8000-000000000001','rw2-owner@test.local','Rw2 Owner','rw2_owner','business'),
  ('33550000-b2b2-4000-8000-000000000002','rw2-author@test.local','Rw2 Author','rw2_author','business'),
  ('33550000-b2b2-4000-8000-000000000003','rw2-leaver@test.local','Rw2 Leaver','rw2_leaver','business'),
  ('33550000-b2b2-4000-8000-000000000004','rw2-admin@test.local','Rw2 Admin','rw2_admin','business'),
  ('33550000-b2b2-4000-8000-000000000005','rw2-member@test.local','Rw2 Member','rw2_member','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-b2b2-4000-8000-000000000001','rw2-owner@test.local','Rw2 Owner','Rw2 Host');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('33550000-b2b2-4000-8000-0000000000b1','33550000-b2b2-4000-8000-000000000001','Rework Two Lagos','rw2-lagos','NGN');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('33550000-b2b2-4000-8000-0000000000b1','33550000-b2b2-4000-8000-000000000002','marketing_manager',now()),
  ('33550000-b2b2-4000-8000-0000000000b1','33550000-b2b2-4000-8000-000000000003','marketing_manager',now()),
  ('33550000-b2b2-4000-8000-0000000000b1','33550000-b2b2-4000-8000-000000000004','brand_admin',now()),
  ('33550000-b2b2-4000-8000-0000000000b1','33550000-b2b2-4000-8000-000000000005','scanner',now());

CREATE OR REPLACE FUNCTION pg_temp.rw2_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.rw2_listed(p_list jsonb, p_id text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(p_list) e WHERE e->>'id' = p_id);
$$;

CREATE TEMP TABLE rw2_notes (key text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON rw2_notes TO authenticated;

-- ── M1 a demoted author's brand note stops reaching other members ─────────
DO $m1$
DECLARE
  v_brand constant uuid := '33550000-b2b2-4000-8000-0000000000b1';
  v_owner constant uuid := '33550000-b2b2-4000-8000-000000000001';
  v_author constant uuid := '33550000-b2b2-4000-8000-000000000002';
  v_member constant uuid := '33550000-b2b2-4000-8000-000000000005';
  v_note jsonb;
  v_rls integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.rw2_as(v_author);
  v_note := public.ari_remember_note('brand', 'fact',
    'Our doors open at 9pm, never earlier.', v_brand, NULL);
  PERFORM pg_temp.rw2_as(v_owner);
  IF NOT pg_temp.rw2_listed(public.ari_memory_list(v_brand), v_note->>'id') THEN
    RAISE EXCEPTION 'M1 setup: the owner should read the marketing manager''s brand note';
  END IF;
  RESET ROLE;

  UPDATE public.brand_team_members SET role = 'scanner'
   WHERE brand_id = v_brand AND user_id = v_author;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.rw2_as(v_owner);
  IF pg_temp.rw2_listed(public.ari_memory_list(v_brand), v_note->>'id') THEN
    RAISE EXCEPTION 'M1 a demoted author''s brand note still reaches the owner''s Ari';
  END IF;
  SELECT count(*) INTO v_rls FROM public.ari_memory_notes WHERE id = (v_note->>'id')::uuid;
  IF v_rls <> 0 THEN
    RAISE EXCEPTION 'M1 RLS still lets the owner read a demoted author''s brand note';
  END IF;
  PERFORM pg_temp.rw2_as(v_member);
  IF pg_temp.rw2_listed(public.ari_memory_list(v_brand), v_note->>'id') THEN
    RAISE EXCEPTION 'M1 a demoted author''s brand note still reaches another member';
  END IF;
  -- The author still sees their own note (and cannot edit it: rework 1).
  PERFORM pg_temp.rw2_as(v_author);
  IF NOT pg_temp.rw2_listed(public.ari_memory_list(v_brand), v_note->>'id') THEN
    RAISE EXCEPTION 'M1 the author lost sight of their own note';
  END IF;
  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM public.ari_memory_notes
     WHERE id = (v_note->>'id')::uuid AND active
       AND content = 'Our doors open at 9pm, never earlier.'
  ) THEN
    RAISE EXCEPTION 'M1 the note row was changed or removed; it must be kept';
  END IF;

  -- Promoted back: the note speaks for the brand again.
  UPDATE public.brand_team_members SET role = 'marketing_manager'
   WHERE brand_id = v_brand AND user_id = v_author;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.rw2_as(v_owner);
  IF NOT pg_temp.rw2_listed(public.ari_memory_list(v_brand), v_note->>'id') THEN
    RAISE EXCEPTION 'M1 a re-promoted author''s note did not come back';
  END IF;
  RESET ROLE;
END;
$m1$;

-- ── M2 a removed author's brand note is hidden, row kept ──────────────────
DO $m2$
DECLARE
  v_brand constant uuid := '33550000-b2b2-4000-8000-0000000000b1';
  v_owner constant uuid := '33550000-b2b2-4000-8000-000000000001';
  v_leaver constant uuid := '33550000-b2b2-4000-8000-000000000003';
  v_note jsonb;
  v_rls integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.rw2_as(v_leaver);
  v_note := public.ari_remember_note('brand', 'fact',
    'We always comp the DJ''s plus one.', v_brand, NULL);
  RESET ROLE;
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = v_brand AND user_id = v_leaver;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.rw2_as(v_owner);
  IF pg_temp.rw2_listed(public.ari_memory_list(v_brand), v_note->>'id') THEN
    RAISE EXCEPTION 'M2 a removed author''s brand note still reaches the owner';
  END IF;
  SELECT count(*) INTO v_rls FROM public.ari_memory_notes WHERE id = (v_note->>'id')::uuid;
  IF v_rls <> 0 THEN
    RAISE EXCEPTION 'M2 RLS still lets the owner read a removed author''s brand note';
  END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.ari_memory_notes WHERE id = (v_note->>'id')::uuid AND active) THEN
    RAISE EXCEPTION 'M2 the removed author''s row must be kept';
  END IF;
END;
$m2$;

-- ── M3 the owner's and a brand admin's notes still reach a scanner ────────
DO $m3$
DECLARE
  v_brand constant uuid := '33550000-b2b2-4000-8000-0000000000b1';
  v_owner constant uuid := '33550000-b2b2-4000-8000-000000000001';
  v_admin constant uuid := '33550000-b2b2-4000-8000-000000000004';
  v_member constant uuid := '33550000-b2b2-4000-8000-000000000005';
  v_owner_note jsonb;
  v_admin_note jsonb;
  v_list jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.rw2_as(v_owner);
  v_owner_note := public.ari_remember_note('brand', 'fact',
    'Tickets are always in naira.', v_brand, NULL);
  PERFORM pg_temp.rw2_as(v_admin);
  v_admin_note := public.ari_remember_note('brand', 'preference',
    'Sign every blast off as the Lagos crew.', v_brand, NULL);
  PERFORM pg_temp.rw2_as(v_member);
  v_list := public.ari_memory_list(v_brand);
  IF NOT pg_temp.rw2_listed(v_list, v_owner_note->>'id')
     OR NOT pg_temp.rw2_listed(v_list, v_admin_note->>'id') THEN
    RAISE EXCEPTION 'M3 the owner''s or admin''s brand note no longer reaches a member';
  END IF;
  IF (SELECT count(*) FROM public.ari_memory_notes
       WHERE id IN ((v_owner_note->>'id')::uuid, (v_admin_note->>'id')::uuid)) <> 2 THEN
    RAISE EXCEPTION 'M3 RLS hides the owner''s or admin''s brand note from a member';
  END IF;
  RESET ROLE;
END;
$m3$;

-- ── Q a follow-up run is not a second setup in the quality panel ─────────
INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
  ('33550000-b2b2-4000-8000-0000000000c1','33550000-b2b2-4000-8000-000000000001','33550000-b2b2-4000-8000-0000000000b1');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-b2b2-4000-8000-000000000009','rw2-staff@test.local','{"full_name":"Rw2 Staff"}');
INSERT INTO public.admin_users(email, role, status) VALUES ('rw2-staff@test.local', 'admin', 'active');
CREATE TEMP TABLE rw2_before(view jsonb);
GRANT ALL ON rw2_before TO authenticated;

DO $qbefore$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '33550000-b2b2-4000-8000-000000000009', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', '33550000-b2b2-4000-8000-000000000009',
    'role', 'authenticated', 'email', 'rw2-staff@test.local')::text, true);
  INSERT INTO rw2_before VALUES (public.ari_admin_quality_metrics(30));
  RESET ROLE;
END;
$qbefore$;

-- The setup completed on its draft, then the host said yes on the
-- completion card: the follow-up run is open, carrying follow_up_of.
INSERT INTO public.ari_flow_runs(id,brand_id,flow_key,flow_version,concurrency,started_by,conversation_id,status,
  completion_evidence,answers,created_at,completed_at)
VALUES
  ('33550000-b2b2-4000-8000-0000000000f1','33550000-b2b2-4000-8000-0000000000b1','create_event',2,'one_per_subject',
   '33550000-b2b2-4000-8000-000000000001','33550000-b2b2-4000-8000-0000000000c1','completed',
   '{"probe":"events_exists","observed":{"id":"e1"}}','{}', now() - interval '5 minutes', now() - interval '4 minutes'),
  ('33550000-b2b2-4000-8000-0000000000f2','33550000-b2b2-4000-8000-0000000000b1','create_event',2,'one_per_subject',
   '33550000-b2b2-4000-8000-000000000001','33550000-b2b2-4000-8000-0000000000c1','awaiting_owner',
   NULL,'{"follow_up_of":{"value":"33550000-b2b2-4000-8000-0000000000f1","source":"engine"}}',
   now() - interval '3 minutes', NULL);

DO $q$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT view INTO v_before FROM rw2_before;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '33550000-b2b2-4000-8000-000000000009', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', '33550000-b2b2-4000-8000-000000000009',
    'role', 'authenticated', 'email', 'rw2-staff@test.local')::text, true);
  v_after := public.ari_admin_quality_metrics(30);
  RESET ROLE;
  IF (v_after #>> '{flows,started}')::bigint - (v_before #>> '{flows,started}')::bigint <> 1 THEN
    RAISE EXCEPTION 'Q the follow-up run was counted as a setup started (% -> %)',
      v_before #>> '{flows,started}', v_after #>> '{flows,started}';
  END IF;
  IF (v_after #>> '{flows,completed}')::bigint - (v_before #>> '{flows,completed}')::bigint <> 1 THEN
    RAISE EXCEPTION 'Q the setup completed on its draft was not counted completed';
  END IF;
  IF (v_after #>> '{flows,open}')::bigint - (v_before #>> '{flows,open}')::bigint <> 0 THEN
    RAISE EXCEPTION 'Q the open follow-up run was counted as an open setup';
  END IF;
END;
$q$;

ROLLBACK;
