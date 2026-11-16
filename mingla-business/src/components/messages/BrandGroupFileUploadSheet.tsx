import React, { useEffect, useState } from "react";
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

import { color, radius, scrim, space } from "../../constants/designSystem";
import {
  prepareBrandGroupFiles,
  type PreparedBrandGroupFile,
} from "../../services/brandGroupFilesService";
import { Icon } from "../ui/Icon";
import { pickBrandGroupFiles } from "./brandGroupFilePicker";
import {
  BrandGroupFilePermissionError,
  type BrandGroupFileSource,
  type BrandGroupPickedFile,
  type BrandGroupPickOptions,
} from "./brandGroupFilePickerShared";

/**
 * #3720 picker sheet. #4304 (media speed): the sheet now only picks, shrinks
 * (native photos) and prepares; it hands the prepared files to the thread's
 * upload queue and closes, so the files show in the conversation at once with
 * their progress, and a failure stays there with Retry.
 *
 * #4255 W5: Mingla team chats reuse this sheet. They pass `onPicked`, which
 * receives the picked (and, on phones, shrunk) files instead of the Brand group
 * prepare step, plus their own subtitle, photos label and picker options.
 */
export function BrandGroupFileUploadSheet({
  visible,
  conversationId,
  actorMode,
  onClose,
  onQueued,
  onPicked,
  pickOptions,
  remaining = 10,
  copy,
}: {
  visible: boolean;
  conversationId: string;
  actorMode: "brand" | "support";
  onClose: () => void;
  onQueued: (prepared: PreparedBrandGroupFile[]) => void;
  onPicked?: (picked: BrandGroupPickedFile[]) => void;
  pickOptions?: BrandGroupPickOptions;
  remaining?: number;
  copy?: { title: string; subtitle: string; camera: string; photos: string; files: string; close: string };
}): React.ReactElement {
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!visible) setPreparing(false);
  }, [visible]);

  async function choose(source: BrandGroupFileSource): Promise<void> {
    if (preparing) return;
    setPreparing(true);
    try {
      const picked = await pickBrandGroupFiles(source, Math.max(1, remaining), pickOptions);
      if (!picked.length) return;
      if (onPicked) {
        onPicked(picked);
        onClose();
        return;
      }
      const prepared = await prepareBrandGroupFiles({ conversationId, actorMode, files: picked });
      onQueued(prepared);
      onClose();
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!preparing) onClose(); }}>
      <View style={[styles.overlay, Platform.OS === "web" ? styles.overlayCentered : styles.overlayBottom]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close file picker" style={StyleSheet.absoluteFill} onPress={() => { if (!preparing) onClose(); }} />
        <View style={[styles.sheet, Platform.OS === "web" && styles.sheetWeb]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{copy?.title ?? "Add files"}</Text>
              <Text style={styles.subtitle}>{copy?.subtitle ?? "Up to 10 files, 100 MB each. Access follows this Brand group."}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={copy?.close ?? "Close"} disabled={preparing} onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={18} color={preparing ? color.text3 : color.text1} />
            </Pressable>
          </View>

          <View style={styles.choices}>
            {Platform.OS !== "web" ? <SourceButton icon="scan" label={copy?.camera ?? "Camera"} onPress={() => void choose("camera")} disabled={preparing} /> : null}
            <SourceButton icon="grid" label={copy?.photos ?? "Photos & video"} onPress={() => void choose("photos")} disabled={preparing} />
            <SourceButton icon="upload" label={copy?.files ?? "Browse files"} onPress={() => void choose("files")} disabled={preparing} />
            {preparing ? <ActivityIndicator color={color.text2} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SourceButton({ icon, label, onPress, disabled }: { icon: "scan" | "grid" | "upload"; label: string; onPress: () => void; disabled: boolean }): React.ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.sourceButton}>
      <View style={styles.sourceIcon}><Icon name={icon} size={20} color={color.text1} /></View>
      <Text style={styles.sourceText}>{label}</Text>
      <Icon name="chevR" size={18} color={color.text3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: scrim.modal, padding: space[4] },
  overlayBottom: { justifyContent: "flex-end" },
  overlayCentered: { justifyContent: "center", alignItems: "center" },
  sheet: { width: "100%", maxHeight: "82%", backgroundColor: color.canvas, borderRadius: radius.xl, borderWidth: 1, borderColor: color.lineStrong, padding: space[6], gap: space[6] },
  sheetWeb: { maxWidth: 560 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: space[4] },
  headerCopy: { flex: 1 },
  title: { color: color.text1, fontSize: 20, fontWeight: "800" },
  subtitle: { color: color.text2, fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  choices: { gap: space[2] },
  sourceButton: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: space[4], paddingHorizontal: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.fill.tile },
  sourceIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  sourceText: { color: color.text1, fontSize: 15, fontWeight: "700", flex: 1 },
});
