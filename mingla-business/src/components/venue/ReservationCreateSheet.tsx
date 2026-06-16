/**
 * META-ORCH-1148 sub-ORCH 2.1b — manual reservation create sheet.
 *
 * Guest · party · date · time (from the engine slots — the SAME availability
 * truth the consumer picker uses; NO client slot fabrication) · table · source ·
 * occasion · tags · contact · note. Writes via the guarded biz_reservation_create
 * RPC (FREE; created_via='operator'). Slots come from useAvailableSlots (the sole
 * engine caller — the strict-grep gate forbids any component naming the RPC).
 * a11y labels on every Pressable. Android glass via Sheet.
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
import { isValidE164 } from "../../utils/phone";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import {
  RESERVATION_TAGS,
  type ReservationCreateInput,
  type ReservationSource,
  type ReservationTag,
} from "../../types/venueReservation";

const SOURCES: readonly { value: ReservationSource; label: string }[] = [
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "mingla", label: "Mingla" },
];

const TAG_LABEL: Record<ReservationTag, string> = {
  vip: "VIP",
  birthday: "Birthday",
  first_time: "First-time",
  regular: "Regular",
  high_risk_no_show: "High no-show risk",
};

/** Next `count` dates as YYYY-MM-DD (venue-local-ish; the engine resolves tz). */
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

export interface ReservationCreateSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  onSave: (input: ReservationCreateInput) => void;
  saving: boolean;
  testID?: string;
}

export function ReservationCreateSheet({
  visible,
  onClose,
  brandId,
  onSave,
  saving,
  testID,
}: ReservationCreateSheetProps): React.ReactElement {
  const [guestName, setGuestName] = useState<string>("");
  const [partySize, setPartySize] = useState<number>(2);
  const [date, setDate] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [source, setSource] = useState<ReservationSource>("phone");
  const [occasion, setOccasion] = useState<string>("");
  const [tags, setTags] = useState<ReservationTag[]>([]);
  const [phone, setPhone] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const dates = useMemo(() => nextDates(14), []);

  useEffect(() => {
    if (!visible) return;
    setGuestName("");
    setPartySize(2);
    setDate(dates[0]?.iso ?? null);
    setSlotIso(null);
    setTableId(null);
    setSource("phone");
    setOccasion("");
    setTags([]);
    setPhone("");
    setNotes("");
  }, [visible, dates]);

  const tablesQuery = useVenueTables(brandId);
  const tables = (tablesQuery.data ?? []).filter((t) => t.isActive);

  // The SOLE slot source — engine RPC via the owner hook. No fabrication.
  const slotsQuery = useAvailableSlots(brandId, date, partySize);
  const slots = slotsQuery.data ?? [];

  const phoneValid = phone.trim().length === 0 || isValidE164(phone.trim());
  const canSave =
    guestName.trim().length > 0 &&
    slotIso !== null &&
    phoneValid &&
    !saving;

  const handleSave = useCallback((): void => {
    if (!canSave || slotIso === null) return;
    onSave({
      reservedFor: slotIso,
      partySize,
      source,
      guestName: guestName.trim(),
      guestPhoneE164: phone.trim().length > 0 ? phone.trim() : null,
      guestEmail: null,
      tableId,
      occasion: occasion.trim().length > 0 ? occasion.trim() : null,
      guestNotes: notes.trim().length > 0 ? notes.trim() : null,
      tags,
    });
  }, [
    canSave,
    slotIso,
    partySize,
    source,
    guestName,
    phone,
    tableId,
    occasion,
    notes,
    tags,
    onSave,
  ]);

  const toggleTag = useCallback((t: ReservationTag): void => {
    setTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }, []);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.92}
      testID={testID ?? "reservation-create-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>New reservation</Text>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupLabel}>Guest</Text>
          <Input
            value={guestName}
            onChangeText={setGuestName}
            placeholder="Guest name"
            accessibilityLabel="Guest name"
            testID="reservation-guest-name"
          />

          <Text style={styles.groupLabel}>Party size</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setPartySize((p) => Math.max(1, p - 1))}
              accessibilityRole="button"
              accessibilityLabel="Decrease party size"
              style={styles.stepBtn}
              testID="reservation-party-minus"
            >
              <Text style={styles.stepBtnLabel}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{partySize}</Text>
            <Pressable
              onPress={() => setPartySize((p) => Math.min(100, p + 1))}
              accessibilityRole="button"
              accessibilityLabel="Increase party size"
              style={styles.stepBtn}
              testID="reservation-party-plus"
            >
              <Text style={styles.stepBtnLabel}>+</Text>
            </Pressable>
          </View>

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
                  testID={`reservation-date-${d.iso}`}
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
            <Text style={styles.helper}>
              No bookable times for this date and party size. Try another date.
            </Text>
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
                      s.isFull
                        ? `${s.slotLocalLabel}, full`
                        : `Select ${s.slotLocalLabel}`
                    }
                    style={[
                      styles.slot,
                      active ? styles.slotActive : null,
                      s.isFull ? styles.slotFull : null,
                    ]}
                    testID={`reservation-slot-${s.slotStartUtc}`}
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
                      testID={`reservation-table-${t.id}`}
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

          <Text style={styles.groupLabel}>Source</Text>
          <View style={styles.chipRowWrap}>
            {SOURCES.map((s) => {
              const active = s.value === source;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => setSource(s.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Source ${s.label}`}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  testID={`reservation-source-${s.value}`}
                >
                  <Text
                    style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>Tags</Text>
          <View style={styles.chipRowWrap}>
            {RESERVATION_TAGS.map((t) => {
              const active = tags.includes(t);
              return (
                <Pressable
                  key={t}
                  onPress={() => toggleTag(t)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Tag ${TAG_LABEL[t]}`}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  testID={`reservation-tag-${t}`}
                >
                  <Text
                    style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
                  >
                    {TAG_LABEL[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>Contact &amp; details (optional)</Text>
          <Input
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            accessibilityLabel="Guest phone, E.164 format"
            testID="reservation-phone"
          />
          {!phoneValid ? (
            <Text style={styles.errorText} testID="reservation-phone-error">
              Enter a valid phone like +15551234567.
            </Text>
          ) : null}
          <Input
            value={occasion}
            onChangeText={setOccasion}
            placeholder="Occasion (birthday, anniversary…)"
            accessibilityLabel="Occasion"
            testID="reservation-occasion"
          />
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes for the host"
            accessibilityLabel="Guest notes"
            testID="reservation-notes"
          />

          <Button
            label="Create reservation"
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            style={styles.saveBtn}
            testID="reservation-create-save"
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
  errorText: {
    ...typography.bodySm,
    color: "#ff6b6b",
    marginTop: spacing.xxs,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  stepBtnLabel: {
    ...typography.h3,
    color: textTokens.primary,
  },
  stepValue: {
    ...typography.h3,
    color: textTokens.primary,
    minWidth: 32,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
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

export default ReservationCreateSheet;
