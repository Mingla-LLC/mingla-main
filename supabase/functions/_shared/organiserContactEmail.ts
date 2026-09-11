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
 * Business app offers exactly three ways in (`AuthContext.tsx`): an emailed
 * code (`signInWithOtp({ email })`), Google, and Apple. All three leave a
 * verified email on the auth user — Google always returns one, and Apple
 * returns either the real address or an `@privaterelay.appleid.com` relay
 * address. There is no phone-only path. Production on 2026-09-11: 152 auth
 * users, 0 without an email, 0 malformed. Rule 2 therefore costs no blocking
 * prompt and no new UI. The throw below is a fail-closed backstop; if it ever
 * fires, the caller is told to supply an email rather than being handed a
 * silently wrong one, and the Business app renders dedicated copy for it
 * (issue #3208) rather than a connection error.
 *
 * Apple relay caveat: a relay address is well formed and passes, but Apple
 * only forwards mail from senders registered against Mingla's Sign in with
 * Apple configuration. Unless Stripe's sending domain is registered there,
 * Stripe's mail to such an organiser may bounce. 28 users sign in with a relay
 * address; as of 2026-09-11 none of them owns a brand.
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
