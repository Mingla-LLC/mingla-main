/**
 * #1890 C-5 REWORK [keyboard-clearance-overshoot] — implementor happy-path
 * render proof for the group-chat composer.
 *
 * THE DEFECT, AND WHY IT IS THE SAME ONE. `GroupChatPanel`'s composer sits
 * inside a `KeyboardAvoidingView`, so `keyboardVerticalOffset` ALREADY positions
 * the composer container's bottom edge against the Done bar. The composer then
 * kept its RESTING bottom spacer — `Math.max(insets.bottom, 0) + spacing.lg`,
 * the room it needs to clear the navigation bar / home indicator while it is
 * sitting on the screen's bottom edge — and that spacer pushed the reply field
 * up a SECOND time. MEASURED on the physical Samsung R58R54YV7JT: insets.bottom
 * is 48 and spacing.lg is 24, so 72.00dp of resting spacer survived the lift,
 * against a 12dp contract. The tester read 71.47dp of gap with the offset at
 * DONE_BAR_OCCUPIED and 83.56dp after C-5's first attempt raised the offset by
 * MIN_VISIBLE_CLEARANCE. Raising the lift could only make it worse: the lift was
 * never the short term.
 *
 * That is Ari's double count — a bottom spacer already accounted for by the
 * mechanism positioning the bottom edge, counted again — in a different file,
 * expressed through a DIFFERENT PROPERTY on a DIFFERENT NODE. Which is exactly
 * why nothing caught it: i-1047 rule (E) reads Ari's lift expression, and
 * `issue_1890_ari_composer_clearance.happy.test.ts` reads Ari's `paddingBottom`.
 * Neither can see this file at all. It is #1890 TEST's evasion E4 occurring for
 * real, in production, rather than as a seeded fixture.
 *
 * WHY THIS SUITE MOUNTS INSTEAD OF GREPPING. F-8 diagnosed this screen as a
 * 23pt UNDERSHOOT by reading the offset alone and assuming the reply field sat
 * on the container's bottom edge. It does not. A source-text reading of the
 * offset is the instrument that got the sign wrong, so every number here is read
 * off the MOUNTED tree: the `keyboardVerticalOffset` the panel actually passes,
 * and the `paddingBottom` actually resolved onto the composer row's host node.
 *
 * THE LOAD-BEARING ASSERTION is 3: with the keyboard OPEN, the composer's bottom
 * spacer must be IDENTICAL at `insets.bottom` of 0, 48 and 200. Under the code
 * this reworks it tracks the inset one-for-one and the three readings are 24, 72
 * and 224. A test that checked a single inset would pass on the broken code —
 * which is how a 59.47dp overshoot shipped past a green gate twice.
 *
 * NO JSX IN THIS FILE, DELIBERATELY. The render configs transform through
 * babel-preset-expo, which gates the TypeScript plugin on the file extension:
 * `.ts` compiles with `isTSX: false`, so a single `<View/>` literal — even
 * inside a jest.mock factory — is a syntax error. Everything uses
 * React.createElement.
 *
 * fails-on-revert: restore `keyboardVerticalOffset={DONE_BAR_OCCUPIED +
 * MIN_VISIBLE_CLEARANCE}` and `paddingBottom: Math.max(insets.bottom, 0) +
 * spacing.lg` and assertions 1, 2 and 3 go red together.
 */

import React from "react";

// ───────────────────────── platform, driveable ──────────────────────────────
/**
 * One shared state object on `globalThis`, so BOTH this module's initialiser and
 * the `react-native` mock factory find the SAME reference across every
 * `jest.isolateModules` registry. #1834 hit the re-invocation trap where a
 * module-scope object was re-created per registry and the mock kept reading a
 * stale copy — the branch then never switched and the suite executed one
 * platform N times while claiming three.
 */
interface Driven {
  OS: string;
  Version: number | string;
  keyboardHeight: number;
  insetBottom: number;
}
const DRIVEN: Driven = (() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1890_C5__ == null) {
    scope.__ISSUE_1890_C5__ = { OS: "ios", Version: 26, keyboardHeight: 336, insetBottom: 48 };
  }
  return scope.__ISSUE_1890_C5__ as Driven;
})();

/**
 * Overridden LAZILY, through a Proxy, never by spreading. `{...actual}` walks
 * every property on react-native's index and several are getters that call
 * `TurboModuleRegistry.getEnforcing` — `DevMenu` throws the instant it is read.
 */
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1890_C5__ == null) {
    scope.__ISSUE_1890_C5__ = { OS: "ios", Version: 26, keyboardHeight: 336, insetBottom: 48 };
  }
  const state = scope.__ISSUE_1890_C5__ as { OS: string; Version: number | string };

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

// ───────────────────────── keyboard + insets, driveable ─────────────────────
jest.mock("../../../wrappers/useKeyboardHeight", () => ({
  useKeyboardHeight: () =>
    (globalThis as unknown as Record<string, Driven>).__ISSUE_1890_C5__.keyboardHeight,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({
    top: 47,
    bottom: (globalThis as unknown as Record<string, Driven>).__ISSUE_1890_C5__.insetBottom,
    left: 0,
    right: 0,
  }),
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

/**
 * The KeyboardAvoidingView is replaced by a locatable host node that FORWARDS
 * `keyboardVerticalOffset` as a readable prop.
 *
 * This is deliberate and it is not a reimplementation of the thing under test.
 * The quantity under test is the value the PANEL computes and passes — the real
 * library component consumes that prop into a Reanimated worklet that never runs
 * off the UI thread under jest, so forwarding it is the only way to observe it
 * at all. What the library does with the number is the library's contract
 * (`paddingBottom = frameBottom - (screenHeight - keyboardHeight - offset)`),
 * verified on glass on R58R54YV7JT rather than here.
 */
jest.mock("../../../wrappers/SmartKeyboardAvoidingView", () => {
  const RN = jest.requireActual("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    KeyboardAvoidingView: (props: Record<string, unknown>) =>
      R.createElement(
        RN.View,
        { testID: "gc-kav", keyboardVerticalOffset: props.keyboardVerticalOffset },
        props.children as React.ReactNode,
      ),
  };
});

// ───────────────────────── environment mocks ────────────────────────────────
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
  KeyboardToolbar: "KeyboardToolbar@library",
  KeyboardProvider: ({ children }: { children?: React.ReactNode }) => children,
  useKeyboardState: () => ({ isVisible: false }),
  useGenericKeyboardHandler: () => undefined,
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
    useDerivedValue: (f: () => unknown) => ({ value: f() }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    runOnJS: (f: unknown) => f,
    runOnUI: (f: unknown) => f,
    cancelAnimation: () => undefined,
    useReducedMotion: () => true,
    interpolate: () => 0,
    Easing: { bezier: () => (t: number) => t, out: (f: unknown) => f, inOut: (f: unknown) => f, ease: (t: number) => t },
  };
});

jest.mock("react-native-svg", () => {
  const { View: V } = jest.requireActual("react-native");
  return { __esModule: true, default: V, Svg: V, Circle: V, Path: V, Rect: V, G: V, Defs: V, Stop: V, Ellipse: V };
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

jest.mock("../../../services/supabase", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "u-1890" } } }) } },
}));

jest.mock("../../../utils/platformImagePicker", () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));

// The moderation sheet pulls the Modal/Sheet stack and is not under test.
jest.mock("../GroupChatModerationSheet", () => ({ GroupChatModerationSheet: () => null }));

jest.mock("../../../hooks/useEventGroupChat", () => ({
  useEventGroupChat: () => ({
    conversation: { id: "c-1890", event_name: "FIFA Grill Night", is_broadcast_only: false },
    messages: [],
    loading: false,
    error: null,
    postMessage: jest.fn(async () => ({ error: null })),
    refresh: jest.fn(async () => undefined),
  }),
}));

jest.mock("../../../hooks/useEventGroupChatModeration", () => ({
  useEventGroupChatModeration: () => ({
    participants: [],
    loading: false,
    setBroadcastOnly: jest.fn(async () => ({ error: null })),
    removeParticipant: jest.fn(async () => ({ error: null })),
    deleteMessage: jest.fn(async () => ({ error: null })),
  }),
}));

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

const findWhere = (root: HostNode, pred: (n: HostNode) => boolean, what: string): HostNode => {
  const stack: HostNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as HostNode;
    if (node != null && typeof node === "object" && node.props != null && pred(node)) return node;
    for (const child of node?.children ?? []) {
      if (child && typeof child === "object") stack.push(child as HostNode);
    }
  }
  throw new Error(
    `[#1890 C-5] could not locate ${what} in the mounted tree. Every number in this suite hangs ` +
      "off that node, so failing to find it is a FAILURE, never a skip.",
  );
};

/**
 * The composer row: walk UP from the reply TextInput to the nearest host
 * ancestor carrying a numeric `paddingBottom`. Located structurally rather than
 * by a style-value match, so the assertion cannot accidentally read some other
 * padded container — and the caller then proves it really is the composer row by
 * checking `flexDirection: "row"`, which `SafeScreen`'s host (the only other
 * ancestor with a numeric paddingBottom, always 0) does not carry.
 */
const findComposerRow = (input: HostNode): HostNode => {
  let node: HostNode | null = input;
  while (node != null) {
    const pb = flatten(node.props.style).paddingBottom;
    if (typeof pb === "number") return node;
    node = node.parent;
  }
  throw new Error(
    "[#1890 C-5] no ancestor of the reply field exposes a numeric paddingBottom. That spacer is " +
      "the quantity under test, so failing to find it is a FAILURE, never a skip.",
  );
};

interface Reading {
  readonly id: string;
  readonly os: string;
  readonly version: number | string;
  readonly keyboardHeight: number;
  readonly insetBottom: number;
  readonly doneBarOccupied: number;
  readonly minVisibleClearance: number;
  readonly offset: number;
  readonly paddingBottom: number;
  readonly composerStyle: Record<string, unknown>;
}

/**
 * Mount the REAL GroupChatPanel in its own module registry under a chosen
 * platform / keyboard state / safe-area inset, and report what the mounted tree
 * actually carries.
 */
function measure(id: string, os: string, version: number | string, keyboardHeight: number, insetBottom: number): Reading {
  DRIVEN.OS = os;
  DRIVEN.Version = version;
  DRIVEN.keyboardHeight = keyboardHeight;
  DRIVEN.insetBottom = insetBottom;

  let result: Reading | null = null;

  // React, the renderer, the shared budget and the panel must ALL come from the
  // SAME isolated registry. Requiring only the component inside
  // `isolateModules` while the renderer closes over the OUTER react gives two
  // React instances, and the fresh one's hook dispatcher is null.
  //
  // `react-test-renderer` rather than @testing-library/react-native: RTL
  // registers beforeAll/afterAll at MODULE SCOPE, so re-requiring it per branch
  // throws "Cannot add a hook after tests have started running".
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const R = require("react") as typeof React;
    const TR = require("react-test-renderer") as {
      create: (e: unknown) => { root: HostNode; unmount: () => void };
      act: (cb: () => void) => void;
    };
    const budget = require("../../../wrappers/keyboardClearance.native") as {
      DONE_BAR_OCCUPIED: number;
      MIN_VISIBLE_CLEARANCE: number;
    };
    const { GroupChatPanel } = require("../GroupChatPanel") as {
      GroupChatPanel: React.ComponentType<{ eventId: string }>;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */

    let tree: { root: HostNode; unmount: () => void } | null = null;
    TR.act(() => {
      tree = TR.create(R.createElement(GroupChatPanel, { eventId: "e-1890" }));
    });
    if (tree == null) throw new Error(`[#1890 C-5] renderer produced no tree under ${os}/${version}.`);
    const root = (tree as { root: HostNode }).root;

    const kav = findWhere(root, (n) => n.props.testID === "gc-kav", 'the composer\'s KeyboardAvoidingView (testID "gc-kav")');
    const input = findWhere(root, (n) => n.props.placeholder === "Write a reply", 'the reply TextInput (placeholder "Write a reply")');
    const row = findComposerRow(input);
    const style = flatten(row.props.style);

    result = {
      id,
      os,
      version,
      keyboardHeight,
      insetBottom,
      doneBarOccupied: budget.DONE_BAR_OCCUPIED,
      minVisibleClearance: budget.MIN_VISIBLE_CLEARANCE,
      offset: kav.props.keyboardVerticalOffset as number,
      paddingBottom: style.paddingBottom as number,
      composerStyle: style,
    };

    TR.act(() => {
      (tree as unknown as { unmount: () => void }).unmount();
    });
  });

  if (result == null) throw new Error(`[#1890 C-5] GroupChatPanel failed to mount under ${os}/${version}.`);
  return result;
}

const KB = 336;
const RESTING_TOKEN = 24; // spacing.lg — the composer's own breathing room at rest.

// ───────────────────────── the suite ────────────────────────────────────────
describe("#1890 C-5 — group-chat composer keyboard clearance", () => {
  const open: Reading[] = [];

  beforeAll(() => {
    open.push(measure("ios-26", "ios", 26, KB, 48));
    open.push(measure("ios-18", "ios", 18, KB, 48));
    open.push(measure("android", "android", 34, KB, 48));
  });

  // ── 0. VACUITY GUARD — throws, never skips ────────────────────────────────
  it("0. VACUITY GUARD — three branches really loaded, none collapsed to web, and the node found is the composer row", () => {
    if (open.length !== 3) throw new Error(`[#1890 C-5] expected 3 branches, measured ${open.length}.`);
    for (const b of open) {
      if (!Number.isFinite(b.paddingBottom) || !Number.isFinite(b.offset)) {
        throw new Error(
          `[#1890 C-5] branch ${b.id} produced offset=${b.offset} paddingBottom=${b.paddingBottom}. An ` +
            "assertion that cannot see the quantity it claims to test is a FAILURE, never a pass.",
        );
      }
      if (b.doneBarOccupied === 0) {
        throw new Error(
          `[#1890 C-5] branch ${b.id} resolved DONE_BAR_OCCUPIED to 0 — the \`Platform.OS === "web"\` ` +
            "collapse that made #1834's TA-2 pass while blind. Platform did not switch, so this " +
            '"branch" is the web branch wearing a different name.',
        );
      }
      // The located node must be the composer ROW, not SafeScreen's host (whose
      // paddingBottom is a numeric 0 and would satisfy a naive search).
      if (b.composerStyle.flexDirection !== "row") {
        throw new Error(
          `[#1890 C-5] branch ${b.id} located a node with flexDirection=${String(b.composerStyle.flexDirection)}. ` +
            "The composer row is the only node whose paddingBottom stands between the controls and " +
            "the container's bottom edge; reading any other node measures nothing.",
        );
      }
    }
    // The library's `>= 26` boundary must be LIVE, not folded flat. As in TEST A,
    // there are only TWO distinct budgets by construction — DONE_BAR_OCCUPIED is
    // 53 on iOS 26+ and 42 on both iOS <26 and Android — so demanding three
    // distinct values could only be satisfied by fabricating one.
    const ios26 = open.find((b) => b.id === "ios-26");
    const ios18 = open.find((b) => b.id === "ios-18");
    const android = open.find((b) => b.id === "android");
    expect(ios26?.offset).not.toBe(ios18?.offset);
    expect(ios18?.offset).toBe(android?.offset);
    expect(new Set(open.map((b) => b.doneBarOccupied))).toEqual(new Set([53, 42]));
  });

  // ── 1. the total clearance is the occluder budget, split across two nodes ──
  it("1. offset + composer spacer == DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE on every branch", () => {
    for (const b of open) {
      // Read off the mounted tree, compared against the SAME module's executed
      // constants — so re-typing 65 or 54 as a literal fails on the other branch.
      expect(b.offset + b.paddingBottom).toBe(b.doneBarOccupied + b.minVisibleClearance);
      // The offset budgets the occluder and ONLY the occluder…
      expect(b.offset).toBe(b.doneBarOccupied);
      // …and the composer's own spacer is the promised visible gap, nothing else.
      expect(b.paddingBottom).toBe(b.minVisibleClearance);
    }
  });

  // ── 2. the >= 26 boundary, straddled ──────────────────────────────────────
  it("2. the total clearance straddles the library's >= 26 boundary at 54 / 65", () => {
    const total = (v: number | string): number => {
      const r = measure(`probe-${v}`, "ios", v, KB, 48);
      return r.offset + r.paddingBottom;
    };
    expect(total("25.9")).toBe(54); // 42 bar + 12 clearance
    expect(total("26.0")).toBe(65); // 53 bar + 12 clearance
  });

  // ── 3. THE ANTI-DOUBLE-COUNT ASSERTION ────────────────────────────────────
  //
  // This is the assertion that cannot pass with the defect present. While the
  // composer is LIFTED, its bottom spacer must be identical at every safe-area
  // inset: the KeyboardAvoidingView has already put the container's bottom edge
  // on the Done bar, so the screen edge the inset describes is not under the
  // composer any more and cannot be an input to its spacing.
  //
  // Under the reworked code the three readings are 24 / 72 / 224 — the spacer
  // tracking the inset one-for-one, which is the double count stated as numbers.
  // MEASURED on R58R54YV7JT at insets.bottom = 48: 83.56dp of gap against a 12dp
  // contract, 11.73dp after.
  it("3. the composer's bottom spacer is INVARIANT to insets.bottom while lifted (0 vs 48 vs 200)", () => {
    for (const os of ["ios", "android"] as const) {
      const version = os === "ios" ? 26 : 34;
      const at0 = measure(`${os}-i0`, os, version, KB, 0);
      const at48 = measure(`${os}-i48`, os, version, KB, 48);
      const at200 = measure(`${os}-i200`, os, version, KB, 200);

      expect(at0.paddingBottom).toBe(at48.paddingBottom);
      expect(at48.paddingBottom).toBe(at200.paddingBottom);
      expect(at200.paddingBottom - at0.paddingBottom).toBe(0);

      // …and the total lift is invariant too, so "invariant" cannot be satisfied
      // by the spacer collapsing while the offset absorbs the inset instead.
      expect(at0.offset + at0.paddingBottom).toBe(at200.offset + at200.paddingBottom);
      // …and it still equals the budget, so it cannot be satisfied by NaN either.
      expect(at48.paddingBottom).toBe(at48.minVisibleClearance);
    }
  });

  // ── 4. the resting layout is untouched ────────────────────────────────────
  //
  // The inset is not wrong — it is wrong WHILE LIFTED. With the keyboard closed
  // the composer is back on the screen's bottom edge and must still clear the
  // navigation bar / home indicator. MEASURED on R58R54YV7JT: the reply field's
  // bottom sits at 781.87dp with the keyboard closed, identical before and after
  // this rework, with the nav bar's top at 805.33dp (23.47dp of visible gap ≈
  // spacing.lg) and 48dp of nav bar below it.
  it("4. with the keyboard CLOSED the spacer is still insets.bottom + spacing.lg", () => {
    for (const inset of [0, 34, 48, 200]) {
      const r = measure(`closed-${inset}`, "android", 34, 0, inset);
      expect(r.paddingBottom).toBe(inset + RESTING_TOKEN);
      // The KeyboardAvoidingView adds nothing at rest either way; the offset is
      // the occluder budget whether or not the keyboard is up.
      expect(r.offset).toBe(r.doneBarOccupied);
    }
  });

  // ── 5. SOLE BOTTOM SPACER — closes evasion E4 for this file ───────────────
  //
  // #1890 TEST proved the double count can be re-introduced through a sibling
  // spacing property that neither the gate nor a paddingBottom-reading render
  // proof can see. This assertion reads the composer row's RESOLVED style off
  // the mounted tree and requires `paddingBottom` to be the only bottom spacer
  // on it — which is also the reason this rework is not itself expressible in
  // that shape.
  it("5. the composer row declares exactly ONE bottom spacer", () => {
    const smuggle = ["marginBottom", "paddingVertical", "marginVertical", "bottom", "transform"];
    for (const b of open) {
      const present = smuggle.filter((k) => b.composerStyle[k] !== undefined);
      expect(present).toEqual([]);
      expect(typeof b.composerStyle.paddingBottom).toBe("number");
    }
  });
});
