import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const endpoint = await Deno.readTextFile(
  new URL(
    "../../admin-ad-create-native-app-campaign/index.ts",
    import.meta.url,
  ),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20271101003698_issue_3697_native_app_execution.sql",
    import.meta.url,
  ),
);

Deno.test("#3697 native endpoint consumes only immutable plan authority", () => {
  for (
    const contract of [
      "parseFrozenNativeAppDestination",
      "assertNativeAppRequestDestination",
      "assertNativeAppImmutableRequest",
      "nativeCompiledTargeting",
      "nativeAppCopyFromCanonicalPlan",
      "nativeAppCreativeIdFromCanonicalPlan",
      'plan.owner_kind !== "mingla"',
      "binding.payer_connection_id !== connection.id",
      "allocation.provider_currency",
    ]
  ) assertStringIncludes(endpoint, contract);
  assert(!endpoint.includes("body.provider_app_id"));
  assert(!endpoint.includes("body.store_identifier"));
  assert(!endpoint.includes("body.compiled_targeting"));
});

Deno.test("#3697 exact readiness and launchability are rechecked immediately before create", () => {
  const handler = endpoint.slice(endpoint.indexOf("serve(async"));
  const readiness = handler.indexOf('"can_create_native_app_campaign"');
  const launchable = handler.indexOf('"ad_plan_assert_launchable"');
  const execute = handler.indexOf("created = await executeProvider");
  assert(readiness > 0);
  assert(launchable > readiness);
  assert(execute > launchable);
  assertStringIncludes(handler.slice(readiness, execute), "canCreate !== true");
  assertStringIncludes(handler.slice(readiness, execute), "launchableError");
});

Deno.test("#3697 every provider path is install-native and paused by its tested adapter", () => {
  for (
    const token of [
      'objective: "OUTCOME_APP_PROMOTION"',
      'objective: "APP_PROMOTION"',
      'objective: "APP_INSTALLS"',
      "googleCreateAppCampaign",
      'optimizationGoal: "APP_INSTALLS"',
      'optimizationGoal: "INSTALL"',
      'optimizationGoal: "MOBILE_CONVERSION_INSTALL"',
      'callToActionType: "INSTALL_MOBILE_APP"',
      'creativeType: "APP_INSTALL"',
    ]
  ) assertStringIncludes(endpoint, token);
  assert(!endpoint.includes('action: "launch"'));
  assert(!endpoint.includes('status: "ACTIVE"'));
});

Deno.test("#3697 persistence and Snap icon authority are schema-enforced", () => {
  assertStringIncludes(migration, "'explorer_app', 'host_app'");
  assertStringIncludes(migration, "provider_app_icon_media_id");
  assertStringIncludes(migration, "set_ad_app_snap_icon");
  assertStringIncludes(
    migration,
    "b.provider<>'snapchat' OR b.provider_app_icon_media_id IS NOT NULL",
  );
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.set_ad_app_snap_icon(jsonb)",
  );
});
