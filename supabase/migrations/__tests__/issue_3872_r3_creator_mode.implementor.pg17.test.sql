-- #3872 R3: saving a Creator profile switches Creator mode on, and a later
-- profile edit never switches it back. Before this fix nothing ever set
-- creator_profiles.mode_enabled, so a fully verified creator never reached the
-- gig board, interest, or the public profile.
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id, email) VALUES ('38720000-0000-4000-8000-0000000000c1', 'creator-mode@mingla.test');
INSERT INTO public.creator_accounts(id, email, display_name)
VALUES ('38720000-0000-4000-8000-0000000000c1', 'creator-mode@mingla.test', 'Mode Test');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claims', '{"sub":"38720000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '38720000-0000-4000-8000-0000000000c1', true);

DO $test$
DECLARE v_mode boolean;
BEGIN
  PERFORM public.creator_profile_save('Mode Test', 'Bio', NULL, ARRAY['food'], ARRAY['English'], DATE '2000-01-01', false);
  SELECT mode_enabled INTO v_mode FROM public.creator_profiles WHERE creator_account_id='38720000-0000-4000-8000-0000000000c1';
  IF v_mode IS DISTINCT FROM true THEN RAISE EXCEPTION 'saving a creator profile must switch Creator mode on (got %)', v_mode; END IF;

  UPDATE public.creator_profiles SET mode_enabled=false WHERE creator_account_id='38720000-0000-4000-8000-0000000000c1';
  PERFORM public.creator_profile_save('Mode Test 2', 'Bio', NULL, ARRAY['food'], ARRAY['English'], DATE '2000-01-01', false);
  SELECT mode_enabled INTO v_mode FROM public.creator_profiles WHERE creator_account_id='38720000-0000-4000-8000-0000000000c1';
  IF v_mode IS DISTINCT FROM false THEN RAISE EXCEPTION 'a profile edit must not override a paused Creator mode'; END IF;
END;
$test$;

ROLLBACK;
