/**
 * #4420 (R8 P15, mockup venue-detail__module-reservations-tables-r8) — the
 * Reservations "Tables" view: a time stepper, a legend, then each zone's
 * tables in two columns showing who holds the table at that time. Tapping a
 * held table opens the same reservation detail sheet as the list. Read-only.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, materials, radius, space, type } from "../../constants/designSystem";
import type { Reservation } from "../../types/venueReservation";
import { Icon } from "../ui/Icon";
import { formatReservationTime } from "./reservationCalendarModel";
import {
  formatMinuteOfDay,
  type TableSlotState,
  type TableSlotZone,
} from "./reservationTableSlots";

const STATE_LABEL: Record<TableSlotState, string> = {
  free: "Free",
  booked: "Booked",
  pending: "Pending",
  seated: "Seated",
  walkin: "Walk-in",
};

const STATE_COLOR: Record<TableSlotState, string> = {
  free: color.text4,
  booked: color.info,
  pending: color.warning,
  seated: color.success,
  walkin: color.text3,
};

const LEGEND: readonly TableSlotState[] = ["free", "booked", "pending", "seated", "walkin"];

/**
 * The one-line List | Tables switch (kit `.seg`). Local, not the shared
 * Segmented: that primitive's file pulls in Reanimated, which the
 * reservations module's render suites run without.
 */
export function ReservationListTablesSwitch({
  value,
  onChange,
  full,
  showFloor,
}: {
  value: "list" | "tables" | "floor";
  onChange: (next: "list" | "tables" | "floor") => void;
  full: boolean;
  /** #4490 P5 — a third "Floor" view while Floor plan is on. */
  showFloor?: boolean;
}): React.ReactElement {
  return (
    <View
      style={[styles.segTrack, full ? null : styles.segTrackHug]}
      accessibilityRole="tablist"
      accessibilityLabel="Show reservations as a list or by table"
      testID="reservations-view-switch"
    >
      {(showFloor === true ? (["list", "tables", "floor"] as const) : (["list", "tables"] as const)).map((key) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityLabel={key === "list" ? "List" : key === "tables" ? "Tables" : "Floor"}
            accessibilityState={{ selected: on }}
            style={[styles.seg, full ? styles.segFull : null, on ? styles.segOn : null]}
            testID={`reservations-view-${key}`}
          >
            <Text style={[styles.segText, on ? styles.segTextOn : null]}>
              {key === "list" ? "List" : key === "tables" ? "Tables" : "Floor"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface ReservationTablesViewProps {
  zones: readonly TableSlotZone[];
  minuteOfDay: number;
  onStepTime: (deltaMinutes: number) => void;
  timeZone: string;
  onSelect: (reservation: Reservation) => void;
  testID?: string;
}

export function ReservationTablesView({
  zones,
  minuteOfDay,
  onStepTime,
  timeZone,
  onSelect,
  testID,
}: ReservationTablesViewProps): React.ReactElement {
  const timeLabel = formatMinuteOfDay(minuteOfDay);
  return (
    <View style={styles.host} testID={testID ?? "reservation-tables-view"}>
      <View style={styles.timeRow}>
        <Pressable
          onPress={() => onStepTime(-30)}
          accessibilityRole="button"
          accessibilityLabel="30 minutes earlier"
          style={styles.timeStep}
          testID="reservation-tables-time-earlier"
        >
          <Icon name="chevL" size={16} color={color.text2} />
        </Pressable>
        <View style={styles.timePill} accessibilityLabel={`Showing tables at ${timeLabel}`}>
          <Icon name="clock" size={16} color={color.text2} />
          <Text style={styles.timeText}>{timeLabel}</Text>
        </View>
        <Pressable
          onPress={() => onStepTime(30)}
          accessibilityRole="button"
          accessibilityLabel="30 minutes later"
          style={styles.timeStep}
          testID="reservation-tables-time-later"
        >
          <Icon name="chevR" size={16} color={color.text2} />
        </Pressable>
      </View>

      <View style={styles.legend}>
        {LEGEND.map((state) => (
          <View key={state} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATE_COLOR[state] }]} />
            <Text style={styles.legendText}>{STATE_LABEL[state]}</Text>
          </View>
        ))}
      </View>

      {zones.length === 0 ? (
        <Text style={styles.empty}>Add tables in the Tables module to see them here.</Text>
      ) : (
        zones.map((zone) => (
          <View key={zone.zone ?? "none"} style={styles.zone}>
            <View style={styles.zoneHeader}>
              <Text style={styles.zoneLabel}>{zone.label}</Text>
              <Text style={styles.zoneCount}>
                {zone.freeCount} free of {zone.slots.length}
              </Text>
            </View>
            <View style={styles.grid}>
              {zone.slots.map((slot) => {
                const r = slot.reservation;
                return (
                  <Pressable
                    key={slot.table.id}
                    onPress={r !== null ? () => onSelect(r) : undefined}
                    disabled={r === null}
                    accessibilityRole={r !== null ? "button" : undefined}
                    accessibilityLabel={`${slot.table.name}, ${STATE_LABEL[slot.state]}${
                      r !== null ? `, ${r.guestName ?? "Guest"}, party of ${r.partySize}` : ""
                    }`}
                    style={[
                      styles.card,
                      slot.state !== "free" && {
                        borderLeftColor: STATE_COLOR[slot.state],
                        borderLeftWidth: 3,
                      },
                    ]}
                    testID={`reservation-tables-card-${slot.table.id}`}
                  >
                    <View style={styles.cardTop}>
                      <Text style={styles.tableName} numberOfLines={1}>
                        {slot.table.name}
                      </Text>
                      <View style={styles.seats}>
                        <Icon name="users" size={14} color={color.text3} />
                        <Text style={styles.seatsText}>{slot.table.capacity}</Text>
                      </View>
                    </View>
                    {r === null ? (
                      <Text style={styles.free}>Free</Text>
                    ) : (
                      <>
                        <Text style={styles.guest} numberOfLines={1}>
                          {r.guestName ?? "Guest"}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {formatReservationTime(r.reservedFor, timeZone)} · party of {r.partySize}
                        </Text>
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  segTrack: {
    flexDirection: "row",
    gap: 2,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  segTrackHug: { alignSelf: "flex-start" },
  seg: {
    minHeight: 36,
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  segFull: { flex: 1 },
  segOn: {
    backgroundColor: materials.selected.solidFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: materials.selected.rim.edge,
  },
  segText: { ...type.chip, color: color.text2 },
  segTextOn: { color: color.textStrong },
  host: { gap: space[4] },
  timeRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  timeStep: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    height: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  timeText: { ...type.btnSm, color: color.text1 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: space[3], rowGap: space[1] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space[1] },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { ...type.caption, color: color.text2 },
  zone: { gap: space[2] },
  zoneHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  zoneLabel: { ...type.label, textTransform: "uppercase", color: color.text3 },
  zoneCount: { ...type.caption, color: color.text3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  card: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 140,
    maxWidth: 260,
    padding: space[3],
    gap: 2,
    borderRadius: radius.md,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  tableName: { ...type.row, color: color.text1, flexShrink: 1 },
  seats: { flexDirection: "row", alignItems: "center", gap: 2 },
  seatsText: { ...type.caption, color: color.text3 },
  free: { ...type.small, color: color.text3 },
  guest: { ...type.small, fontWeight: "600", color: color.text1 },
  meta: { ...type.caption, color: color.text2 },
  empty: { ...type.small, color: color.text2 },
});
