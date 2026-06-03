-- ============================================================================
-- ORCH-1058B — rpc_post_collab_dead_end_banner (SECURITY DEFINER)
-- ============================================================================
--
-- Posts a collab "dead-end" / "notify the group" banner into the session's
-- group chat as a TRUE SYSTEM ROW:
--
--   - sender_id   = NULL           (intrinsic system marker)
--   - message_type = 'system'      (intrinsic system marker)
--   - content     = the token-STRIPPED degrade prose (readable on any build /
--                   in notification previews — never raw `[[…]]` tokens)
--   - card_payload = the structured `collab_dead_end` JSON payload that the
--                   RN renderer uses to draw participant·City/ST chips + a real
--                   tappable prefs button FROM DATA (not parsed prose).
--
-- WHY A SECURITY DEFINER RPC (not a direct client INSERT):
-- --------------------------------------------------------
-- All three `public.messages` INSERT RLS policies require sender_id = auth.uid()
-- or a participant check; a null-sender row is rejected by every WITH CHECK. A
-- system row therefore MUST be written by a SECURITY DEFINER owner that
-- re-implements the participant authorization the RLS would otherwise enforce.
-- This mirrors the established ORCH-0908 precedent
-- (rpc_admin_lock_and_schedule_card, migration 20260629000000) which already
-- writes chat messages server-side, and ORCH-0898/0899 which already ship
-- sender_id=NULL system rows. The client gate at messagingService.ts:1433
-- short-circuits isSystem=true for ANY null-sender row regardless of app
-- version — so this row renders as a system banner on every build, today's
-- shipped main included (the cross-build robustness property ORCH-1058B exists
-- to guarantee).
--
-- SCOPE / SAFETY:
-- ---------------
--   - Additive: CREATE OR REPLACE FUNCTION + GRANT only.
--   - No schema column add (reuses existing `card_payload jsonb`).
--   - No RLS policy change (the null-sender INSERT never goes through the
--     table-level INSERT RLS — it runs as the function owner; READ RLS is
--     unchanged and already lets every participant SELECT the row).
--   - No CHECK-constraint change (`messages.message_type` has no CHECK; 'system'
--     is already used by other producers).
--   - Idempotent (CREATE OR REPLACE). Reversible (DROP FUNCTION).
--   - Zero data mutation, no lock on `messages`.
--
-- ROLLBACK: single `git revert` of the PR → DROP FUNCTION restores prior state.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_post_collab_dead_end_banner(
  p_session_id uuid,
  p_reason text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
  v_prose text;
  v_message_id uuid;
BEGIN
  -- 1. Auth required.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- 2. Resolve the group conversation for this session (same lookup the
  --    service's getOrCreateGroupConversationForSession uses).
  SELECT id INTO v_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  -- 3. Authorization — replaces the WITH CHECK the null-sender INSERT bypasses.
  --    Only an actual participant of THIS conversation may post the banner,
  --    exactly as the regular INSERT RLS would enforce.
  IF NOT EXISTS (
    SELECT 1
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = v_conversation_id
       AND cp.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  -- 4. Validate the reason against the known set (server is the trust boundary
  --    for a SECURITY DEFINER insert).
  IF p_reason NOT IN (
    'intersection_empty',
    'no_matching_candidates',
    'no_unswiped_candidates',
    'quorum_not_met',
    'all_pools_exhausted'
  ) THEN
    RAISE EXCEPTION 'unknown reason: %', p_reason;
  END IF;

  -- 5. Validate the payload shape (kind + non-empty participants array).
  IF p_payload IS NULL
     OR p_payload->>'kind' IS DISTINCT FROM 'collab_dead_end'
     OR jsonb_typeof(p_payload->'participants') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'participants') < 1 THEN
    RAISE EXCEPTION 'invalid payload';
  END IF;

  -- 6. The degrade prose lives in `content` (NOT NULL column) so old builds and
  --    notification previews show readable text; the structured object lives in
  --    `card_payload`. Default to empty string if the caller omitted prose
  --    (content is NOT NULL).
  v_prose := COALESCE(p_payload->>'prose', '');

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    content,
    message_type,
    card_payload
  ) VALUES (
    v_conversation_id,
    NULL,
    v_prose,
    'system',
    p_payload
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

COMMENT ON FUNCTION public.rpc_post_collab_dead_end_banner(uuid, text, jsonb) IS
  'ORCH-1058B: posts a collab dead-end / notify-the-group banner into the session group chat as a TRUE SYSTEM ROW (sender_id=NULL, message_type=''system''). SECURITY DEFINER because all messages INSERT RLS policies reject a null-sender row; the function re-implements the participant authorization (caller must be a conversation_participant of the session conversation) the RLS would otherwise enforce, exactly like ORCH-0908 rpc_admin_lock_and_schedule_card. content carries the TOKEN-STRIPPED degrade prose (readable on any build / notification preview — never raw [[…]] tokens); card_payload carries the structured collab_dead_end object the RN renderer uses to draw participant City/ST chips + a tappable prefs button FROM DATA. The deliberate sender_id=NULL is rendered as a system banner by the client gate at messagingService.ts (isSystem short-circuit) regardless of app version — the cross-build robustness property.';

REVOKE ALL ON FUNCTION public.rpc_post_collab_dead_end_banner(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_post_collab_dead_end_banner(uuid, text, jsonb) TO authenticated;
