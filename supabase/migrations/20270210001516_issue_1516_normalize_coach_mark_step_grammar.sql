-- Issue #1516: one coach-mark process — normalize the coach_mark_step grammar ONCE,
-- in data, so the runtime never has to guess what a stored number means.
--
-- BACKGROUND
-- `app-mobile/src/contexts/CoachMarkContext.tsx` used to carry an ORCH-0635 "legacy
-- tour" normalization branch that rewrote EVERY stored value in 1..11 to
-- TOUR_COMPLETED on EVERY provider mount. 1..11 is exactly the range the LIVE 11-step
-- tour occupies while in progress (COACH_STEP_COUNT = 11, TOUR_COMPLETED = 12), so a
-- real in-progress tour was indistinguishable from stale data and was destroyed by the
-- post-onboarding provider remount — brand-new users were stamped `coach_mark_step = 12`
-- having never seen a single coach mark. That branch is DELETED (Seth, 2026-08-03:
-- "There should be no old coach mark process, only 1"). Runtime now RESUMES 1..11
-- verbatim, which means the handful of rows carrying values from older, shorter tours
-- must be reconciled here, once, instead of at every mount.
--
-- THE GRAMMAR (the ONLY legal values from here on)
--    -1  TOUR_SKIPPED     — terminal
--     0  TOUR_NOT_STARTED — pre-start (column DEFAULT)
--    12  TOUR_COMPLETED   — terminal (= COACH_STEP_COUNT + 1)
--   1..11 in progress     — resumed verbatim on the next app launch
--
-- READ-ONLY PRODUCTION PROBE (gqnoajqerqhnvulmnyvv, 2026-08-03, 99 profiles)
--   step | users | updated_at window
--   -----+-------+--------------------------------------------------
--     -1 |    16 | 2026-06-08 21:13:05 .. 2026-08-03 17:43:27
--      0 |    53 | 2026-06-08 21:13:05 .. 2026-08-03 15:45:53
--      1 |     1 | 2026-07-17 17:16:42  <- LIVE in-progress; MUST NOT be touched
--      8 |     1 | 2026-06-01 02:37:24  <- stale, pre-expansion
--     10 |     3 | 2026-06-08 21:13:05  <- stale, pre-expansion
--     12 |    23 | 2026-06-25 04:02:08 .. 2026-08-03 17:36:53
--     13 |     3 | 2026-06-08 21:13:05  <- out of grammar; unwritable by any live code
--   => exactly 7 rows match the predicate below. 0 rows carry NULL.
--
-- WHY THE 2026-06-09 CUTOFF IS SAFE
-- The 11-step tour landed on `main` in commit 1a082b0eb on 2026-06-01 and reached the
-- public stores on 2026-06-22. `profiles.updated_at` is bumped by ANY profile write, so
-- it is only an UPPER BOUND on when coach_mark_step was last written — which is exactly
-- the direction needed here: `updated_at < cutoff` PROVES the step value predates the
-- cutoff. Every row at 8/10/13 was last written on or before 2026-06-08 21:13:05 (a bulk
-- backfill timestamp), i.e. they have not been touched in ~2 months; under the OLD code
-- their next app launch would have normalized them to 12 anyway. The single live
-- in-progress row (step 1, 2026-07-17) sits well after the cutoff and is left alone, and
-- no row created from now on can ever fall below the cutoff — so this migration stays
-- correct however long it sits before it is applied.
--
-- Idempotent: the UPDATE writes 12, which the `NOT IN (-1, 0, 12)` clause then excludes,
-- so a re-run matches zero rows.

BEGIN;

DO $issue_1516$
DECLARE
  -- TOUR_COMPLETED in CoachMarkContext.tsx == COACH_STEP_COUNT + 1 == 12.
  v_tour_completed  CONSTANT integer     := 12;
  v_tour_skipped    CONSTANT integer     := -1;
  v_tour_not_started CONSTANT integer    := 0;
  -- Anything last written before the 11-step tour could plausibly be in a user's hands.
  v_pre_expansion_cutoff CONSTANT timestamptz := TIMESTAMPTZ '2026-06-09 00:00:00+00';
  -- Fail-closed blast-radius bound. The probe found 7; the set cannot grow (new rows
  -- always have updated_at > cutoff, and > 12 / < -1 is unwritable by any live code).
  v_max_expected_rows CONSTANT integer   := 25;
  v_matched integer;
  v_updated integer;
BEGIN
  SELECT count(*) INTO v_matched
  FROM public.profiles
  WHERE coach_mark_step IS NOT NULL
    AND coach_mark_step NOT IN (v_tour_skipped, v_tour_not_started, v_tour_completed)
    AND (
          coach_mark_step > v_tour_completed          -- provably out of grammar (e.g. 13)
       OR coach_mark_step < v_tour_skipped            -- provably out of grammar
       OR updated_at < v_pre_expansion_cutoff         -- stale pre-expansion in-progress (8, 10)
    );

  IF v_matched > v_max_expected_rows THEN
    RAISE EXCEPTION 'issue #1516: coach_mark_step normalization matched % rows, above the reviewed bound of %. Re-probe the distribution before applying — the predicate must never reach a live in-progress tour.', v_matched, v_max_expected_rows;
  END IF;

  UPDATE public.profiles
  SET coach_mark_step = v_tour_completed
  WHERE coach_mark_step IS NOT NULL
    AND coach_mark_step NOT IN (v_tour_skipped, v_tour_not_started, v_tour_completed)
    AND (
          coach_mark_step > v_tour_completed
       OR coach_mark_step < v_tour_skipped
       OR updated_at < v_pre_expansion_cutoff
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'issue #1516: normalized % out-of-grammar coach_mark_step row(s) to TOUR_COMPLETED (%).',
    v_updated, v_tour_completed;
END
$issue_1516$;

-- The old comment documented a tour that has not existed since ORCH-1029/1035/1037
-- ('1-10=current step, 11=completed'), which is precisely how the grammar drifted out
-- from under the runtime. Restate it against the live constants.
COMMENT ON COLUMN "public"."profiles"."coach_mark_step" IS
  'Consumer coach-mark tour position. ONE process, ONE grammar (issue #1516): -1 = skipped (terminal), 0 = not started, 1..COACH_STEP_COUNT (currently 11) = in progress and RESUMED verbatim on the next launch, COACH_STEP_COUNT + 1 (currently 12) = completed (terminal). No other value is legal and none is reinterpreted at runtime. Source of truth: app-mobile/src/constants/coachMarkSteps.ts + app-mobile/src/contexts/CoachMarkContext.tsx. If the step count ever changes again, ship a migration alongside it — do NOT add a runtime normalization branch.';

COMMIT;
