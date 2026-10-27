import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AREA,
  canOpenPage,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
} from "../lib/access.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { SUPPORT_PAGE_TABS } from "../lib/supportCommunityTabs.js";

const read = (relative: string) =>
  Deno.readTextFile(new URL(`../${relative}`, import.meta.url));
const page = await read("pages/CommunitySupportPage.jsx");
const support = await read("pages/SupportDeskPage.jsx");
const auth = await read("context/AuthContext.jsx");

const tabs = [
  "overview",
  "announcements",
  "roadmap",
  "moderation",
  "support",
  "email",
  "team",
  "availability",
  "cutover",
].map((id) => ({ id, label: id }));
const access = (...areas: string[]) => ({
  email: "staff@example.test",
  role: "growth",
  status: "active",
  areas,
});

Deno.test("operational capability opens only Community & Support", () => {
  const supportAccess = access(
    AREA.ROLE_HOME,
    COMMUNITY_SUPPORT_AREA,
    SUPPORT_OPERATIONS_AREA,
  );
  assert(canOpenPage(supportAccess, "community-support"));
  assertEquals(canOpenPage(supportAccess, "overview"), false);
  assertEquals(canOpenPage(supportAccess, "admin"), false);
  assertEquals(canOpenPage(supportAccess, "email"), false);
});

Deno.test("full admins retain all tabs while scoped assignments see only safe tabs", () => {
  // [TEST-MOD-APPROVED #3720] Wave 7 adds the scoped moderation tab and keeps cutover Admin-only.
  assertEquals(
    communitySupportTabsForAccess(access(AREA.ADMIN_CONSOLE), tabs)
      .map((tab: { id: string }) => tab.id),
    tabs.map((tab) => tab.id),
  );
  assertEquals(
    communitySupportTabsForAccess(
      access(COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA),
      tabs,
    )
      .map((tab: { id: string }) => tab.id),
    // #4130 Wave 6: Availability is the header switch and Overview was
    // retired, so no area grants either as a tab any more.
    ["support"],
  );
  assertEquals(
    communitySupportTabsForAccess(
      access(COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA),
      tabs,
    )
      .map((tab: { id: string }) => tab.id),
    ["moderation"],
  );
  assertEquals(
    communitySupportTabsForAccess(
      access(
        COMMUNITY_SUPPORT_AREA,
        SUPPORT_OPERATIONS_AREA,
        COMMUNITY_OPERATIONS_AREA,
      ),
      tabs,
    ).map((tab: { id: string }) => tab.id),
    ["moderation", "support"],
  );
  // #4130 Wave 6: a page opens on its first tab the person may see; for
  // Support staff that is the inbox.
  assertEquals(
    communitySupportTabsForAccess(access(SUPPORT_OPERATIONS_AREA), SUPPORT_PAGE_TABS)[0]?.id,
    "support",
  );
});

Deno.test("the page applies scoped tabs and keeps staff-management admin-only", () => {
  assertMatch(
    page,
    // #4130 Wave 6: each page filters its own tab list.
    /communitySupportTabsForAccess\(access, pageTabs\)/,
  );
  assertMatch(
    page,
    /<SupportDeskPage embedded canManageAgents=\{capabilities\.isAdmin\}/,
  );
  // [TEST-MOD-APPROVED #3988] The teammate Overview now shows their fused
  // Community and Support role cards instead of the old Moderation-only note.
  assertMatch(
    page,
    /You're a Support teammate: you work both Community and Support\./,
  );
  assertMatch(support, /canManageAgents\s*=\s*true/);
  assertMatch(support, /\{canManageAgents && \(/);
  assertNotMatch(support, /canManageAgents\s*\|\|\s*public\.is_admin_user/);
});

Deno.test("operational access stays server-owned and refreshes without sign-out", () => {
  assertMatch(auth, /rpc\("admin_team_my_operational_areas"\)/);
  assertMatch(auth, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assertMatch(
    auth,
    /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/,
  );
  assertMatch(auth, /window\.setInterval\(refreshWhenVisible, 30_000\)/);
  assertMatch(auth, /refreshCurrentAccess,/);
  assert(!/role\s*===\s*["'](?:owner|admin|growth|partner)["']/.test(auth));
});
