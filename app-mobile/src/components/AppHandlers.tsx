import { Alert, Platform, ToastAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { savedCardKeys } from "../hooks/queryKeys";
import { useRef } from "react";
import { formatCurrency } from "./utils/formatters";
import { PreferencesService } from "../services/preferencesService";
import { savedCardsService } from "../services/savedCardsService";
import { BoardCardService } from "../services/boardCardService";
import { toastManager } from "../components/ui/Toast";
import { supabase } from "../services/supabase";
import { offlineService } from "../services/offlineService";
import { inAppNotificationService } from "../services/inAppNotificationService";
import { useAppStore } from "../store/appStore";
import { computePrefsHash } from "../utils/cardConverters";
import { TIER_BY_SLUG, PRICE_TIERS, PriceTierSlug } from '../constants/priceTiers';
import { normalizeCategoryArray } from '../utils/categoryUtils';

export function useAppHandlers(state: any) {
  const queryClient = useQueryClient();

  // Use a ref to always have access to the latest state object
  // This ensures handleSaveCard always reads the latest currentMode
  const stateRef = useRef(state);
  stateRef.current = state; // Update ref on every render

  const {
    setCurrentMode,
    setActiveSessionData,
    setShowCollabPreferences,
    setPreSelectedFriend,
    setNotifications,
    boardsSessions,
    updateBoardsSessions,
    userPreferences,
    calendarEntries,
    setCalendarEntries,
    savedCards,
    setSavedCards,
    removedCardIds,
    setRemovedCardIds,
    accountPreferences,
    setCurrentPage,
    setActivityNavigation,
    setNotificationsEnabled,
    setShowShareModal,
    setShareData,
    setUserPreferences,
    setCollaborationPreferences,
    setHasCompletedOnboarding,
    setOnboardingData,
    setUserIdentity,
    setAccountPreferences,
    user,
    setPreferencesRefreshKey,
    unblockFriend,
  } = state;

  const handleModeChange = async (mode: "solo" | string) => {
    if (mode === "solo") {
      // Switch to solo mode - no database action needed
      setCurrentMode("solo");
    } else {
      // Switch to a collaboration session - update database
      if (user?.id) {
        try {
          const sessionServiceModule = await import(
            "../services/sessionService"
          );
          const { SessionService } = sessionServiceModule;

          // Find session ID from mode (could be session name or ID)
          const session = boardsSessions.find(
            (s: any) =>
              s.id === mode || s.name === mode || (s as any).session_id === mode
          );

          if (session) {
            const sessionId = session.id || (session as any).session_id;
            // Use session.name (not the raw mode input) so currentMode matches
            // what the verification effect in AppStateManager expects. Without this,
            // mode flips UUID → name across two renders, causing double mode transitions,
            // recommendation wipes, and the "Pulling up more for you" loader flash.
            const sessionName = session.name ?? mode;
            const result = await SessionService.switchToSession(
              user.id,
              sessionId
            );

            if (result.success) {
              setCurrentMode(sessionName, sessionId);
            } else {
              console.error("Error switching to session:", result.error);
              // Fallback to solo if switch fails
              setCurrentMode("solo");
            }
          } else {
            // Session not found, default to solo
            setCurrentMode("solo");
          }
        } catch (error) {
          console.error("Error switching to session:", error);
          setCurrentMode("solo");
        }
      } else {
        // No user, just set mode without sessionId
        setCurrentMode(mode);
      }
    }
  };

  const handleCollabPreferencesOpen = (sessionData: any) => {
    setActiveSessionData(sessionData);
    setShowCollabPreferences(true);
  };

  const handleCollabPreferencesSave = async (preferences: any) => {
    // Get session ID from activeSessionData or currentMode
    let sessionId: string | null = null;

    if (state.activeSessionData?.id) {
      sessionId = state.activeSessionData.id;
    } else if (state.currentMode !== "solo") {
      // Find session by name
      const { data: sessions } = await supabase
        .from("collaboration_sessions")
        .select("id")
        .eq("name", state.currentMode)
        .limit(1);

      if (sessions && sessions.length > 0) {
        sessionId = sessions[0].id;
      }
    }

    // Normalize categories and intents once — shared by both collab and solo save paths
    const normalizedCats = normalizeCategoryArray(preferences.selectedCategories || []);
    const normalizedIntents = (preferences.selectedIntents || []).slice(0, 1);
    const collabTiers: PriceTierSlug[] = preferences.priceTiers ?? ['chill', 'comfy', 'bougie', 'lavish'];
    const collabHighest = PRICE_TIERS.slice().reverse().find(t => collabTiers.includes(t.slug));
    const collabBudgetMax = collabHighest?.max ?? 150;

    if (sessionId) {
      // Transform preferences to database format
      // Separate intents and categories — matches solo preferences table schema.
      const isGps = preferences.useLocation === "gps" || !preferences.searchLocation;
      const dbPreferences: any = {
        categories: normalizedCats,
        intents: normalizedIntents,
        price_tiers: collabTiers,
        budget_min: 0,
        budget_max: collabBudgetMax,
        travel_mode: preferences.travelMode || "walking",
        travel_constraint_type: 'time' as const,
        travel_constraint_value:
          typeof preferences.constraintValue === "number"
            ? preferences.constraintValue
            : 20,
        time_of_day: preferences.selectedTimeSlot || null,
        time_slot: preferences.selectedTimeSlot || null,
        exact_time: preferences.exactTime || null,
        datetime_pref: preferences.selectedDate || null,
        date_option: preferences.selectedDateOption
          ? ({ 'Now': 'now', 'Today': 'today', 'This Weekend': 'this-weekend', 'Pick a Date': 'pick-a-date' }[preferences.selectedDateOption as string] ?? preferences.selectedDateOption)
          : null,
        use_gps_location: isGps,
        custom_location: !isGps && preferences.searchLocation ? preferences.searchLocation : null,
      };

      // Add location if searchLocation is provided (backward compat for legacy readers)
      if (preferences.searchLocation) {
        dbPreferences.location = preferences.searchLocation;
      }

      // Save to database
      const { error } = await supabase.from("board_session_preferences").upsert(
        {
          session_id: sessionId,
          user_id: user.id,
          ...dbPreferences,
        },
        {
          onConflict: "session_id,user_id",
        }
      );

      if (error) {
        console.error("Error saving collaboration preferences:", error);
      }
    }

    // Also persist to the solo preferences table so that
    // useUserPreferences (which drives curated-hook enabled flags) stays
    // correct even after the TanStack cache staleTime expires.
    if (user?.id) {
      const soloDB: any = {
        mode: preferences.selectedIntents?.length > 0 ? "custom" : "explore",
        people_count: 1,
        price_tiers: collabTiers,
        budget_min: 0,
        budget_max: collabBudgetMax,
        categories: normalizedCats,
        intents: normalizedIntents,
        travel_mode: preferences.travelMode || "walking",
        travel_constraint_type: 'time' as const,
        travel_constraint_value:
          typeof preferences.constraintValue === "number" ? preferences.constraintValue : 20,
        datetime_pref: preferences.selectedDate
          ? new Date(preferences.selectedDate).toISOString()
          : new Date().toISOString(),
      };
      try {
        await PreferencesService.updateUserPreferences(user.id, soloDB);
        // Prime the TanStack + offline caches so future refetches return
        // the correct data instead of stale pre-collab values.
        queryClient.setQueryData(["userPreferences", user.id], soloDB);
        await offlineService.cacheUserPreferences({ profile_id: user.id, ...soloDB } as any);
      } catch (err) {
        console.error("Error mirroring collab prefs to solo table:", err);
      }
    }

    // Also update local state for backward compatibility
    if (state.activeSessionData) {
      setCollaborationPreferences((prev: any) => ({
        ...prev,
        [state.activeSessionData.id]: preferences,
      }));
    }

    // Log in-app notification
    inAppNotificationService.notifyPreferencesUpdated("collaboration");

    setShowCollabPreferences(false);
    setActiveSessionData(null);
  };

  const handleSendInvite = (sessionId: string, users: any[]) => {
    users.forEach((user) => {
      const notification = {
        id: `invite-${Date.now()}-${user.id}`,
        type: "success" as const,
        title: "Invite Sent!",
        message: `Collaboration invite sent to ${user.name}`,
        sessionName: sessionId,
        autoHide: true,
        duration: 3000,
      };
      setNotifications((prev: any) => [...prev, notification]);
    });
  };

  const handlePromoteToAdmin = (boardId: string, participantId: string) => {
    const updatedBoards = boardsSessions.map((board: any) => {
      if (board.id === boardId) {
        const updatedBoard = {
          ...board,
          admins: [...board.admins, participantId],
        };

        const participant = board.participants.find(
          (p: any) => p.id === participantId
        );
        const notification = {
          id: `promote-admin-${Date.now()}`,
          type: "success" as const,
          title: "Member Promoted",
          message: `${participant?.name} has been promoted to admin`,
          autoHide: true,
          duration: 3000,
        };
        setNotifications((prev: any) => [...prev, notification]);

        return updatedBoard;
      }
      return board;
    });

    updateBoardsSessions(updatedBoards);
  };

  const handleDemoteFromAdmin = (boardId: string, participantId: string) => {
    const updatedBoards = boardsSessions.map((board: any) => {
      if (board.id === boardId) {
        const updatedBoard = {
          ...board,
          admins: board.admins.filter(
            (adminId: string) => adminId !== participantId
          ),
        };

        const participant = board.participants.find(
          (p: any) => p.id === participantId
        );
        const notification = {
          id: `demote-admin-${Date.now()}`,
          type: "success" as const,
          title: "Admin Removed",
          message: `${participant?.name} is no longer an admin`,
          autoHide: true,
          duration: 3000,
        };
        setNotifications((prev: any) => [...prev, notification]);

        return updatedBoard;
      }
      return board;
    });

    updateBoardsSessions(updatedBoards);
  };

  const handleRemoveMember = (boardId: string, participantId: string) => {
    const board = boardsSessions.find((b: any) => b.id === boardId);
    if (!board) return;

    const participant = board.participants.find(
      (p: any) => p.id === participantId
    );
    const updatedBoards = boardsSessions
      .map((b: any) => {
        if (b.id === boardId) {
          const updatedParticipants = b.participants.filter(
            (p: any) => p.id !== participantId
          );
          const updatedAdmins = b.admins.filter(
            (adminId: string) => adminId !== participantId
          );

          if (updatedParticipants.length < 2) {
            return null;
          }

          return {
            ...b,
            participants: updatedParticipants,
            admins: updatedAdmins,
          };
        }
        return b;
      })
      .filter(Boolean);

    const notification = {
      id: `remove-member-${Date.now()}`,
      type: "success" as const,
      title: updatedBoards.find((b: any) => b.id === boardId)
        ? "Member Removed"
        : "Board Deleted",
      message: updatedBoards.find((b: any) => b.id === boardId)
        ? `${participant?.name} has been removed from the board`
        : `Board "${board.name}" was deleted (insufficient members)`,
      autoHide: true,
      duration: 4000,
    };
    setNotifications((prev: any) => [...prev, notification]);

    updateBoardsSessions(updatedBoards);
  };

  const handleLeaveBoard = (boardId: string) => {
    const board = boardsSessions.find((b: any) => b.id === boardId);
    if (!board) return;

    const currentUserId = board.currentUserId || "you";
    const isCurrentUserAdmin = board.admins.includes(currentUserId);

    const updatedBoards = boardsSessions
      .map((b: any) => {
        if (b.id === boardId) {
          const updatedParticipants = b.participants.filter(
            (p: any) => p.id !== currentUserId
          );
          let updatedAdmins = b.admins.filter(
            (adminId: string) => adminId !== currentUserId
          );

          if (updatedParticipants.length < 2) {
            return null;
          }

          if (
            isCurrentUserAdmin &&
            updatedAdmins.length === 0 &&
            updatedParticipants.length >= 2
          ) {
            const nonAdminParticipants = updatedParticipants.filter(
              (p: any) => !updatedAdmins.includes(p.id)
            );
            if (nonAdminParticipants.length > 0) {
              const randomIndex = Math.floor(
                Math.random() * nonAdminParticipants.length
              );
              const newAdmin = nonAdminParticipants[randomIndex];
              updatedAdmins = [newAdmin.id];

              const adminNotification = {
                id: `new-admin-${Date.now()}`,
                type: "success" as const,
                title: "New Admin Assigned",
                message: `${newAdmin.name} is now the admin of "${board.name}"`,
                autoHide: true,
                duration: 4000,
              };
              setNotifications((prev: any) => [...prev, adminNotification]);
            }
          }

          return {
            ...b,
            participants: updatedParticipants,
            admins: updatedAdmins,
          };
        }
        return b;
      })
      .filter(Boolean);

    const notification = {
      id: `leave-board-${Date.now()}`,
      type: "success" as const,
      title: updatedBoards.find((b: any) => b.id === boardId)
        ? "Left Board"
        : "Board Deleted",
      message: updatedBoards.find((b: any) => b.id === boardId)
        ? `You have left "${board.name}"`
        : `Board "${board.name}" was deleted (insufficient members)`,
      autoHide: true,
      duration: 4000,
    };
    setNotifications((prev: any) => [...prev, notification]);

    updateBoardsSessions(updatedBoards);

    if (!updatedBoards.find((b: any) => b.id === boardId)) {
      setCurrentPage("activity");
      setActivityNavigation({ activeTab: "boards" });
    }
  };

  const handleAddToBoard = (sessionIds: string[], friend: any) => {
    sessionIds.forEach((sessionId, index) => {
      const notification = {
        id: `add-to-board-${Date.now()}-${friend.id}-${index}`,
        type: "success" as const,
        title:
          sessionIds.length === 1
            ? "Added to Board!"
            : `Added to ${sessionIds.length} Boards!`,
        message:
          sessionIds.length === 1
            ? `${friend.name} has been added to the collaboration board`
            : `${friend.name} has been added to ${sessionIds.length} collaboration boards`,
        sessionName: sessionId,
        autoHide: true,
        duration: 4000,
      };

      setTimeout(() => {
        setNotifications((prev: any) => [...prev, notification]);
      }, index * 100);
    });
  };

  const handleShareSavedCard = (
    friend: any,
    suppressNotification?: boolean
  ) => {
    if (!suppressNotification) {
      const notification = {
        id: `share-saved-card-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: "Card Shared!",
        message: `A saved experience has been shared with ${friend.name}`,
        autoHide: true,
        duration: 3000,
      };
      setNotifications((prev: any) => [...prev, notification]);
    }
  };

  // Toast-only handlers — the actual DB operations (removeFriend, blockFriend)
  // are performed by ConnectionsPage via useFriends() which invalidates React Query.
  // These callbacks exist solely to show toast notifications from the parent level.
  const handleRemoveFriend = (friend: any, suppressNotification?: boolean) => {
    if (!suppressNotification) {
      setNotifications((prev: any) => [...prev, {
        id: `remove-friend-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: "Friend Removed",
        message: `${friend.name} has been removed from your friends list`,
        autoHide: true,
        duration: 3000,
      }]);
    }
  };

  const handleBlockUser = (friend: any, suppressNotification?: boolean) => {
    if (!suppressNotification) {
      setNotifications((prev: any) => [...prev, {
        id: `block-user-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: "User Blocked",
        message: `${friend.name} has been blocked and removed from your friends list`,
        autoHide: true,
        duration: 3000,
      }]);
    }
  };

  const handleUnblockUser = async (
    blockedUser: any,
    suppressNotification?: boolean
  ) => {
    if (typeof unblockFriend !== "function") return;
    await unblockFriend(blockedUser.id);
    if (!suppressNotification) {
      const notification = {
        id: `unblock-user-${Date.now()}-${blockedUser.id}`,
        type: "success" as const,
        title: "User Unblocked",
        message: `${blockedUser.name ?? "User"} has been unblocked`,
        autoHide: true,
        duration: 3000,
      };
      setNotifications((prev: any) => [...prev, notification]);
    }
  };

  const handleReportUser = (
    friend: any,
    suppressNotification?: boolean,
    reason?: string,
    details?: string
  ) => {
    if (!suppressNotification) {
      const reasonMessages: { [key: string]: string } = {
        spam: "for spam behavior",
        "inappropriate-content": "for inappropriate content",
        harassment: "for harassment",
        other: "for violating community guidelines",
      };

      const reasonText =
        reason && reasonMessages[reason] ? reasonMessages[reason] : "";

      const notification = {
        id: `report-user-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: "Report Submitted",
        message: `${friend.name} has been blocked and reported ${reasonText}. Our moderation team will review this report.`,
        autoHide: true,
        duration: 5000,
      };
      setNotifications((prev: any) => [...prev, notification]);
    }
  };

  const handleDismissNotification = (id: string) => {
    setNotifications((prev: any) =>
      prev.filter((notification: any) => notification.id !== id)
    );
  };

  const handleSavePreferences = async (preferences: any): Promise<boolean> => {
    // --- Immediate local state update (sync) ---
    setUserPreferences(preferences);

    if (!user?.id) {
      console.warn("[handleSavePreferences] No authenticated user");
      return false;
    }

    try {
      // --- Map & normalize (sync) ---
      const travelModeMap: Record<string, string> = {
        walk: "walking", drive: "driving", transit: "transit",
        walking: "walking", driving: "driving", biking: "biking",
      };
      const normalizedTravelMode =
        travelModeMap[preferences.travelMode] ||
        preferences.travelMode ||
        "walking";

      // Compute backward-compat budget from price tiers
      const userTiers: PriceTierSlug[] = preferences.priceTiers ?? ['chill', 'comfy', 'bougie', 'lavish'];
      const highestTier = PRICE_TIERS.slice().reverse().find(t => userTiers.includes(t.slug));
      const backCompatBudgetMax = highestTier?.max ?? 1000;

      const soloCats = normalizeCategoryArray(preferences.selectedCategories || []);
      const soloIntents = (preferences.selectedIntents || []).slice(0, 1);

      const dbPreferences: any = {
        mode: soloIntents.length > 0 ? "custom" : "explore",
        people_count: 1,
        price_tiers: userTiers,
        budget_min: 0,
        budget_max: backCompatBudgetMax,
        categories: soloCats,
        intents: soloIntents,
        travel_mode: normalizedTravelMode,
        travel_constraint_type: 'time' as const,
        travel_constraint_value:
          typeof preferences.constraintValue === "number"
            ? preferences.constraintValue
            : preferences.constraintValue !== ""
            ? Number(preferences.constraintValue)
            : 30,
        date_option: preferences.dateOption
          ? preferences.dateOption === "Now"
            ? "now"
            : preferences.dateOption === "Today"
            ? "today"
            : preferences.dateOption === "This Weekend"
            ? "weekend"
            : preferences.dateOption === "Pick a Date"
            ? "custom"
            : null
          : null,
        time_slot: preferences.selectedTimeSlot || null,
        exact_time: preferences.exactTime || null,
        datetime_pref: preferences.selectedDate
          ? new Date(preferences.selectedDate).toISOString()
          : null,
      };

      if (preferences.custom_location !== undefined) {
        dbPreferences.custom_location = preferences.custom_location;
      } else if (preferences.searchLocation) {
        dbPreferences.custom_location = preferences.searchLocation;
      }
      dbPreferences.use_gps_location = preferences.useGpsLocation ?? true;

      // === Optimistic cache update FIRST — deck uses this immediately ===
      queryClient.setQueryData(["userPreferences", user.id], {
        mode: dbPreferences.mode,
        price_tiers: dbPreferences.price_tiers,
        budget_min: dbPreferences.budget_min,
        budget_max: dbPreferences.budget_max,
        people_count: dbPreferences.people_count,
        categories: dbPreferences.categories,
        intents: dbPreferences.intents || [],
        travel_mode: dbPreferences.travel_mode,
        travel_constraint_type: dbPreferences.travel_constraint_type,
        travel_constraint_value: dbPreferences.travel_constraint_value,
        datetime_pref: dbPreferences.datetime_pref,
        date_option: dbPreferences.date_option,
        time_slot: dbPreferences.time_slot,
        exact_time: dbPreferences.exact_time,
        custom_location: dbPreferences.custom_location,
        use_gps_location: dbPreferences.use_gps_location,
      });

      // Deck history reset
      const newHashStr = computePrefsHash(dbPreferences);
      const { deckPrefsHash, resetDeckHistory } = useAppStore.getState();
      if (newHashStr !== deckPrefsHash) {
        resetDeckHistory(newHashStr);
      }

      // Preferences refresh key
      if (setPreferencesRefreshKey) {
        setPreferencesRefreshKey((prev: number) => prev + 1);
      }

      // In-app notification
      inAppNotificationService.notifyPreferencesUpdated("solo");

      // === DB write — fire and forget (local state is already correct) ===
      PreferencesService.updateUserPreferences(user.id, dbPreferences)
        .catch((e: any) => console.warn("[handleSavePreferences] Background DB write failed:", e));

      // Offline cache
      offlineService.cacheUserPreferences({
        profile_id: user.id,
        ...dbPreferences,
      } as any).catch((e: any) => console.warn('[AppHandlers] Offline preference cache failed:', e));

      return true;
    } catch (error) {
      console.error("[handleSavePreferences] Failed:", error);
      return false;
    }
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (enabled) {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  };

  const handleNavigateToActivity = (tab: "saved" | "boards" | "calendar") => {
    setCurrentPage("activity");
    setActivityNavigation({ activeTab: tab });
  };

  const handleNavigateToActivityBoard = (
    board: any,
    discussionTab: string = "discussion"
  ) => {
    setCurrentPage("activity");
    setActivityNavigation({
      selectedBoard: board,
      activeTab: "boards",
      discussionTab: discussionTab,
    });
  };

  const handleNavigateToConnections = () => {
    setCurrentPage("connections");
  };

  const handleShareCard = (experienceData: any) => {
    const dateTimePrefs = userPreferences
      ? {
          timeOfDay: userPreferences.timeOfDay || "Afternoon",
          dayOfWeek: userPreferences.dayOfWeek || "Weekend",
          planningTimeframe: userPreferences.planningTimeframe || "This month",
        }
      : {
          timeOfDay: "Afternoon",
          dayOfWeek: "Weekend",
          planningTimeframe: "This month",
        };

    setShareData({
      experienceData,
      dateTimePreferences: dateTimePrefs,
    });
    setShowShareModal(true);

    // Log in-app notification
    inAppNotificationService.notifyCardShared(
      experienceData?.title || "Experience",
      experienceData?.id
    );
  };

  // Helper function to generate suggested dates
  const generateSuggestedDates = (dateTimePrefs: any) => {
    const suggestions = [];
    const today = new Date();

    for (let i = 0; i < 3; i++) {
      const futureDate = new Date(today);

      if (dateTimePrefs.planningTimeframe === "This week") {
        futureDate.setDate(today.getDate() + (i + 1) * 2);
      } else if (dateTimePrefs.planningTimeframe === "This month") {
        futureDate.setDate(today.getDate() + (i + 1) * 7);
      } else {
        futureDate.setDate(today.getDate() + (i + 1) * 14);
      }

      if (dateTimePrefs.dayOfWeek === "Weekend") {
        const dayOfWeek = futureDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          futureDate.setDate(futureDate.getDate() + (6 - dayOfWeek));
        }
      }

      let hour = 14;
      if (dateTimePrefs.timeOfDay === "Morning") hour = 10;
      else if (dateTimePrefs.timeOfDay === "Evening") hour = 18;

      futureDate.setHours(hour, 0, 0, 0);
      suggestions.push(futureDate.toISOString());
    }

    return suggestions;
  };

  const handleSaveCard = async (card: any) => {
    if (!user?.id) {
      Alert.alert(
        "Sign in to save",
        "Create an account or sign in to save experiences."
      );
      return;
    }

    // CRITICAL FIX: Read currentMode and boardsSessions from stateRef.current to get the absolute latest values
    // stateRef is updated on every render, so stateRef.current always has the latest state
    // This ensures we always get the current mode, even if the handler was created earlier
    const latestState = stateRef.current;
    const latestCurrentMode = latestState?.currentMode ?? "solo";
    const latestBoardsSessions = latestState?.boardsSessions ?? [];

    // Check if we're in a session (not solo mode)
    const isInSession = latestCurrentMode !== "solo";

    const currentSession = isInSession
      ? latestBoardsSessions.find(
          (s: any) =>
            s.id === latestCurrentMode ||
            s.name === latestCurrentMode ||
            (s as any).session_id === latestCurrentMode
        )
      : null;

    // Get the actual session_id (could be session_id field or id field)
    const sessionId = currentSession
      ? (currentSession as any).session_id || currentSession.id
      : null;

    // If in a session, check if card is already saved in that session
    if (isInSession && currentSession && sessionId) {
      try {
        // Check if card already exists by querying card_data JSONB
        const { data: existingCards } = await supabase
          .from("board_saved_cards")
          .select("id, card_data")
          .eq("session_id", sessionId);

        // Check if any card has matching ID in card_data
        const existing = existingCards?.find(
          (savedCard: any) =>
            savedCard.card_data?.id === card.id ||
            savedCard.card_data?.experience_id === card.id
        );

        if (existing) {
          toastManager.show(
            `${card.title} is already saved in ${currentSession.name}`,
            "info",
            3000
          );
          return;
        }
      } catch (error) {
        // Card doesn't exist, continue with save
        console.error("Error checking existing card:", error);
      }
    } else {
      // In solo mode, check general saved cards in database
      try {
        const { data: existingCard, error: checkError } = await supabase
          .from("saved_card")
          .select("id")
          .eq("profile_id", user.id)
          .eq("experience_id", card.id)
          .maybeSingle();

        if (existingCard && !checkError) {
          // Card already exists
          if (Platform.OS === "android") {
            ToastAndroid.show(
              `${card.title} is already in your saved experiences`,
              ToastAndroid.SHORT
            );
          } else {
            Alert.alert(
              "Already saved",
              `${card.title} is already in your saved experiences.`
            );
          }
          return;
        }
      } catch (error) {
        // Error checking (continue with save)
        console.error("Error checking existing saved card:", error);
        // Continue with save even if check fails
      }
    }

    try {
      // If in a session, save to board_saved_cards
      if (isInSession && currentSession) {
        const experienceData = {
          id: card.id,
          title: card.title,
          category: card.category,
          categoryIcon: card.categoryIcon,
          image: card.image,
          images: card.images,
          rating: card.rating,
          reviewCount: card.reviewCount,
          travelTime: card.travelTime,
          priceRange: card.priceRange,
          priceTier: (card as any).priceTier,
          description: card.description,
          fullDescription: card.fullDescription,
          address: card.address,
          openingHours: card.openingHours,
          highlights: card.highlights,
          matchScore: card.matchScore,
          socialStats: card.socialStats,
          matchFactors: card.matchFactors,
          lat: card.lat,
          lng: card.lng,
          // Contact & location fields for Policies & Reservations
          website: (card as any).website || (card as any).websiteUri,
          websiteUri: (card as any).websiteUri || (card as any).website,
          phone: (card as any).phone,
          placeId: (card as any).placeId,
          googleMapsUri: (card as any).googleMapsUri,
          location: (card as any).location,
          distance: (card as any).distance,
          tags: (card as any).tags,
          // Special card type data
          strollData: (card as any).strollData,
          picnicData: (card as any).picnicData,
          // Preserve curated card fields if this is a curated experience
          ...((card as any).cardType === 'curated' ? {
            cardType: (card as any).cardType,
            stops: (card as any).stops,
            tagline: (card as any).tagline,
            totalPriceMin: (card as any).totalPriceMin,
            totalPriceMax: (card as any).totalPriceMax,
            estimatedDurationMinutes: (card as any).estimatedDurationMinutes,
            pairingKey: (card as any).pairingKey,
            experienceType: (card as any).experienceType,
            shoppingList: (card as any).shoppingList,
          } : {}),
        };

      
        const { data: savedCardData, error: boardError } = await BoardCardService.saveCardToBoard({
          sessionId: sessionId!,
          experienceId: card.id,
          experienceData,
          userId: user.id,
        });

        if (boardError) {
          throw boardError;
        }

        // Auto-vote "up" on swipe-right save (fire-and-forget)
        if (savedCardData?.id) {
          supabase
            .from("board_votes")
            .upsert(
              {
                session_id: sessionId!,
                saved_card_id: savedCardData.id,
                user_id: user.id,
                vote_type: "up",
              },
              { onConflict: "session_id,saved_card_id,user_id" }
            )
            .then(({ error: voteError }) => {
              if (voteError) {
                console.warn("Auto-vote failed (non-blocking):", voteError.message);
              }
            });
        }

        // Notify other participants that a card was saved (fire-and-forget)
        if (savedCardData?.id) {
          import('../services/boardNotificationService').then(({ notifyCardSaved }) => {
            notifyCardSaved({
              sessionId: sessionId!,
              sessionName: currentSession.name || 'Session',
              userId: user.id,
              userName: profile?.display_name || profile?.first_name || 'Someone',
              savedCardId: savedCardData.id,
              cardName: card.title,
            });
          }).catch((e: any) => console.warn('[AppHandlers] Board notification failed:', e));
        }

        // Invalidate savedCards query to trigger a refetch
        queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });

        // Show toast notification matching UI: "Added to Board! [Card Name] has been added to [Session Name]"
        toastManager.show(
          `Added to Board! ${card.title} has been added to ${currentSession.name}`,
          "success",
          4000
        );

        // Log in-app notification
        inAppNotificationService.notifyCardSaved(card.title, card.id);
      } else {
        // Solo mode: save to general saved_experiences
        // IMPORTANT: Pass explicit source="solo" to ensure we use the current mode
        // Don't rely on card.source which might be stale from when card was created
        await savedCardsService.saveCard(user.id, card, "solo");

        // Notify paired users about the save (fire-and-forget)
        supabase
          .from('pairings')
          .select('user_a_id, user_b_id')
          .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
          .then(({ data: pairings }) => {
            if (!pairings || pairings.length === 0) return;
            for (const pairing of pairings) {
              const partnerId = pairing.user_a_id === user.id
                ? pairing.user_b_id
                : pairing.user_a_id;
              const uA = user.id < partnerId ? user.id : partnerId;
              const uB = user.id < partnerId ? partnerId : user.id;
              supabase.functions.invoke('notify-pair-activity', {
                body: {
                  type: 'paired_user_saved_card',
                  pairId: `${uA}:${uB}`,
                  actorId: user.id,
                  recipientId: partnerId,
                  cardId: card.id,
                  cardName: card.title,
                },
              }).catch((e: any) => console.warn('[AppHandlers] Pair activity notification failed:', e));
            }
          });

        // Invalidate savedCards query to trigger a refetch
        queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });

        // Show toast notification
        toastManager.show(
          `❤️ Saved! ${card.title} has been added to your saved experiences`,
          "success",
          3000
        );

        // Log in-app notification
        inAppNotificationService.notifyCardSaved(card.title, card.id);
      }
    } catch (error) {
      console.error("Error saving card:", error);
      Alert.alert(
        "Save failed",
        "We couldn't save this experience. Please try again."
      );
    }
  };

  const handleScheduleFromSaved = async (card: any) => {
    // Generate a suggested date based on user preferences
    const suggestedDates = generateSuggestedDates(userPreferences || {});
    const suggestedDate = suggestedDates[0];
    const date = new Date(suggestedDate);

    // TEMP: Log the exact datetime used for scheduling (for device calendar debugging)
    console.log(
      "[ScheduleFromSaved] Using datetime for calendar:",
      suggestedDate,
      "->",
      date.toISOString()
    );

    // Format date and time for display
    const dateStr = date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Persist calendar entry in Supabase so it is available across devices
    try {
      const { CalendarService } = await import("../services/calendarService");

      // Avoid duplicates (check current in-memory entries first)
      const exists = calendarEntries.some(
        (entry: any) =>
          (entry.experience?.id === card.id ||
            entry.card_data?.id === card.id) &&
          entry.status === "pending"
      );
      if (exists) {
        return;
      }

      const record = await CalendarService.addEntryFromSavedCard(
        user.id,
        card,
        suggestedDate
      );

      // Add to device calendar
      try {
        const { DeviceCalendarService } = await import(
          "../services/deviceCalendarService"
        );
        const deviceEvent = DeviceCalendarService.createEventFromCard(
          card,
          date,
          record.duration_minutes || 120 // Use duration from record if available, default 2 hours
        );
        const deviceEventId =
          await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);

        // Store device event ID in the calendar entry for future reference
        // (We could update the Supabase record with this ID if needed)
        if (deviceEventId) {
          // Optionally update the record with device_event_id
          // For now, we'll just log it
        }
      } catch (deviceCalendarError) {
        // Don't fail the whole operation if device calendar fails
        // The Supabase entry is already saved, which is the source of truth
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Normalize record into the shape used by CalendarTab
      const cardData = record.card_data || {};
      const calendarEntry = {
        id: record.id,
        card_id: record.card_id, // Include card_id for matching
        board_card_id: record.board_card_id,
        title: cardData.title || card.title || "Saved Experience",
        category: cardData.category || card.category || "Experience",
        categoryIcon: cardData.categoryIcon || card.categoryIcon || "star",
        image:
          cardData.image ||
          card.image ||
          (Array.isArray(cardData.images)
            ? cardData.images[0]
            : card.images?.[0] || ""),
        images:
          cardData.images || card.images || (card.image ? [card.image] : []),
        rating: cardData.rating || card.rating || 0,
        reviewCount: cardData.reviewCount || card.reviewCount || 0,
        date: dateStr,
        time: timeStr,
        source: (record.source as "solo" | "collaboration") || "solo",
        sourceDetails: card.sessionName
          ? `From ${card.sessionName}`
          : "Solo Experience",
        priceRange: cardData.priceRange || card.priceRange || "TBD",
        description: cardData.description || card.description || "",
        fullDescription:
          cardData.fullDescription ||
          card.fullDescription ||
          card.description ||
          "",
        address: cardData.address || card.address || "",
        highlights: cardData.highlights || card.highlights || [],
        socialStats: cardData.socialStats ||
          card.socialStats || {
            views: 0,
            likes: 0,
            saves: 0,
          },
        status: record.status,
        experience: {
          ...cardData,
          ...card,
          id: card.id,
        },
        suggestedDates: [record.scheduled_at],
        sessionName: card.sessionName,
        archived_at: record.archived_at,
        dateTimePreferences: userPreferences
          ? {
              timeOfDay: userPreferences.timeOfDay || "Afternoon",
              dayOfWeek: userPreferences.dayOfWeek || "Weekend",
              planningTimeframe:
                userPreferences.planningTimeframe || "This month",
            }
          : undefined,
      };

      // Add to calendar entries - check for duplicates using card_id
      setCalendarEntries((prev: any[]) => {
        // Check if already exists (prevent duplicates)
        const exists = prev.some(
          (entry: any) =>
            (entry.card_id === card.id || entry.experience?.id === card.id) &&
            entry.status === "pending" &&
            !entry.archived_at
        );
        if (exists) {
          return prev;
        }
        return [calendarEntry, ...prev];
      });

      // Show confirmation toast matching the design (orange banner at top)
      toastManager.success(
        `Scheduled! ${card.title} has been moved to your calendar`,
        3000
      );
    } catch (error) {
      console.error("Error scheduling from saved:", error);
      Alert.alert(
        "Schedule failed",
        "We couldn't add this to your calendar. Please try again."
      );
    }
  };

  const handleRemoveFromCalendar = async (entry: any) => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to remove calendar entries.");
      return;
    }

    // Don't allow removal of purchased entries (they should be locked in)
    if (entry.purchaseOption || entry.isPurchased) {
      Alert.alert(
        "Cannot Remove",
        "This experience has been purchased and cannot be removed from your calendar."
      );
      return;
    }

    // --- Snapshot cache for rollback ---
    const calendarCacheKey = ["calendarEntries", user.id];
    const savedCacheKey = savedCardKeys.list(user.id);
    const prevCalendar = queryClient.getQueryData(calendarCacheKey);
    const prevSaved = queryClient.getQueryData(savedCacheKey);

    const cardData = entry.experience || entry.card_data || entry;
    const source = entry.source || "solo";

    // --- Optimistic cache updates (immediate) ---
    queryClient.setQueryData(calendarCacheKey, (old: any[] | undefined) =>
      (old ?? []).filter((e: any) => e.id !== entry.id)
    );
    setCalendarEntries((prev: any[]) =>
      prev.filter((e: any) => e.id !== entry.id)
    );

    // Show success toast immediately
    toastManager.success(
      `${entry.title || "Experience"} moved back to Saved`,
      3000
    );

    // --- Background mutations (parallel) ---
    try {
      const { CalendarService } = await import("../services/calendarService");
      const { DeviceCalendarService } = await import(
        "../services/deviceCalendarService"
      );
      const { savedCardsService } = await import("../services/savedCardsService");

      const scheduledDate = entry.suggestedDates?.[0]
        ? new Date(entry.suggestedDates[0])
        : entry.date && entry.time
        ? new Date(`${entry.date}T${entry.time}`)
        : null;

      const results = await Promise.allSettled([
        // Critical: delete from Supabase calendar
        CalendarService.deleteEntry(entry.id, user.id),
        // Best-effort: re-save card
        savedCardsService.saveCard(user.id, cardData, source).catch((err: any) => {
          if (err?.code !== "23505") console.warn("Failed to re-save card:", err);
        }),
        // Best-effort: remove from device calendar
        scheduledDate && cardData.title
          ? DeviceCalendarService.removeEventByTitleAndDate(cardData.title, scheduledDate).catch(
              (err: any) => console.warn("Failed to remove from device calendar:", err)
            )
          : Promise.resolve(),
      ]);

      // Check critical failure (deleteEntry is index 0)
      if (results[0].status === "rejected") {
        throw results[0].reason;
      }

      // Invalidate queries after completion
      queryClient.invalidateQueries({ queryKey: calendarCacheKey });
      queryClient.invalidateQueries({ queryKey: savedCacheKey });
    } catch (error: any) {
      // --- Rollback on critical failure ---
      console.error("Error removing from calendar:", error);
      queryClient.setQueryData(calendarCacheKey, prevCalendar);
      queryClient.setQueryData(savedCacheKey, prevSaved);
      // Re-sync local state from cache
      if (prevCalendar) {
        setCalendarEntries(prevCalendar as any[]);
      }
      Alert.alert(
        "Remove Failed",
        error.message ||
          "We couldn't remove this from your calendar. Please try again."
      );
    }
  };

  return {
    handleModeChange,
    handleCollabPreferencesOpen,
    handleCollabPreferencesSave,
    handleSendInvite,
    handlePromoteToAdmin,
    handleDemoteFromAdmin,
    handleRemoveMember,
    handleLeaveBoard,
    handleAddToBoard,
    handleShareSavedCard,
    handleRemoveFriend,
    handleBlockUser,
    handleUnblockUser,
    handleReportUser,
    handleDismissNotification,
    handleSavePreferences,
    handleNotificationsToggle,
    handleNavigateToActivity,
    handleNavigateToActivityBoard,
    handleNavigateToConnections,
    handleShareCard,
    handleSaveCard,
    handleScheduleFromSaved,
    handleRemoveFromCalendar,
    generateSuggestedDates,
  };
}
