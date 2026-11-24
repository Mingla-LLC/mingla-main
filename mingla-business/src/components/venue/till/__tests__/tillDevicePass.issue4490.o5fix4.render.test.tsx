/**
 * #4490 spec 08 O5 fix 4 — the Till items of the device and browser pass at
 * d20ce4857e, proved on the rendered screens:
 *  3. a sold-out tile's chip stays inside the tile (price and chip wrap; the
 *     chip shrinks; the tile clips);
 *  4. a late payment on a check with no name says who took it, never just
 *     "Team member";
 *  5. after "Split into 2" the sheet goes straight to the shares the server made;
 *  6. a paid check offers no "Pay 0.00" and no "Save check"; Save check needs
 *     something new;
 *  7. a web PIN pad takes 0-9, Backspace and Enter from the keyboard (native
 *     does not listen);
 *  8. the pay sheet's amount reads "Pay part of the bill" while a part is entered.
 *
 * Fails on revert: each test names the line it needs (the tileFoot wrap and
 * tilePill style; latePaymentTitle in DayCloseLate; SplitSheet's submit/sentFrom;
 * payActionShown / saveCheckEnabled in TillScreen; PinPad's keydown effect;
 * the payPart label in PaymentSheet).
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillDevicePass.issue4490.o5fix4
 */

import React from "react";
import { Dimensions, Platform, StyleSheet } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  parent: RenderTreeNode | null;
  children: (RenderTreeNode | string)[];
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

/** venue-till/index.ts `const UUID`, character for character. */
const SERVER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Boundary stubs (native-only deps with no jest side). ------------------
jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: {
      bezier: () => () => 0,
      linear: () => 0,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: () => 0,
      in: (fn: unknown) => fn,
      cubic: () => 0,
    },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withRepeat: (value: unknown) => value,
    withDelay: (_d: unknown, value: unknown) => value,
  };
});
jest.mock("../../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});
jest.mock("expo-linear-gradient", () => {
  const RN = jest.requireActual("react-native");
  return { LinearGradient: RN.View };
});
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

// ---- Data -----------------------------------------------------------------
const PAYMENT_1 = "33333333-3333-4333-8333-333333333331";
const PAYMENT_2 = "33333333-3333-4333-8333-333333333332";
const BASE_SALE = {
  id: "11111111-1111-4111-8111-111111111111",
  venueId: "v1",
  state: "open",
  checkLabel: null,
  spotId: null,
  spotLabel: null,
  serverUserId: "u1",
  currency: "NGN",
  subtotalMinor: 400000,
  serviceChargeMinor: 40000,
  totalDueMinor: 440000,
  paidMinor: 0,
  remainingMinor: 440000,
  overpaidMinor: 0,
  settledOutside: null,
  version: 2,
  businessDate: null,
  pendingPayment: false,
  lines: [] as unknown[],
  payments: [] as unknown[],
};
const payment = (id: string, amountMinor: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  method: "cash",
  state: "paid",
  amountMinor,
  serviceChargeMinor: 0,
  tipMinor: 0,
  cashGivenMinor: amountMinor,
  changeMinor: 0,
  paidLate: false,
  paidAt: "2026-11-23T10:00:00Z",
  reference: "TILL-0001",
  refundedMinor: 0,
  receiptSends: 0,
  chargedMinor: null,
  providerChannel: null,
  cardBrand: null,
  cardLast4: null,
  lateKept: false,
  payCode: null,
  ...extra,
});
const CATALOG = {
  venueId: "v1",
  brandId: "b1",
  venueName: "Gameland QA",
  currency: "NGN",
  serviceChargeBps: 1000,
  canManageMoney: true,
  tipsEnabled: false,
  tipBpsOptions: [],
  tapAvailable: false,
  menus: [{ id: "m1", name: "Food", items: [
    { id: "suya", name: "Suya", priceMinor: 400000, orderable: true, station: "kitchen", modifierGroups: [] },
    { id: "platter", name: "Suya platter", priceMinor: 800000, orderable: true, station: "kitchen", modifierGroups: [], stockLeft: 0, stockWarnAt: null },
  ] }],
  spots: [],
};

/** Each call answers with the next queued answer (a value, or a thrown error). */
type Answer = () => unknown;
const mockState: { sale: unknown; pay: Answer[]; refund: Answer[]; refundLine: Answer[]; scanProps: Record<string, unknown> | null } = {
  sale: BASE_SALE,
  pay: [],
  refund: [],
  refundLine: [],
  scanProps: null,
};
const mockSaleListeners = new Set<() => void>();
const mockSetSale = (sale: unknown): void => {
  mockState.sale = sale;
  for (const listener of mockSaleListeners) listener();
};
const mockCalls = {
  pay: jest.fn(),
  refund: jest.fn(),
  refundLine: jest.fn(),
  startTillScan: jest.fn(),
  setSplit: jest.fn(),
};

jest.mock("../../../../hooks/useVenueTill", () => {
  const mutation = (value: () => unknown, spy?: jest.Mock) => ({
    mutateAsync: jest.fn(async (input: unknown) => {
      spy?.(input);
      return value();
    }),
    isPending: false,
  });
  const queued = (key: "pay" | "refund" | "refundLine") => () => {
    const next = mockState[key].shift();
    if (next === undefined) throw new Error(`no queued ${key} answer`);
    return next();
  };
  return {
    useTillCatalog: () => ({ data: CATALOG, isLoading: false, isError: false, refetch: jest.fn() }),
    useTillChecks: () => ({ data: { open: [], paid: [] }, isLoading: false }),
    // The check re-renders when the server's answer changes it (as the query
    // cache does in the app).
    useTillSale: (_v: string, saleId: string | null) => {
      const ReactLocal = jest.requireActual("react") as typeof React;
      const sale = ReactLocal.useSyncExternalStore(
        (listener: () => void) => {
          mockSaleListeners.add(listener);
          return () => mockSaleListeners.delete(listener);
        },
        () => mockState.sale,
      );
      return { data: saleId === null ? null : sale };
    },
    useTillServers: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
    useTillActions: () => ({
      open: mutation(() => mockState.sale),
      addMenu: mutation(() => mockState.sale),
      addOffer: mutation(() => mockState.sale),
      voidLine: mutation(() => mockState.sale),
      send: mutation(() => mockState.sale),
      pay: mutation(queued("pay"), mockCalls.pay),
      receipt: mutation(() => ({ sendsLeft: 2 })),
      refund: mutation(queued("refund"), mockCalls.refund),
      refundLine: mutation(queued("refundLine"), mockCalls.refundLine),
      relabel: mutation(() => mockState.sale),
      setServer: mutation(() => mockState.sale),
      setSplit: mutation(() => mockState.sale, mockCalls.setSplit),
      seat: mutation(() => mockState.sale),
      startSession: mutation(() => mockState.sale),
      extendSession: mutation(() => mockState.sale),
      refreshSale: jest.fn(),
      // TEST-MOD-APPROVED #4490: useTillActions gained refreshStock (08-O5 fix 2, O5-B2).
      refreshStock: jest.fn(),
    }),
  };
});
jest.mock("../../../../services/venueTillService", () => {
  class TillError extends Error {
    code: string;
    item: string | null = null;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    TillError,
    cancelTillPayCode: jest.fn(),
    fetchTillPayCode: jest.fn(),
    keepTillLatePayment: jest.fn(),
    startTillScan: jest.fn(async (input: unknown) => {
      mockCalls.startTillScan(input);
      return {
        paymentId: PAYMENT_2,
        method: "scan",
        amountMinor: 440000,
        tipMinor: 0,
        chargedMinor: 440000,
        code: "K7MP4XRT",
        payUrl: "http://127.0.0.1/pay/till/K7MP4XRT",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    }),
    startTillTap: jest.fn(),
    textTillPayCode: jest.fn(),
  };
});
jest.mock("../../../../services/venueStationService", () => ({
  runStationAction: jest.fn(),
  StationError: class StationError extends Error {},
}));
jest.mock("../../../../hooks/useVenueOffers", () => ({ useVenueOffers: () => ({ data: { offers: [] } }) }));
jest.mock("../../../../hooks/useStationsEntry", () => ({ useStationsEntry: () => false }));
jest.mock("../../../../hooks/useTapToPayBrandFacts", () => ({ useTapToPayBrandFacts: () => null }));
jest.mock("../../../../hooks/useTapToPayRelease", () => ({ useTapToPayRelease: () => ({ live: false }) }));
jest.mock("../../../../hooks/useUnsavedChangesGuard", () => ({ useUnsavedChangesGuard: () => undefined }));
jest.mock("../../../../services/terminal/tapToPayDevice", () => ({ currentTapToPayDevice: () => null }));
jest.mock("../../../../services/terminal/tapToPaySession", () => ({ setTapToPayScope: () => undefined }));
jest.mock("../../../../utils/floorPdf", () => ({ openFloorPdf: jest.fn() }));
jest.mock("../tillTapAvailability", () => ({ tillTapOffer: () => ({ kind: "hidden" }) }));
jest.mock("../ReceiptStep", () => ({ ReceiptStep: () => null }));
jest.mock("../TillTapPanel", () => ({ TillTapPanel: () => null }));
// The scan panel's insides are not under test; its "Choose another way" is.
jest.mock("../TillScanPanel", () => ({
  TillScanPanel: (props: Record<string, unknown>) => {
    mockState.scanProps = props;
    return null;
  },
}));

// eslint-disable-next-line import/first -- the mocks above must be registered first
import { TillScreen } from "../TillScreen";
// eslint-disable-next-line import/first
import { PinPad } from "../PinPad";
// eslint-disable-next-line import/first
import { TILL_COPY } from "../tillCopy";
// eslint-disable-next-line import/first
import { DayCloseLate } from "../../close/DayCloseLate";
// eslint-disable-next-line import/first
import { CLOSE_COPY } from "../../close/dayCloseCopy";
// eslint-disable-next-line import/first
import type { DaySummary } from "../../../../services/venueDayCloseService";

const find = (tree: RenderTree, testID: string, prop = "onPress"): RenderTreeNode => {
  const target = tree.root.findAll((n) => n.props.testID === testID && typeof n.props[prop] === "function")[0];
  expect({ testID, found: target !== undefined }).toEqual({ testID, found: true });
  return target;
};
const press = async (tree: RenderTree, testID: string): Promise<void> => {
  const target = find(tree, testID);
  await TestRenderer.act(async () => {
    (target.props.onPress as () => void)();
  });
};
const typeMoney = async (tree: RenderTree, testID: string, minor: number): Promise<void> => {
  const field = find(tree, testID, "onChangeMinor");
  await TestRenderer.act(async () => {
    (field.props.onChangeMinor as (v: number) => void)(minor);
  });
};
const settle = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};
// Every mounted Till is unmounted inside act() after its test, so no render
// the screen scheduled (window size, queries) runs after Jest tears the
// environment down ("import a file after the Jest environment has been torn
// down" failed the render lanes with every test green).
const liveTills: RenderTree[] = [];
afterEach(async () => {
  const trees = liveTills.splice(0);
  await TestRenderer.act(async () => {
    for (const tree of trees) tree.unmount();
  });
});
const mount = async (): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<TillScreen venueId="v1" />);
  });
  liveTills.push(tree as unknown as RenderTree);
  return tree as unknown as RenderTree;
};
const openPay = async (t: RenderTree): Promise<void> => {
  await press(t, "till-item-suya");
  await press(t, "till-bar-pay");
  await press(t, "till-pay");
};
const sent = (spy: jest.Mock): Record<string, unknown>[] => spy.mock.calls.map((c) => c[0] as Record<string, unknown>);
const cashTake = async (t: RenderTree, givenMinor: number): Promise<void> => {
  await press(t, "till-pay-cash");
  await typeMoney(t, "till-cash-given", givenMinor);
  await press(t, "till-cash-take");
  await settle();
};
/** The server's answer for a cash payment it recorded. */
const recorded = (paymentId: string, amountMinor: number, sale: unknown, replayed = false) => () => {
  mockSetSale(sale);
  return { sale, paymentId, amountMinor, tipMinor: 0, changeMinor: 0, replayed };
};

const realCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
const noCrypto = (): void => {
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
};
const reset = (): void => {
  noCrypto();
  mockState.sale = BASE_SALE;
  mockState.pay = [];
  mockState.refund = [];
  mockState.refundLine = [];
  mockState.scanProps = null;
  for (const spy of Object.values(mockCalls)) spy.mockClear();
};


const SHARE_1 = "55555555-5555-4555-8555-555555555551";
const SHARE_2 = "55555555-5555-4555-8555-555555555552";
const SPLIT_TWO = {
  ...BASE_SALE,
  version: 3,
  shares: [
    { id: SHARE_1, shareNo: 1, mode: "even", state: "unpaid", amountMinor: 220000, serviceChargeMinor: 20000, setVersion: 3, paymentId: null, items: [] },
    { id: SHARE_2, shareNo: 2, mode: "even", state: "unpaid", amountMinor: 220000, serviceChargeMinor: 20000, setVersion: 3, paymentId: null, items: [] },
  ],
  split: { evenOnly: false, unitsPaid: {}, serviceChargeLeftMinor: 40000 },
};
const PAID_SALE = {
  ...BASE_SALE,
  state: "paid",
  paidMinor: 440000,
  remainingMinor: 0,
  version: 9,
  payments: [payment(PAYMENT_1, 440000)],
};
const ids = (t: RenderTree, testID: string): RenderTreeNode[] => t.root.findAll((n) => n.props.testID === testID);
const flat = (n: RenderTreeNode | null): Record<string, unknown> =>
  (n === null ? {} : (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>);

describe("08-O5 fix 4: the Till after the device pass", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });
  beforeEach(reset);
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("3. a sold-out tile: the chip shrinks inside a row that wraps, and the tile clips", async () => {
    const t = await mount();
    const chip = t.root.findAll((n) => n.props.testID === "till-item-sold-out-platter" && n.props.style !== undefined)[0];
    expect(chip).toBeDefined();
    expect(flat(chip)).toMatchObject({ flexShrink: 1, maxWidth: "100%" });
    let foot: RenderTreeNode | null = chip.parent;
    while (foot !== null && flat(foot).flexDirection !== "row") foot = foot.parent;
    expect(flat(foot)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    const tile = t.root.findAll((n) => n.props.testID === "till-item-platter" && n.props.style !== undefined)
      .map((n) => (typeof n.props.style === "function" ? (n.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : n.props.style))
      .map((s) => StyleSheet.flatten(s as never) as Record<string, unknown>)[0];
    expect(tile).toMatchObject({ overflow: "hidden" });
  });

  test("6. a paid check: no Pay button (never Pay 0.00) and Save check is off; an open check with new lines can be saved", async () => {
    mockState.sale = PAID_SALE;
    const paid = await mount();
    await press(paid, "till-item-suya");
    await press(paid, "till-bar-pay");
    await press(paid, "till-send");
    await settle();
    expect(paid.root.findAll((n) => n.props.testID === "till-pay" && typeof n.props.label === "string")).toHaveLength(0);
    expect(JSON.stringify(paid.root.findAll((n) => typeof n.props.label === "string").map((n) => n.props.label))).not.toContain("Pay ₦0.00");
    expect(find(paid, "till-save").props.disabled).toBe(true);
    paid.unmount();

    mockState.sale = BASE_SALE;
    const open = await mount();
    await press(open, "till-item-suya");
    await press(open, "till-bar-pay");
    expect(find(open, "till-save").props.disabled).toBe(false);
    await press(open, "till-send");
    await settle();
    // Sent, nothing new: nothing to save; money is still due, so Pay shows.
    expect(find(open, "till-save").props.disabled).toBe(true);
    expect(find(open, "till-pay").props.label).toBe("Pay ₦4,400.00");
    open.unmount();
  });

  test("5. Split into 2: once the server has made the shares the sheet shows them, not the editor", async () => {
    mockCalls.setSplit.mockImplementation(() => mockSetSale(SPLIT_TWO));
    const t = await mount();
    await openPay(t);
    await press(t, "till-split-chip-item");
    const seg = t.root.findAll((n) => n.props.value === "by_item" && typeof n.props.onChange === "function")[0];
    expect(seg).toBeDefined();
    await TestRenderer.act(async () => { (seg.props.onChange as (k: string) => void)("even"); });
    await press(t, "till-split-even-go");
    await settle();
    expect(mockCalls.setSplit).toHaveBeenCalledTimes(1);
    expect(ids(t, "till-split-shares").length).toBeGreaterThan(0);
    expect(ids(t, "till-share-pay-2").length).toBeGreaterThan(0);
    expect(ids(t, "till-split-even-go")).toHaveLength(0);
    t.unmount();
  });

  test("8. the amount field says Pay part of the bill while a part is entered, Pay in full otherwise", async () => {
    const t = await mount();
    await openPay(t);
    const label = (): unknown => find(t, "till-pay-amount", "onChangeMinor").props.label;
    expect(label()).toBe(TILL_COPY.payInFull);
    await typeMoney(t, "till-pay-amount", 100000);
    expect(label()).toBe(TILL_COPY.payPart);
    await typeMoney(t, "till-pay-amount", 440000);
    expect(label()).toBe(TILL_COPY.payInFull);
    t.unmount();
  });
});

describe("08-O5 fix 4 item 7: a web PIN pad takes the keyboard", () => {
  type Listener = (e: Record<string, unknown>) => void;
  const listeners = new Set<Listener>();
  const realOS = Platform.OS;
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const hadWindow = g.window !== undefined;
  const realAdd = g.window?.addEventListener;
  const realRemove = g.window?.removeEventListener;
  beforeAll(() => {
    if (!hadWindow) g.window = {};
    (g.window as Record<string, unknown>).addEventListener = (type: string, fn: Listener) => { if (type === "keydown") listeners.add(fn); };
    (g.window as Record<string, unknown>).removeEventListener = (type: string, fn: Listener) => { if (type === "keydown") listeners.delete(fn); };
  });
  afterAll(() => {
    Object.defineProperty(Platform, "OS", { value: realOS, configurable: true });
    if (!hadWindow) delete g.window;
    else {
      (g.window as Record<string, unknown>).addEventListener = realAdd;
      (g.window as Record<string, unknown>).removeEventListener = realRemove;
    }
  });
  const key = async (k: string, extra: Record<string, unknown> = {}): Promise<void> => {
    await TestRenderer.act(async () => {
      // TEST-MOD-APPROVED #4490: 08-O5 fix 5 stops the pad's keys in the capture
      // phase (stopPropagation), so the fake event carries it like a real one.
      for (const fn of [...listeners]) fn({ key: k, target: { tagName: "BODY" }, preventDefault: () => undefined, stopPropagation: () => undefined, ...extra });
    });
  };
  const dotsLabel = (t: RenderTree): unknown => ids(t, "pin-pad-dots")[0]?.props.accessibilityLabel;

  test("web: digits fill the dots, Backspace removes one, Enter submits; typing into a text field is ignored", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    const onSubmit = jest.fn();
    let t: RenderTree | null = null;
    await TestRenderer.act(async () => { t = TestRenderer.create(<PinPad title="Enter your PIN" onSubmit={onSubmit} />); });
    const tree = t as unknown as RenderTree;
    expect(listeners.size).toBe(1);
    for (const d of ["4", "8", "2", "7"]) await key(d);
    await key("Backspace");
    await key("6");
    await key("5", { target: { tagName: "INPUT" } });
    await key("9", { ctrlKey: true });
    expect(dotsLabel(tree)).toBe("4 of 6 digits entered");
    await key("Enter");
    expect(onSubmit).toHaveBeenCalledWith("4826");
    expect(dotsLabel(tree)).toBe("0 of 6 digits entered");
    await TestRenderer.act(async () => { tree.unmount(); });
    expect(listeners.size).toBe(0);
  });

  test("native: the pad does not listen to a keyboard", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    let t: RenderTree | null = null;
    await TestRenderer.act(async () => { t = TestRenderer.create(<PinPad title="Enter your PIN" onSubmit={jest.fn()} />); });
    expect(listeners.size).toBe(0);
    await TestRenderer.act(async () => { (t as unknown as RenderTree).unmount(); });
  });
});

describe("08-O5 fix 4 item 4: a late payment names its check or who took it", () => {
  const summary = (payments: unknown[]): DaySummary => ({
    currency: "NGN",
    businessDate: "2026-11-23",
    late: { count: payments.length, amountMinor: 0, tipMinor: 0, payments, refundCount: 0, refundMinor: 0 },
  } as unknown as DaySummary);
  const titles = (t: RenderTree): string[] =>
    t.root.findAll((n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("day-close-late-") && typeof n.props.title === "string")
      .map((n) => n.props.title as string);

  test("no check name: the row says who took it; a named check keeps its name; never a bare Team member", async () => {
    let t: RenderTree | null = null;
    await TestRenderer.act(async () => {
      t = TestRenderer.create(<DayCloseLate summary={summary([
        { paymentId: "a", method: "cash", amountMinor: 50000, tipMinor: 0, paidAtLocal: "23:10", checkLabel: null,
          takenBy: { userId: "u2", kind: "person", name: "Ada Seller" } },
        { paymentId: "b", method: "cash", amountMinor: 50000, tipMinor: 0, paidAtLocal: "23:20", checkLabel: "Table 4",
          takenBy: { userId: "u2", kind: "person", name: "Ada Seller" } },
        { paymentId: "c", method: "cash", amountMinor: 50000, tipMinor: 0, paidAtLocal: "23:30", checkLabel: null, takenBy: null },
      ])} />);
    });
    const got = titles(t as unknown as RenderTree);
    expect(got[0]).toBe("Taken by Ada Seller · ₦500.00");
    expect(got[1]).toBe("Table 4 · ₦500.00");
    expect(got[2]).toBe(`${CLOSE_COPY.latePaymentUntitled} · ₦500.00`);
    expect(got.join("|")).not.toContain(CLOSE_COPY.person.teamMember);
    await TestRenderer.act(async () => { (t as unknown as RenderTree).unmount(); });
  });
});
