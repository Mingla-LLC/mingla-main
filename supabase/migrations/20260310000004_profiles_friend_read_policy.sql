-- Migration: 20260310000004_profiles_friend_read_policy.sql
-- Description: Allows friends to read profiles where visibility_mode is 'public' or 'friends'.
-- A "friend" is defined as an accepted row in the friends table.
-- NOTE: The friends table uses user_id/friend_user_id columns (not sender_id/receiver_id).

-- Drop the old permissive policy that grants unconditional friend read access
-- without checking visibility_mode. PostgreSQL ORs multiple SELECT policies,
-- so this old policy would bypass our new visibility-gated policies.
DROP POLICY IF EXISTS "Users can read friend profiles" ON public.profiles;

-- Policy: Anyone can read public profiles
CREATE POLICY "Anyone can read public profiles"
  ON public.profiles FOR SELECT
  USING (visibility_mode = 'public');

-- Policy: Friends can read friend-visible profiles
CREATE POLICY "Friends can read friend profiles"
  ON public.profiles FOR SELECT
  USING (
    visibility_mode IN ('public', 'friends')
    AND (
      EXISTS (
        SELECT 1 FROM public.friends
        WHERE status = 'accepted'
        AND (
          (user_id = auth.uid() AND friend_user_id = profiles.id)
          OR (friend_user_id = auth.uid() AND user_id = profiles.id)
        )
      )
    )
  );
