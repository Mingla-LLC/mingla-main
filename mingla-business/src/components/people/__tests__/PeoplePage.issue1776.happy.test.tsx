import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Text, View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockBrand: { id: string } | null = { id: "brand-a" };
let mockRole = {
  isLoading: false,
  isError: false,
  accepted: true,
  rank: 50,
  refetch: jest.fn(async () => undefined),
};
let mockLayout = { isWideDesktop: false, width: 390 };
let mockOnline = true;
let mockContactImport = true;
const mockCapturePeople = jest.fn();
const mockRefetch = jest.fn(async () => undefined);
const mockFetchNextPage = jest.fn(async () => undefined);

jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1" } }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => mockBrand }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => mockRole }));
jest.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: (name: string) => name === "contact_import_v1"
    ? { isPending: false, isFetching: false, isError: false, data: mockContactImport }
    : { isPending: false, isFetching: false, isError: false, data: false },
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => mockLayout,
}));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({ useStickyFooterOffset: () => 120 }));
jest.mock("../../../hooks/marketing/useBrandPeople", () => ({
  useBrandPeople: () => ({
    kind: "success",
    rows: [{
      personId: "person-1",
      displayName: "Ada",
      avatarUrl: null,
      updatedAt: "now",
      contacts: [{ id: "contact-1", channel: "email", value: "ada@example.test", isPrimary: true }],
      suppressions: [],
    }],
    bookTotal: 3,
    filteredTotal: 1,
    hasResolved: true,
    isError: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    refetch: mockRefetch,
    fetchNextPage: mockFetchNextPage,
  }),
}));
jest.mock("../../../hooks/marketing/useAudienceList", () => ({
  useAudienceList: () => ({ hasResolved: true, isError: false, entries: [], reach: new Map(), refetch: mockRefetch }),
}));
jest.mock("../../../hooks/marketing/useBrandPersonConflicts", () => ({
  useBrandPersonConflicts: () => ({ kind: "success", openCount: 0, rows: [], refetch: mockRefetch }),
  useResolveBrandPersonConflict: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../ui/useShareNetworkState", () => ({ useShareNetworkState: () => mockOnline }), { virtual: true });
jest.mock("../MarketingBrandSwitcherContext", () => ({ useMarketingBrandSwitcher: () => jest.fn() }));
jest.mock("../../../features/people/peopleAnalytics", () => ({ capturePeople: mockCapturePeople }));
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  ensureBrandBuyersAudience: jest.fn(),
  ensureEventBuyersAudience: jest.fn(),
}));
jest.mock("../../ui/Button", () => ({
  Button: React.forwardRef(function MockButton(props: any, ref) {
    return React.createElement("MockButton", { ...props, ref });
  }),
}));
jest.mock("../../ui/EmptyState", () => ({ EmptyState: ({ title }: any) => <Text>{title}</Text> }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../ui/RetryableLazyBoundary", () => ({
  createRetryableLazyErrorBoundary: () => () => null,
  RetryableLazyErrorBoundary: (props: any) => React.createElement(
    "MockLazyBoundary",
    props,
    props.componentProps?.visible ? <Text>EXPORT SHEET OPEN</Text> : null,
  ),
}));
jest.mock("../../marketing/AudienceCard", () => ({ AudienceCard: () => null, ManualGroupCard: () => null }));
jest.mock("../ManualGroupsLoader", () => ({ ManualGroupsLoader: () => null }));
jest.mock("../ConflictReviewSheet", () => ({ ConflictReviewSheet: () => null, ConflictReviewStrip: () => null }));
jest.mock("../PeoplePrimitives", () => ({
  PeopleBlock: ({ title, children, testID }: any) => <View testID={testID}><Text>{title}</Text>{children}</View>,
  DependencyStatus: ({ status }: any) => <Text>{status}</Text>,
  PeopleRow: ({ person }: any) => <Text>{person.displayName}</Text>,
  BookSheet: () => null,
  GroupsSheet: () => null,
}));

// Jest requires dependency mocks before loading the rendered screen.
// eslint-disable-next-line import/first
import { PeoplePage } from "../PeoplePage";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

let tree: any;
const render = (): void => {
  TR.act(() => { tree = TR.create(<PeoplePage />); });
};
const update = (): void => {
  TR.act(() => { tree.update(<PeoplePage />); });
};
const buttons = (): any[] => tree.root.findAllByType("MockButton");
const button = (label: string): any => buttons().find((node: any) => node.props.label === label);
const exportBoundary = (): any => tree.root.findAllByType("MockLazyBoundary")
  .find((node: any) => node.props.loadingLabel === "Opening export…");

beforeEach(() => {
  mockBrand = { id: "brand-a" };
  mockRole = {
    isLoading: false,
    isError: false,
    accepted: true,
    rank: 50,
    refetch: jest.fn(async () => undefined),
  };
  mockLayout = { isWideDesktop: false, width: 390 };
  mockOnline = true;
  mockContactImport = true;
  mockCapturePeople.mockClear();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});

afterEach(() => {
  if (tree !== undefined) TR.act(() => tree.unmount());
  tree = undefined;
});

describe("#1776 rendered People export wiring", () => {
  test("renders Add, Import, Export, and See all in order with Export as the outlined action", () => {
    render();
    expect(buttons().map((node: any) => node.props.label)).toEqual([
      "Add",
      "Import",
      "Export",
      "See all",
    ]);
    expect(button("Add").props.accentColor).toBeDefined();
    expect(button("Export").props).toMatchObject({
      leadingIcon: "download",
      variant: "ghost",
      fullWidth: true,
      accessibilityLabel: "Export brand contact book",
      disabled: false,
    });
    expect(button("Export").parent.parent.props.style).toMatchObject({ flexBasis: "48%", flexGrow: 1, minWidth: 0 });

    mockLayout = { isWideDesktop: true, width: 1200 };
    update();
    expect(button("Export").parent.parent.props.style).toMatchObject({ flexBasis: 0, flexGrow: 1, minWidth: 0 });

    mockLayout = { isWideDesktop: false, width: 340 };
    update();
    expect(button("Export").parent.parent.props.style).toMatchObject({ flexBasis: "100%", flexGrow: 1, minWidth: 0 });
  });

  test("gates Export at brand-admin rank and opens the exact selected-brand sheet", () => {
    mockRole = { ...mockRole, rank: 49 };
    render();
    expect(button("Export").props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: "people-export-permission-caption" }).props.children).toBe(
      "Your role doesn't include this action. Ask a brand admin or above.",
    );

    mockRole = { ...mockRole, rank: 50 };
    update();
    expect(button("Export").props.disabled).toBe(false);
    TR.act(() => button("Export").props.onPress());

    expect(mockCapturePeople).toHaveBeenCalledWith("people_book_export_opened", { surface: "page" });
    expect(exportBoundary().props.componentProps).toMatchObject({
      visible: true,
      brandId: "brand-a",
      contactCount: 3,
      online: true,
      authorized: true,
      permissionCaption: "Your role doesn't include this action. Ask a brand admin or above.",
    });
  });

  test("keeps an in-flight export mounted after close but discards it on brand switch", () => {
    render();
    TR.act(() => button("Export").props.onPress());
    expect(exportBoundary().props.componentProps.visible).toBe(true);

    TR.act(() => exportBoundary().props.componentProps.onClose());
    expect(exportBoundary()).toBeDefined();
    expect(exportBoundary().props.componentProps.visible).toBe(false);

    mockBrand = { id: "brand-b" };
    update();
    expect(exportBoundary()).toBeUndefined();
  });
});
