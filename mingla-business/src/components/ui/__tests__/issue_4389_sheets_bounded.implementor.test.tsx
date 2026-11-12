// MINGLA-INVARIANT: I-4389-SHEET-BOUNDED-SCROLL-BODY | issue #4389 | Every bottom sheet #4389 added or changed renders its content in SheetScrollLayout: a bounded scroll body with its buttons pinned, so no button is ever pushed off screen.
/**
 * #4389 (Seth: "make sure sheets are not being pushed out of the screen").
 *
 * Every bottom sheet #4389 added or changed:
 *   - opens at a bounded snap ("half" / "full" / the "half" default), which on
 *     the smallest phone (SE 375×667) and the tallest (932pt, 59pt notch)
 *     stays below the top safe area with a gap;
 *   - renders its content in a scroll body INSIDE the panel (SheetScrollLayout
 *     or its own ScrollView), with its buttons in a footer pinned after it.
 * Before this, K1, the F1 discard / session-expired sheets, N1's confirm, H2,
 * Ari's "still answering" confirm, the door cash confirm and the pay-code
 * sheet were plain Views in a fixed-height panel that clips (overflow
 * hidden), so at a large text size on an SE their buttons were cut off.
 *
 * FAILS ON REVERT: put any of those sheets back on a plain View body → T1.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
let mockKeyboardHeight = 0;
jest.mock("../../../wrappers/useKeyboardHeight", () => ({ useKeyboardHeight: () => mockKeyboardHeight }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }) }));

/* eslint-disable import/first */
import { SheetScrollLayout, sheetKeyboardLift } from "../SheetScrollLayout";
import { computeSheetHeight, type SheetSnapValue } from "../sheetSnapHeight";
/* eslint-enable import/first */

const SRC = path.join(__dirname, "../../..");
const SHEET_FILES = [
  "components/brand/BrandCreationFlow.tsx", // K1, N1 confirm
  "components/brand/BrandSetupInterruptions.tsx", // F1 discard, session expired
  "components/home/HomeSetupPromptSheet.tsx", // H2
  "components/ari/AriBrandSwitchConfirmSheet.tsx", // Ari is still answering
  "components/brand/BrandDeleteSheet.tsx", // delete warn/preview/confirm/blocked/refused, not owner
  "components/door/DoorModeScreen.tsx", // cash confirm, menu, which event
  "components/door/DoorModePayCodeSheet.tsx", // scan to pay
  "components/door/DoorModeBuyerSheet.tsx", // add buyer
  "components/door/DoorPayCodeScreen.tsx", // text them the link
  "components/onboarding/MinglaToSAcceptanceGate.tsx", // terms gate (opened from setup)
];

/** Each `<Sheet …>…</Sheet>` block (no nesting in these files). */
function sheetBlocks(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf("<Sheet");
  while (i !== -1) {
    const next = src.charAt(i + 6);
    if (next === " " || next === "\n") {
      const end = src.indexOf("</Sheet>", i);
      out.push(src.slice(i, end === -1 ? undefined : end));
    }
    i = src.indexOf("<Sheet", i + 1);
  }
  return out;
}

describe("#4389 — every setup / door / Ari sheet is bounded and scrolls inside", () => {
  test("T1: each sheet opens at half/full and puts its content in a scroll body", () => {
    let count = 0;
    for (const rel of SHEET_FILES) {
      const blocks = sheetBlocks(fs.readFileSync(path.join(SRC, rel), "utf8"));
      expect({ rel, blocks: blocks.length > 0 }).toEqual({ rel, blocks: true });
      for (const b of blocks) {
        count += 1;
        const snap = /snapPoint="([^"]+)"/.exec(b)?.[1] ?? "half";
        expect({ rel, snap }).toEqual({ rel, snap: expect.stringMatching(/^(half|full)$/) });
        expect({ rel, scrolls: /<SheetScrollLayout\b|<ScrollView\b/.test(b) }).toEqual({ rel, scrolls: true });
        // No sheet opens another sheet inside itself (the freeze rule).
        expect((b.match(/<Sheet[\s\n]/g) ?? []).length).toBe(1);
      }
    }
    // K1, N1, F1 x2, H2, Ari, delete x2, door cash/menu/pick, code, buyer, text link, terms x2.
    expect(count).toBe(16);
  });

  test("T2: half and full stay under the top safe area with a gap (SE and a 932pt phone)", () => {
    const phones = [
      { height: 667, top: 20, name: "SE" },
      { height: 932, top: 59, name: "Pro Max" },
    ];
    for (const snap of ["half", "full"] as SheetSnapValue[]) {
      for (const p of phones) {
        const h = computeSheetHeight(snap, p.height);
        // Bottom-anchored panel (the bottom inset is inside it): its top edge.
        expect({ snap, phone: p.name, ok: p.height - h >= p.top + 24 }).toEqual({ snap, phone: p.name, ok: true });
      }
    }
  });
});

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  findAll(p: (n: Node) => boolean): Node[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: { root: Node; unmount(): void } | null = null;
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});
const isInside = (n: Node, a: Node): boolean => {
  for (let p: Node | null = n.parent; p !== null; p = p.parent) if (p === a) return true;
  return false;
};

describe("#4389 — SheetScrollLayout: scroll body above a pinned footer", () => {
  test("T3: the footer is outside the scroll body, after it; both share a flex:1 column", () => {
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <SheetScrollLayout testID="s" footer={<Text testID="btn">Go</Text>}>
          <Text>body</Text>
        </SheetScrollLayout>,
      );
    });
    const root = (tree as unknown as { root: Node }).root;
    const scroll = root.findAll((n) => n.type === ScrollView)[0] as Node;
    const footer = root.findAll((n) => typeof n.type === "string" && n.props.testID === "s-footer")[0] as Node;
    const btn = root.findAll((n) => typeof n.type === "string" && n.props.testID === "btn")[0] as Node;
    expect(isInside(btn, footer)).toBe(true);
    expect(isInside(btn, scroll)).toBe(false);
    expect((StyleSheet.flatten(scroll.props.style as object) as { flex?: number }).flex).toBe(1);
    const col = root.findAll((n) => typeof n.type === "string" && n.props.testID === "s")[0] as Node;
    expect((StyleSheet.flatten(col.props.style as object) as { flex?: number }).flex).toBe(1);
    expect((StyleSheet.flatten(col.props.style as object) as { paddingBottom?: number }).paddingBottom).toBeUndefined();
  });

  // #4389 (device r4): the footer of a sheet with an input (delete
  // "Type to confirm", Add buyer, Text the link) sat behind the keyboard.
  test("T4: keyboardAware lifts the footer by the keyboard + Done bar, less the panel's bottom room", () => {
    mockKeyboardHeight = 336;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <SheetScrollLayout keyboardAware testID="k" footer={<Text testID="btn">Save</Text>}>
          <View />
        </SheetScrollLayout>,
      );
    });
    const root = (tree as unknown as { root: Node }).root;
    const col = root.findAll((n) => typeof n.type === "string" && n.props.testID === "k")[0] as Node;
    const lift = (StyleSheet.flatten(col.props.style as object) as { paddingBottom?: number }).paddingBottom;
    // 336 + 53 (Done bar) - (24 + 34) = 331
    expect(lift).toBe(331);
    expect(sheetKeyboardLift(336, 34)).toBe(331);
    expect(sheetKeyboardLift(0, 34)).toBe(0);
    mockKeyboardHeight = 0;
  });
});
