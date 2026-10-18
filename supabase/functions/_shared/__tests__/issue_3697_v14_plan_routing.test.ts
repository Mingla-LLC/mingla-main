import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("v1.4 Host mutations cannot bypass plan funding or final settlement", async () => {
  const source = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assertStringIncludes(source, 'error: "plan_required"');
  assertStringIncludes(source, '"ad_plan_assert_launchable"');
  assertStringIncludes(source, '"ad_request_campaign_stop"');
  assertStringIncludes(source, "final_spend_pending: true");
  assertStringIncludes(
    source,
    'detail: "partial_plan_reconciliation_required"',
  );
  assertStringIncludes(source, "ENDABLE_PLAN_STATES");
  assertEquals(source.includes('supabase.rpc("ad_credit_apply"'), false);
  assertEquals(source.includes("hostDefaultCountriesForCurrency("), false);
});

Deno.test("v1.4 provider create binds the executable version before a platform write", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const planGate = source.indexOf(
    "plan_version_and_hash_required_before_provider_create",
  );
  const firstProviderCreate = source.indexOf(
    "await googleCreateDemandGenVideoCampaign(",
  );
  assert(planGate > 0);
  assert(firstProviderCreate > planGate);
  for (
    const field of [
      "plan_version_id",
      "plan_hash",
      "host_currency",
      "provider_currency",
      "host_budget_cents",
      "provider_budget_cents",
      "provider_delivery_budget_cents",
      "fx_snapshot_id",
    ]
  ) assertStringIncludes(source, field);
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assertStringIncludes(plan, 'action === "record_create_failure"');
  // [TEST-MOD-APPROVED #3697] Provider residue is terminal until reconciled;
  // only a failure with no surviving provider IDs remains safely retryable.
  assertStringIncludes(plan, "state: reconciliationRequired");
  assertStringIncludes(plan, '"creation_failed_terminal"');
  assertStringIncludes(plan, '"creation_failed_retryable"');
});

Deno.test("v1.4 app destinations must be ready before an immutable version is frozen", async () => {
  const endpoint = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20271101003697_issue_3697_v14_control_plane.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(endpoint, "resolvedDestination.ready !== true");
  assertStringIncludes(endpoint, '"destination_not_ready"');
  assertStringIncludes(endpoint, 'action === "list_destinations"');
  assertStringIncludes(endpoint, "provider_readiness");
  const createVersion = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ad_plan_create_version",
    ),
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ad_plan_quote_for_brand",
    ),
  );
  assertStringIncludes(createVersion, "ad_plan_destination_not_ready:%");
  assertStringIncludes(createVersion, "ad_plan_fx_delivery_amount_mismatch");
  assertStringIncludes(createVersion, "v_canonical_plan := jsonb_set");
  assertStringIncludes(createVersion, "provider_delivery_budget_cents");
  assertStringIncludes(migration, "host_delivery_budget_cents");
  assertStringIncludes(migration, "provider_delivery_budget_cents");
  assertStringIncludes(
    migration,
    "'staff_approved','creation_failed_retryable'",
  );
  assertStringIncludes(migration, "'app_install'");
  assertStringIncludes(migration, "'install'");
  assertStringIncludes(migration, "v_store_url");
});

Deno.test("v1.4 spend worker waits for provider stop and a finality window", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  assertStringIncludes(source, "reconcileStoppedCampaign");
  assertStringIncludes(source, '"ad_confirm_campaign_stop"');
  assertStringIncludes(source, 'p_finality_delay: "24 hours"');
  assertStringIncludes(source, '"ad_finalize_campaign_settlement"');
  assertStringIncludes(source, 'providerStatus !== "PAUSED"');
  assertStringIncludes(source, "provider_budget_cents");
  assertStringIncludes(source, "providerCapCents(target)");
  assertEquals(source.includes("cap_cents: target.cap_cents"), false);
});

Deno.test("v1.4 Admin end is plan-wide, typed, complete, and settlement-backed", async () => {
  const action = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20271101003697_issue_3697_v14_control_plane.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(action, "runPlannedEnd");
  assertStringIncludes(action, 'confirmPhrase !== "END PLAN"');
  assertStringIncludes(
    action,
    'detail: "partial_plan_reconciliation_required"',
  );
  assertStringIncludes(action, '"ad_request_campaign_stop"');
  assertStringIncludes(action, "final_spend_pending: successes > 0");
  assertStringIncludes(migration, "('platform_review','stop_requested')");
  assertStringIncludes(migration, "('platform_rejected','stop_requested')");
  assertStringIncludes(
    migration,
    "SET stop_requested_at = least(",
  );
  assertEquals(
    migration.includes(
      "THEN public.ad_campaign_settlements.state ELSE 'stop_requested'",
    ),
    false,
  );
});

Deno.test("v1.4 Admin and Host relaunch gates use provider-account caps", async () => {
  const admin = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  for (const source of [admin, host]) {
    assertStringIncludes(source, "providerCapCents");
    assertStringIncludes(source, 'detail: "provider_cap_unresolved"');
    assertStringIncludes(source, 'detail: "hard_cap_reached"');
    assertStringIncludes(source, 'select("spend_cents,currency")');
    assertStringIncludes(source, "startDateNotReached");
    assertStringIncludes(source, "endDatePassed");
  }
});

Deno.test("v1.4 Ari never accepts currency or reconstructs an approved plan", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const start = source.indexOf("const proposeAdPlan");
  const end = source.indexOf("const pauseAdCampaign", start);
  const ads = source.slice(start, end);
  assert(start > 0 && end > start);
  assertEquals(ads.includes("hostAdCountries"), false);
  assertEquals(ads.includes("currency: { type:"), false);
  assertStringIncludes(ads, "plan_version_id");
  assertStringIncludes(ads, "plan_hash");
  assertStringIncludes(ads, "platforms");
  const safeValidation = ads.indexOf(
    "buildHostAdCreatePayload(aggregate, platform, operationId, true)",
  );
  const funding = ads.indexOf('action: "fund"');
  const confirmation = ads.indexOf('action: "confirm_launch"');
  const preparation = ads.indexOf('"admin-ad-creative-prepare"');
  assert(funding > 0);
  assert(confirmation > funding);
  assert(preparation > confirmation);
  assert(safeValidation > preparation);
  const actualCreate = ads.indexOf(
    "buildHostAdCreatePayload(aggregate, platform, operationId)",
  );
  const activationLoop = ads.indexOf(
    "for (const item of createdCampaigns)",
    actualCreate,
  );
  const hostLaunch = ads.indexOf('action: "launch"', activationLoop);
  assert(actualCreate > 0 && activationLoop > actualCreate);
  assert(hostLaunch > activationLoop);
  const pauseStart = source.indexOf("const pauseAdCampaign");
  const pauseEnd = source.indexOf("const endAdCampaign", pauseStart);
  const pauseTool = source.slice(pauseStart, pauseEnd);
  assertStringIncludes(pauseTool, '"admin-ad-campaign-action"');
  assertEquals(pauseTool.includes('"host-ad-campaign"'), false);
});
