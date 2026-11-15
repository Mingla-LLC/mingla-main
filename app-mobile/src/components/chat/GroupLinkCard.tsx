/**
 * Issue #4435 (design v4, flows 1 and 2): the group link card. The link, then
 * Share / Copy / QR; with `withSettings`, admins get one quiet row (Approve new
 * joiners and Reset) and everyone else a line saying only admins change link
 * settings. Reuses the #4261 link hooks (useGroupLink, useResetGroupLink,
 * useSetGroupLinkApproval) and the share-token link (useResolveGroupInviteLink).
 * The QR opens in place inside the card (no second modal over the sheet).
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Clipboard, Pressable, Share, StyleSheet, Switch, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";
import { chatTokens } from "../../constants/chatTokens";
import { groupLinkDisplay } from "../../utils/friendShareLink";
import {
  useGroupLink,
  useResetGroupLink,
  useResolveGroupInviteLink,
  useSetGroupLinkApproval,
} from "../../hooks/useGroupLink";

interface GroupLinkCardProps {
  conversationId: string;
  groupName: string;
  /** Add people shows the approval / reset row; the "is live" sheet does not. */
  withSettings: boolean;
}

export function GroupLinkCard({ conversationId, groupName, withSettings }: GroupLinkCardProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const link = useGroupLink(conversationId);
  const reset = useResetGroupLink(conversationId);
  const approval = useSetGroupLinkApproval(conversationId);
  const resolveLink = useResolveGroupInviteLink(conversationId);
  const [busy, setBusy] = useState<"share" | "copy" | "qr" | null>(null);
  const [qrLink, setQrLink] = useState<string | null>(null);
  const info = link.data;
  const canManage = info?.canManage === true;

  const withLink = useCallback(
    async (kind: "share" | "copy" | "qr", use: (url: string) => Promise<void> | void) => {
      if (busy) return;
      setBusy(kind);
      const url = await resolveLink();
      setBusy(null);
      if (!url) {
        toastManager.error(t("chat:group_link_failed"));
        return;
      }
      try {
        await use(url);
      } catch (error) {
        console.warn("[GroupLinkCard] link action failed:", error);
        toastManager.error(t("chat:group_link_failed"));
      }
    },
    [busy, resolveLink, t],
  );

  const onShare = () =>
    void withLink("share", async (url) => {
      // SHARE-NON-CONTENT:invite
      await Share.share({ message: t("chat:group_link_share_message", { name: groupName, link: url }) });
    });
  const onCopy = () =>
    void withLink("copy", (url) => {
      Clipboard.setString(url);
      toastManager.success(t("chat:linkCopied"));
    });
  const onQr = () => {
    if (qrLink) {
      setQrLink(null);
      return;
    }
    void withLink("qr", (url) => setQrLink(url));
  };

  const confirmReset = () => {
    if (!canManage || reset.isPending) return;
    Alert.alert(t("chat:group_link_reset_title"), t("chat:group_link_reset_confirm"), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("chat:group_link_reset"),
        style: "destructive",
        onPress: () =>
          reset.mutate(undefined, {
            onSuccess: () => {
              setQrLink(null);
              toastManager.success(t("chat:group_link_reset_toast"));
            },
          }),
      },
    ]);
  };

  return (
    <View style={styles.card} testID="group-link-card">
      <View style={styles.top}>
        <View style={styles.tile}>
          <Icon name="link-outline" size={20} color={chatTokens.tagDeck} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>{t("chat:group_link_title")}</Text>
          {link.isLoading ? (
            <ActivityIndicator size="small" color={chatTokens.textSoft} style={styles.loading} />
          ) : link.isError || !info ? (
            <Pressable onPress={() => void link.refetch()} accessibilityRole="button" accessibilityLabel={t("common:retry")}>
              <Text style={styles.retryText}>{t("chat:group_link_failed_retry")}</Text>
            </Pressable>
          ) : (
            <Text style={styles.url} numberOfLines={1} selectable>
              {groupLinkDisplay(info.token) ?? ""}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        <LinkButton primary icon="share-outline" label={t("chat:group_link_share_short")} busy={busy === "share"} onPress={onShare} />
        <LinkButton icon="copy-outline" label={t("chat:group_link_copy")} busy={busy === "copy"} onPress={onCopy} />
        <LinkButton icon="qr-code-outline" label={t("chat:group_link_qr")} busy={busy === "qr"} onPress={onQr} />
      </View>

      {qrLink ? (
        <View style={styles.qrBox} accessible accessibilityRole="image" accessibilityLabel={t("chat:group_link_qr_a11y", { name: groupName })}>
          <QRCode value={qrLink} size={168} backgroundColor="#FFFFFF" color="#111111" />
        </View>
      ) : null}

      {withSettings ? (
        canManage ? (
          <View style={styles.settings}>
            <View style={styles.flex}>
              <Text style={styles.settingTitle}>{t("chat:group_link_approve_title")}</Text>
              <Text style={styles.settingSub}>{t("chat:group_link_approve_sub")}</Text>
            </View>
            <Switch
              value={info?.requireApproval ?? true}
              onValueChange={(next) => approval.mutate(next)}
              disabled={approval.isPending || !info}
              trackColor={{ true: chatTokens.accent, false: chatTokens.planCant }}
              accessibilityLabel={t("chat:group_link_approve_title")}
            />
            <Pressable
              onPress={confirmReset}
              disabled={reset.isPending}
              accessibilityRole="button"
              accessibilityLabel={t("chat:group_link_reset")}
              accessibilityState={{ busy: reset.isPending }}
              style={({ pressed }) => [styles.resetButton, pressed ? styles.pressed : null]}
            >
              {reset.isPending ? (
                <ActivityIndicator size="small" color={chatTokens.textPrimary} />
              ) : (
                <Text style={styles.resetText}>{t("chat:group_link_reset_short")}</Text>
              )}
            </Pressable>
          </View>
        ) : info ? (
          <View style={styles.note}>
            <Icon name="shield-checkmark-outline" size={14} color={chatTokens.textSoft} />
            <Text style={styles.noteText}>
              {info.requireApproval ? t("chat:group_link_member_note_on") : t("chat:group_link_member_note_off")}
            </Text>
          </View>
        ) : null
      ) : null}
    </View>
  );
}

function LinkButton({
  icon,
  label,
  busy,
  onPress,
  primary = false,
}: {
  icon: string;
  label: string;
  busy: boolean;
  onPress: () => void;
  primary?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : null,
        primary ? styles.buttonWide : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={chatTokens.textPrimary} />
      ) : (
        <>
          <Icon name={icon} size={16} color={chatTokens.textPrimary} />
          <Text style={styles.buttonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    padding: 12,
    gap: 10,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: chatTokens.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  url: {
    fontSize: 13,
    color: chatTokens.textSecondary,
  },
  loading: {
    alignSelf: "flex-start",
  },
  retryText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.tagChat,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.strip,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  buttonPrimary: {
    borderColor: chatTokens.accent,
    backgroundColor: chatTokens.accent,
  },
  buttonWide: {
    flex: 1.4,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  qrBox: {
    alignSelf: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  settings: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.hairline,
    paddingTop: 10,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  settingSub: {
    fontSize: 12,
    color: chatTokens.textSoft,
  },
  resetButton: {
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.strip,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.hairline,
    paddingTop: 10,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: chatTokens.textSoft,
  },
  pressed: {
    opacity: 0.6,
  },
});
