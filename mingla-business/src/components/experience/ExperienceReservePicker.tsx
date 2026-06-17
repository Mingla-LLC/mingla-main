/**
 * ExperienceReservePicker — ORCH-1138 Leg 3 (§4.4 / §4.5).
 *
 * The web/business public-page (`/exp/`) adaptive-reservation surface. ONE
 * component, two modes (driven by `mode`):
 *
 *   mode="slots" — a recurring / multi-date experience with >1 bookable
 *     occurrence. Lists the upcoming occurrences (from materialized event_dates),
 *     each with its "N left" / sold-out state; the buyer picks one slot →
 *     Reserve confirms with that occurrence's eventDateId. (The single-occurrence
 *     / one-off case never reaches this picker — the route auto-selects + goes
 *     straight to cart, §4.4.)
 *
 *   mode="open-daily" — a daily/recurring "open daily within hours" experience
 *     (OQ-5: "any time within the window"). The buyer picks a DATE (from the
 *     materialized daily occurrences), then ANY time within that occurrence's
 *     [start_at, end_at] window (free time entry bounded by the window — no
 *     fabricated fixed slots), then a PARTY size (= cart quantity, never new
 *     line items — I-1). Reserve confirms with the chosen occurrence's
 *     eventDateId + party-size.
 *
 * Web/native-safe: built on the `Sheet` primitive (has a `.web.tsx`), a plain
 * RN Modal-free surface. Palette-themed (ANDROID opaque fills via the page
 * palette, no translucent glass). Selection-only — owns NO money; the route
 * routes the confirmed (eventDateId, quantity) into the existing checkout chain
 * (byte-identical except the already-supported eventDateId + quantity).
 *
 * Anon-tolerant: no useAuth, no fetch — the route passes resolved occurrences.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/event-rendering";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";
import type { PublicExperienceDate } from "../../services/publicExperienceService";

export type ExperienceReserveMode = "slots" | "open-daily";

export interface ExperienceReserveSelection {
  /** The chosen occurrence's event_dates.id. */
  eventDateId: string;
  /** Party size (open-daily) → cart quantity. Always ≥1; 1 in slots mode. */
  quantity: number;
}

export interface ExperienceReservePickerProps {
  visible: boolean;
  mode: ExperienceReserveMode;
  /** Upcoming bookable occurrences (sold-out ones still shown, disabled). */
  dates: ReadonlyArray<PublicExperienceDate>;
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) for headings/values. */
  fontFamily?: string;
  /** Event-level remaining caps the party-size stepper (open-daily). */
  eventRemaining: number | null;
  onCancel: () => void;
  onConfirm: (selection: ExperienceReserveSelection) => void;
}

const SHEET_SNAP = "full" as const;
const MAX_PARTY = 12;

function formatDateLabel(startAt: string, timezone: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }
}

function formatDayLabel(startAt: string, timezone: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: timezone || "UTC",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
  }
}

function formatWindow(startAt: string, endAt: string, timezone: string): string {
  const fmt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone || "UTC",
      }).format(d);
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
  };
  const s = fmt(startAt);
  const e = fmt(endAt);
  return s.length > 0 && e.length > 0 ? `${s} – ${e}` : s;
}

/** Build the bound clock minutes [openMin, closeMin] of an occurrence window. */
function windowMinutes(
  startAt: string,
  endAt: string,
): { open: number; close: number } | null {
  const s = new Date(startAt);
  const e = new Date(endAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const open = s.getHours() * 60 + s.getMinutes();
  let close = e.getHours() * 60 + e.getMinutes();
  if (close <= open) close += 24 * 60; // wrap past midnight
  return { open, close };
}

function remainingChip(remaining: number | null): string | null {
  if (remaining === null) return null;
  if (remaining <= 0) return "Sold out";
  if (remaining <= 10) return `${remaining} left`;
  return "Available";
}

export const ExperienceReservePicker: React.FC<ExperienceReservePickerProps> = ({
  visible,
  mode,
  dates,
  timezone,
  palette,
  fontFamily,
  eventRemaining,
  onCancel,
  onConfirm,
}) => {
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  // Open-daily: chosen time-within-window (minutes from midnight) + party size.
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [party, setParty] = useState<number>(2);

  // ORCH-1153 BUG-4 (Seth device, /exp date picker "dead"): reset the selection
  // whenever the sheet opens so a re-open starts clean (a stale selectedDateId
  // from a prior open could point at a date no longer in `dates` → selectedDate
  // resolves null → Reserve stays disabled even after a fresh tap). Mirrors the
  // consumer picker's expected fresh-open behavior.
  useEffect(() => {
    if (visible) {
      setSelectedDateId(null);
      setSelectedMinute(null);
      setParty(2);
    }
  }, [visible]);

  const selectedDate = useMemo(
    () => dates.find((d) => d.id === selectedDateId) ?? null,
    [dates, selectedDateId],
  );

  // Open-daily: free 30-min-step time choices BOUNDED by the occurrence window
  // (OQ-5 — "any time within the window"; the 30-min step is presentation only,
  // every offered time is genuinely inside the authored open/close hours).
  const timeChoices = useMemo<number[]>(() => {
    if (mode !== "open-daily" || selectedDate === null) return [];
    const w = windowMinutes(selectedDate.startAt, selectedDate.endAt);
    if (w === null) return [];
    const out: number[] = [];
    for (let m = w.open; m <= w.close; m += 30) out.push(m % (24 * 60));
    return out;
  }, [mode, selectedDate]);

  const partyMax = Math.min(
    MAX_PARTY,
    eventRemaining === null ? MAX_PARTY : Math.max(1, eventRemaining),
  );

  const canConfirm =
    mode === "slots"
      ? selectedDate !== null &&
        (selectedDate.ticketsRemaining === null ||
          selectedDate.ticketsRemaining > 0)
      : selectedDate !== null && selectedMinute !== null;

  const handleConfirm = (): void => {
    if (selectedDate === null) return;
    if (mode === "slots") {
      onConfirm({ eventDateId: selectedDate.id, quantity: 1 });
      return;
    }
    if (selectedMinute === null) return;
    onConfirm({ eventDateId: selectedDate.id, quantity: party });
  };

  const formatMinute = (min: number): string => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  return (
    <Sheet visible={visible} onClose={onCancel} snapPoint={SHEET_SNAP}>
      <View style={[styles.host, { backgroundColor: palette.page }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: palette.primaryText }, fontStyle]}>
            {mode === "open-daily" ? "Reserve a spot" : "Pick a date"}
          </Text>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={[styles.closeIcon, { backgroundColor: palette.card }]}
          >
            <Icon name="close" size={20} color={palette.secondaryText} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* ---- DATE LIST (both modes) ---- */}
          <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
            {mode === "open-daily" ? "CHOOSE A DAY" : "UPCOMING DATES"}
          </Text>
          {dates.length === 0 ? (
            <Text style={[styles.empty, { color: palette.secondaryText }]}>
              No upcoming dates available.
            </Text>
          ) : (
            <View
              accessibilityRole="radiogroup"
              style={styles.dateCol}
            >
              {dates.map((d) => {
                const soldOut =
                  d.ticketsRemaining !== null && d.ticketsRemaining <= 0;
                const selected = selectedDateId === d.id;
                const chip = remainingChip(d.ticketsRemaining);
                return (
                  <Pressable
                    key={d.id}
                    onPress={
                      soldOut
                        ? undefined
                        : () => {
                            setSelectedDateId(d.id);
                            setSelectedMinute(null);
                          }
                    }
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
                      { backgroundColor: palette.card, borderColor: palette.panelBorder },
                      selected
                        ? { borderColor: palette.accent, backgroundColor: palette.accentWash }
                        : null,
                      soldOut ? styles.dateRowDisabled : null,
                    ]}
                  >
                    <Text
                      style={[styles.dateLabel, { color: palette.primaryText }, fontStyle]}
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
                            ? { color: "#f87171", backgroundColor: "rgba(248,113,113,0.14)" }
                            : (d.ticketsRemaining ?? 99) <= 10
                              ? { color: "#fbbf24", backgroundColor: "rgba(251,191,36,0.14)" }
                              : { color: palette.accent, backgroundColor: palette.accentWash },
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

          {/* ---- OPEN-DAILY: time-within-window + party size ---- */}
          {mode === "open-daily" && selectedDate !== null ? (
            <>
              <Text
                style={[styles.sectionLabel, styles.sectionGap, { color: palette.tertiaryText }]}
              >
                CHOOSE A TIME · {formatWindow(selectedDate.startAt, selectedDate.endAt, timezone)}
              </Text>
              <View style={styles.timeWrap}>
                {timeChoices.map((min) => {
                  const selected = selectedMinute === min;
                  return (
                    <Pressable
                      key={min}
                      onPress={() => setSelectedMinute(min)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={formatMinute(min)}
                      style={[
                        styles.timeChip,
                        { backgroundColor: palette.card, borderColor: palette.panelBorder },
                        selected
                          ? { borderColor: palette.accent, backgroundColor: palette.accentWash }
                          : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.timeChipText,
                          { color: selected ? palette.accent : palette.primaryText },
                          fontStyle,
                        ]}
                      >
                        {formatMinute(min)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View
                style={[
                  styles.party,
                  { backgroundColor: palette.card, borderColor: palette.panelBorder },
                ]}
              >
                <View style={styles.partyTextCol}>
                  <Text style={[styles.partyLabel, { color: palette.primaryText }, fontStyle]}>
                    Party size
                  </Text>
                  <Text style={[styles.partySub, { color: palette.tertiaryText }]}>
                    {partyMax < MAX_PARTY ? `Up to ${partyMax}` : "How many in your group?"}
                  </Text>
                </View>
                <View style={styles.partyCtrl}>
                  <Pressable
                    onPress={() => setParty((p) => Math.max(1, p - 1))}
                    disabled={party <= 1}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease party size"
                    style={[
                      styles.partyBtn,
                      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
                      party <= 1 ? styles.partyBtnDisabled : null,
                    ]}
                  >
                    <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>−</Text>
                  </Pressable>
                  <Text style={[styles.partyCount, { color: palette.primaryText }, fontStyle]}>
                    {party}
                  </Text>
                  <Pressable
                    onPress={() => setParty((p) => Math.min(partyMax, p + 1))}
                    disabled={party >= partyMax}
                    accessibilityRole="button"
                    accessibilityLabel="Increase party size"
                    style={[
                      styles.partyBtn,
                      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
                      party >= partyMax ? styles.partyBtnDisabled : null,
                    ]}
                  >
                    <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>+</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}

          {/* ---- Confirm Reserve ----
              ORCH-1153 BUG-4: the Confirm button lives INSIDE the ScrollView (the
              LAST scroll child), mirroring the working consumer picker. When it
              was a fixed footer OUTSIDE the scroll, the open-daily time + party
              sections (which appear BELOW the date list after a date is tapped)
              and the button could land off-screen / collapse inside the desktop
              centred card (cardBody flexShrink:1, host flex:1 with no bounded
              height), so date selection appeared to "do nothing" — the buyer
              could never scroll to the time step that enables Reserve. One scroll
              makes the whole date→time→party→Reserve flow reachable, and the
              button re-renders with `canConfirm` as selection state changes. */}
          <Pressable
            onPress={canConfirm ? handleConfirm : undefined}
            disabled={!canConfirm}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}
            accessibilityLabel="Reserve"
            style={[
              styles.confirm,
              canConfirm
                ? { backgroundColor: palette.accent }
                : { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder, borderWidth: 1 },
            ]}
            testID="orch-1138-experience-reserve-confirm"
          >
            <Text
              style={[
                styles.confirmText,
                { color: canConfirm ? palette.accentText : palette.tertiaryText },
                fontStyle,
              ]}
            >
              Reserve →
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  scrollContent: { paddingBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  sectionGap: { marginTop: 20 },
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
  timeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
  },
  timeChipText: { fontSize: 13, fontWeight: "800" },
  party: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 20,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  partyTextCol: { flex: 1, minWidth: 0 },
  partyLabel: { fontSize: 14, fontWeight: "800" },
  partySub: { fontSize: 11, marginTop: 1 },
  partyCtrl: { flexDirection: "row", alignItems: "center", gap: 14 },
  partyBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  partyBtnDisabled: { opacity: 0.35 },
  partyBtnText: { fontSize: 22, fontWeight: "800", lineHeight: 24 },
  partyCount: {
    fontSize: 20,
    fontWeight: "900",
    minWidth: 22,
    textAlign: "center",
  },
  confirm: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  confirmText: { fontSize: 16, fontWeight: "900" },
});

export default ExperienceReservePicker;
