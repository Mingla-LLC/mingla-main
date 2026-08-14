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
  migration: read("supabase/migrations/20270406001974_issue_1974_ari_ticket_pricing.sql"),
  ticketService: read("mingla-business/src/services/eventTicketTiersService.ts"),
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
  requireText(failures, s.domain, "business_patch_event_ticket_tiers", "Ari canonical command call");
  requireText(failures, s.domain, "set_brand_pricing_defaults", "brand-default tool");
  requireText(failures, s.helper, "requireActiveTaxRegistration", "tax fail-closed probe");
  requireText(failures, s.confirm, "operationId: pending.id", "immutable pending operation context");
  requireText(failures, s.auth, "rawExecutor(args, client, userId, executionContext)", "context forwarding through auth wrapper");
  requireText(failures, s.ticketService, 'rpc("business_patch_event_ticket_tiers"', "shared Business ticket command");
  requireText(failures, s.draftService, "persistEventTicketTiers({", "draft Business composition");
  requireText(failures, s.draftService, "setEventPricingSwitches(draft.id, pricingPatch)", "draft sparse pricing composition");
  requireText(failures, s.draftService, "delete updatePayload.pass_tax", "generic autosave pricing exclusion");
  requireText(failures, s.publishedEditor, "persistEventTicketTiers({", "published Business persistence");
  requireText(failures, s.pricingService, 'rpc("business_patch_pricing_switches"', "sparse event pricing service");
  requireText(failures, s.pricingService, 'rpc("business_patch_brand_pricing_defaults"', "sparse brand pricing service");

  const ticketWriter = s.domain.slice(s.domain.indexOf("const upsertTicketTier"), s.domain.indexOf("const setPricingSwitches"));
  if (/\.from\(["']ticket_types["']\)\s*\.(?:insert|update)/s.test(ticketWriter)) {
    failures.push("Ari tier executor regained a direct ticket_types writer");
  }
  for (const [label, source] of Object.entries({ domain: s.domain, helper: s.helper, migration: s.migration, ticketService: s.ticketService })) {
    if (/['"]USD['"]/i.test(source)) failures.push(`${label} manufactures USD`);
  }
  if (s.migration.includes("agent_operation_receipts") && !s.migration.includes("does NOT define agent_operation_receipts")) {
    failures.push("#1974 duplicated #1972 receipt ownership");
  }
  if (s.ticketService.includes("password:") || s.ticketService.includes("password_hash")) {
    failures.push("Business canonical ticket service carries password material");
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const mutations = [
    { ...sources, migration: sources.migration.replace("'{business_draft}'", "'{removed}'") },
    { ...sources, migration: sources.migration.replace("p_patch?'pass_tax'", "p_patch_removed") },
    { ...sources, domain: sources.domain.replace("business_patch_event_ticket_tiers", "removed_ticket_command") },
    { ...sources, confirm: sources.confirm.replace("operationId: pending.id", "operationId: removed") },
    { ...sources, ticketService: sources.ticketService.replace('rpc("business_patch_event_ticket_tiers"', 'rpc("removed"') },
    { ...sources, publishedEditor: sources.publishedEditor.replace("persistEventTicketTiers({", "removedTicketSave({") },
    { ...sources, draftService: sources.draftService.replace("setEventPricingSwitches(draft.id, pricingPatch)", "removedPricingOwner()") },
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
