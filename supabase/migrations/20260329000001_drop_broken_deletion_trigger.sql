-- ============================================================================
-- Drop broken handle_user_deletion_cleanup trigger and unused RPC
-- ============================================================================
-- The trigger references dropped friend_links table and linked_user_id column,
-- causing silent failure that skips 15+ cleanup operations.
-- CASCADE from auth.users and profiles handles all table cleanup (~80 tables).
-- The delete-user edge function handles the few things CASCADE can't.
-- ============================================================================

DROP TRIGGER IF EXISTS on_profile_delete_cleanup ON profiles;
DROP FUNCTION IF EXISTS public.handle_user_deletion_cleanup();
DROP FUNCTION IF EXISTS public.delete_user_profile(UUID);
