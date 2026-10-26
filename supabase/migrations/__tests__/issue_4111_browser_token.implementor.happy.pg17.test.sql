-- #4111 P1-2 — "Email confirmed" is earned from the inbox, never from the
-- browser that sent the enquiry.
-- FAILS-ON-REVERT: dropping the kind check in issue_4111_thread_by_token (or
-- storing the browser token as kind 'email') raises browser_token_confirmed.
-- MINGLA-INVARIANT: I-4111-ONLY-EMAILED-TOKEN-CONFIRMS | issue #4111 | guest_email_confirmed_at is set only by a valid read of an access token of kind 'email'; a 'browser' token never confirms.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES
  ('4111b000-0000-4000-b800-000000000001', 'bt-owner@test.local', now(), '{"full_name":"Bea"}'),
  ('4111b000-0000-4000-b800-000000000002', 'bt-member@test.local', now(), '{"full_name":"Bola"}');
INSERT INTO public.profiles(id, email, first_name, last_name, display_name, username, account_type) VALUES
  ('4111b000-0000-4000-b800-000000000001', 'bt-owner@test.local', 'Bea', 'Token', 'Bea Token', 'issue4111b_owner', 'business'),
  ('4111b000-0000-4000-b800-000000000002', 'bt-member@test.local', 'Bola', 'Token', 'Bola Token', 'issue4111b_member', 'business');
INSERT INTO public.creator_accounts(id, email, display_name, business_name)
VALUES ('4111b000-0000-4000-b800-000000000001', 'bt-owner@test.local', 'Bea', 'Issue 4111 Token Host');
INSERT INTO public.brands(id, account_id, name, slug, contact_email, default_currency)
VALUES ('4111b000-0000-4000-b900-0000000000a1', '4111b000-0000-4000-b800-000000000001', 'Token Room', 'issue-4111-token-room', NULL, 'USD');
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
VALUES ('4111b000-0000-4000-b900-0000000000a1', '4111b000-0000-4000-b800-000000000002', 'marketing_manager', now());

DO $proof$
DECLARE
  v_brand constant uuid := '4111b000-0000-4000-b900-0000000000a1';
  v_emailed constant text := encode(sha256('issue-4111-emailed-token'::bytea), 'hex');
  v_browser constant text := encode(sha256('issue-4111-browser-token'::bytea), 'hex');
  v_json jsonb;
  v_enquiry uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;

  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Do you take groups of ten on Fridays?', 'Ada Test', 'ada-bt@test.local', NULL, false,
    repeat('9', 64), false, '{}'::text[], v_emailed, 'Token Room will see your name and email.', 'v1', v_browser);
  IF v_json->>'status' <> 'created' THEN RAISE EXCEPTION 'create_failed:%', v_json; END IF;
  v_enquiry := (v_json->>'enquiry_id')::uuid;

  IF (SELECT kind FROM public.brand_enquiry_access_tokens WHERE token_hash = v_emailed) IS DISTINCT FROM 'email'
     OR (SELECT kind FROM public.brand_enquiry_access_tokens WHERE token_hash = v_browser) IS DISTINCT FROM 'browser' THEN
    RAISE EXCEPTION 'token_kinds_wrong';
  END IF;

  -- The sending browser can read (and keep reading) — but never confirms.
  FOR i IN 1..2 LOOP
    v_json := public.issue_4111_thread_by_token(v_browser);
    IF v_json->>'status' <> 'ok' OR jsonb_array_length(v_json->'messages') <> 1 THEN
      RAISE EXCEPTION 'browser_token_cannot_read:%', v_json;
    END IF;
  END LOOP;
  IF (SELECT guest_email_confirmed_at FROM public.brand_enquiries WHERE id = v_enquiry) IS NOT NULL THEN
    RAISE EXCEPTION 'browser_token_confirmed';
  END IF;

  -- The browser token can also post.
  v_json := public.issue_4111_guest_post_by_token(v_browser, 'One more detail: we need a high chair.', NULL);
  IF v_json->>'status' <> 'sent' THEN RAISE EXCEPTION 'browser_token_cannot_post:%', v_json; END IF;
  IF (SELECT guest_email_confirmed_at FROM public.brand_enquiries WHERE id = v_enquiry) IS NOT NULL THEN
    RAISE EXCEPTION 'browser_post_confirmed';
  END IF;

  -- Only the emailed link confirms.
  v_json := public.issue_4111_thread_by_token(v_emailed);
  IF v_json->>'status' <> 'ok' THEN RAISE EXCEPTION 'emailed_token_cannot_read:%', v_json; END IF;
  IF (SELECT guest_email_confirmed_at FROM public.brand_enquiries WHERE id = v_enquiry) IS NULL THEN
    RAISE EXCEPTION 'emailed_token_did_not_confirm';
  END IF;

  -- An 18-argument caller (no browser token) still works and stores one emailed token.
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'A second question from another guest.', 'Bo Test', 'bo-bt@test.local', NULL, false,
    repeat('8', 64), false, '{}'::text[], encode(sha256('issue-4111-legacy'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'created'
     OR (SELECT count(*) FROM public.brand_enquiry_access_tokens WHERE enquiry_id = (v_json->>'enquiry_id')::uuid) <> 1 THEN
    RAISE EXCEPTION 'legacy_caller_broken:%', v_json;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'issue_4111 browser token: PASS';
END;
$proof$;

ROLLBACK;
