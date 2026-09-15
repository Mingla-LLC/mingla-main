#!/usr/bin/env node
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const files = {
  migration:
    "supabase/migrations/20270506001985_issue_1985_ari_conversation_task_state.sql",
  turnMigration:
    "supabase/migrations/20270708003429_issue_3429_ari_chat_context.sql",
  implementorPg:
    "supabase/migrations/__tests__/issue_1985_task_state_authority.implementor.pg17.test.sql",
  turnAuthorityPg:
    "supabase/migrations/__tests__/issue_3429_ari_turn_authority.tester_adversarial.pg17.test.sql",
  messageRolePg:
    "supabase/migrations/__tests__/issue_1985_message_role_authority.implementor.pg17.test.sql",
  testerChoicePg:
    "supabase/migrations/__tests__/issue_1985_choice_payload_authority.tester_round3.pg17.test.sql",
  state: "supabase/functions/_shared/agentConversationState.ts",
  time: "supabase/functions/_shared/agentRelativeTime.ts",
  planner: "supabase/functions/_shared/agentConversationPlanner.ts",
  choices: "supabase/functions/_shared/agentChoices.ts",
  serviceClient: "supabase/functions/_shared/agentRateLimit.ts",
  chat: "supabase/functions/agent-chat/index.ts",
  confirm: "supabase/functions/agent-confirm-action/index.ts",
  service: "mingla-business/src/services/agentChatService.ts",
  hook: "mingla-business/src/hooks/useAgentChat.ts",
  screen: "mingla-business/src/screens/ari/AriChatScreen.tsx",
  input: "mingla-business/src/components/ari/InputBar.tsx",
  list: "mingla-business/src/components/ari/MessageList.tsx",
  clientChoices: "mingla-business/src/components/ari/agentChoices.ts",
  choiceTest:
    "mingla-business/src/components/ari/__tests__/issue_1985_choice_payloads.test.tsx",
  deliveryTest:
    "mingla-business/src/hooks/__tests__/issue_1985_message_delivery_identity.test.ts",
  activeSelectionStore:
    "mingla-business/src/store/ariConversationSelectionStore.ts",
  activeSelectionTest:
    "mingla-business/src/store/__tests__/issue_1985_active_conversation_persistence.test.ts",
  storageReaper: "mingla-business/src/utils/reapOrphanStorageKeys.ts",
  clearStores: "mingla-business/src/utils/clearAllStores.ts",
  typecheck: "mingla-business/tsconfig.issue-1985.json",
  typecheckRunner:
    ".github/scripts/strict-grep/issue-1985-business-typecheck.mjs",
  workflow: ".github/workflows/issue-1985-ari-task-state.yml",
};
const sources = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)]),
);

export function check(s) {
  const failures = [];
  for (
    const token of [
      "task_state jsonb",
      "task_state_revision bigint",
      "client_turn_id uuid",
      "idx_agent_messages_user_client_turn",
      "WHERE client_turn_id IS NOT NULL",
      "WHERE role = 'user' AND client_turn_id IS NOT NULL",
    ]
  ) {
    if (!s.migration.includes(token)) {
      failures.push(`migration contract missing ${token}`);
    }
  }
  for (
    const token of [
      "reconcileAgentDeliveryMessages([], [], [failed], true)",
      "reconcileAgentDeliveryMessages([server], [optimistic], [failed], true)",
      "reconcileAgentDeliveryMessages([server], [optimistic], [], true)",
    ]
  ) {
    if (!s.deliveryTest.includes(token)) {
      failures.push(`Business delivery identity proof missing ${token}`);
    }
  }
  if (
    s.chat.includes("client: userClient") ||
    !s.chat.includes("client: serviceClient") ||
    s.confirm.includes("client: userClient") ||
    !s.confirm.includes("client: pendingStateClient")
  ) {
    failures.push(
      "task-state CAS callers are not wired exclusively through the service-owned client",
    );
  }
  for (
    const token of [
      "explicitly user-scoped task-state CAS RPCs",
      "tool executors continue to use the caller's JWT",
      "executors NEVER receive",
    ]
  ) {
    if (!s.serviceClient.includes(token)) {
      failures.push(`service-client dependency contract missing ${token}`);
    }
  }
  const metadataGrant = s.migration.match(
    /GRANT UPDATE \(([\s\S]*?)\) ON TABLE public\.agent_conversations TO authenticated;/,
  );
  if (
    !s.migration.includes(
      "REVOKE UPDATE ON TABLE public.agent_conversations FROM authenticated;",
    ) ||
    !metadataGrant ||
    !metadataGrant[1].includes("title") ||
    !metadataGrant[1].includes("summary") ||
    metadataGrant[1].includes("task_state")
  ) {
    failures.push(
      "authenticated conversation UPDATE is not narrowed to owner metadata",
    );
  }
  for (
    const token of [
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_messages FROM authenticated;",
      'CREATE POLICY "Owner can insert own user agent messages"',
      "WITH CHECK (user_id = auth.uid() AND role = 'user');",
    ]
  ) {
    if (!s.migration.includes(token)) {
      failures.push(`message role authority missing ${token}`);
    }
  }
  if (
    s.migration.includes('CREATE POLICY "Owner can update own agent messages"') ||
    s.migration.includes('CREATE POLICY "Owner can delete own agent messages"')
  ) {
    failures.push("authenticated assistant/tool message mutation policy returned");
  }
  for (
    const token of [
      "p_user_id uuid",
      "AND user_id = p_user_id",
      "CREATE OR REPLACE FUNCTION public.commit_agent_task_outcome",
      "CREATE OR REPLACE FUNCTION public.get_agent_pending_terminal_message_id",
    ]
  ) {
    if (!s.migration.includes(token)) {
      failures.push(`service-owned task-state authority missing ${token}`);
    }
  }
  const authenticatedRevocations = s.migration.split(
    ") FROM PUBLIC, anon, authenticated;",
  ).length - 1;
  const serviceRoleGrants = s.migration.split(") TO service_role;").length - 1;
  if (authenticatedRevocations !== 3 || serviceRoleGrants !== 3) {
    failures.push(
      `service-owned task RPC grants incomplete: ${authenticatedRevocations} authenticated revocations, ${serviceRoleGrants} service grants`,
    );
  }
  const userScopeFilters = s.migration.split("AND user_id = p_user_id").length - 1;
  const revisionCasFilters = s.migration.split(
    "AND task_state_revision = p_expected_revision",
  ).length - 1;
  if (userScopeFilters !== 2 || revisionCasFilters !== 2) {
    failures.push(
      `task RPC CAS filters incomplete: ${userScopeFilters} user scopes, ${revisionCasFilters} revision scopes`,
    );
  }
  for (
    const token of [
      "uq_agent_messages_user_client_turn",
      "(user_id, client_turn_id)",
      "CREATE OR REPLACE FUNCTION public.claim_agent_first_turn",
      "EXCEPTION WHEN unique_violation",
      "CREATE OR REPLACE FUNCTION public.commit_agent_task_assistant_turn",
      "AND task_state_revision = p_expected_revision",
    ]
  ) {
    if (!s.migration.includes(token)) {
      failures.push(`serialized-turn contract missing ${token}`);
    }
  }
  for (
    const token of [
      "TASK_STATE_SCHEMA_VERSION = 1",
      "MAX_TASK_STATE_BYTES",
      "parseTaskState",
      "applySlotUpdates",
      "beginInterruption",
      "resumeInterruption",
      "export function reconcilePendingAction",
      "assertCreateEventProposal",
      "replaceCreateEventProposalArgs",
      "assertEditedCreateEventProposal",
    ]
  ) {
    if (!s.state.includes(token)) {
      failures.push(`reducer contract missing ${token}`);
    }
  }
  for (
    const token of [
      "chooseEffectiveTimezone",
      "localDateTimeToInstants",
      "function endOfMonthChoices(",
      'invalidReason: "past"',
      "resolved_iso",
    ]
  ) {
    if (!s.time.includes(token)) {
      failures.push(`deterministic-time contract missing ${token}`);
    }
  }
  for (
    const token of [
      "extractEventBrief",
      "jollof",
      "acrobat",
      "dateChoices",
      "export function applyStoredChoice",
      "assertCreateEventProposal(state)",
      "export function isExplicitReplacementTaskRequest",
      "replacementTaskQuestion",
      "replacement_request",
    ]
  ) {
    if (!s.planner.includes(token)) {
      failures.push(`planner contract missing ${token}`);
    }
  }
  if (
    !s.choices.includes("schema_version: 2") ||
    !s.choices.includes("question_id") || !s.choices.includes("slot_patch") ||
    !s.choices.includes("const AFFIRMATIVE_ONLY")
  ) {
    failures.push("typed AgentChoicesV2 contract incomplete");
  }
  if (
    s.chat.includes("detectChoices") ||
    !s.chat.includes(": validateChoiceSubmission(body.choice_response)") ||
    !s.chat.includes("existingAssistant") ||
    !s.chat.includes("response_message_id")
  ) {
    failures.push("chat choice/idempotency boundary incomplete");
  }
  for (
    const token of [
      "appendSafeSummary",
      "TASK_STATE_CONFLICT",
      "beginInterruption",
      "resumeInterruption",
    ]
  ) {
    if (!s.chat.includes(token)) {
      failures.push(`chat state ownership missing ${token}`);
    }
  }
  if (!/\.select\(\s*"summary,brand_id,title,task_state,task_state_revision"\s*\)[\s\S]{0,180}\.eq\("id", conversationId\)[\s\S]{0,120}\.eq\("user_id", userId\)/.test(s.chat)) {
    failures.push("canonical conversation read is not id/user scoped with state and revision");
  }
  for (
    const token of [
      "claim_agent_chat_turn",
      "commit_agent_chat_assistant_turn",
      "append_agent_chat_tool_result",
      "buildServiceClient",
      "server_proposed_at",
      "TASK_REPLACED_BY_NEW_TASK",
      'reason: "task_replaced"',
      "p_user_id: args.userId",
    ]
  ) {
    if (!s.chat.includes(token)) {
      failures.push(`chat serialized/attested turn contract missing ${token}`);
    }
  }
  if ((s.chat.match(/"append_agent_chat_tool_result"/g) ?? []).length !== 2) {
    failures.push("tool-result paths no longer use exactly the service-owned append RPC");
  }
  const claim = s.turnMigration.slice(
    s.turnMigration.indexOf("CREATE OR REPLACE FUNCTION public.claim_agent_chat_turn"),
    s.turnMigration.indexOf("CREATE OR REPLACE FUNCTION public.commit_agent_chat_assistant_turn"),
  );
  const commit = s.turnMigration.slice(
    s.turnMigration.indexOf("CREATE OR REPLACE FUNCTION public.commit_agent_chat_assistant_turn"),
    s.turnMigration.indexOf("CREATE OR REPLACE FUNCTION public.append_agent_chat_tool_result"),
  );
  const tool = s.turnMigration.slice(
    s.turnMigration.indexOf("CREATE OR REPLACE FUNCTION public.append_agent_chat_tool_result"),
    s.turnMigration.indexOf("CREATE OR REPLACE FUNCTION public.queue_agent_attachment_cleanup"),
  );
  for (const token of [
    "p_request_digest", "p_manifest_digest", "v_attempt.request_digest <> p_request_digest",
    "v_attempt.manifest_digest <> p_manifest_digest", "turn_attempt.user_id = p_user_id",
    "turn_attempt.client_turn_id = p_client_turn_id", "TO service_role",
  ]) if (!claim.includes(token)) failures.push(`digest-bound service claim missing ${token}`);
  for (const token of [
    "v_attempt.status <> 'running'", "v_attempt.attempt_number <> p_attempt_number",
    "AND turn_attempt.user_id = p_user_id", "AND turn_attempt.conversation_id = p_conversation_id",
    "AND turn_attempt.client_turn_id = p_client_turn_id", "AND task_state_revision = p_expected_revision",
    "INSERT INTO public.agent_messages", "status = 'completed'", "response_ready", "title_source = CASE",
  ]) if (!commit.includes(token)) failures.push(`current-attempt assistant commit missing ${token}`);
  for (const token of [
    "v_attempt.status <> 'running'", "v_attempt.attempt_number <> p_attempt_number",
    "AND turn_attempt.user_id = p_user_id", "AND turn_attempt.conversation_id = p_conversation_id",
    "AND turn_attempt.client_turn_id = p_client_turn_id", "INSERT INTO public.agent_messages",
  ]) if (!tool.includes(token)) failures.push(`current-attempt tool append missing ${token}`);
  if (!s.hook.includes('!["failed", "stopped"].includes(turn.delivery)')) {
    failures.push("retry no longer preserves the failed/stopped in-place transition boundary");
  }
  const authorization = s.confirm.indexOf(
    "await authorizeAgentTool(tool, finalArgs",
  );
  const executing = s.confirm.indexOf('status: "executing"', authorization);
  if (
    authorization < 0 || executing < authorization ||
    !s.confirm.includes("persistTaskOutcome") ||
    !s.confirm.includes("reconcilePendingAction")
  ) {
    failures.push("confirmation reconcile/authorization ordering incomplete");
  }
  for (
    const token of [
      "replaceCreateEventProposalArgs",
      "EDITED_REPLACEMENT:",
      "findTerminalMessageId",
      'rpc(\n    "get_agent_pending_terminal_message_id"',
      "replacementPendingActionId",
      'kind: "proposal_replaced"',
      'outcome: "expired"',
      'rpc("commit_agent_task_outcome"',
      "p_user_id: args.userId",
    ]
  ) {
    if (!s.confirm.includes(token)) {
      failures.push(`proposal replacement/expiry contract missing ${token}`);
    }
  }
  if (
    !/pending_action_id:\s*pending\.id,[\s\S]{0,120}outcome:\s*"expired"/
      .test(s.confirm)
  ) {
    failures.push(
      "proposal expiry contract does not append a matching terminal tool row",
    );
  }
  const confirmationMessageInserts = s.confirm.match(
    /\.from\(\s*"agent_messages"\s*\)\s*\.insert\(/g,
  )?.length ?? 0;
  if (confirmationMessageInserts !== 1) {
    failures.push(
      `#1972 terminalization owner bypassed: expected 1 direct confirmation assistant writer, found ${confirmationMessageInserts}`,
    );
  }
  const chatDirectWrites = s.chat.match(/\.from\(\s*"agent_messages"\s*\)[\s\S]{0,80}\.insert\(/g) ?? [];
  if (chatDirectWrites.length !== 1) {
    failures.push("chat bypasses #3429 RPC turn authority outside the protected #1972 terminalization");
  }
  for (
    const token of [
      'await pendingStateClient\n        .from("agent_messages")\n        .update({',
      '.eq("user_id", userId)\n        .eq("conversation_id", pending.conversation_id)\n        .eq("role", "assistant")',
      'await pendingStateClient.from("agent_messages").insert({',
    ]
  ) {
    if (!s.confirm.includes(token)) {
      failures.push(`server-owned confirmation message writer missing ${token}`);
    }
  }
  for (
    const token of [
      "legitimate owner metadata update failed",
      "authenticated title provenance update was accepted",
      "authenticated state RPC execution was accepted",
      "SET LOCAL ROLE service_role",
      "service assistant CAS did not commit",
      "stale service outcome CAS committed",
      "terminal message lookup escaped user scope",
    ]
  ) {
    if (!s.implementorPg.includes(token)) {
      failures.push(`implementor PG17 authority proof missing ${token}`);
    }
  }
  for (const token of [
    "same id/digest did not recover one logical turn", "digest mismatch wrote or recovered authority",
    "authenticated client bypassed service turn authority", "issue_3429 stale revision committed",
    "assistant commit was not exactly once", "title provenance or summary ownership regressed",
  ]) if (!s.turnAuthorityPg.includes(token)) failures.push(`#3429 PG17 authority proof missing ${token}`);
  for (
    const token of [
      "legitimate user-message append failed",
      "authenticated assistant update was accepted",
      "authenticated assistant insert was accepted",
      "authenticated assistant delete was accepted",
      "service-owned assistant update lost canonical choice payload",
    ]
  ) {
    if (!s.messageRolePg.includes(token)) {
      failures.push(`implementor message-role proof missing ${token}`);
    }
  }
  if (
    !s.testerChoicePg.includes(
      "authenticated assistant choice payload overwrite was accepted",
    ) ||
    s.workflow.split(
        "issue_1985_choice_payload_authority.tester_round3.pg17.test.sql",
      ).length - 1 !== 3 ||
    s.workflow.split(
        "issue_1985_message_role_authority.implementor.pg17.test.sql",
      ).length - 1 !== 3
  ) {
    failures.push("message-role PG17 tester/implementor workflow wiring incomplete");
  }
  if (
    !s.choiceTest.includes(
      "const submission = await Promise.resolve(",
    ) ||
    !s.choiceTest.includes(
      "parsed ? buildChoiceSubmission(parsed, [parsed.options[0].id]) : null",
    )
  ) {
    failures.push("Business choice payload proof is not executable behavior");
  }
  const expiryOutcomeWrites =
    s.confirm.match(/^\s*outcome: "expired",?$/gm)?.length ?? 0;
  if (expiryOutcomeWrites !== 2) {
    failures.push(
      `proposal expiry contract expected canonical-message lookup plus reducer reconciliation, found ${expiryOutcomeWrites}`,
    );
  }
  if (
    !s.service.includes("AgentChoiceSubmissionV2") ||
    !s.service.includes("choice_response?: AgentChoiceSubmissionV2") ||
    !s.service.includes("client_turn_id: string")
  ) {
    failures.push("Business service typed turn contract incomplete");
  }
  for (
    const token of [
      "ARI_CONVERSATION_SELECTION_STORAGE_KEY",
      "ariConversationScopeKey",
      "resolveRestoredAriConversation",
      "if (storedSelection === null) return null;",
    ]
  ) {
    if (!s.activeSelectionStore.includes(token)) {
      failures.push(`active conversation restoration missing ${token}`);
    }
  }
  const selectedBrandFilters =
    s.activeSelectionStore.match(/conversation\.brand_id === selectedBrandId/g)?.length ?? 0;
  if (selectedBrandFilters !== 2) {
    failures.push(
      `active conversation restoration expected two selected-brand filters, found ${selectedBrandFilters}`,
    );
  }
  for (
    const token of [
      "persists one active pointer per account and brand across rehydration",
      "treats explicit New conversation as durable null",
      "fails closed when a stored chat was deleted",
    ]
  ) {
    if (!s.activeSelectionTest.includes(token)) {
      failures.push(`active conversation persistence proof missing ${token}`);
    }
  }
  if (
    !s.storageReaper.includes("mingla-business.ariConversationSelection.v1") ||
    !s.screen.includes("conversationSelectionReady") ||
    !s.screen.includes("Restoring your chat…") ||
    !s.screen.includes("!conversationSelectionReady ? (") ||
    !s.hook.includes("onConversationIdChange?.(id)") ||
    !s.clearStores.includes("useAriConversationSelectionStore.getState().reset()")
  ) {
    failures.push(
      "Business Ari does not durably restore the account+brand active conversation",
    );
  }
  for (
    const token of [
      "newClientTurnId",
      "interface LocalTurn",
      "latest.attachments, clientTurnId",
      "setPendingAction(unresolved)",
    ]
  ) {
    if (!s.hook.includes(token)) {
      failures.push(`Business retry/refresh contract missing ${token}`);
    }
  }
  if (
    !s.screen.includes(
      'import { useShareNetworkState } from "../../components/ui/useShareNetworkState";',
    ) ||
    !s.screen.includes("You're offline. Reconnect to continue this plan.") ||
    !s.screen.includes("choicesDisabled={chat.isSending || !online}")
  ) {
    failures.push("Business offline contract incomplete");
  }
  for (
    const token of [
      "const displayError = localError ?? chat.errorMessage",
      "chat.retryTurn(clientTurnId).then((result)",
      'result?.kind === "error"',
      'kind === "proposal_replaced"',
    ]
  ) {
    if (!s.screen.includes(token)) {
      failures.push(`Business retry/replacement contract missing ${token}`);
    }
  }
  if (
    !s.clientChoices.includes("raw.schema_version !== 2") ||
    !s.clientChoices.includes("buildChoiceSubmission") ||
    !s.list.includes("buildChoiceSubmission(choices, [optionId])") ||
    s.list.includes("resolveChoiceLabel")
  ) {
    failures.push(
      "client can treat display labels or V1 rows as semantic authority",
    );
  }
  const typedBusinessFiles = [
    "src/components/ari/ClarifyingCard.tsx",
    "src/components/ari/MessageList.tsx",
    "src/components/ari/MultiSelectPrompt.tsx",
    "src/components/ari/QuickReplyChips.tsx",
    "src/components/ari/agentChoices.ts",
    "src/components/ari/__tests__/issue_1985_choice_payloads.test.tsx",
    "src/components/ari/__tests__/issue_1985_value_choices.adversarial.test.tsx",
    "src/components/ari/__tests__/orch_1103_choices_chips.test.ts",
    "src/hooks/useAgentChat.ts",
    "src/screens/ari/AriChatScreen.tsx",
    "src/screens/ari/__tests__/issue_2013_ari_tenant_containment.test.ts",
    "src/services/agentChatService.ts",
    "src/store/ariConversationSelectionStore.ts",
    "src/store/__tests__/issue_1985_active_conversation_persistence.test.ts",
    "src/utils/clearAllStores.ts",
    "src/utils/reapOrphanStorageKeys.ts",
  ];
  for (const file of typedBusinessFiles) {
    if (!s.typecheck.includes(`"${file}"`)) {
      failures.push(`Business typecheck contract missing ${file}`);
    }
  }
  if (
    !s.typecheckRunner.includes(
      "const SCOPED_FILES = new Set(config.fileNames.map",
    ) ||
    !s.typecheckRunner.includes(
      "SCOPED_FILES.has(path.resolve(diagnostic.file.fileName))",
    )
  ) {
    failures.push(
      "#1985 Business typecheck runner can ignore its scoped files",
    );
  }
  if (
    !s.workflow.includes(
      "node .github/scripts/strict-grep/issue-1985-business-typecheck.mjs",
    )
  ) {
    failures.push(
      "#1985 workflow does not run the issue-scoped Business typecheck",
    );
  }
  if (
    s.workflow.split("issue_1985_message_delivery_identity.test.ts").length - 1 !== 3
  ) {
    failures.push("#1985 workflow does not trigger on and run the delivery identity proof");
  }
  if (
    s.workflow.split("issue_1985_active_conversation_persistence.test.ts").length - 1 !== 3
  ) {
    failures.push(
      "#1985 workflow does not trigger on and run the active conversation proof",
    );
  }
  const reworkIntegrityWorkflowRefs =
    s.workflow.split("issue_1985_rework2_integrity.test.ts").length - 1;
  if (reworkIntegrityWorkflowRefs !== 3) {
    failures.push(
      `#1985 workflow expected 3 rework-2 integrity references, found ${reworkIntegrityWorkflowRefs}`,
    );
  }
  const implementorPgWorkflowRefs = s.workflow.split(
    "issue_1985_task_state_authority.implementor.pg17.test.sql",
  ).length - 1;
  if (implementorPgWorkflowRefs !== 3) {
    failures.push(
      `#1985 workflow expected 3 implementor PG17 references, found ${implementorPgWorkflowRefs}`,
    );
  }
  for (const testPath of [
    "issue_3429_ari_chat_context.implementor.pg17.test.sql",
    "issue_3429_ari_turn_authority.tester_adversarial.pg17.test.sql",
    "issue_3429_ari_turn_scope.tester.adversarial.test.tsx",
  ]) if (s.workflow.split(testPath).length - 1 !== 3) {
    failures.push(`#3429 workflow routing incomplete for ${testPath}`);
  }
  if (!s.input.includes("(text.trim().length > 0 || hasReadyAttachments) && !disabled && !sendDisabled")) {
    failures.push("#3429 InputBar does not require both disabled gates for text/file sends");
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  if (check(sources).length) {
    console.error("issue-1985 self-test clean source FAIL", check(sources));
    process.exit(1);
  }
  const mutations = [
    {
      key: "migration",
      from: "task_state_revision bigint",
      to: "removed_revision",
    },
    {
      key: "turnMigration",
      from: "CREATE OR REPLACE FUNCTION public.claim_agent_chat_turn",
      to: "CREATE OR REPLACE FUNCTION public.removed_chat_turn_claim",
    },
    {
      key: "turnMigration",
      from: "v_attempt.request_digest <> p_request_digest",
      to: "false",
    },
    {
      key: "turnMigration",
      from: "v_attempt.manifest_digest <> p_manifest_digest",
      to: "false",
    },
    {
      key: "turnMigration",
      from: "turn_attempt.user_id = p_user_id",
      to: "turn_attempt.user_id = turn_attempt.user_id",
    },
    {
      key: "turnMigration",
      from: "turn_attempt.client_turn_id = p_client_turn_id",
      to: "turn_attempt.client_turn_id = turn_attempt.client_turn_id",
    },
    {
      key: "chat",
      from: "summary,brand_id,title,task_state,task_state_revision",
      to: "summary,brand_id,title,task_state",
    },
    {
      key: "turnMigration",
      from:
        "CREATE OR REPLACE FUNCTION public.commit_agent_chat_assistant_turn",
      to: "CREATE OR REPLACE FUNCTION public.removed_chat_turn_commit",
    },
    {
      key: "migration",
      from: "AND task_state_revision = p_expected_revision",
      to: "AND task_state_revision = task_state_revision",
    },
    {
      key: "migration",
      from:
        "REVOKE UPDATE ON TABLE public.agent_conversations FROM authenticated;",
      to: "GRANT UPDATE ON TABLE public.agent_conversations TO authenticated;",
    },
    {
      key: "migration",
      from:
        "REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_messages FROM authenticated;",
      to:
        "GRANT INSERT, UPDATE, DELETE ON TABLE public.agent_messages TO authenticated;",
    },
    {
      key: "migration",
      from: ") TO service_role;",
      to: ") TO authenticated;",
    },
    {
      key: "migration",
      from:
        "CREATE OR REPLACE FUNCTION public.get_agent_pending_terminal_message_id",
      to: "CREATE OR REPLACE FUNCTION public.removed_terminal_message_lookup",
    },
    {
      key: "state",
      from: "export function reconcilePendingAction",
      to: "function removedReconcile",
    },
    {
      key: "state",
      from: "export function replaceCreateEventProposalArgs",
      to: "function removedProposalReplacement",
    },
    {
      key: "time",
      from: "function endOfMonthChoices(",
      to: "function removedEndMonth(",
    },
    {
      key: "planner",
      from: "export function applyStoredChoice",
      to: "function removedStoredChoice",
    },
    {
      key: "planner",
      from: "export function isExplicitReplacementTaskRequest",
      to: "function removedReplacementDetection",
    },
    {
      key: "choices",
      from: "const AFFIRMATIVE_ONLY",
      to: "const removedAffirmativeGuard",
    },
    {
      key: "chat",
      from: ": validateChoiceSubmission(body.choice_response)",
      to: ": null /* validation removed */",
    },
    {
      key: "chat",
      from: '"claim_agent_chat_turn"',
      to: '"removed_chat_turn_claim"',
    },
    {
      key: "chat",
      from: "server_proposed_at",
      to: "removed_server_attestation",
    },
    {
      key: "chat",
      from: "client: serviceClient",
      to: "client: userClient",
    },
    {
      key: "chat",
      from: '"append_agent_chat_tool_result"',
      to: '"direct_agent_messages_tool_write"',
    },
    { key: "turnMigration", from: "v_attempt.status <> 'running'", to: "false" },
    {
      key: "turnMigration",
      from: "IF NOT FOUND OR v_attempt.attempt_number <> p_attempt_number\n    OR v_attempt.status <> 'running'",
      to: "IF NOT FOUND OR false\n    OR v_attempt.status <> 'running'",
    },
    { key: "turnMigration", from: "AND turn_attempt.conversation_id = p_conversation_id", to: "AND true" },
    { key: "turnMigration", from: "AND task_state_revision = p_expected_revision", to: "AND true" },
    {
      key: "chat",
      from: "TASK_REPLACED_BY_NEW_TASK",
      to: "REMOVED_TASK_REPLACEMENT",
    },
    { key: "confirm", from: 'status: "executing"', to: 'status: "pending"' },
    {
      key: "confirm",
      from: 'rpc("commit_agent_task_outcome"',
      to: 'rpc("removed_task_outcome"',
    },
    {
      key: "confirm",
      from: "client: pendingStateClient",
      to: "client: userClient",
    },
    {
      key: "confirm",
      from: 'await pendingStateClient.from("agent_messages").insert({',
      to: 'await userClient.from("agent_messages").insert({',
    },
    { key: "confirm", from: "EDITED_REPLACEMENT:", to: "REMOVED_REPLACEMENT:" },
    {
      key: "confirm",
      from: '          outcome: "expired"',
      to: '          outcome: "pending"',
    },
    {
      key: "hook",
      from: "latest.attachments, clientTurnId",
      to: "latest.attachments, newClientTurnId()",
    },
    {
      key: "hook",
      from: '!["failed", "stopped"].includes(turn.delivery)',
      to: '!["failed"].includes(turn.delivery)',
    },
    {
      key: "activeSelectionStore",
      from: "if (storedSelection === null) return null;",
      to: "if (storedSelection === null) return visibleConversations[0]?.id ?? null;",
    },
    {
      key: "activeSelectionStore",
      from: "conversation.brand_id === selectedBrandId",
      to: "conversation.brand_id !== selectedBrandId",
    },
    {
      key: "activeSelectionTest",
      from: "treats explicit New conversation as durable null",
      to: "removed explicit new conversation proof",
    },
    {
      key: "clearStores",
      from: "useAriConversationSelectionStore.getState().reset()",
      to: "removedAriConversationSelectionReset()",
    },
    {
      key: "screen",
      from:
        'import { useShareNetworkState } from "../../components/ui/useShareNetworkState";',
      to: 'import { useUnsafeOnline } from "unsafe";',
    },
    {
      key: "screen",
      from: "const displayError = localError ?? chat.errorMessage",
      to: "const displayError = localError",
    },
    { key: "clientChoices", from: "raw.schema_version !== 2", to: "false" },
    {
      key: "choiceTest",
      from: "const submission = await Promise.resolve(",
      to: "const submission = Promise.resolve(",
    },
    {
      key: "deliveryTest",
      from: "reconcileAgentDeliveryMessages([server], [optimistic], [failed], true)",
      to: "reconcileAgentDeliveryMessages([server], [], [], true)",
    },
    {
      key: "workflow",
      from:
        "issue_1985_message_role_authority.implementor.pg17.test.sql",
      to: "removed_message_role_authority.implementor.pg17.test.sql",
    },
    {
      key: "typecheck",
      from: '"src/services/agentChatService.ts"',
      to: '"src/services/removedAgentChatService.ts"',
    },
    {
      key: "typecheckRunner",
      from: "SCOPED_FILES.has(path.resolve(diagnostic.file.fileName))",
      to: "true",
    },
    {
      key: "workflow",
      from:
        "node .github/scripts/strict-grep/issue-1985-business-typecheck.mjs",
      to: "npx tsc --noEmit",
    },
    {
      key: "workflow",
      from: "issue_1985_rework2_integrity.test.ts",
      to: "removed_rework2_integrity.test.ts",
    },
    {
      key: "workflow",
      from:
        "issue_1985_task_state_authority.implementor.pg17.test.sql",
      to: "removed_task_state_authority.implementor.pg17.test.sql",
    },
  ];
  for (const mutation of mutations) {
    const mutated = {
      ...sources,
      [mutation.key]: sources[mutation.key].replace(mutation.from, mutation.to),
    };
    if (check(mutated).length === 0) {
      console.error(
        `issue-1985 self-test FAIL: ${mutation.key} revert escaped (${mutation.from})`,
      );
      process.exit(1);
    }
  }
  console.log(
    `issue-1985 self-test PASS: clean source passes and ${mutations.length} load-bearing reverts fail.`,
  );
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error(
    "issue-1985-ari-task-state FAIL:\n" +
      failures.map((failure) => `  - ${failure}`).join("\n"),
  );
  process.exit(1);
}
console.log("issue-1985-ari-task-state PASS.");
