/**
 * Issue #1501 [add-rooms-form] — TESTER ADVERSARIAL SUITE.
 *
 * A SECOND, INDEPENDENT ANGLE on the same change. The implementor's four render
 * suites assert that named things are correct: `fieldStack` carries no flex key,
 * the approved strings are on screen, 500/501 flips the Add button, a bulk
 * partial failure lets the next save close. All of that reads a KNOWN testID in
 * a KNOWN state and asks "is this value right?".
 *
 * This suite asks the opposite question — "can the defect come back some OTHER
 * way?" — and it does so structurally rather than by name:
 *
 *  X-*  THE AXIS AUDITOR. The shipped guard makes `fieldStack` axis-safe and
 *       makes `span` a required prop. Neither checks that a CALL SITE picked the
 *       RIGHT axis: `<LabeledInput span="num">` compiles perfectly inside the
 *       form COLUMN, and `span="stack"` compiles perfectly inside `styles.row`.
 *       Both reintroduce #1501's exact failure. So instead of asserting on one
 *       style object, X-1 WALKS THE WHOLE RENDERED TREE, computes each node's
 *       inherited `flexDirection`, and fails on ANY node that resolves a
 *       width-share key against a column — across a SWEEP of editor states
 *       (Room/Place x one/several x named/interchangeable x whole/shared x both
 *       permission flags x create/edit), not one default render.
 *
 *  X-3  THE OVERFLOW PROOF. The overlap was a tall multiline box rendering
 *       taller than the height flex allotted it. X-3 proves that CANNOT happen
 *       at any width, by walking every multiline input's ancestor chain and
 *       requiring that nothing between it and the scroll container fixes a
 *       height, caps a height, or clips. A box no ancestor constrains cannot
 *       overflow, whatever the viewport does.
 *
 *  X-4  THE PAIR ARITHMETIC. "Don't regress the two-column pairs" is asserted as
 *       a real sum against the real tokens at the real phone width, not as
 *       "flexBasis is 220" — and that sum says the pair now WRAPS at 390pt,
 *       which the browser confirms. Recorded as a baseline, not hidden.
 *
 *  CHIP-* / NB-* BOUNDARY ATTACKS, including a 400-case fuzz over the chip
 *       reducer. Not "does 500 work" but "is there ANY input that gets an empty,
 *       over-long, or case-duplicate value past the door".
 *
 *  PERM-* THE GENERIC PERMISSION AUDIT. Not "these six controls are disabled"
 *       but "enumerate every `stay-*` control that can be pressed or typed into,
 *       and fail on anything outside the explicitly justified allow-list" — so a
 *       control added later is caught by default rather than by memory.
 *
 *  RC-*  THE BANNER, ATTACKED FROM THE OTHER SIDE. The implementor proves
 *       failure -> success closes. RC-1 proves failure -> failure REPLACES the
 *       banner with THIS attempt's numbers (a stale banner is the same bug
 *       wearing different clothes) and that the editor still closes exactly once
 *       on the eventual success.
 *
 * FAILS-ON-REVERT (verified by true line deletion, hashes in the QA verdict):
 *   `fieldStack` -> `{ flex: 1, minWidth: 140, gap }`            => X-1 FAILS
 *   `multiline`  -> add `maxHeight: 96`                          => X-3 FAILS
 *   `namedUnitsActive` -> `namedUnits`                           => D4-1 FAILS
 *   `derivedQuantity` -> `quantity`                              => D5-1 FAILS
 *   `NAME_LIST_HARD_CAP` 500 -> 100                              => NB-4 FAILS
 *   drop `disabled={!canManageInventory}` from any choice card   => PERM-1 FAILS
 *   delete the `onMutate` reset                                  => RC-1 FAILS
 *
 * Append-only: NEW file. Modifies and deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1501.tester.cjs --runInBand
 */

import React from "react";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: (JsonNode | string)[] | null;
}
interface RenderTree {
  root: RenderTreeNode;
  toJSON: () => JsonNode | null;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Mocks. Same seams as the implementor's suites — the COMPONENT is never
// stubbed, only its I/O boundary, so every assertion below reads real output.
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

const mockBulkCreate = jest.fn();
const mockCreateOffering = jest.fn();
const mockManageInventory = jest.fn();
jest.mock("../../../services/stayInventoryService", () => ({
  bulkCreateStayOfferings: (...args: unknown[]) => mockBulkCreate(...args),
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

import { StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";

import {
  spacing,
  stayFieldNumBasis,
  stayFieldNumMinWidth,
  stayProseMaxWidth,
} from "../../../constants/designSystem";
import {
  CHIP_MAX_COUNT,
  CHIP_MAX_LENGTH,
  addChip,
} from "../../ui/ChipInput";
import {
  NAME_LIST_HARD_CAP,
  NAME_LIST_OVER_CAP_COPY,
  NAME_LIST_SOFT_WARN,
  buildPatternNames,
  patternRangeCount,
} from "../../ui/NameBuilder";
import { OfferingEditor } from "../StayInventoryManager";

const onClose = jest.fn();
const BASE_PROPS = {
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

// ---------------------------------------------------------------------------
// Tree helpers.
// ---------------------------------------------------------------------------
/** Unmount inside `act` so React's teardown effects never warn. */
async function unmount(tree: RenderTree): Promise<void> {
  await TestRenderer.act(() => {
    tree.unmount();
  });
}

async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  expect(tree).not.toBeNull();
  return tree as unknown as RenderTree;
}

const nodes = (tree: RenderTree): RenderTreeNode[] =>
  tree.root.findAll(() => true);

function findByTestId(
  tree: RenderTree,
  testID: string,
): RenderTreeNode | undefined {
  return nodes(tree).find((node) => node.props?.testID === testID);
}

const hasTestId = (tree: RenderTree, testID: string): boolean =>
  findByTestId(tree, testID) !== undefined;

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

function inputNode(tree: RenderTree, testID: string): RenderTreeNode {
  const node = nodes(tree).find(
    (candidate) =>
      candidate.props?.testID === testID &&
      typeof candidate.props?.onChangeText === "function",
  );
  expect(node).toBeDefined();
  return node as RenderTreeNode;
}

async function type(
  tree: RenderTree,
  testID: string,
  value: string,
): Promise<void> {
  const node = inputNode(tree, testID);
  await TestRenderer.act(() => {
    (node.props.onChangeText as (v: string) => void)(value);
  });
}

async function submit(tree: RenderTree, testID: string): Promise<void> {
  const node = inputNode(tree, testID);
  await TestRenderer.act(() => {
    (node.props.onSubmitEditing as () => void)();
  });
}

async function keyPress(
  tree: RenderTree,
  testID: string,
  key: string,
): Promise<void> {
  const node = inputNode(tree, testID);
  await TestRenderer.act(() => {
    (
      node.props.onKeyPress as (event: {
        nativeEvent: { key: string };
      }) => void
    )({ nativeEvent: { key } });
  });
}

/** The freshest `save` mutation options — the only one carrying `onMutate`. */
function latestSave(): CapturedMutation {
  const withMutate = mockCaptured.filter(
    (entry) => typeof entry.onMutate === "function",
  );
  const save = withMutate[withMutate.length - 1];
  expect(save).toBeDefined();
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

// ---------------------------------------------------------------------------
// THE AXIS AUDITOR — the instrument X-1..X-3 are built on.
//
// Walks the HOST tree (`toJSON`), carrying each node's inherited
// `flexDirection`, and reports every node whose own resolved style asks to
// share the MAIN axis of a parent that is laid out as a COLUMN. That is the
// #1501 defect stated generically: it does not care what the style is called,
// which testID it sits on, or which state produced it.
// ---------------------------------------------------------------------------
interface AuditedNode {
  path: string;
  testID: string | undefined;
  parentDirection: "row" | "column";
  style: ViewStyle;
  multiline: boolean;
  type: string;
}

function auditTree(tree: RenderTree): AuditedNode[] {
  const out: AuditedNode[] = [];
  const walk = (
    node: JsonNode | string,
    parentDirection: "row" | "column",
    path: string,
    index: number,
  ): void => {
    if (typeof node === "string" || node === null) return;
    const style = (StyleSheet.flatten(
      node.props?.style as ViewStyle,
    ) ?? {}) as ViewStyle;
    const testID =
      typeof node.props?.testID === "string"
        ? (node.props.testID as string)
        : undefined;
    // The child INDEX is part of the path on purpose: without it two sibling
    // `View`s share a path string, and an ancestor test written as a prefix
    // match silently starts matching cousins. That produced a false "an
    // ancestor pins height: 1" on GlassCard's hairline divider.
    const here = `${path}/${index}:${node.type}${testID ? `[${testID}]` : ""}`;
    out.push({
      path: here,
      testID,
      parentDirection,
      style,
      multiline: node.props?.multiline === true,
      type: node.type,
    });
    const ownDirection: "row" | "column" =
      style.flexDirection === "row" || style.flexDirection === "row-reverse"
        ? "row"
        : "column";
    (node.children ?? []).forEach((child, childIndex) =>
      walk(child, ownDirection, here, childIndex),
    );
  };
  const root = tree.toJSON();
  expect(root).not.toBeNull();
  walk(root as JsonNode, "column", "", 0);
  return out;
}

/**
 * Does this style ask to SHARE THE PARENT'S MAIN AXIS?
 *
 * `flexShrink` alone is excluded on purpose: shrinking is safe in a column, and
 * flagging it would produce noise instead of findings. `flex`, `flexGrow` and a
 * non-`auto` `flexBasis` are the three keys that made the fields overlap.
 */
function sharesMainAxis(style: ViewStyle): boolean {
  const flex = style.flex;
  const grow = style.flexGrow;
  const basis = style.flexBasis;
  if (typeof flex === "number" && flex > 0) return true;
  if (typeof grow === "number" && grow > 0) return true;
  if (basis !== undefined && basis !== "auto") return true;
  return false;
}

/**
 * Nodes legitimately allowed to carry a main-axis key inside a COLUMN, each
 * with the reason it is not the #1501 bug. Anything else is a finding.
 *
 * - the ScrollView pair: RN's own `flex: 1` root + content container.
 * - `styles.center`: the loading/error state, a genuine full-height centering
 *   box with no sibling to overlap.
 * - `styles.flex`: the title row's growing half — its parent IS a row, so it
 *   only ever appears here when a third-party wrapper sits between them.
 */
const COLUMN_FLEX_ALLOWED = new Set<string>([
  "RCTScrollView",
  "ScrollView",
  "ScrollContentContainerView",
]);

/**
 * KNOWN, REPORTED, UNFIXED — the baseline X-1 measures against.
 *
 * This is NOT an exemption and NOT an opinion that the entry is acceptable. It
 * is the tester's QA finding written down where it cannot be forgotten:
 *
 *   `stay-offering-no-show` ("If a guest never turns up, refund") is declared
 *   `span="num"` at `StayInventoryManager.tsx` in the "What it costs" section,
 *   but it is NOT inside `styles.row` — it is stacked directly in the section's
 *   column, after the `stay-offering-policy` box. `fieldNum` carries
 *   `flexBasis: 220` + `flexShrink: 1`, so in that column those keys resolve
 *   against the HEIGHT. That is the #1501 defect class itself, surviving in the
 *   very change that exists to delete it, and it violates the
 *   `I-AXIS-SCOPED-FLEX` invariant this issue stages as DRAFT.
 *
 *   The fix is one word: `span="num"` -> `span="stack"`.
 *
 * X-1 is written as an EXACT-MATCH baseline rather than an allow-list on
 * purpose. Adding a new violation fails it (the protection this suite exists
 * for), and FIXING the known one also fails it — with a message telling you to
 * empty this array. A test that silently keeps passing after the bug is fixed
 * is how a stale exemption becomes permanent.
 */
const KNOWN_AXIS_VIOLATIONS: readonly string[] = [
  "stay-offering-no-show-field",
];

// ---------------------------------------------------------------------------
// STATE SWEEP — every editor configuration the operator can actually produce.
// ---------------------------------------------------------------------------
interface SweepState {
  name: string;
  wide: boolean;
  props: typeof BASE_PROPS;
  steps: string[];
}

const EXISTING_ROOM = {
  id: "off-1",
  kind: "room" as const,
  name: "Ocean-view double",
  description: "A room",
  status: "draft" as const,
  version: 3,
  quantity: 2,
  capacity: null,
  max_guests: 2,
  confirmation_mode: "instant" as const,
  unit_naming_mode: "named" as const,
  inventory_basis: "pooled_units" as const,
  access_scope: "public" as const,
  amenities: ["Wi-Fi"],
  units: [{ id: "u1", name: "Room 101" }],
  media: [],
  currentPrice: null,
  currentFees: [],
  currentPolicy: null,
};

function sweepStates(): SweepState[] {
  const combos: SweepState[] = [];
  for (const wide of [true, false]) {
    combos.push(
      {
        name: `create/room/one/interchangeable (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS },
        steps: [],
      },
      {
        name: `create/room/one/named (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS },
        steps: ["stay-units-named"],
      },
      {
        name: `create/room/several (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS },
        steps: ["stay-add-bulk"],
      },
      {
        name: `create/place/one/booked-whole (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS },
        steps: ["stay-add-place"],
      },
      {
        name: `create/place/one/shared-spots (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS },
        steps: ["stay-add-place", "stay-place-capacity"],
      },
      {
        name: `create/place/several/overnight-only (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS },
        steps: ["stay-add-place", "stay-place-overnight-only", "stay-add-bulk"],
      },
      {
        name: `create/finance-blocked (wide=${wide})`,
        wide,
        props: { ...BASE_PROPS, canManageFinance: false },
        steps: [],
      },
      {
        name: `edit/room/named (wide=${wide})`,
        wide,
        props: {
          ...BASE_PROPS,
          existing: EXISTING_ROOM as unknown as null,
        },
        steps: [],
      },
      {
        name: `edit/inventory-blocked (wide=${wide})`,
        wide,
        props: {
          ...BASE_PROPS,
          existing: EXISTING_ROOM as unknown as null,
          canManageInventory: false,
        },
        steps: [],
      },
    );
  }
  return combos;
}

async function mountState(state: SweepState): Promise<RenderTree> {
  mockIsWideDesktop = state.wide;
  const tree = await mount(<OfferingEditor {...state.props} />);
  // The rail is a CONTAINER query — feed it a real layout width so the wide
  // sweep exercises the SPLIT branch, not just the stacked one.
  const scroll = findByTestId(tree, "stay-offering-editor-scroll");
  if (scroll && typeof scroll.props.onLayout === "function") {
    await TestRenderer.act(() => {
      (
        scroll.props.onLayout as (event: {
          nativeEvent: { layout: { width: number } };
        }) => void
      )({ nativeEvent: { layout: { width: state.wide ? 1156 : 390 } } });
    });
  }
  for (const step of state.steps) await press(tree, step);
  return tree;
}

beforeEach(() => {
  mockCaptured = [];
  mockIsWideDesktop = true;
  onClose.mockReset();
  mockBulkCreate.mockReset();
  mockCreateOffering.mockReset();
  mockManageInventory.mockReset();
});

// ===========================================================================
// X — THE OVERLAP CANNOT COME BACK ANOTHER WAY
// ===========================================================================
describe("#1501 X — the axis defect is unreachable, not merely renamed", () => {
  it("X-0 — VACUITY GUARD: the auditor really sees the editor's own boxes", async () => {
    const tree = await mountState(sweepStates()[0]);
    const audited = auditTree(tree);

    // It walked a real tree, not an empty one.
    expect(audited.length).toBeGreaterThan(80);
    // It found the row wrapper, and correctly read its direction.
    const countRow = audited.find(
      (node) => node.testID === "stay-offering-count-row",
    );
    expect(countRow).toBeDefined();
    expect((countRow as AuditedNode).style.flexDirection).toBe("row");
    // It found a child of that row, and recorded its parent as a ROW.
    const inRow = audited.filter(
      (node) => node.parentDirection === "row" && sharesMainAxis(node.style),
    );
    expect(inRow.length).toBeGreaterThan(0);
    // And it found stacked fields whose parent is a COLUMN.
    const stacked = audited.filter(
      (node) =>
        node.testID === "stay-offering-description-field" &&
        node.parentDirection === "column",
    );
    expect(stacked.length).toBe(1);
    await unmount(tree);
  });

  it("X-1 — NO node shares a COLUMN's main axis, in ANY editor state", async () => {
    const offenders = new Set<string>();
    const detail = new Map<string, string>();
    for (const state of sweepStates()) {
      const tree = await mountState(state);
      for (const node of auditTree(tree)) {
        if (node.parentDirection !== "column") continue;
        if (!sharesMainAxis(node.style)) continue;
        if (COLUMN_FLEX_ALLOWED.has(node.type)) continue;
        const id = node.testID ?? node.path;
        offenders.add(id);
        detail.set(id, `${state.name} :: ${node.path}`);
      }
      await unmount(tree);
    }
    // EXACT match against the documented baseline. A new entry is the shipped
    // bug returning through a different door; a missing entry means the known
    // defect was fixed and `KNOWN_AXIS_VIOLATIONS` must shrink.
    expect({
      violations: [...offenders].sort(),
      firstSeenAt: [...offenders].sort().map((id) => detail.get(id)),
    }).toEqual({
      violations: [...KNOWN_AXIS_VIOLATIONS].sort(),
      firstSeenAt: [...KNOWN_AXIS_VIOLATIONS]
        .sort()
        .map((id) => detail.get(id)),
    });
  });

  it("X-1b — the known violation really IS the row measure in a column", async () => {
    // Documents the reported defect precisely enough that the fix is obvious
    // and its blast radius is bounded: ONE field, the row-only numeric measure,
    // stacked in the money section's column.
    const tree = await mountState(sweepStates()[0]);
    const audited = auditTree(tree);
    const offender = audited.find(
      (node) => node.testID === "stay-offering-no-show-field",
    );
    expect(offender).toBeDefined();
    const found = offender as AuditedNode;
    // It is the ROW-ONLY measure…
    expect(found.style.flexBasis).toBe(stayFieldNumBasis);
    expect(found.style.minWidth).toBe(stayFieldNumMinWidth);
    // …applied under a COLUMN, which is exactly what #1501 exists to delete.
    expect(found.parentDirection).toBe("column");
    // Its siblings in the same section got the stack measure right, so this is
    // a single call-site slip and not a systemic misunderstanding.
    for (const testID of [
      "stay-offering-fee-label-field",
      "stay-offering-policy-field",
    ]) {
      const sibling = audited.find((node) => node.testID === testID);
      expect(sibling?.parentDirection).toBe("column");
      expect(sibling?.style.flexBasis).toBeUndefined();
      expect(sibling?.style.flexGrow).toBeUndefined();
      expect(sibling?.style.width).toBe("100%");
    }
    await unmount(tree);
  });

  it("X-2 — no full-width box is dropped into a ROW (Amendment 1's crush)", async () => {
    const offenders: string[] = [];
    for (const state of sweepStates()) {
      const tree = await mountState(state);
      for (const node of auditTree(tree)) {
        if (node.parentDirection !== "row") continue;
        if (node.style.width !== "100%") continue;
        offenders.push(`${state.name} :: ${node.path}`);
      }
      await unmount(tree);
    }
    expect(offenders).toEqual([]);
  });

  it("X-3 — a tall multiline box cannot be constrained by ANY ancestor", async () => {
    // The overlap was content taller than its allotted box. If nothing above a
    // multiline input fixes, caps or clips a height, the box grows with its
    // content at every width and the overlap is structurally impossible.
    let checked = 0;
    for (const state of sweepStates()) {
      const tree = await mountState(state);
      const audited = auditTree(tree);
      const multilines = audited.filter((node) => node.multiline);
      for (const box of multilines) {
        checked += 1;
        // The input itself declares a MINIMUM, never a maximum, height.
        expect(box.style.minHeight).toBe(96);
        expect(box.style.maxHeight).toBeUndefined();
        expect(box.style.height).toBeUndefined();
        // …and it is capped on the WIDTH axis only, at the prose measure.
        expect(box.style.maxWidth).toBe(stayProseMaxWidth);
        // Every ancestor between it and the scroll root leaves height free.
        const ancestors = audited.filter(
          (node) =>
            box.path.startsWith(`${node.path}/`) &&
            !COLUMN_FLEX_ALLOWED.has(node.type),
        );
        expect(ancestors.length).toBeGreaterThan(2);
        for (const ancestor of ancestors) {
          // NOTHING above a prose box may pin or cap its HEIGHT. Three ways
          // that could happen, all forbidden together:
          //   1. an explicit `height`;
          //   2. a `maxHeight`;
          //   3. a main-axis key under a COLUMN parent — the #1501 mechanism
          //      itself, where `flex`/`flexBasis` becomes a height share.
          // A main-axis key under a ROW parent is fine and expected: that is
          // `formColumnInRow` sharing the WIDTH beside the summary rail.
          //
          // `GlassCard` does clip (`overflow: "hidden"`), and that is harmless
          // precisely BECAUSE nothing above bounds its height: a card that
          // grows with its content never has anything to clip. A clipping
          // ancestor that ALSO fixed a height would turn the old overlap into a
          // silent truncation, which is worse.
          expect({
            path: ancestor.path,
            height: ancestor.style.height,
            maxHeight: ancestor.style.maxHeight,
            heightShareInColumn:
              ancestor.parentDirection === "column" &&
              sharesMainAxis(ancestor.style),
          }).toEqual({
            path: ancestor.path,
            height: undefined,
            maxHeight: undefined,
            heightShareInColumn: false,
          });
        }
      }
      await unmount(tree);
    }
    // Description always, plus the policy box wherever finance is allowed.
    expect(checked).toBeGreaterThanOrEqual(18);
  });

  it("X-4 — the phone pair arithmetic (REPORTED: it wraps at 390pt)", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    const audited = auditTree(tree);

    const row = audited.find(
      (node) => node.testID === "stay-offering-count-row",
    );
    expect(row).toBeDefined();
    const rowStyle = (row as AuditedNode).style;
    expect(rowStyle.flexDirection).toBe("row");
    expect(rowStyle.flexWrap).toBe("wrap");
    // Load-bearing: RN's default `stretch` is the second-order overlap.
    expect(rowStyle.alignItems).toBe("flex-start");

    const children = audited.filter(
      (node) =>
        node.parentDirection === "row" &&
        node.path.startsWith(`${(row as AuditedNode).path}/`) &&
        node.testID?.endsWith("-field"),
    );
    expect(children.map((node) => node.testID)).toEqual([
      "stay-offering-quantity-field",
      "stay-offering-guests-field",
    ]);
    for (const child of children) {
      expect(child.style.flexGrow).toBe(0);
      expect(child.style.flexBasis).toBe(stayFieldNumBasis);
      expect(child.style.minWidth).toBe(stayFieldNumMinWidth);
    }
    // THE ARITHMETIC, at the real phone width with the real gutters:
    // `PAGE_BASE.padding` is `spacing.md` on both sides and `GlassCard`'s
    // default inner padding is `spacing.md` on both sides, so a phone row has
    // 326pt of content box.
    const PHONE_WIDTH = 390;
    const available = PHONE_WIDTH - spacing.md * 2 - spacing.md * 2;
    expect(available).toBe(326);

    // REPORTED DEFECT — the pair DOES wrap at 390pt.
    //
    // `flexWrap` decides on the FLEX BASE SIZE, before any shrinking: a line
    // that cannot hold both bases breaks, and the wrapped item then has a whole
    // line to itself and never shrinks at all. `flexShrink: 1` therefore does
    // NOT rescue a 220pt basis here — 220 + 220 + 16 = 456 > 326, so Quantity
    // and Guests stack.
    //
    // `origin/main` did not: `field: { flex: 1 }` is `flexBasis: 0`, so both
    // bases fit on one line (0 + 0 + gap <= 326) and then GREW to ~159 each,
    // which is how the pair was side by side before this change. Measured in a
    // real browser at 390: Quantity y=1634 h=106, Guests y=1756 — two rows,
    // both still 220 wide (i.e. never shrunk), confirming the wrap.
    //
    // Written as an exact baseline, like X-1: if the basis is retuned so the
    // pair fits again, THIS TEST FAILS and tells you to update it.
    const MAIN_BASIS_BEFORE_1501 = 0;
    expect(stayFieldNumMinWidth * 2 + spacing.md).toBeLessThanOrEqual(available);
    expect({
      wrapsAt390: stayFieldNumBasis * 2 + spacing.md > available,
      wouldHaveWrappedOnMain:
        MAIN_BASIS_BEFORE_1501 * 2 + spacing.sm > available,
    }).toEqual({ wrapsAt390: true, wouldHaveWrappedOnMain: false });
    await unmount(tree);
  });
});

// ===========================================================================
// CHIP — boundary attacks on the assisted list input
// ===========================================================================
describe("#1501 CHIP — nothing invalid gets past the chip door", () => {
  it("CHIP-1 — 400-case fuzz: every committed chip is trimmed, short and unique", () => {
    const alphabet = [
      "Wi-Fi",
      "wi-fi",
      "  WI-FI  ",
      "",
      "   ",
      ",",
      "a".repeat(64),
      "Sea view",
      "SEA VIEW",
      "Balcony",
      "\t\n",
      "Ensuite ",
      " Ensuite",
      "é".repeat(40),
    ];
    let values: string[] = [];
    let seed = 1501;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 400; i += 1) {
      const candidate = alphabet[next() % alphabet.length];
      const result = addChip(values, candidate);
      values = result.values;

      // INVARIANT 1 — never empty, never untrimmed.
      for (const value of values) {
        expect(value).toBe(value.trim());
        expect(value.length).toBeGreaterThan(0);
        // INVARIANT 2 — never longer than the cap.
        expect(value.length).toBeLessThanOrEqual(CHIP_MAX_LENGTH);
      }
      // INVARIANT 3 — case-insensitively unique.
      const lowered = values.map((value) => value.toLowerCase());
      expect(new Set(lowered).size).toBe(lowered.length);
      // INVARIANT 4 — never over the count cap.
      expect(values.length).toBeLessThanOrEqual(CHIP_MAX_COUNT);
    }
    expect(values.length).toBeGreaterThan(0);
  });

  it("CHIP-2 — the duplicate is REPORTED, not silently swallowed", () => {
    const first = addChip([], "Wi-Fi");
    expect(first.values).toEqual(["Wi-Fi"]);
    expect(first.duplicateOf).toBeNull();

    // Different case, same meaning -> reported against the ORIGINAL casing, so
    // the UI can point at the chip the operator already has.
    const second = addChip(first.values, "  wi-fi ");
    expect(second.values).toEqual(["Wi-Fi"]);
    expect(second.duplicateOf).toBe("Wi-Fi");
  });

  it("CHIP-3 — a typed comma commits, and a comma cannot smuggle a blank in", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    // A lone comma, a double comma, and whitespace-only fragments.
    await type(tree, "stay-offering-amenities", ",");
    expect(hasTestId(tree, "stay-offering-amenities-chips")).toBe(false);
    await type(tree, "stay-offering-amenities", " , , ,");
    expect(hasTestId(tree, "stay-offering-amenities-chips")).toBe(false);

    // A real multi-value paste commits everything before the last comma and
    // keeps the tail as the live draft.
    await type(tree, "stay-offering-amenities", "Sauna, Gym, Pool");
    expect(hasTestId(tree, "stay-offering-amenities-chip-Sauna")).toBe(true);
    expect(hasTestId(tree, "stay-offering-amenities-chip-Gym")).toBe(true);
    // "Pool" has no trailing comma, so it is still the DRAFT, not a chip.
    expect(hasTestId(tree, "stay-offering-amenities-chip-Pool")).toBe(false);
    expect(inputNode(tree, "stay-offering-amenities").props.value).toBe(" Pool");
    await unmount(tree);
  });

  it("CHIP-4 — Backspace only steals a chip when the draft is EMPTY", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-offering-amenities-suggest-Wi-Fi");
    await press(tree, "stay-offering-amenities-suggest-Balcony");
    expect(hasTestId(tree, "stay-offering-amenities-chip-Balcony")).toBe(true);

    // Draft is non-empty -> Backspace must NOT eat a chip.
    await type(tree, "stay-offering-amenities", "Sau");
    await keyPress(tree, "stay-offering-amenities", "Backspace");
    expect(hasTestId(tree, "stay-offering-amenities-chip-Balcony")).toBe(true);

    // Draft empty -> the last chip comes back as editable text.
    await type(tree, "stay-offering-amenities", "");
    await keyPress(tree, "stay-offering-amenities", "Backspace");
    expect(hasTestId(tree, "stay-offering-amenities-chip-Balcony")).toBe(false);
    expect(inputNode(tree, "stay-offering-amenities").props.value).toBe(
      "Balcony",
    );

    // A non-Backspace key never removes anything.
    await keyPress(tree, "stay-offering-amenities", "Enter");
    expect(hasTestId(tree, "stay-offering-amenities-chip-Wi-Fi")).toBe(true);
    await unmount(tree);
  });

  it("CHIP-5 — the input hard-caps length, so a long paste cannot reach the server", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    const field = inputNode(tree, "stay-offering-amenities");
    // The platform cap is declared on the field itself, so the OS keyboard and
    // a paste are both bounded — not only the reducer.
    expect(field.props.maxLength).toBe(CHIP_MAX_LENGTH);

    await type(tree, "stay-offering-amenities", "x".repeat(80));
    expect(
      (inputNode(tree, "stay-offering-amenities").props.value as string).length,
    ).toBe(CHIP_MAX_LENGTH);
    await unmount(tree);
  });

  it("CHIP-6 — a tapped suggestion leaves the row and cannot be re-added", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    expect(hasTestId(tree, "stay-offering-amenities-suggest-Ensuite")).toBe(
      true,
    );
    await press(tree, "stay-offering-amenities-suggest-Ensuite");
    expect(hasTestId(tree, "stay-offering-amenities-suggest-Ensuite")).toBe(
      false,
    );
    expect(hasTestId(tree, "stay-offering-amenities-chip-Ensuite")).toBe(true);

    // Typing it back by hand is a duplicate: the chip count must not move.
    await type(tree, "stay-offering-amenities", "ensuite");
    await submit(tree, "stay-offering-amenities");
    const chips = nodes(tree).filter((node) =>
      String(node.props?.testID ?? "").startsWith(
        "stay-offering-amenities-chip-",
      ),
    );
    // Pressable + its host View both carry the testID; count distinct ids.
    const distinct = new Set(chips.map((node) => node.props.testID as string));
    expect(distinct.size).toBe(1);
    await unmount(tree);
  });

  it("CHIP-7 — the suggestion set is KIND-AWARE, not one hard-coded list", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    // Room vocabulary.
    expect(hasTestId(tree, "stay-offering-amenities-suggest-Ensuite")).toBe(
      true,
    );
    expect(
      hasTestId(tree, "stay-offering-amenities-suggest-Sun loungers"),
    ).toBe(false);
    // Switching to a Place swaps the vocabulary — no bed words.
    await press(tree, "stay-add-place");
    expect(hasTestId(tree, "stay-offering-amenities-suggest-Ensuite")).toBe(
      false,
    );
    expect(
      hasTestId(tree, "stay-offering-amenities-suggest-Sun loungers"),
    ).toBe(true);
    await unmount(tree);
  });
});

// ===========================================================================
// NB — NameBuilder arithmetic
// ===========================================================================
describe("#1501 NB — the name pattern arithmetic holds at its edges", () => {
  it("NB-1 — padding is inferred from the OPERATOR's own `From` string", () => {
    // `01` means two-wide, and must NOT collapse to 1..12.
    expect(buildPatternNames("Room", "01", "12")).toEqual([
      "Room 01",
      "Room 02",
      "Room 03",
      "Room 04",
      "Room 05",
      "Room 06",
      "Room 07",
      "Room 08",
      "Room 09",
      "Room 10",
      "Room 11",
      "Room 12",
    ]);
    // Three-wide.
    expect(buildPatternNames("Suite", "001", "003")).toEqual([
      "Suite 001",
      "Suite 002",
      "Suite 003",
    ]);
    // No leading zero -> no padding, and the run crosses the width boundary
    // without re-padding.
    expect(buildPatternNames("Room", "99", "101")).toEqual([
      "Room 99",
      "Room 100",
      "Room 101",
    ]);
    // A prefix ending in punctuation joins without a space; an empty prefix
    // yields the bare number.
    expect(buildPatternNames("Suite-", "1", "2")).toEqual([
      "Suite-1",
      "Suite-2",
    ]);
    expect(buildPatternNames("", "1", "2")).toEqual(["1", "2"]);
    expect(buildPatternNames("Room  ", "1", "1")).toEqual(["Room 1"]);
  });

  it("NB-2 — a descending or malformed range produces NOTHING", () => {
    // To < From.
    expect(patternRangeCount("120", "101")).toBe(0);
    expect(buildPatternNames("Room", "120", "101")).toEqual([]);
    // Negative.
    expect(patternRangeCount("-3", "5")).toBe(0);
    expect(patternRangeCount("1", "-5")).toBe(0);
    // Empty / whitespace / alphabetic — never a range.
    for (const bad of ["", "   ", "abc", "one", "+", "-", "."]) {
      expect(patternRangeCount(bad, "10")).toBe(0);
      expect(patternRangeCount("1", bad)).toBe(0);
      expect(buildPatternNames("Room", bad, "10")).toEqual([]);
    }
    // A single-value range is legal and yields exactly one name.
    expect(patternRangeCount("7", "7")).toBe(1);
    expect(buildPatternNames("Room", "7", "7")).toEqual(["Room 7"]);
  });

  it("NB-3 — the range is COUNTED without being materialised", () => {
    // A 999,999-wide range must be a number, not an out-of-memory event: the
    // cap has to be judged before anything is built.
    const started = Date.now();
    expect(patternRangeCount("1", "999999")).toBe(999999);
    expect(buildPatternNames("Room", "1", "999999")).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("NB-4 — EXACTLY 500 is allowed and 501 is refused, at the server's bound", async () => {
    // Pure boundary first.
    expect(buildPatternNames("Room", "1", "500")).toHaveLength(
      NAME_LIST_HARD_CAP,
    );
    expect(buildPatternNames("Room", "1", "501")).toEqual([]);

    // Then through the real control, which is what an operator touches.
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "500");
    expect(hasTestId(tree, "stay-bulk-names-cap")).toBe(false);
    const addAt500 = findByTestId(tree, "stay-bulk-names-add-pattern");
    expect(addAt500?.props.disabled).toBe(false);
    expect(addAt500?.props.label).toBe("Add 500 names");

    // One more than the server accepts must be refused BY THE CLIENT, with the
    // approved words — never handed to `stay_invalid_bulk_request`.
    await type(tree, "stay-bulk-names-to", "501");
    expect(hasTestId(tree, "stay-bulk-names-cap")).toBe(true);
    expect(renderedText(tree)).toContain(NAME_LIST_OVER_CAP_COPY);
    expect(findByTestId(tree, "stay-bulk-names-add-pattern")?.props.disabled).toBe(
      true,
    );
    await unmount(tree);
  });

  it("NB-5 — the cap counts what the operator ALREADY has, not just the range", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    // Build 400.
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "400");
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("400 names ready");

    // 400 + 100 = exactly the server's 500: still allowed.
    await type(tree, "stay-bulk-names-from", "1001");
    await type(tree, "stay-bulk-names-to", "1100");
    expect(hasTestId(tree, "stay-bulk-names-cap")).toBe(false);

    // 400 + 101 = 501: refused. A range-only cap would have missed this.
    await type(tree, "stay-bulk-names-to", "1101");
    expect(hasTestId(tree, "stay-bulk-names-cap")).toBe(true);
    await unmount(tree);
  });

  it("NB-6 — duplicates are skipped, counted accurately, and idempotent", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-from", "101");
    await type(tree, "stay-bulk-names-to", "110");
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("10 names ready");

    // Overlap 105..115 -> 6 already held, 5 new.
    await type(tree, "stay-bulk-names-from", "105");
    await type(tree, "stay-bulk-names-to", "115");
    expect(hasTestId(tree, "stay-bulk-names-skipped")).toBe(true);
    expect(renderedText(tree)).toContain("6 you already had are skipped.");
    expect(findByTestId(tree, "stay-bulk-names-add-pattern")?.props.label).toBe(
      "Add 5 names",
    );
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("15 names ready");

    // Pressing again adds nothing and says so in the singular/plural correctly.
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("15 names ready");
    expect(renderedText(tree)).toContain("11 you already had are skipped.");

    // Exactly one duplicate reads as singular.
    await type(tree, "stay-bulk-names-from", "115");
    await type(tree, "stay-bulk-names-to", "116");
    expect(renderedText(tree)).toContain("1 you already had is skipped.");
    await unmount(tree);
  });

  it("NB-7 — the pattern fields SURVIVE Add, so 201-220 is an edit not a retype", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-prefix", "Garden Suite");
    await type(tree, "stay-bulk-names-from", "101");
    await type(tree, "stay-bulk-names-to", "120");
    await press(tree, "stay-bulk-names-add-pattern");

    expect(inputNode(tree, "stay-bulk-names-prefix").props.value).toBe(
      "Garden Suite",
    );
    expect(inputNode(tree, "stay-bulk-names-from").props.value).toBe("101");
    expect(inputNode(tree, "stay-bulk-names-to").props.value).toBe("120");

    // Two edits, not two retypes.
    await type(tree, "stay-bulk-names-from", "201");
    await type(tree, "stay-bulk-names-to", "220");
    await press(tree, "stay-bulk-names-add-pattern");
    expect(renderedText(tree)).toContain("40 names ready");
    expect(renderedText(tree)).toContain("Garden Suite 201");
    await unmount(tree);
  });

  it("NB-8 — above 50 warns and still lets the operator through", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    // Exactly the threshold: no warning.
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", String(NAME_LIST_SOFT_WARN));
    expect(hasTestId(tree, "stay-bulk-names-soft-warn")).toBe(false);
    // One over: warned, never blocked.
    await type(tree, "stay-bulk-names-to", String(NAME_LIST_SOFT_WARN + 1));
    expect(hasTestId(tree, "stay-bulk-names-soft-warn")).toBe(true);
    expect(findByTestId(tree, "stay-bulk-names-add-pattern")?.props.disabled).toBe(
      false,
    );
    await unmount(tree);
  });
});

// ===========================================================================
// D4 / D5 — the approved decisions, attacked
// ===========================================================================
describe("#1501 D-4 — bulk + named is unreachable, not merely hidden", () => {
  it("D4-1 — a stale 'Each one is named' cannot reach ANY item of the batch", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    // Turn named ON and give it unit names while still in single mode…
    await press(tree, "stay-units-named");
    await type(tree, "stay-unit-names", "Room 101");
    await submit(tree, "stay-unit-names");
    expect(hasTestId(tree, "stay-unit-names-chip-Room 101")).toBe(true);

    // …then switch to "Add several". The control disappears and the caption
    // explains why — an option you cannot use is noise.
    await press(tree, "stay-add-bulk");
    expect(hasTestId(tree, "stay-units-named")).toBe(false);
    expect(hasTestId(tree, "stay-units-pooled")).toBe(false);
    expect(hasTestId(tree, "stay-unit-names")).toBe(false);
    expect(hasTestId(tree, "stay-units-bulk-note")).toBe(true);

    await type(tree, "stay-offering-quantity", "4");
    await type(tree, "stay-bulk-names-prefix", "Room");
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "3");
    await press(tree, "stay-bulk-names-add-pattern");

    mockBulkCreate.mockResolvedValue({
      job: { succeeded_count: 3, failed_count: 0 },
    });
    mockManageInventory.mockResolvedValue(SNAPSHOT);
    await TestRenderer.act(async () => {
      await latestSave().mutationFn();
    });

    const payload = mockBulkCreate.mock.calls[0][0] as {
      items: { unitNamingMode: string; units?: unknown; quantity?: number }[];
    };
    expect(payload.items).toHaveLength(3);
    // EVERY item, not just the first: the data trap was one shared list being
    // written into all N offerings.
    for (const item of payload.items) {
      expect(item.unitNamingMode).toBe("interchangeable");
      expect(item.units).toBeUndefined();
      // Quantity comes from the typed count, never from the stale name list.
      expect(item.quantity).toBe(4);
    }
    await unmount(tree);
  });
});

describe("#1501 D-5 — the derived count cannot desync from the name list", () => {
  it("D5-1 — the count TRACKS add and remove, and is not merely locked", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    // A typed quantity that must never survive into the derived state.
    await type(tree, "stay-offering-quantity", "9");
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("9");

    await press(tree, "stay-units-named");
    // No names yet -> zero, not the stale 9.
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("0");
    expect(inputNode(tree, "stay-offering-quantity").props.editable).toBe(false);

    await type(tree, "stay-unit-names-from", "101");
    await type(tree, "stay-unit-names-to", "103");
    await press(tree, "stay-unit-names-add-pattern");
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("3");

    // Remove one: the count follows DOWN too. A one-way derive would pass a
    // naive "it shows 3" assertion and still be wrong.
    await press(tree, "stay-unit-names-chip-Room 102");
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("2");

    // Attempting to type into it changes nothing — the value is DERIVED, not
    // just visually disabled.
    await type(tree, "stay-offering-quantity", "77");
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("2");

    // The helper explains the read-only state rather than leaving it a mystery.
    expect(renderedText(tree)).toContain("Set by the names below.");
    await unmount(tree);
  });

  it("D5-2 — the payload's quantity always equals the units it ships", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await type(tree, "stay-offering-name", "Standard double");
    await press(tree, "stay-units-named");
    await type(tree, "stay-unit-names-from", "1");
    await type(tree, "stay-unit-names-to", "6");
    await press(tree, "stay-unit-names-add-pattern");
    await press(tree, "stay-unit-names-chip-Room 3");

    mockCreateOffering.mockResolvedValue({ inventory: SNAPSHOT });
    await TestRenderer.act(async () => {
      await latestSave().mutationFn();
    });
    const offering = (
      mockCreateOffering.mock.calls[0][0] as {
        offering: { quantity: number; units: { name: string }[] };
      }
    ).offering;
    // The server rejects `quantity !== units.length`; this proves the client
    // can no longer construct that request at all.
    expect(offering.units).toHaveLength(5);
    expect(offering.quantity).toBe(offering.units.length);
    expect(offering.units.map((unit) => unit.name)).not.toContain("Room 3");
    await unmount(tree);
  });

  it("D5-3 — turning naming back OFF restores the operator's own number", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await type(tree, "stay-offering-quantity", "9");
    await press(tree, "stay-units-named");
    await type(tree, "stay-unit-names-from", "1");
    await type(tree, "stay-unit-names-to", "2");
    await press(tree, "stay-unit-names-add-pattern");
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("2");

    await press(tree, "stay-units-pooled");
    // The derived 2 must not have overwritten the typed 9.
    expect(inputNode(tree, "stay-offering-quantity").props.value).toBe("9");
    expect(inputNode(tree, "stay-offering-quantity").props.editable).toBe(true);
    await unmount(tree);
  });
});

// ===========================================================================
// PERM — the permission gates, audited generically
// ===========================================================================
describe("#1501 PERM — a role that cannot edit cannot edit ANYTHING", () => {
  /**
   * Controls that MUST stay live even without Stay inventory permission, each
   * with the reason. Anything else interactive is a permission hole.
   * - `stay-offering-save`: a finance-only role still saves prices.
   * - the money fields: they render only when `canManageFinance` is true.
   */
  const FINANCE_ONLY_ALLOWED = new Set<string>([
    "stay-offering-save",
    "stay-offering-price",
    "stay-offering-fee-amount",
    "stay-offering-fee-label",
    "stay-offering-policy",
    "stay-offering-no-show",
  ]);

  const interactiveStayControls = (
    tree: RenderTree,
  ): { testID: string; live: boolean }[] => {
    const seen = new Map<string, boolean>();
    for (const node of nodes(tree)) {
      const testID = node.props?.testID;
      if (typeof testID !== "string" || !testID.startsWith("stay-")) continue;
      const pressable = typeof node.props.onPress === "function";
      const typeable = typeof node.props.onChangeText === "function";
      if (!pressable && !typeable) continue;
      const live = pressable
        ? node.props.disabled !== true
        : node.props.editable !== false;
      seen.set(testID, (seen.get(testID) ?? false) || live);
    }
    return [...seen.entries()].map(([testID, live]) => ({ testID, live }));
  };

  it("PERM-0 — VACUITY GUARD: the auditor finds live controls when allowed", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    const controls = interactiveStayControls(tree);
    expect(controls.length).toBeGreaterThan(10);
    expect(controls.filter((control) => control.live).length).toBeGreaterThan(
      10,
    );
    await unmount(tree);
  });

  it("PERM-1 — `canManageInventory === false` leaves no inventory control live", async () => {
    const tree = await mount(
      <OfferingEditor
        {...BASE_PROPS}
        existing={EXISTING_ROOM as unknown as null}
        canManageInventory={false}
      />,
    );
    const live = interactiveStayControls(tree)
      .filter((control) => control.live)
      .map((control) => control.testID)
      .filter((testID) => !FINANCE_ONLY_ALLOWED.has(testID))
      .sort();
    expect(live).toEqual([]);

    // …and the role is TOLD why, rather than left tapping dead controls.
    expect(renderedText(tree)).toContain(
      "Your role can manage prices, fees and policies, but not Room or Place details.",
    );
    // Photos are removed entirely, not disabled — an upload it cannot do.
    expect(hasTestId(tree, "stay-section-photos")).toBe(false);
    expect(hasTestId(tree, "stay-offering-add-photos")).toBe(false);
    await unmount(tree);
  });

  it("PERM-2 — `canManageFinance === false` shows the note and hides every money field", async () => {
    const tree = await mount(
      <OfferingEditor {...BASE_PROPS} canManageFinance={false} />,
    );
    // The contract testID the Stay suite reads.
    expect(hasTestId(tree, "stay-finance-permission-copy")).toBe(true);
    expect(renderedText(tree)).toContain(
      "Pricing, fees and cancellation policies require Stay finance permission. You can save this as an unpriced draft.",
    );
    for (const testID of [
      "stay-offering-price",
      "stay-offering-fee-amount",
      "stay-offering-fee-label",
      "stay-offering-policy",
      "stay-offering-no-show",
    ]) {
      expect(hasTestId(tree, testID)).toBe(false);
    }
    // The section itself still renders, so the operator knows money EXISTS.
    expect(hasTestId(tree, "stay-section-money")).toBe(true);
    await unmount(tree);
  });

  it("PERM-3 — a finance-blind, inventory-blind role cannot save at all", async () => {
    const tree = await mount(
      <OfferingEditor
        {...BASE_PROPS}
        existing={EXISTING_ROOM as unknown as null}
        canManageInventory={false}
        canManageFinance={false}
      />,
    );
    expect(findByTestId(tree, "stay-offering-save")?.props.disabled).toBe(true);
    expect(hasTestId(tree, "stay-finance-permission-copy")).toBe(true);
    await unmount(tree);
  });

  it("PERM-4 — a blocked role's price never reaches the payload", async () => {
    const tree = await mount(
      <OfferingEditor {...BASE_PROPS} canManageFinance={false} />,
    );
    await type(tree, "stay-offering-name", "Standard double");
    mockCreateOffering.mockResolvedValue({ inventory: SNAPSHOT });
    await TestRenderer.act(async () => {
      await latestSave().mutationFn();
    });
    const offering = (
      mockCreateOffering.mock.calls[0][0] as {
        offering: { price?: unknown; fees: unknown[]; policy?: unknown };
      }
    ).offering;
    expect(offering.price).toBeUndefined();
    expect(offering.fees).toEqual([]);
    expect(offering.policy).toBeUndefined();
    await unmount(tree);
  });
});

// ===========================================================================
// RC — the partial-failure banner
// ===========================================================================
describe("#1501 RC — the banner describes THIS attempt and nothing else", () => {
  it("RC-1 — failure, then a WORSE failure, then success: closes exactly once", async () => {
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "3");
    await press(tree, "stay-bulk-names-add-pattern");
    mockManageInventory.mockResolvedValue(SNAPSHOT);

    // ATTEMPT 1 — 2 of 3 land.
    mockBulkCreate.mockResolvedValueOnce({
      job: { succeeded_count: 2, failed_count: 1 },
    });
    let save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      const data = await save.mutationFn();
      save.onSuccess?.(data);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(renderedText(tree)).toContain("2 created; 1 need review.");

    // ATTEMPT 2 — a DIFFERENT partial failure. A banner that still reads "2
    // created; 1 need review" is the write-once bug wearing a new coat.
    mockBulkCreate.mockResolvedValueOnce({
      job: { succeeded_count: 1, failed_count: 2 },
    });
    save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      const data = await save.mutationFn();
      save.onSuccess?.(data);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(renderedText(tree)).toContain("1 created; 2 need review.");
    expect(renderedText(tree)).not.toContain("2 created; 1 need review.");

    // ATTEMPT 3 — clean. The banner clears and the editor finally closes.
    mockBulkCreate.mockResolvedValueOnce({
      job: { succeeded_count: 3, failed_count: 0 },
    });
    save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      const data = await save.mutationFn();
      save.onSuccess?.(data);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasTestId(tree, "stay-offering-result")).toBe(false);
    await unmount(tree);
  });

  it("RC-2 — the reset happens BEFORE the attempt, not after it", async () => {
    // Ordering matters: clearing on success would leave the stale banner up for
    // the whole duration of a slow request, which is when an operator reads it.
    const tree = await mount(<OfferingEditor {...BASE_PROPS} />);
    await press(tree, "stay-add-bulk");
    await type(tree, "stay-bulk-names-from", "1");
    await type(tree, "stay-bulk-names-to", "2");
    await press(tree, "stay-bulk-names-add-pattern");
    mockManageInventory.mockResolvedValue(SNAPSHOT);
    mockBulkCreate.mockResolvedValueOnce({
      job: { succeeded_count: 1, failed_count: 1 },
    });

    let save = latestSave();
    await TestRenderer.act(async () => {
      save.onMutate?.();
      const data = await save.mutationFn();
      save.onSuccess?.(data);
    });
    expect(hasTestId(tree, "stay-offering-result")).toBe(true);

    // Fire ONLY `onMutate` — the banner must already be gone before any
    // response comes back.
    save = latestSave();
    await TestRenderer.act(() => {
      save.onMutate?.();
    });
    expect(hasTestId(tree, "stay-offering-result")).toBe(false);
    await unmount(tree);
  });
});
