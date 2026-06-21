/**
 * DayByDay — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * THE ONE promoted itinerary spine. Replaces the two forks: the business
 * `DayByDay` (TripPreview :757-826) + the consumer inline spine
 * (ConsumerTripDetailScreen :962-1004). Spine + per-day dot + per-day count-aware
 * gallery; collapse to the first 2 days + "Show all N days" when ≥5 days.
 *
 * Pure-presentational (I-MOR-0827). Renders the day rows ONLY (the body owns the
 * "Day by day" section heading). Rule 9: a day with zero media renders no gallery
 * (CountAwareGallery emits nothing for []).
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CountAwareGallery } from "./CountAwareGallery";
import type { ThemePalette, OfferingSurfaceStyles } from "./themePalette";
import type { TripOfferingDay } from "./tripOfferingTypes";

const LONG_ITINERARY_THRESHOLD = 5;
const COLLAPSED_DAY_COUNT = 2;

export interface DayByDayProps {
  days: TripOfferingDay[];
  palette: ThemePalette;
  surface: OfferingSurfaceStyles;
  /** Bold (700-weight) loaded family for the day title (native bold). */
  fontFamily?: string;
  variant: "phone" | "desktop";
  testID?: string;
}

export const DayByDay: React.FC<DayByDayProps> = ({
  days,
  palette,
  surface,
  fontFamily,
  variant,
  testID,
}) => {
  const isLong = days.length >= LONG_ITINERARY_THRESHOLD;
  const [expanded, setExpanded] = useState<boolean>(false);
  const visibleDays =
    isLong && !expanded ? days.slice(0, COLLAPSED_DAY_COUNT) : days;
  const titleStyle = fontFamily !== undefined ? { fontFamily } : null;

  return (
    <View style={styles.itin} testID={testID}>
      <View style={[styles.itinSpine, { backgroundColor: palette.accentWash }]} />
      {visibleDays.map((day) => (
        <View key={day.id} style={styles.day}>
          <View style={[styles.dayDot, { backgroundColor: palette.accent }]}>
            <Text style={[styles.dayDotText, { color: palette.accentText }]}>
              {day.ordinal}
            </Text>
          </View>
          <View style={[styles.dayCard, surface.card]}>
            <View style={styles.dayHead}>
              <Text style={[styles.dayOrd, { color: palette.accent }]}>
                Day {day.ordinal}
              </Text>
              {day.date !== null && day.date.length > 0 ? (
                <Text style={[styles.dayDate, surface.tertiaryText]}>
                  {day.date}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.dayTitle, surface.primaryText, titleStyle]}>
              {day.title}
            </Text>
            {day.narrative !== null && day.narrative.trim().length > 0 ? (
              <Text style={[styles.dayNarr, surface.secondaryText]}>
                {day.narrative}
              </Text>
            ) : null}
            <CountAwareGallery
              items={day.media.map((m) => ({ url: m.url, type: m.type }))}
              palette={palette}
              variant={variant}
              accessibilityLabelPrefix={`Day ${day.ordinal} media`}
            />
          </View>
        </View>
      ))}
      {isLong ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Show fewer days" : `Show all ${days.length} days`
          }
          style={styles.showAllRow}
        >
          <Text style={[styles.showAllText, { color: palette.accent }]}>
            {expanded ? "Show fewer days" : `Show all ${days.length} days`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  itin: { position: "relative", paddingLeft: 30, marginTop: 4 },
  itinSpine: { position: "absolute", left: 9, top: 6, bottom: 6, width: 2 },
  day: { position: "relative", paddingBottom: 18 },
  dayDot: {
    position: "absolute",
    left: -30,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDotText: { fontSize: 10, fontWeight: "900" },
  dayCard: { borderRadius: 14, padding: 14 },
  dayHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayOrd: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dayDate: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  dayTitle: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  dayNarr: { fontSize: 13, lineHeight: 20, marginTop: 6 },
  showAllRow: { paddingVertical: 8 },
  showAllText: { fontSize: 14, fontWeight: "800" },
});

export default DayByDay;
