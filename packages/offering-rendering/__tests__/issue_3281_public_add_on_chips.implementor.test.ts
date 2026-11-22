// MINGLA-INVARIANT: I-ADDON-PUBLIC-BLOCK-SHOWN-ONLY | issue #3281 | The public add-on list shows only add-ons the host marked to show, priced at the server all-in in minor units, sold out when no stock is left on any date, and reads a stored thumbnail path, never building an image transformation URL.
/**
 * issue #3281 S2 — the pure half of the public "Add at checkout:" block.
 * FAILS-ON-REVERT: list a hidden add-on, price from priceCents instead of the
 * all-in, call a partly sold out dated add-on sold out, or format major units
 * as minor -> red.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { formatAddOnMoney, publicAddOnChips } from "../offeringAddOnChips.ts";

const item = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "a1",
  name: "Friday dinner",
  description: null,
  priceCents: 2500,
  priceAllInCents: 2750,
  maxPerTicket: 2,
  isUnlimited: false,
  validOccurrenceIds: null,
  remaining: 4,
  showOnPublicPage: true,
  photoPath: "add-ons/e/p.jpg",
  photoThumbPath: "add-ons/e/p_thumb.jpg",
  ...over,
});

Deno.test("#3281 S2 shown add-ons only, in the reader's order, all-in price", () => {
  const chips = publicAddOnChips([
    item({}),
    item({ id: "a2", name: "Hidden", showOnPublicPage: false }),
    item({ id: "a3", name: "Tote", priceCents: 0, priceAllInCents: 0, photoThumbPath: null }),
  ]);
  assertEquals(chips, [
    { id: "a1", name: "Friday dinner", priceAllInCents: 2750, soldOut: false, photoThumbPath: "add-ons/e/p_thumb.jpg" },
    { id: "a3", name: "Tote", priceAllInCents: 0, soldOut: false, photoThumbPath: null },
  ]);
});

Deno.test("#3281 S2 sold out means none left anywhere; unlimited never sells out", () => {
  const [none, partly, dated, unlimited] = publicAddOnChips([
    item({ id: "n", remaining: 0 }),
    item({ id: "p", remaining: { d1: 0, d2: 3 } }),
    item({ id: "d", remaining: { d1: 0, d2: 0 } }),
    item({ id: "u", isUnlimited: true, remaining: null }),
  ]);
  assertEquals([none.soldOut, partly.soldOut, dated.soldOut, unlimited.soldOut], [true, false, true, false]);
});

Deno.test("#3281 S2 anything that is not a list, or a broken item, lists nothing", () => {
  assertEquals(publicAddOnChips(undefined), []);
  assertEquals(publicAddOnChips({}), []);
  assertEquals(publicAddOnChips([{ id: 1 }, item({ priceCents: -1 })]), []);
});

Deno.test("#3281 S2 money is minor units in the offering's currency", () => {
  assertEquals(formatAddOnMoney(2750, "USD").replace(/\s/g, ""), "$27.50");
  assertEquals(formatAddOnMoney(150000, "NGN").replace(/\s/g, "").startsWith("₦1,500"), true);
  assertEquals(formatAddOnMoney(500, null), "5.00");
});
