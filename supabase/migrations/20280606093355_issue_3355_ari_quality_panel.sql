-- Issue #3355 Wave F (F2) — the Ari quality panel's numbers, for Mingla
-- admins only.
--
-- One read-only, admin-only RPC over a selectable window (1..180 days):
--   * flow completion rate  = guided setups started in the window that
--                              completed / setups started;
--   * park rate             = setups started in the window that were ever
--                              parked / setups started;
--   * refusal rate          = refusal gap events / Ari replies;
--   * repeat-request rate   = repeated_request gap events / host turns;
--   * empty-reply rate      = empty_reply gap events / Ari replies;
--   * turns to done         = host messages between a setup's start and its
--                              completion, per setup (flow_key);
--   * thumbs up / down      = ari_message_feedback in the window.
-- Gap events come from ari_capability_gap_events (Wave D, 20280606073355).
-- A rate whose denominator is 0 is NULL (the panel shows "no data"), never 0.
--
-- Static SQL (no EXECUTE), SECURITY DEFINER with a fixed search_path, and
-- refused for anyone but a Mingla admin (is_admin_user), like the Wave D
-- ari_admin_capability_gap_events. Nothing is written.

CREATE OR REPLACE FUNCTION public.ari_admin_quality_metrics(
  p_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 180);
  v_since timestamptz;
  v_runs bigint;
  v_completed bigint;
  v_parked bigint;
  v_cancelled bigint;
  v_expired bigint;
  v_open bigint;
  v_owner_turns bigint;
  v_replies bigint;
  v_refusals bigint;
  v_repeats bigint;
  v_empty bigint;
  v_up bigint;
  v_down bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_since := now() - make_interval(days => v_days);

  SELECT count(*),
         count(*) FILTER (WHERE r.status = 'completed'),
         count(*) FILTER (WHERE r.parked_at IS NOT NULL OR r.status = 'parked'),
         count(*) FILTER (WHERE r.status = 'cancelled'),
         count(*) FILTER (WHERE r.status = 'expired'),
         count(*) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'expired'))
    INTO v_runs, v_completed, v_parked, v_cancelled, v_expired, v_open
    FROM public.ari_flow_runs r
   WHERE r.created_at >= v_since;

  SELECT count(*) FILTER (WHERE m.role = 'user'),
         count(*) FILTER (WHERE m.role = 'assistant')
    INTO v_owner_turns, v_replies
    FROM public.agent_messages m
   WHERE m.created_at >= v_since
     AND m.role IN ('user', 'assistant');

  SELECT count(*) FILTER (WHERE e.gap_type = 'refusal'),
         count(*) FILTER (WHERE e.gap_type = 'repeated_request'),
         count(*) FILTER (WHERE e.gap_type = 'empty_reply')
    INTO v_refusals, v_repeats, v_empty
    FROM public.ari_capability_gap_events e
   WHERE e.created_at >= v_since;

  SELECT count(*) FILTER (WHERE f.sentiment = 'positive'),
         count(*) FILTER (WHERE f.sentiment = 'negative')
    INTO v_up, v_down
    FROM public.ari_message_feedback f
   WHERE f.updated_at >= v_since;

  RETURN jsonb_build_object(
    'since', v_since,
    'days', v_days,
    'flows', jsonb_build_object(
      'started', v_runs,
      'completed', v_completed,
      'parked', v_parked,
      'cancelled', v_cancelled,
      'expired', v_expired,
      'open', v_open
    ),
    'turns', jsonb_build_object(
      'host_turns', v_owner_turns,
      'ari_replies', v_replies,
      'refusals', v_refusals,
      'repeat_requests', v_repeats,
      'empty_replies', v_empty
    ),
    'rates', jsonb_build_object(
      'flow_completion', CASE WHEN v_runs > 0
        THEN round(v_completed::numeric / v_runs, 4) END,
      'park', CASE WHEN v_runs > 0
        THEN round(v_parked::numeric / v_runs, 4) END,
      'refusal', CASE WHEN v_replies > 0
        THEN round(v_refusals::numeric / v_replies, 4) END,
      'repeat_request', CASE WHEN v_owner_turns > 0
        THEN round(v_repeats::numeric / v_owner_turns, 4) END,
      'empty_reply', CASE WHEN v_replies > 0
        THEN round(v_empty::numeric / v_replies, 4) END,
      'thumbs_up', CASE WHEN v_up + v_down > 0
        THEN round(v_up::numeric / (v_up + v_down), 4) END
    ),
    'feedback', jsonb_build_object('up', v_up, 'down', v_down),
    'turns_to_done', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'flow_key', t.flow_key,
        'completed', t.n,
        'avg_turns', t.avg_turns,
        'median_turns', t.median_turns
      ) ORDER BY t.n DESC, t.flow_key)
      FROM (
        SELECT d.flow_key,
               count(*) AS n,
               round(avg(d.turns)::numeric, 1) AS avg_turns,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY d.turns) AS median_turns
          FROM (
            SELECT r.flow_key,
                   (SELECT count(*)
                      FROM public.agent_messages m
                     WHERE m.conversation_id = r.conversation_id
                       AND m.role = 'user'
                       AND m.created_at >= r.created_at
                       AND m.created_at <= r.completed_at) AS turns
              FROM public.ari_flow_runs r
             WHERE r.created_at >= v_since
               AND r.status = 'completed'
               AND r.completed_at IS NOT NULL
               AND r.conversation_id IS NOT NULL
          ) d
         GROUP BY d.flow_key
      ) t
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.ari_admin_quality_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_quality_metrics(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.ari_admin_quality_metrics(integer) IS
  '#3355 Wave F (F2): Ari quality panel numbers over the last p_days (1..180): flow completion, park, refusal, repeat-request, empty-reply and thumbs-up rates, turns to done per setup. Admin only; read only.';
