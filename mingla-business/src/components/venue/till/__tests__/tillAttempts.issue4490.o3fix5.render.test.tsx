/**
 * #4490 spec 08 O3 fix 5 — O3-S3 render proof: after a part payment, "Pay <rest>"
 * is a NEW payment with its own request id, and the paid step shows the amount
 * the server recorded (from the answer), never the typed one.
 *
 * The suite removes `globalThis.crypto` (the Hermes condition), renders the
 * real TillScreen with the real PaymentSheet and drives the device test's
 * sequence: part-pay ₦1,000 cash on a ₦4,400 check → "Pay ₦3,400.00" → Cash →
 * Take. It reads each request the sheet sends. Also: a retry after an unclear
 * failure reuses the id (same attempt), a definite refusal / another amount /
 * "Choose another way" / Pay the rest get a new one, and both refund forms do
 * the same.
 *
 * Fails on revert: with PaymentSheet back on one id per sheet opening (the
 * fix-4 `requestId` ref) the two payments share an id; with the paid step back
 * on `amountMinor: payAmount` the shown amount is the typed one.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillAttempts
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
const PAID_LINE_ID = "22222222-2222-4222-8222-222222222222";
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
/** After the ₦1,000 part payment: ₦3,400 left, version moved. */
const PART_SALE = { ...BASE_SALE, paidMinor: 100000, remainingMinor: 340000, version: 3, payments: [payment(PAYMENT_1, 100000)] };
const PAID_SALE = {
  ...BASE_SALE,
  state: "paid",
  paidMinor: 440000,
  remainingMinor: 0,
  version: 4,
  lines: [
    {
      id: PAID_LINE_ID,
      kind: "offer",
      state: "committed",
      amountMinor: 440000,
      label: "Entry",
      orderId: null,
      groupId: "44444444-4444-4444-8444-444444444444",
      sent: null,
      fulfillmentStatus: null,
      pickupCode: null,
      sentAt: null,
      acknowledgedAt: null,
      stationTickets: [],
      items: [],
    },
  ],
  payments: [payment(PAYMENT_1, 440000)],
};
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
  menus: [{ id: "m1", name: "Food", items: [{ id: "suya", name: "Suya", priceMinor: 400000, orderable: true, station: "kitchen", modifierGroups: [] }] }],
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
import { formatCurrency } from "../../../../utils/currency";

const { TillError } = jest.requireMock("../../../../services/venueTillService") as {
  TillError: new (code: string) => Error;
};
const money = (minor: number): string => formatCurrency(minor, "NGN", true);

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
const pressLabel = async (tree: RenderTree, label: string): Promise<void> => {
  const target = tree.root.findAll((n) => n.props.label === label && typeof n.props.onPress === "function")[0];
  expect({ label, found: target !== undefined }).toEqual({ label, found: true });
  await TestRenderer.act(async () => {
    (target.props.onPress as () => void)();
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
const textOf = (node: RenderTreeNode): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const paidAmountShown = (t: RenderTree): string | null => {
  const nodes = t.root.findAll((n) => n.props.testID === "till-paid-amount" && typeof n.type === "string");
  return nodes.length > 0 ? textOf(nodes[0]) : null;
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

describe("O3-S3: with no globalThis.crypto, each Till payment attempt has its own id and the paid step shows the server's amount", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });
  beforeEach(reset);
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("part payment, then Pay the rest, then pay: two different UUID ids, the rest's amount, each paid step from the answer", async () => {
    expect(globalThis.crypto).toBeUndefined();
    mockState.pay = [recorded(PAYMENT_1, 100000, PART_SALE), recorded(PAYMENT_2, 340000, { ...PART_SALE, paidMinor: 440000, remainingMinor: 0, state: "paid", version: 4 })];
    const t = await mount();
    await openPay(t);
    await typeMoney(t, "till-pay-amount", 100000);
    await cashTake(t, 100000);
    expect(paidAmountShown(t)).toBe(money(100000));

    await press(t, "till-pay-rest");
    // The rest is the amount now, not the part just typed.
    expect(find(t, "till-pay-amount", "onChangeMinor").props.valueMinor).toBe(340000);
    await cashTake(t, 340000);

    const calls = sent(mockCalls.pay);
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(first.clientRequestId).toMatch(SERVER_UUID);
    expect(second.clientRequestId).toMatch(SERVER_UUID);
    expect(second.clientRequestId).not.toBe(first.clientRequestId);
    expect([first.amountMinor, second.amountMinor]).toEqual([100000, 340000]);
    expect(second.expectedVersion).toBe(3);
    expect(paidAmountShown(t)).toBe(money(340000));
    await TestRenderer.act(async () => t.unmount());
  });

  test("the paid step shows what the server recorded, not what was typed (a replayed answer of ₦1,000 is shown as ₦1,000)", async () => {
    mockState.pay = [recorded(PAYMENT_1, 100000, PART_SALE, true)];
    const t = await mount();
    await openPay(t);
    await typeMoney(t, "till-pay-amount", 340000);
    await cashTake(t, 340000);
    expect(sent(mockCalls.pay)[0].amountMinor).toBe(340000);
    expect(paidAmountShown(t)).toBe(money(100000));
    expect(paidAmountShown(t)).not.toBe(money(340000));
    await TestRenderer.act(async () => t.unmount());
  });

  test("an answer with no recorded amount falls back to the check's own payment row, never to the typed amount", async () => {
    mockState.pay = [() => {
      mockSetSale(PART_SALE);
      return { sale: PART_SALE, paymentId: PAYMENT_1, amountMinor: null, tipMinor: null, changeMinor: 0, replayed: false };
    }];
    const t = await mount();
    await openPay(t);
    await typeMoney(t, "till-pay-amount", 100000);
    await cashTake(t, 100000);
    expect(paidAmountShown(t)).toBe(money(100000));
    await TestRenderer.act(async () => t.unmount());
  });

  test("a retry after an unclear failure (network) reuses the id; after a definite refusal the next try is a new id", async () => {
    mockState.pay = [
      () => {
        throw new TillError("network");
      },
      () => {
        throw new TillError("till_check_changed");
      },
      recorded(PAYMENT_1, 440000, PAID_SALE),
    ];
    const t = await mount();
    await openPay(t);
    await cashTake(t, 440000); // network: stays on the cash step
    await press(t, "till-cash-take"); // the same attempt again
    await settle();
    await cashTake(t, 440000); // refused (check changed): back on the methods, then again
    const ids = sent(mockCalls.pay).map((c) => c.clientRequestId);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(SERVER_UUID);
    await TestRenderer.act(async () => t.unmount());
  });

  test("another amount after an unclear failure is another attempt: a new id", async () => {
    mockState.pay = [
      () => {
        throw new TillError("network");
      },
      recorded(PAYMENT_1, 200000, PART_SALE),
    ];
    const t = await mount();
    await openPay(t);
    await typeMoney(t, "till-pay-amount", 100000);
    await cashTake(t, 100000);
    await pressLabel(t, "No, go back");
    await typeMoney(t, "till-pay-amount", 200000);
    await cashTake(t, 200000);
    const ids = sent(mockCalls.pay).map((c) => c.clientRequestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
    expect(paidAmountShown(t)).toBe(money(200000));
    await TestRenderer.act(async () => t.unmount());
  });

  test("a scan code dropped with Choose another way: the next payment (cash) gets a new id", async () => {
    mockState.pay = [recorded(PAYMENT_1, 440000, PAID_SALE)];
    const t = await mount();
    await openPay(t);
    await press(t, "till-pay-scan");
    await settle();
    expect(mockState.scanProps).not.toBeNull();
    await TestRenderer.act(async () => {
      (mockState.scanProps?.onChooseAnother as () => void)();
    });
    await cashTake(t, 440000);
    const scanId = sent(mockCalls.startTillScan)[0].clientRequestId;
    const cashId = sent(mockCalls.pay)[0].clientRequestId;
    expect(scanId).toMatch(SERVER_UUID);
    expect(cashId).toMatch(SERVER_UUID);
    expect(cashId).not.toBe(scanId);
    await TestRenderer.act(async () => t.unmount());
  });
});

describe("O3-S3 refunds: one id per refund attempt", () => {
  beforeEach(reset);
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("a payment refund retried after a network failure reuses its id; the next, different refund gets a new one; a line refund too", async () => {
    mockState.sale = PAID_SALE;
    mockState.refund = [
      () => {
        throw new TillError("network");
      },
      () => PAID_SALE,
      () => PAID_SALE,
    ];
    mockState.refundLine = [() => PAID_SALE];
    const t = await mount();
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    await press(t, "till-send");
    await settle();
    const refundOnce = async (amountMinor: number): Promise<void> => {
      const refundButton = t.root.findAll((n) => n.props.label === "Refund" && typeof n.props.onPress === "function")[0];
      expect(refundButton).toBeDefined();
      await TestRenderer.act(async () => {
        (refundButton.props.onPress as () => void)();
      });
      const sheet = t.root.findAll((n) => typeof n.props.onRefund === "function" && n.props.payment != null)[0];
      expect(sheet).toBeDefined();
      await TestRenderer.act(async () => {
        (sheet.props.onRefund as (a: number, r: string) => void)(amountMinor, "Wrong item");
      });
      await settle();
    };
    await refundOnce(50000); // network
    await refundOnce(50000); // the same refund again: same id
    await refundOnce(50000); // done before, so this is a second refund: new id
    const ids = sent(mockCalls.refund).map((c) => c.clientRequestId);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(SERVER_UUID);

    await press(t, `till-row-line:${PAID_LINE_ID}`);
    const lineSheet = t.root.findAll((n) => typeof n.props.onRefund === "function" && n.props.row != null)[0];
    expect(lineSheet).toBeDefined();
    await TestRenderer.act(async () => {
      (lineSheet.props.onRefund as (r: string) => void)("Changed plans");
    });
    await settle();
    const lineId = sent(mockCalls.refundLine)[0].clientRequestId;
    expect(lineId).toMatch(SERVER_UUID);
    expect(ids).not.toContain(lineId);
    await TestRenderer.act(async () => t.unmount());
  });
});
