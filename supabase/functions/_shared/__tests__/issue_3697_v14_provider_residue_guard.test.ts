import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

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
