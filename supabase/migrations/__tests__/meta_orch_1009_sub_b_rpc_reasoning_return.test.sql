-- META-ORCH-1009 Sub-B — post-apply probe asserting the two consumer RPCs
-- now return `ai_reasoning jsonb` + `ai_score_raw numeric` columns, and that
-- at least one place with populated `ai_signal_scores` round-trips a non-null
-- reasoning string. Hand-run after operator's `supabase db push --linked`.

\set ON_ERROR_STOP on

-- ─── M-01: query_servable_places_by_signal returns ai_reasoning + ai_score_raw
DO $$
DECLARE
  cols text[];
BEGIN
  SELECT array_agg(p.proargnames[i]::text ORDER BY i) INTO cols
  FROM pg_proc p,
       unnest(generate_subscripts(p.proargnames, 1)) AS i
  WHERE p.proname = 'query_servable_places_by_signal'
    AND p.pronamespace = 'public'::regnamespace;
  -- query parameter introspection is for the args, not RETURNS TABLE columns.
  -- Instead, call pg_get_function_result and check for substring presence.
  IF (SELECT pg_get_function_result(oid)
      FROM pg_proc
      WHERE proname = 'query_servable_places_by_signal'
        AND pronamespace = 'public'::regnamespace) NOT LIKE '%ai_reasoning jsonb%' THEN
    RAISE EXCEPTION 'M-01 FAIL: query_servable_places_by_signal missing ai_reasoning column';
  END IF;
  IF (SELECT pg_get_function_result(oid)
      FROM pg_proc
      WHERE proname = 'query_servable_places_by_signal'
        AND pronamespace = 'public'::regnamespace) NOT LIKE '%ai_score_raw numeric%' THEN
    RAISE EXCEPTION 'M-01 FAIL: query_servable_places_by_signal missing ai_score_raw column';
  END IF;
  RAISE NOTICE 'M-01 PASS: query_servable_places_by_signal returns ai_reasoning + ai_score_raw';
END$$;

-- ─── M-02: query_servable_places_by_signal_intersection same shape
DO $$
BEGIN
  IF (SELECT pg_get_function_result(oid)
      FROM pg_proc
      WHERE proname = 'query_servable_places_by_signal_intersection'
        AND pronamespace = 'public'::regnamespace) NOT LIKE '%ai_reasoning jsonb%' THEN
    RAISE EXCEPTION 'M-02 FAIL: query_servable_places_by_signal_intersection missing ai_reasoning column';
  END IF;
  IF (SELECT pg_get_function_result(oid)
      FROM pg_proc
      WHERE proname = 'query_servable_places_by_signal_intersection'
        AND pronamespace = 'public'::regnamespace) NOT LIKE '%ai_score_raw numeric%' THEN
    RAISE EXCEPTION 'M-02 FAIL: query_servable_places_by_signal_intersection missing ai_score_raw column';
  END IF;
  RAISE NOTICE 'M-02 PASS: query_servable_places_by_signal_intersection returns ai_reasoning + ai_score_raw';
END$$;

-- ─── M-03: ORDER BY clause unchanged (determinism preserved per
--          I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND)
DO $$
DECLARE
  body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO body
  FROM pg_proc WHERE proname = 'query_servable_places_by_signal_intersection'
    AND pronamespace = 'public'::regnamespace;
  IF body NOT LIKE '%ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC%' THEN
    RAISE EXCEPTION 'M-03 FAIL: intersection ORDER BY clause was modified — collab determinism at risk';
  END IF;
  IF body LIKE '%ORDER BY%ai_signal_scores%' OR body LIKE '%ORDER BY%ai_score_raw%' OR body LIKE '%ORDER BY%ai_reasoning%' THEN
    RAISE EXCEPTION 'M-03 FAIL: ORDER BY references an AI column — request-time blend forbidden';
  END IF;
  RAISE NOTICE 'M-03 PASS: intersection ORDER BY clause preserved verbatim';
END$$;

-- ─── M-04: spot-check — at least one place with populated ai_signal_scores
--          returns a non-null ai_reasoning slice for an evaluated signal
DO $$
DECLARE
  sample_place uuid;
  sample_signal text;
  reasoning_text text;
BEGIN
  -- Pick any place with ai_signal_scores populated and at least one evaluated
  -- signal that also has a place_scores row (so the JOIN in the RPC succeeds).
  SELECT pp.id, key
  INTO sample_place, sample_signal
  FROM place_pool pp,
       LATERAL jsonb_object_keys(pp.ai_signal_scores) AS key
  JOIN place_scores ps ON ps.place_id = pp.id AND ps.signal_id = key
  WHERE pp.ai_signal_scores IS NOT NULL
    AND pp.is_servable = true
    AND pp.is_active = true
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND pp.lat IS NOT NULL
    AND pp.lng IS NOT NULL
  LIMIT 1;

  IF sample_place IS NULL THEN
    RAISE NOTICE 'M-04 SKIP: no servable place with both ai_signal_scores + place_scores row found (Sub-C coverage still backfilling) — probe is informational';
    RETURN;
  END IF;

  SELECT (q.ai_reasoning ->> 'reasoning')
  INTO reasoning_text
  FROM query_servable_places_by_signal(
    sample_signal,
    0::numeric,  -- accept any score; we just want the row
    (SELECT lat FROM place_pool WHERE id = sample_place),
    (SELECT lng FROM place_pool WHERE id = sample_place),
    1000.0,
    '{}'::uuid[],
    5
  ) AS q
  WHERE q.place_id = sample_place
  LIMIT 1;

  IF reasoning_text IS NULL OR length(reasoning_text) = 0 THEN
    RAISE EXCEPTION 'M-04 FAIL: RPC returned NULL/empty ai_reasoning.reasoning for sample (place=%, signal=%)', sample_place, sample_signal;
  END IF;

  RAISE NOTICE 'M-04 PASS: RPC round-tripped reasoning for sample (place=%, signal=%, reasoning_chars=%)',
    sample_place, sample_signal, length(reasoning_text);
END$$;
