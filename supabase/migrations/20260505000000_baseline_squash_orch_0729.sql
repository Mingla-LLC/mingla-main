-- ============================================================================
-- ORCH-0729 (2026-05-05): SQUASH BASELINE — replaces 493 historical migrations
-- ============================================================================
--
-- WHY: The migration chain accumulated 6 distinct apply-time bomb classes
-- between 2026-04-09 and 2026-05-05 due to incremental dashboard-direct schema
-- changes that were never backfilled into migration files. Production was
-- correct; the migration chain alone could not rebuild it. Each PR's Supabase
-- Branch CI tried to replay all 493 files on a fresh DB and crashed at a
-- different bomb on every push (CONCURRENTLY-in-tx, OUT-param shape changes,
-- DML PK collisions, missing ADD COLUMN, production-state-coupled assertions).
--
-- WHAT THIS FILE IS: the verbatim output of `supabase db dump --linked`
-- against the Mingla-dev project (gqnoajqerqhnvulmnyvv) on 2026-05-05.
-- It represents production's exact schema state at squash time. Applying
-- this file to a fresh empty database produces a database structurally
-- identical to production.
--
-- HISTORICAL MIGRATIONS: preserved in
--   Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/
-- (493 files; full git history retained). They are NOT applied on fresh-DB
-- replay — only this baseline is.
--
-- POST-MERGE STEPS FOR PRODUCTION:
--   Production's supabase_migrations.schema_migrations table currently has
--   ~493 rows (one per applied historical migration). After this PR merges,
--   align prod's history with the new baseline:
--
--     1. Mark the baseline as applied (so prod doesn't try to re-run it):
--        supabase migration repair --status applied 20260505000000
--
--     2. Mark the historical migrations as reverted (so they're recognized
--        as superseded — does NOT undo their effects on prod):
--        For each timestamp in the archive directory, run:
--          supabase migration repair --status reverted <timestamp>
--        Or bulk via SQL on prod:
--          DELETE FROM supabase_migrations.schema_migrations
--          WHERE version != '20260505000000';
--          INSERT INTO supabase_migrations.schema_migrations (version)
--          VALUES ('20260505000000') ON CONFLICT DO NOTHING;
--
-- DEV ONBOARDING (fresh local DB):
--   `supabase db reset` runs this baseline → schema matches production.
--   Seed data (signal_definitions, rule_sets, admin_config, seeding_cities)
--   is NOT in this baseline — pull from production via:
--     supabase db dump --data-only --linked -f seed.sql
--   then apply once to local. (Future improvement: maintain a curated seed.sql
--   in this directory.)
--
-- THE 6 BOMB CLASSES THIS BASELINE NEUTRALIZES:
--   1. ORCH-0721: CREATE INDEX CONCURRENTLY in 20260409200001 (txn-wrapped runner)
--   2. ORCH-0722: CREATE OR REPLACE FUNCTION OUT-param shape changes ×2
--      in 20260411000001 (check_pairing_allowed + admin_list_subscriptions)
--   3. ORCH-0727: UPDATE category_type_exclusions PK collision in 20260415100000
--   4. ORCH-0728: CREATE MATERIALIZED VIEW references missing claimed_by column
--      in 20260418000001 (dashboard-only schema addition)
--   5. ORCH-0729: ORCH-0671 production-state-coupled post-condition assertion
--      in 20260428100001 (RAISE EXCEPTION when archive empty)
--   6. (and any further unknown bombs in the chain — squash neutralizes the class)
--
-- ============================================================================
-- BEGIN PRODUCTION SCHEMA DUMP (2026-05-05)
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."report_reason" AS ENUM (
    'spam',
    'inappropriate-content',
    'harassment',
    'other'
);


ALTER TYPE "public"."report_reason" OWNER TO "postgres";


CREATE TYPE "public"."report_status" AS ENUM (
    'pending',
    'reviewed',
    'resolved',
    'dismissed'
);


ALTER TYPE "public"."report_status" OWNER TO "postgres";


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


ALTER FUNCTION "public"."accept_friend_request"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_friend_request_atomic"("p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_request friend_requests%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_request
    FROM public.friend_requests
    WHERE id = p_request_id
    AND status = 'pending'
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Request not found or already processed'
    );
  END IF;

  IF auth.uid() != v_request.receiver_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only the receiver can accept a friend request'
    );
  END IF;

  UPDATE public.friend_requests
    SET status = 'accepted', updated_at = NOW()
    WHERE id = p_request_id;

  INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (v_request.sender_id, v_request.receiver_id, 'accepted')
    ON CONFLICT (user_id, friend_user_id)
    DO UPDATE SET status = 'accepted', updated_at = NOW();

  INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (v_request.receiver_id, v_request.sender_id, 'accepted')
    ON CONFLICT (user_id, friend_user_id)
    DO UPDATE SET status = 'accepted', updated_at = NOW();

  DELETE FROM public.blocked_users
  WHERE (blocker_id = v_request.sender_id AND blocked_id = v_request.receiver_id)
     OR (blocker_id = v_request.receiver_id AND blocked_id = v_request.sender_id);

  SELECT jsonb_build_object(
    'success', true,
    'sender_id', v_request.sender_id,
    'receiver_id', v_request.receiver_id,
    'revealed_invite_ids', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'session_id', ci.session_id,
        'inviter_id', ci.inviter_id,
        'invited_user_id', ci.invited_user_id,
        'session_name', cs.name
      ))
      FROM public.collaboration_invites ci
      JOIN public.collaboration_sessions cs ON cs.id = ci.session_id
      WHERE ci.pending_friendship = false
        AND ci.status = 'pending'
        AND (
          (ci.inviter_id = v_request.sender_id AND ci.invited_user_id = v_request.receiver_id)
          OR
          (ci.inviter_id = v_request.receiver_id AND ci.invited_user_id = v_request.sender_id)
        )
      ),
      '[]'::jsonb
    ),
    'revealed_pair_request_ids', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'sender_id', pr.sender_id,
        'receiver_id', pr.receiver_id
      ))
      FROM public.pair_requests pr
      WHERE pr.gated_by_friend_request_id = p_request_id
        AND pr.visibility = 'visible'
        AND pr.status = 'pending'
      ),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."accept_friend_request_atomic"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_pair_request_atomic"("p_request_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_request pair_requests%ROWTYPE;
    v_pairing_id UUID;
    v_user_a UUID;
    v_user_b UUID;
BEGIN
    -- Lock the request row
    SELECT * INTO v_request
    FROM pair_requests
    WHERE id = p_request_id AND receiver_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pair request not found or not authorized';
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'Pair request is no longer pending (status: %)', v_request.status;
    END IF;

    IF v_request.visibility != 'visible' THEN
        RAISE EXCEPTION 'Pair request is not yet visible';
    END IF;

    -- Update request status
    UPDATE pair_requests SET status = 'accepted', updated_at = now()
    WHERE id = p_request_id;

    -- Canonical ordering for pairings table
    IF v_request.sender_id < v_request.receiver_id THEN
        v_user_a := v_request.sender_id;
        v_user_b := v_request.receiver_id;
    ELSE
        v_user_a := v_request.receiver_id;
        v_user_b := v_request.sender_id;
    END IF;

    -- Create pairing (ignore if already exists — idempotent)
    INSERT INTO pairings (user_a_id, user_b_id, pair_request_id)
    VALUES (v_user_a, v_user_b, v_request.id)
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING
    RETURNING id INTO v_pairing_id;

    RETURN json_build_object(
        'pairing_id', v_pairing_id,
        'paired_with_user_id', v_request.sender_id
    );
END;
$$;


ALTER FUNCTION "public"."accept_pair_request_atomic"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_invited_admin"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := lower(coalesce(
    current_setting('request.jwt.claims', true)::json->>'email',
    ''
  ));

  IF v_email = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.admin_users
  SET status = 'active',
      accepted_at = now()
  WHERE lower(email) = v_email
    AND status = 'invited';
END;
$$;


ALTER FUNCTION "public"."activate_invited_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_board_card"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Log the activity
  INSERT INTO public.activity_history (board_id, card_id, user_id, action_type, action_data)
  VALUES (NEW.board_id, NEW.id, NEW.added_by, 'add_card', '{}');
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."add_board_card"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id    uuid := auth.uid();
  v_session_status text;
  v_existing_participant record;
  v_existing_invite record;
  v_new_invite_id uuid;
  v_new_invite_created_at timestamptz;
BEGIN
  -- Guard 1: authenticated
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'unauthenticated');
  END IF;

  -- Guard 2: self-invite refused
  IF v_caller_id = p_friend_user_id THEN
    RETURN jsonb_build_object('outcome', 'session_creator_self_invite', 'error_code', 'self_invite');
  END IF;

  -- Guard 3: caller must be a session member (or creator — covered by participant table since creators are always rows in session_participants per current code paths)
  IF NOT public.is_session_participant(p_session_id, v_caller_id)
     AND NOT public.is_session_creator(p_session_id, v_caller_id) THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'caller_not_in_session');
  END IF;

  -- Guard 4: session must exist + be in invitable state
  SELECT status INTO v_session_status
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'session_not_found');
  END IF;

  IF v_session_status NOT IN ('pending', 'active') THEN
    RETURN jsonb_build_object(
      'outcome', 'session_invalid',
      'error_code', 'session_status_' || v_session_status
    );
  END IF;

  -- Guard 5: bidirectional block-check (HF-4 close)
  IF public.has_block_between(v_caller_id, p_friend_user_id) THEN
    RETURN jsonb_build_object('outcome', 'blocked', 'error_code', 'block_between_users');
  END IF;

  -- Idempotency: already-accepted member
  SELECT user_id, has_accepted INTO v_existing_participant
    FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_friend_user_id;

  IF FOUND AND v_existing_participant.has_accepted = TRUE THEN
    RETURN jsonb_build_object('outcome', 'already_member', 'error_code', 'friend_already_accepted');
  END IF;

  -- Idempotency: already-pending invite
  SELECT id, created_at, status INTO v_existing_invite
    FROM public.collaboration_invites
    WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

  IF FOUND AND v_existing_invite.status = 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  -- Re-pending after decline/cancel: UPDATE existing row to status='pending' (per investigation §14 Q2 + spec §0 lock)
  IF FOUND AND v_existing_invite.status IN ('declined', 'cancelled') THEN
    UPDATE public.collaboration_invites
      SET status = 'pending',
          updated_at = NOW(),
          inviter_id = v_caller_id  -- re-attribute to current adder
      WHERE id = v_existing_invite.id
      RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

    -- Also ensure session_participants row is present with has_accepted=false
    INSERT INTO public.session_participants (session_id, user_id, has_accepted)
    VALUES (p_session_id, p_friend_user_id, FALSE)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET has_accepted = FALSE
      WHERE session_participants.has_accepted = FALSE;  -- never demote an accepted row

    RETURN jsonb_build_object(
      'outcome', 'invited',
      'invite_id', v_new_invite_id,
      'created_at', v_new_invite_created_at
    );
  END IF;

  -- Happy path: insert participant + invite atomically (RPC is transactional)
  INSERT INTO public.session_participants (session_id, user_id, has_accepted)
  VALUES (p_session_id, p_friend_user_id, FALSE)
  ON CONFLICT (session_id, user_id) DO NOTHING;

  INSERT INTO public.collaboration_invites (
    session_id, inviter_id, invited_user_id, status, invite_method
  )
  VALUES (
    p_session_id, v_caller_id, p_friend_user_id, 'pending', 'friends_list'
  )
  ON CONFLICT (session_id, invited_user_id) DO NOTHING
  RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

  -- If RETURNING is null, ON CONFLICT fired — extreme race; treat as already_invited
  IF v_new_invite_id IS NULL THEN
    SELECT id, created_at INTO v_existing_invite
      FROM public.collaboration_invites
      WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'invited',
    'invite_id', v_new_invite_id,
    'created_at', v_new_invite_created_at
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Last-resort safety net. Never leak stack traces. Log server-side.
    RAISE WARNING 'add_friend_to_session error for session=% friend=%: %', p_session_id, p_friend_user_id, SQLERRM;
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'rpc_internal_error');
END;
$$;


ALTER FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") IS 'ORCH-0666: Atomic add-friend-to-existing-session pipeline. SECURITY DEFINER. Caller (auth.uid()) must be a session participant. Returns jsonb {outcome, invite_id?, created_at?, error_code?}. Idempotent. Bidirectional block-check enforced.';



CREATE OR REPLACE FUNCTION "public"."admin_analytics_engagement"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'dau', (SELECT count(DISTINCT user_id) FROM user_sessions
            WHERE started_at >= now() - interval '1 day'),
    'wau', (SELECT count(DISTINCT user_id) FROM user_sessions
            WHERE started_at >= now() - interval '7 days'),
    'mau', (SELECT count(DISTINCT user_id) FROM user_sessions
            WHERE started_at >= now() - interval '30 days'),
    'avg_duration_seconds', (SELECT coalesce(avg(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)
            FROM user_sessions WHERE ended_at IS NOT NULL
            AND started_at >= now() - (p_days || ' days')::interval),
    'feature_usage', (SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
            SELECT interaction_type, count(*) AS cnt
            FROM user_interactions
            WHERE created_at >= now() - (p_days || ' days')::interval
            GROUP BY interaction_type ORDER BY cnt DESC LIMIT 10
    ) t)
  ) INTO result;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."admin_analytics_engagement"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_analytics_funnel"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'signups', (SELECT count(*) FROM profiles),
    'onboarded', (SELECT count(*) FROM profiles WHERE has_completed_onboarding = true),
    'interacted', (SELECT count(DISTINCT user_id) FROM user_interactions),
    'boarded', (SELECT count(DISTINCT user_id) FROM session_participants)
  ) INTO result;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."admin_analytics_funnel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_analytics_geo"() RETURNS TABLE("country" "text", "user_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT coalesce(p.country, 'Unknown') AS country, count(*) AS user_count
    FROM profiles p
    GROUP BY p.country
    ORDER BY user_count DESC
    LIMIT 50;
END;
$$;


ALTER FUNCTION "public"."admin_analytics_geo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_analytics_growth"("p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "signups" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT created_at::date AS day, count(*) AS signups
    FROM profiles
    WHERE created_at >= now() - (p_days || ' days')::interval
    GROUP BY created_at::date
    ORDER BY day;
END;
$$;


ALTER FUNCTION "public"."admin_analytics_growth"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_analytics_retention"("p_weeks" integer DEFAULT 8) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  WITH cohorts AS (
    SELECT
      p.id AS user_id,
      date_trunc('week', p.created_at)::date AS cohort_week
    FROM profiles p
    WHERE p.created_at >= now() - (p_weeks || ' weeks')::interval
  ),
  activity AS (
    SELECT
      c.user_id,
      c.cohort_week,
      date_trunc('week', s.started_at)::date AS activity_week
    FROM cohorts c
    JOIN user_sessions s ON s.user_id = c.user_id
    WHERE s.started_at >= c.cohort_week::timestamp
  ),
  cohort_sizes AS (
    SELECT cohort_week, count(DISTINCT user_id) AS cohort_size
    FROM cohorts
    GROUP BY cohort_week
  ),
  retention AS (
    SELECT
      a.cohort_week,
      ((a.activity_week - a.cohort_week) / 7) AS week_number,
      count(DISTINCT a.user_id) AS active_users
    FROM activity a
    GROUP BY a.cohort_week, week_number
  )
  SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.cohort_week), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      cs.cohort_week,
      cs.cohort_size,
      jsonb_object_agg(
        'week_' || r.week_number,
        round((r.active_users::numeric / NULLIF(cs.cohort_size, 0)) * 100, 1)
      ) AS retention_pcts
    FROM cohort_sizes cs
    LEFT JOIN retention r ON r.cohort_week = cs.cohort_week
    GROUP BY cs.cohort_week, cs.cohort_size
  ) t;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."admin_analytics_retention"("p_weeks" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_bulk_deactivate_places"("p_place_ids" "uuid"[], "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_places_deactivated INTEGER;
  v_pid UUID;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  IF p_place_ids IS NULL OR array_length(p_place_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'No place IDs provided');
  END IF;

  WITH deactivated AS (
    UPDATE place_pool SET is_active = false, updated_at = now()
    WHERE id = ANY(p_place_ids) AND is_active = true
    RETURNING id
  )
  SELECT COUNT(*) INTO v_places_deactivated FROM deactivated;

  FOREACH v_pid IN ARRAY p_place_ids LOOP
    INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
    VALUES (v_pid, 'bulk_deactivate', v_user_id, p_reason,
      jsonb_build_object('batch_size', array_length(p_place_ids, 1)));
  END LOOP;

  -- ORCH-0640: card-count projections removed. Cards no longer exist.
  -- Callers who displayed the counts now show 0 or omit the field.
  RETURN jsonb_build_object(
    'success', true,
    'places_deactivated', v_places_deactivated,
    'cards_deactivated', 0,
    'single_cards_deactivated', 0,
    'curated_cards_deactivated', 0
  );
END;
$$;


ALTER FUNCTION "public"."admin_bulk_deactivate_places"("p_place_ids" "uuid"[], "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_card_generation_active"("p_city" "text") RETURNS TABLE("id" "uuid", "status" "text", "total_categories" integer, "completed_categories" integer, "current_category" "text", "total_created" integer, "total_skipped" integer, "total_eligible" integer, "category_results" "jsonb", "started_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND admin_users.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.status, r.total_categories, r.completed_categories,
         r.current_category, r.total_created, r.total_skipped,
         r.total_eligible, r.category_results, r.started_at
  FROM public.card_generation_runs r
  WHERE r.city = p_city AND r.status = 'running'
  ORDER BY r.started_at DESC
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."admin_card_generation_active"("p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_card_generation_status"("p_run_id" "uuid") RETURNS TABLE("id" "uuid", "status" "text", "city" "text", "country" "text", "total_categories" integer, "completed_categories" integer, "current_category" "text", "total_created" integer, "total_skipped" integer, "skipped_no_photos" integer, "skipped_duplicate" integer, "skipped_child_venue" integer, "total_eligible" integer, "category_results" "jsonb", "error_message" "text", "started_at" timestamp with time zone, "completed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND admin_users.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.status, r.city, r.country,
         r.total_categories, r.completed_categories, r.current_category,
         r.total_created, r.total_skipped,
         r.skipped_no_photos, r.skipped_duplicate, r.skipped_child_venue,
         r.total_eligible, r.category_results, r.error_message,
         r.started_at, r.completed_at
  FROM public.card_generation_runs r
  WHERE r.id = p_run_id;
END;
$$;


ALTER FUNCTION "public"."admin_card_generation_status"("p_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_city_picker_data"() RETURNS TABLE("city_id" "uuid", "city_name" "text", "country_name" "text", "country_code" "text", "city_status" "text", "is_servable_places" bigint, "total_active_places" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users au WHERE au.email = auth.email() AND au.status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country AS country_name,
    sc.country_code,
    sc.status AS city_status,
    (SELECT COUNT(*) FROM place_pool pp
     WHERE pp.city_id = sc.id AND pp.is_active AND pp.is_servable = true
    ) AS is_servable_places,
    (SELECT COUNT(*) FROM place_pool pp
     WHERE pp.city_id = sc.id AND pp.is_active
    ) AS total_active_places
  FROM seeding_cities sc
  ORDER BY sc.country, sc.name;
END;
$$;


ALTER FUNCTION "public"."admin_city_picker_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_city_pipeline_status"() RETURNS TABLE("city_id" "uuid", "city_name" "text", "country_name" "text", "country_code" "text", "city_status" "text", "created_at" timestamp with time zone, "total_active" bigint, "seeded_count" bigint, "refreshed_count" bigint, "bouncer_judged_count" bigint, "is_servable_count" bigint, "has_real_photos_count" bigint, "scored_count" bigint, "last_place_update" timestamp with time zone, "last_refresh" timestamp with time zone, "last_bouncer_run" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH pool_stats AS (
    SELECT
      pp.city_id,
      COUNT(*) FILTER (WHERE pp.is_active) AS total_active,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.google_place_id IS NOT NULL) AS seeded_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.last_detail_refresh IS NOT NULL
                       AND pp.last_detail_refresh > pp.created_at + interval '1 minute') AS refreshed_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.is_servable IS NOT NULL) AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.is_servable = true) AS is_servable_count,
      COUNT(*) FILTER (
        WHERE pp.is_active
          AND pp.stored_photo_urls IS NOT NULL
          AND array_length(pp.stored_photo_urls, 1) > 0
          AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
      ) AS has_real_photos_count,
      MAX(pp.updated_at) AS last_place_update,
      MAX(pp.last_detail_refresh) AS last_refresh,
      MAX(pp.bouncer_validated_at) AS last_bouncer_run
    FROM public.place_pool pp
    WHERE pp.city_id IS NOT NULL
    GROUP BY pp.city_id
  ),
  score_stats AS (
    SELECT pp.city_id, COUNT(DISTINCT ps.place_id) AS scored_count
    FROM public.place_scores ps
    JOIN public.place_pool pp ON pp.id = ps.place_id
    WHERE pp.city_id IS NOT NULL AND pp.is_active = true
    GROUP BY pp.city_id
  )
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country AS country_name,
    sc.country_code,
    sc.status AS city_status,
    sc.created_at,
    COALESCE(ps.total_active, 0)::bigint,
    COALESCE(ps.seeded_count, 0)::bigint,
    COALESCE(ps.refreshed_count, 0)::bigint,
    COALESCE(ps.bouncer_judged_count, 0)::bigint,
    COALESCE(ps.is_servable_count, 0)::bigint,
    COALESCE(ps.has_real_photos_count, 0)::bigint,
    COALESCE(ss.scored_count, 0)::bigint,
    ps.last_place_update,
    ps.last_refresh,
    ps.last_bouncer_run
  FROM public.seeding_cities sc
  LEFT JOIN pool_stats ps ON ps.city_id = sc.id
  LEFT JOIN score_stats ss ON ss.city_id = sc.id
  ORDER BY COALESCE(ps.total_active, 0) DESC, sc.name;
$$;


ALTER FUNCTION "public"."admin_city_pipeline_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_city_place_stats"("p_city_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_places', COUNT(*) FILTER (WHERE is_active),
    'inactive_places', COUNT(*) FILTER (WHERE NOT is_active),
    'avg_rating', ROUND(AVG(rating) FILTER (WHERE is_active AND rating IS NOT NULL)::numeric, 2),
    'with_photos', COUNT(*) FILTER (WHERE is_active AND stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0),
    'without_photos', COUNT(*) FILTER (WHERE is_active AND (stored_photo_urls IS NULL OR array_length(stored_photo_urls, 1) IS NULL)),
    'stale_count', COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '7 days'),
    -- ORCH-0700: groups by helper-derived Mingla category.
    'by_category', (
      SELECT COALESCE(jsonb_object_agg(
        COALESCE(derived_category, 'unknown'),
        jsonb_build_object('count', cnt, 'with_photos', photo_cnt)
      ), '{}'::jsonb)
      FROM (
        SELECT public.pg_map_primary_type_to_mingla_category(primary_type, types) AS derived_category,
               COUNT(*) as cnt,
               COUNT(*) FILTER (WHERE stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0) as photo_cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY derived_category
      ) sub
    ),
    'price_tier_distribution', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(price_tier, 'unknown'), cnt), '{}'::jsonb)
      FROM (
        SELECT price_tier, COUNT(*) as cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY price_tier
      ) sub
    )
  ) INTO v_result
  FROM public.place_pool
  WHERE city_id = p_city_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


ALTER FUNCTION "public"."admin_city_place_stats"("p_city_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_clear_demo_data"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM profiles WHERE email LIKE '%@mingla.app';
END;
$$;


ALTER FUNCTION "public"."admin_clear_demo_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_clear_expired_caches"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM google_places_cache WHERE expires_at < now();
  DELETE FROM ticketmaster_events_cache WHERE expires_at < now();
  DELETE FROM discover_daily_cache WHERE expires_at < now();
END;
$$;


ALTER FUNCTION "public"."admin_clear_expired_caches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_deactivate_place"("p_place_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  SELECT name INTO v_place_name FROM place_pool
  WHERE id = p_place_id AND is_active = true;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already inactive');
  END IF;

  UPDATE place_pool SET is_active = false, updated_at = now()
  WHERE id = p_place_id;

  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'deactivate', v_user_id, p_reason,
    jsonb_build_object('place_name', v_place_name));

  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_deactivated', 0,
    'single_cards_deactivated', 0,
    'curated_cards_deactivated', 0
  );
END;
$$;


ALTER FUNCTION "public"."admin_deactivate_place"("p_place_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_edit_place"("p_place_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_price_tier" "text" DEFAULT NULL::"text", "p_is_active" boolean DEFAULT NULL::boolean, "p_price_tiers" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result JSONB;
  v_effective_tiers TEXT[];
  v_tiers_provided BOOLEAN := (p_price_tiers IS NOT NULL);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_tiers_provided THEN
    v_effective_tiers := p_price_tiers;
  ELSIF p_price_tier IS NOT NULL THEN
    v_effective_tiers := ARRAY[p_price_tier];
  ELSE
    v_effective_tiers := NULL;
  END IF;

  -- ORCH-0700: category-override capability removed (admin can no longer override
  -- a place's Mingla category — categories are derived from Google's raw type
  -- data via pg_map_primary_type_to_mingla_category). If override is needed in
  -- future, a separate place_pool_overrides table will be added.
  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = CASE
      WHEN v_effective_tiers IS NOT NULL AND array_length(v_effective_tiers, 1) > 0 THEN v_effective_tiers[1]
      WHEN v_effective_tiers IS NOT NULL THEN NULL
      ELSE price_tier
    END,
    price_tiers = COALESCE(v_effective_tiers, price_tiers),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object(
    'id', id, 'name', name, 'price_tier', price_tier, 'price_tiers', price_tiers,
    'is_active', is_active
  )
  INTO v_result;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Place not found: %', p_place_id; END IF;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_edit_place"("p_place_id" "uuid", "p_name" "text", "p_price_tier" "text", "p_is_active" boolean, "p_price_tiers" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_feature_flags"("p_keys" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = lower(auth.email()) AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_result
  FROM public.admin_config
  WHERE key = ANY(p_keys);

  RETURN v_result;
END; $$;


ALTER FUNCTION "public"."admin_get_feature_flags"("p_keys" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_override_history"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "tier" "text", "reason" "text", "granted_by" "uuid", "starts_at" timestamp with time zone, "expires_at" timestamp with time zone, "revoked_at" timestamp with time zone, "is_active" boolean, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  -- Admin authorization check
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.tier,
    o.reason,
    o.granted_by,
    o.starts_at,
    o.expires_at,
    o.revoked_at,
    (o.revoked_at IS NULL AND o.starts_at <= now() AND o.expires_at > now()) AS is_active,
    o.created_at
  FROM admin_subscription_overrides o
  WHERE o.user_id = p_user_id
  ORDER BY o.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."admin_get_override_history"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_signal_serving_pct"("p_signal_id" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_email text := auth.email();
  v_pct integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = v_admin_email AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT (value)::int INTO v_pct
  FROM public.admin_config
  WHERE key = 'signal_serving_' || p_signal_id || '_pct';

  RETURN COALESCE(v_pct, 0);
END;
$$;


ALTER FUNCTION "public"."admin_get_signal_serving_pct"("p_signal_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_grant_override"("p_user_id" "uuid", "p_tier" "text", "p_reason" "text", "p_granted_by" "uuid", "p_starts_at" timestamp with time zone DEFAULT "now"(), "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_duration_days" integer DEFAULT 30) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_override_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  IF p_tier NOT IN ('free', 'mingla_plus') THEN RAISE EXCEPTION 'Invalid tier: %. Must be free or mingla_plus.', p_tier; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'User % does not exist.', p_user_id; END IF;
  v_expires := COALESCE(p_expires_at, p_starts_at + (p_duration_days || ' days')::INTERVAL);
  IF v_expires <= p_starts_at THEN RAISE EXCEPTION 'expires_at must be after starts_at'; END IF;
  UPDATE admin_subscription_overrides SET revoked_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND revoked_at IS NULL AND expires_at > now();
  INSERT INTO admin_subscription_overrides (user_id, tier, reason, granted_by, starts_at, expires_at)
  VALUES (p_user_id, p_tier, p_reason, p_granted_by, p_starts_at, v_expires) RETURNING id INTO v_override_id;
  RETURN v_override_id;
END;
$$;


ALTER FUNCTION "public"."admin_grant_override"("p_user_id" "uuid", "p_tier" "text", "p_reason" "text", "p_granted_by" "uuid", "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_duration_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_stale_places"("p_filter" "text" DEFAULT 'all'::"text", "p_sort_by" "text" DEFAULT 'staleness'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  -- Clamp page_size
  IF p_page_size < 1 OR p_page_size > 100 THEN
    p_page_size := 20;
  END IF;

  -- Count total matching
  SELECT COUNT(*)
  INTO v_total
  FROM v_stale_places vsp
  WHERE (p_filter = 'all')
     OR (p_filter = 'active_only' AND vsp.is_active = true)
     OR (p_filter = 'inactive_only' AND vsp.is_active = false)
     OR (p_filter = 'recently_served' AND vsp.recently_served = true)
     OR (p_filter = 'critical' AND vsp.staleness_tier = 'critical');

  -- Fetch page
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      vsp.id,
      vsp.google_place_id,
      vsp.name,
      vsp.address,
      vsp.primary_type,
      vsp.rating,
      vsp.is_active,
      vsp.last_detail_refresh,
      vsp.refresh_failures,
      ROUND(vsp.hours_since_refresh::numeric, 1) AS hours_since_refresh,
      vsp.staleness_tier,
      vsp.stale_reason,
      vsp.recently_served,
      -- Last admin action on this place
      (
        SELECT jsonb_build_object(
          'action_type', paa.action_type,
          'acted_at', paa.acted_at,
          'reason', paa.reason
        )
        FROM place_admin_actions paa
        WHERE paa.place_id = vsp.id
        ORDER BY paa.acted_at DESC
        LIMIT 1
      ) AS last_admin_action
    FROM v_stale_places vsp
    WHERE (p_filter = 'all')
       OR (p_filter = 'active_only' AND vsp.is_active = true)
       OR (p_filter = 'inactive_only' AND vsp.is_active = false)
       OR (p_filter = 'recently_served' AND vsp.recently_served = true)
       OR (p_filter = 'critical' AND vsp.staleness_tier = 'critical')
    ORDER BY
      CASE WHEN p_sort_by = 'staleness' THEN vsp.hours_since_refresh END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'failures' THEN vsp.refresh_failures END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'name' THEN vsp.name END ASC NULLS LAST,
      CASE WHEN p_sort_by = 'recently_served' THEN CASE WHEN vsp.recently_served THEN 0 ELSE 1 END END ASC,
      vsp.hours_since_refresh DESC NULLS LAST
    LIMIT p_page_size
    OFFSET p_page * p_page_size
  ) sub;

  RETURN jsonb_build_object(
    'places', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size,
    'summary', jsonb_build_object(
      'total_stale', v_total,
      'active_stale', (SELECT COUNT(*) FROM v_stale_places WHERE is_active = true),
      'inactive_stale', (SELECT COUNT(*) FROM v_stale_places WHERE is_active = false),
      'recently_served_stale', (SELECT COUNT(*) FROM v_stale_places WHERE recently_served = true),
      'critical_count', (SELECT COUNT(*) FROM v_stale_places WHERE staleness_tier = 'critical')
    )
  );
END;
$$;


ALTER FUNCTION "public"."admin_list_stale_places"("p_filter" "text", "p_sort_by" "text", "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_subscriptions"("p_search" "text" DEFAULT NULL::"text", "p_tier_filter" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("user_id" "uuid", "display_name" "text", "phone" "text", "effective_tier" "text", "raw_tier" "text", "is_active" boolean, "trial_ends_at" timestamp with time zone, "current_period_end" timestamp with time zone, "referral_bonus_months" integer, "has_admin_override" boolean, "admin_override_tier" "text", "admin_override_expires_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  RETURN QUERY
  SELECT p.id AS user_id, p.first_name || ' ' || COALESCE(p.last_name, '') AS display_name, p.phone AS phone,
    get_effective_tier(p.id) AS effective_tier, COALESCE(s.tier, 'free') AS raw_tier, COALESCE(s.is_active, false) AS is_active,
    s.trial_ends_at, s.current_period_end, COALESCE(s.referral_bonus_months, 0) AS referral_bonus_months,
    (ao.id IS NOT NULL) AS has_admin_override, ao.tier AS admin_override_tier, ao.expires_at AS admin_override_expires_at, p.created_at
  FROM profiles p
  LEFT JOIN subscriptions s ON s.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT o.id, o.tier, o.expires_at FROM admin_subscription_overrides o
    WHERE o.user_id = p.id AND o.revoked_at IS NULL AND o.starts_at <= now() AND o.expires_at > now()
    ORDER BY CASE o.tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC LIMIT 1
  ) ao ON true
  WHERE (p_search IS NULL OR (p.first_name ILIKE '%' || p_search || '%' OR p.last_name ILIKE '%' || p_search || '%' OR p.phone ILIKE '%' || p_search || '%'))
    AND (p_tier_filter IS NULL OR get_effective_tier(p.id) = p_tier_filter)
  ORDER BY p.created_at DESC LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."admin_list_subscriptions"("p_search" "text", "p_tier_filter" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_category_breakdown"("p_city_id" "uuid" DEFAULT NULL::"uuid", "p_country_code" "text" DEFAULT NULL::"text") RETURNS TABLE("category" "text", "place_count" bigint, "photo_pct" integer, "avg_rating" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    mv.primary_category AS category,
    COUNT(*)::BIGINT AS place_count,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE mv.has_photos) * 100.0 / COUNT(*))::INTEGER
      ELSE 0
    END AS photo_pct,
    ROUND((AVG(mv.rating) FILTER (WHERE mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM admin_place_pool_mv mv
  WHERE mv.is_active
    AND mv.is_servable = true
    AND mv.primary_category <> 'uncategorized'
    AND (p_city_id IS NULL OR mv.city_id = p_city_id)
    AND (p_country_code IS NULL OR mv.country_code = p_country_code)
  GROUP BY mv.primary_category
  ORDER BY COUNT(*) DESC;
END;
$$;


ALTER FUNCTION "public"."admin_place_category_breakdown"("p_city_id" "uuid", "p_country_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_city_overview"("p_country_code" "text") RETURNS TABLE("city_id" "uuid", "city_name" "text", "is_servable_places" bigint, "photo_pct" integer, "bounced_pct" integer, "category_coverage" integer, "avg_rating" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH per_city AS (
    SELECT
      mv.city_id,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)                                      AS is_servable_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)                    AS servable_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)                                 AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                                AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )                                                                                                    AS category_coverage,
      AVG(mv.rating) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.rating IS NOT NULL)       AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code
    GROUP BY mv.city_id
  )
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    COALESCE(pc.is_servable_places, 0)::BIGINT AS is_servable_places,
    CASE WHEN COALESCE(pc.is_servable_places, 0) > 0
      THEN ROUND(pc.servable_with_photos * 100.0 / pc.is_servable_places)::INTEGER ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.bouncer_judged_count * 100.0 / pc.active_total)::INTEGER ELSE 0
    END AS bounced_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage,
    ROUND(pc.avg_rating::NUMERIC, 1) AS avg_rating
  FROM seeding_cities sc
  LEFT JOIN per_city pc ON pc.city_id = sc.id
  WHERE sc.country_code = p_country_code
  ORDER BY COALESCE(pc.is_servable_places, 0) DESC;
END;
$$;


ALTER FUNCTION "public"."admin_place_city_overview"("p_country_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_country_overview"() RETURNS TABLE("country_code" "text", "country_name" "text", "city_count" bigint, "is_servable_places" bigint, "photo_pct" integer, "bounced_pct" integer, "category_coverage" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH per_country AS (
    SELECT
      mv.country_code,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)                           AS is_servable_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)         AS servable_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)                      AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                     AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )                                                                                        AS category_coverage
    FROM admin_place_pool_mv mv
    WHERE mv.country_code IS NOT NULL
    GROUP BY mv.country_code
  ),
  countries AS (
    SELECT DISTINCT country_code, country FROM seeding_cities
  ),
  city_counts AS (
    SELECT sc.country_code, COUNT(*)::bigint AS city_count
    FROM seeding_cities sc
    GROUP BY sc.country_code
  )
  SELECT
    c.country_code,
    c.country AS country_name,
    cc.city_count,
    COALESCE(pc.is_servable_places, 0) AS is_servable_places,
    CASE WHEN COALESCE(pc.is_servable_places, 0) > 0
      THEN ROUND(pc.servable_with_photos * 100.0 / pc.is_servable_places)::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.bouncer_judged_count * 100.0 / pc.active_total)::INTEGER
      ELSE 0
    END AS bounced_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage
  FROM countries c
  JOIN city_counts cc ON cc.country_code = c.country_code
  LEFT JOIN per_country pc ON pc.country_code = c.country_code
  ORDER BY COALESCE(pc.is_servable_places, 0) DESC;
END;
$$;


ALTER FUNCTION "public"."admin_place_country_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_photo_stats"("p_city_id" "uuid") RETURNS TABLE("total_places" bigint, "with_photos" bigint, "without_photos" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_places,
    COUNT(*) FILTER (WHERE mv.has_photos)::BIGINT AS with_photos,
    COUNT(*) FILTER (WHERE NOT mv.has_photos)::BIGINT AS without_photos
  FROM admin_place_pool_mv mv
  WHERE mv.city_id = p_city_id
    AND mv.is_active
    AND mv.is_servable = true;
END;
$$;


ALTER FUNCTION "public"."admin_place_photo_stats"("p_city_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_pool_city_list"("p_country" "text") RETURNS TABLE("city_name" "text", "approved_places" bigint, "with_photos" bigint, "existing_cards" bigint, "ready_to_generate" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- ORCH-0640: existing_cards + ready_to_generate degrade to 0 (card_pool archived).
  -- "approved_places" renamed semantics: now means "Bouncer-servable places".
  RETURN QUERY
  SELECT
    COALESCE(mv.pp_city, 'Unknown City') AS city_name,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE) AS approved_places,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE AND mv.has_photos) AS with_photos,
    0::bigint AS existing_cards,
    0::bigint AS ready_to_generate
  FROM admin_place_pool_mv mv
  WHERE mv.is_active = TRUE
    AND mv.pp_country = p_country
  GROUP BY mv.pp_city
  ORDER BY approved_places DESC;
END;
$$;


ALTER FUNCTION "public"."admin_place_pool_city_list"("p_country" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_pool_country_list"() RETURNS TABLE("country" "text", "approved_places" bigint, "with_photos" bigint, "existing_cards" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COALESCE(mv.pp_country, 'Unknown') AS country,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE) AS approved_places,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE AND mv.has_photos) AS with_photos,
    0::bigint AS existing_cards
  FROM admin_place_pool_mv mv
  WHERE mv.is_active = TRUE
  GROUP BY mv.pp_country
  ORDER BY approved_places DESC;
END;
$$;


ALTER FUNCTION "public"."admin_place_pool_country_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_place_pool_overview"("p_city_id" "uuid" DEFAULT NULL::"uuid", "p_country_code" "text" DEFAULT NULL::"text") RETURNS TABLE("total_places" bigint, "active_places" bigint, "is_servable_places" bigint, "with_photos" bigint, "photo_pct" integer, "bouncer_judged_count" bigint, "is_servable_count" bigint, "bouncer_excluded_count" bigint, "bouncer_pending_count" bigint, "distinct_categories" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total BIGINT;
  v_active BIGINT;
  v_servable BIGINT;
  v_with_photos BIGINT;
  v_judged BIGINT;
  v_excluded BIGINT;
  v_pending BIGINT;
  v_categories INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- City-scoped: single narrow query. MV's city_id index narrows to ~5k rows max.
  IF p_city_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.city_id = p_city_id;
    RETURN;
  END IF;

  -- Country-scoped: single narrow query. MV's country_code index narrows to one country's rows.
  IF p_country_code IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code;
    RETURN;
  END IF;

  -- Global scope: 8 narrow subqueries, each eligible for Index-Only Scan via mv_country_active_servable index.
  SELECT COUNT(*) INTO v_total FROM admin_place_pool_mv;
  SELECT COUNT(*) INTO v_active FROM admin_place_pool_mv WHERE is_active;
  SELECT COUNT(*) INTO v_servable FROM admin_place_pool_mv WHERE is_active AND is_servable = true;
  SELECT COUNT(*) INTO v_with_photos FROM admin_place_pool_mv
    WHERE is_active AND is_servable = true AND has_photos;
  SELECT COUNT(*) INTO v_judged FROM admin_place_pool_mv WHERE is_active AND is_servable IS NOT NULL;
  SELECT COUNT(*) INTO v_excluded FROM admin_place_pool_mv WHERE is_active AND is_servable = false;
  SELECT COUNT(*) INTO v_pending FROM admin_place_pool_mv WHERE is_active AND is_servable IS NULL;
  SELECT COUNT(DISTINCT primary_category)::INTEGER INTO v_categories
    FROM admin_place_pool_mv
    WHERE is_active AND is_servable = true AND primary_category <> 'uncategorized';

  RETURN QUERY SELECT
    v_total,
    v_active,
    v_servable,
    v_with_photos,
    CASE WHEN v_servable > 0 THEN ROUND(v_with_photos * 100.0 / v_servable)::INTEGER ELSE 0 END,
    v_judged,
    v_servable,
    v_excluded,
    v_pending,
    v_categories;
END;
$$;


ALTER FUNCTION "public"."admin_place_pool_overview"("p_city_id" "uuid", "p_country_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_pool_category_health"("p_country" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text") RETURNS TABLE("category" "text", "total_places" bigint, "active_places" bigint, "with_photos" bigint, "photo_pct" integer, "avg_rating" numeric, "total_cards" bigint, "single_cards" bigint, "curated_cards" bigint, "places_needing_cards" bigint, "health" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH place_stats AS (
    SELECT
      -- ORCH-0700: reads matview's helper-derived primary_category column.
      mv.primary_category,
      COUNT(*) AS total_places,
      COUNT(*) FILTER (WHERE mv.is_active) AS active_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) AS with_photos,
      ROUND((AVG(mv.rating) FILTER (WHERE mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.primary_category IS NOT NULL
      AND mv.primary_category <> 'uncategorized'
      AND (p_country IS NULL OR mv.pp_country = p_country)
      AND (p_city IS NULL OR mv.pp_city = p_city)
    GROUP BY mv.primary_category
  )
  SELECT
    ps.primary_category AS category,
    ps.total_places,
    ps.active_places,
    ps.with_photos,
    CASE WHEN ps.active_places > 0
      THEN ROUND(ps.with_photos * 100.0 / ps.active_places)::INTEGER
      ELSE 0 END AS photo_pct,
    ps.avg_rating,
    0::bigint AS total_cards,            -- ORCH-0640: card_pool archived
    0::bigint AS single_cards,
    0::bigint AS curated_cards,
    0::bigint AS places_needing_cards,   -- "needing cards" concept retired
    CASE
      WHEN ps.with_photos >= ps.active_places * 0.8 THEN 'green'
      WHEN ps.with_photos >= ps.active_places * 0.5 THEN 'yellow'
      ELSE 'red'
    END AS health  -- health now measures photo coverage (the actual G3 gate)
  FROM place_stats ps
  ORDER BY ps.active_places DESC;
END;
$$;


ALTER FUNCTION "public"."admin_pool_category_health"("p_country" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reactivate_place"("p_place_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  SELECT name INTO v_place_name FROM place_pool
  WHERE id = p_place_id AND is_active = false;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already active');
  END IF;

  UPDATE place_pool SET is_active = true, updated_at = now()
  WHERE id = p_place_id;

  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'reactivate', v_user_id, p_reason,
    jsonb_build_object('place_name', v_place_name));

  -- ORCH-0640: card_pool cascade removed.
  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_reactivated', 0
  );
END;
$$;


ALTER FUNCTION "public"."admin_reactivate_place"("p_place_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_refresh_place_pool_mv"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_row_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;

  SELECT COUNT(*) INTO v_row_count FROM public.admin_place_pool_mv;

  RETURN jsonb_build_object(
    'success', true,
    'row_count', v_row_count,
    'duration_ms', ROUND(EXTRACT(EPOCH FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;


ALTER FUNCTION "public"."admin_refresh_place_pool_mv"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reset_inactive_sessions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE collaboration_sessions SET is_active = false
  WHERE last_activity_at < now() - interval '7 days' AND is_active = true;
END;
$$;


ALTER FUNCTION "public"."admin_reset_inactive_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_revoke_override"("p_override_id" "uuid", "p_revoked_by" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Admin authorization check
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE id = p_override_id
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."admin_revoke_override"("p_override_id" "uuid", "p_revoked_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rule_detail"("p_rule_set_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_result JSONB; v_rule_set JSONB; v_current_version JSONB; v_entries JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(rs) INTO v_rule_set FROM public.rule_sets rs WHERE rs.id = p_rule_set_id;
  IF v_rule_set IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id USING ERRCODE = 'P0002';
  END IF;

  SELECT to_jsonb(rsv) INTO v_current_version
  FROM public.rule_set_versions rsv
  WHERE rsv.id = (v_rule_set->>'current_version_id')::UUID;

  SELECT COALESCE(jsonb_agg(to_jsonb(re) ORDER BY re.position, re.value), '[]'::jsonb) INTO v_entries
  FROM public.rule_entries re
  WHERE re.rule_set_version_id = (v_rule_set->>'current_version_id')::UUID;

  RETURN jsonb_build_object(
    'rule_set', v_rule_set,
    'current_version', v_current_version,
    'entries', v_entries,
    'version_count', (SELECT COUNT(*) FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id),
    'fires_7d_by_outcome', jsonb_build_object(
      'reject', (
        SELECT COUNT(*) FROM public.rules_run_results
        WHERE rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
          AND decision = 'reject' AND created_at >= now() - interval '7 days'
      ),
      'modify', (
        SELECT COUNT(*) FROM public.rules_run_results
        WHERE rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
          AND decision = 'reclassify' AND created_at >= now() - interval '7 days'
      )
    ),
    'most_recent_fires', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT pp.name AS place_name, rrr.decision, rrr.created_at, rrr.reason
        FROM public.rules_run_results rrr
        JOIN public.place_pool pp ON pp.id = rrr.place_id
        WHERE rrr.rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
        ORDER BY rrr.created_at DESC LIMIT 5
      ) t
    ), '[]'::jsonb)
  );
END; $$;


ALTER FUNCTION "public"."admin_rule_detail"("p_rule_set_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rule_set_diff"("p_version_a" "uuid", "p_version_b" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_va JSONB; v_vb JSONB;
  v_added JSONB; v_removed JSONB; v_unchanged_count INT;
  v_thresholds_a JSONB; v_thresholds_b JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_va FROM (
    SELECT id, version_number, created_at, change_summary FROM public.rule_set_versions WHERE id = p_version_a
  ) t;
  SELECT to_jsonb(t) INTO v_vb FROM (
    SELECT id, version_number, created_at, change_summary FROM public.rule_set_versions WHERE id = p_version_b
  ) t;

  IF v_va IS NULL OR v_vb IS NULL THEN
    RAISE EXCEPTION 'One or both versions not found';
  END IF;

  -- Entries in B that aren't in A → added
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_added FROM (
    SELECT b.value, b.sub_category, b.reason FROM public.rule_entries b
    WHERE b.rule_set_version_id = p_version_b
    AND NOT EXISTS (
      SELECT 1 FROM public.rule_entries a
      WHERE a.rule_set_version_id = p_version_a
        AND a.value = b.value
        AND COALESCE(a.sub_category, '') = COALESCE(b.sub_category, '')
    )
  ) t;

  -- Entries in A that aren't in B → removed
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_removed FROM (
    SELECT a.value, a.sub_category FROM public.rule_entries a
    WHERE a.rule_set_version_id = p_version_a
    AND NOT EXISTS (
      SELECT 1 FROM public.rule_entries b
      WHERE b.rule_set_version_id = p_version_b
        AND b.value = a.value
        AND COALESCE(b.sub_category, '') = COALESCE(a.sub_category, '')
    )
  ) t;

  SELECT COUNT(*) INTO v_unchanged_count FROM public.rule_entries a
  WHERE a.rule_set_version_id = p_version_a
  AND EXISTS (
    SELECT 1 FROM public.rule_entries b
    WHERE b.rule_set_version_id = p_version_b
      AND b.value = a.value
      AND COALESCE(b.sub_category, '') = COALESCE(a.sub_category, '')
  );

  SELECT thresholds INTO v_thresholds_a FROM public.rule_set_versions WHERE id = p_version_a;
  SELECT thresholds INTO v_thresholds_b FROM public.rule_set_versions WHERE id = p_version_b;

  RETURN jsonb_build_object(
    'version_a', v_va,
    'version_b', v_vb,
    'added_entries', v_added,
    'removed_entries', v_removed,
    'unchanged_entries_count', v_unchanged_count,
    'thresholds_changed', CASE
      WHEN v_thresholds_a IS DISTINCT FROM v_thresholds_b
        THEN jsonb_build_object('from', v_thresholds_a, 'to', v_thresholds_b)
      ELSE NULL
    END
  );
END; $$;


ALTER FUNCTION "public"."admin_rule_set_diff"("p_version_a" "uuid", "p_version_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rule_set_versions"("p_rule_set_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.version_number DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      rsv.id,
      rsv.version_number,
      rsv.change_summary,
      rsv.thresholds,
      rsv.created_at,
      rsv.created_by,
      (SELECT email FROM public.admin_users WHERE id = rsv.created_by) AS created_by_email,
      (SELECT COUNT(*) FROM public.rule_entries WHERE rule_set_version_id = rsv.id) AS entry_count,
      (rsv.id = (SELECT current_version_id FROM public.rule_sets WHERE id = p_rule_set_id)) AS is_current
    FROM public.rule_set_versions rsv
    WHERE rsv.rule_set_id = p_rule_set_id
    ORDER BY rsv.version_number DESC
  ) t;

  RETURN v_result;
END; $$;


ALTER FUNCTION "public"."admin_rule_set_versions"("p_rule_set_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_export"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_result JSONB; v_current_manifest UUID; v_manifest_label TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT id, manifest_label INTO v_current_manifest, v_manifest_label
  FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'rules_version_id', v_current_manifest,
    'manifest_label', v_manifest_label,
    'schema_version', 1,
    'rule_sets', COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  ) INTO v_result FROM (
    SELECT
      rs.id, rs.name, rs.description, rs.kind, rs.scope_kind, rs.scope_value, rs.is_active,
      rsv.id AS version_id,
      rsv.version_number,
      rsv.thresholds,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'value', re.value, 'sub_category', re.sub_category,
          'position', re.position, 'reason', re.reason
        ) ORDER BY re.position, re.value), '[]'::jsonb)
        FROM public.rule_entries re WHERE re.rule_set_version_id = rsv.id
      ) AS entries
    FROM public.rule_sets rs
    JOIN public.rule_set_versions rsv ON rsv.id = rs.current_version_id
    ORDER BY rs.scope_kind, rs.scope_value NULLS FIRST, rs.name
  ) t;

  RETURN v_result;
END; $$;


ALTER FUNCTION "public"."admin_rules_export"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_list"("p_scope_filter" "text" DEFAULT NULL::"text", "p_kind_filter" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_show_only_never_fired" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      rs.id, rs.name, rs.description, rs.kind, rs.scope_kind, rs.scope_value,
      rs.is_active, rs.current_version_id,
      rsv.version_number AS current_version_number,
      (SELECT COUNT(*) FROM public.rule_entries WHERE rule_set_version_id = rs.current_version_id) AS entry_count,
      (
        SELECT MAX(rrr.created_at) FROM public.rules_run_results rrr
        WHERE rrr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        )
      ) AS last_fired_at,
      (
        SELECT COUNT(*) FROM public.rules_run_results rrr
        WHERE rrr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        ) AND rrr.created_at >= now() - interval '7 days'
      ) AS fires_7d,
      (
        SELECT COUNT(*) FROM public.rules_run_results rrr
        WHERE rrr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        )
      ) AS fires_total,
      rsv.created_at AS last_edited_at,
      rsv.created_by AS last_edited_by_id,
      (SELECT email FROM public.admin_users WHERE id = rsv.created_by) AS last_edited_by_email
    FROM public.rule_sets rs
    LEFT JOIN public.rule_set_versions rsv ON rsv.id = rs.current_version_id
    WHERE
      (p_scope_filter IS NULL OR rs.scope_kind = p_scope_filter)
      AND (p_kind_filter IS NULL OR rs.kind = p_kind_filter)
      AND (p_search IS NULL OR rs.name ILIKE '%' || p_search || '%' OR rs.description ILIKE '%' || p_search || '%')
    ORDER BY rs.scope_kind, rs.scope_value NULLS FIRST, rs.name
  ) t
  WHERE NOT p_show_only_never_fired OR (t.fires_total = 0);

  RETURN v_result;
END; $$;


ALTER FUNCTION "public"."admin_rules_list"("p_scope_filter" "text", "p_kind_filter" "text", "p_search" "text", "p_show_only_never_fired" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_result JSONB;
  v_drift_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- ORCH-0700: drift threshold raised 18 → 20 after SPLIT (Migration 2 added 4
  -- new active SPLIT rules and deactivated 2 legacy bundled originals = +2 net).
  IF (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true) < 20 THEN
    v_drift_status := 'warning';
  ELSE
    v_drift_status := 'in_sync';
  END IF;

  SELECT jsonb_build_object(
    'rules_active', (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true),
    'rules_total',  (SELECT COUNT(*) FROM public.rule_sets),
    'places_governed', (SELECT COUNT(*) FROM public.place_pool WHERE is_active = true),
    'fires_7d', (
      SELECT COUNT(*) FROM public.rules_run_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '7 days'
    ),
    'fires_24h', (
      SELECT COUNT(*) FROM public.rules_run_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '24 hours'
    ),
    'current_rules_version_id', (
      SELECT id FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1
    ),
    'current_manifest_label', (
      SELECT manifest_label FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1
    ),
    'drift_status', v_drift_status,
    'vibes_ready_count', 11,
    'vibes_partial_count', 5,
    'vibes_ai_only_count', 4,
    'vibes_total', 20
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_rules_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_preview_impact"("p_rule_set_id" "uuid", "p_proposed_entries" "text"[], "p_proposed_thresholds" "jsonb" DEFAULT NULL::"jsonb", "p_city_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_kind TEXT; v_scope_kind TEXT; v_scope_value TEXT;
  v_would_modify INT := 0; v_would_reject INT := 0; v_total_evaluated INT := 0;
  v_sample JSONB; v_partial BOOLEAN := false;
  v_max_eval INT := 50000;
  v_start TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT kind, scope_kind, scope_value INTO v_kind, v_scope_kind, v_scope_value
  FROM public.rule_sets WHERE id = p_rule_set_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id;
  END IF;

  -- Per-kind isolated impact computation. Bounded at 50K places via LIMIT;
  -- if pool larger, returns partial: true so UI can warn admin.
  SELECT COUNT(*) INTO v_total_evaluated FROM (
    SELECT id FROM public.place_pool
    WHERE is_active = true
      AND (p_city_id IS NULL OR city_id = p_city_id)
    LIMIT v_max_eval + 1
  ) t;
  IF v_total_evaluated > v_max_eval THEN
    v_partial := true;
    v_total_evaluated := v_max_eval;
  END IF;

  -- Branch by rule kind
  IF v_kind = 'blacklist' THEN
    SELECT COUNT(*) INTO v_would_reject FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND EXISTS (
          SELECT 1 FROM unnest(p_proposed_entries) AS e
          WHERE lower(pp.name) LIKE '%' || lower(e) || '%'
             OR pp.primary_type = e
        )
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'demotion' THEN
    -- ORCH-0707 Appendix A: derived-category equality check.
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value
        AND EXISTS (
          SELECT 1 FROM unnest(p_proposed_entries) AS e
          WHERE lower(pp.name) LIKE '%' || lower(e) || '%'
        )
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'strip' THEN
    -- ORCH-0707 Appendix A: derived-category equality check.
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value
        AND (pp.primary_type = ANY(p_proposed_entries) OR pp.types && p_proposed_entries)
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'promotion' THEN
    DECLARE v_price_levels TEXT[]; v_rating_min REAL;
    BEGIN
      v_price_levels := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_proposed_thresholds, '{"price_levels":[]}'::jsonb)->'price_levels'));
      v_rating_min := COALESCE((p_proposed_thresholds->>'rating_min')::REAL, 4.0);

      -- ORCH-0707 Appendix A: derived-category != scope (place would be promoted INTO scope).
      SELECT COUNT(*) INTO v_would_modify FROM (
        SELECT pp.id FROM public.place_pool pp
        WHERE pp.is_active = true
          AND (p_city_id IS NULL OR pp.city_id = p_city_id)
          AND pp.price_level = ANY(v_price_levels)
          AND pp.rating >= v_rating_min
          AND public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) IS DISTINCT FROM v_scope_value
        LIMIT v_max_eval
      ) t;
    END;

  ELSIF v_kind = 'min_data_guard' THEN
    SELECT COUNT(*) INTO v_would_reject FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND pp.rating IS NULL
        AND COALESCE(pp.review_count, 0) = 0
        AND COALESCE(pp.website, '') = ''
      LIMIT v_max_eval
    ) t;

  ELSE
    -- whitelist / keyword_set / time_window / numeric_range — no direct verdict impact
    v_would_modify := 0;
    v_would_reject := 0;
  END IF;

  -- Sample affected places (up to 5).
  -- ORCH-0707: returns derived single category as `current_category`.
  IF v_kind IN ('blacklist', 'demotion', 'strip', 'promotion', 'min_data_guard') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_sample FROM (
      SELECT pp.id AS place_id, pp.name, pp.address,
        public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) AS current_category,
        CASE WHEN v_kind IN ('blacklist', 'min_data_guard') THEN 'reject'
             ELSE 'modify' END AS proposed_outcome
      FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND CASE
          WHEN v_kind = 'blacklist' THEN
            EXISTS (SELECT 1 FROM unnest(p_proposed_entries) AS e
                    WHERE lower(pp.name) LIKE '%' || lower(e) || '%' OR pp.primary_type = e)
          WHEN v_kind = 'demotion' THEN
            public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value AND
            EXISTS (SELECT 1 FROM unnest(p_proposed_entries) AS e WHERE lower(pp.name) LIKE '%' || lower(e) || '%')
          WHEN v_kind = 'strip' THEN
            public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value AND
            (pp.primary_type = ANY(p_proposed_entries) OR pp.types && p_proposed_entries)
          WHEN v_kind = 'min_data_guard' THEN
            pp.rating IS NULL AND COALESCE(pp.review_count, 0) = 0 AND COALESCE(pp.website, '') = ''
          ELSE false
        END
      LIMIT 5
    ) t;
  ELSE
    v_sample := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'would_modify', v_would_modify,
    'would_reject', v_would_reject,
    'would_no_op', GREATEST(v_total_evaluated - v_would_modify - v_would_reject, 0),
    'total_evaluated', v_total_evaluated,
    'sample_affected', v_sample,
    'partial', v_partial,
    'note', CASE WHEN v_partial THEN format('Pool exceeds %s places; result is approximate', v_max_eval) ELSE NULL END,
    'computed_in_ms', EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INT
  );
END;
$$;


ALTER FUNCTION "public"."admin_rules_preview_impact"("p_rule_set_id" "uuid", "p_proposed_entries" "text"[], "p_proposed_thresholds" "jsonb", "p_city_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_rollback"("p_rule_set_id" "uuid", "p_target_version_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID; v_admin_email TEXT;
  v_target_version_num INT; v_target_thresholds JSONB; v_target_entries JSONB;
  v_save_result JSONB; v_audit_id UUID;
  v_current_version_num INT;
BEGIN
  v_admin_email := lower(auth.email());
  SELECT id INTO v_admin_id FROM public.admin_users WHERE email = v_admin_email AND status = 'active';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT version_number, thresholds INTO v_target_version_num, v_target_thresholds
  FROM public.rule_set_versions
  WHERE id = p_target_version_id AND rule_set_id = p_rule_set_id;
  IF v_target_version_num IS NULL THEN
    RAISE EXCEPTION 'Target version not found or does not belong to this rule set';
  END IF;

  SELECT version_number INTO v_current_version_num
  FROM public.rule_set_versions
  WHERE id = (SELECT current_version_id FROM public.rule_sets WHERE id = p_rule_set_id);

  -- Build entries array from target version
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'value', value, 'sub_category', sub_category,
    'position', position, 'reason', COALESCE(reason, format('Rolled back to v%s', v_target_version_num))
  )), '[]'::jsonb) INTO v_target_entries
  FROM public.rule_entries
  WHERE rule_set_version_id = p_target_version_id;

  -- Delegate to save (which creates new version + manifest + base audit log)
  v_save_result := public.admin_rules_save(
    p_rule_set_id,
    v_target_entries,
    format('Rollback v%s → v%s: %s', v_current_version_num, v_target_version_num, p_reason),
    v_target_thresholds
  );

  -- Additional audit log entry distinguishing rollback from generic save
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
  VALUES (
    v_admin_email,
    'rules.rollback',
    'rule_set',
    p_rule_set_id::text,
    jsonb_build_object(
      'rolled_back_from_version', v_current_version_num,
      'rolled_back_to_version', v_target_version_num,
      'new_version_id', v_save_result->>'new_version_id',
      'reason', p_reason
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN v_save_result || jsonb_build_object(
    'rolled_back_from_version', v_current_version_num,
    'rolled_back_to_version', v_target_version_num,
    'rollback_audit_log_id', v_audit_id
  );
END; $$;


ALTER FUNCTION "public"."admin_rules_rollback"("p_rule_set_id" "uuid", "p_target_version_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_run_affected_places"("p_job_id" "uuid", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_total INT; v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = lower(auth.email()) AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.rules_run_results
  WHERE job_id = p_job_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      rrr.id, rrr.place_id, pp.name AS place_name, pp.address AS place_address,
      pp.primary_type, rrr.decision, rrr.previous_categories, rrr.new_categories,
      rrr.reason, rrr.created_at,
      rrr.rule_set_version_id,
      rs.name AS rule_set_name,
      rsv.version_number AS rule_set_version_number,
      prior.decision    AS prior_decision,
      prior.reason      AS prior_reason,
      prior.created_at  AS prior_created_at
    FROM public.rules_run_results rrr
    JOIN public.place_pool pp ON pp.id = rrr.place_id
    LEFT JOIN public.rule_set_versions rsv ON rsv.id = rrr.rule_set_version_id
    LEFT JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    LEFT JOIN LATERAL (
      SELECT prev.decision, prev.reason, prev.created_at
      FROM public.rules_run_results prev
      WHERE prev.place_id = rrr.place_id
        AND prev.created_at < rrr.created_at
      ORDER BY prev.created_at DESC
      LIMIT 1
    ) prior ON true
    WHERE rrr.job_id = p_job_id
    ORDER BY rrr.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'places', v_result,
    'total',  v_total,
    'limit',  p_limit,
    'offset', p_offset
  );
END;
$$;


ALTER FUNCTION "public"."admin_rules_run_affected_places"("p_job_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_run_detail"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_run JSONB; v_manifest JSONB; v_top_rules JSONB; v_affected_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_run FROM (
    SELECT rr.*, (SELECT email FROM public.admin_users WHERE id = rr.triggered_by) AS triggered_by_email
    FROM public.rules_runs rr WHERE rr.id = p_job_id
  ) t;
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_job_id;
  END IF;

  SELECT to_jsonb(rv) INTO v_manifest FROM public.rules_versions rv
  WHERE rv.id = (v_run->>'rules_version_id')::UUID;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_top_rules FROM (
    SELECT
      rs.id AS rule_set_id,
      rs.name AS rule_set_name,
      rs.kind,
      COUNT(*) AS fires
    FROM public.rules_run_results rrr
    JOIN public.rule_set_versions rsv ON rsv.id = rrr.rule_set_version_id
    JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE rrr.job_id = p_job_id
    GROUP BY rs.id, rs.name, rs.kind
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) t;

  SELECT COUNT(*) INTO v_affected_count FROM public.rules_run_results WHERE job_id = p_job_id;

  RETURN jsonb_build_object(
    'run', v_run,
    'rules_version', v_manifest,
    'top_firing_rules', v_top_rules,
    'affected_places_count', v_affected_count
  );
END; $$;


ALTER FUNCTION "public"."admin_rules_run_detail"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_run_diff"("p_job_a" "uuid", "p_job_b" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_a JSONB; v_b JSONB; v_rule_diff JSONB; v_delta JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_a FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.rules_runs WHERE id = p_job_a
  ) t;
  SELECT to_jsonb(t) INTO v_b FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.rules_runs WHERE id = p_job_b
  ) t;

  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'One or both runs not found';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rule_diff FROM (
    SELECT
      rs.name AS rule_set_name,
      COUNT(*) FILTER (WHERE rrr.job_id = p_job_a) AS fires_a,
      COUNT(*) FILTER (WHERE rrr.job_id = p_job_b) AS fires_b
    FROM public.rules_run_results rrr
    JOIN public.rule_set_versions rsv ON rsv.id = rrr.rule_set_version_id
    JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE rrr.job_id IN (p_job_a, p_job_b)
    GROUP BY rs.name
    ORDER BY (COUNT(*) FILTER (WHERE rrr.job_id = p_job_a) + COUNT(*) FILTER (WHERE rrr.job_id = p_job_b)) DESC
  ) t;

  WITH places_a AS (SELECT DISTINCT place_id FROM public.rules_run_results WHERE job_id = p_job_a),
       places_b AS (SELECT DISTINCT place_id FROM public.rules_run_results WHERE job_id = p_job_b)
  SELECT jsonb_build_object(
    'additional_in_b', (SELECT COUNT(*) FROM places_b WHERE place_id NOT IN (SELECT place_id FROM places_a)),
    'no_longer_in_b', (SELECT COUNT(*) FROM places_a WHERE place_id NOT IN (SELECT place_id FROM places_b)),
    'in_both', (SELECT COUNT(*) FROM places_a WHERE place_id IN (SELECT place_id FROM places_b))
  ) INTO v_delta;

  RETURN jsonb_build_object(
    'job_a', v_a,
    'job_b', v_b,
    'delta', v_delta,
    'rule_diff_summary', v_rule_diff
  );
END; $$;


ALTER FUNCTION "public"."admin_rules_run_diff"("p_job_a" "uuid", "p_job_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_runs"("p_city_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_result JSONB; v_total INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- ORCH-0640 ch05: stage IN ('rules_only','rules_only_complete') filter removed post-carveout.
  -- All rows in rules_runs are now Rules Engine runs by definition (pure-AI rows were
  -- DELETEd in ch02). Keeping the filter would be dead code.
  SELECT COUNT(*) INTO v_total
  FROM public.rules_runs rr
  WHERE (p_city_id IS NULL OR rr.city_id = p_city_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      rr.id,
      rr.status,
      rr.stage,
      rr.dry_run,
      rr.total_places,
      rr.processed,
      rr.rejected,
      rr.reclassified,
      rr.unchanged,
      rr.cost_usd,
      rr.rules_version_id,
      (SELECT manifest_label FROM public.rules_versions WHERE id = rr.rules_version_id) AS manifest_label,
      rr.city_id,
      rr.city_filter,
      rr.triggered_by,
      (SELECT email FROM public.admin_users WHERE id = rr.triggered_by) AS triggered_by_email,
      rr.created_at,
      rr.started_at,
      rr.completed_at,
      EXTRACT(EPOCH FROM (rr.completed_at - rr.started_at))::INT AS duration_seconds
    FROM public.rules_runs rr
    WHERE (p_city_id IS NULL OR rr.city_id = p_city_id)
    ORDER BY rr.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('runs', v_result, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END; $$;


ALTER FUNCTION "public"."admin_rules_runs"("p_city_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rules_save"("p_rule_set_id" "uuid", "p_new_entries" "jsonb", "p_change_summary" "text", "p_new_thresholds" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID; v_admin_email TEXT;
  v_kind TEXT; v_current_version_id UUID; v_current_version_num INT;
  v_new_version_id UUID; v_new_version_num INT;
  v_current_thresholds JSONB; v_final_thresholds JSONB;
  v_current_entries JSONB; v_diff JSONB;
  v_new_manifest_id UUID; v_audit_id UUID;
  v_existing_keys JSONB;
BEGIN
  v_admin_email := lower(auth.email());
  SELECT id INTO v_admin_id FROM public.admin_users WHERE email = v_admin_email AND status = 'active';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT kind, current_version_id INTO v_kind, v_current_version_id
  FROM public.rule_sets WHERE id = p_rule_set_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id USING ERRCODE = 'P0002';
  END IF;

  SELECT version_number, thresholds INTO v_current_version_num, v_current_thresholds
  FROM public.rule_set_versions WHERE id = v_current_version_id;
  v_new_version_num := COALESCE(v_current_version_num, 0) + 1;

  -- DEC-034 Q3: reason REQUIRED for blacklist + demotion adds; OPTIONAL for others
  -- An entry is "new" if it doesn't exist in current version
  IF v_kind IN ('blacklist', 'demotion') THEN
    SELECT COALESCE(jsonb_agg(value || COALESCE(sub_category, '')), '[]'::jsonb) INTO v_existing_keys
    FROM public.rule_entries WHERE rule_set_version_id = v_current_version_id;

    PERFORM 1 FROM jsonb_array_elements(p_new_entries) AS e
    WHERE NOT (v_existing_keys @> jsonb_build_array((e->>'value') || COALESCE(e->>'sub_category', '')))
      AND COALESCE(e->>'reason', '') = '';
    IF FOUND THEN
      RAISE EXCEPTION 'Reason required for blacklist/demotion add (DEC-034 Q3)' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_final_thresholds := COALESCE(p_new_thresholds, v_current_thresholds);

  -- Snapshot current entries for audit-log diff
  SELECT COALESCE(jsonb_agg(jsonb_build_object('value', value, 'sub_category', sub_category)), '[]'::jsonb)
    INTO v_current_entries
  FROM public.rule_entries WHERE rule_set_version_id = v_current_version_id;

  -- Create new version
  INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds, created_by)
  VALUES (p_rule_set_id, v_new_version_num, p_change_summary, v_final_thresholds, v_admin_id)
  RETURNING id INTO v_new_version_id;

  -- Insert all proposed entries into new version
  INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
  SELECT
    v_new_version_id,
    lower(e->>'value'),
    NULLIF(e->>'sub_category', ''),
    COALESCE((e->>'position')::INT, ord::INT),
    NULLIF(e->>'reason', '')
  FROM jsonb_array_elements(p_new_entries) WITH ORDINALITY AS t(e, ord);

  -- Move current_version_id pointer
  UPDATE public.rule_sets SET current_version_id = v_new_version_id, updated_at = now()
  WHERE id = p_rule_set_id;

  -- New manifest (snapshot = previous manifest + this rule's new version)
  INSERT INTO public.rules_versions (manifest_label, snapshot, summary, deployed_by)
  SELECT
    format('save-%s-v%s', (SELECT name FROM public.rule_sets WHERE id = p_rule_set_id), v_new_version_num),
    COALESCE(
      (SELECT snapshot FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1),
      '{}'::jsonb
    ) || jsonb_build_object(p_rule_set_id::text, v_new_version_id::text),
    format('Saved %s v%s: %s', (SELECT name FROM public.rule_sets WHERE id = p_rule_set_id), v_new_version_num, COALESCE(p_change_summary, '(no summary)')),
    v_admin_id
  RETURNING id INTO v_new_manifest_id;

  -- Audit log (I-AUDIT-LOG-COMPLETE invariant)
  v_diff := jsonb_build_object(
    'previous_entries', v_current_entries,
    'new_entries', p_new_entries,
    'thresholds_change', CASE WHEN v_current_thresholds IS DISTINCT FROM v_final_thresholds
      THEN jsonb_build_object('from', v_current_thresholds, 'to', v_final_thresholds) ELSE NULL END
  );
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
  VALUES (
    v_admin_email,
    'rules.save',
    'rule_set',
    p_rule_set_id::text,
    jsonb_build_object('summary', p_change_summary, 'new_version_id', v_new_version_id::text, 'new_version_number', v_new_version_num, 'manifest_id', v_new_manifest_id::text, 'diff', v_diff)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'new_version_id', v_new_version_id,
    'new_version_number', v_new_version_num,
    'new_rules_version_id', v_new_manifest_id,
    'audit_log_id', v_audit_id
  );
END; $$;


ALTER FUNCTION "public"."admin_rules_save"("p_rule_set_id" "uuid", "p_new_entries" "jsonb", "p_change_summary" "text", "p_new_thresholds" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_seed_demo_profiles"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO profiles (id, email, display_name, username, first_name, last_name,
    has_completed_onboarding, active, created_at)
  VALUES
    (gen_random_uuid(), 'demo1@mingla.app', 'Alex Demo', 'alexdemo', 'Alex', 'Demo', true, true, now()),
    (gen_random_uuid(), 'demo2@mingla.app', 'Jamie Test', 'jamietest', 'Jamie', 'Test', true, true, now()),
    (gen_random_uuid(), 'demo3@mingla.app', 'Sam Dev', 'samdev', 'Sam', 'Dev', false, true, now()),
    (gen_random_uuid(), 'demo4@mingla.app', 'Taylor QA', 'taylorqa', 'Taylor', 'QA', true, true, now()),
    (gen_random_uuid(), 'demo5@mingla.app', 'Jordan Seed', 'jordanseed', 'Jordan', 'Seed', false, true, now());
END;
$$;


ALTER FUNCTION "public"."admin_seed_demo_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_signal_serving_pct"("p_signal_id" "text", "p_pct" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_email text := auth.email();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = v_admin_email AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_pct < 0 OR p_pct > 100 THEN
    RAISE EXCEPTION 'pct must be 0-100, got %', p_pct;
  END IF;

  INSERT INTO public.admin_config (key, value, updated_by, updated_at)
  VALUES ('signal_serving_' || p_signal_id || '_pct', to_jsonb(p_pct), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
    SET value = to_jsonb(p_pct),
        updated_by = auth.uid(),
        updated_at = now();

  RETURN p_pct;
END;
$$;


ALTER FUNCTION "public"."admin_set_signal_serving_pct"("p_signal_id" "text", "p_pct" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_subscription_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM profiles),
    'free', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'free'),
    'mingla_plus', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'mingla_plus'),
    'overrides', (SELECT count(*) FROM admin_subscription_overrides WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()),
    'expiring_soon', (SELECT count(*) FROM admin_subscription_overrides WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now() AND expires_at <= now() + interval '7 days')
  ) INTO result;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."admin_subscription_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_trigger_place_refresh"("p_mode" "text", "p_place_pool_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_stale_threshold_hours" integer DEFAULT 168, "p_served_within_days" integer DEFAULT 7) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_log_id UUID;
  v_total INTEGER;
  v_estimated_cost NUMERIC;
  v_existing_id UUID;
  v_resolved_ids UUID[];
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  IF p_mode NOT IN ('recently_served', 'all_stale', 'selected') THEN
    RAISE EXCEPTION 'Invalid mode: must be recently_served, all_stale, or selected';
  END IF;
  IF p_stale_threshold_hours < 1 OR p_stale_threshold_hours > 8760 THEN
    RAISE EXCEPTION 'stale_threshold_hours must be between 1 and 8760';
  END IF;
  IF p_served_within_days < 1 OR p_served_within_days > 90 THEN
    RAISE EXCEPTION 'served_within_days must be between 1 and 90';
  END IF;

  SELECT id INTO v_existing_id
  FROM admin_backfill_log
  WHERE operation_type = 'place_refresh'
    AND status IN ('pending', 'running')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'backfill_log_id', v_existing_id,
      'status', 'already_running',
      'message', 'A place refresh is already in progress'
    );
  END IF;

  IF p_mode = 'recently_served' THEN
    -- ORCH-0640: engagement_metrics.place_pool_id event_kind='served' replaces
    -- the old card_pool → user_card_impressions chain (user_card_impressions never
    -- existed in prod per Phase-2 F-5; card_pool archived in ch12).
    SELECT array_agg(sub.id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM (
      SELECT DISTINCT pp.id
      FROM place_pool pp
      JOIN engagement_metrics em ON em.place_pool_id = pp.id AND em.event_kind = 'served'
      WHERE pp.is_active = true
        AND pp.last_detail_refresh < now() - (p_stale_threshold_hours || ' hours')::interval
        AND em.created_at > now() - (p_served_within_days || ' days')::interval
      ORDER BY pp.id
      LIMIT 500
    ) sub;

  ELSIF p_mode = 'all_stale' THEN
    SELECT array_agg(sub.id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM (
      SELECT id FROM place_pool
      WHERE is_active = true
        AND last_detail_refresh < now() - (p_stale_threshold_hours || ' hours')::interval
      ORDER BY last_detail_refresh ASC
      LIMIT 500
    ) sub;

  ELSIF p_mode = 'selected' THEN
    IF p_place_pool_ids IS NULL OR array_length(p_place_pool_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'place_pool_ids required for selected mode';
    END IF;
    SELECT array_agg(id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM place_pool
    WHERE id = ANY(p_place_pool_ids) AND is_active = true;
  END IF;

  IF v_total IS NULL OR v_total = 0 THEN
    RETURN jsonb_build_object(
      'backfill_log_id', NULL,
      'total_places', 0,
      'estimated_cost_usd', 0,
      'status', 'nothing_to_do',
      'message', 'No places found matching the refresh criteria'
    );
  END IF;

  v_estimated_cost := v_total * 0.005;

  INSERT INTO admin_backfill_log (
    operation_type, triggered_by, status, place_ids,
    total_places, estimated_cost_usd, started_at
  ) VALUES (
    'place_refresh', v_user_id, 'pending', v_resolved_ids,
    v_total, v_estimated_cost, now()
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'backfill_log_id', v_log_id,
    'total_places', v_total,
    'estimated_cost_usd', ROUND(v_estimated_cost, 2),
    'status', 'pending'
  );
END;
$$;


ALTER FUNCTION "public"."admin_trigger_place_refresh"("p_mode" "text", "p_place_pool_ids" "uuid"[], "p_stale_threshold_hours" integer, "p_served_within_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_uncategorized_places"("p_country" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "google_place_id" "text", "name" "text", "address" "text", "types" "text"[], "primary_type" "text", "rating" double precision, "city" "text", "country" "text", "is_active" boolean, "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    pp.id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.types,
    pp.primary_type,
    pp.rating,
    pp.city,
    pp.country,
    pp.is_active,
    COUNT(*) OVER() AS total_count
  FROM public.place_pool pp
  -- ORCH-0700: derive uncategorized from helper (Google's raw type data is the
  -- single owner per Constitution #2). NULL return = no Mingla category match.
  WHERE public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) IS NULL
    AND (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city)
  ORDER BY pp.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."admin_uncategorized_places"("p_country" "text", "p_city" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_virtual_tile_intelligence"("p_country" "text", "p_city" "text") RETURNS TABLE("row_idx" integer, "col_idx" integer, "center_lat" double precision, "center_lng" double precision, "active_places" bigint, "with_photos" bigint, "category_count" integer, "top_category" "text", "avg_rating" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_min_lat DOUBLE PRECISION;
  v_max_lat DOUBLE PRECISION;
  v_min_lng DOUBLE PRECISION;
  v_max_lng DOUBLE PRECISION;
  v_cell_lat DOUBLE PRECISION := 0.0045;
  v_cell_lng DOUBLE PRECISION;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT MIN(pp.lat), MAX(pp.lat), MIN(pp.lng), MAX(pp.lng)
  INTO v_min_lat, v_max_lat, v_min_lng, v_max_lng
  FROM public.place_pool pp
  WHERE pp.country = p_country AND pp.city = p_city AND pp.is_active;

  IF v_min_lat IS NULL THEN
    RETURN;
  END IF;

  v_cell_lng := v_cell_lat / COS(RADIANS((v_min_lat + v_max_lat) / 2.0));

  IF v_max_lat - v_min_lat < v_cell_lat THEN
    v_min_lat := v_min_lat - v_cell_lat;
    v_max_lat := v_max_lat + v_cell_lat;
  END IF;
  IF v_max_lng - v_min_lng < v_cell_lng THEN
    v_min_lng := v_min_lng - v_cell_lng;
    v_max_lng := v_max_lng + v_cell_lng;
  END IF;

  -- ORCH-0700: derived_category via helper.
  RETURN QUERY
  SELECT
    row_idx,
    col_idx,
    v_min_lat + row_idx * v_cell_lat + v_cell_lat / 2.0 AS center_lat,
    v_min_lng + col_idx * v_cell_lng + v_cell_lng / 2.0 AS center_lng,
    COUNT(*) AS active_places,
    COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    COUNT(DISTINCT pp.derived_category) FILTER (
      WHERE pp.derived_category IS NOT NULL
    )::INTEGER AS category_count,
    MODE() WITHIN GROUP (ORDER BY pp.derived_category) AS top_category,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM (
    SELECT
      pp2.*,
      public.pg_map_primary_type_to_mingla_category(pp2.primary_type, pp2.types) AS derived_category,
      FLOOR((pp2.lat - v_min_lat) / v_cell_lat)::INTEGER AS row_idx,
      FLOOR((pp2.lng - v_min_lng) / v_cell_lng)::INTEGER AS col_idx
    FROM public.place_pool pp2
    WHERE pp2.country = p_country AND pp2.city = p_city AND pp2.is_active
  ) pp
  GROUP BY row_idx, col_idx
  ORDER BY row_idx, col_idx;
END;
$$;


ALTER FUNCTION "public"."admin_virtual_tile_intelligence"("p_country" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."are_friends_or_fof"("viewer_id" "uuid", "target_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Direct friends check
  SELECT EXISTS (
    SELECT 1 FROM friends
    WHERE status = 'accepted' AND deleted_at IS NULL
      AND (
        (user_id = viewer_id AND friend_user_id = target_id)
        OR (friend_user_id = viewer_id AND user_id = target_id)
      )
  )
  OR EXISTS (
    -- Friends of friends: viewer→mutual→target (2-hop)
    SELECT 1 FROM friends f1
    JOIN friends f2 ON (
      CASE WHEN f1.user_id = viewer_id THEN f1.friend_user_id ELSE f1.user_id END
      = CASE WHEN f2.user_id = target_id THEN f2.friend_user_id ELSE f2.user_id END
    )
    WHERE f1.status = 'accepted' AND f1.deleted_at IS NULL
      AND f2.status = 'accepted' AND f2.deleted_at IS NULL
      AND (f1.user_id = viewer_id OR f1.friend_user_id = viewer_id)
      AND (f2.user_id = target_id OR f2.friend_user_id = target_id)
    LIMIT 1
  );
$$;


ALTER FUNCTION "public"."are_friends_or_fof"("viewer_id" "uuid", "target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_create_presence"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.board_participant_presence (session_id, user_id, is_online, last_seen_at)
  VALUES (NEW.session_id, NEW.user_id, true, now())
  ON CONFLICT (session_id, user_id) 
  DO UPDATE SET is_online = true, last_seen_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_create_presence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_generate_invite_info"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Generate invite code if not provided
  IF NEW.invite_code IS NULL THEN
    LOOP
      NEW.invite_code := public.generate_invite_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.collaboration_sessions 
        WHERE invite_code = NEW.invite_code
      );
    END LOOP;
  END IF;
  
  -- Generate invite link if not provided
  IF NEW.invite_link IS NULL THEN
    NEW.invite_link := 'mingla://board/' || NEW.invite_code;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_generate_invite_info"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_update_city_seeded_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.city_id IS NOT NULL AND NEW.is_active THEN
    UPDATE public.seeding_cities
    SET status = 'seeded', updated_at = now()
    WHERE id = NEW.city_id
      AND status = 'draft';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_update_city_seeded_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_audit_log_block_mutate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_log is append-only for clients';
END;
$$;


ALTER FUNCTION "public"."biz_audit_log_block_mutate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_brand_effective_rank"("p_brand_id" "uuid", "p_user_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT GREATEST(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.account_id = p_user_id
          AND b.deleted_at IS NULL
      )
      THEN public.biz_role_rank('account_owner'::text)
      ELSE 0
    END,
    COALESCE(
      (
        SELECT max(public.biz_role_rank(m.role))
        FROM public.brand_team_members m
        INNER JOIN public.brands b ON b.id = m.brand_id
        WHERE m.brand_id = p_brand_id
          AND m.user_id = p_user_id
          AND m.removed_at IS NULL
          AND m.accepted_at IS NOT NULL
          AND b.deleted_at IS NULL
      ),
      0
    )
  );
$$;


ALTER FUNCTION "public"."biz_brand_effective_rank"("p_brand_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_brand_effective_rank_for_caller"("p_brand_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_brand_effective_rank(p_brand_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_brand_effective_rank_for_caller"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_can_manage_orders_for_event"("p_event_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_brand_effective_rank(
    public.biz_event_brand_id(p_event_id),
    p_user_id
  ) >= public.biz_role_rank('finance_manager'::text);
$$;


ALTER FUNCTION "public"."biz_can_manage_orders_for_event"("p_event_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_can_manage_orders_for_event_for_caller"("p_event_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_can_manage_orders_for_event(p_event_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_can_manage_orders_for_event_for_caller"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_can_manage_payments_for_brand"("p_brand_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_is_brand_admin_plus(p_brand_id, p_user_id)
  OR EXISTS (
    SELECT 1
    FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id
      AND m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND m.role = 'finance_manager'
  );
$$;


ALTER FUNCTION "public"."biz_can_manage_payments_for_brand"("p_brand_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_can_manage_payments_for_brand_for_caller"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_can_manage_payments_for_brand(p_brand_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_can_manage_payments_for_brand_for_caller"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_can_read_order"("p_order_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.id = p_order_id
      AND e.deleted_at IS NULL
      AND (
        o.buyer_user_id IS NOT DISTINCT FROM p_user_id
        OR public.biz_is_brand_member_for_read(e.brand_id, p_user_id)
      )
  );
$$;


ALTER FUNCTION "public"."biz_can_read_order"("p_order_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_can_read_order_for_caller"("p_order_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_can_read_order(p_order_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_can_read_order_for_caller"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_event_brand_id"("p_event_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT e.brand_id
  FROM public.events e
  WHERE e.id = p_event_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."biz_event_brand_id"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_is_brand_admin_plus"("p_brand_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_brand_effective_rank(p_brand_id, p_user_id)
    >= public.biz_role_rank('brand_admin'::text);
$$;


ALTER FUNCTION "public"."biz_is_brand_admin_plus"("p_brand_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_is_brand_admin_plus_for_caller"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_is_brand_admin_plus(p_brand_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_is_brand_admin_plus_for_caller"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_is_brand_member_for_read"("p_brand_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_brand_effective_rank(p_brand_id, p_user_id) > 0;
$$;


ALTER FUNCTION "public"."biz_is_brand_member_for_read"("p_brand_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_is_brand_member_for_read_for_caller"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_is_brand_member_for_read(p_brand_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_is_brand_member_for_read_for_caller"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_is_event_manager_plus"("p_event_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_brand_effective_rank(public.biz_event_brand_id(p_event_id), p_user_id)
    >= public.biz_role_rank('event_manager'::text);
$$;


ALTER FUNCTION "public"."biz_is_event_manager_plus"("p_event_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_is_event_manager_plus_for_caller"("p_event_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.biz_is_event_manager_plus(p_event_id, auth.uid());
$$;


ALTER FUNCTION "public"."biz_is_event_manager_plus_for_caller"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_order_brand_id"("p_order_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT e.brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.id = p_order_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."biz_order_brand_id"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_prevent_brand_account_id_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'brands.account_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_prevent_brand_account_id_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_prevent_brand_slug_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'brands.slug is immutable (I-17 — Cycle 7 share URLs depend on permanence; create a new brand instead of renaming)';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_prevent_brand_slug_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_prevent_event_brand_id_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'events.brand_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_prevent_event_brand_id_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_prevent_event_created_by_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'events.created_by is immutable (audit-trail integrity)';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_prevent_event_created_by_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_prevent_event_dates_event_id_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'event_dates.event_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_prevent_event_dates_event_id_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_prevent_event_slug_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'events.slug is immutable (Cycle 7 share URLs depend on permanence; create a new event instead of renaming)';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_prevent_event_slug_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_role_rank"("p_role" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE trim(lower(coalesce(p_role, '')))
    WHEN 'scanner' THEN 10
    WHEN 'marketing_manager' THEN 20
    WHEN 'finance_manager' THEN 30
    WHEN 'event_manager' THEN 40
    WHEN 'brand_admin' THEN 50
    WHEN 'account_owner' THEN 60
    ELSE 0
  END;
$$;


ALTER FUNCTION "public"."biz_role_rank"("p_role" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."biz_role_rank"("p_role" "text") IS 'Cycle B1: numeric rank for brand_team_members.role comparisons (higher = more privilege).';



CREATE OR REPLACE FUNCTION "public"."biz_scan_events_block_mutate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'scan_events is append-only for clients';
END;
$$;


ALTER FUNCTION "public"."biz_scan_events_block_mutate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_scan_events_enforce_ticket_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ticket_event uuid;
BEGIN
  SELECT t.event_id INTO v_ticket_event FROM public.tickets t WHERE t.id = NEW.ticket_id;
  IF v_ticket_event IS NULL THEN
    RAISE EXCEPTION 'scan_events: ticket not found';
  END IF;
  IF NEW.event_id IS DISTINCT FROM v_ticket_event THEN
    RAISE EXCEPTION 'scan_events.event_id must match tickets.event_id';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_scan_events_enforce_ticket_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_tickets_enforce_consistent_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order_event uuid;
  v_tt_event uuid;
BEGIN
  SELECT o.event_id INTO v_order_event FROM public.orders o WHERE o.id = NEW.order_id;
  SELECT tt.event_id INTO v_tt_event FROM public.ticket_types tt WHERE tt.id = NEW.ticket_type_id;
  IF v_order_event IS DISTINCT FROM v_tt_event THEN
    RAISE EXCEPTION 'tickets: order.event_id and ticket_type.event_id must match';
  END IF;
  IF NEW.event_id IS DISTINCT FROM v_order_event THEN
    RAISE EXCEPTION 'tickets.event_id must match order and ticket_type event';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."biz_tickets_enforce_consistent_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."biz_tickets_enforce_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_brand uuid;
  v_is_team boolean;
  v_is_scanner boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_brand := public.biz_event_brand_id(OLD.event_id);
  v_is_team :=
    public.biz_is_brand_member_for_read_for_caller(v_brand)
    AND public.biz_brand_effective_rank_for_caller(v_brand)
      >= public.biz_role_rank('finance_manager'::text);

  v_is_scanner := EXISTS (
    SELECT 1
    FROM public.event_scanners es
    WHERE es.event_id = OLD.event_id
      AND es.user_id = auth.uid()
      AND es.removed_at IS NULL
      AND COALESCE((es.permissions ->> 'scan')::boolean, true)
  );

  IF v_is_team THEN
    RETURN NEW;
  END IF;

  IF v_is_scanner THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
      OR NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.attendee_name IS DISTINCT FROM OLD.attendee_name
      OR NEW.attendee_email IS DISTINCT FROM OLD.attendee_email
      OR NEW.attendee_phone IS DISTINCT FROM OLD.attendee_phone
      OR NEW.qr_code IS DISTINCT FROM OLD.qr_code
      OR NEW.transferred_to_email IS DISTINCT FROM OLD.transferred_to_email
      OR NEW.transferred_at IS DISTINCT FROM OLD.transferred_at
      OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
      OR NEW.approval_decided_by IS DISTINCT FROM OLD.approval_decided_by
      OR NEW.approval_decided_at IS DISTINCT FROM OLD.approval_decided_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Scanners may only update check-in fields on tickets';
    END IF;

    -- Check-in: valid -> used — bind scanner identity and timestamp (Copilot review).
    IF OLD.status = 'valid' AND NEW.status = 'used' THEN
      IF NEW.used_by_scanner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'used_by_scanner_id must equal the scanning user';
      END IF;
      IF NEW.used_at IS NULL THEN
        NEW.used_at := now();
      ELSIF NEW.used_at > now() + interval '2 minutes' THEN
        RAISE EXCEPTION 'used_at cannot be more than 2 minutes in the future';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.used_at IS DISTINCT FROM OLD.used_at
      OR NEW.used_by_scanner_id IS DISTINCT FROM OLD.used_by_scanner_id
    THEN
      RAISE EXCEPTION 'Invalid ticket update for scanner role';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not authorized to update ticket';
END;
$$;


ALTER FUNCTION "public"."biz_tickets_enforce_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cascade_friend_decline_to_collabs"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  affected_session RECORD;
  remaining_count INTEGER;
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN

    -- ── 1. Cancel collaboration invites (both directions) ──
    -- When a friend request is declined, any session invites between these
    -- two users are invalid — friendship is a prerequisite for collaboration.
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id
    AND invited_user_id = NEW.receiver_id
    AND status = 'pending';

    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id
    AND invited_user_id = NEW.sender_id
    AND status = 'pending';

    -- ── 2. Delete session_participants for cancelled invites (both directions) ──
    DELETE FROM public.session_participants
    WHERE user_id = NEW.receiver_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id
    );

    DELETE FROM public.session_participants
    WHERE user_id = NEW.sender_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id
    );

    -- ── 3. Delete empty sessions ──
    -- For each session affected by the cancelled invites, check if any
    -- participants remain besides the creator. If not, delete the session.
    -- A session with only its creator has no purpose.
    FOR affected_session IN
      SELECT DISTINCT cs.id AS session_id, cs.created_by
      FROM public.collaboration_sessions cs
      WHERE cs.id IN (
        SELECT session_id FROM public.collaboration_invites
        WHERE (inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id)
           OR (inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id)
      )
      AND cs.status IN ('pending', 'active')
    LOOP
      -- Count participants OTHER than the creator
      SELECT COUNT(*) INTO remaining_count
      FROM public.session_participants sp
      WHERE sp.session_id = affected_session.session_id
      AND sp.user_id != affected_session.created_by;

      IF remaining_count = 0 THEN
        -- No one left — delete the session entirely
        DELETE FROM public.collaboration_sessions
        WHERE id = affected_session.session_id;
      END IF;
    END LOOP;

    -- ── 4. Cancel pending phone invites (friend-specific) ──
    UPDATE public.pending_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id
    AND converted_user_id = NEW.receiver_id
    AND status = 'pending';

    UPDATE public.pending_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id
    AND converted_user_id = NEW.sender_id
    AND status = 'pending';

    -- ── 5. Expire referral credits ──
    UPDATE public.referral_credits
    SET status = 'expired'
    WHERE ((referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id)
       OR  (referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id))
    AND status = 'pending';

  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."cascade_friend_decline_to_collabs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cascade_friend_request_decline_to_links"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN
    UPDATE public.friend_links
    SET status = 'declined', updated_at = NOW()
    WHERE requester_id = OLD.sender_id
      AND target_id = OLD.receiver_id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."cascade_friend_request_decline_to_links"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_card_lock_in"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_session_id UUID;
  v_saved_card_id UUID;
  v_total_participants INTEGER;
  v_attending_count INTEGER;
  v_already_locked BOOLEAN;
BEGIN
  v_session_id := NEW.session_id;
  v_saved_card_id := NEW.saved_card_id;

  -- Skip if not an 'attending' RSVP
  IF NEW.rsvp_status != 'attending' THEN
    RETURN NEW;
  END IF;

  -- Check if card is already locked
  SELECT is_locked INTO v_already_locked
  FROM public.board_saved_cards
  WHERE id = v_saved_card_id;

  IF v_already_locked = true THEN
    RETURN NEW;
  END IF;

  -- Count active participants (has_accepted = true)
  SELECT COUNT(*) INTO v_total_participants
  FROM public.session_participants
  WHERE session_id = v_session_id
    AND has_accepted = true;

  -- Count attending RSVPs for this card
  SELECT COUNT(*) INTO v_attending_count
  FROM public.board_card_rsvps
  WHERE session_id = v_session_id
    AND saved_card_id = v_saved_card_id
    AND rsvp_status = 'attending';

  -- Lock if ALL participants attending
  IF v_attending_count >= v_total_participants AND v_total_participants > 0 THEN
    UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = true
    WHERE id = v_saved_card_id;

    -- Transition session to 'locked' if not already
    UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = v_session_id
      AND status IN ('active', 'voting');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_card_lock_in"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_city_bbox_overlap"("p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision, "p_exclude_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "name" "text", "country" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT sc.id, sc.name, sc.country
  FROM seeding_cities sc
  WHERE (p_exclude_id IS NULL OR sc.id != p_exclude_id)
    AND sc.bbox_sw_lat < p_ne_lat
    AND sc.bbox_ne_lat > p_sw_lat
    AND sc.bbox_sw_lng < p_ne_lng
    AND sc.bbox_ne_lng > p_sw_lng;
$$;


ALTER FUNCTION "public"."check_city_bbox_overlap"("p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision, "p_exclude_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_invited_admin"("p_email" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(email) = lower(trim(p_email))
      AND status = 'invited'
  );
END;
$$;


ALTER FUNCTION "public"."check_invited_admin"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_mutual_like"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_right_swipe_count INTEGER;
  v_existing_saved_card_id UUID;
  v_new_saved_card_id UUID;
  v_card_json JSONB;
  v_swiper RECORD;
  v_lock_key BIGINT;
  v_telemetry_available BOOLEAN;
BEGIN
  -- Only process right swipes
  IF NEW.swipe_state != 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Idempotency guard (ORCH-0558 HF-7): if this row was already
  -- 'swiped_right' and is just being re-upserted (deck regen, client
  -- retry), skip quorum logic. Prevents double-counted votes.
  IF TG_OP = 'UPDATE' AND OLD.swipe_state = 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Check if telemetry table exists (defensive — in case migration
  -- ordering ever flips). Kept as a cached flag per trigger invocation.
  v_telemetry_available := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'match_telemetry_events'
  );

  -- Advisory lock (ORCH-0558 RC-3 fix): serialize any concurrent triggers
  -- for the same (session_id, experience_id) pair. Held until Tx
  -- commit/rollback. Canonical key ordering ensures deadlock-free because
  -- all triggers acquire locks in identical (session_id, experience_id)
  -- order.
  v_lock_key := hashtextextended(
    NEW.session_id::TEXT || '|' || NEW.experience_id::TEXT, 0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- After lock, check if the card is already saved (post-0558 cleanup:
  -- experience_id is NOT NULL, so single-column match is authoritative).
  SELECT id INTO v_existing_saved_card_id
  FROM public.board_saved_cards
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
  LIMIT 1;

  -- If already saved, attach vote
  IF v_existing_saved_card_id IS NOT NULL THEN
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_existing_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;

    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, saved_card_id, reason
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, v_existing_saved_card_id, 'existing_row_votes_attached'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Count right-swipes (lock is held, so count is consistent with concurrent Txs)
  SELECT COUNT(*) INTO v_right_swipe_count
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND swipe_state = 'swiped_right';

  -- Threshold: 2+ right-swipes = match
  IF v_right_swipe_count < 2 THEN
    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, reason, quorum_count
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, 'quorum_not_met', v_right_swipe_count
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Retrieve card_data from any swipe-state row for this (session, experience)
  SELECT card_data INTO v_card_json
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND card_data IS NOT NULL
  ORDER BY swiped_at DESC
  LIMIT 1;

  -- Fallback stub (rare: pre-0556 clients with no card_data)
  IF v_card_json IS NULL THEN
    v_card_json := jsonb_build_object(
      'id', NEW.experience_id,
      'title', 'Matched experience'
    );
  END IF;

  -- Promote with ON CONFLICT safety net. Unique index
  -- `board_saved_cards_session_experience_unique` (migration 000002)
  -- catches any lock escape. Loser falls into attach-vote branch below.
  INSERT INTO public.board_saved_cards (
    session_id, experience_id, card_data, saved_by
  ) VALUES (
    NEW.session_id, NEW.experience_id, v_card_json, NEW.user_id
  )
  ON CONFLICT (session_id, experience_id) DO NOTHING
  RETURNING id INTO v_new_saved_card_id;

  -- If ON CONFLICT hit, another trigger in a sibling Tx beat us.
  IF v_new_saved_card_id IS NULL THEN
    SELECT id INTO v_new_saved_card_id
    FROM public.board_saved_cards
    WHERE session_id = NEW.session_id AND experience_id = NEW.experience_id
    LIMIT 1;

    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_new_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;

    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, saved_card_id, reason
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, v_new_saved_card_id, 'concurrency_conflict_attached_to_existing'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Fresh promotion succeeded. Insert votes for ALL right-swipers.
  FOR v_swiper IN
    SELECT user_id
    FROM public.board_user_swipe_states
    WHERE session_id = NEW.session_id
      AND experience_id = NEW.experience_id
      AND swipe_state = 'swiped_right'
  LOOP
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_new_saved_card_id, v_swiper.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;
  END LOOP;

  IF v_telemetry_available THEN
    INSERT INTO public.match_telemetry_events (
      event_type, session_id, experience_id, user_id, saved_card_id, reason, quorum_count
    )
    VALUES (
      'collab_match_promotion_success', NEW.session_id, NEW.experience_id,
      NEW.user_id, v_new_saved_card_id, 'promoted', v_right_swipe_count
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_mutual_like"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_mutual_like"() IS 'ORCH-0558 v3: Bulletproof collab match trigger. Acquires advisory lock on (session_id, experience_id) to serialize concurrent triggers. Uses unique constraint (session_id, experience_id) + ON CONFLICT DO NOTHING as belt. Idempotency gate on UPDATE with OLD.swipe_state=swiped_right. Emits match_telemetry_events rows for every decision path. See Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md.';



CREATE OR REPLACE FUNCTION "public"."check_pairing_allowed"("p_user_id" "uuid") RETURNS TABLE("allowed" boolean, "current_count" integer, "max_allowed" integer, "tier" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_tier TEXT; v_limits JSONB; v_max INTEGER; v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  v_max := (v_limits->>'max_pairings')::INTEGER;
  SELECT COUNT(*) INTO v_count FROM pairings WHERE user_a_id = p_user_id OR user_b_id = p_user_id;
  IF v_max = -1 THEN allowed := true; ELSE allowed := (v_count < v_max); END IF;
  current_count := v_count; max_allowed := v_max; tier := v_tier;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."check_pairing_allowed"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_session_creation_allowed"("p_user_id" "uuid") RETURNS TABLE("allowed" boolean, "current_count" integer, "max_allowed" integer, "tier" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tier TEXT;
  v_limits JSONB;
  v_max INTEGER;
  v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  v_max := (v_limits->>'max_sessions')::INTEGER;

  -- Count active sessions created by this user
  SELECT COUNT(*) INTO v_count
  FROM collaboration_sessions
  WHERE created_by = p_user_id
    AND status IN ('pending', 'active')
    AND (archived_at IS NULL);

  -- -1 means unlimited
  IF v_max = -1 THEN
    allowed := true;
  ELSE
    allowed := (v_count < v_max);
  END IF;

  current_count := v_count;
  max_allowed := v_max;
  tier := v_tier;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."check_session_creation_allowed"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_username_availability"("check_username" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  username_exists BOOLEAN;
BEGIN
  -- Check if username exists (case-insensitive)
  -- Only check non-null usernames
  SELECT EXISTS(
    SELECT 1 
    FROM public.profiles 
    WHERE LOWER(TRIM(username)) = LOWER(TRIM(check_username))
    AND username IS NOT NULL
  ) INTO username_exists;
  
  -- Return false if username exists (not available), true if available
  RETURN NOT username_exists;
END;
$$;


ALTER FUNCTION "public"."check_username_availability"("check_username" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_username_availability"("check_username" "text") IS 'Checks if a username is available. Returns true if available, false if taken. Bypasses RLS to allow unauthenticated checks.';



CREATE OR REPLACE FUNCTION "public"."cleanup_expired_undo_actions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    DELETE FROM public.undo_actions 
    WHERE expires_at < NOW();
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_undo_actions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_session_if_under_two_participants"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  target_session_id UUID;
  accepted_count INTEGER;
  session_status TEXT;
BEGIN
  target_session_id := COALESCE(OLD.session_id, NEW.session_id);

  IF target_session_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only evaluate cleanup when membership can shrink
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Only auto-delete active sessions that dropped below 2 accepted participants
  SELECT cs.status
  INTO session_status
  FROM public.collaboration_sessions cs
  WHERE cs.id = target_session_id;

  IF session_status IS NULL OR session_status <> 'active' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*)
  INTO accepted_count
  FROM public.session_participants sp
  WHERE sp.session_id = target_session_id
    AND sp.has_accepted = true;

  IF accepted_count < 2 THEN
    DELETE FROM public.collaboration_sessions
    WHERE id = target_session_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."cleanup_session_if_under_two_participants"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_push_tokens"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.user_push_tokens
  WHERE updated_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_stale_push_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_taste_match"("p_user_a" "uuid", "p_user_b" "uuid") RETURNS TABLE("match_percentage" integer, "shared_categories" "text"[], "shared_tiers" "text"[], "shared_intents" "text"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_a_cats TEXT[]; v_b_cats TEXT[];
  v_a_intents TEXT[]; v_b_intents TEXT[];
  v_score FLOAT;
BEGIN
  SELECT categories, intents INTO v_a_cats, v_a_intents
    FROM preferences WHERE profile_id = p_user_a;
  SELECT categories, intents INTO v_b_cats, v_b_intents
    FROM preferences WHERE profile_id = p_user_b;

  -- ORCH-0434: price_tiers removed from similarity calc.
  -- Reweighted: 70% categories, 30% intents.
  v_score := (
    jaccard(v_a_cats, v_b_cats) * 0.7 +
    jaccard(v_a_intents, v_b_intents) * 0.3
  ) * 100;

  RETURN QUERY SELECT
    ROUND(v_score)::INTEGER,
    ARRAY(SELECT unnest(v_a_cats) INTERSECT SELECT unnest(v_b_cats)),
    '{}'::TEXT[],  -- shared_tiers deprecated
    ARRAY(SELECT unnest(v_a_intents) INTERSECT SELECT unnest(v_b_intents));
END;
$$;


ALTER FUNCTION "public"."compute_taste_match"("p_user_a" "uuid", "p_user_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_pending_invites_on_phone_verified"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  pending RECORD;
  session_pending RECORD;
  new_invite_id UUID;
BEGIN
  IF NEW.phone IS NULL OR (OLD.phone IS NOT NULL AND OLD.phone = NEW.phone) THEN
    RETURN NEW;
  END IF;

  -- PART 1: Convert pending friend invites
  FOR pending IN
    SELECT * FROM public.pending_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.friend_requests (sender_id, receiver_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;

    -- friend_links table was dropped in 20260312300003_remove_friend_link_feature.sql

    UPDATE public.pending_invites
    SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
    WHERE id = pending.id;

    INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
    VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
    ON CONFLICT (referrer_id, referred_id) DO NOTHING;
  END LOOP;

  -- PART 2: Convert pending SESSION invites — pending_friendship = true
  FOR session_pending IN
    SELECT * FROM public.pending_session_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status, pending_friendship
    )
    VALUES (
      session_pending.session_id,
      session_pending.inviter_id,
      NEW.id,
      'pending',
      true  -- HIDDEN until friend request accepted
    )
    ON CONFLICT (session_id, invited_user_id)
    DO UPDATE SET
      status = 'pending',
      pending_friendship = true,
      updated_at = NOW()
    WHERE collaboration_invites.status = 'cancelled'
    RETURNING id INTO new_invite_id;

    IF new_invite_id IS NOT NULL THEN
      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (session_pending.session_id, NEW.id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;
    END IF;

    UPDATE public.pending_session_invites
    SET status = 'converted',
        converted_invite_id = COALESCE(new_invite_id, converted_invite_id),
        updated_at = NOW()
    WHERE id = session_pending.id;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."convert_pending_invites_on_phone_verified"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_pending_pair_invites_on_phone_verified"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_invite RECORD;
    v_friend_request_id UUID;
BEGIN
    IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN
        FOR v_invite IN
            SELECT * FROM pending_pair_invites
            WHERE phone_e164 = NEW.phone AND status = 'pending'
        LOOP
            -- Step 1: Create friend request (if not already exists)
            INSERT INTO friend_requests (sender_id, receiver_id, status)
            VALUES (v_invite.inviter_id, NEW.id, 'pending')
            ON CONFLICT (sender_id, receiver_id) DO NOTHING
            RETURNING id INTO v_friend_request_id;

            -- If friend request already existed, look it up
            IF v_friend_request_id IS NULL THEN
                SELECT id INTO v_friend_request_id
                FROM friend_requests
                WHERE sender_id = v_invite.inviter_id AND receiver_id = NEW.id;
            END IF;

            -- Step 2: Create pair request, hidden until friend request is accepted.
            -- Use NOT EXISTS instead of ON CONFLICT because the unique constraint
            -- is a partial index (idx_pair_requests_unique_active) which cannot be
            -- referenced by a bare ON CONFLICT (sender_id, receiver_id).
            INSERT INTO pair_requests (
                sender_id, receiver_id, status, visibility,
                gated_by_friend_request_id, pending_display_name, pending_phone_e164
            )
            SELECT
                v_invite.inviter_id, NEW.id, 'pending', 'hidden_until_friend',
                v_friend_request_id, NULL, v_invite.phone_e164
            WHERE NOT EXISTS (
                SELECT 1 FROM pair_requests
                WHERE sender_id = v_invite.inviter_id
                  AND receiver_id = NEW.id
                  AND status IN ('pending', 'accepted')
            );

            -- Step 3: Mark invite as converted
            UPDATE pending_pair_invites
            SET status = 'converted', converted_user_id = NEW.id, converted_at = now()
            WHERE id = v_invite.id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."convert_pending_pair_invites_on_phone_verified"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_calendar_entries_on_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_participant RECORD;
  v_session RECORD;
  v_card_data JSONB;
BEGIN
  -- Only fire when is_locked transitions from false to true
  IF OLD.is_locked = true OR NEW.is_locked = false THEN
    RETURN NEW;
  END IF;

  -- Get session datetime_pref for scheduled_at
  SELECT s.id, bsp.datetime_pref
  INTO v_session
  FROM public.collaboration_sessions s
  LEFT JOIN public.board_session_preferences bsp
    ON bsp.session_id = s.id
  WHERE s.id = NEW.session_id
  ORDER BY bsp.datetime_pref ASC NULLS LAST
  LIMIT 1;

  v_card_data := NEW.card_data;

  -- Create calendar entry for EVERY active participant
  FOR v_participant IN
    SELECT user_id
    FROM public.session_participants
    WHERE session_id = NEW.session_id
      AND has_accepted = true
  LOOP
    INSERT INTO public.calendar_entries (
      user_id,
      board_card_id,
      source,
      card_data,
      status,
      scheduled_at,
      duration_minutes
    ) VALUES (
      v_participant.user_id,
      NEW.id,
      'collaboration',
      v_card_data,
      'confirmed',
      COALESCE(v_session.datetime_pref, NOW() + INTERVAL '1 day'),
      60
    )
    ON CONFLICT (user_id, board_card_id) WHERE board_card_id IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_calendar_entries_on_lock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_notification_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_default_notification_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_preference_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    INSERT INTO public.preference_history (
        user_id,
        preference_id,
        old_data,
        new_data,
        change_type
    ) VALUES (
        NEW.profile_id,
        NEW.profile_id,
        CASE
            WHEN TG_OP = 'INSERT' THEN '{}'::jsonb
            ELSE to_jsonb(OLD)
        END,
        to_jsonb(NEW),
        TG_OP
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'preference_history insert failed: %', SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_preference_history"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_preference_history"() IS 'Creates preference history entries as JSONB snapshots. Handles INSERT/UPDATE/DELETE. Exception handler prevents history failures from rolling back preference saves.';



CREATE OR REPLACE FUNCTION "public"."create_subscription_on_onboarding_complete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_subscription_on_onboarding_complete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_subscription_on_signup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, tier, trial_ends_at)
  VALUES (NEW.id, 'free', NULL)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_subscription_on_signup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."credit_referral_on_friend_accepted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  credit RECORD;
  pending_session RECORD;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Check for pending referral credit (sender referred receiver)
    SELECT * INTO credit FROM public.referral_credits
    WHERE referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id AND status = 'pending';

    IF credit IS NOT NULL THEN
      UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), friend_request_id = NEW.id
      WHERE id = credit.id;

      UPDATE public.subscriptions
      SET referral_bonus_months = referral_bonus_months + 1,
          -- Start the clock on first referral, or restart if previous bonus fully expired
          referral_bonus_started_at = CASE
            WHEN referral_bonus_started_at IS NULL THEN NOW()
            WHEN referral_bonus_started_at + (referral_bonus_months * INTERVAL '30 days') <= NOW()
              THEN NOW()
            ELSE referral_bonus_started_at
          END,
          updated_at = NOW()
      WHERE user_id = credit.referrer_id;
    END IF;

    -- Also check reverse direction (receiver referred sender)
    SELECT * INTO credit FROM public.referral_credits
    WHERE referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id AND status = 'pending';

    IF credit IS NOT NULL THEN
      UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), friend_request_id = NEW.id
      WHERE id = credit.id;

      UPDATE public.subscriptions
      SET referral_bonus_months = referral_bonus_months + 1,
          -- Start the clock on first referral, or restart if previous bonus fully expired
          referral_bonus_started_at = CASE
            WHEN referral_bonus_started_at IS NULL THEN NOW()
            WHEN referral_bonus_started_at + (referral_bonus_months * INTERVAL '30 days') <= NOW()
              THEN NOW()
            ELSE referral_bonus_started_at
          END,
          updated_at = NOW()
      WHERE user_id = credit.referrer_id;
    END IF;

    -- Convert pending_session_invites for the newly friended pair
    -- Direction 1: sender invited receiver's phone
    FOR pending_session IN
      SELECT psi.* FROM public.pending_session_invites psi
      JOIN public.pending_invites pi ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
      WHERE psi.inviter_id = NEW.sender_id
        AND pi.converted_user_id = NEW.receiver_id
        AND psi.status = 'pending'
    LOOP
      INSERT INTO public.collaboration_invites (session_id, inviter_id, invitee_id, status, invite_method)
      VALUES (pending_session.session_id, pending_session.inviter_id, NEW.receiver_id, 'pending', 'friends_list')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (pending_session.session_id, NEW.receiver_id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;

      UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = pending_session.id;
    END LOOP;

    -- Direction 2: receiver invited sender's phone
    FOR pending_session IN
      SELECT psi.* FROM public.pending_session_invites psi
      JOIN public.pending_invites pi ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
      WHERE psi.inviter_id = NEW.receiver_id
        AND pi.converted_user_id = NEW.sender_id
        AND psi.status = 'pending'
    LOOP
      INSERT INTO public.collaboration_invites (session_id, inviter_id, invitee_id, status, invite_method)
      VALUES (pending_session.session_id, pending_session.inviter_id, NEW.sender_id, 'pending', 'friends_list')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (pending_session.session_id, NEW.sender_id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;

      UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = pending_session.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."credit_referral_on_friend_accepted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cron_refresh_admin_place_pool_mv"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15min'
    SET "lock_timeout" TO '15min'
    AS $$
BEGIN
  -- Refresh the MV concurrently (reads not blocked during refresh)
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;

  -- Update planner statistics so aggregate RPCs pick good plans.
  -- Without this, admin_place_category_breakdown and similar drift to slow plans
  -- over time as underlying place_pool churn makes the planner's cached stats stale.
  ANALYZE public.admin_place_pool_mv;
END;
$$;


ALTER FUNCTION "public"."cron_refresh_admin_place_pool_mv"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cron_refresh_admin_place_pool_mv"() IS 'ORCH-0481 cycle 2 fix. Runs via pg_cron every 10 minutes. SET statement_timeout TO 15min overrides the default 2-min cron timeout that made the raw REFRESH call fail every run. ANALYZE step keeps planner stats fresh (prevents admin_place_category_breakdown regression). SECURITY DEFINER + no auth check because cron runs as postgres role with no auth.email(). User-triggered refreshes go through admin_refresh_place_pool_mv() which has the admin check.';



CREATE OR REPLACE FUNCTION "public"."delete_notifications_on_entity_resolved"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_notification_type TEXT;
BEGIN
  -- Only fire when status transitions FROM 'pending' to something else.
  -- Guards against unrelated updates (e.g., updated_at changes).
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  -- Map table name → notification type
  CASE TG_TABLE_NAME
    WHEN 'friend_requests' THEN
      v_notification_type := 'friend_request_received';
    WHEN 'pair_requests' THEN
      v_notification_type := 'pair_request_received';
    WHEN 'collaboration_invites' THEN
      v_notification_type := 'collaboration_invite_received';
    ELSE
      RETURN NEW;
  END CASE;

  -- Delete matching notification(s). The related_id column stores the entity ID
  -- (set by notify-dispatch from the relatedId field in each edge function).
  -- This is idempotent — if the client already deleted it, 0 rows are affected.
  DELETE FROM public.notifications
    WHERE related_id = OLD.id::TEXT
      AND type = v_notification_type;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."delete_notifications_on_entity_resolved"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_session_creation_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_check RECORD;
BEGIN
  -- Use the existing check function to determine if creation is allowed
  SELECT * INTO v_check
  FROM check_session_creation_allowed(NEW.created_by);

  IF NOT v_check.allowed THEN
    RAISE EXCEPTION 'session_limit_reached: You have reached your % limit of % active session(s).',
      v_check.tier, v_check.max_allowed
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_session_creation_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_undo_action"("p_undo_id" "text", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    undo_record RECORD;
    success BOOLEAN := FALSE;
BEGIN
    -- Get the undo action
    SELECT * INTO undo_record
    FROM public.undo_actions
    WHERE id = p_undo_id
    AND user_id = p_user_id
    AND expires_at > NOW();
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Execute undo based on type
    CASE undo_record.type
        WHEN 'friend_removal' THEN
            -- Restore friend relationship
            UPDATE public.friends
            SET deleted_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'friendId')::UUID;
            success := TRUE;
            
        WHEN 'message_unsend' THEN
            -- Restore message
            UPDATE public.messages
            SET deleted_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'messageId')::UUID;
            success := TRUE;
            
        WHEN 'vote_undo' THEN
            -- Remove vote
            DELETE FROM public.board_votes
            WHERE id = (undo_record.data->>'voteId')::UUID;
            success := TRUE;
            
        WHEN 'finalize_undo' THEN
            -- Move card back to open state
            UPDATE public.board_cards
            SET status = 'open', finalized_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'cardId')::UUID;
            success := TRUE;
            
        WHEN 'board_archive' THEN
            -- Restore board
            UPDATE public.boards
            SET archived_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'boardId')::UUID;
            success := TRUE;
            
        WHEN 'save_undo' THEN
            -- Remove save
            DELETE FROM public.saves
            WHERE id = (undo_record.data->>'saveId')::UUID;
            success := TRUE;
            
        WHEN 'schedule_undo' THEN
            -- Move back to saved state
            UPDATE public.scheduled_activities
            SET status = 'saved', scheduled_date = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'scheduleId')::UUID;
            success := TRUE;
            
        WHEN 'preference_rollback' THEN
            -- Restore original preferences
            UPDATE public.preferences
            SET 
                categories = (undo_record.data->'originalData'->>'categories')::TEXT[],
                budget = (undo_record.data->'originalData'->'budget')::JSONB,
                travel = (undo_record.data->'originalData'->>'travel')::TEXT,
                experience_types = (undo_record.data->'originalData'->>'experience_types')::TEXT[],
                updated_at = NOW()
            WHERE id = (undo_record.data->>'preferenceId')::UUID;
            success := TRUE;
            
        ELSE
            success := FALSE;
    END CASE;
    
    -- Remove the undo action if successful
    IF success THEN
        DELETE FROM public.undo_actions WHERE id = p_undo_id;
    END IF;
    
    RETURN success;
END;
$$;


ALTER FUNCTION "public"."execute_undo_action"("p_undo_id" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fan_review_to_engagement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.engagement_metrics
      (user_id, event_kind, place_pool_id, container_key, experience_type, category, stop_index, created_at)
    VALUES
      (NEW.user_id, 'reviewed', NEW.place_pool_id, NULL, NULL, NULL, NULL, NEW.created_at);
  END IF;
  -- No amplification on UPDATE/DELETE (review edits don't produce new engagement events)
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fan_review_to_engagement failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."fan_review_to_engagement"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fan_review_to_engagement"() IS 'ORCH-0640: replaces the doomed update_card_pool_review_stats. Fires on place_reviews INSERT.';



CREATE OR REPLACE FUNCTION "public"."fan_visit_to_engagement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_place_pool_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- user_visits.experience_id is TEXT holding google_place_id
    SELECT pp.id INTO v_place_pool_id
    FROM public.place_pool pp
    WHERE pp.google_place_id = NEW.experience_id
    LIMIT 1;

    -- If no matching place_pool row, skip silently (place was delisted)
    IF v_place_pool_id IS NOT NULL THEN
      INSERT INTO public.engagement_metrics
        (user_id, event_kind, place_pool_id, container_key, experience_type, category, stop_index, created_at)
      VALUES
        (NEW.user_id, 'scheduled', v_place_pool_id, NULL, NULL, NULL, NULL, NEW.created_at);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fan_visit_to_engagement failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."fan_visit_to_engagement"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fan_visit_to_engagement"() IS 'ORCH-0640: replaces the doomed update_card_pool_visit_count. Fires on user_visits INSERT.
   Resolves google_place_id → place_pool_id at fire time.';



CREATE OR REPLACE FUNCTION "public"."fetch_local_signal_ranked"("p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text", "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric, "p_required_types" "text"[] DEFAULT NULL::"text"[], "p_limit" integer DEFAULT 100) RETURNS TABLE("place_id" "uuid", "rank_score" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    ps_rank.place_id,
    ps_rank.score AS rank_score
  FROM place_pool pp
  INNER JOIN place_scores ps_filter
    ON ps_filter.place_id = pp.id
    AND ps_filter.signal_id = p_filter_signal
    AND ps_filter.score >= p_filter_min
  INNER JOIN place_scores ps_rank
    ON ps_rank.place_id = pp.id
    AND ps_rank.signal_id = p_rank_signal
  WHERE pp.is_active = true
    AND pp.is_servable = true
    AND pp.lat BETWEEN p_lat_min AND p_lat_max
    AND pp.lng BETWEEN p_lng_min AND p_lng_max
    AND (p_required_types IS NULL OR pp.types && p_required_types)
  ORDER BY ps_rank.score DESC
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."fetch_local_signal_ranked"("p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text", "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric, "p_required_types" "text"[], "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fetch_local_signal_ranked"("p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text", "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric, "p_required_types" "text"[], "p_limit" integer) IS 'ORCH-0653 v3.2: returns top-N local place_ids ranked by rank_signal score, after filtering by filter_signal threshold + bbox + servable. Used by generate-curated-experiences edge function. Replaces 3 separate PostgREST roundtrips that hit Supabase edge proxy URL length cap.';



CREATE OR REPLACE FUNCTION "public"."generate_invite_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excluding confusing chars
  code TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::INTEGER, 1);
  END LOOP;
  RETURN 'MINGLA-' || code;
END;
$$;


ALTER FUNCTION "public"."generate_invite_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_referral_code"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  candidate TEXT;
  max_attempts INTEGER := 10;
  attempt INTEGER := 0;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      attempt := attempt + 1;
      candidate := 'MGL-' || UPPER(SUBSTR(MD5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 12));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
      IF attempt >= max_attempts THEN
        RAISE EXCEPTION 'Unable to generate unique referral code after % attempts', max_attempts;
      END IF;
    END LOOP;
    NEW.referral_code := candidate;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_referral_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_emails"() RETURNS TABLE("email" "text", "status" "text")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT email, status FROM admin_users
  WHERE status IN ('active', 'invited');
$$;


ALTER FUNCTION "public"."get_admin_emails"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_card_rsvp_counts"("p_saved_card_id" "uuid") RETURNS TABLE("attending_count" bigint, "not_attending_count" bigint, "total_rsvps" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE bcr.rsvp_status = 'attending')::BIGINT as attending_count,
    COUNT(*) FILTER (WHERE bcr.rsvp_status = 'not_attending')::BIGINT as not_attending_count,
    COUNT(*)::BIGINT as total_rsvps
  FROM public.board_card_rsvps bcr
  WHERE bcr.saved_card_id = p_saved_card_id;
END;
$$;


ALTER FUNCTION "public"."get_card_rsvp_counts"("p_saved_card_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_effective_tier"("p_user_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
  v_global_plus TEXT;
BEGIN
  -- Priority -1: Global promotional access (pre-launch)
  -- When enabled, ALL users get mingla_plus regardless of subscription state.
  -- Toggle via app_config: SET config_value = 'false' to disable.
  SELECT config_value INTO v_global_plus
  FROM app_config
  WHERE config_key = 'global_plus_access';

  IF v_global_plus = 'true' THEN
    RETURN 'mingla_plus';
  END IF;

  -- Priority 0: Active admin override (highest priority after global)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_override_tier IS NOT NULL THEN
    RETURN v_override_tier;
  END IF;

  -- Priority 1+: subscription-based logic
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF v_sub.tier = 'mingla_plus'
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Backward compat: active trial (existing users only — no new trials granted)
  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Referral bonus (date-based expiry, 30 days per referral from start date)
  IF v_sub.referral_bonus_months > 0
     AND v_sub.referral_bonus_started_at IS NOT NULL
     AND v_sub.referral_bonus_started_at
         + (v_sub.referral_bonus_months * INTERVAL '30 days') > now() THEN
    RETURN 'mingla_plus';
  END IF;

  RETURN 'free';
END;
$$;


ALTER FUNCTION "public"."get_effective_tier"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_muted_user_ids"("user_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT muted_id FROM muted_users WHERE muter_id = user_id;
$$;


ALTER FUNCTION "public"."get_muted_user_ids"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_direct_conversation"("p_user1_id" "uuid", "p_user2_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_conversation_id UUID;
  v_ordered_a UUID;
  v_ordered_b UUID;
BEGIN
  -- Normalize order (smaller UUID first) for consistent lookups
  IF p_user1_id < p_user2_id THEN
    v_ordered_a := p_user1_id;
    v_ordered_b := p_user2_id;
  ELSE
    v_ordered_a := p_user2_id;
    v_ordered_b := p_user1_id;
  END IF;

  -- Try to find existing direct conversation between these two users
  SELECT cp1.conversation_id INTO v_conversation_id
  FROM conversation_participants cp1
  JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
  JOIN conversations c ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_ordered_a
    AND cp2.user_id = v_ordered_b
    AND c.type = 'direct'
  LIMIT 1;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  -- Create new conversation atomically
  INSERT INTO conversations (type, created_by)
  VALUES ('direct', p_user1_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conversation_id, v_ordered_a),
         (v_conversation_id, v_ordered_b);

  RETURN v_conversation_id;
END;
$$;


ALTER FUNCTION "public"."get_or_create_direct_conversation"("p_user1_id" "uuid", "p_user2_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_place_count_per_city"() RETURNS TABLE("city_id" "uuid", "place_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT city_id, count(*) AS place_count
  FROM public.place_pool
  WHERE is_active = true AND city_id IS NOT NULL
  GROUP BY city_id;
$$;


ALTER FUNCTION "public"."get_place_count_per_city"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_saved_card_vote_counts"("p_saved_card_id" "uuid") RETURNS TABLE("up_votes" bigint, "down_votes" bigint, "total_votes" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE bv.vote_type = 'up')::BIGINT as up_votes,
    COUNT(*) FILTER (WHERE bv.vote_type = 'down')::BIGINT as down_votes,
    COUNT(*)::BIGINT as total_votes
  FROM public.board_votes bv
  WHERE bv.saved_card_id = p_saved_card_id;
END;
$$;


ALTER FUNCTION "public"."get_saved_card_vote_counts"("p_saved_card_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_seed_stats_per_city"() RETURNS TABLE("city_id" "uuid", "city_name" "text", "country" "text", "center_lat" double precision, "center_lng" double precision, "coverage_radius_km" double precision, "status" "text", "place_count" bigint, "seed_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country,
    sc.center_lat,
    sc.center_lng,
    sc.coverage_radius_km,
    sc.status,
    COALESCE(pp.cnt, 0) AS place_count,
    COALESCE(sp.cnt, 0) AS seed_count
  FROM public.seeding_cities sc
  LEFT JOIN (
    SELECT city_id, count(*) AS cnt
    FROM public.place_pool
    WHERE is_active = true AND city_id IS NOT NULL
    GROUP BY city_id
  ) pp ON pp.city_id = sc.id
  LEFT JOIN (
    SELECT city_id, count(*) AS cnt
    FROM public.seed_map_presence
    WHERE city_id IS NOT NULL
    GROUP BY city_id
  ) sp ON sp.city_id = sc.id
  WHERE sc.status IN ('seeded', 'launched')
  ORDER BY COALESCE(pp.cnt, 0) DESC;
$$;


ALTER FUNCTION "public"."get_seed_stats_per_city"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_session_member_limit"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN RETURN -1; END;
$$;


ALTER FUNCTION "public"."get_session_member_limit"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tier_limits"("p_tier" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
  CASE p_tier
    WHEN 'mingla_plus' THEN
      RETURN jsonb_build_object('daily_swipes', -1, 'max_pairings', -1, 'max_sessions', -1, 'max_session_members', -1, 'curated_cards_access', true, 'custom_starting_point', true);
    ELSE
      RETURN jsonb_build_object('daily_swipes', -1, 'max_pairings', 1, 'max_sessions', 1, 'max_session_members', -1, 'curated_cards_access', false, 'custom_starting_point', false);
  END CASE;
END;
$$;


ALTER FUNCTION "public"."get_tier_limits"("p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_total_unread_card_messages_count"("p_session_id" "uuid", "p_user_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.board_card_messages bcm
    WHERE bcm.session_id = p_session_id
    AND bcm.deleted_at IS NULL
    AND bcm.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.board_card_message_reads bcmr
      WHERE bcmr.message_id = bcm.id
      AND bcmr.user_id = p_user_id
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_total_unread_card_messages_count"("p_session_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_undo_actions"("p_user_id" "uuid") RETURNS TABLE("id" "text", "type" "text", "data" "jsonb", "action_timestamp" timestamp with time zone, "expires_at" timestamp with time zone, "description" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ua.id,
        ua.type,
        ua.data,
        ua.timestamp as action_timestamp,
        ua.expires_at,
        ua.description
    FROM public.undo_actions ua
    WHERE ua.user_id = p_user_id
    AND ua.expires_at > NOW()
    ORDER BY ua.timestamp DESC;
END;
$$;


ALTER FUNCTION "public"."get_undo_actions"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_card_message_count"("p_session_id" "uuid", "p_saved_card_id" "uuid", "p_user_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.board_card_messages bcm
    WHERE bcm.session_id = p_session_id
    AND bcm.saved_card_id = p_saved_card_id
    AND bcm.deleted_at IS NULL
    AND bcm.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.board_card_message_reads bcmr
      WHERE bcmr.message_id = bcm.id
      AND bcmr.user_id = p_user_id
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_unread_card_message_count"("p_session_id" "uuid", "p_saved_card_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_message_count"("p_session_id" "uuid", "p_user_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.board_messages bm
    WHERE bm.session_id = p_session_id
    AND bm.deleted_at IS NULL
    AND bm.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.board_message_reads bmr
      WHERE bmr.message_id = bm.id
      AND bmr.user_id = p_user_id
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_unread_message_count"("p_session_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_frequent_locations"("user_uuid" "uuid", "limit_count" integer DEFAULT 5) RETURNS TABLE("latitude" double precision, "longitude" double precision, "visit_count" bigint, "last_visit" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT ulh.latitude, ulh.longitude, COUNT(*) as visit_count, MAX(ulh.created_at) as last_visit
  FROM public.user_location_history ulh
  WHERE ulh.user_id = user_uuid AND ulh.location_type = 'current'
  GROUP BY ulh.latitude, ulh.longitude
  HAVING COUNT(*) >= 3
  ORDER BY visit_count DESC, last_visit DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."get_user_frequent_locations"("user_uuid" "uuid", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_board_vote"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.board_id IS NOT NULL AND NEW.card_id IS NOT NULL THEN
    INSERT INTO public.activity_history (board_id, card_id, user_id, action_type, action_data)
    VALUES (NEW.board_id, NEW.card_id, NEW.user_id, 'vote', jsonb_build_object('vote_type', NEW.vote_type));
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_board_vote"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_collab_session_end"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status IN ('completed', 'archived') AND OLD.status NOT IN ('completed', 'archived') THEN
    -- Restore leaderboard presence for all participants of this session
    UPDATE leaderboard_presence lp
    SET
      available_seats = COALESCE(
        (SELECT ums.available_seats FROM user_map_settings ums WHERE ums.user_id = lp.user_id),
        1
      ),
      active_collab_session_id = NULL,
      updated_at = now()
    WHERE lp.active_collab_session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_collab_session_end"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  user_email TEXT;
  user_phone TEXT;
  default_display_name TEXT;
  default_username TEXT;
  base_username TEXT;
  default_first_name TEXT;
  user_account_type TEXT;
  username_suffix TEXT;
  retry_count INTEGER := 0;
  violation_constraint TEXT;
BEGIN
  -- Auto-confirm the user's email/phone to bypass confirmation requirement
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      phone_confirmed_at = COALESCE(phone_confirmed_at, now())
  WHERE id = NEW.id;

  -- Get email or phone
  user_email := NEW.email;
  user_phone := NEW.phone;

  -- Get account_type from metadata if provided
  user_account_type := NEW.raw_user_meta_data->>'account_type';

  -- Determine default username
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL THEN
    default_username := NEW.raw_user_meta_data->>'username';
  ELSIF user_email IS NOT NULL THEN
    default_username := SPLIT_PART(user_email, '@', 1);
  ELSIF user_phone IS NOT NULL THEN
    default_username := 'user' || RIGHT(REGEXP_REPLACE(user_phone, '[^0-9]', '', 'g'), 6);
  ELSE
    default_username := 'user_' || LEFT(NEW.id::text, 8);
  END IF;

  -- Keep the base for retry suffix generation
  base_username := default_username;

  -- Display name: prefer OAuth-provided name, else email prefix, else 'New User'
  -- PRIVACY: Never use full email or phone number as display_name
  default_display_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
    CASE
      WHEN user_email IS NOT NULL AND user_email != ''
        THEN SPLIT_PART(user_email, '@', 1)
      ELSE 'New User'
    END
  );

  -- First name from OAuth metadata, else email prefix
  default_first_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''),
    CASE
      WHEN user_email IS NOT NULL THEN SPLIT_PART(user_email, '@', 1)
      ELSE default_username
    END
  );

  -- Insert profile with collision-safe username (retry loop)
  LOOP
    BEGIN
      INSERT INTO public.profiles (
        id, email, phone, display_name, username, first_name, last_name,
        account_type, has_completed_onboarding, created_at, updated_at
      ) VALUES (
        NEW.id,
        user_email,
        user_phone,
        default_display_name,
        default_username,
        default_first_name,
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        user_account_type,
        false,
        now(),
        now()
      )
      ON CONFLICT (id) DO NOTHING;

      -- Success — exit the retry loop
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS violation_constraint = CONSTRAINT_NAME;

      IF violation_constraint = 'profiles_username_key' THEN
        retry_count := retry_count + 1;
        IF retry_count > 5 THEN
          default_username := 'user_' || LEFT(NEW.id::text, 8) || '_' || LEFT(md5(random()::text), 4);
        ELSE
          username_suffix := LEFT(md5(random()::text), 4);
          default_username := base_username || '_' || username_suffix;
        END IF;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_blocked"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM friends
  WHERE (user_id = NEW.blocker_id AND friend_user_id = NEW.blocked_id)
     OR (user_id = NEW.blocked_id AND friend_user_id = NEW.blocker_id);

  UPDATE public.friend_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE status = 'pending'
    AND ((sender_id = NEW.blocker_id AND receiver_id = NEW.blocked_id)
      OR (sender_id = NEW.blocked_id AND receiver_id = NEW.blocker_id));

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_user_blocked"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_block_between"("user1" "uuid", "user2" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = user1 AND blocked_id = user2)
       OR (blocker_id = user2 AND blocked_id = user1)
  );
$$;


ALTER FUNCTION "public"."has_block_between"("user1" "uuid", "user2" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_recent_report"("reporter" "uuid", "reported" "uuid", "hours_window" integer DEFAULT 24) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_reports
    WHERE reporter_id = reporter 
    AND reported_user_id = reported
    AND created_at > now() - (hours_window || ' hours')::interval
  );
$$;


ALTER FUNCTION "public"."has_recent_report"("reporter" "uuid", "reported" "uuid", "hours_window" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_session_invite"("p_session_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaboration_invites
    WHERE session_id = p_session_id
    AND invited_user_id = p_user_id
    AND status IN ('pending', 'accepted')
  );
$$;


ALTER FUNCTION "public"."has_session_invite"("p_session_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_place_engagement"("p_google_place_id" "text", "p_field" "text", "p_amount" integer DEFAULT 1) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  allowed_fields TEXT[] := ARRAY[
    'total_impressions',
    'total_saves',
    'total_schedules',
    'mingla_review_count',
    'mingla_positive_count',
    'mingla_negative_count'
  ];
BEGIN
  -- Require authenticated user or service role (edge functions call via supabaseAdmin).
  IF auth.role() != 'service_role' AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied: authentication required';
  END IF;

  -- Field whitelist: prevent arbitrary column writes via dynamic SQL
  IF NOT (p_field = ANY(allowed_fields)) THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;

  EXECUTE format(
    'UPDATE public.place_pool SET %I = %I + $1 WHERE google_place_id = $2',
    p_field, p_field
  ) USING p_amount, p_google_place_id;
END;
$_$;


ALTER FUNCTION "public"."increment_place_engagement"("p_google_place_id" "text", "p_field" "text", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_email"("p_email" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(email) = lower(trim(p_email))
      AND status IN ('active', 'invited')
  );
END;
$$;


ALTER FUNCTION "public"."is_admin_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_user"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_email TEXT;
BEGIN
  -- Get the calling user's email from auth.users
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if this email is an active admin
  RETURN EXISTS (
    SELECT 1 FROM admin_users
    WHERE email = v_email
      AND status = 'active'
  );
END;
$$;


ALTER FUNCTION "public"."is_admin_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_blocked_by"("blocker" "uuid", "target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE blocker_id = blocker AND blocked_id = target
  );
$$;


ALTER FUNCTION "public"."is_blocked_by"("blocker" "uuid", "target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_board_collaborator"("board_uuid" "uuid", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_collaborators
    WHERE board_id = board_uuid
      AND user_id = uid
  );
$$;


ALTER FUNCTION "public"."is_board_collaborator"("board_uuid" "uuid", "uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_board_collaborator_as_owner"("board_uuid" "uuid", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_collaborators
    WHERE board_id = board_uuid
      AND user_id = uid
      AND role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_board_collaborator_as_owner"("board_uuid" "uuid", "uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_conversation_participant"("conv_id" "uuid", "u_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = conv_id
    AND user_id = u_id
  );
$$;


ALTER FUNCTION "public"."is_conversation_participant"("conv_id" "uuid", "u_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_message_conversation_participant"("conv_id" "uuid", "u_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conv_id
    AND cp.user_id = u_id
  );
END;
$$;


ALTER FUNCTION "public"."is_message_conversation_participant"("conv_id" "uuid", "u_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_muted_by"("muter" "uuid", "target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM muted_users
    WHERE muter_id = muter AND muted_id = target
  );
$$;


ALTER FUNCTION "public"."is_muted_by"("muter" "uuid", "target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_session_creator"("p_session_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaboration_sessions
    WHERE id = p_session_id
    AND created_by = p_user_id
  );
$$;


ALTER FUNCTION "public"."is_session_creator"("p_session_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_session_participant"("p_session_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id
    AND user_id = p_user_id
  );
$$;


ALTER FUNCTION "public"."is_session_participant"("p_session_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_username_available"("p_username" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) < 3 THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
  );
END;
$$;


ALTER FUNCTION "public"."is_username_available"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jaccard"("a" "text"[], "b" "text"[]) RETURNS double precision
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_intersection INT;
  v_union INT;
BEGIN
  IF (a IS NULL OR array_length(a, 1) IS NULL) AND (b IS NULL OR array_length(b, 1) IS NULL) THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_intersection
    FROM (SELECT unnest(COALESCE(a, '{}')) INTERSECT SELECT unnest(COALESCE(b, '{}'))) x;
  SELECT COUNT(*) INTO v_union
    FROM (SELECT unnest(COALESCE(a, '{}')) UNION SELECT unnest(COALESCE(b, '{}'))) x;
  IF v_union = 0 THEN RETURN 0; END IF;
  RETURN v_intersection::FLOAT / v_union;
END;
$$;


ALTER FUNCTION "public"."jaccard"("a" "text"[], "b" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_presence_offline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.board_participant_presence
  SET is_online = false, last_seen_at = now()
  WHERE session_id = OLD.session_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."mark_presence_offline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pg_map_primary_type_to_mingla_category"("p_primary_type" "text", "p_types" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE
  v_type text;
  v_result text;
BEGIN
  -- Try primary_type first (single match)
  IF p_primary_type IS NOT NULL THEN
    v_result := CASE
      -- Nature & Views (slug 'nature')
      WHEN p_primary_type IN ('beach','botanical_garden','garden','hiking_area','national_park',
                              'nature_preserve','park','scenic_spot','state_park','observation_deck',
                              'tourist_attraction','picnic_ground','vineyard','wildlife_park','wildlife_refuge',
                              'woods','mountain_peak','river','island','city_park','fountain','lake','marina')
        THEN 'nature'
      -- Icebreakers (slug 'icebreakers')
      WHEN p_primary_type IN ('cafe','bowling_alley','coffee_shop','miniature_golf_course','art_gallery',
                              'tea_house','video_arcade','museum','book_store','amusement_center',
                              'bakery','go_karting_venue','cultural_center','dessert_shop','karaoke',
                              'plaza','ice_cream_shop','comedy_club','art_museum','juice_shop',
                              'paintball_center','donut_shop','dance_hall','breakfast_restaurant','brunch_restaurant')
        THEN 'icebreakers'
      -- Drinks & Music (slug 'drinks_and_music')
      WHEN p_primary_type IN ('bar','cocktail_bar','wine_bar','brewery','pub','beer_garden','brewpub',
                              'lounge_bar','night_club','live_music_venue','coffee_roastery','coffee_stand')
        THEN 'drinks_and_music'
      -- Movies & Theatre (slug 'movies_theatre') — combines former 'movies' + 'theatre' helper buckets
      WHEN p_primary_type IN ('movie_theater','drive_in',
                              'performing_arts_theater','opera_house','auditorium','amphitheatre','concert_hall')
        THEN 'movies_theatre'
      -- Brunch, Lunch & Casual (slug 'brunch_lunch_casual') — combines former 'brunch' + 'casual_food' helper buckets
      WHEN p_primary_type IN ('american_restaurant','bistro','gastropub','diner',
                              'mexican_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop',
                              'mediterranean_restaurant','indian_restaurant','chinese_restaurant',
                              'vietnamese_restaurant','korean_restaurant','japanese_restaurant',
                              'lebanese_restaurant','greek_restaurant','italian_restaurant',
                              'ramen_restaurant','noodle_shop','hamburger_restaurant','deli',
                              'barbecue_restaurant','seafood_restaurant','vegan_restaurant',
                              'vegetarian_restaurant','turkish_restaurant','spanish_restaurant',
                              'french_restaurant','sushi_restaurant','buffet_restaurant','food_court',
                              'afghani_restaurant','african_restaurant','asian_restaurant',
                              'brazilian_restaurant','indonesian_restaurant','middle_eastern_restaurant',
                              'hot_pot_restaurant','dim_sum_restaurant','argentinian_restaurant',
                              'basque_restaurant','persian_restaurant','scandinavian_restaurant',
                              'filipino_restaurant','soul_food_restaurant','cuban_restaurant',
                              'hawaiian_restaurant','ethiopian_restaurant','moroccan_restaurant',
                              'peruvian_restaurant','cajun_restaurant','fusion_restaurant',
                              'korean_barbecue_restaurant','tapas_restaurant')
        THEN 'brunch_lunch_casual'
      -- Upscale & Fine Dining (slug 'upscale_fine_dining')
      WHEN p_primary_type IN ('fine_dining_restaurant','steak_house','oyster_bar_restaurant',
                              'fondue_restaurant','swiss_restaurant','european_restaurant',
                              'australian_restaurant','british_restaurant')
        THEN 'upscale_fine_dining'
      -- Creative & Arts (slug 'creative_arts')
      WHEN p_primary_type IN ('art_studio','history_museum','sculpture','cultural_landmark')
        THEN 'creative_arts'
      -- Play (slug 'play')
      WHEN p_primary_type IN ('amusement_park','roller_coaster','water_park','ferris_wheel',
                              'casino','planetarium','golf_course','indoor_golf_course',
                              'adventure_sports_center','ice_skating_rink')
        THEN 'play'
      -- Groceries (slug 'groceries') — MUST come BEFORE 'flowers' since grocery_store + supermarket
      -- belong here per canonical taxonomy. Flowers is florist-only.
      WHEN p_primary_type IN ('grocery_store','supermarket')
        THEN 'groceries'
      -- Flowers (slug 'flowers') — florist ONLY (no grocery absorption)
      WHEN p_primary_type = 'florist'
        THEN 'flowers'
      ELSE NULL
    END;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Fallback: scan types[] in order, return first match.
  -- Recursion safe because depth is bounded by types[] length and IMMUTABLE
  -- marker prevents planner re-entry.
  IF p_types IS NOT NULL THEN
    FOREACH v_type IN ARRAY p_types LOOP
      v_result := public.pg_map_primary_type_to_mingla_category(v_type, NULL);
      IF v_result IS NOT NULL THEN
        RETURN v_result;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."pg_map_primary_type_to_mingla_category"("p_primary_type" "text", "p_types" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pg_map_primary_type_to_mingla_category"("p_primary_type" "text", "p_types" "text"[]) IS 'ORCH-0700 Phase 3B (2026-05-03): Returns Mingla canonical category slug per DISPLAY_TO_SLUG in supabase/functions/_shared/categoryPlaceTypes.ts. Returns NULL when no match (Constitution #9 — never fabricate). Output is always within the canonical 10-slug set: nature, icebreakers, drinks_and_music, brunch_lunch_casual, upscale_fine_dining, movies_theatre, creative_arts, play, flowers, groceries. WARNING: keep in sync with _shared/derivePoolCategory.ts (TS twin) and DISPLAY_TO_SLUG (canonical authority). Future ORCH should auto-generate all three from a single source of truth. Used by admin_place_pool_mv.primary_category derivation + admin RPCs.';



CREATE OR REPLACE FUNCTION "public"."phone_has_used_trial"("p_phone" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.used_trial_phones
    WHERE phone_hash = encode(extensions.digest(p_phone, 'sha256'), 'hex')
  );
END;
$$;


ALTER FUNCTION "public"."phone_has_used_trial"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."query_person_hero_places_by_signal"("p_user_id" "uuid", "p_person_id" "uuid", "p_lat" double precision, "p_lng" double precision, "p_signal_ids" "text"[], "p_exclude_place_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_initial_radius_m" integer DEFAULT 15000, "p_max_radius_m" integer DEFAULT 100000, "p_per_signal_limit" integer DEFAULT 3, "p_total_limit" integer DEFAULT 9) RETURNS TABLE("place" "jsonb", "signal_id" "text", "signal_score" numeric, "total_available" bigint, "distance_m" double precision, "personalization_boost" numeric, "boost_reasons" "text"[])
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- ═══════════════════════════════════════════════════════════════════════
  -- ORCH-0684: pool-only progressive-radius hero RPC with joint-pair
  -- personalization. Three-gate serving preserved verbatim from ORCH-0668.
  -- Personalization is a WHERE-clause-neutral score adjustment — places that
  -- fail the gates never appear, regardless of boost. ORDER BY tiebreaks on
  -- (band_idx ASC, signal_score+boost DESC) so geographic preference still
  -- wins, but within a band the most pair-relevant places rise.
  -- ═══════════════════════════════════════════════════════════════════════
  WITH
  gate_passing AS (
    SELECT
      pp.id AS place_id,
      pp.google_place_id,
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      )) AS distance_m
    FROM public.place_pool pp
    WHERE pp.is_active = true
      AND pp.is_servable = true
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
      AND NOT (pp.id = ANY(p_exclude_place_ids))
  ),
  within_max AS (
    SELECT * FROM gate_passing WHERE distance_m <= p_max_radius_m
  ),
  deduped AS (
    SELECT DISTINCT ON (w.place_id)
      w.place_id,
      w.google_place_id,
      w.distance_m,
      ps.signal_id,
      ps.score AS signal_score
    FROM within_max w
    JOIN public.place_scores ps
      ON ps.place_id = w.place_id
     AND ps.signal_id = ANY(p_signal_ids)
    ORDER BY w.place_id, ps.score DESC
  ),
  -- ─── Personalization layer (D-Q2 Option B) ──────────────────────────
  -- saved_card.experience_id is TEXT and may hold either place_pool.id::TEXT
  -- (post-ORCH-0640) or google_place_id (legacy rows). Match both shapes.
  -- p_user_id is the viewer; p_person_id is the paired user.
  saves AS (
    SELECT
      d.place_id,
      BOOL_OR(sc.profile_id = p_user_id)   AS viewer_saved,
      BOOL_OR(sc.profile_id = p_person_id) AS paired_saved
    FROM deduped d
    LEFT JOIN public.saved_card sc
      ON  sc.profile_id IN (p_user_id, p_person_id)
      AND (sc.experience_id = d.place_id::TEXT
           OR sc.experience_id = d.google_place_id)
    GROUP BY d.place_id
  ),
  visits AS (
    SELECT
      d.place_id,
      BOOL_OR(uv.user_id = p_user_id)   AS viewer_visited,
      BOOL_OR(uv.user_id = p_person_id) AS paired_visited
    FROM deduped d
    LEFT JOIN public.user_visits uv
      ON  uv.user_id IN (p_user_id, p_person_id)
      AND (uv.experience_id = d.place_id::TEXT
           OR uv.experience_id = d.google_place_id)
    GROUP BY d.place_id
  ),
  boosted AS (
    SELECT
      d.place_id,
      d.signal_id,
      d.signal_score,
      d.distance_m,
      -- Boost computation per D-Q2 Option B:
      (CASE
         WHEN COALESCE(s.viewer_saved, false) AND COALESCE(s.paired_saved, false) THEN 0.25
         WHEN COALESCE(s.paired_saved, false) THEN 0.10
         WHEN COALESCE(s.viewer_saved, false) THEN 0.05
         ELSE 0.0
       END
       +
       CASE
         WHEN COALESCE(v.viewer_visited, false) AND COALESCE(v.paired_visited, false) THEN 0.30
         WHEN COALESCE(v.paired_visited, false) THEN 0.10
         WHEN COALESCE(v.viewer_visited, false) THEN 0.05
         ELSE 0.0
       END
      ) AS personalization_boost,
      -- Debug array of which boosts fired (telemetry):
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(s.viewer_saved, false) AND COALESCE(s.paired_saved, false) THEN 'joint_save' END,
        CASE WHEN COALESCE(s.paired_saved, false) AND NOT COALESCE(s.viewer_saved, false) THEN 'paired_save' END,
        CASE WHEN COALESCE(s.viewer_saved, false) AND NOT COALESCE(s.paired_saved, false) THEN 'viewer_save' END,
        CASE WHEN COALESCE(v.viewer_visited, false) AND COALESCE(v.paired_visited, false) THEN 'joint_visit' END,
        CASE WHEN COALESCE(v.paired_visited, false) AND NOT COALESCE(v.viewer_visited, false) THEN 'paired_visit' END,
        CASE WHEN COALESCE(v.viewer_visited, false) AND NOT COALESCE(v.paired_visited, false) THEN 'viewer_visit' END
      ], NULL) AS boost_reasons
    FROM deduped d
    LEFT JOIN saves s  ON s.place_id = d.place_id
    LEFT JOIN visits v ON v.place_id = d.place_id
  ),
  ranked AS (
    SELECT
      b.place_id,
      b.signal_id,
      b.signal_score,
      b.distance_m,
      b.personalization_boost,
      b.boost_reasons,
      CASE
        WHEN b.distance_m <= LEAST(p_initial_radius_m, p_max_radius_m)::DOUBLE PRECISION       THEN 1
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 3) / 2, p_max_radius_m)::DOUBLE PRECISION THEN 2
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 9) / 4, p_max_radius_m)::DOUBLE PRECISION THEN 3
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 27) / 8, p_max_radius_m)::DOUBLE PRECISION THEN 4
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 81) / 16, p_max_radius_m)::DOUBLE PRECISION THEN 5
        ELSE 6
      END AS band_idx,
      COUNT(*) OVER () AS total_count
    FROM boosted b
  ),
  top_n AS (
    SELECT *
    FROM ranked
    ORDER BY band_idx ASC, (signal_score + personalization_boost) DESC
    LIMIT p_total_limit
  )
  SELECT
    to_jsonb(pp.*) AS place,
    t.signal_id,
    t.signal_score,
    t.total_count                AS total_available,
    t.distance_m,
    t.personalization_boost,
    t.boost_reasons
  FROM top_n t
  JOIN public.place_pool pp ON pp.id = t.place_id
  ORDER BY t.band_idx ASC, (t.signal_score + t.personalization_boost) DESC;
$$;


ALTER FUNCTION "public"."query_person_hero_places_by_signal"("p_user_id" "uuid", "p_person_id" "uuid", "p_lat" double precision, "p_lng" double precision, "p_signal_ids" "text"[], "p_exclude_place_ids" "uuid"[], "p_initial_radius_m" integer, "p_max_radius_m" integer, "p_per_signal_limit" integer, "p_total_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."query_person_hero_places_by_signal"("p_user_id" "uuid", "p_person_id" "uuid", "p_lat" double precision, "p_lng" double precision, "p_signal_ids" "text"[], "p_exclude_place_ids" "uuid"[], "p_initial_radius_m" integer, "p_max_radius_m" integer, "p_per_signal_limit" integer, "p_total_limit" integer) IS 'ORCH-0684 (supersedes ORCH-0668): pool-only progressive-radius hero RPC,
   LANGUAGE sql STABLE, with D-Q2 Option B joint-pair-history personalization.
   Enforces I-THREE-GATE-SERVING. Projects distance_m + personalization_boost +
   boost_reasons for telemetry. Boost weights documented inline; tuning is a
   separate ORCH. See specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md.';



CREATE OR REPLACE FUNCTION "public"."query_servable_places_by_signal"("p_signal_id" "text", "p_filter_min" numeric, "p_lat" double precision, "p_lng" double precision, "p_radius_m" double precision, "p_exclude_place_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_limit" integer DEFAULT 20) RETURNS TABLE("place_id" "uuid", "google_place_id" "text", "name" "text", "address" "text", "lat" double precision, "lng" double precision, "rating" numeric, "review_count" integer, "price_level" "text", "price_range_start_cents" integer, "price_range_end_cents" integer, "opening_hours" "jsonb", "website" "text", "photos" "jsonb", "stored_photo_urls" "text"[], "types" "text"[], "primary_type" "text", "signal_score" numeric, "signal_contributions" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    pp.id AS place_id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.lat,
    pp.lng,
    pp.rating,
    pp.review_count,
    pp.price_level,
    pp.price_range_start_cents,
    pp.price_range_end_cents,
    pp.opening_hours,
    pp.website,
    pp.photos,
    pp.stored_photo_urls,
    pp.types,
    pp.primary_type,
    ps.score AS signal_score,
    ps.contributions AS signal_contributions
  FROM public.place_pool pp
  JOIN public.place_scores ps
    ON ps.place_id = pp.id
   AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min
    -- ORCH-0634 G3 photo gate: closes the 9-row leak from places approved by
    -- Bouncer but with __backfill_failed__ photo sentinel. Mirror of legacy
    -- query_pool_cards predicate. Constitution #13 exclusion consistency.
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      ))
    ) <= p_radius_m
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."query_servable_places_by_signal"("p_signal_id" "text", "p_filter_min" numeric, "p_lat" double precision, "p_lng" double precision, "p_radius_m" double precision, "p_exclude_place_ids" "uuid"[], "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."query_servable_places_by_signal"("p_signal_id" "text", "p_filter_min" numeric, "p_lat" double precision, "p_lng" double precision, "p_radius_m" double precision, "p_exclude_place_ids" "uuid"[], "p_limit" integer) IS 'ORCH-0634: signal-scored servable places within radius. Three-gate serving enforced: is_servable + stored_photo_urls (G3 patch 2026-04-22) + signal_score >= filter_min. Used by discover-cards multi-chip fan-out and generate-curated-experiences curated stop fetch.';



CREATE OR REPLACE FUNCTION "public"."recalculate_user_level"("target_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reviews    INTEGER;
  v_saves      INTEGER;
  v_scheduled  INTEGER;
  v_friends    INTEGER;
  v_collabs    INTEGER;
  v_age_days   INTEGER;
  v_xp         NUMERIC(10,2);
  v_level      INTEGER;
BEGIN
  -- Count inputs from authoritative tables
  SELECT count(*) INTO v_reviews FROM place_reviews WHERE user_id = target_user_id;
  SELECT count(*) INTO v_saves FROM saved_card WHERE profile_id = target_user_id;
  SELECT count(*) INTO v_scheduled FROM calendar_entries WHERE user_id = target_user_id;
  SELECT count(*) INTO v_friends FROM friends
    WHERE status = 'accepted' AND deleted_at IS NULL
      AND (user_id = target_user_id OR friend_user_id = target_user_id);
  SELECT count(DISTINCT session_id) INTO v_collabs FROM session_participants
    WHERE user_id = target_user_id AND has_accepted = true;
  SELECT COALESCE(EXTRACT(DAY FROM now() - created_at)::INTEGER, 0) INTO v_age_days
    FROM auth.users WHERE id = target_user_id;

  -- XP formula
  v_xp := (v_reviews * 5.0)
         + (v_saves * 2.0)
         + (v_scheduled * 3.0)
         + (v_friends * 3.0)
         + (v_collabs * 4.0)
         + (LEAST(COALESCE(v_age_days, 0), 365) * 0.1);

  -- Logarithmic level curve
  v_level := GREATEST(1, LEAST(99, FLOOR(10.0 * LN(v_xp + 1)) + 1));

  -- Upsert into user_levels cache
  INSERT INTO user_levels (user_id, level, xp_score, reviews_count, saves_count,
    scheduled_count, friends_count, collabs_count, account_age_days, last_calculated_at)
  VALUES (target_user_id, v_level, v_xp, v_reviews, v_saves, v_scheduled,
    v_friends, v_collabs, COALESCE(v_age_days, 0), now())
  ON CONFLICT (user_id) DO UPDATE SET
    level = v_level,
    xp_score = v_xp,
    reviews_count = v_reviews,
    saves_count = v_saves,
    scheduled_count = v_scheduled,
    friends_count = v_friends,
    collabs_count = v_collabs,
    account_age_days = COALESCE(v_age_days, 0),
    last_calculated_at = now();

  -- Also update the materialized level on leaderboard_presence (if row exists)
  UPDATE leaderboard_presence SET user_level = v_level WHERE user_id = target_user_id;

  RETURN v_level;
END;
$$;


ALTER FUNCTION "public"."recalculate_user_level"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_engagement"("p_event_kind" "text", "p_place_pool_id" "uuid" DEFAULT NULL::"uuid", "p_container_key" "text" DEFAULT NULL::"text", "p_experience_type" "text" DEFAULT NULL::"text", "p_category" "text" DEFAULT NULL::"text", "p_stops" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stop JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_kind NOT IN ('served', 'seen_deck', 'seen_expand', 'saved', 'scheduled', 'reviewed') THEN
    RAISE EXCEPTION 'Invalid event_kind: %', p_event_kind;
  END IF;

  -- Single-card path: one row, place_pool_id set, container_key NULL
  IF p_container_key IS NULL THEN
    IF p_place_pool_id IS NULL THEN
      RAISE EXCEPTION 'record_engagement: single-card event requires place_pool_id';
    END IF;
    INSERT INTO public.engagement_metrics
      (user_id, event_kind, place_pool_id, container_key, experience_type, category, stop_index)
    VALUES
      (auth.uid(), p_event_kind, p_place_pool_id, NULL, NULL, p_category, NULL);
    RETURN;
  END IF;

  -- Curated-card path: 4-way fan-out per DEC-047
  -- (1) Container row: place_pool_id=NULL, container_key set, stop_index NULL
  INSERT INTO public.engagement_metrics
    (user_id, event_kind, place_pool_id, container_key, experience_type, category, stop_index)
  VALUES
    (auth.uid(), p_event_kind, NULL, p_container_key, p_experience_type, p_category, NULL);

  -- (N) Stop rows: both keys set, stop_index set
  IF p_stops IS NOT NULL AND jsonb_array_length(p_stops) > 0 THEN
    FOR v_stop IN SELECT * FROM jsonb_array_elements(p_stops) LOOP
      INSERT INTO public.engagement_metrics
        (user_id, event_kind, place_pool_id, container_key, experience_type, category, stop_index)
      VALUES
        (auth.uid(),
         p_event_kind,
         (v_stop->>'place_pool_id')::UUID,
         p_container_key,
         p_experience_type,
         p_category,
         (v_stop->>'stop_index')::INT);
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."record_engagement"("p_event_kind" "text", "p_place_pool_id" "uuid", "p_container_key" "text", "p_experience_type" "text", "p_category" "text", "p_stops" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_engagement"("p_event_kind" "text", "p_place_pool_id" "uuid", "p_container_key" "text", "p_experience_type" "text", "p_category" "text", "p_stops" "jsonb") IS 'ORCH-0640 (DEC-039, DEC-047, DEC-052): unified engagement write RPC. Single-card path
   writes 1 row keyed on place_pool_id. Curated path fans to N+1 rows (1 container + N stops)
   all sharing container_key (ORCH-0634 cache_key formula:
   sha256(experience_type + '':'' + sorted_stop_place_pool_ids.join('',''))).
   Replaces record_card_swipe + record_card_interaction (both overloads — DROPPED in ch11).';



CREATE OR REPLACE FUNCTION "public"."record_trial_phone"("p_phone" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.used_trial_phones (phone_hash, first_trial_at, last_trial_at, trial_count)
  VALUES (encode(extensions.digest(p_phone, 'sha256'), 'hex'), now(), now(), 1)
  ON CONFLICT (phone_hash) DO UPDATE
  SET last_trial_at = now(),
      trial_count = used_trial_phones.trial_count + 1;
END;
$$;


ALTER FUNCTION "public"."record_trial_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_advisory_lock_rules_run"("p_lock_key" bigint) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT pg_advisory_unlock(p_lock_key);
$$;


ALTER FUNCTION "public"."release_advisory_lock_rules_run"("p_lock_key" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_friend_atomic"("p_friend_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF v_user_id = p_friend_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot unfriend yourself');
  END IF;

  -- Delete both directions atomically
  DELETE FROM public.friends
    WHERE (user_id = v_user_id AND friend_user_id = p_friend_user_id)
       OR (user_id = p_friend_user_id AND friend_user_id = v_user_id);

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."remove_friend_atomic"("p_friend_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb) - p_user_id::text,
    updated_at = NOW()
  WHERE id = p_session_id;
END;
$$;


ALTER FUNCTION "public"."remove_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_user_visibility_by_identifier"("p_identifier" "text") RETURNS TABLE("user_exists" boolean, "can_view" boolean, "is_blocked" boolean, "profile_id" "uuid", "username" "text", "email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  caller_id UUID;
  target_profile RECORD;
BEGIN
  caller_id := auth.uid();

  IF p_identifier IS NULL OR btrim(p_identifier) = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF position('@' in p_identifier) > 0 THEN
    SELECT p.id, p.username, p.email
    INTO target_profile
    FROM public.profiles p
    WHERE lower(p.email) = lower(btrim(p_identifier))
    LIMIT 1;
  ELSE
    SELECT p.id, p.username, p.email
    INTO target_profile
    FROM public.profiles p
    WHERE lower(p.username) = lower(btrim(p_identifier))
    LIMIT 1;
  END IF;

  IF target_profile.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    TRUE AS user_exists,
    (
      target_profile.id = caller_id
      OR NOT EXISTS (
        SELECT 1
        FROM public.blocked_users bu
        WHERE bu.blocker_id = target_profile.id
          AND bu.blocked_id = caller_id
      )
    ) AS can_view,
    EXISTS (
      SELECT 1
      FROM public.blocked_users bu
      WHERE (bu.blocker_id = target_profile.id AND bu.blocked_id = caller_id)
         OR (bu.blocker_id = caller_id AND bu.blocked_id = target_profile.id)
    ) AS is_blocked,
    target_profile.id::UUID,
    target_profile.username::TEXT,
    target_profile.email::TEXT;
END;
$$;


ALTER FUNCTION "public"."resolve_user_visibility_by_identifier"("p_identifier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reveal_pair_requests_on_friend_accept"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
        UPDATE pair_requests
        SET visibility = 'visible', updated_at = now()
        WHERE gated_by_friend_request_id = NEW.id
          AND visibility = 'hidden_until_friend'
          AND status = 'pending';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."reveal_pair_requests_on_friend_accept"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_record_swipe_and_check_match"("p_session_id" "uuid", "p_experience_id" "text", "p_user_id" "uuid", "p_card_data" "jsonb", "p_swipe_direction" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_swipe_state TEXT;
  v_saved_card_id UUID;
  v_card_title TEXT;
  v_matched_user_ids UUID[];
  v_participant_count INTEGER;
BEGIN
  -- ------------------------------------------------------------------------
  -- Auth + participation validation
  -- ------------------------------------------------------------------------
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id
      AND user_id = p_user_id
      AND has_accepted = true
  ) THEN
    RAISE EXCEPTION 'Not a session participant' USING ERRCODE = '42501';
  END IF;

  -- ------------------------------------------------------------------------
  -- Input validation
  -- ------------------------------------------------------------------------
  v_swipe_state := CASE p_swipe_direction
    WHEN 'right' THEN 'swiped_right'
    WHEN 'left'  THEN 'swiped_left'
    ELSE NULL
  END;

  IF v_swipe_state IS NULL THEN
    RAISE EXCEPTION 'Invalid swipe_direction: %', p_swipe_direction
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  IF p_experience_id IS NULL OR p_experience_id = '' THEN
    RAISE EXCEPTION 'experience_id is required' USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------------
  -- Upsert swipe_state (fires check_mutual_like v3 trigger)
  -- ------------------------------------------------------------------------
  INSERT INTO public.board_user_swipe_states (
    session_id, experience_id, user_id, swipe_state, swiped_at, card_data
  ) VALUES (
    p_session_id, p_experience_id, p_user_id, v_swipe_state, NOW(),
    CASE WHEN v_swipe_state = 'swiped_right' THEN p_card_data ELSE NULL END
  )
  ON CONFLICT (session_id, experience_id, user_id)
  DO UPDATE SET
    swipe_state = EXCLUDED.swipe_state,
    swiped_at = EXCLUDED.swiped_at,
    card_data = CASE
      WHEN EXCLUDED.swipe_state = 'swiped_right' THEN EXCLUDED.card_data
      ELSE public.board_user_swipe_states.card_data
    END;

  -- ------------------------------------------------------------------------
  -- Telemetry: record attempt
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_participant_count
  FROM public.session_participants
  WHERE session_id = p_session_id AND has_accepted = true;

  INSERT INTO public.match_telemetry_events (
    event_type, session_id, experience_id, user_id, reason, payload
  ) VALUES (
    'collab_match_attempt', p_session_id, p_experience_id, p_user_id,
    v_swipe_state,
    jsonb_build_object('participant_count', v_participant_count)
  );

  -- ------------------------------------------------------------------------
  -- Left-swipe short-circuit
  -- ------------------------------------------------------------------------
  IF v_swipe_state = 'swiped_left' THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'left_swipe'
    );
  END IF;

  -- ------------------------------------------------------------------------
  -- Check if trigger (which fired synchronously on the INSERT above)
  -- produced a saved_card row.
  -- ------------------------------------------------------------------------
  SELECT id, card_data->>'title'
    INTO v_saved_card_id, v_card_title
  FROM public.board_saved_cards
  WHERE session_id = p_session_id AND experience_id = p_experience_id
  LIMIT 1;

  IF v_saved_card_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'quorum_not_met'
    );
  END IF;

  -- ------------------------------------------------------------------------
  -- Match detected. Collect all right-swipers.
  -- ------------------------------------------------------------------------
  SELECT array_agg(DISTINCT user_id)
    INTO v_matched_user_ids
  FROM public.board_user_swipe_states
  WHERE session_id = p_session_id
    AND experience_id = p_experience_id
    AND swipe_state = 'swiped_right';

  RETURN jsonb_build_object(
    'matched', true,
    'saved_card_id', v_saved_card_id,
    'card_title', COALESCE(v_card_title, 'a spot'),
    'matched_user_ids', v_matched_user_ids,
    'reason', 'promoted'
  );
END;
$$;


ALTER FUNCTION "public"."rpc_record_swipe_and_check_match"("p_session_id" "uuid", "p_experience_id" "text", "p_user_id" "uuid", "p_card_data" "jsonb", "p_swipe_direction" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_record_swipe_and_check_match"("p_session_id" "uuid", "p_experience_id" "text", "p_user_id" "uuid", "p_card_data" "jsonb", "p_swipe_direction" "text") IS 'ORCH-0558: Single atomic entry-point for collab right/left swipes. Upserts swipe_state (which fires check_mutual_like trigger under advisory lock), then returns match result in one server round-trip. Replaces the legacy trackSwipeState + checkForMatch two-query pattern that suffered from column-alignment bugs (see Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md RC-1). Enforces I-CHECK-FOR-MATCH-COLUMN-ALIGNED.';



CREATE OR REPLACE FUNCTION "public"."sync_display_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only recompute if first_name or last_name actually changed
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name) OR
     (NEW.last_name IS DISTINCT FROM OLD.last_name) THEN
    IF NEW.first_name IS NOT NULL AND TRIM(NEW.first_name) != '' THEN
      IF NEW.last_name IS NOT NULL AND TRIM(NEW.last_name) != '' THEN
        NEW.display_name := TRIM(NEW.first_name) || ' ' || TRIM(NEW.last_name);
      ELSE
        NEW.display_name := TRIM(NEW.first_name);
      END IF;
    END IF;
    -- If first_name is null/empty, leave display_name unchanged
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_display_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_message_read_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.messages
  SET is_read = true, read_at = NEW.read_at
  WHERE id = NEW.message_id AND is_read = false;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_message_read_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_photo_aesthetic_labels_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_photo_aesthetic_labels_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_rule_entries_block_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'rule_entries is immutable; create a new version via admin_rules_save instead';
END;
$$;


ALTER FUNCTION "public"."tg_rule_entries_block_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_rule_set_versions_block_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'rule_set_versions is immutable; create a new version via admin_rules_save instead';
END;
$$;


ALTER FUNCTION "public"."tg_rule_set_versions_block_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_signal_anchors_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."tg_signal_anchors_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."truncate_seed_map_presence"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT count(*) INTO row_count FROM public.seed_map_presence;
  TRUNCATE public.seed_map_presence;
  RETURN jsonb_build_object('deleted', row_count);
END;
$$;


ALTER FUNCTION "public"."truncate_seed_map_presence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_advisory_lock_rules_run"("p_lock_key" bigint) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT pg_try_advisory_xact_lock(p_lock_key);
$$;


ALTER FUNCTION "public"."try_advisory_lock_rules_run"("p_lock_key" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."try_advisory_lock_rules_run"("p_lock_key" bigint) IS 'ORCH-0529: edge function calls this at handler entry; returns false if a run is already active for the same (scope, city_id). Auto-released at txn end via pg_try_advisory_xact_lock semantics.';



CREATE OR REPLACE FUNCTION "public"."unpair_atomic"("p_pairing_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_pairing pairings%ROWTYPE;
BEGIN
    -- Lock the pairing row and verify the caller is one of the paired users
    SELECT * INTO v_pairing
    FROM pairings
    WHERE id = p_pairing_id
      AND (user_a_id = auth.uid() OR user_b_id = auth.uid())
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pairing not found or not authorized';
    END IF;

    -- Mark the associated pair_request as 'unpaired'
    -- (must happen BEFORE deleting pairings, because pairings.pair_request_id
    -- has ON DELETE CASCADE from pair_requests — but we want to UPDATE, not delete)
    IF v_pairing.pair_request_id IS NOT NULL THEN
        UPDATE pair_requests
        SET status = 'unpaired', updated_at = now()
        WHERE id = v_pairing.pair_request_id;
    END IF;

    -- Delete the pairing row
    -- CASCADE automatically handles:
    --   custom_holidays.pairing_id → ON DELETE CASCADE
    --   archived_holidays.pairing_id → ON DELETE CASCADE
    DELETE FROM pairings WHERE id = p_pairing_id;

    RETURN json_build_object(
        'success', true,
        'pair_request_id', v_pairing.pair_request_id
    );
END;
$$;


ALTER FUNCTION "public"."unpair_atomic"("p_pairing_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_conversation_on_message"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = now(),
      last_message_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_conversation_on_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_conversation_presence_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_conversation_presence_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_notification_preferences_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_notification_preferences_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profiles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_profiles_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_session_last_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET last_activity_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_session_last_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_preferences_from_interaction"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  category_name TEXT;
  interaction_weight DOUBLE PRECISION;
BEGIN
  -- Extract category from interaction metadata
  category_name := NEW.metadata->>'category';
  
  -- Determine weight based on interaction type
  CASE NEW.interaction_type
    WHEN 'like' THEN interaction_weight := 0.1;
    WHEN 'dislike' THEN interaction_weight := -0.1;
    WHEN 'save' THEN interaction_weight := 0.2;
    WHEN 'view' THEN interaction_weight := 0.05;
    ELSE interaction_weight := 0.0;
  END CASE;
  
  -- Update or insert preference learning record
  IF category_name IS NOT NULL THEN
    INSERT INTO public.user_preference_learning (user_id, category, preference_score, confidence)
    VALUES (NEW.user_id, category_name, 0.5 + interaction_weight, 0.1)
    ON CONFLICT (user_id, category)
    DO UPDATE SET
      preference_score = GREATEST(0.0, LEAST(1.0, user_preference_learning.preference_score + interaction_weight)),
      confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
      last_updated = now();
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_preferences_from_interaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_reports_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_reports_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid", "p_prefs" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Validate caller is an accepted participant
  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_user_id AND has_accepted = true
  ) THEN
    RAISE EXCEPTION 'Not a participant of this session';
  END IF;

  -- Deep merge: existing user prefs || new prefs (new keys win, old keys preserved)
  UPDATE public.collaboration_sessions
  SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb)
    || jsonb_build_object(
      p_user_id::text,
      COALESCE(participant_prefs -> p_user_id::text, '{}'::jsonb) || p_prefs
    ),
    updated_at = NOW()
  WHERE id = p_session_id;
END;
$$;


ALTER FUNCTION "public"."upsert_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid", "p_prefs" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_archive_card_pool" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "card_type" "text" DEFAULT 'single'::"text" NOT NULL,
    "place_pool_id" "uuid",
    "google_place_id" "text",
    "curated_pairing_key" "text",
    "experience_type" "text",
    "stops" "jsonb",
    "tagline" "text",
    "total_price_min" integer,
    "total_price_max" integer,
    "estimated_duration_minutes" integer,
    "title" "text" NOT NULL,
    "category" "text" NOT NULL,
    "categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "description" "text",
    "highlights" "text"[] DEFAULT '{}'::"text"[],
    "image_url" "text",
    "images" "text"[] DEFAULT '{}'::"text"[],
    "address" "text",
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "rating" double precision,
    "review_count" integer DEFAULT 0,
    "price_min" integer DEFAULT 0,
    "price_max" integer DEFAULT 0,
    "opening_hours" "jsonb",
    "base_match_score" double precision DEFAULT 85,
    "popularity_score" double precision DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "served_count" integer DEFAULT 0,
    "last_served_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "website" "text",
    "shopping_list" "jsonb",
    "price_tier" "text" DEFAULT 'comfy'::"text",
    "match_score" real,
    "one_liner" "text",
    "tip" "text",
    "scoring_factors" "jsonb" DEFAULT '{}'::"jsonb",
    "copy_generated_at" timestamp with time zone,
    "teaser_text" "text",
    "city_id" "uuid",
    "city" "text",
    "country" "text",
    "utc_offset_minutes" integer,
    "ai_approved" boolean,
    "ai_reason" "text",
    "ai_categories" "text"[] DEFAULT '{}'::"text"[],
    "original_categories" "text"[] DEFAULT '{}'::"text"[],
    "ai_validated_at" timestamp with time zone,
    "ai_override" boolean,
    "save_count" integer DEFAULT 0 NOT NULL,
    "skip_count" integer DEFAULT 0 NOT NULL,
    "expand_count" integer DEFAULT 0 NOT NULL,
    "visit_count" integer DEFAULT 0 NOT NULL,
    "review_count_local" integer DEFAULT 0 NOT NULL,
    "avg_rating_local" double precision,
    "engagement_score" double precision DEFAULT 0 NOT NULL,
    "price_tiers" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "card_pool_card_type_check" CHECK (("card_type" = ANY (ARRAY['single'::"text", 'curated'::"text"])))
);


ALTER TABLE "public"."_archive_card_pool" OWNER TO "postgres";


COMMENT ON TABLE "public"."_archive_card_pool" IS 'ORCH-0640: archived from card_pool at cutover. 7-day retention per DEC-049.
   Scheduled for DROP in migration 20260502000001.';



COMMENT ON COLUMN "public"."_archive_card_pool"."website" IS 'Venue website or reservation URL from Google Places websiteUri field';



COMMENT ON COLUMN "public"."_archive_card_pool"."price_tier" IS 'Canonical price tier: chill, comfy, bougie, lavish';



COMMENT ON COLUMN "public"."_archive_card_pool"."teaser_text" IS 'AI-generated teaser description for locked curated cards. Does not reveal place names.';



COMMENT ON COLUMN "public"."_archive_card_pool"."utc_offset_minutes" IS 'Propagated from place_pool.utc_offset_minutes at card generation time. Null for cards generated before this field was added.';



CREATE TABLE IF NOT EXISTS "public"."_archive_card_pool_stops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "card_pool_id" "uuid" NOT NULL,
    "place_pool_id" "uuid" NOT NULL,
    "google_place_id" "text" NOT NULL,
    "stop_order" integer NOT NULL,
    "stop_card_pool_id" "uuid",
    CONSTRAINT "card_pool_stops_stop_order_check" CHECK (("stop_order" >= 0))
);


ALTER TABLE "public"."_archive_card_pool_stops" OWNER TO "postgres";


COMMENT ON TABLE "public"."_archive_card_pool_stops" IS 'ORCH-0640: archived from card_pool_stops at cutover. 7-day retention per DEC-049.
   Scheduled for DROP in migration 20260502000001.';



CREATE TABLE IF NOT EXISTS "public"."_archive_orch_0700_doomed_columns" (
    "id" "uuid",
    "seeding_category" "text",
    "ai_categories" "text"[],
    "ai_reason" "text",
    "ai_primary_identity" "text",
    "ai_confidence" real,
    "ai_web_evidence" "text",
    "archived_at" timestamp with time zone,
    "retention_drop_date" "date"
);


ALTER TABLE "public"."_archive_orch_0700_doomed_columns" OWNER TO "postgres";


COMMENT ON TABLE "public"."_archive_orch_0700_doomed_columns" IS 'ORCH-0700 + ORCH-0707 — backup of 6 columns dropped from place_pool 2026-05-03. Retention until 2026-06-02. After that date, operator runs: DROP TABLE public._archive_orch_0700_doomed_columns; See Mingla_Artifacts/specs/SPEC_ORCH-0700_*.md and SPEC_ORCH-0707_*.md.';



CREATE TABLE IF NOT EXISTS "public"."_backup_friends" (
    "id" "uuid",
    "user_id" "uuid",
    "friend_user_id" "uuid",
    "status" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_friends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_messages" (
    "id" "uuid",
    "conversation_id" "uuid",
    "sender_id" "uuid",
    "content" "text",
    "message_type" character varying(20),
    "file_url" "text",
    "file_name" character varying(255),
    "file_size" bigint,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "is_read" boolean,
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_profiles" (
    "id" "uuid",
    "email" "text",
    "display_name" "text",
    "username" "text",
    "first_name" "text",
    "last_name" "text",
    "currency" "text",
    "measurement_system" "text",
    "share_location" boolean,
    "share_budget" boolean,
    "share_categories" boolean,
    "share_date_time" boolean,
    "coach_map_tour_status" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_user_sessions" (
    "id" "uuid",
    "user_id" "uuid",
    "session_type" "text",
    "session_context" "jsonb",
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "interaction_count" integer,
    "is_active" boolean
);


ALTER TABLE "public"."_backup_user_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_orch_0588_dead_cards_backup" (
    "id" "uuid",
    "card_type" "text",
    "place_pool_id" "uuid",
    "google_place_id" "text",
    "curated_pairing_key" "text",
    "experience_type" "text",
    "stops" "jsonb",
    "tagline" "text",
    "total_price_min" integer,
    "total_price_max" integer,
    "estimated_duration_minutes" integer,
    "title" "text",
    "category" "text",
    "categories" "text"[],
    "description" "text",
    "highlights" "text"[],
    "image_url" "text",
    "images" "text"[],
    "address" "text",
    "lat" double precision,
    "lng" double precision,
    "rating" double precision,
    "review_count" integer,
    "price_min" integer,
    "price_max" integer,
    "opening_hours" "jsonb",
    "base_match_score" double precision,
    "popularity_score" double precision,
    "is_active" boolean,
    "served_count" integer,
    "last_served_at" timestamp with time zone,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "website" "text",
    "shopping_list" "jsonb",
    "price_tier" "text",
    "match_score" real,
    "one_liner" "text",
    "tip" "text",
    "scoring_factors" "jsonb",
    "copy_generated_at" timestamp with time zone,
    "teaser_text" "text",
    "city_id" "uuid",
    "city" "text",
    "country" "text",
    "utc_offset_minutes" integer,
    "ai_approved" boolean,
    "ai_reason" "text",
    "ai_categories" "text"[],
    "original_categories" "text"[],
    "ai_validated_at" timestamp with time zone,
    "ai_override" boolean,
    "save_count" integer,
    "skip_count" integer,
    "expand_count" integer,
    "visit_count" integer,
    "review_count_local" integer,
    "avg_rating_local" double precision,
    "engagement_score" double precision,
    "price_tiers" "text"[]
);


ALTER TABLE "public"."_orch_0588_dead_cards_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_orch_0588_dead_stops_backup" (
    "id" "uuid",
    "card_pool_id" "uuid",
    "place_pool_id" "uuid",
    "google_place_id" "text",
    "stop_order" integer,
    "stop_card_pool_id" "uuid"
);


ALTER TABLE "public"."_orch_0588_dead_stops_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_deletion_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scheduled_hard_delete_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "account_deletion_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'cancelled'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."account_deletion_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."account_deletion_requests" IS 'Account deletion pipeline; rows inserted/updated by service role (edge) only (B1 §B.1).';



CREATE TABLE IF NOT EXISTS "public"."activity_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "board_id" "uuid",
    "card_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "action_data" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "activity_history_action_type_check" CHECK (("action_type" = ANY (ARRAY['vote'::"text", 'unvote'::"text", 'finalize'::"text", 'unfinalize'::"text", 'add_card'::"text", 'remove_card'::"text"])))
);


ALTER TABLE "public"."activity_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_email" "text" NOT NULL,
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_backfill_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation_type" "text" NOT NULL,
    "triggered_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "place_ids" "uuid"[],
    "target_category" "text",
    "target_lat" double precision,
    "target_lng" double precision,
    "target_radius_m" integer,
    "total_places" integer DEFAULT 0 NOT NULL,
    "success_count" integer DEFAULT 0 NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "error_details" "jsonb" DEFAULT '[]'::"jsonb",
    "api_calls_made" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" numeric(8,4) DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "admin_backfill_log_operation_type_check" CHECK (("operation_type" = 'place_refresh'::"text")),
    CONSTRAINT "admin_backfill_log_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."admin_backfill_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_backfill_log_archive_orch_0671" (
    "id" "uuid" NOT NULL,
    "operation_type" "text" NOT NULL,
    "triggered_by" "uuid",
    "status" "text" NOT NULL,
    "place_ids" "uuid"[],
    "target_category" "text",
    "target_lat" double precision,
    "target_lng" double precision,
    "target_radius_m" integer,
    "total_places" integer DEFAULT 0 NOT NULL,
    "success_count" integer DEFAULT 0 NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "error_details" "jsonb" DEFAULT '[]'::"jsonb",
    "api_calls_made" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" numeric(8,4) DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archive_reason" "text" NOT NULL
);


ALTER TABLE "public"."admin_backfill_log_archive_orch_0671" OWNER TO "postgres";


COMMENT ON TABLE "public"."admin_backfill_log_archive_orch_0671" IS 'ORCH-0671 archive: historical photo_backfill rows preserved when the standalone Photo Pool admin page was retired.';



CREATE TABLE IF NOT EXISTS "public"."admin_config" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_email_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "from_name" "text",
    "from_email" "text",
    "recipient_type" "text" NOT NULL,
    "recipient_email" "text",
    "segment_filter" "jsonb",
    "recipient_count" integer DEFAULT 0 NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "template_used" "text",
    "sent_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_email_log_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['individual'::"text", 'bulk'::"text"]))),
    CONSTRAINT "admin_email_log_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'partial'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."admin_email_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."place_pool" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "google_place_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_type" "text",
    "rating" double precision,
    "review_count" integer DEFAULT 0,
    "price_level" "text",
    "price_min" integer DEFAULT 0,
    "price_max" integer DEFAULT 0,
    "opening_hours" "jsonb",
    "photos" "jsonb" DEFAULT '[]'::"jsonb",
    "website" "text",
    "raw_google_data" "jsonb",
    "fetched_via" "text" DEFAULT 'nearby_search'::"text",
    "first_fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_detail_refresh" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refresh_failures" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "price_tier" "text",
    "stored_photo_urls" "text"[] DEFAULT '{}'::"text"[],
    "city_id" "uuid",
    "country" "text",
    "city" "text",
    "utc_offset_minutes" integer,
    "editorial_summary" "text",
    "price_tiers" "text"[] DEFAULT '{}'::"text"[],
    "is_claimed" boolean DEFAULT false NOT NULL,
    "claimed_by" "uuid",
    "generative_summary" "text",
    "primary_type_display_name" "text",
    "google_maps_uri" "text",
    "national_phone_number" "text",
    "secondary_opening_hours" "jsonb",
    "reviews" "jsonb",
    "price_range_currency" "text",
    "price_range_start_cents" integer,
    "price_range_end_cents" integer,
    "serves_brunch" boolean,
    "serves_lunch" boolean,
    "serves_dinner" boolean,
    "serves_breakfast" boolean,
    "serves_beer" boolean,
    "serves_wine" boolean,
    "serves_cocktails" boolean,
    "serves_coffee" boolean,
    "serves_dessert" boolean,
    "serves_vegetarian_food" boolean,
    "outdoor_seating" boolean,
    "live_music" boolean,
    "good_for_groups" boolean,
    "good_for_children" boolean,
    "good_for_watching_sports" boolean,
    "allows_dogs" boolean,
    "has_restroom" boolean,
    "reservable" boolean,
    "menu_for_children" boolean,
    "dine_in" boolean,
    "takeout" boolean,
    "delivery" boolean,
    "curbside_pickup" boolean,
    "accessibility_options" "jsonb",
    "parking_options" "jsonb",
    "payment_options" "jsonb",
    "business_status" "text",
    "is_servable" boolean,
    "bouncer_reason" "text",
    "bouncer_validated_at" timestamp with time zone,
    "passes_pre_photo_check" boolean,
    "pre_photo_bouncer_reason" "text",
    "pre_photo_bouncer_validated_at" timestamp with time zone,
    "photo_aesthetic_data" "jsonb",
    "photo_collage_url" "text",
    "photo_collage_fingerprint" "text",
    CONSTRAINT "place_pool_fetched_via_check" CHECK (("fetched_via" = ANY (ARRAY['nearby_search'::"text", 'text_search'::"text", 'detail_refresh'::"text"])))
);


ALTER TABLE "public"."place_pool" OWNER TO "postgres";


COMMENT ON COLUMN "public"."place_pool"."price_tier" IS 'Canonical price tier: chill, comfy, bougie, lavish';



COMMENT ON COLUMN "public"."place_pool"."utc_offset_minutes" IS 'Venue UTC offset in minutes from Google Places API. E.g., EST = -300, GMT = 0, IST = 330. Null for places seeded before this field was added.';



COMMENT ON COLUMN "public"."place_pool"."is_servable" IS 'ORCH-0588 Bouncer v2: deterministic gate. Parallel to ai_approved during Slice 1+. Owned by run-bouncer edge fn only.';



COMMENT ON COLUMN "public"."place_pool"."bouncer_reason" IS 'ORCH-0588: rejection reason in format B<N>:<token>. NULL when is_servable=true. Multi-reason concatenated with ;';



COMMENT ON COLUMN "public"."place_pool"."bouncer_validated_at" IS 'ORCH-0588: timestamp of last run-bouncer pass. NULL = never bouncered.';



COMMENT ON COLUMN "public"."place_pool"."passes_pre_photo_check" IS 'ORCH-0678 — true if place clears all Bouncer rules EXCEPT B8 (stored photos). Set by run-pre-photo-bouncer. NULL = never pre-bounced. Photo backfill gates on this.';



COMMENT ON COLUMN "public"."place_pool"."pre_photo_bouncer_reason" IS 'ORCH-0678 — semicolon-joined rejection reasons from pre-photo pass. NULL when passing.';



COMMENT ON COLUMN "public"."place_pool"."pre_photo_bouncer_validated_at" IS 'ORCH-0678 — timestamp of last pre-photo Bouncer run for this row.';



COMMENT ON COLUMN "public"."place_pool"."photo_aesthetic_data" IS 'ORCH-0708 (Wave 2 Phase 1): structured photo-aesthetic data from Claude vision. Owned EXCLUSIVELY by score-place-photo-aesthetics edge function. Bouncer, signal scorer, admin-seed-places, backfill-place-photos MUST NOT write this column. I-PHOTO-AESTHETIC-DATA-SOLE-OWNER. Schema: { photos_fingerprint: text, scored_at: timestamptz, model: text, model_version: text, per_photo: [...], aggregate: { aesthetic_score, lighting, composition, subject_clarity, primary_subject, vibe_tags[], appropriate_for[], inappropriate_for[], safety_flags[], photo_quality_notes }, cost_usd: numeric }.';



COMMENT ON COLUMN "public"."place_pool"."photo_collage_url" IS 'ORCH-0712 — public URL of composed photo grid for this place (in place-collages bucket). Owned EXCLUSIVELY by run-place-intelligence-trial edge function compose_collage action. admin-seed-places, bouncer, signal scorer MUST NOT write this column. I-COLLAGE-SOLE-OWNER.';



COMMENT ON COLUMN "public"."place_pool"."photo_collage_fingerprint" IS 'ORCH-0712 — sha256 of the source photo URLs that built the cached collage. If photos rotate, fingerprint mismatch triggers re-compose. Owned by run-place-intelligence-trial.';



CREATE TABLE IF NOT EXISTS "public"."seeding_cities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "google_place_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "country" "text" NOT NULL,
    "country_code" "text",
    "center_lat" double precision NOT NULL,
    "center_lng" double precision NOT NULL,
    "coverage_radius_km" double precision DEFAULT 10 NOT NULL,
    "tile_radius_m" integer DEFAULT 1500 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bbox_sw_lat" double precision NOT NULL,
    "bbox_sw_lng" double precision NOT NULL,
    "bbox_ne_lat" double precision NOT NULL,
    "bbox_ne_lng" double precision NOT NULL,
    CONSTRAINT "seeding_cities_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'seeding'::"text", 'seeded'::"text", 'launched'::"text"])))
);


ALTER TABLE "public"."seeding_cities" OWNER TO "postgres";


COMMENT ON COLUMN "public"."seeding_cities"."coverage_radius_km" IS 'DEPRECATED: replaced by bbox_sw/ne columns. Retained for rollback.';



CREATE MATERIALIZED VIEW "public"."admin_place_pool_mv" AS
 SELECT "pp"."id",
    "pp"."google_place_id",
    "pp"."name",
    "pp"."city_id",
    "sc"."country_code",
    "sc"."country" AS "country_name",
    "sc"."name" AS "city_name",
    "sc"."status" AS "city_status",
    "pp"."country" AS "pp_country",
    "pp"."city" AS "pp_city",
    COALESCE("public"."pg_map_primary_type_to_mingla_category"("pp"."primary_type", "pp"."types"), 'uncategorized'::"text") AS "primary_category",
    "pp"."types",
    "pp"."primary_type",
    "pp"."rating",
    "pp"."review_count",
    "pp"."price_level",
    "pp"."is_active",
    "pp"."is_servable",
    "pp"."bouncer_validated_at",
    "pp"."bouncer_reason",
    ("pp"."bouncer_validated_at" IS NOT NULL) AS "bouncer_validated",
    "pp"."stored_photo_urls",
    (("pp"."stored_photo_urls" IS NOT NULL) AND ("array_length"("pp"."stored_photo_urls", 1) > 0) AND ("pp"."stored_photo_urls" <> ARRAY['__backfill_failed__'::"text"])) AS "has_photos",
    COALESCE("array_length"("pp"."stored_photo_urls", 1), 0) AS "photo_count",
    "pp"."photos",
    (("pp"."photos" IS NOT NULL) AND ("pp"."photos" <> '[]'::"jsonb")) AS "has_photo_refs",
    "pp"."last_detail_refresh",
    "pp"."updated_at",
    "pp"."created_at",
    ("pp"."claimed_by" IS NOT NULL) AS "is_claimed"
   FROM ("public"."place_pool" "pp"
     LEFT JOIN "public"."seeding_cities" "sc" ON (("pp"."city_id" = "sc"."id")))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."admin_place_pool_mv" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_subscription_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tier" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "granted_by" "uuid",
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_subscription_overrides_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'mingla_plus'::"text"])))
);


ALTER TABLE "public"."admin_subscription_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'admin'::"text",
    "status" "text" DEFAULT 'invited'::"text",
    "invited_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    CONSTRAINT "admin_users_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))),
    CONSTRAINT "admin_users_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'invited'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "config_key" "text" NOT NULL,
    "config_value" "text" DEFAULT ''::"text" NOT NULL,
    "value_type" "text" DEFAULT 'string'::"text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_config_value_type_check" CHECK (("value_type" = ANY (ARRAY['string'::"text", 'number'::"text", 'boolean'::"text", 'json'::"text"])))
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "rating" integer,
    "message" "text",
    "category" "text",
    "platform" "text" DEFAULT 'mobile'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "screenshot_url" "text",
    CONSTRAINT "app_feedback_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."app_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appsflyer_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "appsflyer_uid" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "app_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "appsflyer_devices_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text"])))
);


ALTER TABLE "public"."appsflyer_devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."archived_holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "holiday_key" "text" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pairing_id" "uuid",
    "paired_user_id" "uuid",
    CONSTRAINT "chk_archived_holidays_person_or_pairing" CHECK ((("person_id" IS NOT NULL) OR ("pairing_id" IS NOT NULL)))
);


ALTER TABLE "public"."archived_holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "brand_id" "uuid",
    "event_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "before" "jsonb",
    "after" "jsonb",
    "ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_action_nonempty" CHECK (("length"(TRIM(BOTH FROM "action")) > 0)),
    CONSTRAINT "audit_log_target_type_nonempty" CHECK (("length"(TRIM(BOTH FROM "target_type")) > 0))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. (B1.5 — ORCH-0706 SF-4)';



CREATE TABLE IF NOT EXISTS "public"."beta_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "category" "text" NOT NULL,
    "audio_path" "text" NOT NULL,
    "audio_url" "text",
    "audio_duration_ms" integer NOT NULL,
    "user_display_name" "text",
    "user_email" "text",
    "user_phone" "text",
    "device_os" "text" NOT NULL,
    "device_os_version" "text",
    "device_model" "text",
    "app_version" "text" NOT NULL,
    "screen_before" "text",
    "session_duration_ms" integer,
    "latitude" double precision,
    "longitude" double precision,
    "admin_notes" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "screenshot_paths" "text"[],
    "screenshot_urls" "text"[],
    CONSTRAINT "beta_feedback_category_check" CHECK (("category" = ANY (ARRAY['bug'::"text", 'feature_request'::"text", 'ux_issue'::"text", 'general'::"text"]))),
    CONSTRAINT "beta_feedback_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'reviewed'::"text", 'actioned'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."beta_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "no_self_block" CHECK (("blocker_id" <> "blocked_id"))
);


ALTER TABLE "public"."blocked_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_card_message_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."board_card_message_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_card_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "saved_card_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "content" "text" NOT NULL,
    "mentions" "jsonb" DEFAULT '[]'::"jsonb",
    "reply_to_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."board_card_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_card_rsvps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "saved_card_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rsvp_status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "board_card_rsvps_rsvp_status_check" CHECK (("rsvp_status" = ANY (ARRAY['attending'::"text", 'not_attending'::"text"])))
);


ALTER TABLE "public"."board_card_rsvps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "board_id" "uuid" NOT NULL,
    "saved_experience_id" "uuid" NOT NULL,
    "added_by" "uuid",
    "added_at" timestamp with time zone DEFAULT "now"(),
    "finalized_at" timestamp with time zone
);


ALTER TABLE "public"."board_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_collaborators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "board_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'collaborator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "board_collaborators_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'collaborator'::"text"])))
);


ALTER TABLE "public"."board_collaborators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_message_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."board_message_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_message_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."board_message_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "content" "text" NOT NULL,
    "mentions" "jsonb" DEFAULT '[]'::"jsonb",
    "reply_to_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "image_url" "text"
);


ALTER TABLE "public"."board_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_participant_presence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_online" boolean DEFAULT false,
    "last_seen_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."board_participant_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_saved_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "experience_id" "text" NOT NULL,
    "saved_experience_id" "uuid",
    "card_data" "jsonb" NOT NULL,
    "saved_by" "uuid" NOT NULL,
    "saved_at" timestamp with time zone DEFAULT "now"(),
    "is_locked" boolean DEFAULT false NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by_consensus" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."board_saved_cards" OWNER TO "postgres";


COMMENT ON COLUMN "public"."board_saved_cards"."experience_id" IS 'ORCH-0558: Google Place ID / experience identifier. MUST be non-NULL. Match detection in check_mutual_like trigger and rpc_record_swipe_and_check_match both rely on this column. Historical NULLs cleaned up in migration 20260421000001. Never write NULL — service-role included.';



CREATE TABLE IF NOT EXISTS "public"."board_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "board_id" "uuid" NOT NULL,
    "card_id" "uuid",
    "user_id" "uuid",
    "content" "text" NOT NULL,
    "parent_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."board_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_typing_indicators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "saved_card_id" "uuid",
    "is_typing" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."board_typing_indicators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."board_user_swipe_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "experience_id" "text",
    "saved_experience_id" "uuid",
    "swipe_state" "text" NOT NULL,
    "swiped_at" timestamp with time zone DEFAULT "now"(),
    "card_data" "jsonb",
    CONSTRAINT "board_user_swipe_states_swipe_state_check" CHECK (("swipe_state" = ANY (ARRAY['not_seen'::"text", 'swiped_left'::"text", 'swiped_right'::"text"])))
);


ALTER TABLE "public"."board_user_swipe_states" OWNER TO "postgres";


COMMENT ON COLUMN "public"."board_user_swipe_states"."card_data" IS 'ORCH-0556: Card JSONB payload captured at swipe time. Read by the check_mutual_like trigger to populate board_saved_cards.card_data when quorum is reached. Nullable for historical rows + left-swipe rows (which never promote to saved_cards).';



CREATE TABLE IF NOT EXISTS "public"."board_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "board_id" "uuid",
    "card_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "vote_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "saved_card_id" "uuid",
    "session_id" "uuid",
    CONSTRAINT "board_votes_board_session_check" CHECK (((("board_id" IS NOT NULL) AND ("session_id" IS NULL)) OR (("board_id" IS NULL) AND ("session_id" IS NOT NULL)))),
    CONSTRAINT "board_votes_card_check" CHECK (((("card_id" IS NOT NULL) AND ("saved_card_id" IS NULL)) OR (("card_id" IS NULL) AND ("saved_card_id" IS NOT NULL)))),
    CONSTRAINT "board_votes_vote_type_check" CHECK (("vote_type" = ANY (ARRAY['up'::"text", 'down'::"text", 'neutral'::"text"])))
);


ALTER TABLE "public"."board_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    "is_public" boolean DEFAULT false,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "archived_at" timestamp with time zone
);


ALTER TABLE "public"."boards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "brand_invitations_email_nonempty" CHECK (("length"(TRIM(BOTH FROM "email")) > 0)),
    CONSTRAINT "brand_invitations_role_check" CHECK (("role" = ANY (ARRAY['account_owner'::"text", 'brand_admin'::"text", 'event_manager'::"text", 'finance_manager'::"text", 'marketing_manager'::"text", 'scanner'::"text"]))),
    CONSTRAINT "brand_invitations_token_nonempty" CHECK (("length"(TRIM(BOTH FROM "token")) > 0))
);


ALTER TABLE "public"."brand_invitations" OWNER TO "postgres";


COMMENT ON TABLE "public"."brand_invitations" IS 'Pending brand team invites (B1 §B.2).';



CREATE TABLE IF NOT EXISTS "public"."brand_team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "removed_at" timestamp with time zone,
    "permissions_override" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "brand_team_members_accepted_removed_excl" CHECK ((("removed_at" IS NULL) OR ("accepted_at" IS NOT NULL))),
    CONSTRAINT "brand_team_members_role_check" CHECK (("role" = ANY (ARRAY['account_owner'::"text", 'brand_admin'::"text", 'event_manager'::"text", 'finance_manager'::"text", 'marketing_manager'::"text", 'scanner'::"text"])))
);


ALTER TABLE "public"."brand_team_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."brand_team_members" IS 'Brand membership and roles (B1 §B.2).';



CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "profile_photo_url" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "social_links" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "custom_links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "display_attendee_count" boolean DEFAULT true NOT NULL,
    "tax_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_currency" character(3) DEFAULT 'GBP'::"bpchar" NOT NULL,
    "stripe_connect_id" "text",
    "stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
    "stripe_charges_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "brands_slug_nonempty" CHECK (("length"(TRIM(BOTH FROM "slug")) > 0))
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


COMMENT ON TABLE "public"."brands" IS 'Mingla Business organiser brand (B1 §B.2).';



CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "slug" "text" NOT NULL,
    "location_text" "text",
    "location_geo" "point",
    "online_url" "text",
    "is_online" boolean DEFAULT false NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "is_multi_date" boolean DEFAULT false NOT NULL,
    "recurrence_rules" "jsonb",
    "cover_media_url" "text",
    "cover_media_type" "text",
    "theme" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "organiser_contact" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "visibility" "text" DEFAULT 'draft'::"text" NOT NULL,
    "show_on_discover" boolean DEFAULT false NOT NULL,
    "show_in_swipeable_deck" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "events_cover_media_type_check" CHECK ((("cover_media_type" IS NULL) OR ("cover_media_type" = ANY (ARRAY['image'::"text", 'video'::"text", 'gif'::"text"])))),
    CONSTRAINT "events_slug_nonempty" CHECK (("length"(TRIM(BOTH FROM "slug")) > 0)),
    CONSTRAINT "events_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'live'::"text", 'ended'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "events_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'discover'::"text", 'private'::"text", 'hidden'::"text", 'draft'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON TABLE "public"."events" IS 'Mingla Business event (B1 §B.3). Not consumer experiences.';



CREATE OR REPLACE VIEW "public"."brands_public_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "account_id",
    "name",
    "slug",
    "description",
    "profile_photo_url",
    "contact_email",
    "contact_phone",
    "social_links",
    "custom_links",
    "display_attendee_count",
    "default_currency",
    "created_at",
    "updated_at"
   FROM "public"."brands" "b"
  WHERE (("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."events" "e"
          WHERE (("e"."brand_id" = "b"."id") AND ("e"."deleted_at" IS NULL) AND ("e"."visibility" = 'public'::"text") AND ("e"."status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))))));


ALTER VIEW "public"."brands_public_view" OWNER TO "postgres";


COMMENT ON VIEW "public"."brands_public_view" IS 'Brands with at least one public live event (B1 §B.8); same RLS as base table.';



CREATE TABLE IF NOT EXISTS "public"."calendar_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "card_id" "text",
    "board_card_id" "uuid",
    "source" "text" DEFAULT 'solo'::"text" NOT NULL,
    "card_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "duration_minutes" integer,
    "purchase_option_id" "uuid",
    "price_paid" numeric(10,2),
    "qr_code" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "archived_at" timestamp with time zone,
    "feedback_status" "text",
    "review_id" "uuid",
    "device_calendar_event_id" "text",
    CONSTRAINT "calendar_entries_feedback_status_check" CHECK ((("feedback_status" IS NULL) OR ("feedback_status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'skipped'::"text", 'rescheduled'::"text"])))),
    CONSTRAINT "calendar_entries_source_check" CHECK (("source" = ANY (ARRAY['solo'::"text", 'collaboration'::"text"]))),
    CONSTRAINT "calendar_entries_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."calendar_entries" OWNER TO "postgres";


COMMENT ON COLUMN "public"."calendar_entries"."device_calendar_event_id" IS 'expo-calendar event ID from Calendar.createEventAsync(). Used for direct update/delete.';



CREATE TABLE IF NOT EXISTS "public"."card_generation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city" "text" NOT NULL,
    "country" "text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "total_categories" integer DEFAULT 0 NOT NULL,
    "completed_categories" integer DEFAULT 0 NOT NULL,
    "current_category" "text",
    "total_created" integer DEFAULT 0 NOT NULL,
    "total_skipped" integer DEFAULT 0 NOT NULL,
    "skipped_no_photos" integer DEFAULT 0 NOT NULL,
    "skipped_duplicate" integer DEFAULT 0 NOT NULL,
    "skipped_child_venue" integer DEFAULT 0 NOT NULL,
    "total_eligible" integer DEFAULT 0 NOT NULL,
    "category_results" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "triggered_by" "text",
    CONSTRAINT "card_generation_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."card_generation_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_type_exclusions" (
    "category_slug" "text" NOT NULL,
    "excluded_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."category_type_exclusions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."collaboration_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "inviter_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "invite_method" "text" DEFAULT 'friends_list'::"text",
    "expires_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "invited_user_id" "uuid",
    "pending_friendship" boolean DEFAULT false NOT NULL,
    CONSTRAINT "collaboration_invites_invite_method_check" CHECK (("invite_method" = ANY (ARRAY['friends_list'::"text", 'link'::"text", 'qr_code'::"text", 'invite_code'::"text"])))
);

ALTER TABLE ONLY "public"."collaboration_invites" REPLICA IDENTITY FULL;


ALTER TABLE "public"."collaboration_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."collaboration_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "session_type" "text" DEFAULT 'group_hangout'::"text",
    "board_id" "uuid",
    "invite_code" "text",
    "invite_link" "text",
    "max_participants" integer DEFAULT 15,
    "is_active" boolean DEFAULT true,
    "last_activity_at" timestamp with time zone DEFAULT "now"(),
    "archived_at" timestamp with time zone,
    "participant_prefs" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "collaboration_sessions_session_type_check" CHECK (("session_type" = ANY (ARRAY['group_hangout'::"text", 'date_night'::"text", 'squad_outing'::"text", 'business_meeting'::"text", 'board'::"text", 'collaboration'::"text"]))),
    CONSTRAINT "collaboration_sessions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'voting'::"text", 'locked'::"text", 'completed'::"text", 'archived'::"text", 'dormant'::"text"])))
);

ALTER TABLE ONLY "public"."collaboration_sessions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."collaboration_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."collaboration_sessions"."status" IS 'Session status: pending (initial state until at least 1 participant accepts), active (at least 1 accepted), archived (completed)';



CREATE TABLE IF NOT EXISTS "public"."conversation_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "last_read_at" timestamp with time zone
);


ALTER TABLE "public"."conversation_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_presence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_online" boolean DEFAULT false NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" character varying(20) DEFAULT 'direct'::character varying,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_message_at" timestamp with time zone,
    CONSTRAINT "conversations_type_check" CHECK ((("type")::"text" = ANY ((ARRAY['direct'::character varying, 'group'::character varying])::"text"[])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."creator_accounts" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "display_name" "text",
    "avatar_url" "text",
    "business_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone_e164" "text",
    "marketing_opt_in" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "default_brand_id" "uuid"
);


ALTER TABLE "public"."creator_accounts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."creator_accounts"."phone_e164" IS 'E.164 phone for organiser contact (B1).';



COMMENT ON COLUMN "public"."creator_accounts"."marketing_opt_in" IS 'Marketing opt-in (B1).';



COMMENT ON COLUMN "public"."creator_accounts"."deleted_at" IS 'Soft-delete timestamp for creator account (B1).';



COMMENT ON COLUMN "public"."creator_accounts"."default_brand_id" IS 'Optional default brand for UI (B1 §B.1).';



CREATE TABLE IF NOT EXISTS "public"."curated_places_cache" (
    "location_key" "text" NOT NULL,
    "radius_m" integer NOT NULL,
    "category_places" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."curated_places_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."curated_teaser_cache" (
    "cache_key" "text" NOT NULL,
    "experience_type" "text" NOT NULL,
    "stop_place_pool_ids" "uuid"[] NOT NULL,
    "one_liner" "text" NOT NULL,
    "tip" "text",
    "shopping_list" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_served_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "serve_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "curated_teaser_cache_key_len" CHECK (("length"("cache_key") = 64)),
    CONSTRAINT "curated_teaser_cache_stops_nonempty" CHECK (("array_length"("stop_place_pool_ids", 1) > 0))
);


ALTER TABLE "public"."curated_teaser_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."curated_teaser_cache" IS 'ORCH-0634: GPT teaser cache for curated cards. Keyed by sha256(experience_type + '':'' + sorted_stop_place_pool_ids.join('','')). Stop combo fingerprint — same combination returns cached teaser without re-calling GPT. Reused by ORCH-0640 engagement_metrics.container_key.';



COMMENT ON COLUMN "public"."curated_teaser_cache"."cache_key" IS 'sha256 hex digest of: lower(experience_type) + '':'' + sorted(stop_place_pool_ids).join(''''). IMMUTABLE formula post-cutover (ORCH-0640 contract).';



CREATE TABLE IF NOT EXISTS "public"."custom_holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "name" "text" NOT NULL,
    "month" integer NOT NULL,
    "day" integer NOT NULL,
    "description" "text",
    "categories" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "year" integer DEFAULT (EXTRACT(year FROM "now"()))::integer NOT NULL,
    "pairing_id" "uuid",
    "paired_user_id" "uuid",
    CONSTRAINT "chk_custom_holidays_person_or_pairing" CHECK ((("person_id" IS NOT NULL) OR ("pairing_id" IS NOT NULL))),
    CONSTRAINT "custom_holidays_day_check" CHECK ((("day" >= 1) AND ("day" <= 31))),
    CONSTRAINT "custom_holidays_month_check" CHECK ((("month" >= 1) AND ("month" <= 12))),
    CONSTRAINT "custom_holidays_year_check" CHECK ((("year" >= 1900) AND ("year" <= 2100)))
);


ALTER TABLE "public"."custom_holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."direct_message_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."direct_message_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discover_daily_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "us_date_key" "date" NOT NULL,
    "cards" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "featured_card" "jsonb",
    "generated_location" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval),
    "previous_batch_place_ids" "text"[] DEFAULT '{}'::"text"[],
    "all_place_ids" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."discover_daily_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."door_sales_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "scanner_user_id" "uuid",
    "payment_method" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" character(3) DEFAULT 'GBP'::"bpchar" NOT NULL,
    "reconciled" boolean DEFAULT false NOT NULL,
    "reconciled_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "door_sales_ledger_amount_non_negative" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "door_sales_ledger_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'card_reader'::"text", 'nfc'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."door_sales_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."door_sales_ledger" IS 'Append-only style door sales ledger (B1 §B.6).';



CREATE TABLE IF NOT EXISTS "public"."email_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "placeholders" "text"[] DEFAULT ARRAY['name'::"text"],
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."engagement_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "event_kind" "text" NOT NULL,
    "place_pool_id" "uuid",
    "container_key" "text",
    "experience_type" "text",
    "category" "text",
    "stop_index" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "engagement_metrics_event_kind_check" CHECK (("event_kind" = ANY (ARRAY['served'::"text", 'seen_deck'::"text", 'seen_expand'::"text", 'saved'::"text", 'scheduled'::"text", 'reviewed'::"text"]))),
    CONSTRAINT "engagement_metrics_identity_ck" CHECK ((("container_key" IS NOT NULL) OR ("place_pool_id" IS NOT NULL)))
);


ALTER TABLE "public"."engagement_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."engagement_metrics" IS 'ORCH-0640 (DEC-039, DEC-047, DEC-052): place-level engagement tracking with dual-key schema.
   Single-card events set place_pool_id only. Curated-stop events set both place_pool_id
   and container_key (+ stop_index). Curated-container events set container_key only.
   Every curated interaction fans out to 4 rows: 1 container + 3 stops via record_engagement RPC.';



CREATE TABLE IF NOT EXISTS "public"."event_dates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "is_master" boolean DEFAULT false NOT NULL,
    "override_title" "text",
    "override_description" "text",
    "override_location" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_dates_end_after_start" CHECK (("end_at" > "start_at"))
);


ALTER TABLE "public"."event_dates" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_dates" IS 'Per-date rows for multi-date / recurring events (B1 §B.3).';



CREATE TABLE IF NOT EXISTS "public"."event_scanners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permissions" "jsonb" DEFAULT '{"scan": true, "take_payments": false}'::"jsonb" NOT NULL,
    "assigned_by" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "removed_at" timestamp with time zone
);


ALTER TABLE "public"."event_scanners" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_scanners" IS 'Scanner role assignments per event (B1 §B.5).';



CREATE OR REPLACE VIEW "public"."events_public_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "brand_id",
    "title",
    "description",
    "slug",
    "location_text",
    "location_geo",
    "online_url",
    "is_online",
    "is_recurring",
    "is_multi_date",
    "recurrence_rules",
    "cover_media_url",
    "cover_media_type",
    "theme",
    "organiser_contact",
    "visibility",
    "show_on_discover",
    "show_in_swipeable_deck",
    "status",
    "published_at",
    "timezone",
    "created_at",
    "updated_at"
   FROM "public"."events"
  WHERE (("deleted_at" IS NULL) AND ("visibility" = 'public'::"text") AND ("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"])));


ALTER VIEW "public"."events_public_view" OWNER TO "postgres";


COMMENT ON VIEW "public"."events_public_view" IS 'Public published events (B1 §B.8); RLS allows anon + authenticated for published rows.';



CREATE TABLE IF NOT EXISTS "public"."experience_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "card_id" "text" NOT NULL,
    "experience_title" "text",
    "rating" integer NOT NULL,
    "feedback_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "experience_feedback_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."experience_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "flag_key" "text" NOT NULL,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friend_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source" "text" DEFAULT 'app'::"text" NOT NULL,
    CONSTRAINT "friend_requests_source_check" CHECK (("source" = ANY (ARRAY['app'::"text", 'map'::"text", 'onboarding'::"text", 'session'::"text"]))),
    CONSTRAINT "friend_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."friend_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "friend_user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "friends_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'pending'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."friends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "is_enabled" boolean DEFAULT true NOT NULL,
    "api_key_preview" "text",
    "config_data" "jsonb" DEFAULT '{}'::"jsonb",
    "last_checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leaderboard_presence" (
    "user_id" "uuid" NOT NULL,
    "is_discoverable" boolean DEFAULT false NOT NULL,
    "visibility_level" "text" DEFAULT 'friends'::"text" NOT NULL,
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "activity_status" "text",
    "preference_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "last_swiped_category" "text",
    "available_seats" integer DEFAULT 1 NOT NULL,
    "active_collab_session_id" "uuid",
    "swipe_count" integer DEFAULT 0 NOT NULL,
    "session_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_swipe_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_level" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leaderboard_presence_available_seats_check" CHECK ((("available_seats" >= 0) AND ("available_seats" <= 99))),
    CONSTRAINT "leaderboard_presence_user_level_check" CHECK ((("user_level" >= 1) AND ("user_level" <= 99))),
    CONSTRAINT "leaderboard_presence_visibility_level_check" CHECK (("visibility_level" = ANY (ARRAY['off'::"text", 'paired'::"text", 'friends'::"text", 'friends_of_friends'::"text", 'everyone'::"text"])))
);


ALTER TABLE "public"."leaderboard_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_telemetry_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "experience_id" "text" NOT NULL,
    "user_id" "uuid",
    "saved_card_id" "uuid",
    "reason" "text",
    "quorum_count" integer,
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "match_telemetry_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['collab_match_attempt'::"text", 'collab_match_promotion_success'::"text", 'collab_match_promotion_skipped'::"text", 'collab_match_notification_delivered'::"text", 'collab_match_notification_failed'::"text"])))
);


ALTER TABLE "public"."match_telemetry_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."match_telemetry_events" IS 'ORCH-0558: Per-event log of collab match lifecycle. Written by check_mutual_like trigger, rpc_record_swipe_and_check_match RPC, and notify-session-match edge fn. Consumed by admin dashboard + Sentry alerts on reason=error. Retention: 30 days rolling via pg_cron.';



CREATE TABLE IF NOT EXISTS "public"."message_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."message_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid",
    "content" "text" NOT NULL,
    "message_type" character varying(20) DEFAULT 'text'::character varying,
    "file_url" "text",
    "file_name" character varying(255),
    "file_size" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "is_read" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "reply_to_id" "uuid",
    "card_payload" "jsonb",
    CONSTRAINT "messages_card_requires_payload" CHECK (((("message_type")::"text" <> 'card'::"text") OR ("card_payload" IS NOT NULL))),
    CONSTRAINT "messages_message_type_check" CHECK ((("message_type")::"text" = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'file'::character varying, 'card'::character varying])::"text"[])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."messages"."card_payload" IS 'ORCH-0667: Snapshot of shared card data when message_type=card. Trimmed schema per spec §6 to stay <5KB. Snapshot (not reference) so the bubble survives the place being removed from the pool (cross-ref ORCH-0659.D-1 backfill lesson — distance is user-relative and place-pool churn is non-trivial).';



CREATE TABLE IF NOT EXISTS "public"."muted_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "muter_id" "uuid" NOT NULL,
    "muted_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "no_self_mute" CHECK (("muter_id" <> "muted_id"))
);


ALTER TABLE "public"."muted_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "push_enabled" boolean DEFAULT true NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "friend_requests" boolean DEFAULT true NOT NULL,
    "link_requests" boolean DEFAULT true NOT NULL,
    "messages" boolean DEFAULT true NOT NULL,
    "collaboration_invites" boolean DEFAULT true NOT NULL,
    "marketing" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dm_bypass_quiet_hours" boolean DEFAULT false NOT NULL,
    "reminders" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "actor_id" "uuid",
    "related_id" "text",
    "related_type" "text",
    "is_read" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "push_sent" boolean DEFAULT false NOT NULL,
    "push_sent_at" timestamp with time zone,
    "push_clicked" boolean DEFAULT false NOT NULL,
    "push_clicked_at" timestamp with time zone,
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "ticket_type_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price_cents" integer DEFAULT 0 NOT NULL,
    "total_cents" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "order_line_items_prices_non_negative" CHECK ((("unit_price_cents" >= 0) AND ("total_cents" >= 0))),
    CONSTRAINT "order_line_items_qty_positive" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."order_line_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."order_line_items" IS 'Line items for an order (B1 §B.4).';



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "buyer_user_id" "uuid",
    "buyer_email" "text",
    "buyer_name" "text",
    "buyer_phone" "text",
    "total_cents" integer DEFAULT 0 NOT NULL,
    "currency" character(3) DEFAULT 'GBP'::"bpchar" NOT NULL,
    "payment_method" "text" DEFAULT 'online_card'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "stripe_payment_intent_id" "text",
    "stripe_charge_id" "text",
    "is_door_sale" boolean DEFAULT false NOT NULL,
    "created_by_scanner_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "orders_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['online_card'::"text", 'nfc'::"text", 'card_reader'::"text", 'cash'::"text", 'manual'::"text"]))),
    CONSTRAINT "orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text", 'partial_refund'::"text"]))),
    CONSTRAINT "orders_total_non_negative" CHECK (("total_cents" >= 0))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON TABLE "public"."orders" IS 'Ticket / door orders (B1 §B.4).';



COMMENT ON COLUMN "public"."orders"."created_by_scanner_id" IS 'Scanner auth user who recorded a door sale (B1); FK to auth.users below.';



CREATE OR REPLACE VIEW "public"."organisers_public_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "display_name",
    "avatar_url",
    "business_name",
    "created_at"
   FROM "public"."creator_accounts" "ca"
  WHERE (("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."brands" "b"
          WHERE (("b"."account_id" = "ca"."id") AND ("b"."deleted_at" IS NULL) AND (EXISTS ( SELECT 1
                   FROM "public"."events" "e"
                  WHERE (("e"."brand_id" = "b"."id") AND ("e"."deleted_at" IS NULL) AND ("e"."visibility" = 'public'::"text") AND ("e"."status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"])))))))));


ALTER VIEW "public"."organisers_public_view" OWNER TO "postgres";


COMMENT ON VIEW "public"."organisers_public_view" IS 'Organisers with a published public event; explicit filter + RLS (avoids “own row” widening).';



CREATE TABLE IF NOT EXISTS "public"."pair_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "visibility" "text" DEFAULT 'visible'::"text" NOT NULL,
    "gated_by_friend_request_id" "uuid",
    "pending_display_name" "text",
    "pending_phone_e164" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pair_requests_no_self_pair" CHECK (("sender_id" <> "receiver_id")),
    CONSTRAINT "pair_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'cancelled'::"text", 'unpaired'::"text"]))),
    CONSTRAINT "pair_requests_visibility_check" CHECK (("visibility" = ANY (ARRAY['visible'::"text", 'hidden_until_friend'::"text"])))
);

ALTER TABLE ONLY "public"."pair_requests" REPLICA IDENTITY FULL;


ALTER TABLE "public"."pair_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pairings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_a_id" "uuid" NOT NULL,
    "user_b_id" "uuid" NOT NULL,
    "pair_request_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pairings_no_self" CHECK (("user_a_id" <> "user_b_id")),
    CONSTRAINT "pairings_ordered" CHECK (("user_a_id" < "user_b_id"))
);

ALTER TABLE ONLY "public"."pairings" REPLICA IDENTITY FULL;


ALTER TABLE "public"."pairings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_event_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "processed" boolean DEFAULT false NOT NULL,
    "processed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_webhook_events_stripe_id_nonempty" CHECK (("length"(TRIM(BOTH FROM "stripe_event_id")) > 0))
);


ALTER TABLE "public"."payment_webhook_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_webhook_events" IS 'Idempotent Stripe webhook inbox; service role only from clients (B1 §B.6).';



CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "stripe_payout_id" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" character(3) DEFAULT 'GBP'::"bpchar" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "arrival_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payouts_amount_positive" CHECK (("amount_cents" > 0)),
    CONSTRAINT "payouts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'failed'::"text"]))),
    CONSTRAINT "payouts_stripe_id_nonempty" CHECK (("length"(TRIM(BOTH FROM "stripe_payout_id")) > 0))
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


COMMENT ON TABLE "public"."payouts" IS 'Stripe payouts mirror (B1 §B.6).';



CREATE TABLE IF NOT EXISTS "public"."pending_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inviter_id" "uuid",
    "phone_e164" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "converted_user_id" "uuid",
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pending_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'converted'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."pending_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_pair_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inviter_id" "uuid" NOT NULL,
    "phone_e164" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "converted_user_id" "uuid",
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pending_pair_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'converted'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."pending_pair_invites" REPLICA IDENTITY FULL;


ALTER TABLE "public"."pending_pair_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_session_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "inviter_id" "uuid",
    "phone_e164" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "converted_invite_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pending_session_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'converted'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."pending_session_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."person_card_impressions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "holiday_key" "text" NOT NULL,
    "served_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paired_user_id" "uuid",
    "place_pool_id" "uuid" NOT NULL
);


ALTER TABLE "public"."person_card_impressions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."person_card_impressions"."place_pool_id" IS 'ORCH-0640: swapped from card_pool_id. Pool-only per DEC-037.';



CREATE TABLE IF NOT EXISTS "public"."photo_aesthetic_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "batch_index" integer NOT NULL,
    "place_pool_ids" "uuid"[] NOT NULL,
    "place_count" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "succeeded" integer DEFAULT 0 NOT NULL,
    "failed" integer DEFAULT 0 NOT NULL,
    "skipped" integer DEFAULT 0 NOT NULL,
    "anthropic_batch_id" "text",
    "anthropic_status" "text",
    "results_url" "text",
    "cost_usd" numeric(10,6) DEFAULT 0 NOT NULL,
    "error_message" "text",
    "failed_places" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_aesthetic_batches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."photo_aesthetic_batches" OWNER TO "postgres";


COMMENT ON TABLE "public"."photo_aesthetic_batches" IS 'ORCH-0708 (Wave 2 Phase 1): per-batch state for photo_aesthetic_runs. Contains up to run.batch_size place_pool_ids. When use_batch_api=true, anthropic_batch_id holds the Anthropic Batch API id. When use_batch_api=false, the batch is processed synchronously via N per-place vision calls.';



CREATE TABLE IF NOT EXISTS "public"."photo_aesthetic_labels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "place_pool_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "label_category" "text",
    "city" "text",
    "expected_aggregate" "jsonb" NOT NULL,
    "notes" "text",
    "labeled_by" "uuid",
    "labeled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "committed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_anchor_category" CHECK (((("role" = 'anchor'::"text") AND ("label_category" = ANY (ARRAY['upscale_steakhouse'::"text", 'sunny_brunch_cafe'::"text", 'neon_dive_bar'::"text", 'adult_venue'::"text", 'average_storefront'::"text", 'cozy_coffee_shop'::"text"]))) OR (("role" = 'fixture'::"text") AND ("label_category" IS NULL)))),
    CONSTRAINT "photo_aesthetic_labels_role_check" CHECK (("role" = ANY (ARRAY['anchor'::"text", 'fixture'::"text"])))
);


ALTER TABLE "public"."photo_aesthetic_labels" OWNER TO "postgres";


COMMENT ON TABLE "public"."photo_aesthetic_labels" IS 'ORCH-0708 (Wave 2 Phase 1): operator-labeled answer keys for photo-aesthetic scoring. Anchors (6) feed into Claude system prompt as calibration examples. Fixtures (30, 10 per Raleigh/Cary/Durham) used as regression tests in Compare-with-Claude view + golden_fixtures.json export.';



COMMENT ON COLUMN "public"."photo_aesthetic_labels"."role" IS 'anchor = one of 6 calibration anchors (one per label_category). fixture = one of 30 regression-test places (10 per city).';



COMMENT ON COLUMN "public"."photo_aesthetic_labels"."label_category" IS 'For role=anchor: one of {upscale_steakhouse, sunny_brunch_cafe, neon_dive_bar, adult_venue, average_storefront, cozy_coffee_shop}. NULL for fixtures.';



COMMENT ON COLUMN "public"."photo_aesthetic_labels"."expected_aggregate" IS 'JSON answer key. Same shape as place_pool.photo_aesthetic_data.aggregate. Compared field-by-field against Claude output in the Compare-with-Claude view.';



COMMENT ON COLUMN "public"."photo_aesthetic_labels"."committed_at" IS 'NULL = draft (operator is still editing). Non-null = committed to ground truth. The unique-anchor-per-category index applies only to committed rows.';



CREATE TABLE IF NOT EXISTS "public"."photo_aesthetic_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city" "text",
    "country" "text",
    "scope_type" "text" NOT NULL,
    "scope_place_ids" "uuid"[],
    "total_places" integer NOT NULL,
    "total_batches" integer NOT NULL,
    "batch_size" integer DEFAULT 25 NOT NULL,
    "completed_batches" integer DEFAULT 0 NOT NULL,
    "failed_batches" integer DEFAULT 0 NOT NULL,
    "skipped_batches" integer DEFAULT 0 NOT NULL,
    "total_succeeded" integer DEFAULT 0 NOT NULL,
    "total_failed" integer DEFAULT 0 NOT NULL,
    "total_skipped" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" numeric(10,6) DEFAULT 0 NOT NULL,
    "actual_cost_usd" numeric(10,6) DEFAULT 0 NOT NULL,
    "model" "text" DEFAULT 'claude-haiku-4-5'::"text" NOT NULL,
    "use_batch_api" boolean DEFAULT false NOT NULL,
    "use_cache" boolean DEFAULT true NOT NULL,
    "force_rescore" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "triggered_by" "uuid",
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_aesthetic_runs_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['city'::"text", 'place_ids'::"text", 'all'::"text"]))),
    CONSTRAINT "photo_aesthetic_runs_status_check" CHECK (("status" = ANY (ARRAY['ready'::"text", 'running'::"text", 'paused'::"text", 'completed'::"text", 'cancelled'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."photo_aesthetic_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."photo_aesthetic_runs" IS 'ORCH-0708 (Wave 2 Phase 1): one row per invocation of score-place-photo-aesthetics. Tracks total_places, batch progress, cost, and status. Mirrors photo_backfill_runs pattern.';



CREATE TABLE IF NOT EXISTS "public"."photo_backfill_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "batch_index" integer NOT NULL,
    "place_pool_ids" "uuid"[] NOT NULL,
    "place_count" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "succeeded" integer DEFAULT 0 NOT NULL,
    "failed" integer DEFAULT 0 NOT NULL,
    "skipped" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "failed_places" "jsonb" DEFAULT '[]'::"jsonb",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_backfill_batches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."photo_backfill_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photo_backfill_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city" "text" NOT NULL,
    "country" "text" NOT NULL,
    "total_places" integer NOT NULL,
    "total_batches" integer NOT NULL,
    "batch_size" integer DEFAULT 10 NOT NULL,
    "completed_batches" integer DEFAULT 0 NOT NULL,
    "failed_batches" integer DEFAULT 0 NOT NULL,
    "skipped_batches" integer DEFAULT 0 NOT NULL,
    "total_succeeded" integer DEFAULT 0 NOT NULL,
    "total_failed" integer DEFAULT 0 NOT NULL,
    "total_skipped" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" numeric(8,4) DEFAULT 0 NOT NULL,
    "actual_cost_usd" numeric(8,4) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "triggered_by" "uuid" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "text" DEFAULT 'pre_photo_passed'::"text" NOT NULL,
    CONSTRAINT "photo_backfill_runs_mode_check" CHECK (("mode" = ANY (ARRAY['initial'::"text", 'pre_photo_passed'::"text", 'refresh_servable'::"text"]))),
    CONSTRAINT "photo_backfill_runs_status_check" CHECK (("status" = ANY (ARRAY['ready'::"text", 'running'::"text", 'paused'::"text", 'completed'::"text", 'cancelled'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."photo_backfill_runs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."photo_backfill_runs"."mode" IS 'ORCH-0686 (supersedes ORCH-0598.11): explicit eligibility filter. pre_photo_passed = current default; gates on passes_pre_photo_check. refresh_servable = Bouncer-approved maintenance; gates on is_servable. initial = LEGACY alias for historical terminal-state rows; do not write from new code. I-PHOTO-FILTER-EXPLICIT. CI gate: I-DB-ENUM-CODE-PARITY.';



CREATE TABLE IF NOT EXISTS "public"."place_admin_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "place_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "acted_by" "uuid",
    "acted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "place_admin_actions_action_type_check" CHECK (("action_type" = ANY (ARRAY['deactivate'::"text", 'reactivate'::"text", 'refresh'::"text", 'bulk_deactivate'::"text", 'bulk_reactivate'::"text", 'bulk_refresh'::"text"])))
);


ALTER TABLE "public"."place_admin_actions" OWNER TO "postgres";


COMMENT ON TABLE "public"."place_admin_actions" IS 'Audit log for admin actions on places. Every deactivate/reactivate/refresh is recorded with acted_by (admin user ID), acted_at, reason, and metadata.';



CREATE TABLE IF NOT EXISTS "public"."place_external_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "place_pool_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'serper'::"text" NOT NULL,
    "source_review_id" "text" NOT NULL,
    "review_text" "text",
    "rating" integer,
    "posted_at" timestamp with time zone,
    "posted_label" "text",
    "author_name" "text",
    "author_review_count" integer,
    "author_photo_count" integer,
    "has_media" boolean DEFAULT false NOT NULL,
    "media" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "raw" "jsonb",
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "place_external_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "place_external_reviews_source_check" CHECK (("source" = 'serper'::"text"))
);


ALTER TABLE "public"."place_external_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."place_external_reviews" IS 'ORCH-0712 — third-party reviews (currently Serper Google Maps reviews) for trial-run anchor places. Dedup via (place_pool_id, source, source_review_id). One row per review with structured fields + raw Serper object preserved.';



CREATE TABLE IF NOT EXISTS "public"."place_intelligence_trial_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "place_pool_id" "uuid" NOT NULL,
    "signal_id" "text" NOT NULL,
    "anchor_index" integer NOT NULL,
    "input_payload" "jsonb" NOT NULL,
    "collage_url" "text",
    "reviews_count" integer DEFAULT 0 NOT NULL,
    "q1_response" "jsonb",
    "q2_response" "jsonb",
    "model" "text" DEFAULT 'claude-haiku-4-5'::"text" NOT NULL,
    "model_version" "text",
    "prompt_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "cost_usd" numeric(10,6) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "place_intelligence_trial_runs_anchor_index_check" CHECK (("anchor_index" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "place_intelligence_trial_runs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."place_intelligence_trial_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."place_intelligence_trial_runs" IS 'ORCH-0712 — Claude trial output per (run_id, place). Q1 = open exploration (proposed vibes + signals). Q2 = closed evaluation against existing 16 Mingla signals. I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING: rows MUST NOT be read by production scoring or ranking surfaces.';



CREATE TABLE IF NOT EXISTS "public"."place_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "calendar_entry_id" "uuid",
    "place_pool_id" "uuid",
    "google_place_id" "text",
    "card_id" "text",
    "place_name" "text" NOT NULL,
    "place_address" "text",
    "place_category" "text",
    "rating" integer NOT NULL,
    "did_attend" boolean DEFAULT true NOT NULL,
    "feedback_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "moderation_status" "text" DEFAULT 'pending'::"text",
    CONSTRAINT "place_reviews_moderation_status_check" CHECK (("moderation_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'flagged'::"text"]))),
    CONSTRAINT "place_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."place_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."place_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "place_id" "uuid" NOT NULL,
    "signal_id" "text" NOT NULL,
    "score" numeric NOT NULL,
    "contributions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "scored_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signal_version_id" "uuid",
    CONSTRAINT "place_scores_score_range" CHECK ((("score" >= (0)::numeric) AND ("score" <= (200)::numeric)))
);


ALTER TABLE "public"."place_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."place_scores" IS 'ORCH-0588: per-place per-signal scoring receipts. One row per (place_id, signal_id). Score 0-200 clamped (I-SCORE-NON-NEGATIVE). Contributions JSONB shows breakdown.';



CREATE TABLE IF NOT EXISTS "public"."preference_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "preference_id" "uuid" NOT NULL,
    "old_data" "jsonb" NOT NULL,
    "new_data" "jsonb" NOT NULL,
    "change_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."preference_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."preferences" (
    "profile_id" "uuid" NOT NULL,
    "mode" "text" DEFAULT 'explore'::"text",
    "people_count" integer DEFAULT 1,
    "categories" "text"[] DEFAULT ARRAY['Nature'::"text", 'Casual Eats'::"text", 'Drink'::"text"],
    "travel_mode" "text" DEFAULT 'walking'::"text",
    "travel_constraint_type" "text" DEFAULT 'time'::"text",
    "travel_constraint_value" integer DEFAULT 30,
    "datetime_pref" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "custom_location" "text",
    "date_option" "text",
    "use_gps_location" boolean DEFAULT true NOT NULL,
    "intents" "text"[] DEFAULT ARRAY[]::"text"[],
    "custom_lat" double precision,
    "custom_lng" double precision,
    "display_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "display_intents" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "intent_toggle" boolean DEFAULT true NOT NULL,
    "category_toggle" boolean DEFAULT true NOT NULL,
    "selected_dates" "date"[]
);


ALTER TABLE "public"."preferences" OWNER TO "postgres";


COMMENT ON COLUMN "public"."preferences"."categories" IS 'Deck source of truth. Written ONLY by PreferencesSheet. Always slugs.';



COMMENT ON COLUMN "public"."preferences"."date_option" IS 'User date preference: "Now", "Today", "This Weekend", or "Pick a Date"';



COMMENT ON COLUMN "public"."preferences"."use_gps_location" IS 'true = always use device GPS; false = use custom_location field';



COMMENT ON COLUMN "public"."preferences"."intents" IS 'Deck source of truth. Written ONLY by PreferencesSheet. Always slug IDs.';



COMMENT ON COLUMN "public"."preferences"."display_categories" IS 'Cosmetic profile interests shown to friends. NOT used by the deck. Written by EditInterestsSheet.';



COMMENT ON COLUMN "public"."preferences"."display_intents" IS 'Cosmetic profile intents shown to friends. NOT used by the deck. Written by EditInterestsSheet.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text",
    "display_name" "text",
    "username" "text",
    "first_name" "text",
    "last_name" "text",
    "currency" "text" DEFAULT 'USD'::"text",
    "measurement_system" "text" DEFAULT 'metric'::"text",
    "share_location" boolean DEFAULT true,
    "share_budget" boolean DEFAULT false,
    "share_categories" boolean DEFAULT true,
    "share_date_time" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "bio" "text",
    "location" "text",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "phone" "text",
    "has_completed_onboarding" boolean DEFAULT false,
    "email_verified" boolean DEFAULT false,
    "onboarding_step" integer,
    "account_type" "text",
    "active" boolean DEFAULT true NOT NULL,
    "visibility_mode" "text" DEFAULT 'friends'::"text",
    "avatar_url" "text",
    "birthday" "date",
    "gender" "text",
    "referral_code" "text",
    "country" "text",
    "preferred_language" "text" DEFAULT 'en'::"text",
    "photos" "text"[] DEFAULT '{}'::"text"[],
    "timezone" "text",
    "is_beta_tester" boolean DEFAULT true NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "is_seed" boolean DEFAULT false NOT NULL,
    "show_activity" boolean DEFAULT true NOT NULL,
    "coach_mark_step" integer DEFAULT 0,
    CONSTRAINT "profiles_gender_check" CHECK (("gender" = ANY (ARRAY['man'::"text", 'woman'::"text", 'non-binary'::"text", 'transgender'::"text", 'genderqueer'::"text", 'genderfluid'::"text", 'agender'::"text", 'prefer-not-to-say'::"text"]))),
    CONSTRAINT "profiles_visibility_mode_check" CHECK (("visibility_mode" = ANY (ARRAY['public'::"text", 'friends'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."onboarding_step" IS 'Tracks current onboarding step: 0 = completed, 2 = Intent Selection (first tracked step), 3-10 = subsequent steps';



COMMENT ON COLUMN "public"."profiles"."account_type" IS 'User account type: explorer, curator, business, qa_manager, or admin';



COMMENT ON COLUMN "public"."profiles"."visibility_mode" IS 'Profile visibility: public (everyone), friends, private (nobody)';



COMMENT ON COLUMN "public"."profiles"."country" IS 'ISO 3166-1 alpha-2 country code (e.g., US, GB, NG)';



COMMENT ON COLUMN "public"."profiles"."preferred_language" IS 'ISO 639-1 language code (e.g., en, es, fr)';



COMMENT ON COLUMN "public"."profiles"."photos" IS 'Up to 3 additional profile photo URLs beyond avatar_url';



COMMENT ON COLUMN "public"."profiles"."show_activity" IS 'When false, the user''s activity feed / presence is hidden from others (friends-only UX; exact enforcement in app/queries).';



COMMENT ON COLUMN "public"."profiles"."coach_mark_step" IS '0=not started, 1-10=current step, 11=completed, -1=skipped';



CREATE TABLE IF NOT EXISTS "public"."referral_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_id" "uuid" NOT NULL,
    "referred_id" "uuid" NOT NULL,
    "pending_invite_id" "uuid",
    "friend_request_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "credited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "referral_credits_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'credited'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."referral_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refresh_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "city_id" "uuid" NOT NULL,
    "batch_index" integer NOT NULL,
    "place_ids" "uuid"[] NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "results" "jsonb",
    "success_count" integer DEFAULT 0 NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "google_api_calls" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
    "error_message" "text",
    "error_details" "jsonb",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refresh_batches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."refresh_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refresh_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city_id" "uuid" NOT NULL,
    "filter_categories" "text"[],
    "filter_stale_days" integer,
    "filter_include_failed" boolean DEFAULT false NOT NULL,
    "batch_size" integer DEFAULT 50 NOT NULL,
    "total_places" integer NOT NULL,
    "total_batches" integer NOT NULL,
    "completed_batches" integer DEFAULT 0 NOT NULL,
    "failed_batches" integer DEFAULT 0 NOT NULL,
    "skipped_batches" integer DEFAULT 0 NOT NULL,
    "current_batch_index" integer,
    "status" "text" DEFAULT 'preparing'::"text" NOT NULL,
    "total_api_calls" integer DEFAULT 0 NOT NULL,
    "places_succeeded" integer DEFAULT 0 NOT NULL,
    "places_failed" integer DEFAULT 0 NOT NULL,
    "places_skipped" integer DEFAULT 0 NOT NULL,
    "total_cost_usd" double precision DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "triggered_by" "uuid",
    CONSTRAINT "refresh_runs_status_check" CHECK (("status" = ANY (ARRAY['preparing'::"text", 'ready'::"text", 'running'::"text", 'paused'::"text", 'completed'::"text", 'cancelled'::"text", 'failed_preparing'::"text"])))
);


ALTER TABLE "public"."refresh_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "stripe_refund_id" "text",
    "amount_cents" integer NOT NULL,
    "reason" "text",
    "initiated_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refunds_amount_positive" CHECK (("amount_cents" > 0)),
    CONSTRAINT "refunds_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'succeeded'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."refunds" OWNER TO "postgres";


COMMENT ON TABLE "public"."refunds" IS 'Refunds linked to orders (B1 §B.6).';



CREATE TABLE IF NOT EXISTS "public"."rule_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_set_version_id" "uuid" NOT NULL,
    "value" "text" NOT NULL,
    "sub_category" "text",
    "position" integer DEFAULT 0 NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rule_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."rule_entries" IS 'ORCH-0526: Leaf data per rule_set_version. value is the entry literal (lowercased on insert by RPC). sub_category populated only for EXCLUSION_KEYWORDS. reason required for blacklist/demotion adds (DEC-034 Q3, enforced at admin_rules_save RPC).';



CREATE TABLE IF NOT EXISTS "public"."rule_set_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_set_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "change_summary" "text",
    "thresholds" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "rule_set_versions_version_positive" CHECK (("version_number" > 0))
);


ALTER TABLE "public"."rule_set_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."rule_set_versions" IS 'ORCH-0526: Immutable version snapshots per rule_set. Edits create new versions; never UPDATE in place. Trigger rule_set_versions_no_update enforces immutability at the engine level (I-RULE-VERSION-IMMUTABLE).';



CREATE TABLE IF NOT EXISTS "public"."rule_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "kind" "text" NOT NULL,
    "scope_kind" "text" NOT NULL,
    "scope_value" "text",
    "current_version_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rule_sets_kind_check" CHECK (("kind" = ANY (ARRAY['blacklist'::"text", 'whitelist'::"text", 'promotion'::"text", 'demotion'::"text", 'strip'::"text", 'keyword_set'::"text", 'time_window'::"text", 'numeric_range'::"text", 'min_data_guard'::"text"]))),
    CONSTRAINT "rule_sets_scope_kind_check" CHECK (("scope_kind" = ANY (ARRAY['global'::"text", 'category'::"text", 'vibe'::"text"]))),
    CONSTRAINT "rule_sets_scope_value_consistency" CHECK (((("scope_kind" = 'global'::"text") AND ("scope_value" IS NULL)) OR (("scope_kind" = ANY (ARRAY['category'::"text", 'vibe'::"text"])) AND ("scope_value" IS NOT NULL))))
);


ALTER TABLE "public"."rule_sets" OWNER TO "postgres";


COMMENT ON TABLE "public"."rule_sets" IS 'ORCH-0526: Logical rule definitions (one row per "drawer"). 18 seeded in M2 from ai-verify-pipeline/index.ts constants. current_version_id points to the active rule_set_versions row.';



CREATE TABLE IF NOT EXISTS "public"."rules_run_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "batch_id" "uuid",
    "place_id" "uuid" NOT NULL,
    "decision" "text" NOT NULL,
    "previous_categories" "text"[],
    "new_categories" "text"[],
    "primary_identity" "text",
    "confidence" "text",
    "reason" "text",
    "evidence" "text",
    "stage_resolved" integer,
    "website_verified" boolean DEFAULT false NOT NULL,
    "search_results" "jsonb",
    "cost_usd" real DEFAULT 0 NOT NULL,
    "overridden" boolean DEFAULT false NOT NULL,
    "override_decision" "text",
    "override_categories" "text"[],
    "override_reason" "text",
    "overridden_by" "uuid",
    "overridden_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rule_set_version_id" "uuid",
    CONSTRAINT "ai_validation_results_confidence_check" CHECK (("confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "ai_validation_results_decision_check" CHECK (("decision" = ANY (ARRAY['accept'::"text", 'reject'::"text", 'reclassify'::"text"]))),
    CONSTRAINT "ai_validation_results_override_decision_check" CHECK ((("override_decision" IS NULL) OR ("override_decision" = ANY (ARRAY['accept'::"text", 'reject'::"text", 'reclassify'::"text"]))))
);


ALTER TABLE "public"."rules_run_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."rules_run_results" IS 'ORCH-0640: renamed from ai_validation_results. Stores per-place results of Rules Engine
   runs. Orphaned rows (job_id pointing at purged pure-AI jobs) were already cascade-deleted.';



COMMENT ON COLUMN "public"."rules_run_results"."rule_set_version_id" IS 'ORCH-0526 V6 gap close: per-place rule attribution. NULL when stage_resolved=5 (AI verdict) — only populated for rules-only verdicts (stage_resolved=2).';



CREATE TABLE IF NOT EXISTS "public"."rules_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "revalidate" boolean DEFAULT false NOT NULL,
    "country_filter" "text",
    "city_filter" "text",
    "total_places" integer DEFAULT 0 NOT NULL,
    "processed" integer DEFAULT 0 NOT NULL,
    "approved" integer DEFAULT 0 NOT NULL,
    "rejected" integer DEFAULT 0 NOT NULL,
    "failed" integer DEFAULT 0 NOT NULL,
    "continuation_token" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scope" "text",
    "stage" "text",
    "reclassified" integer DEFAULT 0 NOT NULL,
    "low_confidence" integer DEFAULT 0 NOT NULL,
    "cost_usd" real DEFAULT 0 NOT NULL,
    "estimated_cost_usd" real DEFAULT 0 NOT NULL,
    "category_filter" "text",
    "dry_run" boolean DEFAULT false NOT NULL,
    "batch_size" integer DEFAULT 25 NOT NULL,
    "total_batches" integer DEFAULT 0 NOT NULL,
    "completed_batches" integer DEFAULT 0 NOT NULL,
    "failed_batches" integer DEFAULT 0 NOT NULL,
    "skipped_batches" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "triggered_by" "uuid",
    "rules_version_id" "uuid",
    "unchanged" integer DEFAULT 0 NOT NULL,
    "city_id" "uuid",
    "lock_token" "text",
    CONSTRAINT "ai_validation_jobs_status_check" CHECK (("status" = ANY (ARRAY['ready'::"text", 'running'::"text", 'paused'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "chk_avj_scope" CHECK ((("scope" IS NULL) OR ("scope" = ANY (ARRAY['unvalidated'::"text", 'all'::"text", 'category'::"text", 'location'::"text", 'failed'::"text"])))),
    CONSTRAINT "chk_avj_stage" CHECK ((("stage" IS NULL) OR ("stage" = ANY (ARRAY['export'::"text", 'filter'::"text", 'search'::"text", 'website'::"text", 'classify'::"text", 'write'::"text", 'summary'::"text", 'complete'::"text", 'rules_only'::"text", 'rules_only_complete'::"text"]))))
);


ALTER TABLE "public"."rules_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."rules_runs" IS 'ORCH-0640: renamed from ai_validation_jobs. Pure-AI rows (rules_version_id IS NULL) purged
   during this migration. This table now stores Rules Engine run history ONLY.';



COMMENT ON COLUMN "public"."rules_runs"."rules_version_id" IS 'ORCH-0526: Pins the run to a specific rules manifest. NULL for pre-cutover legacy runs (transition guard).';



COMMENT ON COLUMN "public"."rules_runs"."unchanged" IS 'ORCH-0527: Count of places left untouched by a rules-only run. DO NOT misuse `approved` for this purpose; that field is for AI-approved counts only.';



COMMENT ON COLUMN "public"."rules_runs"."city_id" IS 'ORCH-0530: UUID FK to seeding_cities. Survives city renames; query by this for historical accuracy. The legacy city_filter text column is kept for backward compatibility + display.';



COMMENT ON COLUMN "public"."rules_runs"."lock_token" IS 'ORCH-0529: Advisory lock key (text-encoded bigint) acquired via pg_try_advisory_xact_lock at handler entry. Auto-released at transaction end.';



CREATE TABLE IF NOT EXISTS "public"."rules_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "manifest_label" "text",
    "snapshot" "jsonb" NOT NULL,
    "summary" "text",
    "deployed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deployed_by" "uuid",
    CONSTRAINT "rules_versions_snapshot_not_empty" CHECK ((("jsonb_typeof"("snapshot") = 'object'::"text") AND ("snapshot" <> '{}'::"jsonb")))
);


ALTER TABLE "public"."rules_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."rules_versions" IS 'ORCH-0526: Manifest tying together a snapshot of ALL rule_set_versions at a point in time. snapshot JSONB shape: {rule_set_id::text: rule_set_version_id::text}. ai_validation_jobs.rules_version_id FKs to here.';



CREATE TABLE IF NOT EXISTS "public"."saved_card" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "experience_id" "text" NOT NULL,
    "title" "text",
    "category" "text",
    "image_url" "text",
    "match_score" numeric,
    "card_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_card" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_people" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text",
    "initials" "text" NOT NULL,
    "birthday" "date",
    "gender" "text",
    "description" "text",
    "description_processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "saved_people_gender_check" CHECK (("gender" = ANY (ARRAY['man'::"text", 'woman'::"text", 'non-binary'::"text", 'transgender'::"text", 'genderqueer'::"text", 'genderfluid'::"text", 'agender'::"text", 'prefer-not-to-say'::"text"])))
);


ALTER TABLE "public"."saved_people" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scan_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "scanner_user_id" "uuid" NOT NULL,
    "scan_result" "text" NOT NULL,
    "scanned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_offline" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone,
    "device_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "scan_events_result_check" CHECK (("scan_result" = ANY (ARRAY['success'::"text", 'duplicate'::"text", 'not_found'::"text", 'wrong_event'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."scan_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."scan_events" IS 'Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs (e.g., partial scanner sync repair) and migration scripts. Application code MUST NOT mutate; new scan rows via INSERT only. (B1.5 — ORCH-0706 SF-4)';



CREATE TABLE IF NOT EXISTS "public"."scanner_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "permissions" "jsonb" DEFAULT '{"scan": true, "take_payments": false}'::"jsonb" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "scanner_invitations_email_nonempty" CHECK (("length"(TRIM(BOTH FROM "email")) > 0)),
    CONSTRAINT "scanner_invitations_token_nonempty" CHECK (("length"(TRIM(BOTH FROM "token")) > 0))
);


ALTER TABLE "public"."scanner_invitations" OWNER TO "postgres";


COMMENT ON TABLE "public"."scanner_invitations" IS 'Invite flow for event scanners (B1 §B.5).';



CREATE TABLE IF NOT EXISTS "public"."scheduled_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "card_id" "text" NOT NULL,
    "experience_id" "text",
    "saved_experience_id" "uuid",
    "board_id" "uuid",
    "title" "text" NOT NULL,
    "category" "text" NOT NULL,
    "image_url" "text",
    "scheduled_date" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text",
    "source" "text" DEFAULT 'user_scheduled'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "scheduled_activities_source_check" CHECK (("source" = ANY (ARRAY['user_scheduled'::"text", 'board_finalized'::"text"]))),
    CONSTRAINT "scheduled_activities_status_valid" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."scheduled_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seed_map_presence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_name" "text" NOT NULL,
    "first_name" "text",
    "avatar_url" "text",
    "approximate_lat" double precision NOT NULL,
    "approximate_lng" double precision NOT NULL,
    "activity_status" "text",
    "activity_status_expires_at" timestamp with time zone,
    "last_active_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "price_tiers" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "intents" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "city_id" "uuid"
);


ALTER TABLE "public"."seed_map_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seeding_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "city_id" "uuid" NOT NULL,
    "tile_id" "uuid" NOT NULL,
    "tile_index" integer NOT NULL,
    "seeding_category" "text" NOT NULL,
    "app_category" "text" NOT NULL,
    "batch_index" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "google_api_calls" integer DEFAULT 0 NOT NULL,
    "places_returned" integer DEFAULT 0 NOT NULL,
    "places_rejected_no_photos" integer DEFAULT 0 NOT NULL,
    "places_rejected_closed" integer DEFAULT 0 NOT NULL,
    "places_rejected_excluded_type" integer DEFAULT 0 NOT NULL,
    "places_new_inserted" integer DEFAULT 0 NOT NULL,
    "places_duplicate_skipped" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
    "error_message" "text",
    "error_details" "jsonb",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "seeding_batches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."seeding_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seeding_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city_id" "uuid" NOT NULL,
    "tile_id" "uuid",
    "seeding_category" "text" NOT NULL,
    "app_category" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "google_api_calls" integer DEFAULT 0 NOT NULL,
    "places_returned" integer DEFAULT 0 NOT NULL,
    "places_rejected_no_photos" integer DEFAULT 0 NOT NULL,
    "places_rejected_closed" integer DEFAULT 0 NOT NULL,
    "places_rejected_excluded_type" integer DEFAULT 0 NOT NULL,
    "places_new_inserted" integer DEFAULT 0 NOT NULL,
    "places_duplicate_skipped" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
    "error_message" "text",
    "error_details" "jsonb",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "seeding_operations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."seeding_operations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seeding_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city_id" "uuid" NOT NULL,
    "selected_categories" "text"[] NOT NULL,
    "total_tiles" integer NOT NULL,
    "total_batches" integer NOT NULL,
    "completed_batches" integer DEFAULT 0 NOT NULL,
    "failed_batches" integer DEFAULT 0 NOT NULL,
    "skipped_batches" integer DEFAULT 0 NOT NULL,
    "current_batch_index" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "total_api_calls" integer DEFAULT 0 NOT NULL,
    "total_places_new" integer DEFAULT 0 NOT NULL,
    "total_places_duped" integer DEFAULT 0 NOT NULL,
    "total_cost_usd" double precision DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "seeding_runs_status_check" CHECK (("status" = ANY (ARRAY['preparing'::"text", 'ready'::"text", 'running'::"text", 'paused'::"text", 'completed'::"text", 'cancelled'::"text", 'failed_preparing'::"text"])))
);


ALTER TABLE "public"."seeding_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seeding_tiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city_id" "uuid" NOT NULL,
    "tile_index" integer NOT NULL,
    "center_lat" double precision NOT NULL,
    "center_lng" double precision NOT NULL,
    "radius_m" integer NOT NULL,
    "row_idx" integer NOT NULL,
    "col_idx" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."seeding_tiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_admin" boolean DEFAULT false,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "has_accepted" boolean DEFAULT false,
    "notifications_muted" boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY "public"."session_participants" REPLICA IDENTITY FULL;


ALTER TABLE "public"."session_participants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."session_participants"."is_admin" IS 'Indicates whether the participant has admin privileges for this session. The session creator is always an admin regardless of this flag.';



COMMENT ON COLUMN "public"."session_participants"."notifications_muted" IS 'ORCH-0520: If true, notify-dispatch suppresses session-scoped push for this (session, user) pair. User-controlled via BoardSettingsDropdown bell icon. Does NOT suppress the in-app notification row — only push delivery. DEFAULT false enforces invariant I-SESSION-MUTE-DEFAULT-UNMUTED.';



CREATE TABLE IF NOT EXISTS "public"."signal_anchors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "signal_id" "text" NOT NULL,
    "anchor_index" integer NOT NULL,
    "place_pool_id" "uuid" NOT NULL,
    "notes" "text",
    "labeled_by" "uuid",
    "labeled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "committed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "signal_anchors_anchor_index_check" CHECK (("anchor_index" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "signal_anchors_signal_id_check" CHECK (("signal_id" = ANY (ARRAY['brunch'::"text", 'casual_food'::"text", 'creative_arts'::"text", 'drinks'::"text", 'fine_dining'::"text", 'flowers'::"text", 'groceries'::"text", 'icebreakers'::"text", 'lively'::"text", 'movies'::"text", 'nature'::"text", 'picnic_friendly'::"text", 'play'::"text", 'romantic'::"text", 'scenic'::"text", 'theatre'::"text"])))
);


ALTER TABLE "public"."signal_anchors" OWNER TO "postgres";


COMMENT ON TABLE "public"."signal_anchors" IS 'ORCH-0712 — operator-picked anchor places, 2 per Mingla signal x 16 signals = 32 max committed. Candidate filter: place_scores.score >= threshold for that signal. Used by run-place-intelligence-trial edge function as the input set for Claude trial.';



CREATE TABLE IF NOT EXISTS "public"."signal_definition_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "signal_id" "text" NOT NULL,
    "version_label" "text" NOT NULL,
    "config" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "notes" "text"
);


ALTER TABLE "public"."signal_definition_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."signal_definition_versions" IS 'ORCH-0588: versioned configs for each signal. Admin edits create new versions, never mutate. Mirrors rule_set_versions pattern.';



CREATE TABLE IF NOT EXISTS "public"."signal_definitions" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "current_version_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "signal_definitions_kind_valid" CHECK (("kind" = ANY (ARRAY['type-grounded'::"text", 'quality-grounded'::"text"])))
);


ALTER TABLE "public"."signal_definitions" OWNER TO "postgres";


COMMENT ON TABLE "public"."signal_definitions" IS 'ORCH-0588: signal registry (fine_dining, romantic, etc.). One row per active signal.';



CREATE TABLE IF NOT EXISTS "public"."stripe_connect_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "stripe_account_id" "text" NOT NULL,
    "account_type" "text" DEFAULT 'express'::"text" NOT NULL,
    "charges_enabled" boolean DEFAULT false NOT NULL,
    "payouts_enabled" boolean DEFAULT false NOT NULL,
    "requirements" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stripe_connect_accounts_stripe_id_nonempty" CHECK (("length"(TRIM(BOTH FROM "stripe_account_id")) > 0)),
    CONSTRAINT "stripe_connect_accounts_type_check" CHECK (("account_type" = ANY (ARRAY['standard'::"text", 'express'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."stripe_connect_accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."stripe_connect_accounts" IS 'Stripe Connect account per brand (B1 §B.6).';



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "referral_bonus_months" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "referral_bonus_started_at" timestamp with time zone,
    CONSTRAINT "subscriptions_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'mingla_plus'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tag_along_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "collab_session_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    CONSTRAINT "tag_along_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."tag_along_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "price_cents" integer DEFAULT 0 NOT NULL,
    "currency" character(3) DEFAULT 'GBP'::"bpchar" NOT NULL,
    "quantity_total" integer,
    "is_unlimited" boolean DEFAULT false NOT NULL,
    "is_free" boolean DEFAULT false NOT NULL,
    "sale_start_at" timestamp with time zone,
    "sale_end_at" timestamp with time zone,
    "validity_start_at" timestamp with time zone,
    "validity_end_at" timestamp with time zone,
    "min_purchase_qty" integer DEFAULT 1 NOT NULL,
    "max_purchase_qty" integer,
    "is_hidden" boolean DEFAULT false NOT NULL,
    "is_disabled" boolean DEFAULT false NOT NULL,
    "requires_approval" boolean DEFAULT false NOT NULL,
    "allow_transfers" boolean DEFAULT false NOT NULL,
    "password_protected" boolean DEFAULT false NOT NULL,
    "password_hash" "text",
    "available_online" boolean DEFAULT true NOT NULL,
    "available_in_person" boolean DEFAULT true NOT NULL,
    "waitlist_enabled" boolean DEFAULT false NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "ticket_types_min_max_qty" CHECK ((("max_purchase_qty" IS NULL) OR ("max_purchase_qty" >= "min_purchase_qty"))),
    CONSTRAINT "ticket_types_name_nonempty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "ticket_types_price_non_negative" CHECK (("price_cents" >= 0)),
    CONSTRAINT "ticket_types_qty_positive" CHECK ((("quantity_total" IS NULL) OR ("quantity_total" > 0)))
);


ALTER TABLE "public"."ticket_types" OWNER TO "postgres";


COMMENT ON TABLE "public"."ticket_types" IS 'Sellable ticket products for an event (B1 §B.4).';



CREATE TABLE IF NOT EXISTS "public"."ticketmaster_events_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cache_key" "text" NOT NULL,
    "events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_results" integer DEFAULT 0 NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '02:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ticketmaster_events_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "ticket_type_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "attendee_name" "text",
    "attendee_email" "text",
    "attendee_phone" "text",
    "qr_code" "text" NOT NULL,
    "status" "text" DEFAULT 'valid'::"text" NOT NULL,
    "transferred_to_email" "text",
    "transferred_at" timestamp with time zone,
    "approval_status" "text" DEFAULT 'auto'::"text" NOT NULL,
    "approval_decided_by" "uuid",
    "approval_decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used_at" timestamp with time zone,
    "used_by_scanner_id" "uuid",
    CONSTRAINT "tickets_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['auto'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "tickets_qr_nonempty" CHECK (("length"(TRIM(BOTH FROM "qr_code")) > 0)),
    CONSTRAINT "tickets_status_check" CHECK (("status" = ANY (ARRAY['valid'::"text", 'used'::"text", 'void'::"text", 'transferred'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."tickets" OWNER TO "postgres";


COMMENT ON TABLE "public"."tickets" IS 'Issued attendee tickets; issuance via service role (B1 §B.4).';



CREATE TABLE IF NOT EXISTS "public"."undo_actions" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "data" "jsonb" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "description" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."undo_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."used_trial_phones" (
    "phone_hash" "text" NOT NULL,
    "first_trial_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_trial_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trial_count" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."used_trial_phones" OWNER TO "postgres";


COMMENT ON TABLE "public"."used_trial_phones" IS 'Phone hashes (SHA-256 of E.164) that have used a free trial. Survives account deletion to prevent trial abuse via re-signup. No RLS = service-role only access.';



CREATE TABLE IF NOT EXISTS "public"."user_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "tag" "text",
    "reference_id" "text",
    "reference_type" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_activity_activity_type_check" CHECK (("activity_type" = ANY (ARRAY['saved_card'::"text", 'scheduled_card'::"text", 'joined_board'::"text"]))),
    CONSTRAINT "user_activity_reference_type_check" CHECK (("reference_type" = ANY (ARRAY['experience'::"text", 'board'::"text"])))
);


ALTER TABLE "public"."user_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "experience_id" "text" NOT NULL,
    "interaction_type" "text" NOT NULL,
    "interaction_data" "jsonb" DEFAULT '{}'::"jsonb",
    "location_context" "jsonb" DEFAULT '{}'::"jsonb",
    "session_id" "uuid",
    "recommendation_context" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "user_interactions_interaction_type_check" CHECK (("interaction_type" = ANY (ARRAY['view'::"text", 'like'::"text", 'dislike'::"text", 'save'::"text", 'unsave'::"text", 'share'::"text", 'schedule'::"text", 'unschedule'::"text", 'click_details'::"text", 'swipe_left'::"text", 'swipe_right'::"text", 'tap'::"text", 'visit'::"text", 'expand'::"text"])))
);


ALTER TABLE "public"."user_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_levels" (
    "user_id" "uuid" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "xp_score" numeric(10,2) DEFAULT 0 NOT NULL,
    "reviews_count" integer DEFAULT 0 NOT NULL,
    "saves_count" integer DEFAULT 0 NOT NULL,
    "scheduled_count" integer DEFAULT 0 NOT NULL,
    "friends_count" integer DEFAULT 0 NOT NULL,
    "collabs_count" integer DEFAULT 0 NOT NULL,
    "account_age_days" integer DEFAULT 0 NOT NULL,
    "last_calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_levels_level_check" CHECK ((("level" >= 1) AND ("level" <= 99)))
);


ALTER TABLE "public"."user_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_location_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "accuracy" double precision,
    "altitude" double precision,
    "heading" double precision,
    "speed" double precision,
    "location_type" "text" DEFAULT 'current'::"text",
    "place_context" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_location_history_location_type_check" CHECK (("location_type" = ANY (ARRAY['current'::"text", 'home'::"text", 'work'::"text", 'frequent'::"text", 'visited_place'::"text"])))
);


ALTER TABLE "public"."user_location_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_map_settings" (
    "user_id" "uuid" NOT NULL,
    "visibility_level" "text" DEFAULT 'friends'::"text" NOT NULL,
    "show_saved_places" boolean DEFAULT false NOT NULL,
    "show_scheduled_places" boolean DEFAULT false NOT NULL,
    "activity_status" "text",
    "activity_status_expires_at" timestamp with time zone,
    "discovery_radius_km" integer DEFAULT 5 NOT NULL,
    "time_delay_enabled" boolean DEFAULT false NOT NULL,
    "approximate_lat" double precision,
    "approximate_lng" double precision,
    "approximate_location_updated_at" timestamp with time zone,
    "real_lat" double precision,
    "real_lng" double precision,
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "go_dark_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "available_seats" integer DEFAULT 1 NOT NULL,
    "is_discoverable" boolean DEFAULT false NOT NULL,
    CONSTRAINT "user_map_settings_available_seats_check" CHECK ((("available_seats" >= 1) AND ("available_seats" <= 99))),
    CONSTRAINT "user_map_settings_discovery_radius_km_check" CHECK (("discovery_radius_km" = ANY (ARRAY[1, 5, 15, 50]))),
    CONSTRAINT "user_map_settings_visibility_level_check" CHECK (("visibility_level" = ANY (ARRAY['off'::"text", 'paired'::"text", 'friends'::"text", 'friends_of_friends'::"text", 'everyone'::"text"])))
);


ALTER TABLE "public"."user_map_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preference_learning" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "preference_type" "text" NOT NULL,
    "preference_key" "text" NOT NULL,
    "preference_value" double precision NOT NULL,
    "confidence" double precision DEFAULT 0.5,
    "interaction_count" integer DEFAULT 1,
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_preference_learning" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_push_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "push_token" "text" NOT NULL,
    "platform" character varying(10) DEFAULT 'ios'::character varying NOT NULL,
    "device_id" "text" DEFAULT 'unknown'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_push_tokens_platform_check" CHECK ((("platform")::"text" = ANY ((ARRAY['ios'::character varying, 'android'::character varying, 'web'::character varying])::"text"[])))
);


ALTER TABLE "public"."user_push_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "reported_user_id" "uuid" NOT NULL,
    "reason" "public"."report_reason" NOT NULL,
    "details" "text",
    "status" "public"."report_status" DEFAULT 'pending'::"public"."report_status",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "resolution_notes" "text",
    "severity" "text" DEFAULT 'medium'::"text",
    CONSTRAINT "no_self_report" CHECK (("reporter_id" <> "reported_user_id")),
    CONSTRAINT "user_reports_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."user_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_type" "text" DEFAULT 'recommendation'::"text",
    "session_context" "jsonb" DEFAULT '{}'::"jsonb",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "ended_at" timestamp with time zone,
    "interaction_count" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    CONSTRAINT "user_sessions_session_type_check" CHECK (("session_type" = ANY (ARRAY['recommendation'::"text", 'exploration'::"text", 'planning'::"text", 'social'::"text"])))
);


ALTER TABLE "public"."user_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_taste_matches" (
    "user_a_id" "uuid" NOT NULL,
    "user_b_id" "uuid" NOT NULL,
    "match_percentage" integer NOT NULL,
    "shared_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "shared_tiers" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "shared_intents" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_taste_matches_check" CHECK (("user_a_id" < "user_b_id")),
    CONSTRAINT "user_taste_matches_match_percentage_check" CHECK ((("match_percentage" >= 0) AND ("match_percentage" <= 100)))
);


ALTER TABLE "public"."user_taste_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "experience_id" "text" NOT NULL,
    "card_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "visited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_visits_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'geofence'::"text", 'calendar'::"text"])))
);


ALTER TABLE "public"."user_visits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "ticket_type_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "name" "text",
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "invited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "waitlist_entries_email_nonempty" CHECK (("length"(TRIM(BOTH FROM "email")) > 0)),
    CONSTRAINT "waitlist_entries_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'invited'::"text", 'converted'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."waitlist_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."waitlist_entries" IS 'Waitlist; client writes via service role only (B1 §B.4).';



ALTER TABLE ONLY "public"."account_deletion_requests"
    ADD CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_history"
    ADD CONSTRAINT "activity_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_backfill_log_archive_orch_0671"
    ADD CONSTRAINT "admin_backfill_log_archive_orch_0671_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_backfill_log"
    ADD CONSTRAINT "admin_backfill_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_config"
    ADD CONSTRAINT "admin_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."admin_email_log"
    ADD CONSTRAINT "admin_email_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_subscription_overrides"
    ADD CONSTRAINT "admin_subscription_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rules_runs"
    ADD CONSTRAINT "ai_validation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rules_run_results"
    ADD CONSTRAINT "ai_validation_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_config_key_key" UNIQUE ("config_key");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appsflyer_devices"
    ADD CONSTRAINT "appsflyer_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appsflyer_devices"
    ADD CONSTRAINT "appsflyer_devices_user_id_appsflyer_uid_key" UNIQUE ("user_id", "appsflyer_uid");



ALTER TABLE ONLY "public"."archived_holidays"
    ADD CONSTRAINT "archived_holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beta_feedback"
    ADD CONSTRAINT "beta_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocker_id_blocked_id_key" UNIQUE ("blocker_id", "blocked_id");



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_card_message_reads"
    ADD CONSTRAINT "board_card_message_reads_message_id_user_id_key" UNIQUE ("message_id", "user_id");



ALTER TABLE ONLY "public"."board_card_message_reads"
    ADD CONSTRAINT "board_card_message_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_card_messages"
    ADD CONSTRAINT "board_card_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_card_rsvps"
    ADD CONSTRAINT "board_card_rsvps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_card_rsvps"
    ADD CONSTRAINT "board_card_rsvps_session_id_saved_card_id_user_id_key" UNIQUE ("session_id", "saved_card_id", "user_id");



ALTER TABLE ONLY "public"."board_cards"
    ADD CONSTRAINT "board_cards_board_id_saved_experience_id_key" UNIQUE ("board_id", "saved_experience_id");



ALTER TABLE ONLY "public"."board_cards"
    ADD CONSTRAINT "board_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_collaborators"
    ADD CONSTRAINT "board_collaborators_board_id_user_id_key" UNIQUE ("board_id", "user_id");



ALTER TABLE ONLY "public"."board_collaborators"
    ADD CONSTRAINT "board_collaborators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_message_reactions"
    ADD CONSTRAINT "board_message_reactions_message_id_user_id_emoji_key" UNIQUE ("message_id", "user_id", "emoji");



ALTER TABLE ONLY "public"."board_message_reactions"
    ADD CONSTRAINT "board_message_reactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_message_reads"
    ADD CONSTRAINT "board_message_reads_message_id_user_id_key" UNIQUE ("message_id", "user_id");



ALTER TABLE ONLY "public"."board_message_reads"
    ADD CONSTRAINT "board_message_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_messages"
    ADD CONSTRAINT "board_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_participant_presence"
    ADD CONSTRAINT "board_participant_presence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_participant_presence"
    ADD CONSTRAINT "board_participant_presence_session_id_user_id_key" UNIQUE ("session_id", "user_id");



ALTER TABLE ONLY "public"."board_saved_cards"
    ADD CONSTRAINT "board_saved_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_saved_cards"
    ADD CONSTRAINT "board_saved_cards_session_id_experience_id_saved_experience_key" UNIQUE ("session_id", "experience_id", "saved_experience_id");



ALTER TABLE ONLY "public"."board_threads"
    ADD CONSTRAINT "board_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_typing_indicators"
    ADD CONSTRAINT "board_typing_indicators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_typing_indicators"
    ADD CONSTRAINT "board_typing_indicators_session_id_user_id_saved_card_id_key" UNIQUE ("session_id", "user_id", "saved_card_id");



ALTER TABLE ONLY "public"."board_user_swipe_states"
    ADD CONSTRAINT "board_user_swipe_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_board_id_card_id_user_id_key" UNIQUE ("board_id", "card_id", "user_id");



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_session_saved_card_user_unique" UNIQUE ("session_id", "saved_card_id", "user_id");



ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_invitations"
    ADD CONSTRAINT "brand_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_team_members"
    ADD CONSTRAINT "brand_team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_entries"
    ADD CONSTRAINT "calendar_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_generation_runs"
    ADD CONSTRAINT "card_generation_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."_archive_card_pool"
    ADD CONSTRAINT "card_pool_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."_archive_card_pool_stops"
    ADD CONSTRAINT "card_pool_stops_card_pool_id_place_pool_id_key" UNIQUE ("card_pool_id", "place_pool_id");



ALTER TABLE ONLY "public"."_archive_card_pool_stops"
    ADD CONSTRAINT "card_pool_stops_card_pool_id_stop_order_key" UNIQUE ("card_pool_id", "stop_order");



ALTER TABLE ONLY "public"."_archive_card_pool_stops"
    ADD CONSTRAINT "card_pool_stops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."category_type_exclusions"
    ADD CONSTRAINT "category_type_exclusions_pkey" PRIMARY KEY ("category_slug", "excluded_type");



ALTER TABLE ONLY "public"."collaboration_invites"
    ADD CONSTRAINT "collaboration_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."collaboration_invites"
    ADD CONSTRAINT "collaboration_invites_session_invited_user_unique" UNIQUE ("session_id", "invited_user_id");



ALTER TABLE ONLY "public"."collaboration_sessions"
    ADD CONSTRAINT "collaboration_sessions_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."collaboration_sessions"
    ADD CONSTRAINT "collaboration_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_user_id_key" UNIQUE ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_presence"
    ADD CONSTRAINT "conversation_presence_conversation_id_user_id_key" UNIQUE ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."conversation_presence"
    ADD CONSTRAINT "conversation_presence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_id_key" UNIQUE NULLS NOT DISTINCT ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."creator_accounts"
    ADD CONSTRAINT "creator_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."curated_places_cache"
    ADD CONSTRAINT "curated_places_cache_pkey" PRIMARY KEY ("location_key", "radius_m");



ALTER TABLE ONLY "public"."curated_teaser_cache"
    ADD CONSTRAINT "curated_teaser_cache_pkey" PRIMARY KEY ("cache_key");



ALTER TABLE ONLY "public"."custom_holidays"
    ADD CONSTRAINT "custom_holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."direct_message_reactions"
    ADD CONSTRAINT "direct_message_reactions_message_id_user_id_emoji_key" UNIQUE ("message_id", "user_id", "emoji");



ALTER TABLE ONLY "public"."direct_message_reactions"
    ADD CONSTRAINT "direct_message_reactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discover_daily_cache"
    ADD CONSTRAINT "discover_daily_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."door_sales_ledger"
    ADD CONSTRAINT "door_sales_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_name_unique" UNIQUE ("name");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."engagement_metrics"
    ADD CONSTRAINT "engagement_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_dates"
    ADD CONSTRAINT "event_dates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_scanners"
    ADD CONSTRAINT "event_scanners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."experience_feedback"
    ADD CONSTRAINT "experience_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_flag_key_key" UNIQUE ("flag_key");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_sender_id_receiver_id_key" UNIQUE ("sender_id", "receiver_id");



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_user_id_friend_user_id_key" UNIQUE ("user_id", "friend_user_id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_service_name_key" UNIQUE ("service_name");



ALTER TABLE ONLY "public"."leaderboard_presence"
    ADD CONSTRAINT "leaderboard_presence_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."match_telemetry_events"
    ADD CONSTRAINT "match_telemetry_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_reads"
    ADD CONSTRAINT "message_reads_message_id_user_id_key" UNIQUE ("message_id", "user_id");



ALTER TABLE ONLY "public"."message_reads"
    ADD CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."muted_users"
    ADD CONSTRAINT "muted_users_muter_id_muted_id_key" UNIQUE ("muter_id", "muted_id");



ALTER TABLE ONLY "public"."muted_users"
    ADD CONSTRAINT "muted_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_line_items"
    ADD CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pair_requests"
    ADD CONSTRAINT "pair_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pairings"
    ADD CONSTRAINT "pairings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pairings"
    ADD CONSTRAINT "pairings_unique" UNIQUE ("user_a_id", "user_b_id");



ALTER TABLE ONLY "public"."payment_webhook_events"
    ADD CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_inviter_id_phone_e164_key" UNIQUE ("inviter_id", "phone_e164");



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_pair_invites"
    ADD CONSTRAINT "pending_pair_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_pair_invites"
    ADD CONSTRAINT "pending_pair_invites_unique" UNIQUE ("inviter_id", "phone_e164");



ALTER TABLE ONLY "public"."pending_session_invites"
    ADD CONSTRAINT "pending_session_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_session_invites"
    ADD CONSTRAINT "pending_session_invites_session_inviter_phone_key" UNIQUE ("session_id", "inviter_id", "phone_e164");



ALTER TABLE ONLY "public"."person_card_impressions"
    ADD CONSTRAINT "person_card_impressions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_aesthetic_batches"
    ADD CONSTRAINT "photo_aesthetic_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_aesthetic_labels"
    ADD CONSTRAINT "photo_aesthetic_labels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_aesthetic_runs"
    ADD CONSTRAINT "photo_aesthetic_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_backfill_batches"
    ADD CONSTRAINT "photo_backfill_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_backfill_runs"
    ADD CONSTRAINT "photo_backfill_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_admin_actions"
    ADD CONSTRAINT "place_admin_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_external_reviews"
    ADD CONSTRAINT "place_external_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_intelligence_trial_runs"
    ADD CONSTRAINT "place_intelligence_trial_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_pool"
    ADD CONSTRAINT "place_pool_google_place_id_key" UNIQUE ("google_place_id");



ALTER TABLE ONLY "public"."place_pool"
    ADD CONSTRAINT "place_pool_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_reviews"
    ADD CONSTRAINT "place_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_scores"
    ADD CONSTRAINT "place_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_scores"
    ADD CONSTRAINT "place_scores_unique_place_signal" UNIQUE ("place_id", "signal_id");



ALTER TABLE ONLY "public"."preference_history"
    ADD CONSTRAINT "preference_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preferences"
    ADD CONSTRAINT "preferences_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_phone_unique" UNIQUE ("phone");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_referrer_id_referred_id_key" UNIQUE ("referrer_id", "referred_id");



ALTER TABLE ONLY "public"."refresh_batches"
    ADD CONSTRAINT "refresh_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refresh_runs"
    ADD CONSTRAINT "refresh_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rule_entries"
    ADD CONSTRAINT "rule_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rule_entries"
    ADD CONSTRAINT "rule_entries_unique_per_version" UNIQUE ("rule_set_version_id", "value", "sub_category");



ALTER TABLE ONLY "public"."rule_set_versions"
    ADD CONSTRAINT "rule_set_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rule_set_versions"
    ADD CONSTRAINT "rule_set_versions_unique" UNIQUE ("rule_set_id", "version_number");



ALTER TABLE ONLY "public"."rule_sets"
    ADD CONSTRAINT "rule_sets_name_unique" UNIQUE ("name");



ALTER TABLE ONLY "public"."rule_sets"
    ADD CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rules_versions"
    ADD CONSTRAINT "rules_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_card"
    ADD CONSTRAINT "saved_card_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_people"
    ADD CONSTRAINT "saved_people_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scan_events"
    ADD CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scanner_invitations"
    ADD CONSTRAINT "scanner_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seed_map_presence"
    ADD CONSTRAINT "seed_map_presence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seeding_batches"
    ADD CONSTRAINT "seeding_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seeding_cities"
    ADD CONSTRAINT "seeding_cities_google_place_id_key" UNIQUE ("google_place_id");



ALTER TABLE ONLY "public"."seeding_cities"
    ADD CONSTRAINT "seeding_cities_name_country_key" UNIQUE ("name", "country");



ALTER TABLE ONLY "public"."seeding_cities"
    ADD CONSTRAINT "seeding_cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seeding_operations"
    ADD CONSTRAINT "seeding_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seeding_runs"
    ADD CONSTRAINT "seeding_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seeding_tiles"
    ADD CONSTRAINT "seeding_tiles_city_id_tile_index_key" UNIQUE ("city_id", "tile_index");



ALTER TABLE ONLY "public"."seeding_tiles"
    ADD CONSTRAINT "seeding_tiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_session_id_user_id_key" UNIQUE ("session_id", "user_id");



ALTER TABLE ONLY "public"."signal_anchors"
    ADD CONSTRAINT "signal_anchors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signal_definition_versions"
    ADD CONSTRAINT "signal_definition_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signal_definitions"
    ADD CONSTRAINT "signal_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_connect_accounts"
    ADD CONSTRAINT "stripe_connect_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."tag_along_requests"
    ADD CONSTRAINT "tag_along_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_types"
    ADD CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticketmaster_events_cache"
    ADD CONSTRAINT "ticketmaster_events_cache_cache_key_key" UNIQUE ("cache_key");



ALTER TABLE ONLY "public"."ticketmaster_events_cache"
    ADD CONSTRAINT "ticketmaster_events_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."undo_actions"
    ADD CONSTRAINT "undo_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."used_trial_phones"
    ADD CONSTRAINT "used_trial_phones_pkey" PRIMARY KEY ("phone_hash");



ALTER TABLE ONLY "public"."user_activity"
    ADD CONSTRAINT "user_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_interactions"
    ADD CONSTRAINT "user_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_levels"
    ADD CONSTRAINT "user_levels_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_location_history"
    ADD CONSTRAINT "user_location_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_map_settings"
    ADD CONSTRAINT "user_map_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_preference_learning"
    ADD CONSTRAINT "user_preference_learning_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preference_learning"
    ADD CONSTRAINT "user_preference_learning_user_id_preference_type_preference_key" UNIQUE ("user_id", "preference_type", "preference_key");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_user_id_push_token_key" UNIQUE ("user_id", "push_token");



ALTER TABLE ONLY "public"."user_reports"
    ADD CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_sessions"
    ADD CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_taste_matches"
    ADD CONSTRAINT "user_taste_matches_pkey" PRIMARY KEY ("user_a_id", "user_b_id");



ALTER TABLE ONLY "public"."user_visits"
    ADD CONSTRAINT "user_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id");



CREATE INDEX "_archive_orch_0700_doomed_columns_id_idx" ON "public"."_archive_orch_0700_doomed_columns" USING "btree" ("id");



CREATE INDEX "admin_place_pool_mv_city_id_idx" ON "public"."admin_place_pool_mv" USING "btree" ("city_id");



CREATE UNIQUE INDEX "admin_place_pool_mv_id_idx" ON "public"."admin_place_pool_mv" USING "btree" ("id");



CREATE INDEX "admin_place_pool_mv_is_servable_idx" ON "public"."admin_place_pool_mv" USING "btree" ("is_servable");



CREATE INDEX "admin_place_pool_mv_primary_category_idx" ON "public"."admin_place_pool_mv" USING "btree" ("primary_category");



CREATE UNIQUE INDEX "board_saved_cards_session_experience_unique" ON "public"."board_saved_cards" USING "btree" ("session_id", "experience_id");



COMMENT ON INDEX "public"."board_saved_cards_session_experience_unique" IS 'ORCH-0558: Enforces one saved_card row per (session_id, experience_id). Used by check_mutual_like ON CONFLICT clause to gracefully handle the concurrency race (two simultaneous quorum-reaching swipes). Must remain in place even if the older 3-column index is retained.';



CREATE UNIQUE INDEX "board_user_swipe_states_session_experience_user_unique" ON "public"."board_user_swipe_states" USING "btree" ("session_id", "experience_id", "user_id");



CREATE INDEX "idx_account_deletion_requests_status" ON "public"."account_deletion_requests" USING "btree" ("status");



CREATE INDEX "idx_account_deletion_requests_user_id" ON "public"."account_deletion_requests" USING "btree" ("user_id");



CREATE INDEX "idx_activity_history_board_id" ON "public"."activity_history" USING "btree" ("board_id");



CREATE INDEX "idx_admin_email_log_created" ON "public"."admin_email_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_admin_overrides_granted_by" ON "public"."admin_subscription_overrides" USING "btree" ("granted_by");



CREATE INDEX "idx_admin_overrides_user_active" ON "public"."admin_subscription_overrides" USING "btree" ("user_id", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_appsflyer_devices_user_id" ON "public"."appsflyer_devices" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_archived_holidays_unique" ON "public"."archived_holidays" USING "btree" ("user_id", "person_id", "holiday_key");



CREATE INDEX "idx_audit_log_action" ON "public"."admin_audit_log" USING "btree" ("action");



CREATE INDEX "idx_audit_log_admin" ON "public"."admin_audit_log" USING "btree" ("admin_email");



CREATE INDEX "idx_audit_log_brand_id" ON "public"."audit_log" USING "btree" ("brand_id");



CREATE INDEX "idx_audit_log_created_at" ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_log_user_id" ON "public"."audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_backfill_log_created" ON "public"."admin_backfill_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_backfill_log_status" ON "public"."admin_backfill_log" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "idx_beta_feedback_created" ON "public"."beta_feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_beta_feedback_status" ON "public"."beta_feedback" USING "btree" ("status");



CREATE INDEX "idx_beta_feedback_user" ON "public"."beta_feedback" USING "btree" ("user_id");



CREATE INDEX "idx_blocked_users_blocked" ON "public"."blocked_users" USING "btree" ("blocked_id");



CREATE INDEX "idx_blocked_users_blocker" ON "public"."blocked_users" USING "btree" ("blocker_id");



CREATE INDEX "idx_board_card_message_reads_message_id" ON "public"."board_card_message_reads" USING "btree" ("message_id");



CREATE INDEX "idx_board_card_message_reads_user_id" ON "public"."board_card_message_reads" USING "btree" ("user_id");



CREATE INDEX "idx_board_card_messages_created_at" ON "public"."board_card_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_board_card_messages_saved_card_id" ON "public"."board_card_messages" USING "btree" ("saved_card_id");



CREATE INDEX "idx_board_card_messages_session_id" ON "public"."board_card_messages" USING "btree" ("session_id");



CREATE INDEX "idx_board_card_messages_user_id" ON "public"."board_card_messages" USING "btree" ("user_id");



CREATE INDEX "idx_board_card_rsvps_saved_card_id" ON "public"."board_card_rsvps" USING "btree" ("saved_card_id");



CREATE INDEX "idx_board_card_rsvps_session_id" ON "public"."board_card_rsvps" USING "btree" ("session_id");



CREATE INDEX "idx_board_card_rsvps_status" ON "public"."board_card_rsvps" USING "btree" ("rsvp_status");



CREATE INDEX "idx_board_card_rsvps_user_id" ON "public"."board_card_rsvps" USING "btree" ("user_id");



CREATE INDEX "idx_board_cards_board_id" ON "public"."board_cards" USING "btree" ("board_id");



CREATE INDEX "idx_board_collaborators_board_id" ON "public"."board_collaborators" USING "btree" ("board_id");



CREATE INDEX "idx_board_collaborators_user_id" ON "public"."board_collaborators" USING "btree" ("user_id");



CREATE INDEX "idx_board_message_reactions_message_id" ON "public"."board_message_reactions" USING "btree" ("message_id");



CREATE INDEX "idx_board_message_reactions_user_id" ON "public"."board_message_reactions" USING "btree" ("user_id");



CREATE INDEX "idx_board_message_reads_message_id" ON "public"."board_message_reads" USING "btree" ("message_id");



CREATE INDEX "idx_board_message_reads_user_id" ON "public"."board_message_reads" USING "btree" ("user_id");



CREATE INDEX "idx_board_messages_created_at" ON "public"."board_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_board_messages_reply_to" ON "public"."board_messages" USING "btree" ("reply_to_id") WHERE ("reply_to_id" IS NOT NULL);



CREATE INDEX "idx_board_messages_session_id" ON "public"."board_messages" USING "btree" ("session_id");



CREATE INDEX "idx_board_messages_user_id" ON "public"."board_messages" USING "btree" ("user_id");



CREATE INDEX "idx_board_participant_presence_online" ON "public"."board_participant_presence" USING "btree" ("is_online") WHERE ("is_online" = true);



CREATE INDEX "idx_board_participant_presence_session_id" ON "public"."board_participant_presence" USING "btree" ("session_id");



CREATE INDEX "idx_board_participant_presence_user_id" ON "public"."board_participant_presence" USING "btree" ("user_id");



CREATE INDEX "idx_board_saved_cards_locked" ON "public"."board_saved_cards" USING "btree" ("session_id", "is_locked") WHERE ("is_locked" = true);



CREATE INDEX "idx_board_saved_cards_saved_at" ON "public"."board_saved_cards" USING "btree" ("saved_at" DESC);



CREATE INDEX "idx_board_saved_cards_saved_by" ON "public"."board_saved_cards" USING "btree" ("saved_by");



CREATE INDEX "idx_board_saved_cards_session_id" ON "public"."board_saved_cards" USING "btree" ("session_id");



CREATE INDEX "idx_board_threads_board_id" ON "public"."board_threads" USING "btree" ("board_id");



CREATE INDEX "idx_board_typing_indicators_session" ON "public"."board_typing_indicators" USING "btree" ("session_id");



CREATE INDEX "idx_board_typing_indicators_typing" ON "public"."board_typing_indicators" USING "btree" ("is_typing") WHERE ("is_typing" = true);



CREATE INDEX "idx_board_user_swipe_states_experience" ON "public"."board_user_swipe_states" USING "btree" ("experience_id") WHERE ("experience_id" IS NOT NULL);



CREATE INDEX "idx_board_user_swipe_states_saved_experience" ON "public"."board_user_swipe_states" USING "btree" ("saved_experience_id") WHERE ("saved_experience_id" IS NOT NULL);



CREATE INDEX "idx_board_user_swipe_states_session_user" ON "public"."board_user_swipe_states" USING "btree" ("session_id", "user_id");



CREATE INDEX "idx_board_votes_board_id" ON "public"."board_votes" USING "btree" ("board_id");



CREATE INDEX "idx_board_votes_saved_card_id" ON "public"."board_votes" USING "btree" ("saved_card_id") WHERE ("saved_card_id" IS NOT NULL);



CREATE INDEX "idx_board_votes_session_id" ON "public"."board_votes" USING "btree" ("session_id") WHERE ("session_id" IS NOT NULL);



CREATE INDEX "idx_board_votes_user_id" ON "public"."board_votes" USING "btree" ("user_id");



CREATE INDEX "idx_boards_created_by" ON "public"."boards" USING "btree" ("created_by");



CREATE INDEX "idx_boards_is_public" ON "public"."boards" USING "btree" ("is_public");



CREATE INDEX "idx_brand_invitations_brand_id" ON "public"."brand_invitations" USING "btree" ("brand_id");



CREATE UNIQUE INDEX "idx_brand_invitations_token" ON "public"."brand_invitations" USING "btree" ("token");



CREATE UNIQUE INDEX "idx_brand_team_members_brand_user_active" ON "public"."brand_team_members" USING "btree" ("brand_id", "user_id") WHERE ("removed_at" IS NULL);



CREATE INDEX "idx_brand_team_members_user_id" ON "public"."brand_team_members" USING "btree" ("user_id") WHERE ("removed_at" IS NULL);



CREATE INDEX "idx_brands_account_id" ON "public"."brands" USING "btree" ("account_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_brands_slug_active" ON "public"."brands" USING "btree" ("lower"("slug")) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_calendar_entries_feedback" ON "public"."calendar_entries" USING "btree" ("user_id", "feedback_status");



CREATE INDEX "idx_calendar_entries_scheduled_at" ON "public"."calendar_entries" USING "btree" ("scheduled_at" DESC);



CREATE UNIQUE INDEX "idx_calendar_entries_unique_pending" ON "public"."calendar_entries" USING "btree" ("user_id", "card_id") WHERE (("status" = 'pending'::"text") AND ("archived_at" IS NULL) AND ("card_id" IS NOT NULL));



CREATE UNIQUE INDEX "idx_calendar_entries_user_board_card" ON "public"."calendar_entries" USING "btree" ("user_id", "board_card_id") WHERE ("board_card_id" IS NOT NULL);



CREATE INDEX "idx_calendar_entries_user_id" ON "public"."calendar_entries" USING "btree" ("user_id");



CREATE INDEX "idx_card_gen_runs_city_status" ON "public"."card_generation_runs" USING "btree" ("city", "status");



CREATE INDEX "idx_card_pool_ai_approved" ON "public"."_archive_card_pool" USING "btree" ("ai_approved") WHERE ("is_active" = true);



CREATE INDEX "idx_card_pool_categories" ON "public"."_archive_card_pool" USING "gin" ("categories") WHERE ("is_active" = true);



CREATE INDEX "idx_card_pool_category_geo" ON "public"."_archive_card_pool" USING "btree" ("category", "lat", "lng") WHERE ("is_active" = true);



CREATE INDEX "idx_card_pool_city" ON "public"."_archive_card_pool" USING "btree" ("city");



CREATE INDEX "idx_card_pool_city_id" ON "public"."_archive_card_pool" USING "btree" ("city_id");



CREATE INDEX "idx_card_pool_country" ON "public"."_archive_card_pool" USING "btree" ("country");



CREATE INDEX "idx_card_pool_curated_geo" ON "public"."_archive_card_pool" USING "btree" ("experience_type", "is_active", "lat", "lng", "total_price_max") WHERE ("card_type" = 'curated'::"text");



CREATE INDEX "idx_card_pool_engagement" ON "public"."_archive_card_pool" USING "btree" ("engagement_score" DESC) WHERE ("is_active" = true);



CREATE INDEX "idx_card_pool_needs_copy" ON "public"."_archive_card_pool" USING "btree" ("created_at" DESC) WHERE (("one_liner" IS NULL) AND ("description" IS NOT NULL));



CREATE INDEX "idx_card_pool_needs_description" ON "public"."_archive_card_pool" USING "btree" ("created_at" DESC) WHERE ("description" IS NULL);



CREATE INDEX "idx_card_pool_place_pool_id_active" ON "public"."_archive_card_pool" USING "btree" ("place_pool_id") WHERE ("is_active" = true);



CREATE INDEX "idx_card_pool_popularity" ON "public"."_archive_card_pool" USING "btree" ("popularity_score" DESC) WHERE ("is_active" = true);



CREATE INDEX "idx_card_pool_price_tier" ON "public"."_archive_card_pool" USING "btree" ("price_tier");



CREATE INDEX "idx_card_pool_price_tiers" ON "public"."_archive_card_pool" USING "gin" ("price_tiers");



CREATE INDEX "idx_card_pool_stops_card_order" ON "public"."_archive_card_pool_stops" USING "btree" ("card_pool_id", "stop_order");



CREATE INDEX "idx_card_pool_stops_place" ON "public"."_archive_card_pool_stops" USING "btree" ("place_pool_id");



CREATE INDEX "idx_card_pool_type" ON "public"."_archive_card_pool" USING "btree" ("card_type", "experience_type") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "idx_card_pool_unique_google_place_id" ON "public"."_archive_card_pool" USING "btree" ("google_place_id") WHERE ("google_place_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_card_pool_unique_single" ON "public"."_archive_card_pool" USING "btree" ("google_place_id") WHERE (("card_type" = 'single'::"text") AND ("google_place_id" IS NOT NULL));



CREATE INDEX "idx_collab_invites_inviter_invited" ON "public"."collaboration_invites" USING "btree" ("inviter_id", "invited_user_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_collaboration_invites_invited_user_id" ON "public"."collaboration_invites" USING "btree" ("invited_user_id");



CREATE UNIQUE INDEX "idx_collaboration_sessions_board_id_unique" ON "public"."collaboration_sessions" USING "btree" ("board_id") WHERE ("board_id" IS NOT NULL);



CREATE INDEX "idx_collaboration_sessions_invite_code" ON "public"."collaboration_sessions" USING "btree" ("invite_code") WHERE ("invite_code" IS NOT NULL);



CREATE UNIQUE INDEX "idx_collaboration_sessions_unique_board" ON "public"."collaboration_sessions" USING "btree" ("board_id") WHERE ("board_id" IS NOT NULL);



CREATE INDEX "idx_conversation_participants_conversation_id" ON "public"."conversation_participants" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_participants_user_conversation" ON "public"."conversation_participants" USING "btree" ("user_id", "conversation_id");



CREATE INDEX "idx_conversation_participants_user_id" ON "public"."conversation_participants" USING "btree" ("user_id");



CREATE INDEX "idx_conversation_presence_conv_id" ON "public"."conversation_presence" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_presence_user_id" ON "public"."conversation_presence" USING "btree" ("user_id");



CREATE INDEX "idx_conversations_created_by" ON "public"."conversations" USING "btree" ("created_by");



CREATE INDEX "idx_conversations_last_message_at" ON "public"."conversations" USING "btree" ("last_message_at" DESC);



CREATE INDEX "idx_conversations_updated_at" ON "public"."conversations" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_creator_accounts_default_brand_id" ON "public"."creator_accounts" USING "btree" ("default_brand_id") WHERE ("default_brand_id" IS NOT NULL);



CREATE INDEX "idx_creator_accounts_email_lower" ON "public"."creator_accounts" USING "btree" ("lower"("email"));



CREATE INDEX "idx_cte_category_slug" ON "public"."category_type_exclusions" USING "btree" ("category_slug");



CREATE INDEX "idx_curated_places_cache_ttl" ON "public"."curated_places_cache" USING "btree" ("created_at");



CREATE INDEX "idx_curated_teaser_experience_type" ON "public"."curated_teaser_cache" USING "btree" ("experience_type");



CREATE INDEX "idx_curated_teaser_last_served" ON "public"."curated_teaser_cache" USING "btree" ("last_served_at");



CREATE INDEX "idx_custom_holidays_user_person" ON "public"."custom_holidays" USING "btree" ("user_id", "person_id");



CREATE INDEX "idx_direct_message_reactions_message_id" ON "public"."direct_message_reactions" USING "btree" ("message_id");



CREATE INDEX "idx_discover_daily_cache_user_date" ON "public"."discover_daily_cache" USING "btree" ("user_id", "us_date_key" DESC);



CREATE INDEX "idx_discover_daily_cache_user_expiry" ON "public"."discover_daily_cache" USING "btree" ("user_id", "expires_at" DESC);



CREATE INDEX "idx_door_sales_ledger_event_id" ON "public"."door_sales_ledger" USING "btree" ("event_id");



CREATE INDEX "idx_door_sales_ledger_order_id" ON "public"."door_sales_ledger" USING "btree" ("order_id");



CREATE INDEX "idx_engagement_metrics_category" ON "public"."engagement_metrics" USING "btree" ("category", "event_kind", "created_at" DESC);



CREATE INDEX "idx_engagement_metrics_container_kind" ON "public"."engagement_metrics" USING "btree" ("container_key", "event_kind") WHERE ("container_key" IS NOT NULL);



CREATE INDEX "idx_engagement_metrics_experience" ON "public"."engagement_metrics" USING "btree" ("experience_type", "event_kind", "created_at" DESC) WHERE ("experience_type" IS NOT NULL);



CREATE INDEX "idx_engagement_metrics_place_kind" ON "public"."engagement_metrics" USING "btree" ("place_pool_id", "event_kind") WHERE ("place_pool_id" IS NOT NULL);



CREATE INDEX "idx_engagement_metrics_user_created" ON "public"."engagement_metrics" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_event_dates_event_id" ON "public"."event_dates" USING "btree" ("event_id");



CREATE INDEX "idx_event_dates_start_at" ON "public"."event_dates" USING "btree" ("start_at");



CREATE UNIQUE INDEX "idx_event_scanners_event_user_active" ON "public"."event_scanners" USING "btree" ("event_id", "user_id") WHERE ("removed_at" IS NULL);



CREATE INDEX "idx_event_scanners_user_id" ON "public"."event_scanners" USING "btree" ("user_id");



CREATE INDEX "idx_events_brand_id" ON "public"."events" USING "btree" ("brand_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_events_brand_slug_active" ON "public"."events" USING "btree" ("brand_id", "lower"("slug")) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_events_brand_status" ON "public"."events" USING "btree" ("brand_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_events_published_at" ON "public"."events" USING "btree" ("published_at") WHERE (("deleted_at" IS NULL) AND ("published_at" IS NOT NULL));



CREATE INDEX "idx_friends_user_id" ON "public"."friends" USING "btree" ("user_id");



CREATE INDEX "idx_leaderboard_presence_geo" ON "public"."leaderboard_presence" USING "btree" ("lat", "lng") WHERE (("is_discoverable" = true) AND ("available_seats" > 0));



CREATE INDEX "idx_leaderboard_presence_recency" ON "public"."leaderboard_presence" USING "btree" ("last_swipe_at" DESC) WHERE (("is_discoverable" = true) AND ("available_seats" > 0));



CREATE INDEX "idx_message_reads_message_id" ON "public"."message_reads" USING "btree" ("message_id");



CREATE INDEX "idx_message_reads_user_id" ON "public"."message_reads" USING "btree" ("user_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_messages_conversation_id" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_messages_created_at" ON "public"."messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_messages_reply_to" ON "public"."messages" USING "btree" ("reply_to_id") WHERE ("reply_to_id" IS NOT NULL);



CREATE INDEX "idx_messages_sender_id" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_muted_users_muted" ON "public"."muted_users" USING "btree" ("muted_id");



CREATE INDEX "idx_muted_users_muter" ON "public"."muted_users" USING "btree" ("muter_id");



CREATE INDEX "idx_notification_preferences_user_id" ON "public"."notification_preferences" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_expires" ON "public"."notifications" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "idx_notifications_idempotency" ON "public"."notifications" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "idx_notifications_related_id" ON "public"."notifications" USING "btree" ("related_id") WHERE ("related_id" IS NOT NULL);



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id") WHERE ("is_read" = false);



CREATE INDEX "idx_order_line_items_order_id" ON "public"."order_line_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_line_items_ticket_type_id" ON "public"."order_line_items" USING "btree" ("ticket_type_id");



CREATE INDEX "idx_orders_buyer_user_id" ON "public"."orders" USING "btree" ("buyer_user_id");



CREATE INDEX "idx_orders_created_at" ON "public"."orders" USING "btree" ("created_at");



CREATE INDEX "idx_orders_event_id" ON "public"."orders" USING "btree" ("event_id");



CREATE INDEX "idx_orders_payment_status" ON "public"."orders" USING "btree" ("payment_status");



CREATE INDEX "idx_pair_requests_gated" ON "public"."pair_requests" USING "btree" ("gated_by_friend_request_id") WHERE ("visibility" = 'hidden_until_friend'::"text");



CREATE INDEX "idx_pair_requests_receiver" ON "public"."pair_requests" USING "btree" ("receiver_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_pair_requests_sender" ON "public"."pair_requests" USING "btree" ("sender_id");



CREATE UNIQUE INDEX "idx_pair_requests_unique_active" ON "public"."pair_requests" USING "btree" ("sender_id", "receiver_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"]));



CREATE INDEX "idx_pairings_user_a" ON "public"."pairings" USING "btree" ("user_a_id");



CREATE INDEX "idx_pairings_user_b" ON "public"."pairings" USING "btree" ("user_b_id");



CREATE INDEX "idx_payment_webhook_events_processed" ON "public"."payment_webhook_events" USING "btree" ("processed");



CREATE UNIQUE INDEX "idx_payment_webhook_events_stripe_event_id" ON "public"."payment_webhook_events" USING "btree" ("stripe_event_id");



CREATE INDEX "idx_payouts_brand_id" ON "public"."payouts" USING "btree" ("brand_id");



CREATE INDEX "idx_pending_invites_phone" ON "public"."pending_invites" USING "btree" ("phone_e164") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_pending_session_invites_phone" ON "public"."pending_session_invites" USING "btree" ("phone_e164") WHERE ("status" = 'pending'::"text");



CREATE UNIQUE INDEX "idx_person_place_impressions_paired_user" ON "public"."person_card_impressions" USING "btree" ("user_id", "paired_user_id", "place_pool_id") WHERE ("paired_user_id" IS NOT NULL);



CREATE INDEX "idx_person_place_impressions_person_place" ON "public"."person_card_impressions" USING "btree" ("user_id", "person_id", "place_pool_id");



CREATE INDEX "idx_photo_aesthetic_batches_anthropic" ON "public"."photo_aesthetic_batches" USING "btree" ("anthropic_batch_id") WHERE ("anthropic_batch_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_photo_aesthetic_batches_run_index" ON "public"."photo_aesthetic_batches" USING "btree" ("run_id", "batch_index");



CREATE INDEX "idx_photo_aesthetic_batches_run_status" ON "public"."photo_aesthetic_batches" USING "btree" ("run_id", "status");



CREATE UNIQUE INDEX "idx_photo_aesthetic_labels_anchor_category_unique" ON "public"."photo_aesthetic_labels" USING "btree" ("label_category") WHERE (("role" = 'anchor'::"text") AND ("committed_at" IS NOT NULL));



CREATE INDEX "idx_photo_aesthetic_labels_role_city" ON "public"."photo_aesthetic_labels" USING "btree" ("role", "city") WHERE ("role" = 'fixture'::"text");



CREATE INDEX "idx_photo_aesthetic_labels_role_committed" ON "public"."photo_aesthetic_labels" USING "btree" ("role", "committed_at") WHERE ("committed_at" IS NOT NULL);



CREATE INDEX "idx_photo_aesthetic_runs_city" ON "public"."photo_aesthetic_runs" USING "btree" ("city", "country");



CREATE INDEX "idx_photo_aesthetic_runs_created" ON "public"."photo_aesthetic_runs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_photo_aesthetic_runs_status" ON "public"."photo_aesthetic_runs" USING "btree" ("status");



CREATE INDEX "idx_photo_batches_run" ON "public"."photo_backfill_batches" USING "btree" ("run_id");



CREATE INDEX "idx_photo_batches_status" ON "public"."photo_backfill_batches" USING "btree" ("run_id", "status");



CREATE INDEX "idx_photo_runs_city" ON "public"."photo_backfill_runs" USING "btree" ("city", "country");



CREATE INDEX "idx_photo_runs_status" ON "public"."photo_backfill_runs" USING "btree" ("status");



CREATE INDEX "idx_pit_runs_place" ON "public"."place_intelligence_trial_runs" USING "btree" ("place_pool_id", "created_at" DESC);



CREATE INDEX "idx_pit_runs_run_id" ON "public"."place_intelligence_trial_runs" USING "btree" ("run_id");



CREATE INDEX "idx_pit_runs_status" ON "public"."place_intelligence_trial_runs" USING "btree" ("status");



CREATE INDEX "idx_place_admin_actions_acted_at" ON "public"."place_admin_actions" USING "btree" ("acted_at" DESC);



CREATE INDEX "idx_place_admin_actions_place" ON "public"."place_admin_actions" USING "btree" ("place_id");



CREATE INDEX "idx_place_admin_actions_type" ON "public"."place_admin_actions" USING "btree" ("action_type");



CREATE UNIQUE INDEX "idx_place_external_reviews_dedup" ON "public"."place_external_reviews" USING "btree" ("place_pool_id", "source", "source_review_id");



CREATE INDEX "idx_place_external_reviews_fetched" ON "public"."place_external_reviews" USING "btree" ("place_pool_id", "fetched_at" DESC);



CREATE INDEX "idx_place_external_reviews_recency" ON "public"."place_external_reviews" USING "btree" ("place_pool_id", "posted_at" DESC NULLS LAST);



CREATE INDEX "idx_place_pool_business_status_active" ON "public"."place_pool" USING "btree" ("business_status") WHERE ("is_active" = true);



CREATE INDEX "idx_place_pool_city" ON "public"."place_pool" USING "btree" ("city");



CREATE INDEX "idx_place_pool_city_id" ON "public"."place_pool" USING "btree" ("city_id");



CREATE INDEX "idx_place_pool_claimed_by" ON "public"."place_pool" USING "btree" ("claimed_by") WHERE ("claimed_by" IS NOT NULL);



CREATE INDEX "idx_place_pool_country" ON "public"."place_pool" USING "btree" ("country");



CREATE INDEX "idx_place_pool_geo" ON "public"."place_pool" USING "btree" ("lat", "lng") WHERE ("is_active" = true);



CREATE INDEX "idx_place_pool_google_id" ON "public"."place_pool" USING "btree" ("google_place_id");



CREATE INDEX "idx_place_pool_has_collage" ON "public"."place_pool" USING "btree" ((1)) WHERE ("photo_collage_url" IS NOT NULL);



CREATE INDEX "idx_place_pool_needs_photos" ON "public"."place_pool" USING "btree" ("created_at") WHERE (("is_active" = true) AND ("stored_photo_urls" IS NULL) AND ("photos" IS NOT NULL));



CREATE INDEX "idx_place_pool_photo_aesthetic_unscored" ON "public"."place_pool" USING "btree" ((1)) WHERE (("photo_aesthetic_data" IS NULL) AND ("is_servable" = true) AND ("is_active" = true));



CREATE INDEX "idx_place_pool_pre_photo_passed" ON "public"."place_pool" USING "btree" ("city_id", "passes_pre_photo_check") WHERE ("passes_pre_photo_check" = true);



CREATE INDEX "idx_place_pool_price_tiers" ON "public"."place_pool" USING "gin" ("price_tiers");



CREATE INDEX "idx_place_pool_refresh" ON "public"."place_pool" USING "btree" ("last_detail_refresh") WHERE ("is_active" = true);



CREATE INDEX "idx_place_pool_serves_brunch" ON "public"."place_pool" USING "btree" ("city_id") WHERE (("serves_brunch" = true) AND ("is_active" = true));



CREATE INDEX "idx_place_pool_serves_dinner" ON "public"."place_pool" USING "btree" ("city_id") WHERE (("serves_dinner" = true) AND ("is_active" = true));



CREATE INDEX "idx_place_pool_types" ON "public"."place_pool" USING "gin" ("types") WHERE ("is_active" = true);



CREATE INDEX "idx_place_reviews_google_place" ON "public"."place_reviews" USING "btree" ("google_place_id") WHERE ("google_place_id" IS NOT NULL);



CREATE INDEX "idx_place_reviews_place_pool" ON "public"."place_reviews" USING "btree" ("place_pool_id") WHERE ("place_pool_id" IS NOT NULL);



CREATE INDEX "idx_place_reviews_user" ON "public"."place_reviews" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_preference_history_created_at" ON "public"."preference_history" USING "btree" ("created_at");



CREATE INDEX "idx_preference_history_preference_id" ON "public"."preference_history" USING "btree" ("preference_id");



CREATE INDEX "idx_preference_history_user_id" ON "public"."preference_history" USING "btree" ("user_id");



CREATE INDEX "idx_preferences_date_option" ON "public"."preferences" USING "btree" ("date_option") WHERE ("date_option" IS NOT NULL);



CREATE INDEX "idx_profiles_country" ON "public"."profiles" USING "btree" ("country") WHERE ("country" IS NOT NULL);



CREATE INDEX "idx_profiles_email_verified" ON "public"."profiles" USING "btree" ("email_verified");



CREATE INDEX "idx_profiles_has_completed_onboarding" ON "public"."profiles" USING "btree" ("has_completed_onboarding");



CREATE INDEX "idx_profiles_is_seed" ON "public"."profiles" USING "btree" ("is_seed") WHERE ("is_seed" = true);



CREATE INDEX "idx_profiles_onboarding_step" ON "public"."profiles" USING "btree" ("onboarding_step");



CREATE INDEX "idx_profiles_phone" ON "public"."profiles" USING "btree" ("phone") WHERE ("phone" IS NOT NULL);



CREATE INDEX "idx_profiles_referral_code" ON "public"."profiles" USING "btree" ("referral_code") WHERE ("referral_code" IS NOT NULL);



CREATE INDEX "idx_profiles_username" ON "public"."profiles" USING "btree" ("username");



CREATE INDEX "idx_refresh_batches_city" ON "public"."refresh_batches" USING "btree" ("city_id");



CREATE UNIQUE INDEX "idx_refresh_batches_order" ON "public"."refresh_batches" USING "btree" ("run_id", "batch_index");



CREATE INDEX "idx_refresh_batches_run" ON "public"."refresh_batches" USING "btree" ("run_id");



CREATE INDEX "idx_refresh_batches_status" ON "public"."refresh_batches" USING "btree" ("status");



CREATE INDEX "idx_refresh_runs_city" ON "public"."refresh_runs" USING "btree" ("city_id");



CREATE INDEX "idx_refresh_runs_city_status" ON "public"."refresh_runs" USING "btree" ("city_id", "status");



CREATE INDEX "idx_refresh_runs_created" ON "public"."refresh_runs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_refresh_runs_status" ON "public"."refresh_runs" USING "btree" ("status");



CREATE INDEX "idx_refunds_order_id" ON "public"."refunds" USING "btree" ("order_id");



CREATE INDEX "idx_rr_city_lock" ON "public"."rules_runs" USING "btree" ("city_id", "status") WHERE ("status" = ANY (ARRAY['ready'::"text", 'running'::"text", 'paused'::"text"]));



CREATE INDEX "idx_rr_rules_version" ON "public"."rules_runs" USING "btree" ("rules_version_id") WHERE ("rules_version_id" IS NOT NULL);



CREATE INDEX "idx_rr_status" ON "public"."rules_runs" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['ready'::"text", 'running'::"text", 'paused'::"text"]));



CREATE INDEX "idx_rrr_confidence" ON "public"."rules_run_results" USING "btree" ("confidence");



CREATE INDEX "idx_rrr_decision" ON "public"."rules_run_results" USING "btree" ("decision");



CREATE INDEX "idx_rrr_job_decision" ON "public"."rules_run_results" USING "btree" ("job_id", "decision", "created_at" DESC);



CREATE INDEX "idx_rrr_job_id" ON "public"."rules_run_results" USING "btree" ("job_id");



CREATE INDEX "idx_rrr_place_id" ON "public"."rules_run_results" USING "btree" ("place_id");



CREATE INDEX "idx_rrr_place_id_created_at" ON "public"."rules_run_results" USING "btree" ("place_id", "created_at" DESC);



CREATE INDEX "idx_rrr_review_queue" ON "public"."rules_run_results" USING "btree" ("job_id", "created_at" DESC) WHERE (("confidence" = 'low'::"text") OR ("decision" = 'reclassify'::"text") OR ("overridden" = true));



CREATE INDEX "idx_rrr_rule_set_version" ON "public"."rules_run_results" USING "btree" ("rule_set_version_id", "created_at" DESC) WHERE ("rule_set_version_id" IS NOT NULL);



CREATE INDEX "idx_rule_entries_value" ON "public"."rule_entries" USING "btree" ("value");



CREATE INDEX "idx_rule_entries_version" ON "public"."rule_entries" USING "btree" ("rule_set_version_id");



CREATE INDEX "idx_rule_set_versions_created" ON "public"."rule_set_versions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_rule_set_versions_rule" ON "public"."rule_set_versions" USING "btree" ("rule_set_id", "version_number" DESC);



CREATE INDEX "idx_rule_sets_active" ON "public"."rule_sets" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_rule_sets_kind" ON "public"."rule_sets" USING "btree" ("kind");



CREATE INDEX "idx_rule_sets_scope" ON "public"."rule_sets" USING "btree" ("scope_kind", "scope_value");



CREATE INDEX "idx_rules_versions_deployed" ON "public"."rules_versions" USING "btree" ("deployed_at" DESC);



CREATE INDEX "idx_saved_people_user_id" ON "public"."saved_people" USING "btree" ("user_id");



CREATE INDEX "idx_scan_events_event_id" ON "public"."scan_events" USING "btree" ("event_id");



CREATE INDEX "idx_scan_events_scanned_at" ON "public"."scan_events" USING "btree" ("scanned_at");



CREATE INDEX "idx_scan_events_ticket_id" ON "public"."scan_events" USING "btree" ("ticket_id");



CREATE INDEX "idx_scanner_invitations_event_id" ON "public"."scanner_invitations" USING "btree" ("event_id");



CREATE UNIQUE INDEX "idx_scanner_invitations_token" ON "public"."scanner_invitations" USING "btree" ("token");



CREATE INDEX "idx_scheduled_activities_scheduled_date" ON "public"."scheduled_activities" USING "btree" ("scheduled_date");



CREATE INDEX "idx_scheduled_activities_user_id" ON "public"."scheduled_activities" USING "btree" ("user_id");



CREATE INDEX "idx_seed_map_presence_city_id" ON "public"."seed_map_presence" USING "btree" ("city_id") WHERE ("city_id" IS NOT NULL);



CREATE INDEX "idx_seed_map_presence_location" ON "public"."seed_map_presence" USING "btree" ("approximate_lat", "approximate_lng");



CREATE INDEX "idx_seeding_batches_city" ON "public"."seeding_batches" USING "btree" ("city_id");



CREATE UNIQUE INDEX "idx_seeding_batches_order" ON "public"."seeding_batches" USING "btree" ("run_id", "batch_index");



CREATE INDEX "idx_seeding_batches_run" ON "public"."seeding_batches" USING "btree" ("run_id");



CREATE INDEX "idx_seeding_batches_status" ON "public"."seeding_batches" USING "btree" ("status");



CREATE INDEX "idx_seeding_operations_city" ON "public"."seeding_operations" USING "btree" ("city_id");



CREATE INDEX "idx_seeding_operations_status" ON "public"."seeding_operations" USING "btree" ("status");



CREATE INDEX "idx_seeding_runs_city" ON "public"."seeding_runs" USING "btree" ("city_id");



CREATE INDEX "idx_seeding_runs_status" ON "public"."seeding_runs" USING "btree" ("status");



CREATE INDEX "idx_seeding_tiles_city" ON "public"."seeding_tiles" USING "btree" ("city_id");



CREATE INDEX "idx_session_participants_has_accepted" ON "public"."session_participants" USING "btree" ("has_accepted");



CREATE INDEX "idx_session_participants_is_admin" ON "public"."session_participants" USING "btree" ("session_id", "is_admin") WHERE ("is_admin" = true);



CREATE INDEX "idx_session_participants_muted" ON "public"."session_participants" USING "btree" ("session_id", "user_id") WHERE ("notifications_muted" = true);



CREATE INDEX "idx_signal_anchors_signal" ON "public"."signal_anchors" USING "btree" ("signal_id");



CREATE UNIQUE INDEX "idx_signal_anchors_unique" ON "public"."signal_anchors" USING "btree" ("signal_id", "anchor_index") WHERE ("committed_at" IS NOT NULL);



CREATE UNIQUE INDEX "idx_stripe_connect_accounts_brand_id" ON "public"."stripe_connect_accounts" USING "btree" ("brand_id");



CREATE INDEX "idx_stripe_connect_accounts_stripe_account_id" ON "public"."stripe_connect_accounts" USING "btree" ("stripe_account_id");



CREATE INDEX "idx_subscriptions_stripe_sub_id" ON "public"."subscriptions" USING "btree" ("stripe_subscription_id") WHERE ("stripe_subscription_id" IS NOT NULL);



CREATE INDEX "idx_subscriptions_user_id" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_tag_along_pending" ON "public"."tag_along_requests" USING "btree" ("sender_id", "receiver_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_tag_along_receiver_pending" ON "public"."tag_along_requests" USING "btree" ("receiver_id", "created_at" DESC) WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_taste_matches_stale" ON "public"."user_taste_matches" USING "btree" ("computed_at");



CREATE INDEX "idx_taste_matches_user_a" ON "public"."user_taste_matches" USING "btree" ("user_a_id");



CREATE INDEX "idx_taste_matches_user_b" ON "public"."user_taste_matches" USING "btree" ("user_b_id");



CREATE INDEX "idx_ticket_types_event_display" ON "public"."ticket_types" USING "btree" ("event_id", "display_order") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ticket_types_event_id" ON "public"."ticket_types" USING "btree" ("event_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tickets_event_id" ON "public"."tickets" USING "btree" ("event_id");



CREATE INDEX "idx_tickets_order_id" ON "public"."tickets" USING "btree" ("order_id");



CREATE UNIQUE INDEX "idx_tickets_qr_code" ON "public"."tickets" USING "btree" ("qr_code");



CREATE INDEX "idx_tickets_status" ON "public"."tickets" USING "btree" ("status");



CREATE INDEX "idx_tm_cache_expires" ON "public"."ticketmaster_events_cache" USING "btree" ("expires_at");



CREATE INDEX "idx_tm_cache_key" ON "public"."ticketmaster_events_cache" USING "btree" ("cache_key");



CREATE INDEX "idx_undo_actions_expires_at" ON "public"."undo_actions" USING "btree" ("expires_at");



CREATE INDEX "idx_undo_actions_timestamp" ON "public"."undo_actions" USING "btree" ("timestamp");



CREATE INDEX "idx_undo_actions_type" ON "public"."undo_actions" USING "btree" ("type");



CREATE INDEX "idx_undo_actions_user_id" ON "public"."undo_actions" USING "btree" ("user_id");



CREATE INDEX "idx_user_activity_created_at" ON "public"."user_activity" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_user_activity_user_created" ON "public"."user_activity" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_user_activity_user_id" ON "public"."user_activity" USING "btree" ("user_id");



CREATE INDEX "idx_user_interactions_created_at" ON "public"."user_interactions" USING "btree" ("created_at");



CREATE INDEX "idx_user_interactions_session_id" ON "public"."user_interactions" USING "btree" ("session_id");



CREATE INDEX "idx_user_interactions_type" ON "public"."user_interactions" USING "btree" ("interaction_type");



CREATE INDEX "idx_user_interactions_user_id" ON "public"."user_interactions" USING "btree" ("user_id");



CREATE INDEX "idx_user_location_history_created_at" ON "public"."user_location_history" USING "btree" ("created_at");



CREATE INDEX "idx_user_location_history_type" ON "public"."user_location_history" USING "btree" ("location_type");



CREATE INDEX "idx_user_location_history_user_id" ON "public"."user_location_history" USING "btree" ("user_id");



CREATE INDEX "idx_user_map_settings_approx_location" ON "public"."user_map_settings" USING "btree" ("approximate_lat", "approximate_lng") WHERE ("visibility_level" <> 'off'::"text");



CREATE INDEX "idx_user_map_settings_visibility" ON "public"."user_map_settings" USING "btree" ("visibility_level") WHERE ("visibility_level" <> 'off'::"text");



CREATE INDEX "idx_user_pref_type_value_confidence" ON "public"."user_preference_learning" USING "btree" ("user_id", "preference_type", "preference_value" DESC, "confidence");



CREATE INDEX "idx_user_preference_learning_type" ON "public"."user_preference_learning" USING "btree" ("preference_type");



CREATE INDEX "idx_user_preference_learning_user_id" ON "public"."user_preference_learning" USING "btree" ("user_id");



CREATE INDEX "idx_user_preference_learning_value" ON "public"."user_preference_learning" USING "btree" ("preference_value");



CREATE INDEX "idx_user_push_tokens_updated_at" ON "public"."user_push_tokens" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_user_push_tokens_user_id" ON "public"."user_push_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_user_reports_created" ON "public"."user_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_user_reports_reported" ON "public"."user_reports" USING "btree" ("reported_user_id");



CREATE INDEX "idx_user_reports_reporter" ON "public"."user_reports" USING "btree" ("reporter_id");



CREATE INDEX "idx_user_reports_status" ON "public"."user_reports" USING "btree" ("status");



CREATE INDEX "idx_user_sessions_active" ON "public"."user_sessions" USING "btree" ("is_active");



CREATE INDEX "idx_user_sessions_user_id" ON "public"."user_sessions" USING "btree" ("user_id");



CREATE INDEX "idx_user_visits_count" ON "public"."user_visits" USING "btree" ("user_id", "experience_id");



CREATE INDEX "idx_user_visits_experience" ON "public"."user_visits" USING "btree" ("experience_id");



CREATE INDEX "idx_user_visits_user_visited" ON "public"."user_visits" USING "btree" ("user_id", "visited_at" DESC);



CREATE INDEX "idx_waitlist_entries_event_id" ON "public"."waitlist_entries" USING "btree" ("event_id");



CREATE INDEX "idx_waitlist_entries_ticket_type_id" ON "public"."waitlist_entries" USING "btree" ("ticket_type_id");



CREATE INDEX "match_telemetry_created_at_idx" ON "public"."match_telemetry_events" USING "btree" ("created_at");



CREATE INDEX "match_telemetry_event_type_idx" ON "public"."match_telemetry_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "match_telemetry_reason_idx" ON "public"."match_telemetry_events" USING "btree" ("reason", "created_at" DESC) WHERE ("reason" IS NOT NULL);



CREATE INDEX "match_telemetry_session_idx" ON "public"."match_telemetry_events" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "place_pool_bouncer_validated_at_idx" ON "public"."place_pool" USING "btree" ("bouncer_validated_at") WHERE ("bouncer_validated_at" IS NOT NULL);



CREATE INDEX "place_pool_is_servable_idx" ON "public"."place_pool" USING "btree" ("is_servable") WHERE ("is_servable" = true);



CREATE INDEX "place_scores_place_id_idx" ON "public"."place_scores" USING "btree" ("place_id");



CREATE INDEX "place_scores_signal_score_idx" ON "public"."place_scores" USING "btree" ("signal_id", "score" DESC) WHERE ("score" > (0)::numeric);



CREATE UNIQUE INDEX "saved_card_profile_experience_idx" ON "public"."saved_card" USING "btree" ("profile_id", "experience_id");



CREATE INDEX "signal_definition_versions_signal_id_idx" ON "public"."signal_definition_versions" USING "btree" ("signal_id", "created_at" DESC);



CREATE UNIQUE INDEX "uq_collab_invites_session_user_active" ON "public"."collaboration_invites" USING "btree" ("session_id", "invited_user_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"]));



CREATE UNIQUE INDEX "uq_person_place_impression" ON "public"."person_card_impressions" USING "btree" ("user_id", "person_id", "place_pool_id");



CREATE UNIQUE INDEX "user_visits_unique_active" ON "public"."user_visits" USING "btree" ("user_id", "experience_id") WHERE ("user_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "accept_friend_request_trigger" AFTER UPDATE ON "public"."friends" FOR EACH ROW EXECUTE FUNCTION "public"."accept_friend_request"();



CREATE OR REPLACE TRIGGER "add_board_card_trigger" AFTER INSERT ON "public"."board_cards" FOR EACH ROW EXECUTE FUNCTION "public"."add_board_card"();



CREATE OR REPLACE TRIGGER "auto_create_presence_on_join" AFTER INSERT ON "public"."session_participants" FOR EACH ROW EXECUTE FUNCTION "public"."auto_create_presence"();



CREATE OR REPLACE TRIGGER "auto_generate_invite_on_session_create" BEFORE INSERT ON "public"."collaboration_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."auto_generate_invite_info"();



CREATE OR REPLACE TRIGGER "check_mutual_like_trigger" AFTER INSERT OR UPDATE ON "public"."board_user_swipe_states" FOR EACH ROW EXECUTE FUNCTION "public"."check_mutual_like"();



CREATE OR REPLACE TRIGGER "enforce_session_creation_limit_trigger" BEFORE INSERT ON "public"."collaboration_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_session_creation_limit"();



CREATE OR REPLACE TRIGGER "handle_board_vote_trigger" AFTER INSERT OR UPDATE ON "public"."board_votes" FOR EACH ROW EXECUTE FUNCTION "public"."handle_board_vote"();



CREATE OR REPLACE TRIGGER "mark_offline_on_leave" AFTER DELETE ON "public"."session_participants" FOR EACH ROW EXECUTE FUNCTION "public"."mark_presence_offline"();



CREATE OR REPLACE TRIGGER "notification_preferences_updated_at" BEFORE UPDATE ON "public"."notification_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_notification_preferences_updated_at"();



CREATE OR REPLACE TRIGGER "on_friend_accept_reveal_pair_requests" AFTER UPDATE OF "status" ON "public"."friend_requests" FOR EACH ROW EXECUTE FUNCTION "public"."reveal_pair_requests_on_friend_accept"();



CREATE OR REPLACE TRIGGER "on_phone_verified_convert_pair_invites" AFTER UPDATE OF "phone" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."convert_pending_pair_invites_on_phone_verified"();



CREATE OR REPLACE TRIGGER "on_user_blocked" AFTER INSERT ON "public"."blocked_users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_user_blocked"();



CREATE OR REPLACE TRIGGER "pair_requests_updated_at" BEFORE UPDATE ON "public"."pair_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "rule_entries_no_update" BEFORE UPDATE ON "public"."rule_entries" FOR EACH ROW EXECUTE FUNCTION "public"."tg_rule_entries_block_update"();



CREATE OR REPLACE TRIGGER "rule_set_versions_no_update" BEFORE UPDATE ON "public"."rule_set_versions" FOR EACH ROW EXECUTE FUNCTION "public"."tg_rule_set_versions_block_update"();



CREATE OR REPLACE TRIGGER "set_admin_overrides_updated_at" BEFORE UPDATE ON "public"."admin_subscription_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_app_config_updated_at" BEFORE UPDATE ON "public"."app_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_beta_feedback_updated_at" BEFORE UPDATE ON "public"."beta_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_feature_flags_updated_at" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_integrations_updated_at" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_audit_log_block_update" BEFORE DELETE OR UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."biz_audit_log_block_mutate"();



CREATE OR REPLACE TRIGGER "trg_auto_city_seeded_status" AFTER INSERT OR UPDATE OF "city_id", "is_active" ON "public"."place_pool" FOR EACH ROW EXECUTE FUNCTION "public"."auto_update_city_seeded_status"();



CREATE OR REPLACE TRIGGER "trg_brands_immutable_account_id" BEFORE UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."biz_prevent_brand_account_id_change"();



CREATE OR REPLACE TRIGGER "trg_brands_immutable_slug" BEFORE UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."biz_prevent_brand_slug_change"();



COMMENT ON TRIGGER "trg_brands_immutable_slug" ON "public"."brands" IS 'I-17 — brand slug FROZEN at creation. Cycle 7 /b/{brandSlug} share URLs and IG-bio links depend on permanence. Mirrors biz_prevent_brand_account_id_change.';



CREATE OR REPLACE TRIGGER "trg_brands_updated_at" BEFORE UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_cascade_fr_decline_to_links" AFTER UPDATE ON "public"."friend_requests" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_friend_request_decline_to_links"();



CREATE OR REPLACE TRIGGER "trg_cascade_friend_decline" AFTER UPDATE ON "public"."friend_requests" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_friend_decline_to_collabs"();



CREATE OR REPLACE TRIGGER "trg_cleanup_session_under_two_participants" AFTER DELETE OR UPDATE ON "public"."session_participants" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_session_if_under_two_participants"();



CREATE OR REPLACE TRIGGER "trg_clear_notification_on_collab_invite_resolved" AFTER UPDATE ON "public"."collaboration_invites" FOR EACH ROW WHEN ((("old"."status" = 'pending'::"text") AND ("new"."status" IS DISTINCT FROM 'pending'::"text"))) EXECUTE FUNCTION "public"."delete_notifications_on_entity_resolved"();



CREATE OR REPLACE TRIGGER "trg_clear_notification_on_friend_request_resolved" AFTER UPDATE ON "public"."friend_requests" FOR EACH ROW WHEN ((("old"."status" = 'pending'::"text") AND ("new"."status" IS DISTINCT FROM 'pending'::"text"))) EXECUTE FUNCTION "public"."delete_notifications_on_entity_resolved"();



CREATE OR REPLACE TRIGGER "trg_clear_notification_on_pair_request_resolved" AFTER UPDATE ON "public"."pair_requests" FOR EACH ROW WHEN ((("old"."status" = 'pending'::"text") AND ("new"."status" IS DISTINCT FROM 'pending'::"text"))) EXECUTE FUNCTION "public"."delete_notifications_on_entity_resolved"();



CREATE OR REPLACE TRIGGER "trg_collab_session_end" AFTER UPDATE OF "status" ON "public"."collaboration_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_collab_session_end"();



CREATE OR REPLACE TRIGGER "trg_convert_pending_invites_on_phone" AFTER UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."convert_pending_invites_on_phone_verified"();



CREATE OR REPLACE TRIGGER "trg_create_subscription_on_onboarding" AFTER UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."create_subscription_on_onboarding_complete"();



CREATE OR REPLACE TRIGGER "trg_create_subscription_on_signup" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."create_subscription_on_signup"();



CREATE OR REPLACE TRIGGER "trg_creator_accounts_updated_at" BEFORE UPDATE ON "public"."creator_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_credit_referral_on_friend_accepted" AFTER UPDATE ON "public"."friend_requests" FOR EACH ROW EXECUTE FUNCTION "public"."credit_referral_on_friend_accepted"();



CREATE OR REPLACE TRIGGER "trg_event_dates_immutable_event_id" BEFORE UPDATE ON "public"."event_dates" FOR EACH ROW EXECUTE FUNCTION "public"."biz_prevent_event_dates_event_id_change"();



CREATE OR REPLACE TRIGGER "trg_event_dates_updated_at" BEFORE UPDATE ON "public"."event_dates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_events_immutable_brand_id" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."biz_prevent_event_brand_id_change"();



CREATE OR REPLACE TRIGGER "trg_events_immutable_created_by" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."biz_prevent_event_created_by_change"();



COMMENT ON TRIGGER "trg_events_immutable_created_by" ON "public"."events" IS 'events.created_by FROZEN — audit-trail integrity. Even event_manager+ cannot rewrite who created an event.';



CREATE OR REPLACE TRIGGER "trg_events_immutable_slug" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."biz_prevent_event_slug_change"();



COMMENT ON TRIGGER "trg_events_immutable_slug" ON "public"."events" IS 'Event slug FROZEN at creation. Cycle 7 /e/{brandSlug}/{eventSlug} share URLs depend on permanence. Mirrors biz_prevent_brand_account_id_change.';



CREATE OR REPLACE TRIGGER "trg_events_updated_at" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_fan_review_to_engagement" AFTER INSERT ON "public"."place_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."fan_review_to_engagement"();



CREATE OR REPLACE TRIGGER "trg_fan_visit_to_engagement" AFTER INSERT ON "public"."user_visits" FOR EACH ROW EXECUTE FUNCTION "public"."fan_visit_to_engagement"();



CREATE OR REPLACE TRIGGER "trg_generate_referral_code" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."generate_referral_code"();



CREATE OR REPLACE TRIGGER "trg_orders_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_photo_aesthetic_labels_set_updated_at" BEFORE UPDATE ON "public"."photo_aesthetic_labels" FOR EACH ROW EXECUTE FUNCTION "public"."tg_photo_aesthetic_labels_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_scan_events_block_update" BEFORE DELETE OR UPDATE ON "public"."scan_events" FOR EACH ROW EXECUTE FUNCTION "public"."biz_scan_events_block_mutate"();



CREATE OR REPLACE TRIGGER "trg_scan_events_ticket_event" BEFORE INSERT OR UPDATE ON "public"."scan_events" FOR EACH ROW EXECUTE FUNCTION "public"."biz_scan_events_enforce_ticket_event"();



CREATE OR REPLACE TRIGGER "trg_signal_anchors_set_updated_at" BEFORE UPDATE ON "public"."signal_anchors" FOR EACH ROW EXECUTE FUNCTION "public"."tg_signal_anchors_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_stripe_connect_accounts_updated_at" BEFORE UPDATE ON "public"."stripe_connect_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_sync_display_name" BEFORE UPDATE OF "first_name", "last_name" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_display_name"();



CREATE OR REPLACE TRIGGER "trg_ticket_types_updated_at" BEFORE UPDATE ON "public"."ticket_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_tickets_consistent_event" BEFORE INSERT OR UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."biz_tickets_enforce_consistent_event"();



CREATE OR REPLACE TRIGGER "trg_tickets_enforce_update" BEFORE UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."biz_tickets_enforce_update"();



CREATE OR REPLACE TRIGGER "trigger_check_card_lock_in" AFTER INSERT OR UPDATE ON "public"."board_card_rsvps" FOR EACH ROW EXECUTE FUNCTION "public"."check_card_lock_in"();



CREATE OR REPLACE TRIGGER "trigger_create_calendar_on_lock" AFTER UPDATE ON "public"."board_saved_cards" FOR EACH ROW WHEN ((("old"."is_locked" = false) AND ("new"."is_locked" = true))) EXECUTE FUNCTION "public"."create_calendar_entries_on_lock"();



CREATE OR REPLACE TRIGGER "trigger_preference_history" AFTER INSERT OR DELETE OR UPDATE ON "public"."preferences" FOR EACH ROW EXECUTE FUNCTION "public"."create_preference_history"();



CREATE OR REPLACE TRIGGER "trigger_sync_message_read_status" AFTER INSERT ON "public"."message_reads" FOR EACH ROW EXECUTE FUNCTION "public"."sync_message_read_status"();



CREATE OR REPLACE TRIGGER "trigger_update_conversation_presence_timestamp" BEFORE UPDATE ON "public"."conversation_presence" FOR EACH ROW EXECUTE FUNCTION "public"."update_conversation_presence_timestamp"();



CREATE OR REPLACE TRIGGER "trigger_update_preferences_from_interaction" AFTER INSERT ON "public"."user_interactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_preferences_from_interaction"();



CREATE OR REPLACE TRIGGER "update_board_card_messages_updated_at" BEFORE UPDATE ON "public"."board_card_messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_board_card_rsvps_updated_at" BEFORE UPDATE ON "public"."board_card_rsvps" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_board_messages_updated_at" BEFORE UPDATE ON "public"."board_messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_board_participant_presence_updated_at" BEFORE UPDATE ON "public"."board_participant_presence" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_board_threads_updated_at" BEFORE UPDATE ON "public"."board_threads" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_board_typing_indicators_updated_at" BEFORE UPDATE ON "public"."board_typing_indicators" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_board_votes_updated_at" BEFORE UPDATE ON "public"."board_votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_boards_updated_at" BEFORE UPDATE ON "public"."boards" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_calendar_entries_updated_at" BEFORE UPDATE ON "public"."calendar_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_card_pool_updated_at" BEFORE UPDATE ON "public"."_archive_card_pool" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_conversation_on_message" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_conversation_on_message"();



CREATE OR REPLACE TRIGGER "update_conversations_updated_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_discover_daily_cache_updated_at" BEFORE UPDATE ON "public"."discover_daily_cache" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_friends_updated_at" BEFORE UPDATE ON "public"."friends" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_place_pool_updated_at" BEFORE UPDATE ON "public"."place_pool" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_place_reviews_updated_at" BEFORE UPDATE ON "public"."place_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_preferences_updated_at" BEFORE UPDATE ON "public"."preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_scheduled_activities_updated_at" BEFORE UPDATE ON "public"."scheduled_activities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_session_activity_on_card_message" AFTER INSERT ON "public"."board_card_messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_session_last_activity"();



CREATE OR REPLACE TRIGGER "update_session_activity_on_message" AFTER INSERT ON "public"."board_messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_session_last_activity"();



CREATE OR REPLACE TRIGGER "update_session_activity_on_rsvp" AFTER INSERT OR UPDATE ON "public"."board_card_rsvps" FOR EACH ROW EXECUTE FUNCTION "public"."update_session_last_activity"();



CREATE OR REPLACE TRIGGER "update_session_activity_on_saved_card" AFTER INSERT ON "public"."board_saved_cards" FOR EACH ROW EXECUTE FUNCTION "public"."update_session_last_activity"();



CREATE OR REPLACE TRIGGER "update_user_interactions_updated_at" BEFORE UPDATE ON "public"."user_interactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_preference_learning_updated_at" BEFORE UPDATE ON "public"."user_preference_learning" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_preferences_from_interaction_trigger" AFTER INSERT ON "public"."user_interactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_preferences_from_interaction"();



CREATE OR REPLACE TRIGGER "update_user_push_tokens_updated_at" BEFORE UPDATE ON "public"."user_push_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "user_reports_updated_at" BEFORE UPDATE ON "public"."user_reports" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_reports_updated_at"();



ALTER TABLE ONLY "public"."account_deletion_requests"
    ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_history"
    ADD CONSTRAINT "activity_history_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_history"
    ADD CONSTRAINT "activity_history_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."board_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_history"
    ADD CONSTRAINT "activity_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_backfill_log"
    ADD CONSTRAINT "admin_backfill_log_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_config"
    ADD CONSTRAINT "admin_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_email_log"
    ADD CONSTRAINT "admin_email_log_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_subscription_overrides"
    ADD CONSTRAINT "admin_subscription_overrides_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_subscription_overrides"
    ADD CONSTRAINT "admin_subscription_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appsflyer_devices"
    ADD CONSTRAINT "appsflyer_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."archived_holidays"
    ADD CONSTRAINT "archived_holidays_paired_user_id_fkey" FOREIGN KEY ("paired_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."archived_holidays"
    ADD CONSTRAINT "archived_holidays_pairing_id_fkey" FOREIGN KEY ("pairing_id") REFERENCES "public"."pairings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."archived_holidays"
    ADD CONSTRAINT "archived_holidays_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."saved_people"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."archived_holidays"
    ADD CONSTRAINT "archived_holidays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beta_feedback"
    ADD CONSTRAINT "beta_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_message_reads"
    ADD CONSTRAINT "board_card_message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."board_card_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_message_reads"
    ADD CONSTRAINT "board_card_message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_messages"
    ADD CONSTRAINT "board_card_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."board_card_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."board_card_messages"
    ADD CONSTRAINT "board_card_messages_saved_card_id_fkey" FOREIGN KEY ("saved_card_id") REFERENCES "public"."board_saved_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_messages"
    ADD CONSTRAINT "board_card_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_messages"
    ADD CONSTRAINT "board_card_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."board_card_rsvps"
    ADD CONSTRAINT "board_card_rsvps_saved_card_id_fkey" FOREIGN KEY ("saved_card_id") REFERENCES "public"."board_saved_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_rsvps"
    ADD CONSTRAINT "board_card_rsvps_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_card_rsvps"
    ADD CONSTRAINT "board_card_rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_cards"
    ADD CONSTRAINT "board_cards_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."board_cards"
    ADD CONSTRAINT "board_cards_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_collaborators"
    ADD CONSTRAINT "board_collaborators_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_collaborators"
    ADD CONSTRAINT "board_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_message_reactions"
    ADD CONSTRAINT "board_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."board_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_message_reactions"
    ADD CONSTRAINT "board_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_message_reads"
    ADD CONSTRAINT "board_message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."board_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_message_reads"
    ADD CONSTRAINT "board_message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_messages"
    ADD CONSTRAINT "board_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."board_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."board_messages"
    ADD CONSTRAINT "board_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_messages"
    ADD CONSTRAINT "board_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."board_participant_presence"
    ADD CONSTRAINT "board_participant_presence_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_participant_presence"
    ADD CONSTRAINT "board_participant_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_saved_cards"
    ADD CONSTRAINT "board_saved_cards_saved_by_fkey" FOREIGN KEY ("saved_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_saved_cards"
    ADD CONSTRAINT "board_saved_cards_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_threads"
    ADD CONSTRAINT "board_threads_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_threads"
    ADD CONSTRAINT "board_threads_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."board_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_threads"
    ADD CONSTRAINT "board_threads_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."board_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_threads"
    ADD CONSTRAINT "board_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."board_typing_indicators"
    ADD CONSTRAINT "board_typing_indicators_saved_card_id_fkey" FOREIGN KEY ("saved_card_id") REFERENCES "public"."board_saved_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_typing_indicators"
    ADD CONSTRAINT "board_typing_indicators_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_typing_indicators"
    ADD CONSTRAINT "board_typing_indicators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_user_swipe_states"
    ADD CONSTRAINT "board_user_swipe_states_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_user_swipe_states"
    ADD CONSTRAINT "board_user_swipe_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."board_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_saved_card_id_fkey" FOREIGN KEY ("saved_card_id") REFERENCES "public"."board_saved_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_votes"
    ADD CONSTRAINT "board_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brand_invitations"
    ADD CONSTRAINT "brand_invitations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand_invitations"
    ADD CONSTRAINT "brand_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."brand_team_members"
    ADD CONSTRAINT "brand_team_members_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand_team_members"
    ADD CONSTRAINT "brand_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."creator_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_entries"
    ADD CONSTRAINT "calendar_entries_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."place_reviews"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_entries"
    ADD CONSTRAINT "calendar_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."_archive_card_pool"
    ADD CONSTRAINT "card_pool_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."_archive_card_pool"
    ADD CONSTRAINT "card_pool_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."_archive_card_pool_stops"
    ADD CONSTRAINT "card_pool_stops_card_pool_id_fkey" FOREIGN KEY ("card_pool_id") REFERENCES "public"."_archive_card_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."_archive_card_pool_stops"
    ADD CONSTRAINT "card_pool_stops_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."_archive_card_pool_stops"
    ADD CONSTRAINT "card_pool_stops_stop_card_pool_id_fkey" FOREIGN KEY ("stop_card_pool_id") REFERENCES "public"."_archive_card_pool"("id");



ALTER TABLE ONLY "public"."collaboration_invites"
    ADD CONSTRAINT "collaboration_invites_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collaboration_invites"
    ADD CONSTRAINT "collaboration_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collaboration_invites"
    ADD CONSTRAINT "collaboration_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collaboration_sessions"
    ADD CONSTRAINT "collaboration_sessions_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."collaboration_sessions"
    ADD CONSTRAINT "collaboration_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_presence"
    ADD CONSTRAINT "conversation_presence_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_presence"
    ADD CONSTRAINT "conversation_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."creator_accounts"
    ADD CONSTRAINT "creator_accounts_default_brand_id_fkey" FOREIGN KEY ("default_brand_id") REFERENCES "public"."brands"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."creator_accounts"
    ADD CONSTRAINT "creator_accounts_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_holidays"
    ADD CONSTRAINT "custom_holidays_paired_user_id_fkey" FOREIGN KEY ("paired_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_holidays"
    ADD CONSTRAINT "custom_holidays_pairing_id_fkey" FOREIGN KEY ("pairing_id") REFERENCES "public"."pairings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_holidays"
    ADD CONSTRAINT "custom_holidays_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."saved_people"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_holidays"
    ADD CONSTRAINT "custom_holidays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direct_message_reactions"
    ADD CONSTRAINT "direct_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direct_message_reactions"
    ADD CONSTRAINT "direct_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discover_daily_cache"
    ADD CONSTRAINT "discover_daily_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."door_sales_ledger"
    ADD CONSTRAINT "door_sales_ledger_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."door_sales_ledger"
    ADD CONSTRAINT "door_sales_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."door_sales_ledger"
    ADD CONSTRAINT "door_sales_ledger_scanner_user_id_fkey" FOREIGN KEY ("scanner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."engagement_metrics"
    ADD CONSTRAINT "engagement_metrics_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."engagement_metrics"
    ADD CONSTRAINT "engagement_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_dates"
    ADD CONSTRAINT "event_dates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_scanners"
    ADD CONSTRAINT "event_scanners_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."event_scanners"
    ADD CONSTRAINT "event_scanners_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_scanners"
    ADD CONSTRAINT "event_scanners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."experience_feedback"
    ADD CONSTRAINT "experience_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_friend_user_id_fkey" FOREIGN KEY ("friend_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leaderboard_presence"
    ADD CONSTRAINT "leaderboard_presence_active_collab_session_id_fkey" FOREIGN KEY ("active_collab_session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leaderboard_presence"
    ADD CONSTRAINT "leaderboard_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_reads"
    ADD CONSTRAINT "message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_reads"
    ADD CONSTRAINT "message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."muted_users"
    ADD CONSTRAINT "muted_users_muted_id_fkey" FOREIGN KEY ("muted_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."muted_users"
    ADD CONSTRAINT "muted_users_muter_id_fkey" FOREIGN KEY ("muter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_line_items"
    ADD CONSTRAINT "order_line_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_line_items"
    ADD CONSTRAINT "order_line_items_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_created_by_scanner_user_fkey" FOREIGN KEY ("created_by_scanner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pair_requests"
    ADD CONSTRAINT "pair_requests_gated_by_friend_request_id_fkey" FOREIGN KEY ("gated_by_friend_request_id") REFERENCES "public"."friend_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pair_requests"
    ADD CONSTRAINT "pair_requests_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pair_requests"
    ADD CONSTRAINT "pair_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pairings"
    ADD CONSTRAINT "pairings_pair_request_id_fkey" FOREIGN KEY ("pair_request_id") REFERENCES "public"."pair_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pairings"
    ADD CONSTRAINT "pairings_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pairings"
    ADD CONSTRAINT "pairings_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_converted_user_id_fkey" FOREIGN KEY ("converted_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_pair_invites"
    ADD CONSTRAINT "pending_pair_invites_converted_user_id_fkey" FOREIGN KEY ("converted_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_pair_invites"
    ADD CONSTRAINT "pending_pair_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_session_invites"
    ADD CONSTRAINT "pending_session_invites_converted_invite_id_fkey" FOREIGN KEY ("converted_invite_id") REFERENCES "public"."collaboration_invites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_session_invites"
    ADD CONSTRAINT "pending_session_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_session_invites"
    ADD CONSTRAINT "pending_session_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person_card_impressions"
    ADD CONSTRAINT "person_card_impressions_paired_user_id_fkey" FOREIGN KEY ("paired_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person_card_impressions"
    ADD CONSTRAINT "person_card_impressions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."saved_people"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person_card_impressions"
    ADD CONSTRAINT "person_card_impressions_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."person_card_impressions"
    ADD CONSTRAINT "person_card_impressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_aesthetic_batches"
    ADD CONSTRAINT "photo_aesthetic_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."photo_aesthetic_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_aesthetic_labels"
    ADD CONSTRAINT "photo_aesthetic_labels_labeled_by_fkey" FOREIGN KEY ("labeled_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."photo_aesthetic_labels"
    ADD CONSTRAINT "photo_aesthetic_labels_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_aesthetic_runs"
    ADD CONSTRAINT "photo_aesthetic_runs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."photo_backfill_batches"
    ADD CONSTRAINT "photo_backfill_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."photo_backfill_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_backfill_runs"
    ADD CONSTRAINT "photo_backfill_runs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."place_admin_actions"
    ADD CONSTRAINT "place_admin_actions_acted_by_fkey" FOREIGN KEY ("acted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."place_admin_actions"
    ADD CONSTRAINT "place_admin_actions_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."place_external_reviews"
    ADD CONSTRAINT "place_external_reviews_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."place_intelligence_trial_runs"
    ADD CONSTRAINT "place_intelligence_trial_runs_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."place_pool"
    ADD CONSTRAINT "place_pool_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."place_pool"
    ADD CONSTRAINT "place_pool_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."place_reviews"
    ADD CONSTRAINT "place_reviews_calendar_entry_id_fkey" FOREIGN KEY ("calendar_entry_id") REFERENCES "public"."calendar_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."place_reviews"
    ADD CONSTRAINT "place_reviews_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."place_reviews"
    ADD CONSTRAINT "place_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."place_scores"
    ADD CONSTRAINT "place_scores_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preference_history"
    ADD CONSTRAINT "preference_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preferences"
    ADD CONSTRAINT "preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey_auth_users" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_friend_request_id_fkey" FOREIGN KEY ("friend_request_id") REFERENCES "public"."friend_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_pending_invite_id_fkey" FOREIGN KEY ("pending_invite_id") REFERENCES "public"."pending_invites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refresh_batches"
    ADD CONSTRAINT "refresh_batches_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refresh_batches"
    ADD CONSTRAINT "refresh_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."refresh_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refresh_runs"
    ADD CONSTRAINT "refresh_runs_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refresh_runs"
    ADD CONSTRAINT "refresh_runs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rule_entries"
    ADD CONSTRAINT "rule_entries_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "public"."rule_set_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rule_set_versions"
    ADD CONSTRAINT "rule_set_versions_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rule_sets"
    ADD CONSTRAINT "rule_sets_current_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."rule_set_versions"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."rules_run_results"
    ADD CONSTRAINT "rules_run_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."rules_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rules_run_results"
    ADD CONSTRAINT "rules_run_results_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rules_run_results"
    ADD CONSTRAINT "rules_run_results_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "public"."rule_set_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rules_runs"
    ADD CONSTRAINT "rules_runs_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rules_runs"
    ADD CONSTRAINT "rules_runs_rules_version_id_fkey" FOREIGN KEY ("rules_version_id") REFERENCES "public"."rules_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."saved_card"
    ADD CONSTRAINT "saved_card_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_people"
    ADD CONSTRAINT "saved_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scan_events"
    ADD CONSTRAINT "scan_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scan_events"
    ADD CONSTRAINT "scan_events_scanner_user_id_fkey" FOREIGN KEY ("scanner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scan_events"
    ADD CONSTRAINT "scan_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scanner_invitations"
    ADD CONSTRAINT "scanner_invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seed_map_presence"
    ADD CONSTRAINT "seed_map_presence_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeding_batches"
    ADD CONSTRAINT "seeding_batches_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeding_batches"
    ADD CONSTRAINT "seeding_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."seeding_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeding_batches"
    ADD CONSTRAINT "seeding_batches_tile_id_fkey" FOREIGN KEY ("tile_id") REFERENCES "public"."seeding_tiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeding_operations"
    ADD CONSTRAINT "seeding_operations_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeding_operations"
    ADD CONSTRAINT "seeding_operations_tile_id_fkey" FOREIGN KEY ("tile_id") REFERENCES "public"."seeding_tiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."seeding_runs"
    ADD CONSTRAINT "seeding_runs_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seeding_tiles"
    ADD CONSTRAINT "seeding_tiles_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."seeding_cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



COMMENT ON CONSTRAINT "session_participants_user_id_fkey" ON "public"."session_participants" IS 'FK from session_participants to profiles for PostgREST relationship auto-detection';



ALTER TABLE ONLY "public"."signal_anchors"
    ADD CONSTRAINT "signal_anchors_labeled_by_fkey" FOREIGN KEY ("labeled_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."signal_anchors"
    ADD CONSTRAINT "signal_anchors_place_pool_id_fkey" FOREIGN KEY ("place_pool_id") REFERENCES "public"."place_pool"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signal_definition_versions"
    ADD CONSTRAINT "signal_definition_versions_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "public"."signal_definitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signal_definitions"
    ADD CONSTRAINT "signal_definitions_current_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."signal_definition_versions"("id");



ALTER TABLE ONLY "public"."stripe_connect_accounts"
    ADD CONSTRAINT "stripe_connect_accounts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tag_along_requests"
    ADD CONSTRAINT "tag_along_requests_collab_session_id_fkey" FOREIGN KEY ("collab_session_id") REFERENCES "public"."collaboration_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tag_along_requests"
    ADD CONSTRAINT "tag_along_requests_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tag_along_requests"
    ADD CONSTRAINT "tag_along_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticket_types"
    ADD CONSTRAINT "ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_approval_decided_by_fkey" FOREIGN KEY ("approval_decided_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_used_by_scanner_id_fkey" FOREIGN KEY ("used_by_scanner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."undo_actions"
    ADD CONSTRAINT "undo_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_activity"
    ADD CONSTRAINT "user_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_interactions"
    ADD CONSTRAINT "user_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_levels"
    ADD CONSTRAINT "user_levels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_location_history"
    ADD CONSTRAINT "user_location_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_map_settings"
    ADD CONSTRAINT "user_map_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preference_learning"
    ADD CONSTRAINT "user_preference_learning_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_reports"
    ADD CONSTRAINT "user_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_reports"
    ADD CONSTRAINT "user_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_reports"
    ADD CONSTRAINT "user_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_sessions"
    ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_taste_matches"
    ADD CONSTRAINT "user_taste_matches_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_taste_matches"
    ADD CONSTRAINT "user_taste_matches_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_visits"
    ADD CONSTRAINT "user_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE CASCADE;



CREATE POLICY "Account owner can insert brand" ON "public"."brands" FOR INSERT TO "authenticated" WITH CHECK ((("account_id" = "auth"."uid"()) AND ("deleted_at" IS NULL)));



CREATE POLICY "Account owner can read own deletion requests" ON "public"."account_deletion_requests" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Admin insert card_generation_runs" ON "public"."card_generation_runs" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "Admin read card_generation_runs" ON "public"."card_generation_runs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "Admins can delete admin_users" ON "public"."admin_users" FOR DELETE USING ("public"."is_admin_user"());



CREATE POLICY "Admins can insert admin_users" ON "public"."admin_users" FOR INSERT WITH CHECK ("public"."is_admin_user"());



CREATE POLICY "Admins can insert audit log" ON "public"."admin_audit_log" FOR INSERT WITH CHECK ("public"."is_admin_user"());



CREATE POLICY "Admins can read admin_users" ON "public"."admin_users" FOR SELECT USING ("public"."is_admin_user"());



CREATE POLICY "Admins can read all feedback" ON "public"."beta_feedback" FOR SELECT USING ("public"."is_admin_user"());



CREATE POLICY "Admins can read all profiles" ON "public"."profiles" FOR SELECT USING ("public"."is_admin_user"());



CREATE POLICY "Admins can read audit log" ON "public"."admin_audit_log" FOR SELECT USING ("public"."is_admin_user"());



CREATE POLICY "Admins can update admin_users" ON "public"."admin_users" FOR UPDATE USING ("public"."is_admin_user"());



CREATE POLICY "Admins can update all profiles" ON "public"."profiles" FOR UPDATE USING ("public"."is_admin_user"()) WITH CHECK ("public"."is_admin_user"());



CREATE POLICY "Admins can update feedback" ON "public"."beta_feedback" FOR UPDATE USING ("public"."is_admin_user"());



CREATE POLICY "Admins can update reports" ON "public"."user_reports" FOR UPDATE USING ("public"."is_admin_user"()) WITH CHECK ("public"."is_admin_user"());



CREATE POLICY "Admins can view all reports" ON "public"."user_reports" FOR SELECT USING ("public"."is_admin_user"());



CREATE POLICY "Admins manage templates" ON "public"."email_templates" USING ("public"."is_admin_user"());



CREATE POLICY "Anyone can read public profiles" ON "public"."profiles" FOR SELECT USING (("visibility_mode" = 'public'::"text"));



CREATE POLICY "Authenticated users can read display interests" ON "public"."preferences" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can read exclusions" ON "public"."category_type_exclusions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Beta testers can insert feedback" ON "public"."beta_feedback" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_beta_tester" = true))))));



CREATE POLICY "Brand admin plus can delete brands" ON "public"."brands" FOR DELETE TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("id"));



CREATE POLICY "Brand admin plus can manage door_sales_ledger" ON "public"."door_sales_ledger" TO "authenticated" USING ("public"."biz_can_manage_payments_for_brand_for_caller"("public"."biz_event_brand_id"("event_id"))) WITH CHECK ("public"."biz_can_manage_payments_for_brand_for_caller"("public"."biz_event_brand_id"("event_id")));



CREATE POLICY "Brand admin plus can manage payouts" ON "public"."payouts" TO "authenticated" USING ("public"."biz_can_manage_payments_for_brand_for_caller"("brand_id")) WITH CHECK ("public"."biz_can_manage_payments_for_brand_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus can manage refunds" ON "public"."refunds" TO "authenticated" USING ("public"."biz_can_manage_payments_for_brand_for_caller"("public"."biz_order_brand_id"("order_id"))) WITH CHECK ("public"."biz_can_manage_payments_for_brand_for_caller"("public"."biz_order_brand_id"("order_id")));



CREATE POLICY "Brand admin plus can manage stripe_connect_accounts" ON "public"."stripe_connect_accounts" TO "authenticated" USING ("public"."biz_can_manage_payments_for_brand_for_caller"("brand_id")) WITH CHECK ("public"."biz_can_manage_payments_for_brand_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus can update brands" ON "public"."brands" FOR UPDATE TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("id")) WITH CHECK ("public"."biz_is_brand_admin_plus_for_caller"("id"));



CREATE POLICY "Brand admin plus delete brand_team_members" ON "public"."brand_team_members" FOR DELETE TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus delete invitations" ON "public"."brand_invitations" FOR DELETE TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus insert brand_team_members" ON "public"."brand_team_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus insert invitations" ON "public"."brand_invitations" FOR INSERT TO "authenticated" WITH CHECK (("public"."biz_is_brand_admin_plus_for_caller"("brand_id") AND ("invited_by" = "auth"."uid"())));



CREATE POLICY "Brand admin plus reads brand audit_log" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus select invitations" ON "public"."brand_invitations" FOR SELECT TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus update brand_team_members" ON "public"."brand_team_members" FOR UPDATE TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("brand_id")) WITH CHECK ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand admin plus update invitations" ON "public"."brand_invitations" FOR UPDATE TO "authenticated" USING ("public"."biz_is_brand_admin_plus_for_caller"("brand_id")) WITH CHECK ("public"."biz_is_brand_admin_plus_for_caller"("brand_id"));



CREATE POLICY "Brand finance_manager rank or above can delete ticket_types" ON "public"."ticket_types" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "ticket_types"."event_id") AND ("e"."deleted_at" IS NULL) AND ("public"."biz_brand_effective_rank_for_caller"("e"."brand_id") >= "public"."biz_role_rank"('finance_manager'::"text"))))));



CREATE POLICY "Brand finance_manager rank or above can insert ticket_types" ON "public"."ticket_types" FOR INSERT TO "authenticated" WITH CHECK ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "ticket_types"."event_id") AND ("e"."deleted_at" IS NULL) AND ("public"."biz_brand_effective_rank_for_caller"("e"."brand_id") >= "public"."biz_role_rank"('finance_manager'::"text")))))));



CREATE POLICY "Brand finance_manager rank or above can update ticket_types" ON "public"."ticket_types" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "ticket_types"."event_id") AND ("e"."deleted_at" IS NULL) AND ("public"."biz_brand_effective_rank_for_caller"("e"."brand_id") >= "public"."biz_role_rank"('finance_manager'::"text")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "ticket_types"."event_id") AND ("e"."deleted_at" IS NULL) AND ("public"."biz_brand_effective_rank_for_caller"("e"."brand_id") >= "public"."biz_role_rank"('finance_manager'::"text"))))));



CREATE POLICY "Brand members can select brands" ON "public"."brands" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."biz_is_brand_member_for_read_for_caller"("id")));



CREATE POLICY "Brand team can select event_dates" ON "public"."event_dates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "event_dates"."event_id") AND ("e"."deleted_at" IS NULL) AND "public"."biz_is_brand_member_for_read_for_caller"("e"."brand_id")))));



CREATE POLICY "Brand team can select events" ON "public"."events" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."biz_is_brand_member_for_read_for_caller"("brand_id")));



CREATE POLICY "Brand team can select scan_events" ON "public"."scan_events" FOR SELECT TO "authenticated" USING ("public"."biz_is_brand_member_for_read"("public"."biz_event_brand_id"("event_id"), "auth"."uid"()));



CREATE POLICY "Brand team can select ticket_types" ON "public"."ticket_types" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "ticket_types"."event_id") AND ("e"."deleted_at" IS NULL) AND "public"."biz_is_brand_member_for_read_for_caller"("e"."brand_id"))))));



CREATE POLICY "Brand team can select waitlist_entries" ON "public"."waitlist_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "waitlist_entries"."event_id") AND ("e"."deleted_at" IS NULL) AND "public"."biz_is_brand_member_for_read_for_caller"("e"."brand_id")))));



CREATE POLICY "Buyer or brand team can select orders" ON "public"."orders" FOR SELECT TO "authenticated" USING ("public"."biz_can_read_order_for_caller"("id"));



CREATE POLICY "Buyer or brand team can select tickets" ON "public"."tickets" FOR SELECT TO "authenticated" USING (("public"."biz_is_brand_member_for_read"("public"."biz_event_brand_id"("event_id"), "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "tickets"."order_id") AND (NOT ("o"."buyer_user_id" IS DISTINCT FROM "auth"."uid"())))))));



CREATE POLICY "Collaborators can delete their own row or owner can delete any" ON "public"."board_collaborators" FOR DELETE USING ((("auth"."uid"() = "user_id") OR "public"."is_board_collaborator_as_owner"("board_id", "auth"."uid"())));



CREATE POLICY "Collaborators can update their own row" ON "public"."board_collaborators" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Collaborators can view board collaborators" ON "public"."board_collaborators" FOR SELECT USING ("public"."is_board_collaborator"("board_id", "auth"."uid"()));



CREATE POLICY "Creators can insert own account" ON "public"."creator_accounts" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Creators can read own account" ON "public"."creator_accounts" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Creators can update own account" ON "public"."creator_accounts" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Event manager plus can delete event_dates" ON "public"."event_dates" FOR DELETE TO "authenticated" USING ("public"."biz_is_event_manager_plus_for_caller"("event_id"));



CREATE POLICY "Event manager plus can delete events" ON "public"."events" FOR DELETE TO "authenticated" USING (("public"."biz_brand_effective_rank_for_caller"("brand_id") >= "public"."biz_role_rank"('event_manager'::"text")));



CREATE POLICY "Event manager plus can insert event_dates" ON "public"."event_dates" FOR INSERT TO "authenticated" WITH CHECK ("public"."biz_is_event_manager_plus_for_caller"("event_id"));



CREATE POLICY "Event manager plus can insert events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK ((("deleted_at" IS NULL) AND ("created_by" = "auth"."uid"()) AND ("public"."biz_brand_effective_rank_for_caller"("brand_id") >= "public"."biz_role_rank"('event_manager'::"text"))));



CREATE POLICY "Event manager plus can manage scanner_invitations" ON "public"."scanner_invitations" TO "authenticated" USING ("public"."biz_is_event_manager_plus_for_caller"("event_id")) WITH CHECK ("public"."biz_is_event_manager_plus_for_caller"("event_id"));



CREATE POLICY "Event manager plus can update event_dates" ON "public"."event_dates" FOR UPDATE TO "authenticated" USING ("public"."biz_is_event_manager_plus_for_caller"("event_id")) WITH CHECK ("public"."biz_is_event_manager_plus_for_caller"("event_id"));



CREATE POLICY "Event manager plus can update events" ON "public"."events" FOR UPDATE TO "authenticated" USING (("public"."biz_brand_effective_rank_for_caller"("brand_id") >= "public"."biz_role_rank"('event_manager'::"text"))) WITH CHECK (("public"."biz_brand_effective_rank_for_caller"("brand_id") >= "public"."biz_role_rank"('event_manager'::"text")));



CREATE POLICY "Event manager plus delete event_scanners" ON "public"."event_scanners" FOR DELETE TO "authenticated" USING ("public"."biz_is_event_manager_plus_for_caller"("event_id"));



CREATE POLICY "Event manager plus insert event_scanners" ON "public"."event_scanners" FOR INSERT TO "authenticated" WITH CHECK (("public"."biz_is_event_manager_plus_for_caller"("event_id") AND ("assigned_by" = "auth"."uid"())));



CREATE POLICY "Event manager plus update event_scanners" ON "public"."event_scanners" FOR UPDATE TO "authenticated" USING ("public"."biz_is_event_manager_plus_for_caller"("event_id")) WITH CHECK ("public"."biz_is_event_manager_plus_for_caller"("event_id"));



CREATE POLICY "Finance plus can delete line items" ON "public"."order_line_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_line_items"."order_id") AND "public"."biz_can_manage_orders_for_event_for_caller"("o"."event_id")))));



CREATE POLICY "Finance plus can delete orders" ON "public"."orders" FOR DELETE TO "authenticated" USING ("public"."biz_can_manage_orders_for_event_for_caller"("event_id"));



CREATE POLICY "Finance plus can insert line items" ON "public"."order_line_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_line_items"."order_id") AND "public"."biz_can_manage_orders_for_event_for_caller"("o"."event_id")))));



CREATE POLICY "Finance plus can insert orders" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK ("public"."biz_can_manage_orders_for_event_for_caller"("event_id"));



CREATE POLICY "Finance plus can update line items" ON "public"."order_line_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_line_items"."order_id") AND "public"."biz_can_manage_orders_for_event_for_caller"("o"."event_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_line_items"."order_id") AND "public"."biz_can_manage_orders_for_event_for_caller"("o"."event_id")))));



CREATE POLICY "Finance plus can update orders" ON "public"."orders" FOR UPDATE TO "authenticated" USING ("public"."biz_can_manage_orders_for_event_for_caller"("event_id")) WITH CHECK ("public"."biz_can_manage_orders_for_event_for_caller"("event_id"));



CREATE POLICY "Finance plus can update tickets" ON "public"."tickets" FOR UPDATE TO "authenticated" USING (("public"."biz_brand_effective_rank"("public"."biz_event_brand_id"("event_id"), "auth"."uid"()) >= "public"."biz_role_rank"('finance_manager'::"text"))) WITH CHECK (("public"."biz_brand_effective_rank"("public"."biz_event_brand_id"("event_id"), "auth"."uid"()) >= "public"."biz_role_rank"('finance_manager'::"text")));



CREATE POLICY "Friends can read friend preferences" ON "public"."preferences" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "preferences"."profile_id") AND ("p"."visibility_mode" = ANY (ARRAY['public'::"text", 'friends'::"text"])) AND (EXISTS ( SELECT 1
           FROM "public"."friends"
          WHERE (("friends"."status" = 'accepted'::"text") AND ((("friends"."user_id" = "auth"."uid"()) AND ("friends"."friend_user_id" = "p"."id")) OR (("friends"."friend_user_id" = "auth"."uid"()) AND ("friends"."user_id" = "p"."id"))))))))));



CREATE POLICY "Friends can read friend profiles" ON "public"."profiles" FOR SELECT USING ((("visibility_mode" = ANY (ARRAY['public'::"text", 'friends'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."friends"
  WHERE (("friends"."status" = 'accepted'::"text") AND ((("friends"."user_id" = "auth"."uid"()) AND ("friends"."friend_user_id" = "profiles"."id")) OR (("friends"."friend_user_id" = "auth"."uid"()) AND ("friends"."user_id" = "profiles"."id"))))))));



CREATE POLICY "Levels are public" ON "public"."user_levels" FOR SELECT USING (true);



CREATE POLICY "Members and admins read brand_team_members" ON "public"."brand_team_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."biz_is_brand_admin_plus_for_caller"("brand_id")));



CREATE POLICY "Only service role can insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK (false);



CREATE POLICY "Order parties can select line items" ON "public"."order_line_items" FOR SELECT TO "authenticated" USING ("public"."biz_can_read_order_for_caller"("order_id"));



CREATE POLICY "Owner can delete saved cards" ON "public"."saved_card" FOR DELETE USING (("auth"."uid"() = "profile_id"));



CREATE POLICY "Owner can insert saved cards" ON "public"."saved_card" FOR INSERT WITH CHECK (("auth"."uid"() = "profile_id"));



CREATE POLICY "Owner can select saved cards" ON "public"."saved_card" FOR SELECT USING (("auth"."uid"() = "profile_id"));



CREATE POLICY "Owner can update saved cards" ON "public"."saved_card" FOR UPDATE USING (("auth"."uid"() = "profile_id")) WITH CHECK (("auth"."uid"() = "profile_id"));



CREATE POLICY "Paired users can view archived holidays" ON "public"."archived_holidays" FOR SELECT USING ((("pairing_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."pairings"
  WHERE (("pairings"."id" = "archived_holidays"."pairing_id") AND (("pairings"."user_a_id" = "auth"."uid"()) OR ("pairings"."user_b_id" = "auth"."uid"())))))));



CREATE POLICY "Paired users can view custom holidays" ON "public"."custom_holidays" FOR SELECT USING ((("pairing_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."pairings"
  WHERE (("pairings"."id" = "custom_holidays"."pairing_id") AND (("pairings"."user_a_id" = "auth"."uid"()) OR ("pairings"."user_b_id" = "auth"."uid"())))))));



CREATE POLICY "Paired users can view saved cards" ON "public"."saved_card" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pairings"
  WHERE ((("pairings"."user_a_id" = "auth"."uid"()) AND ("pairings"."user_b_id" = "saved_card"."profile_id")) OR (("pairings"."user_b_id" = "auth"."uid"()) AND ("pairings"."user_a_id" = "saved_card"."profile_id"))))));



CREATE POLICY "Paired users can view shared impressions" ON "public"."person_card_impressions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pairings"
  WHERE ((("pairings"."user_a_id" = "auth"."uid"()) AND ("pairings"."user_b_id" = "person_card_impressions"."user_id")) OR (("pairings"."user_b_id" = "auth"."uid"()) AND ("pairings"."user_a_id" = "person_card_impressions"."user_id"))))));



CREATE POLICY "Paired users can view visits" ON "public"."user_visits" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pairings"
  WHERE ((("pairings"."user_a_id" = "auth"."uid"()) AND ("pairings"."user_b_id" = "user_visits"."user_id")) OR (("pairings"."user_b_id" = "auth"."uid"()) AND ("pairings"."user_a_id" = "user_visits"."user_id"))))));



CREATE POLICY "Participants can add reactions" ON "public"."board_message_reactions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."board_messages" "bm"
     JOIN "public"."session_participants" "sp" ON (("sp"."session_id" = "bm"."session_id")))
  WHERE (("bm"."id" = "board_message_reactions"."message_id") AND ("sp"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Participants can read conversation presence" ON "public"."conversation_presence" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp"
  WHERE (("cp"."conversation_id" = "conversation_presence"."conversation_id") AND ("cp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Participants can read session pending invites" ON "public"."pending_session_invites" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."session_participants" "sp"
  WHERE (("sp"."session_id" = "pending_session_invites"."session_id") AND ("sp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Participants can remove saved cards from their sessions" ON "public"."board_saved_cards" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."session_participants" "sp"
  WHERE (("sp"."session_id" = "board_saved_cards"."session_id") AND ("sp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Participants can update saved cards in their sessions" ON "public"."board_saved_cards" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."session_participants" "sp"
  WHERE (("sp"."session_id" = "board_saved_cards"."session_id") AND ("sp"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."session_participants" "sp"
  WHERE (("sp"."session_id" = "board_saved_cards"."session_id") AND ("sp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Participants can view reactions" ON "public"."board_message_reactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."board_messages" "bm"
     JOIN "public"."session_participants" "sp" ON (("sp"."session_id" = "bm"."session_id")))
  WHERE (("bm"."id" = "board_message_reactions"."message_id") AND ("sp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Profiles viewable except by blocked users" ON "public"."profiles" FOR SELECT USING ((("auth"."uid"() = "id") OR (NOT "public"."is_blocked_by"("id", "auth"."uid"()))));



CREATE POLICY "Public can read brands with public events (anon or authenticate" ON "public"."brands" FOR SELECT TO "authenticated", "anon" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."brand_id" = "brands"."id") AND ("e"."deleted_at" IS NULL) AND ("e"."visibility" = 'public'::"text") AND ("e"."status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"])))))));



CREATE POLICY "Public can read event dates for published events (anon or authe" ON "public"."event_dates" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "event_dates"."event_id") AND ("e"."deleted_at" IS NULL) AND ("e"."visibility" = 'public'::"text") AND ("e"."status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))))));



CREATE POLICY "Public can read organiser profiles for share pages (anon or aut" ON "public"."creator_accounts" FOR SELECT TO "authenticated", "anon" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."brands" "b"
  WHERE (("b"."account_id" = "creator_accounts"."id") AND ("b"."deleted_at" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."events" "e"
          WHERE (("e"."brand_id" = "b"."id") AND ("e"."deleted_at" IS NULL) AND ("e"."visibility" = 'public'::"text") AND ("e"."status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))))))))));



CREATE POLICY "Public can read published events (anon or authenticated)" ON "public"."events" FOR SELECT TO "authenticated", "anon" USING ((("deleted_at" IS NULL) AND ("visibility" = 'public'::"text") AND ("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))));



CREATE POLICY "Public can read ticket types for published events (anon or auth" ON "public"."ticket_types" FOR SELECT TO "authenticated", "anon" USING ((("deleted_at" IS NULL) AND ("is_hidden" IS NOT TRUE) AND ("is_disabled" IS NOT TRUE) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "ticket_types"."event_id") AND ("e"."deleted_at" IS NULL) AND ("e"."visibility" = 'public'::"text") AND ("e"."status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"])))))));



CREATE POLICY "Receiver can accept or decline visible pair requests" ON "public"."pair_requests" FOR UPDATE USING ((("auth"."uid"() = "receiver_id") AND ("visibility" = 'visible'::"text"))) WITH CHECK (("status" = ANY (ARRAY['accepted'::"text", 'declined'::"text"])));



CREATE POLICY "Receiver sees incoming requests" ON "public"."tag_along_requests" FOR SELECT USING (("receiver_id" = "auth"."uid"()));



CREATE POLICY "Scanners and managers read event_scanners" ON "public"."event_scanners" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."biz_is_event_manager_plus_for_caller"("event_id")));



CREATE POLICY "Scanners can update tickets for check-in" ON "public"."tickets" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."event_scanners" "es"
  WHERE (("es"."event_id" = "tickets"."event_id") AND ("es"."user_id" = "auth"."uid"()) AND ("es"."removed_at" IS NULL) AND COALESCE((("es"."permissions" ->> 'scan'::"text"))::boolean, true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."event_scanners" "es"
  WHERE (("es"."event_id" = "tickets"."event_id") AND ("es"."user_id" = "auth"."uid"()) AND ("es"."removed_at" IS NULL) AND COALESCE((("es"."permissions" ->> 'scan'::"text"))::boolean, true)))));



CREATE POLICY "Scanners insert own scan_events" ON "public"."scan_events" FOR INSERT TO "authenticated" WITH CHECK ((("scanner_user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."event_scanners" "es"
  WHERE (("es"."event_id" = "scan_events"."event_id") AND ("es"."user_id" = "auth"."uid"()) AND ("es"."removed_at" IS NULL) AND COALESCE((("es"."permissions" ->> 'scan'::"text"))::boolean, true))))));



CREATE POLICY "Sender can cancel their pair requests" ON "public"."pair_requests" FOR UPDATE USING (("auth"."uid"() = "sender_id")) WITH CHECK (("status" = 'cancelled'::"text"));



CREATE POLICY "Sender sees own requests" ON "public"."tag_along_requests" FOR SELECT USING (("sender_id" = "auth"."uid"()));



CREATE POLICY "Service role full access" ON "public"."ticketmaster_events_cache" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access card_generation_runs" ON "public"."card_generation_runs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages levels" ON "public"."user_levels" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages requests" ON "public"."tag_along_requests" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages taste matches" ON "public"."user_taste_matches" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Session participants can insert board collaborators" ON "public"."board_collaborators" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."collaboration_sessions" "cs"
     JOIN "public"."session_participants" "sp" ON (("sp"."session_id" = "cs"."id")))
  WHERE (("cs"."board_id" = "board_collaborators"."board_id") AND ("sp"."user_id" = "auth"."uid"()) AND ("sp"."has_accepted" = true)))));



CREATE POLICY "System can insert preference history" ON "public"."preference_history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users and paired users can view preferences" ON "public"."user_preference_learning" FOR SELECT USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."pairings"
  WHERE ((("pairings"."user_a_id" = "auth"."uid"()) AND ("pairings"."user_b_id" = "user_preference_learning"."user_id")) OR (("pairings"."user_b_id" = "auth"."uid"()) AND ("pairings"."user_a_id" = "user_preference_learning"."user_id")))))));



CREATE POLICY "Users can add cards to boards they have access to" ON "public"."board_cards" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_cards"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true))))));



CREATE POLICY "Users can add their own reactions" ON "public"."direct_message_reactions" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can add themselves to conversations" ON "public"."conversation_participants" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "conversation_participants"."conversation_id") AND ("c"."created_by" = "auth"."uid"()))))));



CREATE POLICY "Users can cancel their own pending pair invites" ON "public"."pending_pair_invites" FOR UPDATE USING (("auth"."uid"() = "inviter_id")) WITH CHECK (("status" = 'cancelled'::"text"));



CREATE POLICY "Users can create blocks" ON "public"."blocked_users" FOR INSERT WITH CHECK (("auth"."uid"() = "blocker_id"));



CREATE POLICY "Users can create boards" ON "public"."boards" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can create conversations" ON "public"."conversations" FOR INSERT WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "Users can create friend requests" ON "public"."friends" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create mutes" ON "public"."muted_users" FOR INSERT WITH CHECK (("auth"."uid"() = "muter_id"));



CREATE POLICY "Users can create pair requests" ON "public"."pair_requests" FOR INSERT WITH CHECK ((("auth"."uid"() = "sender_id") AND ("status" = 'pending'::"text")));



CREATE POLICY "Users can create pending pair invites" ON "public"."pending_pair_invites" FOR INSERT WITH CHECK ((("auth"."uid"() = "inviter_id") AND ("status" = 'pending'::"text")));



CREATE POLICY "Users can create reports" ON "public"."user_reports" FOR INSERT WITH CHECK (("auth"."uid"() = "reporter_id"));



CREATE POLICY "Users can create threads in boards they have access to" ON "public"."board_threads" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_threads"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true)))))));



CREATE POLICY "Users can delete own feedback" ON "public"."beta_feedback" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own notifications" ON "public"."notifications" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own boards" ON "public"."boards" FOR DELETE USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can delete their own calendar entries" ON "public"."calendar_entries" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own friendships" ON "public"."friends" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own messages" ON "public"."messages" FOR DELETE USING (("auth"."uid"() = "sender_id"));



CREATE POLICY "Users can delete their own pairings (unpair)" ON "public"."pairings" FOR DELETE USING ((("auth"."uid"() = "user_a_id") OR ("auth"."uid"() = "user_b_id")));



CREATE POLICY "Users can delete their own pending invites" ON "public"."pending_invites" FOR DELETE USING (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can delete their own person card impressions" ON "public"."person_card_impressions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own preferences" ON "public"."notification_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own push tokens" ON "public"."user_push_tokens" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own saved people" ON "public"."saved_people" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own scheduled activities" ON "public"."scheduled_activities" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own threads" ON "public"."board_threads" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own undo actions" ON "public"."undo_actions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert activity history for boards they have access t" ON "public"."activity_history" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "activity_history"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true)))))));



CREATE POLICY "Users can insert own experience feedback" ON "public"."experience_feedback" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own feedback" ON "public"."app_feedback" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own preferences" ON "public"."preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "profile_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert their own activity" ON "public"."user_activity" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own calendar entries" ON "public"."calendar_entries" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own interactions" ON "public"."user_interactions" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("user_id" = "auth"."uid"())));



CREATE POLICY "Users can insert their own location history" ON "public"."user_location_history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own pending invites" ON "public"."pending_invites" FOR INSERT WITH CHECK (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can insert their own pending session invites" ON "public"."pending_session_invites" FOR INSERT WITH CHECK (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can insert their own person card impressions" ON "public"."person_card_impressions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own preferences" ON "public"."notification_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own preferences" ON "public"."user_preference_learning" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert their own push tokens" ON "public"."user_push_tokens" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own saved people" ON "public"."saved_people" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own scheduled activities" ON "public"."scheduled_activities" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own sessions" ON "public"."user_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own undo actions" ON "public"."undo_actions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own RSVPs" ON "public"."board_card_rsvps" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage their own archived holidays" ON "public"."archived_holidays" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own custom holidays" ON "public"."custom_holidays" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own visits" ON "public"."user_visits" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can mark card messages as read" ON "public"."board_card_message_reads" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can mark messages as read" ON "public"."board_message_reads" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can mark messages as read" ON "public"."message_reads" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read own audit_log rows" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("user_id" IS NOT NULL) AND ("user_id" = "auth"."uid"())));



CREATE POLICY "Users can read own experience feedback" ON "public"."experience_feedback" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own feedback" ON "public"."app_feedback" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own feedback" ON "public"."beta_feedback" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own overrides" ON "public"."admin_subscription_overrides" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own preferences" ON "public"."preferences" FOR SELECT USING (("auth"."uid"() = "profile_id"));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can read reactions on their conversations" ON "public"."direct_message_reactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."messages" "m"
     JOIN "public"."conversation_participants" "cp" ON (("cp"."conversation_id" = "m"."conversation_id")))
  WHERE (("m"."id" = "direct_message_reactions"."message_id") AND ("cp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can read their own pending invites" ON "public"."pending_invites" FOR SELECT USING (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can read their own pending session invites" ON "public"."pending_session_invites" FOR SELECT USING (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can read their own person card impressions" ON "public"."person_card_impressions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own preferences" ON "public"."notification_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own referral credits" ON "public"."referral_credits" FOR SELECT USING (("auth"."uid"() = "referrer_id"));



CREATE POLICY "Users can read their own saved people" ON "public"."saved_people" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own subscription" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can remove their own blocks" ON "public"."blocked_users" FOR DELETE USING (("auth"."uid"() = "blocker_id"));



CREATE POLICY "Users can remove their own mutes" ON "public"."muted_users" FOR DELETE USING (("auth"."uid"() = "muter_id"));



CREATE POLICY "Users can remove their own reactions" ON "public"."board_message_reactions" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can remove their own reactions" ON "public"."direct_message_reactions" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can send messages to conversations they participate in" ON "public"."messages" FOR INSERT WITH CHECK ((("sender_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp"
  WHERE (("cp"."conversation_id" = "messages"."conversation_id") AND ("cp"."user_id" = "auth"."uid"())))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."blocked_users" "bu"
  WHERE ((("bu"."blocker_id" = "auth"."uid"()) AND ("bu"."blocked_id" IN ( SELECT "cp2"."user_id"
           FROM "public"."conversation_participants" "cp2"
          WHERE (("cp2"."conversation_id" = "messages"."conversation_id") AND ("cp2"."user_id" <> "auth"."uid"()))))) OR (("bu"."blocked_id" = "auth"."uid"()) AND ("bu"."blocker_id" IN ( SELECT "cp3"."user_id"
           FROM "public"."conversation_participants" "cp3"
          WHERE (("cp3"."conversation_id" = "messages"."conversation_id") AND ("cp3"."user_id" <> "auth"."uid"())))))))))));



CREATE POLICY "Users can update own notifications (mark read)" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own preferences" ON "public"."preferences" FOR UPDATE USING (("auth"."uid"() = "profile_id"));



CREATE POLICY "Users can update own presence" ON "public"."conversation_presence" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own boards" ON "public"."boards" FOR UPDATE USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can update their own calendar entries" ON "public"."calendar_entries" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own card messages" ON "public"."board_card_messages" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own friendships" ON "public"."friends" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own interactions" ON "public"."user_interactions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own messages" ON "public"."board_messages" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own messages" ON "public"."messages" FOR UPDATE USING (("auth"."uid"() = "sender_id"));



CREATE POLICY "Users can update their own participation" ON "public"."conversation_participants" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own pending invites" ON "public"."pending_invites" FOR UPDATE USING (("auth"."uid"() = "inviter_id")) WITH CHECK (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can update their own pending session invites" ON "public"."pending_session_invites" FOR UPDATE USING (("auth"."uid"() = "inviter_id")) WITH CHECK (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can update their own preferences" ON "public"."notification_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own preferences" ON "public"."user_preference_learning" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own push tokens" ON "public"."user_push_tokens" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own saved people" ON "public"."saved_people" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own scheduled activities" ON "public"."scheduled_activities" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own sessions" ON "public"."user_sessions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own subscription" ON "public"."subscriptions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own threads" ON "public"."board_threads" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own votes" ON "public"."board_votes" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can upsert own presence" ON "public"."conversation_presence" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view activity history for boards they have access to" ON "public"."activity_history" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "activity_history"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true))))));



CREATE POLICY "Users can view cards in boards they have access to" ON "public"."board_cards" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_cards"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true))))));



CREATE POLICY "Users can view conversations they participate in" ON "public"."conversations" FOR SELECT USING ((("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp"
  WHERE (("cp"."conversation_id" = "conversations"."id") AND ("cp"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view messages in conversations" ON "public"."messages" FOR SELECT USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp"
  WHERE (("cp"."conversation_id" = "messages"."conversation_id") AND ("cp"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view messages in their conversations" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp"
  WHERE (("cp"."conversation_id" = "messages"."conversation_id") AND ("cp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view participants in their conversations" ON "public"."conversation_participants" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_conversation_participant"("conversation_id", "auth"."uid"())));



CREATE POLICY "Users can view public boards and their own boards" ON "public"."boards" FOR SELECT USING ((("is_public" = true) OR ("created_by" = "auth"."uid"())));



CREATE POLICY "Users can view read receipts for messages" ON "public"."message_reads" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."messages" "m"
     JOIN "public"."conversation_participants" "cp" ON (("cp"."conversation_id" = "m"."conversation_id")))
  WHERE (("m"."id" = "message_reads"."message_id") AND ("cp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their conversations" ON "public"."conversations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp"
  WHERE (("cp"."conversation_id" = "conversations"."id") AND ("cp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own activity" ON "public"."user_activity" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own blocks" ON "public"."blocked_users" FOR SELECT USING (("auth"."uid"() = "blocker_id"));



CREATE POLICY "Users can view their own calendar entries" ON "public"."calendar_entries" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own friendships" ON "public"."friends" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own interactions" ON "public"."user_interactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own location history" ON "public"."user_location_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own mutes" ON "public"."muted_users" FOR SELECT USING (("auth"."uid"() = "muter_id"));



CREATE POLICY "Users can view their own pair requests" ON "public"."pair_requests" FOR SELECT USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "receiver_id")));



CREATE POLICY "Users can view their own pairings" ON "public"."pairings" FOR SELECT USING ((("auth"."uid"() = "user_a_id") OR ("auth"."uid"() = "user_b_id")));



CREATE POLICY "Users can view their own pending pair invites" ON "public"."pending_pair_invites" FOR SELECT USING (("auth"."uid"() = "inviter_id"));



CREATE POLICY "Users can view their own preference history" ON "public"."preference_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own preferences" ON "public"."user_preference_learning" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own push tokens" ON "public"."user_push_tokens" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own reports" ON "public"."user_reports" FOR SELECT USING (("auth"."uid"() = "reporter_id"));



CREATE POLICY "Users can view their own scheduled activities" ON "public"."scheduled_activities" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own sessions" ON "public"."user_sessions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own undo actions" ON "public"."undo_actions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view threads in boards they have access to" ON "public"."board_threads" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_threads"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true))))));



CREATE POLICY "Users can view votes in boards they have access to" ON "public"."board_votes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_votes"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true))))));



CREATE POLICY "Users can vote on cards in boards they have access to" ON "public"."board_votes" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_votes"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true)))))));



CREATE POLICY "Users can vote on saved cards in their sessions" ON "public"."board_votes" FOR INSERT WITH CHECK ((("saved_card_id" IS NOT NULL) AND ("user_id" = "auth"."uid"())));



CREATE POLICY "Users manage own map settings" ON "public"."user_map_settings" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own presence" ON "public"."leaderboard_presence" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own taste matches" ON "public"."user_taste_matches" FOR SELECT USING ((("auth"."uid"() = "user_a_id") OR ("auth"."uid"() = "user_b_id")));



CREATE POLICY "Users see discoverable presence" ON "public"."leaderboard_presence" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (("is_discoverable" = true) AND ("available_seats" > 0) AND ("last_swipe_at" > ("now"() - '24:00:00'::interval)) AND (("visibility_level" = 'everyone'::"text") OR (("visibility_level" = 'friends'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."friends"
  WHERE (("friends"."status" = 'accepted'::"text") AND ("friends"."deleted_at" IS NULL) AND ((("friends"."user_id" = "auth"."uid"()) AND ("friends"."friend_user_id" = "leaderboard_presence"."user_id")) OR (("friends"."friend_user_id" = "auth"."uid"()) AND ("friends"."user_id" = "leaderboard_presence"."user_id"))))))) OR (("visibility_level" = 'friends_of_friends'::"text") AND "public"."are_friends_or_fof"("auth"."uid"(), "user_id")) OR (("visibility_level" = 'paired'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."friends"
  WHERE (("friends"."status" = 'accepted'::"text") AND ("friends"."deleted_at" IS NULL) AND ((("friends"."user_id" = "auth"."uid"()) AND ("friends"."friend_user_id" = "leaderboard_presence"."user_id")) OR (("friends"."friend_user_id" = "auth"."uid"()) AND ("friends"."user_id" = "leaderboard_presence"."user_id")))))))))));



ALTER TABLE "public"."_archive_card_pool" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_archive_card_pool_stops" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_deletion_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_all_email_log" ON "public"."admin_email_log" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_all_integrations" ON "public"."integrations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_all_signal_anchors" ON "public"."signal_anchors" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_backfill_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_backfill_log_archive_orch_0671" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_delete_admin_users" ON "public"."admin_users" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_delete_app_config" ON "public"."app_config" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_delete_feature_flags" ON "public"."feature_flags" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_delete_photo_aesthetic_labels" ON "public"."photo_aesthetic_labels" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



ALTER TABLE "public"."admin_email_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_full_access_rule_entries" ON "public"."rule_entries" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_full_access_rule_set_versions" ON "public"."rule_set_versions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_full_access_rule_sets" ON "public"."rule_sets" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_full_access_rules_run_results" ON "public"."rules_run_results" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_full_access_rules_runs" ON "public"."rules_runs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_full_access_rules_versions" ON "public"."rules_versions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_insert_admin_users" ON "public"."admin_users" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_insert_app_config" ON "public"."app_config" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_insert_backfill_log" ON "public"."admin_backfill_log" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_insert_feature_flags" ON "public"."feature_flags" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_insert_place_admin_actions" ON "public"."place_admin_actions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_engagement_metrics" ON "public"."engagement_metrics" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "lower"("auth"."email"())) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_photo_aesthetic_batches" ON "public"."photo_aesthetic_batches" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_photo_aesthetic_labels" ON "public"."photo_aesthetic_labels" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_photo_aesthetic_runs" ON "public"."photo_aesthetic_runs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_pit_runs" ON "public"."place_intelligence_trial_runs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_place_admin_actions" ON "public"."place_admin_actions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_read_place_external_reviews" ON "public"."place_external_reviews" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_select_backfill_log" ON "public"."admin_backfill_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



ALTER TABLE "public"."admin_subscription_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_update_admin_users" ON "public"."admin_users" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_update_app_config" ON "public"."app_config" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_update_card_pool" ON "public"."_archive_card_pool" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_update_feature_flags" ON "public"."feature_flags" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_update_photo_aesthetic_labels" ON "public"."photo_aesthetic_labels" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_update_place_pool" ON "public"."place_pool" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_write_photo_aesthetic_labels" ON "public"."photo_aesthetic_labels" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."email" = "auth"."email"()) AND ("au"."status" = 'active'::"text")))));



CREATE POLICY "admin_write_seeding_cities" ON "public"."seeding_cities" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_write_seeding_operations" ON "public"."seeding_operations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



CREATE POLICY "admin_write_seeding_tiles" ON "public"."seeding_tiles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = "auth"."email"()) AND ("admin_users"."status" = 'active'::"text")))));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appsflyer_devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appsflyer_devices_delete_own" ON "public"."appsflyer_devices" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "appsflyer_devices_insert_own" ON "public"."appsflyer_devices" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "appsflyer_devices_select_own" ON "public"."appsflyer_devices" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "appsflyer_devices_update_own" ON "public"."appsflyer_devices" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."archived_holidays" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated_read_app_config" ON "public"."app_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_read_card_pool" ON "public"."_archive_card_pool" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_read_card_pool_stops" ON "public"."_archive_card_pool_stops" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_read_feature_flags" ON "public"."feature_flags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_read_place_pool" ON "public"."place_pool" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_read_seeding_cities" ON "public"."seeding_cities" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_read_seeding_operations" ON "public"."seeding_operations" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_read_seeding_tiles" ON "public"."seeding_tiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_select_refresh_batches" ON "public"."refresh_batches" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_select_refresh_runs" ON "public"."refresh_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_select_seeding_batches" ON "public"."seeding_batches" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_select_seeding_runs" ON "public"."seeding_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "bcm_insert" ON "public"."board_card_messages" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "bcm_select" ON "public"."board_card_messages" FOR SELECT USING ((("deleted_at" IS NULL) AND "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "bcmr_select" ON "public"."board_card_message_reads" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "bcr_select" ON "public"."board_card_rsvps" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_session_participant"("session_id", "auth"."uid"())));



ALTER TABLE "public"."beta_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocked_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bm_insert" ON "public"."board_messages" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "bm_select" ON "public"."board_messages" FOR SELECT USING ((("deleted_at" IS NULL) AND "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "bmr_select" ON "public"."board_message_reads" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."board_card_message_reads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_card_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_card_rsvps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_collaborators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_message_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_message_reads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_participant_presence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_saved_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_typing_indicators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_user_swipe_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."boards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bpp_delete" ON "public"."board_participant_presence" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "bpp_insert" ON "public"."board_participant_presence" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_session_creator"("session_id", "auth"."uid"())));



CREATE POLICY "bpp_select" ON "public"."board_participant_presence" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "bpp_update" ON "public"."board_participant_presence" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."brand_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bsc_insert_trigger_or_service_only" ON "public"."board_saved_cards" FOR INSERT WITH CHECK (((CURRENT_USER = 'postgres'::"name") OR ("auth"."role"() = 'service_role'::"text")));



COMMENT ON POLICY "bsc_insert_trigger_or_service_only" ON "public"."board_saved_cards" IS 'ORCH-0535: INSERTs restricted to check_mutual_like trigger (SECURITY DEFINER, owner postgres) and service-role edge functions. User-context INSERTs are rejected. See ORCH-0532 root cause analysis at Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0532_V2_REAUDIT.md.';



CREATE POLICY "bsc_select" ON "public"."board_saved_cards" FOR SELECT USING ((("saved_by" = "auth"."uid"()) OR "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "bti_all" ON "public"."board_typing_indicators" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "bti_select" ON "public"."board_typing_indicators" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "buss_all" ON "public"."board_user_swipe_states" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "buss_select" ON "public"."board_user_swipe_states" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "bv_delete" ON "public"."board_votes" FOR DELETE USING ((("auth"."uid"() = "user_id") AND ((("session_id" IS NOT NULL) AND "public"."is_session_participant"("session_id", "auth"."uid"())) OR (("board_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_votes"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true)))))))));



CREATE POLICY "bv_select" ON "public"."board_votes" FOR SELECT USING (((("session_id" IS NOT NULL) AND "public"."is_session_participant"("session_id", "auth"."uid"())) OR (("board_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."boards" "b"
  WHERE (("b"."id" = "board_votes"."board_id") AND (("b"."created_by" = "auth"."uid"()) OR ("b"."is_public" = true))))))));



ALTER TABLE "public"."calendar_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_generation_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_type_exclusions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ci_delete" ON "public"."collaboration_invites" FOR DELETE USING ((("auth"."uid"() = "invited_user_id") OR ("auth"."uid"() = "inviter_id") OR "public"."is_session_creator"("session_id", "auth"."uid"())));



CREATE POLICY "ci_insert" ON "public"."collaboration_invites" FOR INSERT WITH CHECK ((("auth"."uid"() = "inviter_id") OR "public"."is_session_creator"("session_id", "auth"."uid"())));



CREATE POLICY "ci_select" ON "public"."collaboration_invites" FOR SELECT USING ((("auth"."uid"() = "invited_user_id") OR ("auth"."uid"() = "inviter_id") OR "public"."is_session_creator"("session_id", "auth"."uid"())));



CREATE POLICY "ci_update" ON "public"."collaboration_invites" FOR UPDATE USING ((("auth"."uid"() = "invited_user_id") OR ("auth"."uid"() = "inviter_id") OR "public"."is_session_creator"("session_id", "auth"."uid"())));



ALTER TABLE "public"."collaboration_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."collaboration_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_presence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."creator_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_delete" ON "public"."collaboration_sessions" FOR DELETE USING (("auth"."uid"() = "created_by"));



CREATE POLICY "cs_insert" ON "public"."collaboration_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "cs_select" ON "public"."collaboration_sessions" FOR SELECT USING ((("auth"."uid"() = "created_by") OR "public"."is_session_participant"("id", "auth"."uid"()) OR "public"."has_session_invite"("id", "auth"."uid"())));



CREATE POLICY "cs_update" ON "public"."collaboration_sessions" FOR UPDATE USING ((("auth"."uid"() = "created_by") OR "public"."is_session_participant"("id", "auth"."uid"()))) WITH CHECK ((("auth"."uid"() = "created_by") OR "public"."is_session_participant"("id", "auth"."uid"())));



ALTER TABLE "public"."curated_places_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."curated_teaser_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_holidays" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."direct_message_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discover_daily_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discover_daily_cache_insert_own" ON "public"."discover_daily_cache" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "discover_daily_cache_select_own" ON "public"."discover_daily_cache" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "discover_daily_cache_update_own" ON "public"."discover_daily_cache" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."door_sales_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."engagement_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_dates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_scanners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."experience_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fr_delete" ON "public"."friend_requests" FOR DELETE USING (("auth"."uid"() = "sender_id"));



CREATE POLICY "fr_insert" ON "public"."friend_requests" FOR INSERT WITH CHECK (("auth"."uid"() = "sender_id"));



CREATE POLICY "fr_select" ON "public"."friend_requests" FOR SELECT USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "receiver_id")));



CREATE POLICY "fr_update" ON "public"."friend_requests" FOR UPDATE USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "receiver_id")));



ALTER TABLE "public"."friend_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."friends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leaderboard_presence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_telemetry_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_reads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mte_service_read" ON "public"."match_telemetry_events" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR (CURRENT_USER = 'postgres'::"name")));



CREATE POLICY "mte_trigger_insert" ON "public"."match_telemetry_events" FOR INSERT WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR (CURRENT_USER = 'postgres'::"name")));



ALTER TABLE "public"."muted_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pair_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pairings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_pair_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_session_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."person_card_impressions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_aesthetic_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_aesthetic_labels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_aesthetic_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_backfill_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_backfill_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_admin_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_external_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_intelligence_trial_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_pool" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "place_scores_auth_read" ON "public"."place_scores" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "place_scores_service_all" ON "public"."place_scores" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."preference_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refresh_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refresh_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refunds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rule_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rule_set_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rule_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rules_run_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rules_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rules_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_card" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_people" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scanner_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scheduled_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seeding_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seeding_cities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seeding_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seeding_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seeding_tiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "self_activate_admin_users" ON "public"."admin_users" FOR UPDATE TO "authenticated" USING ((("email" = "auth"."email"()) AND ("status" = 'invited'::"text"))) WITH CHECK ((("email" = "auth"."email"()) AND ("status" = 'active'::"text")));



CREATE POLICY "service_role_all_admin_config" ON "public"."admin_config" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_backfill_log" ON "public"."admin_backfill_log" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_card_pool" ON "public"."_archive_card_pool" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_card_pool_stops" ON "public"."_archive_card_pool_stops" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_curated_teaser_cache" ON "public"."curated_teaser_cache" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_all_engagement_metrics" ON "public"."engagement_metrics" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_photo_aesthetic_batches" ON "public"."photo_aesthetic_batches" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_photo_aesthetic_labels" ON "public"."photo_aesthetic_labels" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_photo_aesthetic_runs" ON "public"."photo_aesthetic_runs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_photo_batches" ON "public"."photo_backfill_batches" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_photo_runs" ON "public"."photo_backfill_runs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_pit_runs" ON "public"."place_intelligence_trial_runs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_place_admin_actions" ON "public"."place_admin_actions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_place_external_reviews" ON "public"."place_external_reviews" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_place_pool" ON "public"."place_pool" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_refresh_batches" ON "public"."refresh_batches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_all_refresh_runs" ON "public"."refresh_runs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_all_reviews" ON "public"."place_reviews" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_seeding_batches" ON "public"."seeding_batches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_all_seeding_cities" ON "public"."seeding_cities" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_seeding_operations" ON "public"."seeding_operations" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_seeding_runs" ON "public"."seeding_runs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_all_seeding_tiles" ON "public"."seeding_tiles" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_signal_anchors" ON "public"."signal_anchors" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_only_archive_orch_0671" ON "public"."admin_backfill_log_archive_orch_0671" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."session_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signal_anchors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signal_definition_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signal_definition_versions_auth_read" ON "public"."signal_definition_versions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "signal_definition_versions_service_all" ON "public"."signal_definition_versions" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."signal_definitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signal_definitions_auth_read" ON "public"."signal_definitions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "signal_definitions_service_all" ON "public"."signal_definitions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "sp_delete" ON "public"."session_participants" FOR DELETE USING ((("auth"."uid"() = "user_id") OR "public"."is_session_creator"("session_id", "auth"."uid"())));



CREATE POLICY "sp_insert" ON "public"."session_participants" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."collaboration_sessions" "cs"
  WHERE (("cs"."id" = "session_participants"."session_id") AND ("cs"."created_by" = "auth"."uid"())))) OR "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "sp_select" ON "public"."session_participants" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_session_creator"("session_id", "auth"."uid"()) OR "public"."is_session_participant"("session_id", "auth"."uid"())));



CREATE POLICY "sp_update" ON "public"."session_participants" FOR UPDATE USING ((("auth"."uid"() = "user_id") OR "public"."is_session_creator"("session_id", "auth"."uid"()))) WITH CHECK ((("auth"."uid"() = "user_id") OR "public"."is_session_creator"("session_id", "auth"."uid"())));



ALTER TABLE "public"."stripe_connect_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tag_along_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticketmaster_events_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."undo_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_location_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_map_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preference_learning" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_push_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_read_own_engagement" ON "public"."engagement_metrics" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_taste_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_insert_own_reviews" ON "public"."place_reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_read_own_reviews" ON "public"."place_reviews" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "users_update_own_reviews" ON "public"."place_reviews" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."waitlist_entries" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_card_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_card_rsvps";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_message_reactions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_participant_presence";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_saved_cards";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."board_votes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."calendar_entries";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."collaboration_invites";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."collaboration_sessions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."conversation_participants";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."conversation_presence";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."conversations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."friends";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."leaderboard_presence";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pair_requests";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pairings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pending_pair_invites";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."session_participants";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tag_along_requests";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
































































































































































































GRANT ALL ON FUNCTION "public"."accept_friend_request"() TO "anon";
GRANT ALL ON FUNCTION "public"."accept_friend_request"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_friend_request"() TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_friend_request_atomic"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_friend_request_atomic"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_friend_request_atomic"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_pair_request_atomic"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_pair_request_atomic"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_pair_request_atomic"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."activate_invited_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."activate_invited_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."activate_invited_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_board_card"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_board_card"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_board_card"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_analytics_engagement"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_analytics_engagement"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_analytics_engagement"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_analytics_funnel"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_analytics_funnel"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_analytics_funnel"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_analytics_geo"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_analytics_geo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_analytics_geo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_analytics_growth"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_analytics_growth"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_analytics_growth"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_analytics_retention"("p_weeks" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_analytics_retention"("p_weeks" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_analytics_retention"("p_weeks" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_bulk_deactivate_places"("p_place_ids" "uuid"[], "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_bulk_deactivate_places"("p_place_ids" "uuid"[], "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_bulk_deactivate_places"("p_place_ids" "uuid"[], "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_card_generation_active"("p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_card_generation_active"("p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_card_generation_active"("p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_card_generation_status"("p_run_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_card_generation_status"("p_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_card_generation_status"("p_run_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_city_picker_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_city_picker_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_city_picker_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_city_pipeline_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_city_pipeline_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_city_pipeline_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_city_place_stats"("p_city_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_city_place_stats"("p_city_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_city_place_stats"("p_city_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_clear_demo_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_clear_demo_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_clear_demo_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_clear_expired_caches"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_clear_expired_caches"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_clear_expired_caches"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_deactivate_place"("p_place_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_deactivate_place"("p_place_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_deactivate_place"("p_place_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_edit_place"("p_place_id" "uuid", "p_name" "text", "p_price_tier" "text", "p_is_active" boolean, "p_price_tiers" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_edit_place"("p_place_id" "uuid", "p_name" "text", "p_price_tier" "text", "p_is_active" boolean, "p_price_tiers" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_edit_place"("p_place_id" "uuid", "p_name" "text", "p_price_tier" "text", "p_is_active" boolean, "p_price_tiers" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_get_feature_flags"("p_keys" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_get_feature_flags"("p_keys" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_feature_flags"("p_keys" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_get_override_history"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_get_override_history"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_override_history"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_get_signal_serving_pct"("p_signal_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_get_signal_serving_pct"("p_signal_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_signal_serving_pct"("p_signal_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_grant_override"("p_user_id" "uuid", "p_tier" "text", "p_reason" "text", "p_granted_by" "uuid", "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_duration_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_grant_override"("p_user_id" "uuid", "p_tier" "text", "p_reason" "text", "p_granted_by" "uuid", "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_duration_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_grant_override"("p_user_id" "uuid", "p_tier" "text", "p_reason" "text", "p_granted_by" "uuid", "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_duration_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_stale_places"("p_filter" "text", "p_sort_by" "text", "p_page" integer, "p_page_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_stale_places"("p_filter" "text", "p_sort_by" "text", "p_page" integer, "p_page_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_stale_places"("p_filter" "text", "p_sort_by" "text", "p_page" integer, "p_page_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_subscriptions"("p_search" "text", "p_tier_filter" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_subscriptions"("p_search" "text", "p_tier_filter" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_subscriptions"("p_search" "text", "p_tier_filter" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_category_breakdown"("p_city_id" "uuid", "p_country_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_category_breakdown"("p_city_id" "uuid", "p_country_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_category_breakdown"("p_city_id" "uuid", "p_country_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_city_overview"("p_country_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_city_overview"("p_country_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_city_overview"("p_country_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_country_overview"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_country_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_country_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_photo_stats"("p_city_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_photo_stats"("p_city_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_photo_stats"("p_city_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_pool_city_list"("p_country" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_pool_city_list"("p_country" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_pool_city_list"("p_country" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_pool_country_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_pool_country_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_pool_country_list"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_place_pool_overview"("p_city_id" "uuid", "p_country_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_place_pool_overview"("p_city_id" "uuid", "p_country_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_place_pool_overview"("p_city_id" "uuid", "p_country_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_pool_category_health"("p_country" "text", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_pool_category_health"("p_country" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_pool_category_health"("p_country" "text", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_reactivate_place"("p_place_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reactivate_place"("p_place_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reactivate_place"("p_place_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_refresh_place_pool_mv"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_refresh_place_pool_mv"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_refresh_place_pool_mv"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_reset_inactive_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reset_inactive_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reset_inactive_sessions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_revoke_override"("p_override_id" "uuid", "p_revoked_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_revoke_override"("p_override_id" "uuid", "p_revoked_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_revoke_override"("p_override_id" "uuid", "p_revoked_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rule_detail"("p_rule_set_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rule_detail"("p_rule_set_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rule_detail"("p_rule_set_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rule_set_diff"("p_version_a" "uuid", "p_version_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rule_set_diff"("p_version_a" "uuid", "p_version_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rule_set_diff"("p_version_a" "uuid", "p_version_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rule_set_versions"("p_rule_set_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rule_set_versions"("p_rule_set_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rule_set_versions"("p_rule_set_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_export"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_export"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_export"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_list"("p_scope_filter" "text", "p_kind_filter" "text", "p_search" "text", "p_show_only_never_fired" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_list"("p_scope_filter" "text", "p_kind_filter" "text", "p_search" "text", "p_show_only_never_fired" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_list"("p_scope_filter" "text", "p_kind_filter" "text", "p_search" "text", "p_show_only_never_fired" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_overview"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_preview_impact"("p_rule_set_id" "uuid", "p_proposed_entries" "text"[], "p_proposed_thresholds" "jsonb", "p_city_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_preview_impact"("p_rule_set_id" "uuid", "p_proposed_entries" "text"[], "p_proposed_thresholds" "jsonb", "p_city_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_preview_impact"("p_rule_set_id" "uuid", "p_proposed_entries" "text"[], "p_proposed_thresholds" "jsonb", "p_city_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_rollback"("p_rule_set_id" "uuid", "p_target_version_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_rollback"("p_rule_set_id" "uuid", "p_target_version_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_rollback"("p_rule_set_id" "uuid", "p_target_version_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_run_affected_places"("p_job_id" "uuid", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_run_affected_places"("p_job_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_run_affected_places"("p_job_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_run_detail"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_run_detail"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_run_detail"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_run_diff"("p_job_a" "uuid", "p_job_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_run_diff"("p_job_a" "uuid", "p_job_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_run_diff"("p_job_a" "uuid", "p_job_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_runs"("p_city_id" "uuid", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_runs"("p_city_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_runs"("p_city_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_rules_save"("p_rule_set_id" "uuid", "p_new_entries" "jsonb", "p_change_summary" "text", "p_new_thresholds" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_rules_save"("p_rule_set_id" "uuid", "p_new_entries" "jsonb", "p_change_summary" "text", "p_new_thresholds" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rules_save"("p_rule_set_id" "uuid", "p_new_entries" "jsonb", "p_change_summary" "text", "p_new_thresholds" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_seed_demo_profiles"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_seed_demo_profiles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_seed_demo_profiles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_set_signal_serving_pct"("p_signal_id" "text", "p_pct" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_signal_serving_pct"("p_signal_id" "text", "p_pct" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_signal_serving_pct"("p_signal_id" "text", "p_pct" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_subscription_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_subscription_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_subscription_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_trigger_place_refresh"("p_mode" "text", "p_place_pool_ids" "uuid"[], "p_stale_threshold_hours" integer, "p_served_within_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_trigger_place_refresh"("p_mode" "text", "p_place_pool_ids" "uuid"[], "p_stale_threshold_hours" integer, "p_served_within_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_trigger_place_refresh"("p_mode" "text", "p_place_pool_ids" "uuid"[], "p_stale_threshold_hours" integer, "p_served_within_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_uncategorized_places"("p_country" "text", "p_city" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_uncategorized_places"("p_country" "text", "p_city" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_uncategorized_places"("p_country" "text", "p_city" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_virtual_tile_intelligence"("p_country" "text", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_virtual_tile_intelligence"("p_country" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_virtual_tile_intelligence"("p_country" "text", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."are_friends_or_fof"("viewer_id" "uuid", "target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."are_friends_or_fof"("viewer_id" "uuid", "target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."are_friends_or_fof"("viewer_id" "uuid", "target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_create_presence"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_create_presence"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_create_presence"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_generate_invite_info"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_generate_invite_info"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_generate_invite_info"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_update_city_seeded_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_update_city_seeded_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_update_city_seeded_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_audit_log_block_mutate"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_audit_log_block_mutate"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_audit_log_block_mutate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_audit_log_block_mutate"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_brand_effective_rank"("p_brand_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_brand_effective_rank"("p_brand_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_brand_effective_rank"("p_brand_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_brand_effective_rank"("p_brand_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_brand_effective_rank_for_caller"("p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_brand_effective_rank_for_caller"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_brand_effective_rank_for_caller"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_brand_effective_rank_for_caller"("p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_can_manage_orders_for_event"("p_event_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_can_manage_orders_for_event"("p_event_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_can_manage_orders_for_event"("p_event_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_can_manage_orders_for_event"("p_event_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_can_manage_orders_for_event_for_caller"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_can_manage_orders_for_event_for_caller"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_can_manage_orders_for_event_for_caller"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_can_manage_orders_for_event_for_caller"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand"("p_brand_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand"("p_brand_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand"("p_brand_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand"("p_brand_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand_for_caller"("p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand_for_caller"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand_for_caller"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_can_manage_payments_for_brand_for_caller"("p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_can_read_order"("p_order_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_can_read_order"("p_order_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_can_read_order"("p_order_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_can_read_order"("p_order_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_can_read_order_for_caller"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_can_read_order_for_caller"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_can_read_order_for_caller"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_can_read_order_for_caller"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_event_brand_id"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_event_brand_id"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_event_brand_id"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_event_brand_id"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_is_brand_admin_plus"("p_brand_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_is_brand_admin_plus"("p_brand_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_is_brand_admin_plus"("p_brand_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_is_brand_admin_plus"("p_brand_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_is_brand_admin_plus_for_caller"("p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_is_brand_admin_plus_for_caller"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_is_brand_admin_plus_for_caller"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_is_brand_admin_plus_for_caller"("p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_is_brand_member_for_read"("p_brand_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_is_brand_member_for_read"("p_brand_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_is_brand_member_for_read"("p_brand_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_is_brand_member_for_read"("p_brand_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_is_brand_member_for_read_for_caller"("p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_is_brand_member_for_read_for_caller"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_is_brand_member_for_read_for_caller"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_is_brand_member_for_read_for_caller"("p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_is_event_manager_plus"("p_event_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_is_event_manager_plus"("p_event_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_is_event_manager_plus"("p_event_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_is_event_manager_plus"("p_event_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_is_event_manager_plus_for_caller"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_is_event_manager_plus_for_caller"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_is_event_manager_plus_for_caller"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_is_event_manager_plus_for_caller"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_order_brand_id"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_order_brand_id"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_order_brand_id"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_order_brand_id"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_prevent_brand_account_id_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_prevent_brand_account_id_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_prevent_brand_account_id_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_prevent_brand_account_id_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_prevent_brand_slug_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_prevent_brand_slug_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_prevent_brand_slug_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_prevent_brand_slug_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_prevent_event_brand_id_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_prevent_event_brand_id_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_brand_id_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_brand_id_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_prevent_event_created_by_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_prevent_event_created_by_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_created_by_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_created_by_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_prevent_event_dates_event_id_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_prevent_event_dates_event_id_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_dates_event_id_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_dates_event_id_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_prevent_event_slug_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_prevent_event_slug_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_slug_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_prevent_event_slug_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_role_rank"("p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_role_rank"("p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."biz_role_rank"("p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_role_rank"("p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_scan_events_block_mutate"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_scan_events_block_mutate"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_scan_events_block_mutate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_scan_events_block_mutate"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_scan_events_enforce_ticket_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_scan_events_enforce_ticket_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_scan_events_enforce_ticket_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_scan_events_enforce_ticket_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_tickets_enforce_consistent_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_tickets_enforce_consistent_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_tickets_enforce_consistent_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_tickets_enforce_consistent_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."biz_tickets_enforce_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."biz_tickets_enforce_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."biz_tickets_enforce_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."biz_tickets_enforce_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cascade_friend_decline_to_collabs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cascade_friend_decline_to_collabs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cascade_friend_decline_to_collabs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cascade_friend_request_decline_to_links"() TO "anon";
GRANT ALL ON FUNCTION "public"."cascade_friend_request_decline_to_links"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cascade_friend_request_decline_to_links"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_card_lock_in"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_card_lock_in"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_card_lock_in"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_city_bbox_overlap"("p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision, "p_exclude_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_city_bbox_overlap"("p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision, "p_exclude_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_city_bbox_overlap"("p_sw_lat" double precision, "p_sw_lng" double precision, "p_ne_lat" double precision, "p_ne_lng" double precision, "p_exclude_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_invited_admin"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_invited_admin"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_invited_admin"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_mutual_like"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_mutual_like"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_mutual_like"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_pairing_allowed"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_pairing_allowed"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_pairing_allowed"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_session_creation_allowed"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_session_creation_allowed"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_session_creation_allowed"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_username_availability"("check_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_username_availability"("check_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_username_availability"("check_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_undo_actions"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_undo_actions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_undo_actions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_session_if_under_two_participants"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_session_if_under_two_participants"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_session_if_under_two_participants"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_stale_push_tokens"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_stale_push_tokens"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_stale_push_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_stale_push_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_taste_match"("p_user_a" "uuid", "p_user_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_taste_match"("p_user_a" "uuid", "p_user_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_taste_match"("p_user_a" "uuid", "p_user_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."convert_pending_invites_on_phone_verified"() TO "anon";
GRANT ALL ON FUNCTION "public"."convert_pending_invites_on_phone_verified"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_pending_invites_on_phone_verified"() TO "service_role";



GRANT ALL ON FUNCTION "public"."convert_pending_pair_invites_on_phone_verified"() TO "anon";
GRANT ALL ON FUNCTION "public"."convert_pending_pair_invites_on_phone_verified"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_pending_pair_invites_on_phone_verified"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_calendar_entries_on_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_calendar_entries_on_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_calendar_entries_on_lock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_preference_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_preference_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_preference_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_subscription_on_onboarding_complete"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_subscription_on_onboarding_complete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_subscription_on_onboarding_complete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_subscription_on_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_subscription_on_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_subscription_on_signup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."credit_referral_on_friend_accepted"() TO "anon";
GRANT ALL ON FUNCTION "public"."credit_referral_on_friend_accepted"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."credit_referral_on_friend_accepted"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cron_refresh_admin_place_pool_mv"() TO "anon";
GRANT ALL ON FUNCTION "public"."cron_refresh_admin_place_pool_mv"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cron_refresh_admin_place_pool_mv"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_notifications_on_entity_resolved"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_notifications_on_entity_resolved"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_notifications_on_entity_resolved"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_session_creation_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_session_creation_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_session_creation_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."execute_undo_action"("p_undo_id" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."execute_undo_action"("p_undo_id" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_undo_action"("p_undo_id" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fan_review_to_engagement"() TO "anon";
GRANT ALL ON FUNCTION "public"."fan_review_to_engagement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fan_review_to_engagement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fan_visit_to_engagement"() TO "anon";
GRANT ALL ON FUNCTION "public"."fan_visit_to_engagement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fan_visit_to_engagement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fetch_local_signal_ranked"("p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text", "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric, "p_required_types" "text"[], "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fetch_local_signal_ranked"("p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text", "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric, "p_required_types" "text"[], "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fetch_local_signal_ranked"("p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text", "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric, "p_required_types" "text"[], "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_referral_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_referral_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_referral_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_admin_emails"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_emails"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_card_rsvp_counts"("p_saved_card_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_card_rsvp_counts"("p_saved_card_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_card_rsvp_counts"("p_saved_card_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_effective_tier"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_effective_tier"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_effective_tier"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_muted_user_ids"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_muted_user_ids"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_muted_user_ids"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_direct_conversation"("p_user1_id" "uuid", "p_user2_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_direct_conversation"("p_user1_id" "uuid", "p_user2_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_direct_conversation"("p_user1_id" "uuid", "p_user2_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_place_count_per_city"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_place_count_per_city"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_place_count_per_city"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_place_count_per_city"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_place_count_per_city"() TO "authenticator";



GRANT ALL ON FUNCTION "public"."get_saved_card_vote_counts"("p_saved_card_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_saved_card_vote_counts"("p_saved_card_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_saved_card_vote_counts"("p_saved_card_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_seed_stats_per_city"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_seed_stats_per_city"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_seed_stats_per_city"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_seed_stats_per_city"() TO "authenticator";



GRANT ALL ON FUNCTION "public"."get_session_member_limit"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_session_member_limit"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_session_member_limit"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tier_limits"("p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tier_limits"("p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tier_limits"("p_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_total_unread_card_messages_count"("p_session_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_total_unread_card_messages_count"("p_session_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_total_unread_card_messages_count"("p_session_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_undo_actions"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_undo_actions"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_undo_actions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unread_card_message_count"("p_session_id" "uuid", "p_saved_card_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_unread_card_message_count"("p_session_id" "uuid", "p_saved_card_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unread_card_message_count"("p_session_id" "uuid", "p_saved_card_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unread_message_count"("p_session_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_unread_message_count"("p_session_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unread_message_count"("p_session_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_frequent_locations"("user_uuid" "uuid", "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_frequent_locations"("user_uuid" "uuid", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_frequent_locations"("user_uuid" "uuid", "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_board_vote"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_board_vote"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_board_vote"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_collab_session_end"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_collab_session_end"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_collab_session_end"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_blocked"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_blocked"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_blocked"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_block_between"("user1" "uuid", "user2" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_block_between"("user1" "uuid", "user2" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_block_between"("user1" "uuid", "user2" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_recent_report"("reporter" "uuid", "reported" "uuid", "hours_window" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."has_recent_report"("reporter" "uuid", "reported" "uuid", "hours_window" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_recent_report"("reporter" "uuid", "reported" "uuid", "hours_window" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_session_invite"("p_session_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_session_invite"("p_session_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_session_invite"("p_session_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_place_engagement"("p_google_place_id" "text", "p_field" "text", "p_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_place_engagement"("p_google_place_id" "text", "p_field" "text", "p_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_place_engagement"("p_google_place_id" "text", "p_field" "text", "p_amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_email"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_blocked_by"("blocker" "uuid", "target" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_blocked_by"("blocker" "uuid", "target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_blocked_by"("blocker" "uuid", "target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_board_collaborator"("board_uuid" "uuid", "uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_board_collaborator"("board_uuid" "uuid", "uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_board_collaborator"("board_uuid" "uuid", "uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_board_collaborator"("board_uuid" "uuid", "uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_board_collaborator_as_owner"("board_uuid" "uuid", "uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_board_collaborator_as_owner"("board_uuid" "uuid", "uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_board_collaborator_as_owner"("board_uuid" "uuid", "uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_board_collaborator_as_owner"("board_uuid" "uuid", "uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid", "u_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid", "u_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid", "u_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_message_conversation_participant"("conv_id" "uuid", "u_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_message_conversation_participant"("conv_id" "uuid", "u_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_message_conversation_participant"("conv_id" "uuid", "u_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_muted_by"("muter" "uuid", "target" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_muted_by"("muter" "uuid", "target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_muted_by"("muter" "uuid", "target" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_session_creator"("p_session_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_session_creator"("p_session_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_session_creator"("p_session_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_session_participant"("p_session_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_session_participant"("p_session_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_session_participant"("p_session_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_username_available"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_username_available"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_username_available"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard"("a" "text"[], "b" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard"("a" "text"[], "b" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard"("a" "text"[], "b" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_presence_offline"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_presence_offline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_presence_offline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pg_map_primary_type_to_mingla_category"("p_primary_type" "text", "p_types" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."pg_map_primary_type_to_mingla_category"("p_primary_type" "text", "p_types" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pg_map_primary_type_to_mingla_category"("p_primary_type" "text", "p_types" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."phone_has_used_trial"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."phone_has_used_trial"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."phone_has_used_trial"("p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."query_person_hero_places_by_signal"("p_user_id" "uuid", "p_person_id" "uuid", "p_lat" double precision, "p_lng" double precision, "p_signal_ids" "text"[], "p_exclude_place_ids" "uuid"[], "p_initial_radius_m" integer, "p_max_radius_m" integer, "p_per_signal_limit" integer, "p_total_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."query_person_hero_places_by_signal"("p_user_id" "uuid", "p_person_id" "uuid", "p_lat" double precision, "p_lng" double precision, "p_signal_ids" "text"[], "p_exclude_place_ids" "uuid"[], "p_initial_radius_m" integer, "p_max_radius_m" integer, "p_per_signal_limit" integer, "p_total_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."query_person_hero_places_by_signal"("p_user_id" "uuid", "p_person_id" "uuid", "p_lat" double precision, "p_lng" double precision, "p_signal_ids" "text"[], "p_exclude_place_ids" "uuid"[], "p_initial_radius_m" integer, "p_max_radius_m" integer, "p_per_signal_limit" integer, "p_total_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."query_servable_places_by_signal"("p_signal_id" "text", "p_filter_min" numeric, "p_lat" double precision, "p_lng" double precision, "p_radius_m" double precision, "p_exclude_place_ids" "uuid"[], "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."query_servable_places_by_signal"("p_signal_id" "text", "p_filter_min" numeric, "p_lat" double precision, "p_lng" double precision, "p_radius_m" double precision, "p_exclude_place_ids" "uuid"[], "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."query_servable_places_by_signal"("p_signal_id" "text", "p_filter_min" numeric, "p_lat" double precision, "p_lng" double precision, "p_radius_m" double precision, "p_exclude_place_ids" "uuid"[], "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_user_level"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_user_level"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_user_level"("target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_engagement"("p_event_kind" "text", "p_place_pool_id" "uuid", "p_container_key" "text", "p_experience_type" "text", "p_category" "text", "p_stops" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_engagement"("p_event_kind" "text", "p_place_pool_id" "uuid", "p_container_key" "text", "p_experience_type" "text", "p_category" "text", "p_stops" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_engagement"("p_event_kind" "text", "p_place_pool_id" "uuid", "p_container_key" "text", "p_experience_type" "text", "p_category" "text", "p_stops" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_trial_phone"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_trial_phone"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_trial_phone"("p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."release_advisory_lock_rules_run"("p_lock_key" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."release_advisory_lock_rules_run"("p_lock_key" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_advisory_lock_rules_run"("p_lock_key" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_friend_atomic"("p_friend_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_friend_atomic"("p_friend_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_friend_atomic"("p_friend_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_user_visibility_by_identifier"("p_identifier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_user_visibility_by_identifier"("p_identifier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_user_visibility_by_identifier"("p_identifier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reveal_pair_requests_on_friend_accept"() TO "anon";
GRANT ALL ON FUNCTION "public"."reveal_pair_requests_on_friend_accept"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reveal_pair_requests_on_friend_accept"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_record_swipe_and_check_match"("p_session_id" "uuid", "p_experience_id" "text", "p_user_id" "uuid", "p_card_data" "jsonb", "p_swipe_direction" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_record_swipe_and_check_match"("p_session_id" "uuid", "p_experience_id" "text", "p_user_id" "uuid", "p_card_data" "jsonb", "p_swipe_direction" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_record_swipe_and_check_match"("p_session_id" "uuid", "p_experience_id" "text", "p_user_id" "uuid", "p_card_data" "jsonb", "p_swipe_direction" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_display_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_display_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_display_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_message_read_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_message_read_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_message_read_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_photo_aesthetic_labels_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_photo_aesthetic_labels_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_photo_aesthetic_labels_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_rule_entries_block_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_rule_entries_block_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_rule_entries_block_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_rule_set_versions_block_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_rule_set_versions_block_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_rule_set_versions_block_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_signal_anchors_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_signal_anchors_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_signal_anchors_set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."truncate_seed_map_presence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."truncate_seed_map_presence"() TO "anon";
GRANT ALL ON FUNCTION "public"."truncate_seed_map_presence"() TO "service_role";
GRANT ALL ON FUNCTION "public"."truncate_seed_map_presence"() TO "authenticator";



GRANT ALL ON FUNCTION "public"."try_advisory_lock_rules_run"("p_lock_key" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."try_advisory_lock_rules_run"("p_lock_key" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_advisory_lock_rules_run"("p_lock_key" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."unpair_atomic"("p_pairing_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unpair_atomic"("p_pairing_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unpair_atomic"("p_pairing_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_conversation_on_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_conversation_on_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_conversation_on_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_conversation_presence_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_conversation_presence_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_conversation_presence_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_notification_preferences_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_notification_preferences_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_notification_preferences_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profiles_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profiles_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profiles_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_session_last_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_session_last_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_session_last_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_preferences_from_interaction"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_preferences_from_interaction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_preferences_from_interaction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_reports_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_reports_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_reports_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid", "p_prefs" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid", "p_prefs" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_participant_prefs"("p_session_id" "uuid", "p_user_id" "uuid", "p_prefs" "jsonb") TO "service_role";
























GRANT ALL ON TABLE "public"."_archive_card_pool" TO "anon";
GRANT ALL ON TABLE "public"."_archive_card_pool" TO "authenticated";
GRANT ALL ON TABLE "public"."_archive_card_pool" TO "service_role";



GRANT ALL ON TABLE "public"."_archive_card_pool_stops" TO "anon";
GRANT ALL ON TABLE "public"."_archive_card_pool_stops" TO "authenticated";
GRANT ALL ON TABLE "public"."_archive_card_pool_stops" TO "service_role";



GRANT ALL ON TABLE "public"."_archive_orch_0700_doomed_columns" TO "anon";
GRANT ALL ON TABLE "public"."_archive_orch_0700_doomed_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."_archive_orch_0700_doomed_columns" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_friends" TO "anon";
GRANT ALL ON TABLE "public"."_backup_friends" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_friends" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_messages" TO "anon";
GRANT ALL ON TABLE "public"."_backup_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_messages" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_profiles" TO "anon";
GRANT ALL ON TABLE "public"."_backup_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_user_sessions" TO "anon";
GRANT ALL ON TABLE "public"."_backup_user_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_user_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."_orch_0588_dead_cards_backup" TO "anon";
GRANT ALL ON TABLE "public"."_orch_0588_dead_cards_backup" TO "authenticated";
GRANT ALL ON TABLE "public"."_orch_0588_dead_cards_backup" TO "service_role";



GRANT ALL ON TABLE "public"."_orch_0588_dead_stops_backup" TO "anon";
GRANT ALL ON TABLE "public"."_orch_0588_dead_stops_backup" TO "authenticated";
GRANT ALL ON TABLE "public"."_orch_0588_dead_stops_backup" TO "service_role";



GRANT ALL ON TABLE "public"."account_deletion_requests" TO "anon";
GRANT ALL ON TABLE "public"."account_deletion_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."account_deletion_requests" TO "service_role";



GRANT ALL ON TABLE "public"."activity_history" TO "anon";
GRANT ALL ON TABLE "public"."activity_history" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_history" TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."admin_backfill_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_backfill_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_backfill_log" TO "service_role";



GRANT ALL ON TABLE "public"."admin_backfill_log_archive_orch_0671" TO "anon";
GRANT ALL ON TABLE "public"."admin_backfill_log_archive_orch_0671" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_backfill_log_archive_orch_0671" TO "service_role";



GRANT ALL ON TABLE "public"."admin_config" TO "anon";
GRANT ALL ON TABLE "public"."admin_config" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_config" TO "service_role";



GRANT ALL ON TABLE "public"."admin_email_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_email_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_email_log" TO "service_role";



GRANT ALL ON TABLE "public"."place_pool" TO "anon";
GRANT ALL ON TABLE "public"."place_pool" TO "authenticated";
GRANT ALL ON TABLE "public"."place_pool" TO "service_role";



GRANT ALL ON TABLE "public"."seeding_cities" TO "anon";
GRANT ALL ON TABLE "public"."seeding_cities" TO "authenticated";
GRANT ALL ON TABLE "public"."seeding_cities" TO "service_role";



GRANT ALL ON TABLE "public"."admin_place_pool_mv" TO "anon";
GRANT ALL ON TABLE "public"."admin_place_pool_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_place_pool_mv" TO "service_role";



GRANT ALL ON TABLE "public"."admin_subscription_overrides" TO "anon";
GRANT ALL ON TABLE "public"."admin_subscription_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_subscription_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."admin_users" TO "anon";
GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."app_feedback" TO "anon";
GRANT ALL ON TABLE "public"."app_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."app_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."appsflyer_devices" TO "anon";
GRANT ALL ON TABLE "public"."appsflyer_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."appsflyer_devices" TO "service_role";



GRANT ALL ON TABLE "public"."archived_holidays" TO "anon";
GRANT ALL ON TABLE "public"."archived_holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."archived_holidays" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."beta_feedback" TO "anon";
GRANT ALL ON TABLE "public"."beta_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."beta_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_users" TO "anon";
GRANT ALL ON TABLE "public"."blocked_users" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_users" TO "service_role";



GRANT ALL ON TABLE "public"."board_card_message_reads" TO "anon";
GRANT ALL ON TABLE "public"."board_card_message_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."board_card_message_reads" TO "service_role";



GRANT ALL ON TABLE "public"."board_card_messages" TO "anon";
GRANT ALL ON TABLE "public"."board_card_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."board_card_messages" TO "service_role";



GRANT ALL ON TABLE "public"."board_card_rsvps" TO "anon";
GRANT ALL ON TABLE "public"."board_card_rsvps" TO "authenticated";
GRANT ALL ON TABLE "public"."board_card_rsvps" TO "service_role";



GRANT ALL ON TABLE "public"."board_cards" TO "anon";
GRANT ALL ON TABLE "public"."board_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."board_cards" TO "service_role";



GRANT ALL ON TABLE "public"."board_collaborators" TO "anon";
GRANT ALL ON TABLE "public"."board_collaborators" TO "authenticated";
GRANT ALL ON TABLE "public"."board_collaborators" TO "service_role";



GRANT ALL ON TABLE "public"."board_message_reactions" TO "anon";
GRANT ALL ON TABLE "public"."board_message_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."board_message_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."board_message_reads" TO "anon";
GRANT ALL ON TABLE "public"."board_message_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."board_message_reads" TO "service_role";



GRANT ALL ON TABLE "public"."board_messages" TO "anon";
GRANT ALL ON TABLE "public"."board_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."board_messages" TO "service_role";



GRANT ALL ON TABLE "public"."board_participant_presence" TO "anon";
GRANT ALL ON TABLE "public"."board_participant_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."board_participant_presence" TO "service_role";



GRANT ALL ON TABLE "public"."board_saved_cards" TO "anon";
GRANT ALL ON TABLE "public"."board_saved_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."board_saved_cards" TO "service_role";



GRANT ALL ON TABLE "public"."board_threads" TO "anon";
GRANT ALL ON TABLE "public"."board_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."board_threads" TO "service_role";



GRANT ALL ON TABLE "public"."board_typing_indicators" TO "anon";
GRANT ALL ON TABLE "public"."board_typing_indicators" TO "authenticated";
GRANT ALL ON TABLE "public"."board_typing_indicators" TO "service_role";



GRANT ALL ON TABLE "public"."board_user_swipe_states" TO "anon";
GRANT ALL ON TABLE "public"."board_user_swipe_states" TO "authenticated";
GRANT ALL ON TABLE "public"."board_user_swipe_states" TO "service_role";



GRANT ALL ON TABLE "public"."board_votes" TO "anon";
GRANT ALL ON TABLE "public"."board_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."board_votes" TO "service_role";



GRANT ALL ON TABLE "public"."boards" TO "anon";
GRANT ALL ON TABLE "public"."boards" TO "authenticated";
GRANT ALL ON TABLE "public"."boards" TO "service_role";



GRANT ALL ON TABLE "public"."brand_invitations" TO "anon";
GRANT ALL ON TABLE "public"."brand_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."brand_team_members" TO "anon";
GRANT ALL ON TABLE "public"."brand_team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_team_members" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("account_id") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("name") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("slug") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("description") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("profile_photo_url") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("contact_email") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("contact_phone") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("social_links") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("custom_links") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("display_attendee_count") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("default_currency") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("created_at") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("updated_at") ON TABLE "public"."brands" TO "anon";



GRANT SELECT("deleted_at") ON TABLE "public"."brands" TO "anon";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."brands_public_view" TO "anon";
GRANT ALL ON TABLE "public"."brands_public_view" TO "authenticated";
GRANT ALL ON TABLE "public"."brands_public_view" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_entries" TO "anon";
GRANT ALL ON TABLE "public"."calendar_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_entries" TO "service_role";



GRANT ALL ON TABLE "public"."card_generation_runs" TO "anon";
GRANT ALL ON TABLE "public"."card_generation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."card_generation_runs" TO "service_role";



GRANT ALL ON TABLE "public"."category_type_exclusions" TO "anon";
GRANT ALL ON TABLE "public"."category_type_exclusions" TO "authenticated";
GRANT ALL ON TABLE "public"."category_type_exclusions" TO "service_role";



GRANT ALL ON TABLE "public"."collaboration_invites" TO "anon";
GRANT ALL ON TABLE "public"."collaboration_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."collaboration_invites" TO "service_role";



GRANT ALL ON TABLE "public"."collaboration_sessions" TO "anon";
GRANT ALL ON TABLE "public"."collaboration_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."collaboration_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_participants" TO "anon";
GRANT ALL ON TABLE "public"."conversation_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_participants" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_presence" TO "anon";
GRANT ALL ON TABLE "public"."conversation_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_presence" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."creator_accounts" TO "anon";
GRANT ALL ON TABLE "public"."creator_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."creator_accounts" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."creator_accounts" TO "anon";



GRANT SELECT("display_name") ON TABLE "public"."creator_accounts" TO "anon";



GRANT SELECT("avatar_url") ON TABLE "public"."creator_accounts" TO "anon";



GRANT SELECT("business_name") ON TABLE "public"."creator_accounts" TO "anon";



GRANT SELECT("created_at") ON TABLE "public"."creator_accounts" TO "anon";



GRANT SELECT("deleted_at") ON TABLE "public"."creator_accounts" TO "anon";



GRANT ALL ON TABLE "public"."curated_places_cache" TO "anon";
GRANT ALL ON TABLE "public"."curated_places_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."curated_places_cache" TO "service_role";



GRANT ALL ON TABLE "public"."curated_teaser_cache" TO "anon";
GRANT ALL ON TABLE "public"."curated_teaser_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."curated_teaser_cache" TO "service_role";



GRANT ALL ON TABLE "public"."custom_holidays" TO "anon";
GRANT ALL ON TABLE "public"."custom_holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_holidays" TO "service_role";



GRANT ALL ON TABLE "public"."direct_message_reactions" TO "anon";
GRANT ALL ON TABLE "public"."direct_message_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."direct_message_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."discover_daily_cache" TO "anon";
GRANT ALL ON TABLE "public"."discover_daily_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."discover_daily_cache" TO "service_role";



GRANT ALL ON TABLE "public"."door_sales_ledger" TO "anon";
GRANT ALL ON TABLE "public"."door_sales_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."door_sales_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."email_templates" TO "anon";
GRANT ALL ON TABLE "public"."email_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."email_templates" TO "service_role";



GRANT ALL ON TABLE "public"."engagement_metrics" TO "anon";
GRANT ALL ON TABLE "public"."engagement_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."engagement_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."event_dates" TO "anon";
GRANT ALL ON TABLE "public"."event_dates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_dates" TO "service_role";



GRANT ALL ON TABLE "public"."event_scanners" TO "anon";
GRANT ALL ON TABLE "public"."event_scanners" TO "authenticated";
GRANT ALL ON TABLE "public"."event_scanners" TO "service_role";



GRANT ALL ON TABLE "public"."events_public_view" TO "anon";
GRANT ALL ON TABLE "public"."events_public_view" TO "authenticated";
GRANT ALL ON TABLE "public"."events_public_view" TO "service_role";



GRANT ALL ON TABLE "public"."experience_feedback" TO "anon";
GRANT ALL ON TABLE "public"."experience_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."experience_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."friend_requests" TO "anon";
GRANT ALL ON TABLE "public"."friend_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."friend_requests" TO "service_role";



GRANT ALL ON TABLE "public"."friends" TO "anon";
GRANT ALL ON TABLE "public"."friends" TO "authenticated";
GRANT ALL ON TABLE "public"."friends" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."leaderboard_presence" TO "anon";
GRANT ALL ON TABLE "public"."leaderboard_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard_presence" TO "service_role";



GRANT ALL ON TABLE "public"."match_telemetry_events" TO "anon";
GRANT ALL ON TABLE "public"."match_telemetry_events" TO "authenticated";
GRANT ALL ON TABLE "public"."match_telemetry_events" TO "service_role";



GRANT ALL ON TABLE "public"."message_reads" TO "anon";
GRANT ALL ON TABLE "public"."message_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."message_reads" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."muted_users" TO "anon";
GRANT ALL ON TABLE "public"."muted_users" TO "authenticated";
GRANT ALL ON TABLE "public"."muted_users" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_line_items" TO "anon";
GRANT ALL ON TABLE "public"."order_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."organisers_public_view" TO "anon";
GRANT ALL ON TABLE "public"."organisers_public_view" TO "authenticated";
GRANT ALL ON TABLE "public"."organisers_public_view" TO "service_role";



GRANT ALL ON TABLE "public"."pair_requests" TO "anon";
GRANT ALL ON TABLE "public"."pair_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."pair_requests" TO "service_role";



GRANT ALL ON TABLE "public"."pairings" TO "anon";
GRANT ALL ON TABLE "public"."pairings" TO "authenticated";
GRANT ALL ON TABLE "public"."pairings" TO "service_role";



GRANT ALL ON TABLE "public"."payment_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."payment_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT ALL ON TABLE "public"."pending_invites" TO "anon";
GRANT ALL ON TABLE "public"."pending_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_invites" TO "service_role";



GRANT ALL ON TABLE "public"."pending_pair_invites" TO "anon";
GRANT ALL ON TABLE "public"."pending_pair_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_pair_invites" TO "service_role";



GRANT ALL ON TABLE "public"."pending_session_invites" TO "anon";
GRANT ALL ON TABLE "public"."pending_session_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_session_invites" TO "service_role";



GRANT ALL ON TABLE "public"."person_card_impressions" TO "anon";
GRANT ALL ON TABLE "public"."person_card_impressions" TO "authenticated";
GRANT ALL ON TABLE "public"."person_card_impressions" TO "service_role";



GRANT ALL ON TABLE "public"."photo_aesthetic_batches" TO "anon";
GRANT ALL ON TABLE "public"."photo_aesthetic_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_aesthetic_batches" TO "service_role";



GRANT ALL ON TABLE "public"."photo_aesthetic_labels" TO "anon";
GRANT ALL ON TABLE "public"."photo_aesthetic_labels" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_aesthetic_labels" TO "service_role";



GRANT ALL ON TABLE "public"."photo_aesthetic_runs" TO "anon";
GRANT ALL ON TABLE "public"."photo_aesthetic_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_aesthetic_runs" TO "service_role";



GRANT ALL ON TABLE "public"."photo_backfill_batches" TO "anon";
GRANT ALL ON TABLE "public"."photo_backfill_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_backfill_batches" TO "service_role";



GRANT ALL ON TABLE "public"."photo_backfill_runs" TO "anon";
GRANT ALL ON TABLE "public"."photo_backfill_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_backfill_runs" TO "service_role";



GRANT ALL ON TABLE "public"."place_admin_actions" TO "anon";
GRANT ALL ON TABLE "public"."place_admin_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."place_admin_actions" TO "service_role";



GRANT ALL ON TABLE "public"."place_external_reviews" TO "anon";
GRANT ALL ON TABLE "public"."place_external_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."place_external_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."place_intelligence_trial_runs" TO "anon";
GRANT ALL ON TABLE "public"."place_intelligence_trial_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."place_intelligence_trial_runs" TO "service_role";



GRANT ALL ON TABLE "public"."place_reviews" TO "anon";
GRANT ALL ON TABLE "public"."place_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."place_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."place_scores" TO "anon";
GRANT ALL ON TABLE "public"."place_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."place_scores" TO "service_role";



GRANT ALL ON TABLE "public"."preference_history" TO "anon";
GRANT ALL ON TABLE "public"."preference_history" TO "authenticated";
GRANT ALL ON TABLE "public"."preference_history" TO "service_role";



GRANT ALL ON TABLE "public"."preferences" TO "anon";
GRANT ALL ON TABLE "public"."preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."preferences" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."referral_credits" TO "anon";
GRANT ALL ON TABLE "public"."referral_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_credits" TO "service_role";



GRANT ALL ON TABLE "public"."refresh_batches" TO "anon";
GRANT ALL ON TABLE "public"."refresh_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."refresh_batches" TO "service_role";



GRANT ALL ON TABLE "public"."refresh_runs" TO "anon";
GRANT ALL ON TABLE "public"."refresh_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."refresh_runs" TO "service_role";



GRANT ALL ON TABLE "public"."refunds" TO "anon";
GRANT ALL ON TABLE "public"."refunds" TO "authenticated";
GRANT ALL ON TABLE "public"."refunds" TO "service_role";



GRANT ALL ON TABLE "public"."rule_entries" TO "anon";
GRANT ALL ON TABLE "public"."rule_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."rule_entries" TO "service_role";



GRANT ALL ON TABLE "public"."rule_set_versions" TO "anon";
GRANT ALL ON TABLE "public"."rule_set_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."rule_set_versions" TO "service_role";



GRANT ALL ON TABLE "public"."rule_sets" TO "anon";
GRANT ALL ON TABLE "public"."rule_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."rule_sets" TO "service_role";



GRANT ALL ON TABLE "public"."rules_run_results" TO "anon";
GRANT ALL ON TABLE "public"."rules_run_results" TO "authenticated";
GRANT ALL ON TABLE "public"."rules_run_results" TO "service_role";



GRANT ALL ON TABLE "public"."rules_runs" TO "anon";
GRANT ALL ON TABLE "public"."rules_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."rules_runs" TO "service_role";



GRANT ALL ON TABLE "public"."rules_versions" TO "anon";
GRANT ALL ON TABLE "public"."rules_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."rules_versions" TO "service_role";



GRANT ALL ON TABLE "public"."saved_card" TO "anon";
GRANT ALL ON TABLE "public"."saved_card" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_card" TO "service_role";



GRANT ALL ON TABLE "public"."saved_people" TO "anon";
GRANT ALL ON TABLE "public"."saved_people" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_people" TO "service_role";



GRANT ALL ON TABLE "public"."scan_events" TO "anon";
GRANT ALL ON TABLE "public"."scan_events" TO "authenticated";
GRANT ALL ON TABLE "public"."scan_events" TO "service_role";



GRANT ALL ON TABLE "public"."scanner_invitations" TO "anon";
GRANT ALL ON TABLE "public"."scanner_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."scanner_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_activities" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_activities" TO "service_role";



GRANT ALL ON TABLE "public"."seed_map_presence" TO "anon";
GRANT ALL ON TABLE "public"."seed_map_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."seed_map_presence" TO "service_role";



GRANT ALL ON TABLE "public"."seeding_batches" TO "anon";
GRANT ALL ON TABLE "public"."seeding_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."seeding_batches" TO "service_role";



GRANT ALL ON TABLE "public"."seeding_operations" TO "anon";
GRANT ALL ON TABLE "public"."seeding_operations" TO "authenticated";
GRANT ALL ON TABLE "public"."seeding_operations" TO "service_role";



GRANT ALL ON TABLE "public"."seeding_runs" TO "anon";
GRANT ALL ON TABLE "public"."seeding_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."seeding_runs" TO "service_role";



GRANT ALL ON TABLE "public"."seeding_tiles" TO "anon";
GRANT ALL ON TABLE "public"."seeding_tiles" TO "authenticated";
GRANT ALL ON TABLE "public"."seeding_tiles" TO "service_role";



GRANT ALL ON TABLE "public"."session_participants" TO "anon";
GRANT ALL ON TABLE "public"."session_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."session_participants" TO "service_role";



GRANT ALL ON TABLE "public"."signal_anchors" TO "anon";
GRANT ALL ON TABLE "public"."signal_anchors" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_anchors" TO "service_role";



GRANT ALL ON TABLE "public"."signal_definition_versions" TO "anon";
GRANT ALL ON TABLE "public"."signal_definition_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_definition_versions" TO "service_role";



GRANT ALL ON TABLE "public"."signal_definitions" TO "anon";
GRANT ALL ON TABLE "public"."signal_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_connect_accounts" TO "anon";
GRANT ALL ON TABLE "public"."stripe_connect_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_connect_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."tag_along_requests" TO "anon";
GRANT ALL ON TABLE "public"."tag_along_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."tag_along_requests" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_types" TO "anon";
GRANT ALL ON TABLE "public"."ticket_types" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_types" TO "service_role";



GRANT ALL ON TABLE "public"."ticketmaster_events_cache" TO "anon";
GRANT ALL ON TABLE "public"."ticketmaster_events_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."ticketmaster_events_cache" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "anon";
GRANT ALL ON TABLE "public"."tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON TABLE "public"."undo_actions" TO "anon";
GRANT ALL ON TABLE "public"."undo_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."undo_actions" TO "service_role";



GRANT ALL ON TABLE "public"."used_trial_phones" TO "anon";
GRANT ALL ON TABLE "public"."used_trial_phones" TO "authenticated";
GRANT ALL ON TABLE "public"."used_trial_phones" TO "service_role";



GRANT ALL ON TABLE "public"."user_activity" TO "anon";
GRANT ALL ON TABLE "public"."user_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity" TO "service_role";



GRANT ALL ON TABLE "public"."user_interactions" TO "anon";
GRANT ALL ON TABLE "public"."user_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_interactions" TO "service_role";



GRANT ALL ON TABLE "public"."user_levels" TO "anon";
GRANT ALL ON TABLE "public"."user_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."user_levels" TO "service_role";



GRANT ALL ON TABLE "public"."user_location_history" TO "anon";
GRANT ALL ON TABLE "public"."user_location_history" TO "authenticated";
GRANT ALL ON TABLE "public"."user_location_history" TO "service_role";



GRANT ALL ON TABLE "public"."user_map_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_map_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_map_settings" TO "service_role";



GRANT ALL ON TABLE "public"."user_preference_learning" TO "anon";
GRANT ALL ON TABLE "public"."user_preference_learning" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preference_learning" TO "service_role";



GRANT ALL ON TABLE "public"."user_push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."user_reports" TO "anon";
GRANT ALL ON TABLE "public"."user_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."user_reports" TO "service_role";



GRANT ALL ON TABLE "public"."user_sessions" TO "anon";
GRANT ALL ON TABLE "public"."user_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."user_taste_matches" TO "anon";
GRANT ALL ON TABLE "public"."user_taste_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."user_taste_matches" TO "service_role";



GRANT ALL ON TABLE "public"."user_visits" TO "anon";
GRANT ALL ON TABLE "public"."user_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."user_visits" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist_entries" TO "anon";
GRANT ALL ON TABLE "public"."waitlist_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist_entries" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































RESET ALL;
