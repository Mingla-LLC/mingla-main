/**
 * META-ORCH-1148 sub-ORCH 2.0 — venue-suite cross-component UI bridge.
 *
 * The Venue tab (`hub/listing.tsx` → `VenueSuiteShell`) renders BELOW the Hub
 * `_layout.tsx` chrome, so the layout cannot reach the shell's local state. This
 * tiny client-only Zustand store is the bridge that lets the layout REPLACE its
 * Hub offering-pill row with the venue module pill row while the suite is active
 * (LOCKED DECISION 5), and lets that pill row drive the shell's `activeModule`.
 *
 * UI flag only — nothing is fetched here, nothing is persisted (so no
 * `_hasHydrated` gate is needed: there is no rehydration boundary). Mirrors the
 * `useHubCreatorStore` pattern.
 *
 * The shell is the OWNER of `activeModule` + `visibleModules`; it pushes them
 * here on change so the layout's pill row can render + dispatch. The layout NEVER
 * navigates from these pills — it only calls `setActiveModule` (a state change,
 * never `router.push`), preserving the nav-lock guard.
 */

import { create } from "zustand";

import type { VenueModule } from "../types/venueReservation";

interface VenueSuiteState {
  /** True while the Venue suite is mounted (set on mount, cleared on unmount). */
  active: boolean;
  /** The shell's current module (mirrored here for the layout pill row). */
  activeModule: VenueModule;
  /** The modules the rail/pill row should render (derived from the toggle). */
  visibleModules: readonly VenueModule[];
  /**
   * The shell installs its `setActiveModule` here so the layout's pill row can
   * drive module selection without navigation. Null when the suite is inactive.
   */
  selectModule: ((module: VenueModule) => void) | null;

  /** Shell lifecycle. */
  activate: (initialModule: VenueModule) => void;
  deactivate: () => void;
  /** Shell → store sync on each render where these change. */
  sync: (params: {
    activeModule: VenueModule;
    visibleModules: readonly VenueModule[];
    selectModule: (module: VenueModule) => void;
  }) => void;
}

export const useVenueSuiteStore = create<VenueSuiteState>((set) => ({
  active: false,
  activeModule: "overview",
  visibleModules: ["overview", "settings"],
  selectModule: null,

  activate: (initialModule) =>
    set({ active: true, activeModule: initialModule }),
  deactivate: () =>
    set({
      active: false,
      activeModule: "overview",
      visibleModules: ["overview", "settings"],
      selectModule: null,
    }),
  sync: ({ activeModule, visibleModules, selectModule }) =>
    set({ activeModule, visibleModules, selectModule }),
}));

/** Convenience selector: is the venue suite currently mounted/active? */
export const useVenueSuiteActive = (): boolean =>
  useVenueSuiteStore((s) => s.active);
