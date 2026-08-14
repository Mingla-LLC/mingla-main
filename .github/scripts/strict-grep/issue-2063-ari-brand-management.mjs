#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = Object.freeze({
  migration: "supabase/migrations/20270404002063_issue_2063_ari_brand_management.sql",
  tools: "supabase/functions/_shared/agentTools.ts",
  auth: "supabase/functions/_shared/agentToolAuthorization.ts",
  prompt: "supabase/functions/_shared/agentSystemPrompt.ts",
  card: "mingla-business/src/components/ari/ToolProposalCard.tsx",
  ledger: "docs/contracts/ari-capability-ledger.json",
  test: "supabase/functions/_shared/__tests__/issue_2063_ari_brand_management.test.ts",
  pgTest: "supabase/migrations/__tests__/issue_2063_ari_brand_management.pg17.test.sql",
  businessTest: "mingla-business/src/components/ari/__tests__/issue_2063_brand_confirmation_recovery.test.ts",
});

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function requireText(failures, source, needle, label) {
  if (!source.includes(needle)) failures.push(label);
}

function audit(overrides = {}) {
  const failures = [];
  const migration = overrides.migration ?? read(PATHS.migration);
  const tools = overrides.tools ?? read(PATHS.tools);
  const auth = overrides.auth ?? read(PATHS.auth);
  const prompt = overrides.prompt ?? read(PATHS.prompt);
  const card = overrides.card ?? read(PATHS.card);
  const ledger = overrides.ledger ?? JSON.parse(read(PATHS.ledger));
  const currencyStateStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1384_brand_currency_state",
  );
  const currencyStateEnd = migration.indexOf(
    "-- First-brand selection is domain truth",
    currencyStateStart,
  );
  const currencyState = currencyStateStart >= 0 && currencyStateEnd > currencyStateStart
    ? migration.slice(currencyStateStart, currencyStateEnd)
    : "";

  if (!fs.existsSync(path.join(ROOT, PATHS.test))) failures.push("missing Deno regression");
  if (!fs.existsSync(path.join(ROOT, PATHS.pgTest))) failures.push("missing PG17 regression");
  if (!fs.existsSync(path.join(ROOT, PATHS.businessTest))) failures.push("missing Business parity regression");

  requireText(failures, migration, "public.agent_operation_receipt_begin(", "missing receipt begin");
  requireText(failures, migration, "public.agent_operation_receipt_complete(", "missing receipt complete");
  requireText(failures, migration, "CREATE OR REPLACE FUNCTION public.ari_execute_brand_operation", "missing atomic brand wrapper");
  requireText(failures, migration, "PERFORM public.biz_upsert_brand_hours(", "hours bypass canonical RPC");
  requireText(failures, migration, "public.issue_1384_set_provisional_currency(", "currency bypass canonical RPC");
  requireText(failures, migration, "public.issue_1384_resolve_reconciliation(", "reconciliation bypass canonical RPC");
  requireText(failures, currencyState, "CREATE OR REPLACE FUNCTION public.issue_1384_brand_currency_state", "currency readback owner not restated");
  requireText(failures, currencyState, "< public.biz_role_rank('finance_manager'::text)", "currency readback rejects accepted finance role");
  requireText(failures, migration, "issue_2063_guard_brand_soft_delete", "missing shared delete race guard");
  requireText(failures, migration, "d.end_at > statement_timestamp()", "delete guard lost canonical end-time test");
  requireText(failures, migration, "brand_name_confirmation_mismatch", "delete lost server-side typed confirmation");
  requireText(failures, migration, "v_venue_brand_id IS DISTINCT FROM v_brand_id", "hours lost venue-brand binding");
  requireText(failures, migration, "biz_role_rank('finance_manager'::text)", "currency lost finance role floor");
  requireText(failures, migration, "REVOKE ALL ON FUNCTION public.ari_execute_brand_operation", "brand wrapper grants are not fail closed");

  for (const tool of [
    "create_brand",
    "update_brand",
    "delete_brand",
    "manage_brand_hours",
    "manage_brand_discovery_currency",
  ]) {
    requireText(failures, tools, `name: "${tool}"`, `missing tool ${tool}`);
    requireText(failures, prompt, `- ${tool} —`, `prompt missing ${tool}`);
  }
  requireText(failures, tools, "requireAgentOperationId(context)", "write executors do not require operation id");
  requireText(failures, tools, '"ari_execute_brand_operation"', "executors bypass atomic brand wrapper");
  requireText(failures, tools, 'name: "list_brand_audit_log"', "missing audit read tool");
  requireText(failures, tools, '.from("audit_log")', "audit tool bypasses canonical audit table");
  requireText(failures, tools, '"list_brand_audit_log"', "audit read is not registered");
  requireText(failures, prompt, "- list_brand_audit_log —", "prompt missing audit read");

  for (const declaration of [
    'create_brand: role("business_user", "none")',
    'list_brands: role("business_user", "none")',
    'update_brand: role("brand_admin", "brand")',
    'delete_brand: role("deed_owner", "brand")',
    'manage_brand_hours: role("brand_admin", "brand")',
    'list_brand_audit_log: role("brand_admin", "brand")',
    'manage_brand_discovery_currency: role("finance_manager", "brand")',
  ]) requireText(failures, auth, declaration, `authorization drift: ${declaration}`);

  requireText(failures, card, "confirm_phrase: typedName.trim()", "typed brand name not sent to executor");

  const expectedMappings = new Map([
    ["ari.brand.create", "create_brand"],
    ["ari.brand.list", "list_brands"],
    ["ari.brand.update", "update_brand"],
    ["ari.brand.delete", "delete_brand"],
    ["ari.brand.hours", "manage_brand_hours"],
    ["ari.brand.audit_log", "list_brand_audit_log"],
    ["ari.brand.discovery_currency", "manage_brand_discovery_currency"],
  ]);
  for (const [id, tool] of expectedMappings) {
    const row = ledger.capabilities.find((candidate) => candidate.id === id);
    if (!row) failures.push(`ledger missing ${id}`);
    else {
      if (row.ari_tool !== tool) failures.push(`${id} tool mapping drift`);
      if (row.status !== "registered_unverified") failures.push(`${id} overclaims ${row.status}`);
      if (!row.owning_issues?.includes(2063)) failures.push(`${id} missing issue 2063 owner`);
    }
  }
  return failures;
}

function expectMutation(name, key, needle, expected) {
  const overrides = {};
  overrides[key] = read(PATHS[key]).replace(needle, "");
  const failures = audit(overrides);
  if (!failures.some((failure) => failure.includes(expected))) {
    throw new Error(`${name}: hostile mutation survived: ${failures.join("; ")}`);
  }
}

if (process.argv.includes("--self-test")) {
  expectMutation("receipt begin", "migration", "public.agent_operation_receipt_begin(", "receipt begin");
  expectMutation("hours owner", "migration", "PERFORM public.biz_upsert_brand_hours(", "hours bypass");
  expectMutation("currency role", "migration", "< public.biz_role_rank('finance_manager'::text)", "currency readback rejects");
  expectMutation("tenant bind", "migration", "v_venue_brand_id IS DISTINCT FROM v_brand_id", "venue-brand binding");
  expectMutation("operation id", "tools", "requireAgentOperationId(context)", "operation id");
  expectMutation("server confirmation", "migration", "brand_name_confirmation_mismatch", "typed confirmation");
  expectMutation("UI confirmation", "card", "confirm_phrase: typedName.trim()", "typed brand name");
  console.log("[issue-2063-ari-brand-management] self-test PASS (7 hostile reversions)");
} else {
  const failures = audit();
  if (failures.length) {
    for (const failure of failures) console.error(`[issue-2063-ari-brand-management] FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("[issue-2063-ari-brand-management] PASS");
}
