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
  InteractionManager,
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
  androidOpaque,
  ariThread,
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
  type EventCoverVideoStatus,
  type EventCoverVideoUploadStage,
} from "../../services/eventCoverVideoProcessingService";
import {
  useEventCoverVideoUpload,
  type EventCoverVideoUploadFile,
} from "../../hooks/useEventCoverVideoUpload";
import {
  buildTrimmedVideoUploadFile,
  normalizePickerDurationMs,
  resolveRawClipUploadUri,
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
import {
  curatedPexelsCovers,
  trendingGiphyCovers,
} from "../../services/coverProviderBrowseService";
import { EventCoverProviderError } from "../../services/eventCoverProviderError";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import {
  eventCoverProviderCreditLabel,
  UPLOAD_EVENT_COVER_PROVIDER_METADATA,
} from "../../types/eventCoverProvider";
import type { EventCoverMediaProvider } from "../../types/eventCoverProvider";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import { useBrandCoverUpload } from "../../hooks/useBrandCoverUpload";
import { extractCoverGifPoster } from "../../services/coverGifPoster";
// META-ORCH-1255(C) D-C: the VENUE target uses the storage-only upload +
// provider URL validation directly — never useBrandCoverUpload, whose
// updateBrand mutation patches brands.cover_media_url (the venue row is the
// cover's owner; the host persists via syncHeroMedia).
import {
  coverFromProviderRef,
  uploadBrandCover,
} from "../../services/brandCoverService";
import { BrandCoverError } from "../../utils/brandCoverRules";
import { Button } from "./Button";
import { findSelectedProviderId } from "./coverPickerSelection";
import { Icon } from "./Icon";
import { EventCoverMedia, type EventCoverMediaErrorEvent } from "./EventCoverMedia";
import { useAuth } from "../../context/AuthContext";
import type { CoverTarget } from "./coverTarget";
// issue #868 [cover-gallery] — the ADDITIONAL image/GIF gallery item type
// (shared package is the single owner of the offering-render prop contract).
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

export type { CoverTarget } from "./coverTarget";

// LOCKED tab ids (SPEC §4.3); display labels are designer-owned copy (DESIGN §3.1).
type CoverTabId = "library" | "gif" | "stock";
type ProviderStatus = "idle" | "loading" | "populated" | "empty" | "error";

/**
 * ORCH-1116: route a provider (GIF/Stock) error to engineering telemetry ONLY
 * when it is a non-transient CONFIG fault (`not_configured`) — i.e. the build is
 * mis-provisioned (e.g. a missing client-direct GIPHY key). Transient faults
 * (`provider_unavailable`/`rate_limited`/`invalid_response`) stay user-facing
 * only (friendly copy) to avoid alert noise. The friendly UI copy is unchanged;
 * this only adds an alert for the silent-config case. Single telemetry call-site.
 */
export const reportProviderError = (
  kind: "gif" | "stock",
  error: unknown,
): void => {
  const code =
    error instanceof EventCoverProviderError ? error.code : "provider_unavailable";
  if (code !== "not_configured") return;
  reportNonFatal("coverPicker.provider", error, { provider: kind, code });
};

/** Full cover patch emitted on every change. Mirror of the events
 *  table cover_media_* column family. UNCHANGED from prior CoverPicker. */
export interface CoverPatch {
  coverMediaUrl: string | null;
  coverMediaPosterUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider: EventCoverMediaProvider | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
  /**
   * issue #868 [cover-gallery] — ADDITIONAL image/GIF cover-gallery items,
   * ordered, hero indices 1..N. OPTIONAL + default-safe: absent/[] ⇒ single-cover
   * behavior (every existing host that builds a CoverPatch is unchanged). The 7
   * cover fields above are UNCHANGED and INDEPENDENT — no field of one is derived
   * from the other (the ONE exception is the user-initiated "Make cover" action).
   */
  coverGallery?: OfferingGalleryImage[];
}

export interface CoverPickerProps {
  /** Discriminated cover target — drives persistence + video availability. */
  target: CoverTarget;
  /** Cover hue fallback for empty preview (0..360). */
  initialCoverHue?: number;
  initialMediaUrl: string | null;
  initialMediaPosterUrl?: string | null;
  initialMediaType: EventCoverMediaType | null;
  initialProvider: EventCoverMediaProvider | null;
  initialSourceUrl: string | null;
  initialCredit: string | null;
  initialCreditUrl: string | null;
  initialAlt: string | null;
  /** issue #868 [cover-gallery] — the ADDITIONAL image/GIF items (default []). */
  initialCoverGallery?: OfferingGalleryImage[];
  onCoverChange: (patch: CoverPatch) => void | Promise<void>;
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

// issue #1348 — map a raw pick/trim failure to friendly in-sheet copy so the
// scary system string (e.g. "PHPhotosErrorDomain error 3164") never reaches the
// user. Defensive substring match on error.message; first match wins; non-Error
// throws fall through to the generic clause. Cancel (Back) never reaches here —
// it early-returns with an info notice upstream, so no cancel becomes an error.
const friendlyVideoCoverError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : "";
  const message = raw.toLowerCase();
  // A never-presented trim editor already throws friendly copy
  // (presentationFailedError, "The trim screen didn't open…") — pass through.
  if (message.includes("trim screen didn't open")) {
    return raw;
  }
  // iCloud-only / network-required asset (expo PHPhotosErrorDomain 3164).
  if (
    message.includes("3164") ||
    message.includes("phphotoserrordomain") ||
    message.includes("networkaccessrequired") ||
    message.includes("icloud")
  ) {
    return "This video is saved in iCloud. Open it in Photos to download it to your phone, then try again.";
  }
  // Trim / FFmpeg export failure (react-native-video-trim onError; rc 1).
  if (
    message.includes("video trim failed") ||
    message.includes("video trim") ||
    message.includes("trimming_failed") ||
    message.includes("command failed") ||
    message.includes("rc 1")
  ) {
    return "Couldn't trim this video. Try another clip.";
  }
  // Generic fallback (incl. non-Error throw) — never the raw system message.
  return "Couldn't add this video. Try another clip.";
};

// issue #1338 — present-after-dismissal. expo-image-picker's
// launchImageLibraryAsync promise can resolve BEFORE the picker's native
// dismiss transition finishes on iOS; presenting the trim modal in that window
// is refused by iOS New Arch ("already presenting"). Drain RN interactions,
// then settle past the ~250ms iOS modal dismiss animation.
const PICKER_DISMISS_SETTLE_MS = 300;
const waitForPickerDismissal = (): Promise<void> =>
  new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(resolve, PICKER_DISMISS_SETTLE_MS);
    });
  });

export const CoverPicker: React.FC<CoverPickerProps> = ({
  target,
  initialCoverHue = 0,
  initialMediaUrl,
  initialMediaPosterUrl = null,
  initialMediaType,
  initialProvider,
  initialSourceUrl,
  initialCredit,
  initialCreditUrl,
  initialAlt,
  initialCoverGallery,
  onCoverChange,
  onShowToast,
  disabled = false,
  isWideDesktop = false,
  onCoverVideoProcessingChange,
}) => {
  const { isAuthReady } = useAuth();
  const isBrand = target.kind === "brand";
  // META-ORCH-1255(C) D-C: venue-listing hero target — brand-like storage +
  // video pipeline, ZERO brands-row writes (host persists the emitted patch).
  const isVenue = target.kind === "venue" || target.kind === "venue_draft";
  const eventRowId = target.kind === "event" || target.kind === "trip" || target.kind === "experience"
    ? target.eventRowId
    : "";
  const isNative = Platform.OS !== "web";

  const [activeTab, setActiveTab] = useState<CoverTabId>("library");
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(null);
  // issue #1338 — in-sheet feedback channel for the cover-VIDEO flow. Rendered
  // INSIDE LibraryTab (never a root-portal Toast, which iOS drops while the
  // CoverPickerSheet modal is up). tone drives info (warm) vs error (semantic).
  const [videoPickNotice, setVideoPickNotice] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);

  // Video upload hook — event/trip writes events.cover_media_url; brand writes
  // brands.cover_media_url (via the apply step on ready). For brand, eventRowId
  // is unused server-side (sentinel passed for the hook's signature).
  const videoUpload = useEventCoverVideoUpload(
    eventRowId,
    target.brandId,
    isBrand || isVenue ? "published_manual" : target.coverMediaApplyMode,
    // META-ORCH-1059 Sub-B: experiences ride the event-cover video pipeline
    // (same events.cover_media_* columns + events-row id). Pass "experience"
    // for call-site clarity; the hook normalizes it to the "event" server path.
    // META-ORCH-1255(C) D-C: "venue" rides the brand server pipeline for
    // processing but SKIPS the apply step (which writes brands.cover_media_url)
    // — the processed URL flows out via the ready-emit and the host persists
    // it to the venue row.
    isBrand
      ? "brand"
      : isVenue
        ? target.kind
        : target.kind === "experience"
          ? "experience"
          : "event",
    target.kind === "venue"
      ? { venueId: target.venueId }
      : target.kind === "venue_draft"
        ? { draftOwnerKey: target.draftOwnerKey }
        : {},
  );
  const lastVideoUploadFileRef = useRef<EventCoverVideoUploadFile | null>(null);
  const lastEmittedProcessedVideoUrlRef = useRef<string | null>(null);
  const savingProcessedVideoUrlRef = useRef<string | null>(null);
  // ORCH-1308: hold the picked video blob assets across a retry. On web the
  // upload reads the clip via fetch(blob:uri); revoking the blob in the pick's
  // finally killed the "try again" path (retry re-fetched a dead blob →
  // "Could not read the selected video in your browser"). Keep the blob alive
  // until a NEW pick replaces it or the component unmounts. (Native assets carry
  // no objectUrl, so revokeCoverPickedAssets is a no-op for them.)
  const pickedVideoAssetsRef = useRef<
    Parameters<typeof revokeCoverPickedAssets>[0]
  >([]);
  useEffect(
    () => () => {
      revokeCoverPickedAssets(pickedVideoAssetsRef.current);
    },
    [],
  );

  const brandCover = useBrandCoverUpload();

  // Local mirror of current cover for preview render + credit label.
  const [localCover, setLocalCover] = useState<CoverPatch>({
    coverMediaUrl: initialMediaUrl,
    coverMediaPosterUrl: initialMediaPosterUrl,
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
      coverMediaPosterUrl: initialMediaPosterUrl,
      coverMediaType: initialMediaType,
      coverMediaProvider: initialProvider,
      coverMediaSourceUrl: initialSourceUrl,
      coverMediaCredit: initialCredit,
      coverMediaCreditUrl: initialCreditUrl,
      coverMediaAlt: initialAlt,
    });
  }, [
    initialMediaUrl,
    initialMediaPosterUrl,
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

  // issue #868 [cover-gallery] — the ADDITIONAL image/GIF items, managed
  // SEPARATELY from the primary cover. A ref mirrors the state so cover-only
  // emits (emitChange) always carry the current gallery without stale closures.
  const [gallery, setGallery] = useState<OfferingGalleryImage[]>(
    initialCoverGallery ?? [],
  );
  const galleryRef = useRef<OfferingGalleryImage[]>(initialCoverGallery ?? []);
  useEffect(() => {
    const next = initialCoverGallery ?? [];
    setGallery(next);
    galleryRef.current = next;
  }, [initialCoverGallery]);
  const localCoverRef = useRef<CoverPatch>(localCover);
  useEffect(() => {
    localCoverRef.current = localCover;
  }, [localCover]);
  // Confirm state for the OQ-3 "replace video cover with this photo?" flow. Holds
  // the gallery index awaiting confirmation (null = no pending confirm).
  const [pendingMakeCoverIndex, setPendingMakeCoverIndex] = useState<number | null>(
    null,
  );
  // issue #868 [cover-gallery], M.3 — GIF/Photos tab target: "cover" (default,
  // today's behavior byte-identical) OR "gallery" (append the provider pick to the
  // additional photos, never touch the cover fields).
  const [providerAddTarget, setProviderAddTarget] = useState<"cover" | "gallery">(
    "cover",
  );
  const [readyPersistenceFailed, setReadyPersistenceFailed] = useState(false);
  const GALLERY_MAX = 8;

  const projectedVideoStage: EventCoverVideoUploadStage = readyPersistenceFailed && videoUpload.status?.status === "ready"
    ? { phase: "ready" as const, percent: 100 }
    : videoUpload.stage;

  useEffect(() => {
    onCoverVideoProcessingChange?.(
      !["idle", "ready", "applied", "error"].includes(projectedVideoStage.phase),
    );
  }, [onCoverVideoProcessingChange, projectedVideoStage.phase]);

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
  const activeVideoUpload = !["idle", "ready", "applied", "error"].includes(videoUpload.stage.phase);
  const lockedVideoOperation = activeVideoUpload || projectedVideoStage.phase === "ready";
  const activeMediaUrl =
    videoUpload.localPreviewUri ??
    videoUpload.processedUrl ??
    localCover.coverMediaUrl;
  const activeMediaType =
    videoUpload.localPreviewUri !== null || videoUpload.processedUrl !== null
      ? "video"
      : localCover.coverMediaType;

  const emitChange = useCallback(
    async (patch: CoverPatch): Promise<void> => {
      setLocalCover(patch);
      // issue #868 — always carry the current gallery so a cover change never
      // drops the additional photos (they are INDEPENDENT of the cover).
      await onCoverChange({ ...patch, coverGallery: galleryRef.current });
    },
    [onCoverChange],
  );

  const persistReadyVideo = useCallback(async (): Promise<void> => {
    const readyUrl = videoUpload.processedUrl;
    if (readyUrl === null || lastEmittedProcessedVideoUrlRef.current === readyUrl || savingProcessedVideoUrlRef.current === readyUrl) return;
    savingProcessedVideoUrlRef.current = readyUrl;
    setReadyPersistenceFailed(false);
    setMediaDisplayError(null);
    try {
      await emitChange({
        coverMediaUrl: readyUrl,
        coverMediaPosterUrl: videoUpload.processedPosterUrl,
        coverMediaType: "video",
        coverMediaProvider: UPLOAD_EVENT_COVER_PROVIDER_METADATA.provider,
        coverMediaSourceUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.sourceUrl,
        coverMediaCredit: UPLOAD_EVENT_COVER_PROVIDER_METADATA.credit,
        coverMediaCreditUrl: UPLOAD_EVENT_COVER_PROVIDER_METADATA.creditUrl,
        coverMediaAlt: "Uploaded video cover",
      });
      if (isVenue) await videoUpload.acknowledgeApplied();
      lastEmittedProcessedVideoUrlRef.current = readyUrl;
      setVideoPickNotice({ tone: "info", text: "Video cover added." });
    } catch {
      lastEmittedProcessedVideoUrlRef.current = null;
      setReadyPersistenceFailed(true);
      setVideoPickNotice({ tone: "error", text: "The video is ready, but the cover could not be saved. Retry saving it." });
    } finally {
      savingProcessedVideoUrlRef.current = null;
    }
  }, [
    emitChange,
    isVenue,
    videoUpload.acknowledgeApplied,
    videoUpload.processedPosterUrl,
    videoUpload.processedUrl,
  ]);

  // Venue owners must persist first and acknowledge second. Event/brand jobs
  // emit only after the server projects authoritative `applied` truth.
  useEffect(() => {
    const shouldPersist = isVenue
      ? videoUpload.status?.status === "ready" && !readyPersistenceFailed
      : videoUpload.stage.phase === "applied";
    if (shouldPersist) void persistReadyVideo();
  }, [isVenue, persistReadyVideo, readyPersistenceFailed, videoUpload.stage.phase, videoUpload.status?.status]);

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
    if (isBrand || isVenue) return true;
    if (eventRowId.trim().length === 0) {
      showUploadError(
        new EventCoverMediaError("missing_server_event_id", "Missing server row id."),
      );
      return false;
    }
    return true;
  }, [eventRowId, isBrand, isVenue, showUploadError]);

  // issue #868 — commit a gallery mutation: update state + ref, re-emit the
  // UNCHANGED cover fields plus the new gallery (the cover is never touched here).
  const commitGallery = useCallback(
    (next: OfferingGalleryImage[]): void => {
      setGallery(next);
      galleryRef.current = next;
      onCoverChange({ ...localCoverRef.current, coverGallery: next });
    },
    [onCoverChange],
  );

  // issue #868 M.3 — append ONE image/GIF item to the gallery (clamp at max). The
  // shared append path for BOTH the device "Add photo" and the provider (GIF/Photos)
  // tiles when the target is "gallery". Never touches the cover fields.
  const appendGalleryItem = useCallback(
    (item: OfferingGalleryImage): void => {
      if (galleryRef.current.length >= GALLERY_MAX) {
        onShowToast(`Up to ${GALLERY_MAX} extra photos.`);
        return;
      }
      commitGallery([...galleryRef.current, item]);
      lightHaptic();
      onShowToast("Photo added to gallery.");
    },
    [commitGallery, onShowToast],
  );

  // Add ONE image/GIF from the device library to the gallery (never a video).
  // Clamps at GALLERY_MAX. Independent of the primary cover — does NOT touch it.
  const addGalleryPhoto = useCallback(async (): Promise<void> => {
    if (uploading || disabled || activeVideoUpload) return;
    if (galleryRef.current.length >= GALLERY_MAX) {
      onShowToast(`Up to ${GALLERY_MAX} extra photos.`);
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
      const result = await launchCoverImagePicker();
      if (result.canceled || result.assets.length === 0) return;
      pickedAssets = result.assets;
      const asset = result.assets[0];
      // Route through the same storage upload as the cover (event_covers /
      // brand_covers bucket) so the gallery item is a durable public URL.
      let publicUrl: string;
      let mediaType: "image" | "gif";
      if (isBrand || isVenue) {
        const uploaded = await uploadBrandCover(
          target.brandId,
          {
            uri: asset.uri,
            mimeType: asset.mimeType,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
          },
          { previousPublicUrl: null },
        );
        publicUrl = uploaded.publicUrl;
        mediaType = uploaded.mediaType === "gif" ? "gif" : "image";
      } else {
        const uploaded = await uploadEventCoverMedia({
          uri: asset.uri,
          brandId: target.brandId,
          eventId: eventRowId,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          durationMs: null,
          pickerType: asset.type,
        });
        publicUrl = uploaded.publicUrl;
        mediaType = uploaded.mediaType === "gif" ? "gif" : "image";
      }
      let posterUrl = publicUrl;
      if (mediaType === "gif") {
        const extracted = await extractCoverGifPoster(asset);
        try {
          if (isBrand || isVenue) {
            const poster = await uploadBrandCover(target.brandId, extracted.asset, {
              previousPublicUrl: null,
            });
            posterUrl = poster.publicUrl;
          } else {
            const poster = await uploadEventCoverMedia({
              ...extracted.asset,
              brandId: target.brandId,
              eventId: eventRowId,
              durationMs: null,
              pickerType: "image",
            });
            posterUrl = poster.publicUrl;
          }
        } finally {
          await extracted.cleanup();
        }
      }
      const item: OfferingGalleryImage = {
        url: publicUrl,
        posterUrl,
        type: mediaType,
        alt: null,
        credit: null,
      };
      commitGallery([...galleryRef.current, item]);
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
      onShowToast("Photo added.");
    } catch (error) {
      showUploadError(error);
    } finally {
      revokeCoverPickedAssets(pickedAssets);
      setUploading(false);
    }
  }, [
    activeVideoUpload,
    commitGallery,
    disabled,
    ensureMediaPermission,
    isAuthReady,
    onShowToast,
    showUploadError,
    target,
    uploading,
    validateEventRowId,
  ]);

  const moveGalleryItem = useCallback(
    (index: number, direction: -1 | 1): void => {
      const next = [...galleryRef.current];
      const target2 = index + direction;
      if (target2 < 0 || target2 >= next.length) return;
      [next[index], next[target2]] = [next[target2], next[index]];
      commitGallery(next);
      tickHaptic();
    },
    [commitGallery],
  );

  const removeGalleryItem = useCallback(
    (index: number): void => {
      const next = galleryRef.current.filter((_, i) => i !== index);
      commitGallery(next);
      onShowToast("Photo removed.");
    },
    [commitGallery, onShowToast],
  );

  // Promote a gallery image/GIF to the PRIMARY cover. The prior cover, when it is
  // an image/GIF, is demoted into the gallery at the vacated slot; when it is a
  // VIDEO it is REPLACED (discarded) — but only via the explicit OQ-3 confirm.
  const applyMakeCover = useCallback(
    (index: number): void => {
      const item = galleryRef.current[index];
      if (item === undefined) return;
      const priorUrl = localCoverRef.current.coverMediaUrl;
      const priorType = localCoverRef.current.coverMediaType;
      const priorIsImageLike = priorUrl !== null && priorType !== "video";
      const nextGallery = [...galleryRef.current];
      if (priorIsImageLike) {
        // Demote the prior image/GIF cover into the vacated slot.
        nextGallery[index] = {
          url: priorUrl,
          type: priorType === "gif" ? "gif" : "image",
          alt: localCoverRef.current.coverMediaAlt,
          credit: localCoverRef.current.coverMediaCredit,
        };
      } else {
        // Prior cover was a video (or none) → discard it; remove the promoted item.
        nextGallery.splice(index, 1);
      }
      setGallery(nextGallery);
      galleryRef.current = nextGallery;
      const patch: CoverPatch = {
        coverMediaUrl: item.url,
        coverMediaPosterUrl: item.type === "gif" ? item.posterUrl ?? null : item.url,
        coverMediaType: item.type === "gif" ? "gif" : "image",
        coverMediaProvider: null,
        coverMediaSourceUrl: null,
        coverMediaCredit: item.credit ?? null,
        coverMediaCreditUrl: null,
        coverMediaAlt: item.alt ?? null,
        coverGallery: nextGallery,
      };
      setLocalCover(patch);
      localCoverRef.current = patch;
      onCoverChange(patch);
      onShowToast("Cover updated.");
    },
    [onCoverChange, onShowToast],
  );

  const requestMakeCover = useCallback(
    (index: number): void => {
      if (disabled) return;
      // OQ-3: replacing a VIDEO cover with a photo requires explicit confirm.
      if (localCoverRef.current.coverMediaType === "video") {
        setPendingMakeCoverIndex(index);
        return;
      }
      applyMakeCover(index);
    },
    [applyMakeCover, disabled],
  );

  const pickImageOrGifCover = useCallback(async (): Promise<void> => {
    if (uploading || disabled || activeVideoUpload) return;
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

    setUploading(true);
    // issue #1338 — an image/GIF pick clears any stale video-flow notice.
    setVideoPickNotice(null);
    let pickedAssets: Parameters<typeof revokeCoverPickedAssets>[0] = [];
    try {
      const result = await launchCoverImagePicker();
      if (result.canceled || result.assets.length === 0) return;
      pickedAssets = result.assets;
      const asset = result.assets[0];

      if (target.kind === "venue") {
        // META-ORCH-1255(C) D-C: venue device upload → brand_covers bucket
        // (brand-keyed storage path) but NO brands-row patch — the emitted
        // patch is persisted by the host to venue_listings via syncHeroMedia.
        const uploaded = await uploadBrandCover(
          target.brandId,
          {
            uri: asset.uri,
            mimeType: asset.mimeType,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
          },
          { previousPublicUrl: localCover.coverMediaUrl },
        );
        let posterUrl = uploaded.publicUrl;
        if (uploaded.mediaType === "gif") {
          const extracted = await extractCoverGifPoster(asset);
          try {
            const poster = await uploadBrandCover(target.brandId, extracted.asset, {
              previousPublicUrl: null,
            });
            posterUrl = poster.publicUrl;
          } finally {
            await extracted.cleanup();
          }
        }
        setMediaDisplayError(null);
        emitChange({
          coverMediaUrl: uploaded.publicUrl,
          coverMediaPosterUrl: posterUrl,
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

      if (target.kind === "brand") {
        // Brand device upload → brand_covers bucket + brands.cover_media_url.
        const isGif = asset.mimeType?.toLowerCase() === "image/gif"
          || /\.gif(?:$|[?#])/i.test(asset.fileName ?? asset.uri);
        const extracted = isGif ? await extractCoverGifPoster(asset) : null;
        const uploaded = await (async () => {
          try {
            return await brandCover.uploadCover({
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
                ...(extracted === null ? {} : { posterAsset: extracted.asset }),
              },
            });
          } finally {
            await extracted?.cleanup();
          }
        })();
        setMediaDisplayError(null);
        emitChange({
          coverMediaUrl: uploaded.publicUrl,
          coverMediaPosterUrl: uploaded.posterUrl,
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
        eventId: eventRowId,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        durationMs: null,
        pickerType: asset.type,
      });
      let posterUrl = upload.publicUrl;
      if (upload.mediaType === "gif") {
        const extracted = await extractCoverGifPoster(asset);
        try {
          const poster = await uploadEventCoverMedia({
            ...extracted.asset,
            brandId: target.brandId,
            eventId: eventRowId,
            durationMs: null,
            pickerType: "image",
          });
          posterUrl = poster.publicUrl;
        } finally {
          await extracted.cleanup();
        }
      }
      setMediaDisplayError(null);
      emitChange({
        coverMediaUrl: upload.publicUrl,
        coverMediaPosterUrl: posterUrl,
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

  const pickVideoCover = useCallback(async (replacing = false): Promise<void> => {
    const resumingDetachedWeb = Platform.OS === "web" && videoUpload.stage.phase === "detached";
    if (uploading || disabled || (lockedVideoOperation && !replacing && !resumingDetachedWeb)) return;
    // ORCH-1307: mobile web is no longer gated out of video covers. The web has
    // no trimmer (native-only react-native-video-trim), so a raw clip flows
    // straight to the duration guard below; clips within the ceiling upload
    // as-is on both desktop AND mobile web (Bunny TUS accepts browser uploads).
    if (!isAuthReady) {
      // issue #1338 — in-sheet notice, never a root Toast (iOS drops it here).
      setVideoPickNotice({
        tone: "info",
        text: "Finishing sign-in — try again in a moment.",
      });
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

    setUploading(true);
    // issue #1338 — clear any stale notice from a prior attempt.
    setVideoPickNotice(null);
    const previousPickedVideoAssets = pickedVideoAssetsRef.current;
    let selectedReplacementAssets: Parameters<typeof revokeCoverPickedAssets>[0] | null = null;
    try {
      const result = await launchCoverVideoPicker();
      if (result.canceled || result.assets.length === 0) return;
      // ORCH-1308: free the PREVIOUS pick's blob, then retain THIS one so the
      // "try again" retry (web fetch(blob:uri)) can re-read it. It is freed on
      // the next pick or on unmount (effect above), NOT in the finally below.
      // A replacement keeps the old browser blob alive until the server has
      // accepted the new immutable operation. A rejected replacement can then
      // resume the old upload instead of having its last readable bytes revoked.
      if (!replacing) revokeCoverPickedAssets(previousPickedVideoAssets);
      pickedVideoAssetsRef.current = result.assets;
      if (replacing) selectedReplacementAssets = result.assets;
      const asset = result.assets[0];
      // issue #1338 — trim ONLY when a native clip is over the source ceiling.
      // Within-ceiling native clips and ALL web clips upload RAW (mirrors the
      // ORCH-1307 web path), which keeps the flaky native trim modal out of the
      // common short-clip path entirely.
      const sourceDurationMs = normalizePickerDurationMs(asset.duration);
      const needsNativeTrim =
        isNative && sourceDurationMs > EVENT_COVER_SOURCE_CEILING_MS;

      let trimResult: VideoTrimFinishPayload | null = null;
      if (needsNativeTrim) {
        // issue #1338 — present the trim editor ONLY after the OS photo picker
        // has fully dismissed, so iOS New Arch never refuses a 2nd stacked modal.
        await waitForPickerDismissal();
        // The single-line trim call is pinned by the orch-0978 strict-grep C1
        // gate (exact substring match); prettier-ignore stops printWidth (80)
        // from re-wrapping it across lines and re-breaking the gate.
        // prettier-ignore
        trimResult = await trimVideoWithDedicatedEditor(asset.uri, EVENT_COVER_MAX_VIDEO_DURATION_MS);
        if (trimResult === null) {
          // Genuine user cancel (Back). NEVER silent (issue #1338).
          setVideoPickNotice({
            tone: "info",
            text: "No video added — trim to 15 seconds or pick a shorter clip.",
          });
          return;
        }
      }
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
              // ORCH-1303: on web `asset.uri` is a browser blob: object URL that
              // is fetch-able as-is; normalizeLocalFileUri would prefix `file://`
              // → `file://blob:…` and the web TUS upload's fetch(input.uri) would
              // reject. Native still normalizes its real file path.
              uri: resolveRawClipUploadUri(asset.uri, Platform.OS === "web"),
            };
      const { durationMs } = uploadFile;
      if (durationMs <= 0) {
        // issue #1338 — in-sheet, never a root Toast.
        setVideoPickNotice({
          tone: "error",
          text: "Could not read this video's duration. Try another clip.",
        });
        return;
      }
      if (durationMs > EVENT_COVER_SOURCE_CEILING_MS) {
        console.log("[ORCH-0978-TRIM]", {
          durationMs,
          capMs: EVENT_COVER_MAX_VIDEO_DURATION_MS,
          overshoot: durationMs - EVENT_COVER_MAX_VIDEO_DURATION_MS,
        });
        // ORCH-1307: on native the trimmer already capped the clip, so this is a
        // rare safety net ("trim to 29s"). On web there is NO trimmer — a raw
        // over-ceiling clip is a dead end, so give an actionable web message
        // instead of asking for a trim the browser can't do.
        // issue #1338 — in-sheet, never a root Toast; literals preserved verbatim.
        setVideoPickNotice({
          tone: "error",
          text: isNative
            ? "Trim it to 15 seconds or less, then choose it again."
            : "Choose a video that is 15 seconds or shorter.",
        });
        return;
      }
      if (uploadFile.bytes <= 0) {
        // issue #1338 — in-sheet, never a root Toast.
        setVideoPickNotice({
          tone: "error",
          text: "Could not read this video's size. Try another clip.",
        });
        return;
      }
      lastVideoUploadFileRef.current = uploadFile;
      if (replacing) {
        await videoUpload.replace(uploadFile);
        revokeCoverPickedAssets(previousPickedVideoAssets);
      } else await videoUpload.start(uploadFile);
    } catch (error) {
      if (replacing && selectedReplacementAssets !== null) {
        revokeCoverPickedAssets(selectedReplacementAssets);
        pickedVideoAssetsRef.current = previousPickedVideoAssets;
      }
      // issue #1338 — in-sheet, never a root Toast.
      // issue #1348 — friendly copy, never the raw system message.
      setVideoPickNotice({
        tone: "error",
        text: friendlyVideoCoverError(error),
      });
    } finally {
      // ORCH-1308: do NOT revoke the picked blob here — the "try again" retry
      // re-reads it (web fetch(blob:uri)). It is retained via
      // pickedVideoAssetsRef and freed on the next pick / on unmount instead.
      setUploading(false);
    }
  }, [
    disabled,
    ensureMediaPermission,
    isAuthReady,
    isNative,
    lockedVideoOperation,
    uploading,
    validateEventRowId,
    videoUpload,
  ]);

  const cancelVideoCoverUpload = useCallback((): void => {
    void videoUpload.cancel().catch(() => {
      onShowToast("Could not cancel video upload. Try again.");
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
      reportProviderError("gif", error);
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
      reportProviderError("stock", error);
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
        reportProviderError("gif", error);
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
        reportProviderError("stock", error);
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
      if (!result.posterUrl) {
        showUploadError(new BrandCoverError(
          "upload_failed",
          "Couldn't prepare this GIF for sharing. Try another GIF.",
        ));
        return;
      }
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
              posterUrl: result.posterUrl,
            },
          });
        } catch (error) {
          showUploadError(error);
          return;
        }
      } else if (target.kind === "venue") {
        // META-ORCH-1255(C) D-C: same anti-injection URL validation as the
        // brand path, ZERO brands-row write (host persists to the venue row).
        try {
          coverFromProviderRef({
            provider: "giphy",
            publicUrl: result.mediaUrl,
            attribution:
              result.creditUrl !== null
                ? { name: result.credit, url: result.creditUrl }
                : null,
          });
        } catch (error) {
          showUploadError(error);
          return;
        }
      }
      emitChange({
        coverMediaUrl: result.mediaUrl,
        coverMediaPosterUrl: result.posterUrl,
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
              posterUrl: result.mediaUrl,
            },
          });
        } catch (error) {
          showUploadError(error);
          return;
        }
      } else if (target.kind === "venue") {
        // META-ORCH-1255(C) D-C: validate only — never patch the brands row.
        try {
          coverFromProviderRef({
            provider: "pexels",
            publicUrl: result.mediaUrl,
            attribution: { name: result.credit, url: result.creditUrl },
          });
        } catch (error) {
          showUploadError(error);
          return;
        }
      }
      emitChange({
        coverMediaUrl: result.mediaUrl,
        coverMediaPosterUrl: result.mediaUrl,
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
    // issue #1338 — removing the cover clears any lingering video-flow notice.
    setVideoPickNotice(null);
    // Emit the null patch. For brand the parent (BrandEditView /
    // BrandCreationFlow) mirrors into its draft and persists the cleared
    // cover on Save (the brand save path already writes cover_media_url).
    // For event/trip the parent persists through its existing cover patch.
    emitChange({
      coverMediaUrl: null,
      coverMediaPosterUrl: null,
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
      // Local preview playback and upload are independent; a preview render
      // failure cannot declare the active upload failed.
      if (
        activeVideoUpload &&
        videoUpload.localPreviewUri !== null &&
        event.mediaUrl === videoUpload.localPreviewUri
      ) {
        return;
      }
      setMediaDisplayError(
        "Uploaded, but this cover could not be displayed. Try another image or GIF.",
      );
      onShowToast(
        "Uploaded, but this cover could not be displayed. Try another image or GIF.",
      );
    },
    [activeVideoUpload, onShowToast, videoUpload.localPreviewUri],
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

      {/* issue #868 M.3 — "Add to: Cover · Gallery" for the GIF/Photos tabs. Default
          Cover (byte-identical to today). Gallery appends the tapped provider item
          to the additional photos (never touches the cover fields). */}
      {(activeTab === "gif" || activeTab === "stock") ? (
        <View style={styles.addTargetRow} accessibilityRole="tablist">
          <Text style={styles.addTargetLabel}>Add to</Text>
          {(["cover", "gallery"] as const).map((target) => {
            const isActive = providerAddTarget === target;
            return (
              <Pressable
                key={target}
                onPress={() => {
                  tickHaptic();
                  setProviderAddTarget(target);
                }}
                disabled={disabled}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive, disabled }}
                accessibilityLabel={
                  target === "cover" ? "Add to cover" : "Add to gallery"
                }
                style={[
                  styles.addTargetChip,
                  isActive && styles.addTargetChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.addTargetChipLabel,
                    isActive && styles.addTargetChipLabelActive,
                  ]}
                >
                  {target === "cover" ? "Cover" : "Gallery"}
                </Text>
              </Pressable>
            );
          })}
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
          activeVideoUpload={lockedVideoOperation}
          videoStage={projectedVideoStage}
          videoStatus={videoUpload.status}
          videoErrorMessage={
            videoUpload.stage.phase === "error" ? videoUpload.stage.message : null
          }
          canRetryVideo={lastVideoUploadFileRef.current !== null}
          disabled={disabled}
          onPickImage={pickImageOrGifCover}
          onPickVideo={() => {
            void pickVideoCover();
          }}
          onRemove={handleRemoveCover}
          onCancelVideo={cancelVideoCoverUpload}
          onReplaceVideo={() => { void pickVideoCover(true); }}
          onRetryVideo={retryVideoCoverUpload}
          onResumeVideo={() => { if (Platform.OS === "web") void pickVideoCover(); else void videoUpload.resume(); }}
          onCheckVideo={() => { void videoUpload.checkNow(); }}
          onRetryReadyVideo={() => { void persistReadyVideo(); }}
          onMediaError={handleMediaRenderError}
          mediaDisplayError={mediaDisplayError}
          videoPickNotice={videoPickNotice}
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
            // issue #868 M.3 — Gallery mode appends; Cover mode = today's behavior.
            if (providerAddTarget === "gallery") {
              appendGalleryItem({
                url: r.mediaUrl,
                posterUrl: r.posterUrl ?? null,
                type: "gif",
                alt: r.alt,
                credit: r.credit,
              });
            } else {
              void selectGiphy(r);
            }
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
            // issue #868 M.3 — Gallery mode appends; Cover mode = today's behavior.
            if (providerAddTarget === "gallery") {
              appendGalleryItem({
                url: r.mediaUrl,
                posterUrl: r.mediaUrl,
                type: "image",
                alt: r.alt,
                credit: r.credit,
              });
            } else {
              void selectPexels(r);
            }
          }}
          onRetry={() => {
            if (query.trim().length >= 2) void runProviderSearch();
            else void loadCurated();
          }}
          onUseLibrary={() => switchTab("library")}
          searchActive={query.trim().length >= 2}
        />
      ) : null}

      {/* issue #868 [cover-gallery] — SEPARATE "Additional photos" manager. Writes
          ONLY the coverGallery (never the primary cover, except the explicit
          "Make cover" action). Images + GIFs; never video. */}
      <AdditionalPhotosSection
        gallery={gallery}
        max={GALLERY_MAX}
        disabled={disabled || uploading || activeVideoUpload}
        pendingMakeCoverIndex={pendingMakeCoverIndex}
        onAdd={() => {
          void addGalleryPhoto();
        }}
        onMakeCover={requestMakeCover}
        onMoveEarlier={(i) => moveGalleryItem(i, -1)}
        onMoveLater={(i) => moveGalleryItem(i, 1)}
        onRemove={removeGalleryItem}
        onConfirmMakeCover={() => {
          const idx = pendingMakeCoverIndex;
          setPendingMakeCoverIndex(null);
          if (idx !== null) applyMakeCover(idx);
        }}
        onCancelMakeCover={() => setPendingMakeCoverIndex(null)}
      />
    </View>
  );
};

// ----- Library tab (preview + action row + video affordance) -------------

// issue #3040 — mirrors `autoApplyEventCover` in
// `supabase/functions/event-cover-video-webhook/index.ts`. If this predicate
// and that gate ever disagree, the sheet starts lying again.
const coverVideoFinishesWithoutYou = (
  status: EventCoverVideoStatus | null,
): boolean =>
  status !== null && status.targetKind === "event" &&
  status.applyMode === "draft_auto";

const videoProjectionCopy = (
  stage: EventCoverVideoUploadStage,
  status: EventCoverVideoStatus | null,
): { title: string; body: string; percent: number | null; tone: "neutral" | "warning" | "error" | "success" } => {
  switch (stage.phase) {
    case "preparing": return { title: "Preparing video…", body: "Making a secure copy so the upload can resume if you leave.", percent: null, tone: "neutral" };
    case "validating": return { title: "Checking video…", body: "Confirming the format, length, and file size.", percent: null, tone: "neutral" };
    case "compressing": return { title: stage.percent === null ? "Optimizing video…" : "Optimizing video", body: "Preparing a browser-safe upload.", percent: stage.percent, tone: "neutral" };
    case "intent_pending": return { title: "Starting upload…", body: "Creating a secure, resumable upload.", percent: null, tone: "neutral" };
    case "uploading": return { title: "Uploading video", body: "You can close this sheet. Mingla will continue or resume when you return.", percent: stage.percent, tone: "neutral" };
    case "ack_pending": return { title: "Finishing upload…", body: "The video is uploaded. Confirming it arrived safely.", percent: null, tone: "neutral" };
    // issue #3040 invariants 4 + 5 — the sheet must not promise something it
    // does not do. "We'll finish automatically" is true for exactly ONE
    // configuration: an EVENT target in `draft_auto`, which the Bunny webhook
    // auto-applies server-side (`autoApplyEventCover`, gated on
    // `target_kind === "event" && apply_mode === "draft_auto"`). Every other
    // target — a published event, a brand, a venue — applies through the
    // CLIENT on the next visit, so closing the sheet is safe but NOT
    // self-completing, and the copy now says which one you are in.
    case "processing": return status?.status === "source_uploaded" || status?.status === "processing_queued"
      ? { title: "Video uploaded", body: coverVideoFinishesWithoutYou(status) ? "Waiting for processing to begin. You can close this sheet—we’ll finish automatically." : "Waiting for processing to begin. You can close this sheet and we’ll pick this up when you come back.", percent: null, tone: "neutral" }
      : { title: stage.percent === null ? "Processing video…" : "Processing video", body: coverVideoFinishesWithoutYou(status) ? (stage.percent === null ? "This can take a while. You can close this sheet—we’ll finish automatically." : "You can close this sheet—we’ll finish automatically.") : (stage.percent === null ? "This can take a while. You can close this sheet—we’ll apply it when you come back." : "You can close this sheet—we’ll apply it when you come back."), percent: stage.percent, tone: "neutral" };
    case "reattaching": return { title: "Reconnecting to your video…", body: "Checking the latest progress without starting over.", percent: null, tone: "neutral" };
    case "detached": return stage.sourceAcknowledged
      ? { title: "Still working in the background", body: "We can’t refresh the status right now. Your video is safe, and Mingla will check again when you’re connected.", percent: null, tone: "warning" }
      : { title: "Upload paused — you’re offline", body: "Reconnect to continue this video from where it stopped.", percent: null, tone: "warning" };
    case "ready": return { title: "Video ready", body: "The video is ready, but the cover could not be saved. Retry saving it.", percent: null, tone: "warning" };
    case "applying": return { title: "Applying cover…", body: "The video is ready. Saving it to the right cover now.", percent: null, tone: "neutral" };
    case "applied": return { title: "Video cover added", body: "Your new cover is ready.", percent: null, tone: "success" };
    case "error": return { title: "We couldn’t finish this video", body: stage.message, percent: null, tone: "error" };
    case "picking": return { title: "Preparing video…", body: "Making a secure copy so the upload can resume if you leave.", percent: null, tone: "neutral" };
    case "idle": return { title: "", body: "", percent: null, tone: "neutral" };
  }
};

const VideoStatusCard: React.FC<{
  stage: EventCoverVideoUploadStage;
  status: EventCoverVideoStatus | null;
  hasExistingCover: boolean;
  onCancel: () => void;
  onReplace: () => void;
  onRetry: () => void;
  onRetryReady: () => void;
  onResume: () => void;
  onCheck: () => void;
}> = ({ stage, status, hasExistingCover, onCancel, onReplace, onRetry, onRetryReady, onResume, onCheck }) => {
  const [confirming, setConfirming] = useState<"cancel" | "replace" | null>(null);
  const copy = videoProjectionCopy(stage, status);
  const active = !["idle", "applied", "error"].includes(stage.phase);
  if (confirming !== null) {
    const replacing = confirming === "replace";
    return (
      <View style={styles.videoStatusCard} accessibilityLiveRegion="polite">
        <Text style={styles.videoStatusTitle}>{replacing ? "Replace this video?" : "Cancel this video?"}</Text>
        <Text style={styles.videoStatusBody}>{replacing ? "Your current upload keeps going unless a new video is accepted." : hasExistingCover ? "We’ll stop this job and keep your current cover." : "We’ll stop this job. No cover will be added."}</Text>
        <View style={styles.videoStatusActions}>
          <Button label="Keep current" accessibilityLabel="Keep current video upload" variant="secondary" size="md" onPress={() => setConfirming(null)} />
          <Button label={replacing ? "Choose replacement" : "Cancel video"} accessibilityLabel={replacing ? "Choose replacement video" : "Cancel video upload"} variant={replacing ? "primary" : "destructive"} size="md" onPress={replacing ? onReplace : onCancel} />
        </View>
      </View>
    );
  }
  const color = copy.tone === "warning" ? semantic.warning : copy.tone === "error" ? semantic.error : copy.tone === "success" ? semantic.success : textTokens.primary;
  const isIndeterminate = copy.percent === null && [
    "picking",
    "preparing",
    "validating",
    "compressing",
    "intent_pending",
    "ack_pending",
    "processing",
    "reattaching",
    "applying",
  ].includes(stage.phase);
  return (
    <View style={[styles.videoStatusCard, Platform.OS === "android" && styles.videoStatusCardAndroid]} accessible accessibilityLiveRegion="polite" accessibilityRole={copy.tone === "error" ? "alert" : undefined}>
      <View style={styles.videoStatusHeader}>
        {copy.tone === "success" ? <Icon name="check" size={20} color={color} /> : null}
        {copy.tone === "warning" ? <Icon name="shield" size={20} color={color} /> : null}
        {copy.tone === "error" ? <Icon name="x" size={20} color={color} /> : null}
        {isIndeterminate ? <ActivityIndicator color={color} accessibilityLabel={copy.title} /> : null}
        <Text style={[styles.videoStatusTitle, { color }]}>{copy.title}</Text>
        {copy.percent !== null ? <Text style={styles.videoStatusPercent}>{Math.round(copy.percent)}%</Text> : null}
      </View>
      <Text style={styles.videoStatusBody}>{copy.body}</Text>
      {copy.percent !== null ? (
        <View accessibilityRole="progressbar" accessibilityLabel={stage.phase === "processing" ? "Video processing progress" : "Video upload progress"} accessibilityValue={{ min: 0, now: Math.round(copy.percent), max: 100, text: `${Math.round(copy.percent)} percent` }} style={styles.progressTrack}>
          <View style={[styles.progressFill, { transform: [{ scaleX: copy.percent / 100 }] }]} />
        </View>
      ) : null}
      <View style={styles.videoStatusActions}>
        {stage.phase === "detached" ? <Button label={stage.sourceAcknowledged ? "Check now" : "Resume upload"} accessibilityLabel={stage.sourceAcknowledged ? "Check video status now" : "Resume video upload"} variant="secondary" size="md" onPress={stage.sourceAcknowledged ? onCheck : onResume} /> : null}
        {stage.phase === "ready" ? <Button label="Retry saving" accessibilityLabel="Retry saving ready video cover" variant="secondary" size="md" onPress={onRetryReady} /> : null}
        {stage.phase === "error" ? <Button label="Try again" variant="secondary" size="md" onPress={onRetry} /> : null}
        {/* issue #2974 — the error copy used to tell people to "cancel it first"
            while `active` excludes the error phase, so NEITHER the Cancel nor the
            Replace button rendered and there was no reachable cancel control
            anywhere in the sheet. This is that control: it drops the local upload
            record (and cancels the server job when one exists) so the next pick
            starts clean. */}
        {stage.phase === "error" ? <Button label="Discard upload" accessibilityLabel="Discard this video upload and start over" variant="ghost" size="md" onPress={onCancel} /> : null}
        {active && stage.phase !== "reattaching" && stage.phase !== "applying" ? <Button label="Replace" accessibilityLabel="Replace video upload" variant="secondary" size="md" onPress={() => setConfirming("replace")} /> : null}
        {active && stage.phase !== "reattaching" && stage.phase !== "ready" && stage.phase !== "applying" ? <Button label="Cancel" accessibilityLabel="Cancel video upload" variant="ghost" size="md" onPress={() => setConfirming("cancel")} /> : null}
      </View>
    </View>
  );
};

const LibraryTab: React.FC<{
  hasCover: boolean;
  hue: number;
  activeMediaUrl: string | null;
  activeMediaType: EventCoverMediaType | null;
  alt: string | null;
  credit: string | null;
  uploading: boolean;
  activeVideoUpload: boolean;
  videoStage: EventCoverVideoUploadStage;
  videoStatus: EventCoverVideoStatus | null;
  videoErrorMessage: string | null;
  canRetryVideo: boolean;
  disabled: boolean;
  onPickImage: () => void;
  onPickVideo: () => void;
  onRemove: () => void;
  onCancelVideo: () => void;
  onReplaceVideo: () => void;
  onRetryVideo: () => void;
  onRetryReadyVideo: () => void;
  onResumeVideo: () => void;
  onCheckVideo: () => void;
  onMediaError: (e: EventCoverMediaErrorEvent) => void;
  mediaDisplayError: string | null;
  // issue #1338 — in-sheet feedback for the cover-VIDEO flow (never a root Toast).
  videoPickNotice: { tone: "info" | "error"; text: string } | null;
}> = ({
  hasCover,
  hue,
  activeMediaUrl,
  activeMediaType,
  alt,
  credit,
  uploading,
  activeVideoUpload,
  videoStage,
  videoStatus,
  videoErrorMessage,
  canRetryVideo,
  disabled,
  onPickImage,
  onPickVideo,
  onRemove,
  onCancelVideo,
  onReplaceVideo,
  onRetryVideo,
  onRetryReadyVideo,
  onResumeVideo,
  onCheckVideo,
  onMediaError,
  mediaDisplayError,
  videoPickNotice,
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

    {videoStage.phase !== "idle" ? (
      <VideoStatusCard
        stage={videoStage}
        status={videoStatus}
        hasExistingCover={hasCover}
        onCancel={onCancelVideo}
        onReplace={onReplaceVideo}
        onRetry={onRetryVideo}
        onRetryReady={onRetryReadyVideo}
        onResume={onResumeVideo}
        onCheck={onCheckVideo}
      />
    ) : null}

    {activeVideoUpload ? null : (
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
            disabled={uploading || disabled}
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

        {/* issue #1338 — in-sheet cover-VIDEO feedback (cancel/over-cap/failure/
            added). Renders INSIDE CoverPickerSheet's Sheet — a plain View/Text,
            NOT a native <Modal>, so iOS never drops it while the sheet is up. */}
        {videoPickNotice !== null ? (
          <View style={styles.videoNoticeRow}>
            <Text
              accessibilityRole="alert"
              style={
                videoPickNotice.tone === "error"
                  ? styles.mediaErrorText
                  : styles.videoNoticeInfoText
              }
            >
              {videoPickNotice.text}
            </Text>
          </View>
        ) : null}

        <Text style={styles.uploadLimitText}>{EVENT_COVER_UPLOAD_LIMIT_COPY}</Text>
        {Platform.OS === "web" ? (
          <Text style={styles.helperText}>
            On the web, video covers upload the clip as-is into Mingla&apos;s
            deterministic preparation step.
          </Text>
        ) : null}
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

// ----- issue #868 [cover-gallery] — Additional-photos manager --------------

const AdditionalPhotosSection: React.FC<{
  gallery: OfferingGalleryImage[];
  max: number;
  disabled: boolean;
  pendingMakeCoverIndex: number | null;
  onAdd: () => void;
  onMakeCover: (index: number) => void;
  onMoveEarlier: (index: number) => void;
  onMoveLater: (index: number) => void;
  onRemove: (index: number) => void;
  onConfirmMakeCover: () => void;
  onCancelMakeCover: () => void;
}> = ({
  gallery,
  max,
  disabled,
  pendingMakeCoverIndex,
  onAdd,
  onMakeCover,
  onMoveEarlier,
  onMoveLater,
  onRemove,
  onConfirmMakeCover,
  onCancelMakeCover,
}) => {
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const atCap = gallery.length >= max;

  return (
    <View style={styles.gallerySection} testID="cover-additional-photos">
      <Text style={styles.galleryHeader}>Additional photos</Text>
      <Text style={styles.gallerySub}>
        Shown after your cover — swipe to flip through them. Up to {max}.
      </Text>

      {pendingMakeCoverIndex !== null ? (
        <View
          style={styles.confirmBanner}
          accessibilityRole="alert"
          testID="cover-make-cover-confirm"
        >
          <Text style={styles.confirmBannerText}>
            Replace your video cover with this photo?
          </Text>
          <View style={styles.confirmBannerActions}>
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              shape="square"
              onPress={onCancelMakeCover}
            />
            <Button
              label="Replace"
              variant="primary"
              size="sm"
              shape="square"
              onPress={onConfirmMakeCover}
              testID="cover-make-cover-confirm-replace"
            />
          </View>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.galleryStrip}
      >
        {gallery.map((item, index) => {
          const menuOpen = openMenuIndex === index;
          return (
            <View key={`gal-${index}-${item.url}`} style={styles.galleryTileWrap}>
              <Image
                source={{ uri: item.url }}
                style={styles.galleryTile}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                accessibilityLabel={`Extra photo ${index + 1} of ${gallery.length}`}
              />
              <Pressable
                onPress={() => setOpenMenuIndex(menuOpen ? null : index)}
                disabled={disabled}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Options for extra photo ${index + 1}`}
                accessibilityState={{ expanded: menuOpen, disabled }}
                style={styles.galleryTileMenuButton}
              >
                <Icon name="moreH" size={16} color={textTokens.inverse} />
              </Pressable>
              {menuOpen ? (
                <View style={styles.galleryMenu} accessibilityRole="menu">
                  <GalleryMenuItem
                    label="Make cover"
                    disabled={disabled}
                    onPress={() => {
                      setOpenMenuIndex(null);
                      onMakeCover(index);
                    }}
                  />
                  <GalleryMenuItem
                    label="Move earlier"
                    disabled={disabled || index === 0}
                    onPress={() => {
                      setOpenMenuIndex(null);
                      onMoveEarlier(index);
                    }}
                  />
                  <GalleryMenuItem
                    label="Move later"
                    disabled={disabled || index === gallery.length - 1}
                    onPress={() => {
                      setOpenMenuIndex(null);
                      onMoveLater(index);
                    }}
                  />
                  <GalleryMenuItem
                    label="Remove"
                    disabled={disabled}
                    destructive
                    onPress={() => {
                      setOpenMenuIndex(null);
                      onRemove(index);
                    }}
                  />
                </View>
              ) : null}
            </View>
          );
        })}

        {!atCap ? (
          <Pressable
            onPress={onAdd}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            accessibilityState={{ disabled }}
            testID="cover-add-photo"
            style={({ pressed }) => [
              styles.galleryAddTile,
              pressed && styles.tilePressed,
            ]}
          >
            <Icon name="plus" size={22} color={accent.warm} />
            <Text style={styles.galleryAddLabel}>Add photo</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
};

const GalleryMenuItem: React.FC<{
  label: string;
  disabled: boolean;
  destructive?: boolean;
  onPress: () => void;
}> = ({ label, disabled, destructive = false, onPress }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="menuitem"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [
      styles.galleryMenuItem,
      pressed && !disabled && styles.galleryMenuItemPressed,
    ]}
  >
    <Text
      style={[
        styles.galleryMenuItemLabel,
        destructive && { color: semantic.error },
        disabled && styles.galleryMenuItemDisabled,
      ]}
    >
      {label}
    </Text>
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
  // issue #1338 — in-sheet cover-video notice (info tone). Errors reuse
  // styles.mediaErrorText (semantic.error); info uses the warm accent.
  videoNoticeRow: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  videoNoticeInfoText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    marginTop: spacing.xs,
    fontWeight: "600",
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
  videoStatusCard: {
    minHeight: 88,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    overflow: "hidden",
  },
  videoStatusCardAndroid: {
    backgroundColor: ariThread.ariBubbleAndroid,
    borderColor: androidOpaque.rowBorder,
    elevation: 0,
  },
  videoStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  videoStatusTitle: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: typography.bodyLg.fontWeight,
    color: textTokens.primary,
  },
  videoStatusBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  videoStatusPercent: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  videoStatusActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.24)",
  },
  progressFill: {
    width: "100%",
    height: "100%",
    transformOrigin: "left",
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
  // issue #868 [cover-gallery] M.3 — provider "Add to: Cover · Gallery" control.
  addTargetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  addTargetLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginRight: spacing.xs,
  },
  addTargetChip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  addTargetChipActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  addTargetChipLabel: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  addTargetChipLabelActive: {
    color: accent.warm,
  },
  // issue #868 [cover-gallery] — Additional-photos manager.
  gallerySection: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    paddingTop: spacing.md,
  },
  galleryHeader: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  gallerySub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  confirmBanner: {
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  confirmBannerText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  confirmBannerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  galleryStrip: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: 2,
    alignItems: "flex-start",
  },
  galleryTileWrap: {
    width: 96,
  },
  galleryTile: {
    width: 96,
    height: 72,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileElevated,
  },
  galleryTileMenuButton: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  galleryMenu: {
    marginTop: spacing.xs,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileElevated,
    overflow: "hidden",
  },
  galleryMenuItem: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  galleryMenuItemPressed: {
    backgroundColor: accent.tint,
  },
  galleryMenuItemLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
  },
  galleryMenuItemDisabled: {
    color: textTokens.tertiary,
    opacity: 0.5,
  },
  galleryAddTile: {
    width: 96,
    height: 72,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: accent.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: accent.tint,
  },
  galleryAddLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
});
