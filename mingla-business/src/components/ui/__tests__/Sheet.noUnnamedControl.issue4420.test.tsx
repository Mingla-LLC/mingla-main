/* eslint-disable import/first */
// #4420 — an open sheet exposes no control without an accessible name.
//
// react-native-web's Modal wraps its content in a focus trap that renders two
// empty `<div role="presentation" tabindex="0">` sentinels. Every web sheet
// therefore showed an unnamed focusable control beside the labelled
// "Dismiss sheet" scrim button. The sheets now hide those sentinels from the
// accessibility tree (aria-hidden) while leaving them focusable for the trap.
//
// Behaviour proven here:
//   - hideModalFocusBrackets marks BOTH sentinels aria-hidden when handed any
//     node inside the trap, and touches nothing when the siblings are not
//     sentinels (so it cannot hide a real control).
//   - The REAL wide-desktop Sheet.web hands its content node to that helper
//     (a fake trap DOM is supplied as the host ref), so the sentinels end up
//     hidden on mount.
//   - Every pressable the sheet renders itself carries an accessibility label.
//
// FAILS-ON-REVERT: drop the `ref` from Sheet.web's Modal content and the mount
// test goes red; strip a label from a pressable and the label audit goes red.

// MINGLA-INVARIANT: I-4420-SHEET-NO-UNNAMED-CONTROL | issue #4420 | A sheet exposes no focusable control without an accessible name: the Modal focus-trap sentinels are aria-hidden and every pressable the sheet renders carries an accessibilityLabel.

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: true }),
}));
jest.mock("../escapeLayerStack", () => ({ useEscapeLayer: () => undefined }));
// TEST-MOD-APPROVED #4490 D6 — the desktop Sheet now mounts an overlay ToastHost
// (toasts draw above the sheet); its reanimated Toast is not needed here.
// #4508 T4: the desktop card now mounts its own ToastHost (above the card);
// this suite isolates the card, so the toast layer (reanimated) is stubbed.
jest.mock("../ToastHost", () => ({ ToastHost: () => null }));
jest.mock("../SheetMobile", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sheet: (props: { children: React.ReactNode }) => require("react").createElement("MobileSheetProbe", null, props.children),
  SHEET_TOP_INSET: 24,
  SHEET_SIDE_GUTTER: 20,
  WEB_OPAQUE_BACKGROUND: "#16181b",
}));

import { hideModalFocusBrackets } from "../hideModalFocusBrackets";
import { Sheet } from "../Sheet.web";

interface FakeEl {
  attrs: Record<string, string>;
  childElementCount: number;
  previousElementSibling: FakeEl | null;
  nextElementSibling: FakeEl | null;
  parentElement: FakeEl | null;
  getAttribute: (n: string) => string | null;
  setAttribute: (n: string, v: string) => void;
}

const el = (attrs: Record<string, string> = {}, childElementCount = 0): FakeEl => {
  const self: FakeEl = {
    attrs: { ...attrs },
    childElementCount,
    previousElementSibling: null,
    nextElementSibling: null,
    parentElement: null,
    getAttribute: (n) => (n in self.attrs ? self.attrs[n] : null),
    setAttribute: (n, v) => {
      self.attrs[n] = v;
    },
  };
  return self;
};
const bracket = (): FakeEl => el({ role: "presentation", tabindex: "0" });

/** The DOM react-native-web's ModalFocusTrap produces: [bracket, trap > content, bracket]. */
const fakeTrap = (): { before: FakeEl; after: FakeEl; content: FakeEl } => {
  const before = bracket();
  const after = bracket();
  const trap = el({}, 1);
  const content = el();
  content.parentElement = trap;
  before.nextElementSibling = trap;
  trap.previousElementSibling = before;
  trap.nextElementSibling = after;
  after.previousElementSibling = trap;
  return { before, after, content };
};

describe("#4420 hideModalFocusBrackets", () => {
  test("hides both focus-trap sentinels from the accessibility tree and keeps them focusable", () => {
    const { before, after, content } = fakeTrap();
    hideModalFocusBrackets(content);
    expect(before.attrs["aria-hidden"]).toBe("true");
    expect(after.attrs["aria-hidden"]).toBe("true");
    expect(before.attrs.tabindex).toBe("0");
    expect(after.attrs.tabindex).toBe("0");
  });

  test("never hides siblings that are real controls", () => {
    const { before, after, content } = fakeTrap();
    before.attrs.role = "button";
    after.attrs["aria-label"] = "Close";
    after.childElementCount = 1;
    hideModalFocusBrackets(content);
    expect(before.attrs["aria-hidden"]).toBeUndefined();
    expect(after.attrs["aria-hidden"]).toBeUndefined();
  });

  test("is a no-op for a missing node (native)", () => {
    expect(() => hideModalFocusBrackets(null)).not.toThrow();
    expect(() => hideModalFocusBrackets(undefined)).not.toThrow();
  });
});

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement, options?: { createNodeMock?: (e: unknown) => unknown }) => { root: Node };
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

const mountSheet = async (content: FakeEl): Promise<Node> => {
  let tree: { root: Node } | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <Sheet visible onClose={() => undefined} testID="probe">
        <React.Fragment>{React.createElement("Text", null, "Manage event")}</React.Fragment>
      </Sheet>,
      // Every host ref (the Modal content View) resolves to the fake trap node.
      { createNodeMock: () => content },
    );
  });
  return (tree as { root: Node }).root;
};

describe("#4420 the real wide-desktop Sheet", () => {
  test("hides the Modal focus-trap sentinels when it mounts", async () => {
    const { before, after, content } = fakeTrap();
    await mountSheet(content);
    expect(before.attrs["aria-hidden"]).toBe("true");
    expect(after.attrs["aria-hidden"]).toBe("true");
  });

  test("every pressable the sheet renders has an accessible name", async () => {
    const root = await mountSheet(fakeTrap().content);
    const pressables = root.findAll(
      (n) =>
        typeof n.type === "string" &&
        (n.props.accessibilityRole === "button" || typeof n.props.onPress === "function"),
    );
    // The scrim dismiss button is always present, so the audit is never vacuous.
    expect(pressables.length).toBeGreaterThan(0);
    const unnamed = pressables.filter((n) => {
      const label = n.props.accessibilityLabel;
      return typeof label !== "string" || label.trim() === "";
    });
    expect(unnamed).toHaveLength(0);
  });
});
