/**
 * Stripe-triggered notification templates for Mingla Business.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-V (notifications via shared dispatcher) +
 * I-PROPOSED-W (app-type-prefix filtering).
 *
 * Each entry has the same shape across email + push + in-app channels so
 * `notify-dispatch` (supabase/functions/notify-dispatch/index.ts) can render
 * the right channel without knowing the type.
 *
 * Type prefixes:
 *  - `stripe.*` — Mingla Business only (filtered into business app inbox per I-PROPOSED-W)
 *  - `business.*` — Mingla Business only (reserved for non-Stripe business types)
 *
 * Variable interpolation: `{key}` placeholders are substituted from the
 * notify-dispatch payload's `vars` object at send time. Missing variables
 * fall back to a sensible literal (e.g., "your account") to avoid showing
 * raw `{key}` strings.
 */

export type StripeNotificationType =
  | "stripe.kyc_deadline_warning_7d"
  | "stripe.kyc_deadline_warning_3d"
  | "stripe.kyc_deadline_warning_1d"
  | "stripe.payout_failed"
  | "stripe.account_deauthorized"
  | "stripe.bank_verification_required"
  | "stripe.account_restricted"
  | "stripe.reactivation_complete"
  | "stripe.refund_processed";

export interface NotificationTemplate {
  readonly type: StripeNotificationType;
  /** Email subject (Resend) */
  readonly emailSubject: string;
  /** Email body in plain English (HTML wrapped at send time) */
  readonly emailBody: string;
  /** Push title (≤30 chars ideally; OneSignal) */
  readonly pushTitle: string;
  /** Push body (≤120 chars ideally) */
  readonly pushBody: string;
  /** In-app inbox title */
  readonly inAppTitle: string;
  /** In-app inbox body */
  readonly inAppBody: string;
  /** Severity affects sort + UI emphasis in the in-app inbox */
  readonly severity: "blocking" | "warning" | "info";
}

export const STRIPE_NOTIFICATION_TEMPLATES: Record<
  StripeNotificationType,
  NotificationTemplate
> = {
  "stripe.kyc_deadline_warning_7d": {
    type: "stripe.kyc_deadline_warning_7d",
    emailSubject: "Action needed within 7 days for {brandName}",
    emailBody:
      "Stripe needs you to complete a few verification steps for {brandName} within 7 days. Without this, payouts will pause. Tap the link below to finish.",
    pushTitle: "Action needed in 7 days",
    pushBody:
      "{brandName} has a Stripe verification step due in 7 days. Tap to finish.",
    inAppTitle: "Verification due in 7 days",
    inAppBody:
      "Finish your Stripe verification for {brandName} to keep payouts running.",
    severity: "warning",
  },
  "stripe.kyc_deadline_warning_3d": {
    type: "stripe.kyc_deadline_warning_3d",
    emailSubject: "Action needed within 3 days for {brandName}",
    emailBody:
      "Stripe needs verification details for {brandName} in the next 3 days. After that, payouts pause until details are provided.",
    pushTitle: "3 days left for {brandName}",
    pushBody:
      "Verification details due in 3 days. Tap to finish before payouts pause.",
    inAppTitle: "Verification due in 3 days",
    inAppBody:
      "{brandName} payouts will pause if Stripe doesn't get the requested details.",
    severity: "warning",
  },
  "stripe.kyc_deadline_warning_1d": {
    type: "stripe.kyc_deadline_warning_1d",
    emailSubject: "Last day — verify {brandName} now",
    emailBody:
      "{brandName} has 24 hours left before Stripe pauses payouts. Open the verification flow to finish.",
    pushTitle: "24 hours left for {brandName}",
    pushBody:
      "Stripe will pause payouts tomorrow unless you finish verification. Tap to fix now.",
    inAppTitle: "Last day to verify {brandName}",
    inAppBody:
      "Stripe pauses payouts in 24 hours. Finish verification to keep them running.",
    severity: "blocking",
  },
  "stripe.payout_failed": {
    type: "stripe.payout_failed",
    emailSubject: "Payout failed for {brandName}",
    emailBody:
      "A payout of {amount} for {brandName} failed. {reason} Tap below to fix the issue.",
    pushTitle: "Payout failed",
    pushBody: "{brandName}: {amount} couldn't be sent. Tap to resolve.",
    inAppTitle: "Payout failed",
    inAppBody:
      "{amount} couldn't reach your bank. {reason} Update your bank details to retry.",
    severity: "blocking",
  },
  "stripe.account_deauthorized": {
    type: "stripe.account_deauthorized",
    emailSubject: "{brandName} disconnected from Stripe",
    emailBody:
      "{brandName} is no longer connected to Stripe. New payments can't be accepted until you reconnect. Tap to reconnect now.",
    pushTitle: "{brandName} disconnected",
    pushBody:
      "{brandName} can't accept new payments until you reconnect to Stripe.",
    inAppTitle: "{brandName} disconnected from Stripe",
    inAppBody:
      "Reconnect to resume payments. Existing payouts already in flight will still complete.",
    severity: "blocking",
  },
  "stripe.bank_verification_required": {
    type: "stripe.bank_verification_required",
    emailSubject: "Verify your bank for {brandName}",
    emailBody:
      "Stripe needs to verify the bank account on file for {brandName} before sending the next payout. Tap to verify.",
    pushTitle: "Bank verification needed",
    pushBody:
      "{brandName}: confirm your bank account so Stripe can send your next payout.",
    inAppTitle: "Bank verification required",
    inAppBody:
      "Confirm the bank account on {brandName} so payouts can continue.",
    severity: "warning",
  },
  "stripe.account_restricted": {
    type: "stripe.account_restricted",
    emailSubject: "{brandName} payouts paused",
    emailBody:
      "Stripe has paused payouts on {brandName}. {reason} Tap to resolve.",
    pushTitle: "Payouts paused for {brandName}",
    pushBody: "{reason} Tap to resolve.",
    inAppTitle: "Payouts paused",
    inAppBody:
      "Stripe paused {brandName} payouts. {reason} Resolve to resume.",
    severity: "blocking",
  },
  "stripe.reactivation_complete": {
    type: "stripe.reactivation_complete",
    emailSubject: "{brandName} is back online",
    emailBody:
      "Great news — {brandName} can accept payments again. Stripe finished verifying everything.",
    pushTitle: "{brandName} reactivated",
    pushBody: "Stripe verification cleared — payments are back on.",
    inAppTitle: "{brandName} is back online",
    inAppBody:
      "Payments and payouts are working again. Nothing more for you to do.",
    severity: "info",
  },
  "stripe.refund_processed": {
    type: "stripe.refund_processed",
    emailSubject: "Refund processed for {brandName}",
    emailBody:
      "A refund of {amount} was processed for {brandName}. {customerNote}",
    pushTitle: "Refund processed",
    pushBody: "{brandName}: {amount} refunded.",
    inAppTitle: "Refund processed",
    inAppBody:
      "{amount} refunded for {brandName}. The customer should see it in 5-10 business days.",
    severity: "info",
  },
};

export const STRIPE_NOTIFICATION_TYPES: readonly StripeNotificationType[] =
  Object.keys(STRIPE_NOTIFICATION_TEMPLATES) as StripeNotificationType[];

/**
 * Render a template field with `{key}` placeholders substituted.
 * Missing keys fall back to "your account" / empty string sensibly.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | undefined> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") {
      // Sensible fallback: never show a raw {key} to a user
      return key === "brandName" ? "your account" : "";
    }
    return String(v);
  });
}
