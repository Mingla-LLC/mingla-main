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
