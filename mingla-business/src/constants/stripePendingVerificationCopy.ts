/**
 * Issue #3258 — the "Stripe is checking …" sentence, and NOTHING else.
 *
 * WHY THIS IS ITS OWN FILE (read before folding it back into
 * `stripeKycRemediationMessages.ts`, which is where it first shipped).
 *
 * Those are two different concerns with two different lifetimes, and they are
 * reached from two different places in the app:
 *
 *   - `stripeKycRemediationMessages.ts` is a ~245-entry REMEDIATION table —
 *     one title/body/CTA per Stripe requirement code, for the seller to ACT
 *     on. Its only renderer is `BrandStripeKycRemediationCard`, a leaf of the
 *     Payments route, which is lazily chunked.
 *   - This file is one SENTENCE about a field nobody has to act on, and it is
 *     reached from `brandStripeUiState.ts` — which the brand-profile route
 *     imports, so it is in the eager boot payload every visitor downloads
 *     before anything renders.
 *
 * When the sentence lived in the remediation file, that single import edge
 * dragged the whole remediation table out of the lazy Payments chunk and into
 * the eager `__common` chunk: measured, `__common` 2,446,440 B → 2,458,356 B
 * (+11,916 B) with `src/constants/stripeKycRemediationMessages.ts` newly
 * accounting for 9,718 B of it, while the Payments route chunk shrank by
 * 7,510 B. That tripped the boot-payload gate
 * (`scripts/ci/orch-1083-initial-bundle-budget.mjs`, 12,000 B per-PR
 * allowance) — correctly: a lazy leaf's table had been moved onto the boot
 * path for every visitor, including anonymous buyers who will never see a
 * KYC card.
 *
 * So this is NOT a cohesive module split to dodge that gate (issue #1509
 * rejects that by default). The gate caught a real eager-path regression and
 * this is the regression's actual cure: the boot path now carries the one
 * sentence it uses, and the remediation table goes back to being loaded only
 * by the screen that renders it.
 *
 * `stripeKycRemediationMessages.ts` re-exports everything below, so every
 * existing importer of these symbols from that path is unchanged.
 */

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
   * A caller-supplied fallback page, used only when the account reports no
   * URL of its own, and only when Stripe is checking the website. Rendered
   * without the scheme. Omit it and the sentence still reads.
   *
   * NO PRODUCTION CALLER PASSES THIS — see the matching note on
   * `BrandStripeBannerInput.brandPublicUrl` in `utils/brandStripeUiState.ts`
   * for why the Payments screen stopped guessing the brand's Mingla page.
   * Kept because it is the honest shape of the preference order, and because
   * the #3258 suites exercise this branch directly.
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
