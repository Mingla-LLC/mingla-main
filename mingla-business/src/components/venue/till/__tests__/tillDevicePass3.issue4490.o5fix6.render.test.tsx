/**
 * #4490 spec 08 O5 fix 6 — the defects of device pass 3, proved on rendered
 * screens at phone widths:
 *  1. the kitchen header on a phone is a stack: the title block takes the full
 *     width (title, venue and connection never cut), the buttons wrap under it;
 *  2. Close the day tiles take the full width on a phone, so an amount never
 *     breaks inside the number;
 *  3. a Till payment row keeps its amount whole: the method is what shortens;
 *  4. a blocking open check on the day close stacks its name over Pay, Void
 *     and Move to tomorrow on a phone;
 *  6. a PIN pad taller than its sheet scrolls to OK on open; inside a sheet's
 *     scroll area it asks that area to bring OK and Cancel into view;
 *  7. while a PIN pad shows, swipe, back and Close cancel it like Cancel
 *     (the sheet is not locked by the waiting refund, and "Nothing was changed");
 *  8. the Team page's "Your role doesn't include this action" waits for the role.
 * (Item 5, the cheaper-swap confirm, is in tillSoldOut.issue4490.o5fix2.)
 *
 * Fails on revert: each test names what it needs (StationBoard headerPhone;
 * DayCloseTotals tile flexBasis 100%; the paid row's own amount text;
 * DayCloseChecks stacked; StepUpPanel fitPad; stepUpSheetControl spread on
 * RefundSheet; teamGateCaptionShown and the role in teamListState's loading).
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillDevicePass3.issue4490.o5fix6
 */

import React from "react";
import { Dimensions, Platform, StyleSheet, Text } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  parent: RenderTreeNode | null;
  children: (RenderTreeNode | string)[];
  instance?: unknown;
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
import { TILL_COPY } from "../tillCopy";
// eslint-disable-next-line import/first
import { TillStepUpHost, stepUpSheetControl } from "../TillStepUp";
// eslint-disable-next-line import/first
import { DayCloseTotals } from "../../close/DayCloseTotals";
// eslint-disable-next-line import/first
import { ScrollRevealContext, revealDelta } from "../../../ui/SheetScrollLayout";
// eslint-disable-next-line import/first
import { teamGateCaptionShown, teamListState } from "../../../team/teamRowModel";
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


const ownMachinePaid = {
  ...BASE_SALE,
  state: "paid",
  paidMinor: 400000,
  remainingMinor: 0,
  version: 9,
  payments: [payment(PAYMENT_1, 400000, { method: "own_machine" })],
};
const boardProps = (columns: boolean) => ({
  board: {
    venueId: "v1", venueName: "T4490 Play House Kitchen", brandId: "b1", station: "kitchen", timezone: "Africa/Lagos",
    serverNow: "2026-11-24T10:00:00Z", targetMinutes: { kitchen: 15, bar: 5 }, printPaper: "80mm", defaultStation: "kitchen",
    noStationItems: 0, tickets: [],
  } as never,
  choice: "all" as never, onChoose: jest.fn(), columns, tab: "new" as never, onTab: jest.fn(), connection: "reconnecting" as never,
  banner: null, muteLabel: "Mute", onMute: jest.fn(), onSoldOut: jest.fn(), ageOf: () => 0, ringOn: false, busyKey: null,
  printingKey: null, onAccept: jest.fn(), onItemReady: jest.fn(), onReady: jest.fn(), onPickedUp: jest.fn(), onRecall: jest.fn(),
  onPrint: jest.fn(), onClose: jest.fn(), showKeepOpen: false,
});
const create = async (el: React.ReactElement): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(el);
  });
  return tree as unknown as RenderTree;
};
const styled = (t: RenderTree, testID: string): RenderTreeNode | null =>
  ids(t, testID).find((n) => n.props.style !== undefined) ?? null;

describe("08-O5 fix 6 item 1: the kitchen header on a phone", () => {
  test("phone (no columns): a stack; the title block is full width and nothing in it is cut to one line", async () => {
    setWidth(402);
    const t = await create(<StationBoard {...boardProps(false)} />);
    const header = styled(t, "station-header");
    expect(flat(header)).toMatchObject({ flexDirection: "column", alignItems: "stretch" });
    const actions = styled(t, "station-head-actions");
    // The buttons are their own row under the title, never beside it.
    expect(rowBetween(actions, "station-header")).toBe(false);
    const title = ids(t, "station-title").find((n) => n.type === Text) ?? null;
    expect(title?.props.numberOfLines).toBeUndefined();
    expect(rowBetween(title, "station-header")).toBe(false);
    const venue = t.root.findAll((n) => n.type === Text && n.props.children === "T4490 Play House Kitchen")[0];
    expect(venue?.props.numberOfLines).toBeUndefined();
    t.unmount();
  });

  test("tablet (columns): one header row, the buttons beside the title", async () => {
    setWidth(1024);
    const t = await create(<StationBoard {...boardProps(true)} />);
    expect(flat(styled(t, "station-header"))).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    t.unmount();
  });
});

describe("08-O5 fix 6 item 2: Close the day amounts never break inside the number", () => {
  const summary = {
    currency: "NGN",
    totals: {
      takings: { amountMinor: 7800000, count: 20, tipMinor: 140000, guestFeesMinor: 0 },
      cash: { expectedMinor: 4840000 },
      serviceChargeMinor: 0,
      refunds: { amountMinor: 1100000, count: 5 },
      voids: { amountMinor: 650000, count: 2 },
      byMethod: [], people: [], tipsByServer: [], tipsOtherMinor: 0,
      categories: { foodAndDrinkMinor: 0, bookingsMinor: 0, onOpenChecksMinor: 0 },
      net: { takingsMinor: 0 }, depositsUsed: { amountMinor: 0 }, depositRefunded: { amountMinor: 0 },
      door: { amountMinor: 0 }, orderedOnline: { amountMinor: 0 }, card: { minglaFeesMinor: 0, toBankMinor: 0 },
      paidInToday: null,
    },
  };
  test("phone: every money tile takes the full width (₦78,000.00 has a line of its own)", async () => {
    const t = await create(<DayCloseTotals summary={summary as never} wide={false} />);
    for (const id of ["day-close-takings", "day-close-cash", "day-close-refunds"]) {
      const tile = styled(t, id);
      expect({ id, basis: flat(tile).flexBasis }).toEqual({ id, basis: "100%" });
    }
    expect(texts(t)).toContain("₦78,000.00");
    t.unmount();
  });
  test("wide: three a row", async () => {
    const t = await create(<DayCloseTotals summary={summary as never} wide />);
    expect(flat(styled(t, "day-close-takings")).flexBasis).toBe("30%");
    t.unmount();
  });
});

describe("08-O5 fix 6 item 3: a Till payment row keeps its amount whole", () => {
  beforeEach(() => {
    reset();
    setWidth(375);
  });
  test("the method shortens on one line; the amount is its own text that never shrinks", async () => {
    mockState.sale = ownMachinePaid;
    const t = await mount();
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    await press(t, "till-send");
    await settle();
    const method = ids(t, `till-paid-method-${PAYMENT_1}`).find((n) => n.type === Text) ?? null;
    const amount = ids(t, `till-paid-amount-${PAYMENT_1}`).find((n) => n.type === Text) ?? null;
    expect(method?.props.children).toBe(TILL_COPY.ownMachine);
    expect(method?.props.numberOfLines).toBe(1);
    expect(flat(method)).toMatchObject({ flexShrink: 1 });
    expect(amount?.props.children).toBe("₦4,000.00");
    expect(flat(amount).flexShrink).toBe(0);
    // Send receipt and Refund are under the line, not squeezing it.
    expect(within(ids(t, `till-receipt-open-${PAYMENT_1}`)[0] ?? null, method?.parent ?? null)).toBe(false);
    t.unmount();
  });
});

describe("08-O5 fix 6 item 4: a blocking open check stacks on a phone", () => {
  const check = {
    saleId: "9f3a1111-1111-4111-8111-111111111111", label: "Check 12 for the long table", server: { userId: "u2", kind: "person", name: "T4490 Owner" },
    ageMinutes: 40, dueMinor: 50000, state: "open", version: 1, waitingForScan: false, carriedPast: null, blocks: true,
  } as unknown as DayOpenCheck;
  test("phone: the name and who on top (two lines allowed), Pay, Void and Move to tomorrow underneath", async () => {
    const t = await create(<DayCloseChecks stacked checks={[check]} currency="NGN" busySaleId={null} onOpenInTill={jest.fn()} onMove={jest.fn()} />);
    const row = styled(t, `day-close-check-${check.saleId}`);
    expect(flat(row).flexDirection).toBe("column");
    for (const id of ["pay", "void", "move"]) {
      const button = ids(t, `day-close-check-${id}-${check.saleId}`)[0] ?? null;
      expect({ id, inRow: within(button, row) }).toEqual({ id, inRow: true });
    }
    const name = t.root.findAll((n) => n.type === Text && String(n.props.children).startsWith("Check 12"))[0];
    expect(name.props.numberOfLines).toBe(2);
    expect(rowBetween(name, `day-close-check-${check.saleId}`)).toBe(false);
    t.unmount();
  });
  test("the day close screen stacks them below 600 wide", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require("fs").readFileSync(require("path").join(__dirname, "../../close/DayCloseScreen.tsx"), "utf8") as string;
    expect(source).toContain("<DayCloseChecks stacked={!wide}");
  });
  test("the day close header: on a phone the seller pill has its own row, so the title is never cut", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require("fs").readFileSync(require("path").join(__dirname, "../../close/DayCloseScreen.tsx"), "utf8") as string;
    expect(source).toContain("{wide ? sellerSlot : null}");
    expect(source).toContain('testID="day-close-seller-row">{sellerSlot}</View>');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gate = require("fs").readFileSync(require("path").join(__dirname, "../../close/DayCloseGate.tsx"), "utf8") as string;
    expect(gate).not.toContain('maxWidth: "50%"');
  });
});

describe("08-O5 fix 6 items 6 and 7: the PIN pad in its sheet", () => {
  beforeEach(() => {
    reset();
    setWidth(375);
    clearAllTillStaffSessions();
    setTillStaffSession({ venueId: "v1", token: "ab".repeat(32), memberId: "seller", memberUserId: "u1", name: "Ada", canApprove: true, autoLockMinutes: 2 });
  });
  afterEach(() => clearAllTillStaffSessions());

  const padScroll = (t: RenderTree): RenderTreeNode =>
    t.root.findAll((n) => n.props.testID === "till-step-up" && typeof n.props.onContentSizeChange === "function" && n.instance != null)[0] as RenderTreeNode;

  test("6. a pad taller than its sheet scrolls to OK when it opens (Android)", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<TillStepUpHost venueId="v1" approvers={[]}><Text>body</Text></TillStepUpHost>);
    });
    const t = tree as unknown as RenderTree;
    await TestRenderer.act(async () => { void requestStepUp("v1", "refund"); });
    const scroll = padScroll(t);
    const toEnd = (scroll as unknown as { instance: { scrollToEnd: jest.Mock } }).instance.scrollToEnd;
    toEnd.mockClear();
    await TestRenderer.act(async () => {
      (scroll.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 560 } } });
      (scroll.props.onContentSizeChange as (w: number, h: number) => void)(375, 720);
    });
    expect(toEnd).toHaveBeenCalledTimes(1);
    await press(t, "till-step-up-cancel");
    t.unmount();
  });

  test("6. a pad that fits does not scroll; inside a sheet's scroll area it asks that area to show its bottom", async () => {
    const reveal = jest.fn();
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ScrollRevealContext.Provider value={reveal}>
          <TillStepUpHost venueId="v1" approvers={[]}><Text>body</Text></TillStepUpHost>
        </ScrollRevealContext.Provider>,
      );
    });
    const t = tree as unknown as RenderTree;
    await TestRenderer.act(async () => { void requestStepUp("v1", "refund"); });
    const scroll = padScroll(t);
    const toEnd = (scroll as unknown as { instance: { scrollToEnd: jest.Mock } }).instance.scrollToEnd;
    toEnd.mockClear();
    await TestRenderer.act(async () => {
      (scroll.props.onContentSizeChange as (w: number, h: number) => void)(375, 640);
      (scroll.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 640 } } });
    });
    expect(toEnd).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledTimes(1);
    await press(t, "till-step-up-cancel");
    t.unmount();
  });

  test("6. reveal math: scroll by what is below the fold, nothing when it is in view", () => {
    expect(revealDelta(1000, 840)).toBe(168);
    expect(revealDelta(800, 840)).toBe(0);
  });

  test("7. the control: while the pad shows the sheet is never locked; swipe, back and Close cancel it", () => {
    const onClose = jest.fn();
    const pending = stepUpSheetControl(true, 0.7, true, onClose);
    expect(pending.sheet.dismissDisabled).toBe(false);
    expect(pending.sheet.dismissGuard()).toBe(true);
    expect(pending.closeDisabled).toBe(false);
    expect(pending.sheet.snapPoint).toBeGreaterThanOrEqual(0.95);
    const idleBusy = stepUpSheetControl(false, 0.7, true, onClose);
    expect(idleBusy.sheet.dismissDisabled).toBe(true);
    expect(idleBusy.sheet.dismissGuard()).toBe(false);
    expect(idleBusy.close).toBe(onClose);
    expect(idleBusy.sheet.snapPoint).toBe(0.7);
  });

  test("7. a refund waiting on the PIN: a swipe (or back) cancels like Cancel, the sheet stays, Nothing was changed", async () => {
    const t = await paidOnScreen();
    let answered: StepUpAnswer | null | undefined;
    mockState.refund.push(async () => {
      const answer = await requestStepUp("v1", "refund");
      answered = answer;
      if (answer === null) {
        const { TillError } = jest.requireMock("../../../../services/venueTillService") as { TillError: new (c: string) => Error };
        throw new TillError("pin_step_up_cancelled");
      }
      return mockState.sale;
    });
    await pressLabel(t, TILL_COPY.refund);
    await press(t, "till-refund-confirm");
    await settle();
    expect(ids(t, "till-step-up").length).toBeGreaterThan(0);
    const sheet = t.root.findAll((n) => n.props.testID === "till-refund" && typeof n.props.dismissGuard === "function")[0];
    // The waiting refund does not lock the sheet while the pad shows.
    expect(sheet.props.dismissDisabled).toBe(false);
    expect((sheet.props.dismissGuard as () => boolean)()).toBe(true);
    // What a swipe past the close point, the Android back button and a scrim tap call.
    await TestRenderer.act(async () => { (sheet.props.onRequestClose as () => void)(); });
    await settle();
    expect(answered).toBeNull();
    expect(ids(t, "till-step-up")).toHaveLength(0);
    expect(t.root.findAll((n) => n.props.testID === "till-refund" && n.props.visible === true).length).toBeGreaterThan(0);
    expect(texts(t)).toContain("Nothing was changed.");
    t.unmount();
  });

  test("7. the sheet's Close while the pad shows cancels too (it is not disabled by the waiting refund)", async () => {
    const t = await paidOnScreen();
    let answered: StepUpAnswer | null | undefined;
    mockState.refund.push(async () => {
      answered = await requestStepUp("v1", "refund");
      const { TillError } = jest.requireMock("../../../../services/venueTillService") as { TillError: new (c: string) => Error };
      throw new TillError("pin_step_up_cancelled");
    });
    await pressLabel(t, TILL_COPY.refund);
    await press(t, "till-refund-confirm");
    await settle();
    const sheet = t.root.findAll((n) => n.props.testID === "till-refund" && typeof n.props.dismissGuard === "function")[0];
    const close = sheet.findAll((n) => n.props.label === TILL_COPY.close && typeof n.props.onPress === "function")[0];
    expect(close.props.disabled).toBe(false);
    await TestRenderer.act(async () => { (close.props.onPress as () => void)(); });
    await settle();
    expect(answered).toBeNull();
    expect(ids(t, "till-step-up")).toHaveLength(0);
    t.unmount();
  });
});

describe("08-O5 fix 6 item 8: the Team page waits for the role", () => {
  test("while the role loads the list is loading, and the role caption only shows under a loaded list", () => {
    // team.tsx passes peopleLoading || roleLoading: people loaded, role not yet.
    const loading = teamListState({ loading: true, pendingCount: 0, acceptedCount: 3 });
    expect(loading).toBe("loading");
    expect(teamGateCaptionShown(loading, false)).toBe(false);
    expect(teamGateCaptionShown("list", false)).toBe(true);
    expect(teamGateCaptionShown("list", true)).toBe(false);
    expect(teamGateCaptionShown("empty", false)).toBe(false);
  });
  test("the Team page counts the role in its loading state", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require("fs").readFileSync(require("path").join(__dirname, "../../../../../app/brand/[id]/team.tsx"), "utf8") as string;
    expect(source).toContain("loading: peopleLoading || roleLoading");
    expect(source).toContain("teamGateCaptionShown(listState, canInvite)");
    expect(source).toMatch(/const roleLoading = roleIsLoading \|\| !roleAuthReady;/);
  });
});
