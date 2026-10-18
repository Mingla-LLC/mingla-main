import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(root, rel), "utf8");

describe("#3697 Ari creative-before-freeze boundary", () => {
  it("collects the ad video on propose_ad_plan, not approve_ad_plan", () => {
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).toContain(
      'const isAdPlanCreativeProposal = toolName === "propose_ad_plan"',
    );
    expect(card).toContain("isAdPlanCreativeProposal && adVideoTarget");
    expect(card).toContain("isAdPlanCreativeProposal &&");
    expect(card).not.toContain("isAdPlanProposal && adVideoTarget");
  });

  it("records once and defers every provider copy until the confirmed server launch", () => {
    const service = read("src/services/ariAdCreativeService.ts");
    const tools = read("../supabase/functions/_shared/agentDomainTools.ts");
    const approve = tools.slice(
      tools.indexOf('const approveAdPlan = writeTool('),
      tools.indexOf('const pauseAdCampaign = writeTool('),
    );
    expect(service).toContain("platforms: string[]");
    expect(service).toContain("platforms,");
    expect(service).toContain('"admin-ad-creative-upload"');
    expect(service).not.toContain('"admin-ad-creative-prepare"');
    expect(approve).toContain('"admin-ad-creative-prepare"');
    expect(approve).toContain('lane: "business"');
    expect(approve.indexOf('action: "confirm_launch"')).toBeLessThan(
      approve.indexOf('"admin-ad-creative-prepare"'),
    );
  });

  it("renders the exact fee, currency, provider, rights and LAUNCH boundaries", () => {
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).toContain('label: "Currency"');
    expect(card).toContain('label: "Provider split"');
    expect(card).toContain('label: "Media rights"');
    expect(card).toContain('label: "AI disclosure"');
    expect(card).toContain('label: "Measurement scope"');
    expect(card).toContain('label: "Mingla fee"');
    expect(card).toContain('label: "Approval boundary"');
    expect(card).toContain(
      "LAUNCH authorizes only the exact immutable plan above",
    );
  });
});
