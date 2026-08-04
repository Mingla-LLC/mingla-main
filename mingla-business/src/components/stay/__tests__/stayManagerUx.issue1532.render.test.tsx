/**
 * Issue #1532 [stay-manager-ux] — the RENDERED proofs for all four defects.
 *
 * `stayLayoutContracts.issue1532.test.ts` proves the CONTRACT is right. This
 * file proves the SHIPPED TREE actually applies it — which is a different
 * claim, and the one the last four regressions in this workstream all failed.
 *
 * Every assertion here reads a value off a mounted node. There is no "assert
 * the absence of X" without a matching positive control, no lookup without a
 * vacuity guard proving it matched something, and no style compared against
 * `undefined` (the #1484 P1-1 trap: `expect(flat.maxWidth).toBeUndefined()` was
 * true both when the cap was released AND when it silently survived).
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1532.render.cjs --runInBand
 */

import React from "react";
import { ScrollView as RNScrollView, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

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

// ---------------------------------------------------------------------------
// Desktop gate — flipped per test, read at RENDER time.
// ---------------------------------------------------------------------------
let mockIsWideDesktop = false;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: false,
    width: mockIsWideDesktop ? 1440 : 390,
  }),
}));

/**
 * THE KEYBOARD MARKER.
 *
 * `SmartScrollView` is the wrapper that IS `KeyboardAwareScrollView` on native
 * — the component that injected a keyboard-height spacer as a ROW ITEM and blew
 * the pill row from 36.7pt to 323.7pt. Mocking it as a MARKER component turns
 * "does this chrome carry keyboard plumbing?" into a question a render test can
 * answer by looking, instead of a source-text grep that can miss a rename.
 *
 * Reverting `StayChipRow` to import from the wrapper makes the marker appear
 * and the assertions below go red. That is the fails-on-revert path.
 */
const KEYBOARD_AWARE_MARKER = "issue-1532-keyboard-aware-scrollview";
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  // The marker string is a LITERAL, not a reference: `jest.mock` factories are
  // hoisted above the imports, so a module-scope const would be in its temporal
  // dead zone when the first `require` of this module runs.
  const Marked = (props: Record<string, unknown>): unknown =>
    ReactLocal.createElement(RN.ScrollView, {
      ...props,
      "issue-1532-keyboard-aware-scrollview": true,
    });
  return { __esModule: true, ScrollView: Marked, default: Marked };
});

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
      in: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: () => 0,
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
  };
});

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

/**
 * BOUNDARY STUBS for modules this suite does not assert on. `VenueMenuModule`
 * reaches `useCurrentBrand -> AuthContext -> expo-constants`, which needs
 * expo-modules-core's native EventEmitter; the reservations detail reaches the
 * staff reservation hooks. Neither is a #1532 claim. Same treatment the #1484
 * desktop-shell suite already gives them.
 */
jest.mock("../../venue/VenueMenuModule", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  return {
    VenueMenuModule: (): unknown =>
      ReactLocal.createElement(RN.View, { testID: "stub-venue-menu" }),
  };
});
jest.mock("../StayReservationsModule", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  return {
    StayReservationsModule: (): unknown =>
      ReactLocal.createElement(RN.View, { testID: "stub-stay-reservations" }),
  };
});

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
    getQueryData: jest.fn(),
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
    venue: (venueId: string) => ["stay-inventory", venueId],
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
  usePublishStay: () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null }),
  useSaveStaySettings: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
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

import { spacing } from "../../../constants/designSystem";
import { GlassCard } from "../../ui/GlassCard";
import { PublicVenueReservationSheet } from "../../venue/PublicVenueReservationSheet";
import {
  reserveActionLabel,
  reserveSheetTitle,
} from "../../venue/venueReserveCopy";
import { StayChipRow } from "../StayChipRow";
import { StayInventoryManager } from "../StayInventoryManager";
import { StaySuiteShell } from "../StaySuiteShell";
import {
  STAY_CHIP_ROW_MAX_HEIGHT,
  STAY_FIELD_PROXIMITY_MIN_RATIO,
  STAY_SPACING,
  stayFieldProximity,
} from "../stayLayoutContracts";

type Flat = Record<string, unknown>;

const nodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

/**
 * HOST nodes only. `findAll` returns the composite element AND its host output,
 * so an un-filtered count reports 2-4 for a single on-screen box and every
 * "exactly one" assertion becomes noise rather than a contract.
 */
const hostNodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll((node) => typeof node.type === "string");

function byTestId(tree: RenderTree, testID: string): RenderTreeNode[] {
  return hostNodes(tree).filter((node) => node.props?.testID === testID);
}

/**
 * The COMPOSITE element carrying `testID` — the one whose props hold
 * `contentContainerStyle` / `keyboardShouldPersistTaps`, which never reach the
 * host view. Asserted to exist, so the lookup can never be vacuous.
 */
function compositeByTestId(tree: RenderTree, testID: string): RenderTreeNode {
  const found = nodes(tree).filter(
    (node) =>
      node.props?.testID === testID &&
      node.props?.contentContainerStyle !== undefined,
  );
  expect({ testID, found: found.length > 0 }).toEqual({ testID, found: true });
  return found[0];
}

/** One node with `testID`, asserted to exist (this IS the vacuity guard). */
function oneByTestId(tree: RenderTree, testID: string): RenderTreeNode {
  const found = byTestId(tree, testID);
  expect({ testID, count: found.length }).toEqual({ testID, count: 1 });
  return found[0];
}

function flatten(style: unknown): Flat {
  return (StyleSheet.flatten(style as never) ?? {}) as Flat;
}

async function press(tree: RenderTree, testID: string): Promise<void> {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onPress === "function",
  );
  expect({ testID, pressable: node !== undefined }).toEqual({
    testID,
    pressable: true,
  });
  await TestRenderer.act(() => {
    ((node as RenderTreeNode).props.onPress as () => void)();
  });
}

function renderedText(tree: RenderTree): string {
  return hostNodes(tree)
    .filter((node) => node.type === "Text")
    .flatMap((node) => {
      const children = node.props?.children;
      return Array.isArray(children) ? children : [children];
    })
    .filter((value): value is string => typeof value === "string")
    .join(" | ");
}

beforeEach(() => {
  mockIsWideDesktop = false;
});

// ===========================================================================
// DEFECT 2 — the gap finally reaches the children.
// ===========================================================================

describe("#1532 D2 — GlassCard's gap lands on the node that parents children", () => {
  const CHILD_A = "issue-1532-card-child-a";
  const CHILD_B = "issue-1532-card-child-b";

  /** The node whose direct children are the card's children. */
  function contentNodeOf(tree: RenderTree): RenderTreeNode {
    const child = nodes(tree).find((node) => node.props?.testID === CHILD_A);
    expect(child).toBeDefined();
    // Walk the host tree and find the View whose children include CHILD_A.
    const parents = nodes(tree).filter((node) => {
      const kids = node.props?.children;
      const list = Array.isArray(kids) ? kids : [kids];
      return list.some(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          (candidate as { props?: { testID?: string } }).props?.testID ===
            CHILD_A,
      );
    });
    // Vacuity guard: we really found the parent, and exactly one of them.
    expect(parents.length).toBeGreaterThan(0);
    return parents[parents.length - 1];
  }

  it("D2-R1 — POSITIVE CONTROL: a gap on `style` never reaches the children", async () => {
    // This is the SHIPPED DEFECT, reproduced deliberately. `style` lands on
    // GlassChrome's outer node, whose only in-flow child is the clip view.
    const tree = await mount(
      <GlassCard variant="base" style={{ gap: 24 }} testID="probe">
        <View testID={CHILD_A} />
        <View testID={CHILD_B} />
      </GlassCard>,
    );
    const content = flatten(contentNodeOf(tree).props.style);
    // Vacuity guard: we are looking at the real content node (it has padding).
    expect(content.padding).toBe(spacing.md);
    // …and it carries NO gap, so the two children render flush. That is the bug.
    expect(content.gap).toBeUndefined();
    tree.unmount();
  });

  it("D2-R2 — a gap on `contentStyle` DOES reach the children", async () => {
    const tree = await mount(
      <GlassCard
        variant="base"
        contentStyle={{ gap: STAY_SPACING.fieldToFieldStacked }}
        testID="probe"
      >
        <View testID={CHILD_A} />
        <View testID={CHILD_B} />
      </GlassCard>,
    );
    const content = flatten(contentNodeOf(tree).props.style);
    expect(content.padding).toBe(spacing.md);
    expect(content.gap).toBe(STAY_SPACING.fieldToFieldStacked);
    tree.unmount();
  });

  it("D2-R3 — the SHIPPED editor renders separation:cohesion above the floor", async () => {
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );
    await press(tree, "stay-inventory-add");

    // COHESION — the real, rendered field wrapper gap.
    const field = oneByTestId(tree, "stay-offering-description-field");
    const fieldGap = flatten(field.props.style).gap;
    expect(typeof fieldGap).toBe("number");

    // SEPARATION — the real, rendered CONTENT-node gap of the card that holds
    // the stacked fields. Found by walking up from the field wrapper's card.
    const contentNodes = nodes(tree).filter((node) => {
      const style = flatten(node.props?.style);
      return (
        style.padding === spacing.md &&
        style.gap === STAY_SPACING.fieldToFieldStacked
      );
    });
    // VACUITY GUARD: at least one card really renders the stacked-field gap on
    // its content node. Without this, "the ratio is fine" could be computed
    // from a set of zero cards.
    expect(contentNodes.length).toBeGreaterThan(0);

    const measured = stayFieldProximity({
      fieldGap: fieldGap as number,
      stackGap: STAY_SPACING.fieldToFieldStacked,
    });
    expect(measured.ratio).toBeGreaterThanOrEqual(
      STAY_FIELD_PROXIMITY_MIN_RATIO,
    );
    expect(Number(measured.ratio.toFixed(2))).toBe(2.7);
    tree.unmount();
  });

  it("D2-R4 — no Stay card leaves a CONTENT-node layout key on `style`", async () => {
    // The footgun has now shipped TWICE (#1484 `flexDirection`, #1532 `gap`), so
    // it gets a mechanical guard rather than a third comment. This walks the
    // MOUNTED tree: any GlassChrome outer node carrying a key that can only
    // work on the content node is a finding.
    const CONTENT_ONLY_KEYS = [
      "gap",
      "rowGap",
      "columnGap",
      "flexDirection",
      "alignItems",
      "justifyContent",
      "flexWrap",
    ] as const;

    const offenders: string[] = [];
    let cardsSeen = 0;
    for (const wide of [false, true]) {
      mockIsWideDesktop = wide;
      const tree = await mount(
        <StaySuiteShell
          brandId="b"
          venueId="v"
          venueName="Mingla Stay"
          venueApproved
        />,
      );
      for (const node of nodes(tree)) {
        const style = flatten(node.props?.style);
        // A GlassChrome outer node is identifiable by its shadow + radius pair;
        // the CONTENT node is the one carrying `padding`.
        const isChrome =
          style.borderRadius !== undefined &&
          style.overflow === "visible" &&
          style.padding === undefined;
        if (!isChrome) continue;
        cardsSeen += 1;
        for (const key of CONTENT_ONLY_KEYS) {
          if (style[key] !== undefined) {
            offenders.push(`${String(node.props?.testID ?? "?")}.${key}`);
          }
        }
      }
      tree.unmount();
    }
    // VACUITY GUARD: the walk really found cards. An empty walk would make the
    // assertion below pass while proving nothing — the exact trap this suite
    // exists to avoid.
    expect(cardsSeen).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// DEFECT 4 — chrome carries no keyboard plumbing.
// ===========================================================================

describe("#1532 D4 — the keyboard cannot reach the Stay manager's chrome", () => {
  it("D4-R1 — POSITIVE CONTROL: the marker really does appear when used", async () => {
    // Proves the detector works. Without this arm, "no marker found" could mean
    // "the mock never applied" and the whole defect-4 proof would be vacuous —
    // an absence assertion over an empty set always passes.
    const { ScrollView: Smart } = require("../../../wrappers/SmartScrollView") as {
      ScrollView: React.ComponentType<Record<string, unknown>>;
    };
    const tree = await mount(
      <Smart testID="probe-smart">
        <View />
      </Smart>,
    );
    const marked = nodes(tree).filter(
      (node) => node.props?.[KEYBOARD_AWARE_MARKER] === true,
    );
    expect(marked.length).toBeGreaterThan(0);
    tree.unmount();
  });

  it("D4-R2 — StayChipRow uses a BARE scroller and centres its content", async () => {
    const tree = await mount(
      <StayChipRow testID="probe-row">
        <View testID="chip-1" />
        <View testID="chip-2" />
      </StayChipRow>,
    );
    // Vacuity guard: the chips actually rendered, so the tree is real.
    expect(byTestId(tree, "chip-1").length).toBe(1);

    // NO keyboard-aware scroller anywhere in this component.
    const marked = nodes(tree).filter(
      (node) => node.props?.[KEYBOARD_AWARE_MARKER] === true,
    );
    expect(marked.length).toBe(0);

    // …and a real RN ScrollView IS present, so the row still scrolls.
    const scrollers = nodes(tree).filter(
      (node) => node.type === RNScrollView || node.props?.horizontal === true,
    );
    expect(scrollers.length).toBeGreaterThan(0);

    const scroll = compositeByTestId(tree, "probe-row-scroll");
    const content = flatten(scroll.props.contentContainerStyle);
    // LOAD-BEARING: RN's default `stretch` is what turned a 324pt spacer into
    // 324pt pills. Centre-alignment makes a chip's height its own business.
    expect(content.alignItems).toBe("center");
    expect(content.flexDirection).toBe("row");
    // The dead first tap while typing (Constitution #1).
    expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
    tree.unmount();
  });

  it("D4-R3 — a caller CANNOT merge `alignItems` back to stretch", async () => {
    const tree = await mount(
      <StayChipRow
        testID="probe-row"
        contentStyle={{ alignItems: "stretch" } as ViewStyle}
      >
        <View testID="chip-1" />
      </StayChipRow>,
    );
    const content = flatten(compositeByTestId(tree, "probe-row-scroll").props
      .contentContainerStyle);
    expect(content.alignItems).toBe("center");
    tree.unmount();
  });

  it("D4-R4 — the module band is NOT a scroller, and shows all six modules", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StaySuiteShell
        brandId="b"
        venueId="v"
        venueName="Mingla Stay"
        venueApproved
      />,
    );
    const band = oneByTestId(tree, "stay-modules-band");

    // Every module is REACHABLE AT REST. Only 3 of 6 were before: Menus and
    // Settings needed a horizontal scroll with no affordance that more existed.
    const MODULE_IDS = [
      "overview",
      "rooms_places",
      "availability_pricing",
      "reservations",
      "menu",
      "settings",
    ];
    for (const id of MODULE_IDS) {
      expect({ id, count: byTestId(tree, `stay-module-${id}`).length }).toEqual({
        id,
        count: 1,
      });
    }

    // The band contains NO scroller of any kind — bare or keyboard-aware. A
    // horizontal scroller here is what accepted the keyboard-height spacer.
    const inBand = band.findAll(() => true);
    expect(inBand.length).toBeGreaterThan(MODULE_IDS.length); // vacuity guard
    const scrollersInBand = inBand.filter(
      (node) =>
        node.type === RNScrollView ||
        node.props?.[KEYBOARD_AWARE_MARKER] === true ||
        node.props?.horizontal === true,
    );
    expect(scrollersInBand.length).toBe(0);

    // It wraps instead, so nothing is off-screen at any width.
    const row = inBand.find(
      (node) => flatten(node.props?.style).flexWrap === "wrap",
    );
    expect(row).toBeDefined();
    const rowStyle = flatten((row as RenderTreeNode).props.style);
    expect(rowStyle.flexDirection).toBe("row");
    // `alignItems: "flex-start"` is the same anti-inflation rule as the chip row.
    expect(rowStyle.alignItems).toBe("flex-start");
    tree.unmount();
  });

  it("D4-R5 — every Stay scroller persists taps while a keyboard is open", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );
    const seen = new Map<string, unknown>();
    for (const node of nodes(tree)) {
      if (node.props?.contentContainerStyle === undefined) continue;
      const id = String(node.props?.testID ?? "(untagged)");
      if (!seen.has(id)) seen.set(id, node.props?.keyboardShouldPersistTaps);
    }
    // Vacuity guard: there ARE scrollers to check.
    expect(seen.size).toBeGreaterThan(0);
    for (const [testID, persist] of seen) {
      expect({ testID, persist }).toEqual({ testID, persist: "handled" });
    }
    tree.unmount();
  });

  it("D4-R6 — the chip row's own height stays under the ceiling", async () => {
    // The rendered chip row is one line of chips with no vertical padding of
    // its own, so its height is the chip's height — measured 36.7pt on device.
    expect(STAY_CHIP_ROW_MAX_HEIGHT).toBe(56);
    const tree = await mount(
      <StayChipRow testID="probe-row">
        <View testID="chip-1" />
      </StayChipRow>,
    );
    const content = flatten(compositeByTestId(tree, "probe-row-scroll").props
      .contentContainerStyle);
    // No vertical padding is added by the row itself, and nothing stretches.
    expect(content.paddingVertical ?? 0).toBe(0);
    expect(content.height).toBeUndefined();
    expect(content.minHeight).toBeUndefined();
    tree.unmount();
  });
});

// ===========================================================================
// DEFECT 3 — the editor is a committed task behind a scrim.
// ===========================================================================

describe("#1532 D3 — the editor is a layer, not an inline replace", () => {
  it("D3-R1 — on phone the editor opens INSIDE the sheet, over the list", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );
    // Before: no editor.
    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(0);

    await press(tree, "stay-inventory-add");

    // The editor is mounted…
    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(1);
    // …inside the SHEET, whose scrim is what makes the module pills physically
    // untappable. That is the structural fix for the lying tab.
    expect(byTestId(tree, "stay-offering-editor-sheet").length).toBeGreaterThan(0);
    // …and the list is STILL mounted underneath, which is what "a layer, not a
    // replace" means. Before #1532 the editor REPLACED the list via an inline
    // early return, and that is why switching module left the content frozen.
    expect(byTestId(tree, "stay-inventory-list-scroll").length).toBe(1);
    tree.unmount();
  });

  it("D3-R2 — the header has a real Cancel, a live title and a readiness pill", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );
    await press(tree, "stay-inventory-add");

    oneByTestId(tree, "stay-offering-cancel");
    oneByTestId(tree, "stay-offering-readiness-pill");
    const title = oneByTestId(tree, "stay-offering-title");
    // The title says what is being created, not a constant.
    expect(title.props.children).toBe("Add a Room");

    // Choosing "Place" changes it — this is the "live title" claim, proved by
    // driving the control rather than by reading the source.
    await press(tree, "stay-add-place");
    expect(oneByTestId(tree, "stay-offering-title").props.children).toBe(
      "Add a Place",
    );
    await press(tree, "stay-add-bulk");
    expect(oneByTestId(tree, "stay-offering-title").props.children).toBe(
      "Add several Places",
    );
    tree.unmount();
  });

  it("D3-R3 — a CLEAN draft closes on cancel; a DIRTY one raises the dialog", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );

    // Clean: opens and closes with no prompt.
    await press(tree, "stay-inventory-add");
    await press(tree, "stay-offering-cancel");
    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(0);

    // Dirty: make a real change through a real control, then cancel.
    await press(tree, "stay-inventory-add");
    await press(tree, "stay-add-place");
    await press(tree, "stay-offering-cancel");

    // The editor is STILL open, and the guard is up.
    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(1);
    const text = renderedText(tree);
    expect(text).toContain("Discard this draft?");
    // The photo sentence — honest about what discarding actually leaves behind.
    expect(text).toContain("photos");
    // Cancel sits in the SAFE slot.
    expect(text).toContain("Keep editing");

    // Confirming discards.
    await press(tree, "stay-offering-discard-confirm");
    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(0);
    tree.unmount();
  });

  it("D3-R4 — keeping editing leaves the draft exactly where it was", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );
    await press(tree, "stay-inventory-add");
    await press(tree, "stay-add-place");
    await press(tree, "stay-offering-cancel");
    await press(tree, "stay-offering-discard-cancel");

    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(1);
    // The choice the operator made is intact — the guard did not reset it.
    expect(oneByTestId(tree, "stay-offering-title").props.children).toBe(
      "Add a Place",
    );

    // The dialog is DISMISSED. Asserted on the dialog's own `visible`, not on
    // rendered text: `Modal` deliberately stays mounted through its 160ms exit
    // animation, so a text assertion here would be a race that passes or fails
    // on timing rather than on behaviour.
    const dialogs = nodes(tree).filter(
      (node) =>
        node.props?.testID === "stay-offering-discard-dialog" &&
        typeof node.props?.visible === "boolean",
    );
    // Vacuity guard: the dialog element really is in the tree to be read.
    expect(dialogs.length).toBeGreaterThan(0);
    for (const dialog of dialogs) {
      expect(dialog.props.visible).toBe(false);
    }

    // And it can be raised again — the guard is not a one-shot.
    await press(tree, "stay-offering-cancel");
    expect(renderedText(tree)).toContain("Discard this draft?");
    tree.unmount();
  });

  it("D3-R5 — WIDE DESKTOP keeps #1501's in-workspace replace", async () => {
    mockIsWideDesktop = true;
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );
    await press(tree, "stay-inventory-add");
    expect(byTestId(tree, "stay-offering-editor-scroll").length).toBe(1);
    // No sheet on desktop — a bottom sheet on a 1440px monitor is theatre.
    expect(byTestId(tree, "stay-offering-editor-sheet").length).toBe(0);
    // …and the list is replaced, exactly as #1484 F-2 requires.
    expect(byTestId(tree, "stay-inventory-list-scroll").length).toBe(0);
    tree.unmount();
  });
});

// ===========================================================================
// DEFECT 1 — a hotel's guests are not invited to reserve a table.
// ===========================================================================

describe("#1532 D1 — the reserve sheet says what the CTA said", () => {
  it("D1-R1 — the copy function is the single source for both surfaces", () => {
    expect(reserveActionLabel(true)).toBe("Reserve this Stay");
    expect(reserveActionLabel(false)).toBe("Reserve a table");
    // The heading IS the action. A sheet that renames the thing the guest just
    // chose is how a booking flow loses people.
    expect(reserveSheetTitle(true)).toBe(reserveActionLabel(true));
    expect(reserveSheetTitle(false)).toBe(reserveActionLabel(false));
  });

  it("D1-R2 — a STAY sheet renders zero restaurant words", async () => {
    const tree = await mount(
      <PublicVenueReservationSheet
        visible
        onClose={() => undefined}
        title={reserveSheetTitle(true)}
      >
        <View testID="stay-reservation-body" />
      </PublicVenueReservationSheet>,
    );
    // VACUITY GUARD: the sheet really rendered its heading. Without this, "no
    // 'Reserve a table' anywhere" would pass over an empty tree — which is
    // exactly how a screenful of nothing looks green.
    const text = renderedText(tree);
    expect(text).toContain("Reserve this Stay");
    expect(text).not.toContain("Reserve a table");

    // The screen-reader header says the same thing as the visible one.
    const headers = nodes(tree).filter(
      (node) => node.props?.accessibilityRole === "header",
    );
    expect(headers.length).toBeGreaterThan(0);
    expect(headers[0].props.accessibilityLabel).toBe("Reserve this Stay");
    tree.unmount();
  });

  it("D1-R3 — POSITIVE CONTROL: a RESTAURANT sheet still says the right thing", async () => {
    // The fix must not have simply deleted the restaurant wording. If this arm
    // is not here, D1-R2 could be satisfied by a sheet with no heading at all.
    const tree = await mount(
      <PublicVenueReservationSheet
        visible
        onClose={() => undefined}
        title={reserveSheetTitle(false)}
      >
        <View testID="restaurant-reservation-body" />
      </PublicVenueReservationSheet>,
    );
    const text = renderedText(tree);
    expect(text).toContain("Reserve a table");
    expect(text).not.toContain("Reserve this Stay");
    tree.unmount();
  });
});
