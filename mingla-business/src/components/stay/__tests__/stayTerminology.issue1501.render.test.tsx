/**
 * Issue #1501 [add-rooms-form] — THE TERMINOLOGY CONTRACT, RENDERED.
 *
 * Seth's report: "the terminology on the add form — don't know what it means.
 * I need to understand it." Every toggle pair was bare jargon with zero helper
 * text (Single/Bulk, Instant/Request, Interchangeable/Named units, Exclusive
 * units/Shared capacity, Public/Overnight guests only), and the meaning existed
 * only in the source. The words ARE the fix — they are the part of this issue
 * only Seth could sign off, and they were approved verbatim on 2026-08-03.
 *
 * So this suite asserts the approved strings actually REACH THE SCREEN, and
 * that the jargon they replaced is gone from the editor entirely. A silent
 * revert to "Bulk" / "Interchangeable" / "No-show refund percent" fails here.
 *
 * It reads the RENDERED TREE, not the source file — a source-text pin would
 * pass on a constant that nothing renders.
 *
 * FAILS-ON-REVERT: change any approved label back to its old jargon (a true
 * line edit) -> T-1/T-2/T-4 FAIL.
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

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: true,
    isWeb: true,
    width: 1440,
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

import { OfferingEditor } from "../StayInventoryManager";

const PROPS = {
  brandId: "brand-1501",
  venueId: "venue-1501",
  existing: null,
  canManageInventory: true,
  canManageFinance: true,
  onClose: (): void => undefined,
};

/** Every string rendered anywhere in the tree, concatenated. */
function renderedText(tree: RenderTree): string {
  const chunks: string[] = [];
  for (const node of tree.root.findAll(() => true)) {
    const children = node.props?.children;
    const push = (value: unknown): void => {
      if (typeof value === "string") chunks.push(value);
    };
    push(children);
    if (Array.isArray(children)) children.forEach(push);
    // Placeholders and a11y strings are user-visible too.
    push(node.props?.placeholder);
    push(node.props?.accessibilityLabel);
    push(node.props?.accessibilityHint);
  }
  return chunks.join("\n");
}

/** Press the Pressable/Button carrying `testID`, flushing the state update. */
async function pressByTestId(tree: RenderTree, testID: string): Promise<void> {
  const node = tree.root
    .findAll(() => true)
    .find(
      (candidate) =>
        candidate.props?.testID === testID &&
        typeof candidate.props?.onPress === "function",
    );
  expect(node).toBeDefined();
  await TestRenderer.act(() => {
    ((node as RenderTreeNode).props.onPress as () => void)();
  });
}

// The approved table (issue #1501 DESIGN SPEC §3), verbatim.
const APPROVED_ROOM_CHOICES: readonly string[] = [
  "Room",
  "A space with a bed, booked by the night.",
  "Place",
  "Any other space guests can reserve — no bed involved.",
  "Add one",
  "Create a single Room or Place.",
  "Add several",
  "Create many at once. They share every setting below — only the names differ.",
  "Confirmed instantly",
  "The guest books and it’s theirs straight away. You do nothing.",
  "You approve first",
  "The guest asks; it’s held for you until you say yes in Reservations.",
  "Any one will do",
  "You have several identical ones. Mingla gives the guest whichever is free.",
  "Each one is named",
  "Every one has its own name or number, and Mingla tracks exactly which the guest gets.",
];

const APPROVED_PLACE_CHOICES: readonly string[] = [
  "Booked whole",
  "One booking takes the entire space. Nobody else is in it.",
  "Shared by the spot",
  "You sell individual spots until the space is full.",
  "Anyone can book",
  "Shows to everyone on Mingla, whether they’re staying with you or not.",
  "Only guests staying here",
  "Hidden from the public. Bookable only by someone who already has a room here.",
];

const APPROVED_FIELDS: readonly string[] = [
  "What guests will see in search and on the booking page.",
  "What the guest is actually getting. Two or three lines is plenty.",
  "What’s included",
  "Tap what this has. Type anything else and press enter.",
  "How many you have",
  "The number of identical ones you can sell for the same night.",
  "Guests per booking",
  "The most people allowed on one booking.",
  "Price per night",
  "What one booking costs before extra charges and tax.",
  "Extra charge name",
  "One extra charge added to every booking. Leave both blank if you don’t have one.",
  "Extra charge amount",
  "Added on top of the price, shown to the guest as its own line.",
  "Cancellation policy",
  "In your own words. Guests read this before they pay.",
  "If a guest never turns up, refund",
  "0 means you keep the full amount. 100 means they get everything back.",
];

/** The jargon the rewrite REPLACED. None of it may survive in the editor. */
const RETIRED_JARGON: readonly string[] = [
  "Single",
  "Bulk",
  "Instant",
  "Request",
  "Exclusive units",
  "Shared capacity",
  "Interchangeable",
  "Named units",
  "Overnight guests only",
  "Amenities",
  "Quantity",
  "Maximum guests",
  "Base price",
  "Optional fee name",
  "Fee amount",
  "No-show refund percent",
  "Private unit names",
];

describe("#1501 — the approved terminology actually renders", () => {
  it("T-1 — every approved ROOM choice label + helper is on screen", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const text = renderedText(tree);
    // Vacuity guard: the editor really rendered something readable.
    expect(text.length).toBeGreaterThan(200);
    for (const phrase of APPROVED_ROOM_CHOICES) {
      expect({ phrase, present: text.includes(phrase) }).toEqual({
        phrase,
        present: true,
      });
    }
  });

  it("T-2 — every approved FIELD label + helper is on screen", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const text = renderedText(tree);
    for (const phrase of APPROVED_FIELDS) {
      expect({ phrase, present: text.includes(phrase) }).toEqual({
        phrase,
        present: true,
      });
    }
  });

  it("T-3 — the Place-only choices carry their approved copy too", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await pressByTestId(tree, "stay-add-place");
    const text = renderedText(tree);
    for (const phrase of APPROVED_PLACE_CHOICES) {
      expect({ phrase, present: text.includes(phrase) }).toEqual({
        phrase,
        present: true,
      });
    }
    // Place prices are per booking, not per night.
    expect(text).toContain("Price per booking");
    // ...and the Place-only inventory field is renamed too.
    await pressByTestId(tree, "stay-place-capacity");
    const placeText = renderedText(tree);
    expect(placeText).toContain("Total spots");
    expect(placeText).toContain(
      "The most people who can share this space at the same time.",
    );
  });

  it("T-4 — none of the retired jargon survives anywhere in the editor", async () => {
    const roomTree = await mount(<OfferingEditor {...PROPS} />);
    const placeTree = await mount(<OfferingEditor {...PROPS} />);
    await pressByTestId(placeTree, "stay-add-place");
    const text = `${renderedText(roomTree)}\n${renderedText(placeTree)}`;
    for (const jargon of RETIRED_JARGON) {
      expect({ jargon, present: text.includes(jargon) }).toEqual({
        jargon,
        present: false,
      });
    }
  });

  it("T-5 — every explained choice offers a concrete example", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const text = renderedText(tree);
    for (const example of [
      "Ocean-view double, Suite 4",
      "Pool cabana, spa room, private dining table",
      "20 rooms in one go",
      "8 identical standard doubles",
      "Room 101, Room 102, Room 103",
    ]) {
      expect({ example, present: text.includes(example) }).toEqual({
        example,
        present: true,
      });
    }
  });
});
