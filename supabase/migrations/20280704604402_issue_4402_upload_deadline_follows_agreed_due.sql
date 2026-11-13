-- #4402 walk 3 (Seth, 2026-11-13: "yes fix all this"): the upload timer
-- follows the agreed "Video needed by" time.
--
-- Before: gig_transition set the script_locked deadline to post_by - 1 day at
-- 00:00 UTC and ignored terms.video_due_at, which both apps show. A gig with
-- "Video needed by Tue Dec 15, 6 PM Lagos" was cancelled (host refunded) at
-- Mon Dec 14, 1 AM Lagos. An accepted date change did not move the timer at all.
--
-- Now one BEFORE UPDATE trigger owns the timer for these states:
--   * entering script_locked, or the agreed terms changing while in it:
--     the agreed video_due_at (fallback: the old post_by - 1 rule), never
--     sooner than 24 hours from now (the existing grace).
--   * approved / posting / posts_failed with a terms change: the posting
--     deadline recomputed from the new post_by (same formula as
--     issue_4402_gig_post_deadline; same 24 h / 48 h floors as gig_transition).
-- gig_transition is not copied or changed; the trigger runs after its UPDATE
-- sets the row and replaces only state_deadline_at in these cases.
-- Proof: __tests__/issue_4402_upload_deadline_follows_agreed_due.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.issue_4402_upload_deadline(p_contract_id uuid, p_terms_version integer) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  -- Invariant (declared in its test): I-4402-UPLOAD-1 | issue #4402 | the upload timer is the agreed video_due_at (fallback post_by - 1 day UTC), never sooner than 24 h after it starts
  SELECT coalesce(t.video_due_at, ((coalesce(t.post_by,g.post_by)-1)::timestamp AT TIME ZONE 'UTC'))
  FROM public.gig_contracts c
  JOIN public.gigs g ON g.id=c.gig_id
  LEFT JOIN public.gig_terms_versions t ON t.contract_id=c.id AND t.version=p_terms_version
  WHERE c.id=p_contract_id
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_upload_deadline(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_upload_deadline(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_contract_deadline_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_terms_changed boolean := OLD.current_terms_version IS DISTINCT FROM NEW.current_terms_version;
  v_post_deadline timestamptz;
BEGIN
  IF NEW.state='script_locked' AND (OLD.state IS DISTINCT FROM NEW.state OR v_terms_changed) THEN
    NEW.state_deadline_at := greatest(public.issue_4402_upload_deadline(NEW.id, NEW.current_terms_version), now()+interval '24 hours');
  ELSIF v_terms_changed AND OLD.state=NEW.state AND NEW.state IN ('approved','posting','posts_failed') THEN
    SELECT ((coalesce(t.post_by,g.post_by)+1)::timestamp AT TIME ZONE public.issue_3872_gig_timezone(g.id))+interval '24 hours'
      INTO v_post_deadline
      FROM public.gigs g
      LEFT JOIN public.gig_terms_versions t ON t.contract_id=NEW.id AND t.version=NEW.current_terms_version
     WHERE g.id=NEW.gig_id;
    IF v_post_deadline IS NOT NULL THEN
      NEW.state_deadline_at := greatest(v_post_deadline, now()+CASE WHEN NEW.state='posts_failed' THEN interval '48 hours' ELSE interval '24 hours' END);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_contract_deadline_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4402_contract_deadline_sync ON public.gig_contracts;
CREATE TRIGGER issue_4402_contract_deadline_sync
  BEFORE UPDATE OF state, current_terms_version ON public.gig_contracts
  FOR EACH ROW EXECUTE FUNCTION public.issue_4402_contract_deadline_sync();

-- Live gigs already in the upload step: extend (never shorten) to the agreed time.
UPDATE public.gig_contracts c
   SET state_deadline_at = greatest(public.issue_4402_upload_deadline(c.id, c.current_terms_version), now()+interval '24 hours')
 WHERE c.state='script_locked' AND c.state_deadline_at IS NOT NULL
   AND public.issue_4402_upload_deadline(c.id, c.current_terms_version) > c.state_deadline_at;

COMMIT;
