/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeAnswerFileThumbnail />.
 *
 * Per DESIGN_ORCH-0880 §5.3. Image files: 80x80pt card with lazy-loaded
 * Image (signed URL refetched on scroll-in). PDF/doc files: 80x100pt card
 * with Lucide FileText icon + filename + download icon overlay.
 *
 * Tap image → opens IntakeAnswerFilePreview modal (parent handles).
 * Tap PDF/doc → opens signed URL via Linking.openURL (system browser handles
 * download).
 *
 * Lazy signed URL fetch — uses supabase.storage.createSignedUrl with 1hr
 * expiry; refetched when stale. NB: parent should call createSignedUrlFor
 * to mint the URL since the bucket is private (planner-read RLS requires
 * the planner's auth context).
 *
 * Composes GlassCard + Icon + Image + Linking. No new primitives.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { supabase } from "../../services/supabase";

export interface IntakeAnswerFileThumbnailProps {
  filePath: string; // storage bucket path
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Called when buyer taps an image thumbnail; parent opens preview modal
   * with the signed URL. */
  onImageTap: (signedUrl: string) => void;
  testID?: string;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

const isImageMime = (mime: string): boolean => mime.startsWith("image/");

async function fetchSignedUrl(filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from("trip_intake_files")
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
    if (error !== null) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export const IntakeAnswerFileThumbnail: React.FC<
  IntakeAnswerFileThumbnailProps
> = ({ filePath, filename, mimeType, sizeBytes, onImageTap, testID }) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);
  const isImage = isImageMime(mimeType);
  // sizeBytes is part of the prop contract (matches IntakeFileAnswer shape)
  // but is rendered by parent TravelerIntakeAnswerCard in the file caption
  // row — not used here directly.
  void sizeBytes;

  // Mint signed URL on mount. Refetch is handled by parent re-render via key.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await fetchSignedUrl(filePath);
      if (cancelled) return;
      if (url === null) setLoadError(true);
      else setSignedUrl(url);
    })();
    return (): void => {
      cancelled = true;
    };
  }, [filePath]);

  const handleTap = useCallback(async (): Promise<void> => {
    if (isImage && signedUrl !== null) {
      onImageTap(signedUrl);
      return;
    }
    // PDF/doc: refetch a fresh signed URL just before opening — old URL may
    // have expired since the card mounted.
    let openUrl = signedUrl;
    if (openUrl === null) openUrl = await fetchSignedUrl(filePath);
    if (openUrl !== null) {
      try {
        await Linking.openURL(openUrl);
      } catch {
        setLoadError(true);
      }
    } else {
      setLoadError(true);
    }
  }, [isImage, signedUrl, onImageTap, filePath]);

  if (isImage) {
    return (
      <Pressable
        onPress={() => {
          void handleTap();
        }}
        accessibilityRole="button"
        accessibilityLabel={`View ${filename}`}
        style={({ pressed }) => [
          styles.imageCardWrap,
          pressed && styles.cardPressed,
        ]}
        testID={testID ?? `intake-thumb-${filename}`}
      >
        <GlassCard variant="base" padding={0} radius="md">
          <View style={styles.imageCardInner}>
            {signedUrl !== null && !loadError ? (
              <Image
                source={{ uri: signedUrl }}
                style={styles.image}
                resizeMode="cover"
                onError={() => setLoadError(true)}
                accessibilityLabel={`Photo: ${filename}`}
              />
            ) : loadError ? (
              <View style={styles.imageFallback}>
                <Icon
                  name="bell"
                  size={24}
                  color={textTokens.quaternary}
                  strokeWidth={2}
                />
                <Text style={styles.fallbackText}>Unavailable</Text>
              </View>
            ) : (
              <View style={styles.imageFallback}>
                <View style={styles.skeleton} />
              </View>
            )}
          </View>
        </GlassCard>
      </Pressable>
    );
  }

  // PDF / doc — taller card with FileText icon + filename + download overlay
  return (
    <Pressable
      onPress={() => {
        void handleTap();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Download ${filename}`}
      style={({ pressed }) => [
        styles.docCardWrap,
        pressed && styles.cardPressed,
      ]}
      testID={testID ?? `intake-thumb-${filename}`}
    >
      <GlassCard variant="base" padding={spacing.xs} radius="md">
        <View style={styles.docCardInner}>
          <Icon
            name="list"
            size={28}
            color={textTokens.secondary}
            strokeWidth={2}
          />
          <Text
            style={styles.docFilename}
            numberOfLines={2}
            ellipsizeMode="middle"
          >
            {filename}
          </Text>
          <View style={styles.docDownloadOverlay}>
            <Icon
              name="download"
              size={14}
              color={accent.warm}
              strokeWidth={2}
            />
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  imageCardWrap: {
    width: 80,
    height: 80,
  },
  imageCardInner: {
    width: 80,
    height: 80,
    overflow: "hidden",
    borderRadius: radius.md,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    gap: 4,
  },
  fallbackText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.quaternary,
  },
  skeleton: {
    width: "60%",
    height: 6,
    borderRadius: 3,
    backgroundColor: glass.border.profileBase,
  },
  cardPressed: {
    opacity: 0.85,
  },
  docCardWrap: {
    width: 80,
    height: 100,
  },
  docCardInner: {
    alignItems: "center",
    justifyContent: "space-between",
    height: "100%",
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  docFilename: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.primary,
    textAlign: "center",
    paddingHorizontal: spacing.xxs,
  },
  docDownloadOverlay: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default IntakeAnswerFileThumbnail;
