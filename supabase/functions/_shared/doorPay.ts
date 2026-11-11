// Issue #4271 — shared rules for taking card money at the door (pay code and
// Tap to Pay). Pure helpers only, so both edge functions and their tests share
// one owner of the code alphabet, the pay URL, the money math and the error
// vocabulary the Business app reads.

import {
  computeBuyerSubtotal,
  computeConfigVat,
  MINGLA_SERVICE_FEE_BPS,
  type PricingRegion,
  type PricingSwitches,
  taxBehaviorForRegion,
} from "./allInPricingEngine.ts";
import { BRAND_SETUP_INCOMPLETE } from "./vatCountryGuard.ts";

/** No 0/O, 1/I/L: a guest may read the code aloud or type it. */
export const DOOR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DOOR_CODE_LENGTH = 8;
export const DOOR_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
export const DOOR_CODE_TTL_MS = 10 * 60 * 1000;
export const DOOR_TEXT_LINK_LIMIT = 3;

export type DoorPayCodeStatus =
  | "open"
  | "opened"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";

export type DoorPayErrorCode =
  | "door_access_denied"
  | "door_ticket_capacity_exceeded"
  | "ticket_not_valid_on_chosen_days"
  | "stripe_account_not_ready"
  | "door_tax_added_at_checkout"
  | "invalid_lines"
  | "not_found"
  | "door_code_unavailable"
  | "tap_not_available"
  | "payment_not_succeeded"
  | "offline_pin_required"
  | "text_link_limit_reached"
  | "buyer_phone_invalid"
  | "invalid_request"
  | "server_error";

/** Unbiased: 256 is not a multiple of 31, so out-of-range bytes are skipped. */
export function generateDoorCode(
  randomBytes: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 256 - (256 % DOOR_CODE_ALPHABET.length);
  let out = "";
  while (out.length < DOOR_CODE_LENGTH) {
    for (const byte of randomBytes(DOOR_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += DOOR_CODE_ALPHABET[byte % DOOR_CODE_ALPHABET.length];
      if (out.length === DOOR_CODE_LENGTH) break;
    }
  }
  return out;
}

/** A pay link, never a ticket credential. */
export function makeDoorPayUrl(origin: string, code: string): string {
  if (!DOOR_CODE_RE.test(code)) throw new Error("door_code_invalid");
  return `${origin.replace(/\/+$/, "")}/pay/door/${code}`;
}

export function doorPayReturnUrl(origin: string, code: string): string {
  return `${makeDoorPayUrl(origin, code)}?paid=1`;
}

/** "expired" is derived: an open code past its time reads as expired. */
export function effectiveDoorCodeStatus(
  status: string,
  expiresAt: string,
  nowMs: number = Date.now(),
): DoorPayCodeStatus {
  const s = status as DoorPayCodeStatus;
  if ((s === "open" || s === "opened") && Date.parse(expiresAt) <= nowMs) {
    return "expired";
  }
  return s;
}

export interface DoorLineInput {
  ticketTypeId: string;
  quantity: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check only; the server prices and validates the tiers. */
export function parseDoorLines(raw: unknown): DoorLineInput[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) return null;
  const seen = new Set<string>();
  const out: DoorLineInput[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const id = rec.ticketTypeId;
    const qty = rec.quantity;
    if (typeof id !== "string" || !UUID_RE.test(id) || seen.has(id)) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return null;
    }
    seen.add(id);
    out.push({ ticketTypeId: id, quantity: qty });
  }
  return out;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface DoorPricingRow {
  pass_tax: boolean;
  pass_mingla_fee: boolean;
  pass_service_fee: boolean;
  pricing_region: string | null;
  pricing_currency: string | null;
  effective_take_rate_bps: number;
  take_rate_source: string | null;
  vat_rate_bps: number | null;
  /** #4389 — from resolve_event_pricing_inputs; true = Paystack brand with no VAT country. */
  vat_country_missing?: boolean | null;
  payment_country?: string | null;
}

export interface DoorMoney {
  /** Ticket prices only. */
  subtotalCents: number;
  /** Fees (and NG VAT) the guest pays on top, per the event's switches. */
  feeCents: number;
  totalCents: number;
  /** Mingla's flat cut (take rate + service fee), whatever the switches say. */
  applicationFeeCents: number;
  currency: string;
}

const STRIPE_REGIONS = ["GB", "US", "EU", "CH"] as const;

/**
 * A passed tax that sits on top of the price (exclusive regions, today the US)
 * isn't known until Stripe has the buyer's address, so no total shown at the door
 * could be the total charged. These events refuse pay code and Tap to Pay. An
 * inclusive tax sits inside the price and never changes the total.
 */
export function doorTaxAddedAtCheckout(
  pricing: Pick<DoorPricingRow, "pass_tax" | "pricing_region">,
  provider: "stripe" | "paystack",
): boolean {
  if (provider !== "stripe" || pricing.pass_tax !== true) return false;
  const region = (pricing.pricing_region ?? "").trim().toUpperCase();
  return (STRIPE_REGIONS as readonly string[]).includes(region) &&
    taxBehaviorForRegion(region as PricingRegion) === "exclusive";
}

/** Same engine as online checkout (#3645 flat 4.5%). */
export function computeDoorMoney(
  pricing: DoorPricingRow,
  provider: "stripe" | "paystack",
  subtotalCents: number,
): DoorMoney {
  const currency = (pricing.pricing_currency ?? "").trim().toUpperCase();
  if (currency.length !== 3) throw new Error("pricing_currency_missing");
  const rawRegion = (pricing.pricing_region ?? "").trim().toUpperCase();
  const region: PricingRegion = provider === "paystack"
    ? "NG"
    : (STRIPE_REGIONS as readonly string[]).includes(rawRegion)
    ? rawRegion as PricingRegion
    : "GB";
  const switches: PricingSwitches = {
    pass_tax: pricing.pass_tax === true,
    pass_mingla_fee: pricing.pass_mingla_fee === true,
    pass_service_fee: pricing.pass_service_fee === true,
  };
  const sub = computeBuyerSubtotal({
    baseCents: subtotalCents,
    switches,
    region,
    currency,
    effectiveTakeRateBps: Number(pricing.effective_take_rate_bps ?? 0),
    takeRateSource: pricing.take_rate_source === "brand_override"
      ? "brand_override"
      : "platform_default",
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
  });
  let totalCents = sub.buyerSubtotalCents;
  if (provider === "paystack") {
    // #4389 I-4389-NO-ZERO-VAT-FALLBACK: refuse rather than charge 0% VAT.
    if (pricing.vat_country_missing === true) throw new Error(BRAND_SETUP_INCOMPLETE);
    totalCents = computeConfigVat(
      sub.buyerSubtotalCents,
      Number(pricing.vat_rate_bps ?? 0),
      switches.pass_tax,
    ).buyerTotalCents;
  }
  return {
    subtotalCents,
    feeCents: totalCents - subtotalCents,
    totalCents,
    applicationFeeCents: sub.miglaFeeCents + sub.serviceFeeCents,
    currency,
  };
}

/** Maps a database refusal to the contract vocabulary. */
export function doorErrorFromDb(message: string | null | undefined): {
  error: DoorPayErrorCode;
  status: number;
} {
  const m = message ?? "";
  if (m.includes("door_access_denied")) {
    return { error: "door_access_denied", status: 400 };
  }
  if (m.includes("door_ticket_capacity_exceeded")) {
    return { error: "door_ticket_capacity_exceeded", status: 400 };
  }
  if (m.includes("ticket_not_valid_on_chosen_days")) {
    return { error: "ticket_not_valid_on_chosen_days", status: 400 };
  }
  if (
    m.includes("invalid_lines") || m.includes("door_event_unavailable") ||
    m.includes("door_event_date_invalid")
  ) {
    return { error: "invalid_lines", status: 400 };
  }
  if (m.includes("text_link_limit_reached")) {
    return { error: "text_link_limit_reached", status: 429 };
  }
  if (m.includes("door_code_unavailable")) {
    return { error: "door_code_unavailable", status: 409 };
  }
  if (m.includes("buyer_phone_invalid")) {
    return { error: "buyer_phone_invalid", status: 400 };
  }
  if (m.includes("not_found")) return { error: "not_found", status: 404 };
  if (m.includes("payment_not_succeeded")) {
    return { error: "payment_not_succeeded", status: 409 };
  }
  return { error: "server_error", status: 500 };
}

export function last4(phoneE164: string): string {
  return phoneE164.slice(-4);
}
