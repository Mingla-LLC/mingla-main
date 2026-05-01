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
 * Constitutional note (#2 one owner per truth): Drafts live ONLY here.
 * Components consume via `useDraftsForBrand(brandId)` or `useDraftById(id)`
 * selectors — never copy draft state into local state.
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

export interface TicketStub {
  id: string;
  name: string;
  /** Null when isFree=true; otherwise positive number in GBP whole-units. */
  priceGbp: number | null;
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
   * Local-only in Cycle 5; backend hashes at B4. Required when
   * passwordProtected=true; min 4 chars enforced by validation.
   */
  password: string | null;
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
}

export type DraftEventFormat = "in_person" | "online" | "hybrid";
export type DraftEventVisibility = "public" | "unlisted" | "private";
export type DraftEventStatus = "draft" | "publishing" | "live";

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
  // Step 1 — Basics
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
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
  /** Used when format ∈ {"online", "hybrid"}. */
  onlineUrl: string | null;
  /** When true (default), address hidden until ticket purchase. */
  hideAddressUntilTicket: boolean;
  // Step 4 — Cover
  /** Hue 0-360 for EventCover. Default 25 (warm orange). */
  coverHue: number;
  // Step 5 — Tickets
  tickets: TicketStub[];
  // Step 6 — Settings
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Meta
  /** Highest step index user has reached (0..6). Resume jumps here. */
  lastStepReached: number;
  status: DraftEventStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DraftEventState {
  drafts: DraftEvent[];
  createDraft: (brandId: string) => DraftEvent;
  getDraft: (id: string) => DraftEvent | null;
  updateDraft: (
    id: string,
    patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>,
  ) => void;
  setLastStep: (id: string, step: number) => void;
  deleteDraft: (id: string) => void;
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
  name: "",
  description: "",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: null,
  address: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  lastStepReached: 0,
  status: "draft",
};

// ---- Migration types (private) --------------------------------------

// v1 — pre-J-A8 polish. Tickets had 5 fields, no isUnlimited.
type V1TicketStub = Pick<
  TicketStub,
  "id" | "name" | "priceGbp" | "capacity" | "isFree"
>;
type V1DraftEvent = Omit<
  DraftEvent,
  | "hideAddressUntilTicket"
  | "tickets"
  | "whenMode"
  | "recurrenceRule"
  | "multiDates"
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
  | "whenMode"
  | "recurrenceRule"
  | "multiDates"
  | "tickets"
> & {
  tickets: V3TicketStub[];
  /** Locked literal in v2; removed in v3 (replaced by whenMode). */
  repeats?: "once";
};
// v3 draft (no `repeats`, has whenMode/recurrence/multiDates, but tickets
// still v3 shape — Cycle 4 didn't change ticket fields)
type V3DraftEvent = Omit<DraftEvent, "tickets"> & {
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
type V4TicketStub = Omit<
  TicketStub,
  "description" | "saleStartAt" | "saleEndAt"
>;
type V4DraftEvent = Omit<DraftEvent, "tickets"> & {
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
const upgradeV4TicketToV5 = (t: V4TicketStub): TicketStub => ({
  ...t,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
});

const upgradeV4DraftToV5 = (d: V4DraftEvent): DraftEvent => ({
  ...d,
  tickets: d.tickets.map(upgradeV4TicketToV5),
});

const persistOptions: PersistOptions<DraftEventState, PersistedState> = {
  // Store name unchanged (".v1") — versions are tracked by `version`,
  // and renaming the storage key would orphan existing user drafts.
  name: "mingla-business.draftEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state): PersistedState => ({ drafts: state.drafts }),
  version: 5,
  migrate: (persistedState, version): PersistedState => {
    if (version < 1) {
      return { drafts: [] };
    }
    if (version === 1) {
      // v1 → v5: chain v1→v2 → v3 → v4 → v5
      const v1 = persistedState as { drafts: V1DraftEvent[] };
      const v2Drafts = v1.drafts.map(upgradeV1DraftToV2);
      const v3Drafts = v2Drafts.map(upgradeV2DraftToV3);
      const v4Drafts = v3Drafts.map(upgradeV3DraftToV4);
      return { drafts: v4Drafts.map(upgradeV4DraftToV5) };
    }
    if (version === 2) {
      const v2 = persistedState as { drafts: V2DraftEvent[] };
      const v3Drafts = v2.drafts.map(upgradeV2DraftToV3);
      const v4Drafts = v3Drafts.map(upgradeV3DraftToV4);
      return { drafts: v4Drafts.map(upgradeV4DraftToV5) };
    }
    if (version === 3) {
      const v3 = persistedState as { drafts: V3DraftEvent[] };
      const v4Drafts = v3.drafts.map(upgradeV3DraftToV4);
      return { drafts: v4Drafts.map(upgradeV4DraftToV5) };
    }
    if (version === 4) {
      const v4 = persistedState as { drafts: V4DraftEvent[] };
      return { drafts: v4.drafts.map(upgradeV4DraftToV5) };
    }
    return persistedState as PersistedState;
  },
};

export const useDraftEventStore = create<DraftEventState>()(
  persist(
    (set, get) => ({
      drafts: [],

      createDraft: (brandId): DraftEvent => {
        const now = new Date().toISOString();
        const draft: DraftEvent = {
          ...DEFAULT_DRAFT_FIELDS,
          // Override hardcoded "Europe/London" default with device-detected
          // zone (Cycle 3 rework v2 Fix #4).
          timezone: detectDeviceTimezone(),
          id: generateDraftId(),
          brandId,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ drafts: [...s.drafts, draft] }));
        return draft;
      },

      getDraft: (id): DraftEvent | null =>
        get().drafts.find((d) => d.id === id) ?? null,

      updateDraft: (id, patch): void => {
        const now = new Date().toISOString();
        set((s) => ({
          drafts: s.drafts.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: now } : d,
          ),
        }));
      },

      setLastStep: (id, step): void => {
        set((s) => ({
          drafts: s.drafts.map((d) =>
            d.id === id
              ? { ...d, lastStepReached: Math.max(d.lastStepReached, step) }
              : d,
          ),
        }));
      },

      deleteDraft: (id): void => {
        set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
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
        set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
        return liveEvent;
      },

      reset: (): void => {
        set({ drafts: [] });
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
