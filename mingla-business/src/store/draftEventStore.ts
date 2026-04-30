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
 * Per Cycle 3 spec §3.1.
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

/**
 * Detect device's IANA timezone via Intl. Falls back to "Europe/London"
 * if the runtime can't resolve (extremely rare on Hermes/V8). Called at
 * draft creation time so each new draft inherits the device's local
 * zone — user can override via the Step 2 timezone sheet picker.
 *
 * The Step 2 sheet offers 6 common UK/EU presets. For exotic zones
 * (e.g., "America/Los_Angeles"), the Pressable display falls back to
 * the raw timezone string — `tzLabel` resolves via
 * `TIMEZONES.find(t => t.id === draft.timezone)?.label ?? draft.timezone`.
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
   * When true, this ticket has no capacity limit. Capacity field is
   * ignored in display + validation. NEW in Cycle 3 rework v3 schema v2.
   * Defaults to false for missing field (passthrough migration).
   */
  isUnlimited: boolean;
}

export type DraftEventFormat = "in_person" | "online" | "hybrid";
export type DraftEventVisibility = "public" | "unlisted" | "private";
export type DraftEventStatus = "draft" | "publishing" | "live";

export interface DraftEvent {
  id: string;
  brandId: string;
  // Step 1 — Basics
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
  // Step 2 — When
  /** Locked to "once" in Cycle 3; Cycle 4 expands the union for recurrence. */
  repeats: "once";
  /** ISO YYYY-MM-DD. */
  date: string | null;
  /** HH:mm 24-hour. */
  doorsOpen: string | null;
  /** HH:mm 24-hour. */
  endsAt: string | null;
  /** Default "Europe/London". */
  timezone: string;
  // Step 3 — Where
  venueName: string | null;
  address: string | null;
  /** Used when format ∈ {"online", "hybrid"}. */
  onlineUrl: string | null;
  /**
   * When true (default), the venue address is hidden from the public
   * event page until a guest buys a ticket — only revealed via the
   * post-purchase confirmation. When false, the address is shown
   * publicly. NEW in Cycle 3 rework v3 schema v2. Defaults to true
   * for missing field (passthrough migration).
   */
  hideAddressUntilTicket: boolean;
  // Step 4 — Cover
  /** Hue 0-360 for EventCover. Default 25 (warm orange — designer reference). */
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
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601 — bumped on every updateDraft call. */
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
  /** Cycle 3 stub: marks "live" then disposes. Cycle 9 retains as event record. */
  publishDraft: (id: string) => void;
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
  repeats: "once",
  date: null,
  doorsOpen: null,
  endsAt: null,
  timezone: "Europe/London",
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

// v1 draft shape — used by the v1→v2 migrator only.
type V1TicketStub = Omit<TicketStub, "isUnlimited">;
type V1DraftEvent = Omit<DraftEvent, "hideAddressUntilTicket" | "tickets"> & {
  tickets: V1TicketStub[];
  hideAddressUntilTicket?: boolean;
};

const upgradeV1TicketToV2 = (t: V1TicketStub): TicketStub => ({
  ...t,
  isUnlimited: false,
});

const upgradeV1DraftToV2 = (d: V1DraftEvent): DraftEvent => ({
  ...d,
  hideAddressUntilTicket: d.hideAddressUntilTicket ?? true,
  tickets: d.tickets.map(upgradeV1TicketToV2),
});

const persistOptions: PersistOptions<DraftEventState, PersistedState> = {
  name: "mingla-business.draftEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ drafts: state.drafts }),
  version: 2,
  migrate: (persistedState, version) => {
    if (version < 1) {
      // No prior persistence; start clean.
      return { drafts: [] };
    }
    if (version === 1) {
      // v1 → v2: add hideAddressUntilTicket (default true) +
      // TicketStub.isUnlimited (default false). Passthrough otherwise.
      const v1 = persistedState as { drafts: V1DraftEvent[] };
      return { drafts: v1.drafts.map(upgradeV1DraftToV2) };
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
          // zone (Cycle 3 rework v2 Fix #4). DEFAULT_DRAFT_FIELDS keeps the
          // London fallback as a safety net for any code that constructs
          // DEFAULT_DRAFT_FIELDS directly (e.g., test fixtures).
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

      publishDraft: (id): void => {
        // Cycle 3: fire-and-forget. Cycle 9 will retain as event record.
        set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
      },

      reset: (): void => {
        set({ drafts: [] });
      },
    }),
    persistOptions,
  ),
);

/**
 * Selector: drafts owned by the given brand (filters by brandId).
 *
 * IMPORTANT — selects the raw `drafts` array (stable reference across
 * unchanged store state) and filters via useMemo. Inlining
 * `s.drafts.filter(...)` inside the selector would return a new array
 * reference every render → infinite useSyncExternalStore loop
 * ("getSnapshot should be cached"). Same pattern applies to any other
 * derived-array selector on this store.
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
 *
 * `.find()` on the same drafts array returns the same DraftEvent
 * reference (or undefined), so the selector is reference-stable —
 * but we still wrap in useMemo for symmetry + safety against future
 * rewrites that might add transformations.
 */
export const useDraftById = (id: string | null): DraftEvent | null => {
  const drafts = useDraftEventStore((s) => s.drafts);
  return useMemo(
    (): DraftEvent | null =>
      id === null ? null : (drafts.find((d) => d.id === id) ?? null),
    [drafts, id],
  );
};
