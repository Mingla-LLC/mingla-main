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

interface DraftVenueStore extends DraftVenueState {
  reset: () => void;
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
      reset: () => set({ ...initial, hours: defaultBrandHoursWeek() }),
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
      name: "mingla-business-draft-venue-v1",
      storage: createJSONStorage(() => AsyncStorage),
      // Only the data fields are persisted; the action functions are recreated on
      // each store init, so we partialize them out.
      partialize: (s): DraftVenueState => ({
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
      }),
    },
  ),
);
