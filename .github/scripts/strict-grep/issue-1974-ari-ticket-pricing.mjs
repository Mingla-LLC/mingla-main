#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sources = {
  domain: read("supabase/functions/_shared/agentDomainTools.ts"),
  helper: read("supabase/functions/_shared/agentTicketPricing.ts"),
  auth: read("supabase/functions/_shared/agentToolAuthorization.ts"),
  toolHelpers: read("supabase/functions/_shared/agentToolHelpers.ts"),
  chat: read("supabase/functions/agent-chat/index.ts"),
  confirm: read("supabase/functions/agent-confirm-action/index.ts"),
  migration: read("supabase/migrations/20270430001974_issue_1974_ari_ticket_pricing.sql"),
  draftService: read("mingla-business/src/services/eventDrafts.ts"),
  publishedEditor: read("mingla-business/src/components/event/EditPublishedScreen.tsx"),
  pricingService: read("mingla-business/src/services/pricingSwitchesService.ts"),
};

function requireText(failures, source, needle, label) {
  if (!source.includes(needle)) failures.push(`missing ${label}: ${needle}`);
}

function check(s) {
  const failures = [];
  requireText(failures, s.migration, "business_patch_event_ticket_tiers(", "canonical ticket command");
  requireText(failures, s.migration, "'{business_draft}'", "draft ticket JSON owner");
  requireText(failures, s.migration, "'tickets',v_tiers", "draft ticket leaf");
  requireText(failures, s.migration, "INSERT INTO public.ticket_types", "live ticket owner");
  requireText(failures, s.migration, "p_expected_client_revision", "draft revision guard");
  requireText(failures, s.migration, "sold_ticket_mutation_blocked", "sold-tier protection");
  requireText(failures, s.migration, "password_hash=v_password_hash", "password preservation");
  requireText(failures, s.migration, "biz_role_rank('event_manager')", "tier role floor");
  requireText(failures, s.migration, "biz_role_rank('finance_manager')", "pricing role floor");
  requireText(failures, s.migration, "p_patch?'pass_tax'", "sparse key-presence semantics");
  requireText(failures, s.migration, "pricing_switches_locked", "pricing sale lock");
  requireText(failures, s.domain, "tier_id:", "lifecycle-neutral tier id");
  requireText(failures, s.domain, "ari_execute_ticket_pricing_operation", "receipt-backed Ari command call");
  requireText(failures, s.domain, "set_brand_pricing_defaults", "brand-default tool");
  requireText(failures, s.helper, "requireActiveTaxRegistration", "tax fail-closed probe");
  requireText(failures, s.confirm, "operationId: pending.id", "immutable pending operation context");
  requireText(failures, s.auth, "rawExecutor(args, client, userId, context)", "context forwarding through auth wrapper");
  requireText(failures, s.draftService, 'rpc("business_update_event_draft"', "#1972 atomic draft owner retained");
  requireText(failures, s.publishedEditor, "patchPublishedEventAtomically", "#1972 atomic published owner retained");
  requireText(failures, s.migration, "agent_operation_receipt_begin", "#1972 receipt begin reuse");
  requireText(failures, s.migration, "agent_operation_receipt_complete", "#1972 receipt completion reuse");
  requireText(failures, s.pricingService, 'rpc("business_patch_pricing_switches"', "sparse event pricing service");
  requireText(failures, s.pricingService, 'rpc("business_patch_brand_pricing_defaults"', "sparse brand pricing service");

  const ticketWriter = s.domain.slice(s.domain.indexOf("const upsertTicketTier"), s.domain.indexOf("const setPricingSwitches"));
  if (/\.from\(["']ticket_types["']\)\s*\.(?:insert|update)/s.test(ticketWriter)) {
    failures.push("Ari tier executor regained a direct ticket_types writer");
  }
  for (const [label, source] of Object.entries({ domain: s.domain, helper: s.helper, migration: s.migration })) {
    if (/['"]USD['"]/i.test(source)) failures.push(`${label} manufactures USD`);
  }
  if (s.migration.includes("CREATE TABLE IF NOT EXISTS public.agent_operation_receipts")) {
    failures.push("#1974 duplicated #1972 receipt table ownership");
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const mutations = [
    { ...sources, migration: sources.migration.replaceAll("'{business_draft}'", "'{removed}'") },
    { ...sources, migration: sources.migration.replaceAll("p_patch?'pass_tax'", "p_patch_removed") },
    { ...sources, domain: sources.domain.replaceAll("ari_execute_ticket_pricing_operation", "removed_ticket_command") },
    { ...sources, confirm: sources.confirm.replaceAll("operationId: pending.id", "operationId: removed") },
    { ...sources, publishedEditor: sources.publishedEditor.replaceAll("patchPublishedEventAtomically", "removedTicketOwner") },
    { ...sources, draftService: sources.draftService.replaceAll('rpc("business_update_event_draft"', 'rpc("removed")') },
    { ...sources, migration: sources.migration.replace("-- Issue #1974", "SELECT 'USD';\n-- Issue #1974") },
  ];
  if (mutations.some((mutation) => check(mutation).length === 0)) {
    console.error("issue-1974 self-test FAIL: a material revert escaped");
    process.exit(1);
  }
  console.log(`issue-1974 self-test PASS (${mutations.length} hostile mutations)`);
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-1974 FAIL:\n" + failures.map((failure) => `  - ${failure}`).join("\n"));
  process.exit(1);
}
console.log("issue-1974 PASS: canonical ticket/pricing owners and no-secret/no-USD seams intact");
