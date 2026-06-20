/**
 * ExperienceReservePicker (app-mobile) — ORCH-1138 Leg 3 rework (§4.C.6).
 *
 * The CONSUMER adaptive-reservation surface. ONE component, two modes:
 *
 *   mode="slots" — a recurring / multi-date experience with >1 bookable
 *     occurrence. Lists the upcoming occurrences (materialized event_dates),
 *     each with its "N left" / sold-out state; the buyer picks one →
 *     onConfirm({eventDateId, quantity:1}). (A one-off never reaches the picker
 *     — the screen auto-selects + goes straight to cart.)
 *
 *   mode="open-daily" — a daily/recurring "open daily within hours" experience.
 *     The buyer picks a DATE (from the materialized daily occurrences), then ANY
 *     time within that occurrence's [startAt, endAt] window (30-min step,
 *     presentation-only — every offered time is inside the authored window),
 *     then a PARTY size (= cart quantity, never a new line item — I-1). Reserve
 *     confirms with the chosen occurrence's eventDateId + party-size.
 *
 * PORTED from mingla-business/src/components/experience/ExperienceReservePicker.tsx
 * (NOT imported — 🔒 I-MOR-0827-PACKAGE-ISOLATION). Built on the consumer
 * BaseBottomSheet (the SOLE gorhom consumer; scroll structure preserved —
 * feedback_rn_sub_sheet_must_render_inside_parent). Palette-themed; Android
 * opaque-glass fallback via the page palette (no translucent glass).
 *
 * Selection-only — owns NO money. The party-size maps to the cart quantity; the
 * checkout request stays byte-identical (eventDateId + quantity only — I-1).
 */

import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ThemePalette } from "@mingla/offering-rendering";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";
import type { ExperienceOccurrence } from "./ExperienceOccurrencePicker";

export type ExperienceReserveMode = "slots" | "open-daily";

export interface ExperienceReserveSelection {
  /** The chosen occurrence's event_dates.id. */
  eventDateId: string;
  /** Party size (open-daily) → cart quantity. Always >=1; 1 in slots mode. */
  quantity: number;
}

export interface ExperienceReservePickerProps {
  visible: boolean;
  mode: ExperienceReserveMode;
  /** Upcoming bookable occurrences (sold-out ones still shown, disabled). */
  occurrences: ReadonlyArray<ExperienceOccurrence>;
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) for headings/values. */
  fontFamily?: string;
  /** Event-level remaining caps the party-size stepper (open-daily). */
  eventRemaining: number | null;
  onCancel: () => void;
  onConfirm: (selection: ExperienceReserveSelection) => void;
}

const SHEET_SNAP_POINTS = ["88%"];
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

function formatWindow(
  startAt: string,
  endAt: string,
  timezone: string,
): string {
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

/** Build the bound clock minutes [open, close] of an occurrence window. */
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

export const ExperienceReservePicker: React.FC<
  ExperienceReservePickerProps
> = ({
  visible,
  mode,
  occurrences,
  timezone,
  palette,
  fontFamily,
  eventRemaining,
  onCancel,
  onConfirm,
}) => {
  const insets = useSafeAreaInsets();
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [party, setParty] = useState<number>(2);

  const selectedDate = useMemo(
    () => occurrences.find((o) => o.eventDateId === selectedDateId) ?? null,
    [occurrences, selectedDateId],
  );

  // Open-daily: 30-min-step time choices BOUNDED by the occurrence window
  // (every offered time is genuinely inside the authored open/close hours).
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
        (selectedDate.remaining === null || selectedDate.remaining > 0)
      : selectedDate !== null && selectedMinute !== null;

  const handleConfirm = (): void => {
    if (selectedDate === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (mode === "slots") {
      onConfirm({ eventDateId: selectedDate.eventDateId, quantity: 1 });
      return;
    }
    if (selectedMinute === null) return;
    onConfirm({ eventDateId: selectedDate.eventDateId, quantity: party });
  };

  const formatMinute = (min: number): string => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  // Android opaque-glass fallback (ANDROID-GLASS-OPAQUE): the sheet + cards use
  // the page palette's solid fills; no translucent blur on Android.
  const sheetBg = { backgroundColor: palette.page };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onCancel}
      theme="dark"
      snapPoints={SHEET_SNAP_POINTS}
      backgroundStyle={{ ...styles.sheetBackground, ...sheetBg }}
      handleStyle={{
        ...styles.handleIndicator,
        backgroundColor: palette.panelBorder,
      }}
      accessibilityLabel={mode === "open-daily" ? "Reserve a time" : "Pick a date"}
      scrollMode="scroll"
      hidesBottomNav
      scrollProps={{
        contentContainerStyle: [
          styles.scrollContent,
          {
            paddingBottom:
              BOTTOM_NAV_CONTENT_HEIGHT + Math.max(insets.bottom, 16) + 72,
          },
        ],
        showsVerticalScrollIndicator: false,
      }}
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.headerTitle, { color: palette.primaryText }, fontStyle]}
        >
          {mode === "open-daily" ? "Reserve a time" : "Pick a date"}
        </Text>
        <Pressable
          style={[styles.closeIcon, { backgroundColor: palette.card }]}
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onCancel}
        >
          <Icon name="close" size={20} color={palette.secondaryText} />
        </Pressable>
      </View>

      {/* ---- DATE LIST (both modes) ---- */}
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        {mode === "open-daily" ? "CHOOSE A DAY" : "UPCOMING DATES"}
      </Text>
      {occurrences.length === 0 ? (
        <Text style={[styles.empty, { color: palette.secondaryText }]}>
          No upcoming dates available.
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.dateCol}>
          {occurrences.map((o) => {
            const soldOut = o.remaining !== null && o.remaining <= 0;
            const selected = selectedDateId === o.eventDateId;
            const chip = remainingChip(o.remaining);
            return (
              <Pressable
                key={o.eventDateId}
                onPress={
                  soldOut
                    ? undefined
                    : () => {
                        void Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Light,
                        );
                        setSelectedDateId(o.eventDateId);
                        setSelectedMinute(null);
                      }
                }
                disabled={soldOut}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: soldOut }}
                accessibilityLabel={`${
                  mode === "open-daily"
                    ? formatDayLabel(o.startAt, timezone)
                    : formatDateLabel(o.startAt, timezone)
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
                    ? formatDayLabel(o.startAt, timezone)
                    : formatDateLabel(o.startAt, timezone)}
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
                        : (o.remaining ?? 99) <= 10
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

      {/* ---- OPEN-DAILY: time-within-window + party size ---- */}
      {mode === "open-daily" && selectedDate !== null ? (
        <>
          <Text
            style={[
              styles.sectionLabel,
              styles.sectionGap,
              { color: palette.tertiaryText },
            ]}
          >
            CHOOSE A TIME ·{" "}
            {formatWindow(selectedDate.startAt, selectedDate.endAt, timezone)}
          </Text>
          <View style={styles.timeWrap}>
            {timeChoices.map((min) => {
              const selected = selectedMinute === min;
              return (
                <Pressable
                  key={min}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedMinute(min);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={formatMinute(min)}
                  style={[
                    styles.timeChip,
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
                  ]}
                >
                  <Text
                    style={[
                      styles.timeChipText,
                      {
                        color: selected ? palette.accent : palette.primaryText,
                      },
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
              {
                backgroundColor: palette.card,
                borderColor: palette.panelBorder,
              },
            ]}
          >
            <View style={styles.partyTextCol}>
              <Text
                style={[
                  styles.partyLabel,
                  { color: palette.primaryText },
                  fontStyle,
                ]}
              >
                Party size
              </Text>
              <Text style={[styles.partySub, { color: palette.tertiaryText }]}>
                {partyMax < MAX_PARTY
                  ? `Up to ${partyMax}`
                  : "How many in your group?"}
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
                  {
                    backgroundColor: palette.accentWash,
                    borderColor: palette.panelBorder,
                  },
                  party <= 1 ? styles.partyBtnDisabled : null,
                ]}
              >
                <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>
                  −
                </Text>
              </Pressable>
              <Text
                style={[
                  styles.partyCount,
                  { color: palette.primaryText },
                  fontStyle,
                ]}
              >
                {party}
              </Text>
              <Pressable
                onPress={() => setParty((p) => Math.min(partyMax, p + 1))}
                disabled={party >= partyMax}
                accessibilityRole="button"
                accessibilityLabel="Increase party size"
                style={[
                  styles.partyBtn,
                  {
                    backgroundColor: palette.accentWash,
                    borderColor: palette.panelBorder,
                  },
                  party >= partyMax ? styles.partyBtnDisabled : null,
                ]}
              >
                <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>
                  +
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}

      {/* ---- Confirm Reserve ---- */}
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
            : {
                backgroundColor: palette.panelStrong,
                borderColor: palette.panelBorder,
                borderWidth: 1,
              },
        ]}
        testID="orch-1138-consumer-experience-reserve-confirm"
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
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    // ANDROID-GLASS-OPAQUE — clip + opaque fill (no translucent blur).
    ...Platform.select({ android: { overflow: "hidden" } }),
  },
  handleIndicator: { width: 44 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "900", lineHeight: 26 },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
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
    marginTop: 24,
  },
  confirmText: { fontSize: 16, fontWeight: "900" },
});

export default ExperienceReservePicker;
