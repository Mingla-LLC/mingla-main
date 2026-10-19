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
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Image,
  InteractionManager,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
// #3040 B-C13b — platform split: native measures the trimmed output.
import { measureTrimmedVideoDurationMs } from "./coverPickerVideoMeasure";
import { VIDEO_LIMITS } from "@mingla/video-upload";
import { useElapsedSince } from "./coverPickerElapsed";
import {
  trimVideoWithDedicatedEditor,
  waitForTrimEditorToClose,
} from "./coverPickerVideoTrimEditor";
// issue #3485 — the video pick's busy rule, and the sentence it shows when it
// refuses; plus the rule for when a stuck card should ask the server again. Pure
// modules beside this one because CoverPicker.tsx cannot be mounted under jest
// (expo-video / expo-image-picker / react-native-video-trim).
import { videoPickRefusal } from "./coverPickerVideoPickGate";
import { shouldRecheckCoverVideo } from "./coverPickerVideoRecheck";

import {
  accent,
  androidOpaque,
  ariThread,
  bpRegular,
  canvas,
  coverUpload,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  uploadEventCoverMedia,
} from "../../services/eventCoverMediaService";
import {
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  EVENT_COVER_SOURCE_CEILING_MS,
  EVENT_COVER_SOURCE_MAX_BYTES,
  isBrowserOffline,
  type EventCoverVideoStatus,
  type EventCoverVideoUploadStage,
} from "../../services/eventCoverVideoProcessingService";
import { hostAppStoreUrl } from "../../services/eventCoverVideoEdgeContract";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import {
  coverLimitsLines,
  coverStatusRowModel,
  pickRefusalCardModel,
  resolveRenderErrorCopy,
  RELOAD_PREVIEW_MAX_MS,
  STEP_LABEL,
  videoUploadCardModel,
  type CardActionId,
  type CoverKind,
  type PickRefusal,
  type StatusRowModel,
  type UploadCardModel,
  type UploadStep,
} from "./coverUploadCardModel";
import { coverKindOf, resolveCoverActions } from "./coverPickerActionLabels";
import {
  AnimatedProgressFill,
  CardPresence,
  FadeOnChange,
  MOTION_SPEC,
  NudgeOnSignal,
  PopOnSignal,
  StepperSegmentFill,
  animateInlineConfirmSwap,
  announceBucket,
  prefersStackedActions,
  progressValueText,
  uploadAnnouncement,
  useFocusOnAlertEntry,
  useIosAnnouncement,
  useReduceMotion,
} from "./coverUploadMotion";
import { resolveActiveMedia, type ActiveMedia } from "./coverPickerActiveMedia";
import { retryVideoPlan, RETRY_PICK_NOTICE } from "./coverPickerRetryRule";
import { reportCoverPreviewRenderError } from "./coverPickerPreviewTelemetry";
import {
  useEventCoverVideoUpload,
  type EventCoverVideoUploadFile,
} from "../../hooks/useEventCoverVideoUpload";
import {
  buildTrimmedVideoUploadFile,
  normalizePickerDurationMs,
  resolveRawClipUploadUri,
  TrimOverCapError,
  type VideoTrimFinishPayload,
} from "./coverPickerVideoTrimUpload";
import { resolveRawCoverClipDurationMs } from "../../utils/eventCoverMediaRules";
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
import { BRAND_COVER_MAX_BYTES, BrandCoverError } from "../../utils/brandCoverRules";
import { Button } from "./Button";
import {
  canAddGalleryPhoto,
  canMakeGalleryPhotoCover,
  galleryAddBlockedReason,
  galleryMakeCoverBlockedReason,
  type GalleryMakeCoverState,
} from "./coverPickerGalleryGate";
// issue #3318 — the photo add pipeline (tiles, Retry, photo copy, the two emit
// paths) and its failure reporting, split out so they run under jest.
import {
  commitGalleryWithCover,
  createGalleryAddController,
  emitCoverWithGallery,
  type CoverEmitRefs,
  type GalleryAddController,
  type GalleryAddControllerDeps,
  type GalleryPhotoTile,
} from "./coverPickerGalleryAdd";
import { reportGalleryAddFailure } from "./coverPickerGalleryTelemetry";
// issue #3280 — after the native trim editor, continue in a FRESH sheet.
import {
  canContinueAfterNativeEditor,
  nextNativeEditorCarryId,
  returnsThroughFreshSheet,
  type NativeEditorCarry,
  type NativeEditorNotice,
} from "./coverPickerNativeEditorReturn";
import { createStorageUploadWithRetry } from "../../services/storageUploadWithRetry";
import { findSelectedProviderId } from "./coverPickerSelection";
import { Icon } from "./Icon";
import { EventCoverMedia, type EventCoverMediaErrorEvent } from "./EventCoverMedia";
import { useAuth } from "../../context/AuthContext";
import type { CoverTarget } from "./coverTarget";
// issue #868 [cover-gallery] — the ADDITIONAL image/GIF gallery item type
// (shared package is the single owner of the offering-render prop contract).
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

export type { CoverTarget } from "./coverTarget";

// issue #3318 — Additional photos' storage runner: a size-scaled deadline per
// attempt and one retry on a network failure. Imported HERE (CoverPicker is its
// own lazy web chunk), never by the upload services, which sit in the boot chunk.
const galleryStorageUpload = createStorageUploadWithRetry();

type CoverPickerAsset = Parameters<typeof revokeCoverPickedAssets>[0][number];
// #3040 AD-06 — the ad-video pick minimum (the `ad_creative` target only).
const AD_MIN_DURATION_MS = VIDEO_LIMITS.AD_MIN_DURATION_MS;

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
  /**
   * #3040 B-C14 — set only by the `ad_creative` target: the ad creative row
   * the server created from the READY job (E-6c). Host Ads / Ari link THIS id;
   * they never record a creative from a URL the browser hands them.
   */
  adCreativeId?: string | null;
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
  /**
   * issue #3319 — show "Additional photos" and the GIF/Photos "Add to: Gallery"
   * option. ONLY for hosts that save `coverGallery` from the emitted patch.
   * Default false: a host that ignores the gallery must never offer one, or
   * the photos an organiser adds there upload and are silently never saved.
   */
  galleryEnabled?: boolean;
  /**
   * #3655 — when the host stages the cover pointer until an explicit Save,
   * skip deleting the previously-persisted storage object on upload. The host
   * removes that object only after the pointer commit succeeds (or cleans up
   * abandoned staged uploads on discard/replace).
   */
  deferPreviousCleanup?: boolean;
  /**
   * issue #3280 — the sheet can close and come back as a fresh sheet. When set
   * (iOS), a picker that has shown the native trim editor hands its outcome
   * here instead of carrying on inside the native window the editor was stacked
   * on. See `coverPickerNativeEditorReturn.ts`.
   */
  onNativeEditorClosed?: (carry: NativeEditorCarry) => void;
  /** issue #3280 — the hand-off a fresh sheet continues from (once per id). */
  resumeAfterNativeEditor?: NativeEditorCarry | null;
  /** issue #3280 — tells the sheet this picker has taken the hand-off. */
  onResumeAfterNativeEditorConsumed?: (carryId: number) => void;
  /** Restrict the picker to device video (used by Ari Host Ads). */
  mediaMode?: "all" | "video-only";
  /**
   * #3040 — the sheet's footer: true while the card needs one decision (H-12,
   * H-19, AD-05), so the footer offers a plain "Close" instead of a confirm.
   */
  onNeedsActionChange?: (needsAction: boolean) => void;
  /** #3040 AD-04 — "Fits Meta and TikTok. Snapchat needs 1080×1920." */
  adFitSummary?: string | null;
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
  galleryEnabled = false,
  deferPreviousCleanup = false,
  onNativeEditorClosed,
  resumeAfterNativeEditor = null,
  onResumeAfterNativeEditorConsumed,
  mediaMode = "all",
  onNeedsActionChange,
  adFitSummary = null,
}) => {
  const { isAuthReady } = useAuth();
  const isBrand = target.kind === "brand";
  // #3040 B-C14 — Host Ads / Ari ad video on the `ad_creative` lane target.
  const isAdCreative = target.kind === "ad_creative";
  // META-ORCH-1255(C) D-C: venue-listing hero target — brand-like storage +
  // video pipeline, ZERO brands-row writes (host persists the emitted patch).
  const isVenue = target.kind === "venue" || target.kind === "venue_draft";
  const eventRowId = target.kind === "event" || target.kind === "trip" || target.kind === "experience"
    ? target.eventRowId
    : "";
  const isNative = Platform.OS !== "web";

  const [activeTab, setActiveTab] = useState<CoverTabId>("library");
  const [uploading, setUploading] = useState(false);
  // Issue #3073 — WHICH cover button is busy. `uploading` is shared by the
  // image and video flows (it is what disables every cover button), so on its
  // own it cannot say where the spinner goes: a video pick used to spin the
  // Image button while the iOS picker copied the clip and the upload started.
  const [coverUploadKind, setCoverUploadKind] = useState<"image" | "video">("image");
  // issue #3280 — the Additional photos gallery's OWN in-flight flag, set and
  // cleared ONLY by `addGalleryPhoto`. It cannot share `uploading`: the cover
  // VIDEO flow holds `uploading` true for its whole processing window
  // (`pickVideoCover` awaits `videoUpload.start`, which awaits the watch), so
  // a gallery gated on `uploading` stays blocked in exactly the session that
  // picked the video. Cover-path actions treat BOTH flags as busy.
  const [galleryUploading, setGalleryUploading] = useState(false);
  // issue #3318 — photos under Additional photos that are uploading or have
  // failed. Owned by `galleryAdd` (below) and mirrored here for rendering; they
  // are NOT part of `gallery`, so a host re-seeding the gallery cannot wipe a
  // photo that has not saved yet.
  const [galleryTiles, setGalleryTiles] = useState<readonly GalleryPhotoTile[]>([]);
  const [, setMediaDisplayError] = useState<string | null>(null);
  // #3040 H-16 — player failures on the saved cover, and the reload state.
  const [renderFailures, setRenderFailures] = useState(0);
  const [reloadingPreview, setReloadingPreview] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (reloadTimerRef.current !== null) clearTimeout(reloadTimerRef.current);
  }, []);
  // issue #1338 — in-sheet feedback channel for the cover-VIDEO flow. Rendered
  // INSIDE LibraryTab (never a root-portal Toast, which iOS drops while the
  // CoverPickerSheet modal is up). tone drives info (warm) vs error (semantic).
  const [videoPickNotice, setVideoPickNoticeState] = useState<NativeEditorNotice | null>(null);
  // #3040 §10 H-10 — a "Resume upload" tap while still offline nudges the card.
  const [offlineNudge, setOfflineNudge] = useState(0);
  // issue #3280 — the notice as of NOW, so a hand-off to a fresh sheet carries
  // the message this sheet was about to show (state lags a render behind).
  const videoPickNoticeRef = useRef<NativeEditorNotice | null>(null);
  const setVideoPickNotice = useCallback((next: NativeEditorNotice | null): void => {
    videoPickNoticeRef.current = next;
    setVideoPickNoticeState(next);
  }, []);
  // issue #3280 — identifies THIS mount on a hand-off, so it never continues
  // from its own carry (a fresh native window must).
  const nativeEditorInstanceRef = useRef<object>({});

  // Video upload hook — event/trip writes events.cover_media_url; brand writes
  // brands.cover_media_url (via the apply step on ready). For brand, eventRowId
  // is unused server-side (sentinel passed for the hook's signature).
  // #3040 B-C9 / T4 — the device's own word on connectivity (NetInfo on
  // native, the browser's flag on web). Null means unknown → assume online.
  const network = useNetInfoSafe();
  const networkConnectedRef = useRef<boolean | null>(network?.isConnected ?? null);
  networkConnectedRef.current = network?.isConnected ?? null;
  const isDeviceOffline = useCallback(
    (): boolean => networkConnectedRef.current === false || isBrowserOffline(),
    [],
  );
  const videoUpload = useEventCoverVideoUpload(
    eventRowId,
    target.brandId,
    target.kind === "event" || target.kind === "trip" || target.kind === "experience"
      ? target.coverMediaApplyMode
      : "published_manual",
    // META-ORCH-1059 Sub-B: experiences ride the event-cover video pipeline
    // (same events.cover_media_* columns + events-row id). Pass "experience"
    // for call-site clarity; the hook normalizes it to the "event" server path.
    // META-ORCH-1255(C) D-C: "venue" rides the brand server pipeline for
    // processing but SKIPS the apply step (which writes brands.cover_media_url)
    // — the processed URL flows out via the ready-emit and the host persists
    // it to the venue row.
    isBrand
      ? "brand"
      : target.kind === "venue" || target.kind === "venue_draft" || target.kind === "ad_creative"
        ? target.kind
        : target.kind === "experience"
          ? "experience"
          : "event",
    target.kind === "venue"
      ? { venueId: target.venueId }
      : target.kind === "venue_draft"
        ? { draftOwnerKey: target.draftOwnerKey }
        : target.kind === "ad_creative"
          ? { draftOwnerKey: target.ownerKey }
          : {},
    { isDeviceOffline },
  );
  const lastVideoUploadFileRef = useRef<EventCoverVideoUploadFile | null>(null);
  // #3040 H-14a — the clip behind a "too long" refusal, for "Trim to 1 minute".
  const lastPickedVideoAssetRef = useRef<CoverPickerAsset | null>(null);
  // #3040 B-C18 — web: the chooser closed and the duration is being read.
  const [readingClip, setReadingClip] = useState(false);
  // issue #3485 — the PICK/PREPARE half of "busy" (see coverPickerVideoPickGate).
  // True only while the OS video picker is open or its clip is being trimmed,
  // measured and handed onward; cleared the moment the file becomes the upload
  // hook's problem, so it never covers the upload or the encode the way
  // `uploading` does. A ref, not state: the guard reads it at tap time and a
  // re-render would buy nothing.
  const videoPickInFlightRef = useRef(false);
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
    setRenderFailures(0);
    setReloadingPreview(false);
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

  // issue #3318 — the photo add pipeline (see `coverPickerGalleryAdd`). ONE
  // controller per mount, so a photo's tile outlives every re-render and every
  // host re-seed. Its callbacks read `galleryAddLatest`, refreshed after each
  // render, so it never holds a stale closure.
  const galleryAddLatest = useRef<
    Pick<GalleryAddControllerDeps, "upload" | "commit" | "notify" | "isVideoJobActive">
  >({
    upload: () => Promise.reject(new Error("CoverPicker gallery add is not ready.")),
    commit: () => undefined,
    notify: () => undefined,
    isVideoJobActive: () => false,
  });
  const [galleryAdd] = useState<GalleryAddController>(() =>
    createGalleryAddController({
      upload: (asset, onStage) => galleryAddLatest.current.upload(asset, onStage),
      commit: (item) => galleryAddLatest.current.commit(item),
      onTilesChange: (tiles) => setGalleryTiles(tiles),
      notify: (message) => galleryAddLatest.current.notify(message),
      report: (failure) => reportGalleryAddFailure(failure, target.kind),
      isVideoJobActive: () => galleryAddLatest.current.isVideoJobActive(),
      copy: {
        maxMegabytes: Math.round(
          (isBrand || isVenue ? BRAND_COVER_MAX_BYTES : EVENT_COVER_MAX_BYTES) / (1024 * 1024),
        ),
      },
    }),
  );
  const galleryAddRef = useRef<GalleryAddController>(galleryAdd);
  useEffect(() => {
    galleryAdd.attach();
    return () => galleryAdd.dispose();
  }, [galleryAdd]);
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
    : readingClip && ["idle", "error", "applied"].includes(videoUpload.stage.phase)
      ? { phase: "reading" as const, percent: 0 }
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
  // issue #3280 — "Make cover" is a COVER action living inside the gallery
  // section, so it keeps the video lock the gallery no longer has. Promoting a
  // photo while a video job owns the cover would be overwritten, silently, when
  // the job applies. One memoised state feeds the control, its reason, and both
  // guards (`requestMakeCover`, `applyMakeCover`).
  const makeCoverGate = useMemo<GalleryMakeCoverState>(
    () => ({
      disabled,
      coverUploading: uploading,
      galleryUploading,
      videoLocked: lockedVideoOperation,
    }),
    [disabled, galleryUploading, lockedVideoOperation, uploading],
  );
  // #3040 B-C4 [A-4] / design T7 — the preview is the SAVED cover; the new
  // clip shows only when no cover exists yet (H-20). A finished job's
  // `processedUrl` never outranks the cover the host chose after it.
  const activeMedia = resolveActiveMedia({
    localPreviewUri: videoUpload.localPreviewUri,
    processedUrl: videoUpload.processedUrl,
    stagePhase: projectedVideoStage.phase,
    coverUrl: localCover.coverMediaUrl,
    coverType: localCover.coverMediaType,
  });
  const activeMediaUrl = activeMedia.url;
  const coverKind: CoverKind = coverKindOf(localCover.coverMediaUrl, localCover.coverMediaType);

  // issue #3318 — the refs both emit paths read at the moment they emit.
  const emitRefs = useMemo<CoverEmitRefs<CoverPatch>>(
    () => ({ cover: localCoverRef, gallery: galleryRef }),
    [],
  );

  const emitChange = useCallback(
    async (patch: CoverPatch): Promise<void> => {
      // issue #3280 — the cover ref moves BEFORE the host hears about it. A
      // gallery upload may finish while a cover emit is in flight (the
      // video-ready emit is server-driven and cannot be blocked), and the
      // gallery commit re-emits the cover ref; one render with the PREVIOUS
      // cover there would silently revert the new one. issue #868 — the emit
      // always carries the current gallery (the two are INDEPENDENT).
      // issue #3318 — that ordering now lives in `emitCoverWithGallery`, so the
      // video-ready-during-a-photo-upload case is tested for real.
      await emitCoverWithGallery(patch, emitRefs, setLocalCover, onCoverChange);
    },
    [emitRefs, onCoverChange],
  );

  const persistReadyVideo = useCallback(async (): Promise<void> => {
    const readyUrl = videoUpload.processedUrl;
    if (readyUrl === null || lastEmittedProcessedVideoUrlRef.current === readyUrl || savingProcessedVideoUrlRef.current === readyUrl) return;
    // #3040 B-C3 [A-3] / T6 — only a job THIS device started (or resumed from
    // its own record) may become the cover. Reopening the sheet used to
    // re-emit the target's latest `applied` video over a newer photo.
    if (!videoUpload.ownsJob(videoUpload.status?.jobId)) return;
    // #3040 B-C14 — an ad video is linked by its creative id, which exists
    // only once the server materialized the row (the job applies after that).
    if (isAdCreative && videoUpload.creativeId === null) return;
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
        ...(isAdCreative ? { adCreativeId: videoUpload.creativeId } : {}),
      });
      if (isVenue) await videoUpload.acknowledgeApplied();
      lastEmittedProcessedVideoUrlRef.current = readyUrl;
      // ONE confirmation. The video status card already shows the green
      // success state for the `applied` stage every success lands on, so the
      // orange in-sheet notice that used to be set here said the same thing a
      // second time, a little lower in the sheet. Clearing the notice also drops any stale message from
      // an earlier attempt (e.g. a failed save that this retry just fixed).
      setVideoPickNotice(null);
    } catch {
      lastEmittedProcessedVideoUrlRef.current = null;
      setReadyPersistenceFailed(true);
      setVideoPickNotice({ tone: "error", text: "The video is ready, but the cover could not be saved. Retry saving it." });
    } finally {
      savingProcessedVideoUrlRef.current = null;
    }
  }, [
    emitChange,
    isAdCreative,
    isVenue,
    setVideoPickNotice,
    videoUpload,
  ]);

  // Venue owners must persist first and acknowledge second. Event/brand jobs
  // emit only after the server projects authoritative `applied` truth.
  useEffect(() => {
    const shouldPersist = isVenue
      ? videoUpload.status?.status === "ready" && !readyPersistenceFailed
      : videoUpload.stage.phase === "applied";
    if (shouldPersist) void persistReadyVideo();
  }, [isVenue, persistReadyVideo, readyPersistenceFailed, videoUpload.stage.phase, videoUpload.status?.status]);

  // #3040 H-15 / T6 — "New video cover is live" for 3 s, once per job id,
  // and only for a job this device started. Never replayed on reopen.
  const announcedJobIdsRef = useRef<Set<string>>(new Set());
  const [justAppliedJobId, setJustAppliedJobId] = useState<string | null>(null);
  const appliedJobId = videoUpload.stage.phase === "applied" ? videoUpload.status?.jobId ?? null : null;
  useEffect(() => {
    if (appliedJobId === null || announcedJobIdsRef.current.has(appliedJobId)) return undefined;
    if (!videoUpload.ownsJob(appliedJobId)) return undefined;
    announcedJobIdsRef.current.add(appliedJobId);
    setJustAppliedJobId(appliedJobId);
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility("New video cover is live");
    const timer = setTimeout(() => setJustAppliedJobId(null), 3_000);
    return () => clearTimeout(timer);
  }, [appliedJobId, videoUpload]);

  // #3040 — how long the current phase has shown (the 20 s "Big file" and
  // "Still confirming" rules, and the elapsed timer from 3 s).
  const [phaseStartedAt, setPhaseStartedAt] = useState(() => Date.now());
  const [phaseClock, setPhaseClock] = useState(0);
  useEffect(() => {
    setPhaseStartedAt(Date.now());
    setPhaseClock(0);
  }, [projectedVideoStage.phase]);
  useEffect(() => {
    if (!["picking", "reading", "validating", "preparing", "ack_pending"].includes(projectedVideoStage.phase)) return undefined;
    const timer = setInterval(() => setPhaseClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [projectedVideoStage.phase]);

  // #3040 B-C8 — throughput for the "About N s left" estimate, from the
  // server-confirmed byte samples only (5 s minimum of samples).
  const uploadSamplesRef = useRef<Array<{ at: number; bytes: number }>>([]);
  const uploadConfirmed = projectedVideoStage.phase === "uploading" ? projectedVideoStage.confirmedBytes ?? null : null;
  useEffect(() => {
    if (uploadConfirmed === null) {
      uploadSamplesRef.current = [];
      return;
    }
    uploadSamplesRef.current = [...uploadSamplesRef.current, { at: Date.now(), bytes: uploadConfirmed }].slice(-12);
  }, [uploadConfirmed]);
  const bytesPerSecond = (() => {
    const samples = uploadSamplesRef.current;
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const seconds = (last.at - first.at) / 1000;
    return seconds >= 5 ? (last.bytes - first.bytes) / seconds : null;
  })();

  // #3040 — a refusal made at pick time, before any byte left the device
  // (H-14a too long, H-14b too large, H-14c type, AD-06 ad under 5 s).
  const [pickRefusal, setPickRefusal] = useState<PickRefusal | null>(null);
  const lastPickedClipRef = useRef<{ durationMs: number; bytes: number } | null>(null);
  const cardContext = {
    isNative: Platform.OS !== "web",
    hasCover: localCover.coverMediaUrl !== null,
    videoOnly: mediaMode === "video-only",
    finishesWithoutYou: coverVideoFinishesWithoutYou(videoUpload.status),
    phaseElapsedMs: Math.max(0, (phaseClock || Date.now()) - phaseStartedAt),
    bytesPerSecond,
    newClipDurationMs: lastPickedClipRef.current?.durationMs ?? null,
    newClipBytes: lastPickedClipRef.current?.bytes ?? null,
  };
  const cardModel: UploadCardModel | null = pickRefusal !== null && !activeVideoUpload
    ? pickRefusalCardModel(pickRefusal, cardContext)
    : videoUploadCardModel(projectedVideoStage, videoUpload.status, cardContext);
  const isLiveCover = target.kind === "brand" || target.kind === "venue" ||
    ((target.kind === "event" || target.kind === "trip" || target.kind === "experience") &&
      target.coverMediaApplyMode === "published_manual");
  const statusRow = coverStatusRowModel({
    coverKind,
    isLive: isLiveCover,
    videoOnly: mediaMode === "video-only",
    justApplied: justAppliedJobId !== null,
    adFitSummary,
  });
  const needsAction = cardModel?.needsAction === true;
  useEffect(() => {
    onNeedsActionChange?.(needsAction);
  }, [needsAction, onNeedsActionChange]);

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
      // issue #3318 — reads the cover ref as it is NOW (see
      // `commitGalleryWithCover`), never a cover captured when a photo was
      // picked.
      commitGalleryWithCover(next, emitRefs, setGallery, onCoverChange);
    },
    [emitRefs, onCoverChange],
  );

  // issue #868 M.3 — append ONE image/GIF item to the gallery (clamp at max). The
  // shared append path for BOTH the device "Add photo" and the provider (GIF/Photos)
  // tiles when the target is "gallery". Never touches the cover fields.
  const appendGalleryItem = useCallback(
    (item: OfferingGalleryImage): void => {
      // issue #3318 — a photo still uploading (or failed, awaiting Retry) holds
      // its slot, so the cap counts it.
      if (galleryRef.current.length + galleryAddRef.current.tiles().length >= GALLERY_MAX) {
        onShowToast(`Up to ${GALLERY_MAX} extra photos.`);
        return;
      }
      commitGallery([...galleryRef.current, item]);
      lightHaptic();
      onShowToast("Photo added to gallery.");
    },
    [commitGallery, onShowToast],
  );

  // issue #3318 — ONE photo's upload, for the add controller. Same storage
  // routing as the cover (event_covers / brand_covers) so the saved item is a
  // durable public URL; `onStage` lets a failure say where it happened.
  const uploadGalleryPhoto = useCallback<GalleryAddControllerDeps["upload"]>(
    async (asset, onStage) => {
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
          { previousPublicUrl: null, onStage, uploadWithRetry: galleryStorageUpload },
        );
        publicUrl = uploaded.publicUrl;
        mediaType = uploaded.mediaType === "gif" ? "gif" : "image";
      } else {
        const uploaded = await uploadEventCoverMedia(
          {
            uri: asset.uri,
            brandId: target.brandId,
            eventId: eventRowId,
            mimeType: asset.mimeType,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            durationMs: null,
            pickerType: asset.type,
          },
          { onStage, uploadWithRetry: galleryStorageUpload },
        );
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
              onStage,
              uploadWithRetry: galleryStorageUpload,
            });
            posterUrl = poster.publicUrl;
          } else {
            const poster = await uploadEventCoverMedia(
              {
                ...extracted.asset,
                brandId: target.brandId,
                eventId: eventRowId,
                durationMs: null,
                pickerType: "image",
              },
              { onStage, uploadWithRetry: galleryStorageUpload },
            );
            posterUrl = poster.publicUrl;
          }
        } finally {
          await extracted.cleanup();
        }
      }
      return { url: publicUrl, posterUrl, type: mediaType, alt: null, credit: null };
    },
    [eventRowId, isBrand, isVenue, target],
  );

  useEffect(() => {
    galleryAddLatest.current = {
      upload: uploadGalleryPhoto,
      commit: (item) => {
        // Reads the gallery as it is NOW: a provider pick, a reorder or a
        // re-seed that landed during the upload is kept.
        commitGallery([...galleryRef.current, item]);
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
        }
      },
      notify: onShowToast,
      isVideoJobActive: () => activeVideoUpload,
    };
  }, [activeVideoUpload, commitGallery, onShowToast, uploadGalleryPhoto]);

  // Add ONE image/GIF from the device library to the gallery (never a video).
  // Clamps at GALLERY_MAX. Independent of the primary cover — does NOT touch it.
  const addGalleryPhoto = useCallback(async (): Promise<void> => {
    // issue #3280 — `activeVideoUpload` used to sit in this guard and in the
    // section's `disabled` prop. It was an accidental copy of the COVER-path
    // guard at `pickImageOrGifCover`, where blocking is correct; the gallery is
    // a separate storage pipeline that shares nothing with the video job, and
    // the tile it silenced had no disabled styling, so the tap was simply dead.
    // The rule now lives in `coverPickerGalleryGate`, cannot take a video
    // argument, and reads the gallery's own `galleryUploading` — never the
    // picker-wide `uploading` the video flow holds while it processes.
    // issue #3318 — a photo still uploading, or failed and awaiting Retry,
    // holds its slot.
    const atCap = galleryRef.current.length + galleryAdd.tiles().length >= GALLERY_MAX;
    if (!canAddGalleryPhoto({ galleryUploading, disabled, atCap })) {
      if (atCap && !galleryUploading && !disabled) onShowToast(`Up to ${GALLERY_MAX} extra photos.`);
      return;
    }
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }

    setGalleryUploading(true);
    try {
      // issue #3318 — every failure before a file is in hand is reported with
      // stage "pick" and shown in photo copy (the shared `showUploadError`
      // says "cover").
      const permission = await requestCoverMediaLibraryPermission();
      if (!permission.granted) {
        galleryAdd.failBeforeUpload(
          new EventCoverMediaError("permission_denied", "Photo library permission denied."),
        );
        return;
      }
      if (!isBrand && !isVenue && eventRowId.trim().length === 0) {
        galleryAdd.failBeforeUpload(
          new EventCoverMediaError("missing_server_event_id", "Missing server row id."),
        );
        return;
      }
      let result: Awaited<ReturnType<typeof launchCoverImagePicker>>;
      try {
        result = await launchCoverImagePicker();
      } catch (error) {
        galleryAdd.failBeforeUpload(error);
        return;
      }
      if (result.canceled || result.assets.length === 0) return;
      const pickedAssets = result.assets;
      const asset = result.assets[0];
      // issue #3318 — from here the photo is a tile. A failure keeps it, with
      // Retry on the SAME file, so the picked file is freed only when the photo
      // leaves the controller (saved or removed), never in this `finally`.
      await galleryAdd.add({
        // The whole picker asset, as the cover path passes it: native pickers
        // carry width/height the GIF poster resize reads.
        ...asset,
        release: () => revokeCoverPickedAssets(pickedAssets),
      });
    } finally {
      setGalleryUploading(false);
    }
    // issue #3280 — `activeVideoUpload` is gone from the body and therefore
    // from this list; the gallery does not depend on video state.
  }, [
    disabled,
    eventRowId,
    galleryAdd,
    galleryUploading,
    isAuthReady,
    isBrand,
    isVenue,
    onShowToast,
  ]);

  // issue #3318 — Retry uploads a failed tile's SAME file; Remove drops it.
  const retryGalleryPhoto = useCallback(
    async (key: string): Promise<void> => {
      if (galleryUploading || disabled) return;
      setGalleryUploading(true);
      try {
        await galleryAdd.retry(key);
      } finally {
        setGalleryUploading(false);
      }
    },
    [disabled, galleryAdd, galleryUploading],
  );

  const removeGalleryTile = useCallback(
    (key: string): void => {
      galleryAdd.remove(key);
    },
    [galleryAdd],
  );

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
      // issue #3280 — the emit chokepoint. It is reached from `requestMakeCover`
      // AND from the OQ-3 "Replace your video cover?" confirm, which can be left
      // open while a replacement video starts; neither may promote a photo while
      // a video job owns the cover. Never silent: the reason is shown.
      if (!canMakeGalleryPhotoCover(makeCoverGate)) {
        const reason = galleryMakeCoverBlockedReason(makeCoverGate);
        if (reason !== null) onShowToast(reason);
        return;
      }
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
      videoUpload.resetAppliedPreview();
      onCoverChange(patch);
      onShowToast("Cover updated.");
    },
    [makeCoverGate, onCoverChange, onShowToast, videoUpload],
  );

  const requestMakeCover = useCallback(
    (index: number): void => {
      // issue #3280 — was `if (disabled) return;`. The control is disabled with
      // a reason while this is false; this is the backstop, and it runs BEFORE
      // the OQ-3 confirm so a locked tap cannot even open "Replace your video
      // cover?".
      if (!canMakeGalleryPhotoCover(makeCoverGate)) {
        const reason = galleryMakeCoverBlockedReason(makeCoverGate);
        if (reason !== null) onShowToast(reason);
        return;
      }
      // OQ-3: replacing a VIDEO cover with a photo requires explicit confirm.
      if (localCoverRef.current.coverMediaType === "video") {
        setPendingMakeCoverIndex(index);
        return;
      }
      applyMakeCover(index);
    },
    [applyMakeCover, makeCoverGate, onShowToast],
  );

  const pickImageOrGifCover = useCallback(async (): Promise<void> => {
    // issue #3280 — a gallery upload is busy for the cover too, so a cover emit
    // and a gallery commit are never both in flight from user actions.
    if (uploading || galleryUploading || disabled || activeVideoUpload) return;
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
      return;
    }
    if (!(await ensureMediaPermission())) return;
    if (!validateEventRowId()) return;

    setUploading(true);
    setCoverUploadKind("image");
    // #3040 H-03 — switching a video cover to a photo says so.
    const photoAddedToast = localCoverRef.current.coverMediaType === "video"
      ? "Photo cover added. The video is no longer your cover."
      : "Cover updated.";
    setPickRefusal(null);
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
          {
            // #3655 staged deck cover — keep the persisted object until Save.
            previousPublicUrl: deferPreviousCleanup
              ? null
              : localCover.coverMediaUrl,
          },
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
        // #3040 B-C4 [A-4] — new media wins over a finished video preview.
      videoUpload.resetAppliedPreview();
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
        onShowToast(photoAddedToast);
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
        // #3040 B-C4 [A-4] — new media wins over a finished video preview.
      videoUpload.resetAppliedPreview();
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
        onShowToast(photoAddedToast);
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
      // #3040 B-C4 [A-4] — new media wins over a finished video preview.
      videoUpload.resetAppliedPreview();
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
      onShowToast(photoAddedToast);
    } catch (error) {
      // #3040 H-02 — the old photo stays; the toast says exactly that.
      if (error instanceof EventCoverMediaError && error.code === "upload_failed") {
        onShowToast("Couldn't upload that photo. Your cover didn't change.");
      } else if (error instanceof EventCoverMediaError || error instanceof BrandCoverError) {
        showUploadError(error);
      } else {
        onShowToast("Couldn't upload that photo. Your cover didn't change.");
      }
    } finally {
      revokeCoverPickedAssets(pickedAssets);
      setUploading(false);
    }
  }, [
    activeVideoUpload,
    brandCover,
    deferPreviousCleanup,
    disabled,
    emitChange,
    ensureMediaPermission,
    galleryUploading,
    isAuthReady,
    localCover.coverMediaUrl,
    onShowToast,
    setVideoPickNotice,
    showUploadError,
    target,
    uploading,
    validateEventRowId,
    videoUpload,
  ]);

  const pickVideoCover = useCallback(async (
    replacing = false,
    reuseAsset: CoverPickerAsset | null = null,
    // #3040 T5 — the notice that explains WHY the picker opened (a retry
    // with no retained file), shown instead of clearing the notice row.
    openingNotice: NativeEditorNotice | null = null,
  ): Promise<void> => {
    const resumingDetachedWeb = Platform.OS === "web" && videoUpload.stage.phase === "detached";
    // issue #3280 — see `pickImageOrGifCover`: a gallery upload is cover-busy.
    // issue #3485 — was one bare `return` over four flags, and `uploading` is
    // held for the WHOLE processing window, so Replace was a dead tap for the
    // exact 32-minute stall a host needs to escape. The rule now lives in
    // `videoPickRefusal`, which lets a replace past an in-flight upload/encode
    // and still blocks a second picker launch — and every refusal SAYS so.
    const refusal = videoPickRefusal({
      videoPickInFlight: videoPickInFlightRef.current,
      galleryUploading,
      coverUploading: uploading,
      disabled,
      videoLocked: lockedVideoOperation,
      replacing,
      resumingDetachedWeb,
    });
    if (refusal !== null) {
      setVideoPickNotice(refusal);
      return;
    }
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
    setCoverUploadKind("video");
    // issue #3485 — the pick/prepare critical section opens here and closes
    // either where the file is handed to the upload hook or in the `finally`.
    videoPickInFlightRef.current = true;
    // issue #1338 — clear any stale notice from a prior attempt.
    setVideoPickNotice(openingNotice);
    setPickRefusal(null);
    const previousPickedVideoAssets = pickedVideoAssetsRef.current;
    let selectedReplacementAssets: Parameters<typeof revokeCoverPickedAssets>[0] | null = null;
    // issue #3280 — once the native trim editor has been shown on top of this
    // sheet, the outcome goes to a FRESH sheet (iOS) instead of this one.
    const handOffAfterNativeEditor = returnsThroughFreshSheet(
      Platform.OS,
      onNativeEditorClosed !== undefined,
    );
    let presentedNativeEditor = false;
    let nativeEditorUpload: NativeEditorCarry["upload"] = null;
    // Every outcome after the native editor (clip, cancel, a too-long or
    // unreadable clip, a trim failure) continues in a fresh sheet. Wait for the
    // editor to finish dismissing first: closing this sheet while the editor is
    // still on top of it would dismiss the editor instead.
    const handOffToFreshSheet = async (): Promise<void> => {
      if (onNativeEditorClosed === undefined) return;
      await waitForTrimEditorToClose();
      onNativeEditorClosed({
        id: nextNativeEditorCarryId(),
        handedOffBy: nativeEditorInstanceRef.current,
        notice: videoPickNoticeRef.current,
        upload: nativeEditorUpload,
        failedGalleryPhotos: galleryAdd.handOffFailed(),
      });
    };
    try {
      // #3040 B-C18 [A-21] — web: the chooser closed; show "Checking file" at
      // once instead of seconds of silence while the duration is read.
      // A "Trim to 1 minute" tap (H-14a) reuses the clip already picked.
      const result = reuseAsset !== null
        ? { canceled: false, assets: [reuseAsset] }
        : await launchCoverVideoPicker({ onFileChosen: () => setReadingClip(true) });
      if (result.canceled || result.assets.length === 0) return;
      // ORCH-1308: free the PREVIOUS pick's blob, then retain THIS one so the
      // "try again" retry (web fetch(blob:uri)) can re-read it. It is freed on
      // the next pick or on unmount (effect above), NOT in the finally below.
      // A replacement keeps the old browser blob alive until the server has
      // accepted the new immutable operation. A rejected replacement can then
      // resume the old upload instead of having its last readable bytes revoked.
      if (reuseAsset === null) {
        if (!replacing) revokeCoverPickedAssets(previousPickedVideoAssets);
        pickedVideoAssetsRef.current = result.assets;
        if (replacing) selectedReplacementAssets = result.assets;
      }
      const asset = result.assets[0];
      lastPickedVideoAssetRef.current = asset;
      const sourceDurationMs = normalizePickerDurationMs(asset.duration);
      // issue #3040 — a clip a few frames over 60 s is declared as exactly
      // 60 s instead of being refused or forced through the trimmer.
      // #3040 B-C13a — on EVERY platform now: a phone's own "1 minute"
      // recording (60.03 s) no longer opens the trimmer on iOS / Android.
      const rawClipDurationMs = resolveRawCoverClipDurationMs(
        sourceDurationMs,
        Platform.OS === "web",
      );
      // #3040 H-14c — a type the lane cannot take is refused before any byte.
      const pickedType = (asset.mimeType ?? "").toLowerCase();
      if (pickedType === "video/3gpp" || pickedType === "video/3gpp2" || /\.3g[p2]$/i.test(asset.fileName ?? "")) {
        setPickRefusal({ kind: "unsupported" });
        return;
      }
      // #3040 AD-06 / I-AD-VIDEO-MIN-5S — an ad video under 5 s is refused at
      // pick: no prepare, no intent, no byte leaves the device. Covers have no
      // minimum.
      if (isAdCreative && rawClipDurationMs > 0 && rawClipDurationMs < AD_MIN_DURATION_MS) {
        setPickRefusal({ kind: "too_short", durationMs: rawClipDurationMs });
        return;
      }
      // #3040 H-14b — web uploads the RAW file (no compressor), so over 100 MB
      // is refused here. Native compresses first and checks after.
      if (!isNative && typeof asset.fileSize === "number" && asset.fileSize > EVENT_COVER_SOURCE_MAX_BYTES) {
        setPickRefusal({ kind: "too_large", bytes: asset.fileSize });
        return;
      }
      // issue #1338 — trim ONLY when a native clip is over the source ceiling.
      // Within-ceiling native clips and ALL web clips upload RAW (mirrors the
      // ORCH-1307 web path), which keeps the flaky native trim modal out of the
      // common short-clip path entirely.
      const needsNativeTrim =
        isNative && rawClipDurationMs > EVENT_COVER_SOURCE_CEILING_MS;

      let trimResult: VideoTrimFinishPayload | null = null;
      if (needsNativeTrim) {
        // issue #1338 — present the trim editor ONLY after the OS photo picker
        // has fully dismissed, so iOS New Arch never refuses a 2nd stacked modal.
        if (reuseAsset === null) await waitForPickerDismissal();
        presentedNativeEditor = true;
        // The single-line trim call is pinned by the orch-0978 strict-grep C1
        // gate (exact substring match); prettier-ignore stops printWidth (80)
        // from re-wrapping it across lines and re-breaking the gate.
        // prettier-ignore
        trimResult = await trimVideoWithDedicatedEditor(asset.uri, EVENT_COVER_MAX_VIDEO_DURATION_MS);
        if (trimResult === null) {
          // Genuine user cancel (Back). NEVER silent (issue #1338).
          setVideoPickNotice({
            tone: "info",
            text: "No video added — trim to 1 minute or pick a shorter clip.",
          });
          return;
        }
      }
      let uploadFile: EventCoverVideoUploadFile;
      try {
        uploadFile =
          trimResult !== null
            ? await buildTrimmedVideoUploadFile({
                statFile: (uri) => getCoverPickerFileInfoAsync(uri),
                trimResult,
                // #3040 B-C13b — the stream-copy trim can run a GOP past the
                // window; measure the real output before declaring it.
                measureDurationMs: measureTrimmedVideoDurationMs,
              })
            : {
                bytes: asset.fileSize ?? 0,
                durationMs: rawClipDurationMs,
                fileName: asset.fileName,
                mimeType: asset.mimeType ?? "video/mp4",
                trimEndMs: rawClipDurationMs,
                trimStartMs: 0,
                // ORCH-1303: on web `asset.uri` is a browser blob: object URL that
                // is fetch-able as-is; normalizeLocalFileUri would prefix `file://`
                // → `file://blob:…` and the web TUS upload's fetch(input.uri) would
                // reject. Native still normalizes its real file path.
                uri: resolveRawClipUploadUri(asset.uri, Platform.OS === "web"),
              };
      } catch (buildError) {
        if (buildError instanceof TrimOverCapError) {
          // #3040 H-14a — measured over a minute: say how long, offer the trimmer.
          setPickRefusal({ kind: "too_long", durationMs: buildError.measuredMs });
          return;
        }
        throw buildError;
      }
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
        // #3040 H-14a — "This video is {m:ss} long": on web there is no
        // trimmer, so the action is "Choose another video"; native offers
        // "Trim to 1 minute" (a rare safety net — the trimmer runs first).
        setPickRefusal({ kind: "too_long", durationMs });
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
      lastPickedClipRef.current = { durationMs, bytes: uploadFile.bytes };
      lastVideoUploadFileRef.current = uploadFile;
      if (presentedNativeEditor && handOffAfterNativeEditor) {
        // issue #3280 — do NOT start here. The fresh sheet starts this upload
        // (see `resumeAfterNativeEditor`), so its progress and its result land
        // in a native window nothing was stacked on.
        nativeEditorUpload = { file: uploadFile, replacing };
        return;
      }
      // issue #3485 — the pick/prepare is over: the clip is validated and the
      // hook owns it from here. Releasing BEFORE the await is the whole fix —
      // `start`/`replace` do not resolve until the encode settles, and holding
      // the pick lock across that window is what made Replace a dead tap.
      videoPickInFlightRef.current = false;
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
      // issue #3280 — hand off to a fresh sheet (see `handOffToFreshSheet`).
      // issue #3485 — the pick lock outlives the hand-off on purpose: until the
      // carry has been handed over, a second pick would race the trim editor's
      // dismissal. It is released after, and on every early return and error.
      if (presentedNativeEditor && handOffAfterNativeEditor) await handOffToFreshSheet();
      videoPickInFlightRef.current = false;
      setReadingClip(false);
      // ORCH-1308: do NOT revoke the picked blob here — the "try again" retry
      // re-reads it (web fetch(blob:uri)). It is retained via
      // pickedVideoAssetsRef and freed on the next pick / on unmount instead.
      setUploading(false);
    }
  }, [
    disabled,
    ensureMediaPermission,
    galleryAdd,
    galleryUploading,
    isAdCreative,
    isAuthReady,
    isNative,
    lockedVideoOperation,
    onNativeEditorClosed,
    setVideoPickNotice,
    uploading,
    validateEventRowId,
    videoUpload,
  ]);

  // ----- issue #3280: continue after the native trim editor ----------------
  // This picker is the FRESH sheet. `armed` is set by this first effect in the
  // same batch as the video hook's mount-time reconnect ("reattaching"), so a
  // clip upload starts only once that reconnect has settled — exactly like a
  // host who opens the sheet and then picks a clip.
  const [nativeEditorResumeArmed, setNativeEditorResumeArmed] = useState(false);
  useEffect(() => {
    setNativeEditorResumeArmed(true);
  }, []);
  const consumedNativeEditorCarryRef = useRef<number | null>(null);

  const continueVideoUploadAfterNativeEditor = useCallback(
    async (upload: NonNullable<NativeEditorCarry["upload"]>): Promise<void> => {
      lastVideoUploadFileRef.current = upload.file;
      setUploading(true);
      setCoverUploadKind("video");
      try {
        if (upload.replacing) await videoUpload.replace(upload.file);
        else await videoUpload.start(upload.file);
      } catch (error) {
        setVideoPickNotice({ tone: "error", text: friendlyVideoCoverError(error) });
      } finally {
        setUploading(false);
      }
    },
    [setVideoPickNotice, videoUpload],
  );

  useEffect(() => {
    const carry = resumeAfterNativeEditor;
    if (carry === null || consumedNativeEditorCarryRef.current === carry.id) return;
    // The picker that handed off never continues: a new native window must.
    if (carry.handedOffBy === nativeEditorInstanceRef.current) return;
    if (
      !canContinueAfterNativeEditor({
        armed: nativeEditorResumeArmed,
        videoPhase: videoUpload.stage.phase,
        hasUpload: carry.upload !== null,
      })
    ) {
      return;
    }
    consumedNativeEditorCarryRef.current = carry.id;
    onResumeAfterNativeEditorConsumed?.(carry.id);
    if (carry.failedGalleryPhotos.length > 0) galleryAdd.adoptFailed(carry.failedGalleryPhotos);
    if (carry.notice !== null) setVideoPickNotice(carry.notice);
    if (carry.upload !== null) void continueVideoUploadAfterNativeEditor(carry.upload);
  }, [
    continueVideoUploadAfterNativeEditor,
    galleryAdd,
    nativeEditorResumeArmed,
    onResumeAfterNativeEditorConsumed,
    resumeAfterNativeEditor,
    setVideoPickNotice,
    videoUpload.stage.phase,
  ]);

  const cancelVideoCoverUpload = useCallback((): void => {
    void videoUpload.cancel().catch(() => {
      onShowToast("Could not cancel video upload. Try again.");
    });
  }, [onShowToast, videoUpload]);

  // #3040 B-C6 [A-6] / design T5 — "Try again" ALWAYS does something. After
  // a remount no file is retained, and it used to return silently; now it
  // opens the picker with "Choose the video again to retry.", or says why it
  // is waiting. issue #3280 — a gallery upload is cover-busy.
  const retryVideoCoverUpload = useCallback((): void => {
    const uploadFile = lastVideoUploadFileRef.current;
    const plan = retryVideoPlan({
      retainedFile: uploadFile !== null,
      busy: activeVideoUpload || disabled || uploading || galleryUploading,
    });
    if (plan.kind === "busy") {
      setVideoPickNotice({ tone: "info", text: plan.notice });
      return;
    }
    if (plan.kind === "pick_again" || uploadFile === null) {
      void pickVideoCover(lockedVideoOperation, null, { tone: "info", text: RETRY_PICK_NOTICE });
      return;
    }
    void videoUpload.start(uploadFile);
  }, [activeVideoUpload, disabled, galleryUploading, lockedVideoOperation, pickVideoCover, setVideoPickNotice, uploading, videoUpload]);

  // #3040 — every card action, by the id the design gives it.
  const handleCardAction = useCallback((id: CardActionId): void => {
    switch (id) {
      case "cancel":
      case "cancel_upload":
      case "discard":
      case "discard_video":
        setPickRefusal(null);
        cancelVideoCoverUpload();
        return;
      case "check_now":
      case "check_again":
        void videoUpload.checkNow().catch(() => {
          setVideoPickNotice({ tone: "info", text: "Couldn't reach Mingla. We'll check again when you're connected." });
        });
        return;
      case "resume_upload":
        // H-10 — still offline: say so instead of a dead tap.
        if (isDeviceOffline()) {
          setOfflineNudge((count) => count + 1);
          setVideoPickNotice({ tone: "info", text: "Still offline. We'll resume as soon as you're back." });
          return;
        }
        void videoUpload.continueUpload();
        return;
      case "continue_upload":
        void videoUpload.continueUpload();
        return;
      case "choose_again":
        // H-12 — any clip is accepted as a NEW operation; the hook cancels the
        // old job once the new clip is prepared (A-18).
        setPickRefusal(null);
        void pickVideoCover(false);
        return;
      case "try_again":
        retryVideoCoverUpload();
        return;
      case "trim": {
        const asset = lastPickedVideoAssetRef.current;
        setPickRefusal(null);
        void pickVideoCover(lockedVideoOperation, asset);
        return;
      }
      case "choose_another":
        setPickRefusal(null);
        void pickVideoCover(lockedVideoOperation);
        return;
      case "update_app": {
        const url = hostAppStoreUrl(Platform.OS);
        if (url !== null) {
          void Linking.openURL(url).catch(() => {
            setVideoPickNotice({ tone: "error", text: "Couldn't open the store. Update Mingla Host from your app store." });
          });
        }
        return;
      }
      case "save_as_cover":
      case "try_saving_again":
        // H-19 / AD-05 — apply only, never a re-upload.
        if (isVenue) void persistReadyVideo();
        else {
          void videoUpload.acknowledgeApplied().catch(() => {
            setVideoPickNotice({ tone: "error", text: "Couldn't save it yet. Try again in a moment." });
          });
        }
        return;
      case "choose_different":
        void pickVideoCover(true);
        return;
    }
  }, [cancelVideoCoverUpload, isDeviceOffline, isVenue, lockedVideoOperation, persistReadyVideo, pickVideoCover, retryVideoCoverUpload, setVideoPickNotice, videoUpload]);

  // #3040 H-10 — reconnecting resumes the paused upload without a tap.
  const wasOfflineRef = useRef(false);
  const videoStageNow = videoUpload.stage;
  const continueVideoUpload = videoUpload.continueUpload;
  useEffect(() => {
    const connected = network?.isConnected ?? null;
    if (connected === false) {
      wasOfflineRef.current = true;
      return;
    }
    if (connected === true && wasOfflineRef.current && videoStageNow.phase === "detached" && videoStageNow.reason === "offline") {
      wasOfflineRef.current = false;
      void continueVideoUpload();
    }
  }, [continueVideoUpload, network?.isConnected, videoStageNow]);

  // ----- issue #3485: settle a finished job when the app comes back ---------
  // The card was stuck on "Processing video…" (elapsed 4758m) for a job the
  // server had already applied, and closing and reopening the sheet did not
  // clear it — only a full app restart did. The sheet had exactly three routes
  // to the truth: the hook's mount-time `resume`, its live poll, and `checkNow`,
  // which is only reachable from the `detached` phase's button. A poll that died
  // while the app was suspended therefore had no route back at all.
  //
  // The missing signal is the app coming back. `shouldRecheckCoverVideo` owns
  // WHEN (phase, single-flight, one read per window); `videoUpload.checkNow` is
  // the same read the button performs, apply step included.
  const videoRecheckInFlightRef = useRef(false);
  const lastVideoRecheckAtRef = useRef<number | null>(null);
  // Read off the hook's object HERE, not inside the callback: `videoUpload` is a
  // fresh object every render, so depending on it would rebuild this callback
  // every render and re-fire the phase effect below on every poll tick.
  const checkVideoJobNow = videoUpload.checkNow;
  const videoJobPhase = videoUpload.stage.phase;
  const recheckVideoJob = useCallback((): void => {
    const last = lastVideoRecheckAtRef.current;
    if (
      !shouldRecheckCoverVideo({
        phase: videoJobPhase,
        checkInFlight: videoRecheckInFlightRef.current,
        msSinceLastCheck: last === null ? null : Date.now() - last,
      })
    ) {
      return;
    }
    lastVideoRecheckAtRef.current = Date.now();
    videoRecheckInFlightRef.current = true;
    void checkVideoJobNow()
      .catch(() => {
        // A read that cannot reach the server changes NOTHING: the card keeps
        // the phase it had and the next foreground asks again. A background
        // refresh must never be what shows the host an error.
      })
      .finally(() => {
        videoRecheckInFlightRef.current = false;
      });
  }, [checkVideoJobNow, videoJobPhase]);

  // Read through a ref so the listener is installed once and removed once,
  // instead of re-subscribing on every phase change.
  const recheckVideoJobRef = useRef(recheckVideoJob);
  recheckVideoJobRef.current = recheckVideoJob;
  useEffect(() => {
    // The web has no React Native AppState lifecycle; there the phase effect
    // below is the whole coverage. Same `Platform.OS` shape as the app's other
    // foreground listeners (see `OtaAcknowledgementLayer`).
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") recheckVideoJobRef.current();
    });
    return () => subscription.remove();
  }, []);

  // The sheet opening on — or landing on — a server-owned phase asks once too,
  // so a reopen settles a finished job without waiting for a backgrounding that
  // may never come. `recheckVideoJob`'s identity changes only with the PHASE, so
  // the watch's per-poll percent updates cannot re-fire this.
  useEffect(() => {
    recheckVideoJob();
  }, [recheckVideoJob]);

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
      videoUpload.resetAppliedPreview();
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
    [brandCover, disabled, emitChange, localCover.coverMediaUrl, onShowToast, showUploadError, target, videoUpload],
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
      videoUpload.resetAppliedPreview();
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
    [brandCover, disabled, emitChange, localCover.coverMediaUrl, onShowToast, showUploadError, target, videoUpload],
  );

  const handleRemoveCover = useCallback((): void => {
    if (disabled) return;
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setMediaDisplayError(null);
    setRenderFailures(0);
    setPickRefusal(null);
    // issue #1338 — removing the cover clears any lingering video-flow notice.
    setVideoPickNotice(null);
    // #3040 H-17 — "This also stops the video that's uploading." A running
    // job would otherwise land on top of the cover the host just removed.
    if (lockedVideoOperation) {
      void videoUpload.cancel().catch(() => {
        onShowToast("Could not cancel video upload. Try again.");
      });
    }
    videoUpload.resetAppliedPreview();
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
  }, [disabled, emitChange, lockedVideoOperation, onShowToast, setVideoPickNotice, videoUpload]);

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
      // #3040 B-C16 [A-16] / design H-16 — the SAVED cover's preview failed.
      // The cover itself is still saved; say so, with copy that fits a video,
      // and offer "Load preview again" (it used to blame the file and suggest
      // "another image or GIF" for a video, with no retry at all).
      setReloadingPreview(false);
      setRenderFailures((count) => count + 1);
      reportCoverPreviewRenderError(event.mediaUrl, event.mediaType);
    },
    [activeVideoUpload, videoUpload.localPreviewUri],
  );
  // H-16 — remount the player with a fresh key (the PREVIEW only, never the
  // stored URL). No new error within 8 s means it loaded.
  const reloadPreview = useCallback((): void => {
    setReloadingPreview(true);
    setPreviewKey((key) => key + 1);
    if (reloadTimerRef.current !== null) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      setReloadingPreview((stillReloading) => {
        if (stillReloading) setRenderFailures(0);
        return false;
      });
    }, RELOAD_PREVIEW_MAX_MS);
  }, []);

  const switchTab = useCallback((tab: CoverTabId): void => {
    tickHaptic();
    setActiveTab(tab);
    setQuery("");
  }, []);

  const columns = isWideDesktop ? 3 : 2;

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
      {mediaMode === "all" ? <View style={styles.tabTrack} accessibilityRole="tablist">
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
      </View> : null}

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
      {/* issue #3319 — only on hosts that save the gallery (`galleryEnabled`).
          Hidden, the provider target stays "cover", its default. */}
      {galleryEnabled && (activeTab === "gif" || activeTab === "stock") ? (
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
          coverKind={coverKind}
          hue={initialCoverHue}
          activeMedia={activeMedia}
          posterUrl={activeMedia.isNewClip ? null : localCover.coverMediaPosterUrl}
          alt={localCover.coverMediaAlt}
          credit={selectedCredit}
          // issue #3280 — the cover buttons are cover actions, so an in-flight
          // gallery upload makes them busy too.
          uploading={uploading || galleryUploading}
          // issue #3318 / #3073 — spinners: the cover's own image upload, and a
          // video pick in progress.
          spinning={uploading && coverUploadKind === "image"}
          videoSpinning={uploading && coverUploadKind === "video"}
          jobActive={lockedVideoOperation}
          videoStage={projectedVideoStage}
          videoStatus={videoUpload.status}
          cardModel={cardModel}
          statusRow={statusRow}
          phaseStartedAt={phaseStartedAt}
          videoOnly={mediaMode === "video-only"}
          disabled={disabled}
          renderError={renderFailures > 0 && activeMediaUrl !== null && !activeMedia.isNewClip
            ? { failures: renderFailures, reloading: reloadingPreview }
            : null}
          previewKey={previewKey}
          onPickImage={() => { void pickImageOrGifCover(); }}
          onPickVideo={() => {
            void pickVideoCover();
          }}
          onRemove={handleRemoveCover}
          onCardAction={handleCardAction}
          onConfirmCancel={cancelVideoCoverUpload}
          onConfirmSwap={() => { void pickVideoCover(true); }}
          onReloadPreview={reloadPreview}
          onMediaError={handleMediaRenderError}
          videoPickNotice={videoPickNotice}
          nudgeSignal={offlineNudge}
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
      {/* issue #3319 — only on hosts that save `coverGallery`. Everywhere else
          a photo added here uploaded and was silently never saved. */}
      {galleryEnabled ? (
        <AdditionalPhotosSection
          gallery={gallery}
          // issue #3318 — photos uploading or failed, after the saved ones.
          tiles={galleryTiles}
          onRetryTile={(key) => {
            void retryGalleryPhoto(key);
          }}
          onRemoveTile={removeGalleryTile}
          max={GALLERY_MAX}
          // issue #3280 — the cap is the section's own business (it hides the add
          // tile), so the gate is asked only about the two host-level blocks.
          disabled={!canAddGalleryPhoto({ galleryUploading, disabled, atCap: false })}
          addBlockedReason={galleryAddBlockedReason({ galleryUploading, disabled, atCap: false })}
          // issue #3280 — Make cover is a cover action and keeps the video lock,
          // so it gets its OWN gate; the shared `disabled` above deliberately
          // cannot see video state (Add / Move / Remove stay usable).
          makeCoverDisabled={!canMakeGalleryPhotoCover(makeCoverGate)}
          makeCoverBlockedReason={galleryMakeCoverBlockedReason(makeCoverGate)}
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
      ) : null}
    </View>
  );
};

// ----- Library tab (preview + status/upload card + actions + limits) ------
//
// #3040 B-C15 — the approved design's Host cover sheet (Appendix A §2–§5).
// Hierarchy: preview (what guests see now) → status row OR upload card (what
// is happening) → actions (what can I do) → limits. Copy, states and actions
// come from the pure `coverUploadCardModel` / `coverPickerActionLabels`
// rules, so they are tested without mounting this file.

// issue #3040 — mirrors `autoApplyEventCover` in
// `supabase/functions/event-cover-video-webhook/index.ts`. If this predicate
// and that gate ever disagree, the sheet starts lying again.
const coverVideoFinishesWithoutYou = (
  status: EventCoverVideoStatus | null,
): boolean =>
  status !== null && status.targetKind === "event" &&
  status.applyMode === "draft_auto";

// orch-0776a — the card's ONE truthful percent. The provider's encode % only
// when it reports a real value; upload % is server-confirmed and held below
// 100 by the hook; nothing here is fabricated.
const videoProjectionCopy = (
  stage: EventCoverVideoUploadStage,
  _status: EventCoverVideoStatus | null,
): { percent: number | null } => {
  switch (stage.phase) {
    case "processing":
      return { percent: stage.percent !== null && stage.percent > 0 ? stage.percent : null };
    case "reattaching":
      return { percent: null };
    case "compressing":
    case "uploading":
      return { percent: stage.percent };
    default:
      return { percent: null };
  }
};

/** A 3-high stepper: Optimize → Check → Upload → Finish (web: no Optimize). */
const UploadStepper: React.FC<{ steps: readonly UploadStep[]; current: UploadStep }> = ({ steps, current }) => {
  const currentIndex = steps.indexOf(current);
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityLabel={`Step ${currentIndex + 1} of ${steps.length}: ${STEP_LABEL[current]}`}
    >
      {steps.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "now" : "todo";
        return (
          <View key={step} style={styles.stepperColumn}>
            {/* #3040 §10 — the current segment fills from the left (260 ms). */}
            <View style={[styles.stepperBar, state === "now" ? styles.stepperBarTodo : null]}>
              <StepperSegmentFill
                active={state === "now"}
                style={[
                  styles.stepperBarFill,
                  state === "now" ? styles.stepperBarNow : state === "done" ? styles.stepperBarDone : styles.stepperBarTodo,
                ]}
              />
            </View>
            <Text
              style={[
                styles.stepperLabel,
                state === "now" ? styles.stepperLabelNow : state === "done" ? styles.stepperLabelDone : styles.stepperLabelTodo,
              ]}
            >
              {STEP_LABEL[step]}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

/** Indeterminate bar: a 32%-wide segment sweeping on a 1400 ms loop. */
const IndeterminateTrack: React.FC = () => {
  const sweep = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (alive) setReduceMotion(enabled); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== "web" }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep]);
  return (
    <View
      style={styles.progressTrack}
      accessibilityRole="progressbar"
      accessibilityLabel="Video upload progress"
      accessibilityValue={{ text: "In progress" }}
    >
      {reduceMotion ? (
        <View style={[styles.progressFill, styles.progressFillStatic]} />
      ) : (
        <Animated.View
          style={[
            styles.progressSegment,
            {
              transform: [{
                translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-120, 320] }),
              }],
            },
          ]}
        />
      )}
    </View>
  );
};

type ConfirmKind = "cancel" | "swap" | "remove" | "remove_ad";

/** H-17 / H-18 / stop-upload confirms, inline (a second native modal is dropped on iOS). */
const InlineConfirm: React.FC<{
  kind: ConfirmKind;
  hasCover: boolean;
  jobActive: boolean;
  videoOnly: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}> = ({ kind, hasCover, jobActive, videoOnly, onKeep, onConfirm }) => {
  const copy = kind === "cancel"
    ? {
      title: "Stop this upload?",
      body: hasCover ? "Your current cover stays." : "Nothing will be added.",
      keep: "Keep uploading",
      act: "Stop upload",
      variant: "destructive" as const,
    }
    : kind === "swap"
      ? videoOnly
        ? {
          title: "Swap this ad video?",
          body: "We'll stop preparing this one and use the new one instead. Nothing has been sent to ad platforms.",
          keep: "Keep this one",
          act: "Choose another video",
          variant: "primary" as const,
        }
        : {
          title: "Swap the video that's uploading?",
          body: "We'll stop the current upload and start the new one. Your current cover stays until the new video is ready.",
          keep: "Keep uploading",
          act: "Choose another video",
          variant: "primary" as const,
        }
      : kind === "remove_ad"
        ? {
          title: "Remove this ad video?",
          body: "The ad won't have a video until you add one.",
          keep: "Keep video",
          act: "Remove video",
          variant: "destructive" as const,
        }
        : {
          title: "Remove this cover?",
          body: `Guests will see a plain colour until you add a new one.${jobActive ? " This also stops the video that's uploading." : ""}`,
          keep: "Keep cover",
          act: "Remove cover",
          variant: "destructive" as const,
        };
  return (
    <View
      style={[styles.uploadCard, Platform.OS === "android" && styles.uploadCardAndroid]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.uploadCardTitle}>{copy.title}</Text>
      <Text style={[styles.uploadCardBody, styles.confirmBody]}>{copy.body}</Text>
      <View style={styles.uploadCardActions}>
        <Button label={copy.keep} variant="secondary" size="md" onPress={onKeep} />
        <Button
          label={copy.act}
          variant={copy.variant}
          size="md"
          onPress={onConfirm}
          {...(copy.variant === "primary" ? { accentColor: accent.warm, labelStyle: styles.darkInkLabel, iconColor: canvas.depth } : {})}
        />
      </View>
    </View>
  );
};

/** H-01…H-03, H-15, AD-01, AD-04 — what the saved cover is, in one line. */
const CoverStatusRow: React.FC<{ row: StatusRowModel }> = ({ row }) => (
  <View style={styles.statusRow} accessible accessibilityLiveRegion="polite">
    <View
      style={[
        styles.statusIcon,
        row.tone === "ok" ? styles.statusIconOk : row.tone === "warning" ? styles.statusIconWarn : styles.statusIconNeutral,
      ]}
    >
      <Icon
        name={row.tone === "ok" ? "check" : row.tone === "warning" ? "shield" : "plus"}
        size={16}
        color={row.tone === "ok" ? canvas.depth : row.tone === "warning" ? semantic.warning : textTokens.secondary}
      />
    </View>
    <View style={styles.statusText}>
      <Text style={styles.uploadCardTitle}>{row.title}</Text>
      <Text style={styles.uploadCardBody}>{row.body}</Text>
    </View>
  </View>
);

/** H-04…H-14, H-19, H-20, AD-03, AD-05, AD-06 — the upload card. */
const VideoUploadCard: React.FC<{
  model: UploadCardModel;
  stage: EventCoverVideoUploadStage;
  status: EventCoverVideoStatus | null;
  phaseStartedAt: number;
  /** #3040 H-10 — bumps when "Resume upload" is tapped while still offline. */
  nudgeSignal: number;
  onAction: (id: CardActionId) => void;
}> = ({ model, stage, status, phaseStartedAt, nudgeSignal, onAction }) => {
  const copy = videoProjectionCopy(stage, status);
  const reduceMotion = useReduceMotion();
  const titleRef = useRef<Text>(null);
  const elapsedAnchor = model.elapsedFrom === "sourceUploaded"
    ? status?.sourceUploadedAt ?? status?.createdAt ?? null
    : model.elapsedFrom === "stage"
      ? new Date(phaseStartedAt).toISOString()
      : null;
  const elapsed = useElapsedSince(elapsedAnchor, model.elapsedFrom !== "none");
  const showElapsed = elapsed !== null && (model.elapsedFrom !== "stage" || Date.now() - phaseStartedAt >= 3_000);
  const determinate = model.progress.kind === "determinate" && copy.percent !== null;
  // #3040 §11 — the polite region announces the title on a phase change and
  // the % only at 25/50/75/100; the ticking %, meta and timer stay silent.
  const percentStep = announceBucket(determinate ? copy.percent : null);
  const announcement = uploadAnnouncement(model.title, determinate ? copy.percent : null);
  useIosAnnouncement(announcement);
  useFocusOnAlertEntry(titleRef, model.stateId, model.role === "alert");
  const bytes = stage.phase === "uploading"
    ? { confirmed: stage.confirmedBytes ?? null, total: stage.totalBytes ?? null }
    : { confirmed: null, total: null };
  const titleColor = model.tone === "warning" ? semantic.warning : model.tone === "error" ? semantic.errorText : textTokens.primary;
  return (
    <NudgeOnSignal signal={model.stateId === "H-10" ? nudgeSignal : 0}>
    <View
      style={[
        styles.uploadCard,
        Platform.OS === "android" && styles.uploadCardAndroid,
        model.tone === "warning" && styles.uploadCardWarn,
        model.tone === "error" && styles.uploadCardError,
      ]}
      accessible={false}
      accessibilityRole={model.role === "alert" ? "alert" : undefined}
    >
      <View style={styles.uploadCardHeader}>
        <View style={[styles.uploadThumb, model.stateId === "H-12" && styles.uploadThumbGone]}>
          <Icon
            name={model.tone === "error" ? "x" : model.stateId === "H-12" ? "upload" : "play"}
            size={18}
            color={model.tone === "error" ? semantic.errorText : textTokens.primary}
          />
        </View>
        {/* #3040 §11 — the polite region: the title (a phase change) plus a
            hidden "{n} percent" that changes only at 25/50/75/100. */}
        <View style={styles.uploadCardHeaderText} accessibilityLiveRegion="polite" aria-live="polite">
          {/* #3040 §10 — the title crossfades on a phase change (120 ms). */}
          <FadeOnChange
            swapKey={model.title}
            durationMs={MOTION_SPEC.cardTitle.durationMs}
            reducedMs={MOTION_SPEC.cardTitle.reducedMs}
            animateInitial={false}
          >
            <Text ref={titleRef} style={[styles.uploadCardTitle, { color: titleColor }]} accessibilityRole="header">{model.title}</Text>
          </FadeOnChange>
          {model.sub !== null ? <Text style={styles.uploadCardSub}>{model.sub}</Text> : null}
          {percentStep !== null ? <Text style={styles.srOnly}>{`${percentStep} percent`}</Text> : null}
        </View>
        {determinate && copy.percent !== null ? (
          <Text style={styles.uploadCardPercent} accessibilityElementsHidden importantForAccessibility="no">{Math.round(copy.percent)}%</Text>
        ) : showElapsed ? (
          // Hidden from assistive tech: the card is a polite live region, and a
          // value that changes every second would re-announce it every second.
          <Text style={styles.uploadCardElapsed} accessibilityElementsHidden importantForAccessibility="no">{elapsed}</Text>
        ) : model.progress.kind === "indeterminate" ? (
          <ActivityIndicator color={textTokens.secondary} accessibilityLabel={model.title} />
        ) : null}
      </View>
      {determinate && copy.percent !== null ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={stage.phase === "processing" ? "Video preparation progress" : "Video upload progress"}
          accessibilityValue={{ min: 0, now: Math.round(copy.percent), max: 100, text: progressValueText(copy.percent, bytes.confirmed, bytes.total) }}
          style={styles.progressTrack}
        >
          {/* #3040 §10 — eases to the new value (200 ms); reduced motion jumps. */}
          {reduceMotion ? (
            <View style={[styles.progressFill, { transform: [{ scaleX: copy.percent / 100 }] }]} />
          ) : (
            <AnimatedProgressFill fraction={copy.percent / 100} style={styles.progressFill} />
          )}
        </View>
      ) : model.progress.kind === "frozen" ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Video upload progress"
          accessibilityValue={{ min: 0, now: model.progress.percent, max: 100, text: `Paused at ${model.progress.percent} percent` }}
          style={styles.progressTrack}
        >
          <View style={[styles.progressFill, styles.progressFillFrozen, { transform: [{ scaleX: model.progress.percent / 100 }] }]} />
        </View>
      ) : model.progress.kind === "indeterminate" ? (
        <IndeterminateTrack />
      ) : null}
      {model.meta !== null ? (
        <Text style={styles.uploadCardMeta} accessibilityElementsHidden importantForAccessibility="no">{model.meta}</Text>
      ) : null}
      <Text style={styles.uploadCardBody}>{model.body}</Text>
      {model.steps !== null && model.currentStep !== null ? (
        <UploadStepper steps={model.steps} current={model.currentStep} />
      ) : null}
      {model.actions.length > 0 ? (
        <View style={styles.uploadCardActions}>
          {model.actions.map((cardAction) => (
            <Button
              key={cardAction.id}
              label={cardAction.label}
              variant={cardAction.variant}
              size="md"
              onPress={() => onAction(cardAction.id)}
              {...(cardAction.variant === "primary" ? { accentColor: accent.warm, labelStyle: styles.darkInkLabel, iconColor: canvas.depth } : {})}
            />
          ))}
        </View>
      ) : null}
    </View>
    </NudgeOnSignal>
  );
};

/**
 * issue #1338 — in-sheet cover-VIDEO feedback (cancel/over-cap/failure/added).
 * Renders INSIDE CoverPickerSheet's Sheet — a plain View/Text, NOT a native
 * <Modal>, so iOS never drops it while the sheet is up.
 */
const VideoPickNoticeRow: React.FC<{ notice: NativeEditorNotice | null }> = ({ notice }) =>
  notice === null ? null : (
    <View style={styles.videoNoticeRow}>
      <Text
        accessibilityRole="alert"
        style={notice.tone === "error" ? styles.mediaErrorText : styles.videoNoticeInfoText}
      >
        {notice.text}
      </Text>
    </View>
  );

const LibraryTab: React.FC<{
  coverKind: CoverKind;
  hue: number;
  activeMedia: ActiveMedia;
  posterUrl: string | null;
  alt: string | null;
  credit: string | null;
  /** Disables the cover buttons: a cover upload OR a gallery photo upload. */
  uploading: boolean;
  /** issue #3318 — the photo button's spinner: the cover's own image upload only. */
  spinning: boolean;
  /** Issue #3073 — the video button's spinner: a video pick in progress. */
  videoSpinning: boolean;
  jobActive: boolean;
  videoStage: EventCoverVideoUploadStage;
  videoStatus: EventCoverVideoStatus | null;
  cardModel: UploadCardModel | null;
  statusRow: StatusRowModel;
  phaseStartedAt: number;
  videoOnly: boolean;
  disabled: boolean;
  renderError: { failures: number; reloading: boolean } | null;
  previewKey: number;
  onPickImage: () => void;
  onPickVideo: () => void;
  onRemove: () => void;
  onCardAction: (id: CardActionId) => void;
  onConfirmCancel: () => void;
  onConfirmSwap: () => void;
  onReloadPreview: () => void;
  onMediaError: (e: EventCoverMediaErrorEvent) => void;
  // issue #1338 — in-sheet feedback for the cover-VIDEO flow (never a root Toast).
  videoPickNotice: NativeEditorNotice | null;
  /** #3040 H-10 — bumps when "Resume upload" is tapped while still offline. */
  nudgeSignal: number;
}> = ({
  coverKind,
  hue,
  activeMedia,
  posterUrl,
  alt,
  credit,
  uploading,
  spinning,
  videoSpinning,
  jobActive,
  videoStage,
  videoStatus,
  cardModel,
  statusRow,
  phaseStartedAt,
  videoOnly,
  disabled,
  renderError,
  previewKey,
  onPickImage,
  onPickVideo,
  onRemove,
  onCardAction,
  onConfirmCancel,
  onConfirmSwap,
  onReloadPreview,
  onMediaError,
  videoPickNotice,
  nudgeSignal,
}) => {
  const [confirming, setConfirmingState] = useState<ConfirmKind | null>(null);
  const [sheetWidth, setSheetWidth] = useState(0);
  const reduceMotion = useReduceMotion();
  const { fontScale } = useWindowDimensions();
  // #3040 §10 — actions ↔ inline confirm swap with a 200 ms layout ease.
  const setConfirming = (kind: ConfirmKind | null): void => {
    animateInlineConfirmSwap(reduceMotion);
    setConfirmingState(kind);
  };
  // #3040 §10 H-15 — the new cover crossfades in and the badge pops, once per
  // applied job (latched, so the 3 s return to H-03 does not replay it).
  const appliedSwapRef = useRef<string | null>(null);
  if (statusRow.stateId === "H-15" && activeMedia.url !== null) appliedSwapRef.current = `h15:${activeMedia.url}`;
  // The selected ring + badge mean "this cover is applied": never while a
  // video job is still deciding what the cover will be.
  const activeVideoUpload = jobActive;
  const twoUpWidth = sheetWidth >= bpRegular;
  const hasCover = coverKind !== "empty";
  const needsAction = cardModel?.needsAction === true;
  const coverActions = resolveCoverActions(coverKind, jobActive, needsAction, videoOnly);
  // #3040 §3 Dynamic Type — two-up falls back to stacked if a label would truncate.
  const wide = twoUpWidth && !prefersStackedActions({
    wide: twoUpWidth,
    fontScale,
    sheetWidth,
    longestLabelChars: Math.max(0, ...coverActions.actions.map((item) => item.label.length)),
  });
  // Cancel is immediate while nothing has left the phone (H-04/H-05); from the
  // upload on it asks first ("Stop this upload?").
  const handleCardAction = (id: CardActionId): void => {
    if (id === "choose_different") {
      setConfirming("swap");
      return;
    }
    if (id === "cancel_upload" || (id === "cancel" && !["compressing", "picking", "reading", "validating", "preparing"].includes(videoStage.phase))) {
      setConfirming("cancel");
      return;
    }
    onCardAction(id);
  };
  const pill = activeMedia.isNewClip
    ? videoOnly ? "New ad video · preparing" : "New video · not live yet"
    : !hasCover
      ? null
      : jobActive
        ? "Current cover"
        : coverKind === "video" ? "Current video cover" : "Current photo cover";
  const previewLabel = coverKind === "video" ? "Current video cover" : coverKind === "photo" ? "Current photo cover" : "No cover yet";
  return (
    <View onLayout={(event) => setSheetWidth(event.nativeEvent.layout.width)}>
      <View
        style={[
          styles.coverPreview,
          hasCover && !activeVideoUpload && styles.coverPreviewSelected,
          activeMedia.isNewClip && styles.coverPreviewDimmed,
          renderError !== null && styles.coverPreviewDimmed,
        ]}
        accessible
        accessibilityLabel={previewLabel}
      >
        <FadeOnChange
          swapKey={appliedSwapRef.current ?? "steady"}
          durationMs={MOTION_SPEC.coverSwap.durationMs}
          reducedMs={MOTION_SPEC.coverSwap.reducedMs}
          animateInitial={false}
        >
          <EventCoverMedia
            key={previewKey}
            hue={hue}
            mediaUrl={activeMedia.url}
            mediaType={activeMedia.type as EventCoverMediaType | null}
            posterUrl={posterUrl}
            radius={radiusTokens.md}
            label={alt ?? "cover"}
            height={twoUpWidth ? coverUpload.previewHeightWide : coverUpload.previewHeightCompact}
            onMediaError={onMediaError}
            muted={true}
            showAudioControl={activeMedia.type === "video"}
          >
          </EventCoverMedia>
        </FadeOnChange>
        {!hasCover && !activeMedia.isNewClip ? (
          <View style={styles.previewEmptyLabel} pointerEvents="none">
            <Text style={styles.previewEmptyText}>No cover yet</Text>
          </View>
        ) : null}
        {pill !== null ? (
          <View style={[styles.previewPill, Platform.OS === "android" && styles.previewPillAndroid]} pointerEvents="none">
            <View style={[styles.previewPillDot, activeMedia.isNewClip || jobActive ? styles.previewPillDotNew : styles.previewPillDotCurrent]} />
            <Text style={styles.previewPillText}>{pill}</Text>
          </View>
        ) : null}
        {renderError !== null ? (
          <View style={styles.previewErrorOverlay} pointerEvents="none">
            <Icon name="swap" size={22} color={textTokens.primary} />
            <Text style={styles.previewEmptyText}>Preview didn&apos;t load</Text>
          </View>
        ) : null}
        {/* META-ORCH-1059: a check badge on the live preview signals the current
            cover is applied (decorative — the pill and label carry the state). */}
        {hasCover && !activeVideoUpload ? (
          <PopOnSignal signal={appliedSwapRef.current} style={styles.selectedBadge}>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name="check" size={14} color={textTokens.inverse} />
            </View>
          </PopOnSignal>
        ) : null}
      </View>
      {credit !== null ? <Text style={styles.creditText}>{credit}</Text> : null}

      {confirming !== null ? (
        <FadeOnChange
          swapKey={confirming}
          durationMs={MOTION_SPEC.inlineConfirm.durationMs}
          reducedMs={MOTION_SPEC.inlineConfirm.reducedMs}
        >
          <InlineConfirm
            kind={confirming}
            hasCover={hasCover}
            jobActive={jobActive}
            videoOnly={videoOnly}
            onKeep={() => setConfirming(null)}
            onConfirm={() => {
              const kind = confirming;
              setConfirming(null);
              if (kind === "cancel") onConfirmCancel();
              else if (kind === "swap") onConfirmSwap();
              else onRemove();
            }}
          />
        </FadeOnChange>
      ) : renderError !== null ? (
        <View style={[styles.uploadCard, Platform.OS === "android" && styles.uploadCardAndroid, styles.uploadCardWarn]} accessibilityLiveRegion="polite">
          <Text style={[styles.uploadCardTitle, { color: semantic.warning }]}>
            {resolveRenderErrorCopy(coverKind === "video" ? "video" : "photo", renderError.failures).title}
          </Text>
          <Text style={styles.uploadCardBody}>
            {resolveRenderErrorCopy(coverKind === "video" ? "video" : "photo", renderError.failures).body}
          </Text>
          <View style={styles.uploadCardActions}>
            <Button
              label="Load preview again"
              variant="secondary"
              size="md"
              loading={renderError.reloading}
              onPress={onReloadPreview}
            />
          </View>
        </View>
      ) : null}
      {/* #3040 §10 — the upload card rises in (260 ms) and fades out (180 ms). */}
      {confirming === null && renderError === null ? (
        <CardPresence visible={cardModel !== null}>
          {cardModel !== null ? (
            <VideoUploadCard
              model={cardModel}
              stage={videoStage}
              status={videoStatus}
              phaseStartedAt={phaseStartedAt}
              nudgeSignal={nudgeSignal}
              onAction={handleCardAction}
            />
          ) : null}
        </CardPresence>
      ) : null}
      {confirming === null && renderError === null && cardModel === null ? (
        <CoverStatusRow row={statusRow} />
      ) : null}

      <VideoPickNoticeRow notice={videoPickNotice} />

      {coverActions.showActions && confirming === null ? (
        <View style={[styles.actionColumn, wide && styles.actionGrid]}>
          {coverActions.actions.map((coverAction) => (
            <Button
              key={coverAction.label}
              label={coverAction.label}
              leadingIcon={coverAction.icon}
              variant={coverAction.primary ? "primary" : "secondary"}
              size="lg"
              shape="square"
              fullWidth={!wide}
              onPress={coverAction.opens === "video" ? onPickVideo : onPickImage}
              loading={coverAction.opens === "video" ? videoSpinning : spinning}
              disabled={uploading || disabled}
              accessibilityLabel={coverAction.label}
              accessibilityHint={coverAction.hint}
              style={wide ? styles.actionGridItem : undefined}
              // #3040 D3 (Seth, Q1) — dark ink on the flat orange: 6.87:1.
              {...(coverAction.primary ? { accentColor: accent.warm, labelStyle: styles.darkInkLabel, iconColor: canvas.depth } : {})}
            />
          ))}
        </View>
      ) : null}

      {coverActions.showRemove && confirming === null ? (
        <Button
          label={coverActions.removeLabel}
          leadingIcon="trash"
          variant="ghost"
          size="md"
          onPress={() => setConfirming(videoOnly ? "remove_ad" : "remove")}
          disabled={disabled || uploading}
          accessibilityLabel={coverActions.removeLabel}
          accessibilityHint="Asks before removing."
          style={styles.removeButton}
          labelStyle={styles.removeLabel}
        />
      ) : null}

      <View style={styles.limitsBlock}>
        {coverLimitsLines(coverKind, videoOnly).map((line, index) => (
          <Text key={line} style={[styles.uploadLimitText, index > 0 && styles.limitsSecondLine]}>{line}</Text>
        ))}
      </View>
    </View>
  );
};

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
  /**
   * issue #3318 — photos uploading or failed. Rendered after the saved photos,
   * from their local files; a failed one keeps Retry and Remove.
   */
  tiles: readonly GalleryPhotoTile[];
  onRetryTile: (key: string) => void;
  onRemoveTile: (key: string) => void;
  max: number;
  disabled: boolean;
  /**
   * issue #3280 — why the add tile is unavailable, when it is. The section
   * cannot work this out on its own (it sees one merged `disabled` boolean),
   * and a disabled control with no explanation is the dead tap this issue is
   * about. Null whenever adding is allowed.
   */
  addBlockedReason: string | null;
  /**
   * issue #3280 — "Make cover" (and the OQ-3 confirm's Replace) is a COVER
   * action, gated separately from `disabled`: it stays locked while a cover
   * video job owns the cover, while Add / Move / Remove do not.
   */
  makeCoverDisabled: boolean;
  /** Why Make cover is unavailable, when it is. Null whenever it is allowed. */
  makeCoverBlockedReason: string | null;
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
  tiles,
  onRetryTile,
  onRemoveTile,
  max,
  disabled,
  addBlockedReason,
  makeCoverDisabled,
  makeCoverBlockedReason,
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
  // issue #3318 — an uploading or failed photo holds its slot.
  const atCap = gallery.length + tiles.length >= max;
  const photoUploading = tiles.some((tile) => tile.status === "uploading");
  const latestFailure = [...tiles].reverse().find((tile) => tile.status === "failed") ?? null;

  return (
    <View style={styles.gallerySection} testID="cover-additional-photos">
      <View style={styles.galleryHeaderRow}>
        <Text style={styles.galleryHeader}>Additional photos</Text>
        {/* issue #3318 — the section's OWN busy state. The cover's Replace
            button used to spin for a photo add instead. */}
        {photoUploading ? (
          <View
            style={styles.galleryBusy}
            accessibilityRole="progressbar"
            accessibilityLabel="Uploading photo"
            testID="cover-gallery-uploading"
          >
            <ActivityIndicator size="small" color={textTokens.secondary} />
            <Text style={styles.galleryBusyLabel}>Uploading photo…</Text>
          </View>
        ) : null}
      </View>
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
          {/* issue #3280 — the confirm can stay open while a replacement video
              starts. Replace is then locked like Make cover, and the banner
              says why in text: Button has no accessibilityHint, and a dimmed
              Replace with no explanation is a dead tap. */}
          {makeCoverDisabled && makeCoverBlockedReason !== null ? (
            <Text style={styles.confirmBannerReason} testID="cover-make-cover-confirm-reason">
              {makeCoverBlockedReason}
            </Text>
          ) : null}
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
              disabled={makeCoverDisabled}
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
                    // issue #3280 — its own gate, never the shared `disabled`,
                    // which no longer sees the cover video lock.
                    disabled={makeCoverDisabled}
                    accessibilityHint={
                      makeCoverDisabled
                        ? makeCoverBlockedReason ?? "The cover cannot be changed right now."
                        : "Use this photo as your cover."
                    }
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

        {/* issue #3318 — a picked photo is a tile from the moment it is picked.
            Uploading: its local file under a spinner. Failed: dimmed, with
            Retry (the same file) and Remove. Never silently discarded. */}
        {tiles.map((tile, index) => {
          const position = gallery.length + index + 1;
          return tile.status === "uploading" ? (
            <View
              key={tile.key}
              style={styles.galleryTileWrap}
              testID="cover-gallery-pending-tile"
            >
              <Image
                source={{ uri: tile.localUri }}
                style={styles.galleryTile}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                accessibilityLabel={`Extra photo ${position}, uploading`}
              />
              <View style={styles.galleryTileOverlay} pointerEvents="none">
                <ActivityIndicator color={textTokens.inverse} />
              </View>
            </View>
          ) : (
            <View
              key={tile.key}
              style={styles.galleryTileWrap}
              testID="cover-gallery-failed-tile"
            >
              <Image
                source={{ uri: tile.localUri }}
                style={[styles.galleryTile, styles.galleryTileFailed]}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                accessibilityLabel={`Extra photo ${position}, not added. ${tile.message ?? ""}`}
              />
              <View style={styles.galleryTileOverlay} pointerEvents="none">
                <Icon name="close" size={16} color={textTokens.inverse} />
                <Text style={styles.galleryTileFailedLabel}>{"Couldn't upload"}</Text>
              </View>
              <View style={styles.galleryMenu}>
                <GalleryMenuItem
                  label="Retry"
                  disabled={disabled}
                  accessibilityHint={
                    disabled
                      ? addBlockedReason ?? "Retry is unavailable right now."
                      : "Upload this photo again."
                  }
                  onPress={() => onRetryTile(tile.key)}
                />
                <GalleryMenuItem
                  label="Remove"
                  disabled={false}
                  destructive
                  accessibilityHint="Remove this photo without adding it."
                  onPress={() => onRemoveTile(tile.key)}
                />
              </View>
            </View>
          );
        })}

        {!atCap ? (
          <Pressable
            onPress={onAdd}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            // issue #3280 — a blocked tile must SAY it is blocked, in pixels and
            // to a screen reader. It used to render fully enabled and do
            // nothing for the whole life of a video upload; the video block is
            // gone, and the busy state that remains is now legible.
            accessibilityHint={
              disabled
                ? addBlockedReason ?? "Adding photos is unavailable right now."
                : "Choose a photo or GIF to show after your cover."
            }
            accessibilityState={{ disabled }}
            testID="cover-add-photo"
            style={({ pressed }) => [
              styles.galleryAddTile,
              disabled && styles.galleryAddTileDisabled,
              pressed && styles.tilePressed,
            ]}
          >
            <Icon name="plus" size={22} color={accent.warm} />
            <Text style={styles.galleryAddLabel}>Add photo</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* issue #3318 — the failure, in photo copy, for as long as the tile is
          there (the toast is gone in seconds). */}
      {latestFailure !== null && latestFailure.message !== null ? (
        <Text
          style={styles.galleryFailureText}
          accessibilityRole="alert"
          testID="cover-gallery-failure-message"
        >
          {latestFailure.message}
        </Text>
      ) : null}
    </View>
  );
};

const GalleryMenuItem: React.FC<{
  label: string;
  disabled: boolean;
  destructive?: boolean;
  /** issue #3280 — e.g. why a disabled item is unavailable. */
  accessibilityHint?: string;
  onPress: () => void;
}> = ({ label, disabled, destructive = false, accessibilityHint, onPress }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="menuitem"
    accessibilityLabel={label}
    accessibilityHint={accessibilityHint}
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
  // #3040 B-C15 — stacked below 600pt of sheet width, two-up at ≥600 (D8).
  actionColumn: {
    gap: spacing.sm,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  actionGridItem: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  removeButton: {
    alignSelf: "center",
    marginTop: spacing.xs,
  },
  removeLabel: {
    color: semantic.errorText,
  },
  darkInkLabel: {
    color: canvas.depth,
  },
  limitsBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    alignItems: "center",
  },
  limitsSecondLine: {
    marginTop: spacing.xs,
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
    textAlign: "center",
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
  // #3040 — upload card (Appendix A §2). Android is opaque
  // (ANDROID_GLASS_USES_OPAQUE_FALLBACK): no translucent fill, no elevation.
  uploadCard: {
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    overflow: "hidden",
  },
  uploadCardAndroid: {
    backgroundColor: ariThread.ariBubbleAndroid,
    borderColor: androidOpaque.rowBorder,
    elevation: 0,
  },
  uploadCardWarn: {
    borderColor: coverUpload.warnBorder,
  },
  uploadCardError: {
    borderColor: coverUpload.errorBorder,
  },
  uploadCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + spacing.xs,
  },
  uploadThumb: {
    width: coverUpload.thumb,
    height: coverUpload.thumb,
    borderRadius: coverUpload.thumbRadius,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadThumbGone: {
    backgroundColor: "#1b1e24",
  },
  uploadCardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  uploadCardTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  uploadCardSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  uploadCardPercent: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  uploadCardElapsed: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  uploadCardMeta: {
    marginTop: spacing.sm,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  uploadCardBody: {
    marginTop: spacing.sm + spacing.xs,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  confirmBody: {
    marginTop: spacing.xs,
  },
  uploadCardActions: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  statusIcon: {
    width: coverUpload.statusIcon,
    height: coverUpload.statusIcon,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  statusIconOk: {
    backgroundColor: semantic.success,
  },
  statusIconWarn: {
    backgroundColor: semantic.warningTint,
  },
  statusIconNeutral: {
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  statusText: {
    flex: 1,
    minWidth: 0,
  },
  stepper: {
    marginTop: 14,
    flexDirection: "row",
    gap: spacing.xs,
  },
  stepperColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  stepperBar: {
    height: coverUpload.stepperBar,
    borderRadius: 999,
    overflow: "hidden",
  },
  stepperBarFill: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },
  // #3040 §11 — a polite live region that is read, never seen.
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  stepperBarNow: { backgroundColor: accent.warm },
  stepperBarDone: { backgroundColor: coverUpload.stepDone },
  stepperBarTodo: { backgroundColor: coverUpload.stepTodo },
  stepperLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: typography.micro.letterSpacing,
  },
  stepperLabelNow: { color: textTokens.primary },
  stepperLabelDone: { color: textTokens.tertiary },
  stepperLabelTodo: { color: textTokens.quaternary },
  progressTrack: {
    marginTop: spacing.sm + spacing.xs,
    height: coverUpload.trackHeight,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: coverUpload.track,
  },
  progressFill: {
    width: "100%",
    height: "100%",
    transformOrigin: "left",
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  progressFillFrozen: {
    backgroundColor: coverUpload.frozenFill,
  },
  progressFillStatic: {
    opacity: 0.45,
  },
  progressSegment: {
    width: "32%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  coverPreviewDimmed: {
    opacity: 0.55,
  },
  previewEmptyLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  previewEmptyText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
  },
  previewErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  previewPill: {
    position: "absolute",
    top: 12,
    left: 12,
    height: coverUpload.pillHeight,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: glass.tint.badge.idle,
    borderWidth: 1,
    borderColor: glass.border.badge,
  },
  previewPillAndroid: {
    backgroundColor: ariThread.ariBubbleAndroid,
    overflow: "hidden",
  },
  previewPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  previewPillDotCurrent: { backgroundColor: semantic.success },
  previewPillDotNew: { backgroundColor: accent.warm },
  previewPillText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
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
  // issue #3318 — header row carrying the section's own busy state.
  galleryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  galleryBusy: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  galleryBusyLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
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
  // issue #3280 — the reason line shown while the confirm's Replace is locked.
  confirmBannerReason: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
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
  // issue #3318 — uploading / failed photo tiles.
  galleryTileOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 96,
    height: 72,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  galleryTileFailed: {
    opacity: 0.5,
  },
  galleryTileFailedLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.inverse,
  },
  galleryFailureText: {
    marginTop: spacing.sm,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
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
  // issue #3280 — the disabled variant the tile never had. Without it the
  // control looked identical enabled and blocked, which is what made the
  // accidental video block invisible instead of merely wrong.
  galleryAddTileDisabled: {
    opacity: 0.45,
  },
  galleryAddLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
});
