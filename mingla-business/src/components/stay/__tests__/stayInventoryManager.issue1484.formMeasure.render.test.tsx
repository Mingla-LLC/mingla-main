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
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1484.render.cjs --runInBand
 */

import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

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

/**
 * Minimal shape of a react-test-renderer instance. `@types/react-test-renderer`
 * is not installed (the renderer is a --no-save test-only dep), so annotate the
 * traversal callback explicitly rather than inherit `any`.
 */
interface RenderNode {
  type: unknown;
  props: Record<string, unknown>;
}

const PROPS = {
  brandId: "brand-1484",
  venueId: "venue-1484",
  mode: "inventory" as const,
};

/** REAL flattened contentContainerStyle of a ScrollView, by testID. */
function scrollMeasure(
  tree: ReturnType<typeof render>,
  testID: string,
): Flat {
  const all = tree.UNSAFE_root.findAll(() => true) as unknown as RenderNode[];
  const node = all.filter(
    (candidate) =>
      candidate.props?.testID === testID &&
      candidate.props?.contentContainerStyle !== undefined,
  )[0];
  expect(node).toBeDefined();
  return (StyleSheet.flatten(
    node.props.contentContainerStyle as never,
  ) ?? {}) as Flat;
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1484 — Stay inventory: list fills, embedded form keeps its measure", () => {
  it("F-1 — desktop: the Rooms & Places LIST is UNCAPPED and left-anchored", () => {
    mockIsWideDesktop = true;
    const r = render(<StayInventoryManager {...PROPS} />);
    const list = scrollMeasure(r, "stay-inventory-list-scroll");

    expect(list.maxWidth).toBeUndefined();
    expect(typeof list.maxWidth).not.toBe("number");
    expect(list.alignSelf).toBe("flex-start");
  });

  it("F-2 — desktop: the embedded OfferingEditor FORM is capped at suiteFormMaxWidth", () => {
    mockIsWideDesktop = true;
    const r = render(<StayInventoryManager {...PROPS} />);

    // Enter the editor — the same path an operator takes from the list.
    fireEvent.press(r.getByTestId("stay-inventory-add"));

    const form = scrollMeasure(r, "stay-offering-editor-scroll");
    expect(form.maxWidth).toBe(suiteFormMaxWidth);
    expect(form.alignSelf).toBe("flex-start");

    // ...and the list is no longer mounted, so the two never disagree on screen.
    expect(r.queryByTestId("stay-inventory-list-scroll")).toBeNull();
  });

  it("F-3 — desktop: form and list measures are DIFFERENT (the distinction holds)", () => {
    mockIsWideDesktop = true;
    const listTree = render(<StayInventoryManager {...PROPS} />);
    const list = scrollMeasure(listTree, "stay-inventory-list-scroll");
    listTree.unmount();

    const formTree = render(<StayInventoryManager {...PROPS} />);
    fireEvent.press(formTree.getByTestId("stay-inventory-add"));
    const form = scrollMeasure(formTree, "stay-offering-editor-scroll");

    expect(form.maxWidth).not.toEqual(list.maxWidth);
    expect(form.maxWidth).toBe(suiteFormMaxWidth);
    expect(list.maxWidth).toBeUndefined();
    // Both stay left-anchored against the shared workspace's rail seam.
    expect(form.alignSelf).toBe("flex-start");
    expect(list.alignSelf).toBe("flex-start");
  });

  it("F-4 — phone: BOTH keep today's centred measure (native unaffected)", () => {
    mockIsWideDesktop = false;

    const listTree = render(<StayInventoryManager {...PROPS} />);
    const list = scrollMeasure(listTree, "stay-inventory-list-scroll");
    expect(list.maxWidth).toBe(stayInventoryMaxWidth);
    expect(list.alignSelf).toBe("center");
    listTree.unmount();

    const formTree = render(<StayInventoryManager {...PROPS} />);
    fireEvent.press(formTree.getByTestId("stay-inventory-add"));
    const form = scrollMeasure(formTree, "stay-offering-editor-scroll");
    expect(form.maxWidth).toBe(stayInventoryMaxWidth);
    expect(form.alignSelf).toBe("center");
  });
});
