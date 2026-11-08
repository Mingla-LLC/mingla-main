-- issue #3645 bundle 2d: debt that holds leave unrecovered is owed again, and
-- a postponement debt maturing on an unpaid release never pays twice.
--
-- apply_open_payout_debts withholds open debt from a release once, at attach.
-- 2a (20280422003645) added holds that shrink an unpaid release afterwards,
-- and the projection clamps net at 0 when the holds leave less than the
-- withheld debt. The difference was lost:
--   * permanent debt stayed marked recovered (often closed), so Mingla never
--     recovered it;
--   * postponement debt was recredited in full at maturity on top of net, so
--     the host was paid value that was never withheld.
--
-- Fix, forward-only (no existing row is rewritten):
--   * payout_debt_application_returns: append-only record of debt handed back
--     from an application. The withheld debt is now Σ(amount − converted −
--     returned) over the release's applications.
--   * issue_3645_return_unrecovered_release_debt: on an unpaid release that
--     no organiser payout is under way for, hands back exactly the part holds
--     left uncovered (postponement first, newest debt first) and reopens it.
--   * issue_3645_settle_release_projection (return, then project) is what the
--     stay refresh, the Paystack refresh and the planner now call. The planner
--     falls back to the plain projection if it fails, never stopping payouts.
--   * mature_postponement_debts: on an unpaid release the withheld part goes
--     back through net (a 'matured' return) instead of a recredit on top; a
--     debt with a busy or in-flight release waits a tick, untouched.
--   * The three conversion paths never take a part that was handed back, and
--     the refund and dispute paths lock their debts in id order, as settle does.
--   * A reopened debt that is recovered again logs 'cleared' again.
--
-- Invariants and proofs: __tests__/issue_3645_payout_debt_returns.pg17.test.sql.

BEGIN;

-- §1. Debt handed back from an application. Append-only.
CREATE TABLE public.payout_debt_application_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.payout_debt_applications(id) ON DELETE RESTRICT,
  debt_id uuid NOT NULL
    REFERENCES public.organiser_payout_debts(id) ON DELETE RESTRICT,
  release_id uuid NOT NULL
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  -- 'hold': holds left the release unable to cover it, so the debt reopens.
  -- 'matured': a postponement debt matured while the release was unpaid, so
  -- the withheld part goes back through net instead of a recredit on top.
  reason text NOT NULL CHECK (reason IN ('hold', 'matured')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payout_debt_application_returns_application_idx
  ON public.payout_debt_application_returns (application_id);
CREATE INDEX payout_debt_application_returns_release_idx
  ON public.payout_debt_application_returns (release_id);

CREATE TRIGGER payout_debt_application_returns_append_only
  BEFORE UPDATE OR DELETE ON public.payout_debt_application_returns
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();

-- A return names its application's own debt and release, and an application
-- never hands back more than it still withholds: converted + returned ≤ amount.
CREATE OR REPLACE FUNCTION public.issue_3645_check_debt_application_return()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_app public.payout_debt_applications%ROWTYPE;
  v_returned bigint;
BEGIN
  SELECT * INTO v_app
  FROM public.payout_debt_applications
  WHERE id = NEW.application_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_app.debt_id <> NEW.debt_id
     OR v_app.release_id <> NEW.release_id THEN
    RAISE EXCEPTION 'debt_return_application_mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(r.amount_cents), 0) INTO v_returned
  FROM public.payout_debt_application_returns r
  WHERE r.application_id = NEW.application_id;
  IF v_app.converted_cents::bigint + v_returned + NEW.amount_cents
     > v_app.amount_cents THEN
    RAISE EXCEPTION 'debt_return_exceeds_application' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER payout_debt_application_returns_bound
  BEFORE INSERT ON public.payout_debt_application_returns
  FOR EACH ROW EXECUTE FUNCTION public.issue_3645_check_debt_application_return();

ALTER TABLE public.payout_debt_application_returns ENABLE ROW LEVEL SECURITY;
-- #1856 grant class: tables arrive with ALL for anon/authenticated by default.
REVOKE ALL ON public.payout_debt_application_returns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payout_debt_application_returns FROM service_role;
-- Only the SECURITY DEFINER returner and maturity write returns.
GRANT SELECT ON public.payout_debt_application_returns TO service_role;

COMMENT ON TABLE public.payout_debt_application_returns IS
  'Issue #3645: append-only debt handed back from a payout_debt_applications row — reason hold (holds left the unpaid release unable to cover it; the debt reopens) or matured (a postponement debt matured while the release was unpaid; paid back through net).';

REVOKE ALL ON FUNCTION public.issue_3645_check_debt_application_return()
  FROM PUBLIC, anon, authenticated;

-- §2. A handed-back debt is an event of its own.
DO $do$
DECLARE v_name text;
BEGIN
  SELECT c.conname INTO v_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.payout_debt_events'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%event_kind%';
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'payout_debt_events event_kind CHECK not found';
  END IF;
  EXECUTE format('ALTER TABLE public.payout_debt_events DROP CONSTRAINT %I', v_name);
END;
$do$;

ALTER TABLE public.payout_debt_events
  ADD CONSTRAINT payout_debt_events_event_kind_check CHECK (event_kind IN (
    'opened','anchor_moved','future_value_reserved','future_value_released',
    'cleared','cancellation_converted','recovery_returned'
  ));

-- §3. Shared definitions.
CREATE OR REPLACE FUNCTION public.issue_3645_application_returned_cents(
  p_application_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce(sum(r.amount_cents), 0)::integer
  FROM public.payout_debt_application_returns r
  WHERE r.application_id = p_application_id;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3645_release_effective_withheld(
  p_release_id uuid
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- A conversion moves part of a postponement application to a permanent
  -- 'converted-apply' row on the same release, so Σ(amount − converted) is
  -- the debt withheld at attach; returns are what was handed back since.
  SELECT coalesce(sum(
    a.amount_cents::bigint - a.converted_cents
      - public.issue_3645_application_returned_cents(a.id)
  ), 0)::bigint
  FROM public.payout_debt_applications a
  WHERE a.release_id = p_release_id;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3645_release_settleable(
  p_release_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- Unpaid and not being sent. A partner leg never counts: partner money is
  -- Mingla's (#3872 F1) and does not depend on the host net.
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
      AND r.status NOT IN (
        'released', 'in_flight', 'cancelled_event', 'reanchored', 'failed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.payout_transfer_legs leg
        WHERE leg.release_id = r.id
          AND leg.kind = 'organiser'
          AND leg.status NOT IN ('failed', 'reversed')
      )
  );
$fn$;

-- §4. Hand back the debt an unpaid release can no longer cover.
CREATE OR REPLACE FUNCTION public.issue_3645_return_unrecovered_release_debt(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_totals record;
  v_short bigint;
  v_app record;
  v_take integer;
  v_return_id uuid;
  v_total integer := 0;
BEGIN
  -- Lock order everywhere: release, then debts by id, then applications.
  PERFORM 1 FROM public.brand_payout_releases
  WHERE id = p_release_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_3645_release_settleable(p_release_id) THEN
    RETURN 0;
  END IF;

  -- Only a release that is actually short locks its debts: settle runs on
  -- every planner pass and hold, and apply_open_payout_debts skips a locked
  -- debt (SKIP LOCKED), so locking when nothing is short would make a
  -- concurrent attach pay the host without withholding.
  SELECT * INTO v_totals
  FROM public.issue_3645_release_projected_totals(p_release_id);
  v_short := v_totals.withheld_cents - v_totals.items_net_cents;
  IF v_short IS NULL OR v_short <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM 1 FROM public.organiser_payout_debts d
  WHERE d.id IN (
    SELECT a.debt_id FROM public.payout_debt_applications a
    WHERE a.release_id = p_release_id
  )
  ORDER BY d.id
  FOR UPDATE;

  -- Re-read under the debt locks: a conversion may have moved value since.
  SELECT * INTO v_totals
  FROM public.issue_3645_release_projected_totals(p_release_id);
  v_short := v_totals.withheld_cents - v_totals.items_net_cents;
  IF v_short IS NULL OR v_short <= 0 THEN
    RETURN 0;
  END IF;

  -- Postponement value first (it is protective, not owed), then permanent
  -- debt; newest debt first, the exact reverse of apply_open_payout_debts.
  -- Matured applications are skipped: maturity already settled them.
  FOR v_app IN
    SELECT
      a.id, a.debt_id, d.kind,
      a.amount_cents - a.converted_cents
        - public.issue_3645_application_returned_cents(a.id) AS effective,
      public.issue_3645_application_returned_cents(a.id) AS returned
    FROM public.payout_debt_applications a
    JOIN public.organiser_payout_debts d ON d.id = a.debt_id
    WHERE a.release_id = p_release_id
      AND a.released_at IS NULL
    ORDER BY (d.kind = 'post_release_postponement') DESC,
      d.opened_at DESC, d.id DESC, a.id DESC
    FOR UPDATE OF a
  LOOP
    EXIT WHEN v_short <= 0;
    CONTINUE WHEN v_app.effective <= 0;
    v_take := least(v_short, v_app.effective)::integer;

    v_return_id := NULL;
    INSERT INTO public.payout_debt_application_returns(
      application_id, debt_id, release_id, reason, amount_cents,
      idempotency_key, created_at
    ) VALUES (
      v_app.id, v_app.debt_id, p_release_id, 'hold', v_take,
      'debt-return:' || v_app.id || ':' || (v_app.returned + v_take),
      p_now
    ) ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_return_id;
    CONTINUE WHEN v_return_id IS NULL;

    -- The debt is owed again: a closed permanent debt reopens, so the next
    -- release attached for this brand withholds it.
    UPDATE public.organiser_payout_debts SET
      recovered_cents = recovered_cents - v_take,
      status = CASE
        WHEN kind <> 'post_release_postponement' AND status = 'closed'
          THEN 'open'
        ELSE status
      END,
      closed_at = CASE
        WHEN kind <> 'post_release_postponement' AND status = 'closed'
          THEN NULL
        ELSE closed_at
      END,
      updated_at = p_now
    WHERE id = v_app.debt_id;

    INSERT INTO public.payout_debt_events(
      debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at
    ) VALUES (
      v_app.debt_id, 'recovery_returned', v_take, p_release_id,
      'debt-returned:' || v_return_id, p_now
    );

    v_short := v_short - v_take;
    v_total := v_total + v_take;
  END LOOP;

  RETURN v_total;
END;
$fn$;

-- §5. The one writer path: hand back what holds left uncovered, then project.
CREATE OR REPLACE FUNCTION public.issue_3645_settle_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE (
  refunded_cents integer,
  disputed_cents integer,
  net_release_cents integer,
  items_net_cents bigint,
  withheld_cents bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.issue_3645_return_unrecovered_release_debt(p_release_id, p_now);
  RETURN QUERY
  SELECT * FROM public.issue_3645_release_projected_totals(p_release_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_application_returned_cents(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_release_effective_withheld(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_release_settleable(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_return_unrecovered_release_debt(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_settle_release_projection(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_application_returned_cents(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_effective_withheld(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_settleable(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_return_unrecovered_release_debt(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_settle_release_projection(uuid, timestamptz) TO service_role;

-- ---- issue_3645_release_projected_totals (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
-- The result columns grow, which CREATE OR REPLACE cannot do.
DROP FUNCTION public.issue_3645_release_projected_totals(uuid);
CREATE OR REPLACE FUNCTION public.issue_3645_release_projected_totals(
  p_release_id uuid
) RETURNS TABLE (
  refunded_cents integer,
  disputed_cents integer,
  net_release_cents integer,
  items_net_cents bigint,
  withheld_cents bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH rel AS (
    SELECT r.id, r.provider,
      -- #3645 2d: Σ(amount − converted − returned) over the release's
      -- applications, not the attach-time columns, so debt handed back by
      -- issue_3645_return_unrecovered_release_debt is no longer withheld.
      public.issue_3645_release_effective_withheld(r.id) AS withheld
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
  ), items AS (
    SELECT
      item.gross_cents::bigint AS gross,
      item.refunded_cents::bigint AS refunded,
      item.disputed_cents::bigint AS disputed,
      item.net_cents::bigint AS net,
      -- Paystack: same evidence as paystack_release_has_unresolved_dispute
      -- (unresolved, or resolved against the merchant).
      CASE WHEN rel.provider = 'paystack' THEN coalesce((
        SELECT sum(dispute.amount_cents::bigint)
        FROM public.paystack_disputes dispute
        WHERE (
            (item.source_type = 'order' AND dispute.order_id = item.source_id)
            OR (
              item.source_type = 'rsvp_contribution'
              AND dispute.rsvp_contribution_id = item.source_id
            )
            OR (
              item.source_type = 'venue_menu_order'
              AND dispute.venue_menu_order_id = item.source_id
            )
            OR (
              item.source_type = 'order_installment'
              AND dispute.order_installment_id = item.source_id
            )
            OR (
              item.source_type = 'venue_reservation'
              AND EXISTS (
                SELECT 1
                FROM public.reservation_checkout_sessions checkout
                WHERE checkout.id = item.source_id
                  AND checkout.reservation_id = dispute.venue_reservation_id
              )
            )
          )
          AND (
            dispute.is_resolved IS NOT TRUE
            OR lower(coalesce(dispute.resolution, '')) IN (
              'merchant-accepted', 'merchant_accepted', 'accepted'
            )
          )
      ), 0) ELSE 0 END AS paystack_hold,
      coalesce(stay.refunded, 0) AS stay_refunded,
      greatest(coalesce(stay.disputed, 0), 0) AS stay_disputed,
      greatest(coalesce(stay.net_hold, 0), 0) AS stay_net_hold
    FROM rel
    JOIN public.payout_release_items item ON item.release_id = rel.id
    LEFT JOIN LATERAL (
      SELECT
        sum(hold.refunded_cents)::bigint AS refunded,
        sum(hold.disputed_cents)::bigint AS disputed,
        sum(hold.net_hold_cents)::bigint AS net_hold
      FROM public.stay_payout_release_holds hold
      WHERE item.source_type = 'stay_reservation'
        AND hold.release_id = rel.id
        AND hold.line_id = item.source_id
    ) stay ON true
  ), per_item AS (
    SELECT
      least(gross, refunded + stay_refunded) AS refunded,
      disputed + least(net, paystack_hold) + stay_disputed AS disputed,
      net - least(net, paystack_hold + stay_net_hold) AS net
    FROM items
  )
  SELECT
    least(coalesce(sum(per_item.refunded), 0), 2147483647)::integer,
    least(coalesce(sum(per_item.disputed), 0), 2147483647)::integer,
    -- maturity_recredit_cents stays out: claims pay net + recredit.
    greatest(0, least(
      coalesce(sum(per_item.net), 0)
        - rel.withheld,
      2147483647
    ))::integer,
    coalesce(sum(per_item.net), 0)::bigint,
    rel.withheld
  FROM rel
  LEFT JOIN per_item ON true
  GROUP BY rel.withheld;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_release_projected_totals(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_projected_totals(uuid)
  TO service_role;

-- ---- issue_3645_refresh_stay_release_projection (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.issue_3645_refresh_stay_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_totals record;
  v_open boolean;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payout_release_items item
    WHERE item.release_id = p_release_id
      AND item.source_type = 'stay_reservation'
  ) THEN
    RAISE EXCEPTION 'stay_release_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_release.status = 'released' THEN
    RETURN jsonb_build_object('release_id', p_release_id, 'projected', false);
  END IF;
  -- Never move a release while its payout is being sent: a claimed release,
  -- or a Paystack release whose transfer legs are planned or under way
  -- (a re-claim reuses those legs). The caller's event fails retryably and is
  -- redelivered once the payout settles (post-payout path) or is released.
  IF v_release.status = 'in_flight' OR EXISTS (
    SELECT 1 FROM public.payout_transfer_legs leg
    WHERE leg.release_id = p_release_id
      AND leg.kind = 'organiser'  -- #3645 2d: partner legs never block
      AND leg.status NOT IN ('failed', 'reversed')
  ) THEN
    RAISE EXCEPTION 'stay_release_payout_in_flight' USING ERRCODE = '55P03';
  END IF;

  SELECT * INTO v_totals
  FROM public.issue_3645_settle_release_projection(p_release_id, p_now);
  v_open := public.issue_3645_stay_release_has_open_dispute(p_release_id);

  UPDATE public.brand_payout_releases
  SET refunded_cents = v_totals.refunded_cents,
      disputed_cents = v_totals.disputed_cents,
      net_release_cents = v_totals.net_release_cents,
      -- Never overwrite another reason the release is waiting.
      error_message = CASE
        WHEN v_open THEN coalesce(error_message, 'stay_dispute_open')
        WHEN error_message = 'stay_dispute_open' THEN NULL
        ELSE error_message
      END,
      updated_at = p_now
  WHERE id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'projected', true,
    'refunded_cents', v_totals.refunded_cents,
    'disputed_cents', v_totals.disputed_cents,
    'net_release_cents', v_totals.net_release_cents,
    'dispute_open', v_open
  );
END;
$fn$;

-- ---- refresh_paystack_dispute_release_projection (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.refresh_paystack_dispute_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_disputed integer;
  v_net integer;
  v_unresolved boolean;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id
    AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_release.status = 'released' THEN
    RAISE EXCEPTION 'pending_paystack_release_required' USING ERRCODE = 'P0001';
  END IF;

  -- #3645 2d: release an in-flight claim first (the same reset as below),
  -- so settle sees the release as unpaid and can hand back unrecovered debt.
  IF v_release.status = 'in_flight' THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
  END IF;

  -- #3645: one formula for every pending release (items, holds, withheld
  -- debt, recredit), shared with plan_pending_payout_partner_legs, so the
  -- debt recovered from this release is never paid out again.
  SELECT projected.disputed_cents, projected.net_release_cents
  INTO v_disputed, v_net
  FROM public.issue_3645_settle_release_projection(p_release_id, p_now) projected;

  v_unresolved := public.paystack_release_has_unresolved_dispute(p_release_id);

  UPDATE public.brand_payout_releases
  SET disputed_cents = v_disputed,
      net_release_cents = v_net,
      status = CASE WHEN status = 'in_flight' THEN 'pending' ELSE status END,
      paystack_execution_claim_id = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claim_id END,
      paystack_execution_claimed_at = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claimed_at END,
      error_message = CASE
        WHEN v_unresolved THEN 'paystack_dispute_open'
        WHEN error_message = 'paystack_dispute_open' THEN NULL
        ELSE error_message
      END,
      updated_at = p_now
  WHERE id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'disputed_cents', v_disputed,
    'net_release_cents', v_net,
    'unresolved', v_unresolved
  );
END;
$fn$;

-- ---- plan_pending_payout_partner_legs (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.plan_pending_payout_partner_legs(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_release record;
  v_split record;
  v_planned integer := 0;
  v_fee integer;
  v_stamp integer;
  v_partner_cost integer;
  v_principal_corrections integer := 0;
  v_new_corrections integer;
  v_gross integer;
  v_refunded integer;
  v_disputed integer;
  v_mingla_fee integer;
  v_item_partner_share integer;
  v_provider_fee integer;
  v_item_net integer;
  v_projected record;  -- #3645
  v_lock_timeout text;  -- #3645 2d
  v_missing_attributions integer;
  v_blocked_attributions integer := 0;
BEGIN
  FOR v_release IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'pending'
    ORDER BY r.releasable_at, r.id
    LIMIT greatest(1, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*)::integer
      INTO v_missing_attributions
    FROM public.payout_release_items i
    LEFT JOIN public.payout_partner_attributions a
      ON a.order_id = i.source_id
    WHERE i.release_id = v_release.id
      AND i.source_type = 'order'
      AND i.mingla_fee_cents > 0
      AND a.order_id IS NULL;
    IF v_missing_attributions > 0 THEN
      v_blocked_attributions :=
        v_blocked_attributions + v_missing_attributions;
      CONTINUE;
    END IF;

    v_new_corrections :=
      public.reconcile_payout_partner_principal(v_release.id);
    v_principal_corrections :=
      v_principal_corrections + v_new_corrections;

    FOR v_split IN
      SELECT DISTINCT ps.id, ps.provider, ps.partner_share_cents
      FROM public.payout_release_items i
      JOIN public.partner_splits ps
        ON ps.order_id = i.source_id
       AND i.source_type = 'order'
      WHERE i.release_id = v_release.id
        AND ps.status = 'held'
        AND ps.release_id IS NULL
      ORDER BY ps.id
    LOOP
      -- Paystack cannot move a partner leg below its verified ₦50 floor.
      -- The split remains held and incurs no fee until a later contract
      -- explicitly aggregates sub-floor partner principal.
      IF v_split.provider = 'paystack'
         AND v_split.partner_share_cents < 5000 THEN
        CONTINUE;
      END IF;

      IF v_split.provider = 'paystack' THEN
        v_fee := CASE
          WHEN v_split.partner_share_cents <= 500000 THEN 1000
          WHEN v_split.partner_share_cents <= 5000000 THEN 2500
          ELSE 5000
        END;
        v_stamp := CASE
          WHEN v_split.partner_share_cents >= 1000000 THEN 5000
          ELSE 0
        END;
      ELSE
        v_fee := 0;
        v_stamp := 0;
      END IF;

      INSERT INTO public.payout_transfer_legs (
        release_id,
        partner_split_id,
        kind,
        chunk_index,
        principal_cents,
        estimated_fee_cents,
        stamp_duty_cents,
        fee_schedule_version
      )
      VALUES (
        v_release.id,
        v_split.id,
        'partner',
        0,
        v_split.partner_share_cents,
        v_fee,
        v_stamp,
        CASE
          WHEN v_split.provider = 'paystack' THEN 'verified-2026-07-24'
          ELSE 'stripe-platform-transfer-v1'
        END
      )
      ON CONFLICT (release_id, kind, partner_split_id, chunk_index)
      DO NOTHING;
      IF FOUND THEN v_planned := v_planned + 1; END IF;
    END LOOP;

    SELECT coalesce(sum(estimated_fee_cents + stamp_duty_cents), 0)::integer
      INTO v_partner_cost
    FROM public.payout_transfer_legs
    WHERE release_id = v_release.id
      AND kind = 'partner';

    SELECT
      coalesce(sum(gross_cents), 0)::integer,
      coalesce(sum(refunded_cents), 0)::integer,
      coalesce(sum(disputed_cents), 0)::integer,
      coalesce(sum(mingla_fee_cents), 0)::integer,
      coalesce(sum(partner_share_cents), 0)::integer,
      coalesce(sum(provider_fee_cents), 0)::integer,
      coalesce(sum(net_cents), 0)::integer
    INTO
      v_gross,
      v_refunded,
      v_disputed,
      v_mingla_fee,
      v_item_partner_share,
      v_provider_fee,
      v_item_net
    FROM public.payout_release_items
    WHERE release_id = v_release.id;

    SELECT coalesce(sum(amount_cents), 0)::integer
      INTO v_new_corrections
    FROM public.payout_ledger_adjustments
    WHERE release_id = v_release.id
      AND kind = 'partner_principal_correction';

    -- #3645: refunded, disputed and net come from the shared projection, so
    -- holds recorded while a release is unpaid survive every rebuild.
    -- #3645 2d: settle first hands back debt that holds left unrecovered.
    -- A failure on one release (a busy debt, a broken invariant) must not stop
    -- every payout: roll back just that settle, warn with the SQLSTATE, and
    -- use today's projection; the next pass retries.
    v_lock_timeout := current_setting('lock_timeout');
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      SELECT * INTO v_projected
      FROM public.issue_3645_settle_release_projection(v_release.id, now());
      PERFORM set_config('lock_timeout', v_lock_timeout, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('lock_timeout', v_lock_timeout, true);
      RAISE WARNING 'issue_3645_settle_failed release=% sqlstate=% message=%',
        v_release.id, SQLSTATE, SQLERRM;
      SELECT * INTO v_projected
      FROM public.issue_3645_release_projected_totals(v_release.id);
    END;

    -- Rebuild from immutable items plus append-only corrections so retries
    -- cannot double-deduct either principal or transfer costs.
    UPDATE public.brand_payout_releases
    SET gross_cents = v_gross,
        refunded_cents = v_projected.refunded_cents,
        disputed_cents = v_projected.disputed_cents,
        mingla_fee_cents = v_mingla_fee,
        partner_share_cents = v_item_partner_share + v_new_corrections,
        provider_fee_cents = v_provider_fee,
        -- Issue #3872 (F1): partner money is Mingla's (platform balance).
        -- #3645 (Seth 2026-10-21): the host net is the sum of the STORED item
        -- nets, so a pre-flat-4.5% item keeps its old maths and a new-rule
        -- item keeps gross − mingla_fee. Never re-derive it from gross/fee.
        -- #3645: Σ item net − holds − withheld debt, computed by
        -- issue_3645_release_projected_totals. The maturity recredit is no
        -- longer folded in here: every claim and authorize already pays
        -- net_release_cents + maturity_recredit_cents, so adding it to net
        -- paid it twice.
        net_release_cents = v_projected.net_release_cents,
        updated_at = now()
    WHERE id = v_release.id;
  END LOOP;

  RETURN jsonb_build_object(
    'planned_partner_legs', v_planned,
    'partner_principal_corrections', v_principal_corrections,
    'blocked_partner_attributions', v_blocked_attributions
  );
END;
$function$;

-- ---- mature_postponement_debts (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.mature_postponement_debts(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_debt record; v_app record; v_recredit integer; v_count integer:=0;
  v_return_id uuid;  -- #3645 2d
BEGIN
  FOR v_debt IN
    SELECT * FROM public.organiser_payout_debts
     WHERE kind='post_release_postponement' AND status='open' AND maturity_at<=p_now
     ORDER BY maturity_at,id FOR UPDATE SKIP LOCKED
  LOOP
    -- #3645 2d: every release this debt touches is locked up front, without
    -- waiting (the returner locks release, then debt). If one is busy, or a
    -- payout is in flight on it, nothing of this debt is done this tick:
    -- no released_at, no recredit, no return, no writeoff, no close.
    BEGIN
      PERFORM 1 FROM public.brand_payout_releases r
      WHERE r.id IN (
        SELECT a.release_id FROM public.payout_debt_applications a
        WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
      )
      ORDER BY r.id FOR UPDATE NOWAIT;
      -- and every debt withheld from those releases, so settling them below
      -- never waits on another transaction.
      PERFORM 1 FROM public.organiser_payout_debts d
      WHERE d.id IN (
        SELECT a2.debt_id FROM public.payout_debt_applications a2
        WHERE a2.release_id IN (
          SELECT a.release_id FROM public.payout_debt_applications a
          WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
        )
      )
      ORDER BY d.id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;
    IF EXISTS (
      SELECT 1 FROM public.payout_debt_applications a
      JOIN public.brand_payout_releases r ON r.id=a.release_id
      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
        AND r.status='in_flight'
    ) THEN
      CONTINUE;
    END IF;
    -- #3645 2d: settle each unpaid release first, so the part holds left
    -- uncovered is handed back as a 'hold' return (and written off below)
    -- before maturity hands the rest back through net. Maturity and settle
    -- then end in the same state whichever runs first.
    PERFORM public.issue_3645_return_unrecovered_release_debt(x.release_id, p_now)
    FROM (
      SELECT DISTINCT a.release_id FROM public.payout_debt_applications a
      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
    ) x;
    SELECT * INTO v_debt FROM public.organiser_payout_debts WHERE id=v_debt.id;
    FOR v_app IN
      SELECT * FROM public.payout_debt_applications
      WHERE debt_id=v_debt.id AND released_at IS NULL
      ORDER BY created_at,id FOR UPDATE
    LOOP
      -- #3645 2d: what this application still withholds.
      v_recredit:=v_app.amount_cents-v_app.converted_cents
        -public.issue_3645_application_returned_cents(v_app.id);
      IF v_recredit>0 AND public.issue_3645_release_settleable(v_app.release_id) THEN
        -- #3645 2d: the release is unpaid, so hand the withheld part back
        -- through net (a 'matured' return) instead of booking a recredit on
        -- top: net = max(0, N − W) cannot overpay when holds shrank N, and a
        -- recredit can. recovered_cents is NOT lowered: the debt is closed
        -- below and its writeoff stays principal − recovered as read above.
        INSERT INTO public.payout_debt_application_returns(
          application_id,debt_id,release_id,reason,amount_cents,idempotency_key,created_at
        ) VALUES(
          v_app.id,v_debt.id,v_app.release_id,'matured',v_recredit,
          'postpone-return:'||v_app.id,p_now
        ) ON CONFLICT(idempotency_key) DO NOTHING
        RETURNING id INTO v_return_id;
        IF v_return_id IS NOT NULL THEN
          UPDATE public.brand_payout_releases r SET
            net_release_cents=projected.net_release_cents,updated_at=p_now
          FROM public.issue_3645_release_projected_totals(v_app.release_id) projected
          WHERE r.id=v_app.release_id;
          INSERT INTO public.payout_debt_events(
            debt_id,event_kind,amount_cents,anchor_at,release_id,idempotency_key
          ) VALUES(
            v_debt.id,'future_value_released',v_recredit,v_debt.maturity_at,
            v_app.release_id,'postpone-released:'||v_app.id
          ) ON CONFLICT(idempotency_key) DO NOTHING;
        END IF;
      ELSIF v_recredit>0 THEN
        INSERT INTO public.payout_ledger_adjustments(
          release_id,brand_id,currency,kind,amount_cents,idempotency_key
        ) VALUES(
          v_app.release_id,v_debt.brand_id,v_debt.currency,'maturity_recredit',
          v_recredit,'postpone-recredit:'||v_app.id
        ) ON CONFLICT(idempotency_key) DO NOTHING;
        INSERT INTO public.payout_debt_events(
          debt_id,event_kind,amount_cents,anchor_at,release_id,idempotency_key
        ) VALUES(
          v_debt.id,'future_value_released',v_recredit,v_debt.maturity_at,
          v_app.release_id,'postpone-released:'||v_app.id
        ) ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
      UPDATE public.payout_debt_applications SET released_at=p_now WHERE id=v_app.id;
    END LOOP;
    IF v_debt.principal_cents>v_debt.recovered_cents THEN
      INSERT INTO public.payout_ledger_adjustments(
        release_id,brand_id,currency,kind,amount_cents,idempotency_key
      ) VALUES(
        v_debt.origin_release_id,v_debt.brand_id,v_debt.currency,'debt_writeoff',
        v_debt.principal_cents-v_debt.recovered_cents,'postpone-close:'||v_debt.id
      ) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    UPDATE public.organiser_payout_debts SET
      recovered_cents=0,status='closed',closed_at=p_now,updated_at=p_now
     WHERE id=v_debt.id;
    INSERT INTO public.payout_debt_events(debt_id,event_kind,amount_cents,anchor_at,idempotency_key)
    VALUES(
      v_debt.id,'cleared',v_debt.recovered_cents,v_debt.maturity_at,
      'postpone-cleared:'||v_debt.id||':'||
        extract(epoch from v_debt.maturity_at)::bigint
    )
    ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

-- ---- apply_open_payout_debts (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.apply_open_payout_debts(
  p_release_id uuid,
  p_now timestamptz
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_release public.brand_payout_releases; v_debt record; v_available integer; v_take integer; v_total integer:=0;
BEGIN
  SELECT * INTO v_release FROM public.brand_payout_releases
   WHERE id=p_release_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_available := v_release.net_release_cents;
  FOR v_debt IN
    SELECT * FROM public.organiser_payout_debts
     WHERE brand_id=v_release.brand_id AND currency=v_release.currency AND status='open'
       AND (kind <> 'post_release_postponement' OR maturity_at > p_now)
     ORDER BY CASE WHEN kind='post_release_postponement' THEN 1 ELSE 0 END, opened_at, id
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_available=0;
    v_take:=least(v_available,v_debt.principal_cents-v_debt.recovered_cents);
    IF v_take>0 THEN
      INSERT INTO public.payout_debt_applications(debt_id,release_id,amount_cents,idempotency_key)
      VALUES(v_debt.id,p_release_id,v_take,'debt-apply:'||v_debt.id||':'||p_release_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
      IF FOUND THEN
        UPDATE public.organiser_payout_debts
        SET recovered_cents=recovered_cents+v_take,
            status=CASE
              WHEN kind<>'post_release_postponement'
               AND recovered_cents+v_take=principal_cents THEN 'closed'
              ELSE status END,
            closed_at=CASE
              WHEN kind<>'post_release_postponement'
               AND recovered_cents+v_take=principal_cents THEN p_now
              ELSE closed_at END,
            updated_at=p_now
         WHERE id=v_debt.id;
        INSERT INTO public.payout_debt_events(debt_id,event_kind,amount_cents,release_id,idempotency_key)
        VALUES(v_debt.id,'future_value_reserved',v_take,p_release_id,
          'debt-reserve:'||v_debt.id||':'||p_release_id) ON CONFLICT DO NOTHING;
        IF v_debt.kind<>'post_release_postponement'
           AND v_debt.recovered_cents+v_take=v_debt.principal_cents THEN
          INSERT INTO public.payout_debt_events(
            debt_id,event_kind,amount_cents,release_id,idempotency_key,created_at
          ) VALUES(
            v_debt.id,'cleared',v_debt.principal_cents,p_release_id,
            'permanent-cleared:'||v_debt.id||':'||p_release_id,p_now  -- #3645 2d
          ) ON CONFLICT(idempotency_key) DO NOTHING;
        END IF;
        v_available:=v_available-v_take; v_total:=v_total+v_take;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.brand_payout_releases SET
    permanent_debt_withheld_cents = (
      SELECT coalesce(sum(a.amount_cents),0)::int FROM public.payout_debt_applications a
      JOIN public.organiser_payout_debts d ON d.id=a.debt_id
      WHERE a.release_id=p_release_id AND d.kind <> 'post_release_postponement'
    ),
    temporary_debt_withheld_cents = (
      SELECT coalesce(sum(a.amount_cents),0)::int FROM public.payout_debt_applications a
      JOIN public.organiser_payout_debts d ON d.id=a.debt_id
      WHERE a.release_id=p_release_id AND d.kind='post_release_postponement'
    ),
    net_release_cents=v_available,updated_at=p_now
  WHERE id=p_release_id;
  RETURN v_total;
END;
$fn$;

-- ---- convert_postponement_debt_to_permanent (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.convert_postponement_debt_to_permanent(
  p_origin_release_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_temp public.organiser_payout_debts;
  v_permanent_id uuid;
  v_overlap integer:=0;
  v_recovered_overlap integer:=0;
  v_left integer;
  v_app record;
  v_take integer;
BEGIN
  IF p_kind NOT IN ('post_release_refund','post_release_dispute','post_release_cancellation')
     OR p_amount_cents<=0 THEN
    RAISE EXCEPTION 'invalid_permanent_debt_conversion' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_release FROM public.brand_payout_releases
  WHERE id=p_origin_release_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'origin_release_not_found' USING ERRCODE='P0002'; END IF;

  SELECT id INTO v_permanent_id FROM public.organiser_payout_debts
  WHERE origin_release_id=p_origin_release_id AND kind=p_kind;
  IF FOUND THEN RETURN v_permanent_id; END IF;

  -- #3645 2d: key-share the releases a conversion may insert onto before any
  -- debt lock, as settle locks release then debt (else the two deadlock).
  PERFORM 1 FROM public.brand_payout_releases r
  WHERE r.id IN (
    SELECT a.release_id FROM public.payout_debt_applications a
    JOIN public.organiser_payout_debts d ON d.id=a.debt_id
    WHERE d.origin_release_id=p_origin_release_id
      AND d.kind='post_release_postponement' AND a.released_at IS NULL
  )
  ORDER BY r.id FOR KEY SHARE;
  SELECT * INTO v_temp FROM public.organiser_payout_debts
  WHERE origin_release_id=p_origin_release_id
    AND kind='post_release_postponement' AND status='open'
  FOR UPDATE;
  IF FOUND THEN
    v_overlap:=least(p_amount_cents,v_temp.principal_cents);
    v_recovered_overlap:=least(v_overlap,v_temp.recovered_cents);
  END IF;

  INSERT INTO public.organiser_payout_debts(
    brand_id,currency,origin_release_id,kind,principal_cents,recovered_cents,
    status,idempotency_key,opened_at,updated_at,closed_at
  ) VALUES(
    v_release.brand_id,v_release.currency,p_origin_release_id,p_kind,p_amount_cents,
    v_recovered_overlap,
    CASE WHEN v_recovered_overlap=p_amount_cents THEN 'closed' ELSE 'open' END,
    'permanent:'||p_kind||':'||p_origin_release_id,p_now,p_now,
    CASE WHEN v_recovered_overlap=p_amount_cents THEN p_now ELSE NULL END
  ) RETURNING id INTO v_permanent_id;

  IF v_overlap>0 THEN
    v_left:=v_recovered_overlap;
    FOR v_app IN
      SELECT * FROM public.payout_debt_applications
      WHERE debt_id=v_temp.id AND released_at IS NULL
        AND amount_cents>converted_cents
          +public.issue_3645_application_returned_cents(id)  -- #3645 2d
      ORDER BY created_at,id FOR UPDATE
    LOOP
      EXIT WHEN v_left=0;
      v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents
        -public.issue_3645_application_returned_cents(v_app.id));  -- #3645 2d
      UPDATE public.payout_debt_applications
      SET converted_cents=converted_cents+v_take WHERE id=v_app.id;
      INSERT INTO public.payout_debt_applications(
        debt_id,release_id,amount_cents,idempotency_key,created_at
      ) VALUES(
        v_permanent_id,v_app.release_id,v_take,
        'converted-apply:'||v_permanent_id||':'||v_app.id,p_now
      ) ON CONFLICT(idempotency_key) DO NOTHING;
      v_left:=v_left-v_take;
    END LOOP;
    UPDATE public.organiser_payout_debts SET
      principal_cents=principal_cents-v_overlap,
      recovered_cents=recovered_cents-v_recovered_overlap,
      status=CASE WHEN principal_cents-v_overlap=0 THEN 'converted' ELSE 'open' END,
      closed_at=CASE WHEN principal_cents-v_overlap=0 THEN p_now ELSE NULL END,
      updated_at=p_now
    WHERE id=v_temp.id;
    INSERT INTO public.payout_debt_events(
      debt_id,event_kind,amount_cents,release_id,idempotency_key,created_at
    ) VALUES(
      v_temp.id,'cancellation_converted',v_overlap,p_origin_release_id,
      'postpone-convert:'||v_temp.id||':'||p_kind,p_now
    );
  END IF;
  IF v_recovered_overlap=p_amount_cents THEN
    INSERT INTO public.payout_debt_events(
      debt_id,event_kind,amount_cents,release_id,idempotency_key,created_at
    ) VALUES(
      v_permanent_id,'cleared',p_amount_cents,p_origin_release_id,
      'permanent-cleared:'||v_permanent_id,p_now
    ) ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN v_permanent_id;
END;
$fn$;

-- ---- record_paystack_refund_outcome (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.record_paystack_refund_outcome(
  p_source_type text,
  p_source_id uuid,
  p_local_refund_id uuid,
  p_transaction_reference text,
  p_merchant_note text,
  p_provider_refund_id text,
  p_amount_cents integer,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_attempt_id uuid;
  v_release_id uuid;
  v_release public.brand_payout_releases;
  v_liability integer;
  v_adjustment_key text;
  v_debt_id uuid;
  v_debt public.organiser_payout_debts;
  v_temp public.organiser_payout_debts;
  v_target_liability integer;
  v_growth integer;
  v_overlap integer;
  v_recovered_overlap integer;
  v_left integer;
  v_take integer;
  v_app record;
  v_room integer;
BEGIN
  IF p_source_type NOT IN ('order','venue_reservation','order_installment')
     OR p_source_id IS NULL
     OR p_transaction_reference IS NULL OR btrim(p_transaction_reference)=''
     OR p_merchant_note IS NULL OR btrim(p_merchant_note)=''
     OR p_amount_cents<0
     OR p_status NOT IN ('pending','accepted','processed','failed') THEN
    RAISE EXCEPTION 'invalid_paystack_refund_outcome' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.paystack_refund_attempts(
    source_type,source_id,local_refund_id,transaction_reference,merchant_note,
    provider_refund_id,amount_cents,currency,status,error_message,idempotency_key,
    created_at,updated_at
  ) VALUES(
    p_source_type,p_source_id,p_local_refund_id,p_transaction_reference,p_merchant_note,
    NULLIF(p_provider_refund_id,''),p_amount_cents,'ngn',p_status,p_error_message,
    'paystack-refund:'||p_merchant_note,p_now,p_now
  )
  ON CONFLICT(idempotency_key) DO UPDATE SET
    provider_refund_id=coalesce(
      public.paystack_refund_attempts.provider_refund_id,
      excluded.provider_refund_id
    ),
    status=CASE
      WHEN public.paystack_refund_attempts.status='processed' THEN 'processed'
      WHEN excluded.status='processed' THEN 'processed'
      WHEN excluded.status='failed' THEN 'failed'
      WHEN public.paystack_refund_attempts.status='accepted'
        OR excluded.status='accepted' THEN 'accepted'
      ELSE public.paystack_refund_attempts.status
    END,
    error_message=excluded.error_message,
    updated_at=excluded.updated_at
  RETURNING id INTO v_attempt_id;

  IF p_status<>'processed' THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  SELECT pri.release_id INTO v_release_id
  FROM public.payout_release_items pri
  JOIN public.brand_payout_releases r ON r.id=pri.release_id
  WHERE pri.source_type=p_source_type
    AND pri.source_id=p_source_id
    AND r.provider='paystack'
    AND r.status='released'
  LIMIT 1;
  IF v_release_id IS NULL THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  SELECT * INTO v_release FROM public.brand_payout_releases
  WHERE id=v_release_id FOR UPDATE;
  PERFORM 1
  FROM public.brand_payout_releases r
  WHERE r.brand_id = v_release.brand_id
    AND r.currency = v_release.currency
    AND r.status = 'released'
    AND (
      v_release.event_id IS NULL
      OR r.event_id IS NOT DISTINCT FROM v_release.event_id
    )
  ORDER BY r.id
  FOR UPDATE;
  v_room:=public.organiser_refund_debt_room_cents(
    v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
  );
  v_liability:=least(p_amount_cents, v_room);
  IF v_liability<=0 THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  v_adjustment_key:='paystack-refund-liability:'||v_attempt_id;
  INSERT INTO public.payout_ledger_adjustments(
    release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key,created_at
  ) VALUES(
    v_release.id,v_release.brand_id,v_release.currency,'post_release_refund',
    v_liability,NULLIF(p_provider_refund_id,''),v_adjustment_key,p_now
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT id INTO v_debt_id FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id AND kind='post_release_refund';
    RETURN jsonb_build_object(
      'attempt_id',v_attempt_id,'debt_created',v_debt_id IS NOT NULL,'debt_id',v_debt_id
    );
  END IF;

  SELECT least(
    least(coalesce(sum(amount_cents),0), 2147483647::bigint)::integer,
    v_room
  ) INTO v_target_liability
  FROM public.payout_ledger_adjustments
  WHERE release_id=v_release.id AND kind='post_release_refund';

  -- #3645 2d: key-share the releases a conversion may insert onto, then
  -- lock both debts in id order: settle locks release, then debts.
  PERFORM 1 FROM public.brand_payout_releases r
  WHERE r.id IN (
    SELECT a.release_id FROM public.payout_debt_applications a
    JOIN public.organiser_payout_debts d ON d.id=a.debt_id
    WHERE d.origin_release_id=v_release.id
      AND d.kind='post_release_postponement' AND a.released_at IS NULL
  )
  ORDER BY r.id FOR KEY SHARE;
  PERFORM 1 FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release.id
    AND kind IN ('post_release_refund','post_release_postponement')
  ORDER BY id FOR UPDATE;
  SELECT * INTO v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release.id AND kind='post_release_refund'
  FOR UPDATE;
  IF NOT FOUND THEN
    v_debt_id:=public.convert_postponement_debt_to_permanent(
      v_release.id,'post_release_refund',v_target_liability,p_now
    );
  ELSIF v_target_liability>v_debt.principal_cents THEN
    v_growth:=v_target_liability-v_debt.principal_cents;
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id
      AND kind='post_release_postponement' AND status='open'
    FOR UPDATE;
    IF FOUND THEN
      v_overlap:=least(v_growth,v_temp.principal_cents);
      v_recovered_overlap:=least(v_overlap,v_temp.recovered_cents);
    ELSE
      v_overlap:=0;
      v_recovered_overlap:=0;
    END IF;

    UPDATE public.organiser_payout_debts SET
      principal_cents=v_target_liability,
      recovered_cents=recovered_cents+v_recovered_overlap,
      status=CASE
        WHEN recovered_cents+v_recovered_overlap=v_target_liability THEN 'closed'
        ELSE 'open'
      END,
      closed_at=CASE
        WHEN recovered_cents+v_recovered_overlap=v_target_liability THEN p_now
        ELSE NULL
      END,
      updated_at=p_now
    WHERE id=v_debt.id;
    v_debt_id:=v_debt.id;

    IF v_overlap>0 THEN
      v_left:=v_recovered_overlap;
      FOR v_app IN
        SELECT * FROM public.payout_debt_applications
        WHERE debt_id=v_temp.id AND released_at IS NULL
          AND amount_cents>converted_cents
            +public.issue_3645_application_returned_cents(id)  -- #3645 2d
        ORDER BY created_at,id FOR UPDATE
      LOOP
        EXIT WHEN v_left=0;
        v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents
          -public.issue_3645_application_returned_cents(v_app.id));  -- #3645 2d
        UPDATE public.payout_debt_applications
        SET converted_cents=converted_cents+v_take WHERE id=v_app.id;
        INSERT INTO public.payout_debt_applications(
          debt_id,release_id,amount_cents,idempotency_key,created_at
        ) VALUES(
          v_debt.id,v_app.release_id,v_take,
          'converted-apply:'||v_debt.id||':'||v_app.id||':'||v_target_liability,p_now
        );
        v_left:=v_left-v_take;
      END LOOP;
      UPDATE public.organiser_payout_debts SET
        principal_cents=principal_cents-v_overlap,
        recovered_cents=recovered_cents-v_recovered_overlap,
        status=CASE WHEN principal_cents-v_overlap=0 THEN 'converted' ELSE 'open' END,
        closed_at=CASE WHEN principal_cents-v_overlap=0 THEN p_now ELSE NULL END,
        updated_at=p_now
      WHERE id=v_temp.id;
      INSERT INTO public.payout_debt_events(
        debt_id,event_kind,amount_cents,release_id,idempotency_key,created_at
      ) VALUES(
        v_temp.id,'cancellation_converted',v_overlap,v_release.id,
        'postpone-convert:'||v_temp.id||':post_release_refund:'||v_target_liability,p_now
      );
    END IF;
  ELSE
    v_debt_id:=v_debt.id;
  END IF;
  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'debt_created',true,'debt_id',v_debt_id
  );
END;
$fn$;

-- ---- record_paystack_dispute_outcome_pre_3645_append_only_fix (source and hunks: __tests__/issue_3645_debt_return_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
  p_paystack_dispute_id text,
  p_transaction_reference text,
  p_event_name text,
  p_status text,
  p_resolution text,
  p_amount_cents integer,
  p_currency text,
  p_reason text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_raw jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ref text := nullif(btrim(p_transaction_reference), '');
  v_dispute_id text := nullif(btrim(p_paystack_dispute_id), '');
  v_currency text := lower(coalesce(nullif(btrim(p_currency), ''), 'ngn'));
  v_status text := coalesce(nullif(btrim(p_status), ''), 'pending');
  v_resolution text := nullif(btrim(p_resolution), '');
  v_event text := coalesce(nullif(btrim(p_event_name), ''), 'charge.dispute.create');
  v_amount integer := greatest(coalesce(p_amount_cents, 0), 0);
  v_order_id uuid;
  v_reservation_id uuid;
  v_contribution_id uuid;
  v_venue_order_id uuid;
  v_installment_id uuid;  -- issue #3645
  v_brand_id uuid;
  v_due timestamptz;
  v_row public.paystack_disputes%ROWTYPE;
  v_source_type text;
  v_source_id uuid;
  v_release public.brand_payout_releases%ROWTYPE;
  v_room integer;
  v_liability integer;
  v_target integer;
  v_debt_id uuid;
  v_debt public.organiser_payout_debts%ROWTYPE;
  v_temp public.organiser_payout_debts%ROWTYPE;
  v_adj_key text;
  v_merchant_lost boolean;
  v_merchant_won boolean;
  v_debt_created boolean := false;
  v_hold_cents integer;
  v_growth integer;
  v_overlap integer;
  v_recovered_overlap integer;
  v_left integer;
  v_take integer;
  v_app record;
BEGIN
  IF v_dispute_id IS NULL OR v_ref IS NULL THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_outcome' USING ERRCODE = '22023';
  END IF;
  IF v_event NOT IN (
    'charge.dispute.create', 'charge.dispute.remind', 'charge.dispute.resolve'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_event' USING ERRCODE = '22023';
  END IF;

  -- Resolve subject in the same order as paystackWebhookRouter charge matching.
  SELECT o.id, e.brand_id INTO v_order_id, v_brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.stripe_payment_intent_id = v_ref
  LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT tcs.order_id, e.brand_id INTO v_order_id, v_brand_id
    FROM public.ticket_checkout_sessions tcs
    JOIN public.orders o ON o.id = tcs.order_id
    JOIN public.events e ON e.id = o.event_id
    WHERE tcs.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL THEN
    SELECT c.id, c.brand_id INTO v_contribution_id, v_brand_id
    FROM public.event_rsvp_contributions c
    WHERE c.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL THEN
    SELECT rcs.reservation_id, rcs.brand_id INTO v_reservation_id, v_brand_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.paystack_reference = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL THEN
    SELECT vo.id, vo.brand_id INTO v_venue_order_id, v_brand_id
    FROM public.venue_orders vo
    WHERE vo.paystack_reference = v_ref
    LIMIT 1;
  END IF;

  -- issue #3645: an instalment payment reference is its own subject.
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL
     AND v_venue_order_id IS NULL THEN
    SELECT oi.id, e.brand_id INTO v_installment_id, v_brand_id
    FROM public.order_installments oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.events e ON e.id = o.event_id
    WHERE oi.provider = 'paystack'
      AND (oi.stripe_payment_intent_id = v_ref
           OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts att
                       WHERE att.installment_id = oi.id AND att.reference = v_ref
                         AND att.state IN ('succeeded', 'refund_due', 'refunded')))
    LIMIT 1;
  END IF;

  v_due := coalesce(p_due_at, p_now + interval '16 hours');

  INSERT INTO public.paystack_disputes(
    paystack_dispute_id, transaction_reference, brand_id, order_id,
    venue_reservation_id, rsvp_contribution_id, venue_menu_order_id, order_installment_id,
    amount_cents, currency, status, resolution,
    reason, response_due_by, is_resolved, raw_event, created_at, updated_at
  ) VALUES (
    v_dispute_id, v_ref, v_brand_id, v_order_id, v_reservation_id,
    v_contribution_id, v_venue_order_id, v_installment_id,
    v_amount, v_currency, v_status, v_resolution, nullif(btrim(p_reason), ''),
    v_due, v_event = 'charge.dispute.resolve', p_raw, p_now, p_now
  )
  ON CONFLICT (paystack_dispute_id) DO UPDATE SET
    transaction_reference = excluded.transaction_reference,
    brand_id = coalesce(public.paystack_disputes.brand_id, excluded.brand_id),
    order_id = coalesce(public.paystack_disputes.order_id, excluded.order_id),
    venue_reservation_id = coalesce(
      public.paystack_disputes.venue_reservation_id, excluded.venue_reservation_id
    ),
    rsvp_contribution_id = coalesce(
      public.paystack_disputes.rsvp_contribution_id, excluded.rsvp_contribution_id
    ),
    venue_menu_order_id = coalesce(
      public.paystack_disputes.venue_menu_order_id, excluded.venue_menu_order_id
    ),
    order_installment_id = coalesce(
      public.paystack_disputes.order_installment_id, excluded.order_installment_id
    ),
    amount_cents = CASE
      WHEN excluded.amount_cents > 0 THEN excluded.amount_cents
      ELSE public.paystack_disputes.amount_cents
    END,
    currency = excluded.currency,
    status = excluded.status,
    resolution = coalesce(excluded.resolution, public.paystack_disputes.resolution),
    reason = coalesce(excluded.reason, public.paystack_disputes.reason),
    response_due_by = coalesce(
      public.paystack_disputes.response_due_by, excluded.response_due_by
    ),
    is_resolved = public.paystack_disputes.is_resolved
      OR excluded.is_resolved,
    raw_event = excluded.raw_event,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  v_merchant_lost := v_event = 'charge.dispute.resolve'
    AND lower(coalesce(v_resolution, '')) IN (
      'merchant-accepted', 'merchant_accepted', 'accepted'
    );
  v_merchant_won := v_event = 'charge.dispute.resolve'
    AND NOT v_merchant_lost;

  IF v_row.order_id IS NOT NULL THEN
    v_source_type := 'order';
    v_source_id := v_row.order_id;
  ELSIF v_row.rsvp_contribution_id IS NOT NULL THEN
    v_source_type := 'rsvp_contribution';
    v_source_id := v_row.rsvp_contribution_id;
  ELSIF v_row.venue_reservation_id IS NOT NULL THEN
    SELECT rcs.id INTO v_source_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.reservation_id = v_row.venue_reservation_id
      AND rcs.status = 'completed'
    ORDER BY rcs.created_at DESC
    LIMIT 1;
    v_source_type := 'venue_reservation';
  ELSIF v_row.venue_menu_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_row.venue_menu_order_id;
  ELSIF v_row.order_installment_id IS NOT NULL THEN
    v_source_type := 'order_installment';
    v_source_id := v_row.order_installment_id;
  END IF;

  IF v_source_type IS NOT NULL AND v_source_id IS NOT NULL AND v_row.amount_cents > 0 THEN
    SELECT r.* INTO v_release
    FROM public.payout_release_items pri
    JOIN public.brand_payout_releases r ON r.id = pri.release_id
    WHERE pri.source_type = v_source_type
      AND pri.source_id = v_source_id
      AND r.provider = 'paystack'
    ORDER BY CASE WHEN r.status = 'released' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT 1
    FOR UPDATE OF r;

    IF FOUND AND v_release.status <> 'released' THEN
      -- Pending/planned: hold disputed cash (or clear on merchant win).
      IF v_merchant_won THEN
        v_hold_cents := 0;
      ELSIF v_merchant_lost
        OR v_event IN ('charge.dispute.create', 'charge.dispute.remind')
      THEN
        v_hold_cents := v_row.amount_cents;
      ELSE
        v_hold_cents := NULL;
      END IF;

      IF v_hold_cents IS NOT NULL THEN
        UPDATE public.payout_release_items
        SET disputed_cents = v_hold_cents,
            -- #3645 flat 4.5%: host net ignores partner_share and provider_fee
            net_cents = greatest(
              0,
              gross_cents - refunded_cents - v_hold_cents
                - mingla_fee_cents
            )
        WHERE source_type = v_source_type
          AND source_id = v_source_id;

        UPDATE public.brand_payout_releases release_row
        SET disputed_cents = totals.disputed,
            net_release_cents = totals.net,
            updated_at = p_now
        FROM (
          SELECT
            sum(item.disputed_cents)::integer AS disputed,
            sum(item.net_cents)::integer AS net
          FROM public.payout_release_items item
          WHERE item.release_id = v_release.id
        ) totals
        WHERE release_row.id = v_release.id;

        IF v_merchant_lost AND NOT v_row.debt_opened THEN
          UPDATE public.paystack_disputes
          SET debt_opened = true, updated_at = p_now
          WHERE id = v_row.id;
          v_debt_created := true;
        END IF;
      END IF;

    ELSIF FOUND AND v_release.status = 'released'
      AND v_merchant_lost AND NOT v_row.debt_opened
    THEN
      PERFORM 1
      FROM public.brand_payout_releases r
      WHERE r.brand_id = v_release.brand_id
        AND r.currency = v_release.currency
        AND r.status = 'released'
        AND (
          v_release.event_id IS NULL
          OR r.event_id IS NOT DISTINCT FROM v_release.event_id
        )
      ORDER BY r.id
      FOR UPDATE;

      v_room := public.organiser_refund_debt_room_cents(
        v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
      );
      v_liability := least(v_row.amount_cents, v_room);
      IF v_liability > 0 THEN
        v_adj_key := 'paystack-dispute-liability:' || v_dispute_id;
        INSERT INTO public.payout_ledger_adjustments(
          release_id, brand_id, currency, kind, amount_cents,
          provider_ref, idempotency_key, created_at
        ) VALUES (
          v_release.id, v_release.brand_id, v_release.currency,
          'post_release_dispute', v_liability, v_dispute_id, v_adj_key, p_now
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        SELECT least(
          least(coalesce(sum(amount_cents), 0), 2147483647::bigint)::integer,
          v_room
        ) INTO v_target
        FROM public.payout_ledger_adjustments
        WHERE release_id = v_release.id AND kind = 'post_release_dispute';

        -- #3645 2d: key-share the releases a conversion may insert onto, then
        -- lock both debts in id order: settle locks release, then debts.
        PERFORM 1 FROM public.brand_payout_releases r
        WHERE r.id IN (
          SELECT a.release_id FROM public.payout_debt_applications a
          JOIN public.organiser_payout_debts d ON d.id = a.debt_id
          WHERE d.origin_release_id = v_release.id
            AND d.kind = 'post_release_postponement' AND a.released_at IS NULL
        )
        ORDER BY r.id FOR KEY SHARE;
        PERFORM 1 FROM public.organiser_payout_debts
        WHERE origin_release_id = v_release.id
          AND kind IN ('post_release_dispute', 'post_release_postponement')
        ORDER BY id FOR UPDATE;
        SELECT * INTO v_debt FROM public.organiser_payout_debts
        WHERE origin_release_id = v_release.id AND kind = 'post_release_dispute'
        FOR UPDATE;
        IF NOT FOUND THEN
          v_debt_id := public.convert_postponement_debt_to_permanent(
            v_release.id, 'post_release_dispute', v_target, p_now
          );
        ELSIF v_target > v_debt.principal_cents THEN
          -- Mirror PR3 refund growth: transfer overlapping postponement first.
          v_growth := v_target - v_debt.principal_cents;
          SELECT * INTO v_temp FROM public.organiser_payout_debts
          WHERE origin_release_id = v_release.id
            AND kind = 'post_release_postponement' AND status = 'open'
          FOR UPDATE;
          IF FOUND THEN
            v_overlap := least(v_growth, v_temp.principal_cents);
            v_recovered_overlap := least(v_overlap, v_temp.recovered_cents);
          ELSE
            v_overlap := 0;
            v_recovered_overlap := 0;
          END IF;

          UPDATE public.organiser_payout_debts SET
            principal_cents = v_target,
            recovered_cents = recovered_cents + v_recovered_overlap,
            status = CASE
              WHEN recovered_cents + v_recovered_overlap = v_target THEN 'closed'
              ELSE 'open'
            END,
            closed_at = CASE
              WHEN recovered_cents + v_recovered_overlap = v_target THEN p_now
              ELSE NULL
            END,
            updated_at = p_now
          WHERE id = v_debt.id;
          v_debt_id := v_debt.id;

          IF v_overlap > 0 THEN
            v_left := v_recovered_overlap;
            FOR v_app IN
              SELECT * FROM public.payout_debt_applications
              WHERE debt_id = v_temp.id AND released_at IS NULL
                AND amount_cents > converted_cents
                  + public.issue_3645_application_returned_cents(id)  -- #3645 2d
              ORDER BY created_at, id FOR UPDATE
            LOOP
              EXIT WHEN v_left = 0;
              v_take := least(v_left, v_app.amount_cents - v_app.converted_cents
                - public.issue_3645_application_returned_cents(v_app.id));  -- #3645 2d
              UPDATE public.payout_debt_applications
              SET converted_cents = converted_cents + v_take WHERE id = v_app.id;
              INSERT INTO public.payout_debt_applications(
                debt_id, release_id, amount_cents, idempotency_key, created_at
              ) VALUES (
                v_debt.id, v_app.release_id, v_take,
                'converted-apply:' || v_debt.id || ':' || v_app.id || ':' || v_target,
                p_now
              );
              v_left := v_left - v_take;
            END LOOP;
            UPDATE public.organiser_payout_debts SET
              principal_cents = principal_cents - v_overlap,
              recovered_cents = recovered_cents - v_recovered_overlap,
              status = CASE
                WHEN principal_cents - v_overlap = 0 THEN 'converted'
                ELSE 'open'
              END,
              closed_at = CASE
                WHEN principal_cents - v_overlap = 0 THEN p_now
                ELSE NULL
              END,
              updated_at = p_now
            WHERE id = v_temp.id;
            INSERT INTO public.payout_debt_events(
              debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at
            ) VALUES (
              v_temp.id, 'cancellation_converted', v_overlap, v_release.id,
              'postpone-convert:' || v_temp.id || ':post_release_dispute:' || v_target,
              p_now
            );
          END IF;
        ELSE
          v_debt_id := v_debt.id;
        END IF;

        UPDATE public.paystack_disputes
        SET debt_opened = true, updated_at = p_now
        WHERE id = v_row.id;
        v_debt_created := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'dispute_id', v_row.id,
    'paystack_dispute_id', v_dispute_id,
    'matched', (
      v_row.order_id IS NOT NULL
      OR v_row.venue_reservation_id IS NOT NULL
      OR v_row.rsvp_contribution_id IS NOT NULL
      OR v_row.venue_menu_order_id IS NOT NULL
      OR v_row.order_installment_id IS NOT NULL
    ),
    'brand_id', v_row.brand_id,
    'order_id', coalesce(v_row.order_id, (
      SELECT oi.order_id FROM public.order_installments oi WHERE oi.id = v_row.order_installment_id
    )),
    'order_installment_id', v_row.order_installment_id,
    'venue_reservation_id', v_row.venue_reservation_id,
    'rsvp_contribution_id', v_row.rsvp_contribution_id,
    'venue_menu_order_id', v_row.venue_menu_order_id,
    'response_due_by', v_row.response_due_by,
    'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
    'merchant_lost', v_merchant_lost,
    'debt_created', v_debt_created,
    'debt_id', v_debt_id
  );
END;
$fn$;

-- §7. Self-assert: the new writer path is wired before anything commits.
DO $assert$
DECLARE v_src text;
BEGIN
  FOREACH v_src IN ARRAY ARRAY[
    'issue_3645_refresh_stay_release_projection',
    'refresh_paystack_dispute_release_projection',
    'plan_pending_payout_partner_legs'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_src
        AND p.prosrc LIKE '%issue_3645_settle_release_projection%'
    ) THEN
      RAISE EXCEPTION '#3645 2d: % does not settle', v_src;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mature_postponement_debts'
      AND p.prosrc LIKE '%''matured''%'
  ) THEN
    RAISE EXCEPTION '#3645 2d: mature_postponement_debts does not return in place';
  END IF;
END;
$assert$;

COMMIT;
