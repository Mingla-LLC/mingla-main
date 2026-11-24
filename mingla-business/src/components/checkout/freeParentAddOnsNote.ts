/**
 * issue #3281 — the cart note for a free ticket with paid add-ons. Its own
 * module so the event cart reads it without loading the add-on picker, which
 * every cart (event, trip, experience) loads on use.
 */

import {
  parsePublicTicketExtras,
  type PublicTicketExtra,
} from "@mingla/offering-rendering/ticketExtrasCart";

import type { CartLine } from "./CartContext";

/** #3281 S4 — the cart note when every ticket is free and the add-ons are not. */
export const FREE_PARENT_ADD_ONS_NOTE = "The ticket is free; you only pay for the add-ons.";

/**
 * #3281 S4 — the free-parent note, or null. Shown only once the server has
 * priced the cart (the quote's extras total), so it never guesses: every line
 * with tickets is free, and the add-ons cost something.
 */
export const freeParentAddOnsNote = (
  lines: readonly Pick<CartLine, "isFree" | "quantity">[],
  extrasTotalCents: number | null | undefined,
): string | null => {
  const held = lines.filter((line) => line.quantity > 0);
  if (held.length === 0 || !held.every((line) => line.isFree)) return null;
  return typeof extrasTotalCents === "number" && extrasTotalCents > 0
    ? FREE_PARENT_ADD_ONS_NOTE
    : null;
};

/**
 * #3281 W-8 — the server refuses a paid add-on on a free ticket while the
 * free-parent switch is off, and it does not tell buyers which way the switch
 * is set. Once the cart's quote answers `extras_need_paid_ticket` the picker
 * stops offering paid add-ons on free tickets (free ones stay) and the paid
 * ones already in the cart come off, so nothing is offered that the server
 * will refuse and the buyer is never left on "Couldn't get your price".
 */
export const FREE_PARENT_REFUSAL = "extras_need_paid_ticket";

/** The extras a free ticket may still offer once paid ones are refused. */
export const extrasOfferableOnTicket = (
  buyerExtras: unknown,
  isFree: boolean,
  paidOnFreeRefused: boolean,
): unknown => {
  if (!paidOnFreeRefused || !isFree || !Array.isArray(buyerExtras)) return buyerExtras;
  const free = buyerExtras.filter((raw) => {
    const extra = parsePublicTicketExtras([raw])[0];
    return extra !== undefined && extra.priceCents === 0;
  });
  return free;
};

/**
 * The cart lines with paid add-ons taken off the free tickets; `null` when no
 * line carries one (nothing to change).
 */
export const withoutPaidAddOnsOnFreeLines = <
  L extends Pick<CartLine, "isFree" | "addOns" | "ticketTypeId">,
>(
  lines: readonly L[],
  extrasByTicket: ReadonlyMap<string, readonly PublicTicketExtra[]>,
): L[] | null => {
  let changed = false;
  const next = lines.map((line) => {
    if (!line.isFree || (line.addOns?.length ?? 0) === 0) return line;
    const paid = new Set(
      (extrasByTicket.get(line.ticketTypeId) ?? [])
        .filter((extra) => extra.priceCents > 0)
        .map((extra) => extra.id),
    );
    const kept = (line.addOns ?? []).filter((addOn) => !paid.has(addOn.addOnId));
    if (kept.length === (line.addOns ?? []).length) return line;
    changed = true;
    return { ...line, addOns: kept };
  });
  return changed ? next : null;
};
