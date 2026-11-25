/**
 * #4490 spec 08 O3 fix 4 — O3-S2 render proof: on Hermes (no `globalThis.crypto`)
 * every Till payment and refund still sends a `clientRequestId` that venue-till
 * accepts.
 *
 * venue-till refuses a non-UUID `clientRequestId` with 400 till_invalid_payload
 * for pay_cash, pay_own_machine, pay_code_create, pay_tap_start and both refund
 * forms (supabase/functions/venue-till/index.ts, `const UUID = …` and
 * `!UUID.test(requestId)`); the column is PostgreSQL uuid. `SERVER_UUID` below
 * is that exact pattern, copied.
 *
 * The suite removes `globalThis.crypto` (the Hermes condition: `randomId()`
 * then returns `<base36>-<base36>-<base36>`), renders the real TillScreen with
 * the real PaymentSheet, takes cash, the venue's own machine and Scan to pay,
 * refunds a payment and refunds a paid line, and reads the request each one
 * would send. Fails on revert: with PaymentSheet or TillScreen back on
 * `randomId()`, the captured id is not a UUID.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillRequestIds
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
const PAID_LINE_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
/** A check with a paid entry line and a paid cash payment (both refundable). */
const PAID_SALE = {
  ...BASE_SALE,
  state: "paid",
  paidMinor: 440000,
  remainingMinor: 0,
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
  payments: [
    {
      id: PAYMENT_ID,
      method: "cash",
      state: "paid",
      amountMinor: 440000,
      serviceChargeMinor: 0,
      tipMinor: 0,
      cashGivenMinor: 500000,
      changeMinor: 60000,
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
    },
  ],
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

const mockState: { sale: unknown } = { sale: BASE_SALE };
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
      pay: mutation(() => ({ sale: mockState.sale, paymentId: PAYMENT_ID, changeMinor: 0, replayed: false }), mockCalls.pay),
      receipt: mutation(() => ({ sendsLeft: 2 })),
      refund: mutation(() => mockState.sale, mockCalls.refund),
      refundLine: mutation(() => mockState.sale, mockCalls.refundLine),
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
      return { paymentId: PAYMENT_ID, method: "scan", amountMinor: 440000, tipMinor: 0, code: null, payUrl: null, expiresAt: null };
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
import { newTillRequestId } from "../tillPayModel";
// eslint-disable-next-line import/first
import { randomId } from "../../../../utils/randomId";

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
/** Open a check (item, then the basket's Pay) so the sale is the current one. */
const openPay = async (t: RenderTree): Promise<void> => {
  await press(t, "till-item-suya");
  await press(t, "till-bar-pay");
  await press(t, "till-pay");
};
const sentId = (spy: jest.Mock): string => {
  expect(spy).toHaveBeenCalledTimes(1);
  return (spy.mock.calls[0][0] as { clientRequestId: string }).clientRequestId;
};

const realCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

describe("O3-S2: with no globalThis.crypto (Hermes) every Till payment and refund id is a UUID venue-till accepts", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });
  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    mockState.sale = BASE_SALE;
    for (const spy of Object.values(mockCalls)) spy.mockClear();
  });
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("the condition is real: randomId() is not a UUID here, newTillRequestId() always is", () => {
    expect(SERVER_UUID.test(randomId())).toBe(false);
    for (let i = 0; i < 500; i += 1) expect(newTillRequestId()).toMatch(SERVER_UUID);
  });
});

describe.each([
  ["Cash (pay_cash)", "cash"],
  ["Card machine (pay_own_machine)", "own"],
] as const)("O3-S2 %s with no crypto", (_name, method) => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    mockState.sale = BASE_SALE;
    for (const spy of Object.values(mockCalls)) spy.mockClear();
  });
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("the request id sent is a UUID", async () => {
    const t = await mount();
    await openPay(t);
    if (method === "cash") {
      await press(t, "till-pay-cash");
      const given = t.root.findAll((n) => n.props.testID === "till-cash-given" && typeof n.props.onChangeMinor === "function")[0];
      expect(given).toBeDefined();
      await TestRenderer.act(async () => {
        (given.props.onChangeMinor as (v: number) => void)(500000);
      });
      await press(t, "till-cash-take");
    } else {
      await press(t, "till-pay-own");
      await press(t, "till-own-yes");
    }
    await settle();
    expect(sentId(mockCalls.pay)).toMatch(SERVER_UUID);
    await TestRenderer.act(async () => t.unmount());
  });
});

describe("O3-S2 the rest of the Till's client ids with no crypto", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    mockState.sale = BASE_SALE;
    for (const spy of Object.values(mockCalls)) spy.mockClear();
  });
  afterAll(() => {
    if (realCrypto !== undefined) Object.defineProperty(globalThis, "crypto", realCrypto);
  });

  test("Scan to pay (pay_code_create) carries a UUID", async () => {
    const t = await mount();
    await openPay(t);
    await press(t, "till-pay-scan");
    await settle();
    expect(sentId(mockCalls.startTillScan)).toMatch(SERVER_UUID);
    await TestRenderer.act(async () => t.unmount());
  });

  test("refund of a payment and refund of a paid line each carry a UUID", async () => {
    mockState.sale = PAID_SALE;
    const t = await mount();
    // Open the check through the basket so the paid sale is the current one.
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    await press(t, "till-send");
    await settle();

    // Payment refund: the paid list's Refund, then the sheet's own submit.
    const refundButton = t.root.findAll((n) => n.props.label === "Refund" && typeof n.props.onPress === "function")[0];
    expect(refundButton).toBeDefined();
    await TestRenderer.act(async () => {
      (refundButton.props.onPress as () => void)();
    });
    const refundSheet = t.root.findAll((n) => typeof n.props.onRefund === "function" && n.props.payment != null)[0];
    expect(refundSheet).toBeDefined();
    await TestRenderer.act(async () => {
      (refundSheet.props.onRefund as (a: number, r: string) => void)(100000, "Wrong item");
    });
    await settle();
    expect(sentId(mockCalls.refund)).toMatch(SERVER_UUID);

    // Line refund: tap the paid entry row, then the sheet's submit.
    await press(t, `till-row-line:${PAID_LINE_ID}`);
    const lineSheet = t.root.findAll((n) => typeof n.props.onRefund === "function" && n.props.row != null)[0];
    expect(lineSheet).toBeDefined();
    await TestRenderer.act(async () => {
      (lineSheet.props.onRefund as (r: string) => void)("Changed plans");
    });
    await settle();
    expect(sentId(mockCalls.refundLine)).toMatch(SERVER_UUID);
    await TestRenderer.act(async () => t.unmount());
  });
});
