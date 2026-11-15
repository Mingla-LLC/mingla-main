/**
 * Issue #4435 (design v4, flows 1 and 2): the multi-select friend picker the
 * New group sheet and Add people share. Search, a row of picked faces (tap one
 * to take it out), then every friend: a round check, or a quiet "In group" /
 * "Group full" badge. The cap comes from the caller (`slots`): the picker never
 * lets more than `slots` people be picked (pickRowState, groupChatModel).
 */
import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { ChatAvatar } from "../connections/ChatAvatar";
import { chatTokens } from "../../constants/chatTokens";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { pickRowState, type PickRowState } from "../../utils/groupChatModel";

export interface PickerFriend {
  id: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
}

interface GroupFriendPickerProps {
  friends: readonly PickerFriend[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  /** People already in the group (shown, not pickable). */
  inGroupIds?: ReadonlySet<string>;
  /** How many more people fit (create: 14; add: cap minus accepted). */
  slots: number;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  disabled?: boolean;
}

export function GroupFriendPicker({
  friends,
  selectedIds,
  onToggle,
  inGroupIds,
  slots,
  search,
  onSearchChange,
  loading,
  error,
  onRetry,
  disabled = false,
}: GroupFriendPickerProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const picked = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(friends.map((f) => [f.id, f])), [friends]);
  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      query
        ? friends.filter(
            (f) => f.name.toLowerCase().includes(query) || (f.username ?? "").toLowerCase().includes(query),
          )
        : friends,
    [friends, query],
  );

  const toggle = (id: string, state: PickRowState) => {
    if (disabled || state === "in_group" || state === "full") return;
    HapticFeedback.light();
    onToggle(id);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.search}>
        <Icon name="search" size={18} color={chatTokens.textMuted} />
        <BottomSheetTextInput
          value={search}
          onChangeText={onSearchChange}
          placeholder={t("chat:group_search_friends")}
          placeholderTextColor={chatTokens.textMuted}
          style={styles.searchInput}
          editable={!disabled}
          autoCorrect={false}
          accessibilityLabel={t("chat:group_search_friends")}
        />
      </View>

      {selectedIds.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityLabel={t("chat:group_picked_a11y", { count: selectedIds.length })}
        >
          {selectedIds.map((id) => {
            const friend = byId.get(id);
            if (!friend) return null;
            const first = friend.name.split(/\s+/)[0] ?? friend.name;
            return (
              <Pressable
                key={id}
                onPress={() => toggle(id, "picked")}
                accessibilityRole="button"
                accessibilityLabel={t("chat:group_unpick_a11y", { name: first })}
                style={styles.chip}
              >
                <View>
                  <ChatAvatar
                    people={[{ id, name: friend.name, avatarUrl: friend.avatarUrl ?? null }]}
                    shape="circle"
                    label={friend.name}
                    size={44}
                  />
                  <View style={styles.chipX}>
                    <Icon name="close" size={10} color={chatTokens.textPrimary} />
                  </View>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {first}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {loading ? (
        <ActivityIndicator color={chatTokens.accent} style={styles.state} />
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>{t("chat:group_friends_failed")}</Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t("common:retry")}
            style={styles.retry}
          >
            <Icon name="refresh-outline" size={16} color={chatTokens.textPrimary} />
            <Text style={styles.retryText}>{t("common:retry")}</Text>
          </Pressable>
        </View>
      ) : friends.length === 0 ? null : visible.length === 0 ? (
        <Text style={styles.empty}>{t("chat:group_no_match", { query: search.trim() })}</Text>
      ) : (
        <>
          <Text style={styles.heading} accessibilityRole="header">
            {t("chat:group_add_friends_heading")}
          </Text>
          {visible.map((friend) => {
            const state = pickRowState({
              picked: picked.has(friend.id),
              inGroup: inGroupIds?.has(friend.id) ?? false,
              pickedCount: selectedIds.length,
              slots,
            });
            const inactive = state === "in_group" || state === "full";
            return (
              <Pressable
                key={friend.id}
                onPress={() => toggle(friend.id, state)}
                disabled={disabled || inactive}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: state === "picked", disabled: disabled || inactive }}
                accessibilityLabel={
                  inactive
                    ? `${friend.name}, ${state === "in_group" ? t("chat:group_row_in_group") : t("chat:group_row_full")}`
                    : friend.name
                }
                style={({ pressed }) => [styles.row, inactive ? styles.rowOff : null, pressed ? styles.pressed : null]}
              >
                <ChatAvatar
                  people={[{ id: friend.id, name: friend.name, avatarUrl: friend.avatarUrl ?? null }]}
                  shape="circle"
                  label={friend.name}
                  size={40}
                />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {friend.name}
                  </Text>
                  {friend.username ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      @{friend.username}
                    </Text>
                  ) : null}
                </View>
                {inactive ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {state === "in_group" ? t("chat:group_row_in_group") : t("chat:group_row_full")}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.check, state === "picked" ? styles.checkOn : null]}>
                    {state === "picked" ? <Icon name="checkmark" size={14} color={chatTokens.textPrimary} /> : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 4,
  },
  search: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.inputBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    color: chatTokens.textPrimary,
    fontSize: 15,
    paddingVertical: 0,
  },
  chips: {
    gap: 8,
    paddingVertical: 4,
    paddingBottom: 10,
  },
  chip: {
    width: 56,
    alignItems: "center",
    gap: 4,
  },
  chipX: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  chipName: {
    maxWidth: 56,
    fontSize: 11,
    color: chatTokens.textSecondary,
  },
  heading: {
    paddingTop: 8,
    paddingBottom: 4,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: chatTokens.textSoft,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  rowOff: {
    opacity: 0.5,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  sub: {
    fontSize: 13,
    color: chatTokens.textSoft,
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
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.strip,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: chatTokens.textSecondary,
  },
  state: {
    paddingVertical: 24,
  },
  stateBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 24,
  },
  stateTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: chatTokens.textPrimary,
    textAlign: "center",
  },
  retry: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  empty: {
    paddingVertical: 16,
    fontSize: 14,
    color: chatTokens.textSoft,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.6,
  },
});
