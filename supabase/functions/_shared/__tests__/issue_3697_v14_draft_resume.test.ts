import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const endpoint = await Deno.readTextFile(
  new URL("../../ad-plan/index.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20271101003697_issue_3697_v14_control_plane.sql",
    import.meta.url,
  ),
);

Deno.test("#3697 drafts are mutable server state, never executable versions", () => {
  assertStringIncludes(migration, "CREATE TABLE public.ad_plan_drafts");
  assertStringIncludes(migration, "draft_state jsonb NOT NULL");
  assertStringIncludes(migration, "revision bigint NOT NULL DEFAULT 1");
  assertStringIncludes(migration, "octet_length(draft_state::text) <= 524288");
  assertStringIncludes(migration, "created_by = auth.uid()");
  assert(!migration.includes("ad_plan_drafts_current_version"));
});

Deno.test("#3697 autosave uses actor ownership and optimistic concurrency", () => {
  assertStringIncludes(endpoint, 'action === "save_draft"');
  assertStringIncludes(endpoint, 'action === "get_draft"');
  assertStringIncludes(endpoint, 'action === "discard_draft"');
  assertStringIncludes(endpoint, "existing.created_by !== actor.id");
  assertStringIncludes(endpoint, '.eq("revision", existing.revision)');
  assertStringIncludes(endpoint, 'error: "draft_conflict"');
  assertStringIncludes(endpoint, "reload_before_overwriting_newer_draft");
});

Deno.test("#3697 draft scopes use the same independent Host plan permission", () => {
  assertStringIncludes(endpoint, "canAccessDraftScope");
  assertStringIncludes(endpoint, "p_action: permission");
  assertStringIncludes(endpoint, '"read" | "plan"');
  const scope = endpoint.slice(
    endpoint.indexOf("async function canAccessDraftScope"),
    endpoint.indexOf("async function canAccessPlan"),
  );
  assert(!scope.includes("payments"));
});
