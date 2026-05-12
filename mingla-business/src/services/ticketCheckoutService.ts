import { supabase } from "./supabase";
import type { BuyerDetails, CartLine, OrderResult } from "../components/checkout/CartContext";

export interface TicketCheckoutCreateInput {
  eventId: string;
  buyer: BuyerDetails;
  lines: CartLine[];
  /**
   * ORCH-0790: discriminator for the checkout surface. "native" (default for
   * backwards compatibility with older mobile builds) creates a PaymentIntent
   * + client_secret for Stripe RN PaymentSheet. "web" creates a hosted Stripe
   * Checkout Session and returns a `hostedCheckoutUrl` for the web buyer to
   * redirect to.
   */
  surface?: "native" | "web";
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
  });

export const getTicketCheckoutStatus = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<TicketCheckoutStatusResult> =>
  invokeOrThrow<TicketCheckoutStatusResult>("ticket-checkout-status", {
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
