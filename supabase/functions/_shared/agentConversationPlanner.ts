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
  MAX_STATE_STRING,
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
  extractExplicitTimezone,
  isValidIanaTimezone,
  resolveRelativeTime,
  TemporalSlotValue,
} from "./agentRelativeTime.ts";
import {
  extractEventTitle,
  formatEventStart,
  parseEventEnd,
  zoneWords,
} from "./ariFlows/offerings/eventFacts.ts";

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
  const actionToListing =
    /\b(?:create|make|set up|setup|schedule|host|plan|start)\b[\s\S]{0,80}\b(?:event|gathering|party)\b(?!\s+flyer\b)/i
      .test(text);
  // “Show me the steps” uses show as a verb. Only treat show as an offering
  // noun when the phrase itself is noun-shaped (plan a show, create our show,
  // etc.). This avoids routing ordinary “show me a business plan” requests
  // into the event intake state machine.
  const actionToShow =
    /\b(?:create|make|set up|setup|schedule|host|plan|start)\b[\s\S]{0,80}\b(?:(?:a|an|the|my|our|this)\s+show|show\s+(?:for|at|on|with|called|named))\b/i
      .test(text);
  return actionToListing || actionToShow ||
    // "Show me a plan" is a general planning request, not a request to create
    // an entertainment show. Keep the ambiguous noun out of the reverse form;
    // explicit "plan a show" still matches the forward form above.
    /\b(?:event|gathering|party)\b(?!\s+flyer\b)[\s\S]{0,80}\b(?:create|make|set up|setup|schedule|host|plan|start)\b/i
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
    .test(text) ||
    /\b(?:read back|check|verify|confirm)\b[\s\S]{0,50}\b(?:saved|created|draft|event)\b/i
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
  if (/\bprivate\b/.test(lower)) concepts.push("private");
  else if (/\bunlisted\b/.test(lower)) concepts.push("unlisted");
  else if (/\bpublic\b/.test(lower)) concepts.push("public");
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

function extractEventLocation(text: string): string | undefined {
  const match = text.match(
    /\b(?:at|venue(?:\s+(?:is|at))?|location(?:\s+(?:is|at))?)\s+(?!\d)([^.!?;\n]{3,160})/i,
  );
  const value = match?.[1]?.trim().replace(/\s+/g, " ");
  if (!value) return undefined;
  if (/^the end of (?:the )?month\b/i.test(value)) return undefined;
  const cleaned = value.replace(
    /\s+(?:make it|keep it|use copy|write copy|with a capacity)\b[\s\S]*$/i,
    "",
  ).replace(/[,.\s]+$/, "").trim();
  return cleaned.length >= 3 ? cleaned.slice(0, 160) : undefined;
}

function requestsGroundedEventCopy(text: string): boolean {
  return /\b(?:event\s+copy|description|promotional\s+text|event\s+text)\b/i
    .test(text);
}

function localDateOf(instantIso: string, timezone: string): string | null {
  const date = new Date(instantIso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function localClockMinutes(
  instantIso: string,
  timezone: string,
): number | null {
  const date = new Date(instantIso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isInteger(hour) && Number.isInteger(minute)
    ? hour * 60 + minute
    : null;
}

function extractEventEndAt(
  text: string,
  startAt: string,
  timezone: string,
  now: Date,
): string | undefined {
  const time = String
    .raw`(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?`;
  const range = new RegExp(
    String
      .raw`\b(?:from\s+)?(${time})\s*(?:to|until|through|[–—-])\s*(${time})\b`,
    "i",
  ).exec(text);
  const endClock = range?.[2]?.trim();
  if (!endClock) return undefined;
  const date = localDateOf(startAt, timezone);
  if (!date) return undefined;
  const startMinutes = localClockMinutes(startAt, timezone);
  let endResult = resolveRelativeTime(`${date} ${endClock}`, {
    now,
    timezone,
  });
  if (!endResult.temporal?.resolved_iso) return undefined;
  let endAt = endResult.temporal.resolved_iso;
  const endMinutes = localClockMinutes(endAt, timezone);
  if (
    startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes
  ) {
    const [year, month, day] = date.split("-").map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1))
      .toISOString().slice(0, 10);
    endResult = resolveRelativeTime(`${nextDate} ${endClock}`, {
      now,
      timezone,
    });
    if (!endResult.temporal?.resolved_iso) return undefined;
    endAt = endResult.temporal.resolved_iso;
  }
  return endAt;
}

/**
 * A shared meridiem belongs to both sides of a clock range: 6–9 PM means
 * 6 PM–9 PM. The relative-time parser treats the first bare hour as its own
 * time, so make that convention explicit before resolving the event start.
 */
function expandSharedMeridiemRange(text: string): string {
  const clock = String
    .raw`(?:[01]?\d|2[0-3])(?::[0-5]\d)?`;
  const meridiem = String.raw`(?:a\.?m\.?|p\.?m\.?)`;
  const range = new RegExp(
    String
      .raw`\b((?:from\s+)?(${clock})\s*)(?:to|until|through|[–—-])\s*(${clock})\s*(${meridiem})\b`,
    "i",
  );
  return text.replace(
    range,
    (
      _match,
      prefix: string,
      startClock: string,
      endClock: string,
      suffix: string,
    ) => {
      const startHasMeridiem = new RegExp(`${meridiem}$`, "i").test(prefix);
      return `${
        startHasMeridiem ? prefix : `${prefix}${suffix}`
      }–${endClock} ${suffix}`;
    },
  );
}

// #3355 P7 (D-19): one title reader for the planner and the flow engine —
// curly quotes removed, apostrophes and "Vol. 2" kept.
function extractTitle(
  text: string,
  activeBrandName?: string,
): string | undefined {
  return extractEventTitle(text, activeBrandName);
}

function extractGuestCapacity(text: string): number | undefined {
  const raw = text.match(
    /\b(?:for(?:\s+exactly|\s+up\s+to)?|capacity(?:\s+of)?|limit(?:ed)?\s+to)\s+(\d{1,5})\s+(?:guests?|people|attendees?|spots?)\b/i,
  )?.[1];
  if (!raw) return undefined;
  const capacity = Number(raw);
  return Number.isInteger(capacity) && capacity > 0 && capacity <= 5000
    ? capacity
    : undefined;
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
  const dates = [
    ...new Set(choices.map((choice) => choice.temporal.local_date)),
  ];
  const onlyDate = dates.length === 1 ? dates[0] : null;
  const prompt = onlyDate
    ? `I have ${
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${onlyDate}T12:00:00.000Z`))
    } from your message. What time should I use? I’ll confirm the full date and time before creating the draft.`
    : "Which date and time should I use?";
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: questionId,
    kind: "clarifying",
    prompt,
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

function endTimeQuestion(
  questionId: string,
  startAt: string,
  timezone: string,
): AgentChoicesV2 {
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: questionId,
    kind: "clarifying",
    prompt: `When does it end? It starts ${
      formatEventStart(startAt, timezone)
    } (${zoneWords(timezone)}). Tell me the end time, for example 10:30pm.`,
    required_slot_keys: ["end_at"],
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
  const displayDateTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startAt));
  const zoneLabel = timezone === "Africa/Lagos"
    ? "WAT"
    : new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date(startAt)).find((part) =>
      part.type === "timeZoneName"
    )?.value ?? timezone;
  const display = `${displayDateTime} ${zoneLabel}`;
  const kind = state.active_task.intent === "create_rsvp" ? "RSVP" : "event";
  // #3355 P7 (D-23): no implicit ticket tier, so nothing to announce.
  const admission = "";
  const slots = state.active_task.slots;
  const endAt = slots.end_at?.status === "resolved" &&
      typeof slots.end_at.value === "string"
    ? slots.end_at.value
    : null;
  const endDisplay = endAt
    ? `${
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(endAt))
    } ${zoneLabel}`
    : null;
  const schedule = endDisplay ? ` through ${endDisplay}` : "";
  const location = slots.location_text?.status === "resolved" &&
      typeof slots.location_text.value === "string"
    ? ` at ${slots.location_text.value}`
    : "";
  const copy = slots.description_requested?.status === "resolved" &&
      slots.description_requested.value === true
    ? " I’ve prepared concise event copy using only the details you gave."
    : "";
  return `Ready to create “${title}” as a draft ${kind} for ${brandName}${location} on ${display}${schedule}.${admission}${copy} It’ll be an unpublished draft — nobody can see it until you publish. Should I create this draft?`;
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
  const storedTimezone = state.active_task?.slots.timezone?.value;
  const timeContext = {
    now: context.now,
    timezone: extractExplicitTimezone(userText) ??
      (isValidIanaTimezone(storedTimezone) ? storedTimezone : context.timezone),
    locale: context.locale,
  };
  let resolution = resolveRelativeTime(
    expandSharedMeridiemRange(userText),
    timeContext,
  );
  // A follow-up such as "18:00" answers a missing-time question when the host
  // already supplied a concrete date. Reuse that exact full-year date only
  // when the current text has a time and either no date or a matching yearless
  // restatement. A yearless date never becomes the source of truth.
  const priorStartValue = state.active_task?.slots.start_at.value;
  const priorDate = priorStartValue !== null &&
      typeof priorStartValue === "object" &&
      typeof (priorStartValue as { local_date?: unknown }).local_date ===
        "string"
    ? (priorStartValue as { local_date: string }).local_date
    : null;
  const yearlessCandidate = state.active_task?.slots.start_at.status ===
        "proposed" &&
      priorStartValue !== null &&
      typeof priorStartValue === "object" &&
      typeof (priorStartValue as { yearless_date?: unknown }).yearless_date ===
        "string"
    ? priorStartValue as {
      yearless_date: string;
      original_text: string;
    }
    : null;
  const suppliedYear = yearAnswer(userText);
  if (yearlessCandidate && suppliedYear) {
    resolution = resolveRelativeTime(
      `${yearlessCandidate.yearless_date}, ${suppliedYear} ${yearlessCandidate.original_text}`,
      timeContext,
    );
  }
  const suppliesTime = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(userText) ||
    /\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/i.test(userText);
  const mentionsDate =
    /\b(?:today|tomorrow|next|this|weekend|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
      .test(userText) ||
    /\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i
      .test(userText);
  const repeatsStoredDateWithoutYear = priorDate !== null &&
    !/\b20\d{2}\b/.test(userText) &&
    matchesStoredMonthDay(userText, priorDate);
  if (
    !resolution.temporal && resolution.choices.length === 0 && suppliesTime &&
    (!mentionsDate || repeatsStoredDateWithoutYear) && priorDate &&
    state.pending_question?.required_slot_keys.includes("start_at")
  ) {
    resolution = resolveRelativeTime(`${priorDate} ${userText}`, timeContext);
  }
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

/**
 * A year clarification can include a small instruction in the same reply
 * (for example, "Use 2026. Keep it as a draft."). Accept one unambiguous
 * year plus lightweight acknowledgement/draft wording; never choose between
 * multiple years or consume a reply that contains unrelated details.
 */
function yearAnswer(text: string): string | undefined {
  const matches = [...text.matchAll(/\b(20\d{2})\b/g)];
  if (matches.length !== 1) return undefined;
  const remainder = text.replace(/\b20\d{2}\b/, " ")
    .replace(
      /\b(?:please|use|in|the|year|keep|it|as|a|draft|leave|this|that|still|just|and|make|remain|do|let'?s)\b/gi,
      " ",
    )
    .replace(/[\s,.;!?-]+/g, "")
    .trim();
  return remainder ? undefined : matches[0][1];
}

/** A yearless restatement is only a match against an already-known full date. */
function matchesStoredMonthDay(text: string, isoDate: string): boolean {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!date) return false;
  const month = Number(date[2]);
  const day = Number(date[3]);
  const monthPattern =
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const monthFirst = [...text.matchAll(
    new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"),
  )];
  const dayFirst = [...text.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\b`, "gi"),
  )];
  const matches = [
    ...monthFirst.map((match) => ({
      month: MONTH_INDEX[match[1].slice(0, 3).toLowerCase()],
      day: Number(match[2]),
    })),
    ...dayFirst.map((match) => ({
      month: MONTH_INDEX[match[2].slice(0, 3).toLowerCase()],
      day: Number(match[1]),
    })),
  ];
  return matches.length === 1 && matches[0].month === month &&
    matches[0].day === day;
}

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function yearlessCalendarDate(text: string): string | null {
  const monthPattern =
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const monthFirst = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  ).exec(text);
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\b`,
    "i",
  ).exec(text);
  const match = monthFirst ?? dayFirst;
  if (!match || /\b20\d{2}\b/.test(text)) return null;
  const monthName = (monthFirst ? match[1] : match[2]).slice(0, 3)
    .toLowerCase();
  const day = Number(monthFirst ? match[2] : match[1]);
  const month = MONTH_INDEX[monthName];
  if (!month || day < 1 || day > 31) return null;
  const names = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${names[month]} ${day}`;
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
      title: extractTitle(userText, context.activeBrand.name),
      intent: isCreateRsvpPlanningRequest(userText)
        ? "create_rsvp"
        : "create_event",
      capacity: extractGuestCapacity(userText),
      locationText: extractEventLocation(userText),
      copyRequested: requestsGroundedEventCopy(userText),
    });
    intro = usefulBrief(context.activeBrand.name, brief);
  }
  if (
    !state.active_task ||
    !["create_event", "create_rsvp"].includes(state.active_task.intent)
  ) {
    return { classification: "general", state, text: "" };
  }

  const title = extractTitle(userText, context.activeBrand.name);
  if (title) {
    state = applySlotUpdates(state, {
      title: resolvedSlot(title, "user", context.now.toISOString(), title),
    }, state.pending_question);
  }
  const capacity = extractGuestCapacity(userText);
  if (capacity && state.active_task?.intent === "create_event") {
    state = applySlotUpdates(state, {
      capacity: resolvedSlot(
        capacity,
        "user",
        context.now.toISOString(),
        `${capacity} guests`,
      ),
    }, state.pending_question);
  }
  const time = incorporateTime(state, userText, context);
  state = time.state;
  if (state.active_task?.intent === "create_event") {
    const updates: Record<string, ReturnType<typeof resolvedSlot>> = {};
    const locationText = extractEventLocation(userText);
    if (locationText) {
      updates.location_text = resolvedSlot(
        locationText,
        "user",
        context.now.toISOString(),
        locationText,
      );
    }
    if (requestsGroundedEventCopy(userText)) {
      updates.description_requested = resolvedSlot(
        true,
        "user",
        context.now.toISOString(),
      );
    }
    const startAt = state.active_task.slots.start_at;
    const timezone = state.active_task.slots.timezone.value;
    if (
      startAt.status === "resolved" && typeof startAt.value === "string" &&
      isValidIanaTimezone(timezone)
    ) {
      // #3355 P7 (D-23): the owner's answer to "When does it end?" may be a
      // lone time ("10:30pm") or a length ("3 hours").
      const endAt = extractEventEndAt(
        userText,
        startAt.value,
        timezone,
        context.now,
      ) ?? (state.pending_question?.required_slot_keys.includes("end_at")
        ? parseEventEnd(userText, startAt.value, timezone, context.now) ??
          undefined
        : undefined);
      if (endAt) {
        updates.end_at = resolvedSlot(
          endAt,
          "user",
          context.now.toISOString(),
          userText.trim().slice(0, MAX_STATE_STRING),
        );
      }
    }
    if (Object.keys(updates).length > 0) {
      state = applySlotUpdates(state, updates, state.pending_question);
    }
  }
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
    const yearlessDate = yearlessCalendarDate(userText);
    if (yearlessDate) {
      const temporal = {
        original_text: userText,
        precision: "date" as const,
        local_date: null,
        local_time: null,
        timezone: context.timezone,
        resolved_iso: null,
        source: "user" as const,
        yearless_date: yearlessDate,
      };
      state = applySlotUpdates(state, {
        start_at: proposedSlot(temporal, "user", userText),
      }, null);
    }
    const prompt = yearlessDate
      ? `I see ${yearlessDate}, but the year is missing. Which year should I use? I’ll show you the full date and time for confirmation before creating anything.`
      : "What future date and time should I use?";
    const choices =
      activeTask.slots.timezone.status !== "resolved" && !context.timezone
        ? timezoneQuestion(context.questionId)
        : assertAgentChoicesV2({
          schema_version: 2,
          question_id: context.questionId,
          kind: "clarifying",
          prompt,
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
  // #3355 P7 (D-23): ask when it ends; never assume two hours.
  const endSlot = activeTask.slots.end_at;
  if (activeTask.intent === "create_event" && endSlot?.status !== "resolved") {
    const choices = endTimeQuestion(
      context.questionId,
      String(activeTask.slots.start_at.value),
      String(activeTask.slots.timezone.value),
    );
    const asked = state.pending_question?.required_slot_keys.includes("end_at");
    state = setPendingQuestion(state, pendingQuestion(choices));
    return finalizeResult(
      classification,
      state,
      asked
        ? `I couldn't read an end time after the start from that. ${choices.prompt}`
        : `${intro} ${choices.prompt}`.trim(),
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
