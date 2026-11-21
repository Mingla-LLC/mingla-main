/**
 * issue #3281 S4 — a free ticket with paid add-ons: the event cart says
 * "The ticket is free; you only pay for the add-ons." once the server priced
 * the add-ons above zero, and never otherwise.
 *
 * Fails on revert: drop the every-line-free check or the priced-total check in
 * `freeParentAddOnsNote` (src/components/checkout/freeParentAddOnsNote.ts) -> red.
 */
import { describe, expect, test } from "@jest/globals";

import {
  FREE_PARENT_ADD_ONS_NOTE,
  freeParentAddOnsNote,
} from "../freeParentAddOnsNote";

const free = { isFree: true, quantity: 1 };
const paid = { isFree: false, quantity: 1 };

describe("#3281 S4 — free-parent add-ons note", () => {
  test("every held ticket free and add-ons priced above zero -> the note", () => {
    expect(FREE_PARENT_ADD_ONS_NOTE).toBe("The ticket is free; you only pay for the add-ons.");
    expect(freeParentAddOnsNote([free], 2500)).toBe(FREE_PARENT_ADD_ONS_NOTE);
    // A free line set back to zero doesn't count as held.
    expect(freeParentAddOnsNote([free, { isFree: false, quantity: 0 }], 2500)).toBe(
      FREE_PARENT_ADD_ONS_NOTE,
    );
  });

  test("a paid ticket in the cart, free add-ons, or no priced quote -> no note", () => {
    expect(freeParentAddOnsNote([free, paid], 2500)).toBeNull();
    expect(freeParentAddOnsNote([free], 0)).toBeNull();
    expect(freeParentAddOnsNote([free], undefined)).toBeNull();
    expect(freeParentAddOnsNote([free], null)).toBeNull();
    expect(freeParentAddOnsNote([], 2500)).toBeNull();
    expect(freeParentAddOnsNote([{ isFree: true, quantity: 0 }], 2500)).toBeNull();
  });
});
