#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sources = {
  migration: read("supabase/migrations/20270503001973_issue_1973_ari_experience_lifecycle.sql"),
  tools: read("supabase/functions/_shared/agentTools.ts"),
  domain: read("supabase/functions/_shared/agentDomainTools.ts"),
  confirm: read("supabase/functions/agent-confirm-action/index.ts"),
  play: read("supabase/functions/parse-play-activities/index.ts"),
  menu: read("supabase/functions/parse-restaurant-menu/index.ts"),
  business: read("mingla-business/src/services/experienceDetailService.ts"),
  prompt: read("supabase/functions/_shared/agentSystemPrompt.ts"),
};

function check(s) {
  const failures = [];
  const requireAll = (label, source, needles) => {
    for (const needle of needles) {
      if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
    }
  };

  requireAll("migration", s.migration, [
    "issue_1973_agent_experience_payload",
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
  ]);
  if (s.migration.includes("CREATE TABLE public.agent_operation_receipts")) {
    failures.push("migration duplicates #1972 receipt storage");
  }
  if (s.tools.includes("p_payload")) {
    failures.push("create payload is not derived from immutable receipt-bound args");
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
  for (const [label, parser] of [["play", s.play], ["menu", s.menu]]) {
    requireAll(label, parser, [
      "biz_brand_effective_rank_for_caller",
      'p_role: "event_manager"',
      ".insert(proposalRows)",
    ]);
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
    { ...sources, migration: sources.migration.replaceAll("agent_operation_receipt_begin", "removed_receipt_begin") },
    { ...sources, tools: sources.tools.replaceAll("p_args: args", "p_args: args, p_payload: payload") },
    { ...sources, domain: sources.domain.replaceAll('"unpublish_experience"', '"removed_unpublish"') },
    { ...sources, play: sources.play.replaceAll(".insert(proposalRows)", ".insert(proposal)") },
    { ...sources, business: sources.business.replaceAll("business_unpublish_experience_to_draft", "removed_rpc") },
  ];
  if (mutations.some((mutation) => check(mutation).length === 0)) {
    console.error("issue-1973 self-test FAIL: a material revert escaped");
    process.exit(1);
  }
  console.log("issue-1973 self-test PASS (5 hostile mutations)");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-1973 FAIL:\n" + failures.map((item) => `  - ${item}`).join("\n"));
  process.exit(1);
}
console.log("issue-1973 PASS");
