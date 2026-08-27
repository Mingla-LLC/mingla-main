// Issue #1985 — deterministic model-to-state adapter for the reference
// create_event journey. The planner proposes classifications and slot deltas;
// agentConversationState validates and owns every persisted transition.

import {
  AgentChoiceOptionV2,
  AgentChoicesV2,
  assertAgentChoicesV2,
} from "./agentChoices.ts";
import {
  applySlotUpdates,
  assertCreateEventProposal,
  assertCreateRsvpProposal,
  cancelActiveTask,
  createEventTaskState,
  EventBrief,
  IDLE_TASK_STATE,
  missingSlot,
  PendingQuestionV1,
  proposedSlot,
  resolvedSlot,
  setPendingQuestion,
  TaskSlot,
  TaskStateError,
  TaskStateV1,
} from "./agentConversationState.ts";
import {
  DateTimeChoice,
  isValidIanaTimezone,
  resolveRelativeTime,
  TemporalSlotValue,
} from "./agentRelativeTime.ts";

export type PlannerClassification =
  | "event_plan_start"
  | "event_plan_continue"
  | "event_plan_cancel"
  | "read_interruption"
  | "question_interruption"
  | "general";

export interface PlannerContext {
  now: Date;
  timezone: string | null;
  locale?: string;
  activeBrand: { id: string; name: string };
  originMessageId: string;
  taskId: string;
  questionId: string;
}

export interface PlannerResult {
  classification: PlannerClassification;
  state: TaskStateV1;
  text: string;
  choices?: AgentChoicesV2;
  proposal?: {
    tool_name: "create_event" | "create_rsvp";
    tool_args: Record<string, unknown>;
  };
  handoffRoute?: string;
}

export function isCreateEventPlanningRequest(text: string): boolean {
  return /\b(?:create|make|set up|setup|schedule|host|plan|start)\b[\s\S]{0,80}\b(?:event|gathering|party|show)\b/i
    .test(text) ||
    /\b(?:event|gathering|party|show)\b[\s\S]{0,80}\b(?:create|make|set up|setup|schedule|host|plan|start)\b/i
      .test(text);
}

export function isCreateRsvpPlanningRequest(text: string): boolean {
  return /\b(?:create|make|set up|setup|schedule|host|plan|start)\b[\s\S]{0,80}\b(?:rsvp|guest[- ]?list event)\b/i
    .test(text) ||
    /\b(?:rsvp|guest[- ]?list event)\b[\s\S]{0,80}\b(?:create|make|set up|setup|schedule|host|plan|start)\b/i
      .test(text);
}

function isCreateOfferingPlanningRequest(text: string): boolean {
  return isCreateRsvpPlanningRequest(text) ||
    isCreateEventPlanningRequest(text);
}

export function isExplicitReplacementTaskRequest(text: string): boolean {
  return isCreateOfferingPlanningRequest(text) &&
    /\b(?:another|new|different|second)\b[\s\S]{0,80}\b(?:event|gathering|party|show|rsvp)\b/i
      .test(text);
}

export function isReadInterruption(text: string): boolean {
  return /\b(?:how many|list|show|what are|which)\b[\s\S]{0,50}\b(?:brands?|events?|sales|orders|guests?)\b/i
    .test(text);
}

export function isCancelTaskRequest(text: string): boolean {
  return /^(?:cancel|abandon|discard|stop)(?:\s+(?:this|the))?(?:\s+(?:plan|event plan|task))?[.!]?$/i
    .test(text.trim());
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    8,
  );
}

export function extractEventBrief(text: string): EventBrief {
  const lower = text.toLowerCase();
  const concepts: string[] = [];
  const food: string[] = [];
  const music: string[] = [];
  const experience: string[] = [];
  if (/\bfood\b/.test(lower)) concepts.push("food");
  if (/\bmusic\b/.test(lower)) concepts.push("music");
  if (/\bjollof(?:\s+rice)?\b/.test(lower)) {
    food.push(text.match(/\bjollof(?:\s+rice)?\b/i)?.[0] ?? "jollof");
  }
  if (/\bacrobat(?:s|ics)?\b/.test(lower)) {
    experience.push(text.match(/\bacrobat(?:s|ics)?\b/i)?.[0] ?? "acrobatics");
  }
  for (
    const match of text.matchAll(
      /\b(?:live music|dj|band|jazz|afrobeats|highlife|hip[- ]hop|r&b)\b/gi,
    )
  ) {
    music.push(match[0]);
  }
  return {
    concepts: unique(concepts),
    food: unique(food),
    music: unique(music),
    experience: unique(experience),
    notes: [],
  };
}

function extractTitle(text: string): string | undefined {
  const explicit = text.match(
    /\b(?:called|named|title(?:d)?)\s+["“']?([^"”'.,!?]{3,80})/i,
  )?.[1]?.trim();
  if (explicit) return explicit.slice(0, 80);
  const quoted = text.match(/["“]([^"”]{3,80})["”]/)?.[1]?.trim();
  return quoted ? quoted.slice(0, 80) : undefined;
}

function suggestedTitles(brief: EventBrief): string[] {
  const hasJollof = brief.food.some((item) => /jollof/i.test(item));
  const hasAcrobat = brief.experience.some((item) => /acrobat/i.test(item));
  const hasMusic = brief.concepts.includes("music") || brief.music.length > 0;
  const titles: string[] = [];
  if (hasJollof && hasMusic && hasAcrobat) {
    titles.push("Jollof, Music & Acrobatics");
  }
  if (hasJollof && hasMusic) titles.push("Jollof & Live Music Night");
  if (hasAcrobat && hasMusic) titles.push("Acrobatics After Dark");
  titles.push("End-of-Month Food & Music Night");
  return unique(titles).slice(0, 3);
}

function usefulBrief(brandName: string, brief: EventBrief): string {
  const supplied: string[] = [];
  supplied.push(...brief.experience);
  supplied.push(...brief.food);
  if (brief.concepts.includes("food") && brief.food.length === 0) {
    supplied.push("food");
  }
  if (brief.concepts.includes("music") || brief.music.length > 0) {
    supplied.push("music");
  }
  const direction = supplied.length > 0
    ? supplied.join(", ")
    : "the event direction you shared";
  const optionalIdeas: string[] = [];
  if (brief.experience.some((item) => /acrobat/i.test(item))) {
    optionalIdeas.push("a performance arc that builds toward the acrobat set");
  }
  if (brief.food.length > 0) {
    optionalIdeas.push(
      "a tasting-style food moment around the dishes you named",
    );
  }
  if (brief.concepts.includes("music") || brief.music.length > 0) {
    optionalIdeas.push("music that progresses with the evening");
  }
  const suggestion = optionalIdeas.length > 0
    ? ` Optional ideas: ${optionalIdeas.slice(0, 3).join("; ")}.`
    : "";
  return `For ${brandName}, I’ve kept ${direction}.${suggestion}`;
}

function dateChoices(
  questionId: string,
  choices: DateTimeChoice[],
): AgentChoicesV2 {
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: questionId,
    kind: "clarifying",
    prompt: "Which date and time should I use?",
    required_slot_keys: ["start_at", "timezone"],
    options: choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      payload: {
        type: "slot_patch",
        slot_updates: {
          start_at: choice.temporal,
          timezone: choice.temporal.timezone,
        },
      },
    })),
  });
}

function timezoneQuestion(questionId: string): AgentChoicesV2 {
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: questionId,
    kind: "clarifying",
    prompt: "Which timezone should I use for this event?",
    required_slot_keys: ["timezone"],
    options: [],
  });
}

function titleQuestion(questionId: string, brief: EventBrief): AgentChoicesV2 {
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: questionId,
    kind: "clarifying",
    prompt: "Which title should I use?",
    required_slot_keys: ["title"],
    options: suggestedTitles(brief).map((title, index) => ({
      id: `title_${index + 1}`,
      label: title,
      payload: { type: "slot_patch", slot_updates: { title } },
    })),
  });
}

function pendingQuestion(choices: AgentChoicesV2): PendingQuestionV1 {
  return {
    question_id: choices.question_id,
    required_slot_keys: choices.required_slot_keys,
    mode: choices.options.length === 0
      ? "free_text"
      : choices.kind === "multi_select"
      ? "multi"
      : "single",
    option_ids: choices.options.map((option) => option.id),
  };
}

function replacementTaskQuestion(
  questionId: string,
  replacementRequest: string,
): AgentChoicesV2 {
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: questionId,
    kind: "next_step",
    prompt: "Pause this event plan and start the new one?",
    required_slot_keys: [],
    options: [
      {
        id: "pause_and_start_new",
        label: "Pause this plan and start the new event",
        payload: {
          type: "task_command",
          command: "pause",
          replacement_request: replacementRequest,
        },
      },
      {
        id: "keep_current_plan",
        label: "Keep this event plan",
        payload: { type: "task_command", command: "continue_planning" },
      },
    ],
  });
}

function temporalSlots(
  temporal: TemporalSlotValue,
  nowIso: string,
): Record<string, TaskSlot> {
  if (!temporal.resolved_iso || !temporal.timezone) {
    return {
      start_at: proposedSlot(
        temporal,
        temporal.source === "choice" ? "choice" : "user",
        temporal.original_text,
      ),
      ...(temporal.timezone
        ? {
          timezone: resolvedSlot(
            temporal.timezone,
            temporal.source === "choice" ? "choice" : "user",
            nowIso,
          ),
        }
        : {}),
    };
  }
  return {
    start_at: resolvedSlot(
      temporal.resolved_iso,
      temporal.source === "choice" ? "choice" : "user",
      nowIso,
      temporal.original_text,
    ),
    timezone: resolvedSlot(
      temporal.timezone,
      temporal.source === "choice" ? "choice" : "user",
      nowIso,
    ),
  };
}

function proposalText(state: TaskStateV1, brandName: string): string {
  if (!state.active_task) {
    throw new TaskStateError("TASK_STATE_INVALID", "Missing active task");
  }
  const title = String(state.active_task.slots.title.value);
  const startAt = String(state.active_task.slots.start_at.value);
  const timezone = String(state.active_task.slots.timezone.value);
  const display = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(startAt));
  const kind = state.active_task.intent === "create_rsvp" ? "RSVP" : "event";
  return `Ready to create “${title}” as a draft ${kind} for ${brandName} on ${display}. The draft will write the brand, title, and start time; your creative ideas stay in this plan for later refinement.`;
}

function finalizeResult(
  classification: PlannerClassification,
  state: TaskStateV1,
  text: string,
  context: PlannerContext,
  choices?: AgentChoicesV2,
): PlannerResult {
  if (state.status === "ready_to_propose") {
    const isRsvp = state.active_task?.intent === "create_rsvp";
    return {
      classification,
      state,
      text: proposalText(state, context.activeBrand.name),
      proposal: {
        tool_name: isRsvp ? "create_rsvp" : "create_event",
        tool_args: isRsvp
          ? assertCreateRsvpProposal(state)
          : assertCreateEventProposal(state),
      },
    };
  }
  return { classification, state, text, ...(choices ? { choices } : {}) };
}

function incorporateTime(
  state: TaskStateV1,
  userText: string,
  context: PlannerContext,
): { state: TaskStateV1; choices?: AgentChoicesV2; text?: string } {
  const resolution = resolveRelativeTime(userText, {
    now: context.now,
    timezone: context.timezone,
    locale: context.locale,
  });
  if (resolution.needsTimezone) {
    const choices = timezoneQuestion(context.questionId);
    return {
      state: setPendingQuestion(state, pendingQuestion(choices)),
      choices,
      text: choices.prompt,
    };
  }
  if (resolution.temporal?.resolved_iso) {
    return {
      state: applySlotUpdates(
        state,
        temporalSlots(resolution.temporal, context.now.toISOString()),
        null,
      ),
    };
  }
  if (resolution.choices.length > 0) {
    const choices = dateChoices(context.questionId, resolution.choices);
    const updates = resolution.temporal
      ? temporalSlots(resolution.temporal, context.now.toISOString())
      : {};
    return {
      state: applySlotUpdates(state, updates, pendingQuestion(choices)),
      choices,
      text: resolution.invalidReason === "nonexistent_local_time"
        ? `That local time doesn’t exist because the clock changes then. ${choices.prompt}`
        : resolution.invalidReason === "past"
        ? `That day has already passed this week. I can offer the next occurrence instead. ${choices.prompt}`
        : choices.prompt,
    };
  }
  if (resolution.invalidReason === "past") {
    return {
      state,
      text:
        "That time has already passed. What future date and time should I use?",
    };
  }
  return { state };
}

export function planEventTurn(
  current: TaskStateV1,
  userText: string,
  context: PlannerContext,
): PlannerResult {
  if (isCancelTaskRequest(userText) && current.active_task) {
    return {
      classification: "event_plan_cancel",
      state: cancelActiveTask(current, context.now.toISOString()),
      text: "Cancelled this event plan. Nothing was created.",
    };
  }

  if (
    ["create_event", "create_rsvp"].includes(
      current.active_task?.intent ?? "",
    ) &&
    !["completed", "cancelled"].includes(current.status) &&
    isExplicitReplacementTaskRequest(userText)
  ) {
    const choices = replacementTaskQuestion(context.questionId, userText);
    return {
      classification: "event_plan_continue",
      state: {
        ...current,
        pending_question: pendingQuestion(choices),
      },
      text: choices.prompt,
      choices,
    };
  }

  let state = current;
  let classification: PlannerClassification = "event_plan_continue";
  let intro = "I’ve updated the event plan.";
  if (!state.active_task) {
    if (!isCreateOfferingPlanningRequest(userText)) {
      return { classification: "general", state, text: "" };
    }
    classification = "event_plan_start";
    const brief = extractEventBrief(userText);
    state = createEventTaskState({
      taskId: context.taskId,
      brandId: context.activeBrand.id,
      originMessageId: context.originMessageId,
      nowIso: context.now.toISOString(),
      brief,
      title: extractTitle(userText),
      intent: isCreateRsvpPlanningRequest(userText)
        ? "create_rsvp"
        : "create_event",
    });
    intro = usefulBrief(context.activeBrand.name, brief);
  }
  if (
    !state.active_task ||
    !["create_event", "create_rsvp"].includes(state.active_task.intent)
  ) {
    return { classification: "general", state, text: "" };
  }

  const title = extractTitle(userText);
  if (title) {
    state = applySlotUpdates(state, {
      title: resolvedSlot(title, "user", context.now.toISOString(), title),
    }, state.pending_question);
  }
  const time = incorporateTime(state, userText, context);
  state = time.state;
  if (time.choices) {
    return finalizeResult(
      classification,
      state,
      `${intro} ${time.text ?? time.choices.prompt}`.trim(),
      context,
      time.choices,
    );
  }
  if (time.text) {
    return finalizeResult(
      classification,
      state,
      `${intro} ${time.text}`.trim(),
      context,
    );
  }

  const activeTask = state.active_task;
  if (!activeTask) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "Event plan lost its active task",
    );
  }
  if (activeTask.slots.start_at.status !== "resolved") {
    const choices =
      activeTask.slots.timezone.status !== "resolved" && !context.timezone
        ? timezoneQuestion(context.questionId)
        : assertAgentChoicesV2({
          schema_version: 2,
          question_id: context.questionId,
          kind: "clarifying",
          prompt: "What future date and time should I use?",
          required_slot_keys: ["start_at"],
          options: [],
        });
    state = setPendingQuestion(state, pendingQuestion(choices));
    return finalizeResult(
      classification,
      state,
      `${intro} ${choices.prompt}`.trim(),
      context,
      choices,
    );
  }

  if (activeTask.slots.title.status !== "resolved") {
    const choices = titleQuestion(context.questionId, activeTask.brief);
    state = setPendingQuestion(state, pendingQuestion(choices));
    return finalizeResult(
      classification,
      state,
      `${intro} ${choices.prompt}`.trim(),
      context,
      choices,
    );
  }
  return finalizeResult(classification, state, intro, context);
}

export function applyStoredChoice(args: {
  state: TaskStateV1;
  choices: AgentChoicesV2;
  optionIds: string[];
  freeText?: string;
  context: PlannerContext;
}): PlannerResult {
  const { state, choices, optionIds, freeText, context } = args;
  if (
    !state.pending_question ||
    state.pending_question.question_id !== choices.question_id
  ) {
    throw new TaskStateError("CHOICE_STALE", "That choice is no longer active");
  }
  const mode = state.pending_question.mode;
  const hasFreeText = typeof freeText === "string" &&
    freeText.trim().length > 0;
  const hasDuplicateOptionIds = new Set(optionIds).size !== optionIds.length;
  const invalidCardinality = hasDuplicateOptionIds ||
    (mode === "single" && (optionIds.length !== 1 || hasFreeText)) ||
    (mode === "multi" && (optionIds.length === 0 || hasFreeText)) ||
    (mode === "free_text" && (optionIds.length !== 0 || !hasFreeText));
  if (invalidCardinality) {
    throw new TaskStateError(
      "CHOICE_STALE",
      "That answer does not match the active question",
    );
  }
  const allowed = new Map(choices.options.map((option) => [option.id, option]));
  const selected: AgentChoiceOptionV2[] = [];
  for (const id of optionIds) {
    const option = allowed.get(id);
    if (!option) {
      throw new TaskStateError(
        "CHOICE_STALE",
        "That choice is no longer active",
      );
    }
    selected.push(option);
  }
  let next = state;
  let handoffRoute: string | undefined;
  let replacementRequest: string | undefined;
  let continuePlanning = false;
  const updates: Record<string, TaskSlot> = {};
  for (const option of selected) {
    if (option.payload.type === "slot_patch") {
      for (const [key, value] of Object.entries(option.payload.slot_updates)) {
        if (key === "start_at") {
          if (!value || typeof value !== "object") {
            throw new TaskStateError(
              "CHOICE_STALE",
              "Stored time choice is invalid",
            );
          }
          const temporal = value as TemporalSlotValue;
          if (
            !temporal.resolved_iso || !temporal.timezone ||
            new Date(temporal.resolved_iso).getTime() <= context.now.getTime()
          ) {
            throw new TaskStateError(
              "CHOICE_STALE",
              "Stored time choice is no longer valid",
            );
          }
          Object.assign(
            updates,
            temporalSlots(temporal, context.now.toISOString()),
          );
        } else if (key === "timezone") {
          if (!isValidIanaTimezone(value)) {
            throw new TaskStateError(
              "CHOICE_STALE",
              "Stored timezone is invalid",
            );
          }
          updates.timezone = resolvedSlot(
            value,
            "choice",
            context.now.toISOString(),
          );
        } else if (key === "title") {
          if (typeof value !== "string" || value.trim().length === 0) {
            throw new TaskStateError("CHOICE_STALE", "Stored title is invalid");
          }
          updates.title = resolvedSlot(
            value.trim(),
            "choice",
            context.now.toISOString(),
          );
        } else {
          throw new TaskStateError(
            "CHOICE_STALE",
            "Stored choice updates an unsupported slot",
          );
        }
      }
    } else if (option.payload.type === "handoff") {
      handoffRoute = option.payload.route;
    } else if (option.payload.command === "cancel") {
      next = cancelActiveTask(next, context.now.toISOString());
    } else if (
      (option.payload.command === "pause" ||
        option.payload.command === "start_new") &&
      option.payload.replacement_request
    ) {
      replacementRequest = option.payload.replacement_request;
    } else if (option.payload.command === "start_new") {
      replacementRequest = "";
    } else if (option.payload.command === "continue_planning") {
      continuePlanning = true;
    }
  }
  if (Object.keys(updates).length > 0) {
    next = applySlotUpdates(next, updates, null);
  }

  if (freeText) {
    const required = state.pending_question.required_slot_keys;
    if (required.includes("timezone")) {
      const timezone = freeText.trim();
      if (!isValidIanaTimezone(timezone)) {
        throw new TaskStateError(
          "TIMEZONE_REQUIRED",
          "Enter a valid timezone such as Africa/Lagos",
        );
      }
      context.timezone = timezone;
      next = applySlotUpdates(next, {
        timezone: resolvedSlot(
          timezone,
          "user",
          context.now.toISOString(),
          freeText,
        ),
      }, null);
    } else if (required.includes("title")) {
      next = applySlotUpdates(next, {
        title: resolvedSlot(
          freeText.trim(),
          "user",
          context.now.toISOString(),
          freeText,
        ),
      }, null);
    } else if (required.includes("start_at")) {
      const parsed = incorporateTime(next, freeText, context);
      next = parsed.state;
      if (parsed.choices) {
        return finalizeResult(
          "event_plan_continue",
          next,
          parsed.text ?? parsed.choices.prompt,
          context,
          parsed.choices,
        );
      }
      if (parsed.text) {
        return finalizeResult(
          "event_plan_continue",
          next,
          parsed.text,
          context,
        );
      }
    } else {
      throw new TaskStateError(
        "CHOICE_STALE",
        "Free text is not valid for this question",
      );
    }
  }

  if (handoffRoute) {
    return {
      classification: "event_plan_continue",
      state: { ...next, pending_question: null },
      text: "Opening the event workspace.",
      handoffRoute,
    };
  }
  if (replacementRequest !== undefined) {
    if (replacementRequest.length > 0) {
      return planEventTurn(
        { ...IDLE_TASK_STATE, last_completed_step: next.last_completed_step },
        replacementRequest,
        {
          ...context,
          taskId: `${context.taskId}_replacement`,
          questionId: `${context.questionId}_replacement`,
        },
      );
    }
    return {
      classification: "event_plan_continue",
      state: {
        ...IDLE_TASK_STATE,
        last_completed_step: next.last_completed_step,
      },
      text:
        "Tell me the direction, date, and time for the next event. I’ll build the plan from there.",
    };
  }
  if (continuePlanning) {
    next = { ...next, pending_question: null };
    if (next.status === "awaiting_confirmation") {
      return {
        classification: "event_plan_continue",
        state: next,
        text:
          "Keeping the current event proposal. Review it when you're ready.",
      };
    }
  }
  return planEventTurn(next, "", {
    ...context,
    questionId: `${context.questionId}_next`,
  });
}
