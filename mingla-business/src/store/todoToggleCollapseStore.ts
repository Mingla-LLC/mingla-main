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
 * Migration note: new store, no `migrate` fn; any future shape change bumps
 * `version` and adds `migrate`.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export type TodoToggleCollapseState = {
  /** Persisted. Default false → the To-Do toggle is OPEN on first load. */
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

type PersistedState = Pick<TodoToggleCollapseState, "collapsed">;

const persistOptions: PersistOptions<
  TodoToggleCollapseState,
  PersistedState
> = {
  name: "mingla-business.todoToggleCollapse.v1",
  storage: createJSONStorage(() => AsyncStorage),
  // Only `collapsed` is persisted — `hasHydrated` always starts false on a
  // fresh load so the cold-start gate is honest (Constitution #14).
  partialize: (state) => ({ collapsed: state.collapsed }),
  version: 1,
  onRehydrateStorage: () => () =>
    useTodoToggleCollapseStore.getState().setHasHydrated(true),
};

export const useTodoToggleCollapseStore = create<TodoToggleCollapseState>()(
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
