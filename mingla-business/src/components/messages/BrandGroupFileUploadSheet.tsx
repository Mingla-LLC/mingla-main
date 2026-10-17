import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import {
  finalizeBrandGroupFile,
  prepareBrandGroupFiles,
  uploadPreparedBrandGroupFile,
  type PreparedBrandGroupFile,
} from "../../services/brandGroupFilesService";
import { Icon } from "../ui/Icon";
import { pickBrandGroupFiles } from "./brandGroupFilePicker";
import { BrandGroupFilePermissionError, type BrandGroupFileSource } from "./brandGroupFilePickerShared";

type UploadState = "queued" | "uploading" | "finalizing" | "complete" | "failed";
interface UploadItem {
  prepared: PreparedBrandGroupFile;
  progress: number;
  state: UploadState;
  uploaded: boolean;
  error: string | null;
}

export function BrandGroupFileUploadSheet({
  visible,
  conversationId,
  actorMode,
  onClose,
  onUploaded,
}: {
  visible: boolean;
  conversationId: string;
  actorMode: "brand" | "support";
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
}): React.ReactElement {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!visible) {
      setItems([]);
      setPreparing(false);
    }
  }, [visible]);

  const update = useCallback((fileId: string, patch: Partial<UploadItem>): void => {
    setItems((current) => current.map((item) => item.prepared.fileId === fileId ? { ...item, ...patch } : item));
  }, []);

  const transfer = useCallback(async (item: UploadItem): Promise<void> => {
    const fileId = item.prepared.fileId;
    try {
      if (!item.uploaded) {
        update(fileId, { state: "uploading", error: null });
        await uploadPreparedBrandGroupFile(item.prepared, (progress) => update(fileId, { progress }));
        update(fileId, { uploaded: true, progress: 1, state: "finalizing" });
      } else {
        update(fileId, { state: "finalizing", error: null });
      }
      await finalizeBrandGroupFile(fileId);
      update(fileId, { state: "complete", progress: 1, uploaded: true });
      await onUploaded();
    } catch (cause) {
      update(fileId, {
        state: "failed",
        error: cause instanceof Error ? cause.message : "Couldn't share this file. Try again.",
      });
    }
  }, [onUploaded, update]);

  async function choose(source: BrandGroupFileSource): Promise<void> {
    if (preparing) return;
    setPreparing(true);
    try {
      const picked = await pickBrandGroupFiles(source, 10);
      if (!picked.length) return;
      const prepared = await prepareBrandGroupFiles({ conversationId, actorMode, files: picked });
      const next = prepared.map((file): UploadItem => ({
        prepared: file,
        progress: 0,
        state: "queued",
        uploaded: false,
        error: null,
      }));
      setItems(next);
      for (const item of next) await transfer(item);
    } catch (cause) {
      if (cause instanceof BrandGroupFilePermissionError) {
        Alert.alert(cause.source === "camera" ? "Camera access is off" : "Photo access is off", "Allow access in device settings, then try again.");
      } else {
        Alert.alert("Files not added", cause instanceof Error ? cause.message : "Try again.");
      }
    } finally {
      setPreparing(false);
    }
  }

  const busy = preparing || items.some((item) => item.state === "queued" || item.state === "uploading" || item.state === "finalizing");
  const allComplete = items.length > 0 && items.every((item) => item.state === "complete");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={[styles.overlay, Platform.OS === "web" ? styles.overlayCentered : styles.overlayBottom]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close file picker" style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onClose(); }} />
        <View style={[styles.sheet, Platform.OS === "web" && styles.sheetWeb]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{items.length ? "Sharing files" : "Add files"}</Text>
              <Text style={styles.subtitle}>Up to 10 files, 100 MB each. Access follows this Brand group.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" disabled={busy} onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={18} color={busy ? textTokens.tertiary : textTokens.primary} />
            </Pressable>
          </View>

          {!items.length ? (
            <View style={styles.choices}>
              {Platform.OS !== "web" ? <SourceButton icon="scan" label="Camera" onPress={() => void choose("camera")} disabled={preparing} /> : null}
              <SourceButton icon="grid" label="Photos & video" onPress={() => void choose("photos")} disabled={preparing} />
              <SourceButton icon="upload" label="Browse files" onPress={() => void choose("files")} disabled={preparing} />
              {preparing ? <ActivityIndicator color={accent.warm} /> : null}
            </View>
          ) : (
            <View style={styles.items}>
              {items.map((item) => (
                <View key={item.prepared.fileId} style={styles.item}>
                  <View style={styles.fileIcon}><Icon name={item.state === "complete" ? "check" : "upload"} size={18} color={item.state === "complete" ? "#62d9a0" : accent.warm} /></View>
                  <View style={styles.itemCopy}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.prepared.name}</Text>
                    <Text style={[styles.status, item.state === "failed" && styles.statusError]}>
                      {item.state === "uploading" ? `${Math.round(item.progress * 100)}% uploaded` :
                        item.state === "finalizing" ? "Saving to the shared Drive folder…" :
                        item.state === "complete" ? "Shared" : item.error || "Waiting"}
                    </Text>
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(item.progress * 100)}%` }]} /></View>
                  </View>
                  {item.state === "failed" ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${item.prepared.name}`} onPress={() => void transfer(item)} style={styles.retry}>
                      <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {allComplete ? (
                <Pressable accessibilityRole="button" onPress={onClose} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SourceButton({ icon, label, onPress, disabled }: { icon: "scan" | "grid" | "upload"; label: string; onPress: () => void; disabled: boolean }): React.ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.sourceButton}>
      <View style={styles.sourceIcon}><Icon name={icon} size={20} color={accent.warm} /></View>
      <Text style={styles.sourceText}>{label}</Text>
      <Icon name="chevR" size={18} color={textTokens.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.66)", padding: spacing.md },
  overlayBottom: { justifyContent: "flex-end" },
  overlayCentered: { justifyContent: "center", alignItems: "center" },
  sheet: { width: "100%", maxHeight: "82%", backgroundColor: canvas.profile, borderRadius: radius.xl, borderWidth: 1, borderColor: glass.border.profileElevated, padding: spacing.lg, gap: spacing.lg },
  sheetWeb: { maxWidth: 560 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerCopy: { flex: 1 },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
  subtitle: { color: textTokens.secondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  choices: { gap: spacing.sm },
  sourceButton: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  sourceIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235,120,37,0.12)" },
  sourceText: { color: textTokens.primary, fontSize: 15, fontWeight: "700", flex: 1 },
  items: { gap: spacing.sm },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: glass.tint.profileElevated, borderWidth: 1, borderColor: glass.border.profileElevated },
  fileIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  itemCopy: { flex: 1, minWidth: 0, gap: 4 },
  fileName: { color: textTokens.primary, fontSize: 13, fontWeight: "700" },
  status: { color: textTokens.tertiary, fontSize: 11 },
  statusError: { color: "#ff8b8b" },
  progressTrack: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.09)" },
  progressFill: { height: 3, backgroundColor: accent.warm },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryText: { color: accent.warm, fontSize: 12, fontWeight: "800" },
  doneButton: { minHeight: 48, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: accent.warm },
  doneText: { color: "#101216", fontWeight: "800", fontSize: 15 },
});
