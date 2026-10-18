import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  DATA_ROOM_AREA,
  PAGE_ADDITIONAL_AREAS,
  SUPPORT_OPERATIONS_AREA,
  TEAM_NOTIFICATIONS_AREA,
  canOpenPage,
} from "../lib/access.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";

const tabs = [
  "overview", "announcements", "roadmap", "support", "email", "team", "availability",
].map((id) => ({ id, label: id }));
const access = (...areas: string[]) => ({
  email: "adversary@example.test",
  role: "growth",
  status: "active",
  areas,
});

Deno.test("a sub-capability alone cannot open any Admin page", () => {
  for (const area of [SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA]) {
    const candidate = access(area);
    for (const page of ["community-support", "overview", "admin", "email", "__proto__", "constructor"]) {
      assertEquals(canOpenPage(candidate, page), false, `${area} unexpectedly opened ${page}`);
    }
  }
});

Deno.test("additional page exceptions stay one-to-one with server capabilities", () => {
  assertEquals(PAGE_ADDITIONAL_AREAS, {
    "community-support": [COMMUNITY_SUPPORT_AREA],
    notifications: [TEAM_NOTIFICATIONS_AREA],
    "data-room": [DATA_ROOM_AREA],
  });
  const candidate = access(COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA);
  assertEquals(canOpenPage(candidate, "community-support"), true);
  for (const page of ["overview", "announcements", "roadmap", "email", "team", "availability"]) {
    assertEquals(canOpenPage(candidate, page), false, `scoped staff unexpectedly opened ${page}`);
  }
  assertEquals(canOpenPage(access(TEAM_NOTIFICATIONS_AREA), "notifications"), true);
  assertEquals(canOpenPage(access(TEAM_NOTIFICATIONS_AREA), "data-room"), false);
  assertEquals(canOpenPage(access(DATA_ROOM_AREA), "data-room"), true);
  assertEquals(canOpenPage(access(DATA_ROOM_AREA), "notifications"), false);
});

Deno.test("hash manipulation cannot add a forbidden tab", () => {
  const supportTabs = communitySupportTabsForAccess(
    access(COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA),
    tabs,
  ).map((tab: { id: string }) => tab.id);
  assertEquals(supportTabs, ["support", "availability"]);

  const communityTabs = communitySupportTabsForAccess(
    access(COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA),
    tabs,
  ).map((tab: { id: string }) => tab.id);
  assertEquals(communityTabs, ["overview"]);
});

Deno.test("full-admin tabs still depend only on the original admin_console area", () => {
  assertEquals(
    communitySupportTabsForAccess(access(AREA.ADMIN_CONSOLE), tabs)
      .map((tab: { id: string }) => tab.id),
    tabs.map((tab) => tab.id),
  );
  assertEquals(
    communitySupportTabsForAccess(access(COMMUNITY_SUPPORT_AREA), tabs),
    [],
  );
});
