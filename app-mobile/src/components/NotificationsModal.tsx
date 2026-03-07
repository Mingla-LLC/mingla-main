/**
 * NotificationsModal — Premium Glassmorphism Redesign
 *
 * Luxurious bottom sheet with:
 * - Warm gradient background tint
 * - Glassmorphism notification cards with blur + translucency
 * - Gradient accent stripe on unread cards
 * - Premium icon circles with soft glow
 * - Elevated section headers with pill badges
 * - Modern typography with proper hierarchy
 * - Premium accept/decline buttons for friend requests
 * - Refined empty state with gradient icon
 */
import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  SectionList,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import {
  InAppNotification,
  NavigationTarget,
} from "../services/inAppNotificationService";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { colors, shadows } from "../constants/designSystem";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

// Re-export the type under the old name for backward compat
export type { InAppNotification as Notification };

export type NotificationType =
  | "card_saved"
  | "card_removed"
  | "card_shared"
  | "friend_request"
  | "friend_accepted"
  | "board_invite"
  | "board_joined"
  | "board_message"
  | "session_created"
  | "session_joined"
  | "preferences_updated"
  | "calendar_added"
  | "purchase_complete"
  | "profile_updated"
  | "welcome"
  | "system";

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  notifications: InAppNotification[];
  unreadCount: number;
  onNotificationPress: (notification: InAppNotification) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onOpenRequestsModal?: () => void;
  onAcceptFriendRequest?: (userId: string, notificationId: string) => void;
  onRejectFriendRequest?: (userId: string, notificationId: string) => void;
}

// ── Section grouping helpers ──

function groupNotificationsByDate(
  notifications: InAppNotification[]
): { title: string; data: InAppNotification[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 7 * 86_400_000;

  const today: InAppNotification[] = [];
  const yesterday: InAppNotification[] = [];
  const thisWeek: InAppNotification[] = [];
  const older: InAppNotification[] = [];

  notifications.forEach((n) => {
    const ts = new Date(n.timestamp).getTime();
    if (ts >= todayStart) today.push(n);
    else if (ts >= yesterdayStart) yesterday.push(n);
    else if (ts >= weekStart) thisWeek.push(n);
    else older.push(n);
  });

  const sections: { title: string; data: InAppNotification[] }[] = [];
  if (today.length > 0) sections.push({ title: "Today", data: today });
  if (yesterday.length > 0) sections.push({ title: "Yesterday", data: yesterday });
  if (thisWeek.length > 0) sections.push({ title: "This Week", data: thisWeek });
  if (older.length > 0) sections.push({ title: "Earlier", data: older });

  return sections;
}

// ── Navigation label helpers ──

function getNavigationLabel(nav: NavigationTarget): string | null {
  switch (nav.page) {
    case "home":
      return "Go to Explore";
    case "saved":
      return "View Saved";
    case "connections":
      return "View Connections";
    case "likes":
      return "View Likes";
    case "profile":
      return "View Profile";
    case "activity":
      return nav.tab ? `View ${nav.tab.charAt(0).toUpperCase() + nav.tab.slice(1)}` : "View Activity";
    case "board-view":
      return "Accept Invite";
    case "discover":
      return "Discover";
    case "preferences":
      return "Update Preferences";
    case "none":
      return null;
    default:
      return null;
  }
}

// ── Icon color to gradient mapping ──

function getIconGradient(iconColor: string): [string, string] {
  // Map icon colors to premium gradient pairs
  const map: Record<string, [string, string]> = {
    "#EF4444": ["#FEE2E2", "#FECACA"],  // red - saved
    "#6B7280": ["#F3F4F6", "#E5E7EB"],  // gray - removed
    "#3B82F6": ["#DBEAFE", "#BFDBFE"],  // blue - shared/friend
    "#10B981": ["#D1FAE5", "#A7F3D0"],  // green - accepted/purchase
    "#eb7825": ["#FFF7ED", "#FED7AA"],  // orange - board
    "#8B5CF6": ["#EDE9FE", "#DDD6FE"],  // purple - message/profile
    "#F59E0B": ["#FEF3C7", "#FDE68A"],  // amber - preferences
    "#0EA5E9": ["#E0F2FE", "#BAE6FD"],  // sky - calendar
  };
  return map[iconColor] || ["#F9FAFB", "#F3F4F6"];
}

// ── Component ──

export default function NotificationsModal({
  visible,
  onClose,
  notifications,
  unreadCount,
  onNotificationPress,
  onMarkAllRead,
  onClearAll,
  onOpenRequestsModal,
  onAcceptFriendRequest,
  onRejectFriendRequest,
}: NotificationsModalProps) {
  const insets = useSafeAreaInsets();
  const [failedImageIds, setFailedImageIds] = React.useState<Set<string>>(new Set());

  const sections = useMemo(
    () => groupNotificationsByDate(notifications),
    [notifications]
  );

  const handleImageError = (notificationId: string) => {
    setFailedImageIds((prev) => new Set(prev).add(notificationId));
  };

  const renderNotification = ({
    item,
  }: {
    item: InAppNotification;
  }) => {
    const navLabel = getNavigationLabel(item.navigation);
    const showAvatar =
      item.type === "friend_request" ||
      item.type === "friend_accepted" ||
      item.type === "board_invite";

    const isFriendRequest = item.type === "friend_request";
    const iconGradient = getIconGradient(item.iconColor);

    const initials = item.data?.userName
      ? item.data.userName
          .split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
      : "?";

    const handleCardPress = () => {
      if (isFriendRequest) {
        onOpenRequestsModal?.();
      } else {
        onNotificationPress(item);
      }
    };

    const handleAccept = (e: any) => {
      e.stopPropagation();
      onAcceptFriendRequest?.(item.data?.requestId, item.id);
    };

    const handleReject = (e: any) => {
      e.stopPropagation();
      onRejectFriendRequest?.(item.data?.requestId, item.id);
    };

    const cardContent = (
      <View style={styles.cardInner}>
        {/* Gradient accent stripe for unread */}
        {!item.isRead && (
          <LinearGradient
            colors={[colors.primary[400], colors.primary[600]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.unreadStripe}
          />
        )}

        {/* Avatar / Icon Section */}
        <View style={styles.avatarSection}>
          {showAvatar ? (
            <View style={styles.avatarRing}>
              <LinearGradient
                colors={[colors.primary[300], colors.primary[500]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatarGradientRing}
              >
                <View style={styles.avatarInner}>
                  {item.data?.avatar_url && !failedImageIds.has(item.id) ? (
                    <ImageWithFallback
                      source={{ uri: String(item.data.avatar_url).trim() }}
                      style={styles.avatarImage}
                      onError={() => handleImageError(item.id)}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  )}
                </View>
              </LinearGradient>
            </View>
          ) : (
            <LinearGradient
              colors={iconGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconGradientCircle}
            >
              <Ionicons
                name={item.icon as any}
                size={22}
                color={item.iconColor}
              />
            </LinearGradient>
          )}
          {!item.isRead && <View style={styles.unreadDot} />}
        </View>

        {/* Main Content Section */}
        <View style={styles.mainContent}>
          <Text style={styles.notificationTitle} numberOfLines={1}>
            {item.title}
          </Text>

          {showAvatar && item.data?.userName && (
            <View style={styles.userInfoRow}>
              <Ionicons name="person" size={11} color={colors.primary[400]} />
              <Text style={styles.userName} numberOfLines={1}>
                {item.data.userName}
              </Text>
              {item.data?.email && (
                <Text style={styles.userEmail} numberOfLines={1}>
                  {item.data.email}
                </Text>
              )}
            </View>
          )}

          <Text
            style={styles.notificationDescription}
            numberOfLines={2}
          >
            {item.description}
          </Text>

          {!isFriendRequest && (
            <View style={styles.metaRow}>
              <View style={styles.timeChip}>
                <Ionicons name="time-outline" size={10} color={colors.gray[400]} />
                <Text style={styles.timeText}>{item.timeAgo}</Text>
              </View>
              {navLabel && (
                <TouchableOpacity style={styles.navChip} activeOpacity={0.7}>
                  <Text style={styles.navChipText}>{navLabel}</Text>
                  <Ionicons name="chevron-forward" size={12} color={colors.primary[500]} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Friend Request Action Buttons */}
        {isFriendRequest && (
          <View style={styles.friendActions}>
            <TouchableOpacity
              style={styles.acceptButton}
              onPress={handleAccept}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[colors.primary[400], colors.primary[600]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.acceptGradient}
              >
                <Ionicons name="checkmark" size={16} color="white" />
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.declineButton}
              onPress={handleReject}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={16} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );

    return (
      <View style={styles.cardWrapper}>
        <TouchableOpacity
          style={[
            styles.card,
            !item.isRead && styles.cardUnread,
          ]}
          onPress={handleCardPress}
          activeOpacity={0.7}
        >
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={item.isRead ? 30 : 50}
              tint="light"
              style={styles.blurFill}
            >
              {cardContent}
            </BlurView>
          ) : (
            <View style={[styles.blurFallback, !item.isRead && styles.blurFallbackUnread]}>
              {cardContent}
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: { title: string; data: InAppNotification[] };
  }) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionPill}>
        <Text style={styles.sectionPillText}>{section.title}</Text>
      </View>
      <View style={styles.sectionLine} />
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Warm gradient background */}
          <LinearGradient
            colors={["#FFFFFF", "#FFF9F5", "#FFF5EE"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />

          {/* Drag Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Premium Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <LinearGradient
                colors={[colors.primary[400], colors.primary[600]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerIconCircle}
              >
                <Ionicons name="notifications" size={18} color="white" />
              </LinearGradient>
              <View>
                <Text style={styles.headerTitle}>Notifications</Text>
                {unreadCount > 0 && (
                  <Text style={styles.headerSubtitle}>
                    {unreadCount} new
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={20} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          {/* Action Bar */}
          {notifications.length > 0 && (
            <View style={styles.actionBar}>
              {unreadCount > 0 && (
                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={onMarkAllRead}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark-done" size={14} color={colors.primary[500]} />
                  <Text style={styles.actionPillText}>Mark all read</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionPill, styles.actionPillMuted]}
                onPress={onClearAll}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={14} color={colors.gray[400]} />
                <Text style={[styles.actionPillText, styles.actionPillTextMuted]}>Clear all</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Notification List */}
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <LinearGradient
                colors={[colors.primary[100], colors.primary[50]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.emptyIconGradient}
              >
                <Ionicons name="notifications-off-outline" size={44} color={colors.primary[300]} />
              </LinearGradient>
              <Text style={styles.emptyTitle}>You're all caught up</Text>
              <Text style={styles.emptySubtext}>
                When something happens — a new connection, a saved experience, a board invite — you'll see it here.
              </Text>
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              renderItem={renderNotification}
              renderSectionHeader={renderSectionHeader}
              stickySectionHeadersEnabled={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
    ...shadows.xl,
    shadowOpacity: 0.25,
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
  },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text.primary,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary[500],
    marginTop: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Action Bar ──
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(249, 115, 22, 0.08)",
  },
  actionPillMuted: {
    backgroundColor: "rgba(0, 0, 0, 0.04)",
  },
  actionPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary[500],
  },
  actionPillTextMuted: {
    color: colors.gray[400],
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    gap: 10,
  },
  sectionPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(249, 115, 22, 0.10)",
  },
  sectionPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary[600],
    letterSpacing: 0.3,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.06)",
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.gray[400],
  },

  // ── Notification Cards (Glassmorphism) ──
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },
  cardWrapper: {
    marginVertical: 5,
  },
  card: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.6)",
    ...shadows.md,
  },
  cardUnread: {
    borderColor: "rgba(249, 115, 22, 0.15)",
    ...shadows.lg,
    shadowColor: "rgba(249, 115, 22, 0.15)",
  },
  blurFill: {
    overflow: "hidden",
  },
  blurFallback: {
    backgroundColor: "rgba(255, 255, 255, 0.75)",
  },
  blurFallbackUnread: {
    backgroundColor: "rgba(255, 247, 237, 0.85)",
  },
  cardInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },

  // Unread accent stripe
  unreadStripe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },

  // ── Avatar / Icon Section ──
  avatarSection: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGradientRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  avatarInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary[500],
  },
  iconGradientCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDot: {
    position: "absolute",
    top: 0,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary[500],
    borderWidth: 2,
    borderColor: "white",
  },

  // ── Content ──
  mainContent: {
    flex: 1,
    marginRight: 2,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  userInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  userName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text.secondary,
  },
  userEmail: {
    fontSize: 12,
    color: colors.gray[400],
    marginLeft: 4,
  },
  notificationDescription: {
    fontSize: 13,
    color: colors.text.tertiary,
    lineHeight: 18,
    marginBottom: 6,
  },

  // ── Meta Row ──
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeText: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.gray[400],
  },
  navChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(249, 115, 22, 0.08)",
  },
  navChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary[500],
  },

  // ── Friend Request Actions ──
  friendActions: {
    flexDirection: "column",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  acceptButton: {
    borderRadius: 12,
    overflow: "hidden",
    ...shadows.sm,
  },
  acceptGradient: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  declineButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.06)",
  },

  // ── Empty State ──
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 48,
  },
  emptyIconGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    ...shadows.md,
    shadowColor: "rgba(249, 115, 22, 0.15)",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  emptySubtext: {
    fontSize: 15,
    color: colors.gray[400],
    textAlign: "center",
    lineHeight: 22,
  },
});
