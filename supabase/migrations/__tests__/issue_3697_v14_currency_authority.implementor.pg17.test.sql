-- Issue #3697 v1.4 currency authority executable contract.
-- Runs after full migration replay in a disposable PostgreSQL 17 database.
-- MINGLA-INVARIANT: I-3697-HOST-CURRENCY-AUTHORITY | issue #3697 | Host ad wallets and customer-facing campaign money use the brand's verified settlement currency; client-supplied currency cannot override it.
-- MINGLA-INVARIANT: I-3697-PROVIDER-CURRENCY-AUTHORITY | issue #3697 | Provider spend uses the selected connected ad account currency and never inherits a Host-wallet currency or a USD fallback.
-- MINGLA-INVARIANT: I-3697-CURRENCY-MIGRATION-NO-RELABEL | issue #3697 | Legacy value-bearing currency mismatches are classified for reconciliation and are never automatically relabelled.
-- MINGLA-INVARIANT: I-3697-CURRENCY-MIGRATION-RECONCILIATION | issue #3697 | Currency cutover records before/after wallet truth, ledger-derived balance and provider liabilities without summing unlike currencies.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '36970000-0000-4000-8000-000000000001';
  v_ngn_brand constant uuid := '36970000-0000-4000-8000-000000000011';
  v_usd_brand constant uuid := '36970000-0000-4000-8000-000000000012';
  v_unresolved_brand constant uuid := '36970000-0000-4000-8000-000000000013';
  v_connection constant uuid := '36970000-0000-4000-8000-000000000021';
  v_host_campaign constant uuid := '36970000-0000-4000-8000-000000000031';
  v_mingla_campaign constant uuid := '36970000-0000-4000-8000-000000000032';
  v_detail jsonb;
  v_snapshot jsonb;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'issue-3697-currency@example.test');
  INSERT INTO public.creator_accounts (id, email)
  VALUES (v_user, 'issue-3697-currency@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code
  ) VALUES
    (v_ngn_brand, v_user, 'Issue 3697 NGN', 'issue-3697-ngn', 'NGN',
      'paystack', 'NG', 'ACCT_issue3697'),
    (v_usd_brand, v_user, 'Issue 3697 USD', 'issue-3697-usd', 'USD',
      'stripe', 'US', NULL),
    (v_unresolved_brand, v_user, 'Issue 3697 unresolved',
      'issue-3697-unresolved', 'USD', 'stripe', 'US', NULL);

  INSERT INTO public.stripe_connect_accounts (
    brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency
  ) VALUES (
    v_usd_brand, 'acct_issue3697', true, true, 'US', 'USD'
  );

  v_detail := public.ad_brand_currency_authority(v_ngn_brand);
  IF (v_detail->>'resolved')::boolean IS DISTINCT FROM true
     OR v_detail->>'currency' <> 'NGN'
     OR v_detail->>'provider' <> 'paystack' THEN
    RAISE EXCEPTION 'paystack_ngn_authority_failed:%', v_detail;
  END IF;

  v_detail := public.ad_brand_currency_authority(v_usd_brand);
  IF (v_detail->>'resolved')::boolean IS DISTINCT FROM true
     OR v_detail->>'currency' <> 'USD'
     OR v_detail->>'rail_currency' <> 'USD' THEN
    RAISE EXCEPTION 'stripe_usd_authority_failed:%', v_detail;
  END IF;

  v_detail := public.ad_brand_currency_authority(v_unresolved_brand);
  IF (v_detail->>'resolved')::boolean IS DISTINCT FROM false
     OR v_detail->>'reason' <> 'payout_rail_not_ready' THEN
    RAISE EXCEPTION 'unready_stripe_did_not_fail_closed:%', v_detail;
  END IF;

  INSERT INTO public.ad_credit_wallets (brand_id, currency)
  VALUES (v_ngn_brand, 'NGN');

  IF NOT EXISTS (
    SELECT 1 FROM public.ad_credit_wallets
     WHERE brand_id = v_ngn_brand
       AND currency = 'NGN'
       AND authority_currency = 'NGN'
       AND currency_status = 'aligned'
  ) THEN
    RAISE EXCEPTION 'wallet_authority_stamp_missing';
  END IF;

  INSERT INTO public.ad_credit_ledger (
    brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents,
    currency, actor_id, idempotency_key
  ) VALUES (
    v_ngn_brand, 'top_up', 10000, 0, 10000, 'NGN', v_user,
    'issue3697-reconciliation-topup'
  );
  UPDATE public.ad_credit_wallets
  SET balance_cents = 10000
  WHERE brand_id = v_ngn_brand;

  v_failed := false;
  BEGIN
    INSERT INTO public.ad_credit_wallets (brand_id, currency)
    VALUES (v_usd_brand, 'NGN');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_credit_currency_authority_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'wallet_client_currency_override_succeeded';
  END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.ad_credit_wallets (brand_id, currency)
    VALUES (v_unresolved_brand, 'USD');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'payout_rail_not_ready';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'unresolved_wallet_creation_succeeded';
  END IF;

  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection, 'meta', 'consumer', 'Issue 3697 USD Meta',
    'act_issue3697', 'system_user_token', 'ISSUE_3697_TEST_TOKEN',
    'connected', 'USD', true
  );

  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency, cap_cents
  ) VALUES (
    v_host_campaign, v_connection, 'meta', 'campaign_issue3697_host',
    'Issue 3697 Host', 'OUTCOME_TRAFFIC', 'PAUSED', 'brand',
    'issue-3697-ngn', 'https://usemingla.com/issue-3697-ngn',
    'https://usemingla.com/issue-3697-ngn', v_ngn_brand, 'host', 'NGN',
    10000
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.ad_campaigns
     WHERE id = v_host_campaign
       AND currency = 'NGN'
       AND host_currency = 'NGN'
       AND provider_currency = 'USD'
       AND currency_status = 'aligned'
  ) THEN
    RAISE EXCEPTION 'host_provider_currency_separation_failed';
  END IF;

  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency
  ) VALUES (
    v_mingla_campaign, v_connection, 'meta', 'campaign_issue3697_mingla',
    'Issue 3697 Mingla', 'OUTCOME_TRAFFIC', 'PAUSED', 'brand',
    'issue-3697-usd', 'https://usemingla.com/issue-3697-usd',
    'https://usemingla.com/issue-3697-usd', v_usd_brand, 'mingla', 'USD'
  );

  v_failed := false;
  BEGIN
    INSERT INTO public.ad_campaigns (
      connection_id, platform, external_campaign_id, name, objective,
      status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
      brand_id, owner_kind, currency
    ) VALUES (
      v_connection, 'meta', 'campaign_issue3697_bad', 'Bad currency',
      'OUTCOME_TRAFFIC', 'PAUSED', 'brand', 'issue-3697-usd',
      'https://usemingla.com/issue-3697-usd',
      'https://usemingla.com/issue-3697-usd', v_usd_brand, 'mingla', 'NGN'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_connection_currency_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'mingla_provider_currency_override_succeeded';
  END IF;

  INSERT INTO public.ad_spend_daily (
    campaign_id, platform, spend_date, spend_cents, currency
  ) VALUES (v_host_campaign, 'meta', current_date, 3000, 'USD');

  v_snapshot := public.ad_currency_reconciliation_snapshot(v_ngn_brand);
  IF (v_snapshot->>'wallet_balance_cents')::bigint <> 10000
     OR (v_snapshot->>'ledger_balance_cents')::bigint <> 10000
     OR (v_snapshot->>'ledger_terminal_balance_cents')::bigint <> 10000
     OR (v_snapshot->>'ledger_reconciles')::boolean IS DISTINCT FROM true
     OR (v_snapshot->'provider_liability_by_currency'->>'USD')::bigint <> 7000
     OR jsonb_array_length(v_snapshot->'provider_liability_campaigns') <> 1
  THEN
    RAISE EXCEPTION 'currency_reconciliation_snapshot_incomplete:%', v_snapshot;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_attribute a
    WHERE a.attrelid = 'public.ad_currency_migration_audit'::regclass
      AND a.attname IN (
        'ledger_balance_cents', 'ledger_terminal_balance_cents',
        'ledger_reconciles', 'provider_liability_by_currency',
        'post_wallet_balance_cents', 'post_ledger_balance_cents',
        'post_provider_liability_by_currency'
      )
      AND NOT a.attisdropped
  ) <> 7 THEN
    RAISE EXCEPTION 'currency_migration_before_after_columns_missing';
  END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.ad_spend_daily (
      campaign_id, platform, spend_date, spend_cents, currency
    ) VALUES (v_mingla_campaign, 'meta', current_date, 3000, 'NGN');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_spend_currency_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'provider_spend_currency_override_succeeded';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid
                         AND a.attnum = d.adnum
     WHERE d.adrelid IN (
       'public.ad_credit_wallets'::regclass,
       'public.ad_campaigns'::regclass,
       'public.ad_spend_daily'::regclass
     )
       AND a.attname = 'currency'
  ) THEN
    RAISE EXCEPTION 'unsafe_currency_default_still_present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.ad_credit_wallets'::regclass
       AND tgname = 'ad_credit_wallet_currency_authority'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.ad_spend_daily'::regclass
       AND tgname = 'ad_spend_currency_authority'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'currency_authority_trigger_missing';
  END IF;
END;
$test$;

ROLLBACK;
