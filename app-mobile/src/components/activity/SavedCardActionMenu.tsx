/**
 * Issue #4265 — long-press menu on a saved card: Share, Schedule, Remove.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon, type IconName } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

const L = glass.likes;
const SNAP_POINTS = ["38%"];
const BACKGROUND_STYLE = {
  backgroundColor: L.sheet.bg,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

interface SavedCardActionMenuProps {
  visible: boolean;
  title: string;
  /** Hidden when the card can't be scheduled (already booked, ended). */
  canSchedule: boolean;
  onShare: () => void;
  onSchedule: () => void;
  onRemove: () => void;
  onClose: () => void;
  /** Fires once the native modal is fully gone — safe to present the next one. */
  onDismissed?: () => void;
}

export default function SavedCardActionMenu({
  visible,
  title,
  canSchedule,
  onShare,
  onSchedule,
  onRemove,
  onClose,
  onDismissed,
}: SavedCardActionMenuProps): React.ReactElement {
  const { t } = useTranslation(["activity", "common"]);
  const rows: Array<{ key: string; icon: IconName; label: string; onPress: () => void; danger?: boolean }> = [
    { key: "share", icon: "share-outline", label: t("activity:savedTab.menuShare"), onPress: onShare },
    ...(canSchedule
      ? [{ key: "schedule", icon: "calendar" as IconName, label: t("activity:savedTab.schedule"), onPress: onSchedule }]
      : []),
    { key: "remove", icon: "heart", label: t("activity:savedTab.menuRemove"), onPress: onRemove, danger: true },
  ];

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      onNativeDismiss={onDismissed}
      theme="dark"
      snapPoints={SNAP_POINTS}
      wrapInRNModal
      backgroundStyle={BACKGROUND_STYLE}
      accessibilityLabel={title}
      scrollMode="scroll"
    >
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {rows.map((row) => (
          <Pressable
            key={row.key}
            onPress={() => {
              HapticFeedback.light();
              row.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={row.label}
          >
            <Icon name={row.icon} size={18} color={row.danger ? L.accent : L.textPrimary} />
            <Text style={[styles.rowText, row.danger && styles.rowTextAccent]}>{row.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.row, styles.cancelRow, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>{t("common:cancel")}</Text>
        </Pressable>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  title: {
    color: L.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: {
    color: L.textPrimary,
    fontSize: 16,
    fontWeight: "500",
  },
  rowTextAccent: {
    color: L.accent,
  },
  cancelRow: {
    justifyContent: "center",
  },
  cancelText: {
    color: L.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.75,
  },
});
