/**
 * firstRunStore — #4304 part 3 (First Home with Ari).
 *
 * Client-only flags (Constitution #5), keyed by account id so one device that
 * signs into two accounts never mixes them:
 *
 *   - `unlockedUserIds` — Home has appeared for this account once. It stays
 *     even if every draft is later deleted (Seth, 6 Nov 2026).
 *   - `intents` — what the host said in State A ("I host events", or what they
 *     typed). A brand's Ari conversation is scoped to the brand, so the
 *     brandless chat cannot carry it across; the State B greeting reads it
 *     back to offer the matching first draft and keep their words.
 *
 * `hasHydrated` is NOT persisted and flips true only in `onRehydrateStorage`,
 * so a cold-start read is never mistaken for "not unlocked" (Constitution
 * #14). `reset` is wired into `clearAllStores` (Constitution #6). The server
 * re-derives the unlock from any event/venue row on the next sign-in, so a
 * reset never strands a host who already has content.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import type { FirstRunIntent } from "../utils/firstRunState";

export interface FirstRunRememberedIntent {
  intent: FirstRunIntent | null;
  /** The host's own words when they typed instead of tapping a chip. */
  text: string | null;
}

export type FirstRunStoreState = {
  unlockedUserIds: Record<string, true>;
  intents: Record<string, FirstRunRememberedIntent>;
  hasHydrated: boolean;
  markUnlocked: (userId: string) => void;
  rememberIntent: (userId: string, value: FirstRunRememberedIntent) => void;
  clearIntent: (userId: string) => void;
  setHasHydrated: (value: boolean) => void;
  reset: () => void;
};

type PersistedState = Pick<FirstRunStoreState, "unlockedUserIds" | "intents">;

const persistOptions: PersistOptions<FirstRunStoreState, PersistedState> = {
  name: "mingla-business.firstRun.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    unlockedUserIds: state.unlockedUserIds,
    intents: state.intents,
  }),
  version: 1,
  onRehydrateStorage: () => () =>
    useFirstRunStore.getState().setHasHydrated(true),
};

export const useFirstRunStore = create<FirstRunStoreState>()(
  persist(
    (set) => ({
      unlockedUserIds: {},
      intents: {},
      hasHydrated: false,
      markUnlocked: (userId) =>
        set((state) =>
          state.unlockedUserIds[userId] === true
            ? state
            : { unlockedUserIds: { ...state.unlockedUserIds, [userId]: true } },
        ),
      rememberIntent: (userId, value) =>
        set((state) => ({ intents: { ...state.intents, [userId]: value } })),
      clearIntent: (userId) =>
        set((state) => {
          if (!(userId in state.intents)) return state;
          const next = { ...state.intents };
          delete next[userId];
          return { intents: next };
        }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      reset: () => set({ unlockedUserIds: {}, intents: {} }),
    }),
    persistOptions,
  ),
);
