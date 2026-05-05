-- Migration: atomic_friend_accept_rpc
-- Description: Wraps friend request acceptance in a single transaction to prevent
-- split state between friend_requests and friends tables (Defects D1, D3, D8).
-- Returns revealed collaboration invite IDs so the app can send push notifications
-- deterministically — no timing window, no race condition.

CREATE OR REPLACE FUNCTION public.accept_friend_request_atomic(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request friend_requests%ROWTYPE;
  v_result JSONB;
BEGIN
  -- 1. Fetch and validate the request (lock the row to prevent concurrent accepts)
  SELECT * INTO v_request
    FROM public.friend_requests
    WHERE id = p_request_id
    AND status = 'pending'
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Request not found or already processed'
    );
  END IF;

  -- 2. Verify the authenticated user is the receiver
  IF auth.uid() != v_request.receiver_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only the receiver can accept a friend request'
    );
  END IF;

  -- 3. Update friend_requests status (triggers credit_referral_on_friend_accepted)
  UPDATE public.friend_requests
    SET status = 'accepted', updated_at = NOW()
    WHERE id = p_request_id;

  -- 4. Create bidirectional friendship in friends table (atomic with step 3)
  INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (v_request.sender_id, v_request.receiver_id, 'accepted')
    ON CONFLICT (user_id, friend_user_id)
    DO UPDATE SET status = 'accepted', updated_at = NOW();

  INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (v_request.receiver_id, v_request.sender_id, 'accepted')
    ON CONFLICT (user_id, friend_user_id)
    DO UPDATE SET status = 'accepted', updated_at = NOW();

  -- 5. Return revealed invite IDs so the app can send push notifications deterministically
  SELECT jsonb_build_object(
    'success', true,
    'sender_id', v_request.sender_id,
    'receiver_id', v_request.receiver_id,
    'revealed_invite_ids', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'session_id', ci.session_id,
        'inviter_id', ci.inviter_id,
        'invited_user_id', ci.invited_user_id,
        'session_name', cs.name
      ))
      FROM public.collaboration_invites ci
      JOIN public.collaboration_sessions cs ON cs.id = ci.session_id
      WHERE ci.pending_friendship = false
        AND ci.status = 'pending'
        AND (
          (ci.inviter_id = v_request.sender_id AND ci.invited_user_id = v_request.receiver_id)
          OR
          (ci.inviter_id = v_request.receiver_id AND ci.invited_user_id = v_request.sender_id)
        )
      ),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
