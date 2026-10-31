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
  /** issue #3281 — event date id → quantity; omit keeps fingerprints identical. */
  byDate?: Record<string, number>;
}

export interface CheckoutClientAttemptInput {
  eventId: string;
  purchaseTermsAccepted: boolean;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn: boolean;
  };
  providerInput: {
    surface: "native" | "web" | "mobile-web";
  };
  /** issue #3827 — rotates the attempt when a private ticket link changes. */
  ticketLinkToken?: string | null;
  lines: CheckoutV2Line[];
  eventDateId: string | null;
  eventDateIds: readonly string[];
  bookedStartAt?: string | null;
  /** issue #3281 R2 — block hire end; omit keeps fingerprint identical. */
  bookedEndAt?: string | null;
  /** issue #3281 R2 — group party size; omit / non-positive keeps identical. */
  partySize?: number | null;
  /** #3872 — normalized code rotates the client attempt identity. */
  discountCode?: string | null;
  intakeFormData: unknown;
}

export interface CheckoutAttemptTracker {
  idFor(input: CheckoutClientAttemptInput): string;
  reset(): void;
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

type CheckoutCrypto = {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(value: T) => T;
};

/** Mint a cryptographically random client attempt id without a new dependency. */
export function createCheckoutAttemptId(
  cryptoValue: CheckoutCrypto | undefined = (globalThis as {
    crypto?: CheckoutCrypto;
  }).crypto,
): string {
  if (typeof cryptoValue?.randomUUID === "function") {
    const value = cryptoValue.randomUUID();
    if (isCheckoutAttemptId(value)) return value;
    throw new Error("checkout_attempt_invalid");
  }
  if (typeof cryptoValue?.getRandomValues !== "function") {
    throw new Error("secure_random_unavailable");
  }
  const bytes = cryptoValue.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

/**
 * issue #3281 — keep only positive date quantities so the map, not a stale
 * scalar, owns the line's total. Returns null for a malformed map.
 */
function normalizeCheckoutV2ByDate(
  value: unknown,
): Record<string, number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const byDate: Record<string, number> = {};
  for (const [dateId, quantity] of Object.entries(value)) {
    if (
      !UUID_PATTERN.test(dateId) || !Number.isInteger(quantity) ||
      Number(quantity) < 0 || Number(quantity) > 100_000
    ) {
      return null;
    }
    if (Number(quantity) > 0) byDate[dateId] = Number(quantity);
  }
  return byDate;
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
    if (row.byDate !== undefined) {
      const byDate = normalizeCheckoutV2ByDate(row.byDate);
      const total = Object.values(byDate ?? {}).reduce((sum, n) => sum + n, 0);
      if (byDate === null || total < 1 || total > 100_000) {
        return { ok: false, error: "checkout_lines_invalid" };
      }
      lines.push({ ticketTypeId, quantity: total, paymentPlanChoice, byDate });
      continue;
    }
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

/**
 * Client-side identity for one logical submission. Server quote/provider truth
 * is deliberately absent; the server binds those authoritative values later.
 */
export function checkoutClientAttemptFingerprint(
  input: CheckoutClientAttemptInput,
): string {
  const parsedLines = normalizeCheckoutV2Lines(input.lines);
  if (!parsedLines.ok || !UUID_PATTERN.test(input.eventId)) {
    throw new Error("checkout_attempt_input_invalid");
  }
  const intakeFormData = Array.isArray(input.intakeFormData)
    ? Array.from(input.intakeFormData).sort((a, b) =>
      canonicalJson(a).localeCompare(canonicalJson(b))
    )
    : input.intakeFormData;
  return canonicalJson({
    contractVersion: TICKET_CHECKOUT_CONTRACT_VERSION,
    eventId: input.eventId,
    purchaseTermsAccepted: input.purchaseTermsAccepted,
    buyer: {
      name: input.buyer.name.trim(),
      email: input.buyer.email.trim().toLowerCase(),
      phone: input.buyer.phone.trim(),
      marketingOptIn: input.buyer.marketingOptIn,
    },
    providerInput: input.providerInput,
    ...(typeof input.ticketLinkToken === "string" && input.ticketLinkToken.length > 0
      ? { ticketLinkToken: input.ticketLinkToken }
      : {}),
    lines: parsedLines.lines,
    eventDateId: input.eventDateId,
    eventDateIds: Array.from(new Set(input.eventDateIds)).sort(),
    ...(input.bookedStartAt !== undefined && input.bookedStartAt !== null &&
        input.bookedStartAt.length > 0
      ? { bookedStartAt: input.bookedStartAt }
      : {}),
    ...(input.bookedEndAt !== undefined && input.bookedEndAt !== null &&
        input.bookedEndAt.length > 0
      ? { bookedEndAt: input.bookedEndAt }
      : {}),
    ...(typeof input.partySize === "number" &&
        Number.isFinite(input.partySize) &&
        input.partySize >= 1
      ? { partySize: Math.trunc(input.partySize) }
      : {}),
    ...(typeof input.discountCode === "string" &&
        input.discountCode.trim().length > 0
      ? { discountCode: input.discountCode.trim().toUpperCase() }
      : {}),
    intakeFormData,
  });
}

/**
 * Retains one UUID while the canonical client input is unchanged and rotates
 * before the next request whenever cart/contact/consent/intake/surface changes.
 */
export function createCheckoutAttemptTracker(
  mintId: () => string = () => createCheckoutAttemptId(),
): CheckoutAttemptTracker {
  let held: { fingerprint: string; id: string } | null = null;
  return {
    idFor(input) {
      const fingerprint = checkoutClientAttemptFingerprint(input);
      if (held?.fingerprint === fingerprint) return held.id;
      const id = mintId();
      if (!isCheckoutAttemptId(id)) throw new Error("checkout_attempt_invalid");
      held = { fingerprint, id };
      return id;
    },
    reset() {
      held = null;
    },
  };
}
