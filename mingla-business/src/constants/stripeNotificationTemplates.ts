/**
 * Stripe-triggered notification templates for Mingla Host.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-V (notifications via shared dispatcher) +
 * I-PROPOSED-W (app-type-prefix filtering).
 *
 * Each entry has the same shape across email + push + in-app channels so
 * `notify-dispatch` (supabase/functions/notify-dispatch/index.ts) can render
 * the right channel without knowing the type.
 *
 * Type prefixes:
 *  - `stripe.*` — Mingla Host only (filtered into business app inbox per I-PROPOSED-W)
 *  - `business.*` — Mingla Host only (reserved for non-Stripe business types)
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
      "A few verification steps for {brandName} need completing within 7 days. Without this, payouts will pause. Tap the link below to finish.",
    pushTitle: "Action needed in 7 days",
    pushBody:
      "{brandName} has a verification step due in 7 days. Tap to finish.",
    inAppTitle: "Verification due in 7 days",
    inAppBody:
      "Finish verification for {brandName} to keep payouts running.",
    severity: "warning",
  },
  "stripe.kyc_deadline_warning_3d": {
    type: "stripe.kyc_deadline_warning_3d",
    emailSubject: "Action needed within 3 days for {brandName}",
    emailBody:
      "Verification details for {brandName} are needed in the next 3 days. After that, payouts pause until details are provided.",
    pushTitle: "3 days left for {brandName}",
    pushBody:
      "Verification details due in 3 days. Tap to finish before payouts pause.",
    inAppTitle: "Verification due in 3 days",
    inAppBody:
      "{brandName} payouts will pause if the requested details aren't provided.",
    severity: "warning",
  },
  "stripe.kyc_deadline_warning_1d": {
    type: "stripe.kyc_deadline_warning_1d",
    emailSubject: "Last day — verify {brandName} now",
    emailBody:
      "{brandName} has 24 hours left before payouts pause. Open the verification flow to finish.",
    pushTitle: "24 hours left for {brandName}",
    pushBody:
      "Payouts will pause tomorrow unless you finish verification. Tap to fix now.",
    inAppTitle: "Last day to verify {brandName}",
    inAppBody:
      "Payouts pause in 24 hours. Finish verification to keep them running.",
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
    emailSubject: "{brandName}: bank disconnected",
    emailBody:
      "{brandName} no longer has a connected bank. New payments can't be accepted until you reconnect. Tap to reconnect now.",
    pushTitle: "{brandName} disconnected",
    pushBody:
      "{brandName} can't accept new payments until you reconnect your bank.",
    inAppTitle: "{brandName}: bank disconnected",
    inAppBody:
      "Reconnect to resume payments. Existing payouts already in flight will still complete.",
    severity: "blocking",
  },
  "stripe.bank_verification_required": {
    type: "stripe.bank_verification_required",
    emailSubject: "Verify your bank for {brandName}",
    emailBody:
      "The bank account on file for {brandName} needs verifying before the next payout can be sent. Tap to verify.",
    pushTitle: "Bank verification needed",
    pushBody:
      "{brandName}: confirm your bank account so your next payout can be sent.",
    inAppTitle: "Bank verification required",
    inAppBody:
      "Confirm the bank account on {brandName} so payouts can continue.",
    severity: "warning",
  },
  "stripe.account_restricted": {
    type: "stripe.account_restricted",
    emailSubject: "{brandName} payouts paused",
    emailBody:
      "Payouts are paused on {brandName}. {reason} Tap to resolve.",
    pushTitle: "Payouts paused for {brandName}",
    pushBody: "{reason} Tap to resolve.",
    inAppTitle: "Payouts paused",
    inAppBody:
      "{brandName} payouts are paused. {reason} Resolve to resume.",
    severity: "blocking",
  },
  "stripe.reactivation_complete": {
    type: "stripe.reactivation_complete",
    emailSubject: "{brandName} is back online",
    emailBody:
      "Great news — {brandName} can accept payments again. Verification is complete.",
    pushTitle: "{brandName} reactivated",
    pushBody: "Verification cleared — payments are back on.",
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

