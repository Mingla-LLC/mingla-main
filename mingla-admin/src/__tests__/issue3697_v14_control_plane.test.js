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
  const builder = read("src/pages/CampaignBuilderPage.jsx");
  const payload = read("src/lib/adBuilder/payload.js");
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
  });

  it("binds platform-neutral copy and creative intent to the immutable plan", () => {
    assert.match(payload, /copy_intent:\s*copy/);
    assert.match(payload, /creative_intent:/);
    assert.match(createEndpoint, /plan_copy_mismatch/);
    assert.match(createEndpoint, /plan_creative_mismatch/);
    assert.match(createEndpoint, /plan_schedule_mismatch/);
    assert.match(createEndpoint, /plan_compliance_mismatch/);
  });

  it("launches or pauses every provider campaign in the plan aggregate", () => {
    assert.match(actionEndpoint, /runPlannedAction/);
    assert.match(actionEndpoint, /\.eq\("plan_version_id", versionId\)/);
    assert.match(actionEndpoint, /partially_live/);
    assert.match(actionEndpoint, /ad_record_provider_attempt/);
    assert.match(actionEndpoint, /legacy_campaign_reconciliation_required/);
    assert.match(actionEndpoint, /biz_can_manage_payments_for_brand/);
    assert.match(actionEndpoint, /campaign\.owner_kind !== "host"/);
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
