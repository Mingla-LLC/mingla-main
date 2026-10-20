// @ts-nocheck -- the test intentionally supplies a minimal host-component RN runtime.
// #2107 — the Explorer welcome video is released before an in-app restart, and
// if the restart does not happen the released player is never touched again.
// Runs under app-mobile/jest.issue2774.render.cjs (the #1486 render step).
//
// Mounts the real WelcomeVideoBackground, runs the real safeReload
// (buildSafeReloadDependencies) with a reloadAsync that FAILS, then drives every
// path that used to call the player (app comes back to the foreground, a status
// error, re-render) and proves: no play / pause / replaceAsync on the released
// player, the VideoView is gone, and the poster stays. Invariant
// I-2107-RELEASE-VIDEO-BEFORE-RELOAD is declared in
// app-mobile/src/services/__tests__/issue_2107_video_player_release.test.ts.
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
let statusListener: ((event: { status: string }) => void) | undefined;
let appStateListener: ((state: string) => void) | undefined;
let currentPlayer: any;

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
    View: host("View"),
    Image: host("Image"),
    Animated: {
      View: host("Animated.View"),
      Value,
      timing: () => ({ start: (done?: () => void) => done?.() }),
    },
    Easing: { out: (value: unknown) => value, cubic: "cubic" },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Platform: { OS: "ios", select: (options: any) => options.ios ?? options.default },
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
      addEventListener: () => ({ remove: jest.fn() }),
    },
    AppState: {
      currentState: "active",
      addEventListener: (_event: string, listener: (state: string) => void) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      },
    },
  };
});
jest.mock("../../../../assets/welcome/mingla-welcome-portrait.mp4", () => 2107);
jest.mock("../../../../assets/welcome/mingla-welcome-portrait-poster.jpg", () => 2108);
jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup: (player: any) => void) => {
    const ReactLocal = require("react");
    const ref = ReactLocal.useRef(null);
    if (ref.current === null) {
      ref.current = {
        loop: false,
        muted: false,
        replaceAsync: jest.fn(() => { calls.push("replaceAsync"); return Promise.resolve(); }),
        play: jest.fn(() => calls.push("play")),
        pause: jest.fn(() => calls.push("pause")),
        release: jest.fn(() => calls.push("release")),
        addListener: (_name: string, callback: typeof statusListener) => {
          statusListener = callback;
          return { remove: jest.fn() };
        },
      };
      setup(ref.current);
      currentPlayer = ref.current;
    }
    return ref.current;
  },
  VideoView: (props: any) => require("react").createElement("VideoView", props),
}));
// The restart's other steps, stubbed exactly as the safeReload suites do.
jest.mock("../../../config/queryClient", () => ({
  queryClient: { cancelQueries: jest.fn(() => Promise.resolve()) },
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { removeAllChannels: jest.fn(() => Promise.resolve([])) },
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { getClient: () => null },
}));

import { WelcomeVideoBackground } from "../WelcomeVideoBackground";
import { createSafeReload } from "../../../services/safeReload";
import { buildSafeReloadDependencies } from "../../../services/safeReloadRuntime";
import { resetNetworkFenceForTests } from "../../../services/reloadNetworkFence";
import {
  isVideoPlayerReleasedForReload,
  liveVideoPlayerCountForReload,
  resetVideoPlayerReloadRegistryForTests,
} from "@mingla/offering-rendering/videoPlayerReloadRelease";

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

async function failedRestart(): Promise<void> {
  const safeReload = createSafeReload({
    ...buildSafeReloadDependencies(async () => {
      calls.push("reloadAsync");
      throw new Error("restart did not happen");
    }),
    warn: () => undefined,
  });
  await act(async () => {
    await expect(safeReload()).rejects.toThrow("restart did not happen");
  });
}

describe("#2107 Explorer welcome video — released before a restart, untouched after a failed one", () => {
  beforeEach(() => {
    calls.length = 0;
    statusListener = undefined;
    appStateListener = undefined;
    currentPlayer = undefined;
    resetVideoPlayerReloadRegistryForTests();
    resetNetworkFenceForTests();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetNetworkFenceForTests();
    jest.restoreAllMocks();
  });

  test("happy: the mounted player is registered, then paused and released before reloadAsync", async () => {
    let tree: any;
    await act(async () => { tree = TestRenderer.create(<WelcomeVideoBackground />); });
    await flush();
    expect(liveVideoPlayerCountForReload()).toBe(1);
    expect(calls.slice(-2)).toEqual(["replaceAsync", "play"]);

    calls.length = 0;
    await failedRestart();

    expect(calls).toEqual(["pause", "release", "reloadAsync"]);
    expect(isVideoPlayerReleasedForReload(currentPlayer)).toBe(true);
    act(() => tree!.unmount());
  });

  test("adversarial: after a failed restart, foreground / error / re-render never touch the released player", async () => {
    let tree: any;
    await act(async () => { tree = TestRenderer.create(<WelcomeVideoBackground />); });
    await flush();
    await failedRestart();
    calls.length = 0;

    // Background then foreground: this path used to pause() then play().
    act(() => appStateListener?.("background"));
    act(() => appStateListener?.("active"));
    await flush();
    // A late status error used to pause() through failSafely.
    act(() => statusListener?.({ status: "error" }));
    await flush();
    // A plain re-render.
    await act(async () => { tree!.update(<WelcomeVideoBackground />); });
    await flush();

    expect(calls).toEqual([]);
    // The poster stays and no VideoView is handed the released player.
    expect(tree!.root.findAllByType("VideoView")).toHaveLength(0);
    expect(tree!.root.findAllByType("Image")).toHaveLength(1);
    act(() => tree!.unmount());
  });

  test("adversarial: a player unmounted before the restart is not released by it (no double release)", async () => {
    let tree: any;
    await act(async () => { tree = TestRenderer.create(<WelcomeVideoBackground />); });
    await flush();
    act(() => tree!.unmount());
    expect(liveVideoPlayerCountForReload()).toBe(0);
    calls.length = 0;

    await failedRestart();

    expect(calls).toEqual(["reloadAsync"]);
    expect(isVideoPlayerReleasedForReload(currentPlayer)).toBe(false);
  });
});
