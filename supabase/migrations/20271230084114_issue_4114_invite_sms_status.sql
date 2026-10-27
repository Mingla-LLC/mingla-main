-- Issue #4114 (simulator QA): a friend invite whose text did not go out kept
-- saying "Invited by text" in the Requests tab. send-pair-request now records
-- the outcome of the invite text on the invite row, so the app can say
-- "Invite not texted · Share" after the sheet is closed and reopened.
--
-- Additive: one nullable column (NULL = sent before this column existed, shown
-- as before). Only the service role writes it (send-pair-request).

ALTER TABLE public.pending_pair_invites
  ADD COLUMN IF NOT EXISTS sms_status text;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.pending_pair_invites'::regclass
       AND conname = 'pending_pair_invites_sms_status_check'
  ) THEN
    ALTER TABLE public.pending_pair_invites
      ADD CONSTRAINT pending_pair_invites_sms_status_check
      CHECK (sms_status IS NULL OR sms_status IN ('sent', 'failed'));
  END IF;
END;
$check$;

COMMENT ON COLUMN public.pending_pair_invites.sms_status IS
  'Issue #4114: whether the last invite text to this number went out (sent / failed); NULL for invites older than this column. Written by send-pair-request.';
