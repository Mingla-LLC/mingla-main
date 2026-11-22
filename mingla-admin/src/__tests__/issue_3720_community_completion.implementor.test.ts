import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  communitySupportTabsForAccess,
} from "../lib/communitySupportAccess.js";
import { AREA, COMMUNITY_OPERATIONS_AREA } from "../lib/access.js";

const read = (relative: string) =>
  Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

Deno.test("#3720 Community moderators receive moderation but not Admin cutover authority", () => {
  const tabs = [
    { id: "overview" },
    { id: "moderation" },
    { id: "cutover" },
    { id: "email" },
  ];
  const visible = communitySupportTabsForAccess({
    status: "active",
    areas: [COMMUNITY_OPERATIONS_AREA],
  }, tabs).map((tab: { id: string }) => tab.id);
  // #4130 Wave 6: Overview was retired, so no area grants it.
  // [TEST-MOD #4420] Moderation retired with Community; a Community moderator
  // gets no console tab, and still no Admin cutover authority.
  assertEquals(visible, []);
  const admin = communitySupportTabsForAccess({
    status: "active",
    areas: [AREA.ADMIN_CONSOLE],
  }, tabs).map((tab: { id: string }) => tab.id);
  assertEquals(admin, ["overview", "moderation", "cutover", "email"]);
});

// [TEST-MOD #4420] the Moderation and Cutover panels were deleted (Community
// retired); the service still reaches only the audited RPCs, and no Admin
// file writes community tables directly.
Deno.test("#3720 moderation and cutover use only audited server RPCs", async () => {
  const service = await read("services/communityService.js");
  assertMatch(service, /issue_3720_community_moderation_queue/);
  assertMatch(service, /issue_3720_community_moderate/);
  assertMatch(service, /issue_3720_community_cutover_status/);
  assertNotMatch(service, /from\(["']community_[a-z_]+["']\)\s*\.(insert|update|delete)\(/);
});

Deno.test("#3720 cutover gate keeps ClickUp retirement and seats evidence explicit", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../supabase/migrations/20271103003720_issue_3720_community_completion.sql",
      import.meta.url,
    ),
  );
  for (
    const key of [
      "delivery_proof",
      "release_records",
      "clickup_export",
      "clickup_reconciliation",
      "clickup_archival",
      "native_live_proof",
      "board_progress",
      "agent_seats",
    ]
  ) assert(migration.includes(`'${key}'`), key);
  assertMatch(migration, /clickup_reconciliation_required/);
  assertMatch(migration, /agent_seats_last/);
  assertNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public[.]is_admin_user/,
  );
});
