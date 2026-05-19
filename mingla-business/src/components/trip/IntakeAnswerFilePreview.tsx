/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeAnswerFilePreview />.
 *
 * Per DESIGN_ORCH-0880 §5.4. Full-screen Modal for image enlarge in the
 * Travelers tab. canvas.depth (#08090c) full-bleed bg. Close X top-right.
 * Image aspectRatio-preserving (basic non-zoom render — pinch-zoom is a
 * follow-up if needed). Caption bottom: filename · size.
 *
 * Composes RN Modal + Image + IconChrome + Text. No new primitives.
 */

import React from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { IconChrome } from "../ui/IconChrome";

export interface IntakeAnswerFilePreviewProps {
  visible: boolean;
  signedUrl: string | null;
  filename: string;
  sizeBytes: number;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const IntakeAnswerFilePreview: React.FC<IntakeAnswerFilePreviewProps> = ({
  visible,
  signedUrl,
  filename,
  sizeBytes,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[styles.host, { backgroundColor: canvas.depth }]}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close preview"
          accessibilityRole="button"
        >
          {signedUrl !== null ? (
            <Image
              source={{ uri: signedUrl }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={`Preview of ${filename}`}
            />
          ) : (
            <Text style={styles.loadingText}>Loading…</Text>
          )}
        </Pressable>
        <View
          style={[
            styles.closeWrap,
            {
              paddingTop: insets.top + spacing.md,
              paddingRight: spacing.md,
            },
          ]}
          pointerEvents="box-none"
        >
          <IconChrome
            icon="close"
            size={36}
            onPress={onClose}
            accessibilityLabel="Close preview"
          />
        </View>
        <View
          style={[
            styles.captionWrap,
            {
              paddingBottom: insets.bottom + spacing.md,
              paddingHorizontal: spacing.md,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.captionText}>
            {filename} · {formatBytes(sizeBytes)}
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  loadingText: {
    fontSize: typography.body.fontSize,
    color: textTokens.tertiary,
  },
  closeWrap: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    alignItems: "flex-end",
  },
  captionWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  captionText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
});

export default IntakeAnswerFilePreview;
