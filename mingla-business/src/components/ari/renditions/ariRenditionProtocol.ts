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
import { ARI_RENDITION_BLOCK_TYPES } from "./ariRenditionCapabilities";
export {
  ARI_RENDITION_BLOCK_TYPES,
  buildAriUiCapabilities,
  type AriUiCapabilitiesV2,
} from "./ariRenditionCapabilities";

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
  | { type: "submit"; message: string }
  | { type: "route"; route: string }
  | { type: "external"; url: string }
  | { type: "confirm"; pending_action_id: string }
  | { type: "cancel"; pending_action_id: string }
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
  kind: string;
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

export interface AriRenditionSourceV2 extends AriRenditionOptionV1 {
  url?: string;
  publisher?: string;
  published_at?: string;
  accessed_at?: string;
  excerpt?: string;
}

export type AriRenditionBlockV2 =
  | { type: "paragraph"; version: 1; id: string; text: string }
  | { type: "list"; version: 1; id: string; title?: string; style: "bullet" | "numbered"; items: string[] }
  | { type: "key_value"; version: 1; id: string; rows: AriRenditionRowV1[] }
  | { type: "metrics"; version: 1; id: string; items: { id: string; label: string; value: string; detail?: string }[] }
  | { type: "table"; version: 1; id: string; columns: { id: string; label: string }[]; rows: { id: string; cells: Record<string, string> }[] }
  | { type: "timeline"; version: 1; id: string; items: AriRenditionStepV1[] }
  | { type: "progress"; version: 1; id: string; value: number; label?: string }
  | { type: "choices"; version: 1; id: string; selection: "single" | "multiple"; options: AriRenditionOptionV1[] }
  | { type: "input"; version: 1; id: string; field: AriRenditionFieldV1 }
  | { type: "code"; version: 1; id: string; code: string; language?: string }
  | { type: "sources"; version: 1; id: string; items: AriRenditionSourceV2[] }
  | { type: "callout"; version: 1; id: string; tone: AriRenditionTone; title?: string; body: string };

export interface AriRenditionV2 {
  schema_version: 2;
  rendition_id: string;
  kind: string;
  eyebrow?: string;
  title: string;
  body: string;
  tone?: AriRenditionTone;
  state?: AriRenditionVisualState;
  transition_label?: string;
  graphic?: AriRenditionGraphicVariant;
  blocks: AriRenditionBlockV2[];
  actions?: AriRenditionActionV1[];
}

export type AriRendition = AriRenditionV1 | AriRenditionV2;

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
const BLOCK_TYPES = new Set<string>(ARI_RENDITION_BLOCK_TYPES);
const SAFE_ROUTE_PREFIXES = ["/ari", "/brand/", "/account", "/settings", "/profile", "/(tabs)/"];

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

function parseField(value: unknown): AriRenditionFieldV1 | null {
  const source = record(value);
  const fieldId = id(source?.id);
  const label = text(source?.label, 100);
  const fieldValue = typeof source?.value === "string" && source.value.length <= 1000
    ? source.value
    : null;
  if (!fieldId || !label || fieldValue === null) return null;
  return {
    id: fieldId,
    label,
    value: fieldValue,
    ...(optionalText(source?.placeholder, 200) ? { placeholder: optionalText(source?.placeholder, 200) } : {}),
    ...(typeof source?.editable === "boolean" ? { editable: source.editable } : {}),
    ...(optionalText(source?.confirmationPhrase, 100) ? { confirmationPhrase: optionalText(source?.confirmationPhrase, 100) } : {}),
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
  if (behaviorType === "reply" || behaviorType === "submit") {
    const message = text(rawBehavior.message, 1000);
    if (message) behavior = behaviorType === "reply"
      ? { type: "reply", message }
      : { type: "submit", message };
  } else if (behaviorType === "route") {
    const route = text(rawBehavior.route, 300);
    if (
      route && route.startsWith("/") && !route.startsWith("//") &&
      !route.includes("..") && SAFE_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(prefix))
    ) behavior = { type: "route", route };
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
  } else if (behaviorType === "confirm" || behaviorType === "cancel") {
    const pendingActionId = id(rawBehavior.pending_action_id);
    if (pendingActionId) behavior = behaviorType === "confirm"
      ? { type: "confirm", pending_action_id: pendingActionId }
      : { type: "cancel", pending_action_id: pendingActionId };
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
function parseAriRenditionV1(value: unknown): AriRenditionV1 | null {
  const raw = record(value);
  if (!raw || raw.schema_version !== 1) return null;
  const renditionId = id(raw.rendition_id);
  const kind = id(raw.kind);
  const title = text(raw.title, 180);
  const body = text(raw.body, 1500);
  if (!renditionId || !kind || !title || !body) {
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
    const parsed = parseField(raw.field);
    if (!parsed) return null;
    field = parsed;
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
    kind,
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

function parseRows(value: unknown, max = 12): AriRenditionRowV1[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const rows = value.map((entry): AriRenditionRowV1 | null => {
    const row = record(entry);
    const label = text(row?.label, 120);
    const valueText = text(row?.value, 300);
    return label && valueText ? { label, value: valueText } : null;
  });
  return rows.every((row): row is AriRenditionRowV1 => row !== null) ? rows : null;
}

function parseSteps(value: unknown, max = 12): AriRenditionStepV1[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const steps = value.map((entry): AriRenditionStepV1 | null => {
    const step = record(entry);
    const stepId = id(step?.id);
    const label = text(step?.label, 120);
    const detail = text(step?.detail, 300);
    const state = step?.state;
    return stepId && label && detail && STEP_STATES.has(state as AriRenditionStepState)
      ? { id: stepId, label, detail, state: state as AriRenditionStepState }
      : null;
  });
  return steps.every((step): step is AriRenditionStepV1 => step !== null) ? steps : null;
}

function parseSource(value: unknown): AriRenditionSourceV2 | null {
  const base = parseOption(value);
  const raw = record(value);
  if (!base || !raw) return null;
  let url: string | undefined;
  if (raw.url !== undefined) {
    const candidate = text(raw.url, 1000);
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:") return null;
      url = parsed.toString();
    } catch {
      return null;
    }
  }
  return {
    ...base,
    ...(url ? { url } : {}),
    ...(optionalText(raw.publisher, 120) ? { publisher: optionalText(raw.publisher, 120) } : {}),
    ...(optionalText(raw.published_at, 80) ? { published_at: optionalText(raw.published_at, 80) } : {}),
    ...(optionalText(raw.accessed_at, 80) ? { accessed_at: optionalText(raw.accessed_at, 80) } : {}),
    ...(optionalText(raw.excerpt, 500) ? { excerpt: optionalText(raw.excerpt, 500) } : {}),
  };
}

function parseBlock(value: unknown): AriRenditionBlockV2 | null | "unknown" {
  const raw = record(value);
  if (!raw || raw.version !== 1 || typeof raw.type !== "string") return null;
  if (!BLOCK_TYPES.has(raw.type)) return "unknown";
  const blockId = id(raw.id);
  if (!blockId) return null;
  if (raw.type === "paragraph") {
    const valueText = text(raw.text, 2000);
    return valueText ? { type: "paragraph", version: 1, id: blockId, text: valueText } : null;
  }
  if (raw.type === "list") {
    if (!Array.isArray(raw.items) || raw.items.length > 20) return null;
    const items = raw.items.map((item) => text(item, 300));
    const style = raw.style === "numbered" ? "numbered" : raw.style === "bullet" ? "bullet" : null;
    return style && items.every((item): item is string => item !== null)
      ? { type: "list", version: 1, id: blockId, style, items, ...(optionalText(raw.title, 120) ? { title: optionalText(raw.title, 120) } : {}) }
      : null;
  }
  if (raw.type === "key_value") {
    const rows = parseRows(raw.rows);
    return rows ? { type: "key_value", version: 1, id: blockId, rows } : null;
  }
  if (raw.type === "metrics") {
    if (!Array.isArray(raw.items) || raw.items.length > 8) return null;
    const items = raw.items.map((entry) => {
      const item = record(entry);
      const itemId = id(item?.id);
      const label = text(item?.label, 100);
      const valueText = text(item?.value, 120);
      return itemId && label && valueText
        ? { id: itemId, label, value: valueText, ...(optionalText(item?.detail, 200) ? { detail: optionalText(item?.detail, 200) } : {}) }
        : null;
    });
    return items.every((item): item is NonNullable<typeof item> => item !== null)
      ? { type: "metrics", version: 1, id: blockId, items }
      : null;
  }
  if (raw.type === "table") {
    if (!Array.isArray(raw.columns) || raw.columns.length === 0 || raw.columns.length > 6 || !Array.isArray(raw.rows) || raw.rows.length > 20) return null;
    const columns = raw.columns.map((entry) => {
      const column = record(entry);
      const columnId = id(column?.id);
      const label = text(column?.label, 80);
      return columnId && label ? { id: columnId, label } : null;
    });
    if (!columns.every((column): column is NonNullable<typeof column> => column !== null)) return null;
    const columnIds = new Set(columns.map((column) => column.id));
    const rows = raw.rows.map((entry) => {
      const row = record(entry);
      const rowId = id(row?.id);
      const cells = record(row?.cells);
      if (!rowId || !cells) return null;
      const parsedCells: Record<string, string> = {};
      for (const [key, cell] of Object.entries(cells)) {
        if (!columnIds.has(key)) return null;
        const cellText = text(cell, 240);
        if (!cellText) return null;
        parsedCells[key] = cellText;
      }
      return Object.keys(parsedCells).length === columns.length ? { id: rowId, cells: parsedCells } : null;
    });
    return rows.every((row): row is NonNullable<typeof row> => row !== null)
      ? { type: "table", version: 1, id: blockId, columns, rows }
      : null;
  }
  if (raw.type === "timeline") {
    const items = parseSteps(raw.items);
    return items ? { type: "timeline", version: 1, id: blockId, items } : null;
  }
  if (raw.type === "progress") {
    return typeof raw.value === "number" && Number.isFinite(raw.value) && raw.value >= 0 && raw.value <= 100
      ? { type: "progress", version: 1, id: blockId, value: raw.value, ...(optionalText(raw.label, 120) ? { label: optionalText(raw.label, 120) } : {}) }
      : null;
  }
  if (raw.type === "choices") {
    const options = parseOptions(raw.options, 12);
    const selection = raw.selection === "single" ? "single" : raw.selection === "multiple" ? "multiple" : null;
    return options && selection ? { type: "choices", version: 1, id: blockId, selection, options } : null;
  }
  if (raw.type === "input") {
    const field = parseField(raw.field);
    return field ? { type: "input", version: 1, id: blockId, field } : null;
  }
  if (raw.type === "code") {
    const code = text(raw.code, 5000);
    return code ? { type: "code", version: 1, id: blockId, code, ...(optionalText(raw.language, 40) ? { language: optionalText(raw.language, 40) } : {}) } : null;
  }
  if (raw.type === "sources") {
    if (!Array.isArray(raw.items) || raw.items.length > 12) return null;
    const items = raw.items.map(parseSource);
    return items.every((source): source is AriRenditionSourceV2 => source !== null)
      ? { type: "sources", version: 1, id: blockId, items }
      : null;
  }
  const tone = raw.tone;
  const body = text(raw.body, 1000);
  return body && TONES.has(tone as AriRenditionTone)
    ? { type: "callout", version: 1, id: blockId, tone: tone as AriRenditionTone, body, ...(optionalText(raw.title, 120) ? { title: optionalText(raw.title, 120) } : {}) }
    : null;
}

function parseAriRenditionV2(value: unknown): AriRenditionV2 | null {
  const raw = record(value);
  if (!raw || raw.schema_version !== 2) return null;
  const renditionId = id(raw.rendition_id);
  const kind = id(raw.kind);
  const title = text(raw.title, 180);
  const body = text(raw.body, 1500);
  if (!renditionId || !kind || !title || !body || !Array.isArray(raw.blocks) || raw.blocks.length > 24) return null;
  const parsedBlocks = raw.blocks.map(parseBlock);
  if (parsedBlocks.some((block) => block === null)) return null;
  const blocks = parsedBlocks.filter((block): block is AriRenditionBlockV2 => block !== "unknown");
  let actions: AriRenditionActionV1[] | undefined;
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions) || raw.actions.length > 3) return null;
    const parsedActions = raw.actions.map(parseAction);
    // Content stays visible when an action is unsupported; unsafe controls do not.
    if (parsedActions.every((action): action is AriRenditionActionV1 => action !== null)) actions = parsedActions;
  }
  const tone = raw.tone;
  const visualState = raw.state;
  const graphic = raw.graphic;
  if (tone !== undefined && !TONES.has(tone as AriRenditionTone)) return null;
  if (visualState !== undefined && !VISUAL_STATES.has(visualState as AriRenditionVisualState)) return null;
  if (graphic !== undefined && !GRAPHICS.has(graphic as AriRenditionGraphicVariant)) return null;
  return {
    schema_version: 2,
    rendition_id: renditionId,
    kind,
    title,
    body,
    blocks,
    ...(optionalText(raw.eyebrow, 100) ? { eyebrow: optionalText(raw.eyebrow, 100) } : {}),
    ...(tone ? { tone: tone as AriRenditionTone } : {}),
    ...(visualState ? { state: visualState as AriRenditionVisualState } : {}),
    ...(optionalText(raw.transition_label, 160) ? { transition_label: optionalText(raw.transition_label, 160) } : {}),
    ...(graphic ? { graphic: graphic as AriRenditionGraphicVariant } : {}),
    ...(actions ? { actions } : {}),
  };
}

/** Parse a server rendition. Unknown future versions fall back to message text. */
export function parseAriRendition(value: unknown): AriRendition | null {
  const raw = record(value);
  if (raw?.schema_version === 2) return parseAriRenditionV2(value);
  if (raw?.schema_version === 1) return parseAriRenditionV1(value);
  return null;
}

export function ariRenditionCopyText(rendition: AriRendition): string | undefined {
  if (rendition.schema_version === 1) return rendition.code;
  return rendition.blocks.find((block) => block.type === "code")?.code;
}

export function buildAriRenditionSubmission(input: {
  rendition: AriRendition;
  action: AriRenditionActionV1;
  selectedOptionIds: string[];
  fieldValue: string;
}): string {
  const options = input.rendition.schema_version === 1
    ? [...(input.rendition.chips ?? []), ...(input.rendition.choices ?? [])]
    : input.rendition.blocks
      .filter((block) => block.type === "choices")
      .flatMap((block) => block.options);
  const choiceLabels = options
    .filter((option) => input.selectedOptionIds.includes(option.id))
    .map((option) => option.label);
  return [
    input.action.behavior.type === "submit"
      ? input.action.behavior.message
      : "Continue",
    choiceLabels.length > 0 ? `Choices: ${choiceLabels.join(", ")}` : null,
    input.fieldValue.trim() ? `Response: ${input.fieldValue.trim()}` : null,
  ].filter((part): part is string => !!part).join("\n");
}
