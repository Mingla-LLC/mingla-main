/**
 * #3645 — a first-time organiser's brand setup must not stop after step 1.
 *
 * Originally: BrandSwitcherSheet re-derived its mode from the brand list on
 * every change. Creating the first brand made the list non-empty
 * optimistically, flipped the sheet to "Switch brand" and UNMOUNTED the
 * creation flow after step 1.
 *
 * #4389 (design v11, I-4389-NO-MODAL-ON-OVERLAY) took brand creation out of
 * the sheet: "Create a new brand" closes the sheet and opens the full-screen
 * /brand/new route. The #3645 invariant now lives on that route, which reads
 * the brand list too (N1 "You have a brand in progress" up front): the brand
 * F1 just created is a draft in that list, so without a latch the route would
 * swap the in-progress flow for N1 (or for the loading gap on a refetch). The
 * route decides N1 at open only; once a flow is on screen it stays mounted.
 *
 * Mounts the PRODUCTION /brand/new route and BrandSwitcherSheet. The flows
 * are stubs that count mounts/unmounts, so "the same flow instance is still
 * on screen" is asserted directly. Stock node/ts-jest Business gate.
 *
 * FAILS ON REVERT: drop `flowOpened` from app/brand/new.tsx (knownDraftId /
 * waitingForDrafts) → T1 and T2 see the flow unmounted and N1 / nothing.
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

const EMPTY: BrandListSeed = { brands: [], isTrueEmpty: true, isLoading: false, status: "ready" };
const LOADING: BrandListSeed = { brands: [], isTrueEmpty: false, isLoading: true, status: "loading" };
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
let mockSetup: { draftId: string | null; isLoading: boolean } = { draftId: null, isLoading: false };
const mockFlowLifecycle = { mounts: 0, unmounts: 0 };
const mockPush = jest.fn();
const mockClose = jest.fn();

jest.mock("expo-router", () => ({
  Redirect: () => null,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => mockBrandList,
}));

jest.mock("../../../hooks/useBrandSetupStates", () => ({
  useBrandSetupStates: () => ({ byId: {}, ...mockSetup }),
}));

jest.mock("../../../hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => ({ data: { partner_enabled: false }, isError: false }),
}));

jest.mock("../../../hooks/usePickBrand", () => ({
  usePickBrand: () => jest.fn(),
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-3645" }, isAuthReady: true }),
}));

// [TEST-MOD-APPROVED #3682] Harness registration only — follower totals are
// outside this suite's creation-flow lifecycle contract; every assertion stays.
jest.mock("../../../hooks/useBrandFollowerCount", () => ({
  useBrandFollowerCounts: () => ({ data: undefined, isPending: false, isError: false }),
}));

jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (
    selector: (state: { setCurrentBrand: () => void; currentBrandId: string | null }) => unknown,
  ) => selector({ setCurrentBrand: jest.fn(), currentBrandId: null }),
}));

jest.mock("../../../utils/brandDeletePermission", () => ({
  canDeleteBrand: () => false,
}));

jest.mock("../LazyBrandCreationFlow", () => {
  const ReactLocal = require("react") as typeof import("react");
  const { View } = require("react-native");
  const Flow = (): React.ReactElement => {
    ReactLocal.useEffect(() => {
      mockFlowLifecycle.mounts += 1;
      return () => {
        mockFlowLifecycle.unmounts += 1;
      };
    }, []);
    return <View testID="creation-flow" />;
  };
  return {
    LazyBrandCreationFlow: Flow,
    LazyPartnerClientBrandCreationFlow: () => <View testID="partner-flow" />,
    LazyDraftInProgress: () => <View testID="draft-in-progress" />,
  };
});

jest.mock("../../ui/Toast", () => ({ Toast: () => null }));

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
    TopSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      (visible ? <View testID="top-sheet">{children}</View> : null),
  };
});

import BrandNewRoute from "../../../../app/brand/new";
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

const hosts = (tree: TestTree, predicate: (node: TestInstance) => boolean): TestInstance[] =>
  tree.root.findAll((node) => typeof node.type === "string" && predicate(node));

const count = (tree: TestTree, testID: string): number =>
  hosts(tree, (node) => node.props.testID === testID).length;

async function renderRoute(tree: TestTree | null): Promise<TestTree> {
  let next = tree;
  await TestRenderer.act(async () => {
    if (next === null) next = TestRenderer.create(<BrandNewRoute />);
    else next.update(<BrandNewRoute />);
  });
  if (next === null) throw new Error("route did not mount");
  return next;
}

describe("#3645 — the first brand's setup stays mounted (/brand/new since #4389)", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    mockBrandList = EMPTY;
    mockSetup = { draftId: null, isLoading: false };
    mockFlowLifecycle.mounts = 0;
    mockFlowLifecycle.unmounts = 0;
    mockPush.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("T1: creating the first brand does not unmount the creation flow", async () => {
    tree = await renderRoute(null);
    expect(count(tree, "creation-flow")).toBe(1);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    // F1's own success: the list now holds the new brand, and it is a draft.
    mockBrandList = withBrands(FIRST_BRAND);
    mockSetup = { draftId: FIRST_BRAND.id, isLoading: false };
    tree = await renderRoute(tree);

    expect(count(tree, "creation-flow")).toBe(1);
    expect(count(tree, "draft-in-progress")).toBe(0);
    // The SAME instance — a remount would restart the flow at F1.
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  test("T2: a refetch (loading) or a rollback keeps the flow mounted too", async () => {
    tree = await renderRoute(null);
    mockBrandList = withBrands(FIRST_BRAND);
    mockSetup = { draftId: null, isLoading: true };
    tree = await renderRoute(tree);
    mockBrandList = { ...withBrands(FIRST_BRAND), isLoading: true };
    tree = await renderRoute(tree);
    mockBrandList = EMPTY;
    mockSetup = { draftId: null, isLoading: false };
    tree = await renderRoute(tree);

    expect(count(tree, "creation-flow")).toBe(1);
    expect(mockFlowLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  test("T3: N1 is decided each time the route opens", async () => {
    mockBrandList = withBrands(FIRST_BRAND);
    mockSetup = { draftId: FIRST_BRAND.id, isLoading: false };
    tree = await renderRoute(null);

    expect(count(tree, "draft-in-progress")).toBe(1);
    expect(count(tree, "creation-flow")).toBe(0);
  });

  test("T4: a list that was still loading at open and resolves empty moves to create", async () => {
    mockBrandList = LOADING;
    tree = await renderRoute(null);
    expect(count(tree, "creation-flow")).toBe(0);

    mockBrandList = EMPTY;
    tree = await renderRoute(tree);

    expect(count(tree, "creation-flow")).toBe(1);
  });

  test("T5: the sheet's Create opens the full-screen route and never embeds the flow", async () => {
    mockBrandList = withBrands(FIRST_BRAND);
    let sheet!: TestTree;
    await TestRenderer.act(async () => {
      sheet = TestRenderer.create(<BrandSwitcherSheet visible onClose={mockClose} />);
    });
    expect(count(sheet, "creation-flow")).toBe(0);

    const create = hosts(sheet, (node) => node.props.accessibilityLabel === "Create a new brand")[0];
    await TestRenderer.act(async () => {
      (create?.props.onPress as () => void)();
    });

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/brand/new");
    expect(count(sheet, "creation-flow")).toBe(0);
    TestRenderer.act(() => sheet.unmount());
  });
});
