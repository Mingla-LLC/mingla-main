/**
 * #1890 [keyboard-clearance-overshoot] — implementor happy-path render proof.
 *
 * THE DEFECT. `AriChatScreen`'s `inputWrap` carries only paddingHorizontal and
 * paddingTop and is the last in-flow child of a `flex: 1` column, so its
 * dynamic `paddingBottom` ALREADY positions the composer pill's bottom edge.
 * ORCH-1165 REWORK loop 2 added the pill's own MEASURED height on top of that,
 * lifting it a second time. Measured on glass at #1890 INVESTIGATE: 61.0pt of
 * gap on an iPhone SE3 and 71.8dp on a physical Samsung, against a 12pt
 * contract. #1850 then replaced the hand-typed 42 with the derived
 * DONE_BAR_OCCUPIED (53 on iOS 26+), which removed an accidental partial
 * masking and made iOS worse still.
 *
 * WHY THIS SUITE MOUNTS INSTEAD OF GREPPING. The broken arithmetic was pinned
 * as CORRECT by a source-text rule (i-1047 rule (E), inverted by #1890) and by
 * a quarantined ORCH-1165 pin before it. A source pin is the instrument that
 * blessed the bug, so every numeric claim here is read off the MOUNTED tree —
 * the resolved `paddingBottom` on the composer wrapper's host node — never off
 * module text and never off a constant re-declared in this file.
 *
 * NO JSX IN THIS FILE, DELIBERATELY. The render configs transform through
 * babel-preset-expo, which gates the TypeScript plugin on the file extension:
 * `.ts` compiles with `isTSX: false`, so a single `<View/>` literal — even
 * inside a jest.mock factory — is a syntax error. Everything uses
 * React.createElement.
 *
 * fails-on-revert: restore `+ spacing.sm + composerHeight` to the lift (and the
 * `onLayout={onComposerLayout}` wrapper) and assertion 3 goes red — the two
 * onLayout heights produce paddingBottom values 148 apart.
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
const KEYBOARD_HEIGHT = 336;
jest.mock("../../../wrappers/useKeyboardHeight", () => ({
  useKeyboardHeight: () => KEYBOARD_HEIGHT,
}));

// ───────────────────────── environment mocks ────────────────────────────────
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
  KeyboardToolbar: "KeyboardToolbar@library",
  KeyboardProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

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
    Easing: { bezier: () => (t: number) => t, out: (f: unknown) => f, inOut: (f: unknown) => f, ease: (t: number) => t },
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
  }),
}));

/**
 * The composer itself is stubbed to a locatable host node. It is not under
 * test — the quantity under test is the WRAPPER's resolved paddingBottom — and
 * stubbing it keeps the mount off reanimated's animated TextInput path.
 */
jest.mock("../../../components/ari/InputBar", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return { InputBar: () => R.createElement(RN.View, { testID: "ari-input-bar" }) };
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

interface Branch {
  readonly id: string;
  readonly os: string;
  readonly version: number | string;
  readonly doneBarOccupied: number;
  readonly paddingBottom: number;
  readonly onLayoutCount: number;
  readonly paddingAt52: number;
  readonly paddingAt200: number;
}

/**
 * Mount AriChatScreen under a chosen platform in its own module registry, then
 * report the resolved lift AND what happens when every onLayout in the composer
 * subtree is fired at two very different heights.
 */
function measureBranch(id: string, os: string, version: number | string): Branch {
  PLATFORM_STATE.OS = os;
  PLATFORM_STATE.Version = version;

  let result: Branch | null = null;

  // React, the renderer, the shared budget and the screen must ALL come from
  // the SAME isolated registry. Requiring only the component inside
  // `isolateModules` while the renderer closes over the OUTER react gives two
  // React instances, and the fresh one's hook dispatcher is null — "Cannot read
  // properties of null (reading 'useState')" the moment the screen mounts.
  //
  // `react-test-renderer` rather than @testing-library/react-native: RTL
  // registers beforeAll/afterAll at MODULE SCOPE, so re-requiring it per branch
  // throws "Cannot add a hook after tests have started running". The renderer
  // underneath it has no such side effect, and the tree it returns is the same
  // host tree.
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const R = require("react") as typeof React;
    const TR = require("react-test-renderer") as {
      create: (e: unknown) => { root: HostNode; unmount: () => void };
      act: (cb: () => void) => void;
    };
    const clearance = require("../../../wrappers/keyboardClearance.native") as { DONE_BAR_OCCUPIED: number };
    const { AriChatScreen } = require("../AriChatScreen") as { AriChatScreen: React.ComponentType };
    /* eslint-enable @typescript-eslint/no-require-imports */

    let tree: { root: HostNode; unmount: () => void } | null = null;
    TR.act(() => {
      tree = TR.create(R.createElement(AriChatScreen));
    });
    if (tree == null) throw new Error(`[#1890] renderer produced no tree under ${os}/${version}.`);
    const composer = findByTestId((tree as { root: HostNode }).root, "ari-input-bar");
    const wrapper = findComposerWrapper(composer);

    const readPadding = (): number => flatten(wrapper.props.style).paddingBottom as number;

    // Every onLayout in the composer subtree, walking DOWN from the wrapper.
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

    result = {
      id,
      os,
      version,
      doneBarOccupied: clearance.DONE_BAR_OCCUPIED,
      paddingBottom: readPadding(),
      onLayoutCount: layoutHandlers.length,
      paddingAt52,
      paddingAt200,
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

// ───────────────────────── the suite ────────────────────────────────────────
describe("#1890 — Ari composer keyboard clearance", () => {
  const branches: Branch[] = [];

  beforeAll(() => {
    branches.push(measureBranch("ios-26", "ios", 26));
    branches.push(measureBranch("ios-18", "ios", 18));
    branches.push(measureBranch("android", "android", 34));
  });

  // ── 0. VACUITY GUARD — throws, never skips ────────────────────────────────
  it("0. VACUITY GUARD — three branches really loaded, none collapsed to web", () => {
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
      if (b.doneBarOccupied === 0) {
        throw new Error(
          `[#1890] branch ${b.id} resolved DONE_BAR_OCCUPIED to 0 — the \`Platform.OS === "web"\` ` +
            "collapse that made #1834's TA-2 pass while blind. Platform did not switch, so this " +
            '"branch" is the web branch wearing a different name.',
        );
      }
    }

    // The library's `>= 26` boundary must be LIVE, not folded flat.
    //
    // NOTE — DEVIATION FROM SPEC §6.6 TEST A, stated rather than hidden. The
    // spec asked for "three distinct paddingBottom values". Ari's budget has
    // only TWO distinct branches by construction: DONE_BAR_OCCUPIED is 53 on
    // iOS 26+ and 42 on BOTH iOS <26 and Android, so ios-18 and android are
    // necessarily equal. Demanding three distinct values would be demanding a
    // difference that does not exist, which a test can only satisfy by
    // fabricating one. The guard therefore asserts the boundary is live and no
    // branch collapsed to web — the blindness the spec was actually defending
    // against.
    const ios26 = branches.find((b) => b.id === "ios-26");
    const ios18 = branches.find((b) => b.id === "ios-18");
    const android = branches.find((b) => b.id === "android");
    expect(ios26?.paddingBottom).not.toBe(ios18?.paddingBottom);
    expect(ios18?.paddingBottom).toBe(android?.paddingBottom);
    expect(new Set(branches.map((b) => b.doneBarOccupied))).toEqual(new Set([53, 42]));
  });

  // ── 1. the lift is the occluder budget ────────────────────────────────────
  it("1. the keyboard-open lift is keyboardHeight + DONE_BAR_OCCUPIED + 12 on every branch", () => {
    for (const b of branches) {
      expect(b.paddingBottom).toBe(KEYBOARD_HEIGHT + b.doneBarOccupied + 12);
      // The visible gap the contract promises above the bar's TOP edge.
      expect(b.paddingBottom - KEYBOARD_HEIGHT - b.doneBarOccupied).toBe(12);
    }
  });

  // ── 2. the >= 26 boundary, straddled ──────────────────────────────────────
  it("2. the clearance straddles the library's >= 26 boundary at 54 / 65", () => {
    const at = (v: number | string): number => measureBranch(`probe-${v}`, "ios", v).paddingBottom - KEYBOARD_HEIGHT;
    expect(at("25.9")).toBe(54); // 42 bar + 12 clearance
    expect(at("26.0")).toBe(65); // 53 bar + 12 clearance
  });

  // ── 3. THE ANTI-DOUBLE-COUNT ASSERTION ────────────────────────────────────
  //
  // This is the assertion that cannot pass with the bug present. Firing the
  // composer's layout at 52 and at 200 must leave the lift IDENTICAL: the
  // padding positions the pill's bottom edge, so the pill's own height is not
  // an input to it. Under the reverted code the wrapper's onLayout feeds
  // `composerHeight` straight into the sum and the two readings differ by 148.
  //
  // A test that checked only ONE height would pass on the broken code and prove
  // nothing — which is precisely how this defect survived two prior issues.
  it("3. paddingBottom is INVARIANT to the composer's measured height (52 vs 200)", () => {
    for (const b of branches) {
      expect(b.paddingAt52).toBe(b.paddingAt200);
      expect(b.paddingAt200 - b.paddingAt52).toBe(0);
      // …and it still equals the budget, so "invariant" cannot be satisfied by
      // the lift having collapsed to a constant or to NaN.
      expect(b.paddingAt52).toBe(KEYBOARD_HEIGHT + b.doneBarOccupied + 12);
    }
  });

  // ── 4. ANTI-HARDCODE ──────────────────────────────────────────────────────
  //
  // Move the shared budget and the rendered lift must move by the SAME delta.
  // Re-typing 65 (or 54) as a literal in the screen fails here.
  it("4. the lift tracks the shared occluder budget, not a re-typed number", () => {
    let observed: unknown = null;
    jest.isolateModules(() => {
      jest.doMock("../../../wrappers/SmartScrollView", () => ({ DONE_BAR_OCCUPIED: 100 }));
      jest.doMock("../../../wrappers/keyboardClearance", () => ({ MIN_VISIBLE_CLEARANCE: 7 }));
      /* eslint-disable @typescript-eslint/no-require-imports */
      const R = require("react") as typeof React;
      const TR = require("react-test-renderer") as {
        create: (e: unknown) => { root: HostNode; unmount: () => void };
        act: (cb: () => void) => void;
      };
      const { AriChatScreen } = require("../AriChatScreen") as { AriChatScreen: React.ComponentType };
      /* eslint-enable @typescript-eslint/no-require-imports */
      let tree: { root: HostNode; unmount: () => void } | null = null;
      TR.act(() => {
        tree = TR.create(R.createElement(AriChatScreen));
      });
      if (tree == null) throw new Error("[#1890] anti-hardcode mount produced no tree.");
      const wrapper = findComposerWrapper(findByTestId((tree as { root: HostNode }).root, "ari-input-bar"));
      observed = flatten(wrapper.props.style).paddingBottom;
      TR.act(() => {
      TR.act(() => {
        (tree as unknown as { unmount: () => void }).unmount();
      });
    });
    });
    expect(observed).toBe(KEYBOARD_HEIGHT + 100 + 7);
    jest.dontMock("../../../wrappers/SmartScrollView");
    jest.dontMock("../../../wrappers/keyboardClearance");
  });

  // ── 5. the measuring plumbing is gone ─────────────────────────────────────
  it("5. no composer-height measurement survives in the lift's subtree", () => {
    for (const b of branches) {
      expect(b.onLayoutCount).toBe(0);
    }
  });
});
