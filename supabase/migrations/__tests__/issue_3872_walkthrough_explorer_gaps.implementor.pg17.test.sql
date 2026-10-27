-- #3872 walkthrough gaps: withdraw interest, shoot window in the listing's time
-- zone, the revealed brand/place, and the public "promoting now" field.
BEGIN;

DO $test$
BEGIN
  IF to_regprocedure('public.gig_interest_withdraw(uuid)') IS NULL THEN
    RAISE EXCEPTION 'gig_interest_withdraw is missing';
  END IF;
  IF has_function_privilege('anon','public.gig_interest_withdraw(uuid)','execute') THEN
    RAISE EXCEPTION 'gig_interest_withdraw leaked to anon';
  END IF;
  IF to_regprocedure('public.issue_3872_gig_timezone(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue_3872_gig_timezone is missing';
  END IF;
  IF has_function_privilege('authenticated','public.issue_3872_gig_timezone(uuid)','execute') THEN
    RAISE EXCEPTION 'issue_3872_gig_timezone must stay internal';
  END IF;
  IF position('issue_3872_gig_timezone' IN pg_get_functiondef('public.gig_shoot_plan_save(uuid,timestamptz,text,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'shoot window is still checked in UTC';
  END IF;
  IF position('''reveal''' IN pg_get_functiondef('public.gig_contract_workspace(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'workspace does not reveal brand and place';
  END IF;
  IF position('promoting_now' IN pg_get_functiondef('public.public_creator_profile(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'public creator profile has no promoting_now';
  END IF;
  -- An event in New York: 9pm local on the last window day is 01:00 UTC the next day.
  IF ((timestamptz '2026-11-26 02:00:00+00') AT TIME ZONE 'America/New_York')::date <> date '2026-11-25' THEN
    RAISE EXCEPTION 'time zone arithmetic assumption broken';
  END IF;
END;
$test$;

ROLLBACK;
