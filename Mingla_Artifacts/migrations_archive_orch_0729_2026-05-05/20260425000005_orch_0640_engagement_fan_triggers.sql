-- ORCH-0640 ch01 — Engagement fan-in triggers from place_reviews and user_visits
-- These replace the doomed trg_card_pool_review_stats + trg_card_pool_visit_count
-- triggers (dropped in ch10). Constitutional #3 compliance: EXCEPTION handler
-- RAISEs WARNING but never fails the parent INSERT.
-- DEC-039 event kinds: 'reviewed' and 'scheduled' fanned in here; 'served',
-- 'seen_deck', 'seen_expand', 'saved' fire via record_engagement RPC from mobile.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fan 1: place_reviews INSERT → engagement_metrics 'reviewed' event
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fan_review_to_engagement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
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

CREATE TRIGGER trg_fan_review_to_engagement
  AFTER INSERT ON public.place_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fan_review_to_engagement();


-- ═══════════════════════════════════════════════════════════════════════════
-- Fan 2: user_visits INSERT → engagement_metrics 'scheduled' event
-- (user_visits is currently empty — 0 rows — trigger pre-wired for future writes)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fan_visit_to_engagement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
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

CREATE TRIGGER trg_fan_visit_to_engagement
  AFTER INSERT ON public.user_visits
  FOR EACH ROW EXECUTE FUNCTION public.fan_visit_to_engagement();

COMMENT ON FUNCTION public.fan_review_to_engagement IS
  'ORCH-0640: replaces the doomed update_card_pool_review_stats. Fires on place_reviews INSERT.';
COMMENT ON FUNCTION public.fan_visit_to_engagement IS
  'ORCH-0640: replaces the doomed update_card_pool_visit_count. Fires on user_visits INSERT.
   Resolves google_place_id → place_pool_id at fire time.';

COMMIT;
