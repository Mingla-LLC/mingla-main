import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState as RNAppState, type AppStateStatus } from "react-native";
import {
  User,
  Preferences,
  CollaborationSession,
  CollaborationInvite,
} from "../types";
import type { Recommendation } from "../types/recommendation";
import { logger } from "../utils/logger";

const DECK_SCHEMA_VERSION = 4; // Bump this to invalidate stale persisted deck data (v4: removed DeckBatch, added sessionSwipedCards)

// ─── ORCH-0675 Wave 1 — Debounced AsyncStorage wrapper ──────────────────────
// I-ZUSTAND-PERSIST-DEBOUNCED — Coalesces rapid Zustand persist writes (e.g.
// during heavy swipe sessions) into a single trailing batch every 250ms. Cuts
// AsyncStorage write rate by ~80% in swipe-heavy paths; SQLite-backed Android
// is the primary beneficiary (20-200ms per raw setItem on mid-tier).
//
// SAFETY: an AppState 'background'/'inactive' listener forces a flush so
// pending writes survive process kill. Without this guarantee, app-killed
// mid debounce-window would lose the most recent state. CI gate enforces.
//
// CORRECTNESS: getItem checks pendingWrites first to avoid read-write race
// during Zustand hydration (could otherwise read stale persisted value while
// fresher write is queued).
const FLUSH_MS = 250;
const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const flushPendingWrites = async (): Promise<void> => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingWrites.size === 0) return;
  const entries: [string, string][] = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  try {
    await AsyncStorage.multiSet(entries);
  } catch (err) {
    console.error("[Zustand persist] Failed to flush pending writes:", err);
    // Re-queue on failure — best-effort. Constitution #3: surface, don't swallow.
    for (const [k, v] of entries) {
      if (!pendingWrites.has(k)) pendingWrites.set(k, v);
    }
  }
};

const debouncedAsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    // Read pending in-flight value first to avoid race during hydration.
    if (pendingWrites.has(key)) return pendingWrites.get(key) ?? null;
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    pendingWrites.set(key, value);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void flushPendingWrites();
    }, FLUSH_MS);
  },
  removeItem: async (key: string): Promise<void> => {
    // Remove is user-explicit (logout, schema bump) — never debounced.
    pendingWrites.delete(key);
    await AsyncStorage.removeItem(key);
  },
};

// Module-scoped AppState listener — flushes on background/inactive to survive
// process kill. Subscription lives for app lifetime; no cleanup needed.
// (Imported as RNAppState to avoid collision with the local AppState interface
// defined below, which describes the Zustand store shape.)
RNAppState.addEventListener("change", (state: AppStateStatus) => {
  if (state === "background" || state === "inactive") {
    void flushPendingWrites();
  }
});

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

  // [ORCH-0504] Deck preferences refresh counter — incremented each time the
  // user saves preferences. Used as part of the AsyncStorage key schema in
  // SwipeableCards (mingla_card_state_{mode}_{refreshKey}_*). MUST be
  // persisted so cross-session lookups find their keys; previously lived as
  // local useState in AppStateManager → reset on cold launch → AsyncStorage
  // orphans and the deck came back from card 1 after any prior pref save.
  // Phase 2.5 is expected to migrate full swipe state into a Zustand-persisted
  // registry; until then this counter is the persistence unit that keeps
  // swipe state keys stable across cold launches.
  preferencesRefreshKey: number;

  // UI overlay state (not persisted)
  showAccountSettings: boolean;

  // ─── ORCH-0679 Wave 2.8 Path B — Tab state registry (NOT persisted) ────────
  // Session-scoped storage to preserve scroll position, filter state, and
  // active panel/sub-tab across tab unmount/remount. Path B switched the tab
  // rendering pattern from "all 6 always mounted" to "only active tab mounted"
  // — this registry is what makes that switch UX-equivalent (or better) than
  // the old all-mounted approach.
  // Spec §3-§4 (SPEC_ORCH-0679_WAVE2_8_PATH_B_TAB_MOUNT_UNMOUNT.md).
  tabScroll: {
    discover_main: number;
    connections_friends: number;
    connections_add: number;
    connections_blocked: number;
    saved: number;
    likes_saved: number;
    likes_calendar: number;
    profile: number;
  };
  // Discover filter state — null = use component defaults on first mount.
  // Type kept loose (any) here to avoid circular import; DiscoverScreen owns the shape.
  discoverFilters: { date: string; price: string; genre: string } | null;
  // Saved filters
  savedFilters: {
    searchQuery: string;
    selectedCategory: string | null;
    matchScoreFilter: number | null;
    dateRangeFilter: 'all' | '7' | '30';
    sortOption: 'newest' | 'oldest' | 'matchHigh' | 'matchLow';
  } | null;
  // Active panel/sub-tab state
  connectionsActivePanel: 'friends' | 'add' | 'blocked' | null;
  connectionsFriendsModalTab: 'friend-list' | 'requests' | 'add' | null;
  likesActiveTab: 'saved' | 'calendar';

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

  // [ORCH-0504] Mutator for preferencesRefreshKey. Accepts either a new value
  // or an updater function (to support `setPreferencesRefreshKey((k) => k + 1)`
  // idiom used at AppStateManager + app/index.tsx pref-save call sites).
  setPreferencesRefreshKey: (updater: number | ((prev: number) => number)) => void;

  // ─── ORCH-0679 Wave 2.8 Path B — Tab registry setters ──────────────────────
  setTabScroll: (key: keyof AppState['tabScroll'], y: number) => void;
  setDiscoverFilters: (filters: AppState['discoverFilters']) => void;
  setSavedFilters: (filters: AppState['savedFilters']) => void;
  setConnectionsActivePanel: (panel: AppState['connectionsActivePanel']) => void;
  setConnectionsFriendsModalTab: (tab: AppState['connectionsFriendsModalTab']) => void;
  setLikesActiveTab: (tab: 'saved' | 'calendar') => void;

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
      preferencesRefreshKey: 0, // [ORCH-0504] persisted refresh counter
      showAccountSettings: false,

      // ─── ORCH-0679 Wave 2.8 Path B — Tab registry initial state ──────────
      tabScroll: {
        discover_main: 0,
        connections_friends: 0,
        connections_add: 0,
        connections_blocked: 0,
        saved: 0,
        likes_saved: 0,
        likes_calendar: 0,
        profile: 0,
      },
      discoverFilters: null,
      savedFilters: null,
      connectionsActivePanel: null,
      connectionsFriendsModalTab: null,
      likesActiveTab: 'saved',

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

      // [ORCH-0504] Updater supports both raw number and (prev) => next forms.
      // Mirrors React's useState setter shape so call sites using
      // `setPreferencesRefreshKey((k: number) => k + 1)` continue to work
      // unchanged after lifting from AppStateManager useState into Zustand.
      setPreferencesRefreshKey: (updater) =>
        set((state: AppState) => ({
          preferencesRefreshKey:
            typeof updater === 'function'
              ? updater(state.preferencesRefreshKey)
              : updater,
        })),

      // ─── ORCH-0679 Wave 2.8 Path B — Tab registry setters ────────────────
      setTabScroll: (key, y) =>
        set((state: AppState) => ({
          tabScroll: { ...state.tabScroll, [key]: y },
        })),
      setDiscoverFilters: (discoverFilters) => set({ discoverFilters }),
      setSavedFilters: (savedFilters) => set({ savedFilters }),
      setConnectionsActivePanel: (connectionsActivePanel) => set({ connectionsActivePanel }),
      setConnectionsFriendsModalTab: (connectionsFriendsModalTab) => set({ connectionsFriendsModalTab }),
      setLikesActiveTab: (likesActiveTab) => set({ likesActiveTab }),

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
          // [ORCH-0504] Constitutional #6: logout clears everything. The next
          // user starts at refreshKey=0, producing fresh AsyncStorage keys.
          preferencesRefreshKey: 0,
          // ORCH-0679 Wave 2.8: clear tab registry on logout (Constitution #6)
          tabScroll: {
            discover_main: 0,
            connections_friends: 0,
            connections_add: 0,
            connections_blocked: 0,
            saved: 0,
            likes_saved: 0,
            likes_calendar: 0,
            profile: 0,
          },
          discoverFilters: null,
          savedFilters: null,
          connectionsActivePanel: null,
          connectionsFriendsModalTab: null,
          likesActiveTab: 'saved',
        }),
    })),  // end of state definition + devLoggerMiddleware
    {
      name: "mingla-mobile-storage",
      // ORCH-0675 Wave 1 — debouncedAsyncStorage wrapper required.
      // (I-ZUSTAND-PERSIST-DEBOUNCED) AppState background flush above
      // prevents data loss on app kill. Do NOT revert to raw AsyncStorage.
      storage: createJSONStorage(() => debouncedAsyncStorage),
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
        // [ORCH-0504] I-REFRESHKEY-PERSISTED — the AsyncStorage swipe-state key
        // schema `mingla_card_state_${mode}_${refreshKey}_*` depends on this
        // value being stable across cold launches. Pre-fix: local useState in
        // AppStateManager → reset to 0 on cold launch → orphan AsyncStorage
        // keys → deck reset to card 1.
        preferencesRefreshKey: state.preferencesRefreshKey,
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
        // [ORCH-0504] Backward-compat guard — pre-fix storage did not persist
        // `preferencesRefreshKey`; hydrated state from those users will have
        // `undefined` here. Default to 0 (same as fresh cold launch). Next
        // pref save writes a correctly-keyed AsyncStorage entry and
        // subsequent cold launches restore from it. No DECK_SCHEMA_VERSION
        // bump needed — the failure mode of pre-fix hydration is graceful
        // (missing field → 0 default), not corrupting.
        if (state && typeof state.preferencesRefreshKey !== 'number') {
          state.preferencesRefreshKey = 0;
        }
        // RELIABILITY: Signal that Zustand has finished restoring persisted state.
        // Components can now trust that `profile`, `user`, `isAuthenticated`
        // reflect the persisted values (not just the defaults).
        useAppStore.setState({ _hasHydrated: true });
      },
    }
  )
);
