/**
 * Group info for every group chat (#4114 Wave 3; #4435 design v4 flow 3).
 *
 * Plain groups (no collab session): Add people and Share group link (#4261),
 * the GROUP LINK card, the members (tap to open a profile), Photos/videos/cards,
 * Mute (conversation_participants.notifications_muted), Clear chat and Leave
 * (leave_group_conversation, after a confirm).
 *
 * Session groups (#4435, replaces the chat's BoardSettingsDropdown): the same
 * rows plus roles. "Wants to join" requests sit at the top (any member
 * answers). Members show Creator / Admin badges; an admin opens a member's row
 * (⋯ or long-press) for Make admin / Remove admin / Remove from group (never
 * on the creator; groupChatModel.memberActions). Remove asks first, then a
 * 6-second Undo: the remove_group_member call is held and sent when the window
 * ends, or at once when the sheet closes or the app goes to the background;
 * Undo cancels it, so nothing was ever written. Make admin is immediate and
 * its Undo calls set_group_admin back. Leave uses the approved copy variants
 * (last person deletes, second-to-last keeps it open, last admin hands over);
 * the creator can Delete group (groupChatService.deleteGroup). Admins rename.
 * Add people steps this sheet aside (one RN Modal at a time on iOS).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { chatTokens } from "../../constants/chatTokens";
import { messagingService } from "../../services/messagingService";
import { setSessionMute } from "../../services/sessionMuteService";
import { supabase } from "../../services/supabase";
import { deleteGroup, removeGroupMember, setGroupAdmin } from "../../services/groupChatService";
import { notifySessionDeleted } from "../../services/boardNotificationService";
import { useGroupJoinRequests, useShareGroupLink } from "../../hooks/useGroupLink";
import { chatKeys } from "../../hooks/queryKeys";
import {
  createDeferredAction,
  GROUP_CAP,
  groupErrorKey,
  leaveCopyVariant,
  leaveHeir,
  memberActions,
  pruneHiddenMembers,
  REMOVE_UNDO_MS,
  sortGroupMembers,
  type GroupMemberRow,
  type MemberAction,
} from "../../utils/groupChatModel";
import { GroupLinkSection } from "./GroupLinkSection";
import { AddGroupPeopleSheet } from "./AddGroupPeopleSheet";
import { GroupJoinRequestCard } from "./GroupJoinRequestCard";

const GROUP_INFO_SNAP = ["70%"];
const SESSION_INFO_SNAP = ["88%"];

interface GroupInfoMember {
  id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
}

/** One accepted member of a session group, with the role the server holds. */
export interface SessionGroupMember extends GroupMemberRow {
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
}

export interface SessionGroupInfo {
  sessionId: string;
  creatorId: string | null;
  members: readonly SessionGroupMember[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Reload the members after an add, remove or role change. */
  onChanged: () => void;
  onRenamed?: (name: string) => void;
  onDeleted: () => void;
}

interface GroupInfoSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string | null;
  currentUserId: string | null;
  name: string;
  members: readonly GroupInfoMember[];
  initiallyMuted: boolean;
  onOpenProfile?: (userId: string) => void;
  onOpenMedia: () => void;
  onLeft: () => void;
  onError: (message: string) => void;
  /** #4187: official program threads may be muted/archived but never left. */
  managed?: boolean;
  /** Issue #4435: Clear chat for me only (the thread confirms and runs it). */
  onClearChat?: () => void;
  /** Issue #4435: a collab session group (roles, Undo, leave variants). */
  session?: SessionGroupInfo | null;
  /** Open straight on Add people (the deck's "Add people" button). */
  startWithAddPeople?: boolean;
  /**
   * #4459: the brand's one Guest chat. No add / link tiles; the member list is
   * privacy-aware (the team, guests who chose "show me as going", a count);
   * Leave is sticky (rejoin from a booking).
   */
  brandGuests?: { brandName: string; onOpenBrand?: () => void; onMessageBrand?: () => void } | null;
}

type UndoState =
  | { kind: "remove"; userId: string; name: string }
  | { kind: "admin"; userId: string; name: string; madeAdmin: boolean };

function memberLabel(member: GroupInfoMember): string {
  return (member.name || member.username || "?").trim();
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function GroupInfoSheet({
  visible,
  onClose,
  conversationId,
  currentUserId,
  name,
  members,
  initiallyMuted,
  onOpenProfile,
  onOpenMedia,
  onLeft,
  onError,
  managed = false,
  onClearChat,
  session = null,
  startWithAddPeople = false,
  brandGuests = null,
}: GroupInfoSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(initiallyMuted);
  const [muteBusy, setMuteBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // #4261: Add people steps this sheet aside (one RN Modal at a time on iOS).
  const [addingPeople, setAddingPeople] = useState(false);
  // #4435 QA F-2: opened straight on Add people (the deck's button), this
  // sheet never presents first. Add people is derived in render, so the two
  // RN Modals never swap within one open; Back from Add people shows group
  // info (backFromAdd) until the sheet closes.
  const [backFromAdd, setBackFromAdd] = useState(false);
  const isBrandGuests = Boolean(brandGuests);
  const showAdd = !managed && !isBrandGuests && (addingPeople || (startWithAddPeople && !backFromAdd));
  const { share: shareGroupLink, busy: sharingLink } = useShareGroupLink(managed || isBrandGuests ? null : conversationId, name);
  // #4459: the Guest chat's member sheet comes from the server (roster privacy).
  const brandGuestMembers = useQuery({
    queryKey: chatKeys.brandGuestMembers(conversationId),
    queryFn: () => messagingService.listBrandGuestMembers(conversationId as string),
    enabled: isBrandGuests && visible && Boolean(conversationId),
    staleTime: 60_000,
  });
  const isSession = Boolean(session) && !managed;
  const joinRequests = useGroupJoinRequests(isSession ? conversationId : null);
  const pendingRequests = useMemo(
    () => (joinRequests.data ?? []).filter((request) => request.status === "pending"),
    [joinRequests.data],
  );

  // #4435: the held removes (Undo) and what the Undo bar shows.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(name);
  const [savingName, setSavingName] = useState(false);
  const deferredRef = useRef(
    createDeferredAction(REMOVE_UNDO_MS, {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }),
  );
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setAddingPeople(false);
      setBackFromAdd(false);
      setOpenMemberId(null);
      setRenaming(false);
    }
  }, [visible]);

  useEffect(() => {
    setMuted(initiallyMuted);
  }, [initiallyMuted]);

  // A held remove is sent at once when the sheet closes, the app goes to the
  // background, or this unmounts (the Undo window can only run while visible).
  useEffect(() => {
    if (!visible) deferredRef.current.flush();
  }, [visible]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") deferredRef.current.flush();
    });
    const deferred = deferredRef.current;
    return () => {
      sub.remove();
      deferred.flush();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // #4435 QA: opening Group info after a failed member load (a slow or
  // dropped first load) loads again at once instead of waiting for Retry.
  const sessionNeedsLoad = Boolean(session && session.error && !session.loading && session.members.length === 0);
  const retryMembers = session?.onRetry;
  useEffect(() => {
    if (visible && sessionNeedsLoad) retryMembers?.();
    // Only on open: a failing reload must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // #4435 QA F-3: a removed member stays hidden only until the server's list
  // drops them; after that the hide is cleared, so a re-added member shows.
  useEffect(() => {
    const list = session?.members;
    if (!list || list.length === 0 || session?.loading) return;
    const ids = list.map((m) => m.userId);
    setHidden((prev) => pruneHiddenMembers(prev, ids, deferredRef.current.pending()));
  }, [session?.members, session?.loading]);

  const sessionMembers = useMemo(
    () => sortGroupMembers((session?.members ?? []).filter((m) => !hidden.has(m.userId)), currentUserId),
    [currentUserId, hidden, session?.members],
  );
  const me = sessionMembers.find((m) => m.userId === currentUserId) ?? null;
  const viewerRole = me ?? { userId: currentUserId ?? "", isCreator: false, isAdmin: false };
  const viewerIsAdmin = Boolean(me && (me.isAdmin || me.isCreator));
  const acceptedCount = session ? session.members.filter((m) => !hidden.has(m.userId)).length : members.length;

  const showUndo = useCallback((next: UndoState) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo(next);
    undoTimerRef.current = setTimeout(() => setUndo(null), REMOVE_UNDO_MS);
  }, []);

  const afterMembershipChange = useCallback(() => {
    session?.onChanged();
    void queryClient.invalidateQueries({ queryKey: chatKeys.participants(conversationId) });
  }, [conversationId, queryClient, session]);

  const toggleMute = async (next: boolean) => {
    if (!conversationId || !currentUserId || muteBusy) return;
    setMuteBusy(true);
    setMuted(next);
    const { error } = await messagingService.setConversationMuted(conversationId, currentUserId, next);
    // A session group's board pushes read the session row (ORCH-0520); keep both in step.
    const sessionResult = !error && session ? await setSessionMute(session.sessionId, next) : { success: true };
    setMuteBusy(false);
    if (error || !sessionResult.success) {
      setMuted(!next);
      onError(t("chat:muteFailed"));
    }
  };

  // ── #4435 member actions ─────────────────────────────────────────────────
  const runRemove = useCallback(
    async (member: SessionGroupMember) => {
      if (!conversationId) return;
      try {
        await removeGroupMember(conversationId, member.userId);
        afterMembershipChange();
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        console.warn("[GroupInfoSheet] remove failed:", code);
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(member.userId);
          return next;
        });
        toastManager.error(
          code === "creator_protected" || code === "not_allowed"
            ? t(groupErrorKey(code))
            : t("chat:group_remove_failed", { name: firstName(member.name) }),
        );
      }
    },
    [afterMembershipChange, conversationId, t],
  );

  const confirmRemove = (member: SessionGroupMember) => {
    setOpenMemberId(null);
    const first = firstName(member.name);
    Alert.alert(
      t("chat:group_remove_title", { name: first, group: name }),
      t("chat:group_remove_body", { name: first }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("chat:group_remove_cta"),
          style: "destructive",
          onPress: () => {
            setHidden((prev) => new Set(prev).add(member.userId));
            deferredRef.current.schedule(member.userId, () => {
              setUndo((current) => (current?.kind === "remove" && current.userId === member.userId ? null : current));
              void runRemove(member);
            });
            showUndo({ kind: "remove", userId: member.userId, name: first });
          },
        },
      ],
    );
  };

  const setAdmin = async (member: SessionGroupMember, makeAdmin: boolean, fromUndo = false) => {
    if (!conversationId || busyMemberId) return;
    setOpenMemberId(null);
    setBusyMemberId(member.userId);
    try {
      await setGroupAdmin(conversationId, member.userId, makeAdmin);
      afterMembershipChange();
      if (!fromUndo) showUndo({ kind: "admin", userId: member.userId, name: firstName(member.name), madeAdmin: makeAdmin });
      else setUndo(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      console.warn("[GroupInfoSheet] set admin failed:", code);
      toastManager.error(t(groupErrorKey(code)));
    } finally {
      setBusyMemberId(null);
    }
  };

  const onUndo = () => {
    if (!undo) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undo.kind === "remove") {
      deferredRef.current.cancel(undo.userId);
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(undo.userId);
        return next;
      });
      setUndo(null);
      return;
    }
    const member = session?.members.find((m) => m.userId === undo.userId);
    if (member) void setAdmin(member, !undo.madeAdmin, true);
    else setUndo(null);
  };

  const onMemberAction = (member: SessionGroupMember, action: MemberAction) => {
    switch (action) {
      case "make_admin":
        void setAdmin(member, true);
        return;
      case "remove_admin":
        void setAdmin(member, false);
        return;
      case "remove":
        confirmRemove(member);
        return;
      case "view_profile":
        setOpenMemberId(null);
        onClose();
        onOpenProfile?.(member.userId);
        return;
      default: {
        const never: never = action;
        return never;
      }
    }
  };

  const saveName = async () => {
    const trimmed = renameDraft.trim();
    if (!session || savingName) return;
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      setRenameDraft(name);
      return;
    }
    setSavingName(true);
    const { error } = await supabase.from("collaboration_sessions").update({ name: trimmed }).eq("id", session.sessionId);
    setSavingName(false);
    if (error) {
      console.warn("[GroupInfoSheet] rename failed:", error.message);
      toastManager.error(t("chat:group_rename_failed"));
      return;
    }
    setRenaming(false);
    session.onRenamed?.(trimmed);
  };

  // ── Leave and delete ────────────────────────────────────────────────────
  const leaveNow = async () => {
    if (!conversationId || !currentUserId) return;
    deferredRef.current.flush();
    setLeaving(true);
    const { error } = isBrandGuests
      ? await messagingService.leaveBrandGuestChat(conversationId)
      : await messagingService.leaveGroupConversation(conversationId, currentUserId);
    setLeaving(false);
    if (error) {
      onError(t("chat:leaveGroupFailed"));
      return;
    }
    onClose();
    onLeft();
  };

  const confirmLeave = () => {
    if (!conversationId || !currentUserId || leaving) return;
    if (brandGuests) {
      // #4459: leaving is sticky; you can rejoin from your booking.
      Alert.alert(
        t("connections:brand_guests_leave_title", { brand: brandGuests.brandName }),
        t("connections:brand_guests_leave_body", { brand: brandGuests.brandName }),
        [
          { text: t("common:cancel"), style: "cancel" },
          { text: t("chat:leaveGroup"), style: "destructive", onPress: () => void leaveNow() },
        ],
      );
      return;
    }
    if (!isSession) {
      Alert.alert(t("chat:leaveGroupTitle"), t("chat:leaveGroupBody", { name }), [
        { text: t("common:cancel"), style: "cancel" },
        { text: t("chat:leaveGroup"), style: "destructive", onPress: () => void leaveNow() },
      ]);
      return;
    }
    const variant = leaveCopyVariant(acceptedCount);
    const others = sessionMembers.filter((m) => m.userId !== currentUserId);
    const heir = leaveHeir(sessionMembers, currentUserId);
    const heirLine = heir ? ` ${t("chat:group_leave_heir", { name: firstName(heir.name) })}` : "";
    const title = variant === "last" ? t("chat:group_leave_last_title", { name }) : t("chat:leaveGroupTitle");
    const body =
      variant === "last"
        ? t("chat:group_leave_last_body")
        : variant === "second_to_last"
          ? t("chat:group_leave_second_body", { name: firstName(others[0]?.name ?? "") }) + heirLine
          : t("chat:group_leave_standard_body") + heirLine;
    Alert.alert(title, body, [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: variant === "last" ? t("chat:group_leave_last_cta") : t("chat:leaveGroup"),
        style: "destructive",
        onPress: () => void leaveNow(),
      },
    ]);
  };

  const confirmDelete = () => {
    if (!session || !currentUserId) return;
    Alert.alert(t("chat:group_delete_title", { name }), t("chat:group_delete_body"), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("common:delete"),
        style: "destructive",
        onPress: async () => {
          deferredRef.current.cancel(undo?.userId ?? "");
          setLeaving(true);
          notifySessionDeleted({
            sessionId: session.sessionId,
            sessionName: name,
            userId: currentUserId,
            userName: me?.name ?? "",
          });
          try {
            await deleteGroup(session.sessionId, currentUserId);
            onClose();
            session.onDeleted();
          } catch (error) {
            console.warn("[GroupInfoSheet] delete failed:", error);
            toastManager.error(t("chat:group_delete_failed"));
          } finally {
            setLeaving(false);
          }
        },
      },
    ]);
  };

  const canRename = isSession && viewerIsAdmin;
  const isCreatorMe = Boolean(session && currentUserId && session.creatorId === currentUserId);

  const header = (
    <View style={styles.header}>
      {renaming ? (
        <View style={styles.renameRow}>
          <TextInput
            value={renameDraft}
            onChangeText={setRenameDraft}
            maxLength={60}
            autoFocus
            style={styles.renameInput}
            accessibilityLabel={t("chat:group_name_label")}
            returnKeyType="done"
            onSubmitEditing={() => void saveName()}
          />
          <Pressable
            onPress={() => void saveName()}
            disabled={savingName}
            accessibilityRole="button"
            accessibilityLabel={t("chat:group_rename_save")}
            style={styles.smallButton}
          >
            {savingName ? (
              <ActivityIndicator size="small" color={chatTokens.textPrimary} />
            ) : (
              <Text style={styles.smallButtonText}>{t("chat:group_rename_save")}</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          {canRename ? (
            <Pressable
              onPress={() => {
                setRenameDraft(name);
                setRenaming(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("chat:group_rename_a11y")}
              hitSlop={10}
              style={styles.renameIcon}
            >
              <Icon name="create-outline" size={16} color={chatTokens.textSoft} />
            </Pressable>
          ) : null}
        </View>
      )}
      <Text style={styles.subtitle}>
        {managed
          ? t("chat:programTeamSubtitle")
          : isSession
            ? t("chat:group_info_count", { count: acceptedCount, cap: GROUP_CAP })
            : t("chat:peopleInChat", { count: members.length })}
      </Text>
    </View>
  );

  const renderSessionMembers = () => {
    if (!session) return null;
    if (session.loading && session.members.length === 0) {
      return <ActivityIndicator color={chatTokens.accent} style={styles.loading} />;
    }
    if (session.error && session.members.length === 0) {
      return (
        <View style={styles.stateBox}>
          <Text style={styles.rowText}>{t("chat:group_info_failed")}</Text>
          <Pressable onPress={session.onRetry} accessibilityRole="button" accessibilityLabel={t("common:retry")} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>{t("common:retry")}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <>
        {acceptedCount <= 1 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>{t("chat:group_info_alone_title")}</Text>
            <Text style={styles.bannerSub}>{t("chat:group_info_alone_sub")}</Text>
          </View>
        ) : null}
        {sessionMembers.map((member) => {
          const isMe = member.userId === currentUserId;
          const actions = isMe ? [] : memberActions(viewerRole, member);
          const canManage = actions.some((action) => action !== "view_profile");
          const open = openMemberId === member.userId;
          const label = isMe ? t("chat:you") : member.name;
          return (
            <View key={member.userId}>
              <Pressable
                style={styles.member}
                onPress={() => (isMe ? undefined : setOpenMemberId(open ? null : member.userId))}
                onLongPress={() => (isMe ? undefined : setOpenMemberId(member.userId))}
                disabled={isMe}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={
                  isMe ? t("chat:you") : canManage ? t("chat:group_manage_a11y", { name: member.name }) : t("chat:group_options_a11y", { name: member.name })
                }
              >
                {member.avatarUrl ? (
                  <ImageWithFallback source={{ uri: member.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarText}>{member.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.memberText}>
                  <View style={styles.nameRow}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {label}
                    </Text>
                    {member.isCreator ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{t("chat:group_role_creator")}</Text>
                      </View>
                    ) : member.isAdmin ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{t("chat:group_role_admin")}</Text>
                      </View>
                    ) : null}
                  </View>
                  {member.username && !isMe ? <Text style={styles.memberSub}>@{member.username}</Text> : null}
                </View>
                {busyMemberId === member.userId ? (
                  <ActivityIndicator size="small" color={chatTokens.textSoft} />
                ) : !isMe ? (
                  <Icon name="ellipsis-horizontal" size={20} color={chatTokens.textSoft} />
                ) : null}
              </Pressable>
              {open ? (
                <View style={styles.actions} testID="group-member-actions">
                  {actions.map((action) => (
                    <Pressable
                      key={action}
                      onPress={() => onMemberAction(member, action)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
                    >
                      <Text style={[styles.actionText, action === "remove" ? styles.danger : null]}>
                        {t(`chat:group_action_${action}`)}
                      </Text>
                    </Pressable>
                  ))}
                  {member.isCreator && viewerIsAdmin ? (
                    <Text style={styles.memberSub}>{t("chat:group_creator_note")}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={styles.note}>
          <Icon name="shield-checkmark-outline" size={14} color={chatTokens.textSoft} />
          <Text style={styles.noteText}>
            {viewerIsAdmin ? t("chat:group_manage_note_admin") : t("chat:group_manage_note_member")}
          </Text>
        </View>
      </>
    );
  };

  return (
    <>
    <BaseBottomSheet
      visible={visible && !showAdd}
      onClose={onClose}
      snapPoints={isSession ? SESSION_INFO_SNAP : GROUP_INFO_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("chat:groupInfo")}
      header={header}
      // #4435 QA: the Undo bar (Remove and Make admin) is pinned to the bottom
      // of the sheet's window, so it shows wherever the list is scrolled (it
      // used to sit at the top of the scrolling body, out of view when the
      // member row was further down).
      overlay={undo ? (
        <View pointerEvents="box-none" style={[styles.undoDock, { bottom: Math.max(insets.bottom, 12) + 12 }]}>
          <View style={styles.undoBar} accessibilityLiveRegion="polite" testID="group-undo-bar">
            <Text style={styles.undoText}>
              {undo.kind === "remove"
                ? t("chat:group_removed_toast", { name: undo.name })
                : undo.madeAdmin
                  ? t("chat:group_made_admin_toast", { name: undo.name })
                  : t("chat:group_removed_admin_toast", { name: undo.name })}
            </Text>
            <Pressable onPress={onUndo} accessibilityRole="button" accessibilityLabel={t("common:undo")} style={styles.undoButton}>
              <Text style={styles.undoButtonText}>{t("common:undo")}</Text>
            </Pressable>
          </View>
        </View>
      ) : undefined}
    >
      <View style={styles.body} testID="group-info-sheet">

        {!managed && !isBrandGuests && conversationId ? (
          <>
            <View style={styles.tiles}>
              <TouchableOpacity
                style={[styles.tile, styles.tileAdd]}
                onPress={() => setAddingPeople(true)}
                accessibilityRole="button"
                accessibilityLabel={t("chat:group_add_people")}
              >
                <Icon name="person-add-outline" size={22} color={chatTokens.tagDeck} />
                <Text style={styles.tileText}>{t("chat:group_add_people")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tile, styles.tileShare]}
                onPress={() => void shareGroupLink()}
                disabled={sharingLink}
                accessibilityRole="button"
                accessibilityLabel={t("chat:group_link_share")}
                accessibilityState={{ busy: sharingLink }}
              >
                <Icon name="link-outline" size={22} color={chatTokens.tagChat} />
                <Text style={styles.tileText}>{t("chat:group_link_share")}</Text>
              </TouchableOpacity>
            </View>
            {!isSession ? (
              <View style={styles.linkSection}>
                <GroupLinkSection conversationId={conversationId} groupName={name} showShareButton={false} />
              </View>
            ) : null}
          </>
        ) : null}

        {isSession && conversationId && pendingRequests.length > 0 ? (
          <>
            <Text style={styles.sectionHeading} accessibilityRole="header">
              {t("chat:group_requests_heading", { count: pendingRequests.length })}
            </Text>
            {pendingRequests.map((request) => (
              <GroupJoinRequestCard
                key={request.id}
                conversationId={conversationId}
                requestId={request.id}
                groupName={name}
                fallbackText={t("chat:group_join_wants", { name: request.userName ?? "" })}
              />
            ))}
          </>
        ) : null}

        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            onClose();
            onOpenMedia();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("chat:menuMedia")}
        >
          <Icon name="images-outline" size={20} color={chatTokens.textSecondary} style={styles.rowIcon} />
          <Text style={styles.rowText}>{t("chat:menuMedia")}</Text>
          <Icon name="chevron-forward" size={18} color={chatTokens.textMuted} />
        </TouchableOpacity>

        <View style={styles.row}>
          <Icon name="notifications-off" size={20} color={chatTokens.textSecondary} style={styles.rowIcon} />
          <Text style={styles.rowText}>{t("chat:menuMute")}</Text>
          <Switch
            value={muted}
            onValueChange={(next) => void toggleMute(next)}
            disabled={muteBusy}
            trackColor={{ true: chatTokens.accent, false: chatTokens.surfaceRaised }}
            accessibilityLabel={t("chat:menuMute")}
          />
        </View>

        {brandGuests ? (
          <>
            {/* #4459 design v2: who is pushed, in one line. */}
            <View style={styles.note}>
              <Icon name="notifications-outline" size={14} color={chatTokens.textSoft} />
              <Text style={styles.noteText}>{t("chat:brandGuestsPushNote", { brand: brandGuests.brandName })}</Text>
            </View>
            {brandGuests.onMessageBrand ? (
              <TouchableOpacity
                style={styles.row}
                onPress={brandGuests.onMessageBrand}
                accessibilityRole="button"
                accessibilityLabel={t("chat:brandGuestsMessageBrand", { brand: brandGuests.brandName })}
                testID="brand-guests-message-brand"
              >
                <Icon name="chatbubble-outline" size={20} color={chatTokens.textSecondary} style={styles.rowIcon} />
                <Text style={styles.rowText}>{t("chat:brandGuestsMessageBrand", { brand: brandGuests.brandName })}</Text>
                <Icon name="chevron-forward" size={18} color={chatTokens.textMuted} />
              </TouchableOpacity>
            ) : null}
            {brandGuests.onOpenBrand ? (
              <TouchableOpacity
                style={styles.row}
                onPress={brandGuests.onOpenBrand}
                accessibilityRole="button"
                accessibilityLabel={t("chat:a11yOpenBrandPage", { name: brandGuests.brandName })}
              >
                <Icon name="storefront" size={20} color={chatTokens.textSecondary} style={styles.rowIcon} />
                <Text style={styles.rowText}>{t("chat:brandGuestsViewBrand", { brand: brandGuests.brandName })}</Text>
                <Icon name="chevron-forward" size={18} color={chatTokens.textMuted} />
              </TouchableOpacity>
            ) : null}
            <Text style={styles.sectionHeading} accessibilityRole="header">
              {t("chat:brandGuestsMembersHeading", { count: brandGuestMembers.data?.total ?? 0 })}
            </Text>
            {brandGuestMembers.isLoading ? (
              <ActivityIndicator size="small" color={chatTokens.textSoft} />
            ) : brandGuestMembers.isError ? (
              <TouchableOpacity
                style={styles.row}
                onPress={() => void brandGuestMembers.refetch()}
                accessibilityRole="button"
                accessibilityLabel={t("chat:brandGuestsMembersRetry")}
              >
                <Text style={styles.rowText}>{t("chat:brandGuestsMembersRetry")}</Text>
              </TouchableOpacity>
            ) : (
              <>
                {(brandGuestMembers.data?.members ?? []).map((member) => {
                  const isMe = member.userId === currentUserId;
                  const label = isMe ? t("chat:you") : member.displayName;
                  return (
                    <View key={member.userId} style={styles.member}>
                      {member.avatarUrl ? (
                        <ImageWithFallback source={{ uri: member.avatarUrl }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarFallback]}>
                          <Text style={styles.avatarText}>{(member.displayName || "?").slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={styles.memberText}>
                        <View style={styles.nameRow}>
                          <Text style={styles.rowText} numberOfLines={1}>{label}</Text>
                          {member.isTeam ? (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>{t("chat:brandGuestsHostChip")}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
                {(brandGuestMembers.data?.total ?? 0) > (brandGuestMembers.data?.members.length ?? 0) ? (
                  <Text style={styles.memberSub}>
                    {t("chat:brandGuestsMorePrivate", {
                      count: (brandGuestMembers.data?.total ?? 0) - (brandGuestMembers.data?.members.length ?? 0),
                    })}
                  </Text>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {!managed && !isBrandGuests ? <Text style={styles.sectionHeading} accessibilityRole="header">
          {isSession ? t("chat:group_members_count", { count: acceptedCount }) : t("chat:groupMembers")}
        </Text> : null}
        {isSession ? renderSessionMembers() : !managed && !isBrandGuests ? members.map((member) => {
          const label = memberLabel(member);
          const isMe = member.id === currentUserId;
          return (
            <TouchableOpacity
              key={member.id}
              style={styles.member}
              disabled={isMe || !onOpenProfile}
              onPress={() => {
                onClose();
                onOpenProfile?.(member.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={isMe ? t("chat:you") : t("chat:a11yViewProfile", { name: label })}
            >
              {member.avatar_url ? (
                <ImageWithFallback source={{ uri: member.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarText}>{label.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <Text style={styles.rowText} numberOfLines={1}>
                {isMe ? t("chat:you") : label}
              </Text>
            </TouchableOpacity>
          );
        }) : null}

        {!managed ? <View style={styles.divider} /> : null}
        {!managed && onClearChat ? <TouchableOpacity
          style={styles.row}
          onPress={onClearChat}
          accessibilityRole="button"
          accessibilityLabel={t("chat:menuClearChat")}
        >
          <Icon name="trash-outline" size={20} color={chatTokens.danger} style={styles.rowIcon} />
          <Text style={[styles.rowText, styles.danger]}>{t("chat:menuClearChat")}</Text>
        </TouchableOpacity> : null}
        {!managed ? <TouchableOpacity
          style={styles.row}
          onPress={confirmLeave}
          disabled={leaving}
          accessibilityRole="button"
          accessibilityLabel={t("chat:leaveGroup")}
        >
          <Icon name="exit-outline" size={20} color={chatTokens.danger} style={styles.rowIcon} />
          <Text style={[styles.rowText, styles.danger]}>{t("chat:leaveGroup")}</Text>
          {leaving ? <ActivityIndicator size="small" color={chatTokens.danger} /> : null}
        </TouchableOpacity> : null}
        {isSession && isCreatorMe ? <TouchableOpacity
          style={styles.row}
          onPress={confirmDelete}
          disabled={leaving}
          accessibilityRole="button"
          accessibilityLabel={t("chat:group_delete")}
        >
          <Icon name="trash-outline" size={20} color={chatTokens.danger} style={styles.rowIcon} />
          <Text style={[styles.rowText, styles.danger]}>{t("chat:group_delete")}</Text>
        </TouchableOpacity> : null}
      </View>
    </BaseBottomSheet>
    {!managed && !isBrandGuests && conversationId ? (
      <AddGroupPeopleSheet
        visible={visible && showAdd}
        conversationId={conversationId}
        groupName={name}
        memberIds={isSession ? sessionMembers.map((member) => member.userId) : members.map((member) => member.id)}
        sessionId={session?.sessionId ?? null}
        acceptedCount={isSession ? acceptedCount : undefined}
        onBack={() => {
          setAddingPeople(false);
          setBackFromAdd(true);
        }}
        onAdded={() => afterMembershipChange()}
      />
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingTop: 4,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
  },
  title: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  renameIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  renameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "stretch",
  },
  renameInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: chatTokens.accent,
    backgroundColor: chatTokens.inputBg,
    paddingHorizontal: 10,
    color: chatTokens.textPrimary,
    fontSize: 16,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  undoDock: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  undoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: chatTokens.accent,
    paddingLeft: 14,
    paddingRight: 8,
  },
  undoText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  undoButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  tiles: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tile: {
    flex: 1,
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tileAdd: {
    borderColor: chatTokens.accentBorder,
    backgroundColor: chatTokens.accentSoft,
  },
  tileShare: {
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.strip,
  },
  linkSection: {
    marginBottom: 8,
  },
  tileText: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
  },
  rowIcon: {
    width: 28,
    marginRight: 14,
    textAlign: "center",
  },
  rowText: {
    flexShrink: 1,
    flexGrow: 1,
    fontSize: 16,
    fontWeight: "500",
    color: chatTokens.textPrimary,
  },
  danger: {
    color: chatTokens.danger,
  },
  sectionHeading: {
    marginTop: 16,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: chatTokens.textMuted,
  },
  member: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  memberText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberSub: {
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: chatTokens.accentBorder,
    backgroundColor: chatTokens.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: chatTokens.tagDeck,
  },
  actions: {
    marginLeft: 48,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  action: {
    minHeight: 44,
    justifyContent: "center",
  },
  actionText: {
    fontSize: 15,
    fontWeight: "500",
    color: chatTokens.textPrimary,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: chatTokens.textSoft,
  },
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    padding: 12,
    gap: 4,
    marginBottom: 8,
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
  stateBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 16,
  },
  loading: {
    paddingVertical: 16,
  },
  smallButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: chatTokens.textPrimary,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.hairline,
    marginVertical: 8,
  },
  pressed: {
    opacity: 0.6,
  },
});
