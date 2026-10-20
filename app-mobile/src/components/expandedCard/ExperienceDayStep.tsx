/**
 * ExperienceDayStep (Explorer) — issue #3281 seam for the reserve picker's day
 * list. Twin of mingla-business ExperienceDayStep so the many-dates track can
 * swap one file per surface.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";
// issue #3281 R3 — DEEP specifier: pure, so a partial barrel mock cannot blank it.
import { experienceRemainingChipText } from "@mingla/offering-rendering/experienceR3";

import type { ExperienceOccurrence } from "./ExperienceOccurrencePicker";

export interface ExperienceDayStepProps {
  mode: "slots" | "open-daily";
  occurrences: ReadonlyArray<ExperienceOccurrence>;
  timezone: string;
  palette: ThemePalette;
  fontStyle: { fontFamily: string } | null;
  selectedDateId: string | null;
  onSelectDate: (eventDateId: string) => void;
  formatDayLabel: (startAt: string, timezone: string) => string;
  formatDateLabel: (startAt: string, timezone: string) => string;
  remainingChip: (remaining: number | null) => string | null;
}

export const ExperienceDayStep: React.FC<ExperienceDayStepProps> = ({
  mode,
  occurrences,
  timezone,
  palette,
  fontStyle,
  selectedDateId,
  onSelectDate,
  formatDayLabel,
  formatDateLabel,
  remainingChip,
}) => {
  return (
    <>
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        {mode === "open-daily" ? "CHOOSE A DAY" : "UPCOMING DATES"}
      </Text>
      {occurrences.length === 0 ? (
        <Text style={[styles.empty, { color: palette.secondaryText }]}>
          No upcoming dates available.
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.dateCol}>
          {occurrences.map((d) => {
            const soldOut = d.remaining !== null && d.remaining <= 0;
            const selected = selectedDateId === d.eventDateId;
            // issue #3281 R3 — a numeric remaining reads "N left" / "Full"; unlimited or
            // unknown (null) keeps the surface's own wording.
            const chip =
              experienceRemainingChipText(d.remaining) ?? remainingChip(d.remaining);
            return (
              <Pressable
                key={d.eventDateId}
                onPress={soldOut ? undefined : () => onSelectDate(d.eventDateId)}
                disabled={soldOut}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: soldOut }}
                accessibilityLabel={`${
                  mode === "open-daily"
                    ? formatDayLabel(d.startAt, timezone)
                    : formatDateLabel(d.startAt, timezone)
                }${chip !== null ? `, ${chip}` : ""}`}
                style={[
                  styles.dateRow,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.panelBorder,
                  },
                  selected
                    ? {
                        borderColor: palette.accent,
                        backgroundColor: palette.accentWash,
                      }
                    : null,
                  soldOut ? styles.dateRowDisabled : null,
                ]}
              >
                <Text
                  style={[
                    styles.dateLabel,
                    { color: palette.primaryText },
                    fontStyle,
                  ]}
                  numberOfLines={1}
                >
                  {mode === "open-daily"
                    ? formatDayLabel(d.startAt, timezone)
                    : formatDateLabel(d.startAt, timezone)}
                </Text>
                {chip !== null ? (
                  <Text
                    style={[
                      styles.chip,
                      soldOut
                        ? {
                            color: "#f87171",
                            backgroundColor: "rgba(248,113,113,0.14)",
                          }
                        : (d.remaining ?? 99) <= 10
                          ? {
                              color: "#fbbf24",
                              backgroundColor: "rgba(251,191,36,0.14)",
                            }
                          : {
                              color: palette.accent,
                              backgroundColor: palette.accentWash,
                            },
                    ]}
                  >
                    {chip}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  empty: { fontSize: 15, paddingVertical: 16 },
  dateCol: { gap: 10 },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  dateRowDisabled: { opacity: 0.45 },
  dateLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
  chip: {
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
});

export default ExperienceDayStep;
