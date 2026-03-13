/**
 * In-App Notification Service
 * 
 * Tracks user-friendly notifications for real actions in the app.
 * Each notification links to a specific page/action for navigation.
 * Persisted to AsyncStorage so notifications survive app restarts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// All notification types that map to real user actions
export type InAppNotificationType =
  | "card_saved"          // User saved a card/experience
  | "card_removed"        // User removed a saved card
  | "card_shared"         // User shared a card
  | "friend_request"      // Received a friend/connection request
  | "friend_accepted"     // Friend request was accepted
  | "board_invite"        // Invited to a collaboration board
  | "board_joined"        // Joined a collaboration board
  | "board_message"       // New message in a board discussion
  | "session_created"     // New collaboration session created
  | "session_joined"      // Joined a collaboration session
  | "preferences_updated" // Preferences were updated
  | "calendar_added"      // Experience added to calendar
  | "purchase_complete"   // Purchase completed
  | "profile_updated"     // Profile was updated
  | "welcome"             // Welcome / onboarding complete
  | "collaboration_invite" // Collaboration session invite
  | "system";             // System-level notification

// Navigation targets for each notification type
export type NavigationTarget =
  | { page: "home" }
  | { page: "saved" }
  | { page: "connections" }
  | { page: "likes" }
  | { page: "profile" }
  | { page: "activity"; tab?: "saved" | "boards" | "calendar" }
  | { page: "board-view"; sessionId: string }
  | { page: "discover" }
  | { page: "preferences" }
  | { page: "none" }; // No navigation, just informational

export interface InAppNotification {
  id: string;
  type: InAppNotificationType;
  title: string;
  description: string;
  timestamp: string;       // ISO string
  timeAgo: string;         // Human-readable (computed on read)
  isRead: boolean;
  icon: string;            // Ionicons name
  iconColor: string;       // Hex color for the icon
  navigation: NavigationTarget;
  data?: Record<string, any>; // Extra context (card name, session name, etc.)
}

type NotificationListener = (notifications: InAppNotification[]) => void;

const STORAGE_KEY = "@mingla_in_app_notifications";
const MAX_NOTIFICATIONS = 50; // Keep the last 50 notifications

class InAppNotificationServiceClass {
  private notifications: InAppNotification[] = [];
  private listeners: Set<NotificationListener> = new Set();
  private initialized = false;

  /** Load persisted notifications from storage */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const loaded = JSON.parse(stored);
        console.log(`[InAppNotifications] Loaded ${loaded.length} notifications from storage:`, 
          loaded.map((n: any) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            hasAvatarUrl: !!n.data?.avatar_url
          }))
        );
        
        // Filter out old friend_request notifications that don't have proper data
        this.notifications = loaded.filter((n: any) => {
          // Keep everything except broken friend_requests
          if (n.type === "friend_request" && !n.data?.avatar_url && !n.data?.userName) {
            console.warn(`[InAppNotifications] Removing old friend_request notification with incomplete data:`, n.id);
            return false;
          }
          return true;
        });
        
        // If we filtered anything out, persist the cleaned up list
        if (this.notifications.length < loaded.length) {
          await this.persist();
        }
      }
      this.initialized = true;
    } catch (err) {
      console.warn("[InAppNotifications] Failed to load:", err);
      this.initialized = true;
    }
  }

  /** Subscribe to notification changes */
  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    // Immediately emit current state
    listener(this.getAll());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const all = this.getAll();
    this.listeners.forEach((fn) => fn(all));
  }

  private async persist() {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.notifications));
    } catch (err) {
      console.warn("[InAppNotifications] Failed to persist:", err);
    }
  }

  /** Get all notifications with computed timeAgo */
  getAll(): InAppNotification[] {
    return this.notifications.map((n) => ({
      ...n,
      timeAgo: this.computeTimeAgo(n.timestamp),
    }));
  }

  /** Get unread count */
  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.isRead).length;
  }

  /** Add a new notification */
  async add(
    type: InAppNotificationType,
    title: string,
    description: string,
    navigation: NavigationTarget,
    data?: Record<string, any>
  ): Promise<InAppNotification> {
    const { icon, iconColor } = this.getIconForType(type);
    const notification: InAppNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      description,
      timestamp: new Date().toISOString(),
      timeAgo: "Just now",
      isRead: false,
      icon,
      iconColor,
      navigation,
      data,
    };

    // Prepend (newest first) and trim
    this.notifications = [notification, ...this.notifications].slice(0, MAX_NOTIFICATIONS);
    await this.persist();
    this.emit();
    return notification;
  }

  /** Mark a single notification as read */
  async markAsRead(notificationId: string): Promise<void> {
    const idx = this.notifications.findIndex((n) => n.id === notificationId);
    if (idx !== -1) {
      this.notifications[idx] = { ...this.notifications[idx], isRead: true };
      await this.persist();
      this.emit();
    }
  }

  /** Mark all notifications as read */
  async markAllAsRead(): Promise<void> {
    this.notifications = this.notifications.map((n) => ({ ...n, isRead: true }));
    await this.persist();
    this.emit();
  }

  /** Clear all notifications */
  async clearAll(): Promise<void> {
    this.notifications = [];
    await this.persist();
    this.emit();
  }

  /** Remove a single notification */
  async remove(notificationId: string): Promise<void> {
    this.notifications = this.notifications.filter((n) => n.id !== notificationId);
    await this.persist();
    this.emit();
  }

  // ── Convenience methods for common actions ──

  notifyCardSaved(cardName: string, cardId?: string) {
    return this.add(
      "card_saved",
      "Experience Saved",
      `"${cardName}" has been added to your saved experiences`,
      { page: "likes" },
      { cardId, cardName }
    );
  }

  notifyCardRemoved(cardName: string, cardId?: string) {
    return this.add(
      "card_removed",
      "Experience Removed",
      `"${cardName}" was removed from your saved list`,
      { page: "likes" },
      { cardId, cardName }
    );
  }

  notifyCardShared(cardName: string, cardId?: string) {
    return this.add(
      "card_shared",
      "Experience Shared",
      `You shared "${cardName}" — great taste!`,
      { page: "home" },
      { cardId, cardName }
    );
  }

  notifyFriendRequest(
    fromUserName: string,
    userId?: string,
    avatarUrl?: string,
    email?: string,
    requestId?: string
  ) {
    console.log(`[Notification] Friend Request - User: ${fromUserName}, Avatar: ${avatarUrl}, Email: ${email}`);
    return this.add(
      "friend_request",
      "New Friend Request",
      `${fromUserName} wants to connect with you`,
      { page: "connections" },
      { userId, userName: fromUserName, avatar_url: avatarUrl, email, requestId }
    );
  }

  notifyFriendAccepted(friendName: string, userId?: string) {
    return this.add(
      "friend_accepted",
      "Connection Accepted",
      `You and ${friendName} are now connected!`,
      { page: "connections" },
      { userId, userName: friendName }
    );
  }

  async notifyCollaborationInvite(
    sessionName: string,
    fromUserName: string,
    sessionId: string,
    inviteId?: string,
    avatarUrl?: string | null
  ) {
    return this.add(
      "collaboration_invite",
      `${fromUserName} invited you to ${sessionName}`,
      "Tap to accept and start planning together.",
      { page: "home" as const },
      {
        sessionName,
        fromUserName,
        sessionId,
        inviteId,
        avatar_url: avatarUrl,
      }
    );
  }

  notifyBoardInvite(sessionName: string, fromUserName: string, sessionId?: string) {
    return this.add(
      "board_invite",
      "Board Invitation",
      `${fromUserName} invited you to "${sessionName}"`,
      sessionId ? { page: "board-view", sessionId } : { page: "connections" },
      { sessionId, sessionName, fromUserName }
    );
  }

  notifyBoardJoined(sessionName: string, sessionId?: string) {
    return this.add(
      "board_joined",
      "Board Joined",
      `You joined "${sessionName}" — start collaborating!`,
      sessionId ? { page: "board-view", sessionId } : { page: "connections" },
      { sessionId, sessionName }
    );
  }

  notifyBoardMessage(sessionName: string, fromUserName: string, sessionId?: string) {
    return this.add(
      "board_message",
      "New Board Message",
      `${fromUserName} sent a message in "${sessionName}"`,
      sessionId ? { page: "board-view", sessionId } : { page: "connections" },
      { sessionId, sessionName, fromUserName }
    );
  }

  notifySessionCreated(sessionName: string, sessionId?: string) {
    return this.add(
      "session_created",
      "Session Created",
      `"${sessionName}" is ready — invite friends to collaborate`,
      { page: "home" },
      { sessionId, sessionName }
    );
  }

  notifySessionJoined(sessionName: string, sessionId?: string) {
    return this.add(
      "session_joined",
      "Joined Session",
      `You're now part of "${sessionName}"`,
      { page: "home" },
      { sessionId, sessionName }
    );
  }

  notifyPreferencesUpdated(context?: string) {
    return this.add(
      "preferences_updated",
      "Preferences Updated",
      context
        ? `Your ${context} preferences have been refreshed`
        : "Your preferences have been updated — new experiences incoming!",
      { page: "home" },
      { context }
    );
  }

  notifyCalendarAdded(experienceName: string) {
    return this.add(
      "calendar_added",
      "Added to Calendar",
      `"${experienceName}" is on your schedule`,
      { page: "activity", tab: "calendar" },
      { experienceName }
    );
  }

  notifyPurchaseComplete(experienceName: string, amount?: string) {
    return this.add(
      "purchase_complete",
      "Purchase Complete",
      amount
        ? `"${experienceName}" booked for ${amount} — enjoy your experience!`
        : `"${experienceName}" has been booked — enjoy!`,
      { page: "activity" },
      { experienceName, amount }
    );
  }

  notifyProfileUpdated() {
    return this.add(
      "profile_updated",
      "Profile Updated",
      "Your profile changes have been saved",
      { page: "profile" }
    );
  }

  notifyWelcome(userName?: string) {
    return this.add(
      "welcome",
      "Welcome to Mingla!",
      userName
        ? `Hey ${userName}, start exploring experiences near you`
        : "Start exploring amazing experiences near you",
      { page: "home" },
      { userName }
    );
  }

  // ── Helpers ──

  private getIconForType(type: InAppNotificationType): { icon: string; iconColor: string } {
    switch (type) {
      case "card_saved":
        return { icon: "heart", iconColor: "#EF4444" };
      case "card_removed":
        return { icon: "trash-outline", iconColor: "#6B7280" };
      case "card_shared":
        return { icon: "share-outline", iconColor: "#3B82F6" };
      case "friend_request":
        return { icon: "person-add-outline", iconColor: "#3B82F6" };
      case "friend_accepted":
        return { icon: "people", iconColor: "#10B981" };
      case "board_invite":
        return { icon: "mail-outline", iconColor: "#eb7825" };
      case "board_joined":
        return { icon: "people-outline", iconColor: "#eb7825" };
      case "board_message":
        return { icon: "chatbubble-outline", iconColor: "#8B5CF6" };
      case "session_created":
        return { icon: "add-circle-outline", iconColor: "#10B981" };
      case "session_joined":
        return { icon: "enter-outline", iconColor: "#3B82F6" };
      case "preferences_updated":
        return { icon: "options-outline", iconColor: "#F59E0B" };
      case "calendar_added":
        return { icon: "calendar-outline", iconColor: "#0EA5E9" };
      case "purchase_complete":
        return { icon: "card-outline", iconColor: "#10B981" };
      case "profile_updated":
        return { icon: "person-outline", iconColor: "#8B5CF6" };
      case "welcome":
        return { icon: "sparkles", iconColor: "#eb7825" };
      case "collaboration_invite":
        return { icon: "calendar-outline", iconColor: "#eb7825" };
      case "system":
      default:
        return { icon: "notifications-outline", iconColor: "#6B7280" };
    }
  }

  private computeTimeAgo(isoTimestamp: string): string {
    const now = Date.now();
    const then = new Date(isoTimestamp).getTime();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(isoTimestamp).toLocaleDateString();
  }
}

/** Singleton instance */
export const inAppNotificationService = new InAppNotificationServiceClass();
