-- Issue #4599 — an answer Ari could not confirm is an observable gap, but it
-- is not a failure that contributes to the repeated-failure escalation rule.
BEGIN;

ALTER TABLE public.ari_capability_gap_events
  DROP CONSTRAINT IF EXISTS ari_capability_gap_events_gap_type_check;
ALTER TABLE public.ari_capability_gap_events
  ADD CONSTRAINT ari_capability_gap_events_gap_type_check CHECK (gap_type IN (
    'refusal', 'flow_parked', 'repeated_request', 'negative_feedback',
    'frustration', 'empty_reply', 'tool_error', 'dropped_route', 'unconfirmed'
  ));

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
    WHEN 'unconfirmed' THEN 'Ari could not confirm the answer'
    ELSE 'Other'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_gap_type_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_gap_type_label(text) TO authenticated, service_role;

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
      'frustration', 'empty_reply', 'tool_error', 'dropped_route', 'unconfirmed'
    ) THEN
      RAISE EXCEPTION 'invalid_gap_type' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.ari_capability_gaps(capability_key, title, description, example_request, occurrence_count)
    VALUES ('auto.' || replace(v_type, '_', '-'), public.ari_gap_type_label(v_type),
            'Logged automatically from Ari turns (#3355 Wave D; #4599 truth pass).', '', 1)
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

COMMIT;
