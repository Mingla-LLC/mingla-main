/**
 * currentBrandStore — persisted Zustand store for the active organiser brand.
 *
 * Cycle 0a creates this empty so the TopBar primitive (Cycle 0a Sub-phase D)
 * can read `currentBrand` to decide whether to render "Create brand" or the
 * brand's name. Cycle 1 fills the `Brand` shape and seeds initial data.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

/**
 * Stub brand shape — intentionally permissive for Cycle 0a.
 * Cycle 1 replaces this with the full schema-bound type
 * (id, slug, displayName, monogram, colorway, locale, etc.).
 */
export type Brand = {
  id: string;
  displayName: string;
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
  name: "mingla-business.currentBrand.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrand: state.currentBrand,
    brands: state.brands,
  }),
  version: 1,
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
