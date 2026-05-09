-- ORCH-0756B: document and preserve the server-backed business draft envelope.
--
-- Draft rows are stored in public.events with:
--   status = 'draft'
--   visibility = 'draft'
--   theme.business_draft = versioned business-app wizard snapshot
--
-- Existing events RLS already grants authenticated event_manager+ users insert,
-- update, delete, and brand-team select access while public policies expose only
-- visibility='public' plus status IN ('scheduled', 'live').

COMMENT ON COLUMN public.events.theme IS
  'JSONB event presentation metadata. ORCH-0756B reserves theme.business_draft for the versioned mingla-business draft wizard snapshot while events.status = draft. The snapshot must not contain plaintext ticket passwords.';

COMMENT ON COLUMN public.events.status IS
  'Canonical event status. Valid DB values: draft, scheduled, live, ended, cancelled. UI labels such as upcoming/past are derived client-side and must not be queried as DB statuses.';

COMMENT ON POLICY "Event manager plus can insert events" ON public.events IS
  'ORCH-0756B: permits authorized business users to create server-backed draft events when created_by = auth.uid().';

COMMENT ON POLICY "Event manager plus can update events" ON public.events IS
  'ORCH-0756B: permits authorized business users to autosave/discard/promote server-backed event drafts. Public draft visibility remains blocked by public select policies.';
