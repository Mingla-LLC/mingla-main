import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const LATE_REFUND_DEBT_TARGET =
  "supabase/migrations/20281205023645_issue_3645_payout_refund_debt.sql";
const REFUND_PAYOUTS = "supabase/migrations/20281202084522_issue_4522_refunds_payouts.sql";

export const PROVIDER_REFUND_TRUTH_TARGET =
  "supabase/migrations/20281205013645_issue_3645_provider_refund_truth.sql";

export const PROVIDER_REFUND_TRUTH_REEMITS: Reemit[] = [
  {
    fn: "biz_refund_order_commit_from_webhook",
    source: "supabase/migrations/20280313003281_issue_3281_extras_checkout.sql",
    target: PROVIDER_REFUND_TRUTH_TARGET,
    hunks: [
      {
        name: "serialize by provider refund ID",
        old: `BEGIN
  SELECT * INTO v_order`,
        new: `BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order-refund:' || p_stripe_refund_id,0));
  SELECT * INTO v_order`,
      },
      {
        name: "track order allocation",
        old: "v_settled boolean := false;",
        new: `v_settled boolean := false;
  v_allocate boolean := false;`,
      },
      {
        name: "store confirmed buyer refund status",
        old: `SET status = 'succeeded',
        stripe_refund_id`,
        new: `SET status = 'succeeded',
        buyer_refund_status = 'succeeded', buyer_refunded_at = coalesce(buyer_refunded_at,now()),
        stripe_refund_id`,
      },
      {
        name: "allocate a previously pending dashboard refund",
        old: `v_refund_id := v_existing_refund_id;
  ELSE`,
        new: `v_refund_id := v_existing_refund_id;
    SELECT v_settled AND metadata ? 'provider_pending_dashboard' INTO v_allocate
    FROM public.refunds WHERE id=v_refund_id;
    IF v_allocate THEN
      -- Keep the lock order used by new dashboard refunds and share reversals.
      PERFORM 1 FROM public.payee_shares
      WHERE order_kind = 'ticket' AND order_id = p_order_id AND payee_kind = 'referral'
      FOR UPDATE;
      PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
    END IF;
  ELSE`,
      },
      {
        name: "share the dashboard allocation path",
        old: `) RETURNING id INTO v_refund_id;

      -- Proportional allocation`,
        new: `) RETURNING id INTO v_refund_id;
      v_allocate := true;
    END IF;
  END IF;

  IF v_allocate THEN
      -- Proportional allocation`,
      },
      {
        name: "close the shared allocation branch",
        old: `    END IF;
  END IF;

  -- issue #3281 — two refunds settling together`,
        new: `  END IF;

  -- issue #3281 — two refunds settling together`,
      },
      {
        name: "compute confirmed charge refunds net of provider failures",
        old: `SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = p_order_id AND status = 'succeeded';`,
        new: "v_total_refunded_cents := public.issue_4522_order_charge_refunded_cents(p_order_id);",
      },
      {
        name: "preserve order state with no confirmed refunds",
        old: "v_new_payment_status := public.issue_3281_settled_payment_status(p_order_id);",
        new: `v_new_payment_status := CASE
    WHEN v_order.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN v_total_refunded_cents = 0 THEN v_order.payment_status
    ELSE public.issue_3281_settled_payment_status(p_order_id) END;`,
      },
    ],
  },
  {
    fn: "issue_4522_order_charge_refunded_cents",
    source: REFUND_PAYOUTS,
    target: PROVIDER_REFUND_TRUTH_TARGET,
    hunks: [
      {
        name: "replace the existing function",
        old: "CREATE FUNCTION public.issue_4522_order_charge_refunded_cents(",
        new: "CREATE OR REPLACE FUNCTION public.issue_4522_order_charge_refunded_cents(",
      },
      {
        name: "subtract provider failures on the order charge",
        old: "WHERE x.refund_id = r.id), 0)))",
        new: `WHERE x.refund_id = r.id), 0))
      - coalesce((SELECT sum((x.value->>'amount_cents')::integer)
        FROM jsonb_each(coalesce(r.metadata->'provider_refund_failures','{}'::jsonb)) x), 0))`,
      },
    ],
  },
  {
    fn: "issue_4522_payout_item_now",
    source: REFUND_PAYOUTS,
    target: PROVIDER_REFUND_TRUTH_TARGET,
    hunks: [
      {
        name: "replace the existing function",
        old: "CREATE FUNCTION public.issue_4522_payout_item_now(",
        new: "CREATE OR REPLACE FUNCTION public.issue_4522_payout_item_now(",
      },
      {
        name: "hold the unresolved provider refund on its sale",
        old: "CASE WHEN v_held THEN 0::bigint ELSE v_settled END, v_settled;",
        new: `CASE WHEN v_held THEN 0::bigint ELSE greatest(0, v_settled -
      public.issue_3645_unresolved_provider_refund_cents(v_order,
        CASE WHEN p_source_type = 'order_installment' THEN p_source_id END))
    END, v_settled;`,
      },
      {
        name: "exclude failed Stripe attempts from unrecorded refunds",
        old: "WHERE a.order_id = p_source_id AND a.buyer_refund_id IS NOT NULL",
        new: `WHERE a.order_id = p_source_id AND a.buyer_refund_id IS NOT NULL
                    AND a.buyer_refund_failed_at IS NULL`,
      },
    ],
  },
  {
    fn: "issue_2097_finalize_refund_attempt",
    source: REFUND_PAYOUTS,
    target: PROVIDER_REFUND_TRUTH_TARGET,
    hunks: [
      {
        name: "fence out a provider attempt that already failed",
        old: "IF v.status IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN",
        new: `IF v.buyer_refund_failed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','evidence_conflict','idempotent_replay',true);
  END IF;
  IF v.status IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN`,
      },
      {
        name: "exclude failed buyer attempts from the confirmed total",
        old: "AND a.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$'",
        new: `AND a.buyer_refund_failed_at IS NULL
      AND a.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$'`,
      },
    ],
  },
  {
    fn: "issue_4522_row_refund_unrecorded",
    source: "supabase/migrations/20281202064522_issue_4522_flex_payments.sql",
    target: PROVIDER_REFUND_TRUTH_TARGET,
    hunks: [
      {
        name: "replace the existing function",
        old: "CREATE FUNCTION public.issue_4522_row_refund_unrecorded(",
        new: "CREATE OR REPLACE FUNCTION public.issue_4522_row_refund_unrecorded(",
      },
      {
        name: "hold dashboard Paystack refunds before local allocation",
        old: "AND pa.local_refund_id IS NOT NULL AND pa.status <> 'failed'",
        new: `AND (pa.local_refund_id IS NOT NULL OR pa.idempotency_key LIKE 'paystack-dashboard:%')
                    AND pa.status <> 'failed'`,
      },
      {
        name: "exclude failed Stripe attempts from the installment hold",
        old: "WHERE oi.id = p_installment_id AND a.buyer_refund_id IS NOT NULL",
        new: `WHERE oi.id = p_installment_id AND a.buyer_refund_id IS NOT NULL
                    AND a.buyer_refund_failed_at IS NULL`,
      },
    ],
  },
  {
    fn: "admin_list_source_refund_operations",
    source: "supabase/migrations/20270131001221_issue_1221_source_refund_control_plane.sql",
    target: PROVIDER_REFUND_TRUTH_TARGET,
    hunks: [
      {
        name: "include matched provider failures in the operations list",
        old: "WHERE pwe.match_status IN ('unmatched','mismatched')",
        new: `WHERE (pwe.match_status IN ('unmatched','mismatched')
        OR (pwe.match_status='matched' AND pwe.match_reason_code='provider_refund_failed'))`,
      },
      {
        name: "return the provider refund ID for review",
        old: "'matchStatus',pwe.match_status,'safeReasonCode',pwe.match_reason_code,",
        new: `'matchStatus',pwe.match_status,'safeReasonCode',pwe.match_reason_code,
          'providerRefundId',pwe.provider_refund_id,`,
      },
    ],
  },
];

export const LATE_REFUND_DEBT_REEMITS: Reemit[] = [
  {
    fn: "issue_4522_refund_debt_alert_trigger",
    source: REFUND_PAYOUTS,
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [{
      name: "refresh and version the refund debt alert when its principal grows",
      old: `CREATE FUNCTION public.issue_4522_refund_debt_alert_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.issue_4522_alert_payout_refund(NEW.origin_release_id, NULL,
    format('payout_refund_debt_opened: %s %s owed back from the next payouts', NEW.principal_cents, upper(NEW.currency)),
    now());
  RETURN NULL;
END
$fn$`,
      new: `CREATE OR REPLACE FUNCTION public.issue_4522_refund_debt_alert_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_key text := 'payout_refund_debt:' || NEW.origin_release_id::text || ':r';
  v_message text := format('payout_refund_debt_opened: %s %s owed back from the next payouts',
                           NEW.principal_cents, upper(NEW.currency));
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.principal_cents <= OLD.principal_cents THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.payout_release_alert_outbox AS o (
    release_id, brand_id, alert_kind, error_message, idempotency_key,
    alert_revision, alert_magnitude_kobo, alert_refreshed_at
  ) VALUES (
    NEW.origin_release_id, NEW.brand_id, 'payout_refund_debt', v_message, v_key || '1',
    1, NEW.principal_cents, now()
  )
  ON CONFLICT (release_id, alert_kind) DO UPDATE
  SET error_message = EXCLUDED.error_message,
      idempotency_key = v_key || (o.alert_revision + 1)::text,
      alert_revision = o.alert_revision + 1,
      alert_magnitude_kobo = EXCLUDED.alert_magnitude_kobo,
      alert_refreshed_at = now(), updated_at = now(),
      status = CASE WHEN o.status = 'dispatching' THEN o.status ELSE 'pending' END,
      delivery_attempt_count = 0, last_delivery_error = NULL, provider_accepted_at = NULL;
  RETURN NULL;
END;
$fn$`,
    }],
  },
  {
    fn: "authorize_stripe_payout_execution",
    source: REFUND_PAYOUTS,
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [{
      name: "reprice a Stripe claim before its first authorization",
      old: "  RETURN true;\nEND;\n$fn$",
      new: `  -- A retry of the same provider idempotency key may have already moved
  -- money. A debt that opened after that authorization uses a later payout.
  IF v_release.stripe_authorized_attempt IS DISTINCT FROM v_release.attempt_count
     AND public.issue_3645_apply_late_refund_debt(p_release_id, p_now) > 0 THEN
    UPDATE public.brand_payout_releases
    SET status='pending', error_message='payout_refund_debt_repriced',
        stripe_execution_claim_id=NULL, stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  UPDATE public.brand_payout_releases SET stripe_authorized_attempt=v_release.attempt_count
  WHERE id=p_release_id AND stripe_authorized_attempt IS DISTINCT FROM v_release.attempt_count;
  RETURN true;
END;
$fn$`,
    }],
  },
  {
    fn: "authorize_paystack_payout_execution",
    source: REFUND_PAYOUTS,
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "declare the late debt total",
        old: "  v_owed record;  -- issue #4522 section 8\nBEGIN",
        new: "  v_owed record;  -- issue #4522 section 8\n  v_late_debt integer := 0;\nBEGIN",
      },
      {
        name: "recompute the payable amount before the first authorization of a claim",
        old: "  -- #3645 bundle 4: the organiser legs were planned from the pool at claim",
        new: `  IF v_release.paystack_authorized_claim_id IS DISTINCT FROM p_claim_id THEN
    v_late_debt := public.issue_3645_apply_late_refund_debt(p_release_id, p_now);
  END IF;
  IF v_late_debt > 0 THEN
    SELECT * INTO STRICT v_release FROM public.brand_payout_releases WHERE id=p_release_id;
  END IF;

  -- #3645 bundle 4: the organiser legs were planned from the pool at claim`,
      },
      {
        name: "supersede only untouched organiser legs from this claim",
        old: "  IF v_plan_cents > v_due_cents THEN\n    UPDATE public.brand_payout_releases",
        new: `  IF v_plan_cents > v_due_cents THEN
    -- Only this claim's untouched plan can be superseded. A prior or
    -- ambiguous provider attempt keeps its original plan and ops alert.
    IF v_late_debt > 0 THEN
      PERFORM 1 FROM public.payout_transfer_legs l
      WHERE l.release_id=p_release_id AND l.kind='organiser'
      ORDER BY l.chunk_index FOR UPDATE NOWAIT;
    END IF;
    IF v_late_debt > 0 AND NOT EXISTS (
      SELECT 1 FROM public.payout_transfer_legs l
      WHERE l.release_id=p_release_id AND l.kind='organiser'
        AND l.refund_debt_superseded_at IS NULL
        AND (l.planned_claim_id IS DISTINCT FROM p_claim_id
          OR l.status <> 'planned' OR l.attempt_count <> 0
          OR l.provider_reference IS NOT NULL OR l.provider_transfer_code IS NOT NULL)
    ) THEN
      UPDATE public.payout_transfer_legs SET status='failed',refund_debt_superseded_at=p_now
      WHERE release_id=p_release_id AND kind='organiser' AND refund_debt_superseded_at IS NULL;
    END IF;
    UPDATE public.brand_payout_releases`,
      },
      {
        name: "record authorization so retries keep the existing provider plan",
        old: "  RETURN true;\nEND;\n$fn$",
        new: `  UPDATE public.brand_payout_releases SET paystack_authorized_claim_id=p_claim_id
  WHERE id=p_release_id AND paystack_authorized_claim_id IS DISTINCT FROM p_claim_id;
  RETURN true;
END;
$fn$`,
      },
    ],
  },
  {
    fn: "claim_payout_release_alerts",
    source: "supabase/migrations/20280602003645_issue_3645_payout_ledger_followups.sql",
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "include the refund debt alert kind",
        old: "        'paystack_plan_exceeds_due'  -- issue #3645 bundle 4",
        new: "        'paystack_plan_exceeds_due',\n        'payout_refund_debt'",
      },
      {
        name: "capture the revision in the dispatch claim",
        old: "        dispatch_claimed_at=p_now,\n        updated_at=p_now",
        new: "        dispatch_claimed_at=p_now,\n        dispatch_claim_revision=o.alert_revision,\n        updated_at=p_now",
      },
    ],
  },
  {
    fn: "record_payout_release_alert_delivery",
    source: "supabase/migrations/20270110000002_issue_1172_stripe_payout_execution.sql",
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "return a refreshed debt alert to pending after an older dispatch",
        old: "  UPDATE public.payout_release_alert_outbox",
        new: `  IF v_alert.alert_kind = 'payout_refund_debt'
     AND v_alert.dispatch_claim_revision IS DISTINCT FROM v_alert.alert_revision THEN
    UPDATE public.payout_release_alert_outbox
    SET status='pending', dispatch_claim_id=NULL, dispatch_claimed_at=NULL,
        dispatch_claim_revision=NULL, updated_at=p_now
    WHERE id=p_alert_id;
    RETURN 'pending';
  END IF;

  UPDATE public.payout_release_alert_outbox`,
      },
      {
        name: "clear the captured revision when recording delivery",
        old: "      dispatch_claimed_at=NULL,\n      last_delivery_error=CASE",
        new: "      dispatch_claimed_at=NULL,\n      dispatch_claim_revision=NULL,\n      last_delivery_error=CASE",
      },
    ],
  },
  {
    fn: "record_paystack_leg_plan",
    source: "supabase/migrations/20270110000008_issue_1177_ng_paystack_release.sql",
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "declare the fresh plan chunk offset",
        old: "v_inserted integer:=0;",
        new: `v_inserted integer:=0;
  v_first_chunk integer;`,
      },
      {
        name: "start the plan after archived chunks",
        old: "FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs)",
        new: `SELECT coalesce(max(chunk_index)+1,0) INTO v_first_chunk
  FROM public.payout_transfer_legs WHERE release_id=p_release_id AND kind='organiser'
    AND refund_debt_superseded_at IS NOT NULL;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs)`,
      },
      {
        name: "use the permanent chunk index",
        old: "(v_leg->>'chunk_index')::integer,",
        new: "v_first_chunk + (v_leg->>'chunk_index')::integer,",
      },
    ],
  },
  {
    fn: "reconcile_paystack_transfer_leg_fee",
    source: "supabase/migrations/20270110000008_issue_1177_ng_paystack_release.sql",
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "skip reconciliation for superseded legs",
        old: "-- Missing fee truth:",
        new: `IF v_leg.refund_debt_superseded_at IS NOT NULL THEN
    RETURN 'superseded';
  END IF;

  -- Missing fee truth:`,
      },
      {
        name: "exclude superseded sibling legs from pending fee totals",
        old: "AND NOT (status='succeeded' AND reconciled_at IS NOT NULL);",
        new: `AND refund_debt_superseded_at IS NULL
    AND NOT (status='succeeded' AND reconciled_at IS NOT NULL);`,
      },
    ],
  },
  {
    fn: "issue_3645_record_release_claim_snapshot",
    source: "supabase/migrations/20281119003645_issue_3645_payout_claim_snapshots.sql",
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "exclude superseded legs from claim and paid snapshots (1)",
        old: `
          SELECT 1 FROM public.payout_transfer_legs l
           WHERE l.release_id = NEW.id AND l.kind = 'organiser') END`,
        new: `
          SELECT 1 FROM public.payout_transfer_legs l
           WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL) END`,
      },
      {
        name: "exclude superseded legs from claim and paid snapshots (2)",
        old: `
        IF EXISTS (SELECT 1 FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser') THEN`,
        new: `
        IF EXISTS (SELECT 1 FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL) THEN`,
      },
      {
        name: "exclude superseded legs from claim and paid snapshots (3)",
        old: `
                   SELECT l.planned_claim_id FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'`,
        new: `
                   SELECT l.planned_claim_id FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL`,
      },
      {
        name: "exclude superseded legs from claim and paid snapshots (4)",
        old: `
                     FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser');`,
        new: `
                     FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL);`,
      },
    ],
  },
  {
    fn: "paystack_payout_float_obligation",
    source: "supabase/migrations/20280503003645_issue_3645_float_forecast_alerts.sql",
    target: LATE_REFUND_DEBT_TARGET,
    hunks: [
      {
        name: "exclude superseded organiser legs from float obligations",
        old: "WHERE l.kind='organiser'",
        new: "WHERE l.kind='organiser' AND l.refund_debt_superseded_at IS NULL",
      },
    ],
  },
];
