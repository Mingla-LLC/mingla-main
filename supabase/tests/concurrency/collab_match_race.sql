-- ORCH-0558 concurrency test harness.
--
-- Runs 2 concurrent transactions that BOTH INSERT a swipe-state row for
-- the same (session_id, experience_id). Under ORCH-0558's advisory lock
-- + unique constraint, exactly 1 board_saved_cards row and 2 board_votes
-- rows MUST result. Pre-ORCH-0558 this test would intermittently fail
-- (both Txs see count=1, neither promotes).
--
-- Prerequisites:
--   1. Migrations 20260421000001-05 applied
--   2. dblink extension installed (create with `CREATE EXTENSION IF NOT EXISTS dblink`)
--   3. Two test users created + session_participants rows for them
--
-- Invocation (one-shot):
--   psql $DATABASE_URL -v test_session_id="'<uuid>'" \
--                      -v test_user_a="'<uuid>'" \
--                      -v test_user_b="'<uuid>'" \
--                      -v test_card_id="'<placeid>'" \
--                      -f collab_match_race.sql
--
-- Invocation (stress, via shell loop):
--   for i in $(seq 1 100); do psql ... -f collab_match_race.sql || echo "FAIL iter $i"; done
--
-- Expected stdout:
--   NOTICE:  ORCH-0558 concurrency test PASS: 1 saved_card, 2 votes
--
-- Any RAISE EXCEPTION ends with FAIL and a non-zero psql exit status.

\set ON_ERROR_STOP on
\if :{?test_session_id}
\else
  \echo 'Missing variable: test_session_id'
  \quit
\endif
\if :{?test_user_a}
\else
  \echo 'Missing variable: test_user_a'
  \quit
\endif
\if :{?test_user_b}
\else
  \echo 'Missing variable: test_user_b'
  \quit
\endif
\if :{?test_card_id}
\else
  \echo 'Missing variable: test_card_id'
  \quit
\endif

-- Pre-clean (idempotent per invocation)
DELETE FROM public.board_votes
  WHERE session_id = :test_session_id;
DELETE FROM public.board_saved_cards
  WHERE session_id = :test_session_id AND experience_id = :test_card_id;
DELETE FROM public.board_user_swipe_states
  WHERE session_id = :test_session_id AND experience_id = :test_card_id;

-- Ensure dblink is available
CREATE EXTENSION IF NOT EXISTS dblink;

-- Spawn two concurrent transactions via dblink_connect
DO $$
DECLARE
  conn_str TEXT;
  card_json_a TEXT;
  card_json_b TEXT;
  q_a TEXT;
  q_b TEXT;
BEGIN
  conn_str := 'dbname=' || current_database();

  -- dblink_connect is per-session; reuse names for idempotency
  BEGIN
    PERFORM dblink_disconnect('conn_a');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM dblink_disconnect('conn_b');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM dblink_connect('conn_a', conn_str);
  PERFORM dblink_connect('conn_b', conn_str);

  PERFORM dblink_exec('conn_a', 'BEGIN');
  PERFORM dblink_exec('conn_b', 'BEGIN');

  card_json_a := jsonb_build_object('id', :'test_card_id', 'title', 'Concurrency Test')::TEXT;
  card_json_b := jsonb_build_object('id', :'test_card_id', 'title', 'Concurrency Test')::TEXT;

  q_a := format(
    $sql$INSERT INTO public.board_user_swipe_states
         (session_id, experience_id, user_id, swipe_state, swiped_at, card_data)
         VALUES (%L, %L, %L, 'swiped_right', NOW(), %L::jsonb)
         ON CONFLICT (session_id, experience_id, user_id) DO UPDATE
           SET swipe_state = 'swiped_right', swiped_at = NOW(), card_data = EXCLUDED.card_data$sql$,
    :test_session_id, :test_card_id, :test_user_a, card_json_a
  );
  q_b := format(
    $sql$INSERT INTO public.board_user_swipe_states
         (session_id, experience_id, user_id, swipe_state, swiped_at, card_data)
         VALUES (%L, %L, %L, 'swiped_right', NOW(), %L::jsonb)
         ON CONFLICT (session_id, experience_id, user_id) DO UPDATE
           SET swipe_state = 'swiped_right', swiped_at = NOW(), card_data = EXCLUDED.card_data$sql$,
    :test_session_id, :test_card_id, :test_user_b, card_json_b
  );

  PERFORM dblink_exec('conn_a', q_a);
  PERFORM dblink_exec('conn_b', q_b);

  -- Commit both near-simultaneously
  PERFORM dblink_exec('conn_a', 'COMMIT');
  PERFORM dblink_exec('conn_b', 'COMMIT');

  PERFORM dblink_disconnect('conn_a');
  PERFORM dblink_disconnect('conn_b');
END $$;

-- Assertions
DO $$
DECLARE
  saved_count INTEGER;
  vote_count INTEGER;
  swipe_count INTEGER;
BEGIN
  SELECT count(*) INTO saved_count
  FROM public.board_saved_cards
  WHERE session_id = :test_session_id AND experience_id = :test_card_id;

  SELECT count(*) INTO vote_count
  FROM public.board_votes bv
  WHERE bv.session_id = :test_session_id
    AND bv.saved_card_id IN (
      SELECT id FROM public.board_saved_cards
      WHERE session_id = :test_session_id AND experience_id = :test_card_id
    );

  SELECT count(*) INTO swipe_count
  FROM public.board_user_swipe_states
  WHERE session_id = :test_session_id
    AND experience_id = :test_card_id
    AND swipe_state = 'swiped_right';

  IF saved_count <> 1 THEN
    RAISE EXCEPTION 'ORCH-0558 concurrency test FAIL: expected 1 saved_card, got %', saved_count;
  END IF;
  IF vote_count <> 2 THEN
    RAISE EXCEPTION 'ORCH-0558 concurrency test FAIL: expected 2 votes, got %', vote_count;
  END IF;
  IF swipe_count <> 2 THEN
    RAISE EXCEPTION 'ORCH-0558 concurrency test FAIL: expected 2 swipe rows, got %', swipe_count;
  END IF;

  RAISE NOTICE 'ORCH-0558 concurrency test PASS: 1 saved_card, 2 votes';
END $$;
