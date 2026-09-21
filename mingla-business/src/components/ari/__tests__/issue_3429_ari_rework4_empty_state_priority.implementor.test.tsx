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
 * is laid out immediately after it, so the attach hint is the LAST content
 * dropped. Centring is done with a keyboard-INDEPENDENT top offset instead of
 * `justifyContent`, which both keeps the ORCH-1057 no-jump contract and makes
 * the resting layout pixel-identical to what shipped before (T-3).
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
 *   - delete the `marginTop`/`maxHeight` line from the decorative zone's style
 *     array → T-2/T-3/T-4/T-5 go red: the zone keeps its full natural height,
 *     so the hint row is pushed below the composer's top edge again (the exact
 *     N-1 geometry, reproduced arithmetically).
 *   - delete `flexShrink: 0` from the hint zone → T-5/T-6/T-7 go red.
 *   - drop `heroTopOffsetPx` back to a `justifyContent: "center"` → T-3 and
 *     T-4 go red, because the orb then tracks the clamp (the jump ORCH-1057
 *     removed) and the resting position stops matching what centring produced.
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

/** Intrinsic content heights. The 1.5x pair is the font scale the coordinator
 *  flagged as the WORSE case for N-1 — more copy, so more of it was lost. */
const SCALES = [
  { name: "font scale 1.0", heroPx: 210, hintPx: spacing.xl + 22 },
  { name: "font scale 1.5", heroPx: 300, hintPx: spacing.xl + 33 },
] as const;

const HOST_PADDING_BOTTOM = spacing.xxl;

interface Mounted {
  host: Record<string, unknown>;
  heroClip: Record<string, unknown>;
  hintZone: Record<string, unknown>;
  hintRowLabel: unknown;
  unmount: () => void;
}

/**
 * Mount the real component with the real clamp, play back the three layout
 * measurements the platform performs, and hand back the RESOLVED styles.
 *
 * Zones are identified STRUCTURALLY — the outermost host View, then its two
 * child Views — never by a style name, so a rename cannot quietly turn this
 * suite into a no-op.
 */
function mount(
  restingHeightPx: number,
  clampPx: number,
  heroPx: number,
  hintPx: number,
): Mounted {
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
  fire(first, restingHeightPx);
  fire(childViews(childViews(first)[0])[0], heroPx);
  fire(childViews(first)[1], hintPx);

  // Re-read after the measurement-driven re-render.
  const host = root.toJSON();
  const [heroClip, hintZone] = childViews(host);
  const hintRow = childViews(hintZone)[0];

  return {
    host: flatten(host.props.style),
    heroClip: flatten(heroClip.props.style),
    hintZone: flatten(hintZone.props.style),
    hintRowLabel: hintRow.props.accessibilityLabel,
    unmount: () => act(() => root.unmount()),
  };
}

/** Where the hero's top edge lands, from the top of the resting box. */
function heroTop(m: Mounted): number {
  return (m.heroClip.marginTop as number) ?? 0;
}
/** Where the hint row's bottom edge lands, from the same origin. */
function hintBottom(m: Mounted, heroPx: number, hintPx: number): number {
  const cap = m.heroClip.maxHeight as number;
  return heroTop(m) + Math.min(heroPx, cap) + hintPx;
}

describe("#3429 REWORK-4 N-1 — the attach hint is the last content dropped", () => {
  it("T-1 the hint row is rendered, and is NOT inside the clipped decorative zone", () => {
    const m = mount(408, 226, SCALES[0].heroPx, SCALES[0].hintPx);
    // The instruction this whole feature exists to ship is present...
    expect(m.hintRowLabel).toBe("Tap the plus button to attach context");
    // ...and it lives OUTSIDE the zone that clips, which is the entire point:
    // clipping can only ever reach the decorative hero.
    expect(m.heroClip.overflow).toBe("hidden");
    expect(m.hintZone.overflow).toBeUndefined();
    m.unmount();
  });

  for (const device of DEVICES) {
    for (const scale of SCALES) {
      it(`T-2 ${device.name} @ ${scale.name}: with the keyboard open the hint row still fits above the composer`, () => {
        const m = mount(device.restingHeightPx, device.clampPx, scale.heroPx, scale.hintPx);
        // Where the composer's top edge lands: the clamp lifts the visible
        // bottom edge by exactly that much.
        const visibleBottom =
          device.restingHeightPx - device.clampPx - HOST_PADDING_BOTTOM;
        // The hint row is fully inside the visible region — not clipped, and
        // not under the composer. This is the assertion N-1 failed.
        expect(hintBottom(m, scale.heroPx, scale.hintPx)).toBeLessThanOrEqual(visibleBottom);
        // ...and "fits" is not "collapsed to nothing".
        expect(hintBottom(m, scale.heroPx, scale.hintPx)).toBeGreaterThan(0);
        m.unmount();
      });
    }
  }

  it("T-3 the resting layout is what centring produced, and the hint is whole", () => {
    for (const device of DEVICES) {
      for (const scale of SCALES) {
        const m = mount(device.restingHeightPx, 0, scale.heroPx, scale.hintPx);
        const contentBox = device.restingHeightPx - HOST_PADDING_BOTTOM;
        // (a) The hero starts exactly where `justifyContent: "center"` used to
        // put the group — the resting layout did not move.
        const centred = Math.round((contentBox - scale.heroPx - scale.hintPx) / 2);
        expect(heroTop(m)).toBe(Math.max(0, centred));

        if (scale.heroPx + scale.hintPx <= contentBox) {
          // (b) The content fits, so nothing is capped and the hint sits
          // immediately below the body, exactly as before.
          expect(m.heroClip.maxHeight as number).toBeGreaterThanOrEqual(scale.heroPx);
        } else {
          // (c) It does NOT fit — iPhone SE at font scale 1.5 overruns the
          // resting box by a few px before the keyboard is even involved. The
          // priority still holds: the hero absorbs the shortfall and the hint
          // row is whole.
          expect(m.heroClip.maxHeight as number).toBeLessThan(scale.heroPx);
        }
        // Either way the hint row's bottom edge is inside the resting box.
        expect(hintBottom(m, scale.heroPx, scale.hintPx)).toBeLessThanOrEqual(contentBox);
        m.unmount();
      }
    }
  });

  it("T-4 the hero's top edge is keyboard-INDEPENDENT (no orb jump)", () => {
    for (const device of DEVICES) {
      for (const scale of SCALES) {
        const open = mount(device.restingHeightPx, device.clampPx, scale.heroPx, scale.hintPx);
        const closed = mount(device.restingHeightPx, 0, scale.heroPx, scale.hintPx);
        // The hero's position is an EXPLICIT offset, not a by-product of
        // centring — centring is what makes the orb track the clamp.
        expect(typeof open.heroClip.marginTop).toBe("number");
        // ORCH-1057's no-jump contract, restated as a rendered value rather
        // than a source string.
        expect(heroTop(open)).toBe(heroTop(closed));
        open.unmount();
        closed.unmount();
      }
    }
  });

  it("T-5 the decorative zone absorbs the ENTIRE clamp, to the px", () => {
    const d = DEVICES[0];
    const s0 = SCALES[0];
    const open = mount(d.restingHeightPx, d.clampPx, s0.heroPx, s0.hintPx);
    const closed = mount(d.restingHeightPx, 0, s0.heroPx, s0.hintPx);
    // Every pixel the keyboard takes comes out of the hero's allowance, and
    // none of it out of the hint row.
    expect((closed.heroClip.maxHeight as number) - (open.heroClip.maxHeight as number)).toBe(
      d.clampPx,
    );
    expect(open.hintZone.flexShrink).toBe(0);
    open.unmount();
    closed.unmount();
  });

  it("T-6 the hint zone cannot be shrunk by the flex layout", () => {
    const m = mount(560, 268, SCALES[1].heroPx, SCALES[1].hintPx);
    // Without this the flex column would take the hint row's height back the
    // moment space runs short, which is N-1 by another route.
    expect(m.hintZone.flexShrink).toBe(0);
    m.unmount();
  });

  it("T-7 at an extreme clamp the hero collapses to nothing and the hint survives", () => {
    // A tall attachment tray plus the keyboard on a small phone: the clamp
    // exceeds everything the hero had.
    const m = mount(240, 400, SCALES[1].heroPx, SCALES[1].hintPx);
    expect(m.heroClip.maxHeight).toBe(0);
    expect(m.hintZone.flexShrink).toBe(0);
    expect(m.hintRowLabel).toBe("Tap the plus button to attach context");
    m.unmount();
  });

  it("T-8 before measurement the group is centred, so the first frame is not top-aligned", () => {
    let tree: TestRoot | null = null;
    act(() => {
      tree = create(
        <AriEmptyStateLayoutContext.Provider value={{ viewportBottomClampPx: 226 }}>
          <EmptyState />
        </AriEmptyStateLayoutContext.Provider>,
      ) as unknown as TestRoot;
    });
    const root = tree as unknown as TestRoot;
    const host = root.toJSON();
    // maxHeight of 0 on an unmeasured first frame would blank the hero.
    expect(flatten(childViews(host)[0].props.style).maxHeight).toBeUndefined();
    expect(flatten(host.props.style).justifyContent).toBe("center");
    act(() => root.unmount());
  });
});
