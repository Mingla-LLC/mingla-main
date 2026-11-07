/**
 * #4271 — the brand team screen shows other members' names, never a raw
 * user id. Names come from rpc biz_brand_team_members.
 */
import fs from "node:fs";
import path from "node:path";

const mockRpc = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  parseBrandTeamDirectory,
  teamMemberIdentity,
  TEAM_MEMBER_FALLBACK_NAME,
} from "../brandTeamMemberIdentity";
import { listBrandTeamMemberDirectory } from "../../services/brandTeamDirectoryService";

const USER_ID = "8f14e45f-ceea-467a-9575-7f2b1c3d4e5f";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const entry = (overrides: Record<string, unknown>) => ({
  userId: USER_ID,
  role: "event_manager",
  displayName: null,
  email: null,
  avatarUrl: null,
  joinedAt: null,
  ...overrides,
});

describe("#4271 team member identity", () => {
  test("a member row shows their name and email", () => {
    const identity = teamMemberIdentity(USER_ID, entry({ displayName: "Tunde Bakare", email: "tunde@example.com" }));
    expect(identity).toEqual({ name: "Tunde Bakare", email: "tunde@example.com", avatarUrl: null });
  });

  test("falls back to the email, then 'Team member' — never the user id", () => {
    expect(teamMemberIdentity(USER_ID, entry({ email: "sam@example.com" })).name).toBe("sam@example.com");
    const unknown = teamMemberIdentity(USER_ID, undefined);
    expect(unknown).toEqual({ name: TEAM_MEMBER_FALLBACK_NAME, email: "", avatarUrl: null });
    const echoed = teamMemberIdentity(USER_ID, entry({ displayName: USER_ID, email: USER_ID }));
    expect(echoed.name).toBe(TEAM_MEMBER_FALLBACK_NAME);
    for (const identity of [unknown, echoed]) {
      expect(identity.name).not.toMatch(UUID);
      expect(identity.email).not.toMatch(UUID);
    }
  });

  test("reads names from biz_brand_team_members", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        user_id: USER_ID,
        role: "scanner",
        display_name: "Sam Lee",
        email: "sam@example.com",
        avatar_url: null,
        joined_at: "2026-11-01T10:00:00.000Z",
      }],
      error: null,
    });
    const rows = await listBrandTeamMemberDirectory("brand-1");
    expect(mockRpc).toHaveBeenCalledWith("biz_brand_team_members", { p_brand_id: "brand-1" });
    expect(rows).toEqual(parseBrandTeamDirectory([{
      user_id: USER_ID,
      role: "scanner",
      display_name: "Sam Lee",
      email: "sam@example.com",
      avatar_url: null,
      joined_at: "2026-11-01T10:00:00.000Z",
    }]));
    expect(rows[0].displayName).toBe("Sam Lee");
  });

  test("the team screen renders the identity, not row.user_id", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../app/brand/[id]/team.tsx"),
      "utf8",
    );
    expect(source).toContain("useBrandTeamMemberDirectory(brandIdResolved)");
    expect(source).toContain("teamMemberIdentity(");
    expect(source).not.toMatch(/name:\s*row\.user_id/);
    expect(source).not.toMatch(/email:\s*row\.user_id/);
    expect(source).not.toMatch(/invitee(Email|Name):\s*row\.user_id/);
  });
});
