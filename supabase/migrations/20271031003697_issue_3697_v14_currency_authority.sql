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

-- Durable audit: every pre-v1.4 wallet gets an explicit classification. This
-- is evidence for V1.4-21 and the operator queue for rows that carry value.
CREATE TABLE IF NOT EXISTS public.ad_currency_migration_audit (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE RESTRICT,
  wallet_currency char(3) NOT NULL,
  authority_currency char(3),
  wallet_balance_cents bigint NOT NULL,
  ledger_entry_count bigint NOT NULL,
  campaign_count bigint NOT NULL,
  classification text NOT NULL CHECK (classification IN (
    'aligned',
    'safe_zero_recreate',
    'authority_unresolved',
    'requires_reconciliation'
  )),
  authority_detail jsonb NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz NULL,
  reconciliation_note text NULL
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
  ledger_entry_count, campaign_count, classification, authority_detail
)
SELECT
  w.brand_id,
  w.currency,
  CASE
    WHEN coalesce((a.detail->>'resolved')::boolean, false) IS TRUE
      THEN NULLIF(a.detail->>'currency', '')::char(3)
    ELSE NULL
  END,
  w.balance_cents,
  counts.ledger_count,
  counts.campaign_count,
  CASE
    WHEN coalesce((a.detail->>'resolved')::boolean, false) IS NOT TRUE
      THEN 'authority_unresolved'
    WHEN upper(btrim(w.currency::text)) = upper(btrim(a.detail->>'currency'))
      THEN 'aligned'
    WHEN w.balance_cents = 0
      AND counts.ledger_count = 0
      AND counts.campaign_count = 0
      THEN 'safe_zero_recreate'
    ELSE 'requires_reconciliation'
  END,
  a.detail
FROM public.ad_credit_wallets w
CROSS JOIN LATERAL (
  SELECT public.ad_brand_currency_authority(w.brand_id) AS detail
) a
CROSS JOIN LATERAL (
  SELECT
    (SELECT count(*) FROM public.ad_credit_ledger l
      WHERE l.brand_id = w.brand_id) AS ledger_count,
    (SELECT count(*) FROM public.ad_campaigns c
      WHERE c.brand_id = w.brand_id AND c.owner_kind = 'host') AS campaign_count
) counts
ON CONFLICT (brand_id) DO UPDATE
SET wallet_currency = EXCLUDED.wallet_currency,
    authority_currency = EXCLUDED.authority_currency,
    wallet_balance_cents = EXCLUDED.wallet_balance_cents,
    ledger_entry_count = EXCLUDED.ledger_entry_count,
    campaign_count = EXCLUDED.campaign_count,
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

COMMENT ON COLUMN public.ad_campaigns.currency IS
  'Issue #3697 v1.4: customer-facing currency. Host rows use verified brand settlement currency; Mingla rows equal provider_currency.';
COMMENT ON COLUMN public.ad_campaigns.host_currency IS
  'Issue #3697 v1.4: verified Host settlement currency; NULL for Mingla-owned campaigns.';
COMMENT ON COLUMN public.ad_campaigns.provider_currency IS
  'Issue #3697 v1.4: selected ad_connections currency; ad_spend_daily is always denominated in this currency.';

COMMIT;
