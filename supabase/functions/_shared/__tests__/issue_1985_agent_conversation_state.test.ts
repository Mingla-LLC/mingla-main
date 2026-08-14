import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyStoredChoice,
  extractEventBrief,
  planEventTurn,
} from "../agentConversationPlanner.ts";
import {
  beginInterruption,
  markAwaitingConfirmation,
  parseTaskState,
  reconcilePendingAction,
  resumeInterruption,
} from "../agentConversationState.ts";
import { resolveRelativeTime } from "../agentRelativeTime.ts";

const NOW = new Date("2026-08-13T16:00:00.000Z");
const BRAND = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Lagos House",
};

function context(questionId: string) {
  return {
    now: NOW,
    timezone: "Africa/Lagos",
    locale: "en-US",
    activeBrand: BRAND,
    originMessageId: "00000000-0000-4000-8000-000000000002",
    taskId: "00000000-0000-4000-8000-000000000003",
    questionId,
  };
}

Deno.test("#1985 I-1 preserves the reported cultural event brief without inventing details", () => {
  const brief = extractEventBrief(
    "Create an event with acrobats, food, music and jollof at the end of the month",
  );
  assert(brief.experience.some((item) => /acrobat/i.test(item)));
  assert(brief.food.some((item) => /jollof/i.test(item)));
  assert(brief.concepts.includes("food"));
  assert(brief.concepts.includes("music"));
  assertEquals(brief.notes, []);
});

Deno.test("#1985 I-2 end-of-month is a bounded future choice set with exact instants", () => {
  const resolved = resolveRelativeTime("at the end of the month", {
    now: NOW,
    timezone: "Africa/Lagos",
    locale: "en-US",
  });
  assertEquals(resolved.temporal?.precision, "window");
  assert(resolved.choices.length > 0 && resolved.choices.length <= 3);
  for (const choice of resolved.choices) {
    assert(choice.temporal.resolved_iso);
    assert(new Date(choice.temporal.resolved_iso).getTime() > NOW.getTime());
    assertEquals(choice.temporal.timezone, "Africa/Lagos");
  }
});

Deno.test("#1985 I-3 next Friday is deterministic in the effective timezone", () => {
  const resolved = resolveRelativeTime("next Friday at 7pm", {
    now: NOW,
    timezone: "America/New_York",
    locale: "en-US",
  });
  assertEquals(resolved.temporal?.local_date, "2026-08-14");
  assertEquals(resolved.temporal?.local_time, "19:00");
  assertEquals(resolved.temporal?.timezone, "America/New_York");
  assertEquals(resolved.temporal?.resolved_iso, "2026-08-14T23:00:00.000Z");
});

Deno.test("#1985 I-4 persisted task state survives twelve read interruptions", () => {
  let state = planEventTurn(
    parseTaskState({
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    }),
    "Create an event with acrobats, food, music and jollof at the end of the month",
    context("q-date"),
  ).state;
  for (let turn = 0; turn < 12; turn++) {
    const before = JSON.stringify(state.active_task);
    state = beginInterruption(state, {
      turn_id: `turn-${turn}`,
      kind: "read",
      user_text_digest: `read-${turn}`,
      started_at: NOW.toISOString(),
    });
    state = resumeInterruption(state);
    state = parseTaskState(JSON.parse(JSON.stringify(state)));
    assertEquals(JSON.stringify(state.active_task), before);
  }
  assert(state.active_task?.brief.food.some((item) => /jollof/i.test(item)));
});

Deno.test("#1985 I-5 interruption resume restores the exact pending question", () => {
  const planned = planEventTurn(
    parseTaskState({
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    }),
    "Create an event with acrobats and jollof at the end of the month",
    context("q-exact"),
  );
  const pending = JSON.stringify(planned.state.pending_question);
  const interrupted = beginInterruption(planned.state, {
    turn_id: "read-1",
    kind: "question",
    user_text_digest: "how-many-events",
    started_at: NOW.toISOString(),
  });
  const resumed = resumeInterruption(interrupted);
  assertEquals(JSON.stringify(resumed.pending_question), pending);
  assertEquals(resumed.interruption_stack.length, 0);
});

Deno.test("#1985 I-6 choice IDs apply stored typed payloads, never display-label semantics", () => {
  const planned = planEventTurn(
    parseTaskState({
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    }),
    "Create an event with food and music at the end of the month",
    context("q-date-choice"),
  );
  assert(planned.choices && planned.choices.options.length > 0);
  const selected = planned.choices.options[0];
  const tamperedDisplay = {
    ...planned.choices,
    options: planned.choices.options.map((option) => ({
      ...option,
      label: "Yes, do it",
    })),
  };
  const applied = applyStoredChoice({
    state: planned.state,
    choices: tamperedDisplay,
    optionIds: [selected.id],
    context: context("q-title"),
  });
  assertEquals(applied.state.active_task?.slots.start_at.status, "resolved");
  assertNotEquals(
    applied.state.active_task?.slots.start_at.value,
    "Yes, do it",
  );
});

Deno.test("#1985 I-7 proposal contains only resolved brand, title and start time", () => {
  const initial = planEventTurn(
    parseTaskState({
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    }),
    "Create an event with acrobats, food, music and jollof at the end of the month",
    context("q-date-proposal"),
  );
  assert(initial.choices);
  const afterDate = applyStoredChoice({
    state: initial.state,
    choices: initial.choices,
    optionIds: [initial.choices.options[0].id],
    context: context("q-title-proposal"),
  });
  assert(afterDate.choices);
  const ready = applyStoredChoice({
    state: afterDate.state,
    choices: afterDate.choices,
    optionIds: [afterDate.choices.options[0].id],
    context: context("q-done"),
  });
  assertEquals(ready.proposal?.tool_name, "create_event");
  assertEquals(Object.keys(ready.proposal?.tool_args ?? {}).sort(), [
    "brand_id",
    "start_at",
    "title",
  ]);
  assertEquals(ready.proposal?.tool_args.brand_id, BRAND.id);
});

Deno.test("#1985 I-8 confirmation outcomes reconcile state without replaying a write", () => {
  const initial = planEventTurn(
    parseTaskState({
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    }),
    "Create an event called Lagos Lights tomorrow at 7pm",
    context("q-ready"),
  );
  assertEquals(initial.state.status, "ready_to_propose");
  const awaiting = markAwaitingConfirmation(
    initial.state,
    "00000000-0000-4000-8000-000000000004",
  );
  const executed = reconcilePendingAction({
    state: awaiting,
    pendingActionId: "00000000-0000-4000-8000-000000000004",
    outcome: "executed",
    nowIso: NOW.toISOString(),
    resource: { kind: "event", id: "event-1", label: "Lagos Lights" },
  });
  assertEquals(executed.status, "completed");
  assertEquals(executed.last_completed_step?.outcome, "executed");
  for (const outcome of ["failed", "cancelled", "expired"] as const) {
    const reconciled = reconcilePendingAction({
      state: awaiting,
      pendingActionId: "00000000-0000-4000-8000-000000000004",
      outcome,
      nowIso: NOW.toISOString(),
      errorCode: outcome === "failed" ? "EXECUTION_FAILED" : undefined,
    });
    assertEquals(reconciled.last_completed_step?.outcome, outcome);
    assertEquals(reconciled.active_task?.pending_action_id, undefined);
  }
});
