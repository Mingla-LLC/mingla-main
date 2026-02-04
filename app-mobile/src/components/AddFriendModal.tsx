import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../services/supabase";
import { useFriends } from "../hooks/useFriends";
import { useAppStore } from "../store/appStore";
import { blockService } from "../services/blockService";

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchUser {
  id: string;
  username: string;
  email: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
}

export default function AddFriendModal({
  isOpen,
  onClose,
}: AddFriendModalProps) {
  const [activeTab, setActiveTab] = useState<"add" | "sent">("add");
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState("");
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [userNotFound, setUserNotFound] = useState(false);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(
    null
  );
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const {
    addFriend,
    friendRequests,
    loadFriendRequests,
    cancelFriendRequest,
    loading,
  } = useFriends();
  const { user, profile } = useAppStore();
  const [loadingSentRequests, setLoadingSentRequests] = useState(false);

  // Real-time search as user types
  useEffect(() => {
    if (!isOpen || activeTab !== "add") {
      setSearchResults([]);
      setSelectedUser(null);
      return;
    }

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Don't search if input is too short
    if (searchInput.trim().length < 2) {
      setSearchResults([]);
      setSelectedUser(null);
      setIsSearching(false);
      setSearchCompleted(false);
      setUserNotFound(false);
      return;
    }

    setIsSearching(true);
    setError("");
    setSearchCompleted(false);
    setUserNotFound(false);

    // Debounce search by 500ms
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const searchTerm = searchInput.trim().toLowerCase();
        const isEmail = searchTerm.includes("@");

        let query = supabase
          .from("profiles")
          .select(
            "id, username, email, display_name, first_name, last_name, avatar_url"
          )
          .limit(10);

        if (isEmail) {
          // Search by email
          query = query.ilike("email", `%${searchTerm}%`);
        } else {
          // Search by username
          query = query.ilike("username", `%${searchTerm}%`);
        }

        // Exclude current user
        if (user?.id) {
          query = query.neq("id", user.id);
        }

        const { data, error: searchError } = await query;

        if (searchError) throw searchError;

        // Filter out users with any block relationship (blocker or blocked)
        const rawResults = data || [];
        const filteredResults: SearchUser[] = [];
        
        for (const result of rawResults) {
          const hasBlock = await blockService.hasBlockBetween(result.id);
          if (!hasBlock) {
            filteredResults.push(result);
          }
        }
        
        setSearchResults(filteredResults);
        setSearchCompleted(true);

        // Check if no results found
        if (filteredResults.length === 0) {
          setUserNotFound(true);
          setSelectedUser(null);
        } else {
          setUserNotFound(false);
          // If exact match found, auto-select it
          if (filteredResults.length === 1) {
            const exactMatch = filteredResults.find((u) =>
              isEmail
                ? u.email.toLowerCase() === searchTerm
                : u.username.toLowerCase() === searchTerm
            );
            if (exactMatch) {
              setSelectedUser(exactMatch);
            } else {
              setSelectedUser(null);
            }
          } else {
            setSelectedUser(null);
          }
        }
      } catch (err: any) {
        console.error("Error searching users:", err);
        setError("Error searching users. Please try again.");
        setSearchResults([]);
        setSearchCompleted(false);
        setUserNotFound(false);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput, isOpen, activeTab, user?.id]);

  // Load sent requests when tab changes
  useEffect(() => {
    if (activeTab === "sent" && isOpen) {
      setLoadingSentRequests(true);
      loadFriendRequests().finally(() => {
        setLoadingSentRequests(false);
      });
    }
  }, [activeTab, isOpen, loadFriendRequests]);

  const handleSelectUser = (user: SearchUser) => {
    setSelectedUser(user);
    setSearchResults([]);
  };

  const handleSendRequest = async () => {
    if (!selectedUser || !user || !profile) {
      setError("Please select a user to send a friend request");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Call the updated addFriend function which handles email/push notifications
      await addFriend(
        selectedUser.id,
        selectedUser.email,
        selectedUser.username
      );

      // Only show success if we got here without errors
      setRequestSent(true);

      // Reload friend requests
      await loadFriendRequests();

      // Auto close modal after success
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err: any) {
      console.error("Error sending friend request:", err);
      setRequestSent(false); // Make sure success state is cleared on error
      setError(
        err.message || "Failed to send friend request. Please try again."
      );
      setIsLoading(false); // Stop loading on error
    }
  };

  const handleUnsendRequest = async (requestId: string) => {
    setCancellingRequestId(requestId);
    try {
      await cancelFriendRequest(requestId);
      await loadFriendRequests();
    } catch (err: any) {
      console.error("Error cancelling friend request:", err);
    } finally {
      setCancellingRequestId(null);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleClose = () => {
    onClose();
    // Reset state when closing
    setActiveTab("add");
    setSearchInput("");
    setSearchResults([]);
    setSelectedUser(null);
    setRequestSent(false);
    setError("");
    setIsLoading(false);
    setIsSearching(false);
    setSearchCompleted(false);
    setUserNotFound(false);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  };

  // Get sent requests from friendRequests
  const sentRequests = friendRequests.filter(
    (req) => req.type === "outgoing" && req.status === "pending"
  );

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIcon}>
                  <Ionicons
                    name={activeTab === "add" ? "person-add" : "time"}
                    size={20}
                    color="white"
                  />
                </View>
                <View>
                  <Text style={styles.headerTitle}>
                    {activeTab === "add" ? "Add Friend" : "Sent Requests"}
                  </Text>
                  <Text style={styles.headerSubtitle}>
                    {activeTab === "add"
                      ? "Send a friend request"
                      : "Manage pending requests"}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabsContainer}>
              <TouchableOpacity
                onPress={() => {
                  setActiveTab("add");
                  setSearchInput("");
                  setSearchResults([]);
                  setSelectedUser(null);
                  setRequestSent(false);
                  setError("");
                }}
                style={[styles.tab, activeTab === "add" && styles.tabActive]}
              >
                <Ionicons
                  name="person-add"
                  size={16}
                  color={activeTab === "add" ? "#FFFFFF" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === "add" && styles.tabTextActive,
                  ]}
                >
                  Add Friend
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveTab("sent")}
                style={[
                  styles.tab,
                  activeTab === "sent" && styles.tabActive,
                  { position: "relative" },
                ]}
              >
                <Ionicons
                  name="time"
                  size={16}
                  color={activeTab === "sent" ? "#eb7825" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === "sent" && styles.tabTextActive,
                  ]}
                >
                  Sent
                </Text>
                {sentRequests.length > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {sentRequests.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Content */}
          <ScrollView style={styles.content}>
            {activeTab === "add" ? (
              <View style={styles.addTabContent}>
                {/* Search Input */}
                <View style={styles.searchSection}>
                  <Text style={styles.searchLabel}>Username or Email</Text>
                  <View style={styles.searchInputContainer}>
                    <View style={styles.searchInputIcon}>
                      <Ionicons
                        name={searchInput.includes("@") ? "mail" : "at"}
                        size={16}
                        color="#9ca3af"
                      />
                    </View>
                    <TextInput
                      value={searchInput}
                      onChangeText={setSearchInput}
                      placeholder="Enter username or email..."
                      style={styles.searchInput}
                      editable={!isLoading}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {isSearching && (
                      <View style={styles.searchLoadingIndicator}>
                        <ActivityIndicator size="small" color="#eb7825" />
                      </View>
                    )}
                  </View>
                  {error && (
                    <View style={styles.errorContainer}>
                      <Ionicons name="alert-circle" size={16} color="#dc2626" />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}
                </View>

                {/* User Not Found Message */}
                {userNotFound && searchCompleted && !isSearching && (
                  <View style={styles.notFoundContainer}>
                    <View style={styles.notFoundIcon}>
                      <Ionicons
                        name="person-outline"
                        size={32}
                        color="#9ca3af"
                      />
                    </View>
                    <Text style={styles.notFoundTitle}>User Not Found</Text>
                    <Text style={styles.notFoundText}>
                      {searchInput.includes("@")
                        ? `No user found with email "${searchInput}"`
                        : `No user found with username "${searchInput}"`}
                    </Text>
                    <Text style={styles.notFoundSubtext}>
                      {searchInput.includes("@")
                        ? "Invite them to join Mingla and connect with you!"
                        : "To invite someone who isn't on Mingla, please use their email address."}
                    </Text>
                    {searchInput.includes("@") && (
                      <TouchableOpacity
                        onPress={async () => {
                          setIsLoading(true);
                          setError("");
                          try {
                            const searchTerm = searchInput.trim();

                            // Call addFriend with email (not a UUID, so it will be treated as email-only invite)
                            await addFriend(
                              searchTerm, // Email address (not a UUID)
                              searchTerm, // receiverEmail
                              undefined // No username for non-existent users
                            );

                            setRequestSent(true);

                            // Auto close modal after success
                            setTimeout(() => {
                              handleClose();
                            }, 2000);
                          } catch (err: any) {
                            console.error("Error sending invite:", err);
                            setError(
                              err.message ||
                                "Failed to send invite. Please try again."
                            );
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        disabled={isLoading}
                        style={[
                          styles.inviteButton,
                          isLoading && styles.inviteButtonDisabled,
                        ]}
                      >
                        {isLoading ? (
                          <>
                            <ActivityIndicator size="small" color="white" />
                            <Text style={styles.inviteButtonText}>
                              Sending...
                            </Text>
                          </>
                        ) : (
                          <>
                            <Ionicons name="mail" size={16} color="white" />
                            <Text style={styles.inviteButtonText}>
                              Invite Friend to Mingla
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Search Results List */}
                {searchResults.length > 0 && !selectedUser && !userNotFound && (
                  <View style={styles.searchResultsContainer}>
                    <ScrollView
                      style={styles.searchResultsList}
                      nestedScrollEnabled
                    >
                      {searchResults.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.searchResultItem}
                          onPress={() => handleSelectUser(item)}
                        >
                          <View style={styles.searchResultAvatar}>
                            {item.avatar_url ? (
                              <Text style={styles.searchResultAvatarText}>
                                IMG
                              </Text>
                            ) : (
                              <Text style={styles.searchResultAvatarText}>
                                {(
                                  item.display_name ||
                                  item.first_name ||
                                  item.username ||
                                  "U"
                                )
                                  .split(" ")
                                  .map((n: string) => n[0])
                                  .join("")
                                  .toUpperCase()
                                  .substring(0, 2)}
                              </Text>
                            )}
                          </View>
                          <View style={styles.searchResultInfo}>
                            <Text style={styles.searchResultName}>
                              {item.display_name ||
                                (item.first_name && item.last_name
                                  ? `${item.first_name} ${item.last_name}`
                                  : item.username)}
                            </Text>
                            <Text style={styles.searchResultUsername}>
                              @{item.username}
                            </Text>
                            {item.email && (
                              <Text style={styles.searchResultEmail}>
                                {item.email}
                              </Text>
                            )}
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={20}
                            color="#9ca3af"
                          />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Selected User Result */}
                {selectedUser && (
                  <View style={styles.searchResult}>
                    <View style={styles.searchResultHeader}>
                      <View style={styles.searchResultAvatar}>
                        {selectedUser.avatar_url ? (
                          <Text style={styles.searchResultAvatarText}>IMG</Text>
                        ) : (
                          <Text style={styles.searchResultAvatarText}>
                            {(
                              selectedUser.display_name ||
                              selectedUser.first_name ||
                              selectedUser.username ||
                              "U"
                            )
                              .split(" ")
                              .map((n: string) => n[0])
                              .join("")
                              .toUpperCase()
                              .substring(0, 2)}
                          </Text>
                        )}
                      </View>
                      <View style={styles.searchResultInfo}>
                        <Text style={styles.searchResultName}>
                          {selectedUser.display_name ||
                            (selectedUser.first_name && selectedUser.last_name
                              ? `${selectedUser.first_name} ${selectedUser.last_name}`
                              : selectedUser.username)}
                        </Text>
                        <Text style={styles.searchResultUsername}>
                          @{selectedUser.username}
                        </Text>
                        {selectedUser.email && (
                          <Text style={styles.searchResultEmail}>
                            {selectedUser.email}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedUser(null);
                          setSearchResults([]);
                        }}
                        style={styles.clearSelectionButton}
                      >
                        <Ionicons name="close" size={20} color="#6b7280" />
                      </TouchableOpacity>
                    </View>

                    {requestSent ? (
                      <View style={styles.successMessage}>
                        <Ionicons name="checkmark" size={16} color="#059669" />
                        <Text style={styles.successText}>
                          Friend request sent!
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={handleSendRequest}
                        disabled={isLoading}
                        style={[
                          styles.sendButton,
                          isLoading && styles.sendButtonDisabled,
                        ]}
                      >
                        {isLoading ? (
                          <>
                            <ActivityIndicator size="small" color="white" />
                            <Text style={styles.sendButtonText}>
                              Sending...
                            </Text>
                          </>
                        ) : (
                          <>
                            <Ionicons name="send" size={16} color="white" />
                            <Text style={styles.sendButtonText}>
                              Send Friend Request
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Tips */}
                <View style={styles.tipsContainer}>
                  <Text style={styles.tipsTitle}>Tips:</Text>
                  <View style={styles.tipsList}>
                    <Text style={styles.tipItem}>
                      • Enter their exact username (e.g., @johndoe)
                    </Text>
                    <Text style={styles.tipItem}>
                      • Or use their email address
                    </Text>
                    <Text style={styles.tipItem}>
                      • Make sure the spelling is correct
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.sentTabContent}>
                {/* Sent Requests List */}
                {loadingSentRequests ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#eb7825" />
                    <Text style={styles.loadingText}>
                      Loading sent requests...
                    </Text>
                  </View>
                ) : sentRequests.length === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyStateIcon}>
                      <Ionicons name="time" size={32} color="#9ca3af" />
                    </View>
                    <Text style={styles.emptyStateTitle}>No Sent Requests</Text>
                    <Text style={styles.emptyStateText}>
                      You haven't sent any friend requests yet.
                    </Text>
                    <TouchableOpacity
                      onPress={() => setActiveTab("add")}
                      style={styles.emptyStateButton}
                    >
                      <Ionicons name="person-add" size={16} color="white" />
                      <Text style={styles.emptyStateButtonText}>
                        Add Friends
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.sentRequestsList}>
                    {sentRequests.map((request) => (
                      <View key={request.id} style={styles.sentRequestItem}>
                        <View style={styles.sentRequestHeader}>
                          <View style={styles.sentRequestAvatar}>
                            <Text style={styles.sentRequestAvatarText}>
                              {(
                                request.sender.display_name ||
                                request.sender.username ||
                                "U"
                              )
                                .split(" ")
                                .map((n: string) => n[0])
                                .join("")
                                .toUpperCase()
                                .substring(0, 2)}
                            </Text>
                          </View>
                          <View style={styles.sentRequestInfo}>
                            <Text style={styles.sentRequestName}>
                              {request.sender.display_name ||
                                (request.sender.first_name &&
                                request.sender.last_name
                                  ? `${request.sender.first_name} ${request.sender.last_name}`
                                  : request.sender.username)}
                            </Text>
                            <Text style={styles.sentRequestUsername}>
                              @{request.sender.username}
                            </Text>
                            <View style={styles.sentRequestMeta}>
                              <Text style={styles.sentRequestTime}>
                                Sent {formatTimeAgo(request.created_at)}
                              </Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleUnsendRequest(request.id)}
                            style={styles.unsendButton}
                            disabled={cancellingRequestId === request.id}
                          >
                            {cancellingRequestId === request.id ? (
                              <ActivityIndicator size="small" color="#6b7280" />
                            ) : (
                              <Ionicons
                                name="person-remove"
                                size={16}
                                color="#6b7280"
                              />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

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
    height: SCREEN_HEIGHT * 0.8,
    maxHeight: SCREEN_HEIGHT * 0.8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerLeft: {
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
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  tabActive: {
    backgroundColor: "#eb7825",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  tabBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    backgroundColor: "#eb7825",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: {
    fontSize: 12,
    color: "white",
    fontWeight: "500",
  },
  content: {
    flex: 1,
    padding: 24,
  },
  addTabContent: {
    gap: 24,
  },
  searchSection: {
    gap: 8,
  },
  searchLabel: {
    color: "#374151",
    fontWeight: "500",
    fontSize: 14,
  },
  searchInputContainer: {
    position: "relative",
  },
  searchInputIcon: {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: [{ translateY: -8 }],
    zIndex: 1,
  },
  searchInput: {
    width: "100%",
    paddingLeft: 40,
    paddingRight: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: "white",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fef2f2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#dc2626",
  },
  searchButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
    borderRadius: 12,
  },
  searchButtonDisabled: {
    backgroundColor: "#d1d5db",
  },
  searchButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "500",
  },
  loadingSpinner: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: "white",
    borderTopColor: "transparent",
    borderRadius: 8,
  },
  searchResult: {
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 16,
    gap: 16,
  },
  searchResultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchResultAvatar: {
    width: 48,
    height: 48,
    backgroundColor: "#eb7825",
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  searchResultAvatarText: {
    color: "white",
    fontWeight: "500",
    fontSize: 16,
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  searchResultUsername: {
    fontSize: 14,
    color: "#6b7280",
  },
  searchResultMutual: {
    fontSize: 12,
    color: "#6b7280",
  },
  successMessage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: "#f0fdf4",
    borderRadius: 8,
  },
  successText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#059669",
  },
  sendButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
    borderRadius: 12,
  },
  sendButtonDisabled: {
    backgroundColor: "#d1d5db",
  },
  sendButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "500",
  },
  tipsContainer: {
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 12,
    padding: 16,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
    marginBottom: 8,
  },
  tipsList: {
    gap: 4,
  },
  tipItem: {
    fontSize: 14,
    color: "#374151",
  },
  sentTabContent: {
    gap: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
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
    marginBottom: 24,
    textAlign: "center",
  },
  emptyStateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#eb7825",
    borderRadius: 12,
  },
  emptyStateButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
  sentRequestsList: {
    gap: 12,
  },
  sentRequestItem: {
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 16,
  },
  sentRequestHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sentRequestAvatar: {
    width: 48,
    height: 48,
    backgroundColor: "#eb7825",
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  sentRequestAvatarText: {
    color: "white",
    fontWeight: "500",
    fontSize: 16,
  },
  sentRequestInfo: {
    flex: 1,
  },
  sentRequestName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  sentRequestUsername: {
    fontSize: 14,
    color: "#6b7280",
  },
  sentRequestMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  sentRequestTime: {
    fontSize: 12,
    color: "#6b7280",
  },
  sentRequestSeparator: {
    fontSize: 12,
    color: "#d1d5db",
  },
  sentRequestMutual: {
    fontSize: 12,
    color: "#6b7280",
  },
  unsendButton: {
    padding: 8,
    borderRadius: 8,
  },
  searchLoadingIndicator: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: [{ translateY: -8 }],
  },
  searchResultsContainer: {
    maxHeight: 300,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    marginTop: 8,
  },
  searchResultsList: {
    maxHeight: 300,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  searchResultEmail: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
  },
  clearSelectionButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: "#6b7280",
  },
  notFoundContainer: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  notFoundIcon: {
    width: 64,
    height: 64,
    backgroundColor: "#f3f4f6",
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  notFoundText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 8,
  },
  notFoundSubtext: {
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 24,
  },
  inviteButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
    borderRadius: 12,
  },
  inviteButtonDisabled: {
    backgroundColor: "#d1d5db",
  },
  inviteButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "500",
  },
});
