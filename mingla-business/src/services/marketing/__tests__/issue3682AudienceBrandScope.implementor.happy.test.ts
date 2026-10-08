/**
 * #3682 — brand-scoped automatic audiences (implementor happy).
 * Append-only. Pins UI + draft-write contracts that stop cross-brand leaks.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("#3682 brand-scoped automatic audiences (happy)", () => {
  it("People Groups and the palette pass the current brand into useAudienceList", () => {
    const page = read("src/components/people/PeoplePage.tsx");
    expect(page).toContain(
      "const groups=useAudienceList(user?.id??null,brand?.id??null)",
    );
    const palette = read("src/components/ui/CommandPalette.web.tsx");
    expect(palette).toContain(
      "useAudienceList(accountId, currentBrand?.id ?? null)",
    );
    const hook = read("src/hooks/marketing/useAudienceList.ts");
    expect(hook).toContain("listAudiencesForBrand");
    expect(hook).toContain("marketingKeys.audiences.list(accountId as string, brandId as string)");
  });

  it("composer refuses a foreign brand deep-link and clears a mismatched draft audience", () => {
    const compose = read("app/(tabs)/marketing/campaigns/compose.tsx");
    expect(compose).toContain("audienceParam.id !== brandId");
    expect(compose).toContain("assertEventBelongsToBrand");
    expect(compose).toContain("AUDIENCE_BRAND_MISMATCH");
    expect(compose).toContain(
      "That draft's audience belongs to another brand. Pick an audience for this brand.",
    );
  });

  it("createDraft and updateDraft assert audience brand matches campaign brand", () => {
    const service = read("src/services/marketing/marketingCampaignService.ts");
    expect(service).toContain("export async function assertAudienceMatchesCampaignBrand");
    expect(service).toContain("AUDIENCE_BRAND_MISMATCH");
    // createDraft awaits the gate before insert.
    const createIdx = service.indexOf("export async function createDraft");
    const gateInCreate = service.indexOf(
      "await assertAudienceMatchesCampaignBrand",
      createIdx,
    );
    const insertIdx = service.indexOf(".insert(insertPayload)", createIdx);
    expect(gateInCreate).toBeGreaterThan(createIdx);
    expect(gateInCreate).toBeLessThan(insertIdx);
    expect(service).toContain("updateDraft: campaign brand missing");
  });

  it("listAudiencesForBrand filters marketing_audiences and orders by brand_id", () => {
    const service = read("src/services/marketing/marketingAudienceService.ts");
    expect(service).toContain("export async function listAudiencesForBrand");
    expect(service).toContain('.eq("brand_id", input.brand_id)');
    expect(service).toContain('.eq("events.brand_id", input.brand_id)');
    expect(service).toContain("Cross-brand automatic groups");
  });
});
