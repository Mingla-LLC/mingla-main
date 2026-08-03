/**
 * Issue #1501 [add-rooms-form] — THE CALL-SITE HALF OF `I-AXIS-SCOPED-FLEX`.
 *
 * WHY THIS EXISTS. The first #1501 guard
 * (`stayFieldAxis.issue1501.render.test.tsx`) pins the STYLE DEFINITIONS — that
 * `fieldStack` carries no flex-axis key, that `fieldNum` declares an explicit
 * measure. Necessary, and not sufficient: the tester found the bug it could not
 * see (P2-1), a `span="num"` on a field that is not in a row. The required
 * `span` prop enforces that an axis is CHOSEN; nothing enforced that the chosen
 * axis matches the ACTUAL PARENT.
 *
 * WHY IT WAS REWRITTEN. The first version of this file closed that one hole and
 * the tester then defeated it three ways, each a single-token `span` change:
 *
 *   A2  `stay-offering-fee-amount` num->stack, in the PRICE row — a row this
 *       file did not name by hand.                              -> was GREEN
 *   B   `stay-night-quantity`      num->stack, in the AVAILABILITY manager —
 *       which owns 7 of the 17 call sites and no #1501 suite rendered at all.
 *                                                               -> was GREEN
 *   C   `stay-offering-capacity`   num->stack, reachable only on
 *       Place + "Shared by the spot" — a branch never rendered.  -> was GREEN
 *
 * Every defeat had the same shape: the guard knew about the fields a human had
 * remembered to list, in the states a human had remembered to render. A guard
 * that needs someone to remember drifts the moment someone forgets — which is
 * how this bug class shipped three times (#1484, #1501 P2-1, #1501 P2-2).
 *
 * SO THIS FILE NAMES NOTHING.
 *
 *   1. DISCOVERY, not enumeration. `discoverFields` walks the rendered tree and
 *      audits every `*-field` wrapper it finds, carrying each node's INHERITED
 *      `flexDirection`. A field added tomorrow is audited tomorrow, by default.
 *   2. BOTH HALVES of the rule, because the bug class is symmetrical:
 *        (a) COLUMN — no field may resolve a flex-axis key (a width measure
 *            silently resolving against the height: P2-1, and #1484's
 *            `flexBasis: 320`);
 *        (b) ROW — every field must declare an explicit basis and must NOT
 *            claim `width: "100%"` (a full-width child takes the whole line and
 *            pushes its sibling down: P2-2, and the crushed "Starts with" field
 *            SPEC AMENDMENT 1 was written about).
 *   3. A STATE SWEEP that reaches every progressive-disclosure branch — Room /
 *      Place, one / several, interchangeable / named, booked-whole / shared,
 *      finance-blocked, edit mode, desktop / phone — AND the availability
 *      manager for both a Room and a Place.
 *   4. A COVERAGE ASSERTION derived FROM THE SOURCE. C-0 parses every
 *      `<LabeledInput testID="…">` out of `StayInventoryManager.tsx` and fails
 *      unless the sweep actually rendered all of them. That is what stops the
 *      sweep rotting: add a field in a branch nothing reaches and C-0 fails,
 *      naming it, until the sweep is extended.
 *
 * FAILS-ON-REVERT — the tester's three defeats, each now RED (proofs in the
 * #1501 report):
 *   A2 fee-amount  num->stack  => C-2 (the row half)
 *   B  night-qty   num->stack  => C-2, via the availability sweep
 *   C  capacity    num->stack  => C-2, via the Place+Shared state
 * plus the two this file already held:
 *   refund field   stack->num  => C-1 + C-3
 *   fieldNum back to a fixed basis / minWidth 140 => C-4 / C-5
 *
 * Append-only: this file is NEW in this branch (the gate reports it as ADDED).
 * Rewritten in place under [TEST-MOD-APPROVED #1501] to close the three
 * defeats. It modifies no test owned by anyone else.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1501.render.cjs --runInBand
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";
import { StyleSheet } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  children?: RenderTreeNode[];
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

// Mutable so the sweep can hand the availability manager real offerings and
// flip the permission branches.
let mockPermissions = { canManageInventory: true, canManageFinance: true };
let mockOfferings: unknown[] = [];
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: {
    all: ["stay-inventory"],
    detail: (venueId: string) => ["stay-inventory", venueId],
  },
  useStayInventory: () => ({
    data: {
      settings: { timezone: "Africa/Lagos" },
      offerings: mockOfferings,
      permissions: mockPermissions,
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
  stayFieldNumMinWidth,
} from "../../../constants/designSystem";
import { StayInventoryManager } from "../StayInventoryManager";

type Flat = Record<string, unknown>;

/** Every key that resolves against a flex container's MAIN axis. */
const FLEX_AXIS_KEYS = ["flex", "flexGrow", "flexShrink", "flexBasis"] as const;

const ROOM_OFFERING = {
  id: "off-room",
  kind: "room" as const,
  name: "Ocean-view double",
  description: "A room",
  status: "draft" as const,
  version: 1,
  quantity: 4,
  capacity: null,
  max_guests: 2,
  confirmation_mode: "instant" as const,
  unit_naming_mode: "named" as const,
  inventory_basis: "pooled_units" as const,
  access_scope: "public" as const,
  amenities: ["Wi-Fi"],
  units: [{ id: "u1", name: "Room 101", status: "active" }],
  media: [],
  currentPrice: null,
  currentPolicy: null,
  currentFees: [],
  hasOpenAvailability: false,
  nextAvailability: null,
  roomNights: [],
  placeWindows: [],
  placeScheduleRules: [],
};

const PLACE_OFFERING = {
  ...ROOM_OFFERING,
  id: "off-place",
  kind: "place" as const,
  name: "Pool cabana",
  unit_naming_mode: "interchangeable" as const,
  inventory_basis: "exclusive_units" as const,
};

const PROPS = { brandId: "brand-1501", venueId: "venue-1501" };

interface AuditedField {
  testID: string;
  parentDirection: "row" | "column";
  style: Flat;
  state: string;
}

/**
 * DISCOVERY — every `*-field` wrapper in the tree, with the axis its parent
 * actually lays out on. Nothing is named; whatever renders is audited.
 *
 * ONLY A HOST NODE ESTABLISHES A LAYOUT CONTEXT. `react-test-renderer` surfaces
 * the composite element AND the host element for the same `<View>`, and
 * composites like `LabeledInput` carry no style at all — treating those as
 * containers would reset every field's inherited direction to "column" and
 * report the whole form as a violation. Composites are transparent; a host view
 * with no explicit `flexDirection` lays its children out in a COLUMN (React
 * Native's default), which is the assumption the shipped bug violated.
 */
function discoverFields(tree: RenderTree, state: string): AuditedField[] {
  const out: AuditedField[] = [];
  const visit = (
    node: RenderTreeNode,
    parentDirection: "row" | "column",
  ): void => {
    const style = (StyleSheet.flatten(node.props?.style as never) ?? {}) as Flat;
    const testID = node.props?.testID;
    const isHost = typeof node.type === "string";
    if (isHost && typeof testID === "string" && testID.endsWith("-field")) {
      out.push({ testID, parentDirection, style, state });
    }
    const own: "row" | "column" = isHost
      ? style.flexDirection === "row"
        ? "row"
        : "column"
      : parentDirection;
    for (const child of node.children ?? []) {
      if (typeof child === "object" && child !== null) visit(child, own);
    }
  };
  visit(tree.root, "column");
  return out;
}

/** Unmount inside `act`, so React's teardown effects do not warn. */
async function unmount(tree: RenderTree): Promise<void> {
  await TestRenderer.act(() => {
    tree.unmount();
  });
}

async function press(tree: RenderTree, testID: string): Promise<void> {
  const node = tree.root
    .findAll(() => true)
    .find(
      (candidate) =>
        candidate.props?.testID === testID &&
        typeof candidate.props?.onPress === "function",
    );
  // A step that cannot run would silently shrink the sweep — fail loudly.
  expect({ testID, found: node !== undefined }).toEqual({ testID, found: true });
  await TestRenderer.act(() => {
    ((node as RenderTreeNode).props.onPress as () => void)();
  });
}

interface SweepState {
  name: string;
  wide: boolean;
  mode: "inventory" | "availability";
  offerings: unknown[];
  permissions: { canManageInventory: boolean; canManageFinance: boolean };
  steps: string[];
}

const BOTH = { canManageInventory: true, canManageFinance: true };
const NO_MONEY = { canManageInventory: true, canManageFinance: false };

/**
 * THE SWEEP — every progressive-disclosure branch the operator can reach.
 * Defeats B and C both worked by hiding in a branch nothing rendered, so the
 * branches ARE the protection, not a detail of the harness.
 */
const SWEEP: SweepState[] = [
  // ---- the editor -------------------------------------------------------
  {
    name: "create/room/one/interchangeable/desktop",
    wide: true,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: ["stay-inventory-add"],
  },
  {
    name: "create/room/one/named/desktop",
    wide: true,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: ["stay-inventory-add", "stay-units-named"],
  },
  {
    name: "create/room/several/desktop",
    wide: true,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: ["stay-inventory-add", "stay-add-bulk"],
  },
  {
    name: "create/place/one/booked-whole/desktop",
    wide: true,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: ["stay-inventory-add", "stay-add-place"],
  },
  {
    // DEFEAT C's branch: `stay-offering-capacity` renders ONLY here.
    name: "create/place/one/shared-by-the-spot/desktop",
    wide: true,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: ["stay-inventory-add", "stay-add-place", "stay-place-capacity"],
  },
  {
    name: "create/place/several/shared/phone",
    wide: false,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: [
      "stay-inventory-add",
      "stay-add-place",
      "stay-add-bulk",
      "stay-place-capacity",
    ],
  },
  {
    name: "create/room/one/finance-blocked/desktop",
    wide: true,
    mode: "inventory",
    offerings: [],
    permissions: NO_MONEY,
    steps: ["stay-inventory-add"],
  },
  {
    name: "create/room/one/phone",
    wide: false,
    mode: "inventory",
    offerings: [],
    permissions: BOTH,
    steps: ["stay-inventory-add"],
  },
  {
    name: "edit/existing-room/desktop",
    wide: true,
    mode: "inventory",
    offerings: [ROOM_OFFERING],
    permissions: BOTH,
    steps: [`stay-edit-${ROOM_OFFERING.id}`],
  },
  // ---- the AVAILABILITY manager (defeat B: 7 of the 17 call sites) -------
  {
    name: "availability/room/desktop",
    wide: true,
    mode: "availability",
    offerings: [ROOM_OFFERING, PLACE_OFFERING],
    permissions: BOTH,
    steps: [],
  },
  {
    name: "availability/room/finance-blocked/phone",
    wide: false,
    mode: "availability",
    offerings: [ROOM_OFFERING],
    permissions: NO_MONEY,
    steps: [],
  },
  {
    name: "availability/place/fixed/desktop",
    wide: true,
    mode: "availability",
    offerings: [PLACE_OFFERING, ROOM_OFFERING],
    permissions: BOTH,
    steps: [],
  },
  {
    name: "availability/place/repeating/phone",
    wide: false,
    mode: "availability",
    offerings: [PLACE_OFFERING],
    permissions: BOTH,
    steps: ["stay-place-repeating"],
  },
  {
    name: "availability/place/full-day/desktop",
    wide: true,
    mode: "availability",
    offerings: [PLACE_OFFERING],
    permissions: BOTH,
    steps: ["stay-place-full-day"],
  },
];

async function auditSweep(): Promise<AuditedField[]> {
  const all: AuditedField[] = [];
  for (const state of SWEEP) {
    mockIsWideDesktop = state.wide;
    mockOfferings = state.offerings;
    mockPermissions = state.permissions;
    const tree = await mount(
      <StayInventoryManager {...PROPS} mode={state.mode} />,
    );
    for (const step of state.steps) await press(tree, step);
    all.push(...discoverFields(tree, state.name));
    await unmount(tree);
  }
  return all;
}

/**
 * THE COVERAGE ORACLE — every `<LabeledInput testID="…">` in the component's
 * SOURCE. Derived, never hand-listed: this is what makes C-0 fail when someone
 * adds a field in a branch the sweep cannot reach, instead of quietly ignoring
 * it the way the previous version did.
 */
function sourceFieldIds(): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "StayInventoryManager.tsx"),
    "utf8",
  );
  const ids: string[] = [];
  for (const block of source.split("<LabeledInput").slice(1)) {
    const element = block.slice(0, block.indexOf("/>"));
    const match = /testID="([\w-]+)"/.exec(element);
    if (match) ids.push(match[1]);
  }
  return [...new Set(ids)].sort();
}

function has(flat: Flat, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(flat, key);
}

beforeEach(() => {
  mockIsWideDesktop = true;
  mockOfferings = [];
  mockPermissions = BOTH;
});

describe("#1501 — the CALL SITE's axis matches its real parent", () => {
  it("C-0 — COVERAGE: the sweep renders EVERY field the source declares", async () => {
    const discovered = new Set(
      (await auditSweep()).map((field) => field.testID.replace(/-field$/, "")),
    );
    const declared = sourceFieldIds();

    // Vacuity guard on the oracle itself: if the parse broke, "every declared
    // field was rendered" would be trivially true.
    expect(declared.length).toBeGreaterThanOrEqual(17);
    expect(declared).toContain("stay-offering-no-show");
    expect(declared).toContain("stay-night-quantity");

    // THE ANTI-DRIFT CLAUSE. A field added in a branch the sweep cannot reach
    // fails HERE, by name, instead of going unaudited — which is exactly how
    // defeats B and C stayed green.
    expect(declared.filter((id) => !discovered.has(id))).toEqual([]);
  });

  it("C-1 — COLUMN: no discovered field resolves a flex-axis key, in any state", async () => {
    const offenders: string[] = [];
    for (const field of await auditSweep()) {
      if (field.parentDirection !== "column") continue;
      for (const key of FLEX_AXIS_KEYS) {
        if (has(field.style, key)) {
          offenders.push(`${field.state} :: ${field.testID}.${key}`);
        }
      }
    }
    // EXACT EMPTY — not an allow-list. A width measure resolving against the
    // height is the #1484 / #1501-P2-1 defect, whatever style it came from.
    expect(offenders).toEqual([]);
  });

  it("C-2 — ROW: every discovered field declares a basis and never claims the line", async () => {
    const offenders: string[] = [];
    for (const field of await auditSweep()) {
      if (field.parentDirection !== "row") continue;
      // `flex: 1` on every sibling is not a layout (SPEC AMENDMENT 1).
      if (!has(field.style, "flexBasis")) {
        offenders.push(`${field.state} :: ${field.testID} has no flexBasis`);
      }
      // A full-width child in a wrapping row takes the WHOLE line and pushes
      // its sibling onto the next one — P2-2, and the crushed "Starts with"
      // field. This is the mirror of C-1, and the half that was missing.
      if (field.style.width === "100%") {
        offenders.push(`${field.state} :: ${field.testID} claims width 100%`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("C-3 — the refund field is a STACK measure, like its two siblings", async () => {
    mockIsWideDesktop = true;
    const tree = await mount(
      <StayInventoryManager {...PROPS} mode="inventory" />,
    );
    await press(tree, "stay-inventory-add");
    const byId = new Map(
      discoverFields(tree, "refund").map((field) => [field.testID, field]),
    );

    const refund = byId.get("stay-offering-no-show-field");
    expect(refund).toBeDefined();
    // It lives in the money section's COLUMN...
    expect((refund as AuditedField).parentDirection).toBe("column");
    // ...so it must carry the stacked measure, exactly like the fields either
    // side of it. A row measure here rendered a 220pt-tall box.
    for (const id of [
      "stay-offering-fee-label-field",
      "stay-offering-policy-field",
      "stay-offering-no-show-field",
    ]) {
      const field = byId.get(id) as AuditedField;
      expect({ id, width: field.style.width }).toEqual({ id, width: "100%" });
      expect({ id, basis: has(field.style, "flexBasis") }).toEqual({
        id,
        basis: false,
      });
    }
    await unmount(tree);
  });

  it("C-4 — the numeric pair SHARES a line instead of demanding its width", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(
      <StayInventoryManager {...PROPS} mode="inventory" />,
    );
    await press(tree, "stay-inventory-add");
    const byId = new Map(
      discoverFields(tree, "pair").map((field) => [field.testID, field]),
    );

    for (const id of [
      "stay-offering-quantity-field",
      "stay-offering-guests-field",
    ]) {
      const field = byId.get(id) as AuditedField;
      expect(field).toBeDefined();
      expect({ id, parent: field.parentDirection }).toEqual({
        id,
        parent: "row",
      });
      // A ZERO basis is what lets the pair share one line; the desktop measure
      // is a CAP it grows into, not a width it demands up front.
      expect({ id, basis: field.style.flexBasis }).toEqual({ id, basis: 0 });
      expect({ id, grow: field.style.flexGrow }).toEqual({ id, grow: 1 });
      expect({ id, cap: field.style.maxWidth }).toEqual({
        id,
        cap: stayFieldNumMaxWidth,
      });
    }
    await unmount(tree);
  });

  it("C-5 — the pair fits on ONE line at 390pt AND at 320pt", () => {
    // `flexWrap` breaks a line on each item's HYPOTHETICAL MAIN SIZE — the flex
    // basis clamped by min/max-width — BEFORE any shrinking. With a zero basis
    // that is `minWidth`, so the floor is what decides whether a phone wraps.
    const contentBox = (device: number): number =>
      device - spacing.md * 2 - spacing.md * 2;
    expect(contentBox(390)).toBe(326);
    expect(contentBox(320)).toBe(256);

    const pairFootprint = stayFieldNumMinWidth * 2 + spacing.md;
    for (const device of [390, 320]) {
      expect({
        device,
        fitsOnOneLine: pairFootprint <= contentBox(device),
      }).toEqual({ device, fitsOnOneLine: true });
    }

    // ...and the OLD basis-driven sizing genuinely could not: the arithmetic of
    // the reported regression, kept so the fix stays falsifiable.
    expect(stayFieldNumMaxWidth * 2 + spacing.md).toBeGreaterThan(
      contentBox(390),
    );

    for (const [device, expected] of [
      [390, 155],
      [320, 120],
    ] as const) {
      expect({
        device,
        each: (contentBox(device) - spacing.md) / 2,
      }).toEqual({ device, each: expected });
      expect(expected).toBeGreaterThanOrEqual(stayFieldNumMinWidth);
      expect(expected).toBeLessThanOrEqual(stayFieldNumMaxWidth);
    }
  });

  it("C-6 — a desktop column still stops the numeric box at its measure", () => {
    const formColumnContent = 760 - spacing.md * 2;
    const uncapped = (formColumnContent - spacing.md) / 2;
    expect(uncapped).toBeGreaterThan(stayFieldNumMaxWidth);
    expect(Math.min(uncapped, stayFieldNumMaxWidth)).toBe(stayFieldNumMaxWidth);
  });

  it("C-7 — the AVAILABILITY manager is genuinely in the sweep", async () => {
    // Defeat B hid in this component precisely because no #1501 suite rendered
    // it — 7 of the 17 call sites, same file, same `LabeledInput`, same
    // `styles.row`. If the sweep ever stops reaching it, C-1/C-2 would go quiet
    // rather than red, so its presence is asserted directly.
    const audited = await auditSweep();
    const seen = new Set(audited.map((field) => field.testID));
    for (const id of [
      "stay-availability-from-field",
      "stay-availability-to-field",
      "stay-night-quantity-field",
      "stay-night-price-field",
      "stay-place-start-time-field",
      "stay-place-end-time-field",
      "stay-place-price-field",
    ]) {
      expect({ id, rendered: seen.has(id) }).toEqual({ id, rendered: true });
    }
    // ...and they are audited in a ROW, which is what makes C-2 bite there.
    expect(
      audited.find((field) => field.testID === "stay-night-quantity-field")
        ?.parentDirection,
    ).toBe("row");
  });
});
