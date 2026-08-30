import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Text, View } from "react-native";

const router = { push: jest.fn(), replace: jest.fn() };
const capturePeople = jest.fn();
let routeParams: { review?: string | string[] } = { review: "conflicts" };
let roleState = {
  isLoading: false,
  isError: false,
  accepted: true,
  rank: 10,
};
let conflictState = {
  kind: "success",
  openCount: 1,
  rows: [{ createdAt: "2026-08-30T12:00:00.000Z" }],
};

jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => routeParams,
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "actor-1" } }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ id: "brand-1" }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => roleState,
}));
jest.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    isPending: false,
    isFetching: false,
    isError: false,
    data: false,
  }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false, width: 390 }),
}));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({
  useStickyFooterOffset: () => 120,
}));
jest.mock("../../../hooks/marketing/useBrandPeople", () => ({
  useBrandPeople: () => ({
    kind: "success",
    rows: [],
    bookTotal: 0,
    filteredTotal: 0,
    hasResolved: true,
    isError: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    refetch: jest.fn(async () => undefined),
    fetchNextPage: jest.fn(async () => undefined),
  }),
}));
jest.mock("../../../hooks/marketing/useAudienceList", () => ({
  useAudienceList: () => ({
    hasResolved: true,
    isError: false,
    entries: [],
    reach: new Map(),
    refetch: jest.fn(async () => undefined),
  }),
}));
jest.mock("../../../hooks/marketing/useBrandPersonConflicts", () => ({
  useBrandPersonConflicts: () => ({
    ...conflictState,
    refetch: jest.fn(async () => undefined),
  }),
  useResolveBrandPersonConflict: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
jest.mock("../MarketingBrandSwitcherContext", () => ({
  useMarketingBrandSwitcher: () => jest.fn(),
}));
jest.mock("../../../features/people/peopleAnalytics", () => ({ capturePeople }));
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  ensureBrandBuyersAudience: jest.fn(),
  ensureEventBuyersAudience: jest.fn(),
}));
jest.mock("../../ui/RetryableLazyBoundary", () => ({
  createRetryableLazyErrorBoundary: () => () => null,
  RetryableLazyErrorBoundary: () => null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));
jest.mock("../../ui/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
}));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../marketing/AudienceCard", () => ({
  AudienceCard: () => null,
  ManualGroupCard: () => null,
}));
jest.mock("../ConflictReviewSheet", () => ({
  ConflictReviewStrip: () => null,
  ConflictReviewSheet: ({ visible }: { visible: boolean }) =>
    visible ? <Text>CONFLICT REVIEW OPEN</Text> : null,
}));
jest.mock("../PeoplePrimitives", () => ({
  PeopleBlock: ({ children }: { children: React.ReactNode }) => (
    <View>{children}</View>
  ),
  DependencyStatus: () => null,
  PeopleRow: () => null,
  BookSheet: () => null,
  GroupsSheet: () => null,
}));

// Jest requires dependency mocks before the page module.
// eslint-disable-next-line import/first
import { PeoplePage } from "../PeoplePage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => {
    root: { findAllByType: (type: unknown) => any[] };
    update: (node: React.ReactElement) => void;
  };
};

function conflictSheetIsOpen(
  tree: ReturnType<typeof TestRenderer.create>,
): boolean {
  return tree.root.findAllByType(Text).some(
    (node) => node.props.children === "CONFLICT REVIEW OPEN",
  );
}

function queueOpenEvents(): unknown[][] {
  return capturePeople.mock.calls.filter(
    ([event]) => event === "people_conflict_queue_opened",
  );
}

beforeEach(() => {
  routeParams = { review: "conflicts" };
  roleState = {
    isLoading: false,
    isError: false,
    accepted: true,
    rank: 10,
  };
  conflictState = {
    kind: "success",
    openCount: 1,
    rows: [{ createdAt: "2026-08-30T12:00:00.000Z" }],
  };
  router.push.mockClear();
  router.replace.mockClear();
  capturePeople.mockClear();
});

describe("#1772 conflict-review deep link tester adversarial", () => {
  test("a sub-rank signal is consumed and cannot resurrect after later promotion", () => {
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<PeoplePage />);
    });

    expect(conflictSheetIsOpen(tree)).toBe(false);
    expect(queueOpenEvents()).toHaveLength(0);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/(tabs)/marketing/people");

    roleState = { ...roleState, rank: 50 };
    TestRenderer.act(() => tree.update(<PeoplePage />));

    expect(conflictSheetIsOpen(tree)).toBe(false);
    expect(queueOpenEvents()).toHaveLength(0);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  test("an array-shaped or otherwise non-exact signal cannot open a populated queue", () => {
    roleState = { ...roleState, rank: 50 };
    routeParams = { review: ["conflicts"] };
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<PeoplePage />);
    });

    expect(conflictSheetIsOpen(tree)).toBe(false);
    expect(queueOpenEvents()).toHaveLength(0);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/(tabs)/marketing/people");
  });
});
