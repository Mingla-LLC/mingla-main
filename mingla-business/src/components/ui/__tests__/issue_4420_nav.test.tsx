/**
 * #4420 B5 / B6 — the navigation shell.
 *
 * FAILS ON REVERT:
 *   - Create shows below event_manager (40), or loses its rank threshold.
 *   - The tab bar renders with fewer than 2 destinations (scanner, first-run).
 *   - Account comes back into the tab bar.
 *   - The profile button stops routing to /(tabs)/account.
 *   - The desktop sidebar shows Promote / Audience to a rank that cannot see Blast.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/home",
}));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_BUSINESS_LOGO: 1 }));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "seth@example.com", user_metadata: { full_name: "Seth" } } }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => null }));
jest.mock("../../../hooks/useBusinessNotifications", () => ({ useBusinessNotificationsInbox: () => ({ unreadCount: 0 }) }));
jest.mock("../../../hooks/useBrandGroups", () => ({ useBrandGroups: () => ({ unreadCount: 0 }) }));
jest.mock("../../../hooks/useBrandEnquiries", () => ({ useBrandEnquiries: () => ({ data: undefined }) }));
jest.mock("../BrandChip", () => ({ BrandChip: () => null }));
jest.mock("../IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../Toast", () => ({ Toast: () => null }));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../GlassChrome", () => ({ GlassChrome: ({ children }: { children: React.ReactNode }) => children }));

import { BRAND_ROLE_RANK, NO_MEMBERSHIP_RANK } from "../../../utils/brandRole";
import { MIN_RANK_FOR_TAB, shouldShowTabBar, visibleTabsForRank } from "../../../utils/navTabGate";
import { firstRunVisibleTabs } from "../../../utils/firstRunState";
import { SIDEBAR_SOURCE_TABS, buildSidebarGroups } from "../DesktopSidebar";
import { ProfileButton } from "../TopBar";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] };
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The TABS literal, read from the shell so the test follows the real list. */
const layoutSource = fs.readFileSync(path.resolve(__dirname, "../../../../app/(tabs)/_layout.tsx"), "utf8");
const tabsBlock = layoutSource.slice(layoutSource.indexOf("const TABS"), layoutSource.indexOf("];", layoutSource.indexOf("const TABS")));
const TAB_IDS = [...tabsBlock.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
const TABS = TAB_IDS.map((id) => ({ id, icon: "home" as const, label: id }));
const ids = (tabs: { id: string }[]): string[] => tabs.map((t) => t.id);

describe("#4420 B5 — phone tabs", () => {
  test("the shell's tabs are Home, Hub, Create, Ari, Blast; Account left the bar", () => {
    expect(TAB_IDS).toEqual(["home", "hub", "create", "ari", "marketing"]);
  });

  test("Create is gated at event_manager (40); rank values are unchanged", () => {
    expect(MIN_RANK_FOR_TAB.create).toBe(BRAND_ROLE_RANK.event_manager);
    expect(MIN_RANK_FOR_TAB.hub).toBe(30);
    expect(MIN_RANK_FOR_TAB.marketing).toBe(20);
  });

  test("tab sets per rank", () => {
    expect(ids(visibleTabsForRank(TABS, BRAND_ROLE_RANK.event_manager))).toEqual(["home", "hub", "create", "ari", "marketing"]);
    expect(ids(visibleTabsForRank(TABS, BRAND_ROLE_RANK.finance_manager))).toEqual(["home", "hub", "ari", "marketing"]);
    expect(ids(visibleTabsForRank(TABS, BRAND_ROLE_RANK.marketing_manager))).toEqual(["home", "marketing"]);
    expect(ids(visibleTabsForRank(TABS, BRAND_ROLE_RANK.scanner))).toEqual(["home"]);
    expect(ids(visibleTabsForRank(TABS, BRAND_ROLE_RANK.venue_staff))).toEqual(["home"]);
    expect(ids(visibleTabsForRank(TABS, NO_MEMBERSHIP_RANK))).toContain("ari");
  });

  test("the tab bar hides below 2 destinations (Create does not count)", () => {
    expect(shouldShowTabBar(visibleTabsForRank(TABS, BRAND_ROLE_RANK.scanner))).toBe(false);
    expect(shouldShowTabBar([{ id: "home" }, { id: "create" }])).toBe(false);
    expect(shouldShowTabBar(visibleTabsForRank(TABS, BRAND_ROLE_RANK.marketing_manager))).toBe(true);
    // First-run host: Ari only once Account left the bar.
    const firstRun = firstRunVisibleTabs(visibleTabsForRank(TABS, NO_MEMBERSHIP_RANK), TABS, "no_brand");
    expect(ids(firstRun)).toEqual(["ari"]);
    expect(shouldShowTabBar(firstRun)).toBe(false);
  });

  test("the profile button opens /(tabs)/account", async () => {
    mockPush.mockClear();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<ProfileButton />);
    });
    const [button] = renderer.root.findAll((n) => n.props.testID === "topbar-profile-button" && typeof n.props.onPress === "function");
    await TestRenderer.act(async () => {
      (button.props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/account");
    renderer.unmount();
  });
});

describe("#4420 B6 — desktop sidebar", () => {
  test("the sidebar's source tabs are the (tabs) TABS minus Create", () => {
    expect(SIDEBAR_SOURCE_TABS.map((t) => t.id)).toEqual(TAB_IDS.filter((id) => id !== "create"));
  });

  test("groups: main, Promote, Audience; Account pinned; no Blast item, no Insights", () => {
    const { groups, account } = buildSidebarGroups(visibleTabsForRank(TABS, BRAND_ROLE_RANK.event_manager));
    expect(groups.map((g) => g.title)).toEqual([null, "Promote", "Audience"]);
    expect(groups[0].items.map((i) => i.key)).toEqual(["home", "hub", "ari"]);
    expect(groups[1].items.map((i) => i.key)).toEqual(["overview", "campaigns", "ads", "creators", "referrals"]);
    expect(groups[2].items.map((i) => i.key)).toEqual(["people", "templates"]);
    expect(account?.path).toBe("/(tabs)/account");
    const allKeys = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(allKeys).not.toContain("marketing");
    expect(allKeys).not.toContain("analytics");
  });

  test("the rank filter applies to sidebar items", () => {
    const scanner = buildSidebarGroups(visibleTabsForRank(TABS, BRAND_ROLE_RANK.scanner));
    expect(scanner.groups.map((g) => g.title)).toEqual([null]);
    expect(scanner.groups[0].items.map((i) => i.key)).toEqual(["home"]);
    const marketer = buildSidebarGroups(visibleTabsForRank(TABS, BRAND_ROLE_RANK.marketing_manager));
    expect(marketer.groups.map((g) => g.title)).toEqual([null, "Promote", "Audience"]);
    expect(marketer.groups[0].items.map((i) => i.key)).toEqual(["home"]);
  });
});
