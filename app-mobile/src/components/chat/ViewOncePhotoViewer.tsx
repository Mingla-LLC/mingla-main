/**
 * Issue #4114 Wave 4: the one look at a view-once photo. Full screen, no save,
 * no share, no swipe to other photos; closing it ends it (the server already
 * recorded the open, and its 60-second link is not kept anywhere).
 * No screenshot notice yet (decision D6: needs expo-screen-capture, a store build).
 */
import React, { useState } from "react";
import { ActivityIndicator, Image, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import {
  EMPTY_MEDIA_LOAD_STATE,
  markMediaFailed,
  markMediaLoaded,
  mediaLoadPhase,
  type MediaLoadState,
} from "../../utils/mediaLoadPhase";

interface ViewOncePhotoViewerProps {
  url: string | null;
  onClose: () => void;
  /** Issue #4114 QA: told when the image fails to load (the parent re-signs and retries once). */
  onLoadError?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
}

export function ViewOncePhotoViewer({
  url,
  onClose,
  onLoadError,
  onReport,
  onBlock,
}: ViewOncePhotoViewerProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const insets = useSafeAreaInsets();
  // Issue #4114 QA run 2: loading is derived from which url has settled, so a
  // new url (a retry) starts loading on its own, and an image that loaded
  // before the modal finished showing (cached, instant) is never re-armed.
  const [loadState, setLoadState] = useState<MediaLoadState>(EMPTY_MEDIA_LOAD_STATE);
  const phase = mediaLoadPhase(url, loadState);
  const loading = phase === "loading";
  const failed = phase === "failed";

  return (
    <Modal
      visible={!!url}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.overlay}>
        {url ? (
          <Image
            key={url}
            source={{ uri: url, cache: "reload" }}
            style={styles.image}
            resizeMode="contain"
            onLoad={() => setLoadState((prev) => markMediaLoaded(prev, url))}
            onLoadEnd={() => setLoadState((prev) => markMediaLoaded(prev, url))}
            onError={() => {
              setLoadState((prev) => markMediaFailed(prev, url));
              onLoadError?.();
            }}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {loading ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator size="large" color={chatTokens.accent} />
          </View>
        ) : null}
        {failed ? (
          <View style={styles.center} pointerEvents="none">
            <Icon name="alert-circle" size={28} color={chatTokens.textSecondary} />
            <Text style={styles.errorText}>{t("chat:viewOnceLoadFailed")}</Text>
          </View>
        ) : null}
        <View style={[styles.tag, { top: insets.top + 14 }]} pointerEvents="none">
          <Icon name="eye-off" size={12} color={chatTokens.textPrimary} />
          <Text style={styles.tagText}>{t("chat:viewOnce")}</Text>
        </View>
        <TouchableOpacity
          style={[styles.close, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t("chat:a11yClosePreview")}
        >
          <Icon name="close" size={24} color={chatTokens.textPrimary} />
        </TouchableOpacity>
        {onReport || onBlock ? (
          <View style={[styles.actions, { bottom: insets.bottom + 18 }]}>
            {onReport ? (
              <TouchableOpacity
                style={styles.action}
                onPress={onReport}
                accessibilityRole="button"
                accessibilityLabel={t("chat:reportUser")}
              >
                <Icon name="flag" size={18} color={chatTokens.textPrimary} />
                <Text style={styles.actionText}>{t("chat:reportUser")}</Text>
              </TouchableOpacity>
            ) : null}
            {onBlock ? (
              <TouchableOpacity
                style={[styles.action, styles.dangerAction]}
                onPress={onBlock}
                accessibilityRole="button"
                accessibilityLabel={t("chat:blockUser")}
              >
                <Icon name="ban" size={18} color={chatTokens.textPrimary} />
                <Text style={styles.actionText}>{t("chat:blockUser")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000",
  },
  image: {
    flex: 1,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  errorText: {
    fontSize: 14,
    color: chatTokens.textSecondary,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  tag: {
    position: "absolute",
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  close: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  actions: {
    position: "absolute",
    left: 18,
    right: 18,
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  action: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: "rgba(24, 24, 27, 0.88)",
  },
  dangerAction: {
    backgroundColor: "rgba(127, 29, 29, 0.9)",
  },
  actionText: {
    color: chatTokens.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
});
