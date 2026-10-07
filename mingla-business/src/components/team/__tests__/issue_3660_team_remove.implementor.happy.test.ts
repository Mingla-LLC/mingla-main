/**
 * #3660 — Remove from team is a real mutation, not a sheet-close no-op.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const teamSrc = readFileSync(
  join(__dirname, "../../../../app/brand/[id]/team.tsx"),
  "utf8",
);
const serviceSrc = readFileSync(
  join(__dirname, "../../../services/brandInvitationsService.ts"),
  "utf8",
);
const migrationSrc = readFileSync(
  join(
    __dirname,
    "../../../../../supabase/migrations/20270801003645_issue_3660_biz_remove_brand_team_member.sql",
  ),
  "utf8",
);

describe("issue_3660 team remove", () => {
  test("service calls biz_remove_brand_team_member RPC", () => {
    expect(serviceSrc).toContain("export async function removeBrandTeamMember");
    expect(serviceSrc).toContain('rpc("biz_remove_brand_team_member"');
    expect(serviceSrc).toContain("p_brand_id");
    expect(serviceSrc).toContain("p_member_id");
  });

  test("team screen wires useRemoveBrandTeamMember into handleRemove", () => {
    expect(teamSrc).toContain("useRemoveBrandTeamMember");
    expect(teamSrc).toContain("removeAsync(entry.id)");
    expect(teamSrc).toContain("removePending");
    expect(teamSrc).toContain("removeTargetIdRef");
    expect(teamSrc).not.toMatch(
      /handleRemove[\s\S]{0,200}ORCH-1051[\s\S]{0,200}without a destructive/,
    );
  });

  test("migration refuses brand-account removal, partners, and gates on brand_admin+", () => {
    expect(migrationSrc).toContain("cannot_remove_brand_account");
    expect(migrationSrc).toContain("active_partner_use_disconnect");
    expect(migrationSrc).toContain("tg_brand_team_members_removal_guard");
    expect(migrationSrc).toContain("biz_role_rank('brand_admin')");
    expect(migrationSrc).toContain("brand_team_member_removed");
    expect(migrationSrc).toContain("app.allow_brand_owner_transfer");
    expect(migrationSrc).toContain("p_brand_id uuid");
  });
});
