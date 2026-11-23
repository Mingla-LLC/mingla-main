/**
 * issue #3281 W-8 — with the free-parent switch off the server refuses a paid
 * add-on on a free ticket. After that answer the cart stops offering paid add-ons
 * on free tickets and takes the paid ones off.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

import { parsePublicTicketExtras } from "@mingla/offering-rendering/ticketExtrasCart";
import {
  extrasOfferableOnTicket,
  FREE_PARENT_REFUSAL,
  withoutPaidAddOnsOnFreeLines,
} from "../freeParentAddOnsNote";

const raw = (id: string, priceCents: number) => ({
  id,
  name: id,
  description: null,
  priceCents,
  priceAllInCents: priceCents,
  maxPerTicket: 2,
  isUnlimited: true,
  validOccurrenceIds: null,
  remaining: null,
});
const extras = [raw("free-snack", 0), raw("paid-drink", 800)];

describe("issue #3281 W-8 — paid add-on on a free ticket", () => {
  test("before a refusal everything is offered", () => {
    expect(extrasOfferableOnTicket(extras, true, false)).toBe(extras);
  });
  test("after the refusal a free ticket offers only the free add-on", () => {
    const out = extrasOfferableOnTicket(extras, true, true) as unknown[];
    expect(out).toHaveLength(1);
    expect((out[0] as { id: string }).id).toBe("free-snack");
  });
  test("a paid ticket keeps its paid add-ons after the refusal", () => {
    expect(extrasOfferableOnTicket(extras, false, true)).toBe(extras);
  });
  test("the paid add-on comes off the free line, the free one stays", () => {
    const lines = [
      {
        ticketTypeId: "t1",
        isFree: true,
        addOns: [
          { addOnId: "free-snack", quantity: 1 },
          { addOnId: "paid-drink", quantity: 1 },
        ],
      },
      { ticketTypeId: "t2", isFree: false, addOns: [{ addOnId: "paid-drink", quantity: 1 }] },
    ];
    const byTicket = new Map([
      ["t1", parsePublicTicketExtras(extras)],
      ["t2", parsePublicTicketExtras(extras)],
    ]);
    const next = withoutPaidAddOnsOnFreeLines(lines, byTicket);
    expect(next).not.toBeNull();
    expect(next![0].addOns).toEqual([{ addOnId: "free-snack", quantity: 1 }]);
    expect(next![1]).toBe(lines[1]);
  });
  test("nothing to take off -> null (no loop)", () => {
    const lines = [{ ticketTypeId: "t1", isFree: true, addOns: [{ addOnId: "free-snack", quantity: 1 }] }];
    expect(
      withoutPaidAddOnsOnFreeLines(lines, new Map([["t1", parsePublicTicketExtras(extras)]])),
    ).toBeNull();
  });
  test("the refusal code is the one the server sends", () => {
    expect(FREE_PARENT_REFUSAL).toBe("extras_need_paid_ticket");
  });
  test("the event checkout wires the refusal to the picker and the cart", () => {
    const src = readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "app", "checkout", "[eventId]", "index.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/withoutPaidAddOnsOnFreeLines\(/);
    expect(src).toMatch(/extrasOfferableOnTicket\(/);
    expect(src).toMatch(/ticket=\{offerable\(ticket\)\}/);
  });
});
