/**
 * #3645 — TESTER adversarial suite for BrandSwitcherSheet's open-time mode.
 *
 * Different angles from issue_3645_first_brand_flow_survives.implementor.test.tsx:
 * that suite starts from an EMPTY account. These start from an account that
 * already has brands and reaches the creation flow through the explicit
 * "Create a new brand" control, from a sheet that is mounted but hidden, from a
 * list that errors, and through close/reopen cycles.
 *
 * FAILS ON REVERT (restore BrandSwitcherSheet.tsx from origin/main): S1 and
 * S5 — the old effect re-derived the mode whenever `isTrueEmpty` changed, so a
 * list that dips to empty and back while the organiser is mid-creation flips
 * the sheet to "Switch brand" and unmounts the flow.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_brand_sheet_mode.tester.adversarial.test.tsx --runInBand
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


const SECOND_BRAND: BrandRow = {
  id: "36450000-0000-4000-8000-000000000009",
  displayName: "Second Brand",
  accountId: "account-3645",
  role: "owner",
};
const ERRORED: BrandListSeed = {
  brands: [],
  isTrueEmpty: false,
  isLoading: false,
  status: "error",
};

async function pressCreate(tree: TestTree): Promise<void> {
  const create = hosts(
    tree,
    (node) => node.props.accessibilityLabel === "Create a new brand",
  )[0];
  await TestRenderer.act(async () => {
    (create.props.onPress as () => void)();
  });
}

describe("#3645 — tester adversarial: the brand sheet's mode is an open-time decision", () => {
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

  test("S1: an organiser WITH brands who taps 'Create a new brand' keeps the flow while the list dips to empty and refills", async () => {
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(null, true);
    await pressCreate(tree);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    // The existing brand is removed elsewhere (another tab / a teammate)…
    mockBrandList = EMPTY;
    tree = await render(tree, true);
    // …then this flow's own step-1 insert lands and the list is non-empty again.
    mockBrandList = withBrands(SECOND_BRAND);
    tree = await render(tree, true);
    // …and a background refetch reorders / grows it.
    mockBrandList = withBrands(SECOND_BRAND, FIRST_BRAND);
    tree = await render(tree, true);

    expect(flowCount(tree)).toBe(1);
    expect(showsSwitchList(tree)).toBe(false);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  test("S2: a sheet that was mounted hidden decides from the list as it is when it OPENS, not as it was at mount", async () => {
    // Mounted hidden on an empty account…
    tree = await render(null, false);
    expect(flowCount(tree)).toBe(0);
    // …the first brand is created somewhere else while it is hidden…
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(tree, false);
    // …so opening shows the switcher, never a stale creation flow.
    tree = await render(tree, true);
    expect(flowCount(tree)).toBe(0);
    expect(showsSwitchList(tree)).toBe(true);
    // Whatever mounted on the way there is gone: no live flow is left behind.
    expect(mockFlowLifecycle.mounts - mockFlowLifecycle.unmounts).toBe(0);

    // And the reverse: brands at mount, none left by the time it reopens.
    tree = await render(tree, false);
    mockBrandList = EMPTY;
    tree = await render(tree, false);
    tree = await render(tree, true);
    expect(flowCount(tree)).toBe(1);
    expect(showsSwitchList(tree)).toBe(false);
  });

  test("S3: a list still loading at open that resolves to MANY brands stays on the switcher and never mounts the flow", async () => {
    mockBrandList = LOADING;
    tree = await render(null, true);
    expect(textOf(tree.root)).toContain("Loading your brands");

    mockBrandList = withBrands(FIRST_BRAND, SECOND_BRAND);
    tree = await render(tree, true);

    expect(showsSwitchList(tree)).toBe(true);
    expect(flowCount(tree)).toBe(0);
    expect(mockFlowLifecycle.mounts).toBe(0);
    expect(
      hosts(tree, (node) => node.props.accessibilityLabel === "Switch to Second Brand"),
    ).toHaveLength(1);
  });

  test("S4: a list that FAILED to load is not mistaken for an empty account", async () => {
    mockBrandList = ERRORED;
    tree = await render(null, true);

    expect(flowCount(tree)).toBe(0);
    expect(textOf(tree.root)).toContain("Couldn't load your brands.");

    // A retry that then succeeds with brands keeps the switcher.
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(tree, true);
    expect(showsSwitchList(tree)).toBe(true);
    expect(flowCount(tree)).toBe(0);
  });

  test("S5: deleting the last brand while the switcher is open moves to creation; closing and reopening after creating returns to the switcher", async () => {
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(null, true);
    expect(showsSwitchList(tree)).toBe(true);

    mockBrandList = EMPTY;
    tree = await render(tree, true);
    expect(flowCount(tree)).toBe(1);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    // The flow creates a brand and stays up…
    mockBrandList = withBrands(SECOND_BRAND);
    tree = await render(tree, true);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    // …then the organiser closes and reopens the sheet.
    tree = await render(tree, false);
    tree = await render(tree, true);
    expect(flowCount(tree)).toBe(0);
    expect(showsSwitchList(tree)).toBe(true);
    expect(
      hosts(tree, (node) => node.props.accessibilityLabel === "Switch to Second Brand"),
    ).toHaveLength(1);
  });

  test("S6: an explicit create is forgotten on close — every reopen with brands starts on the switcher, with a fresh flow next time", async () => {
    mockBrandList = withBrands(FIRST_BRAND);
    tree = await render(null, true);
    await pressCreate(tree);
    expect(flowCount(tree)).toBe(1);

    tree = await render(tree, false);
    tree = await render(tree, true);
    expect(flowCount(tree)).toBe(0);
    expect(showsSwitchList(tree)).toBe(true);

    await pressCreate(tree);
    expect(flowCount(tree)).toBe(1);
    // Exactly one live instance: the abandoned one was torn down.
    expect(mockFlowLifecycle.mounts - mockFlowLifecycle.unmounts).toBe(1);
    expect(mockFlowLifecycle.mounts).toBeGreaterThanOrEqual(2);
  });

  test("S7: cancelling creation on an account with no brands closes the sheet instead of showing an empty switcher", async () => {
    const onClose = jest.fn();
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <BrandSwitcherSheet visible onClose={onClose} />,
      );
    });
    const mounted = tree as unknown as TestTree;
    const flow = hosts(mounted, (node) => node.props.testID === "creation-flow")[0];
    await TestRenderer.act(async () => {
      (flow.props.onCancel as () => void)();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(showsSwitchList(mounted)).toBe(false);
  });
});
