import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * themeRecentsStore — #1022 [compact Theme control].
 *
 * Per-device recent colour picks for the Theme sheet's swatch strip (Seth's
 * Q5: recents are per-device, NOT synced to the brand — one organiser's
 * experiments should not follow their teammates around).
 *
 * Holds ONLY a small list of hex strings the user chose. This is a client-only
 * UI preference, never server state, so Zustand is the right owner
 * (Constitution #5). It stores IDs/values, never server record snapshots
 * (Zustand-persist rule).
 *
 * Constitution #14 — `_hasHydrated` gates reads so the strip does not flash
 * empty-then-populated on a cold start.
 */

/** MRU cap. Five keeps the strip scannable beside brand + 12 presets. */
export const MAX_THEME_RECENTS = 5;

export interface ThemeRecentsState {
  /** Most-recently-used first. Always lowercase `#rrggbb`. */
  recents: string[];
  /** False until the persisted value has rehydrated (Constitution #14). */
  _hasHydrated: boolean;
  /** Push a hex to the front, de-duplicated case-insensitively, capped. */
  addRecent: (hex: string) => void;
  clearRecents: () => void;
  setHasHydrated: (value: boolean) => void;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export const useThemeRecentsStore = create<ThemeRecentsState>()(
  persist(
    (set) => ({
      recents: [],
      _hasHydrated: false,
      addRecent: (hex) =>
        set((state) => {
          const trimmed = hex.trim();
          // Never persist a partial or malformed value — the hex field commits
          // on every valid keystroke, so this is called with real values only,
          // but the guard keeps a bad write out of durable storage.
          if (!HEX6.test(trimmed)) return state;
          const normalized = trimmed.toLowerCase();
          const withoutDupe = state.recents.filter(
            (existing) => existing.toLowerCase() !== normalized,
          );
          return { recents: [normalized, ...withoutDupe].slice(0, MAX_THEME_RECENTS) };
        }),
      clearRecents: () => set({ recents: [] }),
      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: "mingla-business-theme-recents",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ recents: state.recents }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
