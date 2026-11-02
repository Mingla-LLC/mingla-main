/**
 * Issue #3859 — server-only checkout-v2 identity helpers.
 *
 * Keeping these functions separate prevents the business-web client from
 * downloading provider/idempotency code that only the edge function executes.
 */

import {
  type CanonicalCheckoutLine,
  canonicalJson,
  type CheckoutAddOnRequest,
  type CheckoutV2LineParseResult,
  isCheckoutAttemptId,
  normalizeCheckoutV2Lines,
  TICKET_CHECKOUT_CONTRACT_VERSION,
} from "./ticketCheckoutContract.ts";

/**
 * issue #3281 — v2 lines for the edge function. The map, not a stale scalar,
 * owns an uneven line's total, so zero dates drop out and quantity is derived.
 * This stays server-only to keep the check out of the eager web payload.
 */
export function normalizeCheckoutV2ServerLines(
  value: unknown,
): CheckoutV2LineParseResult {
  const parsed = normalizeCheckoutV2Lines(value);
  if (!parsed.ok) return parsed;
  const invalid = { ok: false, error: "checkout_lines_invalid" } as const;
  // The shared parser proved every row is an object with a unique ticket id.
  const requested = new Map(
    (value as Array<{ ticketTypeId: string; byDate?: unknown }>).map(
      (row) => [row.ticketTypeId, row.byDate],
    ),
  );
  const requestedAddOns = new Map(
    (value as Array<{ ticketTypeId: string; addOns?: unknown }>).map(
      (row) => [row.ticketTypeId, row.addOns],
    ),
  );
  const lines = [];
  for (const parsedLine of parsed.lines) {
    // issue #3281 — extras ride their ticket's line. The shape is checked
    // here; the database prices them and refuses anything it can't sell.
    const addOns = normalizeAddOns(
      requestedAddOns.get(parsedLine.ticketTypeId),
    );
    if (addOns === "invalid") return invalid;
    const line = addOns === null ? parsedLine : { ...parsedLine, addOns };
    const map = requested.get(line.ticketTypeId);
    if (map === undefined) {
      lines.push(line);
      continue;
    }
    if (map === null || typeof map !== "object" || Array.isArray(map)) {
      return invalid;
    }
    const byDate: Record<string, number> = {};
    let quantity = 0;
    for (const [dateId, count] of Object.entries(map)) {
      if (
        !isCheckoutAttemptId(dateId) || !Number.isInteger(count) ||
        Number(count) < 0 || Number(count) > 100_000
      ) {
        return invalid;
      }
      if (Number(count) > 0) byDate[dateId] = Number(count);
      quantity += Number(count);
    }
    if (quantity < 1 || quantity > 100_000) return invalid;
    lines.push({ ...line, quantity, byDate });
  }
  return { ok: true, lines };
}

/**
 * issue #3281 — extras requested on one line: absent or empty is no extras;
 * otherwise each is a unique uuid with a whole quantity, sorted by id so the
 * attempt fingerprint doesn't depend on the order the buyer picked them.
 */
function normalizeAddOns(
  value: unknown,
): CheckoutAddOnRequest[] | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 50) return "invalid";
  const seen = new Set<string>();
  const addOns: CheckoutAddOnRequest[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return "invalid";
    const { addOnId, quantity } = entry as Record<string, unknown>;
    if (
      typeof addOnId !== "string" || !isCheckoutAttemptId(addOnId) ||
      seen.has(addOnId) || !Number.isInteger(quantity) ||
      Number(quantity) < 1 || Number(quantity) > 100_000
    ) {
      return "invalid";
    }
    seen.add(addOnId);
    addOns.push({ addOnId, quantity: Number(quantity) });
  }
  if (addOns.length === 0) return null;
  return addOns.sort((a, b) => a.addOnId.localeCompare(b.addOnId));
}

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
