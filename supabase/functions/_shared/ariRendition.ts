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

/**
 * #2830 — the field of an `input` block. `kind` selects the Host control that
 * matches the real form: `phone` is the Brand details country chip plus a
 * local-number box (`countryIso` pre-selects the chip; `countryPlaceholder`
 * shows "Choose country" while nobody has chosen one). The Host sends the
 * chip's country back as "Country: XX" in the submission. Older clients
 * ignore `kind` and render a plain text box.
 */
export const ARI_RENDITION_INPUT_KINDS = [
  "text",
  "email",
  "url",
  "phone",
] as const;

export interface AriRenditionInputFieldV1 {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  editable?: boolean;
  confirmationPhrase?: string;
  kind?: typeof ARI_RENDITION_INPUT_KINDS[number];
  countryIso?: string;
  countryPlaceholder?: string;
}

export function isAriRenditionInputField(
  value: unknown,
): value is AriRenditionInputFieldV1 {
  const field = value !== null && typeof value === "object" &&
      !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (
    !field || typeof field.id !== "string" || !field.id ||
    typeof field.label !== "string" || !field.label ||
    field.label.length > 100 || typeof field.value !== "string" ||
    field.value.length > 1000
  ) return false;
  if (
    field.kind !== undefined &&
    !(ARI_RENDITION_INPUT_KINDS as readonly unknown[]).includes(field.kind)
  ) return false;
  if (field.countryIso !== undefined) {
    if (
      field.kind !== "phone" || typeof field.countryIso !== "string" ||
      !/^[A-Z]{2}$/.test(field.countryIso)
    ) return false;
  }
  if (
    field.countryPlaceholder !== undefined &&
    (field.kind !== "phone" || typeof field.countryPlaceholder !== "string" ||
      field.countryPlaceholder.length > 40)
  ) return false;
  return true;
}

const BLOCK_TYPE_SET = new Set<string>(ARI_RENDITION_BLOCK_TYPES);
const PLATFORM_SET = new Set(["ios", "android", "web", "unknown"]);
const MAX_BLOCKS = 18;
const MAX_ROWS = 12;
const MAX_TEXT = 500;
const MAX_BODY = 1_500;
const INTERNAL_REASONING_TOOLS = new Set([
  "search_capabilities",
  "request_tools",
]);
const PUBLIC_RESEARCH_TOOLS = new Set([
  "search_public_web",
  "read_public_url",
  "inspect_public_social_profile",
  "fetch_public_listing_page",
]);
const READ_TITLES: Readonly<Record<string, { title: string; body: string }>> = {
  list_events: {
    title: "Your events",
    body: "Here are the events Ari found in your workspace.",
  },
  list_brands: {
    title: "Your brands",
    body: "Here are the brands available to you in Mingla.",
  },
  search_public_web: {
    title: "Public research",
    body: "Here is what Ari found in public sources.",
  },
  read_public_url: {
    title: "Page research",
    body: "Here is a summary of the public page Ari read.",
  },
  inspect_public_social_profile: {
    title: "Public profile research",
    body: "Here is what Ari could verify from the public profile.",
  },
  fetch_public_listing_page: {
    title: "Listing research",
    body: "Here is what Ari found on the public listing page.",
  },
};
const SENSITIVE_KEY =
  /(token|secret|password|credential|authorization|cookie|private[_-]?key|ssn|bank|account[_-]?number)/i;
const IDENTIFIER_KEY = /(^|_)(id|uuid)$/i;
const INTERNAL_METADATA_KEY =
  /^(checked_at|fetched_at|retrieved_at|generated_at|fresh_at|cache_hit|cache_key|trace_id|request_id)$/i;

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
    INTERNAL_METADATA_KEY.test(key) ||
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
            label: boundedText(
              object.title ?? object.label ?? object.name,
              120,
            ) ?? parsed.hostname.replace(/^www\./, ""),
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
  isResearch: boolean,
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
  if (isResearch) {
    const sources = findHttpsSources(result);
    if (sources.length > 0) {
      blocks.push({
        type: "sources",
        version: 1,
        id: "sources",
        items: sources,
      });
    }
    blocks.push({
      type: "callout",
      version: 1,
      id: "freshness",
      tone: "default",
      title: "Checked just now",
      body:
        "Public information can change. Open a source to verify current details.",
    });
  }
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

const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function receiptScalar(value: unknown, humanizeValue = false): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = boundedText(value, 220);
  if (!text || UUID_VALUE.test(text) || /^https?:\/\//i.test(text)) return null;
  return humanizeValue ? humanize(text) : text;
}

function genericReceiptRows(
  result: unknown,
): { label: string; value: string }[] {
  const top = record(result);
  if (!top) return [];
  const candidates: Record<string, unknown>[] = [top];
  for (
    const key of ["event", "brand", "experience", "tier", "campaign", "page"]
  ) {
    const nested = record(top[key]);
    if (nested) candidates.push(nested);
  }
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const source of candidates) {
    for (
      const key of [
        "title",
        "name",
        "status",
        "visibility",
        "state",
        "currency",
        "amount",
        "total",
        "quantity",
        "count",
      ]
    ) {
      if (seen.has(key)) continue;
      const value = receiptScalar(
        source[key],
        ["status", "visibility", "state"].includes(key),
      );
      if (!value) continue;
      seen.add(key);
      rows.push({ label: humanize(key), value });
      if (rows.length >= 6) return rows;
    }
  }
  return rows;
}

function ticketTierReceiptRows(
  result: unknown,
): { label: string; value: string }[] {
  const top = record(result);
  if (!top) return [];
  const tier = record(top.tier) ??
    (Array.isArray(top.tiers) ? record(top.tiers[0]) : null) ?? top;
  const rows: { label: string; value: string }[] = [];
  const name = receiptScalar(tier.name);
  if (name) rows.push({ label: "Name", value: name });

  const isFree = tier.isFree === true || tier.is_free === true;
  const currency = receiptScalar(top.effective_currency ?? top.currency);
  const priceCents = typeof tier.price_cents === "number" &&
      Number.isFinite(tier.price_cents)
    ? tier.price_cents
    : typeof tier.priceGbp === "number" && Number.isFinite(tier.priceGbp)
    ? Math.round(tier.priceGbp * 100)
    : null;
  if (isFree) {
    rows.push({ label: "Price", value: "Free" });
  } else if (priceCents !== null) {
    const amount = new Intl.NumberFormat("en", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(priceCents / 100);
    rows.push({
      label: "Price",
      value: currency ? `${currency} ${amount}` : amount,
    });
  }

  if (tier.isUnlimited === true || tier.is_unlimited === true) {
    rows.push({ label: "Capacity", value: "Unlimited" });
  } else if (
    typeof tier.capacity === "number" &&
    Number.isInteger(tier.capacity) && tier.capacity > 0
  ) {
    rows.push({ label: "Capacity", value: String(tier.capacity) });
  } else if (
    typeof tier.quantity_total === "number" &&
    Number.isInteger(tier.quantity_total) && tier.quantity_total > 0
  ) {
    rows.push({ label: "Capacity", value: String(tier.quantity_total) });
  }

  const visibility = tier.is_disabled === true
    ? "Disabled"
    : tier.is_hidden === true
    ? "Hidden"
    : receiptScalar(tier.visibility, true) ?? "Public";
  rows.push({ label: "Visibility", value: visibility });
  return rows.slice(0, 6);
}

function formatEventSchedule(
  startAt: unknown,
  endAt: unknown,
  timezone: unknown,
): string | null {
  const start = boundedText(startAt, 80);
  const zone = boundedText(timezone, 100);
  if (!start || !zone) return null;
  const instant = new Date(start);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    const formatDateTime = (value: Date) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...(zone === "Africa/Lagos" ? {} : { timeZoneName: "short" as const }),
      }).format(value);
    const startText = `${formatDateTime(instant)}${
      zone === "Africa/Lagos" ? " WAT" : ""
    }`;
    const end = boundedText(endAt, 80);
    if (!end) return startText;
    const endInstant = new Date(end);
    if (Number.isNaN(endInstant.getTime())) return startText;
    const dayKey = (value: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(value);
    const endText = dayKey(instant) === dayKey(endInstant)
      ? new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        minute: "2-digit",
        ...(zone === "Africa/Lagos" ? {} : { timeZoneName: "short" as const }),
      }).format(endInstant)
      : formatDateTime(endInstant);
    return `${startText} – ${endText}${zone === "Africa/Lagos" ? " WAT" : ""}`;
  } catch {
    return null;
  }
}

function eventReceiptPresentation(args: {
  result: unknown;
  toolArgs?: Record<string, unknown>;
  brandName?: string | null;
}): {
  title: string;
  body: string;
  blocks: Record<string, unknown>[];
} | null {
  const event = record(record(args.result)?.event);
  if (!event) return null;
  const title = receiptScalar(event.title ?? args.toolArgs?.title);
  if (!title) return null;
  const businessDraft = record(record(event.theme)?.business_draft);
  const when = record(businessDraft?.when);
  const timezone = receiptScalar(
    when?.timezone ?? event.timezone ?? args.toolArgs?.timezone,
  );
  const schedule = formatEventSchedule(
    args.toolArgs?.start_at,
    args.toolArgs?.end_at,
    timezone,
  );
  const location = receiptScalar(args.toolArgs?.location_text);
  const description = receiptScalar(args.toolArgs?.description);
  const requestedVisibility = receiptScalar(
    businessDraft?.requestedVisibility ?? args.toolArgs?.visibility,
    true,
  );
  const resultTicketRows = Array.isArray(businessDraft?.tickets)
    ? businessDraft.tickets
    : [];
  const confirmedTicketRows = Array.isArray(args.toolArgs?.tickets)
    ? args.toolArgs.tickets
    : [];
  // Some create paths return the event row before the compatibility draft is
  // read back. An empty result array must not erase admission that the host
  // explicitly reviewed and confirmed in the protected proposal.
  const ticketRows = resultTicketRows.length > 0
    ? resultTicketRows
    : confirmedTicketRows;
  const limitedCapacity = ticketRows.reduce((total, raw) => {
    const ticket = record(raw);
    const capacity = ticket?.capacity;
    return typeof capacity === "number" && Number.isInteger(capacity) &&
        capacity > 0
      ? total + capacity
      : total;
  }, 0);
  const allFree = ticketRows.length > 0 &&
    ticketRows.every((raw) => record(raw)?.isFree === true);
  const rows: { label: string; value: string }[] = [
    { label: "Event", value: title },
    { label: "Status", value: "Draft — not published" },
    ...(schedule ? [{ label: "Date and time", value: schedule }] : []),
    ...(location ? [{ label: "Location", value: location }] : []),
    ...(description ? [{ label: "Event copy", value: description }] : []),
    ...(args.brandName
      ? [{ label: "Brand", value: args.brandName.slice(0, 120) }]
      : []),
    ...(requestedVisibility
      ? [{
        label: "Visibility",
        value: `${requestedVisibility} when published`,
      }]
      : []),
    ...(limitedCapacity > 0
      ? [{
        label: "Admission",
        value: `${limitedCapacity} guests${allFree ? " · Free" : ""}`,
      }]
      : []),
  ];
  return {
    title: `“${title}” is saved as a draft`,
    body:
      "This is the event now recorded in Mingla. It is still private to the host workspace until you choose to publish it.",
    blocks: [
      { type: "key_value", version: 1, id: "event-receipt", rows },
      {
        type: "callout",
        version: 1,
        id: "next-step",
        tone: "default",
        title: "Next",
        body: ticketRows.length > 0 && args.toolArgs?.end_at && location &&
            description
          ? "Review the saved details and add a cover before publishing."
          : ticketRows.length > 0
          ? "Add the remaining event details and cover before publishing."
          : "Add the remaining event details, tickets and cover before publishing.",
      },
    ],
  };
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
  // Toolset negotiation and capability search are private reasoning steps. A
  // user should see Ari's answer, never its internal discovery payload.
  if (INTERNAL_REASONING_TOOLS.has(args.toolName)) return null;
  const research = PUBLIC_RESEARCH_TOOLS.has(args.toolName);
  const presentation = READ_TITLES[args.toolName];
  return {
    schema_version: 2,
    rendition_id: stableRenditionId("read", args.toolName),
    kind: "result",
    eyebrow: research ? "Public research" : "Mingla workspace",
    title: presentation?.title ?? humanize(args.toolName),
    body: presentation?.body ??
      (research
        ? "Here is the information Ari found."
        : "Here are the matching records from your Mingla workspace."),
    state: "ready",
    ...(graphicFor(args.toolName)
      ? { graphic: graphicFor(args.toolName) }
      : {}),
    blocks: resultBlocks(args.result, research),
  };
}

export function buildToolReceiptRendition(args: {
  toolName: string;
  result: unknown;
  toolArgs?: Record<string, unknown>;
  brandName?: string | null;
  pendingActionId: string;
  capabilities: AriUiCapabilitiesV2 | null;
  completedAt?: string;
  envValue?: string;
}): AriRenditionV2 | null {
  if (!canRenderAriV2(args.capabilities, args.envValue)) return null;
  const eventPresentation = args.toolName === "create_event"
    ? eventReceiptPresentation(args)
    : null;
  const genericRows = args.toolName === "upsert_ticket_tier"
    ? ticketTierReceiptRows(args.result)
    : genericReceiptRows(args.result);
  return {
    schema_version: 2,
    // The receipt identity links the premium card to the canonical tool row so
    // clients can render exactly one completion representation.
    rendition_id: `receipt:${args.pendingActionId}`,
    kind: "receipt",
    eyebrow: eventPresentation ? "Event draft" : "Saved in Mingla",
    title: eventPresentation?.title ?? humanize(args.toolName),
    body: eventPresentation?.body ??
      "The saved result below was read back from Mingla.",
    tone: "success",
    state: "submitted",
    ...(graphicFor(args.toolName)
      ? { graphic: graphicFor(args.toolName) }
      : {}),
    blocks: eventPresentation?.blocks ?? [
      ...(genericRows.length > 0
        ? [{ type: "key_value", version: 1, id: "receipt", rows: genericRows }]
        : []),
      {
        type: "callout",
        version: 1,
        id: "canonical-result",
        tone: "success",
        title: "Recorded in Mingla",
        body: "The saved result is shown above.",
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
