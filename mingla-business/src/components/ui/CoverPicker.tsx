/**
 * CoverPicker — shared 3-provider cover image picker (ORCH-0876).
 *
 * Extracted from `mingla-business/src/components/event/CreatorStep4Cover.tsx`
 * to enable reuse on the trip side (Step 1 Basics + EditPublishedTripScreen
 * Cover section) without duplicating the picker stack.
 *
 * Self-contained state:
 *   - provider tab (GIPHY ↔ Pexels)
 *   - search input + status
 *   - search results
 *   - upload spinner
 *   - media display error
 *
 * Caller responsibility:
 *   - Pass current cover fields as initial* props
 *   - Receive 7-field patch via `onCoverChange` on any selection/upload/remove
 *   - Surface toasts via `onShowToast`
 *
 * Architecture: events table is shared between events + trips, so the
 * upload service (`uploadEventCoverMedia`) is event_type-agnostic — it
 * accepts any events-row id (the event's id, or the trip's id) and
 * writes to the same `event_covers` storage bucket keyed by
 * `{brandId}/{eventRowId}/{random}.{ext}`. No storage policy changes
 * needed for trip reuse.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §9.1.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView routed through SmartScrollView wrapper.
// On native, resolves to KeyboardAwareScrollView (library) which scrolls
// the focused TextInput (e.g. the GIPHY/Pexels search input) exactly
// 12pt above the keyboard. On web, plain RN ScrollView. KAS supersedes
// ORCH-0892-A's <KeyboardAvoidingView> wrap which has been removed; also
// supersedes ORCH-0884 follow-ups #8 (400pt spacer) and #9 (dead
// scrollResponder call) which remain deleted. Per SPEC_ORCH-0892-B_v2
// §7.D + §15 (ORCH-0888 supersession verdict).
import { ScrollView } from "../../wrappers/SmartScrollView";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import NativeVideoTrim, {
  showEditor,
  type Spec as VideoTrimSpec,
} from "react-native-video-trim";

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
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  EVENT_COVER_SOURCE_CEILING_MS,
  EVENT_COVER_VIDEO_PROCESSING_COPY,
} from "../../services/eventCoverVideoProcessingService";
import {
  useEventCoverVideoUpload,
  type EventCoverVideoUploadFile,
} from "../../hooks/useEventCoverVideoUpload";
import {
  buildTrimmedVideoUploadFile,
  normalizeLocalFileUri,
  normalizePickerDurationMs,
  type VideoTrimFinishPayload,
} from "./coverPickerVideoTrimUpload";
import {
  searchGiphyEventCovers,
  type GiphyCoverSearchResult,
} from "../../services/giphyEventCoverService";
import {
  searchPexelsEventCovers,
  type PexelsCoverSearchResult,
} from "../../services/pexelsEventCoverService";
import { EventCoverProviderError } from "../../services/eventCoverProviderError";
import {
  eventCoverProviderCreditLabel,
  UPLOAD_EVENT_COVER_PROVIDER_METADATA,
} from "../../types/eventCoverProvider";
import type { EventCoverMediaProvider } from "../../types/eventCoverProvider";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import { Button } from "./Button";
import { EventCoverMedia, type EventCoverMediaErrorEvent } from "./EventCoverMedia";
import { useAuth } from "../../context/AuthContext";

export type CoverProvider = "upload" | "giphy" | "pexels";
type SearchProviderTab = "giphy" | "pexels";
type SearchStatus = "idle" | "loading" | "error";
type VideoTrimSubscription = { remove: () => void };
/** Full 7-field cover patch emitted on every change. Mirror of the
 *  events table cover_media_* column family. */
export interface CoverPatch {
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  /** Provider union — narrow to keep EventCoverMedia + draftEventStore in
   *  sync. Free-form strings would break the event-side updateDraft path. */
  coverMediaProvider: EventCoverMediaProvider | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
}

export interface CoverPickerProps {
  brandId: string;
  /** Events-table row id. For events: the event id. For trips: the trip's
   *  events-row id. uploadEventCoverMedia is event_type-agnostic. */
  eventRowId: string;
  /** Cover hue fallback for empty preview (0..360). Events have one; trips
   *  default to 0. Used by EventCoverMedia when no media is set. */
  initialCoverHue?: number;
  initialMediaUrl: string | null;
  initialMediaType: EventCoverMediaType | null;
  initialProvider: EventCoverMediaProvider | null;
  initialSourceUrl: string | null;
  initialCredit: string | null;
  initialCreditUrl: string | null;
  initialAlt: string | null;
  onCoverChange: (patch: CoverPatch) => void;
  onShowToast: (msg: string) => void;
  /** Defaults to ["upload", "giphy", "pexels"]. Caller may restrict (e.g.,
   *  show only upload tab). */
  providers?: ReadonlyArray<CoverProvider>;
  disabled?: boolean;
  enableVideoUpload?: boolean;
  coverMediaApplyMode?: "draft_auto" | "published_manual";
  onCoverVideoProcessingChange?: (isProcessing: boolean) => void;
}

const DEFAULT_PROVIDERS: ReadonlyArray<CoverProvider> = ["upload", "giphy", "pexels"];

export const CoverPicker: React.FC<CoverPickerProps> = ({
  brandId,
  eventRowId,
  initialCoverHue = 0,
  initialMediaUrl,
  initialMediaType,
  initialProvider,
  initialSourceUrl,
  initialCredit,
  initialCreditUrl,
  initialAlt,
  onCoverChange,
  onShowToast,
  providers = DEFAULT_PROVIDERS,
  disabled = false,
  enableVideoUpload = true,
  coverMediaApplyMode = "draft_auto",
  onCoverVideoProcessingChange,
}) => {
  const { isAuthReady } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(
    null,
  );
  const videoUpload = useEventCoverVideoUpload(
    eventRowId,
    brandId,
    coverMediaApplyMode,
  );
  const lastVideoUploadFileRef = useRef<EventCoverVideoUploadFile | null>(null);

  // Local mirror of current cover for preview render + credit label.
  // Parent owns canonical state (passes initial* props on remount); this
  // local copy reflects the most recent onCoverChange-fired patch so the
  // preview updates immediately without round-trip.
  const [localCover, setLocalCover] = useState<CoverPatch>({
    coverMediaUrl: initialMediaUrl,
    coverMediaType: initialMediaType,
    coverMediaProvider: initialProvider,
    coverMediaSourceUrl: initialSourceUrl,
    coverMediaCredit: initialCredit,
    coverMediaCreditUrl: initialCreditUrl,
    coverMediaAlt: initialAlt,
  });

  // Sync localCover when caller updates initial props (e.g., parent
  // re-renders with new server data).
  useEffect(() => {
    setLocalCover({
      coverMediaUrl: initialMediaUrl,
      coverMediaType: initialMediaType,
      coverMediaProvider: initialProvider,
      coverMediaSourceUrl: initialSourceUrl,
      coverMediaCredit: initialCredit,
      coverMediaCreditUrl: initialCreditUrl,
      coverMediaAlt: initialAlt,
    });
  }, [
    initialMediaUrl,
    initialMediaType,
    initialProvider,
    initialSourceUrl,
    initialCredit,
    initialCreditUrl,
    initialAlt,
  ]);

  useEffect(() => {
    setMediaDisplayError(null);
  }, [localCover.coverMediaUrl]);

  useEffect(() => {
    onCoverVideoProcessingChange?.(
      videoUpload.stage.phase === "compressing" ||
        videoUpload.stage.phase === "uploading" ||
        videoUpload.stage.phase === "processing",
    );
  }, [onCoverVideoProcessingChange, videoUpload.stage.phase]);

  const supportsUpload = providers.includes("upload");
  const supportsVideoUpload = supportsUpload && enableVideoUpload;
  const supportsGiphy = providers.includes("giphy");
  const supportsPexels = providers.includes("pexels");
  const supportsSearch = supportsGiphy || supportsPexels;

  // Search tab defaults to the first supported search provider.
  const initialSearchTab: SearchProviderTab = supportsGiphy ? "giphy" : "pexels";
  const [providerTab, setProviderTab] = useState<SearchProviderTab>(initialSearchTab);
  const [query, setQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [giphyResults, setGiphyResults] = useState<GiphyCoverSearchResult[]>([]);
  const [pexelsResults, setPexelsResults] = useState<PexelsCoverSearchResult[]>([]);

  // ORCH-0892-A: prior ORCH-0884 follow-ups #8 + #9 (Keyboard listener
  // with 400pt spacer + dead scroll-responder call) DELETED. Both were
  // workarounds for keyboard covering the GIPHY/Pexels search input.
  // The Fabric-compatible fix is the keyboard-controller library's
  // <KeyboardAvoidingView behavior="padding"> wrap around the search
  // section below. Supersedes ORCH-0888 if pilot confirms.

  const selectedCredit = eventCoverProviderCreditLabel({
    provider: localCover.coverMediaProvider,
    credit: localCover.coverMediaCredit,
  });
  const activeVideoUpload =
    videoUpload.stage.phase === "compressing" ||
    videoUpload.stage.phase === "uploading" ||
    videoUpload.stage.phase === "processing";
  const activeMediaUrl =
    videoUpload.localPreviewUri ??
    videoUpload.processedUrl ??
    localCover.coverMediaUrl;
  const activeMediaType =
    videoUpload.localPreviewUri !== null || videoUpload.processedUrl !== null
      ? "video"
      : localCover.coverMediaType;
  const videoStageCopy =
    videoUpload.stage.phase === "compressing"
      ? "Compressing on your phone..."
      : videoUpload.stage.phase === "uploading"
        ? "Uploading..."
        : videoUpload.stage.phase === "processing"
          ? "Almost ready..."
          : null;

  const emitChange = useCallback(
    (patch: CoverPatch): void => {
      setLocalCover(patch);
      onCoverChange(patch);
    },
    [onCoverChange],
  );

  useEffect(() => {
    if (videoUpload.stage.phase !== "ready" || videoUpload.processedUrl === null) {
      return;
    }
    setMediaDisplayError(null);
    emitChange({
      coverMediaUrl: videoUpload.processedUrl,
      coverMediaType: "video",
      coverMediaProvider: UPLOAD_EVENT_COVER_PROVIDER_METADATA.provider,
      coverMediaSourceUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.sourceUrl,
      coverMediaCredit: UPLOAD_EVENT_COVER_PROVIDER_METADATA.credit,
      coverMediaCreditUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.creditUrl,
      coverMediaAlt: "Uploaded video cover",
    });
    onShowToast("Video cover updated.");
  }, [
    emitChange,
    onShowToast,
    videoUpload.processedUrl,
    videoUpload.stage.phase,
  ]);

  const showUploadError = useCallback(
    (error: unknown): void => {
      if (error instanceof EventCoverMediaError) {
        switch (error.code) {
          case "permission_denied":
            onShowToast("Photo library permission is needed to add a cover.");
            return;
          case "unsupported_type":
            onShowToast("Choose a JPEG, PNG, WebP, or GIF.");
            return;
          case "file_too_large":
            onShowToast("Covers must be 30 MB or smaller.");
            return;
          case "missing_server_event_id":
            onShowToast("This needs a server record before media upload.");
            return;
          case "display_failed":
            onShowToast("Uploaded, but this cover could not be displayed.");
            return;
          default:
            onShowToast("Cover upload failed. Try again.");
            return;
        }
      }
      onShowToast("Cover upload failed. Try again.");
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

  const validateEventRowId = useCallback((): boolean => {
    if (eventRowId.trim().length === 0) {
      showUploadError(
        new EventCoverMediaError(
          "missing_server_event_id",
          "Missing server row id.",
        ),
      );
      return false;
    }
    return true;
  }, [eventRowId, showUploadError]);

  const pickImageOrGifCover = useCallback(async (): Promise<void> => {
    if (uploading || disabled || activeVideoUpload) return;
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

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
      const asset = result.assets[0];
      const upload = await uploadEventCoverMedia({
        uri: asset.uri,
        brandId,
        eventId: eventRowId,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        durationMs: null,
        pickerType: asset.type,
      });
      setMediaDisplayError(null);
      emitChange({
        coverMediaUrl: upload.publicUrl,
        coverMediaType: upload.mediaType,
        coverMediaProvider: UPLOAD_EVENT_COVER_PROVIDER_METADATA.provider,
        coverMediaSourceUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.sourceUrl,
        coverMediaCredit: UPLOAD_EVENT_COVER_PROVIDER_METADATA.credit,
        coverMediaCreditUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.creditUrl,
        coverMediaAlt: UPLOAD_EVENT_COVER_PROVIDER_METADATA.alt,
      });
      onShowToast("Cover updated.");
    } catch (error) {
      showUploadError(error);
    } finally {
      setUploading(false);
    }
  }, [
    brandId,
    disabled,
    emitChange,
    ensureMediaPermission,
    eventRowId,
    isAuthReady,
    onShowToast,
    showUploadError,
    uploading,
    validateEventRowId,
    activeVideoUpload,
  ]);

  const trimVideoWithDedicatedEditor = useCallback(
    (uri: string): Promise<VideoTrimFinishPayload | null> =>
      new Promise((resolve, reject) => {
        const videoTrim = NativeVideoTrim as VideoTrimSpec;
        const subscriptions: VideoTrimSubscription[] = [];
        let settled = false;
        const settle = (handler: () => void): void => {
          if (settled) return;
          settled = true;
          subscriptions.forEach((subscription) => subscription.remove());
          handler();
        };

        subscriptions.push(
          videoTrim.onFinishTrimming((payload: VideoTrimFinishPayload) => {
            settle(() => resolve(payload));
          }) as VideoTrimSubscription,
          videoTrim.onCancelTrimming(() => {
            settle(() => resolve(null));
          }) as VideoTrimSubscription,
          videoTrim.onCancel(() => {
            settle(() => resolve(null));
          }) as VideoTrimSubscription,
          videoTrim.onError(({ message, errorCode }) => {
            settle(() =>
              reject(
                new Error(
                  `Video trim failed (${errorCode || "unknown"}): ${message}`,
                ),
              ),
            );
          }) as VideoTrimSubscription,
        );

        try {
          // react-native-video-trim docs:
          // https://github.com/maitrungduc1410/react-native-video-trim
          // https://www.npmjs.com/package/react-native-video-trim
          // v8.1.0's typed/native config treats maxDuration as milliseconds.
          showEditor(uri, {
            maxDuration: EVENT_COVER_MAX_VIDEO_DURATION_MS,
            saveButtonText: "Use clip",
            cancelButtonText: "Back",
            enablePreciseTrimming: true,
          });
        } catch (error) {
          settle(() => reject(error));
        }
      }),
    [],
  );

  const pickVideoCover = useCallback(async (): Promise<void> => {
    if (!supportsVideoUpload || uploading || disabled || activeVideoUpload) return;
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

    setUploading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      const isNative = Platform.OS !== "web";
      const trimResult = isNative
        ? await trimVideoWithDedicatedEditor(asset.uri)
        : null;
      if (isNative && trimResult === null) return;
      const uploadFile =
        trimResult !== null
          ? await buildTrimmedVideoUploadFile({
              originalFileName: asset.fileName,
              originalMimeType: asset.mimeType,
              statFile: (uri) => FileSystem.getInfoAsync(uri),
              trimResult,
            })
          : {
              bytes: asset.fileSize ?? 0,
              durationMs: normalizePickerDurationMs(asset.duration),
              fileName: asset.fileName,
              mimeType: asset.mimeType ?? "video/mp4",
              trimEndMs: normalizePickerDurationMs(asset.duration),
              trimStartMs: 0,
              uri: normalizeLocalFileUri(asset.uri),
            };
      const { durationMs } = uploadFile;
      if (durationMs <= 0) {
        onShowToast("Could not read this video's duration. Try another clip.");
        return;
      }
      if (durationMs > EVENT_COVER_SOURCE_CEILING_MS) {
        console.log("[ORCH-0978-TRIM]", {
          durationMs,
          capMs: EVENT_COVER_MAX_VIDEO_DURATION_MS,
          overshoot: durationMs - EVENT_COVER_MAX_VIDEO_DURATION_MS,
        });
        onShowToast("Please trim to 29 seconds first.");
        return;
      }
      if (uploadFile.bytes <= 0) {
        onShowToast("Could not read this video's size. Try another clip.");
        return;
      }
      lastVideoUploadFileRef.current = uploadFile;
      await videoUpload.start(uploadFile);
    } catch (error) {
      onShowToast(
        error instanceof Error
          ? error.message
          : "Video cover upload failed. Try again.",
      );
    } finally {
      setUploading(false);
    }
  }, [
    activeVideoUpload,
    disabled,
    ensureMediaPermission,
    isAuthReady,
    onShowToast,
    supportsVideoUpload,
    trimVideoWithDedicatedEditor,
    uploading,
    validateEventRowId,
    videoUpload,
  ]);

  const cancelVideoCoverUpload = useCallback((): void => {
    void videoUpload.cancel().catch((error) => {
      onShowToast(
        error instanceof Error ? error.message : "Could not cancel video upload.",
      );
    });
  }, [onShowToast, videoUpload]);

  const retryVideoCoverUpload = useCallback((): void => {
    const uploadFile = lastVideoUploadFileRef.current;
    if (uploadFile === null || activeVideoUpload || disabled || uploading) return;
    void videoUpload.start(uploadFile);
  }, [activeVideoUpload, disabled, uploading, videoUpload]);

  const runProviderSearch = useCallback(async (): Promise<void> => {
    if (disabled) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchError("Search with at least two characters.");
      return;
    }
    setSearchStatus("loading");
    setSearchError(null);
    try {
      if (providerTab === "giphy") {
        const results = await searchGiphyEventCovers(trimmed, { limit: 12 });
        setGiphyResults(results);
      } else {
        const page = await searchPexelsEventCovers(trimmed, { perPage: 12 });
        setPexelsResults(page.photos);
      }
      setSearchStatus("idle");
    } catch (error) {
      const message =
        error instanceof EventCoverProviderError
          ? error.message
          : "Cover search failed. Try again.";
      setSearchStatus("error");
      setSearchError(message);
      onShowToast(message);
    }
  }, [disabled, onShowToast, providerTab, query]);

  const selectGiphy = useCallback(
    (result: GiphyCoverSearchResult): void => {
      if (disabled) return;
      setMediaDisplayError(null);
      emitChange({
        coverMediaUrl: result.mediaUrl,
        coverMediaType: "gif",
        coverMediaProvider: "giphy",
        coverMediaSourceUrl: result.sourceUrl,
        coverMediaCredit: result.credit,
        coverMediaCreditUrl: result.creditUrl,
        coverMediaAlt: result.alt,
      });
      onShowToast("GIPHY cover selected.");
    },
    [disabled, emitChange, onShowToast],
  );

  const selectPexels = useCallback(
    (result: PexelsCoverSearchResult): void => {
      if (disabled) return;
      setMediaDisplayError(null);
      emitChange({
        coverMediaUrl: result.mediaUrl,
        coverMediaType: "image",
        coverMediaProvider: "pexels",
        coverMediaSourceUrl: result.sourceUrl,
        coverMediaCredit: result.credit,
        coverMediaCreditUrl: result.creditUrl,
        coverMediaAlt: result.alt,
      });
      onShowToast("Pexels cover selected.");
    },
    [disabled, emitChange, onShowToast],
  );

  const handleRemoveCover = useCallback((): void => {
    if (disabled) return;
    setMediaDisplayError(null);
    emitChange({
      coverMediaUrl: null,
      coverMediaType: null,
      coverMediaProvider: null,
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    });
    onShowToast("Cover removed.");
  }, [disabled, emitChange, onShowToast]);

  const handleMediaRenderError = useCallback(
    (event: EventCoverMediaErrorEvent): void => {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[CoverPicker] cover media render failed", event);
      }
      setMediaDisplayError(
        "Uploaded, but this cover could not be displayed. Try another image or GIF.",
      );
      onShowToast(
        "Uploaded, but this cover could not be displayed. Try another image or GIF.",
      );
    },
    [onShowToast],
  );

  const currentResults = useMemo(
    () => (providerTab === "giphy" ? giphyResults : pexelsResults),
    [giphyResults, pexelsResults, providerTab],
  );

  return (
    <View>
      {/* Preview + upload/remove actions */}
      <View style={styles.field}>
        <View style={styles.coverPreview}>
          <EventCoverMedia
            hue={initialCoverHue}
            mediaUrl={activeMediaUrl}
            mediaType={activeMediaType}
            radius={radiusTokens.lg}
            label={localCover.coverMediaAlt ?? "cover"}
            height={180}
            onMediaError={handleMediaRenderError}
            muted={true}
            showAudioControl={activeMediaType === "video"}
          >
            {activeVideoUpload && videoStageCopy !== null ? (
              <View style={styles.videoProgressOverlay}>
                <Text style={styles.videoProgressText}>{videoStageCopy}</Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${videoUpload.stage.percent}%` },
                    ]}
                  />
                </View>
              </View>
            ) : null}
          </EventCoverMedia>
        </View>
        {selectedCredit !== null ? (
          <Text style={styles.creditText}>{selectedCredit}</Text>
        ) : null}
        {supportsUpload ? (
          <View style={styles.actionRow}>
            <Button
              label={
                localCover.coverMediaUrl === null
                  ? "Upload image/GIF"
                  : "Replace upload"
              }
              leadingIcon="upload"
              variant="secondary"
              size="md"
              shape="square"
              onPress={pickImageOrGifCover}
              loading={uploading}
              disabled={uploading || activeVideoUpload || disabled}
              style={styles.actionButton}
            />
            {supportsVideoUpload ? (
              <Button
                label="Upload video"
                leadingIcon="play"
                variant="secondary"
                size="md"
                shape="square"
                onPress={() => {
                  void pickVideoCover();
                }}
                disabled={uploading || activeVideoUpload || disabled}
                style={styles.actionButton}
              />
            ) : null}
            {localCover.coverMediaUrl !== null ? (
              <Button
                label="Remove"
                variant="ghost"
                size="md"
                shape="square"
                onPress={handleRemoveCover}
                disabled={uploading || activeVideoUpload || disabled}
                style={styles.removeButton}
              />
            ) : null}
          </View>
        ) : null}
        {activeVideoUpload ? (
          <View style={styles.actionRow}>
            <Button
              label="Cancel upload"
              variant="ghost"
              size="md"
              shape="square"
              onPress={cancelVideoCoverUpload}
              style={styles.actionButton}
            />
          </View>
        ) : null}
        {videoUpload.stage.phase === "error" ? (
          <View style={styles.videoErrorRow}>
            <Text accessibilityRole="alert" style={styles.mediaErrorText}>
              {videoUpload.stage.message}
            </Text>
            {lastVideoUploadFileRef.current !== null ? (
              <Button
                label="Upload failed - try again"
                variant="secondary"
                size="sm"
                shape="square"
                onPress={retryVideoCoverUpload}
                disabled={uploading || disabled}
                style={styles.retryButton}
              />
            ) : null}
          </View>
        ) : null}
        {supportsUpload ? (
          <Text style={styles.uploadLimitText}>{EVENT_COVER_UPLOAD_LIMIT_COPY}</Text>
        ) : null}
        {supportsVideoUpload ? (
          <Text style={styles.uploadLimitText}>{EVENT_COVER_VIDEO_PROCESSING_COPY}</Text>
        ) : null}
        {mediaDisplayError !== null ? (
          <Text accessibilityRole="alert" style={styles.mediaErrorText}>
            {mediaDisplayError}
          </Text>
        ) : null}
      </View>

      {/* GIPHY + Pexels search (only renders if at least one is enabled).
          ORCH-0892-B v2: <KeyboardAvoidingView> wrap removed. Keyboard
          avoidance for the search input now flows through the parent
          screen / Sheet consumer's SmartScrollView (KAS) which scrolls
          the focused TextInput exactly above the keyboard. ORCH-0884
          follow-ups #8 (400pt spacer) and #9 (dead scrollResponder)
          remain DELETED. Per SPEC_ORCH-0892-B_v2 §7.D. */}
      {supportsSearch ? (
        <View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Find a cover</Text>
            <View style={styles.providerTabs}>
              {supportsGiphy ? (
                <ProviderTabButton
                  label="GIPHY"
                  active={providerTab === "giphy"}
                  onPress={() => setProviderTab("giphy")}
                  disabled={disabled}
                />
              ) : null}
              {supportsPexels ? (
                <ProviderTabButton
                  label="Pexels"
                  active={providerTab === "pexels"}
                  onPress={() => setProviderTab("pexels")}
                  disabled={disabled}
                />
              ) : null}
            </View>
            <View style={styles.searchRow}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={
                  providerTab === "giphy"
                    ? "Search GIFs"
                    : "Search landscape photos"
                }
                placeholderTextColor={textTokens.tertiary}
                returnKeyType="search"
                onSubmitEditing={() => {
                  void runProviderSearch();
                }}
                style={styles.searchInput}
                editable={!disabled}
              />
              <Button
                label="Search"
                variant="secondary"
                size="md"
                shape="square"
                onPress={() => {
                  void runProviderSearch();
                }}
                loading={searchStatus === "loading"}
                disabled={searchStatus === "loading" || disabled}
                style={styles.searchButton}
              />
            </View>
            {searchError !== null ? (
              <Text accessibilityRole="alert" style={styles.mediaErrorText}>
                {searchError}
              </Text>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.providerResults}
            >
              {currentResults.map((result) =>
                providerTab === "giphy" ? (
                  <ProviderResultTile
                    key={`giphy-${result.id}`}
                    imageUrl={(result as GiphyCoverSearchResult).previewUrl}
                    label={(result as GiphyCoverSearchResult).alt ?? "GIPHY GIF"}
                    credit="GIPHY"
                    onPress={() => selectGiphy(result as GiphyCoverSearchResult)}
                  />
                ) : (
                  <ProviderResultTile
                    key={`pexels-${(result as PexelsCoverSearchResult).id}`}
                    imageUrl={(result as PexelsCoverSearchResult).mediaUrl}
                    label={
                      (result as PexelsCoverSearchResult).alt ?? "Pexels photo"
                    }
                    credit={(result as PexelsCoverSearchResult).credit}
                    onPress={() =>
                      selectPexels(result as PexelsCoverSearchResult)
                    }
                  />
                ),
              )}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const ProviderTabButton: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}> = ({ label, active, onPress, disabled }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected: active, disabled }}
    onPress={onPress}
    disabled={disabled}
    style={[styles.providerTab, active && styles.providerTabActive]}
  >
    <Text
      style={[styles.providerTabText, active && styles.providerTabTextActive]}
    >
      {label}
    </Text>
  </Pressable>
);

const ProviderResultTile: React.FC<{
  imageUrl: string;
  label: string;
  credit: string;
  onPress: () => void;
}> = ({ imageUrl, label, credit, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Select ${label}`}
    onPress={onPress}
    style={({ pressed }) => [
      styles.resultTile,
      pressed && styles.resultTilePressed,
    ]}
  >
    <Image source={{ uri: imageUrl }} style={styles.resultImage} />
    <Text style={styles.resultCredit} numberOfLines={1}>
      {credit}
    </Text>
  </Pressable>
);

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
  creditText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
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
  videoErrorRow: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  retryButton: {
    alignSelf: "flex-start",
  },
  videoProgressOverlay: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    gap: spacing.xs,
  },
  videoProgressText: {
    color: "#FFFFFF",
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.24)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  providerTabs: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  providerTab: {
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: textTokens.quaternary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  providerTabActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(255, 122, 69, 0.12)",
  },
  providerTabText: {
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
  },
  providerTabTextActive: {
    color: accent.warm,
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: textTokens.quaternary,
    color: textTokens.primary,
    paddingHorizontal: spacing.sm,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  searchButton: {
    minWidth: 96,
  },
  providerResults: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  resultTile: {
    width: 128,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  resultTilePressed: {
    opacity: 0.75,
  },
  resultImage: {
    width: "100%",
    height: 84,
    backgroundColor: textTokens.quaternary,
  },
  resultCredit: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
});
