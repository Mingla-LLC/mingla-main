/**
 * Issue #4261 Wave B1 — the GROUP LINK card in group info (prototype
 * Main.dc.html, "isInfo"): the link, what it does, "Approve new joiners",
 * Reset link (admin), and Share group link.
 *
 * Anyone in the chat sees the card and can share; only the group admin
 * (`canManage`) can flip approval or reset. The share carries MY personal
 * token so whoever joins is connected to me (useShareGroupLink).
 */
import React, { useCallback } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { groupLinkDisplay } from "../../utils/friendShareLink";
import {
  useGroupLink,
  useResetGroupLink,
  useSetGroupLinkApproval,
  useShareGroupLink,
} from "../../hooks/useGroupLink";

interface GroupLinkSectionProps {
  conversationId: string;
  groupName: string;
  /** Group info shows Share as a top tile instead (default: shown here). */
  showShareButton?: boolean;
}

export function GroupLinkSection({
  conversationId,
  groupName,
  showShareButton = true,
}: GroupLinkSectionProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const link = useGroupLink(conversationId);
  const reset = useResetGroupLink(conversationId);
  const approval = useSetGroupLinkApproval(conversationId);
  const { share, busy: sharing } = useShareGroupLink(conversationId, groupName);

  const info = link.data;
  const canManage = info?.canManage === true;

  const confirmReset = useCallback(() => {
    if (!canManage || reset.isPending) return;
    Alert.alert(t("chat:group_link_reset"), t("chat:group_link_reset_confirm"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("chat:group_link_reset"), style: "destructive", onPress: () => reset.mutate() },
    ]);
  }, [canManage, reset, t]);

  return (
    <View style={styles.card} testID="group-link-section">
      <Text style={styles.label} accessibilityRole="header">
        {t("chat:group_link_label")}
      </Text>

      {link.isLoading ? (
        <ActivityIndicator color={chatTokens.tagChat} style={styles.loading} />
      ) : link.isError || !info ? (
        <Pressable
          onPress={() => void link.refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("common:retry")}
          style={styles.retry}
        >
          <Icon name="refresh-outline" size={16} color={chatTokens.tagChat} />
          <Text style={styles.retryText}>{t("common:retry")}</Text>
        </Pressable>
      ) : (
        <Text style={styles.link} numberOfLines={1} selectable>
          {groupLinkDisplay(info.token) ?? ""}
        </Text>
      )}

      <Text style={styles.explainer}>{t("chat:group_link_explainer")}</Text>

      <View style={styles.approveRow}>
        <View style={styles.flex}>
          <Text style={styles.approveTitle}>{t("chat:group_link_approve_title")}</Text>
          <Text style={styles.approveSub}>{t("chat:group_link_approve_sub")}</Text>
        </View>
        <Switch
          value={info?.requireApproval ?? true}
          onValueChange={(next) => approval.mutate(next)}
          disabled={!canManage || approval.isPending}
          trackColor={{ true: chatTokens.accent, false: chatTokens.surface }}
          accessibilityLabel={t("chat:group_link_approve_title")}
          accessibilityHint={canManage ? undefined : t("chat:group_link_admin_only_hint")}
        />
      </View>

      {canManage ? (
        <Pressable
          onPress={confirmReset}
          disabled={reset.isPending}
          accessibilityRole="button"
          accessibilityLabel={t("chat:group_link_reset")}
          accessibilityState={{ busy: reset.isPending }}
          style={({ pressed }) => [styles.resetButton, pressed || reset.isPending ? styles.pressed : null]}
        >
          {reset.isPending ? (
            <ActivityIndicator size="small" color={chatTokens.danger} />
          ) : (
            <Text style={styles.resetText}>{t("chat:group_link_reset")}</Text>
          )}
        </Pressable>
      ) : null}

      {showShareButton ? (
        <Pressable
          onPress={() => void share()}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel={t("chat:group_link_share")}
          accessibilityState={{ busy: sharing }}
          style={({ pressed }) => [styles.shareTile, pressed || sharing ? styles.pressed : null]}
        >
          {sharing ? (
            <ActivityIndicator color={chatTokens.tagChat} />
          ) : (
            <Icon name="link-outline" size={22} color={chatTokens.tagChat} />
          )}
          <Text style={styles.shareText}>{t("chat:group_link_share")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: chatTokens.surfaceRaised,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: chatTokens.textSoft,
  },
  loading: {
    alignSelf: "flex-start",
    minHeight: 20,
  },
  link: {
    fontSize: 15,
    color: chatTokens.tagChat,
  },
  retry: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.tagChat,
  },
  explainer: {
    fontSize: 12,
    lineHeight: 17,
    color: chatTokens.textSoft,
  },
  approveRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  approveTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  approveSub: {
    fontSize: 12,
    color: chatTokens.textSoft,
  },
  resetButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: chatTokens.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.danger,
  },
  shareTile: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  shareText: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  pressed: {
    opacity: 0.6,
  },
});
