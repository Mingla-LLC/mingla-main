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
 *   the `estimatedText` caption       rgba(194,65,12,0.5) at 9pt = 2.20:1.
 *                                     Recoloured and re-sized, NOT deleted — see
 *                                     the busyness block below.
 *   the hardcoded literal "Weather"   untranslated, shipped, at WeatherSection:82
 *
 * ---------------------------------------------------------------------------
 * BUSYNESS IS AN ESTIMATE AND THE ROW SAYS SO (Constitution 9) — #1605 P1-4
 *
 * `busynessService.getVenueTypeHeuristic()` synthesises busyness from a
 * COMPILE-TIME `VENUE_POPULARITY[category].weekday[hour]` curve and returns
 * `isEstimated: true`. There is no code path in the app that returns
 * `isEstimated: false` today — every busyness value on this sheet is a typical
 * pattern, not a measurement.
 *
 * The first cut of this wave deleted the 9pt 2.20:1 disclosure for a legitimate
 * contrast reason and kept the VALUE, rendering `busyness.message` verbatim:
 *
 *     Busy Level   Not busy (3%) — great time to visit!
 *
 * at #111827 / 17.74:1 with an accent-filled sparkline — a compile-time curve
 * position, promoted to look like a BestTime reading, with an exhortation
 * attached. Two unrelated venues read the same 3% forty minutes apart on both
 * platforms, because `weekday[1]` is a constant.
 *
 * A disclosure that fails AA is not a disclosure, but deleting it and keeping
 * the number is worse than either. So the row now does BOTH of the things the
 * fix could have done:
 *
 *   1. the VALUE is the qualitative band (§6.6's own design: `Usually quiet`),
 *      never the percentage and never the advice. A synthesised percentage
 *      cannot be rendered as a fact because it is no longer rendered at all;
 *   2. the DISCLOSURE returns at the fact-row token scale — 14/400 #4B5563,
 *      7.56:1 — beside the value where it is read WITH it, not under it at 9pt.
 *
 * The word carries the estimate's meaning by itself ("Usually", not "Now"), so
 * the two are belt and braces on purpose: the sheet is where a user decides
 * whether to leave the house.
 *
 * ---------------------------------------------------------------------------
 * BOTH BRANCHES PASS THE SAME PROPS — AND WHAT THAT DOES *NOT* MEAN
 *
 * An earlier version of this header claimed the wave had fixed time-of-day-aware
 * weather for scheduled plans, on the grounds that `main`'s curated branch
 * passed `selectedDateTime={undefined}` while the single branch passed the
 * card's own value. THAT CLAIM WAS FALSE and it is retracted here rather than
 * softened, because a comment asserting a fix that does not exist is worse than
 * no comment: the next person trusts it.
 *
 * TIME-OF-DAY-AWARE WEATHER HAS NEVER EXISTED, for two independent reasons, and
 * neither is anything this wave changed:
 *
 *   1. `weatherService.getWeatherForecast` requested `current=…` from
 *      Open-Meteo and returned `hourlyForecast: []`, with a cache key of
 *      `lat_lng` and no date in it. Its third parameter was declared and never
 *      read. It is now removed (nothing else called it), so the signature can no
 *      longer suggest a capability the body does not have.
 *   2. `main`'s `WeatherSection` declared `selectedDateTime?: Date` in its props
 *      interface and referenced it NOWHERE in the component body. So the value
 *      the single-place branch passed was dropped on the floor at the other end,
 *      exactly like the curated branch's `undefined`.
 *
 * `ExpandedCardData.selectedDateTime` is therefore a field with five producers
 * (SwipeableCards, SavedTab, CalendarTab x2, cardPayloadAdapter) and no reader.
 * It is CLASSIFIED, not silently kept — see the DECLARED-NOT-RENDERED ledger in
 * `S-6b`, which is where a field with no render site has to be listed or the
 * gate goes red. Making the sheet genuinely time-aware means an hourly fetch, an
 * hour-selection rule and a date-keyed cache; that is a feature, and it is
 * registered as one rather than described as done.
 *
 * What this wave DID unify is real and smaller: one call site, one prop shape,
 * and a plan's coordinate resolved once (`stops[0]`, because that is where the
 * plan starts) instead of discovered twice.
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
            {/*
              THE BAND, NOT THE PERCENTAGE. `busyness.message` is
              "Not busy (3%) — great time to visit!" — a compile-time curve
              value plus advice. §6.6's design is a qualitative word, and a
              qualitative word is the only honest rendering of a typical curve.
            */}
            <Text style={styles.value} numberOfLines={1}>
              {bandLabel(busyness, t)}
            </Text>
            {busyness.isEstimated ? (
              <Text style={styles.estimated} numberOfLines={1}>
                {t("expanded_details:busyness.estimated_disclosure", {
                  defaultValue: "Estimated",
                })}
              </Text>
            ) : null}
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

/**
 * The busyness BAND as a word. #1605 P1-4.
 *
 * Two vocabularies, and the difference between them is the whole point. An
 * ESTIMATED value comes from a typical-popularity curve for this venue category
 * and this hour, so it can only honestly say what this place is USUALLY like. A
 * MEASURED value (no producer returns one today — the service's only busyness
 * path sets `isEstimated: true`) may speak about right now.
 *
 * The percentage never appears in either vocabulary. `busynessLevel` is the
 * band the service already computed from it (<25 / <50 / <75 / else), so this
 * function invents nothing — it renames a band the producer owns.
 */
function bandLabel(
  busyness: BusynessData,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const typical = busyness.isEstimated;
  switch (busyness.busynessLevel) {
    case "Very Busy":
      return typical
        ? t("expanded_details:busyness.typical_packed", { defaultValue: "Usually packed" })
        : t("expanded_details:busyness.now_packed", { defaultValue: "Packed right now" });
    case "Busy":
      return typical
        ? t("expanded_details:busyness.typical_busy", { defaultValue: "Usually busy" })
        : t("expanded_details:busyness.now_busy", { defaultValue: "Busy right now" });
    case "Moderate":
      return typical
        ? t("expanded_details:busyness.typical_steady", { defaultValue: "Usually steady" })
        : t("expanded_details:busyness.now_steady", { defaultValue: "Steady right now" });
    case "Not Busy":
      return typical
        ? t("expanded_details:busyness.typical_quiet", { defaultValue: "Usually quiet" })
        : t("expanded_details:busyness.now_quiet", { defaultValue: "Quiet right now" });
    default: {
      // Exhaustive. A new band from the producer must be named here rather than
      // falling through to a percentage.
      const never: never = busyness.busynessLevel;
      return String(never);
    }
  }
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
  /*
    The disclosure that replaces `estimatedText`. The shipped one was
    rgba(194,65,12,0.5) at 9pt = 2.20:1 — a caption that fails AA is not
    information, which is why the first cut deleted it. This one is 14/400
    #4B5563 = 7.56:1, the same token the body uses for secondary prose, sitting
    BESIDE the value so a screen reader reads "Usually quiet, Estimated" as one
    thought rather than finding it a line later.
  */
  estimated: { fontSize: 14, fontWeight: "400", color: SPINE.muted, flexShrink: 0 },
  spark: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: SPINE.rule,
    overflow: "hidden",
  },
  sparkFill: { height: 5, borderRadius: 3, backgroundColor: SPINE.accentFill },
});
