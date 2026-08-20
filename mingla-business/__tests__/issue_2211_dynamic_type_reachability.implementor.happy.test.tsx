/**
 * #2211 [a business user cannot accept a team invitation at the largest text size]
 * Implementor happy-path regression suite.
 *
 * ─── WHAT THIS EXISTS TO STOP COMING BACK ──────────────────────────────────
 * At the largest Dynamic Type setting `accept-brand-invitation` and
 * `accept-scanner-invitation` measured their heading at y = -77 and y = -103 —
 * clipped off the TOP of the screen — ran their body copy past the bottom, and
 * dropped their only Button out of the accessibility tree entirely. Swiping
 * changed nothing, because `styles.host` was `flex: 1` +
 * `justifyContent: "center"` and there was no scroll container anywhere in the
 * render path. An invited teammate on accessibility text sizes could not accept
 * a team invitation by any means.
 *
 * ─── WHY THESE ASSERTIONS ARE SHAPED THE WAY THEY ARE ──────────────────────
 * Every assertion below reads the REAL rendered element tree — the component is
 * rendered and its output walked — never the source text of the file. A
 * source-text gate would pass on a file that imports the shell and never uses
 * it, and #2180 already cost this repo two wrong diagnoses that source reading
 * produced and runtime refuted.
 *
 * ─── THE #2180 LESSON, APPLIED ─────────────────────────────────────────────
 * #2180's brand-image guard was UNFALSIFIABLE for days because the jest
 * react-native mock reports a single fixed `fontScale` (2), so only one branch
 * of a conditional style ever rendered and deleting the thing under test could
 * not fail the suite. Every font-scale assertion here therefore drives React
 * Native's WHOLE iOS multiplier table through `withFontScale`, and
 * `describes the whole table` below FAILS if that table is ever narrowed to a
 * range that stops exercising both sides of the cap. A gate that cannot fail on
 * the regression it exists to prevent is worse than no gate, because its green
 * is read as proof.
 */

import React from "react";
/**
 * `react-test-renderer` ships no types in this workspace and adding
 * `@types/react-test-renderer` for one suite would change the dependency graph
 * of the required jest gate. The surface actually used is four members wide, so
 * it is declared locally instead. Nothing about the assertions is loosened —
 * `TestNode` is the real instance shape, just spelled out here.
 */
interface TestNode {
  type: string | React.ComponentType<unknown>;
  props: Record<string, unknown>;
  findAll(
    predicate: (node: TestNode) => boolean,
    options?: { deep?: boolean },
  ): TestNode[];
  find(predicate: (node: TestNode) => boolean): TestNode;
}
const renderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { root: TestNode; unmount(): void };
  act(cb: () => void): void;
};

/**
 * React 19's test renderer refuses `.root` on a tree that was never flushed
 * inside `act`, so every render in this file goes through here. Returning the
 * root (not the instance) keeps the call sites reading as "render, then walk".
 */
function renderTree(element: React.ReactElement): TestNode {
  let tree: { root: TestNode } | null = null;
  renderer.act(() => {
    tree = renderer.create(element);
  });
  if (tree === null) throw new Error("render produced no tree");
  return (tree as { root: TestNode }).root;
}

jest.mock("@mingla/brand-assets", () => ({
  MINGLA_WORDMARK: 1,
  MINGLA_BUSINESS_LOGO: 2,
  MINGLA_APP_ICON: 3,
}));

jest.mock("expo-router", () => ({
  Stack: { Screen: "Stack.Screen" },
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  }),
  useLocalSearchParams: () => ({ token: "test-token" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

// The Button primitive drags in reanimated / svg / haptics, none of which this
// node-env suite can load and none of which it needs for the STRUCTURAL
// assertions (where the control sits in the tree). The Button-internals block
// further down mocks reanimated properly and renders the REAL primitive.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "s", Warning: "w", Error: "e" },
}));

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: "Animated.View", Text: "Animated.Text" },
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (v: unknown) => ({ value: v }),
  useReducedMotion: () => false,
  withTiming: (v: unknown) => v,
}));

jest.mock("../src/components/ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("../src/components/ui/Spinner", () => ({ Spinner: "Spinner" }));

/**
 * The exact module `jest.config.cjs` maps the bare `react-native` specifier to.
 * Driving `fontScale` through it is the ONLY way to move what a rendered screen
 * sees, and the identity is asserted (not assumed) in `the harness really moves
 * fontScale` below.
 */
const RN_MOCK = require("../__manual_mocks__/react-native.js") as {
  Platform: { OS: string };
  useWindowDimensions: () => {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  };
};

function withPlatform<T>(os: string, body: () => T): T {
  const original = RN_MOCK.Platform.OS;
  RN_MOCK.Platform.OS = os;
  try {
    return body();
  } finally {
    RN_MOCK.Platform.OS = original;
  }
}

/**
 * The shared react-native mock renders `Pressable` as a passthrough, so a
 * function child (RN's `PressableStateCallbackType` render prop, which `Button`
 * uses) would be handed to React as a child instead of being CALLED — and the
 * primitive's whole interior would never render. Patching the SAME module
 * object the mapper hands `Button` (rather than re-mocking the module) keeps
 * `withFontScale` working, because both mutate one object.
 */
const RN_PRESSABLE_HOST = RN_MOCK as unknown as { Pressable: unknown };
const ORIGINAL_PRESSABLE = RN_PRESSABLE_HOST.Pressable;
beforeAll(() => {
  RN_PRESSABLE_HOST.Pressable = function PressableStub(props: {
    children?: unknown;
    [k: string]: unknown;
  }): React.ReactElement {
    const { children, ...rest } = props;
    const resolved =
      typeof children === "function"
        ? (children as (s: { pressed: boolean }) => React.ReactNode)({
            pressed: false,
          })
        : (children as React.ReactNode);
    return React.createElement("Pressable", rest, resolved);
  };
});
afterAll(() => {
  RN_PRESSABLE_HOST.Pressable = ORIGINAL_PRESSABLE;
});

function withFontScale<T>(fontScale: number, body: () => T): T {
  const original = RN_MOCK.useWindowDimensions;
  const baseline = original();
  RN_MOCK.useWindowDimensions = () => ({ ...baseline, fontScale });
  try {
    return body();
  } finally {
    RN_MOCK.useWindowDimensions = original;
  }
}

/**
 * Verbatim from react-native/React/CoreModules/RCTAccessibilityManager.mm. The
 * last seven entries are the ACCESSIBILITY sizes; 3.571 is AX5, the setting the
 * whole issue is about.
 */
const RN_IOS_FONT_SCALES = [
  0.823, 0.882, 0.941, 1.0, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143,
  3.571,
];

// ---------------------------------------------------------------------------
// Tree helpers. Everything below reads the RENDERED tree.
// ---------------------------------------------------------------------------

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flat));
  }
  return (style ?? {}) as Record<string, unknown>;
}

function findAllByType(root: TestNode, type: string): TestNode[] {
  return root.findAll((n: TestNode) => n.type === type, { deep: true });
}

describe("#2211 — the harness itself", () => {
  it("really moves fontScale, and restores it afterwards", () => {
    const before = RN_MOCK.useWindowDimensions().fontScale;
    expect(withFontScale(1, () => RN_MOCK.useWindowDimensions().fontScale)).toBe(1);
    expect(withFontScale(3.571, () => RN_MOCK.useWindowDimensions().fontScale)).toBe(
      3.571,
    );
    expect(RN_MOCK.useWindowDimensions().fontScale).toBe(before);
  });

  it("describes the whole table — both sides of the 2x cap actually render", () => {
    const { BUTTON_MAX_FONT_SCALE } = require("../src/constants/dynamicType");
    // If the table is ever narrowed to one side of the cap, every cap assertion
    // in this file silently stops testing the thing it names. This fails first.
    expect(RN_IOS_FONT_SCALES.some((s) => s < BUTTON_MAX_FONT_SCALE)).toBe(true);
    expect(RN_IOS_FONT_SCALES.some((s) => s > BUTTON_MAX_FONT_SCALE)).toBe(true);
    expect(Math.max(...RN_IOS_FONT_SCALES)).toBe(3.571);
  });
});

// ---------------------------------------------------------------------------
// T-1 / T-2 / T-3 — InviteScreenShell: the structure the invitation routes rely on.
// ---------------------------------------------------------------------------

describe("#2211 T-1..T-3 — InviteScreenShell", () => {
  const { InviteScreenShell } = require("../src/components/invite/InviteScreenShell");

  /** A marker child, so the tree can prove WHERE content and actions land. */
  function Marker(): React.ReactElement {
    return React.createElement("marker-child", null);
  }

  function renderShell(actions?: React.ReactNode) {
    // The pinned sibling is the NATIVE guarantee. Web deliberately keeps the
    // action inside the scrolling centre so the absolute first-visit consent
    // panel cannot cover it; issue #922's browser suite owns that branch.
    return withPlatform("ios", () =>
      renderTree(
        <InviteScreenShell actions={actions}>
          <Marker />
        </InviteScreenShell>,
      ),
    );
  }

  it("T-1 — the content region is a ScrollView whose contentContainer grows", () => {
    const root = renderShell();
    const scrolls = findAllByType(root, "ScrollView");
    expect(scrolls).toHaveLength(1);
    // `flexGrow: 1` is the whole trick: centred while there is room, scrollable
    // once there is not. RN defaults content containers to `flexGrow: 0`, so
    // omitting it would silently top-anchor the card instead.
    expect(flat(scrolls[0].props.contentContainerStyle).flexGrow).toBe(1);
    // #2211 — the centring is an `auto` vertical margin on an inner wrapper,
    // NOT `justifyContent: "center"` on the content container. Measured on an
    // iPhone SE 3 at AX5: `justifyContent: "center"` left the heading's first
    // line 20 pt above y = 0 with the scroll offset already at 0, i.e.
    // unrecoverable. An auto margin cannot push content out of scroll range.
    expect(flat(scrolls[0].props.contentContainerStyle).justifyContent).toBeUndefined();
    const centerer = root.find(
      (n: TestNode) => flat(n.props?.style).marginVertical === "auto",
    );
    expect(flat(centerer.props.style).marginVertical).toBe("auto");
  });

  it("T-1b — the scroll HOST keeps flex:1 and clips, so nothing can grow past it", () => {
    const scroll = findAllByType(renderShell(), "ScrollView")[0];
    expect(flat(scroll.props.style).flex).toBe(1);
    expect(flat(scroll.props.style).overflow).toBe("hidden");
  });

  it("T-2 — the action is a non-shrinking SIBLING, never inside the scroll region", () => {
    const root = renderShell(<Marker />);
    const scroll = findAllByType(root, "ScrollView")[0];
    const footer = root.find(
      (n: TestNode) => n.props?.testID === "invite-shell-footer",
    );
    // The exact #2180 structure: an exit inside the scrolling region can be
    // pushed out of view by a mis-measurement above it; a flexShrink:0 sibling
    // cannot.
    expect(flat(footer.props.style).flexShrink).toBe(0);
    expect(scroll.findAll((n: TestNode) => n === footer, { deep: true })).toHaveLength(0);
  });

  it("T-3 — no footer is rendered when a branch has no action (the spinner case)", () => {
    const root = renderShell();
    expect(
      root.findAll(
        (n: TestNode) => n.props?.testID === "invite-shell-footer",
        { deep: true },
      ),
    ).toHaveLength(0);
  });

  it("T-3b — children land INSIDE the scroll region", () => {
    const scroll = findAllByType(renderShell(), "ScrollView")[0];
    expect(
      scroll.findAll((n: TestNode) => n.type === "marker-child", { deep: true }),
    ).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-4 / T-5 — the Button primitive, rendered for real, across the whole table.
// ---------------------------------------------------------------------------

describe("#2211 T-4..T-5 — Button caps its label and cannot crop it", () => {
  const { Button } = require("../src/components/ui/Button");
  const { BUTTON_MAX_FONT_SCALE } = require("../src/constants/dynamicType");

  function renderButton(size: "sm" | "md" | "lg", fontScale: number) {
    return withFontScale(fontScale, () =>
      renderTree(
        <Button label="Continue with Apple" onPress={() => {}} size={size} />,
      ),
    );
  }

  it.each(RN_IOS_FONT_SCALES)(
    "T-4 — the label carries the 2x cap at fontScale %s",
    (fontScale) => {
      for (const size of ["sm", "md", "lg"] as const) {
        const root = renderButton(size, fontScale);
        const labels = root.findAll(
          (n: TestNode) =>
            n.type === "Text" && n.props?.children === "Continue with Apple",
          { deep: true },
        );
        expect(labels).toHaveLength(1);
        // Unconditional: a cap applied only above some threshold would leave a
        // window where the label crops, and would still pass a single-scale test.
        expect(labels[0].props.maxFontSizeMultiplier).toBe(BUTTON_MAX_FONT_SCALE);
        expect(labels[0].props.numberOfLines).toBe(1);
      }
    },
  );

  it.each(RN_IOS_FONT_SCALES)(
    "T-5 — the pill uses minHeight, never a hard height, at fontScale %s",
    (fontScale) => {
      for (const size of ["sm", "md", "lg"] as const) {
        const root = renderButton(size, fontScale);
        const container = root
          .findAll((n: TestNode) => typeof n.type === "string", { deep: true })
          .map((n: TestNode) => flat(n.props.style))
          .find(
            (st: Record<string, unknown>) =>
              st.minHeight !== undefined || st.height !== undefined,
          );
        expect(container).toBeDefined();
        // A hard `height` is what cropped the label at 161 call sites. The
        // 44 pt minimum touch target is preserved by the floor.
        expect(container?.height).toBeUndefined();
        expect(typeof container?.minHeight).toBe("number");
        expect(container?.minHeight as number).toBeGreaterThanOrEqual(36);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// T-7..T-9 — the analytics bucketing, with real branch coverage.
// ---------------------------------------------------------------------------

describe("#2211 T-7..T-9 — text-size analytics", () => {
  const dt = require("../src/constants/dynamicType");

  it("T-7 — every bucket is actually reached across the real table", () => {
    const seen = new Set(RN_IOS_FONT_SCALES.map((s) => dt.textSizeBucket(s)));
    // Branch coverage stated as an assertion: if a future edit collapses the
    // bucketing, or the table stops spanning the bands, this fails rather than
    // quietly testing one branch four times.
    expect([...seen].sort()).toEqual(
      ["accessibility", "accessibility_max", "default", "large"].sort(),
    );
  });

  it("T-7b — AX5 is the extreme bucket and reads as large text", () => {
    expect(dt.textSizeBucket(3.571)).toBe("accessibility_max");
    expect(dt.isLargeText(3.571)).toBe(true);
    expect(dt.textSizeAnalyticsProperties(3.571)).toEqual({
      font_scale: 3.57,
      text_size_bucket: "accessibility_max",
      is_large_text: true,
    });
  });

  it("T-7c — the default setting is not misreported as large", () => {
    expect(dt.textSizeBucket(1)).toBe("default");
    expect(dt.isLargeText(1)).toBe(false);
    expect(dt.isLargeText(1.353)).toBe(false); // largest ORDINARY step
    expect(dt.isLargeText(1.786)).toBe(true); // first ACCESSIBILITY step
  });

  it("T-9 — a platform that has not reported a scale yet never emits NaN", () => {
    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const props = dt.textSizeAnalyticsProperties(bad);
      expect(Number.isFinite(props.font_scale)).toBe(true);
      expect(props.font_scale).toBe(1);
      expect(props.text_size_bucket).toBe("default");
    }
  });
});

// ---------------------------------------------------------------------------
// T-2b / T-3c — THE HEADLINE CASE, rendered end to end.
//
// The two assertions above prove the shell is correct. These prove the two
// routes the issue is named after actually GO THROUGH it — the gap a
// source-text gate cannot see, because importing a component and using it are
// different things. The invitee's branch (`authStatus === "signed_out"`) is the
// exact state a person clicking an invite link in their email lands in.
// ---------------------------------------------------------------------------

jest.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({ authStatus: "signed_out", user: null, signOut: jest.fn() }),
}));
jest.mock("../src/hooks/useBrandInvitations", () => ({
  useAcceptBrandInvitation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../src/hooks/useScannerInvitations", () => ({
  useAcceptScannerInvitation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../src/components/invite/BusinessAppDownloadCta", () => ({
  BusinessAppDownloadCta: "BusinessAppDownloadCta",
}));

describe("#2211 T-2b — the invitation routes render through the shell", () => {
  const ROUTES: Array<[string, string]> = [
    ["accept-brand-invitation", "../app/accept-brand-invitation"],
    ["accept-scanner-invitation", "../app/accept-scanner-invitation"],
  ];

  it.each(ROUTES)(
    "%s — an invited teammate reaches Sign in at every text size",
    (_name, modulePath) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Route = require(modulePath).default as React.ComponentType;
      for (const fontScale of RN_IOS_FONT_SCALES) {
        const root = withPlatform("ios", () =>
          withFontScale(fontScale, () => renderTree(<Route />)),
        );

        // (a) The content region scrolls. Before #2211 there was no ScrollView
        //     anywhere in this render path, which is why one swipe changed
        //     nothing when the heading was measured off the top of the screen.
        const scrolls = findAllByType(root, "ScrollView");
        expect(scrolls).toHaveLength(1);
        expect(flat(scrolls[0].props.contentContainerStyle).flexGrow).toBe(1);

        // (b) "Sign in" exists AND sits in the pinned footer, not the scroll
        //     region — so it is on screen at scroll position 0.
        const footer = root.find(
          (n: TestNode) => n.props?.testID === "invite-shell-footer",
        );
        expect(flat(footer.props.style).flexShrink).toBe(0);
        const signIn = footer.findAll(
          (n: TestNode) => n.props?.label === "Sign in",
          { deep: true },
        );
        expect(signIn).toHaveLength(1);
        expect(
          scrolls[0].findAll((n: TestNode) => n.props?.label === "Sign in", {
            deep: true,
          }),
        ).toHaveLength(0);
      }
    },
  );
});
