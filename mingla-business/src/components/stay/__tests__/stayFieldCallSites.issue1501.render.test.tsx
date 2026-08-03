/**
 * Issue #1501 [add-rooms-form] — THE CALL-SITE HALF OF `I-AXIS-SCOPED-FLEX`.
 *
 * WHY THIS EXISTS. The original #1501 guard
 * (`stayFieldAxis.issue1501.render.test.tsx`) pins the STYLE DEFINITIONS: that
 * `fieldStack` carries no flex-axis key, that `fieldNum` declares an explicit
 * measure. It read a KNOWN testID in a KNOWN state and asked "is this value
 * right?". That is necessary and it is not sufficient — and the tester proved
 * it by finding the bug it could not see (P2-1):
 *
 *     <LabeledInput span="num" testID="stay-offering-no-show" />
 *
 * `span="num"` selects `fieldNum`, a ROW measure, but that field is not inside
 * `styles.row` — it sits directly in the money section's COLUMN, after the
 * policy box. So its width measure resolved against the HEIGHT and the box
 * rendered ~220pt tall with ~114pt of dead space under it. The required `span`
 * prop enforces that an axis is CHOSEN; nothing enforced that the chosen axis
 * matches the actual parent. That is the gap this file closes.
 *
 * THE ASSERTION: walk the rendered tree carrying each node's inherited
 * `flexDirection`, and fail on any field wrapper under a COLUMN that resolves
 * ANY flex-axis key — regardless of which style it came from or what that style
 * is called. It is the assertion the invariant actually claims, and it is
 * measured at the call site rather than at the definition.
 *
 * ZERO KNOWN VIOLATIONS. This is an exact-empty baseline, not an allow-list: a
 * new mismatch fails it, and there is nothing to "temporarily" park in it.
 *
 * C-3/C-4 additionally pin the PHONE PAIR ARITHMETIC at 390pt and 320pt, the
 * P2-2 regression: `flexWrap` breaks a line on the FLEX BASE SIZE before any
 * shrinking, so a numeric field that DEMANDS its desktop width up front puts
 * both pairs on separate rows on every phone.
 *
 * FAILS-ON-REVERT (all proven, hashes in the #1501 report):
 *   `span="stack"` -> `span="num"` on the refund field   => C-1 + C-2 FAIL
 *   `fieldNum` back to `flexBasis: stayFieldNumMaxWidth`  => C-3 + C-4 FAIL
 *   `stayFieldNumMinWidth` back to 140                    => C-4 FAILS
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
  stayFieldNumMinWidth,
} from "../../../constants/designSystem";
import { OfferingEditor } from "../StayInventoryManager";

const PROPS = {
  brandId: "brand-1501",
  venueId: "venue-1501",
  existing: null,
  canManageInventory: true,
  canManageFinance: true,
  onClose: (): void => undefined,
};

type Flat = Record<string, unknown>;

/** Every key that resolves against a flex container's MAIN axis. */
const FLEX_AXIS_KEYS = ["flex", "flexGrow", "flexShrink", "flexBasis"] as const;

interface AuditedField {
  testID: string;
  parentDirection: "row" | "column";
  style: Flat;
  path: string;
}

/**
 * Walk the tree carrying each node's INHERITED `flexDirection`, and report every
 * `*-field` wrapper with the axis its parent actually lays out on.
 *
 * This is the whole point: the style a field selects is only correct RELATIVE TO
 * ITS PARENT, and nothing in the type system knows what the parent is.
 */
function auditFields(tree: RenderTree): AuditedField[] {
  const out: AuditedField[] = [];
  const visit = (
    node: RenderTreeNode,
    parentDirection: "row" | "column",
    path: string,
  ): void => {
    const style = (StyleSheet.flatten(node.props?.style as never) ??
      {}) as Flat;
    const testID = node.props?.testID;
    // Host nodes only, so one rendered element is counted once (the composite
    // and its host both carry the testID).
    if (
      typeof testID === "string" &&
      testID.endsWith("-field") &&
      typeof node.type === "string"
    ) {
      out.push({ testID, parentDirection, style, path });
    }
    // ONLY A HOST NODE ESTABLISHES A LAYOUT CONTEXT. `react-test-renderer`
    // surfaces the composite element AND the host element for the same `<View>`,
    // and composites like `LabeledInput` carry no style at all — treating those
    // as containers would reset every field's inherited direction to "column"
    // and make the audit report the whole form as a violation. Composites are
    // transparent; a host view with no explicit `flexDirection` lays its
    // children out in a COLUMN (React Native's default), which is the very
    // assumption the shipped bug violated.
    const isHost = typeof node.type === "string";
    const own: "row" | "column" = isHost
      ? style.flexDirection === "row"
        ? "row"
        : "column"
      : parentDirection;
    for (const child of node.children ?? []) {
      if (typeof child === "object" && child !== null) {
        visit(child, own, `${path}/${String(child.type)}`);
      }
    }
  };
  visit(tree.root, "column", "root");
  return out;
}

function has(flat: Flat, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(flat, key);
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1501 — the CALL SITE's axis matches its real parent", () => {
  it("C-0 — VACUITY GUARD: the auditor really finds the fields", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const fields = auditFields(tree);
    // If the walk silently found nothing, C-1's "no violations" would be
    // trivially true — the exact failure mode this suite exists to prevent.
    expect(fields.length).toBeGreaterThanOrEqual(6);
    expect(fields.some((f) => f.parentDirection === "row")).toBe(true);
    expect(fields.some((f) => f.parentDirection === "column")).toBe(true);
    expect(fields.map((f) => f.testID)).toContain("stay-offering-no-show-field");
    tree.unmount();
  });

  it("C-1 — ZERO fields under a COLUMN resolve any flex-axis key", async () => {
    const offenders: string[] = [];
    for (const wide of [true, false]) {
      mockIsWideDesktop = wide;
      const tree = await mount(<OfferingEditor {...PROPS} />);
      for (const field of auditFields(tree)) {
        if (field.parentDirection !== "column") continue;
        for (const key of FLEX_AXIS_KEYS) {
          if (has(field.style, key)) {
            offenders.push(`${wide ? "desktop" : "phone"} ${field.testID}.${key}`);
          }
        }
      }
      tree.unmount();
    }
    // EXACT EMPTY. Not an allow-list — there is nothing legitimate to park here.
    expect(offenders).toEqual([]);
  });

  it("C-2 — the refund field is a STACK measure, like its two siblings", async () => {
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const byId = new Map(auditFields(tree).map((f) => [f.testID, f]));

    const refund = byId.get("stay-offering-no-show-field");
    expect(refund).toBeDefined();
    // It lives in the money section's COLUMN...
    expect((refund as AuditedField).parentDirection).toBe("column");
    // ...so it must carry the stacked measure, exactly like the two fields
    // either side of it. A row measure here rendered a 220pt-tall box.
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
    tree.unmount();
  });

  it("C-3 — the numeric pair SHARES a line instead of demanding its width", async () => {
    mockIsWideDesktop = false;
    const tree = await mount(<OfferingEditor {...PROPS} />);
    const byId = new Map(auditFields(tree).map((f) => [f.testID, f]));

    for (const id of [
      "stay-offering-quantity-field",
      "stay-offering-guests-field",
    ]) {
      const field = byId.get(id) as AuditedField;
      expect(field).toBeDefined();
      expect({ id, parent: field.parentDirection }).toEqual({ id, parent: "row" });
      // A ZERO basis is what lets the pair share one line; the desktop measure
      // is a CAP it grows into, not a width it demands up front.
      expect({ id, basis: field.style.flexBasis }).toEqual({ id, basis: 0 });
      expect({ id, grow: field.style.flexGrow }).toEqual({ id, grow: 1 });
      expect({ id, cap: field.style.maxWidth }).toEqual({
        id,
        cap: stayFieldNumMaxWidth,
      });
    }
    tree.unmount();
  });

  it("C-4 — the pair fits on ONE line at 390pt AND at 320pt", () => {
    // `flexWrap` breaks a line on each item's HYPOTHETICAL MAIN SIZE — the flex
    // basis clamped by min/max-width — BEFORE any shrinking. With a zero basis
    // that is `minWidth`, so the floor is what decides whether a phone wraps.
    // The row's own gutter is `columnGap: spacing.md`; the content box is the
    // device width minus PAGE_BASE padding and GlassCard padding, both
    // `spacing.md` on each side.
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

    // ...and the OLD basis-driven sizing genuinely could not: this is the
    // arithmetic of the reported regression, kept so the fix is falsifiable.
    expect(stayFieldNumMaxWidth * 2 + spacing.md).toBeGreaterThan(
      contentBox(390),
    );

    // Each field still renders comfortably: 155pt at 390, 120pt at 320.
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

  it("C-5 — a desktop column still stops the numeric box at its measure", () => {
    // The cap is the reason "fill the space" never becomes a 760pt-wide box for
    // a two-digit number.
    const formColumnContent = 760 - spacing.md * 2;
    const uncapped = (formColumnContent - spacing.md) / 2;
    expect(uncapped).toBeGreaterThan(stayFieldNumMaxWidth);
    expect(Math.min(uncapped, stayFieldNumMaxWidth)).toBe(stayFieldNumMaxWidth);
  });
});
