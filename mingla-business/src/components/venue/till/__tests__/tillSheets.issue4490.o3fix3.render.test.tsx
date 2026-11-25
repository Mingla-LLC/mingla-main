/**
 * #4490 spec 08 O3 fix 3 — O3-S1 render proof: on the iPhone layout the real
 * TillScreen never asks one presenter to hold two native modals.
 *
 * Every kit Sheet is a React Native `Modal`. Under this lane's iOS platform the
 * suite opens the basket (bottom bar), taps Pay inside it, and then reads the
 * rendered tree: every visible `Modal` is grouped by its nearest visible
 * `Modal` ancestor (none = the screen presents it). Two in one group is what
 * UIKit refused on the simulator ("… which is already presenting …").
 * Fails on revert: with the pay sheet back as a sibling of the basket, the
 * screen group holds the basket AND the pay sheet.
 *
 * What this cannot prove: UIKit itself (react-native's jest Modal is a plain
 * component). The iPhone simulator re-check proves that.
 *
 * PaymentSheet and ReceiptStep are replaced by thin stand-ins that render the
 * same kit Sheet: their insides (Terminal, scan codes) have no jest side and
 * are not what is under test; where TillScreen places them is.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillSheets
 */

import React from "react";
import { Dimensions, Modal, Platform } from "react-native";

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

// ---- Data: a Till with one sellable item and no check yet. ------------------
const SALE = {
  id: "s1",
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
  lines: [],
  payments: [],
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
jest.mock("../../../../hooks/useVenueTill", () => {
  const mutation = (value: unknown) => ({ mutateAsync: jest.fn(async () => value), isPending: false });
  return {
    useTillCatalog: () => ({ data: CATALOG, isLoading: false, isError: false, refetch: jest.fn() }),
    useTillChecks: () => ({ data: { open: [], paid: [] }, isLoading: false }),
    useTillSale: (_v: string, saleId: string | null) => ({ data: saleId === null ? null : SALE }),
    useTillServers: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
    useTillActions: () => ({
      open: mutation(SALE),
      addMenu: mutation(SALE),
      addOffer: mutation(SALE),
      voidLine: mutation(SALE),
      send: mutation(SALE),
      pay: mutation({}),
      receipt: mutation({ sendsLeft: 2 }),
      refund: mutation(SALE),
      refundLine: mutation(SALE),
      relabel: mutation(SALE),
      setServer: mutation(SALE),
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
    startTillScan: jest.fn(),
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
jest.mock("../PaymentSheet", () => {
  const ReactLocal = jest.requireActual("react");
  const { Sheet } = jest.requireActual("../../../ui/Sheet");
  return {
    PaymentSheet: ({ visible, onClose }: { visible: boolean; onClose: () => void }) =>
      ReactLocal.createElement(Sheet, { visible, onClose, snapPoint: 0.9, testID: "till-pay-sheet" }, null),
  };
});

// eslint-disable-next-line import/first -- the mocks above must be registered first
import { TillScreen } from "../TillScreen";

const press = async (tree: RenderTree, testID: string): Promise<void> => {
  const target = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  expect({ testID, found: target !== undefined }).toEqual({ testID, found: true });
  await TestRenderer.act(async () => {
    (target.props.onPress as () => void)();
  });
};

/** Visible native modals, grouped by the visible Modal that presents each (null: the screen). */
const presenters = (tree: RenderTree): Map<string, string[]> => {
  const visible = tree.root.findAll((n) => n.type === Modal && n.props.visible === true);
  const label = (node: RenderTreeNode): string => {
    const tagged = node.findAll((n) => typeof n.props.testID === "string" && /sheet|till-/.test(n.props.testID as string))[0];
    return (tagged?.props.testID as string | undefined) ?? "modal";
  };
  const groups = new Map<string, string[]>();
  for (const modal of visible) {
    let up = modal.parent;
    while (up !== null && !(up.type === Modal && up.props.visible === true)) up = up.parent;
    const key = up === null ? "screen" : label(up);
    groups.set(key, [...(groups.get(key) ?? []), label(modal)]);
  }
  return groups;
};

const ownTestIds = (modals: string[]): string[] => modals.map((m) => m);

describe("O3-S1: the iPhone Till never presents two modals from one presenter", () => {
  beforeAll(() => {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 }, screen: { width: 375, height: 667, scale: 2, fontScale: 1 } });
  });

  test("this lane renders as iOS", () => {
    expect(Platform.OS).toBe("ios");
  });

  test("basket -> Pay: Pay presents from the basket; closing Pay leaves the basket and the check as they were", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<TillScreen venueId="v1" />);
    });
    const t = tree as unknown as RenderTree;
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    expect(Object.fromEntries(presenters(t))).toEqual({ screen: ["till-basket-sheet"] });

    await press(t, "till-pay");
    const groups = presenters(t);
    for (const [presenter, modals] of groups) {
      expect({ presenter, count: modals.length }).toEqual({ presenter, count: 1 });
    }
    expect(Object.fromEntries(groups)).toEqual({ screen: ["till-basket-sheet"], "till-basket-sheet": ["till-pay-sheet"] });

    // Close Pay without paying: the basket is still the one sheet, and the check is unchanged.
    const paySheet = t.root.findAll((n) => n.props.testID === "till-pay-sheet" && typeof n.props.onClose === "function")[0];
    await TestRenderer.act(async () => {
      (paySheet.props.onClose as () => void)();
    });
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(ownTestIds(presenters(t).get("screen") ?? [])).toEqual(["till-basket-sheet"]);
    expect(presenters(t).get("till-basket-sheet")).toBeUndefined();
    expect(t.root.findAll((n) => n.props.testID === "till-pay" && typeof n.props.onPress === "function").length).toBe(1);

    // Pay again works (no stuck state).
    await press(t, "till-pay");
    expect(Object.fromEntries(presenters(t))).toEqual({ screen: ["till-basket-sheet"], "till-basket-sheet": ["till-pay-sheet"] });
    t.unmount();
  });

  test("closing the basket with Pay up leaves nothing claimed open, and the bottom bar opens it again", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<TillScreen venueId="v1" />);
    });
    const t = tree as unknown as RenderTree;
    await press(t, "till-item-suya");
    await press(t, "till-bar-pay");
    await press(t, "till-pay");
    const basket = t.root.findAll((n) => n.props.testID === "till-basket-sheet" && typeof n.props.onClose === "function")[0];
    await TestRenderer.act(async () => {
      (basket.props.onClose as () => void)();
    });
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(presenters(t).size).toBe(0);
    await press(t, "till-bar-pay");
    // The basket alone: Pay's state was cleared with the basket, not left "open" behind it.
    expect(Object.fromEntries(presenters(t))).toEqual({ screen: ["till-basket-sheet"] });
    t.unmount();
  });
});
