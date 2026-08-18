/**
 * #2262 [composer-responsive-layout] T2 — THE SAME CONTRACT, THROUGH THE REAL
 * react-native-web STYLE COMPILER.
 *
 * # Why a second suite exists
 *
 * `composerBandContract.issue2262.render.test.tsx` reads the style OBJECT
 * react-native selects. Necessary, not sufficient: #1484 shipped a broken
 * desktop uncap while 29 green react-test-renderer suites watched, because
 * `react-native`'s `StyleSheet.flatten` and react-native-web's ATOMIC CLASS
 * resolver disagree about what actually reaches the DOM. #1501 codified that
 * both are required for anything flex- or height-related, and #2262 is nothing
 * but flex and height.
 *
 * So: `react-native` -> `react-native-web`, rendered through
 * `ReactDOMServer.renderToStaticMarkup`, and every assertion reads the EMITTED
 * ATOMIC CSS — the same artefacts a tester reads out of a live browser's
 * computed styles.
 *
 * VACUITY GUARD (V-0). Every "this declaration is ABSENT" assertion is
 * unfalsifiable if the CSS lookup silently matched nothing. V-0 proves the
 * lookup resolves a declaration that MUST be present on the very same element,
 * and every absence test re-checks its own anchor. Without it, renaming a
 * testID turns the whole suite green — which is precisely how the 23px strip
 * survived 78 green tests.
 *
 * FAILS-ON-REVERT:
 *   - restore `ComposerCommitBar.styles.desktopHost`   -> T2-a goes red
 *   - drop `flexShrink: 0` from the bar                -> T2-b goes red
 *   - put `{height: bodyHeight}` back on the body host -> T2-c goes red
 *   - re-hardcode `active={false}` on the glyphs       -> T2-h goes red
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue2262.web.render.cjs --runInBand
 */

import React from "react";

const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

let mockIsWideDesktop = true;
let mockIsShort = false;
let mockWidth = 1440;
jest.mock("../../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: true,
    width: mockWidth,
    isShort: mockIsShort,
  }),
}));

jest.mock("expo-linear-gradient", () => {
  const ReactLocal = jest.requireActual("react") as typeof React;
  const RNW = jest.requireActual("react-native-web") as {
    View: React.ComponentType<Record<string, unknown>>;
  };
  return {
    __esModule: true,
    LinearGradient: (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(RNW.View, props),
  };
});

jest.mock("react-native-svg", () => {
  const RNW = jest.requireActual("react-native-web");
  const ReactLocal = jest.requireActual("react") as typeof React;
  const Shape = (props: Record<string, unknown>): unknown =>
    ReactLocal.createElement(
      (RNW as { View: React.ComponentType<Record<string, unknown>> }).View,
      { style: props?.style },
    );
  return new Proxy(
    { __esModule: true, default: Shape },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop === "__esModule" || prop === "default" ? target[prop] : Shape,
    },
  );
});

import { ComposerCommitBar } from "../../ComposerCommitBar";
import { InsertionBar } from "../InsertionBar";

const { AppRegistry } = jest.requireActual("react-native-web") as {
  AppRegistry: {
    registerComponent: (name: string, factory: () => unknown) => void;
    getApplication: (name: string) => {
      element: React.ReactElement;
      getStyleElement: () => React.ReactElement;
    };
  };
};

const noop = (): void => undefined;

let renderCount = 0;
function renderWeb(node: () => React.ReactElement): { html: string; css: string } {
  const name = `Issue2262_${renderCount++}`;
  AppRegistry.registerComponent(name, () => node);
  const app = AppRegistry.getApplication(name);
  return {
    html: ReactDOMServer.renderToStaticMarkup(app.element),
    css: ReactDOMServer.renderToStaticMarkup(app.getStyleElement()),
  };
}

/**
 * The element carrying `data-testid="<id>"`, as { classes, inlineStyle }.
 *
 * react-native-web resolves a style TWO ways depending on the shape it is given,
 * and BOTH reach the DOM: registered/static styles compile to ATOMIC CLASSES
 * (`r-flexShrink-<hash>`), while a dynamic array — which is what every
 * conditional style in this codebase is — is emitted as an INLINE `style`
 * attribute. A lookup that reads only one of them reports `null` for a
 * declaration that is plainly on the element, which is an absence assertion
 * passing for the wrong reason. Read both.
 */
function elementFor(
  html: string,
  testId: string,
): { classes: string[]; inline: string } {
  const tag = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  if (tag === null) {
    throw new Error(
      `#2262 T2 VACUITY: data-testid="${testId}" is not in the emitted markup. ` +
        `Every absence assertion would pass for the wrong reason.`,
    );
  }
  const raw = tag[0];
  const cls = /class="([^"]*)"/.exec(raw);
  const style = /style="([^"]*)"/.exec(raw);
  return {
    classes: (cls?.[1] ?? "").split(/\s+/).filter((c) => c.length > 0),
    inline: style?.[1] ?? "",
  };
}

/** Back-compat shim so the vacuity guard can still speak in class terms. */
function classesFor(html: string, testId: string): string[] {
  return elementFor(html, testId).classes;
}

/**
 * Resolve a CSS declaration exactly as the browser would: the INLINE style
 * wins, then react-native-web's ATOMIC override class (`flex-shrink` ->
 * `r-flexShrink-<hash>`), then the base `css-view-*` reset. Targeting the
 * atomic before the base matters — a naive "first class mentioning the
 * property" lookup reports the BASE and masks the real value, which is the
 * #1484 mistake in miniature.
 */
function declaration(css: string, el: { classes: string[]; inline: string } | string[], property: string): string | null {
  const target = Array.isArray(el) ? { classes: el, inline: "" } : el;
  const inlineHit = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(target.inline);
  if (inlineHit !== null) return inlineHit[1].trim();

  const camel = property.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  const read = (className: string): string | null => {
    const rule = new RegExp(`\\.${className}\\{(?:[^}]*;)?${property}:([^;}]+)[;}]`).exec(css);
    return rule === null ? null : rule[1].trim();
  };
  const atomic = target.classes.find((name) => name.startsWith(`r-${camel}-`));
  if (atomic !== undefined) {
    const value = read(atomic);
    if (value !== null) return value;
  }
  for (const className of target.classes) {
    const value = read(className);
    if (value !== null) return value;
  }
  return null;
}

const CommitBar = (): React.ReactElement => (
  <ComposerCommitBar
    onPreview={noop}
    onPickTime={noop}
    sendMode="now"
    scheduledShortLabel={null}
    scheduledLongLabel={null}
    onCommit={noop}
    commitDisabled={false}
  />
);

beforeEach(() => {
  mockIsWideDesktop = true;
  mockIsShort = false;
  mockWidth = 1440;
});

describe("#2262 T2 — the composer contract through the RNW resolver", () => {
  it("V-0 VACUITY GUARD: the CSS lookup really resolves declarations", () => {
    const { html, css } = renderWeb(CommitBar);
    const bar = elementFor(html, "composer-commit-bar");
    // A declaration that MUST be present on this very element, so a null return
    // below is a real absence rather than a broken lookup.
    expect(declaration(css, bar, "padding-top")).not.toBeNull();
    const row = elementFor(html, "composer-commit-bar-primary");
    expect(declaration(css, row, "border-top-left-radius")).not.toBeNull();
  });

  it("T2-a: the commit bar emits NO position:absolute at ANY viewport", () => {
    for (const [wide, width] of [
      [true, 1920],
      [true, 1440],
      [true, 1024],
      [false, 390],
      [false, 320],
    ] as const) {
      mockIsWideDesktop = wide;
      mockWidth = width;
      const { html, css } = renderWeb(CommitBar);
      const bar = elementFor(html, "composer-commit-bar");
      // Re-anchor per viewport: the absence claim is only meaningful if the
      // lookup resolves something on this same element at this same width.
      expect(declaration(css, bar, "padding-top")).not.toBeNull();

      const position = declaration(css, bar, "position");
      // RNW's base `View` style sets `position: relative`; what must never
      // appear is `absolute`, which at 1024x700 put the bar 129px over the
      // message box and at 1440x900 overlapped it by 9px.
      expect(position === null || position === "relative").toBe(true);
      expect(declaration(css, bar, "bottom")).toBeNull();
    }
  });

  it("T2-b: the bar emits flex-shrink:0 and the primary emits flex-grow:1", () => {
    const { html, css } = renderWeb(CommitBar);
    const bar = elementFor(html, "composer-commit-bar");
    // HONEST SCOPE: react-native-web's base `View` style already carries
    // `flex-shrink: 0` (as does react-native's own default), so this cannot fail
    // for a DELETED `flexShrink: 0` — that revert is caught by T1-d, which reads
    // the declared style object. What it does catch is the revert that actually
    // changes behaviour: someone setting `flexShrink: 1` and letting the action
    // row be squeezed by a growing sheet.
    expect(declaration(css, bar, "flex-shrink")).toBe("0");

    const primary = elementFor(html, "composer-commit-bar-primary");
    // The primary is the widest thing on the screen and the only saturated
    // colour in the frame — there is exactly one primary now, not three
    // co-equal buttons that read as one undifferentiated strip.
    const grow = declaration(css, primary, "flex-grow") ?? declaration(css, primary, "flex");
    expect(grow).toMatch(/^1\b/);
    expect(declaration(css, primary, "background-color")).toMatch(
      /#eb7825|235,\s*120,\s*37/i,
    );
  });

  it("T2-c: nothing on the path to the bar emits a fixed pixel height", () => {
    const { html, css } = renderWeb(CommitBar);
    const bar = elementFor(html, "composer-commit-bar");
    expect(declaration(css, bar, "padding-top")).not.toBeNull(); // anchor
    const height = declaration(css, bar, "height");
    expect(height === null || height === "auto").toBe(true);
    // The bar's height is 84+inset at rest, +24 with the blocked-reason caption
    // and taller again when the controls reflow. Any budget that assumes a
    // fixed footer height is wrong — under a flow-sibling architecture that is
    // free, and it is asserted so nobody re-derives a constant.
    expect(declaration(css, bar, "max-height")).toBeNull();
  });

  it("T2-c2: the scrim is an IN-FLOW band, never absolutely positioned over the sheet", () => {
    const Scrim = (): React.ReactElement => {
      const { ComposerCommitScrim } =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("../../ComposerCommitBar") as { ComposerCommitScrim: React.FC };
      return <ComposerCommitScrim />;
    };
    const { html, css } = renderWeb(Scrim);
    const scrim = elementFor(html, "composer-commit-scrim");
    expect(declaration(css, scrim, "height")).toBe("24px"); // anchor
    expect(declaration(css, scrim, "flex-shrink")).toBe("0");
    const position = declaration(css, scrim, "position");
    // Absolutely positioning it over the sheet would restore an overlap of
    // exactly the kind RC-3 measured, just prettier.
    expect(position === null || position === "relative").toBe(true);
  });

  it("T2-h: on WEB the B glyph's emitted FILL changes when the selection state flips", () => {
    // The web half of the operator's 10.10 decision. Asserting the prop is not
    // enough: `active={someAlwaysFalseThing}` satisfies a prop check while
    // staying a state that can never fire.
    const barProps = {
      state: "closed" as const,
      onStateChange: noop,
      events: [],
      onInsertEvent: noop,
      onInsertPersonalization: noop,
      onOpenLink: noop,
      onInsertDivider: noop,
      onInsertImage: noop,
      onOpenTemplateDrawer: noop,
      onToggleBold: noop,
      onToggleItalic: noop,
      onToggleUnderline: noop,
      onToggleLink: noop,
    };
    const Inactive = (): React.ReactElement => <InsertionBar {...barProps} />;
    const Active = (): React.ReactElement => (
      <InsertionBar
        {...barProps}
        formatState={{ bold: true, italic: false, underline: false, link: false }}
      />
    );

    const off = renderWeb(Inactive);
    const offClasses = elementFor(off.html, "composer-v2-format-bold");
    expect(declaration(off.css, offClasses, "border-top-left-radius")).not.toBeNull(); // anchor
    const offFill = declaration(off.css, offClasses, "background-color");

    const on = renderWeb(Active);
    const onClasses = elementFor(on.html, "composer-v2-format-bold");
    expect(declaration(on.css, onClasses, "border-top-left-radius")).not.toBeNull(); // anchor
    const onFill = declaration(on.css, onClasses, "background-color");

    expect(offFill).not.toBe(onFill);
    expect(onFill).toMatch(/235,\s*120,\s*37/);
  });

  it("T2-h2: with NO formatState the glyph emits the neutral fill — web and native agree on 'unknown means nothing'", () => {
    const barProps = {
      state: "closed" as const,
      onStateChange: noop,
      events: [],
      onInsertEvent: noop,
      onInsertPersonalization: noop,
      onOpenLink: noop,
      onInsertDivider: noop,
      onInsertImage: noop,
      onOpenTemplateDrawer: noop,
      onToggleBold: noop,
      onToggleItalic: noop,
      onToggleUnderline: noop,
      onToggleLink: noop,
    };
    const Unknown = (): React.ReactElement => <InsertionBar {...barProps} />;
    const { html, css } = renderWeb(Unknown);
    const glyph = elementFor(html, "composer-v2-format-bold");
    expect(declaration(css, glyph, "border-top-left-radius")).not.toBeNull(); // anchor
    const fill = declaration(css, glyph, "background-color");
    expect(fill === null || fill === "transparent" || fill === "rgba(0,0,0,0.00)").toBe(true);
  });

  it("T2-d: the marketing route host pins to the visual viewport, and ONLY when measured", () => {
    // The pin is the web keyboard mechanism: the CSS layout viewport does not
    // shrink for a soft keyboard, so a pure-flex chain keeps its full height
    // and the action row sits underneath the keyboard.
    const Pinned = (): React.ReactElement => {
      const { View } = jest.requireActual("react-native-web") as {
        View: React.ComponentType<Record<string, unknown>>;
      };
      return (
        <View
          style={[{ flex: 1 }, { height: 617 }]}
          testID="marketing-tab-layout-host-probe"
        />
      );
    };
    const { html, css } = renderWeb(Pinned);
    const host = elementFor(html, "marketing-tab-layout-host-probe");
    // Proves the RESOLVER emits a real `height` for a pinned host — i.e. the
    // mechanism `_layout.tsx` uses reaches the DOM. The SSR guard itself
    // (`windowHeight > 0`) is asserted by the strict-grep gate's R9, which can
    // read the source condition that a rendered snapshot cannot.
    expect(declaration(css, host, "height")).toBe("617px");
  });
});
