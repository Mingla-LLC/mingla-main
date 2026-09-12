/**
 * KYC remediation copy for Stripe Connect connected accounts.
 *
 * Per B2a Path C V3 SPEC §6 (KYC remediation cards) + investigation Thread 18:
 * Stripe's `requirements.disabled_reason` and `requirements.currently_due`
 * are technical strings (e.g., "requirements.past_due", "individual.id_number").
 * These never go in front of users. This file maps Stripe's enum strings
 * to friendly Mingla copy + an actionable CTA.
 *
 * Coverage: ~30 most common reasons. New reasons surfaced from Stripe in the
 * wild MUST be added here, not papered over with a generic fallback.
 *
 * Used by: BrandStripeKycRemediationCard (Phase 10).
 */

export interface KycRemediationMessage {
  /** Friendly title shown on the card */
  readonly title: string;
  /** Friendly body explaining what's needed */
  readonly body: string;
  /**
   * Label for the primary CTA button, or `null` when there is genuinely
   * nothing for the seller to do.
   *
   * Issue #3258: every CTA on this card is wired to `onResolve`, which
   * re-opens Stripe onboarding. A "Check back later" button that navigates
   * back into a completed form is a dead-tap/false-affordance (Constitution
   * rule 1) — the seller taps it, lands on a form with nothing left to fill
   * in, submits again, and sees the same card. `null` means "render no
   * button at all"; the renderer MUST honour it.
   */
  readonly ctaLabel: string | null;
  /** Severity affects card color + sort order */
  readonly severity: "blocking" | "warning" | "info";
}

const FALLBACK: KycRemediationMessage = {
  title: "More information needed",
  body: "Stripe is asking for more details before payouts can resume. Open the secure onboarding flow to provide them.",
  ctaLabel: "Continue verification",
  severity: "warning",
};

const MESSAGES: Record<string, KycRemediationMessage> = {
  // disabled_reason values
  "requirements.past_due": {
    title: "Verification overdue",
    body: "Stripe has paused your payouts because verification details are past due. Complete them now to restore payouts.",
    ctaLabel: "Resume verification",
    severity: "blocking",
  },
  "requirements.pending_verification": {
    title: "Verification in progress",
    body: "Stripe is reviewing the details you submitted. Nothing is needed from you — we'll email you when it's done.",
    // Issue #3258: was "Check back later", wired to onResolve → onboarding.
    // Nothing is due, so there is nothing to resolve and no button to show.
    ctaLabel: null,
    severity: "info",
  },
  "rejected.fraud": {
    title: "Account verification rejected",
    body: "Stripe could not verify your account due to suspected fraud. Contact Mingla support to discuss next steps.",
    ctaLabel: "Contact support",
    severity: "blocking",
  },
  "rejected.terms_of_service": {
    title: "Terms of service issue",
    body: "Stripe has rejected this account because of a terms-of-service issue. Contact Mingla support to resolve.",
    ctaLabel: "Contact support",
    severity: "blocking",
  },
  "rejected.listed": {
    title: "Account not eligible",
    body: "Stripe cannot accept this account at this time. Contact Mingla support if you believe this is a mistake.",
    ctaLabel: "Contact support",
    severity: "blocking",
  },
  "rejected.other": {
    title: "Account not accepted",
    body: "Stripe cannot enable payments on this account. Contact Mingla support.",
    ctaLabel: "Contact support",
    severity: "blocking",
  },
  "listed": {
    title: "Awaiting Stripe review",
    body: "This account is being checked against compliance lists. We'll let you know when it clears.",
    ctaLabel: "Check back later",
    severity: "info",
  },
  "under_review": {
    title: "Under review",
    body: "Stripe is reviewing this account. No action needed from you right now.",
    ctaLabel: "Check back later",
    severity: "info",
  },
  "platform_paused": {
    title: "Payouts paused",
    body: "Mingla has temporarily paused this account. Contact Mingla support if you need this resolved urgently.",
    ctaLabel: "Contact support",
    severity: "blocking",
  },
  // currently_due item codes (most common)
  "individual.id_number": {
    title: "ID number needed",
    body: "Stripe needs the last 4 digits of the account holder's government ID number to verify identity.",
    ctaLabel: "Provide ID number",
    severity: "blocking",
  },
  "individual.verification.document": {
    title: "ID document needed",
    body: "Upload a clear photo of a government-issued ID (passport, driver's licence, or national ID) to verify the account holder.",
    ctaLabel: "Upload document",
    severity: "blocking",
  },
  "individual.verification.additional_document": {
    title: "Additional document needed",
    body: "Stripe needs one more document to confirm identity. This is often a proof of address (utility bill, bank statement).",
    ctaLabel: "Upload document",
    severity: "blocking",
  },
  "individual.address.line1": {
    title: "Address needed",
    body: "We're missing the account holder's street address. Add it now to keep payouts on track.",
    ctaLabel: "Add address",
    severity: "blocking",
  },
  "individual.dob.day": {
    title: "Date of birth needed",
    body: "Stripe needs the account holder's date of birth to complete verification.",
    ctaLabel: "Add date of birth",
    severity: "blocking",
  },
  "individual.first_name": {
    title: "First name needed",
    body: "Add the account holder's legal first name as it appears on their ID.",
    ctaLabel: "Add name",
    severity: "blocking",
  },
  "individual.last_name": {
    title: "Last name needed",
    body: "Add the account holder's legal last name as it appears on their ID.",
    ctaLabel: "Add name",
    severity: "blocking",
  },
  "individual.email": {
    title: "Email needed",
    body: "Add the account holder's email so Stripe can send verification updates.",
    ctaLabel: "Add email",
    severity: "blocking",
  },
  "individual.phone": {
    title: "Phone number needed",
    body: "Add the account holder's phone number for two-factor verification.",
    ctaLabel: "Add phone",
    severity: "blocking",
  },
  "individual.ssn_last_4": {
    title: "Social security number needed",
    body: "US accounts need the last 4 digits of the account holder's social security number.",
    ctaLabel: "Provide SSN",
    severity: "blocking",
  },
  "company.tax_id": {
    title: "Company tax ID needed",
    body: "Add your business tax ID (EIN in the US, equivalent elsewhere) to verify the company.",
    ctaLabel: "Add tax ID",
    severity: "blocking",
  },
  "company.verification.document": {
    title: "Company document needed",
    body: "Upload a document that verifies your company — articles of incorporation, business licence, or equivalent.",
    ctaLabel: "Upload document",
    severity: "blocking",
  },
  "company.address.line1": {
    title: "Company address needed",
    body: "Add your registered business address.",
    ctaLabel: "Add address",
    severity: "blocking",
  },
  "company.name": {
    title: "Company name needed",
    body: "Add your registered company name as it appears on your incorporation documents.",
    ctaLabel: "Add company name",
    severity: "blocking",
  },
  "external_account": {
    title: "Bank account needed",
    body: "Add a bank account so Stripe knows where to send your payouts.",
    ctaLabel: "Add bank account",
    severity: "blocking",
  },
  "tos_acceptance.date": {
    title: "Accept Stripe terms",
    body: "Accept Stripe's connected account terms of service to enable payouts.",
    ctaLabel: "Accept terms",
    severity: "blocking",
  },
  "tos_acceptance.ip": {
    title: "Accept Stripe terms",
    body: "Accept Stripe's connected account terms of service from the device you're signing up on.",
    ctaLabel: "Accept terms",
    severity: "blocking",
  },
  "business_profile.url": {
    title: "Business URL needed",
    body: "Add your business website URL so Stripe can verify your operations.",
    ctaLabel: "Add URL",
    severity: "warning",
  },
  "business_profile.mcc": {
    title: "Business category needed",
    body: "Pick the merchant category that best describes your business.",
    ctaLabel: "Pick category",
    severity: "warning",
  },
  "business_profile.product_description": {
    title: "Product description needed",
    body: "Add a short description of what your business sells.",
    ctaLabel: "Add description",
    severity: "warning",
  },
  "business_profile.support_email": {
    title: "Support email needed",
    body: "Add a support email customers can reach if they have a question or dispute.",
    ctaLabel: "Add email",
    severity: "warning",
  },
  "business_profile.support_phone": {
    title: "Support phone needed",
    body: "Add a phone number customers can reach for support.",
    ctaLabel: "Add phone",
    severity: "warning",
  },
  "owners.0.verification.document": {
    title: "Owner ID needed",
    body: "Upload a government-issued ID for one of the company owners listed (>=25% ownership).",
    ctaLabel: "Upload owner ID",
    severity: "blocking",
  },
  "directors.0.verification.document": {
    title: "Director ID needed",
    body: "Upload a government-issued ID for a company director.",
    ctaLabel: "Upload director ID",
    severity: "blocking",
  },
  "executives.provided": {
    title: "Executive details needed",
    body: "Confirm at least one executive (CEO, CFO, COO, or equivalent) for the business.",
    ctaLabel: "Add executive",
    severity: "blocking",
  },
};

export function getKycRemediationMessage(code: string): KycRemediationMessage {
  return MESSAGES[code] ?? FALLBACK;
}

export interface KycRemediationRequirementsShape {
  readonly disabled_reason?: string | null;
  readonly currently_due?: readonly string[] | null;
  readonly past_due?: readonly string[] | null;
}

/**
 * Picks the ONE code `BrandStripeKycRemediationCard` renders, in priority
 * order: disabled_reason, then past_due[0], then currently_due[0].
 *
 * Issue #3258 adds one exception, and it exists because of this change rather
 * than despite it. "Stripe is checking something" and "Stripe still needs
 * something" can both be true at once — `requirements.pending_verification`
 * arriving alongside a non-empty currently_due. That message now renders with
 * NO CTA (nothing to do), so letting it keep top priority would show
 * "nothing is needed from you" on an account that genuinely IS blocked, with
 * no way to act from the card.
 *
 * The rule is expressed over the DATA, not over a hardcoded reason string: a
 * disabled_reason whose message has no CTA yields to a genuinely due field.
 * Every actionable reason keeps top priority exactly as before, and an
 * unrecognised reason falls back to an actionable message so it does too.
 *
 * Lives here rather than in the component so it is executable in a plain jest
 * test — the card itself cannot be imported by the default node/ts-jest
 * runner.
 */
export function pickKycRemediationCode(
  requirements: KycRemediationRequirementsShape | null | undefined,
): string | null {
  if (requirements == null) return null;
  const due = requirements.past_due?.[0] ?? requirements.currently_due?.[0] ??
    null;
  const reason = requirements.disabled_reason;
  if (reason != null && reason !== "") {
    if (due !== null && getKycRemediationMessage(reason).ctaLabel === null) {
      return due;
    }
    return reason;
  }
  return due;
}

/**
 * Issue #3258 — `requirements.pending_verification`.
 *
 * Stripe returns this as an array of the SAME field codes as
 * `currently_due` / `past_due`, but it means the opposite thing: Mingla
 * already has the value, Stripe is checking it, and the seller is not being
 * asked for anything. Before this, the client never read the array at all,
 * so a brand stuck on `business_profile.url` was told "Action required" and
 * never told which field Stripe was actually waiting on.
 *
 * The vocabulary below deliberately reuses the nouns already used by
 * `MESSAGES` above and by `supabase/functions/_shared/stripeKycRemediation.ts`
 * (`FIELD_LABELS`) — a third wording set for the same Stripe codes is how
 * copy drifts. These are phrased as OBJECTS of "Stripe is checking …",
 * because nothing here is an instruction to the seller.
 */
const PENDING_VERIFICATION_SUBJECTS: Record<string, string> = {
  "business_profile.url": "your website",
  "business_profile.name": "your public business name",
  "business_profile.mcc": "your business category",
  "business_profile.product_description": "your product description",
  "business_profile.support_address": "your customer support address",
  "business_profile.support_email": "your customer support email",
  "business_profile.support_phone": "your customer support phone number",
  "company.address.city": "your company address",
  "company.address.line1": "your company address",
  "company.address.postal_code": "your company address",
  "company.address.state": "your company address",
  "company.name": "your legal company name",
  "company.phone": "your company phone number",
  "company.tax_id": "your company tax ID",
  "company.verification.document": "the company document you uploaded",
  "external_account": "your payout bank account",
  "individual.address.city": "the address you gave",
  "individual.address.line1": "the address you gave",
  "individual.address.postal_code": "the address you gave",
  "individual.address.state": "the address you gave",
  "individual.dob.day": "the date of birth you gave",
  "individual.dob.month": "the date of birth you gave",
  "individual.dob.year": "the date of birth you gave",
  "individual.email": "the email you gave",
  "individual.first_name": "the name you gave",
  "individual.last_name": "the name you gave",
  "individual.id_number": "the ID number you gave",
  "individual.phone": "the phone number you gave",
  "individual.ssn_last_4": "the social security number you gave",
  "individual.verification.document": "the ID document you uploaded",
  "individual.verification.additional_document":
    "the extra document you uploaded",
  "owners.0.verification.document": "the owner ID you uploaded",
  "directors.0.verification.document": "the director ID you uploaded",
  "tos_acceptance.date": "your acceptance of Stripe's terms",
  "tos_acceptance.ip": "your acceptance of Stripe's terms",
};

/**
 * Humanise a Stripe field code we have no phrasing for, so an unrecognised
 * code still reaches the seller as words instead of `snake.case`. Mirrors the
 * edge-side fallback in `_shared/stripeKycRemediation.ts` exactly.
 */
function humanisePendingCode(code: string): string {
  return code.replace(/_/g, " ").replace(/\./g, " ").trim();
}

/** The object of "Stripe is checking …" for one pending field code. */
export function getPendingVerificationSubject(code: string): string {
  const known = PENDING_VERIFICATION_SUBJECTS[code];
  if (known !== undefined) return known;
  const humanised = humanisePendingCode(code);
  return humanised.length > 0
    ? `the ${humanised} you provided`
    : "the details you provided";
}

export interface PendingVerificationSentenceInput {
  /** `requirements.pending_verification` straight off the Stripe payload. */
  readonly pendingVerification?: readonly string[] | null;
  /**
   * Issue #3258 — `business_profile.url` AS THE CONNECTED ACCOUNT REPORTS IT,
   * threaded up from `brand-stripe-refresh-status`. This is the URL Stripe is
   * actually fetching, so it is the one the sentence must name when it exists.
   *
   * It is not always the brand's Mingla page. Accounts onboarded before the
   * platform began prefilling `defaults.profile.business_url` carry whatever
   * website the seller typed inside Stripe onboarding — for the brand this
   * issue was filed over, a domain whose ports are closed. Naming the Mingla
   * page for such an account would state something false with total
   * confidence (Constitution rule 9), and it would hide the single most
   * useful fact the product could show: Stripe is checking a site that is
   * down. Rendered without the scheme.
   */
  readonly accountBusinessUrl?: string | null;
  /**
   * The brand's own public Mingla page, e.g. `brandPublicUrl(brand.slug)`.
   * The FALLBACK, used only when the account reports no URL of its own.
   * Included in the sentence ONLY when Stripe is checking the website, since
   * that is the one pending field a seller can look at and understand.
   * Rendered without the scheme. Omit it and the sentence still reads.
   */
  readonly brandPublicUrl?: string | null;
}

const stripScheme = (url: string): string =>
  url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

/** First trimmed non-blank candidate, or `null` when every one is absent. */
const firstNonBlank = (
  ...candidates: readonly (string | null | undefined)[]
): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return null;
};

/**
 * One plain-English sentence naming what Stripe is waiting on, or `null` when
 * Stripe named nothing (in which case the caller keeps its generic copy).
 *
 * Never says "Action required" and never asks for anything: by definition a
 * `pending_verification` field is one Mingla already handed over.
 */
export function describeStripePendingVerification(
  input: PendingVerificationSentenceInput,
): string | null {
  const codes = (input.pendingVerification ?? []).filter(
    (code): code is string => typeof code === "string" && code.trim() !== "",
  );
  if (codes.length === 0) return null;

  const first = codes[0] as string;
  let subject = getPendingVerificationSubject(first);

  if (first === "business_profile.url") {
    // Issue #3258 — the account's OWN url first; the brand page only when the
    // account reports none. Order is the whole point: preferring the brand
    // page would name a URL Stripe is not looking at.
    const url = firstNonBlank(input.accountBusinessUrl, input.brandPublicUrl);
    if (url !== null) {
      subject = `${subject} (${stripScheme(url)})`;
    }
  }

  const others = codes.length - 1;
  if (others > 0) {
    return `Stripe is checking ${subject} and ${others} other ${
      others === 1 ? "detail" : "details"
    }. Nothing to do — we'll email you when everything is verified.`;
  }
  return `Stripe is checking ${subject}. Nothing to do — we'll email you when it's verified.`;
}
