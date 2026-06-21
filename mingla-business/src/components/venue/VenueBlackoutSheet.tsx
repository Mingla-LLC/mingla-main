/**
 * META-ORCH-1148 sub-ORCH 2.1a — add/edit a blackout date.
 *
 * Writes a venue_blackouts row: a date range (YYYY-MM-DD), an optional reason,
 * and a scope (whole venue / a zone / a single table). The engine drops
 * whole-day ('all') blackouts and reduces eligible tables for zone/table scopes.
 * All Pressables carry a11y labels (I-39).
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type {
  BlackoutAppliesTo,
  VenueBlackout,
  VenueBlackoutUpsert,
  VenueTable,
  VenueTableZone,
} from "../../types/venueReservation";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SCOPES: readonly { value: BlackoutAppliesTo; label: string }[] = [
  { value: "all", label: "Whole venue" },
  { value: "zone", label: "A zone" },
  { value: "table", label: "One table" },
];

const ZONES: readonly { value: VenueTableZone; label: string }[] = [
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "private_room", label: "Private room" },
  { value: "bar", label: "Bar" },
  { value: "patio", label: "Patio" },
];

export interface VenueBlackoutSheetProps {
  visible: boolean;
  onClose: () => void;
  blackout: VenueBlackout | null;
  tables: VenueTable[];
  onSave: (input: VenueBlackoutUpsert) => void;
  onDelete?: () => void;
  saving: boolean;
  testID?: string;
}

export function VenueBlackoutSheet({
  visible,
  onClose,
  blackout,
  tables,
  onSave,
  onDelete,
  saving,
  testID,
}: VenueBlackoutSheetProps): React.ReactElement {
  const isEdit = blackout !== null;
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [appliesTo, setAppliesTo] = useState<BlackoutAppliesTo>("all");
  const [zone, setZone] = useState<VenueTableZone | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDateStart(blackout?.dateStart ?? "");
    setDateEnd(blackout?.dateEnd ?? "");
    setReason(blackout?.reason ?? "");
    setAppliesTo(blackout?.appliesTo ?? "all");
    setZone(blackout?.zone ?? null);
    setTableId(blackout?.tableId ?? null);
  }, [visible, blackout]);

  const startValid = ISO_DATE.test(dateStart);
  const endValid = ISO_DATE.test(dateEnd || dateStart);
  const rangeValid =
    startValid && endValid && (dateEnd || dateStart) >= dateStart;
  const scopeValid =
    appliesTo === "all" ||
    (appliesTo === "zone" && zone !== null) ||
    (appliesTo === "table" && tableId !== null);
  const canSave = rangeValid && scopeValid && !saving;

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    onSave({
      id: blackout?.id,
      dateStart,
      dateEnd: dateEnd || dateStart,
      reason: reason.trim().length > 0 ? reason.trim() : null,
      appliesTo,
      zone,
      tableId,
    });
  }, [
    canSave,
    onSave,
    blackout,
    dateStart,
    dateEnd,
    reason,
    appliesTo,
    zone,
    tableId,
  ]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.75}
      testID={testID ?? "venue-blackout-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>
          {isEdit ? "Edit blackout" : "Add blackout"}
        </Text>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.dateRow}>
            <View style={styles.flex1}>
              <Text style={styles.label}>From (YYYY-MM-DD)</Text>
              <Input
                value={dateStart}
                onChangeText={setDateStart}
                variant="number"
                placeholder="2026-12-24"
                accessibilityLabel="Blackout start date, year dash month dash day"
                testID="venue-blackout-start"
              />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.label}>To (optional)</Text>
              <Input
                value={dateEnd}
                onChangeText={setDateEnd}
                variant="number"
                placeholder="Same day"
                accessibilityLabel="Blackout end date, year dash month dash day"
                testID="venue-blackout-end"
              />
            </View>
          </View>
          {(dateStart.length > 0 || dateEnd.length > 0) && !rangeValid ? (
            <Text style={styles.invalid}>
              Use YYYY-MM-DD and make sure the end date isn&apos;t before the
              start.
            </Text>
          ) : null}

          <Text style={styles.label}>Reason (optional)</Text>
          <Input
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Holiday closure"
            accessibilityLabel="Blackout reason"
            testID="venue-blackout-reason"
          />

          <Text style={styles.label}>Applies to</Text>
          <View style={styles.chipRow}>
            {SCOPES.map((s) => {
              const active = s.value === appliesTo;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => setAppliesTo(s.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Scope: ${s.label}`}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  testID={`venue-blackout-scope-${s.value}`}
                >
                  <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {appliesTo === "zone" ? (
            <>
              <Text style={styles.label}>Which zone</Text>
              <View style={styles.chipRow}>
                {ZONES.map((z) => {
                  const active = z.value === zone;
                  return (
                    <Pressable
                      key={z.value}
                      onPress={() => setZone(z.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Zone: ${z.label}`}
                      style={[styles.chip, active ? styles.chipActive : null]}
                      testID={`venue-blackout-zone-${z.value}`}
                    >
                      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
                        {z.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {appliesTo === "table" ? (
            <>
              <Text style={styles.label}>Which table</Text>
              <View style={styles.chipRow}>
                {tables.map((t) => {
                  const active = t.id === tableId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setTableId(t.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Table: ${t.name}`}
                      style={[styles.chip, active ? styles.chipActive : null]}
                      testID={`venue-blackout-table-${t.id}`}
                    >
                      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
                        {t.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <Button
            label={isEdit ? "Save blackout" : "Add blackout"}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            style={styles.saveBtn}
            testID="venue-blackout-save"
          />
          {isEdit && onDelete != null ? (
            <Button
              label="Remove this blackout"
              onPress={onDelete}
              variant="ghost"
              size="md"
              fullWidth
              style={styles.deleteBtn}
              testID="venue-blackout-delete"
            />
          ) : null}
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
  // ORCH-1193: bound the scroll viewport to the fixed-height panel so the CTA
  // scrolls into view instead of overflowing past the panel's overflow:hidden.
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  label: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xxs,
  },
  dateRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
  },
  invalid: {
    ...typography.caption,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  chipRow: {
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
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.xs,
  },
});

export default VenueBlackoutSheet;
