// issue #1023 — the WEB ThemeEntranceAnimation mounted for real
// (react-test-renderer) with recording mocks at its boundaries: the
// react-native(-web) primitives and lottie-web's canvas player.
//
// Pins: the web leg renders a real player (it used to return null); the
// entrance is a one-shot player and the loop player uses `loop: true` and
// starts when the entrance completes; prefers-reduced-motion shows one still
// frame of the loop; the text-safe zone becomes a CSS mask.
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  parent: Node | null;
};
type Tree = {
  root: { findAll: (p: (n: Node) => boolean) => Node[] };
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement, opts?: { createNodeMock: () => object }) => Tree;
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
  return {
    View: host("View"),
    Text: host("Text"),
    Pressable: host("Pressable"),
    StyleSheet: { create: <T,>(s: T): T => s, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
  };
});

// the web build resolves ./useReduceMotionPreference.web (matchMedia); jest
// resolves the native file, so pin the hook to the value under test.
jest.mock("../../../../../packages/offering-rendering/useReduceMotionPreference", () => ({
  useReduceMotionPreference: () => reduceMotion.value,
}));

type Params = { loop: boolean; autoplay: boolean; animationData: { meta?: { phase?: string } } };
const created: Array<{ params: Params; anim: Record<string, jest.Mock> & { fire: () => void } }> = [];
jest.mock(
  "lottie-web/build/player/lottie_light_canvas",
  () => ({
    __esModule: true,
    default: {
      loadAnimation: (params: Params) => {
        let onComplete: (() => void) | null = null;
        const anim = {
          play: jest.fn(),
          pause: jest.fn(),
          goToAndStop: jest.fn(),
          resize: jest.fn(),
          destroy: jest.fn(),
          totalFrames: 180,
          addEventListener: jest.fn((_name: string, cb: () => void) => {
            onComplete = cb;
          }),
          fire: () => onComplete?.(),
        };
        created.push({ params, anim: anim as never });
        return anim;
      },
    },
  }),
  { virtual: true },
);

// eslint-disable-next-line import/first
import { ThemeEntranceAnimation } from "../../../../../packages/offering-rendering/ThemeEntranceAnimationWebImpl";
// eslint-disable-next-line import/first
import type { ResolvedTheme } from "../../../../../packages/offering-rendering/designTokens";

const theme = (animation: ResolvedTheme["animation"]): ResolvedTheme => ({
  color: "#e8508f",
  foregroundColor: "#ffffff",
  font: "inter",
  fontFamilyValue: "Inter_500Medium",
  animation,
});

async function mount(el: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = TestRenderer.create(el, { createNodeMock: () => ({}) });
  });
  await act(async () => {
    for (const node of tree.root.findAll((n) => typeof n.props.onLayout === "function")) {
      node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 500 } } });
    }
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return tree;
}

beforeEach(() => {
  created.length = 0;
  reduceMotion.value = false;
});

describe("#1023 web entrance motion", () => {
  test("the eager web entry lazily mounts the real player", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shell = require("../../../../../packages/offering-rendering/ThemeEntranceAnimation.web") as {
      ThemeEntranceAnimation: React.FC<{ theme: ResolvedTheme; sessionKey: string }>;
    };
    const Shell = shell.ThemeEntranceAnimation;
    const tree = await mount(<Shell theme={theme("bokeh")} sessionKey="b:0" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tree.root.findAll((n) => n.props.testID === "theme-entrance-web-player").length).toBeGreaterThan(0);
    const none = await mount(<Shell theme={theme("none")} sessionKey="b:00" />);
    expect(none.toJSON()).toBeNull();
  });

  test("renders a real player, not null", async () => {
    const tree = await mount(<ThemeEntranceAnimation theme={theme("confetti")} sessionKey="b:1" />);
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.root.findAll((n) => n.props.testID === "theme-entrance-web-player").length).toBeGreaterThan(0);
    expect(created.length).toBe(2);
  });

  test("entrance plays once, then the loop player (loop: true) takes over", async () => {
    await mount(<ThemeEntranceAnimation theme={theme("hearts")} sessionKey="b:2" />);
    const intro = created.find((c) => c.params.animationData.meta?.phase === "intro");
    const loop = created.find((c) => c.params.animationData.meta?.phase === "loop");
    expect(intro?.params.loop).toBe(false);
    expect(intro?.params.autoplay).toBe(true);
    expect(loop?.params.loop).toBe(true);
    expect(loop?.anim.play).not.toHaveBeenCalled();
    await act(async () => {
      intro?.anim.fire();
    });
    expect(loop?.anim.play).toHaveBeenCalled();
  });

  test("prefers-reduced-motion shows one still frame of the loop", async () => {
    reduceMotion.value = true;
    const tree = await mount(<ThemeEntranceAnimation theme={theme("snowfall")} sessionKey="b:3" />);
    expect(created).toHaveLength(1);
    expect(created[0].params.loop).toBe(true);
    expect(created[0].params.autoplay).toBe(false);
    expect(created[0].anim.goToAndStop).toHaveBeenCalledWith(90, true);
    expect(created[0].anim.play).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props.testID === "theme-motion-pause")).toHaveLength(0);
  });

  test("a text-safe zone masks the motion with a soft-edged CSS mask", async () => {
    const tree = await mount(
      <ThemeEntranceAnimation theme={theme("confetti")} sessionKey="b:4" textSafeZone="default" />,
    );
    const layers = tree.root.findAll((n) => n.type === "div");
    expect(layers.length).toBe(2);
    for (const layer of layers) {
      expect(String(layer.props.style.maskImage)).toContain("data:image/svg+xml");
      expect(String(layer.props.style.WebkitMaskImage)).toContain("feGaussianBlur");
    }
    // ~50% removed during the entrance, ~86% in the loop
    expect(decodeURIComponent(String(layers[0].props.style.maskImage))).toContain("fill-opacity='0.5'");
    expect(decodeURIComponent(String(layers[1].props.style.maskImage))).toContain("fill-opacity='0.14'");
  });
});
