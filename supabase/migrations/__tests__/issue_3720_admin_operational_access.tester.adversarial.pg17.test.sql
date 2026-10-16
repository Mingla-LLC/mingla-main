-- #3720 independent adversarial proof for scoped Admin operational access.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('37200000-0000-4000-a200-000000000001', 'issue3720-adversarial-active@test.local', now()),
  ('37200000-0000-4000-a200-000000000002', 'issue3720-adversarial-invited@test.local', now()),
  ('37200000-0000-4000-a200-000000000003', 'issue3720-adversarial-outsider@test.local', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3720-adversarial-active@test.local', 'growth', 'active', now()),
  ('issue3720-adversarial-invited@test.local', 'growth', 'invited', null);

INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('37200000-0000-4000-a200-000000000001', true, false, 'staff'),
  ('37200000-0000-4000-a200-000000000002', true, false, 'staff'),
  ('37200000-0000-4000-a200-000000000003', true, false, 'staff');

CREATE FUNCTION pg_temp.t3720_adversarial_call(p_user_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_result text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT public.admin_team_my_operational_areas()::text INTO v_result;
  RESET ROLE;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

DO $proof$
DECLARE v_answer text;
BEGIN
  v_answer := pg_temp.t3720_adversarial_call('37200000-0000-4000-a200-000000000001');
  IF v_answer <> '{community_support,community_support_support}'
     OR v_answer LIKE '%admin_console%' THEN
    RAISE EXCEPTION 'active_support_scope_widened:%', v_answer;
  END IF;

  IF pg_temp.t3720_adversarial_call('37200000-0000-4000-a200-000000000002') <> '{}'
     OR pg_temp.t3720_adversarial_call('37200000-0000-4000-a200-000000000003') <> '{}' THEN
    RAISE EXCEPTION 'support_grant_bypassed_active_team_requirement';
  END IF;

  UPDATE public.support_staff
     SET enabled = false
   WHERE user_id = '37200000-0000-4000-a200-000000000001';
  IF pg_temp.t3720_adversarial_call('37200000-0000-4000-a200-000000000001') <> '{}' THEN
    RAISE EXCEPTION 'support_revocation_not_immediate';
  END IF;

  UPDATE public.support_staff
     SET enabled = true
   WHERE user_id = '37200000-0000-4000-a200-000000000001';
  UPDATE public.admin_team_members
     SET status = 'revoked'
   WHERE email = 'issue3720-adversarial-active@test.local';
  IF pg_temp.t3720_adversarial_call('37200000-0000-4000-a200-000000000001') <> '{}' THEN
    RAISE EXCEPTION 'team_revocation_not_immediate';
  END IF;

  IF has_function_privilege('anon', 'public.admin_team_my_operational_areas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous_execute_available';
  END IF;
END;
$proof$;

ROLLBACK;
