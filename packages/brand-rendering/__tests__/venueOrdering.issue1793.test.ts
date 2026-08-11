// ===========================================================================
// Issue #1793 (#1767 Phase 4) — the guest ordering RULES, proved.
//
// Everything asserted here is a promise the product makes to a person standing
// in a venue with their phone out. The four that matter most:
//
//   T-1793-C1  a counter-pickup order is NEVER promised delivery (D-3a)
//   T-1793-C2  a paused venue shows an honest state, never a broken card
//   T-1793-C3  the tip is asked ONCE per sitting and remembered (D-2 / OQ-2)
//   T-1793-C4  nothing that leaves this surface has a price in it (P-20)
//
// fails-on-revert: unbranch `venueOrderProgressCopy` and C1 dies; return null
// for `paused` in `venueOrderingNotice` and C2 dies; drop the `remembered`
// short-circuit in `venueOrderInitialTip` and C3 dies; let
// `venueOrderCartWireLines` spread its input and C4 dies.
// ===========================================================================

import fs from "fs";
import path from "path";

import {
  VENUE_ORDER_MAX_LINE_QUANTITY,
  venueOrderBuyerFailure,
  venueOrderCartCount,
  venueOrderCartLineKey,
  venueOrderCartReducer,
  venueOrderCartWireLines,
  venueOrderHandover,
  venueOrderHandoverChip,
  venueOrderingCanOrder,
  venueOrderingIsCounterPickup,
  venueOrderingMenuGroups,
  venueOrderingModifierFailure,
  venueOrderingNotice,
  venueOrderingWindowContains,
  venueOrderInitialTip,
  venueOrderPartySizeValid,
  venueOrderProgressCopy,
  venueOrderTipIsRemembered,
  venueOrderTipPresets,
} from "../venueOrdering/venueOrderingRules";
import {
  parseVenueOrderSitting,
  serialiseVenueOrderSitting,
  VENUE_ORDER_SITTING_TTL_MS,
  venueOrderNameAfterHydration,
  venueOrderShouldAskPartySize,
  venueOrderSittingKey,
  venueOrderTipAfterHydration,
} from "../venueOrdering/venueOrderingSitting";
import { venueOrderCreateBody } from "../venueOrdering/venueOrderingWire";
import type {
  VenueOrderCartLine,
  VenueOrderingConfig,
  VenueOrderLiveStatus,
} from "../venueOrdering/venueOrderingTypes";

const config = (over: Partial<VenueOrderingConfig> = {}): VenueOrderingConfig => ({
  state: "on",
  venueId: "venue-1",
  venueName: "The Brasserie",
  spotState: "ok",
  spot: { label: "Table 12", kind: "table", servingMenuId: null },
  serviceChargeBps: 0,
  serviceChargeLabel: "Service charge",
  tipsEnabled: true,
  tipPresetsBps: null,
  counterPickupEnabled: true,
  prepTimeMinutes: null,
  ...over,
});

const live = (over: Partial<VenueOrderLiveStatus> = {}): VenueOrderLiveStatus => ({
  orderId: "order-1",
  paymentStatus: "paid",
  fulfillmentStatus: "ready",
  acknowledgedAt: null,
  readyAt: null,
  refundRequestedAt: null,
  refundDecision: null,
  escalationLevel: 0,
  pickupCode: null,
  spotLabel: "Table 12",
  canCancel: false,
  canRequestRefund: false,
  totals: {
    currency: "GBP",
    subtotalCents: 1000,
    serviceChargeCents: 0,
    feesAndTaxCents: 100,
    tipCents: 0,
    totalCents: 1100,
    refundedAmountCents: 0,
  },
  ...over,
});

const ALL_STATUSES: VenueOrderLiveStatus["fulfillmentStatus"][] = [
  "placed",
  "acknowledged",
  "in_progress",
  "ready",
  "delivered",
  "cancelled",
  "refunded",
];

// ---------------------------------------------------------------------------
// T-1793-C1 — D-3a. A no-spot order is never promised delivery.
// ---------------------------------------------------------------------------
describe("T-1793-C1 — a counter-pickup order is never told anything is coming to it", () => {
  const counter = venueOrderHandover(
    live({ pickupCode: "47", spotLabel: null }),
    "Ada",
  );
  const table = venueOrderHandover(live({ pickupCode: null }), "Ada");

  test("the branch is the RECORD, not a guess about where they might be", () => {
    expect(counter.kind).toBe("counter");
    expect(table.kind).toBe("spot");
    // pickup_code is minted by the server in exactly one branch (no spot).
    expect(venueOrderHandover(live({ pickupCode: "" }), "Ada").kind).toBe("spot");
  });

  test("no counter copy, at ANY step, promises delivery", () => {
    for (const status of ALL_STATUSES) {
      const copy = venueOrderProgressCopy(status, counter);
      const text = `${copy.title} ${copy.body}`.toLowerCase();
      expect(text).not.toMatch(/on its way/);
      expect(text).not.toMatch(/bringing/);
      expect(text).not.toMatch(/to your table/);
      expect(text).not.toMatch(/table 12/);
      expect(text).not.toMatch(/deliver/);
    }
  });

  test("the ready copy is 'come and collect', with the code and the name", () => {
    const copy = venueOrderProgressCopy("ready", counter);
    expect(copy.title).toBe("Ready to collect");
    expect(copy.body).toContain("code 47");
    expect(copy.body).toContain("Ada");
  });

  test("a SPOT order's ready copy names the spot, and never a pickup code", () => {
    const copy = venueOrderProgressCopy("ready", table);
    expect(copy.title).toBe("On its way");
    expect(copy.body).toBe("On its way to Table 12.");
    expect(copy.body).not.toMatch(/collect/i);
  });

  test("an unlabelled spot degrades to 'your table', never to a collect promise", () => {
    const unlabelled = venueOrderHandover(
      live({ pickupCode: null, spotLabel: null }),
      "Ada",
    );
    expect(unlabelled.kind).toBe("spot");
    expect(venueOrderProgressCopy("ready", unlabelled).body).toBe(
      "On its way to your table.",
    );
  });

  test("the pre-pay chip says where it is going, and says COUNTER when there is no spot", () => {
    expect(venueOrderHandoverChip(config())).toBe("Ordering for Table 12");
    expect(venueOrderHandoverChip(config({ spotState: "none", spot: null })))
      .toBe("Collect from the counter");
    expect(venueOrderingIsCounterPickup(config({ spotState: "unknown" }))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// T-1793-C2 — the honest state (the amendment registered against this phase).
// ---------------------------------------------------------------------------
describe("T-1793-C2 — a guest at a paused venue is told the truth, not shown a failure", () => {
  test("PAUSED, scanned → the venue's own words, and nothing was charged", () => {
    const notice = venueOrderingNotice(config({ state: "paused" }), {
      scanned: true,
    });
    expect(notice).not.toBeNull();
    expect(notice?.title).toBe(
      "The Brasserie has paused ordering right now. Try again shortly.",
    );
    expect(notice?.body).toContain("Nothing has been charged");
    // Never anything that reads as broken.
    const text = `${notice?.title} ${notice?.body}`.toLowerCase();
    expect(text).not.toMatch(/error|failed|unavailable|something went wrong/);
  });

  test("OFF, scanned → 'isn't taking orders through Mingla yet', with a way forward", () => {
    const notice = venueOrderingNotice(config({ state: "off" }), {
      scanned: true,
    });
    expect(notice?.title).toBe(
      "The Brasserie isn't taking orders through Mingla yet.",
    );
    expect(notice?.body).toContain("member of staff");
  });

  test("an unresolvable venue reads as OFF — one honest sentence, not a scarier one", () => {
    expect(
      venueOrderingNotice(config({ state: "unavailable" }), { scanned: true })
        ?.title,
    ).toBe("The Brasserie isn't taking orders through Mingla yet.");
  });

  test("a CASUAL reader is told nothing — ordering is off for every venue by default", () => {
    expect(venueOrderingNotice(config({ state: "off" }), { scanned: false }))
      .toBeNull();
    expect(venueOrderingNotice(config({ state: "paused" }), { scanned: false }))
      .toBeNull();
  });

  test("ordering ON with a dead code → the code is the problem, and counter pickup still works", () => {
    const notice = venueOrderingNotice(
      config({ spotState: "unknown", spot: null }),
      { scanned: true },
    );
    expect(notice?.title).toBe("This code isn't active. Ask a member of staff.");
    expect(notice?.body).toContain("counter");
    expect(venueOrderingCanOrder(config({ spotState: "unknown", spot: null })))
      .toBe(true);
  });

  test("nobody can order at a paused or unswitched venue", () => {
    expect(venueOrderingCanOrder(config({ state: "paused" }))).toBe(false);
    expect(venueOrderingCanOrder(config({ state: "off" }))).toBe(false);
    expect(venueOrderingCanOrder(config({ state: "unavailable" }))).toBe(false);
    // …and a no-spot guest at a venue that has counter pickup OFF cannot either.
    expect(
      venueOrderingCanOrder(
        config({ spotState: "none", spot: null, counterPickupEnabled: false }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-1793-C3 — the tip: asked once, remembered, changeable, never re-asked.
// ---------------------------------------------------------------------------
describe("T-1793-C3 — the tip is a sitting's answer, not a per-round question", () => {
  test("a FRESH sitting at a venue with no service charge is simply asked", () => {
    expect(venueOrderInitialTip(config(), null)).toEqual({
      bps: null,
      flatCents: null,
    });
  });

  test("D-9 — where the venue charges service, the tip STARTS at none rather than stacking", () => {
    expect(venueOrderInitialTip(config({ serviceChargeBps: 1250 }), null))
      .toEqual({ bps: 0, flatCents: null });
  });

  test("a REMEMBERED answer always wins — that is the whole of OQ-2", () => {
    const remembered = { bps: 1500, flatCents: null };
    expect(venueOrderInitialTip(config(), remembered)).toEqual(remembered);
    // …even at a venue that levies a service charge: the guest already decided.
    expect(
      venueOrderInitialTip(config({ serviceChargeBps: 1250 }), remembered),
    ).toEqual(remembered);
  });

  test("a venue with tips off is never asked at all", () => {
    expect(venueOrderInitialTip(config({ tipsEnabled: false }), { bps: 2000, flatCents: null }))
      .toEqual({ bps: null, flatCents: null });
  });

  test("the row's heading flips to 'remembered' only on a live sitting with an answer", () => {
    expect(venueOrderTipIsRemembered(false, null)).toBe(false);
    expect(venueOrderTipIsRemembered(true, null)).toBe(false);
    expect(venueOrderTipIsRemembered(true, { bps: 1000, flatCents: null })).toBe(
      true,
    );
  });

  test("presets are the venue's when it has them, the house's when it does not", () => {
    expect(venueOrderTipPresets(config())).toEqual([1000, 1250, 1500]);
    expect(venueOrderTipPresets(config({ tipPresetsBps: [500, 1000] }))).toEqual(
      [500, 1000],
    );
    // A misconfigured empty/negative list falls back rather than rendering junk.
    expect(venueOrderTipPresets(config({ tipPresetsBps: [] }))).toEqual([
      1000,
      1250,
      1500,
    ]);
  });

  test("the sitting is scoped to the SPOT, expires, and is forgotten when unreadable", () => {
    expect(venueOrderSittingKey({ venueId: "v1", spotCode: "abc" })).toBe(
      "mingla.venueOrderSitting.spot.abc",
    );
    expect(venueOrderSittingKey({ venueId: "v1", spotCode: null })).toBe(
      "mingla.venueOrderSitting.venue.v1",
    );
    expect(venueOrderSittingKey({ venueId: null, spotCode: null })).toBeNull();

    const now = 1_000_000;
    const raw = serialiseVenueOrderSitting({
      sessionId: "s1",
      orderId: "o1",
      buyerStatusToken: "t1",
      guestCancelToken: "c1",
      tip: { bps: 1000, flatCents: null },
      partySizeClaimed: 4,
      buyerName: "Ada",
    }, now);
    const parsed = parseVenueOrderSitting(raw, now + 1000);
    expect(parsed?.sessionId).toBe("s1");
    expect(parsed?.tip).toEqual({ bps: 1000, flatCents: null });
    // An evening, not an account.
    expect(
      parseVenueOrderSitting(raw, now + VENUE_ORDER_SITTING_TTL_MS + 1),
    ).toBeNull();
    expect(parseVenueOrderSitting("{not json", now)).toBeNull();
    expect(parseVenueOrderSitting(null, now)).toBeNull();
    expect(parseVenueOrderSitting('{"expiresAt":9e15}', now)).toBeNull();
  });

  test("a sitting that resolves AFTER mount restores the tip — and never overwrites the guest", () => {
    const remembered = { bps: 1500, flatCents: null };
    // The disk read lands a render late. The guest has touched nothing.
    expect(
      venueOrderTipAfterHydration({
        current: { bps: null, flatCents: null },
        touched: false,
        remembered,
      }),
    ).toEqual(remembered);
    // The guest got there first. Their thumb wins, always.
    expect(
      venueOrderTipAfterHydration({
        current: { bps: 0, flatCents: null },
        touched: true,
        remembered,
      }),
    ).toEqual({ bps: 0, flatCents: null });
    // Nothing remembered changes nothing.
    expect(
      venueOrderTipAfterHydration({
        current: { bps: 1000, flatCents: null },
        touched: false,
        remembered: null,
      }),
    ).toEqual({ bps: 1000, flatCents: null });
    // The name fills a blank and never overwrites what was typed.
    expect(venueOrderNameAfterHydration("", "Ada")).toBe("Ada");
    expect(venueOrderNameAfterHydration("Grace", "Ada")).toBe("Grace");
  });

  test("the party-size question is asked ONCE per sitting, and skipping it is free", () => {
    expect(venueOrderShouldAskPartySize(null)).toBe(true);
    expect(
      venueOrderShouldAskPartySize({
        sessionId: "s1",
        orderId: null,
        buyerStatusToken: null,
        guestCancelToken: null,
        tip: { bps: null, flatCents: null },
        partySizeClaimed: null,
        buyerName: "",
        expiresAt: Date.now() + 1000,
      }),
    ).toBe(false);
    expect(venueOrderPartySizeValid(null)).toBe(true);
    expect(venueOrderPartySizeValid(4)).toBe(true);
    expect(venueOrderPartySizeValid(0)).toBe(false);
    expect(venueOrderPartySizeValid(101)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-1793-C4 — P-20. Nothing with a price in it ever leaves this surface.
// ---------------------------------------------------------------------------
describe("T-1793-C4 — the wire carries item ids and counts, never money", () => {
  const poisoned = [
    {
      key: "k1",
      menuItemId: "item-1",
      itemName: "Negroni",
      quantity: 2,
      modifierIds: ["mod-1"],
      modifierNames: ["Double"],
      notes: "no ice",
      // Everything a tampering client might try to smuggle:
      unitPriceCents: 1,
      priceCents: 1,
      lineTotalCents: 2,
      totalCents: 2,
      price: 0.01,
      amount: 0.01,
    } as unknown as VenueOrderCartLine,
  ];

  test("a line on the wire has EXACTLY four keys, whatever the cart object carries", () => {
    const wire = venueOrderCartWireLines(poisoned);
    expect(Object.keys(wire[0]).sort()).toEqual([
      "menuItemId",
      "modifierIds",
      "notes",
      "quantity",
    ]);
  });

  test("the whole request body carries no price-shaped key anywhere", () => {
    const body = venueOrderCreateBody({
      request: {
        spotCode: "abc",
        venueId: "v1",
        sessionId: null,
        lines: poisoned,
        buyer: { name: "Ada", email: "a@b.co", phone: "+447700900000" },
        partySizeClaimed: 4,
        tipBps: 1000,
        tipFlatCents: null,
        entrySource: "qr",
      },
      mode: "create",
      surface: "web",
      idempotencyKey: "vo-1",
    });
    const serialised = JSON.stringify(body);
    for (
      const key of [
        "unitPriceCents",
        "priceCents",
        "lineTotalCents",
        "amountCents",
        "subtotalCents",
        '"totalCents"',
        '"price"',
        '"amount"',
      ]
    ) {
      expect(serialised).not.toContain(key);
    }
    // `tipFlatCents` IS allowed — it is an amount the GUEST chose, not a price
    // they are claiming about an item, and the server still owns the total.
    expect(serialised).toContain("tipFlatCents");
  });

  test("no renderer under venueOrdering/ imports a provider or computes a fee (SET-B)", () => {
    const dir = path.join(__dirname, "..", "venueOrdering");
    const files = fs.readdirSync(dir).filter((name) => /\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const name of files) {
      const src = stripComments(fs.readFileSync(path.join(dir, name), "utf8"));
      expect(src).not.toMatch(/\bstripe\b/i);
      expect(src).not.toMatch(/paymentsheet/i);
      expect(src).not.toMatch(/application_fee/i);
      expect(src).not.toMatch(/\bfeeFromBps\b/);
      // The two arithmetic shapes that would mean this surface priced anything.
      expect(src).not.toMatch(/take_rate|takeRate/);
      expect(src).not.toMatch(/\* *0\.01|\/ *10000/);
    }
  });
});

// ---------------------------------------------------------------------------
// The basket, the options, the buyer, the windows.
// ---------------------------------------------------------------------------
describe("T-1793-C5 — the basket", () => {
  const line = {
    menuItemId: "item-1",
    itemName: "Negroni",
    modifierIds: ["b", "a"],
    modifierNames: ["Double", "Orange"],
    notes: null,
  };

  test("identity is item + options + note, and option order does not matter", () => {
    expect(venueOrderCartLineKey({ menuItemId: "i", modifierIds: ["b", "a"], notes: null }))
      .toBe(
        venueOrderCartLineKey({ menuItemId: "i", modifierIds: ["a", "b"], notes: null }),
      );
    expect(venueOrderCartLineKey({ menuItemId: "i", modifierIds: [], notes: "No onions" }))
      .not.toBe(
        venueOrderCartLineKey({ menuItemId: "i", modifierIds: [], notes: null }),
      );
  });

  test("adding twice increments one line; the 99 ceiling is the server's own", () => {
    let lines = venueOrderCartReducer([], { type: "ADD", line });
    lines = venueOrderCartReducer(lines, { type: "ADD", line });
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
    lines = venueOrderCartReducer(lines, {
      type: "SET_QUANTITY",
      key: lines[0].key,
      quantity: 500,
    });
    expect(lines[0].quantity).toBe(VENUE_ORDER_MAX_LINE_QUANTITY);
    expect(venueOrderCartCount(lines)).toBe(VENUE_ORDER_MAX_LINE_QUANTITY);
  });

  test("stepping to zero removes the line rather than sending a zero-quantity order", () => {
    const lines = venueOrderCartReducer([], { type: "ADD", line });
    expect(
      venueOrderCartReducer(lines, {
        type: "SET_QUANTITY",
        key: lines[0].key,
        quantity: 0,
      }),
    ).toHaveLength(0);
  });

  test("an unsatisfied required group is named, so the copy can say WHICH", () => {
    const groups = [
      {
        id: "g1",
        name: "Choose a size",
        selectionMode: "single",
        minSelect: 1,
        maxSelect: 1,
        modifiers: [
          { id: "m1", name: "Single", priceDeltaCents: 0, currency: "GBP" },
          { id: "m2", name: "Double", priceDeltaCents: 300, currency: "GBP" },
        ],
      },
    ];
    expect(venueOrderingModifierFailure(groups, [])).toEqual({
      group: "Choose a size",
      reason: "too_few",
    });
    expect(venueOrderingModifierFailure(groups, ["m1"])).toBeNull();
    expect(venueOrderingModifierFailure(groups, ["m1", "m2"])).toEqual({
      group: "Choose a size",
      reason: "too_many",
    });
  });

  test("the contact triple is checked before a guest can reach a payment step", () => {
    expect(venueOrderBuyerFailure({ name: "A", email: "a@b.co", phone: "+447700900000" })?.field)
      .toBe("name");
    expect(venueOrderBuyerFailure({ name: "Ada", email: "nope", phone: "+447700900000" })?.field)
      .toBe("email");
    expect(venueOrderBuyerFailure({ name: "Ada", email: "a@b.co", phone: "12" })?.field)
      .toBe("phone");
    expect(
      venueOrderBuyerFailure({ name: "Ada", email: "a@b.co", phone: "+44 7700 900000" }),
    ).toBeNull();
  });
});

describe("T-1793-C6 — service windows, in the VENUE's own time", () => {
  test("a window that crosses midnight is a late-night menu, not an empty set", () => {
    const late = { start: "22:00", end: "02:00", days: null };
    expect(venueOrderingWindowContains(late, { isoDayOfWeek: 5, minutesSinceMidnight: 23 * 60 }))
      .toBe(true);
    expect(venueOrderingWindowContains(late, { isoDayOfWeek: 5, minutesSinceMidnight: 60 }))
      .toBe(true);
    expect(venueOrderingWindowContains(late, { isoDayOfWeek: 5, minutesSinceMidnight: 12 * 60 }))
      .toBe(false);
  });

  test("a breakfast menu closes at 11:00 sharp, and its day list is honoured", () => {
    const breakfast = { start: "07:00", end: "11:00", days: [1, 2, 3, 4, 5] };
    expect(
      venueOrderingWindowContains(breakfast, {
        isoDayOfWeek: 3,
        minutesSinceMidnight: 10 * 60 + 59,
      }),
    ).toBe(true);
    expect(
      venueOrderingWindowContains(breakfast, {
        isoDayOfWeek: 3,
        minutesSinceMidnight: 11 * 60,
      }),
    ).toBe(false);
    expect(
      venueOrderingWindowContains(breakfast, {
        isoDayOfWeek: 6,
        minutesSinceMidnight: 9 * 60,
      }),
    ).toBe(false);
  });

  test("a spot pinned to ONE menu can order from that menu and no other (D-3b)", () => {
    const groups = [
      { menuId: "m-room", menuName: "In-room dining", menuDescription: null, items: [] },
      { menuId: "m-main", menuName: "All day", menuDescription: null, items: [] },
    ];
    const pinned = venueOrderingMenuGroups({
      groups,
      windowsByMenuId: {},
      servingMenuId: "m-room",
      local: { isoDayOfWeek: 3, minutesSinceMidnight: 600 },
      orderingOn: true,
    });
    expect(pinned.map((group) => group.menuId)).toEqual(["m-room"]);
    expect(pinned[0].orderable).toBe(true);
  });

  test("a closed menu is still READABLE — it simply cannot be added to", () => {
    const groups = [
      { menuId: "m1", menuName: "Breakfast", menuDescription: null, items: [] },
    ];
    const resolved = venueOrderingMenuGroups({
      groups,
      windowsByMenuId: { m1: { start: "07:00", end: "11:00", days: null } },
      servingMenuId: null,
      local: { isoDayOfWeek: 3, minutesSinceMidnight: 21 * 60 },
      orderingOn: true,
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].orderable).toBe(false);
  });

  test("an unresolvable venue clock fails OPEN — a lost sale is worse than a closed menu", () => {
    const resolved = venueOrderingMenuGroups({
      groups: [{ menuId: "m1", menuName: "Breakfast", menuDescription: null, items: [] }],
      windowsByMenuId: { m1: { start: "07:00", end: "11:00", days: null } },
      servingMenuId: null,
      local: null,
      orderingOn: true,
    });
    expect(resolved[0].orderable).toBe(true);
  });
});
