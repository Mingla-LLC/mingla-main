/**
 * Issue #1484 [stay-desktop-shell] — TESTER-OWNED ADVERSARIAL render suite.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SUITES (deliberately, by construction):
 * `staySuiteShell.issue1484.desktopShell.render.test.tsx` and
 * `stayInventoryManager.issue1484.formMeasure.render.test.tsx` both
 * `jest.mock("../../../hooks/useResponsiveLayout")` and flip a hand-written
 * `isWideDesktop` boolean. That proves what each branch renders, but it NEVER
 * executes the breakpoint itself — the 1024px comparison, the `width > 0`
 * unmeasured-viewport guard and the `Platform.OS === "web"` native guard are all
 * mocked away, so a regression in ANY of them is invisible to those suites.
 *
 * This suite mocks NOTHING in the gate path. It substitutes only React Native's
 * `useWindowDimensions` + `Platform` (via a scoped Proxy over the `react-native`
 * module, so RN's own internals keep the real ones) and then drives the REAL
 * `useResponsiveLayout` through the REAL components. Every assertion below is a
 * consequence of the real hook's real arithmetic.
 *
 * GROUPS
 *  A  BOUNDARY — the exact 1023 / 1024 / 1025 line, the 0-width unmeasured
 *     viewport (no rail may flash before measurement), native at desktop width,
 *     and an extreme 2560px monitor.
 *  B  RAIL <-> WORKSPACE — every `stay-rail-*` testID resolves, roles are
 *     tablist/tab, and selecting EACH of the six modules swaps the workspace and
 *     moves the active state (exactly one selected row, exactly one accent bar).
 *  C  FORM vs TABLE — the distinction the design rests on: at the real 1024
 *     boundary the Settings form and the Rooms & Places list resolve to
 *     GENUINELY DIFFERENT measures, and one pixel below the boundary both
 *     collapse back to today's centred phone measure.
 *  D  RESTAURANT NON-REGRESSION — a byte-level golden of the venue suite's
 *     rendered HOST tree (react-test-renderer `toJSON()`, normalised) captured
 *     from `origin/main` BEFORE the extraction, asserted for ALL SEVEN venue
 *     modules plus the phone branch. Not "Overview looks fine" — the whole tree,
 *     every module, including the `workspaceSelfScrolls` scroll-container
 *     contract that the implementor's T-5 exercised for `settings` only.
 *
 * FAILS-ON-REVERT: see the tester verdict comment on issue #1484 for the exact
 * per-group failure signature under a true line-deletion of the fix.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * RENDERER: `react-test-renderer` via the repo's `require(...) as {…}` idiom —
 * load-bearing for the issue-1403 typecheck-delta gate (a bare import of an
 * untyped/absent renderer adds a TS7016/TS2307 diagnostic).
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1484.render.cjs --runInBand
 */

import React from "react";

// ---------------------------------------------------------------------------
// The ONLY substitution: React Native's viewport + platform primitives.
// `useResponsiveLayout` itself is NOT mocked — the real 1024 comparison, the
// real `width > 0` guard and the real `Platform.OS === "web"` guard all run.
// A Proxy is used (rather than a spread) so RN's own modules, which import via
// relative paths, keep the genuine Platform/dimensions and never see the stub.
// ---------------------------------------------------------------------------
let mockViewportWidth = 1440;
let mockPlatformOS = "web";

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  const platformStub = {
    get OS(): string {
      return mockPlatformOS;
    },
    select: (spec: Record<string, unknown>): unknown =>
      mockPlatformOS in spec ? spec[mockPlatformOS] : spec.default,
    Version: 17,
    isPad: false,
    isTV: false,
    isTesting: true,
    constants: {},
  };
  return new Proxy(RN as Record<string, unknown>, {
    get(target: Record<string, unknown>, prop: string): unknown {
      if (prop === "useWindowDimensions") {
        return (): Record<string, number> => ({
          width: mockViewportWidth,
          height: 900,
          scale: 2,
          fontScale: 1,
        });
      }
      if (prop === "Platform") return platformStub;
      return target[prop];
    },
  });
});

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
// Sheet -> SheetMobile -> gesture-handler asks the TurboModuleRegistry for a
// native binary that does not exist under jest. Boundary stub only.
jest.mock("react-native-gesture-handler", () => {
  const RN = jest.requireActual("react-native");
  const chain = (): Record<string, unknown> => {
    const api: Record<string, unknown> = {};
    for (const key of [
      "onBegin",
      "onStart",
      "onUpdate",
      "onEnd",
      "onFinalize",
      "activeOffsetY",
      "activeOffsetX",
      "failOffsetY",
      "failOffsetX",
      "enabled",
      "simultaneousWithExternalGesture",
    ]) {
      api[key] = () => api;
    }
    return api;
  };
  return {
    __esModule: true,
    Gesture: { Pan: chain, Tap: chain, Native: chain, Simultaneous: chain },
    GestureDetector: ({ children }: { children: unknown }): unknown => children,
    GestureHandlerRootView: RN.View,
    ScrollView: RN.ScrollView,
    State: {},
    Directions: {},
  };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
  }),
  useMutation: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
  }),
}));

// ---- Service boundaries (import-time supabase-client chains). --------------
jest.mock("../../../services/stayInventoryService", () => ({
  bulkCreateStayOfferings: jest.fn(),
  changeStayOfferingStatus: jest.fn(),
  createStayOffering: jest.fn(),
  attachStayOfferingMedia: jest.fn(),
  manageStayInventory: jest.fn(),
  materializeStayPlaceWindows: jest.fn(),
  replaceStayOfferingFees: jest.fn(),
  replaceStayUnits: jest.fn(),
  removeStayOfferingMedia: jest.fn(),
  setStayOfferingPolicy: jest.fn(),
  setStayOfferingPrice: jest.fn(),
  updateStayOffering: jest.fn(),
  upsertStayPlaceSchedule: jest.fn(),
  upsertStayPlaceWindows: jest.fn(),
  upsertStayRoomNights: jest.fn(),
}));
jest.mock("../../../services/stayMediaService", () => ({
  pickStayOfferingPhotos: jest.fn(),
  stayOfferingMediaUrl: jest.fn(() => null),
  uploadStayOfferingPhoto: jest.fn(),
}));
// The shared guest package lives OUTSIDE mingla-business, so its babel runtime
// helpers do not resolve under this jest root. Only the money formatter is used
// by the reservations module.
jest.mock("@mingla/brand-rendering/stayGuest", () => ({
  formatStayMoney: (minor: number, code: string): string =>
    `${code} ${(minor / 100).toFixed(2)}`,
}));

// ---- Stay data hooks — a READY snapshot so every module renders a body. ----
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
  permissions: { canManageInventory: true, canManageFinance: true },
};
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: {
    all: ["stay-inventory"],
    venue: (venueId: string) => ["stay-inventory", venueId],
  },
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
jest.mock("../../../hooks/useStayStaffReservations", () => ({
  useStayStaffReservationList: () => ({
    data: {
      groups: [],
      permissions: { canView: true, canManage: true, canRefund: true },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

// ---- Venue data hooks + store (group D). -----------------------------------
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({
    data: { reservationsEnabled: true },
    isLoading: false,
  }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: (selector: (s: { sync: () => void }) => unknown) =>
    selector({ sync: () => undefined }),
}));

// ---- Venue MODULE BODIES are stubbed: this suite asserts on the SHELL. -----
// (Stay module bodies are NOT stubbed — group C needs the real measures.)
const stub = (id: string): (() => React.ReactElement) => {
  const Stub = (): React.ReactElement => (
    <RNText testID={`stub-${id}`}>{id}</RNText>
  );
  Stub.displayName = `Stub_${id}`;
  return Stub;
};
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
jest.mock("../../venue/VenueReservationsModule", () => ({
  VenueReservationsModule: stub("venue-reservations"),
}));
jest.mock("../../venue/VenueWaitlistModule", () => ({
  VenueWaitlistModule: stub("waitlist"),
}));
jest.mock("../../venue/VenueMenuModule", () => ({
  VenueMenuModule: stub("menu"),
}));
// The reservation DETAIL sub-sheet drags in Sheet -> keyboard-controller, a
// native-only binding. The reservations LIST (whose desktop measure this suite
// asserts) is left REAL; only the sheet behind it is stubbed.
jest.mock("../../stay/StayReservationManagementDetail", () => ({
  StayReservationManagementDetail: stub("stay-reservation-detail"),
}));

import { StyleSheet, Text as RNText } from "react-native";

import {
  spacing,
  stayInventoryMaxWidth,
  stayPageMaxWidth,
  suiteFormMaxWidth,
  venueRailWidth,
} from "../../../constants/designSystem";
import { WIDE_DESKTOP_MIN_WIDTH } from "../../../hooks/useResponsiveLayout";
import { StaySuiteShell } from "../../stay/StaySuiteShell";
import { VenueSuiteShell } from "../../venue/VenueSuiteShell";
import { venueScrollBottomPad } from "../../venue/venueShellScroll";

// ---------------------------------------------------------------------------
// react-test-renderer harness.
// ---------------------------------------------------------------------------
interface RenderNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
}
interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: (JsonNode | string)[] | null;
}
interface RenderTree {
  root: RenderNode;
  toJSON: () => JsonNode | JsonNode[] | null;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  expect(tree).not.toBeNull();
  return tree as unknown as RenderTree;
}

type Flat = Record<string, unknown>;

const nodes = (tree: RenderTree): RenderNode[] => tree.root.findAll(() => true);

/** Distinct testIDs in the tree matching `pattern`, in render order. */
function testIdsMatching(tree: RenderTree, pattern: RegExp): string[] {
  const seen = new Set<string>();
  for (const node of nodes(tree)) {
    const id = node.props?.testID;
    if (typeof id === "string" && pattern.test(id)) seen.add(id);
  }
  return [...seen];
}

/** HOST node carrying `testID` (mirrors RTL's host-only `getByTestId`). */
function hostWithTestId(tree: RenderTree, testID: string): RenderNode {
  const node = nodes(tree).find(
    (candidate) =>
      typeof candidate.type === "string" && candidate.props?.testID === testID,
  );
  expect(node).toBeDefined();
  return node as RenderNode;
}

/** The node carrying `testID` AND a real `onPress` (the Pressable). */
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

/**
 * The REAL flattened `contentContainerStyle` of a module's page ScrollView,
 * identified by the `paddingBottom` every Stay page style carries.
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
    .find((flat: Flat) => flat.paddingBottom !== undefined);
}

/** Flattened style of the two-column block hanging off a desktop host. */
function centeredStyle(tree: RenderTree, hostTestId: string): Flat {
  const host = hostWithTestId(tree, hostTestId);
  const centered = host.props.children as React.ReactElement<{
    style?: unknown;
  }>;
  return (StyleSheet.flatten(centered.props.style) ?? {}) as Flat;
}

// ---------------------------------------------------------------------------
// Group D harness — normalised HOST-tree fingerprint.
//
// `toJSON()` emits ONLY host elements, so composite wrappers (the new
// `SuiteDesktopShell`) are invisible by construction: two trees compare equal
// iff what React Native actually renders is identical. Props are allow-listed
// to the ones that decide layout, identity and accessibility; styles are
// flattened and key-sorted so a StyleSheet-registry id change cannot mask a
// real difference.
// ---------------------------------------------------------------------------
const FINGERPRINT_PROPS = [
  "testID",
  "accessibilityRole",
  "accessibilityLabel",
  "accessibilityState",
  "horizontal",
  "showsHorizontalScrollIndicator",
] as const;

function sortedFlat(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const flat = StyleSheet.flatten(value as never) as Record<string, unknown>;
  if (flat === undefined || flat === null) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(flat).sort()) out[key] = flat[key];
  return out;
}

function fingerprintNode(node: JsonNode | string): unknown {
  if (typeof node === "string") return node;
  const props = node.props ?? {};
  const entry: Record<string, unknown> = { $: node.type };
  for (const key of FINGERPRINT_PROPS) {
    if (props[key] !== undefined) entry[key] = props[key];
  }
  const style = sortedFlat(props.style);
  if (style !== null) entry.style = style;
  const ccs = sortedFlat(props.contentContainerStyle);
  if (ccs !== null) entry.contentContainerStyle = ccs;
  // Interactivity is structural: a row that stops being pressable is a defect
  // even if it still paints identically.
  entry.pressable = typeof props.onStartShouldSetResponder === "function";
  const kids = node.children;
  if (kids !== null && kids !== undefined) {
    entry.children = kids.map(fingerprintNode);
  }
  return entry;
}

function fingerprint(tree: RenderTree): string {
  const json = tree.toJSON();
  return JSON.stringify(fingerprintNode(json as JsonNode));
}

const VENUE_MODULE_IDS = [
  "overview",
  "tables",
  "availability",
  "reservations",
  "waitlist",
  "menu",
  "settings",
] as const;

const STAY_MODULE_IDS = [
  "overview",
  "rooms_places",
  "availability_pricing",
  "reservations",
  "menu",
  "settings",
] as const;

const STAY_PROPS = {
  brandId: "brand-1484",
  venueId: "venue-1484",
  venueName: "Test Hotel",
  venueApproved: true,
};

/**
 * GOLDEN — captured by running THIS FILE's `venueFingerprints()` helper against
 * `origin/main`'s pre-extraction `VenueSuiteShell.tsx` (commit e384c6ac1,
 * restored into the worktree, fingerprint printed, file reverted). Loaded from a
 * sibling JSON so a genuine diff is readable in the failure output rather than
 * a 30 KB one-line string. See the tester verdict on issue #1484.
 */
const GOLDEN = require("./suiteDesktopShell.issue1484.venueGolden.json") as {
  capturedFrom: string;
  desktop: Record<string, string>;
  phone: Record<string, string>;
};

/** Fingerprint the venue desktop shell for every module, one mount each. */
async function venueFingerprints(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const moduleId of VENUE_MODULE_IDS) {
    const tree = await mount(
      <VenueSuiteShell brandId="brand-test" venueId="venue-test" />,
    );
    if (moduleId !== "overview") {
      await press(pressableWithTestId(tree, `venue-rail-${moduleId}`));
    }
    out[moduleId] = fingerprint(tree);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  }
  return out;
}

/**
 * Phone-branch fingerprints for the two distinct shapes: `overview`
 * (self-scrolling, no shell ScrollView) and `settings` (shell-owned ScrollView
 * + nav clearance). The phone branch has no rail, so modules are driven through
 * `initialModule`.
 */
async function venuePhoneFingerprints(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const moduleId of ["overview", "settings"] as const) {
    const tree = await mount(
      <VenueSuiteShell
        brandId="brand-test"
        venueId="venue-test"
        initialModule={moduleId}
      />,
    );
    out[moduleId] = fingerprint(tree);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  }
  return out;
}

beforeEach(() => {
  mockViewportWidth = 1440;
  mockPlatformOS = "web";
});

// ===========================================================================
// GROUP A — the REAL breakpoint, exercised through the REAL hook.
// ===========================================================================
describe("#1484 A — the real 1024 boundary, unmeasured viewports and native", () => {
  it("A-0 — the boundary constant is still 1024 (the whole suite is pinned to it)", () => {
    expect(WIDE_DESKTOP_MIN_WIDTH).toBe(1024);
  });

  it("A-1 — 1023px web: pill row renders, NO rail, NO desktop host", async () => {
    mockViewportWidth = WIDE_DESKTOP_MIN_WIDTH - 1;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    expect(testIdsMatching(r, /^stay-rail-/)).toHaveLength(0);
    expect(testIdsMatching(r, /^stay-suite-shell-desktop$/)).toHaveLength(0);
    for (const id of STAY_MODULE_IDS) {
      expect(hostWithTestId(r, `stay-module-${id}`)).toBeTruthy();
    }
  });

  it("A-2 — 1024px web is INCLUSIVE: rail renders, pill row does NOT", async () => {
    mockViewportWidth = WIDE_DESKTOP_MIN_WIDTH;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    expect(hostWithTestId(r, "stay-suite-shell-desktop")).toBeTruthy();
    expect(testIdsMatching(r, /^stay-rail-/)).toHaveLength(
      STAY_MODULE_IDS.length,
    );
    expect(testIdsMatching(r, /^stay-module-/)).toHaveLength(0);
  });

  it("A-3 — 1025px web: still the rail (no upper bound on the branch)", async () => {
    mockViewportWidth = WIDE_DESKTOP_MIN_WIDTH + 1;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(hostWithTestId(r, "stay-suite-shell-desktop")).toBeTruthy();
    expect(testIdsMatching(r, /^stay-module-/)).toHaveLength(0);
  });

  it("A-4 — width 0 (unmeasured viewport): NO rail flashes before measurement", async () => {
    // RN-web reports { width: 0 } when there is no window yet (SSR / first
    // paint). The rail must not appear and then vanish once the real width
    // arrives — the hook's `width > 0` guard is the thing under test.
    mockViewportWidth = 0;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    expect(testIdsMatching(r, /^stay-suite-shell-desktop$/)).toHaveLength(0);
    expect(testIdsMatching(r, /^stay-rail-/)).toHaveLength(0);
    // ...and the phone layout is what shows in the meantime.
    expect(hostWithTestId(r, "stay-module-overview")).toBeTruthy();
  });

  it("A-5 — NATIVE at desktop width stays on the pill row (iOS and Android)", async () => {
    // This change is desktop-WEB-only. A tablet or a large-screen Android
    // device reports width >= 1024 but must never get the rail.
    for (const os of ["ios", "android"]) {
      mockPlatformOS = os;
      mockViewportWidth = 1440;
      const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

      expect(testIdsMatching(r, /^stay-suite-shell-desktop$/)).toHaveLength(0);
      expect(testIdsMatching(r, /^stay-rail-/)).toHaveLength(0);
      for (const id of STAY_MODULE_IDS) {
        expect(hostWithTestId(r, `stay-module-${id}`)).toBeTruthy();
      }
      // The phone readable measure is intact on native too.
      const page = pageMeasure(r);
      expect(page?.maxWidth).toBe(stayPageMaxWidth);
      expect(page?.alignSelf).toBe("center");
      r.unmount();
    }
  });

  it("A-6 — 2560px: still uncapped, still left-anchored, rail still 220", async () => {
    mockViewportWidth = 2560;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const flat = centeredStyle(r, "stay-suite-shell-desktop");

    // A cap creeping back is exactly the ORCH-1184 "weird black bar" defect.
    expect(flat.maxWidth).toBeUndefined();
    expect(flat.alignSelf).toBe("flex-start");
    expect(flat.width).toBe("100%");
    expect(flat.flexDirection).toBe("row");
    expect(flat.paddingHorizontal).toBe(spacing.md);

    // The rail does NOT scale with the monitor; the workspace absorbs it.
    const host = hostWithTestId(r, "stay-suite-shell-desktop");
    const centered = host.props.children as React.ReactElement<{
      children: React.ReactElement[];
    }>;
    const railHost = centered.props.children[0];
    const workspaceHost = centered.props.children[1];
    expect(
      (sortedFlat((railHost.props as { style?: unknown }).style) ?? {}).width,
    ).toBe(venueRailWidth);
    expect(
      (sortedFlat((workspaceHost.props as { style?: unknown }).style) ?? {})
        .flex,
    ).toBe(1);

    // The Overview body is uncapped at this width too — no dead right gutter.
    expect(pageMeasure(r)?.maxWidth).toBeUndefined();
  });

  it("A-7 — an orientation flip across the line swaps layouts cleanly, both ways", async () => {
    // Portrait tablet -> landscape -> back. Same mounted component identity is
    // not preserved by react-test-renderer across `create`, so this asserts the
    // round trip leaves NO orphaned pill row and NO doubled nav at either end.
    const widths = [768, 1366, 768, 1024, 1023];
    const expectRail = [false, true, false, true, false];
    for (let i = 0; i < widths.length; i += 1) {
      mockViewportWidth = widths[i];
      const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
      const railCount = testIdsMatching(r, /^stay-rail-/).length;
      const pillCount = testIdsMatching(r, /^stay-module-/).length;
      // Exactly ONE navigation affordance at every width — never both.
      expect(railCount > 0 && pillCount > 0).toBe(false);
      expect(railCount > 0).toBe(expectRail[i]);
      expect(pillCount > 0).toBe(!expectRail[i]);
      // The outer shell root survives every crossing.
      expect(hostWithTestId(r, "stay-suite-shell")).toBeTruthy();
      r.unmount();
    }
  });
});

// ===========================================================================
// GROUP B — rail <-> workspace interaction and accessibility.
// ===========================================================================
describe("#1484 B — the stay rail drives the workspace", () => {
  it("B-1 — the rail is a tablist of tabs and every stay-rail-* testID resolves", async () => {
    mockViewportWidth = 1440;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);

    const host = hostWithTestId(r, "stay-suite-shell-desktop");
    const centered = host.props.children as React.ReactElement<{
      children: React.ReactElement[];
    }>;
    const railHost = centered.props.children[0];
    expect(
      (railHost.props as { accessibilityRole?: string }).accessibilityRole,
    ).toBe("tablist");

    for (const id of STAY_MODULE_IDS) {
      const row = hostWithTestId(r, `stay-rail-${id}`);
      expect(row.props.accessibilityRole).toBe("tab");
      expect(typeof row.props.accessibilityLabel).toBe("string");
      expect(pressableWithTestId(r, `stay-rail-${id}`)).toBeTruthy();
    }
  });

  it("B-2 — selecting EACH module swaps the workspace and moves the active state", async () => {
    mockViewportWidth = 1440;
    const bodyProbe: Record<(typeof STAY_MODULE_IDS)[number], RegExp> = {
      overview: /^stay-check-basics$/,
      rooms_places: /^stay-inventory-list-scroll$/,
      availability_pricing: /^stay-inventory-list-scroll$/,
      reservations: /^stay-reservations-module$/,
      menu: /^stub-menu$/,
      settings: /^stay-settings-summary$/,
    };

    for (const target of STAY_MODULE_IDS) {
      const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
      if (target !== "overview") {
        await press(pressableWithTestId(r, `stay-rail-${target}`));
      }

      // 1. The workspace now shows THAT module's body.
      expect(testIdsMatching(r, bodyProbe[target]).length).toBeGreaterThan(0);

      // 2. Exactly one rail row is selected — and it is the one pressed.
      const selected = STAY_MODULE_IDS.filter((id) => {
        const state = hostWithTestId(r, `stay-rail-${id}`).props
          .accessibilityState as { selected?: boolean } | undefined;
        return state?.selected === true;
      });
      expect(selected).toEqual([target]);

      // 3. The 3px accent active bar is rendered exactly once (it is the only
      //    absolutely-positioned 3px-wide child inside the rail).
      const bars = nodes(r).filter((node) => {
        if (typeof node.type !== "string") return false;
        const flat = sortedFlat(node.props.style);
        return (
          flat !== null && flat.position === "absolute" && flat.width === 3
        );
      });
      expect(bars).toHaveLength(1);

      r.unmount();
    }
  });

  it("B-3 — the rail order matches the pill-row order exactly (one module registry)", async () => {
    mockViewportWidth = 1440;
    const desktop = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const railOrder = testIdsMatching(desktop, /^stay-rail-/).map((id) =>
      id.replace("stay-rail-", ""),
    );
    desktop.unmount();

    mockViewportWidth = 390;
    const phone = await mount(<StaySuiteShell {...STAY_PROPS} />);
    const pillOrder = testIdsMatching(phone, /^stay-module-/).map((id) =>
      id.replace("stay-module-", ""),
    );

    expect(railOrder).toEqual(pillOrder);
    expect(railOrder).toEqual([...STAY_MODULE_IDS]);
  });
});

// ===========================================================================
// GROUP C — the form-vs-table distinction, at the REAL boundary.
// ===========================================================================
describe("#1484 C — forms stay readable while their lists fill the workspace", () => {
  it("C-1 — at exactly 1024px the Settings FORM and the Rooms LIST differ", async () => {
    mockViewportWidth = WIDE_DESKTOP_MIN_WIDTH;

    const settingsTree = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(settingsTree, "stay-rail-settings"));
    const formMeasure = pageMeasure(settingsTree);
    settingsTree.unmount();

    const listTree = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(listTree, "stay-rail-rooms_places"));
    const listScroll = hostWithTestId(listTree, "stay-inventory-list-scroll");
    const listMeasure = sortedFlat(listScroll.props.contentContainerStyle);

    // The form is capped to a readable measure...
    expect(formMeasure?.maxWidth).toBe(suiteFormMaxWidth);
    // ...the list is not.
    expect(listMeasure?.maxWidth).toBeUndefined();
    // ...and they GENUINELY differ (the point of the design).
    expect(formMeasure?.maxWidth).not.toEqual(listMeasure?.maxWidth);
    // Both share the left anchor so they line up under the rail seam.
    expect(formMeasure?.alignSelf).toBe("flex-start");
    expect(listMeasure?.alignSelf).toBe("flex-start");
    // The cap must actually BITE at the narrowest desktop width, otherwise it
    // is decorative: 720 < 1024 - rail(220) - gutters.
    expect(suiteFormMaxWidth).toBeLessThan(WIDE_DESKTOP_MIN_WIDTH);
    expect(formMeasure?.maxWidth as number).toBeLessThan(
      WIDE_DESKTOP_MIN_WIDTH - venueRailWidth,
    );
  });

  it("C-2 — one pixel below the boundary BOTH revert to today's centred measure", async () => {
    mockViewportWidth = WIDE_DESKTOP_MIN_WIDTH - 1;

    const settingsTree = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(settingsTree, "stay-module-settings"));
    const formMeasure = pageMeasure(settingsTree);
    expect(formMeasure?.maxWidth).toBe(stayPageMaxWidth);
    expect(formMeasure?.alignSelf).toBe("center");
    settingsTree.unmount();

    const listTree = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(listTree, "stay-module-rooms_places"));
    const listMeasure = sortedFlat(
      hostWithTestId(listTree, "stay-inventory-list-scroll").props
        .contentContainerStyle,
    );
    expect(listMeasure?.maxWidth).toBe(stayInventoryMaxWidth);
    expect(listMeasure?.alignSelf).toBe("center");
  });

  it("C-3 — the embedded OfferingEditor FORM is capped where its own list is not", async () => {
    mockViewportWidth = 1440;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    await press(pressableWithTestId(r, "stay-rail-rooms_places"));

    const listMeasure = sortedFlat(
      hostWithTestId(r, "stay-inventory-list-scroll").props
        .contentContainerStyle,
    );
    expect(listMeasure?.maxWidth).toBeUndefined();

    // Enter the editor through the operator's real path.
    await press(pressableWithTestId(r, "stay-inventory-add"));
    const editorMeasure = sortedFlat(
      hostWithTestId(r, "stay-offering-editor-scroll").props
        .contentContainerStyle,
    );
    expect(editorMeasure?.maxWidth).toBe(suiteFormMaxWidth);
    expect(editorMeasure?.alignSelf).toBe("flex-start");

    // The list is gone while the editor is open, and the two measures differ.
    expect(editorMeasure?.maxWidth).not.toEqual(listMeasure?.maxWidth);
  });
});

// ===========================================================================
// GROUP D — RESTAURANT non-regression, whole tree, every module.
// ===========================================================================
describe("#1484 D — the venue (restaurant) suite renders byte-identically", () => {
  it("D-1 — unaffected desktop HOST trees match the pre-extraction golden", async () => {
    mockViewportWidth = 1440;
    const actual = await venueFingerprints();

    if (process.env.ISSUE1484_PRINT_GOLDEN === "1") {
      console.log(`__GOLDEN_DESKTOP__${JSON.stringify(actual)}__END__`);
    }

    expect(Object.keys(actual).sort()).toEqual([...VENUE_MODULE_IDS].sort());
    for (const moduleId of VENUE_MODULE_IDS.filter(
      (id) => id !== "reservations",
    )) {
      // Compared per module so a failure names the module that drifted.
      expect(`${moduleId}:${actual[moduleId]}`).toEqual(
        `${moduleId}:${GOLDEN.desktop[moduleId]}`,
      );
    }
  });

  it("D-2 — the scroll-ownership contract still holds per module", async () => {
    // Overview and Reservations own their vertical scrolling, so the shell
    // must not add a second same-axis ScrollView. Unaffected modules retain
    // the shell-owned ScrollView and `insets.bottom + 120` clearance.
    mockViewportWidth = 1440;
    for (const moduleId of VENUE_MODULE_IDS) {
      const r = await mount(
        <VenueSuiteShell brandId="brand-test" venueId="venue-test" />,
      );
      if (moduleId !== "overview") {
        await press(pressableWithTestId(r, `venue-rail-${moduleId}`));
      }
      const host = hostWithTestId(r, "venue-suite-shell-desktop");
      const centered = host.props.children as React.ReactElement<{
        children: React.ReactElement[];
      }>;
      const workspace = centered.props.children[1];
      const workspaceKids = (
        workspace.props as { children?: React.ReactElement }
      ).children;
      const wrapper = workspaceKids as React.ReactElement<{
        contentContainerStyle?: unknown;
      }>;
      const wrapsInScroll =
        wrapper?.props?.contentContainerStyle !== undefined;

      if (moduleId === "overview" || moduleId === "reservations") {
        expect(wrapsInScroll).toBe(false);
      } else {
        expect(wrapsInScroll).toBe(true);
        expect(
          (sortedFlat(wrapper.props.contentContainerStyle) ?? {}).paddingBottom,
        ).toBe(venueScrollBottomPad(0));
      }
      r.unmount();
    }
  });

  it("D-3 — the venue PHONE branch is untouched by the extraction", async () => {
    mockViewportWidth = 1023;
    const actual = await venuePhoneFingerprints();

    if (process.env.ISSUE1484_PRINT_GOLDEN === "1") {
      console.log(`__GOLDEN_PHONE__${JSON.stringify(actual)}__END__`);
    }

    for (const moduleId of ["overview", "settings"] as const) {
      expect(`${moduleId}:${actual[moduleId]}`).toEqual(
        `${moduleId}:${GOLDEN.phone[moduleId]}`,
      );
    }

    const r = await mount(
      <VenueSuiteShell brandId="brand-test" venueId="venue-test" />,
    );
    expect(hostWithTestId(r, "venue-suite-shell-phone")).toBeTruthy();
    expect(testIdsMatching(r, /^venue-rail-/)).toHaveLength(0);
  });

  it("D-4 — the golden was captured from a real pre-extraction commit", () => {
    // Guards against a future 'just re-record the golden' fix that would make
    // D-1/D-3 vacuous: the golden must name the origin/main commit it came from
    // and must contain the venue desktop host and all seven rail rows.
    expect(GOLDEN.capturedFrom).toMatch(/^[0-9a-f]{9,40}$/);
    expect(GOLDEN.phone.overview).toContain("venue-suite-shell-phone");
    expect(GOLDEN.phone.settings).toContain("venue-suite-shell-phone");
    for (const moduleId of VENUE_MODULE_IDS) {
      expect(GOLDEN.desktop[moduleId]).toContain("venue-suite-shell-desktop");
      expect(GOLDEN.desktop[moduleId]).toContain('"accessibilityRole":"tablist"');
      for (const rowId of VENUE_MODULE_IDS) {
        expect(GOLDEN.desktop[moduleId]).toContain(`venue-rail-${rowId}`);
      }
    }
  });
});
