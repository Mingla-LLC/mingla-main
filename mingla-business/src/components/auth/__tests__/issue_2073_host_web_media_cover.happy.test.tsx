// @ts-nocheck -- this test supplies the minimal web runtime needed by the background.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  const ReactLocal = require("react");
  const host = (name: string) =>
    ReactLocal.forwardRef((props: any, ref: any) =>
      ReactLocal.createElement(name, { ...props, ref }, props.children),
    );
  class Value {
    setValue() {}
    stopAnimation() {}
  }
  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(() => Promise.resolve(true)),
      addEventListener: () => ({ remove: jest.fn() }),
    },
    Animated: {
      Value,
      View: host("Animated.View"),
      timing: jest.fn(() => ({ start: jest.fn() })),
    },
    AppState: {
      currentState: "active",
      addEventListener: () => ({ remove: jest.fn() }),
    },
    Easing: { out: (value: unknown) => value, cubic: "cubic" },
    Image: host("Image"),
    StyleSheet: {
      absoluteFill: { position: "absolute", inset: 0 },
      create: (styles: unknown) => styles,
    },
    View: host("View"),
  };
});

jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup: (player: any) => void) => {
    const player = {
      loop: false,
      muted: false,
      replaceAsync: jest.fn(() => Promise.resolve()),
      play: jest.fn(),
      pause: jest.fn(),
      addListener: () => ({ remove: jest.fn() }),
    };
    setup(player);
    return player;
  },
  VideoView: (props: any) => React.createElement("VideoView", props),
}));

jest.mock("../../../../assets/welcome/mingla-welcome-landscape.mp4", () => 2073);
jest.mock("../../../../assets/welcome/mingla-welcome-landscape-poster.jpg", () => 2074);

import { WelcomeVideoBackground } from "../WelcomeVideoBackground.web";

describe("issue #2073 Host web responsive media coverage", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: () => ({
          matches: false,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        }),
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { connection: { saveData: false } },
    });
  });

  test("poster and video explicitly fill the full viewport parent", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<WelcomeVideoBackground />);
      await Promise.resolve();
    });

    const fullParentStyle = [
      { position: "absolute", inset: 0 },
      { width: "100%", height: "100%" },
    ];
    expect(tree!.root.findByType("Image").props.style).toEqual(fullParentStyle);
    expect(tree!.root.findByType("VideoView").props.style).toEqual(fullParentStyle);
    expect(tree!.root.findByType("Image").props.resizeMode).toBe("cover");
    expect(tree!.root.findByType("VideoView").props.contentFit).toBe("cover");
  });
});
