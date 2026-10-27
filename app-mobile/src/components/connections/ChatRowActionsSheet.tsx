/**
 * Issue #4114 Wave 2a — the long-press menu for a chat row.
 *
 * The same actions as the swipes (pin, mark unread, mute, archive) plus the
 * row's remove / leave. A sheet rather than an Alert because Android's Alert
 * shows at most three buttons.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

const tk = glass.discover.chatList;
const SNAP_POINTS = ["52%"];

export interface ChatRowAction {
  key: string;
  icon: string;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

interface ChatRowActionsSheetProps {
  visible: boolean;
  title: string;
  actions: ChatRowAction[];
  onClose: () => void;
}

export function ChatRowActionsSheet({
  visible,
  title,
  actions,
  onClose,
}: ChatRowActionsSheetProps): React.ReactElement {
  const { t } = useTranslation(["connections"]);
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      theme="dark"
      scrollMode="view"
      wrapInRNModal
      accessibilityLabel={t("connections:actions_more")}
    >
      <View style={styles.sheet}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={() => {
              HapticFeedback.light();
              action.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <Icon name={action.icon} size={20} color={action.destructive ? tk.destructive : tk.ink} />
            <Text style={[styles.label, action.destructive ? styles.destructive : null]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  title: {
    color: tk.faint,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 10,
  },
  row: {
    height: 52,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
  },
  rowPressed: {
    backgroundColor: tk.rowPressed,
  },
  label: {
    color: tk.ink,
    fontSize: 16,
    fontWeight: "500",
  },
  destructive: {
    color: tk.destructive,
  },
});
