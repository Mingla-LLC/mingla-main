// issue #1023 — the NATIVE ThemeEntranceAnimation mounted for real
// (react-test-renderer) with recording mocks at the two native boundaries:
// react-native primitives and the Lottie player.
//
// Pins: the entrance plays again on a second mount with the same sessionKey
// (the old module-level play-once Set is gone); the entrance hands over to a
// `loop` player; Reduce Motion shows one still frame with no button; the
// text-safe zone draws banded copies; the pause button pauses every copy; and
// the dev preview override is ignored when the build is not __DEV__.
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// react-test-renderer ships no types here; describe the slice this suite uses.
type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  parent: Node | null;
};
type ReactTestRenderer = {
  root: { findAll: (p: (n: Node) => boolean) => Node[]; find: (p: (n: Node) => boolean) => Node };
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => ReactTestRenderer;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};
const act = TestRenderer.act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reduceMotion = { value: false };

jest.mock("react-native", () => {
  const R = jest.requireActual<typeof import("react")>("react");
  const host = (name: string) => {
    const C = R.forwardRef((props: Record<string, unknown>, ref) =>
      R.createElement(name, { ...props, ref }, props.children as React.ReactNode),
    );
    C.displayName = name;
    return C;
  };
  class Value {
    v: number;
    constructor(v: number) {
      this.v = v;
    }
  }
  const instant = () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }) });
  return {
    View: host("View"),
    Text: host("Text"),
    Pressable: host("Pressable"),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      absoluteFill: {},
      absoluteFillObject: {},
      hairlineWidth: 1,
    },
    Animated: { View: host("AnimatedView"), Value, timing: instant, parallel: instant },
    AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(reduceMotion.value),
      addEventListener: () => ({ remove: () => undefined }),
    },
  };
});

const lottieCalls = { pause: 0, resume: 0 };
jest.mock(
  "lottie-react-native",
  () => {
    const R = jest.requireActual<typeof import("react")>("react");
    const LottieView = R.forwardRef((props: Record<string, unknown>, ref) => {
      R.useImperativeHandle(ref, () => ({
        pause: () => {
          lottieCalls.pause += 1;
        },
        resume: () => {
          lottieCalls.resume += 1;
        },
      }));
      return R.createElement("LottieView", props);
    });
    return { __esModule: true, default: LottieView };
  },
  { virtual: true },
);

// eslint-disable-next-line import/first
import { ThemeEntranceAnimation } from "../../../../../packages/offering-rendering/ThemeEntranceAnimation";
// eslint-disable-next-line import/first
import { setThemeMotionDevOverride } from "../../../../../packages/offering-rendering/themeMotion";
// eslint-disable-next-line import/first
import type { ResolvedTheme } from "../../../../../packages/offering-rendering/designTokens";

const theme = (animation: ResolvedTheme["animation"]): ResolvedTheme => ({
  color: "#2563eb",
  foregroundColor: "#ffffff",
  font: "inter",
  fontFamilyValue: "Inter_500Medium",
  animation,
});

const lotties = (r: ReactTestRenderer, phase: "intro" | "loop"): Node[] =>
  r.root.findAll((n) => (n.type as unknown) === "LottieView" && n.props.testID === `theme-entrance-${phase}`);

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(el);
  });
  // give the layer its size (onLayout), then let the loaders resolve
  await act(async () => {
    const host = r.root.findAll((n) => typeof n.props.onLayout === "function");
    for (const node of host) node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 500 } } });
  });
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

beforeEach(() => {
  reduceMotion.value = false;
  lottieCalls.pause = 0;
  lottieCalls.resume = 0;
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  setThemeMotionDevOverride(null, true);
});

describe("#1023 native entrance motion", () => {
  test("plays again on a second mount with the same sessionKey", async () => {
    const first = await mount(<ThemeEntranceAnimation theme={theme("confetti")} sessionKey="event:1" />);
    const introA = lotties(first, "intro");
    expect(introA).toHaveLength(1);
    expect(introA[0].props.autoPlay).toBe(true);
    expect(introA[0].props.loop).toBe(false);
    await act(async () => first.unmount());

    const second = await mount(<ThemeEntranceAnimation theme={theme("confetti")} sessionKey="event:1" />);
    const introB = lotties(second, "intro");
    expect(introB).toHaveLength(1);
    expect(introB[0].props.autoPlay).toBe(true);
  });

  test("the entrance hands over to a looping player, tinted with the theme colour", async () => {
    const r = await mount(<ThemeEntranceAnimation theme={theme("hearts")} sessionKey="event:2" />);
    expect(lotties(r, "loop")).toHaveLength(0);
    await act(async () => {
      lotties(r, "intro")[0].props.onAnimationFinish(false);
    });
    const loop = lotties(r, "loop");
    expect(loop).toHaveLength(1);
    expect(loop[0].props.loop).toBe(true);
    expect(lotties(r, "intro")).toHaveLength(0);
    const source = loop[0].props.source as { meta: { slug: string; phase: string } };
    expect(source.meta).toMatchObject({ slug: "hearts", phase: "loop" });
    // tinted: a c0 fill carries the blue brand, not the generator's orange
    const text = JSON.stringify(source);
    expect(text).not.toContain('"nm":"c0","c":{"a":0,"k":[0.92');
  });

  test("Reduce Motion shows one still frame of the loop and no pause button", async () => {
    reduceMotion.value = true;
    const r = await mount(<ThemeEntranceAnimation theme={theme("snowfall")} sessionKey="event:3" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(lotties(r, "intro")).toHaveLength(0);
    const loop = lotties(r, "loop");
    expect(loop).toHaveLength(1);
    expect(loop[0].props.autoPlay).toBe(false);
    expect(loop[0].props.progress).toBe(0.5);
    expect(r.root.findAll((n) => n.props.testID === "theme-motion-pause")).toHaveLength(0);
  });

  test("a text-safe zone draws banded copies: full, feather, faded", async () => {
    const r = await mount(
      <ThemeEntranceAnimation theme={theme("confetti")} sessionKey="event:4" textSafeZone="default" />,
    );
    const intro = lotties(r, "intro");
    expect(intro).toHaveLength(3);
    const bandOpacities = intro.map((n) => {
      // walk up to the band View: the nearest ancestor styled with an opacity
      let band: Node | null = n.parent;
      while (band !== null) {
        const style = band.props.style as unknown;
        if (Array.isArray(style) && typeof style[1]?.opacity === "number") return style[1].opacity as number;
        band = band.parent;
      }
      return undefined;
    });
    expect(bandOpacities).toEqual([1, 0.75, 0.5]);
  });

  test("the pause button pauses every copy and says what it will do", async () => {
    const r = await mount(<ThemeEntranceAnimation theme={theme("confetti")} sessionKey="event:5" />);
    const button = () => r.root.find((n) => n.props.testID === "theme-motion-pause" && (n.type as unknown) === "Pressable");
    expect(button().props.accessibilityLabel).toBe("Pause animation");
    await act(async () => {
      button().props.onPress();
    });
    expect(button().props.accessibilityLabel).toBe("Play animation");
    expect(lottieCalls.pause).toBeGreaterThan(0);
    await act(async () => {
      button().props.onPress();
    });
    expect(lottieCalls.resume).toBeGreaterThan(0);
  });

  test("no motion renders nothing", async () => {
    const r = await mount(<ThemeEntranceAnimation theme={theme("none")} sessionKey="event:6" />);
    expect(r.toJSON()).toBeNull();
  });

  test("the dev preview override is inert when the build is not __DEV__", async () => {
    setThemeMotionDevOverride("aurora", true); // set while dev…
    (globalThis as { __DEV__?: boolean }).__DEV__ = false; // …a production build ignores it
    const r = await mount(<ThemeEntranceAnimation theme={theme("confetti")} sessionKey="event:7" />);
    const source = lotties(r, "intro")[0].props.source as { meta: { slug: string } };
    expect(source.meta.slug).toBe("confetti");

    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const dev = await mount(<ThemeEntranceAnimation theme={theme("confetti")} sessionKey="event:8" />);
    const devSource = lotties(dev, "intro")[0].props.source as { meta: { slug: string } };
    expect(devSource.meta.slug).toBe("aurora");
  });
});
