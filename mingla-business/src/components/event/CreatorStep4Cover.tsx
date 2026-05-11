/**
 * Wizard Step 4 - Cover.
 *
 * ORCH-0783 makes new cover creation image/provider-first. Legacy video
 * covers still render elsewhere through EventCoverMedia, but this step no
 * longer exposes the active phone-video workflow or visible hue picker.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { Button } from "../ui/Button";
import {
  EventCoverMedia,
  type EventCoverMediaErrorEvent,
} from "../ui/EventCoverMedia";

import { type StepBodyProps } from "./types";
import { useAuth } from "../../context/AuthContext";

type ProviderTab = "giphy" | "pexels";
type SearchStatus = "idle" | "loading" | "error";

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  onShowToast,
}) => {
  const { isAuthReady } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [mediaDisplayError, setMediaDisplayError] = useState<string | null>(
    null,
  );
  const [providerTab, setProviderTab] = useState<ProviderTab>("giphy");
  const [query, setQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [giphyResults, setGiphyResults] = useState<GiphyCoverSearchResult[]>(
    [],
  );
  const [pexelsResults, setPexelsResults] = useState<PexelsCoverSearchResult[]>(
    [],
  );

  useEffect(() => {
    setMediaDisplayError(null);
  }, [draft.coverMediaUrl]);

  const selectedCredit = eventCoverProviderCreditLabel({
    provider: draft.coverMediaProvider,
    credit: draft.coverMediaCredit,
  });

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
            onShowToast("This event needs a server draft before media upload.");
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

  const eventIdForUpload = useCallback((): string | null => {
    const eventId = draft.id;
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
  }, [draft.id, showUploadError]);

  const pickImageOrGifCover = useCallback(async (): Promise<void> => {
    if (uploading) return;
    if (!isAuthReady) {
      onShowToast("Finishing sign-in before upload. Try again in a moment.");
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
      const asset = result.assets[0];
      const upload = await uploadEventCoverMedia({
        uri: asset.uri,
        brandId: draft.brandId,
        eventId,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        durationMs: null,
        pickerType: asset.type,
      });
      setMediaDisplayError(null);
      updateDraft({
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
    draft.brandId,
    ensureMediaPermission,
    eventIdForUpload,
    isAuthReady,
    onShowToast,
    showUploadError,
    updateDraft,
    uploading,
  ]);

  const runProviderSearch = useCallback(async (): Promise<void> => {
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
  }, [onShowToast, providerTab, query]);

  const selectGiphy = useCallback(
    (result: GiphyCoverSearchResult): void => {
      setMediaDisplayError(null);
      updateDraft({
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
    [onShowToast, updateDraft],
  );

  const selectPexels = useCallback(
    (result: PexelsCoverSearchResult): void => {
      setMediaDisplayError(null);
      updateDraft({
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
    [onShowToast, updateDraft],
  );

  const handleRemoveCover = useCallback((): void => {
    setMediaDisplayError(null);
    updateDraft({
      coverMediaUrl: null,
      coverMediaType: null,
      coverMediaProvider: null,
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    });
    onShowToast("Cover removed.");
  }, [onShowToast, updateDraft]);

  const handleMediaRenderError = useCallback(
    (event: EventCoverMediaErrorEvent): void => {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[CreatorStep4Cover] cover media render failed", event);
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
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover</Text>
        <View style={styles.coverPreview}>
          <EventCoverMedia
            hue={draft.coverHue}
            mediaUrl={draft.coverMediaUrl}
            mediaType={draft.coverMediaType}
            radius={radiusTokens.lg}
            label={draft.coverMediaAlt ?? "event cover"}
            height={180}
            onMediaError={handleMediaRenderError}
          />
        </View>
        {selectedCredit !== null ? (
          <Text style={styles.creditText}>{selectedCredit}</Text>
        ) : null}
        <View style={styles.actionRow}>
          <Button
            label={
              draft.coverMediaUrl === null ? "Upload image/GIF" : "Replace upload"
            }
            leadingIcon="upload"
            variant="secondary"
            size="md"
            shape="square"
            onPress={pickImageOrGifCover}
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
        <Text style={styles.uploadLimitText}>{EVENT_COVER_UPLOAD_LIMIT_COPY}</Text>
        {mediaDisplayError !== null ? (
          <Text accessibilityRole="alert" style={styles.mediaErrorText}>
            {mediaDisplayError}
          </Text>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Find a cover</Text>
        <View style={styles.providerTabs}>
          <ProviderTabButton
            label="GIPHY"
            active={providerTab === "giphy"}
            onPress={() => setProviderTab("giphy")}
          />
          <ProviderTabButton
            label="Pexels"
            active={providerTab === "pexels"}
            onPress={() => setProviderTab("pexels")}
          />
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              providerTab === "giphy" ? "Search GIFs" : "Search landscape photos"
            }
            placeholderTextColor={textTokens.tertiary}
            returnKeyType="search"
            onSubmitEditing={() => {
              void runProviderSearch();
            }}
            style={styles.searchInput}
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
            disabled={searchStatus === "loading"}
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
                label={(result as PexelsCoverSearchResult).alt ?? "Pexels photo"}
                credit={(result as PexelsCoverSearchResult).credit}
                onPress={() => selectPexels(result as PexelsCoverSearchResult)}
              />
            ),
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const ProviderTabButton: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={[styles.providerTab, active && styles.providerTabActive]}
  >
    <Text style={[styles.providerTabText, active && styles.providerTabTextActive]}>
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
