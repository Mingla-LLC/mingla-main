import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  IDLE_TASK_STATE,
  markAwaitingConfirmation,
  reconcilePendingAction,
} from "../agentConversationState.ts";
import {
  applyStoredChoice,
  planEventTurn,
  type PlannerContext,
} from "../agentConversationPlanner.ts";

const BRAND_ID = "19770000-0000-4000-8000-000000000010";
const PENDING_ID = "19770000-0000-4000-8000-000000000020";
const RSVP_ID = "19770000-0000-4000-8000-000000000030";

const context = (): PlannerContext => ({
  now: new Date("2029-01-01T12:00:00.000Z"),
  timezone: "Africa/Lagos",
  locale: "en-US",
  activeBrand: { id: BRAND_ID, name: "Lagos Nights" },
  originMessageId: "origin-1977",
  taskId: "task-1977",
  questionId: "question-1977",
});

Deno.test("#1977 RSVP task persists one draft identity through confirmation", () => {
  const started = planEventTurn(
    IDLE_TASK_STATE,
    'Create an RSVP called "Sunset Guest List"',
    context(),
  );
  assertEquals(started.state.active_task?.intent, "create_rsvp");
  assert(started.choices, "missing date must produce an AgentChoicesV2 prompt");
  assertEquals(started.choices.required_slot_keys, ["start_at"]);

  const ready = applyStoredChoice({
    state: started.state,
    choices: started.choices,
    optionIds: [],
    freeText: "next Friday at 7 pm",
    context: context(),
  });
  assertEquals(ready.proposal?.tool_name, "create_rsvp");
  assertEquals(ready.proposal?.tool_args, {
    brand_id: BRAND_ID,
    title: "Sunset Guest List",
    timezone: "Africa/Lagos",
    format: "in_person",
    date: "2029-01-05",
    doors_open: "19:00",
  });

  const awaiting = markAwaitingConfirmation(ready.state, PENDING_ID);
  const completed = reconcilePendingAction({
    state: awaiting,
    pendingActionId: PENDING_ID,
    outcome: "executed",
    nowIso: "2029-01-01T12:01:00.000Z",
    resource: { kind: "rsvp", id: RSVP_ID, label: "Sunset Guest List" },
  });
  assertEquals(completed.status, "completed");
  assertEquals(completed.active_task?.created_resource, {
    kind: "rsvp",
    id: RSVP_ID,
    label: "Sunset Guest List",
  });
});
