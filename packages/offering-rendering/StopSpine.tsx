/**
 * StopSpine — ORCH-1183 [experience-standardize].
 *
 * THE ONE shared itinerary spine for the public experience page, rendered byte-
 * identically on buyer-web + business iOS/Android + consumer iOS/Android.
 * Converges the two forked spines:
 *   • web/business ExperiencePreview.StopSpine — image-only per-stop gallery.
 *   • consumer ConsumerExperienceDetailScreen inline spine — per-stop VIDEO support.
 * This shared spine PRESERVES the consumer's per-stop video (the gallery items carry
 * an explicit "image"|"video" type — the renderer never auto-detects), so no surface
 * regresses to image-only.
 *
 * Experiences are STOP/place-based (NOT day-based like trips → this is a NEW spine,
 * not trip's DayByDay). Each stop renders: a numbered dot (stopOrder+1), the
 * START HERE / THEN / END WITH label (by index), an optional start-time pill, the
 * place name + (privacy-aware) address + authored blurb, and the per-stop media
 * gallery. NEVER a per-stop price (ORCH-1151 — one combined all-in only).
 *
 * Pure-presentational, props-only, NO app-src imports (I-MOR-0827-PACKAGE-ISOLATION).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { CountAwareGallery, type CountAwareGalleryItem } from "./CountAwareGallery";
import { offeringSurfaceStyles, type ThemePalette } from "./themePalette";
import type { ExperienceOfferingStop } from "./experienceOfferingTypes";

/** START HERE / THEN / END WITH from index + count (single owner). */
export function stopLabelForIndex(index: number, total: number): string {
  if (index === 0) return "START HERE";
  if (index === total - 1 && total > 1) return "END WITH";
  return "THEN";
}

export interface StopSpineProps {
  stops: ExperienceOfferingStop[];
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  /** Resolved bold font family (native bold). */
  fontFamily: string;
  variant: "phone" | "desktop";
  /**
   * Per-stop start-time → display label. The surface owns the device-locale 12h/24h
   * resolution (kept out of the pure package so tests can pin a clock). null → no
   * pill.
   */
  formatStopTime: (startTime: string | null) => string | null;
  testID?: string;
}

export const StopSpine: React.FC<StopSpineProps> = ({
  stops,
  palette,
  surface,
  fontFamily,
  variant,
  formatStopTime,
  testID,
}) => {
  if (stops.length === 0) return null;
  return (
    <View style={styles.itin} testID={testID}>
      <View style={[styles.itinSpine, { backgroundColor: palette.accentWash }]} />
      {stops.map((stop, idx) => {
        const timePill = formatStopTime(stop.startTime);
        const media: CountAwareGalleryItem[] = stop.media.map((m) => ({
          url: m.url,
          type: m.type,
        }));
        const label = stopLabelForIndex(idx, stops.length);
        return (
          <View key={stop.id} style={styles.stop}>
            <View style={[styles.stopDot, { backgroundColor: palette.accent }]}>
              <Text style={[styles.stopDotText, { color: palette.accentText }]}>
                {stop.stopOrder + 1}
              </Text>
            </View>
            <View style={[styles.stopCard, surface.card]}>
              <View style={styles.stopHead}>
                <Text style={[styles.stopOrd, { color: palette.accent }]}>{label}</Text>
                {timePill !== null && timePill.length > 0 ? (
                  <Text style={[styles.stopTime, surface.tertiaryText]}>{timePill}</Text>
                ) : null}
              </View>
              {stop.placeName !== null && stop.placeName.trim().length > 0 ? (
                <Text style={[styles.stopTitle, surface.primaryText, { fontFamily }]}>
                  {stop.placeName}
                </Text>
              ) : null}
              {stop.address !== null && stop.address.trim().length > 0 ? (
                <Text style={[styles.stopAddr, surface.tertiaryText]} numberOfLines={2}>
                  {stop.address}
                </Text>
              ) : null}
              {stop.description !== null && stop.description.trim().length > 0 ? (
                <Text style={[styles.stopBlurb, surface.secondaryText]}>
                  {stop.description}
                </Text>
              ) : null}
              {media.length > 0 ? (
                <View style={styles.stopGallery}>
                  <CountAwareGallery
                    items={media}
                    palette={palette}
                    variant={variant}
                    accessibilityLabelPrefix={`Stop ${stop.stopOrder + 1} media`}
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  itin: { position: "relative", paddingLeft: 30, marginTop: 4 },
  itinSpine: { position: "absolute", left: 9, top: 6, bottom: 6, width: 2 },
  stop: { position: "relative", paddingBottom: 18 },
  stopDot: {
    position: "absolute",
    left: -30,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  stopDotText: { fontSize: 10, fontWeight: "900" },
  stopCard: { borderRadius: 14, padding: 14 },
  stopHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stopOrd: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stopTime: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  stopTitle: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  stopAddr: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  stopBlurb: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  stopGallery: { marginTop: 12 },
});

export default StopSpine;
