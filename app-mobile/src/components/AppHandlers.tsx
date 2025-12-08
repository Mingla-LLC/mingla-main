import { Alert, Platform, ToastAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatCurrency } from "./utils/formatters";
import { PreferencesService } from "../services/preferencesService";
import { savedCardsService } from "../services/savedCardsService";
import { supabase } from "../services/supabase";

export function useAppHandlers(state: any) {
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

  const persistSavedCards = async (cards: any[]) => {
    try {
      await AsyncStorage.setItem(
        "mingla_saved_cards",
        JSON.stringify(cards || [])
      );
    } catch (error) {
      console.error("Error persisting saved cards:", error);
    }
  };

  const handleCollaborationOpen = (friend?: any) => {
    setPreSelectedFriend(friend || null);
    setShowCollaboration(true);
  };

  const handleModeChange = (mode: "solo" | string) => {
    setCurrentMode(mode);
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
      const dbPreferences = {
        categories: preferences.selectedCategories || [],
        budget_min: typeof preferences.budgetMin === "number" ? preferences.budgetMin : 0,
        budget_max: typeof preferences.budgetMax === "number" ? preferences.budgetMax : 1000,
        travel_mode: preferences.travelMode || "walking",
        travel_constraint_type: preferences.constraintType || "time",
        travel_constraint_value: typeof preferences.constraintValue === "number" ? preferences.constraintValue : 20,
        time_of_day: preferences.selectedTimeSlot || null,
        datetime_pref: preferences.selectedDate || null,
      };

      // Save to database
      const { error } = await supabase
        .from("board_session_preferences")
        .upsert({
          session_id: sessionId,
          ...dbPreferences,
        }, {
          onConflict: "session_id",
        });

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

    if (savedCards?.some((item: any) => item.id === card.id)) {
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

    try {
      await savedCardsService.saveCard(user.id, card);
      const savedEntry = {
        ...card,
        dateAdded: new Date().toISOString(),
        source: card.source || "solo",
      };

      setSavedCards((prev: any[]) => {
        if (prev.some((item) => item.id === savedEntry.id)) {
          return prev;
        }
        const updated = [savedEntry, ...prev];
        persistSavedCards(updated);
        setProfileStats((stats: any) => ({
          ...stats,
          savedExperiences: updated.length,
        }));
        return updated;
      });

      const message = `❤️ Saved! ${card.title} has been added to your saved experiences`;
      if (Platform.OS === "android") {
        ToastAndroid.show(message, ToastAndroid.SHORT);
      } else {
        Alert.alert("❤️ Saved!", `${card.title} has been added to your saved experiences`);
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
    } catch (error) {
      console.error("Error removing saved card:", error);
    }

    setSavedCards((prev: any[]) => {
      const updated = prev.filter((item) => item.id !== card.id);
      persistSavedCards(updated);
      setProfileStats((stats: any) => ({
        ...stats,
        savedExperiences: updated.length,
      }));
      return updated;
    });
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
    generateSuggestedDates,
  };
}
