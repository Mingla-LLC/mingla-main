import fs from "node:fs";
import path from "node:path";
import { localReviewsService } from "../localReviewsService";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("../postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

const mockRpc = supabase.rpc as jest.Mock;

// [TEST-MOD-APPROVED #3872] Completion contracts for the Host-side Creator and
// Local journeys. The assertions intentionally protect user-visible outcomes,
// not component implementation details.
const root = process.cwd();
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

const roster = read("src/components/creators/screens/CreatorRosterScreen.tsx");
const creatorService = read("src/services/creatorGigsService.ts");
const creatorRosterService = read("src/services/creatorRosterService.ts");
const hostContract = read(
  "src/components/creators/screens/HostGigContractScreen.tsx",
);
const retentionMigration = read(
  "../supabase/migrations/20280208004182_issue_4182_bunny_media_lifecycle.sql",
);
const localManager = read("src/components/venue/LocalReviewsManager.tsx");
const localService = read("src/services/localReviewsService.ts");

describe("issue #3872 — completed Creator and Local Host journeys", () => {
  test("the creator side lives in Explorer only (decision 1)", () => {
    expect(fs.existsSync(path.join(root, "app/creator"))).toBe(false);
    expect(creatorService).not.toContain("creator_gig_board");
    expect(creatorService).not.toContain("gig_interest_send");
    expect(read("app/+native-intent.tsx")).not.toMatch(/^\s*"creator",$/m);
  });

  test("Hosts can maintain their creator roster and link tracked invitations", () => {
    expect(creatorRosterService).toContain("brand_creator_roster_list");
    expect(creatorRosterService).toContain("brand_creator_roster_link_invite");
    expect(roster).toContain("roster_creator_added");
    expect(roster).toContain("roster_invite_sent");
  });

  test("verified place teams get one reply with the reviewed 24-hour edit rule", () => {
    expect(localService).toContain("brand_place_local_reviews");
    expect(localService).toContain("local_place_reply");
    expect(localManager).toContain("Update reply");
    expect(localManager).toContain("24 hours");
  });

  test("a place reply stays scoped to both the brand and Local month", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(
      localReviewsService.reply("brand-1", "month-1", "Thanks for visiting."),
    ).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("local_place_reply", {
      p_local_month_id: "month-1",
      p_brand_id: "brand-1",
      p_reply: "Thanks for visiting.",
    });
  });

  test("#4182 the Host gets an expiring approved-master download without a payout gate", () => {
    expect(creatorService).toContain('"creator-media-status"');
    expect(creatorService).toContain("approvedDeliveryDownload");
    expect(hostContract).toContain("Download approved master");
    expect(hostContract).toContain('"auto_approved"');
    expect(hostContract).toContain("setDownloadAvailableUntil(availableUntil)");
    expect(hostContract).toContain("response.blob()");
    expect(hostContract).toContain("URL.createObjectURL");
    expect(hostContract).toContain("URL.revokeObjectURL");
    expect(hostContract).toContain(
      "Creator payout is not affected by this download.",
    );
    expect(hostContract).toContain("StorageAccessFramework");
    expect(retentionMigration).toContain(
      "s.payee_kind='gig_fee' AND s.status='paid'",
    );
    expect(retentionMigration).toContain(
      "d.status IN ('open','settling','escalated')",
    );
    expect(retentionMigration).toContain("retention_hold_at IS NULL");
  });
});
