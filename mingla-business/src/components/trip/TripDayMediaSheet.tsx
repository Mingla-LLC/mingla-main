/**
 * ORCH-1119 [trip-day-media-gallery] · SPEC §4.5b
 *
 * TripDayMediaSheet — the per-DAY media picker for trips. A COPY-ADAPT of
 * ExperienceStopPhotoSheet (the proven 3-tab Library/GIFs/Photos picker), but
 * TRIPS-ONLY and image+VIDEO:
 *   - Library tab accepts device images AND videos; each chosen asset uploads via
 *     uploadTripDayMedia(brandId, eventId, asset) → onAddMedia(TripDayMedia).
 *   - GIFs (GIPHY) + Photos (Pexels) tabs are unchanged; their provider URLs map
 *     to type:"image" (animated GIF renders fine as an image — OQ-4).
 *   - Cap = MAX_TRIP_DAY_MEDIA (8); remaining-slots gating identical to the model.
 *
 * NOT shared with ExperienceStopPhotoSheet (locked scope: no cross-offering
 * abstraction). Hosted inside the canonical `Sheet` primitive.
 *
 * External-API docs (COMMS-0003): GIPHY/Pexels surfaces are the same service
 * files the experience-stop sheet cites; this sheet adds NO new external API.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Platform,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  coverUpload,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../utils/platformImagePicker";
import {
  pickBrowserFiles,
  revokeBrowserPickedFiles,
  validateBrowserFile,
  type BrowserPickedFile,
} from "../../utils/browserFilePicker";
import { Button } from "../ui/Button";
import {
  uploadTripDayMedia,
  MAX_TRIP_DAY_MEDIA,
  TRIP_DAY_MEDIA_IMAGE_MAX_BYTES,
  TRIP_DAY_MEDIA_VIDEO_MAX_BYTES,
  tripDayVideoErrorCopy,
  type TripDayVideoUploadProgress,
} from "../../services/tripDayMediaService";
import { BrandCoverError } from "../../utils/brandCoverRules";
import { normalizeTripDayImage } from "../../utils/normalizeTripDayImage";
import type { TripDayMedia } from "../../services/tripsService";
import { EventCoverProviderError } from "../../services/eventCoverProviderError";
import { readPickedVideoDurationMs } from "../ui/pickedVideoDuration";
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

// Library tab MIME allowlist (image + video) — matches event_covers bucket.
const LIBRARY_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

type MediaTabId = "library" | "gif" | "stock";
type ProviderStatus = "idle" | "loading" | "populated" | "empty" | "error";

const TAB_DEFS: readonly {
  id: MediaTabId;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
}[] = [
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
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    () => {},
  );
};

export interface TripDayMediaSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string;
  /** The trip's events.id — required for the 2-segment event_covers upload key. */
  eventId: string;
  /** How many media items the day already has — gates remaining selectable slots. */
  currentCount: number;
  /**
   * Append the chosen media item(s) into the day's gallery (max
   * MAX_TRIP_DAY_MEDIA). ORCH-1119 REWORK: takes an ARRAY so a multi-select
   * Library pick appends ALL chosen assets in ONE parent state update. A
   * per-item call inside a tight loop clobbered every selection but the last
   * (the parent's `onChange` rebuilds from the same render-time `days`); a
   * single batched append is immune. Single-item provider picks pass `[media]`.
   */
  onAddMedia: (media: TripDayMedia[]) => void;
  onShowToast: (msg: string) => void;
  /** #3040 B-C12 — the day these items belong to (part of the resume key). */
  dayKey?: string;
}

/** #3040 B-C12 / Appendix A §6 — one tile per picked item, with its own state. */
type TripDayTile = {
  key: string;
  kind: "image" | "video";
  state: "checking" | "uploading" | "preparing" | "done" | "failed";
  percent: number | null;
  durationMs: number | null;
};

const formatTileClock = (ms: number | null): string | null => {
  if (ms === null || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const tileLabel = (tile: TripDayTile, index: number): string => {
  const noun = tile.kind === "video" ? "Video" : "Photo";
  switch (tile.state) {
    case "checking": return `${noun} ${index + 1}, checking file`;
    case "uploading": return tile.percent === null
      ? `${noun} ${index + 1}, uploading. Double tap to cancel.`
      : `${noun} ${index + 1}, uploading, ${tile.percent} percent. Double tap to cancel.`;
    case "preparing": return `${noun} ${index + 1}, preparing`;
    case "done": return `${noun} ${index + 1}${formatTileClock(tile.durationMs) !== null ? `, ${formatTileClock(tile.durationMs)}` : ""}`;
    case "failed": return `${noun} ${index + 1}, upload failed`;
  }
};

export const TripDayMediaSheet: React.FC<TripDayMediaSheetProps> = ({
  visible,
  onClose,
  brandId,
  eventId,
  currentCount,
  onAddMedia,
  onShowToast,
  dayKey,
}) => {
  const remaining = Math.max(0, MAX_TRIP_DAY_MEDIA - currentCount);
  // #3040 B-C12 — per-item tiles while a batch uploads, and each item's own
  // abort so × on one tile never stops the others.
  const [tiles, setTiles] = useState<TripDayTile[]>([]);
  const tileAbortRef = useRef<Map<string, AbortController>>(new Map());
  const updateTile = useCallback((key: string, patch: Partial<TripDayTile>): void => {
    setTiles((current) => current.map((tile) => (tile.key === key ? { ...tile, ...patch } : tile)));
  }, []);
  useEffect(() => () => {
    for (const controller of tileAbortRef.current.values()) controller.abort();
    tileAbortRef.current.clear();
  }, []);
  const [activeTab, setActiveTab] = useState<MediaTabId>("library");
  const [uploading, setUploading] = useState(false);
  const [videoProgress, setVideoProgress] =
    useState<TripDayVideoUploadProgress | null>(null);

  const [query, setQuery] = useState("");
  const [giphyStatus, setGiphyStatus] = useState<ProviderStatus>("idle");
  const [giphyError, setGiphyError] =
    useState<EventCoverProviderError["code"] | null>(null);
  const [giphyResults, setGiphyResults] = useState<GiphyCoverSearchResult[]>([]);
  const [pexelsStatus, setPexelsStatus] = useState<ProviderStatus>("idle");
  const [pexelsError, setPexelsError] =
    useState<EventCoverProviderError["code"] | null>(null);
  const [pexelsResults, setPexelsResults] = useState<PexelsCoverSearchResult[]>(
    [],
  );
  const giphyLoadedRef = useRef(false);
  const pexelsLoadedRef = useRef(false);

  const atCap = remaining <= 0;

  const loadTrending = useCallback(async (): Promise<void> => {
    setGiphyStatus("loading");
    setGiphyError(null);
    try {
      const results = await trendingGiphyCovers({ limit: 24 });
      setGiphyResults(results);
      setGiphyStatus(results.length > 0 ? "populated" : "empty");
      giphyLoadedRef.current = true;
    } catch (error) {
      const code =
        error instanceof EventCoverProviderError
          ? error.code
          : "provider_unavailable";
      setGiphyError(code);
      setGiphyStatus("error");
      warnHaptic();
    }
  }, []);

  const loadCurated = useCallback(async (): Promise<void> => {
    setPexelsStatus("loading");
    setPexelsError(null);
    try {
      const page = await curatedPexelsCovers({ perPage: 20 });
      setPexelsResults(page.photos);
      setPexelsStatus(page.photos.length > 0 ? "populated" : "empty");
      pexelsLoadedRef.current = true;
    } catch (error) {
      const code =
        error instanceof EventCoverProviderError
          ? error.code
          : "provider_unavailable";
      setPexelsError(code);
      setPexelsStatus("error");
      warnHaptic();
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (
      activeTab === "gif" &&
      !giphyLoadedRef.current &&
      query.trim().length === 0
    ) {
      void loadTrending();
    } else if (
      activeTab === "stock" &&
      !pexelsLoadedRef.current &&
      query.trim().length === 0
    ) {
      void loadCurated();
    }
  }, [activeTab, visible, loadCurated, loadTrending, query]);

  const runProviderSearch = useCallback(async (): Promise<void> => {
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
          error instanceof EventCoverProviderError
            ? error.code
            : "provider_unavailable";
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
          error instanceof EventCoverProviderError
            ? error.code
            : "provider_unavailable";
        setPexelsError(code);
        setPexelsStatus("error");
        warnHaptic();
      }
    }
  }, [activeTab, query]);

  const clearSearch = useCallback((): void => {
    setQuery("");
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
  }, [
    activeTab,
    giphyResults.length,
    loadCurated,
    loadTrending,
    pexelsResults.length,
  ]);

  const switchTab = useCallback((tab: MediaTabId): void => {
    tickHaptic();
    setActiveTab(tab);
    setQuery("");
  }, []);

  // ----- Library device upload (image + video) ---------------------------

  const pickFromLibrary = useCallback(async (): Promise<void> => {
    if (uploading || atCap) return;
    let browserFiles: BrowserPickedFile[] = [];
    try {
      let assets: {
        uri: string;
        mimeType?: string | null;
        fileName?: string | null;
        fileSize?: number | null;
        width?: number | null;
        height?: number | null;
        duration?: number | null;
      }[];
      if (Platform.OS === "web") {
        const result = await pickBrowserFiles({
          accept: LIBRARY_ACCEPT,
          maxFiles: remaining,
          multiple: remaining > 1,
          validate: false,
        });
        if (result.canceled || result.files.length === 0) return;
        browserFiles = result.files;
        assets = (await Promise.all(result.files
          .map(async (file) => {
            try {
              // #3040 B-C12 — images keep 25 MB; videos follow the lane's
              // 100 MB contract (shipped together with the compression fix).
              validateBrowserFile(file.file, {
                accept: LIBRARY_ACCEPT,
                maxBytes: file.mimeType?.startsWith("video/")
                  ? TRIP_DAY_MEDIA_VIDEO_MAX_BYTES
                  : TRIP_DAY_MEDIA_IMAGE_MAX_BYTES,
              });
              return {
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.mimeType,
                uri: file.uri,
                duration: file.mimeType?.startsWith("video/")
                  ? await readPickedVideoDurationMs(file.uri)
                  : null,
              };
            } catch {
              return null;
            }
          })))
          .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
        if (assets.length === 0) {
          onShowToast("Choose a photo under 25 MB, or a video up to 1 minute and under 100 MB.");
          return;
        }
        if (assets.length < result.files.length) {
          onShowToast(
            "Some files were skipped. Use a photo under 25 MB, or a video up to 1 minute and under 100 MB.",
          );
        }
      } else {
        const permission = await requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          onShowToast("Photo library permission is needed to add media.");
          return;
        }
        const result = await launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          allowsEditing: false,
          quality: 1,
          allowsMultipleSelection: remaining > 1,
          selectionLimit: remaining,
        });
        if (result.canceled || result.assets.length === 0) return;
        assets = result.assets;
      }
      setUploading(true);
      const batch: TripDayTile[] = assets.slice(0, remaining).map((asset, index) => ({
        key: `${Date.now().toString(36)}-${index}`,
        kind: asset.mimeType?.startsWith("video/") || typeof asset.duration === "number" && asset.duration > 0 ? "video" : "image",
        state: "checking",
        percent: null,
        durationMs: typeof asset.duration === "number" ? asset.duration : null,
      }));
      setTiles(batch);
      // ORCH-1119 REWORK: upload each chosen asset, COLLECT the successes, and
      // hand the parent the whole batch in ONE onAddMedia call. A per-item
      // onAddMedia in this loop clobbered every pick but the last (the parent
      // rebuilds the day from the same stale render-time `days`); a single
      // batched append is clobber-proof. A failed item surfaces a friendly
      // toast and is skipped — partial success is preserved (Constitution #3).
      const uploaded: TripDayMedia[] = [];
      let firstError: string | null = null;
      for (const [assetIndex, asset] of assets.entries()) {
        if (uploaded.length >= remaining) break;
        const tileKey = batch[assetIndex]?.key ?? `tile-${assetIndex}`;
        const tileAbort = new AbortController();
        tileAbortRef.current.set(tileKey, tileAbort);
        try {
          // ORCH-1119C: iPhones shoot HEIC; convert HEIC/HEIF -> JPEG on-device
          // BEFORE upload (the upload service hard-rejects image/heic, and HEIC
          // doesn't render on Android or the public web trip page). jpeg/png/webp/
          // GIF/video pass through unchanged. Native picker only — the web branch
          // above doesn't hand back HEIC the same way.
          const normalized =
            Platform.OS === "web"
              ? asset
              : await normalizeTripDayImage({
                  uri: asset.uri,
                  mimeType: asset.mimeType,
                  fileName: asset.fileName,
                  fileSize: asset.fileSize,
                  width: asset.width,
                  height: asset.height,
                  duration: asset.duration,
                });
          const media = await uploadTripDayMedia(brandId, eventId, {
            uri: normalized.uri,
            mimeType: normalized.mimeType,
            fileName: normalized.fileName,
            fileSize: normalized.fileSize,
            width: normalized.width,
            height: normalized.height,
            durationMs: normalized.duration,
          }, (progress) => {
            setVideoProgress(progress);
            updateTile(tileKey, {
              state: progress.phase === "checking"
                ? "checking"
                : progress.phase === "uploading"
                  ? "uploading"
                  : "preparing",
              percent: progress.phase === "uploading" ? progress.percent : null,
            });
          }, { dayKey, signal: tileAbort.signal });
          uploaded.push(media);
          updateTile(tileKey, { state: "done", percent: null });
          setVideoProgress(null);
        } catch (itemError) {
          updateTile(tileKey, { state: "failed", percent: null });
          // × on a tile is a decision, not a failure to report.
          if (tileAbort.signal.aborted) continue;
          if (firstError === null) {
            // #3040 B-C12 — never a raw code in a toast.
            firstError =
              itemError instanceof BrandCoverError
                ? itemError.message
                : tripDayVideoErrorCopy(itemError);
          }
        } finally {
          tileAbortRef.current.delete(tileKey);
        }
      }
      if (uploaded.length > 0) {
        onAddMedia(uploaded);
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
        }
      }
      // Surface any failure (even on partial success) so nothing fails silently.
      if (firstError !== null) {
        warnHaptic();
        onShowToast(
          uploaded.length > 0
            ? `Some media couldn't be added. ${firstError}`
            : firstError,
        );
      }
      // Close once the batch has resolved — on full success AND on a 0-success
      // batch — so the wizard-root error toast (onShowToast above) is no longer
      // occluded by this native-Modal sheet (Constitution #3). The partial-success
      // toast still fires before this close. Pre-upload throws (catch below) keep
      // the sheet open so the user can retry the picker.
      onClose();
    } catch (error) {
      // Pre-upload failures (permission denied, picker error) — friendly toast.
      onShowToast(
        error instanceof BrandCoverError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Couldn't add that media. Tap to retry.",
      );
    } finally {
      revokeBrowserPickedFiles(browserFiles);
      setVideoProgress(null);
      setTiles([]);
      setUploading(false);
    }
  }, [
    atCap,
    brandId,
    dayKey,
    eventId,
    onAddMedia,
    onClose,
    onShowToast,
    remaining,
    updateTile,
    uploading,
  ]);

  // ----- Provider selection (GIPHY / Pexels) → type:"image" --------------

  const selectGiphy = useCallback(
    (result: GiphyCoverSearchResult): void => {
      if (atCap) return;
      lightHaptic();
      onAddMedia([{ url: result.mediaUrl, type: "image", provider: "giphy" }]);
      onShowToast("GIF added.");
      onClose();
    },
    [atCap, onAddMedia, onClose, onShowToast],
  );

  const selectPexels = useCallback(
    (result: PexelsCoverSearchResult): void => {
      if (atCap) return;
      lightHaptic();
      onAddMedia([{ url: result.mediaUrl, type: "image", provider: "pexels" }]);
      onShowToast("Photo added.");
      onClose();
    },
    [atCap, onAddMedia, onClose, onShowToast],
  );

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.host}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text style={styles.headerTitle}>Add media</Text>
            <Text style={styles.headerSub}>
              {atCap
                ? `This day is full (${MAX_TRIP_DAY_MEDIA} items).`
                : `${remaining} of ${MAX_TRIP_DAY_MEDIA} slots left.`}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close media picker"
            hitSlop={12}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Icon name="close" size={24} color={textTokens.secondary} />
          </Pressable>
        </View>

        {/* Tab bar — Library (image+video) / GIFs / Photos. */}
        <View style={styles.tabTrack} accessibilityRole="tablist">
          {TAB_DEFS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Pressable
                key={tab.id}
                onPress={() => switchTab(tab.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${tab.label} tab`}
                style={[styles.tabSegment, isActive && styles.tabSegmentActive]}
              >
                <Icon
                  name={tab.icon}
                  size={16}
                  color={isActive ? accent.warm : textTokens.tertiary}
                />
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeTab === "gif" || activeTab === "stock" ? (
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
              accessibilityLabel={
                activeTab === "gif" ? "Search GIFs" : "Search photos"
              }
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

        {activeTab === "library" ? (
          <View style={styles.libraryBody}>
            <View style={styles.libraryPreview}>
              <Icon name="grid" size={40} color={textTokens.tertiary} />
              <Text style={styles.libraryHint}>
                {`Add up to ${remaining} more photos or videos. Videos: up to 1 minute, under 100 MB.`}
              </Text>
            </View>
            <Button
              label={atCap ? "Day is full" : "Choose from library"}
              leadingIcon="upload"
              variant="primary"
              size="lg"
              fullWidth
              loading={uploading}
              disabled={uploading || atCap}
              onPress={() => {
                void pickFromLibrary();
              }}
            />
            {tiles.length > 0 ? (
              <View style={styles.dayTileGrid} accessibilityLiveRegion="polite">
                {tiles.map((tile, index) => (
                  <View
                    key={tile.key}
                    style={[styles.dayTile, tile.state === "failed" && styles.dayTileFailed]}
                    accessible
                    accessibilityLabel={tileLabel(tile, index)}
                  >
                    <View style={styles.dayTileScrim}>
                      {tile.state === "uploading" && tile.percent !== null ? (
                        <Text style={styles.dayTileLabel}>{`${tile.percent}%`}</Text>
                      ) : tile.state === "done" ? (
                        <Icon name="check" size={18} color={textTokens.primary} />
                      ) : tile.state === "failed" ? (
                        <>
                          <Icon name="x" size={18} color={semantic.errorText} />
                          <Text style={styles.dayTileLabel}>Can&apos;t use</Text>
                        </>
                      ) : (
                        <>
                          <ActivityIndicator size="small" color={textTokens.primary} />
                          <Text style={styles.dayTileLabel}>
                            {tile.state === "checking" ? "Checking" : tile.state === "uploading" ? "Uploading" : "Preparing"}
                          </Text>
                        </>
                      )}
                    </View>
                    {tile.state !== "done" && tile.state !== "failed" ? (
                      <Pressable
                        onPress={() => tileAbortRef.current.get(tile.key)?.abort()}
                        hitSlop={10}
                        style={styles.dayTileCancel}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel ${tile.kind === "video" ? "video" : "photo"} ${index + 1}`}
                      >
                        <Icon name="close" size={14} color={textTokens.primary} />
                      </Pressable>
                    ) : null}
                    {tile.kind === "video" && formatTileClock(tile.durationMs) !== null && tile.state === "done" ? (
                      <View style={styles.dayTileDuration}>
                        <Text style={styles.dayTileDurationText}>{`▶ ${formatTileClock(tile.durationMs)}`}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            {videoProgress !== null ? (
              <Text
                style={styles.uploadProgress}
                accessibilityLiveRegion="polite"
              >
                {videoProgress.phase === "checking"
                  ? "Checking video…"
                  : videoProgress.phase === "uploading"
                    ? `Uploading${videoProgress.percent === null ? "…" : ` · ${videoProgress.percent}%`}`
                    : videoProgress.phase === "confirming"
                      ? "Confirming upload…"
                      : `Preparing${videoProgress.percent === null || videoProgress.percent <= 0 ? "…" : ` · ${videoProgress.percent}%`}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {activeTab === "gif" ? (
          <ProviderGrid
            kind="gif"
            status={giphyStatus}
            errorCode={giphyError}
            giphy={giphyResults}
            pexels={[]}
            disabled={atCap}
            onSelectGiphy={selectGiphy}
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
            giphy={[]}
            pexels={pexelsResults}
            disabled={atCap}
            onSelectGiphy={() => {}}
            onSelectPexels={selectPexels}
            onRetry={() => {
              if (query.trim().length >= 2) void runProviderSearch();
              else void loadCurated();
            }}
            onUseLibrary={() => switchTab("library")}
            searchActive={query.trim().length >= 2}
          />
        ) : null}
      </View>
    </Sheet>
  );
};

// ----- Provider grid (GIF/Photos masonry + states) -----------------------

const PROVIDER_ERROR_COPY: Record<
  "gif" | "stock",
  Record<string, { title: string; body: string }>
> = {
  gif: {
    rate_limited: {
      title: "Whoa, slow down.",
      body: "We've hit the hourly limit for GIFs. Give it a minute.",
    },
    not_configured: {
      title: "This source is taking a break.",
      body: "GIFs aren't available right now — your own Library still works.",
    },
    provider_unavailable: {
      title: "Couldn't reach GIPHY.",
      body: "Our bad — give it another shot.",
    },
    invalid_response: {
      title: "That came back scrambled.",
      body: "Try again — usually a one-off.",
    },
    auth_required: {
      title: "Sign in again.",
      body: "Your session needs a refresh to browse GIFs.",
    },
  },
  stock: {
    rate_limited: {
      title: "Whoa, slow down.",
      body: "We've hit the hourly limit for photos. Give it a minute.",
    },
    not_configured: {
      title: "This source is taking a break.",
      body: "Photos aren't available right now — your own Library still works.",
    },
    provider_unavailable: {
      title: "Couldn't reach Pexels.",
      body: "Our bad — give it another shot.",
    },
    invalid_response: {
      title: "That came back scrambled.",
      body: "Try again — usually a one-off.",
    },
    auth_required: {
      title: "Sign in again.",
      body: "Your session needs a refresh to browse photos.",
    },
  },
};

const ProviderGrid: React.FC<{
  kind: "gif" | "stock";
  status: ProviderStatus;
  errorCode: string | null;
  giphy: GiphyCoverSearchResult[];
  pexels: PexelsCoverSearchResult[];
  disabled: boolean;
  onSelectGiphy: (r: GiphyCoverSearchResult) => void;
  onSelectPexels: (r: PexelsCoverSearchResult) => void;
  onRetry: () => void;
  onUseLibrary: () => void;
  searchActive: boolean;
}> = ({
  kind,
  status,
  errorCode,
  giphy,
  pexels,
  disabled,
  onSelectGiphy,
  onSelectPexels,
  onRetry,
  onUseLibrary,
  searchActive,
}) => {
  const attribution =
    kind === "gif" ? "Powered by GIPHY" : "Photos provided by Pexels";
  const columns = 2;

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
          <Button
            label="Use Library"
            variant="secondary"
            size="sm"
            shape="square"
            onPress={onUseLibrary}
          />
        ) : (
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            shape="square"
            onPress={onRetry}
          />
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
        <Button
          label="Try again"
          variant="secondary"
          size="sm"
          shape="square"
          onPress={onRetry}
        />
        <Text style={styles.providerFooter}>{attribution}</Text>
      </View>
    );
  }

  const columnBuckets: Array<Array<{ key: string; node: React.ReactNode }>> =
    Array.from({ length: columns }, () => []);
  const columnHeights = new Array<number>(columns).fill(0);
  const pushTile = (
    key: string,
    aspect: number,
    node: React.ReactNode,
  ): void => {
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
          disabled={disabled}
          onPress={() => onSelectGiphy(r)}
        />,
      );
    });
  } else {
    pexels.forEach((r) => {
      const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 1;
      pushTile(
        `pexels-${r.id}`,
        aspect,
        <GridTile
          key={`pexels-${r.id}`}
          imageUrl={r.mediaUrl}
          aspect={aspect}
          avgColor={r.avgColor}
          label={r.alt ?? "Pexels photo"}
          credit={r.credit}
          disabled={disabled}
          onPress={() => onSelectPexels(r)}
        />,
      );
    });
  }

  return (
    <View style={styles.gridWrap}>
      <ScrollView
        contentContainerStyle={styles.masonryHost}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.masonryColumns}>
          {columnBuckets.map((bucket, i) => (
            <View key={`col-${i}`} style={styles.masonryColumn}>
              {bucket.map((t) => t.node)}
            </View>
          ))}
        </View>
        <Text style={styles.providerFooter}>{attribution}</Text>
      </ScrollView>
    </View>
  );
};

const GridTile: React.FC<{
  imageUrl: string;
  label: string;
  aspect?: number;
  avgColor?: string | null;
  credit?: string;
  disabled: boolean;
  onPress: () => void;
}> = ({ imageUrl, label, aspect = 1, avgColor, credit, disabled, onPress }) => (
  <Pressable
    accessibilityRole="imagebutton"
    accessibilityState={{ disabled }}
    accessibilityLabel={
      credit !== undefined ? `Select ${label} by ${credit}` : `Select ${label}`
    }
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.tile,
      pressed && !disabled && styles.tilePressed,
      disabled && styles.tileDisabled,
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
    {credit !== undefined ? (
      <Text style={styles.tileCredit} numberOfLines={1}>
        — {credit}
      </Text>
    ) : null}
  </Pressable>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  headerTextCol: { flex: 1 },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  pressed: { opacity: 0.7 },
  tabTrack: {
    flexDirection: "row",
    height: 40,
    borderRadius: radius.md,
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
    borderRadius: radius.sm,
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
  tabLabelActive: { color: accent.warm },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: radius.md,
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
  libraryBody: {
    gap: spacing.md,
  },
  libraryPreview: {
    minHeight: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: accent.border,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  libraryHint: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  // #3040 B-C12 — Appendix A §6 tiles: 3-column grid, gap 8, square, radius 12.
  dayTileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  dayTile: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
  },
  dayTileFailed: {
    borderWidth: 2,
    borderColor: "rgba(239,68,68,0.65)",
  },
  dayTileScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: coverUpload.scrim,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  dayTileLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  dayTileCancel: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,18,0.72)",
  },
  dayTileDuration: {
    position: "absolute",
    left: 6,
    bottom: 6,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 6,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.64)",
  },
  dayTileDurationText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  uploadProgress: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: accent.warm,
    textAlign: "center",
  },
  gridWrap: { flex: 1 },
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
    paddingBottom: spacing.lg,
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
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
  },
  tilePressed: { opacity: 0.82 },
  tileDisabled: { opacity: 0.4 },
  tileImage: {
    width: "100%",
    borderRadius: radius.md,
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

export default TripDayMediaSheet;
