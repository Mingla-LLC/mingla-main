import fs from "node:fs";
import path from "node:path";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: mockRpc, functions: { invoke: jest.fn() } },
}));
jest.mock("../postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

import { localReviewsService } from "../localReviewsService";

// [TEST-MOD-APPROVED #3872] Completion contracts for the Host-side Creator and
// Local journeys. The assertions intentionally protect user-visible outcomes,
// not component implementation details.
const root = process.cwd();
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

const hub = read("app/creator/hub.tsx");
const roster = read("app/brand/[id]/creators/roster.tsx");
const creatorService = read("src/services/creatorGigsService.ts");
const localManager = read("src/components/venue/LocalReviewsManager.tsx");
const localService = read("src/services/localReviewsService.ts");

describe("issue #3872 — completed Creator and Local Host journeys", () => {
  test("creators can filter and save privacy-safe gig cards", () => {
    for (const copy of ["All formats", "Every city", "Any budget", "Next 30 days", "Saved"]) {
      expect(hub).toContain(copy);
    }
    expect(hub).toContain("mingla.creator.savedGigs");
    expect(hub).toContain("creatorGigsService.board");
    expect(creatorService).toContain("creator_gig_board");
  });

  test("Hosts can maintain their creator roster and link tracked invitations", () => {
    expect(creatorService).toContain("brand_creator_roster_list");
    expect(creatorService).toContain("brand_creator_roster_link_invite");
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
});
