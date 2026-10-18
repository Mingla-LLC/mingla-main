import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AREA,
  canOpenPage,
  COMMUNITY_SUPPORT_AREA,
  DATA_ROOM_AREA,
  SUPPORT_OPERATIONS_AREA,
  TEAM_NOTIFICATIONS_AREA,
} from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";

const read = (relative: string) =>
  Deno.readTextFile(new URL(`../${relative}`, import.meta.url));
const access = (role: string, ...areas: string[]) => ({
  email: `${role}@example.test`,
  role,
  status: "active",
  areas,
});

Deno.test("#3720 every active role can open Support and Notifications without Admin authority", () => {
  for (const role of ["owner", "admin", "growth", "partner"]) {
    const candidate = access(
      role,
      COMMUNITY_SUPPORT_AREA,
      SUPPORT_OPERATIONS_AREA,
      TEAM_NOTIFICATIONS_AREA,
    );
    assert(canOpenPage(candidate, "community-support"), role);
    assert(canOpenPage(candidate, "notifications"), role);
    assertEquals(canOpenPage(candidate, "business-money-ledger"), false, role);
    assertEquals(canOpenPage(candidate, "admin"), false, role);
  }
});

Deno.test("#3720 Data room is independently capability-gated", () => {
  assertEquals(
    canOpenPage(access("partner", DATA_ROOM_AREA), "data-room"),
    true,
  );
  assertEquals(
    canOpenPage(access("growth", TEAM_NOTIFICATIONS_AREA), "data-room"),
    false,
  );
  assertEquals(
    canOpenPage(access("growth", DATA_ROOM_AREA), "notifications"),
    false,
  );
  const company = NAV_GROUPS.find((group) => group.label === "Company");
  assertEquals(company?.items.at(-1), {
    id: "data-room",
    label: "Data room",
    icon: "FolderLock",
  });
});

Deno.test("#3720 mention UI uses one RPC and email is explicitly opt-in", async () => {
  const [drawer, service, page, migration] = await Promise.all([
    read("components/contentCalendar/ContentDrawer.jsx"),
    read("services/contentCalendarService.js"),
    read("pages/NotificationsPage.jsx"),
    Deno.readTextFile(
      new URL(
        "../../../supabase/migrations/20271102003720_issue_3720_team_collaboration_access.sql",
        import.meta.url,
      ),
    ),
  ]);
  assertMatch(drawer, /Mention teammates/);
  assertMatch(service, /content_calendar_comment_add_with_mentions/);
  assertMatch(page, /Email is off until you opt in here/);
  assertMatch(
    migration,
    /p_category_key = 'admin[.]team_mention' AND p_channel = 'email'/,
  );
  assertMatch(migration, /v_pref_enabled IS DISTINCT FROM true/);
});

Deno.test("#3720 Data room browser code receives only brokered manifest and document bytes", async () => {
  const [service, page, edge] = await Promise.all([
    read("services/teamCollaborationService.js"),
    read("pages/DataRoomPage.jsx"),
    Deno.readTextFile(
      new URL(
        "../../../supabase/functions/admin-data-room/index.ts",
        import.meta.url,
      ),
    ),
  ]);
  assertMatch(service, /invokeWithRefresh\("admin-data-room"/);
  assertMatch(page, /Every room and document open is recorded/);
  assertNotMatch(
    `${service}\n${page}`,
    /GOOGLE_CALENDAR_KEYS|private-google-file-id|provider_url/,
  );
  assertMatch(edge, /Deno[.]env[.]get\("GOOGLE_CALENDAR_KEYS"\)/);
  assertMatch(edge, /dataRoomKey/);
  assertNotMatch(edge, /MINGLA_DATA_ROOM_(?:ORIGIN|TOKEN)/);
  assertMatch(edge, /issue_3720_log_data_room_access/);
  assertMatch(edge, /owner.*admin.*partner/s);
});

Deno.test("#3720 permission matrix does not widen role areas or protected Admin authority", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../supabase/migrations/20271102003720_issue_3720_team_collaboration_access.sql",
      import.meta.url,
    ),
  );
  assertMatch(migration, /support_money_or_account_changes', false/);
  assertMatch(
    migration,
    /current_setting\('issue3720_wave6[.]is_admin_user_md5'\)/,
  );
  assertMatch(migration, /issue3720_nonadmin_privilege_drift/);
  assertNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public[.]is_admin_user/,
  );
  assertNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public[.]admin_team_role_areas/,
  );
  assertNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public[.]admin_team_my_access/,
  );
  assertEquals(
    canOpenPage(access("growth", AREA.ROLE_HOME), "data-room"),
    false,
  );
});
