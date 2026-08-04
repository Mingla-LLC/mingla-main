/**
 * Issue #1501 [add-rooms-form] — THE APPROVED BEHAVIOUR: D-4, D-5, the bulk
 * cap, assisted input, and the write-once `resultCopy`.
 *
 * Each of these is a decision Seth signed off on 2026-08-03, and each of them
 * removes a way the form could quietly produce wrong data:
 *
 * D-4 — "Add several" FORCES "Any one will do". Bulk + named units wrote the
 *   IDENTICAL unit-name list into every one of the N created offerings, because
 *   `makeOffering` closes over one `parsedUnits`. That is a data trap, not a
 *   feature. The identity group is hidden in bulk and the emitted
 *   `unitNamingMode` is derived, so a stale `namedUnits: true` from before the
 *   operator switched to bulk cannot leak into the payload.
 *
 * D-5 — "How many you have" is DERIVED from the named list and read-only. The
 *   server rejects `quantity !== units.length` with `named_units_incomplete`;
 *   deriving the number deletes the error class instead of explaining it.
 *
 * BULK CAP — 500, matching the server EXACTLY
 *   (`20270131013808_issue_1387_stay_inventory_management.sql:1078-1080`:
 *   `jsonb_array_length(items) NOT BETWEEN 1 AND 500` -> `stay_invalid_bulk_
 *   request`). The design spec had GUESSED 100; the guess was wrong. A client
 *   that lets an operator build 600 names hands them an opaque edge-function
 *   failure after ten minutes of typing.
 *
 * resultCopy — was WRITE-ONCE. A bulk partial failure set it, `onSuccess` only
 *   closes when it is null, and nothing ever cleared it: every later successful
 *   save in that session silently refused to close, with no error to explain
 *   it. C-1 drives the real two-attempt sequence.
 *
 * FAILS-ON-REVERT (each proven independently, hashes in the #1501 report):
 * - `namedUnitsActive` -> `namedUnits`                      => D-1/D-2 FAIL
 * - `derivedQuantity` -> `quantity` (or drop the read-only) => D-3/D-4 FAIL
 * - `NAME_LIST_HARD_CAP` 500 -> 100                         => B-1 FAILS
 * - delete the `onMutate` reset                             => C-1 FAILS
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

// ---------------------------------------------------------------------------
// react-query: capture the REAL options object the component passes, so the
// test can drive `onMutate` -> `mutationFn` -> `onSuccess` in the exact order
// react-query does. Nothing about the component's logic is stubbed.
// ---------------------------------------------------------------------------
interface CapturedMutation {
  onMutate?: () => void;
  mutationFn: () => Promise<unknown>;
  onSuccess?: (data: unknown, variables?: unknown) => void;
}
let mockCaptured: CapturedMutation[] = [];
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
    getQueryData: jest.fn(() => undefined),
  }),
  useMutation: (options: CapturedMutation) => {
    mockCaptured.push(options);
    return {
      mutate: jest.fn(),
      mutateAsync: jest.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: jest.fn(),
    };
  },
}));

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

const mockBulkCreate = jest.fn();
const mockCreateOffering = jest.fn();
const mockManageInventory = jest.fn();
jest.mock("../../../services/stayInventoryService", () => ({
  bulkCreateStayOfferings: (...args: unknown[]) =>
    mockBulkCreate(...args),
  changeStayOfferingStatus: jest.fn(),
  createStayOffering: (...args: unknown[]) => mockCreateOffering(...args),
  attachStayOfferingMedia: jest.fn(),
  manageStayInventory: (...args: unknown[]) => mockManageInventory(...args),
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
  NAME_LIST_HARD_CAP,
  NAME_LIST_OVER_CAP_COPY,
  NAME_LIST_SOFT_WARN,
  buildPatternNames,
  namePatternPreview,
  nameListSoftWarnCopy,
  patternRangeCount,
} from "../../ui/NameBuilder";
import { CHIP_MAX_COUNT, CHIP_MAX_LENGTH, addChip } from "../../ui/ChipInput";
import { OfferingEditor } from "../StayInventoryManager";

const onClose = jest.fn();
const PROPS = {
  brandId: "brand-1501",
  venueId: "venue-1501",
  existing: null,
  canManageInventory: true,
  canManageFinance: true,
  onClose,
};

const SNAPSHOT = {
  settings: null,
  offerings: [],
  permissions: { canManageInventory: true, canManageFinance: true },
};

const nodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

function findByTestId(
  tree: RenderTree,
  testID: string,
): RenderTreeNode | undefined {
  return nodes(tree).find((node) => node.props?.testID === testID);
}

function hasTestId(tree: RenderTree, testID: string): boolean {
  return findByTestId(tree, testID) !== undefined;
}

async function press(tree: RenderTree, testID: string): Promise<void> {
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

async function type(
  tree: RenderTree,
  testID: string,
  value: string,
): Promise<void> {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onChangeText === "function",
  );
  expect(node).toBeDefined();
  await TestRenderer.act(() => {
    ((node as RenderTreeNode).props.onChangeText as (v: string) => void)(value);
  });
}

/** The input element (not its wrapper) carrying `testID`. */
function input(tree: RenderTree, testID: string): RenderTreeNode {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onChangeText === "function",
  );
  expect(node).toBeDefined();
  return node as RenderTreeNode;
}

/**
 * The LATEST `save` mutation options. The component re-renders on every state
 * change and react-query re-reads the options object each time, so the first
 * captured pair holds the mount-time closures (empty name, empty lists). `save`
 * is declared before `removeMedia`, so the newest save is the second-from-last
 * captured entry.
 */
function latestSave(): CapturedMutation {
  const save = mockCaptured[mockCaptured.length - 2];
  expect(save).toBeDefined();
  expect(typeof save.mutationFn).toBe("function");
  return save;
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
  mockCaptured = [];
  onClose.mockReset();
  mockBulkCreate.mockReset();
  mockCreateOffering.mockReset();
  mockManageInventory.mockReset();
});

describe("#1501 D-4 — 'Add several' forces 'Any one will do'", () => {
  it("D-1 — the identity group is HIDDEN in bulk, replaced by the caption", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    // Vacuity guard: the group really is there before we switch.
    expect(hasTestId(tree, "stay-units-pooled")).toBe(true);
    expect(hasTestId(tree, "stay-units-named")).toBe(true);

    await press(tree, "stay-add-bulk");

    expect(hasTestId(tree, "stay-units-pooled")).toBe(false);
    expect(hasTestId(tree, "stay-units-named")).toBe(false);
    expect(renderedText(tree)).toContain(
      "Naming individual units is available after you create them.",
    );
  });

  it("D-2 — a stale 'Each one is named' cannot leak into the bulk payload", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    // The operator picks named units FIRST, then switches to adding several.
    await press(tree, "stay-units-named");
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names", "Room 101");
    await TestRenderer.act(() => {
      const submit = input(tree, "stay-bulk-names").props
        .onSubmitEditing as () => void;
      submit();
    });

    mockBulkCreate.mockResolvedValue({
      job: { succeeded_count: 1, failed_count: 0 },
    });
    mockManageInventory.mockResolvedValue(SNAPSHOT);

    const save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      await save.mutationFn();
    });

    expect(mockBulkCreate).toHaveBeenCalledTimes(1);
    const items = (
      mockBulkCreate.mock.calls[0][0] as {
        items: { unitNamingMode: string; units?: unknown }[];
      }
    ).items;
    expect(items).toHaveLength(1);
    // THE DATA TRAP, closed: never "named", never a units array.
    expect(items[0].unitNamingMode).toBe("interchangeable");
    expect(items[0].units).toBeUndefined();
  });
});

describe("#1501 D-5 — 'How many you have' is derived when each one is named", () => {
  it("D-3 — the count field goes READ-ONLY with the approved helper", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    // Vacuity guard: editable by default.
    expect(input(tree, "stay-offering-quantity").props.editable).toBe(true);

    await press(tree, "stay-units-named");

    const quantity = input(tree, "stay-offering-quantity");
    expect(quantity.props.editable).toBe(false);
    expect(renderedText(tree)).toContain("Set by the names below.");
  });

  it("D-4 — the count TRACKS the name list rather than being typed", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await press(tree, "stay-units-named");
    expect(input(tree, "stay-offering-quantity").props.value).toBe("0");

    // Build 101..103 with the pattern generator.
    await type(tree, "stay-unit-names-from", "101");
    await type(tree, "stay-unit-names-to", "103");
    await press(tree, "stay-unit-names-add-pattern");

    expect(input(tree, "stay-offering-quantity").props.value).toBe("3");
    // ...and the derived value is what the server is told.
    mockCreateOffering.mockResolvedValue({ inventory: SNAPSHOT });
    await type(tree, "stay-offering-name", "Garden wing");
    const save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      await save.mutationFn();
    });
    const offering = (
      mockCreateOffering.mock.calls[0][0] as {
        offering: { quantity?: number; units?: { name: string }[] };
      }
    ).offering;
    expect(offering.quantity).toBe(3);
    expect(offering.units).toEqual([
      { name: "Room 101" },
      { name: "Room 102" },
      { name: "Room 103" },
    ]);
  });
});

describe("#1501 — the bulk cap matches the server exactly", () => {
  it("B-1 — 500 is allowed and 501 disables Add with the approved copy", async () => {
    // The number itself is the contract: the server guard is
    // `jsonb_array_length(items) BETWEEN 1 AND 500`.
    expect(NAME_LIST_HARD_CAP).toBe(500);

    const tree = await mount(<OfferingEditor {...PROPS} />);
    await press(tree, "stay-add-bulk");

    // Exactly at the cap: allowed.
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "500");
    expect(patternRangeCount("1", "500")).toBe(500);
    expect(findByTestId(tree, "stay-bulk-names-add-pattern")?.props.disabled)
      .toBe(false);
    expect(hasTestId(tree, "stay-bulk-names-cap")).toBe(false);

    // One over: blocked, and TOLD why.
    await type(tree, "stay-bulk-names-to", "501");
    expect(patternRangeCount("1", "501")).toBe(501);
    expect(findByTestId(tree, "stay-bulk-names-add-pattern")?.props.disabled)
      .toBe(true);
    expect(renderedText(tree)).toContain(NAME_LIST_OVER_CAP_COPY);
    expect(NAME_LIST_OVER_CAP_COPY).toBe(
      "You can add up to 500 at a time.",
    );
  });

  it("B-2 — above 50 warns without blocking", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await press(tree, "stay-add-bulk");

    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", String(NAME_LIST_SOFT_WARN));
    expect(hasTestId(tree, "stay-bulk-names-soft-warn")).toBe(false);

    await type(tree, "stay-bulk-names-to", String(NAME_LIST_SOFT_WARN + 1));
    expect(hasTestId(tree, "stay-bulk-names-soft-warn")).toBe(true);
    expect(renderedText(tree)).toContain(
      nameListSoftWarnCopy(NAME_LIST_SOFT_WARN + 1),
    );
    // Warning, not a wall.
    expect(findByTestId(tree, "stay-bulk-names-add-pattern")?.props.disabled)
      .toBe(false);
  });

  it("B-3 — the pattern generator pads, previews, and skips duplicates", async () => {
    // Zero-padding is INFERRED from the operator's own `From` string.
    expect(buildPatternNames("Room", "01", "03")).toEqual([
      "Room 01",
      "Room 02",
      "Room 03",
    ]);
    expect(buildPatternNames("Room", "101", "103")).toEqual([
      "Room 101",
      "Room 102",
      "Room 103",
    ]);
    // A non-alphanumeric tail means no inserted space.
    expect(buildPatternNames("Suite-", "1", "2")).toEqual([
      "Suite-1",
      "Suite-2",
    ]);
    // Nonsense ranges produce nothing rather than an exception.
    expect(buildPatternNames("Room", "5", "1")).toEqual([]);
    expect(buildPatternNames("Room", "", "")).toEqual([]);
    // A huge range is never materialised.
    expect(buildPatternNames("Room", "1", "999999")).toEqual([]);
    expect(patternRangeCount("1", "999999")).toBe(999999);

    expect(namePatternPreview(buildPatternNames("Room", "101", "120"))).toBe(
      "Room 101, Room 102, Room 103 … Room 120",
    );

    const tree = await mount(<OfferingEditor {...PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-from", "101");
    await type(tree, "stay-bulk-names-to", "103");
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("3 names ready");

    // Re-adding the same range adds nothing and SAYS so.
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("3 names ready");
    expect(hasTestId(tree, "stay-bulk-names-skipped")).toBe(true);
  });
});

describe("#1501 — assisted input replaces the raw comma field", () => {
  it("A-1 — a tapped suggestion becomes a chip and leaves the suggestion row", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    expect(hasTestId(tree, "stay-offering-amenities-suggest-Wi-Fi")).toBe(true);

    await press(tree, "stay-offering-amenities-suggest-Wi-Fi");

    expect(hasTestId(tree, "stay-offering-amenities-chip-Wi-Fi")).toBe(true);
    expect(hasTestId(tree, "stay-offering-amenities-suggest-Wi-Fi")).toBe(false);
  });

  it("A-2 — a typed comma commits, and dedupe is case-insensitive", async () => {
    // Pure rules first — no renderer needed to prove them.
    expect(addChip(["Wi-Fi"], "wi-fi")).toEqual({
      values: ["Wi-Fi"],
      duplicateOf: "Wi-Fi",
    });
    expect(addChip([], "  Balcony  ")).toEqual({
      values: ["Balcony"],
      duplicateOf: null,
    });
    expect(addChip([], "x".repeat(80)).values[0]).toHaveLength(
      CHIP_MAX_LENGTH,
    );
    const full = Array.from({ length: CHIP_MAX_COUNT }, (_v, i) => `a${i}`);
    expect(addChip(full, "one more").values).toHaveLength(CHIP_MAX_COUNT);

    const tree = await mount(<OfferingEditor {...PROPS} />);
    await type(tree, "stay-offering-amenities", "Roof terrace,");
    expect(hasTestId(tree, "stay-offering-amenities-chip-Roof terrace")).toBe(
      true,
    );
    // The draft is cleared, not left holding the committed text.
    expect(input(tree, "stay-offering-amenities").props.value).toBe("");
  });

  it("A-3 — amenities reach the server as a clean array", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await type(tree, "stay-offering-name", "Garden wing");
    await press(tree, "stay-offering-amenities-suggest-Wi-Fi");
    await type(tree, "stay-offering-amenities", "Ensuite,");

    mockCreateOffering.mockResolvedValue({ inventory: SNAPSHOT });
    const save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      await save.mutationFn();
    });
    const offering = (
      mockCreateOffering.mock.calls[0][0] as {
        offering: { amenities: string[] };
      }
    ).offering;
    expect(offering.amenities).toEqual(["Wi-Fi", "Ensuite"]);
  });
});

describe("#1501 — the write-once partial-failure banner", () => {
  it("C-1 — a later successful save can still close the editor", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "2");
    await press(tree, "stay-bulk-names-add-pattern");

    mockManageInventory.mockResolvedValue(SNAPSHOT);

    // ATTEMPT 1 — partial failure. The banner shows and the editor STAYS open,
    // which is correct: the operator has drafts that need review.
    mockBulkCreate.mockResolvedValueOnce({
      job: { succeeded_count: 1, failed_count: 1 },
    });
    await TestRenderer.act(async () => {
      const save = latestSave();
      save.onMutate?.();
      const data = await save.mutationFn();
      save.onSuccess?.(data);
    });
    expect(renderedText(tree)).toContain("need review");
    expect(onClose).not.toHaveBeenCalled();

    // ATTEMPT 2 — clean. Before the fix this ALSO refused to close, forever.
    mockBulkCreate.mockResolvedValueOnce({
      job: { succeeded_count: 2, failed_count: 0 },
    });
    await TestRenderer.act(async () => {
      const save = latestSave();
      save.onMutate?.();
      const data = await save.mutationFn();
      save.onSuccess?.(data);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
