-- ============================================================
-- Add composite indexes for preference intelligence queries
-- ============================================================

-- Composite index for type+value+confidence queries (used by hero cards)
CREATE INDEX IF NOT EXISTS idx_user_pref_type_value_confidence
  ON public.user_preference_learning(user_id, preference_type, preference_value DESC, confidence);

-- Visit count index for quick visit lookups
CREATE INDEX IF NOT EXISTS idx_user_visits_count
  ON public.user_visits(user_id, experience_id);
