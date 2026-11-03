\set ON_ERROR_STOP on

-- Issue #4238 — tester security suite for the dated-offering ad resolver.
-- Runs after the full migration chain on PostgreSQL 17 as supabase_admin over
-- 127.0.0.1, inside one transaction that is rolled back.
--
-- ad_destination_resolve is EXECUTE-able by every signed-in account
-- (authenticated), not only brand members. Before #4238 its dated branch
-- (ad_destination_resolve_wave1) answered a private, unpublished or
-- moderation-blocked offering with ONLY {ok, code, page_type, availability,
-- availability_reason}. The #4238 wrapper must keep that: a refusal that a
-- stranger can trigger by guessing a brand + page slug must not carry the
-- offering's title, cover, city, id or brand. Brand members and admins see the
-- detail through ad_advertisable_pages (membership-checked), which is where the
-- greyed-out picker reads it.
--
--   S1  grants: the rule owner is service-role only; the resolver and the list
--       have no PUBLIC or anon EXECUTE.
--   S2  a stranger (signed in, not a member) resolving a private / unpublished /
--       moderation-blocked offering gets no title, cover, city, id or brand.
--   S3  the list still requires brand membership or admin, for unlisted and
--       private rows alike; a member never sees another brand's rows.
--   S4  the greyed-out rows a member sees carry no canonical link.
--
-- S2 is RED on 8a5c84770: ad_offering_destination_by_id returns v_base (title,
-- cover_url, city, id, brand_id, brand_name, timezone) on every refusal and the
-- wrapper hands it to any authenticated caller.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 tester security FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- No offering detail in a refusal a stranger can trigger.
CREATE OR REPLACE FUNCTION pg_temp.bare(j jsonb)
RETURNS boolean LANGUAGE sql AS $b$
  SELECT (j->>'ok')::boolean IS FALSE
     AND NOT (j ?| ARRAY['title', 'cover_url', 'city', 'id', 'event_id',
                         'brand_id', 'brand_name', 'canonical_url'])
$b$;

INSERT INTO auth.users(id) VALUES
  ('42386666-0000-4000-8000-000000000001'),
  ('42386666-0000-4000-8000-000000000002'),
  ('42386666-0000-4000-8000-000000000003'),
  ('42386666-0000-4000-8000-000000000004');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('42386666-0000-4000-8000-000000000001', 'owner-4238-sec@example.test'),
  ('42386666-0000-4000-8000-000000000004', 'other-4238-sec@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('42386666-0000-4000-8000-000000000010', '42386666-0000-4000-8000-000000000001',
   'Secret Supper Club', 'issue-4238-sec', 'NGN', now(), now()),
  ('42386666-0000-4000-8000-000000000020', '42386666-0000-4000-8000-000000000004',
   'Other Brand', 'issue-4238-sec-other', 'NGN', now(), now());
-- ...02 is a member of the first brand; ...03 is a stranger; ...04 owns the
-- other brand (account owners become members on brand insert).
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('42386666-0000-4000-8000-000000000010', '42386666-0000-4000-8000-000000000002', 'scanner', now());

INSERT INTO public.events(id, brand_id, title, slug, status, event_type, visibility, timezone, city, cover_media_url) VALUES
  ('42386666-1000-4000-8000-000000000001', '42386666-0000-4000-8000-000000000010',
   'Private: CEO birthday dinner', 'birthday', 'scheduled', 'event', 'private', 'Africa/Lagos',
   'Ikoyi', 'https://cdn.test/private-cover.jpg'),
  ('42386666-1000-4000-8000-000000000002', '42386666-0000-4000-8000-000000000010',
   'Unannounced: summer launch', 'launch', 'draft', 'event', 'draft', 'Africa/Lagos',
   'Lekki', 'https://cdn.test/draft-cover.jpg'),
  ('42386666-1000-4000-8000-000000000003', '42386666-0000-4000-8000-000000000010',
   'Being made private', 'blocked', 'scheduled', 'event', 'public', 'Africa/Lagos',
   'VI', 'https://cdn.test/blocked-cover.jpg'),
  ('42386666-1000-4000-8000-000000000004', '42386666-0000-4000-8000-000000000010',
   'Unlisted trip', 'hidden-trip', 'scheduled', 'trip', 'hidden', 'Africa/Lagos',
   'Calabar', 'https://cdn.test/trip-cover.jpg'),
  ('42386666-1000-4000-8000-000000000005', '42386666-0000-4000-8000-000000000020',
   'Other brand private', 'other-private', 'scheduled', 'event', 'private', 'Africa/Lagos',
   NULL, NULL);
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
SELECT id, now() + interval '7 days', now() + interval '7 days 3 hours', true, 'Africa/Lagos'
FROM public.events WHERE id::text LIKE '42386666-1000-%';
INSERT INTO public.event_private_media_transition_jobs(
  transition_id, event_id, direction, target_visibility, state, ordinary_read_blocked_at,
  expected_event_updated_at, source_fingerprint)
VALUES (gen_random_uuid(), '42386666-1000-4000-8000-000000000003', 'enter_private', 'private',
        'preparing', now(), now(), repeat('a', 64));

-- ── S1 grants ──
SELECT pg_temp.ok(
  NOT has_function_privilege('anon', 'public.ad_offering_destination_by_id(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ad_offering_destination_by_id(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.ad_offering_destination_by_id(uuid)', 'EXECUTE'),
  'S1 the rule owner is service-role only');
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid IN ('public.ad_offering_destination_by_id(uuid)'::regprocedure,
                    'public.ad_destination_resolve(text,text,text)'::regprocedure,
                    'public.ad_advertisable_pages(text,text[],boolean,uuid,integer)'::regprocedure)
      AND a.grantee = 0),
  'S1 no PUBLIC EXECUTE on the resolver, the rule owner or the list');
SELECT pg_temp.ok(
  NOT has_function_privilege('anon', 'public.ad_destination_resolve(text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ad_advertisable_pages(text,text[],boolean,uuid,integer)', 'EXECUTE'),
  'S1 anon cannot resolve or list');
SELECT pg_temp.ok(
  (SELECT prosecdef AND proconfig::text LIKE '%search_path=public%'
   FROM pg_proc WHERE oid = 'public.ad_offering_destination_by_id(uuid)'::regprocedure),
  'S1 the rule owner is SECURITY DEFINER with a pinned search_path');

-- ── S3 / S4 as the member ──
SELECT set_config('request.jwt.claim.sub', '42386666-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"42386666-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.ad_advertisable_pages(NULL, ARRAY['event','trip'], true,
     '42386666-0000-4000-8000-000000000010', 0)) = 3
  AND NOT EXISTS (SELECT 1 FROM public.ad_advertisable_pages('blocked', NULL, true,
     '42386666-0000-4000-8000-000000000010', 0)),
  'S3 a member with reasons on sees their own brand''s three offerings; the moderation-blocked one is never listed');
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM public.ad_advertisable_pages(NULL, ARRAY['event','trip'], true,
      '42386666-0000-4000-8000-000000000010', 0)
    WHERE NOT ok AND canonical_url IS NOT NULL),
  'S4 greyed-out rows carry no link');
DO $s3$
BEGIN
  BEGIN
    PERFORM * FROM public.ad_advertisable_pages(NULL, NULL, true, '42386666-0000-4000-8000-000000000020', 0);
    RAISE EXCEPTION 'issue #4238 tester security FAIL: S3 member listed another brand';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  S3 a member asking for another brand is refused 42501';
  END;
  BEGIN
    PERFORM * FROM public.ad_advertisable_pages('birthday', NULL, true, NULL, 0);
    RAISE EXCEPTION 'issue #4238 tester security FAIL: S3 non-admin listed without a brand';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  S3 a non-admin without a brand scope is refused 42501';
  END;
END $s3$;
RESET ROLE;

-- ── S2 as a stranger ──
SELECT set_config('request.jwt.claim.sub', '42386666-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"42386666-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $s3b$
BEGIN
  BEGIN
    PERFORM * FROM public.ad_advertisable_pages(NULL, NULL, true, '42386666-0000-4000-8000-000000000010', 0);
    RAISE EXCEPTION 'issue #4238 tester security FAIL: S3 stranger listed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  S3 a stranger is refused the list 42501';
  END;
END $s3b$;
SELECT pg_temp.ok(
  public.ad_destination_resolve('event', 'issue-4238-sec', 'birthday')->>'availability' = 'private',
  'S2 a stranger resolving a private event is refused');
SELECT pg_temp.ok(pg_temp.bare(public.ad_destination_resolve('event', 'issue-4238-sec', 'birthday')),
  'S2 the private refusal carries no title, cover, city, id or brand');
SELECT pg_temp.ok(pg_temp.bare(public.ad_destination_resolve('event', 'issue-4238-sec', 'launch')),
  'S2 the unpublished refusal carries no title, cover, city, id or brand');
SELECT pg_temp.ok(pg_temp.bare(public.ad_destination_resolve('event', 'issue-4238-sec', 'blocked')),
  'S2 the moderation-blocked refusal carries no title, cover, city, id or brand');
RESET ROLE;

\echo 'issue #4238 tester security: all passed'
ROLLBACK;
