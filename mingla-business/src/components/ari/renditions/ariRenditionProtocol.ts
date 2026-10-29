/**
 * #3355 — versioned production contract for structured Ari UI.
 *
 * The server stores this under `agent_messages.content.structured.rendition`.
 * Every value is treated as untrusted JSON: the parser bounds collection sizes,
 * text lengths, routes, and URLs before a control can render. A future schema
 * version fails closed to the ordinary text bubble instead of exposing actions
 * this app does not understand.
 */

import type { AriRenditionGraphicVariant } from "./AriRenditionGraphic";
import {
  ARI_RENDITION_FIXTURES,
  type AriRenditionKind,
} from "./ariRenditionCatalog";

export type AriRenditionTone = "default" | "warning" | "danger" | "success";
export type AriRenditionStepState = "done" | "active" | "queued";
export type AriRenditionActionStyle = "primary" | "secondary" | "danger";
export type AriRenditionVisualState =
  | "loading"
  | "transitioning"
  | "ready"
  | "submitted"
  | "error"
  | "disabled";

export interface AriRenditionRowV1 {
  label: string;
  value: string;
}

export interface AriRenditionStepV1 {
  id: string;
  label: string;
  detail: string;
  state: AriRenditionStepState;
}

export interface AriRenditionOptionV1 {
  id: string;
  label: string;
  detail?: string;
  selected?: boolean;
}

export type AriRenditionActionBehaviorV1 =
  | { type: "reply"; message: string }
  | { type: "route"; route: string }
  | { type: "external"; url: string }
  | { type: "local"; command: "retry" | "stop" | "resume" | "copy" | "dismiss" };

export interface AriRenditionActionV1 {
  id: string;
  label: string;
  style: AriRenditionActionStyle;
  behavior: AriRenditionActionBehaviorV1;
  disabled?: boolean;
}

export interface AriRenditionFieldV1 {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  editable?: boolean;
  confirmationPhrase?: string;
}

export interface AriRenditionV1 {
  schema_version: 1;
  rendition_id: string;
  kind: AriRenditionKind;
  eyebrow?: string;
  title: string;
  body: string;
  tone?: AriRenditionTone;
  state?: AriRenditionVisualState;
  transition_label?: string;
  rows?: AriRenditionRowV1[];
  chips?: AriRenditionOptionV1[];
  choices?: AriRenditionOptionV1[];
  steps?: AriRenditionStepV1[];
  progress?: number;
  actions?: AriRenditionActionV1[];
  field?: AriRenditionFieldV1;
  code?: string;
  graphic?: AriRenditionGraphicVariant;
  sources?: AriRenditionOptionV1[];
}

const KNOWN_IDS = new Set(ARI_RENDITION_FIXTURES.map((fixture) => fixture.id));
const KNOWN_KINDS = new Set(ARI_RENDITION_FIXTURES.map((fixture) => fixture.kind));
const TONES = new Set<AriRenditionTone>(["default", "warning", "danger", "success"]);
const STEP_STATES = new Set<AriRenditionStepState>(["done", "active", "queued"]);
const ACTION_STYLES = new Set<AriRenditionActionStyle>(["primary", "secondary", "danger"]);
const VISUAL_STATES = new Set<AriRenditionVisualState>([
  "loading",
  "transitioning",
  "ready",
  "submitted",
  "error",
  "disabled",
]);
const LOCAL_COMMANDS = new Set(["retry", "stop", "resume", "copy", "dismiss"]);
const GRAPHICS = new Set<AriRenditionGraphicVariant>(["event", "media", "site", "research", "social"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, max) ?? undefined;
}

function id(value: unknown): string | null {
  const candidate = text(value, 80);
  return candidate && /^[a-z0-9][a-z0-9:_-]*$/i.test(candidate) ? candidate : null;
}

function parseOption(value: unknown): AriRenditionOptionV1 | null {
  const raw = record(value);
  if (!raw) return null;
  const optionId = id(raw.id);
  const label = text(raw.label, 120);
  if (!optionId || !label) return null;
  return {
    id: optionId,
    label,
    ...(optionalText(raw.detail, 240) ? { detail: optionalText(raw.detail, 240) } : {}),
    ...(typeof raw.selected === "boolean" ? { selected: raw.selected } : {}),
  };
}
function parseOptions(value: unknown, max = 12): AriRenditionOptionV1[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) return undefined;
  const parsed = value.map(parseOption);
  return parsed.every((option): option is AriRenditionOptionV1 => option !== null)
    ? parsed
    : undefined;
}

function parseAction(value: unknown): AriRenditionActionV1 | null {
  const raw = record(value);
  const rawBehavior = record(raw?.behavior);
  if (!raw || !rawBehavior) return null;
  const actionId = id(raw?.id);
  const label = text(raw?.label, 100);
  const style = raw?.style;
  const behaviorType = rawBehavior?.type;
  if (!actionId || !label || !ACTION_STYLES.has(style as AriRenditionActionStyle)) return null;

  let behavior: AriRenditionActionBehaviorV1 | null = null;
  if (behaviorType === "reply") {
    const message = text(rawBehavior.message, 1000);
    if (message) behavior = { type: "reply", message };
  } else if (behaviorType === "route") {
    const route = text(rawBehavior.route, 300);
    if (route && route.startsWith("/") && !route.startsWith("//")) behavior = { type: "route", route };
  } else if (behaviorType === "external") {
    const url = text(rawBehavior.url, 1000);
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:") behavior = { type: "external", url: parsed.toString() };
      } catch {
        behavior = null;
      }
    }
  } else if (behaviorType === "local" && LOCAL_COMMANDS.has(rawBehavior.command as string)) {
    behavior = {
      type: "local",
      command: rawBehavior.command as "retry" | "stop" | "resume" | "copy" | "dismiss",
    };
  }
  if (!behavior) return null;
  return {
    id: actionId,
    label,
    style: style as AriRenditionActionStyle,
    behavior,
    ...(typeof raw?.disabled === "boolean" ? { disabled: raw.disabled } : {}),
  };
}

/** Parse one structured block. Invalid or unsupported input renders no controls. */
export function parseAriRendition(value: unknown): AriRenditionV1 | null {
  const raw = record(value);
  if (!raw || raw.schema_version !== 1) return null;
  const renditionId = id(raw.rendition_id);
  const kind = raw.kind;
  const title = text(raw.title, 180);
  const body = text(raw.body, 1500);
  if (!renditionId || !KNOWN_IDS.has(renditionId) || !KNOWN_KINDS.has(kind as AriRenditionKind) || !title || !body) {
    return null;
  }

  let rows: AriRenditionRowV1[] | undefined;
  if (raw.rows !== undefined) {
    if (!Array.isArray(raw.rows) || raw.rows.length > 12) return null;
    const parsedRows = raw.rows.map((value): AriRenditionRowV1 | null => {
      const row = record(value);
      const label = text(row?.label, 120);
      const valueText = text(row?.value, 300);
      return label && valueText ? { label, value: valueText } : null;
    });
    if (!parsedRows.every((row): row is AriRenditionRowV1 => row !== null)) return null;
    rows = parsedRows;
  }

  let steps: AriRenditionStepV1[] | undefined;
  if (raw.steps !== undefined) {
    if (!Array.isArray(raw.steps) || raw.steps.length > 12) return null;
    const parsedSteps = raw.steps.map((value): AriRenditionStepV1 | null => {
      const step = record(value);
      const stepId = id(step?.id);
      const label = text(step?.label, 120);
      const detail = text(step?.detail, 300);
      const state = step?.state;
      return stepId && label && detail && STEP_STATES.has(state as AriRenditionStepState)
        ? { id: stepId, label, detail, state: state as AriRenditionStepState }
        : null;
    });
    if (!parsedSteps.every((step): step is AriRenditionStepV1 => step !== null)) return null;
    steps = parsedSteps;
  }

  let actions: AriRenditionActionV1[] | undefined;
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions) || raw.actions.length > 3) return null;
    const parsedActions = raw.actions.map(parseAction);
    if (!parsedActions.every((action): action is AriRenditionActionV1 => action !== null)) return null;
    actions = parsedActions;
  }

  let field: AriRenditionFieldV1 | undefined;
  if (raw.field !== undefined) {
    const source = record(raw.field);
    const fieldId = id(source?.id);
    const label = text(source?.label, 100);
    const value = typeof source?.value === "string" && source.value.length <= 1000 ? source.value : null;
    if (!fieldId || !label || value === null) return null;
    field = {
      id: fieldId,
      label,
      value,
      ...(optionalText(source?.placeholder, 200) ? { placeholder: optionalText(source?.placeholder, 200) } : {}),
      ...(typeof source?.editable === "boolean" ? { editable: source.editable } : {}),
      ...(optionalText(source?.confirmationPhrase, 100) ? { confirmationPhrase: optionalText(source?.confirmationPhrase, 100) } : {}),
    };
  }

  const chips = parseOptions(raw.chips);
  const choices = parseOptions(raw.choices);
  const sources = parseOptions(raw.sources);
  if ((raw.chips !== undefined && chips === undefined) ||
      (raw.choices !== undefined && choices === undefined) ||
      (raw.sources !== undefined && sources === undefined)) return null;

  const tone = raw.tone;
  if (tone !== undefined && !TONES.has(tone as AriRenditionTone)) return null;
  const visualState = raw.state;
  if (visualState !== undefined && !VISUAL_STATES.has(visualState as AriRenditionVisualState)) return null;
  const progress = raw.progress;
  if (progress !== undefined && (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 100)) return null;
  const graphic = raw.graphic;
  if (graphic !== undefined && !GRAPHICS.has(graphic as AriRenditionGraphicVariant)) return null;

  return {
    schema_version: 1,
    rendition_id: renditionId,
    kind: kind as AriRenditionKind,
    title,
    body,
    ...(optionalText(raw.eyebrow, 100) ? { eyebrow: optionalText(raw.eyebrow, 100) } : {}),
    ...(tone ? { tone: tone as AriRenditionTone } : {}),
    ...(visualState ? { state: visualState as AriRenditionVisualState } : {}),
    ...(optionalText(raw.transition_label, 160) ? { transition_label: optionalText(raw.transition_label, 160) } : {}),
    ...(rows ? { rows } : {}),
    ...(chips ? { chips } : {}),
    ...(choices ? { choices } : {}),
    ...(steps ? { steps } : {}),
    ...(typeof progress === "number" ? { progress } : {}),
    ...(actions ? { actions } : {}),
    ...(field ? { field } : {}),
    ...(optionalText(raw.code, 3000) ? { code: optionalText(raw.code, 3000) } : {}),
    ...(graphic ? { graphic: graphic as AriRenditionGraphicVariant } : {}),
    ...(sources ? { sources } : {}),
  };
}

