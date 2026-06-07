/**
 * CoverPicker — unified, gallery-first, target-aware cover picker.
 *
 * ORCH-0989 [Unified cover picker sheet]: the ONE cover authoring body for
 * events, trips, AND brand covers. Three tabs (Library / GIF / Stock), each
 * gallery-first — GIF opens to GIPHY trending, Stock opens to Pexels curated,
 * no typing required; search is additive. Library hosts device image/GIF +
 * (per-target) video via the proven ORCH-0978 Architecture-B trim path.
 *
 * Target routing (CoverTarget discriminated union, SPEC §4.2):
 *   - event/trip → uploadEventCoverMedia + direct 7-field patch; video via
 *     useEventCoverVideoUpload(eventRowId, brandId, applyMode, "event").
 *   - brand → useBrandCoverUpload.uploadCover (device + provider, host-
 *     validated); video via useEventCoverVideoUpload(_, brandId, _, "brand")
 *     which persists to brands.cover_media_url on ready.
 *
 * The 7-field CoverPatch emit contract + onCoverChange callback are UNCHANGED
 * (every mount keeps consuming the same patch). Hosted inside CoverPickerSheet
 * (the canonical surface for all 6 mounts).
 *
 * Provider transport asymmetry (LOCKED, ToS):
 *   - GIPHY client-direct (search + trending) — proxying forbidden.
 *   - Pexels edge-proxied (search + curated) — key stays server-side.
 *
 * Per SPEC_ORCH-0989 §3/§4/§6/§7 + SPEC_ORCH-0989_..._DESIGN.md.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
// ORCH-0892-B v2: ScrollView routed through SmartScrollView wrapper (KAS on
// native, plain ScrollView on web) so the GIF/Stock search input scrolls
// above the keyboard without bespoke listeners (orch-0892 gate).
import { ScrollView } from "../../wrappers/SmartScrollView";
// ORCH-1001 [Business web white-page crash]: the native video-trim editor is
// imported through a Metro platform split (.native vs .web) so the native-only
// `react-native-video-trim` TurboModule never lands in the web bundle. A raw
// top-level import here ran `getEnforcing('VideoTrim')` at web-eval time and
// crashed the entire app to a blank page.
import {
  launchCoverImagePicker,
  launchCoverVideoPicker,
  requestCoverMediaLibraryPermission,
  revokeCoverPickedAssets,
} from "./coverPickerDeviceMedia";
import { getCoverPickerFileInfoAsync } from "./coverPickerFileInfo";
import { trimVideoWithDedicatedEditor } from "./coverPickerVideoTrimEditor";

import {
  accent,
  glass,
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
} from "./coverPickerVideoTrimUpload";
import {
  searchGiphyEventCovers,
  type GiphyCoverSearchResult,
} from "../../services/giphyEventCoverService";
import {
  searchPexelsEventCovers,
  type PexelsCoverSearchResult,
} from "../../services/pexelsEventCoverService";
import {
  curatedPexelsCovers,
  trendingGiphyCovers,
} from "../../services/coverProviderBrowseService";
import { EventCoverProviderError } from "../../services/eventCoverProviderError";
import {
  eventCoverProviderCreditLabel,
  UPLOAD_EVENT_COVER_PROVIDER_METADATA,
} from "../../types/eventCoverProvider";
import type { EventCoverMediaProvider } from "../../types/eventCoverProvider";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import { useBrandCoverUpload } from "../../hooks/useBrandCoverUpload";
import { BrandCoverError } from "../../utils/brandCoverRules";
import { Button } from "./Button";
import { findSelectedProviderId } from "./coverPickerSelection";
import { Icon } from "./Icon";
import { EventCoverMedia, type EventCoverMediaErrorEvent } from "./EventCoverMedia";
import { useAuth } from "../../context/AuthContext";
import type { CoverTarget } from "./coverTarget";

export type { CoverTarget } from "./coverTarget";

// LOCKED tab ids (SPEC §4.3); display labels are designer-owned copy (DESIGN §3.1).
type CoverTabId = "library" | "gif" | "stock";
type ProviderStatus = "idle" | "loading" | "populated" | "empty" | "error";

/** Full 7-field cover patch emitted on every change. Mirror of the events
 *  table cover_media_* column family. UNCHANGED from prior CoverPicker. */
export interface CoverPatch {
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider: EventCoverMediaProvider | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
}

export interface CoverPickerProps {
  /** Discriminated cover target — drives persistence + video availability. */
  target: CoverTarget;
  /** Cover hue fallback for empty preview (0..360). */
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
  disabled?: boolean;
  /** Override default 3-column desktop / 2-column phone masonry. */
  isWideDesktop?: boolean;
  onCoverVideoProcessingChange?: (isProcessing: boolean) => void;
}

const TAB_DEFS: ReadonlyArray<{ id: CoverTabId; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "library", label: "Library", icon: "grid" },
  { id: "gif", label: "GIFs", icon: "sparkle" },
  { id: "stock", label: "Photos", icon: "search" },
];

const lightHaptic = (): void => {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};
const tickHaptic = (): void => {
  if (Platform.OS === "web") return;
  void Haptics.selectionAsync().catch(() => {});
};
const warnHaptic = (): void => {
  if (Platform.OS === "web") return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};

export const CoverPicker: React.FC<CoverPickerProps> = ({
  target,
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
  disabled = false,
  isWideDesktop = false,
  onCoverVideoProcessingChange,
}) => {
  const { isAuthReady } = useAuth();
  const isBrand = target.kind === "brand";
  const isNative = Platform.OS !== "web";
  const isPhoneWeb =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.innerWidth < 768;

  const [activeTab, setActiveTab] = useState<CoverTabId>("library");
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(null);

  // Video upload hook — event/trip writes events.cover_media_url; brand writes
  // brands.cover_media_url (via the apply step on ready). For brand, eventRowId
  // is unused server-side (sentinel passed for the hook's signature).
  const videoUpload = useEventCoverVideoUpload(
    isBrand ? "" : target.eventRowId,
    target.brandId,
    isBrand ? "published_manual" : target.coverMediaApplyMode,
    // META-ORCH-1059 Sub-B: experiences ride the event-cover video pipeline
    // (same events.cover_media_* columns + events-row id). Pass "experience"
    // for call-site clarity; the hook normalizes it to the "event" server path.
    isBrand ? "brand" : target.kind === "experience" ? "experience" : "event",
  );
  const lastVideoUploadFileRef = useRef<EventCoverVideoUploadFile | null>(null);
  const lastEmittedProcessedVideoUrlRef = useRef<string | null>(null);

  const brandCover = useBrandCoverUpload();

  // Local mirror of current cover for preview render + credit label.
  const [localCover, setLocalCover] = useState<CoverPatch>({
    coverMediaUrl: initialMediaUrl,
    coverMediaType: initialMediaType,
    coverMediaProvider: initialProvider,
    coverMediaSourceUrl: initialSourceUrl,
    coverMediaCredit: initialCredit,
    coverMediaCreditUrl: initialCreditUrl,
    coverMediaAlt: initialAlt,
  });

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

  // ----- Browse state (GIF + Stock tabs) ---------------------------------
  const [query, setQuery] = useState("");
  const [giphyStatus, setGiphyStatus] = useState<ProviderStatus>("idle");
  const [giphyError, setGiphyError] = useState<EventCoverProviderError["code"] | null>(null);
  const [giphyResults, setGiphyResults] = useState<GiphyCoverSearchResult[]>([]);
  const [pexelsStatus, setPexelsStatus] = useState<ProviderStatus>("idle");
  const [pexelsError, setPexelsError] = useState<EventCoverProviderError["code"] | null>(null);
  const [pexelsResults, setPexelsResults] = useState<PexelsCoverSearchResult[]>([]);
  const giphyLoadedRef = useRef(false);
  const pexelsLoadedRef = useRef(false);

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

  // Video ready → emit the upload-provider patch (events) OR rely on the brand
  // apply (brand). Both surface the processed Cloudinary URL in the preview.
  useEffect(() => {
    if (videoUpload.stage.phase !== "ready" || videoUpload.processedUrl === null) {
      return;
    }
    if (lastEmittedProcessedVideoUrlRef.current === videoUpload.processedUrl) {
      return;
    }
    lastEmittedProcessedVideoUrlRef.current = videoUpload.processedUrl;
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
  }, [emitChange, onShowToast, videoUpload.processedUrl, videoUpload.stage.phase]);

  // ----- Device image/GIF + video pickers --------------------------------

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
      if (error instanceof BrandCoverError) {
        onShowToast(error.message);
        return;
      }
      onShowToast("Cover upload failed. Try again.");
    },
    [onShowToast],
  );

  const ensureMediaPermission = useCallback(async (): Promise<boolean> => {
    const permission = await requestCoverMediaLibraryPermission();
    if (!permission.granted) {
      showUploadError(
        new EventCoverMediaError("permission_denied", "Photo library permission denied."),
      );
      return false;
    }
    return true;
  }, [showUploadError]);

  const validateEventRowId = useCallback((): boolean => {
    if (isBrand) return true;
    if (target.eventRowId.trim().length === 0) {
      showUploadError(
        new EventCoverMediaError("missing_server_event_id", "Missing server row id."),
      );
      return false;
    }
    return true;
  }, [isBrand, target, showUploadError]);

  const pickImageOrGifCover = useCallback(async (): Promise<void> => {
    if (uploading || disabled || activeVideoUpload) return;
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

    setUploading(true);
    let pickedAssets: Parameters<typeof revokeCoverPickedAssets>[0] = [];
    try {
      const result = await launchCoverImagePicker();
      if (result.canceled || result.assets.length === 0) return;
      pickedAssets = result.assets;
      const asset = result.assets[0];

      if (target.kind === "brand") {
        // Brand device upload → brand_covers bucket + brands.cover_media_url.
        const uploaded = await brandCover.uploadCover({
          brandId: target.brandId,
          accountId: target.accountId,
          existingDescription: target.existingDescription,
          previousMediaUrl: localCover.coverMediaUrl,
          source: {
            kind: "upload",
            asset: {
              uri: asset.uri,
              mimeType: asset.mimeType,
              fileName: asset.fileName,
              fileSize: asset.fileSize,
            },
          },
        });
        setMediaDisplayError(null);
        emitChange({
          coverMediaUrl: uploaded.publicUrl,
          coverMediaType: uploaded.mediaType === "gif" ? "gif" : "image",
          coverMediaProvider: UPLOAD_EVENT_COVER_PROVIDER_METADATA.provider,
          coverMediaSourceUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.sourceUrl,
          coverMediaCredit: UPLOAD_EVENT_COVER_PROVIDER_METADATA.credit,
          coverMediaCreditUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.creditUrl,
          coverMediaAlt: UPLOAD_EVENT_COVER_PROVIDER_METADATA.alt,
        });
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        onShowToast("Cover updated.");
        return;
      }

      // Event/trip device upload → event_covers bucket + 7-field patch.
      const upload = await uploadEventCoverMedia({
        uri: asset.uri,
        brandId: target.brandId,
        eventId: target.eventRowId,
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
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      onShowToast("Cover updated.");
    } catch (error) {
      showUploadError(error);
    } finally {
      revokeCoverPickedAssets(pickedAssets);
      setUploading(false);
    }
  }, [
    activeVideoUpload,
    brandCover,
    disabled,
    emitChange,
    ensureMediaPermission,
    isAuthReady,
    localCover.coverMediaUrl,
    onShowToast,
    showUploadError,
    target,
    uploading,
    validateEventRowId,
  ]);

  const pickVideoCover = useCallback(async (): Promise<void> => {
    if (uploading || disabled || activeVideoUpload) return;
    if (isPhoneWeb) {
      onShowToast("Video cover uploads are available on desktop or in the app for now.");
      return;
    }
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

    setUploading(true);
    let pickedAssets: Parameters<typeof revokeCoverPickedAssets>[0] = [];
    try {
      const result = await launchCoverVideoPicker();
      if (result.canceled || result.assets.length === 0) return;
      pickedAssets = result.assets;
      const asset = result.assets[0];
      // Web has no native trimmer (SC-7-Web-4): use the raw asset, no crash.
      // On web `trimVideoWithDedicatedEditor` resolves to a no-op stub, but we
      // still gate on `isNative` so the raw clip flows straight to upload.
      const trimResult = isNative
        ? await trimVideoWithDedicatedEditor(asset.uri, EVENT_COVER_MAX_VIDEO_DURATION_MS)
        : null;
      if (isNative && trimResult === null) return;
      const uploadFile =
        trimResult !== null
          ? await buildTrimmedVideoUploadFile({
              originalFileName: asset.fileName,
              originalMimeType: asset.mimeType,
              statFile: (uri) => getCoverPickerFileInfoAsync(uri),
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
        error instanceof Error ? error.message : "Video cover upload failed. Try again.",
      );
    } finally {
      revokeCoverPickedAssets(pickedAssets);
      setUploading(false);
    }
  }, [
    activeVideoUpload,
    disabled,
    ensureMediaPermission,
    isAuthReady,
    isNative,
    isPhoneWeb,
    onShowToast,
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

  // ----- Provider browse (gallery-first) ---------------------------------

  const loadTrending = useCallback(async (): Promise<void> => {
    if (giphyStatus === "loading") return;
    setGiphyStatus("loading");
    setGiphyError(null);
    try {
      const results = await trendingGiphyCovers({ limit: 24 });
      setGiphyResults(results);
      setGiphyStatus(results.length > 0 ? "populated" : "empty");
      giphyLoadedRef.current = true;
    } catch (error) {
      const code =
        error instanceof EventCoverProviderError ? error.code : "provider_unavailable";
      setGiphyError(code);
      setGiphyStatus("error");
      warnHaptic();
    }
  }, [giphyStatus]);

  const loadCurated = useCallback(async (): Promise<void> => {
    if (pexelsStatus === "loading") return;
    setPexelsStatus("loading");
    setPexelsError(null);
    try {
      const page = await curatedPexelsCovers({ perPage: 20 });
      setPexelsResults(page.photos);
      setPexelsStatus(page.photos.length > 0 ? "populated" : "empty");
      pexelsLoadedRef.current = true;
    } catch (error) {
      const code =
        error instanceof EventCoverProviderError ? error.code : "provider_unavailable";
      setPexelsError(code);
      setPexelsStatus("error");
      warnHaptic();
    }
  }, [pexelsStatus]);

  // Gallery-first: when entering GIF/Stock with an empty query and no prior
  // load this session, fire trending/curated. One call per tab-open session.
  useEffect(() => {
    if (disabled) return;
    if (activeTab === "gif" && !giphyLoadedRef.current && query.trim().length === 0) {
      void loadTrending();
    } else if (activeTab === "stock" && !pexelsLoadedRef.current && query.trim().length === 0) {
      void loadCurated();
    }
  }, [activeTab, disabled, loadCurated, loadTrending, query]);

  const runProviderSearch = useCallback(async (): Promise<void> => {
    if (disabled) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    if (activeTab === "gif") {
      setGiphyStatus("loading");
      setGiphyError(null);
      try {
        const results = await searchGiphyEventCovers(trimmed, { limit: 24 });
        setGiphyResults(results);
        setGiphyStatus(results.length > 0 ? "populated" : "empty");
      } catch (error) {
        const code =
          error instanceof EventCoverProviderError ? error.code : "provider_unavailable";
        setGiphyError(code);
        setGiphyStatus("error");
        warnHaptic();
      }
    } else if (activeTab === "stock") {
      setPexelsStatus("loading");
      setPexelsError(null);
      try {
        const page = await searchPexelsEventCovers(trimmed, { perPage: 20 });
        setPexelsResults(page.photos);
        setPexelsStatus(page.photos.length > 0 ? "populated" : "empty");
      } catch (error) {
        const code =
          error instanceof EventCoverProviderError ? error.code : "provider_unavailable";
        setPexelsError(code);
        setPexelsStatus("error");
        warnHaptic();
      }
    }
  }, [activeTab, disabled, query]);

  const clearSearch = useCallback((): void => {
    setQuery("");
    // Restore the cached trending/curated grid (no new network if loaded).
    if (activeTab === "gif" && giphyLoadedRef.current) {
      setGiphyStatus(giphyResults.length > 0 ? "populated" : "empty");
    } else if (activeTab === "gif") {
      void loadTrending();
    }
    if (activeTab === "stock" && pexelsLoadedRef.current) {
      setPexelsStatus(pexelsResults.length > 0 ? "populated" : "empty");
    } else if (activeTab === "stock") {
      void loadCurated();
    }
  }, [activeTab, giphyResults.length, loadCurated, loadTrending, pexelsResults.length]);

  // ----- Selection persistence -------------------------------------------

  const selectGiphy = useCallback(
    async (result: GiphyCoverSearchResult): Promise<void> => {
      if (disabled) return;
      lightHaptic();
      setMediaDisplayError(null);
      if (target.kind === "brand") {
        // Host-validated brand persistence (anti-injection, ORCH-0805).
        try {
          await brandCover.uploadCover({
            brandId: target.brandId,
            accountId: target.accountId,
            existingDescription: target.existingDescription,
            previousMediaUrl: localCover.coverMediaUrl,
            source: {
              kind: "provider",
              ref: {
                provider: "giphy",
                publicUrl: result.mediaUrl,
                attribution:
                  result.creditUrl !== null
                    ? { name: result.credit, url: result.creditUrl }
                    : null,
              },
            },
          });
        } catch (error) {
          showUploadError(error);
          return;
        }
      }
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
    [brandCover, disabled, emitChange, localCover.coverMediaUrl, onShowToast, showUploadError, target],
  );

  const selectPexels = useCallback(
    async (result: PexelsCoverSearchResult): Promise<void> => {
      if (disabled) return;
      lightHaptic();
      setMediaDisplayError(null);
      if (target.kind === "brand") {
        try {
          await brandCover.uploadCover({
            brandId: target.brandId,
            accountId: target.accountId,
            existingDescription: target.existingDescription,
            previousMediaUrl: localCover.coverMediaUrl,
            source: {
              kind: "provider",
              ref: {
                provider: "pexels",
                publicUrl: result.mediaUrl,
                attribution: { name: result.credit, url: result.creditUrl },
              },
            },
          });
        } catch (error) {
          showUploadError(error);
          return;
        }
      }
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
    [brandCover, disabled, emitChange, localCover.coverMediaUrl, onShowToast, showUploadError, target],
  );

  const handleRemoveCover = useCallback((): void => {
    if (disabled) return;
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setMediaDisplayError(null);
    // Emit the null patch. For brand the parent (BrandEditView /
    // BrandCreationFlow) mirrors into its draft and persists the cleared
    // cover on Save (the brand save path already writes cover_media_url).
    // For event/trip the parent persists through its existing cover patch.
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

  const switchTab = useCallback((tab: CoverTabId): void => {
    tickHaptic();
    setActiveTab(tab);
    setQuery("");
  }, []);

  const columns = isWideDesktop ? 3 : 2;
  const hasCover = localCover.coverMediaUrl !== null;

  // META-ORCH-1059: which GIF / Pexels tile is the currently-applied cover.
  // Matched by the APPLIED media URL (result.mediaUrl), not the preview URL —
  // tapping a tile calls emitChange with result.mediaUrl, so localCover holds
  // that exact URL. Exactly one id can match at a time across all tabs.
  const selectedGiphyId = findSelectedProviderId(
    localCover.coverMediaUrl,
    localCover.coverMediaProvider,
    "giphy",
    giphyResults,
  );
  const selectedPexelsId = findSelectedProviderId(
    localCover.coverMediaUrl,
    localCover.coverMediaProvider,
    "pexels",
    pexelsResults,
  );

  return (
    <View style={styles.root}>
      {/* Tab bar — segmented control (DESIGN §3). */}
      <View style={styles.tabTrack} accessibilityRole="tablist">
        {TAB_DEFS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Pressable
              key={tab.id}
              onPress={() => switchTab(tab.id)}
              disabled={disabled}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive, disabled }}
              accessibilityLabel={`${tab.label} tab`}
              style={[styles.tabSegment, isActive && styles.tabSegmentActive]}
            >
              <Icon
                name={tab.icon}
                size={16}
                color={isActive ? accent.warm : textTokens.tertiary}
              />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Search bar — GIF + Stock only. */}
      {(activeTab === "gif" || activeTab === "stock") ? (
        <View style={styles.searchRow}>
          <Icon name="search" size={18} color={textTokens.tertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              activeTab === "gif"
                ? "Search GIFs (or just browse)"
                : "Search photos (or just browse)"
            }
            placeholderTextColor={textTokens.tertiary}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => {
              void runProviderSearch();
            }}
            style={styles.searchInput}
            editable={!disabled}
            accessibilityLabel={activeTab === "gif" ? "Search GIFs" : "Search photos"}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={clearSearch}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={18} color={textTokens.tertiary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Tab bodies */}
      {activeTab === "library" ? (
        <LibraryTab
          hasCover={hasCover}
          hue={initialCoverHue}
          activeMediaUrl={activeMediaUrl}
          activeMediaType={activeMediaType}
          alt={localCover.coverMediaAlt}
          credit={selectedCredit}
          uploading={uploading}
          activeVideoUpload={activeVideoUpload}
          videoStageCopy={videoStageCopy}
          videoPercent={videoUpload.stage.percent}
          videoErrorMessage={
            videoUpload.stage.phase === "error" ? videoUpload.stage.message : null
          }
          canRetryVideo={lastVideoUploadFileRef.current !== null}
          disabled={disabled}
          isPhoneWeb={isPhoneWeb}
          onPickImage={pickImageOrGifCover}
          onPickVideo={() => {
            void pickVideoCover();
          }}
          onRemove={handleRemoveCover}
          onCancelVideo={cancelVideoCoverUpload}
          onRetryVideo={retryVideoCoverUpload}
          onMediaError={handleMediaRenderError}
          mediaDisplayError={mediaDisplayError}
        />
      ) : null}

      {activeTab === "gif" ? (
        <ProviderGrid
          kind="gif"
          status={giphyStatus}
          errorCode={giphyError}
          columns={columns}
          giphy={giphyResults}
          pexels={[]}
          selectedGiphyId={selectedGiphyId}
          selectedPexelsId={null}
          onSelectGiphy={(r) => {
            void selectGiphy(r);
          }}
          onSelectPexels={() => {}}
          onRetry={() => {
            if (query.trim().length >= 2) void runProviderSearch();
            else void loadTrending();
          }}
          onUseLibrary={() => switchTab("library")}
          searchActive={query.trim().length >= 2}
        />
      ) : null}

      {activeTab === "stock" ? (
        <ProviderGrid
          kind="stock"
          status={pexelsStatus}
          errorCode={pexelsError}
          columns={columns}
          giphy={[]}
          pexels={pexelsResults}
          selectedGiphyId={null}
          selectedPexelsId={selectedPexelsId}
          onSelectGiphy={() => {}}
          onSelectPexels={(r) => {
            void selectPexels(r);
          }}
          onRetry={() => {
            if (query.trim().length >= 2) void runProviderSearch();
            else void loadCurated();
          }}
          onUseLibrary={() => switchTab("library")}
          searchActive={query.trim().length >= 2}
        />
      ) : null}
    </View>
  );
};

// ----- Library tab (preview + action row + video affordance) -------------

const LibraryTab: React.FC<{
  hasCover: boolean;
  hue: number;
  activeMediaUrl: string | null;
  activeMediaType: EventCoverMediaType | null;
  alt: string | null;
  credit: string | null;
  uploading: boolean;
  activeVideoUpload: boolean;
  videoStageCopy: string | null;
  videoPercent: number;
  videoErrorMessage: string | null;
  canRetryVideo: boolean;
  disabled: boolean;
  isPhoneWeb: boolean;
  onPickImage: () => void;
  onPickVideo: () => void;
  onRemove: () => void;
  onCancelVideo: () => void;
  onRetryVideo: () => void;
  onMediaError: (e: EventCoverMediaErrorEvent) => void;
  mediaDisplayError: string | null;
}> = ({
  hasCover,
  hue,
  activeMediaUrl,
  activeMediaType,
  alt,
  credit,
  uploading,
  activeVideoUpload,
  videoStageCopy,
  videoPercent,
  videoErrorMessage,
  canRetryVideo,
  disabled,
  isPhoneWeb,
  onPickImage,
  onPickVideo,
  onRemove,
  onCancelVideo,
  onRetryVideo,
  onMediaError,
  mediaDisplayError,
}) => (
  <View>
    <View style={[styles.coverPreview, hasCover && !activeVideoUpload && styles.coverPreviewSelected]}>
      <EventCoverMedia
        hue={hue}
        mediaUrl={activeMediaUrl}
        mediaType={activeMediaType}
        radius={radiusTokens.md}
        label={alt ?? "cover"}
        height={180}
        onMediaError={onMediaError}
        muted={true}
        showAudioControl={activeMediaType === "video"}
      >
        {activeVideoUpload && videoStageCopy !== null ? (
          <View style={styles.videoProgressOverlay}>
            <Text style={styles.videoProgressText}>{videoStageCopy}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${videoPercent}%` }]} />
            </View>
          </View>
        ) : null}
      </EventCoverMedia>
      {/* META-ORCH-1059: a check badge on the live preview signals the current
          cover is applied (parity with the GIF/Stock tile selected state). */}
      {hasCover && !activeVideoUpload ? (
        <View style={styles.selectedBadge} pointerEvents="none">
          <Icon name="check" size={14} color={textTokens.inverse} />
        </View>
      ) : null}
    </View>
    {credit !== null ? <Text style={styles.creditText}>{credit}</Text> : null}

    {activeVideoUpload ? (
      // META-ORCH-1009 Sub-F: while a video processes, show ONLY the progress
      // (spinner/percent overlay sits on the preview above) + Cancel. Hide all
      // other controls so the operator isn't tempted to act mid-process.
      <View style={styles.actionRow}>
        <Button
          label="Cancel upload"
          variant="ghost"
          size="md"
          shape="square"
          onPress={onCancelVideo}
          style={styles.actionButton}
        />
      </View>
    ) : (
      <>
        <View style={styles.actionRow}>
          <Button
            label={hasCover ? "Replace" : "Image"}
            leadingIcon="upload"
            variant="secondary"
            size="md"
            shape="square"
            onPress={onPickImage}
            loading={uploading}
            disabled={uploading || disabled}
            style={styles.actionButton}
          />
          <Button
            label="Video"
            leadingIcon="play"
            variant="secondary"
            size="md"
            shape="square"
            onPress={onPickVideo}
            disabled={uploading || disabled || isPhoneWeb}
            style={styles.actionButton}
          />
          {hasCover ? (
            <Button
              label="Remove"
              leadingIcon="trash"
              variant="ghost"
              size="md"
              shape="square"
              onPress={onRemove}
              disabled={uploading || disabled}
              style={styles.removeButton}
            />
          ) : null}
        </View>

        {isPhoneWeb ? (
          <Text style={styles.helperText}>
            Device image uploads are available in this browser. Video covers are
            available on desktop or in the Mingla Business app for now.
          </Text>
        ) : Platform.OS === "web" ? (
          <Text style={styles.helperText}>
            On the web, video uploads use the clip as-is. For trimming, use the
            Mingla Business app.
          </Text>
        ) : null}

        {videoErrorMessage !== null ? (
          <View style={styles.videoErrorRow}>
            <Text accessibilityRole="alert" style={styles.mediaErrorText}>
              {videoErrorMessage}
            </Text>
            {canRetryVideo ? (
              <Button
                label="Upload failed - try again"
                variant="secondary"
                size="sm"
                shape="square"
                onPress={onRetryVideo}
                disabled={uploading || disabled}
                style={styles.retryButton}
              />
            ) : null}
          </View>
        ) : null}

        <Text style={styles.uploadLimitText}>{EVENT_COVER_UPLOAD_LIMIT_COPY}</Text>
        <Text style={styles.uploadLimitText}>{EVENT_COVER_VIDEO_PROCESSING_COPY}</Text>

        {mediaDisplayError !== null ? (
          <Text accessibilityRole="alert" style={styles.mediaErrorText}>
            {mediaDisplayError}
          </Text>
        ) : null}
      </>
    )}
  </View>
);

// ----- Provider grid (GIF/Stock masonry + 9 states) ----------------------

const PROVIDER_ERROR_COPY: Record<
  "gif" | "stock",
  Record<string, { title: string; body: string }>
> = {
  gif: {
    rate_limited: { title: "Whoa, slow down.", body: "We've hit the hourly limit for GIFs. Give it a minute." },
    not_configured: { title: "This source is taking a break.", body: "GIFs aren't available right now — your own Library still works." },
    provider_unavailable: { title: "Couldn't reach GIPHY.", body: "Our bad — give it another shot." },
    invalid_response: { title: "That came back scrambled.", body: "Try again — usually a one-off." },
    auth_required: { title: "Sign in again.", body: "Your session needs a refresh to browse GIFs." },
  },
  stock: {
    rate_limited: { title: "Whoa, slow down.", body: "We've hit the hourly limit for photos. Give it a minute." },
    not_configured: { title: "This source is taking a break.", body: "Photos aren't available right now — your own Library still works." },
    provider_unavailable: { title: "Couldn't reach Pexels.", body: "Our bad — give it another shot." },
    invalid_response: { title: "That came back scrambled.", body: "Try again — usually a one-off." },
    auth_required: { title: "Sign in again.", body: "Your session needs a refresh to browse photos." },
  },
};

const ProviderGrid: React.FC<{
  kind: "gif" | "stock";
  status: ProviderStatus;
  errorCode: string | null;
  columns: number;
  giphy: GiphyCoverSearchResult[];
  pexels: PexelsCoverSearchResult[];
  /** META-ORCH-1059: id of the GIF tile that is the current cover (or null). */
  selectedGiphyId: string | null;
  /** META-ORCH-1059: id of the Pexels tile that is the current cover (or null). */
  selectedPexelsId: number | null;
  onSelectGiphy: (r: GiphyCoverSearchResult) => void;
  onSelectPexels: (r: PexelsCoverSearchResult) => void;
  onRetry: () => void;
  onUseLibrary: () => void;
  searchActive: boolean;
}> = ({
  kind,
  status,
  errorCode,
  columns,
  giphy,
  pexels,
  selectedGiphyId,
  selectedPexelsId,
  onSelectGiphy,
  onSelectPexels,
  onRetry,
  onUseLibrary,
  searchActive,
}) => {
  const attribution = kind === "gif" ? "Powered by GIPHY" : "Photos provided by Pexels";

  if (status === "loading" || status === "idle") {
    return (
      <View style={styles.gridStateHost}>
        <ActivityIndicator size="small" color={accent.warm} />
        <Text style={styles.providerFooter}>{attribution}</Text>
      </View>
    );
  }

  if (status === "error") {
    const copy =
      (errorCode !== null && PROVIDER_ERROR_COPY[kind][errorCode]) ||
      PROVIDER_ERROR_COPY[kind].provider_unavailable;
    const noRetry = errorCode === "not_configured";
    return (
      <View style={styles.gridStateHost}>
        <Icon name="globe" size={36} color={semantic.error} />
        <Text style={styles.stateTitle}>{copy.title}</Text>
        <Text style={styles.stateBody}>{copy.body}</Text>
        {noRetry ? (
          <Button label="Use Library" variant="secondary" size="sm" shape="square" onPress={onUseLibrary} />
        ) : (
          <Button label="Try again" variant="secondary" size="sm" shape="square" onPress={onRetry} />
        )}
        <Text style={styles.providerFooter}>{attribution}</Text>
      </View>
    );
  }

  if (status === "empty") {
    return (
      <View style={styles.gridStateHost}>
        <Icon name="search" size={36} color={textTokens.tertiary} />
        <Text style={styles.stateTitle}>
          {searchActive
            ? kind === "gif"
              ? "No GIFs for that."
              : "Nothing matched."
            : "Nothing to show right now."}
        </Text>
        <Text style={styles.stateBody}>
          {searchActive
            ? "Try fewer words — or just browse what's hot."
            : "Odd. Give it a sec and try again."}
        </Text>
        <Button label="Try again" variant="secondary" size="sm" shape="square" onPress={onRetry} />
        <Text style={styles.providerFooter}>{attribution}</Text>
      </View>
    );
  }

  // Populated — masonry via N flex columns, shortest-column insertion.
  const columnBuckets: Array<Array<{ key: string; node: React.ReactNode }>> = Array.from(
    { length: columns },
    () => [],
  );
  const columnHeights = new Array<number>(columns).fill(0);
  const pushTile = (key: string, aspect: number, node: React.ReactNode): void => {
    let shortest = 0;
    for (let i = 1; i < columns; i += 1) {
      if (columnHeights[i] < columnHeights[shortest]) shortest = i;
    }
    columnBuckets[shortest].push({ key, node });
    columnHeights[shortest] += 1 / Math.max(0.4, aspect);
  };

  if (kind === "gif") {
    giphy.forEach((r) => {
      pushTile(
        `giphy-${r.id}`,
        1,
        <GridTile
          key={`giphy-${r.id}`}
          imageUrl={r.previewUrl}
          label={r.alt ?? "GIPHY GIF"}
          selected={selectedGiphyId === r.id}
          onPress={() => onSelectGiphy(r)}
        />,
      );
    });
  } else {
    pexels.forEach((r) => {
      pushTile(
        `pexels-${r.id}`,
        r.width > 0 && r.height > 0 ? r.width / r.height : 1,
        <GridTile
          key={`pexels-${r.id}`}
          imageUrl={r.mediaUrl}
          aspect={r.width > 0 && r.height > 0 ? r.width / r.height : 1}
          avgColor={r.avgColor}
          label={r.alt ?? "Pexels photo"}
          credit={r.credit}
          selected={selectedPexelsId === r.id}
          onPress={() => onSelectPexels(r)}
        />,
      );
    });
  }

  return (
    <View>
      <ScrollView contentContainerStyle={styles.masonryHost} showsVerticalScrollIndicator={false}>
        <View style={styles.masonryColumns}>
          {columnBuckets.map((bucket, i) => (
            <View key={`col-${i}`} style={styles.masonryColumn}>
              {bucket.map((t) => t.node)}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={styles.providerFooter}>{attribution}</Text>
    </View>
  );
};

const GridTile: React.FC<{
  imageUrl: string;
  label: string;
  aspect?: number;
  avgColor?: string | null;
  credit?: string;
  /** META-ORCH-1059: paint the accent border + checkmark when this tile IS the
   *  currently-applied cover. */
  selected?: boolean;
  onPress: () => void;
}> = ({ imageUrl, label, aspect = 1, avgColor, credit, selected = false, onPress }) => (
  <Pressable
    accessibilityRole="imagebutton"
    accessibilityState={{ selected }}
    accessibilityLabel={
      `${selected ? "Selected cover. " : ""}` +
      (credit !== undefined ? `Select ${label} by ${credit}` : `Select ${label}`)
    }
    onPress={onPress}
    style={({ pressed }) => [
      styles.tile,
      selected && styles.tileSelected,
      pressed && styles.tilePressed,
    ]}
  >
    <Image
      source={{ uri: imageUrl }}
      style={[
        styles.tileImage,
        { aspectRatio: Math.max(0.5, Math.min(aspect, 2)) },
        avgColor ? { backgroundColor: avgColor } : null,
      ]}
    />
    {selected ? (
      <View style={styles.selectedBadge} pointerEvents="none">
        <Icon name="check" size={14} color={textTokens.inverse} />
      </View>
    ) : null}
    {credit !== undefined ? (
      <Text style={styles.tileCredit} numberOfLines={1}>
        — {credit}
      </Text>
    ) : null}
  </Pressable>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabTrack: {
    flexDirection: "row",
    height: 40,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    padding: 3,
    marginBottom: spacing.md,
  },
  tabSegment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radiusTokens.sm,
  },
  tabSegmentActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  tabLabel: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  tabLabelActive: {
    color: accent.warm,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  coverPreview: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  // META-ORCH-1059: accent ring on the Library preview when a cover is applied.
  coverPreviewSelected: {
    borderWidth: 2,
    borderColor: accent.border,
  },
  creditText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 140,
  },
  removeButton: {
    minWidth: 96,
  },
  helperText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
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
    backgroundColor: "rgba(12, 14, 18, 0.62)",
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
  gridStateHost: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  stateTitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "center",
  },
  stateBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  masonryHost: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  masonryColumns: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  masonryColumn: {
    flex: 1,
    gap: spacing.sm,
  },
  tile: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
  },
  tilePressed: {
    opacity: 0.82,
  },
  // META-ORCH-1059: persistent SELECTED treatment on the active-cover tile.
  tileSelected: {
    borderWidth: 2,
    borderColor: accent.border,
  },
  selectedBadge: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: textTokens.inverse,
  },
  tileImage: {
    width: "100%",
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileElevated,
  },
  tileCredit: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  providerFooter: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
