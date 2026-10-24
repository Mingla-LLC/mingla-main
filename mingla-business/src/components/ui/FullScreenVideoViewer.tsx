/**
 * #3040 Appendix A §6 G-05 — "Ready: tap → open viewer".
 *
 * The app's existing full-screen video pattern (BrandGroupFilePreviewModal,
 * GuidePlayerModal): a full-screen `Modal` with an expo-video `VideoView`
 * carrying the platform's own controls. expo-video is already in every
 * shipped build, so this adds no native code. Callers load this module lazily,
 * so expo-video never evaluates on a screen that does not open a video.
 */
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { registerVideoPlayerForReload } from "@mingla/offering-rendering/videoPlayerReloadRelease";
import { useTranslation } from "react-i18next";

import { spacing, text as textTokens } from "../../constants/designSystem";
import { Icon } from "./Icon";
import { MediaViewerShell } from "../media/MediaViewerShell";

export interface FullScreenVideoViewerProps {
  /** The video to play; null keeps the viewer closed. */
  uri: string | null;
  title: string;
  onClose: () => void;
}

export function FullScreenVideoViewer({ uri, title, onClose }: FullScreenVideoViewerProps): React.ReactElement {
  const { t } = useTranslation("brandGroupMedia");
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  // #2107: an in-app restart releases this player before reloadAsync. Nothing
  // here calls the player from JS; if the restart does not happen the VideoView
  // keeps its still frame and the native controls.
  useEffect(() => registerVideoPlayerForReload(player), [player]);
  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.close_video_a11y")} onPress={onClose} hitSlop={8} style={styles.close}><Icon name="close" size={20} color={textTokens.primary} /></Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View>
  );
  return (
    <MediaViewerShell visible={uri !== null} onClose={onClose} closeAccessibilityLabel={t("viewer.close_video_a11y")} topBar={header} hasBottomArea={false} testID="full-screen-video-viewer">
      {(stage) => uri !== null ? <VideoView player={player} style={stage.style} nativeControls contentFit="contain" accessibilityLabel={title} /> : null}
    </MediaViewerShell>
  );
}

export default FullScreenVideoViewer;

const styles = StyleSheet.create({
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: textTokens.primary, fontSize: 16, fontWeight: "700" },
});
