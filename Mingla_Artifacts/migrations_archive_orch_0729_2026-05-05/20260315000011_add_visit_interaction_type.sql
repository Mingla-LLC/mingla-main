-- ============================================================
-- Add 'visit' to user_interactions interaction_type CHECK constraint
-- ============================================================

ALTER TABLE public.user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_interaction_type_check;

ALTER TABLE public.user_interactions
  ADD CONSTRAINT user_interactions_interaction_type_check
  CHECK (interaction_type IN (
    'view', 'like', 'dislike', 'save', 'unsave', 'share', 'schedule',
    'unschedule', 'click_details', 'swipe_left', 'swipe_right', 'tap',
    'visit'
  ));
