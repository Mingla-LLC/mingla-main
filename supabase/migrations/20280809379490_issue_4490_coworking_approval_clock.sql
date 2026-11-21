-- Issue #4490, spec 07 G: an approved request gets its promised three-day
-- payment window, regardless of how long it waited for the venue's answer.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN RETURN; END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 approval clock patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$    WHERE s.status = 'pending' AND s.created_at <= v_now - interval '2 days'$old$,
  $new$    WHERE s.status = 'pending'
      AND CASE WHEN s.decided_at IS NOT NULL THEN s.decided_at + interval '3 days'
               ELSE s.created_at + interval '2 days' END <= v_now$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

COMMIT;
