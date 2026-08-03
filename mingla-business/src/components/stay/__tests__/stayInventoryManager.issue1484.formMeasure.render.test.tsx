/**
 * Issue #1484 [stay-desktop-shell] — orchestrator REVIEW follow-up:
 * FORM MEASURE vs LIST WIDTH inside `StayInventoryManager`.
 *
 * THE RULE BEING PINNED (approved design artifact): "'Fill the screen' is right
 * for tables and wrong for forms — a text field stretched to 2,000px is
 * unusable." `StayInventoryManager` renders BOTH shapes from the same
 * `styles.page` base:
 *
 *   - the Rooms & Places / Availability & pricing LIST  → UNCAPPED on wide
 *     desktop, left-anchored (it is table/list content and should fill the
 *     shared SuiteDesktopShell workspace);
 *   - the embedded `OfferingEditor` FORM                → capped at
 *     `suiteFormMaxWidth`, left-anchored (same treatment as Stay Settings).
 *
 * The DISTINCTION is the whole point, so both halves are asserted together —
 * collapsing the editor back onto the list's `pageWide` (or the list onto the
 * editor's `pageForm`) must fail this suite.
 *
 * Phone / native (<1024px) keeps today's exact centred `stayInventoryMaxWidth`
 * measure for BOTH, unchanged.
 *
 * FAILS-ON-REVERT: switching the `OfferingEditor` ScrollView's desktop style
 * from `styles.pageForm` back to `styles.pageWide` (a true line edit, not a
 * comment-out) flips F-2 — the editor resolves to `maxWidth: undefined` where
 * `suiteFormMaxWidth` is required.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * RENDERER: `react-test-renderer` via the repo's `require(...) as {…}` idiom
 * (same form as the ListingInsightsScreen.issue1403 render suites). Load-
 * bearing for the issue-1403 typecheck-delta gate — a bare `import` of an
 * untyped/absent renderer adds a TS7016/TS2307 diagnostic under a clean
 * `npm ci`, and that gate fails on ANY added diagnostic.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1484.render.cjs --runInBand
 */

import React from "react";
import { StyleSheet } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
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
// Desktop gate — flipped per test; read at RENDER time.
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
    },
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
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});

// react-query: the module only needs a client + mutation objects; no network.
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
  useMutation: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
  }),
}));

// Service layers are import-time supabase-client chains — stub the boundary.
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

jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: {
    all: ["stay-inventory"],
    venue: (venueId: string) => ["stay-inventory", venueId],
  },
  useStayInventory: () => ({
    data: {
      settings: null,
      offerings: [],
      permissions: { canManageInventory: true, canManageFinance: true },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
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

import {
  stayInventoryMaxWidth,
  suiteFormMaxWidth,
} from "../../../constants/designSystem";
import { StayInventoryManager } from "../StayInventoryManager";

type Flat = Record<string, unknown>;


const PROPS = {
  brandId: "brand-1484",
  venueId: "venue-1484",
  mode: "inventory" as const,
};

const nodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

/** REAL flattened contentContainerStyle of a ScrollView, by testID. */
function scrollMeasure(tree: RenderTree, testID: string): Flat {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      candidate.props?.contentContainerStyle !== undefined,
  );
  expect(node).toBeDefined();
  return (StyleSheet.flatten(
    (node as RenderTreeNode).props.contentContainerStyle as never,
  ) ?? {}) as Flat;
}

/** Distinct testIDs matching `pattern` (deduped). */
function testIdsMatching(tree: RenderTree, pattern: RegExp): string[] {
  const seen = new Set<string>();
  for (const node of nodes(tree)) {
    const id = node.props?.testID;
    if (typeof id === "string" && pattern.test(id)) seen.add(id);
  }
  return [...seen];
}

/** Press the Pressable/Button carrying `testID`, flushing the state update. */
async function pressByTestId(tree: RenderTree, testID: string): Promise<void> {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onPress === "function",
  );
  expect(node).toBeDefined();
  await TestRenderer.act(() => {
    ((node as RenderTreeNode).props.onPress as () => void)();
  });
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1484 — Stay inventory: list fills, embedded form keeps its measure", () => {
  it("F-1 — desktop: the Rooms & Places LIST is UNCAPPED and left-anchored", async () => {
    mockIsWideDesktop = true;
    const r = await mount(<StayInventoryManager {...PROPS} />);
    const list = scrollMeasure(r, "stay-inventory-list-scroll");

    expect(list.maxWidth).toBeUndefined();
    expect(typeof list.maxWidth).not.toBe("number");
    expect(list.alignSelf).toBe("flex-start");
  });

  it("F-2 — desktop: the embedded OfferingEditor FORM is capped at suiteFormMaxWidth", async () => {
    mockIsWideDesktop = true;
    const r = await mount(<StayInventoryManager {...PROPS} />);

    // Enter the editor — the same path an operator takes from the list.
    await pressByTestId(r, "stay-inventory-add");

    const form = scrollMeasure(r, "stay-offering-editor-scroll");
    expect(form.maxWidth).toBe(suiteFormMaxWidth);
    expect(form.alignSelf).toBe("flex-start");

    // ...and the list is no longer mounted, so the two never disagree on screen.
    expect(
      testIdsMatching(r, /^stay-inventory-list-scroll$/),
    ).toHaveLength(0);
  });

  it("F-3 — desktop: form and list measures are DIFFERENT (the distinction holds)", async () => {
    mockIsWideDesktop = true;
    const listTree = await mount(<StayInventoryManager {...PROPS} />);
    const list = scrollMeasure(listTree, "stay-inventory-list-scroll");
    listTree.unmount();

    const formTree = await mount(<StayInventoryManager {...PROPS} />);
    await pressByTestId(formTree, "stay-inventory-add");
    const form = scrollMeasure(formTree, "stay-offering-editor-scroll");

    expect(form.maxWidth).not.toEqual(list.maxWidth);
    expect(form.maxWidth).toBe(suiteFormMaxWidth);
    expect(list.maxWidth).toBeUndefined();
    // Both stay left-anchored against the shared workspace's rail seam.
    expect(form.alignSelf).toBe("flex-start");
    expect(list.alignSelf).toBe("flex-start");
  });

  it("F-4 — phone: BOTH keep today's centred measure (native unaffected)", async () => {
    mockIsWideDesktop = false;

    const listTree = await mount(<StayInventoryManager {...PROPS} />);
    const list = scrollMeasure(listTree, "stay-inventory-list-scroll");
    expect(list.maxWidth).toBe(stayInventoryMaxWidth);
    expect(list.alignSelf).toBe("center");
    listTree.unmount();

    const formTree = await mount(<StayInventoryManager {...PROPS} />);
    await pressByTestId(formTree, "stay-inventory-add");
    const form = scrollMeasure(formTree, "stay-offering-editor-scroll");
    expect(form.maxWidth).toBe(stayInventoryMaxWidth);
    expect(form.alignSelf).toBe("center");
  });
});
