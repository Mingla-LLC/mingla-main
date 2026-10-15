/**
 * #3859 — explicit consent-scope normalization.
 *
 * Existing callers omit `scopes` and retain the legacy bundled grant. Checkout
 * callers can explicitly request only the transactional record once their UI
 * separates mandatory purchase acceptance from optional marketing consent.
 */

export const CONSENT_SCOPES = ["transactional", "marketing"] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

const ALLOWED_CONSENT_SCOPES = new Set<string>(CONSENT_SCOPES);

/**
 * `undefined` preserves the existing bundled behavior. An explicit value must
 * be a non-empty array containing only known scopes; duplicates are collapsed
 * in canonical order. Invalid input fails closed with `null`.
 */
export function resolveConsentScopes(raw: unknown): ConsentScope[] | null {
  if (raw === undefined) return [...CONSENT_SCOPES];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (
    raw.some(
      (scope) =>
        typeof scope !== "string" || !ALLOWED_CONSENT_SCOPES.has(scope),
    )
  ) {
    return null;
  }

  const requested = new Set(raw as ConsentScope[]);
  return CONSENT_SCOPES.filter((scope) => requested.has(scope));
}
