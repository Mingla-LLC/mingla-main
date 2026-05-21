-- ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster,
-- harmonized with ORCH-0897 trip group chat)] migration.
--
-- This migration establishes I-PROPOSED-CHAT-SUBSTRATE-UNIFIED: conversations+messages is
-- the ONLY canonical chat substrate. board_messages is retained 1 release as backing data
-- (ORCH-0902 retires it). NO new chat-message tables may be created — verified by CI gate
-- i-proposed-chat-substrate-unified.mjs and tester adversarial TA-08.
--
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md
-- SPEC:          Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md
-- Migration is single-transaction (Supabase default); any failure rolls back atomically.
-- Backfill row-count assertion at Step 7f RAISES EXCEPTION on mismatch.
--
-- Operator-applied via `supabase db push --linked`. NOT applied via MCP (timestamp drift).

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — New columns on conversations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS session_id uuid NULL
    REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id uuid NULL
    REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS linked_entity_type text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS is_broadcast_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS name text NULL;

-- linked_entity_type CHECK (separate from column ADD so it's idempotent across re-runs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_entity_type_check'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_entity_type_check
      CHECK (linked_entity_type IN ('direct', 'session', 'trip'));
  END IF;
END;
$$;

-- Coherence CHECK: each linked_entity_type pins exactly one of session_id / event_id / neither.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_entity_coherent'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_entity_coherent CHECK (
        (linked_entity_type = 'direct' AND session_id IS NULL AND event_id IS NULL)
        OR (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL)
        OR (linked_entity_type = 'trip' AND event_id IS NOT NULL AND session_id IS NULL)
      );
  END IF;
END;
$$;

-- Group conversations must have a name; direct conversations leave NULL (derived from participants).
-- This constraint is added AFTER any backfill that creates groups, otherwise existing rows would
-- violate it. We add it before backfill because the backfill always populates name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_group_requires_name'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_group_requires_name CHECK (
        (type = 'direct' AND name IS NULL)
        OR (type = 'group' AND name IS NOT NULL AND length(trim(name)) > 0)
      );
  END IF;
END;
$$;

-- One conversation per linked entity (partial unique indexes).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_session_id
  ON public.conversations (session_id)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_event_id
  ON public.conversations (event_id)
  WHERE event_id IS NOT NULL;

-- Lookup acceleration for the Friends-tab list query (post-ORCH-0901 perf).
CREATE INDEX IF NOT EXISTS conversations_linked_entity_lookup
  ON public.conversations (linked_entity_type, session_id, event_id);

COMMENT ON COLUMN public.conversations.session_id IS
  'ORCH-0898: FK to collaboration_sessions for type=group conversations linked to a consumer-app collab session.';
COMMENT ON COLUMN public.conversations.event_id IS
  'ORCH-0898: FK to events for type=group conversations linked to a trip (Tr6 / ORCH-0897 inheritance).';
COMMENT ON COLUMN public.conversations.linked_entity_type IS
  'ORCH-0898: discriminator — direct (no linkage), session (collab-session group), trip (event group, Tr6).';
COMMENT ON COLUMN public.conversations.is_broadcast_only IS
  'ORCH-0898: Tr6 broadcast-only mode — when true, only brand_team_members can INSERT messages; readers still read. Consumer-collab case = always false.';
COMMENT ON COLUMN public.conversations.is_enabled IS
  'ORCH-0898: soft-disable flag (Tr6 operator may turn off; consumer-collab stays true).';
COMMENT ON COLUMN public.conversations.name IS
  'ORCH-0898: group chat display name. Direct DMs leave NULL (derived from participants). Group conversations default to collaboration_sessions.name / events.name via trigger.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — New column on messages
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.messages.mentions IS
  'ORCH-0898: array of user_ids referenced via @ in the message content. Mirrors board_messages.mentions shape (jsonb array of uuids). Backfilled from board_messages.mentions during the ORCH-0898 migration. Per-message mention payload; mention-driven push notifications fan out via notify-message type=message_mention.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — New column on conversation_participants
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS notifications_muted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversation_participants.notifications_muted IS
  'ORCH-0898 / ORCH-0520 lineage: per-(conversation, user) mute flag. When true, notify-message suppresses push for this recipient. Does NOT suppress the in-app notification row. Backfilled from session_participants.notifications_muted during the migration.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4 — Trigger function: auto-create group conversation on session creation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_group_conversation_on_session_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_session_name text;
BEGIN
  -- Use the session name as default conversation name. Fall back to "Group chat" if empty.
  v_session_name := COALESCE(NULLIF(trim(NEW.name), ''), 'Group chat');

  -- Idempotent insert via UNIQUE (session_id) partial index.
  INSERT INTO public.conversations (
    type,
    linked_entity_type,
    session_id,
    name,
    created_by,
    is_enabled,
    is_broadcast_only
  ) VALUES (
    'group',
    'session',
    NEW.id,
    v_session_name,
    NEW.created_by,
    true,
    false
  )
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv_id;

  -- Add the session creator as the first participant. Idempotent via UNIQUE constraint.
  -- Note: v_conv_id may be NULL on ON CONFLICT path; in that case the conversation already
  -- exists (e.g., from prior backfill) and the creator may already be a participant — the
  -- ON CONFLICT DO NOTHING below covers re-runs.
  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE session_id = NEW.id AND linked_entity_type = 'session';
  END IF;

  IF v_conv_id IS NOT NULL AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, NEW.created_by)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_group_conversation_on_session_create() IS
  'ORCH-0898: AFTER INSERT trigger on collaboration_sessions. Atomically creates the group conversation + adds the creator as first participant. SECURITY DEFINER so trigger bypasses RLS for the cascade. Idempotent via partial UNIQUE index on conversations.session_id.';

DROP TRIGGER IF EXISTS ensure_group_conversation_on_session_create ON public.collaboration_sessions;
CREATE TRIGGER ensure_group_conversation_on_session_create
  AFTER INSERT ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_group_conversation_on_session_create();

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5 — Trigger function: mirror session_participants → conversation_participants
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_session_member_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  -- Only mirror users who have accepted the invite (has_accepted=true).
  -- The WHEN clause on the trigger gates this, but defense-in-depth.
  IF NEW.has_accepted IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Find the group conversation for this session (created by Step 4's trigger or backfilled).
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE session_id = NEW.session_id
    AND linked_entity_type = 'session';

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, NEW.user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_session_member_to_conversation() IS
  'ORCH-0898: AFTER INSERT/UPDATE-OF-has_accepted trigger on session_participants. Mirrors accepted session members into conversation_participants atomically. SECURITY DEFINER for RLS bypass. Idempotent.';

DROP TRIGGER IF EXISTS mirror_session_participant_to_conversation ON public.session_participants;
CREATE TRIGGER mirror_session_participant_to_conversation
  AFTER INSERT OR UPDATE OF has_accepted ON public.session_participants
  FOR EACH ROW
  WHEN (NEW.has_accepted = true)
  EXECUTE FUNCTION public.sync_session_member_to_conversation();

-- Removal-side trigger (auto-leave on session-leave per locked Q1 default).
CREATE OR REPLACE FUNCTION public.remove_session_member_from_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE session_id = OLD.session_id
    AND linked_entity_type = 'session';

  IF v_conv_id IS NOT NULL THEN
    DELETE FROM public.conversation_participants
    WHERE conversation_id = v_conv_id AND user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.remove_session_member_from_conversation() IS
  'ORCH-0898: AFTER DELETE trigger on session_participants. Auto-removes the user from the linked group conversation (Q1 locked default = auto-leave, no read-only history in v1).';

DROP TRIGGER IF EXISTS remove_session_participant_from_conversation ON public.session_participants;
CREATE TRIGGER remove_session_participant_from_conversation
  AFTER DELETE ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_session_member_from_conversation();

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6 — RLS policy additions + tightening
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a. New brand-team-member read policy on conversations (for Tr6 inheritance).
DROP POLICY IF EXISTS conversations_brand_team_member_read ON public.conversations;
CREATE POLICY conversations_brand_team_member_read
  ON public.conversations
  FOR SELECT
  USING (
    linked_entity_type = 'trip'
    AND event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members btm
      JOIN public.events e ON e.brand_id = btm.brand_id
      WHERE e.id = conversations.event_id
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

COMMENT ON POLICY conversations_brand_team_member_read ON public.conversations IS
  'ORCH-0898: permits brand_team_members of a trip event to read its group conversation row. Active-membership predicate (accepted_at IS NOT NULL AND removed_at IS NULL). Inline EXISTS — NOT SECURITY DEFINER helper — per RLS-RETURNING-OWNER-GAP discipline.';

-- 6b. New brand-team-member read policy on messages.
DROP POLICY IF EXISTS messages_brand_team_member_read ON public.messages;
CREATE POLICY messages_brand_team_member_read
  ON public.messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type = 'trip'
        AND c.event_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.brand_team_members btm
          JOIN public.events e ON e.brand_id = btm.brand_id
          WHERE e.id = c.event_id
            AND btm.user_id = auth.uid()
            AND btm.accepted_at IS NOT NULL
            AND btm.removed_at IS NULL
        )
    )
  );

COMMENT ON POLICY messages_brand_team_member_read ON public.messages IS
  'ORCH-0898: permits brand_team_members of a trip event to read messages in that trip group chat. Active-membership predicate. Inline EXISTS.';

-- 6c. RESTRICTIVE broadcast-only enforcement policy on messages.
-- IMPLEMENTATION NOTE: SPEC §3.1 Step 6c omitted "AS RESTRICTIVE" in its SQL example. Without
-- RESTRICTIVE, the new PERMISSIVE policy is OR'd with the existing "Users can send messages to
-- conversations they participate in" policy, which would WEAKEN the constraint instead of
-- enforcing it. RESTRICTIVE makes this policy AND'd with the existing permissive ones, so
-- the broadcast-only block actually fires. Documented in the implementation report as a SPEC
-- interpretation clarification. Tester adversarial TA-02 verifies the runtime behaviour.
DROP POLICY IF EXISTS messages_broadcast_only_enforcement ON public.messages;
CREATE POLICY messages_broadcast_only_enforcement
  ON public.messages
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    -- Either the message is to a non-broadcast-only conversation, OR the sender is a brand_team_member of the trip.
    NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type = 'trip'
        AND c.is_broadcast_only = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type = 'trip'
        AND c.is_broadcast_only = true
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

COMMENT ON POLICY messages_broadcast_only_enforcement ON public.messages IS
  'ORCH-0898 / Tr6 broadcast-only enforcement: RESTRICTIVE INSERT policy. When a trip conversation has is_broadcast_only=true, only brand_team_members (active) can INSERT messages. Non-trip conversations + non-broadcast trips bypass via the NOT EXISTS first branch. AS RESTRICTIVE forces AND-combination with the existing permissive INSERT policy.';

-- 6d. Tighten the self-add policy on conversation_participants.
-- The existing "Users can add themselves to conversations" (baseline migration line 14541)
-- permits self-add for ALL conversation types. For type='group' (session-linked) this must
-- be FORBIDDEN — roster sync is trigger-only. Direct DM self-add (lazy-creation) preserved.
DROP POLICY IF EXISTS "Users can add themselves to conversations" ON public.conversation_participants;

-- Add the replacement only if not already present (idempotency).
DROP POLICY IF EXISTS conversation_participants_direct_self_add ON public.conversation_participants;
CREATE POLICY conversation_participants_direct_self_add
  ON public.conversation_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.type = 'direct'
    )
  );

COMMENT ON POLICY conversation_participants_direct_self_add ON public.conversation_participants IS
  'ORCH-0898: tightens the legacy "Users can add themselves to conversations" policy — self-add now only permitted for type=direct conversations (the DM lazy-creation path in messagingService). For type=group conversations, roster writes go through SECURITY DEFINER triggers only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7 — Data backfill: board_messages → messages + conversations rows
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 7a: Backup snapshot for rollback safety. Retain 14 days; drop via scheduled cleanup
-- ORCH after 2026-07-08.
CREATE TABLE IF NOT EXISTS public._archive_orch_0898_board_messages_pre_migration AS
  SELECT * FROM public.board_messages;

COMMENT ON TABLE public._archive_orch_0898_board_messages_pre_migration IS
  'ORCH-0898 backup snapshot of board_messages pre-migration. Retain 14 days; drop in scheduled cleanup ORCH after 2026-07-08. Used as rollback source if the unified-substrate migration surfaces a corruption.';

-- Step 7b: Backfill conversations rows from collaboration_sessions that have >= 1 board_messages row
-- (or even sessions without messages — we create the conversation eagerly per ORCH-0898 design).
INSERT INTO public.conversations (
  id, type, linked_entity_type, session_id, name, created_by, is_enabled, is_broadcast_only, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'group',
  'session',
  cs.id,
  COALESCE(NULLIF(trim(cs.name), ''), 'Group chat'),
  cs.created_by,
  true,
  false,
  cs.created_at,
  cs.updated_at
FROM public.collaboration_sessions cs
WHERE NOT EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.session_id = cs.id AND c.linked_entity_type = 'session'
);

-- Step 7c: Backfill conversation_participants from session_participants (accepted only).
INSERT INTO public.conversation_participants (conversation_id, user_id, notifications_muted, joined_at)
SELECT
  c.id,
  sp.user_id,
  COALESCE(sp.notifications_muted, false),
  COALESCE(sp.joined_at, NOW())
FROM public.session_participants sp
JOIN public.conversations c ON c.session_id = sp.session_id AND c.linked_entity_type = 'session'
WHERE sp.has_accepted = true
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Step 7d: Backfill messages from board_messages. Two-pass because reply_to_id needs ID translation.
-- Pass 1: build a temp ID-map table with PRE-COMPUTED new uuids so we can translate reply_to_id.
CREATE TEMP TABLE _orch_0898_msg_id_map ON COMMIT DROP AS
SELECT
  bm.id AS board_message_id,
  gen_random_uuid() AS new_message_id,
  c.id AS new_conversation_id
FROM public.board_messages bm
JOIN public.conversations c ON c.session_id = bm.session_id AND c.linked_entity_type = 'session';

CREATE UNIQUE INDEX _orch_0898_msg_id_map_board_idx
  ON _orch_0898_msg_id_map (board_message_id);

-- Pass 2: INSERT messages using the precomputed new ids. reply_to_id starts NULL; pass 3 fills it.
INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type,
  file_url, file_name, file_size, card_payload, reply_to_id,
  mentions, created_at, updated_at, deleted_at, is_read, read_at
)
SELECT
  map.new_message_id,
  map.new_conversation_id,
  bm.user_id,
  bm.content,
  CASE WHEN bm.image_url IS NOT NULL THEN 'image' ELSE 'text' END,
  bm.image_url,
  NULL,            -- board_messages has no file_name
  NULL,            -- or file_size
  NULL,            -- or card_payload
  NULL,            -- reply_to_id translated in pass 3
  COALESCE(bm.mentions, '[]'::jsonb),
  bm.created_at,
  bm.updated_at,
  bm.deleted_at,
  false,           -- is_read is per-recipient via message_reads, not on messages
  NULL
FROM _orch_0898_msg_id_map map
JOIN public.board_messages bm ON bm.id = map.board_message_id
ON CONFLICT (id) DO NOTHING; -- idempotent on re-run (gen_random_uuid won't collide, but defense in depth)

-- Pass 3: backfill reply_to_id using the ID map.
UPDATE public.messages m
SET reply_to_id = dst_map.new_message_id
FROM _orch_0898_msg_id_map src_map
JOIN public.board_messages bm ON bm.id = src_map.board_message_id
JOIN _orch_0898_msg_id_map dst_map ON dst_map.board_message_id = bm.reply_to_id
WHERE m.id = src_map.new_message_id
  AND bm.reply_to_id IS NOT NULL;

-- Step 7e: Backfill message_reads from board_message_reads via the ID map.
-- message_reads has no UNIQUE constraint on (message_id, user_id); use WHERE NOT EXISTS guard.
INSERT INTO public.message_reads (message_id, user_id, read_at)
SELECT
  map.new_message_id,
  bmr.user_id,
  bmr.read_at
FROM public.board_message_reads bmr
JOIN _orch_0898_msg_id_map map ON map.board_message_id = bmr.message_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_reads existing
  WHERE existing.message_id = map.new_message_id
    AND existing.user_id = bmr.user_id
);

-- Step 7f: Row-count assertions (RAISE EXCEPTION on mismatch — rolls back entire migration).
DO $$
DECLARE
  v_src_messages bigint;
  v_dst_messages bigint;
  v_diff bigint;
  v_src_reads bigint;
  v_dst_reads bigint;
BEGIN
  -- Messages count comparison.
  SELECT COUNT(*) INTO v_src_messages
  FROM public.board_messages bm
  JOIN public.collaboration_sessions cs ON cs.id = bm.session_id;

  SELECT COUNT(*) INTO v_dst_messages
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.linked_entity_type = 'session';

  v_diff := v_src_messages - v_dst_messages;

  IF v_diff > 0 THEN
    RAISE EXCEPTION 'ORCH-0898 backfill row-count mismatch (messages): board_messages=%, messages-session-linked=%, missing=%',
      v_src_messages, v_dst_messages, v_diff;
  END IF;

  -- Read receipts comparison (less strict — some board_message_reads may reference messages
  -- whose source board_message no longer exists due to historical cleanups; we accept dst >= src).
  SELECT COUNT(*) INTO v_src_reads
  FROM public.board_message_reads bmr
  JOIN public.board_messages bm ON bm.id = bmr.message_id
  JOIN public.collaboration_sessions cs ON cs.id = bm.session_id;

  SELECT COUNT(*) INTO v_dst_reads
  FROM public.message_reads mr
  JOIN public.messages m ON m.id = mr.message_id
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.linked_entity_type = 'session';

  IF v_dst_reads < v_src_reads THEN
    RAISE EXCEPTION 'ORCH-0898 backfill row-count mismatch (message_reads): board=%, dst=%, dropped=%',
      v_src_reads, v_dst_reads, v_src_reads - v_dst_reads;
  END IF;

  RAISE NOTICE 'ORCH-0898 backfill OK: board_messages=% → messages=% (session-linked); board_message_reads=% → message_reads=% (session-linked).',
    v_src_messages, v_dst_messages, v_src_reads, v_dst_reads;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of ORCH-0898 migration. Operator verifies via `mcp__supabase__list_migrations`
-- after `supabase db push --linked` completes.
-- ─────────────────────────────────────────────────────────────────────────────
