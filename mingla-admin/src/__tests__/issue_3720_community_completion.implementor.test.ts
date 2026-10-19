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
  assertEquals(visible, ["overview", "moderation"]);
  const admin = communitySupportTabsForAccess({
    status: "active",
    areas: [AREA.ADMIN_CONSOLE],
  }, tabs).map((tab: { id: string }) => tab.id);
  assertEquals(admin, ["overview", "moderation", "cutover", "email"]);
});

Deno.test("#3720 moderation UI remains audited and the retired Cutover surface stays removed", async () => {
  // [TEST-MOD-APPROVED #3720] The approved Wave 8 contract replaces the
  // retired-panel assertions with a fails-on-revert removal guard.
  const [service, moderation, page] = await Promise.all([
    read("services/communityService.js"),
    read("components/community/ModerationPanel.jsx"),
    read("pages/CommunitySupportPage.jsx"),
  ]);
  assertMatch(service, /issue_3720_community_moderation_queue/);
  assertMatch(service, /issue_3720_community_moderate/);
  assertMatch(moderation, /First-three-post review/);
  assertNotMatch(service, /getCommunityCutoverStatus|recordCommunityCutoverEvidence/);
  assertNotMatch(page, /CutoverPanel|id:\s*["']cutover["']/);
  let panelExists = true;
  try {
    await Deno.stat(new URL("../components/community/CutoverPanel.jsx", import.meta.url));
  } catch (error) {
    assert(error instanceof Deno.errors.NotFound);
    panelExists = false;
  }
  assertEquals(panelExists, false);
  assertNotMatch(moderation, /from\(["']community_/);
  assertNotMatch(
    moderation,
    /\.insert\(|\.update\(|\.delete\(/,
  );
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
