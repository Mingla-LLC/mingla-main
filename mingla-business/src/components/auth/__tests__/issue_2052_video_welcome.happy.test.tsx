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
// [TEST-MOD-APPROVED #4420] — the screen now reads Graphite tokens, so the
// design-system mock is the real token file; the platform, width and keyboard
// events are switchable for the desktop split layout and the keyboard fix.
let platformOS = "ios";
let windowWidth = 390;
const keyboardEvents: string[] = [];

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
    Alert: { alert: jest.fn() },
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

const flattenStyle = (style: unknown) =>
  Object.assign({}, ...((Array.isArray(style) ? style : [style]).filter(Boolean)));

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

    const wordmark = tree!.root.findByProps({ accessibilityLabel: "Mingla" });
    expect(flattenStyle(wordmark.props.style)).toMatchObject({ width: 108 });
    expect(flattenStyle(wordmark.parent?.props.style)).toMatchObject({
      width: 140,
      height: 54,
      backgroundColor: "#ffffff",
      borderRadius: 999,
    });
    const tagline = tree!.root.findByProps({
      accessibilityLabel: "Great places and experiences deserve to be discovered.",
    });
    expect(flattenStyle(tagline.props.style)).toMatchObject({
      color: "#ffffff",
      textShadowColor: "rgba(0, 0, 0, 0.45)",
    });
    const appleButton = tree!.root.findByProps({ accessibilityLabel: "Continue with Apple" });
    expect(flattenStyle(appleButton.props.style)).toMatchObject({
      backgroundColor: "#ffffff",
    });

    await act(async () => tree!.root.findByProps({ accessibilityLabel: "Continue with Apple" }).props.onPress());
    await act(async () => tree!.root.findByProps({ accessibilityLabel: "Continue with Google" }).props.onPress());
    expect(onAppleSignIn).toHaveBeenCalledTimes(1);
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);

    act(() => tree!.root.findByProps({ accessibilityLabel: "Continue with Email" }).props.onPress());
    expect(tree!.root.findByProps({ accessibilityLabel: "Email address" })).toBeTruthy();
    act(() => tree!.root.findByProps({ accessibilityLabel: "Back to sign-in options" }).props.onPress());
    expect(tree!.root.findByProps({ accessibilityLabel: "Continue with Email" })).toBeTruthy();
  });

  // #4420 round-3 item 1 — desktop: the video pane carries the centred
  // tagline; the sign-in panel on the right carries the logo and actions.
  test("desktop web splits video + tagline (left) from the sign-in panel (right)", async () => {
    platformOS = "web";
    windowWidth = 1440;
    let tree: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = TestRenderer.create(
          <BusinessWelcomeScreen
            onAppleSignIn={jest.fn(() => Promise.resolve())}
            onGoogleSignIn={jest.fn(() => Promise.resolve())}
            onEmailSignIn={jest.fn(() => Promise.resolve({ error: null }))}
            onVerifyEmailOtp={jest.fn(() => Promise.resolve({ error: null }))}
          />,
        );
      });
      await flush();
      const video = tree!.root.findByType("WelcomeVideoBackground" as any);
      const tagline = tree!.root.findByProps({
        accessibilityLabel: "Great places and experiences deserve to be discovered.",
      });
      const panel = tree!.root.findByType("SafeAreaView" as any);
      const within = (node: any, ancestor: any): boolean => {
        for (let cur = node.parent; cur; cur = cur.parent) if (cur === ancestor) return true;
        return false;
      };
      // Tagline shares the video's pane, never the panel.
      expect(within(tagline, video.parent)).toBe(true);
      expect(within(tagline, panel)).toBe(false);
      // The actions live in the panel.
      expect(within(tree!.root.findByProps({ accessibilityLabel: "Continue with Apple" }), panel)).toBe(true);
      expect(flattenStyle(panel.props.style)).toMatchObject({ width: 560 });
    } finally {
      platformOS = "ios";
      windowWidth = 390;
    }
  });

  // #4420 round-3 item 3 — iOS moves the email/code field WITH the keyboard.
  test("iOS listens to keyboardWillShow / keyboardWillHide", async () => {
    keyboardEvents.length = 0;
    await act(async () => {
      TestRenderer.create(
        <BusinessWelcomeScreen
          onAppleSignIn={jest.fn(() => Promise.resolve())}
          onGoogleSignIn={jest.fn(() => Promise.resolve())}
          onEmailSignIn={jest.fn(() => Promise.resolve({ error: null }))}
          onVerifyEmailOtp={jest.fn(() => Promise.resolve({ error: null }))}
        />,
      );
    });
    expect(keyboardEvents).toEqual(expect.arrayContaining(["keyboardWillShow", "keyboardWillHide"]));
    expect(keyboardEvents).not.toContain("keyboardDidShow");
  });
});
