/**
 * Issue #4456 — the confirm for Unsend for everyone and Remove for everyone.
 *
 * Opens after the message menu has closed (MENU_PRESENT_AFTER_DISMISS_MS), and
 * shows the message it will remove. Unsend is not optimistic: the chat changes
 * only when the server says yes. While "Unsending..." the scrim, the drag and
 * Cancel are held; a failure stays in the sheet with Try again (and the error
 * is announced). It closes by Cancel, the scrim, a drag or Android back.
 */
import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, findNodeHandle, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";

export type UnsendConfirmMode = "unsend" | "remove";

export interface UnsendConfirmRequest {
  ids: string[];
  mode: UnsendConfirmMode;
  /** The message as it reads in the chat (or the photo label). */
  preview: string;
}

interface UnsendConfirmSheetProps {
  request: UnsendConfirmRequest | null;
  busy: boolean;
  /** Shown in the sheet with Try again; null when there is none. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function UnsendConfirmSheet({ request, busy, error, onCancel, onConfirm }: UnsendConfirmSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const titleRef = useRef<Text>(null);
  const { height: windowHeight } = useWindowDimensions();
  const visible = request !== null;
  const count = request?.ids.length ?? 1;
  const isRemove = request?.mode === "remove";
  const title = isRemove
    ? t("chat:removeTitle")
    : count > 1
      ? t("chat:unsendAlbumTitle", { count })
      : t("chat:unsendTitle");
  const body = isRemove ? t("chat:removeBody") : t("chat:unsendBody");
  const confirmLabel = isRemove ? t("chat:removeConfirm") : t("chat:unsendConfirm");

  // The sheet is modal: focus moves to its title when it opens.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const node = titleRef.current ? findNodeHandle(titleRef.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 350);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={busy ? () => undefined : onCancel}
      theme="dark"
      enableDynamicSizing
      maxDynamicContentSize={Math.round(windowHeight * 0.86)}
      scrollMode="view"
      wrapInRNModal
      enablePanDownToClose={!busy}
      backdropPressBehavior={busy ? "none" : "close"}
      accessibilityLabel={title}
    >
      <View style={styles.body} testID="unsend-confirm-sheet" accessibilityViewIsModal>
        <View style={styles.iconTile}>
          <Icon name={isRemove ? "shield-outline" : "remove-circle-outline"} size={24} color={chatTokens.danger} />
        </View>
        <Text ref={titleRef} style={styles.title} accessibilityRole="header">{title}</Text>
        <Text style={styles.text}>{body}</Text>
        {request?.preview ? (
          <View style={styles.preview}>
            <Text style={styles.previewText} numberOfLines={2}>{request.preview}</Text>
          </View>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="unsend-confirm-error">{error}</Text>
        ) : null}
        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.button, styles.cancel, busy && styles.held]}
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("common:cancel")}
            accessibilityState={{ disabled: busy }}
            testID="unsend-confirm-cancel"
          >
            <Text style={styles.cancelText}>{t("common:cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.confirm]}
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={error ? t("chat:tryAgain") : confirmLabel}
            accessibilityState={{ disabled: busy, busy }}
            testID="unsend-confirm-go"
          >
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator size="small" color={chatTokens.danger} />
                <Text style={styles.confirmText}>{t("chat:unsendBusy")}</Text>
              </View>
            ) : (
              <Text style={styles.confirmText}>{error ? t("chat:tryAgain") : confirmLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: chatTokens.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  text: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 22,
    color: chatTokens.textSecondary,
  },
  preview: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: chatTokens.surfaceRaised,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewText: {
    fontSize: 15,
    lineHeight: 21,
    color: chatTokens.textPrimary,
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: chatTokens.danger,
  },
  buttons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 20,
  },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  cancel: {
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.hairline,
  },
  held: {
    opacity: 0.5,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  confirm: {
    backgroundColor: chatTokens.dangerSoft,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: "700",
    color: chatTokens.danger,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
