/**
 * #4490 spec 08 O1 — every Till string, in one place. Money is always a
 * `{amount}` slot filled by formatCurrency (rule 10). Strings come from spec 08
 * §3 O1 and the floor design; the few the spec did not give are listed in the
 * O1 report under "copy for Seth".
 */

export const TILL_COPY = {
  title: "Till",
  pay: (amount: string): string => `Pay ${amount}`,
  payPending: "Pay --",
  sendToKitchen: "Send to kitchen",
  sendToBar: "Send to bar",
  send: "Send",
  saveCheck: "Save check",
  soldOut: "Sold out",
  left: (n: number): string => `${n} left`,
  priceUpdated: "Price updated",
  quoteError: "Couldn't get the total",
  quoteErrorBody: "Check the connection and try again.",
  retry: "Retry",
  offline: "No connection",
  offlineBody: "Sales are paused until you're back online. Nothing is queued.",
  nothingToSell: "Nothing to sell yet",
  openMenu: "Open Menu",
  openOffers: "Open Offers",
  checks: "Checks",
  openChecks: "Open checks",
  paidToday: "Paid today",
  openCount: (n: number): string => `Open · ${n}`,
  paidTodayCount: (n: number): string => `Paid today · ${n}`,
  waitingForPayment: "Waiting for payment",
  newCheck: "New check",
  nameOnCheck: "Name on the check",
  nameOnCheckHint: "Shown on the ticket and the pickup screen.",
  openCheck: "Open check",
  menu: "Menu",
  entry: "Entry",
  add: (n: number, amount: string): string => `Add ${n} · ${amount}`,
  noteForKitchen: "Note for the kitchen",
  quantity: "Quantity",
  subtotal: "Subtotal",
  serviceCharge: "Service charge",
  total: "Total",
  leftToPay: "Left to pay",
  amountDue: "Amount due",
  // Pay sheet
  noTip: "No tip",
  payInFull: "Pay in full",
  scanToPay: "Scan to pay",
  cash: "Cash",
  cashSub: "Work out the change",
  ownMachine: "Card machine (yours)",
  ownMachineSub: "Record a payment on your own machine",
  chargeToRoom: "Charge to room",
  chargeToRoomLater: "Charge to room comes with stays",
  cashGiven: "Cash given",
  exact: (amount: string): string => `Exact ${amount}`,
  changeToGive: "Change to give",
  takeCash: (amount: string): string => `Take ${amount} cash`,
  partCash: "Take this cash now and pay the rest another way, or split the bill.",
  ownMachineAsk: "Did the card machine say approved?",
  ownMachineBody: "We record it so it's counted when you close the day. No money moves through Mingla and there's no Mingla fee.",
  yesApproved: "Yes, approved",
  noGoBack: "No, go back",
  paymentTaken: "Payment taken",
  noMoneyTaken: "No money was taken",
  tryAgain: "Try again",
  saveAgain: "Save again",
  newSale: "New sale",
  paidShort: (method: string, amount: string): string => `${method} · ${amount}`,
  changeLine: (amount: string): string => `change ${amount}`,
  // Receipt
  receipt: "Receipt",
  noReceipt: "No receipt",
  sendReceipt: "Send receipt",
  receiptSent: "Receipt sent",
  receiptPhone: "Guest's mobile number",
  receiptEmail: "Guest's email",
  receiptText: "Text",
  receiptEmailButton: "Email",
  receiptBoth: "Both",
  receiptEmailInvalid: "Check the email address.",
  receiptSendsLeft: (n: number): string => (n === 1 ? "You can send it 1 more time." : `You can send it ${n} more times.`),
  receiptLimit: "This receipt was sent three times, the most we send.",
  // Void and refund
  void: "Void",
  voidItem: (name: string): string => `Void ${name}`,
  why: "Why?",
  voidReasons: [
    { key: "made_wrong", label: "Made wrong" },
    { key: "changed_mind", label: "Changed their mind" },
    { key: "walked_out", label: "Walked out" },
    { key: "on_the_house", label: "On the house" },
    { key: "other", label: "Other" },
  ],
  refund: "Refund",
  refundAmount: (amount: string): string => `Refund ${amount}`,
  amountToRefund: "Amount to refund",
  reason: "Reason",
  refundReasons: [
    { key: "paid_twice", label: "Paid twice" },
    { key: "guest_asked", label: "Guest asked" },
    { key: "wrong_amount", label: "Wrong amount" },
    { key: "other", label: "Other" },
  ],
  refunded: "Refunded",
  close: "Close",
  // Leaving with items not yet on the check
  leaveTitle: "Leave the Till?",
  leaveBody: "The items you picked aren't on the check yet, so they'll be lost.",
  leaveConfirm: "Leave",
  leaveKeep: "Keep selling",
} as const;

/**
 * Server codes → plain words with a way forward (never a raw code). Strings
 * the spec gives are used as written; the rest reuse the nearest existing
 * Host string (door copy, venueCheckInResult.ts) and are listed for Seth.
 */
export function tillErrorCopy(code: string, item: string | null = null): string {
  switch (code) {
    case "till_check_changed":
    case "till_check_closed":
    case "till_amount_over_due":
    case "till_nothing_to_pay":
    case "till_payment_in_progress":
      return "That check was changed on another device. We've refreshed it.";
    case "till_item_not_orderable":
      return "This item sold out while you were adding it";
    case "till_void_needs_money_rights":
      return "Ask someone with money rights to void a sent item.";
    case "till_line_paid":
    case "till_refund_method_unavailable":
    case "till_payment_not_refundable":
      return "Refunds need money rights.";
    case "till_payment_too_large":
      return "This payment is too large to take in one go. Ask for a smaller deposit, or record it as paid to the venue.";
    case "till_spot_has_check":
      return "That table has its own check. Pay or move that one first.";
    case "offer_sold_out":
      return "Sold out for today, including the places kept for walk-ins.";
    case "offer_day_closed":
      return "The venue is closed today, so nothing can be sold.";
    case "offer_window_unavailable":
      return "Today isn't on sale for this offer.";
    case "offer_not_found":
    case "offer_changed":
    case "offer_quote_expired":
      return "That offer isn't on sale any more. Close this and try again.";
    case "offers_not_enabled":
      return "Selling at the gate isn't switched on for your brand yet.";
    case "admit_count_invalid":
      return "That's more guests than are left on this pass.";
    case "till_card_refunded_once":
      return "This card payment was already refunded once. Pay the rest back in cash.";
    case "till_receipt_limit":
      return "This receipt was sent three times, the most we send.";
    case "till_receipt_phone_invalid":
      return "Check the mobile number, including the country.";
    case "till_receipt_email_invalid":
      return "Check the email address.";
    case "till_receipt_not_paid":
      return "A receipt goes out once the payment is taken.";
    case "network":
      return "No connection. Sales are paused until you're back online. Nothing is queued.";
    default:
      return item !== null ? `${item}: that didn't go through. Try again.` : "That didn't go through. Try again.";
  }
}
