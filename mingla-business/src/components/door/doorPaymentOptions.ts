/**
 * issue #4271 — the door sale payment list, as data.
 *
 * Kept free of React Native imports so the order, the copy and the
 * availability rules are unit-testable and shared by the sheet and its tests.
 *
 * Order: Tap to Pay first where it works (Apple's requirement), then Buyer's
 * phone (pay code), Cash, Manual and the disabled Card reader row. "NFC tap" is
 * gone; no row says "TESTING MODE", "not available yet" or "Coming when
 * backend ships".
 */

import { tapToPayName } from "../../constants/tapToPayCopy";
import type { DoorPaymentMethod } from "../../types/doorSales";

export interface DoorPaymentOption {
  id: DoorPaymentMethod;
  label: string;
  sub: string;
  disabled: boolean;
  isNew: boolean;
}

export interface TapToPayState {
  available: boolean;
  needsSetup: boolean;
}

export interface DoorPaymentOptionsInput {
  /** The event's real currency code, or null before the brand has a bank. */
  eventCurrency: string | null;
  tapToPay: TapToPayState;
  /** "ios" names the iPhone in the Tap to Pay sub-line. */
  platform: string;
}

/** Nigeria pays through Paystack: card, bank transfer or USSD. */
const isPaystackMarket = (currency: string | null): boolean =>
  currency?.trim().toUpperCase() === "NGN";

export const buildDoorPaymentOptions = ({
  eventCurrency,
  tapToPay,
  platform,
}: DoorPaymentOptionsInput): DoorPaymentOption[] => {
  const options: DoorPaymentOption[] = [];
  // Apple: top of the list, on both platforms.
  if (tapToPay.available) {
    options.push({
      id: "tap_to_pay",
      label: tapToPayName(platform),
      sub: tapToPay.needsSetup
        ? "Set up once on this phone. About 2 minutes."
        : platform === "ios"
          ? "Take a card or phone on this iPhone."
          : "Take a card or phone on this phone.",
      disabled: false,
      isNew: true,
    });
  }
  options.push(
    {
      id: "pay_code",
      label: "Buyer pays on their phone",
      sub: isPaystackMarket(eventCurrency)
        ? "Show a code. They scan it with their camera and pay by card, bank transfer or USSD."
        : "Show a code. They scan it with their camera and pay by card, Apple Pay or Google Pay.",
      disabled: false,
      isNew: true,
    },
    {
      id: "cash",
      label: "Cash",
      sub: "You collect cash at the door.",
      disabled: false,
      isNew: false,
    },
    {
      id: "manual",
      label: "Manual",
      sub: "Paid another way, like a bank transfer.",
      disabled: false,
      isNew: false,
    },
    {
      id: "card_reader",
      label: "Card reader",
      sub: "Card machines are coming later.",
      disabled: true,
      isNew: false,
    },
  );
  return options;
};

/** The sticky button names exactly what happens next. */
export const doorSaleButtonLabel = (
  method: DoorPaymentMethod,
  os: string,
): string => {
  switch (method) {
    case "pay_code":
      return "Show pay code";
    case "tap_to_pay":
      // Apple's wording; the amount stays on the Total line.
      return tapToPayName(os);
    case "cash":
    case "manual":
    case "card_reader":
      return "Complete sale";
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
};

/** The guest types their own details on their phone for a pay code. */
export const doorMethodCollectsBuyerDetails = (
  method: DoorPaymentMethod,
): boolean => method !== "pay_code";

export const DOOR_SALE_SUBHEAD = "Buyer is checked in as soon as they've paid.";
export const DOOR_PAYMENTS_NOT_ALLOWED =
  "Ask the brand owner to let you take payments.";
export const DOOR_PAY_CODE_BUYER_NOTE =
  "They type their own name, email and number on their phone. Their ticket goes to that email and number.";

/**
 * The sale sheet's dock for a pay code. The fee is the server's alone: the
 * quoted "Total incl. fees" when it has answered, otherwise only the tickets'
 * own subtotal (loading or offline). No fee is ever estimated here.
 */
export const doorPayCodeDockTotal = (
  quote: { totalCents: number; currency: string } | null | undefined,
  subtotalLabel: string,
  formatQuote: (totalCents: number, currency: string) => string,
): { label: string; amount: string; quoted: boolean } =>
  quote !== null && quote !== undefined
    ? {
        label: "Total incl. fees",
        amount: formatQuote(quote.totalCents, quote.currency),
        quoted: true,
      }
    : { label: "Tickets", amount: subtotalLabel, quoted: false };

/**
 * The same server total for a tap as for a pay code. Before it answers, only the
 * tickets' subtotal, with a plain label: never an estimated fee.
 */
export const doorTapDockTotal = (
  quote: { totalCents: number; currency: string } | null | undefined,
  subtotalLabel: string,
  formatQuote: (totalCents: number, currency: string) => string,
): { label: string; amount: string; quoted: boolean } =>
  quote !== null && quote !== undefined
    ? { label: "Take", amount: formatQuote(quote.totalCents, quote.currency), quoted: true }
    : { label: "Tickets", amount: subtotalLabel, quoted: false };

export interface DoorTapBlockFacts {
  hasLines: boolean;
  dateMissing: boolean;
  currencyMissing: boolean;
  permissionLoading: boolean;
  emailInvalid: boolean;
  phoneInvalid: boolean;
  notesInvalid: boolean;
}

/**
 * Apple: the Tap to Pay button is never greyed. A press with something missing
 * says what's missing here and does not start the sale.
 */
export const doorTapBlockReason = (facts: DoorTapBlockFacts): string | null => {
  if (!facts.hasLines) return "Pick at least one ticket first.";
  if (facts.dateMissing) return "Pick a date first.";
  if (facts.currencyMissing) return "Add your bank to record paid sales.";
  if (facts.permissionLoading) return "Checking your door access…";
  if (facts.emailInvalid) return "Enter a valid email or leave blank.";
  if (facts.phoneInvalid) return "Enter a valid mobile number or leave blank.";
  if (facts.notesInvalid) return "Shorten the notes first.";
  return null;
};

/**
 * Tap to Pay does not exist on the Paystack rail (Nigeria); it is named only
 * once the brand is known to be on Stripe.
 */
export const scannerDoorPaymentsCopy = (
  paymentProvider: "stripe" | "paystack" | null | undefined,
): string =>
  paymentProvider === "stripe"
    ? "Cash, manual, pay codes and Tap to Pay. Card money goes to your bank with online sales."
    : "Cash, manual and pay codes. Card money goes to your bank with online sales.";
