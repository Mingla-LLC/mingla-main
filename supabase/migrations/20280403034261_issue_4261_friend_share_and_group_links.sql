-- Issue #4261 Wave A1 — your invite link connects you; groups can grow.
--
-- 1. friend_share_links: one personal, reusable invite link per person. A
--    friend who opens it becomes your friend straight away (through the one
--    owner of reciprocal friendship, accept_friend_request_atomic), a brand-new
--    account counts toward your referral reward, and a blocked pair is never
--    connected. friend_share_claims records who joined through whose link.
-- 2. group_invite_links + group_join_requests: a shareable link per user group
--    (collab-session group chats and plain user groups), optional "Approve new
--    joiners", reset, and an "add people" RPC for plain groups.
-- 3. conversation_participants.history_visible_from: a person who joins a user
--    group after it has messages sees messages from the moment they joined.
--    Every existing member keeps NULL (sees everything) — no history loss.
-- 4. friend_requests.source gains 'share_link'.
--
-- All writes go through SECURITY DEFINER RPCs; the new tables carry SELECT
-- policies only. Application conflicts raise PT409, never 40001. Static SQL
-- only. Idempotent: safe to apply twice.

BEGIN;

-- ── friend_requests.source ──────────────────────────────────────────────────
ALTER TABLE public.friend_requests DROP CONSTRAINT IF EXISTS friend_requests_source_check;
ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_source_check
  CHECK (source = ANY (ARRAY['app'::text, 'map'::text, 'onboarding'::text, 'session'::text, 'share_link'::text]));

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friend_share_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CONSTRAINT friend_share_links_token_shape CHECK (token ~ '^[0-9a-f]{32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.friend_share_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outcome text NOT NULL CONSTRAINT friend_share_claims_outcome_check CHECK (outcome IN ('connected', 'already_friends')),
  referral_credit_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_share_claims_not_self CHECK (owner_id <> claimant_id),
  CONSTRAINT friend_share_claims_owner_claimant_key UNIQUE (owner_id, claimant_id)
);
CREATE INDEX IF NOT EXISTS friend_share_claims_owner_created_idx
  ON public.friend_share_claims (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.group_invite_links (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CONSTRAINT group_invite_links_token_shape CHECK (token ~ '^[0-9a-f]{32}$'),
  require_approval boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL,
  rotated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sharer_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT group_join_requests_status_check CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz NULL,
  message_id uuid NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_join_requests_decided_shape CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_one_pending
  ON public.group_join_requests (conversation_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS group_join_requests_conversation_created_idx
  ON public.group_join_requests (conversation_id, created_at DESC);
ALTER TABLE public.group_join_requests REPLICA IDENTITY FULL;

-- ── RLS + grants (default privileges hand anon/authenticated ALL; take it back)
ALTER TABLE public.friend_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_share_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.friend_share_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.friend_share_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.group_invite_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.group_join_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.friend_share_links TO authenticated;
GRANT SELECT ON public.friend_share_claims TO authenticated;
GRANT SELECT ON public.group_invite_links TO authenticated;
GRANT SELECT ON public.group_join_requests TO authenticated;
GRANT ALL ON public.friend_share_links TO service_role;
GRANT ALL ON public.friend_share_claims TO service_role;
GRANT ALL ON public.group_invite_links TO service_role;
GRANT ALL ON public.group_join_requests TO service_role;

DROP POLICY IF EXISTS friend_share_links_owner_read ON public.friend_share_links;
CREATE POLICY friend_share_links_owner_read ON public.friend_share_links
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS friend_share_claims_party_read ON public.friend_share_claims;
CREATE POLICY friend_share_claims_party_read ON public.friend_share_claims
  FOR SELECT TO authenticated USING (owner_id = auth.uid() OR claimant_id = auth.uid());

DROP POLICY IF EXISTS group_invite_links_member_read ON public.group_invite_links;
CREATE POLICY group_invite_links_member_read ON public.group_invite_links
  FOR SELECT TO authenticated USING (public.is_conversation_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS group_join_requests_member_or_self_read ON public.group_join_requests;
CREATE POLICY group_join_requests_member_or_self_read ON public.group_join_requests
  FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id, auth.uid()) OR user_id = auth.uid());

DO $realtime$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_join_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_join_requests;
  END IF;
END;
$realtime$;

-- ── History from join ───────────────────────────────────────────────────────
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS history_visible_from timestamptz NULL;

-- The one owner of history_visible_from. On INSERT it is decided here (any
-- client value is ignored); on UPDATE it can never change.
CREATE OR REPLACE FUNCTION public.tg_4261_set_history_visible_from()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.history_visible_from := OLD.history_visible_from;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = NEW.conversation_id
       AND c.type = 'group'
       AND c.linked_entity_type IN ('session', 'direct')
       AND c.program_kind IS NULL
       AND c.brand_id IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.messages m WHERE m.conversation_id = NEW.conversation_id
  ) THEN
    NEW.history_visible_from := now();
  ELSE
    NEW.history_visible_from := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_set_history_visible_from() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_set_history_visible_from ON public.conversation_participants;
CREATE TRIGGER tg_4261_set_history_visible_from
  BEFORE INSERT OR UPDATE OF history_visible_from ON public.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_set_history_visible_from();

DROP POLICY IF EXISTS messages_history_visible_from ON public.messages;
CREATE POLICY messages_history_visible_from ON public.messages
  AS RESTRICTIVE FOR SELECT
  USING (NOT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
     WHERE cp.conversation_id = messages.conversation_id
       AND cp.user_id = auth.uid()
       AND cp.history_visible_from IS NOT NULL
       AND messages.created_at < cp.history_visible_from
  ));

-- ── Internal helpers (service_role only) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_plan_chat_kind(p_conversation_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN c.type = 'direct' AND c.linked_entity_type = 'direct' THEN 'direct'
    WHEN c.type = 'group' AND c.linked_entity_type = 'session' THEN 'session'
    WHEN c.type = 'group' AND c.linked_entity_type = 'direct'
         AND c.program_kind IS NULL AND c.brand_id IS NULL THEN 'plain'
    ELSE NULL
  END
  FROM public.conversations c
  WHERE c.id = p_conversation_id;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_chat_kind(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_chat_kind(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_member_blocked(p_conversation_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
     WHERE cp.conversation_id = p_conversation_id
       AND cp.user_id <> p_user
       AND public.has_block_between(cp.user_id, p_user)
  );
$function$;
REVOKE ALL ON FUNCTION public.chat_member_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_member_blocked(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_group_is_admin(p_conversation_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT CASE public.chat_plan_chat_kind(c.id)
      WHEN 'session' THEN EXISTS (
        SELECT 1 FROM public.collaboration_sessions cs
         WHERE cs.id = c.session_id
           AND (cs.created_by = p_user OR EXISTS (
             SELECT 1 FROM public.session_participants sp
              WHERE sp.session_id = cs.id AND sp.user_id = p_user AND sp.is_admin IS TRUE
           ))
      )
      WHEN 'plain' THEN c.created_by IS NOT DISTINCT FROM p_user AND p_user IS NOT NULL
      ELSE false
    END
    FROM public.conversations c
    WHERE c.id = p_conversation_id
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.chat_group_is_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_is_admin(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_group_post_event(
  p_conversation_id uuid, p_event text, p_extra jsonb, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload)
  VALUES (
    p_conversation_id, NULL, p_content, 'system',
    jsonb_build_object('kind', 'group_event', 'event', p_event) || COALESCE(p_extra, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_group_post_event(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_post_event(uuid, text, jsonb, text) TO service_role;

-- ── Personal invite link ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_friend_share_link()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.friend_share_links (user_id, token)
  VALUES (v_uid, encode(extensions.gen_random_bytes(16), 'hex'))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT token INTO v_token FROM public.friend_share_links WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'token', v_token,
    'referralCode', (SELECT p.referral_code FROM public.profiles p WHERE p.id = v_uid),
    'joinedCount', (
      SELECT count(*) FROM public.friend_share_claims
       WHERE owner_id = v_uid AND outcome = 'connected'
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_or_create_friend_share_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_friend_share_link() TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_friend_share_link()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_token text := encode(extensions.gen_random_bytes(16), 'hex');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.friend_share_links (user_id, token, rotated_at)
  VALUES (v_uid, v_token, now())
  ON CONFLICT (user_id) DO UPDATE
    SET token = EXCLUDED.token, rotated_at = now();

  RETURN jsonb_build_object('token', v_token);
END;
$function$;
REVOKE ALL ON FUNCTION public.reset_friend_share_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_friend_share_link() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_friend_share_link(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_claim public.friend_share_claims%ROWTYPE;
  v_request_id uuid;
  v_request_status text;
  v_credit_created boolean := false;
  v_credit_id uuid;
  v_accept jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- 1. Token.
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;
  SELECT user_id INTO v_owner
    FROM public.friend_share_links
   WHERE token = p_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  -- 2. Own link.
  IF v_owner = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'own_link');
  END IF;

  -- 3. A block between the pair: write nothing, never reach the accept path
  --    (accept_friend_request_atomic deletes blocks).
  IF public.has_block_between(v_owner, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unavailable');
  END IF;

  -- 4. Already claimed: read back, write nothing.
  SELECT * INTO v_claim
    FROM public.friend_share_claims
   WHERE owner_id = v_owner AND claimant_id = v_uid;
  IF FOUND THEN
    SELECT id INTO v_request_id
      FROM public.friend_requests
     WHERE sender_id = v_owner AND receiver_id = v_uid;
    RETURN jsonb_build_object(
      'success', true, 'ownerId', v_owner, 'outcome', v_claim.outcome,
      'alreadyClaimed', true, 'friendRequestId', v_request_id
    );
  END IF;

  -- 5. Already friends.
  IF EXISTS (
    SELECT 1 FROM public.friends
     WHERE user_id = v_owner AND friend_user_id = v_uid AND status = 'accepted' AND deleted_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.friends
     WHERE user_id = v_uid AND friend_user_id = v_owner AND status = 'accepted' AND deleted_at IS NULL
  ) THEN
    INSERT INTO public.friend_share_claims (owner_id, claimant_id, outcome)
    VALUES (v_owner, v_uid, 'already_friends');
    RETURN jsonb_build_object(
      'success', true, 'ownerId', v_owner, 'outcome', 'already_friends',
      'alreadyClaimed', false, 'friendRequestId', NULL
    );
  END IF;

  -- 6. Referral credit: a new account (14 days) that was never referred.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = v_uid AND p.created_at >= now() - interval '14 days'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.referral_credits rc WHERE rc.referred_id = v_uid
  ) THEN
    INSERT INTO public.referral_credits (referrer_id, referred_id, status)
    VALUES (v_owner, v_uid, 'pending')
    ON CONFLICT (referrer_id, referred_id) DO NOTHING
    RETURNING id INTO v_credit_id;
    v_credit_created := v_credit_id IS NOT NULL;
  END IF;

  -- 7. The friend request owner -> claimant.
  INSERT INTO public.friend_requests (sender_id, receiver_id, status, source)
  VALUES (v_owner, v_uid, 'pending', 'share_link')
  ON CONFLICT (sender_id, receiver_id) DO NOTHING
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    SELECT id, status INTO v_request_id, v_request_status
      FROM public.friend_requests
     WHERE sender_id = v_owner AND receiver_id = v_uid
     FOR UPDATE;
    -- Opening the link is a fresh yes. A declined request goes back to
    -- pending; an accepted one whose friendship was since removed (step 5
    -- found no friendship) is re-opened so the accept below restores it.
    IF v_request_status IN ('declined', 'accepted') THEN
      UPDATE public.friend_requests
         SET status = 'pending', updated_at = now()
       WHERE id = v_request_id;
    END IF;
  END IF;

  -- 8. Reciprocity has one owner. auth.uid() is the claimant = the receiver.
  v_accept := public.accept_friend_request_atomic(v_request_id);
  IF COALESCE((v_accept ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'conflict_friend_accept' USING ERRCODE = 'PT409';
  END IF;

  -- 9. A pending request the other way is settled too.
  UPDATE public.friend_requests
     SET status = 'accepted', updated_at = now()
   WHERE sender_id = v_uid AND receiver_id = v_owner AND status = 'pending';

  -- 10. Record the claim.
  INSERT INTO public.friend_share_claims (owner_id, claimant_id, outcome, referral_credit_created)
  VALUES (v_owner, v_uid, 'connected', v_credit_created);

  RETURN jsonb_build_object(
    'success', true, 'ownerId', v_owner, 'outcome', 'connected',
    'alreadyClaimed', false, 'friendRequestId', v_request_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_friend_share_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_friend_share_link(text) TO authenticated;

-- ── Group link ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_group_link(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.group_invite_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'session'
     AND public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'plain' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.group_invite_links (conversation_id, token, created_by)
  VALUES (p_conversation_id, encode(extensions.gen_random_bytes(16), 'hex'), v_uid)
  ON CONFLICT (conversation_id) DO NOTHING;

  SELECT * INTO v_link FROM public.group_invite_links WHERE conversation_id = p_conversation_id;

  RETURN jsonb_build_object(
    'token', v_link.token,
    'requireApproval', v_link.require_approval,
    'canManage', public.chat_group_is_admin(p_conversation_id, v_uid),
    'memberCount', (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = p_conversation_id)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_or_create_group_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_group_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_group_link(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_token text := encode(extensions.gen_random_bytes(16), 'hex');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'session'
     AND public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'plain' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_uid)
     OR NOT public.chat_group_is_admin(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.group_invite_links (conversation_id, token, created_by, rotated_at, rotated_by)
  VALUES (p_conversation_id, v_token, v_uid, now(), v_uid)
  ON CONFLICT (conversation_id) DO UPDATE
    SET token = EXCLUDED.token, rotated_at = now(), rotated_by = v_uid;

  RETURN jsonb_build_object('token', v_token);
END;
$function$;
REVOKE ALL ON FUNCTION public.reset_group_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_group_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_group_link_approval(p_conversation_id uuid, p_require boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_require IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_require';
  END IF;
  IF public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'session'
     AND public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'plain' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_uid)
     OR NOT public.chat_group_is_admin(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.group_invite_links (conversation_id, token, require_approval, created_by)
  VALUES (p_conversation_id, encode(extensions.gen_random_bytes(16), 'hex'), p_require, v_uid)
  ON CONFLICT (conversation_id) DO UPDATE SET require_approval = EXCLUDED.require_approval;

  RETURN jsonb_build_object('requireApproval', p_require);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_group_link_approval(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_link_approval(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.group_link_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.group_invite_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_link FROM public.group_invite_links WHERE token = p_token;
  IF NOT FOUND OR COALESCE(public.chat_plan_chat_kind(v_link.conversation_id), '') NOT IN ('session', 'plain') THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'conversationId', v_link.conversation_id,
    'name', (SELECT c.name FROM public.conversations c WHERE c.id = v_link.conversation_id),
    'memberCount', (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_link.conversation_id),
    'requireApproval', v_link.require_approval,
    'isMember', public.is_conversation_participant(v_link.conversation_id, v_uid)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.group_link_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_link_preview(text) TO authenticated;

-- Internal: let a person into a user group. Plain group: straight in. Session
-- group: a pending link invite they accept through the existing collab flow.
CREATE OR REPLACE FUNCTION public.chat_group_admit(p_conversation_id uuid, p_user uuid, p_inviter uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text := public.chat_plan_chat_kind(p_conversation_id);
  v_session_id uuid;
  v_inviter uuid;
  v_invite_id uuid;
  v_inserted uuid;
BEGIN
  IF v_kind = 'plain' THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (p_conversation_id, p_user)
    ON CONFLICT (conversation_id, user_id) DO NOTHING
    RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN
      PERFORM public.chat_group_post_event(
        p_conversation_id, 'joined_by_link',
        jsonb_build_object('userId', p_user, 'sharerId', p_inviter),
        public.issue_4114_first_name(p_user) || ' joined with the group link'
      );
    END IF;
    RETURN jsonb_build_object('status', 'joined', 'conversationId', p_conversation_id);
  END IF;

  IF v_kind = 'session' THEN
    SELECT c.session_id, COALESCE(p_inviter, cs.created_by)
      INTO v_session_id, v_inviter
      FROM public.conversations c
      JOIN public.collaboration_sessions cs ON cs.id = c.session_id
     WHERE c.id = p_conversation_id;
    IF v_session_id IS NULL OR v_inviter IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status, invite_method, pending_friendship
    ) VALUES (v_session_id, v_inviter, p_user, 'pending', 'link', false)
    ON CONFLICT (session_id, invited_user_id) DO UPDATE
      SET status = 'pending', inviter_id = EXCLUDED.inviter_id, invite_method = 'link',
          pending_friendship = false, updated_at = now()
      WHERE public.collaboration_invites.status <> 'pending'
    RETURNING id INTO v_invite_id;
    IF v_invite_id IS NULL THEN
      SELECT id INTO v_invite_id FROM public.collaboration_invites
       WHERE session_id = v_session_id AND invited_user_id = p_user;
    END IF;
    RETURN jsonb_build_object(
      'status', 'invited', 'conversationId', p_conversation_id,
      'sessionId', v_session_id, 'inviteId', v_invite_id
    );
  END IF;

  RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_group_admit(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_admit(uuid, uuid, uuid) TO service_role;

-- Internal: true when a session group already holds max_participants.
CREATE OR REPLACE FUNCTION public.chat_group_is_full(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT (SELECT count(*) FROM public.session_participants sp
             WHERE sp.session_id = cs.id AND sp.has_accepted IS TRUE)
           >= COALESCE(cs.max_participants, 15)
      FROM public.conversations c
      JOIN public.collaboration_sessions cs ON cs.id = c.session_id
     WHERE c.id = p_conversation_id AND c.linked_entity_type = 'session'
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.chat_group_is_full(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_is_full(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.join_group_by_link(p_token text, p_share_token text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.group_invite_links%ROWTYPE;
  v_sharer uuid;
  v_request public.group_join_requests%ROWTYPE;
  v_request_id uuid;
  v_message_id uuid;
  v_admit jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- 1. The link.
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_link FROM public.group_invite_links WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(public.chat_plan_chat_kind(v_link.conversation_id), '') NOT IN ('session', 'plain') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  -- 2. Already in.
  IF public.is_conversation_participant(v_link.conversation_id, v_uid) THEN
    RETURN jsonb_build_object('status', 'already_member', 'conversationId', v_link.conversation_id);
  END IF;

  -- 3. A block with any member: write nothing.
  IF public.chat_member_blocked(v_link.conversation_id, v_uid) THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
  END IF;

  -- 4. Capacity (session groups).
  IF public.chat_group_is_full(v_link.conversation_id) THEN
    RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
  END IF;

  -- 5. Whose share token rode the link (only when they are a member).
  IF p_share_token IS NOT NULL AND p_share_token ~ '^[0-9a-f]{32}$' THEN
    SELECT fsl.user_id INTO v_sharer
      FROM public.friend_share_links fsl
     WHERE fsl.token = p_share_token
       AND public.is_conversation_participant(v_link.conversation_id, fsl.user_id);
  END IF;

  -- 6. Approval on: one pending request.
  IF v_link.require_approval THEN
    SELECT * INTO v_request FROM public.group_join_requests
     WHERE conversation_id = v_link.conversation_id AND user_id = v_uid AND status = 'pending';
    IF FOUND THEN
      RETURN jsonb_build_object(
        'status', 'requested', 'conversationId', v_link.conversation_id, 'requestId', v_request.id
      );
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.group_join_requests
       WHERE conversation_id = v_link.conversation_id AND user_id = v_uid
         AND status = 'declined' AND decided_at > now() - interval '24 hours'
    ) THEN
      RETURN jsonb_build_object('status', 'requested', 'conversationId', v_link.conversation_id);
    END IF;

    INSERT INTO public.group_join_requests (conversation_id, user_id, sharer_id)
    VALUES (v_link.conversation_id, v_uid, v_sharer)
    RETURNING id INTO v_request_id;

    v_message_id := public.chat_group_post_event(
      v_link.conversation_id, 'join_request',
      jsonb_build_object('requestId', v_request_id, 'userId', v_uid, 'sharerId', v_sharer),
      public.issue_4114_first_name(v_uid) || ' wants to join'
    );
    UPDATE public.group_join_requests SET message_id = v_message_id WHERE id = v_request_id;

    RETURN jsonb_build_object(
      'status', 'requested', 'conversationId', v_link.conversation_id, 'requestId', v_request_id
    );
  END IF;

  -- 7. Approval off: straight in.
  v_admit := public.chat_group_admit(v_link.conversation_id, v_uid, COALESCE(v_sharer, v_link.created_by));
  RETURN v_admit;
END;
$function$;
REVOKE ALL ON FUNCTION public.join_group_by_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_link(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_group_join_request(p_request_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_request public.group_join_requests%ROWTYPE;
  v_admit jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_approve';
  END IF;

  SELECT * INTO v_request FROM public.group_join_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_conversation_participant(v_request.conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'pending' THEN
    IF (v_request.status = 'approved') = p_approve THEN
      RETURN jsonb_build_object('status', v_request.status, 'requestId', v_request.id);
    END IF;
    RAISE EXCEPTION 'conflict_already_decided' USING ERRCODE = 'PT409';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.group_join_requests
       SET status = 'declined', decided_by = v_uid, decided_at = now()
     WHERE id = v_request.id;
    RETURN jsonb_build_object('status', 'declined', 'requestId', v_request.id);
  END IF;

  -- A block now: decline quietly, admit nothing.
  IF public.chat_member_blocked(v_request.conversation_id, v_request.user_id) THEN
    UPDATE public.group_join_requests
       SET status = 'declined', decided_by = v_uid, decided_at = now()
     WHERE id = v_request.id;
    RETURN jsonb_build_object('status', 'declined', 'requestId', v_request.id);
  END IF;

  IF public.chat_group_is_full(v_request.conversation_id) THEN
    RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
  END IF;

  v_admit := public.chat_group_admit(v_request.conversation_id, v_request.user_id, v_uid);

  UPDATE public.group_join_requests
     SET status = 'approved', decided_by = v_uid, decided_at = now()
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'status', 'approved', 'requestId', v_request.id,
    'sessionId', v_admit -> 'sessionId', 'inviteId', v_admit -> 'inviteId'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.decide_group_join_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_group_join_request(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_added uuid[] := ARRAY[]::uuid[];
  v_skipped uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'plain' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS x
   WHERE x IS NOT NULL;
  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 20 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_user_ids';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_id = v_uid
       OR public.is_conversation_participant(p_conversation_id, v_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.friends f
          WHERE f.user_id = v_uid AND f.friend_user_id = v_id
            AND f.status = 'accepted' AND f.deleted_at IS NULL
       )
       OR public.chat_member_blocked(p_conversation_id, v_id) THEN
      v_skipped := v_skipped || v_id;
    ELSE
      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (p_conversation_id, v_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
      v_added := v_added || v_id;
    END IF;
  END LOOP;

  IF cardinality(v_added) > 0 THEN
    PERFORM public.chat_group_post_event(
      p_conversation_id, 'members_added',
      jsonb_build_object('actorId', v_uid, 'userIds', to_jsonb(v_added)),
      public.issue_4114_first_name(v_uid) || ' added ' || cardinality(v_added)
        || CASE WHEN cardinality(v_added) = 1 THEN ' person' ELSE ' people' END
    );
  END IF;

  RETURN jsonb_build_object('added', to_jsonb(v_added), 'skipped', to_jsonb(v_skipped));
END;
$function$;
REVOKE ALL ON FUNCTION public.add_group_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) TO authenticated;

-- A session-group joiner who accepts their link invite is announced once.
CREATE OR REPLACE FUNCTION public.tg_4261_announce_link_join()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation_id uuid := public.resolve_session_conversation(NEW.session_id);
BEGIN
  IF v_conversation_id IS NOT NULL AND NEW.invited_user_id IS NOT NULL THEN
    PERFORM public.chat_group_post_event(
      v_conversation_id, 'joined_by_link',
      jsonb_build_object('userId', NEW.invited_user_id, 'sharerId', NEW.inviter_id),
      public.issue_4114_first_name(NEW.invited_user_id) || ' joined with the group link'
    );
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_announce_link_join() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_announce_link_join ON public.collaboration_invites;
CREATE TRIGGER tg_4261_announce_link_join
  AFTER UPDATE ON public.collaboration_invites
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' AND NEW.invite_method = 'link')
  EXECUTE FUNCTION public.tg_4261_announce_link_join();

COMMIT;
