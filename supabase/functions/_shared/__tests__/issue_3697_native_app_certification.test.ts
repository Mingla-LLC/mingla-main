import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const certification = await Deno.readTextFile(
  new URL("../../admin-ad-app-certification/index.ts", import.meta.url),
);
const create = await Deno.readTextFile(
  new URL(
    "../../admin-ad-create-native-app-campaign/index.ts",
    import.meta.url,
  ),
);
const plan = await Deno.readTextFile(
  new URL("../../ad-plan/index.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20271101003699_issue_3697_native_app_certification.sql",
    import.meta.url,
  ),
);

Deno.test("#3697 certification is a separate expiring owner-approved authority", () => {
  for (
    const token of [
      "approved_to_prepare",
      "approval_expires_at",
      "approval_scope_hash",
      "approved_spend_ceiling_cents",
      "can_create_native_app_canary",
      "can_run_native_app_canary",
      "transition_ad_app_canary",
      "role='owner'",
      "APPROVE '",
    ]
  ) assertStringIncludes(migration, token);
  assertStringIncludes(
    migration,
    "enable_native_app_campaign_certification','true'::jsonb",
  );
});

Deno.test("#3697 normal native creation and canary creation cannot borrow authority", () => {
  assertStringIncludes(create, '"can_create_native_app_canary"');
  assertStringIncludes(create, '"can_create_native_app_campaign"');
  assertStringIncludes(create, "certificationMode");
  assertStringIncludes(create, 'action: "provider_prepared"');
  assertStringIncludes(create, '"transition_ad_app_canary"');
  assertStringIncludes(migration, "canary.status='approved_to_prepare'");
  assertStringIncludes(migration, "canary.status='paused_ready'");
});

Deno.test("#3697 certification launch is typed, bounded, and stop is provider-confirmed", () => {
  assertStringIncludes(
    certification,
    'body.confirm_phrase !== "LAUNCH CERTIFICATION"',
  );
  assertStringIncludes(certification, "can_run_native_app_canary");
  assertStringIncludes(certification, "confirmsActive");
  assertStringIncludes(certification, "confirmsPaused");
  assertStringIncludes(certification, '"ad_spend_daily"');
  assertStringIncludes(certification, '"ad_request_campaign_stop"');
  assertStringIncludes(certification, 'settlement.state !== "settled"');
  assertStringIncludes(certification, 'transition_action: "spend_exceeded"');
  assertStringIncludes(certification, 'transition_action: "provider_stopped"');
  assertStringIncludes(migration, "v_spend<=approved_spend_ceiling_cents");
  assertStringIncludes(migration, "v_settlement.state<>'settled'");
  assertStringIncludes(migration, "v_action='spend_exceeded'");
});

Deno.test("#3697 canary evidence derives provider/app identity on the server", () => {
  assertStringIncludes(certification, "mediaSource(provider)");
  assertStringIncludes(certification, "target.store_identifier");
  assertStringIncludes(certification, "canary.safe_provider_campaign_id");
  assertStringIncludes(certification, "device_os: os");
  assert(!certification.includes("store_identifier: body."));
  assert(!certification.includes("campaign_id: body."));
});

Deno.test("#3697 certification planning uses readiness without enabling self-serve", () => {
  assertStringIncludes(plan, "certification_mode");
  assertStringIncludes(plan, "can_prepare_native_app_canary");
  assertStringIncludes(plan, "certification_plan_scope_invalid");
  assertStringIncludes(plan, "app_certification_readiness_required");
});
