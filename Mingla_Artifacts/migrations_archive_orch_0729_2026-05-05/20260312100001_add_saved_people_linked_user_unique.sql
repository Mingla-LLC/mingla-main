-- Migration: 20260312100001_add_saved_people_linked_user_unique.sql
-- Description: Adds a partial UNIQUE constraint on (user_id, linked_user_id) to saved_people.
-- Required for the ON CONFLICT clause in respond-link-consent edge function.
-- Without this constraint, the upsert silently fails and saved_people entries
-- are never created for linked friends.

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_people_user_linked_user_unique
  ON public.saved_people (user_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL;
