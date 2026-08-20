#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sources = {
  migration: read(
    "supabase/migrations/20270505001973_issue_1973_ari_experience_lifecycle.sql",
  ),
  tools: read("supabase/functions/_shared/agentTools.ts"),
  domain: read("supabase/functions/_shared/agentDomainTools.ts"),
  confirm: read("supabase/functions/agent-confirm-action/index.ts"),
  play: read("supabase/functions/parse-play-activities/index.ts"),
  menu: read("supabase/functions/parse-restaurant-menu/index.ts"),
  business: read("mingla-business/src/services/experienceDetailService.ts"),
  prompt: read("supabase/functions/_shared/agentSystemPrompt.ts"),
  truthTest: read(
    "supabase/functions/agent-confirm-action/__tests__/issue_1973_create_draft_followup.implementor.test.ts",
  ),
  certificationTest: read(
    "supabase/migrations/__tests__/issue_1973_ari_experience_lifecycle.round2.implementor.happy.pg17.test.sql",
  ),
  workflow: read(".github/workflows/issue-1973-ari-experience-lifecycle.yml"),
};

function check(s) {
  const failures = [];
  const requireAll = (label, source, needles) => {
    for (const needle of needles) {
      if (!source.includes(needle)) {
        failures.push(`${label}: missing ${needle}`);
      }
    }
  };

  requireAll("migration", s.migration, [
    "issue_1973_agent_experience_payload",
    "issue_1973_create_snap_proposals",
    "business_create_experience_graph",
    "business_apply_experience_action",
    "business_discard_experience_draft",
    "business_unpublish_experience_to_draft",
    "ari_execute_experience_operation",
    "agent_operation_receipt_begin",
    "agent_operation_receipt_complete",
    "stale_experience_revision",
    "experience_media_reference_required",
    "experience_has_buyer_dependencies",
    "experience_timezone_required",
    "show_on_discover=false,show_in_swipeable_deck=false",
    "public.scan_events",
    "public.event_rsvp_guests",
    "public.event_rsvp_contributions",
    "public.attendance_claim_deliveries",
  ]);
  if (s.migration.includes("CREATE TABLE public.agent_operation_receipts")) {
    failures.push("migration duplicates #1972 receipt storage");
  }
  if (s.tools.includes("p_payload")) {
    failures.push(
      "create payload is not derived from immutable receipt-bound args",
    );
  }
  requireAll("tools", s.tools, [
    '"create_experience"',
    '"ari_execute_experience_operation"',
    "requireAgentOperationId(context)",
  ]);
  requireAll("domain", s.domain, [
    '"publish_experience"',
    '"update_experience"',
    '"manage_experience_stops"',
    '"unpublish_experience"',
    '"delete_experience"',
    '"ari_execute_experience_operation"',
  ]);
  if (s.domain.includes('.from("events").update({ deleted_at')) {
    failures.push("domain bypasses canonical draft discard");
  }
  requireAll("confirm", s.confirm, [
    '"create_experience"',
    '"manage_experience_stops"',
    '"unpublish_experience"',
    "RECEIPT_BACKED_TOOL_NAMES",
  ]);
  const followup = s.confirm.slice(
    s.confirm.indexOf("export function buildFollowupText"),
  );
  requireAll("truthful create follow-up", followup, [
    'canonical.status !== "draft"',
    'canonical.visibility !== "draft"',
    "canonical.published_at !== null",
    "Created draft experience",
  ]);
  if (followup.includes("Published experience")) {
    failures.push("create follow-up still fabricates a published lifecycle");
  }
  requireAll("truthful create behavior proof", s.truthTest, [
    'buildFollowupText("create_experience", canonicalDraft)',
    'assertEquals(copy?.includes("Published"), false)',
    'status: "scheduled"',
    "undefined",
  ]);
  requireAll("117-capability certification proof", s.certificationTest, [
    "ari.experience.unpublish",
    "ari_cert_missing_capabilities:116",
    "expected exactly 117 certification requirements",
  ]);
  requireAll("workflow", s.workflow, [
    "issue_1973_create_draft_followup.implementor.test.ts",
    "deno fmt --check",
    "agentToolAuthorization.ts",
  ]);
  for (const [label, parser] of [["play", s.play], ["menu", s.menu]]) {
    requireAll(label, parser, [
      "biz_brand_effective_rank_for_caller",
      'p_role: "event_manager"',
      'rpc("issue_1973_create_snap_proposals"',
    ]);
    if (parser.includes('.from("agent_pending_actions").insert')) {
      failures.push(`${label}: caller-JWT pending-action insert remains`);
    }
    if (parser.includes("brand.account_id !== userId")) {
      failures.push(`${label}: owner-only Snap authorization remains`);
    }
  }
  requireAll("business", s.business, [
    "unpublishExperienceToDraft",
    "business_unpublish_experience_to_draft",
  ]);
  requireAll("prompt", s.prompt, [
    "manage_experience_stops",
    "unpublish_experience",
    "/experience/snap",
  ]);
  return failures;
}

if (process.argv.includes("--self-test")) {
  const mutations = [
    {
      ...sources,
      migration: sources.migration.replaceAll(
        "agent_operation_receipt_begin",
        "removed_receipt_begin",
      ),
    },
    {
      ...sources,
      tools: sources.tools.replaceAll(
        "p_args: args",
        "p_args: args, p_payload: payload",
      ),
    },
    {
      ...sources,
      domain: sources.domain.replaceAll(
        '"unpublish_experience"',
        '"removed_unpublish"',
      ),
    },
    {
      ...sources,
      play: sources.play.replaceAll(
        "issue_1973_create_snap_proposals",
        "removed_snap_boundary",
      ),
    },
    {
      ...sources,
      business: sources.business.replaceAll(
        "business_unpublish_experience_to_draft",
        "removed_rpc",
      ),
    },
    {
      ...sources,
      confirm: sources.confirm.replace(
        "Created draft experience",
        "Published experience",
      ),
    },
    {
      ...sources,
      truthTest: sources.truthTest.replace(
        'assertEquals(copy?.includes("Published"), false)',
        'assertEquals(copy?.includes("Published"), true)',
      ),
    },
    {
      ...sources,
      certificationTest: sources.certificationTest.replace(
        "ari_cert_missing_capabilities:116",
        "accepted_obsolete_inventory",
      ),
    },
  ];
  if (mutations.some((mutation) => check(mutation).length === 0)) {
    console.error("issue-1973 self-test FAIL: a material revert escaped");
    process.exit(1);
  }
  console.log("issue-1973 self-test PASS (8 hostile mutations)");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error(
    "issue-1973 FAIL:\n" + failures.map((item) => `  - ${item}`).join("\n"),
  );
  process.exit(1);
}
console.log("issue-1973 PASS");
