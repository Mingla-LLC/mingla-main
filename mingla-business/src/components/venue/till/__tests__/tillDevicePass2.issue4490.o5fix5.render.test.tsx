/**
 * #4490 spec 08 O5 fix 5 — the Till items of the web + iOS re-check at
 * c79a8ad436, proved on the rendered screens:
 *  1. on a phone the Till header stacks: every action (seller, Close the day,
 *     Checks) sits in a row that wraps, never in one row off the screen;
 *  2. (the same wrap is what keeps a 375 px web page from scrolling sideways);
 *  3. the split shares stack: name and amount on top, a full-width Pay under;
 *  4. a paid check takes no more items: the next item starts a new sale, and
 *     a paid check offers New sale;
 *  5. Who's selling keeps "from Mingla" whole and shortens only the name;
 *  6. a refund sheet grows to the tallest sheet while its PIN pad shows, and
 *     the pad scrolls so OK can always be reached;
 *  7. an unnamed check reads "Check #<ref>" in the Till's lists and the day
 *     close (never "New check" or "Team member");
 *  8. the kitchen header wraps its buttons under the title ("Kitchen" stays whole);
 * 10. the web PIN pad takes its keys in the capture phase and stops them (Enter
 *     never also presses the focused Close); a step-up host keeps what asked
 *     mounted under the pad, and closing it while the pad shows cancels.
 *
 * Fails on revert: each test names the line it needs (tillHeaderStacked and
 * the headerActions wrap; SplitSheet's stacked share; saleTakesItems in
 * addLine / ensureSale; splitMinglaMark in Face; useStepUpSheetSnap; checkTitle;
 * StationBoard's headActions; PinPad's capture listener; TillStepUpHost's
 * hidden children and unmount cancel).
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillDevicePass2.issue4490.o5fix5
 */

import React from "react";
import { Dimensions, Platform, StyleSheet, Text } from "react-native";

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

const mockChecks: { value: { open: unknown[]; paid: unknown[] } } = { value: { open: [], paid: [] } };
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
    useTillChecks: () => ({ data: mockChecks.value, isLoading: false }),
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

jest.mock("../../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "till@example.test" }, isAuthReady: true, signOut: jest.fn() }),
}));

// eslint-disable-next-line import/first -- the mocks above must be registered first
import { TillScreen } from "../TillScreen";
// eslint-disable-next-line import/first
import { PinPad } from "../PinPad";
// eslint-disable-next-line import/first
import { TILL_COPY } from "../tillCopy";
// eslint-disable-next-line import/first
import { TillStepUpHost, STEP_UP_SHEET_SNAP } from "../TillStepUp";
// eslint-disable-next-line import/first
import { WhoIsSelling } from "../WhoIsSelling";
// eslint-disable-next-line import/first
import { DayCloseChecks } from "../../close/DayCloseChecks";
// eslint-disable-next-line import/first
import { StationBoard } from "../../station/StationBoard";
// eslint-disable-next-line import/first
import {
  clearAllTillStaffSessions,
  requestStepUp,
  setTillStaffSession,
  type StepUpAnswer,
} from "../../../../services/tillStaffSession";
// eslint-disable-next-line import/first
import type { DayOpenCheck } from "../../../../services/venueDayCloseService";

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
const mount = async (): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<TillScreen venueId="v1" />);
  });
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
  mockChecks.value = { open: [], paid: [] };
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

const setWidth = (width: number): void => {
  Dimensions.set({ window: { width, height: 800, scale: 2, fontScale: 1 }, screen: { width, height: 800, scale: 2, fontScale: 1 } });
};
const pressLabel = async (t: RenderTree, label: string): Promise<void> => {
  const target = t.root.findAll((n) => n.props.label === label && typeof n.props.onPress === "function")[0];
  expect({ label, found: target !== undefined }).toEqual({ label, found: true });
  await TestRenderer.act(async () => {
    (target.props.onPress as () => void)();
  });
};
/** Whether a row (flexDirection "row") lies between a node and its ancestor with the testID. */
const rowBetween = (node: RenderTreeNode | null, ancestorTestID: string): boolean | null => {
  let n: RenderTreeNode | null = node?.parent ?? null;
  let row = false;
  while (n !== null) {
    if (n.props.testID === ancestorTestID) return row;
    if (flat(n).flexDirection === "row") row = true;
    n = n.parent;
  }
  return null;
};
const within = (node: RenderTreeNode | null, ancestor: RenderTreeNode | null): boolean => {
  let n = node;
  while (n !== null && n !== ancestor) n = n.parent;
  return n !== null && ancestor !== null;
};
const texts = (t: RenderTree): string => JSON.stringify(t.root.findAll((n) => n.type === Text).map((n) => n.props.children));
/** Pay-sheet path to a paid check on screen: send with the server answering the paid check. */
const paidOnScreen = async (): Promise<RenderTree> => {
  mockState.sale = PAID_SALE;
  const t = await mount();
  await press(t, "till-item-suya");
  await press(t, "till-bar-pay");
  await press(t, "till-send");
  await settle();
  return t;
};

describe("08-O5 fix 5: the Till after the web and iOS re-check", () => {
  beforeEach(() => {
    reset();
    setWidth(375);
  });
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("1. phone: the header stacks; Close the day and Checks sit in a wrapping row of their own", async () => {
    const t = await mount();
    const header = ids(t, "till-header").find((n) => n.props.style !== undefined) ?? null;
    const actions = ids(t, "till-header-actions").find((n) => n.props.style !== undefined) ?? null;
    expect(actions !== null).toBe(true);
    expect(flat(actions)).toMatchObject({ flexDirection: "row", flexWrap: "wrap", maxWidth: "100%" });
    // The actions are their own row of the header, not squeezed beside the title.
    expect(flat(header).flexDirection ?? "column").toBe("column");
    expect(rowBetween(actions, "till-header")).toBe(false);
    for (const id of ["till-open-close", "till-checks-open"]) {
      expect({ id, inActions: within(ids(t, id)[0] ?? null, actions) }).toEqual({ id, inActions: true });
    }
    t.unmount();
  });

  test("1b. desk: one header row (the actions beside the title, still allowed to wrap)", async () => {
    setWidth(1280);
    const t = await mount();
    const actions = ids(t, "till-header-actions").find((n) => n.props.style !== undefined) ?? null;
    expect(rowBetween(actions, "till-header")).toBe(true);
    expect(flat(actions)).toMatchObject({ flexWrap: "wrap" });
    t.unmount();
  });

  test("3. split shares stack: name and amount readable, Pay full width under them", async () => {
    mockCalls.setSplit.mockImplementation(() => mockSetSale(SPLIT_TWO));
    const t = await mount();
    await openPay(t);
    await press(t, "till-split-chip-item");
    const seg = t.root.findAll((n) => n.props.value === "by_item" && typeof n.props.onChange === "function")[0];
    await TestRenderer.act(async () => { (seg.props.onChange as (k: string) => void)("even"); });
    await press(t, "till-split-even-go");
    await settle();
    const share = ids(t, "till-share-1").find((n) => n.props.style !== undefined) ?? null;
    expect(share !== null).toBe(true);
    expect(flat(share).flexDirection ?? "column").toBe("column");
    const pay = find(t, "till-share-pay-1");
    expect(pay.props.fullWidth).toBe(true);
    expect(within(pay, share)).toBe(true);
    expect(rowBetween(pay, "till-share-1")).toBe(false);
    const shareText = JSON.stringify(share?.findAll((x) => x.type === Text).map((x) => x.props.children));
    expect(shareText).toContain(TILL_COPY.shareN(1));
    expect(shareText).toContain("₦2,200.00");
    expect(shareText).toContain(TILL_COPY.shareUnpaid);
    t.unmount();
  });

  test("4. a paid check on screen: New sale is offered, and the next item starts a new sale (never joins the paid check)", async () => {
    const t = await paidOnScreen();
    expect(ids(t, "till-basket-new-sale").length).toBeGreaterThan(0);
    expect(find(t, "till-save").props.disabled).toBe(true);
    await press(t, "till-item-suya");
    // The paid check left the screen: a new sale with the item, which can be saved or sent.
    expect(ids(t, "till-basket-new-sale")).toHaveLength(0);
    expect(find(t, "till-save").props.disabled).toBe(false);
    expect(texts(t)).toContain(TILL_COPY.newCheck);
    t.unmount();
  });

  test("4b. New sale on a paid check empties the basket", async () => {
    const t = await paidOnScreen();
    await press(t, "till-basket-new-sale");
    expect(ids(t, "till-basket-new-sale")).toHaveLength(0);
    expect(find(t, "till-bar-pay").props.disabled).toBe(true);
    t.unmount();
  });

  test("7. an unnamed check reads Check #<ref> in Open and Paid today, and the basket names it the same", async () => {
    mockChecks.value = {
      open: [{ id: "9f3a1111-1111-4111-8111-111111111111", checkLabel: null, spotLabel: null, totalDueMinor: 100, paidMinor: 0, waitingForPayment: false }],
      paid: [{ id: "c0de2222-2222-4222-8222-222222222222", checkLabel: null, spotLabel: null, totalDueMinor: 100 }],
    };
    const t = await mount();
    await press(t, "till-checks-open");
    const title = (id: string): unknown => t.root.findAll((n) => n.props.testID === `till-check-${id}` && typeof n.props.title === "string")[0]?.props.title;
    expect(title("9f3a1111-1111-4111-8111-111111111111")).toBe("Check #9F3A");
    const seg = t.root.findAll((n) => n.props.value === "open" && typeof n.props.onChange === "function")[0];
    await TestRenderer.act(async () => { (seg.props.onChange as (k: string) => void)("paid"); });
    expect(title("c0de2222-2222-4222-8222-222222222222")).toBe("Check #C0DE");
    expect(texts(t)).not.toContain(TILL_COPY.teamMember);
    t.unmount();
    const paid = await paidOnScreen();
    expect(texts(paid)).toContain("Check #1111");
    paid.unmount();
  });

  test("6. the refund sheet takes the tallest height while its PIN pad shows, and the pad scrolls", async () => {
    clearAllTillStaffSessions();
    setTillStaffSession({ venueId: "v1", token: "ab".repeat(32), memberId: "seller", memberUserId: "u1", name: "Ada", canApprove: true, autoLockMinutes: 2 });
    const t = await paidOnScreen();
    await pressLabel(t, TILL_COPY.refund);
    const snap = (): unknown => t.root.findAll((n) => n.props.testID === "till-refund" && n.props.snapPoint !== undefined)[0]?.props.snapPoint;
    expect(snap()).toBe(0.7);
    let answer: StepUpAnswer | null | undefined;
    await TestRenderer.act(async () => {
      void requestStepUp("v1", "refund").then((a) => { answer = a; });
    });
    expect(snap()).toBe(STEP_UP_SHEET_SNAP);
    expect(STEP_UP_SHEET_SNAP).toBeGreaterThanOrEqual(0.95);
    const pad = t.root.findAll((n) => n.props.testID === "till-step-up" && n.props.contentContainerStyle !== undefined)[0];
    expect(pad !== undefined).toBe(true);
    await press(t, "till-step-up-cancel");
    expect(answer).toBeNull();
    expect(snap()).toBe(0.7);
    clearAllTillStaffSessions();
    t.unmount();
  });
});

describe("08-O5 fix 5 item 10: the step-up never ends silently", () => {
  beforeEach(() => {
    clearAllTillStaffSessions();
    setTillStaffSession({ venueId: "v9", token: "cd".repeat(32), memberId: "m1", memberUserId: "u1", name: "Ada", canApprove: true, autoLockMinutes: 2 });
  });
  afterAll(() => clearAllTillStaffSessions());

  function Asker({ onMount }: { onMount: () => void }): React.ReactElement {
    const [n] = React.useState(() => {
      onMount();
      return 1;
    });
    return <Text testID="asker">{`asked ${n}`}</Text>;
  }

  test("what asked stays mounted (hidden) under the pad, so it can show the answer", async () => {
    const mounts = jest.fn();
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<TillStepUpHost venueId="v9" approvers={[]}><Asker onMount={mounts} /></TillStepUpHost>);
    });
    const t = tree as unknown as RenderTree;
    await TestRenderer.act(async () => { void requestStepUp("v9", "refund"); });
    expect(ids(t, "till-step-up").length).toBeGreaterThan(0);
    expect(ids(t, "asker").length).toBeGreaterThan(0);
    await press(t, "till-step-up-cancel");
    expect(mounts).toHaveBeenCalledTimes(1);
    t.unmount();
  });

  test("the sheet closing while the pad shows cancels the step-up (the action ends, never hangs unsent)", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<TillStepUpHost venueId="v9" approvers={[]}><Text>body</Text></TillStepUpHost>);
    });
    let answer: StepUpAnswer | null | undefined;
    await TestRenderer.act(async () => { void requestStepUp("v9", "refund").then((a) => { answer = a; }); });
    await TestRenderer.act(async () => { (tree as unknown as RenderTree).unmount(); });
    await settle();
    expect(answer).toBeNull();
  });

  test("web: the pad listens in the capture phase and stops its keys, so Enter never reaches the focused Close", async () => {
    const realOS = Platform.OS;
    const g = globalThis as unknown as { window?: Record<string, unknown> };
    const hadWindow = g.window !== undefined;
    const realAdd = g.window?.addEventListener;
    const realRemove = g.window?.removeEventListener;
    const added: Array<{ fn: (e: Record<string, unknown>) => void; capture: unknown }> = [];
    if (!hadWindow) g.window = {};
    (g.window as Record<string, unknown>).addEventListener = (type: string, fn: (e: Record<string, unknown>) => void, capture?: unknown) => {
      if (type === "keydown") added.push({ fn, capture });
    };
    (g.window as Record<string, unknown>).removeEventListener = () => undefined;
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    try {
      const onSubmit = jest.fn();
      let t: RenderTree | null = null;
      await TestRenderer.act(async () => { t = TestRenderer.create(<PinPad title="PIN" onSubmit={onSubmit} />); });
      expect(added).toHaveLength(1);
      expect(added[0].capture).toBe(true);
      const stopped = jest.fn();
      const key = async (k: string): Promise<void> => {
        await TestRenderer.act(async () => {
          added[0].fn({ key: k, target: { tagName: "DIV" }, preventDefault: () => undefined, stopPropagation: stopped });
        });
      };
      for (const d of ["4", "8", "2", "6"]) await key(d);
      await key("Enter");
      expect(onSubmit).toHaveBeenCalledWith("4826");
      expect(stopped).toHaveBeenCalledTimes(5);
      await TestRenderer.act(async () => { (t as unknown as RenderTree).unmount(); });
    } finally {
      Object.defineProperty(Platform, "OS", { value: realOS, configurable: true });
      if (!hadWindow) delete g.window;
      else {
        (g.window as Record<string, unknown>).addEventListener = realAdd;
        (g.window as Record<string, unknown>).removeEventListener = realRemove;
      }
    }
  });
});

describe("08-O5 fix 5 items 5, 7 and 8: Who's selling, the day close and the kitchen header", () => {
  test("5. Who's selling: the Mingla mark stays whole on its own line; only the name may be shortened", async () => {
    setWidth(320);
    const staff = {
      gated: true, venueName: "Gameland", autoLockMinutes: 2, managerHasPin: true,
      people: [
        { memberId: "m-ada", name: "Ada Okafor from Mingla", isMinglaTeam: true, role: "brand_admin", profile: null, canSell: true, canApprove: true, canManage: true },
        { memberId: "m-kemi", name: "Kemi Seller", role: "venue_staff", profile: "custom", canSell: true, canApprove: false, canManage: false },
      ],
    };
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<WhoIsSelling venueId="v1" staff={staff as never} ended={null} onClose={jest.fn()} />);
    });
    const t = tree as unknown as RenderTree;
    const nameNode = ids(t, "who-face-name-m-ada").find((n) => n.type === Text) ?? null;
    const markNode = ids(t, "who-face-mark-m-ada").find((n) => n.type === Text) ?? null;
    expect(nameNode?.props.children).toBe("Ada Okafor");
    expect(nameNode?.props.numberOfLines).toBe(1);
    expect(markNode?.props.children).toBe("from Mingla");
    expect(ids(t, "who-face-mark-m-kemi")).toHaveLength(0);
    expect(ids(t, "who-face-name-m-kemi").find((n) => n.type === Text)?.props.children).toBe("Kemi Seller");
    // The whole name is still what a screen reader hears.
    expect(t.root.findAll((n) => n.props.testID === "who-face-m-ada" && typeof n.props.accessibilityLabel === "string")[0]?.props.accessibilityLabel)
      .toContain("Ada Okafor from Mingla");
    t.unmount();
  });

  test("7. the day close names an unnamed open check Check #<ref>, never Team member", async () => {
    const check = (saleId: string, label: string | null): DayOpenCheck => ({
      saleId, label, server: { userId: "u2", kind: "person", name: "Ada Seller" }, ageMinutes: 40, dueMinor: 50000,
      state: "open", version: 1, waitingForScan: false, carriedPast: null, blocks: true,
    } as unknown as DayOpenCheck);
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<DayCloseChecks checks={[check("9f3a1111-1111-4111-8111-111111111111", null), check("abcd2222-2222-4222-8222-222222222222", "Table 4")]}
        currency="NGN" busySaleId={null} onOpenInTill={jest.fn()} onMove={jest.fn()} />);
    });
    const t = tree as unknown as RenderTree;
    const text = texts(t);
    expect(text).toContain("Check #9F3A · ₦500.00");
    expect(text).toContain("Table 4 · ₦500.00");
    expect(text).not.toContain("Team member ·");
    t.unmount();
  });

  // TEST-MOD-APPROVED #4490: 08-O5 fix 6 makes the PHONE header a stack (the
  // wrapping row cut the title on iOS); the wrapping row with a one-line title
  // is now the tablet header (columns), pinned here. The phone stack is pinned
  // in tillDevicePass3.issue4490.o5fix6.
  test("8. the kitchen header (tablet): the buttons are their own group in a header that wraps; the title is one line", async () => {
    setWidth(1024);
    const board = {
      venueId: "v1", venueName: "T4490 Kitchen House", brandId: "b1", station: "kitchen", timezone: "Africa/Lagos",
      serverNow: "2026-11-24T10:00:00Z", targetMinutes: { kitchen: 15, bar: 5 }, printPaper: "80mm", defaultStation: "kitchen",
      noStationItems: 0, tickets: [],
    };
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<StationBoard board={board as never} choice="kitchen" onChoose={jest.fn()} columns tab="new"
        onTab={jest.fn()} connection="reconnecting" banner={null} muteLabel="Mute" onMute={jest.fn()} onSoldOut={jest.fn()}
        ageOf={() => 0} ringOn={false} busyKey={null} printingKey={null} onAccept={jest.fn()} onItemReady={jest.fn()}
        onReady={jest.fn()} onPickedUp={jest.fn()} onRecall={jest.fn()} onPrint={jest.fn()} onClose={jest.fn()} showKeepOpen={false} />);
    });
    const t = tree as unknown as RenderTree;
    const group = ids(t, "station-head-actions").find((n) => n.props.style !== undefined) ?? null;
    expect(group !== null).toBe(true);
    expect(flat(group?.parent ?? null)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    for (const id of ["station-sold-out", "station-mute", "station-close"]) {
      let n: RenderTreeNode | null = ids(t, id)[0] ?? null;
      while (n !== null && n !== group) n = n.parent;
      expect({ id, grouped: n === group }).toEqual({ id, grouped: true });
    }
    const title = ids(t, "station-title").find((n) => n.type === Text) ?? null;
    expect(title?.props.numberOfLines).toBe(1);
    // The title block keeps a real width before the buttons wrap below it.
    let head: RenderTreeNode | null = title;
    while (head !== null && head.parent !== group?.parent) head = head.parent;
    expect(Number(flat(head).flexBasis)).toBeGreaterThanOrEqual(180);
    t.unmount();
  });
});
