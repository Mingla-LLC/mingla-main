// Issue #1985 — sole owner of Ari's persisted task/slot state.
// Prose, model output, message history, and summaries are context only. Every
// state transition passes through the validated reducer helpers in this file.

import { isValidIanaTimezone } from "./agentRelativeTime.ts";

export const TASK_STATE_SCHEMA_VERSION = 1 as const;
export const MAX_TASK_STATE_BYTES = 16 * 1024;
export const MAX_TASK_SLOTS = 20;
export const MAX_INTERRUPTION_DEPTH = 3;
export const MAX_BRIEF_ITEMS = 8;
export const MAX_STATE_STRING = 240;

export type TaskStatus =
  | "idle"
  | "gathering"
  | "ready_to_propose"
  | "awaiting_confirmation"
  | "interrupted"
  | "completed"
  | "cancelled"
  | "blocked";

export type SlotStatus = "missing" | "proposed" | "resolved";
export type SlotSource = "user" | "context" | "derived" | "choice" | "tool";

export interface TaskSlot {
  status: SlotStatus;
  value: unknown;
  source: SlotSource;
  original_text?: string;
  resolved_at?: string;
}

export interface EventBrief {
  concepts: string[];
  food: string[];
  music: string[];
  experience: string[];
  notes: string[];
}

export interface ActiveTaskV1 {
  task_id: string;
  intent: string;
  brand_id: string;
  stage: string;
  origin_message_id: string;
  slots: Record<string, TaskSlot>;
  brief: EventBrief;
  pending_action_id?: string;
  created_resource?: { kind: string; id: string; label: string };
  last_error_code?: string;
}

export interface TaskInterruption {
  turn_id: string;
  kind: "read" | "question";
  user_text_digest: string;
  started_at: string;
}

export type ChoiceMode = "single" | "multi" | "free_text";

export interface PendingQuestionV1 {
  question_id: string;
  required_slot_keys: string[];
  response_message_id?: string;
  mode: ChoiceMode;
  option_ids: string[];
}

export interface LastCompletedStepV1 {
  intent: string;
  outcome: "executed" | "failed" | "cancelled" | "expired";
  resource_kind?: string;
  resource_id?: string;
  pending_action_id?: string;
  completed_at: string;
}

export interface TaskStateV1 {
  schema_version: 1;
  status: TaskStatus;
  active_task: ActiveTaskV1 | null;
  interruption_stack: TaskInterruption[];
  pending_question: PendingQuestionV1 | null;
  last_completed_step: LastCompletedStepV1 | null;
}

export type TaskStateErrorCode =
  | "TASK_STATE_INVALID"
  | "TASK_STATE_VERSION_UNSUPPORTED"
  | "TASK_STATE_CONFLICT"
  | "CHOICE_STALE"
  | "TIMEZONE_REQUIRED"
  | "TASK_RECOVERY_REQUIRED";

export class TaskStateError extends Error {
  readonly code: TaskStateErrorCode;

  constructor(code: TaskStateErrorCode, message: string) {
    super(message);
    this.name = "TaskStateError";
    this.code = code;
  }
}

export const IDLE_TASK_STATE: TaskStateV1 = Object.freeze({
  schema_version: TASK_STATE_SCHEMA_VERSION,
  status: "idle",
  active_task: null,
  interruption_stack: [],
  pending_question: null,
  last_completed_step: null,
});

const TASK_STATUSES = new Set<TaskStatus>([
  "idle",
  "gathering",
  "ready_to_propose",
  "awaiting_confirmation",
  "interrupted",
  "completed",
  "cancelled",
  "blocked",
]);
const SLOT_STATUSES = new Set<SlotStatus>(["missing", "proposed", "resolved"]);
const SLOT_SOURCES = new Set<SlotSource>([
  "user",
  "context",
  "derived",
  "choice",
  "tool",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_STATE_STRING
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      `${field} must be a non-empty bounded string`,
    );
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function validateJsonValue(value: unknown, path: string, depth = 0): unknown {
  if (depth > 8) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      `${path} is too deeply nested`,
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TaskStateError("TASK_STATE_INVALID", `${path} is not finite`);
    }
    return value;
  }
  if (typeof value === "string") return requiredString(value, path);
  if (Array.isArray(value)) {
    if (value.length > MAX_BRIEF_ITEMS) {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        `${path} has too many values`,
      );
    }
    return value.map((entry, index) =>
      validateJsonValue(entry, `${path}[${index}]`, depth + 1)
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_TASK_SLOTS) {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        `${path} has too many fields`,
      );
    }
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      requiredString(key, `${path}.key`);
      copy[key] = validateJsonValue(entry, `${path}.${key}`, depth + 1);
    }
    return copy;
  }
  throw new TaskStateError(
    "TASK_STATE_INVALID",
    `${path} is not JSON-compatible`,
  );
}

function parseBrief(value: unknown): EventBrief {
  if (!isRecord(value)) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "active_task.brief is invalid",
    );
  }
  const parseList = (key: keyof EventBrief): string[] => {
    const list = value[key];
    if (!Array.isArray(list) || list.length > MAX_BRIEF_ITEMS) {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        `active_task.brief.${key} is invalid`,
      );
    }
    return list.map((entry, index) =>
      requiredString(entry, `active_task.brief.${key}[${index}]`)
    );
  };
  return {
    concepts: parseList("concepts"),
    food: parseList("food"),
    music: parseList("music"),
    experience: parseList("experience"),
    notes: parseList("notes"),
  };
}

function parseActiveTask(value: unknown): ActiveTaskV1 | null {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.slots)) {
    throw new TaskStateError("TASK_STATE_INVALID", "active_task is invalid");
  }
  const slotEntries = Object.entries(value.slots);
  if (slotEntries.length > MAX_TASK_SLOTS) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "active_task has too many slots",
    );
  }
  const slots: Record<string, TaskSlot> = {};
  for (const [key, rawSlot] of slotEntries) {
    requiredString(key, "slot key");
    if (
      !isRecord(rawSlot) || !SLOT_STATUSES.has(rawSlot.status as SlotStatus) ||
      !SLOT_SOURCES.has(rawSlot.source as SlotSource)
    ) {
      throw new TaskStateError("TASK_STATE_INVALID", `slot ${key} is invalid`);
    }
    slots[key] = {
      status: rawSlot.status as SlotStatus,
      value: validateJsonValue(rawSlot.value, `slots.${key}.value`),
      source: rawSlot.source as SlotSource,
      ...(optionalString(rawSlot.original_text, `slots.${key}.original_text`)
        ? { original_text: rawSlot.original_text as string }
        : {}),
      ...(optionalString(rawSlot.resolved_at, `slots.${key}.resolved_at`)
        ? { resolved_at: rawSlot.resolved_at as string }
        : {}),
    };
  }
  const created = value.created_resource;
  const createdResource = created === undefined
    ? undefined
    : isRecord(created)
    ? {
      kind: requiredString(created.kind, "created_resource.kind"),
      id: requiredString(created.id, "created_resource.id"),
      label: requiredString(created.label, "created_resource.label"),
    }
    : (() => {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        "created_resource is invalid",
      );
    })();
  return {
    task_id: requiredString(value.task_id, "active_task.task_id"),
    intent: requiredString(value.intent, "active_task.intent"),
    brand_id: requiredString(value.brand_id, "active_task.brand_id"),
    stage: requiredString(value.stage, "active_task.stage"),
    origin_message_id: requiredString(
      value.origin_message_id,
      "active_task.origin_message_id",
    ),
    slots,
    brief: parseBrief(value.brief),
    ...(optionalString(value.pending_action_id, "active_task.pending_action_id")
      ? { pending_action_id: value.pending_action_id as string }
      : {}),
    ...(createdResource ? { created_resource: createdResource } : {}),
    ...(optionalString(value.last_error_code, "active_task.last_error_code")
      ? { last_error_code: value.last_error_code as string }
      : {}),
  };
}

function parsePendingQuestion(value: unknown): PendingQuestionV1 | null {
  if (value === null) return null;
  if (
    !isRecord(value) || !Array.isArray(value.required_slot_keys) ||
    !Array.isArray(value.option_ids)
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "pending_question is invalid",
    );
  }
  if (!new Set(["single", "multi", "free_text"]).has(value.mode as string)) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "pending_question.mode is invalid",
    );
  }
  return {
    question_id: requiredString(
      value.question_id,
      "pending_question.question_id",
    ),
    required_slot_keys: value.required_slot_keys.map((entry, index) =>
      requiredString(entry, `pending_question.required_slot_keys[${index}]`)
    ),
    ...(optionalString(
        value.response_message_id,
        "pending_question.response_message_id",
      )
      ? { response_message_id: value.response_message_id as string }
      : {}),
    mode: value.mode as ChoiceMode,
    option_ids: value.option_ids.map((entry, index) =>
      requiredString(entry, `pending_question.option_ids[${index}]`)
    ),
  };
}

export function parseTaskState(value: unknown): TaskStateV1 {
  if (!isRecord(value)) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "task_state must be an object",
    );
  }
  if (value.schema_version !== TASK_STATE_SCHEMA_VERSION) {
    throw new TaskStateError(
      "TASK_STATE_VERSION_UNSUPPORTED",
      "This chat uses an unsupported task-state version",
    );
  }
  if (!TASK_STATUSES.has(value.status as TaskStatus)) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "task_state.status is invalid",
    );
  }
  if (
    !Array.isArray(value.interruption_stack) ||
    value.interruption_stack.length > MAX_INTERRUPTION_DEPTH
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "interruption_stack is invalid",
    );
  }
  const interruptions = value.interruption_stack.map(
    (entry, index): TaskInterruption => {
      if (
        !isRecord(entry) || (entry.kind !== "read" && entry.kind !== "question")
      ) {
        throw new TaskStateError(
          "TASK_STATE_INVALID",
          `interruption_stack[${index}] is invalid`,
        );
      }
      return {
        turn_id: requiredString(
          entry.turn_id,
          `interruption_stack[${index}].turn_id`,
        ),
        kind: entry.kind,
        user_text_digest: requiredString(
          entry.user_text_digest,
          `interruption_stack[${index}].user_text_digest`,
        ),
        started_at: requiredString(
          entry.started_at,
          `interruption_stack[${index}].started_at`,
        ),
      };
    },
  );
  const last = value.last_completed_step;
  const lastCompleted = last === null ? null : isRecord(last) &&
      new Set(["executed", "failed", "cancelled", "expired"]).has(
        last.outcome as string,
      )
    ? {
      intent: requiredString(last.intent, "last_completed_step.intent"),
      outcome: last.outcome as LastCompletedStepV1["outcome"],
      ...(optionalString(
          last.resource_kind,
          "last_completed_step.resource_kind",
        )
        ? { resource_kind: last.resource_kind as string }
        : {}),
      ...(optionalString(last.resource_id, "last_completed_step.resource_id")
        ? { resource_id: last.resource_id as string }
        : {}),
      ...(optionalString(
          last.pending_action_id,
          "last_completed_step.pending_action_id",
        )
        ? { pending_action_id: last.pending_action_id as string }
        : {}),
      completed_at: requiredString(
        last.completed_at,
        "last_completed_step.completed_at",
      ),
    }
    : (() => {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        "last_completed_step is invalid",
      );
    })();
  const parsed: TaskStateV1 = {
    schema_version: TASK_STATE_SCHEMA_VERSION,
    status: value.status as TaskStatus,
    active_task: parseActiveTask(value.active_task),
    interruption_stack: interruptions,
    pending_question: parsePendingQuestion(value.pending_question),
    last_completed_step: lastCompleted,
  };
  assertTaskState(parsed);
  return parsed;
}

export function assertTaskState(state: TaskStateV1): void {
  const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
  if (bytes > MAX_TASK_STATE_BYTES) {
    throw new TaskStateError("TASK_STATE_INVALID", "task_state exceeds 16 KiB");
  }
  if (state.status === "idle" && state.active_task !== null) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "idle task state cannot have an active task",
    );
  }
  if (
    state.status === "awaiting_confirmation" &&
    !state.active_task?.pending_action_id
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "awaiting_confirmation requires a pending action",
    );
  }
  if (state.pending_question && !state.active_task) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "pending_question requires an active task",
    );
  }
}

export function resolvedSlot(
  value: unknown,
  source: SlotSource,
  resolvedAt: string,
  originalText?: string,
): TaskSlot {
  const slot: TaskSlot = {
    status: "resolved",
    value: validateJsonValue(value, "slot.value"),
    source,
    resolved_at: requiredString(resolvedAt, "slot.resolved_at"),
    ...(originalText
      ? { original_text: requiredString(originalText, "slot.original_text") }
      : {}),
  };
  return slot;
}

export function proposedSlot(
  value: unknown,
  source: SlotSource,
  originalText?: string,
): TaskSlot {
  return {
    status: "proposed",
    value: validateJsonValue(value, "slot.value"),
    source,
    ...(originalText
      ? { original_text: requiredString(originalText, "slot.original_text") }
      : {}),
  };
}

export function missingSlot(): TaskSlot {
  return { status: "missing", value: null, source: "derived" };
}

export function createEventTaskState(args: {
  taskId: string;
  brandId: string;
  originMessageId: string;
  nowIso: string;
  brief: EventBrief;
  title?: string;
  intent?: "create_event" | "create_rsvp";
}): TaskStateV1 {
  const state: TaskStateV1 = {
    schema_version: TASK_STATE_SCHEMA_VERSION,
    status: "gathering",
    active_task: {
      task_id: requiredString(args.taskId, "taskId"),
      intent: args.intent ?? "create_event",
      brand_id: requiredString(args.brandId, "brandId"),
      stage: "gathering",
      origin_message_id: requiredString(
        args.originMessageId,
        "originMessageId",
      ),
      slots: {
        brand_id: resolvedSlot(args.brandId, "context", args.nowIso),
        title: args.title
          ? resolvedSlot(args.title, "user", args.nowIso, args.title)
          : missingSlot(),
        start_at: missingSlot(),
        timezone: missingSlot(),
      },
      brief: args.brief,
    },
    interruption_stack: [],
    pending_question: null,
    last_completed_step: null,
  };
  assertTaskState(state);
  return state;
}

export function applySlotUpdates(
  state: TaskStateV1,
  updates: Record<string, TaskSlot>,
  pendingQuestion: PendingQuestionV1 | null,
): TaskStateV1 {
  if (!state.active_task) {
    throw new TaskStateError("TASK_STATE_INVALID", "No active task to update");
  }
  const nextSlots = { ...state.active_task.slots, ...updates };
  const required = ["brand_id", "title", "start_at", "timezone"];
  const complete = required.every((key) =>
    nextSlots[key]?.status === "resolved"
  );
  const next: TaskStateV1 = {
    ...state,
    status: complete ? "ready_to_propose" : "gathering",
    active_task: {
      ...state.active_task,
      stage: complete ? "ready_to_propose" : "gathering",
      slots: nextSlots,
    },
    pending_question: complete ? null : pendingQuestion,
  };
  assertTaskState(next);
  return next;
}

export function setPendingQuestion(
  state: TaskStateV1,
  question: PendingQuestionV1,
): TaskStateV1 {
  if (!state.active_task) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "No active task for question",
    );
  }
  const next: TaskStateV1 = {
    ...state,
    status: "gathering",
    pending_question: question,
  };
  assertTaskState(next);
  return next;
}

export function beginInterruption(
  state: TaskStateV1,
  interruption: TaskInterruption,
): TaskStateV1 {
  if (!state.active_task) return state;
  const stack = [...state.interruption_stack, interruption].slice(
    -MAX_INTERRUPTION_DEPTH,
  );
  const next: TaskStateV1 = {
    ...state,
    status: "interrupted",
    interruption_stack: stack,
  };
  assertTaskState(next);
  return next;
}

export function resumeInterruption(state: TaskStateV1): TaskStateV1 {
  if (!state.active_task || state.interruption_stack.length === 0) return state;
  const next: TaskStateV1 = {
    ...state,
    status: state.pending_question
      ? "gathering"
      : state.status === "interrupted"
      ? "gathering"
      : state.status,
    interruption_stack: state.interruption_stack.slice(0, -1),
  };
  assertTaskState(next);
  return next;
}

export function markAwaitingConfirmation(
  state: TaskStateV1,
  pendingActionId: string,
): TaskStateV1 {
  if (!state.active_task || state.status !== "ready_to_propose") {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "Task is not ready to propose",
    );
  }
  const next: TaskStateV1 = {
    ...state,
    status: "awaiting_confirmation",
    pending_question: null,
    active_task: {
      ...state.active_task,
      stage: "awaiting_confirmation",
      pending_action_id: requiredString(pendingActionId, "pendingActionId"),
    },
  };
  assertTaskState(next);
  return next;
}

const CREATE_EVENT_OPTIONAL_ARG_KEYS = [
  "description",
  "location_text",
  "is_online",
  "online_url",
  "visibility",
] as const;
const CREATE_EVENT_EDIT_ARG_KEYS = new Set([
  "brand_id",
  "title",
  "start_at",
  "timezone",
  ...CREATE_EVENT_OPTIONAL_ARG_KEYS,
]);

export function replaceCreateEventProposalArgs(args: {
  state: TaskStateV1;
  pendingActionId: string;
  toolArgs: Record<string, unknown>;
  nowIso: string;
}): TaskStateV1 {
  const active = args.state.active_task;
  if (
    !active || active.intent !== "create_event" ||
    args.state.status !== "awaiting_confirmation" ||
    active.pending_action_id !== args.pendingActionId
  ) {
    throw new TaskStateError(
      "TASK_RECOVERY_REQUIRED",
      "Edited proposal does not match the active event task",
    );
  }
  if (
    Object.keys(args.toolArgs).some((key) =>
      !CREATE_EVENT_EDIT_ARG_KEYS.has(key)
    )
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "Edited event proposal contains unsupported fields",
    );
  }
  const brandId = args.toolArgs.brand_id;
  const title = args.toolArgs.title;
  const startAt = args.toolArgs.start_at;
  if (
    typeof brandId !== "string" || brandId !== active.brand_id ||
    typeof title !== "string" || title.trim().length === 0 ||
    typeof startAt !== "string" || !Number.isFinite(Date.parse(startAt)) ||
    Date.parse(startAt) <= Date.parse(args.nowIso)
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "Edited event proposal has invalid required values",
    );
  }
  const timezone = typeof args.toolArgs.timezone === "string"
    ? args.toolArgs.timezone
    : active.slots.timezone?.value;
  if (!isValidIanaTimezone(timezone)) {
    throw new TaskStateError(
      "TIMEZONE_REQUIRED",
      "Choose a timezone before confirming this edit",
    );
  }
  if (title.trim().length > 120) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "Edited event title is longer than 120 characters",
    );
  }
  const optionalRules: Record<
    (typeof CREATE_EVENT_OPTIONAL_ARG_KEYS)[number],
    (value: unknown) => boolean
  > = {
    description: (value) =>
      typeof value === "string" && value.length <= MAX_STATE_STRING,
    location_text: (value) => typeof value === "string" && value.length <= 200,
    is_online: (value) => typeof value === "boolean",
    online_url: (value) =>
      typeof value === "string" && value.length <= MAX_STATE_STRING,
    visibility: (value) =>
      typeof value === "string" &&
      ["draft", "public", "unlisted"].includes(value),
  };
  for (const key of CREATE_EVENT_OPTIONAL_ARG_KEYS) {
    const value = args.toolArgs[key];
    if (value !== undefined && !optionalRules[key](value)) {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        `Edited event proposal has an invalid ${key}`,
      );
    }
  }

  const slots: Record<string, TaskSlot> = {
    brand_id: resolvedSlot(brandId, "user", args.nowIso),
    title: resolvedSlot(title.trim(), "user", args.nowIso, title),
    start_at: resolvedSlot(
      new Date(startAt).toISOString(),
      "user",
      args.nowIso,
      startAt,
    ),
    timezone: resolvedSlot(timezone, "user", args.nowIso, timezone),
  };
  for (const key of CREATE_EVENT_OPTIONAL_ARG_KEYS) {
    if (args.toolArgs[key] !== undefined) {
      slots[key] = resolvedSlot(args.toolArgs[key], "user", args.nowIso);
    }
  }
  const next: TaskStateV1 = {
    ...args.state,
    status: "ready_to_propose",
    pending_question: null,
    active_task: {
      ...active,
      stage: "ready_to_propose",
      pending_action_id: undefined,
      slots,
    },
  };
  assertTaskState(next);
  return next;
}

export function reconcilePendingAction(args: {
  state: TaskStateV1;
  pendingActionId: string;
  outcome: LastCompletedStepV1["outcome"];
  nowIso: string;
  errorCode?: string;
  resource?: { kind: string; id: string; label: string };
}): TaskStateV1 {
  const { state } = args;
  if (
    !state.active_task ||
    state.active_task.pending_action_id !== args.pendingActionId
  ) {
    throw new TaskStateError(
      "TASK_RECOVERY_REQUIRED",
      "Pending action does not match active task",
    );
  }
  const completedStep: LastCompletedStepV1 = {
    intent: state.active_task.intent,
    outcome: args.outcome,
    pending_action_id: args.pendingActionId,
    completed_at: args.nowIso,
    ...(args.resource
      ? { resource_kind: args.resource.kind, resource_id: args.resource.id }
      : {}),
  };
  if (args.outcome === "executed") {
    const next: TaskStateV1 = {
      ...state,
      status: "completed",
      pending_question: null,
      interruption_stack: [],
      last_completed_step: completedStep,
      active_task: {
        ...state.active_task,
        stage: "completed",
        ...(args.resource ? { created_resource: args.resource } : {}),
      },
    };
    assertTaskState(next);
    return next;
  }
  if (args.outcome === "cancelled" || args.outcome === "expired") {
    const next: TaskStateV1 = {
      ...state,
      status: args.outcome === "cancelled" ? "cancelled" : "ready_to_propose",
      pending_question: null,
      last_completed_step: completedStep,
      active_task: {
        ...state.active_task,
        stage: args.outcome === "cancelled" ? "cancelled" : "ready_to_propose",
        pending_action_id: undefined,
      },
    };
    assertTaskState(next);
    return next;
  }
  const next: TaskStateV1 = {
    ...state,
    status: "ready_to_propose",
    pending_question: null,
    last_completed_step: completedStep,
    active_task: {
      ...state.active_task,
      stage: "ready_to_propose",
      pending_action_id: undefined,
      ...(args.errorCode ? { last_error_code: args.errorCode } : {}),
    },
  };
  assertTaskState(next);
  return next;
}

export function cancelActiveTask(
  state: TaskStateV1,
  nowIso: string,
): TaskStateV1 {
  if (!state.active_task) return state;
  const next: TaskStateV1 = {
    ...state,
    status: "cancelled",
    pending_question: null,
    interruption_stack: [],
    last_completed_step: {
      intent: state.active_task.intent,
      outcome: "cancelled",
      completed_at: nowIso,
      ...(state.active_task.pending_action_id
        ? { pending_action_id: state.active_task.pending_action_id }
        : {}),
    },
    active_task: { ...state.active_task, stage: "cancelled" },
  };
  assertTaskState(next);
  return next;
}

export function assertCreateEventProposal(
  state: TaskStateV1,
): Record<string, unknown> {
  if (
    !state.active_task || state.active_task.intent !== "create_event" ||
    state.status !== "ready_to_propose"
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "create_event task is not ready to propose",
    );
  }
  const slots = state.active_task.slots;
  for (const key of ["brand_id", "title", "start_at", "timezone"]) {
    if (slots[key]?.status !== "resolved") {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        `create_event required slot ${key} is unresolved`,
      );
    }
  }
  const brandId = slots.brand_id.value;
  const title = slots.title.value;
  const startAt = slots.start_at.value;
  if (typeof brandId !== "string" || brandId !== state.active_task.brand_id) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "create_event brand slot conflicts with task scope",
    );
  }
  if (typeof title !== "string" || typeof startAt !== "string") {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "create_event proposal values are invalid",
    );
  }
  return { brand_id: brandId, title, start_at: startAt };
}

export function assertCreateRsvpProposal(
  state: TaskStateV1,
): Record<string, unknown> {
  if (
    !state.active_task || state.active_task.intent !== "create_rsvp" ||
    state.status !== "ready_to_propose"
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "create_rsvp task is not ready to propose",
    );
  }
  const slots = state.active_task.slots;
  for (const key of ["brand_id", "title", "start_at", "timezone"]) {
    if (slots[key]?.status !== "resolved") {
      throw new TaskStateError(
        "TASK_STATE_INVALID",
        `create_rsvp required slot ${key} is unresolved`,
      );
    }
  }
  const brandId = slots.brand_id.value;
  const title = slots.title.value;
  const startAt = slots.start_at.value;
  const timezone = slots.timezone.value;
  if (
    typeof brandId !== "string" || brandId !== state.active_task.brand_id ||
    typeof title !== "string" || typeof startAt !== "string" ||
    typeof timezone !== "string" || !isValidIanaTimezone(timezone)
  ) {
    throw new TaskStateError(
      "TASK_STATE_INVALID",
      "create_rsvp proposal values are invalid",
    );
  }
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(startAt));
  const part = (type: string): string =>
    localParts.find((entry) => entry.type === type)?.value ?? "";
  return {
    brand_id: brandId,
    title,
    timezone,
    format: "in_person",
    date: `${part("year")}-${part("month")}-${part("day")}`,
    doors_open: `${part("hour")}:${part("minute")}`,
  };
}

export function assertEditedCreateEventProposal(
  state: TaskStateV1,
): Record<string, unknown> {
  const proposal: Record<string, unknown> = assertCreateEventProposal(state);
  const slots = state.active_task?.slots ?? {};
  for (const key of ["timezone", ...CREATE_EVENT_OPTIONAL_ARG_KEYS]) {
    const slot = slots[key];
    if (slot?.status === "resolved") proposal[key] = slot.value;
  }
  return proposal;
}

export function pendingQuestionPrompt(state: TaskStateV1): string | null {
  if (!state.pending_question || !state.active_task) return null;
  const missing = state.pending_question.required_slot_keys.join(" and ");
  return `Choose ${missing} to continue the event plan.`;
}
