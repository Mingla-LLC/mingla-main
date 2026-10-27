import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  groupPeople,
  initialRoleChoice,
  permissionsErrorMessage,
  roleChoiceDoes,
  roleLabel,
  ROLE_CHOICES,
} from "../lib/peopleAndRoles.js";
import {
  TEAM_INVITE_FUNCTION,
  TEAM_INVITE_ROLE_OPTIONS,
  sendTeamInvite,
  teamInviteErrorMessage,
} from "../lib/teamInvite.js";
import { NOT_ON_SUPPORT_ROSTER_MESSAGE } from "../lib/supportAvailability.js";

// #3988 — People and roles: one Community & Support role per teammate, set by
// an Owner or Admin; the invite is the real team invite.

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

Deno.test("one role control: Off, Support teammate, Support lead", () => {
  assertEquals(ROLE_CHOICES.map((c) => c.id), ["off", "teammate", "lead"]);
  assertEquals(ROLE_CHOICES.map((c) => c.label), ["Off", "Support teammate", "Support lead"]);
  assert(roleChoiceDoes("teammate").includes("Moderation queue"));
  assert(roleChoiceDoes("teammate").includes("Tickets and live chats"));
  assert(roleChoiceDoes("lead").includes("Approve support → product work"));
  assertEquals(roleChoiceDoes("off"), []);
  assertEquals(roleLabel({ role: "included_rota" }), "Included · on rota");
  assertEquals(roleLabel({ role: "teammate" }), "Support teammate");
  assertEquals(initialRoleChoice({ role: "lead" }), "lead");
  assertEquals(initialRoleChoice({ role: "included" }), "off");
});

Deno.test("people are grouped into Team, Invited and Not on the team", () => {
  const groups = groupPeople([
    { email: "a", team_status: "active", effective: true },
    { email: "b", team_status: "invited", effective: true },
    { email: "c", team_status: "none", effective: false },
    { email: "d", team_status: "active", effective: true },
  ]);
  assertEquals(groups.team.map((r) => r.email), ["a", "d"]);
  assertEquals(groups.invited.map((r) => r.email), ["b"]);
  assertEquals(groups.former.map((r) => r.email), ["c"]);
});

Deno.test("save errors are plain words keyed on the server code", () => {
  assertEquals(permissionsErrorMessage({ message: "not_on_team" }), "They're not on the Mingla team. Invite them first.");
  assertEquals(permissionsErrorMessage({ message: "not_authorized" }), "Only Owners and Admins can change permissions.");
  assertEquals(permissionsErrorMessage(new Error("Failed to fetch")), "Couldn't save. Check your connection and try again.");
  assertEquals(permissionsErrorMessage({ message: "JWT expired" }), "Sign in again");
});

Deno.test("Invite teammate sends the real team invite and never throws", async () => {
  assertEquals(TEAM_INVITE_FUNCTION, "admin-team-invite");
  assertEquals(TEAM_INVITE_ROLE_OPTIONS.map((o) => o.id), ["growth", "admin", "partner"]);
  const calls: Array<[string, unknown]> = [];
  const invoke = (data: unknown, error: unknown = null) => (fn: string, options: unknown) => {
    calls.push([fn, options]);
    return Promise.resolve({ data, error });
  };
  assertEquals(
    await sendTeamInvite(invoke({ ok: true, email_sent: true }), { email: " New@Example.com ", role: "growth" }),
    { outcome: "sent", email: "new@example.com" },
  );
  assertEquals(calls, [["admin-team-invite", { body: { email: "new@example.com", role: "growth" } }]]);
  assertEquals((await sendTeamInvite(invoke({ ok: false, code: "forbidden" }), { email: "x@y.co", role: "admin" })).outcome, "refused");
  assertEquals((await sendTeamInvite(invoke(null, { context: { status: 401 } }), { email: "x@y.co", role: "admin" })).outcome, "session");
  assertEquals((await sendTeamInvite(() => Promise.reject(new Error("offline")), { email: "x@y.co", role: "admin" })).outcome, "unreachable");
  const before = calls.length;
  assertEquals((await sendTeamInvite(invoke({ ok: true }), { email: "not-an-email", role: "growth" })).outcome, "refused");
  assertEquals(calls.length, before, "an invalid address never reaches the server");
  assertEquals(teamInviteErrorMessage({ outcome: "refused", code: "forbidden" }), "Only the Owner can invite new teammates.");
});

Deno.test("People and roles reads and writes only through the #3988 RPCs", async () => {
  const [panel, service, page] = await Promise.all([
    read("components/community/TeamRolesPanel.jsx"),
    read("services/communityService.js"),
    read("pages/CommunitySupportPage.jsx"),
  ]);
  assertEquals(/profiles_with_segment|\.ilike\(|setCommunityStaff|listAdminTeamRoster/.test(panel), false);
  assertEquals(/<option value="agent"|"Agent"|>Agent</.test(panel), false, "no human Agent role");
  assertMatch(panel, /sendTeamInvite\(invokeWithRefresh, \{ email, role \}\)/);
  assertMatch(panel, /role="radiogroup"/);
  assertMatch(panel, /Only the Owner can invite new teammates|TEAM_INVITE_OWNER_ONLY/);
  assertMatch(service, /rpc\("issue_3988_admin_people"\)/);
  assertMatch(service, /rpc\("issue_3988_set_permissions", \{\s*p_user_id: userId,\s*p_role: role,/);
  assertMatch(service, /rpc\("issue_3988_remove_orphan_staff"/);
  assertMatch(page, /canInvite = Array\.isArray\(access\?\.areas\) && access\.areas\.includes\(AREA\.TEAM_MANAGE\)/);
  assertMatch(page, /activeTab === "team" && capabilities\.isAdmin && <TeamRolesPanel canInvite=\{canInvite\}/);
});

Deno.test("the Support desk no longer grants Support and links to People and roles", async () => {
  const desk = await read("pages/SupportDeskPage.jsx");
  assertEquals(desk.includes("support-grant-staff"), false);
  assertEquals(/>\s*Agents\s*</.test(desk) || desk.includes("Support agents"), false, "no Agents button or modal");
  assertMatch(desk, /Manage who's on Support/);
  // #4130 Wave 6: People and roles is a tab of the Support page.
  assertMatch(desk, /"#\/support\?tab=team"/);
});

Deno.test("the availability refusal says where Support is turned on", () => {
  assertMatch(NOT_ON_SUPPORT_ROSTER_MESSAGE, /People and roles/);
  assertMatch(NOT_ON_SUPPORT_ROSTER_MESSAGE, /Owner or Admin/);
});

// Rework (tester CONDITIONAL PASS): unique row keys, a described disabled
// Invite button, and the People list refreshing after own availability.
Deno.test("every People row has a key unique to its group and person", async () => {
  const { personRowKey } = await import("../lib/peopleAndRoles.js");
  const row = { user_id: "u1", email: "a@example.test" };
  assert(personRowKey("invited", row) !== personRowKey("former", row));
  assert(personRowKey("team", { email: "a@example.test" }) !== personRowKey("team", { email: "b@example.test" }));
  const panel = await read("components/community/TeamRolesPanel.jsx");
  assertEquals((panel.match(/<tr key=\{personRowKey\(/g) ?? []).length, 3, "three person row kinds");
  assertEquals(/<tr key=\{(?:row\.|`)/.test(panel), false, "no ad-hoc person row keys");
  for (const group of ["team", "invited", "former"]) {
    assertMatch(panel, new RegExp(`<tr key=\\{personRowKey\\("${group}", row\\)\\}`));
  }
});

Deno.test("the disabled Invite button is described by its hint", async () => {
  const panel = await read("components/community/TeamRolesPanel.jsx");
  assertMatch(panel, /aria-describedby=\{!canInvite \? INVITE_HINT_ID : undefined\}/);
  assertMatch(panel, /<span id=\{INVITE_HINT_ID\}[^>]*>\{TEAM_INVITE_OWNER_ONLY\}<\/span>/);
});

Deno.test("own availability changes refresh the People list", async () => {
  const [panel, page] = await Promise.all([
    read("components/community/TeamRolesPanel.jsx"),
    read("pages/CommunitySupportPage.jsx"),
  ]);
  assertMatch(panel, /useEffect\(\(\) => \{ void load\(\); \}, \[load, refreshKey\]\);/);
  assertMatch(page, /if \(!result\.message\) setPeopleRefreshKey\(\(key\) => key \+ 1\);/);
  assertMatch(page, /<TeamRolesPanel canInvite=\{canInvite\} refreshKey=\{peopleRefreshKey\} \/>/);
});
