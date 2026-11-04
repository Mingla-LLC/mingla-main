-- #3682 closeout — the quiet auto-follow backfill follows past signed-in
-- buyers (source 'purchase'), skips people who already follow, who show an
-- unfollow trace, or whose account is gone, and is idempotent.
\set ON_ERROR_STOP on
BEGIN;

-- Users: A new follower, B already follows, C unfollowed (prefs trace),
-- D deactivated, E old order, F unpaid, G already claimed, H deleted profile.
INSERT INTO auth.users(id) VALUES
  ('3682b000-0000-4000-8000-00000000000a'),
  ('3682b000-0000-4000-8000-00000000000b'),
  ('3682b000-0000-4000-8000-00000000000c'),
  ('3682b000-0000-4000-8000-00000000000d'),
  ('3682b000-0000-4000-8000-00000000000e'),
  ('3682b000-0000-4000-8000-00000000000f'),
  ('3682b000-0000-4000-8000-000000000016'),
  ('3682b000-0000-4000-8000-000000000017'),
  ('3682b000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id, email)
VALUES ('3682b000-0000-4000-8000-000000000001', 'owner-3682b@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('3682b000-0000-4000-8000-000000000100', '3682b000-0000-4000-8000-000000000001',
        'Backfill Brand', 'issue-3682-backfill', 'USD', now(), now());
INSERT INTO public.profiles(
  id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode, explorer_deleted_at
)
SELECT u.id, 'B', 'F', 'Backfill ' || right(u.id::text, 2), 'bf3682-' || right(u.id::text, 2),
       u.id <> '3682b000-0000-4000-8000-00000000000d', true, 'friends',
       CASE WHEN u.id = '3682b000-0000-4000-8000-000000000017' THEN now() END
  FROM auth.users u
 WHERE u.id::text LIKE '3682b000-0000-4000-8000-0000000000%'
   AND u.id <> '3682b000-0000-4000-8000-000000000001';
INSERT INTO public.events(id, brand_id, title, slug, status, event_type)
VALUES ('3682b000-1000-4000-8000-000000000001', '3682b000-0000-4000-8000-000000000100',
        'Backfill event', 'issue-3682-backfill-event', 'scheduled', 'event');

-- The #4063 owner trigger detaches buyer_user_id unless the account owns the
-- contact; contact ownership is not under test, so triggers are skipped for
-- this fixture insert only.
SET LOCAL session_replication_role = replica;
INSERT INTO public.orders(
  id, event_id, buyer_user_id, buyer_phone_e164, payment_status, source,
  total_cents, currency, created_at
)
SELECT ('3682b000-2000-4000-8000-0000000000' || right(u, 2))::uuid,
       '3682b000-1000-4000-8000-000000000001', u::uuid,
       '+1555368' || lpad((row_number() OVER ())::text, 4, '0'),
       CASE WHEN right(u, 2) = '0f' THEN 'pending' ELSE 'paid' END,
       'online_checkout', 1000, 'USD',
       CASE WHEN right(u, 2) = '0e' THEN timestamptz '2026-10-01 12:00:00+00'
            ELSE timestamptz '2026-10-20 12:00:00+00' END
  FROM unnest(ARRAY[
    '3682b000-0000-4000-8000-00000000000a', '3682b000-0000-4000-8000-00000000000b',
    '3682b000-0000-4000-8000-00000000000c', '3682b000-0000-4000-8000-00000000000d',
    '3682b000-0000-4000-8000-00000000000e', '3682b000-0000-4000-8000-00000000000f',
    '3682b000-0000-4000-8000-000000000016', '3682b000-0000-4000-8000-000000000017'
  ]) AS u;
SET LOCAL session_replication_role = origin;

-- B already follows (manual brand-page follow).
INSERT INTO public.brand_follows(user_id, brand_id, source)
VALUES ('3682b000-0000-4000-8000-00000000000b', '3682b000-0000-4000-8000-000000000100', 'brand_page');
-- C once followed, set a channel pref, then unfollowed (follow row gone).
INSERT INTO public.brand_follow_channel_prefs(user_id, brand_id, channel, enabled)
VALUES ('3682b000-0000-4000-8000-00000000000c', '3682b000-0000-4000-8000-000000000100', 'email', false);
-- G's order was already claimed (e.g. by the fixed live path) and G unfollowed.
INSERT INTO public.brand_follow_auto_claims(order_id, user_id, brand_id, source, source_kind, source_id)
VALUES ('3682b000-2000-4000-8000-000000000016', '3682b000-0000-4000-8000-000000000016',
        '3682b000-0000-4000-8000-000000000100', 'purchase', 'order',
        '3682b000-2000-4000-8000-000000000016');

SELECT private.issue_3682_backfill_auto_follows();

DO $b1$
DECLARE
  v_brand uuid := '3682b000-0000-4000-8000-000000000100';
  v_followers uuid[];
  v_claimed uuid[];
BEGIN
  SELECT array_agg(user_id ORDER BY user_id) INTO v_followers
    FROM public.brand_follows WHERE brand_id = v_brand;
  IF v_followers IS DISTINCT FROM ARRAY[
       '3682b000-0000-4000-8000-00000000000a'::uuid,
       '3682b000-0000-4000-8000-00000000000b'::uuid] THEN
    RAISE EXCEPTION 'issue-3682 B-01: wrong followers after backfill: %', v_followers;
  END IF;
  IF (SELECT source FROM public.brand_follows
       WHERE brand_id = v_brand AND user_id = '3682b000-0000-4000-8000-00000000000a')
     IS DISTINCT FROM 'purchase' THEN
    RAISE EXCEPTION 'issue-3682 B-02: backfilled follow source must be purchase';
  END IF;
  IF (SELECT source FROM public.brand_follows
       WHERE brand_id = v_brand AND user_id = '3682b000-0000-4000-8000-00000000000b')
     IS DISTINCT FROM 'brand_page' THEN
    RAISE EXCEPTION 'issue-3682 B-03: existing follow was rewritten';
  END IF;
  SELECT array_agg(user_id ORDER BY user_id) INTO v_claimed
    FROM public.brand_follow_auto_claims WHERE brand_id = v_brand;
  IF v_claimed IS DISTINCT FROM ARRAY[
       '3682b000-0000-4000-8000-00000000000a'::uuid,
       '3682b000-0000-4000-8000-00000000000b'::uuid,
       '3682b000-0000-4000-8000-00000000000c'::uuid,
       '3682b000-0000-4000-8000-000000000016'::uuid] THEN
    RAISE EXCEPTION 'issue-3682 B-04: wrong claims after backfill: %', v_claimed;
  END IF;
END
$b1$;

-- B-05: re-run is a no-op.
DO $b5$
DECLARE v jsonb;
BEGIN
  v := private.issue_3682_backfill_auto_follows();
  IF (v->>'follows')::int <> 0 OR (v->>'claims')::int <> 0 THEN
    RAISE EXCEPTION 'issue-3682 B-05: backfill not idempotent: %', v;
  END IF;
END
$b5$;

-- B-06: no client can run it.
DO $b6$
BEGIN
  IF has_function_privilege('anon', 'private.issue_3682_backfill_auto_follows(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.issue_3682_backfill_auto_follows(timestamptz)', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.issue_3682_backfill_auto_follows(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3682 B-06: backfill function is client-executable';
  END IF;
END
$b6$;

ROLLBACK;
SELECT 'issue_3682_quiet_auto_follow_backfill: PASS' AS result;
