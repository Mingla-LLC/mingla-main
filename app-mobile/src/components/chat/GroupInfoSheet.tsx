/**
 * Issue #4114 Wave 3: group info for a group chat that has no collab session.
 * Its ⋯ used to be a dead tap (BoardSettingsDropdown needs a session id and the
 * 1:1 menu is direct-only). Session groups keep BoardSettingsDropdown, which
 * already owns name, members, add people, mute and leave for them.
 *
 * Here: Add people and Share group link (issue #4261), the GROUP LINK card,
 * the members (tap to open a profile), Photos/videos/cards, Mute (this
 * member's conversation_participants.notifications_muted) and Leave
 * (leave_group_conversation, after a confirm). Add people opens
 * AddGroupPeopleSheet (add_group_members); this sheet steps aside while it is
 * up (iOS presents one RN Modal at a time) and comes back on Back.
 */
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { chatTokens } from "../../constants/chatTokens";
import { messagingService } from "../../services/messagingService";
import { useShareGroupLink } from "../../hooks/useGroupLink";
import { GroupLinkSection } from "./GroupLinkSection";
import { AddGroupPeopleSheet } from "./AddGroupPeopleSheet";

const GROUP_INFO_SNAP = ["70%"];

interface GroupInfoMember {
  id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
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
}

function memberLabel(member: GroupInfoMember): string {
  return (member.name || member.username || "?").trim();
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
}: GroupInfoSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const [muted, setMuted] = useState(initiallyMuted);
  const [muteBusy, setMuteBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // #4261: Add people steps this sheet aside (one RN Modal at a time on iOS).
  const [addingPeople, setAddingPeople] = useState(false);
  const { share: shareGroupLink, busy: sharingLink } = useShareGroupLink(managed ? null : conversationId, name);

  useEffect(() => {
    if (!visible) setAddingPeople(false);
  }, [visible]);

  useEffect(() => {
    setMuted(initiallyMuted);
  }, [initiallyMuted]);

  const toggleMute = async (next: boolean) => {
    if (!conversationId || !currentUserId || muteBusy) return;
    setMuteBusy(true);
    setMuted(next);
    const { error } = await messagingService.setConversationMuted(conversationId, currentUserId, next);
    setMuteBusy(false);
    if (error) {
      setMuted(!next);
      onError(t("chat:muteFailed"));
    }
  };

  const confirmLeave = () => {
    if (!conversationId || !currentUserId || leaving) return;
    Alert.alert(t("chat:leaveGroupTitle"), t("chat:leaveGroupBody", { name }), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("chat:leaveGroup"),
        style: "destructive",
        onPress: async () => {
          setLeaving(true);
          const { error } = await messagingService.leaveGroupConversation(conversationId, currentUserId);
          setLeaving(false);
          if (error) {
            onError(t("chat:leaveGroupFailed"));
            return;
          }
          onClose();
          onLeft();
        },
      },
    ]);
  };

  return (
    <>
    <BaseBottomSheet
      visible={visible && !addingPeople}
      onClose={onClose}
      snapPoints={GROUP_INFO_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      accessibilityLabel={t("chat:groupInfo")}
      header={
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.subtitle}>{managed ? t("chat:programTeamSubtitle") : t("chat:peopleInChat", { count: members.length })}</Text>
        </View>
      }
    >
      <View style={styles.body} testID="group-info-sheet">
        {!managed && conversationId ? (
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
            <View style={styles.linkSection}>
              <GroupLinkSection conversationId={conversationId} groupName={name} showShareButton={false} />
            </View>
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

        {!managed ? <Text style={styles.sectionHeading} accessibilityRole="header">
          {t("chat:groupMembers")}
        </Text> : null}
        {!managed ? members.map((member) => {
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
        {!managed ? <TouchableOpacity
          style={styles.row}
          onPress={confirmLeave}
          disabled={leaving}
          accessibilityRole="button"
          accessibilityLabel={t("chat:leaveGroup")}
        >
          <Icon name="exit-outline" size={20} color={chatTokens.danger} style={styles.rowIcon} />
          <Text style={[styles.rowText, styles.danger]}>{t("chat:leaveGroup")}</Text>
        </TouchableOpacity> : null}
      </View>
    </BaseBottomSheet>
    {!managed && conversationId ? (
      <AddGroupPeopleSheet
        visible={visible && addingPeople}
        conversationId={conversationId}
        memberIds={members.map((member) => member.id)}
        onBack={() => setAddingPeople(false)}
        onShareLink={() => void shareGroupLink()}
        sharing={sharingLink}
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
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
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
    flex: 1,
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
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
});
