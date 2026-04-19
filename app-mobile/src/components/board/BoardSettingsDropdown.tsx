import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../ui/Icon";
import { supabase } from "../../services/supabase";
import { useTranslation } from "react-i18next";
import { getDisplayName } from "../../utils/getDisplayName";
import { truncateString } from "../../utils/general";
import { notifyMemberLeft, notifySessionDeleted } from "../../services/boardNotificationService";
import { colors } from "../../constants/colors";
// ORCH-0520: inline phone invite + accordion friend picker
import { PhoneInput } from "../onboarding/PhoneInput";
import { getCountryByCode } from "../../constants/countries";
import { inviteByPhone } from "../../services/sessionInviteService";
import { setSessionMute } from "../../services/sessionMuteService";
import { InlineInviteFriendsList } from "./InlineInviteFriendsList";
// ORCH-0520 v2: reuse existing phone-lookup hook for live warm/cold visual
// (same pattern as AddFriendView.tsx:121 + CollaborationSessions.tsx:216)
import { usePhoneLookup, useDebouncedValue } from "../../hooks/usePhoneLookup";

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
}) => {
  const { t } = useTranslation(["board", "common"]);
  const insets = useSafeAreaInsets();
  const [editSessionName, setEditSessionName] = useState(sessionName);
  const [savingName, setSavingName] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [exitingBoard, setExitingBoard] = useState(false);
  const [adminUsers, setAdminUsers] = useState<Set<string>>(new Set());
  const nameInputRef = useRef<TextInput>(null);

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

  if (!visible) return null;

  return (
    <>
      {/* Bottom Sheet */}
      {visible && (
        <Modal
          visible={visible}
          transparent
          animationType="slide"
          onRequestClose={onClose}
        >
          <Pressable style={styles.sheetOverlay} onPress={onClose}>
            <Pressable style={styles.sheetContainer} onPress={() => {}}>
              {/* Handle */}
              <View style={styles.sheetHandleRow}>
                <View style={styles.sheetHandle} />
              </View>

              {/* Header row — editable name (creators/admins) + mute bell (all participants).
                  ORCH-0520 v2: title+pencil wrapped in a tight self-sized row with a
                  solid orange underline (cross-platform reliable); spacer pushes bell
                  to the far right so the pencil hugs the title. */}
              <View style={styles.headerRow}>
                {canManageSession ? (
                  <View style={styles.titleAndPencil}>
                    <TextInput
                      ref={nameInputRef}
                      style={styles.titleInput}
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
                      color="#9CA3AF"
                      style={styles.pencilIcon}
                    />
                    {savingName && (
                      <ActivityIndicator
                        size="small"
                        color="#eb7825"
                        style={styles.savingIndicator}
                      />
                    )}
                  </View>
                ) : (
                  <Text style={styles.titleStatic} numberOfLines={1}>
                    {sessionName}
                  </Text>
                )}

                {/* Spacer pushes the bell to the far right while the title+pencil
                    stay anchored on the left, hugging the text. */}
                <View style={styles.headerSpacer} />

                {/* Mute bell — visible to all participants, server-truth state */}
                <TouchableOpacity
                  style={styles.bellButton}
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
                    color={currentUserIsMuted ? "#9CA3AF" : "#374151"}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.sheetScroll}
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* ORCH-0520: Invite section — creators + admins only */}
                {canManageSession && (
                  <View style={styles.inviteSection}>
                    <Text style={styles.sectionLabel}>
                      {t("board:boardSettingsDropdown.inviteByPhone")}
                    </Text>
                    <PhoneInput
                      value={invitePhoneInput}
                      countryCode={inviteCountryCode}
                      onChangePhone={setInvitePhoneInput}
                      onChangeCountry={setInviteCountryCode}
                      error={inviteError}
                      disabled={inviting}
                    />

                    {/* ORCH-0520 v2: live lookup result (mirrors AddFriendView pattern) */}
                    {isInvitePhoneValid && (lookupDebouncing || phoneLookupLoading) && (
                      <View style={styles.lookupRow}>
                        <ActivityIndicator size="small" color="#eb7825" />
                        <Text style={styles.lookupTextMuted}>
                          {t("board:boardSettingsDropdown.checkingNumber")}
                        </Text>
                      </View>
                    )}
                    {lookupResolved && lookupFound && (
                      <View style={styles.lookupRow}>
                        <Icon name="checkmark-circle" size={14} color="#22c55e" />
                        <Text style={styles.lookupTextGreen}>
                          {t("social:isOnMingla", {
                            name: getDisplayName(phoneLookupResult?.user, "User"),
                          })}
                        </Text>
                      </View>
                    )}
                    {lookupResolved && !lookupFound && (
                      <View style={styles.lookupRow}>
                        <Icon name="person-add-outline" size={14} color="#6b7280" />
                        <Text style={styles.lookupTextMuted}>
                          {t("social:notOnMinglaYet")}
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.inviteButton,
                        (!isInvitePhoneValid || inviting || lookupDebouncing || phoneLookupLoading) &&
                          styles.inviteButtonDisabled,
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
                        <View style={styles.inviteButtonContent}>
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
                          <Text style={styles.inviteButtonText}>
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
                      style={styles.friendAccordionHeader}
                      onPress={() => setFriendListExpanded((v) => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: friendListExpanded }}
                      accessibilityLabel={t("board:boardSettingsDropdown.inviteFromFriends")}
                    >
                      <Icon name="users" size={18} color="#6B7280" />
                      <Text style={styles.friendAccordionTitle}>
                        {t("board:boardSettingsDropdown.inviteFromFriends")}
                      </Text>
                      <Icon
                        name={friendListExpanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>

                    {friendListExpanded && (
                      <InlineInviteFriendsList
                        sessionId={sessionId}
                        sessionName={sessionName}
                        existingParticipantIds={participants.map((p) => p.user_id)}
                        onInvitesSent={() => {
                          onParticipantsChange?.();
                          setFriendListExpanded(false);
                        }}
                      />
                    )}
                  </View>
                )}

                {/* Divider */}
                <View style={styles.menuDivider} />

                {/* Members Section */}
                <View style={styles.membersSection}>
                  <Text style={styles.membersSectionTitle}>
                    Members ({participants.length})
                  </Text>
                  {participants.map((participant) => {
                    const profile = participant.profiles;
                    const isCurrentUser = participant.user_id === currentUserId;
                    const originalName = getDisplayName(profile, "Unknown");
                    const displayName = isCurrentUser ? "You" : originalName;
                    const isCreator = participant.user_id === sessionCreatorId;
                    const isParticipantAdmin =
                      isCreator || adminUsers.has(participant.user_id);

                    return (
                      <View
                        key={participant.user_id || participant.id}
                        style={styles.memberRow}
                      >
                        <View style={styles.memberLeft}>
                          <View style={styles.memberAvatar}>
                            <Text style={styles.memberAvatarText}>
                              {originalName.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.memberInfo}>
                            <View style={styles.memberNameRow}>
                              <Text style={styles.memberName}>
                                {truncateString(displayName, 15)}
                              </Text>
                              {isCreator && (
                                <View style={styles.creatorBadge}>
                                  <Icon name="crown-outline" size={10} color="white" />
                                  <Text style={styles.badgeText}>Creator</Text>
                                </View>
                              )}
                              {!isCreator && isParticipantAdmin && (
                                <View style={styles.adminBadge}>
                                  <Icon name="shield" size={9} color="white" />
                                  <Text style={styles.badgeText}>Admin</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>

                        {/* Action buttons — admin can manage non-creator, non-self */}
                        {isUserAdmin && !isCreator && !isCurrentUser && (
                          <View style={styles.memberActions}>
                            <TouchableOpacity
                              style={[
                                styles.memberActionBtn,
                                isParticipantAdmin && styles.memberActionBtnActive,
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
                                color={isParticipantAdmin ? "#eb7825" : "#9CA3AF"}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.memberActionBtn}
                              onPress={() =>
                                handleRemoveMember(participant.user_id, originalName)
                              }
                            >
                              <Icon name="user-minus" size={16} color="#EF4444" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Divider */}
              </ScrollView>

              {/* ORCH-0520 v2: Leave & Delete fixed footer — outside ScrollView.
                  Prevents action buttons from shifting when the friend accordion
                  expands. Safe-area-aware bottom padding. */}
              <View style={[styles.actionButtonsRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
                <TouchableOpacity
                  style={styles.leaveButton}
                  onPress={handleLeaveBoard}
                  activeOpacity={0.8}
                  disabled={exitingBoard}
                >
                  <Icon name="log-out" size={16} color="#EF4444" />
                  <Text style={styles.leaveButtonText}>
                    {exitingBoard ? "Leaving..." : "Leave"}
                  </Text>
                </TouchableOpacity>
                {canManageSession && (
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={handleDeleteSessionWithConfirmation}
                    activeOpacity={0.8}
                    disabled={deletingSession}
                  >
                    <Icon name="trash-outline" size={16} color="white" />
                    <Text style={styles.deleteButtonText}>
                      {deletingSession ? "Deleting..." : "Delete"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

    </>
  );
};

const styles = StyleSheet.create({
  // --- Bottom sheet ---
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingBottom: 34,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandleRow: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  sheetScroll: {
    paddingHorizontal: 4,
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
    color: "#374151",
    fontWeight: "400",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
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
    color: "#9CA3AF",
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
    backgroundColor: "#F9FAFB",
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
    color: "#111827",
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
    backgroundColor: "#6B7280",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
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
    backgroundColor: "#F3F4F6",
  },
  memberActionBtnActive: {
    backgroundColor: "#FEF3C7",
  },

  // --- Action buttons (ORCH-0520 v2): fixed footer outside ScrollView ---
  actionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "white",
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
    borderColor: "#EF4444",
    backgroundColor: "white",
  },
  leaveButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#EF4444",
  },
  deleteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: "#EF4444",
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
    color: "#111827",
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
    color: "#111827",
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
    color: "#9CA3AF",
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
    backgroundColor: "#D1D5DB",
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
    color: "#22c55e",
    fontWeight: "500",
  },
  lookupTextMuted: {
    fontSize: 13,
    color: "#6b7280",
  },
  friendAccordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    marginTop: 8,
  },
  friendAccordionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#374151",
  },
});

export default BoardSettingsDropdown;
