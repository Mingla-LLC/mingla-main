import type { BrandStripeStatus } from "../store/currentBrandStore";
import type { IconName } from "../components/ui/Icon";
import { accent, semantic } from "../constants/designSystem";
import { describeStripePendingVerification } from "../constants/stripeKycRemediationMessages";
import {
  isOrganiserEmailRequiredError,
  isPermissionDeniedError,
} from "./edgeFunctionErrors";
import {
  isStripePendingVerification,
  type StripeRequirementsShape,
} from "./stripeOnboardingOutcome";

export const ACTIVE_STRIPE_BANNER_TITLE = "You're connected to Stripe";

/**
 * Issue #3258 — the Stripe requirements blob as the PRESENTATION layer reads
 * it. `StripeRequirementsShape` already covers the three fields the
 * pending-verification predicate needs; this adds the one field nothing in the
 * client read before: the list of codes Stripe is checking on its own.
 */
export interface BrandStripeRequirementsShape extends StripeRequirementsShape {
  readonly pending_verification?: readonly string[] | null;
}

/**
 * Issue #3258 — what the seller is SHOWN, which is not always what the server
 * DERIVED.
 *
 * `pg_derive_brand_stripe_status()` (and its TS twin
 * `deriveBrandStripeStatus.ts`) map ANY non-empty `requirements.disabled_reason`
 * to `restricted`, ahead of the `charges_enabled` check. That derivation is
 * correct and is NOT changed here: the enum has many other readers (the admin
 * surface, bank-section visibility, danger-zone visibility, balance gating) and
 * every one of them wants "Stripe will not let this account trade yet".
 *
 * But `requirements.pending_verification` with EMPTY `currently_due` and
 * `past_due` means Stripe is checking something it already has. Nothing is
 * required from the seller, so "Action required — your account is limited" with
 * a destructive "Continue verification" button is simply false, and the button
 * drops them back at the start of a form they already completed (Constitution
 * rule 1, dead tap). That is a PRESENTATION bug, so it gets a PRESENTATION
 * type: the derived status, widened by the one case the copy has to split on.
 */
export type BrandStripePresentation = BrandStripeStatus | "pending_verification";

/**
 * The single place the split is decided. Reuses `isStripePendingVerification`
 * from `stripeOnboardingOutcome` — the predicate the onboarding-entry screen
 * has always honoured and the Payments banner never consulted. A second,
 * drifting copy of that rule is exactly how the two surfaces disagreed.
 *
 * Everything that is not "restricted purely because Stripe is still checking"
 * — a real `currently_due`/`past_due` item, `requirements.past_due`, any
 * `rejected.*` — returns the status UNCHANGED and keeps the red treatment.
 */
export function deriveBrandStripePresentation(args: {
  status: BrandStripeStatus;
  /**
   * REQUIRED, not optional-with-a-default. A caller that "forgot" the
   * requirements would silently get the old, wrong answer back — which is the
   * exact bug this function exists to prevent. Pass `null` deliberately when
   * the status query has not resolved.
   */
  requirements: BrandStripeRequirementsShape | null | undefined;
}): BrandStripePresentation {
  if (
    args.status === "restricted" &&
    isStripePendingVerification(args.requirements)
  ) {
    return "pending_verification";
  }
  return args.status;
}

/** The two ViewStates a failed `useBrandStripeStatus` may resolve to. */
export type BrandStripeStatusErrorViewState =
  | "permission-denied"
  | "failed-network";

/**
 * #1863 §4.6 — maps a status-query error to the onboarding ViewState.
 *
 * `BrandOnboardView` used to map ANY `statusQuery.isError` to `failed-network`
 * and tell the user "Check your connection and try again." Their connection was
 * fine; their ROLE was the problem, so they retried forever. Meanwhile the
 * `permission-denied` ViewState existed with a renderer and was DEAD CODE —
 * nothing anywhere set it.
 *
 * Lives here, as a pure exported function, so the classification is executable
 * in a plain node/ts-jest test without mounting anything: the regression suites
 * feed it the REAL error objects the REAL service functions produce, rather
 * than a hand-built fixture that could agree with a broken implementation.
 */
export function mapStripeStatusErrorToViewState(
  error: unknown,
): BrandStripeStatusErrorViewState {
  return isPermissionDeniedError(error) ? "permission-denied" : "failed-network";
}

/** Every ViewState a failed "start onboarding" call may resolve to. */
export type BrandOnboardingStartErrorViewState =
  | "country-locked"
  | "permission-denied"
  | "email-required"
  | "failed-stripe"
  | "failed-network";

/**
 * #3208 — classifies an error thrown by `startBrandStripeOnboarding`.
 *
 * This decision used to live inline in `BrandOnboardView`'s catch, where it
 * could only be tested by mounting the screen. That is how
 * `organiser_email_required` shipped misclassified: it is not a Stripe error
 * (the server refuses before calling Stripe) and its message contained no
 * "stripe", so it fell to the last branch — `failed-network`, "check your
 * connection". Same pure-function treatment #1863 gave the status query, so
 * the regression suites feed it the REAL errors the REAL service throws.
 *
 * ORDER IS LOAD-BEARING:
 *   1. country_locked — a 400-class rule with its own copy; unchanged.
 *   2. permission denied — terminal role boundary; unchanged.
 *   3. email required — MUST precede the substring check, because its copy
 *      legitimately says "Stripe needs an email address" and would otherwise
 *      be shown under a "Stripe couldn't verify" title.
 *   4. anything mentioning Stripe — unchanged heuristic.
 *   5. everything else — treated as transport; unchanged.
 *
 * country_locked is matched on its `code` rather than `instanceof` so this
 * module stays free of the service layer (and its Supabase import); a parity
 * test pins it against the real `BrandStripeCountryLockedError`.
 */
export function classifyBrandOnboardingStartError(
  error: unknown,
): BrandOnboardingStartErrorViewState {
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "country_locked"
  ) {
    return "country-locked";
  }
  if (isPermissionDeniedError(error)) return "permission-denied";
  if (isOrganiserEmailRequiredError(error)) return "email-required";
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("stripe_api_error") || lower.includes("stripe")) {
    return "failed-stripe";
  }
  return "failed-network";
}

export interface BrandProfileStripeBannerCopy {
  title: string;
  sub: string;
}

export interface StripeCountryPickerStateInput {
  stripeAccountId?: string | null;
  status?: BrandStripeStatus | null;
  detailsSubmitted?: boolean | null;
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
}

export function isStripeCountryPickerLocked(
  input: StripeCountryPickerStateInput,
): boolean {
  if (!input.stripeAccountId) return false;
  if (input.status === "active") return true;
  if (input.detailsSubmitted === true) return true;
  if (input.chargesEnabled === true) return true;
  if (input.payoutsEnabled === true) return true;
  return false;
}

export function getStripeCountryLockedCopy(country: string | null): string {
  return `Stripe is connected for ${
    country ?? "this country"
  }. To use a different country or currency, create a new brand.`;
}

export function getStripeCountryReplaceableCopy(country: string): string {
  return `You can still change country because Stripe setup is not complete. We'll create a new Stripe setup for ${country}.`;
}

/**
 * Issue #3258 — takes the PRESENTATION, not the raw derived status, so the
 * brand-profile row stops saying "Action required" at a seller who has
 * nothing to do. Every non-pending input returns byte-identical copy to
 * before. `BrandStripeStatus` is a subtype of `BrandStripePresentation`, so
 * existing single-status callers keep compiling unchanged.
 */
export function getBrandProfileStripeBannerCopy(
  presentation: BrandStripePresentation,
): BrandProfileStripeBannerCopy | null {
  switch (presentation) {
    case "not_connected":
      return {
        title: "Connect your bank to get paid",
        sub: "Get paid for what you sell. Setup takes 5 minutes.",
      };
    case "onboarding":
      return {
        title: "Onboarding submitted — verifying",
        sub: "We'll email you when Stripe finishes verifying your details.",
      };
    case "pending_verification":
      return {
        title: "Onboarding submitted — verifying",
        sub: "Nothing needed from you. We'll email you when Stripe finishes checking your details.",
      };
    case "active":
      return null;
    case "restricted":
      return {
        title: "Action required",
        sub: "Stripe has limited your account. Tap to resolve.",
      };
  }
}

export function getBrandProfileStripeOperationsSub(
  presentation: BrandStripePresentation,
): string {
  switch (presentation) {
    case "not_connected":
      return "Not connected";
    case "onboarding":
      return "Onboarding…";
    case "pending_verification":
      return "Verifying…";
    case "active":
      return "Active";
    case "restricted":
      return "Action required";
  }
}

/**
 * Issue #3258 — the Payments status-banner table.
 *
 * It used to live inline in `BrandPaymentsView.tsx` as
 * `BANNER_CONFIG: Record<BrandStripeStatus, …>`, read by a bare enum lookup
 * (`BANNER_CONFIG[stripeStatus]`) that never consulted `requirements` even
 * though the component already had them in scope. That is the whole of the
 * reported bug, and it was untestable where it sat: `BrandPaymentsView.tsx`
 * pulls expo-web-browser / reanimated / expo-haptics at module scope, none of
 * which the default node+ts-jest runner can parse, so no executable test could
 * ever reach the table.
 *
 * Here it is a pure value in the file whose stated job is exactly this —
 * presentation decisions, executable in a plain jest test without mounting
 * anything. `BrandPaymentsView` imports it and renders it verbatim.
 */
export interface BrandStripeBannerConfig {
  icon: IconName;
  iconColor: string;
  title: string;
  sub: string;
  ctaLabel: string | null;
  ctaVariant: "primary" | "destructive" | null;
  destructive: boolean;
  success?: boolean;
}

/**
 * Fallback sub-copy for the pending-verification banner, used when Stripe
 * named no field. When it DID name one, `resolveBrandStripeBannerConfig`
 * replaces this with the specific sentence.
 */
export const STRIPE_PENDING_VERIFICATION_FALLBACK_SUB =
  "We're reviewing your details. We'll email you when verified.";

export const BRAND_STRIPE_BANNER_CONFIG: Record<
  BrandStripePresentation,
  BrandStripeBannerConfig | null
> = {
  not_connected: {
    icon: "bank",
    iconColor: accent.warm,
    title: "Connect your bank to get paid",
    sub: "Get paid for what you sell. Setup takes 5 minutes.",
    ctaLabel: "Connect bank",
    ctaVariant: "primary",
    destructive: false,
  },
  onboarding: {
    icon: "bank",
    iconColor: accent.warm,
    title: "Onboarding submitted — verifying",
    sub: "We're reviewing your details. We'll email you when verified.",
    ctaLabel: "Finish onboarding",
    ctaVariant: "primary",
    destructive: false,
  },
  // Issue #3258. NOT destructive, and deliberately CTA-less: the seller has
  // already submitted everything, so the only button we could offer would
  // re-open a completed form and return them here — the reported loop.
  pending_verification: {
    icon: "bank",
    iconColor: accent.warm,
    title: "Onboarding submitted — verifying",
    sub: STRIPE_PENDING_VERIFICATION_FALLBACK_SUB,
    ctaLabel: null,
    ctaVariant: null,
    destructive: false,
  },
  active: {
    icon: "check",
    iconColor: semantic.success,
    title: ACTIVE_STRIPE_BANNER_TITLE,
    sub: "Payments are ready for this brand.",
    ctaLabel: null,
    ctaVariant: null,
    destructive: false,
    success: true,
  },
  restricted: {
    icon: "flag", // W-1: alert/info absent in kit; flag = action-needed
    iconColor: semantic.error,
    title: "Action required — your account is limited",
    sub: "We need additional information before you can take payments.",
    ctaLabel: "Continue verification",
    ctaVariant: "destructive",
    destructive: true,
  },
};

export interface BrandStripeBannerInput {
  status: BrandStripeStatus;
  /**
   * REQUIRED for the same reason as `deriveBrandStripePresentation`: the
   * shipped bug was a banner lookup that never consulted this at all, and an
   * optional field lets the next caller re-create it by omission. `null` is an
   * explicit "not loaded yet" and keeps the status-only behaviour.
   */
  requirements: BrandStripeRequirementsShape | null | undefined;
  /**
   * The brand's own public Mingla page (`brandPublicUrl(brand.slug)`), used
   * only to name the URL Stripe is fetching when it is checking the website.
   * Optional: omit it and the sentence still reads.
   */
  brandPublicUrl?: string | null;
}

/**
 * The banner the Payments screen renders. Replaces the bare
 * `BANNER_CONFIG[stripeStatus]` lookup.
 *
 * For pending verification it also names the field Stripe is waiting on —
 * `requirements.pending_verification`, which no client code read before.
 */
export function resolveBrandStripeBannerConfig(
  input: BrandStripeBannerInput,
): BrandStripeBannerConfig | null {
  const presentation = deriveBrandStripePresentation({
    status: input.status,
    requirements: input.requirements,
  });
  const base = BRAND_STRIPE_BANNER_CONFIG[presentation];
  if (base === null) return null;
  if (presentation !== "pending_verification") return base;

  const sentence = describeStripePendingVerification({
    pendingVerification: input.requirements?.pending_verification,
    brandPublicUrl: input.brandPublicUrl,
  });
  return sentence === null ? base : { ...base, sub: sentence };
}
