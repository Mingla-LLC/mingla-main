import { Alert, Platform, ToastAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "./utils/formatters";
import { PreferencesService } from "../services/preferencesService";
import { savedCardsService } from "../services/savedCardsService";
import { BoardCardService } from "../services/boardCardService";
import { toastManager } from "../components/ui/Toast";
import { supabase } from "../services/supabase";
import { offlineService } from "../services/offlineService";

export function useAppHandlers(state: any) {
  const queryClient = useQueryClient();

  const {
    currentMode,
    setCurrentMode,
    setActiveSessionData,
    setShowCollabPreferences,
    setPreSelectedFriend,
    setShowCollaboration,
    setNotifications,
    boardsSessions,
    updateBoardsSessions,
    friendsList,
    setFriendsList,
    profileStats,
    setProfileStats,
    blockedUsers,
    setBlockedUsers,
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
    safeLocalStorageSet,
    user,
    setPreferencesRefreshKey,
  } = state;

  const handleCollaborationOpen = (friend?: any) => {
    setPreSelectedFriend(friend || null);
    setShowCollaboration(true);
  };

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
            const result = await SessionService.switchToSession(
              user.id,
              sessionId
            );

            if (result.success) {
              // Pass sessionId to setCurrentMode for proper tracking
              setCurrentMode(mode, sessionId);
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

    if (sessionId) {
      // Transform preferences to database format
      const dbPreferences: any = {
        categories: preferences.selectedCategories || [],
        budget_min:
          typeof preferences.budgetMin === "number" ? preferences.budgetMin : 0,
        budget_max:
          typeof preferences.budgetMax === "number"
            ? preferences.budgetMax
            : 1000,
        travel_mode: preferences.travelMode || "walking",
        travel_constraint_type: preferences.constraintType || "time",
        travel_constraint_value:
          typeof preferences.constraintValue === "number"
            ? preferences.constraintValue
            : 20,
        time_of_day: preferences.selectedTimeSlot || null,
        datetime_pref: preferences.selectedDate || null,
      };

      // Add location if searchLocation is provided (for both GPS and search)
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

    // Also update local state for backward compatibility
    if (state.activeSessionData) {
      setCollaborationPreferences((prev: any) => ({
        ...prev,
        [state.activeSessionData.id]: preferences,
      }));
    }

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

  const handleRemoveFriend = (friend: any, suppressNotification?: boolean) => {
    const updatedFriends = friendsList.filter((f: any) => f.id !== friend.id);
    setFriendsList(updatedFriends);

    safeLocalStorageSet("mingla_friends_list", updatedFriends);

    setProfileStats((prev: any) => ({
      ...prev,
      connectionsCount: prev.connectionsCount - 1,
    }));

    if (!suppressNotification) {
      const notification = {
        id: `remove-friend-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: "Friend Removed",
        message: `${friend.name} has been removed from your friends list`,
        autoHide: true,
        duration: 3000,
      };
      setNotifications((prev: any) => [...prev, notification]);
    }
  };

  const handleBlockUser = (friend: any, suppressNotification?: boolean) => {
    const updatedFriends = friendsList.filter((f: any) => f.id !== friend.id);
    setFriendsList(updatedFriends);

    const blockedUser = {
      ...friend,
      blockedAt: new Date().toISOString(),
    };
    const updatedBlockedUsers = [...blockedUsers, blockedUser];
    setBlockedUsers(updatedBlockedUsers);

    safeLocalStorageSet("mingla_friends_list", updatedFriends);
    safeLocalStorageSet("mingla_blocked_users", updatedBlockedUsers);

    setProfileStats((prev: any) => ({
      ...prev,
      connectionsCount: prev.connectionsCount - 1,
    }));

    if (!suppressNotification) {
      const notification = {
        id: `block-user-${Date.now()}-${friend.id}`,
        type: "success" as const,
        title: "User Blocked",
        message: `${friend.name} has been blocked and removed from your friends list`,
        autoHide: true,
        duration: 3000,
      };
      setNotifications((prev: any) => [...prev, notification]);
    }
  };

  const handleUnblockUser = (
    blockedUser: any,
    suppressNotification?: boolean
  ) => {
    const updatedBlockedUsers = blockedUsers.filter(
      (u: any) => u.id !== blockedUser.id
    );
    setBlockedUsers(updatedBlockedUsers);

    safeLocalStorageSet("mingla_blocked_users", updatedBlockedUsers);

    if (!suppressNotification) {
      const notification = {
        id: `unblock-user-${Date.now()}-${blockedUser.id}`,
        type: "success" as const,
        title: "User Unblocked",
        message: `${blockedUser.name} has been unblocked`,
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
    // Update local state immediately for UI responsiveness
    setUserPreferences(preferences);

    // Save to database if user is authenticated
    if (!user?.id) {
      console.warn(
        "⚠️ Cannot save preferences to database: User not authenticated"
      );
      console.warn("⚠️ User object:", user);
      return false;
    }

    try {
      // Map travel mode to database-compatible values
      const travelModeMap: { [key: string]: string } = {
        walk: "walking",
        drive: "driving",
        transit: "transit",
        walking: "walking",
        driving: "driving",
        biking: "biking",
      };
      const normalizedTravelMode =
        travelModeMap[preferences.travelMode] ||
        preferences.travelMode ||
        "walking";

      // Convert PreferencesSheet format to database format
      const dbPreferences: any = {
        mode: preferences.selectedIntents?.length > 0 ? "custom" : "explore",
        budget_min:
          typeof preferences.budgetMin === "number"
            ? preferences.budgetMin
            : preferences.budgetMin !== ""
            ? Number(preferences.budgetMin)
            : 0,
        budget_max:
          typeof preferences.budgetMax === "number"
            ? preferences.budgetMax
            : preferences.budgetMax !== ""
            ? Number(preferences.budgetMax)
            : 1000,
        categories: (() => {
          // Combine selected intents (as IDs) and selected categories (as names)
          const intentIds = preferences.selectedIntents || [];
          const categoryNames = preferences.selectedCategories || [];
          return [...intentIds, ...categoryNames];
        })(),
        travel_mode: normalizedTravelMode,
        travel_constraint_type: preferences.constraintType || "time",
        travel_constraint_value:
          typeof preferences.constraintValue === "number"
            ? preferences.constraintValue
            : preferences.constraintValue !== ""
            ? Number(preferences.constraintValue)
            : preferences.constraintType === "time"
            ? 30
            : 5,
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
          : new Date().toISOString(),
      };

      // Note: time_slot expects predefined values ("brunch", "afternoon", "dinner", "lateNight")
      // If exactTime is provided, we could map it to a time_slot, but for now we'll skip it
      // since PreferencesSheet allows custom times that don't map to predefined slots

      // Add custom_location if searchLocation is provided (for both search and GPS)
      // When useLocation is "gps", searchLocation contains the city name or coordinates
      if (preferences.searchLocation) {
        dbPreferences.custom_location = preferences.searchLocation;
      }

      try {
        const success = await PreferencesService.updateUserPreferences(
          user.id,
          dbPreferences
        );

        if (success) {
          // Update offline cache with new preferences so useUserLocation gets fresh data
          try {
            const updatedPrefs = await PreferencesService.getUserPreferences(
              user.id
            );
            if (updatedPrefs) {
              await offlineService.cacheUserPreferences(updatedPrefs);
            }
          } catch (cacheError) {
            console.error("Error updating offline cache:", cacheError);
          }

          // Trigger refresh of experiences by updating refresh key
          if (setPreferencesRefreshKey) {
            setPreferencesRefreshKey((prev: number) => prev + 1);
          } else {
            console.warn("⚠️ setPreferencesRefreshKey is not available");
          }

          return true;
        } else {
          return false;
        }
      } catch (saveError) {
        return false;
      }
    } catch (error) {
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
    setShowCollaboration(false);
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

    // Check if we're in a session (not solo mode)
    const isInSession = currentMode !== "solo";
    const currentSession = isInSession
      ? boardsSessions.find(
          (s: any) =>
            s.id === currentMode ||
            s.name === currentMode ||
            (s as any).session_id === currentMode
        )
      : null;

    // Get the actual session_id (could be session_id field or id field)
    const sessionId = currentSession
      ? (currentSession as any).session_id || currentSession.id
      : null;

    // Debug: Log session info
    if (isInSession && currentSession) {
      console.log("💾 Saving card to board session:", {
        currentMode,
        boardId: currentSession.id,
        sessionId: sessionId,
        boardName: currentSession.name,
        hasSessionId: !!(currentSession as any).session_id,
      });
    }

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
          description: card.description,
          fullDescription: card.fullDescription,
          address: card.address,
          highlights: card.highlights,
          matchScore: card.matchScore,
          socialStats: card.socialStats,
          matchFactors: card.matchFactors,
        };

        const { error: boardError } = await BoardCardService.saveCardToBoard({
          sessionId: sessionId!,
          experienceId: card.id,
          experienceData,
          userId: user.id,
        });

        if (boardError) {
          throw boardError;
        }

        // Invalidate savedCards query to trigger a refetch
        queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });

        // Show toast notification matching UI: "Added to Board! [Card Name] has been added to [Session Name]"
        toastManager.show(
          `Added to Board! ${card.title} has been added to ${currentSession.name}`,
          "success",
          4000
        );
      } else {
        // Solo mode: save to general saved_experiences
        await savedCardsService.saveCard(user.id, card);

        // Invalidate savedCards query to trigger a refetch
        queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });

        // Show toast notification
        toastManager.show(
          `❤️ Saved! ${card.title} has been added to your saved experiences`,
          "success",
          3000
        );
      }
    } catch (error) {
      console.error("Error saving card:", error);
      Alert.alert(
        "Save failed",
        "We couldn't save this experience. Please try again."
      );
    }
  };

  const handleRemoveSavedCard = async (card: any) => {
    if (!user?.id) return;

    try {
      await savedCardsService.removeCard(user.id, card.id);

      // Invalidate savedCards query to trigger a refetch
      queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });
    } catch (error) {
      console.error("Error removing saved card:", error);
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

    try {
      const { CalendarService } = await import("../services/calendarService");

      // Delete from Supabase
      await CalendarService.deleteEntry(entry.id, user.id);

      // Remove from local state
      setCalendarEntries((prev: any[]) =>
        prev.filter((e: any) => e.id !== entry.id)
      );

      // Invalidate calendar entries query to refresh React Query cache
      // This ensures components using useCalendarEntries hook get updated data
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // Show success message
      toastManager.success(
        `${entry.title || "Experience"} removed from calendar`,
        3000
      );
    } catch (error: any) {
      console.error("Error removing from calendar:", error);
      Alert.alert(
        "Remove Failed",
        error.message ||
          "We couldn't remove this from your calendar. Please try again."
      );
    }
  };

  return {
    handleCollaborationOpen,
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
    handleRemoveSavedCard,
    handleScheduleFromSaved,
    handleRemoveFromCalendar,
    generateSuggestedDates,
  };
}
