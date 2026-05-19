/**
 * Ve1 — Zustand draft for venue onboarding wizard + pre-wizard gates.
 */

import { create } from "zustand";

import type { BrandHourEntry, VenueCategory } from "../types/brand";
import { defaultBrandHoursWeek } from "../utils/venueBrandHours";

export interface DraftVenueState {
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
}

const initial: DraftVenueState = {
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
};

interface DraftVenueStore extends DraftVenueState {
  reset: () => void;
  patch: (p: Partial<DraftVenueState>) => void;
  setHoursRow: (weekday: number, part: Partial<BrandHourEntry>) => void;
}

export const useDraftVenueStore = create<DraftVenueStore>((set) => ({
  ...initial,
  reset: () => set({ ...initial, hours: defaultBrandHoursWeek() }),
  patch: (p) => set(p),
  setHoursRow: (weekday, part) =>
    set((s) => ({
      hours: s.hours.map((h) =>
        h.weekday === weekday ? { ...h, ...part } : h,
      ),
    })),
}));
