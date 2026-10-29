// #3355 — server-owned Ari structured-response adapter.
//
// The installed client advertises the bounded vocabulary it can render. The
// server emits only that vocabulary and always keeps ordinary message text as
// the compatibility fallback. Tool/model output is untrusted: this module
// selects short presentation-safe facts and never turns result data into an
// executable action.

export const ARI_RENDITION_SCHEMA_VERSION = 2 as const;
export const ARI_RENDITION_BLOCK_VERSION = 1 as const;
export const ARI_RENDITION_ACTION_VERSION = 1 as const;

export const ARI_RENDITION_BLOCK_TYPES = [
  "paragraph",
  "list",
  "key_value",
  "metrics",
  "table",
  "timeline",
  "progress",
  "choices",
  "input",
  "code",
  "sources",
  "callout",
] as const;

export type AriRenditionBlockType = typeof ARI_RENDITION_BLOCK_TYPES[number];

export interface AriUiCapabilitiesV2 {
  protocol_version: 2;
  max_schema_version: 2;
  block_version: 1;
  action_version: 1;
  block_types: AriRenditionBlockType[];
  graphic_types: string[];
  platform: "ios" | "android" | "web" | "unknown";
  app_version: string;
  runtime_version: string | null;
}

export interface AriRenditionV2 {
  schema_version: 2;
  rendition_id: string;
  kind: string;
  eyebrow?: string;
  title: string;
  body: string;
  tone?: "default" | "warning" | "danger" | "success";
  state?:
    | "loading"
    | "transitioning"
    | "ready"
    | "submitted"
    | "error"
    | "disabled";
  transition_label?: string;
  graphic?: "event" | "media" | "site" | "research" | "social";
  blocks: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
}

const BLOCK_TYPE_SET = new Set<string>(ARI_RENDITION_BLOCK_TYPES);
const PLATFORM_SET = new Set(["ios", "android", "web", "unknown"]);
const MAX_BLOCKS = 18;
const MAX_ROWS = 12;
const MAX_TEXT = 500;
const MAX_BODY = 1_500;
const SENSITIVE_KEY =
  /(token|secret|password|credential|authorization|cookie|private[_-]?key|ssn|bank|account[_-]?number)/i;
const IDENTIFIER_KEY = /(^|_)(id|uuid)$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function boundedStringArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const values = value.map((item) => boundedText(item, 80));
  return values.every((item): item is string => item !== null) ? values : null;
}

/** Strictly parse the client advertisement; malformed input becomes text-only. */
export function parseAriUiCapabilities(
  value: unknown,
): AriUiCapabilitiesV2 | null {
  const raw = record(value);
  if (
    !raw || raw.protocol_version !== 2 || raw.max_schema_version !== 2 ||
    raw.block_version !== 1 || raw.action_version !== 1 ||
    !PLATFORM_SET.has(raw.platform as string)
  ) return null;
  const blockTypes = boundedStringArray(
    raw.block_types,
    ARI_RENDITION_BLOCK_TYPES.length,
  );
  const graphicTypes = boundedStringArray(raw.graphic_types, 12);
  const appVersion = boundedText(raw.app_version, 32);
  const runtimeVersion = raw.runtime_version === null
    ? null
    : boundedText(raw.runtime_version, 64);
  if (
    !blockTypes || !graphicTypes || !appVersion ||
    runtimeVersion === null && raw.runtime_version !== null
  ) {
    return null;
  }
  if (!ARI_RENDITION_BLOCK_TYPES.every((type) => blockTypes.includes(type))) {
    return null;
  }
  return {
    protocol_version: 2,
    max_schema_version: 2,
    block_version: 1,
    action_version: 1,
    block_types: blockTypes as AriRenditionBlockType[],
    graphic_types: graphicTypes,
    platform: raw.platform as AriUiCapabilitiesV2["platform"],
    app_version: appVersion,
    runtime_version: runtimeVersion,
  };
}

export function ariRenditionsEnabled(
  envValue = Deno.env.get("ARI_RENDITION_V2_ENABLED"),
): boolean {
  return envValue !== "false" && envValue !== "0";
}

export function canRenderAriV2(
  capabilities: AriUiCapabilitiesV2 | null,
  envValue?: string,
): capabilities is AriUiCapabilitiesV2 {
  return capabilities !== null && ariRenditionsEnabled(envValue);
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(
    /\b\w/g,
    (letter) => letter.toUpperCase(),
  );
}

function safePrimitive(key: string, value: unknown): string | null {
  if (
    SENSITIVE_KEY.test(key) || IDENTIFIER_KEY.test(key) ||
    /(url|link|source)$/i.test(key)
  ) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return boundedText(value, 220);
}

function safeRows(value: unknown): { label: string; value: string }[] {
  const source = record(value);
  if (!source) return [];
  const rows: { label: string; value: string }[] = [];
  const visit = (prefix: string, entry: unknown, depth: number): void => {
    if (rows.length >= MAX_ROWS) return;
    const primitive = safePrimitive(prefix, entry);
    if (primitive !== null) {
      rows.push({ label: humanize(prefix), value: primitive });
      return;
    }
    if (depth >= 1 || SENSITIVE_KEY.test(prefix)) return;
    const nested = record(entry);
    if (!nested) return;
    for (const [key, child] of Object.entries(nested)) {
      if (rows.length >= MAX_ROWS) break;
      visit(key, child, depth + 1);
    }
  };
  for (const [key, entry] of Object.entries(source)) visit(key, entry, 0);
  return rows;
}

function safeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ROWS).map((item) => {
    if (typeof item === "string") return boundedText(item, 220);
    const rows = safeRows(item);
    return rows.length > 0
      ? rows.slice(0, 3).map((row) => `${row.label}: ${row.value}`).join(" · ")
      : null;
  }).filter((item): item is string => item !== null);
}

function findHttpsSources(
  value: unknown,
): { id: string; label: string; url: string }[] {
  const found: { id: string; label: string; url: string }[] = [];
  const seen = new Set<string>();
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 3 || found.length >= 8) return;
    if (Array.isArray(entry)) {
      entry.slice(0, 16).forEach((item) => visit(item, depth + 1));
      return;
    }
    const object = record(entry);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      if (found.length >= 8) break;
      if (typeof child === "string" && /(url|source|link)$/i.test(key)) {
        try {
          const parsed = new URL(child);
          if (parsed.protocol !== "https:" || seen.has(parsed.toString())) {
            continue;
          }
          seen.add(parsed.toString());
          found.push({
            id: `source-${found.length + 1}`,
            label: parsed.hostname.replace(/^www\./, ""),
            url: parsed.toString(),
          });
        } catch {
          // Invalid URLs never reach the presentation contract.
        }
      } else if (child !== null && typeof child === "object") {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return found;
}

function resultBlocks(
  result: unknown,
  checkedAt: string,
): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const rows = safeRows(result);
  if (rows.length > 0) {
    blocks.push({ type: "key_value", version: 1, id: "facts", rows });
  }
  const top = record(result);
  if (top) {
    for (const [key, value] of Object.entries(top)) {
      if (blocks.length >= MAX_BLOCKS - 2) break;
      const items = safeList(value);
      if (items.length > 0) {
        blocks.push({
          type: "list",
          version: 1,
          id: `list-${blocks.length + 1}`,
          title: humanize(key),
          style: "bullet",
          items,
        });
      }
    }
  } else {
    const primitive = safePrimitive("result", result);
    if (primitive) {
      blocks.push({
        type: "paragraph",
        version: 1,
        id: "result",
        text: primitive,
      });
    }
  }
  const sources = findHttpsSources(result);
  if (sources.length > 0) {
    blocks.push({ type: "sources", version: 1, id: "sources", items: sources });
  }
  blocks.push({
    type: "callout",
    version: 1,
    id: "freshness",
    tone: "default",
    title: "Freshness",
    body:
      `Checked ${checkedAt}. Open linked sources to verify time-sensitive details.`,
  });
  return blocks.slice(0, MAX_BLOCKS);
}

function graphicFor(toolName: string): AriRenditionV2["graphic"] | undefined {
  if (/(social|instagram|tiktok|youtube|creator)/.test(toolName)) {
    return "social";
  }
  if (/(research|search|competitor|market|report)/.test(toolName)) {
    return "research";
  }
  if (/(site|website)/.test(toolName)) return "site";
  if (/(media|cover|video|photo|image)/.test(toolName)) return "media";
  if (/(event|trip|experience|rsvp)/.test(toolName)) return "event";
  return undefined;
}

function stableRenditionId(prefix: string, toolName: string): string {
  const safe = toolName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(
    0,
    60,
  );
  return `${prefix}:${safe || "tool"}`;
}

export function buildToolReadRendition(args: {
  toolName: string;
  result: unknown;
  capabilities: AriUiCapabilitiesV2 | null;
  checkedAt?: string;
  envValue?: string;
}): AriRenditionV2 | null {
  if (!canRenderAriV2(args.capabilities, args.envValue)) return null;
  const checkedAt = boundedText(args.checkedAt, 80) ?? new Date().toISOString();
  return {
    schema_version: 2,
    rendition_id: stableRenditionId("read", args.toolName),
    kind: "result",
    eyebrow: "Workspace result",
    title: humanize(args.toolName),
    body: "Ari checked the available records and organized the result below.",
    state: "ready",
    ...(graphicFor(args.toolName)
      ? { graphic: graphicFor(args.toolName) }
      : {}),
    blocks: resultBlocks(args.result, checkedAt),
  };
}

export function buildToolReceiptRendition(args: {
  toolName: string;
  result: unknown;
  pendingActionId: string;
  capabilities: AriUiCapabilitiesV2 | null;
  completedAt?: string;
  envValue?: string;
}): AriRenditionV2 | null {
  if (!canRenderAriV2(args.capabilities, args.envValue)) return null;
  const completedAt = boundedText(args.completedAt, 80) ??
    new Date().toISOString();
  return {
    schema_version: 2,
    // The receipt identity links the premium card to the canonical tool row so
    // clients can render exactly one completion representation.
    rendition_id: `receipt:${args.pendingActionId}`,
    kind: "receipt",
    eyebrow: "Completed",
    title: humanize(args.toolName),
    body:
      "The confirmed action completed once and the canonical result is recorded.",
    tone: "success",
    state: "submitted",
    ...(graphicFor(args.toolName)
      ? { graphic: graphicFor(args.toolName) }
      : {}),
    blocks: [
      ...resultBlocks(args.result, completedAt),
      {
        type: "callout",
        version: 1,
        id: "receipt",
        tone: "success",
        title: "Receipt",
        body: "The confirmed request was finalized safely.",
      },
    ].slice(0, MAX_BLOCKS),
  };
}

/** Used by source-contract tests to prove every registered tool has a fallback. */
export function buildGenericProposalRendition(args: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  pendingActionId: string;
  capabilities: AriUiCapabilitiesV2 | null;
  envValue?: string;
}): AriRenditionV2 | null {
  if (!canRenderAriV2(args.capabilities, args.envValue)) return null;
  const rows = safeRows(args.toolArgs);
  return {
    schema_version: 2,
    rendition_id: stableRenditionId("proposal", args.toolName),
    kind: "proposal",
    eyebrow: "Review before confirming",
    title: humanize(args.toolName),
    body:
      "Ari prepared this action but cannot execute it without your confirmation.",
    state: "ready",
    blocks: rows.length > 0
      ? [{ type: "key_value", version: 1, id: "scope", rows }]
      : [{
        type: "callout",
        version: 1,
        id: "scope-unavailable",
        tone: "warning",
        title: "Review required",
        body:
          "No presentation-safe fields are available. Do not confirm until the scope is clear.",
      }],
    actions: [
      {
        id: "confirm",
        label: "Confirm",
        style: "primary",
        behavior: { type: "confirm", pending_action_id: args.pendingActionId },
      },
      {
        id: "cancel",
        label: "Cancel",
        style: "secondary",
        behavior: { type: "cancel", pending_action_id: args.pendingActionId },
      },
    ],
  };
}

export const ARI_RENDITION_LIMITS = Object.freeze({
  max_blocks: MAX_BLOCKS,
  max_rows_per_block: MAX_ROWS,
  max_text_length: MAX_TEXT,
  max_body_length: MAX_BODY,
  max_actions: 3,
  // agent-chat currently permits one tool call per turn. Future browser/research
  // executors must negotiate a separate plan rather than silently raising it.
  max_tool_hops_per_turn: 1,
});
