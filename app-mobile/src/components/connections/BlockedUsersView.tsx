/**
 * Issue #4114 Wave 2b — Blocked, opened from the "Blocked N ›" row at the
 * bottom of the friends sheet's Friends tab. Dark, like the rest of the sheet
 * (the old light empty state was 65% white on white, so it was invisible).
 */
import React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { BlockedUser } from "../../hooks/useFriends";
import { glass } from "../../constants/designSystem";
import { ChatAvatar } from "./ChatAvatar";

const ink = glass.discover.chatList;
const fs = glass.discover.friendsSheet;

interface BlockedUsersViewProps {
  blockedUsers: BlockedUser[];
  loading: boolean;
  onUnblock: (blockedUserId: string) => void;
  onBack: () => void;
}

export function BlockedUsersView({ blockedUsers, loading, onUnblock, onBack }: BlockedUsersViewProps): React.ReactElement {
  const { t } = useTranslation(["social", "connections", "common"]);

  const handleUnblock = (user: BlockedUser) => {
    const displayName = user.name || user.username || t("social:thisUser", { defaultValue: "this user" });
    Alert.alert(t("social:unblockTitle", { name: displayName }), t("social:unblockMessage"), [
      { text: t("social:cancel"), style: "cancel" },
      { text: t("social:unblock"), style: "destructive", onPress: () => onUnblock(user.id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t("connections:fs_back_a11y")}
        style={styles.backRow}
        hitSlop={6}
      >
        <Icon name="chevron-back" size={18} color={ink.dim} />
        <Text style={styles.backText}>{t("connections:fs_blocked_title")}</Text>
      </Pressable>

      {loading && blockedUsers.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={ink.accent} />
        </View>
      ) : blockedUsers.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="ban-outline" size={28} color={ink.faint} />
          <Text style={styles.emptyText}>{t("connections:fs_empty_blocked")}</Text>
        </View>
      ) : (
        blockedUsers.map((item) => {
          const displayName = item.name || item.username || "Unknown";
          return (
            <View key={item.id} style={styles.userRow}>
              <ChatAvatar people={[{ id: item.id, name: displayName, avatarUrl: item.avatar_url }]} shape="circle" label={displayName} size={44} />
              <View style={styles.userInfo}>
                <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
                {item.username ? <Text style={styles.userUsername} numberOfLines={1}>@{item.username}</Text> : null}
              </View>
              <Pressable
                onPress={() => handleUnblock(item)}
                accessibilityRole="button"
                accessibilityLabel={`${t("social:unblock")} ${displayName}`}
                style={styles.unblockButton}
              >
                <Text style={styles.unblockText}>{t("social:unblock")}</Text>
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingBottom: 32,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  backText: {
    color: ink.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: ink.dim,
  },
  userRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 15.5,
    fontWeight: "600",
    color: ink.ink,
  },
  userUsername: {
    fontSize: 12.5,
    color: ink.faint,
    marginTop: 1,
  },
  unblockButton: {
    minHeight: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: fs.ghostButtonBg,
    alignItems: "center",
    justifyContent: "center",
  },
  unblockText: {
    color: ink.destructive,
    fontSize: 13,
    fontWeight: "700",
  },
});
