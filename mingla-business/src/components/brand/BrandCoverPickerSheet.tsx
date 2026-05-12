/**
 * BrandCoverPickerSheet — bottom sheet with three tabs for choosing a brand
 * cover: Upload (device file) / Pexels (free photo search) / GIPHY (GIF
 * search). Persists the choice via `useBrandCoverUpload`.
 *
 * MUST be rendered as a child of the parent View (not a sibling Fragment)
 * per the [Sub-sheet inside parent] memory rule — native Modal sibling
 * mounts compete at the OS root layer.
 *
 * Per ORCH-0805 SPEC §8.1.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
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
  searchGiphyBrandCovers,
  type GiphyBrandCoverResult,
} from "../../services/giphyBrandCoverService";
import {
  searchPexelsBrandCovers,
  type PexelsBrandCoverResult,
} from "../../services/pexelsBrandCoverService";
import {
  useBrandCoverUpload,
  type BrandCoverUploadSource,
} from "../../hooks/useBrandCoverUpload";
import { BrandCoverError } from "../../utils/brandCoverRules";

type TabId = "upload" | "pexels" | "giphy";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "pexels", label: "Pexels" },
  { id: "giphy", label: "GIPHY" },
];

export interface BrandCoverPickerSheetProps {
  visible: boolean;
  brandId: string;
  accountId: string;
  existingDescription: string | null;
  currentMediaUrl: string | null;
  onClose: () => void;
  onPicked: (result: { publicUrl: string; mediaType: "image" | "gif" }) => void;
  onErrorToast?: (message: string) => void;
}

export const BrandCoverPickerSheet: React.FC<BrandCoverPickerSheetProps> = ({
  visible,
  brandId,
  accountId,
  existingDescription,
  currentMediaUrl,
  onClose,
  onPicked,
  onErrorToast,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("upload");
  const { uploadCover, isUploading, error, clearError } = useBrandCoverUpload();

  // Reset internal state when the sheet closes.
  useEffect(() => {
    if (!visible) {
      setActiveTab("upload");
      clearError();
    }
  }, [visible, clearError]);

  const fireSource = useCallback(
    async (source: BrandCoverUploadSource): Promise<void> => {
      try {
        const result = await uploadCover({
          brandId,
          accountId,
          existingDescription,
          previousMediaUrl: currentMediaUrl,
          source,
        });
        onPicked({ publicUrl: result.publicUrl, mediaType: result.mediaType });
        onClose();
      } catch (err) {
        if (err instanceof BrandCoverError && onErrorToast !== undefined) {
          onErrorToast(err.message);
        }
        // error state captured inside the hook for inline render
      }
    },
    [
      uploadCover,
      brandId,
      accountId,
      existingDescription,
      currentMediaUrl,
      onPicked,
      onClose,
      onErrorToast,
    ],
  );

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.host}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Choose a cover</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close cover picker"
            hitSlop={8}
          >
            <Icon name="close" size={20} color={textTokens.secondary} />
          </Pressable>
        </View>

        <View style={styles.tabRow} accessibilityRole="tablist">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                disabled={isUploading}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${tab.label} tab`}
                accessibilityState={{ selected: isActive, disabled: isUploading }}
                style={[
                  styles.tabPressable,
                  isActive ? styles.tabPressableActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    isActive ? styles.tabLabelActive : null,
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error !== null ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error.message}</Text>
          </View>
        ) : null}

        {activeTab === "upload" ? (
          <UploadTab onPick={fireSource} disabled={isUploading} />
        ) : null}
        {activeTab === "pexels" ? (
          <PexelsTab onPick={fireSource} disabled={isUploading} />
        ) : null}
        {activeTab === "giphy" ? (
          <GiphyTab onPick={fireSource} disabled={isUploading} />
        ) : null}

        {isUploading ? (
          <View style={styles.uploadingHost}>
            <ActivityIndicator size="small" color={accent.warm} />
            <Text style={styles.uploadingText}>Saving cover…</Text>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
};

// ----- Tab: Upload -------------------------------------------------------

interface TabProps {
  onPick: (source: BrandCoverUploadSource) => void | Promise<void>;
  disabled: boolean;
}

const UploadTab: React.FC<TabProps> = ({ onPick, disabled }) => {
  const handlePickFile = useCallback(async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (asset === undefined) return;
    await onPick({
      kind: "upload",
      asset: {
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
      },
    });
  }, [onPick]);

  return (
    <View style={styles.tabPanel}>
      <View style={styles.uploadCard}>
        <Icon name="upload" size={28} color={accent.warm} />
        <Text style={styles.uploadCardTitle}>Upload from your device</Text>
        <Text style={styles.uploadCardBody}>
          JPEG, PNG, WebP, or animated GIF. Up to 8 MB.
        </Text>
        <View style={styles.uploadCardBtn}>
          <Button
            label="Choose from device"
            onPress={handlePickFile}
            variant="primary"
            size="md"
            disabled={disabled}
            leadingIcon="upload"
          />
        </View>
      </View>
    </View>
  );
};

// ----- Tab: Pexels -------------------------------------------------------

const PexelsTab: React.FC<TabProps> = ({ onPick, disabled }) => {
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<PexelsBrandCoverResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSearch = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const page = await searchPexelsBrandCovers(query, { perPage: 12 });
      setResults(page.photos);
    } catch (err) {
      setErrorMsg(
        err instanceof BrandCoverError
          ? err.message
          : "Couldn't reach Pexels.",
      );
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <View style={styles.tabPanel}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search Pexels…"
          placeholderTextColor={textTokens.tertiary}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search Pexels"
        />
        <Button
          label="Search"
          onPress={handleSearch}
          variant="secondary"
          size="md"
          disabled={disabled || query.trim().length < 2}
        />
      </View>

      {loading ? (
        <View style={styles.loadingHost}>
          <ActivityIndicator size="small" color={accent.warm} />
        </View>
      ) : null}

      {errorMsg !== null ? (
        <Text style={styles.errorText}>{errorMsg}</Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.grid}>
        {results.map((photo) => (
          <Pressable
            key={photo.id}
            onPress={() =>
              onPick({
                kind: "provider",
                ref: {
                  provider: "pexels",
                  publicUrl: photo.mediaUrl,
                  attribution: {
                    name: photo.credit,
                    url: photo.creditUrl,
                  },
                },
              })
            }
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Use Pexels photo by ${photo.credit}`}
            style={styles.thumbPressable}
          >
            <Image source={{ uri: photo.mediaUrl }} style={styles.thumb} />
            <Text style={styles.thumbCredit} numberOfLines={1}>
              {photo.credit}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.providerFooter}>Photos provided by Pexels</Text>
    </View>
  );
};

// ----- Tab: GIPHY --------------------------------------------------------

const GiphyTab: React.FC<TabProps> = ({ onPick, disabled }) => {
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<GiphyBrandCoverResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSearch = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const items = await searchGiphyBrandCovers(query, { limit: 18 });
      setResults(items);
    } catch (err) {
      setErrorMsg(
        err instanceof BrandCoverError
          ? err.message
          : "Couldn't reach GIPHY.",
      );
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <View style={styles.tabPanel}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search GIPHY…"
          placeholderTextColor={textTokens.tertiary}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search GIPHY"
        />
        <Button
          label="Search"
          onPress={handleSearch}
          variant="secondary"
          size="md"
          disabled={disabled || query.trim().length < 2}
        />
      </View>

      {loading ? (
        <View style={styles.loadingHost}>
          <ActivityIndicator size="small" color={accent.warm} />
        </View>
      ) : null}

      {errorMsg !== null ? (
        <Text style={styles.errorText}>{errorMsg}</Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.grid}>
        {results.map((gif) => (
          <Pressable
            key={gif.id}
            onPress={() =>
              onPick({
                kind: "provider",
                ref: {
                  provider: "giphy",
                  publicUrl: gif.mediaUrl,
                  attribution:
                    gif.creditUrl !== null
                      ? { name: gif.credit, url: gif.creditUrl }
                      : null,
                },
              })
            }
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
              gif.alt !== null
                ? `Use GIPHY ${gif.alt}`
                : "Use this GIPHY"
            }
            style={styles.thumbPressable}
          >
            <Image source={{ uri: gif.previewUrl }} style={styles.thumb} />
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.providerFooter}>Powered by GIPHY</Text>
    </View>
  );
};

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
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    padding: 4,
    marginBottom: spacing.md,
  },
  tabPressable: {
    flex: 1,
    paddingVertical: spacing.sm - 2,
    alignItems: "center",
    borderRadius: radiusTokens.sm,
  },
  tabPressableActive: {
    backgroundColor: accent.tint,
  },
  tabLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: textTokens.primary,
  },
  tabPanel: {
    flex: 1,
  },
  errorBanner: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
    borderWidth: 1,
    borderRadius: radiusTokens.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  uploadCard: {
    padding: spacing.lg,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: 1,
    borderRadius: radiusTokens.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  uploadCardTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  uploadCardBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  uploadCardBtn: {
    marginTop: spacing.sm,
    width: "100%",
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: 1,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  loadingHost: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
  },
  thumbPressable: {
    width: "31%",
    aspectRatio: 1,
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: radiusTokens.sm,
    backgroundColor: glass.tint.profileBase,
  },
  thumbCredit: {
    fontSize: 10,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  providerFooter: {
    fontSize: 11,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  uploadingHost: {
    position: "absolute",
    bottom: spacing.lg,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 4,
  },
  uploadingText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
});
