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
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";

import { CountAwareGallery } from "./CountAwareGallery";
import { Plus } from "./LucideIcons";
import type { ThemePalette, OfferingSurfaceStyles } from "./themePalette";
import type { TripOfferingDay } from "./tripOfferingTypes";
import { useReduceMotionPreference } from "./useReduceMotionPreference";

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

// issue #4420 — the days read as an accordion (design file → P.trip "Day by
// day"): each day is one row (DAY N · title · +), the first opens on its own,
// and a tap opens the date, the story and the day's photos. Long itineraries
// still show their first days with "Show all N days" (unchanged rule).
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
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(days.length > 0 ? [days[0].id] : []),
  );
  const reduceMotion = useReduceMotionPreference();
  const visibleDays =
    isLong && !expanded ? days.slice(0, COLLAPSED_DAY_COUNT) : days;
  const titleStyle = fontFamily !== undefined ? { fontFamily } : null;

  const toggle = (id: string): void => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      );
    }
    setOpenIds((prev: ReadonlySet<string>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View style={[styles.itin, { borderTopColor: palette.panelBorder }]} testID={testID}>
      {visibleDays.map((day) => {
        const open = openIds.has(day.id);
        const hasNarrative = day.narrative !== null && day.narrative.trim().length > 0;
        const hasDate = day.date !== null && day.date.length > 0;
        return (
          <View
            key={day.id}
            style={[styles.day, { borderBottomColor: palette.panelBorder }]}
            testID={testID !== undefined ? `${testID}-day-${day.ordinal}` : undefined}
          >
            <Pressable
              onPress={() => toggle(day.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`Day ${day.ordinal}, ${day.title}`}
              style={styles.dayHead}
            >
              <Text style={[styles.dayOrd, { color: palette.accent }]}>
                Day {day.ordinal}
              </Text>
              <Text style={[styles.dayTitle, surface.primaryText, titleStyle]}>
                {day.title}
              </Text>
              <View style={open ? styles.plusOpen : null}>
                <Plus size={16} color={palette.secondaryText} />
              </View>
            </Pressable>
            {open ? (
              <View style={styles.dayBody}>
                {hasDate || hasNarrative ? (
                  <Text style={[styles.dayNarr, surface.secondaryText]}>
                    {hasDate ? (
                      <Text style={[styles.dayDate, surface.tertiaryText]}>
                        {hasNarrative ? `${day.date} · ` : day.date}
                      </Text>
                    ) : null}
                    {hasNarrative ? day.narrative : null}
                  </Text>
                ) : null}
                <CountAwareGallery
                  items={day.media.map((m) => ({ url: m.url, type: m.type }))}
                  palette={palette}
                  variant={variant}
                  accessibilityLabelPrefix={`Day ${day.ordinal} media`}
                />
              </View>
            ) : null}
          </View>
        );
      })}
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
  itin: { marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  day: { borderBottomWidth: StyleSheet.hairlineWidth },
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 14,
  },
  dayOrd: {
    width: 54,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  dayTitle: { flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: "700" },
  plusOpen: { transform: [{ rotate: "45deg" }] },
  dayBody: { paddingLeft: 66, paddingBottom: 16, gap: 12 },
  dayDate: { fontSize: 14, fontWeight: "600" },
  dayNarr: { fontSize: 14, lineHeight: 21 },
  showAllRow: { paddingVertical: 12 },
  showAllText: { fontSize: 14, fontWeight: "800" },
});

export default DayByDay;
