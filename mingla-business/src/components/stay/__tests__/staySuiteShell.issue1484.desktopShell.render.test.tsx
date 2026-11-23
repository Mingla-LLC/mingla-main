/**
 * Issue #1484 [stay-desktop-shell] — implementor-owned happy-path RENDER
 * regression proof.
 *
 * WHAT IT PROVES (by MOUNTING the real shells and reading the REAL rendered
 * tree + the REAL flattened styles — not source text):
 *
 *  T-1  DESKTOP (>=1024px web): `StaySuiteShell` renders the shared
 *       `SuiteDesktopShell` — host `stay-suite-shell-desktop`, a `tablist` rail
 *       with all six `stay-rail-<module>` rows — and the horizontal
 *       `stay-module-<module>` pill row does NOT render.
 *  T-2  The resolved `desktopCentered` style has NO `maxWidth` (the ORCH-1184
 *       full-width decision), KEEPS `alignSelf: "flex-start"` + numeric
 *       `paddingHorizontal`, and is the two-column `row` at `width: "100%"`
 *       with the 220px rail.
 *  T-3  PER-MODULE DESKTOP WIDTHS: Overview runs uncapped + left-anchored;
 *       Settings (an editable form) keeps the `suiteFormMaxWidth` readable
 *       measure, also left-anchored.
 *  T-4  NATIVE / PHONE PARITY (<1024px): the pill row still renders, the rail
 *       and the desktop host do NOT, and the Overview page keeps today's exact
 *       centred `stayPageMaxWidth` measure.
 *  T-5  VENUE NON-REGRESSION: `VenueSuiteShell` still renders
 *       `venue-suite-shell-desktop` with its `venue-rail-<module>` rows in the
 *       existing order and the identical uncapped `desktopCentered` style,
 *       after the layout was extracted into the shared shell.
 *
 * FAILS-ON-REVERT: deleting the `if (isWideDesktop) { return <SuiteDesktopShell
 * …> }` branch from `StaySuiteShell.tsx` makes the desktop render fall back to
 * the pill row → T-1 fails on BOTH the missing `stay-suite-shell-desktop` host
 * and the pill row that should not exist. Verified by TRUE LINE DELETION of the
 * fix (not a comment-out).
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * RENDERER: `react-test-renderer` via the repo's `require(...) as {…}` idiom
 * (the ListingInsightsScreen.issue1403 render suites use the same form). This
 * is deliberate and load-bearing for the issue-1403 typecheck-delta gate: a
 * bare `import` of an untyped/absent renderer adds a TS7016/TS2307 diagnostic
 * under a clean `npm ci`, and that gate fails on ANY added diagnostic.
 * `@testing-library/react-native` in particular is NOT in package.json, so it
 * is absent in every job that does not `npm install --no-save` it.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1484.render.cjs --runInBand
 */

import React from "react";
import { StyleSheet, Text } from "react-native";

interface RenderNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
  findAllByType: (component: unknown) => RenderNode[];
}
interface RenderTree {
  root: RenderNode;
  unmount: () => void;
  // [TEST-MOD-APPROVED #4490] fix round 5: typed, as T-1g and T-1n re-render.
  update: (element: React.ReactElement) => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

/** Mount inside `act` so mount-time effects/state flush before we assert. */
async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  expect(tree).not.toBeNull();
  return tree as unknown as RenderTree;
}

// ---------------------------------------------------------------------------
// Desktop gate — flipped per test. Read at RENDER time, so the `let` is already
// initialised by the time any mocked hook call actually reads it.
// ---------------------------------------------------------------------------
let mockIsWideDesktop = true;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: true,
    width: mockIsWideDesktop ? 1440 : 390,
  }),
}));

// ---- Boundary stubs (native-only deps that have no jest side). -------------
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
      // #1532 — TWO ADDED ENTRIES. `Sheet` -> `SheetMobile:207` reads
      // `Easing.in(Easing.cubic)` at MODULE SCOPE for its close timing, and
      // this mock had neither, so the suite failed to LOAD once the Stay
      // editor moved into the Sheet. Everything above is the pre-#1532 mock,
      // unchanged and in its original order.
      in: (fn: unknown) => fn,
      cubic: () => 0,
    },
    // #1532 — ONE ADDED SIBLING of `Easing` (NOT a member of it):
    // `SheetMobile:306` and `Modal:155` both cancel their animations on
    // unmount, and this mock had no `cancelAnimation`, so mounting the editor
    // sheet threw during commit.
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
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return {
    __esModule: true,
    ScrollView: RN.ScrollView,
    default: RN.ScrollView,
  };
});
// [TEST-MOD-APPROVED #3655] VenueSuiteShell leave beforeRemove needs useNavigation.
// [TEST-MOD-APPROVED #4490] spec 08 O1: the shells open the Till route with
// the imperative router; the suite records those calls.
const mockAppRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => ({
  get router() {
    return mockAppRouter;
  },
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({
    addListener: () => () => undefined,
    dispatch: jest.fn(),
  }),
}));
// [TEST-MOD-APPROVED #4490] spec 08 O1: the Till's release switch.
let mockTillReleased = false;
jest.mock("../../../hooks/useTillReleased", () => ({
  useTillReleased: () => mockTillReleased,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ---- Stay data hooks — a READY snapshot so Overview renders its full body. --
const STAY_SNAPSHOT = {
  settings: {
    property_kind: "hotel",
    summary: "A characterful city hotel with a rooftop bar and garden rooms.",
    timezone: "Africa/Lagos",
    check_in_time: "15:00:00",
    check_out_time: "11:00:00",
    default_booking_mode: "request",
    amenities: ["Pool"],
    accessibility_features: ["Lift"],
    arrival_instructions: "Front desk",
    house_rules: "No smoking",
    booking_state: "review",
    version: 3,
  },
  offerings: [],
};
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: { all: ["stay-inventory"] },
  useStayInventory: () => ({
    data: STAY_SNAPSHOT,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  usePublishStay: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSaveStaySettings: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useBrandDiscoveryCurrency", () => ({
  useBrandDiscoveryCurrency: () => ({
    data: {
      authority: "settlement",
      canAcceptPaidReservations: true,
      currencyCode: "NGN",
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

// ---- Venue data hooks + store (T-5). ---------------------------------------
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({
    data: { reservationsEnabled: true },
    isLoading: false,
  }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
// [TEST-MOD-APPROVED #4490] the store mock now also carries setRequestLeave so the
// shell's page-exit gate can be captured and driven by the leave tests below.
type MockRequestLeave =
  | ((proceed: () => void, restoreFocus?: () => void) => void)
  | null;
let mockRequestLeave: MockRequestLeave = null;
// [TEST-MOD-APPROVED #4490] fix round 5: the Table reservations times view
// reports unsaved hours / table rules through the store's dirtyModules.
let mockDirtyModules = new Set<string>();
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sync: () => undefined,
      setRequestLeave: (fn: MockRequestLeave) => {
        mockRequestLeave = fn;
      },
      dirtyModules: mockDirtyModules,
    }),
}));

// ---- Workspace module bodies — stubbed; this suite asserts on the SHELL. ----
const stub = (id: string): (() => React.ReactElement) => {
  const Stub = (): React.ReactElement => (
    <Text testID={`stub-${id}`}>{id}</Text>
  );
  Stub.displayName = `Stub_${id}`;
  return Stub;
};
let mockOffersDirty = false;
// [TEST-MOD-APPROVED #4490] fix round 5: Offers' props are captured so its
// "open reservations" link can be driven (cross-link mapping, spec 07 13).
let mockOffersProps: Record<string, unknown> | null = null;
// [TEST-MOD-APPROVED #4490] J fix 2 (R4J-N4): count Offers mounts so a resize
// across the desktop breakpoint can prove the open module is NOT remounted.
let mockOffersMounts = 0;
jest.mock("../../venue/features/offers/VenueOffersModule", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  const VenueOffersModule = ReactLocal.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockOffersProps = props;
      ReactLocal.useEffect(() => {
        mockOffersMounts += 1;
      }, []);
      ReactLocal.useImperativeHandle(ref, () => ({
        isDirty: () => mockOffersDirty,
        changedLabels: () => ["Offer details"],
        isValid: () => true,
        save: async () => undefined,
        discard: () => {
          mockOffersDirty = false;
        },
      }));
      return ReactLocal.createElement(
        RN.Text,
        { testID: "stub-offers" },
        "offers",
      );
    },
  );
  return { VenueOffersModule };
});
// [TEST-MOD-APPROVED #4490] R4J fix 3: stub the lazily imported Requests
// module so T-1h can prove a cold `?module=requests` deep link renders it.
let mockRequestsProps: Record<string, unknown> | null = null;
jest.mock("../../venue/features/requests/VenueRequestsModule", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    VenueRequestsModule: (props: Record<string, unknown>) => {
      mockRequestsProps = props;
      return ReactLocal.createElement(RN.Text, { testID: "stub-requests" }, "requests");
    },
  };
});
jest.mock("../../ui/ConfirmDialog", () => {
  const ReactLocal = jest.requireActual("react");
  return {
    ConfirmDialog: (props: Record<string, unknown>) =>
      ReactLocal.createElement("ConfirmDialog", props),
  };
});
jest.mock("../StayInventoryManager", () => ({
  StayInventoryManager: stub("inventory"),
}));
jest.mock("../StayReservationsModule", () => ({
  StayReservationsModule: stub("reservations"),
}));
jest.mock("../StayStaffAvailabilityModule", () => ({
  StayStaffAvailabilityModule: stub("staff-availability"),
}));
jest.mock("../../venue/VenueMenuModule", () => ({
  VenueMenuModule: stub("menu"),
}));
jest.mock("../../venue/VenueIntelligenceModule", () => ({
  VenueIntelligenceModule: stub("intelligence"),
}));
jest.mock("../../venue/VenueSettingsModule", () => ({
  VenueSettingsModule: stub("venue-settings"),
}));
jest.mock("../../venue/VenueTablesModule", () => ({
  VenueTablesModule: stub("tables"),
}));
jest.mock("../../venue/VenueAvailabilityModule", () => ({
  VenueAvailabilityModule: stub("availability"),
}));
// [TEST-MOD-APPROVED #4490] fix round 5: the venue Reservations stub records its
// props (onEditFloor) and the Availability & pricing stub (Table times and
// rules on a Stay) exposes a leave handle whose requestLeave is observable.
let mockVenueReservationsProps: Record<string, unknown> | null = null;
jest.mock("../../venue/VenueReservationsModule", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    VenueReservationsModule: (props: Record<string, unknown>) => {
      mockVenueReservationsProps = props;
      return ReactLocal.createElement(
        RN.Text,
        { testID: "stub-venue-reservations" },
        "venue-reservations",
      );
    },
  };
});
let mockTableTimesHold = false;
const mockTableTimesRequestLeave = jest.fn();
let mockTableTimesProps: Record<string, unknown> | null = null;
jest.mock("../../venue/features/VenueAvailabilityPricingModule", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  const VenueAvailabilityPricingModule = ReactLocal.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockTableTimesProps = props;
      ReactLocal.useImperativeHandle(ref, () => ({
        requestLeave: (proceed: () => void, restoreFocus?: () => void) => {
          mockTableTimesRequestLeave(proceed, restoreFocus);
          if (!mockTableTimesHold) proceed();
        },
      }));
      return ReactLocal.createElement(
        RN.Text,
        { testID: "stub-table-times" },
        "table-times",
      );
    },
  );
  return { VenueAvailabilityPricingModule };
});
// [TEST-MOD-APPROVED #4490] fix round 6 (R4J-N25): the Waitlist stub records
// its props so the Stay's "seated" label can be proven.
let mockWaitlistProps: Record<string, unknown> | null = null;
jest.mock("../../venue/VenueWaitlistModule", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    VenueWaitlistModule: (props: Record<string, unknown>) => {
      mockWaitlistProps = props;
      return ReactLocal.createElement(RN.Text, { testID: "stub-waitlist" }, "waitlist");
    },
  };
});
// [TEST-MOD-APPROVED #4490] fix round 6 (R4J-N22): Today and Check-in are
// stubbed so door-only staff can land on them (the real Today pulls auth).
jest.mock("../../venue/features/today/VenueTodayModule", () => ({
  VenueTodayModule: stub("today"),
}));
jest.mock("../../venue/features/checkin/VenueCheckInModule", () => ({
  VenueCheckInModule: stub("checkin"),
}));
// [TEST-MOD-APPROVED #4490] fix round 6 (R4J-N23): Spaces is stubbed so
// "Open tables" can be proven to land on Spaces › Tables.
let mockSpacesProps: Record<string, unknown> | null = null;
jest.mock("../../venue/features/VenueSpacesModule", () => {
  const ReactLocal = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  const VenueSpacesModule = ReactLocal.forwardRef(
    (props: Record<string, unknown>, _ref: React.Ref<unknown>) => {
      mockSpacesProps = props;
      return ReactLocal.createElement(RN.Text, { testID: "stub-spaces" }, "spaces");
    },
  );
  return { VenueSpacesModule };
});
jest.mock("../../venue/features/VenueTypeAndFeaturesPanel", () => ({
  VenueTypeAndFeaturesPanel: stub("venue-type-and-features"),
}));
// [TEST-MOD-APPROVED #3645] settled accepted — shell layout subject stays shell geometry.
jest.mock("../../../hooks/useOrganiserTermsPublishGate", () => ({
  useOrganiserTermsPublishGate: () => ({
    blockPaidPublishUntilAccepted: () => false,
    gateElement: null,
  }),
  ORGANISER_TERMS_PUBLISH_RETRY_TOAST:
    "Accept the Organiser Terms, then tap Publish again.",
}));
// [TEST-MOD-APPROVED #4490] fix round 5: access is switchable so the
// capability-scoped Table reservations / Waitlist rules can be proven.
let mockVenueAccess: { scoped: boolean; capabilities: string[]; canSell?: boolean } = {
  scoped: false,
  capabilities: [],
};
jest.mock("../../../hooks/useMyVenueAccess", () => ({
  useMyVenueAccess: () => ({
    data: mockVenueAccess,
    isLoading: false,
    isFetched: true,
    isError: false,
  }),
}));
let mockStayFeaturesState: unknown = undefined;
jest.mock("../../../hooks/useVenueFeatures", () => ({
  useVenueFeatures: (_brandId: string | null, venueId: string | null) => ({
    data: venueId === "venue-1484" ? mockStayFeaturesState : undefined,
    isLoading: false,
    isFetched: true,
    isError: false,
    refetch: jest.fn(),
  }),
  useSetVenueFeature: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../services/venueFeaturesService", () => ({
  VenueFeatureError: class VenueFeatureError extends Error {
    code = "test";
    detail = null;
  },
}));

import {
  stayPageMaxWidth,
  suiteFormMaxWidth,
  venueRailWidth,
  space,
} from "../../../constants/designSystem";
import {
  STAY_FEATURE_MODULE_ORDER,
  StaySuiteShell,
  stayTargetForVenueModule,
} from "../StaySuiteShell";
import { STAY_PAGE_BOTTOM_PAD } from "../stayLayoutContracts";
import { VenueSuiteShell } from "../../venue/VenueSuiteShell";
import { featureSetFrom } from "../../../types/venueFeatures";
import { unsavedWork } from "../../../hooks/useUnsavedChangesGuard";

/** Same question the brand switcher asks: does any flusher refuse to leave? */
async function unsavedWorkHoldsSwitch(): Promise<boolean> {
  for (const flush of [...(unsavedWork.flushers ?? [])]) {
    if (!(await flush())) return true;
  }
  return false;
}

type Flat = Record<string, unknown>;

/**
 * Minimal shape of a react-test-renderer instance. `@types/react-test-renderer`
 * is not installed (the renderer is a --no-save test-only dep), so annotate the
 * traversal callbacks explicitly rather than inherit `any`.
 */
interface RenderNode {
  type: unknown;
  props: Record<string, unknown>;
  findAllByType: (component: unknown) => RenderNode[];
}

const nodes = (tree: RenderTree): RenderNode[] => tree.root.findAll(() => true);

/** First HOST node carrying `testID` (mirrors RTL's host-only getByTestId). */
function hostWithTestId(tree: RenderTree, testID: string): RenderNode {
  const node = nodes(tree).find(
    (candidate) =>
      typeof candidate.type === "string" && candidate.props?.testID === testID,
  );
  expect(node).toBeDefined();
  return node as RenderNode;
}

/** First node carrying `testID` AND a real `onPress` (the Pressable/Button). */
function pressableWithTestId(tree: RenderTree, testID: string): RenderNode {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onPress === "function",
  );
  expect(node).toBeDefined();
  return node as RenderNode;
}

async function press(node: RenderNode): Promise<void> {
  await TestRenderer.act(() => {
    (node.props.onPress as () => void)();
  });
}

/** Distinct testIDs in the tree matching `pattern` (deduped, render order). */
function testIdsMatching(tree: RenderTree, pattern: RegExp): string[] {
  const seen = new Set<string>();
  for (const node of nodes(tree)) {
    const id = node.props?.testID;
    if (typeof id === "string" && pattern.test(id)) seen.add(id);
  }
  return [...seen];
}

function hasText(tree: RenderTree, value: string): boolean {
  return nodes(tree).some((node) => {
    const kids = node.props?.children;
    return kids === value || (Array.isArray(kids) && kids.join("") === value);
  });
}

/**
 * The RAW `contentContainerStyle` prop of the module's page ScrollView, before
 * flattening. Needed because the FLATTENED form cannot tell a released cap from
 * a silently retained one (see `expectUncapped`).
 */
function pageStyleProp(tree: RenderTree): unknown {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.contentContainerStyle !== undefined &&
      typeof candidate.type !== "string" &&
      (
        StyleSheet.flatten(candidate.props.contentContainerStyle as never) as
          Flat | undefined
      )?.paddingBottom !== undefined &&
      (
        StyleSheet.flatten(candidate.props.contentContainerStyle as never) as
          Flat | undefined
      )?.alignSelf !== undefined,
  );
  return node?.props.contentContainerStyle;
}

/**
 * ASSERT "this page runs UNCAPPED on desktop" — falsifiably.
 *
 * WHY NOT `expect(flat.maxWidth).toBeUndefined()`: that predicate is TRUE both
 * when the cap was released AND when it was silently retained, so it is
 * unfalsifiable. Proven under this exact RN resolver:
 *
 *   flatten([{maxWidth:820,…}, {maxWidth:undefined,…}])
 *     -> {"width":"100%","alignSelf":"flex-start"}  hasOwnProperty("maxWidth") = TRUE
 *   flatten({width:"100%",alignSelf:"flex-start"})
 *     -> {"width":"100%","alignSelf":"flex-start"}  hasOwnProperty("maxWidth") = FALSE
 *
 * JSON-identical; only the KEY's presence separates them. And the key's
 * presence is exactly what react-native-web keys off — with the override shape
 * the base's atomic `r-maxWidth-*` class survives into the DOM and the cap
 * still applies, which is how the desktop uncap shipped broken (#1484 P1-1).
 *
 * So we assert BOTH: (a) exactly ONE complete style object was SELECTED (not an
 * override array), and (b) the resolved style carries NO `maxWidth` KEY at all.
 */
function expectUncapped(styleProp: unknown): void {
  expect(Array.isArray(styleProp)).toBe(false);
  const flat = (StyleSheet.flatten(styleProp as never) ?? {}) as Flat;
  expect(Object.prototype.hasOwnProperty.call(flat, "maxWidth")).toBe(false);
  expect(flat.alignSelf).toBe("flex-start");
}

/** ASSERT "this page keeps `expected` as a real, applied cap". */
function expectCappedAt(styleProp: unknown, expected: number): void {
  expect(Array.isArray(styleProp)).toBe(false);
  const flat = (StyleSheet.flatten(styleProp as never) ?? {}) as Flat;
  expect(flat.maxWidth).toBe(expected);
  expect(flat.alignSelf).toBe("flex-start");
}

/**
 * The REAL flattened `contentContainerStyle` of the module's page ScrollView —
 * identified by the page padding every Stay module page style carries.
 */
function pageMeasure(tree: RenderTree): Flat | undefined {
  return nodes(tree)
    .filter(
      (node) =>
        node.props?.contentContainerStyle !== undefined &&
        typeof node.type !== "string",
    )
    .map(
      (node): Flat =>
        (StyleSheet.flatten(node.props.contentContainerStyle as never) ??
          {}) as Flat,
    )
    .find(
      (flat: Flat) =>
        flat.paddingBottom !== undefined && flat.alignSelf !== undefined,
    );
}

const STAY_PROPS = {
  brandId: "brand-1484",
  venueId: "venue-1484",
  venueName: "Test Hotel",
  venueApproved: true,
};

const STAY_MODULE_IDS = [
  "overview",
  "rooms_places",
  "availability_pricing",
  "reservations",
  "settings",
] as const;

/** Resolve the two-column block's REAL flattened style from a desktop host. */
function centeredStyle(tree: RenderTree, hostTestId: string): Flat {
  const host = hostWithTestId(tree, hostTestId);
  const centered = host.props.children as React.ReactElement<{
    style?: unknown;
  }>;
  return (StyleSheet.flatten(centered.props.style) ?? {}) as Flat;
}

/** Rail row labels in render order, deduped by testID prefix. */
function railLabels(tree: RenderTree, prefix: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  nodes(tree)
    .filter(
      (node) =>
        typeof node.props?.testID === "string" &&
        (node.props.testID as string).startsWith(prefix) &&
        node.props.accessibilityRole === "tab",
    )
    .forEach((node) => {
      const id = node.props.testID as string;
      if (seen.has(id)) return;
      seen.add(id);
      const text = node.findAllByType(Text)[0];
      const kids = text?.props.children;
      labels.push(Array.isArray(kids) ? kids.join("") : String(kids ?? ""));
    });
  return labels;
}

beforeEach(() => {
  mockIsWideDesktop = true;
  mockStayFeaturesState = undefined;
  mockOffersDirty = false;
  mockOffersMounts = 0;
  mockRequestLeave = null;
  mockDirtyModules = new Set<string>();
  mockOffersProps = null;
  mockVenueReservationsProps = null;
  mockTableTimesHold = false;
  mockTableTimesRequestLeave.mockClear();
  mockTableTimesProps = null;
  mockVenueAccess = { scoped: false, capabilities: [] };
  mockWaitlistProps = null;
  mockSpacesProps = null;
});

describe("#1484 — Stay suite adopts the shared desktop shell", () => {
  it("T-1 — at >=1024px the rail renders and the pill row does NOT", async () => {
    mockIsWideDesktop = true;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    // The shared desktop shell is mounted.
    expect(hostWithTestId(r, "stay-suite-shell-desktop")).toBeTruthy();

    // Every module is a rail row, in the declared order.
    expect(railLabels(r, "stay-rail-")).toEqual([
      "Overview",
      "Rooms & Places",
      "Availability & pricing",
      "Reservations",
      "Settings",
    ]);
    expect(testIdsMatching(r, /^stay-(?:rail|module)-menu$/)).toHaveLength(0);
    for (const id of STAY_MODULE_IDS) {
      expect(hostWithTestId(r, `stay-rail-${id}`)).toBeTruthy();
    }

    // The horizontal pill row is GONE at this width — the rail replaces it.
    for (const id of STAY_MODULE_IDS) {
      expect(
        testIdsMatching(r, new RegExp(`^stay-module-${id}$`)),
      ).toHaveLength(0);
    }
    expect(testIdsMatching(r, /^stay-module-/)).toHaveLength(0);
  });

  it("T-1b — a Stay appends enabled feature modules after its five own pages", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      // [TEST-MOD-APPROVED #4490] fix round 5 (spec 07 13): every feature
      // destination on, so all twelve show in the decided order.
      features: featureSetFrom({
        entry: true,
        private_hire: true,
        memberships: true,
        menu: true,
        guest_list: true,
        table_reservations: true,
        waitlist: true,
      }),
      flags: { reads: true, writes: true },
    };
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    expect(railLabels(r, "stay-rail-")).toEqual([
      "Overview",
      "Rooms & Places",
      "Availability & pricing",
      "Reservations",
      "Settings",
      "Offers",
      "Spaces",
      "Today",
      "Calendar",
      "Requests",
      "Table reservations",
      "Waitlist",
      "Members",
      "Check-in",
      "Menu",
      "Orders",
      "Guest list",
    ]);
  });

  it("T-1c — an unsaved feature edit is held before switching Stay modules", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      features: featureSetFrom({ entry: true }),
      flags: { reads: true, writes: true },
    };
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(r, "stay-rail-offers"));
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();

    mockOffersDirty = true;
    await press(pressableWithTestId(r, "stay-rail-settings"));

    expect(hostWithTestId(r, "stay-suite-leave-dialog")).toBeTruthy();
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();
  });

  it("T-1d — D3: a page exit with an unsaved feature edit opens the leave dialog", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      features: featureSetFrom({ entry: true }),
      flags: { reads: true, writes: true },
    };
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(r, "stay-rail-offers"));
    expect(mockRequestLeave).not.toBeNull();

    // Clean: proceeds at once.
    const cleanProceed = jest.fn();
    await TestRenderer.act(() => {
      (mockRequestLeave as NonNullable<MockRequestLeave>)(cleanProceed);
    });
    expect(cleanProceed).toHaveBeenCalledTimes(1);

    // Dirty: held, dialog open; Keep editing restores focus and does not proceed.
    mockOffersDirty = true;
    const proceed = jest.fn();
    const restoreFocus = jest.fn();
    await TestRenderer.act(() => {
      (mockRequestLeave as NonNullable<MockRequestLeave>)(proceed, restoreFocus);
    });
    expect(proceed).not.toHaveBeenCalled();
    const dialog = hostWithTestId(r, "stay-suite-leave-dialog");
    await TestRenderer.act(() => {
      (dialog.props.onClose as () => void)();
    });
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();

    // Discard runs proceed.
    await TestRenderer.act(() => {
      (mockRequestLeave as NonNullable<MockRequestLeave>)(proceed);
    });
    await TestRenderer.act(() => {
      (hostWithTestId(r, "stay-suite-leave-dialog").props.onDiscard as () => void)();
    });
    expect(proceed).toHaveBeenCalledTimes(1);

    // Unmount clears the gate so a later non-Stay venue is not left with it.
    await TestRenderer.act(() => {
      r.unmount();
    });
    expect(mockRequestLeave).toBeNull();
  });

  it("T-1e — D3: a dirty feature edit cancels beforeunload and holds a brand switch", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      features: featureSetFrom({ entry: true }),
      flags: { reads: true, writes: true },
    };
    const g = globalThis as unknown as Record<string, unknown>;
    const listeners: Record<string, (event: unknown) => void> = {};
    const prevAdd = g.addEventListener;
    const prevRemove = g.removeEventListener;
    g.addEventListener = (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    };
    g.removeEventListener = (type: string) => {
      delete listeners[type];
    };
    try {
      const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
      await press(pressableWithTestId(r, "stay-rail-offers"));
      expect(typeof listeners.beforeunload).toBe("function");

      const clean = { preventDefault: jest.fn(), returnValue: "" };
      listeners.beforeunload(clean);
      expect(clean.preventDefault).not.toHaveBeenCalled();
      expect(await unsavedWorkHoldsSwitch()).toBe(false);

      mockOffersDirty = true;
      const dirty = { preventDefault: jest.fn(), returnValue: "" };
      listeners.beforeunload(dirty);
      expect(dirty.preventDefault).toHaveBeenCalledTimes(1);
      expect(await unsavedWorkHoldsSwitch()).toBe(true);
      mockOffersDirty = false;
    } finally {
      g.addEventListener = prevAdd;
      g.removeEventListener = prevRemove;
    }
  });

  it("T-1f — D2: a refused deep link tells the route once; a matching one does not", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      features: featureSetFrom({ entry: true }),
      flags: { reads: true, writes: true },
    };
    const refused = jest.fn();
    await mount(
      <StaySuiteShell
        {...STAY_PROPS}
        requestedModule="bogus"
        onModuleChange={refused}
      />,
    );
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledWith("overview");

    const matching = jest.fn();
    await mount(
      <StaySuiteShell
        {...STAY_PROPS}
        initialModule="settings"
        requestedModule="settings"
        onModuleChange={matching}
      />,
    );
    expect(matching).not.toHaveBeenCalled();
  });

  it("T-1f2 — R4J-N8: Stay-only deep links open their workspace and leave the address alone", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      features: featureSetFrom({ entry: true }),
      flags: { reads: true, writes: true },
    };
    for (const key of ["rooms_places", "availability_pricing"]) {
      const told = jest.fn();
      // The route's venue-module parser hands the shell "overview" for these.
      const r = await mount(
        <StaySuiteShell
          {...STAY_PROPS}
          initialModule="overview"
          requestedModule={key}
          onModuleChange={told}
        />,
      );
      expect(hostWithTestId(r, "stub-inventory")).toBeTruthy();
      expect(told).not.toHaveBeenCalled();
    }
    const alias = jest.fn();
    const a = await mount(
      <StaySuiteShell
        {...STAY_PROPS}
        initialModule="overview"
        requestedModule="availability"
        onModuleChange={alias}
      />,
    );
    expect(hostWithTestId(a, "stub-inventory")).toBeTruthy();
    // The alias is normalised once, so the address carries the real key.
    expect(alias).toHaveBeenCalledTimes(1);
    expect(alias).toHaveBeenCalledWith("availability_pricing");

    const bogus = jest.fn();
    const b = await mount(
      <StaySuiteShell
        {...STAY_PROPS}
        initialModule="overview"
        requestedModule="bogus"
        onModuleChange={bogus}
      />,
    );
    expect(testIdsMatching(b, /^stub-inventory$/)).toHaveLength(0);
    expect(bogus).toHaveBeenCalledTimes(1);
    expect(bogus).toHaveBeenCalledWith("overview");
  });

  it("T-1h — R4J retest: a cold `?module=requests` deep link with Private hire on renders Requests", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 0,
      features: featureSetFrom({ private_hire: true }),
      flags: { reads: true, writes: true },
    };
    for (const wide of [true, false]) {
      mockIsWideDesktop = wide;
      mockRequestsProps = null;
      const told = jest.fn();
      const r = await mount(
        <StaySuiteShell
          {...STAY_PROPS}
          initialModule="requests"
          requestedModule="requests"
          onModuleChange={told}
        />,
      );
      expect(hostWithTestId(r, "stub-requests")).toBeTruthy();
      expect(mockRequestsProps).toMatchObject({ venueId: "venue-1484", initialGroupId: null });
      expect(told).not.toHaveBeenCalled();
    }
    mockIsWideDesktop = true;
  });

  it("T-1g — R4J-N4: crossing the breakpoint keeps the open module and its open leave dialog", async () => {
    mockStayFeaturesState = {
      venueId: "venue-1484",
      brandId: "brand-1484",
      venueCategory: "stay",
      version: 1,
      activeSpaceCount: 1,
      features: featureSetFrom({ entry: true }),
      flags: { reads: true, writes: true },
    };
    mockIsWideDesktop = true;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(r, "stay-rail-offers"));
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();
    expect(mockOffersMounts).toBe(1);

    // An unsaved edit, then a module switch: the leave dialog holds it.
    mockOffersDirty = true;
    await press(pressableWithTestId(r, "stay-rail-overview"));
    expect(hostWithTestId(r, "stay-suite-leave-dialog")).toBeTruthy();

    // Desktop -> phone while the dialog is open: chrome swaps, module stays.
    mockIsWideDesktop = false;
    await TestRenderer.act(async () => {
      r.update(<StaySuiteShell {...STAY_PROPS} />);
    });
    expect(testIdsMatching(r, /^stay-rail-/)).toHaveLength(0);
    expect(hostWithTestId(r, "stay-module-offers")).toBeTruthy();
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();
    expect(mockOffersMounts).toBe(1);
    const dialog = hostWithTestId(r, "stay-suite-leave-dialog");
    expect(dialog.props.description).toContain("Offer details");

    // Keep editing: still the same Offers instance with its draft.
    await TestRenderer.act(() => {
      (dialog.props.onClose as () => void)();
    });
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();
    expect(mockOffersMounts).toBe(1);

    // Phone -> desktop: still not remounted.
    mockIsWideDesktop = true;
    await TestRenderer.act(async () => {
      r.update(<StaySuiteShell {...STAY_PROPS} />);
    });
    expect(hostWithTestId(r, "stay-rail-offers")).toBeTruthy();
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();
    expect(mockOffersMounts).toBe(1);
  });

  // ---- #4490 spec 07 13 (fix round 5): Table reservations + Waitlist. ----
  const tablesStay = (
    features: Parameters<typeof featureSetFrom>[0],
  ): Record<string, unknown> => ({
    venueId: "venue-1484",
    brandId: "brand-1484",
    venueCategory: "stay",
    version: 1,
    activeSpaceCount: 1,
    features: featureSetFrom(features),
    flags: { reads: true, writes: true },
  });
  /** Let React.lazy chunks resolve and their Suspense boundaries commit. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
      await TestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
  }

  // TEST-MOD-APPROVED #4490 (spec 08 O1): the Till joins the decided twelve,
  // first of the floor tools (before Check-in, Menu and Orders).
  // TEST-MOD-APPROVED #4490 (spec 08 O3 part A2): Kitchen and bar follows the Till.
  // TEST-MOD-APPROVED #4490 (08-O5 part B): Close the day joins the order right after Kitchen and bar
  // (floor design rail: Till, Kitchen and bar, Close the day).
  it("T-1i — the order constant is the decided twelve plus the Till, Kitchen and bar and Close the day", () => {
    expect(STAY_FEATURE_MODULE_ORDER).toEqual([
      "offers",
      "spaces",
      "today",
      "calendar",
      "requests",
      "table_reservations",
      "waitlist",
      "members",
      "till",
      "stations",
      "close",
      "checkin",
      "menu",
      "orders",
      "guestlist",
    ]);
  });

  // #4490 spec 08 O1 — the Till in the Stay workspace.
  describe("08-O1 the Till destination", () => {
    afterEach(() => {
      mockTillReleased = false;
      mockAppRouter.push.mockClear();
      mockAppRouter.replace.mockClear();
    });

    it("T-TILL-1 — released, switched on and allowed: Till sits right before Check-in and opens the Till route", async () => {
      mockTillReleased = true;
      mockVenueAccess = { scoped: false, capabilities: [], canSell: true };
      mockStayFeaturesState = tablesStay({ entry: true, menu: true, till: true });
      const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
      const rail = testIdsMatching(r, /^stay-rail-/);
      expect(rail).toContain("stay-rail-till");
      expect(rail.indexOf("stay-rail-till")).toBe(rail.indexOf("stay-rail-checkin") - 1);
      await press(pressableWithTestId(r, "stay-rail-till"));
      expect(mockAppRouter.push).toHaveBeenCalledWith("/venue/venue-1484/till");
      // The workspace stays where it was (the Till is its own route).
      expect(testIdsMatching(r, /^venue-till-launcher$/)).toHaveLength(0);
    });

    it("T-TILL-2 — not released, switched off, or no right to sell: no Till", async () => {
      mockStayFeaturesState = tablesStay({ entry: true, menu: true, till: true });
      mockVenueAccess = { scoped: false, capabilities: [], canSell: true };
      mockTillReleased = false;
      const off = await mount(<StaySuiteShell {...STAY_PROPS} />);
      expect(testIdsMatching(off, /^stay-rail-till$/)).toHaveLength(0);
      mockTillReleased = true;
      mockVenueAccess = { scoped: false, capabilities: [], canSell: false };
      const finance = await mount(<StaySuiteShell {...STAY_PROPS} />);
      expect(testIdsMatching(finance, /^stay-rail-till$/)).toHaveLength(0);
      mockVenueAccess = { scoped: false, capabilities: [], canSell: true };
      mockStayFeaturesState = tablesStay({ entry: true, menu: true, till: false });
      const featureOff = await mount(<StaySuiteShell {...STAY_PROPS} />);
      expect(testIdsMatching(featureOff, /^stay-rail-till$/)).toHaveLength(0);
    });

    it("T-TILL-3 — a login that may only sell sees the Till and nothing else, never a blank workspace", async () => {
      mockTillReleased = true;
      mockStayFeaturesState = tablesStay({ entry: true, menu: true, till: true });
      mockVenueAccess = { scoped: true, capabilities: ["venue.sell"], canSell: true };
      const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
      await settle();
      expect(testIdsMatching(r, /^stay-rail-(?!scroll$)/)).toEqual(["stay-rail-till"]);
      expect(hostWithTestId(r, "venue-till-launcher")).toBeTruthy();
      await press(pressableWithTestId(r, "venue-till-open"));
      expect(mockAppRouter.push).toHaveBeenCalledWith("/venue/venue-1484/till");
    });

    it("T-TILL-4 — `?module=till` opens the Till itself, replacing the address", async () => {
      mockTillReleased = true;
      mockStayFeaturesState = tablesStay({ entry: true, menu: true, till: true });
      mockVenueAccess = { scoped: false, capabilities: [], canSell: true };
      await mount(<StaySuiteShell {...STAY_PROPS} requestedModule="till" />);
      await settle();
      expect(mockAppRouter.replace).toHaveBeenCalledWith("/venue/venue-1484/till");
      mockAppRouter.replace.mockClear();
      mockTillReleased = false;
      await mount(<StaySuiteShell {...STAY_PROPS} requestedModule="till" />);
      await settle();
      expect(mockAppRouter.replace).not.toHaveBeenCalled();
    });
  });

  it("T-1j — cold `?module=table_reservations` and `?module=waitlist` open the venue screens; `reservations` stays the Stay's own", async () => {
    mockStayFeaturesState = tablesStay({ table_reservations: true, waitlist: true });
    for (const wide of [true, false]) {
      mockIsWideDesktop = wide;
      const toldTables = jest.fn();
      // The route's venue parser does not know `table_reservations`.
      const t = await mount(
        <StaySuiteShell
          {...STAY_PROPS}
          initialModule="overview"
          requestedModule="table_reservations"
          onModuleChange={toldTables}
        />,
      );
      expect(hostWithTestId(t, "stub-venue-reservations")).toBeTruthy();
      expect(testIdsMatching(t, /^stub-reservations$/)).toHaveLength(0);
      expect(toldTables).not.toHaveBeenCalled();
      if (wide) {
        expect(railLabels(t, "stay-rail-")).toContain("Table reservations");
      } else {
        const pill = hostWithTestId(t, "stay-module-table_reservations");
        expect(pill.props.accessibilityLabel).toBe("Table reservations Stay module");
        expect(pill.props.accessibilityState).toEqual({ selected: true });
      }

      const toldWait = jest.fn();
      const w = await mount(
        <StaySuiteShell
          {...STAY_PROPS}
          initialModule="waitlist"
          requestedModule="waitlist"
          onModuleChange={toldWait}
        />,
      );
      expect(hostWithTestId(w, "stub-waitlist")).toBeTruthy();
      expect(toldWait).not.toHaveBeenCalled();

      const toldStay = jest.fn();
      const s = await mount(
        <StaySuiteShell
          {...STAY_PROPS}
          initialModule="reservations"
          requestedModule="reservations"
          onModuleChange={toldStay}
        />,
      );
      expect(hostWithTestId(s, "stub-reservations")).toBeTruthy();
      expect(testIdsMatching(s, /^stub-venue-reservations$/)).toHaveLength(0);
      expect(toldStay).not.toHaveBeenCalled();
    }
    mockIsWideDesktop = true;
  });

  it("T-1k — with the features off the two destinations are hidden and their links fall back to Overview", async () => {
    mockStayFeaturesState = tablesStay({ entry: true });
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(testIdsMatching(r, /^stay-rail-(table_reservations|waitlist)$/)).toHaveLength(0);
    for (const key of ["table_reservations", "waitlist"]) {
      const told = jest.fn();
      const t = await mount(
        <StaySuiteShell
          {...STAY_PROPS}
          initialModule="overview"
          requestedModule={key}
          onModuleChange={told}
        />,
      );
      expect(testIdsMatching(t, /^stub-(venue-reservations|waitlist)$/)).toHaveLength(0);
      expect(told).toHaveBeenCalledTimes(1);
      expect(told).toHaveBeenCalledWith("overview");
    }
    // Table reservations on, Waitlist off: only Table reservations.
    mockStayFeaturesState = tablesStay({ table_reservations: true, waitlist: false });
    const only = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(testIdsMatching(only, /^stay-rail-table_reservations$/)).toHaveLength(1);
    expect(testIdsMatching(only, /^stay-rail-waitlist$/)).toHaveLength(0);
  });

  it("T-1l — staff see them exactly when the venue capability allows", async () => {
    mockStayFeaturesState = tablesStay({
      entry: true,
      table_reservations: true,
      waitlist: true,
    });
    // Each grant also carries a Stay page so the landing module is a stub.
    mockVenueAccess = {
      scoped: true,
      capabilities: ["stay.view_reservations", "restaurant.manage_reservations"],
    };
    const reservations = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const reservationRail = testIdsMatching(reservations, /^stay-rail-/);
    expect(reservationRail).toContain("stay-rail-table_reservations");
    expect(reservationRail).toContain("stay-rail-waitlist");
    expect(reservationRail).not.toContain("stay-rail-today");
    expect(reservationRail).not.toContain("stay-rail-offers");

    mockVenueAccess = {
      scoped: true,
      capabilities: ["stay.view_reservations", "venue.view_bookings"],
    };
    const door = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const doorRail = testIdsMatching(door, /^stay-rail-/);
    expect(doorRail).toContain("stay-rail-today");
    expect(doorRail).not.toContain("stay-rail-table_reservations");
    expect(doorRail).not.toContain("stay-rail-waitlist");
  });

  it("T-1m — shared modules' links land on the Stay destinations", async () => {
    expect(stayTargetForVenueModule("reservations")).toEqual({
      module: "table_reservations",
      tableView: "bookings",
    });
    expect(stayTargetForVenueModule("availability")).toEqual({
      module: "table_reservations",
      tableView: "times",
    });
    expect(stayTargetForVenueModule("waitlist")).toEqual({ module: "waitlist" });
    expect(stayTargetForVenueModule("settings")).toEqual({ module: "settings" });
    expect(stayTargetForVenueModule("tables")).toBeNull();
    expect(stayTargetForVenueModule("insights")).toBeNull();

    mockStayFeaturesState = tablesStay({
      entry: true,
      table_reservations: true,
      waitlist: true,
    });
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(r, "stay-rail-offers"));
    await settle();
    const open = (): ((module: string) => void) =>
      (mockOffersProps as Record<string, unknown>).onOpenModule as (module: string) => void;

    // Offers › "Table reservations" card asks for the venue `reservations`.
    await TestRenderer.act(() => open()("reservations"));
    expect(hostWithTestId(r, "stub-venue-reservations")).toBeTruthy();
    expect(testIdsMatching(r, /^stub-reservations$/)).toHaveLength(0);

    await press(pressableWithTestId(r, "stay-rail-offers"));
    await settle();
    await TestRenderer.act(() => open()("availability"));
    await settle();
    expect(hostWithTestId(r, "stub-table-times")).toBeTruthy();

    await press(pressableWithTestId(r, "stay-rail-offers"));
    await settle();
    await TestRenderer.act(() => open()("waitlist"));
    expect(hostWithTestId(r, "stub-waitlist")).toBeTruthy();

    // Nothing to show here: the tap does nothing rather than a wrong page.
    await press(pressableWithTestId(r, "stay-rail-offers"));
    await settle();
    await TestRenderer.act(() => open()("insights"));
    expect(hostWithTestId(r, "stub-offers")).toBeTruthy();

    // Reservations › Edit floor opens Spaces when Spaces is here.
    await press(pressableWithTestId(r, "stay-rail-table_reservations"));
    const editFloor = (mockVenueReservationsProps as Record<string, unknown>)
      .onEditFloor as (spaceId: string) => void;
    expect(typeof editFloor).toBe("function");
  });

  it("T-1n — Table times and rules: reachable from Table reservations, and its leave dialog gates every exit", async () => {
    mockStayFeaturesState = tablesStay({ table_reservations: true, waitlist: true });
    const r = await mount(
      <StaySuiteShell
        {...STAY_PROPS}
        initialModule="overview"
        requestedModule="table_reservations"
      />,
    );
    expect(hostWithTestId(r, "stub-venue-reservations")).toBeTruthy();
    await press(pressableWithTestId(r, "stay-table-view-times"));
    await settle();
    expect(hostWithTestId(r, "stub-table-times")).toBeTruthy();
    expect(mockTableTimesProps).toMatchObject({
      brandId: "brand-1484",
      venueId: "venue-1484",
      showTableTimes: true,
      tableReservationsOn: true,
      canEditHours: true,
    });

    // Unsaved hours or rules: a rail switch asks the module, which holds.
    mockTableTimesHold = true;
    await press(pressableWithTestId(r, "stay-rail-overview"));
    expect(mockTableTimesRequestLeave).toHaveBeenCalledTimes(1);
    expect(hostWithTestId(r, "stub-table-times")).toBeTruthy();

    // Header Back goes through the same module gate.
    const back = jest.fn();
    await TestRenderer.act(() => {
      (mockRequestLeave as NonNullable<MockRequestLeave>)(back);
    });
    expect(mockTableTimesRequestLeave).toHaveBeenCalledTimes(2);
    expect(back).not.toHaveBeenCalled();

    // Back to the bookings tab also asks first.
    await press(pressableWithTestId(r, "stay-table-view-bookings"));
    expect(mockTableTimesRequestLeave).toHaveBeenCalledTimes(3);
    expect(hostWithTestId(r, "stub-table-times")).toBeTruthy();

    // Unsaved state also holds a brand switch.
    mockDirtyModules = new Set(["availability"]);
    await TestRenderer.act(async () => {
      r.update(<StaySuiteShell {...STAY_PROPS} requestedModule="table_reservations" />);
    });
    expect(await unsavedWorkHoldsSwitch()).toBe(true);
    mockDirtyModules = new Set<string>();
    await TestRenderer.act(async () => {
      r.update(<StaySuiteShell {...STAY_PROPS} requestedModule="table_reservations" />);
    });
    expect(await unsavedWorkHoldsSwitch()).toBe(false);

    // Clean: the switch goes through.
    mockTableTimesHold = false;
    await press(pressableWithTestId(r, "stay-rail-overview"));
    expect(testIdsMatching(r, /^stub-table-times$/)).toHaveLength(0);
  });


  // ---- #4490 R4J fix round 6 ----
  it("T-1o — R4J-N20: Bookings scrolls as one list on the stacked layout; screens without their own scroll get a page scroll", async () => {
    mockStayFeaturesState = tablesStay({
      table_reservations: true,
      waitlist: true,
      menu: true,
    });
    for (const wide of [false, true]) {
      mockIsWideDesktop = wide;
      mockVenueReservationsProps = null;
      const t = await mount(
        <StaySuiteShell {...STAY_PROPS} requestedModule="table_reservations" />,
      );
      expect(hostWithTestId(t, "stub-venue-reservations")).toBeTruthy();
      // Stacked: the heading and toolbar scroll with the list (the list had
      // 0 px at 390x844 under the pill band); desktop keeps the ordinary form.
      expect(mockVenueReservationsProps).toMatchObject({
        chromeScrollsWithList: !wide,
        scrollBottomPad: STAY_PAGE_BOTTOM_PAD,
      });
      // It owns its scroll (moduleSelfScrolls("reservations")): never nested.
      expect(testIdsMatching(t, /^stay-feature-scroll-/)).toHaveLength(0);
      t.unmount();
    }
    mockIsWideDesktop = false;
    for (const [key, stubId] of [
      ["waitlist", "stub-waitlist"],
      ["menu", "stub-menu"],
    ] as const) {
      const t = await mount(<StaySuiteShell {...STAY_PROPS} requestedModule={key} />);
      const scroll = hostWithTestId(t, `stay-feature-scroll-${key}`);
      const flat = (StyleSheet.flatten(scroll.props.style as never) ?? {}) as Flat;
      expect(flat.flex).toBe(1);
      const content = (StyleSheet.flatten(
        nodes(t).find((n) => n.props?.testID === `stay-feature-scroll-${key}` && n.props?.contentContainerStyle !== undefined)
          ?.props.contentContainerStyle as never,
      ) ?? {}) as Flat;
      expect(content.paddingBottom).toBe(STAY_PAGE_BOTTOM_PAD);
      expect(hostWithTestId(t, stubId)).toBeTruthy();
      t.unmount();
    }
    mockIsWideDesktop = true;
  });

  it("T-1p — R4J-N25: on a Stay the screens name the destination Table reservations", async () => {
    mockStayFeaturesState = tablesStay({ table_reservations: true, waitlist: true });
    const t = await mount(
      <StaySuiteShell {...STAY_PROPS} requestedModule="table_reservations" />,
    );
    expect(mockVenueReservationsProps?.title).toBe("Table reservations");
    await press(pressableWithTestId(t, "stay-rail-waitlist"));
    expect(mockWaitlistProps?.reservationsLabel).toBe("Table reservations");
  });

  it("T-1q — R4J-N22: staff with only venue.check_in on a Stay get the door pages, not the access-unavailable page", async () => {
    mockStayFeaturesState = tablesStay({ entry: true, table_reservations: true });
    mockVenueAccess = { scoped: true, capabilities: ["venue.check_in"] };
    const door = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(testIdsMatching(door, /^stay-access-unavailable$/)).toHaveLength(0);
    // Same as the ordinary shell: venue.check_in opens Today and Check-in.
    expect(testIdsMatching(door, /^stay-rail-(?!scroll$)[a-z_]+$/)).toEqual([
      "stay-rail-today",
      "stay-rail-checkin",
    ]);

    // Nothing at this venue uses the door: truly nothing to show.
    mockStayFeaturesState = tablesStay({ table_reservations: true });
    const none = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(hostWithTestId(none, "stay-access-unavailable")).toBeTruthy();
  });

  it("T-1r — R4J-N23: Table reservations with no tables keeps Spaces in reach, and Open tables lands on Spaces › Tables", async () => {
    const noTables = (needs: string[]): Record<string, unknown> => {
      const state = tablesStay({ table_reservations: true });
      const features = state.features as Record<string, Record<string, unknown>>;
      return {
        ...state,
        activeSpaceCount: 0,
        features: {
          ...features,
          table_reservations: { ...features.table_reservations, needs },
        },
      };
    };
    // Tables exist (nothing needed) and no space: classic nav, no Spaces —
    // exactly the shared rule.
    mockStayFeaturesState = noTables([]);
    const ready = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(testIdsMatching(ready, /^stay-rail-spaces$/)).toHaveLength(0);

    // No tables yet: Spaces shows (tables live in Spaces › Tables on a Stay).
    mockStayFeaturesState = noTables(["table"]);
    const r = await mount(
      <StaySuiteShell {...STAY_PROPS} requestedModule="table_reservations" />,
    );
    expect(testIdsMatching(r, /^stay-rail-spaces$/)).toHaveLength(1);
    await press(pressableWithTestId(r, "stay-table-view-times"));
    await settle();
    const openTables = mockTableTimesProps?.onOpenTables as (() => void) | undefined;
    expect(typeof openTables).toBe("function");
    await TestRenderer.act(() => (openTables as () => void)());
    await settle();
    expect(hostWithTestId(r, "stub-spaces")).toBeTruthy();
    expect(mockSpacesProps).toMatchObject({ initialView: "tables", initialSpaceId: null });
  });

  it("T-2 — desktopCentered has NO maxWidth, keeps the anchor + gutters", async () => {
    mockIsWideDesktop = true;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const flat = centeredStyle(r, "stay-suite-shell-desktop");

    // ORCH-1184's decision, inherited: the workspace FILLS the page width.
    expect(typeof flat.maxWidth).not.toBe("number");
    expect(flat.maxWidth).toBeUndefined();

    // ...while keeping the left anchor + the edge gutters.
    expect(flat.alignSelf).toBe("flex-start");
    expect(typeof flat.paddingHorizontal).toBe("number");
    expect(flat.paddingHorizontal as number).toBeGreaterThan(0);
    expect(flat.paddingHorizontal).toBe(space[4]);

    // Two-column row at full width, with the fixed-width rail.
    expect(flat.flexDirection).toBe("row");
    expect(flat.width).toBe("100%");

    const rail = hostWithTestId(r, "stay-rail-overview");
    expect(rail.props.accessibilityRole).toBe("tab");
  });

  it("T-2b — the rail is a tablist of the canonical width", async () => {
    mockIsWideDesktop = true;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const host = hostWithTestId(r, "stay-suite-shell-desktop");
    const centered = host.props.children as React.ReactElement<{
      children: React.ReactElement[];
    }>;
    const railHost = centered.props.children[0];
    const railFlat = (StyleSheet.flatten(
      (railHost.props as { style?: unknown }).style,
    ) ?? {}) as Flat;
    expect(railFlat.width).toBe(venueRailWidth);
    expect(
      (railHost.props as { accessibilityRole?: string }).accessibilityRole,
    ).toBe("tablist");
  });

  it("T-3 — per-module desktop widths: Overview uncapped, Settings capped", async () => {
    mockIsWideDesktop = true;

    // Overview (default module) — uncapped + left-anchored.
    const overview = await mount(<StaySuiteShell {...STAY_PROPS} />);
    // Sanity: the Overview body actually rendered before we read its measure.
    expect(hasText(overview, "Stay overview")).toBe(true);
    expect(pageMeasure(overview)).toBeDefined();
    // Falsifiable: fails if the cap is silently RETAINED via an override array.
    expectUncapped(pageStyleProp(overview));

    // Settings — an editable form keeps the readable measure, left-anchored.
    await TestRenderer.act(() => overview.unmount());
    const settings = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(settings, "stay-rail-settings"));
    expectCappedAt(pageStyleProp(settings), suiteFormMaxWidth);
  });

  it("T-3b — desktop: the readiness grid PARENTS the rows (real flex parent)", async () => {
    mockIsWideDesktop = true;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    // The grid wrapper exists and is a wrapping ROW...
    const grid = nodes(r).find(
      (node) =>
        node.props?.testID === "stay-readiness-grid" &&
        typeof node.type === "string",
    );
    expect(grid).toBeDefined();
    const gridFlat = (StyleSheet.flatten(
      (grid as RenderNode).props.style as never,
    ) ?? {}) as Flat;
    expect(gridFlat.flexDirection).toBe("row");
    expect(gridFlat.flexWrap).toBe("wrap");

    // ...and ALL SEVEN readiness rows are its DESCENDANTS. This is the part
    // that was broken: the grid style used to sit on GlassCard, whose inner
    // padding View (a COLUMN) actually parented the rows, so `flexBasis`
    // resolved as a HEIGHT and every row became 320px tall.
    const rowIds = new Set<string>();
    (grid as RenderNode)
      .findAll(() => true)
      .forEach((node) => {
        const id = node.props?.testID;
        if (typeof id === "string" && id.startsWith("stay-check-")) {
          rowIds.add(id);
        }
      });
    expect(rowIds.size).toBe(6);
  });

  it("T-3c — phone: NO grid wrapper (host tree byte-identical to today)", async () => {
    mockIsWideDesktop = false;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(testIdsMatching(r, /^stay-readiness-grid$/)).toHaveLength(0);
    // The rows still render — they are just emitted as a bare fragment.
    expect(testIdsMatching(r, /^stay-check-/)).toHaveLength(6);
  });

  it("T-4 — below 1024px the pill row renders and the rail does NOT", async () => {
    mockIsWideDesktop = false;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    // The phone/native layout is untouched: pills on top of the workspace.
    for (const id of STAY_MODULE_IDS) {
      expect(hostWithTestId(r, `stay-module-${id}`)).toBeTruthy();
    }
    expect(hostWithTestId(r, "stay-suite-shell")).toBeTruthy();

    // No desktop shell, no rail.
    expect(testIdsMatching(r, /^stay-suite-shell-desktop$/)).toHaveLength(0);
    expect(testIdsMatching(r, /^stay-rail-/)).toHaveLength(0);

    // ...and the Overview page keeps today's exact centred readable measure.
    const phoneStyle = pageStyleProp(r);
    expect(Array.isArray(phoneStyle)).toBe(false);
    const page = pageMeasure(r);
    expect(page?.maxWidth).toBe(stayPageMaxWidth);
    expect(page?.alignSelf).toBe("center");
  });
});

describe("#1484 — Venue suite is NOT regressed by the extraction", () => {
  it("T-5 — venue desktop rail + full-width workspace are unchanged", async () => {
    mockIsWideDesktop = true;
    const r = await mount(
      <VenueSuiteShell brandId="brand-test" initialModule="settings" />,
    );

    expect(hostWithTestId(r, "venue-suite-shell-desktop")).toBeTruthy();
    // Issue #1735 [TEST-MOD-APPROVED #1735] — the command-band "Insights"
    // module lands between Menu and Settings (the ORCH-1186-C menu precedent).
    // Issue #1791 [TEST-MOD-APPROVED #1791] — the command-band "Orders" module
    // lands between Insights and Settings, same precedent.
    // T-5's invariant (venue rail renders, existing order, Settings last,
    // uncapped full-width workspace) is UNCHANGED — the pin gains one label.
    expect(railLabels(r, "venue-rail-")).toEqual([
      "Overview",
      "Tables",
      "Availability",
      "Reservations",
      "Waitlist",
      "Menu",
      "Insights",
      "Orders",
      "Settings",
    ]);

    const flat = centeredStyle(r, "venue-suite-shell-desktop");
    expect(typeof flat.maxWidth).not.toBe("number");
    expect(flat.maxWidth).toBeUndefined();
    expect(flat.alignSelf).toBe("flex-start");
    expect(flat.paddingHorizontal).toBe(space[4]);
    expect(flat.flexDirection).toBe("row");
    expect(flat.width).toBe("100%");
  });

  it("T-6 — venue phone branch still renders the phone host, not the rail", async () => {
    mockIsWideDesktop = false;
    const r = await mount(
      <VenueSuiteShell brandId="brand-test" initialModule="settings" />,
    );
    expect(hostWithTestId(r, "venue-suite-shell-phone")).toBeTruthy();
    expect(testIdsMatching(r, /^venue-suite-shell-desktop$/)).toHaveLength(0);
    expect(testIdsMatching(r, /^venue-rail-/)).toHaveLength(0);
  });
});
