import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { colors, fontWeights } from "../../constants/designSystem";
import { s } from "../../utils/responsive";

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
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

export function PendingSessionInviteRow({
  invite,
  onAccept,
  onDecline,
  isProcessing,
}: PendingSessionInviteRowProps) {
  const { t } = useTranslation(["social", "common"]);

  return (
    <View style={styles.row} accessibilityRole="none">
      {invite.inviterAvatarUrl ? (
        <Image source={{ uri: invite.inviterAvatarUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarText}>{getInitials(invite.inviterDisplayName)}</Text>
        </View>
      )}

      <View style={styles.textWrap}>
        <Text style={styles.name} numberOfLines={1}>
          {invite.inviterDisplayName}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {t("social:pendingInviteRowSubtitle", { name: invite.inviterDisplayName })}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => onAccept(invite.sessionId, invite.inviteId)}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel={`${t("social:pendingInviteAccept")} from ${invite.inviterDisplayName}`}
          style={({ pressed }) => [
            styles.acceptButton,
            isProcessing ? styles.disabled : null,
            pressed && !isProcessing ? styles.pressed : null,
          ]}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.acceptText}>{t("social:pendingInviteAccept")}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => onDecline(invite.sessionId, invite.inviteId)}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel={`${t("social:pendingInviteDecline")} invite from ${invite.inviterDisplayName}`}
          style={({ pressed }) => [
            styles.declineButton,
            isProcessing ? styles.disabled : null,
            pressed && !isProcessing ? styles.pressed : null,
          ]}
        >
          <Text style={styles.declineText}>{t("social:pendingInviteDecline")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: s(100),
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: s(10),
    marginVertical: s(4),
    borderRadius: s(18),
    paddingHorizontal: s(14),
    paddingVertical: s(18),
    backgroundColor: "rgba(255, 255, 255, 0.075)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    gap: s(14),
  },
  avatar: {
    width: s(50),
    height: s(50),
    borderRadius: s(25),
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  avatarFallback: {
    width: s(50),
    height: s(50),
    borderRadius: s(25),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: s(14),
    fontWeight: fontWeights.bold,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: "#FFFFFF",
    fontSize: s(16),
    fontWeight: fontWeights.bold,
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.64)",
    fontSize: s(15),
    lineHeight: s(20),
    marginTop: s(6),
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  acceptButton: {
    minWidth: s(76),
    height: s(40),
    borderRadius: s(20),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: s(12),
    backgroundColor: colors.accent,
  },
  acceptText: {
    color: "#FFFFFF",
    fontSize: s(13),
    fontWeight: fontWeights.bold,
  },
  declineButton: {
    height: s(40),
    borderRadius: s(20),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: s(12),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
  },
  declineText: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: s(13),
    fontWeight: fontWeights.semibold,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
});
