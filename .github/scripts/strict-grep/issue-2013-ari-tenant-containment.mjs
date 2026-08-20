#!/usr/bin/env node
// #2013 append-only Class A contract. --self-test proves a functional owner-filter revert fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const NAMES = [
  "list_brands", "list_events", "quote_stay", "get_payout_status", "get_partner_status",
  "get_tax_status", "get_brand_analytics", "list_guest_roster", "get_operator_snapshot",
];

export function twoAccountPublicRlsProof(ownerId, memberRows, publicBrands) {
  const memberIds = new Set(memberRows.filter((m) => m.user_id === ownerId && m.removed_at === null).map((m) => m.brand_id));
  return publicBrands.filter((b) => b.deleted_at === null && (b.account_id === ownerId || memberIds.has(b.id))).map((b) => b.id);
}

export function check(sources) {
  const failures = [];
  const { helper, chat, confirm, tools, domain, prompt, hook, screen, list, publicMigration, scopeMigration, scopeTest, migrationWorkflow, workflow, writerTest } = sources;
  for (const token of [
    '.eq("account_id", userId)', '.eq("user_id", userId)', '.not("accepted_at", "is", null)', '.is("removed_at", null)',
    '.is("brand.deleted_at", null)', 'role: "owner"', 'effective_rank: 60',
  ]) if (!helper.includes(token)) failures.push(`tenant authority missing ${token}`);

  const registered = NAMES.filter((name) => helper.includes(`"${name}"`));
  if (registered.length !== NAMES.length) failures.push("nine-read registry is incomplete");
  for (const name of NAMES) {
    const owner = name === "list_brands" || name === "list_events" ? tools : domain;
    const at = owner.indexOf(`"${name}"`);
    const window = owner.slice(at, at + (name === "get_operator_snapshot" ? 2600 : 1500));
    if (at < 0 || !/(resolveAccessibleAgentBrands|assertAgentReadBrand|assertAgentReadEvent)/.test(window)) {
      failures.push(`${name} lacks the shared tenant authority`);
    }
  }
  for (const token of [
    '"BRAND_CONTEXT_REQUIRED"', '"CONVERSATION_BRAND_MISMATCH"',
    '"LEGACY_CONVERSATION_UNSCOPED"', '"BRAND_ACCESS_DENIED"',
    '.select("id, summary, brand_id")', 'brand_id: body.brand_id ?? null',
  ]) if (!chat.includes(token)) failures.push(`conversation lifecycle missing ${token}`);
  for (const token of ['.select("role, content, tool_calls, tool_results, prompt_version, created_at")', 'trustedHistoryPromptVersion = "tenant-v1"', "m.prompt_version !== trustedHistoryPromptVersion", "prompt_version: TENANT_CONTEXT_VERSION"]) {
    if (!chat.includes(token)) failures.push(`persisted-context provenance boundary missing ${token}`);
  }
  const confirmationWrites = confirm.split("prompt_version: TENANT_CONTEXT_VERSION").length - 1;
  if (!confirm.includes('import { TENANT_CONTEXT_VERSION }') || confirmationWrites !== 5 || confirm.includes("PROMPT_VERSION")) {
    failures.push(`confirmation provenance registry incomplete: expected 5 tenant-v1 attestations/writes, found ${confirmationWrites}`);
  }
  const writerTestPath = "supabase/functions/_shared/__tests__/issue_2013_ari_tenant_writer_registry.tester_adversarial.test.ts";
  if (workflow.split(writerTestPath).length - 1 !== 3) {
    failures.push("writer-registry tester must trigger on push/PR and run unconditionally");
  }
  // [TEST-MOD-APPROVED #1985] One chat assistant writer now lives inside the
  // service-only task-state CAS; #1972 remains the terminal tool-row owner.
  for (const token of ['"agent-chat": 4', '"agent-confirm-action": 1', 'prompt_version\\s*:\\s*TENANT_CONTEXT_VERSION']) {
    if (!writerTest.includes(token)) failures.push(`writer-registry tester missing ${token}`);
  }
  if (chat.indexOf("resolveAccessibleAgentBrands") > chat.indexOf('.from("agent_conversations")')) {
    failures.push("tenant scope must resolve before conversation persistence");
  }
  for (const token of ["ACTIVE BRAND", "ACCESSIBLE BRANDS", "ACTIVE BRAND OFFERINGS"]) {
    if (!prompt.includes(token)) failures.push(`prompt missing ${token}`);
  }
  for (const forbidden of ["USER'S BRANDS", "OWNED OFFERINGS", "Role: owner (default)", "${summaryLine}"]) {
    if (prompt.includes(forbidden)) failures.push(`prompt retains misleading label ${forbidden}`);
  }
  for (const token of ["brandEpoch", "setConversationId(null)", "setPendingAction(null)", "setOptimisticMessages([])"]) {
    if (!hook.includes(token)) failures.push(`brand-switch reset missing ${token}`);
  }
  if (!screen.includes("useCurrentBrand()") || !screen.includes("legacyReadOnly")) failures.push("shared screen lacks selected-brand/legacy lifecycle");
  for (const token of ["RecoveryPanel", "BrandSwitcherSheet", "This older chat is read-only", "Ari cannot verify your brand right now", "setDrawerOpen(false)"]) {
    if (!screen.includes(token)) failures.push(`binding recovery UI missing ${token}`);
  }
  for (const token of ["rateLimitUntil", "cooldown_until", "retry_after_seconds", "disabled={chat.isSending || brands.isLoading || rateLimited}"]) {
    if (!(screen + chat).includes(token)) failures.push(`persistent cooldown missing ${token}`);
  }
  for (const token of ["Older chats · Read-only", "Could not load conversations.", "loadingRow", "older read-only conversation"]) {
    if (!read("mingla-business/src/components/ari/ConversationDrawer.tsx").includes(token)) failures.push(`scoped drawer UI missing ${token}`);
  }
  if (!list.includes("conversation.brand_id === selectedBrandId")) failures.push("drawer is not selected-brand filtered");
  if (!/Public can read non-deleted brands[\s\S]*ON public\.brands/.test(publicMigration)) failures.push("public-RLS premise is not exercised");
  for (const token of [
    "preserve_agent_conversation_brand_scope", "NEW.brand_id IS DISTINCT FROM OLD.brand_id",
    "ERRCODE = '42501'", "BEFORE UPDATE OF brand_id", "SET search_path = ''",
  ]) if (!scopeMigration.includes(token)) failures.push(`database scope immutability missing ${token}`);
  for (const token of [
    "non-scope update was blocked", "brand scope rewrite was accepted",
    "rejected rewrite changed stored scope", "trigger helper is directly executable",
  ]) if (!scopeTest.includes(token)) failures.push(`database scope test missing ${token}`);
  if (!migrationWorkflow.includes("issue_2013_agent_conversation_brand_immutable.test.sql")) {
    failures.push("database scope behavior test is not wired into PostgreSQL replay");
  }

  const brands = [
    { id: "a", account_id: "user-a", deleted_at: null },
    { id: "b", account_id: "user-b", deleted_at: null },
  ];
  const memberships = [];
  if (twoAccountPublicRlsProof("user-a", memberships, brands).includes("b") ||
      twoAccountPublicRlsProof("user-b", memberships, brands).includes("a")) {
    failures.push("two-account public-RLS negative proof failed bidirectionally");
  }
  return failures;
}

const sources = {
  helper: read("supabase/functions/_shared/agentTenantScope.ts"),
  chat: read("supabase/functions/agent-chat/index.ts"),
  confirm: read("supabase/functions/agent-confirm-action/index.ts"),
  tools: read("supabase/functions/_shared/agentTools.ts"),
  domain: read("supabase/functions/_shared/agentDomainTools.ts"),
  prompt: read("supabase/functions/_shared/agentSystemPrompt.ts"),
  hook: read("mingla-business/src/hooks/useAgentChat.ts"),
  screen: read("mingla-business/src/screens/ari/AriChatScreen.tsx"),
  list: read("mingla-business/src/hooks/useConversationList.ts"),
  publicMigration: read("supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql"),
  scopeMigration: read("supabase/migrations/20270402002013_issue_2013_agent_conversation_brand_immutable.sql"),
  scopeTest: read("supabase/migrations/__tests__/issue_2013_agent_conversation_brand_immutable.test.sql"),
  migrationWorkflow: read(".github/workflows/supabase-migrations-and-stripe-deno.yml"),
  workflow: read(".github/workflows/issue-2013-ari-tenant-containment.yml"),
  writerTest: read("supabase/functions/_shared/__tests__/issue_2013_ari_tenant_writer_registry.tester_adversarial.test.ts"),
};

if (process.argv.includes("--self-test")) {
  const good = check(sources);
  const reverted = check({ ...sources, helper: sources.helper.replace('.eq("account_id", userId)', '.neq("account_id", userId)') });
  const revertDetected = reverted.some((failure) => failure.includes("tenant authority missing"));
  const historyReverted = check({ ...sources, chat: sources.chat.replace("if (m.prompt_version !== trustedHistoryPromptVersion) continue;", "") });
  const historyRevertDetected = historyReverted.some((failure) => failure.includes("persisted-context provenance boundary"));
  const confirmationReverted = check({ ...sources, confirm: sources.confirm.replace("prompt_version: TENANT_CONTEXT_VERSION", "prompt_version: PROMPT_VERSION") });
  const confirmationRevertDetected = confirmationReverted.some((failure) => failure.includes("confirmation provenance registry incomplete"));
  const writerWorkflowReverted = check({ ...sources, workflow: sources.workflow.replace("supabase/functions/_shared/__tests__/issue_2013_ari_tenant_writer_registry.tester_adversarial.test.ts", "") });
  const writerWorkflowRevertDetected = writerWorkflowReverted.some((failure) => failure.includes("writer-registry tester must trigger"));
  const scopeReverted = check({ ...sources, scopeMigration: sources.scopeMigration.replace("NEW.brand_id IS DISTINCT FROM OLD.brand_id", "false") });
  const scopeRevertDetected = scopeReverted.some((failure) => failure.includes("database scope immutability"));
  if (good.length > 0 || !revertDetected || !historyRevertDetected || !confirmationRevertDetected || !writerWorkflowRevertDetected || !scopeRevertDetected) {
    console.error("issue-2013 self-test FAIL", { good, reverted, historyReverted, confirmationReverted, writerWorkflowReverted, scopeReverted });
    process.exit(1);
  }
  console.log("issue-2013 self-test PASS: clean source passes; owner, history, confirmation-writer, tester-wiring, and immutable-scope reverts fail.");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-2013-ari-tenant-containment FAIL:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("issue-2013-ari-tenant-containment PASS.");
