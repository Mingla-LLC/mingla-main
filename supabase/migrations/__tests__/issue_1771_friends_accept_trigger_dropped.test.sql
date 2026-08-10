-- Issue #1771 (Wave 0 of #876) — regression proof that the dormant, broken
-- accept_friend_request trigger is GONE and the pending→accepted accept path
-- is safe (append-only; new file).
--
-- Self-contained: runs against a FRESH supabase/postgres:17.4.1.075 container
-- with NO migrations pre-applied (no baseline replay). The workflow
-- (.github/workflows/issue-1771-friends-trigger-tests.yml) docker-cp's the
-- #1771 migration into the container at /issue_1771_migration.sql before
-- piping this file through `psql -v ON_ERROR_STOP=1`.
--
-- Four legs (spec on #1771):
--   1. ARM     — minimal public.friends clone + the BROKEN function and
--                trigger VERBATIM from the baseline squash
--                (20260505000000_baseline_squash_orch_0729.sql:155-167,12475).
--   2. LANDMINE — a pending→accepted UPDATE THROWS SQLSTATE 42703
--                ("record new has no field friend_id") inside a caught
--                subtransaction. This leg pins the mechanism so the test is
--                not vacuous.
--   3. APPLY   — the real migration file
--                20270305001771_issue_1771_drop_dormant_accept_friend_request_trigger.sql
--                (via \i of the docker-cp'd copy — deleting the migration
--                makes the workflow's docker cp fail, so the gate trips).
--   4. PROOF   — the SAME pending→accepted UPDATE now succeeds; pg_trigger
--                has no accept_friend_request_trigger on public.friends;
--                pg_proc has no public.accept_friend_request. Also proves
--                idempotency: applying the migration a second time is a no-op
--                (SC-4).
--
-- Fails-on-revert: deleting the migration (or re-adding the trigger/function
-- to it) makes leg 3/4 fail. Whole file is additive — no append-only token
-- needed.
\set ON_ERROR_STOP on

BEGIN;

-- ── Leg 1: ARM — minimal friends clone + broken function/trigger verbatim ──
CREATE TABLE public.friends (
    user_id uuid NOT NULL,
    friend_user_id uuid NOT NULL,
    status text NOT NULL,
    UNIQUE (user_id, friend_user_id)
);

-- VERBATIM from baseline 20260505000000_baseline_squash_orch_0729.sql:155-167
CREATE OR REPLACE FUNCTION "public"."accept_friend_request"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- If status changed to 'accepted', create reciprocal friendship
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO public.friends (user_id, friend_id, status)
    VALUES (NEW.friend_id, NEW.user_id, 'accepted')
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- VERBATIM from baseline 20260505000000_baseline_squash_orch_0729.sql:12475
CREATE OR REPLACE TRIGGER "accept_friend_request_trigger" AFTER UPDATE ON "public"."friends" FOR EACH ROW EXECUTE FUNCTION "public"."accept_friend_request"();

INSERT INTO public.friends (user_id, friend_user_id, status) VALUES (
    '17710000-0000-0000-0000-00000000000a',
    '17710000-0000-0000-0000-00000000000b',
    'pending'
);

-- ── Leg 2: LANDMINE — the armed trigger throws 42703 on pending→accepted ──
DO $test$
DECLARE
  v_threw boolean := false;
BEGIN
  BEGIN
    UPDATE public.friends
       SET status = 'accepted'
     WHERE user_id = '17710000-0000-0000-0000-00000000000a'
       AND friend_user_id = '17710000-0000-0000-0000-00000000000b';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42703' THEN
      RAISE EXCEPTION
        'issue-1771 leg 2: expected SQLSTATE 42703 from the armed broken trigger, got % (%)',
        SQLSTATE, SQLERRM;
    END IF;
    v_threw := true;
  END;
  IF NOT v_threw THEN
    RAISE EXCEPTION
      'issue-1771 leg 2: armed broken trigger did NOT throw on pending→accepted — landmine leg is vacuous';
  END IF;
END;
$test$;

-- The failed UPDATE rolled back inside the DO subtransaction: still pending.
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.friends
     WHERE user_id = '17710000-0000-0000-0000-00000000000a'
       AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'issue-1771 leg 2: seed row lost pending status unexpectedly';
  END IF;
END;
$test$;

-- ── Leg 3: APPLY the real #1771 migration (docker-cp'd by the workflow) ──
\i /issue_1771_migration.sql

-- ── Leg 4: PROOF — the same transition now succeeds; catalogs are clean ──
UPDATE public.friends
   SET status = 'accepted'
 WHERE user_id = '17710000-0000-0000-0000-00000000000a'
   AND friend_user_id = '17710000-0000-0000-0000-00000000000b';

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.friends
     WHERE user_id = '17710000-0000-0000-0000-00000000000a'
       AND friend_user_id = '17710000-0000-0000-0000-00000000000b'
       AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'issue-1771 leg 4: pending→accepted UPDATE did not land after the migration';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = 'accept_friend_request_trigger'
       AND n.nspname = 'public'
       AND c.relname = 'friends'
  ) THEN
    RAISE EXCEPTION 'issue-1771 leg 4: accept_friend_request_trigger still present on public.friends';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'accept_friend_request'
       AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'issue-1771 leg 4: function public.accept_friend_request still present';
  END IF;
END;
$test$;

-- ── SC-4: idempotency — applying the migration twice is a no-op ──
\i /issue_1771_migration.sql

DO $test$
BEGIN
  RAISE NOTICE 'issue-1771 regression suite: ALL LEGS PASSED';
END;
$test$;

ROLLBACK;
