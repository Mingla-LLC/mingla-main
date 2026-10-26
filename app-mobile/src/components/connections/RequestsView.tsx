/**
 * Issue #4114 Wave 2b — the friends sheet's Requests tab (dark, design v6/v7).
 *
 * Received: a request sent through "Add a friend" (a friend request carrying a
 * hidden pair request) is ONE row with ONE Accept; plain friend requests;
 * pair-only requests from existing friends in gold.
 * Sent: friend requests, pair requests and phone invites (which used to be
 * built and never shown). Every Cancel asks once.
 */
import React, { useCallback } from "react";
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { glass } from "../../constants/designSystem";
import { COUNTRIES } from "../../constants/countries";
import { ChatAvatar } from "./ChatAvatar";
import { maskPhone, type ReceivedRow, type SentRow } from "./friendsSheetModel";

const ink = glass.discover.chatList;
const fs = glass.discover.friendsSheet;
const DIAL_CODES = COUNTRIES.map((country) => country.dialCode);

interface RequestsViewProps {
  received: ReceivedRow[];
  sent: SentRow[];
  loading: boolean;
  /** The row key whose action is in flight (disables its buttons). */
  busyKey: string | null;
  onAccept: (row: ReceivedRow) => void;
  onDecline: (row: ReceivedRow) => void;
  /** Called only after the person confirmed. */
  onCancelSent: (row: SentRow) => void;
}

function useTimeAgo(): (iso: string) => string {
  const { t } = useTranslation(["connections"]);
  return (iso) => {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    if (!Number.isFinite(minutes) || minutes < 60 * 24) {
      if (minutes < 60) return minutes < 1 ? t("connections:fs_time_today") : t("connections:fs_time_minutes", { count: minutes });
      return t("connections:fs_time_hours", { count: Math.floor(minutes / 60) });
    }
    return t("connections:fs_time_days", { count: Math.floor(minutes / (60 * 24)) });
  };
}

export function RequestsView({
  received,
  sent,
  loading,
  busyKey,
  onAccept,
  onDecline,
  onCancelSent,
}: RequestsViewProps): React.ReactElement {
  const { t } = useTranslation(["connections", "common"]);
  const timeAgo = useTimeAgo();

  // Issue #4114 QA: the share sheet for an invite whose text did not go out
  // (same message and link as Add a friend's "Share an invite").
  const shareInvite = useCallback(async (): Promise<void> => {
    try {
      // SHARE-NON-CONTENT:invite
      await Share.share({
        message: t("connections:af_share_message", { link: "https://go.usemingla.com/w36m" }),
      });
    } catch (error: unknown) {
      console.warn("[RequestsView] share failed:", error);
    }
  }, [t]);

  const confirmCancel = useCallback(
    (row: SentRow) => {
      const isInvite = row.kind === "phone_invite";
      const label = isInvite ? maskPhone(row.phoneE164, DIAL_CODES) : row.name;
      Alert.alert(
        isInvite ? t("connections:fs_cancel_invite_title") : t("connections:fs_cancel_request_title"),
        isInvite
          ? t("connections:fs_cancel_invite_body", { phone: label })
          : t("connections:fs_cancel_request_body", { name: label }),
        [
          { text: t("connections:fs_keep"), style: "cancel" },
          { text: t("connections:fs_cancel_confirm"), style: "destructive", onPress: () => onCancelSent(row) },
        ],
      );
    },
    [onCancelSent, t],
  );

  if (loading && received.length === 0 && sent.length === 0) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={ink.accent} />
      </View>
    );
  }
  if (received.length === 0 && sent.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t("connections:fs_empty_requests")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {received.length > 0 ? <Text style={styles.label}>{t("connections:fs_received")}</Text> : null}
      {received.map((row) => {
        const busy = busyKey === row.key;
        const gold = row.kind !== "friend";
        const sub =
          row.kind === "friend_pair"
            ? row.invitedByText
              ? t("connections:fs_req_friend_pair_text")
              : t("connections:fs_req_friend_pair", { time: timeAgo(row.createdAt) })
            : row.kind === "pair"
              ? t("connections:fs_req_wants_pair")
              : t("connections:fs_req_friend", { time: timeAgo(row.createdAt) });
        const acceptLabel = row.kind === "pair" ? t("connections:fs_pair_button") : t("connections:fs_accept");
        const declineLabel = row.kind === "pair" ? t("connections:fs_not_now") : t("connections:fs_delete");
        return (
          <View key={row.key} style={styles.row}>
            <ChatAvatar people={[{ id: row.senderId, name: row.name, avatarUrl: row.avatarUrl }]} shape="circle" label={row.name} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{row.name}</Text>
              <Text style={[styles.rowSub, gold ? styles.gold : null]} numberOfLines={1}>{sub}</Text>
            </View>
            <Pressable
              onPress={() => onDecline(row)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${declineLabel} ${row.name}`}
              style={[styles.button, styles.ghost, busy ? styles.dim : null]}
            >
              <Text style={styles.buttonText}>{declineLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => onAccept(row)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${acceptLabel} ${row.name}`}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.button, busy ? styles.dim : null]}
            >
              {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.buttonText}>{acceptLabel}</Text>}
            </Pressable>
          </View>
        );
      })}

      {sent.length > 0 ? <Text style={styles.label}>{t("connections:fs_sent")}</Text> : null}
      {sent.map((row) => {
        const busy = busyKey === row.key;
        if (row.kind === "phone_invite") {
          const masked = maskPhone(row.phoneE164, DIAL_CODES);
          return (
            <View key={row.key} style={styles.row}>
              <View style={styles.hashAvatar}>
                <Text style={styles.hash}>#</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{masked}</Text>
                {row.smsFailed ? (
                  // Issue #4114 QA: the text never went out — say so and offer Share.
                  <View style={styles.notTextedLine}>
                    <Text style={[styles.rowSub, styles.notTexted]} numberOfLines={1}>
                      {t("connections:fs_sent_invite_not_texted")} ·{" "}
                    </Text>
                    <Pressable
                      onPress={() => void shareInvite()}
                      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("connections:af_share")} ${masked}`}
                    >
                      <Text style={[styles.rowSub, styles.shareLink]}>{t("connections:af_share")}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.rowSub} numberOfLines={1}>{t("connections:fs_sent_invite")}</Text>
                )}
              </View>
              <CancelButton busy={busy} label={`${t("connections:fs_cancel")} ${masked}`} onPress={() => confirmCancel(row)} />
            </View>
          );
        }
        const sub =
          row.kind === "friend_request"
            ? t("connections:fs_sent_friend", { time: timeAgo(row.createdAt) })
            : row.kind === "friend_pair_request"
              ? t("connections:fs_sent_friend_pair")
              : t("connections:fs_sent_pair");
        return (
          <View key={row.key} style={styles.row}>
            <ChatAvatar people={[{ id: row.key, name: row.name, avatarUrl: row.avatarUrl }]} shape="circle" label={row.name} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{row.name}</Text>
              <Text style={[styles.rowSub, row.kind === "friend_request" ? null : styles.gold]} numberOfLines={1}>{sub}</Text>
            </View>
            <CancelButton busy={busy} label={`${t("connections:fs_cancel")} ${row.name}`} onPress={() => confirmCancel(row)} />
          </View>
        );
      })}
    </View>
  );
}

function CancelButton({ busy, label, onPress }: { busy: boolean; label: string; onPress: () => void }): React.ReactElement {
  const { t } = useTranslation(["connections"]);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      style={[styles.button, styles.ghost, busy ? styles.dim : null]}
    >
      {busy ? <ActivityIndicator color={ink.ink} size="small" /> : <Text style={styles.buttonText}>{t("connections:fs_cancel")}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingBottom: 32,
  },
  label: {
    color: ink.faint,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingTop: 12,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 2,
  },
  rowTitle: {
    color: ink.ink,
    fontSize: 15.5,
    fontWeight: "600",
  },
  rowSub: {
    color: ink.faint,
    fontSize: 12.5,
    marginTop: 1,
  },
  gold: {
    color: fs.goldLabel,
  },
  notTextedLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  notTexted: {
    color: ink.dim,
    flexShrink: 1,
  },
  shareLink: {
    color: ink.accent,
    fontWeight: "600",
  },
  button: {
    minHeight: 32,
    minWidth: 56,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: ink.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  ghost: {
    backgroundColor: fs.ghostButtonBg,
  },
  dim: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  hashAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: fs.fieldBg,
    alignItems: "center",
    justifyContent: "center",
  },
  hash: {
    color: ink.dim,
    fontSize: 16,
    fontWeight: "700",
  },
  empty: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  emptyText: {
    color: ink.dim,
    fontSize: 14,
    textAlign: "center",
  },
});
