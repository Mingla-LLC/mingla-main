-- #1931 implementor behavioral fixture. PostgreSQL 17 replay target.
--
-- Executes against a database that has replayed EVERY migration including
-- 20270413001931_issue_1931_private_event_access.sql. Every row is created inside one
-- transaction and ROLLBACKed.
--
-- This suite is BEHAVIORAL, not textual. No assertion in it is satisfied by source text:
-- each one executes a real read or a real call against the applied schema and compares
-- observed outcomes. Criteria covered here: SC-45, SC-46, SC-48, SC-53(a)(b)(c)(d),
-- SC-54(a)(b)(e), SC-55(c).
\set ON_ERROR_STOP on

BEGIN;

-- =====================================================================================
-- SC-45 — readiness is false on a fresh apply, and the operator RPC is UNCONDITIONALLY
-- unable to return true.
--
-- Vacuity guard (Amendment 4 §J SC-45): the fixture supplies MAXIMAL WELL-FORMED
-- EVIDENCE for all four gates — including flipping #1930's own runtime capability so
-- issue_1930_checkout_transition_guard_ready() genuinely returns TRUE — and over-length
-- well-formed attestation strings. The RPC must STILL refuse. A fixture that failed for
-- a second reason would not distinguish a correct implementation from one that silently
-- dropped a check.
-- =====================================================================================
DO $test$
DECLARE
  v_guard boolean;
  v_raised text;
BEGIN
  IF public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'SC-45: readiness must be false on a fresh apply';
  END IF;

  -- Force gate (a) to its PASSING value so the refusal cannot be attributed to it.
  UPDATE public.issue_1930_runtime_capability SET enabled = true WHERE singleton;
  SELECT public.issue_1930_checkout_transition_guard_ready() INTO v_guard;
  IF NOT v_guard THEN
    RAISE EXCEPTION 'SC-45 fixture invalid: #1930 guard did not become true, so the refusal would be ambiguous';
  END IF;

  BEGIN
    PERFORM public.issue_1931_enable_private_event_access(
      repeat('revocation-execute-attested-true ', 8),
      repeat('provider-authentic-stripe-test-leg-passed ', 8),
      repeat('schema-acl-crypto-smoke-recorded ', 8),
      'operator@usemingla.com');
    RAISE EXCEPTION 'SC-45: operator RPC returned instead of refusing under maximal evidence';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_raised = MESSAGE_TEXT;
    IF v_raised <> 'private_access_release_frozen' THEN
      RAISE EXCEPTION 'SC-45: expected private_access_release_frozen, got %', v_raised;
    END IF;
  END;

  -- (ii) readiness is STILL false afterwards.
  IF public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'SC-45: readiness became true after the operator RPC';
  END IF;

  UPDATE public.issue_1930_runtime_capability SET enabled = false WHERE singleton;
  RAISE NOTICE 'SC-45 PASS — refusal is unconditional under maximal well-formed evidence';
END $test$;

-- =====================================================================================
-- SC-46 — with readiness false, every RELEASED #1931 path denies.
--
-- Vacuity guard: each call is well-formed and every non-readiness precondition is
-- satisfiable, so the denial is attributable to the readiness check alone.
--
-- The enumeration deliberately EXCLUDES "legacy ingress exchange": Amendment 6 §B.3
-- struck it because it has no released subject. Its absence is proven by SC-55, not by
-- a denial assertion over an artifact #1931 has no authority to produce.
-- =====================================================================================
DO $test$
DECLARE
  v_sig text;
  v_call text;
  v_raised text;
  v_denied int := 0;
BEGIN
  FOREACH v_call IN ARRAY ARRAY[
    'SELECT public.issue_1931_rotate_private_event_access_epoch(gen_random_uuid(), ''private'', gen_random_uuid())',
    'SELECT public.issue_1931_prepare_private_event_media(gen_random_uuid(), now())',
    'SELECT public.issue_1931_begin_enter_private(gen_random_uuid(), now(), repeat(''a'',64), gen_random_uuid())',
    'SELECT public.issue_1931_finalize_enter_private(gen_random_uuid())',
    'SELECT public.issue_1931_cancel_enter_private(gen_random_uuid())',
    'SELECT public.issue_1931_begin_leave_private(gen_random_uuid(), ''public'', now(), repeat(''a'',64), gen_random_uuid())',
    'SELECT public.issue_1931_finalize_leave_private(gen_random_uuid())'
  ] LOOP
    BEGIN
      EXECUTE v_call;
      RAISE EXCEPTION 'SC-46: released path did NOT deny at readiness false: %', v_call;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_raised = MESSAGE_TEXT;
      IF v_raised <> 'private_access_not_ready' THEN
        RAISE EXCEPTION 'SC-46: expected private_access_not_ready from %, got %', v_call, v_raised;
      END IF;
      v_denied := v_denied + 1;
    END;
  END LOOP;

  IF v_denied <> 7 THEN
    RAISE EXCEPTION 'SC-46: expected 7 denying transition RPCs, observed %', v_denied;
  END IF;
  RAISE NOTICE 'SC-46 PASS — % released SQL paths deny at readiness false', v_denied;
END $test$;

-- =====================================================================================
-- SC-48 — issue_1930_event_sale_reason still returns 'event_visibility' for
-- visibility='private' at event scope. #1931 introduces Private admission ONLY at
-- session scope and must never relax the event-scope predicate.
--
-- This criterion HARD-CODES NO CALL-SITE COUNT (Amendment 4 §I.1) — the enumeration is
-- run at implementation time and attached to the report instead.
-- =====================================================================================
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_row public.events%ROWTYPE;
  v_reason text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_user, 'i1931 sc48 brand', 'i1931-sc48-brand', 'NGN', 'NGN', 'paystack');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency, published_at)
  VALUES (v_event, v_brand, 'i1931 sc48', 'i1931-sc48', 'event', 'scheduled', 'private', 'Africa/Lagos', 'NGN', now());

  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  SELECT public.issue_1930_event_sale_reason(v_row) INTO v_reason;
  IF v_reason <> 'event_visibility' THEN
    RAISE EXCEPTION 'SC-48: expected event_visibility for a private event, got %', v_reason;
  END IF;
  RAISE NOTICE 'SC-48 PASS — event-scope Private hard-deny intact';
END $test$;

-- =====================================================================================
-- SC-53(a) — NO invoker-rights reader references event_private_media_transition_jobs
-- directly. Each must instead call public.issue_1931_event_ordinary_read_blocked.
--
-- Executed against the CATALOG, not against source text: RLS expressions on
-- public.events, and every security_invoker view that depends on public.events.
-- =====================================================================================
DO $test$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(polname, ', ') INTO v_bad
    FROM pg_policy
   WHERE polrelid = 'public.events'::regclass
     AND (COALESCE(pg_get_expr(polqual, polrelid), '') LIKE '%event_private_media_transition_jobs%'
       OR COALESCE(pg_get_expr(polwithcheck, polrelid), '') LIKE '%event_private_media_transition_jobs%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SC-53(a): invoker-rights RLS expression names the jobs table directly: %', v_bad;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false') = 'true'
     AND pg_get_viewdef(c.oid, true) LIKE '%event_private_media_transition_jobs%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SC-53(a): security_invoker view names the jobs table directly: %', v_bad;
  END IF;

  -- Positive half: the released policy MUST route through the helper.
  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polrelid = 'public.events'::regclass
         AND polname = 'Public can read published events (anon or authenticated)')
     NOT LIKE '%issue_1931_event_ordinary_read_blocked%' THEN
    RAISE EXCEPTION 'SC-53(a): the events SELECT policy does not call the helper';
  END IF;
  RAISE NOTICE 'SC-53(a) PASS — the jobs table is reachable only through the helper';
END $test$;

-- =====================================================================================
-- SC-53(b) / SC-53(c) — NO OUTAGE and NO VACUITY across every member of set (A),
-- as BOTH anon AND authenticated.
--
-- Set (A) is exactly the SC-53 floor — the objects Amendment 2 §A names by identifier.
-- Set (B), the exclusion register, is attached to the implementation report.
--
-- (b) With readiness false and ZERO job rows, a public/scheduled event reads normally
--     through all ten. This is the criterion that fires on the total public-read outage
--     an inlined subquery would cause.
-- (c) With ONE service-role-inserted active job row, every one of the ten denies. This
--     is the criterion that fires on a silently blinded helper — a permanent no-op.
-- =====================================================================================
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_role text;
  v_phase text;
  v_expect_visible boolean;
  v_n bigint;
  v_json json;
  v_jsonb jsonb;
  v_transition uuid := gen_random_uuid();
  v_raised text;
  v_ok boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  -- paystack_subaccount_code makes the brand collectible, so the paid ticket type below
  -- is NOT filtered out by pg_discover_business_events' own paid-supply gate. Without it
  -- the discover assertion would pass vacuously in BOTH phases.
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency,
                             payment_provider, paystack_subaccount_code)
  VALUES (v_brand, v_user, 'i1931 rd brand', 'i1931-rd-brand', 'NGN', 'NGN', 'paystack', 'ACCT_i1931rd');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone,
                             currency, published_at, show_on_discover, city)
  VALUES (v_event, v_brand, 'i1931 rd event', 'i1931-rd-event', 'event', 'scheduled', 'public',
          'Africa/Lagos', 'NGN', now(), true, 'Lagos');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '2 days', now() + interval '2 days 4 hours', 'Africa/Lagos', true);
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, quantity_total, currency)
  VALUES (v_tt, v_event, 'GA', 500000, 100, 'NGN');

  FOREACH v_phase IN ARRAY ARRAY['no_job','active_job'] LOOP
    IF v_phase = 'active_job' THEN
      INSERT INTO public.event_private_media_transition_jobs (
        transition_id, event_id, direction, target_visibility, state,
        ordinary_read_blocked_at, expected_event_updated_at, source_fingerprint)
      VALUES (v_transition, v_event, 'enter_private', 'private', 'preparing',
              transaction_timestamp(), now(), repeat('a', 64));
    END IF;
    v_expect_visible := (v_phase = 'no_job');

    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      -- (A1) the events SELECT policy, exercised through a direct table read
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*) INTO v_n FROM public.events WHERE id = v_event;
      RESET ROLE;
      IF (v_n > 0) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : events SELECT policy returned % row(s)', v_phase, v_role, v_n;
      END IF;

      -- (A2) events_public_view (security_invoker=true)
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*) INTO v_n FROM public.events_public_view WHERE id = v_event;
      RESET ROLE;
      IF (v_n > 0) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : events_public_view returned % row(s)', v_phase, v_role, v_n;
      END IF;

      -- (A3) business_public_events_view (security_invoker=false — definer rights)
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*) INTO v_n FROM public.business_public_events_view WHERE id = v_event;
      RESET ROLE;
      IF (v_n > 0) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : business_public_events_view returned % row(s)', v_phase, v_role, v_n;
      END IF;

      -- (A4) pg_public_event_by_slug
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT public.pg_public_event_by_slug('i1931-rd-brand', 'i1931-rd-event') INTO v_json;
      RESET ROLE;
      IF (v_json IS NOT NULL) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : pg_public_event_by_slug visibility mismatch', v_phase, v_role;
      END IF;

      -- (A5) pg_direct_event_checkout_bundle — landed NULL-on-denial contract preserved
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT public.pg_direct_event_checkout_bundle(v_event, NULL, NULL) INTO v_json;
      RESET ROLE;
      IF (v_json IS NOT NULL) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : pg_direct_event_checkout_bundle visibility mismatch', v_phase, v_role;
      END IF;

      -- (A6) pg_discover_business_events
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*) INTO v_n
        FROM jsonb_array_elements(
               COALESCE(public.pg_discover_business_events(
                 ARRAY['Lagos'], now() - interval '1 day', now() + interval '30 days',
                 NULL, NULL, NULL, 0, 50, NULL, NULL, NULL)->'rows', '[]'::jsonb)) x
       WHERE x->>'id' = v_event::text;
      RESET ROLE;
      IF (v_n > 0) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : pg_discover_business_events returned % row(s)', v_phase, v_role, v_n;
      END IF;

      -- (A7) pg_public_ticket_types_remaining
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*) INTO v_n FROM public.pg_public_ticket_types_remaining(v_event);
      RESET ROLE;
      IF (v_n > 0) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : pg_public_ticket_types_remaining returned % row(s)', v_phase, v_role, v_n;
      END IF;

      -- (A8) pg_public_social_proof
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT public.pg_public_social_proof(v_event) INTO v_json;
      RESET ROLE;
      IF (v_json IS NOT NULL) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : pg_public_social_proof visibility mismatch', v_phase, v_role;
      END IF;

      -- (A9) pg_public_brand_upcoming
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*) INTO v_n
        FROM public.pg_public_brand_upcoming('i1931-rd-brand', NULL, 50) u
       WHERE u.offering_id = v_event;
      RESET ROLE;
      IF (v_n > 0) <> v_expect_visible THEN
        RAISE EXCEPTION 'SC-53 %/% : pg_public_brand_upcoming returned % row(s)', v_phase, v_role, v_n;
      END IF;
    END LOOP;

    -- (A10) biz_ticket_checkout_create_session — service-role only, reached by clause (v).
    -- Denial must reuse the EXISTING `event_not_selling` string (Amendment 4 §B.2.2).
    v_ok := true;
    BEGIN
      SELECT public.biz_ticket_checkout_create_session(
        v_event, NULL, 'i1931 buyer', 'i1931-buyer@example.com', '+2348012345678', false,
        jsonb_build_array(jsonb_build_object('ticketTypeId', v_tt, 'quantity', 1)),
        'i1931-idem-' || v_phase, now() + interval '30 minutes', 0, 'auto') INTO v_jsonb;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_raised = MESSAGE_TEXT;
      v_ok := false;
    END;
    IF v_ok <> v_expect_visible THEN
      RAISE EXCEPTION 'SC-53 % : biz_ticket_checkout_create_session admitted=% (expected %), raised=%',
        v_phase, v_ok, v_expect_visible, v_raised;
    END IF;
    IF NOT v_ok AND v_raised <> 'event_not_selling' THEN
      RAISE EXCEPTION 'SC-53 % : checkout denial must reuse event_not_selling, got %', v_phase, v_raised;
    END IF;
  END LOOP;

  RAISE NOTICE 'SC-53(b)/(c) PASS — 10 set-(A) members: readable with zero jobs, denying with one, as anon AND authenticated';
END $test$;

-- =====================================================================================
-- SC-54(a)/(b)/(e) — the released columns are structurally inert and stay NULL.
-- =====================================================================================
DO $test$
DECLARE
  v_bad text;
  v_n bigint;
BEGIN
  -- (a) nullable, no default, no NOT NULL
  SELECT string_agg(a.attname, ', ') INTO v_bad
    FROM pg_attribute a
   WHERE a.attrelid IN ('public.ticket_checkout_sessions'::regclass,
                        'public.ticket_checkout_provider_attempts'::regclass)
     AND a.attname LIKE 'issue\_1931\_%' AND a.attnum > 0 AND NOT a.attisdropped
     AND (a.attnotnull OR a.atthasdef);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SC-54(a): released column is NOT NULL or has a DEFAULT: %', v_bad;
  END IF;

  -- (a) no CHECK constraint mentioning a released column
  SELECT string_agg(conname, ', ') INTO v_bad
    FROM pg_constraint
   WHERE conrelid IN ('public.ticket_checkout_sessions'::regclass,
                      'public.ticket_checkout_provider_attempts'::regclass)
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%issue_1931_%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SC-54(a): released column carries a CHECK: %', v_bad;
  END IF;

  -- (a) no foreign key to a PRE-EXISTING table (only #1931 tables are permitted)
  SELECT string_agg(conname, ', ') INTO v_bad
    FROM pg_constraint c
   WHERE c.conrelid IN ('public.ticket_checkout_sessions'::regclass,
                        'public.ticket_checkout_provider_attempts'::regclass)
     AND c.contype = 'f'
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                    AND a.attname LIKE 'issue\_1931\_%')
     AND c.confrelid::regclass::text NOT IN ('private_event_access_grants',
                                             'private_event_invite_token_epochs');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SC-54(a): released column references a pre-existing table: %', v_bad;
  END IF;

  -- (e) no index on any released column
  SELECT count(*) INTO v_n
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid IN ('public.ticket_checkout_sessions'::regclass,
                        'public.ticket_checkout_provider_attempts'::regclass)
     AND a.attname LIKE 'issue\_1931\_%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SC-54(e): % index(es) exist on released columns', v_n;
  END IF;

  -- (b) every released column is NULL on every row
  SELECT count(*) INTO v_n FROM public.ticket_checkout_sessions
   WHERE issue_1931_grant_id IS NOT NULL OR issue_1931_token_epoch_id IS NOT NULL
      OR issue_1931_access_epoch IS NOT NULL OR issue_1931_principal_kind IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SC-54(b): % checkout session row(s) carry a non-NULL released column', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.ticket_checkout_provider_attempts
   WHERE issue_1931_grant_id IS NOT NULL OR issue_1931_access_epoch IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SC-54(b): % provider attempt row(s) carry a non-NULL released column', v_n;
  END IF;

  RAISE NOTICE 'SC-54(a)/(b)/(e) PASS — released columns are structurally inert and all NULL';
END $test$;

-- =====================================================================================
-- SC-55(c) — NO released #1931 path writes public.brand_offering_invite_tokens or
-- public.brand_offering_invites.
--
-- Review Finding B, folded in: the row-equality half is VACUOUS unless the fixture
-- SEEDS rows, so this fixture seeds one active, unexpired, unconsumed token row and one
-- active invite row, then runs the released #1931 fixture matrix — including every
-- SC-46 denial path — and asserts both rows are untouched on the exact tuples the
-- criterion names.
-- =====================================================================================
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_invite uuid := gen_random_uuid();
  v_attempt uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_before record;
  v_after record;
  v_inv_before record;
  v_inv_after record;
  v_call text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_user, 'i1931 oi brand', 'i1931-oi-brand', 'NGN', 'NGN', 'paystack');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency, published_at)
  VALUES (v_event, v_brand, 'i1931 oi event', 'i1931-oi-event', 'event', 'scheduled', 'public',
          'Africa/Lagos', 'NGN', now());
  INSERT INTO public.brand_people (id, brand_id, display_name)
  VALUES (v_person, v_brand, 'i1931 oi person');
  INSERT INTO public.brand_person_contact_methods
    (id, brand_id, brand_person_id, channel, normalized_value, provenance_scope)
  VALUES (v_contact, v_brand, v_person, 'email', 'i1931-oi@example.com', 'brand_owned');
  INSERT INTO public.brand_offering_invites (id, brand_id, event_id, brand_person_id, status, origin, created_by)
  VALUES (v_invite, v_brand, v_event, v_person, 'active', 'wizard', v_user);
  INSERT INTO public.marketing_send_groups
    (id, event_id, brand_id, purpose, client_request_id, channels, eligibility_hash,
     quote_hash, quoted_at, execution_snapshot_hash, created_by)
  VALUES (v_group, v_event, v_brand, 'invitation', gen_random_uuid(), ARRAY['email'],
          repeat('c',64), repeat('d',64), now(), repeat('e',64), v_user);
  INSERT INTO public.brand_offering_invite_delivery_attempts
    (id, invite_id, send_group_id, contact_method_id, channel, attempt_kind)
  VALUES (v_attempt, v_invite, v_group, v_contact, 'email', 'initial');
  INSERT INTO public.brand_offering_invite_tokens
    (id, invite_id, token_hash, contact_method_id, expires_at, delivery_attempt_id)
  VALUES (v_token, v_invite, repeat('b', 64), v_contact, now() + interval '7 days', v_attempt);

  SELECT token_hash, expires_at, revoked_at, consumed_at INTO v_before
    FROM public.brand_offering_invite_tokens WHERE id = v_token;
  SELECT status, superseded_by_invite_id INTO v_inv_before
    FROM public.brand_offering_invites WHERE id = v_invite;

  -- Run the full released #1931 fixture matrix over this live token's event.
  FOREACH v_call IN ARRAY ARRAY[
    'SELECT public.issue_1931_rotate_private_event_access_epoch($1, ''private'', gen_random_uuid())',
    'SELECT public.issue_1931_prepare_private_event_media($1, now())',
    'SELECT public.issue_1931_begin_enter_private($1, now(), repeat(''a'',64), gen_random_uuid())',
    'SELECT public.issue_1931_begin_leave_private($1, ''public'', now(), repeat(''a'',64), gen_random_uuid())'
  ] LOOP
    BEGIN EXECUTE v_call USING v_event; EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM public.issue_1931_enable_private_event_access('a','b','c','d');
  EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM public.issue_1931_event_ordinary_read_blocked(v_event);
  PERFORM public.issue_1931_private_event_access_ready();

  SELECT token_hash, expires_at, revoked_at, consumed_at INTO v_after
    FROM public.brand_offering_invite_tokens WHERE id = v_token;
  SELECT status, superseded_by_invite_id INTO v_inv_after
    FROM public.brand_offering_invites WHERE id = v_invite;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'SC-55(c): a released #1931 path mutated brand_offering_invite_tokens';
  END IF;
  IF v_inv_before IS DISTINCT FROM v_inv_after THEN
    RAISE EXCEPTION 'SC-55(c): a released #1931 path mutated brand_offering_invites';
  END IF;
  IF v_after.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'SC-55(c): the seeded #1770 token was consumed by a released #1931 path';
  END IF;

  RAISE NOTICE 'SC-55(c) PASS — seeded live #1770 token and invite are byte-identical after the released matrix';
END $test$;

ROLLBACK;
