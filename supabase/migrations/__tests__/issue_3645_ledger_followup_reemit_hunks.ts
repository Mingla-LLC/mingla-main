/**
 * issue #3645 bundle 4 — the ONLY authorised hunks for every function
 * 20280602003645 re-emits. issue_3645_ledger_followup_reemit_hunks.structural.test.ts
 * proves each body equals the latest earlier definition with exactly these
 * replacements applied. Generated; edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20280602003645_issue_3645_payout_ledger_followups.sql";

/** Functions this migration defines for the first time (not re-emits). */
export const LEDGER_FOLLOWUP_NEW_FUNCTIONS = [
  "issue_3645_protect_maturity_carryover",
  "issue_3645_mark_release_claimed",
  "issue_3645_release_carry_room",
  "issue_3645_paystack_plan_cents",
  "issue_3645_release_due_cents",
  "issue_3645_flag_oversized_paystack_plans",
  "issue_3645_release_closed_unpaid",
  "issue_3645_release_can_carry",
  "issue_3645_return_closed_release_debt",
  "issue_3645_place_maturity_carryovers",
];

export const LEDGER_FOLLOWUP_REEMITS: Reemit[] = [
  {
    fn: "mature_postponement_debts",
    source: "supabase/migrations/20280508003645_issue_3645_payout_debt_returns.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare what the carry needs, and hand back debt withheld by releases closed before any claim first",
        old: "  v_return_id uuid;  -- #3645 2d\nBEGIN\n",
        new: "  v_return_id uuid;  -- #3645 2d\n  v_source public.brand_payout_releases;  -- #3645 bundle 4\n  v_carry integer;  -- #3645 bundle 4\n  v_sent bigint;  -- #3645 bundle 4\nBEGIN\n  -- #3645 bundle 4: a release closed before it was ever claimed hands back\n  -- what it withheld first, so maturity below sees it as no longer withheld.\n  -- Its own failure never stops maturity or the sweep: it retries next tick.\n  BEGIN\n    PERFORM public.issue_3645_return_closed_release_debt(p_now);\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'issue_3645_return_closed_failed sqlstate=% message=%',\n      SQLSTATE, SQLERRM;\n  END;\n",
      },
      {
        name: "a release that already paid carries the part of the matured value it did not send to the next payout, instead of a recredit no claim takes",
        old: "      ELSIF v_recredit>0 THEN\n        INSERT INTO public.payout_ledger_adjustments(\n          release_id,brand_id,currency,kind,amount_cents,idempotency_key\n        ) VALUES(\n          v_app.release_id,v_debt.brand_id,v_debt.currency,'maturity_recredit',\n          v_recredit,'postpone-recredit:'||v_app.id\n        ) ON CONFLICT(idempotency_key) DO NOTHING;\n",
        new: "      ELSIF v_recredit>0 THEN\n        -- #3645 bundle 4: a recredit on a release that already paid is never\n        -- paid (no claim takes a paid release), so carry the value to the\n        -- brand's next payable release. Only the part its transfers did not\n        -- already send: a Paystack plan made before this value was withheld\n        -- can hold some of it. Every organiser leg not failed or reversed\n        -- counts as sent (a confirmed transfer still waiting on its fee is\n        -- fee_unreconciled; a planned leg goes out once the recredit left\n        -- below covers it), the same rule authorize uses. A release that has not paid (closed after a\n        -- claim, failed, or holding a fixed Paystack plan) carries nothing:\n        -- its items may no longer fund the value. What is not carried stays\n        -- 2d's recredit on the release, so the ledger still adds up.\n        SELECT * INTO v_source FROM public.brand_payout_releases\n        WHERE id=v_app.release_id;\n        v_carry:=0;\n        IF v_source.status IN ('released','fee_unreconciled') THEN\n          SELECT coalesce(sum(\n            leg.principal_cents::bigint+leg.estimated_fee_cents+leg.stamp_duty_cents\n          ),0) INTO v_sent\n          FROM public.payout_transfer_legs leg\n          WHERE leg.release_id=v_app.release_id AND leg.kind='organiser'\n            AND leg.status NOT IN ('failed','reversed');\n          v_carry:=greatest(0,least(v_recredit::bigint,\n            v_recredit::bigint-greatest(0,v_sent-(\n              v_source.net_release_cents::bigint+coalesce((\n                SELECT sum(adj.amount_cents) FROM public.payout_ledger_adjustments adj\n                WHERE adj.release_id=v_app.release_id AND adj.kind='maturity_recredit'\n              ),0)\n            ))\n          ))::integer;\n        END IF;\n        IF v_carry>0 THEN\n          INSERT INTO public.payout_maturity_carryovers(\n            brand_id,provider,currency,amount_cents,debt_id,application_id,\n            source_release_id,created_at\n          ) VALUES(\n            v_debt.brand_id,v_source.provider,v_debt.currency,v_carry,\n            v_debt.id,v_app.id,v_app.release_id,p_now\n          ) ON CONFLICT(application_id) WHERE parent_carryover_id IS NULL\n            DO NOTHING;\n        END IF;\n        IF v_recredit-v_carry>0 THEN\n        INSERT INTO public.payout_ledger_adjustments(\n          release_id,brand_id,currency,kind,amount_cents,idempotency_key\n        ) VALUES(\n          v_app.release_id,v_debt.brand_id,v_debt.currency,'maturity_recredit',\n          v_recredit-v_carry,'postpone-recredit:'||v_app.id\n        ) ON CONFLICT(idempotency_key) DO NOTHING;\n        END IF;\n",
      },
    ],
  },
  {
    fn: "authorize_paystack_payout_execution",
    source: "supabase/migrations/20271214013645_issue_3645_paystack_dispute_append_only.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the plan and due totals",
        old: "  v_event_status text;\nBEGIN\n",
        new: "  v_event_status text;\n  v_plan_cents bigint;  -- #3645 bundle 4\n  v_due_cents bigint;  -- #3645 bundle 4\nBEGIN\n",
      },
      {
        name: "never send a plan larger than what the release owes now",
        old: "    RETURN false;\n  END IF;\n\n  RETURN true;\nEND;\n",
        new: "    RETURN false;\n  END IF;\n\n  -- #3645 bundle 4: the organiser legs were planned from the pool at claim\n  -- time. If a hold or refund has since lowered what this release owes\n  -- (its net plus recredits), sending that plan would overpay the host.\n  -- Never send it: put the release back, keep the legs (a leg may already\n  -- be at Paystack), and alert ops. If the release owes the plan again (a\n  -- dispute won), the next claim sends it unchanged.\n  SELECT coalesce(sum(\n    leg.principal_cents::bigint + leg.estimated_fee_cents + leg.stamp_duty_cents\n  ), 0)\n  INTO v_plan_cents\n  FROM public.payout_transfer_legs leg\n  WHERE leg.release_id = p_release_id\n    AND leg.kind = 'organiser'\n    AND leg.status NOT IN ('failed', 'reversed');\n  v_due_cents := v_release.net_release_cents::bigint + coalesce((\n    SELECT sum(a.amount_cents)\n    FROM public.payout_ledger_adjustments a\n    WHERE a.release_id = p_release_id AND a.kind = 'maturity_recredit'\n  ), 0);\n  IF v_plan_cents > v_due_cents THEN\n    UPDATE public.brand_payout_releases\n    SET status = 'pending',\n        error_message = 'paystack_plan_exceeds_due',\n        paystack_execution_claim_id = NULL,\n        paystack_execution_claimed_at = NULL,\n        updated_at = p_now\n    WHERE id = p_release_id;\n    INSERT INTO public.payout_release_alert_outbox (\n      release_id, alert_kind, idempotency_key, brand_id, error_message,\n      created_at, updated_at\n    ) VALUES (\n      p_release_id, 'paystack_plan_exceeds_due',\n      'paystack_plan_exceeds_due:' || p_release_id::text,\n      v_release.brand_id,\n      left(format('plan %s > due %s', v_plan_cents, v_due_cents), 1000),\n      p_now, p_now\n    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;\n    RETURN false;\n  END IF;\n\n  RETURN true;\nEND;\n",
      },
    ],
  },
  {
    fn: "claim_payout_release_alerts",
    source: "supabase/migrations/20280503003645_issue_3645_float_forecast_alerts.sql",
    target: TARGET,
    hunks: [
      {
        name: "deliver the new plan-exceeds-due kind",
        old: "        'stay_dispute_hold_open'  -- issue #3645\n",
        new: "        'stay_dispute_hold_open',  -- issue #3645\n        'paystack_plan_exceeds_due'  -- issue #3645 bundle 4\n",
      },
    ],
  },
  {
    fn: "claim_paystack_payout_releases",
    source: "supabase/migrations/20270728003645_issue_3645_admin_payout_pause_and_debt.sql",
    target: TARGET,
    hunks: [
      {
        name: "place carried value under the provider claim lock before reading recredits, and alert on plans left out",
        old: "AS $fn$\nBEGIN\n  RETURN QUERY\n",
        new: "AS $fn$\nBEGIN\n  -- #3645 bundle 4: every Paystack claim takes this lock, then places carried\n  -- maturity value on payable releases, then reads recredits below in a\n  -- later statement. A value placed by one claim is therefore in the\n  -- snapshot of the next; no claim reads a carrier without it. Placement\n  -- failing never stops the claim: the value waits for the next one.\n  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3645_claim:paystack', 0));\n  BEGIN\n    PERFORM public.issue_3645_place_maturity_carryovers(p_now, 'paystack');\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'issue_3645_place_carryovers_failed provider=paystack sqlstate=% message=%',\n      SQLSTATE, SQLERRM;\n  END;\n  -- #3645 bundle 4: alert ops about releases left out below for a kept plan\n  -- larger than they owe (authorize never sees those).\n  BEGIN\n    PERFORM public.issue_3645_flag_oversized_paystack_plans(p_now);\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'issue_3645_flag_oversized_plans_failed sqlstate=% message=%',\n      SQLSTATE, SQLERRM;\n  END;\n  RETURN QUERY\n",
      },
      {
        name: "leave out a release whose kept plan is larger than it now owes (unless a leg needs reconciling), so it never takes a slot from payable releases",
        old: "      ),0), 2147483647::bigint) > 0\n    ORDER BY r.releasable_at,r.created_at,r.id\n",
        new: "      ),0), 2147483647::bigint) > 0\n      -- #3645 bundle 4: authorize refuses a kept organiser plan larger than\n      -- the release now owes. Leave such a release out before the LIMIT until\n      -- it owes the plan again, so refused releases never fill every slot,\n      -- unless a leg still needs reconciling (sent and not settled): the\n      -- sweep's reconcile-first must still reach it. Ops are alerted above.\n      AND (\n        public.issue_3645_paystack_plan_cents(r.id)\n          <= public.issue_3645_release_due_cents(r.id)\n        OR EXISTS (\n          SELECT 1 FROM public.payout_transfer_legs leg\n          WHERE leg.release_id=r.id AND leg.kind='organiser'\n            AND leg.status IN ('in_flight','fee_unreconciled')\n        )\n      )\n    ORDER BY r.releasable_at,r.created_at,r.id\n",
      },
    ],
  },
  {
    fn: "claim_stripe_payout_releases",
    source: "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql",
    target: TARGET,
    hunks: [
      {
        name: "place carried value under the provider claim lock before reading recredits",
        old: "AS $fn$\nBEGIN\n  RETURN QUERY\n",
        new: "AS $fn$\nBEGIN\n  -- #3645 bundle 4: every Stripe claim takes this lock, then places carried\n  -- maturity value on payable releases, then reads recredits below in a\n  -- later statement. A value placed by one claim is therefore in the\n  -- snapshot of the next; no claim reads a carrier without it. Placement\n  -- failing never stops the claim: the value waits for the next one.\n  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3645_claim:stripe', 0));\n  BEGIN\n    PERFORM public.issue_3645_place_maturity_carryovers(p_now, 'stripe');\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'issue_3645_place_carryovers_failed provider=stripe sqlstate=% message=%',\n      SQLSTATE, SQLERRM;\n  END;\n  RETURN QUERY\n",
      },
    ],
  },
];

/** private.* functions re-emitted (the shared definitions() reads public only). */
export const LEDGER_FOLLOWUP_PRIVATE_REEMITS: Reemit[] = [
  {
    fn: "host_account_deletion_blockers",
    source: "supabase/migrations/20270816003660_issue_3660_host_account_deletion_atomic.sql",
    target: TARGET,
    hunks: [
      {
        name: "carried value still owed to the host blocks account deletion",
        old: "    + (SELECT count(*)\n       FROM private.host_account_unreleased_held_money(v_brand_ids, v_event_ids))\n  )::integer INTO v_count;\n",
        new: "    + (SELECT count(*)\n       FROM private.host_account_unreleased_held_money(v_brand_ids, v_event_ids))\n    -- #3645 bundle 4: matured value carried to a later payout and not placed\n    -- yet is still owed to the host (placed value rides on a pending\n    -- release, which the first arm counts).\n    + (SELECT count(*) FROM public.payout_maturity_carryovers c\n        WHERE c.brand_id = ANY (v_brand_ids)\n          AND c.carried_at IS NULL)\n  )::integer INTO v_count;\n",
      },
    ],
  },
];
