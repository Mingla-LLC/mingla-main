/**
 * #4389 — Home's per-device choices for the setup prompts (client state only,
 * Constitution #5), keyed `{userId}.{brandId}`:
 *
 *   - `promptSeen` — the one-time H2 sheet was shown for this brand (S-8).
 *   - `tapNotNow`  — "Not now" on the Tap to Pay Home card: the card leaves
 *                    and comes back as a To do item.
 *
 * `hasHydrated` flips true only in `onRehydrateStorage`, so nothing shows from
 * a cold-start read (Constitution #14). `reset` is wired into
 * `clearAllStores` (Constitution #6).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";

export const homeSetupPromptKey = (userId: string, brandId: string): string =>
  `${userId}.${brandId}`;

export type HomeSetupPromptState = {
  promptSeen: Record<string, true>;
  tapNotNow: Record<string, true>;
  hasHydrated: boolean;
  markPromptSeen: (key: string) => void;
  markTapNotNow: (key: string) => void;
  setHasHydrated: (value: boolean) => void;
  reset: () => void;
};

type Persisted = Pick<HomeSetupPromptState, "promptSeen" | "tapNotNow">;

const options: PersistOptions<HomeSetupPromptState, Persisted> = {
  name: "mingla.setupPrompt.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ promptSeen: s.promptSeen, tapNotNow: s.tapNotNow }),
  version: 1,
  onRehydrateStorage: () => () => useHomeSetupPromptStore.getState().setHasHydrated(true),
};

export const useHomeSetupPromptStore = create<HomeSetupPromptState>()(
  persist(
    (set) => ({
      promptSeen: {},
      tapNotNow: {},
      hasHydrated: false,
      markPromptSeen: (key) =>
        set((s) => (s.promptSeen[key] ? s : { promptSeen: { ...s.promptSeen, [key]: true } })),
      markTapNotNow: (key) =>
        set((s) => (s.tapNotNow[key] ? s : { tapNotNow: { ...s.tapNotNow, [key]: true } })),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      reset: () => set({ promptSeen: {}, tapNotNow: {} }),
    }),
    options,
  ),
);
