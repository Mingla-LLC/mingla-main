-- #4382 — retire beta feedback (D1, D7).
--
-- Moved out of scripts/deferred-migrations/ once its preconditions held:
--   1. 20280613004382 .. 20280613054382 are applied in production;
--   2. support-beta-feedback-import ran with copied 8, failed 0, pending 0;
--   3. the Explorer build that replaces beta feedback with Help & Support is
--      live on both platforms, so no client calls submit-feedback;
--   4. the delete-user beta_feedback anonymize step is removed, and the
--      submit-feedback and support-beta-feedback-import functions are deleted
--      from source, in this same pull request.
-- Renumbered from 20280613064382 to sort above every sibling migration.
--
-- Dropping beta_feedback drops its RLS policies, indexes, constraints and
-- updated_at trigger with it (no view, foreign key or function depends on
-- the table). The import-only marker function is dropped. The four
-- storage.objects policies that served the beta-feedback bucket are dropped
-- too; dropping a policy deletes no object. The beta-feedback bucket itself
-- is emptied and deleted in the Supabase dashboard after merge: plain SQL
-- must not delete storage objects.
--
-- The migration refuses to run while any imported file is still uncopied.

BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.support_attachments
    WHERE import_source_bucket = 'beta-feedback'
      AND import_copied_at IS NULL
  ) THEN
    RAISE EXCEPTION 'beta_feedback_files_not_copied: run support-beta-feedback-import first'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

-- The import map has done its job.
DROP TABLE public.issue_4382_beta_feedback_import;
DROP TABLE public.beta_feedback;

-- Only support-beta-feedback-import called this, and that function is
-- deleted in this pull request.
DROP FUNCTION public.issue_4382_mark_attachment_imported(uuid, integer);

-- The old bucket's storage policies (production-only: the from-baseline
-- replay never created them, so IF EXISTS keeps the replay green).
DO $policies$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '#4382: storage.objects unavailable; no beta-feedback policies to drop';
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS "Admins can read all feedback audio" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Beta testers can upload feedback audio" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can read own feedback audio" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete own feedback files" ON storage.objects';
END
$policies$;

-- The copied rows no longer point anywhere. Every imported row already has
-- its message_id and bytes, so it stays outside the unattached-upload purge.
UPDATE public.support_attachments
   SET import_source_bucket = NULL, import_source_path = NULL
 WHERE import_source_bucket = 'beta-feedback';

COMMIT;
