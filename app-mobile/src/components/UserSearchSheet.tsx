import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Image,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { UserSearchResult } from "../types/friendLink";
import { useUserSearch, useSendFriendLink } from "../hooks/useFriendLinks";
import { generateInitials } from "../utils/stringUtils";
import { s } from "../utils/responsive";

interface UserSearchSheetProps {
  visible: boolean;
  onClose: () => void;
  onLinkSent: (linkId: string) => void;
}

export default function UserSearchSheet({
  visible,
  onClose,
  onLinkSent,
}: UserSearchSheetProps) {
  const insets = useSafeAreaInsets();
  const sendLinkMutation = useSendFriendLink();

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  // Debounce search query (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults, isLoading: isSearching } = useUserSearch(debouncedQuery);

  const resetState = useCallback(() => {
    setSearchQuery("");
    setDebouncedQuery("");
    setSelectedUser(null);
    setLinkSent(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleSelectUser = useCallback((user: UserSearchResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedUser(user);
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectedUser(null);
  }, []);

  const handleSendLink = useCallback(async () => {
    if (!selectedUser) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await sendLinkMutation.mutateAsync({ targetUserId: selectedUser.id });
      setLinkSent(true);

      // Auto-close after 2 seconds
      setTimeout(() => {
        onLinkSent(result.linkId);
        handleClose();
      }, 2000);
    } catch (err: any) {
      console.error("[UserSearchSheet] Send link error:", err);
    }
  }, [selectedUser, sendLinkMutation, onLinkSent, handleClose]);

  const getUserInitials = useCallback((user: UserSearchResult): string => {
    if (user.display_name) {
      return generateInitials(user.display_name);
    }
    if (user.username) {
      return user.username.substring(0, 2).toUpperCase();
    }
    return "??";
  }, []);

  const renderSearchResult = useCallback(
    ({ item }: { item: UserSearchResult }) => (
      <TouchableOpacity
        style={styles.resultRow}
        onPress={() => handleSelectUser(item)}
        activeOpacity={0.7}
      >
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.resultAvatar} />
        ) : (
          <View style={styles.resultAvatarFallback}>
            <Text style={styles.resultAvatarInitials}>
              {getUserInitials(item)}
            </Text>
          </View>
        )}
        <View style={styles.resultInfo}>
          <Text style={styles.resultName}>
            {item.display_name || "Unknown"}
          </Text>
          {item.username && (
            <Text style={styles.resultUsername}>@{item.username}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={s(18)} color="#9ca3af" />
      </TouchableOpacity>
    ),
    [handleSelectUser, getUserInitials]
  );

  // Success state
  if (linkSent) {
    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View
            style={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.successContainer}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark-circle" size={s(64)} color="#22c55e" />
              </View>
              <Text style={styles.successTitle}>Link request sent!</Text>
              <Text style={styles.successSubtitle}>
                {selectedUser?.display_name || "User"} will receive your request.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Confirmation state
  if (selectedUser) {
    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View
            style={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <View style={styles.confirmContainer}>
              {selectedUser.avatar_url ? (
                <Image
                  source={{ uri: selectedUser.avatar_url }}
                  style={styles.confirmAvatar}
                />
              ) : (
                <View style={styles.confirmAvatarFallback}>
                  <Text style={styles.confirmAvatarInitials}>
                    {getUserInitials(selectedUser)}
                  </Text>
                </View>
              )}
              <Text style={styles.confirmTitle}>
                Send link request to{" "}
                <Text style={styles.confirmName}>
                  {selectedUser.display_name || selectedUser.username || "this user"}
                </Text>
                ?
              </Text>
              <Text style={styles.confirmDescription}>
                Once accepted, their card activity will be used to personalize your recommendations for them.
              </Text>

              {sendLinkMutation.isError && (
                <Text style={styles.errorText}>
                  {(sendLinkMutation.error as Error)?.message || "Failed to send request"}
                </Text>
              )}

              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancelSelection}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    sendLinkMutation.isPending && styles.buttonDisabled,
                  ]}
                  onPress={handleSendLink}
                  activeOpacity={0.7}
                  disabled={sendLinkMutation.isPending}
                >
                  {sendLinkMutation.isPending ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.sendButtonText}>Send</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Search state
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View
          style={[
            styles.sheetContent,
            styles.sheetContentTall,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerPlaceholder} />
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Find a Friend</Text>
              <Text style={styles.headerSubtitle}>Search Mingla users</Text>
            </View>
            <TouchableOpacity
              style={styles.headerPlaceholder}
              onPress={handleClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={s(22)} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={styles.searchContainer}>
            <Ionicons
              name="search-outline"
              size={s(18)}
              color="#9ca3af"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by username or phone"
              placeholderTextColor="#9ca3af"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={s(18)} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>

          {/* Results */}
          {isSearching ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
              <Text style={styles.searchingText}>Searching...</Text>
            </View>
          ) : debouncedQuery.length < 2 ? (
            <View style={styles.centerContainer}>
              <Ionicons name="people-outline" size={s(48)} color="#9ca3af" />
              <Text style={styles.emptyText}>
                Type at least 2 characters to search
              </Text>
            </View>
          ) : searchResults && searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchResult}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.resultsList}
            />
          ) : (
            <View style={styles.centerContainer}>
              <Ionicons name="search-outline" size={s(48)} color="#9ca3af" />
              <Text style={styles.emptyText}>No users found</Text>
              <Text style={styles.emptySubtext}>
                Try a different search term
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    width: "100%",
    maxHeight: "90%",
  },
  sheetContentTall: {
    minHeight: "60%",
  },
  handleContainer: {
    alignItems: "center",
    marginBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    marginBottom: 16,
  },
  headerPlaceholder: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginTop: 2,
  },
  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    padding: 0,
  },
  // Results
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 40,
    gap: 12,
  },
  searchingText: {
    fontSize: 14,
    color: "#9ca3af",
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#6b7280",
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center",
  },
  resultsList: {
    paddingBottom: 20,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  resultAvatar: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    marginRight: s(12),
  },
  resultAvatarFallback: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginRight: s(12),
  },
  resultAvatarInitials: {
    fontSize: s(16),
    fontWeight: "600",
    color: "#ffffff",
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#111827",
  },
  resultUsername: {
    fontSize: s(13),
    color: "#9ca3af",
    marginTop: 2,
  },
  // Confirm
  confirmContainer: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  confirmAvatar: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    marginBottom: s(16),
  },
  confirmAvatarFallback: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(16),
  },
  confirmAvatarInitials: {
    fontSize: s(24),
    fontWeight: "700",
    color: "#ffffff",
  },
  confirmTitle: {
    fontSize: s(18),
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginBottom: s(8),
  },
  confirmName: {
    color: "#eb7825",
  },
  confirmDescription: {
    fontSize: s(14),
    color: "#6b7280",
    textAlign: "center",
    lineHeight: s(20),
    marginBottom: s(24),
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginBottom: 12,
    textAlign: "center",
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  sendButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Success
  successContainer: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 16,
  },
  successIcon: {
    marginBottom: s(16),
  },
  successTitle: {
    fontSize: s(20),
    fontWeight: "700",
    color: "#22c55e",
    marginBottom: s(8),
  },
  successSubtitle: {
    fontSize: s(14),
    color: "#6b7280",
    textAlign: "center",
  },
});
