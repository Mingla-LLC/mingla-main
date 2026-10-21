/**
 * issue #3281 many-dates — shared date picker (View/Pressable/Text only).
 * Surfaces wrap this (PR 4/5); no calendar library, no native modules.
 *
 * React comes from the package bridge (`offeringRenderingReact`), never from
 * `"react"` directly — see that module. A bare import raises TS2307 under the
 * #1403 typecheck ratchet and cascades every prop into implicit any.
 */

import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import {
  chooseEventDateLayout,
  formatOccurrenceChipLabel,
  occurrenceLocalDay,
  placesLeftChip,
  type EventDateScheduleOccurrence,
  type EventDateScheduleStatus,
} from "./eventDateSchedule";
import { OfferingRenderingReact as React } from "./offeringRenderingReact";

export type EventDatePickerProps = {
  occurrences: readonly EventDateScheduleOccurrence[];
  selectedIds: readonly string[];
  onToggle: (eventDateId: string) => void;
  allDaysPass?: boolean;
  status?: EventDateScheduleStatus;
  onRetry?: () => void;
  /** Accent for selected chips. */
  accentColor?: string;
  /** Muted text/border. */
  mutedColor?: string;
  style?: ViewStyle;
  testID?: string;
  /** Prefix for each occurrence Pressable testID (`{prefix}-{id}`). */
  occurrenceTestIDPrefix?: string;
  /** Prefix for each occurrence nativeID (`{prefix}-{id}`). */
  occurrenceNativeIDPrefix?: string;
};

const MIN_HIT = 44;

export function EventDatePicker({
  occurrences,
  selectedIds,
  onToggle,
  allDaysPass = false,
  status = "ready",
  onRetry,
  accentColor = "#0B6E4F",
  mutedColor = "#667085",
  style,
  testID = "event-date-picker",
  occurrenceTestIDPrefix,
  occurrenceNativeIDPrefix,
}: EventDatePickerProps) {
  const layout = React.useMemo(
    () => chooseEventDateLayout(occurrences, { allDaysPass }),
    [occurrences, allDaysPass],
  );
  const [monthIndex, setMonthIndex] = React.useState(0);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  if (status === "loading") {
    return (
      <View style={[styles.box, style]} testID={testID}>
        <Text style={{ color: mutedColor }}>Loading dates…</Text>
      </View>
    );
  }
  if (status === "error" || status === "offline" || status === "stale") {
    return (
      <View style={[styles.box, style]} testID={testID}>
        <Text style={{ color: mutedColor }}>
          {status === "offline"
            ? "You're offline — dates may be out of date."
            : "Couldn't load dates."}
        </Text>
        {typeof onRetry === "function" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading dates"
            onPress={onRetry}
            style={[styles.hit, styles.retry]}
          >
            <Text style={{ color: accentColor }}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (layout.kind === "empty") {
    return (
      <View style={[styles.box, style]} testID={testID}>
        <Text style={{ color: mutedColor }}>No upcoming dates.</Text>
      </View>
    );
  }

  if (layout.kind === "pass") {
    return (
      <View style={[styles.box, style]} testID={testID}>
        <Text style={[styles.passTitle, { color: accentColor }]}>
          Pass — all {layout.upcoming.length} dates
        </Text>
        <Text style={{ color: mutedColor }}>
          One price covers every date of this event. Nothing to pick.
        </Text>
      </View>
    );
  }

  const months = layout.months ?? [];
  const visible =
    layout.kind === "tiles" && months.length > 0
      ? months[Math.min(monthIndex, months.length - 1)]!.dates
      : layout.upcoming;

  return (
    <View style={[styles.box, style]} testID={testID}>
      {layout.kind === "tiles" && months.length > 1 ? (
        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            disabled={monthIndex <= 0}
            onPress={() => setMonthIndex((i) => Math.max(0, i - 1))}
            style={styles.hit}
          >
            <Text style={{ color: monthIndex <= 0 ? mutedColor : accentColor }}>
              ‹
            </Text>
          </Pressable>
          <Text style={{ color: mutedColor }}>
            {months[Math.min(monthIndex, months.length - 1)]!.key}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={monthIndex >= months.length - 1}
            onPress={() =>
              setMonthIndex((i) => Math.min(months.length - 1, i + 1))
            }
            style={styles.hit}
          >
            <Text
              style={{
                color:
                  monthIndex >= months.length - 1 ? mutedColor : accentColor,
              }}
            >
              ›
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.chipWrap}>
        {visible.map((o) => {
          const isOn = selected.has(o.id);
          const full = o.soldOut === true;
          const chip = placesLeftChip(o.placesLeft);
          const day =
            formatOccurrenceChipLabel(o.startAt, o.timezone) ??
            occurrenceLocalDay(o.startAt, o.timezone) ??
            "Date TBD";
          const title =
            typeof o.overrideTitle === "string" && o.overrideTitle.trim().length > 0
              ? o.overrideTitle.trim()
              : null;
          const label = title !== null ? `${day} · ${title}` : day;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isOn, disabled: full }}
              accessibilityLabel={label}
              disabled={full}
              onPress={() => onToggle(o.id)}
              style={[
                styles.chip,
                styles.hit,
                {
                  borderColor: isOn ? accentColor : mutedColor,
                  backgroundColor: isOn ? accentColor : "transparent",
                  opacity: full ? 0.45 : 1,
                },
              ]}
              testID={`${occurrenceTestIDPrefix ?? `${testID}-day`}-${o.id}`}
              {...(occurrenceNativeIDPrefix
                ? { nativeID: `${occurrenceNativeIDPrefix}-${o.id}` }
                : {})}
            >
              <Text style={{ color: isOn ? "#fff" : mutedColor }}>{label}</Text>
              {chip !== null ? (
                <Text
                  style={{
                    color: isOn ? "#fff" : mutedColor,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {chip}
                </Text>
              ) : null}
              {typeof o.overrideLocation === "string" &&
              o.overrideLocation.trim().length > 0 ? (
                <Text
                  style={{
                    color: isOn ? "#fff" : mutedColor,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {o.overrideLocation.trim()}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: MIN_HIT,
  },
  hit: { minHeight: MIN_HIT, minWidth: MIN_HIT, justifyContent: "center" },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  passTitle: { fontSize: 16, fontWeight: "600" },
  retry: { marginTop: 8 },
});
