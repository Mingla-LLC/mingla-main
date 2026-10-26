\set ON_ERROR_STOP on

-- Issue #4114 Wave 2b — invite token + claim_friend_invite.
--
--   I-01  pending_pair_invites.token exists, is NOT NULL and UNIQUE, and new
--         invites get distinct random 64-hex tokens.
--   I-02  the invitee (signed up with a DIFFERENT number) claims the token:
--         a pending friend request from the inviter, a pair request hidden
--         until that friend request is accepted (carrying the invited number),
--         and the invite marked converted to the claimer.
--   I-03  claiming again is idempotent: same ids back, no new rows.
--   I-04  token reuse: another account gets already_claimed and no rows.
--   I-05  the inviter cannot claim their own invite; a cancelled invite and an
--         unknown or malformed token are refused.
--   I-06  accepting the claimed friend request reveals the pair request
--         (the existing reveal trigger), so one Accept flow can pair.
--   I-07  a claimer who is already friends with the inviter gets a VISIBLE
--         pair request and no friend request.
--   I-08  only authenticated may execute it; anon may not.
--
-- FAILS-ON-REVERT (replay the chain without 20271230024114): I-01 fails on its
-- first check (no token column), and claim_friend_invite does not exist.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114i_ids (tag text PRIMARY KEY, id uuid NOT NULL);
CREATE TEMP TABLE t4114i_tokens (tag text PRIMARY KEY, token text NOT NULL);
GRANT SELECT ON t4114i_ids TO authenticated;
GRANT SELECT ON t4114i_tokens TO authenticated;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['inviter', 'invitee', 'other', 'pal'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114i-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114i-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles
       SET display_name = 'T4114 ' || v_tag, active = true, visibility_mode = 'public'
     WHERE id = v_id;
    INSERT INTO t4114i_ids VALUES (v_tag, v_id);
  END LOOP;

  -- The text invite the inviter sent to a number the invitee never used.
  INSERT INTO public.pending_pair_invites(inviter_id, phone_e164, status)
    VALUES ((SELECT id FROM t4114i_ids WHERE tag = 'inviter'), '+2348035554412', 'pending');
  -- A second invite, used for the own-invite and cancelled cases.
  INSERT INTO public.pending_pair_invites(inviter_id, phone_e164, status)
    VALUES ((SELECT id FROM t4114i_ids WHERE tag = 'inviter'), '+447700900123', 'pending');
  -- The pal is already the inviter's friend; this invite is for them.
  INSERT INTO public.pending_pair_invites(inviter_id, phone_e164, status)
    VALUES ((SELECT id FROM t4114i_ids WHERE tag = 'inviter'), '+12015550199', 'pending');
  INSERT INTO public.friends(user_id, friend_user_id, status)
    VALUES ((SELECT id FROM t4114i_ids WHERE tag = 'inviter'), (SELECT id FROM t4114i_ids WHERE tag = 'pal'), 'accepted'),
           ((SELECT id FROM t4114i_ids WHERE tag = 'pal'), (SELECT id FROM t4114i_ids WHERE tag = 'inviter'), 'accepted');

  INSERT INTO t4114i_tokens
    SELECT CASE phone_e164 WHEN '+2348035554412' THEN 'main' WHEN '+447700900123' THEN 'second' ELSE 'pal' END, token
      FROM public.pending_pair_invites
     WHERE inviter_id = (SELECT id FROM t4114i_ids WHERE tag = 'inviter');
END $fixture$;

-- I-01 shape.
DO $i01$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pending_pair_invites'
     AND column_name = 'token' AND data_type = 'text' AND is_nullable = 'NO';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I-01: pending_pair_invites.token must be NOT NULL text (found %)', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.pending_pair_invites'::regclass
       AND conname = 'pending_pair_invites_token_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'I-01: the token must be UNIQUE';
  END IF;
  SELECT count(DISTINCT token) INTO v_count FROM t4114i_tokens WHERE token ~ '^[0-9a-f]{64}$';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'I-01: every invite must get its own random 64-hex token (distinct valid = %)', v_count;
  END IF;
END $i01$;

-- I-08 grants.
DO $i08$
BEGIN
  IF has_function_privilege('anon', 'public.claim_friend_invite(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'I-08: anon must not execute claim_friend_invite';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.claim_friend_invite(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'I-08: authenticated must execute claim_friend_invite';
  END IF;
END $i08$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114i_ids WHERE tag = 'invitee'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114i_ids WHERE tag = 'invitee'), 'role', 'authenticated')::text, true);

CREATE TEMP TABLE t4114i_first ON COMMIT DROP AS
  SELECT public.claim_friend_invite((SELECT token FROM t4114i_tokens WHERE tag = 'main')) AS result;

RESET ROLE;

-- I-02 the claim created the rows.
DO $i02$
DECLARE
  v_result jsonb := (SELECT result FROM t4114i_first);
  v_inviter uuid := (SELECT id FROM t4114i_ids WHERE tag = 'inviter');
  v_invitee uuid := (SELECT id FROM t4114i_ids WHERE tag = 'invitee');
  v_fr record;
  v_pr record;
  v_invite record;
BEGIN
  IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'I-02: the claim must succeed (%)', v_result;
  END IF;
  IF (v_result->>'inviter_id')::uuid IS DISTINCT FROM v_inviter THEN
    RAISE EXCEPTION 'I-02: the claim must name the inviter (%)', v_result;
  END IF;
  SELECT * INTO v_fr FROM public.friend_requests WHERE sender_id = v_inviter AND receiver_id = v_invitee;
  IF v_fr.id IS NULL OR v_fr.status <> 'pending' OR v_fr.id <> (v_result->>'friend_request_id')::uuid THEN
    RAISE EXCEPTION 'I-02: a pending friend request from the inviter must exist and be returned';
  END IF;
  SELECT * INTO v_pr FROM public.pair_requests WHERE sender_id = v_inviter AND receiver_id = v_invitee;
  IF v_pr.id IS NULL OR v_pr.status <> 'pending' OR v_pr.visibility <> 'hidden_until_friend'
     OR v_pr.gated_by_friend_request_id IS DISTINCT FROM v_fr.id
     OR v_pr.pending_phone_e164 IS DISTINCT FROM '+2348035554412'
     OR v_pr.id <> (v_result->>'pair_request_id')::uuid THEN
    RAISE EXCEPTION 'I-02: a hidden pair request gated by that friend request must exist and be returned';
  END IF;
  SELECT * INTO v_invite FROM public.pending_pair_invites WHERE token = (SELECT token FROM t4114i_tokens WHERE tag = 'main');
  IF v_invite.status <> 'converted' OR v_invite.converted_user_id IS DISTINCT FROM v_invitee OR v_invite.converted_at IS NULL THEN
    RAISE EXCEPTION 'I-02: the invite must be converted to the claimer';
  END IF;
END $i02$;

-- I-03 idempotent repeat from the same account.
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t4114i_again ON COMMIT DROP AS
  SELECT public.claim_friend_invite((SELECT token FROM t4114i_tokens WHERE tag = 'main')) AS result;
RESET ROLE;

DO $i03$
DECLARE
  v_first jsonb := (SELECT result FROM t4114i_first);
  v_again jsonb := (SELECT result FROM t4114i_again);
  v_inviter uuid := (SELECT id FROM t4114i_ids WHERE tag = 'inviter');
  v_invitee uuid := (SELECT id FROM t4114i_ids WHERE tag = 'invitee');
  v_count integer;
BEGIN
  IF (v_again->>'success')::boolean IS DISTINCT FROM true OR (v_again->>'already_claimed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'I-03: a repeat claim must succeed as already_claimed (%)', v_again;
  END IF;
  IF v_again->>'friend_request_id' IS DISTINCT FROM v_first->>'friend_request_id'
     OR v_again->>'pair_request_id' IS DISTINCT FROM v_first->>'pair_request_id' THEN
    RAISE EXCEPTION 'I-03: a repeat claim must return the same rows';
  END IF;
  SELECT count(*) INTO v_count FROM public.friend_requests WHERE sender_id = v_inviter AND receiver_id = v_invitee;
  IF v_count <> 1 THEN RAISE EXCEPTION 'I-03: expected 1 friend request, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.pair_requests WHERE sender_id = v_inviter AND receiver_id = v_invitee;
  IF v_count <> 1 THEN RAISE EXCEPTION 'I-03: expected 1 pair request, got %', v_count; END IF;
END $i03$;

-- I-04 token reuse by another account; I-05 refusals.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114i_ids WHERE tag = 'other'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114i_ids WHERE tag = 'other'), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE t4114i_reuse ON COMMIT DROP AS
  SELECT public.claim_friend_invite((SELECT token FROM t4114i_tokens WHERE tag = 'main')) AS result;
CREATE TEMP TABLE t4114i_garbage ON COMMIT DROP AS
  SELECT public.claim_friend_invite('not-a-token') AS bad_shape,
         public.claim_friend_invite(repeat('a', 64)) AS unknown;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114i_ids WHERE tag = 'inviter'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114i_ids WHERE tag = 'inviter'), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE t4114i_own ON COMMIT DROP AS
  SELECT public.claim_friend_invite((SELECT token FROM t4114i_tokens WHERE tag = 'second')) AS result;
RESET ROLE;

UPDATE public.pending_pair_invites SET status = 'cancelled'
 WHERE token = (SELECT token FROM t4114i_tokens WHERE tag = 'second');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114i_ids WHERE tag = 'other'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114i_ids WHERE tag = 'other'), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE t4114i_cancelled ON COMMIT DROP AS
  SELECT public.claim_friend_invite((SELECT token FROM t4114i_tokens WHERE tag = 'second')) AS result;
RESET ROLE;

DO $i04$
DECLARE
  v_other uuid := (SELECT id FROM t4114i_ids WHERE tag = 'other');
  v_inviter uuid := (SELECT id FROM t4114i_ids WHERE tag = 'inviter');
  v_count integer;
BEGIN
  IF (SELECT result->>'error' FROM t4114i_reuse) IS DISTINCT FROM 'already_claimed' THEN
    RAISE EXCEPTION 'I-04: reuse by another account must be already_claimed (%)', (SELECT result FROM t4114i_reuse);
  END IF;
  SELECT count(*) INTO v_count FROM public.friend_requests WHERE sender_id = v_inviter AND receiver_id = v_other;
  IF v_count <> 0 THEN RAISE EXCEPTION 'I-04: reuse must create no friend request'; END IF;
  SELECT count(*) INTO v_count FROM public.pair_requests WHERE sender_id = v_inviter AND receiver_id = v_other;
  IF v_count <> 0 THEN RAISE EXCEPTION 'I-04: reuse must create no pair request'; END IF;

  IF (SELECT result->>'error' FROM t4114i_own) IS DISTINCT FROM 'own_invite' THEN
    RAISE EXCEPTION 'I-05: the inviter must not claim their own invite (%)', (SELECT result FROM t4114i_own);
  END IF;
  IF (SELECT result->>'error' FROM t4114i_cancelled) IS DISTINCT FROM 'invite_cancelled' THEN
    RAISE EXCEPTION 'I-05: a cancelled invite must be refused (%)', (SELECT result FROM t4114i_cancelled);
  END IF;
  IF (SELECT bad_shape->>'error' FROM t4114i_garbage) IS DISTINCT FROM 'invalid_token'
     OR (SELECT unknown->>'error' FROM t4114i_garbage) IS DISTINCT FROM 'invalid_token' THEN
    RAISE EXCEPTION 'I-05: malformed and unknown tokens must be invalid_token';
  END IF;
  SELECT count(*) INTO v_count FROM public.friend_requests WHERE receiver_id = v_other;
  IF v_count <> 0 THEN RAISE EXCEPTION 'I-05: refused claims must write nothing'; END IF;
END $i04$;

-- I-06 accepting the friend request reveals the pair request.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114i_ids WHERE tag = 'invitee'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114i_ids WHERE tag = 'invitee'), 'role', 'authenticated')::text, true);
SELECT public.accept_friend_request_atomic(((SELECT result FROM t4114i_first)->>'friend_request_id')::uuid);
RESET ROLE;

DO $i06$
BEGIN
  IF (SELECT visibility FROM public.pair_requests
       WHERE id = ((SELECT result FROM t4114i_first)->>'pair_request_id')::uuid) IS DISTINCT FROM 'visible' THEN
    RAISE EXCEPTION 'I-06: accepting the claimed friend request must reveal the pair request';
  END IF;
END $i06$;

-- I-07 already friends: a visible pair request, no friend request.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114i_ids WHERE tag = 'pal'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114i_ids WHERE tag = 'pal'), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE t4114i_pal ON COMMIT DROP AS
  SELECT public.claim_friend_invite((SELECT token FROM t4114i_tokens WHERE tag = 'pal')) AS result;
RESET ROLE;

DO $i07$
DECLARE
  v_result jsonb := (SELECT result FROM t4114i_pal);
  v_inviter uuid := (SELECT id FROM t4114i_ids WHERE tag = 'inviter');
  v_pal uuid := (SELECT id FROM t4114i_ids WHERE tag = 'pal');
BEGIN
  IF (v_result->>'success')::boolean IS DISTINCT FROM true OR (v_result->>'already_friends')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'I-07: claim by an existing friend must succeed as already_friends (%)', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.friend_requests WHERE sender_id = v_inviter AND receiver_id = v_pal) THEN
    RAISE EXCEPTION 'I-07: no friend request between existing friends';
  END IF;
  IF (SELECT visibility FROM public.pair_requests WHERE sender_id = v_inviter AND receiver_id = v_pal AND status = 'pending')
     IS DISTINCT FROM 'visible' THEN
    RAISE EXCEPTION 'I-07: existing friends get a visible pair request';
  END IF;
END $i07$;

SELECT 'issue #4114 friend invite token: I-01..I-08 PASS' AS result;

ROLLBACK;
