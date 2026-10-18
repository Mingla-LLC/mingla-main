import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 Host Ads lifecycle list", () => {
  const route = read("app/(tabs)/marketing/ads/index.tsx");
  const lifecycle = read("src/services/hostAdLifecycle.ts");
  const planService = read("src/services/hostAdPlanService.ts");
  const endpoint = read("../supabase/functions/host-ad-campaign/index.ts");

  it("offers the complete binding lifecycle filters", () => {
    for (const label of [
      "Draft",
      "In review",
      "Scheduled",
      "Live",
      "Paused",
      "Needs attention",
      "Ended",
    ]) {
      expect(route).toContain(`label: "${label}"`);
    }
    expect(route).toContain("hostAdMatchesFilter");
  });

  it("includes the current user's active brand drafts", () => {
    expect(planService).toContain("export async function listHostAdWorkspace");
    expect(planService).toContain("include_drafts: true");
    expect(lifecycle).toContain("Continue draft");
    expect(lifecycle).toContain("?draft_id=${draft.id}");
  });

  it("renders one compact next action with creative, destination, money and result truth", () => {
    expect(endpoint).toContain("buildHostCampaignList");
    expect(route).toContain("item.creative?.previewUrl");
    expect(route).toContain("item.destination");
    expect(route).toContain("item.spendByCurrency");
    expect(route).toContain("item.primaryResultCount");
    expect(route).toContain("item.costPerResultCents");
    expect(route).toContain("{item.nextAction} →");
  });

  it("makes resume aggregate-wide, permissioned and typed", () => {
    const detail = read("app/(tabs)/marketing/ads/[id].tsx");
    const campaigns = read("src/services/hostAdCampaignService.ts");
    expect(campaigns).toContain(
      "export async function resumeHostAdCampaignPlan",
    );
    expect(campaigns).toContain('confirm_phrase: "LAUNCH"');
    expect(campaigns).toContain('"admin-ad-campaign-action"');
    expect(detail).toContain("permissions.canLaunch");
    expect(detail).toContain('resumePhrase !== "LAUNCH"');
    expect(detail).toContain("Resume all platforms");
    expect(detail).toContain("Ask Ari about this ad");
  });
});
