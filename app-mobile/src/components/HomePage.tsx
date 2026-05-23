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
import NotificationsModal from "./NotificationsModal";
import { GlassTopBar } from "./GlassTopBar";
import FriendRequestsModal from "./FriendRequestsModal";
import { useNotifications, ServerNotification } from "../hooks/useNotifications";
import { parseDeepLink, executeDeepLink, NavigationHandlers } from "../services/deepLinkService";
import { clearNotificationBadge } from '../services/oneSignalService';

// Animation duration constant for consistency
const ANIMATION_DURATION = 400;

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollabPreferences?: () => void;
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
  onNotificationNavigate?: (notification: ServerNotification) => void;
  // New V2 props
  userId?: string;
  onFriendAccepted?: () => void;
}

function HomePage({
  onOpenPreferences,
  onOpenCollabPreferences,
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
  onNotificationNavigate,
  userId,
  onFriendAccepted,
}: HomePageProps) {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  // Tap a different tab — only that tab should log. Hidden tabs MUST NOT log.
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] HomePage: ${renderCountRef.current}`);
  }

  // Notifications modal state
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showFriendRequestsModal, setShowFriendRequestsModal] = useState(false);

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
    onCollaborationInviteResolved: undefined,
  });

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

  // ORCH-0635: coach marks re-wired post-ORCH-0589 glass chrome refresh.
  // Step 1: forwarded into SwipeableCards.cardContainer via coachDeckRef so the
  //         cutout traces the actual card bounds. Radius 36 = cutout radius 40 =
  //         glass.card.bezelRadius (40pt) — matches the iPhone-bezel card silhouette.
  // Step 2: GlassTopBar Preferences button via coachPrefsRef.
  const coachDeck = useCoachMark(1, 36);
  const coachPrefs = useCoachMark(2, 20);
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
          coachPrefsRef={coachPrefs.targetRef}
          onOpenPreferences={() => {
            onOpenPreferences();
          }}
          onOpenNotifications={handleOpenNotifications}
          unreadNotifications={unreadNotificationCount}
          /* ORCH-0589 v6 (U4): preferencesActive removed — Preferences button
             stays in default state regardless of mode. Session switcher's active
             pill already indicates the current mode by name; a second indicator
             on the Preferences icon was redundant noise. */
          notificationsActive={showNotificationsModal}
          sessionSwitcher={null}
        />



        <View style={styles.mainContent}>
          <LinearGradient
            colors={['rgba(0, 0, 0, 0.04)', 'rgba(0, 0, 0, 0.01)', 'transparent']}
            style={styles.innerShadowTop}
            pointerEvents="none"
          />

          <View style={styles.deckWrapper}>
            <SwipeableCards
              userPreferences={userPreferences}
              accountPreferences={accountPreferences}
              boardsSessions={[]}
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
              coachDeckRef={coachDeck.targetRef}
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
  innerShadowTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 20,
    zIndex: 10,
  },
});

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED — default Object.is shallow compare.
// All props passed from app/index.tsx are stable refs (useCallback/useMemo) so
// shallow compare correctly detects real changes vs render-storm noise.
export default React.memo(HomePage);
