/**
 * SimpleConfirmDialog — Modal + Pressable confirm without reanimated.
 *
 * Used on buyer-web public brand/event Follow flows so ConfirmDialog
 * (react-native-reanimated) is not shared into the eager `__common` chunk
 * when both PublicBrandPage and PublicEventPage need a confirm surface
 * (#3682 / ORCH-1083).
 *
 * #4420 Graphite Glass: the light-theme card is retired. This is now the
 * reanimated-free twin of `ConfirmDialog variant="simple"`: the same sheet
 * material, 400 width, 28 radius, title / one-line consequence, Cancel
 * (secondary) and Confirm (paper primary, or red when `destructive`). It does
 * NOT import ConfirmDialog, because that would pull reanimated back into the
 * buyer chunk (#3682). Prop signature unchanged.
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

import { color, radius, scrim, shadow, size, space, type } from "../../constants/designSystem";

import { Material } from "./Material";
import { ToastHost } from "./ToastHost";

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
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable
          style={[styles.card, shadow.dialog]}
          onPress={(event) => event.stopPropagation()}
          testID={testID}
          accessibilityRole="summary"
          accessibilityLabel={title}
        >
          <Material kind="sheet" radius={radius.xxl} style={styles.surface}>
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
                <ActivityIndicator color={destructive ? color.onDanger : color.ink} />
              ) : (
                <Text style={[styles.confirmLabel, destructive ? styles.confirmDangerLabel : null]}>
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
          </View>
          </Material>
        </Pressable>
      </Pressable>
      <ToastHost layer="overlay" open={visible} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: scrim.modal,
    justifyContent: "center",
    alignItems: "center",
    padding: space[5],
  },
  card: {
    width: "100%",
    maxWidth: size.dialog,
    borderRadius: radius.xxl,
  },
  surface: {
    padding: space[6],
    gap: space[3],
  },
  title: {
    ...type.h1,
    color: color.text1,
  },
  description: {
    ...type.body,
    color: color.text2,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[3],
  },
  cancel: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: size.btn.md,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.card2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: {
    ...type.btnSm,
    color: color.text1,
  },
  confirm: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: size.btn.md,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDanger: {
    backgroundColor: color.danger,
  },
  confirmLabel: {
    ...type.btnSm,
    color: color.ink,
  },
  confirmDangerLabel: {
    color: color.onDanger,
  },
});
