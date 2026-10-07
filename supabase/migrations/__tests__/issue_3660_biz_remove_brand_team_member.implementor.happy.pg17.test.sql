\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_mgr uuid := gen_random_uuid();
  v_incoming uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_member_id uuid;
  v_owner_member_id uuid;
  v_token_hash text := '3660-invite-transfer-' || replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_admin), (v_mgr), (v_incoming);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, '3660-owner@example.test'),
    (v_admin, '3660-admin@example.test'),
    (v_mgr, '3660-mgr@example.test'),
    (v_incoming, '3660-incoming@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, '3660 Remove', '3660-remove-'||replace(v_brand::text,'-',''), 'USD');

  SELECT id INTO v_owner_member_id
  FROM public.brand_team_members
  WHERE brand_id = v_brand AND user_id = v_owner AND removed_at IS NULL
  LIMIT 1;

  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES
    (v_brand, v_admin, 'brand_admin', now(), now(), NULL),
    (v_brand, v_mgr, 'event_manager', now(), now(), NULL);

  SELECT id INTO STRICT v_member_id
  FROM public.brand_team_members
  WHERE brand_id = v_brand AND user_id = v_mgr AND removed_at IS NULL;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.biz_remove_brand_team_member(v_brand, v_member_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members
    WHERE id = v_member_id AND removed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'issue_3660: admin remove did not soft-close event_manager';
  END IF;

  -- Admin cannot remove brand account owner.
  BEGIN
    PERFORM public.biz_remove_brand_team_member(v_brand, v_owner_member_id);
    RAISE EXCEPTION 'issue_3660: admin was allowed to remove brand account owner';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot_remove_brand_account%' THEN
      RAISE EXCEPTION 'issue_3660: wrong owner-remove error: %', SQLERRM;
    END IF;
  END;

  -- Direct UPDATE path is also refused for the brand account owner.
  BEGIN
    UPDATE public.brand_team_members
       SET removed_at = now()
     WHERE id = v_owner_member_id;
    RAISE EXCEPTION 'issue_3660: direct UPDATE removed brand account owner';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot_remove_brand_account%' THEN
      RAISE EXCEPTION 'issue_3660: wrong direct-update owner error: %', SQLERRM;
    END IF;
  END;

  -- Admin cannot demote brand_owner then remove (closes demote-then-remove).
  BEGIN
    UPDATE public.brand_team_members
       SET role = 'brand_admin'
     WHERE id = v_owner_member_id;
    RAISE EXCEPTION 'issue_3660: admin was allowed to demote brand_owner';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%forbidden%' THEN
      RAISE EXCEPTION 'issue_3660: wrong demotion error: %', SQLERRM;
    END IF;
  END;

  -- Authenticated hard DELETE of an accepted row is refused.
  BEGIN
    DELETE FROM public.brand_team_members
     WHERE brand_id = v_brand AND user_id = v_admin AND removed_at IS NULL;
    RAISE EXCEPTION 'issue_3660: authenticated DELETE removed accepted row';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%forbidden%' THEN
      RAISE EXCEPTION 'issue_3660: wrong accepted-DELETE error: %', SQLERRM;
    END IF;
  END;

  -- Transfer GUC lets admin_reassign soft-close the outgoing owner row.
  PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
  UPDATE public.brand_team_members
     SET removed_at = now()
   WHERE id = v_owner_member_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members
    WHERE id = v_owner_member_id AND removed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'issue_3660: transfer GUC did not allow owner soft-close';
  END IF;
  -- Clear GUC for the invite-transfer regression below.
  PERFORM set_config('app.allow_brand_owner_transfer', 'off', true);

  -- Resurrect owner row for invite-transfer proof (fresh brand_owner membership).
  UPDATE public.brand_team_members
     SET removed_at = NULL, role = 'brand_owner', accepted_at = now()
   WHERE id = v_owner_member_id;
  UPDATE public.brands SET account_id = v_owner WHERE id = v_brand;

  INSERT INTO public.brand_invitations (
    brand_id, email, role, token_hash, expires_at, status, invited_by
  ) VALUES (
    v_brand,
    '3660-incoming@example.test',
    'brand_owner',
    v_token_hash,
    now() + interval '7 days',
    'pending',
    v_owner
  );

  -- Service-role shape: no JWT. GUC must be armed inside accept_invite before demotion.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.accept_invite_and_transfer_brand_ownership(v_token_hash, v_incoming);
  IF (v_result->>'transferred')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3660: invite transfer did not report transferred';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands WHERE id = v_brand AND account_id = v_incoming
  ) THEN
    RAISE EXCEPTION 'issue_3660: invite transfer did not repoint brands.account_id';
  END IF;

  RAISE NOTICE 'issue_3660 biz_remove_brand_team_member happy PASS';
END $$;
ROLLBACK;
