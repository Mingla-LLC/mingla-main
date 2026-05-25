import { supabase } from "./supabase";
import type { BuyerDetails, CartLine, OrderResult } from "../components/checkout/CartContext";

export interface TicketCheckoutCreateInput {
  eventId: string;
  buyer: BuyerDetails;
  lines: CartLine[];
  /**
   * ORCH-0790 / ORCH-0839-B: discriminator for the checkout surface.
   *  - "native" — DEPRECATED in mingla-business as of ORCH-0839-B (2026-05-14).
   *    Older app builds may still send this; the edge function preserves the
   *    PaymentIntent path for backward compat but mingla-business no longer
   *    requests it.
   *  - "web" — web buyer; redirects via window.location.assign to a Stripe-
   *    hosted Checkout Session and returns to https://.../confirm?cs=...
   *  - "mobile-web" — NEW. mingla-business mobile (iOS + Android) buyer; opens
   *    the Stripe-hosted Checkout Session via
   *    expo-web-browser.openAuthSessionAsync and intercepts the
   *    mingla-business:// return-URL custom scheme.
   */
  surface?: "native" | "web" | "mobile-web";
  /**
   * ORCH-0915 — trip checkout buyer choice for tiers that have a payment
   * plan configured. Omitted by legacy callers/event checkout so the edge/RPC
   * keep their backward-compatible "auto" behavior.
   */
  paymentPlanChoice?: "full" | "installments";
  /**
   * ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answers when the
   * trip has intake schemas. One entry per tier in the cart that has a schema
   * with ≥1 required question; the edge function gates HTTP 400
   * `intake_form_required` (with `missing_question_ids`) and HTTP 409
   * `intake_schema_stale` (with `current_schema_version_id`).
   *
   * Shape mirrors `intakeSchemaService.IntakeFormData`:
   *   { ticket_type_id, schema_version_id, answers: {[questionId]: value} }
   *
   * Typed as `unknown[]` here to avoid a service↔service circular import;
   * callers pass typed `IntakeFormData[]`. Omitting is safe for events +
   * trips without schemas.
   */
  intakeFormData?: unknown[];
}

export interface TicketCheckoutRequiresPayment {
  kind: "requires_payment";
  checkoutSessionId: string;
  buyerStatusToken: string;
  totalCents: number;
  currency: string;
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string | null;
}

// ORCH-0790: web buyers redirect to a Stripe-hosted Checkout Session page.
// The host app is expected to assign window.location to hostedCheckoutUrl
// and to persist {checkoutSessionId, buyerStatusToken} to sessionStorage
// before redirect so the confirm screen can resume polling after Stripe's
// success_url returns the buyer to /checkout/{eventId}/confirm.
export interface TicketCheckoutRequiresWebRedirect {
  kind: "requires_web_redirect";
  checkoutSessionId: string;
  buyerStatusToken: string;
  hostedCheckoutUrl: string;
  totalCents: number;
  currency: string;
}

export interface TicketCheckoutFreeCompleted {
  kind: "free_completed";
  orderId: string;
  checkoutSessionId: string;
  buyerStatusToken?: string;
  eventId: string;
  paymentStatus: "paid";
  totalCents: number;
  currency: string;
  /** ORCH-0804 — Stripe Tax amount in cents. 0 on free / door sales and on
   * orders where the brand isn't registered for tax in the buyer's
   * jurisdiction. Source: orders.tax_amount_cents persisted by
   * stripeWebhookRouter.handleCheckoutSessionCompleted from
   * session.total_details.amount_tax. */
  taxAmountCents?: number;
  tickets: OrderResult["tickets"];
  notificationStatus: OrderResult["notificationStatus"];
}

export type TicketCheckoutCreateResult =
  | TicketCheckoutRequiresPayment
  | TicketCheckoutRequiresWebRedirect
  | TicketCheckoutFreeCompleted;

export interface TicketCheckoutStatusResult {
  checkoutSessionId: string;
  status: string;
  order: Omit<TicketCheckoutFreeCompleted, "kind"> | null;
}

/**
 * ORCH-0852 — bulletproof confirmation. Shape mirrors TicketCheckoutStatusResult
 * but `status` is a narrower union surfaced from ticket-checkout-confirm.
 * Reuses the same `order` shape so existing render paths interoperate.
 */
export interface TicketCheckoutConfirmResult {
  checkoutSessionId: string;
  status: "paid" | "pending" | "failed" | "expired";
  order: Omit<TicketCheckoutFreeCompleted, "kind"> | null;
}

export const FINALIZATION_BACKOFF_MS = [1000, 1500, 2000, 3000, 4000, 5000] as const;

const centsFromMajor = (value: number): number => Math.round(value * 100);

const invokeOrThrow = async <T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as T;
};

export const createTicketCheckout = async (
  input: TicketCheckoutCreateInput,
): Promise<TicketCheckoutCreateResult> =>
  invokeOrThrow<TicketCheckoutCreateResult>("ticket-checkout-create", {
    eventId: input.eventId,
    buyer: input.buyer,
    lines: input.lines.map((line) => ({
      ticketTypeId: line.ticketTypeId,
      quantity: line.quantity,
      expectedUnitPriceCents: centsFromMajor(line.unitPrice),
    })),
    // ORCH-0790: omit surface when undefined so the edge function applies its
    // own "native" default — older mobile builds never send this field.
    ...(input.surface !== undefined ? { surface: input.surface } : {}),
    ...(input.paymentPlanChoice !== undefined
      ? { payment_plan_choice: input.paymentPlanChoice }
      : {}),
    // ORCH-0880 [Tr5 Traveler Intake Forms]: forward per-tier intake answers
    // when present. Edge function gates required-question completeness +
    // schema-version freshness per Phase 2 ticket-checkout-create §164-256.
    // Omit when empty so non-intake flows preserve byte-identical request shape.
    ...(input.intakeFormData !== undefined && input.intakeFormData.length > 0
      ? { intake_form_data: input.intakeFormData }
      : {}),
  });

export const getTicketCheckoutStatus = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<TicketCheckoutStatusResult> =>
  invokeOrThrow<TicketCheckoutStatusResult>("ticket-checkout-status", {
    checkoutSessionId,
    buyerStatusToken,
  });

/**
 * ORCH-0852 — synchronous confirmation. Replaces `pollTicketCheckoutStatus`
 * on the buyer's success path. The server calls Stripe directly + invokes
 * the idempotent `biz_ticket_checkout_finalize` RPC so the order is
 * guaranteed to exist (or known-pending/failed) by the time this resolves.
 *
 * Callers should treat:
 *  - status === "paid" + order !== null  → render full order
 *  - status === "pending"                → fall through to a Realtime
 *    subscription on ticket_checkout_sessions.order_id; webhook backup
 *    will eventually populate it.
 *  - status === "failed" | "expired"     → surface error state.
 *  - thrown error                        → treat as transient; fall through
 *    to Realtime; webhook backup will still complete the order.
 */
export const confirmTicketCheckout = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<TicketCheckoutConfirmResult> =>
  invokeOrThrow<TicketCheckoutConfirmResult>("ticket-checkout-confirm", {
    checkoutSessionId,
    buyerStatusToken,
  });

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const pollTicketCheckoutStatus = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
  statusFetcher = getTicketCheckoutStatus,
  waitFor = wait,
): Promise<TicketCheckoutStatusResult | null> => {
  let latest: TicketCheckoutStatusResult | null = null;
  for (const delayMs of FINALIZATION_BACKOFF_MS) {
    latest = await statusFetcher(checkoutSessionId, buyerStatusToken);
    if (latest.order !== null) return latest;
    await waitFor(delayMs);
  }
  latest = await statusFetcher(checkoutSessionId, buyerStatusToken);
  return latest.order !== null ? latest : null;
};

export const resendTicketConfirmation = async (
  orderId: string,
): Promise<void> => {
  await invokeOrThrow("ticket-confirmation-dispatch", { orderId });
};
