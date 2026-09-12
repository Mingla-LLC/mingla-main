/**
 * Issue #3272 — the edge-side mirror of
 * `mingla-business/src/utils/__tests__/issue_3272_stripe_kyc_reminder_pending_verification.happy.test.ts`.
 *
 * `requirementsHasDue()` returned `true` for ANY non-null `disabled_reason`.
 * `requirements.pending_verification` IS a `disabled_reason` and means the
 * OPPOSITE of "due" — Stripe is reviewing what it already holds and the seller
 * has no action available — so `pg_cron` job 79 would push AND email
 * "Finish Stripe verification" at a seller with nothing to finish.
 *
 * PURELY ADDITIVE. `stripeKycReminderSchedule.test.ts`,
 * `stripeKycRemediation.test.ts` and `stripe-kyc-stall-reminder/index.test.ts`
 * all pass unchanged.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isStripePendingVerification,
  requirementsHasDue,
} from "../stripeKycRemediation.ts";
import { requirementsHasDue as requirementsHasDueViaSchedule } from "../stripeKycReminderSchedule.ts";

/**
 * The exact production blob observed on `acct_1UEr7lEokzcvwz0K` (Lantern Room)
 * at 2026-09-12 13:38:52Z.
 */
const PROD_PENDING_VERIFICATION = {
  disabled_reason: "requirements.pending_verification",
  currently_due: [],
  past_due: [],
  eventually_due: [],
  pending_verification: ["business_profile.url"],
};

/**
 * The real production `requirements.past_due` shape for `acct_1Tsv2yItnLzCWb3M`
 * — 15 `currently_due` entries. This account MUST keep being reminded.
 */
const PROD_PAST_DUE_FIELDS = [
  "business_profile.mcc",
  "business_profile.product_description",
  "business_profile.support_phone",
  "business_profile.url",
  "business_type",
  "external_account",
  "representative.dob.day",
  "representative.dob.month",
  "representative.dob.year",
  "representative.email",
  "representative.first_name",
  "representative.last_name",
  "settings.payments.statement_descriptor",
  "tos_acceptance.date",
  "tos_acceptance.ip",
];

const PROD_PAST_DUE = {
  disabled_reason: "requirements.past_due",
  currently_due: PROD_PAST_DUE_FIELDS,
  past_due: PROD_PAST_DUE_FIELDS,
  eventually_due: [],
  pending_verification: [],
};

Deno.test("#3272: the live pending-verification blob is NOT due", () => {
  assertEquals(PROD_PENDING_VERIFICATION.currently_due.length, 0);
  assertEquals(PROD_PENDING_VERIFICATION.past_due.length, 0);
  assertEquals(requirementsHasDue(PROD_PENDING_VERIFICATION), false);
});

Deno.test("#3272: the re-export from stripeKycReminderSchedule.ts still resolves and agrees", () => {
  // `stripe-kyc-stall-reminder/index.ts:13-16` imports from the schedule module.
  assertEquals(requirementsHasDueViaSchedule(PROD_PENDING_VERIFICATION), false);
  assertEquals(requirementsHasDueViaSchedule(PROD_PAST_DUE), true);
});

Deno.test("#3272: the daily cron selects ZERO pending-verification recipients", () => {
  const cutoff = "2026-09-11T10:15:00.000Z";
  const stale = "2026-09-08T09:00:00.000Z";
  const rows = [
    {
      stripe_account_id: "acct_1UEr7lEokzcvwz0K",
      charges_enabled: false,
      kyc_stall_reminder_sent_at: null as string | null,
      updated_at: stale,
      requirements: PROD_PENDING_VERIFICATION as Record<string, unknown>,
    },
    {
      stripe_account_id: "acct_1Tsv2yItnLzCWb3M",
      charges_enabled: false,
      kyc_stall_reminder_sent_at: null as string | null,
      updated_at: stale,
      requirements: PROD_PAST_DUE as Record<string, unknown>,
    },
  ];

  // The sender's real gate: index.ts:91-94 row selection + index.ts:137-141.
  const selected = rows.filter((row) =>
    row.charges_enabled === false &&
    row.kyc_stall_reminder_sent_at === null &&
    row.updated_at < cutoff &&
    requirementsHasDue(row.requirements)
  );

  assertEquals(selected.map((row) => row.stripe_account_id), [
    "acct_1Tsv2yItnLzCWb3M",
  ]);
});

Deno.test("#3272: states that must STILL notify are untouched", () => {
  assertEquals(requirementsHasDue(PROD_PAST_DUE), true);
  assertEquals(
    requirementsHasDue({
      disabled_reason: "action_required.requested_capabilities",
      currently_due: [],
      past_due: [],
    }),
    true,
  );
  assertEquals(
    requirementsHasDue({ disabled_reason: "under_review", currently_due: [], past_due: [] }),
    true,
  );
  assertEquals(
    requirementsHasDue({ disabled_reason: "rejected.other", currently_due: [], past_due: [] }),
    true,
  );
  // Stripe is reviewing one thing and still wants another.
  assertEquals(
    requirementsHasDue({
      disabled_reason: "requirements.pending_verification",
      currently_due: ["external_account"],
      past_due: [],
    }),
    true,
  );
  assertEquals(
    requirementsHasDue({ disabled_reason: null, currently_due: ["company.tax_id"], past_due: [] }),
    true,
  );
});

Deno.test("#3272: eventually_due alone does not re-arm a pending account", () => {
  assertEquals(
    requirementsHasDue({
      disabled_reason: "requirements.pending_verification",
      currently_due: [],
      past_due: [],
      eventually_due: ["company.tax_id"],
      pending_verification: ["business_profile.url"],
    }),
    false,
  );
});

Deno.test("#3272: the predicate is robust to malformed disabled_reason", () => {
  assertEquals(isStripePendingVerification(null), false);
  assertEquals(isStripePendingVerification(undefined), false);
  assertEquals(isStripePendingVerification({}), false);
  assertEquals(isStripePendingVerification({ disabled_reason: null }), false);
  assertEquals(
    isStripePendingVerification({ disabled_reason: ["requirements.pending_verification"] }),
    false,
  );
  assertEquals(isStripePendingVerification({ disabled_reason: 7 }), false);
  assertEquals(
    isStripePendingVerification({ disabled_reason: "requirements.pending_verification" }),
    true,
  );
});
