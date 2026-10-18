import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 v1.4 Admin control plane", () => {
  const campaigns = read("src/pages/CampaignsPage.jsx");
  const adsConsole = read("src/pages/AdEnginePage.jsx");
  const builder = read("src/pages/CampaignBuilderPage.jsx");
  const creativeStep = read("src/components/campaign-builder/StepCreative.jsx");
  const reviewStep = read("src/components/campaign-builder/StepReview.jsx");
  const budgetStep = read("src/components/campaign-builder/StepBudget.jsx");
  const currencyInput = read("src/components/ui/CurrencyInput.jsx");
  const payload = read("src/lib/adBuilder/payload.js");
  const launchSummary = read("src/lib/adBuilder/launchSummary.js");
  const spendCap = read("src/lib/adSpendCap.js");
  const createEndpoint = read(
    "../supabase/functions/admin-ad-create-campaign/index.ts",
  );
  const actionEndpoint = read(
    "../supabase/functions/admin-ad-campaign-action/index.ts",
  );
  const nativeEndpoint = read(
    "../supabase/functions/admin-ad-create-native-app-campaign/index.ts",
  );
  const service = read("src/services/adEngineService.js");
  const certificationEndpoint = read(
    "../supabase/functions/admin-ad-app-certification/index.ts",
  );
  const certificationBoundary = read(
    "src/components/app-readiness/FutureAppCampaignBoundary.jsx",
  );

  it("has a real Host staff-review queue with all three decisions", () => {
    assert.match(campaigns, /action:\s*"review_queue"/);
    assert.match(campaigns, /decision:\s*"approved"/);
    assert.match(campaigns, /decision:\s*"changes_requested"/);
    assert.match(campaigns, /decision:\s*"rejected"/);
    assert.match(campaigns, /Funds are held, not spent/);
    assert.match(campaigns, /Held funds were released/);
  });

  it("freezes and displays provider targeting differences before create", () => {
    assert.match(builder, /action:\s*"freeze_targeting"/);
    assert.match(builder, /targeting_snapshots/);
    assert.match(builder, /broader_acceptance/);
    assert.match(builder, /confirmation_phrase:\s*"CREATE PAUSED"/);
    assert.match(reviewStep, /Provider estimate/);
    assert.match(reviewStep, /Do not add these estimates/);
    assert.match(reviewStep, /estimate_observed_at/);
    assert.match(campaigns, /Do not add platform estimates/);
    assert.match(campaigns, /provider_estimate/);
  });

  it("binds platform-neutral copy and creative intent to the immutable plan", () => {
    assert.match(payload, /copy_intent:\s*copy/);
    assert.match(payload, /creative_intent:/);
    assert.match(createEndpoint, /plan_copy_mismatch/);
    assert.match(createEndpoint, /plan_creative_mismatch/);
    assert.match(createEndpoint, /plan_schedule_mismatch/);
    assert.match(createEndpoint, /plan_compliance_mismatch/);
  });

  it("requires paid-media rights and freezes honest measurement disclosure", () => {
    assert.match(creativeStep, /Rights basis/);
    assert.match(creativeStep, /used in paid ads/);
    assert.match(creativeStep, /rightsBasis/);
    assert.match(creativeStep, /rightsConfirmed/);
    assert.match(creativeStep, /AI-generated/);
    assert.match(builder, /media_rights:/);
    assert.match(builder, /rights_confirmed:\s*creative\.rightsConfirmed/);
    assert.match(reviewStep, /measurement\.result_hierarchy/);
    assert.match(reviewStep, /Trusted Mingla results remain visible/);
    assert.match(reviewStep, /Media rights attested/);
    assert.match(
      campaigns,
      /Browser pixels and platform sharing are consent-gated/,
    );
  });

  it("renders Admin budgets in provider-account currency without manufacturing USD", () => {
    assert.match(builder, /currency=\{planCurrency\.currency\}/);
    assert.match(budgetStep, /Provider account currency required/);
    assert.match(budgetStep, /Mingla will not assume USD/);
    assert.match(budgetStep, /formatBudgetMoney\(currencyCode/);
    assert.doesNotMatch(budgetStep, /Hard cap \(USD\)/);
    assert.doesNotMatch(budgetStep, /Total daily budget \(USD\)/);
    assert.match(currencyInput, /currencyCode \?\? "—"/);
    assert.doesNotMatch(currencyInput, />\s*\$\s*</);
    assert.doesNotMatch(campaigns, /\?\? "USD"/);
    assert.match(campaigns, /providerMoneyAuthority/);
    assert.match(payload, /codes\.length !== platforms\.length/);
    assert.match(launchSummary, /currency = null/);
    assert.match(spendCap, /if \(!code\) return "—"/);
  });

  it("keeps provider spend/caps and attributed-value currency honest in Admin", () => {
    assert.match(campaigns, /provider_budget_cents/);
    assert.match(campaigns, /provider_delivery_budget_cents/);
    assert.match(campaigns, /providerDeliveryBudgets/);
    assert.match(campaigns, /provider_currency/);
    assert.match(campaigns, /No cross-currency/);
    assert.match(campaigns, /every enabled platform/);
  });

  it("removes the legacy direct-create and launch bypass from Ads console", () => {
    assert.match(adsConsole, /Governed campaign operations/);
    assert.match(adsConsole, /no direct provider-write shortcut/);
    assert.doesNotMatch(adsConsole, /createCampaign|campaignAction|budget_usd/);
    assert.match(createEndpoint, /provider_budget_floor_currency_unsupported/);
    assert.match(createEndpoint, /provider_delivery_budget_cents/);
    assert.match(nativeEndpoint, /provider_delivery_budget_cents/);
    assert.match(
      builder,
      /budget\.mode === "lifetime"[\s\S]*capByPlatform\.get/,
    );
  });

  it("launches or pauses every provider campaign in the plan aggregate", () => {
    assert.match(actionEndpoint, /runPlannedAction/);
    assert.match(actionEndpoint, /\.eq\("plan_version_id", versionId\)/);
    assert.match(actionEndpoint, /partially_live/);
    assert.match(actionEndpoint, /ad_record_provider_attempt/);
    assert.match(actionEndpoint, /legacy_campaign_reconciliation_required/);
    assert.match(actionEndpoint, /ad_can_host_action/);
    assert.match(actionEndpoint, /p_action:\s*"pause"/);
    assert.match(actionEndpoint, /campaign\.owner_kind !== "host"/);
  });

  it("ends a complete plan with a typed gate and exposes final settlement evidence", () => {
    assert.match(campaigns, /End plan/);
    assert.match(campaigns, /confirmPhrase="END PLAN"/);
    assert.match(campaigns, /Stop and settlement/);
    assert.match(campaigns, /Final provider spend/);
    assert.match(campaigns, /settlementsRefreshKey/);
    assert.match(service, /action: 'launch' \| 'pause' \| 'end'/);
    assert.match(service, /getPlanSettlements/);
    assert.match(actionEndpoint, /runPlannedEnd/);
    assert.match(actionEndpoint, /confirm_phrase_must_be_END_PLAN/);
    assert.match(actionEndpoint, /partial_plan_reconciliation_required/);
    assert.match(actionEndpoint, /"ad_request_campaign_stop"/);
    assert.match(actionEndpoint, /final_spend_pending/);
  });

  it("recovers Admin plans after reload from exact sealed provider templates", () => {
    const planEndpoint = read("../supabase/functions/ad-plan/index.ts");
    assert.match(builder, /execution_payloads:\s*executionPayloads/);
    assert.match(builder, /budget_mode:/);
    assert.match(planEndpoint, /action === "recovery_queue"/);
    assert.match(planEndpoint, /"creation_failed_retryable"/);
    assert.match(service, /resumeAdminAdPlan/);
    assert.match(service, /structuredClone\(template\)/);
    assert.match(service, /phrase:\s*"CREATE PAUSED"/);
    assert.match(service, /if \(existingPlatforms\.has\(platform\)\) continue/);
    assert.match(campaigns, /Mingla plans that need recovery/);
    assert.match(campaigns, /Resume exact paused create/);
    assert.match(campaigns, /confirmPhrase="CREATE PAUSED"/);
    assert.match(createEndpoint, /plan_execution_template_mismatch/);
    assert.match(nativeEndpoint, /plan_execution_template_mismatch/);
  });

  it("cancels only provider-object-free frozen plans behind a typed audit gate", () => {
    const planEndpoint = read("../supabase/functions/ad-plan/index.ts");
    assert.match(service, /cancelAdminAdPlan/);
    assert.match(service, /phrase:\s*"CANCEL PLAN"/);
    assert.match(campaigns, /Provider reconciliation hold/);
    assert.match(campaigns, /confirmPhrase="CANCEL PLAN"/);
    assert.match(campaigns, /requireReason/);
    assert.match(planEndpoint, /confirm_phrase_must_be_CANCEL_PLAN/);
    assert.match(planEndpoint, /p_reason:\s*reason\.slice/);
  });

  it("routes certified app destinations through the native execution endpoint", () => {
    assert.match(service, /\["explorer_app", "host_app"\]/);
    assert.match(service, /admin-ad-create-native-app-campaign/);
    assert.match(nativeEndpoint, /can_create_native_app_campaign/);
    assert.match(nativeEndpoint, /ad_plan_assert_launchable/);
    assert.match(nativeEndpoint, /native_app_certification_flow_required/);
    assert.match(nativeEndpoint, /status:\s*"PAUSED"/);
  });

  it("keeps provider certification bounded, typed, stoppable, and server-evidenced", () => {
    assert.match(service, /admin-ad-app-certification/);
    assert.match(certificationBoundary, /LAUNCH CERTIFICATION/);
    assert.match(certificationBoundary, /Stop and confirm provider/);
    assert.match(certificationBoundary, /Record bounded evidence/);
    assert.match(certificationEndpoint, /can_run_native_app_canary/);
    assert.match(certificationEndpoint, /provider_status_not_confirmed/);
    assert.match(certificationEndpoint, /actual_spend_cents/);
    assert.match(certificationEndpoint, /mediaSource\(provider\)/);
  });
});
