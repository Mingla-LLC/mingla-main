-- ============================================================================
-- Admin Dashboard Overhaul — Migration 2 of 3
-- Creates: Subscription stats RPC + 5 Analytics RPCs
-- ============================================================================

-- ─── 1. Subscription Stats RPC ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_subscription_stats()
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM profiles),
    'free', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'free'),
    'pro', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'pro'),
    'elite', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'elite'),
    'overrides', (SELECT count(*) FROM admin_subscription_overrides WHERE status = 'active'),
    'expiring_soon', (SELECT count(*) FROM admin_subscription_overrides
      WHERE status = 'active' AND expires_at <= now() + interval '7 days')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 2. Analytics — Growth ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_analytics_growth(p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, signups BIGINT) AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT created_at::date AS day, count(*) AS signups
    FROM profiles
    WHERE created_at >= now() - (p_days || ' days')::interval
    GROUP BY created_at::date
    ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 3. Analytics — Engagement ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_analytics_engagement(p_days INT DEFAULT 30)
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. Analytics — Retention (Weekly Cohorts) ─────────────────────────────

CREATE OR REPLACE FUNCTION admin_analytics_retention(p_weeks INT DEFAULT 8)
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 5. Analytics — Funnel ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_analytics_funnel()
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 6. Analytics — Geo ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_analytics_geo()
RETURNS TABLE(country TEXT, user_count BIGINT) AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT coalesce(p.country, 'Unknown') AS country, count(*) AS user_count
    FROM profiles p
    GROUP BY p.country
    ORDER BY user_count DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
