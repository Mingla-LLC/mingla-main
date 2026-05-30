import React, { useState, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTranslation } from 'react-i18next';
import {
  BaseBottomSheet,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Friend } from "../../hooks/useFriends";
import { getDisplayName } from "../../utils/getDisplayName";

interface FriendPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectFriend: (friend: Friend) => void;
  friends: Friend[];
  loadingFriends: boolean;
}

// META-ORCH-0991 Wave C Batch 1 — was an RN <Modal> slide-up flex-end card at
// height "88%" → fixed ['88%'] snap (playbook §2: match the prior modal height,
// prefer a fixed snap over content-dynamic sizing). The friend results are a
// long VERTICAL list → routed through BaseBottomSheet's flatlist scroll mode
// (BottomSheetFlatList) instead of a raw RN <FlatList>, so the list scroll
// coordinates with the sheet pan gesture (playbook §5).
const SNAP_POINTS = ["88%"];

function getInitials(name: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

function getFriendDisplayName(friend: Friend): string {
  return getDisplayName(friend);
}

export function FriendPickerSheet({
  visible,
  onClose,
  onSelectFriend,
  friends,
  loadingFriends,
}: FriendPickerSheetProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingFriendId, setLoadingFriendId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const query = searchQuery.toLowerCase();
    return friends.filter((friend) => {
      const name = getFriendDisplayName(friend).toLowerCase();
      const username = (friend.username || "").toLowerCase();
      return name.includes(query) || username.includes(query);
    });
  }, [friends, searchQuery]);

  const handleSelectFriend = async (friend: Friend) => {
    setLoadingFriendId(friend.friend_user_id || friend.id);
    try {
      await onSelectFriend(friend);
    } finally {
      setLoadingFriendId(null);
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setLoadingFriendId(null);
    onClose();
  };

  const renderFriendRow = ({ item: friend }: { item: Friend }) => {
    const displayName = getFriendDisplayName(friend);
    const friendId = friend.friend_user_id || friend.id;
    const isLoading = loadingFriendId === friendId;

    return (
      <TouchableOpacity
        onPress={() => handleSelectFriend(friend)}
        style={styles.friendRow}
        activeOpacity={0.7}
        disabled={isLoading}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: "#7c3aed" },
          ]}
        >
          <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
        </View>
        <View style={styles.friendInfo}>
          <Text style={styles.friendName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        {isLoading && (
          <ActivityIndicator size="small" color="#eb7825" />
        )}
      </TouchableOpacity>
    );
  };

  // Header (handle is owned by the primitive's gorhom handle): title + close +
  // search field. Rendered as the FlatList ListHeaderComponent so it scrolls
  // with the list / stays above the keyboard via keyboardBehavior interactive.
  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('chat:newMessage')}</Text>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Icon name="close" size={24} color="#111827" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Icon
          name="search"
          size={18}
          color="#9ca3af"
          style={styles.searchIcon}
        />
        <BottomSheetTextInput
          placeholder={t('chat:searchFriends')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
        />
      </View>
    </View>
  );

  // Loading / no-friends / no-results states render as the list's empty
  // component so they sit below the (always-visible) search header.
  const renderEmpty = () => {
    if (loadingFriends) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      );
    }
    if (friends.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Icon name="people-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>{t('chat:noFriendsYet')}</Text>
          <Text style={styles.emptySubtitle}>
            {t('chat:addFriendsToStart')}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Icon name="search" size={48} color="#d1d5db" />
        <Text style={styles.emptyTitle}>{t('chat:noResults')}</Text>
        <Text style={styles.emptySubtitle}>
          {t('chat:tryDifferentSearch')}
        </Text>
      </View>
    );
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={handleClose}
      snapPoints={SNAP_POINTS}
      theme="light"
      scrollMode="flatlist"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t('chat:newMessage')}
      header={header}
      scrollProps={{
        data: filteredFriends,
        keyExtractor: (item: Friend) => item.id,
        keyboardShouldPersistTaps: "handled",
        keyboardDismissMode: "on-drag",
        renderItem: renderFriendRow,
        showsVerticalScrollIndicator: false,
        contentContainerStyle: styles.listContent,
        ListEmptyComponent: renderEmpty,
        ListFooterComponent: <View style={{ height: insets.bottom }} />,
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
  },
  listContent: {
    paddingHorizontal: 8,
    flexGrow: 1,
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    height: 60,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  friendInfo: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  friendUsername: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
});
