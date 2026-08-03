/**
 * Issue #1484 [stay-desktop-shell] — DESKTOP WIDTH, proved through the REAL
 * react-native-web style compiler (the resolver that ships on desktop web).
 *
 * WHY THIS SUITE EXISTS — it is the direct answer to the #1484 P1-1 FAIL.
 *
 * The desktop uncap shipped BROKEN while 29 headless react-native render tests
 * were green. The uncap had been written as an OVERRIDE:
 *
 *     contentContainerStyle={[styles.page, isWideDesktop ? styles.pageWide : null]}
 *     pageWide: { <maxWidth set to undefined>, alignSelf: "flex-start" }
 *
 * Under plain `react-native`, `StyleSheet.flatten` keeps the `maxWidth` KEY with
 * value `undefined`, so `expect(flat.maxWidth).toBeUndefined()` is TRUE whether
 * the cap was released or silently retained — an unfalsifiable predicate.
 * Under `react-native-web` the base style's atomic `r-maxWidth-*` class survives
 * into the DOM and the cap STILL APPLIES: the tester measured Overview at 820px
 * and Rooms & Places at 900px on a 2560px monitor, carrying the live classes
 * `r-maxWidth-wcnoba` / `r-maxWidth-qd89wu`.
 *
 * This suite renders through RNW via ReactDOMServer and asserts on the EMITTED
 * ATOMIC CLASSES — the same artefacts the tester read out of the live browser —
 * so a silently-retained cap CANNOT pass. It is deliberately independent of the
 * react-test-renderer suites: they check the selected style object, this checks
 * what the web resolver actually emits.
 *
 * The phone cap class is DERIVED at runtime (render at 390px, read the atom)
 * rather than hard-coded, so the suite cannot rot against RNW's hash scheme.
 *
 * FAILS-ON-REVERT: restoring the `[styles.page, <undefined-maxWidth>]` override
 * shape makes the phone cap's atomic class reappear in the desktop markup →
 * W-1/W-2/W-3 FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1484.web.render.cjs --runInBand
 */

import React from "react";

// `react-dom/server` ships no type declarations here, so a bare `import` adds a
// TS7016 to the issue-1403 typecheck-delta gate. Use the repo's typed-require
// idiom (same form as the ListingInsightsScreen.issue1403 render suites).
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

let mockIsWideDesktop = true;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: true,
    width: mockIsWideDesktop ? 2560 : 390,
  }),
}));

jest.mock("react-native-reanimated", () => {
  const RNW = jest.requireActual("react-native-web");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RNW.View),
      Text: passthrough(RNW.Text),
      ScrollView: passthrough(RNW.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: {
      bezier: () => () => 0,
      linear: () => 0,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: () => 0,
    },
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RNW = jest.requireActual("react-native-web");
  return {
    __esModule: true,
    ScrollView: RNW.ScrollView,
    default: RNW.ScrollView,
  };
});
// react-native-svg resolves to its NATIVE entry under this node-env config and
// trips the batched-bridge invariant on import. Vector art is irrelevant to a
// WIDTH proof, so render every SVG primitive as a plain RNW View.
jest.mock("react-native-svg", () => {
  const RNW = jest.requireActual("react-native-web");
  const ReactLocal = jest.requireActual("react");
  const Shape = (props: Record<string, unknown>): unknown =>
    ReactLocal.createElement(RNW.View, { style: props?.style });
  return new Proxy(
    { __esModule: true, default: Shape },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop === "__esModule" || prop === "default" ? target[prop] : Shape,
    },
  );
});
// lucide-react-native pulls react-native-svg, which needs the native bridge and
// is not aliased by the RNW mapping. Icons are irrelevant to a WIDTH proof.
jest.mock("lucide-react-native", () => {
  const RNW = jest.requireActual("react-native-web");
  const ReactLocal = jest.requireActual("react");
  const Icon = (): unknown => ReactLocal.createElement(RNW.View, null);
  return new Proxy(
    { __esModule: true },
    { get: (_target, prop) => (prop === "__esModule" ? true : Icon) },
  );
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const STAY_SNAPSHOT = {
  settings: {
    property_kind: "hotel",
    summary: "A characterful city hotel with a rooftop bar and garden rooms.",
    timezone: "Africa/Lagos",
    check_in_time: "15:00:00",
    check_out_time: "11:00:00",
    default_booking_mode: "request",
    amenities: ["Pool"],
    accessibility_features: ["Lift"],
    arrival_instructions: "Front desk",
    house_rules: "No smoking",
    booking_state: "review",
    version: 3,
  },
  offerings: [],
  permissions: { canManageInventory: true, canManageFinance: true },
};
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: { all: ["stay-inventory"] },
  useStayInventory: () => ({
    data: STAY_SNAPSHOT,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  usePublishStay: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSaveStaySettings: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useBrandDiscoveryCurrency", () => ({
  useBrandDiscoveryCurrency: () => ({
    data: {
      authority: "settlement",
      canAcceptPaidReservations: true,
      currencyCode: "NGN",
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../StayInventoryManager", () => ({
  StayInventoryManager: (): null => null,
}));
jest.mock("../StayReservationsModule", () => ({
  StayReservationsModule: (): null => null,
}));
jest.mock("../../venue/VenueMenuModule", () => ({
  VenueMenuModule: (): null => null,
}));

import { stayPageMaxWidth } from "../../../constants/designSystem";
import { StaySuiteShell } from "../StaySuiteShell";

const PROPS = {
  brandId: "brand-1484",
  venueId: "venue-1484",
  venueName: "Test Hotel",
  venueApproved: true,
};

const { AppRegistry } = jest.requireActual("react-native-web") as {
  AppRegistry: {
    registerComponent: (name: string, factory: () => unknown) => void;
    getApplication: (name: string) => {
      element: React.ReactElement;
      getStyleElement: () => React.ReactElement;
    };
  };
};

/**
 * Render through RNW's REAL style compiler and return BOTH the markup and the
 * generated stylesheet, so we can resolve each emitted atomic class back to the
 * actual CSS declaration — i.e. read the real `max-width` the browser would
 * apply, exactly like the tester's live-DOM probe.
 */
function renderWeb(): { html: string; css: string } {
  const name = `Issue1484_${renderCount++}`;
  AppRegistry.registerComponent(name, () => StayWrapper);
  const app = AppRegistry.getApplication(name);
  const html = ReactDOMServer.renderToStaticMarkup(app.element);
  const css = ReactDOMServer.renderToStaticMarkup(app.getStyleElement());
  return { html, css };
}
let renderCount = 0;
const StayWrapper = (): React.ReactElement => <StaySuiteShell {...PROPS} />;

/**
 * Every `max-width` value (in px) that is ACTUALLY APPLIED to the rendered
 * markup: each `.r-maxWidth-*{max-width:Npx}` rule whose class appears in the
 * HTML. This is the assertion the old `flat.maxWidth` predicate could not make.
 */
function appliedMaxWidths({
  html,
  css,
}: {
  html: string;
  css: string;
}): number[] {
  const applied = new Set<number>();
  const rule = /\.(r-maxWidth-[a-z0-9]+)\{max-width:([0-9.]+)px;?\}/g;
  let match = rule.exec(css);
  while (match !== null) {
    const [, className, value] = match;
    if (new RegExp(`(^|[\\s"])${className}([\\s"]|$)`).test(html)) {
      applied.add(Number(value));
    }
    match = rule.exec(css);
  }
  return [...applied].sort((a, b) => a - b);
}

describe("#1484 — the desktop uncap survives the react-native-web resolver", () => {
  it("W-1 — PHONE Overview really applies the 820px readable measure", () => {
    mockIsWideDesktop = false;
    const applied = appliedMaxWidths(renderWeb());
    // Sanity anchor for the whole suite: if the phone cap ever stopped being
    // emitted, W-2's "absent on desktop" assertion would be vacuously true.
    expect(applied).toContain(stayPageMaxWidth);
  });

  it("W-2 — DESKTOP Overview does NOT apply the phone cap (THE P1-1 CONTRACT)", () => {
    mockIsWideDesktop = true;
    const applied = appliedMaxWidths(renderWeb());
    // With the old `[page, <undefined-maxWidth>]` override the base's atomic
    // class survived into the DOM and Overview stayed 820px wide on a 2560px
    // monitor. This is that exact failure, expressed as a real CSS assertion.
    expect(applied).not.toContain(stayPageMaxWidth);
  });

  it("W-3 — DESKTOP Overview applies NO width cap at all", () => {
    mockIsWideDesktop = true;
    expect(appliedMaxWidths(renderWeb())).toEqual([]);
  });

  it("W-4 — desktop is LEFT-anchored where phone is CENTRED", () => {
    const alignAtoms = (html: string, css: string): string[] => {
      const applied = new Set<string>();
      const rule = /\.(r-alignSelf-[a-z0-9]+)\{align-self:([a-z-]+);?\}/g;
      let match = rule.exec(css);
      while (match !== null) {
        const [, className, value] = match;
        if (new RegExp(`(^|[\\s"])${className}([\\s"]|$)`).test(html)) {
          applied.add(value);
        }
        match = rule.exec(css);
      }
      return [...applied].sort();
    };
    mockIsWideDesktop = true;
    const desktop = renderWeb();
    mockIsWideDesktop = false;
    const phone = renderWeb();
    expect(alignAtoms(desktop.html, desktop.css)).toContain("flex-start");
    expect(alignAtoms(phone.html, phone.css)).toContain("center");
  });
});
