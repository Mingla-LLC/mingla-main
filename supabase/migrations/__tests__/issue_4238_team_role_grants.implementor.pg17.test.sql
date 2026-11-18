-- Issue #4238 — team role grants (migration 20281118004238_issue_4238_team_role_grants.sql).
-- Invariant I-4238-TEAM-GRANTS: only the brand owner grants finance_manager or
-- brand_owner; nobody changes their own role or permissions; client roles
-- cannot write role / permissions_override / user_id / brand_id on
-- brand_team_members; existing client updates, accept-invite, owner hand-over
-- and member removal keep working.
--
-- MINGLA-INVARIANT: I-4238-TEAM-GRANTS | issue #4238 | Only the brand owner grants finance_manager or brand_owner, by invitation or role change; nobody changes their own role or permissions; client roles cannot write role, permissions_override, user_id or brand_id on brand_team_members.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4238-4a00-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'i4238-owner@example.test', now(), now()),
  ('00000000-4238-4a00-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'i4238-admin@example.test', now(), now()),
  ('00000000-4238-4a00-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'i4238-events@example.test', now(), now()),
  ('00000000-4238-4a00-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'i4238-finance@example.test', now(), now()),
  ('00000000-4238-4a00-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'i4238-newowner@example.test', now(), now()),
  ('00000000-4238-4a00-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'i4238-marketing@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, email, created_at)
VALUES
  ('00000000-4238-4a00-8000-000000000001', 'i4238-owner@example.test', now()),
  ('00000000-4238-4a00-8000-000000000002', 'i4238-admin@example.test', now()),
  ('00000000-4238-4a00-8000-000000000003', 'i4238-events@example.test', now()),
  ('00000000-4238-4a00-8000-000000000004', 'i4238-finance@example.test', now()),
  ('00000000-4238-4a00-8000-000000000005', 'i4238-newowner@example.test', now()),
  ('00000000-4238-4a00-8000-000000000006', 'i4238-marketing@example.test', now())
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES ('00000000-4238-4a00-8000-000000000010', '00000000-4238-4a00-8000-000000000001',
        'Issue 4238 Team Grants', 'issue4238teamgrants', now(), now());

-- Seeded as postgres (a sanctioned writer). The owner row comes from the
-- brands insert trigger; ON CONFLICT keeps the seed upsert-safe.
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at, invited_at)
VALUES
  ('00000000-4238-4a00-8000-000000000010', '00000000-4238-4a00-8000-000000000001', 'brand_owner', now(), now()),
  ('00000000-4238-4a00-8000-000000000010', '00000000-4238-4a00-8000-000000000002', 'brand_admin', now(), now()),
  ('00000000-4238-4a00-8000-000000000010', '00000000-4238-4a00-8000-000000000003', 'event_manager', now(), now())
ON CONFLICT DO NOTHING;

-- ── T0 privileges and gates exist ─────────────────────────────────────────
DO $t0$
BEGIN
  IF has_column_privilege('authenticated', 'public.brand_team_members', 'role', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.brand_team_members', 'permissions_override', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.brand_team_members', 'user_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.brand_team_members', 'brand_id', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.brand_team_members', 'INSERT')
     OR has_table_privilege('anon', 'public.brand_team_members', 'INSERT')
     OR has_table_privilege('anon', 'public.brand_team_members', 'UPDATE') THEN
    RAISE EXCEPTION 'ISSUE-4238 T0 FAIL: client roles still hold role/permission write privileges';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.brand_team_members', 'removed_at', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.brand_team_members', 'accepted_at', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.brand_team_members', 'mingla_tos_accepted_at', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.brand_team_members', 'mingla_tos_version_accepted', 'UPDATE') THEN
    RAISE EXCEPTION 'ISSUE-4238 T0 FAIL: authenticated lost UPDATE on the columns clients still write';
  END IF;
  IF has_function_privilege('anon', 'public.issue_4238_team_grant_refusal(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-4238 T0 FAIL: anon can execute the grant check';
  END IF;
  -- The rule function, as a sanctioned caller.
  IF public.issue_4238_team_grant_refusal('00000000-4238-4a00-8000-000000000010',
       '00000000-4238-4a00-8000-000000000002', 'finance_manager', 'x@example.test') IS DISTINCT FROM 'owner_only_role' THEN
    RAISE EXCEPTION 'ISSUE-4238 T0 FAIL: admin finance_manager grant not refused';
  END IF;
  IF public.issue_4238_team_grant_refusal('00000000-4238-4a00-8000-000000000010',
       '00000000-4238-4a00-8000-000000000001', 'finance_manager', 'x@example.test') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4238 T0 FAIL: owner finance_manager grant refused';
  END IF;
  IF public.issue_4238_team_grant_refusal('00000000-4238-4a00-8000-000000000010',
       '00000000-4238-4a00-8000-000000000002', 'brand_admin', 'I4238-Admin@example.test') IS DISTINCT FROM 'self_role_change' THEN
    RAISE EXCEPTION 'ISSUE-4238 T0 FAIL: self invitation not refused (case-insensitive)';
  END IF;
  RAISE NOTICE 'ISSUE-4238 T0 privileges OK';
END
$t0$;

-- ── T1 the brand admin, as a signed-in client ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-4238-4a00-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-4238-4a00-8000-000000000002","role":"authenticated"}', true);

DO $t1$
DECLARE
  v_brand uuid := '00000000-4238-4a00-8000-000000000010';
  v_admin uuid := '00000000-4238-4a00-8000-000000000002';
  v_events uuid := '00000000-4238-4a00-8000-000000000003';
  v_rows int;
  v_role text;
BEGIN
  -- T1.1 own role.
  BEGIN
    UPDATE public.brand_team_members SET role = 'brand_owner'
     WHERE brand_id = v_brand AND user_id = v_admin;
    RAISE EXCEPTION 'ISSUE-4238 T1.1 FAIL: admin changed their own role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T1.2 own permissions_override (payout / spend keys).
  BEGIN
    UPDATE public.brand_team_members
       SET permissions_override = '{"ads_spend":true,"ads_fund":true}'::jsonb
     WHERE brand_id = v_brand AND user_id = v_admin;
    RAISE EXCEPTION 'ISSUE-4238 T1.2 FAIL: admin changed their own permissions_override';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T1.3 grant finance_manager / brand_owner to another member directly.
  BEGIN
    UPDATE public.brand_team_members SET role = 'finance_manager'
     WHERE brand_id = v_brand AND user_id = v_events;
    RAISE EXCEPTION 'ISSUE-4238 T1.3 FAIL: admin set finance_manager directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.brand_team_members SET permissions_override = '{"ads_fund":true}'::jsonb
     WHERE brand_id = v_brand AND user_id = v_events;
    RAISE EXCEPTION 'ISSUE-4238 T1.3 FAIL: admin set another member''s permissions directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T1.4 point another row at a different user.
  BEGIN
    UPDATE public.brand_team_members SET user_id = v_admin
     WHERE brand_id = v_brand AND user_id = v_events;
    RAISE EXCEPTION 'ISSUE-4238 T1.4 FAIL: admin rewrote user_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T1.5 insert a member row.
  BEGIN
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
    VALUES (v_brand, '00000000-4238-4a00-8000-000000000004', 'finance_manager', now(), now());
    RAISE EXCEPTION 'ISSUE-4238 T1.5 FAIL: admin inserted a member row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- T1.6 invitations: owner-only roles refused, admin-level roles allowed.
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
    VALUES (v_brand, 'i4238-finance@example.test', 'finance_manager', v_admin, 'i4238-t16-fm', now() + interval '7 days', 'pending');
    RAISE EXCEPTION 'ISSUE-4238 T1.6 FAIL: admin invited a finance_manager';
  EXCEPTION WHEN insufficient_privilege THEN
    IF sqlerrm NOT LIKE '%owner_only_role%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
    VALUES (v_brand, 'i4238-newowner@example.test', 'brand_owner', v_admin, 'i4238-t16-bo', now() + interval '7 days', 'pending');
    RAISE EXCEPTION 'ISSUE-4238 T1.6 FAIL: admin invited a brand_owner';
  EXCEPTION WHEN insufficient_privilege THEN
    IF sqlerrm NOT LIKE '%owner_only_role%' THEN RAISE; END IF;
  END;
  INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
  VALUES
    (v_brand, 'i4238-em@example.test', 'event_manager', v_admin, 'i4238-t16-em', now() + interval '7 days', 'pending'),
    (v_brand, 'i4238-marketing@example.test', 'marketing_manager', v_admin, 'i4238-t16-mm', now() + interval '7 days', 'pending'),
    (v_brand, 'i4238-ba@example.test', 'brand_admin', v_admin, 'i4238-t16-ba', now() + interval '7 days', 'pending');

  -- T1.7 self-invitation (would change their own role on accept).
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
    VALUES (v_brand, 'I4238-ADMIN@example.test', 'event_manager', v_admin, 'i4238-t17-self', now() + interval '7 days', 'pending');
    RAISE EXCEPTION 'ISSUE-4238 T1.7 FAIL: admin invited themselves';
  EXCEPTION WHEN insufficient_privilege THEN
    IF sqlerrm NOT LIKE '%self_role_change%' THEN RAISE; END IF;
  END;
  -- T1.8 an invitation claiming another inviter.
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
    VALUES (v_brand, 'i4238-finance@example.test', 'finance_manager', '00000000-4238-4a00-8000-000000000001',
            'i4238-t18-spoof', now() + interval '7 days', 'pending');
    RAISE EXCEPTION 'ISSUE-4238 T1.8 FAIL: admin sent an invitation as the owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T1.9 rewriting a pending invitation's role or email is refused; revoking works.
  BEGIN
    UPDATE public.brand_invitations SET role = 'finance_manager' WHERE token_hash = 'i4238-t16-em';
    RAISE EXCEPTION 'ISSUE-4238 T1.9 FAIL: admin rewrote an invitation role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.brand_invitations SET email = 'someone-else@example.test' WHERE token_hash = 'i4238-t16-em';
    RAISE EXCEPTION 'ISSUE-4238 T1.9 FAIL: admin rewrote an invitation email';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.brand_invitations SET status = 'revoked', revoked_at = now() WHERE token_hash = 'i4238-t16-ba';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4238 T1.9 FAIL: admin could not revoke an invitation (% rows)', v_rows;
  END IF;

  -- T1.10 existing client updates still work: legacy removal and ToS columns.
  UPDATE public.brand_team_members
     SET mingla_tos_accepted_at = now(), mingla_tos_version_accepted = 'i4238-v1'
   WHERE brand_id = v_brand AND user_id = v_admin;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4238 T1.10 FAIL: ToS columns not writable (% rows)', v_rows;
  END IF;

  SELECT role INTO v_role FROM public.brand_team_members
   WHERE brand_id = v_brand AND user_id = v_admin AND removed_at IS NULL;
  IF v_role IS DISTINCT FROM 'brand_admin' THEN
    RAISE EXCEPTION 'ISSUE-4238 T1 FAIL: admin role is now %', v_role;
  END IF;
  RAISE NOTICE 'ISSUE-4238 T1 admin limits OK';
END
$t1$;
RESET ROLE;

-- ── T2 the owner, as a signed-in client ───────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-4238-4a00-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-4238-4a00-8000-000000000001","role":"authenticated"}', true);

DO $t2$
DECLARE
  v_brand uuid := '00000000-4238-4a00-8000-000000000010';
  v_owner uuid := '00000000-4238-4a00-8000-000000000001';
BEGIN
  -- The owner may invite a finance_manager.
  INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
  VALUES (v_brand, 'i4238-finance@example.test', 'finance_manager', v_owner, 'i4238-t2-fm', now() + interval '7 days', 'pending');
  -- Direct role writes are closed for the owner too (invitations only).
  BEGIN
    UPDATE public.brand_team_members SET role = 'finance_manager'
     WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000003';
    RAISE EXCEPTION 'ISSUE-4238 T2 FAIL: owner wrote a role directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- The owner cannot change their own role either.
  BEGIN
    UPDATE public.brand_team_members SET role = 'brand_admin'
     WHERE brand_id = v_brand AND user_id = v_owner;
    RAISE EXCEPTION 'ISSUE-4238 T2 FAIL: owner changed their own role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ISSUE-4238 T2 owner invites finance_manager OK';
END
$t2$;
RESET ROLE;

-- ── T3 service role (the invite-brand-member edge function) ───────────────
SET LOCAL ROLE service_role;
DO $t3$
DECLARE
  v_brand uuid := '00000000-4238-4a00-8000-000000000010';
BEGIN
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
    VALUES (v_brand, 'i4238-finance2@example.test', 'finance_manager', '00000000-4238-4a00-8000-000000000002',
            'i4238-t3-fm', now() + interval '7 days', 'pending');
    RAISE EXCEPTION 'ISSUE-4238 T3 FAIL: service role stored an admin-sent finance_manager invitation';
  EXCEPTION WHEN insufficient_privilege THEN
    IF sqlerrm NOT LIKE '%owner_only_role%' THEN RAISE; END IF;
  END;
  -- The owner hand-over invitation (stay: the outgoing owner becomes brand_admin).
  INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status, outgoing_disposition)
  VALUES (v_brand, 'i4238-newowner@example.test', 'brand_owner', '00000000-4238-4a00-8000-000000000001',
          'i4238-t3-bo', now() + interval '7 days', 'pending', 'stay');
  -- ToS acceptance (brand-mingla-tos-accept writes through the service role).
  UPDATE public.brand_team_members SET mingla_tos_accepted_at = now(), mingla_tos_version_accepted = 'i4238-v1'
   WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000003';
  IF NOT FOUND THEN RAISE EXCEPTION 'ISSUE-4238 T3 FAIL: service-role ToS update wrote nothing'; END IF;

  -- Accept-invite still grants the role the owner chose.
  PERFORM public.accept_invite_and_transfer_brand_ownership('i4238-t2-fm', '00000000-4238-4a00-8000-000000000004');
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                  WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000004'
                    AND role = 'finance_manager' AND accepted_at IS NOT NULL AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'ISSUE-4238 T3 FAIL: accepting the owner''s finance_manager invitation did not grant it';
  END IF;
  -- Accept an admin-sent marketing_manager invitation.
  PERFORM public.accept_invite_and_transfer_brand_ownership('i4238-t16-mm', '00000000-4238-4a00-8000-000000000006');
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                  WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000006'
                    AND role = 'marketing_manager' AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'ISSUE-4238 T3 FAIL: accepting the admin''s marketing_manager invitation did not grant it';
  END IF;
  -- Owner hand-over.
  PERFORM public.accept_invite_and_transfer_brand_ownership('i4238-t3-bo', '00000000-4238-4a00-8000-000000000005');
  IF (SELECT account_id FROM public.brands WHERE id = v_brand) <> '00000000-4238-4a00-8000-000000000005' THEN
    RAISE EXCEPTION 'ISSUE-4238 T3 FAIL: owner hand-over did not move brands.account_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                  WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000001'
                    AND role = 'brand_admin' AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'ISSUE-4238 T3 FAIL: outgoing owner (stay) is not brand_admin';
  END IF;
  RAISE NOTICE 'ISSUE-4238 T3 service role, accept and hand-over OK';
END
$t3$;
RESET ROLE;

-- ── T4 after the hand-over the old owner is an admin: owner-only roles closed ─
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-4238-4a00-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-4238-4a00-8000-000000000001","role":"authenticated"}', true);
DO $t4$
DECLARE
  v_brand uuid := '00000000-4238-4a00-8000-000000000010';
  v_rows int;
BEGIN
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
    VALUES (v_brand, 'i4238-x@example.test', 'finance_manager', '00000000-4238-4a00-8000-000000000001',
            'i4238-t4-fm', now() + interval '7 days', 'pending');
    RAISE EXCEPTION 'ISSUE-4238 T4 FAIL: former owner still invites finance_manager';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Member removal through the #3660 RPC still works for an admin.
  PERFORM public.biz_remove_brand_team_member(v_brand,
    (SELECT id FROM public.brand_team_members
      WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000006' AND removed_at IS NULL));
  IF EXISTS (SELECT 1 FROM public.brand_team_members
              WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000006' AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'ISSUE-4238 T4 FAIL: biz_remove_brand_team_member did not remove the member';
  END IF;
  -- Legacy direct soft-remove of another member (removed_at) still works.
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = v_brand AND user_id = '00000000-4238-4a00-8000-000000000003' AND removed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4238 T4 FAIL: direct removed_at update wrote % rows', v_rows;
  END IF;
  RAISE NOTICE 'ISSUE-4238 T4 former owner limits and removal OK';
END
$t4$;
RESET ROLE;

-- ── T5 the pending-invitation cleanup predicate ───────────────────────────
DO $t5$
DECLARE
  v_brand uuid := '00000000-4238-4a00-8000-000000000010';
  v_n int;
BEGIN
  -- Seeded as postgres (bypasses the gate): an admin-sent finance_manager invite.
  INSERT INTO public.brand_invitations (brand_id, email, role, invited_by, token_hash, expires_at, status)
  VALUES (v_brand, 'i4238-legacy@example.test', 'finance_manager', '00000000-4238-4a00-8000-000000000002',
          'i4238-t5-legacy', now() + interval '7 days', 'pending');
  SELECT count(*) INTO v_n FROM public.brand_invitations i
   WHERE i.status = 'pending' AND i.role IN ('finance_manager','brand_owner')
     AND public.issue_4238_team_grant_refusal(i.brand_id, i.invited_by, i.role, NULL) IS NOT NULL
     AND i.brand_id = v_brand;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4238 T5 FAIL: cleanup predicate matched % rows, expected 1', v_n;
  END IF;
  RAISE NOTICE 'ISSUE-4238 T5 cleanup predicate OK';
END
$t5$;

ROLLBACK;
