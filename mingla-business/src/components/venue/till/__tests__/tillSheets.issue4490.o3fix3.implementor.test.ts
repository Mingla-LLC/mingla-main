/**
 * #4490 spec 08 O3 fix 3 — O3-S1: on an iPhone the Till could not take a
 * payment. The basket is a native modal on a phone, and Pay (like every sheet
 * the basket opens) was a SIBLING modal presented from the same screen while
 * the basket was up; UIKit refused it and the Till then believed a sheet was
 * open. The model here decides where each sheet presents from; TillScreen uses
 * it (pinned by `till-iphone-one-modal-per-presenter` in the host-wiring gate,
 * and rendered in tillSheets.issue4490.o3fix3.render.test.tsx).
 *
 * The rule under test: on iOS, no presenter (the screen, or the basket's own
 * sheet) is ever asked to hold two native modals at once.
 *
 * What jest cannot prove: real UIKit presentation. The iPhone simulator
 * re-check does that.
 */
import { describe, expect, test } from "@jest/globals";

import {
  basketLaunchedAfterClose,
  basketSheetsNest,
  checkSheetGone,
  pickCheckSheet,
  presenterStacks,
  refundHost,
  type BasketLaunched,
  type TillCheckSheet,
  type TillSheetsOpen,
} from "../tillSheetModel";

const NONE: TillSheetsOpen = {
  basket: false,
  pay: false,
  name: false,
  voidRow: false,
  lineRefund: false,
  check: null,
  refund: false,
  receipt: false,
  choices: false,
  offer: false,
  checks: false,
  leave: false,
};

/** A tiny driver that holds the Till's sheet state the way TillScreen does. */
function till(platform: string, layout: "phone" | "tablet" | "desk" = "phone") {
  let open: TillSheetsOpen = { ...NONE };
  let queued: TillCheckSheet | null = null;
  const nests = basketSheetsNest(layout, platform);
  return {
    get open() {
      return open;
    },
    stacks: () => presenterStacks(open, layout, platform),
    openBasket: () => (open = { ...open, basket: true }),
    tapPay: () => (open = { ...open, pay: true }),
    closePay: () => (open = { ...open, pay: false }),
    refundFromBasket: () => (open = { ...open, refund: true }),
    closeRefund: () => (open = { ...open, refund: false }),
    checkActions: () => (open = { ...open, check: "actions" }),
    pickFromActions: (next: TillCheckSheet) => {
      const step = pickCheckSheet(next, platform);
      queued = step.queued;
      open = { ...open, check: step.shown };
    },
    actionsGone: () => {
      const step = checkSheetGone({ shown: null, queued });
      queued = null;
      if (step.shown !== null) open = { ...open, check: step.shown };
    },
    closeBasket: () => {
      const launched: BasketLaunched = {
        pay: open.pay,
        name: open.name,
        voidRow: open.voidRow,
        lineRefund: open.lineRefund,
        check: open.check,
        refund: open.refund,
      };
      const left = basketLaunchedAfterClose(launched, nests);
      if (left.check === null) queued = null;
      open = { ...open, ...left, basket: false };
    },
  };
}

const atMostOneEach = (stacks: Record<string, string[]>): void => {
  for (const [presenter, modals] of Object.entries(stacks)) {
    expect({ presenter, modals: modals.length <= 1 ? "ok" : modals }).toEqual({ presenter, modals: "ok" });
  }
};

describe("O3-S1: basket -> Pay on an iPhone", () => {
  test("the basket sheets nest only on an iPhone-sized iOS layout", () => {
    expect(basketSheetsNest("phone", "ios")).toBe(true);
    expect(basketSheetsNest("phone", "android")).toBe(false);
    expect(basketSheetsNest("phone", "web")).toBe(false);
    expect(basketSheetsNest("tablet", "ios")).toBe(false);
    expect(basketSheetsNest("desk", "ios")).toBe(false);
  });

  test("Pay presents from the basket's own sheet: exactly one native modal per presenter", () => {
    const t = till("ios");
    t.openBasket();
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: [] });
    t.tapPay();
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: ["pay"] });
    atMostOneEach(t.stacks());
  });

  test("closing Pay without paying shows the basket again, nothing else claimed open", () => {
    const t = till("ios");
    t.openBasket();
    t.tapPay();
    t.closePay();
    expect(t.open.basket).toBe(true);
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: [] });
  });

  test("the basket closing (outside tap, swipe) takes its sheets with it: no hidden 'open' state", () => {
    const t = till("ios");
    t.openBasket();
    t.tapPay();
    t.closeBasket();
    expect(t.open.pay).toBe(false);
    expect(t.stacks()).toEqual({ screen: [], basket: [] });
    // Taps work again: the bottom bar's Pay opens the basket, and Pay opens the pay sheet.
    t.openBasket();
    t.tapPay();
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: ["pay"] });
  });

  test("Android and web keep sibling sheets (they stack them): state and tree unchanged", () => {
    for (const platform of ["android", "web"]) {
      const t = till(platform);
      t.openBasket();
      t.tapPay();
      expect(t.stacks()).toEqual({ screen: ["basket", "pay"], basket: [] });
      t.closeBasket();
      // Unchanged from before the fix: closing the basket does not touch Pay's state.
      expect(t.open.pay).toBe(true);
    }
  });
});

describe("O3-S1 class: late-money refund opens from the basket and from the paid list", () => {
  test("from the basket it presents from the basket; with the basket closed, from the screen", () => {
    expect(refundHost("phone", "ios", true)).toBe("basket");
    expect(refundHost("phone", "ios", false)).toBe("screen");
    expect(refundHost("phone", "android", true)).toBe("screen");
    expect(refundHost("tablet", "ios", true)).toBe("screen");
    const t = till("ios");
    t.openBasket();
    t.refundFromBasket();
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: ["refund"] });
    t.closeRefund();
    t.closeBasket();
    t.refundFromBasket(); // the paid list's Refund, basket closed
    expect(t.stacks()).toEqual({ screen: ["refund"], basket: [] });
  });
});

describe("O3-S1 class: the check's actions -> Move / Hand over / Rename", () => {
  test("on iOS the next sheet waits until the actions sheet has gone (phone, inside the basket)", () => {
    const t = till("ios");
    t.openBasket();
    t.checkActions();
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: ["check"] });
    t.pickFromActions("move");
    // Actions is leaving; Move is not asked for yet.
    expect(t.open.check).toBeNull();
    atMostOneEach(t.stacks());
    t.actionsGone();
    expect(t.open.check).toBe("move");
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: ["check"] });
  });

  test("on an iPad (tablet) too: the swap waits for the actions sheet to go", () => {
    expect(pickCheckSheet("handover", "ios")).toEqual({ shown: null, queued: "handover" });
    expect(checkSheetGone({ shown: null, queued: "handover" })).toEqual({ shown: "handover", queued: null });
  });

  test("a dismissal that never reports leaves nothing claimed open (taps still work)", () => {
    const t = till("ios");
    t.openBasket();
    t.checkActions();
    t.pickFromActions("rename");
    // No actionsGone(): the Till shows the basket and claims nothing else.
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: [] });
    t.tapPay();
    expect(t.stacks()).toEqual({ screen: ["basket"], basket: ["pay"] });
  });

  test("closing the basket drops a queued sheet so it never opens over nothing", () => {
    const t = till("ios");
    t.openBasket();
    t.checkActions();
    t.pickFromActions("move");
    t.closeBasket();
    t.actionsGone();
    expect(t.open.check).toBeNull();
  });

  test("Android and web swap at once, as before", () => {
    expect(pickCheckSheet("move", "android")).toEqual({ shown: "move", queued: null });
    expect(pickCheckSheet("rename", "web")).toEqual({ shown: "rename", queued: null });
    expect(checkSheetGone({ shown: "move", queued: null })).toEqual({ shown: "move", queued: null });
  });
});

describe("the whole Till on an iPhone: every reachable combination holds one modal per presenter", () => {
  test("sweep", () => {
    const launched = ["pay", "name", "voidRow", "lineRefund", "refund"] as const;
    for (const key of launched) {
      const open: TillSheetsOpen = { ...NONE, basket: true, [key]: true };
      atMostOneEach(presenterStacks(open, "phone", "ios"));
    }
    for (const check of ["actions", "move", "handover", "rename"] as const) {
      atMostOneEach(presenterStacks({ ...NONE, basket: true, check }, "phone", "ios"));
    }
    for (const key of ["receipt", "choices", "offer", "checks", "leave", "refund"] as const) {
      atMostOneEach(presenterStacks({ ...NONE, [key]: true }, "phone", "ios"));
    }
  });
});
