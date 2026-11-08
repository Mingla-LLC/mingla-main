/**
 * todoToggleCollapseStore — #882 [todo-toggle-position-memory].
 *
 * Persisted Zustand store for the BusinessTodoToggle's open/closed position —
 * the SINGLE owner of that position for every render site (Home, Hub, and any
 * future one). Modeled EXACTLY on liveSectionCollapseStore (Constitution
 * #14/#5/#6): the `collapsed` flag is persisted; `hasHydrated` is NOT
 * persisted and flips true only in `onRehydrateStorage`, so a first-frame
 * read of `collapsed` during rehydration is AMBIGUOUS and the consumer
 * renders NOTHING until `hasHydrated` (the toggle's first visible paint is
 * already the remembered position — no flash-of-wrong-state).
 *
 * Client state only (a UI flag) — never server data, per Constitution #5.
 * Global (never brand-keyed): brand switches leave it untouched; `reset` is
 * wired into `clearAllStores` (logout cascade, Constitution #6).
 *
 * #4304 (Seth, 2026-11-07): the To-do list is ALWAYS collapsed by default so it
 * takes no space. Version 2 persists nothing: every app open starts collapsed,
 * an open position is shared by Home and Hub for the session only, and an old
 * v1 "open" value is dropped on load. The store stays a persisted store so the
 * hydration gate (#882, no first-paint flip) keeps working unchanged.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export type TodoToggleCollapseState = {
  /** Session only (#4304). Default true → the To-do list starts COLLAPSED. */
  collapsed: boolean;
  /**
   * NOT persisted. False until the store has rehydrated from AsyncStorage
   * (or rehydration errored — nothing left to wait for). Until true, the
   * consumer MUST render nothing (BusinessTodoToggle's hydration gate).
   */
  hasHydrated: boolean;
  setCollapsed: (value: boolean) => void;
  toggle: () => void;
  setHasHydrated: (value: boolean) => void;
  reset: () => void;
};

type PersistedState = Record<string, never>;

const persistOptions: PersistOptions<
  TodoToggleCollapseState,
  PersistedState
> = {
  name: "mingla-business.todoToggleCollapse.v1",
  storage: createJSONStorage(() => AsyncStorage),
  // #4304 — nothing is persisted: every load starts collapsed. `hasHydrated`
  // still flips only in onRehydrateStorage (Constitution #14).
  partialize: () => ({}),
  version: 2,
  // A v1 store held { collapsed }; drop it so an old "open" never returns.
  migrate: () => ({}),
  onRehydrateStorage: () => () =>
    useTodoToggleCollapseStore.getState().setHasHydrated(true),
};

export const useTodoToggleCollapseStore = create<TodoToggleCollapseState>()(
  persist(
    (set) => ({
      collapsed: true,
      hasHydrated: false,
      setCollapsed: (value) => set({ collapsed: value }),
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      reset: () => set({ collapsed: true }),
    }),
    persistOptions,
  ),
);
