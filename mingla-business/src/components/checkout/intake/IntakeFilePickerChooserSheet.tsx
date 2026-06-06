/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeFilePickerChooserSheet />.
 *
 * Per DESIGN_ORCH-0880 §4.3.G.1. Compact bottom Sheet shown when buyer taps
 * "+ Choose file" on a file_upload question. Renders only the sources
 * enabled by the question's MIME allowlist:
 *   - "Take photo" + "Choose from library" when allow_images
 *   - "Browse files (PDF/doc)" when allow_pdfs OR allow_docs
 *
 * Wires:
 *   - expo-image-picker.launchCameraAsync (Take photo)
 *   - expo-image-picker.launchImageLibraryAsync (Library)
 *   - expo-document-picker.getDocumentAsync (Browse files)
 *
 * Returns the picked file via `onPick({ filename, mime_type, size_bytes,
 * body })` for the parent to forward to intakeSchemaService.uploadIntakeFile.
 *
 * Composes Sheet + Pressable + Icon — no new primitives. Sub-sheet renders
 * INSIDE IntakeQuestionFileUpload's children, NOT as Fragment sibling, per
 * `feedback_rn_sub_sheet_must_render_inside_parent.md`.
 *
 * Anon-tolerant per `feedback_anon_buyer_routes.md`: no useAuth import.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/Icon";
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../../utils/platformImagePicker";
import { Sheet } from "../../ui/Sheet";

export interface IntakePickedFile {
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Raw body to PUT to the signed URL. */
  body: Blob | ArrayBuffer | Uint8Array;
}

export interface IntakeFilePickerChooserSheetProps {
  visible: boolean;
  allowImages: boolean;
  allowPdfs: boolean;
  allowDocs: boolean;
  onPick: (file: IntakePickedFile) => void;
  onCancel: () => void;
  testID?: string;
}

const CHOOSER_HEIGHT = 360;

function inferMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".odt"))
    return "application/vnd.oasis.opendocument.text";
  return "application/octet-stream";
}

async function fetchUriAsBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return res.blob();
}

export const IntakeFilePickerChooserSheet: React.FC<
  IntakeFilePickerChooserSheetProps
> = ({ visible, allowImages, allowPdfs, allowDocs, onPick, onCancel, testID }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTakePhoto = useCallback(async () => {
    setErrorMessage(null);
    try {
      const perm = await requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErrorMessage(
          "Camera permission was denied. Enable it in Settings to take a photo.",
        );
        return;
      }
      const result = await launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset === undefined) return;
      const blob = await fetchUriAsBlob(asset.uri);
      const filename =
        asset.fileName ?? `camera-${Date.now()}.jpg`;
      onPick({
        filename,
        mime_type: asset.mimeType ?? inferMimeFromFilename(filename),
        size_bytes: asset.fileSize ?? blob.size,
        body: blob,
      });
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Couldn't open camera. Try again.",
      );
    }
  }, [onPick]);

  const handlePickFromLibrary = useCallback(async () => {
    setErrorMessage(null);
    try {
      const perm = await requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErrorMessage(
          "Photo library permission was denied. Enable it in Settings.",
        );
        return;
      }
      const result = await launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset === undefined) return;
      const blob = await fetchUriAsBlob(asset.uri);
      const filename = asset.fileName ?? `image-${Date.now()}.jpg`;
      onPick({
        filename,
        mime_type: asset.mimeType ?? inferMimeFromFilename(filename),
        size_bytes: asset.fileSize ?? blob.size,
        body: blob,
      });
    } catch (e) {
      setErrorMessage(
        e instanceof Error
          ? e.message
          : "Couldn't open photo library. Try again.",
      );
    }
  }, [onPick]);

  const handleBrowseFiles = useCallback(async () => {
    setErrorMessage(null);
    try {
      // Build the type allowlist for the document picker based on the
      // question's MIME flags. expo-document-picker accepts a `type` string
      // OR array of MIME globs.
      const types: string[] = [];
      if (allowPdfs) types.push("application/pdf");
      if (allowDocs) {
        types.push("application/msword");
        types.push(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        types.push("application/vnd.oasis.opendocument.text");
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: types.length > 0 ? types : "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset === undefined) return;
      const blob = await fetchUriAsBlob(asset.uri);
      onPick({
        filename: asset.name,
        mime_type: asset.mimeType ?? inferMimeFromFilename(asset.name),
        size_bytes: asset.size ?? blob.size,
        body: blob,
      });
    } catch (e) {
      setErrorMessage(
        e instanceof Error
          ? e.message
          : "Couldn't open file browser. Try again.",
      );
    }
  }, [allowPdfs, allowDocs, onPick]);

  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      snapPoint={CHOOSER_HEIGHT}
      testID={testID ?? "intake-file-picker-chooser"}
    >
      <View style={styles.container}>
        <Text style={styles.eyebrow} accessibilityRole="header">
          ADD FILE
        </Text>
        {errorMessage !== null ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">
            {errorMessage}
          </Text>
        ) : null}
        <View style={styles.actionsWrap}>
          {allowImages ? (
            <ChooserRow
              label="Take photo"
              icon="eye"
              onPress={() => {
                void handleTakePhoto();
              }}
            />
          ) : null}
          {allowImages ? (
            <ChooserRow
              label="Choose from library"
              icon="grid"
              onPress={() => {
                void handlePickFromLibrary();
              }}
            />
          ) : null}
          {allowPdfs || allowDocs ? (
            <ChooserRow
              label="Browse files (PDF, doc)"
              icon="list"
              onPress={() => {
                void handleBrowseFiles();
              }}
            />
          ) : null}
        </View>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel file picker"
          style={({ pressed }) => [
            styles.cancelBtn,
            pressed && styles.cancelBtnPressed,
          ]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </Sheet>
  );
};

interface ChooserRowProps {
  label: string;
  icon: IconName;
  onPress: () => void;
}

const ChooserRow: React.FC<ChooserRowProps> = ({ label, icon, onPress }) => (
  <Pressable
    onPress={onPress}
    hitSlop={4}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [
      styles.chooserRow,
      pressed && styles.chooserRowPressed,
    ]}
  >
    <View style={styles.chooserIconWrap}>
      <Icon name={icon} size={20} color={accent.warm} strokeWidth={2} />
    </View>
    <Text style={styles.chooserLabel}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  eyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.xs,
  },
  actionsWrap: {
    gap: spacing.xs,
  },
  chooserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minHeight: 56,
  },
  chooserRowPressed: {
    opacity: 0.7,
  },
  chooserIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  chooserLabel: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  cancelBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  cancelBtnPressed: {
    opacity: 0.7,
  },
  cancelLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    fontWeight: "500",
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    paddingHorizontal: spacing.sm,
  },
});

export default IntakeFilePickerChooserSheet;
