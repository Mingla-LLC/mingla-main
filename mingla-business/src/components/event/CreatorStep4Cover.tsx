/**
 * Wizard Step 4 — Cover.
 *
 * Designer source: screens-creator.jsx lines 163-184 (CreatorStep4).
 * Event cover editor. Uploaded image/GIF/video media is canonical; the
 * hue grid remains the fallback when no uploaded media is present.
 *
 * Per Cycle 3 spec §3.9 Step 4.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import {
  EventCoverMediaError,
  uploadEventCoverMedia,
} from "../../services/eventCoverMediaService";
import { Button } from "../ui/Button";
import { EventCover } from "../ui/EventCover";
import { EventCoverMedia } from "../ui/EventCoverMedia";

import { type StepBodyProps } from "./types";

const HUE_TILES: readonly number[] = [25, 100, 180, 220, 290, 320] as const;

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  onShowToast,
  coverMediaEventId,
}) => {
  const [uploading, setUploading] = useState(false);

  const handleSelectHue = useCallback(
    (hue: number): void => {
      updateDraft({ coverHue: hue });
    },
    [updateDraft],
  );

  const showUploadError = useCallback(
    (error: unknown): void => {
      if (error instanceof EventCoverMediaError) {
        switch (error.code) {
          case "permission_denied":
            onShowToast("Photo library permission is needed to add a cover.");
            return;
          case "unsupported_type":
            onShowToast("Choose an image, GIF, or short MP4/WebM video.");
            return;
          case "file_too_large":
            onShowToast("Covers must be 30 MB or smaller.");
            return;
          case "video_too_long":
            onShowToast("Cover videos must be 15 seconds or shorter.");
            return;
          case "missing_server_event_id":
            onShowToast("This event needs a server draft before media upload.");
            return;
          case "upload_failed":
            onShowToast("Cover upload failed. Try again.");
            return;
        }
      }
      onShowToast("Cover upload failed. Try again.");
    },
    [onShowToast],
  );

  const handlePickCover = useCallback(async (): Promise<void> => {
    if (uploading) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showUploadError(
        new EventCoverMediaError(
          "permission_denied",
          "Photo library permission denied.",
        ),
      );
      return;
    }

    const eventId = coverMediaEventId ?? draft.id;
    if (eventId.trim().length === 0) {
      showUploadError(
        new EventCoverMediaError(
          "missing_server_event_id",
          "Missing server event id.",
        ),
      );
      return;
    }

    setUploading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.92,
        videoMaxDuration: 15,
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
        durationMs:
          typeof asset.duration === "number" ? asset.duration : null,
      });
      updateDraft({
        coverMediaUrl: upload.publicUrl,
        coverMediaType: upload.mediaType,
      });
      onShowToast("Cover updated.");
    } catch (error) {
      showUploadError(error);
    } finally {
      setUploading(false);
    }
  }, [
    coverMediaEventId,
    draft.brandId,
    draft.id,
    onShowToast,
    showUploadError,
    updateDraft,
    uploading,
  ]);

  const handleRemoveCover = useCallback((): void => {
    updateDraft({ coverMediaUrl: null, coverMediaType: null });
    onShowToast("Uploaded cover removed.");
  }, [onShowToast, updateDraft]);

  return (
    <View>
      {/* Cover preview */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover</Text>
        <View style={styles.coverPreview}>
          <EventCoverMedia
            hue={draft.coverHue}
            mediaUrl={draft.coverMediaUrl}
            mediaType={draft.coverMediaType}
            radius={radiusTokens.lg}
            label="cover · 16:9"
            height={180}
          />
        </View>
        <View style={styles.actionRow}>
          <Button
            label={draft.coverMediaUrl === null ? "Upload cover" : "Replace cover"}
            leadingIcon="upload"
            variant="secondary"
            size="md"
            shape="square"
            onPress={handlePickCover}
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
      </View>

      {/* Cover style grid — fallback for events without uploaded media. */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover style</Text>
        <View style={styles.tileGrid}>
          {HUE_TILES.map((hue) => {
            const active = draft.coverHue === hue;
            return (
              <Pressable
                key={hue}
                onPress={() => handleSelectHue(hue)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Cover hue ${hue}${active ? " (selected)" : ""}`}
                style={[styles.tile, active && styles.tileActive]}
              >
                <View style={styles.tileInner}>
                  <EventCover hue={hue} radius={radiusTokens.md} label="" />
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.comingSoonCaption}>
          Used whenever uploaded media is removed or fails to load.
        </Text>
      </View>
    </View>
  );
};

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
  comingSoonCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.md,
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tile: {
    width: "31%",
    aspectRatio: 1,
    padding: 2,
    borderRadius: radiusTokens.md + 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileActive: {
    borderColor: accent.warm,
  },
  tileInner: {
    flex: 1,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
});
