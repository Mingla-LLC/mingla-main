/**
 * brandContactEmail — the single owner of "is this brand contact email
 * acceptable to save".
 *
 * Issue #3191 added the rule; issue #3208 moved it here from an inline regex in
 * `BrandEditView` so it is executable in a plain node/ts-jest test and so the
 * copy has one owner.
 *
 * The field is OPTIONAL: blank saves. Anything non-blank must be a well-formed
 * address, because it is rendered as a `mailto:` chip on the public brand page
 * — where a street address is a dead link — and it is the first address payout
 * onboarding offers a provider (`supabase/functions/_shared/organiserContactEmail.ts`
 * skips a malformed one, but the chip is still broken).
 *
 * The pattern is deliberately byte-identical to the Business sign-in validator
 * (`AuthContext.tsx`) and to the edge function's `ORGANISER_EMAIL_RE`. An
 * address that can sign in must never be refused here, and one refused here
 * must never be sent to Stripe. A parity test pins all three.
 */

export const BRAND_CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shown inline under the Contact email field. Names the field's problem and
 * both ways out — including clearing it, since the field is optional.
 */
export const BRAND_CONTACT_EMAIL_INVALID =
  "That doesn't look like an email address. Fix it or clear it to save.";

/**
 * @returns `null` when the value may be saved (blank, whitespace-only, absent,
 *   or a well-formed address after trimming), otherwise the inline error copy.
 *   A non-string is refused rather than coerced: the draft should only ever
 *   hold a string here, so anything else is a bug worth surfacing.
 */
export function validateBrandContactEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return BRAND_CONTACT_EMAIL_INVALID;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return BRAND_CONTACT_EMAIL_RE.test(trimmed) ? null : BRAND_CONTACT_EMAIL_INVALID;
}
