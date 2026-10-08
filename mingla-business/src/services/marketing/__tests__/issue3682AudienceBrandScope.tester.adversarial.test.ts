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

function audienceLookup(row: {
  id: string;
  brand_id: string | null;
  query_definition: { kind?: string; brand_id?: string; event_id?: string } | null;
}) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => ({
          data: row,
          error: null,
        }),
      }),
    }),
  };
}

function eventLookup(row: { id: string; brand_id: string } | null) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => ({
          data: row,
          error: null,
        }),
      }),
    }),
  };
}

describe("#3682 brand-scoped automatic audiences (adversarial)", () => {
  const BRAND_A = "36820000-0000-4000-8000-0000000000a1";
  const BRAND_B = "36820000-0000-4000-8000-0000000000b2";
  const AUDIENCE_B = "36820000-0000-4000-8000-0000000000c3";
  const EVENT_B = "36820000-0000-4000-8000-0000000000e2";

  beforeEach(() => {
    (supabase.from as jest.Mock).mockReset();
  });

  it("assertAudienceMatchesCampaignBrand throws on a foreign audience", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce(
      audienceLookup({
        id: AUDIENCE_B,
        brand_id: BRAND_B,
        query_definition: { kind: "brand_buyers", brand_id: BRAND_B },
      }),
    );
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).rejects.toThrow(AUDIENCE_BRAND_MISMATCH);
  });

  it("assertAudienceMatchesCampaignBrand throws when audience brand_id is null", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce(
      audienceLookup({
        id: AUDIENCE_B,
        brand_id: null,
        query_definition: { kind: "brand_buyers", brand_id: BRAND_A },
      }),
    );
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).rejects.toThrow(AUDIENCE_BRAND_MISMATCH);
  });

  it("assertAudienceMatchesCampaignBrand accepts a matching brand_buyers audience", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce(
      audienceLookup({
        id: AUDIENCE_B,
        brand_id: BRAND_A,
        query_definition: { kind: "brand_buyers", brand_id: BRAND_A },
      }),
    );
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when owner brand matches but query_definition.brand_id does not", async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce(
      audienceLookup({
        id: AUDIENCE_B,
        brand_id: BRAND_A,
        query_definition: { kind: "brand_buyers", brand_id: BRAND_B },
      }),
    );
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).rejects.toThrow(AUDIENCE_BRAND_MISMATCH);
  });

  it("throws when owner brand matches but event_buyers event belongs to another brand", async () => {
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(
        audienceLookup({
          id: AUDIENCE_B,
          brand_id: BRAND_A,
          query_definition: { kind: "event_buyers", event_id: EVENT_B },
        }),
      )
      .mockReturnValueOnce(eventLookup({ id: EVENT_B, brand_id: BRAND_B }));
    await expect(
      assertAudienceMatchesCampaignBrand({
        audience_id: AUDIENCE_B,
        brand_id: BRAND_A,
      }),
    ).rejects.toThrow(AUDIENCE_BRAND_MISMATCH);
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
    expect(hook).toContain('typeof brandId === "string"');
    expect(hook).toContain("brandId.length > 0");
  });

  it("client gate selects query_definition and marketing-send awaits query gate", () => {
    const service = read("src/services/marketing/marketingCampaignService.ts");
    expect(service).toContain('.select("id, brand_id, query_definition")');
    const send = read(
      "../supabase/functions/marketing-send/index.ts",
    );
    expect(send).toContain("assertAudienceQueryMatchesCampaignBrand");
  });
});
