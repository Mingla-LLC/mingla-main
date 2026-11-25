/**
 * ConfirmDialog — three-variant confirmation dialog over `Modal`.
 *
 *   simple         — title + description + Cancel + Confirm.
 *   typeToConfirm  — adds `Input` field. Confirm enabled only when
 *                    inputValue === confirmText (case-sensitive).
 *   holdToConfirm  — Confirm is replaced by a hold-to-confirm bar.
 *                    1500ms full press fills 0 → 1; release before 1
 *                    resets to 0; at 1.0 fires `onConfirm()`.
 *   leave          — #3655 three stacked actions: Save / Discard / Keep editing.
 *
 * Hold-to-confirm intentionally does NOT honour reduce-motion — the
 * animated progress fill IS the load-bearing UX (users need to see
 * the hold time). Other variants have no animation to honour.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { color, radius as radiusTokens, size, space, type } from "../../constants/designSystem";

import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";

export type ConfirmDialogVariant =
  | "simple"
  | "typeToConfirm"
  | "holdToConfirm"
  | "leave";

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
  confirmLoading?: boolean;
  confirmDisabled?: boolean;
  errorMessage?: string | null;
  /**
   * Optional handle on the in-dialog failure alert. Omitted by every existing
   * caller; the alert renders identically without it.
   */
  errorTestID?: string;
  closeDisabled?: boolean;
  confirmTestID?: string;
  cancelTestID?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Optional initial screen-reader/keyboard focus target. Existing callers omit it. */
  initialFocus?: "cancel" | "confirm" | "keep";
  /** Optional native restoration seam; web also restores the element active before open. */
  restoreFocus?: () => void;
  /** #3655 leave variant — Save changes. */
  onSave?: () => void | Promise<void>;
  /** #3655 leave variant — Discard changes (defaults to onConfirm when omitted). */
  onDiscard?: () => void | Promise<void>;
  saveLabel?: string;
  discardLabel?: string;
  keepLabel?: string;
  saveTestID?: string;
  discardTestID?: string;
  keepTestID?: string;
  saveDisabled?: boolean;
}

interface FocusableTarget {
  focus?: () => void;
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
  confirmLoading = false,
  confirmDisabled = false,
  errorMessage = null,
  errorTestID,
  closeDisabled = false,
  confirmTestID,
  cancelTestID,
  testID,
  style,
  initialFocus,
  restoreFocus,
  onSave,
  onDiscard,
  saveLabel = "Save changes",
  discardLabel = "Discard changes",
  keepLabel = "Keep editing",
  saveTestID,
  discardTestID,
  keepTestID,
  saveDisabled = false,
}) => {
  const stackActions = Math.max(confirmLabel.length, cancelLabel.length) > 18;
  const [typedValue, setTypedValue] = useState("");
  const [isHolding, setIsHolding] = useState(false);
  const progress = useSharedValue(0);
  const cancelFocusRef = useRef<React.ElementRef<typeof Pressable> | null>(
    null,
  );
  const confirmFocusRef = useRef<React.ElementRef<typeof Pressable> | null>(
    null,
  );
  const keepFocusRef = useRef<React.ElementRef<typeof Pressable> | null>(null);
  const webOriginRef = useRef<FocusableTarget | null>(null);
  const wasVisibleRef = useRef<boolean>(false);
  const resolvedInitialFocus =
    initialFocus ?? (variant === "leave" ? "keep" : undefined);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      if (Platform.OS === "web") {
        const doc = globalThis as unknown as {
          document?: { activeElement?: FocusableTarget | null };
        };
        webOriginRef.current = doc.document?.activeElement ?? null;
      }
      if (resolvedInitialFocus !== undefined) {
        const target =
          resolvedInitialFocus === "cancel"
            ? cancelFocusRef
            : resolvedInitialFocus === "keep"
              ? keepFocusRef
              : confirmFocusRef;
        const frame = requestAnimationFrame(() => {
          if (Platform.OS === "web") {
            (target.current as FocusableTarget | null)?.focus?.();
            return;
          }
          const node = findNodeHandle(target.current);
          if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
        });
        wasVisibleRef.current = true;
        return (): void => cancelAnimationFrame(frame);
      }
    }
    if (!visible && wasVisibleRef.current) {
      if (restoreFocus !== undefined) restoreFocus();
      else if (Platform.OS === "web") webOriginRef.current?.focus?.();
      webOriginRef.current = null;
    }
    wasVisibleRef.current = visible;
  }, [resolvedInitialFocus, restoreFocus, visible]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (confirmDisabled || confirmLoading) return;
    try {
      await onConfirm();
    } catch (error) {
      if (__DEV__) {
        console.error("[ConfirmDialog] onConfirm threw:", error);
      }
    }
  }, [confirmDisabled, confirmLoading, onConfirm]);

  const handleClose = useCallback((): void => {
    if (closeDisabled || confirmLoading) return;
    onClose();
  }, [closeDisabled, confirmLoading, onClose]);

  const handleSaveLeave = useCallback(async (): Promise<void> => {
    if (saveDisabled || confirmLoading || onSave === undefined) return;
    try {
      await onSave();
    } catch (error) {
      if (__DEV__) {
        console.error("[ConfirmDialog] onSave threw:", error);
      }
    }
  }, [confirmLoading, onSave, saveDisabled]);

  const handleDiscardLeave = useCallback(async (): Promise<void> => {
    if (confirmLoading) return;
    const action = onDiscard ?? onConfirm;
    try {
      await action();
    } catch (error) {
      if (__DEV__) {
        console.error("[ConfirmDialog] onDiscard threw:", error);
      }
    }
  }, [confirmLoading, onConfirm, onDiscard]);

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
    variant !== "typeToConfirm" ||
    (confirmText !== undefined && typedValue === confirmText);
  const confirmBlocked = confirmDisabled || confirmLoading || !typeMatches;

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      maxWidth={size.dialog}
      testID={testID}
      style={[styles.dialog, style]}
    >
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        {/*
          Issue #3571 (PR #3615 rework, P2-2) — this is the ONLY failure copy a
          screen reader can reach while the dialog is open. On iOS the native
          `Modal` owns the accessibility container, so an assertive live region
          rendered by the caller BEHIND the dialog is unreachable: without the
          trio below a VoiceOver/TalkBack operator hears nothing at all and is
          left with an apparently inert confirm button. Additive for every
          existing caller — a dialog that passes no `errorMessage` renders
          nothing here, exactly as before.
        */}
        {errorMessage !== null && errorMessage.length > 0 ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            aria-live="assertive"
            style={styles.errorText}
            testID={errorTestID}
          >
            {errorMessage}
          </Text>
        ) : null}

        {variant === "typeToConfirm" ? (
          <View style={styles.inputWrap}>
            {confirmText !== undefined ? (
              <Text style={styles.hint}>
                Type <Text style={styles.hintEmph}>{confirmText}</Text> to
                confirm.
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

        {variant === "leave" ? (
          <View style={styles.leaveActions} accessibilityRole="alert">
            <Button
              ref={confirmFocusRef}
              label={confirmLoading ? "Saving…" : saveLabel}
              onPress={() => {
                void handleSaveLeave();
              }}
              variant="primary"
              size="lg"
              disabled={saveDisabled || confirmLoading}
              loading={confirmLoading}
              fullWidth
              testID={saveTestID ?? confirmTestID}
            />
            <Button
              ref={cancelFocusRef}
              label={discardLabel}
              onPress={() => {
                void handleDiscardLeave();
              }}
              variant="destructiveOutline"
              size="lg"
              disabled={confirmLoading}
              fullWidth
              testID={discardTestID ?? cancelTestID}
            />
            <Button
              ref={keepFocusRef}
              label={keepLabel}
              onPress={handleClose}
              variant="ghost"
              size="lg"
              disabled={confirmLoading}
              fullWidth
              testID={keepTestID}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <View style={[styles.actionFlex, stackActions && styles.actionStacked]}>
              <Button
                ref={cancelFocusRef}
                label={cancelLabel}
                onPress={handleClose}
                variant="secondary"
                size="md"
                disabled={closeDisabled || confirmLoading}
                fullWidth
                testID={cancelTestID}
              />
            </View>
            {variant === "holdToConfirm" ? (
              <View style={[styles.actionFlex, stackActions && styles.actionStacked]}>
                <Pressable
                  ref={confirmFocusRef}
                  onPressIn={confirmBlocked ? undefined : handleHoldStart}
                  onPressOut={confirmBlocked ? undefined : handleHoldEnd}
                  disabled={confirmBlocked}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: confirmBlocked,
                    busy: confirmLoading,
                  }}
                  accessibilityLabel={`Hold to ${confirmLabel.toLowerCase()}`}
                  testID={confirmTestID}
                  style={styles.holdButton}
                >
                  <Animated.View style={[styles.holdFill, progressBarStyle]} />
                  <Text style={styles.holdLabel}>
                    {isHolding ? "Hold to confirm…" : confirmLabel}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.actionFlex, stackActions && styles.actionStacked]}>
                <Button
                  ref={confirmFocusRef}
                  label={confirmLabel}
                  onPress={handleConfirm}
                  variant={destructive ? "destructive" : "primary"}
                  size="md"
                  disabled={confirmDisabled || !typeMatches}
                  loading={confirmLoading}
                  fullWidth
                  testID={confirmTestID}
                />
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  /** #4420: kit `size.dialog` 400 on every platform (phones are narrower). */
  dialog: {
    maxWidth: size.dialog,
  },
  body: {
    gap: space[3],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
  },
  description: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: type.body.fontWeight,
    color: color.text2,
  },
  errorText: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.errorText,
  },
  inputWrap: {
    gap: space[2],
    marginTop: space[1],
  },
  hint: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text3,
  },
  hintEmph: {
    fontWeight: "600",
    color: color.text1,
  },
  // Cancel and Confirm sit side by side at equal width; a footer too narrow
  // for both wraps them into a stack instead of squeezing (no bleed-outs).
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    marginTop: space[3],
  },
  leaveActions: {
    flexDirection: "column",
    gap: space[2],
    marginTop: space[3],
  },
  actionFlex: {
    flexGrow: 1,
    flexBasis: 140,
  },
  // #4490 N1: a long label ("Turn off Table reservations") gets the full row,
  // so it keeps the button's side padding instead of running edge to edge.
  actionStacked: { flexBasis: "100%" },
  holdButton: {
    height: size.btn.md,
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.full,
    backgroundColor: color.card2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  // Hold progress is a progress meter: one of the places orange is allowed.
  holdFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: color.accent,
    opacity: 0.85,
  },
  holdLabel: {
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
    letterSpacing: type.btnSm.letterSpacing,
    color: color.text1,
  },
});

export default ConfirmDialog;
