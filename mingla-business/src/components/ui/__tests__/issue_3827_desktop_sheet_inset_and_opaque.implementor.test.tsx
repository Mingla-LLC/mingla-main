/* eslint-disable import/first */
// issue #3827 — every wide-desktop dialog keeps breathing room above its first
// line, and no dialog lets the screen beneath show through.
//
// Mounts the REAL wide-desktop branch of `Sheet.web.tsx` (the shared primitive
// every Host sheet renders through on desktop web) with the lightweight
// react-native mock, and the bottom sheet stubbed (it is not under test here).
//
//   - The card body carries `paddingTop: SHEET_TOP_INSET`, the same band the
//     phone sheet reserves with its drag handle. Before the fix the body had
//     no top inset, so "New link" sat flush on the card's top border.
//   - An opaque base (WEB_OPAQUE_BACKGROUND) sits under a default card, so a
//     picker opened over a form (Tickets → Visibility) hides the form.
//   - A Competition / brand-filled panel keeps its own solid fill and insets.
//   - Narrow web still renders the bottom sheet (which owns the handle band).
//
// The native and narrow-web handle band is pinned by the strict-grep gate
// `issue-3827-sheet-top-inset-and-opaque.mjs` (SHEET_TOP_INSET must equal the
// handle region, and the bottom sheet must keep rendering its handle).
//
// FAILS-ON-REVERT: delete `cardBodyInset` from Sheet.web.tsx and the inset
// tests go red; delete the opaque base View and the opacity tests go red.

// MINGLA-INVARIANT: I-4420-SHEET-SIDE-GUTTER | issue #4420 | Every default wide-web sheet card pads its body by SHEET_SIDE_GUTTER (the bottom sheet body's own 20) on both sides, so no sheet content sits flush on, or is clipped by, the card edge.
// MINGLA-INVARIANT: I-SHEET-BREATHING-ROOM | issue #3355 | Every default wide-web sheet card reserves space[6] below its content, so a pinned footer never sits flush on the card's bottom border.

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockWide = true;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockWide }),
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

import { Sheet } from "../Sheet.web";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: Node; unmount: () => void };
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

type Style = Record<string, unknown>;
const flat = (style: unknown): Style => {
  if (Array.isArray(style)) return style.reduce<Style>((acc, s) => ({ ...acc, ...flat(s) }), {});
  return style !== null && typeof style === "object" ? (style as Style) : {};
};

const mount = async (props: Partial<React.ComponentProps<typeof Sheet>> = {}): Promise<Node> => {
  let tree: { root: Node } | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <Sheet visible onClose={() => undefined} testID="probe" {...props}>
        <React.Fragment>{React.createElement("Text", null, "New link")}</React.Fragment>
      </Sheet>,
    );
  });
  return (tree as { root: Node }).root;
};

const byTestID = (root: Node, id: string): Node[] =>
  root.findAll((n) => typeof n.type === "string" && n.props.testID === id);

describe("#3827 wide-desktop Sheet card", () => {
  test("the body reserves the handle band at the top, the same inset a phone sheet has", async () => {
    mockWide = true;
    const root = await mount();
    const body = byTestID(root, "probe-desktop-body");
    expect(body).toHaveLength(1);
    expect(flat(body[0].props.style).paddingTop).toBe(24);
    // The consumer's first line is INSIDE the inset body.
    expect(body[0].findAll((n) => n.type === "Text")).toHaveLength(1);
  });

  test("#3355 the body keeps breathing room under its content (pinned footers never sit on the border)", async () => {
    mockWide = true;
    // [TEST-MOD-APPROVED #4420] wave 6: spacing.lg is space[6] (24).
    const { space } = jest.requireActual<{ space: Record<number, number> }>("../../../constants/designSystem");
    const root = await mount();
    const pad = flat(byTestID(root, "probe-desktop-body")[0].props.style).paddingBottom;
    expect(pad).toBe(space[6]);
    expect(pad).toBeGreaterThanOrEqual(16);
  });

  test("#4420 the body keeps the bottom sheet's 20 side gutter, so content never sits on the card edge", async () => {
    mockWide = true;
    // The real constant is the kit's 20 (space[5]); the bottom sheet's body reads it too.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = (require("fs") as typeof import("fs")).readFileSync(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("path") as typeof import("path")).join(__dirname, "..", "SheetMobile.tsx"),
      "utf8",
    );
    expect(src).toMatch(/export const SHEET_SIDE_GUTTER = space\[5\];/);
    expect(src).toMatch(/paddingHorizontal: SHEET_SIDE_GUTTER,/);
    const style = flat(byTestID(await mount(), "probe-desktop-body")[0].props.style);
    expect(style.paddingHorizontal).toBe(20);
    // A brand-filled default card gets the same gutter.
    const brand = flat(byTestID(await mount({ panelBackground: "#222222" }), "probe-desktop-body")[0].props.style);
    expect(brand.paddingHorizontal).toBe(20);
  });

  test("#4420 a Competition panel lays out its own side insets", async () => {
    mockWide = true;
    const root = await mount({ presentation: "competition", panelBackground: "#101010" });
    expect(flat(byTestID(root, "probe-desktop-body")[0].props.style).paddingHorizontal).toBeUndefined();
  });

  test("#3355 a Competition panel still lays out its own bottom inset", async () => {
    mockWide = true;
    const root = await mount({ presentation: "competition", panelBackground: "#101010" });
    expect(flat(byTestID(root, "probe-desktop-body")[0].props.style).paddingBottom).toBeUndefined();
  });

  test("a default card has an opaque base under its content", async () => {
    mockWide = true;
    const root = await mount();
    const base = byTestID(root, "probe-desktop-opaque-base");
    expect(base).toHaveLength(1);
    expect(flat(base[0].props.style).backgroundColor).toBe("#16181b");
    expect(base[0].props.pointerEvents).toBe("none");
  });

  test("a Competition panel keeps its own solid fill and its own insets", async () => {
    mockWide = true;
    const root = await mount({ presentation: "competition", panelBackground: "#101010" });
    expect(byTestID(root, "probe-desktop-opaque-base")).toHaveLength(0);
    const body = byTestID(root, "probe-desktop-body");
    expect(flat(body[0].props.style).paddingTop).toBeUndefined();
  });

  test("a brand-filled default card keeps its solid fill and still gets the top band", async () => {
    mockWide = true;
    const root = await mount({ panelBackground: "#222222" });
    expect(byTestID(root, "probe-desktop-opaque-base")).toHaveLength(0);
    expect(flat(byTestID(root, "probe-desktop-body")[0].props.style).paddingTop).toBe(24);
  });

  test("narrow web renders the bottom sheet, which owns the handle band", async () => {
    mockWide = false;
    const root = await mount();
    expect(root.findAll((n) => n.type === "MobileSheetProbe")).toHaveLength(1);
    expect(byTestID(root, "probe-desktop-body")).toHaveLength(0);
  });
});
