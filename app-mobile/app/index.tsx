import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useAppHandlers } from "../src/components/AppHandlers";
import { useAppState } from "../src/components/AppStateManager";
import CollaborationModule from "../src/components/CollaborationModule";
import CollaborationPreferences from "../src/components/CollaborationPreferences";
import ErrorBoundary from "../src/components/ErrorBoundary";
import HomePage from "../src/components/HomePage";
import PreferencesSheet from "../src/components/PreferencesSheet";
import ProfilePage from "../src/components/ProfilePage";
import SignInPage from "../src/components/SignInPage";
import TermsOfService from "../src/components/profile/TermsOfService";
import PrivacyPolicy from "../src/components/profile/PrivacyPolicy";
import AccountSettings from "../src/components/profile/AccountSettings";
import ProfileSettings from "../src/components/profile/ProfileSettings";
import OnboardingFlow from "../src/components/OnboardingFlow";
import ActivityPage from "../src/components/ActivityPage";
import SavedExperiencesPage from "../src/components/SavedExperiencesPage";
import ConnectionsPage from "../src/components/ConnectionsPage";
import { NavigationProvider } from "../src/contexts/NavigationContext";
import { MobileFeaturesProvider } from "../src/components/MobileFeaturesProvider";
import { CardsCacheProvider } from "../src/contexts/CardsCacheContext";
import { RecommendationsProvider } from "../src/contexts/RecommendationsContext";
import EmailOTPVerificationScreen from "../src/components/EmailOTPVerificationScreen";
import CoachMap from "../src/components/CoachMap";
import { BoardViewScreen } from "../src/components/board/BoardViewScreen";
import { ToastContainer } from "../src/components/ui/ToastContainer";
import { useBoardSession } from "../hooks/useBoardSession";
import { messagingService } from "../src/services/messagingService";
import { BoardMessageService } from "../src/services/boardMessageService";
import ShareModal from "../src/components/ShareModal";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "../src/config/queryClient";
import { SessionService } from "../src/services/sessionService";
import { supabase } from "../src/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

function AppContent() {
  const state = useAppState();
  const handlers = useAppHandlers(state);
  const [coachMapCurrentTarget, setCoachMapCurrentTarget] = useState<
    string | null
  >(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [totalUnreadMessages, setTotalUnreadMessages] = useState<number>(0);
  const [totalUnreadBoardMessages, setTotalUnreadBoardMessages] =
    useState<number>(0);

  // Destructure commonly used state
  const {
    isAuthenticated,
    isLoadingAuth,
    authTimeout,
    user,
    profile,
    handleSignIn,
    handleSignUp,
    handleSignOut,
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
    showCoachMap,
    setShowCoachMap,
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
    isLoadingBoards,
    profileStats,
    setProfileStats,
    preferencesRefreshKey,
    setPreferencesRefreshKey,
    boardViewSessionId,
    setBoardViewSessionId,
    updateBoardsSessions,
    handleUserIdentityUpdate,
    safeAsyncStorageSet,
    isLoadingSavedCards,
    showOnboardingFlow,
    setShowOnboardingFlow,
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    onboardingData,
    setOnboardingData,
    showSignUpForm,
    setShowSignUpForm,
  } = state;

  // Helper to check if coach map is highlighting tabs
  const isHighlightingTabs = Boolean(
    showCoachMap &&
      coachMapCurrentTarget &&
      (coachMapCurrentTarget === "tabHome" ||
        coachMapCurrentTarget === "tabConnections" ||
        coachMapCurrentTarget === "tabActivity" ||
        coachMapCurrentTarget === "tabSaved" ||
        coachMapCurrentTarget === "tabProfile")
  );

  // Helper to check if coach map is highlighting header buttons
  const isHighlightingHeader = Boolean(
    showCoachMap &&
      coachMapCurrentTarget &&
      (coachMapCurrentTarget === "preferencesButton" ||
        coachMapCurrentTarget === "collaborateButton")
  );

  // Handle deep links for OAuth callback
  useEffect(() => {
    // Handle initial URL (if app was opened via deep link)
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink(url);
      }
    });

    // Listen for deep links while app is running
    const subscription = Linking.addEventListener("url", (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleDeepLink = async (url: string) => {
    console.log("Deep link received:", url);

    // Check if it's an OAuth callback
    if (url.includes("auth/callback")) {
      try {
        console.log("Processing OAuth callback deep link...");

        // Parse the URL - Supabase puts tokens in hash or query params
        const parsedUrl = Linking.parse(url);
        console.log("Parsed URL:", parsedUrl);

        // Try query params first
        const queryParams = parsedUrl.queryParams || {};
        const {
          access_token,
          refresh_token,
          error: errorParam,
          code,
        } = queryParams;

        // Also try parsing from hash if available
        let accessToken = access_token;
        let refreshToken = refresh_token;
        let error = errorParam;

        // If tokens not in query params, try parsing hash manually
        if (!accessToken && url.includes("#")) {
          const hashIndex = url.indexOf("#");
          const hash = url.substring(hashIndex + 1);
          const hashParams = new URLSearchParams(hash);
          accessToken = hashParams.get("access_token") || undefined;
          refreshToken = hashParams.get("refresh_token") || undefined;
          error = hashParams.get("error") || undefined;
        }

        if (error) {
          console.error("OAuth error from deep link:", error);
          Alert.alert("Sign-in Error", String(error));
          return;
        }

        if (accessToken && refreshToken) {
          console.log("Tokens found in deep link, setting session...");
          // Use supabase directly to set session
          const { useAppStore } = await import("../src/store/appStore");
          const { setProfile } = useAppStore.getState();

          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: String(accessToken),
            refresh_token: String(refreshToken),
          });

          if (sessionError) {
            console.error("Error setting session:", sessionError);
            Alert.alert(
              "Error",
              "Failed to complete sign-in: " + sessionError.message
            );
          } else if (data.session?.user) {
            console.log("✅ Session set successfully via deep link");

            // Load profile
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", data.session.user.id)
              .single();

            if (!profileError && profile) {
              setProfile(profile);
            }
          }
        } else if (code) {
          // Handle authorization code if needed
          console.log("Authorization code received:", code);
        } else {
          console.log("No tokens or code found in deep link. URL:", url);
          // Session might be created server-side, just log and continue
        }
      } catch (error: any) {
        console.error("Error handling deep link:", error);
        console.error("Error stack:", error.stack);
        // Don't show alert - let the app continue, session might still be created
      }
    }
  };

  // Fetch unread message count on app load
  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!isAuthenticated || !user?.id) {
        setTotalUnreadMessages(0);
        return;
      }

      try {
        const { conversations, error } =
          await messagingService.getConversations(user.id);
        if (!error && conversations) {
          const totalUnread = conversations.reduce(
            (sum, conv) => sum + (conv.unread_count || 0),
            0
          );
          setTotalUnreadMessages(totalUnread);
        }
      } catch (error) {
        console.error("Error fetching unread count:", error);
      }
    };

    fetchUnreadCount();
  }, [isAuthenticated, user?.id]);

  // Fetch unread board messages count on app load
  useEffect(() => {
    const fetchUnreadBoardCount = async () => {
      if (!isAuthenticated || !user?.id) {
        setTotalUnreadBoardMessages(0);
        return;
      }

      try {
        const { count, error } =
          await BoardMessageService.getTotalUnreadBoardMessages(user.id);
        if (!error) {
          setTotalUnreadBoardMessages(count);
        }
      } catch (error) {
        console.error("Error fetching unread board messages count:", error);
      }
    };

    fetchUnreadBoardCount();

    // Set up real-time listener for board messages
    // This will update when new messages arrive
    const interval = setInterval(() => {
      fetchUnreadBoardCount();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [isAuthenticated, user?.id]);

  // Automatically show coach map when main app loads (only once per session)
  // Use a ref to track if we've already shown it in this session
  const coachMapShownRef = useRef(false);

  // Function to update coach map tour status in profile
  const updateCoachMapTourStatus = async (status: "completed" | "skipped") => {
    if (!user?.id || !profile) return;

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ coach_map_tour_status: status })
        .eq("id", user.id);

      if (error) {
        console.error("Error updating coach map tour status:", error);
        return;
      }

      // Update profile in store
      const { useAppStore } = await import("../src/store/appStore");
      const updatedProfile = { ...profile, coach_map_tour_status: status };
      useAppStore.getState().setProfile(updatedProfile);
    } catch (error) {
      console.error("Error updating coach map tour status:", error);
    }
  };

  useEffect(() => {
    if (
      isAuthenticated &&
      user &&
      profile &&
      profile.has_completed_onboarding === true &&
      !coachMapShownRef.current &&
      // Only show if tour hasn't been completed or skipped
      (profile.coach_map_tour_status === null ||
        profile.coach_map_tour_status === undefined)
    ) {
      // Show coach map after a brief delay to ensure UI is ready
      const timer = setTimeout(() => {
        setShowCoachMap(true);
        coachMapShownRef.current = true; // Mark as shown for this session
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, user, profile, setShowCoachMap]);

  // Get session ID when in collaboration mode
  useEffect(() => {
    const getSessionId = async () => {
      // Check if solo mode is persisted in storage first
      try {
        const storedMode = await AsyncStorage.getItem("mingla_last_mode");
        if (storedMode) {
          const parsedMode = JSON.parse(storedMode);
          if (parsedMode === "solo") {
            // Solo mode is persisted, return early without fetching from database
            setCurrentSessionId(null);
            return;
          }
        }
      } catch (error) {
        console.error("Error checking last mode storage:", error);
      }

      if (currentMode !== "solo" && user?.id) {
        // Try to get from active session
        const activeSession = await SessionService.getActiveSession(user.id);
        if (activeSession) {
          setCurrentSessionId(activeSession.sessionId);
        } else {
          // Fallback: find session by name
          const { data: sessions } = await supabase
            .from("collaboration_sessions")
            .select("id")
            .eq("name", currentMode)
            .limit(1);

          if (sessions && sessions.length > 0) {
            setCurrentSessionId(sessions[0].id);
          }
        }
      } else {
        setCurrentSessionId(null);
      }
    };

    getSessionId();
  }, [currentMode, user?.id]);

  // Show loading while checking authentication status (with fallback)
  if (isLoadingAuth && !authTimeout) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#f9fafb",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 64,
              height: 64,
              backgroundColor: "#eb7825",
              borderRadius: 32,
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: "white", fontSize: 24 }}>✨</Text>
          </View>
          <Text style={{ color: "#6b7280", fontSize: 16, marginBottom: 8 }}>
            Loading Mingla...
          </Text>
          <Text style={{ color: "#9ca3af", fontSize: 14 }}>
            Checking authentication...
          </Text>
        </View>
      </View>
    );
  }

  // Check if user needs onboarding (for authenticated users)
  // Show onboarding if user is authenticated but hasn't completed onboarding
  const needsOnboarding =
    isAuthenticated &&
    user &&
    profile &&
    profile.has_completed_onboarding === false;

  // Check if user needs email verification before onboarding
  // Block onboarding if user is authenticated but email is not verified
  // Skip email verification for Google and Apple sign-in users (they already verify emails)
  const isGoogleUser = user?.app_metadata?.provider === "google";
  const isAppleUser = user?.app_metadata?.provider === "apple";
  const needsEmailVerification =
    isAuthenticated &&
    user &&
    profile &&
    profile.email_verified === false &&
    !isGoogleUser &&
    !isAppleUser; // Skip verification for Google and Apple users

  // Show email verification screen if needed (before onboarding)
  if (needsEmailVerification && !showSignUpForm) {
    return (
      <ErrorBoundary>
        <EmailOTPVerificationScreen
          email={user?.email || ""}
          onVerificationComplete={() => {
            // Email verified - user can proceed to onboarding
            // The profile will be reloaded automatically via onAuthStateChange
          }}
        />
      </ErrorBoundary>
    );
  }

  // Show onboarding flow if it's active OR if user needs onboarding
  if (showOnboardingFlow || needsOnboarding) {
    /*   console.log("Showing onboarding flow", {
      showOnboardingFlow,
      needsOnboarding,
      hasCompletedOnboarding: profile?.has_completed_onboarding,
    }); */

    // Ensure onboarding flow is shown (only if not navigating to sign-up)
    if (!showOnboardingFlow && needsOnboarding && !showSignUpForm) {
      setShowOnboardingFlow(true);
    }

    return (
      <ErrorBoundary>
        <OnboardingFlow
          onComplete={(data) => {
            setOnboardingData(data);
            // has_completed_onboarding is already set in database by OnboardingFlow
            // Just update local state
            setHasCompletedOnboarding(true);
            setShowOnboardingFlow(false);
          }}
          onNavigateToSignUp={(accountType) => {
            setShowOnboardingFlow(false);
            setShowSignUpForm(true);
            // Store account_type for signup
            if (accountType) {
              setOnboardingData((prev: any) => ({
                ...prev,
                account_type: accountType,
              }));
            }
            // This will trigger the SignInPage to show sign-up form
          }}
          onBackToWelcome={() => {
            setShowOnboardingFlow(false);
            // If user has completed onboarding, mark it as complete in local state
            if (profile?.has_completed_onboarding === true) {
              setHasCompletedOnboarding(true);
            }
          }}
          onNavigateToSignUpForm={(accountType) => {
            setShowOnboardingFlow(false);
            setShowSignUpForm(true);
            // Store account_type for signup
            if (accountType) {
              setOnboardingData((prev: any) => ({
                ...prev,
                account_type: accountType,
              }));
            }
            // This will show the sign-up form
          }}
          onGoogleSignInComplete={() => {
            // Google sign-in completed - user is authenticated
            // Check onboarding status will be handled by the navigation logic below
            // Don't set onboarding state here - let the profile check handle it
          }}
          initialAccountType={onboardingData?.account_type}
        />
      </ErrorBoundary>
    );
  }

  // Show sign in page if user is not authenticated
  // Also show sign in if authenticated but profile hasn't loaded yet (to avoid flash)
  if (!isAuthenticated || (user && !profile && !isLoadingAuth)) {
    return (
      <ErrorBoundary>
        <SignInPage
          onSignInRegular={(credentials) =>
            handleSignIn(credentials, "explorer")
          }
          onSignUpRegular={(userData) => {
            const accountType = userData.account_type || "explorer";
            handleSignUp(userData, accountType);
          }}
          onSignInCurator={(credentials) =>
            handleSignIn(credentials, "curator")
          }
          onSignUpCurator={(userData) => {
            const accountType = userData.account_type || "curator";
            handleSignUp(userData, accountType);
          }}
          onStartOnboarding={(accountType) => {
            setOnboardingData((prev: any) => ({
              ...prev,
              account_type: accountType,
            }));
            setShowOnboardingFlow(true);
          }}
          initialMode={showSignUpForm ? "sign-up" : "welcome"}
          onResetSignUpForm={() => setShowSignUpForm(false)}
        />
      </ErrorBoundary>
    );
  }

  // Function to render current page based on navigation
  const renderCurrentPage = () => {
    switch (currentPage) {
      case "home":
        return (
          <HomePage
            onOpenPreferences={() => {
              setShowPreferences(true);
            }}
            onOpenCollaboration={handlers.handleCollaborationOpen}
            onOpenCollabPreferences={() => setShowCollabPreferences(true)}
            currentMode={currentMode ?? "solo"}
            isHighlightingHeader={isHighlightingHeader}
            userPreferences={userPreferences}
            accountPreferences={{
              currency: accountPreferences?.currency || "USD",
              measurementSystem:
                (accountPreferences?.measurementSystem as
                  | "Metric"
                  | "Imperial") || "Imperial",
            }}
            onAddToCalendar={(experienceData: any) =>
              console.log("Add to calendar:", experienceData)
            }
            savedCards={savedCards}
            onSaveCard={handlers.handleSaveCard}
            onShareCard={handlers.handleShareCard}
            onPurchaseComplete={(experienceData: any, purchaseOption: any) =>
              console.log("Purchase complete:", experienceData, purchaseOption)
            }
            removedCardIds={removedCardIds}
            onResetCards={() => setRemovedCardIds([])}
            generateNewMockCard={() => console.log("Generate new card")}
            refreshKey={preferencesRefreshKey}
          />
        );
      case "saved":
        return (
          <SavedExperiencesPage
            savedCards={savedCards}
            isLoading={isLoadingSavedCards}
            userPreferences={userPreferences}
            onScheduleFromSaved={(card: any) => {
              console.log("Scheduling from saved:", card);
            }}
            onPurchaseFromSaved={(card: any, option: any) => {
              console.log("Purchasing from saved:", card, option);
            }}
            onShareCard={handlers.handleShareCard}
          />
        );
      case "connections":
        return (
          <ConnectionsPage
            onSendCollabInvite={(friend: any) => {
              console.log("Sending collaboration invite to:", friend);
            }}
            onAddToBoard={handlers.handleAddToBoard}
            onShareSavedCard={handlers.handleShareSavedCard}
            onRemoveFriend={handlers.handleRemoveFriend}
            onBlockUser={handlers.handleBlockUser}
            onReportUser={handlers.handleReportUser}
            accountPreferences={accountPreferences}
            boardsSessions={boardsSessions}
            currentMode={currentMode ?? "solo"}
            onModeChange={handlers.handleModeChange}
            onUpdateBoardSession={(board: any) => {
              console.log("Updating board session:", board);
            }}
            onCreateSession={(newSession: any) => {
              console.log("Creating session:", newSession);
            }}
            onNavigateToBoard={(board: any, discussionTab?: string) => {
              setBoardViewSessionId(board.id || board);
              setCurrentPage("board-view");
            }}
            onUnreadCountChange={setTotalUnreadMessages}
          />
        );
      case "activity":
        return (
          <ActivityPage
            boardsSessions={boardsSessions}
            isLoadingBoards={isLoadingBoards}
            isLoadingSavedCards={isLoadingSavedCards}
            calendarEntries={calendarEntries}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            navigationData={activityNavigation}
            onNavigationComplete={() => setActivityNavigation(null)}
            onSendInvite={(sessionId: string, users: any[]) => {
              console.log(
                "Sending invite to session:",
                sessionId,
                "users:",
                users
              );
              // Handle invite logic here
            }}
            onScheduleFromSaved={handlers.handleScheduleFromSaved}
            onPurchaseFromSaved={(card: any, purchaseOption: any) => {
              console.log("Purchasing from saved:", card, purchaseOption);
              // Handle purchase logic here
            }}
            onRemoveFromCalendar={handlers.handleRemoveFromCalendar}
            onShareCard={handlers.handleShareCard}
            onUpdateBoardSession={(board: any) => {
              console.log("Updating board session:", board);
              // Handle board update logic here
            }}
            onPromoteToAdmin={(boardId: string, participantId: string) => {
              console.log("Promoting to admin:", boardId, participantId);
              // Handle promote logic here
            }}
            onDemoteFromAdmin={(boardId: string, participantId: string) => {
              console.log("Demoting from admin:", boardId, participantId);
              // Handle demote logic here
            }}
            onRemoveMember={(boardId: string, participantId: string) => {
              console.log("Removing member:", boardId, participantId);
              // Handle remove member logic here
            }}
            onLeaveBoard={(boardId: string) => {
              console.log("Leaving board:", boardId);
              // Handle leave board logic here
            }}
            onNavigateToBoard={(sessionId: string) => {
              setBoardViewSessionId(sessionId);
              setCurrentPage("board-view");
            }}
            onUnreadCountChange={setTotalUnreadBoardMessages}
            activeBoardSessionId={boardViewSessionId}
          />
        );
      case "board-view":
        return boardViewSessionId ? (
          <BoardViewScreen
            sessionId={boardViewSessionId}
            onBack={() => {
              setCurrentPage("activity");
              // Keep boardViewSessionId set so Saved tab can show board-specific cards
              // It will be cleared when user navigates away from activity page or selects a different board
            }}
            onNavigateToSession={(sessionId: string) => {
              setBoardViewSessionId(sessionId);
            }}
            onExitBoard={async (
              exitedSessionId?: string,
              exitedSessionName?: string
            ) => {
              if (!user?.id) return;

              // OPTIMISTIC UPDATE: Remove board from list immediately
              if (exitedSessionId && boardsSessions) {
                const updatedBoards = boardsSessions.filter(
                  (board: any) =>
                    board.id !== exitedSessionId &&
                    (board as any).session_id !== exitedSessionId
                );
                updateBoardsSessions(updatedBoards);
              }

              // OPTIMISTIC UPDATE: If exited session was the active session, switch to solo immediately
              if (exitedSessionName && currentMode === exitedSessionName) {
                state.setCurrentMode("solo");
              }

              // Now do database operations and refresh in background
              try {
                // Remove user from session participants
                if (exitedSessionId) {
                  await supabase
                    .from("session_participants")
                    .delete()
                    .eq("session_id", exitedSessionId)
                    .eq("user_id", user.id);

                  // Update invites to declined
                  await supabase
                    .from("collaboration_invites")
                    .update({ status: "declined" })
                    .eq("session_id", exitedSessionId)
                    .eq("invited_user_id", user.id);
                }

                // Refresh boards list from database to ensure consistency
                const { BoardSessionService } = await import(
                  "../src/services/boardSessionService"
                );
                const boards = await BoardSessionService.fetchUserBoardSessions(
                  user.id
                );
                updateBoardsSessions(boards);

                // Refresh active session from database
                const activeSession = await SessionService.getActiveSession(
                  user.id
                );

                // Update current mode based on active session
                if (activeSession) {
                  // Pass sessionId to setCurrentMode for proper tracking
                  state.setCurrentMode(
                    activeSession.sessionName,
                    activeSession.sessionId
                  );
                } else {
                  state.setCurrentMode("solo");
                }
              } catch (error) {
                console.error("Error refreshing boards after exit:", error);
                // Don't show error to user - optimistic update already happened
              }
            }}
          />
        ) : (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <Text>No session selected</Text>
            <TouchableOpacity onPress={() => setCurrentPage("activity")}>
              <Text style={{ color: "#007AFF", marginTop: 16 }}>Go Back</Text>
            </TouchableOpacity>
          </View>
        );
      case "profile":
        return (
          <ProfilePage
            onSignOut={async () => {
              await handleSignOut();
            }}
            onNavigateToActivity={(tab: "saved" | "boards" | "calendar") => {
              console.log("Navigate to activity:", tab);
              setCurrentPage("activity");
            }}
            onNavigateToConnections={() => {
              console.log("Navigate to connections");
              setCurrentPage("connections");
            }}
            onNavigateToProfileSettings={() => {
              setShowProfileSettings(true);
            }}
            onNavigateToAccountSettings={() => setShowAccountSettings(true)}
            onNavigateToPrivacyPolicy={() => setShowPrivacyPolicy(true)}
            onNavigateToTermsOfService={() => setShowTermsOfService(true)}
            savedExperiences={savedCards?.length || 0}
            boardsCount={boardsSessions?.length || 0}
            connectionsCount={friendsList?.length || 0}
            placesVisited={0}
            notificationsEnabled={notificationsEnabled}
            onNotificationsToggle={(enabled: boolean) =>
              console.log("Toggle notifications:", enabled)
            }
            userIdentity={userIdentity}
            blockedUsers={blockedUsers}
            onUnblockUser={(blockedUser: any) =>
              console.log("Unblock user:", blockedUser)
            }
          />
        );
      default:
        return (
          <HomePage
            onOpenPreferences={() => {
              setShowPreferences(true);
            }}
            onOpenCollaboration={handlers.handleCollaborationOpen}
            onOpenCollabPreferences={() => setShowCollabPreferences(true)}
            currentMode={currentMode ?? "solo"}
            isHighlightingHeader={isHighlightingHeader}
            userPreferences={userPreferences}
            accountPreferences={{
              currency: accountPreferences?.currency || "USD",
              measurementSystem:
                (accountPreferences?.measurementSystem as
                  | "Metric"
                  | "Imperial") || "Imperial",
            }}
            onAddToCalendar={(experienceData: any) =>
              console.log("Add to calendar:", experienceData)
            }
            savedCards={savedCards}
            onSaveCard={(card: any) => console.log("Save card:", card)}
            onShareCard={handlers.handleShareCard}
            onPurchaseComplete={(experienceData: any, purchaseOption: any) =>
              console.log("Purchase complete:", experienceData, purchaseOption)
            }
            removedCardIds={removedCardIds}
            onResetCards={() => setRemovedCardIds([])}
            generateNewMockCard={() => console.log("Generate new card")}
          />
        );
    }
  };

  // Show main app if user is authenticated AND has completed onboarding
  if (
    isAuthenticated &&
    user &&
    profile &&
    profile.has_completed_onboarding === true
  ) {
    // Show CollaborationPreferences as full screen if collaboration preferences are open
    if (showCollabPreferences && currentMode !== "solo" && currentSessionId) {
      return (
        <ErrorBoundary>
          <CollaborationPreferences
            isOpen={showCollabPreferences}
            onClose={() => {
              setShowCollabPreferences(false);
            }}
            sessionName={currentMode ?? "solo"}
            sessionId={currentSessionId} // Add this
            participants={[]}
            onSave={handlers.handleCollabPreferencesSave}
          />
        </ErrorBoundary>
      );
    }

    // Show PreferencesSheet as full screen if preferences are open
    if (showPreferences) {
      return (
        <ErrorBoundary>
          <PreferencesSheet
            onClose={() => {
              setShowPreferences(false);
            }}
            onSave={handlers.handleSavePreferences}
            accountPreferences={{
              currency: accountPreferences?.currency || "USD",
              measurementSystem:
                (accountPreferences?.measurementSystem as
                  | "Metric"
                  | "Imperial") || "Imperial",
            }}
          />
        </ErrorBoundary>
      );
    }

    // Show Terms of Service as full screen if terms are open
    if (showTermsOfService) {
      return (
        <ErrorBoundary>
          <TermsOfService onNavigateBack={() => setShowTermsOfService(false)} />
        </ErrorBoundary>
      );
    }

    // Show Privacy Policy as full screen if privacy policy is open
    if (showPrivacyPolicy) {
      return (
        <ErrorBoundary>
          <PrivacyPolicy onNavigateBack={() => setShowPrivacyPolicy(false)} />
        </ErrorBoundary>
      );
    }

    // Show Account Settings as full screen if account settings are open
    if (showAccountSettings) {
      return (
        <ErrorBoundary>
          <AccountSettings
            accountPreferences={{
              currency: accountPreferences?.currency || "USD",
              measurementSystem:
                (accountPreferences?.measurementSystem as
                  | "Metric"
                  | "Imperial") || "Imperial",
            }}
            onUpdatePreferences={(preferences) => {
              console.log("Account preferences updated:", preferences);
              setAccountPreferences(preferences);
              setShowAccountSettings(false);
            }}
            onDeleteAccount={() => {
              console.log("Delete account requested");
              // TODO: Implement account deletion
              setShowAccountSettings(false);
            }}
            onNavigateBack={() => setShowAccountSettings(false)}
          />
        </ErrorBoundary>
      );
    }

    // Show Profile Settings as full screen if profile settings are open
    if (showProfileSettings) {
      return (
        <ErrorBoundary>
          <ProfileSettings
            userIdentity={userIdentity}
            onUpdateIdentity={(updatedIdentity) => {
              handleUserIdentityUpdate(updatedIdentity);
              setShowProfileSettings(false);
            }}
            onNavigateBack={() => setShowProfileSettings(false)}
          />
        </ErrorBoundary>
      );
    }

    return (
      <>
        <CardsCacheProvider>
          <RecommendationsProvider
            currentMode={currentMode ?? "solo"}
            refreshKey={preferencesRefreshKey}
          >
            <MobileFeaturesProvider>
              <NavigationProvider>
                <ErrorBoundary>
                  <SafeAreaView
                    style={styles.safeArea}
                    edges={["top", "bottom"]}
                  >
                    <StatusBar
                      barStyle="dark-content"
                      backgroundColor="white"
                    />
                    <View style={styles.container}>
                      {/* Main Content */}
                      <View style={styles.mainContent}>
                        {renderCurrentPage()}
                      </View>

                      {/* Collaboration Module */}
                      <CollaborationModule
                        isOpen={showCollaboration}
                        onClose={() => {
                          setShowCollaboration(false);
                          setPreSelectedFriend(null);
                        }}
                        currentMode={currentMode ?? "solo"}
                        onModeChange={handlers.handleModeChange}
                        preSelectedFriend={preSelectedFriend}
                        boardsSessions={boardsSessions}
                        onUpdateBoardSession={(updatedBoard: any) =>
                          console.log("Update board session:", updatedBoard)
                        }
                        onCreateSession={(newSession: any) =>
                          console.log("Create session:", newSession)
                        }
                        onNavigateToBoard={(
                          board: any,
                          discussionTab?: string
                        ) =>
                          console.log(
                            "Navigate to board:",
                            board,
                            discussionTab
                          )
                        }
                        availableFriends={[]}
                        onRefreshBoards={async () => {
                          // Refresh boards list immediately after accepting invite
                          if (user?.id) {
                            try {
                              const { BoardSessionService } = await import(
                                "../src/services/boardSessionService"
                              );
                              const boards =
                                await BoardSessionService.fetchUserBoardSessions(
                                  user.id
                                );
                              updateBoardsSessions(boards);
                            } catch (error) {
                              console.error("Error refreshing boards:", error);
                            }
                          }
                        }}
                      />

                      {/* Bottom Navigation - keep visible and above overlay when tabs are highlighted */}
                      <View
                        style={[
                          styles.bottomNavigation,
                          isHighlightingTabs && {
                            zIndex: 1000,
                            elevation: 1000,
                          },
                        ]}
                      >
                        <View style={styles.navigationContainer}>
                          <TouchableOpacity
                            onPress={() => {
                              console.log("Navigating to home");
                              setCurrentPage("home");
                            }}
                            style={styles.navItem}
                          >
                            <Ionicons
                              name="home-outline"
                              size={24}
                              color={
                                currentPage === "home" ? "#eb7825" : "#9CA3AF"
                              }
                            />
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "home"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              Home
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              console.log("Navigating to connections");
                              setCurrentPage("connections");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="people-outline"
                                size={24}
                                color={
                                  currentPage === "connections"
                                    ? "#eb7825"
                                    : "#9CA3AF"
                                }
                              />
                              {totalUnreadMessages > 0 && (
                                <View style={styles.tabBadge}>
                                  <Text style={styles.tabBadgeText}>
                                    {totalUnreadMessages > 99
                                      ? "99+"
                                      : totalUnreadMessages}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "connections"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              Connections
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              setCurrentPage("activity");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="calendar-outline"
                                size={24}
                                color={
                                  currentPage === "activity"
                                    ? "#eb7825"
                                    : "#9CA3AF"
                                }
                              />
                              {totalUnreadBoardMessages > 0 && (
                                <View style={styles.tabBadge}>
                                  <Text style={styles.tabBadgeText}>
                                    {totalUnreadBoardMessages > 99
                                      ? "99+"
                                      : totalUnreadBoardMessages}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "activity"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              Activity
                            </Text>
                          </TouchableOpacity>
                          {/*    <TouchableOpacity
                              onPress={() => {
                                console.log("Navigating to saved");
                                setCurrentPage("saved");
                              }}
                              style={styles.navItem}
                            >
                              <Ionicons
                                name="bookmark"
                                size={24}
                                color={
                                  currentPage === "saved"
                                    ? "#eb7825"
                                    : "#9CA3AF"
                                }
                              />
                              <Text
                                style={[
                                  styles.navText,
                                  currentPage === "saved"
                                    ? styles.navTextActive
                                    : styles.navTextInactive,
                                ]}
                              >
                                Saved
                              </Text>
                            </TouchableOpacity> */}
                          <TouchableOpacity
                            onPress={() => {
                              console.log("Navigating to profile");
                              setCurrentPage("profile");
                            }}
                            style={styles.navItem}
                          >
                            <Ionicons
                              name="person-outline"
                              size={24}
                              color={
                                currentPage === "profile"
                                  ? "#eb7825"
                                  : "#9CA3AF"
                              }
                            />
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "profile"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              Profile
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {/* Coach Map Overlay */}
                    <CoachMap
                      visible={showCoachMap}
                      onComplete={async () => {
                        await updateCoachMapTourStatus("completed");
                        setShowCoachMap(false);
                        setCoachMapCurrentTarget(null);
                      }}
                      onSkip={async () => {
                        await updateCoachMapTourStatus("skipped");
                        setShowCoachMap(false);
                        setCoachMapCurrentTarget(null);
                      }}
                      onStepChange={(stepIndex, target) => {
                        // Reset target when coach map closes (stepIndex === -1)
                        if (stepIndex === -1) {
                          setCoachMapCurrentTarget(null);
                        } else {
                          setCoachMapCurrentTarget(target);
                        }
                      }}
                    />

                    {/* Share Modal */}
                    <ShareModal
                      isOpen={showShareModal}
                      onClose={() => setShowShareModal(false)}
                      experienceData={shareData?.experienceData}
                      dateTimePreferences={shareData?.dateTimePreferences}
                      userPreferences={userPreferences}
                      accountPreferences={accountPreferences}
                    />
                  </SafeAreaView>
                </ErrorBoundary>
              </NavigationProvider>
            </MobileFeaturesProvider>
          </RecommendationsProvider>
        </CardsCacheProvider>
        <ToastContainer />
      </>
    );
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "white",
  },
  container: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
  },
  bottomNavigation: {
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingBottom: 8,
    paddingTop: 8,
    zIndex: -1, // Low z-index so it doesn't overlay the Modal
    elevation: -1,
  },
  navigationContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  navItem: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  navIconContainer: {
    position: "relative",
  },
  tabBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    backgroundColor: "#eb7825",
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "white",
  },
  tabBadgeText: {
    fontSize: 10,
    color: "white",
    fontWeight: "700",
  },
  navText: {
    fontSize: 12,
    marginTop: 4,
  },
  navTextActive: {
    color: "#eb7825",
    fontWeight: "500",
  },
  navTextInactive: {
    color: "#9CA3AF",
  },
});

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours

        dehydrateOptions: {
          // Exclude savedCards and calendarEntries queries from persistence
          shouldDehydrateQuery: (query) => {
            const queryKey = query.queryKey;

            // Don't persist queries with queryKey starting with "savedCards" or "calendarEntries"
            if (Array.isArray(queryKey)) {
              const firstKey = queryKey[0];
              if (firstKey === "savedCards" || firstKey === "calendarEntries") {
                return false;
              }
            }
            // Persist all other queries
            return true;
          },
        },
      }}
    >
      <AppContent />
    </PersistQueryClientProvider>
  );
}
