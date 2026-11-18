// @ts-nocheck -- the test supplies a minimal host-component RN runtime (same harness as issue_2052).
// issue #4420 — on the first load of Host web sign-in the Apple / Google /
// Email buttons rendered as 0-wide lines with a squashed Google mark. Their
// width cap came from `s(400)`, which reads the window width once at module
// load; a tab that loaded the bundle before it had a width read 0, so the
// cap became 0.
//
// WHAT THIS FILE PROVES (the REAL BusinessWelcomeScreen and the REAL
// responsive helper, with the window 0 wide at module load, then a 1280
// desktop window)
//   SB-1 every sign-in button keeps a positive width cap.
//
// FAILS-ON-REVERT: restore `maxWidth: s(400)` in BusinessWelcomeScreen and
// SB-1 goes red (maxWidth 0).
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const replaceAsync = jest.fn(() => Promise.resolve());
const play = jest.fn();
const pause = jest.fn();
let statusListener: ((event: { status: string }) => void) | undefined;
let firstFrame: (() => void) | undefined;
const reducedMotion = false;
let platformOS = "web";
const windowWidth = 1280;
const keyboardEvents: string[] = [];
const mockAlert = jest.fn();

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
  const animation = () => ({ start: (done?: () => void) => done?.() });
  return {
    View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"),
    Image: Object.assign(host("Image"), { resolveAssetSource: () => ({ uri: "wordmark.png" }) }),
    ActivityIndicator: host("ActivityIndicator"), ScrollView: host("ScrollView"),
    TextInput: host("TextInput"), StatusBar: host("StatusBar"),
    Animated: {
      View: host("Animated.View"), Text: host("Animated.Text"), Value,
      timing: animation, parallel: animation, sequence: animation, stagger: animation,
      delay: animation,
    },
    Easing: { out: (value: unknown) => value, cubic: "cubic" },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5 },
    Platform: {
      get OS() { return platformOS; },
      select: (options: any) => options[platformOS] ?? options.default,
    },
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
    BackHandler: { addEventListener: () => ({ remove: jest.fn() }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(() => Promise.resolve(reducedMotion)),
      addEventListener: () => ({ remove: jest.fn() }),
    },
    Keyboard: {
      addListener: (event: string) => {
        keyboardEvents.push(event);
        return { remove: jest.fn() };
      },
      dismiss: jest.fn(),
    },
    AppState: { currentState: "active", addEventListener: () => ({ remove: jest.fn() }) },
    useWindowDimensions: () => ({ width: windowWidth, height: 844 }),
    // The tab had no width yet when the bundle loaded.
    Dimensions: { get: () => ({ width: 0, height: 0 }) },
    PixelRatio: { roundToNearestPixel: (value: number) => value },
  };
});

jest.mock("react-native-safe-area-context", () => {
  const ReactLocal = require("react");
  return {
    SafeAreaView: (props: any) => ReactLocal.createElement("SafeAreaView", props, props.children),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
  };
});
jest.mock("../../../constants/designSystem", () => jest.requireActual("../../../constants/designSystem"));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { buttonPress: jest.fn() } }));
jest.mock("../../ui/BrandIcons", () => ({ AppleLogo: () => React.createElement("AppleLogo") }));
jest.mock("../../ui/Icon", () => ({ Icon: () => React.createElement("Icon") }));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_WORDMARK: 2052 }));
jest.mock("../../../../assets/google_icon.png", () => 2053);
jest.mock("../../../../assets/welcome/mingla-welcome-portrait.mp4", () => 2054);
jest.mock("../../../../assets/welcome/mingla-welcome-portrait-poster.jpg", () => 2055);
jest.mock("../WelcomeVideoBackground", () => ({
  WelcomeVideoBackground: () => React.createElement("WelcomeVideoBackground"),
}), { virtual: true });
jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup: (player: any) => void) => {
    const player = {
      loop: false, muted: false, replaceAsync, play, pause,
      addListener: (_name: string, callback: typeof statusListener) => {
        statusListener = callback;
        return { remove: jest.fn() };
      },
    };
    setup(player);
    return player;
  },
  VideoView: (props: any) => {
    firstFrame = props.onFirstFrameRender;
    return React.createElement("VideoView", props);
  },
}));

import BusinessWelcomeScreen from "../BusinessWelcomeScreen";

const flatten = (style: any): Record<string, unknown> =>
  Array.isArray(style)
    ? style.reduce((acc, item) => ({ ...acc, ...flatten(item) }), {})
    : style && typeof style === "object" ? style : {};

describe("#4420 Host web sign-in buttons never collapse on first load", () => {
  test("SB-1 each sign-in button keeps a positive width cap", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <BusinessWelcomeScreen
          onAppleSignIn={jest.fn(() => Promise.resolve({ error: null }))}
          onGoogleSignIn={jest.fn(() => Promise.resolve({ error: null }))}
          onEmailSignIn={jest.fn(() => Promise.resolve({ error: null }))}
          onVerifyEmailOtp={jest.fn(() => Promise.resolve({ error: null }))}
        />,
      );
    });
    for (const label of ["Continue with Apple", "Continue with Google", "Continue with Email"]) {
      const style = flatten(tree!.root.findByProps({ accessibilityLabel: label }).props.style);
      expect(style.width).toBe("100%");
      expect(style.maxWidth).toBeGreaterThanOrEqual(320);
    }
  });
});
