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
  /**
   * EVERY photo this stop has, cover first. #1605 P2-3.
   *
   * §6.4 specifies "the stop's own photo strip (`StopImageGallery`, 100% x 140,
   * radius 8)" and `S-4c` forbids a `horizontal` scrollable in this file — the
   * spec is internally in tension, because `StopImageGallery` WAS a horizontal
   * ScrollView, one per stop, N of them fighting the sheet's pan gesture.
   *
   * Both are satisfied by keeping ONE photo at exactly the strip's geometry and
   * making it OPEN the lightbox on the rest. Nothing nests, and the up-to-five
   * photos a stop carries stop being unreachable — `ImageLightbox` had exactly
   * one entry point in the app and it was the deleted per-stop pager, so a
   * plan's stop photos had become undisplayable.
   */
  readonly imageUrls: readonly string[];
  /**
   * The stop's own booking / policies page. #1605 rework.
   *
   * `CuratedStop.website` is populated by the generator and rendered on `main`
   * as a per-stop "Policies & Reservations" row. Nothing in the new tree read
   * it, so a curated stop's booking link became unreachable — the same defect
   * the single-place Website row exists to fix, one level down. Already
   * normalized by the caller; `null` renders no control.
   */
  readonly website: string | null;
  readonly meta: string | null;
  readonly address: string | null;
  readonly description: string | null;
  readonly openingHours: CuratedStop["openingHours"] | undefined;
  readonly utcOffsetMinutes: number | null;
  /** Minutes from the PREVIOUS stop. `null` = no real leg; the connector is omitted. */
  readonly travelMinutes: number | null;
  readonly travelMode: string | null;
  readonly canReplace: boolean;
  /**
   * #1705 — what this stop is FOR, resolved by `stopPurpose` from the slot's own
   * `comboCategory`. `null` for any stop whose role we cannot state without
   * guessing, and the row then renders exactly as it did before.
   */
  readonly purpose: { key: string; defaultValue: string; icon: string } | null;
  /**
   * This stop is NOT one of the ones the plate counts. #1605 rework.
   *
   * `curatedPlanSpans` counts `planVisibleStops` (non-optional), and so do the
   * card's own title, total price and duration. `StopList` renders EVERY stop.
   * Before this flag existed the plate said "2 stops" above a list of three
   * identical-looking rows with nothing to tell them apart — two numbers about
   * the same plan, both right, disagreeing on one screen. An optional row is
   * now labelled in the index-chip slot and named in its accessibility label.
   */
  readonly optional: boolean;
}

interface StopListProps {
  readonly heading: string;
  /**
   * One line under the heading. #1605 rework — the deleted
   * `CompanionStopsSection` carried "Begin at one of these nearby spots before
   * your walk", which is the only thing that told the user its rows were
   * ALTERNATIVES rather than a sequence. `StopList` numbers its rows, so
   * without it a stroll's companions read as a three-stop itinerary.
   */
  readonly subtitle?: string;
  readonly stops: readonly StopListStop[];
  readonly customized?: boolean;
  readonly onDirections: (stop: StopListStop) => void;
  readonly onReplace?: (stop: StopListStop) => void;
  /** Opens the shared lightbox on this stop's photos (#1605 P2-3). */
  readonly onOpenPhotos?: (stop: StopListStop) => void;
  /** Opens the stop's own booking / policies page (#1605 rework). */
  readonly onOpenWebsite?: (stop: StopListStop) => void;
  /** Scrolls the newly opened row to `y = heroH`, so it lands under the hero. */
  readonly onExpandedRowLayout?: (y: number) => void;
  readonly replacePanel?: (stop: StopListStop) => React.ReactNode;
}

export default function StopList({
  heading,
  subtitle,
  stops,
  customized,
  onDirections,
  onReplace,
  onOpenPhotos,
  onOpenWebsite,
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
      subtitle={subtitle}
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
                {/*
                  #1706 — THE DISCLOSURE, on the same number wherever it appears.
                  This figure comes from `estimateTravelMinutes(haversineKm(...))`
                  — computed from two real coordinates, never measured. Traffic
                  was deleted from this sheet for showing a computed figure
                  UNLABELLED beside a real one; labelling it is the condition of
                  it being here (Constitution 9).
                */}
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
            onToggle={() => toggle(stop.key)}
            onDirections={onDirections}
            onReplace={onReplace}
            onOpenPhotos={onOpenPhotos}
            onOpenWebsite={onOpenWebsite}
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
  onOpenPhotos,
  onOpenWebsite,
  onExpandedRowLayout,
  replacePanel,
}: {
  stop: StopListStop;
  expanded: boolean;
  onToggle: () => void;
  onDirections: (stop: StopListStop) => void;
  onReplace?: (stop: StopListStop) => void;
  onOpenPhotos?: (stop: StopListStop) => void;
  onOpenWebsite?: (stop: StopListStop) => void;
  onExpandedRowLayout?: (y: number) => void;
  replacePanel?: (stop: StopListStop) => React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation(["cards", "expanded_details", "common"]);
  /*
    THE BADGE IS COMPUTED AGAINST VENUE-LOCAL TIME OR NOT AT ALL — AND THE
    OFFSET IS WHAT DECIDES THAT, NOT THE RESULT.

    `isPlaceOpenAt` (openingHoursUtils.ts) returns `null` ONLY when the HOURS
    are missing. When the offset is null it falls back to the DEVICE clock
    (`checkDate = targetDate`, `DAY_NAMES[checkDate.getDay()]`) and returns a
    perfectly confident BOOLEAN. So `isOpen !== null` cannot hide the
    offset-missing case: it only hides the hours-missing case, and a stop with
    hours but no offset rendered `Closed` computed against the simulator's
    clock. Observed on both platforms, #1605 P1-5.

    The offset is therefore read HERE, at the gate, rather than being inferred
    from a return value that does not carry it. #1683 owns the deeper fix (the
    serving RPCs never return the offset); until then a state we cannot compute
    is a state we do not render. Constitution 9 applied to a derived value.
  */
  const isOpenComputed = useIsPlaceOpen(stop.openingHours ?? null, stop.utcOffsetMinutes);
  const isOpen = stop.utcOffsetMinutes != null ? isOpenComputed : null;
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
        /*
          THE LABEL ANNOUNCES WHAT THE CHIP SHOWS, because the chip itself is
          `accessibilityElementsHidden`. Three cases, and two of them were wrong
          before (#1605 rework):

            optional   announced "Stop 3" while the plate said "2 stops", with
                       nothing to reconcile them. Now it says the word.
            SHOP       the picnic grocery row carries `index: 0`, so it
                       announced "Stop 0" — an ordinal that does not exist.
                       Now it is announced by name and facts, like the visual
                       row, whose chip is a word rather than a number.
            numbered   unchanged, but reads `indexLabel` so it can never drift
                       from the digit on screen.
        */
        accessibilityLabel={
          stop.optional
            ? t("cards:expanded.stop_optional_a11y", {
                defaultValue: "Optional stop, {{name}}{{meta}}",
                name: stop.name,
                meta: present(stop.meta) ? `, ${stop.meta}` : "",
              })
            : /^\d+$/.test(stop.indexLabel)
              ? t("cards:expanded.stop_a11y", {
                  defaultValue: "Stop {{n}}, {{name}}{{meta}}",
                  n: stop.indexLabel,
                  name: stop.name,
                  meta: present(stop.meta) ? `, ${stop.meta}` : "",
                })
              : t("cards:expanded.stop_unnumbered_a11y", {
                  defaultValue: "{{name}}{{meta}}",
                  name: stop.name,
                  meta: present(stop.meta) ? `, ${stop.meta}` : "",
                })
        }
      >
        <View style={styles.thumbWrap}>
          {present(stop.imageUrl) ? (
            <Image source={{ uri: stop.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            // A neutral tile, NOT an icon placeholder pretending to be a photo.
            <View style={styles.thumb} />
          )}
          {/*
            No label, no chip. An OPTIONAL stop carries no ordinal — it is not
            one of the stops the plate counts — and an empty accent pill would
            be a mark that means nothing (#1605 rework).
          */}
          {present(stop.indexLabel) ? (
            <View
              style={styles.indexChip}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
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
            {/*
              THE OPTIONAL MARKER. The plate counts `planVisibleStops`; this
              list renders all of them. Without this the two disagree in plain
              sight — "2 stops" over three identical rows. The neutral Chip is
              the same one the Plan heading's `Customized` uses; it is a fact
              about the row, not an accent.
            */}
            {stop.optional ? (
              <Chip label={t("cards:expanded.optional", { defaultValue: "Optional" })} />
            ) : null}
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

          {/*
            #1705 — WHAT THIS STOP IS FOR. Seth: "a plan that shows where to get
            flowers first... should indicate get 'flowers here'."

            A plan's rows are a name, a rating and a photo, so a supermarket and
            a park read identically and the user is left to infer why the
            supermarket is stop 1. `stopPurpose` reads the slot's own
            `comboCategory` — data the plan has always carried — and returns
            NULL for anything it cannot state without guessing, because "Pick up
            supplies here" on a cocktail bar is a plan that reads as broken.
          */}
          {stop.purpose ? (
            <View style={styles.purpose}>
              <Icon name={stop.purpose.icon} size={STOP_ROW.purposeIconSize} color={SPINE.link} />
              <Text style={styles.purposeText} numberOfLines={1}>
                {t(`cards:${stop.purpose.key}`, { defaultValue: stop.purpose.defaultValue })}
              </Text>
            </View>
          ) : null}
        </View>

        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={STOP_ROW.chevronSize}
          color={SPINE.factLabel}
        />
      </Pressable>

      {/*
        #1705 — THE CONTROLS ARE NOT BEHIND THE EXPAND ANY MORE. Seth: "Users
        should not have to expand the stops to see the replace button."

        They were inside `{expanded ? ...}`, so Directions, Call, Website and
        Replace all required discovering that the row opens at all. Replace is
        the one that matters: it is the only way to change a plan you did not
        like, and it was two taps behind a chevron.

        Still SIBLINGS of the row's press target and never children of it — a
        Pressable inside a Pressable flattens the accessibility subtree and the
        inner control stops being reachable.
      */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => onDirections(stop)}
          style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
          accessibilityRole="button"
          accessibilityLabel={t("cards:expanded.get_directions")}
        >
          <Text style={styles.controlText}>{t("cards:expanded.get_directions")}</Text>
        </Pressable>
        {/*
          THE STOP'S OWN BOOKING PAGE. `CuratedStop.website` rendered on
          `main` as a per-stop "Policies & Reservations" row and nothing in
          the new tree read it, so a stop's booking link was unreachable.
          Gated on the NORMALIZED url by the caller, exactly like the
          single-place Website row — no url, no control, no dead tap.
        */}
        {present(stop.website) && onOpenWebsite ? (
          <Pressable
            onPress={() => onOpenWebsite(stop)}
            style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
            accessibilityRole="button"
            accessibilityLabel={t("expanded_details:action_buttons.website", {
              defaultValue: "Website",
            })}
          >
            <Text style={styles.controlText}>
              {t("expanded_details:action_buttons.website", { defaultValue: "Website" })}
            </Text>
          </Pressable>
        ) : null}
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


      {expanded ? (
        <View style={styles.expanded}>
          {/*
            §6.4's photo strip, at its exact geometry (100% x 140, radius 8),
            as ONE photo that OPENS the rest — never a per-stop horizontal
            ScrollView, which is what `S-4c` forbids and what fought the sheet's
            pan gesture N times over. A stop with a second photo gets a press
            target and a count; a stop with one gets a plain image and no
            affordance that would do nothing (Constitution 1).
          */}
          {present(stop.imageUrl) && stop.imageUrls.length > 1 && onOpenPhotos ? (
            <Pressable
              onPress={() => onOpenPhotos(stop)}
              style={({ pressed }) => [styles.photoWrap, pressed ? styles.controlPressed : null]}
              accessibilityRole="button"
              accessibilityLabel={t("cards:expanded.stop_photos_a11y", {
                defaultValue: "{{count}} photos of {{name}}",
                count: stop.imageUrls.length,
                name: stop.name,
              })}
            >
              <Image source={{ uri: stop.imageUrl }} style={styles.photo} resizeMode="cover" />
              <View
                style={styles.photoCount}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Icon name="images-outline" size={12} color={SPINE.onAccent} />
                <Text style={styles.photoCountText}>{stop.imageUrls.length}</Text>
              </View>
            </Pressable>
          ) : present(stop.imageUrl) ? (
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
    // #1705 — minHeight, not height. The purpose line lives inside this row and
    // a fixed 72 clipped it. A stop with no purpose is unchanged.
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
  photoWrap: { width: "100%", height: STOP_ROW.photoStripHeight },
  photo: {
    width: "100%",
    height: STOP_ROW.photoStripHeight,
    borderRadius: STOP_ROW.photoStripRadius,
    backgroundColor: SPINE.chipFill,
  },
  // The count pill sits on the photo, so its label is the near-black on-accent
  // token (6.47:1) over the accent fill, never white (2.90:1).
  photoCount: {
    position: "absolute",
    right: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: SPINE.accentFill,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  photoCountText: { fontSize: 11, fontWeight: "700", color: SPINE.onAccent },
  description: { fontSize: 15, lineHeight: 22, color: SPINE.prose },
  hours: { gap: 2 },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  todayMarker: { width: 3, height: 16, borderRadius: 2, backgroundColor: SPINE.link },
  todaySpacer: { width: 3, height: 16 },
  hoursLine: { fontSize: 13, lineHeight: 20, color: SPINE.prose, flex: 1 },
  hoursLineToday: { fontWeight: "600", color: SPINE.link },
  address: { fontSize: 14, lineHeight: 20, color: SPINE.muted },
  /**
   * #1705 — the purpose line. `SPINE.link` (#C2410C, 5.18:1 on paper) is the ONE
   * accent this design allows as TEXT; `accentFill` measures 2.90:1 and is a
   * fill-only token.
   */
  purpose: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  purposeText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: SPINE.link,
    lineHeight: STOP_ROW.purposeLineHeight,
    flexShrink: 1,
  },
  // #1705 — the controls are a SIBLING of the row now, not a child of the
  // expanded block, so they need their own inset and breathing room.
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
