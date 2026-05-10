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
  EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS,
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

const HUE_TILES: readonly number[] = [25, 100, 180, 220, 290, 320] as const;

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  onShowToast,
  coverMediaEventId,
  coverMediaApplyMode = "draft_auto",
  onCoverVideoProcessingChange,
}) => {
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(
    null,
  );
  const [pendingVideo, setPendingVideo] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [videoStatusText, setVideoStatusText] = useState<string | null>(null);

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
      if (error instanceof EventCoverVideoProcessingError) {
        if (error.code === "provider_not_configured") {
          onShowToast(EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY);
          return;
        }
        if (error.code === "source_upload_failed") {
          onShowToast("Video upload failed before processing. Try again.");
          return;
        }
        onShowToast(error.message);
        return;
      }
      onShowToast("Video cover processing failed. Try another video.");
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
      startMs: number,
    ): Promise<void> => {
      const durationMs = typeof asset.duration === "number" ? asset.duration : null;
      if (durationMs === null || durationMs <= 0) {
        throw new EventCoverMediaError(
          "video_duration_unknown",
          "We couldn't read this video's duration.",
        );
      }
      const endMs = Math.min(startMs + EVENT_COVER_MAX_VIDEO_DURATION_MS, durationMs);
      if (endMs <= startMs) {
        throw new EventCoverMediaError("video_too_long", "Choose a longer video segment.");
      }
      setVideoStatusText("Preparing secure video upload...");
      const intent = await createEventCoverVideoUploadIntent({
        applyMode,
        brandId: draft.brandId,
        eventId,
        sourceBytes: asset.fileSize ?? 0,
        sourceDurationMs: durationMs,
        sourceFileName: asset.fileName,
        sourceMimeType: asset.mimeType,
        trimEndMs: endMs,
        trimStartMs: startMs,
      });
      setVideoStatusText("Uploading video for processing...");
      await uploadEventCoverVideoSource({
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        upload: intent.upload,
        uri: asset.uri,
      });
      setVideoStatusText("Compressing cover video...");
      const status = await waitForEventCoverVideoReady(intent.jobId);
      if (status.processedUrl === null) {
        throw new EventCoverVideoProcessingError(
          "processed_url_missing",
          "Video processing finished without a playable cover.",
        );
      }
      setMediaDisplayError(null);
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
    [draft.brandId, onShowToast, updateDraft],
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
    showUploadError,
    uploadPickedAsset,
    uploading,
  ]);

  const pickVideoCover = useCallback(async (): Promise<void> => {
    if (uploading) return;
    if (!(await ensureMediaPermission())) return;

    const eventId = eventIdForUpload();
    if (eventId === null) return;

    setUploading(true);
    onCoverVideoProcessingChange?.(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
        quality: 1,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
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
      if (
        typeof asset.fileSize === "number" &&
        asset.fileSize > EVENT_COVER_MAX_SOURCE_VIDEO_BYTES
      ) {
        onShowToast("Choose a video under 500 MB.");
        return;
      }
      const durationMs = typeof asset.duration === "number" ? asset.duration : null;
      if (durationMs === null || durationMs <= 0) {
        showUploadError(
          new EventCoverMediaError(
            "video_duration_unknown",
            "We couldn't read this video's duration.",
          ),
        );
        return;
      }
      if (durationMs > EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS) {
        onShowToast("Choose a video up to 5 minutes.");
        return;
      }
      if (durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS) {
        setPendingVideo(asset);
        setTrimStartMs(0);
        setVideoStatusText("Choose the 15-second section to use as the cover.");
        return;
      }
      await processPickedVideo(asset, eventId, coverMediaApplyMode, 0);
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
    onCoverVideoProcessingChange,
    onShowToast,
    processPickedVideo,
    showVideoProcessingError,
    showUploadError,
    uploading,
  ]);

  const handleConfirmTrim = useCallback(async (): Promise<void> => {
    if (pendingVideo === null || uploading) return;
    const eventId = eventIdForUpload();
    if (eventId === null) return;
    setUploading(true);
    onCoverVideoProcessingChange?.(true);
    try {
      await processPickedVideo(
        pendingVideo,
        eventId,
        coverMediaApplyMode,
        trimStartMs,
      );
      setPendingVideo(null);
      setVideoStatusText(null);
    } catch (error) {
      if (error instanceof EventCoverMediaError) showUploadError(error);
      else showVideoProcessingError(error);
    } finally {
      setUploading(false);
      onCoverVideoProcessingChange?.(false);
    }
  }, [
    coverMediaApplyMode,
    eventIdForUpload,
    onCoverVideoProcessingChange,
    pendingVideo,
    processPickedVideo,
    showUploadError,
    showVideoProcessingError,
    trimStartMs,
    uploading,
  ]);

  const shiftTrim = useCallback((deltaMs: number): void => {
    setTrimStartMs((current) => {
      const duration = pendingVideo?.duration ?? EVENT_COVER_MAX_VIDEO_DURATION_MS;
      const maxStart = Math.max(0, duration - EVENT_COVER_MAX_VIDEO_DURATION_MS);
      return Math.max(0, Math.min(maxStart, current + deltaMs));
    });
  }, [pendingVideo?.duration]);

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
    setPendingVideo(null);
    setVideoStatusText(null);
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
        {pendingVideo !== null ? (
          <View style={styles.trimPanel}>
            <Text style={styles.trimTitle}>Trim video cover</Text>
            <Text style={styles.trimCaption}>
              {`${(trimStartMs / 1000).toFixed(0)}s-${Math.min(
                ((pendingVideo.duration ?? 0) / 1000),
                (trimStartMs + EVENT_COVER_MAX_VIDEO_DURATION_MS) / 1000,
              ).toFixed(0)}s of ${Math.ceil((pendingVideo.duration ?? 0) / 1000)}s`}
            </Text>
            <View style={styles.trimActions}>
              <Button
                label="-5s"
                variant="secondary"
                size="sm"
                shape="square"
                onPress={() => shiftTrim(-5000)}
                disabled={uploading || trimStartMs <= 0}
              />
              <Button
                label="+5s"
                variant="secondary"
                size="sm"
                shape="square"
                onPress={() => shiftTrim(5000)}
                disabled={
                  uploading ||
                  trimStartMs >=
                    Math.max(
                      0,
                      (pendingVideo.duration ?? 0) -
                        EVENT_COVER_MAX_VIDEO_DURATION_MS,
                    )
                }
              />
              <Button
                label="Use this clip"
                variant="primary"
                size="sm"
                shape="square"
                onPress={() => {
                  void handleConfirmTrim();
                }}
                loading={uploading}
                disabled={uploading}
                style={styles.trimConfirm}
              />
            </View>
          </View>
        ) : null}
        {videoStatusText !== null ? (
          <Text style={styles.videoStatusText}>{videoStatusText}</Text>
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
  trimPanel: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  trimTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  trimCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 2,
  },
  trimActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  trimConfirm: {
    flex: 1,
  },
  videoStatusText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
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
