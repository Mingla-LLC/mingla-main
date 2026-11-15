/**
 * Issue #4435 (R30, design v4 flow 1): New group, pick first. Step 1 picks
 * 0-14 friends (search, picked faces, "Group full" past 14); the button reads
 * "Next · 3 selected" or "Just me for now". Step 2 names the group (optional:
 * blank uses the first names, decision Q4) and creates it live through
 * create_group_chat (app/index.tsx handleCreateGroupChat). The pencil, the New
 * message sheet, its PLUS badge and the paywall gate are unchanged.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { ChatAvatar } from "./ChatAvatar";
import { GroupFriendPicker, type PickerFriend } from "../chat/GroupFriendPicker";
import { chatTokens } from "../../constants/chatTokens";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { getDisplayName } from "../../utils/getDisplayName";
import {
  createButtonMode,
  defaultGroupName,
  MAX_CREATE_PICKS,
  resolvedGroupName,
} from "../../utils/groupChatModel";

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

export interface CreatedGroup {
  conversationId: string;
  sessionId: string;
}

interface CreateGroupChatSheetProps {
  visible: boolean;
  onClose: () => void;
  availableFriends: CreateGroupChatFriend[];
  loadingFriends?: boolean;
  friendsError?: boolean;
  onRetryFriends?: () => void;
  /** My first name, for the "{name}'s group" default (Q4). */
  myFirstName: string;
  isCreating: boolean;
  onSubmit: (
    sessionName: string,
    selectedFriends: CreateGroupChatFriend[],
  ) => Promise<CreatedGroup | void>;
  onCreated: (created: CreatedGroup, groupName: string, selectedFriends: CreateGroupChatFriend[]) => void;
}

const SNAP_POINTS = ["90%"];
const NAME_MAX = 60;

function getFriendId(friend: CreateGroupChatFriend): string {
  return friend.friend_user_id || friend.id;
}

function getFriendName(friend: CreateGroupChatFriend): string {
  return friend.name || getDisplayName(friend as Parameters<typeof getDisplayName>[0]);
}

function firstNameOf(friend: CreateGroupChatFriend): string {
  return (friend.first_name || getFriendName(friend)).trim().split(/\s+/)[0] ?? "";
}

/** The default name as words: "Ada's group", "Tobi", "Tobi & Kemi", "Ada, Tobi & Kemi". */
export function defaultGroupNameText(t: TFunction, myFirstName: string, friendFirstNames: string[]): string {
  const name = defaultGroupName(myFirstName, friendFirstNames);
  if (name.kind === "solo") return t("chat:group_default_solo", { name: name.firstName });
  const [a, b, c] = name.firstNames;
  if (name.firstNames.length === 1) return a;
  if (name.firstNames.length === 2) return t("chat:group_default_two", { a, b });
  return t("chat:group_default_three", { a, b, c });
}

export function CreateGroupChatSheet({
  visible,
  onClose,
  availableFriends,
  loadingFriends = false,
  friendsError = false,
  onRetryFriends,
  myFirstName,
  isCreating,
  onSubmit,
  onCreated,
}: CreateGroupChatSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["chat", "social", "common"]);
  const [step, setStep] = useState<"pick" | "name">("pick");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible) return;
    setStep("pick");
    setName("");
    setSearch("");
    setSelectedIds([]);
    setFailed(false);
  }, [visible]);

  const friendsById = useMemo(
    () => new Map(availableFriends.map((friend) => [getFriendId(friend), friend])),
    [availableFriends],
  );
  const pickerFriends: PickerFriend[] = useMemo(
    () =>
      availableFriends.map((friend) => ({
        id: getFriendId(friend),
        name: getFriendName(friend),
        username: friend.username ?? null,
        avatarUrl: friend.avatar || friend.avatar_url || null,
      })),
    [availableFriends],
  );
  const selectedFriends = useMemo(
    () => selectedIds.map((id) => friendsById.get(id)).filter((f): f is CreateGroupChatFriend => Boolean(f)),
    [friendsById, selectedIds],
  );
  const fallbackName = defaultGroupNameText(t, myFirstName, selectedFriends.map(firstNameOf));
  const mode = createButtonMode(selectedIds.length);

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_CREATE_PICKS ? prev : [...prev, id],
    );
  };

  const handleCreate = async () => {
    if (isCreating) return;
    setFailed(false);
    HapticFeedback.medium();
    const groupName = resolvedGroupName(name, fallbackName);
    try {
      const result = await onSubmit(groupName, selectedFriends);
      if (result && result.conversationId && result.sessionId) {
        onCreated(result, groupName, selectedFriends);
      }
    } catch (error) {
      // The caller already toasted the server's reason; the sheet keeps the
      // picks and says nothing was created.
      console.warn("[CreateGroupChatSheet] create failed:", error);
      setFailed(true);
    }
  };

  const noFriends = !loadingFriends && !friendsError && availableFriends.length === 0;

  const header = (
    <View style={styles.header}>
      {step === "pick" ? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common:cancel")}
          hitSlop={8}
          style={styles.side}
          disabled={isCreating}
        >
          <Text style={styles.sideText}>{t("common:cancel")}</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setStep("pick")}
          accessibilityRole="button"
          accessibilityLabel={t("chat:group_back_to_friends")}
          hitSlop={8}
          style={styles.side}
          disabled={isCreating}
        >
          <Icon name="chevron-back" size={24} color={chatTokens.textPrimary} />
        </Pressable>
      )}
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {t("social:createGroupChatSheetTitle")}
      </Text>
      <View style={styles.side} />
    </View>
  );

  const footer =
    step === "pick" ? (
      noFriends || loadingFriends || friendsError ? null : (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <Pressable
            onPress={() => setStep("name")}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
          >
            <Text style={styles.primaryText}>
              {mode === "next" ? t("chat:group_create_next", { count: selectedIds.length }) : t("chat:group_create_just_me")}
            </Text>
          </Pressable>
          {mode === "just_me" ? <Text style={styles.helper}>{t("chat:group_create_just_me_helper")}</Text> : null}
        </View>
      )
    ) : (
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Pressable
          onPress={() => void handleCreate()}
          disabled={isCreating}
          accessibilityRole="button"
          accessibilityState={{ disabled: isCreating, busy: isCreating }}
          style={({ pressed }) => [styles.primary, isCreating ? styles.primaryBusy : null, pressed ? styles.pressed : null]}
        >
          {isCreating ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={chatTokens.textPrimary} />
              <Text style={styles.primaryText}>{t("chat:group_creating")}</Text>
            </View>
          ) : (
            <Text style={styles.primaryText}>{t("chat:group_create_cta")}</Text>
          )}
        </Pressable>
        <Text style={styles.helper}>
          {selectedIds.length > 0 ? t("chat:group_create_helper_people") : t("chat:group_create_helper_solo")}
        </Text>
      </View>
    );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      theme="dark"
      scrollMode="scroll"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("social:createGroupChatSheetTitle")}
      header={header}
      stickyFooter={footer ?? undefined}
      scrollProps={{
        keyboardShouldPersistTaps: "handled",
        keyboardDismissMode: "on-drag",
        showsVerticalScrollIndicator: false,
        contentContainerStyle: styles.body,
      }}
    >
      {step === "pick" ? (
        noFriends ? (
          <View style={styles.emptyState} testID="create-group-no-friends">
            <View style={styles.emptyIcon}>
              <Icon name="people-outline" size={26} color={chatTokens.tagDeck} />
            </View>
            <Text style={styles.emptyTitle}>{t("chat:group_create_no_friends_title")}</Text>
            <Text style={styles.emptySub}>{t("chat:group_create_no_friends_sub")}</Text>
            <Pressable
              onPress={() => setStep("name")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.smallPrimary, pressed ? styles.pressed : null]}
            >
              <Text style={styles.primaryText}>{t("chat:group_create_with_just_me")}</Text>
            </Pressable>
          </View>
        ) : (
          <GroupFriendPicker
            friends={pickerFriends}
            selectedIds={selectedIds}
            onToggle={toggle}
            slots={MAX_CREATE_PICKS}
            search={search}
            onSearchChange={setSearch}
            loading={loadingFriends}
            error={friendsError}
            onRetry={() => onRetryFriends?.()}
            disabled={isCreating}
          />
        )
      ) : (
        <View style={styles.nameStep} testID="create-group-name-step">
          <Text style={styles.label} nativeID="create-group-name-label">
            {t("chat:group_name_label")}
          </Text>
          <BottomSheetTextInput
            value={name}
            onChangeText={setName}
            placeholder={fallbackName}
            placeholderTextColor={chatTokens.textMuted}
            maxLength={NAME_MAX}
            style={styles.nameInput}
            editable={!isCreating}
            returnKeyType="done"
            accessibilityLabel={t("chat:group_name_label")}
            accessibilityLabelledBy="create-group-name-label"
          />
          <Text style={styles.helperLeft}>{t("chat:group_name_optional", { name: fallbackName })}</Text>

          <Text style={styles.label}>
            {selectedIds.length > 0
              ? t("chat:group_in_group_count", { count: selectedIds.length + 1 })
              : t("chat:group_just_you")}
          </Text>
          <View style={styles.membersRow}>
            <View style={styles.faces}>
              {selectedFriends.slice(0, 6).map((friend, index) => (
                <View key={getFriendId(friend)} style={index > 0 ? styles.faceOverlap : null}>
                  <ChatAvatar
                    people={[{ id: getFriendId(friend), name: getFriendName(friend), avatarUrl: friend.avatar || friend.avatar_url || null }]}
                    shape="circle"
                    label={getFriendName(friend)}
                    size={28}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.membersText} numberOfLines={2}>
              {selectedIds.length > 0
                ? t("chat:group_you_and", { names: selectedFriends.map(firstNameOf).join(", ") })
                : t("chat:group_share_after")}
            </Text>
            <Pressable
              onPress={() => setStep("pick")}
              disabled={isCreating}
              accessibilityRole="button"
              accessibilityLabel={t("chat:group_edit_people")}
              style={({ pressed }) => [styles.editButton, pressed ? styles.pressed : null]}
            >
              <Text style={styles.editText}>{t("chat:group_edit_short")}</Text>
            </Pressable>
          </View>

          {failed ? (
            <View style={styles.errorBanner} accessibilityLiveRegion="polite">
              <View style={styles.errorRow}>
                <Icon name="alert-circle" size={16} color={chatTokens.danger} />
                <Text style={styles.errorTitle}>{t("chat:group_create_failed_title")}</Text>
              </View>
              <Text style={styles.errorSub}>{t("chat:group_create_failed_sub")}</Text>
            </View>
          ) : null}
        </View>
      )}
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  side: {
    width: 72,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  sideText: {
    fontSize: 16,
    fontWeight: "500",
    color: chatTokens.tagDeck,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.hairline,
    backgroundColor: chatTokens.surface,
  },
  primary: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryBusy: {
    opacity: 0.7,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  smallPrimary: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  helper: {
    fontSize: 12,
    color: chatTokens.textSoft,
    textAlign: "center",
  },
  helperLeft: {
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  emptyState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 40,
    paddingHorizontal: 16,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: chatTokens.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 14,
    color: chatTokens.textSecondary,
    textAlign: "center",
  },
  nameStep: {
    gap: 8,
    paddingTop: 8,
  },
  label: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: chatTokens.textSoft,
    textTransform: "uppercase",
  },
  nameInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.inputBg,
    paddingHorizontal: 12,
    color: chatTokens.textPrimary,
    fontSize: 16,
  },
  membersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  faces: {
    flexDirection: "row",
  },
  faceOverlap: {
    marginLeft: -8,
  },
  membersText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  editButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  editText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  errorBanner: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    padding: 12,
    gap: 4,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.danger,
  },
  errorSub: {
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  pressed: {
    opacity: 0.7,
  },
});
