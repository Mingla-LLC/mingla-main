#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = Object.freeze({
  migration: "supabase/migrations/20270501002063_issue_2063_ari_brand_management.sql",
  tools: "supabase/functions/_shared/agentTools.ts",
  auth: "supabase/functions/_shared/agentToolAuthorization.ts",
  prompt: "supabase/functions/_shared/agentSystemPrompt.ts",
  card: "mingla-business/src/components/ari/ToolProposalCard.tsx",
  edit: "mingla-business/src/components/ari/ToolEditForm.tsx",
  confirmHook: "mingla-business/src/hooks/useConfirmPendingAction.ts",
  chat: "supabase/functions/agent-chat/index.ts",
  confirm: "supabase/functions/agent-confirm-action/index.ts",
  ledger: "docs/contracts/ari-capability-ledger.json",
  test: "supabase/functions/_shared/__tests__/issue_2063_ari_brand_management.test.ts",
  pgTest: "supabase/migrations/__tests__/issue_2063_ari_brand_management.pg17.test.sql",
  businessTest: "mingla-business/src/components/ari/__tests__/issue_2063_brand_confirmation_recovery.test.ts",
  receiptBindingTest: "supabase/functions/_shared/__tests__/issue_2063_ari_brand_receipt_binding.tester-adversarial.test.ts",
  workflow: ".github/workflows/issue-2063-ari-brand-management.yml",
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
  const edit = overrides.edit ?? read(PATHS.edit);
  const confirmHook = overrides.confirmHook ?? read(PATHS.confirmHook);
  const chat = overrides.chat ?? read(PATHS.chat);
  const confirm = overrides.confirm ?? read(PATHS.confirm);
  const ledger = overrides.ledger ?? JSON.parse(read(PATHS.ledger));
  const receiptBindingTest = overrides.receiptBindingTest ?? read(PATHS.receiptBindingTest);
  const workflow = overrides.workflow ?? read(PATHS.workflow);
  const brandExecutorStart = tools.indexOf("async function executeBrandOperation(");
  const brandExecutorEnd = tools.indexOf("// Legacy append-only source-test marker: const createBrand", brandExecutorStart);
  const brandExecutor = brandExecutorStart >= 0 && brandExecutorEnd > brandExecutorStart
    ? tools.slice(brandExecutorStart, brandExecutorEnd)
    : "";
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
  if (!fs.existsSync(path.join(ROOT, PATHS.receiptBindingTest))) failures.push("missing receipt-binding tester regression");

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
  if (migration.includes("(item ->> 'open_time')::time >= (item ->> 'close_time')::time")) {
    failures.push("overnight hours rejected");
  }
  requireText(
    failures,
    migration,
    "RAISE EXCEPTION 'expected_state_version_required'",
    "currency write accepts a missing expected version",
  );
  if (/SELECT COALESCE\([\s\S]*?discovery_currency_state_version[\s\S]*?INTO v_expected_version/.test(migration)) {
    failures.push("currency write falls back to live state");
  }
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
  requireText(
    failures,
    brandExecutor,
    "const operationId = requireAgentOperationId(context);",
    "write executors do not require operation id",
  );
  requireText(failures, tools, '"ari_execute_brand_operation"', "executors bypass atomic brand wrapper");
  requireText(failures, tools, 'name: "list_brand_audit_log"', "missing audit read tool");
  requireText(
    failures,
    receiptBindingTest,
    "normalizing after proposal persistence makes #1972 reject the confirmation",
    "receipt-binding tester regression lost exact-payload assertion",
  );
  requireText(
    failures,
    workflow,
    "issue_2063_ari_brand_receipt_binding.tester-adversarial.test.ts",
    "receipt-binding tester regression is not CI-wired",
  );
  requireText(failures, tools, '.from("audit_log")', "audit tool bypasses canonical audit table");
  requireText(failures, tools, '.order("id", { ascending: false })', "audit order lacks stable id tie-breaker");
  requireText(failures, tools, "created_at.eq", "audit cursor loses tied timestamps");
  requireText(failures, tools, "id.lt", "audit cursor loses tied row ids");
  requireText(failures, tools, 'if (args.action === "get_state") {', "currency state read action missing");
  requireText(failures, tools, '"issue_1384_brand_currency_state"', "currency state read bypasses canonical owner");
  requireText(failures, chat, "isReadOnlyAgentToolCall(tool.name, gemini.toolCall.args)", "currency state read can become a pending mutation");
  requireText(
    failures,
    chat,
    "gemini.toolCall.args = await bindAgentProposalState(",
    "currency state version is not bound into the persisted proposal",
  );
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
  requireText(failures, card, 'toolName === "manage_brand_hours" && Array.isArray(args.hours)', "hours replacement is hidden at confirmation");
  requireText(failures, edit, "const hours = Array.isArray(args.hours)", "hours proposal edit is a dead end");
  requireText(failures, edit, 'toolName === "update_brand"', "brand update proposal edit is a dead end");
  requireText(failures, edit, 'toolName === "manage_brand_discovery_currency"', "currency proposal edit is a dead end");
  for (const factory of [
    "brandKeys",
    "brandHoursKeys",
    "venueAvailabilityKeys",
    "brandDiscoveryCurrencyKeys",
    "creatorAccountKeys",
  ]) requireText(failures, confirmHook, factory, `confirmation cache bypasses ${factory}`);
  for (const invocation of [
    "brandKeys.detail(brandId)",
    "brandHoursKeys.byBrand(brandId)",
    "venueAvailabilityKeys.config(brandId)",
    "brandDiscoveryCurrencyKeys.all",
    "creatorAccountKeys.all",
  ]) requireText(failures, confirmHook, invocation, `confirmation cache missing ${invocation}`);
  for (const literal of [
    '["brandHours", brandId]',
    '["venueAvailabilityConfig", brandId]',
    '["brand-discovery-currency"]',
    '["brands", "detail", brandId]',
  ]) {
    if (confirmHook.includes(literal)) failures.push(`hardcoded confirmation cache key: ${literal}`);
  }

  const expectedMappings = new Map([
    ["ari.brand.create", "create_brand"],
    ["ari.brand.list", "list_brands"],
    ["ari.brand.update", "update_brand"],
    ["ari.brand.delete", "delete_brand"],
    ["ari.brand.hours", "manage_brand_hours"],
    ["ari.brand.audit_log", "list_brand_audit_log"],
    ["ari.brand.discovery_currency", "manage_brand_discovery_currency"],
  ]);
  const receiptSetStart = confirm.indexOf("const RECEIPT_BACKED_EVENT_TOOL_NAMES");
  const receiptSet = confirm.slice(receiptSetStart, confirm.indexOf("]);", receiptSetStart));
  for (const tool of [
    "create_brand",
    "update_brand",
    "delete_brand",
    "manage_brand_hours",
    "manage_brand_discovery_currency",
  ]) {
    requireText(failures, receiptSet, `"${tool}"`, `missing receipt-backed retry: ${tool}`);
  }
  if (receiptSet.includes('"list_brand_audit_log"')) failures.push("read tool gained receipt-backed write recovery");
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

function expectAllMutation(name, key, needle, expected) {
  const overrides = {};
  overrides[key] = read(PATHS[key]).replaceAll(needle, "");
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
  expectMutation(
    "operation id",
    "tools",
    "const operationId = requireAgentOperationId(context);",
    "operation id",
  );
  expectMutation("server confirmation", "migration", "brand_name_confirmation_mismatch", "typed confirmation");
  expectMutation("UI confirmation", "card", "confirm_phrase: typedName.trim()", "typed brand name");
  expectMutation("hours review", "card", 'toolName === "manage_brand_hours" && Array.isArray(args.hours)', "hours replacement");
  expectMutation("hours edit", "edit", "const hours = Array.isArray(args.hours)", "hours proposal edit");
  expectMutation("currency state read", "tools", 'if (args.action === "get_state") {', "currency state read action");
  expectMutation(
    "currency proposal bind",
    "chat",
    "gemini.toolCall.args = await bindAgentProposalState(",
    "not bound into the persisted proposal",
  );
  expectMutation("stable audit order", "tools", '.order("id", { ascending: false })', "stable id tie-breaker");
  expectMutation("currency required version", "migration", "RAISE EXCEPTION 'expected_state_version_required'", "missing expected version");
  expectMutation("factory cache", "confirmHook", "brandHoursKeys.byBrand(brandId)", "missing brandHoursKeys.byBrand");
  expectMutation("brand retry", "confirm", '"create_brand",', "missing receipt-backed retry: create_brand");
  expectAllMutation(
    "receipt-binding CI",
    "workflow",
    "issue_2063_ari_brand_receipt_binding.tester-adversarial.test.ts",
    "not CI-wired",
  );
  console.log("[issue-2063-ari-brand-management] self-test PASS (16 hostile reversions)");
} else {
  const failures = audit();
  if (failures.length) {
    for (const failure of failures) console.error(`[issue-2063-ari-brand-management] FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("[issue-2063-ari-brand-management] PASS");
}
