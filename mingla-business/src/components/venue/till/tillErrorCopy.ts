/**
 * #4490 spec 08 — the words for every refusal the `venue-till` edge function
 * (and the guest pay-code page) can send. A leaf split from tillCopy.ts: the
 * guest pay page and the Team PIN section use only these words, so they never
 * load the rest of the Till's copy.
 */

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
  till_close_not_covered: "Only a check the deposit fully pays can be closed. Take a payment instead.",
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
  // #4490 O5 part C: a send, or a payment that sends first, found too little
  // stock; nothing was sent and no money moved (the Till names the item).
  item_sold_out: "An item on this check sold out. Take it off, then try again.",
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
  // #4490 08-O5 part A: PINs on a shared Till device (spec 08 §3 O5 copy).
  pin_session_required: "Pick who's selling to carry on.",
  pin_session_invalid: "This PIN session ended. Pick who's selling and enter your PIN.",
  pin_step_up_required: "Enter your PIN again to confirm",
  pin_step_up_cancelled: "Nothing was changed.",
  pin_wrong: "Wrong PIN. Try again.",
  pin_locked: "Locked for 5 minutes",
  pin_hard_locked: "Ask a manager to unlock your PIN",
  pin_device_limited: "Too many tries on this device. Wait 10 minutes, or ask a manager.",
  pin_no_rights: "This needs someone with money rights. Pick who's approving.",
  pin_weak: "Pick a PIN that's harder to guess. Not 1234, 0000 or one digit repeated.",
  pin_invalid: "Use 4 to 6 digits.",
  pin_email_code_required: "Enter the code we emailed to this Till's login, then sign out.",
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
