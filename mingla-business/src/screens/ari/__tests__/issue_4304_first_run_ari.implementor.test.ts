/**
 * #4304 part 3 — First Home with Ari: implementor render proof.
 *
 * Mounts the REAL AriChatScreen (react-test-renderer, RN preset, the #1890
 * harness config) under the first-run stage the (tabs) layout provides, and
 * reads the mounted tree:
 *   1. State A (no brand): the app-written greeting with the host's first
 *      name and all six chips; the generic hero is not drawn; the Home top bar
 *      is on Ari with no "+ Create".
 *   2. A chip is sent as the host's own words WITH the first-run context, and
 *      a kind ("I host events") is remembered for State B.
 *   3. State B (brand, nothing made): the brand greeting, the remembered kind
 *      promoted to the primary chip, "+ Create" on the top bar, and a chip sent
 *      with the empty_brand context.
 *   4. Pending (every other host): exactly today's screen.
 *
 * NO JSX (babel-preset-expo compiles .ts with isTSX false): React.createElement.
 *
 * Run: npx jest --config jest.issue1890.render.cjs --runInBand issue_4304
 * fails-on-revert: delete the `noMessages && firstRunCopy !== null` branch in
 * AriChatScreen (or the `{ firstRun: hint }` argument) and 1-3 go red.
 */

import React from "react";

type Scope = Record<string, unknown>;
const scope = globalThis as unknown as Scope;
scope.__ISSUE_4304__ = scope.__ISSUE_4304__ ?? {
  brand: null as null | { id: string; displayName: string },
  sendMessage: null as null | jest.Mock,
};
const STATE = scope.__ISSUE_4304__ as {
  brand: null | { id: string; displayName: string };
  sendMessage: jest.Mock | null;
  setConversationId: jest.Mock;
  conversations?: unknown[];
};

jest.mock("../../../wrappers/useKeyboardHeight", () => ({
  useKeyboardHeight: () => 0,
}));
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
    },
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
  usePathname: () => "/ari",
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
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
jest.mock("../../../components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../components/ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
// The real TopBar mounts the notifications graph; the bar's CONTENTS are not
// under test here, only that Ari shows it and what it is handed.
jest.mock("../../../components/ui/TopBar", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    TopBar: (props: { extraRightSlot?: React.ReactNode; leftKind: string }) =>
      R.createElement(
        RN.View,
        { testID: `topbar-stub-${props.leftKind}` },
        props.extraRightSlot ?? null,
      ),
  };
});
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-4304" }, isAuthReady: true, loading: false, session: { access_token: "t" } }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrands: () => {
    const s = (globalThis as unknown as Scope).__ISSUE_4304__ as typeof STATE;
    return { data: s.brand ? [s.brand] : [], isLoading: false, isError: false, refetch: jest.fn() };
  },
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
  useConversationList: () => ({
    conversations: ((globalThis as unknown as Scope).__ISSUE_4304__ as { conversations?: unknown[] }).conversations ?? [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
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
  useAgentChat: () => {
    const s = (globalThis as unknown as Scope).__ISSUE_4304__ as typeof STATE;
    return {
      messages: [],
      isLoadingMessages: false,
      sendMessage: s.sendMessage,
      isSending: false,
      pendingAction: null,
      clearPendingAction: jest.fn(),
      conversationId: null,
      setConversationId: s.setConversationId,
      brandId: null,
      errorMessage: null,
      clearErrorMessage: jest.fn(),
      setSurface: jest.fn(),
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
      resumeFlow: jest.fn(async () => undefined),
      applyFlowState: jest.fn(),
      flowState: null,
      errorCode: null,
    };
  },
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ((globalThis as unknown as Scope).__ISSUE_4304__ as typeof STATE).brand,
}));
jest.mock("../../../components/brand/BrandSwitcherSheet", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return { BrandSwitcherSheet: () => R.createElement(RN.View, { testID: "ari-brand-switcher-stub" }) };
});
jest.mock("../../../components/ari/InputBar", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    InputBar: (props: { placeholder?: string }) =>
      R.createElement(RN.View, { testID: "ari-input-bar", accessibilityLabel: props.placeholder }),
  };
});

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  parent: HostNode | null;
  children: unknown[];
};

const all = (root: HostNode): HostNode[] => {
  const out: HostNode[] = [];
  const stack: HostNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as HostNode;
    out.push(node);
    for (const child of node?.children ?? []) {
      if (child && typeof child === "object") stack.push(child as HostNode);
    }
  }
  return out;
};
const byTestId = (root: HostNode, id: string): HostNode | undefined =>
  all(root).find((node) => node.props?.testID === id);
const pressOf = (root: HostNode, id: string): (() => void) => {
  const node = all(root).find(
    (n) => n.props?.testID === id && typeof n.props?.onPress === "function",
  );
  if (!node) throw new Error(`[#4304] no pressable with testID="${id}"`);
  return node.props.onPress as () => void;
};
const textOf = (root: HostNode): string =>
  all(root)
    .flatMap((node) => node.children.filter((c) => typeof c === "string"))
    .join(" | ");

/* eslint-disable @typescript-eslint/no-require-imports */
const R = require("react") as typeof React;
const TR = require("react-test-renderer") as {
  create: (e: unknown) => { root: HostNode; unmount: () => void };
  act: (cb: () => void | Promise<void>) => Promise<void>;
};
const { AriChatScreen } = require("../AriChatScreen") as { AriChatScreen: React.ComponentType };
const { FirstRunStageContext } = require("../../../context/FirstRunStageContext") as {
  FirstRunStageContext: React.Context<unknown>;
};
const { useFirstRunStore } = require("../../../store/firstRunStore") as {
  useFirstRunStore: {
    getState: () => {
      intents: Record<string, { intent: string | null; text: string | null }>;
      rememberIntent: (u: string, v: { intent: string | null; text: string | null }) => void;
      reset: () => void;
    };
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

async function mount(stage: string): Promise<{ root: HostNode; unmount: () => void }> {
  let tree: { root: HostNode; unmount: () => void } | null = null;
  await TR.act(async () => {
    tree = TR.create(
      R.createElement(
        FirstRunStageContext.Provider,
        { value: { stage, userId: "user-4304", displayName: "Tobi Adeyemi" } },
        R.createElement(AriChatScreen),
      ),
    );
  });
  // Lazy top bar + persisted stores settle over a few ticks.
  for (let i = 0; i < 5; i += 1) {
    await TR.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (tree === null) throw new Error("[#4304] renderer produced no tree");
  return tree;
}

beforeEach(() => {
  STATE.setConversationId = jest.fn();
  STATE.conversations = [];
  STATE.brand = null;
  STATE.sendMessage = jest.fn(async () => ({ kind: "text", text: "ok" }));
  useFirstRunStore.getState().reset();
});

describe("#4304 First Home with Ari — Ari screen by stage", () => {
  it("State A: greets by first name, shows all six chips, hides the generic hero, keeps the top bar", async () => {
    const tree = await mount("no_brand");
    const text = textOf(tree.root);
    expect(text).toContain("Hi Tobi. Let's get your business on Mingla.");
    expect(text).toContain("First we set up your brand: name, logo and where you host.");
    for (const id of ["brand", "events", "experiences", "trips", "venue", "about"]) {
      expect(byTestId(tree.root, `ari-first-run-chip-${id}`)).toBeDefined();
    }
    expect(text).not.toContain("What should we tackle?");
    expect(byTestId(tree.root, "topbar-stub-brand")).toBeDefined();
    expect(byTestId(tree.root, "ari-first-run-create")).toBeUndefined();
    expect(byTestId(tree.root, "ari-input-bar")?.props.accessibilityLabel).toBe(
      "Tell Ari about your business…",
    );
    tree.unmount();
  });

  it("State A: a chip is sent as the host's words with the no_brand context, and the kind is remembered", async () => {
    const tree = await mount("no_brand");
    const press = pressOf(tree.root, "ari-first-run-chip-events");
    await TR.act(async () => {
      press();
    });
    expect(STATE.sendMessage).toHaveBeenCalledWith("I host events", [], {
      firstRun: { stage: "no_brand", intent: "events" },
    });
    expect(useFirstRunStore.getState().intents["user-4304"]).toEqual({
      intent: "events",
      text: null,
    });
    tree.unmount();
  });

  it("State B: names the brand, promotes the remembered kind, offers + Create, sends with empty_brand context", async () => {
    STATE.brand = { id: "brand-4304", displayName: "Wythe Hospitality" };
    useFirstRunStore.getState().rememberIntent("user-4304", { intent: "trips", text: null });
    const tree = await mount("empty_brand");
    const text = textOf(tree.root);
    expect(text).toContain("Wythe Hospitality is set up. What are you hosting first?");
    for (const id of ["events", "rsvp", "experiences", "trips", "venue"]) {
      expect(byTestId(tree.root, `ari-first-run-chip-${id}`)).toBeDefined();
    }
    expect(byTestId(tree.root, "ari-first-run-create")).toBeDefined();
    const press = pressOf(tree.root, "ari-first-run-chip-rsvp");
    await TR.act(async () => {
      press();
    });
    expect(STATE.sendMessage).toHaveBeenCalledWith("A free RSVP", [], {
      firstRun: { stage: "empty_brand", intent: "rsvp" },
    });
    // The remembered kind is spent by State B's first message.
    expect(useFirstRunStore.getState().intents["user-4304"]).toBeUndefined();
    tree.unmount();
  });

  it("pending (every other host): today's hero, no greeting, no first-run top bar", async () => {
    const tree = await mount("pending");
    const text = textOf(tree.root);
    expect(text).toContain("What should we tackle?");
    expect(byTestId(tree.root, "ari-first-run-greeting")).toBeUndefined();
    expect(byTestId(tree.root, "ari-first-run-topbar")).toBeUndefined();
    tree.unmount();
  });

  it("State B on a phone keeps the composer at the bottom (spacer after the greeting overlay)", async () => {
    // Smoke test 2026-11-07, 375px web: without the spacer the composer rose
    // under the top bar and the greeting floated below it.
    STATE.brand = { id: "brand-4304", displayName: "Wythe Hospitality" };
    const tree = await mount("empty_brand");
    expect(byTestId(tree.root, "ari-first-run-spacer")).toBeDefined();
    tree.unmount();
  });

  it("text from Home's Ask Ari opens a NEW conversation instead of the last one", async () => {
    // Smoke test 2026-11-07: typing on Home landed in the old WYTHE20 thread.
    const { useAriSeedStore } = require("../../../store/ariSeedStore") as {
      useAriSeedStore: { getState: () => { setSeed: (t: string | null) => void; seed: string | null } };
    };
    STATE.brand = { id: "brand-4304", displayName: "Wythe Hospitality" };
    // The host's last thread with this brand — Ari would normally reopen it.
    STATE.conversations = [{ id: "conv-old-wythe20", brand_id: "brand-4304", title: "WYTHE20", updated_at: "2026-11-06T17:19:00Z" }];
    useAriSeedStore.getState().setSeed("Make a 10% code for Wythe Weekender");
    const tree = await mount("pending");
    expect(STATE.setConversationId).toHaveBeenCalledWith("conv-old-wythe20");
    expect(STATE.setConversationId).toHaveBeenLastCalledWith(null);
    expect(useAriSeedStore.getState().seed).toBeNull();
    tree.unmount();
  });

  it("Home's Ask Ari field wears the same animated Ari orb as the Ari screen", async () => {
    const { HomeAskAri } = require("../../../components/home/HomeAskAri") as {
      HomeAskAri: React.ComponentType<{ onAskAri: (t: string) => void }>;
    };
    const { AriOrb } = require("../../../components/ari/AriOrb") as { AriOrb: unknown };
    let tree: { root: HostNode & { findAllByType?: unknown }; unmount: () => void } | null = null;
    await TR.act(async () => {
      tree = TR.create(R.createElement(HomeAskAri, { onAskAri: jest.fn() })) as never;
    });
    for (let i = 0; i < 5; i += 1) {
      await TR.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const orbHost = byTestId(tree!.root, "home-ask-ari-orb");
    expect(orbHost).toBeDefined();
    expect(all(tree!.root).some((node) => node.type === AriOrb)).toBe(true);
    tree!.unmount();
  });
});
