/** Issue #3429 — review and durable sent-file cards for Ari. */

import React, { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AlertCircle, CheckCircle2, FileText, Image as ImageIcon, RotateCw, X } from "lucide-react-native";

import { accent, ariThread, glass, radius, semantic, spacing, text as textTokens } from "../../constants/designSystem";
import type { AriAttachmentDraft, AriSentAttachment } from "../../services/ariAttachmentService";

export function formatAriFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function middleTruncate(filename: string, max = 30): string {
  if (filename.length <= max) return filename;
  const extensionAt = filename.lastIndexOf(".");
  const suffix = extensionAt > 0 ? filename.slice(extensionAt) : filename.slice(-7);
  const remaining = Math.max(8, max - suffix.length - 1);
  return `${filename.slice(0, remaining)}…${suffix}`;
}

function FileGlyph({ type, uri }: { type: string; uri?: string }): React.ReactElement {
  if (type === "image" && uri) {
    return <Image source={{ uri }} style={styles.thumbnailImage} accessibilityIgnoresInvertColors />;
  }
  return type === "image"
    ? <ImageIcon size={22} color={accent.warm} strokeWidth={2} />
    : <FileText size={22} color={accent.warm} strokeWidth={2} />;
}

export const AriAttachmentTray: React.FC<{
  attachments: AriAttachmentDraft[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
  onRemoveAll: () => void;
}> = ({ attachments, onRemove, onRetry, onRemoveAll }) => {
  if (!attachments.length) return null;
  return (
    <View style={styles.tray} accessibilityLabel={`${attachments.length} files selected`}>
      <View style={styles.trayHeader}>
        <View>
          <Text style={styles.trayTitle}>{attachments.length} attached</Text>
          <Text style={styles.supporting}>Up to 5 files · 10 MB each · 25 MB total.</Text>
        </View>
        <Pressable
          onPress={onRemoveAll}
          style={styles.textControl}
          accessibilityRole="button"
          accessibilityLabel="Remove all attached files"
        >
          <Text style={styles.removeAll}>Remove all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.trayScroll}
        accessibilityRole="list"
      >
        {attachments.map((attachment) => {
          const failed = attachment.state === "failed";
          const stateCopy = failed
            ? "Couldn’t attach"
            : attachment.state === "ready"
            ? "Ready"
            : attachment.state === "uploading"
            ? "Uploading…"
            : "Preparing…";
          const accessibleState = failed && attachment.errorMessage
            ? `${stateCopy}. ${attachment.errorMessage}`
            : stateCopy;
          return (
            <View
              key={attachment.localId}
              style={[styles.draftCard, failed && styles.failedCard]}
            >
              <View style={styles.thumbnail}><FileGlyph type={attachment.fileType} uri={attachment.fileType === "image" ? attachment.uri : undefined} /></View>
              <View
                style={styles.fileCopy}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${attachment.name}, ${attachment.fileType}, ${formatAriFileSize(attachment.sizeBytes)}, ${accessibleState}`}
              >
                <Text style={styles.filename} numberOfLines={1}>{middleTruncate(attachment.name)}</Text>
                <View style={styles.stateRow}>
                  {failed ? <AlertCircle size={14} color={semantic.error} /> : attachment.state === "ready" ? <CheckCircle2 size={14} color={semantic.success} /> : <RotateCw size={14} color={textTokens.secondary} />}
                  <Text style={[styles.fileMeta, failed && styles.failedText]}>{stateCopy} · {formatAriFileSize(attachment.sizeBytes)}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => onRemove(attachment.localId)}
                style={styles.iconControl}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
              >
                <X size={18} color={textTokens.secondary} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {/* P2-5: failure details sit below the tray at full composer width, never
          inside the horizontal scroller where they could be off-screen. */}
      {attachments.filter((attachment) => attachment.state === "failed").map((attachment) => (
        <View key={`failure-${attachment.localId}`} style={styles.failureBlock} accessibilityRole="alert">
          <Text style={styles.failureFilename} numberOfLines={1}>{attachment.name}</Text>
          <Text style={styles.failureCopy}>{attachment.errorMessage}</Text>
          <View style={styles.failureActions}>
            <Pressable onPress={() => onRetry(attachment.localId)} style={styles.footerAction} accessibilityRole="button" accessibilityLabel={`Retry attaching ${attachment.name}`}>
              <Text style={styles.footerActionText}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => onRemove(attachment.localId)} style={styles.footerAction} accessibilityRole="button" accessibilityLabel={`Remove file ${attachment.name}`}>
              <Text style={styles.footerActionText}>Remove file</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Text style={styles.privacy}>Files are saved with this conversation and kept private to your brand workspace. Ari may process them to answer this chat.</Text>
    </View>
  );
};

export const AriSentAttachments: React.FC<{
  attachments: AriSentAttachment[];
  surface?: "main" | "website";
}> = ({ attachments, surface = "main" }) => {
  // D-9: Alert is a no-op on web; the open failure is inline under the cards.
  const [openError, setOpenError] = useState<string | null>(null);
  if (!attachments.length) return null;
  return (
    <View style={styles.sentList} accessibilityRole="list">
      {attachments.map((attachment) => (
        <Pressable
          key={attachment.id}
          onPress={() => {
            // Keep MessageList presentational and cheap to import. The signed-URL
            // client and analytics own native SDK bootstrap, so load them only
            // when a person opens a file instead of when any historical chat row
            // is rendered.
            setOpenError(null);
            void Promise.all([
              import("../../services/ariAttachmentService"),
              import("../../services/ariPolishAnalytics"),
            ]).then(([{ openAriAttachment }, { captureAriAttachmentOutcome }]) => {
              captureAriAttachmentOutcome({ surface, outcome: "opened", fileType: attachment.file_type });
              return openAriAttachment(attachment.id);
            }).catch(() => {
              setOpenError("Couldn’t open attachment. Check your connection and try again.");
            });
          }}
          style={({ pressed }) => [styles.sentCard, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Open attached ${attachment.file_type}, ${attachment.original_filename}, ${formatAriFileSize(attachment.verified_size_bytes)}`}
        >
          <View style={styles.thumbnail}><FileGlyph type={attachment.file_type} /></View>
          <View style={styles.fileCopy}>
            <Text style={styles.filename} numberOfLines={1}>{middleTruncate(attachment.original_filename)}</Text>
            <Text style={styles.fileMeta}>{attachment.file_type.toUpperCase()} · {formatAriFileSize(attachment.verified_size_bytes)}</Text>
          </View>
          <CheckCircle2 size={16} color={semantic.success} />
        </Pressable>
      ))}
      {openError ? <Text style={styles.openError} accessibilityRole="alert">{openError}</Text> : null}
    </View>
  );
};

const raised = Platform?.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileElevated;
const styles = StyleSheet.create({
  tray: { gap: spacing.sm },
  trayHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  trayTitle: { color: textTokens.primary, fontSize: ariThread.labelFont, lineHeight: ariThread.labelLine, fontWeight: "600" },
  supporting: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  textControl: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  removeAll: { color: accent.warm, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  trayScroll: { gap: spacing.sm },
  draftCard: {
    width: ariThread.attachmentCardW,
    minHeight: ariThread.attachmentCardMinH,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: raised,
    overflow: "hidden",
  },
  failedCard: { borderColor: semantic.error },
  thumbnail: { width: ariThread.attachmentThumb, height: ariThread.attachmentThumb, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: ariThread.composerSurface, overflow: "hidden" },
  thumbnailImage: { width: "100%", height: "100%" },
  fileCopy: { flex: 1, minWidth: 0 },
  filename: { color: textTokens.primary, fontSize: ariThread.labelFont, lineHeight: ariThread.labelLine, fontWeight: "600" },
  fileMeta: { color: textTokens.secondary, fontSize: 12, lineHeight: 16 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  failedText: { color: semantic.error },
  iconControl: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  failureBlock: { width: "100%", gap: spacing.xs, paddingVertical: spacing.xs },
  failureFilename: { color: textTokens.secondary, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  failureCopy: { color: semantic.errorText, fontSize: 14, lineHeight: 20 },
  openError: { color: semantic.errorText, fontSize: 14, lineHeight: 20 },
  failureActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  footerAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  footerActionText: { color: accent.warm, fontSize: 14, fontWeight: "600" },
  privacy: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  sentList: { alignSelf: "flex-end", width: "84%", maxWidth: 280, gap: spacing.xs, marginBottom: spacing.xs },
  sentCard: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: accent.border, backgroundColor: Platform?.OS === "android" ? "#2b1d15" : "rgba(235, 120, 37, 0.12)", overflow: "hidden" },
  pressed: { opacity: 0.78 },
});
