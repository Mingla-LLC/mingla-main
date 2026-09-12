const FIELD_LABELS: Record<string, string> = {
  "business_profile.mcc": "choose a business category",
  "business_profile.name": "confirm the public business name",
  "business_profile.product_description": "describe what your business sells",
  "business_profile.support_address": "add a customer support address",
  "business_profile.support_email": "add a customer support email",
  "business_profile.support_phone": "add a customer support phone number",
  "business_profile.url": "add a business website or profile URL",
  "company.address.city": "complete the company city",
  "company.address.line1": "complete the company street address",
  "company.address.postal_code": "complete the company postal code",
  "company.address.state": "complete the company state or region",
  "company.directors_provided": "add all required directors",
  "company.executives_provided": "add all required executives",
  "company.name": "confirm the legal company name",
  "company.owners_provided": "add all required owners",
  "company.phone": "add a company phone number",
  "company.tax_id": "add the company tax ID",
  "company.verification.document": "upload a company verification document",
  "external_account": "add or re-verify a payout bank account",
  "individual.address.city": "complete the representative city",
  "individual.address.line1": "complete the representative street address",
  "individual.address.postal_code": "complete the representative postal code",
  "individual.address.state": "complete the representative state or region",
  "individual.dob.day": "add the representative date of birth",
  "individual.dob.month": "add the representative date of birth",
  "individual.dob.year": "add the representative date of birth",
  "individual.email": "add the representative email",
  "individual.first_name": "add the representative first name",
  "individual.id_number": "add the representative ID number",
  "individual.last_name": "add the representative last name",
  "individual.phone": "add the representative phone number",
  "individual.ssn_last_4": "add the representative SSN last 4 digits",
  "individual.verification.document": "upload a representative ID document",
  "individual.verification.additional_document":
    "upload an additional representative document",
  "relationship.director": "confirm director status",
  "relationship.executive": "confirm executive status",
  "relationship.owner": "confirm owner status",
  "tos_acceptance.date": "accept Stripe's terms",
  "tos_acceptance.ip": "accept Stripe's terms from the onboarding flow",
};

const DISABLED_REASON_MESSAGES: Record<string, string> = {
  "action_required.requested_capabilities":
    "Stripe needs more information before card payments or payouts can be enabled.",
  "listed": "Stripe cannot enable this account until a compliance review is complete.",
  "rejected.fraud": "Stripe rejected the account for suspected fraud. Contact Mingla support before retrying.",
  "rejected.listed": "Stripe rejected the account after a compliance list check. Contact Mingla support.",
  "rejected.other": "Stripe rejected the account. Contact Mingla support and we will help review next steps.",
  "rejected.terms_of_service":
    "Stripe rejected the account because its terms were not accepted correctly.",
  "requirements.past_due":
    "Stripe needs overdue information. Payouts may stay paused until this is submitted.",
  "requirements.pending_verification":
    "Stripe is reviewing submitted information. No action is needed unless Stripe asks for more details.",
  "under_review":
    "Stripe is reviewing the account. We will update this status when their review completes.",
};

const PAYOUT_FAILURE_MESSAGES: Record<string, string> = {
  account_closed: "The payout bank account appears to be closed. Add a new bank account in Stripe.",
  account_frozen: "The payout bank account is frozen. Contact your bank or add a different account.",
  bank_account_restricted:
    "The bank account cannot receive this payout. Re-verify or add a different bank account.",
  bank_ownership_changed:
    "Stripe needs the updated bank ownership details before retrying this payout.",
  could_not_process:
    "The bank could not process the payout. Check the bank details and retry from Stripe.",
  debit_not_authorized:
    "The bank rejected the transfer authorization. Re-verify the bank account in Stripe.",
  declined: "The payout was declined by the bank. Check the bank details and contact your bank if needed.",
  insufficient_funds:
    "Stripe could not complete the payout because funds were unavailable at processing time.",
  invalid_account_number:
    "The bank account number is invalid. Update the payout bank account in Stripe.",
  incorrect_account_holder_name:
    "The account holder name does not match the bank record. Update the bank details in Stripe.",
  incorrect_account_holder_tax_id:
    "The tax ID does not match the bank record. Update verification details in Stripe.",
  incorrect_account_type:
    "The bank account type is not supported for payouts. Add a supported account in Stripe.",
  incorrect_routing_number:
    "The routing or sort code is invalid. Update the bank details in Stripe.",
  no_account: "The bank could not find this account. Add a valid payout bank account in Stripe.",
};

export interface KycRemediation {
  disabledReason: string | null;
  disabledReasonMessage: string | null;
  dueFields: string[];
  messages: string[];
  currentDeadline: number | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function getKycRemediationForRequirements(
  requirements: Record<string, unknown> | null | undefined,
): KycRemediation {
  const dueFields = [
    ...asStringArray(requirements?.currently_due),
    ...asStringArray(requirements?.past_due),
    ...asStringArray(requirements?.eventually_due),
  ];
  const disabledReason = typeof requirements?.disabled_reason === "string"
    ? requirements.disabled_reason
    : null;
  const disabledReasonMessage = disabledReason
    ? DISABLED_REASON_MESSAGES[disabledReason] ??
      "Stripe needs additional information before this account can be fully enabled."
    : null;
  const messages = Array.from(
    new Set(
      dueFields.map((field) =>
        FIELD_LABELS[field] ?? field.replaceAll("_", " ").replaceAll(".", " ")
      ),
    ),
  );
  const deadline = Number(requirements?.current_deadline);

  return {
    disabledReason,
    disabledReasonMessage,
    dueFields,
    messages,
    currentDeadline: Number.isFinite(deadline) && deadline > 0 ? deadline : null,
  };
}

/**
 * #3272 — the edge-side copy of the client predicate at
 * `mingla-business/src/utils/stripeOnboardingOutcome.ts` (shipped in PR #3266).
 *
 * This is a DELIBERATE second copy, not an oversight. Two reasons, both hard:
 *
 *  1. The Deno edge runtime cannot import the React Native client module. That
 *     file imports `BrandStripeStatus` from `src/store/currentBrandStore`, which
 *     pulls Zustand and the rest of the app graph — there is no import path from
 *     `supabase/functions/**` to it, and there never will be.
 *  2. This module is the only one of the two edge modules jest can execute. It
 *     has zero imports and never touches the `Deno` global, so
 *     `mingla-business jest (full suite)` — the one required check that runs on
 *     EVERY pull request — can import it directly and run the real function.
 *     `stripeKycReminderSchedule.ts` cannot be imported by jest at all (its
 *     extensioned `./stripeKycRemediation.ts` specifier trips ts-jest TS5097,
 *     and `calculateCronJitterMs` reads `Deno.env`, TS2304). That is why
 *     `requirementsHasDue` was MOVED here in #3272: so the CI-executed
 *     regression test is behavioural, not a source-text grep.
 *
 * Because the copy is deliberate, the parity between the two is itself under
 * test — see `issue_3272_stripe_kyc_reminder_pending_verification.happy.test.ts`,
 * which runs both predicates over a shared state matrix and asserts they agree.
 *
 * Semantics, mirroring the client EXACTLY: `requirements.pending_verification`
 * with nothing `currently_due` and nothing `past_due`. `eventually_due` and
 * `pending_verification` are deliberately IGNORED — neither is something the
 * seller can act on today, and the client ignores them too.
 *
 * Known, accepted divergence: for MALFORMED input (a `currently_due` that is not
 * an array of strings) the client counts `.length` on whatever it was handed
 * while this copy filters to strings first. Stripe never emits that shape; the
 * parity matrix covers the shapes Stripe does emit.
 */
const PENDING_REVIEW_REASONS = new Set([
  "requirements.pending_verification",
]);

function hasDueRequirements(
  requirements: Record<string, unknown> | null | undefined,
): boolean {
  return asStringArray(requirements?.currently_due).length > 0 ||
    asStringArray(requirements?.past_due).length > 0;
}

export function isStripePendingVerification(
  requirements: Record<string, unknown> | null | undefined,
): boolean {
  const disabledReason = requirements?.disabled_reason;
  if (typeof disabledReason !== "string") return false;
  if (!PENDING_REVIEW_REASONS.has(disabledReason)) return false;
  return !hasDueRequirements(requirements);
}

/**
 * #3272 — "does this account owe Stripe anything the seller can act on?"
 *
 * MOVED here from `stripeKycReminderSchedule.ts` (which now re-exports it) so
 * jest can execute it — see the note above. The edge function's import is
 * unchanged.
 */
export function requirementsHasDue(requirements: unknown): boolean {
  const reqs = requirements as Record<string, unknown> | null;
  // #3272: requirements.pending_verification is a disabled_reason that means the
  // OPPOSITE of "due" — Stripe is checking what it already has and the seller has
  // nothing to do. Never nag on it. Mirrors isStripePendingVerification() in
  // mingla-business/src/utils/stripeOnboardingOutcome.ts (PR #3266).
  if (isStripePendingVerification(reqs)) return false;
  const remediation = getKycRemediationForRequirements(reqs);
  return remediation.dueFields.length > 0 || remediation.disabledReason !== null;
}

export function mapPayoutFailureCode(code: unknown): string {
  if (typeof code !== "string" || code.trim() === "") {
    return "Stripe could not complete the payout. Check the payout details in Stripe.";
  }
  return PAYOUT_FAILURE_MESSAGES[code] ??
    "Stripe could not complete the payout. Check the payout details in Stripe.";
}

export const STRIPE_KYC_FIELD_LABELS = FIELD_LABELS;
export const STRIPE_DISABLED_REASON_MESSAGES = DISABLED_REASON_MESSAGES;
export const STRIPE_PAYOUT_FAILURE_MESSAGES = PAYOUT_FAILURE_MESSAGES;
