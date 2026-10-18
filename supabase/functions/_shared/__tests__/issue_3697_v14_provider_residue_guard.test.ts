import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// [TEST-MOD-APPROVED #3697] This initiative owns the provider-write ordering
// contract. These structural guards keep preview and validation read-only while
// allowing the confirmed create path to prepare provider-native image objects.

Deno.test("#3697 provider-create failures bind durable residue to the immutable plan", async () => {
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );

  assertStringIncludes(create, "function planBoundFailureIds(");
  assertStringIncludes(create, "plan_version_id: planVersionId");
  assertStringIncludes(create, "external_ids: planBoundFailureIds(");
  assertStringIncludes(plan, 'action === "record_create_failure"');
  assertStringIncludes(
    plan,
    '.contains("external_ids", { plan_version_id: versionId })',
  );
  assertStringIncludes(plan, 'matchingFailure?.action === "create_failed"');
  assertStringIncludes(plan, "delete recordedIds.plan_version_id");
  assertStringIncludes(plan, "attemptState = reconciliationRequired");
  assertStringIncludes(plan, '"failed_terminal"');
  assertStringIncludes(plan, "state: reconciliationRequired");

  const stateUpdate = plan.indexOf("state: reconciliationRequired");
  const response = plan.indexOf(
    "reconciliation_required: reconciliationRequired",
  );
  assert(stateUpdate > 0);
  assert(response > stateUpdate);
});

Deno.test("#3697 cancel checks provider residue even when no campaign row exists", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20271101003697_issue_3697_v14_control_plane.sql",
      import.meta.url,
    ),
  );
  const cancel = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ad_plan_cancel_before_create",
    ),
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ad_plan_record_review",
    ),
  );
  assertStringIncludes(cancel, "FROM public.ad_status_events e");
  assertStringIncludes(cancel, "e.action = 'create_failed'");
  assertStringIncludes(cancel, "e.external_ids->>'plan_version_id'");
  assertStringIncludes(cancel, "e.external_ids->>'plan_hash'");
  assertStringIncludes(
    cancel,
    "(e.external_ids - 'plan_version_id' - 'plan_hash') <> '{}'::jsonb",
  );
  assertStringIncludes(cancel, "ad_plan_provider_objects_may_exist");
});

Deno.test("#3697 preview consumes prepared media without creating provider media", async () => {
  const preview = await Deno.readTextFile(
    new URL("../../admin-ad-preview/index.ts", import.meta.url),
  );

  assertStringIncludes(preview, '.eq("status", "ready")');
  assertStringIncludes(preview, 'metaGraph(\n        client,\n        "GET"');
  assertStringIncludes(preview, 'method: "GET"');
  for (
    const forbidden of [
      "resolveCreativeRef(",
      "tiktokUploadImage(",
      "adapter.initiate(",
      "createFullCampaignAtomic(",
      'method: "POST"',
    ]
  ) {
    assertEquals(
      preview.includes(forbidden),
      false,
      `preview must not contain provider mutation ${forbidden}`,
    );
  }
});

Deno.test("#3697 create-time provider image writes remain behind plan and validation gates", async () => {
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const handler = create.slice(create.indexOf("serve(async"));
  const launchable = handler.indexOf('"ad_plan_assert_launchable"');
  const googleBranch = handler.indexOf('if (platform === "google")');
  const snapBranch = handler.indexOf('if (platform === "snapchat")');
  const tiktokBranch = handler.indexOf('if (platform === "tiktok")');
  const redditBranch = handler.indexOf('if (platform === "reddit")');
  const metaCreate = handler.lastIndexOf(
    "const created = await createFullCampaignAtomic",
  );

  assert(launchable > 0, "immutable launch gate must exist");
  for (const branch of [googleBranch, snapBranch, tiktokBranch, redditBranch]) {
    assert(branch > launchable, "provider branch must follow the launch gate");
  }
  assert(metaCreate > launchable, "Meta create must follow the launch gate");

  const tiktokValidate = handler.indexOf("if (validateOnlyT)", tiktokBranch);
  const tiktokImageUpload = handler.indexOf(
    "const uploaded = await tiktokUploadImage",
    tiktokBranch,
  );
  assert(tiktokValidate > tiktokBranch);
  assert(tiktokImageUpload > tiktokValidate);
  assertStringIncludes(
    handler.slice(tiktokValidate, tiktokImageUpload),
    "nothing created, nothing persisted",
  );

  const metaValidate = handler.lastIndexOf("if (validateOnly)", metaCreate);
  assert(metaValidate > launchable);
  assert(metaCreate > metaValidate);
  assertStringIncludes(
    handler.slice(metaValidate, metaCreate),
    "nothing created on the platform, nothing persisted",
  );
});
