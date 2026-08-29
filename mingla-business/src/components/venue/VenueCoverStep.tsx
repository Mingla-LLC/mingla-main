/**
 * VenueCoverStep (create s4) — META-ORCH-1290 Leg B (D-1 folded wizard).
 *
 * The create-path equivalent of claim c4 (ClaimStepCover): choose the poster
 * from the s3 gallery OR upload a new one. The cover is THE one mandatory
 * decision (the wizard dock blocks until `draft.coverChoice` is set —
 * `venueStepError("s4")`). Operates on the top-level `draft.galleryUrls` +
 * `draft.coverChoice` (create has no adopted photos). Pre-submit there is no
 * venue row yet; the CoverPickerSheet's `venueId: ""` is the picker's own
 * sentinel and the emitted patch lands in the DRAFT, not on any server row.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { flushDraftVenuePersistence, useDraftVenueStore } from "../../store/draftVenueStore";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheet";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import type { CoverPatch } from "../ui/CoverPicker";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { coverGridColumns } from "./claim/ClaimStepCover";
import { CLAIM_GALLERY_MAX } from "./claim/ClaimStepPhotos";
import { useVenueThemeControl } from "./useVenueThemeControl";

const EMPTY_COVER: CoverPatch = {
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
};

export interface VenueCoverStepProps {
  brandId: string | null;
}

export const VenueCoverStep: React.FC<VenueCoverStepProps> = ({ brandId }) => {
  const gallery = useDraftVenueStore((s) => s.galleryUrls ?? []);
  const choice = useDraftVenueStore((s) => s.coverChoice ?? null);
  const patch = useDraftVenueStore((s) => s.patch);
  const activeDraftId = useDraftVenueStore((s) => s.activeDraftId);
  // #1022 A/F-13 — ONE discriminated sheet state, never two booleans, so the
  // cover picker and the theme sheet cannot both be open at once.
  const [activeSheet, setActiveSheet] = useState<"none" | "cover" | "theme">(
    "none",
  );
  const pickerVisible = activeSheet === "cover";
  const [colWidth, setColWidth] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  // issue #1564 — this was the ONLY cover step in the product without colour.
  const theme = useVenueThemeControl();

  const extraTile = choice !== null && !gallery.includes(choice.url) ? choice : null;

  const onLayout = useCallback((e: LayoutChangeEvent): void => {
    setColWidth(e.nativeEvent.layout.width);
  }, []);

  const cols = coverGridColumns(colWidth > 0 ? colWidth : 327);
  const gap = spacing.sm;
  const tileW =
    colWidth > 0 ? Math.floor((colWidth - gap * (cols - 1)) / cols) : 159;
  const tileH = Math.round(tileW * 1.25);

  const select = useCallback(
    (url: string): void => {
      patch({ coverChoice: { url, posterUrl: url, type: "image", isNew: false } });
    },
    [patch],
  );

  const handleCoverPatch = useCallback(
    async (p: CoverPatch): Promise<void> => {
      if (p.coverMediaUrl === null) return; // remove → keep current choice
      const type: "image" | "video" | "gif" =
        p.coverMediaType === "video"
          ? "video"
          : p.coverMediaType === "gif"
            ? "gif"
            : "image";
      const isImage = type !== "video";
      const cur = useDraftVenueStore.getState().galleryUrls ?? [];
      // An uploaded IMAGE/GIF joins the gallery (auto-selected); a video stays
      // cover-only (the gallery is photos).
      const nextGallery =
        isImage && !cur.includes(p.coverMediaUrl)
          ? [...cur, p.coverMediaUrl].slice(0, CLAIM_GALLERY_MAX)
          : cur;
      patch({
        galleryUrls: nextGallery,
        coverChoice: {
          url: p.coverMediaUrl,
          posterUrl: p.coverMediaPosterUrl,
          type,
          isNew: true,
        },
      });
      await flushDraftVenuePersistence();
      setActiveSheet("none");
    },
    [patch],
  );

  const uploadTile = (fullWidth: boolean): React.ReactElement => (
    <Pressable
      onPress={() => setActiveSheet("cover")}
      accessibilityRole="button"
      accessibilityLabel="Upload a new cover photo or video"
      style={[
        styles.uploadTile,
        fullWidth ? styles.uploadTileFull : { width: tileW, height: tileH },
      ]}
      testID="venue-cover-upload"
    >
      <Icon name="upload" size={28} color={textTokens.secondary} />
      <Text style={styles.uploadLabel}>Upload new</Text>
    </Pressable>
  );

  return (
    <View style={styles.host} onLayout={onLayout}>
      <Text style={styles.title}>Pick your cover</Text>
      <Text style={choice !== null ? styles.helperChosen : styles.helper}>
        {choice !== null
          ? "Looking good."
          : gallery.length > 0
            ? "The first thing people see when Mingla recommends you. Make it the shot you're proudest of."
            : "Add your best shot — photo or short video."}
      </Text>

      {choice !== null ? (
        <View style={styles.previewBand}>
          <EventCoverMedia
            hue={25}
            mediaUrl={choice.url}
            mediaType={choice.type}
            radius={12}
            label="Cover preview"
            height={170}
            muted
          />
        </View>
      ) : null}

      <View style={styles.grid} accessibilityLabel="Choose a cover photo">
        {gallery.map((url, index) => {
          const selected = choice?.url === url;
          return (
            <Pressable
              key={url}
              onPress={() => select(url)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Photo ${index + 1} of ${gallery.length}${selected ? ", selected as cover" : ""}`}
              style={({ pressed }) => [
                styles.tile,
                { width: tileW, height: tileH },
                selected ? styles.tileSelected : styles.tileUnselected,
                pressed && styles.tilePressed,
              ]}
            >
              <EventCoverMedia
                hue={25}
                mediaUrl={url}
                mediaType="image"
                radius={radiusTokens.lg}
                label=""
                height={tileH}
                width={tileW}
              />
              {selected ? (
                <View style={styles.checkBadge}>
                  <Icon name="check" size={14} color={textTokens.inverse} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {extraTile !== null ? (
          <View
            style={[styles.tile, styles.tileSelected, { width: tileW, height: tileH }]}
            accessible
            accessibilityLabel="Uploaded cover, selected"
          >
            <EventCoverMedia
              hue={25}
              mediaUrl={extraTile.url}
              mediaType={extraTile.type}
              radius={radiusTokens.lg}
              label=""
              height={tileH}
              width={tileW}
              muted
            />
            <View style={styles.checkBadge}>
              <Icon name="check" size={14} color={textTokens.inverse} />
            </View>
          </View>
        ) : null}
        {gallery.length > 0 ? uploadTile(false) : uploadTile(true)}
      </View>

      {toast !== null ? <Text style={styles.toast}>{toast}</Text> : null}

      {/* issue #1564 — MOUNT 1 of 4. Beside the cover, on the way to
          publishing, exactly where CreatorStep4Cover / ExperienceCoverStep /
          TripCreatorStep1Basics / RsvpStep7Preview / BrandEditView already put
          it. `host: { gap: spacing.md }` gives the 16pt gap free. */}
      <ThemeControlRow
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        brandThemeStatus={theme.brandThemeStatus}
        onPress={() => setActiveSheet("theme")}
        testID="venue-cover-theme-control-row"
      />

      {brandId !== null && activeDraftId !== null ? (
        <CoverPickerSheet
          visible={pickerVisible}
          onClose={() => setActiveSheet("none")}
          target={{ kind: "venue_draft", brandId, draftOwnerKey: activeDraftId }}
          initial={EMPTY_COVER}
          onCoverChange={handleCoverPatch}
          onShowToast={setToast}
        />
      ) : null}

      {/* I-SUB-SHEET-INSIDE-PARENT — last JSX child of the root View. */}
      <ThemeSheet
        visible={activeSheet === "theme"}
        onClose={() => setActiveSheet("none")}
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        testID="venue-cover-theme-sheet"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  helperChosen: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    fontWeight: "600",
    color: accent.warm,
  },
  previewBand: {
    borderRadius: 12,
    overflow: "hidden",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tile: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
  },
  tileSelected: {
    borderWidth: 2,
    borderColor: accent.warm,
  },
  tileUnselected: {
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  tilePressed: {
    transform: [{ scale: 0.97 }],
  },
  checkBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadTile: {
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  uploadTileFull: {
    width: "100%",
    height: 170,
  },
  uploadLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  toast: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
});

export default VenueCoverStep;
