// ORCH-0789/0790 REWORK: sessionStorage persistence for the web Stripe
// Checkout redirect round-trip.
//
// Why this exists: cart context (`CartContext.tsx`) is in-memory React
// state by design ("NO AsyncStorage — cart lifetime = single tab
// session"). The web buyer flow now navigates the buyer away to a
// Stripe-hosted Checkout page; on return Stripe forces a full-page
// reload that wipes cart context. Without persistence, the buyer
// returns with an empty `lines` array and an empty `buyer` object,
// breaking the /confirm summary and forcing a bounce-back-to-cart on
// /payment cancel.
//
// This helper is web-scoped (callers gate on Platform.OS === "web") and
// uses sessionStorage (per-tab, no cross-origin leakage, no GDPR
// implications beyond what the buyer already entered). It is a pure
// data module — no React, no RN imports — so it can be unit-tested in
// the node-env Jest harness.

import type { BuyerDetails, CartLine } from "./CartContext";

export const CHECKOUT_RESUME_STORAGE_PREFIX = "mingla:checkout:";

export interface CheckoutResumePayload {
  checkoutSessionId: string;
  buyerStatusToken: string;
  lines: CartLine[];
  buyer: BuyerDetails;
}

export const checkoutResumeStorageKey = (eventId: string): string =>
  `${CHECKOUT_RESUME_STORAGE_PREFIX}${eventId}`;

const isCartLine = (value: unknown): value is CartLine => {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ticketTypeId === "string" &&
    typeof v.ticketName === "string" &&
    typeof v.quantity === "number" &&
    typeof v.unitPrice === "number" &&
    typeof v.currency === "string" &&
    typeof v.isFree === "boolean"
  );
};

const isBuyerDetails = (value: unknown): value is BuyerDetails => {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.email === "string" &&
    typeof v.phone === "string" &&
    typeof v.marketingOptIn === "boolean"
  );
};

export const isCheckoutResumePayload = (
  value: unknown,
): value is CheckoutResumePayload => {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.checkoutSessionId === "string" &&
    v.checkoutSessionId.length > 0 &&
    typeof v.buyerStatusToken === "string" &&
    v.buyerStatusToken.length > 0 &&
    Array.isArray(v.lines) &&
    v.lines.every(isCartLine) &&
    isBuyerDetails(v.buyer)
  );
};

// Returns the parsed payload, or null if the storage entry is missing,
// malformed, or for a different shape. Safe to call without a try/catch
// at the call site.
export const readCheckoutResumePayload = (
  storage: Storage | undefined,
  eventId: string,
): CheckoutResumePayload | null => {
  if (storage === undefined) return null;
  const raw = storage.getItem(checkoutResumeStorageKey(eventId));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isCheckoutResumePayload(parsed) ? parsed : null;
};

export const writeCheckoutResumePayload = (
  storage: Storage | undefined,
  eventId: string,
  payload: CheckoutResumePayload,
): void => {
  if (storage === undefined) return;
  storage.setItem(checkoutResumeStorageKey(eventId), JSON.stringify(payload));
};

export const clearCheckoutResumePayload = (
  storage: Storage | undefined,
  eventId: string,
): void => {
  if (storage === undefined) return;
  storage.removeItem(checkoutResumeStorageKey(eventId));
};
