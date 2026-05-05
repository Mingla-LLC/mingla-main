-- Migration: 20260310000016_backfill_link_consent_for_existing.sql
-- Description: Backfill link_status='consented' for all existing accepted friend_links
-- that already have linked saved_people entries (requester_person_id and target_person_id set).
-- Without this, get-personalized-cards will reject requests for pre-existing linked friends.

UPDATE public.friend_links
SET
  link_status = 'consented',
  requester_link_consent = TRUE,
  target_link_consent = TRUE,
  linked_at = COALESCE(accepted_at, created_at)
WHERE status = 'accepted'
  AND requester_person_id IS NOT NULL
  AND target_person_id IS NOT NULL
  AND link_status = 'none';
