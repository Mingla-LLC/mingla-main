/**
 * ClaimStepCover (c4) — ORCH-1263 DESIGN §6.5: the COVER CHOOSER — the one
 * mandatory decision (0% of seeded places have covers). Choosing the poster,
 * not filling a field: 2-up 4:5 tiles from the c3 gallery + a dashed upload
 * tile; picking populates the 170pt preview band (the exact deck-readiness
 * hero geometry — what they pick is literally what they'll see there).
 *
 * The dock (wizard-owned) stays DISABLED until a choice exists
 * (`venueStepError("c4")`); the sub-dock caption says so honestly.
 * Upload = the existing CoverPicker flow (image/video). Pre-submit there is
 * no venue row yet — the venue target's `venueId` is host-persistence
 * documentation only (never read by the picker; sentinel per the picker's own
 * `""` eventRowId precedent), and the emitted patch lands in the DRAFT, not
 * on any server row.
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
} from "../../../constants/designSystem";
import { flushDraftVenuePersistence, useDraftVenueStore } from "../../../store/draftVenueStore";
import { ThemeControlRow } from "../../theme/ThemeControlRow";
import { ThemeSheet } from "../../theme/ThemeSheet";
import { useVenueThemeControl } from "../useVenueThemeControl";
import { CoverPickerSheet } from "../../ui/CoverPickerSheet";
import type { CoverPatch } from "../../ui/CoverPicker";

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
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { CLAIM_GALLERY_MAX } from "./ClaimStepPhotos";

/** Wrap math (DESIGN §6.5): 2-up minimum, more columns once ~172pt tiles fit. */
export function coverGridColumns(columnWidth: number): number {
  const gap = spacing.sm;
  return Math.max(2, Math.floor((columnWidth + gap) / (172 + gap)));
}

export interface ClaimStepCoverProps {
  brandId: string | null;
}

export const ClaimStepCover: React.FC<ClaimStepCoverProps> = ({ brandId }) => {
  const claim = useDraftVenueStore((s) => s.claim);
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
  // issue #1564 — MOUNT 3 of 4, the claim twin of VenueCoverStep. A claimed
  // place gets its own colours on the same terms a created one does.
  const theme = useVenueThemeControl();

  const kept = claim?.keptGalleryUrls ?? [];
  const added = new Set(claim?.addedGalleryUrls ?? []);
  const choice = claim?.coverChoice ?? null;
  // A NEW video/off-gallery cover renders as its own selected tile.
  const extraTile = choice !== null && !kept.includes(choice.url)
    ? choice
    : null;

  const onLayout = useCallback((e: LayoutChangeEvent): void => {
    setColWidth(e.nativeEvent.layout.width);
  }, []);

  const cols = coverGridColumns(colWidth > 0 ? colWidth : 327);
  const gap = spacing.sm;
  const tileW = colWidth > 0
    ? Math.floor((colWidth - gap * (cols - 1)) / cols)
    : 159;
  const tileH = Math.round(tileW * 1.25);

  const select = useCallback(
    (url: string, isNew: boolean): void => {
      const cur = useDraftVenueStore.getState().claim;
      if (cur === null) return;
      patch({
        claim: {
          ...cur,
          coverChoice: { url, posterUrl: url, type: "image", isNew },
        },
      });
    },
    [patch],
  );

  const handleCoverPatch = useCallback(
    async (p: CoverPatch): Promise<void> => {
      const cur = useDraftVenueStore.getState().claim;
      if (cur === null) return;
      if (p.coverMediaUrl === null) return; // remove → keep current choice
      const type: "image" | "video" | "gif" = p.coverMediaType === "video"
        ? "video"
        : p.coverMediaType === "gif"
          ? "gif"
          : "image";
      const isImage = type !== "video";
      // An uploaded IMAGE/GIF joins the gallery as a `New` tile (auto-selected);
      // a video stays cover-only (the gallery is photos).
      const nextKept = isImage && !cur.keptGalleryUrls.includes(p.coverMediaUrl)
        ? [...cur.keptGalleryUrls, p.coverMediaUrl].slice(0, CLAIM_GALLERY_MAX)
        : cur.keptGalleryUrls;
      const nextAdded = isImage && !cur.addedGalleryUrls.includes(p.coverMediaUrl)
        ? [...cur.addedGalleryUrls, p.coverMediaUrl]
        : cur.addedGalleryUrls;
      patch({
        claim: {
          ...cur,
          keptGalleryUrls: nextKept,
          addedGalleryUrls: nextAdded,
          coverChoice: {
            url: p.coverMediaUrl,
            posterUrl: p.coverMediaPosterUrl,
            type,
            isNew: true,
          },
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
        fullWidth
          ? styles.uploadTileFull
          : { width: tileW, height: tileH },
      ]}
      testID="claim-cover-upload"
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
          : kept.length > 0
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

      <View
        style={styles.grid}
        accessibilityLabel="Choose a cover photo"
      >
        {kept.map((url, index) => {
          const selected = choice?.url === url;
          const isNew = added.has(url);
          return (
            <Pressable
              key={url}
              onPress={() => select(url, isNew)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Photo ${index + 1} of ${kept.length}${selected ? ", selected as cover" : ""}`}
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
              {isNew ? (
                <View style={styles.tileChip}>
                  <ProvenanceChip state="new" scrim />
                </View>
              ) : null}
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
            style={[
              styles.tile,
              styles.tileSelected,
              { width: tileW, height: tileH },
            ]}
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
            <View style={styles.tileChip}>
              <ProvenanceChip state="new" scrim />
            </View>
            <View style={styles.checkBadge}>
              <Icon name="check" size={14} color={textTokens.inverse} />
            </View>
          </View>
        ) : null}
        {kept.length > 0 ? uploadTile(false) : uploadTile(true)}
      </View>

      {toast !== null ? <Text style={styles.toast}>{toast}</Text> : null}

      <ThemeControlRow
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        brandThemeStatus={theme.brandThemeStatus}
        onPress={() => setActiveSheet("theme")}
        testID="claim-cover-theme-control-row"
      />

      {brandId !== null && activeDraftId !== null ? (
        <CoverPickerSheet
          visible={pickerVisible}
          onClose={() => setActiveSheet("none")}
          target={{
            kind: "venue_draft",
            brandId,
            // Pre-submit: no venue row exists yet. The picker never reads
            // venueId (host persists the patch — here, into the draft);
            // sentinel mirrors the picker's own "" eventRowId precedent.
            draftOwnerKey: activeDraftId,
          }}
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
        testID="claim-cover-theme-sheet"
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
  tileChip: {
    position: "absolute",
    bottom: 8,
    left: 8,
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

export default ClaimStepCover;
