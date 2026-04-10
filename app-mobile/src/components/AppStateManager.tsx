import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useAppStore } from "../store/appStore";

export interface UserIdentity {
  firstName: string;
  lastName: string;
  username: string;
  profileImage: string | null;
  email: string;
  id: string;
  createdAt?: string;
  active?: boolean;
}
import { savedCardsService } from "../services/savedCardsService";
import { SessionService } from "../services/sessionService";
import { preloadRates } from "../services/currencyService";
import { useSavedCards } from "../hooks/useSavedCards";
import { useQueryClient } from "@tanstack/react-query";
import { savedCardKeys } from "../hooks/queryKeys";
import { useCalendarEntries } from "../hooks/useCalendarEntries";
import { useFriends } from "../hooks/useFriends";
// Realtime hooks (useBoardRealtimeSync, useSavesRealtimeSync, useSocialRealtime)
// moved to RealtimeSubscriptions.tsx component, mounted in index.tsx with
// key={realtimeEpoch} for clean remount on resume. See ORCH-0336.
// useForegroundRefresh moved to index.tsx (single instance). See ORCH-0236.
import { BoardSessionData } from "../services/boardSessionService";

// Shape of pending sessions (created or invited) returned by refreshAllSessions().
// Stored alongside active BoardSessionData in the boardsSessions state array.
export interface PendingSessionEntry {
  id: string;
  name: string;
  status: string;
  creatorId?: string;
  created_by?: string;
  participants?: { user_id: string; has_accepted: boolean }[];
  createdAt?: string;
  invitedBy?: string;
  inviterProfile?: {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
  };
}

// Union of all shapes that can live in boardsSessions state.
export type BoardSessionEntry = BoardSessionData | PendingSessionEntry;

const DEFAULT_BOARDS_SESSIONS: BoardSessionEntry[] = [];

// Safe AsyncStorage operations
const safeAsyncStorageGet = async (key: string, defaultValue: any) => {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return defaultValue;
  }
};

const safeAsyncStorageSet = async (key: string, value: any) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
};

// Stable empty array constants to prevent infinite loops in useEffect dependencies
const EMPTY_SAVED_CARDS: any[] = [];
const EMPTY_CALENDAR_ENTRIES: any[] = [];

export function useAppState() {
  // Supabase authentication
  const {
    user,
    loading: authLoading,
    signOut,
    signInWithGoogle,
    signInWithApple,
  } = useAuthSimple();

  // Stable ref for signOut so useCallback-wrapped handleSignOut doesn't
  // re-create on every render (signOut is not memoized in useAuthSimple).
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  const {
    _hasHydrated,
    profile,
    showAccountSettings,
    setShowAccountSettings,
    setProfile,
  } = useAppStore();

  // Onboarding state
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [onboardingData, setOnboardingData] = useState(null);
  const [isLoadingOnboarding, setIsLoadingOnboarding] = useState(true);
  const [showOnboardingFlow, setShowOnboardingFlow] = useState(false);

  // UI state
  type PageName =
    | "home"
    | "discover"
    | "connections"
    | "likes"
    | "saved"
    | "profile"
    | "profile-settings"
    | "account-settings"
;

  // Pages safe to restore after process death. Board-view and modal-like pages
  // (settings, legal) are excluded — they depend on complex state that won't
  // survive process death, so restoring them would show broken screens.
  const PERSISTED_PAGES: readonly PageName[] = ['connections', 'discover', 'saved', 'profile'] as const;

  const [currentPage, setCurrentPage] = useState<PageName>("home");
  const [viewingFriendProfileId, setViewingFriendProfileId] = useState<string | null>(null);

  // Persist currentPage to AsyncStorage so the user returns to their last page
  // after process death. Only safe top-level pages are persisted (no modals,
  // no modals). Home is the default — removing the key restores it.
  useEffect(() => {
    if ((PERSISTED_PAGES as readonly string[]).includes(currentPage)) {
      AsyncStorage.setItem('mingla_last_page', currentPage);
    } else {
      AsyncStorage.removeItem('mingla_last_page');
    }
  }, [currentPage]);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showCollabPreferences, setShowCollabPreferences] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState<any>(null);
  // Load currentMode from storage first, then verify with database
  const [currentMode, setCurrentModeState] = useState<"solo" | string | null>(
    null
  );
  // Session ID loaded from storage alongside currentMode — gives index.tsx an
  // immediate value so the pill bar highlights correctly on first render.
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);

  // Wrapper to update currentMode and persist to storage.
  // ALWAYS saves both the mode name AND the session UUID so that on app reopen
  // we can resolve the session instantly from storage without a network round-trip.
  const setCurrentMode = (mode: "solo" | string, sessionId?: string | null) => {
    // Always update state to ensure immediate propagation
    if (currentMode !== mode) {
      setCurrentModeState(mode);
    }
    // Keep initialSessionId in sync so index.tsx's pill bar highlights immediately
    if (sessionId) {
      setInitialSessionId(sessionId);
    }

    // Persist the last mode to storage with session ID
    const modeData =
      mode === "solo"
        ? { mode: "solo", sessionId: null }
        : { mode, sessionId: sessionId || null };
    safeAsyncStorageSet("mingla_last_mode", modeData);
  };
  const [preSelectedFriend, setPreSelectedFriend] = useState<any>(null);
  const [activeSessionData, setActiveSessionData] = useState<any>(null);

  // Data state with lazy initialization
  const [userPreferences, setUserPreferences] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [collaborationPreferences, setCollaborationPreferences] = useState<{
    [sessionId: string]: any;
  }>({});

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [preferencesRefreshKey, setPreferencesRefreshKey] = useState(0); // Key to trigger experience refresh

  const [activityNavigation, setActivityNavigation] = useState<{
    selectedBoard?: any;
    activeTab?: "saved" | "boards" | "calendar";
    discussionTab?: string;
  } | null>(null);

  // Deep link params forwarded from notification taps / push clicks.
  // Consumed once by the target page, then cleared.
  const [deepLinkParams, setDeepLinkParams] = useState<Record<string, string> | null>(null);

  const [userIdentity, setUserIdentity] = useState<UserIdentity>({
    firstName: "",
    lastName: "",
    username: "",
    profileImage: null,
    email: "",
    id: "",
    createdAt: profile?.created_at,
    active: true,
  });

  const [accountPreferences, setAccountPreferences] = useState<{
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  }>({
    currency: "USD",
    measurementSystem: "Imperial",
  });

  // Large data arrays with lazy initialization
  const [removedCardIds, setRemovedCardIds] = useState([]);

  // Use TanStack Query for saved cards and calendar entries
  const queryClient = useQueryClient();
  const { data: savedCardsData, isLoading: isLoadingSavedCards, isError: isSavedCardsError, refetch: refetchSavedCards } =
    useSavedCards(user?.id);
  const { data: calendarEntriesRawData, isLoading: isLoadingCalendarEntries } =
    useCalendarEntries(user?.id);
  const { unblockFriend } = useFriends();

  // Realtime hooks and useForegroundRefresh moved to index.tsx / RealtimeSubscriptions.
  // See ORCH-0336 (duplicate hook), ORCH-0237 (binding loss), ORCH-0236 (duplicate).

  // Use stable empty array constants to prevent infinite loops
  const savedCards = savedCardsData ?? EMPTY_SAVED_CARDS;
  const calendarEntriesRaw = calendarEntriesRawData ?? EMPTY_CALENDAR_ENTRIES;

  // Wrapper function to update saved cards (invalidates query to refetch)
  // This maintains backward compatibility with code that calls setSavedCards
  const setSavedCards = (
    cardsOrUpdater: any[] | ((prev: any[]) => any[]) | any
  ) => {
    if (typeof cardsOrUpdater === "function") {
      // If it's a function, we need to get current data, apply the function, then invalidate
      const currentData =
        queryClient.getQueryData<any[]>(savedCardKeys.list(user?.id ?? '')) || [];
      const updated = cardsOrUpdater(currentData);
      queryClient.setQueryData(savedCardKeys.list(user?.id ?? ''), updated);
    } else if (Array.isArray(cardsOrUpdater)) {
      // If it's an array, set it directly
      queryClient.setQueryData(savedCardKeys.list(user?.id ?? ''), cardsOrUpdater);
    } else {
      // If it's something else (like empty object), just invalidate to refetch
      queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user?.id ?? '') });
      return;
    }
    // Invalidate to ensure fresh data on next fetch
    queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user?.id ?? '') });
  };
  const [boardsSessions, setBoardsSessions] = useState(DEFAULT_BOARDS_SESSIONS);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);


  // Authentication state - now using Supabase authentication
  const isAuthenticated = !!user; // Use Supabase user state
  const userRole = "explorer"; // Default role, can be extended later

  // Preload exchange rates so prices use real rates app-wide
  useEffect(() => {
    preloadRates();
  }, []);

  // Force loading to false after timeout or if authLoading is false
  const isLoadingAuth = authLoading;

  // Load onboarding data from profile (authentication handled by Supabase)
  useEffect(() => {
    if (profile) {
      const hasCompleted = profile.has_completed_onboarding === true;
      setHasCompletedOnboarding(hasCompleted);
      // Functional updater reads current showOnboardingFlow without adding it to deps,
      // preventing the effect from re-running every time showOnboardingFlow is set to true.
      if (!hasCompleted && user) {
        setShowOnboardingFlow((current) => current ? current : true);
      }
    } else if (!user) {
      setHasCompletedOnboarding(false);
    }

    setIsLoadingOnboarding(false);
  }, [profile, user]);

  // Restore persisted page after auth + profile are confirmed and onboarding
  // is resolved. Runs once per sign-in cycle. If the user completed onboarding,
  // restore their last page. If they're in onboarding, skip (Home is correct).
  const hasRestoredPageRef = useRef(false);
  useEffect(() => {
    if (!user || !profile || hasRestoredPageRef.current) return;
    const hasCompleted = profile.has_completed_onboarding === true;
    if (!hasCompleted) return; // Onboarding overrides — don't restore

    hasRestoredPageRef.current = true;
    AsyncStorage.getItem('mingla_last_page').then(savedPage => {
      if (savedPage && (PERSISTED_PAGES as readonly string[]).includes(savedPage)) {
        setCurrentPage(savedPage as PageName);
      }
    });
  }, [user, profile]);

  // Update userIdentity when Supabase authentication changes
  useEffect(() => {
    if (user && profile) {
      // Use the actual first_name and last_name fields from the profile
      const updatedIdentity = {
        firstName: profile.first_name || user.email?.split("@")[0] || "User",
        lastName: profile.last_name || "",
        username: profile.username || user.email?.split("@")[0] || "user",
        profileImage: profile.avatar_url || null,
        email: user.email || "",
        id: user.id,
        createdAt: profile?.created_at,
        active: profile?.active !== false,
      };

      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet("mingla_user_identity", updatedIdentity);

      // Also sync account preferences from profile if available
      if (profile.currency || profile.measurement_system) {
        const updatedPrefs: { currency: string; measurementSystem: "Metric" | "Imperial" } = {
          currency: profile.currency || "USD",
          measurementSystem: profile.measurement_system === "metric" ? "Metric" : "Imperial",
        };
        setAccountPreferences(updatedPrefs);
        safeAsyncStorageSet("mingla_account_preferences", updatedPrefs);
      }
    } else if (user && !profile) {
      // User is authenticated but no profile yet - use basic info from user
      const emailName = user.email?.split("@")[0] || "User";
      const updatedIdentity = {
        firstName: emailName,
        lastName: "",
        username: emailName,
        profileImage: null,
        email: user.email || "",
        id: user.id,
        createdAt: user?.created_at,
        active: true,
      };

      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet("mingla_user_identity", updatedIdentity);
    } else {
    }
  }, [user, profile]);

  // Reset navigation/UI auth state when signed out to avoid stale page carryover.
  // boardsSessions MUST be cleared here — without this, a second user signing in
  // on the same device session would briefly see the previous user's real session
  // names until refreshAllSessions() completes. Friends data is managed entirely
  // by React Query (cleared via queryClient.clear() in handleSignOut).
  useEffect(() => {
    if (!user) {
      setCurrentPage("home");
      // Reset page restoration guard so the next sign-in can restore again
      hasRestoredPageRef.current = false;

      setShowAccountSettings(false);
      setShowPreferences(false);
      setShowCollabPreferences(false);
      setShowShareModal(false);
      setShowOnboardingFlow(false);
      setHasCompletedOnboarding(false);
      setOnboardingData(null);
      setViewingFriendProfileId(null);
      // Clear session data so the next authenticated user never sees
      // the previous user's real data during the brief window before fresh data loads.
      setBoardsSessions(DEFAULT_BOARDS_SESSIONS);
      setIsLoadingBoards(false);
      // Clear stored mode/session seed so the next user doesn't inherit
      // the previous user's pill-bar state during the brief pre-DB-verify window.
      setInitialSessionId(null);
      setCurrentModeState(null);
    }
  }, [user]);

  // Initialize mode AND session ID from storage on mount
  useEffect(() => {
    const initializeMode = async () => {
      const stored = await safeAsyncStorageGet("mingla_last_mode", "solo");
      // Handle both old format (string) and new format (object)
      const storedMode =
        typeof stored === "string" ? stored : stored?.mode || "solo";
      const storedSessionId =
        typeof stored === "object" ? stored?.sessionId ?? null : null;
      setCurrentModeState(storedMode);
      setInitialSessionId(storedSessionId);
    };
    initializeMode();
  }, []); // Run once on mount

  // Load active session from database on user login
  // The `cancelled` flag prevents mode oscillation when a slow DB query overlaps
  // with a user-initiated mode switch (the stale result is discarded).
  useEffect(() => {
    let cancelled = false;

    const loadActiveSession = async () => {
      // Wait for initial mode to be loaded
      if (currentMode === null) return;

      if (!user?.id) {
        // No user, ensure solo mode
        if (currentMode !== "solo") {
          setCurrentMode("solo");
        }
        return;
      }

      try {
        // If current mode is solo (from storage), use it and return early
        if (currentMode === "solo") {
          // Solo mode is persisted, no need to fetch from database
          return;
        }

        // For collaboration modes, verify against database
        const activeSession = await SessionService.getActiveSession(user.id);

        // If mode changed while we were fetching, discard this result
        if (cancelled) return;

        if (activeSession) {
          // Get stored mode data to check session ID
          const storedModeData = await safeAsyncStorageGet(
            "mingla_last_mode",
            null
          );

          // Check again after async operation
          if (cancelled) return;

          const storedSessionId = storedModeData?.sessionId;

          // Only update if:
          // 1. Names don't match (normal case - different session)
          // 2. Names match but IDs don't match (edge case - same name, different session)
          // This prevents unnecessary updates when name and ID both match
          const namesMatch = currentMode === activeSession.sessionName;
          const idsMatch = storedSessionId === activeSession.sessionId;

          if (!namesMatch || (namesMatch && !idsMatch)) {
            // Update to the active session (either name changed or ID changed)
            setCurrentMode(activeSession.sessionName, activeSession.sessionId);
          }
          // If both name and ID match, no update needed (no refetch)
        } else {
          // No valid active session, default to solo mode
          if (currentMode !== "solo") {
            setCurrentMode("solo");
          }
        }
      } catch (error) {
        console.error("Error loading active session:", error);
        // On error, default to solo mode
        if (!cancelled && currentMode !== "solo") {
          setCurrentMode("solo");
        }
      }
    };

    if (user && currentMode !== null) {
      loadActiveSession();
    }

    return () => { cancelled = true; };
  }, [user?.id, currentMode]);

  // Load other data from AsyncStorage
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const [
          notificationsEnabledData,
          userIdentityData,
          accountPreferencesData,
          removedCardIdsData,
          boardsSessionsData,
        ] = await Promise.all([
          safeAsyncStorageGet("mingla_notifications_enabled", true),
          safeAsyncStorageGet("mingla_user_identity", {
            firstName: "",
            lastName: "",
            username: "",
            profileImage: null,
            email: "",
            id: "",
            active: true,
          }),
          safeAsyncStorageGet("mingla_account_preferences", {
            currency: "USD",
            measurementSystem: "Imperial",
          }),
          safeAsyncStorageGet("mingla_removed_cards", []),
          safeAsyncStorageGet(
            "mingla_boards_sessions",
            DEFAULT_BOARDS_SESSIONS
          ),
        ]);

        setNotificationsEnabled(notificationsEnabledData);
        // Only set userIdentity from storage if we don't have Supabase data yet
        if (!user || !profile) {
          setUserIdentity(userIdentityData);
        }
        setAccountPreferences(accountPreferencesData);
        setRemovedCardIds(removedCardIdsData);
        setBoardsSessions(boardsSessionsData);
      } catch (error) {
        console.error("Error loading stored data:", error);
      }
    };

    loadStoredData();
  }, []);

  // Normalize calendar entries from React Query into the shape used by CalendarTab
  const calendarEntries = useMemo(() => {
    if (!calendarEntriesRaw || calendarEntriesRaw.length === 0) {
      return [];
    }

    return calendarEntriesRaw
      .filter((record) => !record.archived_at) // Exclude archived entries
      .map((record) => {
        const cardData = record.card_data || {};
        const scheduledDate = new Date(record.scheduled_at);
        const dateStr = scheduledDate.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const timeStr = scheduledDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        return {
          id: record.id,
          card_id: record.card_id,
          board_card_id: record.board_card_id,
          title: cardData.title || "Saved Experience",
          category: cardData.category || "Experience",
          categoryIcon: cardData.categoryIcon || "star",
          image:
            cardData.image ||
            (Array.isArray(cardData.images) ? cardData.images[0] : ""),
          images: cardData.images || (cardData.image ? [cardData.image] : []),
          rating: cardData.rating || 0,
          reviewCount: cardData.reviewCount || 0,
          date: dateStr,
          time: timeStr,
          source: record.source || "solo",
          sourceDetails: cardData.sessionName
            ? `From ${cardData.sessionName}`
            : "Solo Experience",
          priceRange: cardData.priceRange || "TBD",
          description: cardData.description || "",
          fullDescription:
            cardData.fullDescription || cardData.description || "",
          address: cardData.address || "",
          highlights: cardData.highlights || [],
          socialStats: cardData.socialStats || {
            views: 0,
            likes: 0,
            saves: 0,
          },
          status: record.status,
          experience: {
            ...cardData,
            id: record.card_id || cardData.id,
          },
          suggestedDates: [record.scheduled_at],
          scheduled_at: record.scheduled_at,
          device_calendar_event_id: record.device_calendar_event_id,
          sessionName: cardData.sessionName,
          archived_at: record.archived_at,
        };
      });
  }, [calendarEntriesRaw]);

  // Wrapper function to update calendar entries (invalidates query to refetch)
  // This maintains backward compatibility with code that calls setCalendarEntries
  const setCalendarEntries = (updater: any) => {
    if (typeof updater === "function") {
      // If it's a function, we can't easily update React Query cache this way
      // Instead, invalidate the query to trigger a refetch
      queryClient.invalidateQueries({
        queryKey: ["calendarEntries", user?.id],
      });
    } else {
      // If it's a direct value, invalidate to refetch
      queryClient.invalidateQueries({
        queryKey: ["calendarEntries", user?.id],
      });
    }
  };

  // Board session sync is handled by refreshAllSessions() in app/index.tsx
  // which fetches both active AND pending (sent-invite) sessions together.
  // Having a separate sync here that only fetches active boards caused pending
  // invite pills to blink/disappear by overwriting the full state.

  // Utility functions
  const updateBoardsSessions = (updatedBoards: any[]) => {
    setBoardsSessions(updatedBoards);
    safeAsyncStorageSet("mingla_boards_sessions", updatedBoards);
  };

  const handleUserIdentityUpdate = async (updatedIdentity: any) => {
    try {
      // Update local state first
      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet("mingla_user_identity", updatedIdentity);

      // Update Supabase profile if user is authenticated
      if (user?.id) {
        const { supabase } = await import("../services/supabase");

        // Update profile fields in profiles table
        const { error } = await supabase
          .from("profiles")
          .update({
            first_name: updatedIdentity.firstName,
            last_name: updatedIdentity.lastName,
            username: updatedIdentity.username,
            avatar_url: updatedIdentity.profileImage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id);

        if (error) {
          console.error("Error updating profile in Supabase:", error);
          // Show error notification
          setNotifications((prev) => [
            ...prev,
            {
              id: `profile-update-error-${Date.now()}`,
              type: "error" as const,
              title: "Profile Update Failed",
              message: "Failed to update profile. Please try again.",
              autoHide: true,
              duration: 3000,
            },
          ]);
        } else {
          // Also update the in-memory profile in the app store so other screens reflect changes immediately
          if (profile) {
            const newDisplayName = [updatedIdentity.firstName, updatedIdentity.lastName]
              .filter(Boolean)
              .join(' ')
              .trim();

            setProfile({
              ...profile,
              first_name: updatedIdentity.firstName,
              last_name: updatedIdentity.lastName,
              display_name: newDisplayName || profile?.display_name,
              username: updatedIdentity.username,
              avatar_url: updatedIdentity.profileImage,
            });
          }

          // Optionally update auth user's email if it changed
          if (updatedIdentity.email && updatedIdentity.email !== user.email) {
            try {
              await supabase.auth.updateUser({ email: updatedIdentity.email });
            } catch (authError) {
              console.error("Error updating auth email in Supabase:", authError);
            }
          }

          // Show success notification
          setNotifications((prev) => [
            ...prev,
            {
              id: `profile-update-success-${Date.now()}`,
              type: "success" as const,
              title: "Profile Updated",
              message: "Your profile has been updated successfully.",
              autoHide: true,
              duration: 2000,
            },
          ]);
        }
      }
    } catch (error) {
      console.error("Error updating user identity:", error);
      setNotifications((prev) => [
        ...prev,
        {
          id: `profile-update-error-${Date.now()}`,
          type: "error" as const,
          title: "Profile Update Failed",
          message: "Failed to update profile. Please try again.",
          autoHide: true,
          duration: 3000,
        },
      ]);
    }
  };

  const handleAccountPreferencesUpdate = (updatedPreferences: any) => {
    setAccountPreferences(updatedPreferences);
    safeAsyncStorageSet("mingla_account_preferences", updatedPreferences);
  };

  // OAuth sign-in handlers (called by WelcomeScreen)
  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        // Error is already handled by signInWithGoogle (shows Alert)
      }
    } catch (error) {
      console.error("Unexpected error during Google sign-in:", error);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      const result = await signInWithApple();
      if (result.error) {
        // Error is already handled by signInWithApple (shows Alert)
      }
    } catch (error) {
      console.error("Unexpected error during Apple sign-in:", error);
    }
  };

  const handleSignOut = useCallback(async () => {
    try {
      // Reset navigation/UI state immediately so next sign-in starts on Explore
      setCurrentPage("home");

      setShowAccountSettings(false);
      setShowPreferences(false);
      setShowCollabPreferences(false);
      setShowShareModal(false);
      setShowOnboardingFlow(false);

      // Dissociate device from user in OneSignal — next login will re-associate
      const { logoutOneSignal } = await import("../services/oneSignalService");
      logoutOneSignal();

      // Reset RevenueCat customer so next sign-in gets the correct subscription state.
      // Fire-and-forget — sign-out must not block on SDK cleanup.
      import("../services/revenueCatService").then(({ logoutRevenueCat }) => {
        logoutRevenueCat().catch((e: unknown) =>
          console.warn("[SIGN-OUT] RevenueCat logout failed:", e)
        );
      }).catch(() => {});

      // Reset Mixpanel identity so events aren't attributed to the previous user.
      // trackLogout() calls reset() internally — clears distinct_id + super properties.
      import("../services/mixpanelService").then(({ mixpanelService }) => {
        try { mixpanelService.trackLogout(); } catch (e) {
          console.warn("[SIGN-OUT] Mixpanel reset failed:", e);
        }
      }).catch(() => {});

      // Clear in-memory offline queue (AsyncStorage key cleared by prefix sweep below)
      const { realtimeService } = await import('../services/realtimeService');
      realtimeService.clearQueue();

      // Clear all user data from the store immediately
      const store = useAppStore.getState();
      store.clearUserData();

      // Clear ALL user-scoped data from AsyncStorage.
      // Uses prefix sweep instead of explicit key list — future-proof against new keys.
      // Preserves: device-level keys (selected_language, translation_cache, REACT_QUERY_OFFLINE_CACHE)
      // and the Zustand persist key (mingla-mobile-storage) which is reset by clearUserData() above.
      // Wrapped in its own try/catch so queryClient.clear() and signOut() always execute
      // even if AsyncStorage is corrupted or throws.
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const userScopedKeys = allKeys.filter((key) => {
          if (key.startsWith("mingla_")) return true;
          if (key.startsWith("mingla:")) return true;
          if (key.startsWith("@mingla")) return true;
          if (key.startsWith("board_cache_")) return true;
          if (key.startsWith("dismissed_cards_")) return true;
          if (key.startsWith("debug_logs_")) return true;
          if (key === "offline_data") return true;
          if (key === "pending_actions") return true;
          if (key === "realtime_offline_queue") return true;
          if (key === "recommendation_cache") return true;
          return false;
        });
        if (userScopedKeys.length > 0) {
          await AsyncStorage.multiRemove(userScopedKeys);
        }
      } catch (storageError) {
        console.error("AsyncStorage cleanup failed:", storageError);
      }

      // Clear React Query cache — prevents stale server data from leaking across accounts
      queryClient.clear();

      // Clear local state
      setUserIdentity({
        firstName: "",
        lastName: "",
        username: "",
        profileImage: null,
        email: "",
        id: "",
        createdAt: "",
      });

      // Try Supabase sign out (non-blocking - continue even if it fails)
      await signOutRef.current();
    } catch (error) {
      console.error("Error during sign out:", error);
      // Continue with local state clearing even if other operations fail
      setUserIdentity({
        firstName: "",
        lastName: "",
        username: "",
        profileImage: null,
        email: "",
        id: "",
        createdAt: "",
      });
    }
  }, [queryClient]);

  // Register handleSignOut with the 401 handler so forced sign-outs
  // trigger the full cleanup chain (SDK resets, AsyncStorage, React Query).
  useEffect(() => {
    const { setSignOutHandler } = require('../config/queryClient');
    setSignOutHandler(handleSignOut);
  }, [handleSignOut]);

  return {
    // Authentication State (now using Supabase)
    isAuthenticated,
    userRole,
    isLoadingAuth,
    _hasHydrated,
    user,
    profile,

    // Onboarding State
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    onboardingData,
    setOnboardingData,
    isLoadingOnboarding,
    setIsLoadingOnboarding,
    showOnboardingFlow,
    setShowOnboardingFlow,
    currentPage,
    setCurrentPage,
    showPreferences,
    setShowPreferences,
    showCollabPreferences,
    setShowCollabPreferences,
    showAccountSettings,
    setShowAccountSettings,
    showShareModal,
    setShowShareModal,
    shareData,
    setShareData,
    currentMode,
    setCurrentMode,
    initialSessionId,
    preSelectedFriend,
    setPreSelectedFriend,
    activeSessionData,
    setActiveSessionData,
    userPreferences,
    setUserPreferences,
    notifications,
    setNotifications,
    collaborationPreferences,
    setCollaborationPreferences,
    notificationsEnabled,
    setNotificationsEnabled,
    activityNavigation,
    setActivityNavigation,
    deepLinkParams,
    setDeepLinkParams,
    userIdentity,
    setUserIdentity,
    accountPreferences,
    setAccountPreferences,
    calendarEntries,
    setCalendarEntries,
    savedCards,
    setSavedCards,
    isLoadingSavedCards,
    isSavedCardsError,
    refetchSavedCards,
    isLoadingCalendarEntries,
    removedCardIds,
    setRemovedCardIds,
    boardsSessions,
    setBoardsSessions,
    isLoadingBoards,
    setIsLoadingBoards,
    preferencesRefreshKey,
    setPreferencesRefreshKey,
    viewingFriendProfileId,
    setViewingFriendProfileId,

    // Utilities
    updateBoardsSessions,
    handleUserIdentityUpdate,
    handleAccountPreferencesUpdate,
    safeAsyncStorageSet,
    unblockFriend,

    // Authentication Handlers (OAuth only)
    handleSignOut,
    handleGoogleSignIn,
    handleAppleSignIn,
  };
}
