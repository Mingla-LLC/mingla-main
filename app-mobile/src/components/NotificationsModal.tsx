import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export type NotificationType =
  | "friend_request"
  | "mention"
  | "board_invite"
  | "card_liked"
  | "comment";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: string;
  isRead: boolean;
  data?: {
    userId?: string;
    userName?: string;
    sessionId?: string;
    sessionName?: string;
    cardId?: string;
    cardName?: string;
  };
}

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  notifications: Notification[];
  onNotificationPress?: (notification: Notification) => void;
  onMarkAllRead?: () => void;
}

const getNotificationIcon = (type: NotificationType): { name: string; color: string } => {
  switch (type) {
    case "friend_request":
      return { name: "user-plus", color: "#3B82F6" };
    case "mention":
      return { name: "at-sign", color: "#8B5CF6" };
    case "board_invite":
      return { name: "users", color: "#eb7825" };
    case "card_liked":
      return { name: "heart", color: "#EF4444" };
    case "comment":
      return { name: "message-circle", color: "#10B981" };
    default:
      return { name: "bell", color: "#6B7280" };
  }
};

export default function NotificationsModal({
  visible,
  onClose,
  notifications,
  onNotificationPress,
  onMarkAllRead,
}: NotificationsModalProps) {
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const renderNotification = (notification: Notification) => {
    const icon = getNotificationIcon(notification.type);

    return (
      <TouchableOpacity
        key={notification.id}
        style={styles.notificationItem}
        onPress={() => onNotificationPress?.(notification)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { borderColor: icon.color }]}>
          <Feather name={icon.name as any} size={16} color={icon.color} />
        </View>

        <View style={styles.notificationContent}>
          <Text style={styles.notificationTitle}>{notification.title}</Text>
          <Text style={styles.notificationDescription} numberOfLines={2}>
            {notification.description}
          </Text>
          <Text style={styles.notificationTimestamp}>{notification.timestamp}</Text>
        </View>

        {!notification.isRead && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View 
          style={styles.modalContainer}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle}>Notifications</Text>
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Notifications List */}
          <ScrollView
            style={styles.notificationsList}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.notificationsContent}
          >
            {notifications.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="bell-off" size={40} color="#D1D5DB" />
                <Text style={styles.emptyStateText}>No notifications yet</Text>
                <Text style={styles.emptyStateSubtext}>
                  You'll see updates about your connections and boards here
                </Text>
              </View>
            ) : (
              notifications.map(renderNotification)
            )}
          </ScrollView>

          {/* Mark All Read Button */}
          {notifications.length > 0 && unreadCount > 0 && onMarkAllRead && (
            <TouchableOpacity
              style={styles.markAllReadButton}
              onPress={onMarkAllRead}
            >
              <Text style={styles.markAllReadText}>Mark all as read</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 60,
    paddingRight: 16,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 16,
    width: SCREEN_WIDTH - 48,
    maxWidth: 340,
    maxHeight: "70%",
    minHeight: 300,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#111827",
  },
  badge: {
    backgroundColor: "#eb7825",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "white",
  },
  closeButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationsList: {
    flexGrow: 1,
    flexShrink: 1,
  },
  notificationsContent: {
    paddingVertical: 8,
    flexGrow: 1,
  },
  notificationItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  notificationDescription: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 18,
  },
  notificationTimestamp: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    marginTop: 4,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyStateText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#6B7280",
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 4,
  },
  markAllReadButton: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingVertical: 12,
    alignItems: "center",
  },
  markAllReadText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
});
