/**
 * issue #3645 payout gaps — the ONLY authorised hunks for every function
 * 20280809003645 re-emits. issue_3645_payout_gaps_reemit_hunks.structural.test.ts
 * proves each body equals the latest earlier definition with exactly these
 * replacements applied. Edit the hunks here and the migration together.
 */
import type { Hunk, Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20280809003645_issue_3645_payout_gaps.sql";

/** The instalment arm is the same text in the sweep and in the forecast. */
const INSTALMENT_ARM_HUNKS: Hunk[] = [
  {
    name: "the arm comment says where each fee comes from and that the gate is on",
    old: `      -- #3645 / #2036 — collected installment arm. Fees live on the row
      -- (application_fee_amount_cents / provider_fee_cents). Gated by
      -- issue_2036_installment_payout_ready() (default false). Skip cancelled
      -- events. Maturity = collected_at + 1 day via attach (payment+24h).
`,
    new: `      -- #3645 / #2036 — collected installment arm. Mingla's fee lives on the
      -- row. The provider fee is the row's on Paystack (the verified
      -- transaction fee) and the sweep's charge snapshot on Stripe, which this
      -- arm waits for. Gated by issue_2036_installment_payout_ready() (on since
      -- #3645). Skip cancelled events. Maturity = collected_at + 1 day.
`,
  },
  {
    name: "a Stripe instalment's provider fee is its charge snapshot",
    old: `        coalesce(oi.provider_fee_cents,0),
`,
    new: `        CASE WHEN oi.provider='stripe' THEN ifs.provider_fee_cents
          ELSE coalesce(oi.provider_fee_cents,0) END,
`,
  },
  {
    name: "join the instalment's fee snapshot",
    old: `      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
`,
    new: `      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
      -- issue #3645: Stripe's fee, captured by the sweep from the charge.
      LEFT JOIN public.payout_source_fee_snapshots ifs
        ON ifs.source_type='order_installment' AND ifs.source_id=oi.id
`,
  },
  {
    name: "a Stripe instalment waits for its fee snapshot",
    old: `        AND oi.application_fee_amount_cents IS NOT NULL
`,
    new: `        AND oi.application_fee_amount_cents IS NOT NULL
        AND (oi.provider<>'stripe' OR ifs.source_id IS NOT NULL)
`,
  },
];

export const PAYOUT_GAPS_REEMITS: Reemit[] = [
  {
    fn: "issue_2036_installment_payout_ready",
    source: "supabase/migrations/20270725003645_issue_3645_installment_cancel_and_ledger.sql",
    target: TARGET,
    hunks: [{
      name: "collected instalments enter the payout ledger",
      old: "  SELECT false;\n",
      new:
        "  -- issue #3645: fee, refund and dispute depth is proven on both rails.\n  SELECT true;\n",
    }],
  },
  {
    fn: "list_missing_payout_source_fees",
    source: "supabase/migrations/20271219004063_issue_4063_door_sale_orders.sql",
    target: TARGET,
    hunks: [
      {
        name: "rank inside each source family",
        old: "AS $function$\n  SELECT * FROM (\n",
        new: `AS $function$
  -- issue #3645: the limit applies per source family, so a backlog in one
  -- family (fees that keep failing) never starves the others.
  SELECT ranked.source_type, ranked.source_id, ranked.provider,
    ranked.provider_reference, ranked.stripe_account_id
  FROM (
  SELECT q.*, row_number() OVER (
      PARTITION BY q.source_type ORDER BY q.source_id
    ) AS family_rank
  FROM (
`,
      },
      {
        name: "Stripe instalments are fee candidates",
        old: `      AND b.payout_hold_cutover_at IS NOT NULL
      AND vo.created_at > b.payout_hold_cutover_at
  ) q
`,
        new: `      AND b.payout_hold_cutover_at IS NOT NULL
      AND vo.created_at > b.payout_hold_cutover_at
    UNION ALL
    -- issue #3645: a collected Stripe instalment's fee comes from its charge
    -- (the webhook records only Mingla's fee). Paystack instalments record the
    -- verified transaction fee at sale, so they are not candidates.
    SELECT 'order_installment', oi.id, oi.provider,
      coalesce(oi.stripe_charge_id, oi.stripe_payment_intent_id),
      b.stripe_connect_id
    FROM public.order_installments oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
    WHERE oi.provider = 'stripe'
      AND oi.status = 'collected'
      AND oi.collected_at IS NOT NULL
      AND oi.amount_cents > 0
      AND b.payout_hold_cutover_at IS NOT NULL
      AND oi.collected_at > b.payout_hold_cutover_at
  ) q
`,
      },
      {
        name: "limit each family, not the whole list",
        old: `  ORDER BY q.source_type, q.source_id
  LIMIT greatest(1, least(p_limit, 500));
`,
        new: `  ) ranked
  WHERE ranked.family_rank <= greatest(1, least(p_limit, 500))
  ORDER BY ranked.source_type, ranked.source_id;
`,
      },
    ],
  },
  {
    fn: "run_payout_release_dark_sweep",
    source: "supabase/migrations/20280204003645_issue_3645_installment_refunds_disputes_payouts.sql",
    target: TARGET,
    hunks: INSTALMENT_ARM_HUNKS,
  },
  {
    fn: "issue_3645_unattached_payout_sources",
    source: "supabase/migrations/20280503003645_issue_3645_float_forecast_alerts.sql",
    target: TARGET,
    hunks: INSTALMENT_ARM_HUNKS,
  },
  {
    fn: "list_missing_stay_provider_fees",
    source: "supabase/migrations/20270131013815_issue_1389_stay_payout_release.sql",
    target: TARGET,
    hunks: [{
      name: "a Paystack stay is verified by its transaction reference",
      old: `    COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref),
    CASE WHEN attempt.provider = 'stripe'
`,
      new: `    -- issue #3645: Paystack verifies by the transaction REFERENCE; the charge
    -- ref stored for a Paystack stay is Paystack's numeric transaction id.
    CASE WHEN attempt.provider = 'paystack' THEN attempt.provider_payment_ref
      ELSE COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref)
    END,
    CASE WHEN attempt.provider = 'stripe'
`,
    }],
  },
  {
    fn: "issue_1930_finalize_rsvp_contribution",
    source: "supabase/migrations/20270403001930_issue_1930_checkout_current_truth.sql",
    target: TARGET,
    hunks: [{
      name: "a replay on a paid Stripe chip-in back-fills a missing charge reference",
      old:
        "  IF v_c.status='paid' THEN RETURN jsonb_build_object('outcome','finalized'); END IF;\n",
      new: `  IF v_c.status='paid' THEN
    -- issue #3645: a hosted chip-in can be paid with only its Checkout Session
    -- id stored. A later delivery that carries the PaymentIntent or charge id
    -- fills it in so the payout sweep can read the fee. Nothing else about a
    -- paid row changes, and a stored charge reference is never replaced.
    IF v_c.provider='stripe' AND v_c.stripe_charge_id IS NULL
       AND (p_charge_id LIKE 'ch\\_%' OR p_charge_id LIKE 'pi\\_%') THEN
      UPDATE public.event_rsvp_contributions
         SET stripe_charge_id=p_charge_id, updated_at=now()
       WHERE id=p_contribution_id AND stripe_charge_id IS NULL;
    END IF;
    RETURN jsonb_build_object('outcome','finalized');
  END IF;
`,
    }],
  },
];
