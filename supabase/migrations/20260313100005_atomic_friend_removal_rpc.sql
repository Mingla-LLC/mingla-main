-- Migration: atomic_friend_removal_rpc
-- Description: Wraps friend removal in a single transaction to prevent
-- asymmetric friendship state (Defect D10).

CREATE OR REPLACE FUNCTION public.remove_friend_atomic(p_friend_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF v_user_id = p_friend_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot unfriend yourself');
  END IF;

  -- Delete both directions atomically
  DELETE FROM public.friends
    WHERE (user_id = v_user_id AND friend_user_id = p_friend_user_id)
       OR (user_id = p_friend_user_id AND friend_user_id = v_user_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_friend_atomic(UUID) TO authenticated;
