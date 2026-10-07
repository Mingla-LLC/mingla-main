-- #3660 Phase 3 — payout bank mutate is brand_owner only; admin/FM keep view.
--
-- biz_can_mutate_payouts_for_brand  → owner-only (connect / detach / onboard).
-- biz_can_manage_payments_for_brand → UNCHANGED (owner/admin/FM) for refunds,
--   status visibility RPCs that still name "manage", and legacy callers.
-- biz_can_view_payments_for_brand   → explicit alias of the view audience
--   (same body as manage) for new edges / policies that mean "read".

-- ── Mutate predicate: brand_owner only ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_can_mutate_payouts_for_brand(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.biz_brand_effective_rank(p_brand_id, p_user_id)
         >= public.biz_role_rank('brand_owner');
$$;

ALTER FUNCTION public.biz_can_mutate_payouts_for_brand(uuid, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.biz_can_mutate_payouts_for_brand(uuid, uuid) IS
  '#3660 Phase 3: TRUE only for brand_owner (effective rank). Bank connect/detach/onboard mutate gate.';

CREATE OR REPLACE FUNCTION public.biz_can_mutate_payouts_for_brand_for_caller(
  p_brand_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.biz_can_mutate_payouts_for_brand(p_brand_id, auth.uid());
$$;

ALTER FUNCTION public.biz_can_mutate_payouts_for_brand_for_caller(uuid) OWNER TO postgres;

-- Two-arg helper takes an arbitrary p_user_id — service_role / edge only.
-- Caller wrapper is auth.uid()-scoped for authenticated RLS paths. Never anon.
REVOKE ALL ON FUNCTION public.biz_can_mutate_payouts_for_brand(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_can_mutate_payouts_for_brand(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.biz_can_mutate_payouts_for_brand_for_caller(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_can_mutate_payouts_for_brand_for_caller(uuid)
  TO authenticated, service_role;

-- ── View predicate: same audience as legacy manage (admin+ OR finance_manager)
CREATE OR REPLACE FUNCTION public.biz_can_view_payments_for_brand(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.biz_can_manage_payments_for_brand(p_brand_id, p_user_id);
$$;

ALTER FUNCTION public.biz_can_view_payments_for_brand(uuid, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.biz_can_view_payments_for_brand(uuid, uuid) IS
  '#3660 Phase 3: alias of biz_can_manage_payments_for_brand (owner/admin/FM). Prefer this name for read/status paths.';

CREATE OR REPLACE FUNCTION public.biz_can_view_payments_for_brand_for_caller(
  p_brand_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.biz_can_view_payments_for_brand(p_brand_id, auth.uid());
$$;

ALTER FUNCTION public.biz_can_view_payments_for_brand_for_caller(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.biz_can_view_payments_for_brand(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_can_view_payments_for_brand(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.biz_can_view_payments_for_brand_for_caller(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_can_view_payments_for_brand_for_caller(uuid)
  TO authenticated, service_role;

-- brand_get_payout_visibility keeps working via manage; optionally use view name
CREATE OR REPLACE FUNCTION public.brand_get_payout_visibility(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_paused   boolean;
  v_currency text;
  v_paid     bigint;
  v_way      bigint;
  v_next     timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_brand_id IS NULL
     OR NOT public.biz_can_view_payments_for_brand(p_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_finance_permission' USING ERRCODE = '42501';
  END IF;

  v_paused := EXISTS (
    SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id = p_brand_id
  );

  SELECT r.currency INTO v_currency
  FROM public.brand_payout_releases r
  WHERE r.brand_id = p_brand_id
    AND r.status NOT IN ('cancelled_event', 'failed')
  ORDER BY r.created_at DESC, r.id
  LIMIT 1;

  IF v_currency IS NULL THEN
    SELECT lower(b.default_currency) INTO v_currency
    FROM public.brands b WHERE b.id = p_brand_id;
  END IF;

  SELECT
    COALESCE(sum(q.delivered) FILTER (WHERE q.status = 'released'), 0)::bigint,
    COALESCE(sum(greatest(q.due, 0)) FILTER (WHERE q.status IN (
      'pending', 'in_flight', 'blocked_kyc', 'blocked_balance', 'blocked_otp',
      'blocked_over_cap', 'fee_unreconciled', 'blocked_anchor', 'reanchored'
    )), 0)::bigint,
    min(q.releasable_at) FILTER (WHERE q.due > 0 AND q.status IN (
      'pending', 'in_flight', 'blocked_kyc', 'blocked_balance', 'blocked_otp',
      'blocked_over_cap', 'fee_unreconciled', 'blocked_anchor', 'reanchored'
    ))
  INTO v_paid, v_way, v_next
  FROM (
    SELECT
      r.status,
      r.releasable_at,
      COALESCE(r.organiser_cash_delivered_cents, r.net_release_cents)::bigint AS delivered,
      r.net_release_cents::bigint + COALESCE((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id = r.id AND a.kind = 'maturity_recredit'
      ), 0) AS due
    FROM public.brand_payout_releases r
    WHERE r.brand_id = p_brand_id
      AND r.currency IS NOT DISTINCT FROM v_currency
  ) q;

  RETURN jsonb_build_object(
    'payouts_paused', v_paused,
    'next_payout_at', CASE WHEN v_paused THEN NULL ELSE v_next END,
    'earned_cents', v_paid + v_way,
    'on_its_way_cents', v_way,
    'paid_cents', v_paid,
    'currency', v_currency
  );
END;
$fn$;

COMMENT ON FUNCTION public.brand_get_payout_visibility(uuid) IS
  '#3660 Phase 3 / #3645: organiser payout status via biz_can_view_payments_for_brand (owner/admin/FM).';

-- ── stripe_connect_accounts: SELECT = view/manage; writes = mutate owner ───
DROP POLICY IF EXISTS "Brand admin plus can manage stripe_connect_accounts"
  ON public.stripe_connect_accounts;
DROP POLICY IF EXISTS stripe_connect_accounts_payments_view
  ON public.stripe_connect_accounts;
DROP POLICY IF EXISTS stripe_connect_accounts_payments_mutate
  ON public.stripe_connect_accounts;

CREATE POLICY stripe_connect_accounts_payments_view
  ON public.stripe_connect_accounts
  FOR SELECT
  TO authenticated
  USING (public.biz_can_view_payments_for_brand_for_caller(brand_id));

CREATE POLICY stripe_connect_accounts_payments_mutate
  ON public.stripe_connect_accounts
  FOR ALL
  TO authenticated
  USING (public.biz_can_mutate_payouts_for_brand_for_caller(brand_id))
  WITH CHECK (public.biz_can_mutate_payouts_for_brand_for_caller(brand_id));
