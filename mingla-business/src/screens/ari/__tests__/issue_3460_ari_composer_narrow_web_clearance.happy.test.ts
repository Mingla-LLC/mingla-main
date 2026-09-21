/**
 * #3460 [narrow-web-nav-overlap] — implementor happy-path render proof.
 *
 * THE DEFECT. On Mingla Business web, `AriChatScreen`'s `inputWrap` gave the
 * composer `spacing.sm` (8pt) of bottom clearance whenever
 * `Platform.OS === "web"`. The stated reason — "the business web nav is a side
 * rail, not a floating BottomNav capsule" — is a WIDTH condition written as a
 * PLATFORM condition. It is true at `WIDE_DESKTOP_MIN_WIDTH` (1024) and above,
 * and false below it, where `BottomNav.web.tsx` renders `MobileWebCapsule`
 * inside `navWrap` (`position:absolute; bottom:0`, painted after `<Slot/>`).
 * That band captures pointers across its full width, because react-native-web
 * 0.21.2 compiles `pointerEvents="box-none"` to a rule whose DIRECT CHILD gets
 * `pointer-events: auto`. With 8pt of clearance the Attach button, the text
 * input and Send all sat INSIDE the band: `document.elementFromPoint` returned
 * a bottom-nav element at 147 of 147 points sampled across the three controls
 * on real mobile Safari at 402x714, and real taps never reached them.
 *
 * WHY THIS SUITE MOUNTS INSTEAD OF GREPPING. The 8pt web branch was pinned as
 * CORRECT by a source-text assertion (ORCH-1101's
 * `Platform.OS === "web" ? spacing.sm`, superseded here under
 * [TEST-MOD-APPROVED #3460]). A source pin is the instrument that blessed the
 * bug, so every number below is read off the MOUNTED tree — the resolved
 * `paddingBottom` on the composer wrapper's host node — never off module text.
 * The one value that IS parsed from source is `CAPSULE_HEIGHT`, and only to
 * derive the height of the band the composer must clear: if someone grows the
 * capsule without growing `BOTTOM_NAV_CLEARANCE_PX`, this suite goes red.
 *
 * NO JSX IN THIS FILE, DELIBERATELY — same constraint as the #1890 suite it
 * shares a config with: the render configs transform through
 * babel-preset-expo, which gates the TypeScript plugin on the file extension,
 * so a `.ts` file compiles with `isTSX: false` and a single `<View/>` literal
 * is a syntax error. Everything uses React.createElement.
 *
 * fails-on-revert: restore the web branch to a bare `spacing.sm` and
 * assertions 1, 3, 4 and 5 go red — the narrow-web composer drops from 96 to 8,
 * i.e. from 16pt ABOVE the 80pt nav band to 72pt INSIDE it.
 */

import React from "react";

// ───────────────────────── driveable environment ────────────────────────────
/**
 * ONE shared state object on `globalThis`, for the same reason #1890 put its
 * platform there: `jest.isolateModules` builds a fresh module registry per
 * mount, and a module-scope object would be re-created inside it, leaving the
 * `react-native` mock factory reading a stale copy. The branch would then
 * never switch and the suite would execute one viewport N times while claiming
 * several.
 */
interface Issue3460State {
  OS: string;
  width: number;
  height: number;
  insetBottom: number;
  sitesIntent: string | undefined;
}
const STATE: Issue3460State = (() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_3460_STATE__ == null) {
    scope.__ISSUE_3460_STATE__ = {
      OS: "web",
      width: 402,
      height: 714,
      insetBottom: 0,
      sitesIntent: undefined,
    };
  }
  return scope.__ISSUE_3460_STATE__ as Issue3460State;
})();

/**
 * `Platform` AND `useWindowDimensions` are overridden LAZILY through a Proxy,
 * never by spreading: `{...actual}` walks every property on react-native's
 * index and several are getters that call `TurboModuleRegistry.getEnforcing`
 * (`DevMenu` throws "could not be found" under jest the instant it is read).
 *
 * `useWindowDimensions` is driven rather than `useResponsiveLayout` mocked, so
 * the REAL `WIDE_DESKTOP_MIN_WIDTH` boundary (1024, inclusive) is the thing
 * under test. Mocking the hook would assert the fix against a stand-in for the
 * very comparison the fix depends on.
 */
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_3460_STATE__ == null) {
    scope.__ISSUE_3460_STATE__ = {
      OS: "web",
      width: 402,
      height: 714,
      insetBottom: 0,
      sitesIntent: undefined,
    };
  }
  const state = scope.__ISSUE_3460_STATE__ as {
    OS: string;
    width: number;
    height: number;
    insetBottom: number;
    sitesIntent: string | undefined;
  };

  const platform = new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (prop === "OS") return state.OS;
        if (prop === "Version") return 26;
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
      if (prop === "useWindowDimensions") {
        return () => ({ width: state.width, height: state.height, scale: 3, fontScale: 1 });
      }
      return (target as Record<string | symbol, unknown>)[prop];
    },
  });
});

// Web has no soft keyboard; the native leg below is measured at REST, which is
// the state the floating capsule exists in. Both are therefore 0.
jest.mock("../../../wrappers/useKeyboardHeight", () => ({
  useKeyboardHeight: () => 0,
}));

// ───────────────────────── environment mocks ────────────────────────────────
// Same boundary set as the #1890 suite this shares a config with. Each one is a
// module AriChatScreen's graph reaches that needs a native bridge or a network.
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
  KeyboardToolbar: "KeyboardToolbar@library",
  KeyboardProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native");
  const passthrough = (c: unknown): unknown => c;
  const identity = (t: number): number => t;
  const shape = (fn?: unknown): unknown => fn ?? identity;
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
    Easing: {
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
    },
  };
});

jest.mock("react-native-safe-area-context", () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  return {
    useSafeAreaInsets: () => {
      const state = scope.__ISSUE_3460_STATE__ as { insetBottom: number };
      return { top: 47, bottom: state.insetBottom, left: 0, right: 0 };
    },
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
  };
});

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
jest.mock("expo-router", () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => "/ari",
    useLocalSearchParams: () => {
      const state = scope.__ISSUE_3460_STATE__ as { sitesIntent: string | undefined };
      return state.sitesIntent == null
        ? {}
        : { sitesIntent: state.sitesIntent, brandId: "brand-3460" };
    },
  };
});

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

jest.mock("../../../components/ui/Toast", () => ({ Toast: () => null }));

// ───────────────────────── app-state mocks ──────────────────────────────────
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-3460" }, isAuthReady: true, loading: false, session: { access_token: "t" } }),
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
    setSurface: jest.fn(),
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
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => null,
}));
jest.mock("../../../components/brand/BrandSwitcherSheet", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return { BrandSwitcherSheet: () => R.createElement(RN.View, { testID: "ari-brand-switcher-stub" }) };
});

/**
 * The composer is stubbed to a locatable host node. It is not under test — the
 * quantity under test is the WRAPPER's resolved paddingBottom — and stubbing it
 * keeps the mount off reanimated's animated TextInput path.
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
    `[#3460] no node with testID="${testID}" in the mounted tree. The composer is the anchor ` +
      "every measurement here hangs off, so failing to find it is a FAILURE, never a skip.",
  );
};

/**
 * Walk UP from the stubbed composer to the nearest host ancestor whose resolved
 * style carries a numeric `paddingBottom`. That is `inputWrap`. Located
 * structurally, not by matching a style value, so the assertion cannot
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
    "[#3460] no ancestor of the composer exposes a numeric paddingBottom. The clearance is what " +
      "this suite measures, so failing to find it is a FAILURE, never a skip.",
  );
};

interface Mount {
  readonly id: string;
  readonly paddingBottom: number;
}

/** Mount AriChatScreen in its own registry under the given viewport. */
function measure(
  id: string,
  opts: { os?: string; width: number; insetBottom?: number; sitesIntent?: string },
): Mount {
  STATE.OS = opts.os ?? "web";
  STATE.width = opts.width;
  STATE.height = 714;
  STATE.insetBottom = opts.insetBottom ?? 0;
  STATE.sitesIntent = opts.sitesIntent;

  let result: Mount | null = null;

  // React, the renderer and the screen must ALL come from the SAME isolated
  // registry: requiring only the component inside `isolateModules` while the
  // renderer closes over the OUTER react gives two React instances, and the
  // fresh one's hook dispatcher is null the moment the screen mounts.
  jest.isolateModules(() => {
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
    if (tree == null) throw new Error(`[#3460] renderer produced no tree for ${id}.`);
    const composer = findByTestId((tree as { root: HostNode }).root, "ari-input-bar");
    const wrapper = findComposerWrapper(composer);
    const pb = flatten(wrapper.props.style).paddingBottom;
    if (typeof pb !== "number" || !Number.isFinite(pb)) {
      throw new Error(
        `[#3460] ${id} produced no finite paddingBottom (got ${String(pb)}). An assertion that ` +
          "cannot read its quantity is a FAILURE, never a skip.",
      );
    }
    result = { id, paddingBottom: pb };
    (tree as { unmount: () => void }).unmount();
  });

  if (result == null) throw new Error(`[#3460] ${id} produced no measurement.`);
  return result;
}

describe("#3460 · the Ari composer clears the narrow-web BottomNav capsule", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { spacing } = require("../../../constants/designSystem") as {
    spacing: Record<string, number>;
  };
  const { WIDE_DESKTOP_MIN_WIDTH } = require("../../../hooks/useResponsiveLayout") as {
    WIDE_DESKTOP_MIN_WIDTH: number;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */

  /**
   * The band the composer has to clear, derived — never a magic 80. navWrap
   * (`app/(tabs)/_layout.tsx`) is `position:absolute; bottom:0` with
   * `paddingTop: spacing.sm` and `paddingBottom: Math.max(insets.bottom,
   * spacing.sm)`; a browser reports no bottom inset, so both are spacing.sm.
   * CAPSULE_HEIGHT is read out of the shipped web nav, so growing the capsule
   * without growing the clearance turns this red instead of silently
   * re-covering the composer.
   */
  const CAPSULE_HEIGHT = ((): number => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../components/ui/BottomNav.web.tsx"),
      "utf8",
    );
    const m = /const CAPSULE_HEIGHT\s*=\s*(\d+)/.exec(src);
    if (m == null) {
      throw new Error(
        "[#3460] CAPSULE_HEIGHT is no longer declared in BottomNav.web.tsx. The nav band height " +
          "is what the composer must clear, so losing it is a FAILURE, never a skip.",
      );
    }
    return Number(m[1]);
  })();
  const NAV_BAND_PX = CAPSULE_HEIGHT + spacing.sm + spacing.sm;

  it("1. at a phone width the composer sits ABOVE the whole nav band", () => {
    const narrow = measure("web-402", { width: 402 });
    // The exact contract: the same resting clearance native reserves.
    expect(narrow.paddingBottom).toBe(spacing.md + NAV_BAND_PX);
    // And the property that actually decides whether taps land: the composer's
    // bottom edge is outside the band that captures them.
    expect(narrow.paddingBottom).toBeGreaterThan(NAV_BAND_PX);
  });

  it("2. at wide desktop the ORCH-1101 phantom-gap fix is untouched", () => {
    const wide = measure("web-1440", { width: 1440 });
    expect(wide.paddingBottom).toBe(spacing.sm);
  });

  it("3. the boundary is WIDE_DESKTOP_MIN_WIDTH and it is INCLUSIVE", () => {
    const atBoundary = measure("web-1024", { width: WIDE_DESKTOP_MIN_WIDTH });
    const justBelow = measure("web-1023", { width: WIDE_DESKTOP_MIN_WIDTH - 1 });
    // 1024 is the rail; 1023 is still the capsule.
    expect(atBoundary.paddingBottom).toBe(spacing.sm);
    expect(justBelow.paddingBottom).toBe(spacing.md + NAV_BAND_PX);
    expect(justBelow.paddingBottom).toBeGreaterThan(atBoundary.paddingBottom);
  });

  it("4. Website → Edit with Ari gets the same clearance as the Ari tab", () => {
    // `/(tabs)/ari?sitesIntent=edit&brandId=…` is the SAME route and the same
    // screen; below 1024 it does not split, so a divergence here would mean a
    // second code path had appeared.
    const tab = measure("web-402-tab", { width: 402 });
    const website = measure("web-402-website", { width: 402, sitesIntent: "edit" });
    expect(website.paddingBottom).toBe(tab.paddingBottom);
    expect(website.paddingBottom).toBeGreaterThan(NAV_BAND_PX);
  });

  it("5. narrow web now reserves what native reserves at rest (parity)", () => {
    // Same inset on both legs, so any difference is the branch, not the device.
    const web = measure("web-402-inset34", { width: 402, insetBottom: 34 });
    const native = measure("ios-402-inset34", { os: "ios", width: 402, insetBottom: 34 });
    expect(web.paddingBottom).toBe(native.paddingBottom);
    expect(native.paddingBottom).toBe(34 + NAV_BAND_PX);
  });

  it("6. native is untouched by the web branch (no regression on iOS/Android)", () => {
    const ios = measure("ios-402", { os: "ios", width: 402, insetBottom: 34 });
    const android = measure("android-402", { os: "android", width: 402, insetBottom: 24 });
    expect(ios.paddingBottom).toBe(34 + NAV_BAND_PX);
    // 24 > spacing.md, so the Android inset itself is the floor term.
    expect(android.paddingBottom).toBe(24 + NAV_BAND_PX);
  });
});
