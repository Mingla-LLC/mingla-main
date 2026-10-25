-- Issue #4063: insert Purchases as Profile coach step 8 without changing the
-- meaning of any saved in-progress or completed tour position.
--
-- Old grammar: -1 skipped, 0 not started, 1..11 in progress, 12 completed.
-- New grammar: -1 skipped, 0 not started, 1..12 in progress, 13 completed.
-- Steps 1..7 keep their ids. Old steps 8..11 and terminal 12 shift by one so
-- an existing user resumes the same semantic target and a completed tour stays
-- terminal. Only a new/not-started tour sees the newly inserted Purchases step.

BEGIN;

DO $issue_4063_purchase_coach$
DECLARE
  v_invalid integer;
  v_updated integer;
BEGIN
  SELECT count(*) INTO v_invalid
  FROM public.profiles
  WHERE coach_mark_step IS NOT NULL
    AND (coach_mark_step < -1 OR coach_mark_step > 12);

  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'issue #4063: found % coach_mark_step row(s) outside the reviewed old grammar -1..12; aborting semantic remap', v_invalid;
  END IF;

  UPDATE public.profiles
  SET coach_mark_step = CASE coach_mark_step
    WHEN 8 THEN 9
    WHEN 9 THEN 10
    WHEN 10 THEN 11
    WHEN 11 THEN 12
    WHEN 12 THEN 13
    ELSE coach_mark_step
  END
  WHERE coach_mark_step BETWEEN 8 AND 12;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'issue #4063: remapped % coach tour row(s) for inserted Purchases step 8', v_updated;
END
$issue_4063_purchase_coach$;

COMMENT ON COLUMN public.profiles.coach_mark_step IS
  'Consumer coach-mark tour position. One process: -1 = skipped, 0 = not started, 1..12 = in progress and resumed verbatim, 13 = completed. Source: app-mobile/src/constants/coachMarkSteps.ts and CoachMarkContext.tsx. Step-count changes require a semantic data migration, never runtime reinterpretation.';

COMMIT;
