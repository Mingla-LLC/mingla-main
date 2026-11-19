/**
 * #4453 — at 375pt the brands sheet (top bar on Home, and Ari's "Talk to Ari
 * about") cut names to "go…" / "Young & …": the name shared one line with
 * the check, Continue and the draft menu, and could not wrap.
 *
 * What jest can prove is the structure the layout rests on: the name may run
 * to two lines; the row wraps; the switch target asks for more room than a
 * 375pt row can give it beside Continue (so the buttons drop under the name
 * there); the buttons are one compact group at the trailing edge, still
 * siblings of the switch target, each a 44pt target. The pixels themselves
 * need a browser at 375.
 *
 * FAILS-ON-REVERT: put `numberOfLines={1}` back on the name, or `flex: 1`
 * (basis 0) on the switch target, and N1 / N2 fail.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/brand/__tests__/issue_4453_brand_sheet_names_readable.implementor.test.tsx
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
  { id: "b-draft", displayName: "Young & Restless Supper Club Lagos", accountId: USER_ID, role: "owner" },
  { id: "b-free", displayName: "Free Brand", accountId: USER_ID, role: "owner" },
  { id: "b-done", displayName: "Done Brand", accountId: USER_ID, role: "owner" },
  { id: "b-inc", displayName: "Published Brand", accountId: USER_ID, role: "owner" },
];

// #4453 integration: the sheet's module also carries the desktop brand menu
// (one on-demand chunk for both). This test is about the sheet only.
jest.mock("../WorkspaceBrandMenu", () => ({ WorkspaceBrandMenu: () => null }));
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

import { StyleSheet } from "react-native";
import { BrandSwitcherSheet, ROW_PICK_BASIS } from "../BrandSwitcherSheet";
import { space } from "../../../constants/designSystem";

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


type Style = Record<string, number | string | undefined>;
const styleOf = (n: Node): Style => (StyleSheet.flatten(n.props.style as never) ?? {}) as Style;
const LONG = "Young & Restless Supper Club Lagos";

describe("#4453 brand names are readable in the phone brands sheet", () => {
  beforeEach(() => {
    mockCurrentBrandId = "b-draft";
    mockStates = {
      "b-draft": { kind: "draft", doneCount: 1 },
      "b-free": { kind: "free_only", doneCount: 2 },
      "b-done": { kind: "none" },
      "b-inc": { kind: "incomplete", doneCount: 3 },
    };
  });

  test("N1: every name is shown in full on up to two lines, never one clipped line", () => {
    const tree = render();
    for (const brand of mockBrands) {
      const name = tree.root.findAll(
        (n) => typeof n.type === "string" && n.children.length === 1 && n.children[0] === brand.displayName,
      );
      expect(name.length).toBeGreaterThan(0);
      expect(name[0]!.props.numberOfLines).toBe(2);
    }
    // The name column takes what the switch target has, and may shrink.
    const row = rowOf(tree, LONG);
    const column = row.children.filter((c): c is Node => typeof c !== "string")
      .find((c) => textOf(c).startsWith(LONG))!;
    expect(styleOf(column)).toMatchObject({ flex: 1, minWidth: 0 });
    tree.unmount();
  });

  test("N2: on a 375pt phone the switch target cannot fit beside Continue, so the buttons wrap under the name", () => {
    const tree = render();
    const box = styleOf(hosts(tree, "brand-switcher-rowbox-b-draft")[0]!);
    expect(box.flexWrap).toBe("wrap");
    expect(box.flexDirection).toBe("row");
    const pick = styleOf(rowOf(tree, LONG));
    expect(pick).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: ROW_PICK_BASIS, minWidth: 0 });
    expect(pick.minHeight as number).toBeGreaterThanOrEqual(44);

    // The row on a 375pt screen: the list pads 20 each side, the row pads its
    // trailing edge. Continue is at least its own padding plus a ~48pt word.
    const cont = styleOf(hosts(tree, "brand-switcher-continue-b-draft")[0]!);
    const continueAtLeast = 2 * (cont.paddingHorizontal as number) + 48;
    const beside = 375 - 2 * space[5] - (box.paddingRight as number) - (box.columnGap as number) - continueAtLeast;
    expect(beside).toBeLessThan(ROW_PICK_BASIS);
    // Once wrapped, the name has the row less the mark, the gaps and the check: over 200pt, twice.
    const wrappedName = 375 - 2 * space[5] - (box.paddingRight as number) - (pick.padding as number) - 40 - 2 * (pick.gap as number) - 28;
    expect(wrappedName).toBeGreaterThanOrEqual(200);
    tree.unmount();
  });

  test("N3: the buttons are one compact group at the trailing edge, beside (never inside) the switch target", () => {
    const tree = render();
    const actions = hosts(tree, "brand-switcher-actions-b-draft");
    expect(actions).toHaveLength(1);
    const rowBox = hosts(tree, "brand-switcher-rowbox-b-draft")[0]!;
    expect(isInside(actions[0]!, rowBox)).toBe(true);
    expect(isInside(actions[0]!, rowOf(tree, LONG))).toBe(false);
    const style = styleOf(actions[0]!);
    expect(style).toMatchObject({ flexDirection: "row", alignItems: "center", marginLeft: "auto" });
    // Breathing room under the pill when it is on a line of its own.
    expect(style.paddingVertical as number).toBeGreaterThanOrEqual(space[2]);
    // Nothing was removed: Continue and the draft's menu are both there.
    for (const id of ["brand-switcher-continue-b-draft", "brand-switcher-discard-b-draft"]) {
      const button = hosts(tree, id);
      expect(button).toHaveLength(1);
      expect(isInside(button[0]!, actions[0]!)).toBe(true);
      const s = styleOf(button[0]!);
      const slop = button[0]!.props.hitSlop as number;
      expect((s.height as number) + 2 * slop).toBeGreaterThanOrEqual(44);
      expect(typeof button[0]!.props.accessibilityLabel).toBe("string");
    }
    // A finished brand has no buttons, so no empty group either.
    expect(hosts(tree, "brand-switcher-actions-b-done")).toHaveLength(0);
    expect(hosts(tree, "brand-switcher-actions-b-free")).toHaveLength(1);
    expect(hosts(tree, "brand-switcher-discard-b-free")).toHaveLength(0);
    tree.unmount();
  });
});
