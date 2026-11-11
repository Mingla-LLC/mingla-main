/**
 * #4389 — pure helpers for the brand setup "Get paid" step (no I/O).
 *
 * - `deterministicCreateIdempotencyKey`: the Stripe account-create key is
 *   seeded by brand + operation only (no clock), so two devices tapping
 *   "Continue to secure setup" at once get the same account (R-4).
 * - `deriveStripeSetupState`: the F4 state from a live account read (R-5).
 * - `stripeDueLabels`: host-facing words for Stripe requirement codes. Host
 *   copy never names the payment partner (#3645).
 * - `decideOnboardCountry`: the account country comes from
 *   `brands.payout_country`, never the request body (I-4389-COUNTRY-ONE-TRUTH).
 */

export type StripeSetupState = "submitted" | "action_needed" | "not_started";

export interface StripeRequirementsLike {
  currently_due?: unknown;
  past_due?: unknown;
}

export interface StripeAccountLike {
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  requirements?: StripeRequirementsLike | null;
}

export function deterministicCreateIdempotencyKey(
  brandId: string,
  operation: string,
): string {
  const id = brandId.trim();
  if (id.length === 0) throw new Error("deterministicCreateIdempotencyKey: brandId required");
  return `${id}:${operation}:issue4389`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}

export function dueRequirementCodes(account: StripeAccountLike | null): string[] {
  if (!account?.requirements) return [];
  return [
    ...stringList(account.requirements.currently_due),
    ...stringList(account.requirements.past_due),
  ];
}

export function deriveStripeSetupState(account: StripeAccountLike | null): StripeSetupState {
  if (account === null) return "not_started";
  if (account.charges_enabled === true) return "submitted";
  const due = dueRequirementCodes(account);
  if (account.details_submitted !== true) {
    return due.length === 0 ? "submitted" : "not_started";
  }
  return due.length === 0 ? "submitted" : "action_needed";
}

const LABEL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/verification\.(additional_)?document/, "A photo of your ID"],
  [/\.dob(\.|$)/, "Your date of birth"],
  [/(id_number|ssn_last_4)/, "Your ID number"],
  [/^(individual|representative)\.address/, "Your home address"],
  [/^company\.address/, "Your registered address"],
  [/^company\.tax_id/, "Your tax ID"],
  [/^company\.(name|structure)/, "Your registered name"],
  [/^(external_account|bank_account)/, "Your bank account"],
  [/^business_profile\.url/, "Your website"],
  [/^business_profile\.(mcc|product_description)/, "What you sell"],
  [/^tos_acceptance/, "Accept the payment terms"],
  [/^(individual|representative)\.(phone|email)/, "Your phone or email"],
  [/^(individual|representative)\.(first_name|last_name)/, "Your full name"],
  [/^(owners|directors|executives|representative)/, "Details of the people who run it"],
];

export function stripeDueLabels(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    const hit = LABEL_RULES.find(([re]) => re.test(code));
    const label = hit ? hit[1] : "A few more details";
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export type OnboardCountryDecision =
  | { kind: "use"; country: string; persist: boolean }
  | { kind: "mismatch"; expected: string }
  | { kind: "required" };

/**
 * `storedRaw` is `brands.payout_country`; `storedStripe` is it normalised to a
 * Stripe country (null for NG or anything unsupported); `bodyCountry` is the
 * normalised request body country (null when absent).
 */
export function decideOnboardCountry(
  storedRaw: string | null,
  storedStripe: string | null,
  bodyCountry: string | null,
): OnboardCountryDecision {
  if (storedRaw !== null) {
    if (storedStripe === null) return { kind: "mismatch", expected: storedRaw };
    if (bodyCountry !== null && bodyCountry !== storedStripe) {
      return { kind: "mismatch", expected: storedStripe };
    }
    return { kind: "use", country: storedStripe, persist: false };
  }
  // Legacy brand (no stored country) on an old build: adopt the body country
  // through the derive trigger, then continue.
  if (bodyCountry === null) return { kind: "required" };
  return { kind: "use", country: bodyCountry, persist: true };
}

/** Maps a `issue_4389_begin_payments_setup_internal` refusal to a code. */
export function beginErrorCode(message: string | undefined | null): string {
  const m = message ?? "";
  for (const code of [
    "requires_owner",
    "payout_country_required",
    "terms_required",
    "brand_not_found",
  ]) {
    if (m.includes(code)) return code;
  }
  return "internal_error";
}
