/**
 * A single place's COMPANION stops ("Your stroll" / "Your picnic").
 *
 * #4347 wave 3 — a curated plan no longer renders here: its stops are cards
 * with clock times (PlanStopCard), so the plan-only controls (swap, call,
 * website, the photo strip, the optional marker, the Customised chip) left this
 * file with it. A row opens with a Reanimated layout transition on iPhone and
 * Android alike (it used to animate on Android only, through LayoutAnimation);
 * under Reduce Motion it opens instantly.
 *
 * The row rhythm is #1605 wave 4's: every row is the same 72pt until it is
 * tapped, ONE row is open at a time, and the index chip is the spine. The
 * travel connector renders ONLY for a real leg and always says "estimated"
 * (#1706); the open badge renders ONLY when the stop's UTC offset is known.
 */
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import type { CuratedStop } from "../../types/curatedExperience";
import { extractWeekdayText } from "../../utils/openingHoursUtils";
import { getUserLocale } from "../../utils/localeUtils";
import { useIsPlaceOpen } from "../../hooks/useIsPlaceOpen";
import { Section, present } from "./SpineParts";
import { SPINE, STOP_ROW } from "./spineTokens";
import { PLAN_MOTION } from "./motionTokens";
import { stopMetaText } from "./expandedCardFacts";

export interface StopListStop {
  readonly key: string;
  readonly index: number;
  /** `SHOP` for the picnic grocery stop; the ordinal otherwise. */
  readonly indexLabel: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly meta: string | null;
  readonly address: string | null;
  readonly description: string | null;
  readonly openingHours: CuratedStop["openingHours"] | undefined;
  readonly utcOffsetMinutes: number | null;
  /** Minutes from the PREVIOUS stop. `null` = no real leg; the connector is omitted. */
  readonly travelMinutes: number | null;
  readonly travelMode: string | null;
  /** #1705 — what this stop is FOR; null when it cannot be stated without guessing. */
  readonly purpose: { key: string; defaultValue: string; icon: string } | null;
}

interface StopListProps {
  readonly heading: string;
  /**
   * One line under the heading: companions are places to BEGIN at, not a
   * sequence, and without the line a stroll's rows read as an itinerary.
   */
  readonly subtitle?: string;
  readonly stops: readonly StopListStop[];
  readonly onDirections: (stop: StopListStop) => void;
}

export default function StopList({ heading, subtitle, stops, onDirections }: StopListProps): React.ReactElement | null {
  const { t } = useTranslation(["cards", "expanded_details", "common"]);
  const reducedMotion = useReducedMotion();
  // ONE open at a time.
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  if (stops.length === 0) return null;

  return (
    <Section title={heading} subtitle={subtitle}>
      {stops.map((stop, i) => (
        <Reanimated.View
          key={stop.key}
          layout={reducedMotion ? undefined : LinearTransition.duration(PLAN_MOTION.detailsMs)}
        >
          {i > 0 && stop.travelMinutes != null && stop.travelMinutes > 0 ? (
            <View style={styles.connector} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.connectorLine} />
              <View style={styles.connectorPill}>
                <Icon name={travelIcon(stop.travelMode)} size={12} color={SPINE.factLabel} />
                <Text style={styles.connectorText}>
                  {t("cards:expanded.minutes_short", { defaultValue: "{{count}} min", count: Math.round(stop.travelMinutes) })}
                </Text>
                {/* #1706 — a haversine estimate, never a measurement: it says so. */}
                <Text style={styles.connectorEstimated}>
                  {t("cards:expanded.estimated", { defaultValue: "estimated" })}
                </Text>
              </View>
              <View style={styles.connectorLine} />
            </View>
          ) : null}

          <StopRow
            stop={stop}
            expanded={openKey === stop.key}
            reducedMotion={reducedMotion}
            onToggle={() => setOpenKey((prev) => (prev === stop.key ? null : stop.key))}
            onDirections={onDirections}
          />
        </Reanimated.View>
      ))}
    </Section>
  );
}

/**
 * One stop. The press target and the Directions control are SIBLINGS, never
 * nested (a Pressable inside a Pressable flattens the VoiceOver subtree).
 */
function StopRow({
  stop,
  expanded,
  reducedMotion,
  onToggle,
  onDirections,
}: {
  stop: StopListStop;
  expanded: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
  onDirections: (stop: StopListStop) => void;
}): React.ReactElement {
  const { t } = useTranslation(["cards", "expanded_details", "common"]);
  // The badge is computed against venue-local time or not at all (#1605 P1-5).
  const isOpenComputed = useIsPlaceOpen(stop.openingHours ?? null, stop.utcOffsetMinutes);
  const isOpen = stop.utcOffsetMinutes != null ? isOpenComputed : null;
  const weekdayLines = React.useMemo(() => extractWeekdayText(stop.openingHours ?? null) ?? [], [stop.openingHours]);
  const todayName = React.useMemo(() => new Date().toLocaleDateString(getUserLocale(), { weekday: "long" }), []);
  const meta = present(stop.meta) ? `, ${stop.meta}` : "";

  return (
    <View>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          /^\d+$/.test(stop.indexLabel)
            ? t("cards:expanded.stop_a11y", { defaultValue: "Stop {{n}}, {{name}}{{meta}}", n: stop.indexLabel, name: stop.name, meta })
            : t("cards:expanded.stop_unnumbered_a11y", { defaultValue: "{{name}}{{meta}}", name: stop.name, meta })
        }
      >
        <View style={styles.thumbWrap}>
          {present(stop.imageUrl) ? (
            <Image source={{ uri: stop.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={styles.thumb} />
          )}
          {present(stop.indexLabel) ? (
            <View style={styles.indexChip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.indexText} numberOfLines={1}>
                {stop.indexLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.name} numberOfLines={1}>
            {stop.name}
          </Text>
          <View style={styles.metaRow}>
            {present(stop.meta) ? (
              <Text style={styles.meta} numberOfLines={1}>
                {stop.meta}
              </Text>
            ) : null}
            {isOpen !== null ? (
              <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
                <Text style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}>
                  {isOpen ? t("cards:expanded.open_now") : t("cards:expanded.closed")}
                </Text>
              </View>
            ) : null}
          </View>
          {stop.purpose ? (
            <View style={styles.purpose}>
              <Icon name={stop.purpose.icon} size={STOP_ROW.purposeIconSize} color={SPINE.link} />
              <Text style={styles.purposeText} numberOfLines={1}>
                {t(`cards:${stop.purpose.key}`, { defaultValue: stop.purpose.defaultValue })}
              </Text>
            </View>
          ) : null}
        </View>

        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={STOP_ROW.chevronSize} color={SPINE.factLabel} />
      </Pressable>

      {/* #1705 — the control is not behind the expand, and is a SIBLING of the row. */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => onDirections(stop)}
          style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
          accessibilityRole="button"
          accessibilityLabel={t("cards:expanded.get_directions")}
        >
          <Text style={styles.controlText}>{t("cards:expanded.get_directions")}</Text>
        </Pressable>
      </View>

      {expanded ? (
        <Reanimated.View
          testID="stop-list-expanded"
          entering={reducedMotion ? undefined : FadeIn.duration(PLAN_MOTION.detailsMs)}
          style={styles.expanded}
        >
          {present(stop.imageUrl) ? <Image source={{ uri: stop.imageUrl }} style={styles.photo} resizeMode="cover" /> : null}
          {present(stop.description) ? <Text style={styles.description}>{stop.description}</Text> : null}
          {weekdayLines.length > 0 ? (
            <View style={styles.hours}>
              {weekdayLines.map((line) => {
                const isToday = line.startsWith(todayName);
                return (
                  <View key={line} style={styles.hoursRow}>
                    {isToday ? <View style={styles.todayMarker} /> : <View style={styles.todaySpacer} />}
                    <Text style={[styles.hoursLine, isToday ? styles.hoursLineToday : null]} numberOfLines={1}>
                      {line}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          {present(stop.address) ? (
            <Text style={styles.address} numberOfLines={2}>
              {stop.address}
            </Text>
          ) : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function travelIcon(mode: string | null): string {
  if (mode === "driving") return "car-outline";
  if (mode === "walking") return "walk-outline";
  if (mode === "bicycling" || mode === "biking") return "bicycle-outline";
  if (mode === "transit") return "bus-outline";
  return "navigate-outline";
}

const styles = StyleSheet.create({
  row: {
    // #1705 — minHeight, not height: the purpose line lives inside this row.
    minHeight: STOP_ROW.height,
    flexDirection: "row",
    alignItems: "center",
    gap: STOP_ROW.gap,
    paddingHorizontal: SPINE.gutter,
  },
  rowPressed: { backgroundColor: SPINE.pressedRow },
  thumbWrap: { width: STOP_ROW.thumb, height: STOP_ROW.thumb },
  thumb: {
    width: STOP_ROW.thumb,
    height: STOP_ROW.thumb,
    borderRadius: STOP_ROW.thumbRadius,
    backgroundColor: SPINE.chipFill,
  },
  indexChip: {
    position: "absolute",
    left: -6,
    top: -6,
    minWidth: STOP_ROW.indexSize,
    height: STOP_ROW.indexSize,
    paddingHorizontal: 5,
    borderRadius: STOP_ROW.indexRadius,
    backgroundColor: SPINE.accentFill,
    alignItems: "center",
    justifyContent: "center",
  },
  // #16110D on #EB7825 = 6.47:1. White on the same fill measures 2.90:1.
  indexText: { fontSize: STOP_ROW.indexLabelSize, fontWeight: "700", color: SPINE.onAccent },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: STOP_ROW.nameSize, fontWeight: "600", color: SPINE.factValue },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { fontSize: STOP_ROW.metaSize, fontWeight: "500", color: SPINE.muted, flexShrink: 1 },
  badge: { borderRadius: STOP_ROW.badgeRadius, paddingHorizontal: 8, paddingVertical: 1 },
  badgeOpen: { backgroundColor: SPINE.openFill },
  badgeClosed: { backgroundColor: SPINE.closedFill },
  badgeText: { fontSize: STOP_ROW.badgeSize, fontWeight: "600" },
  badgeTextOpen: { color: SPINE.openText },
  badgeTextClosed: { color: SPINE.closedText },
  expanded: { paddingHorizontal: SPINE.gutter, paddingBottom: SPINE.gutter, gap: 12 },
  photo: {
    width: "100%",
    height: STOP_ROW.photoStripHeight,
    borderRadius: STOP_ROW.photoStripRadius,
    backgroundColor: SPINE.chipFill,
  },
  description: { fontSize: 15, lineHeight: 22, color: SPINE.prose },
  hours: { gap: 2 },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  todayMarker: { width: 3, height: 16, borderRadius: 2, backgroundColor: SPINE.link },
  todaySpacer: { width: 3, height: 16 },
  hoursLine: { fontSize: 13, lineHeight: 20, color: SPINE.prose, flex: 1 },
  hoursLineToday: { fontWeight: "600", color: SPINE.link },
  address: { fontSize: 14, lineHeight: 20, color: SPINE.muted },
  // #1705 — the purpose line: SPINE.link (#C2410C, 5.18:1) is the one text accent.
  purpose: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  purposeText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: SPINE.link,
    lineHeight: STOP_ROW.purposeLineHeight,
    flexShrink: 1,
  },
  controls: {
    flexDirection: "row",
    gap: 20,
    flexWrap: "wrap",
    paddingHorizontal: SPINE.gutter,
    paddingBottom: 6,
  },
  control: { minHeight: SPINE.factRowMinHeight, justifyContent: "center" },
  controlPressed: { opacity: 0.6 },
  controlText: { fontSize: 14, fontWeight: "600", color: SPINE.link },
  connector: {
    height: STOP_ROW.connectorHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: SPINE.gutter,
  },
  connectorLine: { flex: 1, height: 1, backgroundColor: SPINE.rule },
  connectorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: SPINE.pressedRow,
    borderWidth: 1,
    borderColor: SPINE.rule,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  connectorEstimated: { fontSize: 11.5, fontWeight: "400", color: SPINE.muted },
  connectorText: { fontSize: 11, fontWeight: "500", color: SPINE.factLabel },
});

export { stopMetaText };
