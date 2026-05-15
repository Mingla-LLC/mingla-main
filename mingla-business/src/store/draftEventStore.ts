/**
 * draftEventStore — persisted Zustand store for in-progress event drafts.
 *
 * Cycle 3 introduces this sibling to currentBrandStore. Drafts are owned
 * here, NOT on the Brand object — Brand schema is mature and stable;
 * drafts churn at a different cadence and per a different domain. The
 * currentBrandStore docstring (line 167-171) explicitly anticipated this
 * split when it added the J-A12 BrandEventStub field for finance reports.
 *
 * Constitutional note (Constitution #6): logout MUST clear all drafts.
 * Wired via `clearAllStores()` utility called from `AuthContext.signOut()`
 * + `onAuthStateChange` SIGNED_OUT branch.
 *
 * Constitutional note (#2 one owner per truth): Supabase `events.status='draft'`
 * is the durable source for server-backed drafts. This store is now the
 * immediate UI cache + legacy local-draft migration source.
 *
 * [TRANSITIONAL] Zustand persist holds all drafts client-side. B-cycle
 * migrates drafts to server-side storage; this store contracts to a
 * cache + ID-only when backend lands.
 *
 * Per Cycle 3 spec §3.1; Cycle 4 spec §3.1 expands schema v2→v3 for
 * recurring + multi-date events (additive — single-mode unchanged).
 */

import { useMemo } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import { generateDraftId } from "../utils/draftEventId";
import { convertDraftToLiveEvent } from "../utils/liveEventConverter";
import {
  draftClientRevision,
  shouldApplyServerDraft,
  type DraftEditMeta,
} from "../utils/serverDraftAutosaveGuards";
import type { EventCoverMediaProvider } from "../types/eventCoverProvider";
import type { LiveEvent } from "./liveEventStore";

/**
 * Detect device's IANA timezone via Intl. Falls back to "Europe/London"
 * if the runtime can't resolve (extremely rare on Hermes/V8). Called at
 * draft creation time so each new draft inherits the device's local
 * zone — user can override via the Step 2 timezone sheet picker.
 *
 * Per Cycle 3 rework v2 Fix #4.
 */
const detectDeviceTimezone = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 ? tz : "Europe/London";
  } catch {
    return "Europe/London";
  }
};

/**
 * Ticket card visibility on the public event page. Cycle 5 (schema v4).
 *   - "public":   shown to everyone on the public page (default)
 *   - "hidden":   only shown via direct link with token (skipped on public list)
 *   - "disabled": shown but greyed out + "Sales paused" pill; not purchasable
 */
export type TicketVisibility = "public" | "hidden" | "disabled";

/**
 * Cycle 12 — controls which checkout surface this tier appears on. I-30.
 *   - "online": only visible at /checkout/{eventId} buyer flow.
 *   - "door":   only visible at /event/{id}/door door-sale flow.
 *   - "both":   visible everywhere (default for migrated tiers).
 */
export type TicketAvailableAt = "online" | "door" | "both";

export interface TicketStub {
  id: string;
  name: string;
  /** Null when isFree=true; otherwise positive major-unit price. */
  priceGbp: number | null;
  /** ISO 4217 event/ticket currency. Undefined means inherit the event. */
  currency?: string;
  /**
   * Positive integer when constrained; null is allowed semantically but
   * only when `isUnlimited` is true. Validation rejects null capacity
   * when `isUnlimited` is false.
   */
  capacity: number | null;
  isFree: boolean;
  /**
   * When true, this ticket has no capacity limit. NEW in Cycle 3 rework
   * v3 schema v2.
   */
  isUnlimited: boolean;
  // ---- Cycle 5 modifiers (schema v4 — additive, layered booleans) ----
  /** Public/hidden/disabled — see TicketVisibility comment. Default "public". */
  visibility: TicketVisibility;
  /**
   * Sort order within an event (0..N-1). Auto-managed by reorder UI.
   * NEVER mutated outside `ticketDisplay.ts` helpers (renormalize/move).
   */
  displayOrder: number;
  /** When true, buyers request access; organiser approves/rejects (Cycle 10/B4). */
  approvalRequired: boolean;
  /** When true, buyer must enter `password` on the public page to unlock checkout. */
  passwordProtected: boolean;
  /**
   * Local-only cleartext. Never persist to server draft JSON. Server-recovered
   * password-protected tickets use passwordConfigured=true + password=null.
   */
  password: string | null;
  /** True when the server has a password hash/configuration we cannot reveal. */
  passwordConfigured?: boolean;
  /**
   * When true, buyer can join a waitlist when capacity is reached.
   * Real waitlist UX/emails land Cycle 10 + B5.
   */
  waitlistEnabled: boolean;
  /** Minimum tickets per buyer transaction. Default 1. */
  minPurchaseQty: number;
  /** Maximum tickets per buyer transaction. null = no cap. Default null. */
  maxPurchaseQty: number | null;
  /** When true, buyer can transfer ticket to another email/identity. Default true. */
  allowTransfers: boolean;
  // ---- Cycle 6 (5b absorption — schema v4 → v5, additive) ----
  /**
   * Optional description of what this ticket includes (e.g. "VIP includes
   * dinner + early entry + meet-and-greet"). Buyer-facing; rendered on
   * the public event page. Max ~280 chars (UI-enforced; not validated).
   */
  description: string | null;
  /**
   * ISO 8601 datetime — when sales open for this ticket. null = no
   * pre-sale window (sales open at publish time). Drives the J-P3
   * pre-sale variant on the public event page.
   */
  saleStartAt: string | null;
  /**
   * ISO 8601 datetime — when sales close for this ticket. null = no
   * end (sales open until event date). UI-enforced ordering: must be
   * after saleStartAt if both set.
   */
  saleEndAt: string | null;
  // ---- Cycle 12 (schema v6 — additive) ----
  /**
   * I-30 enforced — controls which checkout surface this tier appears on.
   * Online checkout filters availableAt !== "door"; door sale flow filters
   * availableAt !== "online". AddCompGuestSheet filters availableAt === "both".
   * Default "both" for migrated tiers (additive, safe).
   */
  availableAt: TicketAvailableAt;
}

export type DraftEventFormat = "in_person" | "online" | "hybrid";
export type DraftEventVisibility = "public" | "unlisted" | "private";
export type DraftEventStatus = "draft" | "publishing" | "live";
export type EventCoverMediaType = "image" | "video" | "gif";

// ---- Cycle 4 — recurring + multi-date types (NEW) -------------------

export type WhenMode = "single" | "recurring" | "multi_date";

export type RecurrencePreset =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly_dom"   // monthly by day-of-month, e.g. "every 15th"
  | "monthly_dow"; // monthly by weekday, e.g. "every 1st Monday"

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** 1=first, 2=second, 3=third, 4=fourth, -1=last week of the month. */
export type SetPos = 1 | 2 | 3 | 4 | -1;

export type RecurrenceTermination =
  | { kind: "count"; count: number }       // 1..52
  | { kind: "until"; until: string };      // ISO YYYY-MM-DD; max 1 year from first

export interface RecurrenceRule {
  preset: RecurrencePreset;
  /** Required for weekly, biweekly, monthly_dow. */
  byDay?: Weekday;
  /** Required for monthly_dom (1-28; clamped to 28 to avoid Feb-30 weirdness). */
  byMonthDay?: number;
  /** Required for monthly_dow. */
  bySetPos?: SetPos;
  termination: RecurrenceTermination;
}

export interface MultiDateOverrides {
  title: string | null;
  description: string | null;
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;
}

export interface MultiDateEntry {
  id: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** HH:MM 24-hour. */
  startTime: string;
  /** HH:MM 24-hour. */
  endTime: string;
  overrides: MultiDateOverrides;
}

// ---- DraftEvent (v3) ------------------------------------------------

export interface DraftEvent {
  id: string;
  brandId: string;
  /** Supabase events.slug for server-backed drafts. Null only for legacy local drafts. */
  serverSlug: string | null;
  // Step 1 — Basics
  name: string;
  description: string;
  format: DraftEventFormat;
  /**
   * ORCH-0824: replaces the deprecated free-form `category` field.
   * Multi-select party type slugs from `eventTaxonomy.PARTY_TYPES`.
   * Required at publish (`partyTypes.length >= 1`). Persisted to
   * `events.party_types` (top-level text[] column).
   */
  partyTypes: string[];
  /**
   * ORCH-0824: multi-select vibe tag slugs from `eventTaxonomy.VIBE_TAGS`.
   * Optional at publish. Persisted to `events.vibe_tags`.
   */
  vibeTags: string[];
  /**
   * ORCH-0824: multi-select Mingla music genre slugs from
   * `eventTaxonomy.MUSIC_GENRES`. Optional at publish. Persisted to
   * `events.music_genres`.
   */
  musicGenres: string[];
  // Step 2 — When (Cycle 4 v3 — replaces `repeats`)
  /**
   * Mode of the When step. "single" = one date (Cycle 3 default behavior).
   * "recurring" = pattern from RecurrenceRule. "multi_date" = explicit
   * list in `multiDates`. NEW in Cycle 4.
   */
  whenMode: WhenMode;
  /**
   * ISO YYYY-MM-DD. In single mode: the event date. In recurring mode:
   * first occurrence. In multi_date mode: ignored — see `multiDates[0]`.
   */
  date: string | null;
  /** HH:mm 24-hour. */
  doorsOpen: string | null;
  /** HH:mm 24-hour. */
  endsAt: string | null;
  /** Default = device timezone (Europe/London fallback). */
  timezone: string;
  /** Non-null only when whenMode === "recurring". NEW Cycle 4. */
  recurrenceRule: RecurrenceRule | null;
  /**
   * Non-null only when whenMode === "multi_date". Length 0..24
   * (validation enforces ≥2 to publish). Auto-sorted chronologically.
   * NEW Cycle 4.
   */
  multiDates: MultiDateEntry[] | null;
  // Step 3 — Where
  venueName: string | null;
  address: string | null;
  /**
   * ORCH-0824: normalized city (locality) extracted from Google Places
   * autocomplete pick. Persisted to `events.city` at publish. Required
   * at publish — buyer-side Discover filtering joins on this column.
   */
  city: string | null;
  /**
   * ORCH-0824: structured lat/lng from Google Places autocomplete pick.
   * Persisted to `events.location_geo` at publish.
   */
  locationGeo: { lat: number; lng: number } | null;
  /** Used when format ∈ {"online", "hybrid"}. */
  onlineUrl: string | null;
  /** When true (default), address hidden until ticket purchase. */
  hideAddressUntilTicket: boolean;
  // Step 4 — Cover
  /** Hue 0-360 for EventCover. Default 25 (warm orange). */
  coverHue: number;
  /** Canonical uploaded cover media URL. Null falls back to coverHue. */
  coverMediaUrl: string | null;
  /** Type for coverMediaUrl. Null when no uploaded media is present. */
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider?: EventCoverMediaProvider | null;
  coverMediaSourceUrl?: string | null;
  coverMediaCredit?: string | null;
  coverMediaCreditUrl?: string | null;
  coverMediaAlt?: string | null;
  // Step 5 — Tickets
  /** ISO 4217 event commerce currency. Null means server should use brand default. */
  currency?: string | null;
  tickets: TicketStub[];
  // Step 6 — Settings
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  /** Cycle 10: hide guest count from buyer-side surfaces. I-26 — operator-only flag; no buyer surface honors this in Cycle 10. */
  privateGuestList: boolean;
  /**
   * Cycle 12: when true, /event/{id}/door surface is reachable + "Door Sales"
   * ActionTile appears on Event Detail. Default false; operator opt-in.
   */
  inPersonPaymentsEnabled: boolean;
  // Meta
  /** Highest step index user has reached (0..6). Resume jumps here. */
  lastStepReached: number;
  status: DraftEventStatus;
  /** Local autosave conflict guard. Monotonic per draft editor session. */
  clientRevision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftEventState {
  drafts: DraftEvent[];
  activeDraftId: string | null;
  draftEditMeta: Record<string, DraftEditMeta>;
  createDraft: (brandId: string) => DraftEvent;
  getDraft: (id: string) => DraftEvent | null;
  upsertDraft: (draft: DraftEvent) => void;
  upsertDrafts: (drafts: DraftEvent[]) => void;
  upsertServerDraft: (draft: DraftEvent) => boolean;
  upsertServerDrafts: (drafts: DraftEvent[]) => void;
  replaceDraft: (oldId: string, draft: DraftEvent) => void;
  updateDraft: (
    id: string,
    patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>,
  ) => void;
  setLastStep: (id: string, step: number) => void;
  deleteDraft: (id: string) => void;
  beginDraftEdit: (id: string) => void;
  endDraftEdit: (id: string) => void;
  markDraftDirty: (id: string, clientRevision: number) => void;
  markDraftSaved: (id: string, clientRevision: number) => void;
  /**
   * Convert a draft into a LiveEvent (in liveEventStore) and remove the
   * draft. Atomic ownership transfer (I-16 — live-event ownership
   * separation). Returns the new LiveEvent for navigation purposes, or
   * null if the publish failed (e.g., brand was deleted) — caller should
   * preserve the draft on null.
   *
   * Refactored Cycle 6. Was previously a deletion stub.
   */
  publishDraft: (id: string) => LiveEvent | null;
  reset: () => void;
}

type PersistedState = Pick<DraftEventState, "drafts">;

const DEFAULT_DRAFT_FIELDS: Omit<
  DraftEvent,
  "id" | "brandId" | "createdAt" | "updatedAt"
> = {
  serverSlug: null,
  name: "",
  description: "",
  format: "in_person",
  // ORCH-0824: category dropped; three taxonomy fields default empty.
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: null,
  address: null,
  // ORCH-0824: city + locationGeo populated by Google Places autocomplete.
  city: null,
  locationGeo: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: null,
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 0,
  status: "draft",
  clientRevision: 0,
};

export const buildDraftEvent = (
  brandId: string,
  id: string = generateDraftId(),
  now: string = new Date().toISOString(),
): DraftEvent => ({
  ...DEFAULT_DRAFT_FIELDS,
  timezone: detectDeviceTimezone(),
  id,
  brandId,
  createdAt: now,
  updatedAt: now,
});

// ---- Migration types (private) --------------------------------------

// v1 — pre-J-A8 polish. Tickets had 5 fields, no isUnlimited.
type V1TicketStub = Pick<
  TicketStub,
  "id" | "name" | "priceGbp" | "capacity" | "isFree"
>;
type V1DraftEvent = Omit<
  DraftEvent,
  | "serverSlug"
  | "hideAddressUntilTicket"
  | "tickets"
  | "whenMode"
  | "recurrenceRule"
  | "multiDates"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "currency"
> & {
  tickets: V1TicketStub[];
  hideAddressUntilTicket?: boolean;
  // v1 had a `repeats` literal field
  repeats?: "once";
};

// v2/v3 — Cycle 3+4. Tickets had 6 fields (= v1 + isUnlimited). Cycle 4
// dropped `repeats` from v3, but tickets stayed unchanged through both
// versions, so a single shape covers both v2 and v3 ticket states.
type V3TicketStub = Pick<
  TicketStub,
  "id" | "name" | "priceGbp" | "capacity" | "isFree" | "isUnlimited"
>;
// v2 draft (still has `repeats`)
type V2DraftEvent = Omit<
  DraftEvent,
  | "serverSlug"
  | "whenMode"
  | "recurrenceRule"
  | "multiDates"
  | "tickets"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "currency"
> & {
  tickets: V3TicketStub[];
  /** Locked literal in v2; removed in v3 (replaced by whenMode). */
  repeats?: "once";
};
// v3 draft (no `repeats`, has whenMode/recurrence/multiDates, but tickets
// still v3 shape — Cycle 4 didn't change ticket fields).
// Cycle 12: explicitly excludes inPersonPaymentsEnabled (added v6) so this
// historical shape stays correct after the DraftEvent type grew.
type V3DraftEvent = Omit<
  DraftEvent,
  | "serverSlug"
  | "tickets"
  | "inPersonPaymentsEnabled"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "currency"
> & {
  tickets: V3TicketStub[];
};

const upgradeV1TicketToV2 = (t: V1TicketStub): V3TicketStub => ({
  ...t,
  isUnlimited: false,
});

const upgradeV1DraftToV2 = (d: V1DraftEvent): V2DraftEvent => ({
  ...d,
  hideAddressUntilTicket: d.hideAddressUntilTicket ?? true,
  tickets: d.tickets.map(upgradeV1TicketToV2),
  repeats: "once",
});

const upgradeV2DraftToV3 = (d: V2DraftEvent): V3DraftEvent => {
  // Strip `repeats`; default whenMode to "single"; null both arrays.
  const { repeats: _drop, ...rest } = d;
  return {
    ...rest,
    whenMode: "single",
    recurrenceRule: null,
    multiDates: null,
  };
};

// v4 ticket — Cycle 5 shape. v3 fields + 9 modifier fields.
// Cycle 6 v5 ADDS: description, saleStartAt, saleEndAt.
// Cycle 12 v6 ADDS: availableAt — explicitly excluded here to keep v4 shape correct.
type V4TicketStub = Omit<
  TicketStub,
  "description" | "saleStartAt" | "saleEndAt" | "availableAt"
>;
type V4DraftEvent = Omit<
  DraftEvent,
  | "serverSlug"
  | "tickets"
  | "inPersonPaymentsEnabled"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "currency"
> & {
  tickets: V4TicketStub[];
};

// v3 → v4: extend each ticket with 9 modifier fields (Cycle 5).
const upgradeV3TicketToV4 = (
  t: V3TicketStub,
  idx: number,
): V4TicketStub => ({
  ...t,
  visibility: "public",
  displayOrder: idx,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
});

const upgradeV3DraftToV4 = (d: V3DraftEvent): V4DraftEvent => ({
  ...d,
  tickets: d.tickets.map(upgradeV3TicketToV4),
});

// v4 → v5: extend each ticket with description + sale period fields
// (Cycle 6 — 5b absorption). Additive only.
const upgradeV4TicketToV5 = (t: V4TicketStub): V5TicketStub => ({
  ...t,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
});

const upgradeV4DraftToV5 = (d: V4DraftEvent): V5DraftEvent => ({
  ...d,
  tickets: d.tickets.map(upgradeV4TicketToV5),
});

// v5 ticket — Cycle 6 shape. Cycle 12 v6 ADDS: availableAt.
type V5TicketStub = Omit<TicketStub, "availableAt">;
type V5DraftEvent = Omit<
  DraftEvent,
  | "serverSlug"
  | "tickets"
  | "inPersonPaymentsEnabled"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "currency"
> & {
  tickets: V5TicketStub[];
};

// v5 → v6: extend each ticket with availableAt (default "both") +
// extend draft with inPersonPaymentsEnabled (default false). Cycle 12.
// Additive only; defaults preserve existing operator behavior.
const upgradeV5TicketToV6 = (t: V5TicketStub): TicketStub => ({
  ...t,
  availableAt: "both",
});

type V6DraftEvent = Omit<
  DraftEvent,
  | "serverSlug"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "currency"
>;

const upgradeV5DraftToV6 = (d: V5DraftEvent): V6DraftEvent => ({
  ...d,
  tickets: d.tickets.map(upgradeV5TicketToV6),
  inPersonPaymentsEnabled: false,
});

const upgradeV6DraftToV7 = (d: V6DraftEvent): DraftEvent => ({
  ...d,
  serverSlug: null,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: null,
});

const withProviderMetadataDefaults = (draft: DraftEvent): DraftEvent => ({
  ...draft,
  coverMediaProvider: draft.coverMediaProvider ?? null,
  coverMediaSourceUrl: draft.coverMediaSourceUrl ?? null,
  coverMediaCredit: draft.coverMediaCredit ?? null,
  coverMediaCreditUrl: draft.coverMediaCreditUrl ?? null,
  coverMediaAlt: draft.coverMediaAlt ?? null,
});

const persistOptions: PersistOptions<DraftEventState, PersistedState> = {
  // Store name unchanged (".v1") — versions are tracked by `version`,
  // and renaming the storage key would orphan existing user drafts.
  name: "mingla-business.draftEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state): PersistedState => ({ drafts: state.drafts }),
  version: 10,
  migrate: (persistedState, version): PersistedState => {
    if (version < 1) {
      return { drafts: [] };
    }
    if (version === 1) {
      // v1 → v7: chain v1→v2 → v3 → v4 → v5 → v6 → v7
      const v1 = persistedState as { drafts: V1DraftEvent[] };
      const v2Drafts = v1.drafts.map(upgradeV1DraftToV2);
      const v3Drafts = v2Drafts.map(upgradeV2DraftToV3);
      const v4Drafts = v3Drafts.map(upgradeV3DraftToV4);
      const v5Drafts = v4Drafts.map(upgradeV4DraftToV5);
      const v6Drafts = v5Drafts.map(upgradeV5DraftToV6);
      return { drafts: v6Drafts.map(upgradeV6DraftToV7) };
    }
    if (version === 2) {
      const v2 = persistedState as { drafts: V2DraftEvent[] };
      const v3Drafts = v2.drafts.map(upgradeV2DraftToV3);
      const v4Drafts = v3Drafts.map(upgradeV3DraftToV4);
      const v5Drafts = v4Drafts.map(upgradeV4DraftToV5);
      const v6Drafts = v5Drafts.map(upgradeV5DraftToV6);
      return { drafts: v6Drafts.map(upgradeV6DraftToV7) };
    }
    if (version === 3) {
      const v3 = persistedState as { drafts: V3DraftEvent[] };
      const v4Drafts = v3.drafts.map(upgradeV3DraftToV4);
      const v5Drafts = v4Drafts.map(upgradeV4DraftToV5);
      const v6Drafts = v5Drafts.map(upgradeV5DraftToV6);
      return { drafts: v6Drafts.map(upgradeV6DraftToV7) };
    }
    if (version === 4) {
      const v4 = persistedState as { drafts: V4DraftEvent[] };
      const v5Drafts = v4.drafts.map(upgradeV4DraftToV5);
      const v6Drafts = v5Drafts.map(upgradeV5DraftToV6);
      return { drafts: v6Drafts.map(upgradeV6DraftToV7) };
    }
    if (version === 5) {
      const v5 = persistedState as { drafts: V5DraftEvent[] };
      const v6Drafts = v5.drafts.map(upgradeV5DraftToV6);
      return { drafts: v6Drafts.map(upgradeV6DraftToV7) };
    }
    if (version === 6) {
      const v6 = persistedState as { drafts: V6DraftEvent[] };
      return { drafts: v6.drafts.map(upgradeV6DraftToV7) };
    }
    if (version === 7) {
      const v7 = persistedState as { drafts: Array<Omit<DraftEvent, "serverSlug">> };
      return {
        drafts: v7.drafts.map((draft) => withProviderMetadataDefaults({
          ...draft,
          serverSlug: null,
          currency: null,
        } as DraftEvent)),
      };
    }
    if (version === 8) {
      const v8 = persistedState as { drafts: Array<Omit<DraftEvent, "currency">> };
      return {
        drafts: v8.drafts.map((draft) =>
          withProviderMetadataDefaults({ ...draft, currency: null } as DraftEvent),
        ),
      };
    }
    if (version === 9) {
      const v9 = persistedState as { drafts: DraftEvent[] };
      return { drafts: v9.drafts.map(withProviderMetadataDefaults) };
    }
    return persistedState as PersistedState;
  },
};

export const useDraftEventStore = create<DraftEventState>()(
  persist(
    (set, get) => ({
      drafts: [],
      activeDraftId: null,
      draftEditMeta: {},

      createDraft: (brandId): DraftEvent => {
        const now = new Date().toISOString();
        const draft = buildDraftEvent(brandId, generateDraftId(), now);
        set((s) => ({ drafts: [...s.drafts, draft] }));
        return draft;
      },

      getDraft: (id): DraftEvent | null =>
        get().drafts.find((d) => d.id === id) ?? null,

      upsertDraft: (draft): void => {
        set((s) => {
          const idx = s.drafts.findIndex((d) => d.id === draft.id);
          if (idx === -1) return { drafts: [...s.drafts, draft] };
          const next = [...s.drafts];
          next[idx] = draft;
          return { drafts: next };
        });
      },

      upsertDrafts: (drafts): void => {
        set((s) => {
          const byId = new Map(s.drafts.map((d) => [d.id, d]));
          drafts.forEach((draft) => byId.set(draft.id, draft));
          return { drafts: Array.from(byId.values()) };
        });
      },

      upsertServerDraft: (draft): boolean => {
        let accepted = false;
        set((s) => {
          const existing = s.drafts.find((d) => d.id === draft.id) ?? null;
          const editMeta = s.draftEditMeta[draft.id] ?? null;
          if (!shouldApplyServerDraft({ serverDraft: draft, localDraft: existing, editMeta })) {
            return s;
          }
          accepted = true;
          const idx = s.drafts.findIndex((d) => d.id === draft.id);
          const nextDrafts =
            idx === -1
              ? [...s.drafts, draft]
              : s.drafts.map((d) => (d.id === draft.id ? draft : d));
          const serverRevision = draftClientRevision(draft);
          const nextMeta = {
            ...s.draftEditMeta,
            [draft.id]: {
              clientRevision: Math.max(
                editMeta?.clientRevision ?? 0,
                serverRevision,
              ),
              lastAcceptedServerRevision: Math.max(
                editMeta?.lastAcceptedServerRevision ?? 0,
                serverRevision,
              ),
              dirty:
                editMeta?.dirty === true &&
                serverRevision < (editMeta?.clientRevision ?? 0),
            },
          };
          return { drafts: nextDrafts, draftEditMeta: nextMeta };
        });
        return accepted;
      },

      upsertServerDrafts: (drafts): void => {
        drafts.forEach((draft) => {
          get().upsertServerDraft(draft);
        });
      },

      replaceDraft: (oldId, draft): void => {
        set((s) => {
          const filtered = s.drafts.filter((d) => d.id !== oldId && d.id !== draft.id);
          return { drafts: [...filtered, draft] };
        });
      },

      updateDraft: (id, patch): void => {
        const now = new Date().toISOString();
        set((s) => ({
          drafts: s.drafts.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: now } : d,
          ),
        }));
      },

      setLastStep: (id, step): void => {
        set((s) => {
          let changed = false;
          const drafts = s.drafts.map((d) => {
            if (d.id !== id || d.lastStepReached >= step) {
              return d;
            }
            changed = true;
            return { ...d, lastStepReached: step };
          });
          return changed ? { drafts } : s;
        });
      },

      deleteDraft: (id): void => {
        set((s) => {
          const { [id]: _drop, ...meta } = s.draftEditMeta;
          return {
            drafts: s.drafts.filter((d) => d.id !== id),
            activeDraftId: s.activeDraftId === id ? null : s.activeDraftId,
            draftEditMeta: meta,
          };
        });
      },

      beginDraftEdit: (id): void => {
        set((s) => {
          const draft = s.drafts.find((d) => d.id === id) ?? null;
          const existing = s.draftEditMeta[id];
          const revision = Math.max(
            existing?.clientRevision ?? 0,
            draftClientRevision(draft),
          );
          return {
            activeDraftId: id,
            draftEditMeta: {
              ...s.draftEditMeta,
              [id]: {
                clientRevision: revision,
                lastAcceptedServerRevision:
                  existing?.lastAcceptedServerRevision ?? revision,
                dirty: existing?.dirty ?? false,
              },
            },
          };
        });
      },

      endDraftEdit: (id): void => {
        set((s) => ({
          activeDraftId: s.activeDraftId === id ? null : s.activeDraftId,
        }));
      },

      markDraftDirty: (id, clientRevision): void => {
        set((s) => {
          const existing = s.draftEditMeta[id];
          return {
            activeDraftId: id,
            draftEditMeta: {
              ...s.draftEditMeta,
              [id]: {
                clientRevision: Math.max(
                  existing?.clientRevision ?? 0,
                  clientRevision,
                ),
                lastAcceptedServerRevision:
                  existing?.lastAcceptedServerRevision ?? 0,
                dirty: true,
              },
            },
          };
        });
      },

      markDraftSaved: (id, clientRevision): void => {
        set((s) => {
          const existing = s.draftEditMeta[id];
          if (existing !== undefined && clientRevision < existing.clientRevision) {
            return s;
          }
          return {
            draftEditMeta: {
              ...s.draftEditMeta,
              [id]: {
                clientRevision: Math.max(
                  existing?.clientRevision ?? 0,
                  clientRevision,
                ),
                lastAcceptedServerRevision: Math.max(
                  existing?.lastAcceptedServerRevision ?? 0,
                  clientRevision,
                ),
                dirty: false,
              },
            },
          };
        });
      },

      publishDraft: (id): LiveEvent | null => {
        // Cycle 6 — atomic ownership transfer (I-16).
        // 1. Find the draft.
        const draft = get().drafts.find((d) => d.id === id);
        if (draft === undefined) return null;
        // 2. Convert to LiveEvent + push to liveEventStore (the converter
        //    is the I-16 chokepoint — see `liveEventConverter.ts`).
        //    If conversion fails (e.g., brand deleted), preserve the draft.
        const liveEvent = convertDraftToLiveEvent(draft);
        if (liveEvent === null) return null;
        // 3. Delete the draft only AFTER successful conversion. This
        //    ordering is intentional: if step 2 throws or returns null,
        //    the draft survives so the user can retry publish.
        set((s) => {
          const { [id]: _drop, ...meta } = s.draftEditMeta;
          return {
            drafts: s.drafts.filter((d) => d.id !== id),
            activeDraftId: s.activeDraftId === id ? null : s.activeDraftId,
            draftEditMeta: meta,
          };
        });
        return liveEvent;
      },

      reset: (): void => {
        set({ drafts: [], activeDraftId: null, draftEditMeta: {} });
      },
    }),
    persistOptions,
  ),
);

/**
 * Selector: drafts owned by the given brand.
 *
 * IMPORTANT — selects raw `drafts` (stable reference) and filters via
 * useMemo. Inlining `s.drafts.filter(...)` would return a new array each
 * render → infinite useSyncExternalStore loop.
 */
export const useDraftsForBrand = (brandId: string | null): DraftEvent[] => {
  const drafts = useDraftEventStore((s) => s.drafts);
  return useMemo(
    (): DraftEvent[] =>
      brandId === null ? [] : drafts.filter((d) => d.brandId === brandId),
    [drafts, brandId],
  );
};

/**
 * Selector: a single draft by id, or null.
 */
export const useDraftById = (id: string | null): DraftEvent | null => {
  const drafts = useDraftEventStore((s) => s.drafts);
  return useMemo(
    (): DraftEvent | null =>
      id === null ? null : (drafts.find((d) => d.id === id) ?? null),
    [drafts, id],
  );
};
