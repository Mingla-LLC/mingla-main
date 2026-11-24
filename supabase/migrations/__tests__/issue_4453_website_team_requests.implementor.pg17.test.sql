\set ON_ERROR_STOP on
-- #4453 Website workspace, team requests (20281119004453): executable
-- PostgreSQL 17 contract. BEGIN ... ROLLBACK: fixtures roll back.
-- MINGLA-INVARIANT: I-4453-WEBSITE-REQUEST-READ-SCOPE | issue #4453 | A website change request is read only by the person who sent it, by members of its brand who can open the website (rank 20 or more) and by Support staff; nobody inserts or deletes a row except through issue_4453_create_website_request.
-- MINGLA-INVARIANT: I-4453-WEBSITE-REQUEST-ONE-PER-ID | issue #4453 | Sending the same client request id again returns the request already filed and files nothing new; another person or another kind of ticket under that id is refused with PT409.
-- MINGLA-INVARIANT: I-4453-WEBSITE-REQUEST-READY-STAFF-ONLY | issue #4453 | Only Support staff mark a website change request ready; it moves the ticket to Waiting, tells everyone who can open the brand's website exactly once per press, and refuses a resolved or closed ticket with PT409.
--
-- T-1  shape: definer functions with a pinned search_path and static SQL; anon cannot call them; the table is RLS-forced with no client INSERT or DELETE.
-- T-2  the topic: website_change is a Host topic only.
-- T-3  happy path: the ticket, its 24-hour clock, the detail row, the thread, the staff alert and the audit rows.
-- T-4  idempotency.
-- T-5  validation refusals.
-- T-6  who may send: website access on the site's own, entitled brand.
-- T-7  RLS for every role.
-- T-8  "Ready for review": staff only, legal transitions, one notification per press.
-- T-9  the notification category is known to the dispatcher's denial reasons.
--
-- FAILS-ON-REVERT: drop 20281119004453 -> T-1a (no function). Drop website_change from the CHECK -> T-2a.
-- Drop the rank check from the create function -> T-6a. Drop the brand read policy's rank -> T-7c.
-- Drop issue_3720_support_operator_required from _ready -> T-8a. Drop the replay guard -> T-8g.

BEGIN;
-- #4579: this fixture predates automatic Mingla admin brand access (an active Mingla
-- admin now joins every brand as Brand admin; proven by
-- issue_4579_mingla_admin_brand_access.implementor.pg17.test.sql). Keep the fixture's
-- brands free of auto-added admins (also any a previous suite left behind) so the
-- checks below keep their meaning. Rolled back with the transaction.
ALTER TABLE public.brands DISABLE TRIGGER issue_4579_brand_auto_admins;
ALTER TABLE public.admin_users DISABLE TRIGGER issue_4579_admin_status_sync;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 team requests FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.p_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END
$a$;

-- Runs one create call and returns the SQLSTATE and message it raised ("ok" when it did not).
CREATE OR REPLACE FUNCTION pg_temp.p_create_error(
  p_id uuid, p_brand uuid, p_site uuid, p_what text, p_where jsonb,
  p_why text DEFAULT NULL, p_missing text DEFAULT NULL, p_digest text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM public.issue_4453_create_website_request(p_id, p_brand, p_site, p_what, p_where, p_why, p_missing, p_digest);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.p_ready_error(p_ticket uuid, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM public.issue_4453_website_request_ready(p_ticket, p_note);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$a$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- ── T-1 shape ──────────────────────────────────────────────────────────────
SELECT pg_temp.p_assert(count(*) = 3
    AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M' AND p.prosrc !~* '\mformat\s*\('),
  'T-1a three SECURITY DEFINER functions, pinned search_path, static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('issue_4453_create_website_request', 'issue_4453_website_request_ready', 'issue_4453_has_website_access');
SELECT pg_temp.p_assert(
    NOT has_function_privilege('anon', 'public.issue_4453_create_website_request(uuid,uuid,uuid,text,jsonb,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4453_website_request_ready(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4453_has_website_access(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.issue_4453_create_website_request(uuid,uuid,uuid,text,jsonb,text,text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.issue_4453_website_request_ready(uuid,text)', 'EXECUTE'),
  'T-1b anon cannot call them; a signed-in person can');
SELECT pg_temp.p_assert(c.relrowsecurity AND c.relforcerowsecurity,
  'T-1c the table has row security, forced')
FROM pg_class c WHERE c.oid = 'public.support_website_requests'::regclass;
SELECT pg_temp.p_assert(
    NOT has_table_privilege('authenticated', 'public.support_website_requests', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.support_website_requests', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.support_website_requests', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.support_website_requests', 'SELECT')
    AND has_table_privilege('authenticated', 'public.support_website_requests', 'SELECT')
    AND has_column_privilege('authenticated', 'public.support_website_requests', 'due_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.support_website_requests', 'ready_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.support_website_requests', 'what', 'UPDATE'),
  'T-1d no client INSERT or DELETE; only the clock and the note are client-updatable columns');
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_website_requests' AND cmd IN ('INSERT', 'DELETE', 'ALL')) = 0
    AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_website_requests' AND cmd = 'SELECT') = 3
    AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_website_requests' AND cmd = 'UPDATE') = 1,
  'T-1e three read policies, one staff update policy, no insert or delete policy');

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- staff a1 · owner b1 (rank 60) · marketing b2 (rank 20) · scanner b3 (rank 10)
-- other brand's owner c1 · stranger d1 · brand e1 with site f1 · other brand e2 with site f2
-- brand e3 (owner b1) has a site f3 but no website entitlement.
INSERT INTO auth.users(id, email) VALUES
  ('44530000-0000-4000-8000-0000000000a1', 'staff-4453t@example.test'),
  ('44530000-0000-4000-8000-0000000000b1', 'owner-4453t@example.test'),
  ('44530000-0000-4000-8000-0000000000b2', 'marketing-4453t@example.test'),
  ('44530000-0000-4000-8000-0000000000b3', 'scanner-4453t@example.test'),
  ('44530000-0000-4000-8000-0000000000c1', 'other-4453t@example.test'),
  ('44530000-0000-4000-8000-0000000000d1', 'stranger-4453t@example.test');
INSERT INTO public.admin_users(email, role, status)
VALUES ('staff-4453t@example.test', 'admin', 'active')
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
INSERT INTO public.support_staff(user_id, enabled, available, display_name)
VALUES ('44530000-0000-4000-8000-0000000000a1', true, true, 'Ada from Support')
ON CONFLICT (user_id) DO UPDATE SET enabled = true;
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES
  ('44530000-0000-4000-8000-0000000000b1', now(), now()),
  ('44530000-0000-4000-8000-0000000000c1', now(), now());
INSERT INTO public.brands(id, account_id, name, slug) VALUES
  ('44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000b1', 'Team Brand 4453', 'team-brand-4453'),
  ('44530000-0000-4000-8000-0000000000e2', '44530000-0000-4000-8000-0000000000c1', 'Other Brand 4453', 'other-brand-4453'),
  ('44530000-0000-4000-8000-0000000000e3', '44530000-0000-4000-8000-0000000000b1', 'No Site Brand 4453', 'no-site-brand-4453');
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000b1', 'brand_owner', now()),
  ('44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000b2', 'marketing_manager', now()),
  ('44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000b3', 'scanner', now()),
  ('44530000-0000-4000-8000-0000000000e2', '44530000-0000-4000-8000-0000000000c1', 'brand_owner', now()),
  ('44530000-0000-4000-8000-0000000000e3', '44530000-0000-4000-8000-0000000000b1', 'brand_owner', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.brand_site_entitlements(brand_id, status, source, granted_at, reason_code) VALUES
  ('44530000-0000-4000-8000-0000000000e1', 'granted', 'admin', now(), 'rollout'),
  ('44530000-0000-4000-8000-0000000000e2', 'granted', 'admin', now(), 'rollout')
ON CONFLICT (brand_id) DO UPDATE SET status = 'granted', granted_at = now(), revoked_at = NULL, revoked_by = NULL;
DELETE FROM public.brand_site_entitlements WHERE brand_id = '44530000-0000-4000-8000-0000000000e3';
INSERT INTO public.brand_sites(id, brand_id, created_by) VALUES
  ('44530000-0000-4000-8000-0000000000f1', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000b1'),
  ('44530000-0000-4000-8000-0000000000f2', '44530000-0000-4000-8000-0000000000e2', '44530000-0000-4000-8000-0000000000c1'),
  ('44530000-0000-4000-8000-0000000000f3', '44530000-0000-4000-8000-0000000000e3', '44530000-0000-4000-8000-0000000000b1');

-- ── T-2 the topic ──────────────────────────────────────────────────────────
SELECT pg_temp.p_assert(pg_get_constraintdef(oid) ~ 'website_change',
  'T-2a the ticket topic CHECK lists website_change')
FROM pg_constraint WHERE conname = 'support_tickets_topic_check' AND conrelid = 'public.support_tickets'::regclass;
DO $t$
BEGIN
  PERFORM pg_temp.p_as('44530000-0000-4000-8000-0000000000d1');
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      '44530000-0000-4000-8000-000000000901', 'explorer', 'website_change', NULL, 'not a host topic',
      ARRAY[]::uuid[], '{}'::jsonb, NULL, 'person');
    RAISE EXCEPTION 'issue #4453 team requests FAIL: T-2b an Explorer ticket took the website topic';
  EXCEPTION WHEN sqlstate '22023' THEN
    RAISE NOTICE 'PASS  T-2b website_change is refused for an Explorer ticket';
  END;
  -- The other Host topics still work through the shared create path.
  PERFORM pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
  PERFORM public.issue_4382_create_customer_ticket(
    '44530000-0000-4000-8000-000000000902', 'host', 'payouts', NULL, 'Payout shows zero',
    ARRAY[]::uuid[], '{}'::jsonb, '44530000-0000-4000-8000-0000000000e1', 'brand');
  PERFORM pg_temp.p_assert((SELECT topic = 'payouts' FROM public.support_tickets WHERE id = '44530000-0000-4000-8000-000000000902'),
    'T-2c an ordinary Host ticket is filed as before');
END
$t$;

-- ── T-3 happy path (the marketing member, rank 20, sends it) ───────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b2');
CREATE TEMP TABLE t4453_created ON COMMIT DROP AS
SELECT public.issue_4453_create_website_request(
  '44530000-0000-4000-8000-000000000101',
  '44530000-0000-4000-8000-0000000000e1',
  '44530000-0000-4000-8000-0000000000f1',
  '  Add a video background to the top of the home page  ',
  '{"page_path":"/","section_id":"sec_hero-1","section_label":"Top of the page"}'::jsonb,
  'Our launch film is the main thing people ask about.',
  'Ari cannot put a video behind a section yet.',
  'sha256:0a1b2c3d') AS result;
RESET ROLE;
GRANT SELECT ON t4453_created TO PUBLIC;

SELECT pg_temp.p_assert(
    result->>'ticket_id' = '44530000-0000-4000-8000-000000000101'
    AND (result->>'ticket_number')::bigint = (SELECT ticket_number FROM public.support_tickets WHERE id = '44530000-0000-4000-8000-000000000101')
    AND (result->>'ticket_number')::bigint >= 1001
    AND (result->>'replayed')::boolean IS FALSE,
  'T-3a returns the ticket id and its S-number')
FROM t4453_created;
SELECT pg_temp.p_assert(
    t.topic = 'website_change' AND t.visibility = 'brand' AND t.origin = 'customer'
    AND t.requester_segment = 'business' AND t.status = 'new'
    AND t.brand_id = '44530000-0000-4000-8000-0000000000e1'
    AND t.requester_user_id = '44530000-0000-4000-8000-0000000000b2'
    AND t.subject = 'Website change: Add a video background to the top of the home page'
    AND t.client_meta = '{"source_screen":"Website"}'::jsonb
    AND t.last_sender_kind = 'customer',
  'T-3b the ticket: Host app, website topic, shared with the brand')
FROM public.support_tickets t WHERE t.id = '44530000-0000-4000-8000-000000000101';
SELECT pg_temp.p_assert(
    r.brand_id = '44530000-0000-4000-8000-0000000000e1'
    AND r.site_id = '44530000-0000-4000-8000-0000000000f1'
    AND r.requested_by = '44530000-0000-4000-8000-0000000000b2'
    AND r.page_path = '/' AND r.section_id = 'sec_hero-1' AND r.section_label = 'Top of the page'
    AND r.what = 'Add a video background to the top of the home page'
    AND r.why = 'Our launch film is the main thing people ask about.'
    AND r.missing_capability = 'Ari cannot put a video behind a section yet.'
    AND r.draft_digest = 'sha256:0a1b2c3d'
    AND r.ready_at IS NULL AND r.ready_by IS NULL,
  'T-3c the detail row holds what, where, why, what Ari could not do and the draft version')
FROM public.support_website_requests r WHERE r.ticket_id = '44530000-0000-4000-8000-000000000101';
SELECT pg_temp.p_assert(
    r.due_at = t.next_update_at
    AND r.due_at BETWEEN now() + interval '23 hours 59 minutes' AND now() + interval '24 hours 1 minute',
  'T-3d the 24-hour clock is the ticket''s promised next update')
FROM public.support_website_requests r JOIN public.support_tickets t ON t.id = r.ticket_id
WHERE r.ticket_id = '44530000-0000-4000-8000-000000000101';
SELECT pg_temp.p_assert(
    count(*) = 1
    AND bool_and(m.content LIKE 'What I want: Add a video background%'
      AND m.content LIKE '%Where: Home page · Top of the page%'
      AND m.content LIKE '%Why: Our launch film%'
      AND m.content LIKE '%What Ari could not do: Ari cannot put a video%'
      AND NOT m.is_internal AND m.sender_id = '44530000-0000-4000-8000-0000000000b2'),
  'T-3e the thread opens with the request in plain words')
FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id
WHERE t.id = '44530000-0000-4000-8000-000000000101';
SELECT pg_temp.p_assert(
    EXISTS (SELECT 1 FROM public.notification_outbox
            WHERE category_key = 'business.support_new_ticket'
              AND user_id = '44530000-0000-4000-8000-0000000000a1'
              AND payload->>'ticket_id' = '44530000-0000-4000-8000-000000000101'),
  'T-3f Support staff hear about it like any new ticket');
SELECT pg_temp.p_assert(
    NOT EXISTS (SELECT 1 FROM public.notification_outbox
                WHERE category_key = 'business.support_status_changed'
                  AND payload->>'ticket_id' = '44530000-0000-4000-8000-000000000101'),
  'T-3g setting the clock sends the brand no "update time" alert');
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.support_audit_log
      WHERE ticket_id = '44530000-0000-4000-8000-000000000101' AND action = 'ticket_created') = 1
    AND (SELECT count(*) FROM public.support_audit_log
      WHERE ticket_id = '44530000-0000-4000-8000-000000000101' AND action = 'website_request_created'
        AND actor_user_id = '44530000-0000-4000-8000-0000000000b2') = 1,
  'T-3h both audit rows are written');
SELECT pg_temp.p_assert(
    t.status NOT IN ('resolved', 'closed') AND t.next_update_at <= now() + interval '25 hours',
  'T-3i an unanswered request is overdue for the desk and the sweep after 24 hours')
FROM public.support_tickets t WHERE t.id = '44530000-0000-4000-8000-000000000101';

-- ── T-4 idempotency ────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b2');
SELECT pg_temp.p_assert(
    again->>'ticket_id' = '44530000-0000-4000-8000-000000000101'
    AND again->>'ticket_number' = (SELECT result->>'ticket_number' FROM t4453_created)
    AND (again->>'replayed')::boolean,
  'T-4a the same request id returns the request already filed')
FROM (SELECT public.issue_4453_create_website_request(
  '44530000-0000-4000-8000-000000000101', '44530000-0000-4000-8000-0000000000e1',
  '44530000-0000-4000-8000-0000000000f1', 'Something else entirely', NULL, NULL, NULL, NULL) AS again) s;
-- Another person with the same id.
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000101', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', 'Mine now', NULL) = 'PT409:request_id_taken',
  'T-4b another person cannot reuse the id (PT409)');
-- The same person, but the id is an ordinary ticket of theirs.
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000902', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', 'Turn my payout ticket into a request', NULL) = 'PT409:request_id_taken',
  'T-4c an ordinary ticket''s id is not turned into a request (PT409)');
RESET ROLE;
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.support_website_requests) = 1
    AND (SELECT what FROM public.support_website_requests) = 'Add a video background to the top of the home page'
    AND (SELECT count(*) FROM public.support_tickets WHERE topic = 'website_change') = 1
    AND (SELECT count(*) FROM public.notification_outbox
          WHERE category_key = 'business.support_new_ticket'
            AND payload->>'ticket_id' = '44530000-0000-4000-8000-000000000101') = 1,
  'T-4d replays filed nothing new and alerted nobody twice');

-- ── T-5 validation ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
SELECT pg_temp.p_assert(got = want, 'T-5 ' || label || ' (got ' || got || ')')
FROM (VALUES
  ('a what is required', '22023:what_required',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', '   ', NULL)),
  ('b what over 2000 characters', '22023:what_too_long',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', repeat('a', 2001), NULL)),
  ('c why over 2000 characters', '22023:why_too_long',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', NULL, repeat('a', 2001))),
  ('d what Ari could not do over 1000 characters', '22023:missing_capability_too_long',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', NULL, NULL, repeat('a', 1001))),
  ('e where is not an object', '22023:where_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '["/"]'::jsonb)),
  ('f where carries an unknown key', '22023:where_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '{"page_path":"/","sql":"x"}'::jsonb)),
  ('g where carries a non-text value', '22023:where_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '{"page_path":{"a":1}}'::jsonb)),
  ('h page path must start with a slash', '22023:page_path_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '{"page_path":"https://evil.example/x"}'::jsonb)),
  ('i page path with a space', '22023:page_path_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '{"page_path":"/a b"}'::jsonb)),
  ('j page path over 300 characters', '22023:page_path_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', jsonb_build_object('page_path', '/' || repeat('a', 300)))),
  ('k section id with odd characters', '22023:section_id_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '{"page_path":"/","section_id":"a b;c"}'::jsonb)),
  ('l a section without its page', '22023:section_needs_page',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', '{"section_id":"abc"}'::jsonb)),
  ('m section label over 120 characters', '22023:section_label_too_long',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', jsonb_build_object('page_path', '/', 'section_label', repeat('a', 121)))),
  ('n draft version with odd characters', '22023:draft_digest_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', NULL, NULL, NULL, 'abc def')),
  ('o draft version over 128 characters', '22023:draft_digest_invalid',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', NULL, NULL, NULL, repeat('a', 129))),
  ('p no request id', '22023:client_request_id_required',
    pg_temp.p_create_error(NULL, '44530000-0000-4000-8000-0000000000e1', '44530000-0000-4000-8000-0000000000f1', 'ok', NULL)),
  ('q no brand', '22023:brand_and_site_required',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', NULL, '44530000-0000-4000-8000-0000000000f1', 'ok', NULL)),
  ('r no site', '22023:brand_and_site_required',
    pg_temp.p_create_error('44530000-0000-4000-8000-000000000201', '44530000-0000-4000-8000-0000000000e1', NULL, 'ok', NULL))
) AS cases(label, want, got);
RESET ROLE;
SELECT pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = '44530000-0000-4000-8000-000000000201'),
  'T-5s a refused request leaves no ticket behind');
-- A site-wide request (no page) and an ask with only the what are accepted.
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000102', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', E'Make the whole site feel warmer\nand more like our venue', NULL) = 'ok',
  'T-5t a request with only the what is accepted (no where, no why, a null draft version)');
RESET ROLE;
SELECT pg_temp.p_assert(
    r.page_path IS NULL AND r.section_id IS NULL AND r.why IS NULL AND r.missing_capability IS NULL AND r.draft_digest IS NULL
    AND t.subject = 'Website change: Make the whole site feel warmer and more like our venue',
  'T-5u empty parts are stored as empty; the subject is one line')
FROM public.support_website_requests r JOIN public.support_tickets t ON t.id = r.ticket_id
WHERE r.ticket_id = '44530000-0000-4000-8000-000000000102';

-- ── T-6 who may send ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b3');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000301', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', 'ok', NULL) = '42501:website_access_required',
  'T-6a a brand member without website access (scanner) is refused');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000c1');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000301', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', 'ok', NULL) = '42501:website_access_required',
  'T-6b another brand''s owner is refused');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000301', '44530000-0000-4000-8000-0000000000e2',
    '44530000-0000-4000-8000-0000000000f1', 'ok', NULL) = '42501:website_access_required',
  'T-6c own brand with another brand''s site is refused');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000d1');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000301', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', 'ok', NULL) = '42501:website_access_required',
  'T-6d a stranger is refused');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000301', '44530000-0000-4000-8000-0000000000e3',
    '44530000-0000-4000-8000-0000000000f3', 'ok', NULL) = '42501:website_access_required',
  'T-6e a brand whose website is not switched on is refused');
SELECT pg_temp.p_as(NULL);
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000301', '44530000-0000-4000-8000-0000000000e1',
    '44530000-0000-4000-8000-0000000000f1', 'ok', NULL) = '42501:not_authenticated',
  'T-6f a signed-in role with no user is refused');
RESET ROLE;
-- (anon holds no EXECUTE on the function: T-1b.)
SELECT pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = '44530000-0000-4000-8000-000000000301'),
  'T-6g no refused caller left a ticket behind');

-- ── T-7 RLS ────────────────────────────────────────────────────────────────
-- Two requests exist on brand e1: 101 (by marketing b2) and 102 (by owner b1).
-- The other brand files one of its own.
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000c1');
SELECT pg_temp.p_assert(pg_temp.p_create_error(
    '44530000-0000-4000-8000-000000000103', '44530000-0000-4000-8000-0000000000e2',
    '44530000-0000-4000-8000-0000000000f2', 'Other brand request', '{"page_path":"/about"}'::jsonb) = 'ok',
  'T-7a the other brand files its own request');
SELECT pg_temp.p_assert((SELECT count(*) FROM public.support_website_requests) = 1
    AND (SELECT ticket_id FROM public.support_website_requests) = '44530000-0000-4000-8000-000000000103',
  'T-7b the other brand''s owner reads only their own brand''s request');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b2');
SELECT pg_temp.p_assert((SELECT count(*) FROM public.support_website_requests) = 2
    AND NOT EXISTS (SELECT 1 FROM public.support_website_requests WHERE brand_id <> '44530000-0000-4000-8000-0000000000e1'),
  'T-7c a member with website access reads every request of their brand, and no other brand''s');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b3');
SELECT pg_temp.p_assert((SELECT count(*) FROM public.support_website_requests) = 0,
  'T-7d a brand member without website access reads none');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000d1');
SELECT pg_temp.p_assert((SELECT count(*) FROM public.support_website_requests) = 0,
  'T-7e a stranger reads none');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert((SELECT count(*) FROM public.support_website_requests) = 3,
  'T-7f Support staff read every request');
RESET ROLE;
DO $t$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM pg_temp.p_as(NULL);
  BEGIN
    PERFORM count(*) FROM public.support_website_requests;
    RAISE EXCEPTION 'issue #4453 team requests FAIL: T-7g anon read the table';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  T-7g anon cannot read the table';
  END;
  RESET ROLE;

  -- Direct writes.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
  BEGIN
    INSERT INTO public.support_website_requests(ticket_id, brand_id, what)
    VALUES ('44530000-0000-4000-8000-000000000902', '44530000-0000-4000-8000-0000000000e1', 'direct');
    RAISE EXCEPTION 'issue #4453 team requests FAIL: T-7h a member inserted a row directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  T-7h nobody inserts a row directly';
  END;
  BEGIN
    DELETE FROM public.support_website_requests WHERE ticket_id = '44530000-0000-4000-8000-000000000102';
    RAISE EXCEPTION 'issue #4453 team requests FAIL: T-7i a member deleted a row directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  T-7i nobody deletes a row directly';
  END;
  BEGIN
    UPDATE public.support_website_requests SET ready_at = now() WHERE ticket_id = '44530000-0000-4000-8000-000000000102';
    RAISE EXCEPTION 'issue #4453 team requests FAIL: T-7j a member stamped ready directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  T-7j ready is stamped only by the staff function';
  END;
  RESET ROLE;
END
$t$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
WITH moved AS (
  UPDATE public.support_website_requests SET due_at = now() + interval '9 days'
   WHERE ticket_id = '44530000-0000-4000-8000-000000000102' RETURNING 1
)
SELECT pg_temp.p_assert((SELECT count(*) FROM moved) = 0, 'T-7k an owner cannot move the clock on their own request');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
WITH moved AS (
  UPDATE public.support_website_requests SET due_at = now() + interval '30 hours'
   WHERE ticket_id = '44530000-0000-4000-8000-000000000102' RETURNING 1
)
SELECT pg_temp.p_assert((SELECT count(*) FROM moved) = 1, 'T-7l Support staff can move the clock');
RESET ROLE;
-- The person who sent a request keeps reading it after losing website access.
UPDATE public.brand_team_members SET removed_at = now()
 WHERE brand_id = '44530000-0000-4000-8000-0000000000e1' AND user_id = '44530000-0000-4000-8000-0000000000b2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b2');
SELECT pg_temp.p_assert((SELECT count(*) FROM public.support_website_requests) = 1
    AND (SELECT ticket_id FROM public.support_website_requests) = '44530000-0000-4000-8000-000000000101',
  'T-7m the person who sent it still reads their own request, and only that one');
RESET ROLE;
UPDATE public.brand_team_members SET removed_at = NULL
 WHERE brand_id = '44530000-0000-4000-8000-0000000000e1' AND user_id = '44530000-0000-4000-8000-0000000000b2';

-- ── T-8 "Ready for review" ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000b1');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000101', 'done') = '42501:forbidden',
  'T-8a a brand owner cannot mark a request ready');
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000d1');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000101') = '42501:forbidden',
  'T-8b a stranger cannot mark a request ready');
RESET ROLE;
-- (anon holds no EXECUTE on the function: T-1b.)
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000999') = 'P0002:request_not_found',
  'T-8d an unknown ticket is not found');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000902') = 'P0002:request_not_found',
  'T-8e an ordinary ticket is not a website request');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000101', repeat('a', 1001)) = '22023:note_too_long',
  'T-8f a note over 1000 characters is refused');
SELECT pg_temp.p_assert(pg_temp.p_ready_error(NULL) = '22023:ticket_required',
  'T-8f2 a ticket is required');
RESET ROLE;
SELECT pg_temp.p_assert(
    (SELECT ready_at IS NULL FROM public.support_website_requests WHERE ticket_id = '44530000-0000-4000-8000-000000000101')
    AND NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.website_request_ready'),
  'T-8f3 no refused press stamped or told anyone');

-- The happy press.
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
CREATE TEMP TABLE t4453_ready ON COMMIT DROP AS
SELECT public.issue_4453_website_request_ready(
  '44530000-0000-4000-8000-000000000101', '  The video sits behind the heading. Tell us if it is too dark.  ') AS result;
RESET ROLE;
SELECT pg_temp.p_assert(
    result->>'status' = 'pending' AND (result->>'notified')::int = 2 AND (result->>'replayed')::boolean IS FALSE
    AND result->>'ticket_id' = '44530000-0000-4000-8000-000000000101',
  'T-8g returns Waiting and how many people were told')
FROM t4453_ready;
SELECT pg_temp.p_assert(
    r.ready_at IS NOT NULL AND r.ready_by = '44530000-0000-4000-8000-0000000000a1'
    AND r.ready_note = 'The video sits behind the heading. Tell us if it is too dark.'
    AND t.status = 'pending' AND t.first_response_at IS NOT NULL AND t.last_sender_kind = 'staff'
    AND t.next_update_at > r.due_at AND t.next_update_at > now() + interval '6 days',
  'T-8h ready is stamped, the ticket is Waiting, and it is no longer due')
FROM public.support_website_requests r JOIN public.support_tickets t ON t.id = r.ticket_id
WHERE r.ticket_id = '44530000-0000-4000-8000-000000000101';
SELECT pg_temp.p_assert(
    EXISTS (SELECT 1 FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id
            WHERE t.id = '44530000-0000-4000-8000-000000000101'
              AND m.sender_id = '44530000-0000-4000-8000-0000000000a1' AND NOT m.is_internal
              AND m.content LIKE 'Your website change is ready for you to review.%'
              AND m.content LIKE '%Tell us if it is too dark.'),
  'T-8i the thread carries the ready reply and the note');
SELECT pg_temp.p_assert(
    count(*) = 2
    AND bool_and(o.user_id IN ('44530000-0000-4000-8000-0000000000b1', '44530000-0000-4000-8000-0000000000b2'))
    AND count(DISTINCT o.user_id) = 2
    AND bool_and(o.status = 'pending' AND o.brand_id = '44530000-0000-4000-8000-0000000000e1')
    AND bool_and(o.payload->>'deep_link' = 'mingla-business://brand/44530000-0000-4000-8000-0000000000e1/website?request=44530000-0000-4000-8000-000000000101')
    -- #1529: this producer decides the country at enqueue. No SMS leg, so an explicit NULL.
    AND bool_and(o.country_code IS NULL)
    AND bool_and((o.payload->>'push')::boolean)
    AND bool_and(o.payload->>'ticket_id' = '44530000-0000-4000-8000-000000000101'
      AND o.payload->>'brand_id' = '44530000-0000-4000-8000-0000000000e1'
      AND o.payload->>'section_label' = 'Top of the page' AND o.payload->>'page_path' = '/'
      AND o.payload->>'what' = 'Add a video background to the top of the home page'
      AND o.payload->>'note' LIKE 'The video sits behind%'
      AND (o.payload->>'ticket_number')::bigint >= 1001),
  'T-8j the owner and the member with website access are told; the scanner, the other brand and staff are not')
FROM public.notification_outbox o WHERE o.category_key = 'business.website_request_ready';
SELECT pg_temp.p_assert(
    c.default_channels @> ARRAY['inapp', 'push', 'email']::text[] AND c.active AND c.is_transactional,
  'T-8k the category sends the bell, a push and an email')
FROM public.notification_categories c WHERE c.key = 'business.website_request_ready';
SELECT pg_temp.p_assert(
    NOT EXISTS (SELECT 1 FROM public.notification_outbox
                WHERE category_key = 'business.support_status_changed'
                  AND payload->>'ticket_id' = '44530000-0000-4000-8000-000000000101'),
  'T-8l the move to Waiting sends no second, generic status alert');
SELECT pg_temp.p_assert(
    EXISTS (SELECT 1 FROM public.support_audit_log
            WHERE ticket_id = '44530000-0000-4000-8000-000000000101' AND action = 'website_request_ready'
              AND actor_user_id = '44530000-0000-4000-8000-0000000000a1' AND (metadata->>'notified')::int = 2)
    AND EXISTS (SELECT 1 FROM public.support_audit_log
            WHERE ticket_id = '44530000-0000-4000-8000-000000000101' AND action = 'staff_reply'),
  'T-8m the press is audited');

-- Pressing it again tells nobody again.
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert((again->>'replayed')::boolean AND (again->>'notified')::int = 0
    AND again->>'ready_at' = (SELECT result->>'ready_at' FROM t4453_ready),
  'T-8n a second press returns the first press')
FROM (SELECT public.issue_4453_website_request_ready('44530000-0000-4000-8000-000000000101', 'again') AS again) s;
RESET ROLE;
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.website_request_ready') = 2
    AND (SELECT ready_note FROM public.support_website_requests WHERE ticket_id = '44530000-0000-4000-8000-000000000101') LIKE 'The video sits%',
  'T-8o a second press queued nothing and changed nothing');

-- The owner replies (the ticket reopens); staff can mark it ready again and the owner hears again.
SELECT public.issue_4382_post_support_message(
  '44530000-0000-4000-8000-000000000101', '44530000-0000-4000-8000-0000000000b1', false, 'A little too dark, please lighten it.');
SELECT pg_temp.p_assert((SELECT status = 'open' FROM public.support_tickets WHERE id = '44530000-0000-4000-8000-000000000101'),
  'T-8p the owner''s reply reopens the ticket');
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert((again->>'replayed')::boolean IS FALSE AND (again->>'notified')::int = 2 AND again->>'status' = 'pending',
  'T-8q after a reply, ready can be pressed again and the owner is told again')
FROM (SELECT public.issue_4453_website_request_ready('44530000-0000-4000-8000-000000000101', NULL) AS again) s;
RESET ROLE;
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.website_request_ready') = 4
    AND (SELECT ready_note IS NULL FROM public.support_website_requests WHERE ticket_id = '44530000-0000-4000-8000-000000000101'),
  'T-8r the second round queued its own alerts; an empty note clears the old one');

-- A finished request is not moved to Waiting.
UPDATE public.support_tickets SET status = 'resolved', resolved_at = now() WHERE id = '44530000-0000-4000-8000-000000000102';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000102') = 'PT409:illegal_transition',
  'T-8s a resolved request refuses ready (PT409)');
RESET ROLE;
UPDATE public.support_tickets SET status = 'closed' WHERE id = '44530000-0000-4000-8000-000000000102';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000102') = 'PT409:illegal_transition',
  'T-8t a closed request refuses ready (PT409)');
-- An open request (staff already replied once) can be marked ready.
RESET ROLE;
UPDATE public.support_tickets SET status = 'open', resolved_at = NULL WHERE id = '44530000-0000-4000-8000-000000000102';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_as('44530000-0000-4000-8000-0000000000a1');
SELECT pg_temp.p_assert(pg_temp.p_ready_error('44530000-0000-4000-8000-000000000102') = 'ok',
  'T-8u an open request can be marked ready');
RESET ROLE;
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.notification_outbox o
      WHERE o.category_key = 'business.website_request_ready'
        AND o.payload->>'ticket_id' = '44530000-0000-4000-8000-000000000102') = 2
    AND (SELECT count(*) FROM public.notification_outbox o
      WHERE o.category_key = 'business.website_request_ready'
        AND o.payload->>'ticket_id' = '44530000-0000-4000-8000-000000000102'
        AND o.payload->>'deep_link' = 'mingla-business://brand/44530000-0000-4000-8000-0000000000e1/website?request=44530000-0000-4000-8000-000000000102'
        AND NOT (o.payload ? 'section_label' AND o.payload->>'section_label' IS NOT NULL)) = 2,
  'T-8v a site-wide request tells the same people, with its own link');

-- ── T-9 the dispatcher knows the category ──────────────────────────────────
SELECT pg_temp.p_assert(
    public.issue_3720_notification_denial_reason('44530000-0000-4000-8000-0000000000b1', 'business.website_request_ready', 'sms', NULL) = 'channel_inactive'
    AND public.issue_3720_notification_denial_reason('44530000-0000-4000-8000-0000000000b1', 'business.not_a_category', 'sms', NULL) = 'policy_denied'
    AND public.issue_3720_notification_denial_reason('44530000-0000-4000-8000-0000000000b1', 'business.support_status_changed', 'sms', NULL) = 'channel_inactive',
  'T-9a denial reasons know the new category and keep the old ones');

ROLLBACK;
