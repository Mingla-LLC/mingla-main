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
  serverSlug: e.eventSlug,
  name: e.name,
  description: e.description,
  format: e.format,
  // ORCH-0824 HOTFIX: populate new taxonomy fields with defensive defaults
  // when editing a legacy LiveEvent that predates ORCH-0824 (those
  // entries in Zustand persistence have no partyTypes/vibeTags/musicGenres
  // — using nullish coalescing produces empty arrays so the validator
  // doesn't crash on `.length`. The legacy `category` is read-only and
  // intentionally NOT auto-mapped to partyTypes; the user re-picks on
  // republish to ensure structured taxonomy values are honest.
  partyTypes: e.partyTypes ?? [],
  vibeTags: e.vibeTags ?? [],
  musicGenres: e.musicGenres ?? [],
  // ORCH-0824: city + locationGeo populated by Google Places autocomplete
  // at publish; legacy LiveEvents have neither — user re-picks address
  // on republish via the new autocomplete (validator enforces).
  city: e.city ?? null,
  locationGeo: e.locationGeo ?? null,
  whenMode: e.whenMode,
  date: e.date,
  doorsOpen: e.doorsOpen,
  endsAt: e.endsAt,
  // ORCH-0877 — propagate the smart-inferred UTC end-instant from the live
  // event into the draft so cross-midnight wrap survives the edit-published
  // round-trip until the next refetch populates `masterEndAtUtc` again.
  endsAtUtc: e.masterEndAtUtc ?? null,
  timezone: e.timezone,
  recurrenceRule: e.recurrenceRule,
  multiDates: e.multiDates,
  venueName: e.venueName,
  address: e.address,
  onlineUrl: e.onlineUrl,
  hideAddressUntilTicket: e.hideAddressUntilTicket,
  coverHue: e.coverHue,
  coverMediaUrl: e.coverMediaUrl,
  coverMediaType: e.coverMediaType,
  coverMediaProvider: e.coverMediaProvider ?? null,
  coverMediaSourceUrl: e.coverMediaSourceUrl ?? null,
  coverMediaCredit: e.coverMediaCredit ?? null,
  coverMediaCreditUrl: e.coverMediaCreditUrl ?? null,
  coverMediaAlt: e.coverMediaAlt ?? null,
  tickets: e.tickets,
  visibility: e.visibility,
  requireApproval: e.requireApproval,
  allowTransfers: e.allowTransfers,
  hideRemainingCount: e.hideRemainingCount,
  passwordProtected: e.passwordProtected,
  themeOverrides: e.themeOverrides ?? null,
  privateGuestList: e.privateGuestList,
  inPersonPaymentsEnabled: e.inPersonPaymentsEnabled,
  // ORCH-1150 — project the RSVP host-control snapshot into the editable
  // DraftEvent view. Non-RSVP LiveEvents lack these → defaults (inert when
  // isRsvp=false). The RSVP edit-published screen reads them via this view.
  isRsvp: e.event_type === "rsvp",
  rsvpCapacity: e.rsvpCapacity ?? null,
  rsvpAllowPlusOnes: e.rsvpAllowPlusOnes ?? false,
  rsvpPlusOnesMax: e.rsvpPlusOnesMax ?? 0,
  rsvpWaitlistEnabled: e.rsvpWaitlistEnabled ?? false,
  rsvpApprovalMode: e.rsvpApprovalMode ?? "auto",
  rsvpDiscoverable: e.rsvpDiscoverable ?? false,
  // ORCH-1006 — pricing switches; legacy events predate the field → all-inherit.
  pricingSwitches: e.pricingSwitches ?? {
    passTax: null,
    passMinglaFee: null,
    passServiceFee: null,
  },
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
  coverMediaUrl: "Cover media",
  coverMediaType: "Cover media type",
  coverMediaProvider: "Cover media provider",
  coverMediaSourceUrl: "Cover media source",
  coverMediaCredit: "Cover media credit",
  coverMediaCreditUrl: "Cover media credit URL",
  coverMediaAlt: "Cover media alt text",
  tickets: "Tickets",
  visibility: "Visibility",
  requireApproval: "Require approval",
  allowTransfers: "Allow transfers",
  hideRemainingCount: "Hide remaining count",
  passwordProtected: "Password protected",
  themeOverrides: "Public theme",
  privateGuestList: "Private guest list",
  inPersonPaymentsEnabled: "In-person payments",
  // ORCH-0824 hotfix
  partyTypes: "Party types",
  vibeTags: "Vibe tags",
  musicGenres: "Music genres",
  city: "City",
  locationGeo: "Map location",
  // ORCH-1006
  pricingSwitches: "Who covers costs",
  // ORCH-1172 — RSVP host-control labels (surface in the ChangeSummaryModal
  // + drive the rsvp-setup "Edited" indicator).
  rsvpCapacity: "Guest limit",
  rsvpAllowPlusOnes: "Allow extras",
  rsvpPlusOnesMax: "Max extras per guest",
  rsvpWaitlistEnabled: "Waitlist",
  rsvpApprovalMode: "Approval mode",
  rsvpDiscoverable: "Discoverable",
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
  "coverMediaUrl",
  "coverMediaType",
  "coverMediaProvider",
  "coverMediaSourceUrl",
  "coverMediaCredit",
  "coverMediaCreditUrl",
  "coverMediaAlt",
  "hideAddressUntilTicket",
  "requireApproval",
  "hideRemainingCount",
  "allowTransfers",
  "passwordProtected",
  "themeOverrides",
  "visibility",
  "privateGuestList",
  // ORCH-0824 hotfix: taxonomy + city are additive/cosmetic for buyer
  // protection purposes (they affect Discover filtering, not ticket
  // legitimacy). Banner-only notification when changed alone.
  "partyTypes",
  "vibeTags",
  "musicGenres",
  "city",
  "locationGeo",
  // ORCH-1172 — RSVP host-controls are additive (RSVP is moneyless — no buyers
  // to protect). They must NOT be in MATERIAL_KEYS (which would imply ticket-
  // buyer SMS). The biz_update_live_rsvp RPC owns its own going-guest notify.
  "rsvpCapacity",
  "rsvpAllowPlusOnes",
  "rsvpPlusOnesMax",
  "rsvpWaitlistEnabled",
  "rsvpApprovalMode",
  "rsvpDiscoverable",
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
  // ORCH-0824: `category` was removed from DraftEvent (replaced by
  // partyTypes/vibeTags/musicGenres). LiveEvent.category remains as a
  // read-only legacy field (cleanup target: ORCH-0824-D). Skipping the
  // diff here prevents `patch.category = undefined` from polluting the
  // patch and tripping the isServerEditableOnlyPatch gate.
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
  if (original.coverMediaUrl !== edited.coverMediaUrl) {
    patch.coverMediaUrl = edited.coverMediaUrl;
  }
  if (original.coverMediaType !== edited.coverMediaType) {
    patch.coverMediaType = edited.coverMediaType;
  }
  if (original.coverMediaProvider !== edited.coverMediaProvider) {
    patch.coverMediaProvider = edited.coverMediaProvider ?? null;
  }
  if (original.coverMediaSourceUrl !== edited.coverMediaSourceUrl) {
    patch.coverMediaSourceUrl = edited.coverMediaSourceUrl ?? null;
  }
  if (original.coverMediaCredit !== edited.coverMediaCredit) {
    patch.coverMediaCredit = edited.coverMediaCredit ?? null;
  }
  if (original.coverMediaCreditUrl !== edited.coverMediaCreditUrl) {
    patch.coverMediaCreditUrl = edited.coverMediaCreditUrl ?? null;
  }
  if (original.coverMediaAlt !== edited.coverMediaAlt) {
    patch.coverMediaAlt = edited.coverMediaAlt ?? null;
  }
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
  if (!deepEqual(original.themeOverrides ?? null, edited.themeOverrides ?? null)) {
    patch.themeOverrides = edited.themeOverrides ?? null;
  }
  if (original.privateGuestList !== edited.privateGuestList) {
    patch.privateGuestList = edited.privateGuestList;
  }
  // Cycle 12 rework — patch builder must include the door-sales toggle.
  // Phase 1 wired this field into FIELD_LABELS + the snapshot extract +
  // the editable-keys union but missed the patch check, so toggling fell
  // through to "No changes to save" silently. Mirrors privateGuestList.
  if (original.inPersonPaymentsEnabled !== edited.inPersonPaymentsEnabled) {
    patch.inPersonPaymentsEnabled = edited.inPersonPaymentsEnabled;
  }
  // ORCH-0824 hotfix: diff the new taxonomy + city + locationGeo fields.
  // Arrays compared via deepEqual (slug order is not stable). Without
  // these checks, toggling a Party Type / Vibe / Music Genre pill on
  // an existing event produces an empty patch and the Save button
  // stays disabled (same root cause as the Cycle-12 inPersonPayments bug).
  // Originals may be undefined on legacy LiveEvents — fall back to []
  // for arrays, null for scalars, to make the diff honest.
  const origPartyTypes = original.partyTypes ?? [];
  if (!deepEqual(origPartyTypes, edited.partyTypes)) {
    patch.partyTypes = edited.partyTypes;
  }
  const origVibeTags = original.vibeTags ?? [];
  if (!deepEqual(origVibeTags, edited.vibeTags)) {
    patch.vibeTags = edited.vibeTags;
  }
  const origMusicGenres = original.musicGenres ?? [];
  if (!deepEqual(origMusicGenres, edited.musicGenres)) {
    patch.musicGenres = edited.musicGenres;
  }
  const origCity = original.city ?? null;
  if (origCity !== edited.city) {
    patch.city = edited.city;
  }
  const origLocationGeo = original.locationGeo ?? null;
  if (!deepEqual(origLocationGeo, edited.locationGeo)) {
    patch.locationGeo = edited.locationGeo;
  }
  // ORCH-1006 — diff the pricing switches (who covers VAT/Mingla fee/service
  // fee). Without this, toggling a switch on a published event produces an
  // empty patch and Save stays disabled — same root cause as the Cycle-12
  // inPersonPayments + ORCH-0824 taxonomy bugs. Legacy events have no switches
  // → treat as all-inherit so the diff is honest.
  const origSwitches = original.pricingSwitches ?? {
    passTax: null,
    passMinglaFee: null,
    passServiceFee: null,
  };
  if (
    edited.pricingSwitches !== undefined &&
    !deepEqual(origSwitches, edited.pricingSwitches)
  ) {
    patch.pricingSwitches = edited.pricingSwitches;
  }
  // ORCH-1172 — diff the 6 core RSVP host-controls so capacity/plus-ones/
  // waitlist/approval/discoverable changes reach biz_update_live_rsvp (BUG-B:
  // these were never diffed, so every change was silently dropped). Originals
  // are undefined on non-RSVP / legacy LiveEvents → coalesce to the create-
  // wizard defaults (null capacity / false / 0 / "auto") so the diff is honest.
  const origRsvpCapacity = original.rsvpCapacity ?? null;
  if (origRsvpCapacity !== edited.rsvpCapacity) {
    patch.rsvpCapacity = edited.rsvpCapacity;
  }
  const origRsvpAllowPlusOnes = original.rsvpAllowPlusOnes ?? false;
  if (origRsvpAllowPlusOnes !== edited.rsvpAllowPlusOnes) {
    patch.rsvpAllowPlusOnes = edited.rsvpAllowPlusOnes;
  }
  const origRsvpPlusOnesMax = original.rsvpPlusOnesMax ?? 0;
  if (origRsvpPlusOnesMax !== edited.rsvpPlusOnesMax) {
    patch.rsvpPlusOnesMax = edited.rsvpPlusOnesMax;
  }
  const origRsvpWaitlistEnabled = original.rsvpWaitlistEnabled ?? false;
  if (origRsvpWaitlistEnabled !== edited.rsvpWaitlistEnabled) {
    patch.rsvpWaitlistEnabled = edited.rsvpWaitlistEnabled;
  }
  const origRsvpApprovalMode = original.rsvpApprovalMode ?? "auto";
  if (origRsvpApprovalMode !== edited.rsvpApprovalMode) {
    patch.rsvpApprovalMode = edited.rsvpApprovalMode;
  }
  const origRsvpDiscoverable = original.rsvpDiscoverable ?? false;
  if (origRsvpDiscoverable !== edited.rsvpDiscoverable) {
    patch.rsvpDiscoverable = edited.rsvpDiscoverable;
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
  // Cycle 12 rework — undefined guard. Pre-Cycle-10 published events
  // can carry undefined for fields added after the persist version they
  // were stored under (e.g., privateGuestList added in Cycle 10 with no
  // migrate). Without this guard, the JSON.stringify(undefined) fallback
  // returns the literal value `undefined`, then truncate(undefined).length
  // crashes the EditPublishedScreen render. Treat undefined the same as
  // null (both render as "(empty)").
  if (value === undefined) return "(empty)";
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
    // ORCH-0824: `category` was removed from DraftEvent; skip the diff
    // so an empty edited.category (undefined) doesn't show as a spurious
    // change against legacy LiveEvent.category values. Cleanup target:
    // ORCH-0824-D (when LiveEvent.category is removed entirely).
    if (key === "category") continue;
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
