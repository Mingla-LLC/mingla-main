-- #3682 Wave 2.7 — monthly caps + week blast count.
BEGIN;
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'biz_brand_blast_usage_v1'
  ) THEN
    RAISE EXCEPTION 'usage rpc missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'biz_assert_brand_blast_allowance_v1'
  ) THEN
    RAISE EXCEPTION 'assert rpc missing';
  END IF;
  IF position(
    'pg_advisory_xact_lock' IN pg_get_functiondef(
      'public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'cap assert missing brand/channel advisory lock';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.biz_brand_blast_usage_v1(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'usage rpc leaked to authenticated';
  END IF;
END $test$;

DO $behavior$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_audience uuid := gen_random_uuid();
  v_campaign uuid := gen_random_uuid();
  v_prior uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_method uuid := gen_random_uuid();
  v_candidates jsonb;
  v_snapshot jsonb;
  v_usage jsonb;
  v_cap_hit boolean := false;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_actor);
  INSERT INTO public.creator_accounts (id) VALUES (v_actor);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_actor, 'Caps Brand', 'caps-brand');
  INSERT INTO public.brand_people (id, brand_id, display_name, linked_user_id)
  VALUES (v_person, v_brand, 'Guest', v_actor);
  INSERT INTO public.brand_person_contact_methods (
    id, brand_id, brand_person_id, channel, normalized_value,
    provenance_scope, is_exportable, is_primary, record_state
  ) VALUES (
    v_method, v_brand, v_person, 'email', 'guest@caps.usemingla.com',
    'brand_owned', true, true, 'active'
  );
  UPDATE public.feature_flags
  SET is_enabled = true
  WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1');
  INSERT INTO public.marketing_audiences (
    id, account_id, brand_id, name, query_definition, is_system_generated
  ) VALUES (
    v_audience, v_actor, v_brand, 'Your Book',
    jsonb_build_object('kind', 'all_brand_people', 'brand_id', v_brand::text),
    true
  );
  INSERT INTO public.marketing_campaigns (
    id, account_id, brand_id, audience_id, name, channel, channel_payload, status
  ) VALUES (
    v_prior, v_actor, v_brand, v_audience, 'Prior', 'email',
    '{"kind":"email","subject":"Prior","body_html":"Hi","body_text":"Hi"}'::jsonb,
    'sent'
  ), (
    v_campaign, v_actor, v_brand, v_audience, 'Hello', 'email',
    '{"kind":"email","subject":"Hello","body_html":"Hi","body_text":"Hi"}'::jsonb,
    'draft'
  );

  v_usage := public.biz_brand_blast_usage_v1(v_actor, v_brand);
  IF (v_usage->>'emailCap')::int <> 1000 OR (v_usage->>'smsCap')::int <> 100 THEN
    RAISE EXCEPTION 'caps wrong: %', v_usage;
  END IF;
  IF (v_usage->>'emailUsed')::int <> 0 OR (v_usage->>'blastsThisWeek')::int <> 0 THEN
    RAISE EXCEPTION 'fresh usage not zero: %', v_usage;
  END IF;
  IF (v_usage->>'weekWarningAt')::int <> 3 THEN
    RAISE EXCEPTION 'week warning threshold wrong: %', v_usage;
  END IF;

  INSERT INTO public.marketing_book_send_executions (
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash,
    content_hash, selected_count, reachable_count, suppressed_count, unavailable_count,
    sms_segment_count, estimated_cost_minor, currency, cost_kind, ratebook_ids,
    source_references, quoted_at, scheduled_for, send_mode
  ) VALUES (
    v_brand, v_prior, v_actor, gen_random_uuid(), 1, repeat('c', 64),
    repeat('d', 64), 1000, 1000, 0, 0, 0, NULL, NULL, 'not_metered', '[]'::jsonb,
    '[]'::jsonb, now(), now(), 'now'
  );

  v_usage := public.biz_brand_blast_usage_v1(v_actor, v_brand);
  IF (v_usage->>'emailUsed')::int <> 1000 OR (v_usage->>'emailRemaining')::int <> 0 THEN
    RAISE EXCEPTION 'email usage after seed wrong: %', v_usage;
  END IF;
  IF (v_usage->>'blastsThisWeek')::int <> 1 THEN
    RAISE EXCEPTION 'week count wrong: %', v_usage;
  END IF;

  BEGIN
    PERFORM public.biz_assert_brand_blast_allowance_v1(v_brand, 'email', 1);
  EXCEPTION WHEN raise_exception THEN
    v_cap_hit := SQLERRM LIKE '%book_blast_monthly_cap_exceeded%';
  END;
  IF NOT v_cap_hit THEN
    RAISE EXCEPTION 'email cap assert did not fire';
  END IF;

  PERFORM public.biz_assert_brand_blast_allowance_v1(v_brand, 'sms', 50);
  PERFORM public.biz_assert_brand_blast_allowance_v1(v_brand, 'push', 99999);

  v_candidates := public.biz_marketing_book_quote_candidates(v_actor, v_campaign);
  v_snapshot := v_candidates || jsonb_build_object(
    'quoteVersion', 1,
    'quoteHash', repeat('e', 64),
    'contentHash', 'cdbb30f189c5bb93e074ebbbd4f851f1a66f350d006c1e2fdfa6acc2d6376536',
    'quotedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reachableCount', 1,
    'suppressedCount', 0,
    'unavailableCount', 0,
    'smsSegments', 0,
    'estimatedCostMinor', NULL,
    'currency', NULL,
    'costKind', 'not_metered',
    'rateIds', '[]'::jsonb,
    'sourceReferences', '[]'::jsonb,
    'candidates', (
      SELECT jsonb_agg(
        x || jsonb_build_object(
          'segments', 0,
          'allocatedCostMinor', NULL,
          'rateId', NULL,
          'sourceReference', NULL
        )
      )
      FROM jsonb_array_elements(v_candidates->'candidates') x
    )
  );
  v_cap_hit := false;
  BEGIN
    PERFORM public.biz_confirm_marketing_book_send_v1(
      v_actor, v_campaign, v_request, v_snapshot, clock_timestamp() + interval '1 hour'
    );
  EXCEPTION WHEN raise_exception THEN
    v_cap_hit := SQLERRM LIKE '%book_blast_monthly_cap_exceeded%';
  END;
  IF NOT v_cap_hit THEN
    RAISE EXCEPTION 'confirm did not refuse over-cap email blast';
  END IF;
END $behavior$;
ROLLBACK;
