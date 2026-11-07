/**
 * issue #4271 — the door sale payment list, as data.
 *
 * Kept free of React Native imports so the order, the copy and the
 * availability rules are unit-testable and shared by the sheet and its tests.
 *
 * Order: Tap to Pay first where it works (Apple's requirement), then Buyer's
 * phone (pay code), Cash and Manual. "NFC tap" is gone; no row says "TESTING
 * MODE", "not available yet" or "Coming when backend ships".
 *
 * Door polish: no dead rows. The disabled "Card reader" row and the NEW badges
 * are gone (`card_reader` stays a DoorPaymentMethod only so older records still
 * read). Tap to Pay stays hidden, never greyed, when it can't work here.
 */

import { tapToPayName } from "../../constants/tapToPayName";
import type { DoorPaymentMethod } from "../../types/doorSales";

export interface DoorPaymentOption {
  id: DoorPaymentMethod;
  label: string;
  /** Shown under the picked row only; unpicked rows are one line. */
  sub: string;
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
    });
  }
  options.push(
    {
      id: "pay_code",
      label: "Buyer pays on their phone",
      sub: isPaystackMarket(eventCurrency)
        ? "They scan a code and pay by card, bank transfer or USSD."
        : "They scan a code and pay by card, Apple Pay or Google Pay.",
    },
    {
      id: "cash",
      label: "Cash",
      sub: "You collect cash at the door.",
    },
    {
      id: "manual",
      label: "Manual",
      sub: "Paid another way, like a bank transfer.",
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
/** issue #4271 — tax on top of the price isn't known until checkout (US pass-tax). */
export const DOOR_CARD_TAX_REFUSAL =
  "Card payments at the door aren't available for this event yet because tax is added at checkout. Take cash, or send guests to the event page.";

/** issue #4271 — every refusal says what happened; nothing was charged yet. */
export const doorPayCodeCreateErrorCopy = (code: string): string => {
  switch (code) {
    case "door_ticket_capacity_exceeded":
      return "Not enough tickets left for this sale.";
    case "ticket_not_valid_on_chosen_days":
      return "One of these tickets isn't valid on that date.";
    case "door_access_denied":
      return DOOR_PAYMENTS_NOT_ALLOWED;
    case "stripe_account_not_ready":
      return "Card payments aren't set up for this brand yet. Take cash or manual instead.";
    case "door_tax_added_at_checkout":
      return DOOR_CARD_TAX_REFUSAL;
    case "invalid_lines":
      return "Pick at least one ticket.";
    default:
      return "Couldn't make a pay code. Check your connection and try again.";
  }
};

export const DOOR_PAY_CODE_BUYER_NOTE = "They type their own details on their phone.";

/** Cash, manual and Tap to Pay: the collapsed row that opens the buyer fields in place. */
export const DOOR_BUYER_DETAILS_ROW = {
  title: "Add buyer details",
  sub: "Optional. Name, mobile for a receipt, email, notes.",
} as const;

/** No currency: the same example reads right for every brand. */
export const DOOR_NOTES_PLACEHOLDER = "e.g. Paid by bank transfer to the venue";

/** The notes counter stays out of the way until it matters. */
export const DOOR_NOTES_COUNTER_FROM = 400;

export const doorNotesCounter = (length: number, max: number): string | null =>
  length >= DOOR_NOTES_COUNTER_FROM ? `${length} / ${max}` : null;

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

export interface DoorDockMessageFacts {
  taxRefused: boolean;
  accessCheckFailed: boolean;
  /** A refused submit, or a blocked Tap to Pay press. */
  error: string | null;
  bankMissing: boolean;
  /** A card method (pay code or tap) whose server total hasn't come back. */
  cardQuotePending: "pay_code" | "tap_to_pay" | null;
}

export interface DoorDockMessage {
  text: string;
  tone: "error" | "hint";
}

export const DOOR_ACCESS_CHECK_FAILED =
  "Couldn't check your door access. Check your connection and try again.";
export const DOOR_BANK_MISSING = "Add your bank to record paid sales.";

/**
 * Door polish: the dock says at most one thing. Highest priority wins:
 * 1 tax refusal, 2 access check failed, 3 a submit error or a blocked tap,
 * 4 no bank yet, 5 a card total still on its way. The strings are unchanged.
 */
export const doorDockMessage = (facts: DoorDockMessageFacts, taxRefusalText: string): DoorDockMessage | null => {
  if (facts.taxRefused) return { text: taxRefusalText, tone: "error" };
  if (facts.accessCheckFailed) return { text: DOOR_ACCESS_CHECK_FAILED, tone: "error" };
  if (facts.error !== null) return { text: facts.error, tone: "error" };
  if (facts.bankMissing) return { text: DOOR_BANK_MISSING, tone: "hint" };
  if (facts.cardQuotePending === "tap_to_pay") {
    return { text: "The tap screen shows the final total, with any fees.", tone: "hint" };
  }
  if (facts.cardQuotePending === "pay_code") {
    return { text: "The pay code shows the final total, with any fees.", tone: "hint" };
  }
  return null;
};

/** The dock's left block: what the right-hand button is for. */
export const doorTicketCountLabel = (count: number): string => `${count} ticket${count === 1 ? "" : "s"}`;

export { scannerDoorPaymentsCopy } from "./scannerDoorPaymentsCopy";
