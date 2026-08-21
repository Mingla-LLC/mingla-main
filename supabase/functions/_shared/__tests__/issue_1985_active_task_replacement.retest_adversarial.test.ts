import { assert, assertEquals } from "jsr:@std/assert@1";

import { IDLE_TASK_STATE } from "../agentConversationState.ts";
import { planEventTurn } from "../agentConversationPlanner.ts";

Deno.test("#1985 retest T-10 a second write task cannot overwrite the active event plan", () => {
  const now = new Date("2026-08-14T16:00:00.000Z");
  const first = planEventTurn(
    IDLE_TASK_STATE,
    "Create an event at the end of this month with acrobats, food, music and jollof",
    {
      now,
      timezone: "Africa/Lagos",
      locale: "en-NG",
      activeBrand: { id: "brand-owned", name: "Mingla Nigeria" },
      originMessageId: "message-first",
      taskId: "task-first",
      questionId: "question-first",
    },
  );

  const originalTask = structuredClone(first.state.active_task);
  assert(
    originalTask,
    "the first write request must establish an active event plan",
  );

  const second = planEventTurn(
    first.state,
    "Create another event tomorrow at 7pm called Sunset Sessions",
    {
      now,
      timezone: "Africa/Lagos",
      locale: "en-NG",
      activeBrand: { id: "brand-owned", name: "Mingla Nigeria" },
      originMessageId: "message-second",
      taskId: "task-second",
      questionId: "question-second",
    },
  );

  assertEquals(
    second.state.active_task,
    originalTask,
    "the explicit second write must leave every fact in the current event plan unchanged until the user chooses to pause it",
  );
  assert(
    second.choices?.options.some((option) =>
      option.payload.type === "task_command" &&
      option.payload.command === "pause"
    ),
    "the response must carry the locked, typed pause-before-starting-new choice",
  );
});
