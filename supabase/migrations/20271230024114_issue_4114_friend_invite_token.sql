-- Issue #4114 Wave 2b — a working link in every friend invite text.
--
-- 1. pending_pair_invites gets a random, unique `token`. The invite SMS links to
--    a go.usemingla.com OneLink carrying it (deep_link_value=friend_invite,
--    deep_link_sub1=<token>), so the token survives the store install.
-- 2. claim_friend_invite(p_token) lets the person who opened that link claim
--    the invite from the account they signed up with, even when they used a
--    different phone number than the one invited (the phone-verified trigger
--    convert_pending_pair_invites_on_phone_verified only matches the number).
--    It creates the same rows that trigger creates: a friend request from the
--    inviter, and a pair request hidden until that friend request is accepted.
--
-- Safety:
--   * Idempotent: claiming again from the same account returns the same rows
--     and creates nothing new.
--   * Token reuse: an invite already converted to another account cannot be
--     claimed again (already_claimed); a cancelled invite cannot be claimed.
--   * The inviter cannot claim their own invite; a block either way refuses.
--   * SECURITY DEFINER with a pinned search_path; only `authenticated` may run it.
--   * Inviting the same number again after the invite was converted or
--     cancelled (send-pair-request upserts the row back to 'pending') issues a
--     NEW token, so an old link can never claim the revived invite.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, guarded constraint, CREATE OR REPLACE.

ALTER TABLE public.pending_pair_invites
  ADD COLUMN IF NOT EXISTS token text NOT NULL
  DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.pending_pair_invites'::regclass
       AND conname = 'pending_pair_invites_token_key'
  ) THEN
    ALTER TABLE public.pending_pair_invites
      ADD CONSTRAINT pending_pair_invites_token_key UNIQUE (token);
  END IF;
END $constraint$;

COMMENT ON COLUMN public.pending_pair_invites.token IS
  'Issue #4114: random invite token carried by the invite SMS OneLink (deep_link_sub1); claimed by claim_friend_invite.';

-- A converted or cancelled invite that is sent again gets a fresh token (the
-- old link stays dead). Covers every writer, including send-pair-request's
-- upsert on (inviter_id, phone_e164).
CREATE OR REPLACE FUNCTION public.issue_4114_reissue_friend_invite_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'pending' AND OLD.status IN ('converted', 'cancelled') THEN
    NEW.token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_reissue_friend_invite_token() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4114_reissue_friend_invite_token ON public.pending_pair_invites;
CREATE TRIGGER issue_4114_reissue_friend_invite_token
  BEFORE UPDATE OF status ON public.pending_pair_invites
  FOR EACH ROW EXECUTE FUNCTION public.issue_4114_reissue_friend_invite_token();

CREATE OR REPLACE FUNCTION public.claim_friend_invite(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_invite public.pending_pair_invites%ROWTYPE;
  v_friend_request_id uuid;
  v_friend_request_status text;
  v_pair_request_id uuid;
  v_already_friends boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32,64}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO v_invite
    FROM public.pending_pair_invites
   WHERE token = p_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  IF v_invite.inviter_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'own_invite');
  END IF;

  IF v_invite.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invite_cancelled');
  END IF;

  IF v_invite.status = 'converted'
     AND v_invite.converted_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  IF public.has_block_between(v_invite.inviter_id, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unavailable');
  END IF;

  -- Already claimed by this account (a repeat tap, or the phone-verified
  -- trigger converted it first): read back, write nothing.
  IF v_invite.status = 'converted' THEN
    SELECT id INTO v_friend_request_id
      FROM public.friend_requests
     WHERE sender_id = v_invite.inviter_id AND receiver_id = v_uid;
    SELECT id INTO v_pair_request_id
      FROM public.pair_requests
     WHERE sender_id = v_invite.inviter_id
       AND receiver_id = v_uid
       AND status IN ('pending', 'accepted')
     LIMIT 1;
    RETURN jsonb_build_object(
      'success', true,
      'inviter_id', v_invite.inviter_id,
      'friend_request_id', v_friend_request_id,
      'pair_request_id', v_pair_request_id,
      'already_claimed', true
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.friends
     WHERE status = 'accepted'
       AND deleted_at IS NULL
       AND ((user_id = v_invite.inviter_id AND friend_user_id = v_uid)
         OR (user_id = v_uid AND friend_user_id = v_invite.inviter_id))
  ) INTO v_already_friends;

  IF NOT v_already_friends THEN
    -- The friend request from the inviter (the same row the phone-verified
    -- trigger would have created).
    INSERT INTO public.friend_requests (sender_id, receiver_id, status)
    VALUES (v_invite.inviter_id, v_uid, 'pending')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING
    RETURNING id INTO v_friend_request_id;

    IF v_friend_request_id IS NULL THEN
      SELECT id, status INTO v_friend_request_id, v_friend_request_status
        FROM public.friend_requests
       WHERE sender_id = v_invite.inviter_id AND receiver_id = v_uid;
      -- Opening the invite link is a fresh yes from the invitee: an old
      -- declined request goes back to pending so it can be accepted.
      IF v_friend_request_status = 'declined' THEN
        UPDATE public.friend_requests
           SET status = 'pending', updated_at = now()
         WHERE id = v_friend_request_id;
      END IF;
    END IF;
  END IF;

  -- The pair request: hidden until the friend request is accepted, or visible
  -- straight away when the two are already friends. Never a second live one.
  SELECT id INTO v_pair_request_id
    FROM public.pair_requests
   WHERE sender_id = v_invite.inviter_id
     AND receiver_id = v_uid
     AND status IN ('pending', 'accepted')
   LIMIT 1;

  IF v_pair_request_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.pairings
     WHERE user_a_id = LEAST(v_invite.inviter_id, v_uid)
       AND user_b_id = GREATEST(v_invite.inviter_id, v_uid)
  ) THEN
    INSERT INTO public.pair_requests (
      sender_id, receiver_id, status, visibility,
      gated_by_friend_request_id, pending_display_name, pending_phone_e164
    )
    VALUES (
      v_invite.inviter_id, v_uid, 'pending',
      CASE WHEN v_already_friends THEN 'visible' ELSE 'hidden_until_friend' END,
      CASE WHEN v_already_friends THEN NULL ELSE v_friend_request_id END,
      NULL, v_invite.phone_e164
    )
    RETURNING id INTO v_pair_request_id;
  END IF;

  UPDATE public.pending_pair_invites
     SET status = 'converted', converted_user_id = v_uid, converted_at = now()
   WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'inviter_id', v_invite.inviter_id,
    'friend_request_id', v_friend_request_id,
    'pair_request_id', v_pair_request_id,
    'already_friends', v_already_friends,
    'already_claimed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_friend_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_friend_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_friend_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_friend_invite(text) TO service_role;

COMMENT ON FUNCTION public.claim_friend_invite(text) IS
  'Issue #4114: the signed-in invitee claims a text invite by its OneLink token. Idempotent; refuses reuse by another account.';
