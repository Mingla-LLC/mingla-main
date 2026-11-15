/**
 * Issue #4435 (design v4 flow 2): one Add people sheet for every group. The
 * group link card sits on top (Share, Copy, QR; admins also get Approve new
 * joiners and Reset), then "Invite by phone number" (session groups), then my
 * friends with search: people already in show "In group", and once the picks
 * would reach the cap the rest show "Group full" with a line saying why.
 * Add calls add_group_members once (all or nothing on the server). Session
 * groups: the cap is max_participants (15) minus the server's accepted count,
 * and every friend actually added gets one push (decision Q3). Plain groups
 * keep the per-call limit of 20 (add_group_members' input bound).
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";
import { GroupLinkCard } from "./GroupLinkCard";
import { GroupFriendPicker, type PickerFriend } from "./GroupFriendPicker";
import { GroupPhoneInvite } from "./GroupPhoneInvite";
import { chatTokens } from "../../constants/chatTokens";
import { useFriendsList } from "../../hooks/useFriendsQuery";
import { useAddGroupMembers } from "../../hooks/useGroupLink";
import { useAppStore } from "../../store/appStore";
import { getDisplayName } from "../../utils/getDisplayName";
import { GROUP_CAP, remainingSlots } from "../../utils/groupChatModel";
import { notifyAddedToGroup } from "../../services/boardNotificationService";

const ADD_PEOPLE_SNAP = ["88%"];
/** add_group_members takes 1..20 ids per call (plain groups have no cap). */
const MAX_ADD = 20;

interface AddGroupPeopleSheetProps {
  visible: boolean;
  conversationId: string;
  groupName: string;
  /** Everyone already in the chat (shown as "In group"). */
  memberIds: readonly string[];
  /** A session group (collab): the 15 cap and the phone invite apply. */
  sessionId?: string | null;
  /** Session groups: accepted members right now (server count). */
  acceptedCount?: number;
  /** Back to group info (also the swipe-down). */
  onBack: () => void;
  /** After a successful add (group info refreshes its members). */
  onAdded?: (addedIds: string[]) => void;
}

export function AddGroupPeopleSheet({
  visible,
  conversationId,
  groupName,
  memberIds,
  sessionId = null,
  acceptedCount,
  onBack,
  onAdded,
}: AddGroupPeopleSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const insets = useSafeAreaInsets();
  const userId = useAppStore((s) => s.user?.id);
  const profile = useAppStore((s) => s.profile);
  const friendsQuery = useFriendsList(userId);
  const addMembers = useAddGroupMembers(conversationId);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const isSession = Boolean(sessionId);
  const inGroup = useMemo(() => new Set(memberIds), [memberIds]);
  const accepted = acceptedCount ?? memberIds.length;
  const slots = isSession ? remainingSlots(accepted) : MAX_ADD;
  const full = isSession && slots === 0;
  const atCap = !full && picked.length >= slots;

  useEffect(() => {
    if (visible) return;
    setPicked([]);
    setSearch("");
  }, [visible]);

  const friends: PickerFriend[] = useMemo(
    () =>
      (friendsQuery.data ?? [])
        .filter((f) => f.status === "accepted")
        .map((f) => ({
          id: f.friend_user_id,
          name: getDisplayName(f, f.username || "?"),
          username: f.username ?? null,
          avatarUrl: f.avatar_url ?? null,
        })),
    [friendsQuery.data],
  );
  const allIn = friends.length > 0 && friends.every((f) => inGroup.has(f.id));

  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= slots ? prev : [...prev, id]));
  };

  const count = picked.length;
  const confirm = () => {
    if (count === 0 || addMembers.isPending) return;
    addMembers.mutate(picked, {
      onSuccess: (result) => {
        const names = friends.filter((f) => result.added.includes(f.id)).map((f) => f.name.split(/\s+/)[0]);
        if (result.added.length > 0) {
          toastManager.success(t("chat:group_added_toast", { names: names.join(", ") }));
        }
        if (sessionId && userId) {
          notifyAddedToGroup({
            sessionId,
            sessionName: groupName,
            actorId: userId,
            actorFirstName: profile?.first_name || profile?.display_name || "",
            addedUserIds: result.added,
          });
        }
        setPicked([]);
        onAdded?.(result.added);
        onBack();
      },
    });
  };

  const footer = full ? null : (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <Pressable
        onPress={confirm}
        disabled={count === 0 || addMembers.isPending}
        accessibilityRole="button"
        accessibilityState={{ disabled: count === 0, busy: addMembers.isPending }}
        style={({ pressed }) => [styles.primary, count === 0 ? styles.primaryOff : null, pressed ? styles.pressed : null]}
      >
        {addMembers.isPending ? (
          <ActivityIndicator size="small" color={chatTokens.textPrimary} />
        ) : (
          <Text style={styles.primaryText}>
            {count > 0 ? t("chat:group_add_people_cta", { count }) : t("chat:group_add_pick_first")}
          </Text>
        )}
      </Pressable>
      {isSession ? (
        <Text style={styles.helper}>{t("chat:group_add_helper", { count: accepted + count, cap: GROUP_CAP })}</Text>
      ) : null}
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onBack}
      snapPoints={ADD_PEOPLE_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("chat:group_add_people_title")}
      stickyFooter={footer ?? undefined}
      scrollProps={{ keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag" }}
      header={
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t("common:back")}
            style={styles.headerSide}
          >
            <Icon name="chevron-back" size={24} color={chatTokens.textPrimary} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {t("chat:group_add_people_title")}
          </Text>
          <View style={styles.headerSide} />
        </View>
      }
    >
      <View style={styles.body} testID="add-group-people-sheet">
        <GroupLinkCard conversationId={conversationId} groupName={groupName} withSettings />

        {full ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>{t("chat:group_full_title")}</Text>
            <Text style={styles.bannerSub}>{t("chat:group_full_sub", { cap: GROUP_CAP })}</Text>
          </View>
        ) : (
          <>
            {isSession && sessionId && userId ? (
              <GroupPhoneInvite sessionId={sessionId} sessionName={groupName} currentUserId={userId} />
            ) : null}
            {allIn && search.trim().length === 0 ? (
              <Text style={styles.note}>{t("chat:group_add_all_in_link")}</Text>
            ) : null}
            {isSession && atCap ? (
              <View style={styles.banner} accessibilityLiveRegion="polite">
                <View style={styles.bannerRow}>
                  <Icon name="alert-circle" size={16} color={chatTokens.warning} />
                  <Text style={styles.bannerTitle}>{t("chat:group_cap_title", { cap: GROUP_CAP })}</Text>
                </View>
                <Text style={styles.bannerSub}>
                  {t("chat:group_cap_sub", { accepted, picked: count, cap: GROUP_CAP })}
                </Text>
              </View>
            ) : null}
            <GroupFriendPicker
              friends={friends}
              selectedIds={picked}
              onToggle={toggle}
              inGroupIds={inGroup}
              slots={slots}
              search={search}
              onSearchChange={setSearch}
              loading={friendsQuery.isLoading}
              error={friendsQuery.isError}
              onRetry={() => void friendsQuery.refetch()}
              disabled={addMembers.isPending}
            />
          </>
        )}
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
  },
  headerSide: {
    width: 56,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
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
    gap: 12,
  },
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    padding: 12,
    gap: 4,
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  bannerSub: {
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    color: chatTokens.textSoft,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
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
  },
  primaryOff: {
    opacity: 0.45,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  helper: {
    fontSize: 12,
    color: chatTokens.textSoft,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
