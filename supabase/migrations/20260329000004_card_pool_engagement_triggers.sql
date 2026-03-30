-- ============================================================================
-- Triggers to maintain card_pool engagement counters
-- ============================================================================
-- INSERT/UPDATE only for impressions/visits (SET NULL on user delete).
-- place_reviews uses CASCADE so we handle DELETE there to recompute.
-- Every trigger recomputes engagement_score after counter changes.
--
-- engagement_score = (saves*3 + visits*5 + expands*1 - skips*1) / max(served, 1)
--
-- Note: impression_count is removed — served_count (pre-existing) is used.
-- dismiss_count is removed — no matching impression_type exists in the system.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════
-- Trigger 1: user_card_impressions → card_pool counters + engagement_score
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_card_pool_impression_counters()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_served INTEGER;
  v_saves INTEGER;
  v_skips INTEGER;
  v_expands INTEGER;
  v_visits INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.card_pool SET
      save_count = save_count + CASE WHEN NEW.impression_type IN ('saved', 'swiped_right') THEN 1 ELSE 0 END,
      skip_count = skip_count + CASE WHEN NEW.impression_type = 'swiped_left' THEN 1 ELSE 0 END,
      expand_count = expand_count + CASE WHEN NEW.impression_type = 'expanded' THEN 1 ELSE 0 END,
      served_count = served_count + CASE WHEN NEW.impression_type = 'served' THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE id = NEW.card_pool_id;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.card_pool SET
      save_count = save_count
        - CASE WHEN OLD.impression_type IN ('saved', 'swiped_right') THEN 1 ELSE 0 END
        + CASE WHEN NEW.impression_type IN ('saved', 'swiped_right') THEN 1 ELSE 0 END,
      skip_count = skip_count
        - CASE WHEN OLD.impression_type = 'swiped_left' THEN 1 ELSE 0 END
        + CASE WHEN NEW.impression_type = 'swiped_left' THEN 1 ELSE 0 END,
      expand_count = expand_count
        - CASE WHEN OLD.impression_type = 'expanded' THEN 1 ELSE 0 END
        + CASE WHEN NEW.impression_type = 'expanded' THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE id = NEW.card_pool_id;
  END IF;

  -- Recompute engagement_score from current counters
  SELECT served_count, save_count, skip_count, expand_count, visit_count
  INTO v_served, v_saves, v_skips, v_expands, v_visits
  FROM public.card_pool WHERE id = NEW.card_pool_id;

  UPDATE public.card_pool SET
    engagement_score = CASE
      WHEN v_served > 0
      THEN (v_saves * 3.0 + v_visits * 5.0 + v_expands * 1.0 - v_skips * 1.0)
           / GREATEST(v_served, 1)
      ELSE 0
    END
  WHERE id = NEW.card_pool_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'card_pool impression counter update failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_card_pool_impression_counters
  AFTER INSERT OR UPDATE OF impression_type
  ON public.user_card_impressions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_card_pool_impression_counters();


-- ═══════════════════════════════════════════════════════════════════
-- Trigger 2: place_reviews → card_pool review stats
-- Recomputes from source (idempotent) on INSERT/UPDATE/DELETE.
-- Reviews use SET NULL on user delete (PII scrubbed by edge function).
-- Star ratings survive, so review_count_local and avg_rating_local stay accurate.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_card_pool_review_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_place_pool_id UUID;
  v_avg DOUBLE PRECISION;
  v_count INTEGER;
BEGIN
  v_place_pool_id := COALESCE(NEW.place_pool_id, OLD.place_pool_id);

  IF v_place_pool_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*), AVG(rating)
  INTO v_count, v_avg
  FROM public.place_reviews
  WHERE place_pool_id = v_place_pool_id;

  UPDATE public.card_pool SET
    review_count_local = COALESCE(v_count, 0),
    avg_rating_local = v_avg,
    updated_at = now()
  WHERE place_pool_id = v_place_pool_id;

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'card_pool review stats update failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_card_pool_review_stats
  AFTER INSERT OR UPDATE OF rating OR DELETE
  ON public.place_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_card_pool_review_stats();


-- ═══════════════════════════════════════════════════════════════════
-- Trigger 3: user_visits → card_pool visit_count + engagement_score
-- INSERT only (SET NULL on delete means rows survive)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_card_pool_visit_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_served INTEGER;
  v_saves INTEGER;
  v_skips INTEGER;
  v_expands INTEGER;
  v_visits INTEGER;
BEGIN
  UPDATE public.card_pool SET
    visit_count = visit_count + 1,
    updated_at = now()
  WHERE google_place_id = NEW.experience_id;

  -- Recompute engagement_score
  SELECT served_count, save_count, skip_count, expand_count, visit_count
  INTO v_served, v_saves, v_skips, v_expands, v_visits
  FROM public.card_pool WHERE google_place_id = NEW.experience_id;

  IF v_served IS NOT NULL THEN
    UPDATE public.card_pool SET
      engagement_score = CASE
        WHEN v_served > 0
        THEN (v_saves * 3.0 + v_visits * 5.0 + v_expands * 1.0 - v_skips * 1.0)
             / GREATEST(v_served, 1)
        ELSE 0
      END
    WHERE google_place_id = NEW.experience_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'card_pool visit count update failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_card_pool_visit_count
  AFTER INSERT
  ON public.user_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_card_pool_visit_count();
