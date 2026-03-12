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
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { s, vs, ms } from "../utils/responsive";
import SwipeableCards from "./SwipeableCards";
import CollaborationSessions, { CollaborationSession, Friend } from "./CollaborationSessions";
import NotificationsModal from "./NotificationsModal";
import FriendsModal from "./FriendsModal";
import { InAppNotification, inAppNotificationService } from "../services/inAppNotificationService";
import { useInAppNotifications } from "../hooks/useInAppNotifications";
import { useFriends } from "../hooks/useFriends";
import { useRespondToFriendLink } from "../hooks/useFriendLinks";
import { useRespondLinkConsent } from "../hooks/useLinkConsent";
import { useSocialRealtime } from "../hooks/useSocialRealtime";
import { supabase } from "../services/supabase";
import { useScreenLogger } from "../hooks/useScreenLogger";
import { HapticFeedback } from "../utils/hapticFeedback";
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
  // Collaboration sessions props
  collaborationSessions?: CollaborationSession[];
  selectedSessionId?: string | null;
  onSessionSelect?: (sessionId: string | null) => void;
  onSoloSelect?: () => void;
  onCreateSession?: (sessionName: string, selectedFriends: Friend[], phoneInvitees?: { phoneE164: string }[]) => void;
  onAcceptInvite?: (sessionId: string) => void;
  onDeclineInvite?: (sessionId: string) => void;
  onCancelInvite?: (sessionId: string) => void;
  onSessionStateChanged?: () => void;
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
  onNotificationNavigate?: (notification: InAppNotification) => void;
  userId?: string;
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
}: HomePageProps) {
  useScreenLogger('home');
  // Keep social query caches fresh via realtime even while on the Home tab
  useSocialRealtime(userId);
  // Notifications modal state
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showFriendRequestsModal, setShowFriendRequestsModal] = useState(false);

  // DEV: Screenshot automation triggers
  useEffect(() => {
    if (!__DEV__) return;
    const { useScreenshotStore } = require('../store/screenshotStore');
    const unsub = useScreenshotStore.subscribe((state: any) => {
      if (state.triggerNotificationsModal) {
        setShowNotificationsModal(true);
        useScreenshotStore.getState().setTrigger('triggerNotificationsModal', false);
      }
      if (state.triggerFriendsModal) {
        setShowFriendRequestsModal(true);
        useScreenshotStore.getState().setTrigger('triggerFriendsModal', false);
      }
    });
    return unsub;
  }, []);
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
  const { acceptFriendRequest, declineFriendRequest } = useFriends({ autoFetchBlockedUsers: false });

  const noop = useMemo(() => () => {}, []);

  const handleOpenNotifications = useCallback(() => {
    HapticFeedback.buttonPress();
    setShowNotificationsModal(true);
  }, []);

  const handleCloseNotifications = useCallback(() => {
    setShowNotificationsModal(false);
  }, []);

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

    // For actionable types (with accept/decline buttons), don't close or navigate
    const actionableTypes = [
      "friend_request",
      "friend_link_request",
      "link_consent_request",
      "collaboration_invite",
    ];
    if (!actionableTypes.includes(notification.type)) {
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

  const respondToFriendLink = useRespondToFriendLink();
  const respondToLinkConsent = useRespondLinkConsent();

  const handleAcceptFriendLink = async (linkId: string, notificationId: string) => {
    try {
      await respondToFriendLink.mutateAsync({ linkId, action: "accept" });
      await inAppNotificationService.remove(notificationId);
    } catch (error) {
      console.error("Failed to accept friend link:", error);
    }
  };

  const handleDeclineFriendLink = async (linkId: string, notificationId: string) => {
    try {
      await respondToFriendLink.mutateAsync({ linkId, action: "decline" });
      await inAppNotificationService.remove(notificationId);
    } catch (error) {
      console.error("Failed to decline friend link:", error);
    }
  };

  const handleAcceptLinkConsent = async (linkId: string, notificationId: string) => {
    try {
      await respondToLinkConsent.mutateAsync({ linkId, action: "accept" });
      await inAppNotificationService.remove(notificationId);
    } catch (error) {
      console.error("Failed to accept link consent:", error);
    }
  };

  const handleDeclineLinkConsent = async (linkId: string, notificationId: string) => {
    try {
      await respondToLinkConsent.mutateAsync({ linkId, action: "decline" });
      await inAppNotificationService.remove(notificationId);
    } catch (error) {
      console.error("Failed to decline link consent:", error);
    }
  };

  const handleAcceptCollabInvite = async (
    sessionId: string,
    inviteId: string,
    notificationId: string
  ) => {
    try {
      await supabase
        .from("collaboration_invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", inviteId);

      if (userId) {
        await supabase.from("session_participants").upsert({
          session_id: sessionId,
          user_id: userId,
          has_accepted: true,
          role: "member",
        });
      }

      await inAppNotificationService.remove(notificationId);
      onSessionStateChanged?.();
    } catch (error) {
      console.error("Failed to accept collab invite:", error);
    }
  };

  const handleDeclineCollabInvite = async (
    sessionId: string,
    inviteId: string,
    notificationId: string
  ) => {
    try {
      // Fetch invite details BEFORE mutating so we have clean data for notification
      const { data: invite } = await supabase
        .from("collaboration_invites")
        .select("invited_by, session_id")
        .eq("id", inviteId)
        .single();

      const { data: session } = invite
        ? await supabase
            .from("collaboration_sessions")
            .select("name")
            .eq("id", invite.session_id)
            .single()
        : { data: null };

      await supabase
        .from("collaboration_invites")
        .update({ status: "declined" })
        .eq("id", inviteId);

      if (userId) {
        await supabase
          .from("session_participants")
          .delete()
          .eq("session_id", sessionId)
          .eq("user_id", userId);
      }

      if (invite && userId) {
        await supabase.functions.invoke("notify-invite-response", {
          body: {
            inviteId,
            response: "declined",
            inviterId: invite.invited_by,
            invitedUserId: userId,
            sessionId: invite.session_id,
            sessionName: session?.name || "a session",
          },
        });
      }

      await inAppNotificationService.remove(notificationId);
      onSessionStateChanged?.();
    } catch (error) {
      console.error("Failed to decline collab invite:", error);
    }
  };

  const handleClearAll = () => {
    clearAll();
  };

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
            { transform: [{ translateY: headerSlideAnim }] },
          ]}
        >
          <View style={styles.headerLeft}>
            <View>
              <TouchableOpacity
                onPress={() => {
                  HapticFeedback.buttonPress();
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
                  size={18}
                  color={currentMode !== "solo" ? "#eb7825" : "#1f2937"}
                />
              </TouchableOpacity>
            </View>
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
            <View>
              <TouchableOpacity
                onPress={handleOpenNotifications}
                style={styles.notificationButton}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="notifications-outline" size={18} color="#1f2937" />
                {/* Notification indicator dot */}
                {unreadNotificationCount > 0 && <View style={styles.notificationDot} />}
              </TouchableOpacity>
            </View>
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
              />
            </Animated.View>
          )}

          <View style={{ flex: 1, width: '100%' }}>
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

        {/* Notifications Modal */}
        <NotificationsModal
          visible={showNotificationsModal}
          onClose={handleCloseNotifications}
          notifications={notifications}
          unreadCount={unreadNotificationCount}
          onNotificationPress={handleNotificationPress}
          onMarkAllRead={handleMarkAllRead}
          onClearAll={handleClearAll}
          onOpenRequestsModal={handleOpenFriendRequestsModal}
          onAcceptFriendRequest={handleAcceptFriendRequest}
          onRejectFriendRequest={handleRejectFriendRequest}
          onAcceptFriendLink={handleAcceptFriendLink}
          onDeclineFriendLink={handleDeclineFriendLink}
          onAcceptLinkConsent={handleAcceptLinkConsent}
          onDeclineLinkConsent={handleDeclineLinkConsent}
          onAcceptCollabInvite={handleAcceptCollabInvite}
          onDeclineCollabInvite={handleDeclineCollabInvite}
        />

        {/* Friends Modal — Friends list + Requests tabs */}
        {showFriendRequestsModal && (
          <FriendsModal
            isOpen={showFriendRequestsModal}
            onClose={() => setShowFriendRequestsModal(false)}
            onMessageFriend={(_friendUserId: string) => {
              // Close the modal — the user can navigate to Chats tab
              // to continue the conversation. Cross-tab navigation
              // requires plumbing through app/index.tsx and is out
              // of scope for this change.
              setShowFriendRequestsModal(false);
            }}
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
    paddingHorizontal: s(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 100,
    paddingVertical: vs(8),
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
    /*  aspectRatio: 3.4, */
  },
  logoContainer: {
    height: vs(46),
    width: s(170),
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    height: vs(92),
    width: s(210),
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
