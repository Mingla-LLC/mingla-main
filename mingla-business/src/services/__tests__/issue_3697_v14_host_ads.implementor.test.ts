import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 v1.4 Host Ads program", () => {
  const service = read("src/services/hostAdPlanService.ts");
  const createRoute = read("app/(tabs)/marketing/ads/create.tsx");
  const adsRoute = read("app/(tabs)/marketing/ads/index.tsx");
  const ariCard = read("src/components/ari/ToolProposalCard.tsx");
  const campaignService = read("src/services/hostAdCampaignService.ts");
  const hostCampaignEndpoint = read(
    "../supabase/functions/host-ad-campaign/index.ts",
  );
  const planEndpoint = read("../supabase/functions/ad-plan/index.ts");

  it("links the Ads tab to a concrete Host builder", () => {
    expect(adsRoute).toContain('router.push("/(tabs)/marketing/ads/create"');
    expect(createRoute).toContain("Prepare immutable plan");
    expect(createRoute).toContain("Hold funds");
    expect(createRoute).toContain("Launch approved plan");
    expect(adsRoute).toContain("useHostAdPlans");
    expect(adsRoute).toContain("Plans in progress");
  });

  it("uses the shared immutable plan and never accepts client currency", () => {
    expect(service).toContain('action: "open"');
    expect(service).toContain('action: "create_version"');
    expect(service).toContain('action: "freeze_targeting"');
    expect(service).toContain('action: "mark_ready"');
    expect(service).toContain('action: "fund"');
    expect(service).toContain('action: "confirm_launch"');
    expect(service).toContain("export async function fundHostAdPlan");
    expect(service).toContain("export async function launchHostAdPlan");
    expect(service).not.toContain("fundCreateAndLaunchHostAdPlan");
    expect(service).not.toMatch(/currency:\s*input\./);
    expect(service).toContain('phrase: "LAUNCH"');
    expect(service).toContain("input.connections.map");
    expect(createRoute).toContain("one or more connected platforms");
    expect(service).toContain("provider_estimate");
    expect(service).toContain("estimate_observed_at");
    expect(createRoute).toContain("Provider estimates overlap");
    expect(createRoute).toContain("Do not add these estimates");
  });

  it("stops the first three for staff review before provider create", () => {
    const reviewIndex = service.indexOf(
      'aggregate.plan.state === "staff_review_required"',
    );
    const createIndex = service.lastIndexOf('"admin-ad-create-campaign"');
    expect(reviewIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(reviewIndex);
    expect(createRoute).toContain("no provider object exists");
    expect(createRoute).toContain("Cancel plan and release funds");
  });

  it("runs provider validation only after funding, confirmation and media preparation", () => {
    const fundFlow = service.slice(
      service.indexOf("export async function fundHostAdPlan"),
      service.indexOf("export async function launchHostAdPlan"),
    );
    const launchFlow = service.slice(
      service.indexOf("export async function launchHostAdPlan"),
    );
    const confirmIndex = launchFlow.indexOf('action: "confirm_launch"');
    const prepareIndex = launchFlow.indexOf(
      "await prepareBoundVideoPlatforms(aggregate)",
    );
    const validateIndex = launchFlow.indexOf(
      "await validateAggregate(aggregate)",
    );
    expect(fundFlow).not.toContain('"admin-ad-create-campaign"');
    expect(confirmIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(confirmIndex);
    expect(validateIndex).toBeGreaterThan(prepareIndex);
    expect(service).toContain("validate_only: true");
    expect(service).toContain('action: "cancel_before_create"');
    expect(service).toContain('phrase: "CANCEL PLAN"');
    expect(createRoute).toContain('confirmText="CANCEL PLAN"');
    expect(createRoute).toContain("aggregateHasProviderObjectEvidence");
    expect(createRoute).toContain("Provider object evidence is recorded");
  });

  it("creates every provider object paused before any Host activation", () => {
    const createdRows = service.indexOf("const createdCampaigns");
    const createCall = service.indexOf(
      '"admin-ad-create-campaign"',
      createdRows,
    );
    const activationLoop = service.indexOf(
      "for (const item of createdCampaigns)",
      createCall,
    );
    const launchCall = service.indexOf('action: "launch"', activationLoop);
    expect(createdRows).toBeGreaterThan(-1);
    expect(createCall).toBeGreaterThan(createdRows);
    expect(activationLoop).toBeGreaterThan(createCall);
    expect(launchCall).toBeGreaterThan(activationLoop);
    expect(hostCampaignEndpoint).toContain('"partially_live"');
    expect(hostCampaignEndpoint).toContain('providerTree,\n        "PAUSED"');
  });

  it("keeps partial provider creation resumable after app restart", () => {
    expect(service).toContain('"creating_paused_objects"');
    expect(service).toContain('action: "record_create_failure"');
    expect(service).not.toContain("item.value.campaigns.length === 0");
    expect(createRoute).toContain("Retry provider creation and launch");
  });

  it("uses the shared aggregate lifecycle for Host pause and plan-wide stop", () => {
    const detailRoute = read("app/(tabs)/marketing/ads/[id].tsx");
    expect(campaignService).toContain('"admin-ad-campaign-action"');
    expect(planEndpoint).toContain('action === "cancel_before_create"');
    expect(hostCampaignEndpoint).toContain("campaign_ids: planCampaigns.map");
    expect(hostCampaignEndpoint).toContain('from("ad_campaign_settlements")');
    expect(campaignService).toContain("settlements:");
    expect(detailRoute).toContain("Stop and settlement");
    expect(detailRoute).toContain("Final provider spend");
  });

  it("reuses the shared resumable video picker instead of inventing an Ads uploader", () => {
    expect(planEndpoint).toContain('.from("ad_creatives")');
    expect(planEndpoint).toContain('.eq("kind", "video")');
    expect(createRoute).toContain("CoverPickerSheet");
    expect(createRoute).toContain('mediaMode="video-only"');
    // [TEST-MOD-APPROVED #3040] B-C14 — no client record call; the route links
    // the server-created creative id, and says nothing reaches ad platforms
    // before the plan is funded and confirmed.
    expect(createRoute).toContain("patch.adCreativeId");
    expect(createRoute).toContain("Nothing goes to ad platforms until you fund and confirm the plan.");
    expect(createRoute).not.toMatch(/uploadAsync|createUpload|bunny.*upload/i);
  });

  it("exposes only permission-scoped Host setup data", () => {
    expect(planEndpoint).toContain('action === "host_setup"');
    expect(planEndpoint).toContain("ad_can_host_action");
    expect(planEndpoint).toContain('p_action: "read"');
    expect(planEndpoint).toContain(
      "id,platform,lane,currency,status,connected,updated_at",
    );
    expect(planEndpoint).not.toContain('select("*,secret');
  });

  it("keeps planning, funding, launch, pause and end as separate grants", () => {
    const detailRoute = read("app/(tabs)/marketing/ads/[id].tsx");
    expect(createRoute).toContain("permissions.canPlan");
    expect(createRoute).toContain("permissions.canFund");
    expect(createRoute).toContain("permissions.canLaunch");
    expect(detailRoute).toContain("permissions.canPause");
    expect(detailRoute).toContain("permissions.canEnd");
    expect(hostCampaignEndpoint).toContain("p_action: requiredPermission");
  });

  it("shows Ari's server-resolved brand currency without inventing a top-up", () => {
    expect(ariCard).toContain("context.ad_budget_cents");
    expect(ariCard).toContain('label: "Hard cap"');
    expect(ariCard).toContain('label: "Daily total"');
    expect(ariCard).not.toContain('label: "Total top-up"');
  });
});
