import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useFriends } from "../hooks/useFriends";
import { formatTimestamp } from "../utils/dateUtils";

interface FriendRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FriendRequestsModal({
  isOpen,
  onClose,
}: FriendRequestsModalProps) {
  const {
    friendRequests,
    loadFriendRequests,
    acceptFriendRequest,
    declineFriendRequest,
  } = useFriends();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [processedRequests, setProcessedRequests] = useState<{
    [key: string]: "accepted" | "declined";
  }>({});

  // Load friend requests when modal opens
  useEffect(() => {
    if (isOpen) {
      setInitialLoading(true);
      const fetchRequests = async () => {
        try {
          await loadFriendRequests();
        } catch (error) {
          console.error("Error loading friend requests:", error);
        } finally {
          setInitialLoading(false);
        }
      };
      fetchRequests();
    } else {
      // Reset loading state when modal closes
      setInitialLoading(true);
    }
  }, [isOpen, loadFriendRequests]);

  // Filter only incoming pending requests
  const incomingRequests = friendRequests.filter(
    (req) => req.type === "incoming" && req.status === "pending"
  );

  const handleAcceptRequest = async (requestId: string) => {
    setProcessedRequests((prev) => ({ ...prev, [requestId]: "accepted" }));
    setLoading(true);

    try {
      await acceptFriendRequest(requestId);
      // Reload requests after accepting
      await loadFriendRequests();

      // Remove from processed requests after animation
      setTimeout(() => {
        setProcessedRequests((prev) => {
          const newState = { ...prev };
          delete newState[requestId];
          return newState;
        });
      }, 1500);
    } catch (error) {
      console.error("Error accepting friend request:", error);
      // Revert the processed state on error
      setProcessedRequests((prev) => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    setProcessedRequests((prev) => ({ ...prev, [requestId]: "declined" }));
    setLoading(true);

    try {
      await declineFriendRequest(requestId);
      // Reload requests after declining
      await loadFriendRequests();

      // Remove from processed requests after animation
      setTimeout(() => {
        setProcessedRequests((prev) => {
          const newState = { ...prev };
          delete newState[requestId];
          return newState;
        });
      }, 1500);
    } catch (error) {
      console.error("Error declining friend request:", error);
      // Revert the processed state on error
      setProcessedRequests((prev) => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {initialLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          ) : (
            <>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerContent}>
                  <View style={styles.headerIcon}>
                    <Feather name="user-plus" size={20} color="white" />
                  </View>
                  <View>
                    <Text style={styles.headerTitle}>Friend Requests</Text>
                    <Text style={styles.headerSubtitle}>
                      {incomingRequests.length} pending {incomingRequests.length === 1 ? "request" : "requests"}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <Ionicons name="close" size={20} color="#6b7280" />
                </TouchableOpacity>
              </View>



              {/* Content */}
              <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
              >
                {/* Received Requests */}
                {incomingRequests.length === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyStateIcon}>
                      <Feather name="inbox" size={32} color="#9ca3af" />
                    </View>
                    <Text style={styles.emptyStateTitle}>
                      No Friend Requests
                    </Text>
                    <Text style={styles.emptyStateText}>
                      You're all caught up! New friend requests will appear
                      here.
                    </Text>
                    <View style={styles.emptyStateHint}>
                      <Feather name="info" size={14} color="#9ca3af" />
                      <Text style={styles.emptyStateHintText}>
                        When someone sends you a friend request, you'll see it here
                      </Text>
                    </View>
                  </View>
                ) : (
                    <View style={styles.requestsList}>
                      {incomingRequests.map((request) => {
                        const status = processedRequests[request.id];
                        const senderName =
                          request.sender.display_name ||
                          (request.sender.first_name && request.sender.last_name
                            ? `${request.sender.first_name} ${request.sender.last_name}`
                            : request.sender.username) ||
                          "Unknown";
                        const initials = senderName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2);

                        return (
                          <View
                            key={request.id}
                            style={[
                              styles.requestItem,
                              status === "accepted" && styles.requestItemAccepted,
                              status === "declined" && styles.requestItemDeclined,
                            ]}
                          >
                            <View style={styles.requestContent}>
                              {/* Avatar */}
                              <View style={styles.avatarContainer}>
                                <View style={styles.avatar}>
                                  {request.sender.avatar_url ? (
                                    <Image
                                      source={{ uri: request.sender.avatar_url }}
                                      style={styles.avatarImage}
                                    />
                                  ) : (
                                    <Text style={styles.avatarText}>
                                      {initials}
                                    </Text>
                                  )}
                                </View>
                              </View>

                              {/* User Info */}
                              <View style={styles.userInfo}>
                                <Text style={styles.userName} numberOfLines={1}>{senderName}</Text>
                                <Text style={styles.userUsername} numberOfLines={1}>
                                  @{request.sender.username}
                                </Text>
                                {request.sender.email && (
                                  <Text style={styles.userEmail} numberOfLines={1}>
                                    {request.sender.email}
                                  </Text>
                                )}
                                <Text style={styles.requestTime}>
                                  {formatTimestamp(request.created_at)}
                                </Text>
                              </View>

                              {/* Action Buttons */}
                              <View style={styles.actionButtons}>
                                {status === "accepted" ? (
                                  <View style={styles.statusAccepted}>
                                    <Ionicons
                                      name="checkmark"
                                      size={16}
                                      color="#059669"
                                    />
                                    <Text style={styles.statusText}>
                                      Accepted
                                    </Text>
                                  </View>
                                ) : status === "declined" ? (
                                  <View style={styles.statusDeclined}>
                                    <Ionicons
                                      name="close"
                                      size={16}
                                      color="#dc2626"
                                    />
                                    <Text style={styles.statusText}>
                                      Declined
                                    </Text>
                                  </View>
                                ) : (
                                  <>
                                    <TouchableOpacity
                                      onPress={() =>
                                        handleDeclineRequest(request.id)
                                      }
                                      style={styles.declineButton}
                                      disabled={loading}
                                    >
                                      {loading &&
                                      processedRequests[request.id] ===
                                        "declined" ? (
                                        <ActivityIndicator
                                          size="small"
                                          color="#6b7280"
                                        />
                                      ) : (
                                        <Feather
                                          name="user-x"
                                          size={16}
                                          color="#6b7280"
                                        />
                                      )}
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() =>
                                        handleAcceptRequest(request.id)
                                      }
                                      style={styles.acceptButton}
                                      disabled={loading}
                                    >
                                      {loading &&
                                      processedRequests[request.id] ===
                                        "accepted" ? (
                                        <ActivityIndicator
                                          size="small"
                                          color="white"
                                        />
                                      ) : (
                                        <Feather
                                          name="user-plus"
                                          size={16}
                                          color="white"
                                        />
                                      )}
                                    </TouchableOpacity>
                                  </>
                                )}
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
              </ScrollView>

              {/* Footer */}
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  Accept or decline friend requests to manage your connections
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 16,
    width: "100%",
    maxWidth: 400,
    minHeight: 400,
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#6b7280",
  },
  closeButton: {
    padding: 8,
    borderRadius: 12,
  },
  content: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  contentContainer: {
    flexGrow: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    backgroundColor: "#f3f4f6",
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 16,
  },
  emptyStateHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  emptyStateHintText: {
    fontSize: 13,
    color: "#6b7280",
    flex: 1,
  },
  requestsList: {
    gap: 12,
  },
  requestItem: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 12,
  },
  requestItemAccepted: {
    backgroundColor: "#f0fdf4",
  },
  requestItemDeclined: {
    backgroundColor: "#fef2f2",
  },
  requestContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarContainer: {
    flexShrink: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    backgroundColor: "#eb7825",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  avatarText: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  userUsername: {
    fontSize: 13,
    color: "#9ca3af",
  },
  userEmail: {
    fontSize: 12,
    color: "#d1d5db",
  },
  requestTime: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 1,
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  statusAccepted: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#dcfce7",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusDeclined: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#059669",
  },
  declineButton: {
    padding: 10,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: {
    padding: 10,
    backgroundColor: "#eb7825",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "white",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  footerText: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
  },
  loadingContainer: {
    padding: 64,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 200,
  },
});
