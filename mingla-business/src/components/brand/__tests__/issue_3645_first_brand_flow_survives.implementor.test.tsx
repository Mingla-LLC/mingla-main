/**
 * #3645 — a first-time organiser's brand setup must not stop after step 1.
 *
 * BrandSwitcherSheet used to re-derive its mode from the brand list on every
 * change. Creating the first brand makes the list non-empty optimistically,
 * which flipped the sheet to "Switch brand" and UNMOUNTED BrandCreationFlow
 * after step 1 — Place, Look, Payouts and the first-offering tiles never
 * showed. The mode is now decided when the sheet opens.
 *
 * Mounts the PRODUCTION BrandSwitcherSheet. BrandCreationFlow is a stub that
 * counts its mounts/unmounts, so "the same flow instance is still on screen"
 * is asserted directly. Stock node/ts-jest Business gate.
 *
 * FAILS ON REVERT: restore
 *   useEffect(() => { if (visible) setMode(isTrueEmpty ? "create" : "switch"); }, …)
 * → T1 sees the flow unmounted and "Switch brand" rendered.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_first_brand_flow_survives.implementor.test.tsx --runInBand
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

interface BrandRow {
  id: string;
  displayName: string;
  accountId: string;
  role: string;
}

interface BrandListSeed {
  brands: BrandRow[];
  isTrueEmpty: boolean;
  isLoading: boolean;
  status: "loading" | "ready" | "error";
}

const EMPTY: BrandListSeed = {
  brands: [],
  isTrueEmpty: true,
  isLoading: false,
  status: "ready",
};
const LOADING: BrandListSeed = {
  brands: [],
  isTrueEmpty: false,
  isLoading: true,
  status: "loading",
};
const FIRST_BRAND: BrandRow = {
  id: "36450000-0000-4000-8000-000000000001",
  displayName: "First Brand",
  accountId: "account-3645",
  role: "owner",
};
const withBrands = (...brands: BrandRow[]): BrandListSeed => ({
  brands,
  isTrueEmpty: false,
  isLoading: false,
  status: "ready",
});

let mockBrandList: BrandListSeed = EMPTY;
const mockFlowLifecycle = { mounts: 0, unmounts: 0 };

jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => mockBrandList,
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-3645" } }),
}));

jest.mock("../../../hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({
    mutateAsync: jest.fn(() => Promise.resolve(undefined)),
  }),
}));

// [TEST-MOD-APPROVED #3682] Harness registration only — follower totals are
// outside this suite's creation-flow lifecycle contract; every assertion stays.
jest.mock("../../../hooks/useBrandFollowerCount", () => ({
  useBrandFollowerCounts: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));

jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (
    selector: (state: {
      setCurrentBrand: () => void;
      currentBrandId: string | null;
    }) => unknown,
  ) => selector({ setCurrentBrand: jest.fn(), currentBrandId: null }),
}));

jest.mock("../../../utils/brandDeletePermission", () => ({
  canDeleteBrand: () => false,
}));

jest.mock("../BrandCreationFlow", () => {
  const ReactLocal = require("react") as typeof import("react");
  const { View } = require("react-native");
  return {
    BrandCreationFlow: (props: { onCancel?: () => void }) => {
      ReactLocal.useEffect(() => {
        mockFlowLifecycle.mounts += 1;
        return () => {
          mockFlowLifecycle.unmounts += 1;
        };
      }, []);
      return <View testID="creation-flow" onCancel={props.onCancel} />;
    },
  };
});

jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityLabel={label} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: () => <View /> };
});

jest.mock("../../ui/TopSheet", () => {
  const { View } = require("react-native");
  return {
    TopSheet: ({
      visible,
      children,
    }: {
      visible: boolean;
      children?: React.ReactNode;
    }) => (visible ? <View testID="top-sheet">{children}</View> : null),
  };
});

import { BrandSwitcherSheet } from "../BrandSwitcherSheet";

interface TestInstance {
  type: unknown;
  children: (TestInstance | string)[];
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface TestTree {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => TestTree;
};

const hosts = (
  tree: TestTree,
  predicate: (node: TestInstance) => boolean,
): TestInstance[] =>
  tree.root.findAll((node) => typeof node.type === "string" && predicate(node));

const flowCount = (tree: TestTree): number =>
  hosts(tree, (node) => node.props.testID === "creation-flow").length;

const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const showsSwitchList = (tree: TestTree): boolean =>
  textOf(tree.root).includes("Switch brand");

async function render(
  tree: TestTree | null,
  visible: boolean,
): Promise<TestTree> {
  const element = <BrandSwitcherSheet visible={visible} onClose={jest.fn()} />;
  let next = tree;
  await TestRenderer.act(async () => {
    if (next === null) next = TestRenderer.create(element);
    else next.update(element);
  });
  if (next === null) throw new Error("sheet did not mount");
  return next;
}

describe("#3645 — the brand sheet keeps an in-progress creation flow mounted", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    mockBrandList = EMPTY;
    mockFlowLifecycle.mounts = 0;
    mockFlowLifecycle.unmounts = 0;
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("T1: creating the first brand does not unmount the creation flow", async () => {
    tree = await render(null, true);
    expect(flowCount(tree)).toBe(1);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    // Step 1's own success: the optimistic insert makes the list non-empty.
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(tree, true);

    expect(flowCount(tree)).toBe(1);
    expect(showsSwitchList(tree)).toBe(false);
    // The SAME instance — a remount would restart the flow at step 1.
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  test("T2: an optimistic rollback (create failed) keeps the flow mounted too", async () => {
    tree = await render(null, true);
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(tree, true);
    mockBrandList = EMPTY;
    tree = await render(tree, true);

    expect(flowCount(tree)).toBe(1);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  test("T3: the mode is re-decided each time the sheet opens", async () => {
    tree = await render(null, true);
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(tree, true);
    expect(flowCount(tree)).toBe(1);

    tree = await render(tree, false);
    tree = await render(tree, true);

    expect(flowCount(tree)).toBe(0);
    expect(showsSwitchList(tree)).toBe(true);
  });

  test("T4: a list that was still loading at open and resolves empty moves to create", async () => {
    mockBrandList = LOADING;
    tree = await render(null, true);
    expect(flowCount(tree)).toBe(0);

    mockBrandList = EMPTY;
    tree = await render(tree, true);

    expect(flowCount(tree)).toBe(1);
  });

  test("T5: the explicit controls still switch mode", async () => {
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(null, true);
    expect(showsSwitchList(tree)).toBe(true);

    const create = hosts(
      tree,
      (node) => node.props.accessibilityLabel === "Create a new brand",
    )[0];
    await TestRenderer.act(async () => {
      (create.props.onPress as () => void)();
    });
    expect(flowCount(tree)).toBe(1);

    const flow = hosts(tree, (node) => node.props.testID === "creation-flow")[0];
    await TestRenderer.act(async () => {
      (flow.props.onCancel as () => void)();
    });
    expect(flowCount(tree)).toBe(0);
    expect(showsSwitchList(tree)).toBe(true);
  });
});
