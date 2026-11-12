// #4402 — hosts see only an audience band a Mingla admin recorded. With none,
// the Applicants list and the pre-hire profile say "Not checked yet"; the
// creator's self-reported band never reaches a host (Seth, 12 Nov 2026: an
// admin verifies audience information; orchestrator decision the same day).
//
// The server proof is supabase/migrations/__tests__/issue_4402_creator_review
// .implementor.pg17.test.sql (gig_applicants and prehire_creator_profile list
// only follower_source='admin'). Fails on 1f14a6c44c: audienceLabel printed a
// self-reported band and normalizeApplicants kept it.
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: mockRpc, functions: { invoke: jest.fn() }, from: jest.fn() },
}));
jest.mock("../postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

import {
  adminAudienceBands,
  creatorGigsService,
  normalizeApplicants,
} from "../creatorGigsService";
import {
  AUDIENCE_NOT_CHECKED,
  audienceLabel,
} from "../../utils/creatorProgramFormat";

const SELF = { platform: "instagram", band: "gt1m", verified: false, source: "self_reported" };
const SELF_VERIFIED_OLD = { platform: "tiktok", band: "250k_1m", verified: true, source: "self_reported" };
const PROVIDER_OLD = { platform: "youtube", band: "gt1m", verified: true, source: "provider" };
const ADMIN = { platform: "instagram", band: "1k_10k", verified: true, source: "admin" };

beforeEach(() => mockRpc.mockReset());

describe("#4402 host audience is admin-recorded only", () => {
  it("drops every band an admin did not record", () => {
    expect(adminAudienceBands([SELF, SELF_VERIFIED_OLD, PROVIDER_OLD, null, "x"])).toEqual([]);
    expect(adminAudienceBands([SELF, ADMIN])).toEqual([ADMIN]);
    expect(adminAudienceBands(null)).toEqual([]);
  });

  it("the Applicants line says Not checked yet without an admin band", () => {
    const [row] = normalizeApplicants([
      { interest_id: "i1", creator_id: "c1", display_name: "Ada", quote_minor: 1, currency: "NGN", status: "sent",
        follower_bands: [SELF, SELF_VERIFIED_OLD, PROVIDER_OLD] },
    ]);
    expect(row.follower_bands).toEqual([]);
    expect(audienceLabel(row.follower_bands)).toBe(AUDIENCE_NOT_CHECKED);
    expect(AUDIENCE_NOT_CHECKED).toBe("Not checked yet");
    // Even if a self-reported band reaches the formatter directly.
    expect(audienceLabel([SELF, SELF_VERIFIED_OLD])).toBe("Not checked yet");
    expect(audienceLabel(undefined)).toBe("Not checked yet");
  });

  it("the Applicants line shows the admin band only", () => {
    const [row] = normalizeApplicants([
      { interest_id: "i1", creator_id: "c1", display_name: "Ada", quote_minor: 1, currency: "NGN", status: "sent",
        follower_bands: [SELF_VERIFIED_OLD, ADMIN] },
    ]);
    expect(row.follower_bands).toEqual([ADMIN]);
    const line = audienceLabel(row.follower_bands);
    expect(line).toMatch(/^Instagram /);
    expect(line).not.toMatch(/TikTok/);
  });

  it("the pre-hire profile keeps only admin bands", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { id: "c1", display_name: "Ada", follower_bands: [SELF_VERIFIED_OLD, PROVIDER_OLD, ADMIN] },
      error: null,
    });
    const profile = await creatorGigsService.prehireProfile("c1");
    expect(profile?.follower_bands).toEqual([ADMIN]);
  });

  it("the pre-hire screen always shows the section, with Not checked yet when empty", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const screen = fs.readFileSync(
      path.join(__dirname, "../../components/creators/screens/PrehireCreatorProfileScreen.tsx"),
      "utf8",
    );
    expect(screen).toMatch(/<SectionLabel>Verified audience<\/SectionLabel>\s*\{profile\.follower_bands\.length > 0 \?/);
    expect(screen).toMatch(/<Muted>\{AUDIENCE_NOT_CHECKED\}<\/Muted>/);
  });
});
