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

interface ViewOncePhotoViewerProps {
  url: string | null;
  onClose: () => void;
}

export function ViewOncePhotoViewer({ url, onClose }: ViewOncePhotoViewerProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <Modal
      visible={!!url}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        setLoading(true);
        setFailed(false);
      }}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.overlay}>
        {url ? (
          <Image
            source={{ uri: url, cache: "reload" }}
            style={styles.image}
            resizeMode="contain"
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
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
});
