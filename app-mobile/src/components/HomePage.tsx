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
import NotificationsModal, { Notification } from "./NotificationsModal";
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
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
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
  availableFriends = [],
  isCreatingSession = false,
}: HomePageProps) {
  // Notifications modal state
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: "1",
      type: "friend_request",
      title: "New Friend Request",
      description: "Sarah Chen wants to connect with you",
      timestamp: "2m ago",
      isRead: false,
      data: { userId: "user1", userName: "Sarah Chen" },
    },
    {
      id: "2",
      type: "mention",
      title: "Mentioned in Discussion",
      description: 'Alex mentioned you in "Tokyo Food Tour" discussion',
      timestamp: "15m ago",
      isRead: false,
      data: { sessionId: "session1", sessionName: "Tokyo Food Tour" },
    },
    {
      id: "3",
      type: "board_invite",
      title: "Board Invitation",
      description: 'Maria invited you to collaborate on "Paris Adventure"',
      timestamp: "1h ago",
      isRead: false,
      data: { sessionId: "session2", sessionName: "Paris Adventure" },
    },
    {
      id: "4",
      type: "card_liked",
      title: "Card Liked",
      description: 'John liked your saved experience "Sunset Kayaking"',
      timestamp: "2h ago",
      isRead: true,
      data: { cardId: "card1", cardName: "Sunset Kayaking" },
    },
    {
      id: "5",
      type: "comment",
      title: "New Comment",
      description: "Emma commented on your board",
      timestamp: "3h ago",
      isRead: true,
    },
  ]);

  const handleMarkAllRead = () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, isRead: true }))
    );
  };

  const handleNotificationPress = (notification: Notification) => {
    // Mark as read
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
    );
    // TODO: Navigate based on notification type
    setShowNotificationsModal(false);
  };

  const unreadNotificationCount = notifications.filter((n) => !n.isRead).length;

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
                size={24}
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
              <Ionicons name="notifications-outline" size={24} color="#1f2937" />
              {/* Notification indicator dot */}
              {unreadNotificationCount > 0 && <View style={styles.notificationDot} />}
            </TouchableOpacity>
          </View>
        </Animated.View>

          


        <View style={styles.mainContent}>
          <LinearGradient
            colors={['rgba(0, 0, 0, 0.15)', 'rgba(0, 0, 0, 0.05)', 'transparent']}
            style={styles.innerShadowTop}
            pointerEvents="none"
          />

          {/* Collaboration Sessions Bar with fade-in and scale animation */}
          {onSessionSelect && onSoloSelect && onCreateSession && onAcceptInvite && onDeclineInvite && onCancelInvite && (
            <Animated.View
              style={{
                opacity: sessionsOpacity,
                transform: [{ scaleX: sessionsScale }],
                width: '100%',
              }}
            >
              <CollaborationSessions
                sessions={collaborationSessions}
                currentMode={currentMode}
                selectedSessionId={selectedSessionId}
                onSessionSelect={onSessionSelect}
                onSoloSelect={onSoloSelect}
                onCreateSession={onCreateSession}
                onAcceptInvite={onAcceptInvite}
                onDeclineInvite={onDeclineInvite}
                onCancelInvite={onCancelInvite}
                availableFriends={availableFriends}
                isCreatingSession={isCreatingSession}
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
          onNotificationPress={handleNotificationPress}
          onMarkAllRead={handleMarkAllRead}
        />

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
    padding: 8,
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  preferencesButtonActive: {
    backgroundColor: "#FEF3E7",
    borderRadius: 20,
    shadowColor: "#eb7825",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
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
    padding: 8,
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    backgroundColor: "#ffffff",
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    height: 40,
    zIndex: 10,
  },
});
