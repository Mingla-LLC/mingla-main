import * as Sentry from "@sentry/react-native";
import Feather from "@expo/vector-icons/Feather";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { vs, ms, s } from "../src/utils/responsive";
import { GlassBottomNav, type BottomNavPage } from "../src/components/GlassBottomNav";
import { useAppLayout } from "../src/hooks/useAppLayout";
import * as Linking from "expo-linking";
import { useStripe } from "@stripe/stripe-react-native";
import { useAppHandlers } from "../src/components/AppHandlers";
import { useAppState } from "../src/components/AppStateManager";
import { useFriends } from "../src/hooks/useFriends";
import ErrorBoundary from "../src/components/ErrorBoundary";
import HomePage from "../src/components/HomePage";
import DiscoverScreen from "../src/components/DiscoverScreen";
// ORCH-1016 — in-app trip detail overlay + its seed type.
import ConsumerTripDetailScreen from "../src/screens/Trip/ConsumerTripDetailScreen";
import type { DiscoverTripRow } from "../src/services/tripsDiscoveryService";
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
import { useBottomNavHidden } from "../src/store/bottomNavStore";
import { messagingService } from "../src/services/messagingService";
import { BoardMessageService } from "../src/services/boardMessageService";
import { muteService } from "../src/services/muteService";
import ShareModal from "../src/components/ShareModal";

import PostExperienceModal from "../src/components/PostExperienceModal";
import { usePostExperienceCheck } from "../src/hooks/usePostExperienceCheck";
import { CoachMarkProvider, useCoachMarkContext } from "../src/contexts/CoachMarkContext";
import { useCoachMark } from "../src/hooks/useCoachMark";
import SpotlightOverlay from "../src/components/SpotlightOverlay";
import { CustomPaywallScreen } from "../src/components/CustomPaywallScreen";
import { configureRevenueCat, loginRevenueCat, logoutRevenueCatIfIdentified } from "../src/services/revenueCatService";
import {
  initializeOneSignal,
  loginToOneSignal,
  logoutOneSignal,
  onNotificationClicked,
  onForegroundNotification,
} from "../src/services/oneSignalService";
import { initializeAppsFlyer, setAppsFlyerUserId, registerAppsFlyerDevice, logAppsFlyerEvent } from "../src/services/appsFlyerService";
import { useCustomerInfoListener } from "../src/hooks/useRevenueCat";
import { useTrialExpiryTracking } from "../src/hooks/useSubscription";
import * as SplashScreen from 'expo-splash-screen';
import AppLoadingScreen from '../src/components/AppLoadingScreen';


// ORCH-1125: PersistQueryClientProvider + AnimatedSplashScreen + asyncStoragePersister
// + shouldDehydrateMinglaQuery imports were removed here when the provider/gate/splash
// apparatus moved to app/_layout.tsx. `queryClient` is retained — it is still used by
// this route (prefetchQuery + dismissCollaborationInviteNotifications).
import { queryClient } from "../src/config/queryClient";
import { BoardSessionService } from "../src/services/boardSessionService";
import { supabase } from "../src/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../src/constants/colors";
import { logger } from "../src/utils/logger";
// V2: inAppNotificationService is no longer imported — server-synced notifications
// are handled by useNotifications hook + Supabase Realtime. The old service file
// stays in place but is no longer referenced from the app root.
import { mixpanelService } from "../src/services/mixpanelService";
// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — PostHog runs ALONGSIDE
// Mixpanel/AppsFlyer (parallel run; do NOT remove them). Event-name strings are
// kept IDENTICAL across PostHog/Mixpanel so the eventual Mixpanel retirement is
// a 1:1 mapping.
import { postHogService } from "../src/services/postHogService";
import { useTranslation } from 'react-i18next';
import i18n from '../src/i18n';
import { persistLanguage } from '../src/i18n';
import { useForegroundRefresh } from "../src/hooks/useForegroundRefresh";
import { useOtaUpdates } from "../src/hooks/useOtaUpdates";
import { OtaUpdateBanner } from "../src/components/ui/OtaUpdateBanner";
import RealtimeSubscriptions from "../src/components/RealtimeSubscriptions";
import * as friendsService from "../src/services/friendsService";
import { parseDeepLink, executeDeepLink, typeFallbackDestination, type NavigationHandlers } from "../src/services/deepLinkService";
import {
  dismissCollaborationInviteNotifications,
  type ServerNotification,
} from "../src/hooks/useNotifications";

type Friend = {
  id: string;
  name?: string;
  username?: string;
  avatar?: string | null;
  status?: string;
};

const TAB_BAR_ICON_SIZE = ms(20);

/** Wraps the tab bar and disables it when the coach mark is loading, pending, or active.
 *  ORCH-0589 v6 (U1) + v6.2 tune: paddingBottom: 6 — slim safety gap above the home
 *  indicator zone. v6 had 0 (flush); v6.1 tried 5px; v6.2 bumped to 6px for a touch more
 *  breathing room. `layout.bottomNavPadding` prop kept for rollback. */
function CoachMarkNavigationGate({ layout, children }: { layout: any; children: React.ReactNode }) {
  const { isCoachLoading, isCoachPending, isCoachActive } = useCoachMarkContext();
  const locked = isCoachLoading || isCoachPending || isCoachActive;
  // ORCH-0610 fix: iOS overlaps the home-indicator zone for tight bezel-hugging;
  // Android respects insets.bottom so the nav clears the system navigation panel
  // (gesture bar or 3-button nav).
  const navBottom = Platform.OS === 'android' ? layout.insets.bottom + 6 : 11;
  return (
    <View
      style={[
        styles.bottomNavigation,
        { bottom: navBottom, paddingBottom: 0 },
      ]}
      pointerEvents={locked ? 'none' : 'auto'}
    >
      {children}
    </View>
  );
}

/**
 * ORCH-0635: GlassBottomNav wrapped with the step-3 (Likes tab) coach-mark hook.
 * Must live UNDER CoachMarkProvider — AppContent itself runs OUTSIDE the provider
 * because the provider is mounted inside AppContent's return JSX. This wrapper
 * renders inside the provider's subtree so the hook resolves correctly.
 */
function GlassBottomNavWithCoach(
  props: Omit<React.ComponentProps<typeof GlassBottomNav>, 'coachLikesRef'>,
): React.ReactElement {
  const coachLikes = useCoachMark(3, 12);
  return <GlassBottomNav {...props} coachLikesRef={coachLikes.targetRef} />;
}

// ── ORCH-0679 Wave 2B-2: Sentry init moved to app/_layout.tsx ───────────────
// I-SENTRY-SINGLE-INIT — Sentry.init() must be called exactly once across the
// entire app-mobile/ codebase. The previous duplicate init here was deleted;
// configs (enableNativeFramesTracking, enableAutoSessionTracking, tracesSampleRate,
// maxBreadcrumbs, enabled:!__DEV__) are merged into _layout.tsx.
// CI gate: scripts/ci/check-single-sentry-init.sh.
// ─────────────────────────────────────────────────────────────────────────────

function AppContent() {
  const state = useAppState();
  const handlers = useAppHandlers(state);
  // ORCH-0679 Wave 2.5: useAppHandlers returns a fresh object every render
  // (audit D-WAVE2-IMPL-2 / TS-1.5 — fix deferred to a separate wave). To let
  // useCallback wraps below have stable identity without busting on `handlers`
  // as a dep, callbacks read handlers via this ref. The ref is updated every
  // render so the latest handlers are always used inside callback bodies.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const layout = useAppLayout();
  // ORCH-1016 — hide the floating nav while a full detail/checkout sheet is open.
  const bottomNavHidden = useBottomNavHidden();
  const { t } = useTranslation(['navigation', 'common']);

  // ORCH-0837: Stripe URL-callback handler. Used by the Linking listener
  // below to forward Stripe redirect URLs (Apple Pay return, 3DS return,
  // future re-enabled BNPL/wallet redirects) into Stripe's SDK so the
  // PaymentSheet completion handler resolves. Without this wiring,
  // presentPaymentSheet would hang indefinitely after any redirect-method
  // selection (proven by operator's failed PIs which attached Klarna,
  // Affirm, Cash App, Amazon Pay before the card-only fix shipped in this
  // same ORCH). Invariant: I-PROPOSED-STRIPE-CALLBACK-WIRED.
  // useStripe() must be called inside <StripeNativeProvider> tree — that
  // wrapping happens in app/_layout.tsx, so AppContent is a valid descendant.
  const { handleURLCallback } = useStripe();

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

  const [totalUnreadMessages, setTotalUnreadMessages] = useState<number>(0);
  // ORCH-1016 — in-app trip detail overlay slot (mirrors viewingFriendProfileId).
  const [viewingTrip, setViewingTrip] = useState<{
    brandSlug: string;
    tripSlug: string;
    seed: DiscoverTripRow | null;
  } | null>(null);
  const handleOpenTripFromDiscover = useCallback((seed: DiscoverTripRow): void => {
    setViewingTrip({ brandSlug: seed.brandSlug, tripSlug: seed.tripSlug, seed });
  }, []);
  const [totalUnreadBoardMessages, setTotalUnreadBoardMessages] =
    useState<number>(0);
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);
  const [showPaywall, setShowPaywall] = useState<boolean>(false);
  // ORCH-1080: session deep-link target removed. A session/collab notification
  // now lands in the session's GROUP CHAT (Messages tab) via the `session`
  // executor branch in deepLinkService (setDeepLinkParams({tab:'messages',
  // sessionId}) + setCurrentPage('connections')), where ConnectionsPage resolves
  // sessionId → group conversation and the in-chat CTA reaches the deck
  // (META-ORCH-0929: deck lives in CollabDeckSheet, not Home). The former
  // ORCH-1030 Home-landing session seam was a no-op and is deleted.
  const [pendingOpenDmUserId, setPendingOpenDmUserId] = useState<string | null>(null);
  const [pendingConnectionsPanel, setPendingConnectionsPanel] = useState<"friends" | "add" | "blocked" | null>(null);
  const [collabPreferencesTarget, setCollabPreferencesTarget] = useState<{
    sessionId: string;
    sessionName: string;
  } | null>(null);

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
    // META-ORCH-1187 — init PostHog alongside Mixpanel (idempotent; the root
    // provider also calls this). No-ops gracefully when the key is absent.
    void postHogService.initialize();
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
      logoutRevenueCatIfIdentified().catch((err) =>
        console.warn("[RevenueCat] logoutRevenueCatIfIdentified failed:", err)
      );
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
  // Initialize once at mount with manualStart: true — SDK loads but does not
  // transmit until startAppsFlyer() is called. Transmission begins after the
  // coach mark tour completes (or is skipped) via permissionOrchestrator,
  // which fires the iOS ATT prompt first, then starts AppsFlyer with the
  // now-resolved IDFA state, then fires the OneSignal push permission prompt.
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
    // ORCH-1030: the push routing handlers — same NavigationHandlers shape as the
    // in-app `notificationHandlers`, including setDeepLinkParams +
    // setViewingFriendProfileId (previously absent here, which is why push
    // session/profile taps silently failed). All members are React-stable
    // setState setters, safe to capture in this mount-once effect closure.
    // ORCH-1080: the session-open handler was removed — session taps now route
    // to the group chat via setDeepLinkParams({tab:'messages', sessionId}).
    const pushNavigationHandlers: NavigationHandlers = {
      setCurrentPage: setCurrentPage as (page: string) => void,
      setViewingFriendProfileId: (id: string) => setViewingFriendProfileId(id),
      setShowPaywall: (show: boolean) => setShowPaywall(show),
      setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
    };

    /**
     * V2 processNotification: handles push data from OneSignal.
     * Server already created the notification row — we just mark as read and navigate.
     */
    function processNotification(data: Record<string, unknown>) {
      if (!userIdRef.current) {
        // Stash the deep link for after auth.
        // ORCH-1030 F-13: ALSO persist to AsyncStorage (same key/shape as the OS
        // Linking path) so a tap that triggers a COLD launch survives the
        // auth+onboarding gate and replays at the onboarding-gated effect — the
        // in-memory ref alone is lost on a cold start. The paired_user_saved_card
        // synthetic URL is dropped: the typed profile/pairedDeck routes now handle
        // it from `data.deepLink` (or the type fallback) directly.
        const stashUrl = (data.deepLink as string | undefined) ?? null;
        if (stashUrl) {
          pendingDeepLinkRef.current = stashUrl;
          AsyncStorage.setItem(
            'mingla_deferred_deeplink',
            JSON.stringify({ url: stashUrl, ts: Date.now() })
          ).catch((err) => {
            console.warn('[processNotification] Failed to persist cold-start deep link:', err);
          });
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

      // ORCH-1030: ONE canonical pipeline, identical to the in-app sheet tap —
      // server deepLink first, typed fallback second. The paired_user_saved_card
      // push special-case is DELETED; `data.deepLink` (mingla://discover?paired=
      // true) routes to the paired deck, and the type fallback resolves a
      // profile target from actor_id when there is no deepLink. `setPendingSession
      // Open` + `setViewingFriendProfileId` are now wired so push session/profile
      // taps actually reach the container (previously missing — push session/
      // profile taps silently failed). `navigationTarget` (legacy NAV_TARGETS
      // string) is no longer needed — the typed fallback covers every type.
      const dest = (deepLink ? parseDeepLink(deepLink) : null)
        ?? typeFallbackDestination(data.type as string, data);
      executeDeepLink(dest, pushNavigationHandlers);
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

    // ORCH-1030: the legacy `NAV_TARGETS` string→page fallback map is DELETED.
    // It was the third routing authority (alongside parseDeepLink and the in-app
    // special-cases) and could disagree with both. Its job is now done by the
    // typed `typeFallbackDestination(type, data)` in deepLinkService, which
    // returns the SAME `Destination` kinds the parser produces (so push, in-app,
    // and deferred replay can never diverge — I-NOTIF-FALLBACK-AGREES).

    // ORCH-0407: NO foreground listener registered. Without a listener, the
    // OneSignal native SDK auto-displays ALL push notifications in the system
    // tray, even when the app is foregrounded (RNOneSignal.java:380-382).
    //
    // Previously a foregroundWillDisplay listener was registered that called
    // prevent() on non-message types. This was a design choice (not a bug fix)
    // to avoid "double notification" (push banner + Realtime in-app). Removed
    // because: (1) the user wants the app to feel alive, (2) OneSignal SDK v5.3.3
    // has a timing bug where display() from JS arrives after the native callback
    // returns — making JS-controlled display impossible.
    //
    // If filtering is needed later, use Android notification channels (OS-level
    // control) instead of the SDK's broken foreground listener.
    //
    // History: added in f224813f (Notifications V2), removed in ORCH-0407.

    // Background/tap: user taps a push notification
    const removeClicked = onNotificationClicked((data) => {
      if (!data?.type) return;
      processNotification(data);
    });

    // ORCH-0448D: Foreground push handler — reacts to pushes while app is active.
    // Session-deleted pushes now display only; collab decks live in their group chat.
    // Uses refs to avoid stale closure over state.
    const removeForeground = onForegroundNotification((data, prevent, display) => {
      if (data.type === 'session_deleted') {
        display();
        return;
      }
      // All other notification types: show the system banner as normal
      display();
    });

    return () => {
      removeClicked();
      removeForeground();
    };
  }, []);

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

  // V2: Process pending deep link after auth resolves (warm-process login —
  // the user was signed out when the push arrived but did NOT cold-launch, so
  // the in-memory ref survived). ORCH-1030: routes through the ONE canonical
  // pipeline with the FULL handler set (setDeepLinkParams +
  // setViewingFriendProfileId included) so a deferred session/profile tap
  // reaches its container instead of silently no-op'ing. ORCH-1080: session taps
  // route to the group chat via setDeepLinkParams. The legacy ORCH-0435
  // paired→notificationId-lookup branch is removed: no producer emits
  // `notificationId` in the deepLink, and `mingla://discover?paired=true` now
  // parses to the typed `pairedDeck` Destination directly.
  useEffect(() => {
    if (user?.id && pendingDeepLinkRef.current) {
      const dest = parseDeepLink(pendingDeepLinkRef.current);
      executeDeepLink(dest, {
        setCurrentPage: setCurrentPage as (page: string) => void,
        setViewingFriendProfileId: (id: string) => setViewingFriendProfileId(id),
        setShowPaywall: (show: boolean) => setShowPaywall(show),
        setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
      });
      pendingDeepLinkRef.current = null;
    }
  }, [user?.id]);

  // OTA update checker — checks on foreground resume, shows banner when ready. ORCH-0406.
  const { isUpdateReady, isDismissed, checkForUpdate, applyUpdate, dismissBanner } = useOtaUpdates();

  // Centralized foreground resume: auth-first sequence, aggressive Realtime remount,
  // query invalidation AFTER auth, refreshAllSessions gated on valid JWT.
  // See useForegroundRefresh for the full resume state machine. ORCH-0336.
  const { resumeCount, realtimeEpoch } = useForegroundRefresh(user?.id, () => {
    refreshAllSessions();
  }, checkForUpdate);

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
  const abandonedFiredRef = useRef(false);
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
      // META-ORCH-1187 — bind PostHog identity (distinct_id = Supabase user.id,
      // SC-7) at the SAME site Mixpanel identifies.
      postHogService.identify(user.id, {
        provider: (user as any).app_metadata?.provider ?? "email",
        onboarding_completed: profile?.has_completed_onboarding ?? false,
      });

      // Track Signup Completed for new users (not yet onboarded)
      if (!profile?.has_completed_onboarding && !signupFiredRef.current) {
        mixpanelService.trackSignupCompleted({
          method: (user as any).app_metadata?.provider ?? 'email',
          country: profile?.country ?? undefined,
        });
        // META-ORCH-1187 — signup conversion (event name identical to the
        // Mixpanel intent for a clean 1:1 retirement mapping later).
        postHogService.capture("signup_completed", {
          method: (user as any).app_metadata?.provider ?? "email",
          country: profile?.country ?? undefined,
        });
        signupFiredRef.current = true;
      }

      // Detect Onboarding Abandoned — user started onboarding before but hasn't completed
      if (!profile?.has_completed_onboarding && !abandonedFiredRef.current) {
        import("../src/utils/onboardingPersistence").then(({ loadOnboardingData }) => {
          loadOnboardingData().then((saved) => {
            if (saved && !abandonedFiredRef.current) {
              mixpanelService.track("Onboarding Abandoned", {
                last_step: (saved as any).step ?? "unknown",
              });
              abandonedFiredRef.current = true;
            }
          }).catch(() => {});
        }).catch(() => {});
      }
    }
  }, [isAuthenticated, user?.id, profile?.has_completed_onboarding]);

  // Transform friends to Friend format for session creation
  // dbFriends from useFriends has: id, friend_user_id, username, display_name, first_name, last_name, avatar_url
  // ORCH-0679 Wave 2.7 RC-2: useMemo wrap — without it, the .map() rebuilt a fresh
  // array every render, busting HomePage memo on every parent re-render
  // (independent of TS-1.5 / handlers.X). Forensics audit confirmed this was the
  // second root cause of the post-Wave-2 render storm.
  const availableFriendsForSessions = useMemo<Friend[]>(
    () => (dbFriends || []).map((friend: any) => ({
      id: friend.friend_user_id || friend.id,
      name: friend.display_name ||
            (friend.first_name && friend.last_name ? `${friend.first_name} ${friend.last_name}` : null) ||
            friend.first_name ||
            friend.username ||
            'Unknown',
      username: friend.username,
      avatar: friend.avatar_url,
      status: 'offline' as const,
    })),
    [dbFriends]
  );

  // ORCH-1030: the single NavigationHandlers object shared by EVERY routing
  // call site — in-app sheet tap, OneSignal push tap, OS Linking, and the
  // deferred onboarding-gated replay. Threading one object guarantees in-app
  // and push produce identical navigation (kills the 3-authority drift).
  // All members are React-stable setState setters, so this memo never changes.
  const notificationHandlers = useMemo<NavigationHandlers>(() => ({
    setCurrentPage: setCurrentPage as (page: string) => void,
    setViewingFriendProfileId: (id: string) => setViewingFriendProfileId(id),
    setShowPaywall: (show: boolean) => setShowPaywall(show),
    setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
  }), [setCurrentPage, setViewingFriendProfileId, setShowPaywall, setDeepLinkParams]);

  // ORCH-1080: the former ORCH-1030 Home-landing session effect is
  // deleted. Session/collab notifications now route to the session's group chat
  // (Messages tab) via deepLinkService's `session` executor branch; the deck is
  // reached via the in-chat CTA (META-ORCH-0929). No Home seam remains.

  // Handle notification tap → navigate to the relevant page (V2: ServerNotification)
  // ORCH-0679 Wave 2.5: useCallback-wrapped — all closure deps are setState
  // setters (React-stable) so identity is permanently stable.
  const handleNotificationNavigate = useCallback((notification: ServerNotification) => {
    const deepLink = notification.data?.deepLink as string | undefined;
    logger.action('Notification tapped', { type: notification.type, deepLink });

    // ORCH-1030: ONE canonical pipeline — server deepLink first, typed
    // fallback second. The legacy in-app special-cases (paired_user_*,
    // holiday_reminder, friend_request_*, pair_request_*, direct_message_*)
    // and the collaboration_/session_ → Connections misroute (F-01) are
    // DELETED; their targets are expressed as parser routes / typed-fallback
    // Destinations so the server link is genuinely canonical and the in-app
    // path can never disagree with the push path.
    //
    // `notification.data` carries the entity ids (sessionId, conversationId,
    // actor_id, …). Fold actor_id into the fallback data so the typed fallback
    // can resolve a paired/DM/profile target when there is no deepLink.
    const fallbackData: Record<string, unknown> = {
      ...(notification.data ?? {}),
      ...(notification.actor_id ? { actor_id: notification.actor_id } : {}),
    };
    const dest = (deepLink ? parseDeepLink(deepLink) : null)
      ?? typeFallbackDestination(notification.type, fallbackData);
    executeDeepLink(dest, notificationHandlers);
  }, [notificationHandlers]);

  // Helper function to refresh all sessions (active + pending)
  // ORCH-0679 Wave 2A: useCallback-wrapped so its identity is stable across renders.
  // Without this, every parent re-render rebuilds this fn → all consumers (HomePage,
  // ConnectionsPage props) see a new ref → memo barriers bust → render storm.
  const refreshAllSessions = useCallback(async (options?: { showLoading?: boolean }) => {
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

      // ORCH-0437: Fetch profiles for pending session participants so the invite
      // modal can show names and acceptance status.
      const allPendingParticipantIds = new Set<string>();
      for (const s of (createdPendingSessions || [])) {
        for (const p of (s.session_participants || [])) {
          if (p.user_id !== user.id) allPendingParticipantIds.add(p.user_id);
        }
      }
      let pendingParticipantProfiles: Record<string, any> = {};
      if (allPendingParticipantIds.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, username, avatar_url')
          .in('id', Array.from(allPendingParticipantIds));
        for (const p of (profiles || [])) {
          pendingParticipantProfiles[p.id] = p;
        }
      }

      // Transform pending created sessions
      // Only include sessions where the user is actually a participant (prevents ghost sessions
      // from failed creation attempts from appearing as duplicate pills)
      const pendingCreatedSessions = (createdPendingSessions || [])
        .filter((s: any) =>
          (s.session_participants || []).some((p: any) => p.user_id === user.id)
        )
        .map((s: any) => {
          const participantsWithProfiles = (s.session_participants || [])
            .filter((p: any) => p.user_id !== user.id)
            .map((p: any) => {
              const profile = pendingParticipantProfiles[p.user_id];
              const name = profile
                ? (profile.first_name && profile.last_name
                    ? `${profile.first_name} ${profile.last_name}`
                    : profile.first_name || profile.username || 'Invited')
                : 'Invited';
              return {
                user_id: p.user_id,
                id: p.user_id,
                name,
                avatar_url: profile?.avatar_url,
                has_accepted: p.has_accepted,
              };
            });

          return {
            id: s.id,
            name: s.name,
            status: s.status,
            creatorId: s.created_by,
            created_by: s.created_by,
            participants: participantsWithProfiles,
            createdAt: s.created_at,
          };
        });

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

      // Combine and deduplicate by id.
      // ORCH-0437: pendingCreatedSessions and pendingInvitedSessions come FIRST so their
      // status='pending' wins dedup over activeBoards (which maps pending→active).
      // Without this, the creator's pending session appears as 'active' and can be opened
      // before any invitee has accepted.
      const allSessions = [...pendingCreatedSessions, ...pendingInvitedSessions, ...activeBoards];
      const uniqueSessions = allSessions.reduce((acc: any[], session: any) => {
        if (!acc.find((s: any) => s.id === session.id)) {
          acc.push(session);
        }
        return acc;
      }, []);

      // ORCH-0666: enrich each session with `pendingInviteeIds` — the friend IDs
      // for whom the current user has outstanding pending invites. AddToBoardModal
      // uses this to filter out friends who already have a pending invite to a
      // given session (CF-2 close — pre-flight idempotency UX).
      // Caller-scoped only (current user is the inviter); cross-user pending
      // invitees are not surfaced — the RPC's `already_invited` outcome handles
      // those cases gracefully at confirm time.
      let pendingByInviter: { session_id: string; invited_user_id: string }[] = [];
      try {
        const { data: pendingRows } = await supabase
          .from('collaboration_invites')
          .select('session_id, invited_user_id')
          .eq('inviter_id', user.id)
          .eq('status', 'pending');
        pendingByInviter = pendingRows || [];
      } catch (e) {
        // Non-fatal — filter just becomes a no-op.
        console.warn('[refreshAllSessions] pendingInviteeIds fetch failed:', e);
      }
      const pendingMap = new Map<string, string[]>();
      for (const row of pendingByInviter) {
        const list = pendingMap.get(row.session_id) ?? [];
        list.push(row.invited_user_id);
        pendingMap.set(row.session_id, list);
      }
      const enriched = uniqueSessions.map((s: any) => ({
        ...s,
        pendingInviteeIds: pendingMap.get(s.id) ?? [],
      }));

      updateBoardsSessions(enriched);
    } finally {
      // Only clear loading if this is still the current generation.
      // If a newer call took over, it will clear loading when it finishes.
      if (generation === refreshGenerationRef.current) {
        setIsLoadingBoards(false);
      }
    }
  }, [user?.id, updateBoardsSessions, setIsLoadingBoards]);

  // ORCH-0679 Wave 2.5: useCallback-wrapped. Body uses handlers.handleModeChange
  // via handlersRef.current; refreshAllSessions is already useCallback-wrapped
  // from Wave 2A. Other deps are setState setters (React-stable) and user?.id.
  const handleCreateGroupChat = useCallback(async (sessionName: string, selectedFriends: Friend[] = [], phoneInvitees?: { phoneE164: string }[]) => {
    if (!user?.id) throw new Error('You must be signed in to create a group chat.');
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
        throw new Error('A collaboration session already exists with that name.');
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

      // ORCH-0446B: Write creator's solo prefs to session JSONB
      try {
        const { data: soloPrefs } = await supabase
          .from('preferences')
          .select('*')
          .eq('profile_id', user.id)
          .maybeSingle();

        const { error: rpcError } = await supabase.rpc('upsert_participant_prefs', {
          p_session_id: session.id,
          p_user_id: user.id,
          p_prefs: {
            categories: soloPrefs?.categories?.length ? soloPrefs.categories : ['nature', 'drinks_and_music', 'icebreakers'],
            intents: soloPrefs?.intents ?? [],
            travel_mode: soloPrefs?.travel_mode ?? 'walking',
            travel_constraint_type: 'time',
            travel_constraint_value: soloPrefs?.travel_constraint_value ?? 30,
            date_option: soloPrefs?.date_option ?? null,
            datetime_pref: soloPrefs?.datetime_pref ?? null,
            selected_dates: soloPrefs?.selected_dates ?? null,
            use_gps_location: soloPrefs?.use_gps_location ?? true,
            custom_location: soloPrefs?.custom_location ?? null,
            custom_lat: soloPrefs?.custom_lat ?? null,
            custom_lng: soloPrefs?.custom_lng ?? null,
            intent_toggle: soloPrefs?.intent_toggle ?? true,
            category_toggle: soloPrefs?.category_toggle ?? true,
          },
        });
        if (rpcError) console.error('[index] Creator pref RPC error:', rpcError.message);
      } catch (err) {
        console.error('[index] Creator pref write failed:', err);
      }

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

      const { conversation, error: conversationError } =
        await messagingService.getOrCreateGroupConversationForSession(session.id);
      if (conversationError || !conversation?.id) {
        throw new Error(conversationError || 'Group chat was created but the conversation was not found.');
      }

      // Show success toast
      const friendCount = selectedFriends.length;
      const message = friendCount > 0 
        ? `Session "${sessionName}" created! Invites sent to ${successfulInvites} friend${successfulInvites > 1 ? 's' : ''}.`
        : `Session "${sessionName}" created successfully!`;
      toastManager.success(message);

      return { conversationId: conversation.id, sessionId: session.id };
    } catch (error) {
      console.error('Error creating session:', error);
      // Roll back the ghost session if it was inserted before the failure
      if (createdSessionId) {
        supabase.from('collaboration_sessions').delete().eq('id', createdSessionId).then(({ error: deleteError }) => {
          if (deleteError) console.error('Error cleaning up failed session:', deleteError);
        });
      }
      toastManager.error('Failed to create session. Please try again.');
      throw error;
    } finally {
      setIsCreatingSession(false);
    }
  }, [user?.id, refreshAllSessions, setIsCreatingSession]);

  const handleAcceptInvite = useCallback(async (sessionId: string, inviteId?: string) => {
    if (!user?.id) return;
    logger.action('Accept invite pressed', { sessionId });
    try {
      const { acceptCollaborationInvite } = await import('../src/services/collaborationInviteService');
      const result = await acceptCollaborationInvite({ userId: user.id, sessionId, inviteId });

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
  }, [user?.id, queryClient, refreshAllSessions]);

  // ORCH-0679 Wave 2.5: useCallback-wrapped.
  const handleDeclineInvite = useCallback(async (sessionId: string, inviteId?: string) => {
    if (!user?.id) return;
    logger.action('Decline invite pressed', { sessionId });
    try {
      const { declineCollaborationInvite } = await import('../src/services/collaborationInviteService');
      const result = await declineCollaborationInvite({ userId: user.id, sessionId, inviteId });

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
  }, [user?.id, queryClient, refreshAllSessions]);

  // Handle deep links for OAuth callback + Stripe redirect-flow completion.
  // ORCH-0837: route incoming URLs to Stripe's handleURLCallback FIRST so any
  // Stripe redirect-flow payment method (Apple Pay return, 3DS return, future
  // re-enabled Klarna/Affirm/Cash App/etc.) can complete properly. Stripe's
  // handleURLCallback returns `true` if it consumed the URL — in that case
  // we DO NOT fall through to handleDeepLink. If it returns `false`, the URL
  // is a Mingla deep link (OAuth, invite, etc.) and goes to the existing
  // handler. The Stripe callback URL is `com.mingla.app.v2://stripe-redirect`
  // per nativeCheckoutFlow.ts; OAuth uses paths under `auth/callback`;
  // invites use `/invite/...`. The three are non-overlapping.
  // The try/catch around handleURLCallback preserves the OAuth/invite flow
  // if any future Stripe SDK regression causes it to throw (Constitution #3:
  // no silent failures — the catch logs and falls through, never swallows).
  // Invariant: I-PROPOSED-STRIPE-CALLBACK-WIRED.
  useEffect(() => {
    // Handle initial URL (if app was opened via deep link)
    Linking.getInitialURL().then(async (url) => {
      if (!url) return;
      try {
        const handledByStripe = await handleURLCallback(url);
        if (!handledByStripe) {
          handleDeepLink(url);
        }
      } catch (err) {
        console.warn('[Deeplink] handleURLCallback threw; falling back to handleDeepLink', err);
        handleDeepLink(url);
      }
    });

    // Listen for deep links while app is running
    const subscription = Linking.addEventListener("url", async (event) => {
      try {
        const handledByStripe = await handleURLCallback(event.url);
        if (!handledByStripe) {
          handleDeepLink(event.url);
        }
      } catch (err) {
        console.warn('[Deeplink] handleURLCallback threw; falling back to handleDeepLink', err);
        handleDeepLink(event.url);
      }
    });

    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      return;
    }

    // ORCH-1030: OS Linking + the F-13 cold-start deferred replay (which calls
    // handleDeepLink with the persisted URL) route through the ONE canonical
    // pipeline with the FULL handler set — including setDeepLinkParams +
    // setViewingFriendProfileId — so a `mingla://session/{id}` (→ group chat,
    // ORCH-1080) or `mingla://profile/{id}` cold-start tap reaches its container.
    const action = parseDeepLink(url);
    executeDeepLink(action, {
      setCurrentPage: setCurrentPage as (page: string) => void,
      setViewingFriendProfileId: (id: string) => setViewingFriendProfileId(id),
      setShowPaywall: (show: boolean) => setShowPaywall(show),
      setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
    });
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


  // ─── ORCH-0679 Wave 2.6 — Hot-fix: hooks moved here from after early returns ───
  // Wave 2A originally placed these AFTER `if (!_hasHydrated...) return` (line ~2026
  // post-Wave-2.5), `if (showOnboardingFlow...)`, `if (!isAuthenticated)`, and
  // `if (user && !profile)` early-return guards. That caused a Rules of Hooks
  // violation when auth state transitioned (render 1: early return hit, hooks
  // never called; render 2: hooks called for the first time → "Rendered more
  // hooks than during the previous render"). Founder caught the crash on first
  // dev-client cold start. This relocation puts every hook above all early
  // returns. Static prevention: ESLint react-hooks/rules-of-hooks rule (added
  // to CI in this wave). closeProfileOverlays moved from line ~2438 too.
  // ─── ORCH-0679 Wave 2A — Hoisted tab props (I-TAB-PROPS-STABLE) ─────────────
  // Every prop passed to a memoized tab below MUST be a stable reference.
  // Inline arrow functions and object literals bust the React.memo barrier.
  // CI gate: scripts/ci/check-no-inline-tab-props.sh (region-scoped — see gate).

  const accountPreferencesMemo = useMemo(
    () => ({
      currency: accountPreferences?.currency || "USD",
      measurementSystem:
        (accountPreferences?.measurementSystem as "Metric" | "Imperial") || "Imperial",
    }),
    [accountPreferences?.currency, accountPreferences?.measurementSystem]
  );

  // ── Logging-only no-op handlers (no closure deps — empty array safe) ──
  const handleAddToCalendar = useCallback((experienceData: any) => {
    console.log("Add to calendar:", experienceData);
  }, []);
  const handlePurchaseComplete = useCallback((experienceData: any, purchaseOption: any) => {
    console.log("Purchase complete:", experienceData, purchaseOption);
  }, []);
  const handleGenerateNewMockCard = useCallback(() => {
    console.log("Generate new card");
  }, []);
  const handleScheduleFromSaved = useCallback((card: any) => {
    console.log("Scheduling from saved:", card);
  }, []);
  const handlePurchaseFromSavedSaved = useCallback((card: any, option: any) => {
    console.log("Purchasing from saved:", card, option);
  }, []);
  const handlePurchaseFromSavedLikes = useCallback((card: any, purchaseOption: any) => {
    console.log("Purchasing from saved:", card, purchaseOption);
  }, []);
  const handleAddToCalendarFromLikes = useCallback((entry: any) => {
    console.log("Adding to calendar:", entry);
  }, []);
  const handleShowQRCode = useCallback((entryId: string) => {
    console.log("Showing QR code for:", entryId);
  }, []);
  // ── State-touching handlers ──
  const handleResetCards = useCallback(() => {
    setRemovedCardIds([]);
  }, [setRemovedCardIds]);

  const handleOpenPreferences = useCallback(() => {
    logger.action('Open preferences pressed');
    setShowPreferences(true);
  }, [setShowPreferences]);

  const handleOpenCollabPreferences = useCallback((sessionId?: string, sessionName?: string) => {
    logger.action('Open collab preferences pressed');
    if (sessionId) {
      setCollabPreferencesTarget({
        sessionId,
        sessionName: sessionName || 'Collaboration session',
      });
      setShowCollabPreferences(true);
    }
  }, [setShowCollabPreferences]);

  const handleOpenChatWithUserFromDiscover = useCallback((friendUserId: string) => {
    setPendingOpenDmUserId(friendUserId);
    setCurrentPage("connections");
  }, [setPendingOpenDmUserId, setCurrentPage]);

  const handleViewFriendProfile = useCallback((friendUserId: string) => {
    setViewingFriendProfileId(friendUserId);
  }, [setViewingFriendProfileId]);

  const discoverDeepLinkParams = useMemo(
    () => (currentPage === 'discover' ? deepLinkParams : null),
    [currentPage, deepLinkParams]
  );
  const connectionsDeepLinkParams = useMemo(
    () => (currentPage === 'connections' ? deepLinkParams : null),
    [currentPage, deepLinkParams]
  );
  // ORCH-1030: calendar/review notification deep links route to Likes → Calendar.
  const likesDeepLinkParams = useMemo(
    () => (currentPage === 'likes' ? deepLinkParams : null),
    [currentPage, deepLinkParams]
  );

  const handleDeepLinkHandled = useCallback(() => {
    setDeepLinkParams(null);
  }, [setDeepLinkParams]);

  const handleFriendAccepted = useCallback(() => {
    refreshAllSessions({ showLoading: false });
  }, [refreshAllSessions]);

  const handleOpenDirectMessageHandled = useCallback(() => {
    setPendingOpenDmUserId(null);
  }, [setPendingOpenDmUserId]);

  const handleInitialPanelHandled = useCallback(() => {
    setPendingConnectionsPanel(null);
  }, []);

  const handleNavigationComplete = useCallback(() => {
    setActivityNavigation(null);
  }, [setActivityNavigation]);

  const handleSignOutFromProfile = useCallback(async () => {
    logger.action('Sign out pressed');
    await handleSignOut();
  }, [handleSignOut]);

  const handleNavigateToConnectionsFromProfile = useCallback(() => {
    logger.action('Navigate to connections from profile');
    setPendingConnectionsPanel("friends");
    setCurrentPage("connections");
  }, [setCurrentPage]);

  const savedExperiencesCountMemo = useMemo(
    () => savedCards?.length ?? 0,
    [savedCards]
  );

  const scheduledCountMemo = useMemo(
    () => calendarEntries?.length ?? 0,
    [calendarEntries]
  );

  // Ensure any full-screen profile overlays are closed when switching tabs/pages
  // ORCH-0679 Wave 2.5: useCallback-wrapped — stable identity passed to
  // GlassBottomNavWithCoach. Wave 2.6: relocated to above early returns.
  const closeProfileOverlays = useCallback(() => {
    setViewingFriendProfileId(null);
  }, [setViewingFriendProfileId]);

  // ─── ORCH-0679 Wave 2.7 — handlers.X stabilization (RC-1) ──────────────────
  // useAppHandlers returns a fresh object every render (TS-1.5 — god-hook fix
  // deferred). These wrappers read via handlersRef.current so empty dep arrays
  // give permanently stable identity. Forensics audit
  // (INVESTIGATION_ORCH-0679_WAVE2_DIAG_AUDIT.md) confirmed this was busting
  // memo on 5 of 6 tabs (every tab with at least one handlers.X JSX prop).
  // The 9 in-AppContent helpers were already wrapped in Wave 2.5; THESE are
  // the JSX-prop-passed handlers.X that Wave 2.5 missed.
  const stableHandleSaveCard = useCallback(
    (card: any): Promise<boolean> => handlersRef.current.handleSaveCard(card),
    []
  );
  const stableHandleShareCard = useCallback(
    (experienceData: any): void => handlersRef.current.handleShareCard(experienceData),
    []
  );
  const stableHandleShareSavedCard = useCallback(
    (friend: any, suppressNotification?: boolean): void =>
      handlersRef.current.handleShareSavedCard(friend, suppressNotification),
    []
  );
  const stableHandleRemoveFriend = useCallback(
    (friend: any, suppressNotification?: boolean): void =>
      handlersRef.current.handleRemoveFriend(friend, suppressNotification),
    []
  );
  const stableHandleBlockUser = useCallback(
    (friend: any, suppressNotification?: boolean): void =>
      handlersRef.current.handleBlockUser(friend, suppressNotification),
    []
  );
  const stableHandleReportUser = useCallback(
    (friend: any, suppressNotification?: boolean, reason?: string, details?: string): void =>
      handlersRef.current.handleReportUser(friend, suppressNotification, reason, details),
    []
  );
  const stableHandleRemoveFromCalendar = useCallback(
    (entry: any): Promise<void> => handlersRef.current.handleRemoveFromCalendar(entry),
    []
  );
  const stableHandleNavigateToActivity = useCallback(
    (tab: "saved" | "calendar"): void => handlersRef.current.handleNavigateToActivity(tab),
    []
  );
  const stableHandleNotificationsToggle = useCallback(
    (enabled: boolean): Promise<void> => handlersRef.current.handleNotificationsToggle(enabled),
    []
  );
  // ─── End ORCH-0679 Wave 2A/2.5/2.6/2.7 hoists ──────────────────────────────

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
  const isOverlayActive =
    !!viewingFriendProfileId || !!viewingTrip || (showPaywall && !!user?.id);

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
            onNotificationNavigate={handleNotificationNavigate}
            userId={user?.id}
          />
        );
      case "discover":
        return (
          <DiscoverScreen
            onOpenChatWithUser={(friendUserId) => {
              setPendingOpenDmUserId(friendUserId);
              setCurrentPage("connections");
            }}
            onViewFriendProfile={(friendUserId) => setViewingFriendProfileId(friendUserId)}
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
            onOpenPreferences={() => setShowPreferences(true)}
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
            onShareSavedCard={handlers.handleShareSavedCard}
            onRemoveFriend={handlers.handleRemoveFriend}
            onBlockUser={handlers.handleBlockUser}
            onReportUser={handlers.handleReportUser}
            accountPreferences={accountPreferences}
            onCardLike={handlers.handleSaveCard}
            onAddToCalendar={handleAddToCalendar}
            onShareCard={handlers.handleShareCard}
            onPurchaseComplete={handlePurchaseComplete}
            boardsSessions={boardsSessions}
            onRefreshSessions={refreshAllSessions}
            onCreateGroupChat={handleCreateGroupChat}
            onAcceptPendingInvite={handleAcceptInvite}
            onDeclinePendingInvite={handleDeclineInvite}
            availableFriendsForCreate={availableFriendsForSessions}
            isCreatingGroupChat={isCreatingSession}
            userPreferences={userPreferences}
            savedCards={savedCards}
            onOpenPreferences={() => setShowPreferences(true)}
            onOpenCollabPreferences={handleOpenCollabPreferences}
            onUnreadCountChange={setTotalUnreadMessages}
            onNavigateToFriendProfile={(userId: string) => setViewingFriendProfileId(userId)}
            onFriendAccepted={() => refreshAllSessions({ showLoading: false })}
            openDirectMessageWithUserId={pendingOpenDmUserId}
            onOpenDirectMessageHandled={() => setPendingOpenDmUserId(null)}
            initialPanel={pendingConnectionsPanel}
            onInitialPanelHandled={() => setPendingConnectionsPanel(null)}
            deepLinkParams={connectionsDeepLinkParams}
            onDeepLinkHandled={handleDeepLinkHandled}
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
            navigationData={activityNavigation}
            onNavigationComplete={() => setActivityNavigation(null)}
            deepLinkParams={likesDeepLinkParams}
            onDeepLinkHandled={handleDeepLinkHandled}
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
              setPendingConnectionsPanel("friends");
              setCurrentPage("connections");
            }}
            onViewFriendProfile={handleViewFriendProfile}
            savedExperiences={savedCards?.length || 0}
            scheduledCount={calendarEntries?.length || 0}
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
            onNotificationNavigate={handleNotificationNavigate}
            userId={user?.id}
          />
        );
    }
  };

  // closeProfileOverlays useCallback was originally here — relocated to above
  // early returns by Wave 2.6 hot-fix (Rules of Hooks compliance).

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
            currentMode="solo"
            refreshKey={preferencesRefreshKey}
            persistedSessionId={null}
            onSessionLost={() => {}}
          >
            <MobileFeaturesProvider>
              <NavigationProvider>
                <CoachMarkProvider navigateToTab={(tab: string) => setCurrentPage(tab as any)}>
                <ErrorBoundary>
                  <View style={styles.rootView}>
                    <StatusBar
                      barStyle={currentPage === "home" || currentPage === "discover" || currentPage === "connections" || currentPage === "likes" ? "light-content" : "dark-content"}
                      translucent={true}
                      backgroundColor="transparent"
                    />
                    <View style={styles.container}>
                      {/* ORCH-0589 v2 (G3) + ORCH-0590 Phase 3 + ORCH-0600 + ORCH-0610: Swipe,
                          Profile, Discover, Connections, and Likes all render full-bleed —
                          paddingTop 0 so the glass header extends under the status bar.
                          ORCH-0610 fix: Home is the only page that reserves bottom nav space
                          — the swipe card sits ABOVE the nav (flush with screen bezels). Other
                          pages keep paddingBottom: 0 so their content scrolls under the floating
                          glass nav. */}
                      <View
                        style={[
                          styles.mainContent,
                          {
                            paddingTop: (currentPage === "profile" || currentPage === "home" || currentPage === "discover" || currentPage === "connections" || currentPage === "likes") ? 0 : layout.insets.top,
                            paddingBottom: currentPage === "home" ? layout.bottomNavContentHeight + (Platform.OS === 'android' ? layout.insets.bottom + 18 : 23) : 0,
                          },
                        ]}
                      >
                        {/* Full-screen overlays render ON TOP of tabs */}
                        {viewingTrip ? (
                          <ConsumerTripDetailScreen
                            brandSlug={viewingTrip.brandSlug}
                            tripSlug={viewingTrip.tripSlug}
                            seed={viewingTrip.seed}
                            onBack={() => setViewingTrip(null)}
                            // ORCH-1016 REWORK — in-app overlay sits BELOW the
                            // floating GlassBottomNav; tabBarAware pads the sheet
                            // body so the last Day + Reserve CTA clear the nav.
                            tabBarAware
                            accountPreferences={accountPreferencesMemo}
                          />
                        ) : viewingFriendProfileId ? (
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
                          <CustomPaywallScreen
                            isVisible={showPaywall}
                            userId={user.id}
                            onClose={() => setShowPaywall(false)}
                          />
                        ) : null}

                        {/* ORCH-0679 Wave 2.8 Path B — only the active tab is mounted.
                            Hidden tabs literally don't exist → no React.memo concerns,
                            no context-propagation re-renders, no god-hook impact.
                            Per-tab state preservation: scroll/filter/panel state lives
                            in Zustand registry (see useTabScrollRegistry hook + appStore
                            tabScroll/discoverFilters/savedFilters/connectionsActivePanel/
                            connectionsFriendsModalTab/likesActiveTab fields).
                            CI gate: scripts/ci/check-active-tab-only.sh enforces no
                            regression to the all-mounted pattern.
                            Hidden when a full-screen overlay is active. */}
                        {!isOverlayActive && (
                          <View style={{ flex: 1 }}>
                            {(() => {
                              switch (currentPage) {
                                case 'home':
                                  return (
                                    <HomePage
                                      onOpenPreferences={handleOpenPreferences}
                                      userPreferences={userPreferences}
                                      accountPreferences={accountPreferencesMemo}
                                      onAddToCalendar={handleAddToCalendar}
                                      savedCards={savedCards}
                                      onSaveCard={stableHandleSaveCard}
                                      onShareCard={stableHandleShareCard}
                                      onPurchaseComplete={handlePurchaseComplete}
                                      removedCardIds={removedCardIds}
                                      onResetCards={handleResetCards}
                                      generateNewMockCard={handleGenerateNewMockCard}
                                      refreshKey={preferencesRefreshKey}
                                      onNotificationNavigate={handleNotificationNavigate}
                                      userId={user?.id}
                                    />
                                  );
                                case 'discover':
                                  return (
                                    <DiscoverScreen
                                      isTabVisible={true}
                                      onOpenChatWithUser={handleOpenChatWithUserFromDiscover}
                                      onViewFriendProfile={handleViewFriendProfile}
                                      onOpenTrip={handleOpenTripFromDiscover}
                                      accountPreferences={accountPreferencesMemo}
                                      preferencesRefreshKey={preferencesRefreshKey}
                                      deepLinkParams={discoverDeepLinkParams}
                                      onDeepLinkHandled={handleDeepLinkHandled}
                                    />
                                  );
                                case 'connections':
                                  return (
                                    <ConnectionsPage
                                      isTabVisible={true}
                                      onShareSavedCard={stableHandleShareSavedCard}
                                      onRemoveFriend={stableHandleRemoveFriend}
                                      onBlockUser={stableHandleBlockUser}
                                      onReportUser={stableHandleReportUser}
                                      accountPreferences={accountPreferences}
                                      onCardLike={stableHandleSaveCard}
                                      onAddToCalendar={handleAddToCalendar}
                                      onShareCard={stableHandleShareCard}
                                      onPurchaseComplete={handlePurchaseComplete}
                                      boardsSessions={boardsSessions}
                                      onRefreshSessions={refreshAllSessions}
                                      onCreateGroupChat={handleCreateGroupChat}
                                      onAcceptPendingInvite={handleAcceptInvite}
                                      onDeclinePendingInvite={handleDeclineInvite}
                                      availableFriendsForCreate={availableFriendsForSessions}
                                      isCreatingGroupChat={isCreatingSession}
                                      userPreferences={userPreferences}
                                      savedCards={savedCards}
                                      onOpenPreferences={handleOpenPreferences}
                                      onOpenCollabPreferences={handleOpenCollabPreferences}
                                      onUnreadCountChange={setTotalUnreadMessages}
                                      onNavigateToFriendProfile={handleViewFriendProfile}
                                      onFriendAccepted={handleFriendAccepted}
                                      openDirectMessageWithUserId={pendingOpenDmUserId}
                                      onOpenDirectMessageHandled={handleOpenDirectMessageHandled}
                                      initialPanel={pendingConnectionsPanel}
                                      onInitialPanelHandled={handleInitialPanelHandled}
                                      deepLinkParams={connectionsDeepLinkParams}
                                      onDeepLinkHandled={handleDeepLinkHandled}
                                    />
                                  );
                                case 'saved':
                                  return (
                                    <SavedExperiencesPage
                                      isTabVisible={true}
                                      savedCards={savedCards}
                                      isLoading={isLoadingSavedCards}
                                      userPreferences={userPreferences}
                                      onScheduleFromSaved={handleScheduleFromSaved}
                                      onPurchaseFromSaved={handlePurchaseFromSavedSaved}
                                      onShareCard={stableHandleShareCard}
                                    />
                                  );
                                case 'likes':
                                  return (
                                    <LikesPage
                                      isTabVisible={true}
                                      savedCards={savedCards}
                                      isLoadingSavedCards={isLoadingSavedCards}
                                      isSavedCardsError={isSavedCardsError}
                                      onRetrySavedCards={refetchSavedCards}
                                      isLoadingCalendarEntries={isLoadingCalendarEntries}
                                      calendarEntries={calendarEntries}
                                      userPreferences={userPreferences}
                                      accountPreferences={accountPreferences}
                                      navigationData={activityNavigation}
                                      onNavigationComplete={handleNavigationComplete}
                                      deepLinkParams={likesDeepLinkParams}
                                      onDeepLinkHandled={handleDeepLinkHandled}
                                      onPurchaseFromSaved={handlePurchaseFromSavedLikes}
                                      onRemoveFromCalendar={stableHandleRemoveFromCalendar}
                                      onShareCard={stableHandleShareCard}
                                      onAddToCalendar={handleAddToCalendarFromLikes}
                                      onShowQRCode={handleShowQRCode}
                                    />
                                  );
                                case 'profile':
                                  return (
                                    <ProfilePage
                                      isTabVisible={true}
                                      onSignOut={handleSignOutFromProfile}
                                      onUserIdentityUpdate={handleUserIdentityUpdate}
                                      onNavigateToActivity={stableHandleNavigateToActivity}
                                      onNavigateToConnections={handleNavigateToConnectionsFromProfile}
                                      onViewFriendProfile={handleViewFriendProfile}
                                      savedExperiences={savedExperiencesCountMemo}
                                      scheduledCount={scheduledCountMemo}
                                      notificationsEnabled={notificationsEnabled}
                                      onNotificationsToggle={stableHandleNotificationsToggle}
                                      userIdentity={userIdentity}
                                    />
                                  );
                                default:
                                  return null;
                              }
                            })()}
                          </View>
                        )}
                      </View>

                      {/* Coach Mark Spotlight Overlay */}
                      <SpotlightOverlay />

                      {/* Bottom Navigation — ORCH-0589 floating glass capsule with orange spotlight.
                          ORCH-1016: hidden while a full detail/checkout sheet is open
                          (bottomNavHidden) so its content/CTA isn't painted over by the nav. */}
                      {!bottomNavHidden && (
                      <CoachMarkNavigationGate layout={layout}>
                        <View style={styles.glassNavWrapper}>
                          <GlassBottomNavWithCoach
                            currentPage={currentPage as BottomNavPage}
                            onNavigate={(page: BottomNavPage) => {
                              logger.action(`Tab pressed: ${page}`);
                              // Closing profile overlays is URGENT — it must commit
                              // synchronously so the overlay is gone before the new
                              // screen paints.
                              closeProfileOverlays();
                              // ORCH-0995 IMPLEMENT-2: de-prioritize the heavy screen
                              // mount. The switch(currentPage) IIFE unmounts the old
                              // screen and mounts the new (often heavy) one synchronously
                              // when currentPage commits. Wrapping it in a transition lets
                              // the urgent optimistic nav highlight (GlassBottomNav
                              // pendingPage) + spotlight animation commit first; the mount
                              // is interruptible and no longer blocks tap feedback. The
                              // mount structure is unchanged — only WHEN setCurrentPage
                              // commits is deferred.
                              React.startTransition(() => {
                                setCurrentPage(page);
                              });
                            }}
                            labels={{
                              home: t('navigation:tabs.explore'),
                              discover: t('navigation:tabs.discover'),
                              connections: t('navigation:tabs.friends'),
                              likes: t('navigation:tabs.likes'),
                              profile: t('navigation:tabs.profile'),
                            }}
                            badges={{
                              connections: totalUnreadMessages,
                              likes: totalUnreadBoardMessages,
                            }}
                          />
                        </View>
                      </CoachMarkNavigationGate>
                      )}
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

                {showCollabPreferences && collabPreferencesTarget ? (
          <ErrorBoundary>
            <PreferencesSheet
              visible={true}
              onClose={() => {
                logger.action('Close collab preferences');
                setShowCollabPreferences(false);
                setCollabPreferencesTarget(null);
                // ORCH-0902 follow-up (2026-05-21): the ORCH-0446B refreshKey
                // bump is retired. Under CR-1+CR-3+CR-9 the deck is driven by
                // `collaboration_sessions.deck_version`; the server-side
                // recompute_deck_version_after_prefs_change trigger bumps it
                // only on a real hash change, and RecommendationsContext's
                // deck-version transition effect honors CR-3 ("each client
                // finishes V_n before transitioning"). Unconditionally
                // resetting the local deck on every sheet close (including
                // cancel/backdrop dismiss) wiped recommendations even when
                // nothing changed — visible to operator as "No spots match
                // right now" the moment the sheet closed.
              }}
              sessionId={collabPreferencesTarget.sessionId}
              sessionName={collabPreferencesTarget.sessionName}
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
        <OtaUpdateBanner
          isVisible={isUpdateReady && !isDismissed}
          onApply={applyUpdate}
          onDismiss={dismissBanner}
        />
      </ToastProvider>
      </>
    );
  }
}

const styles = StyleSheet.create({
  // ORCH-0589 v3 (R1): the transparent bottomNavigation from v2 was showing this
  // wrapper through. Page-level backgrounds cover this on non-Swipe pages; the
  // Swipe page (HomePage) already uses a near-black bg so no change is visible there.
  // ORCH-1191: recolored pure #000 → #0c0e12 (the app's canonical dark sheet base).
  // The deck-card detail sheets mount via `wrapInRNModal` (a SEPARATE OS overlay
  // window). When gorhom's sheet bg stops short of the physical bottom, the strip
  // below it is THIS root showing through the transparent modal — an in-modal
  // filler can't reach outside the modal frame, so the root must carry the color.
  // At #0c0e12 the strip blends with the dark detail sheets instead of a pure-black
  // band. Visually identical to #000 on the Swipe deck (5% lift, imperceptible).
  rootView: {
    flex: 1,
    backgroundColor: "#0c0e12",
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
  // ORCH-0679 Wave 2.8 Path B: tabVisible/tabHidden styles deleted.
  // The all-tabs-always-mounted pattern was replaced with a switch(currentPage)
  // IIFE that mounts only the active tab. CI gate: check-active-tab-only.sh
  // enforces these style names cannot return.
  // ORCH-0589 v5 (T5): paddingTop 8 → 0. Nav now sits flush above the safe-area
  // bottom (home-indicator zone), giving the card 8pt more vertical space.
  // paddingBottom (via layout.bottomNavPadding on CoachMarkNavigationGate) is
  // preserved to keep home-indicator clearance.
  // ORCH-0600: position absolute so page content extends full-bleed under the
  // nav. Pages that need bottom clearance use layout.bottomNavTotalHeight.
  bottomNavigation: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "transparent",
    paddingTop: 0,
    zIndex: 50,
    elevation: 0,
  },
  // ORCH-0589 v5 (T1a): paddingHorizontal 20 → 8. Nav capsule visibly wider to
  // match the card's full-bleed horizontal reach, while still floating (not edge-to-edge).
  glassNavWrapper: {
    paddingHorizontal: 8,
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

// ORCH-1125 [cold deep-link "No QueryClient set" crash]: the App() wrapper that
// previously owned the PersistQueryClientProvider, the cacheReady cache-size
// gate, the persist options, and the AnimatedSplashScreen overlay was MOVED to
// the expo-router root layout (app/_layout.tsx) so the provider wraps <Stack/>
// and therefore EVERY route — including cold-routed public deep-links (/t/, /b/,
// /brand/) that never mount this Home route. AppContent now simply consumes the
// ambient root-level providers (StripeNativeProvider + PersistQueryClientProvider).
// Do NOT re-add a QueryClient provider here — the strict-grep gate
// scripts/ci/check-rq-provider-at-root-layout.sh enforces single-ownership at root.
export default Sentry.wrap(AppContent);
