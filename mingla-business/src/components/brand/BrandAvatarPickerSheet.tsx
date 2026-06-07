/**
 * BrandAvatarPickerSheet — single-purpose bottom sheet for choosing a
 * brand profile photo. Mirrors BrandCoverPickerSheet's Upload tab in
 * isolation (no Pexels/GIPHY tabs — avatars are device-only per
 * ORCH-0807 SPEC §2 non-goals).
 *
 * State machine:
 *   idle        → "Pick from device" CTA visible
 *   picking     → spinner; ImagePicker.launchImageLibraryAsync open
 *   processing  → spinner with "Preparing photo…" copy; manipulator runs
 *                 inside uploadAvatar
 *   uploading   → spinner with "Uploading…" copy; bytes flowing
 *   error       → inline error message; CTA flips to "Try again"
 *   success     → onPicked fires, sheet closes via onClose
 *
 * Native crop is the user-facing primary mechanism: we pass
 * `allowsEditing: true, aspect: [1, 1]` to the picker so Android enforces
 * a square crop and iOS shows a square overlay hint. The expo-image-
 * manipulator center-crop step inside uploadBrandAvatar is the
 * belt-and-braces guarantee for iOS (where aspect is advisory).
 *
 * MUST be rendered as a child of the parent View (not a sibling Fragment)
 * per the `feedback_rn_sub_sheet_must_render_inside_parent` global rule —
 * native Modal sibling mounts compete at the OS root layer.
 *
 * Per ORCH-0807 SPEC §6.4.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandAvatarUpload } from "../../hooks/useBrandAvatarUpload";
import { BRAND_AVATAR_MAX_BYTES, BrandAvatarError } from "../../utils/brandAvatarRules";
import {
  pickBrowserFiles,
  revokeBrowserPickedFiles,
  type BrowserPickedFile,
} from "../../utils/browserFilePicker";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
  type PlatformImagePickerResult,
} from "../../utils/platformImagePicker";

type Step = "idle" | "picking" | "processing" | "uploading" | "error";

export interface BrandAvatarPickerSheetProps {
  visible: boolean;
  brandId: string;
  accountId: string;
  existingDescription: string | null;
  currentPhotoUrl: string | null;
  onClose: () => void;
  onPicked: (result: { publicUrl: string }) => void;
  onErrorToast?: (message: string) => void;
}

export const BrandAvatarPickerSheet: React.FC<BrandAvatarPickerSheetProps> = ({
  visible,
  brandId,
  accountId,
  existingDescription,
  currentPhotoUrl,
  onClose,
  onPicked,
  onErrorToast,
}) => {
  const [step, setStep] = useState<Step>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { uploadAvatar, clearError } = useBrandAvatarUpload();

  // Reset state every time the sheet (re-)opens.
  useEffect(() => {
    if (visible) {
      setStep("idle");
      setErrorMessage(null);
      clearError();
    }
  }, [visible, clearError]);

  const handlePick = useCallback(async (): Promise<void> => {
    void Haptics.selectionAsync().catch(() => undefined);

    if (Platform.OS !== "web") {
      // Permission gate — request only when needed.
      const permission = await requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStep("error");
        setErrorMessage(
          "We need permission to your photo library to pick an avatar.",
        );
        return;
      }
    }

    setStep("picking");
    setErrorMessage(null);

    let pickerResult: PlatformImagePickerResult;
    let browserFiles: BrowserPickedFile[] = [];
    try {
      if (Platform.OS === "web") {
        const result = await pickBrowserFiles({
          accept: "image/jpeg,image/png,image/webp",
          maxBytes: BRAND_AVATAR_MAX_BYTES,
          maxFiles: 1,
        });
        browserFiles = result.files;
        pickerResult = {
          canceled: result.canceled,
          assets: result.files.map((file) => ({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.mimeType,
            uri: file.uri,
          })),
        };
      } else {
        pickerResult = await launchImageLibraryAsync({
          mediaTypes: ["images"],
          // Native crop UI — Android enforces 1:1 from `aspect`; iOS shows
          // a 1:1 overlay hint as advisory. We trust the user with whatever
          // they crop; no service-side square enforcement (operator decision
          // 2026-05-12 — see DEC entry for ORCH-0807 + I-PROPOSED-BG
          // BRAND_AVATAR_NATIVE_CROP_OFFERED).
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
        });
      }
    } catch (error) {
      setStep("error");
      setErrorMessage(error instanceof Error ? error.message : "Couldn't open photos. Try again.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => undefined,
      );
      return;
    }

    if (pickerResult.canceled || pickerResult.assets.length === 0) {
      // User backed out of picker — return to idle without error.
      setStep("idle");
      return;
    }
    const asset = pickerResult.assets[0];
    if (asset === undefined) {
      setStep("idle");
      return;
    }

    setStep("processing");

    try {
      const result = await uploadAvatar({
        brandId,
        accountId,
        existingDescription,
        previousPhotoUrl: currentPhotoUrl,
        asset: {
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
        },
      });

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => undefined);

      onPicked({ publicUrl: result.publicUrl });
      onClose();
    } catch (err) {
      const message =
        err instanceof BrandAvatarError
          ? err.message
          : "Couldn't save photo. Tap to try again.";
      setStep("error");
      setErrorMessage(message);
      onErrorToast?.(message);
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error,
      ).catch(() => undefined);
    } finally {
      revokeBrowserPickedFiles(browserFiles);
    }
  }, [
    brandId,
    accountId,
    existingDescription,
    currentPhotoUrl,
    uploadAvatar,
    onPicked,
    onClose,
    onErrorToast,
  ]);

  const isBusy =
    step === "picking" || step === "processing" || step === "uploading";

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        <Text style={styles.title}>Choose a profile photo</Text>
        <Text style={styles.body}>
          Pick a square photo, or pick any photo and crop it square. JPEG,
          PNG, or WebP. Up to 5 MB.
        </Text>

        {step === "error" && errorMessage !== null ? (
          <View style={styles.errorRow}>
            <Icon name="flag" size={16} color={semantic.error} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isBusy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={accent.warm} />
            <Text style={styles.busyText}>
              {step === "picking"
                ? "Opening photos…"
                : step === "processing"
                  ? "Preparing photo…"
                  : "Uploading…"}
            </Text>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <View style={styles.actionCell}>
            <Button
              label="Cancel"
              variant="ghost"
              size="md"
              onPress={onClose}
              disabled={isBusy}
              fullWidth
              accessibilityLabel="Cancel photo upload"
            />
          </View>
          <View style={styles.actionCell}>
            <Button
              label={step === "error" ? "Try again" : "Pick from device"}
              variant="primary"
              size="md"
              onPress={handlePick}
              disabled={isBusy}
              leadingIcon="upload"
              fullWidth
              accessibilityLabel="Pick a profile photo from your device"
            />
          </View>
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  errorText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: semantic.error,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  busyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionCell: {
    flex: 1,
  },
});
