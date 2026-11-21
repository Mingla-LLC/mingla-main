/**
 * issue #3281 — the cart note for a free ticket with paid add-ons. Its own
 * module so the event cart reads it without loading the add-on picker, which
 * every cart (event, trip, experience) loads on use.
 */

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
