/**
 * #1890 [keyboard-clearance-overshoot], rewritten by #4572 item 16.
 *
 * [TEST-MOD-APPROVED #4572] The #1890 contract was "the composer's
 * paddingBottom is keyboardHeight + DONE_BAR_OCCUPIED + 12 above the bar".
 * Item 16 (Seth, 2026-11-23) replaced it: the Ari composer rides the keyboard
 * in a keyboard-controller KeyboardAvoidingView (the #4173 messages pattern)
 * and sits FLUSH on it, with NO Done bar and 0 clearance while it is focused.
 * The assertions this file replaced are named next to each new one below.
 * What #1890 protected is KEPT: the pill's own measured height is never an
 * input to the composer's position (the double count), and every number is
 * read off the MOUNTED tree, never off module text.
 *
 * The new shape, read off the mounted tree:
 *   - the composer wrapper (`inputWrap`) carries only the container's own
 *     space[2] below the pill, whatever the keyboard height is;
 *   - it sits inside a KeyboardAvoidingView (behavior="padding"), followed by
 *     a resting spacer of (insets.bottom + tab-bar room - space[2]); the
 *     library pads the view by only the part of the keyboard that rises past
 *     that spacer, so closed the pill rests where it always did and open it
 *     ends flush on the keyboard;
 *   - focusing the field raises the Done-bar suppression flag, blur lowers it.
 *
 * NO JSX IN THIS FILE, DELIBERATELY. The render configs transform through
 * babel-preset-expo, which gates the TypeScript plugin on the file extension:
 * `.ts` compiles with `isTSX: false`, so a single `<View/>` literal is a
 * syntax error. Everything uses React.createElement.
 *
 * fails-on-revert: put the old lift back (`paddingBottom: keyboardHeight +
 * DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE` on the wrapper, no
 * KeyboardAvoidingView) and assertions 1, 3 and 4 go red.
 */

import React from "react";

// ───────────────────────── platform, driveable ──────────────────────────────
/**
 * The one shared platform-state object, on `globalThis` so BOTH this module's
 * initialiser and the `react-native` mock factory find the SAME reference
 * across every `jest.isolateModules` registry. #1834 hit the re-invocation trap
 * where a module-scope object was re-created per registry and the mock kept
 * reading a stale copy — the branch then never switched and the suite executed
 * one platform N times while claiming three.
 */
const PLATFORM_STATE: { OS: string; Version: number | string } = (() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1890_PLATFORM__ == null) {
    scope.__ISSUE_1890_PLATFORM__ = { OS: "ios", Version: 26 };
  }
  return scope.__ISSUE_1890_PLATFORM__ as { OS: string; Version: number | string };
})();

/**
 * Overridden LAZILY, through a Proxy, never by spreading. `{...actual}` walks
 * every property on react-native's index, and several are getters that call
 * `TurboModuleRegistry.getEnforcing` — `DevMenu` throws "could not be found"
 * under jest the instant it is read. The Proxy forwards untouched properties on
 * demand, so only `Platform` is ever intercepted and nothing else is evaluated.
 */
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1890_PLATFORM__ == null) {
    scope.__ISSUE_1890_PLATFORM__ = { OS: "ios", Version: 26 };
  }
  const state = scope.__ISSUE_1890_PLATFORM__ as { OS: string; Version: number | string };

  const platform = new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (prop === "OS") return state.OS;
        if (prop === "Version") return state.Version;
        if (prop === "select") {
          return (spec: Record<string, unknown>) => {
            if (state.OS in spec) return spec[state.OS];
            if ("native" in spec && state.OS !== "web") return spec.native;
            return spec.default;
          };
        }
        return (actual.Platform as Record<string | symbol, unknown>)[prop];
      },
    },
  );

  return new Proxy(actual as object, {
    get(target, prop: string | symbol) {
      if (prop === "Platform") return platform;
      return (target as Record<string | symbol, unknown>)[prop];
    },
  });
});

// ───────────────────────── keyboard height, driveable ───────────────────────
const KEYBOARD_STATE: { height: number } = (() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1890_KB__ == null) scope.__ISSUE_1890_KB__ = { height: 336 };
  return scope.__ISSUE_1890_KB__ as { height: number };
})();
jest.mock("../../../wrappers/useKeyboardHeight", () => ({
  useKeyboardHeight: () =>
    ((globalThis as unknown as Record<string, { height: number }>).__ISSUE_1890_KB__ ?? { height: 336 }).height,
}));

// ───────────────────────── environment mocks ────────────────────────────────
jest.mock("react-native-keyboard-controller", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
  // [TEST-MOD-APPROVED #4572] the composer now sits in the library's
  // KeyboardAvoidingView; a locatable host stand-in that keeps its props.
  // #4572 retest P1-1 — it also keeps `keyboardVerticalOffset`, the one input
  // that puts the library's parent-relative frame into screen space.
  KeyboardAvoidingView: (props: { children?: React.ReactNode; behavior?: string; keyboardVerticalOffset?: number }) =>
    R.createElement(
      RN.View,
      { testID: "keyboard-avoiding-view", behavior: props.behavior, keyboardVerticalOffset: props.keyboardVerticalOffset },
      props.children,
    ),
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
  KeyboardToolbar: "KeyboardToolbar@library",
  KeyboardProvider: ({ children }: { children?: React.ReactNode }) => children,
  // #4420 — mock-surface widening only: SmartScrollView reads the focused
  // field's height from the library's focused-input value; nothing is focused.
  useReanimatedFocusedInput: () => ({ input: null }),
  };
});

jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native");
  const passthrough = (c: unknown): unknown => c;
  return {
    __esModule: true,
    default: { View: V, createAnimatedComponent: passthrough },
    View: V,
    createAnimatedComponent: passthrough,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (v: unknown) => v,
    cancelAnimation: () => undefined,
    useReducedMotion: () => true,
    // [TEST-MOD-APPROVED #3429] Mock-surface widening only; no assertion
    // changed. #3429 gives the composer an attachment source sheet, so
    // AriChatScreen's graph now reaches SheetMobile, which uses
    // `Easing.in(Easing.cubic)`. The four-member stand-in below threw
    // "Easing.in is not a function" and took all six tests with it. Every
    // easing is identity here because this suite measures PADDING, not motion.
    Easing: (() => {
      const identity = (t: number): number => t;
      const shape = (fn?: unknown): unknown => fn ?? identity;
      return {
        bezier: () => identity,
        in: shape,
        out: shape,
        inOut: shape,
        ease: identity,
        linear: identity,
        quad: identity,
        cubic: identity,
        sin: identity,
        circle: identity,
        exp: identity,
        poly: () => identity,
        elastic: () => identity,
        back: () => identity,
        bounce: identity,
      };
    })(),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock("react-native-svg", () => {
  const { View: V } = jest.requireActual("react-native");
  return { __esModule: true, default: V, Svg: V, Circle: V, Path: V, Defs: V, RadialGradient: V, Stop: V, G: V, Ellipse: V };
});

jest.mock("react-native-gesture-handler", () => {
  const { View: V } = jest.requireActual("react-native");
  return {
    __esModule: true,
    GestureDetector: ({ children }: { children?: React.ReactNode }) => children,
    Gesture: { Pan: () => ({ onUpdate: () => ({ onEnd: () => ({}) }), onEnd: () => ({}) }) },
    GestureHandlerRootView: V,
    PanGestureHandler: V,
    State: {},
  };
});

jest.mock("expo-blur", () => {
  const { View: V } = jest.requireActual("react-native");
  return { BlurView: V };
});
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
}));

jest.mock("lucide-react-native", () => {
  const { View: V } = jest.requireActual("react-native");
  return new Proxy({}, { get: () => V });
});

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn(), getQueryData: jest.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("../../../services/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }) }), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

jest.mock("../../../components/ui/Sheet", () => {
  const { View: V } = jest.requireActual("react-native");
  return { Sheet: V, SheetMobile: V };
});

// Toast pulls gesture-handler + expo-blur + reanimated; it is not under test.
jest.mock("../../../components/ui/Toast", () => ({ Toast: () => null }));

// ───────────────────────── app-state mocks ──────────────────────────────────
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1890" }, isAuthReady: true, loading: false, session: { access_token: "t" } }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrands: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useAriPreferences", () => ({
  useAriPreferences: () => ({
    profile: { ai_disclosure_acknowledged_at: "2026-01-01T00:00:00Z" },
    isLoading: false,
    update: jest.fn(),
    acknowledge: jest.fn(async () => undefined),
    deleteAll: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useConversationList", () => ({
  useConversationList: () => ({ conversations: [], isLoading: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useConfirmPendingAction", () => ({
  useConfirmPendingAction: () => ({
    confirm: jest.fn(async () => ({ kind: "executed", result: null })),
    cancel: jest.fn(async () => ({ kind: "cancelled" })),
    isExecuting: false,
  }),
}));
jest.mock("../../../hooks/useAgentChat", () => ({
  // `agentQueryKeys` is imported by ConversationDrawer — omitting it makes that
  // import `undefined` and the drawer throws at module scope.
  agentQueryKeys: { conversations: () => [], messages: () => [], profile: () => [] },
  useAgentChat: () => ({
    messages: [],
    isLoadingMessages: false,
    sendMessage: jest.fn(async () => ({})),
    isSending: false,
    pendingAction: null,
    clearPendingAction: jest.fn(),
    conversationId: null,
    setConversationId: jest.fn(),
    brandId: null,
    errorMessage: null,
    clearErrorMessage: jest.fn(),
    // [TEST-MOD-APPROVED #3429] Mock-surface widening only; no assertion
    // changed. #3429 grows useAgentChat's return with the turn-lifecycle and
    // surface members AriChatScreen now reads. A partial mock silently yields
    // `undefined` for anything it omits, so the screen died on
    // `chat.setSurface is not a function` before a single padding assertion
    // ran. Kept in the same order the hook returns them.
    setSurface: jest.fn(),
    // #2830 — AriChatScreen sets the Website setup workflow context on mount.
    // Mock-surface widening only; no clearance assertion changes.
    setWorkflowContext: jest.fn(),
    activeTurn: null,
    stopTurn: jest.fn(),
    retryTurn: jest.fn(),
    editTurn: jest.fn(),
    discardTurn: jest.fn(),
    sendChoice: jest.fn(async () => ({})),
    beginConfirmedActivity: jest.fn(),
    finishConfirmedActivity: jest.fn(),
    retryTenantRecovery: jest.fn(),
    errorCode: null,
  }),
}));
// [TEST-MOD-APPROVED #2013] — tenant containment wired the canonical
// BrandSwitcherSheet into AriChatScreen. That sheet pulls currentBrandStore
// (AsyncStorage/Zustand persist). This suite mounts the real screen only to
// read inputWrap paddingBottom; brand switching is not under test. Stub both
// the sheet and useCurrentBrand so the keyboard-clearance tree still mounts.
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => null,
}));
jest.mock("../../../components/brand/BrandSwitcherSheet", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return { BrandSwitcherSheet: () => R.createElement(RN.View, { testID: "ari-brand-switcher-stub" }) };
});

/**
 * The composer itself is stubbed to a locatable host node. It is not under
 * test — the quantity under test is the WRAPPER's resolved paddingBottom — and
 * stubbing it keeps the mount off reanimated's animated TextInput path.
 */
jest.mock("../../../components/ari/InputBar", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    InputBar: (props: { onFocus?: () => void; onBlur?: () => void }) =>
      R.createElement(RN.View, { testID: "ari-input-bar", onFocus: props.onFocus, onBlur: props.onBlur }),
  };
});

// ───────────────────────── helpers ──────────────────────────────────────────
type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  parent: HostNode | null;
  children: unknown[];
};

const flatten = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) return style.reduce<Record<string, unknown>>((acc, s) => ({ ...acc, ...flatten(s) }), {});
  if (style && typeof style === "object") return style as Record<string, unknown>;
  return {};
};

/** Depth-first search for the stubbed composer's host node. */
const findByTestId = (root: HostNode, testID: string): HostNode => {
  const stack: HostNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as HostNode;
    if (node?.props?.testID === testID) return node;
    for (const child of node?.children ?? []) {
      if (child && typeof child === "object") stack.push(child as HostNode);
    }
  }
  throw new Error(
    `[#1890] no node with testID="${testID}" in the mounted tree. The composer is the anchor ` +
      "every measurement here hangs off, so failing to find it is a FAILURE, never a skip.",
  );
};

/**
 * Walk up from the stubbed composer to the nearest host ancestor whose resolved
 * style carries a numeric `paddingBottom`. That is `inputWrap`. Located
 * structurally rather than by a style-value match, so the assertion cannot
 * accidentally read some other padded container.
 */
const findComposerWrapper = (root: HostNode): HostNode => {
  let node: HostNode | null = root;
  while (node != null) {
    const pb = flatten(node.props.style).paddingBottom;
    if (typeof pb === "number") return node;
    node = node.parent;
  }
  throw new Error(
    "[#1890] no ancestor of the composer exposes a numeric paddingBottom. The lift is what " +
      "this suite measures, so failing to find it is a FAILURE, never a skip.",
  );
};

/** Where the mocked composer host sits on screen (status bar + Ari top bar). */
const COMPOSER_HOST_WINDOW_Y = 118;

interface Branch {
  readonly id: string;
  /** The composer wrapper's resolved paddingBottom (the pill container's own space). */
  readonly paddingBottom: number;
  readonly paddingAt52: number;
  readonly paddingAt200: number;
  /** paddingBottom after firing EACH handler alone at an absurd height. */
  readonly paddingPerHandler: readonly number[];
  readonly kav: {
    found: boolean;
    behavior: unknown;
    containsWrapper: boolean;
    offsetBeforeLayout: unknown;
    offsetAfterLayout: unknown;
  };
  /** The resting spacer's height, and whether it is the KAV's next sibling. */
  readonly spacerHeight: number | null;
  readonly spacerFollowsKav: boolean;
  /** Done-bar suppression flag read after focus, then after blur. */
  readonly flagAfterFocus: boolean;
  readonly flagAfterBlur: boolean;
}

/**
 * Mount AriChatScreen under a chosen platform and keyboard height in its own
 * module registry, then report the resolved composer geometry, what happens
 * when every onLayout in the composer subtree is fired, and the focus flag.
 */
function measureBranch(id: string, os: string, version: number | string, keyboardHeight = 336): Branch {
  PLATFORM_STATE.OS = os;
  PLATFORM_STATE.Version = version;
  KEYBOARD_STATE.height = keyboardHeight;

  let result: Branch | null = null;

  // React, the renderer and the screen must ALL come from the SAME isolated
  // registry (two React instances = a null hook dispatcher). `react-test-
  // renderer` rather than RTL: RTL registers hooks at module scope.
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const R = require("react") as typeof React;
    const TR = require("react-test-renderer") as {
      create: (e: unknown) => { root: HostNode; unmount: () => void };
      act: (cb: () => void) => void;
    };
    const suppression = require("../../../wrappers/doneBarSuppression") as { getDoneBarSuppressed: () => boolean };
    const { AriChatScreen } = require("../AriChatScreen") as { AriChatScreen: React.ComponentType };
    // #4572 retest P1-1 — react-native's jest View shares one native-methods
    // object; make its measureInWindow report the composer host's screen Y so
    // the screen's measured offset is observable on the mounted tree.
    const nativeMethods = (
      require("react-native/jest/MockNativeMethods") as {
        default: { measureInWindow: jest.Mock };
      }
    ).default;
    nativeMethods.measureInWindow.mockImplementation(
      (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, COMPOSER_HOST_WINDOW_Y, 402, 700),
    );
    /* eslint-enable @typescript-eslint/no-require-imports */

    let tree: { root: HostNode; unmount: () => void } | null = null;
    TR.act(() => {
      tree = TR.create(R.createElement(AriChatScreen));
    });
    if (tree == null) throw new Error(`[#1890] renderer produced no tree under ${os}/${version}.`);
    const root = (tree as { root: HostNode }).root;
    const composer = findByTestId(root, "ari-input-bar");
    const wrapper = findComposerWrapper(composer);
    const readPadding = (): number => flatten(wrapper.props.style).paddingBottom as number;

    const layoutHandlers: ((e: unknown) => void)[] = [];
    const walk = (node: HostNode): void => {
      if (typeof node.props?.onLayout === "function") {
        layoutHandlers.push(node.props.onLayout as (e: unknown) => void);
      }
      for (const child of node.children ?? []) {
        if (child && typeof child === "object") walk(child as HostNode);
      }
    };
    walk(wrapper);
    const fireAll = (height: number): void => {
      TR.act(() => {
        for (const h of layoutHandlers) h({ nativeEvent: { layout: { x: 0, y: 0, width: 375, height } } });
      });
    };
    fireAll(52);
    const paddingAt52 = readPadding();
    fireAll(200);
    const paddingAt200 = readPadding();
    const paddingPerHandler = layoutHandlers.map((handler) => {
      TR.act(() => {
        handler({ nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 999 } } });
      });
      return readPadding();
    });
    fireAll(200);

    // The KeyboardAvoidingView ancestor and the resting spacer beside it.
    let kavNode: HostNode | null = wrapper.parent;
    while (kavNode != null && kavNode.props?.testID !== "keyboard-avoiding-view") kavNode = kavNode.parent;
    // #4572 retest P1-1 — the offset before and after the composer host lays
    // out (and is measured in the window).
    const offsetBeforeLayout = kavNode?.props?.keyboardVerticalOffset;
    const hostNode = findByTestId(root, "ari-composer-host");
    TR.act(() => {
      (hostNode.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 700 } },
      });
    });
    let kavAfter: HostNode | null = findComposerWrapper(findByTestId(root, "ari-input-bar")).parent;
    while (kavAfter != null && kavAfter.props?.testID !== "keyboard-avoiding-view") kavAfter = kavAfter.parent;
    const offsetAfterLayout = kavAfter?.props?.keyboardVerticalOffset;
    const spacerNode = (() => {
      try {
        return findByTestId(root, "ari-composer-rest-spacer");
      } catch {
        return null;
      }
    })();
    // Document order: the spacer must come AFTER the whole KeyboardAvoidingView
    // subtree (so the keyboard's overlap starts above it), never inside it.
    const order: HostNode[] = [];
    const collect = (node: HostNode): void => {
      order.push(node);
      for (const child of node.children ?? []) {
        if (child && typeof child === "object") collect(child as HostNode);
      }
    };
    collect(root);
    let spacerFollowsKav = false;
    if (kavNode != null && spacerNode != null) {
      const kavStart = order.indexOf(kavNode);
      const subtree: HostNode[] = [];
      const walkKav = (node: HostNode): void => {
        subtree.push(node);
        for (const child of node.children ?? []) {
          if (child && typeof child === "object") walkKav(child as HostNode);
        }
      };
      walkKav(kavNode);
      const kavEnd = kavStart + subtree.length - 1;
      const spacerAt = order.indexOf(spacerNode);
      spacerFollowsKav = kavStart >= 0 && spacerAt > kavEnd && !subtree.includes(spacerNode);
    }

    // Focus the (stubbed) composer, then blur it: the Done-bar flag follows.
    TR.act(() => {
      (composer.props.onFocus as () => void)();
    });
    const flagAfterFocus = suppression.getDoneBarSuppressed();
    TR.act(() => {
      (composer.props.onBlur as () => void)();
    });
    const flagAfterBlur = suppression.getDoneBarSuppressed();

    result = {
      id,
      paddingBottom: readPadding(),
      paddingAt52,
      paddingAt200,
      paddingPerHandler,
      kav: {
        found: kavNode != null,
        behavior: kavNode?.props?.behavior,
        containsWrapper: kavNode != null,
        offsetBeforeLayout,
        offsetAfterLayout,
      },
      spacerHeight: spacerNode == null ? null : (flatten(spacerNode.props.style).height as number),
      spacerFollowsKav,
      flagAfterFocus,
      flagAfterBlur,
    };
    TR.act(() => {
      TR.act(() => {
        (tree as unknown as { unmount: () => void }).unmount();
      });
    });
  });

  if (result == null) {
    throw new Error(`[#1890] AriChatScreen failed to mount under ${os}/${version}.`);
  }
  return result;
}

// Insets are mocked at bottom 34; the screen reserves the floating tab bar's
// 80pt on top of it. The pill's container keeps space[2] (8) under the pill.
const INSET_BOTTOM = 34;
const TAB_ROOM = 80;
const CONTAINER_SPACE = 8;

describe("#4572 (was #1890) — Ari composer rides the keyboard and sits flush", () => {
  const branches: Branch[] = [];

  beforeAll(() => {
    branches.push(measureBranch("ios-26", "ios", 26));
    branches.push(measureBranch("ios-18", "ios", 18));
    branches.push(measureBranch("android", "android", 34));
  });

  // ── 0. VACUITY GUARD — throws, never skips ────────────────────────────────
  it("0. VACUITY GUARD — three native branches really loaded and the KeyboardAvoidingView was found", () => {
    if (branches.length !== 3) {
      throw new Error(`[#1890] expected 3 branches, measured ${branches.length}.`);
    }
    for (const b of branches) {
      if (!Number.isFinite(b.paddingBottom)) {
        throw new Error(
          `[#1890] branch ${b.id} produced no numeric paddingBottom. An assertion that cannot ` +
            "see the quantity it claims to test is a FAILURE, never a pass.",
        );
      }
      if (!b.kav.found || b.spacerHeight === null) {
        throw new Error(
          `[#4572] branch ${b.id} mounted no KeyboardAvoidingView / resting spacer: this would be ` +
            "the web branch wearing a native name, and every assertion below would be blind.",
        );
      }
    }
  });

  // ── 1. flush: replaces "the lift is keyboardHeight + DONE_BAR_OCCUPIED + 12" ─
  it("1. the composer's own bottom space is just the container's space[2]; no Done bar, no 12pt clearance", () => {
    for (const b of branches) {
      expect(b.paddingBottom).toBe(CONTAINER_SPACE);
    }
    // And it is the same with the keyboard CLOSED and OPEN: the keyboard's
    // height no longer feeds the composer's own padding at all.
    const closed = measureBranch("ios-26-closed", "ios", 26, 0);
    const open = measureBranch("ios-26-open", "ios", 26, 336);
    expect(closed.paddingBottom).toBe(open.paddingBottom);
    expect(open.paddingBottom).toBe(CONTAINER_SPACE);
  });

  // ── 2. replaces "the clearance straddles the library's >= 26 boundary" ────
  it("2. nothing depends on the iOS 26 Done-bar boundary any more", () => {
    const at25 = measureBranch("probe-25.9", "ios", "25.9");
    const at26 = measureBranch("probe-26.0", "ios", "26.0");
    expect(at25.paddingBottom).toBe(at26.paddingBottom);
    expect(at25.spacerHeight).toBe(at26.spacerHeight);
  });

  // ── 3. KeyboardAvoidingView + resting spacer ──────────────────────────────
  it("3. the composer sits in a KeyboardAvoidingView (padding), followed by a resting spacer", () => {
    for (const b of branches) {
      expect(b.kav.found).toBe(true);
      expect(b.kav.behavior).toBe("padding");
      // Closed, the pill rests exactly where it always did: the spacer plus the
      // container's space[2] equals insets.bottom + the tab bar's room.
      expect(b.spacerHeight).toBe(INSET_BOTTOM + TAB_ROOM - CONTAINER_SPACE);
      expect((b.spacerHeight as number) + b.paddingBottom).toBe(INSET_BOTTOM + TAB_ROOM);
      // The spacer is AFTER the view, so the keyboard's overlap with the view's
      // frame starts above it (it holds still until the keyboard reaches it).
      expect(b.spacerFollowsKav).toBe(true);
    }
  });

  // ── 3b. #4572 retest P1-1: the view's frame is put into screen space ──────
  //
  // The library compares its PARENT-RELATIVE onLayout frame with the
  // keyboard's top in SCREEN space. With no offset the composer stopped short
  // by the host's own screen Y and ended under the keyboard on device. The
  // mounted tree must hand the view the host's measured window Y.
  it("3b. the KeyboardAvoidingView's offset is the composer host's measured window Y", () => {
    for (const b of branches) {
      expect(b.kav.offsetBeforeLayout).toBe(0);
      expect(b.kav.offsetAfterLayout).toBe(COMPOSER_HOST_WINDOW_Y);
    }
  });

  // ── 4. the Done bar is suppressed only while the composer is focused ──────
  it("4. focusing the composer raises the no-Done-bar flag and blur lowers it", () => {
    for (const b of branches) {
      expect(b.flagAfterFocus).toBe(true);
      expect(b.flagAfterBlur).toBe(false);
    }
  });

  // ── 5. THE ANTI-DOUBLE-COUNT ASSERTION (kept from #1890) ──────────────────
  //
  // Firing the composer's layout at 52 and at 200 must leave the padding
  // IDENTICAL, alone and together: the pill's own height is not an input to
  // where the composer sits. Checking only one height would pass on the broken
  // code, which is how this defect survived two prior issues.
  it("5. paddingBottom is INVARIANT to the composer's measured height (52 vs 200, each handler alone)", () => {
    for (const b of branches) {
      expect(b.paddingAt52).toBe(b.paddingAt200);
      expect(b.paddingAt52).toBe(CONTAINER_SPACE);
      for (const [index, padding] of b.paddingPerHandler.entries()) {
        expect({ branch: b.id, handler: index, padding }).toEqual({
          branch: b.id,
          handler: index,
          padding: CONTAINER_SPACE,
        });
      }
    }
  });

  // ── 6. the screen no longer budgets the Done bar at all ───────────────────
  it("6. the screen imports no Done-bar or clearance constant and has no lift expression", () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const src = fs.readFileSync(path.resolve(__dirname, "../AriChatScreen.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/DONE_BAR_OCCUPIED|MIN_VISIBLE_CLEARANCE|composerOccupiedPxFor/);
    expect(code).toMatch(/KeyboardAvoidingView[^\n]*behavior="padding"/);
  });
});
