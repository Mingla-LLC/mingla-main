/**
 * ConfirmDialog — three-variant confirmation dialog over `Modal`.
 *
 *   simple         — title + description + Cancel + Confirm.
 *   typeToConfirm  — adds `Input` field. Confirm enabled only when
 *                    inputValue === confirmText (case-sensitive).
 *   holdToConfirm  — Confirm is replaced by a hold-to-confirm bar.
 *                    1500ms full press fills 0 → 1; release before 1
 *                    resets to 0; at 1.0 fires `onConfirm()`.
 *
 * Hold-to-confirm intentionally does NOT honour reduce-motion — the
 * animated progress fill IS the load-bearing UX (users need to see
 * the hold time). Other variants have no animation to honour.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";

export type ConfirmDialogVariant = "simple" | "typeToConfirm" | "holdToConfirm";

export interface ConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  variant?: ConfirmDialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Required when `variant === 'typeToConfirm'`. */
  confirmText?: string;
  /** Forces the Confirm action into the destructive variant for dangerous actions. */
  destructive?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const HOLD_DURATION_MS = 1500;
const HOLD_RESET_MS = 200;

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  onClose,
  onConfirm,
  title,
  description,
  variant = "simple",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmText,
  destructive = false,
  testID,
  style,
}) => {
  const [typedValue, setTypedValue] = useState("");
  const [isHolding, setIsHolding] = useState(false);
  const progress = useSharedValue(0);

  const handleConfirm = useCallback(async (): Promise<void> => {
    try {
      await onConfirm();
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[ConfirmDialog] onConfirm threw:", error);
      }
    }
  }, [onConfirm]);

  const triggerConfirm = useCallback((): void => {
    void handleConfirm();
  }, [handleConfirm]);

  const handleHoldStart = useCallback((): void => {
    setIsHolding(true);
    progress.value = withTiming(
      1,
      { duration: HOLD_DURATION_MS, easing: Easing.linear },
      (finished) => {
        if (finished) {
          runOnJS(triggerConfirm)();
        }
      },
    );
  }, [progress, triggerConfirm]);

  const handleHoldEnd = useCallback((): void => {
    setIsHolding(false);
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: HOLD_RESET_MS });
  }, [progress]);

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const typeMatches =
    variant !== "typeToConfirm" || (confirmText !== undefined && typedValue === confirmText);

  return (
    <Modal visible={visible} onClose={onClose} testID={testID} style={style}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        {variant === "typeToConfirm" ? (
          <View style={styles.inputWrap}>
            {confirmText !== undefined ? (
              <Text style={styles.hint}>
                Type <Text style={styles.hintEmph}>{confirmText}</Text> to confirm.
              </Text>
            ) : null}
            <Input
              value={typedValue}
              onChangeText={setTypedValue}
              placeholder={confirmText}
              variant="text"
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label={cancelLabel} onPress={onClose} variant="secondary" size="md" />
          {variant === "holdToConfirm" ? (
            <Pressable
              onPressIn={handleHoldStart}
              onPressOut={handleHoldEnd}
              accessibilityRole="button"
              accessibilityLabel={`Hold to ${confirmLabel.toLowerCase()}`}
              style={styles.holdButton}
            >
              <Animated.View style={[styles.holdFill, progressBarStyle]} />
              <Text style={styles.holdLabel}>
                {isHolding ? "Hold to confirm…" : confirmLabel}
              </Text>
            </Pressable>
          ) : (
            <Button
              label={confirmLabel}
              onPress={triggerConfirm}
              variant={destructive ? "destructive" : "primary"}
              size="md"
              disabled={!typeMatches}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  description: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: typography.body.fontWeight,
    color: textTokens.secondary,
  },
  inputWrap: {
    gap: spacing.sm,
  },
  hint: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  hintEmph: {
    fontWeight: "600",
    color: textTokens.primary,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  holdButton: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: 1,
    borderColor: accent.border,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  holdFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: accent.warm,
    opacity: 0.8,
  },
  holdLabel: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
    letterSpacing: typography.buttonMd.letterSpacing,
    color: textTokens.inverse,
  },
});

export default ConfirmDialog;
