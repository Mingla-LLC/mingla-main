/**
 * Issue #4114 Wave 4: full-screen player for a chat video (and the one-time
 * player for a view-once video).
 *
 * expo-video is in app-mobile/package.json (~3.0.16), registered as a config
 * plugin in app.json, and has shipped in every binary since 1.1.0
 * (WelcomeVideoBackground imports it statically on the sign-in screen), so
 * this OTA adds no native module.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";

interface ChatVideoPlayerModalProps {
  /** A playable URL (signed, legacy public, or local). The modal is open while set. */
  url: string | null;
  onClose: () => void;
  /** View once: no loop, and closing ends it for good. */
  viewOnce?: boolean;
}

function Player({ url, onClose, viewOnce }: { url: string; onClose: () => void; viewOnce: boolean }): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
    instance.play();
  });
  const [status, setStatus] = useState<string>(player.status);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status: next }) => setStatus(next));
    return () => {
      subscription.remove();
      try {
        player.pause();
      } catch (error) {
        // The player can already be released when the modal unmounts.
        console.warn("[ChatVideoPlayerModal] pause on close failed", error);
      }
    };
  }, [player]);

  return (
    <View style={styles.overlay}>
      <StatusBar barStyle="light-content" />
      <VideoView
        style={styles.video}
        player={player}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture={false}
      />
      {status === "loading" ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color={chatTokens.accent} />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.center} pointerEvents="none">
          <Icon name="alert-circle" size={28} color={chatTokens.textSecondary} />
          <Text style={styles.errorText}>{t("chat:errorOpenVideo")}</Text>
        </View>
      ) : null}
      {viewOnce ? (
        <View style={[styles.viewOnceTag, { top: insets.top + 14 }]} pointerEvents="none">
          <Icon name="eye-off" size={12} color={chatTokens.textPrimary} />
          <Text style={styles.viewOnceTagText}>{t("chat:viewOnce")}</Text>
        </View>
      ) : null}
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
  );
}

export function ChatVideoPlayerModal({ url, onClose, viewOnce = false }: ChatVideoPlayerModalProps): React.ReactElement {
  return (
    <Modal visible={!!url} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {url ? <Player url={url} onClose={onClose} viewOnce={viewOnce} /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000",
  },
  video: {
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
  viewOnceTag: {
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
  viewOnceTagText: {
    fontSize: 12,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
});
