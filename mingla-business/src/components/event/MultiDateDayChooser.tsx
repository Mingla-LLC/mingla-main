/**
 * MultiDateDayChooser — issue #2135 [multi-date public day picker].
 *
 * The multi-date leg of the public event page: it reads this event's
 * materialised `event_dates` occurrences and renders them as an INLINE list of
 * selectable day rows, in the page flow, above the body.
 *
 * WHY INLINE RATHER THAN A SHEET (decision recorded so it is not re-litigated):
 *
 *   1. It is what the bug asks for. #2135's complaint is that a guest "can
 *      neither see nor choose the second day". A sheet fixes only the second
 *      half — every date stays hidden behind a tap nobody knows to take. Inline
 *      rows put every day on the page, unprompted.
 *   2. It keeps 10 KB out of every guest's boot payload. Reusing the /exp
 *      surface's `ExperienceReservePicker` here made that component reachable
 *      from two chunks, so Metro hoisted it (9,912 B) into `__common` — the
 *      eager payload EVERY visitor downloads, for an affordance only multi-date
 *      events use. Measured: inline costs +1,212 B, the shared sheet +10,238 B.
 *   3. A sheet is the right shape on /exp because that surface is a three-step
 *      wizard (day -> time -> party). Choosing one of a handful of days is a
 *      single decision and does not need the machinery.
 *
 * `ExperienceReservePicker` and the whole /exp surface are deliberately
 * UNTOUCHED by this file — this is a different affordance, not a competing
 * implementation of the same one.
 *
 * The host owns the SELECTION (it is what the checkout URL is built from); this
 * component owns the read and the rendering, and reports both upward.
 *
 * Anon-tolerant: no useAuth anywhere in the chain.
 */

import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";

import { usePublicEventOccurrences } from "../../hooks/usePublicEvents";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import {
  formatEventDoorsTimes,
  formatOccurrenceDayLabel,
} from "../../utils/eventDateDisplay";

export interface MultiDateDayChooserProps {
  eventId: string;
  /** The event's IANA zone, used only when an occurrence row carries none. */
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) — native bold no-ops without it. */
  fontFamily?: string;
  /** The chosen occurrence's `event_dates.id`; null until the guest picks. */
  selectedOccurrenceId: string | null;
  /**
   * True once the guest has tried to check out without choosing. Turns the
   * block into an explicit, accessible prompt instead of a silent no-op.
   */
  highlightUnchosen: boolean;
  /** Fires whenever the occurrence read resolves (or re-resolves). */
  onOccurrencesResolved: (occurrences: readonly PublicEventOccurrence[]) => void;
  onSelect: (eventDateId: string) => void;
}

const EMPTY: readonly PublicEventOccurrence[] = [];

/** "Sat 22 Aug · 11 AM – 6 PM", degrading to the day alone when times are absent. */
const rowLabel = (
  occurrence: PublicEventOccurrence,
  fallbackTimezone: string,
): string => {
  const tz =
    occurrence.timezone.length > 0 ? occurrence.timezone : fallbackTimezone;
  const day = formatOccurrenceDayLabel(occurrence.startAt, tz);
  if (day === null) return "Date to be confirmed";
  // Reuses the SINGLE owner of event time display (I-14) rather than adding
  // another local formatter.
  const { open, close } = formatEventDoorsTimes(
    occurrence.startAt,
    occurrence.endAt,
    tz,
  );
  if (open === null) return day;
  return close === null ? `${day} · ${open}` : `${day} · ${open} – ${close}`;
};

export const MultiDateDayChooser: React.FC<MultiDateDayChooserProps> = ({
  eventId,
  timezone,
  palette,
  fontFamily,
  selectedOccurrenceId,
  highlightUnchosen,
  onOccurrencesResolved,
  onSelect,
}) => {
  const query = usePublicEventOccurrences(eventId, true, timezone);
  const occurrences = query.data ?? EMPTY;

  useEffect(() => {
    onOccurrencesResolved(occurrences);
  }, [occurrences, onOccurrencesResolved]);

  // Nothing to choose between → render nothing. A multi-date event whose read
  // has not resolved, failed, or materialised a single row shows no dead
  // affordance, and the host's CTA behaves exactly as it does for single dates.
  if (occurrences.length <= 1) return null;

  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;

  return (
    <View
      style={[
        styles.host,
        { backgroundColor: palette.card, borderColor: palette.panelBorder },
        highlightUnchosen ? { borderColor: palette.accent } : null,
      ]}
      testID="issue-2135-day-chooser"
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.heading, { color: palette.primaryText }, fontStyle]}
          numberOfLines={1}
        >
          Pick your day
        </Text>
        <Text style={[styles.count, { color: palette.tertiaryText }]}>
          {occurrences.length} days
        </Text>
      </View>

      {highlightUnchosen && selectedOccurrenceId === null ? (
        <Text
          style={[styles.prompt, { color: palette.accent }, fontStyle]}
          testID="issue-2135-day-chooser-prompt"
          accessibilityRole="alert"
        >
          Choose which day you're attending to continue.
        </Text>
      ) : null}

      {/* Rows are SIBLINGS inside the radiogroup — never nested Pressables,
          which would flatten the accessibility subtree. */}
      <View accessibilityRole="radiogroup" style={styles.rows}>
        {occurrences.map((occurrence) => {
          const selected = occurrence.id === selectedOccurrenceId;
          const label = rowLabel(occurrence, timezone);
          return (
            <Pressable
              key={occurrence.id}
              onPress={() => onSelect(occurrence.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={label}
              style={[
                styles.row,
                { borderColor: palette.panelBorder },
                selected
                  ? {
                      borderColor: palette.accent,
                      backgroundColor: palette.accentWash,
                    }
                  : null,
              ]}
              testID={`issue-2135-day-row-${occurrence.id}`}
            >
              <View
                style={[
                  styles.radio,
                  { borderColor: selected ? palette.accent : palette.panelBorder },
                ]}
              >
                {selected ? (
                  <View
                    style={[styles.radioDot, { backgroundColor: palette.accent }]}
                  />
                ) : null}
              </View>
              <Text
                style={[
                  styles.rowLabel,
                  { color: selected ? palette.primaryText : palette.secondaryText },
                  fontStyle,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Palette-themed with the OPAQUE card fill + panel border the page's other
  // cards use, so Android never renders translucent glass here.
  host: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
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
  rows: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
});

export default MultiDateDayChooser;
