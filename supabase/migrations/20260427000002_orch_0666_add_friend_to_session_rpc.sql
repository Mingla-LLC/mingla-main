-- ORCH-0666: Atomic add-friend-to-existing-session RPC.
-- Replaces the fake handlers at FriendsManagementList "Add to session" + DM-path
-- "Add to board" with a real, atomic, server-authoritative pipeline.
--
-- Contract:
--   - Caller MUST be authenticated (auth.uid() must be set).
--   - Caller MUST be a session participant — refused if not, regardless of `inviter_id`.
--   - Refuses if `has_block_between(caller, friend)` is true (HF-4 close).
--   - Refuses if session is not in status ('pending', 'active').
--   - Idempotent: returns 'already_invited' / 'already_member' for repeat invocations.
--   - Atomic: both `session_participants` and `collaboration_invites` rows insert in
--     one transaction. RPC is naturally transactional in Postgres; if the second
--     INSERT fails, the first is rolled back.
--
-- Returns JSON shape:
--   { outcome: 'invited' | 'already_invited' | 'already_member'
--           | 'blocked' | 'session_invalid' | 'not_session_member'
--           | 'session_creator_self_invite',
--     invite_id?: uuid,
--     created_at?: timestamptz,
--     error_code?: text }

CREATE OR REPLACE FUNCTION public.add_friend_to_session(
  p_session_id  uuid,
  p_friend_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid := auth.uid();
  v_session_status text;
  v_existing_participant record;
  v_existing_invite record;
  v_new_invite_id uuid;
  v_new_invite_created_at timestamptz;
BEGIN
  -- Guard 1: authenticated
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'unauthenticated');
  END IF;

  -- Guard 2: self-invite refused
  IF v_caller_id = p_friend_user_id THEN
    RETURN jsonb_build_object('outcome', 'session_creator_self_invite', 'error_code', 'self_invite');
  END IF;

  -- Guard 3: caller must be a session member (or creator — covered by participant table since creators are always rows in session_participants per current code paths)
  IF NOT public.is_session_participant(p_session_id, v_caller_id)
     AND NOT public.is_session_creator(p_session_id, v_caller_id) THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'caller_not_in_session');
  END IF;

  -- Guard 4: session must exist + be in invitable state
  SELECT status INTO v_session_status
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'session_not_found');
  END IF;

  IF v_session_status NOT IN ('pending', 'active') THEN
    RETURN jsonb_build_object(
      'outcome', 'session_invalid',
      'error_code', 'session_status_' || v_session_status
    );
  END IF;

  -- Guard 5: bidirectional block-check (HF-4 close)
  IF public.has_block_between(v_caller_id, p_friend_user_id) THEN
    RETURN jsonb_build_object('outcome', 'blocked', 'error_code', 'block_between_users');
  END IF;

  -- Idempotency: already-accepted member
  SELECT user_id, has_accepted INTO v_existing_participant
    FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_friend_user_id;

  IF FOUND AND v_existing_participant.has_accepted = TRUE THEN
    RETURN jsonb_build_object('outcome', 'already_member', 'error_code', 'friend_already_accepted');
  END IF;

  -- Idempotency: already-pending invite
  SELECT id, created_at, status INTO v_existing_invite
    FROM public.collaboration_invites
    WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

  IF FOUND AND v_existing_invite.status = 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  -- Re-pending after decline/cancel: UPDATE existing row to status='pending' (per investigation §14 Q2 + spec §0 lock)
  IF FOUND AND v_existing_invite.status IN ('declined', 'cancelled') THEN
    UPDATE public.collaboration_invites
      SET status = 'pending',
          updated_at = NOW(),
          inviter_id = v_caller_id  -- re-attribute to current adder
      WHERE id = v_existing_invite.id
      RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

    -- Also ensure session_participants row is present with has_accepted=false
    INSERT INTO public.session_participants (session_id, user_id, has_accepted)
    VALUES (p_session_id, p_friend_user_id, FALSE)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET has_accepted = FALSE
      WHERE session_participants.has_accepted = FALSE;  -- never demote an accepted row

    RETURN jsonb_build_object(
      'outcome', 'invited',
      'invite_id', v_new_invite_id,
      'created_at', v_new_invite_created_at
    );
  END IF;

  -- Happy path: insert participant + invite atomically (RPC is transactional)
  INSERT INTO public.session_participants (session_id, user_id, has_accepted)
  VALUES (p_session_id, p_friend_user_id, FALSE)
  ON CONFLICT (session_id, user_id) DO NOTHING;

  INSERT INTO public.collaboration_invites (
    session_id, inviter_id, invited_user_id, status, invite_method
  )
  VALUES (
    p_session_id, v_caller_id, p_friend_user_id, 'pending', 'friends_list'
  )
  ON CONFLICT (session_id, invited_user_id) DO NOTHING
  RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

  -- If RETURNING is null, ON CONFLICT fired — extreme race; treat as already_invited
  IF v_new_invite_id IS NULL THEN
    SELECT id, created_at INTO v_existing_invite
      FROM public.collaboration_invites
      WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'invited',
    'invite_id', v_new_invite_id,
    'created_at', v_new_invite_created_at
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Last-resort safety net. Never leak stack traces. Log server-side.
    RAISE WARNING 'add_friend_to_session error for session=% friend=%: %', p_session_id, p_friend_user_id, SQLERRM;
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'rpc_internal_error');
END;
$$;

-- GRANT to authenticated role only — service_role does not need this; admin paths
-- should use direct table writes per existing conventions.
REVOKE ALL ON FUNCTION public.add_friend_to_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_friend_to_session(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.add_friend_to_session(uuid, uuid) IS
'ORCH-0666: Atomic add-friend-to-existing-session pipeline. SECURITY DEFINER. Caller (auth.uid()) must be a session participant. Returns jsonb {outcome, invite_id?, created_at?, error_code?}. Idempotent. Bidirectional block-check enforced.';
