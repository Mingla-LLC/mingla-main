/**
 * currentBrandStore — persisted Zustand store for the active organiser brand.
 *
 * Cycle 1 evolved the schema from `{id, displayName}` to the full Brand shape
 * with slug, role, stats, and currentLiveEvent (v2). Cycle 2 J-A7 extends
 * Brand with bio, tagline, contact, links, and stats.attendees so the brand
 * profile screen has content to render (v3). Persist v2 → v3 migration adds
 * `stats.attendees: 0` to existing brands and leaves new optional fields as
 * undefined.
 *
 * Constitutional note: this store holds CLIENT state only — active brand ID
 * and a CACHED stub brand list during the [TRANSITIONAL] phase before B1
 * backend cycle. When B1 lands, the brand list moves to React Query (server
 * state) and this store keeps ONLY the active brand ID. Stub data is gated
 * by [TRANSITIONAL] markers in `brandList.ts` and the dev-seed button on
 * `app/(tabs)/account.tsx`.
 *
 * Schema-version history:
 *   v1 (Cycle 0a): {id, displayName} only — never seeded
 *   v2 (Cycle 1):  {id, displayName, slug, photo?, role, stats, currentLiveEvent}
 *   v3 (Cycle 2 J-A7): adds bio?, tagline?, contact?, links?, stats.attendees
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
  /** Total attendees across all events. NEW in J-A7 schema v3. */
  attendees: number;
}

export interface BrandLiveEvent {
  name: string;
  soldGbp: number;
  goalGbp: number;
}

export interface BrandContact {
  email?: string;
  phone?: string;
}

export interface BrandCustomLink {
  label: string;
  url: string;
}

export interface BrandLinks {
  website?: string;
  instagram?: string;
  /** Custom link list (post-MVP); empty in J-A7 stubs. */
  custom?: BrandCustomLink[];
}

/**
 * Cycle 2 J-A7 Brand shape (v3). `displayName` is the canonical label
 * (preserves the existing TopBar consumer contract from Cycle 0a).
 * `currentLiveEvent` is `null` when the brand has no live event tonight;
 * non-null brands drive the Home hero KPI. New v3 fields (bio, tagline,
 * contact, links) are optional — render-time guards handle undefined.
 */
export type Brand = {
  id: string;
  displayName: string;
  slug: string;
  photo?: string;
  role: BrandRole;
  stats: BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
  /** Long-form description shown on profile. NEW in J-A7 schema v3. */
  bio?: string;
  /** One-line tagline. NEW in J-A7 schema v3. */
  tagline?: string;
  /** Contact info shown in profile + edit. NEW in J-A7 schema v3. */
  contact?: BrandContact;
  /** Social + custom links. NEW in J-A7 schema v3. */
  links?: BrandLinks;
};

export type CurrentBrandState = {
  currentBrand: Brand | null;
  brands: Brand[];
  setCurrentBrand: (brand: Brand | null) => void;
  setBrands: (brands: Brand[]) => void;
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrand" | "brands">;

/** v2 brand shape — used internally by the v2 → v3 migrator only. */
type V2BrandStats = { events: number; followers: number; rev: number; attendees?: number };
type V2Brand = {
  id: string;
  displayName: string;
  slug: string;
  photo?: string;
  role: BrandRole;
  stats: V2BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
};

const upgradeV2BrandToV3 = (b: V2Brand): Brand => ({
  ...b,
  stats: {
    events: b.stats.events,
    followers: b.stats.followers,
    rev: b.stats.rev,
    attendees: b.stats.attendees ?? 0,
  },
});

const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v3",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrand: state.currentBrand,
    brands: state.brands,
  }),
  version: 3,
  migrate: (persistedState, version) => {
    // v1 → v3: schema changed from {id, displayName} to full Brand shape.
    // Cycle 0a never seeded brands, so resetting is safe and avoids partial
    // record bugs from a half-populated v1 entry.
    if (version < 2) {
      return { currentBrand: null, brands: [] };
    }
    // v2 → v3: add stats.attendees (default 0); bio, tagline, contact, links
    // remain undefined and render with empty-state guards.
    if (version === 2) {
      const v2 = persistedState as { currentBrand: V2Brand | null; brands: V2Brand[] };
      return {
        currentBrand: v2.currentBrand !== null ? upgradeV2BrandToV3(v2.currentBrand) : null,
        brands: v2.brands.map(upgradeV2BrandToV3),
      };
    }
    return persistedState as PersistedState;
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
