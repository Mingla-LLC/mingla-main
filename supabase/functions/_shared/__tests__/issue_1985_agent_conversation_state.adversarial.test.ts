import {
  assert,
  assertEquals,
  assertMatch,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyStoredChoice,
  planEventTurn,
} from "../agentConversationPlanner.ts";
import { IDLE_TASK_STATE, TaskStateError } from "../agentConversationState.ts";
import {
  chooseEffectiveTimezone,
  resolveRelativeTime,
} from "../agentRelativeTime.ts";

const BRAND = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "Mingla Nigeria",
};

function context(now: Date, questionId: string) {
  return {
    now,
    timezone: "Africa/Lagos",
    locale: "en-US",
    activeBrand: BRAND,
    originMessageId: "00000000-0000-4000-8000-000000000102",
    taskId: "00000000-0000-4000-8000-000000000103",
    questionId,
  };
}

Deno.test("#1985 T-1 exact production brief yields value choices and no affirmative loop", () => {
  const planned = planEventTurn(
    IDLE_TASK_STATE,
    "Create an event with acrobats, food, music and jollof rice at the end of this month",
    context(new Date("2026-08-13T16:00:00.000Z"), "question-production"),
  );

  assertMatch(planned.text, /Mingla Nigeria/);
  assertMatch(planned.text, /acrobat/i);
  assertMatch(planned.text, /jollof/i);
  assertMatch(planned.text, /music/i);
  assert(planned.choices && planned.choices.options.length > 0);
  assertEquals(planned.choices.required_slot_keys, ["start_at", "timezone"]);
  for (const option of planned.choices.options) {
    assertEquals(option.payload.type, "slot_patch");
    assert(!/^(?:yes|continue|do it|go ahead|proceed)\b/i.test(option.label));
  }
});

Deno.test("#1985 T-2 a forged multi-option answer to a single-choice question fails closed", () => {
  const now = new Date("2026-08-13T16:00:00.000Z");
  const planned = planEventTurn(
    IDLE_TASK_STATE,
    "Create an event with music at the end of the month",
    context(now, "question-single"),
  );
  assert(planned.choices && planned.choices.options.length >= 2);
  assertEquals(planned.state.pending_question?.mode, "single");

  const error = assertThrows(
    () =>
      applyStoredChoice({
        state: planned.state,
        choices: planned.choices!,
        optionIds: planned.choices!.options.slice(0, 2).map((option) =>
          option.id
        ),
        context: context(now, "question-next"),
      }),
    TaskStateError,
  );
  assertEquals(error.code, "CHOICE_STALE");
});

Deno.test("#1985 T-5 passed this-Friday is reported as past before next Friday is offered", () => {
  const resolved = resolveRelativeTime("this Friday at 7pm", {
    // Saturday noon in New York: the Friday in the current local week passed.
    now: new Date("2026-08-15T16:00:00.000Z"),
    timezone: "America/New_York",
    locale: "en-US",
  });

  assertEquals(resolved.invalidReason, "past");
  assertEquals(resolved.temporal, null);
  assert(resolved.choices.length > 0);
  assertEquals(resolved.choices[0].temporal.local_date, "2026-08-21");
});

Deno.test("#1985 T-6 a Nigerian brand name never supplies a timezone", () => {
  assertEquals(
    chooseEffectiveTimezone({ requestText: "Plan this for Mingla Nigeria" }),
    null,
  );
});
