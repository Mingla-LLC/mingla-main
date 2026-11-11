/**
 * #4389 (device r4) — Door "Add buyer": Save sat behind the keyboard; and
 * "Text them the link" (a half sheet) had no room left for Send with the
 * keyboard up. Both sheets render in the keyboard-aware SheetScrollLayout
 * (footer lifted by the keyboard height), and the text-link sheet opens full.
 *
 * FAILS ON REVERT: Add buyer without keyboardAware (or Save back in the scroll
 * body) → T1; the text-link sheet back to "half" → T2.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
jest.mock("../../../wrappers/useKeyboardHeight", () => ({ useKeyboardHeight: () => 336 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock("../../ui/Sheet", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { Sheet: (p: { children?: React.ReactNode }) => R.createElement(RN.View, { testID: "panel" }, p.children) };
});
jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { Button: (p: { label: string; testID?: string }) => R.createElement(RN.View, { testID: p.testID ?? `btn-${p.label}` }) };
});
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/PhoneField", () => ({ PhoneField: () => null }));

import { ScrollView, StyleSheet } from "react-native";
import { DoorModeBuyerSheet } from "../DoorModeBuyerSheet";

interface Node { type: unknown; props: Record<string, unknown>; parent: Node | null; findAll(p: (n: Node) => boolean): Node[] }
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

describe("#4389 — door sheets keep their buttons above the keyboard", () => {
  test("T1: Add buyer: Save is in the lifted footer, outside the scroll body", () => {
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <DoorModeBuyerSheet
          visible
          name=""
          email=""
          phone={{ isEmpty: true, e164: null, countryIso: "US" } as never}
          onChangeName={() => undefined}
          onChangeEmail={() => undefined}
          onClear={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    const root = (tree as unknown as { root: Node }).root;
    const col = root.findAll((n) => typeof n.type === "string" && n.props.testID === "door-mode-buyer-body")[0] as Node;
    expect((StyleSheet.flatten(col.props.style as object) as { paddingBottom?: number }).paddingBottom).toBe(336 + 53 - (24 + 34));
    const save = root.findAll((n) => typeof n.type === "string" && n.props.testID === "door-mode-buyer-save")[0] as Node;
    expect(isInside(save, col)).toBe(true);
    expect(root.findAll((n) => n.type === ScrollView).some((s) => isInside(save, s))).toBe(false);
  });

  test("T2: Text them the link opens full and keyboard-aware", () => {
    const src = fs.readFileSync(path.join(__dirname, "../DoorPayCodeScreen.tsx"), "utf8");
    const at = src.indexOf("<Text style={styles.sheetTitle}>Text them the link</Text>");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(src.lastIndexOf("<Sheet ", at), at);
    expect(block).toMatch(/snapPoint="full"/);
    expect(block).toMatch(/<SheetScrollLayout\s+keyboardAware/);
  });
});
