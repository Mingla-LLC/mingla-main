/**
 * #4304 — media speed (B). The sender's own file in the Brand-group thread
 * while it uploads and saves: the local photo (or the poster made on the
 * phone for a video) at the same size as a sent media bubble, with the upload
 * progress. A failure stays in the thread with Retry and Remove.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { accent, spacing } from "../../constants/designSystem";
import { BrandGroupCachedImage } from "../media/BrandGroupCachedImage";
import { Icon } from "../ui/Icon";
import {
  brandGroupPendingStatus,
  type BrandGroupPendingUpload,
} from "../../utils/brandGroupPendingUploads";
import { useBrandGroupLocalPreview } from "./brandGroupLocalPreviews";

export function BrandGroupPendingUploadRow({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: BrandGroupPendingUpload;
  onRetry: (fileId: string) => void;
  onDismiss: (fileId: string) => void;
}): React.ReactElement {
  const preview = useBrandGroupLocalPreview(upload.fileId);
  const failed = upload.state === "failed";
  const status = brandGroupPendingStatus(upload);
  const visual = upload.kind === "image"
    ? { uri: upload.localUri }
    : upload.kind === "video" ? preview?.poster ?? null : null;
  const media = upload.kind === "image" || upload.kind === "video";
  return (
    <View style={styles.row} testID="brand-group-pending-upload" accessibilityLabel={`${upload.name}, ${status}`}>
      <View style={[styles.bubble, failed && styles.bubbleFailed]}>
        {media ? (
          <View style={styles.thumb}>
            {visual ? <BrandGroupCachedImage source={visual} fit="cover" style={StyleSheet.absoluteFill} testID="brand-group-pending-upload-preview" /> : (
              <View style={styles.placeholder}><Icon name={upload.kind === "video" ? "play" : "eye"} size={24} color={brandGroupChat.textSoft} /></View>
            )}
            {upload.kind === "video" ? <View style={styles.play}><Icon name="play" size={18} color="#fff" /></View> : null}
            {!failed && upload.state !== "complete" ? <View style={styles.dim} /> : null}
          </View>
        ) : (
          <View style={styles.fileLine}>
            <View style={styles.fileIcon}><Icon name="notebook" size={20} color={brandGroupChat.mineText} /></View>
            <Text style={styles.fileName} numberOfLines={2}>{upload.name}</Text>
          </View>
        )}
        <View style={styles.footer}>
          <Text style={[styles.status, failed && styles.statusFailed]} numberOfLines={2} testID="brand-group-pending-upload-status">{status}</Text>
          {!failed ? (
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(upload.progress * 100)}%` }]} /></View>
          ) : (
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${upload.name}`} onPress={() => onRetry(upload.fileId)} style={styles.action} testID="brand-group-pending-upload-retry">
                <Text style={styles.actionText}>Retry</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${upload.name}`} onPress={() => onDismiss(upload.fileId)} style={styles.action} testID="brand-group-pending-upload-remove">
                <Text style={styles.actionTextQuiet}>Remove</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-end", marginVertical: 3 },
  bubble: { width: 210, borderRadius: 16, overflow: "hidden", backgroundColor: brandGroupChat.mineBubble },
  bubbleFailed: { backgroundColor: brandGroupChat.surfaceRaised, borderWidth: 1, borderColor: "#ff8b8b" },
  thumb: { width: 210, height: 160, overflow: "hidden", backgroundColor: brandGroupChat.surface },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  play: { position: "absolute", left: "50%", top: "50%", width: 40, height: 40, marginLeft: -20, marginTop: -20, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  fileLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, paddingTop: 10 },
  fileIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(16,18,22,0.12)" },
  fileName: { flex: 1, color: brandGroupChat.mineText, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  footer: { paddingHorizontal: 10, paddingVertical: 7, gap: 5 },
  status: { color: brandGroupChat.mineText, fontSize: 11 },
  statusFailed: { color: "#ff8b8b" },
  progressTrack: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: "rgba(16,18,22,0.18)" },
  progressFill: { height: 3, backgroundColor: brandGroupChat.mineText },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  actionText: { color: accent.warm, fontSize: 13, fontWeight: "800" },
  actionTextQuiet: { color: brandGroupChat.textSoft, fontSize: 13, fontWeight: "700" },
});
