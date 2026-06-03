/**
 * META-ORCH-1059 — shared "open the offering chooser" flag for the Hub.
 *
 * The UniversalCreatorSheet ("What are you creating?" → Event / Experience /
 * Trip) is mounted + owned by `app/(tabs)/hub/_layout.tsx`. The Hub SUB-routes
 * (events / experiences / trips) render content only and cannot reach the
 * layout's local sheet state. This tiny client-only Zustand flag lets a
 * sub-route's empty-state CTA ("Create your first offering") open that SAME
 * shared chooser — reusing the existing sheet, NOT building a new one.
 *
 * Zustand-boundary compliant: UI flag only, nothing fetched from the API.
 */

import { create } from "zustand";

interface HubCreatorState {
  /** True when the offering chooser should be visible. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useHubCreatorStore = create<HubCreatorState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
