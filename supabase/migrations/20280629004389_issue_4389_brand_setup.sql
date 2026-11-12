-- Issue #4389 — brand setup with the minimum information.
--
-- One truth for a brand's money country, the brand_setup checklist, the
-- payments-setup lock window, the Tap to Pay fallback address, draft brands,
-- a delete that closes payment accounts, and a fail-closed VAT country.
--
-- MINGLA-INVARIANT: I-4389-COUNTRY-ONE-TRUTH | issue #4389 | brands.payout_country is the money country; default_currency, payment_provider and payment_country are derived from it by issue_4389_brand_country_derive and it locks once a payment account exists or a payments setup started in the last 15 minutes.
-- MINGLA-INVARIANT: I-4389-SETUP-DONE-IS-SERVER | issue #4389 | "setup finished" is only brand_readiness(brand_setup) with no blocking items (exactly 4 items: brand.name, money.market, money.terms_member, money.details_submitted).
-- MINGLA-INVARIANT: I-4389-DELETE-CLOSES-PROVIDERS | issue #4389 | a brand with an attached payment account reaches deleted_at only through issue_4389_finish_brand_delete (guard issue_4389_guard_brand_delete_providers).
-- MINGLA-INVARIANT: I-4389-NO-ZERO-VAT-FALLBACK | issue #4389 | resolve_event_pricing_inputs reports vat_country_missing for a Paystack brand with no payment_country; checkout refuses instead of computing 0% VAT.
--
-- Static SQL only. Conflicts raise PT409 (never 40001). Every replaced function
-- is copied from its latest definition. Ends in a self-assert block.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS payments_setup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS tap_location_address jsonb,
  ADD COLUMN IF NOT EXISTS setup_free_only_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.brands'::regclass
      AND conname = 'brands_tap_location_address_shape'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_tap_location_address_shape
      CHECK (tap_location_address IS NULL OR (
        jsonb_typeof(tap_location_address) = 'object'
        AND tap_location_address ? 'line1'
        AND tap_location_address ? 'city'
        AND tap_location_address ? 'country'
      ));
  END IF;
END;
$$;

COMMENT ON COLUMN public.brands.payout_country IS
  'Issue #4389: THE money country (the country of the bank that is paid out). default_currency, payment_provider and payment_country are derived from it by trigger issue_4389_brand_country_derive (map: payout_country_rail). Written through biz_set_brand_payout_country; locked once a payment account exists or a payments setup started in the last 15 minutes. Supersedes the #3645 display-only note.';
COMMENT ON COLUMN public.brands.payments_setup_started_at IS
  'Issue #4389: stamped by biz_begin_payments_setup before any payment-partner call; locks payout_country for 15 minutes (R-2/R-3).';
COMMENT ON COLUMN public.brands.tap_location_address IS
  'Issue #4389: Tap to Pay card-payments address {line1,line2,city,state,postal_code,country}. Fallback only (T1), used when the payment account holds no usable address. Written by biz_set_tap_location_address. Never shown to guests.';
COMMENT ON COLUMN public.brands.setup_free_only_at IS
  'Issue #4389: the host chose "Free events only for now" (K1). A brand with this set is not a draft.';

-- ── 2. The one country map ─────────────────────────────────────────────────
-- 34 Stripe countries + Nigeria (Paystack). BG is EUR: Stripe refuses BGN
-- bank accounts since 2026-01-01 (#4389 D8). Parity with the three TS lists
-- is pinned by tests.
-- The map is a table, not a list inside a function: every currency in it is
-- a foreign key into supported_brand_currencies, the one currency allow-list
-- (#3645 one offering currency source).
CREATE TABLE IF NOT EXISTS public.payout_country_rails (
  country character(2) PRIMARY KEY CHECK (country = upper(country)),
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  currency character(3) NOT NULL REFERENCES public.supported_brand_currencies (code),
  tap_to_pay boolean NOT NULL DEFAULT false
);
ALTER TABLE public.payout_country_rails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_country_rails FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payout_country_rails TO service_role;
COMMENT ON TABLE public.payout_country_rails IS
  'Issue #4389: bank country -> payment partner, payout currency and Tap to Pay eligibility. Read only through payout_country_rail(text). No client reads it directly (RLS on, no policies).';

INSERT INTO public.payout_country_rails (country, provider, currency, tap_to_pay) VALUES
    ('US','stripe','USD',true),  ('GB','stripe','GBP',true),
    ('CA','stripe','CAD',false), ('CH','stripe','CHF',false),
    ('AT','stripe','EUR',false), ('BE','stripe','EUR',false),
    ('BG','stripe','EUR',false), ('CY','stripe','EUR',false),
    ('CZ','stripe','CZK',false), ('DE','stripe','EUR',false),
    ('DK','stripe','DKK',false), ('EE','stripe','EUR',false),
    ('ES','stripe','EUR',false), ('FI','stripe','EUR',false),
    ('FR','stripe','EUR',false), ('GR','stripe','EUR',false),
    ('HR','stripe','EUR',false), ('HU','stripe','HUF',false),
    ('IE','stripe','EUR',false), ('IS','stripe','ISK',false),
    ('IT','stripe','EUR',false), ('LI','stripe','CHF',false),
    ('LT','stripe','EUR',false), ('LU','stripe','EUR',false),
    ('LV','stripe','EUR',false), ('MT','stripe','EUR',false),
    ('NL','stripe','EUR',false), ('NO','stripe','NOK',false),
    ('PL','stripe','PLN',false), ('PT','stripe','EUR',false),
    ('RO','stripe','RON',false), ('SE','stripe','SEK',false),
    ('SI','stripe','EUR',false), ('SK','stripe','EUR',false),
    ('NG','paystack','NGN',false)
ON CONFLICT (country) DO UPDATE
  SET provider = EXCLUDED.provider, currency = EXCLUDED.currency, tap_to_pay = EXCLUDED.tap_to_pay;

CREATE OR REPLACE FUNCTION public.payout_country_rail(p_country text)
RETURNS TABLE(provider text, currency text, tap_to_pay boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT m.provider, m.currency::text, m.tap_to_pay
  FROM public.payout_country_rails m
  WHERE m.country = upper(btrim(COALESCE(p_country, '')))::character(2)
    AND pg_catalog.length(btrim(COALESCE(p_country, ''))) = 2;
$function$;
REVOKE ALL ON FUNCTION public.payout_country_rail(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payout_country_rail(text)
  TO anon, authenticated, service_role;

-- ── 3. Derive trigger + lock ───────────────────────────────────────────────
-- Fires only when the statement writes payout_country. Writers that change
-- only default_currency (Paystack select/clear, Stripe sync) are untouched.
-- biz_set_brand_payout_country writes the derived columns in the same SET so
-- every column trigger on default_currency still runs.
CREATE OR REPLACE FUNCTION public.issue_4389_brand_country_derive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_currency text;
  v_sca_country text;
  v_new text;
BEGIN
  v_new := NULLIF(upper(btrim(COALESCE(NEW.payout_country, ''))), '');
  NEW.payout_country := v_new;

  IF TG_OP = 'UPDATE' AND v_new IS NOT DISTINCT FROM OLD.payout_country THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Lock (#4389 R-2/R-3). Setting the first value to the account's own
    -- country is allowed (backfill / legacy brands); any other change is not.
    SELECT btrim(sca.country) INTO v_sca_country
    FROM public.stripe_connect_accounts sca
    WHERE sca.brand_id = NEW.id AND sca.detached_at IS NULL
    LIMIT 1;
    IF v_sca_country IS NOT NULL
       AND (OLD.payout_country IS NOT NULL OR v_new IS DISTINCT FROM v_sca_country) THEN
      RAISE EXCEPTION 'payout_country_locked' USING ERRCODE = 'PT409',
        DETAIL = 'payment_account_exists';
    END IF;
    IF OLD.paystack_subaccount_code IS NOT NULL
       AND (OLD.payout_country IS NOT NULL OR v_new IS DISTINCT FROM 'NG') THEN
      RAISE EXCEPTION 'payout_country_locked' USING ERRCODE = 'PT409',
        DETAIL = 'payment_account_exists';
    END IF;
    IF OLD.payments_setup_started_at IS NOT NULL
       AND OLD.payments_setup_started_at > now() - interval '15 minutes'
       AND OLD.payout_country IS NOT NULL THEN
      RAISE EXCEPTION 'payout_country_locked' USING ERRCODE = 'PT409',
        DETAIL = 'payments_setup_in_progress';
    END IF;
  END IF;

  IF v_new IS NULL THEN
    NEW.payment_country := NULL;
    IF NEW.payment_provider = 'paystack' AND NEW.paystack_subaccount_code IS NULL THEN
      NEW.payment_provider := 'stripe';
    END IF;
    IF NEW.default_currency = 'NGN' THEN
      NEW.default_currency := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT r.provider, r.currency INTO v_provider, v_currency
  FROM public.payout_country_rail(v_new) r;
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'payout_country_unsupported' USING ERRCODE = '22023';
  END IF;

  NEW.default_currency := v_currency;
  NEW.payment_provider := v_provider;
  NEW.payment_country := CASE WHEN v_provider = 'paystack' THEN v_new END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_brand_country_derive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4389_brand_country_derive ON public.brands;
CREATE TRIGGER issue_4389_brand_country_derive
  BEFORE INSERT OR UPDATE OF payout_country ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.issue_4389_brand_country_derive();

-- ── 4. Set the bank country (F2, Ari) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_set_brand_payout_country(
  p_brand_id uuid,
  p_country text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_country text := NULLIF(upper(btrim(COALESCE(p_country, ''))), '');
  v_provider text;
  v_currency text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_brand FROM public.brands
  WHERE id = p_brand_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.provider, r.currency INTO v_provider, v_currency
  FROM public.payout_country_rail(v_country) r;
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'payout_country_unsupported' USING ERRCODE = '22023';
  END IF;

  IF v_brand.payout_country IS DISTINCT FROM v_country THEN
    UPDATE public.brands
    SET payout_country = v_country,
        default_currency = v_currency,
        payment_provider = v_provider,
        payment_country = CASE WHEN v_provider = 'paystack' THEN v_country END
    WHERE id = p_brand_id
    RETURNING * INTO v_brand;
  END IF;

  RETURN jsonb_build_object(
    'payout_country', v_brand.payout_country,
    'default_currency', btrim(v_brand.default_currency),
    'payment_provider', v_brand.payment_provider
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_set_brand_payout_country(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_brand_payout_country(uuid,text)
  TO authenticated, service_role;

-- ── 5. Setup facts (one owner of "what is done") ───────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4389_brand_setup_facts(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_sca public.stripe_connect_accounts%ROWTYPE;
  v_provider text;
  v_market boolean;
  v_terms boolean;
  v_details boolean := false;
  v_stripe_state text := 'none';
  v_due jsonb := '[]'::jsonb;
  v_waiting text;
  v_published boolean;
  v_complete boolean;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_market := v_brand.payout_country IS NOT NULL;
  SELECT r.provider INTO v_provider FROM public.payout_country_rail(v_brand.payout_country) r;
  v_provider := COALESCE(v_provider, v_brand.payment_provider, 'stripe');

  v_terms := EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id AND m.user_id = v_brand.account_id
      AND m.removed_at IS NULL
      AND m.mingla_tos_version_accepted = '1.0'
      AND m.mingla_tos_accepted_at IS NOT NULL
  );

  IF v_provider = 'paystack' THEN
    v_details := v_brand.paystack_subaccount_code IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.brand_paystack_recipients r
      WHERE r.brand_id = p_brand_id AND r.is_active IS TRUE);
  ELSE
    SELECT * INTO v_sca FROM public.stripe_connect_accounts
    WHERE brand_id = p_brand_id AND detached_at IS NULL;
    IF v_sca.id IS NOT NULL THEN
      v_due := CASE WHEN jsonb_typeof(v_sca.requirements->'currently_due') = 'array'
        THEN v_sca.requirements->'currently_due' ELSE '[]'::jsonb END
        || CASE WHEN jsonb_typeof(v_sca.requirements->'past_due') = 'array'
        THEN v_sca.requirements->'past_due' ELSE '[]'::jsonb END;
      -- Pending verification counts as submitted. A freshly created account
      -- whose requirements were never read (no currently_due key) is only
      -- "started".
      IF v_sca.charges_enabled IS TRUE
         OR (jsonb_typeof(v_sca.requirements->'currently_due') = 'array'
             AND jsonb_array_length(v_due) = 0) THEN
        v_details := true;
        v_stripe_state := 'submitted';
      ELSIF jsonb_typeof(v_sca.requirements->'currently_due') = 'array' THEN
        v_stripe_state := 'action_needed';
      ELSE
        v_stripe_state := 'started';
      END IF;
    END IF;
  END IF;

  SELECT l.invited_owner_email INTO v_waiting
  FROM public.partner_brand_links l
  WHERE l.brand_id = p_brand_id AND l.cancelled_at IS NULL AND l.accepted_at IS NULL
  ORDER BY l.invited_at DESC LIMIT 1;

  v_published := EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL AND e.status <> 'draft');
  v_complete := v_market AND v_terms AND v_details;

  RETURN jsonb_build_object(
    'payout_country', v_brand.payout_country,
    'currency', btrim(v_brand.default_currency),
    'provider', v_provider,
    'market', v_market,
    'terms', v_terms,
    'details', v_details,
    'stripe_state', v_stripe_state,
    'due', v_due,
    'waiting_for', v_waiting,
    'complete', v_complete,
    'free_only_at', v_brand.setup_free_only_at,
    'payments_setup_started_at', v_brand.payments_setup_started_at,
    'published', v_published,
    'is_draft', NOT v_complete AND v_brand.setup_free_only_at IS NULL AND NOT v_published
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_brand_setup_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_brand_setup_facts(uuid) TO service_role;

-- The caller's newest draft (one draft per host at a time, S-12).
CREATE OR REPLACE FUNCTION public.issue_4389_user_draft_brand(
  p_user_id uuid,
  p_exclude_brand_id uuid DEFAULT NULL
) RETURNS TABLE(brand_id uuid, brand_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT b.id, b.name, b.created_at
  FROM public.brands b
  WHERE b.account_id = p_user_id
    AND b.deleted_at IS NULL
    AND b.id IS DISTINCT FROM p_exclude_brand_id
    AND b.kind IS DISTINCT FROM 'physical'
    AND (public.issue_4389_brand_setup_facts(b.id)->>'is_draft')::boolean
  ORDER BY b.created_at DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_user_draft_brand(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_user_draft_brand(uuid,uuid) TO service_role;

-- ── 6. Idempotent create (F1), with the one-draft guard ────────────────────
-- The client generates the brand id when F1 mounts (R-1). A retry, a second
-- tap or a retry after a lost response returns the same brand.
CREATE OR REPLACE FUNCTION public.biz_create_setup_brand(
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_partner_setup boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(COALESCE(p_name, ''));
  v_slug text := lower(btrim(COALESCE(p_slug, '')));
  v_existing public.brands%ROWTYPE;
  v_draft record;
  v_inserted uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_id_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'invalid_brand_name' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_slug) NOT BETWEEN 1 AND 60
     OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid_brand_slug' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.brands WHERE id = p_brand_id;
  IF FOUND THEN
    IF v_existing.account_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_existing.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('ok', true, 'brand_id', v_existing.id, 'created', false);
  END IF;

  SELECT * INTO v_draft FROM public.issue_4389_user_draft_brand(v_uid, p_brand_id);
  IF v_draft.brand_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'draft_exists',
      'brand_id', v_draft.brand_id, 'brand_name', v_draft.brand_name);
  END IF;

  IF EXISTS (SELECT 1 FROM public.brands WHERE slug = v_slug) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slug_taken');
  END IF;

  INSERT INTO public.brands (id, account_id, name, slug, partner_setup)
  VALUES (p_brand_id, v_uid, v_name, v_slug, COALESCE(p_partner_setup, false))
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted;

  RETURN jsonb_build_object('ok', true, 'brand_id', p_brand_id,
    'created', v_inserted IS NOT NULL);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'slug_taken');
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_create_setup_brand(uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_create_setup_brand(uuid,text,text,boolean)
  TO authenticated, service_role;

-- K1 "Free events only for now": the brand stops being a draft.
CREATE OR REPLACE FUNCTION public.biz_mark_brand_setup_free_only(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.brands
  SET setup_free_only_at = COALESCE(setup_free_only_at, now())
  WHERE id = p_brand_id AND deleted_at IS NULL
  RETURNING setup_free_only_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('brand_id', p_brand_id, 'setup_free_only_at', v_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_mark_brand_setup_free_only(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_mark_brand_setup_free_only(uuid) TO authenticated, service_role;

-- ── 7. Begin payments setup (before any partner call) ──────────────────────
CREATE OR REPLACE FUNCTION public.issue_4389_begin_payments_setup_internal(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_provider text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_brand FROM public.brands
  WHERE id = p_brand_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.biz_can_mutate_payouts_for_brand(p_brand_id, p_user_id), false) THEN
    RAISE EXCEPTION 'requires_owner' USING ERRCODE = '42501';
  END IF;
  IF v_brand.payout_country IS NULL THEN
    RAISE EXCEPTION 'payout_country_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND m.mingla_tos_version_accepted = '1.0'
      AND m.mingla_tos_accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'terms_required' USING ERRCODE = '22023';
  END IF;
  SELECT r.provider INTO v_provider FROM public.payout_country_rail(v_brand.payout_country) r;

  UPDATE public.brands SET payments_setup_started_at = now() WHERE id = p_brand_id;

  RETURN jsonb_build_object('payout_country', v_brand.payout_country,
    'provider', COALESCE(v_provider, v_brand.payment_provider));
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_begin_payments_setup_internal(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_begin_payments_setup_internal(uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.biz_begin_payments_setup(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.issue_4389_begin_payments_setup_internal(p_brand_id, auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_begin_payments_setup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_begin_payments_setup(uuid) TO authenticated, service_role;

-- ── 8. Tap to Pay fallback address (T1) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_set_tap_location_address(
  p_brand_id uuid,
  p_address jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_line1 text;
  v_line2 text;
  v_city text;
  v_state text;
  v_postal text;
  v_country text;
  v_clean jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_brand FROM public.brands
  WHERE id = p_brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023';
  END IF;

  v_line1 := NULLIF(btrim(COALESCE(p_address->>'line1', '')), '');
  v_line2 := NULLIF(btrim(COALESCE(p_address->>'line2', '')), '');
  v_city := NULLIF(btrim(COALESCE(p_address->>'city', '')), '');
  v_state := NULLIF(upper(btrim(COALESCE(p_address->>'state', ''))), '');
  v_postal := NULLIF(upper(btrim(COALESCE(p_address->>'postal_code', ''))), '');
  v_country := NULLIF(upper(btrim(COALESCE(p_address->>'country', ''))), '');

  IF v_country IS DISTINCT FROM v_brand.payout_country THEN
    RAISE EXCEPTION 'address_country_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_line1 IS NULL OR char_length(v_line1) > 200
     OR v_city IS NULL OR char_length(v_city) > 100
     OR char_length(COALESCE(v_line2, '')) > 200 THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023';
  END IF;
  -- Tap to Pay needs a building number on the street line.
  IF v_line1 !~ '[0-9]' THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023', DETAIL = 'line1_number';
  END IF;
  IF v_country = 'US' THEN
    IF v_state IS NULL OR v_state NOT IN (
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
      'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
      'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY') THEN
      RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023', DETAIL = 'state';
    END IF;
    IF v_postal IS NULL OR v_postal !~ '^[0-9]{5}(-[0-9]{4})?$' THEN
      RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023', DETAIL = 'postal_code';
    END IF;
  ELSIF v_country = 'GB' THEN
    v_postal := regexp_replace(COALESCE(v_postal, ''), '\s+', '', 'g');
    IF v_postal !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' THEN
      RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023', DETAIL = 'postal_code';
    END IF;
    v_postal := left(v_postal, char_length(v_postal) - 3) || ' ' || right(v_postal, 3);
  ELSE
    RAISE EXCEPTION 'tap_not_available' USING ERRCODE = '22023';
  END IF;

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'line1', v_line1, 'line2', v_line2, 'city', v_city,
    'state', v_state, 'postal_code', v_postal, 'country', v_country));
  UPDATE public.brands SET tap_location_address = v_clean WHERE id = p_brand_id;
  RETURN jsonb_build_object('brand_id', p_brand_id, 'tap_location_address', v_clean);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_set_tap_location_address(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_tap_location_address(uuid,jsonb)
  TO authenticated, service_role;

-- ── 9. Readiness: action brand_setup (exactly 4 items) ─────────────────────
ALTER TABLE public.brand_readiness_catalog
  DROP CONSTRAINT IF EXISTS brand_readiness_catalog_actions_ck;
ALTER TABLE public.brand_readiness_catalog
  ADD CONSTRAINT brand_readiness_catalog_actions_ck CHECK (
    blocking_for <@ ARRAY[
      'draft_save','publish_free','publish_paid','trip_installments',
      'venue_submit','stay_publish','website_build','website_publish',
      'refund','bank_setup','brand_setup'
    ]::text[]
    AND recommended_for <@ ARRAY[
      'draft_save','publish_free','publish_paid','trip_installments',
      'venue_submit','stay_publish','website_build','website_publish',
      'refund','bank_setup','brand_setup'
    ]::text[]
  );

INSERT INTO public.brand_readiness_catalog(
  key,item_group,label,sort,scope,owner_action,ask,route_template,route_label,
  min_role,server_predicate,is_deferrable,blocking_for,recommended_for
) VALUES
  ('brand.name','identity','Brand name',5,'action','answer',
    '{"control":"text","constraints":{"min":1,"max":60},"audience":"public"}',
    '/brand/{brand_id}/setup?step=name','Brand setup','brand_admin',NULL,false,
    ARRAY['brand_setup'],ARRAY[]::text[]),
  ('money.details_submitted','money','Payment details',365,'action','external',
    '{"control":"handoff","constraints":{"handoff":"payment_onboarding"},"audience":"private"}',
    '/brand/{brand_id}/setup?step=pay','Brand setup','brand_owner',
    'biz_can_mutate_payouts_for_brand',false,
    ARRAY['brand_setup'],ARRAY[]::text[])
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, sort = EXCLUDED.sort, scope = EXCLUDED.scope,
  route_template = EXCLUDED.route_template, blocking_for = EXCLUDED.blocking_for;

UPDATE public.brand_readiness_catalog
SET blocking_for = array_append(blocking_for, 'brand_setup')
WHERE key IN ('money.market','money.terms_member')
  AND NOT ('brand_setup' = ANY(blocking_for));

-- Copied from 20280307003355_issue_3355_brand_readiness.sql (latest), with the
-- #4389 brand_setup branches marked.
CREATE OR REPLACE FUNCTION public.brand_readiness_internal(
  p_brand_id uuid,
  p_action text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_completeness jsonb;
  v_audit jsonb := '{}'::jsonb;
  v_field jsonb;
  v_cat public.brand_readiness_catalog%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_state text;
  v_preview text;
  v_blocking text[];
  v_blocks boolean;
  v_done boolean;
  v_deferral jsonb;
  v_can_fix boolean;
  v_route text;
  v_tagline text;
  v_parts text[];
  v_can_sell boolean;
  v_can_payout boolean;
  v_pending_recon public.brand_currency_reconciliations%ROWTYPE;
  v_stripe public.stripe_connect_accounts%ROWTYPE;
  v_has_stripe boolean;
  v_has_paystack boolean;
  v_hold_rail boolean;
  v_has_recipient boolean;
  v_rail text;
  v_sell_reason text;
  v_payout_reason text;
  v_terms_accepted boolean;
  v_review_due boolean;
  v_review_deadline timestamptz;
  v_blocking_count integer := 0;
  v_wait_count integer := 0;
  v_done_count integer := 0;
  v_deferred_count integer := 0;
  -- #4389
  v_setup jsonb;
  v_extra jsonb;
BEGIN
  IF p_action IS NOT NULL AND p_action NOT IN (
    'draft_save','publish_free','publish_paid','trip_installments',
    'venue_submit','stay_publish','website_build','website_publish',
    'refund','bank_setup','brand_setup'
  ) THEN
    RAISE EXCEPTION 'invalid_readiness_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  v_completeness := public.brand_context_completeness_internal(p_brand_id);
  FOR v_field IN SELECT value FROM jsonb_array_elements(v_completeness->'fields') LOOP
    v_audit := v_audit || jsonb_build_object(v_field->>'key', v_field);
  END LOOP;

  -- Tagline uses the Home split of brands.description (first of two or more
  -- paragraphs separated by a blank line), C4.
  SELECT array_agg(btrim(part, E' \t\r\n')) INTO v_parts
  FROM regexp_split_to_table(
    btrim(COALESCE(v_brand.description,''), E' \t\r\n'), E'\n\n+'
  ) part
  WHERE btrim(part, E' \t\r\n') <> '';
  v_tagline := CASE WHEN COALESCE(array_length(v_parts,1),0) >= 2 THEN v_parts[1] END;

  -- Money facts (canonical predicates; their bodies are not changed here).
  v_can_sell := COALESCE(public.pg_brand_can_collect(p_brand_id), false);
  v_can_payout := COALESCE(public.pg_brand_can_payout(p_brand_id), false);
  SELECT * INTO v_pending_recon FROM public.brand_currency_reconciliations
  WHERE brand_id = p_brand_id AND status = 'pending'
  ORDER BY initiated_at DESC LIMIT 1;
  SELECT * INTO v_stripe FROM public.stripe_connect_accounts
  WHERE brand_id = p_brand_id AND detached_at IS NULL AND stripe_account_id IS NOT NULL
  ORDER BY updated_at DESC LIMIT 1;
  v_has_stripe := v_stripe.id IS NOT NULL;
  v_has_paystack := v_brand.paystack_subaccount_code IS NOT NULL;
  v_hold_rail := v_brand.payment_provider = 'paystack'
    AND v_brand.payout_hold_cutover_at IS NOT NULL AND NOT v_has_paystack;
  v_has_recipient := EXISTS (
    SELECT 1 FROM public.brand_paystack_recipients r
    WHERE r.brand_id = p_brand_id AND r.is_active IS TRUE
  );
  v_rail := CASE
    WHEN v_brand.payment_provider = 'paystack' AND v_has_paystack THEN 'paystack'
    WHEN v_hold_rail THEN 'paystack_hold'
    WHEN v_has_stripe THEN 'stripe'
    WHEN v_has_paystack THEN 'paystack'
    ELSE 'none'
  END;
  v_review_due := v_has_stripe AND (
    NULLIF(v_stripe.requirements->>'disabled_reason','') IS NOT NULL
    OR (jsonb_typeof(v_stripe.requirements->'currently_due') = 'array'
      AND jsonb_array_length(v_stripe.requirements->'currently_due') > 0)
  );
  v_review_deadline := CASE
    WHEN v_has_stripe AND COALESCE(v_stripe.requirements->>'current_deadline','') ~ '^[0-9]{9,11}$'
      THEN to_timestamp((v_stripe.requirements->>'current_deadline')::bigint)
  END;
  v_sell_reason := CASE
    WHEN v_can_sell THEN 'ready'
    WHEN v_pending_recon.id IS NOT NULL THEN 'currency_reconciliation_pending'
    WHEN v_rail = 'none' THEN 'no_provider'
    WHEN v_has_stripe AND NULLIF(v_stripe.requirements->>'disabled_reason','') IS NOT NULL
      THEN 'provider_disabled'
    ELSE 'kyc_incomplete'
  END;
  v_payout_reason := CASE
    WHEN v_can_payout THEN 'ready'
    WHEN v_pending_recon.id IS NOT NULL THEN 'currency_reconciliation_pending'
    WHEN v_hold_rail AND NOT v_has_recipient THEN 'hold_rail_sell_before_bank'
    WHEN v_review_due THEN 'provider_review'
    WHEN v_has_stripe AND v_stripe.payouts_enabled IS NOT TRUE THEN 'payouts_disabled'
    ELSE 'no_bank'
  END;
  v_terms_accepted := CASE WHEN p_user_id IS NULL THEN NULL ELSE EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND m.mingla_tos_version_accepted = '1.0'
      AND m.mingla_tos_accepted_at IS NOT NULL
  ) END;

  -- #4389: the brand_setup checklist reads one set of facts.
  IF p_action = 'brand_setup' THEN
    v_setup := public.issue_4389_brand_setup_facts(p_brand_id);
  END IF;

  FOR v_cat IN SELECT * FROM public.brand_readiness_catalog ORDER BY sort, key LOOP
    -- #4389: brand_setup lists exactly its own 4 items.
    IF p_action = 'brand_setup' AND NOT ('brand_setup' = ANY(v_cat.blocking_for)) THEN
      CONTINUE;
    END IF;
    -- Action-scoped items appear only for the actions they concern.
    IF v_cat.scope = 'action' AND (
      p_action IS NULL
      OR NOT (p_action = ANY(v_cat.blocking_for) OR p_action = ANY(v_cat.recommended_for))
    ) THEN
      CONTINUE;
    END IF;

    v_blocking := v_cat.blocking_for;
    v_preview := NULL;
    v_field := v_audit->v_cat.key;

    IF v_field IS NOT NULL THEN
      -- #2830 audit item: its state and evidence are the truth.
      v_state := v_field->>'state';
      IF v_field->>'requirement' = 'optional' THEN
        v_blocking := array_remove(v_blocking, 'website_build');
      END IF;
      IF v_state NOT IN ('missing') THEN
        v_preview := CASE v_cat.key
          WHEN 'social_links' THEN (
            SELECT CASE WHEN count(*) = 1 THEN '1 link' ELSE count(*)::text || ' links' END
            FROM (
              SELECT 1 FROM jsonb_each_text(
                CASE WHEN jsonb_typeof(v_brand.social_links) = 'object'
                  THEN v_brand.social_links ELSE '{}'::jsonb END) e
              WHERE NULLIF(btrim(e.value),'') IS NOT NULL
              UNION ALL
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_brand.custom_links) = 'array'
                  THEN v_brand.custom_links ELSE '[]'::jsonb END) e
              WHERE jsonb_typeof(e) = 'object' AND NULLIF(btrim(COALESCE(e->>'url','')),'') IS NOT NULL
            ) links)
          WHEN 'city_country' THEN NULLIF(concat_ws(', ',
            NULLIF(btrim(COALESCE(v_brand.city,'')),''), v_brand.country_code),'')
          WHEN 'profile_photo' THEN 'Added'
          WHEN 'cover_media' THEN 'Added'
          WHEN 'theme' THEN 'Set'
          WHEN 'approved_plan' THEN 'Approved'
          WHEN 'design_key' THEN initcap(v_field->>'value')
          WHEN 'offerings_selected' THEN CASE
            WHEN jsonb_typeof(v_field->'value') = 'array'
              THEN jsonb_array_length(v_field->'value')::text || ' chosen' END
          ELSE left(v_field->>'value', 120)
        END;
      END IF;
    ELSIF v_cat.key = 'brand.name' THEN
      -- #4389: always complete once the row exists.
      v_state := 'verified';
      v_preview := left(v_brand.name, 120);
    ELSIF v_cat.key = 'money.details_submitted' THEN
      -- #4389: Stripe: undetached account with nothing currently/past due
      -- (pending verification counts); Paystack: subaccount or recipient.
      v_state := CASE WHEN (v_setup->>'details')::boolean THEN 'verified' ELSE 'missing' END;
      v_preview := CASE
        WHEN (v_setup->>'details')::boolean AND v_setup->>'provider' = 'paystack' THEN 'Bank connected'
        WHEN (v_setup->>'details')::boolean THEN 'Sent'
        WHEN v_setup->>'stripe_state' = 'action_needed' THEN 'One more thing'
        WHEN v_setup->>'stripe_state' = 'started' THEN 'Started' END;
    ELSIF v_cat.key = 'tagline' THEN
      v_state := CASE WHEN v_tagline IS NULL THEN 'missing'
        WHEN length(v_tagline) > 120 THEN 'invalid' ELSE 'verified' END;
      v_preview := left(v_tagline, 120);
    ELSIF v_cat.key = 'timezone' THEN
      v_state := CASE WHEN v_brand.default_timezone IS NULL THEN 'missing' ELSE 'verified' END;
      v_preview := v_brand.default_timezone;
    ELSIF v_cat.key = 'money.market' THEN
      IF p_action = 'brand_setup' THEN
        -- #4389: bank country set (the one truth).
        v_state := CASE WHEN v_brand.payout_country IS NULL THEN 'missing' ELSE 'verified' END;
        v_preview := CASE WHEN v_state = 'verified' THEN concat_ws(' · ',
          v_brand.payout_country, btrim(v_brand.default_currency)) END;
      ELSE
        v_state := CASE WHEN COALESCE(v_brand.payout_country, v_brand.payment_country) IS NULL
          THEN 'missing' ELSE 'verified' END;
        v_preview := CASE WHEN v_state = 'verified' THEN concat_ws(' · ',
          initcap(v_brand.payment_provider), COALESCE(v_brand.payout_country, v_brand.payment_country)) END;
      END IF;
    ELSIF v_cat.key = 'money.currency' THEN
      v_state := CASE WHEN v_brand.default_currency IS NULL THEN 'missing' ELSE 'verified' END;
      v_preview := v_brand.default_currency;
    ELSIF v_cat.key = 'money.currency_reconciliation' THEN
      v_state := CASE WHEN v_pending_recon.id IS NULL THEN 'verified' ELSE 'conflict' END;
      v_preview := CASE WHEN v_pending_recon.id IS NOT NULL THEN
        'Currency changing from ' || btrim(v_pending_recon.from_currency_code)
          || ' to ' || btrim(v_pending_recon.to_currency_code) END;
    ELSIF v_cat.key = 'money.can_sell' THEN
      v_state := CASE WHEN v_can_sell THEN 'verified' ELSE 'missing' END;
      v_preview := CASE WHEN v_can_sell THEN 'Ready' END;
    ELSIF v_cat.key = 'money.can_be_paid_out' THEN
      v_state := CASE WHEN v_can_payout THEN 'verified' ELSE 'missing' END;
      v_preview := CASE WHEN v_can_payout THEN 'Ready' END;
    ELSIF v_cat.key = 'money.provider_review' THEN
      v_state := CASE WHEN NOT v_has_stripe THEN 'not_applicable'
        WHEN v_review_due THEN 'missing' ELSE 'verified' END;
      v_preview := CASE WHEN v_review_due THEN 'Stripe needs more information'
        || COALESCE(' by ' || to_char(v_review_deadline AT TIME ZONE 'UTC', 'FMDD Mon YYYY'), '') END;
    ELSIF v_cat.key = 'money.terms_member' THEN
      IF p_action = 'brand_setup' THEN
        -- #4389: the brand owner's acceptance (payments are owner-only).
        v_state := CASE WHEN (v_setup->>'terms')::boolean THEN 'verified' ELSE 'missing' END;
        v_preview := CASE WHEN v_state = 'verified' THEN 'Accepted' END;
      ELSE
        v_state := CASE WHEN v_terms_accepted IS NULL THEN 'not_applicable'
          WHEN v_terms_accepted THEN 'verified' ELSE 'missing' END;
        v_preview := CASE WHEN v_terms_accepted THEN 'Accepted' END;
      END IF;
    ELSIF v_cat.key = 'money.tax_registration' THEN
      v_state := CASE
        WHEN v_brand.default_pass_tax IS NOT TRUE THEN 'not_applicable'
        WHEN EXISTS (
          SELECT 1 FROM public.brand_tax_registration_attestations a
          WHERE a.brand_id = p_brand_id AND a.has_active_registration IS TRUE
        ) THEN 'verified'
        ELSE 'missing' END;
    ELSIF v_cat.key = 'team.role' THEN
      v_state := CASE WHEN public.brand_readiness_action_allowed(p_brand_id, p_user_id, p_action)
        THEN 'verified' ELSE 'missing' END;
      v_preview := (
        SELECT initcap(replace(m.role,'_',' ')) FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
          AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL
        ORDER BY public.biz_role_rank(m.role) DESC LIMIT 1);
    ELSIF v_cat.key = 'venue.approved_exists' THEN
      v_state := CASE WHEN EXISTS (
        SELECT 1 FROM public.venue_listings v
        WHERE v.brand_id = p_brand_id AND v.claim_status = 'verified'
      ) THEN 'verified' ELSE 'missing' END;
    ELSIF v_cat.key = 'stay.settings_complete' THEN
      v_state := CASE WHEN EXISTS (
        SELECT 1 FROM public.stay_settings s
        JOIN public.venue_listings v ON v.id = s.venue_id
        WHERE v.brand_id = p_brand_id AND v.claim_status = 'verified'
          AND length(btrim(COALESCE(s.summary,''))) >= 20
          AND length(btrim(COALESCE(s.timezone,''))) > 0
          AND s.check_in_time IS NOT NULL AND s.check_out_time IS NOT NULL
      ) THEN 'verified' ELSE 'missing' END;
    ELSE
      v_state := 'missing';
    END IF;

    v_done := v_state IN ('verified','not_applicable');
    -- I-READINESS-DEFERRAL-NEVER-UNBLOCKS: deferral plays no part here.
    v_blocks := p_action IS NOT NULL AND p_action = ANY(v_blocking) AND NOT v_done;

    v_deferral := NULL;
    IF NOT v_done THEN
      SELECT jsonb_build_object(
        'by_user_id', d.deferred_by,
        'by_display_name', COALESCE(
          NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'full_name','')),''),
          NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'name','')),''),
          'A teammate'),
        'at', d.deferred_at,
        'until', NULL,
        'reason', d.reason)
      INTO v_deferral
      FROM public.brand_readiness_deferrals d
      LEFT JOIN auth.users u ON u.id = d.deferred_by
      WHERE d.brand_id = p_brand_id AND d.item_key = v_cat.key AND d.cleared_at IS NULL;
    END IF;

    v_can_fix := public.brand_readiness_can_fix(
      p_brand_id, p_user_id, v_cat.min_role, v_cat.server_predicate);
    v_route := replace(v_cat.route_template, '{brand_id}', p_brand_id::text);
    v_extra := '{}'::jsonb;
    IF p_action = 'brand_setup' THEN
      -- #4389: every checklist row opens the full-screen setup route.
      v_route := '/brand/' || p_brand_id::text || '/setup?step=' || CASE v_cat.key
        WHEN 'brand.name' THEN 'name'
        WHEN 'money.market' THEN 'country'
        ELSE 'pay' END;
      v_extra := jsonb_build_object('waiting_for', CASE
        WHEN v_cat.key IN ('money.terms_member','money.details_submitted') AND NOT v_done
          THEN v_setup->'waiting_for' END);
    END IF;

    IF v_blocks THEN v_blocking_count := v_blocking_count + 1;
    ELSIF v_done THEN v_done_count := v_done_count + 1;
    ELSE v_wait_count := v_wait_count + 1;
    END IF;
    IF v_deferral IS NOT NULL THEN v_deferred_count := v_deferred_count + 1; END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', v_cat.key,
      'group', v_cat.item_group,
      'label', v_cat.label,
      'state', v_state,
      'value_preview', v_preview,
      'blocks_action', v_blocks,
      'severity', CASE WHEN v_blocks THEN 'blocking'
        WHEN v_done THEN 'done' ELSE 'skippable' END,
      'blocking_for', to_jsonb(v_blocking),
      'recommended_for', to_jsonb(v_cat.recommended_for),
      'deferrable', v_cat.is_deferrable,
      'deferral', v_deferral,
      'skip_in_ari', v_deferral IS NOT NULL AND NOT v_blocks,
      'owner_action', v_cat.owner_action,
      'fix', jsonb_build_object(
        'route', v_route,
        'route_label', v_cat.route_label,
        'min_role', v_cat.min_role,
        'server_predicate', v_cat.server_predicate,
        'can_caller_fix', v_can_fix,
        'who_can_fix', public.brand_readiness_who_can_fix(v_cat.min_role, v_cat.server_predicate)),
      'ask', v_cat.ask,
      'verify', jsonb_build_object('probe','brand_readiness','item_key',v_cat.key)
    ) || v_extra);
  END LOOP;

  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'context_revision', v_completeness->>'context_revision',
    'evaluated_at', now(),
    'action', p_action,
    'can_proceed', v_blocking_count = 0,
    'items', v_items,
    'money', jsonb_build_object(
      'can_sell', v_can_sell,
      'can_be_paid_out', v_can_payout,
      'sell_reason', v_sell_reason,
      'payout_reason', v_payout_reason,
      'rail', v_rail,
      'currency', v_brand.default_currency,
      'terms_accepted_by_caller', v_terms_accepted),
    'counts', jsonb_build_object(
      'blocking', v_blocking_count,
      'can_wait', v_wait_count,
      'done', v_done_count,
      'deferred', v_deferred_count)
  ) || CASE WHEN p_action = 'brand_setup'
    THEN jsonb_build_object('setup', v_setup) ELSE '{}'::jsonb END;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_readiness_internal(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_readiness_internal(uuid,text,uuid)
  TO service_role;

-- ── 10. Delete: blockers, finish, guard ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4389_brand_deletion_blockers_internal(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_blockers jsonb;
  v_upcoming bigint;
  v_brand public.brands%ROWTYPE;
  v_sca public.stripe_connect_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- #3660's definition of "money still owed", not a second one.
  v_blockers := COALESCE(private.host_account_deletion_blockers(p_user_id, ARRAY[p_brand_id]), '[]'::jsonb);
  SELECT count(DISTINCT e.id) INTO v_upcoming
  FROM public.events e
  JOIN public.event_dates d ON d.event_id = e.id
  WHERE e.brand_id = p_brand_id AND e.status IN ('scheduled','live')
    AND e.deleted_at IS NULL AND d.end_at > statement_timestamp();
  IF v_upcoming > 0 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blockers) b WHERE b->>'code' = 'upcoming_events'
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'upcoming_events', 'count', v_upcoming));
  END IF;
  SELECT * INTO v_sca FROM public.stripe_connect_accounts
  WHERE brand_id = p_brand_id AND detached_at IS NULL;
  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'blockers', v_blockers,
    'providers', jsonb_build_object(
      'stripe_account_id', v_sca.stripe_account_id,
      'paystack_subaccount_code', v_brand.paystack_subaccount_code,
      'paystack_recipient', EXISTS (SELECT 1 FROM public.brand_paystack_recipients r
        WHERE r.brand_id = p_brand_id AND r.is_active IS TRUE)),
    'is_draft', (public.issue_4389_brand_setup_facts(p_brand_id)->>'is_draft')::boolean
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_brand_deletion_blockers_internal(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_brand_deletion_blockers_internal(uuid,uuid)
  TO service_role;

-- App preview (D1/D2): owner only. Provider ids never leave the server.
CREATE OR REPLACE FUNCTION public.biz_brand_deletion_blockers(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.brands b
       WHERE b.id = p_brand_id AND b.account_id = auth.uid() AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_raw := public.issue_4389_brand_deletion_blockers_internal(p_brand_id, auth.uid());
  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'blockers', v_raw->'blockers',
    'is_draft', v_raw->'is_draft',
    'providers', jsonb_build_object(
      'stripe', v_raw->'providers'->>'stripe_account_id' IS NOT NULL,
      'paystack', v_raw->'providers'->>'paystack_subaccount_code' IS NOT NULL
        OR (v_raw->'providers'->>'paystack_recipient')::boolean));
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_brand_deletion_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_brand_deletion_blockers(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4389_finish_brand_delete(
  p_brand_id uuid,
  p_user_id uuid,
  p_mode text DEFAULT 'delete'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_check jsonb;
  v_now timestamptz := statement_timestamp();
  v_stripe text;
  v_paystack text;
BEGIN
  IF p_mode NOT IN ('delete','discard_draft') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id FOR UPDATE;
  IF NOT FOUND OR v_brand.deleted_at IS NOT NULL THEN
    -- R-11 / R-15: already gone counts as done.
    RETURN jsonb_build_object('ok', true, 'brand_id', p_brand_id, 'already_deleted', true);
  END IF;
  IF v_brand.account_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_check := public.issue_4389_brand_deletion_blockers_internal(p_brand_id, p_user_id);
  IF p_mode = 'discard_draft' AND NOT COALESCE((v_check->>'is_draft')::boolean, false) THEN
    RAISE EXCEPTION 'not_a_draft' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_array_length(v_check->'blockers') > 0 THEN
    RAISE EXCEPTION 'delete_blocked' USING ERRCODE = 'PT409',
      DETAIL = (v_check->'blockers')::text;
  END IF;

  v_stripe := v_check->'providers'->>'stripe_account_id';
  v_paystack := v_brand.paystack_subaccount_code;

  UPDATE public.stripe_connect_accounts
  SET detached_at = v_now, updated_at = v_now
  WHERE brand_id = p_brand_id AND detached_at IS NULL;
  UPDATE public.brand_paystack_recipients
  SET is_active = false, updated_at = v_now
  WHERE brand_id = p_brand_id AND is_active IS TRUE;

  PERFORM set_config('mingla.brand_delete_via', 'issue_4389', true);
  UPDATE public.brands
  SET deleted_at = v_now, updated_at = v_now, paystack_subaccount_code = NULL
  WHERE id = p_brand_id;
  PERFORM set_config('mingla.brand_delete_via', '', true);

  UPDATE public.creator_accounts SET default_brand_id = NULL
  WHERE default_brand_id = p_brand_id;

  INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, before, after)
  VALUES (p_user_id, p_brand_id,
    CASE WHEN p_mode = 'discard_draft' THEN 'brand.draft_discarded' ELSE 'brand.deleted_with_providers' END,
    'brand', p_brand_id::text,
    jsonb_build_object('stripe_account_attached', v_stripe IS NOT NULL,
      'paystack_subaccount_attached', v_paystack IS NOT NULL),
    jsonb_build_object('deleted_at', v_now, 'mode', p_mode));

  RETURN jsonb_build_object('ok', true, 'brand_id', p_brand_id, 'deleted_at', v_now,
    'stripe', CASE WHEN v_stripe IS NULL THEN 'none' ELSE 'closed' END,
    'paystack', CASE WHEN v_paystack IS NULL THEN 'none' ELSE 'switched_off' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_finish_brand_delete(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4389_finish_brand_delete(uuid,uuid,text) TO service_role;

-- #4389 I-4389-DELETE-CLOSES-PROVIDERS: a brand holding a payment account can
-- only be deleted through issue_4389_finish_brand_delete (after the payment
-- accounts were closed). Brands with no account keep today's delete paths.
-- The host-account deletion (#3660) detaches and clears in the same statement,
-- so it passes.
CREATE OR REPLACE FUNCTION public.issue_4389_guard_brand_delete_providers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND COALESCE(current_setting('mingla.brand_delete_via', true), '') <> 'issue_4389'
     AND (NEW.paystack_subaccount_code IS NOT NULL OR EXISTS (
       SELECT 1 FROM public.stripe_connect_accounts sca
       WHERE sca.brand_id = NEW.id AND sca.detached_at IS NULL)) THEN
    RAISE EXCEPTION 'delete_requires_provider_close' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4389_guard_brand_delete_providers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4389_guard_brand_delete_providers ON public.brands;
CREATE TRIGGER issue_4389_guard_brand_delete_providers
  BEFORE UPDATE OF deleted_at ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.issue_4389_guard_brand_delete_providers();

-- ── 11. VAT fail-closed (append-only RETURNS TABLE change) ─────────────────
-- Latest body: 20270415002117_issue_2117_offering_visibility_gate.sql.
DROP FUNCTION IF EXISTS public.resolve_event_pricing_inputs(uuid);
CREATE FUNCTION public.resolve_event_pricing_inputs(p_event_id uuid)
RETURNS TABLE(pass_tax boolean, pass_mingla_fee boolean, pass_service_fee boolean,
  pricing_region text, pricing_currency text, venue_tax_address jsonb,
  pricing_locked boolean, effective_take_rate_bps integer, take_rate_source text,
  stripe_account_id text, payment_provider text, payment_country text,
  paystack_subaccount_code text, vat_rate_bps integer, vat_country_missing boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region                                         AS pricing_region,
    b.pricing_currency                                       AS pricing_currency,
    e.venue_tax_address                                      AS venue_tax_address,
    (e.pricing_locked_at IS NOT NULL)                        AS pricing_locked,
    r.effective_take_rate_bps                                AS effective_take_rate_bps,
    r.take_rate_source                                       AS take_rate_source,
    b.stripe_connect_id                                      AS stripe_account_id,
    -- META-ORCH-1076 — provider routing + VAT config for the Paystack arm.
    b.payment_provider                                       AS payment_provider,
    b.payment_country                                        AS payment_country,
    b.paystack_subaccount_code                               AS paystack_subaccount_code,
    v.vat_rate_bps                                           AS vat_rate_bps,
    -- #4389 I-4389-NO-ZERO-VAT-FALLBACK
    (b.payment_provider = 'paystack' AND b.payment_country IS NULL) AS vat_country_missing
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  CROSS JOIN LATERAL public.resolve_effective_take_rate_bps(b.id) r
  LEFT JOIN public.country_vat_config v ON v.country = b.payment_country
  WHERE e.id = p_event_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.resolve_event_pricing_inputs(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_event_pricing_inputs(uuid)
  TO service_role;

-- ── 12. Backfill (deterministic only) ──────────────────────────────────────
-- Paystack brands -> NG (skip any with a conflicting Stripe account).
UPDATE public.brands b
SET payout_country = 'NG'
WHERE b.payout_country IS NULL AND b.deleted_at IS NULL
  AND b.payment_provider = 'paystack'
  AND NOT EXISTS (SELECT 1 FROM public.stripe_connect_accounts s
    WHERE s.brand_id = b.id AND s.detached_at IS NULL);
-- Stripe brands with an undetached account -> the account's country.
UPDATE public.brands b
SET payout_country = btrim(s.country)
FROM public.stripe_connect_accounts s
WHERE s.brand_id = b.id AND s.detached_at IS NULL
  AND b.payout_country IS NULL AND b.deleted_at IS NULL
  AND b.payment_provider IS DISTINCT FROM 'paystack'
  AND b.paystack_subaccount_code IS NULL;
-- Stripe brands with no account: only a currency that maps to exactly one
-- country. EUR, CHF and BGN stay NULL so the host is asked.
UPDATE public.brands b
SET payout_country = m.country
FROM (VALUES ('USD','US'),('GBP','GB'),('CAD','CA'),('CZK','CZ'),('DKK','DK'),
  ('HUF','HU'),('ISK','IS'),('NOK','NO'),('PLN','PL'),('RON','RO'),('SEK','SE'))
  AS m(currency, country)
WHERE btrim(b.default_currency) = m.currency
  AND b.payout_country IS NULL AND b.deleted_at IS NULL
  AND b.payment_provider IS DISTINCT FROM 'paystack'
  AND b.paystack_subaccount_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.stripe_connect_accounts s
    WHERE s.brand_id = b.id AND s.detached_at IS NULL);

-- ── 13. Self-assert ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM (VALUES
    ('US'),('GB'),('CA'),('CH'),('AT'),('BE'),('BG'),('CY'),('CZ'),('DE'),('DK'),
    ('EE'),('ES'),('FI'),('FR'),('GR'),('HR'),('HU'),('IE'),('IS'),('IT'),('LI'),
    ('LT'),('LU'),('LV'),('MT'),('NL'),('NO'),('PL'),('PT'),('RO'),('SE'),('SI'),
    ('SK'),('NG')) c(cc)
  WHERE EXISTS (SELECT 1 FROM public.payout_country_rail(c.cc));
  IF v_n <> 35 THEN RAISE EXCEPTION 'issue_4389_verify: rail has % of 35 countries', v_n; END IF;
  IF (SELECT currency FROM public.payout_country_rail('BG')) <> 'EUR' THEN
    RAISE EXCEPTION 'issue_4389_verify: BG must map to EUR';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_country_rail('ZZ')) THEN
    RAISE EXCEPTION 'issue_4389_verify: unknown country must return no row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issue_4389_brand_country_derive'
      AND tgrelid = 'public.brands'::regclass) THEN
    RAISE EXCEPTION 'issue_4389_verify: derive trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issue_4389_guard_brand_delete_providers'
      AND tgrelid = 'public.brands'::regclass) THEN
    RAISE EXCEPTION 'issue_4389_verify: delete guard trigger missing';
  END IF;
  SELECT count(*) INTO v_n FROM public.brand_readiness_catalog
  WHERE 'brand_setup' = ANY(blocking_for);
  IF v_n <> 4 THEN RAISE EXCEPTION 'issue_4389_verify: brand_setup has % items, expected 4', v_n; END IF;
  IF has_function_privilege('authenticated', 'public.issue_4389_finish_brand_delete(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4389_finish_brand_delete(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4389_verify: finish delete must be service_role only';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4389_begin_payments_setup_internal(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4389_verify: begin internal must be service_role only';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.biz_set_brand_payout_country(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4389_verify: biz_set_brand_payout_country not callable by hosts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='brands' AND column_name='setup_free_only_at') THEN
    RAISE EXCEPTION 'issue_4389_verify: setup_free_only_at missing';
  END IF;
  PERFORM 1 FROM pg_proc p WHERE p.proname = 'resolve_event_pricing_inputs'
    AND pg_get_function_result(p.oid) LIKE '%vat_country_missing boolean%';
  IF NOT FOUND THEN RAISE EXCEPTION 'issue_4389_verify: vat_country_missing column missing'; END IF;
END;
$$;

COMMIT;
