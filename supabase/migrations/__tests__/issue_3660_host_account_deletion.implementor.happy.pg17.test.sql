\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- IMPLEMENTOR happy path for public.biz_delete_host_account.
--
-- Proves (SPEC success criteria): SC-1, SC-2, SC-9, SC-12, SC-15, the partner
-- amendment's happy case (a partner with a link and no unsettled split is
-- deleted, the link is cancelled, the membership is removed) and that a second
-- call is idempotent.
--
-- No row in auth.users is deleted here: the CI database and production
-- disagree on the auth.users foreign keys, so a result that depended on them
-- would prove nothing about production.
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();        -- owns v_brand, admin on v_other_brand
  v_other_owner uuid := gen_random_uuid();  -- owns v_other_brand
  v_member uuid := gen_random_uuid();       -- team member only, owns nothing
  v_partner uuid := gen_random_uuid();      -- partner on v_other_brand
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_past_event uuid := gen_random_uuid();
  v_draft_event uuid := gen_random_uuid();
  v_link uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_brand_slug text;
  v_event_slug text;
  v_result jsonb;
  v_public json;
  v_doc jsonb;
  v_count integer;
  v_status_before text;
  v_visibility_before text;
  v_other_brand_before text;
BEGIN
  v_brand_slug := 'i3660-del-' || v_sfx;
  v_event_slug := 'i3660-evt-' || v_sfx;

  INSERT INTO auth.users(id) VALUES (v_owner), (v_other_owner), (v_member), (v_partner);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660-del-owner@example.test'),
    (v_other_owner, 'i3660-del-other@example.test'),
    (v_member, 'i3660-del-member@example.test'),
    (v_partner, 'i3660-del-partner@example.test');

  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES
    (v_brand, v_owner, 'I3660 Delete', v_brand_slug, 'USD'),
    (v_other_brand, v_other_owner, 'I3660 Other', 'i3660-oth-' || v_sfx, 'USD');
  UPDATE public.brands
     SET paystack_subaccount_code = 'ACCT_i3660_' || left(v_sfx, 10)
   WHERE id = v_brand;

  INSERT INTO public.stripe_connect_accounts
    (brand_id, stripe_account_id, country, default_currency)
  VALUES (v_brand, 'acct_i3660_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.brand_paystack_recipients
    (brand_id, recipient_code, bank_code, account_fingerprint,
     account_number_masked, account_name)
  VALUES (v_brand, 'RCP_i3660_' || left(v_sfx, 10), '000', 'hmac-sha256:' || repeat('a', 64),
          '••••0000', 'I3660 Fixture');

  -- A published, upcoming, zero-sale event; a past event; a draft.
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, visibility,
    status, timezone, location_text, is_online, city, cover_media_url,
    cover_media_type, cover_media_alt, theme, published_at)
  VALUES
    (v_event, v_brand, v_owner, 'I3660 Upcoming',
     'A published upcoming event with no tickets sold, used to prove the take-down.',
     v_event_slug, 'event', 'public', 'scheduled', 'America/New_York',
     'Downtown Durham', false, 'Durham',
     'https://images.example.test/i3660-event.jpg', 'image', 'People at the event',
     '{}', now());
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES
    (v_past_event, v_brand, v_owner, 'I3660 Past', 'i3660-past-' || v_sfx, 'scheduled'),
    (v_draft_event, v_brand, v_owner, 'I3660 Draft', 'i3660-draft-' || v_sfx, 'draft');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_event, now() + interval '5 days', now() + interval '6 days'),
    (v_past_event, now() - interval '6 days', now() - interval '5 days');

  -- Memberships on a brand none of these three users own.
  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at)
  VALUES
    (v_other_brand, v_owner, 'brand_admin', now(), now()),
    (v_other_brand, v_member, 'event_manager', now(), now()),
    (v_other_brand, v_partner, 'finance_manager', now(), now());
  INSERT INTO public.partner_brand_links
    (id, partner_account_id, brand_id, invited_owner_email, accepted_at)
  VALUES (v_link, v_partner, v_other_brand, 'i3660-del-other@example.test', now());

  SELECT status, visibility INTO v_status_before, v_visibility_before
  FROM public.events WHERE id = v_event;

  -- The public readers must resolve the event and the brand BEFORE the
  -- deletion, or "it no longer resolves" below would prove nothing.
  IF v_visibility_before IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'issue_3660 fixture: event is not public (%)', v_visibility_before;
  END IF;
  v_public := public.pg_public_event_by_slug(v_brand_slug, v_event_slug);
  IF v_public IS NULL OR v_public::text IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 'issue_3660 fixture: the event does not resolve publicly before deletion';
  END IF;
  v_doc := public.resolve_public_search_document('/e/' || v_brand_slug || '/' || v_event_slug);
  IF v_doc->>'state' IS NOT DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'issue_3660 fixture: event search document is already draft: %', v_doc;
  END IF;
  v_doc := public.resolve_public_search_document('/b/' || v_brand_slug);
  IF v_doc->>'state' IS NOT DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'issue_3660 fixture: brand search document is already draft: %', v_doc;
  END IF;
  SELECT md5(to_jsonb(b)::text) INTO v_other_brand_before
  FROM public.brands b WHERE b.id = v_other_brand;

  -- SC-12 — only the service role can run the deletion. -----------------------
  IF has_function_privilege('anon', 'public.biz_delete_host_account(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_delete_host_account(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 SC-12: anon or authenticated holds EXECUTE on biz_delete_host_account';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.biz_delete_host_account(v_owner);
    RAISE EXCEPTION 'issue_3660 SC-12: an authenticated caller ran biz_delete_host_account';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.creator_accounts WHERE id = v_owner AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-12: the refused call still stamped the account';
  END IF;

  -- The delete screen's preview RPC answers for the caller's own account.
  v_result := public.biz_my_host_account_deletion_blockers();
  IF v_result <> '[]'::jsonb THEN
    RAISE EXCEPTION 'issue_3660: preview RPC reported blockers for a zero-sale owner: %', v_result;
  END IF;

  -- Service-role shape: no subject, role claim service_role.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- SC-1 — the owner is deleted, in one call. ---------------------------------
  v_result := public.biz_delete_host_account(v_owner);
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'already_deleted')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3660 SC-1: expected status deleted, got %', v_result;
  END IF;
  IF (v_result->>'events_taken_down')::integer <> 1 THEN
    RAISE EXCEPTION 'issue_3660 SC-1: expected exactly one event taken down, got %', v_result;
  END IF;
  IF NOT (v_result->'brand_ids' @> to_jsonb(ARRAY[v_brand]))
     OR jsonb_array_length(v_result->'brand_ids') <> 1 THEN
    RAISE EXCEPTION 'issue_3660 SC-1: brand_ids is not exactly the owned brand: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = v_event AND deleted_at IS NOT NULL
      AND status = v_status_before AND visibility = v_visibility_before
  ) THEN
    RAISE EXCEPTION 'issue_3660 SC-1: upcoming event not taken down, or its status/visibility changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events
             WHERE id IN (v_past_event, v_draft_event) AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-1: a past or draft event was modified';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-1: owned brand was not soft-deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_accounts WHERE id = v_owner AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-1: creator_accounts.deleted_at was not set';
  END IF;

  v_public := public.pg_public_event_by_slug(v_brand_slug, v_event_slug);
  IF v_public IS NOT NULL AND v_public::text NOT IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 'issue_3660 SC-1: pg_public_event_by_slug still resolves the event: %', v_public;
  END IF;
  v_doc := public.resolve_public_search_document('/e/' || v_brand_slug || '/' || v_event_slug);
  IF v_doc->>'state' IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'issue_3660 SC-1: event search document state is %, expected draft', v_doc;
  END IF;
  v_doc := public.resolve_public_search_document('/b/' || v_brand_slug);
  IF v_doc->>'state' IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'issue_3660 SC-1: brand search document state is %, expected draft', v_doc;
  END IF;

  -- SC-2 — nothing is left half-done. -----------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.creator_accounts ca
    WHERE ca.id = v_owner AND ca.deleted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.brands b
                  WHERE b.account_id = ca.id AND b.deleted_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'issue_3660 SC-2: deleted account still owns a live brand';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.user_id = v_owner AND m.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.brands b
                      WHERE b.id = m.brand_id AND b.account_id = v_owner)
  ) THEN
    RAISE EXCEPTION 'issue_3660 SC-2: a live membership remains on a brand the user does not own';
  END IF;
  -- The owner's own row on their own brand stays (what a brand delete leaves).
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                 WHERE brand_id = v_brand AND user_id = v_owner AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-2: the owner row on the owned brand was removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stripe_connect_accounts
                 WHERE brand_id = v_brand AND detached_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-2: Stripe row was not detached';
  END IF;
  IF jsonb_array_length(v_result->'stripe_accounts') <> 1
     OR v_result->'stripe_accounts'->0->>'stripe_account_id' NOT LIKE 'acct_i3660_%' THEN
    RAISE EXCEPTION 'issue_3660 SC-2: stripe_accounts not returned to the caller: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_paystack_recipients
             WHERE brand_id = v_brand AND is_active) THEN
    RAISE EXCEPTION 'issue_3660 SC-2: Paystack recipient is still active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands
             WHERE id = v_brand AND paystack_subaccount_code IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-2: paystack_subaccount_code was not cleared';
  END IF;
  IF jsonb_array_length(v_result->'paystack_subaccounts') <> 1
     OR v_result->'paystack_subaccounts'->0->>'subaccount_code' NOT LIKE 'ACCT_i3660_%' THEN
    RAISE EXCEPTION 'issue_3660 SC-2: paystack_subaccounts not returned to the caller: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_log
  WHERE user_id = v_owner AND action = 'host_account.deleted'
    AND target_type = 'creator_account' AND target_id = v_owner::text;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue_3660 SC-2: expected one host_account.deleted audit row, found %', v_count;
  END IF;

  -- Idempotent second call: no second audit row, nothing re-done. --------------
  v_result := public.biz_delete_host_account(v_owner);
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'already_deleted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3660: second call was not reported as already deleted: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_log
  WHERE user_id = v_owner AND action = 'host_account.deleted';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue_3660: second call wrote another audit row (% total)', v_count;
  END IF;

  -- SC-9 — a team member who owns no brand. -----------------------------------
  v_result := public.biz_delete_host_account(v_member);
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'memberships_removed')::integer <> 1
     OR jsonb_array_length(v_result->'brand_ids') <> 0 THEN
    RAISE EXCEPTION 'issue_3660 SC-9: team-member deletion result wrong: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_team_members
             WHERE user_id = v_member AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-9: membership was not removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_accounts
                 WHERE id = v_member AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-9: member account was not marked deleted';
  END IF;

  -- Partner amendment — link and no unsettled split: deleted, link ended. -----
  v_result := public.biz_delete_host_account(v_partner);
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'partner_links_ended')::integer <> 1
     OR (v_result->>'memberships_removed')::integer <> 1 THEN
    RAISE EXCEPTION 'issue_3660 partner: deletion result wrong: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_brand_links
    WHERE id = v_link AND cancelled_at IS NOT NULL
      AND cancelled_reason = 'partner_disconnected'
  ) THEN
    RAISE EXCEPTION 'issue_3660 partner: the link was not cancelled as partner_disconnected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_team_members
             WHERE user_id = v_partner AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 partner: the partner membership was not removed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_brand_links pl
    JOIN public.brand_team_members m
      ON m.brand_id = pl.brand_id AND m.user_id = pl.partner_account_id
    WHERE pl.id = v_link AND m.removed_at = pl.cancelled_at
  ) THEN
    RAISE EXCEPTION 'issue_3660 partner: link and membership were not stamped together';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE action = 'partner_link_disconnected' AND target_id = v_link::text
      AND brand_id = v_other_brand
  ) THEN
    RAISE EXCEPTION 'issue_3660 partner: no partner_link_disconnected audit row';
  END IF;

  -- The brand those three worked on is untouched; its owner still has a row.
  IF v_other_brand_before IS DISTINCT FROM
     (SELECT md5(to_jsonb(b)::text) FROM public.brands b WHERE b.id = v_other_brand) THEN
    RAISE EXCEPTION 'issue_3660 SC-9: a brand the deleted users only worked on was modified';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                 WHERE brand_id = v_other_brand AND user_id = v_other_owner
                   AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-9: the other brand lost its owner row';
  END IF;

  -- An account that does not exist is reported, not invented. ------------------
  v_result := public.biz_delete_host_account(gen_random_uuid());
  IF v_result->>'status' IS DISTINCT FROM 'nothing_to_delete' THEN
    RAISE EXCEPTION 'issue_3660: unknown user did not return nothing_to_delete: %', v_result;
  END IF;

  -- SC-15 — clearing the stamp afterwards yields an EMPTY Host account. -------
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_owner;
  IF EXISTS (SELECT 1 FROM public.brands
             WHERE account_id = v_owner AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 SC-15: recovery brought a brand back';
  END IF;
  v_doc := public.resolve_public_search_document('/b/' || v_brand_slug);
  IF v_doc->>'state' IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'issue_3660 SC-15: brand page resolves again after recovery: %', v_doc;
  END IF;
  v_public := public.pg_public_event_by_slug(v_brand_slug, v_event_slug);
  IF v_public IS NOT NULL AND v_public::text NOT IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 'issue_3660 SC-15: event page resolves again after recovery';
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion implementor happy PASS';
END $$;
ROLLBACK;
