/**
 * Issue #3859 — server-only checkout-v2 identity helpers.
 *
 * Keeping these functions separate prevents the business-web client from
 * downloading provider/idempotency code that only the edge function executes.
 */

import {
  type CanonicalCheckoutLine,
  canonicalJson,
  isCheckoutAttemptId,
  TICKET_CHECKOUT_CONTRACT_VERSION,
} from "./ticketCheckoutContract.ts";

export function checkoutV2IdempotencyKey(input: {
  eventId: string;
  checkoutAttemptId: string;
}): string {
  if (
    !isCheckoutAttemptId(input.eventId) ||
    !isCheckoutAttemptId(input.checkoutAttemptId)
  ) {
    throw new Error("checkout_attempt_invalid");
  }
  return `ticket_checkout:v2:${input.eventId}:${input.checkoutAttemptId}`;
}

export function canonicalCheckoutV2FingerprintInput(input: {
  eventId: string;
  checkoutAttemptId: string;
  purchaseTermsAccepted: boolean;
  buyer: {
    userId: string | null;
    name: string;
    email: string;
    phoneE164: string;
    marketingOptIn: boolean;
  };
  providerInput: {
    surface: "native" | "web" | "mobile-web";
  };
  lines: CanonicalCheckoutLine[];
  eventDateId: string | null;
  eventDateIds: readonly string[];
  /** issue #3281 — open-daily start; omit/empty keeps fingerprint identical. */
  bookedStartAt?: string | null;
  /** issue #3281 R2 — block hire end; omit/empty keeps fingerprint identical. */
  bookedEndAt?: string | null;
  /** issue #3281 R2 — group party; omit/non-positive keeps fingerprint identical. */
  partySize?: number | null;
  /** #3872: normalised discount code; absent preserves the v2 fingerprint. */
  discountCode?: string | null;
  intakeFormData: unknown;
  quote: {
    currency: string;
    fullPriceCents: number;
    dueTodayCents: number;
    installmentSchedule: unknown;
  };
}): string {
  const lines = [...input.lines].sort((a, b) =>
    a.ticketTypeId.localeCompare(b.ticketTypeId)
  );
  const intakeFormData = Array.isArray(input.intakeFormData)
    ? [...input.intakeFormData].sort((a, b) =>
      canonicalJson(a).localeCompare(canonicalJson(b))
    )
    : input.intakeFormData;
  const bookedStart = typeof input.bookedStartAt === "string"
    ? input.bookedStartAt.trim()
    : "";
  const bookedEnd = typeof input.bookedEndAt === "string"
    ? input.bookedEndAt.trim()
    : "";
  const party = typeof input.partySize === "number" &&
      Number.isFinite(input.partySize) &&
      input.partySize >= 1
    ? Math.trunc(input.partySize)
    : null;
  const discountCode = typeof input.discountCode === "string"
    ? input.discountCode.trim()
    : "";
  return canonicalJson({
    contractVersion: TICKET_CHECKOUT_CONTRACT_VERSION,
    eventId: input.eventId,
    checkoutAttemptId: input.checkoutAttemptId,
    purchaseTermsAccepted: input.purchaseTermsAccepted,
    buyer: input.buyer,
    providerInput: input.providerInput,
    lines,
    eventDateId: input.eventDateId,
    eventDateIds: [...input.eventDateIds].sort(),
    ...(bookedStart.length > 0 ? { bookedStartAt: bookedStart } : {}),
    ...(bookedEnd.length > 0 ? { bookedEndAt: bookedEnd } : {}),
    ...(party !== null ? { partySize: party } : {}),
    ...(discountCode.length > 0 ? { discountCode } : {}),
    intakeFormData,
    quote: input.quote,
  });
}
