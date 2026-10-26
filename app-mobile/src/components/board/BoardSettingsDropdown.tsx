import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { supabase } from "../../services/supabase";
import { useTranslation } from "react-i18next";
import { getDisplayName } from "../../utils/getDisplayName";
import { truncateString } from "../../utils/general";
import { notifyMemberLeft, notifySessionDeleted } from "../../services/boardNotificationService";
import { colors } from "../../constants/colors";
// ORCH-0520: inline phone invite + accordion friend picker
import { PhoneInput } from "../onboarding/PhoneInput";
import type { PhoneInputTheme } from "@mingla/phone-input";
import { chatTokens } from "../../constants/chatTokens";
import { getCountryByCode } from "../../constants/countries";
import { inviteByPhone } from "../../services/sessionInviteService";
import { setSessionMute } from "../../services/sessionMuteService";
import { InlineInviteFriendsList } from "./InlineInviteFriendsList";
// ORCH-0520 v2: reuse existing phone-lookup hook for live warm/cold visual
// (same pattern as AddFriendView.tsx:121)
import { usePhoneLookup, useDebouncedValue } from "../../hooks/usePhoneLookup";

// META-ORCH-0991 Wave B Batch 5: fixed snap translated from the old modal's
// `maxHeight: "80%"`. Keyboard-aware (the rename input lives in the header).
const SNAP_POINTS = ["80%"] as const;

interface Participant {
  id?: string;
  user_id: string;
  session_id: string;
  joined_at?: string;
  has_accepted?: boolean;
  is_admin?: boolean;
  // ORCH-0520 — per-participant session mute (DEFAULT false; unmuted on new-join)
  notifications_muted?: boolean;
  profiles?: {
    id: string;
    username?: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
}

interface PendingSessionInviteRow {
  id: string;
  kind: "warm" | "cold";
  userId?: string | null;
  phoneE164?: string | null;
  name: string;
  avatarUrl?: string | null;
}

interface BoardSettingsDropdownProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  sessionName: string;
  sessionCreatorId?: string;
  currentUserId?: string;
  isAdmin?: boolean;
  // ORCH-0520: server-truth mute (derived from session_participants.notifications_muted)
  notificationsMuted: boolean;
  participants?: Participant[];
  onExitBoard?: () => void;
  onSessionDeleted?: () => void;
  onSessionNameUpdated?: (newName: string) => void;
  onParticipantsChange?: () => void;
  /** Issue #4114 QA: "dark" on the dark chat screen; SessionViewModal keeps light. */
  theme?: "light" | "dark";
}

export const BoardSettingsDropdown: React.FC<BoardSettingsDropdownProps> = ({
  visible,
  onClose,
  sessionId,
  sessionName,
  sessionCreatorId,
  currentUserId,
  isAdmin = false,
  notificationsMuted,
  participants = [],
  onExitBoard,
  onSessionDeleted,
  onSessionNameUpdated,
  onParticipantsChange,
  theme = "light",
}) => {
  const { t } = useTranslation(["board", "common"]);
  const dark = theme === "dark";
  const st = dark ? darkStyles : styles;
  const pal = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const insets = useSafeAreaInsets();
  const [editSessionName, setEditSessionName] = useState(sessionName);
  const [savingName, setSavingName] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [exitingBoard, setExitingBoard] = useState(false);
  const [adminUsers, setAdminUsers] = useState<Set<string>>(new Set());
  const [pendingInvites, setPendingInvites] = useState<PendingSessionInviteRow[]>([]);
  const [pendingInviteIdsByUserId, setPendingInviteIdsByUserId] = useState<Record<string, string>>({});
  const [loadingPendingInvites, setLoadingPendingInvites] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  // META-ORCH-0991 Wave B Batch 5: ref widened to the BottomSheetTextInput
  // element ref (gorhom's keyboard-aware input forwards to RN TextInput).
  const nameInputRef = useRef<React.ElementRef<typeof BottomSheetTextInput>>(null);

  // ORCH-0520: inline phone invite state
  const [invitePhoneInput, setInvitePhoneInput] = useState("");
  const [inviteCountryCode, setInviteCountryCode] = useState("US");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [friendListExpanded, setFriendListExpanded] = useState(false);

  // ORCH-0520: optimistic mute state (null = no override, use prop)
  const [optimisticMute, setOptimisticMute] = useState<boolean | null>(null);
  const currentUserIsMuted =
    optimisticMute !== null ? optimisticMute : notificationsMuted;

  // Reset optimistic override whenever server truth changes to match it —
  // realtime update or prop re-render means we've caught up to server.
  useEffect(() => {
    setOptimisticMute(null);
  }, [notificationsMuted]);

  // Derived E.164 + validity for inline invite
  const invitePhoneE164 = useMemo(() => {
    const country = getCountryByCode(inviteCountryCode);
    if (!country) return "";
    const digits = invitePhoneInput.replace(/\D/g, "");
    if (!digits) return "";
    return `${country.dialCode}${digits}`;
  }, [invitePhoneInput, inviteCountryCode]);

  const isInvitePhoneValid = useMemo(() => {
    // Minimum 7 digits after the dial code — permissive to match PhoneInput's
    // freeform acceptance; edge functions do strict E.164 validation.
    const digits = invitePhoneInput.replace(/\D/g, "");
    return digits.length >= 7;
  }, [invitePhoneInput]);

  // ORCH-0520 v2: Debounced phone + live lookup. Shows warm/cold visual as
  // the user types so the Invite button reflects whether they're inviting a
  // Mingla user (warm in-app invite) or sending an SMS (cold).
  const debouncedPhoneE164 = useDebouncedValue(invitePhoneE164, 500);
  const digitCount = invitePhoneInput.replace(/\D/g, "").length;
  const debouncedDigitCount = useDebouncedValue(digitCount, 500);
  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

  // Debounce still resolving (user is mid-typing)
  const lookupDebouncing = isInvitePhoneValid && invitePhoneE164 !== debouncedPhoneE164;
  const lookupResolved =
    isInvitePhoneValid && !lookupDebouncing && !phoneLookupLoading && !!phoneLookupResult;
  const lookupFound = lookupResolved && phoneLookupResult?.found === true;

  // Sync admin users from participants
  useEffect(() => {
    if (participants.length > 0) {
      const admins = participants
        .filter((p) => p.is_admin)
        .map((p) => p.user_id);
      setAdminUsers(new Set(admins));
    }
  }, [participants]);

  // Sync local name from props — but NOT while actively saving (prevents
  // realtime UPDATE events from fighting with the user's input).
  useEffect(() => {
    if (!savingName) {
      setEditSessionName(sessionName);
    }
  }, [sessionName, visible]); // savingName intentionally excluded — we only want to gate, not re-trigger

  const canManageSession =
    currentUserId &&
    (sessionCreatorId === currentUserId || isAdmin);

  const isUserAdmin =
    currentUserId === sessionCreatorId || adminUsers.has(currentUserId || "");

  const loadPendingInvites = useCallback(async () => {
    if (!visible || !sessionId) {
      setPendingInvites([]);
      return;
    }

    setLoadingPendingInvites(true);
    try {
      const [warmResult, coldResult] = await Promise.all([
        supabase
          .from("collaboration_invites")
          .select("id, invited_user_id, status")
          .eq("session_id", sessionId)
          .eq("status", "pending"),
        supabase
          .from("pending_session_invites")
          .select("id, phone_e164, status")
          .eq("session_id", sessionId)
          .eq("status", "pending"),
      ]);

      if (warmResult.error) throw warmResult.error;
      if (coldResult.error) throw coldResult.error;

      const warmInvites = ((warmResult.data || []) as any[]);
      const invitedUserIds = Array.from(
        new Set(warmInvites.map((invite) => invite.invited_user_id).filter(Boolean)),
      );
      const { data: warmProfiles, error: warmProfilesError } = invitedUserIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, username, display_name, first_name, last_name, avatar_url")
            .in("id", invitedUserIds)
        : { data: [] as any[], error: null };
      if (warmProfilesError) throw warmProfilesError;
      const warmProfilesById = new Map((warmProfiles || []).map((profile: any) => [profile.id, profile]));

      const participantIds = new Set(participants.map((participant) => participant.user_id));
      const acceptedParticipantIds = new Set(
        participants
          .filter((participant) => participant.has_accepted === true)
          .map((participant) => participant.user_id),
      );

      const warmInviteMap: Record<string, string> = {};
      for (const invite of warmInvites) {
        if (invite.invited_user_id) warmInviteMap[invite.invited_user_id] = invite.id;
      }
      setPendingInviteIdsByUserId(warmInviteMap);

      const warmRows: PendingSessionInviteRow[] = warmInvites
        .filter((invite) => !acceptedParticipantIds.has(invite.invited_user_id))
        .filter((invite) => !participantIds.has(invite.invited_user_id))
        .map((invite) => {
          const profile = warmProfilesById.get(invite.invited_user_id);
          return {
            id: invite.id,
            kind: "warm" as const,
            userId: invite.invited_user_id,
            name: getDisplayName(profile, "Mingla friend"),
            avatarUrl: profile?.avatar_url ?? null,
          };
        });

      const coldRows: PendingSessionInviteRow[] = ((coldResult.data || []) as any[]).map((invite) => ({
        id: invite.id,
        kind: "cold" as const,
        phoneE164: invite.phone_e164,
        name: invite.phone_e164 || "Phone invite",
      }));

      setPendingInvites([...warmRows, ...coldRows]);
    } catch (error) {
      console.error("[BoardSettingsDropdown] Failed to load pending invites:", error);
      setPendingInvites([]);
      setPendingInviteIdsByUserId({});
    } finally {
      setLoadingPendingInvites(false);
    }
  }, [participants, sessionId, visible]);

  useEffect(() => {
    void loadPendingInvites();
  }, [loadPendingInvites]);

  // --- Handlers: Board actions ---

  const handleExitBoardWithRules = useCallback(async () => {
    if (exitingBoard) return;
    try {
      setExitingBoard(true);
      onClose();
      if (onExitBoard) {
        await Promise.resolve(onExitBoard());
      }
    } catch (error: any) {
      console.error("Error exiting board:", error);
      Alert.alert(
        t("board:boardSettingsDropdown.errorGeneric"),
        error?.message || t("board:boardSettingsDropdown.errorLeave")
      );
    } finally {
      setExitingBoard(false);
    }
  }, [exitingBoard, onClose, onExitBoard, t]);

  // No local Alert — parent (SessionViewModal.handleExitBoard) owns the confirmation dialog.
  const handleLeaveBoard = useCallback(() => {
    handleExitBoardWithRules();
  }, [handleExitBoardWithRules]);

  const handleDeleteSession = useCallback(async () => {
    if (deletingSession) return;
    if (!sessionId || !currentUserId) return;
    try {
      setDeletingSession(true);

      // Notify participants BEFORE delete (they still exist in DB)
      notifySessionDeleted({
        sessionId,
        sessionName: sessionName || "Session",
        userId: currentUserId,
        userName: getDisplayName(
          participants.find((p) => p.user_id === currentUserId)?.profiles,
          "Someone"
        ),
      });

      // ORCH-0448: Delete partner participants BEFORE the session row.
      // CASCADE would delete them in the same transaction as the session,
      // but Supabase Realtime checks RLS after CASCADE runs — by then
      // is_session_participant() returns false and the DELETE event is
      // never sent to partners. Deleting participants first fires the
      // realtime event while the session still exists and RLS passes.
      await supabase
        .from("session_participants")
        .delete()
        .eq("session_id", sessionId)
        .neq("user_id", currentUserId);

      const { error } = await supabase
        .from("collaboration_sessions")
        .delete()
        .eq("id", sessionId);
      if (error) throw error;

      if (onSessionDeleted) onSessionDeleted();
    } catch (error: any) {
      console.error("Error deleting session:", error);
      Alert.alert(
        t("board:boardSettingsDropdown.deleteFailed"),
        error?.message || t("board:boardSettingsDropdown.deleteFailedMsg")
      );
    } finally {
      setDeletingSession(false);
    }
  }, [deletingSession, sessionId, currentUserId, sessionName, participants, onSessionDeleted, t]);

  const handleDeleteSessionWithConfirmation = useCallback(() => {
    onClose();
    Alert.alert(
      t("board:boardSettingsDropdown.deleteSessionTitle"),
      t("board:boardSettingsDropdown.deleteSessionMsg", { name: sessionName }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("common:delete"),
          style: "destructive",
          onPress: handleDeleteSession,
        },
      ]
    );
  }, [sessionName, onClose, handleDeleteSession, t]);

  // --- Handlers: Inline name save ---

  const handleSaveName = useCallback(async () => {
    const trimmed = editSessionName.trim();
    // No change or empty — revert silently
    if (!trimmed || trimmed === sessionName) {
      setEditSessionName(sessionName);
      return;
    }
    if (!sessionId) return;
    try {
      setSavingName(true);
      const { error } = await supabase
        .from("collaboration_sessions")
        .update({ name: trimmed })
        .eq("id", sessionId);
      if (error) throw error;
      if (onSessionNameUpdated) onSessionNameUpdated(trimmed);
    } catch (error: any) {
      console.error("Error updating session name:", error);
      setEditSessionName(sessionName); // revert on failure
      Alert.alert(
        t("board:boardSettingsDropdown.updateFailed"),
        error?.message || t("board:boardSettingsDropdown.updateFailedMsg")
      );
    } finally {
      setSavingName(false);
    }
  }, [sessionId, editSessionName, sessionName, onSessionNameUpdated, t]);

  // --- Handlers: Mute toggle (ORCH-0520) ---

  const handleToggleMute = useCallback(async (): Promise<void> => {
    if (!sessionId || !currentUserId) return;
    const previous = currentUserIsMuted;
    setOptimisticMute(!previous);
    const result = await setSessionMute(sessionId, !previous);
    if (!result.success) {
      setOptimisticMute(previous); // rollback
      Alert.alert(
        t("board:boardSettingsDropdown.muteUpdateFailed"),
        result.error || t("board:boardSettingsDropdown.pleaseTryAgain")
      );
    }
    // Success: realtime UPDATE will eventually overwrite optimistic state
    // with server truth via useBoardSession's onParticipantUpdated callback.
  }, [sessionId, currentUserId, currentUserIsMuted, t]);

  // --- Handlers: Phone invite (ORCH-0520) ---

  const handlePhoneInvite = useCallback(async (): Promise<void> => {
    if (!sessionId || !currentUserId || !isInvitePhoneValid) return;
    setInviting(true);
    setInviteError(null);
    try {
      const outcome = await inviteByPhone(
        sessionId,
        currentUserId,
        sessionName,
        invitePhoneE164
      );
      if (outcome.kind === "warm") {
        setInvitePhoneInput("");
        Alert.alert(
          t("board:boardSettingsDropdown.invited"),
          outcome.displayName
            ? t("board:boardSettingsDropdown.invitedUser", { name: outcome.displayName })
            : t("board:boardSettingsDropdown.inviteSent")
        );
        onParticipantsChange?.();
      } else if (outcome.kind === "cold") {
        setInvitePhoneInput("");
        Alert.alert(
          t("board:boardSettingsDropdown.invited"),
          t("board:boardSettingsDropdown.invitedTextSent", { phone: outcome.phoneE164 })
        );
        onParticipantsChange?.();
      } else {
        setInviteError(outcome.message);
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }, [sessionId, currentUserId, sessionName, invitePhoneE164, isInvitePhoneValid, onParticipantsChange, t]);

  // --- Handlers: Member management ---

  const handleToggleAdmin = useCallback(
    async (memberUserId: string, memberDisplayName: string, isCurrentlyAdmin: boolean) => {
      if (!currentUserId || !sessionId) return;

      if (memberUserId === sessionCreatorId) {
        Alert.alert(
          t("board:manageBoardModal.cannotModifyCreator"),
          t("board:manageBoardModal.cannotModifyCreatorMsg")
        );
        return;
      }

      if (isCurrentlyAdmin) {
        Alert.alert(
          "Remove Admin",
          `Remove admin privileges from ${memberDisplayName}?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: async () => {
                try {
                  const { error } = await supabase
                    .from("session_participants")
                    .update({ is_admin: false })
                    .eq("session_id", sessionId)
                    .eq("user_id", memberUserId);
                  if (error) throw error;
                  setAdminUsers((prev) => {
                    const s = new Set(prev);
                    s.delete(memberUserId);
                    return s;
                  });
                  onParticipantsChange?.();
                } catch (err: any) {
                  console.error("Error demoting member:", err);
                  Alert.alert("Error", err?.message || "Could not remove admin privileges.");
                }
              },
            },
          ]
        );
      } else {
        try {
          const { error } = await supabase
            .from("session_participants")
            .update({ is_admin: true })
            .eq("session_id", sessionId)
            .eq("user_id", memberUserId);
          if (error) throw error;
          setAdminUsers((prev) => new Set([...prev, memberUserId]));
          onParticipantsChange?.();
        } catch (err: any) {
          console.error("Error promoting member:", err);
          Alert.alert("Error", err?.message || "Could not promote to admin.");
        }
      }
    },
    [currentUserId, sessionId, sessionCreatorId, onParticipantsChange, t]
  );

  const handleRemoveMember = useCallback(
    (memberUserId: string, memberDisplayName: string) => {
      if (!currentUserId || !sessionId) return;

      if (memberUserId === sessionCreatorId) {
        Alert.alert(
          t("board:manageBoardModal.cannotRemoveCreator"),
          t("board:manageBoardModal.cannotRemoveCreatorMsg")
        );
        return;
      }
      if (memberUserId === currentUserId) {
        Alert.alert(
          t("board:manageBoardModal.cannotRemoveSelf"),
          t("board:manageBoardModal.cannotRemoveSelfMsg")
        );
        return;
      }

      Alert.alert(
        "Remove Member",
        `Remove ${memberDisplayName} from this board?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await supabase
                  .from("collaboration_invites")
                  .delete()
                  .eq("session_id", sessionId)
                  .eq("invited_user_id", memberUserId);

                const { error } = await supabase
                  .from("session_participants")
                  .delete()
                  .eq("session_id", sessionId)
                  .eq("user_id", memberUserId);
                if (error) throw error;

                notifyMemberLeft({
                  sessionId,
                  sessionName: sessionName || "Session",
                  userId: memberUserId,
                  userName: memberDisplayName,
                });

                onParticipantsChange?.();
                Alert.alert("Done", `${memberDisplayName} has been removed.`);
              } catch (err: any) {
                console.error("Error removing member:", err);
                Alert.alert("Error", err?.message || "Could not remove member.");
              }
            },
          },
        ]
      );
    },
    [currentUserId, sessionId, sessionCreatorId, sessionName, onParticipantsChange, t]
  );

  const handleRevokePendingInvite = useCallback(
    (invite: PendingSessionInviteRow) => {
      if (!currentUserId || !sessionId || !isUserAdmin) return;

      Alert.alert(
        "Revoke Invite",
        `Revoke the pending invite for ${invite.name}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revoke",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  setRevokingInviteId(invite.id);
                  if (invite.kind === "cold") {
                    const { error } = await supabase
                      .from("pending_session_invites")
                      .update({ status: "cancelled" })
                      .eq("id", invite.id)
                      .eq("session_id", sessionId);
                    if (error) throw error;
                  } else {
                    let inviteDelete = supabase
                      .from("collaboration_invites")
                      .delete()
                      .eq("session_id", sessionId);
                    inviteDelete = invite.id.startsWith("participant:") && invite.userId
                      ? inviteDelete.eq("invited_user_id", invite.userId).eq("status", "pending")
                      : inviteDelete.eq("id", invite.id);

                    const { error: inviteError } = await inviteDelete;
                    if (inviteError) throw inviteError;

                    if (invite.userId) {
                      const { error: participantError } = await supabase
                        .from("session_participants")
                        .delete()
                        .eq("session_id", sessionId)
                        .eq("user_id", invite.userId)
                        .eq("has_accepted", false);
                      if (participantError) throw participantError;
                    }
                  }

                  setPendingInvites((prev) => prev.filter((row) => row.id !== invite.id));
                  onParticipantsChange?.();
                  void loadPendingInvites();
                } catch (err: any) {
                  console.error("Error revoking invite:", err);
                  Alert.alert("Error", err?.message || "Could not revoke invite.");
                } finally {
                  setRevokingInviteId(null);
                }
              })();
            },
          },
        ]
      );
    },
    [currentUserId, isUserAdmin, loadPendingInvites, onParticipantsChange, sessionId],
  );

  if (!visible) return null;

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS as unknown as string[]}
      wrapInRNModal
      theme={dark ? "dark" : "light"}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("board:boardSettingsDropdown.title", {
        defaultValue: "Board settings",
      })}
      header={
        /* Header row — editable name (creators/admins) + mute bell (all participants).
            ORCH-0520 v2: title+pencil wrapped in a tight self-sized row with a
            solid orange underline (cross-platform reliable); spacer pushes bell
            to the far right so the pencil hugs the title. */
        <View style={st.headerRow}>
                {canManageSession ? (
                  <View style={st.titleAndPencil}>
                    <BottomSheetTextInput
                      ref={nameInputRef}
                      style={st.titleInput}
                      value={editSessionName}
                      onChangeText={setEditSessionName}
                      onBlur={handleSaveName}
                      onSubmitEditing={handleSaveName}
                      returnKeyType="done"
                      maxLength={100}
                      selectTextOnFocus
                      accessibilityLabel={t("board:boardSettingsDropdown.editName")}
                      accessibilityHint={t("board:boardSettingsDropdown.editNameHint")}
                    />
                    <Icon
                      name="pencil"
                      size={14}
                      color={pal.textMuted}
                      style={st.pencilIcon}
                    />
                    {savingName && (
                      <ActivityIndicator
                        size="small"
                        color="#eb7825"
                        style={st.savingIndicator}
                      />
                    )}
                  </View>
                ) : (
                  <Text style={st.titleStatic} numberOfLines={1}>
                    {sessionName}
                  </Text>
                )}

                {/* Spacer pushes the bell to the far right while the title+pencil
                    stay anchored on the left, hugging the text. */}
                <View style={st.headerSpacer} />

                {/* Mute bell — visible to all participants, server-truth state */}
                <TouchableOpacity
                  style={st.bellButton}
                  onPress={handleToggleMute}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    currentUserIsMuted
                      ? t("board:boardSettingsDropdown.unmuteNotifications")
                      : t("board:boardSettingsDropdown.muteNotifications")
                  }
                  accessibilityState={{ selected: currentUserIsMuted }}
                >
                  <Icon
                    name={currentUserIsMuted ? "notifications-off" : "notifications"}
                    size={22}
                    color={currentUserIsMuted ? pal.textMuted : pal.icon}
                  />
                </TouchableOpacity>
        </View>
      }
      scrollProps={{
        style: st.sheetScroll,
        contentContainerStyle: st.sheetScrollContent,
        showsVerticalScrollIndicator: false,
        keyboardShouldPersistTaps: "handled",
      }}
      stickyFooter={
        /* ORCH-0520 v2: Leave & Delete fixed footer — outside the scroll body.
            Prevents action buttons from shifting when the friend accordion
            expands. Safe-area-aware bottom padding. */
        <View style={[st.actionButtonsRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity
            style={st.leaveButton}
            onPress={handleLeaveBoard}
            activeOpacity={0.8}
            disabled={exitingBoard}
          >
            <Icon name="log-out" size={16} color={pal.danger} />
            <Text style={st.leaveButtonText}>
              {exitingBoard ? "Leaving..." : "Leave"}
            </Text>
          </TouchableOpacity>
          {canManageSession && (
            <TouchableOpacity
              style={st.deleteButton}
              onPress={handleDeleteSessionWithConfirmation}
              activeOpacity={0.8}
              disabled={deletingSession}
            >
              <Icon name="trash-outline" size={16} color="white" />
              <Text style={st.deleteButtonText}>
                {deletingSession ? "Deleting..." : "Delete"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      }
    >
                {/* ORCH-0520: Invite section — creators + admins only */}
                {canManageSession && (
                  <View style={st.inviteSection}>
                    <Text style={st.sectionLabel}>
                      {t("board:boardSettingsDropdown.inviteByPhone")}
                    </Text>
                    <PhoneInput
                      value={invitePhoneInput}
                      countryCode={inviteCountryCode}
                      onChangePhone={setInvitePhoneInput}
                      onChangeCountry={setInviteCountryCode}
                      error={inviteError}
                      disabled={inviting}
                      theme={dark ? DARK_PHONE_THEME : undefined}
                    />

                    {/* ORCH-0520 v2: live lookup result (mirrors AddFriendView pattern) */}
                    {isInvitePhoneValid && (lookupDebouncing || phoneLookupLoading) && (
                      <View style={st.lookupRow}>
                        <ActivityIndicator size="small" color="#eb7825" />
                        <Text style={st.lookupTextMuted}>
                          {t("board:boardSettingsDropdown.checkingNumber")}
                        </Text>
                      </View>
                    )}
                    {lookupResolved && lookupFound && (
                      <View style={st.lookupRow}>
                        <Icon name="checkmark-circle" size={14} color={pal.success} />
                        <Text style={st.lookupTextGreen}>
                          {t("social:isOnMingla", {
                            name: getDisplayName(phoneLookupResult?.user, "User"),
                          })}
                        </Text>
                      </View>
                    )}
                    {lookupResolved && !lookupFound && (
                      <View style={st.lookupRow}>
                        <Icon name="person-add-outline" size={14} color={pal.textSoft} />
                        <Text style={st.lookupTextMuted}>
                          {t("social:notOnMinglaYet")}
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[
                        st.inviteButton,
                        (!isInvitePhoneValid || inviting || lookupDebouncing || phoneLookupLoading) &&
                          st.inviteButtonDisabled,
                      ]}
                      onPress={handlePhoneInvite}
                      disabled={
                        !isInvitePhoneValid || inviting || lookupDebouncing || phoneLookupLoading
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t("board:boardSettingsDropdown.sendInviteByPhone")}
                    >
                      {inviting ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <View style={st.inviteButtonContent}>
                          <Icon
                            name={
                              lookupResolved && lookupFound
                                ? "person-add"
                                : lookupResolved && !lookupFound
                                ? "chatbubble-ellipses-outline"
                                : "send"
                            }
                            size={16}
                            color="white"
                          />
                          <Text style={st.inviteButtonText}>
                            {lookupResolved && lookupFound
                              ? t("board:boardSettingsDropdown.inviteUser", {
                                  name: getDisplayName(phoneLookupResult?.user, "User"),
                                })
                              : lookupResolved && !lookupFound
                              ? t("board:boardSettingsDropdown.sendSmsInvite")
                              : t("board:boardSettingsDropdown.invite")}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* Collapsible friend-picker accordion */}
                    <TouchableOpacity
                      style={st.friendAccordionHeader}
                      onPress={() => setFriendListExpanded((v) => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: friendListExpanded }}
                      accessibilityLabel={t("board:boardSettingsDropdown.inviteFromFriends")}
                    >
                      <Icon name="users" size={18} color={pal.textSoft} />
                      <Text style={st.friendAccordionTitle}>
                        {t("board:boardSettingsDropdown.inviteFromFriends")}
                      </Text>
                      <Icon
                        name={friendListExpanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={pal.textMuted}
                      />
                    </TouchableOpacity>

                    {friendListExpanded && (
                      <InlineInviteFriendsList
                        sessionId={sessionId}
                        sessionName={sessionName}
                        existingParticipantIds={participants.map((p) => p.user_id)}
                        theme={theme}
                        onInvitesSent={() => {
                          onParticipantsChange?.();
                          setFriendListExpanded(false);
                        }}
                      />
                    )}
                  </View>
                )}

                {/* Divider */}
                <View style={st.menuDivider} />

                {/* Members Section */}
                <View style={st.membersSection}>
                  <Text style={st.membersSectionTitle}>
                    Members ({participants.length + pendingInvites.length})
                  </Text>
                  {participants.map((participant) => {
                    const profile = participant.profiles;
                    const isCurrentUser = participant.user_id === currentUserId;
                    const originalName = getDisplayName(profile, "Unknown");
                    const displayName = isCurrentUser ? "You" : originalName;
                    const isCreator = participant.user_id === sessionCreatorId;
                    const isPendingParticipant = participant.has_accepted === false;
                    const isParticipantAdmin =
                      isCreator || adminUsers.has(participant.user_id);
                    const pendingInviteId = pendingInviteIdsByUserId[participant.user_id];

                    return (
                      <View
                        key={participant.user_id || participant.id}
                        style={st.memberRow}
                      >
                        <View style={st.memberLeft}>
                          <View style={st.memberAvatar}>
                            <Text style={st.memberAvatarText}>
                              {originalName.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={st.memberInfo}>
                            <View style={st.memberNameRow}>
                              <Text style={st.memberName}>
                                {truncateString(displayName, 15)}
                              </Text>
                              {isCreator && (
                                <View style={st.creatorBadge}>
                                  <Icon name="crown-outline" size={10} color="white" />
                                  <Text style={st.badgeText}>Creator</Text>
                                </View>
                              )}
                              {!isCreator && isParticipantAdmin && (
                                <View style={st.adminBadge}>
                                  <Icon name="shield" size={9} color="white" />
                                  <Text style={st.badgeText}>Admin</Text>
                                </View>
                              )}
                              {isPendingParticipant && (
                                <View style={st.pendingBadge}>
                                  <Icon name="time-outline" size={10} color={pal.pendingText} />
                                  <Text style={st.pendingBadgeText}>Pending</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>

                        {/* Action buttons — admin can manage non-creator, non-self */}
                        {isUserAdmin && !isCreator && !isCurrentUser && (
                          <View style={st.memberActions}>
                            {!isPendingParticipant ? (
                              <TouchableOpacity
                                style={[
                                  st.memberActionBtn,
                                  isParticipantAdmin && st.memberActionBtnActive,
                                ]}
                                onPress={() =>
                                  handleToggleAdmin(
                                    participant.user_id,
                                    originalName,
                                    isParticipantAdmin
                                  )
                                }
                              >
                                <Icon
                                  name="shield"
                                  size={16}
                                  color={isParticipantAdmin ? "#eb7825" : pal.textMuted}
                                />
                              </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity
                              style={st.memberActionBtn}
                              onPress={() =>
                                isPendingParticipant
                                  ? handleRevokePendingInvite({
                                      id: pendingInviteId || `participant:${participant.user_id}`,
                                      kind: "warm",
                                      userId: participant.user_id,
                                      name: originalName,
                                      avatarUrl: profile?.avatar_url ?? null,
                                    })
                                  : handleRemoveMember(participant.user_id, originalName)
                              }
                            >
                              <Icon
                                name={isPendingParticipant ? "close" : "user-minus"}
                                size={16}
                                color={pal.danger}
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {loadingPendingInvites ? (
                    <ActivityIndicator style={st.pendingInvitesLoading} size="small" color="#eb7825" />
                  ) : null}
                  {pendingInvites.map((invite) => (
                    <View key={`${invite.kind}-${invite.id}`} style={st.memberRow}>
                      <View style={st.memberLeft}>
                        <View style={[st.memberAvatar, st.pendingInviteAvatar]}>
                          <Text style={st.memberAvatarText}>
                            {(invite.name || "?").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={st.memberInfo}>
                          <View style={st.memberNameRow}>
                            <Text style={st.memberName}>
                              {truncateString(invite.name, 18)}
                            </Text>
                            <View style={st.pendingBadge}>
                              <Icon name="time-outline" size={10} color={pal.pendingText} />
                              <Text style={st.pendingBadgeText}>
                                {invite.kind === "cold" ? "SMS pending" : "Pending"}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                      {isUserAdmin ? (
                        <View style={st.memberActions}>
                          <TouchableOpacity
                            style={[
                              st.memberActionBtn,
                              revokingInviteId === invite.id ? st.memberActionBtnDisabled : null,
                            ]}
                            disabled={revokingInviteId === invite.id}
                            onPress={() => handleRevokePendingInvite(invite)}
                            accessibilityRole="button"
                            accessibilityLabel={`Revoke invite for ${invite.name}`}
                          >
                            {revokingInviteId === invite.id ? (
                              <ActivityIndicator size="small" color={pal.danger} />
                            ) : (
                              <Icon name="close" size={16} color={pal.danger} />
                            )}
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>

                {/* Divider */}
    </BaseBottomSheet>
  );
};

// Issue #4114 QA (P3): the session group's settings sheet sits on the dark
// chat screen, so it has a dark palette on the chat tokens. The light palette
// keeps every colour it had for SessionViewModal.
interface SettingsPalette {
  textPrimary: string;
  textBody: string;
  textMuted: string;
  textSoft: string;
  divider: string;
  rowBg: string;
  adminBadgeBg: string;
  pendingBg: string;
  pendingText: string;
  actionBtnBg: string;
  actionBtnActiveBg: string;
  pendingAvatarBg: string;
  footerBg: string;
  danger: string;
  disabledBg: string;
  success: string;
  icon: string;
}

const LIGHT_PALETTE: SettingsPalette = {
  textPrimary: "#111827",
  textBody: "#374151",
  textMuted: "#9CA3AF",
  textSoft: "#6b7280",
  divider: "#E5E7EB",
  rowBg: "#F9FAFB",
  adminBadgeBg: "#6B7280",
  pendingBg: "#FEF3C7",
  pendingText: "#92400e",
  actionBtnBg: "#F3F4F6",
  actionBtnActiveBg: "#FEF3C7",
  pendingAvatarBg: "#9CA3AF",
  footerBg: "white",
  danger: "#EF4444",
  disabledBg: "#D1D5DB",
  success: "#22c55e",
  icon: "#374151",
};

const DARK_PALETTE: SettingsPalette = {
  textPrimary: chatTokens.textPrimary,
  textBody: chatTokens.textSecondary,
  textMuted: chatTokens.textSoft,
  textSoft: chatTokens.textSoft,
  divider: chatTokens.hairline,
  rowBg: chatTokens.surfaceRaised,
  adminBadgeBg: chatTokens.hairline,
  pendingBg: chatTokens.warningSoft,
  pendingText: chatTokens.warning,
  actionBtnBg: chatTokens.strip,
  actionBtnActiveBg: chatTokens.accentSoft,
  pendingAvatarBg: chatTokens.textMuted,
  footerBg: "transparent",
  danger: chatTokens.danger,
  disabledBg: chatTokens.hairline,
  success: chatTokens.success,
  icon: chatTokens.textSecondary,
};

/** The dark phone field inside the dark sheet. */
const DARK_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: chatTokens.surfaceRaised,
  textPrimary: chatTokens.textPrimary,
  textTertiary: chatTokens.textSoft,
  borderDefault: chatTokens.hairline,
  borderFocused: chatTokens.accent,
  borderError: chatTokens.danger,
  searchBackground: chatTokens.strip,
  rowPressedBackground: chatTokens.strip,
  divider: chatTokens.hairline,
  accessoryBackground: chatTokens.surface,
  accessoryBorder: chatTokens.hairline,
  accent: chatTokens.accent,
  errorText: chatTokens.danger,
};

const makeStyles = (p: SettingsPalette) => StyleSheet.create({
  // --- Bottom sheet body ---
  sheetScroll: {
    paddingHorizontal: 4,
    flexShrink: 1,
  },
  sheetScrollContent: {
    paddingBottom: 8,
  },

  // --- Menu items ---
  menuSection: {
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 15,
    color: p.textBody,
    fontWeight: "400",
  },
  menuDivider: {
    height: 1,
    backgroundColor: p.divider,
    marginVertical: 6,
    marginHorizontal: 20,
  },

  // --- Members ---
  membersSection: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  membersSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: p.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: p.rowBg,
    borderRadius: 10,
    marginBottom: 6,
  },
  memberLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  memberInfo: {
    marginLeft: 10,
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "600",
    color: p.textPrimary,
  },
  creatorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: p.adminBadgeBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: p.pendingBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: p.pendingText,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "white",
  },
  memberActions: {
    flexDirection: "row",
    gap: 6,
  },
  memberActionBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: p.actionBtnBg,
  },
  memberActionBtnActive: {
    backgroundColor: p.actionBtnActiveBg,
  },
  memberActionBtnDisabled: {
    opacity: 0.55,
  },
  pendingInviteAvatar: {
    backgroundColor: p.pendingAvatarBg,
  },
  pendingInvitesLoading: {
    paddingVertical: 8,
  },

  // --- Action buttons (ORCH-0520 v2): fixed footer outside ScrollView ---
  actionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: p.divider,
    backgroundColor: p.footerBg,
  },
  leaveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: p.danger,
    backgroundColor: p.footerBg,
  },
  leaveButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: p.danger,
  },
  deleteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: p.danger,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },

  // --- Header row (ORCH-0520 v2): tight title+pencil + spacer + bell ---
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  // Tight self-sized wrapper. No flex:1 — so the pencil stays next to the text,
  // not pushed to the far right. Solid orange underline (cross-platform reliable;
  // borderStyle:'dashed' is iOS-flaky per spec OQ-1).
  titleAndPencil: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: "#eb7825",
    paddingBottom: 2,
    maxWidth: "75%",
  },
  titleInput: {
    fontSize: 18,
    fontWeight: "700",
    color: p.textPrimary,
    paddingVertical: 6,
    paddingHorizontal: 0,
    minWidth: 80,
  },
  pencilIcon: {
    marginLeft: 6,
  },
  savingIndicator: {
    marginLeft: 8,
  },
  titleStatic: {
    fontSize: 18,
    fontWeight: "700",
    color: p.textPrimary,
    paddingVertical: 6,
    maxWidth: "75%",
  },
  headerSpacer: {
    flex: 1,
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  // --- Invite section (ORCH-0520) ---
  inviteSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: p.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  inviteButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  inviteButtonDisabled: {
    backgroundColor: p.disabledBg,
  },
  // ORCH-0520 v2: icon + label pairing inside the button (warm/cold/default states)
  inviteButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  inviteButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 15,
  },
  // ORCH-0520 v2: live phone-lookup result row (mirrors AddFriendView pattern)
  lookupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  lookupTextGreen: {
    fontSize: 13,
    color: p.success,
    fontWeight: "500",
  },
  lookupTextMuted: {
    fontSize: 13,
    color: p.textSoft,
  },
  friendAccordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: p.divider,
    marginTop: 8,
  },
  friendAccordionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: p.textBody,
  },
});

const styles = makeStyles(LIGHT_PALETTE);
const darkStyles = makeStyles(DARK_PALETTE);

export default BoardSettingsDropdown;
