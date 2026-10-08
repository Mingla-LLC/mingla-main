/**
 * #3682 — brand-scoped automatic audiences (tester adversarial).
 * Append-only. Proves the gate throws and UI cannot reintroduce account-wide lists.
 */
import fs from "node:fs";
import path from "node:path";

import { supabase } from "../../supabase";
import {
  assertAudienceMatchesCampaignBrand,
  AUDIENCE_BRAND_MISMATCH,
} from "../marketingCampaignService";

jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const root = path.resolve(__dirname, "../../../..");

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("#3682 brand-scoped automatic audiences (adversarial)", () => {
  const BRAND_A = "36820000-0000-4000-8000-0000000000a1";
  const BRAND_B = "36820000-0000-4000-8000-0000000000b2";
  const AUDIENCE_B = "36820000-0000-4000-8000-0000000000c3";

  beforeEach(() => {
    (supabase.from as jest.Mock).mockReset();
  });

  it("assertAudienceMatchesCampaignBrand throws on a foreign audience", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            data: { id: AUDIENCE_B, brand_id: BRAND_B },
            error: null,
          }),
        }),
      }),
    });
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).rejects.toThrow(AUDIENCE_BRAND_MISMATCH);
  });

  it("assertAudienceMatchesCampaignBrand throws when audience brand_id is null", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            data: { id: AUDIENCE_B, brand_id: null },
            error: null,
          }),
        }),
      }),
    });
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).rejects.toThrow(AUDIENCE_BRAND_MISMATCH);
  });

  it("assertAudienceMatchesCampaignBrand accepts a matching brand", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            data: { id: AUDIENCE_B, brand_id: BRAND_A },
            error: null,
          }),
        }),
      }),
    });
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).resolves.toBeUndefined();
  });

  it("PeoplePage no longer calls useAudienceList with account id alone", () => {
    const page = read("src/components/people/PeoplePage.tsx");
    expect(page).not.toMatch(
      /useAudienceList\(\s*user\?\.id\s*\?\?\s*null\s*\)/,
    );
    expect(page).not.toContain("listAudiencesForAccount({ account_id:");
  });

  it("useAudienceList is disabled without a brandId", () => {
    const hook = read("src/hooks/marketing/useAudienceList.ts");
    expect(hook).toContain("typeof brandId === \"string\"");
    expect(hook).toContain("brandId.length > 0");
  });
});
