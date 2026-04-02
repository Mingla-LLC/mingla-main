import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "./ui/Icon";
import { LinearGradient } from "expo-linear-gradient";
import { s, vs, ms } from "../utils/responsive";
import SwipeableCards from "./SwipeableCards";
import CollaborationSessions, { CollaborationSession, Friend } from "./CollaborationSessions";
import NotificationsModal from "./NotificationsModal";
import FriendRequestsModal from "./FriendRequestsModal";
import { useNotifications, ServerNotification } from "../hooks/useNotifications";
import { parseDeepLink, executeDeepLink, NavigationHandlers } from "../services/deepLinkService";
import { clearNotificationBadge } from '../services/oneSignalService';
import minglaLogo from "../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png";

// Animation duration constant for consistency
const ANIMATION_DURATION = 400;

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollabPreferences?: () => void;
  currentMode: "solo" | string;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onAddToCalendar: (experienceData: any) => void;
  savedCards?: any[];
  onSaveCard?: (card: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string;
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
  isHighlightingHeader,
  // Collaboration sessions props
  collaborationSessions = [],
  selectedSessionId = null,
  onSessionSelect,
  onSoloSelect,
  onCreateSession,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite,
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

  // Animation values
  const headerSlideAnim = useRef(new Animated.Value(-60)).current;
  const sessionsOpacity = useRef(new Animated.Value(0.3)).current;

  // Run entrance animations on mount
  useEffect(() => {
    Animated.parallel([
      // Header slides down
      Animated.timing(headerSlideAnim, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      // Sessions row fades in
      Animated.timing(sessionsOpacity, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Top Navigation - Fixed with slide-down animation */}
        <Animated.View
          style={[
            styles.header,
            isHighlightingHeader && { zIndex: 1000, elevation: 1000 },
            { transform: [{ translateY: headerSlideAnim }] },
          ]}
        >
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => {
                if (currentMode === "solo") {
                  onOpenPreferences();
                } else {
                  onOpenCollabPreferences?.();
                }
              }}
              style={[
                styles.preferencesButton,
                currentMode !== "solo" && styles.preferencesButtonActive,
              ]}
              activeOpacity={0.6}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <Icon
                name="options-outline"
                size={18}
                color={currentMode !== "solo" ? "#eb7825" : "#1f2937"}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.headerCenter}>
            <View style={styles.logoContainer}>
              <Image
                source={minglaLogo}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleOpenNotifications}
              style={styles.notificationButton}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="notifications-outline" size={18} color="#1f2937" />
              {/* Notification indicator dot */}
              {unreadNotificationCount > 0 && <View style={styles.notificationDot} />}
            </TouchableOpacity>
          </View>
        </Animated.View>



        <View style={styles.mainContent}>
          <LinearGradient
            colors={['rgba(0, 0, 0, 0.04)', 'rgba(0, 0, 0, 0.01)', 'transparent']}
            style={styles.innerShadowTop}
            pointerEvents="none"
          />

          {/* Collaboration Sessions Bar with fade-in and scale animation */}
          {onSessionSelect && onSoloSelect && onCreateSession && (
            <Animated.View
              style={[
                styles.sessionsAnimatedWrapper,
                { opacity: sessionsOpacity },
              ]}
            >
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
                onSessionStateChanged={onSessionStateChanged}
                availableFriends={availableFriends}
                isCreatingSession={isCreatingSession}
                inviteModalTrigger={inviteModalTrigger}
                openSessionId={openSessionId}
                onOpenSessionHandled={onOpenSessionHandled}
              />
            </Animated.View>
          )}

          <View style={styles.deckWrapper}>
          <SwipeableCards
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            currentMode={currentMode}
            onAddToCalendar={onAddToCalendar}
            onCardLike={onSaveCard || noop}
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
  safeArea: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: s(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 100,
    paddingVertical: vs(2),
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  preferencesButton: {
    padding: ms(7),
    minWidth: ms(38),
    minHeight: ms(38),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: ms(19),
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  preferencesButtonActive: {
    backgroundColor: "#FEF3E7",
    borderRadius: ms(19),
    shadowColor: "#eb7825",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoContainer: {
    height: vs(54),
    width: s(140),
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    height: ms(106),
    width: ms(106),
    resizeMode: "contain",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  notificationButton: {
    padding: ms(7),
    minWidth: ms(38),
    minHeight: ms(38),
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    backgroundColor: "#ffffff",
    borderRadius: ms(19),
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  notificationDot: {
    position: "absolute",
    top: -4,
    right: -4,
    width: ms(14),
    height: ms(14),
    backgroundColor: "#eb7825",
    borderRadius: ms(7),
    borderWidth: 2,
    borderColor: "#ffffff",
  },
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
  sessionsAnimatedWrapper: {
    width: '100%',
    backgroundColor: 'transparent',
    zIndex: 20,
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
