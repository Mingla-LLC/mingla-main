-- ORCH-0821 — Ari MVP agent tables
--
-- Creates the four tables backing the Ari chat assistant in mingla-business:
--   1. agent_conversations    — one row per chat thread
--   2. agent_messages         — one row per turn (user / assistant / tool)
--   3. agent_pending_actions  — server-authoritative pending-write state machine
--   4. agent_user_profile     — per-user Ari preferences + AI-disclosure consent
--
-- RLS pattern is the direct-predicate owner-callable pattern established by
-- ORCH-0734 (RLS-RETURNING-OWNER-GAP fix). No SECURITY DEFINER helpers; every
-- policy uses `user_id = auth.uid()` so that RETURNING + soft-delete contexts
-- behave correctly.
--
-- Cross-references:
--   - Spec: Mingla_Artifacts/specs/SPEC_ORCH-0821_ARI_MVP.md §2
--   - Design: Mingla_Artifacts/ARI_DESIGN.md §5 (memory architecture), §10 (security)
--   - RLS reference: 20260507000000_orch_0734_rls_returning_owner_gap_fix.sql

BEGIN;

-- =============================================================================
-- 1. agent_conversations
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  title text,
  summary text,
  summary_through_message_id uuid,
  summary_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_updated
  ON public.agent_conversations (user_id, updated_at DESC);

COMMENT ON TABLE public.agent_conversations IS
  'ORCH-0821: Ari MVP — one row per conversation thread. brand_id is optional context. summary fields support Layer 2 conversation compression (Phase 2 — null in MVP).';

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own agent conversations"
  ON public.agent_conversations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owner can insert own agent conversations"
  ON public.agent_conversations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can update own agent conversations"
  ON public.agent_conversations FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can delete own agent conversations"
  ON public.agent_conversations FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- 2. agent_messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content jsonb NOT NULL,
  tool_calls jsonb,
  tool_results jsonb,
  prompt_version text,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_convo_created
  ON public.agent_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_messages_user_created
  ON public.agent_messages (user_id, created_at DESC);

COMMENT ON TABLE public.agent_messages IS
  'ORCH-0821: Ari MVP — one row per turn. user_id denormalised for RLS performance (avoids join through agent_conversations on every query). Content shape varies by role.';

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own agent messages"
  ON public.agent_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owner can insert own agent messages"
  ON public.agent_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can update own agent messages"
  ON public.agent_messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can delete own agent messages"
  ON public.agent_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- 3. agent_pending_actions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_args jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'executed', 'cancelled', 'expired', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  executed_at timestamptz,
  executed_result jsonb,
  failure_reason text
);

CREATE INDEX IF NOT EXISTS idx_agent_pending_actions_user_status
  ON public.agent_pending_actions (user_id, status, expires_at);

COMMENT ON TABLE public.agent_pending_actions IS
  'ORCH-0821: Ari MVP — server-authoritative pending-write state machine. Flow: pending -> executing -> (executed | failed). Cancellation: pending -> cancelled. Expiry: pending -> expired. Only status=pending rows are executable. agent-confirm-action performs atomic status flips to prevent double-execute and replay.';

ALTER TABLE public.agent_pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own agent pending actions"
  ON public.agent_pending_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owner can insert own agent pending actions"
  ON public.agent_pending_actions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can update own agent pending actions"
  ON public.agent_pending_actions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can delete own agent pending actions"
  ON public.agent_pending_actions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- 4. agent_user_profile
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_user_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  preferred_timezone text,
  preferred_currency character(3),
  communication_style text NOT NULL DEFAULT 'concise'
    CHECK (communication_style IN ('concise', 'detailed')),
  autopilot_tools text[] NOT NULL DEFAULT ARRAY[]::text[],
  spend_cap_daily_cents int,
  spend_cap_monthly_cents int,
  proactive_messages_enabled boolean NOT NULL DEFAULT false,
  ai_disclosure_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_user_profile IS
  'ORCH-0821: Ari MVP — per-user Ari preferences and consent. Spend caps reserved for Phase 2 (no enforcement in MVP). autopilot_tools is server-validated against a hardcoded allowed-set; the model cannot promote a tool to autopilot.';

ALTER TABLE public.agent_user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own agent profile"
  ON public.agent_user_profile FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owner can insert own agent profile"
  ON public.agent_user_profile FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can update own agent profile"
  ON public.agent_user_profile FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner can delete own agent profile"
  ON public.agent_user_profile FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;
