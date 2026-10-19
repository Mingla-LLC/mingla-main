/**
 * toward #3697 Wave 7c — Confirm withdraw, Ads list/detail, Ari Host Ads tools.
 */

import fs from "node:fs";
import path from "node:path";

import { AdCreditAppError } from "../../../services/adCreditService";
import { mapAdCreditQuoteError } from "../../../services/adCreditQuoteErrors";

const root = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("issue #3697 Wave 7c Host Ads surfaces", () => {
  it("Confirm withdraw is wired with stable idempotency", () => {
    const sheet = read("src/components/marketing/AdCreditQuoteSheet.tsx");
    expect(sheet).toContain("ad-credit-quote-confirm-withdraw");
    expect(sheet).toContain("applyAdCreditWithdraw");
    expect(sheet).toContain("withdrawIdemRef");
    expect(sheet).toContain("Confirm withdraw");
    const svc = read("src/services/adCreditService.ts");
    expect(svc).toContain('action: "apply_withdraw"');
  });

  it("Ads list + detail routes replace the placeholder", () => {
    const route = read("app/(tabs)/marketing/ads/index.tsx");
    expect(route).toContain("useHostAdCampaigns");
    expect(route).toContain("ads-campaigns-empty");
    expect(route).not.toContain("ads-campaigns-placeholder");
    expect(route).toContain("paystackReference");
    expect(route).toContain("mingla_adc_");
    const detail = read("app/(tabs)/marketing/ads/[id].tsx");
    expect(detail).toContain("ads-detail-screen");
    expect(detail).toContain("ads-detail-pause");
    expect(detail).toContain("ads-detail-end");
    expect(detail).toContain("ads-detail-cancel");
    expect(detail).toContain("provider_spend_by_currency");
    expect(detail).toContain("host_spend_equivalent_cents");
    expect(detail).toContain("host_spend_equivalent_quality");
    expect(detail).not.toContain("spend_total_cents");
    expect(detail).toContain("Results");
    expect(detail).toContain("Creative");
    expect(detail).toContain("Timeline");
    expect(detail).toContain("by_placement");
  });

  it("Hub live-ad cards link to ad detail", () => {
    const hub = read("app/(tabs)/hub/events.tsx");
    expect(hub).toContain("hub-live-ads");
    expect(hub).toContain("useHostAdCampaigns");
    expect(hub).toContain("/(tabs)/marketing/ads/");
  });

  it("Ari Host Ads tool names are humanized and money-gated", () => {
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).toContain('case "propose_ad_plan"');
    expect(card).toContain('case "approve_ad_plan"');
    expect(card).toContain('case "pause_ad_campaign"');
    expect(card).toContain('case "end_ad_campaign"');
    expect(card).toContain('case "get_ad_campaign_report"');
    expect(card).toContain('approve_ad_plan: "LAUNCH"');
    expect(card).toContain('end_ad_campaign: "END"');
    // [TEST-MOD-APPROVED #3697] Ari records only the canonical video. Native
    // provider copies are plan-bound launch work in hostAdPlanService.
    // [TEST-MOD-APPROVED #3040] B-C14 — the server creates the creative from
    // the READY ad_creative job; the card links the id it is handed.
    expect(card).toContain("patch.adCreativeId");
    expect(card).toContain("Add ad video");
    expect(card).toContain('toolName === "approve_ad_plan"');
    expect(card).toContain("editing || isAdPlanProposal ? editedArgs : args");
    // [TEST-MOD-APPROVED #3040] ariAdCreativeService (recordHostAdVideo) is
    // deleted; nothing on the client calls admin-ad-creative-prepare either.
    expect(card).not.toContain('"admin-ad-creative-prepare"');
    const plan = read("src/services/hostAdPlanService.ts");
    expect(plan).toContain('"admin-ad-creative-prepare"');
    expect(plan).toContain('lane: "business"');
    expect(plan).toContain("plan_version_id: aggregate.version.id");
    expect(plan).toContain("plan_hash: aggregate.version.plan_hash");
    const route = read("app/(tabs)/marketing/ads/create.tsx");
    expect(route).toContain("host-ad-add-video");
    expect(route).toContain('mediaMode="video-only"');
  });

  it("maps NGN currency copy and withdraw provider failures", () => {
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "currency_unsupported"),
      ),
    ).toMatch(/NGN/i);
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("apply_failed", "x", "provider_refund_partial"),
      ),
    ).toMatch(/refund failed/i);
  });
});
