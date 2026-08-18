/**
 * #2262 [composer-responsive-layout] T1 — THE BAND CONTRACT, react-test-renderer.
 *
 * # What this suite is for, and what it deliberately is not
 *
 * All 13 pre-existing composer tests are source-greps under `testEnvironment:
 * node`, and 78/78 passed green on the exact commit where a 23px contenteditable
 * sat inside a 480px box and the action row sat 129px under the message box.
 * One of them names the "~23px strip" in its own header. They asserted the
 * SHAPE OF THE PATCH; none asserted a property, so none could fail for the bug
 * it was written about.
 *
 * Every assertion below reads the REAL rendered tree of the REAL components.
 * The one thing mocked is `./richEditor` — deliberately, because the property
 * under test is WHAT THE COMPOSER FEEDS PELL, and a recording stub is the only
 * way to read that. pell's own behaviour is not this suite's claim.
 *
 * FAILS-ON-REVERT (each is a true line deletion, proven at implementation):
 *   - `styles.bodyHost` loses `flex:1` / regains `{height: bodyHeight}` -> T1-a
 *   - `measuredBodyPx` replaced by a constant                            -> T1-b, T1-c
 *   - `initialHeight` re-pointed at the LIVE value                       -> T1-b
 *   - `ComposerCommitBar.styles.desktopHost` restored                    -> T1-d
 *   - the chip stops reading composer state                              -> T1-g
 *   - `active={false}` re-hardcoded on the format glyphs                 -> T1-h
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue2262.render.cjs --runInBand
 */

import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockIsWideDesktop = false;
let mockIsShort = false;
let mockWidth = 390;
jest.mock("../../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: false,
    width: mockWidth,
    isShort: mockIsShort,
  }),
}));

/**
 * The recording stub. It renders NOTHING and captures the props the composer
 * hands pell, so T1-b can assert the exact contract: the FROZEN first
 * measurement on `initialHeight`, the LIVE one on `style.height`.
 */
type RichEditorProps = {
  initialHeight?: number;
  style?: { height?: number };
  onFormatStateChange?: (s: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    link: boolean;
  }) => void;
};
const richEditorProps: RichEditorProps[] = [];
jest.mock("../richEditor", () => {
  const ReactLocal = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as { View: React.ComponentType<object> };
  return {
    __esModule: true,
    actions: {},
    RichEditor: ReactLocal.forwardRef(function MockRichEditor(
      props: RichEditorProps,
      _ref: unknown,
    ) {
      richEditorProps.push(props);
      return ReactLocal.createElement(RN.View, { testID: "mock-rich-editor" });
    }),
  };
});

jest.mock("expo-linear-gradient", () => {
  const ReactLocal = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as { View: React.ComponentType<object> };
  return {
    __esModule: true,
    LinearGradient: (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(RN.View, props),
  };
});

import { StyleSheet, View } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";

import { ComposerCommitBar } from "../../ComposerCommitBar";
import { ComposerV2Editor } from "../ComposerV2Editor";
import { composerSheetMinHeight } from "../../../../constants/designSystem";

const noop = (): void => undefined;

function renderEditor(): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ComposerV2Editor
        initialBodyHtml=""
        subject=""
        onSubjectChange={noop}
        onBodyChange={noop}
        editable
        brandEvents={[]}
        templates={[]}
        previewVariables={{} as never}
        brandName="Acme"
        currentDraftIsDirty={false}
        onErrorToast={noop}
      />,
    );
  });
  return tree;
}

/** Flatten whatever RN would flatten, so the assertion reads the real value. */
function flatten(node: ReactTestInstance): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/**
 * The RESOLVED style of a `Pressable`. `Pressable` takes a `({pressed}) => …`
 * style function, so the composite node's `style` prop is the FUNCTION and
 * flattening it yields nothing. The rendered HOST child carries the resolved
 * array — which is what actually paints, and therefore what an assertion about
 * a rendered fill has to read.
 */
function resolvedStyle(
  tree: TestRenderer.ReactTestRenderer,
  id: string,
): Record<string, unknown> {
  // The HOST node — `typeof n.type === "string"` — is the one that actually
  // paints. The composite above it carries the `({pressed}) => …` function (or
  // no style at all), so reading either would report `undefined` and make this
  // assertion pass for the wrong reason.
  const nodes = tree.root.findAll((n) => n.props?.testID === id);
  const host = nodes.find(
    (n) => typeof n.type === "string" && n.props?.style !== undefined,
  );
  if (host === undefined) {
    throw new Error(`#2262 T1 VACUITY: no resolved style node for testID "${id}".`);
  }
  return flatten(host);
}

function byTestId(
  tree: TestRenderer.ReactTestRenderer,
  id: string,
): ReactTestInstance {
  const found = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.type !== "string",
    { deep: true },
  );
  const host = tree.root.findAll((n) => n.props?.testID === id);
  const node = found[0] ?? host[0];
  if (node === undefined) {
    throw new Error(
      `#2262 T1 VACUITY: testID "${id}" resolved to nothing. Every absence ` +
        `assertion below would pass for the wrong reason. Re-point the suite ` +
        `at the renamed node in the same commit.`,
    );
  }
  return node;
}

beforeEach(() => {
  richEditorProps.length = 0;
  mockIsWideDesktop = false;
  mockIsShort = false;
  mockWidth = 390;
});

describe("#2262 T1 — the composer's band contract", () => {
  it("T1-f VACUITY GUARD: every node this suite asserts about actually resolves", () => {
    const tree = renderEditor();
    // Resolve all three BEFORE any absence claim is evaluated anywhere.
    expect(byTestId(tree, "composer-v2-sheet")).toBeDefined();
    expect(byTestId(tree, "composer-v2-body-host")).toBeDefined();

    let bar!: TestRenderer.ReactTestRenderer;
    act(() => {
      bar = TestRenderer.create(
        <ComposerCommitBar
          onPreview={noop}
          onPickTime={noop}
          sendMode="now"
          scheduledShortLabel={null}
          scheduledLongLabel={null}
          onCommit={noop}
          commitDisabled={false}
        />,
      );
    });
    expect(byTestId(bar, "composer-commit-bar")).toBeDefined();
    expect(byTestId(bar, "composer-commit-bar-primary")).toBeDefined();
  });

  it("T1-a: the body host CLAIMS remaining space and declares no height of its own", () => {
    const tree = renderEditor();
    const body = flatten(byTestId(tree, "composer-v2-body-host"));

    expect(body.flex).toBe(1);
    expect(body.minHeight).toBe(0);
    // `{ height: bodyHeight }` here is the defect verbatim: a viewport-derived
    // number applied as a FIXED height, with the action row stacked below it.
    expect(body.height).toBeUndefined();
    expect(body.maxHeight).toBeUndefined();
  });

  it("T1-a2: the sheet is a flexed child with a FLOOR, never a computed height", () => {
    const tree = renderEditor();
    const sheet = flatten(byTestId(tree, "composer-v2-sheet"));

    expect(sheet.flex).toBe(1);
    // A `minHeight` bound on a flexed child participates in no subtraction and
    // reads no viewport — the D-4 distinction that makes it legal at all.
    expect(sheet.minHeight).toBe(composerSheetMinHeight);
    expect(composerSheetMinHeight).toBe(240);
    expect(sheet.height).toBeUndefined();
    // The clip that keeps a grown sheet inside its band.
    expect(sheet.overflow).toBe("hidden");
  });

  it("T1-c: pell does not mount until a real measurement exists — no default, no fallback", () => {
    const tree = renderEditor();
    // Before any onLayout: zero RichEditor nodes. There is no `?? 240`.
    expect(richEditorProps).toHaveLength(0);
    expect(tree.root.findAll((n) => n.props?.testID === "mock-rich-editor")).toHaveLength(0);
  });

  it("T1-b: the FIRST measurement is frozen on initialHeight; the LIVE one drives style.height", () => {
    const tree = renderEditor();
    const body = byTestId(tree, "composer-v2-body-host");

    act(() => {
      (body.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { height: 517, width: 358, x: 0, y: 0 } },
      });
    });
    expect(richEditorProps.length).toBeGreaterThan(0);
    const first = richEditorProps[richEditorProps.length - 1];
    expect(first.initialHeight).toBe(517);
    expect(first.style?.height).toBe(517);

    // The keyboard opens: the sheet shrinks, onLayout fires again.
    act(() => {
      (body.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { height: 305, width: 358, x: 0, y: 0 } },
      });
    });
    const second = richEditorProps[richEditorProps.length - 1];
    // `initialHeight` must NOT track. pell reads it once for the WebView's
    // initial style; feeding it a changing value risks a remount, and a pell
    // remount CLOBBERS THE OPERATOR'S IN-PROGRESS DRAFT.
    expect(second.initialHeight).toBe(517);
    expect(second.style?.height).toBe(305);
  });

  it("T1-b2: a zero or negative measurement is never published to pell", () => {
    const tree = renderEditor();
    const body = byTestId(tree, "composer-v2-body-host");
    act(() => {
      (body.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { height: 0, width: 358, x: 0, y: 0 } },
      });
    });
    expect(richEditorProps).toHaveLength(0);
  });

  it("T1-d: the commit bar is flexShrink:0 and position-free at EVERY width", () => {
    for (const wide of [true, false]) {
      mockIsWideDesktop = wide;
      mockWidth = wide ? 1440 : 390;
      let bar!: TestRenderer.ReactTestRenderer;
      act(() => {
        bar = TestRenderer.create(
          <ComposerCommitBar
            onPreview={noop}
            onPickTime={noop}
            sendMode="now"
            scheduledShortLabel={null}
            scheduledLongLabel={null}
            onCommit={noop}
            commitDisabled={false}
          />,
        );
      });
      const host = flatten(byTestId(bar, "composer-commit-bar"));
      expect(host.flexShrink).toBe(0);
      // RC-3: `desktopHost: { position: "absolute", bottom }` overlapped the
      // message box by 129px at 1024x700 and floated 285px from the SMS card's
      // last control at 1440x900. One contract, five surfaces.
      expect(host.position).toBeUndefined();
      // `insets.bottom` reads 0 on mobile web; a bare inset would put the bar
      // flush against browser chrome. The stub reports 0 insets, so the
      // Math.max floor is what has to show up.
      expect(host.paddingBottom).toBe(16);
    }
  });

  it("T1-g: the mode chip renders the chosen time and the primary flips to Schedule", () => {
    let bar!: TestRenderer.ReactTestRenderer;
    act(() => {
      bar = TestRenderer.create(
        <ComposerCommitBar
          onPreview={noop}
          onPickTime={noop}
          sendMode="now"
          scheduledShortLabel={null}
          scheduledLongLabel={null}
          onCommit={noop}
          commitDisabled={false}
        />,
      );
    });
    const labelOf = (r: TestRenderer.ReactTestRenderer, id: string): string =>
      byTestId(r, id)
        .findAllByType("Text" as never)
        .map((t: ReactTestInstance) => t.children.join(""))
        .join(" ");

    expect(labelOf(bar, "composer-commit-bar-mode-chip")).toContain("Now");
    expect(labelOf(bar, "composer-commit-bar-primary")).toContain("Send now");

    // The operator picked a time, then BACKED OUT of the review sheet. The
    // choice is composer state and survives — which is the entire reason the
    // chip exists; today the choice was invisible on the composer and could
    // only be re-checked by re-entering the picker.
    act(() => {
      bar.update(
        <ComposerCommitBar
          onPreview={noop}
          onPickTime={noop}
          sendMode="scheduled"
          scheduledShortLabel="Thu 10:00"
          scheduledLongLabel="Thursday, October 9 at 10:00 AM"
          onCommit={noop}
          commitDisabled={false}
        />,
      );
    });
    expect(labelOf(bar, "composer-commit-bar-mode-chip")).toContain("Thu 10:00");
    expect(labelOf(bar, "composer-commit-bar-primary")).toContain("Schedule");
    expect(byTestId(bar, "composer-commit-bar-mode-chip").props.accessibilityLabel).toContain(
      "Thursday, October 9 at 10:00 AM",
    );
  });

  it("T1-g2: a disabled primary states the reason instead of being a dead shape", () => {
    let bar!: TestRenderer.ReactTestRenderer;
    act(() => {
      bar = TestRenderer.create(
        <ComposerCommitBar
          onPreview={noop}
          onPickTime={noop}
          sendMode="now"
          scheduledShortLabel={null}
          scheduledLongLabel={null}
          onCommit={noop}
          commitDisabled
          blockedReason="Pick an audience first."
        />,
      );
    });
    const caption = byTestId(bar, "composer-commit-bar-caption");
    expect(caption.findAllByType("Text" as never).map((t: ReactTestInstance) => t.children.join("")).join(" ")).toContain(
      "Pick an audience first.",
    );
    // The screen reader gets it on focus regardless of where the eye is.
    expect(byTestId(bar, "composer-commit-bar-primary").props.accessibilityHint).toBe(
      "Pick an audience first.",
    );
  });

  it("T1-h: the selection channel is wired end to end, and NATIVE renders no active fill", () => {
    // Asserting the prop is not enough: `active={someAlwaysFalseThing}` would
    // satisfy a prop check while remaining a state that can never fire — the UI
    // form of a check that carries no information (#2113's class, in UI form).
    //
    // This suite runs with `haste.defaultPlatform: "ios"`, i.e. NATIVE. Two
    // properties are asserted here, and they are the operator's own decision:
    //   1. the publish channel EXISTS and is handed to the editor;
    //   2. on native, flipping it changes NOTHING on screen — because
    //      `COMPOSER_SELECTION_TRACKER_JS` saves the range inside the pell
    //      WebView's own `window` and posts nothing back, so a native active
    //      fill could never fire. An affordance that cannot reflect state is
    //      worse than no affordance.
    // The VISIBLE fill change is asserted on web by the web-render suite.
    const tree = renderEditor();
    const body = byTestId(tree, "composer-v2-body-host");
    act(() => {
      (body.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { height: 400, width: 358, x: 0, y: 0 } },
      });
    });

    const boldFillBefore = resolvedStyle(tree, "composer-v2-format-bold").backgroundColor;
    expect(boldFillBefore).toBe("transparent"); // vacuity: the glyph really rendered

    const publish = richEditorProps[richEditorProps.length - 1].onFormatStateChange;
    expect(typeof publish).toBe("function");
    act(() => {
      publish?.({ bold: true, italic: false, underline: false, link: false });
    });

    const boldFillAfter = resolvedStyle(tree, "composer-v2-format-bold").backgroundColor;
    expect(boldFillAfter).toBe("transparent");

    // And the four literals are gone for good: `accessibilityState.selected`
    // reports the real toggle trait rather than the `expanded` a disclosure uses.
    const glyph = tree.root.findAll(
      (n) => n.props?.testID === "composer-v2-format-bold" && n.props?.accessibilityState,
    )[0];
    expect(glyph.props.accessibilityState).toEqual({ selected: false });
  });

  it("T1-e: nothing inside the sheet can grow past it — the sheet is what gives", () => {
    const tree = renderEditor();
    const sheet = byTestId(tree, "composer-v2-sheet");
    const bodyHost = byTestId(tree, "composer-v2-body-host");
    const toolbar = byTestId(tree, "composer-v2-insertion-bar");

    // The toolbar is a CHILD of the sheet, not a peer above the body: its 44pt
    // is part of the sheet's height, so `measuredBodyPx` is automatically net of
    // it wherever it sits. That is why moving it cost the height model nothing.
    const sheetDescendants = sheet.findAll(() => true, { deep: true });
    expect(sheetDescendants).toContain(toolbar);
    expect(sheetDescendants).toContain(bodyHost);

    // The toolbar cannot be squeezed; the body is the one flexible region.
    expect(flatten(toolbar).flexShrink).toBe(0);
    expect(flatten(bodyHost).flex).toBe(1);
  });
});

/** Keeps the unused-import checker honest about the `View` type reference. */
export type _BandContractProbe = View;
