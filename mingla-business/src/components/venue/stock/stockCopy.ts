/**
 * #4490 spec 08 O5 part C — every word about stock counts, kitchen "Sold out"
 * and sold out after payment. Amounts are {amount} slots filled by
 * formatCurrency (rule 10). Raw server codes never reach the screen: an
 * unknown code reads STOCK_ERROR_COPY.stock_failed.
 */

import { GUEST_SOLD_OUT_COPY } from "./guestSoldOut";

export const STOCK_COPY = {
  // Menu › item › Stock (spec §2 screen 19).
  section: "Stock",
  track: "Track stock",
  trackHint: "Sells out by itself at 0, on the Till and the guest menu.",
  count: "Count",
  warnAt: "Warn me at",
  rule: "Counts change only through here and sales. Sold out never switches the item off.",
  saveCount: "Save count",
  saveCountN: (n: number): string => `Save count · ${n}`,
  stopTracking: "Stop tracking",
  saved: "Saved.",
  stopped: "Not tracked any more.",
  soldOutAt: (time: string): string => `Sold out at ${time}`,
  lastSet: (name: string, time: string): string => `Last set by ${name} at ${time}`,
  lastSetNoName: (time: string): string => `Last set at ${time}`,
  // Pills.
  soldOut: "Sold out",
  left: (n: number): string => `${n} left`,
  // Station board (T15).
  boardButton: "Sold out",
  boardTitle: "Mark sold out",
  boardSub: "Shows Sold out on the Till and every guest menu straight away.",
  boardSearch: "Find an item",
  boardRow: (left: number | null, tickets: number): string => {
    const count = left === null ? "Not counted" : `${left} left`;
    if (tickets === 0) return count;
    return `${count} · on ${tickets} open ${tickets === 1 ? "ticket" : "tickets"}`;
  },
  boardMarked: (time: string, name: string | null): string =>
    name ? `Sold out at ${time} by ${name}` : `Sold out at ${time}`,
  boardMark: "Sold out",
  boardBackOn: "Back on",
  boardFooter: "Back on works for items the kitchen marked tonight. Counts are set by a manager in Menu.",
  boardEmpty: "Nothing on the menu goes to this station.",
  boardDoneTitle: (item: string): string => `${item} is sold out`,
  boardDoneBody: "The Till and guest menus show Sold out now. Tickets already sent stay on the board.",
  undo: "Undo",
  // Sold out after payment (T16), on the staff order.
  afterPayment: "Sold out after payment",
  afterPaymentBody: "It sold out after the guest paid. Swap it or refund it; it's never dropped silently.",
  swapItem: "Swap item",
  refundAmount: (amount: string): string => `Refund ${amount}`,
  swapTitle: (item: string): string => `Swap ${item}`,
  swapSub: "Same price or less, from the kitchen. The guest is told by text and email.",
  swapCheaper: (price: string, back: string): string => `${price} · ${back} goes back to the guest`,
  swapSame: (price: string): string => `${price} · same price`,
  swapDearer: (price: string): string => `${price} · costs more, can't swap`,
  swapCheaperNeedsRefund: (price: string): string => `${price} · gives money back, ask someone who can refund`,
  swapSameNeedsSeller: (price: string): string => `${price} · same price, ask someone who sells or runs the kitchen`,
  swapOtherStation: (price: string): string => `${price} · made at another station`,
  swapRule: "Only items that cost the same or less are offered, so the guest never pays more.",
  swapTo: (item: string): string => `Swap to ${item}`,
  swapNone: "Nothing on the menu costs the same or less right now. Refund it instead.",
  refundConfirmTitle: (amount: string): string => `Refund ${amount}?`,
  refundConfirmBody: "The money goes back to the guest's card, and they're told by text and email.",
  swapConfirmTitle: (amount: string): string => `Swap and give back ${amount}?`,
  swapConfirmBody: (item: string): string =>
    `The guest gets ${item} instead. The difference goes back to their card, and they're told by text and email.`,
  swapConfirmGo: (amount: string): string => `Swap and give back ${amount}`,
  swapped: (item: string): string => `Swapped for ${item}`,
  refunded: (amount: string): string => `Refunded ${amount}`,
  waitingCount: (n: number): string =>
    n === 1 ? "1 guest order needs a swap or refund" : `${n} guest orders need a swap or refund`,
  // The guest's order page (guestSoldOut.ts; the order page loads only that).
  ...GUEST_SOLD_OUT_COPY,
  // Till refusals (item_sold_out).
  soldOutBeforePaying: (item: string): string => `${item} sold out. Take it off before paying.`,
  soldOutBeforeSending: (item: string): string => `${item} sold out. Take it off before sending.`,
  onlyLeft: (n: number): string => `Only ${n} left. Change the quantity.`,
} as const;

export const STOCK_ERROR_COPY: Record<string, string> = {
  not_authorized: "You don't have the rights for this. Ask a manager.",
  forbidden: "You don't have the rights for this. Ask a manager.",
  till_not_enabled: "Stock counts come with the Till. Switch the Till on for this venue first.",
  stations_not_enabled: "Station screens are off for this venue.",
  stock_invalid: "Use a whole number from 0 to 99,999.",
  stock_item_not_found: "That item isn't on this venue's menu any more. Refresh and try again.",
  stock_not_kitchen_mark: "Only an item the kitchen marked sold out tonight can come back on here. A manager can restock it in Menu.",
  item_sold_out: "That item just sold out. Pick another one.",
  order_not_found: "That order isn't at this venue. Refresh and try again.",
  sold_out_line_not_found: "That line isn't waiting for a swap or refund any more. Refresh to see what changed.",
  sold_out_already_resolved: "Someone already sorted this line. Refresh to see what was done.",
  sold_out_swap_not_orderable: "That item can't be ordered right now. Pick another one.",
  sold_out_swap_other_station: "Swap to something made at the same station.",
  sold_out_swap_dearer: "That costs more, so it can't be a swap. Pick something the same price or less.",
  sold_out_refund_once: "This order already had one sold-out refund. Swap the rest for the same price or less.",
  already_refunded: "This order's money was already refunded, or a refund is on its way.",
  sold_out_invalid: "Something was missing. Refresh and try again.",
  pin_session_required: "Pick who's selling on the Till first.",
  pin_session_invalid: "Pick who's selling on the Till first.",
  pin_step_up_required: "A refund needs a PIN from someone who can refund. Try again and enter it.",
  // #4490 08-O5 fix 3: a swap to something cheaper gives money back, so it is a refund.
  sold_out_key_reused: "That was already sorted with different lines. Refresh and try again.",
  pin_step_up_cancelled: "Nothing was changed.",
  network: "No connection. Check the network and try again.",
  stock_failed: "That didn't save. Try again.",
};

export function stockErrorCopy(code: string): string {
  return STOCK_ERROR_COPY[code] ?? STOCK_ERROR_COPY.stock_failed;
}
