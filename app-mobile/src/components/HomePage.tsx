import React, { useEffect, useRef, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import SwipeableCards from "./SwipeableCards";
import CollaborationSessions, { CollaborationSession, Friend } from "./CollaborationSessions";
import NotificationsModal from "./NotificationsModal";
import FriendRequestsModal from "./FriendRequestsModal";
import { InAppNotification, inAppNotificationService } from "../services/inAppNotificationService";
import { useInAppNotifications } from "../hooks/useInAppNotifications";
import { useFriends } from "../hooks/useFriends";
import minglaLogo from "../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png";

// Animation duration constant for consistency
const ANIMATION_DURATION = 400;

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollaboration?: (friend?: any) => void;
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
  onNotificationNavigate?: (notification: InAppNotification) => void;
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
}: HomePageProps) {
  // Notifications modal state
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showFriendRequestsModal, setShowFriendRequestsModal] = useState(false);
  const [inviteModalTrigger, setInviteModalTrigger] = useState<{
    sessionId: string;
    nonce: number;
  } | null>(null);
  const {
    notifications,
    unreadCount: unreadNotificationCount,
    markAsRead,
    markAllAsRead,
    clearAll,
  } = useInAppNotifications();

  // Get friend request handlers from useFriends hook
  const { acceptFriendRequest, declineFriendRequest } = useFriends();

  const handleMarkAllRead = () => {
    markAllAsRead();
  };

  const handleNotificationPress = (notification: InAppNotification) => {
    // Mark as read
    markAsRead(notification.id);

    if (notification.type === "board_invite" && notification.data?.sessionId) {
      setShowNotificationsModal(false);
      setInviteModalTrigger({
        sessionId: String(notification.data.sessionId),
        nonce: Date.now(),
      });
      return;
    }

    // For friend requests, don't close or navigate - just mark as read
    // The modal will be opened via callback
    if (notification.type !== "friend_request") {
      // Close modal
      setShowNotificationsModal(false);
      // Navigate to the relevant page
      if (onNotificationNavigate) {
        onNotificationNavigate(notification);
      }
    }
  };

  const handleOpenFriendRequestsModal = () => {
    setShowFriendRequestsModal(true);
  };

  const handleAcceptFriendRequest = async (requestId: string, notificationId: string) => {
    try {
      if (requestId) {
        await acceptFriendRequest(requestId);
      }
    } catch (error) {
      console.error("Error accepting friend request:", error);
    } finally {
      await inAppNotificationService.remove(notificationId);
    }
  };

  const handleRejectFriendRequest = async (requestId: string, notificationId: string) => {
    try {
      if (requestId) {
        await declineFriendRequest(requestId);
      }
    } catch (error) {
      console.error("Error rejecting friend request:", error);
    } finally {
      await inAppNotificationService.remove(notificationId);
    }
  };

  const handleClearAll = () => {
    clearAll();
  };

  // Animation values
  const headerSlideAnim = useRef(new Animated.Value(-60)).current;
  const sessionsOpacity = useRef(new Animated.Value(0.3)).current;
  const sessionsScale = useRef(new Animated.Value(0.9)).current;

  // Run entrance animations on mount
  useEffect(() => {
    Animated.parallel([
      // Header slides down
      Animated.timing(headerSlideAnim, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      // Sessions row fades in and scales up
      Animated.timing(sessionsOpacity, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(sessionsScale, {
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
              <Ionicons
                name="options-outline"
                size={21}
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
              onPress={() => setShowNotificationsModal(true)}
              style={styles.notificationButton}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="notifications-outline" size={21} color="#1f2937" />
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
              style={{
                opacity: sessionsOpacity,
                transform: [{ scaleX: sessionsScale }],
                width: '100%',
                backgroundColor: '#FFFFFF',
                zIndex: 20,
              }}
            >
              <CollaborationSessions
                sessions={collaborationSessions}
                currentMode={currentMode}
                selectedSessionId={selectedSessionId}
                onSessionSelect={onSessionSelect}
                onSoloSelect={onSoloSelect}
                onCreateSession={onCreateSession}
                onAcceptInvite={onAcceptInvite || (() => {})}
                onDeclineInvite={onDeclineInvite || (() => {})}
                onCancelInvite={onCancelInvite || (() => {})}
                onSessionStateChanged={onSessionStateChanged}
                availableFriends={availableFriends}
                isCreatingSession={isCreatingSession}
                inviteModalTrigger={inviteModalTrigger}
              />
            </Animated.View>
          )}

          <SwipeableCards
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            currentMode={currentMode}
            onAddToCalendar={onAddToCalendar}
            onCardLike={onSaveCard || (() => {})}
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

        {/* Notifications Modal */}
        <NotificationsModal
          visible={showNotificationsModal}
          onClose={() => setShowNotificationsModal(false)}
          notifications={notifications}
          unreadCount={unreadNotificationCount}
          onNotificationPress={handleNotificationPress}
          onMarkAllRead={handleMarkAllRead}
          onClearAll={handleClearAll}
          onOpenRequestsModal={handleOpenFriendRequestsModal}
          onAcceptFriendRequest={handleAcceptFriendRequest}
          onRejectFriendRequest={handleRejectFriendRequest}
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
    // borderWidth: 1,
    // borderColor: 'blue'
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 100,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  preferencesButton: {
    padding: 7,
    minWidth: 38,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 19,
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
    borderRadius: 19,
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
    /*  aspectRatio: 3.4, */
  },
  logoContainer: {
    height: 50, // Smaller than logo height to crop top/bottom
    width: 180, // Smaller than logo width to crop left/right
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    height: 100,
    width: 220,
    resizeMode: "contain",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  notificationButton: {
    padding: 7,
    minWidth: 38,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    backgroundColor: "#ffffff",
    borderRadius: 19,
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
    width: 14,
    height: 14,
    backgroundColor: "#eb7825",
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  pillsAndCardsContainer: {
    // paddingHorizontal: 30,
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  mainContent: {
    // paddingHorizontal: 10,
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
    // marginHorizontal: 10
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
