-- ORCH-0444: Add 'expand' to the user_interactions interaction_type check constraint.
-- cardEngagementService.ts:51 sends 'expand' when a user taps to expand a card,
-- but the DB constraint did not include it, causing silent recording failures.

ALTER TABLE public.user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_interaction_type_check;

ALTER TABLE public.user_interactions
  ADD CONSTRAINT user_interactions_interaction_type_check
  CHECK (interaction_type IN (
    'view', 'like', 'dislike', 'save', 'unsave', 'share', 'schedule',
    'unschedule', 'click_details', 'swipe_left', 'swipe_right', 'tap',
    'visit', 'expand'
  ));
