/**
 * Issue #3859 — pure checkout-v2 request and fingerprint contract.
 *
 * Version 1 remains owned by the existing scalar checkout path. Version 2 is
 * deliberately opt-in and fail-closed: every line carries its own plan choice,
 * duplicate/unknown/malformed lines are refused, and array order never changes
 * the canonical identity of a cart.
 */

export const TICKET_CHECKOUT_CONTRACT_VERSION = 2 as const;

export type CheckoutLinePlanChoice = "full" | "installments";

export interface CheckoutV2Line {
  ticketTypeId: string;
  quantity: number;
  paymentPlanChoice: CheckoutLinePlanChoice;
}

export interface CanonicalCheckoutLine extends CheckoutV2Line {
  unitPriceCents: number;
  totalCents: number;
}

export type CheckoutV2LineParseResult =
  | { ok: true; lines: CheckoutV2Line[] }
  | { ok: false; error: "checkout_lines_invalid" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCheckoutAttemptId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeCheckoutV2Lines(
  value: unknown,
): CheckoutV2LineParseResult {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return { ok: false, error: "checkout_lines_invalid" };
  }

  const seen = new Set<string>();
  const lines: CheckoutV2Line[] = [];
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object") {
      return { ok: false, error: "checkout_lines_invalid" };
    }
    const row = candidate as Record<string, unknown>;
    const ticketTypeId = row.ticketTypeId;
    const quantity = row.quantity;
    const paymentPlanChoice = row.paymentPlanChoice;
    if (
      typeof ticketTypeId !== "string" || !UUID_PATTERN.test(ticketTypeId) ||
      !Number.isInteger(quantity) || Number(quantity) < 1 ||
      Number(quantity) > 100_000 ||
      (paymentPlanChoice !== "full" && paymentPlanChoice !== "installments") ||
      seen.has(ticketTypeId)
    ) {
      return { ok: false, error: "checkout_lines_invalid" };
    }
    seen.add(ticketTypeId);
    lines.push({
      ticketTypeId,
      quantity: Number(quantity),
      paymentPlanChoice,
    });
  }

  lines.sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
  return { ok: true, lines };
}

/** Stable JSON without accepting undefined, functions, or non-finite numbers. */
export function canonicalJson(value: unknown): string {
  const visit = (candidate: unknown): unknown => {
    if (
      candidate === null || typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new Error("checkout_fingerprint_invalid");
      }
      return candidate;
    }
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) {
          throw new Error("checkout_fingerprint_invalid");
        }
        normalized[key] = visit(record[key]);
      }
      return normalized;
    }
    throw new Error("checkout_fingerprint_invalid");
  };
  return JSON.stringify(visit(value));
}

export function checkoutV2IdempotencyKey(input: {
  eventId: string;
  checkoutAttemptId: string;
}): string {
  if (
    !UUID_PATTERN.test(input.eventId) ||
    !isCheckoutAttemptId(input.checkoutAttemptId)
  ) {
    throw new Error("checkout_attempt_invalid");
  }
  return `ticket_checkout:v2:${input.eventId}:${input.checkoutAttemptId}`;
}

export function canonicalCheckoutV2FingerprintInput(input: {
  eventId: string;
  checkoutAttemptId: string;
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
  return canonicalJson({
    contractVersion: TICKET_CHECKOUT_CONTRACT_VERSION,
    eventId: input.eventId,
    checkoutAttemptId: input.checkoutAttemptId,
    buyer: input.buyer,
    providerInput: input.providerInput,
    lines,
    eventDateId: input.eventDateId,
    eventDateIds: [...input.eventDateIds].sort(),
    intakeFormData,
    quote: input.quote,
  });
}
