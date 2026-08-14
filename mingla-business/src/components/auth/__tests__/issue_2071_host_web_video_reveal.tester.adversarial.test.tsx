// @ts-nocheck -- this test supplies the minimal web runtime needed by the background.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const replaceAsync = jest.fn(() => Promise.resolve());
const play = jest.fn();
const pause = jest.fn();
const timing = jest.fn((value: { setValue: (next: number) => void }, config: { toValue: number }) => ({
  start: () => value.setValue(config.toValue),
}));
let resolveAccessibilityMotion: ((enabled: boolean) => void) | undefined;
let appStateChange: ((next: string) => void) | undefined;
let retainedFirstFrame: (() => void) | undefined;
let latestFirstFrame: (() => void) | undefined;

jest.mock("react-native", () => {
  const ReactLocal = require("react");
  const host = (name: string) =>
    ReactLocal.forwardRef((props: any, ref: any) =>
      ReactLocal.createElement(name, { ...props, ref }, props.children),
    );
  class Value {
    value: number;
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; }
    stopAnimation() {}
  }
  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(() => new Promise<boolean>((resolve) => {
        resolveAccessibilityMotion = resolve;
      })),
      addEventListener: () => ({ remove: jest.fn() }),
    },
    Animated: { Value, View: host("Animated.View"), timing },
    AppState: {
      currentState: "active",
      addEventListener: (_type: string, listener: (next: string) => void) => {
        appStateChange = listener;
        return { remove: jest.fn() };
      },
    },
    Easing: { out: (value: unknown) => value, cubic: "cubic" },
    Image: host("Image"),
    StyleSheet: { absoluteFill: {} },
    View: host("View"),
  };
});

jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup: (player: any) => void) => {
    const player = {
      loop: false,
      muted: false,
      replaceAsync,
      play,
      pause,
      addListener: () => ({ remove: jest.fn() }),
    };
    setup(player);
    return player;
  },
  VideoView: (props: any) => {
    retainedFirstFrame ??= props.onFirstFrameRender;
    latestFirstFrame = props.onFirstFrameRender;
    return React.createElement("VideoView", props);
  },
}));

jest.mock("../../../../assets/welcome/mingla-welcome-landscape.mp4", () => 2071);
jest.mock("../../../../assets/welcome/mingla-welcome-landscape-poster.jpg", () => 2072);

import { WelcomeVideoBackground } from "../WelcomeVideoBackground.web";

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("issue #2071 Host web retained callback across page lifecycle", () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAccessibilityMotion = undefined;
    appStateChange = undefined;
    retainedFirstFrame = undefined;
    latestFirstFrame = undefined;
  });

  test("one retained callback stays hidden while inactive and reveals after eligibility resumes", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<WelcomeVideoBackground />);
    });
    expect(retainedFirstFrame).toEqual(expect.any(Function));

    await act(async () => {
      resolveAccessibilityMotion?.(false);
    });
    await flush();
    expect(replaceAsync).toHaveBeenCalledWith(2071);

    act(() => appStateChange?.("background"));
    const videoWrapper = tree!.root.findByType("Animated.View");
    expect(videoWrapper.props.style[1].opacity.value).toBe(0);

    act(() => retainedFirstFrame?.());
    expect(timing).not.toHaveBeenCalled();
    expect(videoWrapper.props.style[1].opacity.value).toBe(0);

    act(() => appStateChange?.("active"));
    expect(latestFirstFrame).toBe(retainedFirstFrame);

    act(() => retainedFirstFrame?.());
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, duration: 200 }),
    );
    expect(videoWrapper.props.style[1].opacity.value).toBe(1);
  });
});
