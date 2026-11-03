/**
 * Issue #4261 Wave B1 — "Add people" for a plain group chat (prototype
 * Main.dc.html, "isAdd"): my accepted friends not already in the chat, each
 * a 52pt row with a round check; "Add {n}" adds them with add_group_members.
 * Session groups keep their existing invite flow (BoardSettingsDropdown).
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { ChatAvatar } from "../connections/ChatAvatar";
import { chatTokens } from "../../constants/chatTokens";
import { useFriendsList } from "../../hooks/useFriendsQuery";
import { useAddGroupMembers } from "../../hooks/useGroupLink";
import { useAppStore } from "../../store/appStore";
import { getDisplayName } from "../../utils/getDisplayName";

const ADD_PEOPLE_SNAP = ["80%"];
const MAX_ADD = 20;

interface AddGroupPeopleSheetProps {
  visible: boolean;
  conversationId: string;
  /** Everyone already in the chat (left out of the list). */
  memberIds: readonly string[];
  /** Back to group info (also the swipe-down). */
  onBack: () => void;
  onShareLink: () => void;
  sharing: boolean;
}

export function AddGroupPeopleSheet({
  visible,
  conversationId,
  memberIds,
  onBack,
  onShareLink,
  sharing,
}: AddGroupPeopleSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const userId = useAppStore((s) => s.user?.id);
  const friendsQuery = useFriendsList(userId);
  const addMembers = useAddGroupMembers(conversationId);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const candidates = useMemo(() => {
    const inChat = new Set(memberIds);
    return (friendsQuery.data ?? [])
      .filter((f) => f.status === "accepted" && !inChat.has(f.friend_user_id))
      .map((f) => ({
        id: f.friend_user_id,
        name: getDisplayName(f, f.username || "?"),
        avatarUrl: f.avatar_url ?? null,
      }));
  }, [friendsQuery.data, memberIds]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_ADD) next.add(id);
      return next;
    });
  };

  const count = picked.size;
  const confirm = () => {
    if (count === 0 || addMembers.isPending) return;
    addMembers.mutate([...picked], {
      onSuccess: () => {
        setPicked(new Set());
        onBack();
      },
    });
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onBack}
      snapPoints={ADD_PEOPLE_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      accessibilityLabel={t("chat:group_add_people_title")}
      header={
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t("common:back")}
            style={styles.headerSide}
          >
            <Text style={styles.backText}>{t("common:back")}</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {t("chat:group_add_people_title")}
          </Text>
          <View style={[styles.headerSide, styles.headerRight]}>
            <Pressable
              onPress={confirm}
              disabled={count === 0 || addMembers.isPending}
              accessibilityRole="button"
              accessibilityLabel={t("chat:group_add_people_cta", { count })}
              accessibilityState={{ disabled: count === 0, busy: addMembers.isPending }}
              style={[styles.addPill, count === 0 ? styles.addPillOff : null]}
            >
              {addMembers.isPending ? (
                <ActivityIndicator size="small" color={chatTokens.textPrimary} />
              ) : (
                <Text style={[styles.addPillText, count === 0 ? styles.addPillTextOff : null]}>
                  {t("chat:group_add_people_cta", { count })}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      }
    >
      <View style={styles.body} testID="add-group-people-sheet">
        <Text style={styles.heading} accessibilityRole="header">
          {t("chat:group_add_friends_heading")}
        </Text>

        {friendsQuery.isLoading ? (
          <ActivityIndicator color={chatTokens.accent} style={styles.loading} />
        ) : friendsQuery.isError ? (
          <Pressable
            onPress={() => void friendsQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("common:retry")}
            style={styles.row}
          >
            <Icon name="refresh-outline" size={20} color={chatTokens.textSecondary} />
            <Text style={styles.name}>{t("common:retry")}</Text>
          </Pressable>
        ) : candidates.length === 0 ? (
          <Text style={styles.empty}>{t("chat:group_add_all_in")}</Text>
        ) : (
          candidates.map((friend) => {
            const on = picked.has(friend.id);
            return (
              <Pressable
                key={friend.id}
                onPress={() => toggle(friend.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={friend.name}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
              >
                <ChatAvatar
                  people={[{ id: friend.id, name: friend.name, avatarUrl: friend.avatarUrl }]}
                  shape="circle"
                  label={friend.name}
                  size={38}
                />
                <Text style={styles.name} numberOfLines={1}>
                  {friend.name}
                </Text>
                <View style={[styles.check, on ? styles.checkOn : null]}>
                  {on ? <Icon name="checkmark" size={14} color={chatTokens.textPrimary} /> : null}
                </View>
              </Pressable>
            );
          })
        )}

        <View style={styles.divider} />
        <Pressable
          onPress={onShareLink}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel={t("chat:group_add_share_instead")}
          accessibilityState={{ busy: sharing }}
          style={({ pressed }) => [styles.row, pressed || sharing ? styles.pressed : null]}
        >
          {sharing ? (
            <ActivityIndicator size="small" color={chatTokens.tagChat} />
          ) : (
            <Icon name="link-outline" size={22} color={chatTokens.tagChat} />
          )}
          <Text style={styles.name}>{t("chat:group_add_share_instead")}</Text>
        </Pressable>
        <Text style={styles.note}>{t("chat:group_add_history_note")}</Text>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  headerSide: {
    minWidth: 88,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  backText: {
    fontSize: 16,
    color: chatTokens.textSecondary,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  addPill: {
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addPillOff: {
    backgroundColor: chatTokens.strip,
  },
  addPillText: {
    fontSize: 15,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  addPillTextOff: {
    color: chatTokens.textMuted,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 4,
  },
  heading: {
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: chatTokens.textSoft,
  },
  loading: {
    paddingVertical: 16,
  },
  empty: {
    paddingVertical: 8,
    fontSize: 14,
    color: chatTokens.textSoft,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: chatTokens.textPrimary,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: chatTokens.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: {
    borderColor: chatTokens.accent,
    backgroundColor: chatTokens.accent,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.hairline,
    marginVertical: 10,
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    color: chatTokens.textSoft,
  },
  pressed: {
    opacity: 0.6,
  },
});
