/**
 * issue #3645 — the ONLY authorised hunks for every function the Paystack
 * payment-plan migrations re-emit from its latest definition. The structural
 * test (issue_3645_reemit_hunks.structural.test.ts) proves each re-emitted body
 * equals its source body with exactly these replacements applied, so nothing
 * else in a large money function can move silently.
 */
export interface Hunk {
  name: string;
  old: string;
  new: string;
}

export interface Reemit {
  fn: string;
  /**
   * Name the source body was defined under, when the function was later
   * renamed (ALTER FUNCTION … RENAME). Defaults to `fn`.
   */
  sourceFn?: string;
  /** Migration holding the latest definition before #3645. */
  source: string;
  /** Migration that carries the terminal #3645-authorised re-emit. */
  target: string;
  hunks: Hunk[];
}

const M2 = "supabase/migrations/20280202003645_issue_3645_paystack_plan_rpcs.sql";
const M3 = "supabase/migrations/20280203003645_issue_3645_installment_capability_and_visibility.sql";
const M4 = "supabase/migrations/20280204003645_issue_3645_installment_refunds_disputes_payouts.sql";
const BY_DATE_REEMIT =
  "supabase/migrations/20280216003282_issue_3281_by_date_quantities_paystack_reemit.sql";

const STAY_NET =
  "supabase/migrations/20280407003645_issue_3645_stay_net_excludes_provider_fee.sql";

const UNPAID_HOLDS =
  "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql";

const PS = "public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)";

const PROJECTION_JOIN: Hunk = {
  name: "instalment items are covered by their disputes",
  old: `      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
`,
  new: `      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
      OR (  -- issue #3645
        item.source_type = 'order_installment'
        AND dispute.order_installment_id = item.source_id
      )
`,
};

export const REEMITS: Reemit[] = [
  {
    fn: "issue_1930_ticket_checkout_finalize_base",
    source: "supabase/migrations/20271224003281_issue_3281_by_date_quantities.sql",
    target: BY_DATE_REEMIT,
    hunks: [
      {
        name: "B replay backfill guard",
        old: `       AND v_session.installment_schedule IS NOT NULL
       AND p_stripe_customer_id_on_connected_account IS NOT NULL
       AND p_saved_payment_method_id IS NOT NULL
`,
        new: `       AND v_session.installment_schedule IS NOT NULL
       -- issue #3645: a Paystack plan has no Stripe customer/card pair.
       AND ((p_stripe_customer_id_on_connected_account IS NOT NULL
             AND p_saved_payment_method_id IS NOT NULL)
            OR ${PS})
`,
      },
      {
        name: "B replay backfill insert",
        old: `        INSERT INTO public.order_installments (
          order_id, ordinal, amount_cents, currency, due_at, status
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled'
        );
`,
        new: `        INSERT INTO public.order_installments (
          order_id, ordinal, amount_cents, currency, due_at, status,
          provider, collection_method, plan_bound_at
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled',
          CASE WHEN ${PS}
               THEN 'paystack' ELSE 'stripe' END,
          CASE WHEN ${PS}
               THEN 'pay_link' ELSE 'auto_card' END,
          CASE WHEN ${PS}
               THEN NULL ELSE now() END
        );
`,
      },
      {
        name: "A fresh insert guard",
        old: `  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;
`,
        new: `  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    -- issue #3645: Stripe plans need the customer + saved card; a Paystack plan
    -- binds its price (and any reusable card) right after finalize.
    IF NOT ${PS}
       AND (p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL) THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;
`,
      },
      {
        name: "A fresh insert rows",
        old: `      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled'
      );
`,
        new: `      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status,
        provider, collection_method, plan_bound_at
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled',
        CASE WHEN ${PS}
             THEN 'paystack' ELSE 'stripe' END,
        CASE WHEN ${PS}
             THEN 'pay_link' ELSE 'auto_card' END,
        CASE WHEN ${PS}
             THEN NULL ELSE v_now END
      );
`,
      },
    ],
  },
  {
    fn: "pg_trip_installments_supported",
    source: "supabase/migrations/20271015003859_issue_3859_installment_capability_refusal.sql",
    target: M3,
    hunks: [
      {
        name: "Paystack follows the readiness switch",
        old: `    SELECT b.payment_provider::text = 'stripe'
`,
        new: `    SELECT CASE b.payment_provider::text
             WHEN 'stripe' THEN true
             WHEN 'paystack' THEN public.issue_3645_paystack_installments_enabled()
             ELSE false END
`,
      },
    ],
  },
  {
    fn: "trg_trip_publish_installment_capability_guard",
    source: "supabase/migrations/20271015003859_issue_3859_installment_capability_refusal.sql",
    target: M3,
    hunks: [
      {
        name: "#4040 exposure-increase rule",
        old: `     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.visibility IS DISTINCT FROM NEW.visibility)
`,
        new: `     -- #4040: refuse only a transition that increases buyer exposure
     -- (draft/hidden 0 < private 1 < public/discover 2).
     AND (
       (OLD.status NOT IN ('scheduled', 'live')
        AND (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                  WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END) > 0)
       OR (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END)
          > (CASE WHEN OLD.visibility IN ('public', 'discover') THEN 2
                  WHEN OLD.visibility = 'private' THEN 1 ELSE 0 END)
     )
`,
      },
    ],
  },
  {
    fn: "cancel_event_refund_prepare",
    source: "supabase/migrations/20271107003872_issue_3872_money_truth.sql",
    target: M4,
    hunks: [
      {
        name: "5a collected instalments are refund objects",
        old: `  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;
`,
        new: `  -- 5a. Issue #3645 (both rails): every collected instalment is its own money
  --     object, refunded for what it charged and has not had back. Its refunds
  --     never count against the deposit (orders.refunded_amount_cents).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  SELECT p_event_id, 'order_installment', oi.id, oi.provider,
         (coalesce(oi.buyer_total_cents, oi.amount_cents) - oi.refunded_amount_cents)::integer,
         'pending'
  FROM public.order_installments oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.event_id = p_event_id
    AND oi.status = 'collected'
    AND (coalesce(oi.buyer_total_cents, oi.amount_cents) - oi.refunded_amount_cents) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;
`,
      },
    ],
  },
  {
    fn: "issue_3872_cancel_refund_order",
    source: "supabase/migrations/20271107003872_issue_3872_money_truth.sql",
    target: M4,
    hunks: [
      {
        name: "deposit remainder ignores instalment refunds",
        old: `  FROM public.refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');
`,
        new: `  FROM public.refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded')
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds
`,
      },
    ],
  },
  {
    fn: "admin_refund_order_commit",
    source: "supabase/migrations/20261210000000_orch_1278_money_act.sql",
    target: M4,
    hunks: [
      {
        name: "order refunded total ignores instalment refunds",
        old: `  WHERE order_id = v_order.id AND status = 'succeeded';
`,
        new: `  WHERE order_id = v_order.id AND status = 'succeeded'
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds
`,
      },
    ],
  },
  {
    fn: "record_paystack_refund_outcome",
    source: "supabase/migrations/20270723003645_issue_3645_multi_release_refund_debt.sql",
    target: M4,
    hunks: [
      {
        name: "order_installment source type",
        old: `  IF p_source_type NOT IN ('order','venue_reservation')
`,
        new: `  IF p_source_type NOT IN ('order','venue_reservation','order_installment')
`,
      },
    ],
  },
  {
    fn: "biz_compute_refund_for_cancel",
    source: "supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql",
    target: M4,
    hunks: [
      {
        name: "paid total uses the charged amount net of refunds",
        old: `           COALESCE(sum(amount_cents), 0)
`,
        new: `           COALESCE(sum(coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents), 0)
`,
      },
      {
        name: "per-payment attribution uses the charged amount net of refunds",
        old: `      SELECT id, amount_cents, currency, stripe_payment_intent_id, ordinal
`,
        new: `      SELECT id, coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents AS amount_cents,
             currency, stripe_payment_intent_id, ordinal
`,
      },
    ],
  },
  {
    fn: "biz_cancel_trip_booking_begin",
    source: "supabase/migrations/20270110000006_issue_1175_paystack_refunds.sql",
    target: M4,
    hunks: [
      {
        name: "pending refunds preserve unknown fee truth",
        old: `    left(coalesce(p_reason,'tr4_cancel'),200),0
`,
        new: `    left(coalesce(p_reason,'tr4_cancel'),200),NULL
`,
      },
      {
        name: "instalment refund attempts keyed to the instalment",
        old: `          'order',p_order_id,v_refund_id,v_payment->>'source_pi',
`,
        new: `          CASE WHEN v_payment->>'installment_id' IS NULL THEN 'order' ELSE 'order_installment' END,
          coalesce((v_payment->>'installment_id')::uuid,p_order_id),v_refund_id,v_payment->>'source_pi',
`,
      },
    ],
  },
  {
    fn: "record_paystack_dispute_outcome",
    source: "supabase/migrations/20271214013645_issue_3645_paystack_dispute_append_only.sql",
    target: M4,
    hunks: [
      {
        name: "instalment payment references are their own dispute subject",
        old: `  SELECT orders.id, events.brand_id INTO v_order_id, v_brand_id
  FROM public.orders
  JOIN public.events ON events.id = orders.event_id
  WHERE orders.stripe_payment_intent_id = v_ref
`,
        new: `  -- issue #3645: an instalment payment reference is its own dispute subject
  -- (source_type order_installment; single subject, order_id stays NULL and the
  -- parent order is returned for the host notification). A pending release is
  -- projected here like every other source; no release, a released payout or a
  -- zero amount go to the fallback, which knows instalments too.
  DECLARE
    v_inst_id uuid;
  BEGIN
    SELECT oi.id, ev.brand_id INTO v_inst_id, v_brand_id
    FROM public.order_installments oi
    JOIN public.orders od ON od.id = oi.order_id
    JOIN public.events ev ON ev.id = od.event_id
    WHERE oi.provider = 'paystack'
      AND (oi.stripe_payment_intent_id = v_ref
           OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts att
                       WHERE att.installment_id = oi.id AND att.reference = v_ref
                         AND att.state IN ('succeeded', 'refund_due', 'refunded')))
    LIMIT 1;
    IF v_inst_id IS NOT NULL THEN
      SELECT release_row.* INTO v_release
      FROM public.payout_release_items item
      JOIN public.brand_payout_releases release_row ON release_row.id = item.release_id
      WHERE item.source_type = 'order_installment'
        AND item.source_id = v_inst_id
        AND release_row.provider = 'paystack'
      ORDER BY CASE WHEN release_row.status = 'released' THEN 0 ELSE 1 END,
        release_row.created_at DESC
      LIMIT 1
      FOR UPDATE OF release_row;
      IF NOT FOUND OR v_release.status = 'released' OR v_amount = 0 THEN
        RETURN public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
          p_paystack_dispute_id, p_transaction_reference, p_event_name, p_status,
          p_resolution, p_amount_cents, p_currency, p_reason, p_due_at, p_raw, p_now
        );
      END IF;
      INSERT INTO public.paystack_disputes(
        paystack_dispute_id, transaction_reference, brand_id, order_installment_id,
        amount_cents, currency, status, resolution,
        reason, response_due_by, is_resolved, raw_event, created_at, updated_at
      ) VALUES (
        v_dispute_id, v_ref, v_brand_id, v_inst_id,
        v_amount, v_currency, v_status, v_resolution, nullif(btrim(p_reason), ''),
        coalesce(p_due_at, p_now + interval '16 hours'), v_event = 'charge.dispute.resolve',
        p_raw, p_now, p_now
      )
      ON CONFLICT (paystack_dispute_id) DO UPDATE SET
        transaction_reference = excluded.transaction_reference,
        brand_id = coalesce(public.paystack_disputes.brand_id, excluded.brand_id),
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
        is_resolved = public.paystack_disputes.is_resolved OR excluded.is_resolved,
        raw_event = excluded.raw_event,
        updated_at = excluded.updated_at
      RETURNING * INTO v_row;
      v_merchant_lost := v_event = 'charge.dispute.resolve'
        AND lower(coalesce(v_resolution, '')) IN (
          'merchant-accepted', 'merchant_accepted', 'accepted'
        );
      PERFORM public.refresh_paystack_dispute_release_projection(v_release.id, p_now);
      IF v_merchant_lost AND NOT v_row.debt_opened THEN
        UPDATE public.paystack_disputes
        SET debt_opened = true, updated_at = p_now
        WHERE id = v_row.id;
        v_debt_created := true;
      END IF;
      RETURN jsonb_build_object(
        'dispute_id', v_row.id,
        'paystack_dispute_id', v_dispute_id,
        'matched', true,
        'brand_id', v_row.brand_id,
        'order_id', (SELECT oi.order_id FROM public.order_installments oi WHERE oi.id = v_inst_id),
        'order_installment_id', v_inst_id,
        'venue_reservation_id', NULL,
        'rsvp_contribution_id', NULL,
        'venue_menu_order_id', NULL,
        'response_due_by', v_row.response_due_by,
        'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
        'merchant_lost', v_merchant_lost,
        'debt_created', v_debt_created,
        'debt_id', NULL
      );
    END IF;
  END;

  SELECT orders.id, events.brand_id INTO v_order_id, v_brand_id
  FROM public.orders
  JOIN public.events ON events.id = orders.event_id
  WHERE orders.stripe_payment_intent_id = v_ref
`,
      },
    ],
  },
  {
    fn: "record_paystack_dispute_outcome_pre_3645_append_only_fix",
    sourceFn: "record_paystack_dispute_outcome",
    source: "supabase/migrations/20271214003645_issue_3645_venue_menu_full_app_fee.sql",
    target: M4,
    hunks: [
      {
        name: "renamed fallback keeps its name",
        old: `CREATE OR REPLACE FUNCTION public.record_paystack_dispute_outcome(
`,
        new: `CREATE OR REPLACE FUNCTION public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
`,
      },
      {
        name: "instalment subject local",
        old: `  v_venue_order_id uuid;
`,
        new: `  v_venue_order_id uuid;
  v_installment_id uuid;  -- issue #3645
`,
      },
      {
        name: "instalment payment reference lookup",
        old: `  v_due := coalesce(p_due_at, p_now + interval '16 hours');
`,
        new: `  -- issue #3645: an instalment payment reference is its own subject.
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
`,
      },
      {
        name: "instalment subject stored",
        old: `    venue_reservation_id, rsvp_contribution_id, venue_menu_order_id,
    amount_cents, currency, status, resolution,
`,
        new: `    venue_reservation_id, rsvp_contribution_id, venue_menu_order_id, order_installment_id,
    amount_cents, currency, status, resolution,
`,
      },
      {
        name: "instalment subject value",
        old: `    v_contribution_id, v_venue_order_id,
    v_amount,`,
        new: `    v_contribution_id, v_venue_order_id, v_installment_id,
    v_amount,`,
      },
      {
        name: "instalment subject kept on replay",
        old: `    venue_menu_order_id = coalesce(
      public.paystack_disputes.venue_menu_order_id, excluded.venue_menu_order_id
    ),
`,
        new: `    venue_menu_order_id = coalesce(
      public.paystack_disputes.venue_menu_order_id, excluded.venue_menu_order_id
    ),
    order_installment_id = coalesce(
      public.paystack_disputes.order_installment_id, excluded.order_installment_id
    ),
`,
      },
      {
        name: "instalment source type for release / debt",
        old: `  ELSIF v_row.venue_menu_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_row.venue_menu_order_id;
  END IF;
`,
        new: `  ELSIF v_row.venue_menu_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_row.venue_menu_order_id;
  ELSIF v_row.order_installment_id IS NOT NULL THEN
    v_source_type := 'order_installment';
    v_source_id := v_row.order_installment_id;
  END IF;
`,
      },
      {
        name: "instalment match reported",
        old: `      OR v_row.venue_menu_order_id IS NOT NULL
    ),
    'brand_id', v_row.brand_id,
    'order_id', v_row.order_id,
`,
        new: `      OR v_row.venue_menu_order_id IS NOT NULL
      OR v_row.order_installment_id IS NOT NULL
    ),
    'brand_id', v_row.brand_id,
    'order_id', coalesce(v_row.order_id, (
      SELECT oi.order_id FROM public.order_installments oi WHERE oi.id = v_row.order_installment_id
    )),
    'order_installment_id', v_row.order_installment_id,
`,
      },
    ],
  },
  {
    fn: "paystack_release_has_unresolved_dispute",
    source: "supabase/migrations/20271214013645_issue_3645_paystack_dispute_append_only.sql",
    target: M4,
    hunks: [PROJECTION_JOIN],
  },
  {
    fn: "refresh_paystack_dispute_release_projection",
    source: "supabase/migrations/20271214013645_issue_3645_paystack_dispute_append_only.sql",
    target: M4,
    hunks: [PROJECTION_JOIN],
  },
  {
    fn: "run_payout_release_dark_sweep",
    source: "supabase/migrations/20271214003645_issue_3645_venue_menu_full_app_fee.sql",
    target: M4,
    hunks: [
      {
        name: "instalment arm: row provider, charged gross, refunds and disputes",
        old: `        -- Installment PIs are Stripe-only; never derive from mutable brands.payment_provider.
        'stripe'::text,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        oi.amount_cents::integer,0,0,
`,
        new: `        -- #3645: the instalment's own immutable provider; never derive from mutable brands.payment_provider.
        oi.provider,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        coalesce(oi.buyer_total_cents,oi.amount_cents)::integer,oi.refunded_amount_cents::integer,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE oi.provider='stripe' AND d.stripe_charge_id=oi.stripe_charge_id
            AND d.status NOT IN ('won','warning_closed')),0)
        +coalesce((SELECT sum(pd.amount_cents)::int FROM public.paystack_disputes pd
          WHERE pd.order_installment_id=oi.id AND pd.is_resolved IS NOT TRUE),0),
`,
      },
    ],
  },
  // #3645 A26 — stays follow the flat 4.5% rule; the Stripe fee make-good
  // covers stay sales on legacy accounts.
  {
    fn: "issue_1389_attach_stay_payout_release",
    source: "supabase/migrations/20271210013645_issue_3645_payout_gate_payment_plus_24h.sql",
    target: STAY_NET,
    hunks: [{ name: "stay host net excludes the provider fee", old: `  v_net := greatest(
    0,
    p_gross_cents - p_refunded_cents
      - p_mingla_fee_cents - p_provider_fee_cents
  );
`, new: `  -- #3645 A26 / flat 4.5% (Seth 2026-10-20): Mingla pays provider processing.
  -- Host net deducts only Mingla's fee; p_provider_fee_cents is kept on the
  -- row for reporting. Same rule as attach_payout_release for events.
  v_net := greatest(
    0,
    p_gross_cents - p_refunded_cents - p_mingla_fee_cents
  );
` }],
  },
  {
    fn: "run_stay_payout_release_dark_sweep",
    source: "supabase/migrations/20271210013645_issue_3645_payout_gate_payment_plus_24h.sql",
    target: STAY_NET,
    hunks: [{ name: "stay ledger amount excludes the provider fee", old: `      greatest(
        0,
        v_row.gross_cents - v_row.refunded_cents
          - v_row.mingla_fee_cents - v_row.provider_fee_cents
      ),
`, new: `      -- #3645 A26: same net as the release row (no provider fee).
      greatest(
        0,
        v_row.gross_cents - v_row.refunded_cents - v_row.mingla_fee_cents
      ),
` }],
  },
  {
    fn: "stripe_fee_make_good_census",
    source: "supabase/migrations/20271213003645_issue_3645_stripe_fee_make_good.sql",
    target: STAY_NET,
    hunks: [{ name: "account check accepts flat-rule stay sales", old: `        LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
        WHERE i.release_id = rel.id
          AND i.provider_fee_cents > 0
          AND (o.id IS NULL OR o.stripe_transfer_destination IS DISTINCT FROM sca.stripe_account_id)
`, new: `        WHERE i.release_id = rel.id
          AND i.provider_fee_cents > 0
          AND NOT public.issue_3645_fee_sale_on_account(i.source_type, i.source_id, sca.stripe_account_id)
` }],
  },
  {
    fn: "plan_stripe_fee_make_good",
    source: "supabase/migrations/20271213003645_issue_3645_stripe_fee_make_good.sql",
    target: STAY_NET,
    hunks: [{ name: "account check accepts flat-rule stay sales", old: `    LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
    WHERE i.release_id = p_release_id
      AND i.provider_fee_cents > 0
      AND (o.id IS NULL OR o.stripe_transfer_destination IS DISTINCT FROM v_account)
`, new: `    WHERE i.release_id = p_release_id
      AND i.provider_fee_cents > 0
      AND NOT public.issue_3645_fee_sale_on_account(i.source_type, i.source_id, v_account)
` }],
  },
  // #3645 bundle 2a — unpaid releases hold refunds and disputes; one projection.
  {
    fn: "issue_1389_record_stay_dispute",
    source: "supabase/migrations/20271231204134_issue_4134_pt409_application_conflicts.sql",
    target: UNPAID_HOLDS,
    hunks: [
      { name: "unpaid stay release records a dispute hold", old: `    IF FOUND AND v_release.status <> 'released' THEN
      UPDATE public.payout_release_items
      SET disputed_cents = CASE WHEN v_resolved
            THEN 0 ELSE v_line.disputed_minor END,
          net_cents = GREATEST(
            0,
            gross_cents - refunded_cents
              - CASE WHEN v_resolved THEN 0 ELSE v_line.disputed_minor END
              - mingla_fee_cents - partner_share_cents
              - provider_fee_cents
          )
      WHERE source_type = 'stay_reservation'
        AND source_id = v_line.line_id;
      UPDATE public.brand_payout_releases release_row
      SET disputed_cents = totals.disputed,
          net_release_cents = totals.net,
          updated_at = now()
      FROM (
        SELECT
          sum(item.disputed_cents)::integer AS disputed,
          sum(item.net_cents)::integer AS net
        FROM public.payout_release_items item
        WHERE item.release_id = v_release.id
      ) totals
      WHERE release_row.id = v_release.id;
    ELSIF FOUND AND v_release.status = 'released'
      AND v_line.disputed_minor > 0 THEN
`, new: `    IF FOUND AND v_release.status <> 'released' THEN
      -- #3645: payout_release_items is append-only. An unpaid release records
      -- the dispute as a hold and its totals are re-projected; the payout is
      -- refused while the dispute is open (authorize_stripe_payout_execution).
      IF v_resolved THEN
        INSERT INTO public.stay_payout_release_holds (
          release_id, line_id, kind, refunded_cents, disputed_cents,
          net_hold_cents, provider_ref, idempotency_key
        )
        SELECT
          opened.release_id, opened.line_id, 'dispute_won', 0,
          -opened.disputed_cents, -opened.net_hold_cents, opened.provider_ref,
          'stay-dispute-hold:' || p_dispute_ref || ':' || v_line.line_id || ':won'
        FROM public.stay_payout_release_holds opened
        WHERE opened.release_id = v_release.id
          AND opened.line_id = v_line.line_id
          AND opened.provider_ref = p_dispute_ref
          AND opened.kind = 'dispute_opened'
          AND NOT EXISTS (
            SELECT 1 FROM public.stay_payout_release_holds closed
            WHERE closed.release_id = opened.release_id
              AND closed.line_id = opened.line_id
              AND closed.provider_ref = opened.provider_ref
              AND closed.kind IN ('dispute_won', 'dispute_lost')
          )
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO public.stay_payout_release_holds (
          release_id, line_id, kind, refunded_cents, disputed_cents,
          net_hold_cents, provider_ref, idempotency_key
        ) VALUES (
          v_release.id, v_line.line_id, 'dispute_opened', 0,
          v_line.disputed_minor, v_line.disputed_minor, p_dispute_ref,
          'stay-dispute-hold:' || p_dispute_ref || ':' || v_line.line_id || ':opened'
        )
        ON CONFLICT DO NOTHING;
        IF lower(p_status) = 'lost' THEN
          -- Lost is final: the hold stays and the release may pay the rest.
          INSERT INTO public.stay_payout_release_holds (
            release_id, line_id, kind, refunded_cents, disputed_cents,
            net_hold_cents, provider_ref, idempotency_key
          )
          SELECT
            v_release.id, v_line.line_id, 'dispute_lost', 0, 0, 0, p_dispute_ref,
            'stay-dispute-hold:' || p_dispute_ref || ':' || v_line.line_id || ':lost'
          WHERE NOT EXISTS (
            SELECT 1 FROM public.stay_payout_release_holds closed
            WHERE closed.release_id = v_release.id
              AND closed.line_id = v_line.line_id
              AND closed.provider_ref = p_dispute_ref
              AND closed.kind IN ('dispute_won', 'dispute_lost')
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
      PERFORM public.issue_3645_refresh_stay_release_projection(
        v_release.id, now()
      );
    ELSIF FOUND AND v_release.status = 'released'
      AND v_line.disputed_minor > 0
      -- #3645: money already held back before payout is never charged again.
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_payout_release_holds held
        WHERE held.release_id = v_release.id
          AND held.line_id = v_line.line_id
          AND held.provider_ref = p_dispute_ref
      ) THEN
` },
    ],
  },
  {
    fn: "issue_1389_sync_source_refund",
    source: "supabase/migrations/20270131013814_issue_1389_stay_cancellation_refunds.sql",
    target: UNPAID_HOLDS,
    hunks: [
      { name: "unpaid stay release records a refund hold", old: `      ELSIF FOUND AND v_release.status <> 'released' THEN
        UPDATE public.payout_release_items item
        SET refunded_cents = LEAST(
              item.gross_cents,
              item.refunded_cents + v_line.refund_minor::integer
            ),
            net_cents = GREATEST(
              0,
              item.net_cents - v_line.organizer_minor::integer
            )
        WHERE item.release_id = v_release.id
          AND item.source_type = 'stay_reservation'
          AND item.source_id = v_line.line_id;
        UPDATE public.brand_payout_releases release_row
        SET refunded_cents = totals.refunded,
            net_release_cents = totals.net,
            updated_at = now()
        FROM (
          SELECT
            sum(item.refunded_cents)::integer AS refunded,
            sum(item.net_cents)::integer AS net
          FROM public.payout_release_items item
          WHERE item.release_id = v_release.id
        ) totals
        WHERE release_row.id = v_release.id;
      END IF;
`, new: `      ELSIF FOUND AND v_release.status <> 'released' THEN
        -- #3645: payout_release_items is append-only. The host bears only the
        -- organiser share of the refund (Mingla returns its fee share); record
        -- it as a hold and re-project the unpaid release.
        INSERT INTO public.stay_payout_release_holds (
          release_id, line_id, kind, refunded_cents, disputed_cents,
          net_hold_cents, provider_ref, idempotency_key
        ) VALUES (
          v_release.id, v_line.line_id, 'refund',
          LEAST(v_line.refund_minor, 2147483647)::integer, 0,
          LEAST(v_line.organizer_minor, 2147483647)::integer,
          v_refund.id::text,
          'stay-refund-hold:' || v_refund.id || ':' || v_line.line_id
        )
        ON CONFLICT DO NOTHING;
        PERFORM public.issue_3645_refresh_stay_release_projection(
          v_release.id, now()
        );
      END IF;
` },
    ],
  },
  {
    fn: "plan_pending_payout_partner_legs",
    source: "supabase/migrations/20271208003645_issue_3645_rebuild_keeps_stored_item_net.sql",
    target: UNPAID_HOLDS,
    hunks: [
      { name: "planner declares the shared projection", old: `  v_item_net integer;
`, new: `  v_item_net integer;
  v_projected record;  -- #3645
` },
      { name: "planner reads the shared projection", old: `    -- Rebuild from immutable items plus append-only corrections so retries
`, new: `    -- #3645: refunded, disputed and net come from the shared projection, so
    -- holds recorded while a release is unpaid survive every rebuild.
    SELECT * INTO v_projected
    FROM public.issue_3645_release_projected_totals(v_release.id);

    -- Rebuild from immutable items plus append-only corrections so retries
` },
      { name: "planner writes the projected totals", old: `    SET gross_cents = v_gross,
        refunded_cents = v_refunded,
        disputed_cents = v_disputed,
`, new: `    SET gross_cents = v_gross,
        refunded_cents = v_projected.refunded_cents,
        disputed_cents = v_projected.disputed_cents,
` },
      { name: "planner net is the projected net", old: `        net_release_cents = greatest(
          0,
          v_item_net
          - permanent_debt_withheld_cents - temporary_debt_withheld_cents
          + maturity_recredit_cents
        ),
`, new: `        -- #3645: Σ item net − holds − withheld debt + recredit, computed by
        -- issue_3645_release_projected_totals (same terms as before plus holds).
        net_release_cents = v_projected.net_release_cents,
` },
    ],
  },
  {
    fn: "refresh_paystack_dispute_release_projection",
    source: "supabase/migrations/20271214013645_issue_3645_paystack_dispute_append_only.sql",
    target: UNPAID_HOLDS,
    hunks: [
      PROJECTION_JOIN,
      { name: "release totals come from the shared projection (keeps withheld debt and stay holds)", old: `  WITH item_holds AS (
    SELECT
      item.id,
      item.disputed_cents AS snapshot_disputed_cents,
      item.net_cents AS snapshot_net_cents,
      least(
        item.net_cents::bigint,
        coalesce(sum(dispute.amount_cents::bigint) FILTER (
          WHERE dispute.id IS NOT NULL
            AND (
              dispute.is_resolved IS NOT TRUE
              OR lower(coalesce(dispute.resolution, '')) IN (
                'merchant-accepted', 'merchant_accepted', 'accepted'
              )
            )
        ), 0)
      ) AS hold_cents
    FROM public.payout_release_items item
    LEFT JOIN public.paystack_disputes dispute ON (
      (item.source_type = 'order' AND dispute.order_id = item.source_id)
      OR (
        item.source_type = 'rsvp_contribution'
        AND dispute.rsvp_contribution_id = item.source_id
      )
      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
      OR (  -- issue #3645
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
    WHERE item.release_id = p_release_id
    GROUP BY item.id, item.disputed_cents, item.net_cents
  ), totals AS (
    SELECT
      least(
        coalesce(sum(snapshot_disputed_cents::bigint + hold_cents), 0),
        2147483647::bigint
      )::integer AS disputed_cents,
      least(
        coalesce(sum(snapshot_net_cents::bigint - hold_cents), 0),
        2147483647::bigint
      )::integer AS net_release_cents
    FROM item_holds
  )
  SELECT disputed_cents, net_release_cents
  INTO v_disputed, v_net
  FROM totals;
`, new: `  -- #3645: one formula for every pending release (items, holds, withheld
  -- debt, recredit), shared with plan_pending_payout_partner_legs, so the
  -- debt recovered from this release is never paid out again.
  SELECT projected.disputed_cents, projected.net_release_cents
  INTO v_disputed, v_net
  FROM public.issue_3645_release_projected_totals(p_release_id) projected;
` },
    ],
  },
  {
    fn: "authorize_stripe_payout_execution",
    source: "supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql",
    target: UNPAID_HOLDS,
    hunks: [
      { name: "stay payout refused while a held dispute is open", old: `  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
`, new: `  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  -- #3645: like Paystack, fail closed while a stay dispute held on this
  -- unpaid release is open. Won returns the hold; lost keeps it and unblocks.
  IF v_release.status='in_flight'
     AND v_release.stripe_payout_id IS NULL
     AND public.issue_3645_stay_release_has_open_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='stay_dispute_open',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;
` },
    ],
  },
];

/** Every function definition in a SQL file: lower-case name -> full text through its closing dollar tag. */
export function definitions(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = head.exec(sql)) !== null) {
    const start = match.index;
    const asTag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/g;
    asTag.lastIndex = start;
    const tag = asTag.exec(sql);
    if (tag === null) continue;
    const bodyStart = tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], bodyStart);
    if (end < 0) continue;
    out.set(match[1].toLowerCase(), sql.slice(start, end + tag[1].length));
    head.lastIndex = end + tag[1].length;
  }
  return out;
}

/** Applies the hunks to the source body; each `old` must occur exactly once. */
export function applyHunks(body: string, hunks: Hunk[]): string {
  let out = body;
  for (const hunk of hunks) {
    const first = out.indexOf(hunk.old);
    if (first < 0 || out.indexOf(hunk.old, first + 1) >= 0) {
      throw new Error(`hunk "${hunk.name}" must match exactly once`);
    }
    out = out.replace(hunk.old, () => hunk.new);
  }
  return out;
}
