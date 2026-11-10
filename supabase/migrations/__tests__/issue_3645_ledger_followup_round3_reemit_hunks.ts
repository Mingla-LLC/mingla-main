/**
 * issue #3645 bundle 4 follow-up — the ONLY authorised hunks for the two
 * functions 20280603003645 re-emits from 20280602003645 (review fixes that
 * missed #4369's merge). issue_3645_ledger_followup_round3_reemit_hunks.structural.test.ts
 * proves each body equals its 20280602003645 definition with exactly these
 * replacements applied. Edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const SOURCE = "supabase/migrations/20280602003645_issue_3645_payout_ledger_followups.sql";
export const TARGET =
  "supabase/migrations/20280603003645_issue_3645_ledger_followup_closed_carrier_and_expired_claims.sql";

export const ROUND3_REEMITS: Reemit[] = [
  {
    fn: "issue_3645_flag_oversized_paystack_plans",
    source: SOURCE,
    target: TARGET,
    hunks: [
      {
        name: "expired in_flight claims with an oversized plan are flagged too",
        old: "      AND r.status IN (\n        'pending', 'blocked_balance', 'blocked_otp', 'blocked_over_cap',\n        'fee_unreconciled'\n      )\n",
        new: "      AND (\n        r.status IN (\n          'pending', 'blocked_balance', 'blocked_otp', 'blocked_over_cap',\n          'fee_unreconciled'\n        )\n        -- A claim that expired (the worker died): the claim would take it\n        -- again, so it is left out and must be flagged the same way.\n        OR (\n          r.status = 'in_flight'\n          AND r.paystack_execution_claimed_at < p_now - interval '10 minutes'\n        )\n      )\n",
      },
    ],
  },
];

/** private.* functions re-emitted (the shared definitions() reads public only). */
export const ROUND3_PRIVATE_REEMITS: Reemit[] = [
  {
    fn: "host_account_deletion_blockers",
    source: SOURCE,
    target: TARGET,
    hunks: [
      {
        name: "carried value placed on a carrier closed before any claim still blocks deletion",
        old: "    -- release, which the first arm counts).\n    + (SELECT count(*) FROM public.payout_maturity_carryovers c\n        WHERE c.brand_id = ANY (v_brand_ids)\n          AND c.carried_at IS NULL)\n",
        new: "    -- release, which the first arm counts, unless that release was closed).\n    + (SELECT count(*) FROM public.payout_maturity_carryovers c\n        WHERE c.brand_id = ANY (v_brand_ids)\n          AND (c.carried_at IS NULL\n               -- placed on a carrier closed before any claim, and not\n               -- moved on yet: the next claim re-homes it, still owed.\n               OR (c.rehomed_at IS NULL\n                   AND public.issue_3645_release_closed_unpaid(c.carried_release_id))))\n",
      },
    ],
  },
];
