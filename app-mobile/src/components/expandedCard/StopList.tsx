/**
 * THE PLAN — a curated plan's stops. Issue #1605 wave 4.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROW IS 72pt AND WHY THAT IS THE WHOLE DESIGN
 *
 * A stop card used to be `radius 12, padding 12` around a 140pt image pager, a
 * name, a role, an italic preview, a meta row, an address row, an always-visible
 * hours block and three buttons — roughly 400pt PER STOP. Ten stops was a
 * 4,000pt scroll of ten things you had to read.
 *
 * The default row is 72pt and every row is the same 72pt until it is tapped, so
 * the list has a rhythm you can SCAN. Three things hold a ten-stop plan together:
 *
 *   1. Rows stay 72pt.            2 stops = 172pt · 3 = 272pt · 10 = 972pt.
 *   2. ONE stop is expanded at a time. Opening a second collapses the first, so
 *      the list can never grow into a wall, and the newly opened row is scrolled
 *      to land under the hero rather than wherever the previous height left it.
 *   3. The index chip IS the spine. 1…10 at the thumbnail's top-left, so position
 *      is readable at a glance without a drawn line. (The drawn line is what
 *      `TimelineSection` tried, and its orange spine at `left: 30` was painted
 *      over by every opaque step card — it has never been visible.)
 *
 * There is NO "show all / show less" and no pagination. A ten-stop plan is a
 * ten-stop plan; hiding half of it to protect a scrollbar is dishonest about
 * what the user made.
 *
 * ---------------------------------------------------------------------------
 * NO NESTED SCROLLABLES
 *
 * The stops list itself was already flat. What nested were the PER-STOP image
 * pager (`StopImageGallery`, one horizontal ScrollView per stop, N of them
 * inside the sheet's vertical scroll) and the alternatives strip (another
 * horizontal ScrollView). Both are gone: the expanded stop shows ONE photo, and
 * the alternatives are a wrapping grid. A horizontal ScrollView inside a gorhom
 * sheet fights the sheet's pan gesture, and N of them fight it N times.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE INVENTS A NUMBER
 *
 * The travel connector renders ONLY when the leg carries real data.
 * `cardConverters.ts` synthesises `duration: 60` per stop for a curated card, so
 * a rendered "60 min" between every pair of stops would be a fabrication with a
 * pill around it. The open/closed badge renders ONLY when the stop's UTC offset
 * is known, for the same reason the venue's does.
 */
import React from "react";
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import type { CuratedStop } from "../../types/curatedExperience";
import { extractWeekdayText } from "../../utils/openingHoursUtils";
import { getUserLocale } from "../../utils/localeUtils";
import { useIsPlaceOpen } from "../../hooks/useIsPlaceOpen";
import { Chip, Section, present } from "./SpineParts";
import { SPINE, STOP_ROW } from "./spineTokens";
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
  readonly canReplace: boolean;
}

interface StopListProps {
  readonly heading: string;
  readonly stops: readonly StopListStop[];
  readonly customized?: boolean;
  readonly onDirections: (stop: StopListStop) => void;
  readonly onReplace?: (stop: StopListStop) => void;
  /** Scrolls the newly opened row to `y = heroH`, so it lands under the hero. */
  readonly onExpandedRowLayout?: (y: number) => void;
  readonly replacePanel?: (stop: StopListStop) => React.ReactNode;
}

export default function StopList({
  heading,
  stops,
  customized,
  onDirections,
  onReplace,
  onExpandedRowLayout,
  replacePanel,
}: StopListProps): React.ReactElement | null {
  const { t } = useTranslation(["cards", "expanded_details", "common"]);
  // ONE open at a time. A Set would allow two, and two is what turns a scannable
  // list back into a wall.
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  if (stops.length === 0) return null;

  const toggle = (key: string): void => {
    if (Platform.OS === "android") {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setOpenKey((prev) => (prev === key ? null : key));
  };

  return (
    <Section
      title={heading}
      trailing={customized ? <Chip label={t("cards:expanded.customized")} /> : undefined}
    >
      {stops.map((stop, i) => (
        <View key={stop.key}>
          {/*
            The travel connector. Rendered ONLY for a real leg — see the header.
            It is a hairline with a centred pill, 28pt, and it carries no colour.
          */}
          {i > 0 && stop.travelMinutes != null && stop.travelMinutes > 0 ? (
            <View
              style={styles.connector}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.connectorLine} />
              <View style={styles.connectorPill}>
                <Icon name={travelIcon(stop.travelMode)} size={12} color={SPINE.factLabel} />
                <Text style={styles.connectorText}>
                  {t("cards:expanded.minutes_short", {
                    defaultValue: "{{count}} min",
                    count: Math.round(stop.travelMinutes),
                  })}
                </Text>
              </View>
              <View style={styles.connectorLine} />
            </View>
          ) : null}

          <StopRow
            stop={stop}
            expanded={openKey === stop.key}
            onToggle={() => toggle(stop.key)}
            onDirections={onDirections}
            onReplace={onReplace}
            onExpandedRowLayout={onExpandedRowLayout}
            replacePanel={replacePanel}
          />
        </View>
      ))}
    </Section>
  );
}

/**
 * One stop.
 *
 * THE ROW'S PRESS TARGET AND THE EXPANDED CONTROLS ARE SIBLINGS, NEVER NESTED.
 * A `Pressable` inside a `Pressable` flattens the VoiceOver subtree and the
 * inner controls vanish from the accessibility tree entirely — so Directions and
 * Replace sit BELOW the row's target, not inside it.
 */
function StopRow({
  stop,
  expanded,
  onToggle,
  onDirections,
  onReplace,
  onExpandedRowLayout,
  replacePanel,
}: {
  stop: StopListStop;
  expanded: boolean;
  onToggle: () => void;
  onDirections: (stop: StopListStop) => void;
  onReplace?: (stop: StopListStop) => void;
  onExpandedRowLayout?: (y: number) => void;
  replacePanel?: (stop: StopListStop) => React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation(["cards", "expanded_details", "common"]);
  // The badge is computed against VENUE-LOCAL time or not at all.
  const isOpen = useIsPlaceOpen(stop.openingHours ?? null, stop.utcOffsetMinutes);
  const weekdayLines = React.useMemo(
    () => extractWeekdayText(stop.openingHours ?? null) ?? [],
    [stop.openingHours],
  );
  const todayName = React.useMemo(
    () => new Date().toLocaleDateString(getUserLocale(), { weekday: "long" }),
    [],
  );

  return (
    <View
      onLayout={(e) => {
        if (expanded) onExpandedRowLayout?.(e.nativeEvent.layout.y);
      }}
    >
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t("cards:expanded.stop_a11y", {
          defaultValue: "Stop {{n}}, {{name}}{{meta}}",
          n: stop.index,
          name: stop.name,
          meta: present(stop.meta) ? `, ${stop.meta}` : "",
        })}
      >
        <View style={styles.thumbWrap}>
          {present(stop.imageUrl) ? (
            <Image source={{ uri: stop.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            // A neutral tile, NOT an icon placeholder pretending to be a photo.
            <View style={styles.thumb} />
          )}
          <View
            style={styles.indexChip}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.indexText} numberOfLines={1}>
              {stop.indexLabel}
            </Text>
          </View>
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
                <Text
                  style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}
                >
                  {isOpen
                    ? t("cards:expanded.open_now")
                    : t("cards:expanded.closed")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={STOP_ROW.chevronSize}
          color={SPINE.factLabel}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.expanded}>
          {present(stop.imageUrl) ? (
            <Image source={{ uri: stop.imageUrl }} style={styles.photo} resizeMode="cover" />
          ) : null}

          {present(stop.description) ? (
            <Text style={styles.description}>{stop.description}</Text>
          ) : null}

          {weekdayLines.length > 0 ? (
            <View style={styles.hours}>
              {weekdayLines.map((line) => {
                const isToday = line.startsWith(todayName);
                return (
                  <View key={line} style={styles.hoursRow}>
                    {isToday ? <View style={styles.todayMarker} /> : <View style={styles.todaySpacer} />}
                    <Text
                      style={[styles.hoursLine, isToday ? styles.hoursLineToday : null]}
                      numberOfLines={1}
                    >
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

          {/* SIBLINGS of the row's press target — never children of it. */}
          <View style={styles.controls}>
            <Pressable
              onPress={() => onDirections(stop)}
              style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
              accessibilityRole="button"
              accessibilityLabel={t("cards:expanded.get_directions")}
            >
              <Text style={styles.controlText}>{t("cards:expanded.get_directions")}</Text>
            </Pressable>
            {stop.canReplace && onReplace ? (
              <Pressable
                onPress={() => onReplace(stop)}
                style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
                accessibilityRole="button"
                accessibilityLabel={t("cards:expanded.replace")}
              >
                <Text style={styles.controlText}>{t("cards:expanded.replace")}</Text>
              </Pressable>
            ) : null}
          </View>

          {replacePanel ? replacePanel(stop) : null}
        </View>
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
    height: STOP_ROW.height,
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
  controls: { flexDirection: "row", gap: 20 },
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
  connectorText: { fontSize: 11, fontWeight: "500", color: SPINE.factLabel },
});

export { stopMetaText };
