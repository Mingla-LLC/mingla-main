/**
 * NotificationsModal — Premium Bottom Sheet Design
 *
 * Matches the design language of PreferencesSheet and SessionViewModal:
 * - 88% height bottom sheet with rounded top corners
 * - Semi-transparent overlay backdrop
 * - Slide-up animation
 * - Scrollable notification list with sections (Today, Earlier, This Week)
 * - Premium compact card design with avatars and user info
 *
 * Each notification is tappable and navigates to the relevant page/action.
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
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  InAppNotification,
  NavigationTarget,
} from "../services/inAppNotificationService";
import { ImageWithFallback } from "./figma/ImageWithFallback";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

// Re-export the type under the old name for backward compat
export type { InAppNotification as Notification };

// Keep the old NotificationType alias so existing imports still work
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
    // DEBUG: Log the notification data on each render
    if (item.type === "friend_request") {
      console.log(`[NotificationsModal] Rendering Friend Request notification:`, {
        id: item.id,
        title: item.title,
        hasData: !!item.data,
        avatarUrl: item.data?.avatar_url,
        userName: item.data?.userName,
        email: item.data?.email,
        failedIds: Array.from(failedImageIds),
      });
    }

    const navLabel = getNavigationLabel(item.navigation);
    const showAvatar = 
      item.type === "friend_request" || 
      item.type === "friend_accepted" ||
      item.type === "board_invite";

    const isFriendRequest = item.type === "friend_request";

    // For friend requests, try to show initials or avatar
    const initials = item.data?.userName
      ? item.data.userName
          .split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
      : "?";

    const handleCardPress = () => {
      if (isFriendRequest) {
        // Open the friend requests modal instead of navigating
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

    return (
      <View style={styles.notificationCardWrapper}>
        <TouchableOpacity
          style={[
            styles.notificationCard,
            !item.isRead && styles.notificationCardUnread,
            isFriendRequest && styles.notificationCardWithActions,
          ]}
          onPress={handleCardPress}
          activeOpacity={0.7}
        >
          {/* Avatar / Icon Section */}
          <View style={styles.avatarSection}>
            {showAvatar ? (
              <View style={styles.avatarCircle}>
                {item.data?.avatar_url && !failedImageIds.has(item.id) ? (
                  <ImageWithFallback
                    source={{ uri: String(item.data.avatar_url).trim() }}
                    style={styles.avatarImage}
                    onError={() => {
                      console.warn(`Avatar load failed for notification ${item.id}: ${item.data?.avatar_url}`);
                      handleImageError(item.id);
                    }}
                    onLoadStart={() => {
                      console.log(`Avatar loading for notification ${item.id}: ${item.data?.avatar_url}`);
                    }}
                    onLoad={() => {
                      console.log(`Avatar loaded successfully for notification ${item.id}`);
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.avatarInitials}>{initials}</Text>
                )}
              </View>
            ) : (
              <View style={[styles.iconCircle, { borderColor: item.iconColor + "40" }]}>
                <Ionicons
                  name={item.icon as any}
                  size={20}
                  color={item.iconColor}
                />
              </View>
            )}
            {!item.isRead && <View style={styles.unreadIndicator} />}
          </View>

          {/* Main Content Section - Center */}
          <View style={styles.mainContent}>
            {/* Title and notification type */}
            <View style={styles.titleSection}>
              <Text style={styles.notificationTitle} numberOfLines={1}>
                {item.title}
              </Text>
            </View>

            {/* User info for social notifications */}
            {showAvatar && item.data?.userName && (
              <View style={styles.userInfoSection}>
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

            {/* Description - properly wrapped */}
            <Text 
              style={styles.notificationDescription}
              numberOfLines={isFriendRequest ? 2 : 2}
            >
              {item.description}
            </Text>

            {/* Meta information - not shown for friend requests */}
            {!isFriendRequest && (
              <View style={styles.metaSection}>
                <Text style={styles.notificationTime}>{item.timeAgo}</Text>
                {navLabel && (
                  <View style={styles.navLabelContainer}>
                    <Text style={styles.navLabel}>{navLabel}</Text>
                    <MaterialCommunityIcons 
                      name="chevron-right" 
                      size={14} 
                      color="#eb7825" 
                    />
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Quick Action Buttons for Friend Requests - Right side, integrated */}
          {isFriendRequest && (
            <View style={styles.actionsRight}>
              <TouchableOpacity
                style={styles.acceptButtonCompact}
                onPress={handleAccept}
                activeOpacity={0.7}
              >
                <Ionicons name="checkmark" size={12} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectButtonCompact}
                onPress={handleReject}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={12} color="#9CA3AF" />
              </TouchableOpacity>
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
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
      <View style={styles.sectionHeaderLine} />
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
      <View style={styles.sheetOverlay}>
        {/* Tap backdrop to close */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={[styles.sheetContent, { paddingBottom: insets.bottom }]}>
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Notifications</Text>
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          {notifications.length > 0 && (
            <View style={styles.actionBar}>
              {unreadCount > 0 && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={onMarkAllRead}
                >
                  <Ionicons name="checkmark-done-outline" size={16} color="#eb7825" />
                  <Text style={styles.actionButtonText}>Mark all read</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.actionButton}
                onPress={onClearAll}
              >
                <Ionicons name="trash-outline" size={16} color="#9CA3AF" />
                <Text style={[styles.actionButtonText, { color: "#9CA3AF" }]}>
                  Clear all
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Notification List */}
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="notifications-off-outline" size={40} color="#D1D5DB" />
              </View>
              <Text style={styles.emptyStateTitle}>You're all caught up!</Text>
              <Text style={styles.emptyStateSubtext}>
                Notifications about your experiences, connections, and boards will appear here
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
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    height: SHEET_HEIGHT,
    backgroundColor: "#FFFFFF",
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
    backgroundColor: "#D1D5DB",
  },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  badge: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "white",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Action Bar ──
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#eb7825",
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    gap: 12,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#F3F4F6",
  },

  // ── Notification Cards (Premium Design) ──
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
  },
  
  notificationCardWrapper: {
    marginVertical: 6,
  },
  
  notificationCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },

  notificationCardWithActions: {
    paddingRight: 8,
  },
  
  notificationCardUnread: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FCD34D",
  },

  // ── Avatar / Icon Section ──
  avatarSection: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FED7AA",
    backgroundColor: "#FEF3C7",
    overflow: "hidden",
  },

  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 24,
  },
  
  avatarInitials: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ea6317",
  },

  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAFA",
  },

  unreadIndicator: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#eb7825",
    borderWidth: 2,
    borderColor: "white",
  },

  // ── Content Section ──
  mainContent: {
    flex: 1,
    marginRight: 4,
  },

  notificationContent: {
    flex: 1,
  },

  titleSection: {
    marginBottom: 3,
  },

  notificationTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },

  // ── User Info (for social notifications) ──
  userInfoSection: {
    marginBottom: 4,
  },

  userName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    flexWrap: "wrap",
  },

  userEmail: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 1,
    flexWrap: "wrap",
  },

  // ── Description ──
  notificationDescription: {
    fontSize: 11,
    color: "#6B7280",
    lineHeight: 15,
    marginBottom: 4,
    flexWrap: "wrap",
  },

  // ── Meta Section ──
  metaSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  notificationTime: {
    fontSize: 10,
    color: "#9CA3AF",
    fontWeight: "500",
  },

  navLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },

  navLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#eb7825",
  },

  // ── Quick Actions (Friend Request Buttons - Right side, compact) ──
  actionsRight: {
    flexDirection: "column",
    gap: 6,
    justifyContent: "center",
  },

  acceptButtonCompact: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#ea6317",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },

  rejectButtonCompact: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  quickActionsContainer: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    marginLeft: 60,
  },

  quickActionsSection: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 8,
  },

  // ── Empty State ──
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  
  emptyStateSubtext: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 20,
  },
});
