/**
 * edgeFunctionErrors — the ONE place the shape of a permission denial is defined.
 *
 * #1863 [error-toast-covers-bank-field] §4.5.1. Leaf module: ZERO imports, no
 * React, no Supabase, no side effects — so `src/config/queryClient.ts` can
 * import it at boot without creating a cycle through the service layer.
 *
 * WHY THIS EXISTS. `brand-stripe-refresh-status` and `brand-stripe-balances`
 * both return `403 {error:"forbidden", detail:"permission_denied"}` from
 * `requirePaymentsManager` when the caller's role cannot manage payments. The
 * client used to flatten that into a plain `Error("forbidden: permission_denied")`
 * with no status, so:
 *   - React Query retried it forever (retry:2 × refetchInterval:30_000 →
 *     ~2,650 futile edge invocations in eight idle hours on ONE device), and
 *   - the UI classified it as `failed-network` and told the user to check their
 *     connection, which could never help: their ROLE is the problem.
 *
 * A permission denial is TERMINAL. It is never retried, never classified as a
 * transport failure, and never surfaced with copy that advises checking a
 * connection. See `I-PROPOSED-1863-CLIENT-PAYMENTS-PERMISSION-PARITY` clause B
 * in `docs/INVARIANT_REGISTRY.md`.
 */

/**
 * Thrown by the Stripe service layer when an edge function refuses the caller
 * at its own permission gate (`supabase/functions/_shared/stripeEdgeAuth.ts`
 * `requirePaymentsManager`).
 */
export class EdgeFunctionPermissionDeniedError extends Error {
  readonly code = "permission_denied";
  readonly status = 403;
  readonly functionName: string;
  readonly detail: string | null;

  constructor(functionName: string, detail?: string | null) {
    super(
      `${functionName}: permission denied${
        detail != null && detail.length > 0 ? ` (${detail})` : ""
      }`,
    );
    this.name = "EdgeFunctionPermissionDeniedError";
    this.functionName = functionName;
    this.detail = detail ?? null;
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True for — and ONLY for — a terminal permission denial.
 *
 * 1. an `EdgeFunctionPermissionDeniedError`; OR
 * 2. an object whose `status` or `context.status` is the number 403 — this
 *    clause exists because a raw Supabase `FunctionsHttpError` carries the
 *    status on `context` and nothing else; OR
 * 3. an object whose `code` is `"42501"` — PostgreSQL `insufficient_privilege`
 *    as PostgREST surfaces it. A predicate named "is this a permission denial"
 *    that answered "no" to the database's own permission denial would be a lie
 *    the next hook trips over.
 *
 * Everything else is `false`: a 5xx, a timeout, a malformed payload and a
 * genuine network failure are all still retried exactly as before. That inverse
 * is not optional — swallowing real transport errors would replace one lie with
 * another (SC-8).
 */
export function isPermissionDeniedError(error: unknown): boolean {
  if (error instanceof EdgeFunctionPermissionDeniedError) return true;
  if (!isRecordLike(error)) return false;
  if (error.status === 403) return true;
  const context = error.context;
  if (isRecordLike(context) && context.status === 403) return true;
  if (error.code === "42501") return true;
  return false;
}

// ---------------------------------------------------------------------------
// #3208 — "no usable organiser email"
// ---------------------------------------------------------------------------

/**
 * The code `brand-stripe-onboard` and `partner-stripe-onboard` return (HTTP 422)
 * when neither the brand's contact email nor the session carries a well-formed
 * address (`supabase/functions/_shared/organiserContactEmail.ts`). The server
 * refuses BEFORE contacting Stripe.
 */
export const ORGANISER_EMAIL_REQUIRED_CODE = "organiser_email_required";

/** Which onboarding surface refused — they have different ways out. */
export type OrganiserEmailSurface = "brand" | "partner";

/**
 * Brand: fixable by the organiser. A well-formed brand contact email takes
 * precedence over the session email, so adding one resolves it.
 */
export const BRAND_EMAIL_REQUIRED_TITLE = "Add a contact email first";
export const BRAND_EMAIL_REQUIRED_SUB =
  "Stripe needs an email address for this brand, and we couldn't find a valid one. Add a contact email to your brand details, then set up payments again.";

/**
 * Partner: no brand record to fix, so the only way out is support. Rendered
 * verbatim by `app/partner/earnings.tsx`, which shows the error's message
 * inline — so the message IS the copy.
 */
export const PARTNER_EMAIL_REQUIRED_MESSAGE =
  "We couldn't find a valid email address on your account to give Stripe. Contact support@usemingla.com and we'll sort it out.";

/**
 * TERMINAL, like a permission denial: retrying sends the same session and the
 * same brand record, so it can never succeed. It is NOT a transport failure and
 * must never be shown as one — issue #3208 was exactly that: this code fell
 * through `BrandOnboardView`'s "does the message contain 'stripe'" check into
 * `failed-network` and told the organiser to check their connection.
 */
export class OrganiserEmailRequiredError extends Error {
  readonly code = ORGANISER_EMAIL_REQUIRED_CODE;
  readonly status = 422;
  readonly surface: OrganiserEmailSurface;

  constructor(surface: OrganiserEmailSurface) {
    super(
      surface === "partner"
        ? PARTNER_EMAIL_REQUIRED_MESSAGE
        : BRAND_EMAIL_REQUIRED_SUB,
    );
    this.name = "OrganiserEmailRequiredError";
    this.surface = surface;
  }
}

/**
 * True for an `OrganiserEmailRequiredError`, or any object carrying the exact
 * code — so a payload that bypassed the typed mapping is still recognised.
 * The match is EXACT: a prefix or substring match would swallow unrelated
 * codes that merely start the same way.
 */
export function isOrganiserEmailRequiredError(error: unknown): boolean {
  if (error instanceof OrganiserEmailRequiredError) return true;
  if (!isRecordLike(error)) return false;
  return error.code === ORGANISER_EMAIL_REQUIRED_CODE ||
    error.error === ORGANISER_EMAIL_REQUIRED_CODE;
}
