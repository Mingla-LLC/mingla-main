-- Issue #3697 v1.4 — ads currency authority and safe legacy classification.
--
-- Host money is owned by the brand's verified payout currency. Mingla-owned
-- campaigns are owned by the selected provider account currency. The two are
-- intentionally separate: provider spend may require a later, explicit FX
-- bridge, but it can never silently rewrite a Host wallet into USD.
--
-- Do NOT auto-apply. Existing mismatched value-bearing wallets/campaigns are
-- classified and blocked for operator reconciliation; this migration never
-- relabels their minor units.

BEGIN;

-- Resolve without raising so migrations/read surfaces can explain a blocked
-- authority. Mutating paths use ad_require_brand_currency below.
CREATE OR REPLACE FUNCTION public.ad_brand_currency_authority(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_currency text;
  v_provider text;
  v_rail_currency text;
BEGIN
  SELECT * INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id
    AND b.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'resolved', false,
      'currency', NULL,
      'provider', NULL,
      'reason', 'brand_not_found'
    );
  END IF;

  v_currency := upper(btrim(coalesce(v_brand.default_currency::text, '')));
  v_provider := lower(btrim(coalesce(v_brand.payment_provider::text, 'stripe')));

  IF v_currency !~ '^[A-Z]{3}$'
     OR NOT EXISTS (
       SELECT 1
       FROM public.supported_brand_currencies c
       WHERE c.code::text = v_currency
         AND c.active IS TRUE
     ) THEN
    RETURN jsonb_build_object(
      'resolved', false,
      'currency', NULLIF(v_currency, ''),
      'provider', v_provider,
      'reason', 'brand_currency_unresolved'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.brand_currency_reconciliations r
    WHERE r.brand_id = p_brand_id
      AND r.status = 'pending'
  ) THEN
    RETURN jsonb_build_object(
      'resolved', false,
      'currency', v_currency,
      'provider', v_provider,
      'reason', 'currency_reconciliation_pending'
    );
  END IF;

  IF v_provider = 'paystack' THEN
    IF v_currency <> 'NGN' THEN
      RETURN jsonb_build_object(
        'resolved', false,
        'currency', v_currency,
        'provider', v_provider,
        'reason', 'paystack_currency_mismatch'
      );
    END IF;

    IF NOT (
      v_brand.paystack_subaccount_code IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.brand_paystack_recipients r
        WHERE r.brand_id = p_brand_id
          AND r.is_active IS TRUE
      )
    ) THEN
      RETURN jsonb_build_object(
        'resolved', false,
        'currency', v_currency,
        'provider', v_provider,
        'reason', 'payout_rail_not_ready'
      );
    END IF;
  ELSIF v_provider = 'stripe' THEN
    SELECT upper(btrim(coalesce(s.default_currency::text, '')))
      INTO v_rail_currency
    FROM public.stripe_connect_accounts s
    WHERE s.brand_id = p_brand_id
      AND s.detached_at IS NULL
      AND s.payouts_enabled IS TRUE
      AND s.stripe_account_id IS NOT NULL
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT 1;

    IF v_rail_currency IS NULL OR v_rail_currency !~ '^[A-Z]{3}$' THEN
      RETURN jsonb_build_object(
        'resolved', false,
        'currency', v_currency,
        'provider', v_provider,
        'reason', 'payout_rail_not_ready'
      );
    END IF;
    IF v_rail_currency <> v_currency THEN
      RETURN jsonb_build_object(
        'resolved', false,
        'currency', v_currency,
        'provider', v_provider,
        'rail_currency', v_rail_currency,
        'reason', 'currency_authority_mismatch'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'resolved', false,
      'currency', v_currency,
      'provider', v_provider,
      'reason', 'payment_provider_unsupported'
    );
  END IF;

  RETURN jsonb_build_object(
    'resolved', true,
    'currency', v_currency,
    'provider', v_provider,
    'rail_currency', coalesce(v_rail_currency, v_currency),
    'reason', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_require_brand_currency(p_brand_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_authority jsonb;
  v_currency text;
  v_reason text;
BEGIN
  v_authority := public.ad_brand_currency_authority(p_brand_id);
  IF coalesce((v_authority->>'resolved')::boolean, false) IS NOT TRUE THEN
    v_reason := coalesce(v_authority->>'reason', 'currency_authority_unresolved');
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = v_reason,
      DETAIL = v_authority::text;
  END IF;
  v_currency := upper(btrim(coalesce(v_authority->>'currency', '')));
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency_authority_unresolved' USING ERRCODE = '22023';
  END IF;
  RETURN v_currency;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_brand_currency_authority(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_require_brand_currency(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_brand_currency_authority(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_require_brand_currency(uuid)
  TO service_role;

-- Reconciliation snapshot kept callable for the governed migration operator.
-- Ledger truth is derived from signed deltas and independently checked against
-- the terminal balance-after value. Provider liabilities remain separated by
-- provider-account currency; the function never adds unlike currencies.
CREATE OR REPLACE FUNCTION public.ad_currency_reconciliation_snapshot(
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_wallet public.ad_credit_wallets%ROWTYPE;
  v_ledger_count bigint;
  v_ledger_balance bigint;
  v_terminal_balance bigint;
  v_campaign_count bigint;
  v_liability_by_currency jsonb;
  v_liability_campaigns jsonb;
BEGIN
  SELECT * INTO v_wallet
  FROM public.ad_credit_wallets w
  WHERE w.brand_id = p_brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_credit_wallet_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(l.amount_cents), 0)
    INTO v_ledger_count, v_ledger_balance
  FROM public.ad_credit_ledger l
  WHERE l.brand_id = p_brand_id;
  SELECT coalesce((
    SELECT l.balance_after_cents
    FROM public.ad_credit_ledger l
    WHERE l.brand_id = p_brand_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT 1
  ), 0) INTO v_terminal_balance;

  WITH campaign_liability AS (
    SELECT
      c.id AS campaign_id,
      c.status,
      CASE
        WHEN upper(btrim(coalesce(ac.currency, ''))) ~ '^[A-Z]{3}$'
          THEN upper(btrim(ac.currency))
        ELSE 'UNRESOLVED'
      END AS provider_currency,
      greatest(coalesce(
        c.cap_cents, c.lifetime_budget_cents, c.daily_budget_cents, 0
      ), 0)::bigint AS committed_budget_cents,
      coalesce(s.spend_cents, 0)::bigint AS provider_spend_cents,
      coalesce(s.spend_currencies, '[]'::jsonb) AS spend_currencies
    FROM public.ad_campaigns c
    LEFT JOIN public.ad_connections ac ON ac.id = c.connection_id
    LEFT JOIN LATERAL (
      SELECT
        coalesce(sum(d.spend_cents), 0)::bigint AS spend_cents,
        coalesce(jsonb_agg(DISTINCT upper(btrim(d.currency))), '[]'::jsonb)
          AS spend_currencies
      FROM public.ad_spend_daily d
      WHERE d.campaign_id = c.id
    ) s ON true
    WHERE c.brand_id = p_brand_id
      AND c.owner_kind = 'host'
      AND upper(c.status) NOT IN ('ARCHIVED','DELETED')
  ), normalized AS (
    SELECT *, greatest(committed_budget_cents - provider_spend_cents, 0)::bigint
      AS outstanding_cents
    FROM campaign_liability
  ), by_currency AS (
    SELECT provider_currency, sum(outstanding_cents)::bigint AS outstanding_cents
    FROM normalized
    GROUP BY provider_currency
  )
  SELECT
    coalesce((SELECT jsonb_object_agg(
      provider_currency, outstanding_cents ORDER BY provider_currency
    ) FROM by_currency), '{}'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'campaign_id', campaign_id,
      'status', status,
      'provider_currency', provider_currency,
      'committed_budget_cents', committed_budget_cents,
      'provider_spend_cents', provider_spend_cents,
      'outstanding_cents', outstanding_cents,
      'spend_currencies', spend_currencies,
      'currency_reconciles', (
        spend_currencies = '[]'::jsonb
        OR spend_currencies = jsonb_build_array(provider_currency)
      )
    ) ORDER BY campaign_id) FROM normalized), '[]'::jsonb)
  INTO v_liability_by_currency, v_liability_campaigns;

  SELECT count(*) INTO v_campaign_count
  FROM public.ad_campaigns c
  WHERE c.brand_id = p_brand_id AND c.owner_kind = 'host';

  RETURN jsonb_build_object(
    'wallet_currency', upper(btrim(v_wallet.currency::text)),
    'wallet_balance_cents', v_wallet.balance_cents,
    'ledger_entry_count', v_ledger_count,
    'ledger_balance_cents', v_ledger_balance,
    'ledger_terminal_balance_cents', v_terminal_balance,
    'ledger_reconciles', (
      v_wallet.balance_cents = v_ledger_balance
      AND v_ledger_balance = v_terminal_balance
    ),
    'campaign_count', v_campaign_count,
    'provider_liability_by_currency', v_liability_by_currency,
    'provider_liability_campaigns', v_liability_campaigns
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_currency_reconciliation_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_currency_reconciliation_snapshot(uuid)
  TO service_role;

-- Durable audit: every pre-v1.4 wallet gets an explicit classification. This
-- is evidence for V1.4-21 and the operator queue for rows that carry value.
CREATE TABLE IF NOT EXISTS public.ad_currency_migration_audit (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE RESTRICT,
  wallet_currency char(3) NOT NULL,
  authority_currency char(3),
  wallet_balance_cents bigint NOT NULL,
  ledger_entry_count bigint NOT NULL,
  ledger_balance_cents bigint NOT NULL,
  ledger_terminal_balance_cents bigint NOT NULL,
  ledger_reconciles boolean NOT NULL,
  campaign_count bigint NOT NULL,
  provider_liability_by_currency jsonb NOT NULL,
  provider_liability_campaigns jsonb NOT NULL,
  post_wallet_currency char(3),
  post_wallet_balance_cents bigint,
  post_ledger_balance_cents bigint,
  post_ledger_terminal_balance_cents bigint,
  post_ledger_reconciles boolean,
  post_provider_liability_by_currency jsonb,
  post_provider_liability_campaigns jsonb,
  classification text NOT NULL CHECK (classification IN (
    'aligned',
    'safe_zero_recreate',
    'authority_unresolved',
    'requires_reconciliation'
  )),
  authority_detail jsonb NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz NULL,
  reconciliation_note text NULL,
  CONSTRAINT ad_currency_migration_liability_objects CHECK (
    jsonb_typeof(provider_liability_by_currency) = 'object'
    AND jsonb_typeof(provider_liability_campaigns) = 'array'
    AND (
      post_provider_liability_by_currency IS NULL
      OR jsonb_typeof(post_provider_liability_by_currency) = 'object'
    )
    AND (
      post_provider_liability_campaigns IS NULL
      OR jsonb_typeof(post_provider_liability_campaigns) = 'array'
    )
  )
);

ALTER TABLE public.ad_currency_migration_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_currency_migration_audit_admin_read
  ON public.ad_currency_migration_audit;
CREATE POLICY ad_currency_migration_audit_admin_read
  ON public.ad_currency_migration_audit
  FOR SELECT TO authenticated
  USING (public.is_admin_user());
REVOKE ALL ON public.ad_currency_migration_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_currency_migration_audit
  TO authenticated, service_role;
GRANT ALL ON public.ad_currency_migration_audit TO service_role;

ALTER TABLE public.ad_credit_wallets
  ADD COLUMN IF NOT EXISTS authority_currency char(3)
    REFERENCES public.supported_brand_currencies(code),
  ADD COLUMN IF NOT EXISTS currency_status text NOT NULL
    DEFAULT 'legacy_unclassified';

ALTER TABLE public.ad_credit_wallets
  DROP CONSTRAINT IF EXISTS ad_credit_wallets_currency_status_check;
ALTER TABLE public.ad_credit_wallets
  ADD CONSTRAINT ad_credit_wallets_currency_status_check CHECK (
    currency_status IN (
      'legacy_unclassified', 'aligned',
      'authority_unresolved', 'blocked_reconciliation'
    )
  );

INSERT INTO public.ad_currency_migration_audit (
  brand_id, wallet_currency, authority_currency, wallet_balance_cents,
  ledger_entry_count, ledger_balance_cents, ledger_terminal_balance_cents,
  ledger_reconciles, campaign_count, provider_liability_by_currency,
  provider_liability_campaigns, classification, authority_detail
)
SELECT
  w.brand_id,
  s.detail->>'wallet_currency',
  CASE
    WHEN coalesce((a.detail->>'resolved')::boolean, false) IS TRUE
      THEN NULLIF(a.detail->>'currency', '')::char(3)
    ELSE NULL
  END,
  (s.detail->>'wallet_balance_cents')::bigint,
  (s.detail->>'ledger_entry_count')::bigint,
  (s.detail->>'ledger_balance_cents')::bigint,
  (s.detail->>'ledger_terminal_balance_cents')::bigint,
  (s.detail->>'ledger_reconciles')::boolean,
  (s.detail->>'campaign_count')::bigint,
  s.detail->'provider_liability_by_currency',
  s.detail->'provider_liability_campaigns',
  CASE
    WHEN coalesce((a.detail->>'resolved')::boolean, false) IS NOT TRUE
      THEN 'authority_unresolved'
    WHEN (s.detail->>'ledger_reconciles')::boolean IS NOT TRUE
      THEN 'requires_reconciliation'
    WHEN upper(btrim(w.currency::text)) = upper(btrim(a.detail->>'currency'))
      THEN 'aligned'
    WHEN w.balance_cents = 0
      AND (s.detail->>'ledger_entry_count')::bigint = 0
      AND (s.detail->>'campaign_count')::bigint = 0
      THEN 'safe_zero_recreate'
    ELSE 'requires_reconciliation'
  END,
  a.detail
FROM public.ad_credit_wallets w
CROSS JOIN LATERAL (
  SELECT public.ad_brand_currency_authority(w.brand_id) AS detail
) a
CROSS JOIN LATERAL (
  SELECT public.ad_currency_reconciliation_snapshot(w.brand_id) AS detail
) s
ON CONFLICT (brand_id) DO UPDATE
SET wallet_currency = EXCLUDED.wallet_currency,
    authority_currency = EXCLUDED.authority_currency,
    wallet_balance_cents = EXCLUDED.wallet_balance_cents,
    ledger_entry_count = EXCLUDED.ledger_entry_count,
    ledger_balance_cents = EXCLUDED.ledger_balance_cents,
    ledger_terminal_balance_cents = EXCLUDED.ledger_terminal_balance_cents,
    ledger_reconciles = EXCLUDED.ledger_reconciles,
    campaign_count = EXCLUDED.campaign_count,
    provider_liability_by_currency = EXCLUDED.provider_liability_by_currency,
    provider_liability_campaigns = EXCLUDED.provider_liability_campaigns,
    classification = EXCLUDED.classification,
    authority_detail = EXCLUDED.authority_detail,
    classified_at = now();

-- The only automatic rewrite is a zero-value wallet with no ledger or campaign
-- history. No historical minor unit can be reinterpreted by this statement.
UPDATE public.ad_credit_wallets w
SET currency = a.authority_currency,
    authority_currency = a.authority_currency,
    currency_status = 'aligned',
    updated_at = now()
FROM public.ad_currency_migration_audit a
WHERE a.brand_id = w.brand_id
  AND a.classification = 'safe_zero_recreate';

UPDATE public.ad_credit_wallets w
SET authority_currency = a.authority_currency,
    currency_status = CASE a.classification
      WHEN 'aligned' THEN 'aligned'
      WHEN 'safe_zero_recreate' THEN 'aligned'
      WHEN 'authority_unresolved' THEN 'authority_unresolved'
      ELSE 'blocked_reconciliation'
    END,
    updated_at = now()
FROM public.ad_currency_migration_audit a
WHERE a.brand_id = w.brand_id;

ALTER TABLE public.ad_credit_wallets
  ALTER COLUMN currency DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.ad_credit_wallet_currency_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_currency text;
BEGIN
  v_currency := public.ad_require_brand_currency(NEW.brand_id);
  IF upper(btrim(NEW.currency::text)) <> v_currency THEN
    RAISE EXCEPTION 'ad_credit_currency_authority_mismatch'
      USING ERRCODE = '22023';
  END IF;
  NEW.currency := v_currency::char(3);
  NEW.authority_currency := v_currency::char(3);
  NEW.currency_status := 'aligned';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ad_credit_wallet_currency_authority
  ON public.ad_credit_wallets;
CREATE TRIGGER ad_credit_wallet_currency_authority
  BEFORE INSERT OR UPDATE OF currency ON public.ad_credit_wallets
  FOR EACH ROW EXECUTE FUNCTION public.ad_credit_wallet_currency_guard();

REVOKE ALL ON FUNCTION public.ad_credit_wallet_currency_guard()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ad_credit_ledger_currency_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_currency text;
BEGIN
  v_currency := public.ad_require_brand_currency(NEW.brand_id);
  IF upper(btrim(NEW.currency::text)) <> v_currency THEN
    RAISE EXCEPTION 'ad_credit_currency_authority_mismatch'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ad_credit_ledger_currency_authority
  ON public.ad_credit_ledger;
CREATE TRIGGER ad_credit_ledger_currency_authority
  BEFORE INSERT ON public.ad_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ad_credit_ledger_currency_guard();

REVOKE ALL ON FUNCTION public.ad_credit_ledger_currency_guard()
  FROM PUBLIC, anon, authenticated;

-- A campaign now records customer/Host currency separately from the provider
-- account currency. The legacy currency column remains the customer-facing
-- currency for Host rows and equals provider_currency for Mingla rows.
ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS host_currency text NULL,
  ADD COLUMN IF NOT EXISTS provider_currency text NULL,
  ADD COLUMN IF NOT EXISTS currency_status text NOT NULL
    DEFAULT 'legacy_unclassified';

ALTER TABLE public.ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_host_currency_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_host_currency_check CHECK (
    host_currency IS NULL OR host_currency ~ '^[A-Z]{3}$'
  );
ALTER TABLE public.ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_provider_currency_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_provider_currency_check CHECK (
    provider_currency IS NULL OR provider_currency ~ '^[A-Z]{3}$'
  );
ALTER TABLE public.ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_currency_status_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_currency_status_check CHECK (
    currency_status IN (
      'legacy_unclassified', 'aligned',
      'authority_unresolved', 'blocked_reconciliation'
    )
  );

UPDATE public.ad_campaigns c
SET provider_currency = upper(btrim(ac.currency))
FROM public.ad_connections ac
WHERE ac.id = c.connection_id
  AND ac.currency IS NOT NULL
  AND upper(btrim(ac.currency)) ~ '^[A-Z]{3}$';

WITH campaign_authority AS (
  SELECT
    c.id,
    public.ad_brand_currency_authority(c.brand_id) AS detail
  FROM public.ad_campaigns c
  WHERE c.owner_kind = 'mingla' OR c.brand_id IS NOT NULL
)
UPDATE public.ad_campaigns c
SET host_currency = CASE WHEN c.owner_kind = 'host'
      THEN NULLIF(a.detail->>'currency', '') ELSE NULL END,
    currency_status = CASE
      WHEN c.owner_kind = 'host'
       AND coalesce((a.detail->>'resolved')::boolean, false) IS TRUE
       AND upper(btrim(c.currency)) = upper(btrim(a.detail->>'currency'))
       AND c.provider_currency IS NOT NULL
        THEN 'aligned'
      WHEN c.owner_kind = 'host'
       AND coalesce((a.detail->>'resolved')::boolean, false) IS NOT TRUE
        THEN 'authority_unresolved'
      WHEN c.owner_kind = 'host'
        THEN 'blocked_reconciliation'
      WHEN c.owner_kind = 'mingla'
       AND c.provider_currency IS NOT NULL
       AND upper(btrim(c.currency)) = c.provider_currency
        THEN 'aligned'
      WHEN c.owner_kind = 'mingla'
        THEN 'blocked_reconciliation'
      ELSE 'legacy_unclassified'
    END
FROM campaign_authority a
WHERE a.id = c.id;

ALTER TABLE public.ad_campaigns
  ALTER COLUMN currency DROP DEFAULT;
ALTER TABLE public.ad_spend_daily
  ALTER COLUMN currency DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.ad_campaign_currency_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_provider_currency text;
  v_host_currency text;
BEGIN
  SELECT upper(btrim(coalesce(c.currency, '')))
    INTO v_provider_currency
  FROM public.ad_connections c
  WHERE c.id = NEW.connection_id
    AND c.connected IS TRUE
    AND c.status = 'connected';

  IF v_provider_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'ad_connection_currency_unresolved'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.provider_currency IS NOT NULL
     AND upper(btrim(NEW.provider_currency)) <> v_provider_currency THEN
    RAISE EXCEPTION 'ad_connection_currency_mismatch'
      USING ERRCODE = '22023';
  END IF;
  NEW.provider_currency := v_provider_currency;

  IF NEW.owner_kind = 'host' THEN
    IF NEW.brand_id IS NULL THEN
      RAISE EXCEPTION 'ad_host_brand_required' USING ERRCODE = '22023';
    END IF;
    v_host_currency := public.ad_require_brand_currency(NEW.brand_id);
    IF upper(btrim(coalesce(NEW.currency, ''))) <> v_host_currency
       OR (
         NEW.host_currency IS NOT NULL
         AND upper(btrim(NEW.host_currency)) <> v_host_currency
       ) THEN
      RAISE EXCEPTION 'ad_host_currency_authority_mismatch'
        USING ERRCODE = '22023';
    END IF;
    NEW.currency := v_host_currency;
    NEW.host_currency := v_host_currency;
  ELSIF NEW.owner_kind = 'mingla' THEN
    IF upper(btrim(coalesce(NEW.currency, ''))) <> v_provider_currency THEN
      RAISE EXCEPTION 'ad_connection_currency_mismatch'
        USING ERRCODE = '22023';
    END IF;
    NEW.currency := v_provider_currency;
    NEW.host_currency := NULL;
  ELSE
    RAISE EXCEPTION 'ad_owner_kind_invalid' USING ERRCODE = '22023';
  END IF;

  NEW.currency_status := 'aligned';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ad_campaign_currency_authority
  ON public.ad_campaigns;
CREATE TRIGGER ad_campaign_currency_authority
  BEFORE INSERT OR UPDATE OF owner_kind, brand_id, connection_id, currency,
    host_currency, provider_currency
  ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.ad_campaign_currency_guard();

REVOKE ALL ON FUNCTION public.ad_campaign_currency_guard()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ad_spend_currency_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_provider_currency text;
BEGIN
  SELECT c.provider_currency INTO v_provider_currency
  FROM public.ad_campaigns c
  WHERE c.id = NEW.campaign_id;

  IF v_provider_currency IS NULL
     OR v_provider_currency !~ '^[A-Z]{3}$'
     OR upper(btrim(NEW.currency)) <> v_provider_currency THEN
    RAISE EXCEPTION 'ad_spend_currency_mismatch' USING ERRCODE = '22023';
  END IF;
  NEW.currency := v_provider_currency;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ad_spend_currency_authority
  ON public.ad_spend_daily;
CREATE TRIGGER ad_spend_currency_authority
  BEFORE INSERT OR UPDATE OF campaign_id, currency
  ON public.ad_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.ad_spend_currency_guard();

REVOKE ALL ON FUNCTION public.ad_spend_currency_guard()
  FROM PUBLIC, anon, authenticated;

-- Persist the after-image separately. Values are not overwritten, so an
-- operator can prove whether replay changed any wallet, ledger-derived balance
-- or provider liability and can refuse cutover on an unexplained delta.
WITH post_snapshot AS (
  SELECT
    a.brand_id,
    public.ad_currency_reconciliation_snapshot(a.brand_id) AS detail
  FROM public.ad_currency_migration_audit a
)
UPDATE public.ad_currency_migration_audit a
SET post_wallet_currency = s.detail->>'wallet_currency',
    post_wallet_balance_cents =
      (s.detail->>'wallet_balance_cents')::bigint,
    post_ledger_balance_cents =
      (s.detail->>'ledger_balance_cents')::bigint,
    post_ledger_terminal_balance_cents =
      (s.detail->>'ledger_terminal_balance_cents')::bigint,
    post_ledger_reconciles =
      (s.detail->>'ledger_reconciles')::boolean,
    post_provider_liability_by_currency =
      s.detail->'provider_liability_by_currency',
    post_provider_liability_campaigns =
      s.detail->'provider_liability_campaigns'
FROM post_snapshot s
WHERE s.brand_id = a.brand_id;

COMMENT ON COLUMN public.ad_campaigns.currency IS
  'Issue #3697 v1.4: customer-facing currency. Host rows use verified brand settlement currency; Mingla rows equal provider_currency.';
COMMENT ON COLUMN public.ad_campaigns.host_currency IS
  'Issue #3697 v1.4: verified Host settlement currency; NULL for Mingla-owned campaigns.';
COMMENT ON COLUMN public.ad_campaigns.provider_currency IS
  'Issue #3697 v1.4: selected ad_connections currency; ad_spend_daily is always denominated in this currency.';

COMMIT;
