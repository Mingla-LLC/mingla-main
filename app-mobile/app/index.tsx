import * as Sentry from "@sentry/react-native";
import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { vs, ms, s } from "../src/utils/responsive";
import { useAppLayout } from "../src/hooks/useAppLayout";
import * as Linking from "expo-linking";
import { useAppHandlers } from "../src/components/AppHandlers";
import { useAppState } from "../src/components/AppStateManager";
import { useFriends } from "../src/hooks/useFriends";
import ErrorBoundary from "../src/components/ErrorBoundary";
import HomePage from "../src/components/HomePage";
import DiscoverScreen from "../src/components/DiscoverScreen";
import { CollaborationSession, getInitials, Friend } from "../src/components/CollaborationSessions";
import PreferencesSheet from "../src/components/PreferencesSheet";
import ProfilePage from "../src/components/ProfilePage";
import WelcomeScreen from "../src/components/signIn/WelcomeScreen";
import AccountSettings from "../src/components/profile/AccountSettings";

import ViewFriendProfileScreen from "../src/components/profile/ViewFriendProfileScreen";
import OnboardingLoader from "../src/components/onboarding/OnboardingLoader";
import LikesPage from "../src/components/LikesPage";
import SavedExperiencesPage from "../src/components/SavedExperiencesPage";
import ConnectionsPage from "../src/components/ConnectionsPage";
import { NavigationProvider } from "../src/contexts/NavigationContext";
import { MobileFeaturesProvider } from "../src/components/MobileFeaturesProvider";
import { CardsCacheProvider } from "../src/contexts/CardsCacheContext";
import { RecommendationsProvider } from "../src/contexts/RecommendationsContext";
import { ToastContainer } from "../src/components/ui/ToastContainer";
import { toastManager } from "../src/components/ui/Toast";
import { ToastProvider } from "../src/components/ToastManager";
import { useAppStore } from "../src/store/appStore";
import { useBoardSession } from "../src/hooks/useBoardSession";
import { messagingService } from "../src/services/messagingService";
import { BoardMessageService } from "../src/services/boardMessageService";
import { muteService } from "../src/services/muteService";
import ShareModal from "../src/components/ShareModal";

import PostExperienceModal from "../src/components/PostExperienceModal";
import { usePostExperienceCheck } from "../src/hooks/usePostExperienceCheck";
import { CoachMarkProvider, useCoachMarkContext } from "../src/contexts/CoachMarkContext";
import SpotlightOverlay from "../src/components/SpotlightOverlay";
import PaywallScreen from "../src/components/PaywallScreen";
import { configureRevenueCat, loginRevenueCat, logoutRevenueCat } from "../src/services/revenueCatService";
import {
  initializeOneSignal,
  loginToOneSignal,
  logoutOneSignal,
  onForegroundNotification,
  onNotificationClicked,
} from "../src/services/oneSignalService";
import { initializeAppsFlyer, setAppsFlyerUserId, registerAppsFlyerDevice, logAppsFlyerEvent } from "../src/services/appsFlyerService";
import { useCustomerInfoListener } from "../src/hooks/useRevenueCat";
import { useTrialExpiryTracking } from "../src/hooks/useSubscription";
import * as SplashScreen from 'expo-splash-screen';
import AnimatedSplashScreen from '../src/components/AnimatedSplashScreen';
import AppLoadingScreen from '../src/components/AppLoadingScreen';


import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "../src/config/queryClient";
import { SessionService } from "../src/services/sessionService";
import { BoardInviteService } from "../src/services/boardInviteService";
import { BoardSessionService } from "../src/services/boardSessionService";
import { supabase } from "../src/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../src/constants/colors";
import { logger } from "../src/utils/logger";
// V2: inAppNotificationService is no longer imported — server-synced notifications
// are handled by useNotifications hook + Supabase Realtime. The old service file
// stays in place but is no longer referenced from the app root.
import { mixpanelService } from "../src/services/mixpanelService";
import { useTranslation } from 'react-i18next';
import i18n from '../src/i18n';
import { persistLanguage } from '../src/i18n';
import { useForegroundRefresh } from "../src/hooks/useForegroundRefresh";
import RealtimeSubscriptions from "../src/components/RealtimeSubscriptions";
import * as friendsService from "../src/services/friendsService";
import { parseDeepLink, executeDeepLink } from "../src/services/deepLinkService";
import {
  dismissCollaborationInviteNotifications,
  type ServerNotification,
} from "../src/hooks/useNotifications";

const TAB_BAR_ICON_SIZE = ms(20);

/** Wraps the tab bar and disables it when the coach mark is loading, pending, or active */
function CoachMarkNavigationGate({ layout, children }: { layout: any; children: React.ReactNode }) {
  const { isCoachLoading, isCoachPending, isCoachActive } = useCoachMarkContext();
  const locked = isCoachLoading || isCoachPending || isCoachActive;
  return (
    <View
      style={[
        styles.bottomNavigation,
        { paddingBottom: layout.bottomNavPadding },
      ]}
      pointerEvents={locked ? 'none' : 'auto'}
    >
      {children}
    </View>
  );
}

// ── Sentry ──────────────────────────────────────────────────────────────────
// Initialize BEFORE any React component renders. Sentry's native module
// installs a global NSException handler that captures the crash details
// (module name, method, exception reason) before the process terminates.
// This is the ONLY way to identify unsymbolicated native crashes without Xcode.
Sentry.init({
  dsn: 'https://5bb11663dddc2efc612498d7a14b70f4@o4511136062701568.ingest.us.sentry.io/4511136064012288',
  enableNativeFramesTracking: true,
  enableAutoSessionTracking: true,
  // Capture 100% of errors (we need every crash right now)
  tracesSampleRate: 0,
  // Attach breadcrumbs from our logger
  maxBreadcrumbs: 50,
  enabled: !__DEV__, // Only in production builds
});
// ─────────────────────────────────────────────────────────────────────────────

function AppContent() {
  const state = useAppState();
  const handlers = useAppHandlers(state);
  const layout = useAppLayout();
  const { t } = useTranslation(['navigation', 'common']);

  // CRITICAL: Destructure immediately after useAppState(). useEffect dependency
  // arrays below reference these variables during render. If the destructuring
  // is moved below any useEffect that depends on these values, Babel's
  // const→var transform causes var-hoisting, making deps permanently undefined,
  // silently breaking OneSignal, RevenueCat, AppsFlyer, and notification routing.
  const {
    isAuthenticated,
    isLoadingAuth,
    _hasHydrated,
    user,
    profile,
    handleSignOut,
    handleGoogleSignIn,
    handleAppleSignIn,
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
    updateBoardsSessions,
    handleUserIdentityUpdate,
    safeAsyncStorageSet,
    isLoadingSavedCards,
    isSavedCardsError,
    refetchSavedCards,
    isLoadingCalendarEntries,
    showOnboardingFlow,
    setShowOnboardingFlow,
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    onboardingData,
    setOnboardingData,
  } = state;

  // Seed from storage so the pill bar highlights immediately on first render.
  // initialSessionId is loaded from AsyncStorage in AppStateManager alongside currentMode.
  // useState only captures the initial value at first render; the effect below syncs
  // the stored value once it arrives (it's null until AsyncStorage resolves).
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    initialSessionId
  );
  useEffect(() => {
    if (initialSessionId !== null && currentSessionId === null) {
      setCurrentSessionId(initialSessionId);
    }
  }, [initialSessionId, currentSessionId]);
  const [totalUnreadMessages, setTotalUnreadMessages] = useState<number>(0);
  const [totalUnreadBoardMessages, setTotalUnreadBoardMessages] =
    useState<number>(0);
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);
  const [showPaywall, setShowPaywall] = useState<boolean>(false);
  const [pendingSessionOpen, setPendingSessionOpen] = useState<string | null>(null);
  const [pendingOpenDmUserId, setPendingOpenDmUserId] = useState<string | null>(null);
  const [likesNavData, setLikesNavData] = useState<{ activeTab?: 'saved' | 'calendar' } | null>(null);
  // Pending experience reviews — shows review modal after scheduled experiences
  const { pendingReview, showReviewModal, dismissReview, recheckPending } = usePostExperienceCheck();
  const viewShotRef = useRef<any>(null);
  // V2: pending deep link from push notification received before auth
  const pendingDeepLinkRef = useRef<string | null>(null);
  // Ref that always holds the current user ID. Allows notification listeners
  // (registered once with [] deps) to read the latest auth state without
  // stale closures — setters from useState are stable, but derived values
  // like isAuthenticated are not.
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;
  // Generation counter for refreshAllSessions() concurrency protection.
  // Declared here (top of component) so it persists stably across renders and is
  // visible to any future developer extracting refreshAllSessions to a custom hook.
  const refreshGenerationRef = useRef(0);

  // Initialize Mixpanel on mount + track cold open
  const lastActiveRef = useRef(Date.now());
  useEffect(() => {
    mixpanelService.initialize().then(() => {
      mixpanelService.trackAppOpened({ source: 'cold' });
    });
  }, []);

  // ── RevenueCat ─────────────────────────────────────────────────────────────
  // Configure the SDK once at mount. Pass the Supabase user ID if already known
  // (persisted session on cold start) — avoids an anonymous → identified merge.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    configureRevenueCat(user?.id ?? null);
  }, []); // intentionally once

  // Log in / out of RevenueCat whenever the Supabase auth state changes.
  useEffect(() => {
    if (isLoadingAuth) return;
    if (user?.id) {
      loginRevenueCat(user.id).catch((err) =>
        console.warn("[RevenueCat] loginRevenueCat failed:", err)
      );
    } else {
      logoutRevenueCat().catch(() => {});
    }
  }, [user?.id, isLoadingAuth]);

  // Keep React Query's CustomerInfo cache in sync with RC's real-time updates.
  useCustomerInfoListener();
  // ───────────────────────────────────────────────────────────────────────────

  // ── OneSignal ──────────────────────────────────────────────────────────────
  // Initialize SDK once at mount (does NOT request permission yet).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    initializeOneSignal();
  }, []); // intentionally once

  // Link device to user identity (no permission dialog).
  // Permission is deferred to after the coach mark tour (ORCH-0349).
  // Logout path: only fires after isLoadingAuth is false, to prevent
  // premature logout while auth is still resolving a cached session.
  useEffect(() => {
    if (user?.id) {
      console.log('[OneSignal] Calling loginToOneSignal for:', user.id);
      loginToOneSignal(user.id).catch((err) =>
        console.warn('[OneSignal] loginToOneSignal failed:', err)
      );
    } else if (!isLoadingAuth) {
      logoutOneSignal();
    }
  }, [user?.id, isLoadingAuth]);
  // ───────────────────────────────────────────────────────────────────────────

  // ── AppsFlyer ──────────────────────────────────────────────────────────────
  // Initialize once at mount — tracks installs and attribution automatically.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    initializeAppsFlyer();
  }, []); // intentionally once

  // Set the AppsFlyer customer user ID when the user signs in.
  // Fire af_complete_registration (first-time) or af_login (returning user).
  const afEventFiredRef = useRef(false);
  useEffect(() => {
    if (isLoadingAuth) return;
    if (user?.id) {
      setAppsFlyerUserId(user.id);
      registerAppsFlyerDevice(user.id);

      // Fire attribution event once per auth session
      if (!afEventFiredRef.current && profile) {
        afEventFiredRef.current = true;
        const method = (user as any).app_metadata?.provider === 'apple' ? 'apple' : 'google';
        if (profile.has_completed_onboarding) {
          logAppsFlyerEvent('af_login', { af_login_method: method });
        } else {
          logAppsFlyerEvent('af_complete_registration', {
            af_registration_method: method,
            country: profile.country || '',
          });
        }
      }
    } else {
      afEventFiredRef.current = false;
    }
  }, [user?.id, isLoadingAuth, profile]);

  // Fire trial_expired_no_conversion once if trial lapsed without converting.
  useTrialExpiryTracking(user?.id);
  // ───────────────────────────────────────────────────────────────────────────

  // V2: Update user timezone on authentication for server-side quiet hours
  useEffect(() => {
    if (user?.id) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      supabase
        .from('profiles')
        .update({ timezone })
        .eq('id', user.id)
        .then(() => {});
    }
  }, [user?.id]);

  // V2 Push notification listeners — server-synced notifications.
  // The server creates notification rows via triggers/edge functions.
  // Push payloads now include notificationId and deepLink.
  // Registered once on mount. Uses userIdRef for current auth state.
  useEffect(() => {
    /**
     * V2 processNotification: handles push data from OneSignal.
     * Server already created the notification row — we just mark as read and navigate.
     */
    function processNotification(
      data: Record<string, unknown>,
      navigationTarget?: string
    ) {
      if (!userIdRef.current) {
        // Stash the deep link for after auth
        if (data.type === 'paired_user_saved_card' && data.notificationId) {
          pendingDeepLinkRef.current = `mingla://discover?paired=true&notificationId=${data.notificationId as string}`;
        } else if (data.deepLink) {
          pendingDeepLinkRef.current = data.deepLink as string;
        }
        return;
      }

      const notificationId = data.notificationId as string | undefined;
      const deepLink = data.deepLink as string | undefined;
      const actionId = data.actionId as string | undefined;

      // Handle push action buttons (Accept/Decline from system tray)
      if (actionId === 'accept') {
        handlePushAccept(data);
        return;
      }
      if (actionId === 'decline') {
        handlePushDecline(data);
        return;
      }

      // Mark as read + record click on server (fire-and-forget)
      if (notificationId) {
        supabase
          .from('notifications')
          .update({
            is_read: true,
            read_at: new Date().toISOString(),
            push_clicked: true,
            push_clicked_at: new Date().toISOString(),
          })
          .eq('id', notificationId)
          .then(() => {});
      }

      // Analytics: track which notification type drove re-engagement
      mixpanelService.track('Push Notification Clicked', {
        notification_type: (data.type as string) ?? 'unknown',
        notification_id: notificationId ?? 'unknown',
      });

      // Navigate via deep link
      if (data.type === 'paired_user_saved_card' && notificationId) {
        supabase
          .from('notifications')
          .select('related_id')
          .eq('id', notificationId)
          .maybeSingle()
          .then(({ data: notification }) => {
            const cardId = notification?.related_id;
            if (typeof cardId === 'string' && cardId) {
              setDeepLinkParams({ paired: 'true', cardId });
              setCurrentPage('discover');
              return;
            }

            if (deepLink) {
              const action = parseDeepLink(deepLink);
              executeDeepLink(action, {
                setCurrentPage: setCurrentPage as (page: string) => void,
                setPendingSessionOpen,
                setShowPaywall: (show: boolean) => setShowPaywall(show),
                setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
              });
            } else if (navigationTarget) {
              setCurrentPage(navigationTarget as any);
            }
          });
      } else if (deepLink) {
        const action = parseDeepLink(deepLink);
        executeDeepLink(action, {
          setCurrentPage: setCurrentPage as (page: string) => void,
          setPendingSessionOpen,
          setShowPaywall: (show: boolean) => setShowPaywall(show),
          setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
        });
      } else if (navigationTarget) {
        // Fallback for old push format
        setCurrentPage(navigationTarget as any);
      }
    }

    /**
     * Resolve entity ID from push data. Push payloads include the full
     * notification data JSONB plus `notificationId` and `type` added by
     * notify-dispatch. We check the type-specific key first, then fall
     * back to `relatedId` (always populated by notify-dispatch).
     */
    function resolveEntityId(data: Record<string, unknown>, ...keys: string[]): string {
      for (const key of keys) {
        const val = data[key];
        if (typeof val === 'string' && val) return val;
      }
      return '';
    }

    /** Handle push accept button (from system tray action) */
    async function handlePushAccept(data: Record<string, unknown>) {
      const type = data.type as string;
      const notificationId = data.notificationId as string | undefined;

      try {
        switch (type) {
          case 'friend_request_received': {
            const requestId = resolveEntityId(data, 'requestId', 'relatedId');
            if (requestId) {
              await supabase.rpc('accept_friend_request_atomic', {
                p_request_id: requestId,
              });
            }
            break;
          }
          case 'pair_request_received': {
            const requestId = resolveEntityId(data, 'requestId', 'relatedId');
            const { acceptPairRequest: acceptPairSvc } = await import('../src/services/pairingService');
            await acceptPairSvc(requestId);
            break;
          }
          case 'collaboration_invite_received': {
            const inviteId = resolveEntityId(data, 'inviteId', 'relatedId');
            const { acceptCollaborationInvite } = await import('../src/services/collaborationInviteService');
            await acceptCollaborationInvite({
              userId: userIdRef.current!,
              inviteId,
            });
            break;
          }
        }
        // Delete the notification after successful action
        if (notificationId) {
          await supabase.from('notifications').delete().eq('id', notificationId);
        }
      } catch (err) {
        console.warn('[processNotification] Push accept failed:', err);
      }
    }

    /** Handle push decline button (from system tray action) */
    async function handlePushDecline(data: Record<string, unknown>) {
      const type = data.type as string;
      const notificationId = data.notificationId as string | undefined;

      try {
        switch (type) {
          case 'friend_request_received': {
            const requestId = resolveEntityId(data, 'requestId', 'relatedId');
            if (requestId) {
              await supabase
                .from('friend_requests')
                .update({ status: 'declined' })
                .eq('id', requestId);
            }
            break;
          }
          case 'pair_request_received': {
            const requestId = resolveEntityId(data, 'requestId', 'relatedId');
            const { declinePairRequest: declinePairSvc } = await import('../src/services/pairingService');
            await declinePairSvc(requestId);
            break;
          }
          case 'collaboration_invite_received': {
            const inviteId = resolveEntityId(data, 'inviteId', 'relatedId');
            const { declineCollaborationInvite } = await import('../src/services/collaborationInviteService');
            await declineCollaborationInvite({
              userId: userIdRef.current!,
              inviteId,
            });
            break;
          }
        }
        if (notificationId) {
          await supabase.from('notifications').delete().eq('id', notificationId);
        }
      } catch (err) {
        console.warn('[processNotification] Push decline failed:', err);
      }
    }

    // Navigation targets per notification type (fallback when deepLink is absent).
    // Every type allowed through the foreground handler (MESSAGE_TYPES below)
    // MUST have an entry here so tapping the push always lands somewhere.
    // Fallback navigation map — used when a push notification's deepLink is
    // absent. Every notification type that could arrive as a push MUST have
    // an entry here so tapping it always lands somewhere meaningful.
    const NAV_TARGETS: Record<string, string> = {
      // Social
      friend_request_received: "connections",
      friend_request_accepted: "connections",
      friend_request: "connections", // legacy
      friend_accepted: "connections", // legacy
      pair_request_received: "discover",
      pair_request_accepted: "discover",
      paired_user_saved_card: "discover",
      paired_user_visited: "discover",
      // Collaboration / Sessions
      collaboration_invite_received: "home",
      collaboration_invite_accepted: "home",
      collaboration_invite_declined: "home",
      collaboration_invite_response: "home",
      collaboration_invite_sent: "home",
      session_member_joined: "home",
      session_member_left: "home",
      board_card_saved: "home",
      board_card_voted: "home",
      board_card_rsvp: "home",
      // DM notification types
      direct_message_received: "connections",
      message: "connections", // legacy type from send-message-email
      // Board message types
      board_message_received: "home",
      board_message_mention: "home",
      board_card_message: "home",
      // Lifecycle
      trial_ending: "home",
      re_engagement: "home",
      re_engagement_3d: "home",
      re_engagement_7d: "home",
      weekly_digest: "home",
      // Calendar
      calendar_reminder_tomorrow: "likes",
      calendar_reminder_today: "likes",
      // Referral
      referral_credited: "home",
      // Feedback
      visit_feedback_prompt: "likes",
      // Holiday reminders (Block 3 Pass 2)
      holiday_reminder: "discover",
    };

    // Foreground: push arrives while app is open.
    // For DM notifications: let the system tray show the push so the user
    // sees it even if they're on a different tab. The notification center
    // also receives an in-app entry via Realtime (notifications table INSERT).
    // For non-DM notifications: suppress system tray — Realtime delivers in-app.
    const MESSAGE_TYPES = new Set(['direct_message_received', 'message', 'board_message_received', 'board_message_mention', 'board_card_message']);
    const removeForeground = onForegroundNotification((data, prevent) => {
      if (!userIdRef.current) return;

      const notifType = data.type as string | undefined;
      if (notifType && MESSAGE_TYPES.has(notifType)) {
        // Let message pushes show in system tray — user wants to see them
        return;
      }
      // Suppress non-message pushes — Realtime delivers in-app notification
      prevent();
    });

    // Background: user taps a push notification
    const removeClicked = onNotificationClicked((data) => {
      if (!data?.type) return;
      processNotification(data, NAV_TARGETS[data.type as string]);
    });

    return () => {
      removeForeground();
      removeClicked();
    };
  }, []);

  // Transform boardsSessions to CollaborationSession format for the sessions bar
  const collaborationSessions: CollaborationSession[] = useMemo(() => {
    return (boardsSessions || []).map((board: any) => {
      let sessionType: 'active' | 'sent-invite' | 'received-invite' = 'active';
      if (board.status === 'pending') {
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
  }, [boardsSessions, user?.id]);

  // Load all sessions (including pending invites) on mount
  useEffect(() => {
    if (user?.id) {
      refreshAllSessions({ showLoading: true });
    }
  }, [user?.id]);

  // Debounce ref for Realtime-triggered refreshes.
  // Collapses rapid database events into a single refreshAllSessions() call.
  const realtimeRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime subscription: keep the collaboration pill bar live.
  // Subscribes to three tables that cover all pill state changes:
  //   1. collaboration_sessions (created_by=userId) — user's own sessions: status change, name, archive
  //   2. session_participants (user_id=userId) — user added/removed/accepted in any session
  //   3. collaboration_invites (invited_user_id=userId) — invites received, accepted, declined
  //
  // On any event: debounce 500ms → refreshAllSessions() with generation protection.
  // Channel: collaboration_pill_changes_${userId} — no conflict with existing channels.
  //
  // STALE CLOSURE CONTRACT — READ BEFORE MODIFYING:
  // refreshAllSessions is intentionally NOT in the dep array. It creates a new function
  // reference every render; adding it would tear down and rebuild the subscription on every
  // render, hammering the Supabase Realtime server. The closed-over version is safe ONLY as
  // long as refreshAllSessions reads user.id exclusively (not user.email, user.user_metadata,
  // or any other field that can change without user.id changing). If refreshAllSessions ever
  // needs other volatile user fields, either wrap it in useCallback (with user.id as its dep)
  // or migrate boardsSessions to React Query and call queryClient.invalidateQueries() instead.
  useEffect(() => {
    if (!user?.id) return;

    const userId = user.id;

    const triggerDebouncedRefresh = () => {
      if (realtimeRefreshDebounceRef.current) {
        clearTimeout(realtimeRefreshDebounceRef.current);
      }
      realtimeRefreshDebounceRef.current = setTimeout(() => {
        realtimeRefreshDebounceRef.current = null;
        // refreshAllSessions is captured from the closure at subscription setup.
        // It is safe to call because user.id hasn't changed (effect dep hasn't changed).
        refreshAllSessions();
      }, 500);
    };

    const channel = supabase
      .channel(`collaboration_pill_changes_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_sessions',
          filter: `created_by=eq.${userId}`,
        },
        triggerDebouncedRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `user_id=eq.${userId}`,
        },
        triggerDebouncedRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_user_id=eq.${userId}`,
        },
        triggerDebouncedRefresh,
      )
      .subscribe();

    return () => {
      // Cancel any pending debounced refresh before tearing down the channel.
      // Without this, a lingering timeout could call refreshAllSessions()
      // after the subscription is gone (e.g., after user signs out).
      if (realtimeRefreshDebounceRef.current) {
        clearTimeout(realtimeRefreshDebounceRef.current);
        realtimeRefreshDebounceRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [user?.id]); // Re-subscribe only when userId changes (login/logout)

  // V2: Process pending deep link after auth resolves
  useEffect(() => {
    if (user?.id && pendingDeepLinkRef.current) {
      const action = parseDeepLink(pendingDeepLinkRef.current);

      if (action?.page === 'discover' && action.params?.notificationId) {
        supabase
          .from('notifications')
          .select('related_id')
          .eq('id', action.params.notificationId)
          .maybeSingle()
          .then(({ data: notification }) => {
            const cardId = notification?.related_id;
            if (typeof cardId === 'string' && cardId) {
              setDeepLinkParams({ paired: 'true', cardId });
              setCurrentPage('discover');
              return;
            }

            executeDeepLink(action, {
              setCurrentPage: setCurrentPage as (page: string) => void,
              setPendingSessionOpen,
              setShowPaywall: (show: boolean) => setShowPaywall(show),
              setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
            });
          });
      } else {
        executeDeepLink(action, {
          setCurrentPage: setCurrentPage as (page: string) => void,
          setPendingSessionOpen,
          setShowPaywall: (show: boolean) => setShowPaywall(show),
          setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
        });
      }

      pendingDeepLinkRef.current = null;
    }
  }, [user?.id]);

  // Centralized foreground resume: auth-first sequence, aggressive Realtime remount,
  // query invalidation AFTER auth, refreshAllSessions gated on valid JWT.
  // See useForegroundRefresh for the full resume state machine. ORCH-0336.
  const { resumeCount, realtimeEpoch } = useForegroundRefresh(user?.id, () => {
    refreshAllSessions();
  });

  // Sync i18n language from profile (handles cross-device language changes)
  useEffect(() => {
    if (profile?.preferred_language && profile.preferred_language !== i18n.language) {
      i18n.changeLanguage(profile.preferred_language)
      persistLanguage(profile.preferred_language)
    }
  }, [profile?.preferred_language])

  // Realtime subscriptions moved to <RealtimeSubscriptions /> component below,
  // keyed by realtimeEpoch for clean unmount/remount after long background.
  // Duplicate useSocialRealtime call removed here (was in both AppStateManager + here).
  // See ORCH-0336, ORCH-0337.

  // ── Prefetch friends list while user is idle on Home ──
  // After 3 seconds on Home, prefetch the friends list so the Connect tab
  // switch feels instant. The 3s delay avoids competing with deck card fetch
  // (highest-priority request). Failures are silently ignored — normal fetch
  // handles it on tab mount.
  // NOTE: Discover prefetch was removed because DiscoverScreen manages its own
  // state outside React Query — the prefetch data was never read. The keep-warm
  // cron handles edge function warming instead.
  useEffect(() => {
    if (currentPage !== 'home' || !user?.id) return;

    const prefetchTimer = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ['friends', 'list', user.id],
        queryFn: () => friendsService.fetchFriends(user.id),
        staleTime: 30_000, // 30s (matches useFriendsList)
      });
    }, 3000);

    return () => clearTimeout(prefetchTimer);
  }, [currentPage, user?.id]);

  // Process deferred deep links after auth + onboarding complete.
  // Links are deferred when they arrive while the user is unauthenticated (F-05).
  // Stale links (>24 hours old) are discarded to prevent confusing navigation.
  const hasProcessedDeferredLinkRef = useRef(false);
  // Reset the guard when user signs out so the next sign-in can process links.
  // AppContent is never unmounted, so the ref persists across auth transitions.
  useEffect(() => {
    if (!isAuthenticated) {
      hasProcessedDeferredLinkRef.current = false;
    }
  }, [isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || isLoadingAuth || showOnboardingFlow) return;
    if (hasProcessedDeferredLinkRef.current) return;
    hasProcessedDeferredLinkRef.current = true;

    AsyncStorage.getItem('mingla_deferred_deeplink').then(raw => {
      if (!raw) return;
      AsyncStorage.removeItem('mingla_deferred_deeplink');
      try {
        const { url, ts } = JSON.parse(raw);
        const ageMs = Date.now() - (ts ?? 0);
        const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
        if (ageMs > MAX_AGE_MS) {
          console.log('[DEEPLINK] Discarded stale deferred link:', url);
          return;
        }
        console.log('[DEEPLINK] Processing deferred link:', url);
        handleDeepLink(url);
      } catch (e) {
        console.warn('[DEEPLINK] Failed to parse deferred link:', e);
      }
    });
  }, [isAuthenticated, isLoadingAuth, showOnboardingFlow]);

  // Get friends from useFriends hook for session creation
  const { friends: dbFriends, fetchFriends, loadFriendRequests, friendRequests } = useFriends();
  
  // Fetch friends when component mounts
  useEffect(() => {
    if (user) {
      fetchFriends();
    }
  }, [user, fetchFriends]);

  // Check for new incoming friend requests and fire notifications
  useEffect(() => {
    if (!user?.id || !isAuthenticated) return;

    const checkFriendRequests = async () => {
      try {
        await loadFriendRequests();
      } catch (error) {
        console.error("Error checking friend requests:", error);
      }
    };

    // Check immediately on mount
    checkFriendRequests();

    // Then check every 60 seconds
    const interval = setInterval(checkFriendRequests, 60000);
    return () => clearInterval(interval);
  }, [user?.id, isAuthenticated, loadFriendRequests]);

  // V2: Friend request notifications are now server-created.
  // The polling loop above (loadFriendRequests) still fetches request data
  // for the FriendRequestsModal, but we no longer create local notifications.
  // The server-side notification trigger handles it.

  // Check if user needs onboarding (for authenticated users)
  // Show onboarding if user is authenticated but hasn't completed onboarding
  const needsOnboarding =
    isAuthenticated &&
    user &&
    profile &&
    profile.has_completed_onboarding === false;

  // Email verification removed — all users are now OAuth (inherently verified)

  // Structured navigation logging
  useEffect(() => {
    if (isLoadingAuth) {
      logger.nav('Screen: AuthLoading');
    } else if (!isAuthenticated) {
      logger.nav('Screen: WelcomeScreen (not authenticated)');
    } else if (showOnboardingFlow || needsOnboarding) {
      logger.nav('Screen: OnboardingFlow', { showOnboardingFlow, needsOnboarding, hasCompletedOnboarding: profile?.has_completed_onboarding });
    } else if (showPreferences) {
      logger.nav('Modal: PreferencesSheet');
    } else {
      logger.nav(`Page: ${currentPage}`, { userId: user?.id });
    }
  }, [
    currentPage,
    isAuthenticated,
    profile,
    isLoadingAuth,
    user,
    showOnboardingFlow,
    needsOnboarding,
    showPreferences,
  ]);

  // Track main screen visits in Mixpanel
  useEffect(() => {
    if (isAuthenticated && !isLoadingAuth && currentPage) {
      mixpanelService.trackScreenViewed(currentPage);
    }
  }, [currentPage, isAuthenticated, isLoadingAuth]);

  // Identify user in Mixpanel once authenticated — sets user properties + super properties
  const signupFiredRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      mixpanelService.trackLogin({
        id: user.id,
        email: user.email,
        provider: (user as any).app_metadata?.provider ?? "email",
        displayName: profile?.display_name ?? profile?.first_name ?? undefined,
        country: profile?.country ?? undefined,
        city: (profile as any)?.city ?? (profile as any)?.location ?? undefined,
        onboardingCompleted: profile?.has_completed_onboarding ?? false,
        friendsCount: dbFriends?.length ?? 0,
      });

      // Track Signup Completed for new users (not yet onboarded)
      if (!profile?.has_completed_onboarding && !signupFiredRef.current) {
        mixpanelService.trackSignupCompleted({
          method: (user as any).app_metadata?.provider ?? 'email',
          country: profile?.country ?? undefined,
        });
        signupFiredRef.current = true;
      }
    }
  }, [isAuthenticated, user?.id, profile?.has_completed_onboarding]);

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

  // Handle notification tap → navigate to the relevant page (V2: ServerNotification)
  const handleNotificationNavigate = (notification: ServerNotification) => {
    const deepLink = notification.data?.deepLink as string | undefined;
    logger.action('Notification tapped', { type: notification.type, deepLink });

    if (notification.type === 'paired_user_saved_card' && notification.related_id) {
      setDeepLinkParams({ paired: 'true', cardId: notification.related_id });
      setCurrentPage('discover');
      return;
    }

    // Try deep link first
    if (deepLink) {
      const action = parseDeepLink(deepLink);
      executeDeepLink(action, {
        setCurrentPage: setCurrentPage as (page: string) => void,
        setPendingSessionOpen,
        setShowPaywall: (show: boolean) => setShowPaywall(show),
        setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
      });
      return;
    }

    // Fallback: map notification type to page
    const type = notification.type;
    if (type.startsWith('friend_') || type.startsWith('pair_') || type.startsWith('link_')) {
      setCurrentPage('connections');
    } else if (type.startsWith('collaboration_') || type.startsWith('session_')) {
      const sessionId = notification.data?.sessionId as string;
      if (sessionId) {
        setPendingSessionOpen(sessionId);
      }
      setCurrentPage('home');
    } else if (type.startsWith('direct_message_')) {
      setCurrentPage('connections');
    } else if (type.startsWith('board_message_') || type.startsWith('board_card_')) {
      const sessionId = notification.data?.sessionId as string;
      if (sessionId) {
        setPendingSessionOpen(sessionId);
        setCurrentPage('home');
      } else {
        setCurrentPage('home');
      }
    } else if (type.startsWith('calendar_')) {
      setCurrentPage('likes');
    } else if (type === 'weekly_digest') {
      setCurrentPage('home');
    } else if (type === 'trial_ending') {
      setShowPaywall(true);
    } else {
      setCurrentPage('home');
    }
  };

  // Session handlers for the CollaborationSessions bar
  const handleSessionSelect = (sessionId: string | null) => {
    logger.action('Session selected', { sessionId });
    if (sessionId) {
      const session = boardsSessions?.find((s: any) => s.id === sessionId || s.session_id === sessionId);
      if (session) {
        handlers.handleModeChange(session.name);
        setCurrentSessionId(sessionId);
      }
    }
  };

  const handleSoloSelect = () => {
    logger.action('Solo mode selected');
    handlers.handleModeChange('solo');
    setCurrentSessionId(null);
  };

  // Helper function to refresh all sessions (active + pending)
  const refreshAllSessions = async (options?: { showLoading?: boolean }) => {
    if (!user?.id) {
      setIsLoadingBoards(false);
      return;
    }

    // Increment generation. If two calls race, only the latest-starting one
    // will find its generation still current when it finishes.
    const generation = ++refreshGenerationRef.current;

    // Only show loading indicator on explicit request (e.g., initial mount,
    // user-triggered actions). Foreground resume should NOT flash a loading
    // state over cached data — cached pills remain visible while refreshing.
    if (options?.showLoading) {
      setIsLoadingBoards(true);
    }
    // Always clear board-session dedupe before fetching. Realtime-driven refreshes
    // call refreshAllSessions() without showLoading; if we skipped invalidation,
    // fetchUserBoardSessions could return a stale list for up to 5s (e.g. after
    // accepting a collab invite from the notification modal).
    BoardSessionService.invalidateBoardSessionCache();
    try {
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
            inviter_id,
            status,
            collaboration_sessions!inner(id, name, status, created_by, created_at)
          `)
          .eq('invited_user_id', user.id)
          .eq('status', 'pending')
          .eq('pending_friendship', false),
      ]);

      // Discard this result if a newer call has already started.
      // This prevents a slow network from causing stale data to overwrite fresh data.
      if (generation !== refreshGenerationRef.current) {
        return;
      }

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

      // Fetch inviter profiles for invited sessions.
      // Note: the Supabase query above already filters by status='pending', so the
      // null-guard (|| []) is the only defence needed here — no redundant .filter().
      const invitedSessionsList = invitedSessions || [];
      // filter(Boolean) guards against corrupt rows where inviter_id is null —
      // prevents SQL `WHERE id IN (null)` which silently matches nothing.
      const inviterIds = [...new Set(
        invitedSessionsList
          .map((inv: any) => inv.inviter_id)
          .filter(Boolean)
      )];

      let inviterProfiles: any[] = [];
      if (inviterIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', inviterIds);
        inviterProfiles = profiles || [];
      }

      // Check generation again after the second round of async work.
      // A Realtime event could have fired during the inviter profile fetch.
      if (generation !== refreshGenerationRef.current) {
        return;
      }

      // Helper to get inviter profile name
      const getInviterName = (inviterId: string | undefined) => {
        const profile = inviterProfiles.find((p: any) => p.id === inviterId);
        if (!profile) return 'Someone';
        if (profile.first_name && profile.last_name) {
          return `${profile.first_name} ${profile.last_name}`;
        }
        return profile.first_name || profile.username || 'Someone';
      };

      // Transform pending/accepted invited sessions with inviter profile
      // Show as grey pills only if the user hasn't accepted yet (status = 'pending')
      // Once accepted, they will appear in activeBoards instead
      const pendingInvitedSessions = invitedSessionsList
        .map((inv: any) => {
          const inviterId = inv.inviter_id;
          const inviterProfile = inviterProfiles.find((p: any) => p.id === inviterId);
          const inviterName = getInviterName(inviterId);

          return {
            id: inv.collaboration_sessions.id,
            name: inv.collaboration_sessions.name,
            status: 'pending',
            creatorId: inv.collaboration_sessions.created_by,
            created_by: inv.collaboration_sessions.created_by,
            invitedBy: inviterId,
            inviterProfile: {
              id: inviterId,
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
    } finally {
      // Only clear loading if this is still the current generation.
      // If a newer call took over, it will clear loading when it finishes.
      if (generation === refreshGenerationRef.current) {
        setIsLoadingBoards(false);
      }
    }
  };

  const handleCreateSession = async (sessionName: string, selectedFriends: Friend[] = [], phoneInvitees?: { phoneE164: string }[]) => {
    if (!user?.id) return;
    logger.action('Create session pressed', { name: sessionName, friendCount: selectedFriends.length });
    setIsCreatingSession(true);
    let createdSessionId: string | null = null;
    let successfulParticipantAdds = 0;
    let successfulInvites = 0;
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
        successfulParticipantAdds += 1;

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
        successfulInvites += 1;

        // Send email and push notification via Edge Function
        if (friendEmail && inviteData) {
          try {
            await supabase.functions.invoke('send-collaboration-invite', {
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

      // If user selected friends but none were actually added/invited,
      // fail fast instead of showing a misleading success toast.
      if (selectedFriends.length > 0 && successfulParticipantAdds === 0 && successfulInvites === 0) {
        throw new Error('No collaborators could be added to the session.');
      }

      // Process phone invitees — tie pending invites to this session
      if (createdSessionId && phoneInvitees && phoneInvitees.length > 0) {
        const { createPendingSessionInvite } = await import('../src/services/phoneLookupService');
        for (const invitee of phoneInvitees) {
          try {
            await createPendingSessionInvite(createdSessionId, user.id, invitee.phoneE164);
          } catch (inviteErr) {
            console.error('Error creating pending session invite for', invitee.phoneE164, inviteErr);
            // Non-fatal — don't fail session creation for this
          }
        }
      }

      // Refresh all sessions (active + pending)
      await refreshAllSessions({ showLoading: true });

      // Show success toast
      const friendCount = selectedFriends.length;
      const message = friendCount > 0 
        ? `Session "${sessionName}" created! Invites sent to ${successfulInvites} friend${successfulInvites > 1 ? 's' : ''}.`
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
    logger.action('Accept invite pressed', { sessionId });
    try {
      const { acceptCollaborationInvite } = await import('../src/services/collaborationInviteService');
      const result = await acceptCollaborationInvite({ userId: user.id, sessionId });

      if (!result.success) {
        toastManager.error(result.error ?? 'Failed to accept invite.');
        return;
      }

      await dismissCollaborationInviteNotifications(user.id, queryClient, {
        sessionId: result.sessionId,
        inviteId: result.inviteId || undefined,
      });

      // Refresh all sessions so the pill bar reflects the new active session
      await refreshAllSessions({ showLoading: true });
      toastManager.success(`Joined "${result.sessionName}" successfully!`);
    } catch (error) {
      console.error('Error accepting invite:', error);
      toastManager.error('Failed to accept invite.');
    }
  };

  const handleDeclineInvite = async (sessionId: string) => {
    if (!user?.id) return;
    logger.action('Decline invite pressed', { sessionId });
    try {
      const { declineCollaborationInvite } = await import('../src/services/collaborationInviteService');
      const result = await declineCollaborationInvite({ userId: user.id, sessionId });

      if (!result.success) {
        toastManager.error(result.error ?? 'Failed to decline invite.');
        return;
      }

      if (result.sessionId) {
        await dismissCollaborationInviteNotifications(user.id, queryClient, {
          sessionId: result.sessionId,
          inviteId: result.inviteId,
        });
      }

      // Refresh all sessions so the pill bar removes the declined invite
      await refreshAllSessions({ showLoading: true });
      toastManager.success('Invite declined.');
    } catch (error) {
      console.error('Error declining invite:', error);
      toastManager.error('Failed to decline invite.');
    }
  };

  const handleCancelInvite = async (sessionId: string) => {
    if (!user?.id) return;
    logger.action('Cancel invite pressed', { sessionId });
    try {
      // Step 1: Delete the session. CASCADE atomically removes participants,
      // invites, prefs, and all child rows in one statement. This is the
      // primary operation — everything else is a safety net.
      const { data: deleted, error } = await supabase
        .from('collaboration_sessions')
        .delete()
        .eq('id', sessionId)
        .eq('created_by', user.id)
        .select('id');

      if (error) {
        console.error('[CancelInvite] DB error:', error.message);
        throw error;
      }

      if (!deleted || deleted.length === 0) {
        // DELETE matched 0 rows — session already gone or user isn't creator.
        // Clean up any orphaned invites/participants as a safety net.
        console.warn('[CancelInvite] No rows deleted — cleaning up orphans. sessionId:', sessionId);

        await supabase
          .from('collaboration_invites')
          .update({ status: 'cancelled' })
          .eq('session_id', sessionId)
          .eq('status', 'pending');

        await supabase
          .from('session_participants')
          .delete()
          .eq('session_id', sessionId);
      }

      // Step 2: Refresh sessions to update the pill bar
      await refreshAllSessions({ showLoading: true });
      toastManager.success('Invite cancelled.');
    } catch (error) {
      console.error('[CancelInvite] Error:', error);
      toastManager.error('Failed to cancel invite.');
    }
  };


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

    // OAuth callbacks MUST run immediately — they ARE the auth flow.
    // All other deep links: if the user isn't authenticated, defer to
    // AsyncStorage and process after login completes. This prevents
    // invite/navigation links from being silently discarded.
    const isOAuthCallback = url.includes("auth/callback");
    if (!isOAuthCallback && !user) {
      try {
        // Store the link with a timestamp so we can discard stale links (>24h)
        const deferred = JSON.stringify({ url, ts: Date.now() });
        await AsyncStorage.setItem('mingla_deferred_deeplink', deferred);
        console.log('[DEEPLINK] Deferred (unauthenticated):', url);
      } catch (err) {
        console.error('[DEEPLINK] Failed to defer:', err);
      }
      return;
    }

    // Handle invite deep links
    if (url.includes('/invite/') || url.includes('invite/')) {
      try {
        const parts = url.split('/invite/')
        const referralCode = parts[parts.length - 1]?.split('?')[0]
        if (referralCode) {
          await AsyncStorage.setItem('@mingla_referral_code', referralCode)
          console.log('Stored referral code:', referralCode)
        }
      } catch (err) {
        console.error('Error handling invite deep link:', err)
      }
      return
    }

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
          Alert.alert(t('navigation:alerts.sign_in_error_title'), String(error));
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
              t('navigation:alerts.error_title'),
              t('navigation:alerts.failed_sign_in') + sessionError.message
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


  // Verify / resolve session ID when in collaboration mode.
  // The stored sessionId (via initialSessionId) gives instant pill highlighting;
  // this effect confirms it against the database and corrects if stale.
  // The `cancelled` flag prevents a slow DB response from overwriting a mode
  // switch the user made while the request was in-flight.
  useEffect(() => {
    let cancelled = false;

    const getSessionId = async () => {
      if (currentMode === "solo" || currentMode === null) {
        setCurrentSessionId(null);
        return;
      }

      if (!user?.id) {
        setCurrentSessionId(null);
        return;
      }

      // Verify against database
      const activeSession = await SessionService.getActiveSession(user.id);
      if (cancelled) return;

      if (activeSession) {
        setCurrentSessionId(activeSession.sessionId);
      } else {
        // Fallback: find session by name
        const { data: sessions } = await supabase
          .from("collaboration_sessions")
          .select("id")
          .eq("name", currentMode)
          .limit(1);

        if (cancelled) return;

        if (sessions && sessions.length > 0) {
          setCurrentSessionId(sessions[0].id);
        } else {
          // Session no longer exists — fall back to solo
          setCurrentSessionId(null);
        }
      }
    };

    getSessionId();
    return () => { cancelled = true; };
  }, [currentMode, user?.id]);

  // RELIABILITY: Gate on !_hasHydrated || isLoadingAuth. This ensures the profile
  // gate below sees the Zustand-persisted profile value (from AsyncStorage rehydration)
  // instead of the default null. Without this, Android cold start with expired token
  // shows permanent "Getting things ready" because profile fetch fails but persisted
  // profile hasn't loaded yet.
  if (!_hasHydrated || isLoadingAuth) {
    logger.nav('Render: AuthLoading screen', { hydrated: _hasHydrated, authLoading: isLoadingAuth });
    return <AppLoadingScreen message="Welcome back" testID="auth-loading" />;
  }
  // Show onboarding loader if active OR if user needs onboarding.
  // OnboardingLoader owns the async resume/loading state — AppContent never renders
  // OnboardingFlow directly.
  // Guard: onAuthStateChange (JWT expiry, force sign-out) can null out `user` in the
  // same render frame before the cleanup effect in AppStateManager runs. Without this
  // guard, user!.id would throw a TypeError that crashes the whole React tree.
  if (showOnboardingFlow || needsOnboarding) {
    if (!user || !profile) return null;

    logger.nav('Render: OnboardingFlow', { showOnboardingFlow, needsOnboarding, hasCompletedOnboarding: profile?.has_completed_onboarding });

    return (
      <ErrorBoundary>
        <OnboardingLoader
          userId={user.id}
          profile={profile}
          onComplete={() => {
            logger.nav('OnboardingFlow completed — transitioning to home');
            setHasCompletedOnboarding(true);
            setShowOnboardingFlow(false);
            setCurrentPage("home");
            refreshAllSessions({ showLoading: true });
          }}
        />
      </ErrorBoundary>
    );
  }

  // Show welcome screen ONLY if truly not authenticated.
  // If user exists but profile hasn't loaded yet, keep showing the loading state —
  // do NOT flash the WelcomeScreen.
  if (!isAuthenticated) {
    logger.nav('Render: WelcomeScreen (not authenticated)');
    return (
      <ErrorBoundary>
        <WelcomeScreen
          onGoogleSignIn={handleGoogleSignIn}
          onAppleSignIn={handleAppleSignIn}
        />
      </ErrorBoundary>
    );
  }

  // User is authenticated but profile hasn't loaded yet — show a loading indicator,
  // NOT the WelcomeScreen
  if (user && !profile) {
    logger.nav('Render: ProfileLoading (user exists, waiting for profile)', { userId: user.id });
    return <AppLoadingScreen message="Getting things ready" testID="profile-loading" />;
  }

  // Whether any full-screen overlay is active (hides tab container)
  const isOverlayActive = !!viewingFriendProfileId || (showPaywall && !!user?.id);

  // Function to render current page based on navigation
  const renderCurrentPage = () => {
    switch (currentPage) {
      case "home":
        return (
          <HomePage
            onOpenPreferences={() => {
              logger.action('Open preferences pressed');
              setShowPreferences(true);
            }}

            onOpenCollabPreferences={() => { logger.action('Open collab preferences pressed'); setShowCollabPreferences(true) }}
            currentMode={currentMode ?? "solo"}

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
            onSessionStateChanged={() => refreshAllSessions({ showLoading: true })}
            availableFriends={availableFriendsForSessions}
            isCreatingSession={isCreatingSession}
            onNotificationNavigate={handleNotificationNavigate}
            userId={user?.id}
            openSessionId={pendingSessionOpen}
            onOpenSessionHandled={() => setPendingSessionOpen(null)}
          />
        );
      case "discover":
        return (
          <DiscoverScreen
            onAddFriend={() => {
              // Navigate to connections or show add friend modal
              setCurrentPage("connections");
            }}
            onOpenChatWithUser={(friendUserId) => {
              setPendingOpenDmUserId(friendUserId);
              setCurrentPage("connections");
            }}
            onViewFriendProfile={(friendUserId) => setViewingFriendProfileId(friendUserId)}
            onUpgradePress={() => setShowPaywall(true)}
            accountPreferences={{
              currency: accountPreferences?.currency || "USD",
              measurementSystem:
                (accountPreferences?.measurementSystem as
                  | "Metric"
                  | "Imperial") || "Imperial",
            }}
            preferencesRefreshKey={preferencesRefreshKey}
            deepLinkParams={currentPage === 'discover' ? deepLinkParams : null}
            onDeepLinkHandled={() => setDeepLinkParams(null)}
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
            onCreateSession={async () => {
              await refreshAllSessions({ showLoading: true });
            }}
            onUnreadCountChange={setTotalUnreadMessages}
            onNavigateToFriendProfile={(userId: string) => setViewingFriendProfileId(userId)}
            onFriendAccepted={() => refreshAllSessions({ showLoading: false })}
            openDirectMessageWithUserId={pendingOpenDmUserId}
            onOpenDirectMessageHandled={() => setPendingOpenDmUserId(null)}
          />
        );
      case "likes":
        return (
          <LikesPage
            savedCards={savedCards}
            isLoadingSavedCards={isLoadingSavedCards}
            isSavedCardsError={isSavedCardsError}
            onRetrySavedCards={refetchSavedCards}
            isLoadingCalendarEntries={isLoadingCalendarEntries}
            calendarEntries={calendarEntries}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            navigationData={likesNavData}
            onNavigationComplete={() => setLikesNavData(null)}
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
        // Legacy — redirect to likes page
        setCurrentPage("likes");
        return null;
      case "profile":
        return (
          <ProfilePage
            onSignOut={async () => {
              logger.action('Sign out pressed');
              await handleSignOut();
            }}
            onUserIdentityUpdate={handleUserIdentityUpdate}
            onNavigateToActivity={handlers.handleNavigateToActivity}
            onNavigateToConnections={() => {
              logger.action('Navigate to connections from profile');
              setCurrentPage("connections");
            }}
            savedExperiences={savedCards?.length || 0}
            boardsCount={boardsSessions?.length || 0}
            notificationsEnabled={notificationsEnabled}
            onNotificationsToggle={handlers.handleNotificationsToggle}
            userIdentity={userIdentity}
          />
        );
      default:
        return (
          <HomePage
            onOpenPreferences={() => {
              logger.action('Open preferences pressed');
              setShowPreferences(true);
            }}

            onOpenCollabPreferences={() => { logger.action('Open collab preferences pressed'); setShowCollabPreferences(true) }}
            currentMode={currentMode ?? "solo"}

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
            collaborationSessions={collaborationSessions}
            selectedSessionId={currentSessionId}
            onSessionSelect={handleSessionSelect}
            onSoloSelect={handleSoloSelect}
            onCreateSession={handleCreateSession}
            onAcceptInvite={handleAcceptInvite}
            onDeclineInvite={handleDeclineInvite}
            onCancelInvite={handleCancelInvite}
            onSessionStateChanged={() => refreshAllSessions({ showLoading: true })}
            availableFriends={availableFriendsForSessions}
            isCreatingSession={isCreatingSession}
            onNotificationNavigate={handleNotificationNavigate}
            userId={user?.id}
            openSessionId={pendingSessionOpen}
            onOpenSessionHandled={() => setPendingSessionOpen(null)}
          />
        );
    }
  };

  // Ensure any full-screen profile overlays are closed when switching tabs/pages
  const closeProfileOverlays = () => {
    setViewingFriendProfileId(null);
  };

  // Show main app if user is authenticated AND has completed onboarding
  if (
    isAuthenticated &&
    user &&
    profile &&
    profile.has_completed_onboarding === true
  ) {
    return (
      <>
        {/* Realtime subscriptions keyed by realtimeEpoch — on long-background resume,
            epoch increments, React unmounts (removes old channels) and remounts
            (fresh channels with fresh .on() bindings). ORCH-0336 / I-RT-BIND-01. */}
        {user?.id && (
          <React.Fragment key={realtimeEpoch}>
            <RealtimeSubscriptions userId={user.id} />
          </React.Fragment>
        )}
      <ToastProvider>
        <CardsCacheProvider>
          <RecommendationsProvider
            currentMode={currentMode ?? "solo"}
            refreshKey={preferencesRefreshKey}
            persistedSessionId={currentSessionId}
          >
            <MobileFeaturesProvider>
              <NavigationProvider>
                <CoachMarkProvider navigateToTab={(tab: string) => setCurrentPage(tab as any)}>
                <ErrorBoundary>
                  <View style={styles.safeArea}>
                    <StatusBar
                      barStyle="dark-content"
                      translucent={true}
                      backgroundColor="transparent"
                    />
                    <View style={styles.container}>
                      {/* Main Content — paddingTop for safe area; profile page manages its own for full-bleed gradient */}
                      <View style={[styles.mainContent, { paddingTop: currentPage === "profile" ? 0 : layout.insets.top }]}>
                        {/* Full-screen overlays render ON TOP of tabs */}
                        {viewingFriendProfileId ? (
                          <ViewFriendProfileScreen
                            userId={viewingFriendProfileId}
                            onBack={() => setViewingFriendProfileId(null)}
                            onMessage={(userId) => {
                              setViewingFriendProfileId(null);
                              setPendingOpenDmUserId(userId);
                              setCurrentPage("connections");
                            }}
                          />
                        ) : showPaywall && user?.id ? (
                          <PaywallScreen
                            userId={user.id}
                            onClose={() => setShowPaywall(false)}
                          />
                        ) : null}

                        {/* All 5 tabs always mounted — only active tab visible */}
                        {/* Hidden when a full-screen overlay is active */}
                        {!isOverlayActive && (
                          <View style={{ flex: 1 }}>
                            <View style={currentPage === 'home' ? styles.tabVisible : styles.tabHidden}>
                              <HomePage
                                isTabVisible={currentPage === 'home'}
                                onOpenPreferences={() => {
                                  logger.action('Open preferences pressed');
                                  setShowPreferences(true);
                                }}
                                onOpenCollabPreferences={() => { logger.action('Open collab preferences pressed'); setShowCollabPreferences(true) }}
                                currentMode={currentMode ?? "solo"}
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
                                onSessionStateChanged={() => refreshAllSessions({ showLoading: true })}
                                availableFriends={availableFriendsForSessions}
                                isCreatingSession={isCreatingSession}
                                onNotificationNavigate={handleNotificationNavigate}
                                userId={user?.id}
                                openSessionId={pendingSessionOpen}
                                onOpenSessionHandled={() => setPendingSessionOpen(null)}
                              />
                            </View>
                            <View style={currentPage === 'discover' ? styles.tabVisible : styles.tabHidden}>
                              <DiscoverScreen
                                isTabVisible={currentPage === 'discover'}
                                onAddFriend={() => {
                                  setCurrentPage("connections");
                                }}
                                onOpenChatWithUser={(friendUserId) => {
                                  setPendingOpenDmUserId(friendUserId);
                                  setCurrentPage("connections");
                                }}
                                onViewFriendProfile={(friendUserId) =>
                                  setViewingFriendProfileId(friendUserId)
                                }
                                onUpgradePress={() => setShowPaywall(true)}
                                accountPreferences={{
                                  currency: accountPreferences?.currency || "USD",
                                  measurementSystem:
                                    (accountPreferences?.measurementSystem as
                                      | "Metric"
                                      | "Imperial") || "Imperial",
                                }}
                                preferencesRefreshKey={preferencesRefreshKey}
                                deepLinkParams={currentPage === 'discover' ? deepLinkParams : null}
                                onDeepLinkHandled={() => setDeepLinkParams(null)}
                              />
                            </View>
                            <View style={currentPage === 'connections' ? styles.tabVisible : styles.tabHidden}>
                              <ConnectionsPage
                                isTabVisible={currentPage === 'connections'}
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
                                onCreateSession={async () => {
                                  await refreshAllSessions({ showLoading: true });
                                }}
                                onUnreadCountChange={setTotalUnreadMessages}
                                onNavigateToFriendProfile={(userId: string) => setViewingFriendProfileId(userId)}
                                onFriendAccepted={() => refreshAllSessions({ showLoading: false })}
                                openDirectMessageWithUserId={pendingOpenDmUserId}
                                onOpenDirectMessageHandled={() => setPendingOpenDmUserId(null)}
                              />
                            </View>
                            <View style={currentPage === 'saved' ? styles.tabVisible : styles.tabHidden}>
                              <SavedExperiencesPage
                                isTabVisible={currentPage === 'saved'}
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
                            </View>
                            <View style={currentPage === 'likes' ? styles.tabVisible : styles.tabHidden}>
                              <LikesPage
                                isTabVisible={currentPage === 'likes'}
                                savedCards={savedCards}
                                isLoadingSavedCards={isLoadingSavedCards}
                                isSavedCardsError={isSavedCardsError}
                                onRetrySavedCards={refetchSavedCards}
                                isLoadingCalendarEntries={isLoadingCalendarEntries}
                                calendarEntries={calendarEntries}
                                userPreferences={userPreferences}
                                accountPreferences={accountPreferences}
                                navigationData={likesNavData}
                                onNavigationComplete={() => setLikesNavData(null)}
                                onPurchaseFromSaved={(card: any, purchaseOption: any) => {
                                  console.log("Purchasing from saved:", card, purchaseOption);
                                }}
                                onRemoveFromCalendar={handlers.handleRemoveFromCalendar}
                                onShareCard={handlers.handleShareCard}
                                onAddToCalendar={(entry: any) => {
                                  console.log("Adding to calendar:", entry);
                                }}
                                onShowQRCode={(entryId: string) => {
                                  console.log("Showing QR code for:", entryId);
                                }}
                              />
                            </View>
                            <View style={currentPage === 'profile' ? styles.tabVisible : styles.tabHidden}>
                              <ProfilePage
                                isTabVisible={currentPage === 'profile'}
                                onSignOut={async () => {
                                  logger.action('Sign out pressed');
                                  await handleSignOut();
                                }}
                                onUserIdentityUpdate={handleUserIdentityUpdate}
                                onNavigateToActivity={handlers.handleNavigateToActivity}
                                onNavigateToConnections={() => {
                                  logger.action('Navigate to connections from profile');
                                  setCurrentPage("connections");
                                }}
                                savedExperiences={savedCards?.length || 0}
                                boardsCount={boardsSessions?.length || 0}
                                notificationsEnabled={notificationsEnabled}
                                onNotificationsToggle={handlers.handleNotificationsToggle}
                                userIdentity={userIdentity}
                              />
                            </View>
                          </View>
                        )}
                      </View>

                      {/* Coach Mark Spotlight Overlay */}
                      <SpotlightOverlay />

                      {/* Bottom Navigation — full-bleed: bg extends behind gesture bar */}
                      <CoachMarkNavigationGate layout={layout}>
                        <View style={styles.navigationContainer}>
                          <TouchableOpacity
                            onPress={() => {
                              logger.action('Tab pressed: home');
                              closeProfileOverlays();
                              setCurrentPage("home");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="home-outline"
                                size={TAB_BAR_ICON_SIZE}
                                color={
                                  currentPage === "home" ? "#eb7825" : "#9CA3AF"
                                }
                              />
                            </View>
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "home"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              {t('navigation:tabs.explore')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              logger.action('Tab pressed: discover');
                              closeProfileOverlays();
                              setCurrentPage("discover");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="compass-outline"
                                size={TAB_BAR_ICON_SIZE}
                                color={
                                  currentPage === "discover" ? "#eb7825" : "#9CA3AF"
                                }
                              />
                            </View>
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "discover"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              {t('navigation:tabs.discover')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              logger.action('Tab pressed: connections');
                              closeProfileOverlays();
                              setCurrentPage("connections");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="chatbubbles-outline"
                                size={TAB_BAR_ICON_SIZE}
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
                              {t('navigation:tabs.chats')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              logger.action('Tab pressed: likes');
                              closeProfileOverlays();
                              setCurrentPage("likes");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="heart-outline"
                                size={TAB_BAR_ICON_SIZE}
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
                              {t('navigation:tabs.likes')}
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
                              logger.action('Tab pressed: profile');
                              closeProfileOverlays();
                              setCurrentPage("profile");
                            }}
                            style={styles.navItem}
                          >
                            <View style={styles.navIconContainer}>
                              <Ionicons
                                name="person-outline"
                                size={TAB_BAR_ICON_SIZE}
                                color={
                                  currentPage === "profile"
                                    ? "#eb7825"
                                    : "#9CA3AF"
                                }
                              />
                            </View>
                            <Text
                              style={[
                                styles.navText,
                                currentPage === "profile"
                                  ? styles.navTextActive
                                  : styles.navTextInactive,
                              ]}
                            >
                              {t('navigation:tabs.profile')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </CoachMarkNavigationGate>
                    </View>

                    {/* Share Modal */}
                    <ShareModal
                      isOpen={showShareModal}
                      onClose={() => { logger.action('Share modal closed'); setShowShareModal(false) }}
                      experienceData={shareData?.experienceData}
                      dateTimePreferences={shareData?.dateTimePreferences}
                      userPreferences={userPreferences}
                      accountPreferences={accountPreferences}
                    />



                    {/* Post-Experience Review Modal — locked modal for voice reviews */}
                    {pendingReview && (
                      <PostExperienceModal
                        visible={showReviewModal}
                        review={pendingReview}
                        onComplete={() => {
                          dismissReview();
                          // Check for next pending review after a brief delay
                          setTimeout(() => recheckPending(), 1000);
                        }}
                      />
                    )}

                  </View>
                </ErrorBoundary>

                {showCollabPreferences && currentMode !== "solo" && currentSessionId ? (
          <ErrorBoundary>
            <PreferencesSheet
              visible={true}
              onClose={() => {
                logger.action('Close collab preferences');
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
        ) : showPreferences ? (
          <ErrorBoundary>
            <PreferencesSheet
              visible={true}
              onClose={() => {
                logger.action('Close preferences');
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
                ) : null}

              </CoachMarkProvider>
              </NavigationProvider>
            </MobileFeaturesProvider>
          </RecommendationsProvider>
        </CardsCacheProvider>
        <ToastContainer />
      </ToastProvider>
      </>
    );
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "white",
  },
  profileLoadingContainer: {
    flex: 1,
    backgroundColor: colors.gray50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileLoadingInner: {
    alignItems: 'center',
  },
  profileLoadingIcon: {
    width: 64,
    height: 64,
    backgroundColor: colors.primary,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileLoadingEmoji: {
    color: colors.white,
    fontSize: 24,
  },
  profileLoadingText: {
    color: colors.gray500,
    fontSize: 16,
  },
  container: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
  },
  tabVisible: {
    flex: 1,
  },
  tabHidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    pointerEvents: 'none',
  },
  bottomNavigation: {
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
    zIndex: 1,
    elevation: 1,
  },
  navigationContainer: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    paddingHorizontal: s(8),
    height: vs(56),
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(5),
    borderRadius: 8,
  },
  navIconContainer: {
    position: "relative",
    width: ms(22),
    height: ms(22),
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: ms(18),
    height: ms(18),
    backgroundColor: "#eb7825",
    borderRadius: ms(9),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "white",
  },
  tabBadgeText: {
    fontSize: ms(10),
    color: "white",
    fontWeight: "700",
  },
  tabBadgeDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: ms(8),
    height: ms(8),
    backgroundColor: "#eb7825",
    borderRadius: ms(4),
    borderWidth: 1.5,
    borderColor: "white",
  },
  navText: {
    fontSize: ms(10),
    marginTop: vs(2),
  },
  navTextActive: {
    color: "#eb7825",
    fontWeight: "600",
  },
  navTextInactive: {
    color: "#9CA3AF",
  },
  // Floating Help Button styles
  floatingButtonContainer: {
    position: "absolute",
    // bottom is applied inline via layout.bottomNavTotalHeight + vs(24)
    right: s(24),
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
});

function App() {
  // Gate: clear oversized React Query persisted cache BEFORE provider mounts.
  // PersistQueryClientProvider crashes on mount if the cache exceeds Android's 2MB CursorWindow.
  // Only clear if the cache actually exceeds the safety threshold (1.5MB).
  // The shouldDehydrateQuery filter already excludes heavy queries, so the cache
  // should stay small. Preserving it enables instant startup with cached prefs/location.
  const [cacheReady, setCacheReady] = React.useState(false);
  const [splashDone, setSplashDone] = React.useState(false);

  React.useEffect(() => {
    const MAX_CACHE_BYTES = 1_500_000; // 1.5MB — below Android's 2MB CursorWindow limit
    AsyncStorage.getItem('REACT_QUERY_OFFLINE_CACHE')
      .then((cached) => {
        if (cached && cached.length > MAX_CACHE_BYTES) {
          return AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        }
      })
      .catch(() => {})
      .finally(() => setCacheReady(true));
  }, []);

  // AnimatedSplashScreen renders immediately (before cacheReady) so that
  // its own useEffect fires as soon as it's painted — that's when it calls
  // SplashScreen.hideAsync(). This guarantees the native splash is never
  // dismissed before the React replacement is committed to screen.
  return (
    <>
      {cacheReady && (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours

            dehydrateOptions: {
              // Exclude large/transient queries from persistence to prevent
              // Android CursorWindow overflow (2MB SQLite row limit)
              shouldDehydrateQuery: (query) => {
                const queryKey = query.queryKey;

                if (Array.isArray(queryKey)) {
                  const firstKey = queryKey[0];
                  // Never persist these heavy/transient queries:
                  // - curated-experiences: very large payload (20 cards × 3 stops)
                  // - recommendations: deprecated/redundant key
                  // - phone-lookup: ephemeral keystroke-driven
                  // - link-consent: transient
                  // NOTE: deck-cards, savedCards, calendarEntries are now PERSISTED
                  // to enable instant-on stale-while-revalidate UX.
                  if (
                    firstKey === "curated-experiences" ||
                    firstKey === "recommendations" ||
                    firstKey === "phone-lookup" ||
                    firstKey === "link-consent"
                  ) {
                    return false;
                  }
                }
                // Never persist queries that are still fetching — their promises
                // can't be serialized and cause "promise.then is not a function"
                // crash during hydration on next app launch
                if (query.state.fetchStatus === 'fetching') {
                  return false;
                }

                // Persist lightweight queries (preferences, location, etc.)
                return true;
              },
            },
          }}
        >
          <AppContent />
        </PersistQueryClientProvider>
      )}
      {!splashDone && (
        <AnimatedSplashScreen onDone={() => setSplashDone(true)} />
      )}
    </>
  );
}

export default Sentry.wrap(App);
