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

-- ── #3753 follow-up: remap application 'forbidden' off assert_failure ──────
-- #3753 raised 'forbidden' with ERRCODE P0004. In PostgreSQL, P0004 is
-- assert_failure, and EXCEPTION WHEN OTHERS deliberately does not catch it
-- (only QUERY_CANCELED and ASSERT_FAILURE are excluded). The Phase 2 happy
-- suite's demotion / authenticated-DELETE catch blocks therefore aborted the
-- whole DO under ON_ERROR_STOP — Migrations apply failed on main after #3753
-- and on this tip. Remap those application refusals to P0001 (raise_exception).
CREATE OR REPLACE FUNCTION public.biz_remove_brand_team_member(
  p_brand_id uuid,
  p_member_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
  v_caller uuid := auth.uid();
  v_caller_rank integer;
  v_after jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  v_caller_rank := public.biz_brand_effective_rank(p_brand_id, v_caller);
  IF v_caller_rank < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_member
  FROM public.brand_team_members
  WHERE id = p_member_id
    AND brand_id = p_brand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_member.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_removed' USING ERRCODE = 'P0003';
  END IF;

  IF v_member.user_id = (
    SELECT b.account_id FROM public.brands b WHERE b.id = v_member.brand_id
  ) THEN
    RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
  END IF;

  IF v_member.role = 'brand_owner'
     AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.partner_brand_links pl
    WHERE pl.brand_id = v_member.brand_id
      AND pl.partner_account_id = v_member.user_id
      AND pl.accepted_at IS NOT NULL
      AND pl.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active_partner_use_disconnect' USING ERRCODE = 'P0006';
  END IF;

  IF v_member.accepted_at IS NOT NULL THEN
    UPDATE public.brand_team_members
    SET removed_at = now()
    WHERE id = p_member_id
      AND brand_id = p_brand_id
    RETURNING to_jsonb(brand_team_members) INTO v_after;
  ELSE
    DELETE FROM public.brand_team_members
    WHERE id = p_member_id
      AND brand_id = p_brand_id;
    v_after := jsonb_build_object('deleted', true, 'id', p_member_id);
  END IF;

  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      v_caller,
      v_member.brand_id,
      'brand_team_member_removed',
      'brand_team_member',
      p_member_id::text,
      jsonb_build_object(
        'removed_user_id', v_member.user_id,
        'removed_role', v_member.role,
        'by_rank', v_caller_rank
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_brand_team_members_removal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_rank integer;
  v_account uuid;
  v_is_soft_remove boolean := false;
  v_transfer_armed boolean :=
    current_setting('app.allow_brand_owner_transfer', true) = 'on';
BEGIN
  IF v_transfer_armed THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT b.account_id INTO v_account
    FROM public.brands b WHERE b.id = OLD.brand_id;

    IF OLD.accepted_at IS NOT NULL THEN
      IF v_caller IS NULL THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.user_id = v_account THEN
      RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
    END IF;

    IF v_caller IS NOT NULL THEN
      v_caller_rank := public.biz_brand_effective_rank(OLD.brand_id, v_caller);
      IF OLD.role = 'brand_owner'
         AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.partner_brand_links pl
      WHERE pl.brand_id = OLD.brand_id
        AND pl.partner_account_id = OLD.user_id
        AND pl.accepted_at IS NOT NULL
        AND pl.cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'active_partner_use_disconnect' USING ERRCODE = 'P0006';
    END IF;

    RETURN OLD;
  END IF;

  IF OLD.role = 'brand_owner'
     AND NEW.role IS DISTINCT FROM 'brand_owner' THEN
    IF NEW.brand_id IS DISTINCT FROM OLD.brand_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
    END IF;
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
    END IF;
    v_caller_rank := public.biz_brand_effective_rank(OLD.brand_id, v_caller);
    IF v_caller_rank < public.biz_role_rank('brand_owner') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    v_is_soft_remove := true;
  END IF;
  IF NOT v_is_soft_remove THEN
    RETURN NEW;
  END IF;

  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT b.account_id INTO v_account
  FROM public.brands b WHERE b.id = OLD.brand_id;
  IF NEW.user_id = v_account THEN
    RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
  END IF;

  IF v_caller IS NOT NULL THEN
    v_caller_rank := public.biz_brand_effective_rank(OLD.brand_id, v_caller);
    IF NEW.role = 'brand_owner'
       AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partner_brand_links pl
    WHERE pl.brand_id = OLD.brand_id
      AND pl.partner_account_id = NEW.user_id
      AND pl.accepted_at IS NOT NULL
      AND pl.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active_partner_use_disconnect' USING ERRCODE = 'P0006';
  END IF;

  RETURN NEW;
END;
$$;
