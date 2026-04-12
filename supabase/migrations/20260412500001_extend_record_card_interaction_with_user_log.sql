-- ORCH-0408 Phase 4: Extend record_card_interaction to also log to user_interactions.
-- When context params are provided (new clients), INSERTs a row into user_interactions.
-- When context is NULL (old clients / backward compat), counter-only — no INSERT.

CREATE OR REPLACE FUNCTION public.record_card_interaction(
  p_card_id TEXT,
  p_interaction_type TEXT,
  p_category TEXT DEFAULT NULL,
  p_price_tier TEXT DEFAULT NULL,
  p_is_curated BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_interaction_type NOT IN ('swipe_left', 'swipe_right', 'expand', 'schedule') THEN
    RAISE EXCEPTION 'Invalid interaction type: %', p_interaction_type;
  END IF;

  -- Card-level counter increment (Phase 2-3 logic, unchanged)
  IF p_interaction_type = 'swipe_right' THEN
    UPDATE public.card_pool SET save_count = save_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  ELSIF p_interaction_type = 'swipe_left' THEN
    UPDATE public.card_pool SET skip_count = skip_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  ELSIF p_interaction_type = 'expand' THEN
    UPDATE public.card_pool SET expand_count = expand_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  ELSIF p_interaction_type = 'schedule' THEN
    UPDATE public.card_pool SET visit_count = visit_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  END IF;

  -- Phase 4: Log to user_interactions when context is provided.
  -- Old clients (pre-OTA) send NULL for all context params — skip the INSERT.
  -- New clients send at least p_category — triggers the INSERT.
  IF p_category IS NOT NULL THEN
    INSERT INTO public.user_interactions (
      user_id,
      experience_id,
      interaction_type,
      interaction_data,
      created_at
    ) VALUES (
      auth.uid(),
      p_card_id,
      p_interaction_type,
      jsonb_build_object(
        'category', p_category,
        'priceTier', p_price_tier,
        'isCurated', p_is_curated
      ),
      now()
    );
  END IF;
END;
$$;
