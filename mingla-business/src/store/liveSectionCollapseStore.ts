/**
 * liveSectionCollapseStore — ORCH-1143 [business Home live-card accordion].
 *
 * Persisted Zustand store for the Home "Live now" section's open/closed
 * (accordion) state. Modeled EXACTLY on `currentBrandStore`'s hydration gate
 * (Constitution #14): the `collapsed` flag is persisted; `hasHydrated` is NOT
 * persisted and flips true only in `onRehydrateStorage`, so a first-frame read
 * of `collapsed` during rehydration is AMBIGUOUS and consumers must treat
 * `!hasHydrated` as "render the default (open) state, do not animate" to avoid a
 * flash-of-wrong-state on cold start.
 *
 * Client state only (a UI flag) — never server data, per Constitution #5.
 * `reset` is wired into `clearAllStores` (logout cascade, Constitution #6).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export type LiveSectionCollapseState = {
  /** Persisted. Default false → the live section is OPEN on first load. */
  collapsed: boolean;
  /**
   * NOT persisted. False until the store has rehydrated from AsyncStorage
   * (or rehydration errored — nothing left to wait for). Until true, consumers
   * MUST render the default (open) state and skip the collapse animation.
   */
  hasHydrated: boolean;
  setCollapsed: (value: boolean) => void;
  toggle: () => void;
  setHasHydrated: (value: boolean) => void;
  reset: () => void;
};

type PersistedState = Pick<LiveSectionCollapseState, "collapsed">;

const persistOptions: PersistOptions<
  LiveSectionCollapseState,
  PersistedState
> = {
  name: "mingla-business.liveSectionCollapse.v1",
  storage: createJSONStorage(() => AsyncStorage),
  // Only `collapsed` is persisted — `hasHydrated` always starts false on a
  // fresh load so the cold-start gate is honest (Constitution #14).
  partialize: (state) => ({ collapsed: state.collapsed }),
  version: 1,
  onRehydrateStorage: () => () =>
    useLiveSectionCollapseStore.getState().setHasHydrated(true),
};

export const useLiveSectionCollapseStore = create<LiveSectionCollapseState>()(
  persist(
    (set) => ({
      collapsed: false,
      hasHydrated: false,
      setCollapsed: (value) => set({ collapsed: value }),
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      reset: () => set({ collapsed: false }),
    }),
    persistOptions,
  ),
);
