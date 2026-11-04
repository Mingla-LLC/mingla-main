/**
 * Issue #4265 — the "···" sheet for one Calendar plan (approved design:
 * Calendar.dc.html, "Plan actions"). The caller decides which actions a plan
 * has; this only renders them. A ticket / RSVP / reservation / stay also gets
 * the #4111 "Message {Brand}" control, which keeps its own fetch-then-open
 * behaviour and overlays.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon, type IconName } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

const L = glass.likes;
const SNAP_POINTS = ["44%"];
const BACKGROUND_STYLE = {
  backgroundColor: L.sheet.bg,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

export interface CalendarPlanAction {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
}

interface CalendarPlanActionSheetProps {
  visible: boolean;
  title: string;
  actions: CalendarPlanAction[];
  /** The #4111 "Message {Brand}" control, when the plan has a brand. */
  messageControl?: React.ReactNode;
  onClose: () => void;
  /** Fires once the native modal is fully gone — safe to present the next one. */
  onDismissed?: () => void;
}

export default function CalendarPlanActionSheet({
  visible,
  title,
  actions,
  messageControl,
  onClose,
  onDismissed,
}: CalendarPlanActionSheetProps): React.ReactElement {
  const { t } = useTranslation(["activity", "common"]);
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      onNativeDismiss={onDismissed}
      theme="dark"
      snapPoints={SNAP_POINTS}
      wrapInRNModal
      backgroundStyle={BACKGROUND_STYLE}
      accessibilityLabel={t("activity:calendarTab.actionsTitle")}
      scrollMode="scroll"
    >
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            disabled={action.busy}
            onPress={() => {
              HapticFeedback.light();
              action.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ busy: action.busy === true, disabled: action.busy === true }}
          >
            <Icon name={action.icon} size={18} color={action.danger ? L.calendar.removeText : L.textPrimary} />
            <Text style={[styles.rowText, action.danger && styles.rowTextDanger]}>{action.label}</Text>
          </Pressable>
        ))}
        {messageControl ? <View style={styles.message}>{messageControl}</View> : null}
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
    color: L.textPrimary,
    fontSize: 16,
    fontWeight: "700",
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
  rowTextDanger: {
    color: L.calendar.removeText,
  },
  message: {
    marginTop: 6,
    marginLeft: -16,
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
