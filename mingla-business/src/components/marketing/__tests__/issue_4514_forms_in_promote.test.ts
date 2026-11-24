/**
 * #4514 wave 2 — Forms in Promote: one entry in marketingSubNavTabs.ts drives
 * the phone pill and the desktop side-menu item, after Referrals.
 *
 * FAILS-ON-REVERT: deleting the entry, moving it, or dropping the detail-route
 * rule turns a case red.
 */

import fs from "node:fs";
import path from "node:path";

import {
  MARKETING_SECTION_TITLES,
  MARKETING_SUB_NAV_TABS,
  detectMarketingSubNavActive,
  isMarketingDetailRoute,
} from "../marketingSubNavTabs";
import { MARKETING_TAB_ACTIONS } from "../marketingTabActions";
import { activeSidebarKey, buildSidebarGroups } from "../../ui/DesktopSidebar";

// DesktopSidebar pulls in expo-router and the shell; the same stubs as the #4420 nav suite.
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => "/home" }));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_BUSINESS_LOGO: 1 }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

const root = path.resolve(__dirname, "../../../..");

describe("Forms in Promote", () => {
  it("sits right after Referrals and before People, with its route and a title", () => {
    const ids = MARKETING_SUB_NAV_TABS.map((t) => t.id);
    expect(ids.indexOf("forms")).toBe(ids.indexOf("referrals") + 1);
    expect(ids.indexOf("people")).toBe(ids.indexOf("forms") + 1);
    const forms = MARKETING_SUB_NAV_TABS.find((t) => t.id === "forms");
    expect(forms).toEqual({ id: "forms", label: "Forms", path: "/(tabs)/marketing/forms" });
    expect(MARKETING_SECTION_TITLES.forms).toBe("Forms");
    expect(MARKETING_TAB_ACTIONS.forms.label).toBe("Create a form");
  });

  it("is a side-menu item in the Promote group, after Referrals, before the Audience group", () => {
    const { groups } = buildSidebarGroups([{ id: "home", label: "Home", icon: "home" }, { id: "marketing", label: "Blast", icon: "send" }] as never);
    const promote = groups.find((g) => g.key === "promote");
    const keys = promote?.items.map((i) => i.key) ?? [];
    expect(keys.indexOf("forms")).toBe(keys.indexOf("referrals") + 1);
    expect(groups.find((g) => g.key === "audience")?.items.map((i) => i.key)).not.toContain("forms");
    expect(activeSidebarKey("/marketing/forms")).toBe("forms");
    expect(activeSidebarKey("/marketing/forms/abc/responses")).toBe("forms");
  });

  it("marks the right tab active and steps the pills aside on the builder and Responses", () => {
    expect(detectMarketingSubNavActive("/marketing/forms")).toBe("forms");
    expect(detectMarketingSubNavActive("/marketing/forms/abc")).toBe("forms");
    expect(isMarketingDetailRoute("/marketing/forms")).toBe(false);
    expect(isMarketingDetailRoute("/marketing/forms/9b2d")).toBe(true);
    expect(isMarketingDetailRoute("/marketing/forms/9b2d/responses")).toBe(true);
  });

  it("has its routes, each loaded on demand", () => {
    for (const rel of [
      "app/(tabs)/marketing/forms/index.tsx",
      "app/(tabs)/marketing/forms/[formId]/index.tsx",
      "app/(tabs)/marketing/forms/[formId]/responses.tsx",
    ]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      expect(source).toMatch(/React\.lazy/);
      expect(source).not.toMatch(/^import .*src\/components\/forms\//m);
    }
  });
});
