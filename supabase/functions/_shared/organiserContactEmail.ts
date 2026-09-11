/**
 * organiserContactEmail — the single owner of "which email identifies this
 * organiser to a payment provider".
 *
 * Issue #3191. `brands.contact_email` is free text with no validation at any
 * layer (input, mapper, column, edge function), so a brand that had a street
 * address typed into its Contact email box sent that string to Stripe as the
 * connected account's `contact_email`. Stripe rejected it with
 * `Invalid email`, the onboarding screen dead-ended on a retry that could
 * never succeed, and nothing named the field at fault.
 *
 * Two rules, both non-negotiable:
 *
 *  1. A malformed brand-record value must NEVER reach a provider. It is
 *     skipped in favour of the caller's Supabase-verified auth email, so a
 *     bad brand record cannot block payout setup (Seth, 2026-09-10:
 *     "issues with the brand should not have an issue with adding the bank").
 *
 *  2. We NEVER invent an address. The prior fallback registered the literal
 *     `support@usemingla.com` on the organiser's connected account, quietly
 *     routing Stripe's verification and payout mail to Mingla instead of to
 *     the organiser. That fallback is deleted, not relaxed.
 *
 * Enforcement of "a real organiser email" is STRUCTURAL, not a gate. The
 * Business app authenticates by email OTP only (`AuthContext.tsx`,
 * `signInWithOtp({ email })` — there is no phone path), so any caller able to
 * reach an onboarding function necessarily carries a verified email. Rule 2
 * therefore costs no blocking prompt and no new UI. The throw below is a
 * fail-closed backstop for an auth model that does not exist today; if it ever
 * fires, the caller is told to supply an email rather than being handed a
 * silently wrong one.
 */

/**
 * House-style email shape, identical to the validator the Business app already
 * enforces at sign-in (`mingla-business/src/context/AuthContext.tsx`). Kept
 * byte-identical deliberately: an address that can sign in must never be
 * rejected here, and vice versa.
 */
export const ORGANISER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True only for a trimmed, well-formed address. Non-strings are false. */
export function isWellFormedEmail(value: unknown): value is string {
  return typeof value === "string" && ORGANISER_EMAIL_RE.test(value.trim());
}

/**
 * Thrown when neither the brand record nor the verified session yields a
 * usable address. Callers map this to a 422 with an actionable code — never to
 * a provider error, because no provider was contacted.
 */
export class MissingOrganiserEmailError extends Error {
  readonly code = "organiser_email_required";
  constructor() {
    super(
      "No valid organiser email: the brand's contact email is not a " +
        "well-formed address and the session carries no verified email.",
    );
    this.name = "MissingOrganiserEmailError";
  }
}

/**
 * Resolve the address to register with a payment provider.
 *
 * Precedence: a well-formed `brands.contact_email` (the organiser's own
 * deliberate choice) → the verified auth email → throw. A malformed brand
 * value is skipped silently rather than failing, which is what keeps a broken
 * brand record from blocking payout setup.
 *
 * @param brandEmail Raw `brands.contact_email`; any type, may be malformed.
 * @param authEmail  Verified email from the caller's JWT claims, or null.
 * @throws MissingOrganiserEmailError when neither source is well formed.
 */
export function resolveOrganiserContactEmail(
  brandEmail: unknown,
  authEmail: string | null,
): string {
  if (isWellFormedEmail(brandEmail)) return brandEmail.trim();
  if (isWellFormedEmail(authEmail)) return authEmail.trim();
  throw new MissingOrganiserEmailError();
}
