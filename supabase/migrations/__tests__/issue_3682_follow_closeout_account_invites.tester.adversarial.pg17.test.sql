-- #3682 closeout — TESTER adversarial suite (account-only follower invites).
-- Different angles from the implementor suite:
--   T2-01  a Book person the host EXCLUDED is not smuggled back in through the
--          account lane when "Followers" is selected.
--   T2-02  a follower who is linked to a selected Book person AFTER the seal
--          gets one invite (the Book one), never a second account invite.
--   T2-03  mute and "stop invites through friends" between seal and dispatch
--          skip every channel.
--   T2-04  the monthly email allowance is ONE pool: campaign email used before
--          dispatch shrinks invite email, invite email counts against the next
--          campaign confirm, and push is never capped by it.
--   T2-05  another brand's host cannot read or write this offering's plan or
--          its delivery view.
--   T2-06  every function the host role can execute that touches the
--          account-invite tables is on a reviewed allowlist, the private
--          tables are unreachable, and none of them returns an address.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('business_wizard_invite_selection_v1', 'business_wizard_invite_dispatch_v1',
  'brand_circle_followers_v1');
UPDATE public.feature_flags SET is_enabled = false
WHERE flag_key IN ('brand_circle_extended_v1', 'brand_circle_extended_controls_ios_v1',
  'brand_circle_extended_controls_android_v1');

CREATE TABLE IF NOT EXISTS auth.identities(
  user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
  provider_id text NOT NULL);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

-- 01 owner A, 02 owner B, 11..16 followers of A.
INSERT INTO auth.users(id, phone) VALUES
  ('3682c200-0000-4000-8000-000000000001', NULL),
  ('3682c200-0000-4000-8000-000000000002', NULL),
  ('3682c200-0000-4000-8000-000000000011', '+15553682211'),
  ('3682c200-0000-4000-8000-000000000012', '+15553682212'),
  ('3682c200-0000-4000-8000-000000000013', '+15553682213'),
  ('3682c200-0000-4000-8000-000000000014', '+15553682214'),
  ('3682c200-0000-4000-8000-000000000015', '+15553682215'),
  ('3682c200-0000-4000-8000-000000000016', '+15553682216');
INSERT INTO auth.identities(user_id, provider, identity_data, provider_id)
SELECT u.id, 'email', jsonb_build_object('email', 'secret-' || right(u.id::text, 2) || '@leak.example.test'), u.id::text
  FROM auth.users u WHERE u.id::text LIKE '3682c200-0000-4000-8000-00000000001%';
INSERT INTO public.creator_accounts(id, email, display_name) VALUES
  ('3682c200-0000-4000-8000-000000000001', 'owner-a-3682t2@example.test', 'Owner A'),
  ('3682c200-0000-4000-8000-000000000002', 'owner-b-3682t2@example.test', 'Owner B');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('3682c200-0000-4000-8000-0000000000a0', '3682c200-0000-4000-8000-000000000001',
   'T2 Brand A', 'issue-3682-t2-a', 'USD', now(), now()),
  ('3682c200-0000-4000-8000-0000000000b0', '3682c200-0000-4000-8000-000000000002',
   'T2 Brand B', 'issue-3682-t2-b', 'USD', now(), now());
INSERT INTO public.events(
  id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, party_types, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at
)
SELECT ('3682c200-1000-4000-8000-00000000000' || n)::uuid, '3682c200-0000-4000-8000-0000000000a0',
  '3682c200-0000-4000-8000-000000000001', 'event', 'T2 draft ' || n, 'issue-3682-t2-' || n,
  'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now()
  FROM generate_series(1, 2) n;
INSERT INTO public.profiles(id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode)
SELECT u.id, 'Guest', right(u.id::text, 2), 'Guest ' || right(u.id::text, 2),
  't2-3682-' || right(u.id::text, 2), true, true, 'friends'
  FROM auth.users u WHERE u.id::text LIKE '3682c200-0000-4000-8000-00000000001%';
-- bp14: Book person linked to follower 14 (the host will exclude it).
-- bp15: Book person with no account yet; follower 15 links to it after seal.
INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status) VALUES
  ('3682c200-2000-4000-8000-000000000014', '3682c200-0000-4000-8000-0000000000a0',
   '3682c200-0000-4000-8000-000000000014', 'Guest 14', 'active'),
  ('3682c200-2000-4000-8000-000000000015', '3682c200-0000-4000-8000-0000000000a0',
   NULL, 'Guest 15 (Book)', 'active');
INSERT INTO public.brand_follows(user_id, brand_id)
SELECT u.id, '3682c200-0000-4000-8000-0000000000a0'
  FROM auth.users u WHERE u.id::text LIKE '3682c200-0000-4000-8000-00000000001%';
-- Monthly email allowance of 3 for brand A; one campaign email already used.
INSERT INTO public.brand_messaging_limits(brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, reason)
VALUES ('3682c200-0000-4000-8000-0000000000a0', 3, 100, NULL, 5, 'issue 3682 tester');
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
VALUES ('3682c200-5000-4000-8000-000000000001', '3682c200-0000-4000-8000-000000000001',
  '3682c200-0000-4000-8000-0000000000a0', 'Followers',
  jsonb_build_object('kind', 'brand_followers', 'brand_id', '3682c200-0000-4000-8000-0000000000a0'), true);
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
VALUES
  ('3682c200-6000-4000-8000-000000000001', '3682c200-0000-4000-8000-000000000001',
   '3682c200-0000-4000-8000-0000000000a0', '3682c200-5000-4000-8000-000000000001', 'Earlier email', 'email',
   '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft'),
  ('3682c200-6000-4000-8000-000000000002', '3682c200-0000-4000-8000-000000000001',
   '3682c200-0000-4000-8000-0000000000a0', '3682c200-5000-4000-8000-000000000001', 'Later email', 'email',
   '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft');
INSERT INTO public.marketing_book_send_executions(
  brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
  selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
  estimated_cost_minor, currency, cost_kind, quoted_at, scheduled_for, send_mode)
VALUES ('3682c200-0000-4000-8000-0000000000a0', '3682c200-6000-4000-8000-000000000001',
  '3682c200-0000-4000-8000-000000000001', gen_random_uuid(), 1, repeat('a', 64), repeat('a', 64),
  1, 1, 0, 0, 0, NULL, NULL, 'not_metered', now(), now(), 'now');

-- ── Host A selects: Followers + Book person 15, excluding Book person 14 ────
SELECT set_config('request.jwt.claim.sub', '3682c200-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c200-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t2a$
DECLARE v jsonb;
BEGIN
  v := public.biz_replace_offering_invite_plan_v1('3682c200-1000-4000-8000-000000000001',
    '{"excludedPersonIds":["3682c200-2000-4000-8000-000000000014"],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":["3682c200-2000-4000-8000-000000000015"]}',
    0, '3682c200-3000-4000-8000-000000000001');
  -- Book lane: bp15 only. Account lane: 11, 12, 13, 15, 16 (14 is Book-linked).
  IF v -> 'brandPersonIds' <> '["3682c200-2000-4000-8000-000000000015"]'::jsonb
     OR (v ->> 'accountRecipientCount')::int <> 5 THEN
    RAISE EXCEPTION 'T2-01 FAIL: plan %', v;
  END IF;
  v := public.biz_replace_offering_invite_plan_v1('3682c200-1000-4000-8000-000000000002',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '3682c200-3000-4000-8000-000000000002');
END;
$t2a$;
RESET ROLE;

DO $t2b$
BEGIN
  -- T2-01 The excluded Book person's account is nowhere in the plan.
  IF EXISTS (SELECT 1 FROM private.brand_offering_invite_plan_accounts a
               JOIN private.brand_offering_invite_plans p ON p.id = a.plan_id
              WHERE p.event_id = '3682c200-1000-4000-8000-000000000001'
                AND a.user_id = '3682c200-0000-4000-8000-000000000014')
     OR EXISTS (SELECT 1 FROM private.brand_offering_invite_plan_members m
               JOIN private.brand_offering_invite_plans p ON p.id = m.plan_id
              WHERE p.event_id = '3682c200-1000-4000-8000-000000000001'
                AND m.brand_person_id = '3682c200-2000-4000-8000-000000000014') THEN
    RAISE EXCEPTION 'T2-01 FAIL: an excluded Book person came back through Followers';
  END IF;
END;
$t2b$;

-- Publish event 1 only (event 2 is published after the cap is spent).
SELECT private.enqueue_wizard_invites_on_publish_v1('3682c200-1000-4000-8000-000000000001', 1, true);

-- ── Between seal and dispatch ───────────────────────────────────────────────
-- 12 mutes the brand, 13 stops invites through friends (still following),
-- 15 signs up and is linked to the selected Book person bp15.
UPDATE public.brand_follows SET muted_until = 'infinity'
 WHERE user_id = '3682c200-0000-4000-8000-000000000012' AND brand_id = '3682c200-0000-4000-8000-0000000000a0';
INSERT INTO public.brand_circle_exits(brand_id, user_id, visibility_exited_at, delivery_exited_at)
VALUES ('3682c200-0000-4000-8000-0000000000a0', '3682c200-0000-4000-8000-000000000013', now(), now());
UPDATE public.brand_people SET linked_user_id = '3682c200-0000-4000-8000-000000000015'
 WHERE id = '3682c200-2000-4000-8000-000000000015';

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $t2c$
DECLARE v_jobs jsonb; v_job jsonb; v_build jsonb;
BEGIN
  v_jobs := public.issue_1780_claim_wizard_invite_outbox_v1(10);
  SELECT j INTO v_job FROM jsonb_array_elements(v_jobs) j
   WHERE j ->> 'eventId' = '3682c200-1000-4000-8000-000000000001';
  v_build := public.issue_3682_build_wizard_account_invites_v1(
    (v_job ->> 'outboxJobId')::uuid, (v_job ->> 'sealedSelectionId')::uuid, (v_job ->> 'leaseToken')::uuid);
  PERFORM set_config('t2.build', v_build::text, true);
END;
$t2c$;
RESET ROLE;

DO $t2d$
DECLARE v_build jsonb := current_setting('t2.build')::jsonb;
  v_reason text[];
BEGIN
  -- T2-02 15 rides the Book lane only: both account channels skipped as in_book.
  SELECT array_agg(state || ':' || reason ORDER BY channel) INTO v_reason
    FROM private.brand_offering_account_invite_deliveries
   WHERE event_id = '3682c200-1000-4000-8000-000000000001' AND user_id = '3682c200-0000-4000-8000-000000000015';
  IF v_reason IS DISTINCT FROM ARRAY['skipped:in_book', 'skipped:in_book'] THEN
    RAISE EXCEPTION 'T2-02 FAIL: a Book-linked follower got a second invite: %', v_reason;
  END IF;
  -- T2-03 Muted (12) and exited (13): nothing queued on any channel.
  IF EXISTS (SELECT 1 FROM private.brand_offering_account_invite_deliveries
              WHERE event_id = '3682c200-1000-4000-8000-000000000001'
                AND user_id IN ('3682c200-0000-4000-8000-000000000012', '3682c200-0000-4000-8000-000000000013')
                AND state <> 'skipped') THEN
    RAISE EXCEPTION 'T2-03 FAIL: a muted or exited follower was queued';
  END IF;
  IF (SELECT array_agg(DISTINCT reason ORDER BY reason) FROM private.brand_offering_account_invite_deliveries
       WHERE user_id = '3682c200-0000-4000-8000-000000000012') <> ARRAY['muted_or_off']
     OR (SELECT array_agg(DISTINCT reason ORDER BY reason) FROM private.brand_offering_account_invite_deliveries
       WHERE user_id = '3682c200-0000-4000-8000-000000000013') <> ARRAY['delivery_denied'] THEN
    RAISE EXCEPTION 'T2-03 FAIL: wrong skip reasons';
  END IF;
  -- T2-04a Allowance 3 - 1 campaign email = 2 invite emails: 11 and 16 queued.
  IF (SELECT array_agg(user_id ORDER BY user_id) FROM private.brand_offering_account_invite_deliveries
       WHERE event_id = '3682c200-1000-4000-8000-000000000001' AND channel = 'email' AND state = 'queued')
     IS DISTINCT FROM ARRAY['3682c200-0000-4000-8000-000000000011', '3682c200-0000-4000-8000-000000000016']::uuid[] THEN
    RAISE EXCEPTION 'T2-04 FAIL: invite emails ignored the campaign email already used';
  END IF;
  IF jsonb_array_length(v_build -> 'work') <> 4 THEN
    RAISE EXCEPTION 'T2-04 FAIL: expected push+email for 11 and 16, got %', v_build -> 'work';
  END IF;
END;
$t2d$;

-- T2-04b The pool is now full (1 campaign + 2 invites = 3): the next campaign
-- email confirm is refused, push is not capped at all.
DO $t2e$
BEGIN
  BEGIN
    PERFORM public.biz_assert_brand_blast_allowance_v1('3682c200-0000-4000-8000-0000000000a0', 'email', 1);
    RAISE EXCEPTION 'T2-04 FAIL: a campaign email passed a pool already spent on invites';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'book_blast_monthly_cap_exceeded' THEN RAISE; END IF;
  END;
  PERFORM public.biz_assert_brand_blast_allowance_v1('3682c200-0000-4000-8000-0000000000a0', 'push', 1000000);
END;
$t2e$;

-- T2-04c Event 2 (account-only) after the pool is full: every email is
-- email_cap, every eligible follower still gets push.
SELECT private.enqueue_wizard_invites_on_publish_v1('3682c200-1000-4000-8000-000000000002', 1, true);
SET LOCAL ROLE service_role;
DO $t2f$
DECLARE v_jobs jsonb; v_job jsonb;
BEGIN
  v_jobs := public.issue_1780_claim_wizard_invite_outbox_v1(10);
  SELECT j INTO v_job FROM jsonb_array_elements(v_jobs) j
   WHERE j ->> 'eventId' = '3682c200-1000-4000-8000-000000000002';
  PERFORM public.issue_3682_build_wizard_account_invites_v1(
    (v_job ->> 'outboxJobId')::uuid, (v_job ->> 'sealedSelectionId')::uuid, (v_job ->> 'leaseToken')::uuid);
END;
$t2f$;
RESET ROLE;
DO $t2g$
BEGIN
  IF EXISTS (SELECT 1 FROM private.brand_offering_account_invite_deliveries
              WHERE event_id = '3682c200-1000-4000-8000-000000000002' AND channel = 'email'
                AND (state <> 'skipped' OR reason NOT IN ('email_cap', 'muted_or_off', 'delivery_denied', 'in_book'))) THEN
    RAISE EXCEPTION 'T2-04 FAIL: an invite email went out over the monthly allowance';
  END IF;
  IF (SELECT count(*) FROM private.brand_offering_account_invite_deliveries
       WHERE event_id = '3682c200-1000-4000-8000-000000000002' AND channel = 'email' AND reason = 'email_cap') < 2
     OR (SELECT count(*) FROM private.brand_offering_account_invite_deliveries
       WHERE event_id = '3682c200-1000-4000-8000-000000000002' AND channel = 'push' AND state = 'queued') < 2 THEN
    RAISE EXCEPTION 'T2-04 FAIL: push must stay uncapped while email is capped';
  END IF;
END;
$t2g$;

-- ── T2-05 Another brand's host ──────────────────────────────────────────────
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '3682c200-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c200-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t2h$
BEGIN
  BEGIN
    PERFORM public.biz_get_offering_account_invites_v1('3682c200-1000-4000-8000-000000000001');
    RAISE EXCEPTION 'T2-05 FAIL: brand B read brand A''s account invites';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_get_offering_invite_plan_v1('3682c200-1000-4000-8000-000000000001');
    RAISE EXCEPTION 'T2-05 FAIL: brand B read brand A''s invite plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1('3682c200-1000-4000-8000-000000000001',
      '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
      1, gen_random_uuid());
    RAISE EXCEPTION 'T2-05 FAIL: brand B wrote brand A''s invite plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM private.brand_offering_account_invite_deliveries LIMIT 1;
    RAISE EXCEPTION 'T2-05 FAIL: a host can read the private delivery table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$t2h$;
RESET ROLE;

-- ── T2-06 Grant enumeration + no address in anything the host can call ──────
DO $t2i$
DECLARE v_unexpected text;
BEGIN
  SELECT string_agg(sig, ', ' ORDER BY sig) INTO v_unexpected FROM (
    SELECT n.nspname || '.' || p.proname AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND p.prosrc ~ 'brand_offering_invite_plan_accounts|brand_offering_account_invite_deliveries|account_recipients|issue_3682_account_invite|issue_3682_build_wizard_account'
  ) f
  WHERE sig NOT IN (
    'public.biz_get_offering_account_invites_v1',   -- names, avatars, states
    'public.biz_get_offering_invite_plan_v1',       -- counts only
    'public.biz_replace_offering_invite_plan_v1',   -- counts only
    'public.admin_messaging_limits_overview'        -- admin-gated usage totals
  );
  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'T2-06 FAIL: unreviewed host-callable readers of account invites: %', v_unexpected;
  END IF;
  IF has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('anon', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'T2-06 FAIL: API roles can reach the private schema';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public'
              AND definition ~ 'brand_offering_invite_plan_accounts|brand_offering_account_invite_deliveries') THEN
    RAISE EXCEPTION 'T2-06 FAIL: a public view exposes account invites';
  END IF;
END;
$t2i$;

SELECT set_config('request.jwt.claim.sub', '3682c200-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c200-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t2j$
DECLARE v text;
BEGIN
  v := public.biz_get_offering_account_invites_v1('3682c200-1000-4000-8000-000000000001')::text
    || public.biz_get_offering_account_invites_v1('3682c200-1000-4000-8000-000000000002')::text
    || public.biz_get_offering_invite_plan_v1('3682c200-1000-4000-8000-000000000001')::text
    || public.biz_get_offering_invite_plan_v1('3682c200-1000-4000-8000-000000000002')::text;
  IF v LIKE '%leak.example.test%' OR v LIKE '%@%' OR v ~ '555368221'
     OR v ~ '3682c200-0000-4000-8000-00000000001' THEN
    RAISE EXCEPTION 'T2-06 FAIL: host-visible payload carries a contact or account id: %', v;
  END IF;
END;
$t2j$;
RESET ROLE;

ROLLBACK;
