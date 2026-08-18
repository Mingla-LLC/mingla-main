/**
 * #2180 [get-app link opens the installed app and strands the user]
 * Implementor happy-path regression suite — SPEC §7, T-9.
 *
 * The anti-recurrence gate for the CONSEQUENCE. Round-2 pixel forensics proved the
 * business 404 rendered its 2000x2000 lockup at 2000 pt, which pushed the heading,
 * the subtext and the ONLY exit ("Go home", the sole caller of
 * `router.replace("/")`) off the bottom of an 852 pt screen. The user's only
 * remaining action was to force-quit — observed on device for 77 s and then 121 s.
 *
 * These assertions read the REAL element tree each component returns, not its
 * source text: the component function is invoked and its returned React element
 * tree is walked. So they fail if the Button is moved back inside the centred
 * region, or if the logo loses an explicit dimension — which is exactly the
 * regression that made #2180 terminal.
 *
 * Both apps are asserted from here because `mingla-business jest (full suite)` is
 * the only auto-globbing test gate in the repo (see the sibling native-intent
 * suite's header for the full reasoning). `app-mobile` has no jest config, no
 * `test` script and no auto-globbing workflow — every consumer suite is a
 * hand-written per-issue npm script wired to a paths-gated workflow — so a
 * consumer-side copy of this file would be a DARK test, which is worse than none.
 *
 * HOW THE CONSUMER HALF GETS HERE WITHOUT AN IMPORT (#2180 CI repair).
 * This suite used to `import ConsumerNotFound from "../../app-mobile/app/+not-found"`.
 * That was green on a laptop with BOTH sub-projects installed and red in CI, which
 * runs `npm ci` in `mingla-business` ONLY. Two independent failures, one cause:
 *   1. `mingla-business jest (full suite)` — the consumer screen's `expo-linear-gradient`
 *      and `expo-haptics` resolve from `app-mobile/node_modules`, a directory CI never
 *      creates, so the suite could not even load.
 *   2. `issue-874-business-analytics` / `issue-1403-listing-insights` — the import put
 *      `app-mobile/app/+not-found.tsx` and `app-mobile/src/utils/hapticFeedback.ts` into
 *      THIS app's `tsc` program, which cannot resolve the consumer app's peers: five
 *      added TS2307 diagnostics, and both typecheck-delta ratchets went red.
 * `consumerNotFoundModule()` below replaces the import with a self-contained loader:
 * the file is read as text, transpiled with the TypeScript compiler (no type-checking,
 * no module resolution) and EXECUTED against an explicit dependency table. Nothing
 * about `app-mobile` reaches Node's resolver or this app's `tsc` program, and the
 * assertions are unchanged — they still walk the element tree the REAL consumer
 * component returns, so they still fail on revert of the consumer screen.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";
import * as ts from "typescript";

// Brand assets are PNG `require`s — stub the module so this node-env suite can
// import the screens. Only the asset handle is replaced; no product logic.
jest.mock("@mingla/brand-assets", () => ({
  MINGLA_WORDMARK: 1,
  MINGLA_BUSINESS_LOGO: 2,
  MINGLA_APP_ICON: 3,
}));

jest.mock("expo-router", () => ({
  Stack: { Screen: "Stack.Screen" },
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
}));

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

// The business `Button` primitive drags in react-native-reanimated,
// react-native-svg and expo-haptics, all ESM, none of which this node-env suite
// can load — and none of which it needs. Every prop these tests assert on
// (`accessibilityLabel`, and WHERE the control sits in the tree) is authored at
// the call site in `+not-found.tsx`, so replacing the primitive with an inert
// stub removes the dependency chain without weakening a single assertion.
jest.mock("../src/components/ui/Button", () => ({ Button: "Button" }));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

// expo-haptics ships ESM and is reached via both apps' haptic helpers. Nothing
// here fires a haptic; the module only has to load.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

import BusinessNotFound from "../app/+not-found";

// #2180 P2-1 — the Dynamic Type ceiling each screen publishes for its own CTA.
// These are exported so the cap can be asserted at EVERY multiplier iOS can
// hand us, not just the one the jest react-native mock happens to report.
import {
  CTA_MAX_FONT_SCALE as BUSINESS_CTA_MAX_FONT_SCALE,
  LARGE_TYPE_FONT_SCALE as BUSINESS_LARGE_TYPE_FONT_SCALE,
  ctaLabelStyle,
} from "../app/+not-found";
// The jest react-native mock reports a fixed `fontScale`; read it from the same
// place the screen does rather than hardcoding it, so the wiring assertion below
// stays true if that mock is ever retuned.
import { useWindowDimensions } from "react-native";

// ---------------------------------------------------------------------------
// #2180 — the consumer screen, loaded WITHOUT importing it.
//
// See the file header for why an `import` cannot be used. This is a real module
// evaluation, not a source-text pin: the .tsx is transpiled and RUN, and the
// assertions below walk the element tree the component actually returns.
// ---------------------------------------------------------------------------

const CONSUMER_ROOT = path.resolve(__dirname, "../../app-mobile");

/**
 * The consumer app's third-party dependencies, stubbed EXACTLY as the jest.mock()
 * calls above stub this app's copies, so both halves of every `describe.each`
 * below compare like with like.
 *
 * `react-native` is this app's own manual mock — the same module `jest.config.cjs`
 * maps the bare specifier to — so the consumer screen and the business screen run
 * against ONE React Native surface. First-party `app-mobile` files (the design
 * system, the responsive helpers, the haptics wrapper) are deliberately absent:
 * the loader compiles and executes the REAL ones.
 */
const CONSUMER_STUBS: Record<string, unknown> = {
  react: require("react"),
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": require("../__manual_mocks__/react-native.js"),
  "expo-router": {
    __esModule: true,
    Stack: { Screen: "Stack.Screen" },
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  },
  "expo-linear-gradient": { __esModule: true, LinearGradient: "LinearGradient" },
  "react-native-safe-area-context": {
    __esModule: true,
    SafeAreaView: "SafeAreaView",
    useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  },
  "expo-haptics": {
    __esModule: true,
    impactAsync: jest.fn(),
    notificationAsync: jest.fn(),
    selectionAsync: jest.fn(),
    ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
    NotificationFeedbackType: {
      Success: "success",
      Warning: "warning",
      Error: "error",
    },
  },
  "@mingla/brand-assets": {
    __esModule: true,
    MINGLA_WORDMARK: 1,
    MINGLA_BUSINESS_LOGO: 2,
    MINGLA_APP_ICON: 3,
  },
};

/** Resolve a relative specifier to a real `app-mobile` file, or throw. */
function resolveConsumerFile(fromDir: string, specifier: string): string {
  const base = path.resolve(fromDir, specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  const hit = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!hit) throw new Error(`#2180 consumer loader: cannot resolve "${specifier}" from ${fromDir}`);
  return hit;
}

const consumerModuleCache = new Map<string, Record<string, unknown>>();

/**
 * Compile + execute one `app-mobile` TypeScript file and return its exports.
 *
 * `transpileModule` does NO type-checking and NO module resolution, so nothing
 * here touches Node's resolver or this app's `tsc` program — which is the whole
 * point. First-party relative imports recurse (real code); bare specifiers come
 * from `CONSUMER_STUBS` and THROW if absent, so a new consumer dependency fails
 * loudly here instead of silently evaluating to `{}`.
 */
function loadConsumerFile(absPath: string): Record<string, unknown> {
  const cached = consumerModuleCache.get(absPath);
  if (cached) return cached;

  const { outputText } = ts.transpileModule(fs.readFileSync(absPath, "utf8"), {
    fileName: absPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      // Matches jest.config.cjs's ts-jest `tsconfig: { jsx: "react-jsx" }`, so the
      // consumer tree and the business tree are built by the SAME JSX runtime.
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  });

  const moduleExports: Record<string, unknown> = {};
  const moduleObject = { exports: moduleExports };
  const dir = path.dirname(absPath);
  const localRequire = (specifier: string): unknown => {
    if (specifier.startsWith(".")) return loadConsumerFile(resolveConsumerFile(dir, specifier));
    if (specifier in CONSUMER_STUBS) return CONSUMER_STUBS[specifier];
    throw new Error(
      `#2180 consumer loader: "${specifier}" (required by ${path.relative(CONSUMER_ROOT, absPath)}) ` +
        `has no entry in CONSUMER_STUBS. Add one — never let it resolve to an empty object.`,
    );
  };

  const factory = new Function("exports", "require", "module", "__filename", "__dirname", outputText) as (
    exports: Record<string, unknown>,
    require: (s: string) => unknown,
    module: { exports: Record<string, unknown> },
    filename: string,
    dirname: string,
  ) => void;
  factory(moduleExports, localRequire, moduleObject, absPath, dir);

  const result = moduleObject.exports;
  consumerModuleCache.set(absPath, result);
  return result;
}

const consumerNotFound = loadConsumerFile(path.join(CONSUMER_ROOT, "app/+not-found.tsx"));
const ConsumerNotFound = consumerNotFound.default as () => React.ReactElement;
const CONSUMER_CTA_MAX_FONT_SCALE = consumerNotFound.CTA_MAX_FONT_SCALE as number;

type El = React.ReactElement<Record<string, unknown>>;

const isElement = (node: unknown): node is El =>
  typeof node === "object" && node !== null && "props" in (node as object);

/** Direct element children of a node, flattened. */
function childrenOf(node: El): El[] {
  const raw = (node.props as { children?: unknown }).children;
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw];
  return list.filter(isElement);
}

/** Every element in the subtree rooted at `node`, inclusive. */
function walk(node: El, out: El[] = []): El[] {
  out.push(node);
  for (const child of childrenOf(node)) walk(child, out);
  return out;
}

/** Flatten an RN style prop (object, array, or nested array) into one object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.flat(Infinity).filter(Boolean).map(flattenStyle));
  }
  return (style ?? {}) as Record<string, unknown>;
}

function findSafeAreaView(tree: El): El {
  const found = walk(tree).find((n) => n.type === "SafeAreaView");
  if (!found) throw new Error("no SafeAreaView in the rendered tree");
  return found;
}

const hasLabel = (node: El, label: string): boolean =>
  (node.props as { accessibilityLabel?: string }).accessibilityLabel === label;

describe.each([
  ["mingla-business", BusinessNotFound],
  ["app-mobile", ConsumerNotFound],
])("#2180 T-9 — %s +not-found structure", (appName, Screen) => {
  const tree = (Screen as () => El)();
  const safeArea = findSafeAreaView(tree);
  const regions = childrenOf(safeArea);

  it("renders a heading with accessibilityRole=header", () => {
    const headings = walk(tree).filter(
      (n) => (n.props as { accessibilityRole?: string }).accessibilityRole === "header",
    );
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it("still offers a Go home control somewhere in the tree", () => {
    expect(walk(tree).some((n) => hasLabel(n, "Go home"))).toBe(true);
  });

  it("puts the SafeAreaView's centred region and footer side by side", () => {
    // Exactly the structural guarantee: a centred region, then a sibling footer.
    expect(regions.length).toBeGreaterThanOrEqual(2);
    const content = flattenStyle((regions[0].props as { style?: unknown }).style);
    expect(content.flex).toBe(1);
    // The centred column clips its own overflow, so nothing inside it can grow
    // the layout and push the footer off-screen.
    expect(content.overflow).toBe("hidden");
  });

  it("keeps the Go home control OUT of the centred region", () => {
    // THE #2180 REGRESSION. If the button is moved back inside the centred
    // column, a mis-measuring sibling can bury it off-screen again.
    const insideCentred = walk(regions[0]).some((n) => hasLabel(n, "Go home"));
    expect(insideCentred).toBe(false);
  });

  it("puts the Go home control inside a non-shrinking sibling footer", () => {
    const footer = regions[regions.length - 1];
    expect(walk(footer).some((n) => hasLabel(n, "Go home"))).toBe(true);
    expect(flattenStyle((footer.props as { style?: unknown }).style).flexShrink).toBe(0);
  });

  it("extends the safe area to the bottom edge so the footer is never clipped", () => {
    const edges = (safeArea.props as { edges?: string[] }).edges ?? [];
    expect(edges).toContain("bottom");
  });

  it("sizes the brand logo with explicit numeric width AND height, no aspectRatio", () => {
    // THE #2180 ROOT DEFECT. `width` + `aspectRatio` with no `height` let the
    // 2000x2000 master lay out at 2000 pt on device.
    //
    // NOTE (#2180 D-1): this reads ONE point on the Dynamic Type curve — the
    // fixed `fontScale` the jest react-native mock reports — so on its own it
    // cannot see a deletion that a conditionally-applied sibling masks. The
    // "fully sized in EVERY branch" suite below is what makes that falsifiable;
    // this assertion is kept because it is the plain-language statement of the
    // invariant and it still catches the simplest form of the regression.
    const image = walk(tree).find(
      (n) => (n.props as { accessibilityRole?: string }).accessibilityRole === "image",
    );
    expect(image).toBeDefined();
    const style = flattenStyle((image as El).props.style);
    expect(typeof style.width).toBe("number");
    expect(typeof style.height).toBe("number");
    expect(style.aspectRatio).toBeUndefined();
    expect(style.flexShrink).toBe(0);
    // Guards against a "fix" that sets height to something absurd.
    expect(style.width as number).toBeGreaterThan(0);
    expect(style.width as number).toBeLessThanOrEqual(400);
    expect(style.height as number).toBeGreaterThan(0);
    expect(style.height as number).toBeLessThanOrEqual(400);
  });

  it(`names the app under test (${appName}) so a vacuous run is visible`, () => {
    expect(walk(tree).length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// #2180 D-1 — the brand-lockup sizing assertion, made FALSIFIABLE.
//
// THE MASKING. Both screens compose the lockup's style conditionally:
//
//     style={[styles.logo, largeType ? styles.logoCompact : null]}
//
// The jest react-native mock reports a single fixed `fontScale` of 2, which is
// above `LARGE_TYPE_FONT_SCALE`, so every tree built above is the ACCESSIBILITY
// branch and both members are always merged. Delete `height` from `styles.logo`
// and `styles.logoCompact`'s height silently fills the hole: the suite stayed
// green while the screen would ship with NO height at every ordinary type size —
// the exact `width`-with-no-`height` defect that laid the 2000x2000 master out
// at 2000 pt and pushed the only exit off the bottom of the screen.
//
// A gate that cannot fail on the regression it exists to prevent is worse than
// no gate, because its green is read as proof. Two things fix it here:
//
//   1. BRANCH COVERAGE. `fontScale` is driven across React Native's whole iOS
//      multiplier table, so the ordinary-type branch — where `styles.logo` is
//      the ONLY member — is actually rendered and asserted.
//   2. THE ANTI-MASKING RULE. Every style member the element actually receives
//      must size it on BOTH axes or on neither. A member that brings a width
//      without a height is under-constrained in every branch where its sibling
//      is absent, which no merged view can see.
//
// Both read the style ACTUALLY APPLIED to the returned element — resolved
// through the array and through the conditional — never a source-level literal.
// ---------------------------------------------------------------------------

/**
 * The exact module `jest.config.cjs` maps the bare `react-native` specifier to,
 * and the very object `CONSUMER_STUBS` hands the consumer loader. Driving
 * `fontScale` through it therefore moves BOTH screens at once; the identity is
 * asserted below rather than assumed, so a mapper change fails loudly instead of
 * quietly leaving half the matrix pinned to one branch.
 */
const RN_MOCK = require("../__manual_mocks__/react-native.js") as {
  useWindowDimensions: () => {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  };
};

/**
 * Run `body` with both screens seeing `fontScale`, then put the mock back.
 *
 * The baseline is read through `original` rather than the `use…`-named export so
 * only the ONE field under test moves — width, height and pixel scale stay
 * exactly as the shared mock publishes them.
 */
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

/** Verbatim from react-native/React/CoreModules/RCTAccessibilityManager.mm. */
const RN_IOS_FONT_SCALES = [
  0.823, 0.882, 0.941, 1.0, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143,
  3.571,
];

function findBrandImage(tree: El): El {
  const image = walk(tree).find(
    (n) => (n.props as { accessibilityRole?: string }).accessibilityRole === "image",
  );
  if (!image) throw new Error("no brand <Image> in the rendered tree");
  return image;
}

/**
 * The style entries the element ACTUALLY receives, in order, with the arms a
 * conditional resolved away (`null` / `false` / `undefined`) dropped — i.e.
 * exactly the set React Native would flatten at this Dynamic Type setting.
 */
function appliedStyleMembers(style: unknown): Record<string, unknown>[] {
  const list = Array.isArray(style) ? (style as unknown[]).flat(Infinity) : [style];
  return list.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null,
  );
}

describe("#2180 T-9 D-1 — the Dynamic Type driver reaches both screens", () => {
  it("mutates the same react-native module both screens resolve", () => {
    // If this ever stops holding, every branch assertion below silently reduces
    // to one branch — which is the D-1 failure mode itself.
    expect(require("react-native")).toBe(RN_MOCK);
    expect(CONSUMER_STUBS["react-native"]).toBe(RN_MOCK);
  });

  it("really moves fontScale, and restores it afterwards", () => {
    const before = useWindowDimensions().fontScale;
    expect(withFontScale(1, () => useWindowDimensions().fontScale)).toBe(1);
    expect(withFontScale(3.571, () => useWindowDimensions().fontScale)).toBe(3.571);
    expect(useWindowDimensions().fontScale).toBe(before);
  });
});

describe.each([
  ["mingla-business", BusinessNotFound, BUSINESS_LARGE_TYPE_FONT_SCALE],
  [
    "app-mobile",
    ConsumerNotFound,
    consumerNotFound.LARGE_TYPE_FONT_SCALE as number,
  ],
])(
  "#2180 T-9 D-1 — %s brand lockup is fully sized in EVERY Dynamic Type branch",
  (_appName, Screen, largeTypeThreshold) => {
    const render = (fontScale: number): El =>
      withFontScale(fontScale, () =>
        findBrandImage((Screen as unknown as () => El)()),
      );

    it("renders a genuinely DIFFERENT composition on each side of the threshold", () => {
      // Proves the conditional arm is live and that the driver above reaches it.
      // Without this, the per-scale matrix could be twelve copies of one branch.
      const ordinary = render((largeTypeThreshold as number) - 0.5);
      const accessibility = render((largeTypeThreshold as number) + 0.5);

      const ordinaryMembers = appliedStyleMembers(ordinary.props.style);
      const accessibilityMembers = appliedStyleMembers(accessibility.props.style);
      expect(ordinaryMembers.length).toBeGreaterThan(0);
      expect(accessibilityMembers.length).toBeGreaterThan(ordinaryMembers.length);

      // ...and the extra member is a real step-DOWN, not a merged no-op.
      const ordinaryBox = flattenStyle(ordinary.props.style);
      const compactBox = flattenStyle(accessibility.props.style);
      expect(compactBox.width as number).toBeLessThan(ordinaryBox.width as number);
      expect(compactBox.height as number).toBeLessThan(ordinaryBox.height as number);
    });

    it.each(RN_IOS_FONT_SCALES)(
      "sizes the lockup on both axes in the branch that renders at fontScale %s",
      (fontScale: number) => {
        const image = render(fontScale);
        const members = appliedStyleMembers(image.props.style);

        // A branch that applied no style at all must never read as success.
        expect(members.length).toBeGreaterThan(0);

        // (1) THE BOX THIS BRANCH ACTUALLY RENDERS — resolved through the array
        // and the conditional, not read off a source literal.
        const applied = flattenStyle(image.props.style);
        expect(typeof applied.width).toBe("number");
        expect(typeof applied.height).toBe("number");
        expect(applied.aspectRatio).toBeUndefined();
        expect(applied.width as number).toBeGreaterThan(0);
        expect(applied.width as number).toBeLessThanOrEqual(400);
        expect(applied.height as number).toBeGreaterThan(0);
        expect(applied.height as number).toBeLessThanOrEqual(400);

        // (2) THE ANTI-MASKING RULE. A member that sizes the lockup on one axis
        // must size it on both, so no conditionally-applied sibling can cover
        // for a branch it is not part of. This is what makes deleting a `height`
        // from EITHER entry go red instead of being absorbed by the other.
        members.forEach((member, index) => {
          const sizes = {
            width: typeof member.width === "number",
            height: typeof member.height === "number",
          };
          if (!sizes.width && !sizes.height) return;
          expect({ styleMember: index, ...sizes }).toEqual({
            styleMember: index,
            width: true,
            height: true,
          });
          expect(member.aspectRatio).toBeUndefined();
        });
      },
    );
  },
);

/**
 * #2180 P2-1 — the exit must keep its LABEL, not merely its pill.
 *
 * The tester returned CONDITIONAL PASS: on an iPhone SE 3 (375 x 667 pt) at the
 * largest Dynamic Type setting, both 404 screens clipped the lockup and the
 * subtext away and cut the "Go home" label off mid-glyph. The button still
 * fired — the #2180 stranding does not recur — but a screen whose entire job is
 * to give the user a visible way out cannot ship with an unreadable exit.
 *
 * The mechanism, from React Native's own iOS source rather than inference:
 *   - `RCTAccessibilityManager.mm:255-272` — the multiplier table tops out at
 *     3.571 at UIContentSizeCategoryAccessibilityExtraExtraExtraLarge.
 *   - `RCTTextAttributes.mm:139` — `lineHeight` is multiplied by that same
 *     `effectiveFontSizeMultiplier`, so a 14/20 label draws at 50/71.4 pt.
 *   - The business `Button` pill is a FIXED 44 pt (`SIZE_HEIGHT.md`) and
 *     exposes no `maxFontSizeMultiplier`, so 71.4 pt of line cannot fit in it.
 *
 * These assertions pin the cap arithmetic across the WHOLE table, which the
 * tree-walking tests above cannot do: the jest react-native mock reports a
 * single fixed `fontScale`, so the rendered tree only ever shows one point on
 * the curve. Deleting the cap turns them red at the accessibility steps.
 */
describe("#2180 T-9 P2-1 — the Go home label survives the largest Dynamic Type setting", () => {
  // `RN_IOS_FONT_SCALES` is the module-level table declared above — one copy,
  // shared with the D-1 branch matrix, so the two can never drift apart.
  /** Button SIZE_HEIGHT.md — a fixed pill that cannot grow to fit its label. */
  const BUTTON_PILL_HEIGHT = 44;
  /** typography.buttonMd — the primitive's own label metrics. */
  const BASE_FONT_SIZE = 14;
  const BASE_LINE_HEIGHT = 20;

  it("leaves the business label byte-identical at ordinary type sizes", () => {
    // The cap must be invisible until it is needed, or this becomes a redesign.
    expect(ctaLabelStyle(1)).toEqual({
      fontSize: BASE_FONT_SIZE,
      lineHeight: BASE_LINE_HEIGHT,
    });
    expect(ctaLabelStyle(1.353)).toEqual({
      fontSize: BASE_FONT_SIZE,
      lineHeight: BASE_LINE_HEIGHT,
    });
  });

  it.each(RN_IOS_FONT_SCALES)(
    "keeps the business label whole inside its 44 pt pill at fontScale %s",
    (scale: number) => {
      const style = ctaLabelStyle(scale);
      // RN multiplies BOTH values by the live scale, so this is what the device
      // actually draws.
      const renderedFontSize = style.fontSize * scale;
      const renderedLineHeight = style.lineHeight * scale;

      // THE P2-1 DEFECT. Uncapped, AX5 draws a 71.4 pt line inside a 44 pt pill
      // and the glyphs are cut off.
      expect(renderedLineHeight).toBeLessThanOrEqual(BUTTON_PILL_HEIGHT);
      // EPSILON, not slack: `base * (cap / scale) * scale` reassociates to
      // 28.000000000000004 at scale 3.143 in IEEE-754. Four femtometres of
      // float noise is not a Dynamic Type defect, and a bare `<= 28` would fail
      // on arithmetic rather than on behaviour.
      expect(renderedFontSize).toBeLessThanOrEqual(
        BASE_FONT_SIZE * BUSINESS_CTA_MAX_FONT_SCALE + 1e-9,
      );
      // "Go home" is ~4.03 em in SF Semibold; the pill's inner width on the
      // smallest supported screen is 375 - 2*32 (footer padding) - 2*16
      // (Button padding) = 279 pt. Untruncated means it FITS, not that it
      // ellipsises.
      expect(renderedFontSize * 4.03).toBeLessThan(279);
    },
  );

  it("still grants the full 200 % resize WCAG 1.4.4 asks for", () => {
    // A cap that clamped harder than 200 % would trade one a11y defect for
    // another. 200 % of 14/20 is 28/40 — exactly what a 44 pt pill can host.
    const style = ctaLabelStyle(3.571);
    expect(style.fontSize * 3.571).toBeCloseTo(BASE_FONT_SIZE * 2, 6);
    expect(style.lineHeight * 3.571).toBeCloseTo(BASE_LINE_HEIGHT * 2, 6);
  });

  it("actually WIRES the cap into the business Button, not just exports it", () => {
    // Without this, deleting the `labelStyle` prop from the JSX would leave the
    // arithmetic above green while the shipped screen reverted to the defect.
    const tree = (BusinessNotFound as unknown as () => El)();
    const footerRegion = childrenOf(findSafeAreaView(tree)).slice(-1)[0];
    const cta = walk(footerRegion).find((n) => hasLabel(n, "Go home"));
    expect(cta).toBeDefined();
    const { fontScale } = useWindowDimensions();
    expect((cta as El).props.labelStyle).toEqual(ctaLabelStyle(fontScale));
  });

  it("caps and pins the consumer CTA label the same way", () => {
    const tree = (ConsumerNotFound as unknown as () => El)();
    const footerRegion = childrenOf(findSafeAreaView(tree)).slice(-1)[0];
    const label = walk(footerRegion).find(
      (n) =>
        typeof (n.props as { children?: unknown }).children === "string" &&
        (n.props as { children: string }).children.trim() === "Go home",
    );
    expect(label).toBeDefined();
    const props = (label as El).props as {
      maxFontSizeMultiplier?: number;
      numberOfLines?: number;
    };
    // The consumer pill is minHeight-based, so it GROWS with the label; the cap
    // is what stops 16/24 becoming 57/86 and overflowing the screen width.
    expect(props.maxFontSizeMultiplier).toBe(CONSUMER_CTA_MAX_FONT_SCALE);
    expect(CONSUMER_CTA_MAX_FONT_SCALE).toBeLessThanOrEqual(2);
    expect(props.numberOfLines).toBe(1);
    // 16 pt x 2 = 32 pt; 32 x 4.03 em + 2*24 pt padding = 177 pt on a 311 pt
    // pill. Fits, so the full word renders rather than ellipsising.
    expect(16 * CONSUMER_CTA_MAX_FONT_SCALE * 4.03 + 48).toBeLessThan(311);
  });

  it.each([
    ["mingla-business", BusinessNotFound],
    ["app-mobile", ConsumerNotFound],
  ])(
    "%s scrolls the centred region instead of clipping it out of existence",
    (_appName, Screen) => {
      const tree = (Screen as unknown as () => El)();
      const safeArea = findSafeAreaView(tree);
      const regions = childrenOf(safeArea);
      const centred = regions[0];

      // A plain View has no contentContainerStyle — this is what proves the
      // region can scroll rather than discard whatever does not fit.
      const container = flattenStyle(
        (centred.props as { contentContainerStyle?: unknown })
          .contentContainerStyle,
      );
      expect(container.flexGrow).toBe(1);
      expect(container.justifyContent).toBe("center");

      // SPEC 4.2's structural guarantee is UNCHANGED by the scroll host: the
      // exit is still a non-shrinking sibling, never a child of this region.
      expect(walk(centred).some((n) => hasLabel(n, "Go home"))).toBe(false);
      const footer = regions[regions.length - 1];
      expect(
        flattenStyle((footer.props as { style?: unknown }).style).flexShrink,
      ).toBe(0);
      expect(walk(footer).some((n) => hasLabel(n, "Go home"))).toBe(true);
    },
  );

  it("puts the large-type threshold between RN's ordinary and accessibility steps", () => {
    // 1.353 is the largest ordinary step; 1.786 is the first accessibility one.
    // A threshold inside either band would fire on a size it was not meant for.
    expect(BUSINESS_LARGE_TYPE_FONT_SCALE).toBeGreaterThan(1.353);
    expect(BUSINESS_LARGE_TYPE_FONT_SCALE).toBeLessThan(1.786);
  });
});
