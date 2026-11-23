/**
 * issue #4522 section 8 — the ONLY authorised hunks for the #3645 payout
 * functions 20281202064522 re-emits so a host is never paid money that went
 * back to a traveler. The #3645 structural tests accept a later definition of
 * their bodies only when it is declared here and equals its source with
 * exactly these hunks (issue_3645_debt_return_reemit_hunks.structural.test.ts
 * checks all three). Edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20281202064522_issue_4522_refunds_payouts.sql";

export const PAYOUT_REFUND_REEMITS: Reemit[] = [
  {
    fn: "issue_3645_release_projected_totals",
    source: "supabase/migrations/20280508003645_issue_3645_payout_debt_returns.sql",
    target: TARGET,
    hunks: [
      {
        name: "read what each sale is worth now (refunds since attach, refunds pending or unrecorded)",
        old: "      greatest(coalesce(stay.net_hold, 0), 0) AS stay_net_hold\n    FROM rel",
        new: "      greatest(coalesce(stay.net_hold, 0), 0) AS stay_net_hold,\n      -- issue #4522 (section 8): what the sale is worth now, after the\n      -- refunds recorded (or still being made) since it was attached.\n      now_.refunded_cents AS now_refunded,\n      now_.net_cents AS now_net\n    FROM rel",
      },
      {
        name: "join the one per-item formula",
        old: "    ) stay ON true\n  ), per_item AS (",
        new: "    ) stay ON true\n    CROSS JOIN LATERAL public.issue_4522_payout_item_now(\n      item.source_type, item.source_id, item.gross_cents, item.refunded_cents,\n      item.disputed_cents, item.mingla_fee_cents, item.net_cents\n    ) now_\n  ), per_item AS (",
      },
      {
        name: "refunded and net from what the sale is worth now",
        old: "      least(gross, refunded + stay_refunded) AS refunded,\n      disputed + least(net, paystack_hold) + stay_disputed AS disputed,\n      net - least(net, paystack_hold + stay_net_hold) AS net",
        new: "      least(gross, now_refunded + stay_refunded) AS refunded,\n      disputed + least(net, paystack_hold) + stay_disputed AS disputed,\n      now_net - least(now_net, paystack_hold + stay_net_hold) AS net",
      },
    ],
  },
  {
    fn: "authorize_stripe_payout_execution",
    source: "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the projection read",
        old: "  v_expected integer;\nBEGIN",
        new: "  v_expected integer;\n  v_owed record;  -- issue #4522 section 8\nBEGIN",
      },
      {
        name: "never send more than the release's sales are worth now (after every main check)",
        old: "  RETURN true;\nEND;",
        new: "  -- issue #4522 section 8: the last check before money moves. A refund (or\n  -- an unrecorded provider refund) since this release's sales were attached\n  -- lowered what it owes: never send the old amount. Store what it owes,\n  -- put it back for the next claim, and tell ops once.\n  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);\n  IF v_owed.net_release_cents < v_release.net_release_cents THEN\n    UPDATE public.brand_payout_releases\n    SET refunded_cents=v_owed.refunded_cents,\n        disputed_cents=v_owed.disputed_cents,\n        net_release_cents=v_owed.net_release_cents,\n        status='pending',\n        error_message='payout_refund_unreconciled',\n        stripe_execution_claim_id=NULL,\n        stripe_execution_claimed_at=NULL,\n        updated_at=p_now\n    WHERE id=p_release_id;\n    PERFORM public.issue_4522_alert_payout_refund(p_release_id, 'paystack_plan_exceeds_due',\n      format('payout_refund_unreconciled: stripe due %s > owed %s',\n        v_release.net_release_cents::bigint+v_release.maturity_recredit_cents,\n        v_owed.net_release_cents::bigint+v_release.maturity_recredit_cents), p_now);\n    RETURN false;\n  END IF;\n\n  RETURN true;\nEND;",
      },
    ],
  },
  {
    fn: "authorize_paystack_payout_execution",
    source: "supabase/migrations/20280602003645_issue_3645_payout_ledger_followups.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the projection read",
        old: "  v_due_cents bigint;  -- #3645 bundle 4\nBEGIN",
        new: "  v_due_cents bigint;  -- #3645 bundle 4\n  v_owed record;  -- issue #4522 section 8\nBEGIN",
      },
      {
        name: "lower what the release owes before the plan check refuses a larger plan",
        old: "  -- #3645 bundle 4: the organiser legs were planned from the pool at claim",
        new: "  -- issue #4522 section 8: a refund (or an unrecorded provider refund)\n  -- since this release's sales were attached lowers what it owes before the\n  -- plan check below, which then refuses the larger plan and alerts ops.\n  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);\n  IF v_owed.net_release_cents < v_release.net_release_cents THEN\n    UPDATE public.brand_payout_releases\n    SET refunded_cents = v_owed.refunded_cents,\n        disputed_cents = v_owed.disputed_cents,\n        net_release_cents = v_owed.net_release_cents,\n        updated_at = p_now\n    WHERE id = p_release_id;\n    v_release.net_release_cents := v_owed.net_release_cents;\n  END IF;\n\n  -- #3645 bundle 4: the organiser legs were planned from the pool at claim",
      },
    ],
  },
];
