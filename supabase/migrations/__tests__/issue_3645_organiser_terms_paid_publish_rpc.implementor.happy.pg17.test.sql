-- Issue #3645 PR11d — Organiser Terms 1.0 on paid publish (behavioral).
-- Proves:
--   * helper rejects missing version, missing accepted_at, and foreign-uid spoof
--     by authenticated callers; service_role may override p_user_id
--   * paid event publish without acceptance raises mingla_tos_not_accepted
--   * free event publish and experience draft save skip the gate
-- Every fixture is transaction-local and rolled back.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_brand   uuid := gen_random_uuid();
  v_event   uuid := gen_random_uuid();
  v_exp     uuid := gen_random_uuid();
  v_suffix  text := replace(gen_random_uuid()::text, '-', '');
  v_payload jsonb;
  v_raised  boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner), (v_other);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner), (v_other);
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_owner, 'PR11d ToS Brand', '3645-pr11d-' || v_suffix,
    'NGN', 'paystack', 'NG', 'ACCT_3645_pr11d'
  );

  -- Owner membership exists via brand-owner trigger; other has none on this brand.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- ── Helper: unaccepted → refuse ───────────────────────────────────────────
  v_raised := false;
  BEGIN
    PERFORM public.biz_require_current_organiser_terms(v_brand);
    RAISE EXCEPTION 'H1 FAIL: unaccepted helper returned';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'mingla_tos_not_accepted' THEN RAISE; END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'H1 FAIL: expected mingla_tos_not_accepted';
  END IF;

  -- Version without timestamp is not acceptance (two-part proof).
  RESET ROLE;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0',
         mingla_tos_accepted_at = NULL
   WHERE brand_id = v_brand AND user_id = v_owner;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  v_raised := false;
  BEGIN
    PERFORM public.biz_require_current_organiser_terms(v_brand);
    RAISE EXCEPTION 'H2 FAIL: version-only helper returned';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'mingla_tos_not_accepted' THEN RAISE; END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'H2 FAIL: expected mingla_tos_not_accepted for null accepted_at';
  END IF;

  -- Authenticated cannot evaluate another user's row via p_user_id.
  RESET ROLE;
  INSERT INTO public.brand_team_members (
    brand_id, user_id, role, invited_at, accepted_at,
    mingla_tos_version_accepted, mingla_tos_accepted_at
  ) VALUES (
    v_brand, v_other, 'event_manager', now(), now(), '1.0', now()
  );
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = NULL,
         mingla_tos_accepted_at = NULL
   WHERE brand_id = v_brand AND user_id = v_owner;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  v_raised := false;
  BEGIN
    PERFORM public.biz_require_current_organiser_terms(v_brand, v_other);
    RAISE EXCEPTION 'H3 FAIL: authenticated spoof via p_user_id returned';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'mingla_tos_not_accepted' THEN RAISE; END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'H3 FAIL: expected spoof to still check auth.uid()';
  END IF;

  -- service_role may override p_user_id to the accepted other member.
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'service_role')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  PERFORM public.biz_require_current_organiser_terms(v_brand, v_other);

  -- ── Paid event publish without ToS → refuse before bank/rail ──────────────
  RESET ROLE;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = NULL,
         mingla_tos_accepted_at = NULL
   WHERE brand_id = v_brand AND user_id = v_owner;
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    v_event, v_brand, 'PR11d paid draft', '3645-pr11d-paid-' || v_suffix,
    'event', 'draft', 'draft', 'UTC'
  );
  v_payload := jsonb_build_object(
    'title', 'PR11d paid',
    'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Paid', 'isFree', false, 'price', 100,
        'capacity', 10, 'availableAt', 'online')),
      'city', 'Lagos',
      'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))));
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_raised := false;
  BEGIN
    PERFORM public.business_publish_event_draft(v_event, v_payload);
    RAISE EXCEPTION 'E1 FAIL: paid publish without ToS succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'mingla_tos_not_accepted' THEN RAISE; END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'E1 FAIL: expected mingla_tos_not_accepted on paid publish';
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'E1 FAIL: paid refuse must leave draft status';
  END IF;

  -- ── Free event publish without ToS → allowed ──────────────────────────────
  v_payload := jsonb_set(
    v_payload,
    '{theme,business_draft,tickets}',
    jsonb_build_array(jsonb_build_object(
      'name', 'Free', 'isFree', true, 'price', 0,
      'capacity', 10, 'availableAt', 'online'))
  );
  PERFORM public.business_publish_event_draft(v_event, v_payload);
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'scheduled' THEN
    RAISE EXCEPTION 'E2 FAIL: free publish was gated by Organiser Terms';
  END IF;

  -- ── Experience draft save (p_publish=false) without ToS → allowed ─────────
  RESET ROLE;
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    experience_intents
  ) VALUES (
    v_exp, v_brand, 'PR11d exp draft', '3645-pr11d-exp-' || v_suffix,
    'experience', 'draft', 'draft', 'UTC', ARRAY['group-fun']::text[]
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM public.biz_publish_experience(
    v_exp,
    jsonb_build_object(
      'title', 'PR11d exp draft',
      'description', 'Draft save must skip ToS.',
      'is_free', false,
      'whole_price_cents', 5000,
      'experience_intents', jsonb_build_array('group-fun'),
      'stops', '[]'::jsonb
    ),
    false
  );
  IF (SELECT status FROM public.events WHERE id = v_exp) <> 'draft' THEN
    RAISE EXCEPTION 'X1 FAIL: draft save changed status unexpectedly';
  END IF;

  -- Accepted owner: helper passes (paid publish path then reaches rail checks).
  RESET ROLE;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0',
         mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_owner;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM public.biz_require_current_organiser_terms(v_brand);

  RAISE NOTICE '#3645 PR11d PASS: helper ACL + paid refuse + free/draft exempt';
END
$test$;

ROLLBACK;
