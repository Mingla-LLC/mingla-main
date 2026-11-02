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

import {
  assertOwnerCopy,
  isOwnerSafe,
  isOwnerSafeValue,
} from "../ariOwnerCopy.ts";
import { toolOwnerCopy } from "./toolLabels.ts";
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

function formatInstant(value: string, timezone: string | null): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone ?? "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(instant);
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
      const tz = typeof args.timezone === "string" ? args.timezone : null;
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
): PresentationField[] {
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
    const text = displayValue(key, value, args);
    if (text === null || !isOwnerSafeValue(text)) return;
    const label = labelFor(key);
    if (!isOwnerSafe(label, "label")) return;
    out.push({ label, value: text });
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
    if (
      typeof label !== "string" || typeof value !== "string" ||
      !label.trim() || !value.trim() || !isOwnerSafe(label, "label") ||
      !isOwnerSafeValue(value)
    ) return [];
    return [{ label: label.trim(), value: value.trim().slice(0, MAX_VALUE) }];
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
  const trimmed = title.trim().slice(0, 120);
  return isOwnerSafe(trimmed, "label") ? trimmed : null;
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
  const identity = identityOf(clean);
  // #3355: an engine proposal may name its own card ("Import 48 contacts").
  const flowTitle = flowTitleOf(context);
  const title = flowTitle ??
    (identity && isOwnerSafeValue(identity) ? identity : copy.title);
  // #3355 P7: an engine proposal whose rows are all written in plain words
  // shows only those (never raw arguments such as coordinates).
  const rowsOnly = context !== null && typeof context === "object" &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>).flow_rows_only === true &&
    flowRows(context).length > 0;
  return {
    version: 1,
    verb: assertOwnerCopy(copy.verb, {
      fallback: "Review this change",
      surface: "proposal_verb",
    }),
    title,
    fields: [
      ...(rowsOnly ? [] : presentationFields(clean)),
      ...flowRows(context),
    ].slice(
      0,
      MAX_FIELDS,
    ),
  };
}

/** The receipt title after a write saved. */
export function receiptTitle(toolName: string): string {
  return assertOwnerCopy(toolOwnerCopy(toolName).done, {
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
