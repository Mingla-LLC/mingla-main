-- Issue #4261 — declining a pending friend request works again.
--
-- The app declines with a direct PostgREST UPDATE, as the signed-in receiver:
--   supabase.from('friend_requests').update({ status: 'declined' }).eq('id', id)
-- (app-mobile useFriends.declineFriendRequest and
-- useNotifications.declineFriendRequestAction), allowed by policy fr_update.
-- It accepts with the accept_friend_request_atomic RPC.
--
--   F-01  the receiver, as `authenticated` under RLS, declines a pending
--         request: the UPDATE commits and the row reads `declined`.
--   F-02  declining leaves no friendship: no public.friends row either way.
--   F-03  someone outside the pair cannot decline it (RLS hides the row; the
--         request stays pending).
--   F-04  accept still works: the receiver's accept_friend_request_atomic
--         call succeeds, writes both friends rows, and credits the pending
--         referral (one bonus month for the referrer).
--   F-05  a decline credits nothing: the referral credit is not credited.
--   F-06  catalog: trg_cascade_fr_decline_to_links and
--         cascade_friend_request_decline_to_links() are gone; no function body
--         in public (SQL line comments stripped) and no trigger function in
--         public references friend_links; the other four friend_requests
--         triggers are still attached.
--
-- MINGLA-INVARIANT: I-4261-FRIEND-REQUEST-DECLINE | issue #4261 | The receiver of a pending friend request can decline it, and no live function or trigger in public references the dropped friend_links table.
--
-- FAILS-ON-REVERT (replay the chain without
-- 20280403084261_issue_4261_friend_request_decline_fix.sql and delete the two
-- \ir lines below): F-01 fails with 42P01 relation "public.friend_links" does
-- not exist, raised by trg_cascade_fr_decline_to_links.
--
-- Run after the full migration chain on PostgreSQL 17. The re-apply proves
-- the migration is idempotent; everything after it rolls back.

\ir ../20280403084261_issue_4261_friend_request_decline_fix.sql
\ir ../20280403084261_issue_4261_friend_request_decline_fix.sql

BEGIN;

-- The bare PostgreSQL image has no Supabase Realtime server (same stub as the
-- other #4261 suites).
DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE t4261d_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4261d_ids TO authenticated;

CREATE FUNCTION pg_temp.t4261d_id(p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM t4261d_ids WHERE tag = p_tag
$f$;
-- Sets the JWT for p_tag (call before SET LOCAL ROLE authenticated).
CREATE FUNCTION pg_temp.t4261d_as(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM t4261d_ids WHERE tag = p_tag;
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
-- Runs p_sql as the current role; returns 'ok' or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.t4261d_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.t4261d_months(p_tag text) RETURNS int LANGUAGE sql AS $f$
  SELECT referral_bonus_months FROM public.subscriptions WHERE user_id = pg_temp.t4261d_id(p_tag)
$f$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['send','recv','outsider','ref','newb','xref','xnew'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4261d-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 't4261d-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.subscriptions(user_id) VALUES (v_id) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.subscriptions SET referral_bonus_months = 0, referral_bonus_started_at = NULL
     WHERE user_id = v_id;
    INSERT INTO t4261d_ids VALUES (v_tag, v_id);
  END LOOP;

  INSERT INTO public.referral_credits(referrer_id, referred_id, status) VALUES
    (pg_temp.t4261d_id('ref'),  pg_temp.t4261d_id('newb'), 'pending'),
    (pg_temp.t4261d_id('xref'), pg_temp.t4261d_id('xnew'), 'pending');

  INSERT INTO public.friend_requests(sender_id, receiver_id, status) VALUES
    (pg_temp.t4261d_id('send'), pg_temp.t4261d_id('recv'), 'pending'),
    (pg_temp.t4261d_id('ref'),  pg_temp.t4261d_id('newb'), 'pending'),
    (pg_temp.t4261d_id('xref'), pg_temp.t4261d_id('xnew'), 'pending');
END $fixture$;

-- ── F-03 an outsider cannot decline (run first, while the row is pending) ──
DO $f03$
DECLARE
  v_fr uuid;
  v_res text;
BEGIN
  SELECT id INTO v_fr FROM public.friend_requests
   WHERE sender_id = pg_temp.t4261d_id('send') AND receiver_id = pg_temp.t4261d_id('recv');
  PERFORM pg_temp.t4261d_as('outsider');
  SET LOCAL ROLE authenticated;
  v_res := pg_temp.t4261d_try(format(
    $q$UPDATE public.friend_requests SET status = 'declined' WHERE id = %L$q$, v_fr));
  RESET ROLE;
  IF (SELECT status FROM public.friend_requests WHERE id = v_fr) <> 'pending' THEN
    RAISE EXCEPTION 'F-03: an outsider must not change the request (try: %)', v_res;
  END IF;
END $f03$;

-- ── F-01 the receiver declines through the app's path ─────────────────────
DO $f01$
DECLARE
  v_fr uuid;
  v_res text;
BEGIN
  SELECT id INTO v_fr FROM public.friend_requests
   WHERE sender_id = pg_temp.t4261d_id('send') AND receiver_id = pg_temp.t4261d_id('recv');
  PERFORM pg_temp.t4261d_as('recv');
  SET LOCAL ROLE authenticated;
  v_res := pg_temp.t4261d_try(format(
    $q$UPDATE public.friend_requests SET status = 'declined' WHERE id = %L$q$, v_fr));
  RESET ROLE;
  IF v_res <> 'ok' THEN
    RAISE EXCEPTION 'F-01: the receiver must be able to decline a pending request (got %)', v_res;
  END IF;
  IF (SELECT status FROM public.friend_requests WHERE id = v_fr) <> 'declined' THEN
    RAISE EXCEPTION 'F-01: the request must read declined';
  END IF;
END $f01$;

-- ── F-02 declining leaves no friendship ────────────────────────────────────
DO $f02$
BEGIN
  IF EXISTS (SELECT 1 FROM public.friends
       WHERE (user_id = pg_temp.t4261d_id('send') AND friend_user_id = pg_temp.t4261d_id('recv'))
          OR (user_id = pg_temp.t4261d_id('recv') AND friend_user_id = pg_temp.t4261d_id('send'))) THEN
    RAISE EXCEPTION 'F-02: a declined request must leave no friends row';
  END IF;
END $f02$;

-- ── F-04 accept still works and still credits the referral ────────────────
DO $f04$
DECLARE
  v_fr uuid;
  v_res jsonb;
BEGIN
  SELECT id INTO v_fr FROM public.friend_requests
   WHERE sender_id = pg_temp.t4261d_id('ref') AND receiver_id = pg_temp.t4261d_id('newb');
  PERFORM pg_temp.t4261d_as('newb');
  SET LOCAL ROLE authenticated;
  v_res := public.accept_friend_request_atomic(v_fr);
  RESET ROLE;
  IF NOT coalesce((v_res ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'F-04: the receiver''s accept must succeed (got %)', v_res;
  END IF;
  IF (SELECT status FROM public.friend_requests WHERE id = v_fr) <> 'accepted' THEN
    RAISE EXCEPTION 'F-04: the request must read accepted';
  END IF;
  IF (SELECT count(*) FROM public.friends
       WHERE status = 'accepted'
         AND ((user_id = pg_temp.t4261d_id('ref') AND friend_user_id = pg_temp.t4261d_id('newb'))
           OR (user_id = pg_temp.t4261d_id('newb') AND friend_user_id = pg_temp.t4261d_id('ref')))) <> 2 THEN
    RAISE EXCEPTION 'F-04: accept must write both accepted friends rows';
  END IF;
  IF (SELECT status FROM public.referral_credits
       WHERE referrer_id = pg_temp.t4261d_id('ref') AND referred_id = pg_temp.t4261d_id('newb')) <> 'credited' THEN
    RAISE EXCEPTION 'F-04: accept must credit the pending referral';
  END IF;
  IF pg_temp.t4261d_months('ref') <> 1 OR pg_temp.t4261d_months('newb') <> 0 THEN
    RAISE EXCEPTION 'F-04: only the referrer gains one month (got %, %)',
      pg_temp.t4261d_months('ref'), pg_temp.t4261d_months('newb');
  END IF;
END $f04$;

-- ── F-05 a decline credits nothing ─────────────────────────────────────────
DO $f05$
DECLARE
  v_fr uuid;
  v_res text;
BEGIN
  SELECT id INTO v_fr FROM public.friend_requests
   WHERE sender_id = pg_temp.t4261d_id('xref') AND receiver_id = pg_temp.t4261d_id('xnew');
  PERFORM pg_temp.t4261d_as('xnew');
  SET LOCAL ROLE authenticated;
  v_res := pg_temp.t4261d_try(format(
    $q$UPDATE public.friend_requests SET status = 'declined' WHERE id = %L$q$, v_fr));
  RESET ROLE;
  IF v_res <> 'ok' THEN
    RAISE EXCEPTION 'F-05: the referred person must be able to decline (got %)', v_res;
  END IF;
  IF (SELECT status FROM public.referral_credits
       WHERE referrer_id = pg_temp.t4261d_id('xref') AND referred_id = pg_temp.t4261d_id('xnew')) = 'credited'
     OR pg_temp.t4261d_months('xref') <> 0 THEN
    RAISE EXCEPTION 'F-05: a decline must not credit the referral';
  END IF;
END $f05$;

-- ── F-06 catalog ───────────────────────────────────────────────────────────
DO $f06$
DECLARE
  v_names text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cascade_fr_decline_to_links') THEN
    RAISE EXCEPTION 'F-06: trg_cascade_fr_decline_to_links must be dropped';
  END IF;
  IF to_regprocedure('public.cascade_friend_request_decline_to_links()') IS NOT NULL THEN
    RAISE EXCEPTION 'F-06: cascade_friend_request_decline_to_links() must be dropped';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_names
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ILIKE '%friend_links%';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'F-06: no public function body may reference friend_links (found %)', v_names;
  END IF;
  SELECT string_agg(t.tgname || ' on ' || t.tgrelid::regclass::text, ', ') INTO v_names
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE c.relnamespace = 'public'::regnamespace
     AND NOT t.tgisinternal
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ILIKE '%friend_links%';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'F-06: no public trigger may run a function that references friend_links (found %)', v_names;
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.friend_requests'::regclass AND NOT tgisinternal
         AND tgname IN ('on_friend_accept_reveal_pair_requests', 'trg_cascade_friend_decline',
                        'trg_clear_notification_on_friend_request_resolved',
                        'trg_credit_referral_on_friend_accepted')) <> 4 THEN
    RAISE EXCEPTION 'F-06: the other four friend_requests triggers must stay attached';
  END IF;
END $f06$;

ROLLBACK;

\echo 'issue_4261_friend_request_decline: all assertions passed'
