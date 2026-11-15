/**
 * Issue #4435 (R30, design v4 flow 1): right after New group, over the new
 * chat, "{name} is live" with who is in and the group link card (Share, Copy,
 * QR). Done closes it; the chat stays open.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { GroupLinkCard } from "./GroupLinkCard";
import { chatTokens } from "../../constants/chatTokens";

const SNAP = ["58%"];

interface GroupLiveSheetProps {
  visible: boolean;
  conversationId: string | null;
  groupName: string;
  friendFirstNames: readonly string[];
  onClose: () => void;
}

export function GroupLiveSheet({
  visible,
  conversationId,
  groupName,
  friendFirstNames,
  onClose,
}: GroupLiveSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const insets = useSafeAreaInsets();
  const names = friendFirstNames.filter((n) => n.length > 0);
  return (
    <BaseBottomSheet
      visible={visible && Boolean(conversationId)}
      onClose={onClose}
      snapPoints={SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      accessibilityLabel={t("chat:group_live_title", { name: groupName })}
      header={
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {t("chat:group_live_title", { name: groupName })}
        </Text>
      }
      stickyFooter={
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common:done")}
            style={({ pressed }) => [styles.done, pressed ? styles.pressed : null]}
          >
            <Text style={styles.doneText}>{t("common:done")}</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.body} testID="group-live-sheet">
        <View style={styles.lead}>
          <View style={styles.check}>
            <Icon name="checkmark" size={22} color={chatTokens.success} />
          </View>
          <Text style={styles.leadText}>
            {names.length > 0
              ? t("chat:group_live_people", { names: names.join(", "), count: names.length })
              : t("chat:group_live_solo")}
          </Text>
        </View>
        {conversationId ? (
          <GroupLinkCard conversationId={conversationId} groupName={groupName} withSettings={false} />
        ) : null}
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  lead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  check: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(52, 211, 153, 0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  leadText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: chatTokens.textSecondary,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: chatTokens.surface,
  },
  done: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: {
    fontSize: 16,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  pressed: {
    opacity: 0.7,
  },
});
