-- #4137 tester adversarial proof: visibility edges, hostile writes, live role checks and private grants.
-- MINGLA-INVARIANT: I-4137-BLOG-PUBLIC-READS-PUBLISHED-ONLY | issue #4137 | scheduled, taken-down and deleted posts never leak through public reads.
-- MINGLA-INVARIANT: I-4137-BLOG-WRITES-VIA-RPC-ROLE-GUARDED | issue #4137 | a forged JWT cannot publish and role downgrades take effect on the next call.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users (id,email,email_confirmed_at) VALUES
  ('41379999-0000-4000-a000-000000000001','issue4137-adv-writer@test.local',now()),
  ('41379999-0000-4000-a000-000000000002','issue4137-adv-lead@test.local',now()),
  ('41379999-0000-4000-a000-000000000003','issue4137-adv-admin@test.local',now()),
  ('41379999-0000-4000-a000-000000000004','issue4137-adv-host@test.local',now());
INSERT INTO public.admin_team_members (email,role,status,accepted_at) VALUES
  ('issue4137-adv-writer@test.local','growth','active',now()),
  ('issue4137-adv-lead@test.local','growth','active',now());
INSERT INTO public.support_staff (user_id,enabled,available,role) VALUES
  ('41379999-0000-4000-a000-000000000001',true,false,'staff'),
  ('41379999-0000-4000-a000-000000000002',true,false,'lead');
INSERT INTO public.admin_users (email,role,status,accepted_at)
VALUES ('issue4137-adv-admin@test.local','admin','active',now());

INSERT INTO public.creator_accounts (id) VALUES ('41379999-0000-4000-a000-000000000004');
INSERT INTO public.brands (id,account_id,name,slug,default_currency,created_at,updated_at) VALUES
  ('41379999-0000-4000-c000-000000000001','41379999-0000-4000-a000-000000000004','Adversarial Brand','issue-4137-adv-brand','USD',now(),now());
INSERT INTO public.events (id,brand_id,created_by,event_type,title,slug,status,visibility,currency,timezone,city,party_types,rsvp_approval_mode,rsvp_discoverable,theme,location_text,created_at,updated_at) VALUES
  ('41379999-0000-4000-d000-000000000001','41379999-0000-4000-c000-000000000001','41379999-0000-4000-a000-000000000004','event','Public event','issue-4137-adv-public','scheduled','public','USD','America/New_York','Raleigh','{}','auto',false,'{}','Public place',now(),now()),
  ('41379999-0000-4000-d000-000000000002','41379999-0000-4000-c000-000000000001','41379999-0000-4000-a000-000000000004','event','Private event','issue-4137-adv-private','draft','draft','USD','America/New_York','Raleigh','{}','auto',false,'{}','Private place',now(),now());
INSERT INTO public.event_dates (event_id,start_at,end_at,timezone,is_master) VALUES
  ('41379999-0000-4000-d000-000000000001',now()+interval '2 days',now()+interval '2 days 3 hours','America/New_York',true);

DELETE FROM public.blog_featured;
INSERT INTO public.blog_posts (id,slug,category_slug,status,publish_at,take_down_mode,take_down_at,created_by,deleted_at) VALUES
  ('41379999-0000-4000-f000-000000000001','adv-scheduled','going-out','draft',now()+interval '1 second','never',NULL,'41379999-0000-4000-a000-000000000001',NULL),
  ('41379999-0000-4000-f000-000000000002','adv-taken-down','going-out','draft',now()-interval '1 day','at',now(),'41379999-0000-4000-a000-000000000001',NULL),
  ('41379999-0000-4000-f000-000000000003','adv-deleted-featured','going-out','draft',now()-interval '1 day','never',NULL,'41379999-0000-4000-a000-000000000001',now()),
  ('41379999-0000-4000-f000-000000000004','adv-embed-freeze','going-out','draft',now()-interval '1 day','never',NULL,'41379999-0000-4000-a000-000000000001',NULL),
  ('41379999-0000-4000-f000-000000000005','adv-slug-foo','going-out','draft',NULL,'never',NULL,'41379999-0000-4000-a000-000000000001',NULL),
  ('41379999-0000-4000-f000-000000000006','adv-slug-bar','going-out','draft',NULL,'never',NULL,'41379999-0000-4000-a000-000000000001',NULL);

INSERT INTO public.blog_post_versions (id,post_id,kind,title,summary,document,created_by) VALUES
  ('41379999-0000-4000-f100-000000000001','41379999-0000-4000-f000-000000000001','published','Scheduled','', '{"version":1,"blocks":[]}','41379999-0000-4000-a000-000000000001'),
  ('41379999-0000-4000-f100-000000000002','41379999-0000-4000-f000-000000000002','published','Taken down','', '{"version":1,"blocks":[]}','41379999-0000-4000-a000-000000000001'),
  ('41379999-0000-4000-f100-000000000003','41379999-0000-4000-f000-000000000003','published','Deleted featured','', '{"version":1,"blocks":[]}','41379999-0000-4000-a000-000000000001'),
  ('41379999-0000-4000-f100-000000000004','41379999-0000-4000-f000-000000000004','published','Frozen embed','', '{"version":1,"blocks":[{"id":"offer01","type":"offering","eventId":"41379999-0000-4000-d000-000000000001","displayTitle":"Public event"}]}','41379999-0000-4000-a000-000000000001'),
  ('41379999-0000-4000-f100-000000000014','41379999-0000-4000-f000-000000000004','draft','Draft private embed','', '{"version":1,"blocks":[{"id":"offer02","type":"offering","eventId":"41379999-0000-4000-d000-000000000002","displayTitle":"Private event"}]}','41379999-0000-4000-a000-000000000001'),
  ('41379999-0000-4000-f100-000000000005','41379999-0000-4000-f000-000000000005','draft','Foo','', '{"version":1,"blocks":[]}','41379999-0000-4000-a000-000000000001'),
  ('41379999-0000-4000-f100-000000000006','41379999-0000-4000-f000-000000000006','draft','Bar','', '{"version":1,"blocks":[]}','41379999-0000-4000-a000-000000000001');
UPDATE public.blog_posts SET status='published',published_version_id='41379999-0000-4000-f100-000000000001',draft_version_id='41379999-0000-4000-f100-000000000001' WHERE id='41379999-0000-4000-f000-000000000001';
UPDATE public.blog_posts SET status='published',published_version_id='41379999-0000-4000-f100-000000000002',draft_version_id='41379999-0000-4000-f100-000000000002' WHERE id='41379999-0000-4000-f000-000000000002';
UPDATE public.blog_posts SET status='published',published_version_id='41379999-0000-4000-f100-000000000003',draft_version_id='41379999-0000-4000-f100-000000000003' WHERE id='41379999-0000-4000-f000-000000000003';
UPDATE public.blog_posts SET status='published',published_version_id='41379999-0000-4000-f100-000000000004',draft_version_id='41379999-0000-4000-f100-000000000014' WHERE id='41379999-0000-4000-f000-000000000004';
UPDATE public.blog_posts SET draft_version_id='41379999-0000-4000-f100-000000000005' WHERE id='41379999-0000-4000-f000-000000000005';
UPDATE public.blog_posts SET draft_version_id='41379999-0000-4000-f100-000000000006' WHERE id='41379999-0000-4000-f000-000000000006';
INSERT INTO public.blog_featured(slot,post_id,set_by) VALUES ('blog_index','41379999-0000-4000-f000-000000000003','41379999-0000-4000-a000-000000000002');

DO $test$
DECLARE problems text[]; oversized jsonb;
BEGIN
  IF public.blog_public_post('adv-scheduled') IS NOT NULL OR public.blog_public_post('adv-taken-down') IS NOT NULL OR public.blog_public_post('adv-deleted-featured') IS NOT NULL THEN
    RAISE EXCEPTION 'visibility edge leaked';
  END IF;
  BEGIN
    UPDATE public.blog_posts SET published_version_id=NULL WHERE id='41379999-0000-4000-f000-000000000004';
    RAISE EXCEPTION 'published-null-version accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  problems:=public.issue_4137_blog_document_problems(jsonb_build_object('version',1,'blocks',(
    SELECT jsonb_agg(jsonb_build_object('id','block'||lpad(i::text,4,'0'),'type','divider')) FROM generate_series(1,301) i)));
  IF NOT ('document:too_many_blocks'=ANY(problems)) THEN RAISE EXCEPTION '301 blocks accepted: %',problems; END IF;
  problems:=public.issue_4137_blog_document_problems('{"version":1,"blocks":[{"id":"unknown1","type":"future"}]}'::jsonb);
  IF NOT EXISTS(SELECT 1 FROM unnest(problems) p WHERE p LIKE '%type_unsupported') THEN RAISE EXCEPTION 'unknown block accepted'; END IF;
  problems:=public.issue_4137_blog_document_problems('{"version":1,"blocks":[{"id":"image001","type":"image","mediaId":"41379999-0000-4000-e000-000000000001","alt":" "}]}'::jsonb);
  IF NOT EXISTS(SELECT 1 FROM unnest(problems) p WHERE p LIKE '%alt_required') THEN RAISE EXCEPTION 'missing image alt accepted'; END IF;
  oversized:=jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('id','oversize1','type','paragraph','html',repeat('x',600000))));
  IF NOT ('document:too_large'=ANY(public.issue_4137_blog_document_problems(oversized))) THEN RAISE EXCEPTION '600KB document accepted'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE (proname LIKE 'issue_4137_blog_%' OR proname LIKE 'blog_public_%') AND prosrc LIKE '%40001%') THEN
    RAISE EXCEPTION 'a blog function uses forbidden 40001';
  END IF;
END
$test$;

-- A writer cannot turn forged claims into publisher authority; raw RPC validation stays server-side.
SELECT set_config('request.jwt.claim.sub','41379999-0000-4000-a000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"41379999-0000-4000-a000-000000000001","role":"service_role","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE revision_before integer;
BEGIN
  BEGIN
    PERFORM public.issue_4137_blog_publish('41379999-0000-4000-f000-000000000005',1,now(),false);
    RAISE EXCEPTION 'forged writer published';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blog_forbidden' THEN RAISE; END IF;
  END;
  revision_before:=(public.issue_4137_blog_get_post('41379999-0000-4000-f000-000000000005') #>> '{post,revision}')::integer;
  BEGIN
    PERFORM public.issue_4137_blog_save_draft('41379999-0000-4000-f000-000000000005',revision_before,
      '{"document":{"version":1,"blocks":[{"id":"image001","type":"image","mediaId":"41379999-0000-4000-e000-000000000001","alt":""}]}}');
    RAISE EXCEPTION 'raw RPC accepted missing alt';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'blog_document_invalid' THEN RAISE; END IF;
  END;
  PERFORM public.issue_4137_blog_save_draft('41379999-0000-4000-f000-000000000006',1,'{"title":"First client"}');
  BEGIN
    PERFORM public.issue_4137_blog_save_draft('41379999-0000-4000-f000-000000000006',1,'{"title":"Second stale client"}');
    RAISE EXCEPTION 'second client overwrote the first';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4137_blog_save_draft('41379999-0000-4000-f000-000000000006',2,'{"slug":"AdV-SlUg-FoO"}');
    RAISE EXCEPTION 'case-insensitive slug collision accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4137_blog_save_draft('41379999-0000-4000-f000-000000000006',2,'{"slug":"preview"}');
    RAISE EXCEPTION 'reserved slug accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'blog_slug_invalid' THEN RAISE; END IF;
  END;
END
$test$;
RESET ROLE;

-- Admins can publish without a support_staff row; a downgraded lead loses authority immediately.
DO $test$
BEGIN
  IF NOT public.issue_4137_blog_can_publish('41379999-0000-4000-a000-000000000003') THEN RAISE EXCEPTION 'active Admin without support_staff denied'; END IF;
  IF NOT public.issue_4137_blog_can_publish('41379999-0000-4000-a000-000000000002') THEN RAISE EXCEPTION 'lead setup failed'; END IF;
  UPDATE public.support_staff SET role='staff' WHERE user_id='41379999-0000-4000-a000-000000000002';
END
$test$;
SELECT set_config('request.jwt.claim.sub','41379999-0000-4000-a000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF public.issue_4137_blog_my_permissions()->>'can_publish' <> 'false' THEN RAISE EXCEPTION 'downgraded lead retained publish'; END IF;
  BEGIN
    PERFORM public.issue_4137_blog_set_featured('41379999-0000-4000-f000-000000000004');
    RAISE EXCEPTION 'downgraded lead featured';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blog_forbidden' THEN RAISE; END IF;
  END;
END
$test$;
RESET ROLE;

-- Public embeds come from the frozen published document, not a newer draft.
DO $test$
DECLARE payload jsonb;
BEGIN
  payload:=public.blog_public_post_embeds('adv-embed-freeze');
  IF NOT (payload #> '{offerings,41379999-0000-4000-d000-000000000001}' IS NOT NULL)
     OR payload #> '{offerings,41379999-0000-4000-d000-000000000002}' IS NOT NULL THEN
    RAISE EXCEPTION 'draft/private embed leaked: %',payload;
  END IF;
  UPDATE public.events SET visibility='draft',status='draft' WHERE id='41379999-0000-4000-d000-000000000001';
  payload:=public.blog_public_post_embeds('adv-embed-freeze');
  IF payload #>> '{offerings,41379999-0000-4000-d000-000000000001,is_public}' <> 'false' THEN
    RAISE EXCEPTION 'live event privacy change was not reflected: %',payload;
  END IF;
END
$test$;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN PERFORM source_ref FROM public.blog_media; RAISE EXCEPTION 'anon read source_ref'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('blog-media','anon/4137.jpg'); RAISE EXCEPTION 'anon wrote blog-media'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  BEGIN PERFORM * FROM public.blog_preview_tokens; RAISE EXCEPTION 'authenticated read preview tokens'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$test$;
RESET ROLE;

SELECT 'PASS #4137 blog adversarial: visibility, document limits, roles, stale races, frozen embeds and grants' AS result;
ROLLBACK;
