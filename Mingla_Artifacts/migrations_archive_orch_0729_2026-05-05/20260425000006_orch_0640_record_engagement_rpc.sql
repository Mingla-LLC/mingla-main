-- ORCH-0640 ch04 — record_engagement RPC (DEC-039, DEC-047, DEC-052)
-- Single consolidated write RPC replacing record_card_swipe + both record_card_interaction
-- overloads (all DROPPED in ch11). Implements DEC-047 4-way fan-out for curated events.
--
-- I-ENGAGEMENT-IDENTITY-PLACE-LEVEL: engagement counters key on place_pool_id for
-- singles and curated stops; curated containers key on container_key (ORCH-0634 cache_key).
--
-- Constitutional #3 (no silent failures): invalid inputs RAISE EXCEPTION.
-- Mobile caller wraps in try/catch + console.warn (fire-and-forget UX policy).

BEGIN;

CREATE OR REPLACE FUNCTION public.record_engagement(
  p_event_kind      TEXT,
  p_place_pool_id   UUID    DEFAULT NULL,
  p_container_key   TEXT    DEFAULT NULL,
  p_experience_type TEXT    DEFAULT NULL,
  p_category        TEXT    DEFAULT NULL,
  p_stops           JSONB   DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE EXECUTE ON FUNCTION public.record_engagement FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_engagement TO authenticated, service_role;

COMMENT ON FUNCTION public.record_engagement IS
  'ORCH-0640 (DEC-039, DEC-047, DEC-052): unified engagement write RPC. Single-card path
   writes 1 row keyed on place_pool_id. Curated path fans to N+1 rows (1 container + N stops)
   all sharing container_key (ORCH-0634 cache_key formula:
   sha256(experience_type + '':'' + sorted_stop_place_pool_ids.join('',''))).
   Replaces record_card_swipe + record_card_interaction (both overloads — DROPPED in ch11).';

COMMIT;
