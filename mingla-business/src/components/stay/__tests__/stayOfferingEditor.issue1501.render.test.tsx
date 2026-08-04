/**
 * Issue #1501 [add-rooms-form] — SECTIONS, and the CONTAINER-QUERY rail.
 *
 * Seth's second complaint: "no proper rhythm or grouping — one long
 * undifferentiated stack of inputs." The editor is now six sections, ordered
 * the way a hotelier reasons: what it is -> how guests book it -> how many ->
 * what it costs -> photos.
 *
 * His fifth: "it doesn't fill the available space." Answered with a form column
 * plus a summary rail, gated on a CONTAINER measurement rather than the
 * viewport — the Stay workspace is ~276pt narrower than the window, so a
 * viewport threshold would promise a rail that cannot fit.
 *
 * This suite drives the REAL `onLayout` the component listens to (the CSS those
 * branches emit is proved separately, through the react-native-web resolver, in
 * `stayEditorDesktop.issue1501.web.render.test.tsx`).
 *
 * The load-bearing one is S-4: EXACTLY ONE `stay-offering-save` may exist at
 * any width. Two CTAs would make the primary action ambiguous to an operator, a
 * screen reader, and every test that presses it by testID.
 *
 * FAILS-ON-REVERT: render the summary in BOTH places (drop the
 * `showRail ? null : summary` guard) -> S-4 FAILS; make `showRail` read the
 * viewport instead of the container -> S-2/S-3 FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1501.render.cjs --runInBand
 */

import React from "react";

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
      // #1532 — ADDITIVE: `Sheet` -> `SheetMobile` reads `Easing.in(Easing.cubic)`
      // at module scope for its close timing, and this mock had no `in`, so the
      // whole suite failed to LOAD once the Stay editor moved into the Sheet.
      // Nothing existing is changed or removed.
      in: (fn: unknown) => fn,
      cubic: () => 0,
    },
    // #1532 — ADDITIVE: `SheetMobile` and `Modal` both cancel their animations
    // on unmount, and this mock had no `cancelAnimation`, so a Stay suite that
    // mounts the editor sheet threw during commit. Additive only.
    cancelAnimation: () => undefined,
    __easingClose: {
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

import { stayEditorSummaryMinWidth } from "../../../constants/designSystem";
import { stayDraftReadiness } from "../stayInventoryPresentation";
import { OfferingEditor, stayEditorLayout } from "../StayInventoryManager";

const PROPS = {
  brandId: "brand-1501",
  venueId: "venue-1501",
  existing: null,
  canManageInventory: true,
  canManageFinance: true,
  onClose: (): void => undefined,
};

// The Stay workspace is the viewport minus the shared shell's chrome (#1484's
// tester measured 276px of it inside a 2,560px viewport).
const WORKSPACE_1440 = 1440 - 276; // 1164 — the rail fits
const WORKSPACE_1280 = 1280 - 276; // 1004 — it does not

const nodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

/**
 * How many DISTINCT elements carry `testID`.
 *
 * HOST nodes only (`typeof node.type === "string"`). react-test-renderer
 * surfaces the composite AND the host node for the same element, and `Button`
 * nests a Pressable inside a View, so a naive node count reports ONE control as
 * four — which would make "exactly one CTA" unmeasurable. One host node per
 * rendered element is the honest count.
 */
function countTestId(tree: RenderTree, testID: string): number {
  return nodes(tree).filter(
    (node) => node.props?.testID === testID && typeof node.type === "string",
  ).length;
}

function hasTestId(tree: RenderTree, testID: string): boolean {
  return countTestId(tree, testID) > 0;
}

/** Fire the editor ScrollView's REAL `onLayout` with a container width. */
async function layoutAt(tree: RenderTree, width: number): Promise<void> {
  const scroll = nodes(tree).find(
    (node) =>
      node.props?.testID === "stay-offering-editor-scroll" &&
      typeof node.props?.onLayout === "function",
  );
  expect(scroll).toBeDefined();
  await TestRenderer.act(() => {
    (
      (scroll as RenderTreeNode).props.onLayout as (event: {
        nativeEvent: { layout: { width: number } };
      }) => void
    )({ nativeEvent: { layout: { width } } });
  });
}

function renderedText(tree: RenderTree): string {
  const chunks: string[] = [];
  for (const node of nodes(tree)) {
    const children = node.props?.children;
    const push = (value: unknown): void => {
      if (typeof value === "string") chunks.push(value);
    };
    push(children);
    if (Array.isArray(children)) children.forEach(push);
  }
  return chunks.join("\n");
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1501 §2 — six sections, in the order a hotelier reasons", () => {
  it("S-1 — every section renders with its approved title and caption", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const text = renderedText(tree);
    const sections: readonly [string, string, string][] = [
      ["stay-section-start", "Start here", "Two quick choices, then the details."],
      [
        "stay-section-identity",
        "What it is",
        "The part guests read before they book.",
      ],
      [
        "stay-section-booking",
        "How guests book it",
        "Who can book, and what happens when they do.",
      ],
      [
        "stay-section-inventory",
        "How many you have",
        "Your inventory for one date.",
      ],
      [
        "stay-section-money",
        "What it costs",
        "Prices and rules guests see before they pay.",
      ],
      ["stay-section-photos", "Photos", "The first one becomes the cover."],
    ];
    for (const [testID, title, caption] of sections) {
      expect({ testID, present: hasTestId(tree, testID) }).toEqual({
        testID,
        present: true,
      });
      expect(text).toContain(title);
      expect(text).toContain(caption);
    }
  });

  it("S-1b — edit mode swaps 'Start here' for a read-only chip strip", async () => {
    const tree = await mount(
      <OfferingEditor
        {...PROPS}
        existing={
          {
            id: "off-1",
            name: "Garden double",
            kind: "room",
            description: "",
            quantity: 4,
            capacity: null,
            max_guests: 2,
            amenities: [],
            units: [],
            media: [],
            status: "draft",
            version: 1,
            confirmation_mode: "instant",
            unit_naming_mode: "interchangeable",
            inventory_basis: "pooled_units",
            access_scope: "public",
            hasOpenAvailability: false,
          } as never
        }
      />,
    );
    // `updateStayOffering` omits `kind`, so the type cannot change on edit —
    // a control that silently does nothing is a dead tap.
    expect(hasTestId(tree, "stay-section-start")).toBe(false);
    expect(hasTestId(tree, "stay-offering-kind-strip")).toBe(true);
    expect(hasTestId(tree, "stay-add-room")).toBe(false);
    const text = renderedText(tree);
    expect(text).toContain("Room");
    expect(text).toContain("Confirmed instantly");
    expect(text).toContain("Any one will do");
  });
});

describe("#1501 §5 — the rail is a CONTAINER query", () => {
  it("S-2 — a 1440 workspace gets the rail; a 1280 workspace does not", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    // Before the first layout pass there is no measurement, so no rail.
    expect(hasTestId(tree, "stay-offering-rail")).toBe(false);

    await layoutAt(tree, WORKSPACE_1440);
    expect(hasTestId(tree, "stay-offering-rail")).toBe(true);

    await layoutAt(tree, WORKSPACE_1280);
    expect(hasTestId(tree, "stay-offering-rail")).toBe(false);
    // ...and the summary is still on screen, just stacked.
    expect(hasTestId(tree, "stay-offering-summary")).toBe(true);
  });

  it("S-3 — native never gets a rail however wide the container reports", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await layoutAt(tree, 2000);
    expect(hasTestId(tree, "stay-offering-rail")).toBe(false);
    expect(stayEditorLayout({ isWideDesktop: false, containerWidth: 4000 }))
      .toMatchObject({ showRail: false });
    // The threshold itself is inclusive on desktop.
    expect(
      stayEditorLayout({
        isWideDesktop: true,
        containerWidth: stayEditorSummaryMinWidth,
      }).showRail,
    ).toBe(true);
    expect(
      stayEditorLayout({
        isWideDesktop: true,
        containerWidth: stayEditorSummaryMinWidth - 1,
      }).showRail,
    ).toBe(false);
  });

  it("S-4 — EXACTLY ONE `stay-offering-save` exists at every width", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    expect(countTestId(tree, "stay-offering-save")).toBe(1);

    await layoutAt(tree, WORKSPACE_1440);
    expect(hasTestId(tree, "stay-offering-rail")).toBe(true);
    expect(countTestId(tree, "stay-offering-save")).toBe(1);
    expect(countTestId(tree, "stay-offering-summary")).toBe(1);

    await layoutAt(tree, WORKSPACE_1280);
    expect(countTestId(tree, "stay-offering-save")).toBe(1);
    expect(countTestId(tree, "stay-offering-summary")).toBe(1);
  });

  it("S-5 — the rail states what is being created and what is still missing", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await layoutAt(tree, WORKSPACE_1440);
    const text = renderedText(tree);
    expect(text).toContain("You’re creating");
    expect(text).toContain("1 Room draft");
    expect(text).toContain("Before these can go live");

    // The checklist MIRRORS `stayOfferingReadinessErrors` label-for-label, so a
    // draft and a saved row never describe the same requirement two ways.
    for (const item of stayDraftReadiness({
      description: "",
      photoCount: 0,
      hasPrice: false,
      hasPolicy: false,
      namedUnits: false,
      unitNameCount: 0,
    })) {
      expect(hasTestId(tree, `stay-readiness-${item.id}`)).toBe(true);
      expect(text).toContain(item.label);
    }
  });
});

describe("#1501 — the draft readiness mirror is honest", () => {
  it("S-6 — every item flips only when the form really satisfies it", () => {
    const empty = stayDraftReadiness({
      description: "",
      photoCount: 0,
      hasPrice: false,
      hasPolicy: false,
      namedUnits: false,
      unitNameCount: 0,
    });
    expect(empty.every((item) => !item.done)).toBe(true);
    // Whitespace is not a description.
    expect(
      stayDraftReadiness({
        description: "   ",
        photoCount: 0,
        hasPrice: false,
        hasPolicy: false,
        namedUnits: false,
        unitNameCount: 0,
      })[0].done,
    ).toBe(false);

    const filled = stayDraftReadiness({
      description: "A quiet garden room.",
      photoCount: 2,
      hasPrice: true,
      hasPolicy: true,
      namedUnits: true,
      unitNameCount: 3,
    });
    expect(filled.find((item) => item.id === "description")?.done).toBe(true);
    expect(filled.find((item) => item.id === "cover")?.done).toBe(true);
    expect(filled.find((item) => item.id === "price")?.done).toBe(true);
    expect(filled.find((item) => item.id === "policy")?.done).toBe(true);
    expect(filled.find((item) => item.id === "units")?.done).toBe(true);
    // Availability lives on another screen — never claimed done from here.
    expect(filled.find((item) => item.id === "availability")?.done).toBe(false);
    // The unit row only exists when units are actually named.
    expect(empty.some((item) => item.id === "units")).toBe(false);
  });
});
