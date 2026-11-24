import { dispatchNotification } from "./stripeEdgeAuth.ts";

export interface OrderRefundWebhookOutcome {
  status: "matched" | "unmatched" | "mismatched";
  reason?: string | null;
  order_id?: string;
  buyer_correction?: Record<string, unknown> | null;
}

export function orderRefundInboxFields(
  outcome: OrderRefundWebhookOutcome,
  providerRefundId: string,
) {
  const review = outcome.status !== "matched" ||
    outcome.reason === "provider_refund_failed";
  return {
    provider_refund_id: providerRefundId || null,
    match_status: outcome.status,
    match_reason_code: outcome.reason ?? null,
    matched_at: outcome.status === "matched" ? new Date().toISOString() : null,
    first_response_due_at: review
      ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      : null,
  };
}

export async function alertOrderRefundException(
  provider: "stripe" | "paystack",
  providerRefundId: string,
  outcome: OrderRefundWebhookOutcome,
) {
  if (
    !providerRefundId ||
    (outcome.status === "matched" &&
      outcome.reason !== "provider_refund_failed")
  ) return;
  await dispatchNotification({
    emailTo: "ops@mingla.app",
    emailVariant: "generic_notification",
    type: "ops.order_refund_provider_exception",
    title: "Refund needs attention",
    body: "Review the provider refund in Admin → Money → Refund Operations.",
    data: { provider, providerRefundId, reason: outcome.reason },
    relatedType: "refund",
    idempotencyKey: `order-refund-exception:${provider}:${providerRefundId}:${
      outcome.reason ?? outcome.status
    }`,
  });
}
