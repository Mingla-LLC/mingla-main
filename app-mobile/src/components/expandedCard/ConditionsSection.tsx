/**
 * RIGHT NOW — weather and busyness, ONE section. Issue #1605 wave 4.
 *
 * These were two orange-tinted rounded boxes with 26pt icon badges, condition
 * chips and #EA580C values, stacked one above the other. Four sections in the
 * body were built that way and the effect was that every group shouted in the
 * same voice, so nothing was emphasised by being loud.
 *
 * They are now two fact rows under one heading. What went with the boxes, and
 * the number that sent it:
 *
 *   the 26pt orange icon badges       decoration; the label says what the row is
 *   the `conditionBadge` chips        a chip inside a chip inside a card
 *   #EA580C values                    3.19:1 as text; values are #111827 (17.74:1)
 *   the `estimatedText` caption       rgba(194,65,12,0.5) at 9pt = 2.20:1. DELETED,
 *                                     not recoloured — a 9pt half-alpha caption
 *                                     is not information.
 *   the hardcoded literal "Weather"   untranslated, shipped, at WeatherSection:82
 *
 * ---------------------------------------------------------------------------
 * BOTH BRANCHES PASS THE SAME PROPS, AND THAT IS THE POINT
 *
 * Before this wave the curated call passed `selectedDateTime={undefined}`, so a
 * SCHEDULED PLAN never got time-of-day-aware weather; and it took its
 * coordinates from `stops[0].lat/lng` while the single branch used
 * `card.location`. Under one spine there is one call site with one prop shape,
 * and a plan's coordinate is `stops[0]` because that is where the plan starts —
 * stated once, at the call site, rather than discovered twice.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { WeatherData } from "../../services/weatherService";
import type { BusynessData } from "../../services/busynessService";
import { formatTemperature } from "../utils/formatters";
import { FactRow, Section, Skeleton } from "./SpineParts";
import { SPINE } from "./spineTokens";

interface ConditionsSectionProps {
  weather: WeatherData | null;
  busyness: BusynessData | null;
  loadingWeather: boolean;
  loadingBusyness: boolean;
  measurementSystem?: "Metric" | "Imperial";
}

export default function ConditionsSection({
  weather,
  busyness,
  loadingWeather,
  loadingBusyness,
  measurementSystem,
}: ConditionsSectionProps): React.ReactElement | null {
  const { t } = useTranslation(["expanded_details", "common"]);

  const loading = loadingWeather || loadingBusyness;
  const hasAnything = weather !== null || busyness !== null;

  // Nothing in flight and nothing to show: the section does not render, and the
  // rule above it goes with it (Constitution 9 / §8.2).
  if (!loading && !hasAnything) return null;

  return (
    <Section title={t("expanded_details:weather.right_now", { defaultValue: "Right now" })}>
      {loadingWeather && weather === null ? (
        // A skeleton at the row's KNOWN height, so nothing jumps when the fetch
        // lands. The height is the fact row's, not an invented one.
        <View style={styles.skeletonRow}>
          <Skeleton height={16} width="42%" />
        </View>
      ) : (
        <FactRow
          first
          label={t("expanded_details:weather.title", { defaultValue: "Weather" })}
          value={
            weather === null
              ? null
              : formatTemperature(weather.temperature, measurementSystem)
          }
          tail={weather === null ? null : conditionWord(weather, t)}
        />
      )}

      {loadingBusyness && busyness === null ? (
        <View style={styles.skeletonRow}>
          <Skeleton height={16} width="52%" />
        </View>
      ) : busyness === null ? null : (
        <View style={styles.busyRow}>
          <Text style={styles.label} numberOfLines={1}>
            {t("expanded_details:busyness.busy_level", { defaultValue: "Busy level" })}
          </Text>
          <View style={styles.busyBody}>
            <Text style={styles.value} numberOfLines={1}>
              {busyness.message}
            </Text>
            {/*
              The sparkline is a 48x5 track with a proportional fill — the only
              non-text mark in the body, and it is decoration ON a value that is
              already written out in words next to it. Hidden from the a11y tree
              for exactly that reason: it adds nothing a screen reader has not
              already been told.
            */}
            <View
              style={styles.spark}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
            >
              <View
                style={[
                  styles.sparkFill,
                  { width: `${clampPercent(busyness.currentPopularity)}%` },
                ]}
              />
            </View>
          </View>
        </View>
      )}
    </Section>
  );
}

/** 0..100, defensively — a popularity outside the range is a producer bug, not a width. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function conditionWord(
  weather: WeatherData,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const desc = (weather.description || weather.condition || "").toLowerCase();
  if (desc.length === 0) return null;
  if (desc.includes("clear") || desc.includes("sunny")) return t("expanded_details:weather.clear");
  if (desc.includes("cloud")) return t("expanded_details:weather.cloudy");
  if (desc.includes("rain")) return t("expanded_details:weather.rainy");
  if (desc.includes("snow")) return t("expanded_details:weather.snowy");
  if (desc.includes("storm")) return t("expanded_details:weather.stormy");
  return t("expanded_details:weather.cloudy");
}

const styles = StyleSheet.create({
  skeletonRow: {
    minHeight: SPINE.factRowMinHeight,
    justifyContent: "center",
    paddingHorizontal: SPINE.gutter,
  },
  busyRow: {
    minHeight: SPINE.factRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: SPINE.gutter,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: SPINE.rule,
  },
  label: {
    fontSize: SPINE.factLabelSize,
    fontWeight: "500",
    color: SPINE.factLabel,
    width: 118,
  },
  busyBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  value: { fontSize: SPINE.factValueSize, fontWeight: "500", color: SPINE.factValue, flexShrink: 1 },
  spark: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: SPINE.rule,
    overflow: "hidden",
  },
  sparkFill: { height: 5, borderRadius: 3, backgroundColor: SPINE.accentFill },
});
