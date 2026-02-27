import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useAppHandlers } from "../src/components/AppHandlers";
import { useAppState } from "../src/components/AppStateManager";
import { useFriends } from "../src/hooks/useFriends";
import CollaborationModule from "../src/components/CollaborationModule";
import ErrorBoundary from "../src/components/ErrorBoundary";
import HomePage from "../src/components/HomePage";
import DiscoverScreen from "../src/components/DiscoverScreen";
import { CollaborationSession, getInitials, Friend } from "../src/components/CollaborationSessions";
import PreferencesSheet from "../src/components/PreferencesSheet";
import ProfilePage from "../src/components/ProfilePage";
import SignInPage from "../src/components/SignInPage";
import TermsOfService from "../src/components/profile/TermsOfService";
import PrivacyPolicy from "../src/components/profile/PrivacyPolicy";
import AccountSettings from "../src/components/profile/AccountSettings";
import ProfileSettings from "../src/components/profile/ProfileSettings";
import OnboardingFlow from "../src/components/OnboardingFlow";
import ActivityPage from "../src/components/ActivityPage";
import LikesPage from "../src/components/LikesPage";
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
import { toastManager } from "../src/components/ui/Toast";
import { useBoardSession } from "../hooks/useBoardSession";
import { messagingService } from "../src/services/messagingService";
import { BoardMessageService } from "../src/services/boardMessageService";
import { muteService } from "../src/services/muteService";
import ShareModal from "../src/components/ShareModal";
import FeedbackModal from "../src/components/FeedbackModal";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "../src/config/queryClient";
import { SessionService } from "../src/services/sessionService";
import { BoardInviteService } from "../src/services/boardInviteService";
import { BoardSessionService } from "../src/services/boardSessionService";
import { supabase } from "../src/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../src/constants/colors";
import { debugService } from "../src/services/debugService";
import { DebugModal } from "../src/components/debug/DebugModal";
import { useDebugGesture } from "../src/hooks/useDebugGesture";

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
  const [showHelpButton, setShowHelpButton] = useState<boolean>(false);
  const [showWelcomeDialog, setShowWelcomeDialog] = useState<boolean>(false);
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);
  const [showDebugModal, setShowDebugModal] = useState<boolean>(false);
  const helpButtonDismissedRef = useRef<boolean>(false);
  const viewShotRef = useRef<any>(null);

  // Initialize debug service on mount
  useEffect(() => {
    debugService.initialize();
  }, []);

  // Setup 5-tap gesture to open debug modal
  const { handleTap: handleDebugTap } = useDebugGesture({
    onTrigger: () => {
      setShowDebugModal(true);
      console.log('🐛 Debug modal opened via tap gesture');
    },
    enabled: true,
  });

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

  // Transform boardsSessions to CollaborationSession format for the sessions bar
  const collaborationSessions: CollaborationSession[] = (boardsSessions || []).map((board: any) => {
    // Determine session type based on status and user participation
    let sessionType: 'active' | 'sent-invite' | 'received-invite' = 'active';
    if (board.status === 'pending') {
      // Check if user is the inviter or invitee
      const isCreator = board.creatorId === user?.id || board.created_by === user?.id;
      sessionType = isCreator ? 'sent-invite' : 'received-invite';
    }

    return {
      id: board.id || board.session_id,
      name: board.name,
      initials: getInitials(board.name),
      type: sessionType,
      participants: board.participants?.length || 0,
      createdAt: board.createdAt ? new Date(board.createdAt) : undefined,
      invitedBy: board.inviterProfile || undefined,
    };
  });

  // Load all sessions (including pending invites) on mount
  useEffect(() => {
    if (user?.id) {
      refreshAllSessions();
    }
  }, [user?.id]);

  // Get friends from useFriends hook for session creation
  const { friends: dbFriends, fetchFriends } = useFriends();
  
  // Fetch friends when component mounts
  useEffect(() => {
    if (user) {
      fetchFriends();
    }
  }, [user, fetchFriends]);

  // Log current page for debugging
  useEffect(() => {
    if (isLoadingAuth && !authTimeout) {
      console.log(`📄 Current screen: loading`);
    } else if (!isAuthenticated || (user && !profile && !isLoadingAuth)) {
      console.log(`📄 Current screen: sign-in/sign-up (showSignUpForm=${showSignUpForm})`);
    } else if (showOnboardingFlow || needsOnboarding) {
      console.log(`📄 Current screen: onboarding`);
    } else if (needsEmailVerification && !showSignUpForm) {
      console.log(`📄 Current screen: email-verification`);
    } else if (showPreferences) {
      console.log(`📄 Current screen: preferences`);
    } else if (showTermsOfService) {
      console.log(`📄 Current screen: terms-of-service`);
    } else if (showPrivacyPolicy) {
      console.log(`📄 Current screen: privacy-policy`);
    } else if (showAccountSettings) {
      console.log(`📄 Current screen: account-settings`);
    } else if (showProfileSettings) {
      console.log(`📄 Current screen: profile-settings`);
    } else {
      console.log(`📄 Current page: ${currentPage}`);
    }
  }, [
    currentPage,
    isAuthenticated,
    profile,
    isLoadingAuth,
    authTimeout,
    user,
    showOnboardingFlow,
    needsOnboarding,
    needsEmailVerification,
    showSignUpForm,
    showPreferences,
    showTermsOfService,
    showPrivacyPolicy,
    showAccountSettings,
    showProfileSettings,
  ]);

  // Transform friends to Friend format for session creation
  // dbFriends from useFriends has: id, friend_user_id, username, display_name, first_name, last_name, avatar_url
  const availableFriendsForSessions: Friend[] = (dbFriends || []).map((friend: any) => ({
    id: friend.friend_user_id || friend.id,
    name: friend.display_name || 
          (friend.first_name && friend.last_name ? `${friend.first_name} ${friend.last_name}` : null) ||
          friend.first_name ||
          friend.username || 
          'Unknown',
    username: friend.username,
    avatar: friend.avatar_url,
    status: 'offline' as const,
  }));

  // Session handlers for the CollaborationSessions bar
  const handleSessionSelect = (sessionId: string | null) => {
    if (sessionId) {
      const session = boardsSessions?.find((s: any) => s.id === sessionId || s.session_id === sessionId);
      if (session) {
        handlers.handleModeChange(session.name);
        setCurrentSessionId(sessionId);
      }
    }
  };

  const handleSoloSelect = () => {
    handlers.handleModeChange('solo');
    setCurrentSessionId(null);
  };

  // Helper function to refresh all sessions (active + pending)
  const refreshAllSessions = async () => {
    if (!user?.id) return;
    
    // Fetch all session types in parallel for better performance
    const [activeBoards, createdResult, invitedResult] = await Promise.all([
      BoardSessionService.fetchUserBoardSessions(user.id),
      supabase
        .from('collaboration_sessions')
        .select('*, session_participants(user_id, has_accepted)')
        .eq('created_by', user.id)
        .eq('status', 'pending'),
      supabase
        .from('collaboration_invites')
        .select(`
          session_id,
          invited_by,
          status,
          collaboration_sessions!inner(id, name, status, created_by, created_at),
          inviter:profiles!collaboration_invites_invited_by_fkey(id, username, first_name, last_name, avatar_url)
        `)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending'),
    ]);

    const createdPendingSessions = createdResult.data;
    const invitedSessions = invitedResult.data;
    
    // Transform pending created sessions
    // Only include sessions where the user is actually a participant (prevents ghost sessions
    // from failed creation attempts from appearing as duplicate pills)
    const pendingCreatedSessions = (createdPendingSessions || [])
      .filter((s: any) =>
        (s.session_participants || []).some((p: any) => p.user_id === user.id)
      )
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        creatorId: s.created_by,
        created_by: s.created_by,
        participants: s.session_participants || [],
        createdAt: s.created_at,
      }));
    
    // Transform pending/accepted invited sessions with inviter profile
    // Show as grey pills only if the user hasn't accepted yet (status = 'pending')
    // Once accepted, they will appear in activeBoards instead
    const pendingInvitedSessions = (invitedSessions || [])
      .filter((inv: any) => inv.status === 'pending')
      .map((inv: any) => {
        const inviterProfile = inv.inviter;
        const inviterName = inviterProfile 
          ? (inviterProfile.first_name && inviterProfile.last_name 
              ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
              : inviterProfile.first_name || inviterProfile.username || 'Someone')
          : 'Someone';
        
        return {
          id: inv.collaboration_sessions.id,
          name: inv.collaboration_sessions.name,
          status: 'pending',
          creatorId: inv.collaboration_sessions.created_by,
          created_by: inv.collaboration_sessions.created_by,
          invitedBy: inv.invited_by,
          inviterProfile: {
            id: inv.invited_by,
            name: inviterName,
            username: inviterProfile?.username,
            avatar: inviterProfile?.avatar_url,
          },
          createdAt: inv.collaboration_sessions.created_at,
        };
      });
    
    // Combine and deduplicate by id
    const allSessions = [...activeBoards, ...pendingCreatedSessions, ...pendingInvitedSessions];
    const uniqueSessions = allSessions.reduce((acc: any[], session: any) => {
      if (!acc.find((s: any) => s.id === session.id)) {
        acc.push(session);
      }
      return acc;
    }, []);
    
    updateBoardsSessions(uniqueSessions);
  };

  const handleCreateSession = async (sessionName: string, selectedFriends: Friend[] = []) => {
    if (!user?.id) return;
    setIsCreatingSession(true);
    let createdSessionId: string | null = null;
    try {
      // Check for real duplicate: any session where user is an accepted participant with this name
      const { data: participations } = await supabase
        .from('session_participants')
        .select('session_id, collaboration_sessions!inner(id, name)')
        .eq('user_id', user.id)
        .eq('has_accepted', true);

      const hasDuplicate = (participations || []).some((p: any) => {
        const s = Array.isArray(p.collaboration_sessions) ? p.collaboration_sessions[0] : p.collaboration_sessions;
        return s?.name?.toLowerCase() === sessionName.trim().toLowerCase();
      });

      if (hasDuplicate) {
        toastManager.error('A collaboration session already exists with that name.');
        return;
      }

      // Clean up any ghost sessions with this name (created by user but no participant record)
      // These accumulate from previous failed creation attempts
      const { data: ghostSessions } = await supabase
        .from('collaboration_sessions')
        .select('id')
        .eq('created_by', user.id)
        .ilike('name', sessionName.trim());

      if (ghostSessions && ghostSessions.length > 0) {
        await supabase
          .from('collaboration_sessions')
          .delete()
          .in('id', ghostSessions.map((s: any) => s.id));
      }

      // Create the collaboration session (matching CreateTab.tsx pattern)
      // Status starts as 'pending' until participants accept
      const { data: session, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName,
          created_by: user.id,
          status: 'pending',
        })
        .select()
        .single();

      if (sessionError) throw sessionError;
      createdSessionId = session.id;

      // Add creator as participant (auto-accepted)
      const { error: participantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: session.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString(),
        });

      if (participantError) throw participantError;

      // Add selected friends as participants and send invites
      for (const friend of selectedFriends) {
        const friendUserId = friend.id;

        // Get friend's email from their profile
        const { data: friendProfile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', friendUserId)
          .single();

        const friendEmail = friendProfile?.email;

        // Add as participant (not accepted yet)
        const { error: friendParticipantError } = await supabase
          .from('session_participants')
          .insert({
            session_id: session.id,
            user_id: friendUserId,
            has_accepted: false,
          });

        if (friendParticipantError) {
          console.error(`Error adding friend ${friend.name} as participant:`, friendParticipantError);
          continue;
        }

        // Create invite for the friend
        const { data: inviteData, error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: session.id,
            inviter_id: user.id,
            invited_user_id: friendUserId,
            status: 'pending',
          })
          .select('id')
          .single();

        if (inviteError) {
          console.error(`Error creating invite for ${friend.name}:`, inviteError);
          continue;
        }

        // Send email and push notification via Edge Function
        if (friendEmail && inviteData) {
          try {
            await supabase.functions.invoke('bright-responder', {
              body: {
                inviterId: user.id,
                invitedUserId: friendUserId,
                invitedUserEmail: friendEmail,
                sessionId: session.id,
                sessionName: sessionName,
                inviteId: inviteData.id,
              },
            });
          } catch (emailErr) {
            console.error(`Failed to send invite email to ${friend.name}:`, emailErr);
            // Don't fail the whole process if email fails
          }
        }
      }

      // Refresh all sessions (active + pending)
      await refreshAllSessions();
      
      // Show success toast
      const friendCount = selectedFriends.length;
      const message = friendCount > 0 
        ? `Session "${sessionName}" created! Invites sent to ${friendCount} friend${friendCount > 1 ? 's' : ''}.`
        : `Session "${sessionName}" created successfully!`;
      toastManager.success(message);
      
      // Switch to the new session
      handlers.handleModeChange(sessionName);
      setCurrentSessionId(session.id);
    } catch (error) {
      console.error('Error creating session:', error);
      // Roll back the ghost session if it was inserted before the failure
      if (createdSessionId) {
        supabase.from('collaboration_sessions').delete().eq('id', createdSessionId).then(({ error: deleteError }) => {
          if (deleteError) console.error('Error cleaning up failed session:', deleteError);
        });
      }
      toastManager.error('Failed to create session. Please try again.');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleAcceptInvite = async (sessionId: string) => {
    if (!user?.id) return;
    try {
      // First, find the invite by session_id and user_id
      const { data: invite, error: fetchError } = await supabase
        .from('collaboration_invites')
        .select(`
          id,
          session_id,
          invited_by,
          invited_user_id,
          collaboration_sessions!inner(name)
        `)
        .eq('session_id', sessionId)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending')
        .single();

      if (fetchError || !invite) {
        console.error('Error fetching invite:', fetchError);
        toastManager.error('Invite not found.');
        return;
      }

      // Get session name from the join
      const sessionData = invite.collaboration_sessions as any;
      const sessionName = Array.isArray(sessionData)
        ? (sessionData[0] as any)?.name
        : (sessionData as any)?.name || 'Session';

      // Update invite status to accepted
      const { error: updateError } = await supabase
        .from('collaboration_invites')
        .update({ status: 'accepted' })
        .eq('id', invite.id)
        .eq('invited_user_id', user.id);

      if (updateError) {
        console.error('Error updating invite:', updateError);
        toastManager.error('Failed to accept invite.');
        return;
      }

      // Add/update user as participant with has_accepted = true
      const { error: participantError } = await supabase
        .from('session_participants')
        .upsert(
          {
            session_id: sessionId,
            user_id: user.id,
            has_accepted: true,
            joined_at: new Date().toISOString(),
          },
          {
            onConflict: 'session_id,user_id',
          }
        );

      if (participantError) {
        console.error('Error adding participant:', participantError);
      }

      // Check membership count to determine if session should become active
      const { data: allParticipants, error: participantsError } = await supabase
        .from('session_participants')
        .select('has_accepted, user_id')
        .eq('session_id', sessionId);

      if (!participantsError && allParticipants) {
        const acceptedCount = allParticipants.filter((p: any) => p.has_accepted === true).length;
        
        // If at least 1 member has accepted, session becomes active
        if (acceptedCount >= 1) {
          const { error: sessionUpdateError } = await supabase
            .from('collaboration_sessions')
            .update({ status: 'active' })
            .eq('id', sessionId);

          if (sessionUpdateError) {
            console.error('Error updating session status:', sessionUpdateError);
          }
        }
      }

      // Create preference record for the accepting user
      const { error: preferencesError } = await supabase
        .from('board_session_preferences')
        .insert({
          session_id: sessionId,
          user_id: user.id,
          budget_min: 0,
          budget_max: 1000,
          categories: [],
          travel_mode: 'walking',
          travel_constraint_type: 'time',
          travel_constraint_value: 30,
        });

      if (preferencesError && preferencesError.code !== '23505') {
        // 23505 is unique violation - preference already exists
        console.error('Error creating preferences:', preferencesError);
      }

      // Refresh all sessions
      await refreshAllSessions();
      toastManager.success(`Joined "${sessionName}" successfully!`);
    } catch (error) {
      console.error('Error accepting invite:', error);
      toastManager.error('Failed to accept invite.');
    }
  };

  const handleDeclineInvite = async (sessionId: string) => {
    if (!user?.id) return;
    try {
      // Find the invite by session_id and user_id
      const { data: invite, error: fetchError } = await supabase
        .from('collaboration_invites')
        .select(`
          id,
          session_id,
          invited_by,
          collaboration_sessions!inner(name)
        `)
        .eq('session_id', sessionId)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending')
        .single();

      if (fetchError || !invite) {
        console.error('Error fetching invite:', fetchError);
        toastManager.error('Invite not found.');
        return;
      }

      // Update invite status to declined
      const { error: updateError } = await supabase
        .from('collaboration_invites')
        .update({ status: 'declined' })
        .eq('id', invite.id)
        .eq('invited_user_id', user.id);

      if (updateError) {
        console.error('Error updating invite:', updateError);
        toastManager.error('Failed to decline invite.');
        return;
      }

      // Remove user from session_participants if they were added
      const { error: removeParticipantError } = await supabase
        .from('session_participants')
        .delete()
        .eq('session_id', sessionId)
        .eq('user_id', user.id);

      if (removeParticipantError) {
        console.error('Error removing participant:', removeParticipantError);
      }

      // Refresh all sessions
      await refreshAllSessions();
      toastManager.success('Invite declined.');
    } catch (error) {
      console.error('Error declining invite:', error);
      toastManager.error('Failed to decline invite.');
    }
  };

  const handleCancelInvite = async (sessionId: string) => {
    if (!user?.id) return;
    try {
      // Cancel sent invite - remove the session if creator
      const { error } = await supabase
        .from('collaboration_sessions')
        .delete()
        .eq('id', sessionId)
        .eq('created_by', user.id);
      
      if (error) throw error;
      
      // Refresh all sessions
      await refreshAllSessions();
      toastManager.success('Invite cancelled.');
    } catch (error) {
      console.error('Error cancelling invite:', error);
      toastManager.error('Failed to cancel invite.');
    }
  };

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
        coachMapCurrentTarget === "collaborateButton" ||
        coachMapCurrentTarget === "sessionPills")
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

  // Fetch unread message count on app load (excluding muted users)
  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!isAuthenticated || !user?.id) {
        setTotalUnreadMessages(0);
        return;
      }

      try {
        // Get muted user IDs first
        const { data: mutedUserIds } = await muteService.getMutedUserIds();
        const mutedSet = new Set(mutedUserIds || []);

        const { conversations, error } =
          await messagingService.getConversations(user.id);
        if (!error && conversations) {
          const totalUnread = conversations.reduce(
            (sum, conv) => {
              // Check if the OTHER participant (not current user) is muted
              const otherParticipant = conv.participants?.find(
                (p: any) => p.user_id !== user.id
              );
              const isMuted = otherParticipant ? mutedSet.has(otherParticipant.user_id) : false;
              return sum + (isMuted ? 0 : (conv.unread_count || 0));
            },
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

  // Show floating help button for new users (if not dismissed)
  useEffect(() => {
    const checkHelpButtonStatus = async () => {
      if (
        isAuthenticated &&
        user &&
        profile &&
        profile.has_completed_onboarding === true &&
        !helpButtonDismissedRef.current
      ) {
        try {
          const dismissed = await AsyncStorage.getItem(
            "mingla_help_button_dismissed"
          );
          if (dismissed !== "true") {
            // Show help button after a delay (after coach map might appear)
            const timer = setTimeout(() => {
              setShowHelpButton(true);
            }, 1500);
            return () => clearTimeout(timer);
          }
        } catch (error) {
          console.error("Error checking help button status:", error);
        }
      }
    };

    checkHelpButtonStatus();
  }, [isAuthenticated, user, profile]);

  // Function to dismiss the help button permanently
  const dismissHelpButton = async () => {
    try {
      await AsyncStorage.setItem("mingla_help_button_dismissed", "true");
      helpButtonDismissedRef.current = true;
      setShowHelpButton(false);
    } catch (error) {
      console.error("Error dismissing help button:", error);
    }
  };

  // Function to handle starting the tour
  const handleStartTour = async () => {
    setShowWelcomeDialog(false);
    // Start the coach map tour
    setShowCoachMap(true);
  };

  // ---- Feedback Modal Logic ----
  const FEEDBACK_STORAGE_KEY = "mingla_feedback_state";
  const FEEDBACK_PROMPT_DELAY_DAYS = 3; // Days after install to first prompt
  const FEEDBACK_REPROMPT_DAYS = 30; // Days between re-prompts after dismissal

  // Check if it's time to show the feedback modal
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const checkFeedbackPrompt = async () => {
      try {
        const raw = await AsyncStorage.getItem(FEEDBACK_STORAGE_KEY);
        const feedbackState = raw ? JSON.parse(raw) : null;

        // If user already submitted feedback, don't prompt again
        if (feedbackState?.submitted) return;

        const now = Date.now();
        const firstLaunch = feedbackState?.firstLaunch || now;

        // Save first launch time if not set
        if (!feedbackState?.firstLaunch) {
          await AsyncStorage.setItem(
            FEEDBACK_STORAGE_KEY,
            JSON.stringify({ firstLaunch: now })
          );
        }

        const daysSinceInstall = (now - firstLaunch) / (1000 * 60 * 60 * 24);
        const lastDismissed = feedbackState?.lastDismissed || 0;
        const daysSinceDismissed =
          (now - lastDismissed) / (1000 * 60 * 60 * 24);

        // Show if enough days since install AND enough days since last dismissal
        if (
          daysSinceInstall >= FEEDBACK_PROMPT_DELAY_DAYS &&
          daysSinceDismissed >= FEEDBACK_REPROMPT_DAYS
        ) {
          // Small delay so app settles before showing modal
          setTimeout(() => setShowFeedbackModal(true), 2000);
        }
      } catch (error) {
        console.error("Error checking feedback prompt:", error);
      }
    };

    checkFeedbackPrompt();
  }, [isAuthenticated, user?.id]);

  const handleFeedbackSubmit = async (feedback: {
    rating: number;
    message: string;
    category: string;
  }) => {
    try {
      // Store feedback in Supabase
      const { error } = await supabase.from("app_feedback").insert({
        user_id: user?.id,
        rating: feedback.rating,
        message: feedback.message,
        category: feedback.category,
        platform: "mobile",
      });

      if (error) {
        // If table doesn't exist yet, just log and continue gracefully
        console.warn("Could not save feedback to database:", error.message);
      }

      // Mark as submitted in AsyncStorage
      const raw = await AsyncStorage.getItem(FEEDBACK_STORAGE_KEY);
      const feedbackState = raw ? JSON.parse(raw) : {};
      await AsyncStorage.setItem(
        FEEDBACK_STORAGE_KEY,
        JSON.stringify({ ...feedbackState, submitted: true })
      );

      toastManager.success("Thanks for your feedback!");
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toastManager.error("Failed to submit feedback. Please try again.");
      throw error;
    }
  };

  const handleFeedbackClose = async () => {
    setShowFeedbackModal(false);
    try {
      const raw = await AsyncStorage.getItem(FEEDBACK_STORAGE_KEY);
      const feedbackState = raw ? JSON.parse(raw) : {};
      // Only update dismissal time if not already submitted
      if (!feedbackState.submitted) {
        await AsyncStorage.setItem(
          FEEDBACK_STORAGE_KEY,
          JSON.stringify({ ...feedbackState, lastDismissed: Date.now() })
        );
      }
    } catch (error) {
      console.error("Error saving feedback dismissal:", error);
    }
  };

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
  // jsieidjdj

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
            // Reset sign-up form flag to ensure we show welcome screen
            setShowSignUpForm(false);
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
            collaborationSessions={collaborationSessions}
            selectedSessionId={currentSessionId}
            onSessionSelect={handleSessionSelect}
            onSoloSelect={handleSoloSelect}
            onCreateSession={handleCreateSession}
            onAcceptInvite={handleAcceptInvite}
            onDeclineInvite={handleDeclineInvite}
            onCancelInvite={handleCancelInvite}
            availableFriends={availableFriendsForSessions}
            isCreatingSession={isCreatingSession}
          />
        );
      case "discover":
        return (
          <DiscoverScreen
            onAddFriend={() => {
              // Navigate to connections or show add friend modal
              setCurrentPage("connections");
            }}
            accountPreferences={{
              currency: accountPreferences?.currency || "USD",
              measurementSystem:
                (accountPreferences?.measurementSystem as
                  | "Metric"
                  | "Imperial") || "Imperial",
            }}
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
      case "likes":
        return (
          <LikesPage
            isLoadingSavedCards={isLoadingSavedCards}
            calendarEntries={calendarEntries}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            onScheduleFromSaved={handlers.handleScheduleFromSaved}
            onPurchaseFromSaved={(card: any, purchaseOption: any) => {
              console.log("Purchasing from saved:", card, purchaseOption);
              // Handle purchase logic here
            }}
            onRemoveFromCalendar={handlers.handleRemoveFromCalendar}
            onShareCard={handlers.handleShareCard}
            onAddToCalendar={(entry: any) => {
              console.log("Adding to calendar:", entry);
              // Handle add to calendar logic here
            }}
            onShowQRCode={(entryId: string) => {
              console.log("Showing QR code for:", entryId);
              // Handle show QR code logic here
            }}
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
            onSendInvite={async (sessionId: string, users: any[]) => {
              console.log(
                "Sending invite to session:",
                sessionId,
                "users:",
                users
              );
              
              if (!user?.id) {
                Alert.alert("Error", "You must be logged in to send invites");
                return;
              }
              
              // Extract friend IDs from the users array
              const friendIds = users.map(u => u.id);
              
              // Send the invites using BoardInviteService
              const result = await BoardInviteService.sendFriendInvites(
                sessionId,
                friendIds,
                user.id
              );
              
              if (result.success) {
                Alert.alert(
                  "Invites Sent",
                  `Successfully sent ${users.length} invite${users.length > 1 ? 's' : ''}`
                );
              } else {
                console.error("Failed to send invites:", result.errors);
                Alert.alert(
                  "Error",
                  result.errors?.join('\n') || "Failed to send invites"
                );
              }
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
            onExitBoard={(exitedBoardId: string, exitedBoardName: string) => {
              // OPTIMISTIC UPDATE: Remove board from list immediately
              if (exitedBoardId && boardsSessions) {
                const updatedBoards = boardsSessions.filter(
                  (board: any) =>
                    board.id !== exitedBoardId &&
                    (board as any).session_id !== exitedBoardId
                );
                updateBoardsSessions(updatedBoards);
              }

              // Update mode if this was the active session
              if (exitedBoardName && currentMode === exitedBoardName) {
                state.setCurrentMode("solo");
              }
            }}
          />
        );
      case "board-view":
        return boardViewSessionId ? (
          <BoardViewScreen
            sessionId={boardViewSessionId}
            onBack={() => {
              setCurrentPage("likes");
              // Keep boardViewSessionId set so Saved tab can show board-specific cards
              // It will be cleared when user navigates away from likes page or selects a different board
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
            onNavigateToActivity={handlers.handleNavigateToActivity}
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
            onUnblockUser={handlers.handleUnblockUser}
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
            collaborationSessions={collaborationSessions}
            selectedSessionId={currentSessionId}
            onSessionSelect={handleSessionSelect}
            onSoloSelect={handleSoloSelect}
            onCreateSession={handleCreateSession}
            onAcceptInvite={handleAcceptInvite}
            onDeclineInvite={handleDeclineInvite}
            onCancelInvite={handleCancelInvite}
            availableFriends={availableFriendsForSessions}
            isCreatingSession={isCreatingSession}
          />
        );
    }
  };

  // Ensure any full-screen profile overlays are closed when switching tabs/pages
  const closeProfileOverlays = () => {
    setShowProfileSettings(false);
    setShowAccountSettings(false);
    setShowPrivacyPolicy(false);
    setShowTermsOfService(false);
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
          <PreferencesSheet
            onClose={() => {
              setShowCollabPreferences(false);
            }}
            onSave={handlers.handleCollabPreferencesSave}
            sessionId={currentSessionId}
            sessionName={currentMode ?? "solo"}
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
                    {/* Invisible tap zone: tap 5 times quickly to open debug console */}
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={handleDebugTap}
                      style={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44, zIndex: 9999 }}
                    />
                    <View style={styles.container}>
                      {/* Main Content */}
                      <View style={styles.mainContent}>
                        {showTermsOfService ? (
                          <TermsOfService onNavigateBack={() => setShowTermsOfService(false)} />
                        ) : showPrivacyPolicy ? (
                          <PrivacyPolicy onNavigateBack={() => setShowPrivacyPolicy(false)} />
                        ) : showAccountSettings ? (
                          <AccountSettings />
                        ) : showProfileSettings ? (
                          <ProfileSettings onNavigateBack={() => setShowProfileSettings(false)} />
                        ) : (
                          renderCurrentPage()
                        )}
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
                              closeProfileOverlays();
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
                              Explore
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              console.log("Navigating to discover");
                              closeProfileOverlays();
                              setCurrentPage("discover");
                            }}
                            style={styles.navItem}
                          >
                            <Ionicons
                              name="compass-outline"
                              size={24}
                              color={
                                currentPage === "discover" ? "#eb7825" : "#9CA3AF"
                              }
                            />
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "discover"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              Discover
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              console.log("Navigating to connections");
                              closeProfileOverlays();
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
                              Connect
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              closeProfileOverlays();
                              setCurrentPage("likes");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="heart-outline"
                                size={24}
                                color={
                                  currentPage === "likes"
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
                                currentPage === "likes"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              Likes
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
                              closeProfileOverlays();
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
                        setShowCoachMap(false);
                        setCoachMapCurrentTarget(null);
                        // Update status in background — don't block UI
                        updateCoachMapTourStatus("completed");
                      }}
                      onSkip={async () => {
                        setShowCoachMap(false);
                        setCoachMapCurrentTarget(null);
                        // Update status in background — don't block UI
                        updateCoachMapTourStatus("skipped");
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

                    {/* Feedback Modal */}
                    <FeedbackModal
                      visible={showFeedbackModal}
                      onClose={handleFeedbackClose}
                      onSubmitFeedback={handleFeedbackSubmit}
                    />

                    {/* Floating Help Button */}
                    {showHelpButton && !showCoachMap && (
                      <View style={styles.floatingButtonContainer}>
                        {/* Dismiss X button */}
                        <TouchableOpacity
                          style={styles.dismissButton}
                          onPress={dismissHelpButton}
                        >
                          <Ionicons name="close" size={12} color="white" />
                        </TouchableOpacity>
                        {/* Main help button */}
                        <TouchableOpacity
                          style={styles.floatingButton}
                          onPress={() => setShowWelcomeDialog(true)}
                        >
                          <Feather name="help-circle" size={24} color="white" />
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Welcome Dialog */}
                    <Modal
                      visible={showWelcomeDialog}
                      transparent={true}
                      animationType="fade"
                      onRequestClose={() => setShowWelcomeDialog(false)}
                    >
                      <View style={styles.modalOverlay}>
                        <View style={styles.dialogContainer}>
                          {/* Logo */}
                          <Image
                            source={require("../assets/mingla_logo.png")}
                            style={styles.dialogLogo}
                            resizeMode="contain"
                          />

                          {/* Title with wave emoji */}
                          <View style={styles.dialogTitleContainer}>
                            <Text style={styles.dialogTitle}>
                              Welcome to Mingla
                            </Text>
                            <Text style={styles.waveEmoji}>👋</Text>
                          </View>

                          {/* Description */}
                          <Text style={styles.dialogDescription}>
                            Let's show you the essentials (takes 30 seconds)
                          </Text>

                          {/* Buttons */}
                          <View style={styles.dialogButtonsContainer}>
                            <TouchableOpacity
                              style={styles.startTourButton}
                              onPress={handleStartTour}
                            >
                              <Text style={styles.startTourButtonText}>
                                Start tour
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.skipButton}
                              onPress={() => setShowWelcomeDialog(false)}
                            >
                              <Text style={styles.skipButtonText}>Skip</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </Modal>
                  </SafeAreaView>
                </ErrorBoundary>
              </NavigationProvider>
            </MobileFeaturesProvider>
          </RecommendationsProvider>
        </CardsCacheProvider>
        <ToastContainer />
        <DebugModal
          isVisible={showDebugModal}
          onClose={() => setShowDebugModal(false)}
          viewShotRef={viewShotRef}
        />
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
    justifyContent: "space-evenly",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
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
  // Floating Help Button styles
  floatingButtonContainer: {
    position: "absolute",
    bottom: 130,
    right: 24,
  },
  floatingButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  dismissButton: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#6b7280",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    borderWidth: 2,
    borderColor: "white",
  },
  // Welcome Dialog styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialogContainer: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: 32,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  dialogLogo: {
    width: 80,
    height: 80,
    marginBottom: 24,
  },
  dialogTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  dialogTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#111827",
  },
  waveEmoji: {
    fontSize: 22,
  },
  dialogDescription: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
  },
  dialogButtonsContainer: {
    width: "100%",
    gap: 12,
  },
  startTourButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  startTourButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  skipButton: {
    backgroundColor: "transparent",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  skipButtonText: {
    color: "#374151",
    fontSize: 16,
    fontWeight: "500",
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
