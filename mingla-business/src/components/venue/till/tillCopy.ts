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
  // Moving a check, handing it over, renaming it (T9; floor design "check-actions")
  checkActions: "Check",
  moveToTable: "Move to another table",
  moveToTableSub: "Everything sent and paid moves with it",
  handOver: "Hand over to someone",
  handOverSub: "For a break or the end of a shift",
  changeName: "Change the name",
  moveTitle: (label: string): string => `Move ${label}`,
  moveTo: (table: string): string => `Move to ${table}`,
  moveCaption:
    "Sent items don't go to the kitchen again; their tickets and the bill show the new table. Tables with their own open check can't be picked: pay or move that one first.",
  noTables: "This venue has no tables to move to.",
  handoverTitle: (label: string): string => `Hand over ${label}`,
  handoverTo: (name: string): string => `Hand over to ${name}`,
  handoverCaption: (to: string, from: string): string =>
    `Tips paid from now go to ${to}. Tips already paid on this check stay with ${from}.`,
  openChecksOf: (n: number): string => (n === 1 ? "1 open check" : `${n} open checks`),
  servingNow: (name: string): string => `${name} is serving`,
  nobodyElse: "Nobody else here can sell yet.",
  teamMember: "Team member",
  movedTo: (table: string): string => `Moved to ${table}`,
  handedOver: (name: string): string => `${name} is serving this check now`,
  nameSaved: "Name saved",
  // A part-paid check that now costs less; a check the old order pad closed
  overpaid: (amount: string): string => `${amount} more was paid than this check now costs. Refund it from the payment below.`,
  settledOnPad: "Paid on the order pad",
  // Refunding an entry or package line
  refundLineTitle: (label: string): string => `Refund ${label}`,
  refundLineBody: "The booking is cancelled, its places are freed and the pass stops working.",
  // #4490 spec 08 §3 O2 (spec copy first, then new strings listed for Seth)
  tapToPay: "Tap to pay",
  tapHold: "Hold the card near the top of this phone",
  scanAsk: "Ask the guest to scan this with their phone camera",
  waitingForBank: "Waiting for the bank. You can carry on; we'll tell you when it lands.",
  paidByTransfer: "Paid by bank transfer",
  textTheLink: "Text them the link",
  codeExpired: "This code expired. Make a new one.",
  expired: "Expired",
  cardDeclined: "Card declined. Try another card or let them scan to pay.",
  latePaid: "A cancelled payment was paid. Refund it or keep it as payment",
  cardIncludesFees: (amount: string): string => `Card ${amount}, includes fees`,
  tapSub: "Card or phone wallet, on this phone",
  scanSub: "Card or bank transfer on their phone",
  takesWhatIsLeft: "Takes everything that is left to pay",
  tapNotOnPhone: "This phone can't take Tap to pay.",
  tapNotOnIpad: "Works on iPhone and Android phones, not on this iPad. Use Scan to pay here.",
  paymentTakenSaving: "Payment taken. Saving…",
  waitingToScan: "Waiting for the guest to scan",
  codeOpenHour: "This code stays open for 60 minutes.",
  backToTill: "Back to the Till",
  textLinkBody: "We text the pay link to the guest. Up to 3 texts per code.",
  theirMobile: "Their mobile number",
  expiredStillLands: "If the guest paid on the old code, it still lands and we'll tell you.",
  chooseAnotherWay: "Choose another way",
  cancelScanBody: "The guest's code stops working. If they already paid, the money still lands and we'll ask you to refund it or keep it.",
  tapUpdateIos: "Update iOS to take Tap to pay.",
  tapNeedsApp: "Tap to pay needs the latest Mingla Host app.",
  makeNewCode: "Make a new code",
  cancelPayment: "Cancel payment",
  cancelPaymentAsk: "Cancel this payment?",
  keepWaiting: "Keep waiting",
  carryOn: "Carry on",
  codeLabel: (code: string): string => `Code ${code}`,
  expiresIn: (time: string): string => `Expires in ${time}`,
  guestPaying: "The guest is paying on their phone",
  sendLink: "Send link",
  linkSent: (left: number): string => (left === 0 ? "Link sent. That was the last text for this code." : `Link sent. ${left} more ${left === 1 ? "text" : "texts"} left.`),
  readingCard: "Reading the card…",
  savingPayment: "Saving the payment…",
  tryAnotherCard: "Try another card",
  scanInstead: "Scan to pay instead",
  paidByCard: (label: string): string => `Paid by card · ${label}`,
  paidOnPhone: "Paid on their phone",
  keepAsPayment: "Keep as payment",
  refundIt: "Refund it",
  lateKept: "Kept as payment",
  // #4490 spec 08 §11 T5 / T7 — the kitchen on the Till.
  readyToTakeOut: (destination: string): string => `Ready to take out · ${destination}`,
  readyAt: (time: string): string => `Ready ${time}`,
  notAccepted: (minutes: number): string => `Not accepted · ${minutes} min`,
  nobodyAccepted: (destination: string): string => `Nobody has accepted ${destination}'s order`,
  nobodyAcceptedBody: "Print the ticket and take it to the kitchen, or call them.",
  pickedUp: "Picked up",
  printTicket: "Print ticket",
  stationNames: (stations: readonly string[]): string =>
    stations.map((s) => (s === "bar" ? "Bar" : "Kitchen")).join(" and "),
  thisCheck: "this check",
  // #4490 spec 08 O4: split bill (spec §3 O4 copy + §11 A5, T11)
  split: "Split",
  byItem: "By item",
  evenly: "Evenly",
  people: (n: number): string => `${n} people`,
  ways: (n: number): string => `${n} ways`,
  notAssigned: (amount: string): string => `${amount} not assigned yet`,
  allAssigned: "Every item has a share.",
  shareN: (n: number): string => `Share ${n}`,
  sharePaid: (n: number): string => `Share ${n} paid`,
  sharePaying: "Being paid",
  shareUnpaid: "To pay",
  payShare: (n: number, amount: string): string => `Pay share ${n} · ${amount}`,
  backToShares: "Back to the shares",
  splitTheBill: "Split the bill",
  whoHasWhat: "Tap a share, then give it its items.",
  splitEvenOnly: "Part of this bill is already paid. Split the rest evenly.",
  splitShares: "How many shares?",
  splitInto: (n: number): string => `Split into ${n}`,
  allSharesPaid: "Every share is paid.",
  // Tables (spec §3 O4, §11 A11 / T12)
  tables: "Tables",
  seat: "Seat",
  seatWalkIn: "Seat walk-in",
  seatBooking: "Seat a booking",
  seatAndOpen: "Seat and open check",
  partySize: "Guests",
  bookedFor: (time: string, party: number): string => `Booked for ${time} · ${party} ${party === 1 ? "guest" : "guests"}`,
  depositPaidOnline: "Deposit paid online",
  depositComesOff: "The deposit comes off the bill.",
  depositUsed: "Deposit already on a check",
  minSpendLeft: (amount: string): string => `${amount} to reach the minimum spend`,
  minSpendMet: "Minimum spend reached",
  tableBusy: "Has a check",
  minSpendTable: (amount: string): string => `Minimum spend ${amount}`,
  // By the hour started by staff (spec §3 O4, §11 A10, T13)
  byTheHour: "By the hour",
  startSessionNow: "Start a session now",
  howLong: "How long",
  minutes: (n: number): string => (n % 60 === 0 ? `${n / 60} h` : n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`),
  whichOne: "Which one",
  anyFreeOne: "Any free one",
  inUse: "In use",
  perHour: (amount: string): string => `${amount} an hour`,
  addThirty: "Add 30 min",
  addMinutes: (n: number): string => (n === 30 ? "Add 30 min" : `Add ${n} min`),
  minutesLeft: (n: number): string => `${n} min left`,
  overBy: (n: number): string => `Over by ${n} min`,
  unitOver: (unit: string, n: number): string => `${unit} is ${n} minutes over`,
  nextBookingAt: (unit: string, time: string): string => `The next booking for ${unit} is at ${time}.`,
  endAndPay: "End and pay",
  sessionEnds: (time: string): string => `Ends ${time}`,
} as const;

/**
 * #4490 08-O1 fix 2 (O1-B1) — every server code → its own plain words with a
 * way forward (never a raw code). One row per code, so a refusal can never
 * borrow another code's words: the overpay refusal used to say "That check
 * was changed on another device", which is true only of `till_check_changed`.
 * Strings the spec gives are used as written; the rest reuse the nearest
 * existing Host string or are new, and are listed for Seth in the fix 2 report.
 * Codes that are true synonyms share one line on purpose; the copy test pins
 * exactly which (`TILL_SHARED_COPY`), so any other shared line fails it.
 */
export const TILL_ERROR_COPY = {
  // Version and state of the check
  till_check_changed: "That check was changed on another device. We've refreshed it.",
  till_check_closed: "This check is closed, so nothing changed. Open Checks to find it.",
  till_payment_in_progress: "A guest is paying right now. Try again in a few minutes.",
  till_nothing_to_pay: "There's nothing left to pay on this check.",
  till_amount_over_due: "That's more than they still owe. Lower the amount.",
  till_tip_invalid: "That tip can't be taken. Pick another tip or No tip.",
  till_payment_too_large:
    "This payment is too large to take in one go. Ask for a smaller deposit, or record it as paid to the venue.",
  till_not_enabled: "Selling in person is off at this venue.",
  till_sale_not_found: "We couldn't find that check. It may have been closed on another device.",
  till_idempotency_conflict: "That was already sent with different details. Start the sale again.",
  // 08-O3 fix 5 (O3-S3): a payment or refund request id already used on this
  // check for something else. The server moved no money.
  till_request_reused: "That was already sent with different details, so nothing was paid or refunded. Look at the check and try again.",
  till_invalid_payload: "Check the details and try again.",
  till_settings_invalid: "Check the settings and try again.",
  till_settings_changed: "These settings were changed on another device. Open them again.",
  // Tables, servers, rounds
  till_spot_has_check: "That table has its own check. Pay or move that one first.",
  till_spot_not_found: "That table isn't at this venue any more.",
  till_server_invalid: "That person can't sell at this venue.",
  till_round_invalid: "That order can't go on this check.",
  till_item_not_orderable: "This item sold out while you were adding it",
  till_hold_lapsed: "The hold already ran out. We've loaded the latest.",
  till_tab_settled_on_pad: "That tab is already closed.",
  till_round_settled_elsewhere: "That order has already moved on. Pull to refresh.",
  // Voids
  till_line_not_found: "That item is no longer on this check.",
  till_line_paid: "This item is paid. Refund it instead of voiding it.",
  till_void_needs_money_rights: "Ask someone with money rights to void a sent item.",
  // Refunds
  till_payment_not_found: "We couldn't find that payment.",
  till_refund_method_unavailable: "This payment can't be refunded that way.",
  till_payment_not_refundable: "This payment has nothing left to refund.",
  till_refund_over_paid: "That's more than is left on this payment. Lower the amount.",
  till_refund_tip_last: "Refund the rest of the payment first. Any tip is refunded last.",
  till_refund_line_invalid: "Only an entry or package can be refunded on its own. Refund food and drink from the payment.",
  till_line_not_paid: "This line isn't paid yet, so there's nothing to refund. Void it instead.",
  till_card_refunded_once: "This card payment was already refunded once. Pay the rest back in cash.",
  // Tap to pay and scan to pay (O2)
  till_card_not_ready: "Card payments aren't ready for this brand yet. Take cash or the card machine.",
  till_card_tax_at_checkout: "Tax added at checkout can't go on a card payment here. Take cash or the card machine.",
  brand_setup_incomplete: "Finish your brand setup (the country for VAT) to take card payments.",
  till_tap_not_available: "Tap to pay isn't available here. Let them scan to pay.",
  till_payment_already_paid: "That payment already went through.",
  till_payment_landing: "The guest's payment is going through. Wait a moment, then check again.",
  till_late_nothing_to_keep: "Nothing is left on this check to put it towards. Refund it instead.",
  pay_code_not_found: "We couldn't find that code.",
  pay_code_closed: "This code expired. Make a new one.",
  pay_code_text_limit: "The link was texted three times, the most we send.",
  // #4490 O2 fix 1 (O2-T3): the rolling-hour text windows (6 to one number at
  // a venue, 30 per seller).
  pay_code_text_window: "Too many pay links were texted in the last hour. Ask the guest to scan the code instead.",
  pay_code_buyer_invalid: "Check the name, email and mobile number.",
  buyer_name_required: "Add your name.",
  buyer_email_invalid: "Check the email address.",
  buyer_email_undeliverable: "That email address can't get receipts. Use another one.",
  buyer_phone_invalid: "Check the mobile number, including the country.",
  rate_limited: "Too many tries. Wait a minute, then try again.",
  // Receipts
  till_receipt_limit: "This receipt was sent three times, the most we send.",
  till_receipt_phone_invalid: "Check the mobile number, including the country.",
  till_receipt_email_invalid: "Check the email address.",
  till_receipt_not_paid: "A receipt goes out once the payment is taken.",
  receipt_not_found: "We couldn't find this receipt",
  // Offers sold in the Till (door copy, venueCheckInResult.ts)
  offer_sold_out: "Sold out for today, including the places kept for walk-ins.",
  offer_day_closed: "The venue is closed today, so nothing can be sold.",
  offer_window_unavailable: "Today isn't on sale for this offer.",
  offer_not_found: "That offer isn't on sale any more. Close this and try again.",
  offer_changed: "That offer isn't on sale any more. Close this and try again.",
  offer_quote_expired: "That offer isn't on sale any more. Close this and try again.",
  offer_option_unavailable: "That offer isn't on sale any more. Close this and try again.",
  offers_not_enabled: "Selling at the gate isn't switched on for your brand yet.",
  offer_guests_out_of_range: "That number of guests is outside this package's group size.",
  offer_booking_not_found: "We couldn't find that booking.",
  offer_invalid_transition: "That booking has already moved on, so nothing changed.",
  offer_amount_over_balance: "That's more than the booking still owes. Lower the amount.",
  offer_idempotency_conflict: "That booking was already changed with different details. Start again.",
  // Guest list
  admit_count_invalid: "That's more guests than are left on this pass.",
  guest_list_arrived_invalid: "That's more guests than are left on this pass.",
  guest_list_entry_on_check: "This guest is already on another check.",
  guest_list_entry_not_found: "That name isn't on today's guest list any more.",
  guest_list_reduced_window_closed: "List price has ended. Sell normal Entry instead.",
  guest_list_reduced_price_invalid: "The list price isn't set up for this offer. Sell normal Entry instead.",
  // Access and transport
  not_authorized: "You can't do that at this venue. Ask a brand owner or admin for access.",
  auth_required: "Sign in again to keep selling.",
  venue_not_found: "This venue was removed.",
  network: "No connection. Sales are paused until you're back online. Nothing is queued.",
  till_failed: "That didn't go through. Try again.",
  unavailable: "That didn't go through. Try again.",
  invalid_request: "That didn't go through. Try again.",
  unknown_action: "That didn't go through. Try again.",
  method_not_allowed: "That didn't go through. Try again.",
  // #4490 spec 08 O4: split bill, tables, by the hour, the room seam.
  till_split_active: "This bill is split. Pay a share, or choose Pay in full.",
  till_split_invalid: "Every item needs to go to one share. Check the split and try again.",
  till_split_after_part_payment: "Part of this bill is already paid. Split the rest evenly.",
  till_split_even_only: "This bill can only be split evenly.",
  till_share_paid: "That share is already paid.",
  till_share_paying: "That share is being paid right now. Wait for it, or cancel that payment first.",
  till_room_not_ready: "Charge to room comes with stays. Take another way to pay.",
  offer_space_taken: "That one is taken right now. Pick another, or try again later.",
  offer_staff_start_off: "This offer can't be started at the Till. Turn on Staff can start it in the offer.",
  offer_length_invalid: "That length doesn't fit this offer. Pick another length.",
  offer_too_soon: "That time has already started. Pick another time.",
  deposit_already_used: "This booking's deposit is already on another check.",
  till_booking_not_found: "We couldn't find that booking. It may have been cancelled.",
  till_booking_other_table: "That booking is for another table. Seat them there, or move the booking first.",
  till_booking_not_seatable: "This booking can't be seated. Open it in Reservations.",
} as const satisfies Record<string, string>;

export type TillErrorCode = keyof typeof TILL_ERROR_COPY;

/**
 * Codes that share one line because they mean the same thing to the person at
 * the Till. Any other two codes with the same words fail the copy test.
 */
export const TILL_SHARED_COPY: readonly (readonly TillErrorCode[])[] = [
  ["offer_not_found", "offer_changed", "offer_quote_expired", "offer_option_unavailable"],
  ["admit_count_invalid", "guest_list_arrived_invalid"],
  ["till_failed", "unavailable", "invalid_request", "unknown_action", "method_not_allowed"],
  // O2: the guest page's contact checks say what the receipt checks say.
  ["till_receipt_email_invalid", "buyer_email_invalid"],
  ["till_receipt_phone_invalid", "buyer_phone_invalid"],
];

function isTillErrorCode(code: string): code is TillErrorCode {
  return Object.prototype.hasOwnProperty.call(TILL_ERROR_COPY, code);
}

export function tillErrorCopy(code: string, item: string | null = null): string {
  if (isTillErrorCode(code)) return TILL_ERROR_COPY[code];
  return item !== null ? `${item}: that didn't go through. Try again.` : TILL_ERROR_COPY.till_failed;
}

/**
 * O1-B1 — what the pay sheet's amount field says. A typed amount is never
 * changed behind the person's back: an amount above what is left (or zero) is
 * refused in words and the payment cannot start until it is fixed.
 */
export function tillAmountError(typedMinor: number | null, dueMinor: number): string | null {
  if (typedMinor === null) return null;
  if (typedMinor <= 0) return "Enter an amount above zero.";
  if (typedMinor > dueMinor) return TILL_ERROR_COPY.till_amount_over_due;
  return null;
}
