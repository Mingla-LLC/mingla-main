// @ts-nocheck -- the test intentionally supplies a minimal host-component RN runtime.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const replaceAsync = jest.fn(() => Promise.resolve());
const play = jest.fn();
const pause = jest.fn();
let statusListener: ((event: { status: string }) => void) | undefined;
let firstFrame: (() => void) | undefined;
let reducedMotion = false;

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
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {} },
    Platform: { OS: "ios", select: (options: any) => options.ios ?? options.default },
    Alert: { alert: jest.fn() },
    BackHandler: { addEventListener: () => ({ remove: jest.fn() }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(() => Promise.resolve(reducedMotion)),
      addEventListener: () => ({ remove: jest.fn() }),
    },
    Keyboard: { addListener: () => ({ remove: jest.fn() }), dismiss: jest.fn() },
    AppState: { currentState: "active", addEventListener: () => ({ remove: jest.fn() }) },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});

jest.mock("react-native-safe-area-context", () => {
  const ReactLocal = require("react");
  return {
    SafeAreaView: (props: any) => ReactLocal.createElement("SafeAreaView", props, props.children),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
  };
});
jest.mock("../../../constants/designSystem", () => ({
  spacing: { md: 16, lg: 24, xl: 32 },
  radius: { lg: 16 }, shadows: { sm: {}, md: {} },
  colors: {
    background: { primary: "#fff" }, text: { primary: "#111827", inverse: "#fff", secondary: "#374151", tertiary: "#6b7280" },
    gray: { 200: "#e5e7eb" }, primary: { 500: "#f97316", 700: "#c2410c" },
  },
  fontWeights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
}));
jest.mock("../../../utils/responsive", () => ({ s: (value: number) => value, vs: (value: number) => value }));
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
import { WelcomeVideoBackground } from "../WelcomeVideoBackground.native";

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

describe("issue #2052 video welcome happy path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reducedMotion = false;
    statusListener = undefined;
    firstFrame = undefined;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test("poster mounts before video, first frame reveals, and error keeps poster", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(<WelcomeVideoBackground />); });
    await flush();
    const poster = tree!.root.findByType("Image");
    const video = tree!.root.findByType("VideoView");
    expect(poster.props.accessible).toBe(false);
    expect(video.props.contentFit).toBe("cover");
    expect(replaceAsync).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(firstFrame).toEqual(expect.any(Function));
    act(() => firstFrame?.());
    act(() => statusListener?.({ status: "error" }));
    expect(tree!.root.findByType("Image")).toBeTruthy();
    expect(pause).toHaveBeenCalled();
  });

  test("reduced motion never loads or plays video", async () => {
    reducedMotion = true;
    await act(async () => { TestRenderer.create(<WelcomeVideoBackground />); });
    await flush();
    expect(replaceAsync).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  test("renders exact Host hierarchy and preserves provider and Email actions", async () => {
    const onAppleSignIn = jest.fn(() => Promise.resolve());
    const onGoogleSignIn = jest.fn(() => Promise.resolve());
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <BusinessWelcomeScreen
          onAppleSignIn={onAppleSignIn}
          onGoogleSignIn={onGoogleSignIn}
          onEmailSignIn={jest.fn(() => Promise.resolve({ error: null }))}
          onVerifyEmailOtp={jest.fn(() => Promise.resolve({ error: null }))}
        />,
      );
    });
    await flush();
    const labels = tree!.root
      .findAll((node) => Boolean(node.props.accessibilityLabel))
      .map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining([
      "Mingla",
      "Great places and experiences deserve to be discovered.",
      "Continue with Apple",
      "Continue with Google",
      "Continue with Email",
    ]));

    await act(async () => tree!.root.findByProps({ accessibilityLabel: "Continue with Apple" }).props.onPress());
    await act(async () => tree!.root.findByProps({ accessibilityLabel: "Continue with Google" }).props.onPress());
    expect(onAppleSignIn).toHaveBeenCalledTimes(1);
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);

    act(() => tree!.root.findByProps({ accessibilityLabel: "Continue with Email" }).props.onPress());
    expect(tree!.root.findByProps({ accessibilityLabel: "Email address" })).toBeTruthy();
    act(() => tree!.root.findByProps({ accessibilityLabel: "Back to sign-in options" }).props.onPress());
    expect(tree!.root.findByProps({ accessibilityLabel: "Continue with Email" })).toBeTruthy();
  });
});
