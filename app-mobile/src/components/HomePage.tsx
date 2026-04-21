import React, { useCallback, useMemo, useState } from "react";
import {
  Text,
  View,
  StyleSheet,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { s, vs, ms } from "../utils/responsive";
import SwipeableCards from "./SwipeableCards";
import { useCoachMark } from "../hooks/useCoachMark";
import CollaborationSessions, { CollaborationSession, Friend } from "./CollaborationSessions";
import NotificationsModal from "./NotificationsModal";
import { GlassTopBar } from "./GlassTopBar";
import { GlassSessionSwitcher, type SessionSwitcherItem } from "./GlassSessionSwitcher";
import FriendRequestsModal from "./FriendRequestsModal";
import { useNotifications, ServerNotification } from "../hooks/useNotifications";
import { parseDeepLink, executeDeepLink, NavigationHandlers } from "../services/deepLinkService";
import { clearNotificationBadge } from '../services/oneSignalService';

// Animation duration constant for consistency
const ANIMATION_DURATION = 400;

interface HomePageProps {
  isTabVisible?: boolean;
  onOpenPreferences: () => void;
  onOpenCollabPreferences?: () => void;
  currentMode: "solo" | string;
  // ORCH-0532: authoritative session list from AppStateManager. Forwarded to
  // SwipeableCards so its `resolvedSessionId` reads from the SAME source as
  // AppHandlers.handleSaveCard, eliminating dual-source divergence (V2 §6).
  boardsSessions?: any[];
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onAddToCalendar: (experienceData: any) => void;
  savedCards?: any[];
  onSaveCard?: (card: any) => Promise<boolean>;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string;
  /** @deprecated ORCH-0589 v2 — no header to highlight. Kept in interface for backwards-compat with callers; ignored. */
  isHighlightingHeader?: boolean;
  // Collaboration sessions props
  collaborationSessions?: CollaborationSession[];
  selectedSessionId?: string | null;
  onSessionSelect?: (sessionId: string | null) => void;
  onSoloSelect?: () => void;
  onCreateSession?: (sessionName: string, selectedFriends: Friend[]) => void;
  onAcceptInvite?: (sessionId: string) => void;
  onDeclineInvite?: (sessionId: string) => void;
  onCancelInvite?: (sessionId: string) => void;
  onInviteMoreToSession?: (sessionId: string, friend: Friend) => void;
  onSessionStateChanged?: () => void;
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
  onNotificationNavigate?: (notification: ServerNotification) => void;
  // New V2 props
  userId?: string;
  onFriendAccepted?: () => void;
  openSessionId?: string | null;
  onOpenSessionHandled?: () => void;
}

export default function HomePage({
  onOpenPreferences,
  onOpenCollabPreferences,
  currentMode,
  boardsSessions = [],
  userPreferences,
  accountPreferences,
  onAddToCalendar,
  savedCards,
  onSaveCard,
  onShareCard,
  onPurchaseComplete,
  removedCardIds,
  onResetCards,
  generateNewMockCard,
  onboardingData,
  refreshKey,
  isHighlightingHeader: _isHighlightingHeader, // ORCH-0589 v2: deprecated, see interface.
  // Collaboration sessions props
  collaborationSessions = [],
  selectedSessionId = null,
  onSessionSelect,
  onSoloSelect,
  onCreateSession,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite,
  onInviteMoreToSession,
  onSessionStateChanged,
  availableFriends = [],
  isCreatingSession = false,
  onNotificationNavigate,
  userId,
  onFriendAccepted,
  openSessionId = null,
  onOpenSessionHandled,
}: HomePageProps) {
  // Notifications modal state
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showFriendRequestsModal, setShowFriendRequestsModal] = useState(false);
  const [inviteModalTrigger, setInviteModalTrigger] = useState<{
    sessionId: string;
    nonce: number;
  } | null>(null);
  // ORCH-0589 — nonce that bumps every time the user taps the GlassSessionSwitcher "+" pill.
  // CollaborationSessions watches this to open its existing create-session flow.
  const [createTriggerNonce, setCreateTriggerNonce] = useState<number>(0);

  // ORCH-0589 v5 (T2 + T3): when the user taps a collab session pill (new OR re-tap),
  // we set this state. `id` is fed to CollaborationSessions' `openSessionId` prop,
  // which opens SessionViewModal. `nonce` ensures same-id re-taps re-fire the open
  // (object-identity change → effective-openSessionId re-evaluates → CollabSessions
  // useEffect re-runs). Cleared in `handleSessionModalHandled` after modal opens.
  const [sessionModalTrigger, setSessionModalTrigger] = useState<
    { id: string; nonce: number } | null
  >(null);

  // V2 server-synced notifications hook
  const {
    notifications,
    unreadCount: unreadNotificationCount,
    isLoading: isLoadingNotifications,
    isError: isErrorNotifications,
    markAsRead,
    markAllAsRead,
    clearAll,
    deleteNotification,
    refresh: refreshNotifications,
    loadMore: loadMoreNotifications,
    hasMore: hasMoreNotifications,
    acceptFriendRequest,
    declineFriendRequest,
    acceptPairRequest,
    declinePairRequest,
    acceptCollaborationInvite,
    declineCollaborationInvite,
    acceptLinkRequest,
    declineLinkRequest,
    pendingActions,
  } = useNotifications(userId, {
    onCollaborationInviteResolved: onSessionStateChanged,
  });

  const noop = useMemo(() => () => {}, []);
  const asyncNoop = useMemo(() => async (_card: any): Promise<boolean> => false, []);

  const handleOpenNotifications = useCallback(() => {
    setShowNotificationsModal(true);
    if (unreadNotificationCount > 0) {
      clearNotificationBadge();
    }
  }, [unreadNotificationCount]);

  const handleCloseNotifications = useCallback(() => {
    setShowNotificationsModal(false);
  }, []);

  // Handle notification tap — navigate via deep link or fallback
  const handleNotificationTap = useCallback(
    (notification: ServerNotification) => {
      const deepLink = notification.data?.deepLink as string | undefined;
      if (deepLink) {
        const action = parseDeepLink(deepLink);
        if (action) {
          // Build navigation handlers from the parent callback
          if (onNotificationNavigate) {
            onNotificationNavigate(notification);
          }
          return;
        }
      }

      // Fallback: use onNotificationNavigate with the notification data
      if (onNotificationNavigate) {
        onNotificationNavigate(notification);
      }
    },
    [onNotificationNavigate]
  );

  // Coach mark refs (v2 spotlight — ref-based measurement, no styles)
  // ORCH-0589 v2: gearRef removed — the header it targeted has been deleted entirely.
  // coachPrefs + coachCollabPrefs hook calls retained for coach-mark index registration,
  // but they no longer attach to a view. Coach-mark reauthoring (to target the new
  // floating GlassIconButton) is a deferred follow-up per orchestrator prompt.
  const coachDeck = useCoachMark(1, 0);
  useCoachMark(2, 19);
  const coachCardTap = useCoachMark(3, 0);
  useCoachMark(5, 19);
  // ORCH-0589 v2: sessionsOpacity + headerSlideAnim entrance animations removed —
  // the header they animated has been deleted; GlassTopBar owns its own enter motion.

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.container}>
        {/* ORCH-0589 v2: Mingla logo header deleted — card now fills viewport edge-to-edge.
            Floating glass chrome below handles all top-level affordances. */}

        {/* ORCH-0589: Floating glass chrome — preferences + session switcher + notifications.
            Lives above everything else on the Swipe page (HomePage is currentPage === 'home'). */}
        <GlassTopBar
          visible
          onOpenPreferences={() => {
            if (currentMode === "solo") {
              onOpenPreferences();
            } else {
              onOpenCollabPreferences?.();
            }
          }}
          onOpenNotifications={handleOpenNotifications}
          unreadNotifications={unreadNotificationCount}
          /* ORCH-0589 v6 (U4): preferencesActive removed — Preferences button
             stays in default state regardless of mode. Session switcher's active
             pill already indicates the current mode by name; a second indicator
             on the Preferences icon was redundant noise. */
          notificationsActive={showNotificationsModal}
          sessionSwitcher={
            onSessionSelect && onSoloSelect ? (
              <GlassSessionSwitcher
                items={[
                  { id: 'solo', label: 'Solo' },
                  ...collaborationSessions
                    .filter((s) => s.type === 'active')
                    .map<SessionSwitcherItem>((s) => ({
                      id: s.id,
                      label: s.name,
                    })),
                ]}
                activeId={currentMode === 'solo' || !selectedSessionId ? 'solo' : selectedSessionId}
                onSelect={(id) => {
                  if (id === 'solo') {
                    // Solo pill: only fire if user is actually switching TO solo.
                    // Re-tap on active Solo is a no-op (no modal for solo mode).
                    if (currentMode !== 'solo') {
                      onSoloSelect();
                    }
                  } else {
                    // Collab pill: switch context AND open the session modal.
                    // Works for new taps AND re-taps (nonce-backed trigger re-fires
                    // CollaborationSessions' `openSessionId` useEffect each time).
                    onSessionSelect(id);
                    setSessionModalTrigger({ id, nonce: Date.now() });
                  }
                }}
                onCreate={onCreateSession ? () => {
                  // Signal CollaborationSessions (mounted below in modalsOnlyMode) to open
                  // its create-session modal via nonce bump. This keeps all create-flow
                  // state (friends picker, phone invite, paywall gate) inside the existing
                  // component — we only trigger it from the new pill.
                  setCreateTriggerNonce((n) => n + 1);
                } : undefined}
              />
            ) : null
          }
        />



        <View style={styles.mainContent}>
          <LinearGradient
            colors={['rgba(0, 0, 0, 0.04)', 'rgba(0, 0, 0, 0.01)', 'transparent']}
            style={styles.innerShadowTop}
            pointerEvents="none"
          />

          {/* ORCH-0589: CollaborationSessions runs in modalsOnlyMode — the visible pill bar
              lives in the floating GlassTopBar above (via GlassSessionSwitcher). This component
              is kept mounted to serve its create / invite / session-view / paywall modals.
              The "+" pill in the top bar triggers the create flow via createTriggerNonce bump. */}
          {onSessionSelect && onSoloSelect && onCreateSession && (
            <CollaborationSessions
              sessions={collaborationSessions}
              currentMode={currentMode}
              selectedSessionId={selectedSessionId}
              onSessionSelect={onSessionSelect}
              onSoloSelect={onSoloSelect}
              onCreateSession={onCreateSession}
              onAcceptInvite={onAcceptInvite || noop}
              onDeclineInvite={onDeclineInvite || noop}
              onCancelInvite={onCancelInvite || noop}
              onInviteMoreToSession={onInviteMoreToSession}
              onSessionStateChanged={onSessionStateChanged}
              availableFriends={availableFriends}
              isCreatingSession={isCreatingSession}
              inviteModalTrigger={inviteModalTrigger}
              openSessionId={sessionModalTrigger?.id ?? openSessionId}
              onOpenSessionHandled={() => {
                // ORCH-0589 v5 (T2/T3): clear our local trigger so future same-id
                // re-taps re-fire CollaborationSessions' openSessionId useEffect.
                setSessionModalTrigger(null);
                onOpenSessionHandled?.();
              }}
              modalsOnlyMode
              createTriggerNonce={createTriggerNonce}
            />
          )}

          <View
            ref={(node: any) => { coachDeck.targetRef(node); coachCardTap.targetRef(node); }}
            style={styles.deckWrapper}
          >
          <SwipeableCards
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            currentMode={currentMode}
            boardsSessions={boardsSessions}
            onAddToCalendar={onAddToCalendar}
            onCardLike={onSaveCard || asyncNoop}
            onShareCard={onShareCard}
            onPurchaseComplete={onPurchaseComplete}
            removedCardIds={removedCardIds}
            onResetCards={onResetCards}
            onOpenPreferences={onOpenPreferences}
            onOpenCollabPreferences={onOpenCollabPreferences}
            generateNewMockCard={generateNewMockCard}
            onboardingData={onboardingData}
            refreshKey={refreshKey}
            savedCards={savedCards}
          />
          </View>
        </View>

        {/* V2 Notifications Modal — server-synced */}
        <NotificationsModal
          visible={showNotificationsModal}
          onClose={handleCloseNotifications}
          notifications={notifications}
          unreadCount={unreadNotificationCount}
          isLoading={isLoadingNotifications}
          isError={isErrorNotifications}
          onMarkAllRead={markAllAsRead}
          onClearAll={clearAll}
          onMarkAsRead={markAsRead}
          onDeleteNotification={deleteNotification}
          onNotificationTap={handleNotificationTap}
          onAcceptFriendRequest={acceptFriendRequest}
          onDeclineFriendRequest={declineFriendRequest}
          onAcceptPairRequest={acceptPairRequest}
          onDeclinePairRequest={declinePairRequest}
          onAcceptCollaborationInvite={acceptCollaborationInvite}
          onDeclineCollaborationInvite={declineCollaborationInvite}
          onAcceptLinkRequest={acceptLinkRequest}
          onDeclineLinkRequest={declineLinkRequest}
          onRefresh={refreshNotifications}
          onLoadMore={loadMoreNotifications}
          hasMore={hasMoreNotifications}
          pendingActions={pendingActions}
        />

        {/* Friend Requests Modal - Opens on top of Notifications Modal */}
        {showFriendRequestsModal && (
          <FriendRequestsModal
            isOpen={showFriendRequestsModal}
            onClose={() => setShowFriendRequestsModal(false)}
          />
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ORCH-0589 v2 (G3): dark background lets the card fill the viewport edge-to-edge
  // without a white peek-through behind the translucent status bar.
  safeArea: {
    flex: 1,
    backgroundColor: "#000000",
  },
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  // ORCH-0589 v2: header / headerLeft / headerCenter / headerRight / logoContainer /
  // logo / preferencesButtonPlaceholder / notificationButton / notificationDot all
  // deleted — Mingla logo header removed entirely, card is full-bleed under the
  // floating glass chrome.
  pillsAndCardsContainer: {
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  mainContent: {
    flex: 1,
    flexDirection: "column",
    justifyContent: "flex-start",
    alignItems: "stretch",
    position: "relative",
    overflow: "hidden",
  },
  deckWrapper: {
    flex: 1,
    width: '100%',
  },
  // ORCH-0589: sessionsAnimatedWrapper removed — the pill-bar wrapper it animated
  // is no longer rendered (CollaborationSessions runs in modalsOnlyMode).
  innerShadowTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 20,
    zIndex: 10,
  },
});
