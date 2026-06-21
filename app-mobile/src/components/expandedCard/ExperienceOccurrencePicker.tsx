/**
 * ExperienceOccurrencePicker — ORCH-1072 [experience-detail-cover-availability].
 *
 * Operator-locked flow (PICK FROM UPCOMING DATES): a brand experience's Book
 * sheet first lets the buyer pick from upcoming occurrences (from event_dates),
 * each showing its remaining capacity. Tapping a date selects it; the parent
 * then opens the existing TicketCartSheet for quantity → pay with the chosen
 * event_date_id threaded into ticket-checkout-create.
 *
 * - A ONE-OFF experience (single occurrence) never reaches this sheet — the
 *   parent auto-selects the only date and skips straight to the cart.
 * - Sold-out occurrences (remaining === 0) render DISABLED.
 * - remaining === null ⇒ unlimited → no remaining chip, always selectable.
 *
 * Reuses BaseBottomSheet + the dark sheet vocabulary from TicketCartSheet (no
 * new sheet framework). This is a SELECTION surface only — it owns no money.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";

export interface ExperienceOccurrence {
  eventDateId: string;
  startAt: string;
  endAt: string;
  capacity: number | null;
  sold: number;
  remaining: number | null;
}

export interface ExperienceOccurrencePickerProps {
  visible: boolean;
  occurrences: ReadonlyArray<ExperienceOccurrence>;
  timezone: string;
  onCancel: () => void;
  /** Fires with the chosen occurrence's event_date_id. */
  onSelect: (eventDateId: string) => void;
}

const SHEET_SNAP_POINTS = ["72%"];

/** Format an occurrence's start instant in the experience's timezone. */
const formatOccurrence = (startAt: string, timezone: string): string => {
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
};

/** The remaining-capacity chip copy for one occurrence. */
const remainingLabel = (remaining: number | null): string | null => {
  if (remaining === null) return null; // unlimited → no chip
  if (remaining <= 0) return "Sold out";
  if (remaining <= 10) return `${remaining} left`;
  return "Available";
};

export const ExperienceOccurrencePicker: React.FC<
  ExperienceOccurrencePickerProps
> = ({ visible, occurrences, timezone, onCancel, onSelect }) => {
  const insets = useSafeAreaInsets();

  const rows = useMemo(
    () =>
      occurrences.map((o) => ({
        ...o,
        label: formatOccurrence(o.startAt, timezone),
        remainingText: remainingLabel(o.remaining),
        soldOut: o.remaining !== null && o.remaining <= 0,
      })),
    [occurrences, timezone],
  );

  const handlePick = (eventDateId: string, soldOut: boolean): void => {
    if (soldOut) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(eventDateId);
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onCancel}
      theme="dark"
      snapPoints={SHEET_SNAP_POINTS}
      backgroundStyle={styles.sheetBackground}
      handleStyle={styles.handleIndicator}
      accessibilityLabel="Pick a date"
      scrollMode="scroll"
      hidesBottomNav
      // ORCH-1192 — z-stack ABOVE the now-wrapInRNModal experience detail sheet
      // (same as TicketCartSheet). Without this the picker hides behind the modal.
      wrapInRNModal
      scrollProps={{
        contentContainerStyle: [
          styles.scrollContent,
          {
            paddingBottom:
              BOTTOM_NAV_CONTENT_HEIGHT + Math.max(insets.bottom, 16),
          },
        ],
        showsVerticalScrollIndicator: false,
      }}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Pick a date</Text>
        <Pressable
          style={styles.closeIcon}
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onCancel}
        >
          <Icon name="close" size={20} color="rgba(255,255,255,0.65)" />
        </Pressable>
      </View>
      <Text style={styles.sectionLabel}>UPCOMING DATES</Text>
      {rows.length === 0 ? (
        <Text style={styles.emptyText}>No upcoming dates available.</Text>
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.eventDateId}
            onPress={() => handlePick(row.eventDateId, row.soldOut)}
            disabled={row.soldOut}
            accessibilityRole="button"
            accessibilityState={{ disabled: row.soldOut }}
            accessibilityLabel={`${row.label}${
              row.remainingText ? `, ${row.remainingText}` : ""
            }`}
            style={({ pressed }) => [
              styles.dateRow,
              row.soldOut && styles.dateRowDisabled,
              pressed && !row.soldOut && styles.dateRowPressed,
            ]}
          >
            <View style={styles.dateRowMain}>
              <Text
                style={[
                  styles.dateLabel,
                  row.soldOut && styles.dateLabelDisabled,
                ]}
                numberOfLines={1}
              >
                {row.label}
              </Text>
              {row.remainingText ? (
                <Text
                  style={[
                    styles.remainingChip,
                    row.soldOut
                      ? styles.remainingChipSoldOut
                      : (row.remaining ?? 99) <= 10
                        ? styles.remainingChipLow
                        : styles.remainingChipOk,
                  ]}
                >
                  {row.remainingText}
                </Text>
              ) : null}
            </View>
            {!row.soldOut ? (
              <Icon
                name="chevron-forward"
                size={18}
                color="rgba(255,255,255,0.45)"
              />
            ) : null}
          </Pressable>
        ))
      )}
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    width: 44,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  headerTitle: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.52)",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.65)",
    paddingVertical: 16,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  dateRowDisabled: {
    opacity: 0.45,
  },
  dateRowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  dateRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  dateLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.92)",
  },
  dateLabelDisabled: {
    color: "rgba(255, 255, 255, 0.55)",
  },
  remainingChip: {
    fontSize: 12,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  remainingChipOk: {
    color: "#34d399",
    backgroundColor: "rgba(52, 211, 153, 0.14)",
  },
  remainingChipLow: {
    color: "#fbbf24",
    backgroundColor: "rgba(251, 191, 36, 0.14)",
  },
  remainingChipSoldOut: {
    color: "#f87171",
    backgroundColor: "rgba(248, 113, 113, 0.14)",
  },
});

export default ExperienceOccurrencePicker;
