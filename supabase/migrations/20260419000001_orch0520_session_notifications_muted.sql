-- ORCH-0520: Per-participant session mute. Persists the user's decision to
-- silence push notifications for a specific session. Read by notify-dispatch
-- before delivering session-scoped pushes.
--
-- DEFAULT false enforces invariant I-SESSION-MUTE-DEFAULT-UNMUTED — new
-- participants MUST default to unmuted. No code path may write true unless
-- the user explicitly taps the bell icon in BoardSettingsDropdown.
--
-- RLS: existing sp_insert (20260227000005_harden_session_participants_insert_rls.sql)
-- and session_participants UPDATE policies already scope writes to the row owner
-- OR the session creator/admin. Column additions inherit those policies.
--
-- Realtime: already enabled via 20260312400002_add_collaboration_tables_to_realtime.sql.

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT false;

-- Partial index — mutes are rare; index only the rows that matter for
-- notify-dispatch's mute lookup query (WHERE notifications_muted = true).
CREATE INDEX IF NOT EXISTS idx_session_participants_muted
  ON public.session_participants (session_id, user_id)
  WHERE notifications_muted = true;

COMMENT ON COLUMN public.session_participants.notifications_muted IS
  'ORCH-0520: If true, notify-dispatch suppresses session-scoped push for this (session, user) pair. User-controlled via BoardSettingsDropdown bell icon. Does NOT suppress the in-app notification row — only push delivery. DEFAULT false enforces invariant I-SESSION-MUTE-DEFAULT-UNMUTED.';
