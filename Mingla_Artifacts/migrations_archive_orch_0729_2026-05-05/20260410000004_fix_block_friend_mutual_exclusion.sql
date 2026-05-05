-- ORCH-0367: Fix block/friend mutual exclusion
--
-- Problem: accept_friend_request_atomic creates friendships without checking or
-- clearing blocked_users. The on_user_blocked trigger deletes friendships but
-- leaves pending friend_requests intact. This allows a stale block record to
-- coexist with an active friendship, silently breaking messaging.
--
-- Fix (3 parts):
--   1. accept_friend_request_atomic: clear blocked_users on friend acceptance
--   2. handle_user_blocked trigger: cancel pending friend_requests on block
--   3. Data fix: clear stale block for affected user pair
--
-- Invariant enforced: INV-BLOCK-001 — blocked_users and friends(status=accepted)
-- are mutually exclusive for any user pair.

-- ============================================================================
-- 1. Rebuild accept_friend_request_atomic with block cleanup
-- ============================================================================

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

  -- 4b. Clear any stale block records between these users (INV-BLOCK-001)
  -- Accepting a friend request is an implicit unblock in both directions.
  -- Without this, has_block_between() returns true and messaging is broken
  -- even though the users are friends.
  DELETE FROM public.blocked_users
  WHERE (blocker_id = v_request.sender_id AND blocked_id = v_request.receiver_id)
     OR (blocker_id = v_request.receiver_id AND blocked_id = v_request.sender_id);

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

-- ============================================================================
-- 2. Rebuild handle_user_blocked trigger to also cancel pending friend_requests
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_user_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Remove friendship in both directions when blocked
  DELETE FROM friends
  WHERE (user_id = NEW.blocker_id AND friend_user_id = NEW.blocked_id)
     OR (user_id = NEW.blocked_id AND friend_user_id = NEW.blocker_id);

  -- Cancel any pending friend requests between the two users (ORCH-0367)
  -- Without this, a pending request survives the block and can be accepted later,
  -- re-creating the friendship while the block record remains.
  UPDATE public.friend_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE status = 'pending'
    AND ((sender_id = NEW.blocker_id AND receiver_id = NEW.blocked_id)
      OR (sender_id = NEW.blocked_id AND receiver_id = NEW.blocker_id));

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. Data fix: clear the stale block record between Seth and Arifat
-- ============================================================================

DELETE FROM public.blocked_users
WHERE blocker_id = '24f48f75-ed2b-4a74-b1ef-84c16fa3c764'
  AND blocked_id = '07abe817-e4a8-4321-8462-6bea86108ac4';
