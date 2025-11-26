import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useAppStore } from "../store/appStore";
import { savedCardsService } from "../services/savedCardsService";

// Default data constants moved to separate module to prevent re-creation
const DEFAULT_FRIENDS = [
  {
    id: "1",
    name: "Arifat Ola-dauda",
    username: "Ari99",
    status: "online",
    isOnline: true,
    mutualFriends: 12,
  },
  {
    id: "2",
    name: "Sethozia Testing",
    username: "Sethozia",
    status: "away",
    isOnline: false,
    lastSeen: "2 hours ago",
    mutualFriends: 8,
  },
  {
    id: "3",
    name: "Marcus Chen",
    username: "MarcusC",
    status: "online",
    isOnline: true,
    mutualFriends: 15,
  },
  {
    id: "4",
    name: "Sarah Williams",
    username: "SarahW",
    status: "offline",
    isOnline: false,
    lastSeen: "1 day ago",
    mutualFriends: 6,
  },
  {
    id: "5",
    name: "David Rodriguez",
    username: "DavidR",
    status: "online",
    isOnline: true,
    mutualFriends: 9,
  },
];

const DEFAULT_BOARDS_SESSIONS = [
  {
    id: "board1",
    name: "Weekend Date Night",
    type: "date-night",
    description: "Romantic weekend experiences for couples",
    participants: [
      { id: "you", name: "You", status: "online" },
      { id: "sarah", name: "Sarah", status: "online" },
    ],
    status: "voting",
    voteDeadline: "Tomorrow",
    cardsCount: 3,
    createdAt: "2 days ago",
    unreadMessages: 3,
    lastActivity: "2 hours ago",
    icon: "Heart",
    gradient: "from-pink-500 to-rose-500",
    creatorId: "you",
    admins: ["you"],
    currentUserId: "you",
  },
  {
    id: "board2",
    name: "Fitness Squad Goals",
    type: "wellness",
    description: "Weekly workout adventures with the crew",
    participants: [
      { id: "you", name: "You", status: "online" },
      { id: "alex", name: "Alex", status: "online" },
      { id: "jamie", name: "Jamie", status: "offline", lastActive: "1h ago" },
      { id: "casey", name: "Casey", status: "online" },
    ],
    status: "active",
    cardsCount: 4,
    createdAt: "1 week ago",
    unreadMessages: 1,
    lastActivity: "30 minutes ago",
    icon: "Dumbbell",
    gradient: "from-green-500 to-emerald-500",
    creatorId: "alex",
    admins: ["alex", "you"],
    currentUserId: "you",
  },
  {
    id: "board3",
    name: "Foodie Adventures",
    type: "food-tour",
    description: "Discovering the best eats in the city",
    participants: [
      { id: "you", name: "You", status: "online" },
      { id: "morgan", name: "Morgan", status: "online" },
      { id: "riley", name: "Riley", status: "offline", lastActive: "2h ago" },
    ],
    status: "locked",
    finalizedDate: "This Saturday",
    cardsCount: 6,
    createdAt: "3 days ago",
    unreadMessages: 0,
    lastActivity: "1 day ago",
    icon: "Utensils",
    gradient: "from-orange-500 to-red-500",
    creatorId: "you",
    admins: ["you"],
    currentUserId: "you",
  },
];

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

export function useAppState() {
  // Supabase authentication
  const {
    user,
    loading: authLoading,
    signIn,
    signUp,
    signOut,
  } = useAuthSimple();
  const { profile } = useAppStore();

  // Onboarding state
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [onboardingData, setOnboardingData] = useState(null);
  const [isLoadingOnboarding, setIsLoadingOnboarding] = useState(true);
  const [showOnboardingFlow, setShowOnboardingFlow] = useState(false);
  const [showSignUpForm, setShowSignUpForm] = useState(false);

  // UI state
  const [currentPage, setCurrentPage] = useState<
    | "home"
    | "connections"
    | "activity"
    | "profile"
    | "profile-settings"
    | "account-settings"
    | "privacy-policy"
    | "terms-of-service"
  >("home");
  const [showPreferences, setShowPreferences] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [showCollabPreferences, setShowCollabPreferences] = useState(false);
  const [showTermsOfService, setShowTermsOfService] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState<any>(null);
  const [currentMode, setCurrentMode] = useState<"solo" | string>("solo");
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

  const [userIdentity, setUserIdentity] = useState({
    firstName: "",
    lastName: "",
    username: "",
    profileImage: null as string | null,
    email: "",
    id: "",
  });

  const [accountPreferences, setAccountPreferences] = useState({
    currency: "USD",
    measurementSystem: "Imperial",
  });

  // Large data arrays with lazy initialization
  const [calendarEntries, setCalendarEntries] = useState([]);
  const [savedCards, setSavedCards] = useState([]);
  const [removedCardIds, setRemovedCardIds] = useState([]);
  const [friendsList, setFriendsList] = useState(DEFAULT_FRIENDS);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [boardsSessions, setBoardsSessions] = useState(DEFAULT_BOARDS_SESSIONS);

  const [profileStats, setProfileStats] = useState({
    savedExperiences: 0,
    boardsCount: 3,
    connectionsCount: 5,
    placesVisited: 0,
  });

  // Authentication state - now using Supabase authentication
  const isAuthenticated = !!user; // Use Supabase user state
  const userRole = "explorer"; // Default role, can be extended later

  // Add timeout to prevent infinite loading
  const [authTimeout, setAuthTimeout] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthTimeout(true);
    }, 5000); // 5 second timeout - reduced for faster response

    return () => clearTimeout(timer);
  }, []);

  // Force loading to false after timeout or if authLoading is false
  const isLoadingAuth = authLoading && !authTimeout;


  // Load onboarding data from profile (authentication handled by Supabase)
  useEffect(() => {
    // Check onboarding status from profile instead of AsyncStorage
    if (profile) {
      const hasCompleted = profile.has_completed_onboarding === true;
      setHasCompletedOnboarding(hasCompleted);
      // If onboarding is not completed, show onboarding flow for authenticated users
      if (!hasCompleted && user && !showOnboardingFlow) {
        setShowOnboardingFlow(true);
      }
    } else if (user && !profile) {
      // User is authenticated but profile not loaded yet - wait
    } else if (!user) {
      // No user - onboarding status doesn't matter
      setHasCompletedOnboarding(false);
    }

    setIsLoadingOnboarding(false);
  }, [profile, user, showOnboardingFlow]);

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
      };

      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet("mingla_user_identity", updatedIdentity);
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
      };

      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet("mingla_user_identity", updatedIdentity);
    } else {
    }
  }, [user, profile]);

  // Load other data from AsyncStorage
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const [
          notificationsEnabledData,
          userIdentityData,
          accountPreferencesData,
          calendarEntriesData,
          savedCardsData,
          removedCardIdsData,
          friendsListData,
          blockedUsersData,
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
          }),
          safeAsyncStorageGet("mingla_account_preferences", {
            currency: "USD",
            measurementSystem: "Imperial",
          }),
          safeAsyncStorageGet("mingla_calendar_entries", []),
          safeAsyncStorageGet("mingla_saved_cards", []),
          safeAsyncStorageGet("mingla_removed_cards", []),
          safeAsyncStorageGet("mingla_friends_list", DEFAULT_FRIENDS),
          safeAsyncStorageGet("mingla_blocked_users", []),
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
        setCalendarEntries(calendarEntriesData);
        setSavedCards(savedCardsData);
        setRemovedCardIds(removedCardIdsData);
        setFriendsList(friendsListData);
        setBlockedUsers(blockedUsersData);
        setBoardsSessions(boardsSessionsData);

        // Update profile stats based on loaded data
        setProfileStats({
          savedExperiences: savedCardsData.length,
          boardsCount: boardsSessionsData.length,
          connectionsCount: friendsListData.length,
          placesVisited: 0,
        });
      } catch (error) {
        console.error("Error loading stored data:", error);
      }
    };

    loadStoredData();
  }, []);

  useEffect(() => {
    const syncSavedCardsWithSupabase = async () => {
      if (!user?.id) {
        setSavedCards([]);
        safeAsyncStorageSet("mingla_saved_cards", []);
        setProfileStats((prev) => ({
          ...prev,
          savedExperiences: 0,
        }));
        return;
      }

      try {
        const cards = await savedCardsService.fetchSavedCards(user.id);
        setSavedCards(cards);
        safeAsyncStorageSet("mingla_saved_cards", cards);
        setProfileStats((prev) => ({
          ...prev,
          savedExperiences: cards.length,
        }));
      } catch (error) {
        console.error("Error syncing saved cards:", error);
      }
    };

    syncSavedCardsWithSupabase();
  }, [user?.id]);

  // Utility functions
  const updateBoardsSessions = (updatedBoards: any[]) => {
    setBoardsSessions(updatedBoards);
    safeAsyncStorageSet("mingla_boards_sessions", updatedBoards);
    setProfileStats((prev) => ({
      ...prev,
      boardsCount: updatedBoards.length,
    }));
  };

  const handleUserIdentityUpdate = async (updatedIdentity: any) => {
    try {
      // Update local state first
      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet("mingla_user_identity", updatedIdentity);

      // Update Supabase profile if user is authenticated
      if (user?.id) {
        const { supabase } = await import("../services/supabase");
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

  // Authentication handlers - now using Supabase
  const handleSignIn = async (
    credentials: { email: string; password: string },
    role: "explorer" | "curator"
  ) => {

    try {
      // Use the signIn function from useAuthSimple
      const { data, error } = await signIn(
        credentials.email,
        credentials.password
      );

      if (error) {
        console.error("Sign in error:", error);
        // TODO: Show error message to user
        alert(`Sign in failed: ${error.message}`);
        return;
      }

      if (data?.user) {
        // The useAuthSimple hook will automatically update the user state
        // and the app will re-render with the authenticated user
      }
    } catch (error) {
      console.error("Sign in failed:", error);
    }
  };

  const handleSignUp = async (
    userData: {
      email: string;
      password: string;
      name: string;
      username: string;
      organization?: string;
      account_type?: string;
    },
    role: "explorer" | "curator"
  ) => {
    // Use account_type from userData if provided, otherwise use role
    const accountType = userData.account_type || role;

    try {
      // Split name into first and last name
      const firstName = userData.name.split(" ")[0] || "";
      const lastName = userData.name.split(" ").slice(1).join(" ") || "";

      // Use the signUp function from useAuthSimple
      // signUp now handles profile creation with firstName, lastName, username, and account_type
      const result = await signUp(
        userData.email,
        userData.password,
        userData.name, // displayName
        firstName,
        lastName,
        userData.username,
        accountType // account_type
      );

      if (!result) {
        console.error("Sign up failed: No result returned");
        alert("Sign up failed: No result returned");
        return;
      }

      const { data, error } = result;

      if (error) {
        console.error("Sign up error:", error);
        // Check if it's a username uniqueness error
        if (
          error.message?.includes("username") ||
          error.message?.includes("unique") ||
          error.code === "23505"
        ) {
          alert("This username is already taken. Please choose another one.");
        } else {
          alert(`Sign up failed: ${error.message}`);
        }
        return;
      }

      if (data?.user) {

        // Reset showSignUpForm so onboarding can show properly
        setShowSignUpForm(false);

        // The useAuthSimple hook will automatically update the user state
        // and the app will re-render with the authenticated user
        // OnboardingFlow will automatically show when profile loads with has_completed_onboarding = false
      }
    } catch (error) {
      console.error("Sign up failed:", error);
      alert("An unexpected error occurred during sign up. Please try again.");
    }
  };

  const handleSignOut = async () => {
    try {
      // Clear all user data from the store immediately
      const { useAppStore } = await import("../store/appStore");
      const store = useAppStore.getState();
      store.clearUserData();
    } catch (error) {
      console.error("Error clearing store data:", error);
    }

    // Also clear local state
    setUserIdentity({
      firstName: "",
      lastName: "",
      username: "",
      profileImage: null,
      email: "",
      id: "",
    });
    // Try Supabase sign out in background (non-blocking)
    try {
      await signOut();
    } catch (error) {
      // Background sign out failed - non-critical
    }
  };

  return {
    // Authentication State (now using Supabase)
    isAuthenticated,
    userRole,
    isLoadingAuth,
    authTimeout,
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
    showSignUpForm,
    setShowSignUpForm,
    currentPage,
    setCurrentPage,
    showPreferences,
    setShowPreferences,
    showCollaboration,
    setShowCollaboration,
    showCollabPreferences,
    setShowCollabPreferences,
    showTermsOfService,
    setShowTermsOfService,
    showPrivacyPolicy,
    setShowPrivacyPolicy,
    showAccountSettings,
    setShowAccountSettings,
    showProfileSettings,
    setShowProfileSettings,
    showShareModal,
    setShowShareModal,
    shareData,
    setShareData,
    currentMode,
    setCurrentMode,
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
    userIdentity,
    setUserIdentity,
    accountPreferences,
    setAccountPreferences,
    calendarEntries,
    setCalendarEntries,
    savedCards,
    setSavedCards,
    removedCardIds,
    setRemovedCardIds,
    friendsList,
    setFriendsList,
    blockedUsers,
    setBlockedUsers,
    boardsSessions,
    setBoardsSessions,
    profileStats,
    setProfileStats,
    preferencesRefreshKey,
    setPreferencesRefreshKey,

    // Utilities
    updateBoardsSessions,
    handleUserIdentityUpdate,
    handleAccountPreferencesUpdate,
    safeAsyncStorageSet,

    // Authentication Handlers
    handleSignIn,
    handleSignUp,
    handleSignOut,
  };
}
