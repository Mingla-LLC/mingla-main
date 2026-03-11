import React, { useState, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: "online" | "offline";
  lastActive?: string;
}

interface CollaborationInvite {
  id: string;
  sessionName: string;
  fromUser: Friend;
  toUser: Friend;
  status: "pending" | "accepted" | "declined" | "canceled";
  createdAt: string;
  expiresAt?: string;
}

interface InvitesTabProps {
  sentInvites: CollaborationInvite[];
  receivedInvites: CollaborationInvite[];
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  onCancelInvite: (inviteId: string) => void;
  onCreateSession?: () => void;
  hasActiveSessions?: boolean;
  initialTab?: "sent" | "received";
  processingInviteId?: string | null;
}

// Move styles outside the component
const styles = StyleSheet.create({
  invitesContainer: {
    gap: 16,
  },
  inviteTypeTabs: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    padding: 4,
  },
  inviteTypeTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  inviteTypeTabActive: {
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  inviteTypeTabInactive: {
    backgroundColor: "transparent",
  },
  inviteTypeTabText: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  inviteTypeTabTextActive: {
    color: "#eb7825",
  },
  inviteTypeTabTextInactive: {
    color: "#6b7280",
  },
  receivedInvitesList: {
    gap: 12,
  },
  sentInvitesList: {
    gap: 12,
  },
  noInvitesState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  noInvitesIcon: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  noInvitesText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 16,
  },
  createSessionButton: {
    backgroundColor: "#eb7825",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  createSessionButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  inviteCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  inviteHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  inviteInfo: {
    flex: 1,
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  inviteFrom: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 2,
  },
  inviteTo: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 2,
  },
  inviteTime: {
    fontSize: 12,
    color: "#9ca3af",
  },
  inviteExpiry: {
    fontSize: 12,
    color: "#f59e0b",
    marginTop: 2,
  },
  inviteStatus: {
    alignItems: "flex-end",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fbbf24",
  },
  statusText: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
  },
  inviteActions: {
    flexDirection: "row",
    gap: 8,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: "#10b981",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  acceptButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
  declineButton: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  declineButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
  cancelButton: {
    backgroundColor: "#FEE2E2",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
  },
  cancelButtonDisabled: {
    opacity: 0.6,
  },
  cancelButtonText: {
    color: "#DC2626",
    fontSize: 14,
    fontWeight: "500",
  },
  sentInviteCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    position: "relative",
  },
  sentInviteContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  sentInviteAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9333EA", // Purple background as fallback
  },
  sentInviteAvatarText: {
    fontSize: 20,
    fontWeight: "600",
    color: "white",
  },
  sentInviteInfo: {
    flex: 1,
  },
  sentInviteSessionName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  sentInviteTo: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 8,
  },
  sentInviteTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sentInviteTime: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sentInviteTimeText: {
    fontSize: 12,
    color: "#6B7280",
  },
  sentInviteExpiry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sentInviteExpiryText: {
    fontSize: 12,
    color: "#F97316",
  },
  sentInviteStatusBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sentInviteStatusText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#92400E",
  },
  receivedInviteCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    position: "relative",
  },
  receivedInviteContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  receivedInviteAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3B82F6",
  },
  receivedInviteAvatarText: {
    fontSize: 20,
    fontWeight: "600",
    color: "white",
  },
  receivedInviteInfo: {
    flex: 1,
  },
  receivedInviteSessionName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  receivedInviteFrom: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 8,
  },
  receivedInviteTimeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  receivedInviteTime: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  receivedInviteTimeText: {
    fontSize: 12,
    color: "#6B7280",
  },
  receivedInviteStatusBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  receivedInviteStatusText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#92400E",
  },
  receivedInviteActions: {
    flexDirection: "row",
    gap: 8,
  },
  receivedAcceptButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  receivedAcceptButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
  receivedDeclineButton: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  receivedDeclineButtonText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "500",
  },
  receivedButtonDisabled: {
    opacity: 0.6,
  },
});

const InvitesTab = ({
  sentInvites,
  receivedInvites,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite,
  onCreateSession,
  hasActiveSessions = false,
  initialTab = "received",
  processingInviteId = null,
}: InvitesTabProps) => {
  const [showInviteType, setShowInviteType] = useState<"sent" | "received">(
    initialTab
  );

  return (
    <View style={styles.invitesContainer}>
      {/* Invite Type Tabs */}
      <View style={styles.inviteTypeTabs}>
        <TouchableOpacity
          onPress={() => setShowInviteType("received")}
          style={[
            styles.inviteTypeTab,
            showInviteType === "received"
              ? styles.inviteTypeTabActive
              : styles.inviteTypeTabInactive,
          ]}
        >
          <Text
            style={[
              styles.inviteTypeTabText,
              showInviteType === "received"
                ? styles.inviteTypeTabTextActive
                : styles.inviteTypeTabTextInactive,
            ]}
          >
            Received ({receivedInvites.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowInviteType("sent")}
          style={[
            styles.inviteTypeTab,
            showInviteType === "sent"
              ? styles.inviteTypeTabActive
              : styles.inviteTypeTabInactive,
          ]}
        >
          <Text
            style={[
              styles.inviteTypeTabText,
              showInviteType === "sent"
                ? styles.inviteTypeTabTextActive
                : styles.inviteTypeTabTextInactive,
            ]}
          >
            Sent ({sentInvites.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Received Invites */}
      {showInviteType === "received" && (
        <View style={styles.receivedInvitesList}>
          {(() => {
            console.log(
              "InvitesTab - Received invites count:",
              receivedInvites.length
            );
            console.log("InvitesTab - Received invites data:", receivedInvites);
            return receivedInvites.length > 0;
          })() ? (
            receivedInvites.map((invite) => {
              console.log("InvitesTab - Rendering invite card for:", invite.id);
              return (
                <ReceivedInviteCard
                  key={invite.id}
                  invite={invite}
                  onAccept={onAcceptInvite}
                  onDecline={onDeclineInvite}
                  processingInviteId={processingInviteId}
                />
              );
            })
          ) : (
            <View style={styles.noInvitesState}>
              <View style={styles.noInvitesIcon}>
                <Ionicons name="checkmark-circle" size={24} color="#9ca3af" />
              </View>
              <Text style={styles.noInvitesText}>
                {!hasActiveSessions
                  ? "You don't have any active sessions yet. Create one to start collaborating!"
                  : "No pending invites"}
              </Text>
              {!hasActiveSessions && onCreateSession && (
                <TouchableOpacity
                  style={styles.createSessionButton}
                  onPress={onCreateSession}
                >
                  <Ionicons name="add" size={20} color="#FFFFFF" />
                  <Text style={styles.createSessionButtonText}>
                    Create Session
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* Sent Invites */}
      {showInviteType === "sent" && (
        <View style={styles.sentInvitesList}>
          {sentInvites.length > 0 ? (
            sentInvites.map((invite) => (
              <SentInviteCard
                key={invite.id}
                invite={invite}
                onCancel={onCancelInvite}
              />
            ))
          ) : (
            <View style={styles.noInvitesState}>
              <View style={styles.noInvitesIcon}>
                <Ionicons name="send" size={24} color="#9ca3af" />
              </View>
              <Text style={styles.noInvitesText}>No sent invites</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// ReceivedInviteCard component
const ReceivedInviteCard = ({ invite, onAccept, onDecline, processingInviteId }: any) => {
  // Track which button was tapped so we show the spinner on the correct one
  const lastActionRef = useRef<'accept' | 'decline' | null>(null);

  // Parent-driven loading state — stays true for the entire accept/decline chain
  const isProcessing = processingInviteId === invite.id;

  const senderInitial = invite.fromUser?.name?.[0]?.toUpperCase() || "U";
  const timeAgo = formatShortTimestamp(invite.createdAt);

  const handleAccept = () => {
    if (isProcessing) return;
    lastActionRef.current = 'accept';
    onAccept(invite.id);
  };

  const handleDecline = () => {
    if (isProcessing) return;
    lastActionRef.current = 'decline';
    onDecline(invite.id);
  };

  return (
    <View style={styles.receivedInviteCard}>
      {/* Status Badge */}
      {invite.status === "pending" && (
        <View style={styles.receivedInviteStatusBadge}>
          <Text style={styles.receivedInviteStatusText}>pending</Text>
        </View>
      )}

      {/* Main Content */}
      <View style={styles.receivedInviteContent}>
        {/* Avatar */}
        <View style={styles.receivedInviteAvatar}>
          <Text style={styles.receivedInviteAvatarText}>{senderInitial}</Text>
        </View>

        {/* Info Section */}
        <View style={styles.receivedInviteInfo}>
          <Text style={styles.receivedInviteSessionName}>
            {invite.sessionName}
          </Text>
          <Text style={styles.receivedInviteFrom}>
            From {invite.fromUser?.name || "Unknown"}
          </Text>

          {/* Time Row */}
          <View style={styles.receivedInviteTimeRow}>
            <View style={styles.receivedInviteTime}>
              <Ionicons name="time-outline" size={12} color="#6B7280" />
              <Text style={styles.receivedInviteTimeText}>{timeAgo}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.receivedInviteActions}>
        <TouchableOpacity
          style={[
            styles.receivedDeclineButton,
            isProcessing && styles.receivedButtonDisabled,
          ]}
          onPress={handleDecline}
          disabled={isProcessing}
        >
          {isProcessing && lastActionRef.current === 'decline' ? (
            <ActivityIndicator size="small" color="#6B7280" />
          ) : (
            <>
              <Ionicons name="close" size={16} color="#6B7280" />
              <Text style={styles.receivedDeclineButtonText}>Decline</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.receivedAcceptButton,
            isProcessing && styles.receivedButtonDisabled,
          ]}
          onPress={handleAccept}
          disabled={isProcessing}
        >
          {isProcessing && lastActionRef.current === 'accept' ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color="white" />
              <Text style={styles.receivedAcceptButtonText}>Accept</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Helper function to format timestamp in readable format (e.g., "2 days ago", "3 hours ago")
const formatShortTimestamp = (timestamp: string): string => {
  if (!timestamp) return "Just now";

  // If it's already a formatted string (like "2h ago"), return it as-is
  if (
    typeof timestamp === "string" &&
    (timestamp.includes("ago") ||
      timestamp.includes("hour") ||
      timestamp.includes("day") ||
      timestamp.includes("minute"))
  ) {
    return timestamp;
  }

  try {
    const now = new Date();
    const date = new Date(timestamp);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return "Just now";
    }

    const diffMs = now.getTime() - date.getTime();

    // Handle negative differences (future dates)
    if (diffMs < 0) {
      return "Just now";
    }

    if (diffMs < 60000) {
      return "Just now";
    }

    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (isNaN(diffMins) || diffMins < 0) {
      return "Just now";
    }

    if (diffMins < 60) {
      return `${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`;
    }

    const diffHours = Math.floor(diffMins / 60);
    if (isNaN(diffHours) || diffHours < 0) {
      return "Just now";
    }

    if (diffHours < 24) {
      return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (isNaN(diffDays) || diffDays < 0) {
      return "Just now";
    }

    if (diffDays < 7) {
      return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
    }

    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 4) {
      return `${diffWeeks} ${diffWeeks === 1 ? "week" : "weeks"} ago`;
    }

    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) {
      return `${diffMonths} ${diffMonths === 1 ? "month" : "months"} ago`;
    }

    const diffYears = Math.floor(diffDays / 365);
    return `${diffYears} ${diffYears === 1 ? "year" : "years"} ago`;
  } catch (error) {
    console.error("Error formatting timestamp:", error, timestamp);
    return "Just now";
  }
};

// Helper function to calculate expiration time
const calculateExpiration = (expiresAt?: string): string => {
  if (!expiresAt) return "";

  try {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();

    if (diffMs <= 0) return "Expired";

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d`;
    } else if (diffHours > 0) {
      return `${diffHours}h`;
    } else {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m`;
    }
  } catch {
    return "";
  }
};

// SentInviteCard component
const SentInviteCard = ({ invite, onCancel }: any) => {
  const [isCancelling, setIsCancelling] = useState(false);
  const sessionInitial = invite.sessionName?.[0]?.toUpperCase() || "S";
  const timeAgo = formatShortTimestamp(invite.createdAt);
  const expiresIn = invite.expiresAt
    ? calculateExpiration(invite.expiresAt)
    : "";

  const handleCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancel(invite.id);
    } catch (error) {
      console.error("Error cancelling invite:", error);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <View style={styles.sentInviteCard}>
      {/* Status Badge */}
      {invite.status === "pending" && (
        <View style={styles.sentInviteStatusBadge}>
          <Text style={styles.sentInviteStatusText}>pending</Text>
        </View>
      )}

      {/* Main Content */}
      <View style={styles.sentInviteContent}>
        {/* Avatar */}
        <View style={styles.sentInviteAvatar}>
          <Text style={styles.sentInviteAvatarText}>{sessionInitial}</Text>
        </View>

        {/* Info Section */}
        <View style={styles.sentInviteInfo}>
          <Text style={styles.sentInviteSessionName}>{invite.sessionName}</Text>
          <Text style={styles.sentInviteTo}>To {invite.toUser.name}</Text>

          {/* Time and Expiry Row */}
          <View style={styles.sentInviteTimeRow}>
            <View style={styles.sentInviteTime}>
              <Ionicons name="time-outline" size={12} color="#6B7280" />
              <Text style={styles.sentInviteTimeText}>{timeAgo}</Text>
            </View>

            {expiresIn && (
              <View style={styles.sentInviteExpiry}>
                <Ionicons name="time" size={12} color="#F97316" />
                <Text style={styles.sentInviteExpiryText}>
                  Expires in {expiresIn}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Cancel Button */}
      <TouchableOpacity
        style={[
          styles.cancelButton,
          isCancelling && styles.cancelButtonDisabled,
        ]}
        onPress={handleCancel}
        disabled={isCancelling}
      >
        {isCancelling ? (
          <ActivityIndicator size="small" color="#DC2626" />
        ) : (
          <>
            <Ionicons name="close" size={16} color="#DC2626" />
            <Text style={styles.cancelButtonText}>Cancel Invitation</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
};

export default InvitesTab;
