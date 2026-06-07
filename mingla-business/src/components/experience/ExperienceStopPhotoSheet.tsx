/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · FIX 1
 * ExperienceStopPhotoSheet — the per-stop photo picker.
 *
 * Replaces the raw `expo-image-picker` single-photo path in ExperienceStopsStep
 * with the app's EXISTING media picker surface: Library + GIFs + Photos, the
 * same three tabs the unified CoverPicker presents — EXCEPT there is NO video
 * tab/path for stops (stops own a `string[]` of still images, capped at 5).
 *
 * Reuse (no fork of CoverPicker's heavy single-cover + video + cover_media
 * persistence):
 *   - GIFs   → trendingGiphyCovers / searchGiphyEventCovers (GIPHY, client-direct
 *              per ToS — coverProviderBrowseService.ts + giphyEventCoverService.ts).
 *   - Photos → curatedPexelsCovers / searchPexelsEventCovers (Pexels, EDGE-PROXIED
 *              `event-cover-pexels-curated` / `event-cover-pexels-search`; key
 *              stays server-side — coverProviderBrowseService.ts +
 *              pexelsEventCoverService.ts).
 *   - Library → device image/GIF upload via the brand-keyed
 *              `uploadExperienceStopImage` (experienceStopImageService.ts) — the
 *              author-time path that works before the experience row exists.
 *
 * Multi-select: a stop holds up to 5 photos; the sheet only lets the brand add
 * up to the remaining slots (5 − current count). Each chosen item appends a
 * public URL into the stop's `imageUrls`. The provider URLs (GIPHY/Pexels) are
 * the hotlink-able public media URLs returned by the search services — they are
 * stored directly, exactly as CoverPicker stores them into cover_media_url.
 *
 * Hosted inside the `Sheet` primitive (the canonical drawer). Rendered as a JSX
 * child of the parent host View (I-SUB-SHEET-INSIDE-PARENT).
 *
 * External-API docs (COMMS-0003): see the cited service files above; this sheet
 * adds NO new external API surface.
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
import { uploadExperienceStopImage } from "../../services/experienceStopImageService";
import { BRAND_COVER_MAX_BYTES, BrandCoverError } from "../../utils/brandCoverRules";
import { EventCoverProviderError } from "../../services/eventCoverProviderError";
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

const MAX_STOP_PHOTOS = 5;

type StopTabId = "library" | "gif" | "stock";
type ProviderStatus = "idle" | "loading" | "populated" | "empty" | "error";

const TAB_DEFS: readonly {
  id: StopTabId;
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

export interface ExperienceStopPhotoSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string;
  /** How many photos the stop already has — gates remaining selectable slots. */
  currentCount: number;
  /** Append one chosen public URL into the stop's imageUrls (max 5). */
  onAddPhoto: (url: string) => void;
  onShowToast: (msg: string) => void;
}

export const ExperienceStopPhotoSheet: React.FC<
  ExperienceStopPhotoSheetProps
> = ({ visible, onClose, brandId, currentCount, onAddPhoto, onShowToast }) => {
  const remaining = Math.max(0, MAX_STOP_PHOTOS - currentCount);
  const [activeTab, setActiveTab] = useState<StopTabId>("library");
  const [uploading, setUploading] = useState(false);

  // Provider browse state (mirror of CoverPicker, photos+GIFs only).
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

  // Gallery-first: fire trending/curated on first entry per tab (empty query).
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

  const switchTab = useCallback((tab: StopTabId): void => {
    tickHaptic();
    setActiveTab(tab);
    setQuery("");
  }, []);

  // ----- Library device upload -------------------------------------------

  const pickFromLibrary = useCallback(async (): Promise<void> => {
    if (uploading || atCap) return;
    let browserFiles: BrowserPickedFile[] = [];
    try {
      let assets: {
        uri: string;
        mimeType?: string | null;
        fileName?: string | null;
        fileSize?: number | null;
      }[];
      if (Platform.OS === "web") {
        const result = await pickBrowserFiles({
          accept: "image/jpeg,image/png,image/webp,image/gif",
          maxFiles: remaining,
          multiple: remaining > 1,
          validate: false,
        });
        if (result.canceled || result.files.length === 0) return;
        browserFiles = result.files;
        assets = result.files
          .map((file) => {
            try {
              validateBrowserFile(file.file, {
                accept: "image/jpeg,image/png,image/webp,image/gif",
                maxBytes: BRAND_COVER_MAX_BYTES,
              });
              return {
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.mimeType,
                uri: file.uri,
              };
            } catch {
              return null;
            }
          })
          .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
        if (assets.length === 0) {
          onShowToast("Choose a JPEG, PNG, WebP, or GIF under 8 MB.");
          return;
        }
        if (assets.length < result.files.length) {
          onShowToast("Some files were skipped. Use JPEG, PNG, WebP, or GIF under 8 MB.");
        }
      } else {
        const permission =
          await requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          onShowToast("Photo library permission is needed to add a photo.");
          return;
        }
        const result = await launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 1,
          // Multi-select up to the remaining slots where the OS supports it.
          allowsMultipleSelection: remaining > 1,
          selectionLimit: remaining,
        });
        if (result.canceled || result.assets.length === 0) return;
        assets = result.assets;
      }
      setUploading(true);
      // Upload sequentially; append each verified URL, never exceed the cap.
      let added = 0;
      for (const asset of assets) {
        if (added >= remaining) break;
        const url = await uploadExperienceStopImage(brandId, {
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
        });
        onAddPhoto(url);
        added += 1;
      }
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
      onClose();
    } catch (error) {
      if (error instanceof BrandCoverError) {
        onShowToast(error.message);
      } else {
        onShowToast(
          error instanceof Error
            ? error.message
            : "Couldn't upload that photo. Tap to retry.",
        );
      }
    } finally {
      revokeBrowserPickedFiles(browserFiles);
      setUploading(false);
    }
  }, [atCap, brandId, onAddPhoto, onClose, onShowToast, remaining, uploading]);

  // ----- Provider selection (GIPHY / Pexels) -----------------------------

  const selectGiphy = useCallback(
    (result: GiphyCoverSearchResult): void => {
      if (atCap) return;
      lightHaptic();
      onAddPhoto(result.mediaUrl);
      onShowToast("GIF added.");
      onClose();
    },
    [atCap, onAddPhoto, onClose, onShowToast],
  );

  const selectPexels = useCallback(
    (result: PexelsCoverSearchResult): void => {
      if (atCap) return;
      lightHaptic();
      onAddPhoto(result.mediaUrl);
      onShowToast("Photo added.");
      onClose();
    },
    [atCap, onAddPhoto, onClose, onShowToast],
  );

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.host}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text style={styles.headerTitle}>Add photos</Text>
            <Text style={styles.headerSub}>
              {atCap
                ? "This stop is full (5 photos)."
                : `${remaining} of 5 slots left.`}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close photo picker"
            hitSlop={12}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Icon name="close" size={24} color={textTokens.secondary} />
          </Pressable>
        </View>

        {/* Tab bar — Library / GIFs / Photos (NO video). */}
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

        {/* Search — GIFs + Photos only. */}
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

        {/* Bodies */}
        {activeTab === "library" ? (
          <View style={styles.libraryBody}>
            <View style={styles.libraryPreview}>
              <Icon name="grid" size={40} color={textTokens.tertiary} />
              <Text style={styles.libraryHint}>
                Pick up to {remaining} from your phone — JPEG, PNG, WebP, or GIF.
              </Text>
            </View>
            <Button
              label={atCap ? "Stop is full" : "Choose from library"}
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

  // Populated — N flex columns, shortest-column insertion.
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

export default ExperienceStopPhotoSheet;
