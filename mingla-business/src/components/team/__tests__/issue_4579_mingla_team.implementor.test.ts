/**
 * #4579 — Mingla admins on every brand.
 *
 * Team & permissions shows ONE "Mingla Team" entry (never a person, an email
 * or a count); remove is for brand admin and up, add back for the owner only.
 * Everywhere else a Mingla admin added automatically is shown by name with the
 * Mingla mark and never by an email or handle.
 *
 * Pure logic and source contracts (business render suites do not run under
 * the default node config).
 */
import fs from "node:fs";
import path from "node:path";

const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  getMinglaTeamState,
  parseMinglaTeamState,
  removeMinglaTeam,
  restoreMinglaTeam,
} from "../../../services/minglaTeamService";
import { parseBrandTeamDirectory } from "../../../utils/brandTeamMemberIdentity";
import { parseDoorReads } from "../../../services/brandFormsService";

const root = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

const ADMIN_ID = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";

beforeEach(() => mockRpc.mockReset());

describe("#4579 Mingla Team state", () => {
  test("parses on, off and none; actions follow the server's rights", () => {
    expect(parseMinglaTeamState({ status: "active", since: "2026-11-23T10:00:00Z", can_remove: true, can_restore: true }))
      .toEqual({ status: "active", since: "2026-11-23T10:00:00Z", canRemove: true, canRestore: false });
    expect(parseMinglaTeamState({ status: "removed", since: null, can_remove: true, can_restore: true }))
      .toEqual({ status: "removed", since: null, canRemove: false, canRestore: true });
    expect(parseMinglaTeamState({ status: "removed", can_restore: false }).canRestore).toBe(false);
    expect(parseMinglaTeamState(null)).toEqual({ status: "none", since: null, canRemove: false, canRestore: false });
    expect(parseMinglaTeamState({ status: "weird", can_remove: true }).canRemove).toBe(false);
  });

  test("calls the three RPCs with the brand id only", async () => {
    mockRpc.mockResolvedValue({ data: { status: "active", can_remove: true }, error: null });
    await getMinglaTeamState("brand-1");
    await removeMinglaTeam("brand-1");
    await restoreMinglaTeam("brand-1");
    expect(mockRpc.mock.calls).toEqual([
      ["issue_4579_mingla_team_state", { p_brand_id: "brand-1" }],
      ["issue_4579_remove_mingla_team", { p_brand_id: "brand-1" }],
      ["issue_4579_restore_mingla_team", { p_brand_id: "brand-1" }],
    ]);
  });

  test("a refused restore is a forbidden error with the approved copy", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "forbidden" } });
    await expect(restoreMinglaTeam("brand-1")).rejects.toMatchObject({
      code: "forbidden",
      message: "Couldn't add Mingla Team back. Try again.",
    });
    await expect(removeMinglaTeam("brand-1")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("#4579 the team directory never makes the Mingla Team entry a person", () => {
  test("the entry_kind mingla_team row is dropped, members are kept", () => {
    const rows = [
      { member_id: "m1", user_id: "u1", role: "brand_owner", display_name: "Ada", email: "ada@example.com", avatar_url: null, joined_at: null, entry_kind: "member" },
      { member_id: null, user_id: null, role: "brand_admin", display_name: "Mingla Team", email: null, avatar_url: null, joined_at: null, entry_kind: "mingla_team" },
      // Even a malformed entry that carried an id is never a person.
      { member_id: "x", user_id: ADMIN_ID, role: "brand_admin", display_name: "Mingla Team", email: null, avatar_url: null, joined_at: null, entry_kind: "mingla_team" },
    ];
    const parsed = parseBrandTeamDirectory(rows);
    expect(parsed.map((entry) => entry.userId)).toEqual(["u1"]);
    expect(JSON.stringify(parsed)).not.toContain(ADMIN_ID);
  });
});

describe("#4579 Team & permissions screen (source contract)", () => {
  const team = read("mingla-business/app/brand/[id]/team.tsx");
  const section = read("mingla-business/src/components/team/MinglaTeamSection.tsx");

  test("renders the one Mingla section from the state RPC, with remove and owner-only add back", () => {
    expect(team).toContain("<MinglaTeamSection");
    expect(team).toContain("useMinglaTeamState(brandIdResolved)");
    expect(team).toContain("onRemove={minglaTeam.remove}");
    expect(team).toContain("onRestore={minglaTeam.restore}");
    // A Mingla admin viewer reads every row: rows the directory does not list are hidden.
    expect(team).toContain("directoryByUserId.has(row.user_id)");
    expect(section).toContain("state.canRemove ?");
    expect(section).toContain("state.canRestore ?");
    expect(section).toContain('gateCaptionFor("REMOVE_TEAM_MEMBER")');
  });

  test("approved copy, and no email, count or person on the entry", () => {
    for (const copy of [
      "Mingla's team, here to help",
      "Remove Mingla Team?",
      "Mingla will lose access to this brand and won't be added back. You can add Mingla Team back from this screen.",
      "Only the brand owner can add Mingla Team back.",
      "Add Mingla Team back",
      "Couldn't remove Mingla Team. Try again.",
      "Mingla Team removed",
      "We can't change payouts or bank details.",
    ]) {
      expect(section).toContain(copy);
    }
    // No email field and no head count is ever read for the entry.
    expect(section).not.toMatch(/\.email\b/);
    expect(section).not.toMatch(/\bcount\b/);
  });
});

describe("#4579 chats show the Mingla mark and never an email", () => {
  test("a roster row for a Mingla admin reads 'From Mingla', never the email", async () => {
    // Imported lazily: the panel pulls react-native, which this node config stubs.
    jest.doMock("react-native", () => ({
      ActivityIndicator: "ActivityIndicator", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView",
      StyleSheet: { create: <T,>(s: T) => s, hairlineWidth: 1, absoluteFillObject: {} },
      Switch: "Switch", Text: "Text", View: "View", Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios },
    }));
    jest.doMock("../../../i18n", () => ({ useBusinessMediaTranslation: () => ({ t: (k: string) => k }) }));
    jest.doMock("../../ui/Icon", () => ({ Icon: "Icon" }));
    const { memberSecondLine, minglaEntryPill } = await import("../../messages/BrandGroupPeoplePanel");
    const admin = { user_id: ADMIN_ID, display_name: "Kunle", email: null, role: "brand_admin", is_mingla_team: true };
    const host = { user_id: "h1", display_name: "Hana", email: "hana@example.com", role: "brand_owner", is_mingla_team: false };
    expect(memberSecondLine(admin)).toBe("From Mingla");
    // Even if an old server sent an email, a flagged row never shows it.
    expect(memberSecondLine({ ...admin, email: "kunle@usemingla.com" })).toBe("From Mingla");
    expect(memberSecondLine(host)).toBe("hana@example.com");
    expect(minglaEntryPill([host, admin], "Mingla")).toBe("Mingla");
    expect(minglaEntryPill([host], "Mingla")).toBe("Support");
  });

  test("a message from a Mingla admin: name, mark, role; screen reader says from Mingla", async () => {
    jest.doMock("react-native", () => ({
      Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios },
      Pressable: "Pressable", StyleSheet: { create: <T,>(s: T) => s, hairlineWidth: 1 }, Text: "Text", View: "View",
    }));
    jest.doMock("../../../i18n", () => ({ useBusinessMediaTranslation: () => ({ t: (k: string) => k }) }));
    jest.doMock("../../ui/Icon", () => ({ Icon: "Icon" }));
    jest.doMock("../../messages/BrandGroupBubbleGestures", () => ({ BrandGroupBubbleGestures: "G" }));
    jest.doMock("../../messages/BrandGroupTile", () => ({ BrandGroupPersonAvatar: "A" }));
    jest.doMock("../../messages/BrandGroupMinglaMark", () => ({ BRAND_GROUP_MINGLA_TEAM_NAME: "Mingla Team", BrandGroupMinglaMark: "M", WithBrandGroupMinglaBadge: "B" }));
    const { brandGroupSenderParts } = await import("../../messages/BrandGroupMessageRow");
    const base = {
      id: "m1", conversation_id: "c1", sender_id: ADMIN_ID, content: "hi", created_at: "2026-11-23T10:00:00Z",
      reply_to_id: null, related_message_ids: [], sender_display_name: "Kunle", sender_role: null,
      reply_content: null, reply_sender_display_name: null, message_type: "text" as const,
      file_id: null, file_name: null, file_size: null, file_mime: null,
    };
    expect(brandGroupSenderParts({ ...base, sender_is_mingla_team: true }, "Kunle · Admin")).toEqual({
      mingla: true, name: "Kunle", rest: " · Admin", accessibilityLabel: "Kunle, from Mingla, Admin",
    });
    expect(brandGroupSenderParts({ ...base, sender_is_mingla_team: false, sender_display_name: "Hana" }, "Hana · Owner")).toEqual({
      mingla: false, name: "Hana · Owner", rest: "", accessibilityLabel: "Hana · Owner",
    });
  });

  test("the door log carries the flag; absent means not Mingla", () => {
    const rows = parseDoorReads([
      { at: "2026-11-23T20:00:00Z", actorName: "Kunle", actorIsMinglaTeam: true, guestName: "Ada", via: "scan", result: "full" },
      { at: "2026-11-23T20:01:00Z", actorName: "Tobi", guestName: "Ada", via: "scan", result: "full" },
    ]);
    expect(rows.map((row) => row.actorIsMinglaTeam)).toEqual([true, false]);
  });

  test("guest chat authors come from the server name rule, not a client profiles read", () => {
    const service = read("mingla-business/src/services/groupChatService.ts");
    expect(service).toContain('rpc("issue_4579_brand_guest_post_authors"');
    expect(service).not.toMatch(/from\("profiles"\)\.select\("id, display_name, first_name, username"\)/);
  });
});
