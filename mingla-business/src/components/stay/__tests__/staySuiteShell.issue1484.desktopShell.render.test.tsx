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
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: (selector: (s: { sync: () => void }) => unknown) =>
    selector({ sync: () => undefined }),
}));

// ---- Workspace module bodies — stubbed; this suite asserts on the SHELL. ----
const stub = (id: string): (() => React.ReactElement) => {
  const Stub = (): React.ReactElement => (
    <Text testID={`stub-${id}`}>{id}</Text>
  );
  Stub.displayName = `Stub_${id}`;
  return Stub;
};
jest.mock("../StayInventoryManager", () => ({
  StayInventoryManager: stub("inventory"),
}));
jest.mock("../StayReservationsModule", () => ({
  StayReservationsModule: stub("reservations"),
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
jest.mock("../../venue/VenueReservationsModule", () => ({
  VenueReservationsModule: stub("venue-reservations"),
}));
jest.mock("../../venue/VenueWaitlistModule", () => ({
  VenueWaitlistModule: stub("waitlist"),
}));

import {
  spacing,
  stayPageMaxWidth,
  suiteFormMaxWidth,
  venueRailWidth,
} from "../../../constants/designSystem";
import { StaySuiteShell } from "../StaySuiteShell";
import { VenueSuiteShell } from "../../venue/VenueSuiteShell";

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
      )?.paddingBottom !== undefined,
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
    .find((flat: Flat) => flat.paddingBottom !== undefined);
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
  "menu",
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
        (node.props.testID as string).startsWith(prefix),
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
      "Menus",
      "Settings",
    ]);
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
    expect(flat.paddingHorizontal).toBe(spacing.md);

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
    overview.unmount();
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
    expect(rowIds.size).toBe(7);
  });

  it("T-3c — phone: NO grid wrapper (host tree byte-identical to today)", async () => {
    mockIsWideDesktop = false;
    const r = await mount(<StaySuiteShell {...STAY_PROPS} />);
    expect(testIdsMatching(r, /^stay-readiness-grid$/)).toHaveLength(0);
    // The rows still render — they are just emitted as a bare fragment.
    expect(testIdsMatching(r, /^stay-check-/)).toHaveLength(7);
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
      "Settings",
    ]);

    const flat = centeredStyle(r, "venue-suite-shell-desktop");
    expect(typeof flat.maxWidth).not.toBe("number");
    expect(flat.maxWidth).toBeUndefined();
    expect(flat.alignSelf).toBe("flex-start");
    expect(flat.paddingHorizontal).toBe(spacing.md);
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
