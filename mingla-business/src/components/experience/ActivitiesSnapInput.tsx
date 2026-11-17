/**
 * Ve6 — Activities list capture/upload for Play experience generation.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { ExperienceFilePayload } from "../../services/experienceGenerationService";
import {
  pickBrowserFiles,
  readBrowserFileAsBase64,
  revokeBrowserPickedFiles,
  validateBrowserFile,
  type BrowserPickedFile,
} from "../../utils/browserFilePicker";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = "image/jpeg,image/png,image/webp,application/pdf";

export interface ActivitiesSnapInputProps {
  visible: boolean;
  onFilesReady: (files: ExperienceFilePayload[]) => void;
  onCancel: () => void;
}

function inferMime(file: BrowserPickedFile): ExperienceFilePayload["mime_type"] {
  const mime = file.mimeType;
  if (mime === "image/png" || mime === "image/jpeg" || mime === "application/pdf") {
    return mime;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

async function browserFileToExperienceFile(
  file: BrowserPickedFile,
): Promise<ExperienceFilePayload> {
  validateBrowserFile(file.file, {
    accept: ACCEPTED_FILE_TYPES,
    maxBytes: MAX_TOTAL_BYTES,
  });
  if (file.size > MAX_TOTAL_BYTES) {
    throw new Error("Upload exceeds 10 MB. Try fewer pages or a smaller photo.");
  }
  const data_base64 = await readBrowserFileAsBase64(file.file);
  return { mime_type: inferMime(file), data_base64 };
}

export const ActivitiesSnapInput: React.FC<ActivitiesSnapInputProps> = ({
  visible,
  onFilesReady,
  onCancel,
}) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const finishWithBrowserPick = useCallback(
    async (options: {
      accept: string;
      capture?: "environment";
      label: "photo" | "file";
    }) => {
      let files: BrowserPickedFile[] = [];
      setIsBusy(true);
      setErrorMessage(null);
      try {
        const result = await pickBrowserFiles({
          accept: options.accept,
          capture: options.capture,
          maxFiles: 1,
        });
        if (result.canceled || result.files.length === 0) return;
        files = result.files;
        const file = result.files[0];
        if (file === undefined) return;
        onFilesReady([await browserFileToExperienceFile(file)]);
      } catch (e) {
        setErrorMessage(
          e instanceof Error
            ? e.message
            : `Couldn't read that ${options.label}. Try again.`,
        );
      } finally {
        revokeBrowserPickedFiles(files);
        setIsBusy(false);
      }
    },
    [onFilesReady],
  );

  const handleCamera = useCallback(async () => {
    await finishWithBrowserPick({
      accept: "image/jpeg,image/png,image/webp",
      capture: "environment",
      label: "photo",
    });
  }, [finishWithBrowserPick]);

  const handleLibrary = useCallback(async () => {
    await finishWithBrowserPick({
      accept: "image/jpeg,image/png,image/webp",
      label: "photo",
    });
  }, [finishWithBrowserPick]);

  const handlePdf = useCallback(async () => {
    await finishWithBrowserPick({
      accept: "application/pdf,.pdf",
      label: "file",
    });
  }, [finishWithBrowserPick]);

  return (
    <Sheet visible={visible} onClose={onCancel} snapPoint="half">
      <View style={styles.body}>
        <Text style={styles.sheetTitle}>Add your activities list</Text>
        <Text style={styles.hint}>
          Photograph or upload your activities or packages sheet. We&rsquo;ll suggest
          experiences for you to review — nothing publishes until you accept.
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
          accessibilityLabel="Take photo of activities list"
        >
          <Icon name="flash" size={22} color={color.text1} />
          <Text style={styles.rowLabel}>Take photo</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={handleLibrary}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Choose activities photo from library"
        >
          <Icon name="plus" size={22} color={color.text1} />
          <Text style={styles.rowLabel}>Choose from library</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={handlePdf}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Upload activities PDF"
        >
          <Icon name="list" size={22} color={color.text1} />
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
    padding: space[4],
    gap: space[2],
  },
  sheetTitle: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
    marginBottom: space[1],
  },
  hint: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
    marginBottom: space[2],
  },
  error: {
    fontSize: type.caption.fontSize,
    color: color.danger,
    marginBottom: space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowLabel: {
    fontSize: type.body.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  busy: {
    textAlign: "center",
    color: color.text2,
    marginTop: space[2],
  },
});
