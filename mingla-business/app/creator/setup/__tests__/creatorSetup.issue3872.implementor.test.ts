import fs from "node:fs";
import path from "node:path";

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock("../../../../src/services/supabase", () => ({
  supabase: { rpc: mockRpc, functions: { invoke: mockInvoke } },
}));

import { creatorProgramService } from "../../../../src/services/creatorProgramService";

describe("#3872 creator onboarding", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.tsx"), "utf8");

  it("shows all six user-readable readiness outcomes", () => {
    for (const label of [
      "Your creator profile",
      "Prove one social account",
      "Set your packages",
      "Add a showcase",
      "Choose where you are paid",
      "Review the creator agreement",
    ]) expect(source).toContain(label);
  });

  it("does not allow the UI to self-assign verified status", () => {
    expect(source).toContain("creatorProgramService.verifyHandle");
    expect(source).toContain("creatorProgramService.recompute");
    expect(source).not.toContain('verification: "verified"');
  });

  it("keeps legal signing fail closed without an approved version", () => {
    expect(source).toContain("EXPO_PUBLIC_CREATOR_AGREEMENT_VERSION");
    expect(source).toContain("disabled={!agreementVersion}");
  });

  it("sends profile and verification work to the guarded service boundaries", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await creatorProgramService.saveProfile({
      displayName: "Ada Creator",
      bio: "Neighborhood food and culture",
      niches: ["food", "culture"],
      languages: ["en"],
      dateOfBirth: "1998-04-16",
      usageAdsOptIn: false,
    });
    expect(mockRpc).toHaveBeenCalledWith("creator_profile_save", {
      p_display_name: "Ada Creator",
      p_bio: "Neighborhood food and culture",
      p_home_city_id: null,
      p_niches: ["food", "culture"],
      p_languages: ["en"],
      p_date_of_birth: "1998-04-16",
      p_usage_ads_opt_in: false,
    });

    mockInvoke.mockResolvedValueOnce({ data: { status: "pending" }, error: null });
    await expect(creatorProgramService.verifyHandle("handle-1")).resolves.toEqual({
      status: "pending",
    });
    expect(mockInvoke).toHaveBeenCalledWith("creator-handle-verify", {
      body: { handleId: "handle-1" },
    });
  });
});
