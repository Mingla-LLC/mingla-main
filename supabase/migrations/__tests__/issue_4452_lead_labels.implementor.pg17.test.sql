\set ON_ERROR_STOP on
-- #4452 M4 lead_labels_and_calls: executable PostgreSQL 17 proof, after the full migration replay.
--
-- T-1.4a SC-20  book_call_leads has the 11 new columns; an old-shape insert still works and leaves them NULL.
-- T-1.4b SC-21  ad_conversions accepts event_type 'call_booked' and lead_label 'creator', refuses lead_label 'x'.
-- T-7.8  SC-60  (SQL half) admin_google_conversion_kinds returns ready booleans only, never a resource name;
--               admins only.
-- A1.2.3        admin_inbound_leads is unchanged by #4452 (no 'form' kind).
--
-- FAILS-ON-REVERT: restoring the old ad_conversions_event_type_check fails T-1.4b; dropping
-- lead_label's CHECK fails the 'x' refusal.

CREATE OR REPLACE FUNCTION pg_temp.ll_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 lead labels FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.ll_state(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
BEGIN EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$a$;

BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_id uuid; v_cols integer; v jsonb;
  v_admin constant uuid := '44520000-0000-4000-f000-000000000001';
  v_growth constant uuid := '44520000-0000-4000-f000-000000000002';
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'book_call_leads'
     AND column_name IN ('phone_e164','utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id',
                         'click_source','form_submission_id','lead_event_id','goal_event_id');
  PERFORM pg_temp.ll_assert(v_cols = 11, 'T-1.4a SC-20 book_call_leads has the 11 new columns');
  INSERT INTO public.book_call_leads (booking_key, name, email, venue, icp, social_platform, social_url, call_at)
  VALUES ('gcal:ll4452-old', 'Old Shape', 'old@mingla-fixture.org', 'Old Venue', 'restaurants', 'instagram', 'https://instagram.com/old', now() + interval '1 day')
  RETURNING id INTO v_id;
  PERFORM pg_temp.ll_assert((SELECT phone_e164 IS NULL AND utm_source IS NULL AND form_submission_id IS NULL AND NOT marketing_consent
                               FROM public.book_call_leads WHERE id = v_id), 'T-1.4a SC-20 an old-shape booking still inserts; the new columns are empty');
  PERFORM pg_temp.ll_assert(pg_temp.ll_state($$UPDATE public.book_call_leads SET phone_e164 = '12345' WHERE booking_key = 'gcal:ll4452-old'$$) = '23514',
    'T-1.4a a phone that is not E.164 is refused');
  PERFORM pg_temp.ll_assert(has_column_privilege('service_role', 'public.book_call_leads', 'goal_event_id', 'UPDATE'),
    'growth-tools-book can record the goal event id');
  PERFORM pg_temp.ll_assert(pg_temp.ll_state($$INSERT INTO public.ad_conversions (event_type, event_name, event_id, surface, lead_label)
      VALUES ('call_booked', 'Schedule', 'creator_call:ll4452', 'web', 'creator')$$) = 'ok', 'T-1.4b SC-21 call_booked with lead_label creator is accepted');
  PERFORM pg_temp.ll_assert(pg_temp.ll_state($$INSERT INTO public.ad_conversions (event_type, event_name, event_id, surface, lead_label)
      VALUES ('lead', 'Lead', 'lead:ll4452x', 'web', 'x')$$) = '23514', 'T-1.4b SC-21 lead_label x is refused');
  PERFORM pg_temp.ll_assert(position('''form''' IN pg_get_functiondef('public.admin_inbound_leads(boolean,integer)'::regprocedure)) = 0,
    'A1.2.3 admin_inbound_leads is unchanged (no form kind)');

  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_admin, 'll4452-admin@mingla-fixture.org', now()), (v_growth, 'll4452-growth@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('ll4452-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('ll4452-growth@mingla-fixture.org', 'growth', 'active', now());
  DELETE FROM public.ad_connections WHERE platform = 'google' AND lane = 'consumer';
  INSERT INTO public.ad_connections (platform, lane, display_name, external_account_id, auth_kind, token_env_var, extra)
  VALUES ('google', 'consumer', 'Google', '123', 'dev_token_oauth', 'GOOGLE_ADS_FIXTURE', '{"conversion_actions":{"host_lead":"customers/123/conversionActions/456"}}');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v := public.admin_google_conversion_kinds();
  PERFORM pg_temp.ll_assert((v->'kinds'->'host_lead'->>'ready')::boolean AND NOT (v->'kinds'->'creator_lead'->>'ready')::boolean
                         AND (SELECT count(*) FROM jsonb_object_keys(v->'kinds')) = 6, 'T-7.8 SC-60 host_lead Ready, the 5 new kinds not yet');
  PERFORM pg_temp.ll_assert(v::text NOT LIKE '%conversionActions%', 'T-7.8 SC-60 no resource name is returned');
  PERFORM set_config('request.jwt.claim.sub', v_growth::text, true);
  PERFORM pg_temp.ll_assert(pg_temp.ll_state($$SELECT public.admin_google_conversion_kinds()$$) = '42501', 'T-7.8 admins only');
  RESET ROLE;
END
$t$;
ROLLBACK;
