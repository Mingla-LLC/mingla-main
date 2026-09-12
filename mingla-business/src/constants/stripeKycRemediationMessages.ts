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
    // Issue #3258: was "Check back later", wired to `onResolve` → onboarding.
    // A button that says "later" and navigates NOW is a false affordance
    // (Constitution rule 1), and there is nothing at the other end to do.
    //
    // Setting this to null also fixes a second, quieter lie for free. The
    // yield rule in `pickKycRemediationCode` hands priority to a genuinely due
    // field whenever the disabled_reason's message has no CTA — so
    // `{ disabled_reason: "listed", currently_due: ["external_account"] }`
    // used to resolve to THIS info-severity "no action needed" card while a
    // blocking bank account was actually due, and now resolves to the
    // `external_account` card that asks for it.
    ctaLabel: null,
    severity: "info",
  },
  "under_review": {
    title: "Under review",
    body: "Stripe is reviewing this account. No action needed from you right now.",
    // Issue #3258 — identical reasoning to "listed" above.
    ctaLabel: null,
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
 * Issue #3258 — the pending-verification SENTENCE now lives in its own file.
 *
 * It was authored here, next to the remediation table, which looked tidy and
 * was measurably wrong: `brandStripeUiState.ts` is in the eager boot payload
 * and imports the sentence, so that one edge hoisted this whole ~245-entry
 * table out of the lazily-chunked Payments route and into `__common` — a
 * measured +11,916 B on the boot payload every visitor downloads, 9,718 B of
 * it this file. See the header of `stripePendingVerificationCopy.ts` for the
 * numbers and the reasoning.
 *
 * Re-exported rather than relocated-and-forgotten so that every existing
 * importer of these symbols from THIS path keeps working byte-for-byte; the
 * boot path imports the sibling directly and never reaches `MESSAGES`.
 */
export {
  describeStripePendingVerification,
  getPendingVerificationSubject,
  type PendingVerificationSentenceInput,
} from "./stripePendingVerificationCopy";
