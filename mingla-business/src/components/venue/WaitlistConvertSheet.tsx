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
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAvailableSlots } from "../../hooks/useVenueAvailability";
import { useVenueTables } from "../../hooks/useVenueTables";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import type { WaitlistEntry } from "../../types/venueReservation";

function nextDates(count: number): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const base = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : d.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
    out.push({ iso, label });
  }
  return out;
}

export interface WaitlistConvertSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  entry: WaitlistEntry | null;
  onConvert: (reservedFor: string, tableId: string | null) => void;
  converting: boolean;
  testID?: string;
}

export function WaitlistConvertSheet({
  visible,
  onClose,
  brandId,
  entry,
  onConvert,
  converting,
  testID,
}: WaitlistConvertSheetProps): React.ReactElement | null {
  const [date, setDate] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);

  const dates = useMemo(() => nextDates(7), []);

  useEffect(() => {
    if (!visible) return;
    setDate(dates[0]?.iso ?? null);
    setSlotIso(null);
    setTableId(null);
  }, [visible, dates]);

  const partySize = entry?.partySize ?? 2;
  const slotsQuery = useAvailableSlots(brandId, date, partySize);
  const slots = slotsQuery.data ?? [];
  const tablesQuery = useVenueTables(brandId);
  const tables = (tablesQuery.data ?? []).filter((t) => t.isActive);

  const handleConvert = useCallback((): void => {
    if (slotIso === null) return;
    onConvert(slotIso, tableId);
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
        <Text style={styles.heading}>Seat {entry.guestName ?? "guest"}</Text>
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
  },
  sub: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
  },
  helper: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  chipRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: {
    backgroundColor: accent.warm,
  },
  chipLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  chipLabelActive: {
    color: "#0c0e12",
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  slot: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  slotActive: {
    borderWidth: 2,
    borderColor: accent.warm,
  },
  slotFull: {
    opacity: 0.4,
  },
  slotLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  slotLabelActive: {
    color: accent.warm,
  },
  slotFullText: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
});

export default WaitlistConvertSheet;
