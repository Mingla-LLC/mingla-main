/**
 * META-ORCH-1148 sub-ORCH 2.1b — convert-waitlist-to-reservation sheet.
 *
 * Pick a date + time (from the engine slots — the SAME availability truth, no
 * client fabrication) + optional table, then convert atomically via the guarded
 * biz_waitlist_convert_to_reservation RPC. a11y labels. Android glass via Sheet.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useAvailableSlots } from "../../hooks/useVenueAvailability";
import { useVenueTables } from "../../hooks/useVenueTables";
import { Button } from "../ui/Button";
import { PickerSheetHead } from "../ui/PickerSheetHead";
import { Sheet } from "../ui/Sheet";
import { NOW_SLOT, nextDates, venueOpenNow } from "./waitlistSeatModel";
import type { WaitlistEntry } from "../../types/venueReservation";

export interface WaitlistConvertSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  /** META-ORCH-1255 — the venue the entry converts into a reservation for. */
  venueId?: string | null;
  entry: WaitlistEntry | null;
  onConvert: (reservedFor: string, tableId: string | null) => void;
  converting: boolean;
  /** #4490 fix 3 — a refused seat, said in the sheet. */
  error?: string | null;
  /** The venue's time zone, for "Today" and the day chips. */
  timeZone?: string;
  testID?: string;
}

export function WaitlistConvertSheet({
  visible,
  onClose,
  brandId,
  venueId = null,
  entry,
  onConvert,
  converting,
  error = null,
  timeZone,
  testID,
}: WaitlistConvertSheetProps): React.ReactElement | null {
  const [date, setDate] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dates = useMemo(() => nextDates(7, timeZone), [timeZone, visible]);

  useEffect(() => {
    if (!visible) return;
    setDate(dates[0]?.iso ?? null);
    setSlotIso(null);
    setTableId(null);
  }, [visible, dates]);

  const partySize = entry?.partySize ?? 2;
  const slotsQuery = useAvailableSlots(brandId, venueId, date, partySize);
  const slots = slotsQuery.data ?? [];
  const tablesQuery = useVenueTables(brandId, venueId);
  const tables = (tablesQuery.data ?? []).filter((t) => t.isActive);

  const isToday = date !== null && date === dates[0]?.iso;
  const openNow = isToday && venueOpenNow(slots);

  const handleConvert = useCallback((): void => {
    if (slotIso === null) return;
    // "Now": a walk-in seated at once is booked for this minute.
    const at = slotIso === NOW_SLOT ? new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString() : slotIso;
    onConvert(at, tableId);
  }, [slotIso, tableId, onConvert]);

  if (entry === null) return null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.85}
      testID={testID ?? "waitlist-convert-sheet"}
    >
      <View style={styles.body}>
        <PickerSheetHead title={`Seat ${entry.guestName ?? "guest"}`} onClose={onClose} testID="waitlist-convert-head" />
        <Text style={styles.sub}>Party of {entry.partySize}</Text>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupLabel}>Date</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {dates.map((d) => {
              const active = d.iso === date;
              return (
                <Pressable
                  key={d.iso}
                  onPress={() => {
                    setDate(d.iso);
                    setSlotIso(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Date ${d.label}`}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  testID={`waitlist-convert-date-${d.iso}`}
                >
                  <Text
                    style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
                  >
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.groupLabel}>Time</Text>
          {slotsQuery.isLoading ? (
            <Text style={styles.helper}>Loading times…</Text>
          ) : slots.length === 0 ? (
            <Text style={styles.helper}>No open times for this date.</Text>
          ) : (
            <View style={styles.slotGrid}>
              {openNow ? (
                <Pressable
                  onPress={() => setSlotIso(NOW_SLOT)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: slotIso === NOW_SLOT }}
                  accessibilityLabel="Seat them now"
                  style={[styles.slot, slotIso === NOW_SLOT ? styles.slotActive : null]}
                  testID="waitlist-convert-slot-now"
                >
                  <Text style={[styles.slotLabel, slotIso === NOW_SLOT ? styles.slotLabelActive : null]}>Now</Text>
                </Pressable>
              ) : null}
              {slots.map((s) => {
                const active = s.slotStartUtc === slotIso;
                return (
                  <Pressable
                    key={s.slotStartUtc}
                    onPress={() => (s.isFull ? undefined : setSlotIso(s.slotStartUtc))}
                    disabled={s.isFull}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: s.isFull }}
                    accessibilityLabel={
                      s.isFull ? `${s.slotLocalLabel}, full` : `Select ${s.slotLocalLabel}`
                    }
                    style={[
                      styles.slot,
                      active ? styles.slotActive : null,
                      s.isFull ? styles.slotFull : null,
                    ]}
                    testID={`waitlist-convert-slot-${s.slotStartUtc}`}
                  >
                    <Text
                      style={[styles.slotLabel, active ? styles.slotLabelActive : null]}
                    >
                      {s.slotLocalLabel}
                    </Text>
                    {s.isFull ? <Text style={styles.slotFullText}>full</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {tables.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>Table (optional)</Text>
              <View style={styles.chipRowWrap}>
                {tables.map((t) => {
                  const active = t.id === tableId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setTableId(active ? null : t.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Table ${t.name}`}
                      style={[styles.chip, active ? styles.chipActive : null]}
                      testID={`waitlist-convert-table-${t.id}`}
                    >
                      <Text
                        style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
                      >
                        {t.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {error !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite" testID="waitlist-convert-error">
              {error}
            </Text>
          ) : null}
          <Button
            label="Seat as reservation"
            onPress={handleConvert}
            variant="primary"
            size="lg"
            fullWidth
            loading={converting}
            disabled={slotIso === null || converting}
            style={styles.saveBtn}
            testID="waitlist-convert-save"
          />
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  sub: {
    ...type.small,
    color: color.text2,
    marginBottom: space[2],
  },
  scroll: {
    paddingBottom: space[9],
    gap: space[1],
  },
  groupLabel: {
    ...type.label,
    color: color.text3,
    marginTop: space[4],
    marginBottom: 2,
  },
  helper: {
    ...type.small,
    color: color.text2,
  },
  chipRow: {
    flexDirection: "row",
    gap: space[1],
    paddingVertical: 2,
  },
  chipRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  chip: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
  },
  chipActive: {
    backgroundColor: color.accent,
  },
  chipLabel: {
    ...type.small,
    color: color.text2,
    fontWeight: "600",
  },
  chipLabelActive: {
    color: color.ink,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  slot: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  slotActive: {
    borderWidth: 2,
    borderColor: color.accent,
  },
  slotFull: {
    opacity: 0.4,
  },
  slotLabel: {
    ...type.small,
    color: color.text1,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  slotLabelActive: {
    color: color.accent,
  },
  slotFullText: {
    ...type.caption,
    color: color.text3,
  },
  saveBtn: {
    marginTop: space[6],
  },
  error: {
    ...type.small,
    color: color.errorText,
    marginTop: space[4],
  },
});

export default WaitlistConvertSheet;
