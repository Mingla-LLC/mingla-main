-- #4382 — retire beta feedback (D1, D7). DEFERRED: not in the apply path.
--
-- Move this file into supabase/migrations/ only AFTER:
--   1. 20280613004382 .. 20280613054382 are applied (this file sorts after
--      all of them; if anything newer has been applied by then, rename it to
--      a version above the production ceiling before moving it);
--   2. support-beta-feedback-import is deployed and has been run, and its
--      response shows "pending": 0 and "failed": [];
--   3. Support has played one imported voice note in Mingla Admin;
--   4. the Explorer app build that replaces beta feedback with Help & Support
--      (Wave 5) is live, so no client still calls submit-feedback, and the
--      delete-user beta_feedback anonymize step is removed in that same pull
--      request.
-- Then delete the submit-feedback function (supabase functions delete
-- submit-feedback) and empty and delete the beta-feedback bucket in the
-- Supabase dashboard (Storage) — plain SQL must not delete storage objects.
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

-- The copied rows no longer point anywhere.
UPDATE public.support_attachments
   SET import_source_bucket = NULL, import_source_path = NULL
 WHERE import_source_bucket = 'beta-feedback';

COMMIT;
