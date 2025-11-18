import { formatCurrency } from "./utils/formatters";
import { PreferencesService } from "../services/preferencesService";

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

  const handleCollaborationOpen = (friend?: any) => {
    setPreSelectedFriend(friend || null);
    setShowCollaboration(true);
  };

  const handleModeChange = (mode: "solo" | string) => {
    setCurrentMode(mode);
    console.log("Mode changed to:", mode);
  };

  const handleCollabPreferencesOpen = (sessionData: any) => {
    setActiveSessionData(sessionData);
    setShowCollabPreferences(true);
  };

  const handleCollabPreferencesSave = (preferences: any) => {
    if (state.activeSessionData) {
      setCollaborationPreferences((prev: any) => ({
        ...prev,
        [state.activeSessionData.id]: preferences,
      }));
      console.log(
        "Collaboration preferences saved for session:",
        state.activeSessionData.id,
        preferences
      );
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

    console.log("Invites sent for session:", sessionId, "to users:", users);
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
    console.log(
      "Promoted member to admin:",
      participantId,
      "on board:",
      boardId
    );
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
    console.log("Demoted admin:", participantId, "on board:", boardId);
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
    console.log("Removed member:", participantId, "from board:", boardId);
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

    console.log("Left board:", boardId);
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

    console.log(
      "Friend added to boards:",
      friend.name,
      "Sessions:",
      sessionIds
    );
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
    console.log("Shared saved card with:", friend.name);
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
    console.log("Removed friend:", friend.name);
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
    console.log("Blocked user:", friend.name);
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
    console.log("Unblocked user:", blockedUser.name);
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

    console.log(
      "Reported user:",
      friend.name,
      "Reason:",
      reason,
      "Details:",
      details
    );
  };

  const handleDismissNotification = (id: string) => {
    setNotifications((prev: any) =>
      prev.filter((notification: any) => notification.id !== id)
    );
  };

  const handleSavePreferences = async (preferences: any): Promise<boolean> => {
    console.log("🔄 handleSavePreferences called");
    console.log(
      "📋 Received preferences:",
      JSON.stringify(preferences, null, 2)
    );
    console.log("👤 User ID:", user?.id);
    console.log("🔐 User authenticated:", !!user?.id);

    // Update local state immediately for UI responsiveness
    setUserPreferences(preferences);
    console.log("✅ User preferences saved to local state");

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

      // Add custom_location if searchLocation is provided
      if (preferences.useLocation === "search" && preferences.searchLocation) {
        dbPreferences.custom_location = preferences.searchLocation;
      }

      console.log("💾 Preparing to save preferences to database");
      console.log(
        "📤 Database preferences payload:",
        JSON.stringify(dbPreferences, null, 2)
      );
      console.log("👤 User ID for save:", user.id);

      try {
        const success = await PreferencesService.updateUserPreferences(
          user.id,
          dbPreferences
        );

        if (success) {
          console.log("✅ Preferences successfully saved to database");
          console.log("✅ User ID:", user.id);
          console.log(
            "✅ Saved preferences:",
            JSON.stringify(dbPreferences, null, 2)
          );

          // Trigger refresh of experiences by updating refresh key
          if (setPreferencesRefreshKey) {
            setPreferencesRefreshKey((prev: number) => prev + 1);
            console.log("🔄 Triggered experience refresh");
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
        Notification.requestPermission().then((permission) => {
          console.log("Notification permission:", permission);
        });
      }
    }
    console.log("Notifications toggled:", enabled);
  };

  const handleNavigateToActivity = (tab: "saved" | "boards" | "calendar") => {
    setCurrentPage("activity");
    setActivityNavigation({ activeTab: tab });
    console.log("Navigating to Activity page, tab:", tab);
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
    console.log(
      "Navigating to Activity page, board:",
      board.name,
      "discussion tab:",
      discussionTab
    );
  };

  const handleNavigateToConnections = () => {
    setCurrentPage("connections");
    console.log("Navigating to Connections page");
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

    console.log(
      "Sharing card:",
      experienceData.title,
      "with prefs:",
      dateTimePrefs
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
    generateSuggestedDates,
  };
}
