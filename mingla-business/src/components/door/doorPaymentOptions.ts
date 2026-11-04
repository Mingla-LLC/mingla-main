/**
 * issue #4271 — the door sale payment list, as data.
 *
 * Kept free of React Native imports so the order, the copy and the
 * availability rules are unit-testable and shared by the sheet and its tests.
 *
 * Order (approved design H2): Buyer's phone (pay code), Tap to pay (only where
 * it works), Cash, Manual, then the disabled Card reader row. "NFC tap" is
 * gone; no row says "TESTING MODE", "not available yet" or "Coming when
 * backend ships".
 */

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
  /** "ios" names the iPhone in the Tap to pay sub-line. */
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
  const options: DoorPaymentOption[] = [
    {
      id: "pay_code",
      label: "Buyer pays on their phone",
      sub: isPaystackMarket(eventCurrency)
        ? "Show a code. They scan it with their camera and pay by card, bank transfer or USSD."
        : "Show a code. They scan it with their camera and pay by card, Apple Pay or Google Pay.",
      disabled: false,
      isNew: true,
    },
  ];
  if (tapToPay.available) {
    options.push({
      id: "tap_to_pay",
      label: "Tap to pay",
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
  amountLabel: string,
): string => {
  switch (method) {
    case "pay_code":
      return "Show pay code";
    case "tap_to_pay":
      return `Take ${amountLabel}`;
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
