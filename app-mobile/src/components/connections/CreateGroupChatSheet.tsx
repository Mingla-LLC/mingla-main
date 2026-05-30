import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import {
  BaseBottomSheet,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { colors, fontWeights } from "../../constants/designSystem";
import { s } from "../../utils/responsive";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { getDisplayName } from "../../utils/getDisplayName";

export type CreateGroupChatFriend = {
  id: string;
  name?: string;
  username?: string;
  avatar?: string | null;
  avatar_url?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  friend_user_id?: string | null;
};

interface CreateGroupChatSheetProps {
  visible: boolean;
  onClose: () => void;
  availableFriends: CreateGroupChatFriend[];
  isCreating: boolean;
  onSubmit: (
    sessionName: string,
    selectedFriends: CreateGroupChatFriend[],
  ) => Promise<{ conversationId: string; sessionId: string } | void>;
  onCreated: (conversationId: string, sessionId: string) => void;
}

// META-ORCH-0991 Wave C Batch 1 — content-height tall snap. Was an RN <Modal>
// slide-up flex-end card capped at maxHeight 85%; the name field + search +
// friend list need the tall feel → fixed ['90%'] (playbook §2 off-screen
// lesson: prefer a fixed snap over content-dynamic sizing).
const SNAP_POINTS = ["90%"];

function getFriendId(friend: CreateGroupChatFriend): string {
  return friend.friend_user_id || friend.id;
}

function getFriendName(friend: CreateGroupChatFriend): string {
  return friend.name || getDisplayName(friend as any);
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

export function CreateGroupChatSheet({
  visible,
  onClose,
  availableFriends,
  isCreating,
  onSubmit,
  onCreated,
}: CreateGroupChatSheetProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const { t } = useTranslation(["social", "common"]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (visible) return;
    setName("");
    setSearch("");
    setSelectedIds(new Set());
    setError(null);
  }, [visible]);

  const filteredFriends = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableFriends;
    return availableFriends.filter((friend) => {
      const displayName = getFriendName(friend).toLowerCase();
      const username = (friend.username || "").toLowerCase();
      return displayName.includes(query) || username.includes(query);
    });
  }, [availableFriends, search]);

  const selectedFriends = useMemo(
    () => availableFriends.filter((friend) => selectedIds.has(getFriendId(friend))),
    [availableFriends, selectedIds],
  );

  const canSubmit = name.trim().length > 0 && selectedIds.size > 0 && !isCreating;

  const toggleFriend = (friend: CreateGroupChatFriend) => {
    const friendId = getFriendId(friend);
    HapticFeedback.light();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        next.add(friendId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    HapticFeedback.medium();
    try {
      const result = await onSubmit(name.trim(), selectedFriends);
      if (
        result &&
        typeof result === "object" &&
        "conversationId" in result &&
        "sessionId" in result &&
        result.conversationId &&
        result.sessionId
      ) {
        onCreated(result.conversationId, result.sessionId);
      }
      setTimeout(onClose, 200);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:error"));
    }
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t("social:createGroupChatSheetTitle")}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common:close", { defaultValue: "Close" })}
          hitSlop={10}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.pressed : null,
          ]}
          disabled={isCreating}
        >
          <Icon name="close" size={22} color={colors.text.primary} />
        </Pressable>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  const footer = (
    <View
      style={[
        styles.footer,
        { paddingBottom: Math.max(insets.bottom, s(16)) + s(8) },
      ]}
    >
      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        style={({ pressed }) => [
          styles.submitButton,
          !canSubmit ? styles.submitButtonDisabled : null,
          pressed && canSubmit ? styles.pressed : null,
        ]}
      >
        {isCreating ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.submitText}>
            {t("social:createGroupChatSubmit")}
          </Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      theme="light"
      scrollMode="scroll"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("social:createGroupChatSheetTitle")}
      header={header}
      stickyFooter={footer}
      scrollProps={{
        keyboardShouldPersistTaps: "handled",
        showsVerticalScrollIndicator: false,
        contentContainerStyle: styles.body,
      }}
    >
      <BottomSheetTextInput
        ref={inputRef as any}
        value={name}
        onChangeText={setName}
        placeholder={t("social:createGroupChatNamePlaceholder")}
        placeholderTextColor={colors.gray[400]}
        maxLength={60}
        style={styles.nameInput}
        editable={!isCreating}
        returnKeyType="done"
      />

      <Text style={styles.sectionLabel}>
        {t("social:createGroupChatFriendsLabel")}
      </Text>

      {availableFriends.length > 3 ? (
        <View style={styles.searchWrap}>
          <Icon name="search" size={18} color={colors.gray[400]} />
          <BottomSheetTextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("common:search", { defaultValue: "Search" })}
            placeholderTextColor={colors.gray[400]}
            style={styles.searchInput}
            editable={!isCreating}
          />
        </View>
      ) : null}

      <View style={styles.friendList}>
        {filteredFriends.map((friend) => {
          const friendId = getFriendId(friend);
          const displayName = getFriendName(friend);
          const selected = selectedIds.has(friendId);
          const avatarUrl = friend.avatar || friend.avatar_url || null;
          return (
            <Pressable
              key={friendId}
              onPress={() => toggleFriend(friend)}
              disabled={isCreating}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: isCreating }}
              style={({ pressed }) => [
                styles.friendRow,
                pressed && !isCreating ? styles.pressed : null,
              ]}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
                </View>
              )}
              <Text style={styles.friendName} numberOfLines={1}>
                {displayName}
              </Text>
              <View style={[styles.checkCircle, selected ? styles.checkCircleSelected : null]}>
                {selected ? <Icon name="checkmark" size={14} color="#FFFFFF" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    paddingHorizontal: s(20),
    paddingTop: s(4),
  },
  header: {
    minHeight: s(44),
    justifyContent: "center",
  },
  title: {
    color: colors.text.primary,
    fontSize: s(18),
    fontWeight: fontWeights.bold,
    textAlign: "center",
  },
  closeButton: {
    position: "absolute",
    right: 0,
    top: 0,
    width: s(44),
    height: s(44),
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  errorText: {
    color: colors.error[600],
    fontSize: s(13),
    fontWeight: fontWeights.medium,
    marginTop: s(8),
  },
  body: {
    paddingHorizontal: s(20),
    paddingTop: s(16),
    paddingBottom: s(16),
    gap: s(14),
  },
  nameInput: {
    height: s(52),
    borderRadius: s(14),
    backgroundColor: colors.gray[50],
    paddingHorizontal: s(16),
    color: colors.text.primary,
    fontSize: s(16),
    fontWeight: fontWeights.medium,
  },
  sectionLabel: {
    color: colors.text.primary,
    fontSize: s(14),
    fontWeight: fontWeights.bold,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    height: s(44),
    borderRadius: s(12),
    backgroundColor: colors.gray[50],
    paddingHorizontal: s(12),
  },
  searchInput: {
    flex: 1,
    color: colors.text.primary,
    fontSize: s(15),
  },
  friendList: {
    gap: s(8),
  },
  friendRow: {
    minHeight: s(58),
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    borderRadius: s(14),
    paddingHorizontal: s(12),
    backgroundColor: colors.gray[50],
  },
  avatar: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
  },
  avatarFallback: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: s(13),
    fontWeight: fontWeights.bold,
  },
  friendName: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontSize: s(15),
    fontWeight: fontWeights.semibold,
  },
  checkCircle: {
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    borderWidth: 1,
    borderColor: colors.gray[300],
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  footer: {
    paddingHorizontal: s(20),
    paddingTop: s(8),
  },
  submitButton: {
    height: s(48),
    borderRadius: s(14),
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: s(16),
    fontWeight: fontWeights.bold,
  },
});
