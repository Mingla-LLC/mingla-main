/**
 * #3429 REWORK-4 N-1 [ari-chat-polish] — implementor happy-path suite.
 *
 * THE DEFECT (RETEST-2 N-1, P2). SC-R1-P2-6 — "the composer must not intersect
 * any empty-state text" — passed on all three devices, but it passed because
 * the empty state was CLIPPED, not because the copy survived. With the keyboard
 * open a first-run user lost the body sentence (entirely, on an iPhone SE) and
 * the whole "Tap (+) to attach context" row: the one instruction this feature
 * exists to ship, gone at the exact moment they tap the composer. The hero box
 * is deliberately not a ScrollView (ORCH-0892 / #1841), so nothing recovered it
 * short of dismissing the keyboard.
 *
 * THE FIX. The empty state is now two zones with an explicit drop order. The
 * decorative zone (orb, headline, body) is capped to the VISIBLE height and
 * clipped, so it is what gives way; the hint zone carries `flexShrink: 0` and
 * is laid out after it, so the attach hint is the LAST content dropped. The
 * decorative zone's inner box keeps the keyboard-INDEPENDENT resting height, so
 * the ORCH-1057 no-jump contract is untouched.
 *
 * WHY THIS SUITE RENDERS INSTEAD OF GREPPING. This is the #3429 R-3 lesson
 * applied before the fact: three "byte-stable" suites on this very component
 * were satisfied by a source COMMENT for an entire rework cycle, so the shipped
 * copy could be changed to anything and all three stayed green. A source pin on
 * `maxHeight` or `flexShrink: 0` would have exactly that defect. This suite
 * therefore MOUNTS the real component, drives the real `onLayout` callbacks
 * with real geometry, reads the RESOLVED style values back off the rendered
 * elements, and computes from them where the hint row's bottom edge actually
 * lands relative to the composer's top edge — the user-facing property.
 *
 * fails-on-revert (proven by TRUE LINE DELETION, never a comment-out):
 *   - delete the `maxHeight: heroVisibleHeightPx` line from the decorative
 *     zone's style array → T-2/T-3 go red: the zone keeps its resting height,
 *     so the hint row is pushed below the composer's top edge again (the exact
 *     N-1 geometry, reproduced arithmetically).
 *   - delete the `minHeight: heroRestingHeightPx` line → T-4 goes red: the
 *     anchor starts tracking the clamp, which is the orb jump ORCH-1057
 *     removed.
 *   - delete `flexShrink: 0` from the hint zone → T-5 goes red.
 *
 * Adversarial coverage (Dynamic Type, VoiceOver/TalkBack traversal order, the
 * tall-attachment-tray extreme) is tester-owned and deliberately not pre-empted.
 */

import React from "react";

// React 19 gates its act() support on this flag; without it every mount logs a
// "testing environment is not configured to support act(...)" error.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { spacing } from "../../../constants/designSystem";

// AriOrb value-imports react-native-svg + reanimated, neither of which loads
// under the node/ts-jest config. The orb's pixels are not under test here — its
// PLACEMENT is, and that is decided by the zones around it.
jest.mock("../AriOrb", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    AriOrb: (props: Record<string, unknown>): React.ReactElement =>
      ReactModule.createElement("AriOrb", props),
  };
});

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    Plus: (props: Record<string, unknown>): React.ReactElement =>
      ReactModule.createElement("Plus", props),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AriEmptyStateLayoutContext, EmptyState } = require("../EmptyState") as {
  AriEmptyStateLayoutContext: React.Context<{ viewportBottomClampPx: number }>;
  EmptyState: React.FC;
};

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => TestRoot;
};

/** A rendered HOST element, as `toJSON()` reports it: the real element tree the
 *  platform would lay out, with the real prop values on it. */
interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}
interface TestRoot {
  toJSON: () => JsonNode;
  unmount: () => void;
}

/** The RN mock's StyleSheet.create is identity, so styles arrive as objects or
 *  arrays of them exactly as the component wrote them. Flatten like RN does. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flatten));
  }
  return (style ?? {}) as Record<string, unknown>;
}

function childViews(node: JsonNode): JsonNode[] {
  return (node.children ?? []).filter((child) => child.type === "View");
}

/**
 * The real device geometry from the RETEST-2 evidence, expressed the way the
 * screen hands it to the component: a resting hero box height, and the clamp
 * (how far the composer's top edge rises above its resting position).
 */
const DEVICES = [
  { name: "iPhone SE 3rd gen", restingHeightPx: 408, clampPx: 226 },
  { name: "iPhone 17 Pro Max", restingHeightPx: 620, clampPx: 296 },
  { name: "Pixel 7", restingHeightPx: 560, clampPx: 268 },
] as const;

/** A generous hint-zone height: the row plus its `spacing.xl` top gap, at the
 *  1.5x font scale the coordinator flagged as the worse case for N-1. */
const HINT_ZONE_HEIGHT = spacing.xl + 33;

interface Mounted {
  host: Record<string, unknown>;
  heroClip: Record<string, unknown>;
  heroAnchor: Record<string, unknown>;
  hintZone: Record<string, unknown>;
  hintRowLabel: unknown;
  unmount: () => void;
}

/**
 * Mount the real component with the real clamp, play back the layout pass the
 * platform performs, and hand back the RESOLVED styles.
 *
 * Zones are identified STRUCTURALLY — the outermost host View, then its two
 * child Views, then the first child of the first — never by a style name, so a
 * rename cannot quietly turn this suite into a no-op.
 */
function mount(restingHeightPx: number, clampPx: number, hintHeightPx: number): Mounted {
  let tree: TestRoot | null = null;
  act(() => {
    tree = create(
      <AriEmptyStateLayoutContext.Provider value={{ viewportBottomClampPx: clampPx }}>
        <EmptyState />
      </AriEmptyStateLayoutContext.Provider>,
    ) as unknown as TestRoot;
  });
  const root = tree as unknown as TestRoot;

  const fire = (node: JsonNode, height: number): void => {
    const onLayout = node.props.onLayout as
      | ((event: { nativeEvent: { layout: { height: number } } }) => void)
      | undefined;
    if (!onLayout) throw new Error("expected a measured zone to carry onLayout");
    act(() => {
      onLayout({ nativeEvent: { layout: { height } } });
    });
  };

  const first = root.toJSON();
  // The platform measures the host (the hero's resting box) and the hint zone.
  fire(first, restingHeightPx);
  fire(childViews(first)[1], hintHeightPx);

  // Re-read after the measurement-driven re-render.
  const host = root.toJSON();
  const [heroClip, hintZone] = childViews(host);
  const heroAnchor = childViews(heroClip)[0];
  const hintRow = childViews(hintZone)[0];

  return {
    host: flatten(host.props.style),
    heroClip: flatten(heroClip.props.style),
    heroAnchor: flatten(heroAnchor.props.style),
    hintZone: flatten(hintZone.props.style),
    hintRowLabel: hintRow.props.accessibilityLabel,
    unmount: () => act(() => root.unmount()),
  };
}

describe("#3429 REWORK-4 N-1 — the attach hint is the last content dropped", () => {
  it("T-1 the hint row is rendered, and is NOT inside the clipped decorative zone", () => {
    const mounted = mount(DEVICES[0].restingHeightPx, DEVICES[0].clampPx, HINT_ZONE_HEIGHT);
    // The instruction this whole feature exists to ship is present...
    expect(mounted.hintRowLabel).toBe("Tap the plus button to attach context");
    // ...and it lives OUTSIDE the zone that clips, which is the entire point:
    // clipping can only ever reach the decorative hero.
    expect(mounted.heroClip.overflow).toBe("hidden");
    expect(mounted.hintZone.overflow).toBeUndefined();
    mounted.unmount();
  });

  for (const device of DEVICES) {
    it(`T-2 ${device.name}: with the keyboard open the hint row still fits above the composer`, () => {
      const mounted = mount(device.restingHeightPx, device.clampPx, HINT_ZONE_HEIGHT);
      const paddingBottom = mounted.host.paddingBottom as number;
      const heroVisible = mounted.heroClip.maxHeight as number;
      expect(typeof heroVisible).toBe("number");

      // Where the hint row's bottom edge lands, measured from the top of the
      // hero's resting box: the decorative zone, then the hint zone.
      const hintBottomOffset = heroVisible + HINT_ZONE_HEIGHT;
      // Where the composer's top edge lands: the clamp lifts the visible
      // bottom edge by exactly that much.
      const visibleBottomOffset = device.restingHeightPx - device.clampPx;

      // The hint row is fully inside the visible region — not clipped, and not
      // under the composer. This is the assertion N-1 failed.
      expect(hintBottomOffset).toBeLessThanOrEqual(visibleBottomOffset - paddingBottom);
      // ...and it has real height to draw into, so "fits" is not "collapsed".
      expect(HINT_ZONE_HEIGHT).toBeGreaterThan(0);
      expect(hintBottomOffset).toBeGreaterThan(0);
      mounted.unmount();
    });
  }

  it("T-3 the decorative zone absorbs the ENTIRE clamp, to the px", () => {
    const device = DEVICES[0];
    const open = mount(device.restingHeightPx, device.clampPx, HINT_ZONE_HEIGHT);
    const closed = mount(device.restingHeightPx, 0, HINT_ZONE_HEIGHT);
    const visibleOpen = open.heroClip.maxHeight as number;
    const visibleClosed = closed.heroClip.maxHeight as number;
    // Every pixel the keyboard takes comes out of the hero, and none of it out
    // of the hint row.
    expect(visibleClosed - visibleOpen).toBe(device.clampPx);
    open.unmount();
    closed.unmount();
  });

  it("T-4 the decorative zone's inner box is keyboard-INDEPENDENT (no orb jump)", () => {
    const device = DEVICES[1];
    const open = mount(device.restingHeightPx, device.clampPx, HINT_ZONE_HEIGHT);
    const closed = mount(device.restingHeightPx, 0, HINT_ZONE_HEIGHT);
    // The anchor holds the resting height whatever the keyboard does, so the
    // content centred inside it never re-centres — ORCH-1057's no-jump
    // contract, restated as a rendered value rather than a source string.
    expect(open.heroAnchor.minHeight).toBe(closed.heroAnchor.minHeight);
    expect(open.heroAnchor.minHeight).toBe(
      device.restingHeightPx - (open.host.paddingBottom as number) - HINT_ZONE_HEIGHT,
    );
    open.unmount();
    closed.unmount();
  });

  it("T-5 the hint zone cannot be shrunk by the flex layout", () => {
    const mounted = mount(DEVICES[2].restingHeightPx, DEVICES[2].clampPx, HINT_ZONE_HEIGHT);
    // Without this the flex column would take the hint row's height back the
    // moment space runs short, which is N-1 by another route.
    expect(mounted.hintZone.flexShrink).toBe(0);
    mounted.unmount();
  });

  it("T-6 at an extreme clamp the hero collapses to nothing and the hint survives", () => {
    // A tall attachment tray plus the keyboard on a small phone: the clamp
    // exceeds everything the hero had. The hint must still be laid out.
    const mounted = mount(240, 400, HINT_ZONE_HEIGHT);
    expect(mounted.heroClip.maxHeight).toBe(0);
    expect(mounted.hintZone.flexShrink).toBe(0);
    expect(mounted.hintRowLabel).toBe("Tap the plus button to attach context");
    mounted.unmount();
  });

  it("T-7 before measurement nothing is capped, so the first frame is not blank", () => {
    let tree: TestRoot | null = null;
    act(() => {
      tree = create(
        <AriEmptyStateLayoutContext.Provider value={{ viewportBottomClampPx: 226 }}>
          <EmptyState />
        </AriEmptyStateLayoutContext.Provider>,
      ) as unknown as TestRoot;
    });
    const root = tree as unknown as TestRoot;
    const heroClip = childViews(root.toJSON())[0];
    // maxHeight of 0 on an unmeasured first frame would blank the hero.
    expect(flatten(heroClip.props.style).maxHeight).toBeUndefined();
    act(() => root.unmount());
  });
});
