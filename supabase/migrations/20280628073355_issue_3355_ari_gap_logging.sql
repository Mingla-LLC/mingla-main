-- Issue #3355 Wave D (D2, D3, D4) — Ari logs where it falls short, the team
-- sees it weekly, and a stuck host can ask the Mingla team.
--
-- ari_capability_gaps (20280209003355) is one row per gap kind with a count;
-- nothing wrote to it. Each occurrence now also gets an event row with a
-- PII-minimised excerpt (the edge scrubs emails, phones and card-like
-- numbers and caps it at 240 characters) and a transcript pointer
-- (conversation_id + message_id), at most one row per gap type per turn.
--
--   * ari_record_turn_gaps(): service role only, fail-soft at the edge.
--   * ari_conversation_gap_signals(): the caller's own conversation, the gap
--     types inside its last 5 owner turns (D4 escalation reads this).
--   * ari_admin_capability_gap_events() / ari_admin_gap_to_eval(): the Admin
--     "Ari gaps" view and its "Turn into eval" action (admins only).
--   * ari_gap_weekly_digest(): one Work board card per week through the
--     existing ops_auto_card_upsert path (auto_key ari_gap_digest:<ISO week>),
--     recorded in ari_gap_digests so Admin shows it even when the card is
--     refused; scheduled with pg_cron on Mondays.
--   * ari_tell_owner_in_brand_group(): an "Ask the Mingla team" note goes out
--     at most once per Ari conversation per hour.
--
-- Static SQL only; conflicts raise PT409.
-- Proof: __tests__/issue_3355_ari_gap_logging.implementor.pg17.test.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ari_capability_gap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_id uuid NOT NULL REFERENCES public.ari_capability_gaps(id) ON DELETE CASCADE,
  gap_type text NOT NULL CHECK (gap_type IN (
    'refusal', 'flow_parked', 'repeated_request', 'negative_feedback',
    'frustration', 'empty_reply', 'tool_error', 'dropped_route'
  )),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  turn_key text NOT NULL CHECK (char_length(turn_key) BETWEEN 1 AND 200),
  excerpt text NOT NULL DEFAULT '' CHECK (char_length(excerpt) <= 240),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  strong boolean NOT NULL DEFAULT false,
  eval_scenario_id uuid REFERENCES public.ari_evaluation_scenarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_key, gap_type)
);
CREATE INDEX IF NOT EXISTS ari_capability_gap_events_conversation
  ON public.ari_capability_gap_events(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ari_capability_gap_events_week
  ON public.ari_capability_gap_events(created_at DESC, gap_type);

ALTER TABLE public.ari_capability_gap_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_capability_gap_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_capability_gap_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ari_capability_gap_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ari_capability_gap_events TO service_role;
DROP POLICY IF EXISTS ari_capability_gap_events_owner_read ON public.ari_capability_gap_events;
CREATE POLICY ari_capability_gap_events_owner_read
  ON public.ari_capability_gap_events FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.ari_gap_digests (
  week_start date PRIMARY KEY,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  card jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(card) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ari_gap_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_gap_digests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_gap_digests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ari_gap_digests TO service_role;

-- The plain name of each gap type (Admin, digest card).
CREATE OR REPLACE FUNCTION public.ari_gap_type_label(p_type text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE p_type
    WHEN 'refusal' THEN 'Ari said it could not help'
    WHEN 'flow_parked' THEN 'A setup was set aside for a new request'
    WHEN 'repeated_request' THEN 'The host asked again'
    WHEN 'negative_feedback' THEN 'Thumbs down'
    WHEN 'frustration' THEN 'The host sounded frustrated'
    WHEN 'empty_reply' THEN 'Ari gave an empty reply'
    WHEN 'tool_error' THEN 'A tool failed'
    WHEN 'dropped_route' THEN 'A screen link was dropped'
    ELSE 'Other'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_gap_type_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_gap_type_label(text) TO authenticated, service_role;

-- One call per turn from agent-chat / ari-message-feedback (service role).
-- p_gaps: [{type, excerpt, strong, detail}]. A type already logged for this
-- turn is skipped, so each type counts once per turn.
CREATE OR REPLACE FUNCTION public.ari_record_turn_gaps(
  p_user_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_turn_key text,
  p_gaps jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_gap jsonb;
  v_type text;
  v_parent uuid;
  v_brand uuid;
  v_inserted integer := 0;
  v_id uuid;
BEGIN
  IF p_turn_key IS NULL OR char_length(p_turn_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_turn_key' USING ERRCODE = '22023';
  END IF;
  IF p_gaps IS NULL OR jsonb_typeof(p_gaps) <> 'array' OR jsonb_array_length(p_gaps) > 8 THEN
    RAISE EXCEPTION 'invalid_gaps' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NOT NULL THEN
    SELECT c.brand_id INTO v_brand FROM public.agent_conversations c
     WHERE c.id = p_conversation_id AND c.user_id IS NOT DISTINCT FROM p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'conversation_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;
  FOR v_gap IN SELECT g FROM jsonb_array_elements(p_gaps) g LOOP
    v_type := v_gap->>'type';
    IF v_type IS NULL OR v_type NOT IN (
      'refusal', 'flow_parked', 'repeated_request', 'negative_feedback',
      'frustration', 'empty_reply', 'tool_error', 'dropped_route'
    ) THEN
      RAISE EXCEPTION 'invalid_gap_type' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.ari_capability_gaps(capability_key, title, description, example_request, occurrence_count)
    VALUES ('auto.' || replace(v_type, '_', '-'), public.ari_gap_type_label(v_type),
            'Logged automatically from Ari turns (#3355 Wave D).', '', 1)
    ON CONFLICT (capability_key) DO UPDATE SET title = EXCLUDED.title
    RETURNING id INTO v_parent;
    v_id := NULL;
    INSERT INTO public.ari_capability_gap_events(
      gap_id, gap_type, user_id, brand_id, conversation_id, message_id,
      turn_key, excerpt, detail, strong
    ) VALUES (
      v_parent, v_type, p_user_id, v_brand, p_conversation_id, p_message_id,
      p_turn_key, left(COALESCE(v_gap->>'excerpt', ''), 240),
      CASE WHEN jsonb_typeof(v_gap->'detail') = 'object' THEN v_gap->'detail' ELSE '{}'::jsonb END,
      COALESCE((v_gap->>'strong')::boolean, false)
    )
    ON CONFLICT (turn_key, gap_type) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      v_inserted := v_inserted + 1;
      UPDATE public.ari_capability_gaps
         SET occurrence_count = (SELECT count(*) FROM public.ari_capability_gap_events e WHERE e.gap_id = v_parent),
             example_request = CASE WHEN COALESCE(v_gap->>'excerpt', '') = '' THEN example_request
                                    ELSE left(v_gap->>'excerpt', 240) END,
             last_seen_at = now(), updated_at = now()
       WHERE id = v_parent;
    END IF;
  END LOOP;
  RETURN v_inserted;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_record_turn_gaps(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_record_turn_gaps(uuid, uuid, uuid, text, jsonb) TO service_role;

-- The gap types inside the caller's last 5 owner turns of this conversation.
CREATE OR REPLACE FUNCTION public.ari_conversation_gap_signals(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_since timestamptz;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_conversations c
     WHERE c.id = p_conversation_id AND c.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT min(m.created_at) INTO v_since FROM (
    SELECT created_at FROM public.agent_messages
     WHERE conversation_id = p_conversation_id AND user_id = v_actor AND role = 'user'
     ORDER BY created_at DESC LIMIT 5
  ) m;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'type', e.gap_type, 'strong', e.strong,
      'excerpt', e.excerpt, 'created_at', e.created_at
    ) ORDER BY e.created_at DESC)
    FROM public.ari_capability_gap_events e
    WHERE e.conversation_id = p_conversation_id AND e.user_id = v_actor
      AND e.created_at >= COALESCE(v_since, now() - interval '1 day')
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_conversation_gap_signals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_conversation_gap_signals(uuid) TO authenticated, service_role;

-- Admin "Ari gaps": counts by type and week, plus the latest events.
CREATE OR REPLACE FUNCTION public.ari_admin_capability_gap_events(
  p_weeks integer DEFAULT 8,
  p_type text DEFAULT NULL,
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_since timestamptz := date_trunc('week', now())
    - make_interval(weeks => LEAST(GREATEST(COALESCE(p_weeks, 8), 1), 26) - 1);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN jsonb_build_object(
    'since', v_since,
    'weeks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'week_start', w.week_start, 'gap_type', w.gap_type,
        'label', public.ari_gap_type_label(w.gap_type), 'count', w.n
      ) ORDER BY w.week_start DESC, w.n DESC, w.gap_type)
      FROM (
        SELECT date_trunc('week', e.created_at)::date AS week_start, e.gap_type, count(*) AS n
          FROM public.ari_capability_gap_events e
         WHERE e.created_at >= v_since
           AND (p_type IS NULL OR e.gap_type = p_type)
         GROUP BY 1, 2
      ) w
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
      FROM (
        SELECT e.id, e.gap_type, public.ari_gap_type_label(e.gap_type) AS label,
               date_trunc('week', e.created_at)::date AS week_start,
               e.excerpt, e.strong, e.created_at, e.conversation_id, e.message_id,
               e.brand_id, b.name AS brand_name,
               (SELECT q.id FROM public.ari_quality_cases q
                 WHERE q.source_conversation_id = e.conversation_id
                 ORDER BY q.detected_at DESC LIMIT 1) AS quality_case_id,
               s.scenario_key AS eval_scenario_key
          FROM public.ari_capability_gap_events e
          LEFT JOIN public.brands b ON b.id = e.brand_id
          LEFT JOIN public.ari_evaluation_scenarios s ON s.id = e.eval_scenario_id
         WHERE e.created_at >= v_since
           AND (p_type IS NULL OR e.gap_type = p_type)
         ORDER BY e.created_at DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
      ) x
    ), '[]'::jsonb),
    'digests', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.week_start DESC)
      FROM (SELECT * FROM public.ari_gap_digests ORDER BY week_start DESC LIMIT 8) d
    ), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_admin_capability_gap_events(integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_capability_gap_events(integer, text, integer) TO authenticated, service_role;

-- "Turn into eval": one evaluation scenario per gap event (idempotent).
CREATE OR REPLACE FUNCTION public.ari_admin_gap_to_eval(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.ari_capability_gap_events%ROWTYPE;
  v_key text;
  v_scenario public.ari_evaluation_scenarios%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_event FROM public.ari_capability_gap_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_event.eval_scenario_id IS NOT NULL THEN
    SELECT * INTO v_scenario FROM public.ari_evaluation_scenarios WHERE id = v_event.eval_scenario_id;
    IF FOUND THEN
      RETURN to_jsonb(v_scenario) || jsonb_build_object('created', false);
    END IF;
  END IF;
  IF btrim(v_event.excerpt) = '' THEN
    RAISE EXCEPTION 'gap_has_no_excerpt' USING ERRCODE = '22023';
  END IF;
  v_key := 'GAP-' || upper(left(replace(v_event.id::text, '-', ''), 12));
  INSERT INTO public.ari_evaluation_scenarios(
    scenario_key, title, market, mode, status, input_fixture, expected_fixture, tags
  ) VALUES (
    v_key,
    left(public.ari_gap_type_label(v_event.gap_type) || ': ' || v_event.excerpt, 160),
    NULL, 'self_serve', 'active',
    jsonb_build_object(
      'message', v_event.excerpt,
      'fixture_kind', 'gap_replay',
      'gap_type', v_event.gap_type,
      'source_gap_event_id', v_event.id
    ),
    jsonb_build_object(
      'required_tools', '[]'::jsonb,
      'forbidden_tools', '[]'::jsonb,
      'forbidden_phrases', jsonb_build_array('I didn''t catch that'),
      'forbidden_gap_types', jsonb_build_array(v_event.gap_type),
      'require_canonical_readback', false
    ),
    ARRAY['gap', v_event.gap_type]::text[]
  )
  ON CONFLICT (scenario_key) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_scenario;
  UPDATE public.ari_capability_gap_events SET eval_scenario_id = v_scenario.id WHERE id = v_event.id;
  RETURN to_jsonb(v_scenario) || jsonb_build_object('created', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_admin_gap_to_eval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_gap_to_eval(uuid) TO authenticated, service_role;

-- The weekly digest: counts for the ISO week starting p_week_start (default:
-- last week), saved in ari_gap_digests and posted as ONE Work board card
-- through ops_auto_card_upsert (its auto_key makes a second run a no-op).
CREATE OR REPLACE FUNCTION public.ari_gap_weekly_digest(p_week_start date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_week date := date_trunc('week', COALESCE(p_week_start::timestamp, now() - interval '7 days'))::date;
  v_counts jsonb;
  v_total integer;
  v_lines text;
  v_card jsonb := '{}'::jsonb;
  v_owner text := public.ops_owner_email();
BEGIN
  SELECT COALESCE(jsonb_object_agg(t.gap_type, t.n), '{}'::jsonb), COALESCE(sum(t.n), 0)::integer
    INTO v_counts, v_total
    FROM (
      SELECT e.gap_type, count(*) AS n FROM public.ari_capability_gap_events e
       WHERE e.created_at >= v_week AND e.created_at < v_week + 7
       GROUP BY e.gap_type
    ) t;
  IF v_total = 0 THEN
    v_card := jsonb_build_object('status', 'skipped_empty');
  ELSE
    SELECT string_agg(format('- %s: %s', public.ari_gap_type_label(t.gap_type), t.n), E'\n' ORDER BY t.n DESC, t.gap_type)
      INTO v_lines
      FROM (
        SELECT key AS gap_type, value::integer AS n FROM jsonb_each_text(v_counts)
      ) t;
    v_card := public.ops_auto_card_upsert(
      'ari_gap_digest:' || to_char(v_week, 'IYYY-"W"IW'),
      jsonb_build_object(
        'title', left(format('Ari gaps, week of %s: %s', to_char(v_week, 'FMDD Mon YYYY'), v_total), 160),
        'instructions', left(format(
          E'Ari logged %s gaps in the week of %s.\n%s\nOpen Mingla Admin > Ari Improvement Lab > Ari gaps, read the top excerpts and turn the clearest ones into evals.',
          v_total, to_char(v_week, 'FMDD Mon YYYY'), v_lines), 4000),
        'done_means', 'The top gap types this week have an eval scenario or a linked issue.',
        'owners', CASE WHEN v_owner IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_owner) END,
        'watchers', '[]'::jsonb,
        'due_on', public.ops_today(NULL)
      ), 'task', NULL
    );
  END IF;
  INSERT INTO public.ari_gap_digests(week_start, counts, total, card)
  VALUES (v_week, v_counts, v_total, v_card)
  ON CONFLICT (week_start) DO UPDATE
    SET counts = EXCLUDED.counts, total = EXCLUDED.total,
        card = CASE WHEN EXCLUDED.card->>'status' = 'kept' AND public.ari_gap_digests.card ? 'number'
                    THEN public.ari_gap_digests.card ELSE EXCLUDED.card END,
        updated_at = now();
  RETURN jsonb_build_object('week_start', v_week, 'counts', v_counts, 'total', v_total, 'card', v_card);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_gap_weekly_digest(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_gap_weekly_digest(date) TO service_role;

-- "Ask the Mingla team" (D4): the receipt-backed tell_owner send, plus one
-- rule — at most one such note per Ari conversation per hour.
CREATE OR REPLACE FUNCTION public.ari_tell_owner_in_brand_group(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_confirmed jsonb;
  v_begin jsonb;
  v_message_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  -- The receipt binds to the exact approval; the note must be its words.
  SELECT tool_args INTO v_confirmed
    FROM public.agent_pending_actions
   WHERE id = p_operation_id
     AND user_id = auth.uid()
     AND tool_name = 'tell_owner_in_brand_group';
  IF v_confirmed IS NULL
     OR v_confirmed->>'message' IS DISTINCT FROM p_content THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;
  -- And only into the approved brand's own group: a teammate on two brands
  -- can never post one brand's approved note in another brand's group.
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND c.linked_entity_type = 'brand'
       -- uuid text is lower-case; an approval may hold it in either case.
       AND c.brand_id::text = lower(v_confirmed->>'brand_id')
  ) THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;

  v_begin := public.agent_operation_receipt_begin(
    p_operation_id, 'tell_owner_in_brand_group', v_confirmed);
  IF COALESCE((v_begin->>'replay')::boolean, false) THEN
    RETURN (v_begin->'result') || jsonb_build_object('replayed', true);
  END IF;

  -- #3355 Wave D (D4): one "Ask the Mingla team" note per Ari chat per hour.
  IF v_confirmed->>'about' = 'ask_mingla_team' AND EXISTS (
    SELECT 1
      FROM public.agent_operation_receipts r
      JOIN public.agent_pending_actions p ON p.id = r.operation_id
     WHERE r.user_id = auth.uid()
       AND r.tool_name = 'tell_owner_in_brand_group'
       AND r.operation_id <> p_operation_id
       AND r.completed_at > now() - interval '1 hour'
       AND p.tool_args->>'about' = 'ask_mingla_team'
       AND p.tool_args->>'ari_conversation_id' IS NOT DISTINCT FROM v_confirmed->>'ari_conversation_id'
  ) THEN
    RAISE EXCEPTION 'ask_team_recently_sent' USING ERRCODE = 'PT409';
  END IF;

  -- Sent as the caller, in brand mode; the group's own membership and
  -- posting checks apply unchanged.
  v_message_id := public.issue_3720_send_brand_group_message(
    p_conversation_id, p_content, NULL, '{}'::uuid[], 'brand', '{}'::uuid[]);

  RETURN public.agent_operation_receipt_complete(
    p_operation_id,
    'tell_owner_in_brand_group',
    v_confirmed,
    jsonb_build_object(
      'sent', true,
      'message_id', v_message_id,
      'conversation_id', p_conversation_id
    )
  ) || jsonb_build_object('replayed', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ari_tell_owner_in_brand_group(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_tell_owner_in_brand_group(uuid, uuid, text)
  TO authenticated, service_role;

COMMIT;

-- The weekly digest job (Mondays 07:10 UTC). Unscheduled by job id first so
-- a re-apply replaces it; skipped where pg_cron is not installed.
DO $cron$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #3355: pg_cron unavailable; Ari gap digest not scheduled.';
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_3355_ari_gap_weekly_digest' LIMIT 1;
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule(
    'issue_3355_ari_gap_weekly_digest',
    '10 7 * * 1',
    'SELECT public.ari_gap_weekly_digest(NULL);'
  );
END;
$cron$;
