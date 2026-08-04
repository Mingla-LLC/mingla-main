/**
 * Issue #1501 [add-rooms-form] — THE AXIS PROOF, THROUGH THE REAL
 * react-native-web STYLE COMPILER.
 *
 * WHY A SECOND SUITE EXISTS. `stayFieldAxis.issue1501.render.test.tsx` reads
 * the style OBJECT react-native selects. That is necessary and not sufficient:
 * #1484 shipped a broken desktop uncap while 29 green react-test-renderer
 * suites watched, because `react-native`'s `StyleSheet.flatten` and
 * `react-native-web`'s ATOMIC CLASS resolver disagree about what actually
 * reaches the DOM. Anything WIDTH-related has to be asserted against the
 * resolver that really ships on desktop web.
 *
 * So: `react-native` -> `react-native-web`, rendered via ReactDOMServer, and
 * every assertion reads the EMITTED CSS — the same artefacts a tester would
 * read out of the live browser's computed styles.
 *
 * VACUITY GUARD (V-0). Every "this declaration is ABSENT" assertion is
 * unfalsifiable if the CSS lookup silently matched nothing. V-0 proves the
 * lookup machinery resolves a declaration that MUST be present on the very same
 * element before any absence is claimed, and every absence test re-checks its
 * own anchor. Without it, renaming a testID would turn this whole suite green.
 *
 * FAILS-ON-REVERT: restore `fieldStack` to `{ flex: 1, minWidth: 140, gap }`
 * (a true line edit) -> the stacked wrapper starts emitting `r-flexGrow-*` /
 * `r-flexShrink-*` / `r-flexBasis-*` atoms and W-1 FAILS.
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

let mockIsWideDesktop = true;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: true,
    width: mockIsWideDesktop ? 1440 : 390,
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

import {
  stayFieldNumMaxWidth,
  stayProseMaxWidth,
} from "../../../constants/designSystem";
import { OfferingEditor } from "../StayInventoryManager";

const { AppRegistry } = jest.requireActual("react-native-web") as {
  AppRegistry: {
    registerComponent: (name: string, factory: () => unknown) => void;
    getApplication: (name: string) => {
      element: React.ReactElement;
      getStyleElement: () => React.ReactElement;
    };
  };
};

let renderCount = 0;
const EditorWrapper = (): React.ReactElement => (
  <OfferingEditor
    brandId="brand-1501"
    venueId="venue-1501"
    existing={null}
    canManageInventory
    canManageFinance
    onClose={(): void => undefined}
  />
);

function renderWeb(): { html: string; css: string } {
  const name = `Issue1501_${renderCount++}`;
  AppRegistry.registerComponent(name, () => EditorWrapper);
  const app = AppRegistry.getApplication(name);
  return {
    html: ReactDOMServer.renderToStaticMarkup(app.element),
    css: ReactDOMServer.renderToStaticMarkup(app.getStyleElement()),
  };
}

/** Resolve the class list of the element carrying `data-testid="<id>"`. */
function classesFor(html: string, testId: string): string[] {
  const match = new RegExp(
    `class="([^"]*)"[^>]*data-testid="${testId}"`,
  ).exec(html);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1].split(/\s+/);
}

/**
 * Resolve a CSS declaration for an element, targeting react-native-web's
 * ATOMIC override class (`flex-basis` -> `r-flexBasis-<hash>`) before falling
 * back to the base `css-view-*` class. A naive "first class mentioning the
 * property" lookup reports the BASE (`flex-basis:auto`) and masks the real
 * value — the #1484 mistake in miniature.
 */
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

/** True when RNW emitted an ATOMIC override for `property` on this element. */
function hasAtomic(classes: string[], property: string): boolean {
  const camel = property.replace(/-([a-z])/g, (_m, c: string) =>
    c.toUpperCase(),
  );
  return classes.some((name) => name.startsWith(`r-${camel}-`));
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1501 — axis-scoped field measures survive the RNW resolver", () => {
  it("V-0 — VACUITY GUARD: the CSS lookup really resolves declarations", () => {
    const { html, css } = renderWeb();

    // The markup exists at all.
    expect(html.length).toBeGreaterThan(0);
    expect(css).toContain("max-width");

    // The exact element every absence assertion below reads.
    const stacked = classesFor(html, "stay-offering-description-field");
    expect(stacked.length).toBeGreaterThan(0);

    // A declaration that MUST be present on it. If this ever returns null the
    // whole suite is unfalsifiable, so it is asserted FIRST and separately.
    expect(declaration(css, stacked, "width")).toBe("100%");
  });

  it("W-1 — the STACKED field emits NO flex-axis atom (the shipped bug)", () => {
    const { html, css } = renderWeb();
    const stacked = classesFor(html, "stay-offering-description-field");

    // Per-test anchor, so W-1 cannot pass by matching nothing.
    expect(declaration(css, stacked, "width")).toBe("100%");

    // `flex: 1` on a column child means "share the HEIGHT". Under RNW that is
    // emitted as flex-grow/flex-shrink/flex-basis atoms; none may exist here.
    for (const property of ["flex-grow", "flex-shrink", "flex-basis"]) {
      expect({ property, atomic: hasAtomic(stacked, property) }).toEqual({
        property,
        atomic: false,
      });
    }
  });

  it("W-2 — the NUMERIC field in a row emits an EXPLICIT measure", () => {
    const { html, css } = renderWeb();
    const numeric = classesFor(html, "stay-offering-quantity-field");

    // [TEST-MOD-APPROVED #1501] — retuned for the P2-2 phone-pair fix. The
    // measure is still explicit and still emitted; it moved from `flex-basis`
    // to `max-width` over a zero basis, because a basis of the desktop width
    // made `flex-wrap` break the line before any shrinking and stacked both
    // numeric pairs on every phone.
    expect(hasAtomic(numeric, "flex-basis")).toBe(true);
    expect(declaration(css, numeric, "flex-basis")).toBe("0px");
    expect(declaration(css, numeric, "max-width")).toBe(
      `${stayFieldNumMaxWidth}px`,
    );
    // It shares the line and grows into the cap — it never demands the cap.
    expect(declaration(css, numeric, "flex-grow")).toBe("1");
  });

  it("W-3 — the row wrapper really wraps and top-aligns in the browser", () => {
    const { html, css } = renderWeb();
    const row = classesFor(html, "stay-offering-count-row");

    expect(declaration(css, row, "flex-direction")).toBe("row");
    expect(declaration(css, row, "flex-wrap")).toBe("wrap");
    expect(declaration(css, row, "align-items")).toBe("flex-start");
  });

  it("W-4 — PROSE inputs really carry the readable-measure cap", () => {
    const { html, css } = renderWeb();
    const description = classesFor(html, "stay-offering-description");
    expect(declaration(css, description, "max-width")).toBe(
      `${stayProseMaxWidth}px`,
    );

    // ...and a single-line field is NOT capped, so the cap is a deliberate
    // prose rule rather than a blanket one.
    const name = classesFor(html, "stay-offering-name");
    expect(hasAtomic(name, "max-width")).toBe(false);
  });
});
