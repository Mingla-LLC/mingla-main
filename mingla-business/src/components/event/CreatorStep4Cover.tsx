/**
 * Wizard Step 4 — Cover.
 *
 * Designer source: screens-creator.jsx lines 163-184 (CreatorStep4).
 * Event cover editor. Uploaded image/GIF/video media is canonical; the
 * hue grid remains the fallback when no uploaded media is present.
 *
 * Per Cycle 3 spec §3.9 Step 4.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import {
  EventCoverMediaError,
  EVENT_COVER_UPLOAD_LIMIT_COPY,
  uploadEventCoverMedia,
} from "../../services/eventCoverMediaService";
import {
  createEventCoverVideoUploadIntent,
  EVENT_COVER_MAX_SOURCE_VIDEO_BYTES,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY,
  EVENT_COVER_VIDEO_PROCESSING_COPY,
  EventCoverVideoProcessingError,
  type EventCoverVideoApplyMode,
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
} from "../../services/eventCoverVideoProcessingService";
import { Button } from "../ui/Button";
import { EventCover } from "../ui/EventCover";
import {
  EventCoverMedia,
  type EventCoverMediaErrorEvent,
} from "../ui/EventCoverMedia";

import { type StepBodyProps } from "./types";
import { useAuth } from "../../context/AuthContext";
import { isBusinessAuthNotReadyError } from "../../utils/authReadiness";
import {
  validateNativeTrimmedEventCoverVideo,
  type NativeTrimmedVideoUploadFields,
} from "../../utils/eventCoverNativeVideo";

const HUE_TILES: readonly number[] = [25, 100, 180, 220, 290, 320] as const;

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  onShowToast,
  coverMediaEventId,
  coverMediaApplyMode = "draft_auto",
  onCoverVideoProcessingChange,
}) => {
  const { isAuthReady } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(
    null,
  );
  const [videoStatusText, setVideoStatusText] = useState<string | null>(null);
  const [videoErrorText, setVideoErrorText] = useState<string | null>(null);

  useEffect(() => {
    setMediaDisplayError(null);
  }, [draft.coverMediaUrl]);

  const handleSelectHue = useCallback(
    (hue: number): void => {
      updateDraft({ coverHue: hue });
    },
    [updateDraft],
  );

  const showUploadError = useCallback(
    (error: unknown): void => {
      if (error instanceof EventCoverMediaError) {
        switch (error.code) {
          case "permission_denied":
            onShowToast("Photo library permission is needed to add a cover.");
            return;
          case "unsupported_type":
            if (/JPEG|PNG|WebP|GIF/.test(error.message)) {
              onShowToast("Choose a JPEG, PNG, WebP, or GIF.");
              return;
            }
            if (/MP4\/MOV\/WebM|MP4, MOV, or WebM/.test(error.message)) {
              onShowToast(
                "Choose an MP4, MOV, or WebM video up to 15 seconds.",
              );
              return;
            }
            onShowToast("Choose an image, GIF, or MP4/MOV/WebM video.");
            return;
          case "file_too_large":
            onShowToast("Covers must be 30 MB or smaller.");
            return;
          case "video_too_long":
            onShowToast(
              "Cover videos must be 15 seconds or shorter. Choose another video or trim this one.",
            );
            return;
          case "video_duration_unknown":
            onShowToast(
              "We couldn't read this video's duration. Try a 15-second MP4, MOV, or WebM.",
            );
            return;
          case "missing_server_event_id":
            onShowToast("This event needs a server draft before media upload.");
            return;
          case "display_failed":
            onShowToast(
              "Uploaded, but this cover could not be displayed. Try another image or video.",
            );
            return;
          case "upload_failed":
            onShowToast("Cover upload failed. Try again.");
            return;
        }
      }
      onShowToast("Cover upload failed. Try again.");
    },
    [onShowToast],
  );

  const showVideoProcessingError = useCallback(
    (error: unknown): void => {
      const message = (() => {
        if (isBusinessAuthNotReadyError(error)) {
          return "Finishing sign-in before upload. Try again in a moment.";
        }
        if (error instanceof EventCoverVideoProcessingError) {
          if (error.code === "provider_not_configured") {
            return EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY;
          }
          if (error.code === "source_upload_failed") {
            return "Video upload failed before processing. Try again.";
          }
          return error.message;
        }
        return "Video cover processing failed. Try another video.";
      })();
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn("[CreatorStep4Cover] video processing error", {
          code:
            error instanceof EventCoverVideoProcessingError
              ? error.code
              : isBusinessAuthNotReadyError(error)
                ? error.code
                : "unknown",
          message,
          rawMessage: error instanceof Error ? error.message : String(error),
        });
      }
      setVideoStatusText(null);
      setVideoErrorText(message);
      onShowToast(message);
    },
    [onShowToast],
  );

  const ensureMediaPermission = useCallback(async (): Promise<boolean> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showUploadError(
        new EventCoverMediaError(
          "permission_denied",
          "Photo library permission denied.",
        ),
      );
      return false;
    }
    return true;
  }, [showUploadError]);

  const uploadPickedAsset = useCallback(
    async (
      asset: ImagePicker.ImagePickerAsset,
      eventId: string,
    ): Promise<void> => {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[CreatorStep4Cover] picked cover asset", {
          duration: asset.duration,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          mimeType: asset.mimeType,
          type: asset.type,
          uri: asset.uri,
        });
      }
      const upload = await uploadEventCoverMedia({
        uri: asset.uri,
        brandId: draft.brandId,
        eventId,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        durationMs: typeof asset.duration === "number" ? asset.duration : null,
        pickerType: asset.type,
      });
      setMediaDisplayError(null);
      updateDraft({
        coverMediaUrl: upload.publicUrl,
        coverMediaType: upload.mediaType,
      });
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[CreatorStep4Cover] cover media draft update queued", {
          coverMediaType: upload.mediaType,
          coverMediaUrl: upload.publicUrl,
          storagePath: upload.storagePath,
        });
      }
      onShowToast("Cover updated.");
    },
    [draft.brandId, onShowToast, updateDraft],
  );

  const processPickedVideo = useCallback(
    async (
      asset: ImagePicker.ImagePickerAsset,
      eventId: string,
      applyMode: EventCoverVideoApplyMode,
      uploadFields: NativeTrimmedVideoUploadFields,
    ): Promise<void> => {
      setVideoStatusText("Preparing secure video upload...");
      setVideoErrorText(null);
      if (__DEV__) {
        console.info("[CreatorStep4Cover] upload-intent-start", {
          applyMode,
          eventId,
          eventIdSource: coverMediaEventId === undefined ? "draft.id" : "coverMediaEventId",
          brandId: draft.brandId,
          isAuthReady,
          sourceFileName: asset.fileName,
          sourceMimeType: asset.mimeType,
          sourceBytes: uploadFields.sourceBytes,
          sourceDurationMs: uploadFields.sourceDurationMs,
          trimStartMs: uploadFields.trimStartMs,
          trimEndMs: uploadFields.trimEndMs,
        });
      }
      const intent = await createEventCoverVideoUploadIntent({
        applyMode,
        brandId: draft.brandId,
        eventId,
        sourceBytes: uploadFields.sourceBytes,
        sourceDurationMs: uploadFields.sourceDurationMs,
        sourceFileName: asset.fileName,
        sourceMimeType: asset.mimeType,
        trimEndMs: uploadFields.trimEndMs,
        trimStartMs: uploadFields.trimStartMs,
      });
      if (__DEV__) {
        console.info("[CreatorStep4Cover] upload-intent-success", {
          jobId: intent.jobId,
        });
      }
      setVideoStatusText("Uploading video for processing...");
      if (__DEV__) {
        console.info("[CreatorStep4Cover] source-upload-start", {
          jobId: intent.jobId,
        });
      }
      await uploadEventCoverVideoSource({
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        upload: intent.upload,
        uri: asset.uri,
      });
      if (__DEV__) {
        console.info("[CreatorStep4Cover] source-upload-success", {
          jobId: intent.jobId,
        });
      }
      setVideoStatusText("Compressing cover video...");
      if (__DEV__) {
        console.info("[CreatorStep4Cover] status-poll-start", {
          jobId: intent.jobId,
        });
      }
      const status = await waitForEventCoverVideoReady(intent.jobId);
      if (status.processedUrl === null) {
        throw new EventCoverVideoProcessingError(
          "processed_url_missing",
          "Video processing finished without a playable cover.",
        );
      }
      setMediaDisplayError(null);
      setVideoErrorText(null);
      updateDraft({
        coverMediaType: "video",
        coverMediaUrl: status.processedUrl,
      });
      onShowToast(
        applyMode === "published_manual"
          ? "Video ready. Save changes to publish the new cover."
          : "Cover video processed.",
      );
    },
    [coverMediaEventId, draft.brandId, isAuthReady, onShowToast, updateDraft],
  );

  const eventIdForUpload = useCallback((): string | null => {
    const eventId = coverMediaEventId ?? draft.id;
    if (eventId.trim().length === 0) {
      showUploadError(
        new EventCoverMediaError(
          "missing_server_event_id",
          "Missing server event id.",
        ),
      );
      return null;
    }
    return eventId;
  }, [coverMediaEventId, draft.id, showUploadError]);

  const pickImageOrGifCover = useCallback(async (): Promise<void> => {
    if (uploading) return;
    if (!isAuthReady) {
      const message = "Finishing sign-in before upload. Try again in a moment.";
      setVideoStatusText(null);
      setVideoErrorText(message);
      onShowToast(message);
      return;
    }
    if (!(await ensureMediaPermission())) return;

    const eventId = eventIdForUpload();
    if (eventId === null) return;

    setUploading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      await uploadPickedAsset(result.assets[0], eventId);
    } catch (error) {
      showUploadError(error);
    } finally {
      setUploading(false);
    }
  }, [
    ensureMediaPermission,
    eventIdForUpload,
    isAuthReady,
    onShowToast,
    showUploadError,
    uploadPickedAsset,
    uploading,
  ]);

  const pickVideoCover = useCallback(async (): Promise<void> => {
    if (uploading) return;
    if (!isAuthReady) {
      const message = "Finishing sign-in before upload. Try again in a moment.";
      setVideoStatusText(null);
      setVideoErrorText(message);
      onShowToast(message);
      return;
    }
    if (!(await ensureMediaPermission())) return;

    const eventId = eventIdForUpload();
    if (eventId === null) return;

    setUploading(true);
    onCoverVideoProcessingChange?.(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: true,
        quality: 1,
        videoMaxDuration: 15,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[CreatorStep4Cover] picked cover asset", {
          duration: asset.duration,
          applyMode: coverMediaApplyMode,
          brandId: draft.brandId,
          eventId,
          eventIdSource: coverMediaEventId === undefined ? "draft.id" : "coverMediaEventId",
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          isAuthReady,
          mimeType: asset.mimeType,
          type: asset.type,
          uri: asset.uri,
        });
      }
      const validation = validateNativeTrimmedEventCoverVideo(asset, {
        maxDurationMs: EVENT_COVER_MAX_VIDEO_DURATION_MS,
        maxSourceBytes: EVENT_COVER_MAX_SOURCE_VIDEO_BYTES,
      });
      if (!validation.ok) {
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn("[CreatorStep4Cover] native-trimmed video rejected", {
            code: validation.code,
            duration: asset.duration,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            mimeType: asset.mimeType,
            type: asset.type,
            uri: asset.uri,
          });
        }
        setVideoStatusText(null);
        setVideoErrorText(validation.message);
        onShowToast(validation.message);
        return;
      }
      await processPickedVideo(
        asset,
        eventId,
        coverMediaApplyMode,
        validation.uploadFields,
      );
      setVideoStatusText(null);
    } catch (error) {
      if (error instanceof EventCoverMediaError) showUploadError(error);
      else showVideoProcessingError(error);
    } finally {
      setUploading(false);
      onCoverVideoProcessingChange?.(false);
    }
  }, [
    ensureMediaPermission,
    eventIdForUpload,
    coverMediaApplyMode,
    coverMediaEventId,
    onCoverVideoProcessingChange,
    onShowToast,
    processPickedVideo,
    showVideoProcessingError,
    showUploadError,
    uploading,
    isAuthReady,
  ]);

  const handlePickCover = useCallback((): void => {
    if (uploading) return;
    Alert.alert("Choose cover media", EVENT_COVER_UPLOAD_LIMIT_COPY, [
      {
        text: "Image or GIF",
        onPress: () => {
          void pickImageOrGifCover();
        },
      },
      {
        text: "Video",
        onPress: () => {
          void pickVideoCover();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [
    pickImageOrGifCover,
    pickVideoCover,
    uploading,
  ]);

  const handleRemoveCover = useCallback((): void => {
    setMediaDisplayError(null);
    setVideoStatusText(null);
    setVideoErrorText(null);
    updateDraft({ coverMediaUrl: null, coverMediaType: null });
    onShowToast("Uploaded cover removed.");
  }, [onShowToast, updateDraft]);

  const handleMediaRenderError = useCallback(
    (event: EventCoverMediaErrorEvent): void => {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[CreatorStep4Cover] cover media render failed", event);
      }
      setMediaDisplayError(
        "Uploaded, but this cover could not be displayed. Try another image or video.",
      );
      onShowToast(
        "Uploaded, but this cover could not be displayed. Try another image or video.",
      );
    },
    [onShowToast],
  );

  return (
    <View>
      {/* Cover preview */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover</Text>
        <View style={styles.coverPreview}>
          <EventCoverMedia
            hue={draft.coverHue}
            mediaUrl={draft.coverMediaUrl}
            mediaType={draft.coverMediaType}
            radius={radiusTokens.lg}
            label="cover · 16:9"
            height={180}
            onMediaError={handleMediaRenderError}
          />
        </View>
        <View style={styles.actionRow}>
          <Button
            label={
              draft.coverMediaUrl === null ? "Upload cover" : "Replace cover"
            }
            leadingIcon="upload"
            variant="secondary"
            size="md"
            shape="square"
            onPress={handlePickCover}
            loading={uploading}
            disabled={uploading}
            style={styles.actionButton}
          />
          {draft.coverMediaUrl !== null ? (
            <Button
              label="Remove"
              variant="ghost"
              size="md"
              shape="square"
              onPress={handleRemoveCover}
              disabled={uploading}
              style={styles.removeButton}
            />
          ) : null}
        </View>
        <Text style={styles.uploadLimitText}>
          {EVENT_COVER_UPLOAD_LIMIT_COPY} {EVENT_COVER_VIDEO_PROCESSING_COPY}
        </Text>
        {videoStatusText !== null ? (
          <Text style={styles.videoStatusText}>{videoStatusText}</Text>
        ) : null}
        {videoErrorText !== null ? (
          <Text accessibilityRole="alert" style={styles.videoErrorText}>
            {videoErrorText}
          </Text>
        ) : null}
        {mediaDisplayError !== null ? (
          <Text accessibilityRole="alert" style={styles.mediaErrorText}>
            {mediaDisplayError}
          </Text>
        ) : null}
      </View>

      {/* Cover style grid — fallback for events without uploaded media. */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover style</Text>
        <View style={styles.tileGrid}>
          {HUE_TILES.map((hue) => {
            const active = draft.coverHue === hue;
            return (
              <Pressable
                key={hue}
                onPress={() => handleSelectHue(hue)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Cover hue ${hue}${active ? " (selected)" : ""}`}
                style={[styles.tile, active && styles.tileActive]}
              >
                <View style={styles.tileInner}>
                  <EventCover hue={hue} radius={radiusTokens.md} label="" />
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.comingSoonCaption}>
          Used whenever uploaded media is removed or fails to load.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  coverPreview: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  removeButton: {
    minWidth: 96,
  },
  uploadLimitText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  mediaErrorText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  videoStatusText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    marginTop: spacing.xs,
  },
  videoErrorText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  comingSoonCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.md,
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tile: {
    width: "31%",
    aspectRatio: 1,
    padding: 2,
    borderRadius: radiusTokens.md + 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileActive: {
    borderColor: accent.warm,
  },
  tileInner: {
    flex: 1,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
});
