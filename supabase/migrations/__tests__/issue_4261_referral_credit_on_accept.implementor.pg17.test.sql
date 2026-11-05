-- Issue #4261 Wave F — accepting a friend request credits the referral.
--
--   R-01  a pending credit (referrer -> referred) and their pending friend
--         request turned accepted -> `credited`, credited_at and
--         friend_request_id set, the referrer's referral_bonus_months +1.
--   R-02  the reverse direction (the referred person sent the request)
--         credits the referrer too.
--   R-03  no credit row -> nothing is credited and no bonus month moves.
--   R-04  a matching pending_session_invites row -> one collaboration_invites
--         row for invited_user_id, a session_participants row, the pending
--         session invite `converted`, and the accept commits (the old
--         function named a missing invitee_id column and aborted).
--   R-05  an already `credited` row is not counted twice, and re-accepting a
--         re-opened request does not add a second month.
--   R-06  pending -> declined credits nothing: the credit stays pending or
--         expired, never credited.
--   R-07  the function pins search_path and stays SECURITY DEFINER; the
--         trigger is still attached.
--
-- MINGLA-INVARIANT: I-4261-REFERRAL-CREDIT-ON-ACCEPT | issue #4261 | When a friend request between a referrer and the person they referred turns accepted, their pending referral credit becomes credited exactly once and the referrer gains one bonus month.
--
-- FAILS-ON-REVERT (replay the chain without
-- 20280403064261_issue_4261_referral_credit_on_accept.sql): the \ir below is
-- the migration itself; without it R-01 fails (the credit stays pending) and
-- R-04 aborts on column "invitee_id" of relation "collaboration_invites".
--
-- Run after the full migration chain on PostgreSQL 17. The re-apply proves
-- the migration is idempotent; everything after it rolls back.

\ir ../20280403064261_issue_4261_referral_credit_on_accept.sql
\ir ../20280403064261_issue_4261_referral_credit_on_accept.sql

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

CREATE TEMP TABLE t4261r_ids (tag text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pg_temp.t4261r_id(p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM t4261r_ids WHERE tag = p_tag
$f$;
CREATE FUNCTION pg_temp.t4261r_months(p_tag text) RETURNS int LANGUAGE sql AS $f$
  SELECT referral_bonus_months FROM public.subscriptions WHERE user_id = pg_temp.t4261r_id(p_tag)
$f$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ref','newb','rref','rnewb','p1','p2','inv','conv','dref','dnew','xref','xnew'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4261r-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 't4261r-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.subscriptions(user_id) VALUES (v_id) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.subscriptions SET referral_bonus_months = 0, referral_bonus_started_at = NULL
     WHERE user_id = v_id;
    INSERT INTO t4261r_ids VALUES (v_tag, v_id);
  END LOOP;

  INSERT INTO public.referral_credits(referrer_id, referred_id, status) VALUES
    (pg_temp.t4261r_id('ref'),  pg_temp.t4261r_id('newb'),  'pending'),
    (pg_temp.t4261r_id('rref'), pg_temp.t4261r_id('rnewb'), 'pending'),
    (pg_temp.t4261r_id('xref'), pg_temp.t4261r_id('xnew'),  'pending');
  INSERT INTO public.referral_credits(referrer_id, referred_id, status, credited_at) VALUES
    (pg_temp.t4261r_id('dref'), pg_temp.t4261r_id('dnew'), 'credited', now() - interval '1 day');
  UPDATE public.subscriptions SET referral_bonus_months = 1, referral_bonus_started_at = now() - interval '1 day'
   WHERE user_id = pg_temp.t4261r_id('dref');

  INSERT INTO public.friend_requests(sender_id, receiver_id, status) VALUES
    (pg_temp.t4261r_id('ref'),   pg_temp.t4261r_id('newb'), 'pending'),
    (pg_temp.t4261r_id('rnewb'), pg_temp.t4261r_id('rref'), 'pending'),
    (pg_temp.t4261r_id('p1'),    pg_temp.t4261r_id('p2'),   'pending'),
    (pg_temp.t4261r_id('inv'),   pg_temp.t4261r_id('conv'), 'pending'),
    (pg_temp.t4261r_id('dref'),  pg_temp.t4261r_id('dnew'), 'pending'),
    (pg_temp.t4261r_id('xref'),  pg_temp.t4261r_id('xnew'), 'pending');
END $fixture$;

DO $r01$
DECLARE
  v_fr uuid;
  c record;
BEGIN
  SELECT id INTO v_fr FROM public.friend_requests
   WHERE sender_id = pg_temp.t4261r_id('ref') AND receiver_id = pg_temp.t4261r_id('newb');
  UPDATE public.friend_requests SET status = 'accepted' WHERE id = v_fr;
  SELECT * INTO c FROM public.referral_credits
   WHERE referrer_id = pg_temp.t4261r_id('ref') AND referred_id = pg_temp.t4261r_id('newb');
  IF c.status <> 'credited' OR c.credited_at IS NULL OR c.friend_request_id IS DISTINCT FROM v_fr THEN
    RAISE EXCEPTION 'R-01: the pending credit must turn credited with credited_at and friend_request_id (got %, %, %)',
      c.status, c.credited_at, c.friend_request_id;
  END IF;
  IF pg_temp.t4261r_months('ref') <> 1 THEN
    RAISE EXCEPTION 'R-01: the referrer must gain one bonus month (got %)', pg_temp.t4261r_months('ref');
  END IF;
  IF (SELECT referral_bonus_started_at FROM public.subscriptions WHERE user_id = pg_temp.t4261r_id('ref')) IS NULL THEN
    RAISE EXCEPTION 'R-01: the first bonus month starts the clock';
  END IF;
  IF pg_temp.t4261r_months('newb') <> 0 THEN
    RAISE EXCEPTION 'R-01: the referred person gains nothing';
  END IF;
END $r01$;

DO $r02$
BEGIN
  UPDATE public.friend_requests SET status = 'accepted'
   WHERE sender_id = pg_temp.t4261r_id('rnewb') AND receiver_id = pg_temp.t4261r_id('rref');
  IF (SELECT status FROM public.referral_credits
       WHERE referrer_id = pg_temp.t4261r_id('rref') AND referred_id = pg_temp.t4261r_id('rnewb')) <> 'credited' THEN
    RAISE EXCEPTION 'R-02: a request sent by the referred person must credit the referrer';
  END IF;
  IF pg_temp.t4261r_months('rref') <> 1 OR pg_temp.t4261r_months('rnewb') <> 0 THEN
    RAISE EXCEPTION 'R-02: only the referrer gains one month (got %, %)',
      pg_temp.t4261r_months('rref'), pg_temp.t4261r_months('rnewb');
  END IF;
END $r02$;

DO $r03$
BEGIN
  UPDATE public.friend_requests SET status = 'accepted'
   WHERE sender_id = pg_temp.t4261r_id('p1') AND receiver_id = pg_temp.t4261r_id('p2');
  IF EXISTS (SELECT 1 FROM public.referral_credits
       WHERE pg_temp.t4261r_id('p1') IN (referrer_id, referred_id)
          OR pg_temp.t4261r_id('p2') IN (referrer_id, referred_id)) THEN
    RAISE EXCEPTION 'R-03: no credit row may appear';
  END IF;
  IF pg_temp.t4261r_months('p1') <> 0 OR pg_temp.t4261r_months('p2') <> 0 THEN
    RAISE EXCEPTION 'R-03: no bonus month without a credit';
  END IF;
END $r03$;

DO $r04$
DECLARE
  v_session uuid;
  v_psi uuid;
  v_err text;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('R-04 session', pg_temp.t4261r_id('inv'), 'active') RETURNING id INTO v_session;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted)
    VALUES (v_session, pg_temp.t4261r_id('inv'), true);
  INSERT INTO public.pending_invites(inviter_id, phone_e164, status, converted_user_id, converted_at)
    VALUES (pg_temp.t4261r_id('inv'), '+15550104261', 'converted', pg_temp.t4261r_id('conv'), now());
  INSERT INTO public.pending_session_invites(session_id, inviter_id, phone_e164, status)
    VALUES (v_session, pg_temp.t4261r_id('inv'), '+15550104261', 'pending') RETURNING id INTO v_psi;

  BEGIN
    UPDATE public.friend_requests SET status = 'accepted'
     WHERE sender_id = pg_temp.t4261r_id('inv') AND receiver_id = pg_temp.t4261r_id('conv');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'R-04: the accept must commit with a matching pending session invite (got %)', v_err;
  END IF;
  IF (SELECT status FROM public.friend_requests
       WHERE sender_id = pg_temp.t4261r_id('inv') AND receiver_id = pg_temp.t4261r_id('conv')) <> 'accepted' THEN
    RAISE EXCEPTION 'R-04: the friend request must be accepted';
  END IF;
  IF (SELECT count(*) FROM public.collaboration_invites
       WHERE session_id = v_session AND invited_user_id = pg_temp.t4261r_id('conv')
         AND inviter_id = pg_temp.t4261r_id('inv') AND status = 'pending' AND invite_method = 'friends_list') <> 1 THEN
    RAISE EXCEPTION 'R-04: exactly one pending collaboration invite for invited_user_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants
       WHERE session_id = v_session AND user_id = pg_temp.t4261r_id('conv') AND has_accepted = false) THEN
    RAISE EXCEPTION 'R-04: the invitee must be a not-yet-accepted session participant';
  END IF;
  IF (SELECT status FROM public.pending_session_invites WHERE id = v_psi) <> 'converted' THEN
    RAISE EXCEPTION 'R-04: the pending session invite must be converted';
  END IF;
END $r04$;

DO $r05$
DECLARE
  v_fr uuid;
BEGIN
  UPDATE public.friend_requests SET status = 'accepted'
   WHERE sender_id = pg_temp.t4261r_id('dref') AND receiver_id = pg_temp.t4261r_id('dnew');
  IF pg_temp.t4261r_months('dref') <> 1 THEN
    RAISE EXCEPTION 'R-05: an already credited row must not add a month (got %)', pg_temp.t4261r_months('dref');
  END IF;
  IF (SELECT friend_request_id FROM public.referral_credits
       WHERE referrer_id = pg_temp.t4261r_id('dref') AND referred_id = pg_temp.t4261r_id('dnew')) IS NOT NULL THEN
    RAISE EXCEPTION 'R-05: an already credited row is left as it was';
  END IF;
  -- Re-open R-01's request and accept it again: still one month.
  SELECT id INTO v_fr FROM public.friend_requests
   WHERE sender_id = pg_temp.t4261r_id('ref') AND receiver_id = pg_temp.t4261r_id('newb');
  UPDATE public.friend_requests SET status = 'pending' WHERE id = v_fr;
  UPDATE public.friend_requests SET status = 'accepted' WHERE id = v_fr;
  IF pg_temp.t4261r_months('ref') <> 1 THEN
    RAISE EXCEPTION 'R-05: re-accepting must not credit twice (got %)', pg_temp.t4261r_months('ref');
  END IF;
END $r05$;

-- The stale friend_links decline trigger is dropped by
-- 20280403084261_issue_4261_friend_request_decline_fix.sql, so R-06 runs the
-- decline with every remaining friend_requests trigger live.
DO $r06$
BEGIN
  UPDATE public.friend_requests SET status = 'declined'
   WHERE sender_id = pg_temp.t4261r_id('xref') AND receiver_id = pg_temp.t4261r_id('xnew');
  IF (SELECT status FROM public.referral_credits
       WHERE referrer_id = pg_temp.t4261r_id('xref') AND referred_id = pg_temp.t4261r_id('xnew'))
     NOT IN ('pending', 'expired') THEN
    -- The existing decline path may expire the credit; it must never credit it.
    RAISE EXCEPTION 'R-06: a decline must not credit the referral (got %)', (SELECT to_jsonb(rc) FROM public.referral_credits rc WHERE referrer_id = pg_temp.t4261r_id('xref'));
  END IF;
  IF pg_temp.t4261r_months('xref') <> 0 THEN
    RAISE EXCEPTION 'R-06: a decline adds no month';
  END IF;
END $r06$;

DO $r07$
DECLARE
  p record;
BEGIN
  SELECT prosecdef, proconfig INTO p FROM pg_proc
   WHERE oid = 'public.credit_referral_on_friend_accepted()'::regprocedure;
  IF NOT p.prosecdef THEN
    RAISE EXCEPTION 'R-07: the function stays SECURITY DEFINER';
  END IF;
  IF p.proconfig IS NULL OR NOT ('search_path=public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'R-07: search_path must be pinned (got %)', p.proconfig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_credit_referral_on_friend_accepted'
         AND tgrelid = 'public.friend_requests'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'R-07: the trigger must stay attached';
  END IF;
END $r07$;

ROLLBACK;

\echo 'issue_4261_referral_credit_on_accept: all assertions passed'
