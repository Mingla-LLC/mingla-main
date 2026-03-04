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
import { supabase } from "../../services/supabase";

interface SearchResult {
  id: string;
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
}

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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (text: string) => {
    setQuery(text);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!text.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, display_name, first_name, last_name")
          .ilike("username", `%${text.trim()}%`)
          .neq("id", currentUserId)
          .limit(20);

        if (error) {
          console.error("Error searching users:", error);
          setResults([]);
          return;
        }

        setResults(data || []);
      } catch (err) {
        console.error("Error searching users:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleSendRequest = async (user: SearchResult) => {
    setSendingId(user.id);
    try {
      // Check if request already exists
      const { data: existing } = await supabase
        .from("friend_requests")
        .select("id, status")
        .eq("sender_id", currentUserId)
        .eq("receiver_id", user.id)
        .single();

      if (existing) {
        if (existing.status === "pending") {
          Alert.alert("Already Sent", "You already have a pending request to this user.");
          return;
        }
        // Update existing declined/cancelled request to pending
        await supabase
          .from("friend_requests")
          .update({ status: "pending", created_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        // Create new request
        const { error } = await supabase
          .from("friend_requests")
          .insert({
            sender_id: currentUserId,
            receiver_id: user.id,
            status: "pending",
          });

        if (error) {
          console.error("Error sending friend request:", error);
          Alert.alert("Error", "Failed to send friend request.");
          return;
        }
      }

      setSentIds((prev) => new Set(prev).add(user.id));
      Alert.alert("Success", "Friend request sent");
      onRequestSent();
    } catch (err) {
      console.error("Error sending friend request:", err);
      Alert.alert("Error", "Failed to send friend request.");
    } finally {
      setSendingId(null);
    }
  };

  const getDisplayName = (user: SearchResult): string => {
    return (
      user.display_name ||
      (user.first_name && user.last_name
        ? `${user.first_name} ${user.last_name}`
        : user.username) ||
      "Unknown"
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

  const renderUserRow = ({ item }: { item: SearchResult }) => {
    const displayName = getDisplayName(item);
    const isFriend = existingFriendIds.includes(item.id);
    const isSent = sentIds.has(item.id);
    const isSending = sendingId === item.id;

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
            <Ionicons name="checkmark" size={16} color="#10b981" />
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
          size={18}
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

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color="#eb7825" />
        </View>
      ) : results.length === 0 && query.trim() ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No users found</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    marginHorizontal: 16,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
  },
  loadingState: {
    paddingVertical: 16,
    alignItems: "center",
  },
  emptyState: {
    paddingVertical: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#6b7280",
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  userUsername: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 1,
  },
  addButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 56,
    alignItems: "center",
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  alreadyFriendsText: {
    fontSize: 12,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  sentButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sentText: {
    fontSize: 14,
    color: "#10b981",
    fontWeight: "500",
  },
});
