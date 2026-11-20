// MINGLA-INVARIANT: I-4453-ONE-BRAND-MENU | issue #4453 | Tapping the brand chip opens the compact brand menu on every screen and width (Home included); the host's own sheet is only that menu's "Manage brands" target, except with no brand yet.
/**
 * #4453 — one brand menu everywhere. Phones used to open the big brand sheet
 * from Home's chip; now every chip opens the compact menu. An unfinished
 * brand's row carries a Continue pill (a SIBLING of the switch target), a
 * true draft carries a "more" button with "Discard draft" (only when the
 * host supplies a handler), and the footer is two real buttons.
 *
 * WHAT RUNS: the real WorkspaceBrandSwitcher and the real WorkspaceBrandMenu
 * (the brand sheet's module re-exports it, as in production). Hooks and the
 * router are stand-ins.
 *
 * FAILS-ON-REVERT: restore the phone branch in WorkspaceBrandSwitcher
 * (call onOpenSheet instead of opening the menu) and (a) fails; drop the
 * Continue / more / footer-button markup from WorkspaceBrandMenu and (c),
 * (d), (e) fail.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/brand/__tests__/issue_4453_phone_menu_everywhere.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockSwitch = jest.fn();
let mockCanDelete = true;
let mockWide = false;
let mockBrand: { id: string; displayName: string } | null = null;
let mockStates: Record<string, unknown> = {};
let mockDraftId: string | null = null;
const BRANDS = [
  { id: "b-done", displayName: "Done Brand", slug: "done", role: "owner" },
  { id: "b-draft", displayName: "A Very Long Draft Brand Name That Wraps Over Two Lines", slug: "draft", role: "owner" },
  { id: "b-inc", displayName: "Published Brand", slug: "inc", role: "owner" },
];

jest.mock("expo-router", () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: mockWide }) }));
jest.mock("../../../hooks/useWorkspaceBrand", () => ({
  useWorkspaceBrand: () => ({ brand: mockBrand, pending: false, scoped: false }),
}));
jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => ({ brands: BRANDS, status: "ready", isLoading: false, refetch: async () => undefined }),
}));
jest.mock("../../../hooks/useBrandSetupStates", () => ({
  useBrandSetupStates: () => ({ byId: mockStates, draftId: mockDraftId, isLoading: false }),
}));
jest.mock("../../../hooks/useWorkspaceBrandSwitch", () => ({
  useWorkspaceBrandSwitch: () => (b: unknown) => mockSwitch(b),
}));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
jest.mock("../../../utils/brandDeletePermission", () => ({ canDeleteBrand: () => mockCanDelete }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Material", () => ({ Material: ({ children }: { children?: React.ReactNode }) => children }));
jest.mock("../../ui/TopSheet", () => {
  const { View } = require("react-native");
  return {
    TopSheet: (p: { visible: boolean; children?: React.ReactNode; testID?: string }) =>
      p.visible ? <View testID={p.testID}>{p.children}</View> : null,
  };
});
jest.mock("../BrandMark", () => ({ BrandMark: () => null }));
jest.mock("../../ui/BrandChip", () => {
  const { Pressable } = require("react-native");
  return {
    BrandChip: (p: { onPress: () => void; testID?: string }) => (
      <Pressable testID={p.testID} onPress={p.onPress} accessibilityRole="button" accessibilityLabel="Switch brand" />
    ),
  };
});
jest.mock("../BrandSwitcherSheet", () => ({
  WorkspaceBrandMenu: (jest.requireActual("../WorkspaceBrandMenu") as { WorkspaceBrandMenu: unknown }).WorkspaceBrandMenu,
}));

import { WorkspaceBrandSwitcher } from "../WorkspaceBrandSwitcher";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};
const hosts = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const isInside = (node: Node, ancestor: Node): boolean => {
  for (let p: Node | null = node.parent; p !== null; p = p.parent) if (p === ancestor) return true;
  return false;
};
const press = async (tree: Tree, testID: string): Promise<void> =>
  TestRenderer.act(async () => {
    const found = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function");
    expect(found.length).toBeGreaterThan(0);
    (found[0]!.props.onPress as () => void)();
  });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
};
const mount = async (props: React.ComponentProps<typeof WorkspaceBrandSwitcher> = {}): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<WorkspaceBrandSwitcher {...props} />);
  });
  return tree;
};
const openMenu = async (tree: Tree): Promise<void> => {
  await press(tree, "workspace-brand-switcher");
  await flush();
};

beforeEach(() => {
  mockPush.mockClear();
  mockSwitch.mockClear();
  mockCanDelete = true;
  mockWide = false;
  mockBrand = BRANDS[0]!;
  mockDraftId = "b-draft";
  mockStates = {
    "b-done": { kind: "none" },
    "b-draft": { kind: "draft", doneCount: 1 },
    "b-inc": { kind: "incomplete", doneCount: 3 },
  };
});

describe("#4453 one brand menu everywhere", () => {
  test("(a) phone + host sheet: the chip opens the menu, not the sheet; Manage brands is the way to the sheet", async () => {
    const onOpenSheet = jest.fn();
    const tree = await mount({ onOpenSheet });
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-menu").length).toBeGreaterThan(0);
    expect(onOpenSheet).not.toHaveBeenCalled();
    await press(tree, "workspace-brand-manage");
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });

  test("(b) no brand yet: the chip still opens the host's sheet (first brand is created there)", async () => {
    mockBrand = null;
    const onOpenSheet = jest.fn();
    const tree = await mount({ onOpenSheet });
    await openMenu(tree);
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(hosts(tree, "workspace-brand-menu")).toHaveLength(0);
  });

  test("(c) Continue is a sibling of the switch target, opens setup, and never switches", async () => {
    const tree = await mount({ onOpenSheet: jest.fn() });
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-continue-b-done")).toHaveLength(0);
    const cont = hosts(tree, "workspace-brand-continue-b-inc");
    const row = hosts(tree, "workspace-brand-row-b-inc");
    expect(cont).toHaveLength(1);
    expect(row).toHaveLength(1);
    expect(isInside(cont[0]!, row[0]!)).toBe(false);
    expect(isInside(row[0]!, cont[0]!)).toBe(false);
    expect(hosts(tree, "workspace-brand-continue-b-draft")).toHaveLength(1);

    await press(tree, "workspace-brand-continue-b-inc");
    expect(mockPush).toHaveBeenCalledWith("/brand/b-inc/setup");
    expect(mockSwitch).not.toHaveBeenCalled();

    mockPush.mockClear();
    await openMenu(tree);
    await press(tree, "workspace-brand-row-b-inc");
    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test("(d) the more button exists only for the draft and only with a discard handler", async () => {
    const without = await mount({ onOpenSheet: jest.fn() });
    await openMenu(without);
    expect(hosts(without, "workspace-brand-more-b-draft")).toHaveLength(0);

    const onDiscardDraft = jest.fn();
    const tree = await mount({ onOpenSheet: jest.fn(), onDiscardDraft });
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-more-b-inc")).toHaveLength(0);
    expect(hosts(tree, "workspace-brand-more-b-done")).toHaveLength(0);
    expect(hosts(tree, "workspace-brand-more-b-draft")).toHaveLength(1);
    await press(tree, "workspace-brand-more-b-draft");
    await press(tree, "workspace-brand-discard-b-draft");
    expect(onDiscardDraft).toHaveBeenCalledTimes(1);
    expect((onDiscardDraft.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "b-draft" });
  });

  test("(d2) a draft the user may not delete has no more button, even with a handler", async () => {
    mockCanDelete = false;
    const tree = await mount({ onOpenSheet: jest.fn(), onDiscardDraft: jest.fn() });
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-more-b-draft")).toHaveLength(0);
  });

  test("(e) the footer actions are real buttons", async () => {
    const tree = await mount({ onOpenSheet: jest.fn() });
    await openMenu(tree);
    for (const id of ["workspace-brand-create", "workspace-brand-manage"]) {
      const node = hosts(tree, id);
      expect(node).toHaveLength(1);
      expect(node[0]!.props.accessibilityRole).toBe("button");
    }
  });
});
