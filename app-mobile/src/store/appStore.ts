import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  User,
  Preferences,
  CollaborationSession,
  CollaborationInvite,
} from "../types";
import type { Recommendation } from "../types/recommendation";
import { logger } from "../utils/logger";

const DECK_SCHEMA_VERSION = 4; // Bump this to invalidate stale persisted deck data (v4: removed DeckBatch, added sessionSwipedCards)

// --- Dev activity logger middleware (zero-cost in production) ---
// Uses `any` for the middleware wrapper types because Zustand's internal
// StateCreator type includes middleware mutator arrays that are impossible
// to type correctly from outside. This is dev-only infrastructure — the
// runtime behavior is fully type-safe (it just wraps `set` calls).
const devLoggerMiddleware = <T extends object>(
  config: (set: any, get: any, api: any) => T
) => (set: any, get: any, api: any): T => {
  const loggedSet = (partial: any, replace?: boolean) => {
    if (!__DEV__) {
      set(partial, replace);
      return;
    }
    const prev = get();
    set(partial, replace);
    const next = get();
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(next)) {
      if (typeof next[key] === "function") continue; // skip action methods
      if (prev[key] !== next[key]) {
        changed[key] = {
          from: summarize(prev[key]),
          to: summarize(next[key]),
        };
      }
    }
    if (Object.keys(changed).length > 0) {
      const actionName =
        typeof partial === "function"
          ? "(updater)"
          : Object.keys(partial as object).join(", ");
      logger.store(`set(${actionName})`, { changed });
    }
  };
  return config(loggedSet, get, api);
};

/** Summarize a value for log output — avoid dumping huge arrays/objects. */
function summarize(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "string")
    return val.length > 80 ? val.slice(0, 80) + "\u2026" : val;
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) return `Array(${val.length})`;
  if (typeof val === "object") {
    const keys = Object.keys(val);
    return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", \u2026" : ""}}`;
  }
  return String(val);
}

/** @deprecated Removed in v4 — kept only for migration safety. */
export interface DeckBatch {
  batchSeed: number;
  cards: Recommendation[];
  activePills: string[];
  prefsHash: string;
  timestamp: number;
}

interface AppState {
  // Hydration flag — true after Zustand finishes restoring from AsyncStorage
  _hasHydrated: boolean;

  // Auth state
  user: User | null;
  isAuthenticated: boolean;

  // User data
  profile: User | null;

  // Session state
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  pendingInvites: CollaborationInvite[];
  isInSolo: boolean;

  // Recommendations state
  currentCardIndex: number;

  // Deck session state
  sessionSwipedCards: Recommendation[];
  deckPrefsHash: string;
  deckSchemaVersion: number;

  // UI overlay state (not persisted)
  showAccountSettings: boolean;

  // Actions
  setAuth: (user: User | null) => void;
  setProfile: (profile: User | null) => void;
  // Session actions
  setCurrentSession: (session: CollaborationSession | null) => void;
  setAvailableSessions: (sessions: CollaborationSession[]) => void;
  setPendingInvites: (invites: CollaborationInvite[]) => void;
  setIsInSolo: (isInSolo: boolean) => void;

  // Recommendations actions
  setCurrentCardIndex: (index: number) => void;
  setShowAccountSettings: (show: boolean) => void;

  // Deck session actions
  addSwipedCard: (card: Recommendation) => void;
  resetDeckHistory: (newPrefsHash: string) => void;

  // Utilities
  clearUserData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    devLoggerMiddleware<AppState>((set, get, _api) => ({
      // Initial state
      // RELIABILITY: _hasHydrated is NOT persisted — starts false every cold start.
      // Set to true by onRehydrateStorage. index.tsx gates on this to ensure the
      // profile gate sees hydrated profile (not default null). Without this, Android
      // shows permanent "Getting things ready" when profile fetch fails with expired token.
      _hasHydrated: false,
      user: null,
      isAuthenticated: false,
      profile: null,
      currentSession: null,
      availableSessions: [],
      pendingInvites: [],
      isInSolo: true,
      currentCardIndex: 0,
      sessionSwipedCards: [],
      deckPrefsHash: '',
      deckSchemaVersion: DECK_SCHEMA_VERSION,
      showAccountSettings: false,

      // Auth actions
      setAuth: (user) => {
        set({
          user,
          isAuthenticated: !!user,
        });

        if (!user) {
          get().clearUserData();
        }
      },

      // User data actions
      setProfile: (profile) => set({ profile }),

      // Session actions
      setCurrentSession: (currentSession) => set({ currentSession }),
      setAvailableSessions: (availableSessions) => set({ availableSessions }),
      setPendingInvites: (pendingInvites) => set({ pendingInvites }),
      setIsInSolo: (isInSolo) => set({ isInSolo }),

      // Recommendations actions
      setCurrentCardIndex: (currentCardIndex) => set({ currentCardIndex }),
      setShowAccountSettings: (showAccountSettings) =>
        set({ showAccountSettings }),

      // Deck session actions
      addSwipedCard: (card) => set((state: AppState) => {
        const updated = [...state.sessionSwipedCards, card];
        // Cap at 200 entries — drop oldest on overflow
        if (updated.length > 200) {
          return { sessionSwipedCards: updated.slice(updated.length - 200) };
        }
        return { sessionSwipedCards: updated };
      }),

      resetDeckHistory: (newPrefsHash) => set({
        sessionSwipedCards: [],
        deckPrefsHash: newPrefsHash,
      }),

      // Utilities
      clearUserData: () =>
        set({
          user: null,
          isAuthenticated: false,
          profile: null,
          currentSession: null,
          availableSessions: [],
          pendingInvites: [],
          isInSolo: true,
          currentCardIndex: 0,
          sessionSwipedCards: [],
          deckPrefsHash: '',
          deckSchemaVersion: DECK_SCHEMA_VERSION,
        }),
    })),  // end of state definition + devLoggerMiddleware
    {
      name: "mingla-mobile-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        profile: state.profile,
        // currentSession, isInSolo, availableSessions, pendingInvites are intentionally
        // NOT persisted. They are refreshed from the database on every app open via
        // loadActiveSession(). Persisting them would risk showing stale session state.
        currentCardIndex: state.currentCardIndex,
        // Deck session state — persisted across sessions
        sessionSwipedCards: state.sessionSwipedCards,
        deckPrefsHash: state.deckPrefsHash,
        deckSchemaVersion: state.deckSchemaVersion,
      }),
      onRehydrateStorage: () => (state) => {
        // Migration safety: clear old data when schema version changes.
        // v3→v4: deckBatches removed, sessionSwipedCards added.
        if (state && state.deckSchemaVersion !== DECK_SCHEMA_VERSION) {
          (state as any).deckBatches = undefined;
          (state as any).currentDeckBatchIndex = undefined;
          state.sessionSwipedCards = [];
          state.deckSchemaVersion = DECK_SCHEMA_VERSION;
        }
        // Ensure sessionSwipedCards exists even if hydrated from old state
        if (state && !Array.isArray(state.sessionSwipedCards)) {
          state.sessionSwipedCards = [];
        }
        // RELIABILITY: Signal that Zustand has finished restoring persisted state.
        // Components can now trust that `profile`, `user`, `isAuthenticated`
        // reflect the persisted values (not just the defaults).
        useAppStore.setState({ _hasHydrated: true });
      },
    }
  )
);
