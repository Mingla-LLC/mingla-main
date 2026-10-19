/**
 * #3040 Appendix A §6 G-05 — "Ready: tap → open viewer".
 *
 * The app's existing full-screen video pattern (BrandGroupFilePreviewModal,
 * GuidePlayerModal): a full-screen `Modal` with an expo-video `VideoView`
 * carrying the platform's own controls. expo-video is already in every
 * shipped build, so this adds no native code. Callers load this module lazily,
 * so expo-video never evaluates on a screen that does not open a video.
 */
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

import { canvas, glass, spacing, text as textTokens } from "../../constants/designSystem";
import { Icon } from "./Icon";

export interface FullScreenVideoViewerProps {
  /** The video to play; null keeps the viewer closed. */
  uri: string | null;
  title: string;
  onClose: () => void;
}

export function FullScreenVideoViewer({ uri, title, onClose }: FullScreenVideoViewerProps): React.ReactElement {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  return (
    <Modal visible={uri !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close video"
            onPress={onClose}
            hitSlop={8}
            style={styles.close}
          >
            <Icon name="close" size={20} color={textTokens.primary} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
        {uri !== null ? (
          <VideoView player={player} style={styles.media} nativeControls contentFit="contain" accessibilityLabel={title} />
        ) : null}
      </View>
    </Modal>
  );
}

export default FullScreenVideoViewer;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.profile },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: textTokens.primary, fontSize: 16, fontWeight: "700" },
  media: { flex: 1, width: "100%", backgroundColor: "#050608" },
});
