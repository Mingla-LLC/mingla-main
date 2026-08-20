#!/usr/bin/env node
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const files = {
  migration:
    "supabase/migrations/20270506001985_issue_1985_ari_conversation_task_state.sql",
  implementorPg:
    "supabase/migrations/__tests__/issue_1985_task_state_authority.implementor.pg17.test.sql",
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
  list: "mingla-business/src/components/ari/MessageList.tsx",
  clientChoices: "mingla-business/src/components/ari/agentChoices.ts",
  choiceTest:
    "mingla-business/src/components/ari/__tests__/issue_1985_choice_payloads.test.tsx",
  deliveryTest:
    "mingla-business/src/hooks/__tests__/issue_1985_message_delivery_identity.test.ts",
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
    !s.chat.includes("recoveredTurn?.conversation_id") ||
    !s.chat.includes("existingAssistant") ||
    !s.chat.includes("response_message_id")
  ) {
    failures.push("chat choice/idempotency boundary incomplete");
  }
  for (
    const token of [
      "appendSafeSummary",
      '.select("task_state, task_state_revision")',
      "TASK_STATE_CONFLICT",
      "beginInterruption",
      "resumeInterruption",
    ]
  ) {
    if (!s.chat.includes(token)) {
      failures.push(`chat state ownership missing ${token}`);
    }
  }
  for (
    const token of [
      "claim_agent_first_turn",
      "commit_agent_task_assistant_turn",
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
  for (
    const token of [
      "legitimate owner metadata update failed",
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
      "newClientTurnId",
      "turnPayloads",
      "payload, clientTurnId",
      'local_delivery: "failed"',
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
      key: "migration",
      from: "CREATE OR REPLACE FUNCTION public.claim_agent_first_turn",
      to: "CREATE OR REPLACE FUNCTION public.removed_first_turn_claim",
    },
    {
      key: "migration",
      from:
        "CREATE OR REPLACE FUNCTION public.commit_agent_task_assistant_turn",
      to: "CREATE OR REPLACE FUNCTION public.removed_task_turn_commit",
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
      from: '"claim_agent_first_turn"',
      to: '"removed_first_turn_claim"',
    },
    {
      key: "chat",
      from: "server_proposed_at",
      to: "removed_server_attestation",
    },
    {
      key: "chat",
      from: "p_user_id: args.userId",
      to: "p_user_id: removedUserScope",
    },
    {
      key: "chat",
      from: "client: serviceClient",
      to: "client: userClient",
    },
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
    { key: "confirm", from: "EDITED_REPLACEMENT:", to: "REMOVED_REPLACEMENT:" },
    {
      key: "confirm",
      from: '          outcome: "expired"',
      to: '          outcome: "pending"',
    },
    {
      key: "hook",
      from: "payload, clientTurnId",
      to: "payload, newClientTurnId()",
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
