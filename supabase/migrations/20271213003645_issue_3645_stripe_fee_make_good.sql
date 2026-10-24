-- Issue #3645 option b (2026-10-22) — Mingla makes legacy Stripe hosts whole for
-- the processing fee Stripe already took.
--
-- #4044 made the host net gross − refunds − disputes − Mingla fee and created
-- NEW Connect accounts with defaults.responsibilities.fees_collector =
-- 'application' (Mingla pays Stripe processing). Accounts created before #4044
-- keep fees_collector = 'stripe': on every direct charge Stripe deducts its
-- processing fee from the CONNECTED balance. The ledger release then asks for
-- more than the account holds (Salsa4Life 3a4fa269…: ledger 3,090, account at
-- most 2,969 — the 121-cent processing fee), and the sweep parks it on
-- blocked_balance forever.
--
-- Stripe does not allow the responsibility to change on an existing account
-- ("You can't update their values later",
-- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration#set-responsibilities;
-- v1 POST /v1/accounts/:id has no `controller` parameter). So the fix for a
-- legacy account is a platform → connected-account Transfer equal to the
-- processing fee on that release's sales:
--   https://docs.stripe.com/api/transfers/create
--
-- This migration is the ledger for those Transfers. Amounts come ONLY from the
-- release's own items (payout_release_items.provider_fee_cents — the stored
-- balance-transaction fee minus Mingla's application fee, #3872), never from a
-- balance read. A release that already received a make-good for its current
-- provider fee owes nothing; one whose items grew later owes only the
-- difference. Each Transfer carries a deterministic idempotency key, so a lost
-- response is retried with the same key and Stripe returns the same Transfer.
--
-- Writers: the admin-stripe-fee-make-good edge function (service_role) only.
-- Nobody inserts rows by hand.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_fee_make_goods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  stripe_account_id text NOT NULL CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  currency text NOT NULL CHECK (currency = lower(currency) AND length(currency) = 3),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  -- The release's total item provider fee this row brings the make-good up to.
  covered_through_cents integer NOT NULL CHECK (covered_through_cents >= amount_cents),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','sent','failed')),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_[A-Za-z0-9]+$'),
  error_message text,
  actor_email text NOT NULL CHECK (btrim(actor_email) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_fee_make_goods_sent_has_transfer
    CHECK ((status = 'sent') = (stripe_transfer_id IS NOT NULL AND sent_at IS NOT NULL))
);

-- At most one live (planned or sent) make-good per release per covered total.
CREATE UNIQUE INDEX IF NOT EXISTS stripe_fee_make_goods_one_live_per_cover
  ON public.stripe_fee_make_goods (release_id, covered_through_cents)
  WHERE status <> 'failed';

CREATE INDEX IF NOT EXISTS stripe_fee_make_goods_brand
  ON public.stripe_fee_make_goods (brand_id, created_at);

ALTER TABLE public.stripe_fee_make_goods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_fee_make_goods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stripe_fee_make_goods TO service_role;

COMMENT ON TABLE public.stripe_fee_make_goods IS
  'Issue #3645 option b: platform → connected-account Stripe Transfers that make a legacy (fees_collector=stripe) host whole for the processing fee Stripe deducted on that release''s sales. Written only by plan_/record_stripe_fee_make_good (SECURITY DEFINER, service_role).';

-- ── Census: what each unpaid Stripe release is owed ─────────────────────────
CREATE OR REPLACE FUNCTION public.stripe_fee_make_good_census()
RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  brand_name text,
  stripe_account_id text,
  currency text,
  release_status text,
  net_release_cents integer,
  provider_fee_cents integer,
  made_good_cents integer,
  planned_cents integer,
  owed_cents integer,
  eligible boolean,
  ineligible_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH r AS (
    SELECT
      rel.id, rel.brand_id, b.name AS brand_name, rel.currency, rel.status,
      rel.net_release_cents,
      sca.stripe_account_id,
      sca.detached_at,
      coalesce((
        SELECT sum(i.provider_fee_cents)::integer
        FROM public.payout_release_items i WHERE i.release_id = rel.id
      ), 0) AS provider_fee,
      coalesce((
        SELECT sum(m.amount_cents)::integer FROM public.stripe_fee_make_goods m
        WHERE m.release_id = rel.id AND m.status = 'sent'
      ), 0) AS made_good,
      coalesce((
        SELECT sum(m.amount_cents)::integer FROM public.stripe_fee_make_goods m
        WHERE m.release_id = rel.id AND m.status = 'planned'
      ), 0) AS planned,
      EXISTS (
        SELECT 1 FROM public.payout_release_items i
        LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
        WHERE i.release_id = rel.id
          AND i.provider_fee_cents > 0
          AND (o.id IS NULL OR o.stripe_transfer_destination IS DISTINCT FROM sca.stripe_account_id)
      ) AS account_mismatch
    FROM public.brand_payout_releases rel
    JOIN public.brands b ON b.id = rel.brand_id
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = rel.brand_id
    WHERE rel.provider = 'stripe'
  )
  SELECT
    r.id, r.brand_id, r.brand_name, r.stripe_account_id, r.currency, r.status,
    r.net_release_cents, r.provider_fee, r.made_good, r.planned,
    greatest(r.provider_fee - r.made_good, 0) AS owed,
    (r.status IN ('pending','blocked_balance','blocked_kyc','in_flight')
      AND r.stripe_account_id IS NOT NULL AND r.detached_at IS NULL
      AND NOT r.account_mismatch
      AND r.provider_fee - r.made_good > 0) AS eligible,
    CASE
      WHEN r.status NOT IN ('pending','blocked_balance','blocked_kyc','in_flight') THEN 'release_not_unpaid'
      WHEN r.stripe_account_id IS NULL OR r.detached_at IS NOT NULL THEN 'no_active_connect_account'
      WHEN r.account_mismatch THEN 'sale_not_on_current_account'
      WHEN r.provider_fee - r.made_good <= 0 THEN 'nothing_owed'
      ELSE NULL
    END
  FROM r
  ORDER BY r.brand_name, r.id;
$fn$;

-- ── Plan one make-good (or resume the one already planned) ──────────────────
-- p_expected_amount_cents is the operator's confirmation: the call refuses
-- unless it equals the amount the ledger owes, so a stale screen or a typo can
-- never send a different number.
CREATE OR REPLACE FUNCTION public.plan_stripe_fee_make_good(
  p_release_id uuid,
  p_expected_amount_cents integer,
  p_actor_email text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_account text;
  v_detached timestamptz;
  v_provider_fee integer;
  v_made_good integer;
  v_owed integer;
  v_attempt integer;
  v_row public.stripe_fee_make_goods;
BEGIN
  IF p_actor_email IS NULL OR btrim(p_actor_email) = '' THEN
    RAISE EXCEPTION 'actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_release FROM public.brand_payout_releases
  WHERE id = p_release_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_release.provider <> 'stripe' THEN
    RAISE EXCEPTION 'release_not_stripe' USING ERRCODE = 'P0001';
  END IF;
  IF v_release.status NOT IN ('pending','blocked_balance','blocked_kyc','in_flight')
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'release_not_unpaid' USING ERRCODE = 'P0001';
  END IF;

  SELECT sca.stripe_account_id, sca.detached_at INTO v_account, v_detached
  FROM public.stripe_connect_accounts sca WHERE sca.brand_id = v_release.brand_id;
  IF v_account IS NULL OR v_detached IS NOT NULL THEN
    RAISE EXCEPTION 'no_active_connect_account' USING ERRCODE = 'P0001';
  END IF;

  -- Every fee-bearing sale must be a direct charge on THIS account; otherwise
  -- the fee was not taken from the balance the payout draws on.
  IF EXISTS (
    SELECT 1 FROM public.payout_release_items i
    LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
    WHERE i.release_id = p_release_id
      AND i.provider_fee_cents > 0
      AND (o.id IS NULL OR o.stripe_transfer_destination IS DISTINCT FROM v_account)
  ) THEN
    RAISE EXCEPTION 'sale_not_on_current_account' USING ERRCODE = 'P0001';
  END IF;

  -- A planned row means an earlier call may have reached Stripe: resume it
  -- with the same idempotency key rather than plan a second Transfer.
  SELECT * INTO v_row FROM public.stripe_fee_make_goods
  WHERE release_id = p_release_id AND status = 'planned'
  ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF p_expected_amount_cents IS DISTINCT FROM v_row.amount_cents THEN
      RAISE EXCEPTION 'make_good_amount_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'resumed', 'make_good_id', v_row.id,
      'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
      'stripe_account_id', v_row.stripe_account_id,
      'idempotency_key', v_row.idempotency_key);
  END IF;

  SELECT coalesce(sum(i.provider_fee_cents), 0)::integer INTO v_provider_fee
  FROM public.payout_release_items i WHERE i.release_id = p_release_id;
  SELECT coalesce(sum(m.amount_cents), 0)::integer INTO v_made_good
  FROM public.stripe_fee_make_goods m
  WHERE m.release_id = p_release_id AND m.status = 'sent';
  v_owed := v_provider_fee - v_made_good;

  IF v_owed <= 0 THEN
    IF p_expected_amount_cents IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'make_good_amount_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('outcome', 'nothing_owed', 'amount_cents', 0);
  END IF;
  IF p_expected_amount_cents IS DISTINCT FROM v_owed THEN
    RAISE EXCEPTION 'make_good_amount_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_attempt FROM public.stripe_fee_make_goods m
  WHERE m.release_id = p_release_id AND m.covered_through_cents = v_provider_fee
    AND m.status = 'failed';

  INSERT INTO public.stripe_fee_make_goods (
    release_id, brand_id, stripe_account_id, currency, amount_cents,
    covered_through_cents, attempt, idempotency_key, actor_email, reason
  ) VALUES (
    p_release_id, v_release.brand_id, v_account, v_release.currency, v_owed,
    v_provider_fee, v_attempt,
    format('mingla_fee_make_good_%s_%s_a%s', p_release_id, v_provider_fee, v_attempt),
    btrim(p_actor_email), btrim(p_reason)
  ) RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'outcome', 'planned', 'make_good_id', v_row.id,
    'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
    'stripe_account_id', v_row.stripe_account_id,
    'idempotency_key', v_row.idempotency_key);
END;
$fn$;

-- ── Record what Stripe answered ─────────────────────────────────────────────
-- 'sent' needs the Transfer id and the exact planned amount. 'failed' is only
-- for a definitive Stripe refusal; a lost or retryable response stays
-- 'planned' and the next call resumes it with the same key.
CREATE OR REPLACE FUNCTION public.record_stripe_fee_make_good(
  p_make_good_id uuid,
  p_outcome text,
  p_stripe_transfer_id text,
  p_amount_cents integer,
  p_error_message text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row public.stripe_fee_make_goods;
BEGIN
  IF p_outcome NOT IN ('sent','failed') THEN
    RAISE EXCEPTION 'invalid_make_good_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.stripe_fee_make_goods
  WHERE id = p_make_good_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_good_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'sent' THEN
    IF p_outcome = 'sent' AND p_stripe_transfer_id = v_row.stripe_transfer_id THEN
      RETURN 'sent';
    END IF;
    RAISE EXCEPTION 'make_good_already_sent' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status = 'failed' THEN
    RAISE EXCEPTION 'make_good_already_failed' USING ERRCODE = 'P0001';
  END IF;

  IF p_outcome = 'sent' THEN
    IF p_stripe_transfer_id IS NULL OR p_stripe_transfer_id !~ '^tr_[A-Za-z0-9]+$' THEN
      RAISE EXCEPTION 'stripe_transfer_id_required' USING ERRCODE = '22023';
    END IF;
    IF p_amount_cents IS DISTINCT FROM v_row.amount_cents THEN
      RAISE EXCEPTION 'make_good_amount_not_ledger_exact' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.stripe_fee_make_goods
    SET status = 'sent', stripe_transfer_id = p_stripe_transfer_id,
        sent_at = now(), error_message = NULL, updated_at = now()
    WHERE id = p_make_good_id;
    RETURN 'sent';
  END IF;

  UPDATE public.stripe_fee_make_goods
  SET status = 'failed',
      error_message = left(coalesce(p_error_message, 'stripe_transfer_refused'), 1000),
      updated_at = now()
  WHERE id = p_make_good_id;
  RETURN 'failed';
END;
$fn$;

REVOKE ALL ON FUNCTION public.stripe_fee_make_good_census() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_stripe_fee_make_good(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_fee_make_good(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_fee_make_good_census() TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_stripe_fee_make_good(uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_fee_make_good(uuid, text, text, integer, text) TO service_role;

COMMIT;
