/**
 * #4389 Door mode — every new English string on the door sale screen
 * (design screen "DM", approved 2026-11-11). English first; a later pass moves
 * these into i18n with the rest of the setup copy.
 *
 * Apple naming: the device-facing Tap to Pay name always comes from
 * tapToPayName(os) ("Tap to Pay on iPhone" on iOS). These strings never name a
 * card reader, a terminal or hardware, and never call the app the business app.
 *
 * MINGLA-INVARIANT: I-4389-DOOR-MODE-APPLE-NAMING | issue #4389 | Door mode copy names Tap to Pay only through tapToPayName(os) and never says reader, terminal, hardware or business; pinned by issue_4389_door_mode.implementor.test.ts.
 */
import { tapToPayName } from "../../constants/tapToPayName";

/** The chip labels, in buildDoorPaymentOptions order. */
export const doorModeChipLabel = (method: "tap_to_pay" | "pay_code" | "cash", os: string): string => {
  switch (method) {
    case "tap_to_pay":
      return tapToPayName(os);
    case "pay_code":
      return "Buyer's phone";
    case "cash":
      return "Cash";
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
};

export const DOOR_MODE_COPY = {
  closeLabel: "Close door mode",
  menuLabel: "Recent sales and more",
  soldTonight: (n: number): string => `Door · ${n} sold tonight`,
  howTheyPay: "How they pay",
  ticketCount: (n: number): string => `${n} ticket${n === 1 ? "" : "s"}`,
  tileLabel: (name: string, price: string, qty: number): string =>
    qty > 0 ? `${name}, ${price}, ${qty} in sale. Tap to add one.` : `${name}, ${price}. Tap to add one.`,
  removeOne: (name: string): string => `Remove one ${name}`,
  remembered: (method: string): string => `${method} is remembered for this event on this phone.`,
  // The button follows the method.
  charge: (total: string | null): string => (total === null ? "Charge" : `Charge ${total}`),
  showCode: (total: string | null): string => (total === null ? "Show code" : `Show code · ${total}`),
  cashTaken: (total: string): string => `Cash taken · ${total}`,
  manualTaken: (total: string): string => `Record payment · ${total}`,
  charging: "Charging…",
  finalTotalHint: "The payment shows the final total, with any fees.",
  // Cash confirm.
  cashConfirmTitle: (total: string): string => `Cash taken: ${total}?`,
  cashConfirmBody: "Tickets are issued and checked in.",
  confirmCash: "Confirm cash",
  back: "Back",
  // Scan to pay.
  scanToPay: (total: string): string => `Scan to pay ${total}`,
  waitingForPayment: "Waiting for payment… This screen moves on by itself when they've paid.",
  guestPaying: "Guest is paying on their phone…",
  cancelSale: "Cancel this sale",
  codeChecking: "Checking with the card provider whether a payment went through. Don't charge them again yet.",
  codeLanding: "Their payment went through. This turns green in a moment. Don't charge them again and don't take cash.",
  codeAlreadyPaid: "This code was already paid, so it can't be cancelled.",
  codeCancelFailed: "Couldn't cancel the code. Check your connection and try again.",
  codeStillOpen: "Couldn't reach the card provider to close this code. It's still open. Try again.",
  codeLoadFailed: "Couldn't load the pay code. Check your connection and try again.",
  // Paid overlay.
  paid: (total: string): string => `Paid ${total}`,
  paidLine: (n: number, how: string): string => `${n} ticket${n === 1 ? "" : "s"} checked in · ${how}`,
  paidByPhone: "Buyer's phone",
  paidByCash: "Cash",
  paidManual: "Paid another way",
  nextSaleHint: "Ready for the next sale in 2s. Tap anywhere to skip.",
  sendReceipt: "Send receipt",
  cashReceipt: (args: { brand: string | null; event: string | null; total: string; tickets: number; when: string }): string =>
    [
      [args.brand, args.event].filter((part): part is string => part !== null && part.length > 0).join(" · "),
      `Paid ${args.total} in cash for ${args.tickets} ticket${args.tickets === 1 ? "" : "s"}.`,
      args.when,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  // Banners.
  offline: "You're offline. Card and phone payments need a connection. Cash still works.",
  noTiers: "No tickets are on sale at the door. Edit the event and make a ticket available at the door.",
  pickTicket: "Tap a ticket to start a sale.",
  saleFailed: "Couldn't record the sale. Nothing was lost: the tickets are still here. Try again.",
  capacity: "Not enough tickets left for this sale.",
  wrongDate: "One of these tickets isn't valid on that date.",
  noSharedDate: "These tickets share no date. Sell them separately.",
  checkingDates: "Checking dates…",
  dateHeading: "Date",
  // Menu.
  menuTitle: "Door",
  recentSales: "Recent sales",
  noRecentSales: "No door sales yet.",
  allSales: "All door sales",
  addBuyer: "Add buyer",
  addBuyerSub: "Name, mobile or email for the next sale's receipt.",
  manual: "Paid another way",
  manualSub: "Record a payment you took another way, like a bank transfer.",
  manualPicked: "Paid another way. Pick a chip to go back.",
  // Add buyer.
  buyerTitle: "Add buyer",
  buyerBody: "Optional. Saved on the next cash or card sale and used for their receipt.",
  buyerName: "Name",
  buyerPhone: "Mobile, for their receipt",
  buyerEmail: "Email",
  buyerEmailInvalid: "Enter a valid email or leave blank.",
  buyerPhoneInvalid: "Enter a valid mobile number or leave blank.",
  buyerSave: "Use for the next sale",
  buyerClear: "Clear",
  buyerSet: (label: string): string => `Next sale: ${label}`,
  // Which event.
  whichEvent: "Which event?",
  liveNow: "Live now",
  today: "Today",
  // Not found / loading.
  loading: "Loading the door…",
  notFound: "Event not found",
  notFoundBody: "It may have been deleted.",
} as const;
