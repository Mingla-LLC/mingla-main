/**
 * ariSeedStore — #4304 part 3. Text typed into Home's "Ask Ari to do
 * something…" field, handed to the Ari composer once.
 *
 * In memory only (never persisted, never in a URL), client UI state
 * (Constitution #5). Its own tiny store, not part of the persisted first-run
 * store, so Home does not pull AsyncStorage persistence into its graph.
 * Cleared on sign-out through `clearAllStores` (Constitution #6).
 */

import { create } from "zustand";

export type AriSeedState = {
  seed: string | null;
  setSeed: (text: string | null) => void;
  /** Read the seed and clear it, so it is applied exactly once. */
  takeSeed: () => string | null;
  reset: () => void;
};

export const useAriSeedStore = create<AriSeedState>()((set, get) => ({
  seed: null,
  setSeed: (text) => set({ seed: text }),
  takeSeed: () => {
    const seed = get().seed;
    if (seed !== null) set({ seed: null });
    return seed;
  },
  reset: () => set({ seed: null }),
}));
