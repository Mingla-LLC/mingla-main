-- Migration: extend_friend_accept_rpc_with_pair_requests
-- Description: Extends accept_friend_request_atomic to also return pair request IDs
-- that were revealed when the friend request was accepted. This enables the client
-- to send push notifications for newly visible pair requests.
-- The reveal_pair_requests_on_friend_accept trigger fires on the UPDATE in step 3,
-- setting pair_requests.visibility = 'visible'. Since triggers execute within the
-- same transaction, the revealed rows are visible to the query in step 5.

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

  -- 3. Update friend_requests status
  --    This fires two triggers:
  --      a) credit_referral_on_friend_accepted (referrals + collab invite reveal)
  --      b) reveal_pair_requests_on_friend_accept (pair_request visibility)
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

  -- 5. Build result with revealed collaboration invites AND revealed pair requests
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
    ),
    'revealed_pair_request_ids', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'sender_id', pr.sender_id,
        'receiver_id', pr.receiver_id
      ))
      FROM public.pair_requests pr
      WHERE pr.gated_by_friend_request_id = p_request_id
        AND pr.visibility = 'visible'
        AND pr.status = 'pending'
      ),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
