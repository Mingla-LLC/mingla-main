// MINGLA-INVARIANT: I-4389-SWITCHER-UNFINISHED-ROW | issue #4389 | A brand whose setup checklist is not complete (draft, free-only or published) shows in the brand switcher as one row: line 1 the name only, line 2 "Draft" (accent) · "{n} of 4 done" (· "Free events only" when chosen), and a Continue pill INSIDE the row that opens /brand/{id}/setup. There is no separate Continue button under the row and no pill next to the name. Only a true draft offers "Discard draft".
/**
 * Seth (2026-11-11): "the continue should be in the brand and it should be
 * clear it is a draft", then "the draft is placed awkwardly" (no pill by the
 * name; "Draft" leads line 2).
 *
 * FAILS-ON-REVERT: restore BrandSwitcherSheet.tsx from 24ce5878f9 and R1/R2
 * fail (Continue is a sibling under the row, line 2 reads "Draft · 1 of 4").
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_4389_switcher_row_layout.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = "u-1";
const mockPush = jest.fn();
const mockPick = jest.fn();
let mockStates: Record<string, unknown> = {};
let mockCurrentBrandId: string | null = null;
const mockBrands = [
  { id: "b-draft", displayName: "Tester US Brand", accountId: USER_ID, role: "owner" },
  { id: "b-free", displayName: "Free Brand", accountId: USER_ID, role: "owner" },
  { id: "b-done", displayName: "Done Brand", accountId: USER_ID, role: "owner" },
];

jest.mock("expo-router", () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: USER_ID } }) }));
jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => ({ brands: mockBrands, status: "success", isLoading: false }),
}));
jest.mock("../../../hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../hooks/useBrandSetupStates", () => ({
  useBrandSetupStates: () => ({ byId: mockStates, draftId: "b-draft", isLoading: false }),
}));
jest.mock("../../../hooks/useBrandFollowerCount", () => ({ useBrandFollowerCounts: () => ({ data: {} }) }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: mockCurrentBrandId }),
}));
jest.mock("../../../utils/brandDeletePermission", () => ({ canDeleteBrand: () => true }));
jest.mock("../../ui/TopSheet", () => ({ TopSheet: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
jest.mock("../BrandMark", () => ({ BrandMark: (): null => null }));
jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

import { BrandSwitcherSheet } from "../BrandSwitcherSheet";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
};
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));

function render(): ReturnType<typeof TestRenderer.create> {
  let tree: ReturnType<typeof TestRenderer.create> | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<BrandSwitcherSheet visible onClose={jest.fn()} onRequestDeleteBrand={jest.fn()} />);
  });
  return tree as unknown as ReturnType<typeof TestRenderer.create>;
}
const hosts = (tree: ReturnType<typeof TestRenderer.create>, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const rowOf = (tree: ReturnType<typeof TestRenderer.create>, name: string): Node => {
  const rows = tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === `Switch to ${name}`);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const isInside = (node: Node, ancestor: Node): boolean => {
  for (let p: Node | null = node.parent; p !== null; p = p.parent) if (p === ancestor) return true;
  return false;
};

describe("#4389 N3 — unfinished brand row", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockPick.mockClear();
    mockCurrentBrandId = null;
    mockStates = {
      "b-draft": { kind: "draft", doneCount: 1 },
      "b-free": { kind: "free_only", doneCount: 2 },
      "b-done": { kind: "none" },
    };
  });

  test("R1: line 1 is the name; line 2 leads with Draft then progress; free-only adds its tag", () => {
    const tree = render();
    const draftLine = hosts(tree, "brand-switcher-setup-line-b-draft");
    expect(draftLine).toHaveLength(1);
    expect(textOf(draftLine[0]!)).toBe("Draft · 1 of 4 done");
    expect(textOf(hosts(tree, "brand-switcher-setup-line-b-free")[0]!)).toBe("Draft · 2 of 4 done · Free events only");
    // "Draft" is its own accent run at the start of line 2, not a pill by the name.
    const draftWord = (draftLine[0]!.children[0] as Node);
    expect(textOf(draftWord)).toBe("Draft");
    const nameText = tree.root.findAll((n) => typeof n.type === "string" && textOf(n) === "Tester US Brand" && n.children.length === 1);
    expect(nameText.length).toBeGreaterThan(0);
    expect(hosts(tree, "brand-switcher-setup-line-b-done")).toHaveLength(0);
    tree.unmount();
  });

  test("R2: Continue is INSIDE the row (no separate button under it) and opens setup; tapping the row switches", () => {
    const tree = render();
    const row = rowOf(tree, "Tester US Brand");
    const cont = hosts(tree, "brand-switcher-continue-b-draft");
    expect(cont).toHaveLength(1);
    expect(isInside(cont[0]!, row)).toBe(true);
    expect(isInside(hosts(tree, "brand-switcher-continue-b-free")[0]!, rowOf(tree, "Free Brand"))).toBe(true);
    expect(hosts(tree, "brand-switcher-continue-b-done")).toHaveLength(0);
    TestRenderer.act(() => (cont[0]!.props.onClick as (() => void) | undefined)?.() ?? (cont[0]!.props.onPress as (() => void) | undefined)?.());
    expect(mockPush).toHaveBeenCalledWith("/brand/b-draft/setup");
    expect(mockPick).not.toHaveBeenCalled();
    TestRenderer.act(() => (row.props.onClick as (() => void) | undefined)?.() ?? (row.props.onPress as (() => void) | undefined)?.());
    expect(mockPick).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  test("R3: only a true draft offers Discard draft; the current brand keeps its check before the pill", () => {
    mockCurrentBrandId = "b-draft";
    const tree = render();
    expect(hosts(tree, "brand-switcher-discard-b-draft")).toHaveLength(1);
    expect(hosts(tree, "brand-switcher-discard-b-free")).toHaveLength(0);
    const row = rowOf(tree, "Tester US Brand");
    const check = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "icon-check");
    expect(check).toHaveLength(1);
    expect(isInside(check[0]!, row)).toBe(true);
    tree.unmount();
  });
});
