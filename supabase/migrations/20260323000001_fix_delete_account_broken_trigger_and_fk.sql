-- ============================================================================
-- Fix: Account deletion fails for any user who has sent messages
-- ============================================================================
-- ROOT CAUSE: The soft_delete_message_trigger on public.messages references
-- column "is_deleted" which no longer exists (was removed in a prior migration).
-- When auth.admin.deleteUser() cascades to delete the user's messages, this
-- trigger fires and crashes: "column 'is_deleted' of relation 'messages' does
-- not exist", rolling back the entire deletion.
--
-- The app never issues DELETE on messages — it uses UPDATE deleted_at for
-- soft-deletes. The trigger is dead code that only fires during CASCADE.
--
-- PREVENTIVE: Seven FK columns reference auth.users(id) with NO ACTION
-- (the default), which silently blocks DELETE if any rows exist. Changing
-- these to SET NULL prevents future deletion failures.
-- ============================================================================

-- ── Fix 1: Drop the broken soft-delete trigger and function ──────────────

DROP TRIGGER IF EXISTS soft_delete_message_trigger ON public.messages;
DROP FUNCTION IF EXISTS public.soft_delete_message();

-- ── Fix 2: Change NO ACTION FKs to SET NULL ──────────────────────────────

-- pending_pair_invites.converted_user_id
ALTER TABLE public.pending_pair_invites
  DROP CONSTRAINT IF EXISTS pending_pair_invites_converted_user_id_fkey;
ALTER TABLE public.pending_pair_invites
  ADD CONSTRAINT pending_pair_invites_converted_user_id_fkey
  FOREIGN KEY (converted_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- user_reports.reviewed_by
ALTER TABLE public.user_reports
  DROP CONSTRAINT IF EXISTS user_reports_reviewed_by_fkey;
ALTER TABLE public.user_reports
  ADD CONSTRAINT user_reports_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- admin_backfill_log.triggered_by
ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_triggered_by_fkey;
ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_triggered_by_fkey
  FOREIGN KEY (triggered_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- admin_config.updated_by
ALTER TABLE public.admin_config
  DROP CONSTRAINT IF EXISTS admin_config_updated_by_fkey;
ALTER TABLE public.admin_config
  ADD CONSTRAINT admin_config_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- admin_email_log.sent_by
ALTER TABLE public.admin_email_log
  DROP CONSTRAINT IF EXISTS admin_email_log_sent_by_fkey;
ALTER TABLE public.admin_email_log
  ADD CONSTRAINT admin_email_log_sent_by_fkey
  FOREIGN KEY (sent_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- admin_subscription_overrides.granted_by
ALTER TABLE public.admin_subscription_overrides
  DROP CONSTRAINT IF EXISTS admin_subscription_overrides_granted_by_fkey;
ALTER TABLE public.admin_subscription_overrides
  ADD CONSTRAINT admin_subscription_overrides_granted_by_fkey
  FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- place_admin_actions.acted_by
ALTER TABLE public.place_admin_actions
  DROP CONSTRAINT IF EXISTS place_admin_actions_acted_by_fkey;
ALTER TABLE public.place_admin_actions
  ADD CONSTRAINT place_admin_actions_acted_by_fkey
  FOREIGN KEY (acted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
