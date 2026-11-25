/**
 * #4490 spec 08 O4 fix 1 (O4-T2) — render proof: on a check the table deposit
 * fully pays (nothing to take), the Till's primary button is "Close check"
 * and it closes the check through the server close (closeCovered, with the
 * check version) without opening the pay sheet or taking any payment. On a
 * check with money to pay the same button still opens the pay sheet.
 * Fails on revert: without the covered branch the button reads "Pay 0.00",
 * opens the pay sheet and never closes the check.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillCloseCheck
 */

import React from "react";
import { Dimensions } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  parent: RenderTreeNode | null;
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
/** 1 Suya 10,000.00 + 10% service charge, a 20,000.00 deposit: nothing to pay. */
const COVERED_SALE = {
  id: "11111111-1111-4111-8111-111111111111",
  venueId: "v1",
  state: "open",
  checkLabel: "Ada",
  spotId: null,
  spotLabel: null,
  serverUserId: "u1",
  currency: "NGN",
  subtotalMinor: 1000000,
  serviceChargeMinor: 100000,
  totalDueMinor: 0,
  paidMinor: 0,
  remainingMinor: 0,
  overpaidMinor: 0,
  settledOutside: null,
  version: 7,
  businessDate: null,
  pendingPayment: false,
  lines: [] as unknown[],
  payments: [] as unknown[],
  creditMinor: 2000000,
  creditUsedMinor: 1100000,
};
/** The same check with a 5,000.00 deposit: 6,000.00 still to pay. */
const DUE_SALE = { ...COVERED_SALE, totalDueMinor: 600000, remainingMinor: 600000, creditMinor: 500000, creditUsedMinor: 500000 };
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
  menus: [{ id: "m1", name: "Food", items: [{ id: "suya", name: "Suya", priceMinor: 1000000, orderable: true, station: "kitchen", modifierGroups: [] }] }],
  spots: [],
};

const mockState: { sale: unknown } = { sale: COVERED_SALE };
const mockCalls = {
  pay: jest.fn(),
  closeCovered: jest.fn(),
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
  return {
    useTillCatalog: () => ({ data: CATALOG, isLoading: false, isError: false, refetch: jest.fn() }),
    useTillChecks: () => ({ data: { open: [], paid: [] }, isLoading: false }),
    useTillSale: (_v: string, saleId: string | null) => ({ data: saleId === null ? null : mockState.sale }),
    useTillServers: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
    useTillActions: () => ({
      open: mutation(() => mockState.sale),
      addMenu: mutation(() => mockState.sale),
      addOffer: mutation(() => mockState.sale),
      voidLine: mutation(() => mockState.sale),
      send: mutation(() => mockState.sale),
      pay: mutation(() => ({ sale: mockState.sale, paymentId: "p", changeMinor: 0, replayed: false }), mockCalls.pay),
      closeCovered: mutation(() => ({ ...(mockState.sale as object), state: "paid" }), mockCalls.closeCovered),
      receipt: mutation(() => ({ sendsLeft: 2 })),
      refund: mutation(() => mockState.sale),
      refundLine: mutation(() => mockState.sale),
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
    freeAt: string | null = null;
    nextAt: string | null = null;
    unitName: string | null = null;
  }
  return {
    TillError,
    cancelTillPayCode: jest.fn(),
    fetchTillPayCode: jest.fn(),
    keepTillLatePayment: jest.fn(),
    startTillScan: jest.fn(async (input: unknown) => {
      mockCalls.startTillScan(input);
      return { paymentId: "p", method: "scan", amountMinor: 0, tipMinor: 0, code: null, payUrl: null, expiresAt: null };
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
// The card panels' insides (Terminal, QR) are not under test; the id the sheet sends is.
jest.mock("../TillTapPanel", () => ({ TillTapPanel: () => null }));
jest.mock("../TillScanPanel", () => ({ TillScanPanel: () => null }));

// eslint-disable-next-line import/first -- the mocks above must be registered first
import { TillScreen } from "../TillScreen";
// eslint-disable-next-line import/first
import { PaymentSheet } from "../PaymentSheet";

const find = (tree: RenderTree, testID: string): RenderTreeNode => {
  const target = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  expect({ testID, found: target !== undefined }).toEqual({ testID, found: true });
  return target;
};
const press = async (tree: RenderTree, testID: string): Promise<void> => {
  const target = find(tree, testID);
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
const payLabel = (tree: RenderTree): unknown =>
  tree.root.findAll((n) => n.props.testID === "till-pay" && typeof n.props.label === "string")[0]?.props.label;
const paySheetOpen = (tree: RenderTree): boolean =>
  tree.root.findAll((n) => n.type === PaymentSheet).some((n) => n.props.visible === true);

describe("O4-T2: a check the deposit fully pays is closed, not paid", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });
  beforeEach(() => {
    for (const spy of Object.values(mockCalls)) spy.mockClear();
  });

  test("the primary button reads Close check and closes through the server with the check version; no pay sheet, no payment", async () => {
    mockState.sale = COVERED_SALE;
    const t = await mount();
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    await press(t, "till-send");
    await settle();
    expect(payLabel(t)).toBe("Close check");
    await press(t, "till-pay");
    await settle();
    expect(mockCalls.closeCovered).toHaveBeenCalledTimes(1);
    expect(mockCalls.closeCovered.mock.calls[0][0]).toEqual({ saleId: COVERED_SALE.id, expectedVersion: 7 });
    expect(mockCalls.pay).not.toHaveBeenCalled();
    expect(paySheetOpen(t)).toBe(false);
    t.unmount();
  });

  test("with money still to pay the same button opens the pay sheet and never closes the check", async () => {
    mockState.sale = DUE_SALE;
    const t = await mount();
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    await press(t, "till-send");
    await settle();
    expect(payLabel(t)).toBe("Pay ₦6,000.00");
    await press(t, "till-pay");
    await settle();
    expect(mockCalls.closeCovered).not.toHaveBeenCalled();
    expect(paySheetOpen(t)).toBe(true);
    t.unmount();
  });
});
