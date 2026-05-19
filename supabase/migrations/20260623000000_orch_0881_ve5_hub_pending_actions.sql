-- ORCH-0881 — Ve5 Menu AI Parser: extend agent_pending_actions for Hub-origin proposals.
--
-- Hub experience parsing (and future Tr8 trip-day parsing) reuse the Ari pending-
-- action state machine without requiring an agent_conversations row.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0881_VE5_MENU_AI_PARSER.md §1

BEGIN;

ALTER TABLE public.agent_pending_actions
  ALTER COLUMN conversation_id DROP NOT NULL;

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ari'
    CHECK (source IN ('ari', 'hub_experience', 'hub_trip_day'));

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS related_brand_id uuid
    REFERENCES public.brands(id) ON DELETE CASCADE;

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS related_event_id uuid
    REFERENCES public.events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.agent_pending_actions.source IS
  'ORCH-0881: proposal origin. ari = Ari chat; hub_experience = Ve5 menu snap; hub_trip_day = Tr8 brochure (future).';

COMMENT ON COLUMN public.agent_pending_actions.related_brand_id IS
  'ORCH-0881: venue brand context for Hub-origin experience proposals (Ve5+).';

CREATE INDEX IF NOT EXISTS idx_agent_pending_hub_experience
  ON public.agent_pending_actions (related_brand_id, status, expires_at)
  WHERE source = 'hub_experience';

-- Hub rows must not reference a conversation; Ari rows must have one.
ALTER TABLE public.agent_pending_actions
  DROP CONSTRAINT IF EXISTS agent_pending_actions_source_conversation_check;

ALTER TABLE public.agent_pending_actions
  ADD CONSTRAINT agent_pending_actions_source_conversation_check
  CHECK (
    (source = 'ari' AND conversation_id IS NOT NULL)
    OR (source IN ('hub_experience', 'hub_trip_day') AND conversation_id IS NULL)
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE source = 'ari' AND conversation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ORCH-0881: existing ari pending rows missing conversation_id';
  END IF;
  RAISE NOTICE 'ORCH-0881 migration complete: hub pending action columns added';
END $$;

COMMIT;
