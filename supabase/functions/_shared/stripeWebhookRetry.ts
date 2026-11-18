/**
 * Issue #3645 — a Stripe webhook failure that Stripe must redeliver.
 *
 * A handler throws this error when the event is valid but arrived before the
 * row it depends on exists (for example `application_fee.created` landing
 * before the ticket order is finalized). The endpoint answers 503 so Stripe
 * redelivers, until the endpoint's own attempt cap is reached.
 *
 * Issue #4420 — every other processing failure is now classified by
 * `classifyStripeWebhookFailure` below: transient and configuration failures
 * also ask Stripe to redeliver; only a permanently invalid event keeps 200.
 * Before #4420 every untyped failure answered 200, so a missing QR pepper or
 * a database blip dropped a paid order's finalize for good.
 */
export class StripeWebhookRetryableError extends Error {
  readonly retryable = true as const;

  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookRetryableError";
  }
}

export function isStripeWebhookRetryableError(err: unknown): boolean {
  return err instanceof StripeWebhookRetryableError ||
    (err instanceof Error && err.name === "StripeWebhookRetryableError");
}

/**
 * I-4420-STRIPE-WEBHOOK-RETRY-CLASSES — what a processing failure means.
 *
 *   transient  a dependency was down or a row was not there yet. Stripe
 *              redelivers (503). This is the DEFAULT for an unrecognised
 *              failure: a redelivery is safe because every handler is
 *              idempotent on replay (payment_webhook_events.stripe_event_id is
 *              unique and a processed event is never routed again; finalize,
 *              refund commit, fee upsert, payout reconcile, transfers and
 *              notifications are keyed), and the endpoint stops after
 *              MAX_WEBHOOK_ATTEMPTS.
 *   config     a server secret or setting is missing (`qr_token_pepper_missing`).
 *              Stripe redelivers (500) so the event lands once the setting is
 *              fixed, instead of being dropped.
 *   permanent  the event itself can never be processed: a required id or
 *              field is absent, or the provider evidence contradicts ours
 *              (those rows are flagged for operator review). 200, because a
 *              redelivery would fail the same way.
 */
export type StripeWebhookFailureClass = "transient" | "config" | "permanent";

const CONFIG_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bqr_token_pepper_missing\b/,
  /\b[a-z_]*_(?:secret|key|pepper)_missing\b/i,
  /\benv var is not set\b/i,
  /\bnot configured\b/i,
];

const PERMANENT_FAILURE_PATTERNS: readonly RegExp[] = [
  // A required id or field is absent from the event payload.
  / missing (?:[a-z_]+\.)?(?:id|currency|fee id|metadata|connected account id|account\.id|canonical charge\.created)\b/i,
  /\bmissing mingla_[a-z_]+ metadata\b/,
  // The provider's evidence contradicts ours, or names no record we own.
  /^source_refund_exact_match_missing$/,
  /^source_identity_missing$/,
  /\bsource_refund_[a-z_]*mismatch\b/,
  /_identity_missing$/,
  /_identity_conflict$/,
  /_evidence_invalid$/,
  /_fee_charge_mismatch$/,
  /^partner_attribution_order_brand_missing$/,
  /^invalid_partner_split_cutover_timestamp$/,
];

export function classifyStripeWebhookFailure(
  err: unknown,
): StripeWebhookFailureClass {
  if (isStripeWebhookRetryableError(err)) return "transient";
  const message = err instanceof Error ? err.message : String(err);
  if (CONFIG_FAILURE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "config";
  }
  if (PERMANENT_FAILURE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "permanent";
  }
  return "transient";
}

/**
 * HTTP status the endpoint answers after routing. A failure Stripe should
 * redeliver, with attempts left, answers 503 (transient) or 500 (config);
 * success, a permanent failure and an exhausted event answer 200.
 */
export function stripeWebhookResponseStatus(opts: {
  processingFailed: boolean;
  retryable: boolean;
  exhausted: boolean;
  config?: boolean;
}): number {
  if (opts.processingFailed && opts.retryable && !opts.exhausted) {
    return opts.config === true ? 500 : 503;
  }
  return 200;
}
