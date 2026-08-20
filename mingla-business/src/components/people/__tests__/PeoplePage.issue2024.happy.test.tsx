import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const router = { push: jest.fn(), replace: jest.fn() };
let brand: { id: string } | null = { id: "brand-a" };
let role = { isLoading: false, isError: false, accepted: true, rank: 20 };
let auth = { isAuthReady: true, user: { id: "user-1" } };
let layout = { isWideDesktop: true, isWeb: true, width: 1440 };
let stickyOffset = 120;
let forcedKind: string | null = null;
const refetch = jest.fn(async () => {});
const fetchNextPage = jest.fn(async () => {});
const person = {
  personId: "person-1",
  displayName: "Ada",
  avatarUrl: null,
  updatedAt: "now",
  contacts: [
    {
      id: "contact-1",
      channel: "email",
      value: "ada@example.test",
      isPrimary: true,
    },
  ],
  suppressions: [],
};
const peopleHook = jest.fn(
  (_brand: string | null, _search: string | null, resolved: boolean, accepted: boolean, rank: number) => {
    const kind = forcedKind ?? (!resolved ? "roleLoading" : !accepted || rank < 20 ? "forbidden" : "success");
    return {
      kind,
      rows: kind === "forbidden" ? [] : [person],
      bookTotal: kind === "loading" ? null : 1,
      filteredTotal: kind === "loading" ? null : 1,
      hasResolved: kind !== "loading",
      isError: kind === "error",
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      refetch,
      fetchNextPage,
    };
  },
);
let groupState: {
  hasResolved: boolean;
  isError: boolean;
  entries: Record<string, unknown>[];
  reach: Map<string, unknown>;
  refetch: ReturnType<typeof jest.fn>;
};

jest.mock("expo-router", () => ({ useRouter: () => router }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => auth }));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => brand }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => role }));
jest.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ isPending: false, isFetching: false, isError: false, data: true }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => layout }));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({
  useStickyFooterOffset: () => stickyOffset,
}));
jest.mock("../../../hooks/marketing/useBrandPeople", () => ({
  useBrandPeople: (...args: [string | null, string | null, boolean, boolean, number]) =>
    peopleHook(args[0], args[1], args[2], args[3], args[4]),
}));
jest.mock("../../../hooks/marketing/useAudienceList", () => ({
  useAudienceList: () => groupState,
}));
// #2305 — same reason as useBrandPeople above: this suite renders PeoplePage with no
// QueryClientProvider. An empty queue is the #2024 baseline; the strip renders null.
jest.mock("../../../hooks/marketing/useBrandPersonConflicts", () => ({
  useBrandPersonConflicts: () => ({
    kind: "success",
    openCount: 0,
    rows: [],
    refetch: () => Promise.resolve(),
  }),
  useResolveBrandPersonConflict: () => ({
    mutateAsync: () => Promise.resolve({ personId: null, mergedPersonIds: [] }),
  }),
}));
jest.mock("../../ui/useShareNetworkState", () => ({ useShareNetworkState: () => true }), {
  virtual: true,
});
jest.mock("../MarketingBrandSwitcherContext", () => ({
  useMarketingBrandSwitcher: () => jest.fn(),
}));
jest.mock("../../../features/people/peopleAnalytics", () => ({ capturePeople: jest.fn() }));
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  ensureBrandBuyersAudience: jest.fn(),
  ensureEventBuyersAudience: jest.fn(),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));
jest.mock("../../ui/EmptyState", () => ({
  EmptyState: (props: { title: string; description?: string }) => (
    <View>
      <Text>{props.title}</Text>
      {props.description !== undefined ? <Text>{props.description}</Text> : null}
    </View>
  ),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => React.createElement("MockIcon") }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => React.createElement("MockSkeleton") }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../marketing/AudienceCard", () => ({
  AudienceCard: ({ entry }: { entry: { display_name: string } }) => <Text>{entry.display_name}</Text>,
}));
jest.mock("../AddPersonSheet", () => ({ AddPersonSheet: () => null }));
// #2305 — same reason as the Add sheet above: ConflictReviewSheet imports the
// reanimated-backed ConfirmDialog, which this suite does not transform.
jest.mock("../ConflictReviewSheet", () => ({
  ConflictReviewSheet: () => null,
  ConflictReviewStrip: () => null,
}));
jest.mock("../PeoplePrimitives", () => ({
  PeopleBlock: ({
    title,
    count,
    children,
    testID,
  }: {
    title: string;
    count?: string;
    children: React.ReactNode;
    testID?: string;
  }) => (
    <View testID={testID} style={{ width: "100%", padding: 16 }}>
      <Text accessibilityRole="header">{title}</Text>
      {count !== undefined ? <Text>{count}</Text> : null}
      {children}
    </View>
  ),
  DependencyStatus: ({ status, body }: { status: string; body: string }) => (
    <View>
      <Text>{status}</Text>
      <Text>{body}</Text>
    </View>
  ),
  PeopleRow: ({ person: row }: { person: { displayName: string } }) => (
    <Text>{row.displayName}</Text>
  ),
  BookSheet: ({ visible }: { visible: boolean }) => (visible ? <Text>BOOK SHEET</Text> : null),
  GroupsSheet: () => null,
}));

// Jest requires dependency mocks before the real component import.
// eslint-disable-next-line import/first
import { PeoplePage } from "../PeoplePage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const textOf = (json: any): string => {
  if (typeof json === "string") return json;
  if (Array.isArray(json)) return json.map(textOf).join(" ");
  if (json !== null && typeof json === "object") return textOf(json.children ?? []);
  return "";
};

let tree: any;
const renderPage = (): void => {
  TestRenderer.act(() => {
    tree = TestRenderer.create(<PeoplePage />);
  });
};
const campaignFabs = (): any[] =>
  tree.root.findAll(
    (node: any) => node.type === Pressable && node.props.testID === "people-new-campaign",
  );

beforeEach(() => {
  brand = { id: "brand-a" };
  role = { isLoading: false, isError: false, accepted: true, rank: 20 };
  auth = { isAuthReady: true, user: { id: "user-1" } };
  layout = { isWideDesktop: true, isWeb: true, width: 1440 };
  stickyOffset = 120;
  forcedKind = null;
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  router.push.mockClear();
  groupState = {
    hasResolved: true,
    isError: false,
    entries: [
      {
        client_key: "group-1",
        display_name: "Buyers",
        kind: "brand_buyers",
        brand_id: "brand-a",
        event_id: null,
        audience_id: "audience-1",
      },
    ],
    reach: new Map(),
    refetch: jest.fn(async () => {}),
  };
});

describe("issue #2024 rendered People workspace happy path", () => {
  test("renders only Book then Groups in the full-width 5:3 workspace", () => {
    renderPage();
    const output = textOf(tree.toJSON());
    expect(output).toMatch(/Your book.*Groups/);
    expect(output).not.toMatch(
      /People you can reach|Reach unavailable|Followers|Extended circle|Export unavailable/,
    );
    const row = StyleSheet.flatten(tree.root.findByProps({ testID: "people-workspace-row" }).props.style);
    const bookColumn = StyleSheet.flatten(
      tree.root.findByProps({ testID: "people-book-column" }).props.style,
    );
    const groupsColumn = StyleSheet.flatten(
      tree.root.findByProps({ testID: "people-groups-column" }).props.style,
    );
    expect(row).toMatchObject({ flexDirection: "row", alignItems: "flex-start", gap: 24 });
    expect(bookColumn).toMatchObject({ flexBasis: 0, flexGrow: 5, minWidth: 0 });
    expect(groupsColumn).toMatchObject({ flexBasis: 0, flexGrow: 3, minWidth: 0 });
    const bookBlock = tree.root.find(
      (node: any) => node.type === View && node.props.testID === "people-book-block",
    );
    const groupsBlock = tree.root.find(
      (node: any) => node.type === View && node.props.testID === "people-groups-block",
    );
    expect(StyleSheet.flatten(bookBlock.props.style)).toMatchObject({ width: "100%", padding: 16 });
    expect(StyleSheet.flatten(groupsBlock.props.style)).toMatchObject({ width: "100%", padding: 16 });
    expect(StyleSheet.flatten(bookBlock.props.style).paddingRight).toBeUndefined();
    expect(StyleSheet.flatten(groupsBlock.props.style).paddingRight).toBeUndefined();
  });

  test("keeps one visually hidden People heading without a visible duplicate", () => {
    renderPage();
    const headings = tree.root.findAll(
      (node: any) => node.type === Text && node.props.accessibilityRole === "header",
    );
    const peopleHeadings = headings.filter((node: any) => textOf(node.props.children) === "People");
    expect(peopleHeadings).toHaveLength(1);
    expect(StyleSheet.flatten(peopleHeadings[0].props.style)).toMatchObject({
      position: "absolute",
      width: 1,
      height: 1,
      opacity: 0,
    });
  });

  test("floats the sticky-footer campaign action and opens the exact composer once", () => {
    renderPage();
    const fab = campaignFabs()[0];
    expect(fab.props.accessibilityLabel).toBe("New campaign");
    expect(StyleSheet.flatten(fab.props.style({ pressed: false }))).toMatchObject({ bottom: 120 });
    const scroll = tree.root.findByType(ScrollView);
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
      paddingBottom: 120,
    });
    TestRenderer.act(() => fab.props.onPress());
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/marketing/campaigns/compose");
  });

  test.each([
    { name: "iPhone SE", width: 320, height: 568, bottom: 120 },
    { name: "modern compact", width: 390, height: 844, bottom: 132 },
  ])("matches the sibling full-canvas FAB contract on $name", ({ width, bottom }) => {
    layout = { isWideDesktop: false, isWeb: false, width };
    stickyOffset = bottom;
    renderPage();
    const scroll = tree.root.findByType(ScrollView);
    const scrollStyle = StyleSheet.flatten(scroll.props.style);
    const contentStyle = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(scrollStyle?.marginBottom).toBeUndefined();
    expect(contentStyle.paddingBottom).toBe(120);
    expect(tree.root.findAllByProps({ testID: "people-fab-exclusion" })).toHaveLength(0);
    const bookStyle = StyleSheet.flatten(
      tree.root.find((node: any) => node.type === View && node.props.testID === "people-book-block")
        .props.style,
    );
    expect(bookStyle).toMatchObject({ width: "100%", padding: 16 });
    expect(bookStyle.paddingRight).toBeUndefined();
    const groupsStyle = StyleSheet.flatten(
      tree.root.find((node: any) => node.type === View && node.props.testID === "people-groups-block")
        .props.style,
    );
    expect(groupsStyle).toMatchObject({ width: "100%", padding: 16 });
    expect(groupsStyle.paddingRight).toBeUndefined();
    expect(StyleSheet.flatten(campaignFabs()[0].props.style({ pressed: false }))).toMatchObject({
      right: 16,
      bottom,
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 8,
    });
  });

  test("keeps the FAB in authorized loading and error states but removes it when forbidden", () => {
    forcedKind = "loading";
    renderPage();
    expect(campaignFabs()).toHaveLength(1);
    forcedKind = "error";
    TestRenderer.act(() => tree.update(<PeoplePage />));
    expect(campaignFabs()).toHaveLength(1);
    forcedKind = "forbidden";
    TestRenderer.act(() => tree.update(<PeoplePage />));
    expect(campaignFabs()).toHaveLength(0);
    expect(textOf(tree.toJSON())).not.toMatch(/Ada|Buyers/);
  });

  test("removes the workspace and FAB from interaction while a People sheet is open", () => {
    renderPage();
    const seeAll = tree.root
      .findAllByType("MockButton")
      .find((node: any) => node.props.label === "See all");
    expect(seeAll).toBeDefined();
    TestRenderer.act(() => seeAll.props.onPress());
    const workspace = tree.root.findByProps({ testID: "people-workspace" });
    expect(workspace.props).toMatchObject({
      pointerEvents: "none",
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });
    expect(textOf(tree.toJSON())).toContain("BOOK SHEET");
  });
});
