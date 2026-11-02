/**
 * MultiDateDayChooser — issue #2135 / #2160, wrapped onto shared EventDatePicker
 * for issue #3281 many-dates (PR 4).
 *
 * Keeps exports, testIDs, pricing copy, and the lazy-load contract. Layout
 * (chips / tiles / pass) comes from `@mingla/offering-rendering` chooseLayout.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";
import {
  EventDatePicker,
  type EventDatePickerOccurrenceRenderArgs,
} from "@mingla/offering-rendering/EventDatePicker";
import type { EventDateScheduleOccurrence } from "@mingla/offering-rendering/eventDateSchedule";

import type { MultiDatePricingMode } from "../../services/publicEventsService";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import { formatOccurrenceLine } from "../../utils/eventDateDisplay";
import { dayChooserCaptions } from "../../utils/dayChooserCaptions";
import type { TicketStub } from "../../store/draftEventStore";

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
  /** issue #3281 — drives "Sold out" and "No tickets" on each date. */
  tickets?: readonly TicketStub[];
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

/**
 * issue #2209 — the row label is owned by `formatOccurrenceLine` (I-14, the
 * single owner of event date display) so a row's accessible name and the
 * public page's eyebrow can never disagree about the same day.
 */
const rowLabel = (
  occurrence: EventDateScheduleOccurrence,
  fallbackTimezone: string,
): string =>
  formatOccurrenceLine(
    {
      id: occurrence.id,
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
      timezone: occurrence.timezone ?? fallbackTimezone,
    },
    fallbackTimezone,
  ) ?? "Date to be confirmed";

type WebTransitionStyle = ViewStyle & {
  transitionProperty: "background-color, border-color, color, opacity";
  transitionDuration: "0ms" | "150ms";
};

const webTransitionStyle = (reducedMotion: boolean): WebTransitionStyle =>
  ({
    transitionProperty: "background-color, border-color, color, opacity",
    transitionDuration: reducedMotion ? "0ms" : "150ms",
  }) as WebTransitionStyle;

const useReducedMotionOnWeb = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(() =>
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined) return undefined;
    const update = (): void => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return (): void => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
};

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
  tickets,
}) => {
  const reducedMotion = useReducedMotionOnWeb();
  const allDaysPass = allDaysPassProp === true || pricingMode === "all_days";
  const dayCaptions = useMemo(
    () => dayChooserCaptions(tickets ?? [], occurrences),
    [tickets, occurrences],
  );
  const scheduleOccurrences = useMemo(
    () => toScheduleOccurrences(occurrences, timezone),
    [occurrences, timezone],
  );

  // Nothing to choose between → render nothing (single-date stays byte-identical).
  if (state === "ready" && !allDaysPass && occurrences.length <= 1) return null;

  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const chosen = selectedOccurrenceIds.length;
  // issue #2160 §7(b) — THE PRICE BASIS IS VISIBLE BEFORE ANY TOTAL IS. An
  // all-days pass names the approved mode copy; per-day names the multiplier.
  const countLine = allDaysPass
    ? isPaid
      ? "One price for all days"
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

      {/* Rows are SIBLINGS — never nested Pressables, which would flatten the
          accessibility subtree. The group is a plain labelled container, never
          "radiogroup": this is multi-select, so each row is a checkbox. */}
      {state === "ready" ? (
        <View accessibilityLabel="Days you're attending">
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
            renderOccurrence={(row: EventDatePickerOccurrenceRenderArgs) => {
              const selected = row.selected;
              const label = rowLabel(row.occurrence, timezone);
              const detail = [
                row.title,
                row.location,
                row.placesLeftLabel,
                dayCaptions[row.occurrence.id] ?? null,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ");
              const webCheckboxProps = Platform.OS === "web"
                ? {
                    "aria-checked": selected,
                    tabIndex: 0 as const,
                    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
                      if (row.soldOut) return;
                      if ((event.key === " " || event.key === "Spacebar") && !event.repeat) {
                        event.preventDefault();
                        row.toggle();
                      }
                    },
                  }
                : {};
              return (
                <Pressable
                  key={row.key}
                  {...webCheckboxProps}
                  onPress={row.toggle}
                  disabled={row.soldOut}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: row.soldOut }}
                  accessibilityLabel={label}
                  accessibilityHint={detail.length > 0 ? detail : undefined}
                  style={[
                    styles.row,
                    { borderColor: palette.panelBorder },
                    Platform.OS === "web"
                      ? webTransitionStyle(reducedMotion)
                      : null,
                    selected
                      ? {
                          borderColor: palette.accent,
                          backgroundColor: palette.accentWash,
                        }
                      : null,
                    row.soldOut ? styles.rowSoldOut : null,
                  ]}
                  testID={row.testID}
                  nativeID={row.nativeID}
                >
                  <View
                    style={[
                      styles.check,
                      {
                        borderColor: selected
                          ? palette.accent
                          : palette.panelBorder,
                      },
                    ]}
                  >
                    {selected ? (
                      <Text style={[styles.checkMark, { color: palette.accentText }]}>
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.rowText}>
                    <Text
                      style={[
                        styles.rowLabel,
                        {
                          color: selected
                            ? palette.primaryText
                            : palette.secondaryText,
                        },
                        fontStyle,
                      ]}
                    >
                      {label}
                    </Text>
                    {detail.length > 0 ? (
                      <Text style={[styles.rowDetail, { color: palette.tertiaryText }]}>
                        {detail}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  rowSoldOut: { opacity: 0.45 },
  // issue #2160 — a SQUARE check box: the affordance means "any number".
  check: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: { fontSize: 14, lineHeight: 16, fontWeight: "900" },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontWeight: "700" },
  rowDetail: { fontSize: 12, fontWeight: "600" },
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
