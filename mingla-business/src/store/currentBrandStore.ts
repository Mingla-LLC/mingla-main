/**
 * currentBrandStore — persisted Zustand store for the active organiser brand.
 *
 * Cycle 1 evolves the schema from `{id, displayName}` to the full Brand shape
 * with slug, role, stats, and currentLiveEvent. Bump persist version v1 → v2
 * with a migration that resets to empty (Cycle 0a never seeded brands so no
 * real user data is lost).
 *
 * Constitutional note: this store holds CLIENT state only — active brand ID
 * and a CACHED stub brand list during the [TRANSITIONAL] phase before B1
 * backend cycle. When B1 lands, the brand list moves to React Query (server
 * state) and this store keeps ONLY the active brand ID. Stub data is gated
 * by [TRANSITIONAL] markers in `brandList.ts` and the dev-seed button on
 * `app/(tabs)/account.tsx`.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export type BrandRole = "owner" | "admin";

export interface BrandStats {
  events: number;
  followers: number;
  rev: number;
}

export interface BrandLiveEvent {
  name: string;
  soldGbp: number;
  goalGbp: number;
}

/**
 * Cycle 1 Brand shape. `displayName` is the canonical label (preserves the
 * existing TopBar consumer contract from Cycle 0a). `currentLiveEvent` is
 * `null` when the brand has no live event tonight; non-null brands drive
 * the Home hero KPI.
 */
export type Brand = {
  id: string;
  displayName: string;
  slug: string;
  photo?: string;
  role: BrandRole;
  stats: BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
};

export type CurrentBrandState = {
  currentBrand: Brand | null;
  brands: Brand[];
  setCurrentBrand: (brand: Brand | null) => void;
  setBrands: (brands: Brand[]) => void;
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrand" | "brands">;

const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v2",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrand: state.currentBrand,
    brands: state.brands,
  }),
  version: 2,
  migrate: (_persistedState, version) => {
    // v1 → v2: schema changed from {id, displayName} to full Brand shape.
    // Cycle 0a never seeded brands, so resetting is safe and avoids partial
    // record bugs from a half-populated v1 entry.
    if (version < 2) {
      return { currentBrand: null, brands: [] };
    }
    return _persistedState as PersistedState;
  },
};

export const useCurrentBrandStore = create<CurrentBrandState>()(
  persist(
    (set) => ({
      currentBrand: null,
      brands: [],
      setCurrentBrand: (brand) => set({ currentBrand: brand }),
      setBrands: (brands) => set({ brands }),
      reset: () => set({ currentBrand: null, brands: [] }),
    }),
    persistOptions,
  ),
);

export const useCurrentBrand = (): Brand | null =>
  useCurrentBrandStore((s) => s.currentBrand);

export const useBrandList = (): Brand[] =>
  useCurrentBrandStore((s) => s.brands);
