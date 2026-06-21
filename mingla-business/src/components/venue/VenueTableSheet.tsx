/**
 * META-ORCH-1148 sub-ORCH 2.1a — add/edit table sheet.
 *
 * Grouped form (Identity / Party fit / Character / Status & notes) inside the
 * canonical Sheet primitive. Writes through useUpsertVenueTable. All controls
 * carry a11y labels (I-39). Android glass via GlassCard (opaque fallback
 * automatic). No dead taps.
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
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type {
  VenueReservationPolicy,
  VenueSeatingType,
  VenueTable,
  VenueTableUpsert,
  VenueTableZone,
} from "../../types/venueReservation";

const ZONES: readonly { value: VenueTableZone; label: string }[] = [
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "private_room", label: "Private room" },
  { value: "bar", label: "Bar" },
  { value: "patio", label: "Patio" },
];

const SEATING: readonly { value: VenueSeatingType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "high_top", label: "High-top" },
  { value: "booth", label: "Booth" },
  { value: "lounge", label: "Lounge" },
];

// 2.1a offers ONLY `reservable` online; the other policies are named seams
// (rows can be created via direct schema but the engine surfaces reservable
// only). We expose reservable + walk_in_only so a host can mark a walk-in table.
const POLICIES: readonly { value: VenueReservationPolicy; label: string }[] = [
  { value: "reservable", label: "Reservable" },
  { value: "walk_in_only", label: "Walk-in only" },
];

const parseIntOrNull = (raw: string): number | null => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface VenueTableSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  table: VenueTable | null;
  onSave: (input: VenueTableUpsert) => void;
  saving: boolean;
  /** Soft-delete the table being edited (edit mode only). Omit to hide delete. */
  onDelete?: (id: string) => void;
  deleting?: boolean;
  /** Only managers+ may delete; the row action is hidden otherwise. */
  canDelete?: boolean;
  testID?: string;
}

export function VenueTableSheet({
  visible,
  onClose,
  table,
  onSave,
  saving,
  onDelete,
  deleting = false,
  canDelete = false,
  testID,
}: VenueTableSheetProps): React.ReactElement {
  const isEdit = table !== null;
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);

  // Close the confirm dialog whenever the sheet (re)opens for a different table.
  useEffect(() => {
    if (!visible) setConfirmDeleteOpen(false);
  }, [visible]);

  const showDelete = isEdit && canDelete && onDelete !== undefined;

  const handleConfirmDelete = useCallback((): void => {
    if (table === null || onDelete === undefined) return;
    onDelete(table.id);
  }, [table, onDelete]);
  const [name, setName] = useState<string>("");
  const [capacity, setCapacity] = useState<string>("");
  const [minParty, setMinParty] = useState<string>("");
  const [maxParty, setMaxParty] = useState<string>("");
  const [zone, setZone] = useState<VenueTableZone | null>(null);
  const [seatingType, setSeatingType] = useState<VenueSeatingType | null>(null);
  const [combinable, setCombinable] = useState<boolean>(false);
  const [accessible, setAccessible] = useState<boolean>(false);
  const [policy, setPolicy] = useState<VenueReservationPolicy>("reservable");
  const [notes, setNotes] = useState<string>("");

  // Hydrate the form when (re)opened.
  useEffect(() => {
    if (!visible) return;
    setName(table?.name ?? "");
    setCapacity(table?.capacity != null ? String(table.capacity) : "");
    setMinParty(table?.minParty != null ? String(table.minParty) : "");
    setMaxParty(table?.maxParty != null ? String(table.maxParty) : "");
    setZone(table?.zone ?? null);
    setSeatingType(table?.seatingType ?? null);
    setCombinable(table?.combinable ?? false);
    setAccessible(table?.accessible ?? false);
    setPolicy(table?.reservationPolicy ?? "reservable");
    setNotes(table?.notes ?? "");
  }, [visible, table]);

  const capacityNum = parseIntOrNull(capacity);
  const maxPartyNum = parseIntOrNull(maxParty);
  // META-ORCH-1148 P3-2: a table can never seat more than its capacity. Reject a
  // max-party that exceeds capacity at write time so bad data (which the engine
  // would otherwise have to clamp) can't be entered at all. Mirrors the engine's
  // LEAST(COALESCE(max_party,capacity),capacity) guard.
  const maxPartyExceedsCapacity =
    capacityNum !== null && maxPartyNum !== null && maxPartyNum > capacityNum;
  const canSave =
    name.trim().length > 0 &&
    capacityNum !== null &&
    !maxPartyExceedsCapacity &&
    !saving;

  const handleSave = useCallback((): void => {
    if (!canSave || capacityNum === null) return;
    // Defensive clamp in addition to the canSave gate above: never persist a
    // max-party above capacity even if state slipped through.
    const clampedMaxParty =
      maxPartyNum !== null ? Math.min(maxPartyNum, capacityNum) : null;
    onSave({
      id: table?.id,
      name: name.trim(),
      capacity: capacityNum,
      minParty: parseIntOrNull(minParty),
      maxParty: clampedMaxParty,
      zone,
      seatingType,
      combinable,
      accessible,
      reservationPolicy: policy,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    });
  }, [
    canSave,
    capacityNum,
    maxPartyNum,
    onSave,
    table,
    name,
    minParty,
    zone,
    seatingType,
    combinable,
    accessible,
    policy,
    notes,
  ]);

  const snap = useMemo<number>(() => 0.9, []);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={snap}
      testID={testID ?? "venue-table-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>{isEdit ? "Edit table" : "Add table"}</Text>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Identity */}
          <Text style={styles.groupLabel}>Identity</Text>
          <Field label="Name or number">
            <Input
              value={name}
              onChangeText={setName}
              placeholder="e.g. T2 or Window booth"
              accessibilityLabel="Table name or number"
              testID="venue-table-name"
            />
          </Field>

          {/* Party fit */}
          <Text style={styles.groupLabel}>Party fit</Text>
          <View style={styles.row3}>
            <Field label="Seats" style={styles.flex1}>
              <Input
                value={capacity}
                onChangeText={setCapacity}
                variant="number"
                placeholder="4"
                accessibilityLabel="Table capacity in seats"
                testID="venue-table-capacity"
              />
            </Field>
            <Field label="Min party" style={styles.flex1}>
              <Input
                value={minParty}
                onChangeText={setMinParty}
                variant="number"
                placeholder="1"
                accessibilityLabel="Minimum party size"
                testID="venue-table-min-party"
              />
            </Field>
            <Field label="Max party" style={styles.flex1}>
              <Input
                value={maxParty}
                onChangeText={setMaxParty}
                variant="number"
                placeholder="Seats"
                accessibilityLabel="Maximum party size"
                testID="venue-table-max-party"
              />
            </Field>
          </View>
          {maxPartyExceedsCapacity ? (
            <Text
              style={styles.fieldError}
              accessibilityLabel="Max party cannot exceed seats"
              testID="venue-table-max-party-error"
            >
              Max party can’t exceed the table’s seats ({capacityNum}).
            </Text>
          ) : null}

          {/* Character */}
          <Text style={styles.groupLabel}>Character</Text>
          <Field label="Zone">
            <ChipRow
              options={ZONES}
              selected={zone}
              onSelect={(v) => setZone(v === zone ? null : v)}
              ariaPrefix="Zone"
            />
          </Field>
          <Field label="Seating type">
            <ChipRow
              options={SEATING}
              selected={seatingType}
              onSelect={(v) => setSeatingType(v === seatingType ? null : v)}
              ariaPrefix="Seating type"
            />
          </Field>
          <ToggleRow
            label="Combinable with other tables"
            value={combinable}
            onValueChange={setCombinable}
            testID="venue-table-combinable"
          />
          <ToggleRow
            label="Wheelchair accessible"
            value={accessible}
            onValueChange={setAccessible}
            testID="venue-table-accessible"
          />

          {/* Status & notes */}
          <Text style={styles.groupLabel}>Booking policy &amp; notes</Text>
          <Field label="Policy">
            <ChipRow
              options={POLICIES}
              selected={policy}
              onSelect={(v) => setPolicy(v)}
              ariaPrefix="Reservation policy"
            />
          </Field>
          <Field label="Notes (optional)">
            <Input
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything the host should know"
              accessibilityLabel="Table notes"
              testID="venue-table-notes"
            />
          </Field>

          <Button
            label={isEdit ? "Save table" : "Add table"}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            style={styles.saveBtn}
            testID="venue-table-save"
          />

          {showDelete ? (
            <Button
              label="Delete table"
              onPress={() => setConfirmDeleteOpen(true)}
              variant="destructive"
              size="md"
              fullWidth
              disabled={deleting}
              loading={deleting}
              style={styles.deleteBtn}
              testID="venue-table-delete"
            />
          ) : null}
        </ScrollView>
      </View>

      {showDelete ? (
        <ConfirmDialog
          visible={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={handleConfirmDelete}
          title="Delete this table?"
          description={
            `${table?.name ?? "This table"} will be removed from your floor plan` +
            " and stop being offered for new bookings. Existing reservations are" +
            " kept. This can't be undone."
          }
          variant="simple"
          destructive
          confirmLabel="Delete"
          cancelLabel="Keep table"
          confirmLoading={deleting}
          confirmTestID="venue-table-delete-confirm"
          cancelTestID="venue-table-delete-cancel"
          testID="venue-table-delete-dialog"
        />
      ) : null}
    </Sheet>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
  style?: object;
}

function Field({ label, children, style }: FieldProps): React.ReactElement {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

interface ChipRowProps<T extends string> {
  options: readonly { value: T; label: string }[];
  selected: T | null;
  onSelect: (v: T) => void;
  ariaPrefix: string;
}

function ChipRow<T extends string>({
  options,
  selected,
  onSelect,
  ariaPrefix,
}: ChipRowProps<T>): React.ReactElement {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${ariaPrefix}: ${o.label}`}
            style={[styles.chip, active ? styles.chipActive : null]}
            testID={`venue-chip-${ariaPrefix.toLowerCase().replace(/\s+/g, "-")}-${o.value}`}
          >
            <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID: string;
}

function ToggleRow({
  label,
  value,
  onValueChange,
  testID,
}: ToggleRowProps): React.ReactElement {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <BrandSwitch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        testID={testID}
      />
    </View>
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
  field: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  fieldError: {
    ...typography.bodySm,
    color: "#ff6b6b",
    marginTop: spacing.xxs,
    marginBottom: spacing.xs,
  },
  row3: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  toggleLabel: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.sm,
  },
});

export default VenueTableSheet;
