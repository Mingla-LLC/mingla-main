/**
 * Issue #1792 (#1767 Phase 3b) — the order pad's rules, and the ONE promise the
 * kitchen depends on (DESIGN D-11, D-2 AMENDED, D-3, D-3a, D-9).
 *
 * EVERY assertion here EXECUTES the rule it names. The four claims that can
 * only be made by looking at what is NOT there — no `source` branch in the
 * queue's rendering surfaces, one shared spot list, no client-side money
 * arithmetic, one keyboard-aware scroll — live in the strict-grep gate
 * `.github/scripts/strict-grep/issue-1792-waiter-mode-structural.mjs`, which is
 * where I-PROPOSED-1047 says a genuine structural rule belongs and which runs
 * repo-wide rather than only when this file does.
 *
 * # Fails-on-revert
 * Let `orderPadSubmitLines` emit a price → T-P20 goes RED (the P-20 boundary).
 * Offer an inactive spot → T-SPOT1 goes RED and the pad starts proposing tables
 * the server answers `spot_unknown` for. Drop a modifier group's `minSelect`
 * check → T-MOD1 goes RED and the server starts answering
 * `modifier_selection_invalid` at a waiter. Enable `charge_to_room` without
 * building it → T-SETTLE2 goes RED. Make ANY queue derivation depend on
 * `source` → T-SAME1 goes RED, which is D-11's flat requirement that the
 * kitchen cannot tell how a ticket arrived.
 *
 * New sibling file (append-only safe).
 */
import { describe, expect, test } from "@jest/globals";

import {
  ORDER_PAD_MAX_QUANTITY,
  ORDER_PAD_SETTLEMENT_OPTIONS,
  addLineToCart,
  billContactReadiness,
  cartCurrency,
  cartItemCount,
  cartLineIdentity,
  filterMenuSections,
  filterSpotGroups,
  modifierGroupState,
  nextModifierPrompt,
  orderPadReadiness,
  orderPadSubmitLines,
  orderableMenuSections,
  orderableSpotGroups,
  setLineQuantity,
  settlementMethodIsSendable,
  tabAcceptsRounds,
  tabDestinationLabel,
  tabRoundsLabel,
  toggleModifier,
  type OrderPadLine,
  type OrderPadMenuItem,
  type OrderPadModifierGroup,
  type OrderPadSpot,
  type OrderPadTab,
} from "../orderPad/venueOrderPad";
import { groupSpotsByVenue, isPrintable } from "../qrSpots";
import {
  VENUE_ORDER_STATUS_PRESENTATION,
  escalationNotice,
  filterVenueOrdersForView,
  legalActionsFor,
  liveOrderCount,
  sortForQueue,
  venueOrderDestinationLabel,
  type VenueOrder,
} from "../venueOrderViews";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function spot(over: Partial<OrderPadSpot> = {}): OrderPadSpot {
  return {
    id: "spot-1",
    brandId: "brand-1",
    venueId: "venue-1",
    kind: "table",
    venueTableId: "table-1",
    stayUnitId: null,
    zone: "indoor",
    label: "Table 12",
    servingVenueId: "venue-1",
    servingMenuId: null,
    code: "kq7m3pd2xr",
    isActive: true,
    autoProvisioned: true,
    sortOrder: 1,
    lastPrintedAt: null,
    ...over,
  };
}

function item(over: Partial<OrderPadMenuItem> = {}): OrderPadMenuItem {
  return {
    id: "item-1",
    menuId: "menu-1",
    menuName: "All day",
    name: "Negroni",
    priceCents: 1200,
    currency: "GBP",
    isAvailable: true,
    allowsNotes: true,
    sortOrder: 1,
    ...over,
  };
}

function group(over: Partial<OrderPadModifierGroup> = {}): OrderPadModifierGroup {
  return {
    id: "group-1",
    menuItemId: "item-1",
    name: "Ice",
    selectionMode: "single",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 1,
    modifiers: [
      {
        id: "mod-1",
        name: "With ice",
        priceDeltaCents: 0,
        currency: "GBP",
        isAvailable: true,
        sortOrder: 1,
      },
      {
        id: "mod-2",
        name: "Neat",
        priceDeltaCents: 0,
        currency: "GBP",
        isAvailable: true,
        sortOrder: 2,
      },
    ],
    ...over,
  };
}

function line(over: Partial<OrderPadLine> = {}): OrderPadLine {
  return {
    key: cartLineIdentity("item-1", [], null),
    menuItemId: "item-1",
    name: "Negroni",
    unitPriceCents: 1200,
    currency: "GBP",
    quantity: 1,
    modifierIds: [],
    modifierNames: [],
    notes: null,
    ...over,
  };
}

function tab(over: Partial<OrderPadTab> = {}): OrderPadTab {
  return {
    sessionId: "session-1",
    venueId: "venue-1",
    qrSpotId: "spot-1",
    spotLabel: "Table 12",
    tabState: "open",
    currency: "GBP",
    roundCount: 2,
    outstandingSubtotalCents: 4800,
    outstandingServiceChargeCents: 600,
    outstandingTipCents: 0,
    outstandingTotalCents: 5400,
    openedAt: "2026-08-11T18:00:00.000Z",
    lastOrderAt: "2026-08-11T18:20:00.000Z",
    ...over,
  };
}

function order(over: Partial<VenueOrder> = {}): VenueOrder {
  return {
    id: "order-1",
    brandId: "brand-1",
    venueId: "venue-1",
    sessionId: "session-1",
    fulfillmentStatus: "placed",
    paymentStatus: "paid",
    source: "guest_qr",
    spotLabel: "Table 12",
    pickupCode: null,
    zone: "indoor",
    buyerName: "Amara",
    currency: "GBP",
    totalCents: 2400,
    tipCents: 0,
    itemCount: 2,
    lines: [],
    placedAt: "2026-08-11T18:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    readyAt: null,
    deliveredAt: null,
    refundRequestedAt: null,
    refundDecision: null,
    escalationLevel: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// D-11's flat requirement: THE KITCHEN CANNOT TELL HOW A TICKET ARRIVED.
// ---------------------------------------------------------------------------
describe("issue #1792 — a staff ticket is indistinguishable from a scanned one", () => {
  test("T-SAME1 — every queue derivation is byte-identical for staff and guest_qr", () => {
    // Two orders differing in EXACTLY one field. If any queue-facing derivation
    // reads `source`, one of these assertions separates them.
    const scanned = order({ id: "a", source: "guest_qr" });
    const taken = order({ id: "a", source: "staff" });

    expect(venueOrderDestinationLabel(taken)).toBe(
      venueOrderDestinationLabel(scanned),
    );
    expect(legalActionsFor(taken.fulfillmentStatus)).toEqual(
      legalActionsFor(scanned.fulfillmentStatus),
    );
    expect(VENUE_ORDER_STATUS_PRESENTATION[taken.fulfillmentStatus]).toEqual(
      VENUE_ORDER_STATUS_PRESENTATION[scanned.fulfillmentStatus],
    );
    expect(escalationNotice(taken)).toBe(escalationNotice(scanned));
    expect(liveOrderCount([taken])).toBe(liveOrderCount([scanned]));
    for (const view of ["new", "in_progress", "ready", "refunds", "done"] as const) {
      expect(filterVenueOrdersForView([taken], view).length).toBe(
        filterVenueOrdersForView([scanned], view).length,
      );
    }
    // And they interleave by TIME, not by provenance: a staff ticket does not
    // sort above or below a scanned one.
    const mixed = sortForQueue([
      order({ id: "s1", source: "staff", placedAt: "2026-08-11T18:05:00.000Z" }),
      order({ id: "g1", source: "guest_qr", placedAt: "2026-08-11T18:10:00.000Z" }),
      order({ id: "s2", source: "staff", placedAt: "2026-08-11T18:15:00.000Z" }),
    ]);
    expect(mixed.map((o) => o.id)).toEqual(["s2", "g1", "s1"]);
  });

});

// ---------------------------------------------------------------------------
// ONE spot list (D-3 / D-3b).
// ---------------------------------------------------------------------------
describe("issue #1792 — the pad orders against the PRINTED spots", () => {
  test("T-SPOT1 — inactive spots are never offered, and an empty venue is dropped", () => {
    const groups = orderableSpotGroups(
      [
        spot({ id: "a", label: "Table 12" }),
        spot({ id: "b", label: "Table 9", isActive: false }),
        spot({ id: "c", venueId: "venue-2", label: "Room 204", isActive: false }),
      ],
      [
        { id: "venue-1", name: "The Brasserie", slug: "brasserie" },
        { id: "venue-2", name: "The Hotel", slug: "hotel" },
      ],
    );
    // venue-2's only spot is inactive (a room whose kitchen was never chosen),
    // so the venue does not appear at all rather than appearing empty.
    expect(groups.map((g) => g.venueName)).toEqual(["The Brasserie"]);
    expect(groups[0].spots.map((s) => s.id)).toEqual(["a"]);
  });

  test("T-SPOT4 — the pad's ordering IS the Spots list's ordering, executed", () => {
    // The pad cannot import `groupSpotsByVenue` at runtime: a value edge from
    // the Orders chunk to the Spots module hoists that module into the EAGER
    // `__common` boot payload (measured +1,972 B against the ORCH-1083 cap).
    // So the two implementations are compared HERE, where an import is free —
    // same venues in the same order, same spots in the same order, every time.
    // Drift in either one turns this red.
    const spots = [
      spot({ id: "c", label: "Table 9", sortOrder: 2 }),
      spot({ id: "a", label: "Table 12", sortOrder: 1 }),
      spot({ id: "d", label: "Table 1", sortOrder: 2 }),
      spot({ id: "e", venueId: "venue-2", label: "Rooftop", sortOrder: 1 }),
      spot({ id: "f", venueId: "venue-2", label: "Dead spot", isActive: false }),
    ];
    const venues = [
      { id: "venue-1", name: "The Brasserie", slug: "brasserie" },
      { id: "venue-2", name: "A Roof", slug: "roof" },
    ];
    const mine = orderableSpotGroups(spots, venues);
    const shipped = groupSpotsByVenue([...spots], [...venues])
      .map((g) => ({
        venueId: g.venueId,
        venueName: g.venueName,
        spots: g.spots.filter(isPrintable),
      }))
      .filter((g) => g.spots.length > 0);

    expect(mine.map((g) => g.venueId)).toEqual(shipped.map((g) => g.venueId));
    expect(mine.map((g) => g.venueName)).toEqual(shipped.map((g) => g.venueName));
    expect(mine.map((g) => g.spots.map((s) => s.id))).toEqual(
      shipped.map((g) => g.spots.map((s) => s.id)),
    );
    // Vacuity guard: the fixture must actually exercise BOTH tie-breakers and
    // the inactive filter, or "they agree" is a claim about an empty list.
    expect(mine).toHaveLength(2);
    expect(mine[0].venueName).toBe("A Roof");
    expect(mine[1].spots.map((s) => s.id)).toEqual(["a", "d", "c"]);
  });

  test("T-SPOT3 — search matches a label or a venue name, and keeps the grouping", () => {
    const groups = orderableSpotGroups(
      [
        spot({ id: "a", label: "Table 12" }),
        spot({ id: "b", label: "Table 9" }),
        spot({ id: "c", venueId: "venue-2", label: "Rooftop bar" }),
      ],
      [
        { id: "venue-1", name: "The Brasserie", slug: "brasserie" },
        { id: "venue-2", name: "The Roof", slug: "roof" },
      ],
    );
    expect(filterSpotGroups(groups, "12")[0].spots.map((s) => s.id)).toEqual(["a"]);
    expect(filterSpotGroups(groups, "roof").map((g) => g.venueId)).toEqual([
      "venue-2",
    ]);
    expect(filterSpotGroups(groups, "")).toHaveLength(2);
    expect(filterSpotGroups(groups, "nothing here")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The same menu, with the same depth (D-6).
// ---------------------------------------------------------------------------
describe("issue #1792 — the same menu a guest would see", () => {
  test("T-MENU1 — 86'd items and price-on-request items are not orderable", () => {
    const sections = orderableMenuSections([
      item({ id: "a" }),
      item({ id: "b", name: "Sold out", isAvailable: false }),
      // `venue_order_items.unit_price_cents` is NOT NULL: a price-on-request
      // item is structurally not a line (P-4b), not a price the pad fills in.
      item({ id: "c", name: "Market fish", priceCents: null }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((i) => i.id)).toEqual(["a"]);
  });

  test("T-MENU2 — sections sort by menu name and items by sort order", () => {
    const sections = orderableMenuSections([
      item({ id: "b", menuId: "m2", menuName: "Wine", sortOrder: 1 }),
      item({ id: "a", menuId: "m1", menuName: "All day", sortOrder: 2 }),
      item({ id: "c", menuId: "m1", menuName: "All day", sortOrder: 1 }),
    ]);
    expect(sections.map((s) => s.menuName)).toEqual(["All day", "Wine"]);
    expect(sections[0].items.map((i) => i.id)).toEqual(["c", "a"]);
    expect(filterMenuSections(sections, "wine")).toHaveLength(0);
    expect(filterMenuSections(sections, "negroni")).toHaveLength(2);
  });

  test("T-MOD1 — a required group must be satisfied before the line exists", () => {
    const g = group();
    expect(modifierGroupState(g, []).satisfied).toBe(false);
    expect(modifierGroupState(g, []).prompt).toBe("Choose ice");
    expect(modifierGroupState(g, ["mod-1"]).satisfied).toBe(true);
    expect(nextModifierPrompt([g], [])).toBe("Choose ice");
    expect(nextModifierPrompt([g], ["mod-1"])).toBeNull();
  });

  test("T-MOD2 — an 86'd option cannot satisfy its group", () => {
    // The kitchen running out of "extra truffle" mid-shift must invalidate the
    // selection, not quietly send it.
    const g = group({
      modifiers: [
        {
          id: "mod-1",
          name: "With ice",
          priceDeltaCents: 0,
          currency: "GBP",
          isAvailable: false,
          sortOrder: 1,
        },
      ],
    });
    expect(modifierGroupState(g, ["mod-1"]).satisfied).toBe(false);
  });

  test("T-MOD3 — single REPLACES, multi caps and refuses beyond the cap", () => {
    const single = group();
    expect(toggleModifier(single, [], "mod-1")).toEqual(["mod-1"]);
    expect(toggleModifier(single, ["mod-1"], "mod-2")).toEqual(["mod-2"]);
    // Tapping the chosen one again clears it (a required group then re-prompts).
    expect(toggleModifier(single, ["mod-1"], "mod-1")).toEqual([]);

    const multi = group({
      id: "g2",
      name: "Extras",
      selectionMode: "multi",
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: "x1", name: "Olive", priceDeltaCents: 50, currency: "GBP", isAvailable: true, sortOrder: 1 },
        { id: "x2", name: "Twist", priceDeltaCents: 50, currency: "GBP", isAvailable: true, sortOrder: 2 },
        { id: "x3", name: "Cherry", priceDeltaCents: 50, currency: "GBP", isAvailable: true, sortOrder: 3 },
      ],
    });
    const two = toggleModifier(multi, toggleModifier(multi, [], "x1"), "x2");
    expect(two).toEqual(["x1", "x2"]);
    // The third is REFUSED rather than silently evicting the first — a waiter
    // who taps a fourth extra needs to see the third is still there.
    expect(toggleModifier(multi, two, "x3")).toEqual(["x1", "x2"]);
    // A group from another item never touches this group's choices.
    expect(toggleModifier(multi, ["mod-1", "x1"], "x2")).toEqual([
      "mod-1",
      "x1",
      "x2",
    ]);
  });

  test("T-MOD4 — an inactive group is not a question anyone has to answer", () => {
    expect(modifierGroupState(group({ isActive: false }), []).satisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The cart, and THE P-20 BOUNDARY.
// ---------------------------------------------------------------------------
describe("issue #1792 — the cart, and the money the pad never touches", () => {
  test("T-P20 — nothing with a price in it ever leaves the pad", () => {
    const lines = [
      line({ quantity: 3, notes: "  no ice  " }),
      line({
        key: cartLineIdentity("item-2", ["mod-1"], null),
        menuItemId: "item-2",
        name: "Steak",
        unitPriceCents: 3200,
        modifierIds: ["mod-1"],
        modifierNames: ["Medium rare"],
      }),
    ];
    const payload = orderPadSubmitLines(lines);
    expect(payload).toEqual([
      { menuItemId: "item-1", quantity: 3, modifierIds: [], notes: "no ice" },
      {
        menuItemId: "item-2",
        quantity: 1,
        modifierIds: ["mod-1"],
        notes: null,
      },
    ]);
    // The exhaustive form of the same claim: no emitted key may be price-shaped,
    // and no emitted VALUE may be one of the prices the pad was holding.
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["price", "Price", "cents", "Cents", "total", "amount"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    expect(serialized.includes("1200")).toBe(false);
    expect(serialized.includes("3200")).toBe(false);
  });

  test("T-CART1 — the same plate twice is one line at quantity 2", () => {
    let lines: OrderPadLine[] = [];
    lines = addLineToCart(lines, {
      menuItemId: "item-1",
      name: "Negroni",
      unitPriceCents: 1200,
      currency: "GBP",
      quantity: 1,
      modifierIds: ["mod-1"],
      modifierNames: ["With ice"],
      notes: null,
    });
    lines = addLineToCart(lines, {
      menuItemId: "item-1",
      name: "Negroni",
      unitPriceCents: 1200,
      currency: "GBP",
      quantity: 1,
      modifierIds: ["mod-1"],
      modifierNames: ["With ice"],
      notes: null,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
    expect(cartItemCount(lines)).toBe(2);

    // A DIFFERENT note is a different plate and stays its own line — the pass
    // reads these, and "no ice" merged into the others is a wrong drink.
    lines = addLineToCart(lines, {
      menuItemId: "item-1",
      name: "Negroni",
      unitPriceCents: 1200,
      currency: "GBP",
      quantity: 1,
      modifierIds: ["mod-1"],
      modifierNames: ["With ice"],
      notes: "no ice",
    });
    expect(lines).toHaveLength(2);
    // ...and so is a different option.
    lines = addLineToCart(lines, {
      menuItemId: "item-1",
      name: "Negroni",
      unitPriceCents: 1200,
      currency: "GBP",
      quantity: 1,
      modifierIds: ["mod-2"],
      modifierNames: ["Neat"],
      notes: null,
    });
    expect(lines).toHaveLength(3);
  });

  test("T-CART2 — quantity floors at removal and ceilings at the column's CHECK", () => {
    const lines = [line({ quantity: 1 })];
    expect(setLineQuantity(lines, lines[0].key, 0)).toHaveLength(0);
    expect(setLineQuantity(lines, lines[0].key, -3)).toHaveLength(0);
    expect(
      setLineQuantity(lines, lines[0].key, 500)[0].quantity,
    ).toBe(ORDER_PAD_MAX_QUANTITY);
    // `venue_order_items.quantity CHECK (quantity > 0 AND quantity <= 99)`.
    expect(ORDER_PAD_MAX_QUANTITY).toBe(99);
  });

  test("T-CART3 — a mixed-currency cart is caught before it is sent", () => {
    const mixed = [line(), line({ key: "k2", menuItemId: "item-2", currency: "USD" })];
    expect(cartCurrency(mixed).ok).toBe(false);
    const readiness = orderPadReadiness({
      spotId: "spot-1",
      counterPickup: false,
      buyerName: "",
      lines: mixed,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blocker).toContain("Mixed currencies");
  });

  test("T-READY1 — every blocker names the ONE thing to do next", () => {
    expect(
      orderPadReadiness({
        spotId: null,
        counterPickup: false,
        buyerName: "",
        lines: [line()],
      }),
    ).toEqual({ ready: false, blocker: "Pick where this order is going." });

    // D-3a — a collection ticket without a name reads `COLLECT · 42` and staff
    // hand food to whoever says the number.
    expect(
      orderPadReadiness({
        spotId: null,
        counterPickup: true,
        buyerName: "A",
        lines: [line()],
      }).blocker,
    ).toBe("Add the guest's name for the collection.");

    expect(
      orderPadReadiness({
        spotId: "spot-1",
        counterPickup: false,
        buyerName: "",
        lines: [],
      }).blocker,
    ).toBe("Add something to the order.");

    expect(
      orderPadReadiness({
        spotId: "spot-1",
        counterPickup: false,
        buyerName: "",
        lines: [line()],
      }),
    ).toEqual({ ready: true, blocker: null });
  });
});

// ---------------------------------------------------------------------------
// Settlement (D-11) — three supported, one visibly absent.
// ---------------------------------------------------------------------------
describe("issue #1792 — settlement", () => {
  test("T-SETTLE1 — the two supported paths are described honestly", () => {
    const bill = ORDER_PAD_SETTLEMENT_OPTIONS.find(
      (o) => o.method === "bill_to_phone",
    );
    const cash = ORDER_PAD_SETTLEMENT_OPTIONS.find(
      (o) => o.method === "venue_collected",
    );
    expect(bill?.available).toBe(true);
    expect(bill?.minglaCollects).toBe(true);
    expect(bill?.body).toContain("fee");
    expect(cash?.available).toBe(true);
    // The venue must be told, in words, that this one costs them nothing.
    expect(cash?.minglaCollects).toBe(false);
    expect(cash?.body).toContain("no fee");
    expect(cash?.body).toContain("Nothing goes through Mingla");
  });

  test("T-SETTLE2 — charge-to-room is LISTED, disabled, and says why", () => {
    const room = ORDER_PAD_SETTLEMENT_OPTIONS.find(
      (o) => o.method === "charge_to_room",
    );
    // Present, so a hotel operator can see it is coming rather than wonder.
    expect(room).toBeDefined();
    expect(room?.available).toBe(false);
    expect(room?.unavailableReason).not.toBeNull();
    // And unsendable at the seam, not merely un-tappable in one component.
    expect(settlementMethodIsSendable("charge_to_room")).toBe(false);
    expect(settlementMethodIsSendable("bill_to_phone")).toBe(true);
    expect(settlementMethodIsSendable("venue_collected")).toBe(true);
  });

  test("T-SETTLE3 — a bill needs the contact triple the database demands", () => {
    // `venue_orders_paid_needs_contact` makes a paid Mingla order without all
    // three literally unwritable. A bill sent without them bounces after the
    // waiter has walked away.
    expect(
      billContactReadiness({ name: "A", email: "a@b.co", phone: "07700900123" })
        .blocker,
    ).toBe("Add the guest's name.");
    expect(
      billContactReadiness({ name: "Amara", email: "nope", phone: "07700900123" })
        .blocker,
    ).toBe("That email doesn't look right.");
    expect(
      billContactReadiness({ name: "Amara", email: "a@b.co", phone: "123" })
        .blocker,
    ).toBe("Add a phone number.");
    // Loose on formatting on purpose: E.164 normalisation is the server's job,
    // and a pad that rejects how a waiter actually types a number is a pad
    // nobody uses.
    expect(
      billContactReadiness({
        name: "Amara",
        email: "a@b.co",
        phone: "07700 900 123",
      }),
    ).toEqual({ ready: true, blocker: null });
  });
});

// ---------------------------------------------------------------------------
// Tabs (D-2 AMENDED).
// ---------------------------------------------------------------------------
describe("issue #1792 — waiter-opened tabs", () => {
  test("T-TAB1 — a tab whose bill is already out takes no more rounds", () => {
    expect(tabAcceptsRounds(tab({ tabState: "open" }))).toBe(true);
    // `settling` means the total was struck and sent. A round added after that
    // is a round the guest was never shown, and the server refuses it too
    // (`session_not_addable`).
    expect(tabAcceptsRounds(tab({ tabState: "settling" }))).toBe(false);
  });

  test("T-TAB2 — a tab reads as a place and a count, never as a guess", () => {
    expect(tabDestinationLabel(tab())).toBe("Table 12");
    expect(tabDestinationLabel(tab({ spotLabel: null }))).toBe("No table");
    expect(tabDestinationLabel(tab({ spotLabel: "   " }))).toBe("No table");
    expect(tabRoundsLabel(tab({ roundCount: 0 }))).toBe("No rounds yet");
    expect(tabRoundsLabel(tab({ roundCount: 1 }))).toBe("1 round");
    expect(tabRoundsLabel(tab({ roundCount: 4 }))).toBe("4 rounds");
  });

});
