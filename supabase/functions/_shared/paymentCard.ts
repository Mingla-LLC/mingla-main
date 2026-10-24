// Issue #4063 — narrow provider-card extraction and first-write recording.
// Only provider-reported brand, last four and wallet are retained.

export type PaymentCardBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "diners"
  | "jcb"
  | "unionpay"
  | "verve"
  | "eftpos"
  | "other";

export type PaymentWallet =
  | "apple_pay"
  | "google_pay"
  | "samsung_pay"
  | "link";

export interface PaymentCard {
  brand: PaymentCardBrand;
  last4: string;
  wallet: PaymentWallet | null;
}

interface PaymentCardAdmin {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const BRAND_DISPLAY: Readonly<Record<PaymentCardBrand, string>> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  verve: "Verve",
  eftpos: "eftpos",
  other: "Card",
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeBrand(value: unknown): PaymentCardBrand {
  const brand = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (brand) {
    case "visa":
    case "discover":
    case "jcb":
    case "verve":
      return brand;
    case "master":
    case "mastercard":
      return "mastercard";
    case "american express":
    case "american_express":
    case "amex":
      return "amex";
    case "diners":
    case "diners club":
      return "diners";
    case "china unionpay":
    case "unionpay":
      return "unionpay";
    case "eftpos":
    case "eftpos_au":
      return "eftpos";
    default:
      return "other";
  }
}

function normalizeWallet(value: unknown): PaymentWallet | null {
  return value === "apple_pay" || value === "google_pay" ||
      value === "samsung_pay" || value === "link"
    ? value
    : null;
}

function parsedCard(
  brand: unknown,
  last4: unknown,
  wallet: unknown,
): PaymentCard | null {
  if (typeof last4 !== "string" || !/^[0-9]{4}$/.test(last4)) return null;
  return {
    brand: normalizeBrand(brand),
    last4,
    wallet: normalizeWallet(wallet),
  };
}

export function cardFromStripeCharge(charge: unknown): PaymentCard | null {
  const details = objectValue(objectValue(charge)?.payment_method_details);
  if (details?.type !== "card") return null;
  const card = objectValue(details.card);
  const wallet = objectValue(card?.wallet)?.type;
  return parsedCard(card?.brand, card?.last4, wallet);
}

export function cardFromPaystackAuthorization(
  authorization: unknown,
  channel: unknown,
): PaymentCard | null {
  if (channel !== "card") return null;
  const card = objectValue(authorization);
  return parsedCard(card?.brand ?? card?.card_type, card?.last4, null);
}

export function formatCardDisplay(brand: unknown, last4: unknown): string {
  if (typeof last4 !== "string" || !/^[0-9]{4}$/.test(last4)) return "";
  return `${BRAND_DISPLAY[normalizeBrand(brand)]} •••• ${last4}`;
}

export async function recordTicketPaymentCard(
  admin: PaymentCardAdmin,
  input: { checkoutSessionId: string; card: PaymentCard },
): Promise<boolean> {
  try {
    const { error } = await admin.rpc("issue_4063_record_payment_card", {
      p_checkout_session_id: input.checkoutSessionId,
      p_brand: input.card.brand,
      p_last4: input.card.last4,
      p_wallet: input.card.wallet,
    });
    if (error === null) return true;
  } catch {
    // The structured warning below intentionally excludes provider payloads.
  }
  console.warn("payment_card_record_failed", {
    checkoutSessionId: input.checkoutSessionId,
  });
  return false;
}
