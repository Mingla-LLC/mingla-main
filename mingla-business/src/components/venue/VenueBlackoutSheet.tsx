/**
 * META-ORCH-1148 sub-ORCH 2.1a — add/edit a blackout date.
 *
 * Writes a venue_blackouts row: a date range (YYYY-MM-DD), an optional reason,
 * and a scope (whole venue / a zone / a single table). The engine drops
 * whole-day ('all') blackouts and reduces eligible tables for zone/table scopes.
 * All Pressables carry a11y labels (I-39).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
// Issue #1503 [stay-date-pickers] — From/To are PICKED from a real calendar on
// every surface (HTML5 date input on web, native dialog on iOS/Android). The
// `From (YYYY-MM-DD)` label crutch is gone: the control now carries the format.
import { DateField } from "../ui/DateField";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type {
  BlackoutAppliesTo,
  VenueBlackout,
  VenueBlackoutUpsert,
  VenueTable,
  VenueTableZone,
} from "../../types/venueReservation";

/** Lazy ConfirmDialog — static import pulls reanimated into suites that only
 * mount the blackout form (dateField #1503, availability draft math). Nesting
 * the dialog INSIDE `<Sheet>` is required on iOS New-Arch (#1369 / #3655 P1):
 * a sibling Modal on the screen-root VC is dropped as "already presenting". */
const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

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
  /** Runs the remove mutation after the in-sheet confirm (#3655 P1 / #1369). */
  onDelete?: () => void;
  saving: boolean;
  /** #3624 / #3655 — true while a remove mutation is in flight. */
  deleting?: boolean;
  /** #3624 — shown when remove fails; sheet and row stay open. */
  deleteError?: string | null;
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
  deleting = false,
  deleteError = null,
  testID,
}: VenueBlackoutSheetProps): React.ReactElement {
  const isEdit = blackout !== null;
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [appliesTo, setAppliesTo] = useState<BlackoutAppliesTo>("all");
  const [zone, setZone] = useState<VenueTableZone | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setConfirmDeleteOpen(false);
      setLeaveOpen(false);
      return;
    }
    setDateStart(blackout?.dateStart ?? "");
    setDateEnd(blackout?.dateEnd ?? "");
    setReason(blackout?.reason ?? "");
    setAppliesTo(blackout?.appliesTo ?? "all");
    setZone(blackout?.zone ?? null);
    setTableId(blackout?.tableId ?? null);
  }, [visible, blackout]);

  // #3624 — on remove failure the parent surfaces deleteError on this sheet;
  // close the confirm so the inline error is visible again.
  useEffect(() => {
    if (deleteError !== null && deleteError.length > 0) {
      setConfirmDeleteOpen(false);
    }
  }, [deleteError]);

  const startValid = ISO_DATE.test(dateStart);
  const endValid = ISO_DATE.test(dateEnd || dateStart);
  const rangeValid =
    startValid && endValid && (dateEnd || dateStart) >= dateStart;
  const scopeValid =
    appliesTo === "all" ||
    (appliesTo === "zone" && zone !== null) ||
    (appliesTo === "table" && tableId !== null);
  const canSave = rangeValid && scopeValid && !saving;

  // #3655 — blackout sheet used to discard dirty edits on drag-close with no prompt.
  const formDirty = useMemo((): boolean => {
    if (!visible) return false;
    const baseStart = blackout?.dateStart ?? "";
    const baseEnd = blackout?.dateEnd ?? "";
    const baseReason = blackout?.reason ?? "";
    const baseApplies = blackout?.appliesTo ?? "all";
    const baseZone = blackout?.zone ?? null;
    const baseTable = blackout?.tableId ?? null;
    return (
      dateStart !== baseStart ||
      dateEnd !== baseEnd ||
      reason !== baseReason ||
      appliesTo !== baseApplies ||
      zone !== baseZone ||
      tableId !== baseTable
    );
  }, [
    visible,
    blackout,
    dateStart,
    dateEnd,
    reason,
    appliesTo,
    zone,
    tableId,
  ]);

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

  const handleClose = useCallback((): void => {
    if (deleting || saving) return;
    if (formDirty) {
      setLeaveOpen(true);
      return;
    }
    onClose();
  }, [deleting, formDirty, onClose, saving]);

  const handleLeaveDiscard = useCallback((): void => {
    setLeaveOpen(false);
    onClose();
  }, [onClose]);

  const handleLeaveSave = useCallback(async (): Promise<void> => {
    if (!canSave) throw new Error("invalid");
    setLeaveOpen(false);
    handleSave();
  }, [canSave, handleSave]);

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      snapPoint={0.75}
      dismissDisabled={saving || deleting}
      dismissGuard={() => formDirty && !saving && !deleting}
      onRequestClose={handleClose}
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
              <DateField
                label="From"
                value={dateStart}
                onChangeValue={setDateStart}
                placeholder="Pick a date"
                accessibilityLabel="Blackout start date"
                hasError={dateStart.length > 0 && !rangeValid}
                testID="venue-blackout-start"
              />
            </View>
            <View style={styles.flex1}>
              <DateField
                label="To (optional)"
                value={dateEnd}
                onChangeValue={setDateEnd}
                placeholder="Same day"
                accessibilityLabel="Blackout end date"
                // A blackout may legitimately be a SINGLE day, so the floor is
                // the start date itself, not the day after it. Operators also
                // record historical closures, so there is deliberately no
                // past-date clamp here (unlike the guest Stay picker).
                min={ISO_DATE.test(dateStart) ? dateStart : undefined}
                hasError={dateEnd.length > 0 && !rangeValid}
                testID="venue-blackout-end"
              />
            </View>
          </View>
          {(dateStart.length > 0 || dateEnd.length > 0) && !rangeValid ? (
            <Text style={styles.invalid}>
              Pick a start date, and make sure the end date isn&apos;t before
              it.
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
              onPress={() => setConfirmDeleteOpen(true)}
              variant="destructiveOutline"
              size="md"
              fullWidth
              disabled={saving || deleting}
              style={styles.deleteBtn}
              testID="venue-blackout-delete"
            />
          ) : null}
          {deleteError !== null && deleteError.length > 0 ? (
            <Text style={styles.deleteError} testID="venue-blackout-delete-error">
              {deleteError}
            </Text>
          ) : null}
        </ScrollView>
      </View>
      {confirmDeleteOpen && onDelete != null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => {
              if (!deleting) setConfirmDeleteOpen(false);
            }}
            title="Remove this blackout?"
            description={
              blackout !== null
                ? `Guests will be able to book again from ${blackout.dateStart}${
                    blackout.dateEnd && blackout.dateEnd !== blackout.dateStart
                      ? ` to ${blackout.dateEnd}`
                      : ""
                  }.`
                : "Guests will be able to book these dates again."
            }
            confirmLabel="Remove blackout"
            cancelLabel="Keep it"
            destructive
            confirmLoading={deleting}
            closeDisabled={deleting}
            onConfirm={() => {
              onDelete();
            }}
            testID="venue-blackout-delete-confirm"
          />
        </React.Suspense>
      ) : null}

      {leaveOpen ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setLeaveOpen(false)}
            onConfirm={handleLeaveDiscard}
            title={
              isEdit ? "Save your blackout changes?" : "Save this new blackout?"
            }
            description={
              isEdit
                ? "You changed this blackout. If you leave without saving, those changes are gone."
                : "This blackout has not been saved yet. If you leave, it will be discarded."
            }
            variant="leave"
            onSave={handleLeaveSave}
            onDiscard={handleLeaveDiscard}
            saveDisabled={!canSave}
            confirmLoading={saving}
            saveTestID="venue-blackout-leave-save"
            discardTestID="venue-blackout-leave-discard"
            keepTestID="venue-blackout-leave-keep"
            testID="venue-blackout-leave-dialog"
          />
        </React.Suspense>
      ) : null}
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
  deleteError: {
    ...typography.caption,
    color: semantic.errorText,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  deleteBtn: {
    marginTop: spacing.xs,
  },
});

export default VenueBlackoutSheet;
