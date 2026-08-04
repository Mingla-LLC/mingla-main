/**
 * Issue #1501 [add-rooms-form] — THE DESKTOP FORM COLUMN + SUMMARY RAIL, proved
 * through the REAL react-native-web style compiler.
 *
 * WHY THIS SUITE EXISTS. Seth's fifth complaint was "it doesn't fill the
 * available space" — the form sat in a narrow column with dead canvas beside it
 * on a wide monitor. The fix is NOT "remove the cap": a text input stretched
 * across a 2,000px monitor is worse than a narrow one. The PAGE releases its cap
 * and the measure moves onto the form COLUMN, which frees the space beside it
 * for a summary rail.
 *
 * That is a width contract, and #1484 proved that width contracts checked only
 * by react-test-renderer ship broken: `react-native`'s `StyleSheet.flatten` and
 * react-native-web's ATOMIC CLASS resolver disagree about what reaches the DOM.
 * So the geometry is asserted here against the CSS the browser would really
 * apply.
 *
 * `stayEditorLayout` is rendered directly because `ReactDOMServer.
 * renderToStaticMarkup` never fires `onLayout`, and the rail is a CONTAINER
 * query — the split branch is unreachable from an SSR render of the editor
 * itself. The function returns THE EXACT STYLE OBJECTS the editor applies (the
 * component calls it too), so there is no second source of truth to drift.
 * The companion suite `stayOfferingEditor.issue1501.render.test.tsx` drives the
 * real `onLayout` and proves the component selects these branches.
 *
 * VACUITY GUARD (V-0): every assertion below reads a CSS declaration; if the
 * lookup silently matched nothing, "no cap" would be trivially true. V-0 proves
 * the lookup resolves a declaration that MUST exist before anything is claimed
 * absent.
 *
 * FAILS-ON-REVERT: point `formColumn` at the uncapped `formColumn` stack style
 * (or drop `maxWidth` from `formColumnInRow`) -> R-2 FAILS; give the rail
 * `flexGrow: 1` -> R-3 FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1501.web.render.cjs --runInBand
 */

import React from "react";

const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: true,
    isWeb: true,
    width: 1440,
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
      // #1532 — ADDITIVE: `Sheet` -> `SheetMobile` reads `Easing.in(Easing.cubic)`
      // at module scope for its close timing, and this mock had no `in`, so the
      // whole suite failed to LOAD once the Stay editor moved into the Sheet.
      // Nothing existing is changed or removed.
      in: (fn: unknown) => fn,
      cubic: () => 0,
    },
    // #1532 — ADDITIVE: `SheetMobile` and `Modal` both cancel their animations
    // on unmount, and this mock had no `cancelAnimation`, so a Stay suite that
    // mounts the editor sheet threw during commit. Additive only.
    cancelAnimation: () => undefined,
    __easingClose: {
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
jest.mock("lucide-react-native", () => {
  const RNW = jest.requireActual("react-native-web");
  const ReactLocal = jest.requireActual("react");
  const Icon = (): unknown => ReactLocal.createElement(RNW.View, null);
  return new Proxy(
    { __esModule: true },
    { get: (_target, prop) => (prop === "__esModule" ? true : Icon) },
  );
});
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
    getQueryData: jest.fn(),
  }),
  useMutation: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
  }),
}));
jest.mock("../../../services/stayInventoryService", () => ({
  bulkCreateStayOfferings: jest.fn(),
  changeStayOfferingStatus: jest.fn(),
  createStayOffering: jest.fn(),
  attachStayOfferingMedia: jest.fn(),
  manageStayInventory: jest.fn(),
  materializeStayPlaceWindows: jest.fn(),
  replaceStayOfferingFees: jest.fn(),
  replaceStayUnits: jest.fn(),
  removeStayOfferingMedia: jest.fn(),
  setStayOfferingPolicy: jest.fn(),
  setStayOfferingPrice: jest.fn(),
  updateStayOffering: jest.fn(),
  upsertStayPlaceSchedule: jest.fn(),
  upsertStayPlaceWindows: jest.fn(),
  upsertStayRoomNights: jest.fn(),
}));
jest.mock("../../../services/stayMediaService", () => ({
  pickStayOfferingPhotos: jest.fn(),
  stayOfferingMediaUrl: jest.fn(() => null),
  uploadStayOfferingPhoto: jest.fn(),
}));
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: {
    all: ["stay-inventory"],
    detail: (venueId: string) => ["stay-inventory", venueId],
  },
  useStayInventory: () => ({
    data: {
      settings: null,
      offerings: [],
      permissions: { canManageInventory: true, canManageFinance: true },
    },
    isLoading: false,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
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

import { View } from "react-native";

import {
  spacing,
  stayEditorFormMaxWidth,
  stayEditorSummaryMinWidth,
  stayEditorSummaryWidth,
  stayProseMaxWidth,
  suiteFormMaxWidth,
} from "../../../constants/designSystem";
import { stayEditorLayout } from "../StayInventoryManager";

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
 * The Stay workspace is the viewport minus the shared shell's rail + gutters.
 * #1484's tester measured 2,284px inside a 2,560px viewport — 276px of chrome.
 */
const CHROME_PX = 276;
const workspaceFor = (viewportPx: number): number => viewportPx - CHROME_PX;

let renderCount = 0;

/**
 * Render the EDITOR'S OWN style objects through the real RNW compiler. The
 * component calls the same `stayEditorLayout`, so a change to the shipped
 * geometry lands here automatically — there is no parallel copy to drift.
 */
function renderLayout(containerWidth: number): {
  html: string;
  css: string;
  showRail: boolean;
} {
  const layout = stayEditorLayout({ isWideDesktop: true, containerWidth });
  const Probe = (): React.ReactElement => (
    <View style={layout.page} testID="probe-page">
      <View style={layout.body} testID="probe-body">
        <View style={layout.formColumn} testID="probe-form" />
        {layout.showRail ? (
          <View style={layout.rail} testID="probe-rail" />
        ) : null}
      </View>
    </View>
  );
  const name = `Issue1501Layout_${renderCount++}`;
  AppRegistry.registerComponent(name, () => Probe);
  const app = AppRegistry.getApplication(name);
  return {
    html: ReactDOMServer.renderToStaticMarkup(app.element),
    css: ReactDOMServer.renderToStaticMarkup(app.getStyleElement()),
    showRail: layout.showRail,
  };
}

function classesFor(html: string, testId: string): string[] {
  const match = new RegExp(`class="([^"]*)"[^>]*data-testid="${testId}"`).exec(
    html,
  );
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1].split(/\s+/);
}

function declaration(
  css: string,
  classes: string[],
  property: string,
): string | null {
  const camel = property.replace(/-([a-z])/g, (_m, c: string) =>
    c.toUpperCase(),
  );
  const read = (className: string): string | null => {
    const rule = new RegExp(
      `\\.${className}\\{(?:[^}]*;)?${property}:([^;}]+)[;}]`,
    ).exec(css);
    return rule === null ? null : rule[1].trim();
  };
  const atomic = classes.find((name) => name.startsWith(`r-${camel}-`));
  if (atomic !== undefined) {
    const value = read(atomic);
    if (value !== null) return value;
  }
  for (const className of classes) {
    const value = read(className);
    if (value !== null) return value;
  }
  return null;
}

function hasAtomic(classes: string[], property: string): boolean {
  const camel = property.replace(/-([a-z])/g, (_m, c: string) =>
    c.toUpperCase(),
  );
  return classes.some((name) => name.startsWith(`r-${camel}-`));
}

const WIDE = workspaceFor(1440); // 1164 — the rail fits
const NARROW = workspaceFor(1280); // 1004 — it does not

describe("#1501 — the desktop form column + summary rail, in real CSS", () => {
  it("V-0 — VACUITY GUARD: the CSS lookup really resolves declarations", () => {
    const { html, css, showRail } = renderLayout(WIDE);
    expect(showRail).toBe(true);
    expect(css).toContain("max-width");
    const form = classesFor(html, "probe-form");
    // A declaration that MUST be present. If this returns null the suite is
    // unfalsifiable, so it is asserted first and on its own.
    expect(declaration(css, form, "max-width")).toBe(
      `${stayEditorFormMaxWidth}px`,
    );
  });

  it("R-1 — the PAGE releases its cap once the rail fits", () => {
    const wide = renderLayout(WIDE);
    const page = classesFor(wide.html, "probe-page");
    // No cap AT ALL — not "a cap set to undefined", which RNW would keep.
    expect(hasAtomic(page, "max-width")).toBe(false);
    expect(declaration(wide.css, page, "align-self")).toBe("flex-start");

    // ...and below the threshold the editor keeps exactly what it shipped.
    const narrow = renderLayout(NARROW);
    expect(narrow.showRail).toBe(false);
    const narrowPage = classesFor(narrow.html, "probe-page");
    expect(declaration(narrow.css, narrowPage, "max-width")).toBe(
      `${suiteFormMaxWidth}px`,
    );
  });

  it("R-2 — the MEASURE moves onto the form column, it is not abandoned", () => {
    const { html, css } = renderLayout(WIDE);
    const form = classesFor(html, "probe-form");
    // "Fill the space" must never mean a 1,400pt-wide text input.
    expect(declaration(css, form, "max-width")).toBe(
      `${stayEditorFormMaxWidth}px`,
    );
    expect(declaration(css, form, "flex-grow")).toBe("1");
    expect(declaration(css, form, "flex-basis")).toBe("0px");
  });

  it("R-3 — the rail is FIXED width and never steals the form's space", () => {
    const { html, css } = renderLayout(WIDE);
    const rail = classesFor(html, "probe-rail");
    expect(declaration(css, rail, "width")).toBe(
      `${stayEditorSummaryWidth}px`,
    );
    expect(declaration(css, rail, "flex-grow")).toBe("0");
    expect(declaration(css, rail, "flex-shrink")).toBe("0");
  });

  it("R-4 — the split really is a row that top-aligns its two columns", () => {
    const { html, css } = renderLayout(WIDE);
    const body = classesFor(html, "probe-body");
    expect(declaration(css, body, "flex-direction")).toBe("row");
    expect(declaration(css, body, "align-items")).toBe("flex-start");
    expect(declaration(css, body, "column-gap")).toBe(`${spacing.xl}px`);
  });

  it("R-5 — the threshold ARITHMETIC actually holds", () => {
    // At the very threshold the rail is fixed, so the form column keeps
    // whatever is left. That remainder must still be a READABLE measure —
    // splitting into a rail is only worth it if the form stays legible.
    const remainderAtThreshold =
      stayEditorSummaryMinWidth - spacing.xl - stayEditorSummaryWidth;
    expect(remainderAtThreshold).toBeGreaterThanOrEqual(stayProseMaxWidth);

    // At a 1440 viewport the column reaches its FULL measure with room spare:
    // 760 + 32 + 320 = 1112 inside ~1164 of workspace.
    expect(WIDE).toBeGreaterThanOrEqual(
      stayEditorFormMaxWidth + spacing.xl + stayEditorSummaryWidth,
    );
    // A 1440 viewport clears the threshold; a 1280 viewport does not. Those are
    // the two real monitors this decision was made for.
    expect(WIDE).toBeGreaterThanOrEqual(stayEditorSummaryMinWidth);
    expect(NARROW).toBeLessThan(stayEditorSummaryMinWidth);
    // THE POINT OF A CONTAINER QUERY: a 1280 VIEWPORT is above the threshold
    // while its 1004 of actual workspace is below it. A viewport query would
    // have promised a rail that 276px of chrome makes impossible.
    expect(1280).toBeGreaterThan(stayEditorSummaryMinWidth);
    expect(NARROW).toBeLessThan(stayEditorSummaryMinWidth);
  });

  it("R-6 — below the threshold nothing is lost, only stacked", () => {
    const { html, css, showRail } = renderLayout(NARROW);
    expect(showRail).toBe(false);
    const body = classesFor(html, "probe-body");
    // A stacked body is a COLUMN (RN's default, and RNW's base class says so),
    // and the form column takes the full width instead of a flex share.
    expect(declaration(css, body, "flex-direction")).toBe("column");
    const form = classesFor(html, "probe-form");
    expect(declaration(css, form, "width")).toBe("100%");
    expect(hasAtomic(form, "flex-basis")).toBe(false);
  });
});
