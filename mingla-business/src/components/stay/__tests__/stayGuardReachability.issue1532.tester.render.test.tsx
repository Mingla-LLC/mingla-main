/**
 * Issue #1532 [stay-manager-ux] — TESTER ADVERSARIAL suite.
 *
 * A DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SEVEN HAPPY-PATH PROOFS.
 *
 * `stayManagerUx.issue1532.render.test.tsx` D3-R3 asserts that a dirty Cancel
 * makes the string "Discard this draft?" appear in the rendered text. That
 * assertion is GREEN on `67026d67d` — and the guard is nevertheless completely
 * unreachable on a physical iOS device.
 *
 * WHY THE GREEN TEST LIES. React Native's jest preset renders `Modal` inline:
 * its children land in the same test tree whether the modal is a SIBLING of
 * another visible modal or NESTED inside it. UIKit does not work that way. A
 * view controller can present exactly ONE modal at a time, so a second `Modal`
 * mounted as a SIBLING of an already-presented one never presents at all — it
 * renders nothing, logs nothing, and throws nothing.
 *
 * MEASURED ON DEVICE (iPhone 17 Pro Max, iOS 26.5, dev build on Metro 8092):
 *
 *   clean draft  + header Cancel  -> sheet closes.                     correct
 *   dirty draft  + header Cancel  -> NOTHING happens. no dialog.       dead tap
 *   dirty draft  + scrim tap      -> NOTHING happens. no dialog.       dead tap
 *   dirty draft  + drag-dismiss   -> sheet parks off-screen behind a
 *                                    live full-screen scrim; every tap
 *                                    is swallowed; the only exit is to
 *                                    force-quit the app.               wedged
 *
 * Android is unaffected (an RN `Modal` there is a Dialog window and two can
 * stack), which is exactly why a source read or a single-platform run misses
 * it. The distinguishing fact is STRUCTURAL, not visual: on `67026d67d`
 * `{discardDialog}` is rendered as a SIBLING of `<Sheet>` — the only
 * Sheet + ConfirmDialog pair in the whole business codebase that is. Every
 * other one nests the dialog INSIDE the sheet:
 *
 *   VenueTableSheet.tsx   <Sheet 182 ... <ConfirmDialog 332 ... </Sheet> 352
 *   MenuItemSheet.tsx     <Sheet 134 ... <ConfirmDialog 220 ... </Sheet> 239
 *   StayInventoryManager  <Sheet 2627 ................ </Sheet> 2634
 *                         {discardDialog} 2635          <- OUTSIDE
 *
 * So this suite asserts PRESENTABILITY, not presence: within one modal window
 * stack, every visible `Modal` beyond the outermost must be CONTAINED by it.
 * That is the property UIKit actually enforces, it is invisible to a text
 * assertion, and it fails on `67026d67d`.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1532.tester.cjs --runInBand
 */

import React from "react";
import { Modal as RNModal, StyleSheet, View } from "react-native";

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
// Environment — mirrors the implementor's harness so the two suites disagree
// about BEHAVIOUR only, never about setup.
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

jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
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
      settings: {
        version: 3,
        property_kind: "hotel",
        summary: "Server summary",
        timezone: "Africa/Lagos",
        check_in_time: "15:00:00",
        check_out_time: "11:00:00",
        default_booking_mode: "request",
        amenities: ["Pool"],
        accessibility_features: [],
        arrival_instructions: null,
        house_rules: null,
        booking_state: "review",
      },
      offerings: [],
      permissions: { canManageInventory: true, canManageFinance: true },
    },
    isLoading: false,
    isPending: false,
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

import { StayChipRow } from "../StayChipRow";
import { StayInventoryManager } from "../StayInventoryManager";

const EDITOR_SHEET_TESTID = "stay-offering-editor-sheet";
const DISCARD_DIALOG_TESTID = "stay-offering-discard-dialog";

const allNodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

async function press(tree: RenderTree, testID: string): Promise<void> {
  const node = allNodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onPress === "function",
  );
  // Vacuity guard: a missing control would make every later assertion
  // meaningless, so the ABSENCE of the control is itself a failure.
  expect({ testID, pressable: node !== undefined }).toEqual({
    testID,
    pressable: true,
  });
  await TestRenderer.act(() => {
    ((node as RenderTreeNode).props.onPress as () => void)();
  });
}

/**
 * Every currently-PRESENTING `Modal`. `visible === true` is the exact condition
 * under which iOS asks its view controller to present, so it is the exact
 * condition under which two siblings collide.
 */
function visibleModals(tree: RenderTree): RenderTreeNode[] {
  return allNodes(tree).filter(
    (node) => node.type === RNModal && node.props?.visible === true,
  );
}

/** Does this modal's own subtree contain a node carrying `testID`? */
function subtreeHasTestId(modal: RenderTreeNode, testID: string): boolean {
  return modal.findAll((node) => node.props?.testID === testID).length > 0;
}

beforeEach(() => {
  mockIsWideDesktop = false;
});

// ===========================================================================
// A-1 — THE DEFECT. Presentability, not presence.
// ===========================================================================

describe("#1532 tester A-1 — the discard guard must be PRESENTABLE, not merely present", () => {
  it("A-1a — POSITIVE CONTROL: the jest Modal mock renders SIBLING modals exactly like NESTED ones, so a text assertion cannot tell them apart", async () => {
    const Siblings = (): React.ReactElement => (
      <View>
        <RNModal visible transparent testID="ctrl-outer">
          <View testID="ctrl-outer-body" />
        </RNModal>
        <RNModal visible transparent testID="ctrl-sibling">
          <View testID="ctrl-sibling-body" />
        </RNModal>
      </View>
    );
    const Nested = (): React.ReactElement => (
      <View>
        <RNModal visible transparent testID="ctrl-outer">
          <View testID="ctrl-outer-body" />
          <RNModal visible transparent testID="ctrl-sibling">
            <View testID="ctrl-sibling-body" />
          </RNModal>
        </RNModal>
      </View>
    );

    const siblingTree = await mount(<Siblings />);
    const nestedTree = await mount(<Nested />);

    // Both trees render BOTH bodies — which is precisely why "the dialog text
    // is on screen" is a vacuous claim about iOS presentability.
    for (const tree of [siblingTree, nestedTree]) {
      expect(
        allNodes(tree).filter(
          (node) => node.props?.testID === "ctrl-sibling-body",
        ).length,
      ).toBeGreaterThan(0);
    }

    // The CONTAINMENT probe, however, separates them cleanly. This is the
    // property A-1b asserts, and this control proves the probe discriminates
    // rather than always returning the same answer.
    const outerOf = (tree: RenderTree): RenderTreeNode => {
      const found = visibleModals(tree).filter((modal) =>
        subtreeHasTestId(modal, "ctrl-outer-body"),
      );
      expect(found.length).toBeGreaterThan(0);
      return found[0];
    };
    expect(subtreeHasTestId(outerOf(siblingTree), "ctrl-sibling-body")).toBe(
      false,
    );
    expect(subtreeHasTestId(outerOf(nestedTree), "ctrl-sibling-body")).toBe(
      true,
    );

    siblingTree.unmount();
    nestedTree.unmount();
  });

  it("A-1b — a dirty Cancel raises a guard the operator can actually SEE on iOS", async () => {
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );

    await press(tree, "stay-inventory-add");
    await press(tree, "stay-add-place"); // a real control, a real change
    await press(tree, "stay-offering-cancel");

    const presenting = visibleModals(tree);

    // VACUITY GUARD 1 — the sheet really is presenting.
    const sheetModals = presenting.filter((modal) =>
      subtreeHasTestId(modal, EDITOR_SHEET_TESTID),
    );
    expect({
      probe: "editor sheet is presenting",
      count: sheetModals.length > 0,
    }).toEqual({ probe: "editor sheet is presenting", count: true });

    // VACUITY GUARD 2 — the dialog really was raised. Without this the
    // containment assertion below would pass trivially on a tree that never
    // rendered a dialog at all.
    const dialogModals = presenting.filter((modal) =>
      subtreeHasTestId(modal, DISCARD_DIALOG_TESTID),
    );
    expect({
      probe: "discard dialog was raised",
      count: dialogModals.length > 0,
    }).toEqual({ probe: "discard dialog was raised", count: true });

    // THE ASSERTION. iOS presents one modal per view controller, so the guard
    // is only reachable if it lives INSIDE the sheet that is already
    // presenting. A sibling renders in jest and shows nothing on a device.
    expect({
      guard: "discard dialog is inside the editor sheet's modal",
      contained: subtreeHasTestId(sheetModals[0], DISCARD_DIALOG_TESTID),
    }).toEqual({
      guard: "discard dialog is inside the editor sheet's modal",
      contained: true,
    });

    tree.unmount();
  });

  it("A-1c — CLASS GATE: no two Stay-editor modals may present as siblings", async () => {
    const tree = await mount(
      <StayInventoryManager brandId="b" venueId="v" mode="inventory" />,
    );

    await press(tree, "stay-inventory-add");
    await press(tree, "stay-add-place");
    await press(tree, "stay-offering-cancel");

    const presenting = visibleModals(tree);

    // VACUITY GUARD — with fewer than two presenting modals there is no
    // sibling collision to find and this gate would be a no-op.
    expect({
      probe: "at least two modals presenting",
      count: presenting.length,
      enough: presenting.length >= 2,
    }).toMatchObject({ enough: true });

    // Exactly ONE presenting modal must contain every other presenting modal.
    // That is the shape UIKit can render; anything else is a silent no-show.
    const outermost = presenting.filter((candidate) =>
      presenting.every(
        (other) =>
          other === candidate ||
          candidate.findAll((node) => node.type === RNModal).length >
            other.findAll((node) => node.type === RNModal).length,
      ),
    );
    expect({
      gate: "exactly one presenting modal contains all the others",
      outermostCount: outermost.length,
    }).toEqual({
      gate: "exactly one presenting modal contains all the others",
      outermostCount: 1,
    });

    tree.unmount();
  });
});

// ===========================================================================
// A-2 — BOUNDARY ATTACK on StayChipRow's "no caller can restore stretch".
// D4-R3 attacks it with a plain OBJECT. A style ARRAY is a different shape and
// a legal one, so it is the shape a future caller is most likely to reach for.
// ===========================================================================

describe("#1532 tester A-2 — the chip row's cross-axis rule survives a hostile ARRAY override", () => {
  it("A-2a — an array-form contentStyle cannot restore RN's default stretch", async () => {
    const tree = await mount(
      <StayChipRow
        testID="tester-chip-row"
        contentStyle={[
          { paddingHorizontal: 4 },
          { alignItems: "stretch" as const },
        ]}
      >
        <View testID="tester-chip" />
      </StayChipRow>,
    );

    const scrollers = allNodes(tree).filter(
      (node) =>
        node.props?.testID === "tester-chip-row-scroll" &&
        node.props?.contentContainerStyle !== undefined,
    );
    // VACUITY GUARD — a renamed testID would otherwise make this pass over an
    // empty set.
    // `findAll` returns the composite element AND its host output, so the
    // count is >1 for one on-screen row; what matters is that the lookup
    // matched SOMETHING and that every match agrees.
    expect({
      probe: "chip row scroller found",
      count: scrollers.length,
      found: scrollers.length > 0,
    }).toMatchObject({ found: true });

    const resolved = (StyleSheet.flatten(
      scrollers[0].props.contentContainerStyle as never,
    ) ?? {}) as Record<string, unknown>;

    // VACUITY GUARD — prove the hostile override actually reached the merge,
    // otherwise "alignItems is center" would be true for the boring reason.
    expect({
      probe: "hostile override was merged, not dropped",
      paddingHorizontal: resolved.paddingHorizontal,
    }).toEqual({
      probe: "hostile override was merged, not dropped",
      paddingHorizontal: 4,
    });

    // The rule itself. Asserted POSITIVELY against the value that must win —
    // never `toBeUndefined()`, which is true whether the key was released or
    // silently retained.
    expect({ alignItems: resolved.alignItems }).toEqual({
      alignItems: "center",
    });

    tree.unmount();
  });

  it("A-2b — POSITIVE CONTROL: the same array override DOES win on a row that has no re-application", async () => {
    // Proves the override is genuinely capable of winning a merge, so A-2a's
    // "center" result is StayChipRow's doing and not an inert prop.
    const resolved = (StyleSheet.flatten([
      { flexDirection: "row" as const, alignItems: "center" as const },
      [{ paddingHorizontal: 4 }, { alignItems: "stretch" as const }],
    ] as never) ?? {}) as Record<string, unknown>;
    expect({ alignItems: resolved.alignItems }).toEqual({
      alignItems: "stretch",
    });
  });
});
