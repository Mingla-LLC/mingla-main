-- META-ORCH-1076 [Paystack Africa] — Phase 1 (Buyer checkout, Nigeria/NGN).
--
-- ADDITIVE, SAFE-DEFAULT, NON-DESTRUCTIVE migration. Establishes the
-- per-brand payment-provider routing spine (default 'stripe' so every existing
-- brand keeps Stripe behaviour byte-for-byte), widens the GB/GBP pricing
-- allowlists to also admit NG/NGN, adds a config-driven country VAT table
-- (NG = 7.5% = 750 bps), extends resolve_event_pricing_inputs to surface the
-- provider + VAT (append-only columns), and relaxes the Stripe-readiness gate in
-- biz_ticket_checkout_create_session so it fires ONLY for payment_provider='stripe'
-- brands. The Stripe branch of that RPC is byte-for-byte the prior body
-- (20260727000000_orch_0955) — the ONLY change is the provider-aware gate + the
-- added `b.payment_provider` select.
--
-- HARD CONSTRAINT: zero behavioural change for any payment_provider='stripe'
-- brand. There are no pre-existing NG/NGN brands (Stripe Connect does not pay out
-- to Nigeria), so the new branch can only ever fire for brands that could not
-- have existed before.
--
-- Supabase / Postgres docs cited where load-bearing:
--   - ADD COLUMN IF NOT EXISTS / additive ALTER (no rewrite on defaulted add):
--       https://www.postgresql.org/docs/current/ddl-alter.html
--   - CHECK constraints (widen-only is monotonic; no existing row can violate):
--       https://www.postgresql.org/docs/current/ddl-constraints.html
--   - CREATE OR REPLACE FUNCTION (RETURNS TABLE may only APPEND output columns):
--       https://www.postgresql.org/docs/current/sql-createfunction.html
--   - Row Level Security (service-role-only policy on the new VAT table):
--       https://www.postgresql.org/docs/current/ddl-rowsecurity.html
--       https://supabase.com/docs/guides/database/postgres/row-level-security
--   - SECURITY DEFINER + SET search_path (preserved from the prior RPC bodies):
--       https://supabase.com/docs/guides/database/functions

BEGIN;

-- =====================================================================
-- 3.1.a — brand provider columns (additive, defaulted; Stripe stays default)
-- =====================================================================
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS payment_provider          text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS payment_country           text,        -- ISO-2; NULL = inherit Stripe-country behaviour
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code  text;        -- ACCT_… (Phase 2 fills; nullable in Phase 1)

COMMENT ON COLUMN public.brands.payment_provider IS
  'META-ORCH-1076: the money rail this brand settles through. DEFAULT ''stripe'' so every existing brand is unchanged. ''paystack'' enables the NG/NGN Paystack arm in ticket-checkout-create + paystack-webhook. Allowlist constraint brands_payment_provider_allowlist.';
COMMENT ON COLUMN public.brands.payment_country IS
  'META-ORCH-1076: ISO-2 country selecting provider capabilities (e.g. NG → Paystack channels card|bank|ussd|bank_transfer + NG VAT 7.5%). NULL inherits Stripe-country behaviour.';
COMMENT ON COLUMN public.brands.paystack_subaccount_code IS
  'META-ORCH-1076: Paystack subaccount code (ACCT_…) — the brand''s settlement destination for transaction splits. Phase 2 onboarding fills it; Phase 1 charges to the main Mingla account when absent. https://paystack.com/docs/api/subaccount/';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_payment_provider_allowlist') THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_payment_provider_allowlist
      CHECK (payment_provider IN ('stripe', 'paystack'));
  END IF;
END $$;

-- =====================================================================
-- 3.1.b — widen the pricing allowlists to admit NG/NGN (additive, idempotent)
--   IMPLEMENTOR NOTE (remote-state reconciliation, 2026-06-04): the SPEC §3.1.b
--   assumed the ORCH-1006 GB-only CHECKs (IN ('GB') / IN ('GBP')). A read-only
--   remote probe at IMPLEMENT proved REMOTE IS ALREADY AHEAD — ORCH-1034
--   (de-GBP) has landed on the linked remote, so brands_pricing_region_allowlist
--   is already CHECK (pricing_region = ANY ('GB','US','EU','CH')) and there are
--   15 US + 2 EU + 1 CH live brands (pricing_currency USD/EUR/CHF). A narrow
--   IN ('GB','NG') CHECK would REJECT those 18 existing rows and ABORT db push.
--   Therefore we widen to the UNION of the current remote allowlist + NG/NGN.
--   This is the COMMS-0004 / ORCH-1034 coordination point: whoever lands first
--   wins; we union. DROP IF EXISTS then re-ADD as a strict superset → no existing
--   row can violate it (region_violations=0, currency_violations=0 against the
--   union, verified by probe).
-- =====================================================================
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_pricing_region_allowlist;
ALTER TABLE public.brands ADD  CONSTRAINT brands_pricing_region_allowlist
  CHECK (pricing_region IN ('GB', 'US', 'EU', 'CH', 'NG'));

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_pricing_currency_allowlist;
ALTER TABLE public.brands ADD  CONSTRAINT brands_pricing_currency_allowlist
  CHECK (pricing_currency IN ('GBP', 'USD', 'EUR', 'CHF', 'NGN'));

-- =====================================================================
-- 3.1.c — config-driven VAT per country (new table, service-role-only RLS)
--   Locked decision #1: VAT is Mingla-computed per country (Paystack has no Tax
--   API). NG = 7.5% = 750 bps. A row is admin-tunable + Ghana-extensible.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.country_vat_config (
  country      text PRIMARY KEY,                                   -- ISO-2
  vat_rate_bps integer NOT NULL CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.country_vat_config IS
  'META-ORCH-1076: per-country VAT rate in basis points, read by resolve_event_pricing_inputs and applied by allInPricingEngine.computeConfigVat on the Paystack (non-Stripe-Tax) arm. NG=750 (7.5%). Paystack computes no tax; Mingla owns the VAT line.';

INSERT INTO public.country_vat_config (country, vat_rate_bps)
  VALUES ('NG', 750)
  ON CONFLICT (country) DO NOTHING;

ALTER TABLE public.country_vat_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'country_vat_config'
       AND policyname = 'country_vat_config_service_role_all'
  ) THEN
    CREATE POLICY country_vat_config_service_role_all
      ON public.country_vat_config
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =====================================================================
-- 3.1.d — extend resolve_event_pricing_inputs to surface provider + VAT
--   CREATE OR REPLACE with the EXISTING 10 output columns IDENTICAL and in the
--   same order (so the Stripe arm reads them unchanged), then APPEND four new
--   columns. LEFT JOIN country_vat_config on the brand's payment_country.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_event_pricing_inputs(p_event_id uuid)
RETURNS TABLE (
  pass_tax boolean,
  pass_mingla_fee boolean,
  pass_service_fee boolean,
  pricing_region text,
  pricing_currency text,
  venue_tax_address jsonb,
  pricing_locked boolean,
  effective_take_rate_bps integer,
  take_rate_source text,
  stripe_account_id text,
  -- META-ORCH-1076 appended columns (additive; existing 10 above are byte-identical):
  payment_provider text,
  payment_country text,
  paystack_subaccount_code text,
  vat_rate_bps integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    v.vat_rate_bps                                           AS vat_rate_bps
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  CROSS JOIN LATERAL public.resolve_effective_take_rate_bps(b.id) r
  LEFT JOIN public.country_vat_config v ON v.country = b.payment_country
  WHERE e.id = p_event_id;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_event_pricing_inputs(uuid) TO service_role;

-- =====================================================================
-- 3.1.e — relax the Stripe-readiness gate in biz_ticket_checkout_create_session
--   for Paystack brands. The body below is the BYTE-FAITHFUL copy of the prior
--   definition (20260727000000_orch_0955_native_stripe_tax.sql:58). The ONLY
--   changes vs that prior body are:
--     (1) the SELECT INTO v_event adds `b.payment_provider` (joining brands);
--     (2) the stripe_account_not_ready gate gains `AND v_event.payment_provider = 'stripe'`;
--     (3) v_stripe_account_id assignment gains the same provider guard.
--   For payment_provider='stripe' the gate condition is logically identical
--   (the extra AND is always true), so the Stripe branch is a no-op change.
-- =====================================================================
DROP FUNCTION IF EXISTS public.biz_ticket_checkout_create_session(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb,
  text,
  timestamptz,
  integer
);

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_full_price_cents bigint;
  v_deposit_cents bigint;
  v_installments_out jsonb := '[]'::jsonb;
  v_running_installment_total bigint := 0;
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  v_last_ord int := 0;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  -- META-ORCH-1076: add `b.payment_provider` so the gate below can branch by
  -- provider. The brands JOIN already exists implicitly via the LEFT JOIN; we
  -- promote it to an explicit JOIN to read payment_provider.
  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility <> 'public' OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty := COALESCE((v_line ->> 'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    IF NOT v_ticket_type.is_unlimited THEN
      SELECT COUNT(*)
        INTO v_sold
        FROM public.tickets t
       WHERE t.ticket_type_id = v_ticket_type.id
         AND t.status IN ('valid', 'used', 'transferred');

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_qty > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_ticket_type.currency;
    ELSIF v_currency <> v_ticket_type.currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  IF v_is_trip AND v_first_ticket_type_id IS NOT NULL THEN
    SELECT tpt.tier_metadata
      INTO v_tier_metadata
      FROM public.trip_pricing_tiers tpt
     WHERE tpt.event_id = p_event_id
       AND tpt.ticket_type_id = v_first_ticket_type_id;

    IF FOUND AND v_tier_metadata IS NOT NULL THEN
      v_installments_input := v_tier_metadata -> 'installments';
      IF v_installments_input IS NOT NULL AND jsonb_typeof(v_installments_input) = 'object' THEN
        IF v_line_count > 1 THEN
          RAISE EXCEPTION 'ticket_lines_mixed_with_installments';
        END IF;

        IF p_payment_plan_choice <> 'full' THEN
          v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
          v_inst_array := v_installments_input -> 'installments';

          IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
            RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
          END IF;
          IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
            RAISE EXCEPTION 'installment_schedule_malformed';
          END IF;

          v_inst_count := jsonb_array_length(v_inst_array);
          IF v_inst_count < 1 OR v_inst_count > 11 THEN
            RAISE EXCEPTION 'installment_count_out_of_range';
          END IF;

          v_pct_sum := v_deposit_pct;
          v_full_price_cents := v_total;

          FOR v_i IN 0 .. v_inst_count - 1 LOOP
            v_inst_item := v_inst_array -> v_i;
            v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
            v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
            v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
            v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

            IF v_inst_ord <> v_i + 1 THEN
              RAISE EXCEPTION 'installment_ordinal_invalid';
            END IF;
            IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
              RAISE EXCEPTION 'installment_pct_out_of_range';
            END IF;
            IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
               OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
              RAISE EXCEPTION 'installment_due_mode_invalid';
            END IF;

            v_pct_sum := v_pct_sum + v_inst_pct;
            v_last_ord := v_inst_ord;
          END LOOP;

          IF abs(v_pct_sum - 100) > 0.01 THEN
            RAISE EXCEPTION 'installment_pct_sum_mismatch';
          END IF;

          v_deposit_cents := floor(v_full_price_cents::numeric * v_deposit_pct / 100)::bigint;
          v_running_installment_total := 0;
          v_installments_out := '[]'::jsonb;

          FOR v_i IN 0 .. v_inst_count - 1 LOOP
            v_inst_item := v_inst_array -> v_i;
            v_inst_ord := (v_inst_item ->> 'ordinal')::int;
            v_inst_pct := (v_inst_item ->> 'pct')::numeric;
            v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
            v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

            IF v_inst_days IS NOT NULL THEN
              IF v_inst_days < 1 THEN
                RAISE EXCEPTION 'installment_days_after_booking_invalid';
              END IF;
              v_inst_due := v_now + (v_inst_days || ' days')::interval;
            ELSE
              v_inst_due := (v_inst_fixed)::timestamptz;
            END IF;

            IF v_i = 0 AND v_inst_due <= v_now THEN
              RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
            END IF;

            IF v_i < v_inst_count - 1 THEN
              v_inst_amount := floor(v_full_price_cents::numeric * v_inst_pct / 100)::bigint;
              v_running_installment_total := v_running_installment_total + v_inst_amount;
            ELSE
              v_inst_amount := v_full_price_cents - v_deposit_cents - v_running_installment_total;
              IF v_inst_amount <= 0 THEN
                RAISE EXCEPTION 'installment_rounding_invalid';
              END IF;
            END IF;

            v_installments_out := v_installments_out || jsonb_build_array(jsonb_build_object(
              'ordinal', v_inst_ord,
              'pct', v_inst_pct,
              'amountCents', v_inst_amount,
              'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            ));
          END LOOP;

          v_total := v_deposit_cents::integer;
        END IF;
      END IF;
    END IF;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  -- META-ORCH-1076: Stripe brands still require a ready connected account.
  -- Paystack brands have NO stripe_connect_accounts row → must NOT raise here.
  -- For payment_provider='stripe' this condition is logically identical to the
  -- prior body (the extra AND is always true) → Stripe path unchanged.
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  -- Paystack sessions carry stripe_account_id = NULL (no connected account).
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    COALESCE(v_currency, 'GBP'::character(3)), v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_installments_out <> '[]'::jsonb THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_deposit_cents,
          'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
          'installments', v_installments_out
        )
      ELSE NULL
    END
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_installments_out <> '[]'::jsonb THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_deposit_cents,
          'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
          'installments', v_installments_out
        )
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text) TO service_role;

-- =====================================================================
-- Self-verify: both money RPCs remain single-overload (param-count guard).
-- biz_ticket_checkout_create_session = 11 params (10 named + 1 default text).
-- biz_ticket_checkout_finalize NOT touched by Phase 1 → still 8 params.
-- =====================================================================
DO $$
DECLARE
  v_create_count int;
  v_finalize_count int;
BEGIN
  SELECT count(*) INTO v_create_count
    FROM pg_proc WHERE proname = 'biz_ticket_checkout_create_session' AND pronargs = 11;
  IF v_create_count <> 1 THEN
    RAISE EXCEPTION 'META-ORCH-1076 self-verify: expected exactly 1 biz_ticket_checkout_create_session(11-param) overload, found %', v_create_count;
  END IF;

  SELECT count(*) INTO v_finalize_count
    FROM pg_proc WHERE proname = 'biz_ticket_checkout_finalize' AND pronargs = 8;
  IF v_finalize_count <> 1 THEN
    RAISE EXCEPTION 'META-ORCH-1076 self-verify: expected exactly 1 biz_ticket_checkout_finalize(8-param) overload, found %', v_finalize_count;
  END IF;
END $$;

COMMIT;
