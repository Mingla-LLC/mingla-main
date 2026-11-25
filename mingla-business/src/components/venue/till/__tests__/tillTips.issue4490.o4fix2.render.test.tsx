/**
 * #4490 spec 08 O4 fix 2 — render proof (the real TillScreen and PaymentSheet):
 * O4-B1 a tip percentage is taken on the food and drink of THIS payment: a
 * by-item share's own items, a typed part, the last of an even split (spec 08
 * §2: food and drink before service charge); O4-B4 "Pay in full" on a split
 * check drops the unpaid shares first (set_split none) and pays what is left
 * in one payment, against the version that answer returned.
 * Fails on revert: with the whole-check tip base, share 2's 10% chip reads
 * 1,550.00 (not 650.00); without the drop, cash is sent while the shares are
 * still open (the server refuses till_split_active).
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillTips
 */

import React from "react";
import { Dimensions } from "react-native";

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
  tipsEnabled: true,
  tipBpsOptions: [1000],
  tapAvailable: false,
  menus: [{ id: "m1", name: "Food", items: [{ id: "suya", name: "Suya", priceMinor: 400000, orderable: true, station: "kitchen", modifierGroups: [] }] }],
  spots: [],
};

/** Each call answers with the next queued answer (a value, or a thrown error). */
type Answer = () => unknown;
const mockState: { sale: unknown; pay: Answer[]; refund: Answer[]; refundLine: Answer[]; scanProps: Record<string, unknown> | null; splitAnswer: unknown } = {
  splitAnswer: null,
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
      setSplit: mutation(() => mockState.splitAnswer ?? mockState.sale, mockCalls.setSplit),
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
  mockState.splitAnswer = null;
  for (const spy of Object.values(mockCalls)) spy.mockClear();
};



// 3 Chapman (2,500.00) + 2 Suya (4,000.00) = 15,500.00 food and drink, 10% service charge: 17,050.00.
const ROUND = {
  id: "66666666-6666-4666-8666-666666666661", kind: "menu_round", state: "committed", amountMinor: 1705000, label: null,
  orderId: "77777777-7777-4777-8777-777777777771", groupId: null, sent: true, fulfillmentStatus: "new", pickupCode: "101",
  sentAt: null, acknowledgedAt: null, stationTickets: [],
  items: [
    { id: "i1", menuItemId: "chapman", name: "Chapman", quantity: 3, unitMinor: 250000, lineTotalMinor: 750000, notes: null, modifiers: [], voided: false, prepState: "new" },
    { id: "i2", menuItemId: "suya", name: "Suya", quantity: 2, unitMinor: 400000, lineTotalMinor: 800000, notes: null, modifiers: [], voided: false, prepState: "new" },
  ],
};
const CHECK = {
  ...BASE_SALE, subtotalMinor: 1550000, serviceChargeMinor: 155000, totalDueMinor: 1705000, remainingMinor: 1705000, lines: [ROUND],
};
const S1 = "55555555-5555-4555-8555-555555555551";
const S2 = "55555555-5555-4555-8555-555555555552";
const S3 = "55555555-5555-4555-8555-555555555553";
const BY_ITEM = {
  ...CHECK, version: 6,
  shares: [
    { id: S1, shareNo: 1, mode: "by_item", state: "unpaid", amountMinor: 275000, serviceChargeMinor: 25000, setVersion: 6, paymentId: null,
      items: [{ orderItemId: "i1", lineId: null, units: 1, amountMinor: 250000 }] },
    { id: S2, shareNo: 2, mode: "by_item", state: "unpaid", amountMinor: 715000, serviceChargeMinor: 65000, setVersion: 6, paymentId: null,
      items: [{ orderItemId: "i1", lineId: null, units: 1, amountMinor: 250000 }, { orderItemId: "i2", lineId: null, units: 1, amountMinor: 400000 }] },
    { id: S3, shareNo: 3, mode: "by_item", state: "unpaid", amountMinor: 715000, serviceChargeMinor: 65000, setVersion: 6, paymentId: null,
      items: [{ orderItemId: "i1", lineId: null, units: 1, amountMinor: 250000 }, { orderItemId: "i2", lineId: null, units: 1, amountMinor: 400000 }] },
  ],
  split: { evenOnly: false, unitsPaid: {}, serviceChargeLeftMinor: 155000 },
};
const EVEN_3 = {
  ...CHECK, version: 7,
  shares: [
    { id: S1, shareNo: 1, mode: "even", state: "unpaid", amountMinor: 568334, serviceChargeMinor: 51668, setVersion: 7, paymentId: null, items: [] },
    { id: S2, shareNo: 2, mode: "even", state: "unpaid", amountMinor: 568333, serviceChargeMinor: 51666, setVersion: 7, paymentId: null, items: [] },
    { id: S3, shareNo: 3, mode: "even", state: "unpaid", amountMinor: 568333, serviceChargeMinor: 51666, setVersion: 7, paymentId: null, items: [] },
  ],
  split: { evenOnly: false, unitsPaid: {}, serviceChargeLeftMinor: 155000 },
};
const chipLabel = (t: RenderTree, bps: number): unknown =>
  t.root.findAll((n) => n.props.testID === `till-tip-${bps}` && typeof n.props.label === "string")[0]?.props.label;

describe("O4-B1: a tip percentage is taken on what THIS payment pays for", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });
  beforeEach(reset);
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("the whole check: 10% of its food and drink (15,500.00 -> 1,550.00), unchanged", async () => {
    mockState.sale = CHECK;
    const t = await mount();
    await openPay(t);
    expect(chipLabel(t, 1000)).toBe("10% · ₦1,550.00");
  });

  test("a by-item share tips on its own items: share 2 (Chapman + Suya, 6,500.00) -> 650.00, sent with the share", async () => {
    mockState.sale = BY_ITEM;
    mockState.pay = [recorded(PAYMENT_2, 715000, BY_ITEM)];
    const t = await mount();
    await openPay(t);
    await press(t, "till-share-pay-2");
    expect(chipLabel(t, 1000)).toBe("10% · ₦650.00");
    await press(t, "till-tip-1000");
    await cashTake(t, 780000);
    expect(sent(mockCalls.pay)[0]).toMatchObject({ method: "cash", shareId: S2, amountMinor: 715000, tipMinor: 65000 });
  });

  test("a typed part payment tips on its part: half the check -> 775.00", async () => {
    mockState.sale = CHECK;
    mockState.pay = [recorded(PAYMENT_2, 852500, { ...CHECK, paidMinor: 852500, remainingMinor: 852500 })];
    const t = await mount();
    await openPay(t);
    await typeMoney(t, "till-pay-amount", 852500);
    expect(chipLabel(t, 1000)).toBe("10% · ₦775.00");
    await press(t, "till-tip-1000");
    await cashTake(t, 1000000);
    expect(sent(mockCalls.pay)[0]).toMatchObject({ amountMinor: 852500, tipMinor: 77500, shareId: null });
  });

  test("the last share of an even split of 3 tips on its third (rounded): 5,683.33 -> 516.67", async () => {
    mockState.sale = EVEN_3;
    const t = await mount();
    await openPay(t);
    await press(t, "till-share-pay-3");
    // food 15,500.00 x 568,333 / 1,705,000 = 5,166.66 -> 10% = 516.67
    expect(chipLabel(t, 1000)).toBe("10% · ₦516.67");
  });
});

describe("O4-B4: Pay in full on a split check pays everything left in one payment", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });
  beforeEach(reset);

  test("cash with Pay in full chosen: the unpaid share is dropped first, then the rest is taken against the new version", async () => {
    const SPLIT = {
      ...CHECK, version: 6, paidMinor: 852500, remainingMinor: 852500,
      payments: [payment(PAYMENT_1, 852500, { shareId: S1 })],
      shares: [
        { id: S1, shareNo: 1, mode: "even", state: "paid", amountMinor: 852500, serviceChargeMinor: 77500, setVersion: 5, paymentId: PAYMENT_1, items: [] },
        { id: S2, shareNo: 2, mode: "even", state: "unpaid", amountMinor: 852500, serviceChargeMinor: 77500, setVersion: 5, paymentId: null, items: [] },
      ],
      split: { evenOnly: true, unitsPaid: {}, serviceChargeLeftMinor: 77500 },
    };
    mockState.sale = { ...CHECK, paidMinor: 852500, remainingMinor: 852500, payments: [payment(PAYMENT_1, 852500)] };
    mockState.splitAnswer = { ...SPLIT, version: 9, shares: [SPLIT.shares[0]] };
    mockState.pay = [recorded(PAYMENT_2, 852500, { ...SPLIT, state: "paid", paidMinor: 1705000, remainingMinor: 0, version: 11 })];
    const t = await mount();
    await openPay(t);
    // The sheet is on "Pay in full" (methods) when another device's split arrives.
    await TestRenderer.act(async () => mockSetSale(SPLIT));
    await cashTake(t, 852500);
    expect(sent(mockCalls.setSplit)).toEqual([expect.objectContaining({ split: { mode: "none" } })]);
    expect(sent(mockCalls.pay)).toHaveLength(1);
    expect(sent(mockCalls.pay)[0]).toMatchObject({ method: "cash", shareId: null, amountMinor: 852500, expectedVersion: 9 });
  });
});
