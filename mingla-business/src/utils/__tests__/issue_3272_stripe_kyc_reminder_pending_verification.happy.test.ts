/**
 * Issue #3272 — the daily Stripe cron emails and pushes "Finish Stripe
 * verification" at sellers who have nothing to finish.
 *
 * `pg_cron` job 79 (`issue_3200_stripe_kyc_stall_reminder`, `15 10 * * *`)
 * calls `supabase/functions/stripe-kyc-stall-reminder/index.ts`, whose send
 * gate is `requirementsHasDue()`. That predicate returned `true` for ANY
 * non-null `disabled_reason` — and `requirements.pending_verification` IS a
 * `disabled_reason`, one that means the OPPOSITE of "due": Stripe is checking
 * what it already has and the seller has no action available. The module's own
 * copy table already says so ("Stripe is reviewing submitted information. No
 * action is needed."); the predicate ignored it.
 *
 * WHY THIS SUITE IS JEST AND NOT ONLY DENO
 * ----------------------------------------
 * `mingla-business jest (full suite)` is the required check that runs on every
 * pull request. jest CAN import `_shared/stripeKycRemediation.ts` — it has zero
 * imports and never touches the `Deno` global — but it CANNOT import
 * `_shared/stripeKycReminderSchedule.ts` (ts-jest TS5097 on its extensioned
 * `./stripeKycRemediation.ts` specifier, plus TS2304 on `Deno` in
 * `calculateCronJitterMs`). So #3272 MOVED `requirementsHasDue` into the
 * jest-reachable module, and these assertions execute the REAL edge predicate
 * rather than grepping its source. `stripeKycReminderSchedule.ts` re-exports
 * it, so the edge function's import is unchanged.
 *
 * PURELY ADDITIVE. No existing test is modified.
 */

// NOTE: no `.ts` extension in this specifier — ts-jest throws TS5097 on one.
import {
  isStripePendingVerification as edgeIsStripePendingVerification,
  requirementsHasDue,
} from "../../../../supabase/functions/_shared/stripeKycRemediation";
import { isStripePendingVerification as clientIsStripePendingVerification } from "../stripeOnboardingOutcome";

type RequirementsShape = {
  disabled_reason?: string | null;
  currently_due?: string[] | null;
  past_due?: string[] | null;
  eventually_due?: string[] | null;
  pending_verification?: string[] | null;
  current_deadline?: number | null;
};

/**
 * The exact production blob observed on `acct_1UEr7lEokzcvwz0K` (Lantern Room)
 * at 2026-09-12 13:38:52Z. It sat in this state until 14:01:30Z.
 */
const PROD_PENDING_VERIFICATION: RequirementsShape = {
  disabled_reason: "requirements.pending_verification",
  currently_due: [],
  past_due: [],
  eventually_due: [],
  pending_verification: ["business_profile.url"],
};

/**
 * The real production `requirements.past_due` shape read out of
 * `stripe_connect_accounts` for `acct_1Tsv2yItnLzCWb3M` — 15 `currently_due`
 * entries, the same 15 `past_due`. This account MUST keep being reminded.
 */
const PROD_PAST_DUE: RequirementsShape = {
  disabled_reason: "requirements.past_due",
  currently_due: [
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
  ],
  past_due: [
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
  ],
  eventually_due: [],
  pending_verification: [],
};

describe("#3272 the pinned production case", () => {
  it("does not treat the live pending-verification blob as due", () => {
    expect(PROD_PENDING_VERIFICATION.currently_due).toHaveLength(0);
    expect(PROD_PENDING_VERIFICATION.past_due).toHaveLength(0);
    expect(PROD_PENDING_VERIFICATION.disabled_reason).toBe(
      "requirements.pending_verification",
    );

    expect(requirementsHasDue(PROD_PENDING_VERIFICATION)).toBe(false);
  });
});

/**
 * The sender's REAL selection, modelled row-for-row so the proof is "ZERO
 * recipients", not merely "the boolean flipped".
 *
 * Row selection in `stripe-kyc-stall-reminder/index.ts` is
 * `.eq("charges_enabled", false)`, and the per-row send gate at lines 137-141 is
 * `kyc_stall_reminder_sent_at === null && updated_at < cutoff && requirementsHasDue(requirements)`.
 */
interface AccountRow {
  brand_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  kyc_stall_reminder_sent_at: string | null;
  updated_at: string;
  requirements: RequirementsShape;
}

const CUTOFF = "2026-09-11T10:15:00.000Z";
const STALE = "2026-09-08T09:00:00.000Z";

function selectStallReminderRecipients(rows: AccountRow[]): AccountRow[] {
  return rows.filter(
    (row) =>
      row.charges_enabled === false &&
      row.kyc_stall_reminder_sent_at === null &&
      row.updated_at < CUTOFF &&
      requirementsHasDue(row.requirements),
  );
}

describe("#3272 the daily cron's recipient list", () => {
  const rows: AccountRow[] = [
    {
      brand_id: "brand-lantern-room",
      stripe_account_id: "acct_1UEr7lEokzcvwz0K",
      charges_enabled: false,
      kyc_stall_reminder_sent_at: null,
      updated_at: STALE,
      requirements: PROD_PENDING_VERIFICATION,
    },
    {
      brand_id: "brand-bxbrim",
      stripe_account_id: "acct_1Tsv2yItnLzCWb3M",
      charges_enabled: false,
      kyc_stall_reminder_sent_at: null,
      updated_at: STALE,
      requirements: PROD_PAST_DUE,
    },
  ];

  it("sends ZERO notifications to the pending-verification account", () => {
    const selected = selectStallReminderRecipients(rows);
    const pendingRecipients = selected.filter(
      (row) => row.stripe_account_id === "acct_1UEr7lEokzcvwz0K",
    );

    // Every other gate condition is satisfied by that row, so if it is absent
    // the ONLY thing that excluded it is the predicate under test.
    expect(pendingRecipients).toHaveLength(0);
  });

  it("still sends to the past_due account in the same batch", () => {
    const selected = selectStallReminderRecipients(rows);

    expect(selected.map((row) => row.stripe_account_id)).toEqual([
      "acct_1Tsv2yItnLzCWb3M",
    ]);
  });
});

describe("#3272 states that must STILL notify — no over-silencing", () => {
  const stillNotifies: Array<[string, RequirementsShape]> = [
    ["requirements.past_due (prod bxbrim)", PROD_PAST_DUE],
    [
      "action_required.requested_capabilities",
      { disabled_reason: "action_required.requested_capabilities", currently_due: [], past_due: [] },
    ],
    ["under_review", { disabled_reason: "under_review", currently_due: [], past_due: [] }],
    ["rejected.other", { disabled_reason: "rejected.other", currently_due: [], past_due: [] }],
    [
      "pending_verification WITH a real currently_due",
      {
        disabled_reason: "requirements.pending_verification",
        currently_due: ["external_account"],
        past_due: [],
        eventually_due: [],
        pending_verification: ["business_profile.url"],
      },
    ],
    [
      "no disabled_reason but a non-empty currently_due",
      { disabled_reason: null, currently_due: ["company.tax_id"], past_due: [] },
    ],
  ];

  it.each(stillNotifies)("%s still counts as due", (_label, requirements) => {
    expect(requirementsHasDue(requirements)).toBe(true);
  });
});

describe("#3272 eventually_due is ignored for a pending account", () => {
  it("goes quiet when only eventually_due is populated", () => {
    // Mirrors the client, which checks currently_due/past_due only. A future
    // requirement is not something the seller can act on today.
    expect(
      requirementsHasDue({
        disabled_reason: "requirements.pending_verification",
        currently_due: [],
        past_due: [],
        eventually_due: ["company.tax_id"],
        pending_verification: ["business_profile.url"],
      }),
    ).toBe(false);
  });
});

/**
 * PARITY. The edge predicate is a deliberate second copy of the client one —
 * the Deno runtime cannot import the React Native module. This matrix is what
 * keeps the two from drifting: both are executed for real over the same
 * shapes and must agree on every one.
 */
describe("#3272 edge/client predicate parity", () => {
  const matrix: Array<[string, RequirementsShape]> = [
    ["prod pending_verification (Lantern Room)", PROD_PENDING_VERIFICATION],
    ["prod past_due (bxbrim, 15 currently_due)", PROD_PAST_DUE],
    [
      "pending_verification + currently_due",
      { disabled_reason: "requirements.pending_verification", currently_due: ["external_account"], past_due: [] },
    ],
    [
      "pending_verification + past_due entries",
      { disabled_reason: "requirements.pending_verification", currently_due: [], past_due: ["tos_acceptance.date"] },
    ],
    [
      "pending_verification + eventually_due only",
      {
        disabled_reason: "requirements.pending_verification",
        currently_due: [],
        past_due: [],
        eventually_due: ["company.tax_id"],
      },
    ],
    [
      "pending_verification with the arrays absent entirely",
      { disabled_reason: "requirements.pending_verification" },
    ],
    [
      "pending_verification with null arrays",
      { disabled_reason: "requirements.pending_verification", currently_due: null, past_due: null },
    ],
    ["under_review", { disabled_reason: "under_review", currently_due: [], past_due: [] }],
    ["rejected.fraud", { disabled_reason: "rejected.fraud", currently_due: [], past_due: [] }],
    ["action_required.requested_capabilities", { disabled_reason: "action_required.requested_capabilities" }],
    ["no disabled_reason, nothing due", { disabled_reason: null, currently_due: [], past_due: [] }],
    ["no disabled_reason, currently_due populated", { currently_due: ["company.tax_id"], past_due: [] }],
    ["empty object", {}],
  ];

  it.each(matrix)("%s — edge and client agree", (_label, requirements) => {
    expect(edgeIsStripePendingVerification(requirements)).toBe(
      clientIsStripePendingVerification(requirements),
    );
  });

  it("agrees on null and undefined too", () => {
    expect(edgeIsStripePendingVerification(null)).toBe(clientIsStripePendingVerification(null));
    expect(edgeIsStripePendingVerification(undefined)).toBe(
      clientIsStripePendingVerification(undefined),
    );
  });

  it("covers at least 8 shapes", () => {
    expect(matrix.length).toBeGreaterThanOrEqual(8);
  });
});
