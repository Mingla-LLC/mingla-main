/**
 * Issue #4114 Wave 2a — a pending group invite in the Chats list.
 *
 * One 72pt row under the "Invites" section label, with a Join button. Decline
 * lives in the row's long-press menu (and the screen reader's actions), so the
 * row is one tap to join and never a second big button.
 */
import React from "react";
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { glass } from "../../constants/designSystem";
import { ChatAvatar } from "./ChatAvatar";
import {
  CHAT_ROW_GAP,
  CHAT_ROW_HEIGHT,
  CHAT_ROW_SIDE_PADDING,
  CHAT_SEPARATOR_INSET,
} from "./chatListModel";

const tk = glass.discover.chatList;

export type PendingSessionInvite = {
  sessionId: string;
  inviteId: string;
  inviterDisplayName: string;
  inviterAvatarUrl: string | null;
  createdAt: string;
};

interface PendingSessionInviteRowProps {
  invite: PendingSessionInvite;
  onAccept: (sessionId: string, inviteId: string) => Promise<void>;
  onDecline: (sessionId: string, inviteId: string) => Promise<void>;
  isProcessing: boolean;
  showSeparator?: boolean;
}

export function PendingSessionInviteRow({
  invite,
  onAccept,
  onDecline,
  isProcessing,
  showSeparator = false,
}: PendingSessionInviteRowProps): React.ReactElement {
  const { t } = useTranslation(["social", "connections", "common"]);
  const name = invite.inviterDisplayName;

  const confirmDecline = (): void => {
    if (isProcessing) return;
    Alert.alert(name, t("social:pendingInviteRowSubtitle", { name }), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("social:pendingInviteDecline"),
        style: "destructive",
        onPress: () => void onDecline(invite.sessionId, invite.inviteId),
      },
    ]);
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent): void => {
    if (event.nativeEvent.actionName === "decline") confirmDecline();
  };

  return (
    <Pressable
      onLongPress={confirmDecline}
      delayLongPress={350}
      accessibilityLabel={`${name}, ${t("social:pendingInviteRowSubtitle", { name })}`}
      accessibilityActions={[{ name: "decline", label: t("social:pendingInviteDecline") }]}
      onAccessibilityAction={onAccessibilityAction}
      style={styles.row}
    >
      {showSeparator ? <View style={styles.separator} /> : null}
      <ChatAvatar
        people={[{ id: invite.inviteId, name, avatarUrl: invite.inviterAvatarUrl }]}
        shape="circle"
        label={name}
      />
      <View style={styles.textWrap}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t("social:pendingInviteRowSubtitle", { name })}
        </Text>
      </View>
      <Pressable
        onPress={() => onAccept(invite.sessionId, invite.inviteId)}
        disabled={isProcessing}
        accessibilityRole="button"
        accessibilityLabel={t("connections:invite_join_a11y", { name })}
        accessibilityState={{ disabled: isProcessing, busy: isProcessing }}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={({ pressed }) => [
          styles.joinButton,
          isProcessing ? styles.disabled : null,
          pressed && !isProcessing ? styles.pressed : null,
        ]}
      >
        {isProcessing ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.joinText}>{t("connections:invite_join")}</Text>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: CHAT_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: CHAT_ROW_GAP,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    backgroundColor: glass.discover.screenBg,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: CHAT_SEPARATOR_INSET,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: tk.separator,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  name: {
    color: tk.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    color: tk.dim,
    fontSize: 14,
  },
  joinButton: {
    minWidth: 64,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    backgroundColor: tk.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  joinText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
});
