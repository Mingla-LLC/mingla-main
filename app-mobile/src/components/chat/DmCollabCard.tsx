/**
 * Issue #4114 Wave 5 — the collab rows inside a 1:1 chat (design "Collab from
 * a 1:1 chat").
 *
 *  - The starter sees "You started a collab" with Set my vibes.
 *  - The friend sees "{name} started a collab with you" with Join and Not now
 *    (decision D3: the friend must tap Join).
 *  - Joined / ended rows, and a started row whose collab is over, are a plain
 *    centred line like every other system row.
 *
 * The view comes from dmCollabCardView (pure, Deno-tested); this file is only
 * the drawing.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import type { DmCollabCardView, DmCollabEventPayload } from "./dmCollabModel";

export interface DmCollabCardProps {
  payload: DmCollabEventPayload;
  view: DmCollabCardView;
  /** The other person's first name. */
  friendName: string;
  currentUserId: string | null;
  busy?: "join" | "decline" | null;
  onSetVibes?: () => void;
  onJoin?: () => void;
  onDecline?: () => void;
}

function noticeText(
  payload: DmCollabEventPayload,
  friendName: string,
  currentUserId: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const byMe = Boolean(currentUserId) && payload.user_id === currentUserId;
  switch (payload.event) {
    case "started":
      return byMe ? t("chat:dmCollabYouStarted") : t("chat:dmCollabFriendStartedNotice", { name: friendName });
    case "joined":
      return byMe ? t("chat:dmCollabYouJoined") : t("chat:dmCollabFriendJoined", { name: friendName });
    case "ended":
      return t("chat:dmCollabEnded");
    default: {
      const never: never = payload.event;
      return never;
    }
  }
}

export function DmCollabCard({
  payload,
  view,
  friendName,
  currentUserId,
  busy = null,
  onSetVibes,
  onJoin,
  onDecline,
}: DmCollabCardProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);

  if (view.kind === "notice") {
    return (
      <View style={styles.noticeRow} testID="dm-collab-notice">
        <Text style={styles.noticeText}>{noticeText(payload, friendName, currentUserId, t)}</Text>
      </View>
    );
  }

  const isStarter = view.kind === "starter";
  return (
    <View style={styles.cardRow}>
      <View style={styles.card} testID={isStarter ? "dm-collab-card-starter" : "dm-collab-card-invitee"}>
        <View style={styles.titleRow}>
          <View style={styles.deckBadge}>
            <Icon name="albums-outline" size={14} color={chatTokens.accent} />
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {isStarter ? t("chat:dmCollabYouStarted") : t("chat:dmCollabFriendStarted", { name: friendName })}
          </Text>
        </View>
        <Text style={styles.body}>
          {isStarter ? t("chat:dmCollabStarterBody") : t("chat:dmCollabInviteeBody")}
        </Text>
        {isStarter ? (
          <Pressable
            onPress={onSetVibes}
            disabled={!onSetVibes}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t("chat:dmCollabSetVibes")}
            testID="dm-collab-set-vibes"
          >
            <Text style={styles.secondaryButtonText}>{t("chat:dmCollabSetVibes")}</Text>
          </Pressable>
        ) : (
          <View style={styles.actions}>
            <Pressable
              onPress={onJoin}
              disabled={!onJoin || busy !== null}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy !== null && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={t("chat:dmCollabJoin")}
              accessibilityState={{ busy: busy === "join", disabled: busy !== null }}
              testID="dm-collab-join"
            >
              {busy === "join" ? (
                <ActivityIndicator size="small" color={chatTokens.textPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>{t("chat:dmCollabJoin")}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={onDecline}
              disabled={!onDecline || busy !== null}
              style={({ pressed }) => [styles.secondaryButton, styles.flexButton, pressed && styles.pressed, busy !== null && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={t("chat:dmCollabNotNow")}
              accessibilityState={{ busy: busy === "decline", disabled: busy !== null }}
              testID="dm-collab-not-now"
            >
              {busy === "decline" ? (
                <ActivityIndicator size="small" color={chatTokens.textSecondary} />
              ) : (
                <Text style={styles.secondaryButtonText}>{t("chat:dmCollabNotNow")}</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  noticeRow: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  noticeText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: chatTokens.textMuted,
    textAlign: "center",
  },
  cardRow: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.hairline,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deckBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.accentSoft,
  },
  title: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: chatTokens.textSecondary,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  primaryButton: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.accent,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  secondaryButton: {
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 2,
    backgroundColor: chatTokens.strip,
  },
  flexButton: {
    flex: 1,
    marginTop: 0,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.6,
  },
});
