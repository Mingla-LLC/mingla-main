-- ORCH-1240 / GitHub #668 — dual-sided account deletion + actor FK unblock for auth removal.
-- Prod project: gqnoajqerqhnvulmnyvv (safe-migration protocol applies at deploy).

-- Explorer side marker (consumer app delete; auth may survive when business side remains).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS explorer_deleted_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.explorer_deleted_at IS
  'Set when the user deletes their explorer/consumer side. Auth login may remain while business side is active (#668).';

-- ── Nullable actor FKs → ON DELETE SET NULL ───────────────────────────────────

ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_initiated_by_fkey;
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_initiated_by_fkey
  FOREIGN KEY (initiated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_used_by_scanner_id_fkey;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_used_by_scanner_id_fkey
  FOREIGN KEY (used_by_scanner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_approval_decided_by_fkey;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_approval_decided_by_fkey
  FOREIGN KEY (approval_decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_take_rate_override_updated_by_fkey;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_take_rate_override_updated_by_fkey
  FOREIGN KEY (take_rate_override_updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.platform_pricing_config
  DROP CONSTRAINT IF EXISTS platform_pricing_config_updated_by_fkey;
ALTER TABLE public.platform_pricing_config
  ADD CONSTRAINT platform_pricing_config_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.photo_aesthetic_labels
  DROP CONSTRAINT IF EXISTS photo_aesthetic_labels_labeled_by_fkey;
ALTER TABLE public.photo_aesthetic_labels
  ADD CONSTRAINT photo_aesthetic_labels_labeled_by_fkey
  FOREIGN KEY (labeled_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.photo_aesthetic_runs
  DROP CONSTRAINT IF EXISTS photo_aesthetic_runs_triggered_by_fkey;
ALTER TABLE public.photo_aesthetic_runs
  ADD CONSTRAINT photo_aesthetic_runs_triggered_by_fkey
  FOREIGN KEY (triggered_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.photo_backfill_runs
  DROP CONSTRAINT IF EXISTS photo_backfill_runs_triggered_by_fkey;
ALTER TABLE public.photo_backfill_runs
  ADD CONSTRAINT photo_backfill_runs_triggered_by_fkey
  FOREIGN KEY (triggered_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.signal_anchors
  DROP CONSTRAINT IF EXISTS signal_anchors_labeled_by_fkey;
ALTER TABLE public.signal_anchors
  ADD CONSTRAINT signal_anchors_labeled_by_fkey
  FOREIGN KEY (labeled_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── NOT NULL audit actor columns → nullable + ON DELETE SET NULL ──────────────

ALTER TABLE public.events
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.event_scanners
  ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE public.event_scanners
  DROP CONSTRAINT IF EXISTS event_scanners_assigned_by_fkey;
ALTER TABLE public.event_scanners
  ADD CONSTRAINT event_scanners_assigned_by_fkey
  FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.brand_invitations
  ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_invited_by_fkey;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.experience_edit_log
  ALTER COLUMN edited_by DROP NOT NULL;
ALTER TABLE public.experience_edit_log
  DROP CONSTRAINT IF EXISTS experience_edit_log_edited_by_fkey;
ALTER TABLE public.experience_edit_log
  ADD CONSTRAINT experience_edit_log_edited_by_fkey
  FOREIGN KEY (edited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.trip_edit_log
  ALTER COLUMN edited_by DROP NOT NULL;
ALTER TABLE public.trip_edit_log
  DROP CONSTRAINT IF EXISTS trip_edit_log_edited_by_fkey;
ALTER TABLE public.trip_edit_log
  ADD CONSTRAINT trip_edit_log_edited_by_fkey
  FOREIGN KEY (edited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.manual_buyer_reminders
  ALTER COLUMN sent_by_user_id DROP NOT NULL;
ALTER TABLE public.manual_buyer_reminders
  DROP CONSTRAINT IF EXISTS manual_buyer_reminders_sent_by_user_id_fkey;
ALTER TABLE public.manual_buyer_reminders
  ADD CONSTRAINT manual_buyer_reminders_sent_by_user_id_fkey
  FOREIGN KEY (sent_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- marketing_campaigns.account_id RESTRICT blocks auth delete — cascade when user removed.
ALTER TABLE public.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_account_id_fkey;
ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE;
