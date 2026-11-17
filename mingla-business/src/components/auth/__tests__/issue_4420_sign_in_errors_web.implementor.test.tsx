// @ts-nocheck -- the test supplies a minimal host-component RN runtime (same harness as issue_2052).
// issue #4420 — sign-in errors never showed on Host web: the screen raised
// them with `Alert.alert`, which react-native-web implements as a no-op, and
// the web Google / Apple redirect failure came back as `{ error }` that the
// sign-in routes threw away.
//
// WHAT THIS FILE PROVES (the REAL BusinessWelcomeScreen, mounted as web)
//   SE-1 a failed "Send code" shows an inline error with the reason.
//   SE-2 a wrong 6-digit code shows an inline error and returns to code entry.
//   SE-3 a failed web Google redirect (returned `{ error }`) shows an inline error.
//   SE-4 a cancelled web sign-in shows nothing.
//   SE-5 a thrown provider failure shows an inline error on native too, and
//        the native returned `{ error }` (AuthContext already alerted) does not
//        double up.
//   SE-6 the error clears on the next attempt.
//   No path calls Alert.alert.
//
// FAILS-ON-REVERT: restore src/components/auth/BusinessWelcomeScreen.tsx from
// origin/main and SE-1..SE-3 go red.
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
const windowWidth = 390;
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

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const mount = async (props: Record<string, unknown> = {}) => {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <BusinessWelcomeScreen
        onAppleSignIn={jest.fn(() => Promise.resolve({ error: null }))}
        onGoogleSignIn={jest.fn(() => Promise.resolve({ error: null }))}
        onEmailSignIn={jest.fn(() => Promise.resolve({ error: null }))}
        onVerifyEmailOtp={jest.fn(() => Promise.resolve({ error: null }))}
        {...props}
      />,
    );
  });
  await flush();
  return tree!;
};

const press = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  await act(async () => {
    await tree.root.findByProps({ accessibilityLabel: label }).props.onPress();
  });
  await flush();
};

const errorText = (tree: TestRenderer.ReactTestRenderer): string | null => {
  const nodes = tree.root.findAll((n) => n.props.testID === "welcome-auth-error" && n.type === "View");
  if (nodes.length === 0) return null;
  expect(nodes[0].props.accessibilityRole).toBe("alert");
  return nodes[0]
    .findAll((n) => n.type === "Text")
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : n.props.children))
    .join(" | ");
};

const typeEmail = async (tree: TestRenderer.ReactTestRenderer, value: string) => {
  await act(async () => {
    tree.root.findByProps({ accessibilityLabel: "Email address" }).props.onChangeText(value);
  });
};

describe("#4420 sign-in errors show inline on Host web", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platformOS = "web";
    statusListener = undefined;
    firstFrame = undefined;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test("SE-1 a failed Send code shows the reason inline", async () => {
    const tree = await mount({
      onEmailSignIn: jest.fn(() => Promise.resolve({ error: new Error("Email rate limit exceeded") })),
    });
    await press(tree, "Continue with Email");
    await typeEmail(tree, "host@example.com");
    expect(errorText(tree)).toBeNull();
    await press(tree, "Send 6-digit code");
    expect(errorText(tree)).toBe("Couldn't send code | Email rate limit exceeded");
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test("SE-2 a wrong code shows the reason inline and returns to code entry", async () => {
    const tree = await mount({
      onVerifyEmailOtp: jest.fn(() => Promise.resolve({ error: new Error("Token has expired or is invalid") })),
    });
    await press(tree, "Continue with Email");
    await typeEmail(tree, "host@example.com");
    await press(tree, "Send 6-digit code");
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: "6-digit code" }).props.onChangeText("123456");
    });
    await flush();
    expect(errorText(tree)).toBe("Couldn't sign in | Token has expired or is invalid");
    expect(tree.root.findAllByProps({ accessibilityLabel: "6-digit code" }).length).toBeGreaterThan(0);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test("SE-3 a failed web Google redirect shows an inline error", async () => {
    const tree = await mount({
      onGoogleSignIn: jest.fn(() => Promise.resolve({ error: new Error("Unsupported provider") })),
    });
    await press(tree, "Continue with Google");
    expect(errorText(tree)).toBe("Couldn't sign you in | Something didn't connect. Give it another tap.");
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test("SE-4 a cancelled web sign-in shows nothing", async () => {
    const tree = await mount({
      onAppleSignIn: jest.fn(() => Promise.resolve({ error: new Error("The user cancelled the sign-in") })),
    });
    await press(tree, "Continue with Apple");
    expect(errorText(tree)).toBeNull();
  });

  test("SE-5 native: a thrown failure shows inline; a returned one (AuthContext alerted) does not double up", async () => {
    platformOS = "ios";
    const tree = await mount({
      onAppleSignIn: jest.fn(() => Promise.resolve({ error: new Error("network") })),
      onGoogleSignIn: jest.fn(() => Promise.reject(new Error("boom"))),
    });
    await press(tree, "Continue with Apple");
    expect(errorText(tree)).toBeNull();
    await press(tree, "Continue with Google");
    expect(errorText(tree)).toBe("Couldn't sign you in | Something didn't connect. Give it another tap.");
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test("SE-6 the error clears on the next attempt", async () => {
    const onGoogleSignIn = jest
      .fn()
      .mockResolvedValueOnce({ error: new Error("Unsupported provider") })
      .mockResolvedValueOnce({ error: null });
    const tree = await mount({ onGoogleSignIn });
    await press(tree, "Continue with Google");
    expect(errorText(tree)).not.toBeNull();
    await press(tree, "Continue with Google");
    expect(errorText(tree)).toBeNull();
  });
});
