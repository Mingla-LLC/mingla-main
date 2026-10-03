-- Issue #3645 PR10 — organiser payout visibility.
--
-- AC (from #3645):
--   * Payments page states on the existing status card: "Selling, add a bank to
--     get paid", "Next payout on <date>", "Payouts paused" (both rails).
--   * Paystack brands get balance tiles (earned / on its way / paid).
--   * Notifications on both rails: payout sent, failed, waiting for bank, paused.
--   * Analytics: Paystack bank-added + first payout.
--
-- Design (subtractive; no parallel payout system):
--   1. brand_get_payout_visibility(brand) — ONE small SECURITY DEFINER read,
--      readable by payments managers only (owner/admin/finance via
--      biz_can_manage_payments_for_brand), that returns exactly the
--      organiser-safe facts the status card + balance tiles need:
--        { payouts_paused, next_payout_at, earned_cents, on_its_way_cents,
--          paid_cents, currency }.
--      The admin pause lives in the RLS-locked brand_payout_admin_holds table
--      (PR9); that table is NOT opened to authenticated. This RPC reads it as
--      the owner and returns ONLY a boolean — never the admin reason, never a
--      ledger error_message / attempt_count / OTP / KYC internal (#1180 law).
--      Aggregates are over ONE currency (the brand's most recent live release);
--      integer cents only.
--   2. Pause / resume notifications. admin_set_brand_payouts_paused is an
--      audited, gate-protected admin writer and is left byte-unchanged. Instead
--      an AFTER INSERT / AFTER DELETE trigger on the admin-only hold table
--      records one durable notice row per transition into
--      brand_payout_pause_notices (service_role-only). payout-release-sweep
--      drains it (claim → dispatch → complete), the same at-least-once +
--      idempotency-key pattern the waiting-for-bank notification already uses.
--      The notice carries NO reason text: the organiser is told payouts are
--      paused/resumed, never why.
--   2b. Terminal Paystack outcome notices. When a Paystack release flips to
--      released/failed, an AFTER UPDATE trigger records one row into
--      brand_payout_outcome_notices. The sweep drains it the same way. The
--      webhook must NOT swallow dispatch failures — the outbox is the retry.
--   3. brand_appsflyer_milestones.first_bank_added_at — additive nullable column
--      so the Paystack "bank added" analytics event can be claimed exactly once.
--      NOTE for analytics readers: mingla_stripe_connect_activated fires on
--      Stripe charges_enabled (CHARGE-ready), not payouts_enabled
--      (PAYOUT-ready); bank-added is its own event.
--
-- Moves no money.

BEGIN;

-- ── §1. Milestone column: first bank added (Paystack) ────────────────────────
ALTER TABLE public.brand_appsflyer_milestones
  ADD COLUMN IF NOT EXISTS first_bank_added_at timestamptz;

-- ── §2. brand_get_payout_visibility — organiser-safe payout status read ──────
CREATE OR REPLACE FUNCTION public.brand_get_payout_visibility(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_paused   boolean;
  v_currency text;
  v_paid     bigint;
  v_way      bigint;
  v_next     timestamptz;
BEGIN
  -- Guard FIRST: signed-in + payments manager on THIS brand
  -- (owner / brand_admin / finance_manager). Rank≥finance_manager is wrong:
  -- event_manager ranks above finance_manager and must stay refused. 42501 so
  -- clients classify it as permission-denied (not a network failure).
  IF auth.uid() IS NULL OR p_brand_id IS NULL
     OR NOT public.biz_can_manage_payments_for_brand(p_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_finance_permission' USING ERRCODE = '42501';
  END IF;

  v_paused := EXISTS (
    SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id = p_brand_id
  );

  -- One currency per answer: the brand's most recent release that still counts
  -- (cancelled / failed releases do not define the brand's money currency).
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
    -- A paused brand is promised no date; the card says "Payouts paused".
    'next_payout_at', CASE WHEN v_paused THEN NULL ELSE v_next END,
    -- earned = already paid + still on its way (cancelled / failed excluded).
    'earned_cents', v_paid + v_way,
    'on_its_way_cents', v_way,
    'paid_cents', v_paid,
    'currency', v_currency
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.brand_get_payout_visibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_get_payout_visibility(uuid) TO authenticated;

COMMENT ON FUNCTION public.brand_get_payout_visibility(uuid) IS
  'Issue #3645 PR10: organiser-safe payout status for the Payments status card + Paystack balance tiles. Payments managers only — owner/admin/finance via biz_can_manage_payments_for_brand (42501 otherwise; event_manager is refused). Returns { payouts_paused, next_payout_at, earned_cents, on_its_way_cents, paid_cents, currency } derived from the admin-only brand_payout_admin_holds table (boolean only — never the reason) and ledger aggregates. Never returns error_message / attempt_count / OTP / KYC internals (#1180).';

-- ── §3. Pause / resume notice outbox (admin-only, drained by the sweep) ──────
CREATE TABLE IF NOT EXISTS public.brand_payout_pause_notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No FK on purpose: a brand delete cascades the hold row away, and the
  -- AFTER DELETE trigger would then insert a notice for a vanishing brand.
  brand_id    uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('paused', 'resumed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS brand_payout_pause_notices_pending_idx
  ON public.brand_payout_pause_notices (created_at)
  WHERE notified_at IS NULL;

ALTER TABLE public.brand_payout_pause_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_payout_pause_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_payout_pause_notices TO service_role;

COMMENT ON TABLE public.brand_payout_pause_notices IS
  'Issue #3645 PR10: one row per admin pause/resume transition, written by the hold-table trigger and drained by payout-release-sweep. Carries no reason text. Admin/service-role only.';

CREATE OR REPLACE FUNCTION public.tg_brand_payout_admin_hold_notice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.brand_payout_pause_notices (brand_id, kind)
    VALUES (NEW.brand_id, 'paused');
    RETURN NEW;
  END IF;
  INSERT INTO public.brand_payout_pause_notices (brand_id, kind)
  VALUES (OLD.brand_id, 'resumed');
  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_brand_payout_admin_hold_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_payout_admin_holds_notice ON public.brand_payout_admin_holds;
CREATE TRIGGER brand_payout_admin_holds_notice
  AFTER INSERT OR DELETE ON public.brand_payout_admin_holds
  FOR EACH ROW EXECUTE FUNCTION public.tg_brand_payout_admin_hold_notice();

-- Sweep side: list undelivered notices, then mark them done after dispatch.
CREATE OR REPLACE FUNCTION public.claim_brand_payout_pause_notices(
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  notice_id uuid,
  brand_id uuid,
  kind text,
  brand_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT n.id, n.brand_id, n.kind, b.name
  FROM public.brand_payout_pause_notices n
  JOIN public.brands b ON b.id = n.brand_id
  WHERE n.notified_at IS NULL
  ORDER BY n.created_at, n.id
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$fn$;

CREATE OR REPLACE FUNCTION public.complete_brand_payout_pause_notices(
  p_notice_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.brand_payout_pause_notices
  SET notified_at = now()
  WHERE id = ANY (coalesce(p_notice_ids, ARRAY[]::uuid[]))
    AND notified_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Notices for brands that no longer exist can never be delivered: close them.
  UPDATE public.brand_payout_pause_notices n
  SET notified_at = now()
  WHERE n.notified_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = n.brand_id);
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_brand_payout_pause_notices(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_brand_payout_pause_notices(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_brand_payout_pause_notices(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_brand_payout_pause_notices(uuid[]) TO service_role;

-- ── §3b. Terminal Paystack outcome notice outbox (drained by the sweep) ──────
-- Enqueued in the same transaction that finalizes the release (UPDATE →
-- released/failed). Stripe already notifies from its payout webhook; this
-- outbox is Paystack-only so the rails do not double-notify.
CREATE TABLE IF NOT EXISTS public.brand_payout_outcome_notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  uuid NOT NULL UNIQUE,
  brand_id    uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('paid', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS brand_payout_outcome_notices_pending_idx
  ON public.brand_payout_outcome_notices (created_at)
  WHERE notified_at IS NULL;

ALTER TABLE public.brand_payout_outcome_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_payout_outcome_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_payout_outcome_notices TO service_role;

COMMENT ON TABLE public.brand_payout_outcome_notices IS
  'Issue #3645 PR10: one row per Paystack release that reached released/failed, written by the release-status trigger and drained by payout-release-sweep. Carries no error_message. Service-role only.';

CREATE OR REPLACE FUNCTION public.tg_brand_payout_outcome_notice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.provider IS DISTINCT FROM 'paystack' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('released', 'failed') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.brand_payout_outcome_notices (release_id, brand_id, kind)
  VALUES (
    NEW.id,
    NEW.brand_id,
    CASE WHEN NEW.status = 'released' THEN 'paid' ELSE 'failed' END
  )
  ON CONFLICT (release_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_brand_payout_outcome_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_payout_releases_outcome_notice ON public.brand_payout_releases;
CREATE TRIGGER brand_payout_releases_outcome_notice
  AFTER UPDATE OF status ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.tg_brand_payout_outcome_notice();

CREATE OR REPLACE FUNCTION public.claim_brand_payout_outcome_notices(
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  notice_id uuid,
  release_id uuid,
  brand_id uuid,
  kind text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT n.id, n.release_id, n.brand_id, n.kind
  FROM public.brand_payout_outcome_notices n
  WHERE n.notified_at IS NULL
  ORDER BY n.created_at, n.id
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$fn$;

CREATE OR REPLACE FUNCTION public.complete_brand_payout_outcome_notices(
  p_notice_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.brand_payout_outcome_notices
  SET notified_at = now()
  WHERE id = ANY (coalesce(p_notice_ids, ARRAY[]::uuid[]))
    AND notified_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Orphan notices for vanished releases can never be delivered: close them.
  UPDATE public.brand_payout_outcome_notices n
  SET notified_at = now()
  WHERE n.notified_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.brand_payout_releases r WHERE r.id = n.release_id
    );
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_brand_payout_outcome_notices(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_brand_payout_outcome_notices(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_brand_payout_outcome_notices(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_brand_payout_outcome_notices(uuid[]) TO service_role;

-- ── §4. Preference CHECK: organiser payout visibility notify types ───────────
-- notify-dispatch preference lookup is keyed on this CHECK. The four new
-- organiser payout types (failed / waiting-for-bank / paused / resumed) must be
-- storable so a host can mute them the same way as business.payout_paid.
ALTER TABLE public.business_notification_type_preferences
  DROP CONSTRAINT IF EXISTS business_notification_type_preferences_type_check;

ALTER TABLE public.business_notification_type_preferences
  ADD CONSTRAINT business_notification_type_preferences_type_check
  CHECK (type IN (
    'business.order_paid',
    'business.event_sold_out',
    'business.low_inventory',
    'business.refund_processed',
    'business.dispute_opened',
    'business.dispute_action_needed',
    'business.payout_paid',
    'business.payout_failed',
    'business.payout_waiting_for_bank',
    'business.payouts_paused',
    'business.payouts_resumed',
    'business.account_status_changed',
    'business.new_review',
    'business.claim_decision',
    'business.team_member_joined'
  ));

-- ── §5. Self-asserts (apply FAILS unless the contract holds) ─────────────────
DO $guard$
DECLARE
  v_def text;
BEGIN
  IF NOT has_function_privilege('authenticated',
       'public.brand_get_payout_visibility(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR10: authenticated cannot EXECUTE brand_get_payout_visibility';
  END IF;
  IF has_function_privilege('anon',
       'public.brand_get_payout_visibility(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR10: anon can EXECUTE brand_get_payout_visibility';
  END IF;
  -- The hold table stays closed: this PR must not have opened it.
  IF has_table_privilege('authenticated', 'public.brand_payout_admin_holds', 'SELECT')
     OR has_table_privilege('anon', 'public.brand_payout_admin_holds', 'SELECT') THEN
    RAISE EXCEPTION 'issue-3645 PR10: brand_payout_admin_holds became readable by anon/authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.brand_payout_pause_notices', 'SELECT')
     OR has_table_privilege('anon', 'public.brand_payout_pause_notices', 'SELECT') THEN
    RAISE EXCEPTION 'issue-3645 PR10: brand_payout_pause_notices is reachable by anon/authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.brand_payout_outcome_notices', 'SELECT')
     OR has_table_privilege('anon', 'public.brand_payout_outcome_notices', 'SELECT') THEN
    RAISE EXCEPTION 'issue-3645 PR10: brand_payout_outcome_notices is reachable by anon/authenticated';
  END IF;
  IF has_function_privilege('authenticated',
       'public.claim_brand_payout_pause_notices(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.complete_brand_payout_pause_notices(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR10: pause-notice drain RPCs are callable by authenticated';
  END IF;
  IF has_function_privilege('authenticated',
       'public.claim_brand_payout_outcome_notices(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.complete_brand_payout_outcome_notices(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR10: outcome-notice drain RPCs are callable by authenticated';
  END IF;
  -- #1180 law: the organiser-facing read never touches ledger internals.
  v_def := pg_get_functiondef('public.brand_get_payout_visibility(uuid)'::regprocedure);
  IF position('error_message' IN v_def) > 0
     OR position('attempt_count' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue-3645 PR10: brand_get_payout_visibility references ledger internals';
  END IF;
  IF position('reason' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue-3645 PR10: brand_get_payout_visibility references the admin hold reason';
  END IF;
END
$guard$;

COMMIT;

NOTIFY pgrst, 'reload schema';
