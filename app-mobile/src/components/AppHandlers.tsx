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
import { getDisplayName } from "../utils/getDisplayName";
import { TIER_BY_SLUG, PRICE_TIERS, PriceTierSlug } from '../constants/priceTiers';
import { normalizeCategoryArray } from '../utils/categoryUtils';
import i18n from '../i18n';

export function useAppHandlers(state: any) {
  const queryClient = useQueryClient();

  // Use a ref to always have access to the latest state object
  // This ensures handleSaveCard always reads the latest currentMode
  const stateRef = useRef(state);
  stateRef.current = state; // Update ref on every render

  const {
    setCurrentMode,
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

  const handleSendInvite = (sessionId: string, users: any[]) => {
    users.forEach((user) => {
      const notification = {
        id: `invite-${Date.now()}-${user.id}`,
        type: "success" as const,
        title: i18n.t('common:toast_invite_sent'),
        message: i18n.t('common:toast_invite_sent_msg', { name: user.name }),
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
          title: i18n.t('common:toast_member_promoted'),
          message: i18n.t('common:toast_member_promoted_msg', { name: participant?.name }),
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
          title: i18n.t('common:toast_admin_removed'),
          message: i18n.t('common:toast_admin_removed_msg', { name: participant?.name }),
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
        ? i18n.t('common:toast_member_removed')
        : i18n.t('common:toast_board_deleted'),
      message: updatedBoards.find((b: any) => b.id === boardId)
        ? i18n.t('common:toast_member_removed_msg', { name: participant?.name })
        : i18n.t('common:toast_board_deleted_insufficient', { name: board.name }),
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
                title: i18n.t('common:toast_new_admin'),
                message: i18n.t('common:toast_new_admin_msg', { name: newAdmin.name, board: board.name }),
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
        ? i18n.t('common:toast_left_board')
        : i18n.t('common:toast_board_deleted'),
      message: updatedBoards.find((b: any) => b.id === boardId)
        ? i18n.t('common:toast_left_board_msg', { name: board.name })
        : i18n.t('common:toast_board_deleted_insufficient', { name: board.name }),
      autoHide: true,
      duration: 4000,
    };
    setNotifications((prev: any) => [...prev, notification]);

    updateBoardsSessions(updatedBoards);

    if (!updatedBoards.find((b: any) => b.id === boardId)) {
      setCurrentPage("likes");
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
            ? i18n.t('common:toast_added_to_board')
            : i18n.t('common:toast_added_to_boards', { count: sessionIds.length }),
        message:
          sessionIds.length === 1
            ? i18n.t('common:toast_added_board_msg', { name: friend.name })
            : i18n.t('common:toast_added_boards_msg', { name: friend.name, count: sessionIds.length }),
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
        title: i18n.t('common:toast_card_shared'),
        message: i18n.t('common:toast_card_shared_msg', { name: friend.name }),
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
        title: i18n.t('common:toast_friend_removed'),
        message: i18n.t('common:toast_friend_removed_msg', { name: friend.name }),
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
        title: i18n.t('common:toast_user_blocked'),
        message: i18n.t('common:toast_user_blocked_msg', { name: friend.name }),
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
        title: i18n.t('common:toast_user_unblocked'),
        message: i18n.t('common:toast_user_unblocked_msg', { name: blockedUser.name ?? i18n.t('common:user_fallback') }),
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
        spam: i18n.t('common:toast_report_reason_spam'),
        "inappropriate-content": i18n.t('common:toast_report_reason_inappropriate'),
        harassment: i18n.t('common:toast_report_reason_harassment'),
        other: i18n.t('common:toast_report_reason_other'),
      };

      const reasonText =
        reason && reasonMessages[reason] ? reasonMessages[reason] : "";

      const notification = {
        id: `report-user-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: i18n.t('common:toast_report_submitted'),
        message: i18n.t('common:toast_report_submitted_msg', { name: friend.name, reason: reasonText }),
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
      const backCompatBudgetMax = userTiers.includes('any' as PriceTierSlug)
        ? 10000
        : (PRICE_TIERS.slice().reverse().find(t => userTiers.includes(t.slug))?.max ?? 1000);

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
      dbPreferences.custom_lat = preferences.custom_lat ?? null;
      dbPreferences.custom_lng = preferences.custom_lng ?? null;

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
        custom_location: dbPreferences.custom_location,
        custom_lat: dbPreferences.custom_lat,
        custom_lng: dbPreferences.custom_lng,
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

  const handleNotificationsToggle = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    try {
      await AsyncStorage.setItem(
        "mingla_notifications_enabled",
        JSON.stringify(enabled)
      );
    } catch (e) {
      console.warn("[handleNotificationsToggle] Failed to persist:", e);
    }
    if (enabled) {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  };

  const handleNavigateToActivity = (tab: "saved" | "boards" | "calendar") => {
    setCurrentPage("likes");
    setActivityNavigation({ activeTab: tab });
  };

  const handleNavigateToActivityBoard = (
    board: any,
    discussionTab: string = "discussion"
  ) => {
    setCurrentPage("likes");
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

  const handleSaveCard = async (card: any): Promise<boolean> => {
    if (!user?.id) {
      Alert.alert(
        "Sign in to save",
        "Create an account or sign in to save experiences."
      );
      return false;
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
          return true;
        }
      } catch (error) {
        // Card doesn't exist, continue with save
        console.error("Error checking existing card:", error);
      }
    } else {
      // In solo mode, check general saved cards in database
      // Skip duplicate check for curated cards — they can be modified (stop replacements)
      // and the upsert on onConflict will correctly overwrite with the updated version
      const isCuratedCard = (card as any).cardType === 'curated';
      if (!isCuratedCard) {
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
            return true;
          }
        } catch (error) {
          // Error checking (continue with save)
          console.error("Error checking existing saved card:", error);
          // Continue with save even if check fails
        }
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
              userName: getDisplayName(user),
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
      return true;
    } catch (error) {
      console.error("Error saving card:", error);
      Alert.alert(
        "Save failed",
        "We couldn't save this experience. Please try again."
      );
      return false;
    }
  };

  // handleScheduleFromSaved removed — SavedTab uses its own date picker flow

  const handleRemoveFromCalendar = async (entry: any) => {
    if (!user?.id) {
      Alert.alert(i18n.t('common:error'), i18n.t('common:error_login_required'));
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

      const scheduledDate = entry.scheduled_at
        ? new Date(entry.scheduled_at)
        : entry.suggestedDates?.[0]
        ? new Date(entry.suggestedDates[0])
        : null;

      // Best-effort: remove from device calendar
      const removeFromDeviceCalendar = async () => {
        if (entry.device_calendar_event_id) {
          await DeviceCalendarService.removeEventFromDeviceCalendar(entry.device_calendar_event_id);
        } else if (scheduledDate && cardData.title) {
          await DeviceCalendarService.removeEventByTitleAndDate(cardData.title, scheduledDate);
          if (cardData.stops?.length > 0) {
            const stopNames = cardData.stops.map((s: any) => s.placeName || s.title).join(' → ');
            await DeviceCalendarService.removeEventByTitleAndDate(`Mingla Plan: ${stopNames}`, scheduledDate);
          }
        }
      };

      const results = await Promise.allSettled([
        // Critical: delete from Supabase calendar
        CalendarService.deleteEntry(entry.id, user.id),
        // Best-effort: re-save card
        savedCardsService.saveCard(user.id, cardData, source).catch((err: any) => {
          if (err?.code !== "23505") console.warn("Failed to re-save card:", err);
        }),
        // Best-effort: remove from device calendar
        removeFromDeviceCalendar().catch(
          (err: any) => console.warn("Failed to remove from device calendar:", err)
        ),
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
    handleRemoveFromCalendar,
    generateSuggestedDates,
  };
}
