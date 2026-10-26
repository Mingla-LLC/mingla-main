/**
 * Issue #4114 Wave 2a (D15) — the pencil's "New message" sheet.
 *
 * Search friends, a "New group" row (the existing CreateGroupChatSheet, with the
 * PLUS badge and paywall gate exactly as FriendsActionChooserSheet did), an
 * "Add a friend" row (opens PairRequestModal until Wave 2b replaces it), then
 * the friends list. Tapping a friend calls the page's existing handlePickFriend.
 *
 * The page opens every follow-up surface only after this sheet has closed, so
 * two RN-Modal-backed sheets never co-present on iOS.
 */
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import type { Friend } from "../../hooks/useFriends";
import { getDisplayName } from "../../utils/getDisplayName";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { ChatAvatar } from "./ChatAvatar";
import {
  CHAT_ROW_GAP,
  CHAT_ROW_HEIGHT,
  CHAT_ROW_SIDE_PADDING,
  CHAT_SEARCH_HEIGHT,
  friendMatches,
  friendUserIdOf,
} from "./chatListModel";

const tk = glass.discover.chatList;
const SNAP_POINTS = ["88%"];

interface NewMessageSheetProps {
  visible: boolean;
  onClose: () => void;
  friends: Friend[];
  loadingFriends: boolean;
  currentUserId: string;
  /** Friends you already have a 1:1 chat with (for the "no chat yet" hint). */
  chattedUserIds: ReadonlySet<string>;
  onPickFriend: (friend: Friend) => void;
  /** Free plan at its session limit: New group shows PLUS and opens the paywall. */
  createGroupChatDisabled: boolean;
  onNewGroup: () => void;
  onNewGroupPaywall: () => void;
  onAddFriend: () => void;
}

export function NewMessageSheet({
  visible,
  onClose,
  friends,
  loadingFriends,
  currentUserId,
  chattedUserIds,
  onPickFriend,
  createGroupChatDisabled,
  onNewGroup,
  onNewGroupPaywall,
  onAddFriend,
}: NewMessageSheetProps): React.ReactElement {
  const { t } = useTranslation(["connections", "chat", "social", "common"]);
  const [query, setQuery] = useState("");

  const handleClose = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const sortedFriends = useMemo(
    () =>
      [...friends]
        .filter((friend) => friendMatches(friend, query))
        .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b))),
    [friends, query],
  );

  const renderFriend = useCallback(
    ({ item }: { item: Friend }) => {
      const name = getDisplayName(item);
      const userId = friendUserIdOf(item, currentUserId);
      const sub = [
        item.username ? `@${item.username}` : null,
        chattedUserIds.has(userId) ? null : t("connections:friend_no_chat_yet"),
      ].filter(Boolean).join(" · ");
      return (
        <Pressable
          onPress={() => {
            HapticFeedback.light();
            setQuery("");
            onPickFriend(item);
          }}
          accessibilityRole="button"
          accessibilityLabel={sub ? `${name}, ${sub}` : name}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        >
          <ChatAvatar people={[{ id: userId, name, avatarUrl: item.avatar_url }]} shape="circle" label={name} size={44} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
            {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
          </View>
        </Pressable>
      );
    },
    [chattedUserIds, currentUserId, onPickFriend, t],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t("common:cancel")}
          hitSlop={8}
          style={styles.cancel}
        >
          <Text style={styles.cancelText}>{t("common:cancel")}</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {t("connections:new_message_title")}
        </Text>
        <View style={styles.cancel} />
      </View>
      <View style={styles.search}>
        <Icon name="search" size={16} color={tk.faint} />
        <BottomSheetTextInput
          placeholder={t("chat:searchFriends")}
          placeholderTextColor={tk.faint}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t("chat:searchFriends")}
        />
      </View>
    </View>
  );

  const listHeader = (
    <View>
      {query.trim() ? null : (
        <>
          <Pressable
            onPress={() => {
              HapticFeedback.medium();
              if (createGroupChatDisabled) onNewGroupPaywall();
              else onNewGroup();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              createGroupChatDisabled
                ? `${t("connections:new_group")} - ${t("social:friendsActionChooserCreateDisabledPaywall")}`
                : t("connections:new_group")
            }
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <View style={[styles.actionIcon, createGroupChatDisabled ? styles.dim : null]}>
              <Icon name="people-outline" size={22} color={tk.ink} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{t("connections:new_group")}</Text>
            </View>
            {createGroupChatDisabled ? (
              <View style={styles.plusBadge}>
                <Text style={styles.plusBadgeText}>{t("connections:plus_badge")}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => {
              HapticFeedback.medium();
              onAddFriend();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t("connections:add_friend_row")}, ${t("connections:add_friend_row_sub")}`}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <View style={styles.actionIcon}>
              <Icon name="person-add-outline" size={22} color={tk.ink} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{t("connections:add_friend_row")}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{t("connections:add_friend_row_sub")}</Text>
            </View>
          </Pressable>
        </>
      )}
      {sortedFriends.length > 0 ? (
        <Text style={styles.section}>{t("connections:section_friends")}</Text>
      ) : null}
    </View>
  );

  const empty = loadingFriends ? (
    <View style={styles.empty}>
      <ActivityIndicator color={tk.accent} />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>
        {friends.length === 0 ? t("chat:noFriendsYet") : t("chat:noResults")}
      </Text>
      <Text style={styles.emptySub}>
        {friends.length === 0 ? t("chat:addFriendsToStart") : t("chat:tryDifferentSearch")}
      </Text>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={handleClose}
      snapPoints={SNAP_POINTS}
      theme="dark"
      scrollMode="flatlist"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("connections:new_message_title")}
      header={header}
      scrollProps={{
        data: sortedFriends,
        keyExtractor: (item: Friend) => item.id,
        renderItem: renderFriend,
        keyboardShouldPersistTaps: "handled",
        keyboardDismissMode: "on-drag",
        showsVerticalScrollIndicator: false,
        ListHeaderComponent: listHeader,
        ListEmptyComponent: empty,
        contentContainerStyle: styles.listContent,
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
  },
  titleRow: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  cancel: {
    width: 72,
  },
  cancelText: {
    color: tk.accent,
    fontSize: 16,
    fontWeight: "500",
  },
  title: {
    flex: 1,
    textAlign: "center",
    color: tk.ink,
    fontSize: 17,
    fontWeight: "600",
  },
  search: {
    height: CHAT_SEARCH_HEIGHT,
    borderRadius: 10,
    backgroundColor: tk.searchBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: tk.ink,
    fontSize: 15,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: 32,
  },
  row: {
    height: CHAT_ROW_HEIGHT - 8,
    flexDirection: "row",
    alignItems: "center",
    gap: CHAT_ROW_GAP,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING + 2,
  },
  rowPressed: {
    backgroundColor: tk.rowPressed,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tk.sheetRowBg,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    opacity: 0.5,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: tk.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  rowSub: {
    color: tk.dim,
    fontSize: 13,
  },
  plusBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: tk.plusBadgeBg,
  },
  plusBadgeText: {
    color: tk.plusBadgeLabel,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  section: {
    color: tk.sectionLabel,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  empty: {
    alignItems: "center",
    paddingTop: 32,
    paddingHorizontal: 32,
    gap: 6,
  },
  emptyTitle: {
    color: tk.ink,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  emptySub: {
    color: tk.dim,
    fontSize: 14,
    textAlign: "center",
  },
});
