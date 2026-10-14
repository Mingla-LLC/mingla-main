\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_ticket uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_text_question uuid := gen_random_uuid();
  v_schema_version uuid := gen_random_uuid();
  v_upload_session uuid := gen_random_uuid();
  v_retry_upload_session uuid := gen_random_uuid();
  v_attempt uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_unselected_claim uuid := gen_random_uuid();
  v_retry_claim_a uuid := gen_random_uuid();
  v_retry_claim_b uuid := gen_random_uuid();
  v_limit_claim uuid := gen_random_uuid();
  v_replacement_claim uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_other_session uuid := gen_random_uuid();
  v_legacy_session uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_key text;
  v_legacy_key text;
  v_lines jsonb;
  v_intake jsonb;
  v_legacy_intake jsonb;
  v_sanitized jsonb;
  v_mint jsonb;
  v_conflict boolean := false;
  v_wrong_upload_session boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO auth.users(id, email)
  VALUES (v_owner, 'issue-3859-intake-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3859-intake-' || v_owner || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3859 intake', 'issue-3859-intake-' || v_brand,
    'USD', 'stripe', 'US', 'US', 'USD'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency
  ) VALUES (
    v_event, v_brand, v_owner, 'Issue 3859 intake trip',
    'issue-3859-intake-trip-' || v_event, 'trip', 'scheduled', 'public', 'UTC', 'USD'
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person
  ) VALUES (
    v_ticket, v_event, 'Standard', 10000, 'USD', false, 20, 1, true, false
  );
  INSERT INTO public.trip_intake_schemas(
    event_id, ticket_type_id, schema, schema_version_id
  ) VALUES (
    v_event, v_ticket,
    jsonb_build_object(
      'schema_version_id', v_schema_version,
      'questions', jsonb_build_array(
        jsonb_build_object(
          'id', v_question, 'type', 'file_upload', 'label', 'Passport',
          'required', false, 'position', 0, 'max_files', 1,
          'allow_images', true, 'allow_pdfs', true, 'allow_docs', false
        ),
        jsonb_build_object(
          'id', v_text_question, 'type', 'short_text', 'label', 'Meal preference',
          'required', true, 'position', 1
        )
      )
    ),
    v_schema_version
  );

  v_key := 'ticket_checkout:v2:' || v_event || ':' || v_attempt;
  v_legacy_key := 'ticket_checkout:legacy:' || v_event || ':' || gen_random_uuid();
  v_lines := jsonb_build_array(jsonb_build_object(
    'ticketTypeId', v_ticket, 'quantity', 1, 'paymentPlanChoice', 'full'
  ));
  v_intake := jsonb_build_array(jsonb_build_object(
    'ticket_type_id', v_ticket,
    'schema_version_id', v_schema_version,
    'answers', jsonb_build_object(
      v_question::text,
      jsonb_build_array(jsonb_build_object(
        'claim_id', v_claim,
        'mime_type', 'application/pdf',
        'size_bytes', 8,
        'expires_at', now() + interval '1 hour'
      )),
      v_text_question::text, 'Vegetarian'
    )
  ));
  v_legacy_intake := jsonb_build_array(jsonb_build_object(
    'ticket_type_id', v_ticket,
    'schema_version_id', v_schema_version,
    'answers', jsonb_build_object(v_text_question::text, 'Window seat')
  ));

  -- A failed PUT/accept does not occupy the file limit. The next mint retires
  -- only the prior issued attempt in the same exact draft/question scope.
  SELECT public.issue_3859_mint_intake_upload_claim(
    v_retry_claim_a, v_retry_upload_session, v_owner, v_event, v_ticket,
    v_question, v_schema_version,
    v_event || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf',
    '.pdf', 'application/pdf', 8, NULL, now() + interval '1 hour', 1
  ) INTO v_mint;
  IF (v_mint->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T-00A FAIL: initial upload claim did not mint: %', v_mint;
  END IF;
  SELECT public.issue_3859_mint_intake_upload_claim(
    v_retry_claim_b, v_retry_upload_session, v_owner, v_event, v_ticket,
    v_question, v_schema_version,
    v_event || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf',
    '.pdf', 'application/pdf', 8, NULL, now() + interval '1 hour', 1
  ) INTO v_mint;
  IF (v_mint->>'ok')::boolean IS DISTINCT FROM true OR
     jsonb_array_length(v_mint->'orphaned_paths') <> 1 OR
     (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_retry_claim_a) <> 'orphaned' OR
     (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_retry_claim_b) <> 'issued' THEN
    RAISE EXCEPTION 'T-00B FAIL: unaccepted retry remained blocked: %', v_mint;
  END IF;

  PERFORM public.issue_3859_accept_intake_upload_claim(
    v_retry_claim_b, v_retry_upload_session, v_owner,
    'application/pdf', 8, repeat('c', 64)
  );
  SELECT public.issue_3859_mint_intake_upload_claim(
    v_limit_claim, v_retry_upload_session, v_owner, v_event, v_ticket,
    v_question, v_schema_version,
    v_event || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf',
    '.pdf', 'application/pdf', 8, NULL, now() + interval '1 hour', 1
  ) INTO v_mint;
  IF v_mint->>'error' IS DISTINCT FROM 'upload_limit_reached' OR
     EXISTS (SELECT 1 FROM public.trip_intake_upload_claims WHERE id = v_limit_claim) OR
     (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_retry_claim_b) <> 'accepted' THEN
    RAISE EXCEPTION 'T-00C FAIL: accepted claim did not hold the limit: %', v_mint;
  END IF;
  SELECT public.issue_3859_mint_intake_upload_claim(
    v_replacement_claim, v_retry_upload_session, v_owner, v_event, v_ticket,
    v_question, v_schema_version,
    v_event || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf',
    '.pdf', 'application/pdf', 8, v_retry_claim_b,
    now() + interval '1 hour', 1
  ) INTO v_mint;
  IF (v_mint->>'ok')::boolean IS DISTINCT FROM true OR
     (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_retry_claim_b) <> 'accepted' OR
     (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_replacement_claim) <> 'issued' THEN
    RAISE EXCEPTION 'T-00D FAIL: explicit replacement mint was not allowed: %', v_mint;
  END IF;

  INSERT INTO public.trip_intake_upload_claims(
    id, upload_session_id, buyer_user_id, event_id, ticket_type_id,
    question_id, schema_version_id, object_path, file_extension,
    declared_mime_type, declared_size_bytes, verified_mime_type,
    verified_size_bytes, content_sha256, state, expires_at, accepted_at
  ) VALUES
    (
      v_claim, v_upload_session, v_owner, v_event, v_ticket,
      v_question, v_schema_version,
      v_event || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf',
      '.pdf', 'application/pdf', 8, 'application/pdf', 8, repeat('a', 64),
      'accepted', now() + interval '1 hour', now()
    ),
    (
      v_unselected_claim, v_upload_session, v_owner, v_event, v_ticket,
      v_question, v_schema_version,
      v_event || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf',
      '.pdf', 'application/pdf', 8, 'application/pdf', 8, repeat('b', 64),
      'accepted', now() + interval '1 hour', now()
    );

  -- Pre-session canonicalization is read-only. A simulated checkout-session
  -- refusal cannot strand the accepted claim.
  PERFORM public.issue_3859_prepare_intake_upload_claims(
    v_event, v_owner, v_upload_session, v_key, v_attempt, v_lines, v_intake
  );
  BEGIN
    RAISE EXCEPTION 'simulated_session_rpc_failure';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_claim) <> 'accepted' THEN
    RAISE EXCEPTION 'T-01 FAIL: refused checkout stranded the claim';
  END IF;

  INSERT INTO public.ticket_checkout_sessions(
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email,
    buyer_phone_e164, marketing_opt_in, subtotal_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at
  ) VALUES
    (
      v_session, v_event, v_brand, v_owner, 'Buyer', 'buyer@example.test',
      '+15555550123', false, 10000, 10000, 'USD', 'requires_payment',
      v_key, 'legacy', now() + interval '15 minutes'
    ),
    (
      v_other_session, v_event, v_brand, v_owner, 'Buyer', 'buyer@example.test',
      '+15555550123', false, 10000, 10000, 'USD', 'requires_payment',
      v_key || ':other', 'legacy', now() + interval '15 minutes'
    ),
    (
      v_legacy_session, v_event, v_brand, v_owner, 'Buyer', 'buyer@example.test',
      '+15555550123', false, 10000, 10000, 'USD', 'requires_payment',
      v_legacy_key, 'legacy', now() + interval '15 minutes'
    );

  -- Released clients did not send an upload-session id. The edge supplies a
  -- fresh private UUID: text/date/choice intake has zero claims and succeeds.
  SELECT public.issue_3859_attach_intake_snapshot(
    v_legacy_session, v_event, v_owner, gen_random_uuid(), v_legacy_key, NULL,
    v_lines, v_legacy_intake
  ) INTO v_sanitized;
  IF v_sanitized::text NOT LIKE '%Window seat%' OR
     (SELECT claim_count FROM public.ticket_checkout_intake_snapshots
      WHERE checkout_session_id = v_legacy_session) <> 0 THEN
    RAISE EXCEPTION 'T-01A FAIL: legacy non-file intake was refused: %', v_sanitized;
  END IF;

  -- The same fallback UUID cannot authorize an actual file claim. The exact
  -- upload draft remains mandatory and the accepted claim stays retryable.
  BEGIN
    PERFORM public.issue_3859_attach_intake_snapshot(
      v_session, v_event, v_owner, gen_random_uuid(), v_key, v_attempt,
      v_lines, v_intake
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_wrong_upload_session := SQLERRM = 'intake_upload_claim_invalid';
  END;
  IF NOT v_wrong_upload_session OR
     (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_claim) <> 'accepted' OR
     EXISTS (SELECT 1 FROM public.ticket_checkout_intake_snapshots
             WHERE checkout_session_id = v_session) THEN
    RAISE EXCEPTION 'T-01B FAIL: file claim accepted without its exact upload session';
  END IF;

  SELECT public.issue_3859_attach_intake_snapshot(
    v_session, v_event, v_owner, v_upload_session, v_key, v_attempt,
    v_lines, v_intake
  ) INTO v_sanitized;
  IF (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_claim) <> 'claimed'
     OR (SELECT checkout_session_id FROM public.trip_intake_upload_claims WHERE id = v_claim) <> v_session
     OR (SELECT state FROM public.trip_intake_upload_claims WHERE id = v_unselected_claim) <> 'accepted'
     OR v_sanitized::text LIKE '%' || v_claim || '%'
     OR v_sanitized::text LIKE '%expires_at%'
     OR v_sanitized::text LIKE '%filename%'
     OR v_sanitized::text NOT LIKE '%"path"%'
     OR v_sanitized::text NOT LIKE '%application/pdf%' THEN
    RAISE EXCEPTION 'T-02 FAIL: exact claim binding/sanitization failed: %', v_sanitized;
  END IF;

  -- Exact retry reconciles. Another session/key cannot replay the claim.
  PERFORM public.issue_3859_attach_intake_snapshot(
    v_session, v_event, v_owner, v_upload_session, v_key, v_attempt,
    v_lines, v_intake
  );
  BEGIN
    PERFORM public.issue_3859_attach_intake_snapshot(
      v_other_session, v_event, v_owner, v_upload_session, v_key || ':other',
      gen_random_uuid(), v_lines, v_intake
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_conflict := SQLERRM = 'intake_upload_claim_replayed';
  END;
  IF NOT v_conflict OR
     (SELECT checkout_session_id FROM public.trip_intake_upload_claims WHERE id = v_claim) <> v_session THEN
    RAISE EXCEPTION 'T-03 FAIL: cross-session replay was not refused';
  END IF;

  INSERT INTO public.orders(
    id, event_id, buyer_email, buyer_name, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, notification_status
  ) VALUES (
    v_order, v_event, 'buyer@example.test', 'Buyer', '+15555550123',
    '+15555550123', 10000, 'USD', 'online_card', 'paid', v_session,
    'online_checkout', 'pending'
  );
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
  IF (SELECT order_id FROM public.trip_intake_upload_claims WHERE id = v_claim) <> v_order
     OR (SELECT intake_form_data FROM public.orders WHERE id = v_order) IS DISTINCT FROM v_sanitized THEN
    RAISE EXCEPTION 'T-04 FAIL: final order did not receive sanitized snapshot';
  END IF;

  IF has_table_privilege('anon', 'public.trip_intake_upload_claims', 'SELECT')
     OR has_table_privilege('authenticated', 'public.trip_intake_upload_claims', 'SELECT')
     OR has_table_privilege('anon', 'public.ticket_checkout_intake_snapshots', 'SELECT') THEN
    RAISE EXCEPTION 'T-05 FAIL: private manifests/snapshots exposed to app roles';
  END IF;
  RAISE NOTICE 'issue_3859_private_intake_claims: PASS';
END
$test$;

ROLLBACK;
