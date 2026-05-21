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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
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
}) => {
  const { isAuthReady } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(
    null,
  );

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

  const supportsUpload = providers.includes("upload");
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

  const emitChange = useCallback(
    (patch: CoverPatch): void => {
      setLocalCover(patch);
      onCoverChange(patch);
    },
    [onCoverChange],
  );

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
    if (uploading || disabled) return;
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
  ]);

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
            mediaUrl={localCover.coverMediaUrl}
            mediaType={localCover.coverMediaType}
            radius={radiusTokens.lg}
            label={localCover.coverMediaAlt ?? "cover"}
            height={180}
            onMediaError={handleMediaRenderError}
          />
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
              disabled={uploading || disabled}
              style={styles.actionButton}
            />
            {localCover.coverMediaUrl !== null ? (
              <Button
                label="Remove"
                variant="ghost"
                size="md"
                shape="square"
                onPress={handleRemoveCover}
                disabled={uploading || disabled}
                style={styles.removeButton}
              />
            ) : null}
          </View>
        ) : null}
        {supportsUpload ? (
          <Text style={styles.uploadLimitText}>{EVENT_COVER_UPLOAD_LIMIT_COPY}</Text>
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
