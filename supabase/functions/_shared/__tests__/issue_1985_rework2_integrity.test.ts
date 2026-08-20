import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from "jsr:@std/assert@1";

import {
  applyStoredChoice,
  planEventTurn,
} from "../agentConversationPlanner.ts";
import {
  assertEditedCreateEventProposal,
  IDLE_TASK_STATE,
  markAwaitingConfirmation,
  replaceCreateEventProposalArgs,
  TaskStateError,
} from "../agentConversationState.ts";

const ROOT = new URL("../../../../", import.meta.url);

async function source(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, ROOT));
}

function plannerContext(questionId: string, taskId: string) {
  return {
    now: new Date("2026-08-14T16:00:00.000Z"),
    timezone: "Africa/Lagos",
    locale: "en-NG",
    activeBrand: { id: "brand-owned", name: "Mingla Nigeria" },
    originMessageId: `message-${taskId}`,
    taskId,
    questionId,
  };
}

Deno.test("#1985 R2-1 a typed pause choice starts the stored replacement request without mutating the old plan first", () => {
  const first = planEventTurn(
    IDLE_TASK_STATE,
    "Create an event at the end of this month with acrobats, food, music and jollof",
    plannerContext("question-first", "task-first"),
  );
  const originalTask = structuredClone(first.state.active_task);
  const replacement = planEventTurn(
    first.state,
    "Create another event tomorrow at 7pm called Sunset Sessions",
    plannerContext("question-replace", "task-replace"),
  );
  assertEquals(replacement.state.active_task, originalTask);
  assert(replacement.choices);
  const pause = replacement.choices.options.find((option) =>
    option.payload.type === "task_command" && option.payload.command === "pause"
  );
  assert(pause);
  const started = applyStoredChoice({
    state: replacement.state,
    choices: replacement.choices,
    optionIds: [pause.id],
    context: plannerContext("question-started", "task-started"),
  });
  assertNotEquals(started.state.active_task?.task_id, originalTask?.task_id);
  assertEquals(started.state.active_task?.slots.title.value, "Sunset Sessions");
  assertEquals(started.state.active_task?.slots.start_at.status, "resolved");

  const confirmable = markAwaitingConfirmation(
    planEventTurn(
      IDLE_TASK_STATE,
      "Create an event tomorrow at 7pm called Original Proposal",
      plannerContext("question-confirmable", "task-confirmable"),
    ).state,
    "00000000-0000-4000-8000-000000000012",
  );
  const replacementWhileConfirmable = planEventTurn(
    confirmable,
    "Create another event tomorrow at 9pm called Replacement Proposal",
    plannerContext("question-confirmable-replace", "task-confirmable-replace"),
  );
  assertEquals(
    replacementWhileConfirmable.state.status,
    "awaiting_confirmation",
  );
  assertEquals(
    replacementWhileConfirmable.state.active_task?.pending_action_id,
    confirmable.active_task?.pending_action_id,
  );
  const keep = replacementWhileConfirmable.choices?.options.find((option) =>
    option.payload.type === "task_command" &&
    option.payload.command === "continue_planning"
  );
  assert(keep && replacementWhileConfirmable.choices);
  const kept = applyStoredChoice({
    state: replacementWhileConfirmable.state,
    choices: replacementWhileConfirmable.choices,
    optionIds: [keep.id],
    context: plannerContext(
      "question-confirmable-kept",
      "task-confirmable-kept",
    ),
  });
  assertEquals(kept.state.status, "awaiting_confirmation");
  assertEquals(
    kept.state.active_task?.pending_action_id,
    confirmable.active_task?.pending_action_id,
  );
});

Deno.test("#1985 R2-2 edited create-event args replace canonical slots before a new pending ID is attached", () => {
  const ready = planEventTurn(
    IDLE_TASK_STATE,
    "Create an event tomorrow at 7pm called Original Title",
    plannerContext("question-ready", "task-ready"),
  ).state;
  const oldPendingId = "00000000-0000-4000-8000-000000000010";
  const newPendingId = "00000000-0000-4000-8000-000000000011";
  const awaiting = markAwaitingConfirmation(ready, oldPendingId);
  const replaced = replaceCreateEventProposalArgs({
    state: awaiting,
    pendingActionId: oldPendingId,
    toolArgs: {
      brand_id: "brand-owned",
      title: "Edited Title",
      start_at: "2026-08-16T18:00:00.000Z",
      timezone: "Africa/Lagos",
      location_text: "Harbour Hall",
    },
    nowIso: "2026-08-14T16:00:00.000Z",
  });
  assertEquals(replaced.status, "ready_to_propose");
  assertEquals(replaced.active_task?.pending_action_id, undefined);
  assertEquals(replaced.active_task?.slots.title.value, "Edited Title");
  assertEquals(replaced.active_task?.slots.location_text.value, "Harbour Hall");
  const canonical = assertEditedCreateEventProposal(replaced);
  assertEquals(canonical.title, "Edited Title");
  assertEquals(canonical.location_text, "Harbour Hall");
  const next = markAwaitingConfirmation(replaced, newPendingId);
  assertEquals(next.active_task?.pending_action_id, newPendingId);
  assertThrows(
    () =>
      replaceCreateEventProposalArgs({
        state: next,
        pendingActionId: oldPendingId,
        toolArgs: canonical,
        nowIso: "2026-08-14T16:00:00.000Z",
      }),
    TaskStateError,
  );
  assertThrows(
    () =>
      replaceCreateEventProposalArgs({
        state: awaiting,
        pendingActionId: oldPendingId,
        toolArgs: { ...canonical, timezone: "not/a-timezone" },
        nowIso: "2026-08-14T16:00:00.000Z",
      }),
    TaskStateError,
  );
  assertThrows(
    () =>
      replaceCreateEventProposalArgs({
        state: awaiting,
        pendingActionId: oldPendingId,
        toolArgs: { ...canonical, is_online: "yes" },
        nowIso: "2026-08-14T16:00:00.000Z",
      }),
    TaskStateError,
  );
});

Deno.test("#1985 R2-3 first-turn identity and task response commit are database-serialized", async () => {
  const migration = await source(
    "supabase/migrations/20270503001985_issue_1985_ari_conversation_task_state.sql",
  );
  const chat = await source("supabase/functions/agent-chat/index.ts");
  assertMatch(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_user_client_turn\s+ON public\.agent_messages \(user_id, client_turn_id\)/,
  );
  assertMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.claim_agent_first_turn/,
  );
  assertMatch(migration, /EXCEPTION WHEN unique_violation/);
  assertMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.commit_agent_task_assistant_turn/,
  );
  const updateAt = migration.indexOf(
    "UPDATE public.agent_conversations",
    migration.indexOf("commit_agent_task_assistant_turn"),
  );
  const insertAt = migration.indexOf(
    "INSERT INTO public.agent_messages",
    updateAt,
  );
  assert(
    updateAt >= 0 && insertAt > updateAt,
    "state CAS and assistant insert must share the same RPC transaction",
  );
  assertMatch(chat, /\.rpc\(\s*"claim_agent_first_turn"/);
  assertMatch(chat, /\.rpc\(\s*"commit_agent_task_assistant_turn"/);
  assertMatch(chat, /TASK_REPLACED_BY_NEW_TASK/);
  assertMatch(chat, /reason: "task_replaced"/);
});

Deno.test("#1985 R2-4 edited and expired proposals are terminal before refresh can rehydrate them", async () => {
  const confirm = await source(
    "supabase/functions/agent-confirm-action/index.ts",
  );
  assertMatch(confirm, /EDITED_REPLACEMENT:/);
  assertMatch(confirm, /terminalizePending\(pendingStateClient/);
  assertMatch(
    confirm,
    /failureReason: `EDITED_REPLACEMENT:\$\{replacementPendingActionId\}`/,
  );
  assertMatch(confirm, /outcome: "cancelled"/);
  assertMatch(confirm, /kind: "proposal_replaced"/);
  assert(
    /pending_action_id: pending\.id,[\s\S]{0,120}outcome: "expired"/.test(
      confirm,
    ),
    "lazy expiry must append a terminal tool row for the expired pending action",
  );
});

Deno.test("#1985 R2-5 retry errors are rendered and retry awaits its typed result", async () => {
  const screen = await source(
    "mingla-business/src/screens/ari/AriChatScreen.tsx",
  );
  assertMatch(
    screen,
    /const displayError = localError \?\? chat\.errorMessage/,
  );
  assertMatch(screen, /chat\.retryTurn\(clientTurnId\)\.then\(\(result\)/);
  assertMatch(
    screen,
    /if \(result\?\.kind === "error"\) setLocalError\(result\.message\)/,
  );
});

Deno.test("#1985 R2-6 provider follow-up and Business delivery ownership preserve protected contracts", async () => {
  const chat = await source("supabase/functions/agent-chat/index.ts");
  const hook = await source("mingla-business/src/hooks/useAgentChat.ts");

  const followupStart = chat.indexOf(
    "// Follow-up Gemini call to summarise the read result",
  );
  const followupEnd = chat.indexOf("const text = followup?.textResponse");
  assert(followupStart >= 0 && followupEnd > followupStart);
  const followupBoundary = chat.slice(followupStart, followupEnd);
  assertMatch(followupBoundary, /callGemini\(\{/);
  assertMatch(
    followupBoundary,
    /const schemaResponse = schemaErrorResponse\(err\);\s*if \(schemaResponse\) return schemaResponse;/s,
  );

  assertMatch(hook, /content: \{ text \}/);
  assertMatch(
    hook,
    /setOptimisticMessages\(\(prev\) => prev\.filter\(\(m\) => m\.id !== vars\.optimisticId\)\)/,
  );
  assertMatch(hook, /function makeFailedMessage\(/);
  assertMatch(hook, /id: `failed-\$\{clientTurnId\}`/);
  assertMatch(hook, /export function reconcileAgentDeliveryMessages\(/);
  assertMatch(
    hook,
    /server\.client_turn_id === failed\.client_turn_id/,
  );
});
