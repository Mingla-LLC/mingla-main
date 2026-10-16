import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
  canOpenPage,
} from "../lib/access.js";
import {
  communitySupportTabsForAccess,
  defaultCommunitySupportTab,
} from "../lib/communitySupportAccess.js";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));
const page = await read("pages/CommunitySupportPage.jsx");
const support = await read("pages/SupportDeskPage.jsx");
const auth = await read("context/AuthContext.jsx");

const tabs = [
  "overview", "announcements", "roadmap", "support", "email", "team", "availability",
].map((id) => ({ id, label: id }));
const access = (...areas: string[]) => ({
  email: "staff@example.test",
  role: "growth",
  status: "active",
  areas,
});

Deno.test("operational capability opens only Community & Support", () => {
  const supportAccess = access(AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA);
  assert(canOpenPage(supportAccess, "community-support"));
  assertEquals(canOpenPage(supportAccess, "overview"), false);
  assertEquals(canOpenPage(supportAccess, "admin"), false);
  assertEquals(canOpenPage(supportAccess, "email"), false);
});

Deno.test("full admins retain all tabs while scoped assignments see only safe tabs", () => {
  assertEquals(
    communitySupportTabsForAccess(access(AREA.ADMIN_CONSOLE), tabs)
      .map((tab: { id: string }) => tab.id),
    tabs.map((tab) => tab.id),
  );
  assertEquals(
    communitySupportTabsForAccess(access(COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA), tabs)
      .map((tab: { id: string }) => tab.id),
    ["support", "availability"],
  );
  assertEquals(
    communitySupportTabsForAccess(access(COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA), tabs)
      .map((tab: { id: string }) => tab.id),
    ["overview"],
  );
  assertEquals(
    communitySupportTabsForAccess(
      access(COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA),
      tabs,
    ).map((tab: { id: string }) => tab.id),
    ["overview", "support", "availability"],
  );
  assertEquals(defaultCommunitySupportTab(access(SUPPORT_OPERATIONS_AREA)), "support");
});

Deno.test("the page applies scoped tabs and keeps staff-management admin-only", () => {
  assertMatch(page, /communitySupportTabsForAccess\(access, COMMUNITY_SUPPORT_TABS\)/);
  assertMatch(page, /<SupportDeskPage embedded canManageAgents=\{capabilities\.isAdmin\}/);
  assertMatch(page, /Community moderation tools will appear here when that workflow ships/);
  assertMatch(support, /canManageAgents\s*=\s*true/);
  assertMatch(support, /\{canManageAgents && \(/);
  assertNotMatch(support, /canManageAgents\s*\|\|\s*public\.is_admin_user/);
});

Deno.test("operational access stays server-owned and refreshes without sign-out", () => {
  assertMatch(auth, /rpc\("admin_team_my_operational_areas"\)/);
  assertMatch(auth, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assertMatch(auth, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assertMatch(auth, /window\.setInterval\(refreshWhenVisible, 30_000\)/);
  assertMatch(auth, /refreshCurrentAccess,/);
  assert(!/role\s*===\s*["'](?:owner|admin|growth|partner)["']/.test(auth));
});
