/**
 * NotificationsModal — Bottom Sheet Design
 *
 * Matches the design language of PreferencesSheet and SessionViewModal:
 * - 88% height bottom sheet with rounded top corners
 * - Semi-transparent overlay backdrop
 * - Slide-up animation
 * - Scrollable notification list with sections (Today, Earlier, This Week)
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  InAppNotification,
  NavigationTarget,
} from "../services/inAppNotificationService";

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
      return "Go to Home";
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
      return "Open Board";
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
}: NotificationsModalProps) {
  const insets = useSafeAreaInsets();

  const sections = useMemo(
    () => groupNotificationsByDate(notifications),
    [notifications]
  );

  const renderNotification = ({
    item,
  }: {
    item: InAppNotification;
  }) => {
    const navLabel = getNavigationLabel(item.navigation);

    return (
      <TouchableOpacity
        style={[
          styles.notificationItem,
          !item.isRead && styles.notificationItemUnread,
        ]}
        onPress={() => onNotificationPress(item)}
        activeOpacity={0.65}
      >
        {/* Icon */}
        <View style={[styles.iconCircle, { borderColor: item.iconColor + "40" }]}>
          <Ionicons
            name={item.icon as any}
            size={18}
            color={item.iconColor}
          />
        </View>

        {/* Content */}
        <View style={styles.notificationBody}>
          <View style={styles.notificationTitleRow}>
            <Text style={styles.notificationTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.isRead && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.notificationDescription} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.notificationMeta}>
            <Text style={styles.notificationTime}>{item.timeAgo}</Text>
            {navLabel && (
              <View style={styles.navLabelContainer}>
                <Text style={styles.navLabel}>{navLabel}</Text>
                <Ionicons name="chevron-forward" size={12} color="#eb7825" />
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
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

  // Header
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

  // Action Bar
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

  // Section Header
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 12,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#F3F4F6",
  },

  // Notification Items
  listContent: {
    paddingBottom: 24,
  },
  notificationItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
    backgroundColor: "#FFFFFF",
  },
  notificationItemUnread: {
    backgroundColor: "#FFF8F3",
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAFA",
  },
  notificationBody: {
    flex: 1,
  },
  notificationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#eb7825",
  },
  notificationDescription: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 18,
    marginBottom: 6,
  },
  notificationMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notificationTime: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  navLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  navLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#eb7825",
  },

  // Empty State
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
