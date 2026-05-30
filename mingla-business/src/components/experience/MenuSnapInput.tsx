/**
 * ORCH-0881 — Menu capture/upload for Ve5 experience generation.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { MenuFilePayload } from "../../services/experienceGenerationService";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

export interface MenuSnapInputProps {
  visible: boolean;
  onFilesReady: (files: MenuFilePayload[]) => void;
  onCancel: () => void;
}

function inferMime(uri: string, fallback: string): MenuFilePayload["mime_type"] {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  return fallback as MenuFilePayload["mime_type"];
}

async function uriToMenuFile(
  uri: string,
  mime: MenuFilePayload["mime_type"],
): Promise<MenuFilePayload> {
  const data_base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const padding = data_base64.endsWith("==") ? 2 : data_base64.endsWith("=") ? 1 : 0;
  const size = Math.floor((data_base64.length * 3) / 4) - padding;
  if (size > MAX_TOTAL_BYTES) {
    throw new Error("Menu upload exceeds 10 MB. Try fewer pages or a smaller photo.");
  }
  return { mime_type: mime, data_base64 };
}

export const MenuSnapInput: React.FC<MenuSnapInputProps> = ({
  visible,
  onFilesReady,
  onCancel,
}) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const finishWithUri = useCallback(
    async (uri: string, mime: MenuFilePayload["mime_type"]) => {
      setIsBusy(true);
      setErrorMessage(null);
      try {
        const file = await uriToMenuFile(uri, mime);
        onFilesReady([file]);
      } catch (e) {
        setErrorMessage(
          e instanceof Error ? e.message : "Couldn't read that file. Try again.",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [onFilesReady],
  );

  const handleCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setErrorMessage("Camera permission is required to photograph your menu.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = (asset.mimeType === "image/png"
      ? "image/png"
      : "image/jpeg") as MenuFilePayload["mime_type"];
    await finishWithUri(asset.uri, mime);
  }, [finishWithUri]);

  const handleLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrorMessage("Photo library permission is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = (asset.mimeType === "image/png"
      ? "image/png"
      : "image/jpeg") as MenuFilePayload["mime_type"];
    await finishWithUri(asset.uri, mime);
  }, [finishWithUri]);

  const handlePdf = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await finishWithUri(asset.uri, inferMime(asset.uri, "application/pdf"));
  }, [finishWithUri]);

  return (
    <Sheet visible={visible} onClose={onCancel} snapPoint="half">
      <View style={styles.body}>
        <Text style={styles.sheetTitle}>Add your menu</Text>
        <Text style={styles.hint}>
          Photograph or upload your menu. We&rsquo;ll suggest experiences for you to
          review — nothing publishes until you accept.
        </Text>
        {errorMessage !== null && (
          <Text style={styles.error} accessibilityRole="alert">
            {errorMessage}
          </Text>
        )}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={handleCamera}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Take photo of menu"
        >
          <Icon name="flash" size={22} color={textTokens.primary} />
          <Text style={styles.rowLabel}>Take photo</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={handleLibrary}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Choose menu photo from library"
        >
          <Icon name="plus" size={22} color={textTokens.primary} />
          <Text style={styles.rowLabel}>Choose from library</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={handlePdf}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Upload menu PDF"
        >
          <Icon name="list" size={22} color={textTokens.primary} />
          <Text style={styles.rowLabel}>Upload PDF</Text>
        </Pressable>
        {isBusy && (
          <Text style={styles.busy}>Preparing upload&hellip;</Text>
        )}
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  hint: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  error: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  busy: {
    textAlign: "center",
    color: textTokens.secondary,
    marginTop: spacing.sm,
  },
});
