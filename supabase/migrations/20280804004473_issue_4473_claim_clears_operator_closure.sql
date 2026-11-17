-- Issue #4473 — a claim must clear an operator closure, or it aborts the sweep.
--
-- `attendance_claim_recovery_items_operator_resolution_check` allows
-- `operator_closure_id` only together with
-- `resolved_via = 'operator_confirmed_no_current_buyer'`. Operators closed 235
-- recovery items that way (#3060). When the buyer of one of those orders later
-- proves the order's contact, both claim rails run
--   SET state = 'claimed', resolved_via = <verified_identity | token kind>
-- and leave `operator_closure_id` behind, so the CHECK raises 23514. In
-- `claim_attendance_by_verified_identity` that aborts the whole sweep: every
-- other order, RSVP, reservation, stay and food order for that account stays
-- detached, on every app open. Measured on production 2026-11-17: 235 such
-- orders across 230 buyers.
--
-- The fix: the claim is the true resolution, so the same SET clears
-- `operator_closure_id`. The closure record in
-- `attendance_claim_recovery_operator_closures` is untouched and remains the
-- history of the operator decision.
--
-- How: both live bodies are patched in place by replacing one exact fragment,
-- so nothing else in these large functions can drift. Each body must contain
-- the fragment exactly once, or already contain the patched form (re-run is a
-- no-op). Anything else fails the migration. CREATE OR REPLACE keeps owner and
-- grants. #4459 replaces both functions later and carries the same SET.
--
-- No production row is created, modified or deleted by this file.

BEGIN;

-- The patch runs inside a pg_temp helper (as #4420 does) so the replaced
-- function source is executed from a function body, not a DO block.
CREATE FUNCTION pg_temp.issue_4473_patch(p_sig regprocedure)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old constant text := 'SET state = ''claimed'', resolved_via = ';
  v_new constant text :=
    'SET state = ''claimed'', operator_closure_id = NULL, resolved_via = ';
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_new_count := (length(v_def) - length(replace(v_def, v_new, '')))
    / length(v_new);
  v_old_count := (length(v_def) - length(replace(v_def, v_old, '')))
    / length(v_old);

  IF v_new_count = 1 AND v_old_count = 0 THEN
    RETURN;
  END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION
      'issue_4473: % has % unpatched and % patched recovery claim updates; expected exactly one unpatched',
      p_sig, v_old_count, v_new_count;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$fn$;

SELECT pg_temp.issue_4473_patch(
  'public.claim_attendance_by_verified_identity(uuid)'::regprocedure
);
SELECT pg_temp.issue_4473_patch(
  'public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure
);

DROP FUNCTION pg_temp.issue_4473_patch(regprocedure);

COMMIT;
