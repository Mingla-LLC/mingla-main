-- #1612 — SQL BEHAVIOUR test for the record-visit ON CONFLICT arbiter.
--
-- This test deliberately does NOT assert on the text of any migration. A string
-- assertion would not have caught this bug: the edge function's SQL was always correct,
-- and the migration that created the partial index was also "correct" in isolation. The
-- defect only exists in the INTERACTION between them, and only Postgres can adjudicate
-- it. So this test EXECUTES the exact statement shape PostgREST emits for
-- `.upsert({...}, { onConflict: "user_id,experience_id" })` and asserts the resulting
-- behaviour.
--
-- Run via psql with ON_ERROR_STOP=1 against a DB with every migration applied.
-- Wrapped in a transaction that ROLLBACKs — it writes nothing durable.
--
-- FAILS-ON-REVERT: restore `user_visits_unique_active` as a partial unique index and
-- drop `user_visits_user_id_experience_id_key`, and T1 raises 42P10 — exactly the
-- production failure. Revert the fan-out function to 'scheduled' and T3 fails.

BEGIN;

-- ── Fixtures (triggers suppressed so only the code under test fires) ─────────────
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id) VALUES
  ('16120000-0000-0000-0000-000000000001');

INSERT INTO public.place_pool(id, google_place_id, name, lat, lng) VALUES
  ('16120000-0000-0000-0000-0000000000a1', 'issue-1612-google-place', '#1612 Probe Venue', 51.5074, -0.1278);

-- Triggers back ON: the visit fan-out is part of what we are testing.
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_user        uuid := '16120000-0000-0000-0000-000000000001';
  v_place       uuid := '16120000-0000-0000-0000-0000000000a1';
  v_exp         text := 'issue-1612-google-place';
  v_unmatched   text := 'issue-1612-unmatched-place';
  v_rows        bigint;
  v_visited_at  timestamptz;
  v_visited_at2 timestamptz;
  v_category    text;
  v_arbiters    bigint;
  v_rejected    boolean;
BEGIN
  ---------------------------------------------------------------------------
  -- T1. The exact statement PostgREST emits must PLAN AND RUN.
  --     This is the assertion that reproduces #1612. On revert: 42P10.
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.user_visits (user_id, experience_id, card_data, visited_at, source)
    VALUES (v_user, v_exp, '{"category":"Fine Dining","title":"First"}'::jsonb,
            '2026-08-01T10:00:00Z'::timestamptz, 'manual')
    ON CONFLICT (user_id, experience_id)
    DO UPDATE SET card_data  = EXCLUDED.card_data,
                  visited_at = EXCLUDED.visited_at,
                  source     = EXCLUDED.source;
  EXCEPTION WHEN SQLSTATE '42P10' THEN
    RAISE EXCEPTION
      '#1612 REGRESSION: ON CONFLICT (user_id, experience_id) has NO valid arbiter on public.user_visits (SQLSTATE 42P10). A partial unique index is back, or user_visits_user_id_experience_id_key was dropped. Every record-visit call will 500 and nothing can record a visit.';
  END;

  SELECT count(*) INTO v_rows FROM public.user_visits WHERE user_id = v_user AND experience_id = v_exp;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '#1612 T1: expected exactly 1 visit row after first upsert, found %', v_rows;
  END IF;

  ---------------------------------------------------------------------------
  -- T2. Repeat upsert (the double-tap / two-devices case) must UPDATE IN PLACE,
  --     not insert a second row and not error.
  ---------------------------------------------------------------------------
  SELECT visited_at INTO v_visited_at FROM public.user_visits WHERE user_id = v_user AND experience_id = v_exp;

  INSERT INTO public.user_visits (user_id, experience_id, card_data, visited_at, source)
  VALUES (v_user, v_exp, '{"category":"Fine Dining","title":"Second"}'::jsonb,
          '2026-08-02T20:30:00Z'::timestamptz, 'manual')
  ON CONFLICT (user_id, experience_id)
  DO UPDATE SET card_data  = EXCLUDED.card_data,
                visited_at = EXCLUDED.visited_at,
                source     = EXCLUDED.source;

  SELECT count(*) INTO v_rows FROM public.user_visits WHERE user_id = v_user AND experience_id = v_exp;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '#1612 T2: repeat upsert created a duplicate — expected 1 row, found %', v_rows;
  END IF;

  SELECT visited_at, card_data->>'title' INTO v_visited_at2, v_category
  FROM public.user_visits WHERE user_id = v_user AND experience_id = v_exp;

  IF v_visited_at2 <= v_visited_at THEN
    RAISE EXCEPTION '#1612 T2: repeat upsert did not advance visited_at (% -> %)', v_visited_at, v_visited_at2;
  END IF;
  IF v_category <> 'Second' THEN
    RAISE EXCEPTION '#1612 T2: repeat upsert did not replace card_data (title = %)', v_category;
  END IF;

  ---------------------------------------------------------------------------
  -- T3. The visit must be labelled 'visited' in engagement_metrics — NOT 'scheduled'.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_rows
  FROM public.engagement_metrics
  WHERE user_id = v_user AND place_pool_id = v_place AND event_kind = 'visited';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '#1612 T3: expected exactly 1 engagement row with event_kind=''visited'', found %', v_rows;
  END IF;

  SELECT count(*) INTO v_rows
  FROM public.engagement_metrics
  WHERE user_id = v_user AND place_pool_id = v_place AND event_kind = 'scheduled';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '#1612 T3: visit was mislabelled as ''scheduled'' (% row(s)) — fan_visit_to_engagement regressed', v_rows;
  END IF;

  ---------------------------------------------------------------------------
  -- T4. The conflicting (UPDATE-path) upsert must NOT double-count engagement.
  --     AFTER INSERT does not fire when ON CONFLICT takes the DO UPDATE branch.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_rows
  FROM public.engagement_metrics
  WHERE user_id = v_user AND place_pool_id = v_place;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '#1612 T4: two upserts produced % engagement rows — expected exactly 1 (repeat visits must not amplify)', v_rows;
  END IF;

  ---------------------------------------------------------------------------
  -- T5. The arbiter must be a FULL (non-partial) unique index on exactly those
  --     two columns. This is the structural guard against the defect returning.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_arbiters
  FROM pg_index ix
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'user_visits'
    AND ix.indisunique
    AND ix.indpred IS NULL
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM unnest(ix.indkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    ) = ARRAY['experience_id', 'user_id']::text[];

  IF v_arbiters < 1 THEN
    RAISE EXCEPTION '#1612 T5: no FULL unique index on (user_id, experience_id) — a partial index cannot arbitrate a PostgREST upsert';
  END IF;

  ---------------------------------------------------------------------------
  -- T6. NULLS DISTINCT semantics must be preserved. user_visits.user_id is
  --     nullable via ON DELETE SET NULL; deleted users' visits must NOT collapse.
  --     (Uses an experience_id absent from place_pool so the fan-out stays silent
  --      and T3/T4 counts remain clean.)
  ---------------------------------------------------------------------------
  INSERT INTO public.user_visits (user_id, experience_id, card_data, visited_at, source)
  VALUES (NULL, v_unmatched, '{}'::jsonb, now(), 'manual');
  INSERT INTO public.user_visits (user_id, experience_id, card_data, visited_at, source)
  VALUES (NULL, v_unmatched, '{}'::jsonb, now(), 'manual');

  SELECT count(*) INTO v_rows
  FROM public.user_visits WHERE user_id IS NULL AND experience_id = v_unmatched;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION '#1612 T6: expected 2 NULL-user rows (NULLS DISTINCT), found % — did the constraint gain NULLS NOT DISTINCT? That would destroy deleted users'' visit history', v_rows;
  END IF;

  ---------------------------------------------------------------------------
  -- T7. The widened CHECK must still reject unknown kinds, and must still accept
  --     'scheduled' (record_engagement's calendar path must not regress).
  ---------------------------------------------------------------------------
  INSERT INTO public.engagement_metrics (user_id, event_kind, place_pool_id)
  VALUES (v_user, 'scheduled', v_place);

  v_rejected := false;
  BEGIN
    INSERT INTO public.engagement_metrics (user_id, event_kind, place_pool_id)
    VALUES (v_user, 'issue-1612-not-a-real-kind', v_place);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION '#1612 T7: engagement_metrics_event_kind_check no longer rejects unknown event kinds — the CHECK was dropped rather than widened';
  END IF;

  RAISE NOTICE '#1612 record-visit conflict-target behaviour tests: all 7 passed';
END $test$;

ROLLBACK;
