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
  acknowledgeEventCoverVideoSourceUploaded,
  cancelEventCoverVideoJob,
  createEventCoverVideoUploadIntent,
  EVENT_COVER_MAX_SOURCE_VIDEO_BYTES,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  EVENT_COVER_VIDEO_NOT_CONFIGURED_COPY,
  EVENT_COVER_VIDEO_PROCESSING_COPY,
  EventCoverVideoProcessingError,
  type EventCoverVideoApplyMode,
  type EventCoverVideoStatus,
  type EventCoverVideoUploadProgress,
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

type VideoCoverProcessingState =
  | { kind: "idle" }
  | { kind: "preparing"; label: string; percent: number }
  | { kind: "uploading"; label: string; percent: number | null }
  | { kind: "processing"; label: string; percent: number | null; jobId: string }
  | { kind: "timeout"; label: string; jobId: string; lastStatus: EventCoverVideoStatus }
  | { kind: "failed"; label: string; jobId?: string; canRetry: boolean }
  | { kind: "ready"; label: string };

const progressPercentForState = (
  state: VideoCoverProcessingState,
): number | null => {
  switch (state.kind) {
    case "preparing":
      return state.percent;
    case "uploading":
    case "processing":
      return state.percent;
    case "ready":
      return 100;
    default:
      return null;
  }
};

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
  const [videoUploadPercent, setVideoUploadPercent] = useState<number | null>(
    null,
  );
  const [videoErrorText, setVideoErrorText] = useState<string | null>(null);
  const [videoProcessingState, setVideoProcessingState] =
    useState<VideoCoverProcessingState>({ kind: "idle" });

  const setVideoState = useCallback((state: VideoCoverProcessingState): void => {
    setVideoProcessingState(state);
    if (state.kind === "idle") {
      setVideoStatusText(null);
      setVideoUploadPercent(null);
      return;
    }
    if (state.kind === "failed") {
      setVideoStatusText(null);
      setVideoUploadPercent(null);
      setVideoErrorText(state.label);
      return;
    }
    setVideoStatusText(state.label);
    setVideoUploadPercent(progressPercentForState(state));
  }, []);

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
      const diagnostic =
        error !== null && typeof error === "object"
          ? (error as {
              applyMode?: unknown;
              brandId?: unknown;
              edgeDetail?: unknown;
              edgeError?: unknown;
              edgeStatus?: unknown;
              eventId?: unknown;
              phase?: unknown;
              requestId?: unknown;
              sourceBytes?: unknown;
              sourceDurationMs?: unknown;
            })
          : null;
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
          applyMode: diagnostic?.applyMode,
          brandId: diagnostic?.brandId,
          code:
            error instanceof EventCoverVideoProcessingError
              ? error.code
              : isBusinessAuthNotReadyError(error)
                ? error.code
                : "unknown",
          diagnostic:
            diagnostic?.requestId !== undefined
              ? JSON.stringify({
                  applyMode: diagnostic.applyMode,
                  brandId: diagnostic.brandId,
                  code:
                    error instanceof EventCoverVideoProcessingError
                      ? error.code
                      : isBusinessAuthNotReadyError(error)
                        ? error.code
                        : "unknown",
                  edgeDetail: diagnostic.edgeDetail,
                  edgeError: diagnostic.edgeError,
                  edgeStatus: diagnostic.edgeStatus,
                  eventId: diagnostic.eventId,
                  phase: diagnostic.phase,
                  requestId: diagnostic.requestId,
                  sourceBytes: diagnostic.sourceBytes,
                  sourceDurationMs: diagnostic.sourceDurationMs,
                })
              : undefined,
          edgeDetail: diagnostic?.edgeDetail,
          edgeError: diagnostic?.edgeError,
          edgeStatus: diagnostic?.edgeStatus,
          eventId: diagnostic?.eventId,
          message,
          phase: diagnostic?.phase,
          rawMessage: error instanceof Error ? error.message : String(error),
          requestId: diagnostic?.requestId,
          sourceBytes: diagnostic?.sourceBytes,
          sourceDurationMs: diagnostic?.sourceDurationMs,
        });
      }
      if (
        error instanceof EventCoverVideoProcessingError &&
        error.code === "processing_timeout" &&
        error.lastStatus !== undefined
      ) {
        setVideoErrorText(null);
        setVideoState({
          jobId: error.lastStatus.jobId,
          kind: "timeout",
          label: error.message,
          lastStatus: error.lastStatus,
        });
        return;
      }
      setVideoStatusText(null);
      setVideoUploadPercent(null);
      setVideoState({
        canRetry:
          error instanceof EventCoverVideoProcessingError
            ? error.code !== "cancelled"
            : true,
        jobId:
          error instanceof EventCoverVideoProcessingError
            ? error.lastStatus?.jobId
            : undefined,
        kind: "failed",
        label: message,
      });
      onShowToast(message);
    },
    [onShowToast, setVideoState],
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
      setVideoState({
        kind: "preparing",
        label: "Preparing secure upload...",
        percent: 10,
      });
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
      let intent: Awaited<ReturnType<typeof createEventCoverVideoUploadIntent>>;
      try {
        intent = await createEventCoverVideoUploadIntent({
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
      } catch (error) {
        if (error !== null && typeof error === "object") {
          Object.assign(error, {
            applyMode,
            brandId: draft.brandId,
            eventId,
            sourceBytes: uploadFields.sourceBytes,
            sourceDurationMs: uploadFields.sourceDurationMs,
          });
        }
        throw error;
      }
      if (__DEV__) {
        console.info("[CreatorStep4Cover] upload-intent-success", {
          jobId: intent.jobId,
        });
      }
      setVideoState({ kind: "uploading", label: "Uploading video... 0%", percent: 0 });
      if (__DEV__) {
        console.info("[CreatorStep4Cover] source-upload-start", {
          jobId: intent.jobId,
        });
      }
      const handleUploadProgress = (progress: EventCoverVideoUploadProgress): void => {
        setVideoState({
          kind: "uploading",
          label: `Uploading video... ${progress.percent}%`,
          percent: progress.percent,
        });
      };
      const providerUploadResponse = await uploadEventCoverVideoSource({
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        onProgress: handleUploadProgress,
        upload: intent.upload,
        uri: asset.uri,
      });
      setVideoUploadPercent(100);
      if (__DEV__) {
        console.info("[CreatorStep4Cover] source-upload-success", {
          jobId: intent.jobId,
        });
      }
      const acknowledged = await acknowledgeEventCoverVideoSourceUploaded({
        brandId: draft.brandId,
        eventId,
        jobId: intent.jobId,
        providerUploadResponse,
      });
      setVideoState({
        jobId: acknowledged.jobId,
        kind: "processing",
        label: acknowledged.stageLabel,
        percent: acknowledged.progressPercent,
      });
      if (__DEV__) {
        console.info("[CreatorStep4Cover] status-poll-start", {
          jobId: intent.jobId,
        });
      }
      const status = await waitForEventCoverVideoReady(intent.jobId, {
        onStatus: (nextStatus) => {
          setVideoState({
            jobId: nextStatus.jobId,
            kind: "processing",
            label: nextStatus.stageLabel,
            percent: nextStatus.progressPercent,
          });
          if (__DEV__) {
            console.info("[CreatorStep4Cover] status-poll-snapshot", {
              jobId: nextStatus.jobId,
              status: nextStatus.status,
              stageLabel: nextStatus.stageLabel,
              updatedAt: nextStatus.updatedAt,
            });
          }
        },
      });
      if (status.processedUrl === null) {
        throw new EventCoverVideoProcessingError(
          "processed_url_missing",
          "Video processing finished without a playable cover.",
        );
      }
      setMediaDisplayError(null);
      setVideoErrorText(null);
      setVideoUploadPercent(null);
      setVideoState({ kind: "ready", label: status.stageLabel });
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
    [coverMediaEventId, draft.brandId, isAuthReady, onShowToast, setVideoState, updateDraft],
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
      setVideoState({ kind: "idle" });
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
    setVideoState,
    showUploadError,
    uploadPickedAsset,
    uploading,
  ]);

  const pickVideoCover = useCallback(async (): Promise<void> => {
    if (uploading) return;
    if (!isAuthReady) {
      const message = "Finishing sign-in before upload. Try again in a moment.";
      setVideoState({ kind: "idle" });
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
        setVideoState({ kind: "idle" });
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
      setVideoState({ kind: "idle" });
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
    setVideoState,
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
    setVideoState({ kind: "idle" });
    setVideoErrorText(null);
    updateDraft({ coverMediaUrl: null, coverMediaType: null });
    onShowToast("Uploaded cover removed.");
  }, [onShowToast, setVideoState, updateDraft]);

  const handleCheckVideoProcessingAgain = useCallback(async (): Promise<void> => {
    if (videoProcessingState.kind !== "timeout") return;
    const jobId = videoProcessingState.jobId;
    setUploading(true);
    onCoverVideoProcessingChange?.(true);
    setVideoErrorText(null);
    try {
      const status = await waitForEventCoverVideoReady(jobId, {
        onStatus: (nextStatus) => {
          setVideoState({
            jobId: nextStatus.jobId,
            kind: "processing",
            label: nextStatus.stageLabel,
            percent: nextStatus.progressPercent,
          });
        },
        pollIntervalMs: 2500,
        timeoutMs: 30_000,
      });
      if (status.processedUrl === null) {
        throw new EventCoverVideoProcessingError(
          "processed_url_missing",
          "Video processing finished without a playable cover.",
          { lastStatus: status },
        );
      }
      setMediaDisplayError(null);
      updateDraft({
        coverMediaType: "video",
        coverMediaUrl: status.processedUrl,
      });
      setVideoState({ kind: "ready", label: status.stageLabel });
      onShowToast(
        status.applyMode === "published_manual"
          ? "Video ready. Save changes to publish the new cover."
          : "Cover video processed.",
      );
    } catch (error) {
      showVideoProcessingError(error);
    } finally {
      setUploading(false);
      onCoverVideoProcessingChange?.(false);
    }
  }, [
    onCoverVideoProcessingChange,
    onShowToast,
    setVideoState,
    showVideoProcessingError,
    updateDraft,
    videoProcessingState,
  ]);

  const handleCancelVideoProcessing = useCallback(async (): Promise<void> => {
    if (videoProcessingState.kind !== "timeout") return;
    setUploading(true);
    try {
      const status = await cancelEventCoverVideoJob(videoProcessingState.jobId);
      setVideoState({
        canRetry: true,
        jobId: status.jobId,
        kind: "failed",
        label: status.stageLabel,
      });
      onShowToast("Video processing cancelled.");
    } catch (error) {
      showVideoProcessingError(error);
    } finally {
      setUploading(false);
    }
  }, [onShowToast, setVideoState, showVideoProcessingError, videoProcessingState]);

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
          <View style={styles.videoStatusWrap}>
            <Text style={styles.videoStatusText}>{videoStatusText}</Text>
            {videoUploadPercent !== null ? (
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{
                  max: 100,
                  min: 0,
                  now: videoUploadPercent,
                }}
                style={styles.videoProgressTrack}
              >
                <View
                  style={[
                    styles.videoProgressFill,
                    { width: `${videoUploadPercent}%` },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {videoErrorText !== null ? (
          <Text accessibilityRole="alert" style={styles.videoErrorText}>
            {videoErrorText}
          </Text>
        ) : null}
        {videoProcessingState.kind === "timeout" ? (
          <View style={styles.videoRecoveryRow}>
            <Button
              label="Check again"
              variant="secondary"
              size="sm"
              shape="square"
              onPress={() => {
                void handleCheckVideoProcessingAgain();
              }}
              disabled={uploading}
              style={styles.videoRecoveryButton}
            />
            <Button
              label="Replace video"
              variant="ghost"
              size="sm"
              shape="square"
              onPress={pickVideoCover}
              disabled={uploading}
              style={styles.videoRecoveryButton}
            />
            {videoProcessingState.lastStatus.canCancel ? (
              <Button
                label="Cancel processing"
                variant="ghost"
                size="sm"
                shape="square"
                onPress={() => {
                  void handleCancelVideoProcessing();
                }}
                disabled={uploading}
                style={styles.videoRecoveryButton}
              />
            ) : null}
          </View>
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
  },
  videoStatusWrap: {
    marginTop: spacing.xs,
  },
  videoProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: textTokens.quaternary,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  videoProgressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: accent.warm,
  },
  videoErrorText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  videoRecoveryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  videoRecoveryButton: {
    minWidth: 108,
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
