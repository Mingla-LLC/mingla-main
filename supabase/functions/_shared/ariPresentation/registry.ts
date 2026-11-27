/**
 * Issue #3355 P1 (D-5) — server-built proposal presentation.
 *
 * Every proposal the server stores carries a presentation the owner can read:
 * `{ verb, title, fields: [{ label, value }] }`. It is built here from the
 * confirmed args, table-driven (toolLabels.ts for the tool's words, ARG_LABELS
 * for argument names), and passed through the owner copy gate. Plumbing keys
 * (ids, revisions, hashes, versions, operation keys, confirm phrases,
 * server-owned context) never become a row.
 *
 * The presentation travels inside `tool_args.__proposal_context.presentation`
 * — server-owned presentation data that agent-confirm-action strips before
 * authorization and execution — so the Host card and the generic proposal
 * rendition show the same words without a protocol change.
 */

import { isOwnerSafeValue } from "../ariOwnerCopy.ts";
import { toolOwnerCopy } from "./toolLabels.ts";
import { emitOwnerText } from "../ariOwnerEmit.ts";
import { readinessItemLabel } from "../readinessCatalog.ts";
import { formatMinor } from "../money/formatMinor.ts";

export interface PresentationField {
  label: string;
  value: string;
}

export interface ProposalPresentation {
  version: 1;
  verb: string;
  title: string;
  fields: PresentationField[];
}

const MAX_FIELDS = 12;
const MAX_VALUE = 220;

/** Plumbing: never a row, in any tool. */
const HIDDEN_KEY =
  /(^__)|((^|_)(id|ids|uuid|uuids)$)|revision|version|hash|digest|fingerprint|checksum|etag|nonce|idempotency|operation|confirm_phrase|^why$|^cites$|^evidence|token|secret|password|credential|signature|^expected_|_ref$|^ref$/i;

/** Values the owner typed that must be shown exactly as written. */
const VERBATIM_KEY =
  /(email|url|link|handle|instagram|tiktok|facebook|youtube|linkedin|threads|website|slug|code|phone|address|title|name|subject|description|body|message|text|copy|note|reason)/i;

export const ARG_LABELS: Readonly<Record<string, string>> = Object.freeze({
  title: "Title",
  name: "Name",
  subject: "Subject",
  description: "Description",
  narrative: "Description",
  summary: "Summary",
  body: "Message",
  message: "Message",
  reason: "Reason",
  note: "Note",
  start_at: "Starts",
  end_at: "Ends",
  starts_at: "Starts",
  ends_at: "Ends",
  date: "Date",
  start_date: "Start date",
  end_date: "End date",
  timezone: "Time zone",
  location_text: "Where",
  address: "Address",
  city: "City",
  country_code: "Country",
  visibility: "Visibility",
  capacity: "Capacity",
  price_cents: "Price",
  amount_cents: "Amount",
  budget_cents: "Budget",
  daily_budget_cents: "Daily budget",
  currency: "Currency",
  currency_code: "Currency",
  default_currency: "Currency",
  email: "Email",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  phone_e164: "Phone",
  role: "Role",
  scope: "Scope",
  action: "Change",
  decision: "Decision",
  status: "Status",
  platform: "Platform",
  platforms: "Platforms",
  audience: "Audience",
  scheduled_at: "Send at",
  send_at: "Send at",
  page_role: "Page",
  change_summary: "Exact change",
  design_key: "Design",
  is_free: "Free",
  is_hidden: "Hidden",
  tickets: "Tickets",
  members: "People",
  tiers: "Price options",
  days: "Days",
  stops: "Stops",
  hours: "Opening hours",
  policy: "Policy",
  refund_policy: "Refund policy",
  // #3355 P2 — a checklist item shows its owner label, never its key.
  item_key: "Checklist item",
  enabled: "On",
  public: "Public",
});

function sentenceCase(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelFor(key: string): string {
  return Object.prototype.hasOwnProperty.call(ARG_LABELS, key)
    ? ARG_LABELS[key]
    : sentenceCase(key.replace(/_(cents|minor|bps|e164)$/, ""));
}

// #3355 P6 (D-28): one money formatter for Ari. The shared helper uses the
// currency's own decimals and Stripe's documented two-decimal wire form for
// ISK/UGX, so 2500 stored ISK reads "ISK 25", not "ISK 2,500".
export function formatMinorAmount(
  minor: number,
  currency: string | null,
): string {
  if (minor < 0) return `-${formatMinorAmount(-minor, currency)}`;
  return formatMinor(minor, currency, "en") ?? (minor / 100).toFixed(2);
}

/** "Lagos time" for Africa/Lagos; "UTC" when no zone is known. */
export function zoneCityLabel(timezone: string | null): string {
  if (!timezone) return "UTC";
  const city = timezone.split("/").pop()?.replace(/_/g, " ").trim();
  return city ? `${city} time` : timezone;
}

/**
 * #3355 rework 3 (R3-5): a card's date and time in the brand's own time zone,
 * the way the host says it: "Sat 19 Dec 2026, 11:59 pm Lagos time".
 */
export function formatInstant(
  value: string,
  timezone: string | null,
): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    const zone = timezone ?? "UTC";
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(instant).replace(/,/g, "");
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(instant).toLowerCase();
    return `${day}, ${time} ${zoneCityLabel(timezone)}`;
  } catch {
    return null;
  }
}

function currencyOf(args: Record<string, unknown>): string | null {
  for (const key of ["currency", "currency_code", "default_currency"]) {
    const value = args[key];
    if (typeof value === "string" && /^[A-Za-z]{3}$/.test(value)) return value;
  }
  return null;
}

function displayValue(
  key: string,
  value: unknown,
  args: Record<string, unknown>,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (/_(cents|minor)$/.test(key)) {
      return formatMinorAmount(value, currencyOf(args));
    }
    if (/_bps$/.test(key)) return `${value / 100}%`;
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (key === "item_key") return readinessItemLabel(trimmed);
    if (/(_at|^date)$/.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      // #3355 rework 3 (R3-5): the brand's zone (server proposal context)
      // when the write has no zone of its own.
      const tz = typeof args.timezone === "string"
        ? args.timezone
        : typeof args.__brand_timezone === "string"
        ? args.__brand_timezone
        : null;
      return formatInstant(trimmed, tz) ?? trimmed;
    }
    if (VERBATIM_KEY.test(key)) return trimmed.slice(0, MAX_VALUE);
    // A lowercase enum ("door_only", "public") reads as words.
    if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(trimmed)) {
      return sentenceCase(trimmed);
    }
    return trimmed.slice(0, MAX_VALUE);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every((item) => typeof item === "string")) {
      const joined = (value as string[])
        .map((item) =>
          /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(item)
            ? sentenceCase(item)
            : item
        )
        .join(", ");
      return joined.length <= MAX_VALUE
        ? joined
        : `${value.length} ${value.length === 1 ? "item" : "items"}`;
    }
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  return null;
}

/** Rows for the confirmed args: one level of nesting (e.g. `patch`), plumbing hidden. */
export function presentationFields(
  args: Record<string, unknown>,
  brandTimezone: string | null = null,
): PresentationField[] {
  const zoned = brandTimezone
    ? { ...args, __brand_timezone: brandTimezone }
    : args;
  const out: PresentationField[] = [];
  const visit = (key: string, value: unknown, depth: number): void => {
    if (out.length >= MAX_FIELDS || HIDDEN_KEY.test(key)) return;
    if (
      value !== null && typeof value === "object" && !Array.isArray(value)
    ) {
      if (depth >= 1) return;
      for (const [childKey, child] of Object.entries(value)) {
        visit(childKey, child, depth + 1);
      }
      return;
    }
    const text = displayValue(key, value, zoned);
    if (text === null || !isOwnerSafeValue(text)) return;
    const label = emitOwnerText("card_label", labelFor(key), {
      surface: "proposal_field_label",
    });
    const ownerValue = emitOwnerText("card_value", text, {
      surface: "proposal_field_value",
    });
    if (!label || !ownerValue) return;
    out.push({ label, value: ownerValue });
  };
  for (const [key, value] of Object.entries(args)) visit(key, value, 0);
  return out;
}

function identityOf(args: Record<string, unknown>): string | null {
  for (const key of ["title", "name", "subject"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 120);
    }
  }
  return null;
}

/**
 * #2830 P4 — plain-words rows the flow engine adds to a proposal it built
 * (e.g. "Design: Atelier (Mingla's default)"). Server-built only (the
 * proposal context is whitelisted), and copy-gated like every other row.
 */
function flowRows(context: unknown): PresentationField[] {
  if (
    context === null || typeof context !== "object" || Array.isArray(context)
  ) {
    return [];
  }
  const rows = (context as Record<string, unknown>).flow_rows;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 6).flatMap((row) => {
    if (row === null || typeof row !== "object") return [];
    const { label, value } = row as Record<string, unknown>;
    if (typeof label !== "string" || typeof value !== "string") return [];
    const ownerLabel = emitOwnerText("card_label", label, {
      surface: "proposal_flow_label",
    });
    const ownerValue = emitOwnerText("card_value", value.slice(0, MAX_VALUE), {
      surface: "proposal_flow_value",
    });
    return ownerLabel && ownerValue
      ? [{ label: ownerLabel, value: ownerValue }]
      : [];
  });
}

/** #3355 — the engine's own heading for its proposal, copy-gated. */
function flowTitleOf(context: unknown): string | null {
  if (
    context === null || typeof context !== "object" || Array.isArray(context)
  ) {
    return null;
  }
  const title = (context as Record<string, unknown>).flow_title;
  if (typeof title !== "string" || !title.trim()) return null;
  return emitOwnerText("card_label", title.trim().slice(0, 120), {
    surface: "proposal_flow_title",
  }) || null;
}

const isRow = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function gatedRows(
  rows: Array<[string, unknown]>,
): PresentationField[] {
  return rows.flatMap(([label, value]) => {
    if (typeof value !== "string") return [];
    const ownerLabel = emitOwnerText("card_label", label, {
      surface: "proposal_workspace_label",
    });
    const ownerValue = emitOwnerText(
      "card_value",
      value.trim().slice(0, MAX_VALUE),
      { surface: "proposal_workspace_value" },
    );
    return ownerLabel && ownerValue
      ? [{ label: ownerLabel, value: ownerValue }]
      : [];
  });
}

/**
 * #4453 Website workspace — the plan's own words as the card's rows: one row
 * per step (its plain label) and what could not be done; a team request reads
 * as what, where, why and what is missing. Null for every other tool, and for
 * args that do not carry the shape (the generic rows then apply).
 */
function siteWorkspaceRows(
  toolName: string,
  args: Record<string, unknown>,
): PresentationField[] | null {
  if (toolName === "propose_site_change_set" && Array.isArray(args.steps)) {
    const steps = args.steps.filter(isRow);
    if (steps.length === 0) return null;
    const couldnt = Array.isArray(args.couldnt)
      ? args.couldnt.filter(isRow)
      : [];
    return gatedRows([
      ...steps.map((step, index): [string, unknown] => [
        `Step ${index + 1}`,
        step.label,
      ]),
      ...couldnt.map((item): [string, unknown] => ["Not done", item.what]),
    ]);
  }
  if (toolName === "propose_website_team_request" && isRow(args.where)) {
    const where = args.where;
    const page = where.page_path === ""
      ? "Home page"
      : typeof where.page_path === "string"
      ? `/${where.page_path}`
      : null;
    return gatedRows([
      ["What you want", args.what],
      [
        "Where",
        typeof where.section_label === "string" && where.section_label.trim()
          ? `${where.section_label.trim()}${page ? `, ${page}` : ""}`
          : page,
      ],
      ["Why", args.why],
      ["What is missing", args.missing_capability],
    ]);
  }
  return null;
}

// #3355: every registered write tool has owner words and a copy-gate-clean
// presentation (I-ARI-EVERY-WRITE-HAS-PRESENTATION, declared in
// supabase/functions/_shared/__tests__/issue_3355_turn_hygiene.implementor.test.ts).
export function buildProposalPresentation(
  toolName: string,
  args: Record<string, unknown>,
): ProposalPresentation {
  const copy = toolOwnerCopy(toolName);
  const clean = { ...args };
  const context = clean.__proposal_context;
  delete clean.__proposal_context;
  const brandZone = context !== null && typeof context === "object" &&
      !Array.isArray(context) &&
      typeof (context as Record<string, unknown>).brand_timezone === "string"
    ? (context as Record<string, unknown>).brand_timezone as string
    : null;
  const workspaceRows = siteWorkspaceRows(toolName, clean);
  const planSummary = workspaceRows && toolName === "propose_site_change_set" &&
      typeof clean.summary === "string" && clean.summary.trim()
    ? clean.summary.trim().slice(0, 120)
    : null;
  const identity = identityOf(clean) ?? planSummary;
  // #3355: an engine proposal may name its own card ("Import 48 contacts").
  const flowTitle = flowTitleOf(context);
  const rawTitle = flowTitle ??
    (identity && isOwnerSafeValue(identity) ? identity : copy.title);
  const title = emitOwnerText("card_label", rawTitle, {
    fallback: copy.title,
    surface: "proposal_title",
  });
  // #3355 P7: an engine proposal whose rows are all written in plain words
  // shows only those (never raw arguments such as coordinates).
  const rowsOnly = context !== null && typeof context === "object" &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>).flow_rows_only === true &&
    flowRows(context).length > 0;
  return {
    version: 1,
    verb: emitOwnerText("card_label", copy.verb, {
      fallback: "Review this change",
      surface: "proposal_verb",
    }),
    title,
    fields: [
      ...(rowsOnly
        ? []
        : workspaceRows ?? presentationFields(clean, brandZone)),
      ...flowRows(context),
    ].slice(
      0,
      MAX_FIELDS,
    ),
  };
}

/** One sentence that makes a proposal card understandable on every client. */
export function proposalOwnerLead(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const presentation = buildProposalPresentation(toolName, args);
  const highlights = presentation.fields.slice(0, 3)
    .map((field) => `${field.label.toLowerCase()} ${field.value}`)
    .join(", ");
  return emitOwnerText(
    "reply",
    `Review ${presentation.title}${
      highlights ? `: ${highlights}` : ""
    }. Confirm to save it.`,
    {
      fallback: "Review this change. Confirm to save it.",
      surface: "proposal_lead",
    },
  );
}

/** The receipt title after a write saved. */
export function receiptTitle(toolName: string): string {
  return emitOwnerText("card_label", toolOwnerCopy(toolName).done, {
    fallback: "Saved in Mingla",
    surface: "receipt_title",
  });
}

/** Attach the presentation to proposal args (server-owned context). */
export function withProposalPresentation(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const context = args.__proposal_context !== null &&
      typeof args.__proposal_context === "object" &&
      !Array.isArray(args.__proposal_context)
    ? args.__proposal_context as Record<string, unknown>
    : {};
  return {
    ...args,
    __proposal_context: {
      ...context,
      presentation: buildProposalPresentation(toolName, args),
    },
  };
}
