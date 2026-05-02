/**
 * liveEventAdapter — LiveEvent ↔ DraftEvent view adapter + rich diff helpers (ORCH-0704 v2).
 *
 * The wizard's CreatorStepN body components consume `draft: DraftEvent`
 * via the StepBodyProps contract. EditPublishedScreen reuses those
 * step bodies to edit a published LiveEvent — but LiveEvent and
 * DraftEvent are different types. Every editable field overlaps in
 * shape (verified investigation OBS-704-2), so this adapter projects
 * a LiveEvent into a DraftEvent-shaped view object for in-memory edit.
 *
 * The view object is TRANSIENT — held in EditPublishedScreen's
 * `useState`. NEVER persisted to draftEventStore.
 *
 * Per ORCH-0704 v2 spec §3.3.3 + §3.4.5.
 */

import type {
  DraftEvent,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
} from "../store/draftEventStore";
import type { EditSeverity } from "../store/eventEditLogStore";
import type {
  EditableLiveEventFields,
  LiveEvent,
} from "../store/liveEventStore";

// ---- Adapter (LiveEvent → DraftEvent view) --------------------------

/**
 * Project a LiveEvent into a DraftEvent shape. The result is a transient
 * view object — pass to step body components, edit in local state,
 * never persist to draftEventStore.
 *
 * DraftEvent-only fields (`lastStepReached`, `status`) are stubbed:
 *   - lastStepReached: 0 (sectioned UI doesn't use it)
 *   - status: "live" (never triggers publishDraft path)
 */
export const liveEventToEditableDraft = (e: LiveEvent): DraftEvent => ({
  id: e.id,
  brandId: e.brandId,
  name: e.name,
  description: e.description,
  format: e.format,
  category: e.category,
  whenMode: e.whenMode,
  date: e.date,
  doorsOpen: e.doorsOpen,
  endsAt: e.endsAt,
  timezone: e.timezone,
  recurrenceRule: e.recurrenceRule,
  multiDates: e.multiDates,
  venueName: e.venueName,
  address: e.address,
  onlineUrl: e.onlineUrl,
  hideAddressUntilTicket: e.hideAddressUntilTicket,
  coverHue: e.coverHue,
  tickets: e.tickets,
  visibility: e.visibility,
  requireApproval: e.requireApproval,
  allowTransfers: e.allowTransfers,
  hideRemainingCount: e.hideRemainingCount,
  passwordProtected: e.passwordProtected,
  // DraftEvent-only fields (wizard-internal; stubbed for edit mode)
  lastStepReached: 0,
  status: "live" as const,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

// ---- deepEqual private helper ---------------------------------------

const deepEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// ---- Field metadata --------------------------------------------------

export const FIELD_LABELS: Record<keyof EditableLiveEventFields, string> = {
  name: "Event name",
  description: "Description",
  format: "Format",
  category: "Category",
  whenMode: "Date mode",
  date: "Date",
  doorsOpen: "Doors open",
  endsAt: "Ends at",
  timezone: "Timezone",
  recurrenceRule: "Recurrence",
  multiDates: "Multiple dates",
  venueName: "Venue",
  address: "Address",
  onlineUrl: "Online link",
  hideAddressUntilTicket: "Hide address until ticket",
  coverHue: "Cover hue",
  tickets: "Tickets",
  visibility: "Visibility",
  requireApproval: "Require approval",
  allowTransfers: "Allow transfers",
  hideRemainingCount: "Hide remaining count",
  passwordProtected: "Password protected",
};

/**
 * Material fields — when changed, fire notification stack with banner +
 * email + SMS (per `deriveChannelFlags`). Buyer-protection-significant.
 */
export const MATERIAL_KEYS: ReadonlyArray<keyof EditableLiveEventFields> = [
  "format",
  "date",
  "doorsOpen",
  "endsAt",
  "timezone",
  "venueName",
  "address",
  "onlineUrl",
  "whenMode",
  "recurrenceRule",
  "multiDates",
  "tickets",
];

/**
 * Safe fields — additive / cosmetic / forward-only. When changed alone,
 * fire banner + email but no SMS (additive severity).
 */
export const SAFE_KEYS: ReadonlyArray<keyof EditableLiveEventFields> = [
  "name",
  "description",
  "category",
  "coverHue",
  "hideAddressUntilTicket",
  "requireApproval",
  "hideRemainingCount",
  "allowTransfers",
  "passwordProtected",
  "visibility",
];

/**
 * Returns severity classification for a set of changed keys.
 * - Any material key changed → "material"
 * - Otherwise → "additive"
 *
 * "destructive" is unreachable here (those are rejected pre-apply by
 * updateLiveEventFields guard rails before recordEdit/notify are called).
 */
export const classifySeverity = (
  changedKeys: ReadonlyArray<keyof EditableLiveEventFields>,
): EditSeverity => {
  for (const k of changedKeys) {
    if (MATERIAL_KEYS.includes(k)) return "material";
  }
  return "additive";
};

// ---- editableDraftToPatch (DraftEvent → Partial<EditableLiveEventFields>) ----

/**
 * Reduces an edited DraftEvent view + the original LiveEvent to a
 * patch containing only the fields that changed.
 */
export const editableDraftToPatch = (
  original: LiveEvent,
  edited: DraftEvent,
): Partial<EditableLiveEventFields> => {
  const patch: Partial<EditableLiveEventFields> = {};
  if (original.name !== edited.name) patch.name = edited.name;
  if (original.description !== edited.description) {
    patch.description = edited.description;
  }
  if (original.format !== edited.format) patch.format = edited.format;
  if (original.category !== edited.category) patch.category = edited.category;
  if (original.whenMode !== edited.whenMode) patch.whenMode = edited.whenMode;
  if (original.date !== edited.date) patch.date = edited.date;
  if (original.doorsOpen !== edited.doorsOpen) patch.doorsOpen = edited.doorsOpen;
  if (original.endsAt !== edited.endsAt) patch.endsAt = edited.endsAt;
  if (original.timezone !== edited.timezone) patch.timezone = edited.timezone;
  if (!deepEqual(original.recurrenceRule, edited.recurrenceRule)) {
    patch.recurrenceRule = edited.recurrenceRule;
  }
  if (!deepEqual(original.multiDates, edited.multiDates)) {
    patch.multiDates = edited.multiDates;
  }
  if (original.venueName !== edited.venueName) patch.venueName = edited.venueName;
  if (original.address !== edited.address) patch.address = edited.address;
  if (original.onlineUrl !== edited.onlineUrl) patch.onlineUrl = edited.onlineUrl;
  if (original.hideAddressUntilTicket !== edited.hideAddressUntilTicket) {
    patch.hideAddressUntilTicket = edited.hideAddressUntilTicket;
  }
  if (original.coverHue !== edited.coverHue) patch.coverHue = edited.coverHue;
  if (!deepEqual(original.tickets, edited.tickets)) patch.tickets = edited.tickets;
  if (original.visibility !== edited.visibility) {
    patch.visibility = edited.visibility;
  }
  if (original.requireApproval !== edited.requireApproval) {
    patch.requireApproval = edited.requireApproval;
  }
  if (original.allowTransfers !== edited.allowTransfers) {
    patch.allowTransfers = edited.allowTransfers;
  }
  if (original.hideRemainingCount !== edited.hideRemainingCount) {
    patch.hideRemainingCount = edited.hideRemainingCount;
  }
  if (original.passwordProtected !== edited.passwordProtected) {
    patch.passwordProtected = edited.passwordProtected;
  }
  return patch;
};

// ---- Rich field diffs (for ChangeSummaryModal) ----------------------

export interface FieldDiff {
  fieldKey: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  severity?: "safe" | "material";
}

const TRUNCATE_AT = 80;

const truncate = (s: string, max: number = TRUNCATE_AT): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

const formatTicketsSummary = (tickets: TicketStub[]): string => {
  const n = tickets.length;
  return `${n} tier${n === 1 ? "" : "s"}`;
};

const formatMultiDatesSummary = (dates: MultiDateEntry[] | null): string => {
  if (dates === null) return "(none)";
  const n = dates.length;
  return `${n} date${n === 1 ? "" : "s"}`;
};

const formatRecurrenceSummary = (rule: RecurrenceRule | null): string => {
  if (rule === null) return "(none)";
  return `${rule.preset}`;
};

const formatValueForKey = (
  key: keyof EditableLiveEventFields,
  value: unknown,
): string => {
  if (value === null) return "(empty)";
  if (typeof value === "string") {
    return value.length === 0 ? "(empty)" : truncate(value);
  }
  if (typeof value === "number") {
    if (key === "coverHue") return `${value}°`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "tickets") return formatTicketsSummary(value as TicketStub[]);
  if (key === "multiDates") {
    return formatMultiDatesSummary(value as MultiDateEntry[] | null);
  }
  if (key === "recurrenceRule") {
    return formatRecurrenceSummary(value as RecurrenceRule | null);
  }
  return truncate(JSON.stringify(value));
};

/**
 * Compute per-key field diffs between original LiveEvent and edited
 * DraftEvent view. Only includes keys that actually changed.
 *
 * Each diff carries a severity hint (safe / material) used by
 * ChangeSummaryModal to render a visual cue.
 */
export const computeRichFieldDiffs = (
  original: LiveEvent,
  edited: DraftEvent,
): FieldDiff[] => {
  const diffs: FieldDiff[] = [];
  const allKeys = Object.keys(FIELD_LABELS) as Array<
    keyof EditableLiveEventFields
  >;
  for (const key of allKeys) {
    const a = original[key];
    const b = edited[key];
    if (deepEqual(a, b)) continue;
    diffs.push({
      fieldKey: String(key),
      fieldLabel: FIELD_LABELS[key],
      oldValue: formatValueForKey(key, a),
      newValue: formatValueForKey(key, b),
      severity: MATERIAL_KEYS.includes(key) ? "material" : "safe",
    });
  }
  return diffs;
};

// ---- Per-tier diffs (for ChangeSummaryModal sub-renderer) -----------

export interface TicketFieldChange {
  key: keyof TicketStub;
  oldValue: unknown;
  newValue: unknown;
}

export interface TicketDiff {
  kind: "added" | "removed" | "updated";
  ticketId: string;
  ticketName: string;
  /** For "updated": which fields changed within this tier. */
  fieldChanges?: TicketFieldChange[];
}

export const computeTicketDiffs = (
  original: TicketStub[],
  edited: TicketStub[],
): TicketDiff[] => {
  const oldById = new Map(original.map((t) => [t.id, t]));
  const newById = new Map(edited.map((t) => [t.id, t]));
  const out: TicketDiff[] = [];

  // Added + Updated
  for (const newT of edited) {
    const oldT = oldById.get(newT.id);
    if (oldT === undefined) {
      out.push({
        kind: "added",
        ticketId: newT.id,
        ticketName: newT.name.length > 0 ? newT.name : "Untitled tier",
      });
      continue;
    }
    if (!deepEqual(oldT, newT)) {
      const fieldChanges: TicketFieldChange[] = [];
      const ticketKeys = Object.keys(newT) as Array<keyof TicketStub>;
      for (const k of ticketKeys) {
        if (!deepEqual(oldT[k], newT[k])) {
          fieldChanges.push({
            key: k,
            oldValue: oldT[k],
            newValue: newT[k],
          });
        }
      }
      out.push({
        kind: "updated",
        ticketId: newT.id,
        ticketName: newT.name.length > 0 ? newT.name : "Untitled tier",
        fieldChanges,
      });
    }
  }

  // Removed
  for (const oldT of original) {
    if (!newById.has(oldT.id)) {
      out.push({
        kind: "removed",
        ticketId: oldT.id,
        ticketName: oldT.name.length > 0 ? oldT.name : "Untitled tier",
      });
    }
  }

  return out;
};

// ---- Diff summary (for notification copy) ---------------------------

/**
 * Returns human-readable lines summarising the changes — used as the
 * `diffSummary` field in NotificationPayload (email body, SMS body).
 *
 * Each line is short ("Address updated", "Date moved to 2026-06-15").
 * Tickets are summarised as a single line ("Tickets updated") rather
 * than expanded — buyers see detailed per-tier changes via the email
 * body's bulleted list separately if needed.
 */
export const computeDiffSummary = (
  original: LiveEvent,
  patch: Partial<EditableLiveEventFields>,
): string[] => {
  const lines: string[] = [];
  const keys = Object.keys(patch) as Array<keyof EditableLiveEventFields>;
  for (const key of keys) {
    const newValue = patch[key];
    const oldValue = original[key];
    if (deepEqual(oldValue, newValue)) continue;
    const label = FIELD_LABELS[key];
    if (key === "date" && typeof newValue === "string") {
      lines.push(`${label} moved to ${newValue}`);
    } else if (key === "address" || key === "venueName") {
      lines.push(`${label} updated`);
    } else if (key === "tickets") {
      lines.push("Tickets updated");
    } else if (key === "multiDates") {
      lines.push("Event dates updated");
    } else if (key === "recurrenceRule") {
      lines.push("Recurrence pattern updated");
    } else if (key === "format") {
      lines.push(`Format changed to ${String(newValue)}`);
    } else {
      lines.push(`${label} updated`);
    }
  }
  return lines;
};
