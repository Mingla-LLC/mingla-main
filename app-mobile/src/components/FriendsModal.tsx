import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  Animated,
  PanResponder,
  Alert,
  Image,
  ActivityIndicator,
  Dimensions,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboard } from "../hooks/useKeyboard";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useFriends, Friend, FriendRequest } from "../hooks/useFriends";
import { formatTimestamp } from "../utils/dateUtils";
import { mixpanelService } from "../services/mixpanelService";
import { HapticFeedback } from "../utils/hapticFeedback";
import { muteService } from "../services/muteService";
import { blockService } from "../services/blockService";
import { reportService, ReportReason } from "../services/reportService";
import {
  colors,
  spacing,
  radius,
  typography,
  fontWeights,
} from "../constants/designSystem";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMessageFriend: (friendUserId: string) => void;
}

type TabKey = "friends" | "requests";

// ---------------------------------------------------------------------------
// Avatar color palette (hash-based)
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "#f97316",
  "#ef4444",
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#ec4899",
  "#f59e0b",
  "#6366f1",
  "#14b8a6",
  "#e11d48",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getFriendName(friend: Friend): string {
  return (
    friend.display_name ||
    (friend.first_name && friend.last_name
      ? `${friend.first_name} ${friend.last_name}`
      : friend.username) ||
    "Unknown"
  );
}

// ---------------------------------------------------------------------------
// Swipeable Friend Row
// ---------------------------------------------------------------------------

interface SwipeableFriendRowProps {
  friend: Friend;
  onMessage: (friendUserId: string) => void;
  onMute: (friend: Friend) => void;
  onBlock: (friend: Friend) => void;
  onReport: (friend: Friend) => void;
  onRemove: (friend: Friend) => void;
  isMuted: boolean;
}

const SWIPE_ACTION_WIDTH = 200;
const SINGLE_ACTION_WIDTH = 50;

function SwipeableFriendRow({
  friend,
  onMessage,
  onMute,
  onBlock,
  onReport,
  onRemove,
  isMuted,
}: SwipeableFriendRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;
  const hasTriggeredRevealHaptic = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 10;
      },
      onPanResponderGrant: () => {
        hasTriggeredRevealHaptic.current = false;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          const clampedX = Math.max(gestureState.dx, -SWIPE_ACTION_WIDTH);
          translateX.setValue(clampedX);

          if (
            Math.abs(clampedX) >= SWIPE_ACTION_WIDTH &&
            !hasTriggeredRevealHaptic.current
          ) {
            hasTriggeredRevealHaptic.current = true;
            HapticFeedback.medium();
          }
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_ACTION_WIDTH / 2) {
          Animated.spring(translateX, {
            toValue: -SWIPE_ACTION_WIDTH,
            damping: 0.8 * 10, // PanResponder spring uses damping ratio differently
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            damping: 0.8 * 10,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const closeSwipe = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      damping: 8,
      stiffness: 300,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const name = getFriendName(friend);
  const initials = getInitials(name);
  const avatarColor = hashColor(friend.friend_user_id);

  // Simulated online status (no real presence system in the hook)
  // For now we show "Last seen" with the created_at as a fallback
  const isOnline = false;
  const statusText = isOnline ? "Online" : `Last seen ${formatTimestamp(friend.created_at)}`;

  const handlePress = () => {
    Animated.timing(pressOpacity, {
      toValue: 0.97,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(pressOpacity, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start();
    });
    HapticFeedback.light();
    onMessage(friend.friend_user_id);
  };

  return (
    <View style={swipeStyles.container}>
      {/* Action buttons behind the row */}
      <View style={swipeStyles.actionsContainer}>
        <TouchableOpacity
          style={[swipeStyles.actionButton, { backgroundColor: colors.gray[100] }]}
          onPress={() => {
            onMute(friend);
            closeSwipe();
          }}
          accessibilityLabel={isMuted ? "Unmute" : "Mute"}
        >
          <Ionicons
            name={isMuted ? "volume-high-outline" : "volume-mute-outline"}
            size={20}
            color={colors.gray[600]}
          />
          <Text style={[swipeStyles.actionLabel, { color: colors.gray[600] }]}>
            {isMuted ? "Unmute" : "Mute"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[swipeStyles.actionButton, { backgroundColor: colors.warning[50] }]}
          onPress={() => {
            onBlock(friend);
            closeSwipe();
          }}
          accessibilityLabel="Block"
        >
          <Ionicons name="ban-outline" size={20} color={colors.warning[600]} />
          <Text style={[swipeStyles.actionLabel, { color: colors.warning[600] }]}>
            Block
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[swipeStyles.actionButton, { backgroundColor: colors.error[50] }]}
          onPress={() => {
            onReport(friend);
            closeSwipe();
          }}
          accessibilityLabel="Report"
        >
          <Ionicons name="flag-outline" size={20} color={colors.error[500]} />
          <Text style={[swipeStyles.actionLabel, { color: colors.error[500] }]}>
            Report
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[swipeStyles.actionButton, { backgroundColor: colors.error[100] }]}
          onPress={() => {
            onRemove(friend);
            closeSwipe();
          }}
          accessibilityLabel="Remove"
        >
          <Ionicons name="person-remove-outline" size={20} color={colors.error[600]} />
          <Text style={[swipeStyles.actionLabel, { color: colors.error[600] }]}>
            Remove
          </Text>
        </TouchableOpacity>
      </View>

      {/* Swipeable foreground row */}
      <Animated.View
        style={[
          swipeStyles.foreground,
          {
            transform: [{ translateX }],
            opacity: pressOpacity,
          },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={handlePress}
          style={swipeStyles.row}
          accessibilityRole="button"
          accessibilityHint="Double tap to message"
          accessibilityLabel={name}
        >
          {/* Avatar */}
          <View style={swipeStyles.avatarWrapper}>
            <View style={[swipeStyles.avatar, { backgroundColor: avatarColor }]}>
              {friend.avatar_url ? (
                <Image source={{ uri: friend.avatar_url }} style={swipeStyles.avatarImage} />
              ) : (
                <Text style={swipeStyles.avatarText}>{initials}</Text>
              )}
            </View>
            {isOnline && (
              <View style={swipeStyles.onlineDot} />
            )}
          </View>

          {/* Info */}
          <View style={swipeStyles.info}>
            <Text style={swipeStyles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text
              style={[
                swipeStyles.status,
                isOnline && { color: colors.success[600] },
              ]}
              numberOfLines={1}
            >
              {statusText}
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  container: {
    height: 60,
    overflow: "hidden",
  },
  actionsContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  actionButton: {
    width: SINGLE_ACTION_WIDTH,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  actionLabel: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
  },
  foreground: {
    height: 60,
    backgroundColor: colors.background.primary,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  avatarWrapper: {
    width: 42,
    height: 42,
    marginRight: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
  },
  avatarText: {
    color: colors.text.inverse,
    fontWeight: fontWeights.semibold,
    ...typography.sm,
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success[500],
    borderWidth: 2,
    borderColor: colors.background.primary,
  },
  info: {
    flex: 1,
    justifyContent: "center",
  },
  name: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  status: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: 1,
  },
});

// ---------------------------------------------------------------------------
// Request Item
// ---------------------------------------------------------------------------

interface RequestItemProps {
  request: FriendRequest;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  processedStatus?: "accepted" | "declined";
  loading: boolean;
}

function RequestItem({
  request,
  onAccept,
  onDecline,
  processedStatus,
  loading,
}: RequestItemProps) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (processedStatus) {
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(slideAnim, {
            toValue: -Dimensions.get("window").width,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [processedStatus, slideAnim, fadeAnim]);

  const senderName =
    request.sender.display_name ||
    (request.sender.first_name && request.sender.last_name
      ? `${request.sender.first_name} ${request.sender.last_name}`
      : request.sender.username) ||
    "Unknown";
  const initials = getInitials(senderName);
  const avatarColor = hashColor(request.sender_id);

  const bgColor = processedStatus === "accepted"
    ? colors.success[50]
    : processedStatus === "declined"
    ? colors.error[50]
    : colors.background.primary;

  return (
    <Animated.View
      style={[
        requestStyles.item,
        { backgroundColor: bgColor },
        {
          transform: [{ translateX: slideAnim }],
          opacity: fadeAnim,
        },
      ]}
    >
      {/* Avatar */}
      <View style={[requestStyles.avatar, { backgroundColor: avatarColor }]}>
        {request.sender.avatar_url ? (
          <Image source={{ uri: request.sender.avatar_url }} style={requestStyles.avatarImage} />
        ) : (
          <Text style={requestStyles.avatarText}>{initials}</Text>
        )}
      </View>

      {/* Info */}
      <View style={requestStyles.info}>
        <Text style={requestStyles.name} numberOfLines={1}>
          {senderName}
        </Text>
        {request.sender.username && (
          <Text style={requestStyles.username} numberOfLines={1}>
            @{request.sender.username}
          </Text>
        )}
      </View>

      {/* Timestamp */}
      <Text style={requestStyles.timestamp}>
        {formatTimestamp(request.created_at)}
      </Text>

      {/* Action Buttons */}
      <View style={requestStyles.actions}>
        {processedStatus === "accepted" ? (
          <View style={requestStyles.acceptedCircle}>
            <Ionicons name="checkmark" size={18} color={colors.text.inverse} />
          </View>
        ) : processedStatus === "declined" ? (
          <View style={requestStyles.declinedCircle}>
            <Ionicons name="close" size={18} color={colors.gray[500]} />
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={requestStyles.declineButton}
              onPress={() => {
                HapticFeedback.light();
                onDecline(request.id);
              }}
              disabled={loading}
              accessibilityLabel="Decline request"
            >
              <Ionicons name="close" size={18} color={colors.gray[500]} />
            </TouchableOpacity>
            <TouchableOpacity
              style={requestStyles.acceptButton}
              onPress={() => {
                HapticFeedback.success();
                onAccept(request.id);
              }}
              disabled={loading}
              accessibilityLabel="Accept request"
            >
              <Ionicons name="checkmark" size={18} color={colors.text.inverse} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const requestStyles = StyleSheet.create({
  item: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginRight: 12,
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
  },
  avatarText: {
    color: colors.text.inverse,
    fontWeight: fontWeights.semibold,
    ...typography.sm,
  },
  info: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  name: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  username: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  timestamp: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginRight: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  acceptButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  declineButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.gray[100],
    alignItems: "center",
    justifyContent: "center",
  },
  acceptedCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.success[500],
    alignItems: "center",
    justifyContent: "center",
  },
  declinedCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.gray[100],
    alignItems: "center",
    justifyContent: "center",
  },
});

// ---------------------------------------------------------------------------
// Skeleton Row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={skeletonStyles.row}>
      <Animated.View style={[skeletonStyles.avatar, { opacity }]} />
      <View style={skeletonStyles.lines}>
        <Animated.View style={[skeletonStyles.lineTop, { opacity }]} />
        <Animated.View style={[skeletonStyles.lineBottom, { opacity }]} />
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  row: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.gray[200],
    marginRight: 12,
  },
  lines: {
    flex: 1,
    gap: 6,
  },
  lineTop: {
    width: "60%",
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.gray[200],
  },
  lineBottom: {
    width: "40%",
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.gray[200],
  },
});

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function ItemSeparator() {
  return <View style={separatorStyles.line} />;
}

function RequestSeparator() {
  return <View style={separatorStyles.requestGap} />;
}

const separatorStyles = StyleSheet.create({
  line: {
    height: 0.5,
    backgroundColor: colors.gray[100],
    marginLeft: 70,
  },
  requestGap: {
    height: spacing.xs,
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function FriendsModal({
  isOpen,
  onClose,
  onMessageFriend,
}: FriendsModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const {
    isVisible: keyboardVisible,
    keyboardHeight,
    dismiss: dismissKeyboard,
  } = useKeyboard({ disableLayoutAnimation: true });

  // Capture the window height BEFORE the keyboard opens so we have a
  // stable reference that doesn't shift on Android (adjustResize).
  const stableHeightRef = useRef(windowHeight);
  useEffect(() => {
    if (!keyboardVisible) {
      stableHeightRef.current = windowHeight;
    }
  }, [windowHeight, keyboardVisible]);

  const {
    friends,
    friendRequests,
    loading: friendsLoading,
    error: friendsError,
    fetchFriends,
    loadFriendRequests,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    blockFriend,
  } = useFriends();

  const [activeTab, setActiveTab] = useState<TabKey>("friends");
  const [searchQuery, setSearchQuery] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [processedRequests, setProcessedRequests] = useState<{
    [key: string]: "accepted" | "declined";
  }>({});

  // Tab indicator animation
  const tabIndicatorX = useRef(new Animated.Value(0)).current;

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      setInitialLoading(true);
      const load = async () => {
        try {
          await Promise.all([fetchFriends(), loadFriendRequests()]);
          // Load muted user IDs
          const { data: mutedUserIds } = await muteService.getMutedUserIds();
          setMutedIds(new Set(mutedUserIds));
        } catch (err) {
          console.error("Error loading friends modal data:", err);
        } finally {
          setInitialLoading(false);
        }
      };
      load();
    } else {
      setInitialLoading(true);
      setSearchQuery("");
      setActiveTab("friends");
      setProcessedRequests({});
      tabIndicatorX.setValue(0);
    }
  }, [isOpen, fetchFriends, loadFriendRequests, tabIndicatorX]);

  // Filter friends by search
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter((f) => {
      const name = getFriendName(f).toLowerCase();
      const username = (f.username || "").toLowerCase();
      return name.includes(q) || username.includes(q);
    });
  }, [friends, searchQuery]);

  // Incoming pending requests
  const incomingRequests = useMemo(
    () => friendRequests.filter((r) => r.type === "incoming" && r.status === "pending"),
    [friendRequests]
  );

  // Tab switch handler
  const switchTab = useCallback(
    (tab: TabKey) => {
      if (tab === activeTab) return;
      dismissKeyboard();
      HapticFeedback.light();
      setActiveTab(tab);
      Animated.timing(tabIndicatorX, {
        toValue: tab === "friends" ? 0 : 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    },
    [activeTab, tabIndicatorX, dismissKeyboard]
  );

  // Request handlers (reuse existing pattern from FriendRequestsModal)
  const handleAcceptRequest = useCallback(
    async (requestId: string) => {
      setProcessedRequests((prev) => ({ ...prev, [requestId]: "accepted" }));
      setActionLoading(true);

      const request = incomingRequests.find((r) => r.id === requestId);
      try {
        await acceptFriendRequest(requestId);

        if (request) {
          const senderName =
            request.sender.display_name ||
            (request.sender.first_name && request.sender.last_name
              ? `${request.sender.first_name} ${request.sender.last_name}`
              : request.sender.username) ||
            "Unknown";
          mixpanelService.trackFriendRequestAccepted({
            requestId,
            senderName,
            senderUsername: request.sender.username,
          });
        }

        await loadFriendRequests();

        setTimeout(() => {
          setProcessedRequests((prev) => {
            const next = { ...prev };
            delete next[requestId];
            return next;
          });
        }, 1500);
      } catch (err) {
        console.error("Error accepting friend request:", err);
        setProcessedRequests((prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      } finally {
        setActionLoading(false);
      }
    },
    [acceptFriendRequest, incomingRequests, loadFriendRequests]
  );

  const handleDeclineRequest = useCallback(
    async (requestId: string) => {
      setProcessedRequests((prev) => ({ ...prev, [requestId]: "declined" }));
      setActionLoading(true);

      const request = incomingRequests.find((r) => r.id === requestId);
      try {
        await declineFriendRequest(requestId);

        if (request) {
          const senderName =
            request.sender.display_name ||
            (request.sender.first_name && request.sender.last_name
              ? `${request.sender.first_name} ${request.sender.last_name}`
              : request.sender.username) ||
            "Unknown";
          mixpanelService.trackFriendRequestDeclined({
            requestId,
            senderName,
            senderUsername: request.sender.username,
          });
        }

        await loadFriendRequests();

        setTimeout(() => {
          setProcessedRequests((prev) => {
            const next = { ...prev };
            delete next[requestId];
            return next;
          });
        }, 1500);
      } catch (err) {
        console.error("Error declining friend request:", err);
        setProcessedRequests((prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      } finally {
        setActionLoading(false);
      }
    },
    [declineFriendRequest, incomingRequests, loadFriendRequests]
  );

  // Swipe action handlers
  const handleMute = useCallback(
    async (friend: Friend) => {
      const name = getFriendName(friend);
      const result = await muteService.toggleMuteUser(friend.friend_user_id);
      if (result.success) {
        setMutedIds((prev) => {
          const next = new Set(prev);
          if (result.isMuted) {
            next.add(friend.friend_user_id);
          } else {
            next.delete(friend.friend_user_id);
          }
          return next;
        });
        if (result.isMuted) {
          Alert.alert("Muted", `Muted. You won't get notifications from ${name}.`);
        }
      }
    },
    []
  );

  const handleBlock = useCallback(
    async (friend: Friend) => {
      const name = getFriendName(friend);
      Alert.alert(
        `Block ${name}`,
        `${name} can no longer message you.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: async () => {
              try {
                await blockFriend(friend.friend_user_id);
                Alert.alert("Blocked", `Blocked. ${name} can no longer message you.`);
                await fetchFriends();
              } catch (err) {
                console.error("Error blocking friend:", err);
              }
            },
          },
        ]
      );
    },
    [blockFriend, fetchFriends]
  );

  const handleReport = useCallback(
    (friend: Friend) => {
      const name = getFriendName(friend);
      Alert.alert(
        `Report ${name}`,
        "Why are you reporting this person?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Spam",
            onPress: () => reportService.submitReport(friend.friend_user_id, "spam"),
          },
          {
            text: "Harassment",
            onPress: () =>
              reportService.submitReport(friend.friend_user_id, "harassment"),
          },
          {
            text: "Inappropriate",
            onPress: () =>
              reportService.submitReport(friend.friend_user_id, "inappropriate-content"),
          },
        ]
      );
    },
    []
  );

  const handleRemove = useCallback(
    (friend: Friend) => {
      const name = getFriendName(friend);
      Alert.alert(
        "Remove Friend",
        `Are you sure you want to remove ${name}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await removeFriend(friend.friend_user_id);
              } catch (err) {
                console.error("Error removing friend:", err);
              }
            },
          },
        ]
      );
    },
    [removeFriend]
  );

  const handleRetry = useCallback(async () => {
    setInitialLoading(true);
    try {
      await Promise.all([fetchFriends(), loadFriendRequests()]);
    } catch (err) {
      console.error("Error retrying:", err);
    } finally {
      setInitialLoading(false);
    }
  }, [fetchFriends, loadFriendRequests]);

  // Tab indicator position
  const tabWidth = windowWidth / 2;
  const indicatorTranslateX = tabIndicatorX.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabWidth],
  });

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderFriendsTab = () => {
    if (initialLoading || friendsLoading) {
      return (
        <View>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </View>
      );
    }

    if (friendsError) {
      return (
        <TouchableOpacity style={styles.emptyState} onPress={handleRetry}>
          <Feather name="alert-circle" size={32} color={colors.gray[400]} />
          <Text style={styles.emptyTitle}>Couldn't load friends</Text>
          <Text style={styles.emptySubtitle}>Tap to retry</Text>
        </TouchableOpacity>
      );
    }

    if (friends.length === 0) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Feather name="users" size={32} color={colors.gray[400]} />
          </View>
          <Text style={styles.emptyTitle}>No friends yet</Text>
          <Text style={styles.emptySubtitle}>
            People you connect with will appear here
          </Text>
          <TouchableOpacity style={styles.ctaButton} onPress={onClose}>
            <Text style={styles.ctaText}>Find friends</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <>
        {/* Search bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Feather name="search" size={16} color={colors.gray[400]} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search friends"
              placeholderTextColor={colors.gray[400]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={16} color={colors.gray[400]} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <FlatList
          data={filteredFriends}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SwipeableFriendRow
              friend={item}
              onMessage={onMessageFriend}
              onMute={handleMute}
              onBlock={handleBlock}
              onReport={handleReport}
              onRemove={handleRemove}
              isMuted={mutedIds.has(item.friend_user_id)}
            />
          )}
          ItemSeparatorComponent={ItemSeparator}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.flatListContent}
          ListEmptyComponent={
            searchQuery.length > 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No results</Text>
                <Text style={styles.emptySubtitle}>
                  No friends match "{searchQuery}"
                </Text>
              </View>
            ) : null
          }
        />
      </>
    );
  };

  const renderRequestsTab = () => {
    if (initialLoading) {
      return (
        <View>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </View>
      );
    }

    if (incomingRequests.length === 0) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Feather name="inbox" size={32} color={colors.gray[400]} />
          </View>
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptySubtitle}>
            New friend requests will appear here
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={incomingRequests}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RequestItem
            request={item}
            onAccept={handleAcceptRequest}
            onDecline={handleDeclineRequest}
            processedStatus={processedRequests[item.id]}
            loading={actionLoading}
          />
        )}
        ItemSeparatorComponent={RequestSeparator}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.requestsContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  };

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={styles.sheetOverlay}
        accessibilityLabel="Friends and requests"
      >
        {/* Backdrop */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={() => {
            dismissKeyboard();
            onClose();
          }}
        />

        <View
          style={[
            styles.sheetContent,
            {
              height: keyboardVisible
                ? Math.max(200, stableHeightRef.current - keyboardHeight - 44)
                : stableHeightRef.current * 0.88,
              paddingBottom: keyboardVisible
                ? 0
                : Math.max(insets.bottom, 16),
            },
          ]}
        >
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Tab Bar */}
          <View style={styles.tabBar} accessibilityRole="tablist">
            <TouchableOpacity
              style={styles.tab}
              onPress={() => switchTab("friends")}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === "friends" }}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "friends"
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                Friends
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tab}
              onPress={() => switchTab("requests")}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === "requests" }}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "requests"
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                Requests
              </Text>
              {incomingRequests.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {incomingRequests.length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Active indicator */}
            <Animated.View
              style={[
                styles.tabIndicator,
                {
                  width: tabWidth,
                  transform: [{ translateX: indicatorTranslateX }],
                },
              ]}
            />
          </View>

          {/* Content */}
          <View style={styles.content}>
            {activeTab === "friends" ? renderFriendsTab() : renderRequestsTab()}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30,
  },
  dragHandleContainer: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
  },

  // Tab bar
  tabBar: {
    height: 44,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
    position: "relative",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tabText: {
    ...typography.sm,
  },
  tabTextActive: {
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
  },
  tabTextInactive: {
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: colors.primary[500],
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: colors.primary[500],
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    ...typography.xs,
    fontWeight: fontWeights.bold,
    color: colors.text.inverse,
    fontSize: 11,
  },

  // Content
  content: {
    flex: 1,
  },
  flatListContent: {
    flexGrow: 1,
  },
  requestsContent: {
    flexGrow: 1,
    paddingVertical: spacing.sm,
  },

  // Search
  searchContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchBar: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.sm,
    color: colors.text.primary,
    padding: 0,
  },

  // Empty states
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    backgroundColor: colors.gray[100],
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  ctaButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  ctaText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
});
