-- #4130 Wave 2b — messaging limits and subscriptions, executable PostgreSQL 17 proof.
-- Runs after the complete migration replay and rolls every fixture back.
--
-- Proves:
--   1. a brand override raises the email/SMS cap (usage and the confirm-time assert);
--   2. an expired override falls back to the default;
--   3. changing the defaults row changes caps for every brand without an override;
--   4. push stays uncapped by default;
--   5. the brand×channel advisory lock and book_blast_monthly_cap_exceeded (P0001) are kept;
--   6. the admin RPCs (limits and the expiring-overrides read) are admin-only and
--      the table is closed to anon and authenticated;
--   7. the subscriptions list hides staff and test accounts unless asked for;
--   8. Global Plus switches only through admin_set_global_plus: admin-only,
--      reason required, audited, and an error when nothing changed.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t4130b_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t4130b_people VALUES
  ('admin',    '41300000-0000-4000-b200-000000000001', 'issue4130b-admin@test.local'),
  ('host',     '41300000-0000-4000-b200-000000000002', 'issue4130b-host@test.local'),
  ('outsider', '41300000-0000-4000-b200-000000000003', 'issue4130b-outsider@test.local'),
  ('payer',    '41300000-0000-4000-b200-000000000004', 'issue4130b-payer@test.local'),
  ('comped',   '41300000-0000-4000-b200-000000000005', 'issue4130b-comped@test.local'),
  ('nobody',   '41300000-0000-4000-b200-000000000006', 'issue4130b-nobody@test.local'),
  ('staff',    '41300000-0000-4000-b200-000000000007', 'issue4130b-staff@usemingla.com');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t4130b_people
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue4130b-admin@test.local', 'admin', 'active', now());

-- Run one SQL expression as a persona; returns its text value or ERR:<code>:<message>.
CREATE FUNCTION pg_temp.t4130b_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t4130b_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SELECT (' || p_sql || ')::text' INTO v_answer;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.email', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN COALESCE(v_answer, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.email', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

-- True when the assert refuses with the original error and code.
CREATE FUNCTION pg_temp.t4130b_refused(p_brand uuid, p_channel text, p_n integer) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.biz_assert_brand_blast_allowance_v1(p_brand, p_channel, p_n);
  RETURN false;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'book_blast_monthly_cap_exceeded' THEN
    RAISE EXCEPTION 'unexpected refusal: %', SQLERRM;
  END IF;
  RETURN true;
END;
$$;

-- ── 0. Shape: lock, error, grants ──────────────────────────────────────────
DO $shape$
DECLARE
  v_def text := pg_get_functiondef('public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)'::regprocedure);
BEGIN
  IF position('pg_advisory_xact_lock' IN v_def) = 0
     OR position($q$hashtextextended('blast_cap:' || p_brand_id::text || ':' || p_channel, 3682)$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'cap assert lost its brand/channel advisory lock';
  END IF;
  IF position('book_blast_monthly_cap_exceeded' IN v_def) = 0 OR position($q$ERRCODE = 'P0001'$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'cap assert lost its error code';
  END IF;
  IF position('brand_messaging_effective_limits' IN v_def) = 0 THEN
    RAISE EXCEPTION 'cap assert does not read the effective limits';
  END IF;
  IF position('issue_4111_subscribe_sms_used' IN v_def) = 0
     OR position('issue_4111_subscribe_sms_used' IN pg_get_functiondef('public.biz_brand_blast_usage_v1(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'subscribe texts dropped from SMS usage (#4111)';
  END IF;
  IF has_function_privilege('authenticated', 'public.biz_brand_blast_usage_v1(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.brand_messaging_effective_limits(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.subscription_tier_without_global(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal cap functions leaked to authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.brand_messaging_limits', 'SELECT')
     OR has_table_privilege('anon', 'public.brand_messaging_limits', 'SELECT')
     OR has_table_privilege('authenticated', 'public.brand_messaging_limits', 'UPDATE') THEN
    RAISE EXCEPTION 'brand_messaging_limits readable or writable from the browser';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_messaging_limits'::regclass) THEN
    RAISE EXCEPTION 'RLS off on brand_messaging_limits';
  END IF;
  IF has_function_privilege('anon', 'public.admin_subscription_overrides_expiring(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_messaging_limits_overview()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_set_brand_messaging_limits(uuid,integer,integer,integer,integer,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_set_messaging_limit_defaults(integer,integer,integer,integer,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_list_subscriptions_v2(text,text,text,boolean,integer,integer,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_set_global_plus(boolean,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_subscription_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin RPC executable by anon';
  END IF;
  IF (SELECT count(*) FROM public.brand_messaging_limits WHERE brand_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'defaults row missing or duplicated';
  END IF;
END $shape$;

-- ── Fixtures: two brands owned by the host, each with a month of email/SMS ─
CREATE TEMP TABLE t4130b_ids (k text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO t4130b_ids VALUES
  ('brand_a', gen_random_uuid()), ('brand_b', gen_random_uuid()),
  ('aud_a', gen_random_uuid()), ('aud_b', gen_random_uuid());

DO $fixtures$
DECLARE
  v_host uuid := '41300000-0000-4000-b200-000000000002';
  v_brand uuid;
  v_aud uuid;
  v_campaign uuid;
  v_key text;
BEGIN
  INSERT INTO public.creator_accounts (id) VALUES (v_host) ON CONFLICT DO NOTHING;
  FOREACH v_key IN ARRAY ARRAY['a', 'b'] LOOP
    SELECT id INTO v_brand FROM t4130b_ids WHERE k = 'brand_' || v_key;
    SELECT id INTO v_aud FROM t4130b_ids WHERE k = 'aud_' || v_key;
    INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_host, 'Limits Brand ' || v_key, 'issue4130b-limits-' || v_key);
    INSERT INTO public.marketing_audiences (id, account_id, brand_id, name, query_definition, is_system_generated)
    VALUES (v_aud, v_host, v_brand, 'Your Book',
      jsonb_build_object('kind', 'all_brand_people', 'brand_id', v_brand::text), true);

    -- 1,000 emails sent this month.
    v_campaign := gen_random_uuid();
    INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (v_campaign, v_host, v_brand, v_aud, 'Email month', 'email',
      '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}'::jsonb, 'sent');
    INSERT INTO public.marketing_book_send_executions (
      brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash,
      content_hash, selected_count, reachable_count, suppressed_count, unavailable_count,
      sms_segment_count, estimated_cost_minor, currency, cost_kind, ratebook_ids,
      source_references, quoted_at, scheduled_for, send_mode
    ) VALUES (
      v_brand, v_campaign, v_host, gen_random_uuid(), 1, repeat('a', 64), repeat('b', 64),
      1000, 1000, 0, 0, 0, NULL, NULL, 'not_metered', '[]'::jsonb, '[]'::jsonb, now(), now(), 'now'
    );

    -- 100 texts sent this month.
    v_campaign := gen_random_uuid();
    INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (v_campaign, v_host, v_brand, v_aud, 'SMS month', 'sms',
      '{"kind":"sms","body":"Hi"}'::jsonb, 'sent');
    INSERT INTO public.marketing_book_send_executions (
      brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash,
      content_hash, selected_count, reachable_count, suppressed_count, unavailable_count,
      sms_segment_count, estimated_cost_minor, currency, cost_kind, ratebook_ids,
      source_references, quoted_at, scheduled_for, send_mode
    ) VALUES (
      v_brand, v_campaign, v_host, gen_random_uuid(), 1, repeat('c', 64), repeat('d', 64),
      100, 100, 0, 0, 100, 5000, 'NGN', 'provider_estimate', '[]'::jsonb, '[]'::jsonb, now(), now(), 'now'
    );
  END LOOP;
END $fixtures$;

-- ── 1–4. Caps follow overrides, expiry and defaults; push uncapped ─────────
DO $caps$
DECLARE
  v_host uuid := '41300000-0000-4000-b200-000000000002';
  v_a uuid := (SELECT id FROM t4130b_ids WHERE k = 'brand_a');
  v_b uuid := (SELECT id FROM t4130b_ids WHERE k = 'brand_b');
  v_usage jsonb;
  v text;
BEGIN
  -- Defaults: both brands are full.
  v_usage := public.biz_brand_blast_usage_v1(v_host, v_a);
  IF (v_usage->>'emailCap')::int <> 1000 OR (v_usage->>'smsCap')::int <> 100
     OR (v_usage->>'emailUsed')::int <> 1000 OR (v_usage->>'smsUsed')::int <> 100
     OR (v_usage->>'weekWarningAt')::int <> 3 OR v_usage->>'limitSource' <> 'default'
     OR v_usage->'pushCap' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'default usage wrong: %', v_usage;
  END IF;
  IF NOT pg_temp.t4130b_refused(v_a, 'email', 1) OR NOT pg_temp.t4130b_refused(v_a, 'sms', 1) THEN
    RAISE EXCEPTION 'full brand not refused at the default caps';
  END IF;

  -- 4. Push is uncapped by default.
  IF pg_temp.t4130b_refused(v_a, 'push', 5000000) THEN
    RAISE EXCEPTION 'push refused with no push limit';
  END IF;

  -- 1. An override raises the caps (set through the admin RPC).
  v := pg_temp.t4130b_as('admin', format(
    'public.admin_set_brand_messaging_limits(%L::uuid, 3000, 500, NULL, 5, now() + interval ''10 days'', ''Big launch'')', v_a));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'admin could not raise limits: %', v; END IF;
  v_usage := public.biz_brand_blast_usage_v1(v_host, v_a);
  IF (v_usage->>'emailCap')::int <> 3000 OR (v_usage->>'smsCap')::int <> 500
     OR (v_usage->>'emailRemaining')::int <> 2000 OR (v_usage->>'smsRemaining')::int <> 400
     OR (v_usage->>'weekWarningAt')::int <> 5 OR v_usage->>'limitSource' <> 'override' THEN
    RAISE EXCEPTION 'override usage wrong: %', v_usage;
  END IF;
  IF pg_temp.t4130b_refused(v_a, 'email', 2000) OR pg_temp.t4130b_refused(v_a, 'sms', 400) THEN
    RAISE EXCEPTION 'override did not raise the caps';
  END IF;
  IF NOT pg_temp.t4130b_refused(v_a, 'email', 2001) OR NOT pg_temp.t4130b_refused(v_a, 'sms', 401) THEN
    RAISE EXCEPTION 'override cap not enforced';
  END IF;
  -- The other brand is untouched.
  IF NOT pg_temp.t4130b_refused(v_b, 'email', 1) THEN
    RAISE EXCEPTION 'override leaked to another brand';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'messaging_limits.brand_set' AND target_id = v_a::text) <> 1 THEN
    RAISE EXCEPTION 'raising limits was not audited';
  END IF;

  -- An admin push limit applies.
  v := pg_temp.t4130b_as('admin', format(
    'public.admin_set_brand_messaging_limits(%L::uuid, 3000, 500, 10, 5, NULL, ''Push trial'')', v_a));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'admin could not set push: %', v; END IF;
  IF NOT pg_temp.t4130b_refused(v_a, 'push', 11) OR pg_temp.t4130b_refused(v_a, 'push', 10) THEN
    RAISE EXCEPTION 'push limit not enforced when set';
  END IF;

  -- 2. An expired override falls back to the default.
  UPDATE public.brand_messaging_limits SET ends_at = now() - interval '1 minute' WHERE brand_id = v_a;
  v_usage := public.biz_brand_blast_usage_v1(v_host, v_a);
  IF (v_usage->>'emailCap')::int <> 1000 OR (v_usage->>'smsCap')::int <> 100
     OR v_usage->>'limitSource' <> 'default' THEN
    RAISE EXCEPTION 'expired override still applied: %', v_usage;
  END IF;
  IF NOT pg_temp.t4130b_refused(v_a, 'email', 1) OR pg_temp.t4130b_refused(v_a, 'push', 5000000) THEN
    RAISE EXCEPTION 'expired override still enforced';
  END IF;

  -- A past end date cannot be saved.
  v := pg_temp.t4130b_as('admin', format(
    'public.admin_set_brand_messaging_limits(%L::uuid, 3000, 500, NULL, 5, now() - interval ''1 day'', ''Late'')', v_a));
  IF v NOT LIKE 'ERR:%messaging_limit_end_in_past%' THEN RAISE EXCEPTION 'past end date accepted: %', v; END IF;

  -- 3. The defaults row changes caps for every brand without an override.
  v := pg_temp.t4130b_as('admin',
    'public.admin_set_messaging_limit_defaults(2000, 150, NULL, 4, ''More room for everyone'')');
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'admin could not change defaults: %', v; END IF;
  v_usage := public.biz_brand_blast_usage_v1(v_host, v_b);
  IF (v_usage->>'emailCap')::int <> 2000 OR (v_usage->>'smsCap')::int <> 150
     OR (v_usage->>'weekWarningAt')::int <> 4 THEN
    RAISE EXCEPTION 'defaults change not applied: %', v_usage;
  END IF;
  IF pg_temp.t4130b_refused(v_b, 'email', 1000) OR NOT pg_temp.t4130b_refused(v_b, 'email', 1001)
     OR pg_temp.t4130b_refused(v_b, 'sms', 50) OR NOT pg_temp.t4130b_refused(v_b, 'sms', 51) THEN
    RAISE EXCEPTION 'defaults change not enforced';
  END IF;
  -- Brand A's override has expired, so it follows the new defaults too.
  IF (public.biz_brand_blast_usage_v1(v_host, v_a)->>'emailCap')::int <> 2000 THEN
    RAISE EXCEPTION 'brand with an expired override ignored the new defaults';
  END IF;
  -- Push still uncapped by default after the change.
  IF pg_temp.t4130b_refused(v_b, 'push', 5000000) THEN
    RAISE EXCEPTION 'push capped by the defaults change';
  END IF;

  -- Clearing an override returns the brand to the defaults.
  v := pg_temp.t4130b_as('admin', format(
    'public.admin_set_brand_messaging_limits(%L::uuid, 9000, 900, NULL, 3, NULL, ''Again'')', v_b));
  IF (public.biz_brand_blast_usage_v1(v_host, v_b)->>'emailCap')::int <> 9000 THEN
    RAISE EXCEPTION 'second override not applied';
  END IF;
  v := pg_temp.t4130b_as('admin', format('public.admin_clear_brand_messaging_limits(%L::uuid, ''Done'')', v_b));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'clear failed: %', v; END IF;
  IF (public.biz_brand_blast_usage_v1(v_host, v_b)->>'emailCap')::int <> 2000 THEN
    RAISE EXCEPTION 'clear did not return the brand to the defaults';
  END IF;

  -- The overview shows usage and the override for the admin.
  v := pg_temp.t4130b_as('admin', format(
    '(SELECT x FROM jsonb_array_elements(public.admin_messaging_limits_overview()->''brands'') x WHERE x->>''brand_id'' = %L)', v_a));
  IF v LIKE 'ERR:%' OR (v::jsonb->>'email_used')::int <> 1000 OR (v::jsonb->>'sms_used')::int <> 100
     OR (v::jsonb->>'sms_cost_minor')::int <> 5000 OR v::jsonb->>'sms_cost_currency' <> 'NGN'
     OR (v::jsonb->'override'->>'active')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'overview row wrong: %', v;
  END IF;
END $caps$;

-- ── 6. Admin-only ──────────────────────────────────────────────────────────
DO $gates$
DECLARE
  v_a uuid := (SELECT id FROM t4130b_ids WHERE k = 'brand_a');
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    pg_temp.t4130b_as('host', 'public.admin_subscription_overrides_expiring(3)'),
    pg_temp.t4130b_as('host', 'public.admin_messaging_limits_overview()'),
    pg_temp.t4130b_as('host', format('public.admin_set_brand_messaging_limits(%L::uuid, 99999, 99999, NULL, 3, NULL, ''mine'')', v_a)),
    pg_temp.t4130b_as('host', 'public.admin_set_messaging_limit_defaults(99999, 99999, NULL, 3, ''mine'')'),
    pg_temp.t4130b_as('host', format('public.admin_clear_brand_messaging_limits(%L::uuid, ''mine'')', v_a)),
    pg_temp.t4130b_as('host', 'public.admin_subscription_overview()'),
    pg_temp.t4130b_as('host', 'public.admin_list_subscriptions_v2(NULL, NULL, ''joined'', true, 20, 0)'),
    pg_temp.t4130b_as('host', 'public.admin_set_global_plus(false, ''mine'')'),
    pg_temp.t4130b_as('host', '(SELECT count(*) FROM public.brand_messaging_limits)')
  ] LOOP
    IF v NOT LIKE 'ERR:%' THEN
      RAISE EXCEPTION 'non-admin got through: %', v;
    END IF;
  END LOOP;
  -- No reason, no write.
  v := pg_temp.t4130b_as('admin', format('public.admin_set_brand_messaging_limits(%L::uuid, 10, 10, NULL, 3, NULL, '' '')', v_a));
  IF v NOT LIKE 'ERR:%reason_required%' THEN RAISE EXCEPTION 'blank reason accepted: %', v; END IF;
  v := pg_temp.t4130b_as('admin', format('public.admin_set_brand_messaging_limits(%L::uuid, -1, 10, NULL, 3, NULL, ''x'')', v_a));
  IF v NOT LIKE 'ERR:%messaging_limit_out_of_bounds%' THEN RAISE EXCEPTION 'negative limit accepted: %', v; END IF;
END $gates$;

-- ── Subscriptions: real tier, expiring overrides, list ─────────────────────
DO $subs$
DECLARE
  v_payer uuid := '41300000-0000-4000-b200-000000000004';
  v_comped uuid := '41300000-0000-4000-b200-000000000005';
  v_nobody uuid := '41300000-0000-4000-b200-000000000006';
  v_staff uuid := '41300000-0000-4000-b200-000000000007';
  v_global text;
  v_audits integer;
  v jsonb;
  t text;
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (v_payer, 'Pat', 'Issue4130bzz'), (v_comped, 'Cam', 'Issue4130bzz'), (v_nobody, NULL, 'Issue4130bzz'),
         (v_staff, 'Sam', 'Issue4130bzz')
  ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name;
  DELETE FROM public.subscriptions WHERE user_id IN (v_payer, v_comped, v_nobody);
  INSERT INTO public.subscriptions (user_id, tier, is_active, current_period_end)
  VALUES (v_payer, 'mingla_plus', true, now() + interval '20 days');
  INSERT INTO public.admin_subscription_overrides (user_id, tier, reason, starts_at, expires_at)
  VALUES (v_comped, 'mingla_plus', 'Creator partner', now() - interval '1 day', now() + interval '2 days');

  SELECT config_value INTO v_global FROM public.app_config WHERE config_key = 'global_plus_access';
  IF v_global IS NULL THEN
    INSERT INTO public.app_config (config_key, config_value) VALUES ('global_plus_access', 'true');
  ELSE
    UPDATE public.app_config SET config_value = 'true' WHERE config_key = 'global_plus_access';
  END IF;

  -- Global Plus on: everyone gets Plus, but the real tiers are kept apart.
  IF public.get_effective_tier(v_nobody) <> 'mingla_plus' THEN
    RAISE EXCEPTION 'fixture: global plus not on';
  END IF;
  IF (SELECT tier || '/' || source FROM public.subscription_tier_without_global(v_payer)) <> 'mingla_plus/paid'
     OR (SELECT tier || '/' || source FROM public.subscription_tier_without_global(v_comped)) <> 'mingla_plus/admin'
     OR (SELECT tier || '/' || source FROM public.subscription_tier_without_global(v_nobody)) <> 'free/none' THEN
    RAISE EXCEPTION 'real tiers wrong';
  END IF;

  t := pg_temp.t4130b_as('admin', 'public.admin_list_subscriptions_v2(''Issue4130bzz'', NULL, ''name'', false, 2, 0)');
  IF t LIKE 'ERR:%' THEN RAISE EXCEPTION 'list failed: %', t; END IF;
  v := t::jsonb;
  -- Total counts the whole filtered list, not the page.
  IF (v->>'total')::int <> 3 OR jsonb_array_length(v->'rows') <> 2 THEN
    RAISE EXCEPTION 'list total/page wrong: %', v;
  END IF;
  IF v->'rows'->0->>'display_name' <> 'Cam Issue4130bzz' OR v->'rows'->1->>'display_name' <> 'Issue4130bzz'
     OR (v->'rows'->1->>'has_first_name')::boolean THEN
    RAISE EXCEPTION 'name sort wrong: %', v;
  END IF;
  IF v->'rows'->0->>'override_id' IS NULL OR v->'rows'->0->>'real_source' <> 'admin' THEN
    RAISE EXCEPTION 'admin override not listed: %', v;
  END IF;
  t := pg_temp.t4130b_as('admin', 'public.admin_list_subscriptions_v2(''Issue4130bzz'', ''free'', ''joined'', true, 20, 0)');
  v := t::jsonb;
  IF (v->>'total')::int <> 1 OR (v->'rows'->0->>'has_first_name')::boolean
     OR v->'rows'->0->>'gets_now' <> 'mingla_plus' OR v->'rows'->0->>'gets_now_reason' <> 'global' THEN
    RAISE EXCEPTION 'free filter / global reason wrong: %', v;
  END IF;
  -- 7. The staff account (usemingla.com) is left out by default and counted.
  IF (v->>'internal_hidden')::int <> 1 OR (v->>'show_internal')::boolean THEN
    RAISE EXCEPTION 'staff not counted as hidden: %', v;
  END IF;
  v := pg_temp.t4130b_as('admin', 'public.admin_list_subscriptions_v2(''Issue4130bzz'', NULL, ''name'', false, 20, 0, true)')::jsonb;
  IF (v->>'total')::int <> 4 OR (v->>'internal_hidden')::int <> 0
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x WHERE x->>'user_id' = v_staff::text AND (x->>'internal')::boolean) THEN
    RAISE EXCEPTION 'staff not shown when asked for: %', v;
  END IF;
  -- Past the last page still reports the total.
  v := pg_temp.t4130b_as('admin', 'public.admin_list_subscriptions_v2(''Issue4130bzz'', NULL, ''joined'', true, 20, 40)')::jsonb;
  IF (v->>'total')::int <> 3 OR jsonb_array_length(v->'rows') <> 0 THEN
    RAISE EXCEPTION 'offset past end wrong: %', v;
  END IF;

  -- The expiring-in-3-days read sees the override the browser cannot.
  t := pg_temp.t4130b_as('admin', 'public.admin_subscription_overrides_expiring(3)');
  IF t LIKE 'ERR:%' OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(t::jsonb->'rows') x WHERE x->>'user_id' = v_comped::text
  ) THEN
    RAISE EXCEPTION 'expiring override not reported: %', t;
  END IF;
  t := pg_temp.t4130b_as('host', '(SELECT count(*) FROM public.admin_subscription_overrides)');
  IF t <> '0' AND t NOT LIKE 'ERR:%' THEN
    RAISE EXCEPTION 'browser can read overrides: %', t;
  END IF;

  t := pg_temp.t4130b_as('admin', 'public.admin_subscription_overview()');
  IF t LIKE 'ERR:%' OR NOT (t::jsonb->>'global_plus')::boolean
     OR (t::jsonb->>'expiring_3d')::int < 1 OR (t::jsonb->>'paid')::int < 1 THEN
    RAISE EXCEPTION 'overview wrong: %', t;
  END IF;

  -- 8. Global Plus (on here): no reason, no change; the same state is an
  -- error, not a silent success; a real switch is audited.
  t := pg_temp.t4130b_as('admin', 'public.admin_set_global_plus(false, ''  '')');
  IF t NOT LIKE 'ERR:%reason_required%' THEN RAISE EXCEPTION 'blank Global Plus reason accepted: %', t; END IF;
  t := pg_temp.t4130b_as('admin', 'public.admin_set_global_plus(true, ''Already on'')');
  IF t NOT LIKE 'ERR:%no_change%' THEN RAISE EXCEPTION 'no-op Global Plus switch reported success: %', t; END IF;
  SELECT count(*) INTO v_audits FROM public.admin_audit_log WHERE action = 'subscriptions.global_plus_set';
  t := pg_temp.t4130b_as('admin', 'public.admin_set_global_plus(false, ''Launch promo over'')');
  IF t LIKE 'ERR:%' OR (SELECT config_value FROM public.app_config WHERE config_key = 'global_plus_access') <> 'false' THEN
    RAISE EXCEPTION 'Global Plus did not switch off: %', t;
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'subscriptions.global_plus_set') <> v_audits + 1 THEN
    RAISE EXCEPTION 'Global Plus switch not audited';
  END IF;
  DELETE FROM public.app_config WHERE config_key = 'global_plus_access';
  t := pg_temp.t4130b_as('admin', 'public.admin_set_global_plus(true, ''Missing row'')');
  IF t NOT LIKE 'ERR:%global_plus_setting_missing%' THEN RAISE EXCEPTION 'missing Global Plus row not refused: %', t; END IF;
END $subs$;

ROLLBACK;
