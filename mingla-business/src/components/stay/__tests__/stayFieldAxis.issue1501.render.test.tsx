/**
 * Issue #1501 [add-rooms-form] — THE AXIS-SCOPED FIELD MEASURE PROOF.
 *
 * WHAT SHIPPED BROKEN (twice now):
 *
 *   field: { flex: 1, minWidth: 140, gap: spacing.xs }   // <- DELETED
 *
 * ONE style, applied under TWO different `flexDirection` contexts. Inside
 * `styles.twoCol` (a ROW) `flex: 1` correctly means "share the WIDTH". Stacked
 * directly in `styles.form` (a COLUMN, RN's default) the identical declaration
 * means "share the HEIGHT" — so every field was told to take an equal share of
 * the container height, a field whose input carries `minHeight: 96` rendered
 * taller than its allotted box, overflowed its own `View`, and the NEXT field's
 * label painted on top of it. That is the overlap Seth reported: "Description"
 * running under the Amenities label, "Cancellation policy" under No-show.
 *
 * It is the SAME bug class as #1484's readiness grid, where `flexBasis: 320`
 * was authored for a row and silently resolved against the column axis.
 *
 * THE CONTRACT (spec §1 / invariant I-AXIS-SCOPED-FLEX): a StyleSheet entry
 * carrying any flex-axis key must be applied under exactly ONE `flexDirection`
 * context, and its name must declare which. `LabeledInput` therefore takes a
 * REQUIRED `span` prop, and the three measures are complete, mutually exclusive
 * objects that are SELECTED, never layered:
 *
 *   stack -> `fieldStack` : NO flex-axis key at all (column context)
 *   pair  -> `fieldPair`  : flexGrow 1 / flexShrink 1 / flexBasis 0 (row)
 *   num   -> `fieldNum`   : flexGrow 0, explicit flexBasis (row)
 *
 * These assertions read the RESOLVED style of the rendered field WRAPPER, not
 * the source text — reintroducing `styles.field` (or adding a flex key to
 * `fieldStack`) flips A-1/A-2 whatever the entry is called.
 *
 * FAILS-ON-REVERT: restore `fieldStack` to `{ flex: 1, minWidth: 140, gap }`
 * (a true line edit) -> A-1 and A-2 FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1501.render.cjs --runInBand
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

async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  expect(tree).not.toBeNull();
  return tree as unknown as RenderTree;
}

let mockIsWideDesktop = true;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: true,
    width: mockIsWideDesktop ? 1440 : 390,
  }),
}));

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
  return {
    __esModule: true,
    ScrollView: RN.ScrollView,
    default: RN.ScrollView,
  };
});
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
    detail: (venueId: string) => ["stay-inventory", venueId],
  },
  useStayInventory: () => ({
    data: {
      settings: null,
      offerings: [],
      permissions: { canManageInventory: true, canManageFinance: true },
    },
    isLoading: false,
    isPending: false,
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
  spacing,
  stayFieldNumMaxWidth,
  stayProseMaxWidth,
} from "../../../constants/designSystem";
import { StayInventoryManager } from "../StayInventoryManager";

type Flat = Record<string, unknown>;

const PROPS = {
  brandId: "brand-1501",
  venueId: "venue-1501",
  mode: "inventory" as const,
};

/** EVERY key that resolves against a flex container's MAIN axis. */
const FLEX_AXIS_KEYS = [
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
] as const;

const nodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

/** Flattened style of the node carrying `testID` (deduped by identity). */
function styleFor(tree: RenderTree, testID: string): Flat {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID && candidate.props?.style !== undefined,
  );
  expect(node).toBeDefined();
  return (StyleSheet.flatten((node as RenderTreeNode).props.style as never) ??
    {}) as Flat;
}

function has(flat: Flat, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(flat, key);
}

async function openEditor(): Promise<RenderTree> {
  const tree = await mount(<StayInventoryManager {...PROPS} />);
  const add = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === "stay-inventory-add" &&
      typeof candidate.props?.onPress === "function",
  );
  expect(add).toBeDefined();
  await TestRenderer.act(() => {
    ((add as RenderTreeNode).props.onPress as () => void)();
  });
  return tree;
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1501 — field measures are axis-scoped (I-AXIS-SCOPED-FLEX)", () => {
  it("A-1 — every STACKED field resolves with NO flex-axis key at all", async () => {
    const tree = await openEditor();

    // Every field that is stacked directly in the form column. This is the
    // exact population the deleted `styles.field` poisoned.
    const stacked = [
      "stay-offering-name",
      "stay-offering-description",
      "stay-offering-amenities",
      "stay-offering-fee-label",
      "stay-offering-policy",
    ];

    // Vacuity guard: if the wrappers stopped rendering (or the `-field` suffix
    // changed) every assertion below would pass over an empty set.
    expect(stacked.length).toBeGreaterThan(0);

    for (const testID of stacked) {
      const flat = styleFor(tree, `${testID}-field`);
      // The wrapper really is the field wrapper, not some unrelated View.
      expect(flat.gap).toBe(spacing.xs);
      for (const key of FLEX_AXIS_KEYS) {
        expect({ testID, key, present: has(flat, key) }).toEqual({
          testID,
          key,
          present: false,
        });
      }
      // Stacked fields own the full column width instead of fighting for it.
      expect(flat.width).toBe("100%");
      expect(flat.minWidth).toBe(0);
    }
  });

  it("A-2 — `styles.field`'s exact shape can never come back", async () => {
    const tree = await openEditor();
    const wrappers = nodes(tree)
      .filter(
        (candidate) =>
          typeof candidate.props?.testID === "string" &&
          (candidate.props.testID as string).endsWith("-field") &&
          candidate.props?.style !== undefined,
      )
      .map(
        (candidate) =>
          (StyleSheet.flatten(candidate.props.style as never) ?? {}) as Flat,
      );

    // Vacuity guard.
    expect(wrappers.length).toBeGreaterThanOrEqual(5);

    // The deleted entry was `{ flex: 1, minWidth: 140, gap: spacing.xs }`.
    // NOTHING may resolve to a bare `flex: 1` — that is the shorthand whose
    // meaning silently changes with the parent's `flexDirection`.
    for (const flat of wrappers) {
      expect(has(flat, "flex")).toBe(false);
    }
  });

  it("A-3 — NUMERIC fields inside a row declare an EXPLICIT measure", async () => {
    const tree = await openEditor();
    const numeric = ["stay-offering-quantity", "stay-offering-guests"];
    expect(numeric.length).toBeGreaterThan(0);

    for (const testID of numeric) {
      const flat = styleFor(tree, `${testID}-field`);
      // `flex: 1` on every sibling is not a layout (SPEC AMENDMENT 1): the
      // measure is still EXPLICIT, it is just expressed as a CAP over a zero
      // basis rather than as the basis itself.
      //
      // [TEST-MOD-APPROVED #1501] — retuned for the P2-2 phone-pair fix. A
      // `flexBasis` of the desktop width made `flexWrap` break the line before
      // any shrinking, so both numeric pairs stacked on every phone. The
      // contract this pins genuinely changed; it was not weakened. The
      // stricter call-site assertion lives in
      // `stayFieldCallSites.issue1501.render.test.tsx` (C-3/C-4).
      expect(flat.flexBasis).toBe(0);
      expect(flat.maxWidth).toBe(stayFieldNumMaxWidth);
      expect(flat.flexGrow).toBe(1);
      expect(has(flat, "flex")).toBe(false);
    }
  });

  it("A-4 — the row wrapper WRAPS and TOP-ALIGNS its children", async () => {
    const tree = await openEditor();
    const row = styleFor(tree, "stay-offering-count-row");
    expect(row.flexDirection).toBe("row");
    expect(row.flexWrap).toBe("wrap");
    // Load-bearing: RN's default `stretch` makes every child as tall as the
    // tallest sibling — the second-order version of the same overlap bug.
    expect(row.alignItems).toBe("flex-start");
  });

  it("A-5 — PROSE inputs are capped at the readable measure", async () => {
    const tree = await openEditor();
    const description = styleFor(tree, "stay-offering-description");
    expect(description.maxWidth).toBe(stayProseMaxWidth);
    expect(description.minHeight).toBe(96);
    // A single-line field is NOT capped — the cap belongs to prose only.
    const name = styleFor(tree, "stay-offering-name");
    expect(has(name, "maxWidth")).toBe(false);
  });

  it("A-6 — phone keeps the same axis discipline (native is not a special case)", async () => {
    mockIsWideDesktop = false;
    const tree = await openEditor();
    const flat = styleFor(tree, "stay-offering-description-field");
    for (const key of FLEX_AXIS_KEYS) {
      expect(has(flat, key)).toBe(false);
    }
  });
});
