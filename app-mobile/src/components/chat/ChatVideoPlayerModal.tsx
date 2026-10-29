/**
 * Issue #4114 Wave 4: full-screen player for a chat video (and the one-time
 * player for a view-once video).
 *
 * expo-video is in app-mobile/package.json (~3.0.16), registered as a config
 * plugin in app.json, and has shipped in every binary since 1.1.0
 * (WelcomeVideoBackground imports it statically on the sign-in screen), so
 * this OTA adds no native module.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  isVideoPlayerReleasedForReload,
  registerVideoPlayerForReload,
} from "@mingla/offering-rendering/videoPlayerReloadRelease";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";

interface ChatVideoPlayerModalProps {
  /** A playable URL (signed, legacy public, or local). The modal is open while set. */
  url: string | null;
  onClose: () => void;
  /** View once: no loop, and closing ends it for good. */
  viewOnce?: boolean;
  /** Issue #4114 QA: told once per URL when it fails to load (view once re-signs and retries). */
  onLoadError?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
}

function Player({ url, onClose, viewOnce, onLoadError, onReport, onBlock }: {
  url: string;
  onClose: () => void;
  viewOnce: boolean;
  onLoadError?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
    instance.play();
  });
  const [status, setStatus] = useState<string>(player.status);
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  // #2107: an in-app restart releases this player before reloadAsync. A
  // released player is never touched again.
  useEffect(() => registerVideoPlayerForReload(player), [player]);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status: next }) => {
      setStatus(next);
      if (next === "error") onLoadErrorRef.current?.();
    });
    // Issue #4114 QA run 2: a cached or fast video can reach readyToPlay
    // between the first render and this subscription; read it now so the
    // spinner cannot stick on a status change that was never heard.
    setStatus(player.status);
    if (player.status === "error") onLoadErrorRef.current?.();
    return () => {
      subscription.remove();
      if (isVideoPlayerReleasedForReload(player)) return;
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
      {viewOnce && (onReport || onBlock) ? (
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
  );
}

export function ChatVideoPlayerModal({
  url,
  onClose,
  viewOnce = false,
  onLoadError,
  onReport,
  onBlock,
}: ChatVideoPlayerModalProps): React.ReactElement {
  return (
    <Modal visible={!!url} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {url ? (
        <Player
          key={url}
          url={url}
          onClose={onClose}
          viewOnce={viewOnce}
          onLoadError={onLoadError}
          onReport={onReport}
          onBlock={onBlock}
        />
      ) : null}
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
