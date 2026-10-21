/**
 * MultiDateDayChooser — issue #2135 / #2160, wrapped onto shared EventDatePicker
 * for issue #3281 many-dates (PR 4).
 *
 * Keeps exports, testIDs, pricing copy, and the lazy-load contract. Layout
 * (chips / tiles / pass) comes from `@mingla/offering-rendering` chooseLayout.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";
import { EventDatePicker } from "@mingla/offering-rendering/EventDatePicker";
import type { EventDateScheduleOccurrence } from "@mingla/offering-rendering/eventDateSchedule";

import type { MultiDatePricingMode } from "../../services/publicEventsService";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";

export interface MultiDateDayChooserProps {
  /** The event's IANA zone, used only when an occurrence row carries none. */
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) — native bold no-ops without it. */
  fontFamily?: string;
  /**
   * issue #2160 / #2161 — the occurrences, handed down from the event payload.
   * The component no longer reads them: a guest surface must never read
   * `event_dates` directly (I-PROPOSED-2160-D).
   */
  occurrences: readonly PublicEventOccurrence[];
  /** The chosen `event_dates.id`s. Empty until the guest picks — never defaulted. */
  selectedOccurrenceIds: readonly string[];
  /**
   * issue #2160 — the organiser's pricing choice, so the guest learns the
   * multiplier HERE, before any total is shown.
   */
  pricingMode: MultiDatePricingMode;
  /**
   * issue #3281 — when true, show the all-days pass view (no day selection).
   * Prefer the bundle's `allDaysPass` key; falls back to pricingMode === all_days.
   */
  allDaysPass?: boolean;
  /** True when this event has at least one ticket priced above zero. */
  isPaid: boolean;
  /**
   * True once the guest has tried to check out without choosing. Turns the
   * block into an explicit, accessible prompt instead of a silent no-op.
   */
  highlightUnchosen: boolean;
  /** issue #2399 — explicit fail-closed occurrence truth state. */
  state?: "ready" | "error" | "offline" | "stale";
  onRetry?: () => void;
  onToggle: (eventDateId: string) => void;
}

const toScheduleOccurrences = (
  occurrences: readonly PublicEventOccurrence[],
  fallbackTimezone: string,
): EventDateScheduleOccurrence[] =>
  occurrences.map((o) => ({
    id: o.id,
    startAt: o.startAt,
    endAt: o.endAt,
    timezone: o.timezone || fallbackTimezone,
    overrideTitle: o.overrideTitle ?? null,
    overrideLocation: o.overrideLocation ?? null,
    soldOut: o.soldOut ?? null,
    placesLeft: o.placesLeft ?? o.ticketsRemaining ?? null,
  }));

export const MultiDateDayChooser: React.FC<MultiDateDayChooserProps> = ({
  timezone,
  palette,
  fontFamily,
  occurrences,
  selectedOccurrenceIds,
  pricingMode,
  allDaysPass: allDaysPassProp,
  isPaid,
  highlightUnchosen,
  state = "ready",
  onRetry,
  onToggle,
}) => {
  const allDaysPass = allDaysPassProp === true || pricingMode === "all_days";
  const scheduleOccurrences = useMemo(
    () => toScheduleOccurrences(occurrences, timezone),
    [occurrences, timezone],
  );

  // Nothing to choose between → render nothing (single-date stays byte-identical).
  if (state === "ready" && !allDaysPass && occurrences.length <= 1) return null;

  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const chosen = selectedOccurrenceIds.length;
  const countLine = allDaysPass
    ? isPaid
      ? "One price covers every date"
      : "Every date of this event"
    : chosen === 0
      ? `${occurrences.length} days`
      : isPaid && pricingMode === "per_day"
        ? `Priced per day · ${chosen} of ${occurrences.length} selected`
        : `${chosen} of ${occurrences.length} selected`;

  const recovery =
    state === "error"
      ? { message: "We couldn’t load the event days.", action: "Try again" }
      : state === "offline"
        ? { message: "You’re offline. Reconnect to continue.", action: null }
        : state === "stale"
          ? {
              message: "Those dates just changed. Refresh and choose again.",
              action: "Refresh days",
            }
          : null;

  return (
    <View
      style={[
        styles.host,
        { borderBottomColor: palette.panelBorder },
        highlightUnchosen ? { borderBottomColor: palette.accent } : null,
      ]}
      testID="issue-2135-day-chooser"
      nativeID="issue-2399-day-section"
      tabIndex={-1}
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.heading, { color: palette.primaryText }, fontStyle]}
        >
          {allDaysPass ? "Your dates" : "Pick your days"}
        </Text>
        <Text style={[styles.count, { color: palette.tertiaryText }]}>
          {countLine}
        </Text>
      </View>

      {highlightUnchosen && !allDaysPass && chosen === 0 ? (
        <Text
          style={[styles.prompt, { color: palette.accent }, fontStyle]}
          testID="issue-2135-day-chooser-prompt"
          accessibilityRole="alert"
        >
          Choose at least one day {"you're"} attending to continue.
        </Text>
      ) : null}

      {recovery !== null ? (
        <View style={styles.recovery}>
          <Text
            style={[styles.prompt, { color: palette.accent }, fontStyle]}
            accessibilityRole="alert"
            testID="issue-2399-day-recovery"
          >
            {recovery.message}
          </Text>
          {recovery.action !== null && onRetry !== undefined ? (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={recovery.action}
              style={[styles.retry, { borderColor: palette.accent }]}
            >
              <Text
                style={[styles.retryText, { color: palette.accent }, fontStyle]}
              >
                {recovery.action}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {state === "ready" ? (
        <EventDatePicker
          occurrences={scheduleOccurrences}
          selectedIds={selectedOccurrenceIds}
          onToggle={onToggle}
          allDaysPass={allDaysPass}
          status="ready"
          onRetry={onRetry}
          accentColor={palette.accent}
          mutedColor={palette.tertiaryText}
          occurrenceTestIDPrefix="issue-2135-day-row"
          occurrenceNativeIDPrefix="issue-2160-day-row"
          testID="issue-2135-day-picker"
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    borderBottomWidth: 1,
    paddingBottom: 14,
    marginBottom: 8,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: { flex: 1, fontSize: 14, fontWeight: "900", letterSpacing: -0.2 },
  count: { fontSize: 12, fontWeight: "700" },
  prompt: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  recovery: { gap: 8 },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  retryText: { fontSize: 13, fontWeight: "800" },
});

export default MultiDateDayChooser;
