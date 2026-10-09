/**
 * SimpleConfirmDialog — Modal + Pressable confirm without reanimated.
 *
 * Used on buyer-web public brand/event Follow flows so ConfirmDialog
 * (react-native-reanimated) is not shared into the eager `__common` chunk
 * when both PublicBrandPage and PublicEventPage need a confirm surface
 * (#3682 / ORCH-1083).
 */

import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { accent, radius, spacing, typography } from "../../constants/designSystem";

// Local ink on cream card — designSystem `text.*` tokens are on-dark rgba and
// would wash out on this light confirm surface.
const INK = "#16110D";
const INK_MUTED = "#6B635A";

export type SimpleConfirmDialogProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmLoading?: boolean;
  testID?: string;
};

export function SimpleConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  confirmLoading = false,
  testID,
}: SimpleConfirmDialogProps): React.ReactElement {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable
          style={styles.card}
          onPress={(event) => event.stopPropagation()}
          testID={testID}
          accessibilityRole="summary"
        >
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.cancel}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirm, destructive ? styles.confirmDanger : null]}
              onPress={onConfirm}
              disabled={confirmLoading}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: confirmLoading, busy: confirmLoading }}
            >
              {confirmLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmLabel}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(22, 17, 13, 0.45)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: "#FFF9F3",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.h3,
    color: INK,
  },
  description: {
    ...typography.body,
    color: INK_MUTED,
  },
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancel: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  cancelLabel: {
    ...typography.buttonMd,
    color: INK_MUTED,
  },
  confirm: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: accent.warm,
    minWidth: 96,
    alignItems: "center",
  },
  confirmDanger: {
    backgroundColor: "#B42318",
  },
  confirmLabel: {
    ...typography.buttonMd,
    color: "#FFFFFF",
  },
});
