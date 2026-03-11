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

const DECK_SCHEMA_VERSION = 3; // Bump this to invalidate stale persisted deck data

export interface DeckBatch {
  batchSeed: number;
  cards: Recommendation[];
  activePills: string[];
  timestamp: number;
}

interface AppState {
  // Auth state
  user: User | null;
  isAuthenticated: boolean;

  // User data
  profile: User | null;
  preferences: Preferences | null;

  // Session state
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  pendingInvites: CollaborationInvite[];
  isInSolo: boolean;

  // Recommendations state
  currentCardIndex: number;

  // Deck card history
  deckBatches: DeckBatch[];
  currentDeckBatchIndex: number;
  deckPrefsHash: string;
  deckSchemaVersion: number;

  // UI overlay state (not persisted)
  showAccountSettings: boolean;

  // Actions
  setAuth: (user: User | null) => void;
  setProfile: (profile: User | null) => void;
  setPreferences: (preferences: Preferences | null) => void;
  // Session actions
  setCurrentSession: (session: CollaborationSession | null) => void;
  setAvailableSessions: (sessions: CollaborationSession[]) => void;
  setPendingInvites: (invites: CollaborationInvite[]) => void;
  setIsInSolo: (isInSolo: boolean) => void;

  // Recommendations actions
  setCurrentCardIndex: (index: number) => void;
  setShowAccountSettings: (show: boolean) => void;

  // Deck card history actions
  addDeckBatch: (batch: DeckBatch) => void;
  navigateToDeckBatch: (index: number) => void;
  resetDeckHistory: (newPrefsHash: string) => void;

  // Utilities
  clearUserData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      profile: null,
      preferences: null,
      currentSession: null,
      availableSessions: [],
      pendingInvites: [],
      isInSolo: true,
      currentCardIndex: 0,
      deckBatches: [],
      currentDeckBatchIndex: -1,
      deckPrefsHash: '',
      deckSchemaVersion: DECK_SCHEMA_VERSION,
      showAccountSettings: false,
      blockedUsers: [],

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
      setPreferences: (preferences) => set({ preferences }),

      // Session actions
      setCurrentSession: (currentSession) => set({ currentSession }),
      setAvailableSessions: (availableSessions) => set({ availableSessions }),
      setPendingInvites: (pendingInvites) => set({ pendingInvites }),
      setIsInSolo: (isInSolo) => set({ isInSolo }),

      // Recommendations actions
      setCurrentCardIndex: (currentCardIndex) => set({ currentCardIndex }),
      setShowAccountSettings: (showAccountSettings) =>
        set({ showAccountSettings }),

      // Deck card history actions
      addDeckBatch: (batch) => set((state) => {
        const exists = state.deckBatches.some(b => b.batchSeed === batch.batchSeed);
        if (exists) return state;
        // Cap at 3 batches — do not store beyond the limit
        if (state.deckBatches.length >= 3) return state;
        return {
          deckBatches: [...state.deckBatches, batch],
          currentDeckBatchIndex: state.deckBatches.length,
        };
      }),

      navigateToDeckBatch: (index) => set({ currentDeckBatchIndex: index }),

      resetDeckHistory: (newPrefsHash) => set({
        deckBatches: [],
        currentDeckBatchIndex: -1,
        deckPrefsHash: newPrefsHash,
      }),

      // Utilities
      clearUserData: () =>
        set({
          user: null,
          isAuthenticated: false,
          profile: null,
          preferences: null,
          currentSession: null,
          availableSessions: [],
          pendingInvites: [],
          isInSolo: true,
          currentCardIndex: 0,
          deckBatches: [],
          currentDeckBatchIndex: -1,
          deckPrefsHash: '',
          deckSchemaVersion: DECK_SCHEMA_VERSION,
        }),
    }),
    {
      name: "mingla-mobile-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        profile: state.profile,
        preferences: state.preferences,
        // Don't persist currentSession and isInSolo - always fetch from database
        currentCardIndex: state.currentCardIndex,
        // Deck card history — persisted across sessions
        deckBatches: state.deckBatches,
        currentDeckBatchIndex: state.currentDeckBatchIndex,
        deckPrefsHash: state.deckPrefsHash,
        deckSchemaVersion: state.deckSchemaVersion,
      }),
      onRehydrateStorage: () => (state) => {
        // Clear stale deck batches when schema version changes
        if (state && state.deckSchemaVersion !== DECK_SCHEMA_VERSION) {
          state.deckBatches = [];
          state.deckSchemaVersion = DECK_SCHEMA_VERSION;
        }
      },
    }
  )
);
