#!/usr/bin/env node
// #2013 append-only Class A contract. --self-test proves a functional owner-filter revert fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const NAMES = [
  "list_brands", "list_events", "quote_stay", "get_payout_status", "get_partner_status",
  "get_tax_status", "get_brand_analytics", "list_brand_audit_log", "list_guest_roster", "get_operator_snapshot",
];
const SITE_READ_NAMES = [
  "get_brand_site", "list_site_pages", "get_site_page", "validate_site_draft",
  "get_site_operation_status", "list_site_versions",
];
// [#2438 SC-13] The two reviewed Phase 3B lifecycles. This guard tracks whichever
// one the registry declares instead of pinning shadow, so the SC-21 cutover does
// not red it; a third value is still rejected.
const PHASE3B_LIFECYCLES = ["shadow-active", "batched-historical"];
const writerTestPath = "supabase/functions/_shared/__tests__/issue_2013_ari_tenant_writer_registry.tester_adversarial.test.ts";
// [#2438 SC-12/SC-21] Two distinct identities, deliberately not conflated.
//
// SUITE_ORIGIN_IDENTITY is the registry's immutable `origin` for this suite — the
// historical filename the wave migrated FROM. It survives SC-21 unchanged because
// the registry keeps origin provenance for a deleted wrapper; it is a stored
// value this guard compares against, never a file it reads. The self-test asserts
// it is absent from the read sources.
//
// CI_BATCH_PROVIDER is the terminal enforcement identity — what actually runs this
// guard now that the wrapper is deleted. SC-12's repoint is from a filename that
// no longer resolves to this semantic provider identity.
const SUITE_ORIGIN_IDENTITY = ".github/workflows/issue-2013-ari-tenant-containment.yml";
const CI_BATCH_PROVIDER = "ci-batch:issue-2013-ari-tenant-containment";

export function twoAccountPublicRlsProof(ownerId, memberRows, publicBrands) {
  const memberIds = new Set(memberRows.filter((m) => m.user_id === ownerId && m.removed_at === null).map((m) => m.brand_id));
  return publicBrands.filter((b) => b.deleted_at === null && (b.account_id === ownerId || memberIds.has(b.id))).map((b) => b.id);
}

export function check(sources) {
  const failures = [];
  const { helper, chat, confirm, tools, domain, sites, prompt, hook, screen, list, publicMigration, scopeMigration, scopeTest, migrationWorkflow, writerTest, ciManifest } = sources;
  for (const token of [
    '.eq("account_id", userId)', '.eq("user_id", userId)', '.not("accepted_at", "is", null)', '.is("removed_at", null)',
    '.is("brand.deleted_at", null)', 'role: "owner"', 'effective_rank: 60',
  ]) if (!helper.includes(token)) failures.push(`tenant authority missing ${token}`);

  const registered = NAMES.filter((name) => helper.includes(`"${name}"`));
  if (registered.length !== NAMES.length) failures.push("nine-read registry is incomplete");
  for (const name of NAMES) {
    const owner = name === "list_brands" || name === "list_events" || name === "list_brand_audit_log" ? tools : domain;
    const at = owner.indexOf(`"${name}"`);
    const window = owner.slice(at, at + (name === "get_operator_snapshot" ? 2600 : 1500));
    if (at < 0 || !/(resolveAccessibleAgentBrands|assertAgentReadBrand|assertAgentReadEvent)/.test(window)) {
      failures.push(`${name} lacks the shared tenant authority`);
    }
  }
  const registeredSiteReads = SITE_READ_NAMES.filter((name) => helper.includes(`"${name}"`));
  if (registeredSiteReads.length !== SITE_READ_NAMES.length) failures.push("six-read Sites registry is incomplete");
  for (const name of SITE_READ_NAMES) {
    const at = sites.indexOf(`"${name}"`);
    const nextTool = sites.indexOf("\nconst ", at + 1);
    const window = sites.slice(at, nextTool < 0 ? sites.length : nextTool);
    if (at < 0 || !window.includes("assertAgentReadBrand(client, userId, args.brand_id)")) {
      failures.push(`${name} lacks the shared tenant authority`);
    }
  }
  for (const token of [
    '"BRAND_CONTEXT_REQUIRED"', '"CONVERSATION_BRAND_MISMATCH"',
    '"LEGACY_CONVERSATION_UNSCOPED"', '"BRAND_ACCESS_DENIED"',
    '.select("id, summary, brand_id")', 'brand_id: body.brand_id ?? null',
  ]) if (!chat.includes(token)) failures.push(`conversation lifecycle missing ${token}`);
  if (!/\.select\(\s*"role, content, tool_calls, tool_results, prompt_version, created_at",?\s*\)/.test(chat)) {
    failures.push('persisted-context provenance boundary missing .select("role, content, tool_calls, tool_results, prompt_version, created_at")');
  }
  for (const token of ['trustedHistoryPromptVersion = "tenant-v1"', "m.prompt_version !== trustedHistoryPromptVersion", "prompt_version: TENANT_CONTEXT_VERSION"]) {
    if (!chat.includes(token)) failures.push(`persisted-context provenance boundary missing ${token}`);
  }
  const confirmationWrites = confirm.split("prompt_version: TENANT_CONTEXT_VERSION").length - 1;
  if (!confirm.includes('import { TENANT_CONTEXT_VERSION }') || confirmationWrites !== 5 || confirm.includes("PROMPT_VERSION")) {
    failures.push(`confirmation provenance registry incomplete: expected 5 tenant-v1 attestations/writes, found ${confirmationWrites}`);
  }
  // [#2438 SC-13] The old three-point count was taken against the historical YAML
  // wrapper that SC-21 deletes; a guard that hard-requires the file the cutover
  // removes cannot authorise that cutover. The identical three-point push / PR /
  // command provenance is re-derived below from the typed registry, which
  // survives the deletion and additionally pins the origin identity.
  //
  // #2438 shadow adds a second, typed provider without retiring the live one.
  // This guard-path edit is also #2013's exact same-SHA wake route (16/16 paths).
  let shadowSuite;
  try { shadowSuite = JSON.parse(ciManifest).suites.find((suite) => suite.id === "issue-2013-ari-tenant-containment"); } catch {}
  if (!shadowSuite || shadowSuite.migrationWave !== "phase3b-postgres-wave"
      || !PHASE3B_LIFECYCLES.includes(shadowSuite.lifecycle)
      || shadowSuite.origin !== SUITE_ORIGIN_IDENTITY
      || `ci-batch:${shadowSuite.id}` !== CI_BATCH_PROVIDER
      || shadowSuite.triggerContract?.push?.paths?.filter((item) => item === writerTestPath).length !== 1
      || shadowSuite.triggerContract?.pullRequest?.paths?.filter((item) => item === writerTestPath).length !== 1
      || !shadowSuite.steps?.[0]?.run?.includes(writerTestPath)) {
    failures.push("#2438 typed shadow provider lost writer tester push/PR/command provenance");
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
  // [TEST-MOD-APPROVED #1985] The existing cooldown pin now also requires the
  // active-conversation hydration gate; this is additive and keeps all three
  // #2013 disabling terms exact.
  for (const token of ["rateLimitUntil", "cooldown_until", "retry_after_seconds", "disabled={chat.isSending || brands.isLoading || rateLimited || !conversationSelectionReady}"]) {
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

// [#2438 SC-13] Every file this guard reads, by key. The historical Phase 3B
// wrapper is deliberately absent from this map; the self-test asserts that.
const SOURCE_FILES = {
  helper: "supabase/functions/_shared/agentTenantScope.ts",
  chat: "supabase/functions/agent-chat/index.ts",
  confirm: "supabase/functions/agent-confirm-action/index.ts",
  tools: "supabase/functions/_shared/agentTools.ts",
  domain: "supabase/functions/_shared/agentDomainTools.ts",
  sites: "supabase/functions/_shared/agentSiteTools.ts",
  prompt: "supabase/functions/_shared/agentSystemPrompt.ts",
  hook: "mingla-business/src/hooks/useAgentChat.ts",
  screen: "mingla-business/src/screens/ari/AriChatScreen.tsx",
  list: "mingla-business/src/hooks/useConversationList.ts",
  publicMigration: "supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql",
  scopeMigration: "supabase/migrations/20270402002013_issue_2013_agent_conversation_brand_immutable.sql",
  scopeTest: "supabase/migrations/__tests__/issue_2013_agent_conversation_brand_immutable.test.sql",
  migrationWorkflow: ".github/workflows/supabase-migrations-and-stripe-deno.yml",
  writerTest: writerTestPath,
  ciManifest: ".github/ci-batch/MANIFEST.json",
};
const sources = Object.fromEntries(Object.entries(SOURCE_FILES).map(([key, file]) => [key, read(file)]));

if (process.argv.includes("--self-test")) {
  const good = check(sources);
  const reverted = check({ ...sources, helper: sources.helper.replace('.eq("account_id", userId)', '.neq("account_id", userId)') });
  const revertDetected = reverted.some((failure) => failure.includes("tenant authority missing"));
  const historyReverted = check({ ...sources, chat: sources.chat.replace("if (m.prompt_version !== trustedHistoryPromptVersion) continue;", "") });
  const historyRevertDetected = historyReverted.some((failure) => failure.includes("persisted-context provenance boundary"));
  const confirmationReverted = check({ ...sources, confirm: sources.confirm.replace("prompt_version: TENANT_CONTEXT_VERSION", "prompt_version: PROMPT_VERSION") });
  const confirmationRevertDetected = confirmationReverted.some((failure) => failure.includes("confirmation provenance registry incomplete"));
  // [#2438 SC-13] The single old-YAML three-point count is replaced by three
  // INDEPENDENT reverts against the typed registry — push trigger, pull_request
  // trigger, and the executed command — each proven RED on its own. That is
  // strictly stronger than the one string-count it replaces, and it survives the
  // SC-21 deletion of the historical wrapper.
  const withRegistry = (mutate) => {
    const document = JSON.parse(sources.ciManifest);
    mutate(document.suites.find((suite) => suite.id === "issue-2013-ari-tenant-containment"));
    return check({ ...sources, ciManifest: JSON.stringify(document) });
  };
  const writerProvenanceReverts = [
    (suite) => { suite.triggerContract.push.paths = suite.triggerContract.push.paths.filter((item) => item !== writerTestPath); },
    (suite) => { suite.triggerContract.pullRequest.paths = suite.triggerContract.pullRequest.paths.filter((item) => item !== writerTestPath); },
    (suite) => { suite.steps[0].run = suite.steps[0].run.replaceAll(writerTestPath, ""); },
    (suite) => { suite.origin = ".github/workflows/forged.yml"; },
  ].map((mutate) => withRegistry(mutate));
  const writerProvenanceRevertDetected = writerProvenanceReverts.every((failures) =>
    failures.some((failure) => failure.includes("typed shadow provider lost writer tester push/PR/command provenance")));
  const shadowManifest = JSON.parse(sources.ciManifest);
  shadowManifest.suites.find((suite) => suite.id === "issue-2013-ari-tenant-containment").migrationWave = "phase3b-forged";
  const shadowReverted = check({ ...sources, ciManifest: JSON.stringify(shadowManifest) });
  const shadowRevertDetected = shadowReverted.some((failure) => failure.includes("typed shadow provider"));
  const scopeReverted = check({ ...sources, scopeMigration: sources.scopeMigration.replace("NEW.brand_id IS DISTINCT FROM OLD.brand_id", "false") });
  const scopeRevertDetected = scopeReverted.some((failure) => failure.includes("database scope immutability"));
  const composerReverted = check({ ...sources, screen: sources.screen.replace("disabled={chat.isSending || brands.isLoading || rateLimited || !conversationSelectionReady}", "disabled={chat.isSending}") });
  const composerRevertDetected = composerReverted.some((failure) => failure.includes("persistent cooldown"));
  const siteRegistryReverted = check({ ...sources, helper: sources.helper.replace('  "get_brand_site",\n', "") });
  const siteRegistryRevertDetected = siteRegistryReverted.some((failure) => failure.includes("six-read Sites registry"));
  const siteExecutorReverted = check({ ...sources, sites: sources.sites.replace("    await assertAgentReadBrand(client, userId, args.brand_id);", "") });
  const siteExecutorRevertDetected = siteExecutorReverted.some((failure) => failure.includes("lacks the shared tenant authority"));

  // [#2438 SC-13/SC-17] Execute the terminal branch instead of merely writing it.
  const withLifecycle = (value) => withRegistry((suite) => { suite.lifecycle = value; });
  const acceptedLifecycles = PHASE3B_LIFECYCLES.map((value) => withLifecycle(value));
  const terminalLifecycleAccepted = acceptedLifecycles.every((failures) => failures.length === 0);
  const forgedLifecycles = ["shadow-inactive", "batched-active", "phase3b-forged", "SHADOW-ACTIVE", "", null].map((value) => withLifecycle(value));
  const forgedLifecycleDetected = forgedLifecycles.every((failures) => failures.some((failure) => failure.includes("typed shadow provider")));
  // The historical wrapper must no longer be a source of this guard at all, or
  // SC-21's deletion reds it again.
  // [#2438 SC-12] The retired origin must never be a source this guard READS.
  // `migrationWorkflow` deliberately stays: it is a live, non-Phase-3B workflow
  // and nothing in SC-21 deletes it, so a blanket "no workflow file" rule here
  // would be false rather than strict.
  const wrapperDecoupled = !Object.values(SOURCE_FILES).includes(SUITE_ORIGIN_IDENTITY)
    && !Object.values(SOURCE_FILES).some((file) => !fs.existsSync(path.join(root, file)))
    && !Object.keys(SOURCE_FILES).includes("workflow");

  if (good.length > 0 || !revertDetected || !historyRevertDetected || !confirmationRevertDetected || !writerProvenanceRevertDetected
      || !shadowRevertDetected || !scopeRevertDetected || !composerRevertDetected
      || !siteRegistryRevertDetected || !siteExecutorRevertDetected
      || !terminalLifecycleAccepted || !forgedLifecycleDetected || !wrapperDecoupled) {
    console.error("issue-2013 self-test FAIL", { good, reverted, historyReverted, confirmationReverted, writerProvenanceReverts, shadowReverted, scopeReverted, composerReverted, siteRegistryReverted, siteExecutorReverted, acceptedLifecycles, forgedLifecycles, wrapperDecoupled });
    process.exit(1);
  }
  console.log(`issue-2013 self-test PASS: clean source passes; owner, history, confirmation-writer, ${writerProvenanceReverts.length} typed writer-provenance, immutable-scope, composer-gate, Sites registry/executor and ${forgedLifecycles.length} forged-lifecycle reverts fail; ${acceptedLifecycles.length} reviewed lifecycles pass and the deletable CI wrapper is decoupled from provider ${CI_BATCH_PROVIDER}.`);
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-2013-ari-tenant-containment FAIL:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("issue-2013-ari-tenant-containment PASS.");
