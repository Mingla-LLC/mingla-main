// MINGLA-INVARIANT: I-ADDON-MINOR-UNITS | issue #3281 | Add-on money is integer minor units from the editor's money parser to the save payload; a typed amount with more digits than its currency allows is refused, never rounded.
/**
 * issue #3281 S3 — the Add-ons editor model (pure).
 *
 * Fails on revert: parse prices with parseFloat * 100, drop the multi-link
 * or free-ticket checks, or let a save list lose the add-ons it did not edit
 * -> red.
 */

import { describe, expect, test } from "@jest/globals";

import {
  addOnErrorCopy,
  addOnSummaryLine,
  buildSaveList,
  datesForTargets,
  emptyAddOnForm,
  formFromAddOn,
  minorToPriceText,
  parseOfferingAddOns,
  parsePriceToMinor,
  validateAddOnForm,
  type AddOnFormContext,
  type OfferingAddOnsPayload,
} from "../addOnsEditorModel";

const PAID = "32813000-0000-4000-8300-000000000012";
const FREE = "32813000-0000-4000-8300-000000000011";
const FRIDAY = "32813000-0000-4000-8300-000000000013";

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventId: "32813000-0000-4000-8300-000000000004",
  eventType: "event",
  revision: 7,
  multiLinkEnabled: false,
  freeParentEnabled: false,
  currency: "USD",
  dates: [
    { key: "d1", startsAt: "2027-03-12T19:00:00Z", timezone: "UTC" },
    { key: "d2", startsAt: "2027-03-13T19:00:00Z", timezone: "UTC" },
  ],
  targets: [
    { kind: "ticket_type", ticketTypeId: FREE, name: "Free entry", isFree: true, priceCents: 0, validOccurrenceKeys: null },
    { kind: "ticket_type", ticketTypeId: PAID, name: "Paid entry", isFree: false, priceCents: 1000, validOccurrenceKeys: null },
    { kind: "ticket_type", ticketTypeId: FRIDAY, name: "Friday", isFree: false, priceCents: 1500, validOccurrenceKeys: ["d1"] },
  ],
  addOns: [
    {
      id: "a1", name: "Dinner", description: null, priceCents: 2550, isUnlimited: false,
      quantityTotal: 40, maxPerTicket: 2, validOccurrenceKeys: null, photoPath: null,
      photoThumbPath: null, showOnPublicPage: true, sortOrder: 0, soldCount: 3,
      soldOccurrenceKeys: [], targets: [{ kind: "ticket_type", ticketTypeId: PAID }],
    },
    {
      id: "a2", name: "Tote", description: "Canvas", priceCents: 0, isUnlimited: true,
      quantityTotal: null, maxPerTicket: 1, validOccurrenceKeys: null, photoPath: null,
      photoThumbPath: null, showOnPublicPage: false, sortOrder: 1, soldCount: 0,
      soldOccurrenceKeys: [], targets: [{ kind: "ticket_type", ticketTypeId: FREE }],
    },
  ],
  ...over,
});

const ctx = (payload: OfferingAddOnsPayload, currency = "USD"): AddOnFormContext => ({
  payload,
  currency,
  kind: "event",
});

describe("money is integer minor units", () => {
  test("typed prices parse exactly, with the currency's own digits", () => {
    expect(parsePriceToMinor("", "USD")).toBe(0);
    expect(parsePriceToMinor("25", "USD")).toBe(2500);
    expect(parsePriceToMinor("25.5", "USD")).toBe(2550);
    expect(parsePriceToMinor("0.29", "USD")).toBe(29);
    expect(parsePriceToMinor("1,250.10", "NGN")).toBe(125010);
    expect(parsePriceToMinor("4500", "JPY")).toBe(4500);
    expect(parsePriceToMinor("45.5", "JPY")).toBeNull();
    expect(parsePriceToMinor("25.555", "USD")).toBeNull();
    expect(parsePriceToMinor("-1", "USD")).toBeNull();
    expect(parsePriceToMinor("abc", "USD")).toBeNull();
    for (const text of ["0.29", "1.15", "19.99", "4.35"]) {
      expect(Number.isInteger(parsePriceToMinor(text, "USD"))).toBe(true);
    }
  });

  test("minor units back to the text a host edits", () => {
    expect(minorToPriceText(2550, "USD")).toBe("25.50");
    expect(minorToPriceText(2500, "USD")).toBe("25");
    expect(minorToPriceText(0, "USD")).toBe("");
    expect(minorToPriceText(4500, "JPY")).toBe("4500");
  });
});

describe("the payload and the whole-list save", () => {
  test("reads the RPC payload and refuses a shape it does not know", () => {
    const payload = parseOfferingAddOns(raw());
    expect(payload.revision).toBe(7);
    expect(payload.targets.map((t) => t.key)).toEqual([`tt:${FREE}`, `tt:${PAID}`, `tt:${FRIDAY}`]);
    expect(payload.addOns[0].targets).toEqual([{ kind: "ticket_type", ticketTypeId: PAID }]);
    expect(() => parseOfferingAddOns({ addOns: [] })).toThrow("add_ons_payload_invalid");
  });

  test("editing one add-on sends every add-on, the edited one in minor units", () => {
    const payload = parseOfferingAddOns(raw());
    const form = { ...formFromAddOn(payload.addOns[1], "USD"), name: "Tote bag", stockText: "50" };
    const list = buildSaveList(payload, ctx(payload), { form });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "a1", priceCents: 2550, quantityTotal: 40, isUnlimited: false });
    expect(list[1]).toMatchObject({ id: "a2", name: "Tote bag", isUnlimited: false, quantityTotal: 50, priceCents: 0 });
  });

  test("a new add-on is appended; a removed one is left out (it stops selling)", () => {
    const payload = parseOfferingAddOns(raw());
    const form = { ...emptyAddOnForm([`tt:${PAID}`]), name: "Parking", priceText: "10.25" };
    const added = buildSaveList(payload, ctx(payload), { form });
    expect(added).toHaveLength(3);
    expect(added[2]).toEqual(expect.objectContaining({
      name: "Parking", priceCents: 1025, isUnlimited: true, quantityTotal: null,
      targets: [{ kind: "ticket_type", ticketTypeId: PAID }], sortOrder: 2,
    }));
    expect(added[2]).not.toHaveProperty("id");
    const removed = buildSaveList(payload, ctx(payload), { removeId: "a1" });
    expect(removed.map((item) => item.id)).toEqual(["a2"]);
  });
});

describe("rules mirror the server's refusals", () => {
  const payload = parseOfferingAddOns(raw());
  const base = { ...emptyAddOnForm([`tt:${PAID}`]), name: "Dinner", priceText: "25" };

  test("a valid form has no problem", () => {
    expect(validateAddOnForm(base, ctx(payload))).toBeNull();
  });
  test("one ticket while multi-link is off; several once it is on", () => {
    const two = { ...base, targetKeys: [`tt:${PAID}`, `tt:${FRIDAY}`] };
    expect(validateAddOnForm(two, ctx(payload))).toBe("Each add-on can come with one ticket for now.");
    const on = parseOfferingAddOns(raw({ multiLinkEnabled: true }));
    expect(validateAddOnForm(two, ctx(on))).toBeNull();
  });
  test("a paid add-on on a free ticket waits for free parents", () => {
    const paidOnFree = { ...base, targetKeys: [`tt:${FREE}`] };
    expect(validateAddOnForm(paidOnFree, ctx(payload))).toMatch(/^Paid add-ons need a paid ticket/);
    const on = parseOfferingAddOns(raw({ freeParentEnabled: true }));
    expect(validateAddOnForm(paidOnFree, ctx(on))).toBeNull();
  });
  test("no target, a bad price, a bad limit, stock under what sold", () => {
    expect(validateAddOnForm({ ...base, targetKeys: [] }, ctx(payload))).toBe("Pick at least one ticket for this add-on.");
    expect(validateAddOnForm({ ...base, priceText: "2.555" }, ctx(payload))).toMatch(/^Enter a price/);
    expect(validateAddOnForm({ ...base, limitText: "21" }, ctx(payload))).toBe("Set a limit from 1 to 20.");
    const sold = formFromAddOn(payload.addOns[0], "USD");
    expect(validateAddOnForm({ ...sold, stockText: "2" }, ctx(payload))).toBe("3 already sold, so stock can't go below that.");
    expect(validateAddOnForm({ ...sold, priceText: "30" }, ctx(payload))).toBe("Add-ons people already bought keep their price.");
  });
  test("dates come from the chosen tickets", () => {
    expect(datesForTargets(payload, [`tt:${FRIDAY}`]).map((d) => d.key)).toEqual(["d1"]);
    expect(datesForTargets(payload, [`tt:${PAID}`]).map((d) => d.key)).toEqual(["d1", "d2"]);
    const outside = { ...base, targetKeys: [`tt:${FRIDAY}`], dateKeys: ["d2"] };
    expect(validateAddOnForm(outside, ctx(payload))).toBe("This add-on has dates none of its tickets cover.");
  });
});

describe("copy", () => {
  test("every server code has host copy, never naming a vendor or 'Extras'", () => {
    expect(addOnErrorCopy("add_ons_changed_elsewhere")).toBe(
      "Someone else changed these add-ons. We've loaded the latest; check and save again.",
    );
    expect(addOnErrorCopy("add_on_multi_link_off")).toBe("Each add-on can come with one ticket for now.");
    expect(addOnErrorCopy("something_new")).toBe("Add-ons didn't save. Check your connection and try again.");
    expect(addOnErrorCopy(null)).toBe("Add-ons didn't save. Check your connection and try again.");
  });
  test("list rows say the price, the limit, the stock and when it sold out", () => {
    const payload = parseOfferingAddOns(raw());
    const fmt = (minor: number): string => `$${(minor / 100).toFixed(2)}`;
    expect(addOnSummaryLine(payload.addOns[0], fmt, "event")).toBe("$25.50 · 2 per ticket · 40 in stock · 3 sold");
    expect(addOnSummaryLine(payload.addOns[1], fmt, "trip")).toBe("Free · 1 per package · No stock limit");
    const soldOut = { ...payload.addOns[0], soldCount: 40 };
    expect(addOnSummaryLine(soldOut, fmt, "event")).toBe("$25.50 · Sold out · 40/40");
  });
});
