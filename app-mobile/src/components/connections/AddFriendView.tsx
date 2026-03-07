import React, { useState, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { searchUsers } from "../../services/friendLinkService";
import { UserSearchResult } from "../../types/friendLink";
import { useSendFriendLink } from "../../hooks/useFriendLinks";
import { s, vs } from "../../utils/responsive";

interface AddFriendViewProps {
  currentUserId: string;
  existingFriendIds: string[];
  onRequestSent: () => void;
}

export function AddFriendView({
  currentUserId,
  existingFriendIds,
  onRequestSent,
}: AddFriendViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendLinkMutation = useSendFriendLink();

  const handleSearch = (text: string) => {
    setQuery(text);
    setSearchError(false);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!text.trim() || text.trim().length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchUsers(text.trim());
        // Filter out self
        setResults(data.filter((u) => u.id !== currentUserId));
      } catch (err) {
        console.error("Error searching users:", err);
        setResults([]);
        setSearchError(true);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleSendRequest = (user: UserSearchResult) => {
    sendLinkMutation.mutate(
      { targetUserId: user.id },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setSentIds((prev) => new Set(prev).add(user.id));
          onRequestSent();
        },
        onError: (err: any) => {
          const msg = err?.message || "";
          if (msg.includes("already exists")) {
            Alert.alert("", "A connection already exists with this user.");
            setSentIds((prev) => new Set(prev).add(user.id));
          } else {
            Alert.alert("", "Couldn't send request. Try again?");
          }
        },
      }
    );
  };

  const getInitials = (name: string): string => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  const renderUserRow = ({ item }: { item: UserSearchResult }) => {
    const displayName = item.display_name || item.username || "Unknown";
    const isFriend = existingFriendIds.includes(item.id);
    const isSent = sentIds.has(item.id);
    const isSending = sendLinkMutation.isPending && sendLinkMutation.variables?.targetUserId === item.id;

    return (
      <View style={styles.userRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.userUsername} numberOfLines={1}>
            @{item.username}
          </Text>
        </View>
        {isFriend ? (
          <Text style={styles.alreadyFriendsText}>Already friends</Text>
        ) : isSent ? (
          <View style={styles.sentButton}>
            <Ionicons name="checkmark" size={s(16)} color="#6b7280" />
            <Text style={styles.sentText}>Sent</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => handleSendRequest(item)}
            style={styles.addButton}
            disabled={isSending}
            activeOpacity={0.7}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.addButtonText}>Add</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={s(18)}
          color="#9ca3af"
          style={styles.searchIcon}
        />
        <TextInput
          placeholder="Search by username..."
          value={query}
          onChangeText={handleSearch}
          style={styles.searchInput}
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {!query.trim() ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Search by username to find friends</Text>
        </View>
      ) : loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingLabel}>Searching...</Text>
        </View>
      ) : searchError ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Search failed. Try again?</Text>
        </View>
      ) : results.length === 0 && query.trim().length >= 2 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No one found for "{query.trim()}"</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderUserRow}
          scrollEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: s(16),
    paddingVertical: vs(12),
    backgroundColor: "#f9fafb",
    borderRadius: s(12),
    marginHorizontal: s(16),
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: s(10),
    paddingHorizontal: s(12),
    marginBottom: vs(8),
  },
  searchIcon: {
    marginRight: s(8),
  },
  searchInput: {
    flex: 1,
    paddingVertical: vs(10),
    fontSize: s(15),
    color: "#111827",
  },
  loadingState: {
    paddingVertical: vs(16),
    alignItems: "center",
    gap: s(8),
  },
  loadingLabel: {
    fontSize: s(14),
    color: "#6b7280",
  },
  emptyState: {
    paddingVertical: vs(16),
    alignItems: "center",
  },
  emptyText: {
    fontSize: s(14),
    color: "#6b7280",
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: vs(8),
  },
  avatar: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    marginRight: s(10),
  },
  avatarText: {
    color: "#6b7280",
    fontSize: s(13),
    fontWeight: "600",
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#111827",
  },
  userUsername: {
    fontSize: s(13),
    color: "#9ca3af",
    marginTop: vs(1),
  },
  addButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: s(16),
    paddingVertical: vs(6),
    borderRadius: s(8),
    minWidth: s(56),
    alignItems: "center",
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: s(14),
    fontWeight: "600",
  },
  alreadyFriendsText: {
    fontSize: s(12),
    color: "#9ca3af",
    fontStyle: "italic",
  },
  sentButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    paddingHorizontal: s(16),
    paddingVertical: vs(6),
    borderRadius: s(8),
    gap: s(4),
  },
  sentText: {
    fontSize: s(14),
    color: "#6b7280",
    fontWeight: "500",
  },
});
