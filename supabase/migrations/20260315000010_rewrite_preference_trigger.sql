-- ============================================================
-- Rewrite preference trigger: multi-dimension preference extraction
-- Extracts: category, price_tier, time_of_day, distance_bucket
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_user_preferences_from_interaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category   TEXT;
  v_price_tier TEXT;
  v_time_of_day TEXT;
  v_distance_km DOUBLE PRECISION;
  v_distance_bucket TEXT;
  v_weight     DOUBLE PRECISION;
BEGIN
  -- ── Determine interaction weight ──────────────────────────
  CASE NEW.interaction_type
    WHEN 'visit'         THEN v_weight := 0.35;
    WHEN 'schedule'      THEN v_weight := 0.25;
    WHEN 'save'          THEN v_weight := 0.20;
    WHEN 'swipe_right'   THEN v_weight := 0.15;
    WHEN 'like'          THEN v_weight := 0.10;
    WHEN 'click_details' THEN v_weight := 0.10;
    WHEN 'view'          THEN v_weight := 0.03;
    WHEN 'tap'           THEN v_weight := 0.03;
    WHEN 'swipe_left'    THEN v_weight := -0.05;
    WHEN 'dislike'       THEN v_weight := -0.10;
    WHEN 'unsave'        THEN v_weight := -0.15;
    ELSE                      v_weight := 0.0;
  END CASE;

  -- Skip if weight is zero (unknown interaction type)
  IF v_weight = 0.0 THEN
    RETURN NEW;
  END IF;

  -- ── Extract dimensions from interaction_data ──────────────
  v_category    := NEW.interaction_data->>'category';
  v_price_tier  := NEW.interaction_data->>'priceTier';
  v_time_of_day := NEW.interaction_data->>'timeOfDay';

  -- Distance: use pre-computed distanceKm from interaction_data
  v_distance_km := (NEW.interaction_data->>'distanceKm')::DOUBLE PRECISION;

  -- ── 1. Category preference ───────────────────────────────
  IF v_category IS NOT NULL AND v_category != '' THEN
    INSERT INTO public.user_preference_learning
      (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
    VALUES
      (NEW.user_id, 'category', v_category, GREATEST(0.0, 0.5 + v_weight), 0.1, 1)
    ON CONFLICT (user_id, preference_type, preference_key)
    DO UPDATE SET
      preference_value = GREATEST(0.0, LEAST(1.0,
        user_preference_learning.preference_value + v_weight)),
      confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
      interaction_count = user_preference_learning.interaction_count + 1,
      last_updated = now();
  END IF;

  -- ── 2. Price tier preference ──────────────────────────────
  IF v_price_tier IS NOT NULL AND v_price_tier != '' THEN
    INSERT INTO public.user_preference_learning
      (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
    VALUES
      (NEW.user_id, 'price_tier', v_price_tier, GREATEST(0.0, 0.5 + v_weight), 0.1, 1)
    ON CONFLICT (user_id, preference_type, preference_key)
    DO UPDATE SET
      preference_value = GREATEST(0.0, LEAST(1.0,
        user_preference_learning.preference_value + v_weight)),
      confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
      interaction_count = user_preference_learning.interaction_count + 1,
      last_updated = now();
  END IF;

  -- ── 3. Time of day preference ─────────────────────────────
  IF v_time_of_day IS NOT NULL AND v_time_of_day != '' THEN
    INSERT INTO public.user_preference_learning
      (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
    VALUES
      (NEW.user_id, 'time_of_day', v_time_of_day, GREATEST(0.0, 0.5 + v_weight), 0.1, 1)
    ON CONFLICT (user_id, preference_type, preference_key)
    DO UPDATE SET
      preference_value = GREATEST(0.0, LEAST(1.0,
        user_preference_learning.preference_value + v_weight)),
      confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
      interaction_count = user_preference_learning.interaction_count + 1,
      last_updated = now();
  END IF;

  -- ── 4. Distance bucket preference (positive interactions only) ──
  IF v_weight > 0 AND v_distance_km IS NOT NULL THEN
    IF v_distance_km <= 3 THEN
      v_distance_bucket := 'walking';
    ELSIF v_distance_km <= 10 THEN
      v_distance_bucket := 'near';
    ELSIF v_distance_km <= 25 THEN
      v_distance_bucket := 'medium';
    ELSE
      v_distance_bucket := 'far';
    END IF;

    INSERT INTO public.user_preference_learning
      (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
    VALUES
      (NEW.user_id, 'distance', v_distance_bucket, GREATEST(0.0, 0.5 + v_weight), 0.1, 1)
    ON CONFLICT (user_id, preference_type, preference_key)
    DO UPDATE SET
      preference_value = GREATEST(0.0, LEAST(1.0,
        user_preference_learning.preference_value + v_weight)),
      confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
      interaction_count = user_preference_learning.interaction_count + 1,
      last_updated = now();
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'update_user_preferences_from_interaction failed: %', SQLERRM;
    RETURN NEW;
END;
$$;
