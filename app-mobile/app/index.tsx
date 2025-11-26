import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAppHandlers } from "../src/components/AppHandlers";
import { useAppState } from "../src/components/AppStateManager";
import CollaborationModule from "../src/components/CollaborationModule";
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
import { NavigationProvider } from "../src/contexts/NavigationContext";
import { MobileFeaturesProvider } from "../src/components/MobileFeaturesProvider";
import EmailOTPVerificationScreen from "../src/components/EmailOTPVerificationScreen";

export default function App() {
  const state = useAppState();
  const handlers = useAppHandlers(state);

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
    currentMode,
    preSelectedFriend,
    setPreSelectedFriend,
    activeSessionData,
    setActiveSessionData,
    userPreferences,
    notifications,
    setNotifications,
    collaborationPreferences,
    notificationsEnabled,
    activityNavigation,
    setActivityNavigation,
    userIdentity,
    accountPreferences,
    setAccountPreferences,
    calendarEntries,
    setCalendarEntries,
    savedCards,
    setSavedCards,
    removedCardIds,
    setRemovedCardIds,
    friendsList,
    blockedUsers,
    boardsSessions,
    profileStats,
    setProfileStats,
    updateBoardsSessions,
    handleUserIdentityUpdate,
    safeAsyncStorageSet,
    showOnboardingFlow,
    setShowOnboardingFlow,
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    onboardingData,
    setOnboardingData,
    showSignUpForm,
    setShowSignUpForm,
    preferencesRefreshKey,
  } = state;

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
  const needsEmailVerification =
    isAuthenticated && user && profile && profile.email_verified === false;

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
      console.log("This is running", needsOnboarding);
      setShowOnboardingFlow(true);
    }

    return (
      <ErrorBoundary>
        <OnboardingFlow
          onComplete={(data) => {
            console.log("Onboarding completed:", data);
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
            // This will return to the welcome screen
          }}
          onNavigateToSignUpForm={(accountType) => {
            console.log("Navigating to sign-up form");

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
    console.log("User not authenticated - showing SignInPage");
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
            onOpenPreferences={() => setShowPreferences(true)}
            onOpenCollaboration={handlers.handleCollaborationOpen}
            onOpenCollabPreferences={() => setShowCollabPreferences(true)}
            currentMode={currentMode}
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
      case "connections":
        return (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <Text style={{ fontSize: 18, color: "#6b7280" }}>
              Connections Page
            </Text>
            <Text style={{ fontSize: 14, color: "#9ca3af", marginTop: 8 }}>
              Coming Soon
            </Text>
          </View>
        );
      case "activity":
        return (
          <ActivityPage
            boardsSessions={boardsSessions}
            savedCards={savedCards}
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
            onScheduleFromSaved={(savedCard: any) => {
              console.log("Scheduling from saved:", savedCard);
              // Handle scheduling logic here
            }}
            onPurchaseFromSaved={(card: any, purchaseOption: any) => {
              console.log("Purchasing from saved:", card, purchaseOption);
              // Handle purchase logic here
            }}
            onRemoveFromCalendar={(entry: any) => {
              console.log("Removing from calendar:", entry);
              // Handle removal logic here
            }}
            onRemoveSaved={handlers.handleRemoveSavedCard}
            onShareCard={(card: any) => {
              console.log("Sharing card:", card);
              // Handle share logic here
            }}
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
          />
        );
      case "profile":
        return (
          <ProfilePage
            onSignOut={() => {
              console.log("App: Sign out called from ProfilePage");
              console.log("App: handleSignOut type:", typeof handleSignOut);
              if (handleSignOut) {
                handleSignOut();
              } else {
                console.error("App: handleSignOut is undefined!");
              }
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
              console.log("Main App: Profile Settings button clicked");
              console.log("Main App: Current userIdentity:", userIdentity);
              console.log("Main App: Current user from useAuthSimple:", user);
              console.log(
                "Main App: Current profile from useAuthSimple:",
                profile
              );
              console.log("Main App: Setting showProfileSettings to true");
              setShowProfileSettings(true);
              console.log("Main App: showProfileSettings set to true");
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
            onOpenPreferences={() => setShowPreferences(true)}
            onOpenCollaboration={handlers.handleCollaborationOpen}
            onOpenCollabPreferences={() => setShowCollabPreferences(true)}
            currentMode={currentMode}
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
    console.log(
      "User authenticated and completed onboarding - showing main app"
    );

    // Show PreferencesSheet as full screen if preferences are open
    if (showPreferences) {
      return (
        <ErrorBoundary>
          <PreferencesSheet
            onClose={() => setShowPreferences(false)}
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
      console.log(
        "Main App: Rendering ProfileSettings component with userIdentity:",
        userIdentity
      );
      console.log(
        "Main App: showProfileSettings is true, rendering ProfileSettings"
      );
      console.log(
        "Main App: userIdentity keys:",
        Object.keys(userIdentity || {})
      );
      console.log("Main App: userIdentity firstName:", userIdentity?.firstName);
      console.log("Main App: userIdentity lastName:", userIdentity?.lastName);
      console.log("Main App: userIdentity username:", userIdentity?.username);
      console.log(
        "Main App: userIdentity profileImage:",
        userIdentity?.profileImage
      );
      return (
        <ErrorBoundary>
          <ProfileSettings
            userIdentity={userIdentity}
            onUpdateIdentity={(updatedIdentity) => {
              console.log("Profile identity updated:", updatedIdentity);
              handleUserIdentityUpdate(updatedIdentity);
              setShowProfileSettings(false);
            }}
            onNavigateBack={() => setShowProfileSettings(false)}
          />
        </ErrorBoundary>
      );
    }

    return (
      <MobileFeaturesProvider>
        <NavigationProvider>
          <ErrorBoundary>
            <SafeAreaView style={styles.safeArea}>
              <StatusBar barStyle="dark-content" backgroundColor="white" />
              <View style={styles.container}>
                {/* Main Content */}
                <View style={styles.mainContent}>{renderCurrentPage()}</View>

                {/* Collaboration Module */}
                <CollaborationModule
                  isOpen={showCollaboration}
                  onClose={() => {
                    setShowCollaboration(false);
                    setPreSelectedFriend(null);
                  }}
                  currentMode={currentMode}
                  onModeChange={handlers.handleModeChange}
                  preSelectedFriend={preSelectedFriend}
                  boardsSessions={boardsSessions}
                  onUpdateBoardSession={(updatedBoard: any) =>
                    console.log("Update board session:", updatedBoard)
                  }
                  onCreateSession={(newSession: any) =>
                    console.log("Create session:", newSession)
                  }
                  onNavigateToBoard={(board: any, discussionTab?: string) =>
                    console.log("Navigate to board:", board, discussionTab)
                  }
                  availableFriends={[]}
                />

                {/* Bottom Navigation */}
                <View style={styles.bottomNavigation}>
                  <View style={styles.navigationContainer}>
                    <TouchableOpacity
                      onPress={() => {
                        console.log("Navigating to home");
                        setCurrentPage("home");
                      }}
                      style={styles.navItem}
                    >
                      <Ionicons
                        name="home"
                        size={24}
                        color={currentPage === "home" ? "#eb7825" : "#9CA3AF"}
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
                      <Ionicons
                        name="people"
                        size={24}
                        color={
                          currentPage === "connections" ? "#eb7825" : "#9CA3AF"
                        }
                      />
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
                        console.log("Navigating to activity");
                        setCurrentPage("activity");
                      }}
                      style={styles.navItem}
                    >
                      <Ionicons
                        name="calendar"
                        size={24}
                        color={
                          currentPage === "activity" ? "#eb7825" : "#9CA3AF"
                        }
                      />
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
                    <TouchableOpacity
                      onPress={() => {
                        console.log("Navigating to profile");
                        setCurrentPage("profile");
                      }}
                      style={styles.navItem}
                    >
                      <Ionicons
                        name="person"
                        size={24}
                        color={
                          currentPage === "profile" ? "#eb7825" : "#9CA3AF"
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
            </SafeAreaView>
          </ErrorBoundary>
        </NavigationProvider>
      </MobileFeaturesProvider>
    );
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f9fafb",
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
