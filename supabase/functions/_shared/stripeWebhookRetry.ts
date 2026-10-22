/**
 * Issue #3645 — a Stripe webhook failure that Stripe must redeliver.
 *
 * The stripe-webhook endpoint answers 200 for ordinary processing failures
 * (the row stays `processed=false` for forensics and Stripe does not retry).
 * A handler throws this error only when the event is valid but arrived before
 * the row it depends on exists (for example `application_fee.created` landing
 * before the ticket order is finalized). The endpoint then answers 503 so
 * Stripe redelivers, until the endpoint's own attempt cap is reached.
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
 * HTTP status the endpoint answers after routing. Only a retryable failure
 * that still has attempts left asks Stripe to redeliver (503); everything
 * else keeps the existing 200 contract.
 */
export function stripeWebhookResponseStatus(opts: {
  processingFailed: boolean;
  retryable: boolean;
  exhausted: boolean;
}): number {
  if (opts.processingFailed && opts.retryable && !opts.exhausted) return 503;
  return 200;
}
