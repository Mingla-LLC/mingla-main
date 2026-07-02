/**
 * Ve1 — Zustand draft for venue onboarding wizard + pre-wizard gates.
 *
 * META-ORCH-1009 Sub-E: now PERSISTED via AsyncStorage. Previously this was a
 * plain in-memory `create(...)`, so leaving the wizard (backgrounding the app,
 * navigating away, or a JS reload) wiped every field and the operator had to
 * start the multi-step venue from scratch. We now persist the draft data AND the
 * current wizard step so "Add a venue" resumes exactly where it stopped. The
 * draft is cleared on successful submit (VenueCreatorWizard) and on logout
 * (clearAllStores, Constitution #6).
 *
 * META-ORCH-1255 Leg B — PER-BRAND MULTI-DRAFT (v2, F-13c/R-5 fix). Venues now
 * attach to the operator's CURRENT brand, so two brands must be able to hold
 * concurrent in-progress drafts without colliding. Shape:
 *   - The top-level fields stay the ACTIVE working draft (step components keep
 *     their `useDraftVenueStore((s) => s.field)` selectors untouched).
 *   - `activeBrandId` names which brand owns the active fields.
 *   - `drafts` is the per-brand parking lot: `activateBrand(brandId)` stashes
 *     the current fields under the previous brand and loads (or blanks) the
 *     new brand's draft. `reset(brandId)` clears ONE brand's draft;
 *     `reset()` (no arg) wipes everything (logout, Constitution #6).
 * Persist name bumped `…-draft-venue-v1` → `…-draft-venue-v2`; the v1 blob is
 * abandoned (prod-safe: it is a pre-submit draft).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { BrandHourEntry, VenueCategory } from "../types/brand";
import { defaultBrandHoursWeek } from "../utils/venueBrandHours";

export interface DraftVenueState {
  /** Ve2 — set when operator accepts a pool match card */
  placePoolId: string | null;
  /** Business / venue name typed at the place_pool gate */
  workingName: string;
  venueCategory: VenueCategory | null;
  displayName: string;
  slug: string;
  formattedAddress: string;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  countryCode: string | null;
  photoUris: string[];
  hours: BrandHourEntry[];
  contactEmail: string;
  contactPhone: string;
  tagline: string;
  description: string;
  /**
   * Current wizard step index (0-based) so re-entry resumes where the operator
   * stopped instead of always restarting at step 0. Owned here (not in the
   * wizard's local state) precisely so it survives a reload alongside the draft.
   */
  step: number;
}

const initial: DraftVenueState = {
  placePoolId: null,
  workingName: "",
  venueCategory: null,
  displayName: "",
  slug: "",
  formattedAddress: "",
  googlePlaceId: null,
  lat: null,
  lng: null,
  city: null,
  countryCode: null,
  photoUris: [],
  hours: defaultBrandHoursWeek(),
  contactEmail: "",
  contactPhone: "",
  tagline: "",
  description: "",
  step: 0,
};

const blankDraft = (): DraftVenueState => ({
  ...initial,
  hours: defaultBrandHoursWeek(),
});

const pickDraft = (s: DraftVenueState): DraftVenueState => ({
  placePoolId: s.placePoolId,
  workingName: s.workingName,
  venueCategory: s.venueCategory,
  displayName: s.displayName,
  slug: s.slug,
  formattedAddress: s.formattedAddress,
  googlePlaceId: s.googlePlaceId,
  lat: s.lat,
  lng: s.lng,
  city: s.city,
  countryCode: s.countryCode,
  photoUris: s.photoUris,
  hours: s.hours,
  contactEmail: s.contactEmail,
  contactPhone: s.contactPhone,
  tagline: s.tagline,
  description: s.description,
  step: s.step,
});

/** True when a draft has real operator progress worth resuming. */
export const draftVenueInProgress = (d: DraftVenueState): boolean =>
  d.displayName.trim().length > 0 ||
  d.workingName.trim().length > 0 ||
  d.step > 0;

interface DraftVenuePersisted extends DraftVenueState {
  /** META-ORCH-1255 — which brand owns the ACTIVE (top-level) draft fields. */
  activeBrandId: string | null;
  /** META-ORCH-1255 — parked drafts of the NON-active brands. */
  drafts: Record<string, DraftVenueState>;
}

interface DraftVenueStore extends DraftVenuePersisted {
  /**
   * META-ORCH-1255 — make `brandId`'s draft the active one: stash the current
   * fields under the previous brand, load (or blank) the new brand's draft.
   * No-op when already active.
   */
  activateBrand: (brandId: string) => void;
  /**
   * Clear a draft. With `brandId`: only that brand's draft (active or parked).
   * Without: EVERYTHING (logout — Constitution #6).
   */
  reset: (brandId?: string) => void;
  patch: (p: Partial<DraftVenueState>) => void;
  setStep: (step: number) => void;
  setHoursRow: (weekday: number, part: Partial<BrandHourEntry>) => void;
  /** META-ORCH-1009 Sub-F WS3: apply one open/close patch to many days at once. */
  setHoursRows: (weekdays: number[], part: Partial<BrandHourEntry>) => void;
}

export const useDraftVenueStore = create<DraftVenueStore>()(
  persist(
    (set) => ({
      ...initial,
      activeBrandId: null,
      drafts: {},
      activateBrand: (brandId) =>
        set((s) => {
          if (s.activeBrandId === brandId) return {};
          const drafts = { ...s.drafts };
          if (s.activeBrandId !== null) {
            drafts[s.activeBrandId] = pickDraft(s);
          }
          const next = drafts[brandId] ?? blankDraft();
          delete drafts[brandId];
          return { ...next, activeBrandId: brandId, drafts };
        }),
      reset: (brandId) =>
        set((s) => {
          if (brandId === undefined) {
            // Full wipe (logout / legacy no-arg callers).
            return { ...blankDraft(), activeBrandId: null, drafts: {} };
          }
          const drafts = { ...s.drafts };
          delete drafts[brandId];
          if (s.activeBrandId === brandId || s.activeBrandId === null) {
            return { ...blankDraft(), activeBrandId: s.activeBrandId, drafts };
          }
          return { drafts };
        }),
      patch: (p) => set(p),
      setStep: (step) => set({ step }),
      setHoursRow: (weekday, part) =>
        set((s) => ({
          hours: s.hours.map((h) =>
            h.weekday === weekday ? { ...h, ...part } : h,
          ),
        })),
      setHoursRows: (weekdays, part) =>
        set((s) => {
          const set2 = new Set(weekdays);
          return {
            hours: s.hours.map((h) =>
              set2.has(h.weekday) ? { ...h, ...part } : h,
            ),
          };
        }),
    }),
    {
      // META-ORCH-1255 — v2: per-brand multi-draft. v1 blob abandoned.
      name: "mingla-business-draft-venue-v2",
      storage: createJSONStorage(() => AsyncStorage),
      // Only the data fields are persisted; the action functions are recreated on
      // each store init, so we partialize them out.
      partialize: (s): DraftVenuePersisted => ({
        ...pickDraft(s),
        activeBrandId: s.activeBrandId,
        drafts: s.drafts,
      }),
    },
  ),
);

/**
 * META-ORCH-1255 — read a brand's draft regardless of active status (pure;
 * for `getState()` call sites and the to-do gate).
 */
export const draftVenueForBrand = (
  s: DraftVenuePersisted,
  brandId: string | null,
): DraftVenueState => {
  if (brandId === null) return blankDraft();
  if (s.activeBrandId === brandId) return pickDraft(s);
  return s.drafts[brandId] ?? blankDraft();
};
